import { crc32 } from "node:zlib";
import { strToU8, zlibSync } from "fflate";
import { expect, it } from "vitest";
import {
	fitScorm12SuspendData,
	parseScorm12SuspendData,
	serializeScorm12SuspendData,
} from "../src/scorm/scorm12-suspend-data";

it("reads legacy JSON and leaves small payloads byte-identical", () => {
	const data = { visitedPages: ["page"], interactions: [], custom: '{"answer":"kept"}' };
	const raw = '{"visitedPages":["page"],"interactions":[],"custom":"{\\"answer\\":\\"kept\\"}"}';
	expect(serializeScorm12SuspendData(data)).toBe(raw);
	expect(parseScorm12SuspendData(raw)).toEqual(data);
});

it("compresses repeated choice state losslessly, including Unicode and unrelated data", () => {
	const data = {
		visitedPages: ["page"],
		interactions: [{ id: "q", response: "arrêt", timestamp: 1800000000000 }],
		custom: JSON.stringify({
			blockState: { q: { assessmentType: "choice", answer: ["日本語", "arrêt"] } },
			reflection: "Réponse 日本語 🧪".repeat(400),
			variables: { count: 3 },
		}),
	};
	const wire = fitScorm12SuspendData(data);
	expect(JSON.parse(wire).encoding).toBe("praxity-zlib-1");
	expect(wire.length).toBeLessThanOrEqual(4096);
	expect(parseScorm12SuspendData(wire)).toEqual(data);
});

it("selects compression before an estimate's reserved room crosses the cap", () => {
	const data = {
		visitedPages: [],
		interactions: [],
		custom: JSON.stringify({
			blockState: { q: { assessmentType: "choice", answer: ["stop"] } },
			padding: "x".repeat(3650),
		}),
	};
	expect(serializeScorm12SuspendData(data).length).toBeLessThan(4096);
	expect(JSON.parse(serializeScorm12SuspendData(data, 512)).encoding).toBe("praxity-zlib-1");
});

it.each(["opaque", "self-check"])("retains the existing %s size contract", (kind) => {
	const data = {
		visitedPages: [],
		interactions: [],
		custom:
			kind === "opaque"
				? "x".repeat(5000)
				: JSON.stringify({ blockState: { q: { kind, answer: "x".repeat(5000) } } }),
	};
	expect(serializeScorm12SuspendData(data)).toBe(JSON.stringify(data));
	expect(() => fitScorm12SuspendData(data)).toThrow(/ESCORM12STORAGE/);
});

it.each([
	'{"encoding":"praxity-zlib-1","size":262145,"data":"eA=="}',
	'{"encoding":"praxity-zlib-1","size":32,"data":"invalid"}',
	'{"encoding":"praxity-zlib-1","size":0,"data":"eA=="}',
	'{"visitedPages":[1],"interactions":[]}',
	'{"visitedPages":[],"interactions":[],"custom":{}}',
])("refuses corrupt or unbounded input %s", (raw) => {
	expect(parseScorm12SuspendData(raw)).toBeNull();
});

it("bounds decompression when the declared size is smaller than the decoded data", () => {
	const compressed = zlibSync(
		strToU8(JSON.stringify({ visitedPages: [], interactions: [], custom: "x".repeat(10000) })),
	);
	const raw = JSON.stringify({
		encoding: "praxity-zlib-1",
		size: 8,
		crc32: crc32(
			strToU8(JSON.stringify({ visitedPages: [], interactions: [], custom: "x".repeat(10000) })),
		),
		compressedCrc32: crc32(compressed),
		data: Buffer.from(compressed).toString("base64"),
	});
	expect(parseScorm12SuspendData(raw)).toBeNull();
});

it.each([-1, 1, 65521])("rejects an incorrect declared decoded length (%i)", (offset) => {
	const bytes = strToU8(JSON.stringify({ visitedPages: [], interactions: [], custom: "answer" }));
	const raw = JSON.stringify({
		encoding: "praxity-zlib-1",
		size: bytes.length + offset,
		crc32: crc32(bytes),
		compressedCrc32: crc32(zlibSync(bytes)),
		data: Buffer.from(zlibSync(bytes)).toString("base64"),
	});
	expect(parseScorm12SuspendData(raw)).toBeNull();
});

it("rejects excess decoded bytes even when their Adler-32 matches the declared prefix", () => {
	const prefix = JSON.stringify({ visitedPages: [], interactions: [], custom: "answer" });
	// 65,521 spaces leave both Adler-32 sums unchanged modulo 65,521.
	const raw = JSON.stringify({
		encoding: "praxity-zlib-1",
		size: strToU8(prefix).length,
		crc32: crc32(strToU8(prefix)),
		compressedCrc32: crc32(zlibSync(strToU8(prefix + " ".repeat(65521)))),
		data: Buffer.from(zlibSync(strToU8(prefix + " ".repeat(65521)))).toString("base64"),
	});
	expect(parseScorm12SuspendData(raw)).toBeNull();
});

it("stores independent CRC-32 and byte-length checks for decoded and compressed data", () => {
	const data = {
		visitedPages: [],
		interactions: [],
		custom: JSON.stringify({
			blockState: { q: { assessmentType: "choice", answer: ["stop"] } },
			padding: "x".repeat(5000),
		}),
	};
	const envelope = JSON.parse(serializeScorm12SuspendData(data));
	const bytes = strToU8(JSON.stringify(data));
	expect(envelope.size).toBe(bytes.length);
	expect(envelope.crc32).toBe(crc32(bytes));
	expect(envelope.compressedCrc32).toBe(crc32(Buffer.from(envelope.data, "base64")));
	for (const key of ["size", "crc32", "compressedCrc32"])
		expect(
			parseScorm12SuspendData(JSON.stringify({ ...envelope, [key]: envelope[key] + 1 })),
		).toBeNull();
	expect(parseScorm12SuspendData(JSON.stringify(envelope))).toEqual(data);
});
