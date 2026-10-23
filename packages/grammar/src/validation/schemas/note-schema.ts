import { NOTE_COLORS, NOTE_ICON_NAME_PATTERN, NOTE_TONES } from "@praxity/content-model/types";
import type { BlockSchema } from "../validation-types.ts";

export const noteSchema: BlockSchema = {
	keyword: "note",
	blockType: "note",
	attributes: {
		style: {
			type: "enum",
			required: false,
			matches: ["outline", "shaded", "filled", "light"],
			default: "shaded",
		},
		color: {
			type: "enum",
			required: false,
			matches: [...new Set([...NOTE_COLORS, ...NOTE_TONES])],
			default: "accent",
		},
		title: {
			type: "string",
			required: false,
		},
		icon: {
			type: "string",
			required: false,
			matches: NOTE_ICON_NAME_PATTERN,
		},
	},
};
