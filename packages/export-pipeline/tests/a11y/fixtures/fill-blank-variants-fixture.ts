import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import type { CourseExportInput } from "../../../src/build";

const grammar =
	"# Dropdown blanks\n\n::: fill-blank Complete the directions {style=dropdown scored attempts=0 level=3}\nThe sign is {red|*blue|green|a longer distractor that needs more room}; the door is {*open|closed}.\n:::\n\n# Word bank\n\n::: fill-blank Complete the colour pattern {style=word-bank scored attempts=0 level=3}\nStart with {blue}, then {red}, and finish with {red}.\nbank: red | blue | red | green\n:::\n\n# Reveal dropdown\n\n::: fill-blank Review the direction {style=dropdown scored feedbackMode=reveal level=3}\nTurn {left|*right} at the door.\n:::\n\n# Escaped dropdown\n\nLiteral \\*stars\\*, \\{{name}}, and \\@icon{check}.\n\n::: fill-blank Choose literal labels {style=dropdown scored feedbackMode=reveal level=3}\nKeep \\{literal\\} and \\____ as text. Pick {*a\\|b|other}, then {*\\*star|plain}.\n:::\n\n# Escaped word bank\n\n::: fill-blank Choose literal bank entries {style=word-bank scored level=3}\nChoose {a\\|b}, then {\\{value\\}}, then {C:\\\\temp}.\nbank: a\\|b | \\{value\\} | C:\\\\temp | spare\n:::\n";

export function buildFillBlankVariantsCourse(): CourseExportInput {
	return {
		id: "fill-blank-variants",
		title: "Dropdown blanks",
		sourceLocale: "en",
		content: splitBlocksIntoPages(readLesson(grammar).blocks, "Dropdown blanks"),
		navigationStyle: "sidebar",
	};
}
