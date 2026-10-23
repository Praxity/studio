import { learnerAuthorityDirectories } from "../../../scripts/check-source-owners.mjs";

// Prefix coverage includes new files and non-JS inputs, including pattern folders.
export const publishedRuntimeRoots = learnerAuthorityDirectories;
export const publishedCheckScripts = [
	"scripts/check-source-owners.mjs",
	"apps/desktop/scripts/test-affected.mjs",
	"apps/desktop/scripts/test-affected-output-map.mjs",
];
export const guardsPublishedOutput = (path) =>
	publishedRuntimeRoots.some((root) => path.startsWith(root)) ||
	publishedCheckScripts.includes(path);

// Broad renderers and shared styles own all published layouts. Keep their full
// coverage; add narrower entries only when the file's consumers are known.
export const outputCoverage = [
	{
		paths: ["packages/shared-blocks/src/viewer/deck-shell.css"],
		a11y: [
			"assessment-group-spacing",
			"authoring-catalog",
			"block-presentation",
			"card-affordance",
			"card-heading-spacing",
			"container-layouts",
			"continue-gate",
			"course-conformance",
			"design-container-surfaces",
			"design-layout-motion",
			"design-navigation",
			"dialogue-branching",
			"learner-polish",
			"layout-gutters",
			"interactions",
			"native-container-settings",
			"matrix-columns",
			"media-playback",
			"narrow-answerability",
			"section-transitions",
			"reading-palette-interactions",
			"slides-narration",
			"nav-a11y",
			"nav-configs",
			"small-widths",
			"narration-toolbar",
			"zoom-text-spacing",
		],
		deck: [
			"block-rendering",
			"card-narration",
			"chrome",
			"corner-artwork",
			"focus-contrast",
			"module-deck",
			"narration-regressions",
			"resume-orientation",
			"review-navigation",
		],
	},
	{
		paths: [
			"packages/export-pipeline/src/render-block-html.ts",
			"packages/export-pipeline/src/html-gen.ts",
			"packages/shared-blocks/src/blocks/shared-blocks.css",
			"packages/shared-blocks/src/viewer/viewer-shell.css",
			"packages/shared-blocks/src/reading-rhythm.css",
			"packages/export-pipeline/template/src/styles/*.css",
		],
		a11y: ["*"],
		deck: ["*"],
	},
	{
		paths: ["packages/export-pipeline/src/slide-artwork-css.ts"],
		a11y: ["design-layout-motion", "small-widths"],
		deck: ["corner-artwork", "module-deck", "focus-contrast"],
	},
	{
		exhaustive: true,
		paths: [...publishedRuntimeRoots.map((root) => `${root}**`), ...publishedCheckScripts],
		a11y: ["*"],
		deck: ["*"],
	},
];

export const cssBudgetTests = [
	"packages/export-pipeline/src/__tests__/bundle-viewer.test.ts",
	"packages/export-pipeline/src/__tests__/html-gen.test.ts",
];
