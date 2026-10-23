import { deepStrictEqual } from "node:assert";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { FullConfig } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import handler from "serve-handler";
import { DEFAULT_DESIGN_VARIANTS } from "../../../editor-core/src/lib/themes/design-variant-defaults";
import { deriveSectionPalettes } from "../../../editor-core/src/lib/themes/resolve-theme";
import {
	buildScormPackage,
	type CourseExportInput,
	type DesktopExportInput,
} from "../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../src/desktop-design";
import { buildDesignNavigationFixtures } from "../fixtures/design-navigation";
import { loadAuthoringCatalogFixture, loadGrammarFixture } from "../fixtures/load-grammar-fixture";
import { moduleDeckFixture } from "../fixtures/module-deck";
import { fixtureSelfCheckInputs } from "../fixtures/self-check";
import { silentWav } from "../fixtures/silent-audio";
import { runFixtureBuilds } from "./fixture-builds";
import { activityBugsFixture } from "./fixtures/activity-bugs-fixture";
import { activityCardsFixture } from "./fixtures/activity-cards-fixture";
import { activityTypographyFixture } from "./fixtures/activity-typography-fixture";
import {
	ASSESSMENT_REVIEW_THEMES,
	buildAssessmentReviewCourse,
} from "./fixtures/assessment-review-fixture";
import { buildChoiceControlAlignmentCourse } from "./fixtures/choice-control-alignment-fixture";
import { containerLayoutsFixture } from "./fixtures/container-layouts-fixture";
import { designColorsTypographyFixtures } from "./fixtures/design-colors-typography-fixture";
import { designContainerSurfaceFixtures } from "./fixtures/design-container-surfaces-fixture";
import { buildDesignLayoutMotionFixtures } from "./fixtures/design-layout-motion-fixture";
import { designSeparatorFixtures } from "./fixtures/design-separators-fixture";
import { DIALOGUE_PALETTES, dialogueLayoutFixture } from "./fixtures/dialogue-layout-fixture";
import { DONT_KNOW_PALETTES, dontKnowFixture } from "./fixtures/dont-know-fixture";
import { buildFillBlankVariantsCourse } from "./fixtures/fill-blank-variants-fixture";
import { buildInlineFeaturesCourse } from "./fixtures/inline-features-fixture";
import {
	blankPanelPng,
	buildLearnerPolishCourse,
	LEARNER_POLISH_VARIANTS,
	POLISH_IMAGE_URL,
} from "./fixtures/learner-polish-fixture";
import {
	buildHiddenBlocksCourse,
	buildLightweightCourse,
	buildRevealCourse,
	buildSlidesNarrationCourse,
	FIXTURE_AUDIO_URL,
	FIXTURE_IMAGE_URL,
	NAV_CONFIGS,
	navConfigName,
	THEME_CONFIGS,
} from "./fixtures/lightweight-fixture";
import { buildModuleNavigationCourse } from "./fixtures/module-navigation-fixture";
import { buildPagesArrivalCourse } from "./fixtures/pages-arrival-fixture";
import { radiusRolesFixture } from "./fixtures/radius-roles-fixture";
import { revealFixture } from "./fixtures/reveal-fixture";
import { writeStandaloneOutcomeFixtures } from "./fixtures/standalone-outcome-fixture";
import { buildVisitedStatusCourse } from "./fixtures/visited-status-fixture";
import { type CoursePageMeta, DISCOVERY_SELECTORS } from "./helpers";

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
	// The design-system capture runner already serves fresh scratch exports.
	if (process.env.PRAXITY_DESIGN_SYSTEM_ENV) return async () => {};
	const started = performance.now();
	const cleanup = await prepareFixtureEnvironment(buildFixtures);
	console.log(`Accessibility fixture setup: ${Math.round(performance.now() - started)} ms`);
	return cleanup;
}

export async function prepareFixtureEnvironment(
	prepare: (
		directory: string,
		manifest: string,
		onServerCreated: (server: ReturnType<typeof createServer>) => void,
	) => Promise<void>,
	removeOutput: (directory: string) => Promise<void> = (directory) =>
		rm(directory, { recursive: true, force: true }),
): Promise<() => Promise<void>> {
	const tmpDir = await mkdtemp(resolve(tmpdir(), "export-pipeline-a11y-"));
	const previousEnvPath = process.env.PRAXITY_A11Y_ENV_PATH;
	const testEnvPath = resolve(tmpDir, "test-env.json");
	process.env.PRAXITY_A11Y_ENV_PATH = testEnvPath;
	const restoreFetch = stubFixtureDownloads();
	let server: ReturnType<typeof createServer> | undefined;
	const cleanup = async () => {
		try {
			if (server?.listening) {
				server.closeAllConnections();
				await new Promise<void>((done) => server?.close(() => done()));
			}
			await removeOutput(tmpDir);
		} finally {
			if (previousEnvPath === undefined) delete process.env.PRAXITY_A11Y_ENV_PATH;
			else process.env.PRAXITY_A11Y_ENV_PATH = previousEnvPath;
		}
	};
	try {
		await prepare(tmpDir, testEnvPath, (created) => {
			server = created;
		});
		return cleanup;
	} catch (error) {
		try {
			await cleanup();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Accessibility fixture setup and cleanup failed",
			);
		}
		throw error;
	} finally {
		restoreFetch();
	}
}

function extractPagesFromHtmlConfig(html: string): CoursePageMeta[] {
	const configMatch = html.match(
		/<script id="praxity-config" type="application\/json">([\s\S]*?)<\/script>/,
	);
	if (!configMatch?.[1]) return [];

	try {
		const parsed = JSON.parse(configMatch[1]) as {
			pages?: Array<{ slug?: string; title?: string }>;
		};
		if (!Array.isArray(parsed.pages)) return [];
		return parsed.pages
			.filter((entry) => typeof entry.slug === "string" && entry.slug.trim().length > 0)
			.map((entry) => ({
				slug: String(entry.slug),
				title:
					typeof entry.title === "string" && entry.title.trim().length > 0
						? entry.title
						: String(entry.slug),
			}));
	} catch {
		return [];
	}
}

async function readCoursePagesFromDist(distDir: string): Promise<CoursePageMeta[]> {
	const files = await readdir(distDir);
	const candidateHtmlFiles = files.filter(
		(file) => file.endsWith(".html") && file !== "index.html",
	);

	for (const htmlFile of candidateHtmlFiles) {
		const fullPath = resolve(distDir, htmlFile);
		const html = await readFile(fullPath, "utf-8");
		const pages = extractPagesFromHtmlConfig(html);
		if (pages.length > 0) {
			return pages;
		}
	}

	return [];
}

function courseVariant(
	course: DesktopExportInput,
	overrides: Partial<CourseExportInput>,
): DesktopExportInput {
	if (!course.frontmatter.design) {
		throw new Error("The accessibility fixture must define a design");
	}
	const design = {
		...course.frontmatter.design,
		...(overrides.colorMode ? { colorMode: overrides.colorMode } : {}),
		...(overrides.navigationStyle ? { navArchetype: overrides.navigationStyle } : {}),
		...(overrides.navToggles ?? {}),
	};
	return {
		...course,
		frontmatter: { ...course.frontmatter, design },
	};
}

const FIXTURE_DOCUMENT_URL = "https://example.com/accessibility-checklist.pdf";
const FIXTURE_DOCUMENT_PATH = resolve(
	import.meta.dirname,
	"../../../../docs/test-fixtures/assets/test-document.pdf",
);
const FIXTURE_AUDIO_PATH = resolve(
	import.meta.dirname,
	"../../../../docs/test-fixtures/assets/test-audio.mp3",
);
const DIALOGUE_AUDIO_PATHS = [0, 1, 2].map((index) => `assets/dialogue-turn-${index}.mp3`);
const FIXTURE_IMAGE_PATH = resolve(
	import.meta.dirname,
	"../../../../docs/test-fixtures/assets/test-image.webp",
);
const FIXTURE_DOWNLOADS = new Map<string, { bytes: () => Promise<Uint8Array>; mediaType: string }>([
	[
		FIXTURE_DOCUMENT_URL,
		{ bytes: () => readFile(FIXTURE_DOCUMENT_PATH), mediaType: "application/pdf" },
	],
	[FIXTURE_AUDIO_URL, { bytes: () => readFile(FIXTURE_AUDIO_PATH), mediaType: "audio/mpeg" }],
	[FIXTURE_IMAGE_URL, { bytes: () => readFile(FIXTURE_IMAGE_PATH), mediaType: "image/webp" }],
	[
		"https://deck.example/slide.webp",
		{ bytes: () => readFile(FIXTURE_IMAGE_PATH), mediaType: "image/webp" },
	],
	[POLISH_IMAGE_URL, { bytes: async () => blankPanelPng(), mediaType: "image/png" }],
]);

/**
 * Serve the fixture's remote assets from disk.
 *
 * `resolveAssets` downloads remote assets at build time, so the suite depended on
 * example.com answering. When it 404'd, the build threw, this setup died, and the
 * run continued against a stale `.test-env.json` — reporting on an export nobody
 * had just built, which is how a flake became a wrong diagnosis.
 *
 * The document URL must stay remote because the parser only builds that block
 * from a remote URL. The audio and image URLs exercise the same resolver path
 * used by authored media. Unexpected requests fail without reaching the network.
 */
export function stubFixtureDownloads(): () => void {
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const fixture = FIXTURE_DOWNLOADS.get(url);
		if (!fixture) throw new Error(`Unexpected fixture download: ${url}`);
		const bytes = await fixture.bytes();
		return new Response(new Uint8Array(bytes), {
			status: 200,
			headers: { "content-type": fixture.mediaType },
		});
	}) as typeof globalThis.fetch;
	return () => {
		globalThis.fetch = realFetch;
	};
}

async function buildFixtures(
	tmpDir: string,
	testEnvPath: string,
	onServerCreated: (server: ReturnType<typeof createServer>) => void,
): Promise<void> {
	const builds: Array<() => Promise<void>> = [];
	const distDir = resolve(tmpDir, "dist");
	await mkdir(distDir, { recursive: true });
	const reveals = revealFixture();
	const revealOutput = await buildScormPackage(
		{
			...reveals,
			selfCheckContents: fixtureSelfCheckInputs(reveals.content.flatMap((page) => page.blocks)),
		},
		{ format: "html" },
	);
	new AdmZip(revealOutput.zip).extractAllTo(resolve(distDir, "shared-reveals"), true);
	await writeStandaloneOutcomeFixtures(distDir);

	const { course, buildOptions } = await loadGrammarFixture();
	const result = await buildScormPackage(course, { ...buildOptions, format: "html" });
	const conformanceFixture = await loadGrammarFixture(
		JSON.parse(
			await readFile(
				resolve(
					import.meta.dirname,
					"../../../../docs/test-fixtures/sample-course-pagespeed-extras.json",
				),
				"utf-8",
			),
		),
	);
	// Supplemental audit pages belong before the summary so it remains the course end.
	const auditBlocks = conformanceFixture.course.blocks;
	const summaryFirstBlock = conformanceFixture.pages.find((page) => page.title === "Summary")
		?.blocks[0];
	if (!summaryFirstBlock) throw new Error("Conformance fixture has no summary content");
	const summaryContentStart = auditBlocks.findIndex((block) => block.id === summaryFirstBlock.id);
	const summaryStart = auditBlocks
		.slice(0, summaryContentStart)
		.reduce((last, block, index) => (block.type === "pageBreak" ? index : last), -1);
	if (summaryStart < 0) throw new Error("Conformance fixture has no summary boundary");
	const supplementStart = auditBlocks.findIndex(
		(block, index) => index > summaryStart && block.type === "pageBreak",
	);
	if (supplementStart < 0) throw new Error("Conformance fixture has no supplemental pages");
	auditBlocks.push(...auditBlocks.splice(summaryStart, supplementStart - summaryStart));
	const conformanceResult = await buildScormPackage(conformanceFixture.course, {
		...conformanceFixture.buildOptions,
		format: "html",
	});
	const conformanceDir = resolve(distDir, "course-conformance");
	new AdmZip(conformanceResult.zip).extractAllTo(conformanceDir, true);

	const catalog = await loadAuthoringCatalogFixture();
	const catalogResult = await buildScormPackage(catalog.course, {
		...catalog.buildOptions,
		format: "html",
	});
	new AdmZip(catalogResult.zip).extractAllTo(resolve(distDir, "authoring-catalog"), true);
	const frenchHotspotBlocks = readLesson(
		"# Hotspot question {hideTitle}\n\n::: hotspot Sélectionnez les zones pertinentes de l'image. {scored points=10 attempts=2}\n![Commandes de l'équipement avec une vanne et un manomètre](/assets/test-hotspot.webp)\n- Vanne {x=30 y=40 correct}\n- Manomètre {x=60 y=50}\n:::\n\n# Hotspot legacy {hideTitle}\n\n::: hotspot Sélectionnez les zones pertinentes de l'image. {scored points=10 attempts=2}\n![Commandes de l'équipement avec une vanne et un manomètre](/assets/test-hotspot.webp)\n- Vanne {x=30 y=40 correct}\n- Manomètre {x=60 y=50}\n:::\n",
	);
	const legacyHotspot = frenchHotspotBlocks.pages[1].blocks.find(
		(block) => block.type === "assessment",
	);
	if (!legacyHotspot) throw new Error("Missing French stemless hotspot fixture");
	legacyHotspot.data.stem = [];
	const frenchHotspots = await buildScormPackage(
		{
			...catalog.course,
			courseId: "french-hotspots",
			frontmatter: { ...catalog.course.frontmatter, title: "Zones de l'image", lang: "fr" },
			locale: "fr",
			blocks: frenchHotspotBlocks.blocks,
		},
		{ ...catalog.buildOptions, format: "html" },
	);
	new AdmZip(frenchHotspots.zip).extractAllTo(resolve(distDir, "french-hotspots"), true);
	for (const locale of ["en", "fr"] as const) {
		builds.push(async () => {
			const result = await buildScormPackage(activityBugsFixture(locale), { format: "html" });
			new AdmZip(result.zip).extractAllTo(resolve(distDir, `activity-bugs-${locale}`), true);
		});
	}
	for (const [locale, lessonTitle] of [
		["en", "Lesson 1"],
		["fr", "Leçon 1"],
	] as const) {
		for (const kind of ["authored", "untitled"] as const) {
			builds.push(async () => {
				const course = buildVisitedStatusCourse(locale, false);
				course.id = `${kind}-header-${locale}`;
				course.content.forEach((page, index) => {
					page.lessonId = kind;
					page.lessonTitle =
						kind === "untitled"
							? lessonTitle
							: locale === "fr"
								? "Module de pratique"
								: "Practice module";
					page.lessonTitleIsFallback = kind === "untitled";
					page.isFirstPageOfLesson = index === 0;
				});
				const result = await buildScormPackage(course, { format: "html" });
				new AdmZip(result.zip).extractAllTo(resolve(distDir, course.id), true);
			});
		}
	}
	for (const palette of ["ink", "forest", "plum", "clay", "clear"] as const) {
		for (const colorMode of ["light", "dark"] as const) {
			for (const locale of ["en", "fr"] as const) {
				builds.push(async () => {
					const themed = buildLightweightCourse({ theme: { name: palette, palette, colorMode } });
					const activity = activityBugsFixture(locale);
					const course = {
						...activity,
						...themed,
						id: activity.id,
						title: activity.title,
						content: activity.content,
						sourceLocale: locale === "en" ? "en-GB" : "fr-CA",
					};
					const blocks = course.content[0].blocks;
					const journal = blocks.find((block) => block.id === "journal");
					if (!journal) throw new Error("Missing journal fixture");
					blocks.push({
						...journal,
						id: "plain-response",
						data: {
							...journal.data,
							private: false,
							stem: [{ id: "plain-stem", type: "text", data: { content: "A plain response" } }],
						},
					});
					const result = await buildScormPackage(course, { format: "html" });
					new AdmZip(result.zip).extractAllTo(
						resolve(distDir, `${palette}-${colorMode}-${locale}`),
						true,
					);
				});
			}
		}
	}
	for (const [locale, dark] of [
		["en", false],
		["en", true],
		["fr", false],
	] as const) {
		builds.push(async () => {
			const result = await buildScormPackage(activityCardsFixture(locale, dark), {
				format: "html",
			});
			new AdmZip(result.zip).extractAllTo(
				resolve(distDir, `activity-cards-${locale}-${dark ? "dark" : "light"}`),
				true,
			);
		});
	}

	for (const palette of DONT_KNOW_PALETTES) {
		for (const dark of [false, true]) {
			builds.push(async () => {
				const fixture = dontKnowFixture(palette, dark, "en");
				const result = await buildScormPackage(fixture, { format: "html" });
				new AdmZip(result.zip).extractAllTo(resolve(distDir, fixture.id), true);
			});
		}
	}
	for (const deck of [false, true]) {
		builds.push(async () => {
			const fixture = dontKnowFixture("ink", false, "fr", deck);
			const result = await buildScormPackage(fixture, { format: "html" });
			new AdmZip(result.zip).extractAllTo(resolve(distDir, fixture.id), true);
		});
	}
	const frenchMatrix = readLesson(
		"# Untitled {hideTitle}\n\n::: categorize Classez chaque réaction {level=3}\n:: La critique\n- Tu oublies toujours de mettre le dossier à jour.\n- Franchement, même un stagiaire aurait fait mieux.\n:: La défensive\n- Oui, mais si tu m'avais donné les bonnes informations, ce ne serait pas arrivé.\n:: Le mépris\n- Rouler des yeux pendant qu'une collègue présente son idée.\n:: L'évitement\n- Se taire et fixer son écran jusqu'à la fin de la réunion.\n:::\n\n::: matrix Quelle réaction reconnaissez-vous ? {level=3}\n1. La critique\n2. La défensive\n3. Le mépris\n4. L'évitement\n- Tu oublies toujours de mettre le dossier à jour.\n- Rouler des yeux pendant qu'une collègue présente son idée.\n:::\n",
	).blocks;
	const frenchLayout = await buildScormPackage(
		{
			...catalog.course,
			courseId: "french-matrix-layout",
			blocks: frenchMatrix,
			frontmatter: { ...catalog.course.frontmatter, title: "Classez chaque réaction", lang: "fr" },
			locale: "fr",
		},
		{ ...catalog.buildOptions, format: "html" },
	);
	new AdmZip(frenchLayout.zip).extractAllTo(resolve(distDir, "french-matrix-layout"), true);
	const frenchLayoutPages = await readCoursePagesFromDist(resolve(distDir, "french-matrix-layout"));
	if (!frenchLayoutPages[0]) throw new Error("French matrix fixture has no page");
	const designDeck = await buildScormPackage(moduleDeckFixture(undefined, "fr"), {
		format: "html",
	});
	new AdmZip(designDeck.zip).extractAllTo(resolve(distDir, "design-deck"), true);
	for (const locale of ["en", "fr"] as const) {
		builds.push(async () => {
			const course = moduleDeckFixture(undefined, locale);
			course.id = `outline-glossary-${locale}`;
			course.content[0].blocks.push({
				id: "glossary-text",
				type: "text",
				data: { content: "[Gate]{An activity before continuing.}" },
			});
			course.content.forEach((page) => {
				page.blocks = page.blocks.filter((block) => block.type !== "image");
			});
			course.deckDesign = { outline: true, initialPanel: "outline" };
			const result = await buildScormPackage(course, { format: "html" });
			new AdmZip(result.zip).extractAllTo(resolve(distDir, course.id), true);
		});
	}
	for (const palette of ["ink", "forest", "plum", "clay", "clear"] as const) {
		for (const colorMode of ["light", "dark"] as const) {
			const theme = buildLightweightCourse({ theme: { name: palette, palette, colorMode } });
			for (const presentation of ["pages", "deck"] as const) {
				builds.push(async () => {
					const course = buildVisitedStatusCourse("fr", false);
					course.id = `outline-${presentation}-${palette}-${colorMode}`;
					course.title = "Apprendre ensemble";
					course.content[1].title =
						"Vérifiez votre compréhension des cartes et coordonnées dans notre observatoire";
					course.content[1].blocks = [
						{
							id: "outline-reading",
							type: "text",
							data: { content: "Prenez le temps de lire avant de continuer." },
						},
					];
					course.cssVars = theme.cssVars;
					course.colorMode = colorMode;
					if (presentation === "deck") {
						for (const [index, page] of course.content.entries()) {
							page.lessonId = "outline-module";
							page.lessonTitle = "Lire et réfléchir";
							page.isFirstPageOfLesson = index === 0;
						}
						course.navigationStyle = "slides";
						course.moduleDeck = { gates: {} };
						course.deckDesign = { outline: true, initialPanel: "outline" };
					}
					const result = await buildScormPackage(course, { format: "html" });
					new AdmZip(result.zip).extractAllTo(resolve(distDir, course.id), true);
				});
			}
		}
	}
	for (const palette of ["ink", "forest", "plum", "clay", "clear"]) {
		for (const colorMode of ["light", "dark"] as const) {
			for (const deck of [false, true]) {
				builds.push(async () => {
					const course = radiusRolesFixture(palette, colorMode, deck);
					const output = resolve(distDir, course.id);
					const result = await buildScormPackage(course, { format: "html" });
					new AdmZip(result.zip).extractAllTo(output, true);
					if (!deck) {
						const stylesheets = await readdir(output);
						const full = stylesheets.find((file) => /^styles\.[a-f0-9]+\.css$/.test(file));
						if (!full) throw new Error("Missing full CSS radius fixture");
						await writeFile(resolve(output, "full-css.json"), JSON.stringify(full));
					}
				});
			}
		}
	}
	const narratedDesignDeck = await buildScormPackage(moduleDeckFixture(FIXTURE_AUDIO_URL, "fr"), {
		format: "html",
	});
	new AdmZip(narratedDesignDeck.zip).extractAllTo(resolve(distDir, "design-deck-narrated"), true);
	const deckLayout = moduleDeckFixture(undefined, "fr");
	deckLayout.content = deckLayout.content.slice(0, 1);
	deckLayout.content[0].blocks.push(...structuredClone(frenchMatrix));
	deckLayout.moduleDeck = { gates: {} };
	const frenchDeck = await buildScormPackage(deckLayout, { format: "html" });
	new AdmZip(frenchDeck.zip).extractAllTo(resolve(distDir, "french-matrix-deck"), true);
	const frenchDeckPages = await readCoursePagesFromDist(resolve(distDir, "french-matrix-deck"));
	if (!frenchDeckPages[0]) throw new Error("French matrix deck fixture has no page");
	const statsGrid = await buildScormPackage(
		{
			...catalog.course,
			courseId: "block-presentation-stats",
			blocks: readLesson(
				"# Statistics\n\n::: stats {columns=4 size=very-large}\n| Nearly 25% | Près d'un quart des participantes et participants ont répondu à cette question après avoir lu toutes les instructions. |\n| 41% | People who completed the full set of activities. |\n| 3,215 | Responses collected from all regions. |\n| 720,000 | Learners reached through the programme. |\ncaption: Source: annual participation report\n:::\n",
			).blocks,
			frontmatter: { ...catalog.course.frontmatter, title: "Statistics" },
		},
		{ ...catalog.buildOptions, format: "html" },
	);
	new AdmZip(statsGrid.zip).extractAllTo(resolve(distDir, "block-presentation-stats"), true);
	const captionedVideoDir = resolve(distDir, "captioned-video");
	const readingGeometry = await buildScormPackage(
		{
			...catalog.course,
			courseId: "reading-geometry",
			blocks: readLesson(`# Reading geometry

::: cards {columns=1}
:: A long card heading that wraps onto a second line {level=3}
Start with the action you want the reader to take.
:::

::: cards {columns=2 layout=grid}
:: Assertif {level=3}
Start with a short action.
:: Agressif {level=3}
This longer description explains the action, its context and the next step. It repeats enough detail to wrap across several lines and make this card taller than its neighbour.
:: Passif {level=3}
This longer description explains the action, its context and the next step. It repeats enough detail to wrap across several lines and make this card taller than its neighbour.
:: Passif-agressif {level=3}
Start with a short action.
:::

::: stats
| 142% | Privacy and security settings for international Platform Infrastructure teams, 1,284 hours, 1,000,000 participants |
:::

::: comparison {layout=slider}
:: Privacy and security settings before the change for international teams {level=3}
![Before the change](${FIXTURE_IMAGE_URL})
:: Privacy and security settings after the change for international teams {level=3}
![After the change](${FIXTURE_IMAGE_URL})
:::

$$
x_{internationalisation} = \\frac{12345678.9 + 0.30000000000000004}{0.000000001}
$$
`).blocks,
			frontmatter: { ...catalog.course.frontmatter, title: "Reading geometry" },
		},
		{ ...catalog.buildOptions, format: "html" },
	);
	new AdmZip(readingGeometry.zip).extractAllTo(resolve(distDir, "reading-geometry"), true);
	const captionedVideo = await buildScormPackage(
		{
			courseId: "captioned-video",
			blocks: readLesson(
				"# Untitled {hideTitle}\n\n::: video /assets/test-video.mp4 {captions=/assets/intro%20caption.vtt}\n:::\n",
			).blocks,
			frontmatter: { title: "Captioned Video", lang: "fr" },
			config: { completionThreshold: 0.8 },
			resolvedAssets: new Map([
				[
					"assets/test-video.mp4",
					await readFile(
						resolve(import.meta.dirname, "../../../../docs/test-fixtures/assets/test-video.mp4"),
					),
				],
				[
					"assets/intro caption.vtt",
					new TextEncoder().encode("WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nBonjour.\n"),
				],
			]),
			viewerVersion: "local",
			locale: "fr",
		} satisfies DesktopExportInput,
		{ ...buildOptions, format: "html" },
	);
	new AdmZip(captionedVideo.zip).extractAllTo(captionedVideoDir, true);
	const captionedVideoPages = await readCoursePagesFromDist(captionedVideoDir);
	if (!captionedVideoPages[0]) throw new Error("Captioned video fixture has no page");

	const dialogueAudio = await readFile(FIXTURE_AUDIO_PATH);
	const dialogue = await buildScormPackage(
		{
			courseId: "dialogue",
			blocks: [
				{
					id: "dialogue-page",
					type: "pageBreak",
					data: { id: "dialogue-page", title: "Dialogue", _narrationEnabled: true },
				},
				{ id: "dialogue-heading", type: "heading", data: { level: 1, content: "Dialogue" } },
				{
					id: "dialogue-bubbles",
					type: "dialogue",
					data: {
						style: "bubbles",
						caption: "A conversation",
						turns: [
							{
								id: "roger-intro",
								speaker: "Roger",
								name: "Roger",
								side: "end",
								avatar: "assets/test-image.webp",
								paragraphs: ["Welcome to the conversation."],
								narrationAudio: DIALOGUE_AUDIO_PATHS[0],
							},
							{
								id: "alexandria-reply",
								speaker: "Alexandria",
								name: "AlexandriaMorganFromTheCommunityLearningSupportOffice",
								side: "start",
								avatar: "assets/test-image.webp",
								paragraphs: ["Thanks for inviting me."],
								narrationAudio: DIALOGUE_AUDIO_PATHS[1],
							},
							{
								id: "roger-arabic",
								speaker: "Roger",
								name: "Roger",
								paragraphs: ["مرحبا بك في الحوار."],
								narrationAudio: DIALOGUE_AUDIO_PATHS[2],
							},
						],
					},
				},
				{
					id: "dialogue-script",
					type: "dialogue",
					data: {
						style: "script",
						turns: [
							{
								id: "guide-resource",
								speaker: "Guide",
								name: "Guide",
								avatar: "assets/test-image.webp",
								paragraphs: [`Visit https://example.com/${"longpathsegment".repeat(16)}`],
							},
						],
					},
				},
			],
			frontmatter: {
				title: "Dialogue",
				lang: "en",
				narrationEnabled: true,
			},
			config: { completionThreshold: 0.8 },
			resolvedAssets: new Map([
				["assets/test-image.webp", await readFile(FIXTURE_IMAGE_PATH)],
				...DIALOGUE_AUDIO_PATHS.map((path) => [path, dialogueAudio] as const),
			]),
			viewerVersion: "local",
			locale: "en",
		} satisfies DesktopExportInput,
		{ ...buildOptions, format: "html" },
	);
	new AdmZip(dialogue.zip).extractAllTo(resolve(distDir, "dialogue"), true);
	for (const presentation of ["pages", "deck"] as const) {
		for (const palette of DIALOGUE_PALETTES) {
			for (const mode of ["light", "dark"] as const) {
				builds.push(async () => {
					const fixture = dialogueLayoutFixture(presentation, palette, mode);
					const output = await buildScormPackage(fixture, { format: "html" });
					new AdmZip(output.zip).extractAllTo(resolve(distDir, fixture.id), true);
				});
			}
		}
	}

	const source = await readFile(
		resolve(
			import.meta.dirname,
			"../../../../docs/prax-format/examples/patterns/dialogue-branching.prax",
		),
		"utf8",
	);
	const parsed = readLesson(source);
	if (
		parsed.warnings.length ||
		parsed.blocks.filter((block) => block.type === "dialogue").length !== 3 ||
		parsed.blocks.filter((block) => block.type === "logic").length !== 2
	) {
		throw new Error("Invalid branching dialogue fixture");
	}
	deepStrictEqual(
		parsed.blocks.filter((block) => block.type === "logic").flatMap((block) => block.data.actions),
		[
			{ type: "show", targets: ["calm-path"] },
			{ type: "show", targets: ["tense-path"] },
		],
		"Invalid branching dialogue fixture actions",
	);
	const branchingBlocks = parsed.blocks.map((block) => {
		if (block.type === "pageBreak")
			return { ...block, data: { ...block.data, _narrationEnabled: true } };
		if (block.type === "assessment")
			return {
				...block,
				data: { ...block.data, narrationAudio: "assets/question.mp3", narrationDuration: 1 },
			};
		if (block.type !== "dialogue") return block;
		const id = block.name ?? "intro";
		const clip = id === "calm-path" ? "calm" : id === "tense-path" ? "tense" : "intro";
		const turns = block.data.turns as Array<Record<string, unknown>>;
		return {
			...block,
			data: {
				...block.data,
				turns: turns.map((turn) => ({
					...turn,
					narrationAudio: `assets/${clip}.${clip === "tense" ? "wav" : "mp3"}`,
					narrationDuration: clip === "tense" ? 60 : 1,
				})),
			},
		};
	});
	const branchingAudio = new Map<string, Uint8Array>(
		["intro", "question", "calm"].map((name) => [`assets/${name}.mp3`, dialogueAudio]),
	);
	// Retry must pause only when the next answer hides the playing branch. A
	// 60-second PCM clip outlasts the test's 30-second budget, so natural completion
	// cannot race that assertion. Generate silence locally instead of borrowing
	// a speech sample whose duration can change independently of this journey.
	const tenseAudio = silentWav(60);
	branchingAudio.set("assets/tense.wav", tenseAudio);
	const branching = await buildScormPackage(
		{
			courseId: "dialogue-branching",
			blocks: branchingBlocks,
			frontmatter: {
				...parsed.frontmatter,
				title: "Branching dialogue",
				lang: "en",
				narrationEnabled: true,
			},
			config: { completionThreshold: 0.8 },
			resolvedAssets: branchingAudio,
			viewerVersion: "local",
			locale: "en",
		} satisfies DesktopExportInput,
		{ ...buildOptions, format: "html" },
	);
	new AdmZip(branching.zip).extractAllTo(resolve(distDir, "dialogue-branching"), true);

	for (const { route, course: designCourse } of [
		containerLayoutsFixture(),
		...designSeparatorFixtures(),
		...designContainerSurfaceFixtures(),
		...buildDesignLayoutMotionFixtures(),
		...buildDesignNavigationFixtures(),
		...designColorsTypographyFixtures().map(({ name, course }) => ({
			route: `design-${name}`,
			course,
		})),
	]) {
		builds.push(async () => {
			const built = await buildScormPackage(designCourse, { ...buildOptions, format: "html" });
			new AdmZip(built.zip).extractAllTo(resolve(distDir, route), true);
		});
	}

	const comprehensiveZip = new AdmZip(result.zip);
	comprehensiveZip.extractAllTo(distDir, true);

	for (const [route, locale, navigationStyle, prevNext, edge] of [
		["en", "en", "sidebar", true, true],
		["fr", "fr", "sidebar", true, true],
		["proxy", "en", "none", false, false],
		["slides", "en", "slides", true, false],
		["bottombar", "en", "bottomBar", true, false],
	] as const) {
		builds.push(async () => {
			const source =
				'# Start\n\nPrevious page.\n\n# Safety\n\n::: rating Safety check {name=safety level=3}\n1. Not ready\n2. Review again\n3. Ready\n:::\n\n::: rule\nif: @safety.ratingScore < 3\nthen: disableCompletion because "Select Ready in the safety check before continuing."\n:::\n\n# Next\n\nNext page.\n'.replace(
					' because "Select Ready in the safety check before continuing."',
					locale === "en" ? ' because "Select Ready in the safety check before continuing."' : "",
				);
			const parsed = readLesson(source);
			if (parsed.warnings.length) throw new Error(JSON.stringify(parsed.warnings));
			const pages = splitBlocksIntoPages(parsed.blocks, "Continue gate");
			pages[1].blocks.push(
				{
					id: "jump-next",
					type: "button",
					data: { text: "Jump forward", action: "goToPage", targetPageId: pages[2].id },
				},
				{
					id: "finish",
					type: "button",
					data: { text: "Finish lesson", action: "goToPage", targetPageId: "__end_lesson__" },
				},
			);
			const gateResult = await buildScormPackage(
				{
					id: `continue-gate-${route}`,
					title: "Continue gate",
					sourceLocale: locale,
					content: pages,
					navigationStyle,
					navToggles: {
						navOutline: true,
						navPrevNext: prevNext,
						navEdgeArrows: edge,
						navKeyboardArrows: true,
						navSwipeGestures: true,
					},
				},
				{ format: "html" },
			);
			new AdmZip(gateResult.zip).extractAllTo(resolve(distDir, "continue-gate", route), true);
		});
	}

	for (const nav of NAV_CONFIGS) {
		builds.push(async () => {
			const variantDir = resolve(distDir, `nav-${navConfigName(nav)}`);
			await mkdir(variantDir, { recursive: true });
			const navResult = await buildScormPackage(buildLightweightCourse({ nav }), {
				format: "html",
			});
			const navZip = new AdmZip(navResult.zip);
			navZip.extractAllTo(variantDir, true);
		});
	}
	const oneOfCourse = buildLightweightCourse();
	oneOfCourse.sectionRhythm = "alternate";
	oneOfCourse.cssVars = extractDesktopDesignFromFrontmatter({
		design: { ...DEFAULT_DESIGN_VARIANTS, sectionRhythmMode: "alternate" },
	}).cssVars;
	const sectionVars = oneOfCourse.cssVars;
	if (!sectionVars) throw new Error("Missing choose-one section theme tokens");
	oneOfCourse.sectionPalettes = deriveSectionPalettes({
		background: sectionVars["--praxity-color-background"],
		text: sectionVars["--praxity-color-text"],
		accent: sectionVars["--praxity-color-accent"],
	});
	const oneOfGroup = oneOfCourse.content[2].blocks.find(
		(block) => block.type === "assessmentGroup",
	);
	if (oneOfGroup?.type !== "assessmentGroup") throw new Error("Missing choose-one group fixture");
	oneOfGroup.data.mode = "oneOf";
	oneOfCourse.content[2].blocks.splice(1, 0, {
		id: "choose-one-section",
		type: "heading",
		data: { level: 2, content: "Knowledge check" },
	});
	oneOfCourse.content[2].blocks.push({
		id: "choose-one-review-section",
		type: "heading",
		data: { level: 2, content: "Review your choices" },
	});
	const oneOfResult = await buildScormPackage(oneOfCourse, { format: "html" });
	new AdmZip(oneOfResult.zip).extractAllTo(resolve(distDir, "oneof-group"), true);

	for (const theme of THEME_CONFIGS) {
		builds.push(async () => {
			const variantDir = resolve(distDir, `theme-${theme.name}`);
			await mkdir(variantDir, { recursive: true });
			const themeResult = await buildScormPackage(buildLightweightCourse({ theme }), {
				format: "html",
			});
			const themeZip = new AdmZip(themeResult.zip);
			themeZip.extractAllTo(variantDir, true);
		});
	}
	for (const theme of ASSESSMENT_REVIEW_THEMES) {
		builds.push(async () => {
			const result = await buildScormPackage(buildAssessmentReviewCourse(theme), {
				format: "html",
			});
			new AdmZip(result.zip).extractAllTo(resolve(distDir, `review-${theme.name}`), true);
		});
	}

	const slidesNarrationDir = resolve(distDir, "slides-narration");
	await mkdir(slidesNarrationDir, { recursive: true });
	const slidesNarrationResult = await buildScormPackage(buildSlidesNarrationCourse(), {
		format: "html",
	});
	new AdmZip(slidesNarrationResult.zip).extractAllTo(slidesNarrationDir, true);
	const sidebarNarrationResult = await buildScormPackage(
		{ ...buildSlidesNarrationCourse(), navigationStyle: "sidebar", navToggles: undefined },
		{ format: "html" },
	);
	new AdmZip(sidebarNarrationResult.zip).extractAllTo(resolve(distDir, "sidebar-narration"), true);

	const hiddenBlocksDir = resolve(distDir, "hidden-blocks");
	const smallPreviewGeometry = buildLightweightCourse();
	smallPreviewGeometry.sectionRhythm = "alternate";
	for (const block of smallPreviewGeometry.content[0].blocks) {
		if (block.type !== "image") continue;
		delete block.data.width;
		delete block.data.float;
	}
	for (const [route, input] of [
		["activity-typography", activityTypographyFixture()],
		["small-preview-geometry", smallPreviewGeometry],
		["reveal-answers", buildRevealCourse()],
		["inline-features", buildInlineFeaturesCourse()],
		["fill-blank-variants", buildFillBlankVariantsCourse()],
		["choice-control-alignment", buildChoiceControlAlignmentCourse()],
	] as const) {
		builds.push(async () => {
			const result = await buildScormPackage(input, { format: "html" });
			new AdmZip(result.zip).extractAllTo(resolve(distDir, route), true);
		});
	}
	for (const variant of LEARNER_POLISH_VARIANTS) {
		builds.push(async () => {
			const result = await buildScormPackage(buildLearnerPolishCourse(variant), { format: "html" });
			new AdmZip(result.zip).extractAllTo(resolve(distDir, variant.route), true);
		});
	}
	for (const format of ["html", "scorm12"] as const) {
		builds.push(async () => {
			const result = await buildScormPackage(buildModuleNavigationCourse(), { format });
			new AdmZip(result.zip).extractAllTo(resolve(distDir, `module-navigation-${format}`), true);
		});
	}
	for (const locale of ["en", "fr"] as const) {
		for (const nested of [false, true]) {
			builds.push(async () => {
				const result = await buildScormPackage(buildVisitedStatusCourse(locale, nested), {
					format: "html",
				});
				new AdmZip(result.zip).extractAllTo(
					resolve(distDir, `visited-status-${locale}-${nested ? "modules" : "flat"}`),
					true,
				);
			});
		}
	}
	for (const locale of ["en", "fr"] as const) {
		builds.push(async () => {
			const result = await buildScormPackage(buildPagesArrivalCourse(locale), { format: "html" });
			new AdmZip(result.zip).extractAllTo(resolve(distDir, `pages-arrival-${locale}`), true);
		});
	}
	await mkdir(hiddenBlocksDir, { recursive: true });
	const hiddenBlocksResult = await buildScormPackage(buildHiddenBlocksCourse(), { format: "html" });
	new AdmZip(hiddenBlocksResult.zip).extractAllTo(hiddenBlocksDir, true);
	const hiddenBlocksPages = await readCoursePagesFromDist(hiddenBlocksDir);

	const fullFixtureVariantConfigs = [
		{
			name: "theme-light",
			overrides: { colorMode: "light" as const },
		},
		{
			name: "theme-dark",
			overrides: { colorMode: "dark" as const },
		},
		{
			name: "nav-sidebar",
			overrides: {
				navigationStyle: "sidebar" as const,
				navToggles: { navOutline: true, navPrevNext: true },
			},
		},
		{
			name: "nav-minimal",
			overrides: {
				navigationStyle: "minimal" as const,
				navToggles: { navOutline: false, navPrevNext: false, navSwipeGestures: true },
			},
		},
	];

	for (const variant of fullFixtureVariantConfigs) {
		builds.push(async () => {
			const variantDir = resolve(distDir, `full-${variant.name}`);
			await mkdir(variantDir, { recursive: true });
			const variantResult = await buildScormPackage(courseVariant(course, variant.overrides), {
				...buildOptions,
				format: "html",
			});
			const variantZip = new AdmZip(variantResult.zip);
			variantZip.extractAllTo(variantDir, true);
		});
	}

	const batchStarted = performance.now();
	await runFixtureBuilds(builds);
	console.log(
		`Accessibility fixture batch: ${builds.length} courses, ${Math.round(performance.now() - batchStarted)} ms`,
	);

	const server = createServer((request, response) => {
		response.setHeader(
			"Content-Security-Policy",
			[
				"default-src 'self'",
				"script-src 'self'",
				"script-src-attr 'none'",
				"style-src 'self' 'unsafe-inline'",
				"img-src 'self' data:",
				"media-src 'self' data:",
				"font-src 'self' data:",
				"connect-src 'self'",
				"frame-src 'self'",
				"object-src 'none'",
				"base-uri 'none'",
			].join("; "),
		);
		void handler(request, response, {
			public: distDir,
			cleanUrls: false,
		});
	});

	onServerCreated(server);
	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});

	const port = (server.address() as AddressInfo).port;
	const origin = `http://127.0.0.1:${port}`;
	const url = origin;
	const pages = await readCoursePagesFromDist(distDir);
	const navVariants = Object.fromEntries(
		NAV_CONFIGS.map((entry) => {
			const name = navConfigName(entry);
			return [name, `${origin}/nav-${name}`];
		}),
	);
	const themeVariants = Object.fromEntries(
		THEME_CONFIGS.map((entry) => [entry.name, `${origin}/theme-${entry.name}`]),
	);
	const fullFixtureVariants = Object.fromEntries(
		fullFixtureVariantConfigs.map((entry) => [entry.name, `${origin}/full-${entry.name}`]),
	);
	const slidesNarrationUrl = `${origin}/slides-narration`;
	const hiddenBlocksUrl = `${origin}/hidden-blocks`;
	const captionedVideoUrl = `${origin}/captioned-video/${captionedVideoPages[0].slug}.html`;
	const courseDirectories = {
		[url]: distDir,
		[`${url}/course-conformance`]: conformanceDir,
		[`${url}/dialogue-branching`]: resolve(distDir, "dialogue-branching"),
		...Object.fromEntries(
			Object.values(navVariants).map((courseUrl) => [
				courseUrl,
				resolve(distDir, new URL(courseUrl).pathname.slice(1)),
			]),
		),
		...Object.fromEntries(
			Object.values(fullFixtureVariants).map((courseUrl) => [
				courseUrl,
				resolve(distDir, new URL(courseUrl).pathname.slice(1)),
			]),
		),
	};
	const coursePages: Record<string, CoursePageMeta[]> = {};
	const selectorPages: Record<string, Record<string, CoursePageMeta[] | null>> = {};
	for (const [courseUrl, directory] of Object.entries(courseDirectories)) {
		const metadata = await readCoursePagesFromDist(directory);
		if (!metadata.length) throw new Error(`Missing canonical pages in fixture: ${directory}`);
		coursePages[courseUrl] = metadata;
		const selectors: Record<string, CoursePageMeta[] | null> = Object.fromEntries(
			DISCOVERY_SELECTORS.map((selector) => [selector, null]),
		);
		for (const meta of metadata) {
			const document = new JSDOM(await readFile(resolve(directory, `${meta.slug}.html`), "utf8"));
			try {
				for (const selector of DISCOVERY_SELECTORS) {
					if (document.window.document.querySelector(selector.replaceAll(":visible", ""))) {
						(selectors[selector] ??= []).push(meta);
					}
				}
			} finally {
				document.window.close();
			}
		}
		selectorPages[courseUrl] = selectors;
	}

	await writeFile(
		testEnvPath,
		JSON.stringify(
			{
				url,
				tmpDir,
				pages,
				coursePages,
				selectorPages,
				navVariants,
				themeVariants,
				fullFixtureVariants,
				slidesNarrationUrl,
				hiddenBlocksUrl,
				hiddenBlocksPages,
				captionedVideoUrl,
				frenchMatrixUrls: [
					`${origin}/french-matrix-layout/${frenchLayoutPages[0].slug}.html`,
					`${origin}/french-matrix-deck/${frenchDeckPages[0].slug}.html`,
				],
			},
			null,
			2,
		),
		"utf-8",
	);
}
