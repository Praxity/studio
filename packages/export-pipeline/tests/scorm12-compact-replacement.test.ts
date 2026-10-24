import { createHash } from "node:crypto";
import { choiceMaterialSignature } from "@praxity/shared-blocks/choice-state-facts";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import * as codec from "../src/scorm/scorm12-suspend-data";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";

type WireCodec = {
	serialize(data: codec.Scorm12SuspendData): string;
	parse(raw: string): codec.Scorm12SuspendData | null;
};
const compact: WireCodec = codec.scorm12CompactSuspendDataCodec;
const Runtime = Scorm12Runtime as new (courseId?: string, wireCodec?: WireCodec) => Scorm12Runtime;
const choice = {
	version: 1,
	kind: "assessment",
	assessmentType: "choice",
	attemptCount: 1,
	checked: true,
	correct: true,
	completed: true,
	interacted: true,
	answer: ["a"],
};
function lms() {
	const values = new Map<string, string>();
	const writes: string[][] = [];
	const dom = new JSDOM("", { url: "https://course.example/lesson.html" });
	Object.assign(dom.window, {
		API: {
			LMSInitialize: () => "true",
			LMSFinish: () => "true",
			LMSCommit: () => "true",
			LMSGetLastError: () => "0",
			LMSGetErrorString: () => "",
			LMSGetDiagnostic: () => "",
			LMSGetValue: (key: string) => values.get(key) ?? "",
			LMSSetValue: (key: string, value: string) => {
				if (key === "cmi.suspend_data") expect(value.length).toBeLessThanOrEqual(4096);
				writes.push([key, value]);
				values.set(key, value);
				return "true";
			},
		},
	});
	vi.stubGlobal("window", dom.window);
	return { values, writes, dom };
}
afterEach(() => vi.unstubAllGlobals());

it("preflights a compact replacement exactly once at the real adapter boundary", () => {
	const { dom, values } = lms();
	const parse = vi.spyOn(codec.scorm12CompactSuspendDataCodec, "parse");
	try {
		const runtime = new Runtime(undefined, compact);
		runtime.initialize();
		expect(runtime.setSuspendData("x".repeat(4096))).toBe(true);
		expect(values.get("cmi.suspend_data")?.[0]).toBe("[");
		expect(parse).toHaveBeenCalledOnce();
	} finally {
		parse.mockRestore();
		dom.window.close();
	}
});

it("reloads the exact lone-surrogate text draft after a choice and its row", () => {
	const { values, dom } = lms();
	try {
		const runtime = new Runtime(undefined, compact);
		runtime.initialize();
		const provider = createBlockStateRuntime(runtime);
		provider.set("choice", choice);
		runtime.trackInteraction("choice", "a", true, 100, {
			assessmentType: "choice",
			attemptsUsed: 1,
			maxAttempts: 2,
		});
		const text = {
			...choice,
			assessmentType: "textResponse",
			attemptCount: 0,
			checked: false,
			completed: false,
			answer: "\ud800",
		};
		provider.set("text", text);
		expect(provider.getSaveResult?.("text")).toEqual({ status: "saved", destination: "lms" });
		expect(values.get("cmi.suspend_data")).toBe(
			JSON.stringify(compact.parse(values.get("cmi.suspend_data") ?? "")),
		);
		const loaded = new Runtime(undefined, compact);
		loaded.initialize();
		expect(createBlockStateRuntime(loaded).get("text")).toEqual(text);
		expect(createBlockStateRuntime(loaded).get("choice")).toEqual(choice);
		expect(loaded.getInteractions()).toMatchObject([
			{ id: "choice", response: "a", attemptsUsed: 1 },
		]);
	} finally {
		dom.window.close();
	}
});

const replacementCases = ["unreadable", "different-answer", "different-custom", "over-cap"].flatMap(
	(fault) => ["raw", "compact"].map((form) => [fault, form]),
);
it.each(replacementCases)(
	"refuses %s candidates before any replacement or reporting write, %s payload",
	(fault, form) => {
		const { values, writes, dom } = lms();
		try {
			const original = new Runtime(undefined, compact);
			original.initialize();
			if (form === "compact")
				expect(original.setSuspendData(JSON.stringify({ padding: "p".repeat(4096) }))).toBe(true);
			createBlockStateRuntime(original).set("choice", choice);
			original.trackInteraction("choice", "a", true, 100, {
				assessmentType: "choice",
				attemptsUsed: 1,
				maxAttempts: 2,
			});
			const before = values.get("cmi.suspend_data");
			expect(Array.isArray(JSON.parse(before ?? ""))).toBe(form === "compact");
			const bad: WireCodec = {
				...compact,
				serialize: (data) => {
					if (fault === "unreadable") return '["praxity-evidence-1"]';
					if (fault === "over-cap") return " ".repeat(4097);
					const altered = structuredClone(data);
					if (fault === "different-custom") altered.custom += " ";
					else {
						const custom = JSON.parse(altered.custom ?? "");
						custom.blockState.choice.answer = ["wrong"];
						altered.custom = JSON.stringify(custom);
					}
					return compact.serialize(altered);
				},
			};
			const runtime = new Runtime(undefined, bad);
			runtime.initialize();
			const provider = createBlockStateRuntime(runtime);
			const priorRows = runtime.getInteractions();
			writes.length = 0;
			expect(
				provider.stageSubmission?.("choice", () => {
					provider.set("choice", { ...choice, attemptCount: 2 });
					return true;
				}),
			).toBe(true);
			expect(() =>
				runtime.trackInteraction("choice", "b", false, 0, {
					assessmentType: "choice",
					attemptsUsed: 2,
					maxAttempts: 2,
				}),
			).toThrow(/ESCORM12STORAGE/);
			expect(writes).toEqual([]);
			expect(values.get("cmi.suspend_data")).toBe(before);
			expect(provider.get("choice")).toEqual(choice);
			expect(runtime.getInteractions()).toEqual(priorRows);
			expect(provider.getSaveResult?.("choice")?.status).toBe("not-saved");
		} finally {
			dom.window.close();
		}
	},
);

it("checks the privacy-filtered payload and preserves opaque custom text", () => {
	const { values, dom } = lms();
	try {
		const runtime = new Runtime(undefined, compact);
		runtime.initialize();
		runtime.setBlockStatePolicy({ secret: "device" });
		const custom = JSON.stringify({ blockState: { public: choice, secret: choice } });
		expect(runtime.setSuspendData(custom)).toBe(true);
		expect(JSON.parse(runtime.getSuspendData() ?? "").blockState).toEqual({ public: choice });
		expect(runtime.setSuspendData(' { "opaque": "\\ud800" } ')).toBe(true);
		expect(compact.parse(values.get("cmi.suspend_data") ?? "")?.custom).toBe(
			' { "opaque": "\\ud800" } ',
		);
	} finally {
		dom.window.close();
	}
});

it("keeps ordinary output while accepting compact saves from a prior publish", () => {
	const { values, writes, dom } = lms();
	try {
		const runtime = new Scorm12Runtime();
		runtime.initialize();
		expect(runtime.setSuspendData("contains s96:AAAAAAAAAAAAAAAA")).toBe(true);
		expect(values.get("cmi.suspend_data")).toBe(
			'{"visitedPages":[],"interactions":[],"custom":"contains s96:AAAAAAAAAAAAAAAA"}',
		);
		values.set(
			"cmi.suspend_data",
			compact.serialize({ visitedPages: [], interactions: [], custom: "held".repeat(1024) }),
		);
		const loaded = new Scorm12Runtime();
		loaded.initialize();
		writes.length = 0;
		expect(loaded.getSuspendData()).toBe("held".repeat(1024));
		expect(writes).toEqual([]);
		expect(loaded.setSuspendData("replacement")).toBe(true);
		expect(writes).toEqual([
			["cmi.suspend_data", '{"visitedPages":[],"interactions":[],"custom":"replacement"}'],
		]);
	} finally {
		dom.window.close();
	}
});

it("retains at least 42 original UUID answers and rows before an atomic capacity refusal", () => {
	const { values, writes, dom } = lms();
	const uuid = (seed: string) => {
		const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	};
	try {
		const runtime = new Runtime(undefined, compact);
		runtime.initialize();
		const provider = createBlockStateRuntime(runtime);
		const saved = new Map();
		let refused = false;
		for (let index = 0; index < 100; index++) {
			const id = uuid(`question-${index}`);
			const signature = choiceMaterialSignature(`material-${index}`);
			const selected = uuid(`option-${index}-0`);
			const next = {
				...choice,
				answer: [selected],
				reviewedChoiceIds: [selected],
				contentSignature: signature,
				writtenAt: index + 1,
			};
			const before = values.get("cmi.suspend_data");
			writes.length = 0;
			expect(
				provider.stageSubmission?.(id, () => {
					provider.set(id, next);
					return true;
				}),
			).toBe(true);
			try {
				runtime.trackInteraction(id, "action-0", true, 100, {
					assessmentType: "choice",
					contentSignature: signature,
					attemptsUsed: 1,
					maxAttempts: 2,
				});
			} catch (error) {
				expect(String(error)).toContain("ESCORM12STORAGE");
				expect(values.get("cmi.suspend_data")).toBe(before);
				expect(writes).toEqual([]);
				expect(provider.get(id)).toBeUndefined();
				refused = true;
				break;
			}
			saved.set(id, next);
		}
		expect(refused).toBe(true);
		expect(saved.size).toBeGreaterThanOrEqual(42);
		const loaded = new Runtime(undefined, compact);
		loaded.initialize();
		const restored = createBlockStateRuntime(loaded);
		for (const [id, state] of saved) expect(restored.get(id)).toEqual(state);
		expect(loaded.getInteractions()).toHaveLength(saved.size);
	} finally {
		dom.window.close();
	}
});
