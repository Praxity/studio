import { crc32, deflateSync, inflateSync } from "node:zlib";
import { beforeEach, expect, it } from "vitest";
import * as codec from "../src/scorm/scorm12-suspend-data";
import vectors from "./fixtures/scorm12-compact-vectors";

// Assertion failures, rather than missing exports, identify runtimes without compact admission.
const read =
	(
		codec as Partial<typeof codec> & {
			parseScorm12CompactSuspendData?: typeof codec.parseScorm12SuspendData;
		}
	).parseScorm12CompactSuspendData ?? codec.parseScorm12SuspendData;

beforeEach(() => {
	// Each rejection test first proves it reached a functioning compact reader.
	expect(read(vectors[0].wire)).toEqual(vectors[0].expected);
});

function uint(input: number): number[] {
	const bytes: number[] = [];
	do {
		const next = Math.floor(input / 128);
		bytes.push((input % 128) | (next ? 128 : 0));
		input = next;
	} while (input);
	return bytes;
}

function text(input: string): number[] {
	const bytes = Buffer.from(input);
	return [5, ...uint(bytes.length), ...bytes];
}

function utf16(input: string): number[] {
	const bytes = [9, ...uint(input.length)];
	for (let index = 0; index < input.length; index++) {
		const unit = input.charCodeAt(index);
		bytes.push(unit >>> 8, unit & 255);
	}
	return bytes;
}

const empty = { visitedPages: [], interactions: [] };
const rootKeys = ["visitedPages", "interactions", "custom"];
function typedCustom(value: number[], expanded = 0, keys = rootKeys): number[] {
	return [expanded, 1, keys.length, ...keys.flatMap(text), 8, 0, 7, 0, 7, 0, ...value];
}

/** Construct malformed transport inputs independently of any production encoder. */
function frame(
	typed: number[],
	expected: unknown = empty,
	dictionary = Buffer.alloc(0),
	counts = [0, 0, 0],
): string {
	const raw = Buffer.from(JSON.stringify(expected));
	const body = Buffer.concat([dictionary, deflateSync(Buffer.from(typed))]);
	return JSON.stringify([
		"praxity-evidence-1",
		raw.length,
		typed.length,
		counts,
		crc32(raw),
		crc32(body),
		body.toString("base64"),
	]);
}

function envelopeChange(wire: string, index: number, value: unknown): string {
	const envelope = JSON.parse(wire);
	envelope[index] = value;
	return JSON.stringify(envelope);
}

function bodyChange(wire: string, change: (body: Buffer) => Buffer): string {
	const envelope = JSON.parse(wire);
	const body = change(Buffer.from(envelope[6], "base64"));
	envelope[5] = crc32(body);
	envelope[6] = body.toString("base64");
	return JSON.stringify(envelope);
}

it.each(vectors)("reads the pinned $name vector exactly", ({ wire, expected }) => {
	expect(read(wire)).toEqual(expected);
	expect(JSON.stringify(read(wire))).toBe(JSON.stringify(expected));
});

it("preserves every surrogate code unit, state key, row order and optional field", () => {
	const decoded = read(vectors[0].wire);
	expect(decoded?.interactions.map((row) => row.response)).toEqual(["\ud800", "ordinary 😀"]);
	expect(Object.keys(decoded?.interactions[1] ?? {})).toEqual(["id", "response", "timestamp"]);
	const custom = JSON.parse(decoded?.custom ?? "null");
	expect(custom?.blockState["\ud800"].answer).toEqual([
		"\ud800",
		"\udc00",
		"😀",
		"x\ud800A\udc00😀",
	]);
	expect(custom?.["\udc00"]).toBe("kept");
	expect(Object.getOwnPropertyDescriptor(custom, "__proto__")?.value).toEqual({ polluted: true });
	expect(Object.prototype).not.toHaveProperty("polluted");
});

it.each(["", "plain", "arrêt 日本語 😀", "\ufeffkept"])(
	"preserves the existing UTF-8 tag for %j",
	(value) => {
		expect(read(frame(typedCustom(text(value)), { ...empty, custom: value }))).toEqual({
			...empty,
			custom: value,
		});
	},
);

it.each([
	["unknown format", 0, "unknown"],
	["zero decoded size", 1, 0],
	["negative decoded size", 1, -1],
	["fractional decoded size", 1, 2.5],
	["excess decoded size", 1, 262145],
	["zero typed size", 2, 0],
	["negative typed size", 2, -1],
	["fractional typed size", 2, 2.5],
	["excess typed size", 2, 262145],
	["short count table", 3, [0, 0]],
	["negative count", 3, [-1, 0, 0]],
	["fractional count", 3, [0.5, 0, 0]],
	["excess count", 3, [9007199254740991, 0, 0]],
	["missing body", 6, null],
	["invalid base64", 6, "!"],
])("rejects %s", (_name, index, value) => {
	expect(read(envelopeChange(vectors[0].wire, index as number, value))).toBeNull();
});

it("rejects malformed envelopes and noncanonical base64", () => {
	const envelope = JSON.parse(vectors[0].wire);
	expect(read(JSON.stringify([...envelope, 0]))).toBeNull();
	expect(read(JSON.stringify(envelope.slice(0, 6)))).toBeNull();
	expect(read(envelopeChange(vectors[0].wire, 6, `${envelope[6]}\n`))).toBeNull();
	for (const wire of ["null", "{}", "[", "[]", `${vectors[0].wire}x`])
		expect(read(wire)).toBeNull();
	expect(read(`${vectors[0].wire}${" ".repeat(4097 - vectors[0].wire.length)}`)).toBeNull();
});

it.each([1, 2, 4, 5])("rejects a changed size/checksum at index %i", (index) => {
	const envelope = JSON.parse(vectors[0].wire);
	expect(read(envelopeChange(vectors[0].wire, index, envelope[index] + 1))).toBeNull();
});

it("checks Adler-32 independently of the body CRC", () => {
	expect(
		read(
			bodyChange(vectors[0].wire, (body) => {
				body[body.length - 1] ^= 1;
				return body;
			}),
		),
	).toBeNull();
});

it("rejects truncated bodies and trailing decoded bytes with recomputed transport checks", () => {
	const wire = frame(typedCustom(text("kept")), { ...empty, custom: "kept" });
	expect(read(bodyChange(wire, (body) => body.subarray(0, -1)))).toBeNull();
	const typed = inflateSync(Buffer.from(JSON.parse(wire)[6], "base64"));
	expect(read(frame([...typed, 0], { ...empty, custom: "kept" }))).toBeNull();
});

it("rejects trailing compressed bytes even with matching CRC and Adler checks", () => {
	const wire = frame(typedCustom(text("kept")), { ...empty, custom: "kept" });
	expect(
		read(
			bodyChange(wire, (body) =>
				Buffer.concat([body.subarray(0, -4), Buffer.from([0]), body.subarray(-4)]),
			),
		),
	).toBeNull();
	expect(read(bodyChange(wire, (body) => Buffer.concat([body, body.subarray(-4)])))).toBeNull();
});

it.each([
	["unknown tag", [99]],
	["missing value", []],
	["truncated UTF-8", [5, 3, 65]],
	["invalid UTF-8", [5, 1, 255]],
	["surrogate encoded as UTF-8", [5, 3, 237, 160, 128]],
	["truncated UTF-16", [9, 2, 216, 0]],
	["missing dictionary reference", [6, 0]],
	["missing shape reference", [8, 1]],
	["excess array count", [7, 127]],
	["unterminated integer", [3, 128]],
	["unsafe integer", [3, ...Array(8).fill(255), 127]],
	["nonfinite number", [4, 127, 240, 0, 0, 0, 0, 0, 0]],
])("rejects %s in the typed stream", (_name, value) => {
	expect(read(frame(typedCustom(value as number[])))).toBeNull();
});

it("rejects malformed shape and key counts, duplicate keys and non-string keys", () => {
	for (const typed of [
		[0, 127],
		[0, 1, 127],
		[0, 1, 2, ...text("x"), ...text("x"), 8, 0, 0, 0],
		[0, 1, 1, 0, 8, 0, 0],
	])
		expect(read(frame(typed))).toBeNull();
});

it("checks the custom flag and expanded root", () => {
	expect(read(frame(typedCustom(text("kept"), 2), { ...empty, custom: '"kept"' }))).toBeNull();
	expect(read(frame([1, 0, 0], null))).toBeNull();
	expect(read(frame(typedCustom([], 1, rootKeys.slice(0, 2))))).toBeNull();
	expect(read(frame(typedCustom([0], 1), { ...empty, custom: "null" }))).toEqual({
		...empty,
		custom: "null",
	});
});

it("rejects invalid UTF-8 even when replacement text has matching decoded checks", () => {
	expect(read(frame(typedCustom([5, 1, 255]), { ...empty, custom: "\ufffd" }))).toBeNull();
	expect(
		read(frame(typedCustom([5, 3, 237, 160, 128]), { ...empty, custom: "\ufffd\ufffd\ufffd" })),
	).toBeNull();
});

it("rejects duplicate keys even when last-key-wins output has matching checks", () => {
	const typed = typedCustom([...text("lost"), ...text("kept")], 0, [...rootKeys, "custom"]);
	expect(read(frame(typed, { ...empty, custom: "kept" }))).toBeNull();
});

it("rejects non-string keys even when coerced property names would match decoded checks", () => {
	const typed = [
		0,
		1,
		4,
		...rootKeys.flatMap(text),
		1,
		8,
		0,
		7,
		0,
		7,
		0,
		...text("kept"),
		...text("extra"),
	];
	expect(read(frame(typed, { ...empty, custom: "kept", false: "extra" }))).toBeNull();
});

it("rejects nonfinite numbers even when JSON null has matching decoded checks", () => {
	expect(
		read(
			frame(typedCustom([4, 127, 240, 0, 0, 0, 0, 0, 0], 1), {
				...empty,
				custom: "null",
			}),
		),
	).toBeNull();
});

it("rejects an unknown tag even when interpreting it as null would match decoded checks", () => {
	expect(read(frame(typedCustom([99], 1), { ...empty, custom: "null" }))).toBeNull();
});

it("rejects unsafe and overlong integers even when decoded checks would match", () => {
	expect(
		read(
			frame(typedCustom([3, ...uint(9007199254740992)], 1), {
				...empty,
				custom: "9007199254740992",
			}),
		),
	).toBeNull();
	expect(
		read(frame(typedCustom([3, ...Array(8).fill(128), 0], 1), { ...empty, custom: "0" })),
	).toBeNull();
});

it("rejects the first excessive nesting depth with matching size and checksums", () => {
	let nested: unknown = null;
	for (let depth = 0; depth < 64; depth++) nested = [nested];
	expect(
		read(
			frame(typedCustom([...Array(64).fill([7, 1]).flat(), 0], 1), {
				...empty,
				custom: JSON.stringify(nested),
			}),
		),
	).toBeNull();
});

it("admits the last permitted nested value", () => {
	let nested: unknown = null;
	for (let depth = 0; depth < 63; depth++) nested = [nested];
	const expected = { ...empty, custom: JSON.stringify(nested) };
	expect(read(frame(typedCustom([...Array(63).fill([7, 1]).flat(), 0], 1), expected))).toEqual(
		expected,
	);
});

it("bounds inflated bytes before interpreting the typed stream", () => {
	const wire = frame(typedCustom(text("x".repeat(10000))), { ...empty, custom: "x".repeat(10000) });
	expect(read(envelopeChange(wire, 2, 8))).toBeNull();
});

function unusedShapeWire(count: number): string {
	const typed = [
		0,
		...uint(count + 1),
		2,
		...["visitedPages", "interactions"].flatMap(text),
		...Array(count).fill([1, 6, 0]).flat(),
		8,
		0,
		7,
		0,
		7,
		0,
	];
	return frame(typed, empty, Buffer.alloc(32, 171), [0, 1, 0]);
}

it.each([
	["dictionary-reference", 3700],
	["per-tag", 3660],
])("bounds %s work in unused shapes with truthful decoded checks", (_name, count) => {
	const wire = unusedShapeWire(count as number);
	expect(wire.length).toBeLessThan(4096);
	expect(read(wire)).toBeNull();
});

it("bounds decoded JSON after escaping with truthful size and checksums", () => {
	const custom = "\u0001".repeat(50000);
	const typed = typedCustom(text(custom));
	const wire = frame(typed, { ...empty, custom });
	expect(typed.length).toBeLessThan(262144);
	expect(JSON.parse(wire)[1]).toBeGreaterThan(262144);
	expect(wire.length).toBeLessThan(4096);
	expect(read(wire)).toBeNull();
});

it("bounds typed allocation when decoded work and JSON stay below their caps", () => {
	const count = 40000;
	const zero = [3, 128, 128, 128, 128, 128, 128, 128, 0];
	const typed = typedCustom([7, ...uint(count), ...Array(count).fill(zero).flat()], 1);
	const wire = frame(typed, { ...empty, custom: JSON.stringify(Array(count).fill(0)) });
	expect(typed.length).toBeGreaterThan(262144);
	expect(JSON.parse(wire)[1]).toBeLessThan(262144);
	expect(wire.length).toBeLessThan(4096);
	expect(read(wire)).toBeNull();
});

it("charges UTF-16 code units with truthful decoded checks below the size cap", () => {
	const signature = `sha256:${"ab".repeat(32)}`;
	const custom = JSON.stringify(["a".repeat(100000), ...Array(1000).fill(signature)]);
	const value = [
		7,
		...uint(1001),
		...utf16("a".repeat(100000)),
		...Array(1000).fill([6, 0]).flat(),
	];
	const typed = typedCustom(value, 1);
	const wire = frame(typed, { ...empty, custom }, Buffer.alloc(32, 171), [0, 1, 0]);
	expect(typed.length).toBeLessThan(262144);
	expect(JSON.parse(wire)[1]).toBeLessThan(262144);
	expect(wire.length).toBeLessThan(4096);
	expect(read(wire)).toBeNull();
});

it("charges shape keys again when expanded into an object", () => {
	const key = "x".repeat(140000);
	const expected = { ...empty, custom: "kept", [key]: null };
	const wire = frame(typedCustom([...text("kept"), 0], 0, [...rootKeys, key]), expected);
	expect(wire.length).toBeLessThan(4096);
	expect(read(wire)).toBeNull();
});

it("applies the ordinary envelope shape contract after decoding", () => {
	expect(read(frame([0, 0, 0], null))).toBeNull();
	expect(read(frame(typedCustom([0]), { ...empty, custom: null }))).toBeNull();
});

it("rejects a nested transport envelope instead of decoding it as the compact payload", () => {
	const bytes = Buffer.from(JSON.stringify(empty));
	const compressed = deflateSync(bytes);
	const nested = {
		encoding: "praxity-zlib-1",
		size: bytes.length,
		crc32: crc32(bytes),
		compressedCrc32: crc32(compressed),
		data: compressed.toString("base64"),
	};
	const keys = Object.keys(nested);
	const typed = [
		0,
		1,
		keys.length,
		...keys.flatMap(text),
		8,
		0,
		...text(nested.encoding),
		3,
		...uint(nested.size),
		3,
		...uint(nested.crc32),
		3,
		...uint(nested.compressedCrc32),
		...text(nested.data),
	];
	expect(read(frame(typed, nested))).toBeNull();
});
