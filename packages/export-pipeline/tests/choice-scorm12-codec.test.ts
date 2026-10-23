import { crc32 } from "node:zlib";
import { LEARNER_STATE_MAX_BYTES } from "@praxity/shared-blocks/learner-state";
import { strToU8, zlibSync } from "fflate";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import {
	parseScorm12SuspendData,
	serializeScorm12SuspendData,
} from "../src/scorm/scorm12-suspend-data";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";

// Independent typed-wire fixture: one root shape, two empty arrays, no dictionary.
const data = { visitedPages: [], interactions: [] };
const text = (value: string) => [5, value.length, ...strToU8(value)];
const prefix = [0, 1, 2, ...text("visitedPages"), ...text("interactions")];
const root = [8, 0, 7, 0, 7, 0];
const typed = [...prefix, ...root];
const original = strToU8(JSON.stringify(data));
function envelope(bytes = typed, expected = original): unknown[] {
	const body = zlibSync(Uint8Array.from(bytes));
	return [
		"praxity-evidence-1",
		expected.length,
		bytes.length,
		[0, 0, 0],
		crc32(expected),
		crc32(body),
		Buffer.from(body).toString("base64"),
	];
}
function wire(change: (value: unknown[]) => void): string {
	const value = envelope();
	change(value);
	return JSON.stringify(value);
}
function bodyChange(change: (body: Buffer) => void): string {
	return wire((value) => {
		const body = Buffer.from(value[6] as string, "base64");
		change(body);
		value[5] = crc32(body);
		value[6] = body.toString("base64");
	});
}
const bad: [string, string][] = [
	[
		"format",
		wire((value) => {
			value[0] = "praxity-evidence-unknown";
		}),
	],
	["field count", JSON.stringify([...envelope(), 0])],
	["wire cap", JSON.stringify(envelope()).padEnd(4097, " ")],
	[
		"decoded size",
		wire((value) => {
			value[1] = LEARNER_STATE_MAX_BYTES + 1;
		}),
	],
	[
		"typed size",
		wire((value) => {
			value[2] = LEARNER_STATE_MAX_BYTES + 1;
		}),
	],
	[
		"negative count",
		wire((value) => {
			value[3] = [-1, 0, 0];
		}),
	],
	[
		"fraction count",
		wire((value) => {
			value[3] = [0.5, 0, 0];
		}),
	],
	[
		"dictionary kinds",
		wire((value) => {
			value[3] = [0, 0];
		}),
	],
	[
		"excess count",
		wire((value) => {
			value[3] = [original.length + 1, 0, 0];
		}),
	],
	[
		"dictionary bounds",
		wire((value) => {
			value[3] = [4, 0, 0];
		}),
	],
	[
		"body type",
		wire((value) => {
			value[6] = 1;
		}),
	],
	[
		"base64",
		wire((value) => {
			value[6] = `${value[6]}\n`;
		}),
	],
	[
		"body CRC",
		wire((value) => {
			value[5] = Number(value[5]) ^ 1;
		}),
	],
	[
		"original CRC",
		wire((value) => {
			value[4] = Number(value[4]) ^ 1;
		}),
	],
	[
		"original length",
		wire((value) => {
			value[1] = original.length + 1;
		}),
	],
	[
		"inflated length",
		wire((value) => {
			value[2] = typed.length - 1;
		}),
	],
	[
		"Adler",
		bodyChange((body) => {
			body[body.length - 1] ^= 1;
		}),
	],
	["custom flag", JSON.stringify(envelope([2, ...typed.slice(1)]))],
	["shape count", JSON.stringify(envelope([0, 127]))],
	["key count", JSON.stringify(envelope([0, 1, 127]))],
	["key type", JSON.stringify(envelope([0, 1, 1, 0, ...root]))],
	[
		"duplicate key",
		JSON.stringify(envelope([0, 1, 2, ...text("visitedPages"), ...text("visitedPages"), ...root])),
	],
	["shape reference", JSON.stringify(envelope([...prefix, 8, 1]))],
	["reference", JSON.stringify(envelope([...prefix, 8, 0, 6, 0, 7, 0]))],
	["tag", JSON.stringify(envelope([...prefix, 255]))],
	["trailing byte", JSON.stringify(envelope([...typed, 0]))],
	["integer", JSON.stringify(envelope([...prefix, 3, ...Array(9).fill(128)]))],
	["truncated string", JSON.stringify(envelope([...prefix, 5, 127]))],
	["array count", JSON.stringify(envelope([...prefix, 7, 127]))],
	["nonfinite number", JSON.stringify(envelope([...prefix, 4, 127, 240, 0, 0, 0, 0, 0, 0]))],
	["custom root", JSON.stringify(envelope([1, ...typed.slice(1)]))],
	["depth", JSON.stringify(envelope([...prefix, 8, 0, ...Array(65).fill([7, 1]).flat(), 0, 7, 0]))],
];

it("reads the independent versioned literal and both existing formats", () => {
	expect(parseScorm12SuspendData(JSON.stringify(envelope()))).toEqual(data);
	expect(parseScorm12SuspendData(JSON.stringify(data))).toEqual(data);
	const compressed = zlibSync(original);
	expect(
		parseScorm12SuspendData(
			JSON.stringify({
				encoding: "praxity-zlib-1",
				size: original.length,
				crc32: crc32(original),
				compressedCrc32: crc32(compressed),
				data: Buffer.from(compressed).toString("base64"),
			}),
		),
	).toEqual(data);
});

it("round-trips opaque strings, object keys, numbers and full evidence without changing the logical fields", () => {
	const custom = JSON.stringify({
		blockState: {
			q: {
				kind: "assessment",
				assessmentType: "choice",
				contentSignature: "s96:AAAAAAAAAAAAAAAA",
				full: `sha256:${"f".repeat(64)}`,
				uuid: "01234567-89ab-4cde-8fab-0123456789ab",
				values: [null, true, false, 0, -1, 0.25, "é 😀"],
			},
		},
		["__proto__"]: { safe: true },
	});
	const value = { ...data, custom };
	expect(parseScorm12SuspendData(serializeScorm12SuspendData(value))).toEqual(value);
	const opaque = { ...data, custom: ' {"signature":"s96:AAAAAAAAAAAAAAAA"} ' };
	expect(parseScorm12SuspendData(serializeScorm12SuspendData(opaque))).toEqual(opaque);
});

it("refuses typed numeric expansion that the bounded reader cannot reload", () => {
	const custom = JSON.stringify({
		signature: "s96:AAAAAAAAAAAAAAAA",
		values: Array(30_000).fill(-1),
	});
	const value = { ...data, custom };
	expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(256 * 1024);
	expect(() => serializeScorm12SuspendData(value)).toThrow(
		"ESCORM12STORAGE: evidence exceeds the typed limit",
	);
});

it.each(bad)(
	"refuses %s and the real adapter preserves all prior bytes and outcomes",
	(_name, raw) => {
		expect(parseScorm12SuspendData(raw)).toBeNull();
		const dom = new JSDOM("", { url: "https://course.example/lesson.html" });
		const values = new Map([
			["cmi.suspend_data", raw],
			["cmi.core.lesson_status", "passed"],
		]);
		const writes: string[][] = [];
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
					values.set(key, value);
					writes.push([key, value]);
					return "true";
				},
			},
		});
		vi.stubGlobal("window", dom.window);
		try {
			const runtime = new Scorm12Runtime();
			expect(runtime.initialize()).toBe(true);
			const provider = createBlockStateRuntime(runtime);
			expect(runtime.getInteractions()).toEqual([]);
			provider.set("q", { answer: ["a"] });
			expect(provider.getSaveResult?.("q")).toEqual({
				status: "not-saved",
				code: "unreadable-state",
			});
			runtime.setCompletion("completed");
			runtime.setScore(100, 0, 100);
			runtime.trackObjective("g", 100, true);
			runtime.commit();
			expect(values.get("cmi.suspend_data")).toBe(raw);
			expect(
				writes.filter(([key]) =>
					/^(?:cmi\.suspend_data|cmi\.objectives\.|cmi\.core\.(?:score\.|lesson_status))/.test(key),
				),
			).toEqual([]);
		} finally {
			dom.window.close();
			vi.unstubAllGlobals();
		}
	},
);
