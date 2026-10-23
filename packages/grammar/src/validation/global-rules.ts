import { isInlineProjectionMetadataKey } from "@praxity/content-model/inline-fields";
import type { PraxityBlock } from "@praxity/content-model/types";
import type { ValidationContext, ValidationError } from "./validation-types.ts";

function validateHeadingHierarchy(blocks: PraxityBlock[]): ValidationError[] {
	const errors: ValidationError[] = [];
	let lastLevel = 0;

	for (const block of blocks) {
		if (block.type !== "heading") continue;

		const levelRaw = block.data?.level;
		const level = typeof levelRaw === "number" ? levelRaw : NaN;

		if (!Number.isFinite(level) || level < 1 || level > 6) {
			errors.push({
				id: "heading-level-invalid",
				level: "error",
				message: `Heading level ${String(levelRaw)} is invalid. Allowed range is 1-6.`,
				blockId: block.id,
				blockType: block.type,
				attribute: "level",
				category: "structure",
			});
			continue;
		}

		if (lastLevel > 0 && level > lastLevel + 1) {
			errors.push({
				id: "heading-level-skip",
				level: "warning",
				message: `Heading hierarchy skips from H${lastLevel} to H${level}.`,
				blockId: block.id,
				blockType: block.type,
				attribute: "level",
				category: "accessibility",
			});
		}

		lastLevel = level;
	}

	return errors;
}

function validateEmptyDocument(blocks: PraxityBlock[]): ValidationError[] {
	const contentBlocks = blocks.filter(
		(block) => block.type !== "pageBreak" && block.type !== "divider",
	);
	if (contentBlocks.length > 0) return [];
	return [
		{
			id: "empty-document",
			level: "info",
			message: "Document has no content blocks.",
			blockId: "",
			blockType: "",
			category: "content",
		},
	];
}

function validateRetiredReveals(blocks: PraxityBlock[]): ValidationError[] {
	const errors: ValidationError[] = [];
	const visit = (value: unknown): void => {
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const block = value as Partial<PraxityBlock>;
		if (typeof block.id === "string" && typeof block.type === "string") {
			const reveal = block.data?.reveal;
			if (reveal !== undefined && block.type !== "labeledGraphic") {
				errors.push({
					id: "retired-reveal",
					level: "warning",
					message: "Generic reveal is no longer supported. The content remains visible.",
					blockId: block.id,
					blockType: block.type,
					attribute: "reveal",
					category: "content",
				});
			}
		}
		for (const [key, child] of Object.entries(value as Record<string, unknown>))
			if (!isInlineProjectionMetadataKey(key, { keepDisplay: true })) visit(child);
	};
	visit(blocks);
	return errors;
}

export function validateGlobalRules(
	blocks: PraxityBlock[],
	_config: ValidationContext,
): ValidationError[] {
	return [
		...validateHeadingHierarchy(blocks),
		...validateEmptyDocument(blocks),
		...validateRetiredReveals(blocks),
	];
}
