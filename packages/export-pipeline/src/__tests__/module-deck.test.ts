import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EXTERNAL_LINK_ICON_HTML } from "@praxity/shared-blocks/external-link-utils";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import { JSDOM } from "jsdom";
import { assert, describe, expect, it } from "vitest";
import { readBlockFixture as readBlockSource } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { groupedDeckFixture, moduleDeckFixture } from "../../tests/fixtures/module-deck";
import { generateHtmlPages } from "../html-pages";
import { deckPageData, validateModuleDeck } from "../module-deck";

const assets = {
	loaderFilename: "loader.js",
	islandFilenames: {
		deck: "deck.js",
		card: "card.js",
		assessment: "assessment.js",
		nav: "nav.js",
		narration: "narration.js",
		tooltip: "tooltip.js",
	},
};
describe("module deck compiler", () => {
	it("admits required device self-check attempt gates and refuses pass gates", () => {
		const pages = [
			{
				id: "slide",
				title: "Slide",
				blocks: [
					{
						id: "self",
						type: "selfCheck" as const,
						data: {
							required: true,
							private: true,
							deckGate: "attempt",
							content: { task: "Explain", parts: [{ id: "part" }] },
						},
					},
				],
			},
		];
		expect(() => validateModuleDeck({}, pages)).not.toThrow();
		expect(deckPageData(pages[0], {}, "slide", "module", "en").gates).toEqual([
			{ id: "self", rule: "attempt" },
		]);
		expect(() => validateModuleDeck({ gates: { self: "pass" } }, pages)).toThrow();
	});
	it("decodes display metadata titles like Pages, including nested entities", () => {
		const page = {
			id: "encoded-slide",
			title: "Second &amp; slide",
			lessonTitle: "First &amp;amp; lesson",
			blocks: [],
		};
		const metadata = deckPageData(page, {}, "encoded-slide", "lesson", "en");
		expect(metadata.title).toBe("Second & slide");
		expect(metadata.lessonTitle).toBe("First & lesson");
	});

	it.each(["textResponse", "fileUpload", "matrix", "likert"])(
		"rejects an individual Pass on %s while allowing Attempt",
		(assessmentType) => {
			const pages = [
				{
					id: "slide",
					title: "Slide",
					blocks: [{ id: "question", type: "assessment" as const, data: { assessmentType } }],
				},
			];
			expect(() => validateModuleDeck({ gates: { question: "pass" } }, pages)).toThrow(
				"Pass gates need an automatically checked answer: question",
			);
			expect(() => validateModuleDeck({ gates: { question: "attempt" } }, pages)).not.toThrow();
		},
	);
	it.each(["textResponse", "fileUpload", "matrix", "likert"])(
		"retains all/oneOf group answer constraints with a %s member",
		(assessmentType) => {
			const group = {
				id: "group",
				type: "assessmentGroup" as const,
				data: { memberBlockIds: ["scoring", "response"], mode: "all" },
			};
			const scoring = {
				id: "scoring",
				type: "assessment" as const,
				data: { assessmentType: "choice", response: { options: [{ isCorrect: true }] } },
			};
			const pages = [
				{
					id: "slide",
					title: "Slide",
					blocks: [
						group,
						scoring,
						{ id: "response", type: "assessment" as const, data: { assessmentType } },
					],
				},
			];
			expect(() => validateModuleDeck({ gates: { group: "pass" } }, pages)).not.toThrow();
			group.data.mode = "oneOf";
			expect(() => validateModuleDeck({ gates: { group: "pass" } }, pages)).toThrow(
				"Pass gates need an automatically checked answer: response",
			);
			group.data.mode = "all";
			scoring.data.response = { options: [{ isCorrect: false }] };
			expect(() => validateModuleDeck({ gates: { group: "pass" } }, pages)).toThrow(
				"Pass gates need an automatically checked answer: group",
			);
		},
	);
	it("keeps audio-only decorative images before an assessment-group introduction", () => {
		const page = deckPageData(
			{
				id: "page",
				title: "Check",
				narrationEnabled: true,
				blocks: [
					{
						id: "first",
						type: "image",
						data: { src: "opener.png", decorative: true, narrationAudio: "first.mp3" },
					},
					{
						id: "second",
						type: "image",
						data: { src: "opener.png", decorative: true, narrationAudio: "second.mp3" },
					},
					{
						id: "group",
						type: "assessmentGroup",
						data: {
							groupName: "Check your understanding",
							memberBlockIds: [],
							narrationAudio: "group.mp3",
						},
					},
				],
			},
			{},
			"page",
			"module",
			"en",
		);
		expect(page.segments.filter((segment) => segment.src)).toEqual([
			expect.objectContaining({
				id: "page:first",
				blockId: "first",
				script: "",
				src: "first.mp3",
				pauseAfter: false,
			}),
			expect.objectContaining({
				id: "page:second",
				blockId: "second",
				script: "",
				src: "second.mp3",
				pauseAfter: false,
			}),
			expect.objectContaining({
				id: "page:group",
				blockId: "group",
				script: "Check your understanding",
				src: "group.mp3",
				pauseAfter: false,
			}),
		]);
	});

	it("orders audio-only targets with paragraphs and an assessment", () => {
		const page = deckPageData(
			{
				id: "page",
				title: "",
				narrationEnabled: true,
				blocks: adaptGrammarPreviewBlocks([
					{ id: "intro", type: "text", data: { content: "Intro", narrationAudio: "intro.mp3" } },
					{ id: "silent-image", type: "image", data: { src: "silent.png", decorative: true } },
					{
						id: "image",
						type: "image",
						data: { src: "image.png", decorative: true, narrationAudio: "image.mp3" },
					},
					{ id: "outro", type: "text", data: { content: "Outro", narrationAudio: "outro.mp3" } },
					{
						id: "group",
						type: "assessmentGroup",
						data: { memberBlockIds: ["question"], narrationAudio: "group.mp3" },
					},
					{
						id: "question",
						type: "assessment",
						data: {
							assessmentType: "choice",
							stem: [{ id: "question-stem", type: "text", data: { content: "<p>Choose</p>" } }],
							response: {
								type: "choice",
								selectionMode: "single",
								options: [{ id: "yes", label: "Yes", isCorrect: true }],
							},
							narrationAudio: "question.mp3",
						},
					},
					{ id: "silent-group", type: "assessmentGroup", data: { memberBlockIds: [] } },
				]),
			},
			{},
			"page",
			"module",
			"en",
		);
		expect(page.segments.map(({ id, src }) => [id, src])).toEqual([
			["page:intro", "intro.mp3"],
			["page:image", "image.mp3"],
			["page:outro", "outro.mp3"],
			["page:group", "group.mp3"],
			["page:question", "question.mp3"],
		]);
	});

	it.each(["image", "assessmentGroup"] as const)(
		"keeps the deck pause when an empty %s precedes a native video",
		(type) => {
			const page = deckPageData(
				{
					id: "page",
					title: "",
					narrationEnabled: true,
					blocks: [
						{ id: "intro", type: "text", data: { content: "Intro", narrationAudio: "intro.mp3" } },
						{
							id: "empty",
							type,
							data: { src: "decoration.png", decorative: true, memberBlockIds: [] },
						},
						{ id: "media", type: "video", data: { src: "video.mp4" } },
						{ id: "outro", type: "text", data: { content: "Outro", narrationAudio: "outro.mp3" } },
					],
				},
				{},
				"page",
				"module",
				"en",
			);
			expect(page.segments.map(({ id, pauseAfter }) => [id, pauseAfter])).toEqual([
				["page:intro", true],
				["page:outro", false],
			]);
		},
	);

	it("keeps the deck pause around a native video", () => {
		const page = deckPageData(
			{
				id: "page",
				title: "Video break",
				narrationEnabled: true,
				blocks: [
					{ id: "intro", type: "text", data: { content: "Intro", narrationAudio: "intro.mp3" } },
					{ id: "media", type: "video", data: { src: "video.mp4" } },
					{ id: "outro", type: "text", data: { content: "Outro", narrationAudio: "outro.mp3" } },
				],
			} as never,
			{},
			"page",
			"module",
			"en",
		);
		expect(
			page.segments.filter((segment) => segment.src).map(({ id, pauseAfter }) => [id, pauseAfter]),
		).toEqual([
			["page:intro", true],
			["page:outro", false],
		]);
	});

	it("carries dialogue turn indices and speakers into deck segments", () => {
		const page = deckPageData(
			{
				id: "page",
				title: "Dialogue",
				narrationEnabled: true,
				blocks: [
					{
						id: "d1",
						type: "dialogue",
						data: {
							turns: [
								{ speaker: "roger", paragraphs: ["Hi."], narrationAudio: "a.mp3" },
								"junk",
								{ speaker: "roxanne", paragraphs: ["Yo."], narrationAudio: "b.mp3" },
							],
						},
					},
				],
			} as never,
			{},
			"dialogue",
			"module",
			"en",
		);
		expect(
			page.segments
				.filter((segment) => segment.id.includes("d1:item"))
				.map((segment) => [segment.turnIndex, segment.speaker]),
		).toEqual([
			[0, "roger"],
			[2, "roxanne"],
		]);
	});
	it("keeps card face targets separate from transcript segment IDs", () => {
		const page = deckPageData(
			{
				id: "page",
				title: "Cards",
				narrationEnabled: true,
				blocks: [
					{
						id: "cards",
						type: "card",
						data: {
							items: [
								{
									label: "Card",
									front: [{ id: "front", type: "text", data: { content: "Front" } }],
									back: [{ id: "back", type: "text", data: { content: "Back" } }],
									narrationAudio: "front.mp3",
									narrationBack: { narrationAudio: "back.mp3" },
								},
							],
						},
					},
				],
			},
			{},
			"cards",
			"module",
			"en",
		);
		expect(page.segments.filter((segment) => segment.src)).toMatchObject([
			{
				id: "page:cards:item:0",
				src: "front.mp3",
				cardTargets: [{ containerId: "cards", itemIndex: 0, side: "front" }],
			},
			{
				id: "page:cards:item:0:back",
				src: "back.mp3",
				cardTargets: [{ containerId: "cards", itemIndex: 0, side: "back" }],
			},
		]);
	});

	it("exports authored PDF link buttons with their style and new-tab attributes", async () => {
		const { blocks } = readBlockSource(
			"# Untitled {hideTitle}\n\n::: button [Download PDF](assets/file.pdf) {style=filled newTab}\n:::\n",
		);
		expect(blocks).toEqual([
			expect.objectContaining({
				type: "button",
				data: expect.objectContaining({ action: "link" }),
			}),
		]);
		const pages = [{ id: "downloads", title: "Downloads", blocks }];
		const dir = await mkdtemp(path.join(os.tmpdir(), "deck-link-"));
		try {
			const result = await generateHtmlPages(
				{ id: "links", title: "Links", sourceLocale: "en", moduleDeck: {}, pages, totalPages: 1 },
				dir,
				assets,
			);
			const html = await readFile(path.join(dir, `${result.pages[0].slug}.html`), "utf8");
			expect(html).toContain(
				'<a href="assets/file.pdf" class="praxity-button" data-variant="filled" target="_blank" rel="noopener noreferrer">Download PDF',
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
	it.each(["goToPage", "unknown"])("rejects button action %s", (action) => {
		expect(() =>
			validateModuleDeck({}, [
				{
					id: "slide",
					title: "Slide",
					blocks: [{ id: "button", type: "button", data: { action, targetPageId: "slide" } }],
				},
			]),
		).toThrow("does not support branching");
	});
	it("rejects conditional link buttons", () => {
		expect(() =>
			validateModuleDeck({}, [
				{
					id: "slide",
					title: "Slide",
					blocks: [{ id: "button", type: "button", data: { action: "link", visible: "ready" } }],
				},
			]),
		).toThrow("does not support branching");
	});
	it("keeps the complete script without audio and validates explicit gate rules", () => {
		const course = moduleDeckFixture();
		validateModuleDeck(course.moduleDeck ?? {}, course.content);
		expect(
			deckPageData(course.content[0], course.moduleDeck ?? {}, "one", "one", "en").segments.some(
				(item) => item.script.includes("complete reading script") && !item.src,
			),
		).toBe(true);
		const graded = {
			id: "graded",
			title: "Graded",
			blocks: [
				{ id: "graded-question", type: "assessment" as const, data: { gradingMode: "exact" } },
			],
		};
		expect(deckPageData(graded, {}, "graded", "graded", "en").gates).toEqual([
			{ id: "graded-question", rule: "pass" },
		]);
		expect(() => validateModuleDeck({ gates: { missing: "pass" } }, course.content)).toThrow(
			"Invalid module deck gate",
		);
		expect(
			deckPageData(
				{
					id: "safe",
					title: "Safe",
					blocks: [{ id: "constructor", type: "assessment", data: { required: false } }],
				},
				{ gates: {} },
				"safe",
				"safe",
				"en",
			).gates,
		).toEqual([]);
		const branching = structuredClone(course.content);
		branching[0].blocks.push({ id: "branch", type: "logic", data: {} });
		expect(() => validateModuleDeck({}, branching)).toThrow("does not support branching");
	});
	it("renders one module document with complete fallback content and slide aliases", async () => {
		const course = moduleDeckFixture();
		const dir = await mkdtemp(path.join(os.tmpdir(), "deck-compiler-"));
		try {
			const result = await generateHtmlPages(
				{
					id: course.id,
					title: course.title,
					sourceLocale: course.sourceLocale,
					moduleDeck: course.moduleDeck,
					pages: course.content,
					totalPages: course.content.length,
				},
				dir,
				assets,
			);
			const first = await readFile(path.join(dir, `${result.pages[0].slug}.html`), "utf8");
			expect(first.match(/data-deck-slide=/g)).toHaveLength(4);
			expect(first).toContain("complete reading script");
			expect(first).not.toContain('id="deck-jump"');
			expect(first).not.toContain("deck-settings");
			expect(first).not.toContain('<p data-block-id="slide-1:page-title">');
			expect(first).not.toContain('class="deck-script-seek"');
			expect(first).not.toMatch(/data-deck-reading="[^"]+"[^>]*><h2>/);
			expect(first).toContain('class="praxity-nav-prev" aria-label="Previous slide"');
			expect(first).toContain('"deck":true');
			expect(first).toContain('<body class="praxity-layout-slides">');
			expect(result.pages[0].runtime.presentation).toBe("module-deck");
			expect(first).toContain('"rule":"attempt"');
			expect(first).toContain('"rule":"pass"');
			expect(first).not.toMatch(/data-deck-slide="[^"]+"[^>]*hidden/);
			expect(result.pages[0].runtime.islands).toEqual(
				expect.arrayContaining(["deck", "assessment"]),
			);
			expect(result.pages[0].runtime.islands).not.toContain("narration");
			const alias = await readFile(path.join(dir, `${result.pages[1].slug}.html`), "utf8");
			expect(alias).toContain(`${result.pages[0].slug}.html#slide-2`);
			expect(alias).not.toContain("praxity-host-config");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

it("compiles deck preferences and honors module settings while retaining readable fallbacks", async () => {
	const course = moduleDeckFixture();
	course.content[0].blocks.push(...readBlockSource("[Example]{Definition}").blocks);
	course.content[0].data = {
		...course.content[0].data,
		deckDesign: {
			outline: false,
			initialPanel: "transcript",
			slideCounter: false,
			followNarration: false,
			autoAdvance: false,
		},
		deckNavigation: { navKeyboardArrows: false, navFloatingToc: true },
	};
	const dir = await mkdtemp(path.join(os.tmpdir(), "deck-design-"));
	try {
		const result = await generateHtmlPages(
			{
				id: course.id,
				title: course.title,
				sourceLocale: course.sourceLocale,
				moduleDeck: course.moduleDeck,
				pages: course.content,
				totalPages: course.content.length,
				glossaryTabEnabled: false,
			},
			dir,
			assets,
		);
		const html = await readFile(path.join(dir, `${result.pages[0].slug}.html`), "utf8");
		expect(html).toContain('id="deck-outline-toggle" hidden');
		expect(html).toContain('id="deck-position" hidden aria-hidden="true"');
		expect(html).toContain('id="deck-follow" aria-pressed="false"');
		expect(html).toContain('id="deck-advance" role="switch" aria-checked="false"');
		expect(html).toContain('"initialPanel":"transcript"');
		expect(html).toContain('"navKeyboardArrows":false');
		expect(html).toContain('"navFloatingToc":true');
		expect(html).toContain('id="deck-outline-sidebar" class="deck-panels"');
		expect(html).toContain("complete reading script");
		expect(html).toContain('id="deck-script-toggle"');
		expect(html).not.toContain('href="glossary.html"');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it.each(["en", "fr"])(
	"renders deck icons and localized glossary navigation in %s",
	async (locale) => {
		const course = moduleDeckFixture(undefined, locale);
		course.content[1].title = "Check: Practice";
		course.content[0].blocks.push(...readBlockSource("[Example]{Definition}").blocks);
		const dir = await mkdtemp(path.join(os.tmpdir(), "deck-icons-"));
		try {
			const result = await generateHtmlPages(
				{
					id: course.id,
					title: course.title,
					sourceLocale: locale,
					moduleDeck: course.moduleDeck,
					pages: course.content,
					totalPages: course.content.length,
				},
				dir,
				assets,
			);
			const html = await readFile(path.join(dir, `${result.pages[0].slug}.html`), "utf8");
			const strings = getStrings(locale);
			expect(html).toContain(
				`>${strings.glossaryHeading} ${EXTERNAL_LINK_ICON_HTML}<span class="praxity-sr-only">, ${strings.opensInNewTab}</span></a>`,
			);
			const assessment = locale === "fr" ? "Évaluation" : "Assessment";
			expect(html).toContain(`aria-label="Check: Practice, ${assessment}"`);
			const doc = new JSDOM(html).window.document;
			const practice = doc.querySelector(
				`#deck-outline a[aria-label="Check: Practice, ${assessment}"]`,
			);
			expect(practice?.textContent).toBe("Check: Practice");
			expect(practice?.querySelector("[data-deck-lock]")?.hasAttribute("hidden")).toBe(true);
			// The optional assessment gets the same icon without becoming a gate.
			expect(html).toContain(`aria-label="Reading, ${assessment}"`);
			expect(html).not.toContain(`aria-label="Introduction, ${assessment}"`);
			for (const [id, path] of [
				["deck-script-toggle", "M7 15h5"],
				["deck-follow", "M18 4v17"],
			]) {
				const button = html.match(
					new RegExp(`<button[^>]+id="${id}"[^>]*>[\\s\\S]*?</button>`),
				)?.[0];
				if (id === "deck-script-toggle") {
					expect(button).toContain(
						`<span class="deck-utility-label">${locale === "fr" ? "Transcription" : "Transcript"}</span>`,
					);
					expect(button).not.toContain('aria-label="');
					expect(button).not.toContain('title="');
				} else {
					expect(button).toContain('aria-label="');
					expect(button).toContain('title="');
				}
				expect(button).toContain('aria-hidden="true"');
				expect(button).toContain(`d="${path}"`);
			}
			const advance = html.match(/<button[^>]+id="deck-advance"[^>]*>[\s\S]*?<\/button>/)?.[0];
			expect(advance).toContain('role="switch" aria-checked="false"');
			expect(advance).toContain(
				`aria-label="${locale === "fr" ? "Avancer automatiquement" : "Auto-advance"}"`,
			);
			expect(advance).toContain('<circle cx="11" cy="11" r="7" fill="currentColor"/>');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
);

it("uses one aggregate gate for selected members and distinguishes survey attempts", () => {
	const course = groupedDeckFixture();
	for (const page of course.content) page.blocks = adaptGrammarPreviewBlocks(page.blocks);
	validateModuleDeck(course.moduleDeck ?? {}, course.content);
	const gates = course.content.map(
		(page) => deckPageData(page, course.moduleDeck ?? {}, "page", "module", "en").gates,
	);
	expect(gates).toEqual([
		[],
		[{ id: "experience-survey", rule: "attempt" }],
		[{ id: "chosen-check", rule: "pass" }],
		[],
	]);
	const survey = course.content[1];
	expect(deckPageData(survey, {}, "page", "module", "en").gates).toEqual([
		{ id: "experience-survey", rule: "attempt" },
	]);
	expect(() =>
		validateModuleDeck({ gates: { "experience-survey": "pass" } }, course.content),
	).toThrow("automatically checked");
	const check = course.content[2];
	const member = check.blocks.find((block) => block.type === "assessment");
	assert(member);
	member.data = { assessmentType: "textResponse", required: true, gradingMode: "none" };
	expect(() => validateModuleDeck(course.moduleDeck ?? {}, course.content)).toThrow(
		"automatically checked",
	);
	const group = check.blocks.find((block) => block.type === "assessmentGroup");
	assert(group);
	group.data.mode = "all";
	expect(() => validateModuleDeck(course.moduleDeck ?? {}, course.content)).not.toThrow();
	member.data.private = true;
	expect(() => validateModuleDeck(course.moduleDeck ?? {}, course.content)).toThrow(
		"Private responses",
	);
});

it.each([undefined, "currentModule", "moduleLinks"] as const)(
	"limits outline detail to the current module with %s settings",
	async (outlineDetail) => {
		const course = moduleDeckFixture();
		course.content.push({
			id: "module-two-end",
			lessonId: "module-two",
			lessonTitle: "Module two",
			title: "Second module ending",
			blocks: [],
		});
		const dir = await mkdtemp(path.join(os.tmpdir(), "deck-outline-"));
		try {
			const result = await generateHtmlPages(
				{
					id: course.id,
					title: course.title,
					sourceLocale: "en",
					moduleDeck: course.moduleDeck,
					pages: course.content,
					totalPages: course.content.length,
					deckDesign: { outlineDetail },
				},
				dir,
				assets,
			);
			for (const index of [0, 4]) {
				const html = await readFile(path.join(dir, `${result.pages[index].slug}.html`), "utf8");
				const outline = html.match(/<nav id="deck-outline"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
				const ids = Array.from(outline.matchAll(/data-deck-page="([^"]+)"/g), (match) => match[1]);
				expect(ids).toEqual(
					index === 0
						? [
								"slide-1",
								"slide-2",
								"slide-3",
								"slide-4",
								...(outlineDetail === "currentModule" ? [] : ["module-two"]),
							]
						: [
								...(outlineDetail === "currentModule" ? [] : ["slide-1"]),
								"module-two",
								"module-two-end",
							],
				);
				expect(outline).toContain(
					`<span class="deck-module-title">Module ${index === 0 ? "one" : "two"}</span>`,
				);
				if (outlineDetail !== "currentModule") {
					const otherId = index === 0 ? "module-two" : "slide-1";
					expect(outline).toContain(`class="deck-module-link" data-deck-page="${otherId}"`);
					const doc = new JSDOM(html).window.document;
					expect(
						doc.querySelector(`#deck-outline a[data-deck-page="${otherId}"]`)?.textContent,
					).toBe(`Module ${index === 0 ? "two" : "one"}`);
					expect(outline).toContain(`.html#${otherId}"`);
					expect(outline).not.toContain("data-deck-module");
				}
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
);

it("renders opted-in module identity with title switches and no duplicate titles", async () => {
	const course = moduleDeckFixture();
	const dir = await mkdtemp(path.join(os.tmpdir(), "deck-identity-"));
	try {
		for (const [nav, expected] of [
			[{}, []],
			[{ navTopBar: false }, []],
			[{ navTopBar: true }, ["Course identity", "Module identity"]],
			[{ navTopBar: true, navCourseTitle: false }, ["Module identity"]],
			[{ navTopBar: true, navLessonTitles: false }, ["Course identity"]],
			[{ navTopBar: true, navCourseTitle: false, navLessonTitles: false }, []],
		] as const) {
			const pages = course.content.map((page) => ({ ...page, lessonTitle: "Module identity" }));
			const result = await generateHtmlPages(
				{
					id: course.id,
					title: "Course identity",
					sourceLocale: "en",
					pages,
					totalPages: pages.length,
					moduleDeck: course.moduleDeck,
					navToggles: nav,
				},
				dir,
				assets,
			);
			const html = await readFile(path.join(dir, `${result.pages[0].slug}.html`), "utf8");
			const header =
				html.match(/<header class="praxity-top-bar deck-identity">(.*?)<\/header>/)?.[1] ?? "";
			for (const title of ["Course identity", "Module identity"]) {
				expect(header.includes(title)).toBe((expected as readonly string[]).includes(title));
			}
		}
		const pages = course.content.map((page) => ({ ...page, lessonTitle: "Course identity" }));
		const result = await generateHtmlPages(
			{
				id: course.id,
				title: "Course identity",
				sourceLocale: "en",
				pages,
				totalPages: pages.length,
				moduleDeck: course.moduleDeck,
				navToggles: { navTopBar: true },
			},
			dir,
			assets,
		);
		const html = await readFile(path.join(dir, `${result.pages[0].slug}.html`), "utf8");
		const header =
			html.match(/<header class="praxity-top-bar deck-identity">(.*?)<\/header>/)?.[1] ?? "";
		expect(header.match(/Course identity/g)).toHaveLength(1);
		expect(header).toContain('class="deck-module-title"');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("compiles one safe formatted reading segment without changing its stable audio identity", async () => {
	const course = moduleDeckFixture();
	const script =
		'# [sincerely] Reading context\n\n[delighted] Read **bold** and *italic*. [sighs] [star watcher]\n\n- First\n- Second\n\n1. One\n2. Two\n\n<img src=x onerror="bad()">';
	course.content[0].blocks.push({
		id: "formatted-reading",
		type: "text",
		data: {
			content: "Slide summary.",
			narration: script,
			narrationAudio: "assets/existing.mp3",
			narrationTimings: "assets/existing.vtt",
		},
	});
	course.content[0].narrationEnabled = true;
	const data = deckPageData(course.content[0], {}, "one", "one", "en");
	expect(data.segments.find((segment) => segment.blockId === "formatted-reading")).toMatchObject({
		id: `${course.content[0].id}:formatted-reading`,
		script,
		src: "assets/existing.mp3",
		timings: "assets/existing.vtt",
	});
	const dir = await mkdtemp(path.join(os.tmpdir(), "deck-reading-"));
	try {
		const result = await generateHtmlPages(
			{
				id: course.id,
				title: course.title,
				sourceLocale: "en",
				moduleDeck: {},
				pages: course.content,
				totalPages: course.content.length,
			},
			dir,
			assets,
		);
		const html = await readFile(path.join(dir, `${result.pages[0].slug}.html`), "utf8");
		const transcript = html.match(
			/<div class="deck-script-content praxity-transcript-content" data-block-id="slide-1:formatted-reading">([\s\S]*?)<\/div>/,
		)?.[1];
		expect(transcript).toContain("<h3>Reading context</h3>");
		expect(transcript).not.toContain("[sincerely]");
		expect(transcript).not.toContain("[delighted]");
		expect(transcript).toContain("[sighs] [star watcher]");
		expect(html).toContain('aria-label="Go here: Reading context"');
		expect(html).not.toContain('role="complementary" id="deck-outline-sidebar"');
		expect(transcript).toContain("<strong>bold</strong> and <em>italic</em>");
		expect(transcript).toContain("<ul>\n<li>First</li>");
		expect(transcript).toContain("<ol>\n<li>One</li>");
		expect(transcript).toContain("&lt;img");
		expect(transcript).not.toContain("<img");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("puts derived card headings on separate transcript lines without pause cues", async () => {
	const course = moduleDeckFixture();
	course.content[0].narrationEnabled = true;
	course.content[0].blocks.push({
		id: "communication",
		type: "card",
		data: { items: [{ label: "Assertif", content: "Vous exprimez vos besoins." }] },
	});
	const dir = await mkdtemp(path.join(os.tmpdir(), "deck-item-heading-"));
	try {
		const result = await generateHtmlPages(
			{
				id: course.id,
				title: course.title,
				sourceLocale: "fr",
				moduleDeck: {},
				pages: [course.content[0]],
				totalPages: 1,
			},
			dir,
			assets,
		);
		const html = await readFile(path.join(dir, `${result.pages[0].slug}.html`), "utf8");
		const doc = new JSDOM(html).window.document;
		const transcript = doc.querySelector(
			'.deck-script-content[data-block-id="slide-1:communication:item:0"]',
		);
		assert(transcript);
		expect([...transcript.children].map((line) => [line.tagName, line.textContent])).toEqual([
			["P", "Assertif"],
			["P", "Vous exprimez vos besoins."],
		]);
		expect(transcript.textContent).not.toContain("[pause]");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("compiles a derived four-item text list in the deck transcript", async () => {
	const course = moduleDeckFixture();
	const { blocks } = readBlockSource(
		"# Untitled {hideTitle}\n\n- Previous and next\n- Course outline\n- Transcript\n- Larger text\n",
	);
	expect(blocks).toHaveLength(1);
	expect(blocks[0].type).toBe("text");
	course.content[0].blocks.push({ ...blocks[0], id: "navigation-list" });
	course.content[0].narrationEnabled = true;
	const dir = await mkdtemp(path.join(os.tmpdir(), "deck-derived-list-"));
	try {
		const result = await generateHtmlPages(
			{
				id: course.id,
				title: course.title,
				sourceLocale: "en",
				moduleDeck: {},
				pages: [course.content[0]],
				totalPages: 1,
			},
			dir,
			assets,
		);
		const html = await readFile(path.join(dir, `${result.pages[0].slug}.html`), "utf8");
		const doc = new JSDOM(html).window.document;
		const items = doc.querySelectorAll(
			'.deck-script-content[data-block-id="slide-1:navigation-list"] ul > li',
		);
		expect([...items].map((item) => item.textContent)).toEqual([
			"Previous and next",
			"Course outline",
			"Transcript",
			"Larger text",
		]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("shows escaped dialogue speaker names outside the transcript script in English and French", async () => {
	const course = moduleDeckFixture();
	course.content[0].narrationEnabled = true;
	course.content[0].blocks.push({
		id: "d1",
		type: "dialogue",
		data: {
			turns: [
				{
					speaker: "roger",
					name: '<img src=x onerror=alert(1)> & "q" </script>',
					paragraphs: ["[warm] Hi there."],
					narrationAudio: "a.mp3",
				},
				{ speaker: "roxanne", name: "روكسان", paragraphs: ["Hello."], narrationAudio: "b.mp3" },
				{ paragraphs: ["Nobody."], narrationAudio: "c.mp3" },
			],
		},
	});
	const dir = await mkdtemp(path.join(os.tmpdir(), "deck-speakers-"));
	try {
		for (const locale of ["en", "fr"]) {
			const result = await generateHtmlPages(
				{
					id: course.id,
					title: course.title,
					sourceLocale: locale,
					moduleDeck: {},
					pages: [course.content[0]],
					totalPages: 1,
				},
				dir,
				assets,
			);
			const html = await readFile(path.join(dir, `${result.pages[0].slug}.html`), "utf8");
			const doc = new JSDOM(html).window.document;
			const passages = [...doc.querySelectorAll("[data-deck-segment]")].filter((el) =>
				el.getAttribute("data-deck-segment")?.includes("d1:item"),
			);
			const suffix = locale === "fr" ? " :" : ":";
			expect(
				passages.map((el) => el.querySelector(".deck-script-speaker")?.textContent ?? null),
			).toEqual([`<img src=x onerror=alert(1)> & "q" </script>${suffix}`, `روكسان${suffix}`, null]);
			expect(passages[0].querySelector(".deck-script-speaker bdi")?.textContent).toBe(
				'<img src=x onerror=alert(1)> & "q" </script>',
			);
			expect(doc.querySelector(".deck-script-speaker img, #deck-script script")).toBeNull();
			expect(passages[0].querySelector(".deck-script-content")?.textContent).toBe("Hi there.");
			expect(passages[1].querySelector(".deck-script-seek")?.getAttribute("aria-label")).toContain(
				`روكسان${suffix}`,
			);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
