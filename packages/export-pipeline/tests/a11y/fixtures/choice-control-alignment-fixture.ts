import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { DEFAULT_DESIGN_VARIANTS } from "../../../../editor-core/src/lib/themes/design-variant-defaults";
import { THEME_PRESET_DEFAULTS } from "../../../../editor-core/src/lib/themes/theme-preset-defaults";
import type { CourseExportInput } from "../../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../../src/desktop-design";

const grammar =
	"# Choice control alignment\n\n::: choice Select one answer {scored attempts=1 level=3}\n(x) First answer\n( ) Second answer\n( ) This deliberately long answer wraps over several lines even on a desktop so the control must stay beside its first line while learners read the rest of the option text carefully before selecting their answer.\n:::\n\n::: choice Select several answers {scored attempts=1 level=3}\n[x] First answer\n[x] Second answer\n[ ] This deliberately long answer wraps over several lines even on a desktop so the control must stay beside its first line while learners read the rest of the option text carefully before selecting their answer.\n:::\n\n### Review the checklist\n\n::: checklist\n- [ ] First task\n- [ ] A longer task asks learners to review all of the instructions carefully before confirming that they have finished the activity and are ready to continue to the next part of the course.\n:::\n\n::: matrix Rate the statement {level=3}\n1. Agree\n2. Disagree\n- The instructions are clear.\n:::\n\n::: categorize Categorize the equipment {level=3}\n:: Head\n- Hard hat\n:: Eyes\n- Goggles\n:::\n\n::: group Choose a question {mode=oneOf level=3}\n::: choice First question {level=3}\n(x) First answer\n( ) Second answer\n:::\n::: choice A longer second question asks learners to read the whole question carefully before choosing which activity they want to complete next in the course {level=3}\n(x) First answer\n( ) Second answer\n:::\n:::\n";

export function buildChoiceControlAlignmentCourse(): CourseExportInput {
	const parsed = readLesson(grammar);
	if (parsed.warnings.length) throw new Error(JSON.stringify(parsed.warnings));
	const design = extractDesktopDesignFromFrontmatter({
		design: {
			...DEFAULT_DESIGN_VARIANTS,
			...THEME_PRESET_DEFAULTS.standard,
			palette: "standard",
			colorMode: "light",
		},
	});
	return {
		id: "choice-control-alignment",
		title: "Choice control alignment",
		sourceLocale: "en",
		content: splitBlocksIntoPages(parsed.blocks, "Choice control alignment"),
		...design,
		navigationStyle: "sidebar",
	};
}
