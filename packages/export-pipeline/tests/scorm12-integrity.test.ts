import { crc32, inflateSync } from "node:zlib";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import {
	parseScorm12SuspendData,
	serializeScorm12SuspendData,
} from "../src/scorm/scorm12-suspend-data";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";

const saved = {
	version: 1,
	kind: "assessment",
	assessmentType: "choice",
	attemptCount: 1,
	checked: true,
	correct: true,
	completed: true,
	interacted: true,
	answer: ["stop"],
	reviewedChoiceIds: ["stop"],
};
const state = {
	visitedPages: ["page-a"],
	interactions: [
		{ id: "q", response: "Stop", correct: true, score: 100, timestamp: 1800000000000 },
	],
	custom: JSON.stringify({ blockState: { q: saved }, padding: "repeat".repeat(1000) }),
};
function damaged(byte: number, bit: number) {
	const env = JSON.parse(serializeScorm12SuspendData(state));
	const compressed = Buffer.from(env.data, "base64");
	compressed[byte] ^= 1 << bit;
	return { compressed, wire: JSON.stringify({ ...env, data: compressed.toString("base64") }) };
}
afterEach(() => vi.unstubAllGlobals());
it("rejects a saved stream whose answer key was damaged by one bit", () => {
	const corrupt = damaged(204, 6);
	expect(() => inflateSync(corrupt.compressed)).toThrow(/incorrect data check/);
	expect(parseScorm12SuspendData(corrupt.wire)).toBeNull();
});
it.each([
	["compressed stream", () => damaged(0, 0).wire],
	[
		"Base64 padding",
		() => {
			const wire = serializeScorm12SuspendData(paddedAttempt());
			return `${wire.slice(0, 3866)}7${wire.slice(3867)}`;
		},
	],
] as const)(
	"preserves rejected %s bytes rather than overwriting them with an empty attempt",
	(_, corruptData) => {
		const corrupt = corruptData();
		const values: Record<string, string> = { "cmi.suspend_data": corrupt };
		const dom = new JSDOM("");
		Object.assign(dom.window, {
			API: {
				LMSInitialize: () => "true",
				LMSFinish: () => "true",
				LMSGetValue: (k: string) => values[k] ?? "",
				LMSSetValue: (k: string, v: string) => {
					values[k] = v;
					return "true";
				},
				LMSCommit: () => "true",
				LMSGetLastError: () => "0",
			},
		});
		vi.stubGlobal("window", dom.window);
		try {
			expect(parseScorm12SuspendData(corrupt)).toBeNull();
			const runtime = new Scorm12Runtime();
			runtime.initialize();
			runtime.trackPageVisit("page-a");
			expect(values["cmi.suspend_data"]).toBe(corrupt);
			expect(runtime.getVisitedPages()).toEqual([]);
			expect(runtime.getInteractions()).toEqual([]);
			expect(runtime.getSuspendData()).toBeNull();
			expect(runtime.setSuspendData('{"blockState":{"q":{"answer":["go"]}}}')).toBe(false);
			expect(runtime.stageSubmission("q", () => true)).toBe(false);
			expect(() =>
				runtime.trackInteraction("q", "Go", true, 100, { assessmentType: "choice" }),
			).toThrow("ESCORM12STORAGE");
			expect(runtime.getBlockSaveResult("q")).toEqual({
				status: "not-saved",
				code: "unreadable-state",
			});
			expect(values["cmi.suspend_data"]).toBe(corrupt);
			expect(values["cmi.interactions.0.id"]).toBeUndefined();
		} finally {
			dom.window.close();
		}
	},
);
it("refuses an LMS write at exactly 4096 without losing prior draft or row and retries", () => {
	const values: Record<string, string> = {};
	const dom = new JSDOM("");
	let refuse = true;
	const attempts: number[] = [];
	Object.assign(dom.window, {
		API: {
			LMSInitialize: () => "true",
			LMSFinish: () => "true",
			LMSGetValue: (k: string) => values[k] ?? "",
			LMSSetValue: (k: string, v: string) => {
				if (k === "cmi.suspend_data") {
					attempts.push(v.length);
					expect(v.length).toBeLessThanOrEqual(4096);
					if (refuse && v.length === 4096) return "false";
				}
				values[k] = v;
				return "true";
			},
			LMSCommit: () => "true",
			LMSGetLastError: () => "0",
		},
	});
	vi.stubGlobal("window", dom.window);
	vi.spyOn(Date, "now").mockReturnValue(1800000000000);
	try {
		const runtime = new Scorm12Runtime();
		runtime.initialize();
		const provider = createBlockStateRuntime(runtime);
		const draft = {
			...saved,
			checked: false,
			correct: false,
			completed: false,
			attemptCount: 0,
			reviewedChoiceIds: [],
		};
		const candidate = {
			visitedPages: [],
			interactions: [
				{ id: "q", response: "Stop", correct: true, score: 100, timestamp: 1800000000000 },
			],
			custom: JSON.stringify({ blockState: { q: saved }, padding: "" }),
		};
		const padding = "x".repeat(4096 - JSON.stringify(candidate).length);
		runtime.setSuspendData(JSON.stringify({ blockState: { q: draft }, padding }));
		const before = values["cmi.suspend_data"];
		provider.stageSubmission?.("q", () => {
			provider.set("q", saved);
			return true;
		});
		expect(() =>
			runtime.trackInteraction("q", "Stop", true, 100, { assessmentType: "choice" }),
		).toThrow("ESCORM12STORAGE");
		expect(attempts.at(-1)).toBe(4096);
		expect(values["cmi.suspend_data"]).toBe(before);
		const reload = new Scorm12Runtime();
		reload.initialize();
		expect(createBlockStateRuntime(reload).get("q")).toEqual(draft);
		expect(reload.getInteractions()).toEqual([]);
		refuse = false;
		provider.stageSubmission?.("q", () => {
			provider.set("q", saved);
			return true;
		});
		runtime.trackInteraction("q", "Stop", true, 100, { assessmentType: "choice" });
		expect(values["cmi.suspend_data"].length).toBe(4096);
		expect(createBlockStateRuntime(reload).get("q")).toEqual(saved);
		expect(reload.getInteractions()).toHaveLength(1);
	} finally {
		vi.restoreAllMocks();
		dom.window.close();
	}
});

function seededAttempt() {
	let seed = 12345;
	const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	const hex = (n: number) =>
		Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");
	const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
	const ids = Array.from({ length: 30 }, uuid);
	const answers = ids.map(uuid);
	return {
		visitedPages: Array.from({ length: 30 }, uuid),
		interactions: ids.map((id) => ({
			id,
			response: "Option 0",
			correct: true,
			score: 100,
			timestamp: 1800000000000,
			attemptsUsed: 1,
			maxAttempts: 2,
		})),
		custom: JSON.stringify({
			blockState: Object.fromEntries(
				ids.map((id, i) => [
					id,
					{ ...saved, answer: [answers[i]], reviewedChoiceIds: [answers[i]] },
				]),
			),
		}),
	};
}
it("rejects the seeded one-bit collision that changes question 22 despite a valid Adler-32", () => {
	const data = seededAttempt();
	const envelope = JSON.parse(serializeScorm12SuspendData(data));
	const compressed = Buffer.from(envelope.data, "base64");
	compressed[1418] ^= 1 << 1;
	const decoded = JSON.parse(inflateSync(compressed).toString());
	expect(decoded.interactions[22].id).not.toBe(data.interactions[22].id);
	expect(
		parseScorm12SuspendData(JSON.stringify({ ...envelope, data: compressed.toString("base64") })),
	).toBeNull();
	expect(
		parseScorm12SuspendData(
			JSON.stringify({
				...envelope,
				compressedCrc32: crc32(compressed),
				data: compressed.toString("base64"),
			}),
		),
	).toBeNull();
});
it("rejects every single-bit flip of a representative 30-question compressed stream", () => {
	const data = seededAttempt();
	const envelope = JSON.parse(serializeScorm12SuspendData(data));
	const compressed = Buffer.from(envelope.data, "base64");
	expect(parseScorm12SuspendData(JSON.stringify(envelope))).toEqual(data);
	const accepted = [];
	for (let byte = 0; byte < compressed.length; byte++)
		for (let bit = 0; bit < 8; bit++) {
			const damaged = Buffer.from(compressed);
			damaged[byte] ^= 1 << bit;
			if (
				parseScorm12SuspendData(JSON.stringify({ ...envelope, data: damaged.toString("base64") }))
			)
				accepted.push({ byte, bit });
		}
	expect(accepted).toEqual([]);
});

function paddedAttempt() {
	const data = seededAttempt();
	data.custom = JSON.stringify({ ...JSON.parse(data.custom), padding: "" });
	return data;
}

it("rejects the stored Base64 padding bit at character 3866, bit 6", () => {
	const wire = serializeScorm12SuspendData(paddedAttempt());
	expect(wire.length).toBe(3871);
	expect(wire[3866]).toBe("w");
	const damaged = `${wire.slice(0, 3866)}7${wire.slice(3867)}`;
	expect(wire.charCodeAt(3866) ^ damaged.charCodeAt(3866)).toBe(64);
	expect(Buffer.from(JSON.parse(damaged).data, "base64")).toEqual(
		Buffer.from(JSON.parse(wire).data, "base64"),
	);
	expect(parseScorm12SuspendData(damaged)).toBeNull();
});

it("rejects every single-bit flip of the whole stored envelope, including Base64 padding", () => {
	const data = paddedAttempt();
	const wire = serializeScorm12SuspendData(data);
	expect(parseScorm12SuspendData(wire)).toEqual(data);
	const accepted = [];
	for (let character = 0; character < wire.length; character++)
		for (let bit = 0; bit < 8; bit++) {
			const damaged =
				wire.slice(0, character) +
				String.fromCharCode(wire.charCodeAt(character) ^ (1 << bit)) +
				wire.slice(character + 1);
			if (parseScorm12SuspendData(damaged)) accepted.push({ character, bit });
		}
	expect(accepted).toEqual([]);
});
