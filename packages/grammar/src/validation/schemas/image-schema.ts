import { isSafeMediaUrl } from "../../utils.ts";
import type { BlockSchema } from "../validation-types.ts";

export const imageSchema: BlockSchema = {
	keyword: "image",
	blockType: "image",
	attributes: {
		ratio: { type: "enum", required: false, matches: ["square", "4:3", "3:2", "16:9"] },
		fit: { type: "enum", required: false, matches: ["contain", "cover"] },
		src: {
			type: "url",
			required: true,
			errorLevel: "error",
			description: "Image source URL. Must be HTTPS or another safe protocol.",
			validate(value, block) {
				if (typeof value !== "string" || !value) return [];
				if (isSafeMediaUrl(value)) return [];
				return [
					{
						id: "unsafe-media-url",
						level: "critical",
						message: `Image URL "${value}" uses an unsafe protocol. Use HTTPS URLs only.`,
						blockId: block.id,
						blockType: block.type,
						attribute: "src",
						category: "security",
					},
				];
			},
		},
		altText: {
			type: "string",
			required: false,
			errorLevel: "error",
			description: "Alternative text for screen readers unless decorative.",
			validate(value, block) {
				// Parser stores alt text as data.altText (not data.alt)
				// Also check data.alt for editor-shape blocks
				const altValue = value ?? block.data?.alt;
				const decorative = block.data?.decorative === true;
				if (decorative) return [];
				if (typeof altValue === "string" && altValue.trim().length > 0) return [];
				return [
					{
						id: "missing-alt-text",
						level: "error",
						message:
							"Image requires alt text for accessibility, or mark it decorative when appropriate.",
						blockId: block.id,
						blockType: block.type,
						attribute: "altText",
						category: "accessibility",
					},
				];
			},
		},
		decorative: {
			type: "boolean",
			required: false,
			default: false,
		},
		caption: {
			type: "string",
			required: false,
		},
		width: {
			type: "enum",
			required: false,
			matches: ["small", "medium", "large"],
		},
		float: {
			type: "enum",
			required: false,
			matches: ["left", "right"],
		},
		alignment: {
			type: "enum",
			required: false,
			matches: ["left", "center", "right"],
		},
	},
	validate(block) {
		const data = block.data as Record<string, unknown>;
		if (data.float !== "left" && data.float !== "right") return [];

		const errors = [];
		if (data.width === undefined || data.width === null || data.width === "") {
			errors.push({
				id: "image-float-requires-width",
				level: "warning" as const,
				message: '"float" requires size: small, medium, or large.',
				blockId: block.id,
				blockType: block.type,
				attribute: "float",
				category: "content",
			});
		}
		if (
			[data.layoutMode, data.layout].some(
				(layout) => layout !== undefined && layout !== null && layout !== "",
			)
		) {
			errors.push({
				id: "image-float-conflicts-layout",
				level: "warning" as const,
				message: '"float" does not work with outer "width"; remove one of them.',
				blockId: block.id,
				blockType: block.type,
				attribute: "float",
				category: "content",
			});
		}
		return errors;
	},
};
