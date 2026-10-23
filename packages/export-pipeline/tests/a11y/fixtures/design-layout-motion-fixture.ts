import { readLesson } from "@praxity/grammar";
import { DEFAULT_DESIGN_VARIANTS } from "../../../../editor-core/src/lib/themes/design-variant-defaults";
import type { DesktopExportInput } from "../../../src/build";

export const DESIGN_LAYOUT_CASES = [
	...["compact", "comfortable", "spacious"].map((value) => ({ key: "density", value })),
	...["compact", "default", "spacious"].map((value) => ({ key: "blockSpacing", value })),
	...[580, 690, 800].map((value) => ({ key: "contentMaxWidth", value })),
	...[0, 3, 6, 10].map((value) => ({ key: "borderRadius", value })),
	...["flat", "subtle", "elevated"].map((value) => ({ key: "shadowIntensity", value })),
	...[24, 48, 80].map((value) => ({ key: "sectionGap", value })),
	...["none", "fade", "slide", "scale"].map((value) => ({ key: "motionEntrance", value })),
	...["none", "sequential"].map((value) => ({ key: "motionStagger", value })),
];

type LayoutMotionFixture = { route: string; course: DesktopExportInput };

export function buildDesignLayoutMotionFixtures(): LayoutMotionFixture[] {
	const fixtures: LayoutMotionFixture[] = DESIGN_LAYOUT_CASES.map(({ key, value }) => {
		const design = {
			navArchetype: "minimal",
			sectionRhythm: "uniform",
			dividerStyle: "none",
			density: "comfortable",
			blockSpacing: "default",
			contentMaxWidth: 690,
			borderRadius: 6,
			shadowIntensity: "subtle",
			sectionGap: 48,
			motionEntrance: key === "motionStagger" ? "fade" : "none",
			motionStagger: "none",
			[key]: value,
		};
		const parsed = readLesson(`---\ntitle: Layout audit\nlang: en\ndesign:\n${Object.entries(design)
			.map(([key, value]) => `  ${key}: ${value}`)
			.join("\n")}\n---\n
# Layout audit

First paragraph for measuring the reading rhythm.

Second paragraph for measuring the reading rhythm.

::: cards Card example {style=shaded level=3}
:: Card example {level=3}
Card body for measuring padding, corners and shadow.
:::

## Second section

Third paragraph in the next section.

::: sequence
:: First step
First sequence item.

:: Second step
Second sequence item.
:::
`);
		return {
			route: `design-layout-${key}-${value}`,
			course: {
				courseId: `design-layout-${key}-${value}`,
				blocks: parsed.blocks,
				frontmatter: parsed.frontmatter ?? {},
				config: { completionThreshold: 0.8 },
				resolvedAssets: new Map(),
				viewerVersion: "local",
				locale: "en",
			},
		};
	});
	fixtures.push({
		route: "design-layout-bounded-motion",
		course: {
			courseId: "bounded-motion",
			blocks: [
				...readLesson("# Bounded motion\n\n## Graphic\n").blocks,
				{
					id: "motion-graphic",
					type: "labeledGraphic",
					data: {
						imageSrc: "assets/motion.svg",
						imageAlt: "Two labeled areas",
						reveal: "sequential",
						labels: [
							{ id: "first", x: 25, y: 50, title: "First area", body: "First explanation." },
							{ id: "second", x: 75, y: 50, title: "Second area", body: "Second explanation." },
						],
					},
				},
				...readLesson(
					"# Rating {hideTitle}\n\n## Rating\n\n::: rating Confidence\n1. Low\n2. High\n:::\n",
				).pages[0].blocks.map((block) => ({
					...block,
					id: `motion-${block.id}`,
					data: block.type === "rating" ? { ...block.data, style: "numeric" } : block.data,
				})),
				{
					id: "motion-image",
					type: "image",
					data: { src: "assets/motion.svg", altText: "Hover example" },
				},
			],
			frontmatter: {
				title: "Bounded motion",
				design: {
					...DEFAULT_DESIGN_VARIANTS,
					navArchetype: "scroll",
					navScrollProgress: true,
					navFloatingToc: true,
					motionEntrance: "none",
					imageHoverEffect: "lift",
				},
			},
			config: { completionThreshold: 0.8 },
			resolvedAssets: new Map([
				[
					"assets/motion.svg",
					new TextEncoder().encode(
						'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#eee"/></svg>',
					),
				],
			]),
			viewerVersion: "local",
			locale: "en",
		},
	});
	return fixtures;
}
