import {
	createTypography,
	type DesignVariants,
	readLesson,
	serializeFrontmatter,
} from "@praxity/grammar";
import { DEFAULT_DESIGN_VARIANTS } from "../../../../editor-core/src/lib/themes/design-variant-defaults";
import { findCompliantAccent } from "../../../../editor-core/src/lib/themes/oklch";
import { THEME_PRESET_DEFAULTS } from "../../../../editor-core/src/lib/themes/theme-preset-defaults";
import type { DesktopExportInput } from "../../../src/build";

export const DESIGN_COLORS = {
	colorBackgroundLight: "#fff8ed",
	colorBackgroundDark: "#101827",
	colorSuccessOnLight: "#14532d",
	colorSuccessOnDark: "#86efac",
	colorErrorOnLight: "#9f1239",
	colorErrorOnDark: "#fda4af",
	colorWarningOnLight: "#78350f",
	colorWarningOnDark: "#fde68a",
} as const;

const SOURCE =
	"# Heading one\n\n## Heading two\n\n### Heading three\n\n#### Heading four\n\nHeading four body.\n\nBody sample with enough words to measure its line height and loaded font face.\n\nÉlève à Noël, où l'œuvre française paraît déjà très sûre. **Ça, c'est important.** *À bientôt !* ***Révision.*** ÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ àâæçéèêëîïôœùûüÿ.\n\nInline `code sample`.\n\n```text\nconst answer = 42;\n```\n\n::: button [Accent button](https://example.com)\n:::\n\n::: note {tone=success}\nSuccess sample\n:::\n\n::: note {tone=warning}\nWarning sample\n:::\n";

export function designColorsTypographyFixtures(): Array<{
	name: string;
	course: DesktopExportInput;
}> {
	const base = {
		...DEFAULT_DESIGN_VARIANTS,
		...THEME_PRESET_DEFAULTS.darkroom,
		palette: "darkroom",
		colorMode: "light",
		navArchetype: "sidebar",
	} as DesignVariants;
	const typography = createTypography("Atkinson Hyperlegible Next", "Lora");
	typography.body.fontWeight = 700;
	typography.headings.fontWeight = 800;
	typography.code = { fontFamily: ["Fira Code", "monospace"] };
	const custom = {
		...base,
		...DESIGN_COLORS,
		accentHue: 290,
		accentHueCustomized: true,
		colorAccent: findCompliantAccent(290, DESIGN_COLORS.colorBackgroundLight),
		colorButtonBackground: findCompliantAccent(290, DESIGN_COLORS.colorBackgroundLight),
		typography,
		headingSize: 3.2,
		lineHeight: 2,
	} satisfies DesignVariants;
	const minimum = createTypography("Inter", "Inter");
	minimum.headings.fontWeight = 400;
	const variants = [
		{ name: "baseline", design: base },
		{
			name: "book",
			design: { ...base, typography: createTypography("Source Sans 3", "Source Serif 4") },
		},
		{
			name: "minimum",
			design: { ...base, typography: minimum, headingSize: 1.6, lineHeight: 1.2 },
		},
		{ name: "custom-light", design: custom },
		{ name: "custom-dark", design: { ...custom, colorMode: "dark" as const } },
		{ name: "custom-auto", design: { ...custom, colorMode: "auto" as const } },
	];
	return variants.map(({ name, design }) => {
		const parsed = readLesson(
			serializeFrontmatter({ title: "Design audit", lang: "en", design }, SOURCE),
		);
		// Stored text HTML uses this existing error renderer; inert previews do not run learner validation.
		parsed.blocks.push({
			id: "error-color-sample",
			type: "text",
			data: { content: '<p class="praxity-text-error">Error sample</p>' },
		});
		return {
			name,
			course: {
				courseId: `design-${name}`,
				blocks: parsed.blocks,
				frontmatter: parsed.frontmatter ?? {},
				config: { completionThreshold: 0.8 },
				resolvedAssets: new Map(),
				viewerVersion: "local",
				locale: "en",
			},
		};
	});
}
