import type { LogicAction as AuthoredLogicAction } from "@praxity/content-model/types";

export type { VariableDefinition } from "./variable-store.ts";

export interface DataProvider {
	getBlockField(blockId: string, field: string): string | number | boolean | undefined;
	getVariable(name: string): string | number | boolean | undefined;
	getLearnerInfo(scope: string, metric: string): string | number | boolean | undefined;
}

export interface LogicRule {
	source: string;
	field?: string;
	comparison: string;
	value: string | number | boolean | string[];
}

export interface CompoundOperation {
	operation: "add" | "subtract" | "multiply" | "divide" | "assign" | "concat";
	operand: number | string | boolean | { ref: string; field?: string };
}

export interface LogicAction extends Pick<AuthoredLogicAction, "reason"> {
	type: string;
	target?: string;
	targets?: string[];
	value?: string | number | boolean | CompoundOperation;
}

export interface LogicConditions {
	operator: "and" | "or";
	rules: LogicRule[];
}

export interface NormalizedAction extends Pick<LogicAction, "reason"> {
	type: string;
	targets: string[];
	value?: string | number | boolean | CompoundOperation;
}

export const FIELD_ALIASES: Record<string, string> = {
	value: "ratingScore",
	signed: "isSigned",
	paid: "isPaid",
};

export function compareValues(actual: unknown, comparison: string, expected: unknown): boolean {
	switch (comparison) {
		case "is":
			return actual === expected || String(actual) === String(expected);
		case "isNot":
			return actual !== expected && String(actual) !== String(expected);
		case "gt":
			return Number(actual) > Number(expected);
		case "lt":
			return Number(actual) < Number(expected);
		case "gte":
			return Number(actual) >= Number(expected);
		case "lte":
			return Number(actual) <= Number(expected);
		case "contains":
			return String(actual).includes(String(expected));
		case "doesNotContain":
			return !String(actual).includes(String(expected));
		case "startsWith":
			return String(actual).startsWith(String(expected));
		case "doesNotStartWith":
			return !String(actual).startsWith(String(expected));
		case "endsWith":
			return String(actual).endsWith(String(expected));
		case "doesNotEndWith":
			return !String(actual).endsWith(String(expected));
		case "isEmpty":
			return actual === undefined || actual === "" || actual === null;
		case "isNotEmpty":
			return actual !== undefined && actual !== "" && actual !== null;
		case "isAnyOf":
			return Array.isArray(expected) && expected.includes(actual);
		case "isNotAnyOf":
			return Array.isArray(expected) && !expected.includes(actual);
		case "isEveryOf":
			if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
			return expected.every((v) => (actual as unknown[]).includes(v));
		default:
			return false;
	}
}

export function resolveSourceValue(
	source: string,
	field: string | undefined,
	provider: DataProvider,
): string | number | boolean | undefined {
	if (source.startsWith("block:")) {
		const blockId = source.slice("block:".length);
		if (!field) return undefined;
		const direct = provider.getBlockField(blockId, field);
		if (direct !== undefined) return direct;
		const alias = FIELD_ALIASES[field];
		if (alias) return provider.getBlockField(blockId, alias);
		return undefined;
	}

	if (source.startsWith("variable:")) {
		const varName = source.slice("variable:".length);
		return provider.getVariable(varName);
	}

	if (source.startsWith("learnerInfo:")) {
		const parts = source.split(":");
		const scope = parts[1];
		const metric = field ?? parts[2];
		if (metric && scope) {
			return provider.getLearnerInfo(scope, metric);
		}
		return undefined;
	}

	return undefined;
}

export function evaluateRule(rule: LogicRule, provider: DataProvider): boolean {
	const sourceValue = resolveSourceValue(rule.source, rule.field, provider);
	return compareValues(sourceValue, rule.comparison, rule.value);
}

export function evaluateConditions(conditions: LogicConditions, provider: DataProvider): boolean {
	if (conditions.rules.length === 0) return false;

	const results = conditions.rules.map((rule) => evaluateRule(rule, provider));

	return conditions.operator === "and" ? results.every(Boolean) : results.some(Boolean);
}

export function resolveOperand(
	operand: number | string | boolean | { ref: string; field?: string },
	provider: DataProvider,
): string | number | boolean | undefined {
	if (typeof operand === "object" && operand !== null && "ref" in operand) {
		return resolveSourceValue(operand.ref, operand.field, provider);
	}
	return operand;
}

export function isCompoundOperation(
	value: string | number | boolean | CompoundOperation,
): value is CompoundOperation {
	return typeof value === "object" && value !== null && "operation" in value && "operand" in value;
}

export function applyCompoundOperation(
	currentValue: string | number | boolean | undefined,
	op: CompoundOperation,
	provider: DataProvider,
): string | number | boolean {
	const operand = resolveOperand(op.operand, provider);

	switch (op.operation) {
		case "assign":
			return operand ?? 0;
		case "add":
			return Number(currentValue ?? 0) + Number(operand ?? 0);
		case "subtract":
			return Number(currentValue ?? 0) - Number(operand ?? 0);
		case "multiply":
			return Number(currentValue ?? 0) * Number(operand ?? 0);
		case "divide": {
			const divisor = Number(operand ?? 0);
			return divisor !== 0 ? Number(currentValue ?? 0) / divisor : Number(currentValue ?? 0);
		}
		case "concat":
			return String(currentValue ?? "") + String(operand ?? "");
		default:
			return currentValue ?? 0;
	}
}

export function normalizeAction(action: LogicAction): NormalizedAction | null {
	if ((action.type as string) === "seekTo") return null;

	let type = action.type;
	if ((type as string) === "requireCompletion") {
		type = "require";
	}

	const targets = action.targets ?? (action.target ? [action.target] : []);

	return {
		type,
		targets,
		value: action.value,
		...(typeof action.reason === "string" ? { reason: action.reason } : {}),
	};
}
