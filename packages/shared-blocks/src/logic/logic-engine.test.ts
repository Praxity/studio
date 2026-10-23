import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogicEngine } from "./logic-engine";
import { VariableStore } from "./variable-store";

// Stub HTMLElement in Node environment (no jsdom)
class MockHTMLElement {
	style: Record<string, string> = {};
	attributes: Record<string, string> = {};
	children: MockHTMLElement[] = [];
	parentElement: MockHTMLElement | null = null;
	className = "";
	innerHTML = "";
	firstChild: MockHTMLElement | null = null;
	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}
	getAttribute(name: string) {
		return this.attributes[name] ?? null;
	}
	removeAttribute(name: string) {
		delete this.attributes[name];
	}
	querySelector(selector: string) {
		// Check if any child matches the selector by className
		const classMatch = selector.match(/^\.(.+)$/);
		if (classMatch) {
			return this.children.find((c) => c.className === classMatch[1]) ?? null;
		}
		return null;
	}
	insertBefore(newChild: MockHTMLElement, _ref: MockHTMLElement | null) {
		newChild.parentElement = this;
		this.children.unshift(newChild);
		return newChild;
	}
	remove() {
		if (!this.parentElement) return;
		const index = this.parentElement.children.indexOf(this);
		if (index >= 0) this.parentElement.children.splice(index, 1);
		this.parentElement = null;
	}
}
vi.stubGlobal("HTMLElement", MockHTMLElement);

// Mock document for LogicEngine's DOM access
// biome-ignore lint/suspicious/noExplicitAny: test mock
const mockElements = new Map<string, any>();

vi.stubGlobal("document", {
	querySelector: (selector: string) => {
		const match = selector.match(/\[data-block-id="([^"]+)"\]/);
		if (match) return mockElements.get(match[1]) ?? null;
		if (selector === "[data-continue-button]")
			return mockElements.get("__continue-button__") ?? null;
		return null;
	},
	querySelectorAll: (selector: string) => {
		const match = selector.match(/\[data-block-id="([^"]+)"\]/);
		const element = match ? mockElements.get(match[1]) : undefined;
		return element ? [element] : [];
	},
	createElement: (_tag: string) => new MockHTMLElement(),
});

function createMockRuntime() {
	return {
		getSuspendData: () => null,
		setSuspendData: vi.fn(),
		commit: vi.fn(),
	};
}

function createTestVariableStore(vars?: Record<string, string | number | boolean | string[]>) {
	const runtime = createMockRuntime();
	const store = new VariableStore([], runtime);
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			// biome-ignore lint/suspicious/noExplicitAny: allow arrays for testing isEveryOf
			store.set(k, v as any);
		}
	}
	return store;
}

describe("LogicEngine", () => {
	beforeEach(() => {
		mockElements.clear();
	});

	describe("evaluate() with conditions", () => {
		it("AND conditions — all rules must pass", () => {
			const store = createTestVariableStore({
				score: 80,
				passed: true,
			});
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-1",
				conditions: {
					operator: "and",
					rules: [
						{
							source: "variable:score",
							comparison: "gte",
							value: 70,
						},
						{
							source: "variable:passed",
							comparison: "is",
							value: true,
						},
					],
				},
				actions: [{ type: "jumpToPage", target: "page-success" }],
			});

			engine.evaluate();
			expect(engine.getJumpTarget()).toBe("page-success");
		});

		it("AND conditions — fails if any rule fails", () => {
			const store = createTestVariableStore({ score: 50, passed: true });
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-1",
				conditions: {
					operator: "and",
					rules: [
						{
							source: "variable:score",
							comparison: "gte",
							value: 70,
						},
						{
							source: "variable:passed",
							comparison: "is",
							value: true,
						},
					],
				},
				actions: [{ type: "jumpToPage", target: "page-success" }],
			});

			engine.evaluate();
			expect(engine.getJumpTarget()).toBeNull();
		});

		it("OR conditions — any rule can pass", () => {
			const store = createTestVariableStore({ score: 50, passed: true });
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-1",
				conditions: {
					operator: "or",
					rules: [
						{
							source: "variable:score",
							comparison: "gte",
							value: 70,
						},
						{
							source: "variable:passed",
							comparison: "is",
							value: true,
						},
					],
				},
				actions: [{ type: "jumpToPage", target: "page-success" }],
			});

			engine.evaluate();
			expect(engine.getJumpTarget()).toBe("page-success");
		});
	});

	describe("getJumpTarget()", () => {
		it("returns null when no conditions met", () => {
			const store = createTestVariableStore({ score: 10 });
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-1",
				conditions: {
					operator: "and",
					rules: [
						{
							source: "variable:score",
							comparison: "gte",
							value: 70,
						},
					],
				},
				actions: [{ type: "jumpToPage", target: "page-2" }],
			});

			engine.evaluate();
			expect(engine.getJumpTarget()).toBeNull();
		});

		it("returns page ID when jumpToPage action fires", () => {
			const store = createTestVariableStore({ score: 100 });
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-1",
				conditions: {
					operator: "and",
					rules: [
						{
							source: "variable:score",
							comparison: "gte",
							value: 70,
						},
					],
				},
				actions: [{ type: "jumpToPage", target: "page-reward" }],
			});

			engine.evaluate();
			expect(engine.getJumpTarget()).toBe("page-reward");
		});
	});

	describe("actions", () => {
		it("setVariable action updates VariableStore", () => {
			const store = createTestVariableStore({ attempts: 0 });
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-1",
				conditions: {
					operator: "and",
					rules: [
						{
							source: "variable:attempts",
							comparison: "is",
							value: 0,
						},
					],
				},
				actions: [{ type: "setVariable", target: "attempts", value: 1 }],
			});

			engine.evaluate();
			expect(store.get("attempts")).toBe(1);
		});

		it("show action adds target to visible block set", () => {
			const store = createTestVariableStore({ visible: true });
			const engine = new LogicEngine(store, []);

			// Test show
			engine.registerLogicBlock({
				blockId: "logic-show",
				conditions: {
					operator: "and",
					rules: [
						{
							source: "variable:visible",
							comparison: "is",
							value: true,
						},
					],
				},
				actions: [{ type: "show", target: "block-target" }],
			});

			engine.evaluate();
			expect(engine.getVisibleBlockIds().has("block-target")).toBe(true);
		});

		it("keeps hidden named blocks hidden until shown by alias", () => {
			const store = createTestVariableStore({ reveal: false });
			const engine = new LogicEngine(store, [
				{ id: "intro", type: "text" },
				{ id: "follow-up", type: "text", data: { name: "correctFollowUp", hide: true } },
			]);

			engine.registerLogicBlock({
				blockId: "logic-show",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:reveal", comparison: "is", value: true }],
				},
				actions: [{ type: "show", target: "correctFollowUp" }],
			});

			engine.evaluate();
			expect(engine.getVisibleBlockIds().has("intro")).toBe(true);
			expect(engine.getVisibleBlockIds().has("follow-up")).toBe(false);

			store.set("reveal", true);
			engine.evaluate();
			expect(engine.getVisibleBlockIds().has("follow-up")).toBe(true);
		});

		it("shows and hides named heading sections with their content", () => {
			const store = createTestVariableStore({ reveal: false });
			const engine = new LogicEngine(store, [
				{ id: "intro", type: "text" },
				{
					id: "correct-heading",
					type: "heading",
					data: { level: 3, name: "correctFollowUp", hide: true },
				},
				{ id: "correct-body", type: "text" },
				{
					id: "next-heading",
					type: "heading",
					data: { level: 3, name: "incorrectFollowUp", hide: true },
				},
				{ id: "next-body", type: "text" },
			]);

			engine.registerLogicBlock({
				blockId: "logic-show-section",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:reveal", comparison: "is", value: true }],
				},
				actions: [{ type: "show", target: "correctFollowUp" }],
			});

			engine.evaluate();
			expect(engine.getVisibleBlockIds()).toEqual(new Set(["intro"]));

			store.set("reveal", true);
			engine.evaluate();
			expect(engine.getVisibleBlockIds()).toEqual(
				new Set(["intro", "correct-heading", "correct-body"]),
			);
		});

		it("keeps nested heading sections inside their sibling scope", () => {
			const store = createTestVariableStore({ reveal: false });
			const engine = new LogicEngine(store, [
				{ id: "container", type: "accordion", logicScope: "root" },
				{
					id: "nested-heading",
					type: "heading",
					visible: false,
					logicScope: "root/1",
					data: { level: 2 },
				},
				{ id: "nested-body", type: "text", logicScope: "root/1" },
				{ id: "other-item", type: "text", logicScope: "root/2" },
				{ id: "outer-body", type: "text", logicScope: "root" },
			]);
			engine.registerLogicBlock({
				blockId: "show-nested",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:reveal", comparison: "is", value: true }],
				},
				actions: [{ type: "show", target: "nested-heading" }],
			});

			engine.evaluate();
			expect(engine.getVisibleBlockIds()).toEqual(
				new Set(["container", "other-item", "outer-body"]),
			);
			store.set("reveal", true);
			engine.evaluate();
			expect(engine.getVisibleBlockIds()).toEqual(
				new Set(["container", "nested-heading", "nested-body", "other-item", "outer-body"]),
			);
		});

		it("retains an outer hidden heading range while visiting nested scopes", () => {
			const engine = new LogicEngine(createTestVariableStore(), [
				{
					id: "outer-heading",
					type: "heading",
					visible: false,
					logicScope: "root",
					data: { level: 2 },
				},
				{ id: "container", type: "accordion", logicScope: "root" },
				{ id: "nested-body", type: "text", logicScope: "root/1" },
				{ id: "outer-body", type: "text", logicScope: "root" },
				{ id: "next-heading", type: "heading", logicScope: "root", data: { level: 2 } },
			]);

			engine.evaluate();
			expect(engine.getVisibleBlockIds()).toEqual(new Set(["nested-body", "next-heading"]));
		});

		it("hide action removes target from visible block set", () => {
			const store = createTestVariableStore({ shouldHide: true });
			const engine = new LogicEngine(store, [{ id: "block-hide", type: "text" }]);

			engine.registerLogicBlock({
				blockId: "logic-hide",
				conditions: {
					operator: "and",
					rules: [
						{
							source: "variable:shouldHide",
							comparison: "is",
							value: true,
						},
					],
				},
				actions: [{ type: "hide", target: "block-hide" }],
			});

			engine.evaluate();
			expect(engine.getVisibleBlockIds().has("block-hide")).toBe(false);
		});
	});

	describe("comparison operators", () => {
		function testComparison(
			comparison: string,
			storeValue: string | number | boolean | string[],
			ruleValue: string | number | boolean | string[],
			expectedMatch: boolean,
		) {
			const store = createTestVariableStore({ testVar: storeValue });
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-cmp",
				conditions: {
					operator: "and",
					rules: [
						{
							source: "variable:testVar",
							comparison,
							value: ruleValue,
						},
					],
				},
				actions: [{ type: "jumpToPage", target: "matched" }],
			});

			engine.evaluate();
			if (expectedMatch) {
				expect(engine.getJumpTarget()).toBe("matched");
			} else {
				expect(engine.getJumpTarget()).toBeNull();
			}
		}

		it("is — matches equal values", () => {
			testComparison("is", 42, 42, true);
		});

		it("is — fails on different values", () => {
			testComparison("is", 42, 99, false);
		});

		it("isNot — matches different values", () => {
			testComparison("isNot", "a", "b", true);
		});

		it("isNot — fails on equal values", () => {
			testComparison("isNot", "a", "a", false);
		});

		it("gt — greater than", () => {
			testComparison("gt", 10, 5, true);
			testComparison("gt", 5, 10, false);
		});

		it("lt — less than", () => {
			testComparison("lt", 3, 7, true);
			testComparison("lt", 7, 3, false);
		});

		it("gte — greater than or equal", () => {
			testComparison("gte", 10, 10, true);
			testComparison("gte", 9, 10, false);
		});

		it("lte — less than or equal", () => {
			testComparison("lte", 10, 10, true);
			testComparison("lte", 11, 10, false);
		});

		it("contains — substring match", () => {
			testComparison("contains", "hello world", "world", true);
			testComparison("contains", "hello", "xyz", false);
		});

		it("isEmpty — true for empty/undefined", () => {
			testComparison("isEmpty", "", "", true);
		});

		it("isNotEmpty — true for non-empty values", () => {
			testComparison("isNotEmpty", "text", "", true);
			testComparison("isNotEmpty", 42, "", true);
		});

		it("doesNotContain — true when substring absent", () => {
			testComparison("doesNotContain", "hello world", "foo", true);
			testComparison("doesNotContain", "hello world", "world", false);
		});

		it("startsWith — matches beginning of string", () => {
			testComparison("startsWith", "hello", "hel", true);
			testComparison("startsWith", "hello", "xyz", false);
		});

		it("doesNotStartWith — rejects matching prefix", () => {
			testComparison("doesNotStartWith", "hello", "hel", false);
			testComparison("doesNotStartWith", "hello", "xyz", true);
		});

		it("endsWith — matches end of string", () => {
			testComparison("endsWith", "hello", "llo", true);
			testComparison("endsWith", "hello", "xyz", false);
		});

		it("doesNotEndWith — rejects matching suffix", () => {
			testComparison("doesNotEndWith", "hello", "llo", false);
			testComparison("doesNotEndWith", "hello", "xyz", true);
		});

		it("isAnyOf — matches when value is in array", () => {
			testComparison("isAnyOf", "b", ["a", "b", "c"], true);
			testComparison("isAnyOf", "z", ["a", "b", "c"], false);
		});

		it("isNotAnyOf — rejects when value is in array", () => {
			testComparison("isNotAnyOf", "b", ["a", "b", "c"], false);
			testComparison("isNotAnyOf", "z", ["a", "b", "c"], true);
		});

		it("isEveryOf — matches when all array values match", () => {
			testComparison("isEveryOf", ["a", "b"], ["a", "b"], true);
			testComparison("isEveryOf", ["a"], ["a", "b"], false);
		});
	});

	describe("empty rules", () => {
		it("empty rules array returns false (no match)", () => {
			const store = createTestVariableStore();
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-empty",
				conditions: { operator: "and", rules: [] },
				actions: [{ type: "jumpToPage", target: "should-not-jump" }],
			});

			engine.evaluate();
			expect(engine.getJumpTarget()).toBeNull();
		});
	});

	describe("require action", () => {
		it("sets data-required attribute on target blocks", () => {
			const mockEl = new MockHTMLElement();
			mockElements.set("block-req", mockEl);

			const store = createTestVariableStore({ flag: true });
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-req",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:flag", comparison: "is", value: true }],
				},
				actions: [{ type: "require", targets: ["block-req"] }],
			});

			engine.evaluate();
			expect(mockEl.attributes["data-required"]).toBe("true");
		});

		it("fires require when variable gt numeric threshold", () => {
			const mockEl = new MockHTMLElement();
			mockElements.set("assessment-1", mockEl);

			const store = createTestVariableStore({ myVar: 2 });
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-gt",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:myVar", comparison: "gt", value: "1" }],
				},
				actions: [{ type: "require", targets: ["assessment-1"] }],
			});

			engine.evaluate();
			expect(mockEl.attributes["data-required"]).toBe("true");
			expect(mockEl.children.length).toBe(1);
			expect(mockEl.children[0].className).toBe("praxity-required-indicator");
		});

		it("restores author state when the condition stops matching", () => {
			const mockEl = new MockHTMLElement();
			mockEl.setAttribute("data-required", "false");
			mockEl.setAttribute("data-required-min", "2");
			mockEl.style.position = "absolute";
			mockElements.set("block-req", mockEl);

			const store = createTestVariableStore({ flag: true });
			const engine = new LogicEngine(store, []);
			engine.registerLogicBlock({
				blockId: "logic-req",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:flag", comparison: "is", value: true }],
				},
				actions: [{ type: "require", target: "block-req", value: 4 }],
			});

			engine.evaluate();
			expect(mockEl.getAttribute("data-required-min")).toBe("4");
			expect(mockEl.children).toHaveLength(1);

			store.set("flag", false);
			engine.evaluate();
			expect(mockEl.getAttribute("data-required")).toBe("false");
			expect(mockEl.getAttribute("data-required-min")).toBe("2");
			expect(mockEl.style.position).toBe("absolute");
			expect(mockEl.children).toHaveLength(0);
		});

		it("restores active effects when the engine is destroyed", () => {
			const mockEl = new MockHTMLElement();
			mockElements.set("block-req", mockEl);
			const engine = new LogicEngine(createTestVariableStore({ flag: true }), []);
			engine.registerLogicBlock({
				blockId: "logic-req",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:flag", comparison: "is", value: true }],
				},
				actions: [{ type: "require", target: "block-req" }],
			});

			engine.evaluate();
			engine.destroy();

			expect(mockEl.getAttribute("data-required")).toBeNull();
			expect(mockEl.children).toHaveLength(0);
		});
	});

	describe("disableCompletion action", () => {
		it("exposes the gate and authored reasons without requiring a control", () => {
			const store = createTestVariableStore({ blocked: true });
			const engine = new LogicEngine(store, []);
			engine.registerLogicBlock({
				blockId: "gate",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:blocked", comparison: "is", value: true }],
				},
				actions: [{ type: "disableCompletion", reason: "Complete the safety check." }],
			});
			engine.evaluate();
			expect(engine.isCompletionBlocked()).toBe(true);
			expect(engine.getCompletionReasons()).toEqual(["Complete the safety check."]);
			store.set("blocked", false);
			engine.evaluate();
			expect(engine.isCompletionBlocked()).toBe(false);
			expect(engine.getCompletionReasons()).toEqual([]);
		});

		it("retains legacy gates and collects distinct active reasons in authored order", () => {
			const engine = new LogicEngine(createTestVariableStore({ blocked: true }), []);
			engine.registerLogicBlock({
				blockId: "gate",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:blocked", comparison: "is", value: true }],
				},
				actions: [
					{ type: "disableCompletion" },
					{ type: "disableCompletion", reason: "Check one." },
					{ type: "disableCompletion", reason: "Check one." },
					{ type: "disableCompletion", reason: "Check two." },
				],
			});
			engine.evaluate();
			expect(engine.isCompletionBlocked()).toBe(true);
			const reasons = engine.getCompletionReasons();
			expect(reasons).toEqual(["Check one.", "Check two."]);
			reasons.push("Unowned");
			expect(engine.getCompletionReasons()).toEqual(["Check one.", "Check two."]);
			engine.destroy();
			expect(engine.isCompletionBlocked()).toBe(false);
		});
	});

	describe("multi-target show/hide", () => {
		it("shows multiple blocks at once", () => {
			const store = createTestVariableStore({ showAll: true });
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-multi",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:showAll", comparison: "is", value: true }],
				},
				actions: [{ type: "show", targets: ["block-a", "block-b"] }],
			});

			engine.evaluate();
			expect(engine.getVisibleBlockIds().has("block-a")).toBe(true);
			expect(engine.getVisibleBlockIds().has("block-b")).toBe(true);
		});

		it("hides multiple blocks at once", () => {
			const store = createTestVariableStore({ hideAll: true });
			const engine = new LogicEngine(store, [
				{ id: "block-c", type: "text" },
				{ id: "block-d", type: "text" },
			]);

			engine.registerLogicBlock({
				blockId: "logic-multi-hide",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:hideAll", comparison: "is", value: true }],
				},
				actions: [{ type: "hide", targets: ["block-c", "block-d"] }],
			});

			engine.evaluate();
			expect(engine.getVisibleBlockIds().has("block-c")).toBe(false);
			expect(engine.getVisibleBlockIds().has("block-d")).toBe(false);
		});
	});

	describe("source types", () => {
		it("variable source reads from VariableStore", () => {
			const store = createTestVariableStore({ myVar: "hello" });
			const engine = new LogicEngine(store, []);

			engine.registerLogicBlock({
				blockId: "logic-var",
				conditions: {
					operator: "and",
					rules: [
						{
							source: "variable:myVar",
							comparison: "is",
							value: "hello",
						},
					],
				},
				actions: [{ type: "jumpToPage", target: "found" }],
			});

			engine.evaluate();
			expect(engine.getJumpTarget()).toBe("found");
		});

		it("block source reads computed fields from DOM", () => {
			// Set up a mock element with rating data
			const ratingEl = {
				getAttribute: (name: string) => {
					if (name === "data-rating-value") return "4";
					return null;
				},
				querySelectorAll: () => [],
			};
			mockElements.set("rating-block-1", ratingEl);

			const store = createTestVariableStore();
			const engine = new LogicEngine(store, [
				{
					id: "rating-block-1",
					type: "rating",
				},
			]);

			engine.registerLogicBlock({
				blockId: "logic-rating",
				conditions: {
					operator: "and",
					rules: [
						{
							source: "block:rating-block-1",
							field: "value",
							comparison: "gte",
							value: 3,
						},
					],
				},
				actions: [{ type: "jumpToPage", target: "high-rating" }],
			});

			engine.evaluate();
			expect(engine.getJumpTarget()).toBe("high-rating");
		});
	});
});
