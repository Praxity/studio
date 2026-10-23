import { isSafeEmbedUrl } from "../../utils.ts";
import type { BlockSchema } from "../validation-types.ts";

export const embedSchema: BlockSchema = {
	keyword: "embed",
	blockType: "embed",
	attributes: {
		src: {
			type: "url",
			required: true,
			errorLevel: "error",
			validate(value, block) {
				if (typeof value !== "string" || !value) return [];
				if (isSafeEmbedUrl(value)) return [];
				return [
					{
						id: "unsafe-embed-url",
						level: "critical",
						message: "Embed URL must be HTTPS from a third-party origin.",
						blockId: block.id,
						blockType: block.type,
						attribute: "src",
						category: "security",
					},
				];
			},
		},
	},
};
