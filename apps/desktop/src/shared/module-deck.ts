import {
	type GrammarFrontmatter,
	getNavPreset,
	resolveDeckDesign,
	toNavArchetype,
} from "@praxity/grammar";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";

/** Resolve authored choices only after the main process overlays durable identities. */
export function moduleDeckOptions(
	enabled: boolean | undefined,
	blocks: PraxityBlock[],
	frontmatter: GrammarFrontmatter,
) {
	const gates: Record<string, "attempt" | "pass"> = {};
	const stops: string[] = [];
	for (const page of splitBlocksIntoPages(blocks, frontmatter.title ?? "")) {
		if (page.data.deckStop !== undefined && typeof page.data.deckStop !== "boolean")
			throw new Error("deckStop must be a boolean");
		if (page.data.deckStop === true) stops.push(page.id);
		for (const block of flattenLogicBlocks(page.blocks)) {
			const rule = block.data.deckGate;
			if (rule === undefined) continue;
			if (
				!["assessment", "assessmentGroup"].includes(block.type) ||
				(rule !== "attempt" && rule !== "pass")
			)
				throw new Error("deckGate must be attempt or pass on an assessment or assessment group");
			gates[block.id] = rule;
		}
	}
	return enabled === true ? { gates, stops } : undefined;
}

/** Keep each lesson's presentation when compiling a multi-lesson course document. */
export function deckPresentationData(
	enabled: boolean | undefined,
	design: Record<string, unknown>,
) {
	if (!enabled) return {};
	const preset = getNavPreset(
		toNavArchetype(
			design.navArchetype === "custom"
				? design.navArchetypeBase
				: (design.navArchetype ?? design.navLayout),
		),
	);
	return {
		deckDesign: resolveDeckDesign(design.deck),
		deckGlossaryPage: typeof design.glossaryPage === "boolean" ? design.glossaryPage : true,
		deckNavigation: {
			navTopBar: design.navTopBar === true,
			navCourseTitle: design.navCourseTitle !== false,
			navLessonTitles: design.navLessonTitles !== false,
			navFloatingToc:
				typeof design.navFloatingToc === "boolean" ? design.navFloatingToc : preset.navFloatingToc,
			navKeyboardArrows:
				typeof design.navKeyboardArrows === "boolean"
					? design.navKeyboardArrows
					: preset.navKeyboardArrows,
		},
	};
}
