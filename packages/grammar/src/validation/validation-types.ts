import type { PraxityBlock } from "@praxity/content-model/types";
import type { GrammarFrontmatter } from "../types.ts";

export type ValidationSeverity = "debug" | "info" | "warning" | "error" | "critical";

export type ValidationStrictness = "strict" | "normal" | "lenient";

export type SchemaAttributeType = "string" | "number" | "boolean" | "url" | "enum" | "array";

export interface ValidationFix {
	action: "set-attribute" | "remove-block" | "add-child" | "replace-value";
	attribute?: string;
	value?: unknown;
	description: string;
}

export interface ValidationError {
	id: string;
	level: ValidationSeverity;
	message: string;
	blockId: string;
	blockType: string;
	attribute?: string;
	line?: number;
	category?: string;
	fix?: ValidationFix;
}

export interface ValidationResult {
	errors: ValidationError[];
	counts: Record<ValidationSeverity, number>;
	hasErrors: boolean;
	hasCritical: boolean;
}

export interface ValidationConfig {
	strictness?: ValidationStrictness;
	suppressions?: string[];
	frontmatter?: GrammarFrontmatter;
	/** Whole-file, zero-based ranges from the grammar reader. */
	spans?: ReadonlyMap<string, { startLine: number; endLine: number }>;
}

export interface ValidationContext {
	allBlocks: PraxityBlock[];
	frontmatter: GrammarFrontmatter;
	strictness: ValidationStrictness;
	suppressions: string[];
}

export interface SchemaAttribute {
	type: SchemaAttributeType;
	/** Project a canonical field when the renderer shape differs from the legacy field. */
	read?: (block: PraxityBlock) => unknown;
	required?: boolean;
	default?: unknown;
	matches?: readonly string[] | RegExp;
	min?: number;
	max?: number;
	errorLevel?: ValidationSeverity;
	description?: string;
	validate?: (value: unknown, block: PraxityBlock, config: ValidationContext) => ValidationError[];
}

export interface BlockSchema {
	keyword: string;
	blockType: string;
	attributes: Record<string, SchemaAttribute>;
	children?: string[];
	validate?: (block: PraxityBlock, config: ValidationContext) => ValidationError[];
}
