import type { LogicRule } from "@praxity/content-model/types";

/** Parse the condition syntax shared by `if:` rules and block `visible:` values. */
export function parseLogicConditionExpression(expression: string): LogicRule {
	const input = expression.trim();
	const negatedBoolean = /^!([A-Za-z][\w-]*)$/.exec(input);
	if (negatedBoolean) {
		return { source: `variable:${negatedBoolean[1]}`, comparison: "is", value: false };
	}

	const blockRef = /^(?:block:|@)?([A-Za-z][\w-]*)\.([A-Za-z][\w-]*)\s+(.+)$/.exec(input);
	if (blockRef) {
		const comparison = parseFieldComparison(blockRef[3]);
		if (comparison) {
			return { source: `block:${blockRef[1]}`, field: blockRef[2], ...comparison };
		}
	}

	for (const pattern of COMPARISONS) {
		const match = pattern.variable.exec(input);
		if (!match) continue;
		const rawValue = match[2]?.trim() ?? "";
		return {
			source: `variable:${match[1].trim()}`,
			comparison: pattern.comparison,
			value: pattern.list ? parseList(rawValue) : parseLogicScalarValue(rawValue),
		};
	}

	return { source: `variable:${input}`, comparison: "is", value: true };
}

/** Compile one `visible:` value into the condition shape consumed by LogicEngine. */
export function compileVisibleExpression(expression: string): {
	operator: "and";
	rules: LogicRule[];
} {
	return { operator: "and", rules: [parseLogicConditionExpression(expression)] };
}

export function parseLogicScalarValue(raw: string): string | number | boolean {
	const input = raw.trim();
	if (
		(input.startsWith('"') && input.endsWith('"')) ||
		(input.startsWith("'") && input.endsWith("'"))
	) {
		return input.slice(1, -1);
	}
	if (input === "true") return true;
	if (input === "false") return false;
	if (/^-?\d+(?:\.\d+)?$/.test(input)) return Number(input);
	return input;
}

type Comparison = LogicRule["comparison"];

const COMPARISONS: Array<{
	variable: RegExp;
	field: RegExp;
	comparison: Comparison;
	list?: boolean;
}> = [
	{
		variable: /^(.+?)\s+isNotAnyOf\s+(.+)$/,
		field: /^isNotAnyOf\s+(.+)$/,
		comparison: "isNotAnyOf",
		list: true,
	},
	{
		variable: /^(.+?)\s+isEveryOf\s+(.+)$/,
		field: /^isEveryOf\s+(.+)$/,
		comparison: "isEveryOf",
		list: true,
	},
	{
		variable: /^(.+?)\s+isAnyOf\s+(.+)$/,
		field: /^isAnyOf\s+(.+)$/,
		comparison: "isAnyOf",
		list: true,
	},
	{
		variable: /^(.+?)\s+doesNotContain\s+(.+)$/,
		field: /^doesNotContain\s+(.+)$/,
		comparison: "doesNotContain",
	},
	{
		variable: /^(.+?)\s+doesNotStartWith\s+(.+)$/,
		field: /^doesNotStartWith\s+(.+)$/,
		comparison: "doesNotStartWith",
	},
	{
		variable: /^(.+?)\s+startsWith\s+(.+)$/,
		field: /^startsWith\s+(.+)$/,
		comparison: "startsWith",
	},
	{
		variable: /^(.+?)\s+doesNotEndWith\s+(.+)$/,
		field: /^doesNotEndWith\s+(.+)$/,
		comparison: "doesNotEndWith",
	},
	{
		variable: /^(.+?)\s+endsWith\s+(.+)$/,
		field: /^endsWith\s+(.+)$/,
		comparison: "endsWith",
	},
	{ variable: /^(.+?)\s+isNot\s+(.+)$/, field: /^isNot\s+(.+)$/, comparison: "isNot" },
	{ variable: /^(.+?)\s+is\s+(.+)$/, field: /^is\s+(.+)$/, comparison: "is" },
	{ variable: /^(.+?)\s*>=\s*(.+)$/, field: /^>=\s*(.+)$/, comparison: "gte" },
	{ variable: /^(.+?)\s*<=\s*(.+)$/, field: /^<=\s*(.+)$/, comparison: "lte" },
	{ variable: /^(.+?)\s*>\s*(.+)$/, field: /^>\s*(.+)$/, comparison: "gt" },
	{ variable: /^(.+?)\s*<\s*(.+)$/, field: /^<\s*(.+)$/, comparison: "lt" },
	{
		variable: /^(.+?)\s+contains\s+(.+)$/,
		field: /^contains\s+(.+)$/,
		comparison: "contains",
	},
	{ variable: /^(.+?)\s+isEmpty$/, field: /^isEmpty$/, comparison: "isEmpty" },
	{ variable: /^(.+?)\s+isNotEmpty$/, field: /^isNotEmpty$/, comparison: "isNotEmpty" },
];

function parseFieldComparison(
	expression: string,
): Pick<LogicRule, "comparison" | "value"> | undefined {
	for (const pattern of COMPARISONS) {
		const match = pattern.field.exec(expression.trim());
		if (!match) continue;
		const rawValue = match[1]?.trim() ?? "";
		return {
			comparison: pattern.comparison,
			value: pattern.list ? parseList(rawValue) : parseLogicScalarValue(rawValue),
		};
	}
	return undefined;
}

function parseList(raw: string): string[] {
	return raw
		.split(",")
		.map((part) => String(parseLogicScalarValue(part.trim())).trim())
		.filter(Boolean);
}
