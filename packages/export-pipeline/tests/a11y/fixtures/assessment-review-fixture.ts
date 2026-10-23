import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import type { ThemePresetId } from "../../../../editor-core/src/lib/themes/theme-preset-defaults";
import { catalogStarter } from "../../fixtures/authoring-catalog";
import { buildLightweightCourse, FIXTURE_IMAGE_URL } from "./lightweight-fixture";

export const ASSESSMENT_REVIEW_THEMES = (
	["clean", "waves", "standard", "bauhaus", "blueprint", "campfire", "marquee", "darkroom"] as const
).flatMap((palette) =>
	(["light", "dark"] as const).map((colorMode) => ({
		name: `${palette}-${colorMode}`,
		palette,
		colorMode,
	})),
);

export function buildAssessmentReviewCourse(theme: {
	name: string;
	palette: ThemePresetId;
	colorMode: "light" | "dark";
}) {
	const blocks = ["choose-one", "choose-many", "match", "matrix", "categorize", "hotspot"].flatMap(
		(keyword) =>
			readLesson(catalogStarter(keyword)).blocks.filter((block) => block.type !== "pageBreak"),
	);
	const content = splitBlocksIntoPages(
		[{ id: "review-page", type: "pageBreak", data: { title: "Assessment review" } }, ...blocks],
		"Assessment review",
	);

	for (const page of content) {
		for (const block of page.blocks) {
			if (block.type === "assessment" && block.data.assessmentType === "hotspot") {
				block.data.image = FIXTURE_IMAGE_URL;
			}
		}
	}
	return {
		...buildLightweightCourse({ theme }),
		id: `review-${theme.name}`,
		title: "Assessment review",
		content,
	};
}
