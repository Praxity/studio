import { isSafeMediaUrl } from "../../utils.ts";
import type { BlockSchema } from "../validation-types.ts";

export const audioSchema: BlockSchema = {
	keyword: "audio",
	blockType: "audio",
	attributes: {
		src: {
			type: "url",
			required: true,
			errorLevel: "error",
			validate(value, block) {
				if (typeof value !== "string" || !value) return [];
				if (isSafeMediaUrl(value)) return [];
				return [
					{
						id: "unsafe-media-url",
						level: "critical",
						message: "Audio URL uses an unsafe protocol.",
						blockId: block.id,
						blockType: block.type,
						attribute: "src",
						category: "security",
					},
				];
			},
		},
		title: { type: "string", required: false },
	},
	validate(block) {
		const data = block.data as Record<string, unknown>;
		if (data.transcript) return [];
		return [
			{
				id: "audio-missing-transcript",
				level: "warning",
				message: "Audio-only content should include a transcript.",
				blockId: block.id,
				blockType: block.type,
				category: "accessibility",
			},
		];
	},
};
