import type { BlockSchema, ValidationError } from "../validation-types.ts";

export const assessmentGroupSchema: BlockSchema = {
	keyword: "assessment-group",
	blockType: "assessmentGroup",
	attributes: {
		deckGate: { type: "enum", required: false, matches: ["attempt", "pass"] },
		groupName: { type: "string", required: false },
		buttonLabel: { type: "string", required: false },
		mode: {
			type: "enum",
			required: false,
			matches: ["all", "oneOf"],
			default: "all",
		},
		memberBlockIds: { type: "array", required: true, errorLevel: "error" },
		requireAll: { type: "boolean", required: false },
		showResultsSummary: { type: "boolean", required: false },
		pointsOverride: { type: "number", required: false, min: 0 },
		passingScore: { type: "number", required: false, min: 0, max: 100 },
	},
	validate(block, config) {
		const errors: ValidationError[] = [];
		const data = block.data as Record<string, unknown>;
		const memberIds = Array.isArray(data.memberBlockIds)
			? data.memberBlockIds.filter((value): value is string => typeof value === "string")
			: [];

		if (memberIds.length === 0) {
			errors.push({
				id: "assessment-group-empty",
				level: "error",
				message: "Assessment group has no members.",
				blockId: block.id,
				blockType: block.type,
				category: "content",
			});
			return errors;
		}

		const blockById = new Map(config.allBlocks.map((candidate) => [candidate.id, candidate]));

		for (const memberId of memberIds) {
			if (blockById.has(memberId)) continue;
			errors.push({
				id: "assessment-group-invalid-member",
				level: "error",
				message: `Member "${memberId}" does not reference a block in this document.`,
				blockId: block.id,
				blockType: block.type,
				attribute: "memberBlockIds",
				category: "structure",
			});
		}

		for (const memberId of memberIds) {
			const memberBlock = blockById.get(memberId);
			if (!memberBlock || memberBlock.type === "assessment") continue;
			errors.push({
				id: "assessment-group-non-assessment-member",
				level: "warning",
				message: `Member "${memberId}" is ${memberBlock.type}, not an assessment block.`,
				blockId: block.id,
				blockType: block.type,
				attribute: "memberBlockIds",
				category: "structure",
			});
		}

		return errors;
	},
};
