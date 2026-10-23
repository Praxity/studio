import { afterEach, describe, expect, it, vi } from "vitest";
import { VariableStore } from "./variable-store";

function createMockRuntime() {
	let data: string | null = null;
	return {
		getSuspendData: () => data,
		setSuspendData: (d: string) => {
			data = d;
		},
		commit: vi.fn(),
	};
}

describe("VariableStore", () => {
	it("hydrates LMS inputs before saved variables without writing learner state", () => {
		const set = vi.fn();
		const store = new VariableStore(
			[
				{ name: "count", dataType: "number", source: "lms", lmsField: "count", lmsFallback: 1 },
				{ name: "level", dataType: "number", source: "lms", lmsField: "level", lmsFallback: 2 },
				{
					name: "missing",
					dataType: "boolean",
					source: "lms",
					lmsField: "missing",
					lmsFallback: true,
				},
			],
			{
				getSuspendData: () => '{"v":{"count":7}}',
				getValue: (key) => (key === "count" ? "6" : key === "level" ? "4" : null),
				setSuspendData: set,
				commit: vi.fn(),
			},
		);
		expect(store.get("count")).toBe(7);
		expect(store.get("level")).toBe(4);
		expect(store.get("missing")).toBe(true);
		expect(set).not.toHaveBeenCalled();
	});
	it("initializes from definitions with type-appropriate defaults", () => {
		const runtime = createMockRuntime();
		const store = new VariableStore(
			[
				{ name: "count", dataType: "number" },
				{ name: "flag", dataType: "boolean" },
				{ name: "label", dataType: "text" },
			],
			runtime,
		);

		expect(store.get("count")).toBe(0);
		expect(store.get("flag")).toBe(false);
		expect(store.get("label")).toBe("");
	});

	it("uses provided defaultValue when given", () => {
		const runtime = createMockRuntime();
		const store = new VariableStore(
			[
				{ name: "count", dataType: "number", defaultValue: 42 },
				{ name: "flag", dataType: "boolean", defaultValue: true },
				{ name: "label", dataType: "text", defaultValue: "hello" },
			],
			runtime,
		);

		expect(store.get("count")).toBe(42);
		expect(store.get("flag")).toBe(true);
		expect(store.get("label")).toBe("hello");
	});

	it("get() returns stored value", () => {
		const runtime = createMockRuntime();
		const store = new VariableStore(
			[{ name: "score", dataType: "number", defaultValue: 10 }],
			runtime,
		);

		expect(store.get("score")).toBe(10);
		expect(store.get("nonexistent")).toBeUndefined();
	});

	it("set() updates value and persists to suspend_data", () => {
		const runtime = createMockRuntime();
		const store = new VariableStore([{ name: "score", dataType: "number" }], runtime);

		store.set("score", 99);

		expect(store.get("score")).toBe(99);
		expect(runtime.commit).toHaveBeenCalled();

		const persisted = JSON.parse(runtime.getSuspendData() ?? "{}");
		expect(persisted.v.score).toBe(99);
	});

	it("restores saved values from existing suspend_data on construction", () => {
		const runtime = createMockRuntime();
		runtime.setSuspendData(JSON.stringify({ variables: { score: 75, name: "Alice" } }));

		const store = new VariableStore(
			[
				{ name: "score", dataType: "number" },
				{ name: "name", dataType: "text" },
			],
			runtime,
		);

		expect(store.get("score")).toBe(75);
		expect(store.get("name")).toBe("Alice");
	});

	it("only restores values for known variable names (ignores stale keys)", () => {
		const runtime = createMockRuntime();
		runtime.setSuspendData(
			JSON.stringify({
				variables: { score: 75, obsoleteVar: "stale" },
			}),
		);

		const store = new VariableStore([{ name: "score", dataType: "number" }], runtime);

		expect(store.get("score")).toBe(75);
		expect(store.get("obsoleteVar")).toBeUndefined();
	});

	it("handles corrupt suspend_data gracefully (doesn't throw)", () => {
		const runtime = createMockRuntime();
		runtime.setSuspendData("not valid json{{{");

		expect(() => {
			const store = new VariableStore([{ name: "x", dataType: "number" }], runtime);
			expect(store.get("x")).toBe(0);
		}).not.toThrow();
	});

	it("merges with existing suspend_data (doesn't overwrite other keys)", () => {
		const runtime = createMockRuntime();
		runtime.setSuspendData(JSON.stringify({ otherKey: "preserve me", variables: {} }));

		const store = new VariableStore([{ name: "score", dataType: "number" }], runtime);
		store.set("score", 50);

		const persisted = JSON.parse(runtime.getSuspendData() ?? "{}");
		expect(persisted.otherKey).toBe("preserve me");
		expect(persisted.v.score).toBe(50);
		expect(persisted.variables).toBeUndefined();
	});

	it("omits default-valued variables from persisted payload", () => {
		const runtime = createMockRuntime();
		const store = new VariableStore(
			[{ name: "score", dataType: "number", defaultValue: 0 }],
			runtime,
		);

		store.set("score", 0);

		const persisted = JSON.parse(runtime.getSuspendData() ?? "{}");
		expect(persisted.v).toBeUndefined();
	});
});

describe("URL parameter source", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("initializes from query string when source is url_parameter", () => {
		vi.stubGlobal("window", { location: { search: "?name=Lucy&count=5" } });

		const runtime = createMockRuntime();
		const store = new VariableStore(
			[
				{
					name: "userName",
					dataType: "text",
					source: "url_parameter",
					urlParamName: "name",
				},
				{
					name: "itemCount",
					dataType: "number",
					source: "url_parameter",
					urlParamName: "count",
				},
			],
			runtime,
		);

		expect(store.get("userName")).toBe("Lucy");
		expect(store.get("itemCount")).toBe(5);
	});

	it("uses urlParamFallback when URL param is missing", () => {
		vi.stubGlobal("window", { location: { search: "" } });

		const runtime = createMockRuntime();
		const store = new VariableStore(
			[
				{
					name: "ref",
					dataType: "text",
					source: "url_parameter",
					urlParamName: "ref",
					urlParamFallback: "direct",
				},
			],
			runtime,
		);

		expect(store.get("ref")).toBe("direct");
	});

	it("coerces boolean URL params correctly", () => {
		vi.stubGlobal("window", {
			location: { search: "?debug=true&verbose=1" },
		});

		const runtime = createMockRuntime();
		const store = new VariableStore(
			[
				{
					name: "debug",
					dataType: "boolean",
					source: "url_parameter",
					urlParamName: "debug",
				},
				{
					name: "verbose",
					dataType: "boolean",
					source: "url_parameter",
					urlParamName: "verbose",
				},
			],
			runtime,
		);

		expect(store.get("debug")).toBe(true);
		expect(store.get("verbose")).toBe(true);
	});

	it("suspend_data takes precedence over URL params", () => {
		vi.stubGlobal("window", { location: { search: "?name=URL" } });

		const runtime = createMockRuntime();
		runtime.setSuspendData(JSON.stringify({ variables: { userName: "Saved" } }));

		const store = new VariableStore(
			[
				{
					name: "userName",
					dataType: "text",
					source: "url_parameter",
					urlParamName: "name",
				},
			],
			runtime,
		);

		// suspend_data restores AFTER URL params, so "Saved" wins
		expect(store.get("userName")).toBe("Saved");
	});
});

describe("locked flag", () => {
	it("set() silently rejects writes to locked variables", () => {
		const runtime = createMockRuntime();
		const store = new VariableStore(
			[
				{
					name: "threshold",
					dataType: "number",
					defaultValue: 70,
					locked: true,
				},
			],
			runtime,
		);

		store.set("threshold", 50);
		expect(store.get("threshold")).toBe(70); // unchanged
	});

	it("getDefinition returns locked state", () => {
		const runtime = createMockRuntime();
		const store = new VariableStore(
			[
				{
					name: "threshold",
					dataType: "number",
					locked: true,
				},
			],
			runtime,
		);

		expect(store.getDefinition("threshold")?.locked).toBe(true);
	});

	it("backward compat: source 'author' becomes computed + locked", () => {
		const runtime = createMockRuntime();
		const defs = [
			{
				name: "oldVar",
				dataType: "number" as const,
				source: "author" as unknown as "computed",
				defaultValue: 99,
			},
		];
		const store = new VariableStore(defs, runtime);

		expect(store.getDefinition("oldVar")?.source).toBe("computed");
		expect(store.getDefinition("oldVar")?.locked).toBe(true);
		store.set("oldVar", 0);
		expect(store.get("oldVar")).toBe(99); // can't modify
	});
});
