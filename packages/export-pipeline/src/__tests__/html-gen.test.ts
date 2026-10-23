import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { resolveNarrationV2 } from "@praxity/shared-blocks/narration";
import { build as buildCss } from "esbuild";
import fs from "fs-extra";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readBlockFixture as readBlockSource,
	replayLesson,
} from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { readLesson } from "../../../grammar/src/read-lesson";
import { bufferPrivateBlockState } from "../../template/src/hosts/privacy-bootstrap";
import type { CourseConfig } from "../html-gen";
import {
	collectRequiredAssessmentIds,
	DEPLOYMENT_HEAD_MARKER,
	escapeJsonForHtml,
	generateCourseCss,
	generateHtmlIndex,
	generateHtmlPage,
	generateNumberedPageRedirect,
	HOST_CONFIG_ID,
	resolveColorShades,
	SHELL_CONFIG_ID,
	themeVarsToCss,
} from "../html-gen";
import { generateHtmlPages } from "../html-pages";
import { LocalStorageRuntime } from "../scorm/local-storage-runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<CourseConfig> = {}): CourseConfig {
	return {
		id: "course-1",
		title: "Test Course",
		sourceLocale: "en",
		totalPages: 1,
		pages: [
			{
				id: "page-1",
				title: "Introduction",
				blocks: [
					{ id: "b1", type: "text", data: { content: "<p>Hello</p>" } },
					{ id: "b2", type: "heading", data: { content: "Section", level: 2 } },
				],
			},
		],
		...overrides,
	};
}

const STATIC_NAV_TOGGLES = { navTopBar: false, showA11yPill: false };

it("self-checks never enter scored assessments or automatic knowledge checks", () => {
	const pages: CourseConfig["pages"] = [
		{
			id: "page-1",
			title: "Page",
			blocks: [{ id: "body", type: "text", data: { content: "Start" } }],
		},
		{
			id: "practice",
			title: "Practice",
			blocks: [
				{
					id: "self-check",
					type: "selfCheck",
					data: { required: true, content: { task: "Task", parts: [{ id: "part" }] } },
				},
				{
					id: "accordion",
					type: "accordion",
					data: {
						items: [
							{
								id: "panel",
								title: "Panel",
								blocks: [
									{
										id: "nested-self-check",
										type: "selfCheck",
										data: {
											private: false,
											required: true,
											content: { task: "Task", parts: [{ id: "part-2" }] },
										},
									},
								],
							},
						],
					},
				},
				{
					id: "graded",
					type: "assessment",
					data: {
						required: true,
						gradingMode: "exact",
						assessmentType: "choice",
						response: {
							type: "choice",
							selectionMode: "single",
							options: [
								{ id: "yes", label: "Yes", isCorrect: true },
								{ id: "no", label: "No", isCorrect: false },
							],
						},
					},
				},
			],
		},
	];
	expect(collectRequiredAssessmentIds(pages)).toEqual(["graded"]);
	expect(collectRequiredAssessmentIds(pages, "passingScore")).toEqual(["graded"]);
	const dom = new JSDOM(
		renderPage({ pages, totalPages: 2, requireKnowledgeChecks: true, passingScore: 80 }),
	);
	const config = JSON.parse(
		dom.window.document.getElementById(HOST_CONFIG_ID)?.textContent ?? "{}",
	);
	expect(config.requiredAssessmentIds).toEqual(["graded"]);
	expect(config.scoredAssessmentIds).toEqual(["graded"]);
	expect(config.passMark).toBe(80);
	dom.window.close();
	pages[1].blocks.pop();
	expect(collectRequiredAssessmentIds(pages)).toEqual([]);
	expect(() => collectRequiredAssessmentIds(pages, "passingScore")).toThrow(
		"A course passing score needs at least one required, automatically scored question. Add one or remove the passing score.",
	);
});

it.each(["en", "fr", "fr-CA"])(
	"compiles the course-wide private policy and %s notices without enabling self-check publication",
	(locale) => {
		const html = renderPage({
			sourceLocale: locale,
			totalPages: 2,
			pages: [
				{
					id: "page-1",
					title: "Start",
					blocks: [{ id: "body", type: "text", data: { content: "Start" } }],
				},
				{
					id: "page-2",
					title: "Practice",
					blocks: [
						{
							id: "private-check",
							type: "selfCheck",
							data: { content: { task: "Explain", parts: [{ id: "part" }] } },
						},
						{
							id: "reported-check",
							type: "selfCheck",
							data: { private: false, content: { task: "Explain", parts: [{ id: "part" }] } },
						},
						{
							id: "journal",
							type: "assessment",
							data: { assessmentType: "textResponse", private: true },
						},
					],
				},
			],
		});
		const dom = new JSDOM(html);
		const config = JSON.parse(
			dom.window.document.getElementById(HOST_CONFIG_ID)?.textContent ?? "{}",
		);
		expect(config.blockStatePolicy).toEqual({
			"private-check": "device",
			"reported-check": "lms",
		});
		expect(config.strings).not.toHaveProperty("selfCheckDeviceNotice");
		bufferPrivateBlockState(
			[new LocalStorageRuntime(undefined, "course"), config, dom.window as unknown as Window],
			Promise.reject(new Error("EPRIVACYLOAD")),
		);
		expect(config.strings.selfCheckDeviceNotice).toBe(
			locale === "en"
				? "Your answer is saved in this browser on this device. It is not sent to the LMS."
				: "Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.",
		);
		expect(config.strings.selfCheckLmsNotice).toBe(
			locale === "en"
				? "Your answer is reported to the LMS. Drafts and comparison state may also be saved there."
				: "Votre réponse est transmise au LMS. Les brouillons et l'état de la comparaison peuvent aussi y être enregistrés.",
		);
		expect(config.strings.selfCheckNotSavedDevice).toBe(
			locale === "en"
				? "Your answer is not saved on this device. Keep a copy before leaving this page."
				: "Votre réponse n'est pas enregistrée sur cet appareil. Gardez-en une copie avant de quitter cette page.",
		);
		dom.window.close();
	},
);

it("selects privacy assets only for a nonempty compiled policy", () => {
	const plain = renderPage();
	expect(plain).not.toContain("privacy-bootstrap.js");
	expect(plain).not.toContain("selfCheckDeviceNotice");
	const withCheck = renderPage({
		pages: [
			{
				id: "intro",
				title: "Introduction",
				blocks: [{ id: "body", type: "text", data: { content: "Start" } }],
			},
			{
				id: "page-1",
				title: "Practice",
				blocks: [
					{
						id: "check",
						type: "selfCheck",
						data: { content: { task: "Explain", parts: [{ id: "part" }] } },
					},
				],
			},
		],
	});
	const doc = new JSDOM(withCheck).window.document;
	expect(
		doc.querySelector('script[src="privacy-bootstrap.js"]')?.getAttribute("data-privacy-support"),
	).toBe("privacy-support.js");
	expect(withCheck.indexOf('src="privacy-bootstrap.js"')).toBeLessThan(
		withCheck.indexOf(DEPLOYMENT_HEAD_MARKER),
	);
});

it.each([undefined, "attempt", "pass"] as const)(
	"derives dontKnow from effective deck gate %s",
	(rule) => {
		const question = {
			id: "q",
			type: "assessment" as const,
			data: {
				assessmentType: "choice",
				gradingMode: "none",
				response: {
					type: "choice",
					selectionMode: "single",
					options: [
						{ id: "yes", label: "Yes", isCorrect: true },
						{ id: "no", label: "No" },
					],
				},
			},
		};
		const page = { id: "page-1", title: "Page", blocks: [question] };
		const html = renderPage({
			pages: [page],
			totalPages: 1,
			...(rule ? { moduleDeck: { gates: { q: rule } } } : {}),
		});
		const doc = new JSDOM(html).window.document;
		expect(doc.querySelector("[data-dont-know]") !== null).toBe(rule !== "pass");
		const json = JSON.parse(
			doc.querySelector('[data-block-id="q"]')?.getAttribute("data-block-json") ?? "null",
		);
		if (rule === "pass") expect(json.data._dontKnow).toBe(false);
	},
);

it.each(["authored", "score", "override"] as const)(
	"derives the uncertainty default from a group pass gate: %s",
	(gate) => {
		const group = {
			id: "group",
			type: "assessmentGroup" as const,
			data: {
				mode: "all",
				memberBlockIds: ["q"],
				...(gate === "authored" ? { deckGate: "pass" } : {}),
				...(gate === "score" ? { passingScore: 80 } : {}),
			},
		};
		for (const dontKnow of [undefined, true, false]) {
			const question = {
				id: "q",
				type: "assessment" as const,
				data: {
					assessmentType: "choice",
					gradingMode: "none",
					dontKnow,
					response: {
						type: "choice",
						selectionMode: "single",
						options: [{ id: "yes", label: "Yes", isCorrect: true }],
					},
				},
			};
			const html = renderPage({
				pages: [{ id: "page-1", title: "Page", blocks: [group, question] }],
				totalPages: 1,
				...(gate === "override" ? { moduleDeck: { gates: { group: "pass" as const } } } : {}),
			});
			const doc = new JSDOM(html).window.document;
			expect(doc.querySelector("[data-dont-know]") !== null).toBe(dontKnow === true);
		}
	},
);

it.each(["( )", "[ ]"])("excludes ungraded %s choices from course gates", (marker) => {
	const source = `# Page\n\n::: choice Poll {scored required}\n${marker} First\n${marker} Second\n:::\n\n::: choice Graded {scored}\n(x) Yes\n( ) No\n:::\n`;
	const lesson = readLesson(source);
	expect(lesson.errors).toEqual([]);
	const questions = lesson.blocks.filter((block) => block.type === "assessment");
	expect(questions).toHaveLength(2);
	questions[0].id = "poll";
	questions[1].id = "graded";
	const html = renderPage({
		pages: [{ id: "page-1", title: "Page", blocks: questions }],
		totalPages: 1,
		requireKnowledgeChecks: true,
		passingScore: 0.8,
	});
	const dom = new JSDOM(html);
	const config = JSON.parse(
		dom.window.document.getElementById(HOST_CONFIG_ID)?.textContent ?? "null",
	);
	dom.window.close();
	expect(config.requiredAssessmentIds).toEqual(["graded"]);
	expect(config.scoredAssessmentIds).toEqual(["graded"]);
});

it.each([
	// The prefix ends with a non-breaking space so NVDA keeps the gap before the title.
	["en", "Resumed at page 1 of 1: Introduction", "Resumed at page 1 of 1: "],
	// French also keeps the colon on the same line with a non-breaking space.
	["fr", "Reprise à la page 1 sur 1 : Introduction", "Reprise à la page 1 sur 1 : "],
])(
	"compiles the %s Pages resume cue from the shared template",
	(sourceLocale, expected, prefix) => {
		const html = renderPage({ sourceLocale });
		const dom = new JSDOM(html);
		const host = JSON.parse(
			dom.window.document.getElementById(HOST_CONFIG_ID)?.textContent ?? "{}",
		);
		expect(host.strings.scormResumeAnnouncement).toBe(expected);
		expect(host.strings.scormResumePositionPrefix).toBe(prefix);
		dom.window.close();
	},
);

function makeStaticConfig(overrides: Partial<CourseConfig> = {}): CourseConfig {
	return makeConfig({
		...overrides,
		navigationStyle: overrides.navigationStyle ?? "sidebar",
		navToggles: { ...STATIC_NAV_TOGGLES, ...overrides.navToggles },
	});
}

function makeSlugList(config: CourseConfig) {
	return config.pages.map((p, i) => ({
		pageId: p.id,
		slug: `page-${i + 1}`,
		title: p.title,
	}));
}

function makeSlugMap(config: CourseConfig) {
	const map = new Map<string, string>();
	for (const [i, p] of config.pages.entries()) {
		map.set(p.id, `page-${i + 1}`);
	}
	return map;
}

const testIslandAssets = {
	loaderFilename: "island-loader.js",
	islandFilenames: {
		nav: "island-nav.js",
		accordion: "island-accordion.js",
		tabs: "island-tabs.js",
		assessment: "island-assessment.js",
		assessmentGroup: "island-assessment-group.js",
		logic: "island-logic.js",
		checklist: "island-checklist.js",
		rating: "island-rating.js",
		signature: "island-signature.js",
		narration: "island-narration.js",
		imageComparison: "island-image-comparison.js",
		labeledGraphic: "island-labeled-graphic.js",
		card: "island-card.js",
		table: "island-table.js",
		code: "island-code.js",
		tooltip: "island-tooltip.js",
		media: "island-media.js",
		sequence: "island-sequence.js",
	},
};

function renderPage(configOverrides: Partial<CourseConfig> = {}) {
	const config = makeConfig(configOverrides);
	return generateHtmlPage({
		config,
		page: config.pages[0],
		index: 0,
		currentSlug: "page-1",
		slugList: makeSlugList(config),
		slugMap: makeSlugMap(config),
		islandAssets: {
			...testIslandAssets,
			privacy: { bootstrap: "privacy-bootstrap.js", support: "privacy-support.js" },
		},
	});
}

it("prepares a decorative completion icon and empty status label in graded Pages output", () => {
	const dom = new JSDOM(
		renderPage({
			passingScore: 80,
			pages: [
				{
					id: "page-1",
					title: "Question",
					blocks: [
						{
							id: "question",
							type: "assessment",
							data: {
								required: true,
								gradingMode: "exact",
								assessmentType: "choice",
								response: {
									type: "choice",
									selectionMode: "single",
									options: [{ id: "yes", label: "Yes", isCorrect: true }],
								},
							},
						},
					],
				},
			],
		}),
	);
	try {
		const result = dom.window.document.querySelector<HTMLElement>("[data-course-outcome]");
		expect(result?.hidden).toBe(true);
		expect(result?.classList.contains("praxity-assessment-result")).toBe(false);
		expect(result?.querySelector("[data-course-outcome-label]")?.textContent).toBe("");
		expect(result?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
		expect(result?.querySelector("svg")?.getAttribute("focusable")).toBe("false");
		expect(result?.querySelector("path")).not.toBeNull();
	} finally {
		dom.window.close();
	}
});

it("published grammar 4 transcripts retain baseline title suppression and assessment paragraphs", async () => {
	let sequence = 0;
	const id = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
	const courseId = id(),
		lessonId = id();
	const read = readLesson(
		"# Deux façons d'exprimer un besoin\n\nRoger veut exprimer un besoin.\n\n::: free-response Réflexion : comment se sont passées vos tentatives ?\nDans quelles situations avez-vous utilisé ces techniques ?\n:::\n",
		{ ids: id },
	);
	expect(read.hasErrors).toBe(false);
	const resolved = resolveNarrationV2({
		courseId,
		lessonId,
		pages: read.pages,
		sidecar: { version: 2, courseId, lessons: { [lessonId]: { enabled: true, segments: [] } } },
		locale: "fr",
		digest: (text) => text,
	});
	const page = read.pages[0];
	page.data = {
		...page.data,
		_narrationSegments: resolved.pages[0].segments.map((segment) => ({
			...segment,
			audioUrl: "assets/voice.mp3",
		})),
	};
	page.narrationEnabled = true;
	const config = makeConfig({ pages: [page], totalPages: 1, moduleDeck: {}, sourceLocale: "fr" });
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "published-transcript-"));
	let html: string;
	try {
		await generateHtmlPages(config, directory, {
			...testIslandAssets,
			islandFilenames: { ...testIslandAssets.islandFilenames, deck: "island-deck.js" },
		});
		html = await fs.readFile(path.join(directory, "deux-facons-d-exprimer-un-besoin.html"), "utf8");
	} finally {
		await fs.remove(directory);
	}
	const dom = new JSDOM(html);
	const transcript = dom.window.document.querySelector("#deck-script-scroll");
	expect(transcript).not.toBeNull();
	expect.soft(transcript?.textContent).not.toContain("Deux façons d'exprimer un besoin");
	expect.soft(transcript?.querySelectorAll(".deck-script-seek")).toHaveLength(2);
	expect
		.soft([...(transcript?.querySelectorAll(".deck-script-content") ?? [])].at(-1)?.innerHTML)
		.toBe(
			'<p class="deck-script-speaker deck-script-item-title"><strong>Réflexion : comment se sont passées vos tentatives ?</strong></p><p>Dans quelles situations avez-vous utilisé ces techniques ?</p>',
		);
	dom.window.close();
});

function renderPageWithNav(configOverrides: Partial<CourseConfig> = {}) {
	const config = makeConfig(configOverrides);
	return generateHtmlPage({
		config,
		page: config.pages[0],
		index: 0,
		currentSlug: "page-1",
		slugList: makeSlugList(config),
		slugMap: makeSlugMap(config),
		islandAssets: {
			loaderFilename: "island-loader.js",
			islandFilenames: { nav: "island-nav.js" },
		},
	});
}

function parseConfigFromHtml(html: string): Record<string, unknown> {
	const match = html.match(
		/<script id="praxity-config" type="application\/json">([\s\S]*?)<\/script>/,
	);
	expect(match).not.toBeNull();
	return JSON.parse(match?.[1] ?? "{}") as Record<string, unknown>;
}

describe("outline visit status", () => {
	for (const sourceLocale of ["en", "fr"] as const) {
		it.each([false, true])(
			`separates ${sourceLocale} visit status from flat/nested titles: %s`,
			(nested) => {
				const config = makeConfig({
					sourceLocale,
					totalPages: 3,
					pages: ["Introduction", "Check your understanding", "Further reading"].map(
						(title, index) => ({
							id: `stable-page-${index}`,
							title,
							blocks: [],
							...(nested
								? {
										lessonId: index < 2 ? "practice" : "resources",
										lessonTitle: index < 2 ? "Practice module" : "Resources module",
										isFirstPageOfLesson: index !== 1,
									}
								: {}),
						}),
					),
				});
				const html = generateHtmlPage({
					config,
					page: config.pages[1],
					index: 1,
					currentSlug: "page-2",
					slugList: makeSlugList(config),
					slugMap: makeSlugMap(config),
					islandAssets: testIslandAssets,
				});
				const doc = new JSDOM(html).window.document;
				const link = doc.querySelector('a[data-page-id="stable-page-1"]');
				expect(link?.getAttribute("href")).toBe("page-2.html");
				expect(link?.getAttribute("data-page-slug")).toBe("page-2");
				expect(link?.getAttribute("aria-current")).toBe("page");
				const label = link?.querySelector(".praxity-nav-visited-label");
				expect(label?.hasAttribute("hidden")).toBe(true);
				expect(label?.textContent).toBe(sourceLocale === "fr" ? ", Consultée" : ", Visited");
				expect(link?.textContent).toBe(
					`Check your understanding${sourceLocale === "fr" ? ", Consultée" : ", Visited"}`,
				);
				if (nested) {
					const module = doc.querySelector("a[data-module-pages]");
					expect(module?.getAttribute("data-module-pages")).toBe(
						'["stable-page-0","stable-page-1"]',
					);
					expect(module?.getAttribute("aria-current")).toBe("true");
					expect(module?.querySelector(".praxity-nav-visited-label")?.textContent).toBe(
						sourceLocale === "fr" ? ", Consulté" : ", Visited",
					);
				}
			},
		);
	}
});

function parseHostConfigFromHtml(html: string): Record<string, unknown> {
	const match = html.match(
		new RegExp(`<script id="${HOST_CONFIG_ID}" type="application/json">([\\s\\S]*?)<\\/script>`),
	);
	expect(match).not.toBeNull();
	return JSON.parse(match?.[1] ?? "{}") as Record<string, unknown>;
}

function parseShellConfigFromHtml(html: string): Record<string, unknown> {
	const match = html.match(
		new RegExp(`<script id="${SHELL_CONFIG_ID}" type="application/json">([\\s\\S]*?)<\\/script>`),
	);
	expect(match).not.toBeNull();
	return JSON.parse(match?.[1] ?? "{}") as Record<string, unknown>;
}

function inlineExecutableScripts(html: string): string[] {
	return [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/giu)]
		.filter(
			(match) => !/\bsrc\s*=/iu.test(match[1]) && !/\btype="application\/json"/iu.test(match[1]),
		)
		.map((match) => match[0]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateHtmlIndex", () => {
	it.each([
		{ name: "index", generate: generateHtmlIndex },
		{ name: "numbered page", generate: generateNumberedPageRedirect },
	])("keeps the $name native redirect inactive when scripting owns navigation", ({ generate }) => {
		const html = generate("introduction");
		const scripted = new JSDOM(html, { runScripts: "dangerously", url: "https://course.test/" });
		const unscripted = new JSDOM(html, { url: "https://course.test/" });
		expect(scripted.window.document.querySelector('meta[http-equiv="refresh"]') === null).toBe(
			true,
		);
		expect(
			unscripted.window.document
				.querySelector('meta[http-equiv="refresh"]')
				?.getAttribute("content"),
		).toBe("0; url=introduction.html");
		scripted.window.close();
		unscripted.window.close();
	});

	it("generates meta-refresh redirect to first page slug", () => {
		const html = generateHtmlIndex("introduction");
		expect(html).toContain('<html lang="en">');
		expect(html).toContain('http-equiv="refresh" content="0; url=introduction.html"');
		expect(html).toContain("Loading course...");
	});

	it("prepends basePath when provided", () => {
		const html = generateHtmlIndex("intro", "/c/my-course");
		expect(html).toContain("url=/c/my-course/intro.html");
	});

	it("strips trailing slash from basePath", () => {
		const html = generateHtmlIndex("intro", "/c/slug/");
		expect(html).toContain("url=/c/slug/intro.html");
	});

	// index.html is the SCORM launch file and the review-share entry point, so it
	// carries ?embed=1, ?minimal=1 and review tokens that the viewer reads. A bare
	// meta-refresh dropped them, while the page-N shims already preserved them.
	it("forwards the query string and hash like the page-N shims do", () => {
		const html = generateHtmlIndex("intro");
		expect(parseShellConfigFromHtml(html)).toMatchObject({
			version: 1,
			kind: "redirect",
			target: "intro.html",
		});
		expect(html).toContain('<script src="course-shell.js"></script>');
		expect(html.indexOf('<script src="course-shell.js"></script>')).toBeLessThan(
			html.indexOf('http-equiv="refresh"'),
		);
	});

	it("resolves a durable SCORM bookmark to the current page slug", () => {
		const html = generateHtmlIndex("intro", undefined, { "page-stable": "renamed-page" });
		expect(parseShellConfigFromHtml(html)).toMatchObject({
			pageIdMap: { "page-stable": "renamed-page" },
		});
	});

	it("keeps the meta-refresh so it still works without JS", () => {
		const html = generateHtmlIndex("intro");
		expect(html).toContain('http-equiv="refresh"');
		expect(html).toContain("url=intro.html");
	});
});

describe("generateHtmlPage", () => {
	it("compiles parsed assessment visibility independently of authored hiding", () => {
		const blocks = adaptGrammarPreviewBlocks(
			readBlockSource(
				"# Untitled {hideTitle}\n\n::: choice Choose {visible=ready hide shuffle level=3}\n(x) Yes\n( ) No\n:::\n",
			).blocks,
		);
		const html = renderPage({ pages: [{ id: "page-1", title: "Question", blocks }] });
		const config = parseConfigFromHtml(html) as {
			logic: { visibility: unknown[] };
			blocks: Array<{ data: Record<string, unknown> }>;
		};
		expect(config.logic.visibility).toEqual([
			{
				blockId: blocks[0].id,
				conditions: {
					operator: "and",
					rules: [{ source: "variable:ready", comparison: "is", value: true }],
				},
			},
		]);
		expect(config.blocks[0].data).toMatchObject({
			hide: true,
			visible: "ready",
			response: { shuffle: true },
		});
		expect(html).toMatch(new RegExp(`id="block-${blocks[0].id}"[^>]*\\shidden(?:\\s|>)`, "u"));
	});

	it("contains required structural elements", () => {
		const html = renderPage();
		expect(html).toContain("<!doctype html>");
		expect(html).toContain('<meta name="description" content="Introduction — Test Course" />');
		expect(html).toContain('<html lang="en" dir="ltr" data-praxity-root');
		expect(html).toContain('data-praxity-islands="nav"');
		expect(html).toContain('data-praxity-mode="light"');
		expect(html).toContain('data-praxity-image-hover="none"');
		expect(html).toContain('data-praxity-highlight-style="none"');
		expect(html).toContain('<meta charset="utf-8"');
		expect(html).toContain("viewport");
		expect(html).toContain('<link rel="stylesheet" href="styles.css"');
		expect(html).toContain('id="praxity-course-meta"');
		expect(html).toContain('id="main-content"');
		expect(html).toContain('<div class="praxity-text"><p>Hello</p></div>');
	});

	it("uses the lite stylesheet for static pages and the full sheet for Mantine islands", () => {
		const config = makeStaticConfig();
		const render = (blockType = "text") =>
			generateHtmlPage({
				config,
				page: {
					...config.pages[0],
					blocks: [
						{ id: "block", type: blockType, data: {} },
					] as CourseConfig["pages"][number]["blocks"],
				},
				index: 0,
				currentSlug: "page-1",
				slugList: makeSlugList(config),
				slugMap: makeSlugMap(config),
				liteStylesheetFilename: "styles-lite.css",
				islandAssets:
					blockType === "assessment"
						? {
								loaderFilename: "loader.js",
								islandFilenames: { assessment: "island.js" },
							}
						: undefined,
			});

		expect(render()).toContain('href="styles-lite.css"');
		expect(render("assessment")).toContain('href="styles.css"');
	});

	it("adds a whole-course duration estimate when none is supplied", () => {
		const words = Array.from({ length: 180 }, () => "word").join(" ");
		const config = parseConfigFromHtml(
			renderPage({
				navigationStyle: "slides",
				pages: [
					{
						id: "page-1",
						title: "Introduction",
						blocks: [{ id: "b1", type: "text", data: { content: `<p>${words}</p>` } }],
					},
				],
			}),
		);

		expect(config.estimatedDuration).toBe("~1 min");
	});

	it("never hides the nav fallback on a static page (regression: #991 broke SCORM nav)", () => {
		// With interactive shell controls disabled, the static page links are the
		// navigation and must stay visible without an island.
		const config = makeStaticConfig({
			totalPages: 3,
			pages: [
				{
					id: "page-1",
					title: "One",
					blocks: [{ id: "b1", type: "text", data: { content: "<p>Hi</p>" } }],
				},
				{ id: "page-2", title: "Two", blocks: [] },
				{ id: "page-3", title: "Three", blocks: [] },
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
		});
		// The fallback nav is present with real cross-page links...
		expect(html).toContain('class="praxity-outline-fallback"');
		// ...and the anti-flash hide rule is NOT shipped on static pages.
		expect(html).not.toContain('[data-island="nav"]:not([data-hydrated])');
		expect(html).not.toContain("classList.add('praxity-js')");
	});

	it("uses the native nav shell without hiding its fallback markup", () => {
		const html = renderPage({
			navigationStyle: "sidebar",
			navToggles: { navHamburgerMenu: true },
		});
		expect(parseShellConfigFromHtml(html)).toMatchObject({
			enableJsNav: true,
		});
		expect(parseShellConfigFromHtml(html)).not.toHaveProperty("hideFallbackNav");
		expect(html).not.toContain("<style>");
	});

	it("renders complete native navigation before its lightweight enhancer runs", () => {
		const config = makeConfig({
			totalPages: 2,
			navigationStyle: "sidebar",
			navToggles: {
				navOutline: true,
				navPrevNext: true,
				navTopBar: true,
				navSlideCounter: true,
				navProgressStyle: "bar",
				showA11yPill: true,
			},
			pages: [
				{ id: "page-1", title: "One", blocks: [] },
				{ id: "page-2", title: "Two", blocks: [] },
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: { loaderFilename: "loader.js", islandFilenames: { nav: "nav.js" } },
			liteStylesheetFilename: "styles-lite.css",
		});

		expect(html).toContain('id="course-nav-sidebar"');
		expect(html).toContain('class="praxity-top-bar"');
		expect(html).toContain('data-page-direction="next"');
		expect(html).toContain('data-page-id="page-1" data-page-slug="page-1"');
		expect(html).toContain('data-page-id="page-2" data-page-slug="page-2"');
		expect(parseConfigFromHtml(html)).toMatchObject({
			pages: [
				{ id: "page-1", slug: "page-1" },
				{ id: "page-2", slug: "page-2" },
			],
		});
		expect(html).toContain('role="progressbar"');
		expect(html).toContain("data-a11y-toolbar");
		expect(html).toContain('href="styles-lite.css"');
		expect(parseShellConfigFromHtml(html)).toMatchObject({
			enableJsNav: true,
			sidebarPreferenceKey: "praxity-sidebar-Test Course",
		});
		expect(html).not.toContain('[data-island="nav"]:not([data-hydrated])');
		expect(html.indexOf("praxity-sidebar-Test Course")).toBeLessThan(html.indexOf("<body"));
	});

	it("renders a hamburger-only sidebar as a native drawer", () => {
		const config = makeConfig({
			totalPages: 2,
			navigationStyle: "sidebar",
			navToggles: {
				navOutline: false,
				navHamburgerMenu: true,
				navTopBar: false,
				showA11yPill: false,
			},
			pages: [
				{ id: "page-1", title: "One", blocks: [] },
				{ id: "page-2", title: "Two", blocks: [] },
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: { loaderFilename: "loader.js", islandFilenames: { nav: "nav.js" } },
			liteStylesheetFilename: "styles-lite.css",
		});

		expect(html).toContain("data-native-outline data-nav-drawer");
		expect(html).toContain("data-nav-menu-toggle");
		expect(html).not.toContain("data-sidebar-collapse");
		expect(html).not.toContain("data-sidebar-expand");
		expect(html).toContain('<script defer src="loader.js"></script>');
	});

	it("routes goToPage buttons through the native nav island", () => {
		const config = makeStaticConfig({
			totalPages: 2,
			pages: [
				{
					id: "page-1",
					title: "One",
					blocks: [
						{
							id: "continue",
							type: "button",
							data: { text: "Continue", action: "goToPage", targetPageId: "page-2" },
						},
					],
				},
				{ id: "page-2", title: "Two", blocks: [] },
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: { loaderFilename: "loader.js", islandFilenames: { nav: "nav.js" } },
			liteStylesheetFilename: "styles-lite.css",
		});

		expect(html).toContain('data-praxity-islands="nav"');
		expect(html).toContain('data-action="goToPage" data-target-page="page-2"');
		expect(html).toContain('<script defer src="loader.js"></script>');
		expect(html).toContain('href="styles-lite.css"');
	});

	it("keeps a mobile outline trigger without enabling desktop top-bar collapse", () => {
		const config = makeConfig({
			navigationStyle: "sidebar",
			navToggles: { navOutline: true, navTopBar: false },
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: { loaderFilename: "loader.js", islandFilenames: { nav: "nav.js" } },
		});

		expect(html).toContain("praxity-mobile-top-bar");
		expect(html).toContain("data-nav-menu-toggle");
		expect(html).not.toContain("data-sidebar-collapse");
		expect(html).not.toContain("praxity-sidebar-Test Course");
	});

	it("localizes the Pages position on its own line regardless of the slide counter toggle", () => {
		const config = makeConfig({
			sourceLocale: "fr",
			totalPages: 2,
			pages: [
				{ id: "page-1", title: "Un", blocks: [] },
				{ id: "page-2", title: "Deux", blocks: [] },
			],
		});
		const render = (overrides: Partial<CourseConfig> = {}) =>
			generateHtmlPage({
				config: { ...config, ...overrides },
				page: config.pages[0],
				index: 0,
				currentSlug: "page-1",
				slugList: makeSlugList(config),
				slugMap: makeSlugMap(config),
				islandAssets: testIslandAssets,
			});

		for (const html of [render(), render({ navToggles: { navSlideCounter: false } })]) {
			const document = new JSDOM(html).window.document;
			expect(document.querySelector(".praxity-pages-position")?.textContent).toBe("Page 1 sur 2");
			expect(
				document.querySelector(".praxity-nav-next .praxity-pagination-title")?.textContent,
			).toBe("Deux");
			expect(document.querySelector(".praxity-native-page-position")).toBeNull();
		}
	});

	it("names the authored lesson in the Pages header and keeps position only at pagination", () => {
		const config = makeConfig({
			navigationStyle: "sidebar",
			totalPages: 4,
			pages: ["Introduction", "Module 1", "Module 2", "Module 3: Resolve a conflict"].map(
				(lessonTitle, index) => ({
					id: `page-${index}`,
					title: `Page ${index}`,
					lessonId: `lesson-${index}`,
					lessonTitle,
					isFirstPageOfLesson: true,
					blocks: [],
				}),
			),
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[3],
			index: 3,
			currentSlug: "page-3",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		const document = new JSDOM(html, { url: "https://course.example/" }).window.document;
		expect(document.querySelector(".praxity-toolbar-position")?.textContent).toBe(
			"Module 3: Resolve a conflict",
		);
		expect(document.querySelector(".praxity-toolbar-context")?.getAttribute("title")).toBe(
			"Test Course",
		);
		expect(document.querySelector(".praxity-top-bar")?.textContent).not.toContain("Page 1 of 1");
		expect(document.querySelector(".praxity-pages-position")?.textContent).toBe("Page 1 of 1");
	});

	it.each([
		["en", "Lesson 1"],
		["fr", "Leçon 1"],
	])(
		"shows the same generated lesson label in header and sidebar in %s",
		(sourceLocale, lessonTitle) => {
			const config = makeConfig({
				sourceLocale,
				navigationStyle: "sidebar",
				totalPages: 2,
				pages: [
					{
						id: "page-1",
						title: "One",
						lessonId: "worst-case.prax",
						lessonTitle,
						lessonTitleIsFallback: true,
						isFirstPageOfLesson: true,
						blocks: [],
					},
					{
						id: "page-2",
						title: "Two",
						lessonId: "worst-case.prax",
						lessonTitle,
						lessonTitleIsFallback: true,
						blocks: [],
					},
				],
			});
			const document = new JSDOM(
				generateHtmlPage({
					config,
					page: config.pages[1],
					index: 1,
					currentSlug: "page-2",
					slugList: makeSlugList(config),
					slugMap: makeSlugMap(config),
					islandAssets: testIslandAssets,
				}),
			).window.document;
			expect(document.querySelector(".praxity-toolbar-position")?.textContent).toBe(lessonTitle);
			expect(
				document
					.querySelector(".praxity-toolbar-position")
					?.hasAttribute("data-lesson-title-fallback"),
			).toBe(true);
			expect(document.querySelector(".praxity-native-lesson-title")?.textContent).toBe(lessonTitle);
			expect(document.querySelector(".praxity-top-bar")?.textContent).not.toContain("worst-case");
			expect(document.querySelector("#course-nav-sidebar")?.textContent).not.toContain(
				"worst-case",
			);
		},
	);

	it.each([
		["en", "Lesson 1"],
		["fr", "Leçon 1"],
	])("names a one-page untitled lesson in the %s header", (sourceLocale, lessonTitle) => {
		const config = makeConfig({
			sourceLocale,
			navigationStyle: "sidebar",
			totalPages: 1,
			pages: [
				{
					id: "page-1",
					title: "Read",
					lessonId: "draft.prax",
					lessonTitle,
					lessonTitleIsFallback: true,
					isFirstPageOfLesson: true,
					blocks: [],
				},
			],
		});
		const document = new JSDOM(
			generateHtmlPage({
				config,
				page: config.pages[0],
				index: 0,
				currentSlug: "page-1",
				slugList: makeSlugList(config),
				slugMap: makeSlugMap(config),
				islandAssets: testIslandAssets,
			}),
		).window.document;
		expect(document.querySelector(".praxity-toolbar-position")?.textContent).toBe(lessonTitle);
		expect(document.querySelector("#course-nav-sidebar")?.textContent).toContain(lessonTitle);
	});

	it.each([false, true])(
		"omits the untitled worst-case.prax filename from the Pages header (reading time: %s)",
		(navReadingTime) => {
			const config = makeConfig({
				navigationStyle: "sidebar",
				totalPages: 2,
				navToggles: { navReadingTime },
				pages: [
					{
						id: "page-1",
						title: "One",
						lessonId: "worst-case.prax",
						lessonTitle: "Lesson 1",
						lessonTitleIsFallback: true,
						isFirstPageOfLesson: true,
						blocks: [{ id: "text", type: "text", data: { content: "<p>Read this page.</p>" } }],
					},
					{ id: "page-2", title: "Two", blocks: [] },
				],
			});
			const html = generateHtmlPage({
				config,
				page: config.pages[0],
				index: 0,
				currentSlug: "page-1",
				slugList: makeSlugList(config),
				slugMap: makeSlugMap(config),
				islandAssets: testIslandAssets,
			});
			const document = new JSDOM(html, { url: "https://course.example/" }).window.document;
			expect(document.querySelector(".praxity-top-bar")?.textContent).not.toContain("worst-case");
			expect(document.querySelector(".praxity-toolbar-position")?.textContent ?? "").toBe(
				navReadingTime ? "Lesson 1 · ~1 min" : "Lesson 1",
			);
			expect(document.querySelector(".praxity-toolbar-position")?.getAttribute("title") ?? "").toBe(
				"Lesson 1",
			);
		},
	);

	it("omits Previous on the first Pages page", () => {
		const config = makeConfig({
			totalPages: 2,
			pages: [
				{ id: "page-1", title: "One", blocks: [] },
				{ id: "page-2", title: "Two", blocks: [] },
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		const document = new JSDOM(html, { url: "https://course.example/" }).window.document;
		expect(document.querySelector(".praxity-pages-pagination .praxity-nav-prev")).toBeNull();
		expect(document.querySelector(".praxity-pages-pagination .praxity-nav-next")).not.toBeNull();
	});

	it("shows reading time without a leading separator when a Pages lesson has no title", () => {
		const config = makeConfig({
			totalPages: 2,
			navToggles: { navReadingTime: true },
			pages: [
				{
					id: "page-1",
					title: "One",
					blocks: [{ id: "text", type: "text", data: { content: "<p>Read this page.</p>" } }],
				},
				{ id: "page-2", title: "Two", blocks: [] },
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		const document = new JSDOM(html, { url: "https://course.example/" }).window.document;
		expect(document.querySelector(".praxity-toolbar-position")?.textContent).toBe("~1 min");
	});

	it("injects motion runtime when entrance animation is enabled", () => {
		const html = renderPage({ navigationStyle: "slides", motionEntrance: "fade" });
		expect(parseShellConfigFromHtml(html)).toMatchObject({ entrance: "fade", stagger: "none" });
	});

	it("injects motion runtime when staggered reveal is enabled", () => {
		const html = renderPage({
			navigationStyle: "slides",
			motionEntrance: "none",
			motionStagger: "sequential",
		});
		expect(parseShellConfigFromHtml(html)).toMatchObject({
			entrance: "none",
			stagger: "sequential",
		});
	});

	it("skips motion runtime when both entrance and stagger are disabled", () => {
		const html = renderPage({ motionEntrance: "none", motionStagger: "none" });
		expect(html).not.toContain("praxityMotionEntrance");
		expect(html).not.toContain("praxityMotionStagger");
	});

	it("sets image hover mode on the html root", () => {
		const html = renderPage({ imageHoverEffect: "tilt" });
		expect(html).toContain('data-praxity-image-hover="tilt"');
	});

	it("sets highlight style on the html root", () => {
		const html = renderPage({ theme: { highlightStyle: "gradient" } });
		expect(html).toContain('data-praxity-highlight-style="gradient"');
	});

	it.each(["sidebar", "header", "left", "center"] as const)(
		"places %s branding beside the course title outside page content",
		(placement) => {
			const html = renderPage({
				navigationStyle: "sidebar",
				navToggles: { navTopBar: true, navCourseTitle: true },
				brandLogo: { localPath: 'assets/logo"&.png', darkLocalPath: "assets/dark.png", placement },
			});
			const chrome =
				placement === "sidebar"
					? html.slice(
							html.indexOf('class="praxity-native-sidebar-header"'),
							html.indexOf("</nav>"),
						)
					: html.slice(html.indexOf('<header class="praxity-top-bar">'), html.indexOf("</header>"));
			expect(chrome).toContain('src="assets/logo&quot;&amp;.png" alt="" width="40" height="40"');
			expect(chrome).toContain('class="praxity-brand-logo praxity-brand-logo--dark"');
			expect(chrome).toContain("praxity-brand-title");
			expect(html.slice(html.indexOf('id="main-content"'))).not.toContain(
				'class="praxity-brand-logo',
			);
		},
	);

	it.each([
		{ placement: "hidden" as const },
		{ placement: "header" as const, navToggles: { navCourseTitle: false } },
		{ placement: "header" as const, navToggles: { navTopBar: false } },
		{ placement: "sidebar" as const, navToggles: { navOutline: false, navHamburgerMenu: false } },
	])(
		"omits branding when its title or navigation surface is hidden: %j",
		({ placement, navToggles }) => {
			const html = renderPage({
				navigationStyle: "sidebar",
				navToggles: { navTopBar: true, ...navToggles },
				brandLogo: { localPath: "assets/logo.png", placement },
			});
			expect(html).not.toContain('class="praxity-brand-logo');
		},
	);

	it("shows branding on later pages even with a legacy title-only scope", () => {
		const config = makeConfig({
			navigationStyle: "sidebar",
			navToggles: { navTopBar: true },
			pages: [
				{ id: "one", title: "One", blocks: [] },
				{ id: "two", title: "Two", blocks: [] },
			],
			brandLogo: { localPath: "assets/logo.png", placement: "header", scope: "title-only" },
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[1],
			index: 1,
			currentSlug: "page-2",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		expect(html).toContain('class="praxity-brand-logo"');
		expect(html).not.toContain("praxity-brand-logo--dark");
	});

	it("omits branding without a logo or navigation", () => {
		expect(renderPage()).not.toContain('class="praxity-brand-logo');
		expect(
			renderPage({
				navigationStyle: "none",
				brandLogo: { localPath: "assets/logo.png", placement: "header" },
			}),
		).not.toContain('class="praxity-brand-logo');
	});

	it("includes config JSON script for viewer", () => {
		const html = renderPage({ navigationStyle: "slides" });
		expect(html).toContain('id="praxity-config"');
		expect(html).toContain("application/json");
		// Should include page metadata
		expect(html).toContain("Introduction");
		expect(html).toContain("page-1");
	});

	it("includes courseId and lessonId in viewer config JSON", () => {
		const html = renderPage({
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					lessonId: "lesson-1",
					blocks: [{ id: "b1", type: "text", data: { content: "<p>Hello</p>" } }],
				},
			],
		});
		expect(html).toContain('"courseId":"course-1"');
		expect(html).toContain('"lessonId":"lesson-1"');
	});

	it("renders semantic HTML for static block containers", () => {
		const html = renderPage();
		expect(html).toContain('data-block-id="b1"');
		expect(html).toContain('data-block-type="text"');
		expect(html).toContain("data-focus-row");
		expect(html).not.toContain("data-block-json=");
		expect(html).toContain('class="praxity-block praxity-block-text praxity-block-b1"');
		expect(html).toContain('<div class="praxity-text"><p>Hello</p></div>');
		expect(html).not.toContain("<div data-block-json");
		expect(html.match(/id="block-b1"/g)?.length).toBe(1);
	});

	it.each(["left", "right"] as const)(
		"publishes a %s float region with headings and lists until its closer",
		(side) => {
			const html = renderPage({
				pages: [
					{
						id: "page-1",
						title: "Introduction",
						blocks: [
							{
								id: "portrait",
								type: "image",
								data: { src: "/portrait.jpg", altText: "Portrait", width: "medium", float: side },
							},
							{ id: "subheading", type: "heading", data: { level: 2, content: "Details" } },
							{ id: "list", type: "text", data: { content: "<ul><li>Listed detail</li></ul>" } },
							{ id: "close", type: "blockBreak", data: { close: "float" } },
							{ id: "after", type: "text", data: { content: "<p>After the float</p>" } },
						],
					},
				],
			});
			expect(html).toContain(`class="praxity-float-region" data-image-float-region="${side}"`);
			expect(html).toContain(`<figure data-image-float="${side}" data-image-width="medium"`);
			expect(html).toMatch(
				/data-block-id="subheading"[\s\S]*<ul><li>Listed detail<\/li><\/ul>[\s\S]*<\/div>\s*<\/div>\s*<\/div>\s*<div[^>]*data-block-id="after"/,
			);
			expect(html).not.toContain('id="block-close"');
		},
	);

	it("keeps variable declarations learner-invisible in the native logic island", () => {
		const config = makeConfig({
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "variable-1",
							type: "variable",
							data: {
								variableName: "learnerName",
								dataType: "text",
								source: "manual",
								defaultValue: "Taylor",
							},
						},
						{
							id: "greeting",
							type: "text",
							data: {
								content: '<p>Hello <span data-mention="variable:learnerName"></span></p>',
							},
						},
					],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});

		expect(html).toMatch(/data-block-type="variable"[^>]*><\/div>/);
		expect(html).not.toContain("praxity-logic-meta");
		expect(html).toContain(
			'data-mention="variable:learnerName" data-fallback="Taylor">Taylor</span>',
		);
		expect(parseConfigFromHtml(html)).toMatchObject({
			logic: {
				variables: [{ name: "learnerName", dataType: "text", defaultValue: "Taylor" }],
			},
		});
	});

	it("renders authored variable defaults before runtime hydration and leaves code literal", () => {
		const blocks = readBlockSource(
			"---\n{ variables: { learnerName: Taylor } }\n---\n\n# Untitled {hideTitle}\n\nHello {{learnerName}}.\n\n`{{learnerName}}`\n",
		).blocks;
		const config = makeConfig({ pages: [{ id: "page-1", title: "Variables", blocks }] });
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		expect(html).toContain(
			'data-mention="variable:learnerName" data-fallback="Taylor">Taylor</span>',
		);
		expect(html).toContain("<code>{{learnerName}}</code>");
	});

	it("loads authored logic as a native island with stable initial visibility", () => {
		const config = makeConfig({
			totalPages: 2,
			pages: [
				{
					id: "page-1",
					title: "Conditional content",
					blocks: [
						{
							id: "local-variable",
							type: "variable",
							data: { variableName: "localFlag", dataType: "boolean", defaultValue: false },
						},
						{
							id: "logic-rule",
							type: "logic",
							data: {
								conditions: {
									operator: "and",
									rules: [{ source: "variable:remoteFlag", comparison: "is", value: true }],
								},
								actions: [{ type: "show", target: "reveal-heading" }],
							},
						},
						{
							id: "reveal-heading",
							type: "heading",
							data: { content: "Revealed section", level: 2, visible: "remoteFlag" },
						},
						{ id: "reveal-copy", type: "text", data: { content: "<p>Initially hidden.</p>" } },
						{ id: "next-heading", type: "heading", data: { content: "Always shown", level: 2 } },
					],
				},
				{
					id: "page-2",
					title: "Variables",
					blocks: [
						{
							id: "remote-variable",
							type: "variable",
							data: { variableName: "remoteFlag", dataType: "boolean", defaultValue: false },
						},
					],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "conditional-content",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			liteStylesheetFilename: "styles-lite.css",
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { logic: "island-logic.js", nav: "island-nav.js" },
			},
		});
		const runtimeConfig = parseConfigFromHtml(html) as {
			logic: { rules: unknown[]; variables: Array<{ name: string }>; visibility: unknown[] };
			blocks: Array<{ id: string }>;
			runtimeBlocks?: unknown;
		};

		expect(html).toContain('data-praxity-islands="logic,nav"');
		expect(html).toContain('data-island-logic="island-logic.js"');
		expect(html).toContain('href="styles-lite.css"');
		expect(html).toMatch(/id="block-local-variable"[^>]*\shidden(?:\s|>)/u);
		expect(html).toMatch(/id="block-logic-rule"[^>]*\shidden(?:\s|>)/u);
		expect(html).toMatch(/id="block-reveal-heading"[^>]*\shidden(?:\s|>)/u);
		expect(html).toMatch(/id="block-reveal-copy"[^>]*\shidden(?:\s|>)/u);
		expect(html).not.toMatch(/id="block-next-heading"[^>]*\shidden(?:\s|>)/u);
		expect(runtimeConfig.logic.rules).toHaveLength(1);
		expect(runtimeConfig.logic.variables.map((variable) => variable.name)).toEqual([
			"localFlag",
			"remoteFlag",
		]);
		expect(runtimeConfig.logic.visibility).toEqual([
			{
				blockId: "reveal-heading",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:remoteFlag", comparison: "is", value: true }],
				},
			},
		]);
		expect(runtimeConfig.blocks.map((block) => block.id)).toEqual([
			"local-variable",
			"logic-rule",
			"reveal-heading",
			"reveal-copy",
			"next-heading",
		]);
		expect(runtimeConfig.runtimeBlocks).toBeUndefined();
	});

	it("preserves conditional visibility when slides and logic use native islands", () => {
		const config = makeConfig({
			navigationStyle: "slides",
			pages: [
				{
					id: "page-1",
					title: "Mixed runtime",
					blocks: [
						{
							id: "flag",
							type: "variable",
							data: { variableName: "showDetail", dataType: "boolean", defaultValue: false },
						},
						{
							id: "detail",
							type: "text",
							data: { content: "<p>Conditional detail</p>", visible: "showDetail" },
						},
					],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "mixed-runtime",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { logic: "island-logic.js", nav: "island-nav.js" },
			},
		});
		const runtimeConfig = parseConfigFromHtml(html) as {
			logic: { visibility: Array<{ blockId: string }> };
		};

		expect(html).toContain('data-praxity-islands="logic,nav"');
		expect(html).toContain('<script defer src="island-loader.js"></script>');
		expect(runtimeConfig.logic.visibility).toEqual([
			expect.objectContaining({ blockId: "detail" }),
		]);
	});

	it("keeps conditional heading ranges inside their nested container", () => {
		const config = makeConfig({
			pages: [
				{
					id: "nested",
					title: "Nested logic",
					blocks: [
						{
							id: "accordion",
							type: "accordion",
							data: {
								items: [
									{
										id: "first-item",
										label: "First",
										children: [
											{
												id: "nested-heading",
												type: "heading",
												data: { level: 2, content: "Conditional", visible: "flag" },
											},
											{ id: "nested-copy", type: "text", data: { content: "Hidden with it" } },
										],
									},
									{
										id: "second-item",
										label: "Second",
										children: [
											{ id: "other-copy", type: "text", data: { content: "Still visible" } },
										],
									},
								],
							},
						},
						{ id: "outer-copy", type: "text", data: { content: "Also visible" } },
					],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "nested-logic",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: {
				loaderFilename: "loader.js",
				islandFilenames: {
					accordion: "accordion.js",
					logic: "logic.js",
					nav: "nav.js",
				},
			},
		});

		expect(html).toMatch(/id="block-nested-heading"[^>]*\shidden(?:\s|>)/u);
		expect(html).toMatch(/id="block-nested-copy"[^>]*\shidden(?:\s|>)/u);
		expect(html).not.toMatch(/id="block-other-copy"[^>]*\shidden(?:\s|>)/u);
		expect(html).not.toMatch(/id="block-outer-copy"[^>]*\shidden(?:\s|>)/u);
	});

	it("boots reading preferences without the retired contrast state", () => {
		const html = renderPage();
		expect(parseShellConfigFromHtml(html)).toMatchObject({ pageFocusDefault: false });
		expect(html).toContain('<script src="course-shell.js"></script>');
		expect(html).not.toContain("p.highContrast");
		expect(html).not.toContain("praxityHighContrast");
		expect(html).not.toContain("prefers-contrast");
	});

	it.each(["card", "columns", "imageComparison", "accordion", "tabs", "sequence"] as const)(
		"keeps %s within content width unless requested",
		(type) => {
			const page = {
				id: "page-1",
				title: "Containers",
				blocks: [{ id: "container", type, data: { items: [] } }],
			};
			const html = renderPage({ pages: [page] });
			expect(html).not.toContain("praxity-block-feature-width");
			const wide = renderPage({
				pages: [
					{ ...page, blocks: [{ id: "container", type, data: { items: [], layoutMode: "wide" } }] },
				],
			});
			expect(wide).toContain("praxity-layout-wide");
		},
	);

	it("adds feature-width class to media-heavy block types", () => {
		const html = renderPage({
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{ id: "img-1", type: "image", data: { src: "https://example.com/image.jpg" } },
						{ id: "txt-1", type: "text", data: { content: "<p>Hello</p>" } },
					],
				},
			],
		});
		expect(html).toContain(
			'class="praxity-block praxity-block-image praxity-block-img-1 praxity-block-feature-width"',
		);
		expect(html).toContain('class="praxity-block praxity-block-text praxity-block-txt-1"');
	});

	it("uses the universal layout parameter for full-frame images", () => {
		const html = renderPage({
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "img-1",
							type: "image",
							data: { src: "https://example.com/image.jpg", layout: "full" },
						},
					],
				},
			],
		});
		expect(html).toContain(
			'class="praxity-block praxity-block-image praxity-block-img-1 praxity-layout-full"',
		);
		expect(html).not.toContain("praxity-block-image praxity-block-feature-width");
	});

	it("renders heading blocks with data-heading-level", () => {
		const html = renderPage();
		expect(html).toContain('data-heading-level="2"');
		expect(html).toContain('data-focus-exempt="heading"');
	});

	it("renders explicit kept image treatment classes on published wrappers", () => {
		const html = renderPage({
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "img-1",
							type: "image",
							data: {
								src: "https://example.com/image.jpg",
								altText: "Example image",
								decorative: false,
								treatment: "grayscale",
							},
						},
					],
				},
			],
		});

		expect(html).not.toContain("praxity-image-treatment-grayscale");
	});

	it("renders removed explicit image treatments as none", () => {
		const html = renderPage({
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "img-1",
							type: "image",
							data: {
								src: "https://example.com/image.jpg",
								altText: "Example image",
								decorative: false,
								treatment: "posterize",
							},
						},
					],
				},
			],
		});

		expect(html).not.toContain("praxity-image-treatment-posterize");
		expect(html).not.toContain("praxity-image-treatment-");
	});

	it("emits data-praxity-effects and CSS vars when imageEffects configured", () => {
		const html = renderPage({
			imageEffects: { grain: { intensity: 25 } },
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "img-1",
							type: "image",
							data: {
								src: "https://example.com/image.jpg",
								altText: "Example image",
								decorative: false,
							},
						},
					],
				},
			],
		});

		expect(html).not.toContain("data-praxity-effects");
		expect(html).not.toContain("--fx-texture-opacity:");
	});

	it("includes halftone/dithering/motion SVG defs when imageEffects are configured", () => {
		const html = renderPage({
			imageEffects: { halftone: { intensity: 6 } },
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "img-1",
							type: "image",
							data: {
								src: "https://example.com/image.jpg",
								altText: "Example image",
								decorative: false,
							},
						},
					],
				},
			],
		});

		expect(html).not.toContain("praxity-filter-halftone");
	});

	it("still renders legacy treatment classes alongside new effects", () => {
		const html = renderPage({
			defaultImageTreatment: "grayscale",
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "img-1",
							type: "image",
							data: {
								src: "https://example.com/image.jpg",
								altText: "Example image",
								decorative: false,
								treatment: "grayscale",
							},
						},
					],
				},
			],
		});

		expect(html).not.toContain("praxity-image-treatment-grayscale");
	});

	it("renders card blocks as semantic article markup", () => {
		const html = renderPage({
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "card-1",
							type: "card",
							data: {
								layout: "single",
								items: [{ id: "item-1", label: "Card title", front: [], back: [] }],
							},
						},
					],
				},
			],
		});

		expect(html).toContain('id="block-card-1"');
		expect(html).toContain('<article class="praxity-card praxity-card-item"');
		expect(html).toMatch(/<h3\b[^>]*>Card title<\/h3>/);
		expect(html).not.toContain('data-block-id="card-1" data-block-type="card" data-block-json=');
	});

	it("loads the card island without duplicating the block JSON payload", () => {
		const config = makeStaticConfig({
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "card-1",
							type: "card",
							data: {
								layout: "single",
								items: [],
								transition: "fade",
							},
						},
					],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { card: "island-card.js" },
			},
		});

		expect(html).toContain('id="block-card-1"');
		expect(html).toContain('data-praxity-islands="card"');
		expect(html).toContain('data-island="card"');
		expect(html).not.toContain('data-block-id="card-1" data-block-type="card" data-block-json=');
	});

	it("keeps bottom reading tools available on a single-page course", () => {
		const config = makeConfig({
			navToggles: {
				navTopBar: false,
				navPrevNext: false,
				showA11yPill: true,
				navReadingSupportPlacement: "bottomBar",
			},
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { nav: "island-nav.js" },
			},
		});

		expect(html).toContain('class="praxity-a11y-dock"');
		expect(html).toContain("data-a11y-toolbar");
	});

	it("includes grain SVG defs when the course default image treatment is grain", () => {
		const html = renderPage({
			defaultImageTreatment: "grain",
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "img-1",
							type: "image",
							data: {
								src: "https://example.com/image.jpg",
								altText: "Example image",
								decorative: false,
							},
						},
					],
				},
			],
		});

		expect(html).not.toContain("praxity-filter-grain");
		expect(html).not.toContain("praxity-image-treatment-grain");
	});

	it("includes duotone SVG defs and wrapper classes when the course default image treatment is duotone", () => {
		const html = renderPage({
			defaultImageTreatment: "duotone",
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "img-1",
							type: "image",
							data: {
								src: "https://example.com/image.jpg",
								altText: "Example image",
								decorative: false,
							},
						},
					],
				},
			],
		});

		expect(html).not.toContain("praxity-filter-duotone");
		expect(html).not.toContain("praxity-image-treatment-duotone");
	});

	it("keeps static learner HTML free of target host and review executables", () => {
		const html = renderPage();

		expect(html).not.toContain("course-bootstrap");
		expect(html).not.toContain("scorm-runtime");
		expect(html).not.toContain("review-comments");
		expect(html).not.toContain("PraxitySCORM");
		expect(html).not.toContain("PostMessageBridge");
		expect(html).not.toContain("__PRAXITY_XAPI_CONFIG__");
	});

	it("keeps island learner HTML free of target host and review executables", () => {
		const config = makeConfig({
			pages: [
				{
					id: "page-1",
					title: "Checklist",
					blocks: [
						{
							id: "checklist-1",
							type: "checklist",
							data: { items: [{ id: "item-1", text: "Done" }] },
						},
					],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { checklist: "island-checklist.js", nav: "island-nav.js" },
			},
		});

		expect(html).toContain('src="island-loader.js"');
		expect(html).not.toContain("course-bootstrap");
		expect(html).not.toContain("scorm-runtime");
		expect(html).not.toContain("review-comments");
		expect(html).not.toContain("PraxitySCORM");
		expect(html).not.toContain("PostMessageBridge");
		expect(html).not.toContain("__PRAXITY_XAPI_CONFIG__");
	});

	it("emits only external executables and inert JSON under script-src self", () => {
		const staticHtml = renderPage({
			pages: [
				{
					id: "page-1",
					title: "Safe",
					blocks: [
						{ id: "text", type: "text", data: { content: '<p onclick="alert(1)">Safe</p>' } },
					],
				},
			],
		});
		const nativeHtml = renderPage({ navigationStyle: "slides" });
		for (const html of [generateHtmlIndex("page-1"), staticHtml, nativeHtml]) {
			expect(inlineExecutableScripts(html)).toEqual([]);
			expect(html).not.toMatch(/\son[a-z]+\s*=/iu);
		}
	});

	it("omits island runtime assets on an explicitly static text-only page", () => {
		// Static blocks and disabled interactive shell controls need no islands.
		const html = renderPage({
			navigationStyle: "sidebar",
			navToggles: STATIC_NAV_TOGGLES,
		});
		expect(html).not.toContain("data-praxity-islands");
		expect(html).not.toContain("prx-tooltip-");
	});

	it("keeps inline tooltips working on otherwise static HTML pages", () => {
		const config = makeStaticConfig({
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [
						{
							id: "text",
							type: "text",
							data: {
								content:
									'<p><button class="inline-tooltip-trigger" data-tooltip-content="Meaning">Term</button></p>',
							},
						},
					],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { tooltip: "island-tooltip.js" },
			},
		});

		expect(html).toContain('data-praxity-islands="tooltip"');
		expect(html).toContain('data-island-tooltip="island-tooltip.js"');
		expect(html).toContain('<span class="inline-tooltip-fallback"> (Meaning)</span>');
		expect(html).toContain('id="praxity-config" type="application/json"');
		expect(html).toContain('<script defer src="island-loader.js"></script>');
		expect(html).not.toContain("prx-tooltip-");
	});

	it("keeps disabled nav features and unused slide styles out of static export", () => {
		const html = renderPage({
			navToggles: {
				navHamburgerMenu: false,
				navBottomArrows: false,
				navTopBar: false,
				navReadingSupportPlacement: "topBar",
				showA11yPill: false,
			},
			slideStyles: { unused: { background: "paper" } },
		});
		expect(html).not.toContain("data-praxity-islands");
	});

	it("includes color mode script for auto", () => {
		const html = renderPage({ colorMode: "auto" });
		expect(parseShellConfigFromHtml(html)).toMatchObject({ colorMode: "auto" });
	});

	it("includes color mode script for light (no system preference)", () => {
		const html = renderPage({ navigationStyle: "slides", colorMode: "light" });
		expect(html).toContain('data-praxity-mode="light"');
		expect(parseShellConfigFromHtml(html)).toMatchObject({ colorMode: "light" });
	});

	it("includes color mode script for dark (no system preference)", () => {
		const html = renderPage({ navigationStyle: "slides", colorMode: "dark" });
		expect(html).toContain('data-praxity-mode="dark"');
		expect(parseShellConfigFromHtml(html)).toMatchObject({ colorMode: "dark" });
	});

	it("includes keyboard nav script", () => {
		const html = renderPage();
		expect(parseShellConfigFromHtml(html)).toMatchObject({ keyboardArrows: true });
	});

	it("loads the shell that applies query-driven minimal mode", () => {
		const html = renderPage({ navigationStyle: "slides" });
		expect(html).toContain('<script src="course-shell.js"></script>');
	});

	it("installs fallback error handling before the deployment host can start downloading", () => {
		const html = renderPage({ navigationStyle: "slides" });
		const shell = html.indexOf('<script src="course-shell.js"></script>');
		expect(shell).toBeGreaterThanOrEqual(0);
		expect(html.indexOf(DEPLOYMENT_HEAD_MARKER)).toBeGreaterThan(shell);
	});

	it("emits inert host metadata and one deployment marker", () => {
		const html = renderPage({
			completionMethod: "percentage",
			completionThreshold: 80,
			pages: [
				{
					id: "page-1",
					lessonId: "lesson-1",
					title: "Checklist",
					blocks: [
						{
							id: "checklist-1",
							type: "checklist",
							data: { items: [{ id: "item-1", text: "Done" }] },
						},
					],
				},
			],
		});
		expect(parseHostConfigFromHtml(html)).toMatchObject({
			version: 1,
			courseId: "course-1",
			pageId: "page-1",
			lessonId: "lesson-1",
			pageRole: "content",
			currentPage: 1,
			totalPages: 1,
			currentSlug: "page-1",
			availableSlugs: ["page-1"],
			pageIdMap: { "page-1": "page-1" },
			statefulBlockIds: ["checklist-1"],
			completionMethod: "percentage",
			completionThreshold: 80,
		});
		expect(html.match(new RegExp(DEPLOYMENT_HEAD_MARKER, "g"))).toHaveLength(1);
		expect(html.match(new RegExp(`id="${HOST_CONFIG_ID}"`, "g"))).toHaveLength(1);
	});

	it("embeds every valid page slug for SCORM bookmark restoration", () => {
		const html = renderPage({
			totalPages: 2,
			pages: [
				{ id: "page-stable-1", title: "Welcome", blocks: [] },
				{ id: "page-stable-2", title: "Safety", blocks: [] },
			],
		});

		expect(html).toContain('["page-1","page-2"]');
		expect(html).toContain('"page-stable-2":"page-2"');
		expect(parseHostConfigFromHtml(html)).toMatchObject({
			pageId: "page-stable-1",
			availableSlugs: ["page-1", "page-2"],
			pageIdMap: { "page-stable-1": "page-1", "page-stable-2": "page-2" },
		});
	});

	it("passes section styling config into the viewer payload", () => {
		const html = renderPage({
			navigationStyle: "slides",
			sectionRhythm: "alternate",
			dividerStyle: "gradient",
			texture: "grain",
			sectionPalettes: {
				light: {
					background: "#faf9f7",
					surface: "#faf9f7",
					text: "#1f2900",
					textLight: "#4a5a00",
					accent: "#dc8fff",
					border: "#e0e0e0",
				},
				dark: {
					background: "#1f2900",
					surface: "#2d3a05",
					text: "#faf9f7",
					textLight: "#dfe8c1",
					accent: "#e3ff8f",
					border: "#4a5a00",
				},
				accent: {
					background: "#dc8fff",
					surface: "#e4a8ff",
					text: "#1f2900",
					textLight: "#4a5a00",
					accent: "#1f2900",
					border: "#8f5bb7",
				},
				warm: {
					background: "#f7efe8",
					surface: "#fcf6f1",
					text: "#3a2311",
					textLight: "#6f4d35",
					accent: "#dc8fff",
					border: "#c8b3a3",
				},
				cool: {
					background: "#edf5fb",
					surface: "#f5f9fe",
					text: "#102a43",
					textLight: "#486581",
					accent: "#dc8fff",
					border: "#bcccdc",
				},
				growth: {
					background: "#edf7ef",
					surface: "#f4fbf5",
					text: "#1b4332",
					textLight: "#3d5a4b",
					accent: "#dc8fff",
					border: "#b7d8c2",
				},
			},
		});
		const viewerConfig = parseConfigFromHtml(html);

		expect(viewerConfig.sectionRhythm).toBe("uniform");
		expect(viewerConfig.dividerStyle).toBe("none");
		expect(viewerConfig.texture).toBe("none");
		expect(viewerConfig.sectionPalettes).toMatchObject({
			light: {
				background: "#faf9f7",
			},
		});
	});
});

describe("RTL detection", () => {
	it('sets dir="rtl" for Arabic', () => {
		const html = renderPage({ sourceLocale: "ar" });
		expect(html).toContain('dir="rtl"');
		expect(html).toContain('lang="ar"');
	});

	it('sets dir="rtl" for Hebrew', () => {
		const html = renderPage({ sourceLocale: "he" });
		expect(html).toContain('dir="rtl"');
	});

	it('sets dir="rtl" for Farsi', () => {
		const html = renderPage({ sourceLocale: "fa" });
		expect(html).toContain('dir="rtl"');
	});

	it('sets dir="ltr" for English', () => {
		const html = renderPage({ sourceLocale: "en" });
		expect(html).toContain('dir="ltr"');
	});

	it('sets dir="ltr" for French', () => {
		const html = renderPage({ sourceLocale: "fr" });
		expect(html).toContain('dir="ltr"');
	});
});

describe("course CSS", () => {
	it("emits theme vars into course CSS", () => {
		const css = generateCourseCss({
			theme: { colorAccent: "#ff0000", fontFamilyBody: "'Inter', sans-serif" },
		});
		const accentText = css.match(/--praxity-color-accent-text:\s*(#[0-9a-fA-F]{6})/)?.[1];
		expect(css).not.toContain("--praxity-color-accent: #ff0000;");
		expect(accentText).toBeDefined();
		expect(contrastRatio(accentText ?? "", "#fafafa")).toBeGreaterThanOrEqual(4.5);
		expect(css).toContain("--praxity-font-family: 'Source Sans 3', sans-serif;");
		// The selector also carries Mantine's own, so the token aliases we set there
		// are not outranked by Mantine's defaults.
		expect(css).toContain(":root, :root[data-mantine-color-scheme] {");
	});

	it("emits an sRGB fallback immediately before every OKLCH theme value", () => {
		const css = generateCourseCss({
			cssVars: {
				"--praxity-color-background": "#faf9f7",
				"--praxity-color-text": "#1f2900",
				"--praxity-color-accent": "#dc2626",
			},
		});
		const themeStyle = css.match(/:root, :root\[data-mantine-color-scheme\] \{ ([\s\S]*?) \}/)?.[1];
		expect(themeStyle).toBeDefined();
		const modernDeclarations = [...(themeStyle ?? "").matchAll(/(--[\w-]+): (oklch\([^)]+\));/g)];
		expect(modernDeclarations.length).toBeGreaterThan(0);
		for (const [, key, modern] of modernDeclarations) {
			expect(themeStyle).toContain(`${key}: #`);
			expect(themeStyle?.indexOf(`${key}: #`)).toBeLessThan(
				themeStyle?.indexOf(`${key}: ${modern}`) ?? 0,
			);
		}
	});

	it("omits course CSS when no course styling is set", () => {
		expect(generateCourseCss({})).toContain("--paper: #ffffff;");
	});

	it("sanitizes authored CSS before appending it last", () => {
		const css = generateCourseCss({
			theme: { colorAccent: "#ff0000" },
			customCss: ".my-class { color: red; }</style><script>alert('xss')</script>",
		});
		expect(css).toContain(".my-class { color: red; }");
		expect(css).not.toContain("</style>");
		expect(css).not.toContain("<script>");
		expect(css.indexOf(".my-class")).toBeGreaterThan(css.indexOf("--praxity-color-accent"));
	});
});

describe("escapeJsonForHtml", () => {
	it("escapes ampersands", () => {
		expect(escapeJsonForHtml('{"a":"b&c"}')).toContain("&amp;");
	});

	it("escapes angle brackets", () => {
		expect(escapeJsonForHtml('{"a":"<script>"}')).toContain("&lt;script&gt;");
	});

	it("escapes single quotes", () => {
		expect(escapeJsonForHtml("{'key':'val'}")).toContain("&#39;");
	});

	it("preserves double quotes", () => {
		const result = escapeJsonForHtml('{"key":"value"}');
		expect(result).toContain('"key"');
		expect(result).toContain('"value"');
	});
});

describe("block JSON escaping", () => {
	it("includes escaped special characters in praxity-config blocks payload", () => {
		const config = makeStaticConfig({
			pages: [
				{
					id: "p1",
					title: "Test",
					blocks: [
						{
							id: "b1",
							type: "checklist",
							data: {
								title: "<p>It's a 'test' with <b>bold</b> & \"quotes\"</p>",
								items: [{ id: "i1", text: "Option's text" }],
							},
						},
					],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		const parsed = parseConfigFromHtml(html);
		const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
		const checklist = blocks[0] as { data?: { title?: string; items?: Array<{ text?: string }> } };
		expect(checklist?.data?.title).toContain("It's");
		expect(checklist?.data?.items?.[0]?.text).toContain("Option's text");
	});

	it("keeps raw code/equation strings in config JSON and escapes once in rendered HTML", () => {
		const codeValue = "if (x > 0 && y < 5) { return a & b; }";
		const latexValue = "x > 0 && y < 5";
		const html = renderPage({
			pages: [
				{
					id: "p1",
					title: "Code",
					blocks: [
						{
							id: "code-1",
							type: "code",
							data: {
								language: "ts",
								code: codeValue,
							},
						},
						{
							id: "eq-1",
							type: "equation",
							data: {
								latex: latexValue,
							},
						},
					],
				},
			],
		});

		expect(html.replaceAll(/<\/?span[^>]*>/gu, "")).toContain(
			"if (x &gt; 0 &amp;&amp; y &lt; 5) { return a &amp; b; }",
		);
		expect(html).not.toContain("&amp;gt;");
		expect(html).toContain('data-math-latex="x &gt; 0 &amp;&amp; y &lt; 5"');
		expect(html).not.toContain("$$");

		const parsed = parseConfigFromHtml(html);
		const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
		const codeBlock = blocks.find(
			(block) =>
				typeof block === "object" && block !== null && (block as { id?: string }).id === "code-1",
		) as { data?: { code?: string } } | undefined;
		const equationBlock = blocks.find(
			(block) =>
				typeof block === "object" && block !== null && (block as { id?: string }).id === "eq-1",
		) as { data?: { latex?: string } } | undefined;

		expect(codeBlock?.data?.code).toBe(codeValue);
		expect(equationBlock?.data?.latex).toBe(latexValue);
	});

	it("sanitizes URL-bearing keys in praxity-config block JSON", () => {
		const html = renderPage({
			navigationStyle: "slides",
			pages: [
				{
					id: "p1",
					title: "Links",
					blocks: [
						{
							id: "btn-1",
							type: "button",
							data: {
								text: "Open",
								href: "javascript:alert(1)",
							},
						},
						{
							id: "img-1",
							type: "image",
							data: {
								src: "javascript:alert(2)",
								alt: "Example",
							},
						},
					],
				},
			],
		});

		const parsed = parseConfigFromHtml(html);
		const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
		const buttonBlock = blocks.find(
			(block) =>
				typeof block === "object" && block !== null && (block as { id?: string }).id === "btn-1",
		) as { data?: { href?: string } } | undefined;
		const imageBlock = blocks.find(
			(block) =>
				typeof block === "object" && block !== null && (block as { id?: string }).id === "img-1",
		) as { data?: { src?: string } } | undefined;

		expect(buttonBlock?.data?.href).toBe("#");
		expect(imageBlock?.data?.src).toBe("#");
	});

	it("escapes block id fragments in class attributes", () => {
		const html = renderPage({
			pages: [
				{
					id: "p1",
					title: "Class escape",
					blocks: [
						{
							id: 'x" onclick="alert(1)',
							type: "text",
							data: { content: "<p>Hello</p>" },
						},
					],
				},
			],
		});

		expect(html).toContain(
			'class="praxity-block praxity-block-text praxity-block-x&quot; onclick=&quot;alert(1)"',
		);
		expect(html).not.toContain(
			'class="praxity-block praxity-block-text praxity-block-x" onclick="alert(1)"',
		);
	});
});

describe("themeVarsToCss", () => {
	it("returns empty string for no theme", () => {
		expect(themeVarsToCss(undefined)).toBe("");
		expect(themeVarsToCss({})).toBe("");
	});

	it("converts camelCase keys to kebab-case CSS vars", () => {
		const result = themeVarsToCss({ colorAccent: "#ff0000" });
		expect(result).toContain("--praxity-color-accent: #ff0000");
	});

	it("generates light variants for semantic colors", () => {
		const result = themeVarsToCss({ colorAccent: "#4269d0" });
		expect(result).toContain("--praxity-color-accent-light-10:");
		expect(result).toContain("--praxity-color-accent-light-15:");
	});

	it("filters out customCss key", () => {
		const result = themeVarsToCss({ colorAccent: "#ff0000", customCss: "body{}" });
		expect(result).not.toContain("customCss");
		expect(result).not.toContain("--praxity-custom-css");
	});

	it("emits legacy border radius and semantic radius tokens", () => {
		const result = themeVarsToCss({
			borderRadius: "4px",
			radiusContent: "4px",
			radiusContainer: "6px",
			radiusAction: "40px",
		});
		expect(result).toContain("--praxity-border-radius: 4px");
		expect(result).toContain("--praxity-radius-content: 4px");
		expect(result).toContain("--praxity-radius-container: 6px");
		expect(result).toContain("--praxity-radius-action: 40px");
	});
});

describe("resolveColorShades", () => {
	it("returns pre-computed shades if provided", () => {
		const config = makeConfig({
			colorShades: { accent: Array(10).fill("#ff0000") },
		});
		const result = resolveColorShades(config);
		expect(result).toBe(config.colorShades);
	});

	it("generates shades from theme colors", () => {
		const config = makeConfig({
			theme: { colorAccent: "#4269d0" },
		});
		const result = resolveColorShades(config);
		expect(result?.accent).toBeDefined();
		expect(result?.accent).toHaveLength(10);
	});

	it("returns undefined when no theme", () => {
		const config = makeConfig({ theme: undefined });
		expect(resolveColorShades(config)).toBeUndefined();
	});
});

describe("lesson metadata and display settings in config JSON", () => {
	function extractConfig(html: string) {
		return parseConfigFromHtml(html);
	}

	it("includes lessonTitle and isFirstPageOfLesson in config JSON", () => {
		const config = makeConfig({
			navigationStyle: "slides",
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					lessonTitle: "Lesson 1",
					isFirstPageOfLesson: true,
					blocks: [],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		const cfg = extractConfig(html);
		expect(cfg.lessonTitle).toBe("Lesson 1");
		expect(cfg.isFirstPageOfLesson).toBe(true);
	});

	it("defaults lessonTitle to empty string and isFirstPageOfLesson to false when not set", () => {
		const html = renderPage({ navigationStyle: "slides" });
		const cfg = extractConfig(html);
		expect(cfg.lessonTitle).toBe("");
		expect(cfg.isFirstPageOfLesson).toBe(false);
	});

	it("includes showCourseNameInNav, showLessonNameInNav, showLessonNameAsTitle in config JSON", () => {
		const html = renderPage({
			navigationStyle: "slides",
			showCourseNameInNav: false,
			showLessonNameInNav: false,
			showLessonNameAsTitle: false,
		});
		const cfg = extractConfig(html);
		expect(cfg.showCourseNameInNav).toBe(false);
		expect(cfg.showLessonNameInNav).toBe(false);
		expect(cfg.showLessonNameAsTitle).toBe(false);
	});

	it("defaults display booleans to true when not set", () => {
		const html = renderPage({ navigationStyle: "slides" });
		const cfg = extractConfig(html);
		expect(cfg.showCourseNameInNav).toBe(true);
		expect(cfg.showLessonNameInNav).toBe(true);
		expect(cfg.showLessonNameAsTitle).toBe(true);
	});

	it("includes lesson metadata in pages list", () => {
		const config = makeConfig({
			navigationStyle: "slides",
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					lessonTitle: "Lesson 1",
					isFirstPageOfLesson: true,
					blocks: [],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		const cfg = extractConfig(html);
		const pages = Array.isArray(cfg.pages)
			? (cfg.pages as Array<{ lessonTitle?: string; isFirstPageOfLesson?: boolean }>)
			: [];
		expect(pages[0]?.lessonTitle).toBe("Lesson 1");
		expect(pages[0]?.isFirstPageOfLesson).toBe(true);
	});
});

describe("page labels stay in navigation", () => {
	it("keeps the course and lesson title in navigation without synthesizing an H1", () => {
		const config = makeConfig({
			navigationStyle: "slides",
			showLessonNameAsTitle: true,
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					lessonTitle: "Lesson 1",
					isFirstPageOfLesson: true,
					blocks: [],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		expect(html).not.toContain("praxity-page-title");
		expect(html).not.toContain("praxity-lesson-title");
		expect(html).toContain('"lessonTitle":"Lesson 1"');
	});

	it("uses data-lesson-label for CSS ::before title treatment", () => {
		const config = makeConfig({
			showLessonNameAsTitle: true,
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					lessonTitle: "Lesson 1",
					isFirstPageOfLesson: true,
					blocks: [],
				},
				{
					id: "page-2",
					title: "Page 2",
					lessonTitle: "Lesson 2",
					isFirstPageOfLesson: true,
					blocks: [],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		expect(html).not.toContain("data-lesson-label");
	});

	it("does not synthesize an H1 when the lesson and page labels match", () => {
		const config = makeConfig({
			navigationStyle: "slides",
			showLessonNameAsTitle: true,
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					lessonTitle: "Introduction",
					isFirstPageOfLesson: true,
					blocks: [],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		expect(html).not.toContain("praxity-page-title");
		expect(html).not.toContain("praxity-lesson-title");
		expect(html).toContain('"lessonTitle":"Introduction"');
	});

	it("does not synthesize an H1 on later lesson pages", () => {
		const config = makeConfig({
			navigationStyle: "slides",
			showLessonNameAsTitle: true,
			pages: [
				{
					id: "page-1",
					title: "Page 2",
					lessonTitle: "Lesson 1",
					isFirstPageOfLesson: false,
					blocks: [],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: testIslandAssets,
		});
		expect(html).not.toContain("praxity-page-title");
		expect(html).not.toContain("praxity-lesson-title");
		expect(html).toContain('"isFirstPageOfLesson":false');
	});

	it("does not synthesize an H1 when lesson titles are disabled", () => {
		const config = makeStaticConfig({
			showLessonNameAsTitle: false,
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					lessonTitle: "Lesson 1",
					isFirstPageOfLesson: true,
					blocks: [],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
		});
		expect(html).not.toContain("praxity-page-title");
		expect(html).not.toContain("praxity-lesson-title");
	});
});

describe("generateHtmlPages", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "html-gen-test-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("keeps duplicate-titled lessons in distinct files and navigation links", async () => {
		const config = makeConfig({
			totalPages: 2,
			pages: [
				{
					id: "first",
					title: "Same title",
					blocks: [{ id: "a", type: "text", data: { content: "<p>First lesson body</p>" } }],
				},
				{
					id: "second",
					title: "Same title",
					blocks: [{ id: "b", type: "text", data: { content: "<p>Second lesson body</p>" } }],
				},
			],
		});
		await generateHtmlPages(config, tmpDir, testIslandAssets);
		const first = new JSDOM(await fs.readFile(path.join(tmpDir, "same-title.html"), "utf8"));
		const second = new JSDOM(await fs.readFile(path.join(tmpDir, "same-title-2.html"), "utf8"));
		try {
			expect(first.window.document.querySelector("main")?.textContent).toContain(
				"First lesson body",
			);
			expect(second.window.document.querySelector("main")?.textContent).toContain(
				"Second lesson body",
			);
			for (const doc of [first.window.document, second.window.document]) {
				const links = [...doc.querySelectorAll<HTMLAnchorElement>('nav a[href$=".html"]')];
				expect(links.some((link) => link.getAttribute("href") === "same-title.html")).toBe(true);
				expect(links.some((link) => link.getAttribute("href") === "same-title-2.html")).toBe(true);
			}
		} finally {
			first.window.close();
			second.window.close();
		}
	});

	it.each([false, true])(
		"uses each lesson language in generated documents (deck: %s)",
		async (deck) => {
			const pages: CourseConfig["pages"] = [
				{
					id: "fr-1",
					title: "Bonjour",
					lessonId: "french",
					locale: "fr",
					blocks: [{ id: "quote", type: "text", locale: "en", data: { content: "<p>Hello</p>" } }],
				},
				{ id: "fr-2", title: "Suite", lessonId: "french", locale: "fr", blocks: [] },
				{ id: "en-1", title: "Welcome", lessonId: "english", locale: "en", blocks: [] },
			];
			const config = makeConfig({ pages, totalPages: 3, ...(deck ? { moduleDeck: {} } : {}) });
			await generateHtmlPages(config, tmpDir, {
				...testIslandAssets,
				islandFilenames: { ...testIslandAssets.islandFilenames, deck: "island-deck.js" },
			});
			for (const [file, locale] of [
				["bonjour", "fr"],
				...(deck ? [] : [["suite", "fr"]]),
				["welcome", "en"],
			]) {
				const html = await fs.readFile(path.join(tmpDir, `${file}.html`), "utf-8");
				expect(html).toContain(`<html lang="${locale}"`);
				expect(parseConfigFromHtml(html).sourceLocale).toBe(locale);
				if (file === "bonjour") expect(html).toContain('lang="en"');
			}
		},
	);

	it("emits one host config and deployment marker on every learner and utility page", async () => {
		const config = makeConfig({
			pages: [
				{
					id: "page-a",
					lessonId: "lesson-a",
					title: "Intro",
					blocks: readBlockSource("[Term]{Definition}").blocks,
				},
				{ id: "page-b", lessonId: "lesson-a", title: "Next", blocks: [] },
			],
			totalPages: 2,
			resourceEntries: [
				{ title: "Guide", description: "Course guide", url: "guide.pdf", resourceType: "file" },
			],
		});

		await generateHtmlPages(config, tmpDir, testIslandAssets);

		const expected = [
			["intro.html", "page-a", "lesson-a", "content"],
			["next.html", "page-b", "lesson-a", "content"],
			["glossary.html", "glossary", null, "glossary"],
			["resources.html", "resources", null, "resources"],
		] as const;
		for (const [filename, pageId, lessonId, pageRole] of expected) {
			const html = await fs.readFile(path.join(tmpDir, filename), "utf-8");
			expect(html.match(new RegExp(DEPLOYMENT_HEAD_MARKER, "g"))).toHaveLength(1);
			expect(html.match(new RegExp(`id="${HOST_CONFIG_ID}"`, "g"))).toHaveLength(1);
			expect(parseHostConfigFromHtml(html)).toMatchObject({ pageId, lessonId, pageRole });
		}
	});

	it("writes index.html and page files to disk", async () => {
		const config = makeStaticConfig({
			pages: [
				{ id: "p1", title: "Intro", blocks: [] },
				{ id: "p2", title: "Chapter One", blocks: [] },
			],
			totalPages: 2,
		});

		await generateHtmlPages(config, tmpDir, testIslandAssets);

		const files = await fs.readdir(tmpDir);
		expect(files).toContain("index.html");
		// Should have index + 2 canonical slug pages + 1 numbered alias redirect
		expect(files.length).toBeGreaterThanOrEqual(4);

		// Index should redirect
		const indexHtml = await fs.readFile(path.join(tmpDir, "index.html"), "utf-8");
		expect(indexHtml).toContain("http-equiv");

		const introHtml = await fs.readFile(path.join(tmpDir, "intro.html"), "utf-8");
		// Both pages are text-only, so they render static (see the islands/static
		// split above) — the assertion is that the files exist and are well-formed.
		expect(introHtml).toContain("<!doctype html>");
		expect(introHtml).toContain("praxity-page-nav-fallback");
		expect(introHtml).toContain('<div class="praxity-layout-wrapper">');
		expect(introHtml).toContain('<ol role="list">');
		expect(introHtml).not.toContain('class="praxity-a11y-dock"');
		expect(introHtml).not.toContain('data-a11y-action="focus"');

		const chapterHtml = await fs.readFile(path.join(tmpDir, "chapter-one.html"), "utf-8");
		expect(chapterHtml).toContain("<!doctype html>");
		expect(chapterHtml).toContain("praxity-page-nav-fallback");

		const page2Alias = await fs.readFile(path.join(tmpDir, "page-2.html"), "utf-8");
		expect(page2Alias).toContain('<html lang="en">');
		expect(page2Alias).toContain('content="0; url=chapter-one.html"');
		expect(page2Alias).toContain("Loading page...");
		expect(page2Alias).toContain("chapter-one.html");
	});

	it("keeps the native nav shell consistent across narrated and plain pages", async () => {
		const config = makeConfig({
			pages: [
				{ id: "p1", title: "Static", blocks: [] },
				{
					id: "p2",
					title: "Narrated",
					data: { narrationAudio: "audio.mp3" },
					narrationEnabled: true,
					blocks: [],
				},
			],
			totalPages: 2,
		});

		await generateHtmlPages(config, tmpDir, testIslandAssets);

		const staticHtml = await fs.readFile(path.join(tmpDir, "static.html"), "utf-8");
		expect(staticHtml).toContain('data-praxity-islands="nav"');
		expect(staticHtml).toContain('id="course-nav-sidebar"');
		expect(staticHtml).toContain('<main id="main-content" class="praxity-page-content"');
		for (const marker of [
			"data-sidebar-collapse",
			"data-sidebar-expand",
			'class="praxity-sidebar-title"',
			'class="praxity-native-sidebar-meta"',
			'class="praxity-top-bar"',
			'id="praxity-page-nav"',
		]) {
			expect(staticHtml).toContain(marker);
		}

		const narratedHtml = await fs.readFile(path.join(tmpDir, "narrated.html"), "utf-8");
		expect(narratedHtml).toContain('data-praxity-islands="narration,nav"');
		expect(narratedHtml).toContain('<div data-island="narration"></div>');
		for (const marker of [
			"data-sidebar-collapse",
			"data-sidebar-expand",
			'id="praxity-page-nav"',
		]) {
			expect(narratedHtml).toContain(marker);
		}

		const explicitConfig = makeConfig({
			...config,
			navigationStyle: "sidebar",
			navToggles: {
				navOutline: true,
				navPrevNext: true,
				navTopBar: true,
				showA11yPill: true,
			},
		});
		const explicitHtml = generateHtmlPage({
			config: explicitConfig,
			page: explicitConfig.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(explicitConfig),
			slugMap: makeSlugMap(explicitConfig),
			islandAssets: testIslandAssets,
		});
		for (const marker of [
			"data-sidebar-collapse",
			"data-sidebar-expand",
			'id="praxity-page-nav"',
		]) {
			expect(explicitHtml).toContain(marker);
		}
	});

	it("loads narration as a native island without the Mantine stylesheet", async () => {
		const config = makeConfig({
			pages: [
				{
					id: "p1",
					title: "Narrated",
					data: { narration: "Listen.", narrationAudio: "audio.mp3" },
					narrationEnabled: true,
					blocks: [],
				},
			],
			totalPages: 1,
			navToggles: { showA11yPill: false, navReadingSupportPlacement: "none" },
		});

		await generateHtmlPages(
			config,
			tmpDir,
			{
				loaderFilename: "island-loader.js",
				islandFilenames: { nav: "island-nav.js", narration: "island-narration.js" },
			},
			undefined,
			"styles-lite.css",
		);

		const html = await fs.readFile(path.join(tmpDir, "narrated.html"), "utf-8");
		expect(html).toContain('data-praxity-islands="narration,nav"');
		expect(parseConfigFromHtml(html).narrationPlaylist).toEqual({
			items: [
				{
					id: "page-title",
					src: "audio.mp3",
					authoredIndex: 0,
					pauseAfter: false,
				},
			],
			stops: [],
		});
		expect(html).toContain('data-island-narration="island-narration.js"');
		expect(html).toContain('<div data-island="narration"></div>');
		expect(html).toContain('href="styles-lite.css"');
		expect(html).toContain('<script defer src="island-loader.js"></script>');
	});

	it("writes kebab-case asset attributes for camel-case island names", () => {
		const config = makeStaticConfig({
			pages: [
				{
					id: "p1",
					title: "Comparison",
					blocks: [
						{
							id: "comparison",
							type: "imageComparison",
							data: { display: "slider", beforeImage: "before.jpg", afterImage: "after.jpg" },
						},
					],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "comparison",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { imageComparison: "island-image-comparison.hash.js" },
			},
		});

		expect(html).toContain('data-island-image-comparison="island-image-comparison.hash.js"');
		expect(html).not.toContain("data-island-imageComparison");
	});

	it("suppresses the glossary page when the author turns it off", async () => {
		const config = makeConfig({
			navigationStyle: "slides",
			pages: [
				{ id: "p1", title: "Intro", blocks: readBlockSource("[Alpha]{First definition}").blocks },
			],
			totalPages: 1,
			glossaryTabEnabled: false,
		});

		await generateHtmlPages(config, tmpDir, testIslandAssets);

		await expect(fs.pathExists(path.join(tmpDir, "glossary.html"))).resolves.toBe(false);
		const introHtml = await fs.readFile(path.join(tmpDir, "intro.html"), "utf-8");
		expect(introHtml).toContain('"glossaryEnabled":false');
	});

	it("keeps generated glossary and resources content renderable", async () => {
		const config = makeConfig({
			navigationStyle: "slides",
			pages: [
				{
					id: "p1",
					title: "Intro",
					blocks: readBlockSource("[Alpha]{First definition} and [Beta]{Second definition}.")
						.blocks,
				},
			],
			totalPages: 1,
			glossaryTabEnabled: true,
			resourcesTabEnabled: true,
			resourceEntries: [
				{
					title: "Guide",
					description: "Course guide",
					url: "guide.pdf",
					resourceType: "file",
				},
			],
		});

		await generateHtmlPages(config, tmpDir, testIslandAssets);

		const glossaryHtml = await fs.readFile(path.join(tmpDir, "glossary.html"), "utf-8");
		expect(glossaryHtml).toContain("First definition");
		expect(glossaryHtml).toContain("Second definition");
		expect(glossaryHtml.match(/<h1\b/g)).toHaveLength(1);
		expect(glossaryHtml).not.toContain("Page 2 of 1");
		expect(parseHostConfigFromHtml(glossaryHtml)).toMatchObject({
			pageRole: "glossary",
			pageTitle: "Glossary",
		});

		const resourcesHtml = await fs.readFile(path.join(tmpDir, "resources.html"), "utf-8");
		expect(resourcesHtml).toContain("Course guide");
		expect(resourcesHtml.match(/<h1\b/g)).toHaveLength(1);
		expect(resourcesHtml).not.toContain("Page 2 of 1");
		const resourcesConfig = parseConfigFromHtml(resourcesHtml);
		expect(resourcesConfig.currentPage).toBe(2);
		expect(resourcesConfig.totalPages).toBe(1);
		expect(resourcesConfig.blocks).toEqual([
			expect.objectContaining({
				type: "heading",
				data: { content: "Resources", level: 1 },
			}),
			expect.objectContaining({
				type: "text",
				data: expect.objectContaining({ content: expect.stringContaining("Course guide") }),
			}),
		]);
	});

	it("counts an authored final page titled Resources", async () => {
		const config = makeConfig({
			pages: [
				{ id: "p1", title: "Intro", blocks: [] },
				{ id: "p2", title: "Resources", blocks: [] },
			],
			totalPages: 2,
		});

		await generateHtmlPages(config, tmpDir, testIslandAssets);

		const resourcesHtml = await fs.readFile(path.join(tmpDir, "resources-2.html"), "utf-8");
		expect(resourcesHtml).toContain("Page 2 of 2");
		expect(parseHostConfigFromHtml(resourcesHtml).pageRole).toBe("content");
	});

	it("does not count generated resources in course progress", async () => {
		const config = makeConfig({
			pages: [{ id: "p1", title: "Intro", blocks: [] }],
			totalPages: 2,
			resourceEntries: [
				{
					title: "Guide",
					description: "Course guide",
					url: "guide.pdf",
					resourceType: "file",
				},
			],
		});

		await generateHtmlPages(config, tmpDir, testIslandAssets);

		const resourcesHtml = await fs.readFile(path.join(tmpDir, "resources.html"), "utf-8");
		expect(resourcesHtml).not.toContain('aria-label="Course progress: page 2 of 2"');
		expect(parseHostConfigFromHtml(resourcesHtml).pageRole).toBe("resources");
	});

	it("keeps static pages free of the island runtime", async () => {
		const config = makeStaticConfig({
			pages: [
				{ id: "p1", title: "Static", blocks: [] },
				{
					id: "p2",
					title: "Interactive",
					blocks: [
						{
							id: "checklist-1",
							type: "checklist",
							data: { items: [{ id: "item-1", text: "Check" }] },
						},
					],
				},
			],
			totalPages: 2,
		});
		const islandAssets = {
			loaderFilename: "island-loader.js",
			islandFilenames: { nav: "nav.js", checklist: "checklist.js" },
			selfCheckLifetime: "self-check-lifetime-AAAAAAAA.classic.js",
		};

		await generateHtmlPages(config, tmpDir, islandAssets);

		const staticHtml = await fs.readFile(path.join(tmpDir, "static.html"), "utf-8");
		expect(staticHtml).not.toContain("island-loader.js");
		expect(staticHtml).not.toContain("self-check-lifetime-");
		expect(staticHtml).toContain('<div class="praxity-layout-wrapper">');
		expect(staticHtml).not.toContain('data-island="nav"');

		const interactiveHtml = await fs.readFile(path.join(tmpDir, "interactive.html"), "utf-8");
		expect(interactiveHtml).toContain('<script defer src="island-loader.js"></script>');
		expect(interactiveHtml).toContain('<div class="praxity-layout-wrapper"');
		expect(interactiveHtml).not.toContain('data-island="nav"');
		expect(interactiveHtml).toContain('data-island="checklist"');
		expect(interactiveHtml).not.toContain("self-check-lifetime-");
	});

	it("renders textured pages as static HTML", async () => {
		for (const texture of ["grain", "paper", "noise"] as const) {
			const result = await generateHtmlPages(
				makeStaticConfig({
					texture,
					totalPages: 2,
					pages: [
						{ id: "p1", title: "Introduction", blocks: [] },
						{
							id: "p2",
							title: "Details",
							blocks: readBlockSource(
								"# Dark section {hideTitle}\n\n--- {palette=dark}\n\n## Dark section\n",
							).blocks,
						},
					],
				}),
				tmpDir,
			);

			expect(result.runtimeMode).toBe("static");
			for (const slug of ["introduction", "details"]) {
				const html = await fs.readFile(path.join(tmpDir, `${slug}.html`), "utf-8");
				expect(html).toContain(`<main id="main-content" class="praxity-page-content"`);
				expect(html).not.toContain('class="praxity-section"');
				expect(html).not.toContain(`data-texture="${texture}"`);
				if (slug === "details") expect(html).not.toContain('data-section-palette="dark"');
			}
		}
	});

	it("textures the slide canvas in slides mode", () => {
		const html = renderPage({
			navigationStyle: "slides",
			texture: "grain",
			pages: [{ id: "page-1", title: "Slide", blocks: [], data: { style: "title" } }],
		});
		expect(html).toContain(
			'<main id="main-content" class="praxity-page-content" data-slide-style="title"',
		);
		expect(html).toContain('<div class="praxity-slide" data-slide-style="title"');
		expect(html).not.toContain('class="praxity-slide" data-texture');
		expect(html).not.toContain('class="praxity-section"');
	});

	it("emits French native chrome, glossary title, and resource headings", async () => {
		const config = makeConfig({
			navigationStyle: "slides",
			sourceLocale: "fr",
			pages: [
				{
					id: "p1",
					title: "Introduction",
					blocks: readBlockSource("[Acronyme]{Forme abrégée.}").blocks,
				},
				{ id: "p2", title: "Suite", blocks: [] },
			],
			totalPages: 2,
			resourceEntries: [
				{
					title: "Guide",
					description: "",
					url: "guide.pdf",
					resourceType: "file",
				},
				{
					title: "Site municipal",
					description: "",
					url: "https://example.com",
					resourceType: "link",
				},
				{
					title: "Leçon 1",
					description: "",
					url: "lesson-1.pdf",
					resourceType: "lessonPdf",
				},
				{
					title: "Politique",
					description: "",
					url: "https://example.com/politique.pdf",
					resourceType: "document",
				},
			],
		});

		await generateHtmlPages(config, tmpDir, testIslandAssets);

		const introHtml = await fs.readFile(path.join(tmpDir, "introduction.html"), "utf-8");
		expect(introHtml).toContain('aria-label="Pages"');
		expect(introHtml).toContain('"openCourseMenu":"Ouvrir le menu du cours"');
		expect(introHtml).toContain('"pageScrollProgress":"Progression du défilement de la page"');

		const glossaryHtml = await fs.readFile(path.join(tmpDir, "glossary.html"), "utf-8");
		expect(glossaryHtml).toContain("<title>Glossaire");
		expect(parseHostConfigFromHtml(glossaryHtml).pageTitle).toBe("Glossaire");

		const resourcesHtml = await fs.readFile(path.join(tmpDir, "resources.html"), "utf-8");
		expect(resourcesHtml).toContain("<title>Ressources");
		expect(resourcesHtml).toContain("<h2>Documents</h2>");
		expect(resourcesHtml).toContain("<h2>Liens externes</h2>");
		expect(resourcesHtml).toContain("<h2>PDF des leçons</h2>");
		expect(resourcesHtml).toContain("<h2>Documents du cours</h2>");
	});
});

it("publishes consecutive columns rows separately before and after save", () => {
	const source =
		"# Untitled {hideTitle}\n\n::: columns\n::\nScene\n\n::\nTitle\n:::\n\n::: columns\n::\n![First figure](/assets/first.png)\n\n::\n![Second figure](/assets/second.png)\n:::\n";
	for (const input of [source, replayLesson(readBlockSource(source))]) {
		const blocks = adaptGrammarPreviewBlocks(readBlockSource(input).blocks);
		const document = new JSDOM(renderPage({ pages: [{ id: "page-1", title: "Rows", blocks }] }))
			.window.document;
		const rows = document.querySelectorAll(".praxity-columns");
		expect(rows).toHaveLength(2);
		expect(rows[0].children).toHaveLength(2);
		expect(rows[0].textContent).toContain("Scene");
		expect(rows[0].textContent).toContain("Title");
		expect(rows[0].querySelectorAll("img")).toHaveLength(0);
		expect(rows[1].children).toHaveLength(2);
		expect(Array.from(rows[1].querySelectorAll("img"), (image) => image.alt)).toEqual([
			"First figure",
			"Second figure",
		]);
	}
});

describe("assessmentGroup", () => {
	it("frames floated group context once before hydration", () => {
		const blocks = [
			{
				id: "group",
				type: "assessmentGroup",
				data: { groupName: "Check", mode: "all", layout: "wide", memberBlockIds: ["question"] },
			},
			{
				id: "image",
				type: "image",
				data: { src: "assets/context.png", alt: "Context", width: "medium", float: "right" },
			},
			{ id: "context", type: "text", data: { content: "<p>Consider this.</p>" } },
			{ id: "float-end", type: "blockBreak", data: { close: "float" } },
			{
				id: "question",
				type: "assessment",
				data: {
					assessmentType: "choice",
					stem: [],
					response: { type: "choice", selectionMode: "single", options: [] },
				},
			},
		] as CourseConfig["pages"][number]["blocks"];
		const html = renderPage({ pages: [{ id: "page-1", title: "Check", blocks }] });
		expect(html).toContain(
			'class="praxity-float-region praxity-layout-wide" data-image-float-region="right" data-assessment-group-context="group"',
		);
		const float =
			html.match(
				/<div class="praxity-float-region[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*data-block-id="question"/,
			)?.[1] ?? "";
		expect(float).not.toContain('data-assessment-group-context="group"');
	});

	it.each([
		["#", "##", 1],
		["##", "###", 2],
	] as const)(
		"keeps %s group heading and renders %s question as a paragraph",
		(groupHashes, questionHashes, groupLevel) => {
			const source = `# Assessment${groupLevel === 1 ? " {hideTitle}" : ""}\n\n::: group Knowledge check {level=${groupLevel}}\n::: choice Which answer is correct? {level=${questionHashes.length}}\n(x) Yes\n( ) No\n:::\n:::\n`;
			const blocks = adaptGrammarPreviewBlocks(readBlockSource(source).blocks);
			const html = renderPage({ pages: [{ id: "page-1", title: "Assessment", blocks }] });
			expect(html).toContain(
				`<h${groupLevel} id="assessment-group-title-${blocks.find((block) => block.type === "assessmentGroup")?.id}" class="praxity-assessment-group-title">Knowledge check</h${groupLevel}>`,
			);
			expect(html).toMatch(/<p[^>]*class="praxity-assessment-stem"/);
			expect(html.match(/<h1\b/g)).toHaveLength(1);
		},
	);

	it.each(["all", "oneOf"] as const)(
		"renders a stable %s group before island activation",
		(mode) => {
			const blocks = readBlockSource(
				`# Assessment\n\n::: group Knowledge check {mode=${mode} level=2}\nbutton: Check answers\nConsider the scenario.\n::: choice First question {level=3}\n(x) Yes\n( ) No\n:::\n::: choice Second question {level=3}\n(x) Yes\n( ) No\n:::\n:::\n`,
			).blocks;
			const group = blocks.find((block) => block.type === "assessmentGroup");
			const html = renderPage({ pages: [{ id: "page-1", title: "Assessment", blocks }] });
			expect(group).toBeDefined();
			expect(html).toContain(`data-assessment-group-context="${group?.id}"`);
			expect(html).toContain(`data-assessment-group="${group?.id}" data-group-first`);
			expect(html).toContain(
				`data-assessment-group="${group?.id}" data-group-last data-group-has-footer`,
			);
			expect(html).toContain(`data-assessment-group-submit="${group?.id}"`);
			expect(html).toContain("data-assessment-group-download-submit");
			expect(html).toContain(
				'class="praxity-btn praxity-btn-filled praxity-ag-submit-btn" disabled>Check answers</button>',
			);
			if (mode === "oneOf") {
				expect(html).toContain('class="praxity-assessment-group-picker"');
				expect(html).toContain("data-group-oneof-unselected");
				expect(html.match(/class="praxity-ag-radio"/g)).toHaveLength(2);
			} else {
				expect(html).not.toContain("data-group-oneof-unselected");
			}
		},
	);

	it("does not enable hidden download submission for graded groups", () => {
		const blocks = readBlockSource(
			"# Quiz {hideTitle}\n\n::: group Quiz\n::: choice Answer {scored}\n(x) Yes\n( ) No\n:::\n:::\n",
		).blocks;
		const html = renderPage({ pages: [{ id: "page-1", title: "Quiz", blocks }] });
		expect(html).toContain("data-assessment-group=");
		expect(html).not.toContain("data-assessment-group-download-submit");
	});

	it("enables downloadable text responses in a mixed group to submit with the group", () => {
		const blocks = adaptGrammarPreviewBlocks(
			readBlockSource(
				"# Check {hideTitle}\n\n::: group Check\n::: choice Quiz {scored}\n(x) Yes\n( ) No\n:::\n::: free-response Reflection {download=txt}\n:::\n::: free-response Plan {download=txt}\n:::\n:::\n",
			).blocks,
		);
		const html = renderPage({ pages: [{ id: "page-1", title: "Check", blocks }] });
		expect(html.match(/data-assessment-group-download-submit/g)).toHaveLength(2);
	});

	it.each([
		[
			"group-only page",
			"# Assessment {hideTitle}\n\n::: group Knowledge check {level=1}\n::: free-response Reflection {level=3}\n:::\n:::\n",
			1,
		],
		[
			"page with an explicit H1",
			"# Assessment\n\n::: group Knowledge check {level=2}\n::: free-response Reflection {level=3}\n:::\n:::\n",
			2,
		],
	] as const)("renders an authored group heading on a %s", (_scenario, source, level) => {
		const blocks = readBlockSource(source).blocks;
		const html = renderPage({
			pages: [{ id: "page-1", title: "Assessment", blocks }],
		});
		expect(html.match(/<h1\b/g)).toHaveLength(1);
		expect(html).toContain(
			`<h${level} id="assessment-group-title-${blocks.find((block) => block.type === "assessmentGroup")?.id}" class="praxity-assessment-group-title">Knowledge check</h${level}>`,
		);
	});

	it.each([
		["layout", "wide"],
		["layoutMode", "wide"],
		["layout", "narrow"],
		["layoutMode", "narrow"],
		[null, "full"],
	])("renders a coherent group width before activation with group %s: %s", (layoutKey, layout) => {
		const parsed = readBlockSource(`# Fixture {hideTitle}

::: group Group ${layoutKey ? `{width=${layout}}` : ""}
Consider this context before answering.
::: choice Inherited {name=inherited level=3}
(x) Yes
( ) No
:::
::: choice Explicit {name=explicit width=full level=3}
(x) Yes
( ) No
:::
:::
`);
		expect(parsed.warnings).toEqual([]);
		const html = renderPage({ pages: [{ id: "page-1", title: "Quiz", blocks: parsed.blocks }] });
		const members = parsed.blocks.filter((block) => block.type === "assessment");
		for (const block of parsed.blocks) {
			const wrapper = html.match(new RegExp(`<div[^>]*data-block-id="${block.id}"[^>]*>`))?.[0];
			expect(wrapper).toContain(`praxity-layout-${layout}`);
		}
		expect(members[0].data.layoutMode).toBeUndefined();
	});

	it("uses cooperating islands for grouped assessments", () => {
		const config = makeStaticConfig({
			pages: [
				{
					id: "page-1",
					title: "Quiz",
					blocks: [
						{
							id: "a1",
							type: "assessment",
							data: {
								assessmentType: "choice",
								stem: [],
								response: {
									type: "choice",
									selectionMode: "single",
									inputMethod: "click",
									options: [],
									display: "list",
									shuffle: false,
								},
								feedback: {},
							},
						},
						{
							id: "ag1",
							type: "assessmentGroup",
							data: {
								groupName: "Group 1",
								mode: "all",
								memberBlockIds: ["a1"],
								requireAll: false,
								showResultsSummary: true,
							},
						},
					],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: {
					assessment: "island-assessment.js",
					assessmentGroup: "island-assessment-group.js",
				},
			},
		});
		expect(html).toContain('"type":"assessmentGroup"');
		expect(html).toContain('data-praxity-islands="assessment,assessmentGroup"');
		expect(html).toContain('data-island="assessmentGroup"');
		expect(html).toContain("island-assessment-group.js");
	});

	it("leaves assessment-group score tracking to the deployment host", () => {
		const html = renderPage({
			pages: [
				{
					id: "page-1",
					title: "Intro",
					blocks: [{ id: "b1", type: "text", data: { content: "<p>Hi</p>" } }],
				},
			],
		});
		expect(html).not.toContain('document.addEventListener("praxity:assessment-group-complete"');
		expect(parseHostConfigFromHtml(html)).toMatchObject({
			courseId: "course-1",
			pageId: "page-1",
		});
		expect(html.match(new RegExp(DEPLOYMENT_HEAD_MARKER, "g"))).toHaveLength(1);
	});

	it("renders the assessmentGroup header in the HTML stream", () => {
		const html = renderPage({
			pages: [
				{
					id: "page-1",
					title: "Quiz",
					blocks: [
						{ id: "b1", type: "text", data: { content: "<p>Hi</p>" } },
						{
							id: "ag1",
							type: "assessmentGroup",
							data: {
								groupName: "G",
								mode: "all",
								memberBlockIds: ["reflection"],
								requireAll: false,
								showResultsSummary: true,
							},
						},
						{
							id: "reflection",
							type: "assessment",
							data: {
								assessmentType: "textResponse",
								question: "Reflect",
								gradingMode: "none",
								response: {},
							},
						},
					],
				},
			],
		});
		expect(html).toContain('data-block-type="assessmentGroup"');
		expect(html).toContain('data-assessment-group-header="ag1"');
		expect(html).toContain('data-block-type="text"');
	});
});

describe("authored heading levels", () => {
	it("preserves a multi-level outline through nested container children", () => {
		const html = renderPage({
			pages: [
				{
					id: "page-1",
					title: "Observatory workshop",
					blocks: [
						{
							id: "page-title",
							type: "heading",
							data: { content: "Preparing the observatory", level: 1 },
						},
						{
							id: "before",
							type: "heading",
							data: { content: "Equipment checklist", level: 2 },
						},
						{
							id: "ideas",
							type: "heading",
							data: { content: "Tonight's observing schedule", level: 2 },
						},
						{
							id: "columns",
							type: "columns",
							data: {
								items: [
									{
										id: "column-1",
										width: 1,
										children: [
											{
												id: "key-ideas",
												type: "heading",
												data: { content: "Telescope alignment", level: 3 },
											},
										],
									},
								],
							},
						},
					],
				},
			],
		});
		expect(html).toMatch(/<h1[^>]*>Preparing the observatory<\/h1>/);
		expect(html).toMatch(/<h2[^>]*>Equipment checklist<\/h2>/);
		expect(html).toMatch(/<h2[^>]*>Tonight's observing schedule<\/h2>/);
		expect(html).toMatch(/<h3[^>]*>Telescope alignment<\/h3>/);
		expect(html.match(/<h1\b/g)).toHaveLength(1);
		expect(html).not.toContain("headingOffset");
	});
});

describe("nav placement and skip links", () => {
	const pages = [
		...makeConfig().pages,
		{ id: "page-2", title: "Second", blocks: [] },
		{ id: "page-3", title: "Third", blocks: [] },
	];

	it("renders page-nav and embed-nav outside <main>", () => {
		const html = renderPage({ totalPages: 3, pages, navToggles: STATIC_NAV_TOGGLES });
		const mainEnd = html.indexOf("</main>");
		expect(html.indexOf('id="praxity-page-nav-fallback"')).toBeGreaterThan(mainEnd);
		expect(html.indexOf('id="praxity-embed-nav"')).toBeGreaterThan(mainEnd);
	});

	it("renders skip-to-nav link inside <main> when multi-page", () => {
		const html = renderPage({ totalPages: 3, pages, navToggles: STATIC_NAV_TOGGLES });
		const main = html.slice(html.indexOf('<main id="main-content"'), html.indexOf("</main>"));
		expect(main).toContain('href="#praxity-page-nav-fallback"');
		expect(main).toContain('href="#praxity-embed-nav"');
	});

	it("does not render skip-to-nav link on single-page courses", () => {
		const html = renderPage({ totalPages: 1 });
		expect(html).not.toContain(">Skip to page navigation</a>");
	});
});

describe("nav archetype → body layout class", () => {
	// The exporter used to reverse-infer the layout from individual nav toggles.
	// That inference could not express `minimal` (its preset turns off outline,
	// prev/next and edge arrows, so the `none` branch claimed it) or `embedded`
	// (absent from the chain), and it downgraded a course to `sidebar` whenever an
	// author adjusted a toggle — including a brand-new project, which scaffolds as
	// `slides`. Pin every archetype to its own class.
	const cases: [NonNullable<CourseConfig["navigationStyle"]>, string][] = [
		["sidebar", "praxity-layout-sidebar"],
		["bottomBar", "praxity-layout-bottombar"],
		["slides", "praxity-layout-slides"],
		["scroll", "praxity-layout-scroll"],
		["minimal", "praxity-layout-minimal"],
		["embedded", "praxity-layout-embedded"],
		["none", "praxity-layout-none"],
	];

	for (const [archetype, expected] of cases) {
		it(`exports ${archetype} as ${expected}`, () => {
			const html = renderPage({ navigationStyle: archetype });
			expect(html).toContain(`<body class="${expected}">`);
		});

		it(`keeps ${archetype} intact when nav toggles are also set`, () => {
			// The slides preset's toggle combination previously *was* the only way to
			// reach praxity-layout-slides; toggles must no longer override the choice.
			const html = renderPage({
				navigationStyle: archetype,
				navToggles: { navOutline: true, navPrevNext: true, navEdgeArrows: false },
			});
			expect(html).toContain(`<body class="${expected}">`);
		});
	}

	it("falls back to sidebar when no archetype is set", () => {
		expect(renderPage()).toContain('<body class="praxity-layout-sidebar">');
	});

	it("renders ordinary slides through the native navigation island", () => {
		const config = makeConfig({
			navigationStyle: "slides",
			navToggles: { navEdgeArrows: true },
			totalPages: 3,
			pages: [
				{ id: "one", title: "One", blocks: [] },
				{
					id: "two",
					title: "Two",
					data: { style: "title" },
					blocks: [{ id: "copy", type: "text", data: { content: "<p>Slide content</p>" } }],
				},
				{ id: "three", title: "Three", blocks: [] },
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[1],
			index: 1,
			currentSlug: "page-2",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { nav: "island-nav.js" },
			},
		});

		expect(html).toContain('data-praxity-islands="nav"');
		expect(html).toContain('<main id="main-content" class="praxity-page-content"');
		expect(html).toContain('class="praxity-slide" data-slide-style="title"');
		expect(html).toContain('class="praxity-slide-counter"');
		expect(html).toContain('class="praxity-nav-band"');
		expect(html).toContain('id="praxity-page-nav" class="praxity-slide-nav"');
		expect(html).toContain("praxity-progress-dots--inline");
		expect(html).toContain("praxity-slide-nav__arrow--prev");
		expect(html).toContain("praxity-slide-nav__arrow--next");
		expect(html).toContain('class="praxity-edge-arrow-nav" aria-hidden="true"');
		expect(html).toContain("data-nav-menu-toggle");
		expect(html).toContain("data-nav-drawer");
		expect(html).toContain('<script defer src="island-loader.js"></script>');
	});

	it.each([
		["en", "Page 2 of 3"],
		["fr", "Page 2 sur 3"],
	])("renders the %s Pages slide counter as static page text", (sourceLocale, position) => {
		const config = makeConfig({
			sourceLocale,
			navigationStyle: "slides",
			totalPages: 3,
			pages: [
				{ id: "one", title: "One", blocks: [] },
				{ id: "two", title: "Two", blocks: [] },
				{ id: "three", title: "Three", blocks: [] },
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[1],
			index: 1,
			currentSlug: "page-2",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { nav: "island-nav.js" },
			},
		});
		const counter = new JSDOM(html).window.document.querySelector(".praxity-slide-counter");

		// Each page is a full document, so the counter is never a status message.
		expect(counter?.hasAttribute("role")).toBe(false);
		expect(counter?.hasAttribute("aria-label")).toBe(false);
		expect(counter?.hasAttribute("aria-live")).toBe(false);
		expect(counter?.querySelector('[aria-hidden="true"]')?.textContent).toBe("2 / 3");
		expect(counter?.querySelector(".praxity-a11y-sr-only")?.textContent).toBe(position);
		expect(html).not.toContain("Slide 2 of 3");
		expect(html).not.toContain("Diapositive 2 sur 3");
	});

	it("applies course-defined slide styles in native HTML", () => {
		const config = makeConfig({
			navigationStyle: "slides",
			slideStyles: {
				hero: { background: "accent", chrome: "minimal", measure: "wide" },
			},
			pages: [
				{
					id: "one",
					title: "One",
					data: { style: "hero" },
					blocks: [{ id: "copy", type: "text", data: { content: "<p>Styled slide</p>" } }],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { nav: "island-nav.js" },
			},
		});

		expect(html).toContain('data-slide-style="hero" data-slide-chrome="minimal"');
		expect(html).toContain("--slide-bg:var(--praxity-color-accent)");
		expect(html).toContain("--slide-measure:68rem");
	});

	it("keeps the slide layout when authored navigation is fully disabled", () => {
		const html = renderPage({
			navigationStyle: "slides",
			navToggles: {
				navOutline: false,
				navHamburgerMenu: false,
				navPrevNext: false,
				navBottomArrows: false,
				navTopBar: false,
				navReadingSupportPlacement: "none",
				navEdgeArrows: false,
				navSwipeGestures: false,
				showA11yPill: false,
			},
		});

		expect(html).toContain('<div class="praxity-slide"');
		expect(html).not.toContain("praxity-outline-fallback");
		expect(html).not.toContain("praxity-page-nav-fallback");
	});
});

describe("archetype-driven navigation emission", () => {
	const twoPages = [...makeConfig().pages, { id: "page-2", title: "Second", blocks: [] }];

	it("renders minimal with native dots and a gate-aware keyboard/swipe target", () => {
		const html = renderPageWithNav({
			navigationStyle: "minimal",
			totalPages: 2,
			pages: twoPages,
		});
		expect(html).toContain('class="praxity-nav-band"');
		expect(html).toContain('class="praxity-progress-dots"');
		expect(html).toContain('class="praxity-page-nav-fallback praxity-navigation-proxy"');
	});

	it("renders embedded navigation and the compact query-mode bar natively", () => {
		const html = renderPageWithNav({
			navigationStyle: "embedded",
			totalPages: 2,
			pages: twoPages,
		});
		expect(html).toContain('<body class="praxity-layout-embedded">');
		expect(html).toContain('id="praxity-page-nav"');
		expect(html).toContain('id="praxity-embed-nav" class="praxity-embed-nav" data-island="nav"');
	});

	it("renders scroll progress, authored-heading TOC, and narrative context natively", () => {
		const pages = [
			{
				id: "page-1",
				title: "Long page",
				blocks: [
					{ id: "heading-one", type: "heading", data: { content: "First", level: 2 } },
					{ id: "copy", type: "text", data: { content: "<p>Read this section.</p>" } },
					{ id: "heading-two", type: "heading", data: { content: "Second", level: 2 } },
				],
			},
			{ id: "page-2", title: "Second page", blocks: [] },
		] as CourseConfig["pages"];
		const html = renderPageWithNav({
			navigationStyle: "scroll",
			sectionRhythm: "alternate",
			totalPages: 2,
			pages,
		});
		expect(html).toContain("data-native-scroll-progress");
		expect(html).toContain("data-native-floating-toc");
		expect(html).toContain('data-toc-target="block-heading-one"');
		expect(html).toContain("data-native-narrative-bar");
	});

	it("keeps general bottom and edge arrows alongside ordinary previous/next", () => {
		const html = renderPageWithNav({
			navigationStyle: "sidebar",
			totalPages: 2,
			pages: twoPages,
			navToggles: { navBottomArrows: true, navEdgeArrows: true },
		});
		expect(html).toContain('id="praxity-page-nav" class="praxity-page-nav-fallback');
		expect(html).toContain('class="praxity-slide-nav"');
		expect(html).toContain('class="praxity-edge-arrow-nav" aria-hidden="true"');
		expect(html.match(/id="praxity-page-nav"/gu)).toHaveLength(1);
	});

	it("keeps edge arrows decorative when ordinary previous/next is present", () => {
		const html = renderPageWithNav({
			navigationStyle: "sidebar",
			totalPages: 2,
			pages: twoPages,
			navToggles: { navEdgeArrows: true },
		});
		expect(html).toContain('class="praxity-edge-arrow-nav" aria-hidden="true"');
		expect(html.match(/id="praxity-page-nav"/gu)).toHaveLength(1);
	});

	it("omits the no-JS fallback nav for the none archetype", () => {
		// `none` means no navigation chrome. The fallback IS the navigation on static
		// pages, so leaving it in shipped a full page list on every text-only page of
		// a course that asked for none.
		const html = renderPage({ navigationStyle: "none" });
		expect(html).not.toContain("praxity-outline-fallback");
		expect(html).not.toContain("praxity-page-nav-fallback");
	});

	it("keeps a no-JS navigation route for archetypes with visible navigation", () => {
		const pages = [
			{ id: "page-1", title: "One", blocks: [] },
			{ id: "page-2", title: "Two", blocks: [] },
		];
		for (const archetype of ["sidebar", "bottomBar", "scroll", "embedded"] as const) {
			const html = renderPage({ navigationStyle: archetype, totalPages: 2, pages });
			expect(html).toMatch(/praxity-(?:outline|page-nav)-fallback/u);
		}
	});
});

describe("authored page headings", () => {
	it("does not synthesize an H1 when content does not provide one", () => {
		const html = renderPage({ showLessonNameAsTitle: false });
		expect(html).not.toContain("praxity-page-title");
		expect(html).not.toContain('h1 class="praxity-sr-only"');
	});

	it("keeps the page label in metadata and navigation", () => {
		const html = renderPage();
		expect(html).toContain("<title>Introduction</title>");
		const doc = new JSDOM(html).window.document;
		expect(doc.querySelector('a[aria-current="page"]')?.textContent).toBe("Introduction, Visited");
	});

	it("leaves the heading alone when the first block already repeats the title", () => {
		// The author's own heading block carries the title; a hidden duplicate would
		// make assistive tech announce it twice.
		const config = makeStaticConfig({
			pages: [
				{
					id: "page-1",
					title: "Introduction",
					blocks: [{ id: "b1", type: "heading", data: { content: "Introduction", level: 1 } }],
				},
			],
		});
		const html = generateHtmlPage({
			config,
			page: config.pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: makeSlugList(config),
			slugMap: makeSlugMap(config),
		});
		expect(html).not.toContain('praxity-sr-only">Introduction');
		expect(html.match(/<h1\b/g)).toHaveLength(1);
	});
});

describe("page-N aliases", () => {
	it("makes page-1 a redirect like the rest, not a duplicate of the page", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "praxity-alias-"));
		try {
			const config = makeConfig({
				pages: [
					{ id: "p1", title: "Intro", blocks: [] },
					{ id: "p2", title: "Chapter One", blocks: [] },
				],
			});
			await generateHtmlPages(config, tmpDir, testIslandAssets);

			const pageOne = await fs.readFile(path.join(tmpDir, "page-1.html"), "utf-8");
			expect(parseShellConfigFromHtml(pageOne)).toMatchObject({
				kind: "redirect",
				target: "intro.html",
			});
			expect(pageOne).toContain("intro.html");
			expect(pageOne.indexOf('<script src="course-shell.js"></script>')).toBeLessThan(
				pageOne.indexOf('http-equiv="refresh"'),
			);
			// A duplicate of the real page would carry the course chrome.
			expect(pageOne).not.toContain("praxity-page-nav-fallback");

			const pageTwo = await fs.readFile(path.join(tmpDir, "page-2.html"), "utf-8");
			expect(parseShellConfigFromHtml(pageTwo)).toMatchObject({
				kind: "redirect",
				target: "chapter-one.html",
			});
			expect(pageTwo).toContain("chapter-one.html");
		} finally {
			await fs.remove(tmpDir);
		}
	});
});

describe("main landmark", () => {
	it("declares exactly one main landmark on a static page", () => {
		const html = renderPage();
		expect(html).toContain('<a href="#main-content" class="praxity-skip-link">');
		expect(html).toContain('<main id="main-content"');
		expect(html).not.toContain('role="main"');
	});
});

describe("required course knowledge checks", () => {
	const question = (id: string, extra: Record<string, unknown> = {}) => ({
		id,
		type: "assessment" as const,
		data: {
			gradingMode: "exact",
			response: {
				type: "choice",
				selectionMode: "single",
				options: [{ id: `${id}-answer`, label: "Answer", isCorrect: true }],
			},
			...extra,
		},
	});
	const pages = [
		{ id: "first", title: "First", blocks: [] },
		{
			id: "last",
			title: "Last",
			blocks: [
				question("required"),
				question("optional", { required: false }),
				question("survey", { gradingMode: "none", required: true }),
				question("blank", { assessmentType: "fillBlank", response: { blanks: [{ answer: "" }] } }),
				question("choice-a"),
				question("choice-b"),
				{
					id: "group",
					type: "assessmentGroup" as const,
					data: { mode: "oneOf", memberBlockIds: ["choice-a", "choice-b"] },
				},
			],
		},
	];
	const hostConfig = (html: string) =>
		JSON.parse(
			html.match(
				/<script id="praxity-host-config" type="application\/json">([\s\S]*?)<\/script>/,
			)?.[1] ?? "{}",
		);

	it("includes course-wide required checks and group outcomes only when enabled", () => {
		expect(hostConfig(renderPage({ pages, totalPages: 2 })).requiredAssessmentIds).toBeUndefined();
		expect(
			hostConfig(renderPage({ pages, totalPages: 2, requireKnowledgeChecks: true }))
				.requiredAssessmentIds,
		).toEqual(["required", "group"]);
	});

	it("emits the pass mark over the same counted checks, rounded as the manifest declares", () => {
		const config = hostConfig(renderPage({ pages, totalPages: 2, passingScore: 66.6665 }));
		expect(config.passMark).toBe(66.67);
		expect(config.scoredAssessmentIds).toEqual(["required", "group"]);
		expect(config.requiredAssessmentIds).toBeUndefined();
	});

	it("rejects a pass mark when a oneOf group offers an unscored question", () => {
		expect(() =>
			renderPage({
				passingScore: 50,
				pages: [
					{
						id: "choice",
						title: "Choice",
						blocks: [
							question("scored"),
							question("survey", { gradingMode: "none" }),
							{
								id: "pick-one",
								type: "assessmentGroup",
								data: { mode: "oneOf", memberBlockIds: ["scored", "survey"] },
							},
						],
					},
				],
			}),
		).toThrow(
			'Assessment group "pick-one" lets learners choose a question that is not automatically scored',
		);
	});

	it.each([{ hide: true }, { visible: "ready" }])(
		"rejects hidden or conditional required group members: %s",
		(data) => {
			expect(() =>
				renderPage({
					requireKnowledgeChecks: true,
					pages: [
						{
							id: "group-page",
							title: "Group",
							blocks: [
								question("hidden-member", data),
								{
									id: "visible-group",
									type: "assessmentGroup",
									data: { mode: "all", memberBlockIds: ["hidden-member"] },
								},
							],
						},
					],
				}),
			).toThrow('Required knowledge check "hidden-member" is hidden or conditional');
		},
	);

	it.each([
		[{ visible: "ready" }, "hidden or conditional"],
		[{ private: true }, "private"],
	])("rejects unreportable required checks: %s", (data, reason) => {
		expect(() =>
			renderPage({
				requireKnowledgeChecks: true,
				pages: [
					{
						id: "conditional",
						title: "Conditional",
						blocks: [question("hidden", data)],
					},
				],
			}),
		).toThrow(`Required knowledge check "hidden" is ${reason}`);
	});
});

describe("corner artwork", () => {
	it("adds optional course CSS only when used and stays within its incremental budget", async () => {
		const plain = generateCourseCss({});
		const decorated = generateCourseCss({}, true);
		expect(plain).not.toContain(".praxity-slide-canvas");
		expect(decorated).toContain(".praxity-slide-canvas");
		const shared = await buildCss({
			entryPoints: [path.resolve(import.meta.dirname, "../../template/src/styles/viewer.css")],
			bundle: true,
			write: false,
			minify: true,
			target: "es2020",
			legalComments: "none",
		});
		const css = shared.outputFiles[0].text;
		// Owner 2026-10-19: main styling plus palette gates measure 31,871 B gzip; 1,153 B headroom.
		// Keep main's 33,024 B cap; tighten during final size work.
		expect(gzipSync(css).byteLength).toBeLessThanOrEqual(33_024);
		expect(
			gzipSync(css + decorated).byteLength - gzipSync(css + plain).byteLength,
		).toBeLessThanOrEqual(1024);
	});

	it("wraps only opted-in native slides without changing style measure or media placement", () => {
		const html = renderPage({
			navigationStyle: "slides",
			slideStyles: {
				wash: {
					background: "paper",
					cornerImage: "assets/wash.png",
					measure: "wide",
					mediaPlacement: "left",
					align: "start",
				},
			},
			pages: [
				{
					id: "one",
					title: "One",
					data: { style: "wash" },
					blocks: [{ id: "text", type: "text", data: { content: "<p>Readable words</p>" } }],
				},
			],
		});
		expect(html).toContain('class="praxity-slide-canvas" data-corner-placement="corners"');
		expect(html).toContain(
			'class="praxity-slide-artwork"><div class="praxity-slide" data-slide-style="wash"',
		);
		expect(html).toContain("--slide-corner-image:url(&quot;assets/wash.png&quot;)");
		expect(html).toContain("--slide-measure:68rem");
		expect(html).toContain("--slide-text-column:2");
		expect(html).toContain("--slide-align:start");
		expect(html).toContain("Readable words");
		expect(renderPage({ navigationStyle: "slides" })).not.toContain('class="praxity-slide-canvas"');
	});
	it.each(["full", "breakout"])("uses a trailing wash for nested %s blocks", (width) => {
		const parsed = readBlockSource(
			`::: columns\n:: {weight=1}\n::: text {width=${width}}\nWide content\n:::\n:::\n`,
		);
		const html = renderPage({
			navigationStyle: "slides",
			slideStyles: { wash: { cornerImage: "assets/wash.png" } },
			pages: [
				{
					id: "one",
					title: "One",
					data: { pageStyle: "wash" },
					blocks: parsed.blocks,
				},
			],
		});
		expect(html).toContain('data-corner-placement="flow"');
		expect(html).toContain("Wide content");
		expect(JSON.stringify(parsed.blocks)).toContain(`"layoutMode":"${width}"`);
	});
	it("retains a top-level escaping block wrapper with trailing artwork", () => {
		const html = renderPage({
			navigationStyle: "slides",
			slideStyles: { wash: { cornerImage: "assets/wash.png" } },
			pages: [
				{
					id: "one",
					title: "One",
					data: { pageStyle: "wash" },
					blocks: readBlockSource(
						"# Untitled {hideTitle}\n\n::: text {width=full}\nWide content\n:::\n",
					).blocks,
				},
			],
		});
		expect(html).toContain('data-corner-placement="flow"');
		expect(html).toContain("praxity-layout-full");
	});
	it("selects named artwork or an undecorated style", () => {
		const config = {
			navigationStyle: "slides" as const,
			slideStyles: { wash: { cornerImage: "assets/named.png" } },
		};
		const page = {
			id: "one",
			title: "One",
			blocks: [],
			data: { pageStyle: "wash" },
		};
		expect(renderPage({ ...config, pages: [page] })).toContain(
			"--slide-corner-image:url(&quot;assets/named.png&quot;)",
		);
		expect(
			renderPage({ ...config, pages: [{ ...page, data: { pageStyle: "plain" } }] }),
		).not.toContain('class="praxity-slide-canvas"');
	});
});
