import { readLesson } from "@praxity/grammar";
import type { DesktopExportInput } from "../../../src/build";

export const DESIGN_SEPARATOR_STYLES = [
	"none",
	"thin",
	"wave",
	"angle",
	"curve",
	"squiggle",
	"blend",
] as const;

export function designSeparatorFixtures(): Array<{ route: string; course: DesktopExportInput }> {
	return DESIGN_SEPARATOR_STYLES.map((style) => {
		const parsed = readLesson(`---
title: Separator audit
lang: en
design:
  navArchetype: minimal
  dividerStyle: ${style}
---
# Separator audit

Introductory content.

## Second section

Section content.

## Third section

Final content.
`);
		return {
			route: `design-separator-${style}`,
			course: {
				courseId: `design-separator-${style}`,
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
