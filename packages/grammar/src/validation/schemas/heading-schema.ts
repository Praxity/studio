import type { BlockSchema } from "../validation-types.ts";

export const headingSchema: BlockSchema = {
	keyword: "heading",
	blockType: "heading",
	attributes: {
		level: { type: "number", required: true, min: 1, max: 6 },
		content: { type: "string", required: true },
		pageStyle: { type: "string" },
	},
};
