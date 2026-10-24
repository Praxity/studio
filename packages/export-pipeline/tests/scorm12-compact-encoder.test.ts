import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import * as codec from "../src/scorm/scorm12-suspend-data";

const encode = codec.serializeScorm12CompactSuspendData;
const read = codec.parseScorm12CompactSuspendData;
const preflight = codec.preflightScorm12SuspendData;

function roundtrip(custom: string): void {
	const data = { visitedPages: ["page", "p".repeat(4096)], interactions: [], custom };
	let wire = "";
	expect(() => {
		wire = encode(data);
	}).not.toThrow();
	expect(JSON.parse(wire)[0]).toBe("praxity-evidence-1");
	expect(wire.length).toBeLessThanOrEqual(4096);
	expect(JSON.stringify(read(wire))).toBe(JSON.stringify(data));
}

it.each([4095, 4096, 4097])("uses raw JSON through 4096 characters, raw size %i", (size) => {
	const data = { visitedPages: [], interactions: [], custom: "" };
	data.custom = "x".repeat(size - JSON.stringify(data).length);
	const raw = JSON.stringify(data);
	const wire = encode(data);
	if (size <= 4096) expect(wire).toBe(raw);
	else expect(JSON.parse(wire)[0]).toBe("praxity-evidence-1");
	expect(wire.length).toBeLessThanOrEqual(4096);
	expect(codec.scorm12CompactSuspendDataCodec.parse(wire)).toEqual(data);
});

it.each([undefined, "\ud800", ' { "answer": "opaque", "answer": "last" } '])(
	"preserves fitting raw payloads with custom text %j",
	(custom) => {
		const data = { visitedPages: ["page"], interactions: [], custom };
		const wire = encode(data);
		expect(wire).toBe(JSON.stringify(data));
		expect(codec.scorm12CompactSuspendDataCodec.parse(wire)).toEqual(data);
	},
);

it.each(Array.from({ length: 16 }, (_, index) => index))(
	"preserves every single UTF-16 code unit in keys and values, partition %i",
	(partition) => {
		for (let start = partition * 4096; start < (partition + 1) * 4096; start += 64) {
			const units = Array.from({ length: 64 }, (_, index) => String.fromCharCode(start + index));
			roundtrip(JSON.stringify(Object.fromEntries(units.map((unit) => [unit, unit]))));
		}
	},
);

it.each([
	"\ud800",
	"\udc00",
	"ordinary 😀",
	"a\ud800😀\udc00z",
	"\ufeffBOM",
	' { "answer": "opaque", "answer": "last" } ',
	'{"1":"first","0":"second"}',
	"learner text contains s96:AAAAAAAAAAAAAAAA and no evidence",
])("preserves pairs, mixed strings and opaque custom text %j", (custom) => roundtrip(custom));

it("preserves dictionary tokens, shapes, row order and optional fields", () => {
	const data = {
		visitedPages: ["00000000-0000-4000-8000-000000000001", "p".repeat(4096)],
		interactions: [
			{ id: "q", response: "\ud800", correct: false, score: 0, timestamp: 1 },
			{ id: "q", response: "😀", timestamp: 2 },
		],
		custom: JSON.stringify({
			full: `sha256:${"ab".repeat(32)}`,
			short: "s96:AAAAAAAAAAAAAAAA",
			selection: [
				null,
				true,
				false,
				-1,
				Number.MIN_SAFE_INTEGER,
				-2.5,
				Number.MAX_SAFE_INTEGER,
				1e100,
			],
			"\udc00": "\ud800",
			["__proto__"]: { answer: "kept" },
		}),
	};
	let wire = "";
	expect(() => {
		wire = encode(data);
	}).not.toThrow();
	expect(JSON.parse(wire)[3]).toEqual([1, 1, 1]);
	expect(JSON.stringify(read(wire))).toBe(JSON.stringify(data));
});

it("refuses an over-cap compact wire", () => {
	const noise = Array.from({ length: 300 }, (_, n) =>
		createHash("sha256").update(String(n)).digest("hex"),
	).join("");
	expect(() => encode({ visitedPages: [], interactions: [], custom: noise })).toThrow(
		/ESCORM12STORAGE/,
	);
});

it("refuses data beyond the reader's decoded and typed bounds", () => {
	expect(() => encode({ visitedPages: [], interactions: [], custom: "a".repeat(262145) })).toThrow(
		/exceeds the decoded limit/,
	);
	const data = {
		visitedPages: [],
		interactions: [],
		custom: JSON.stringify(Array(30000).fill(0.5)),
	};
	expect(() => encode(data)).toThrow(/exceeds the typed limit/);
});

it("refuses excessive nesting", () => {
	roundtrip(`${"[".repeat(63)}0${"]".repeat(63)}`);
	const custom = `${"[".repeat(64)}0${"]".repeat(64)}`;
	expect(() => encode({ visitedPages: ["p".repeat(4096)], interactions: [], custom })).toThrow(
		/ESCORM12STORAGE: Evidence depth/,
	);
});

it.each(["raw", "compact"])("preflight refuses a changed or unreadable %s payload", (form) => {
	const data = {
		visitedPages: [],
		interactions: [],
		custom: form === "raw" ? "x" : "x".repeat(4096),
	};
	const wire = encode(data);
	expect(preflight(data, wire, codec.scorm12CompactSuspendDataCodec.parse)).toBe(wire);
	expect(() =>
		preflight({ ...data, custom: "changed" }, wire, codec.scorm12CompactSuspendDataCodec.parse),
	).toThrow(/does not preserve the payload/);
	expect(() => preflight(data, wire, () => null)).toThrow(/does not preserve the payload/);
});

it("preflight independently bounds a readable ordinary candidate", () => {
	const data = { visitedPages: [], interactions: [], custom: "x".repeat(4096) };
	expect(codec.parseScorm12SuspendData(JSON.stringify(data))).toEqual(data);
	expect(() => preflight(data, JSON.stringify(data), codec.parseScorm12SuspendData)).toThrow(
		/exceeds the character limit/,
	);
});
