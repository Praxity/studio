import { describe, expect, it } from "vitest";
import type {
	CompoundOperation,
	DataProvider,
	LogicAction,
	LogicConditions,
	LogicRule,
} from "./evaluate";
import {
	applyCompoundOperation,
	compareValues,
	evaluateConditions,
	evaluateRule,
	isCompoundOperation,
	normalizeAction,
	resolveOperand,
	resolveSourceValue,
} from "./evaluate";

// ─── DataProvider helpers ────────────────────────────────────────────────────

function makeProvider(opts?: {
	blockFields?: Record<string, Record<string, string | number | boolean>>;
	variables?: Record<string, string | number | boolean>;
	learnerInfo?: Record<string, Record<string, string | number | boolean>>;
}): DataProvider {
	return {
		getBlockField(blockId, field) {
			return opts?.blockFields?.[blockId]?.[field];
		},
		getVariable(name) {
			return opts?.variables?.[name];
		},
		getLearnerInfo(scope, metric) {
			return opts?.learnerInfo?.[scope]?.[metric];
		},
	};
}

// ─── compareValues ────────────────────────────────────────────────────────────

describe("compareValues", () => {
	describe("is", () => {
		it("matches equal primitive values", () => {
			expect(compareValues(42, "is", 42)).toBe(true);
			expect(compareValues("hello", "is", "hello")).toBe(true);
			expect(compareValues(true, "is", true)).toBe(true);
		});

		it("matches with string coercion", () => {
			expect(compareValues(42, "is", "42")).toBe(true);
			expect(compareValues("42", "is", 42)).toBe(true);
		});

		it("returns false for different values", () => {
			expect(compareValues(42, "is", 99)).toBe(false);
		});
	});

	describe("isNot", () => {
		it("matches when values differ", () => {
			expect(compareValues("a", "isNot", "b")).toBe(true);
		});

		it("returns false when values are equal", () => {
			expect(compareValues("a", "isNot", "a")).toBe(false);
		});
	});

	describe("gt", () => {
		it("returns true when actual > expected", () => {
			expect(compareValues(10, "gt", 5)).toBe(true);
		});

		it("returns false when actual <= expected", () => {
			expect(compareValues(5, "gt", 10)).toBe(false);
			expect(compareValues(5, "gt", 5)).toBe(false);
		});
	});

	describe("lt", () => {
		it("returns true when actual < expected", () => {
			expect(compareValues(3, "lt", 7)).toBe(true);
		});

		it("returns false when actual >= expected", () => {
			expect(compareValues(7, "lt", 3)).toBe(false);
			expect(compareValues(5, "lt", 5)).toBe(false);
		});
	});

	describe("gte", () => {
		it("returns true when actual >= expected", () => {
			expect(compareValues(10, "gte", 10)).toBe(true);
			expect(compareValues(11, "gte", 10)).toBe(true);
		});

		it("returns false when actual < expected", () => {
			expect(compareValues(9, "gte", 10)).toBe(false);
		});
	});

	describe("lte", () => {
		it("returns true when actual <= expected", () => {
			expect(compareValues(10, "lte", 10)).toBe(true);
			expect(compareValues(9, "lte", 10)).toBe(true);
		});

		it("returns false when actual > expected", () => {
			expect(compareValues(11, "lte", 10)).toBe(false);
		});
	});

	describe("contains", () => {
		it("returns true when substring is present", () => {
			expect(compareValues("hello world", "contains", "world")).toBe(true);
		});

		it("returns false when substring is absent", () => {
			expect(compareValues("hello", "contains", "xyz")).toBe(false);
		});
	});

	describe("doesNotContain", () => {
		it("returns true when substring is absent", () => {
			expect(compareValues("hello world", "doesNotContain", "foo")).toBe(true);
		});

		it("returns false when substring is present", () => {
			expect(compareValues("hello world", "doesNotContain", "world")).toBe(false);
		});
	});

	describe("startsWith", () => {
		it("returns true for matching prefix", () => {
			expect(compareValues("hello", "startsWith", "hel")).toBe(true);
		});

		it("returns false for non-matching prefix", () => {
			expect(compareValues("hello", "startsWith", "xyz")).toBe(false);
		});
	});

	describe("doesNotStartWith", () => {
		it("returns true when prefix does not match", () => {
			expect(compareValues("hello", "doesNotStartWith", "xyz")).toBe(true);
		});

		it("returns false when prefix matches", () => {
			expect(compareValues("hello", "doesNotStartWith", "hel")).toBe(false);
		});
	});

	describe("endsWith", () => {
		it("returns true for matching suffix", () => {
			expect(compareValues("hello", "endsWith", "llo")).toBe(true);
		});

		it("returns false for non-matching suffix", () => {
			expect(compareValues("hello", "endsWith", "xyz")).toBe(false);
		});
	});

	describe("doesNotEndWith", () => {
		it("returns true when suffix does not match", () => {
			expect(compareValues("hello", "doesNotEndWith", "xyz")).toBe(true);
		});

		it("returns false when suffix matches", () => {
			expect(compareValues("hello", "doesNotEndWith", "llo")).toBe(false);
		});
	});

	describe("isEmpty", () => {
		it("returns true for empty string", () => {
			expect(compareValues("", "isEmpty", "")).toBe(true);
		});

		it("returns true for undefined", () => {
			expect(compareValues(undefined, "isEmpty", "")).toBe(true);
		});

		it("returns true for null", () => {
			expect(compareValues(null, "isEmpty", "")).toBe(true);
		});

		it("returns false for non-empty value", () => {
			expect(compareValues("text", "isEmpty", "")).toBe(false);
			expect(compareValues(42, "isEmpty", "")).toBe(false);
		});
	});

	describe("isNotEmpty", () => {
		it("returns true for non-empty values", () => {
			expect(compareValues("text", "isNotEmpty", "")).toBe(true);
			expect(compareValues(42, "isNotEmpty", "")).toBe(true);
		});

		it("returns false for empty/undefined/null", () => {
			expect(compareValues("", "isNotEmpty", "")).toBe(false);
			expect(compareValues(undefined, "isNotEmpty", "")).toBe(false);
			expect(compareValues(null, "isNotEmpty", "")).toBe(false);
		});
	});

	describe("isAnyOf", () => {
		it("returns true when value is in array", () => {
			expect(compareValues("b", "isAnyOf", ["a", "b", "c"])).toBe(true);
		});

		it("returns false when value is not in array", () => {
			expect(compareValues("z", "isAnyOf", ["a", "b", "c"])).toBe(false);
		});

		it("returns false when expected is not an array", () => {
			expect(compareValues("a", "isAnyOf", "a")).toBe(false);
		});
	});

	describe("isNotAnyOf", () => {
		it("returns false when value is in array", () => {
			expect(compareValues("b", "isNotAnyOf", ["a", "b", "c"])).toBe(false);
		});

		it("returns true when value is not in array", () => {
			expect(compareValues("z", "isNotAnyOf", ["a", "b", "c"])).toBe(true);
		});
	});

	describe("isEveryOf", () => {
		it("returns true when all expected values are in actual array", () => {
			expect(compareValues(["a", "b"], "isEveryOf", ["a", "b"])).toBe(true);
		});

		it("returns false when actual is missing some expected values", () => {
			expect(compareValues(["a"], "isEveryOf", ["a", "b"])).toBe(false);
		});

		it("returns false when actual is not an array", () => {
			expect(compareValues("a", "isEveryOf", ["a"])).toBe(false);
		});

		it("returns false when expected is not an array", () => {
			expect(compareValues(["a"], "isEveryOf", "a")).toBe(false);
		});
	});

	describe("unknown operator", () => {
		it("returns false for unknown comparison operator", () => {
			expect(compareValues("a", "unknownOp", "a")).toBe(false);
		});
	});
});

// ─── resolveSourceValue ───────────────────────────────────────────────────────

describe("resolveSourceValue", () => {
	it("resolves block field", () => {
		const provider = makeProvider({
			blockFields: { "block-1": { ratingScore: 4 } },
		});
		expect(resolveSourceValue("block:block-1", "ratingScore", provider)).toBe(4);
	});

	it("resolves block field via FIELD_ALIASES (value → ratingScore)", () => {
		const provider = makeProvider({
			blockFields: { "block-1": { ratingScore: 4 } },
		});
		expect(resolveSourceValue("block:block-1", "value", provider)).toBe(4);
	});

	it("resolves block field via FIELD_ALIASES (signed → isSigned)", () => {
		const provider = makeProvider({
			blockFields: { "block-1": { isSigned: true } },
		});
		expect(resolveSourceValue("block:block-1", "signed", provider)).toBe(true);
	});

	it("resolves block field via FIELD_ALIASES (paid → isPaid)", () => {
		const provider = makeProvider({
			blockFields: { "block-1": { isPaid: true } },
		});
		expect(resolveSourceValue("block:block-1", "paid", provider)).toBe(true);
	});

	it("returns undefined when block field is missing", () => {
		const provider = makeProvider({ blockFields: {} });
		expect(resolveSourceValue("block:block-1", "ratingScore", provider)).toBeUndefined();
	});

	it("returns undefined when field is not provided for block source", () => {
		const provider = makeProvider({
			blockFields: { "block-1": { ratingScore: 4 } },
		});
		expect(resolveSourceValue("block:block-1", undefined, provider)).toBeUndefined();
	});

	it("resolves variable", () => {
		const provider = makeProvider({ variables: { score: 80 } });
		expect(resolveSourceValue("variable:score", undefined, provider)).toBe(80);
	});

	it("returns undefined for unknown variable", () => {
		const provider = makeProvider({ variables: {} });
		expect(resolveSourceValue("variable:missing", undefined, provider)).toBeUndefined();
	});

	it("resolves learnerInfo with scope and field", () => {
		const provider = makeProvider({
			learnerInfo: { course: { grade: 85 } },
		});
		expect(resolveSourceValue("learnerInfo:course", "grade", provider)).toBe(85);
	});

	it("resolves learnerInfo with metric embedded in source", () => {
		const provider = makeProvider({
			learnerInfo: { course: { grade: 85 } },
		});
		expect(resolveSourceValue("learnerInfo:course:grade", undefined, provider)).toBe(85);
	});

	it("returns undefined for unknown source prefix", () => {
		const provider = makeProvider();
		expect(resolveSourceValue("other:something", undefined, provider)).toBeUndefined();
	});
});

// ─── evaluateRule ─────────────────────────────────────────────────────────────

describe("evaluateRule", () => {
	it("evaluates a variable rule correctly", () => {
		const provider = makeProvider({ variables: { score: 80 } });
		const rule: LogicRule = { source: "variable:score", comparison: "gte", value: 70 };
		expect(evaluateRule(rule, provider)).toBe(true);
	});

	it("returns false when variable value does not satisfy comparison", () => {
		const provider = makeProvider({ variables: { score: 50 } });
		const rule: LogicRule = { source: "variable:score", comparison: "gte", value: 70 };
		expect(evaluateRule(rule, provider)).toBe(false);
	});

	it("evaluates a block rule with field alias", () => {
		const provider = makeProvider({
			blockFields: { "rating-1": { ratingScore: 4 } },
		});
		const rule: LogicRule = {
			source: "block:rating-1",
			field: "value",
			comparison: "gte",
			value: 3,
		};
		expect(evaluateRule(rule, provider)).toBe(true);
	});
});

// ─── evaluateConditions ───────────────────────────────────────────────────────

describe("evaluateConditions", () => {
	it("returns false for empty rules array", () => {
		const provider = makeProvider();
		const conditions: LogicConditions = { operator: "and", rules: [] };
		expect(evaluateConditions(conditions, provider)).toBe(false);
	});

	it("AND — returns true when all rules pass", () => {
		const provider = makeProvider({ variables: { score: 80, passed: true } });
		const conditions: LogicConditions = {
			operator: "and",
			rules: [
				{ source: "variable:score", comparison: "gte", value: 70 },
				{ source: "variable:passed", comparison: "is", value: true },
			],
		};
		expect(evaluateConditions(conditions, provider)).toBe(true);
	});

	it("AND — returns false when any rule fails", () => {
		const provider = makeProvider({ variables: { score: 50, passed: true } });
		const conditions: LogicConditions = {
			operator: "and",
			rules: [
				{ source: "variable:score", comparison: "gte", value: 70 },
				{ source: "variable:passed", comparison: "is", value: true },
			],
		};
		expect(evaluateConditions(conditions, provider)).toBe(false);
	});

	it("OR — returns true when any rule passes", () => {
		const provider = makeProvider({ variables: { score: 50, passed: true } });
		const conditions: LogicConditions = {
			operator: "or",
			rules: [
				{ source: "variable:score", comparison: "gte", value: 70 },
				{ source: "variable:passed", comparison: "is", value: true },
			],
		};
		expect(evaluateConditions(conditions, provider)).toBe(true);
	});

	it("OR — returns false when all rules fail", () => {
		const provider = makeProvider({ variables: { score: 50, passed: false } });
		const conditions: LogicConditions = {
			operator: "or",
			rules: [
				{ source: "variable:score", comparison: "gte", value: 70 },
				{ source: "variable:passed", comparison: "is", value: true },
			],
		};
		expect(evaluateConditions(conditions, provider)).toBe(false);
	});
});

// ─── resolveOperand ───────────────────────────────────────────────────────────

describe("resolveOperand", () => {
	it("returns literal number directly", () => {
		const provider = makeProvider();
		expect(resolveOperand(5, provider)).toBe(5);
	});

	it("returns literal string directly", () => {
		const provider = makeProvider();
		expect(resolveOperand("hello", provider)).toBe("hello");
	});

	it("returns literal boolean directly", () => {
		const provider = makeProvider();
		expect(resolveOperand(true, provider)).toBe(true);
	});

	it("resolves ref object via provider", () => {
		const provider = makeProvider({ variables: { score: 42 } });
		expect(resolveOperand({ ref: "variable:score" }, provider)).toBe(42);
	});

	it("resolves ref object with field via provider", () => {
		const provider = makeProvider({
			blockFields: { "block-1": { ratingScore: 3 } },
		});
		expect(resolveOperand({ ref: "block:block-1", field: "ratingScore" }, provider)).toBe(3);
	});
});

// ─── isCompoundOperation ──────────────────────────────────────────────────────

describe("isCompoundOperation", () => {
	it("returns true for compound operation objects", () => {
		expect(isCompoundOperation({ operation: "add", operand: 1 })).toBe(true);
		expect(isCompoundOperation({ operation: "assign", operand: "x" })).toBe(true);
	});

	it("returns false for non-objects", () => {
		expect(isCompoundOperation(42)).toBe(false);
		expect(isCompoundOperation("hello")).toBe(false);
		expect(isCompoundOperation(true)).toBe(false);
	});
});

// ─── applyCompoundOperation ───────────────────────────────────────────────────

describe("applyCompoundOperation", () => {
	it("assign — returns the operand value", () => {
		const provider = makeProvider();
		expect(applyCompoundOperation(10, { operation: "assign", operand: 5 }, provider)).toBe(5);
	});

	it("assign — defaults operand to 0 if undefined", () => {
		const provider = makeProvider({ variables: { missing: undefined as unknown as string } });
		// operand is a ref that resolves to undefined
		expect(
			applyCompoundOperation(
				10,
				{ operation: "assign", operand: { ref: "variable:missing" } },
				provider,
			),
		).toBe(0);
	});

	it("add — adds operand to current value", () => {
		const provider = makeProvider();
		expect(applyCompoundOperation(10, { operation: "add", operand: 5 }, provider)).toBe(15);
	});

	it("add — treats undefined current as 0", () => {
		const provider = makeProvider();
		expect(applyCompoundOperation(undefined, { operation: "add", operand: 3 }, provider)).toBe(3);
	});

	it("subtract — subtracts operand from current value", () => {
		const provider = makeProvider();
		expect(applyCompoundOperation(10, { operation: "subtract", operand: 3 }, provider)).toBe(7);
	});

	it("multiply — multiplies current value by operand", () => {
		const provider = makeProvider();
		expect(applyCompoundOperation(4, { operation: "multiply", operand: 3 }, provider)).toBe(12);
	});

	it("divide — divides current value by operand", () => {
		const provider = makeProvider();
		expect(applyCompoundOperation(10, { operation: "divide", operand: 2 }, provider)).toBe(5);
	});

	it("divide — guards zero divisor, returns current value unchanged", () => {
		const provider = makeProvider();
		expect(applyCompoundOperation(10, { operation: "divide", operand: 0 }, provider)).toBe(10);
	});

	it("concat — concatenates strings", () => {
		const provider = makeProvider();
		expect(
			applyCompoundOperation("hello", { operation: "concat", operand: " world" }, provider),
		).toBe("hello world");
	});

	it("concat — treats undefined current as empty string", () => {
		const provider = makeProvider();
		expect(
			applyCompoundOperation(undefined, { operation: "concat", operand: "hi" }, provider),
		).toBe("hi");
	});

	it("unknown operation — returns current value or 0", () => {
		const provider = makeProvider();
		const unknownOp = "unknown" as CompoundOperation["operation"];
		expect(applyCompoundOperation(7, { operation: unknownOp, operand: 1 }, provider)).toBe(7);
		expect(applyCompoundOperation(undefined, { operation: unknownOp, operand: 1 }, provider)).toBe(
			0,
		);
	});
});

// ─── normalizeAction ──────────────────────────────────────────────────────────

describe("normalizeAction", () => {
	it("returns null for seekTo action", () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing legacy type
		const action: LogicAction = { type: "seekTo" as any, target: "section-1" };
		expect(normalizeAction(action)).toBeNull();
	});

	it("converts requireCompletion to require", () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing legacy type
		const action: LogicAction = { type: "requireCompletion" as any, target: "block-1" };
		const result = normalizeAction(action);
		expect(result?.type).toBe("require");
	});

	it("normalizes single target to targets array", () => {
		const action: LogicAction = { type: "show", target: "block-1" };
		const result = normalizeAction(action);
		expect(result?.targets).toEqual(["block-1"]);
	});

	it("preserves existing targets array", () => {
		const action: LogicAction = { type: "hide", targets: ["block-a", "block-b"] };
		const result = normalizeAction(action);
		expect(result?.targets).toEqual(["block-a", "block-b"]);
	});

	it("returns empty targets array when neither target nor targets provided", () => {
		const action: LogicAction = { type: "disableCompletion" };
		const result = normalizeAction(action);
		expect(result?.targets).toEqual([]);
	});

	it("preserves action value", () => {
		const action: LogicAction = { type: "setVariable", target: "myVar", value: 42 };
		const result = normalizeAction(action);
		expect(result?.value).toBe(42);
	});
});
