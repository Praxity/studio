import type { PraxityBlock } from "@praxity/content-model/types";
import { isCoreBlockType, RETIRED_BLOCK_TYPES } from "../supported-blocks.ts";
import { validateGlobalRules } from "./global-rules.ts";
import { ensureBuiltInSchemasRegistered, getSchemaForBlockType } from "./schema-registry.ts";
import type {
	SchemaAttribute,
	ValidationConfig,
	ValidationContext,
	ValidationError,
	ValidationResult,
	ValidationSeverity,
} from "./validation-types.ts";

const SEVERITY_COUNTS_TEMPLATE: Record<ValidationSeverity, number> = {
	debug: 0,
	info: 0,
	warning: 0,
	error: 0,
	critical: 0,
};

const LEVELS_BY_STRICTNESS: Record<ValidationContext["strictness"], ValidationSeverity[]> = {
	strict: ["debug", "info", "warning", "error", "critical"],
	normal: ["warning", "error", "critical"],
	lenient: ["error", "critical"],
};

function resolveConfig(
	blocks: PraxityBlock[],
	config: ValidationConfig | undefined,
): ValidationContext {
	return {
		allBlocks: blocks,
		frontmatter: config?.frontmatter ?? {},
		strictness: config?.strictness ?? "normal",
		suppressions: config?.suppressions ?? [],
	};
}

function normalizeError(
	error: ValidationError,
	fallbackBlock: { id: string; type: string },
	lineMap: Map<string, number>,
): ValidationError {
	const blockId = error.blockId || fallbackBlock.id;
	const blockType = error.blockType || fallbackBlock.type;
	const turnIndex = /^turns\.(\d+)$/u.exec(error.attribute ?? "")?.[1];
	const line =
		error.line ??
		(turnIndex === undefined ? undefined : lineMap.get(`${blockId}:turn:${turnIndex}`)) ??
		lineMap.get(blockId);

	return {
		...error,
		blockId,
		blockType,
		...(line === undefined ? {} : { line }),
	};
}

function validateAttribute(
	name: string,
	schema: SchemaAttribute,
	value: unknown,
	block: PraxityBlock,
	config: ValidationContext,
): ValidationError[] {
	const errors: ValidationError[] = [];
	const level = schema.errorLevel ?? "error";

	const isMissingString = typeof value === "string" && value.trim().length === 0;
	if (schema.required && (value === undefined || value === null || isMissingString)) {
		errors.push({
			id: `missing-${name}`,
			level,
			message: `Required attribute "${name}" is missing.`,
			blockId: block.id,
			blockType: block.type,
			attribute: name,
			category: "content",
		});
		return errors;
	}

	if (value === undefined || value === null) {
		if (schema.validate) {
			errors.push(...schema.validate(value, block, config));
		}
		return errors;
	}

	let typeIsValid = true;

	if (schema.type === "string" || schema.type === "url" || schema.type === "enum") {
		if (typeof value !== "string") {
			typeIsValid = false;
			errors.push({
				id: `invalid-type-${name}`,
				level: "warning",
				message: `Attribute "${name}" should be a string, got ${typeof value}.`,
				blockId: block.id,
				blockType: block.type,
				attribute: name,
				category: "content",
			});
		}
	}

	if (schema.type === "number" && typeof value !== "number") {
		typeIsValid = false;
		errors.push({
			id: `invalid-type-${name}`,
			level: "warning",
			message: `Attribute "${name}" should be a number, got ${typeof value}.`,
			blockId: block.id,
			blockType: block.type,
			attribute: name,
			category: "content",
		});
	}

	if (schema.type === "boolean" && typeof value !== "boolean") {
		typeIsValid = false;
		errors.push({
			id: `invalid-type-${name}`,
			level: "warning",
			message: `Attribute "${name}" should be a boolean, got ${typeof value}.`,
			blockId: block.id,
			blockType: block.type,
			attribute: name,
			category: "content",
		});
	}

	if (schema.type === "array" && !Array.isArray(value)) {
		typeIsValid = false;
		errors.push({
			id: `invalid-type-${name}`,
			level: "warning",
			message: `Attribute "${name}" should be an array.`,
			blockId: block.id,
			blockType: block.type,
			attribute: name,
			category: "content",
		});
	}

	if (schema.type === "number" && typeof value === "number") {
		if (schema.min !== undefined && value < schema.min) {
			errors.push({
				id: `${name}-below-min`,
				level,
				message: `"${name}" is ${value}, minimum is ${schema.min}.`,
				blockId: block.id,
				blockType: block.type,
				attribute: name,
				category: "content",
			});
		}
		if (schema.max !== undefined && value > schema.max) {
			errors.push({
				id: `${name}-above-max`,
				level,
				message: `"${name}" is ${value}, maximum is ${schema.max}.`,
				blockId: block.id,
				blockType: block.type,
				attribute: name,
				category: "content",
			});
		}
	}

	if (schema.matches && Array.isArray(schema.matches) && typeof value === "string") {
		if (!schema.matches.includes(value)) {
			errors.push({
				id: `invalid-${name}`,
				level,
				message: `"${name}" value "${value}" is not valid. Allowed: ${schema.matches.join(", ")}.`,
				blockId: block.id,
				blockType: block.type,
				attribute: name,
				category: "content",
			});
		}
	}

	if (schema.matches instanceof RegExp && typeof value === "string") {
		if (!schema.matches.test(value)) {
			errors.push({
				id: `invalid-${name}-format`,
				level,
				message: `"${name}" value "${value}" does not match the expected format.`,
				blockId: block.id,
				blockType: block.type,
				attribute: name,
				category: "content",
			});
		}
	}

	if (typeIsValid && schema.validate) {
		errors.push(...schema.validate(value, block, config));
	}

	return errors;
}

export function validate(
	blocks: PraxityBlock[],
	source: string,
	config?: ValidationConfig,
): ValidationResult {
	ensureBuiltInSchemasRegistered();
	const resolvedConfig = resolveConfig(blocks, config);
	const lineMap = new Map([...(config?.spans ?? [])].map(([id, span]) => [id, span.startLine + 1]));
	for (const block of blocks) {
		if (block.type !== "dialogue" || !block.data || !Array.isArray(block.data.turns)) continue;
		for (const [index, turn] of block.data.turns.entries()) {
			if (!turn || typeof turn !== "object" || typeof turn.id !== "string") continue;
			const line = lineMap.get(turn.id);
			if (line !== undefined) lineMap.set(`${block.id}:turn:${index}`, line);
		}
	}
	const errors: ValidationError[] = [];

	for (const block of blocks) {
		if (RETIRED_BLOCK_TYPES.has(block.type)) {
			errors.push(
				normalizeError(
					{
						id: "retired-block",
						level: "error",
						message: `Block type "${block.type}" has been retired and cannot be previewed or published.`,
						blockId: block.id,
						blockType: block.type,
						category: "content",
					},
					block,
					lineMap,
				),
			);
		} else if (!isCoreBlockType(block.type)) {
			errors.push(
				normalizeError(
					{
						id: "hidden-block",
						level: "warning",
						message: `Block type "${block.type}" is outside the v1 supported set; it still renders but is unsupported.`,
						blockId: block.id,
						blockType: block.type,
						category: "content",
					},
					block,
					lineMap,
				),
			);
		}

		const schema = getSchemaForBlockType(block.type);
		if (!schema) continue;

		for (const [attributeName, attributeSchema] of Object.entries(schema.attributes)) {
			const value = attributeSchema.read
				? attributeSchema.read(block)
				: block.data?.[attributeName];
			const attributeErrors = validateAttribute(
				attributeName,
				attributeSchema,
				value,
				block,
				resolvedConfig,
			).map((error) => normalizeError(error, block, lineMap));
			errors.push(...attributeErrors);
		}

		if (schema.validate) {
			const customErrors = schema
				.validate(block, resolvedConfig)
				.map((error) => normalizeError(error, block, lineMap));
			errors.push(...customErrors);
		}
	}

	const globalErrors = validateGlobalRules(blocks, resolvedConfig).map((error) => {
		const fallbackBlock = blocks.find((block) => block.id === error.blockId) ?? {
			id: error.blockId,
			type: error.blockType,
		};
		return normalizeError(error, fallbackBlock, lineMap);
	});
	errors.push(...globalErrors);

	const suppressed =
		resolvedConfig.suppressions.length > 0
			? errors.filter((error) => !resolvedConfig.suppressions.includes(error.id))
			: errors;

	const allowedLevels = new Set(LEVELS_BY_STRICTNESS[resolvedConfig.strictness]);
	const filteredErrors = suppressed.filter((error) => allowedLevels.has(error.level));

	const counts = { ...SEVERITY_COUNTS_TEMPLATE };
	for (const error of filteredErrors) {
		counts[error.level] += 1;
	}

	return {
		errors: filteredErrors,
		counts,
		hasErrors: counts.error > 0 || counts.critical > 0,
		hasCritical: counts.critical > 0,
	};
}
