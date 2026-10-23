import {
	HIDDEN_BLOCK_TYPES,
	NAV_ARCHETYPES,
	type NavArchetype,
	readLesson,
} from "@praxity/grammar";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { DEFAULT_DESIGN_VARIANTS } from "../../../../editor-core/src/lib/themes/design-variant-defaults";
import {
	THEME_PRESET_DEFAULTS,
	type ThemePresetId,
} from "../../../../editor-core/src/lib/themes/theme-preset-defaults";
import type { CourseExportInput } from "../../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../../src/desktop-design";

export const FIXTURE_AUDIO_URL = "https://example.com/narration-sample.mp3";
export const FIXTURE_IMAGE_URL = "https://example.com/test-image.webp";

/**
 * Point fixture images at the deterministic download stub in global setup.
 *
 * The image used to be `https://images.unsplash.com/…`, fetched at build time by
 * `resolveAssets`. A slow or failing response threw, killed global setup, and left
 * the suite running against a stale `.test-env.json` — a whole run reporting on an
 * export nobody had just built.
 *
 * The document block stays remote: the parser only builds one from a remote URL
 * (local media paths cover images, video and audio only), and dropping it would
 * lose the `document` type from the hidden-block coverage assertion. Global setup
 * serves the fixture URLs from disk instead — see `stubFixtureDownloads`.
 */
function resolveFixtureAssets(pages: PraxityPage[]): PraxityPage[] {
	const rewrite = (blocks: PraxityBlock[]): PraxityBlock[] =>
		blocks.map((block) => {
			const data = block.data as Record<string, unknown>;
			const src = typeof data.src === "string" ? data.src : undefined;
			const next = src?.startsWith("/assets/") ? { ...data, src: FIXTURE_IMAGE_URL } : data;
			const children = (next as { children?: PraxityBlock[] }).children;
			return {
				...block,
				data: Array.isArray(children) ? { ...next, children: rewrite(children) } : next,
			};
		});
	return pages.map((page) => ({ ...page, blocks: rewrite(page.blocks) }));
}

/**
 * Minimal 3-page fixture:
 * - Page 1: static (text + image)
 * - Page 2: interactive (accordion + tabs)
 * - Page 3: assessment (choice + assessment-group)
 */
const LIGHTWEIGHT_GRAMMAR =
	"---\ntitle: Config Variant Test\nlang: en\n---\n\n# Page One - Static Content\n\nWelcome to the test course.\n\n::: float {side=right}\n![Test image for validation](/assets/test-image.webp){size=medium}\n\nThis paragraph is long enough to demonstrate how prose uses the lane beside the image while the image remains in the same reading order. It continues with enough words to occupy several lines at the medium threshold and makes the wrapped geometry measurable in both browser engines.\n\nThe next paragraph also remains beside the image until the available vertical space is used.\n\n## Learning beside the image\n\n- Explain the first concept.\n- Apply the second concept.\n:::\n\nThis paragraph follows the cleared float region.\n\n# Page Two - Interactive\n\n::: accordion\n:: First section {level=3}\nAccordion content one.\n\n:: Second section {level=3}\nAccordion content two.\n:::\n\n## Tabs\n\n::: tabs\n:: Tab One\nFirst tab content.\n\n:: Tab Two\nSecond tab content.\n:::\n\n# Page Three - Assessment\n\n::: group @highlight{Combined assessment} {mode=all passingScore=1 width=wide level=3}\n::: choice Which answer is correct? {scored attempts=2 level=3}\n(x) @highlight.red{Correct answer}\n( ) Wrong answer A\n( ) Wrong answer B\n:::\n::: match Match each hazard to its control {scored width=full level=3}\n- Chemical splash -> Face shield\n- Fall risk -> Guardrail\n:::\n::: choice What should happen first? {scored level=3}\n(x) Stop work\n( ) Ignore the hazard\n:::\n:::\n\n::: free-response Reflection {level=3}\nplaceholder: Enter your response\n:::\n";

const SLIDES_NARRATION_GRAMMAR =
	"---\ntitle: Slides Narration Axe Course\nlang: en\n---\n\n# Accessible slide course\n\nThis title slide introduces the published-output accessibility fixture.\n\n::: figure\n![Course illustration](https://example.com/test-image.webp)\nAn image and its caption stay inside the slide.\n:::\n\n# Narrated slide {hideTitle}\n\n## Listen or read\n\nNarration is optional, and the complete idea remains available as slide text.\n\n# Knowledge check {hideTitle}\n\n::: choice Which option keeps the course accessible? {scored level=3}\n(x) Offer optional audio and readable slide text\nfeedback: Correct. Learners can choose the format that works for them.\n( ) Require audio before navigation is enabled\nfeedback: Try again. Narration must never gate the course content.\n( ) Put the instructions in an audio recording and remove the equivalent text from the slide\n( ) Hide the navigation controls until every learner has played the full narration recording\n:::\n";

const HIDDEN_BLOCKS_GRAMMAR =
	'---\ntitle: Hidden Blocks Accessibility\nlang: en\n---\n\n# Hidden Blocks\n\n::: table {chart=bar}\n| Metric | June | July |\n|--------|------|------|\n| Checks | 4 | 7 |\ntitle: Accessibility checks completed\nalt: Bar chart of completed accessibility checks by month\n:::\n\n```html\n<button type="button">Continue</button>\n```\n\n$$\nE = mc^2\n$$\n\n::: sequence {style=numbered}\n:: Review {level=3}\nReview the course.\n\n:: Publish {level=3}\nPublish the course.\n:::\n\n::: rating Rate this lesson {required level=3}\nfeedback: Review your rating before continuing.\n1. Not useful\n2. Slightly useful\n3. Useful\n4. Very useful\n5. Essential\n:::\n\n::: signature Sign to confirm completion {mode=draw required level=3}\n:::\n';

const REVEAL_GRAMMAR =
	"# Reveal answers\n\n::: group Reveal check {mode=all level=3}\nThe team has found a hazard near the equipment. Consider this scenario before answering both questions.\n::: choice Which reveal action comes first? {width=wide display=scenario required scored points=2 attempts=0 feedbackMode=reveal level=3}\nincorrect: Review the safety procedure.\n( ) Continue working\n(x) Stop and assess the hazard\n\n:::\n::: choice Select the reveal safety checks {width=wide required feedbackMode=reveal level=3}\n[x] Check equipment\n[x] Check surroundings\n[ ] Check social media\n:::\n:::\n\n# More reveal answers\n\n::: group Other reveal checks {mode=all level=3}\n::: match Match the controls {feedbackMode=reveal scored required level=3}\nincorrect: Review the controls.\n- Fall -> Guardrail\n- Splash -> Face shield\n:::\n::: order Order the steps {feedbackMode=reveal scored required level=3}\n1. First\n2. Second\n:::\n::: fill-blank Complete the permit {feedbackMode=reveal scored required level=3}\nComplete the {permit}.\n:::\n::: categorize Categorize the equipment {feedbackMode=reveal scored required level=3}\n:: Head\n- Hard hat\n:: Eyes\n- Goggles\n:::\n:::\n\n# After reveal\n\nThe reveal questions are complete.\n";

export const EXPORTABLE_HIDDEN_BLOCK_TYPES = ["chart", "document"] as const;

const parsedHiddenFixture = readLesson(HIDDEN_BLOCKS_GRAMMAR);
export const HIDDEN_BLOCKS: PraxityBlock[] = parsedHiddenFixture.blocks.filter((block) =>
	HIDDEN_BLOCK_TYPES.has(block.type),
);
// G4 has no document syntax. Keep the publisher's document coverage at its model
// interface while all authored source in this fixture goes through the G4 reader.
const documentBlock: PraxityBlock = {
	id: "a11y-document",
	type: "document",
	data: {
		url: "https://example.com/accessibility-checklist.pdf",
		title: "Accessibility checklist",
		description: "Download the course accessibility checklist.",
		display: "download",
		filename: "accessibility-checklist.pdf",
		mimeType: "application/pdf",
		size: 2048,
	},
};
parsedHiddenFixture.blocks.push(documentBlock);
HIDDEN_BLOCKS.push(documentBlock);

function assertHiddenFixtureCoverage(): void {
	const fixtureTypes = new Set<string>(HIDDEN_BLOCKS.map((block) => block.type));
	const expectedTypes = new Set<string>(EXPORTABLE_HIDDEN_BLOCK_TYPES);
	const missing = EXPORTABLE_HIDDEN_BLOCK_TYPES.filter((type) => !fixtureTypes.has(type));
	const unexpected = [...fixtureTypes].filter((type) => !expectedTypes.has(type));
	if (missing.length || unexpected.length) {
		throw new Error(
			`Hidden block fixture mismatch: missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
		);
	}
}

type FixtureNavArchetype = Exclude<NavArchetype, "custom">;

export interface NavConfigOverride {
	navigationStyle: FixtureNavArchetype;
	navToggles?: Record<string, unknown>;
}

export interface ThemeConfigOverride {
	name: string;
	palette?: ThemePresetId;
	colorMode?: "light" | "dark" | "auto";
	cssVars?: Record<string, string>;
}

/**
 * The chrome each variant actually ships. Exported because the specs used to keep
 * their own hand-written table of what should be visible, which drifted from this
 * one — every nav expectation now derives from here.
 */
export const NAV_TOGGLES: Record<FixtureNavArchetype, Record<string, unknown>> = {
	sidebar: { navOutline: true, navPrevNext: true },
	bottomBar: { navOutline: true, navPrevNext: true, navBreadcrumbs: true },
	slides: { navOutline: false, navPrevNext: false, navEdgeArrows: true },
	scroll: {
		navOutline: true,
		navPrevNext: true,
		navScrollProgress: true,
		navFloatingToc: true,
	},
	minimal: { navOutline: false, navPrevNext: false, navSwipeGestures: true },
	embedded: { navOutline: false, navPrevNext: true },
	none: { navOutline: false, navPrevNext: false, navEdgeArrows: false },
};

export const NAV_CONFIGS: NavConfigOverride[] = NAV_ARCHETYPES.filter(
	(archetype): archetype is FixtureNavArchetype => archetype !== "custom",
).map((navigationStyle) => ({
	navigationStyle,
	navToggles: NAV_TOGGLES[navigationStyle],
}));

export function navConfigName(nav: NavConfigOverride): string {
	return nav.navigationStyle.toLowerCase();
}

export const THEME_CONFIGS: ThemeConfigOverride[] = [
	{ name: "light", palette: "standard", colorMode: "light" },
	{ name: "dark", palette: "standard", colorMode: "dark" },
	{ name: "auto", colorMode: "auto" },
	{ name: "custom", colorMode: "light", cssVars: { "--praxity-color-accent": "#e63946" } },
	...(
		[
			"ink",
			"forest",
			"plum",
			"clay",
			"clear",
			"clean",
			"waves",
			"bauhaus",
			"campfire",
			"darkroom",
		] as const
	).flatMap((palette) =>
		(["light", "dark"] as const).map((colorMode) => ({
			name: `${palette}-${colorMode}`,
			palette,
			colorMode,
		})),
	),
];

export function buildLightweightCourse(overrides?: {
	nav?: NavConfigOverride;
	theme?: ThemeConfigOverride;
}): CourseExportInput {
	const parsed = readLesson(LIGHTWEIGHT_GRAMMAR);
	const blocks = parsed.blocks;
	const pages = resolveFixtureAssets(splitBlocksIntoPages(blocks, "Config Variant Test"));
	const resolvedTheme = overrides?.theme?.palette
		? extractDesktopDesignFromFrontmatter({
				design: {
					...DEFAULT_DESIGN_VARIANTS,
					...THEME_PRESET_DEFAULTS[overrides.theme.palette],
					palette: overrides.theme.palette,
					colorMode: overrides.theme.colorMode ?? "light",
				},
			})
		: undefined;

	return {
		id: `lightweight-${overrides?.nav ? navConfigName(overrides.nav) : "default"}-${
			overrides?.theme?.name ?? "default"
		}`,
		title: "Config Variant Test",
		sourceLocale: "en",
		content: pages,
		...resolvedTheme,
		navigationStyle: overrides?.nav?.navigationStyle ?? resolvedTheme?.navigationStyle ?? "sidebar",
		navToggles:
			(overrides?.nav?.navToggles as CourseExportInput["navToggles"]) ?? resolvedTheme?.navToggles,
		colorMode: resolvedTheme?.colorMode ?? overrides?.theme?.colorMode ?? "light",
		cssVars: resolvedTheme?.cssVars ?? overrides?.theme?.cssVars,
	};
}

export function buildRevealCourse(): CourseExportInput {
	return {
		id: "reveal-answers-a11y",
		title: "Reveal answers",
		sourceLocale: "en",
		content: splitBlocksIntoPages(readLesson(REVEAL_GRAMMAR).blocks, "Reveal answers"),
		navigationStyle: "sidebar",
	};
}

export function buildSlidesNarrationCourse(): CourseExportInput {
	const parsed = readLesson(SLIDES_NARRATION_GRAMMAR);
	const pages = resolveFixtureAssets(
		splitBlocksIntoPages(parsed.blocks, "Slides Narration Axe Course"),
	);
	// Narration is sidecar/model data in G4. Keep the optional audio journey on
	// the same slide and leave its complete text available without playback.
	for (const page of pages) {
		page.narrationEnabled = true;
		if (page.title !== "Narrated slide") continue;
		const text = page.blocks.find((block) => block.type === "text");
		if (!text) throw new Error("Missing narrated slide text");
		text.data.narrationAudio = FIXTURE_AUDIO_URL;
	}
	const navToggles = {
		navOutline: false,
		navHamburgerMenu: true,
		navPrevNext: false,
		navProgressStyle: "dots",
		navEdgeArrows: true,
		navSlideCounter: true,
		navSwipeGestures: true,
		navKeyboardArrows: true,
		showA11yPill: true,
	} as CourseExportInput["navToggles"];

	return {
		id: "slides-narration-a11y",
		title: "Slides Narration Axe Course",
		sourceLocale: "en",
		content: pages,
		navigationStyle: "slides",
		navToggles,
		colorMode: "light",
		cssVars: {
			"--praxity-color-background": "#fcfcfa",
			"--praxity-color-background-alt": "#f4f4f1",
			"--praxity-color-surface": "#f4f4f1",
			"--praxity-color-text": "#1a1a1a",
			"--praxity-color-text-light": "#5f5f5c",
			"--praxity-color-text-muted": "#5f5f5c",
			"--praxity-text-muted": "#5f5f5c",
			"--praxity-color-accent": "#7a5f00",
			"--praxity-color-focus": "#7a5f00",
			"--praxity-color-border": "#767672",
			"--praxity-color-button-background": "#1a1a1a",
			"--praxity-color-button-text": "#ffffff",
		},
	};
}

export function buildHiddenBlocksCourse(): CourseExportInput {
	assertHiddenFixtureCoverage();
	const pages = resolveFixtureAssets(
		splitBlocksIntoPages(parsedHiddenFixture.blocks, "Hidden Blocks Accessibility"),
	);
	return {
		id: "hidden-blocks-a11y",
		title: "Hidden Blocks Accessibility",
		sourceLocale: "en",
		content: pages,
		navigationStyle: "sidebar",
		colorMode: "light",
	};
}
