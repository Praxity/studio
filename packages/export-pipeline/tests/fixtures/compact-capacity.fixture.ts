// Pinned compact-wire probe for prospective over-cap lengths.
// The capacity test uses the production codec for writes, cap checks and reload.
import { LEARNER_STATE_MAX_BYTES } from "@praxity/shared-blocks/learner-state";
import { strToU8, zlibSync } from "fflate";

// CRC-32/ISO-HDLC, also used by gzip and ZIP. fflate 0.8.3 has no public CRC export.
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
	let crc = value;
	for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	return crc >>> 0;
});
function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 255];
	return (crc ^ 0xffffffff) >>> 0;
}

const EVIDENCE_FORMAT = "praxity-evidence-1";
// Dictionary tokens mirror learner-state signature syntax; update when that format changes.
const EVIDENCE_TOKEN =
	/sha256:[a-f0-9]{64}|s96:[A-Za-z0-9_-]{16}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function base64(bytes: Uint8Array): string {
	return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function fromBase64(text: string): Uint8Array {
	const binary = atob(text);
	if (btoa(binary) !== text) throw new Error("Noncanonical base64");
	// Indexed copying keeps checksum rejection fast for damaged saves.
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Dictionary bytes stay outside DEFLATE; only shapes and references are compressed. */
export function encodeEvidence(raw: string): string {
	const bytes = strToU8(raw);
	if (bytes.length > LEARNER_STATE_MAX_BYTES)
		throw new Error("ESCORM12STORAGE: evidence exceeds the decoded limit");
	const found = [...new Set(Array.from(raw.matchAll(EVIDENCE_TOKEN), (match) => match[0]))];
	const groups = [
		found.filter((value) => !value.includes(":")),
		found.filter((value) => value.startsWith("sha256:")),
		found.filter((value) => value.startsWith("s96:")),
	];
	const dictionary = groups.flat();
	const indices = new Map(dictionary.map((value, index) => [value, index]));
	const table: number[] = [];
	for (const value of dictionary) {
		if (value.startsWith("s96:")) {
			table.push(...fromBase64(value.slice(4).replaceAll("-", "+").replaceAll("_", "/")));
		} else {
			const hex = value.startsWith("sha256:") ? value.slice(7) : value.replaceAll("-", "");
			for (let at = 0; at < hex.length; at += 2)
				table.push(Number.parseInt(hex.slice(at, at + 2), 16));
		}
	}
	const data: JsonValue = JSON.parse(raw);
	let expanded = false;
	if (isObject(data) && typeof data.custom === "string") {
		try {
			const custom: JsonValue = JSON.parse(data.custom);
			if (JSON.stringify(custom) === data.custom) {
				data.custom = custom;
				expanded = true;
			}
		} catch {
			/* Opaque custom strings retain their exact bytes. */
		}
	}
	const shapes: string[][] = [];
	const shapeIndices = new Map<string, number>();
	function collect(value: JsonValue, depth = 0): void {
		if (depth > 64) throw new Error("ESCORM12STORAGE: Evidence depth");
		if (Array.isArray(value)) for (const item of value) collect(item, depth + 1);
		else if (isObject(value)) {
			const keys = Object.keys(value),
				key = JSON.stringify(keys);
			if (!shapeIndices.has(key)) {
				shapeIndices.set(key, shapes.length);
				shapes.push(keys);
			}
			for (const item of Object.values(value)) collect(item, depth + 1);
		}
	}
	collect(data);
	const output = [expanded ? 1 : 0];
	function uint(input: number): void {
		if (!Number.isSafeInteger(input) || input < 0) throw new Error("ESCORM12STORAGE: Integer");
		do {
			const next = Math.floor(input / 128);
			output.push((input % 128) | (next ? 128 : 0));
			input = next;
		} while (input);
	}
	function value(input: JsonValue): void {
		if (input === null) {
			output.push(0);
			return;
		}
		if (typeof input === "boolean") {
			output.push(input ? 2 : 1);
			return;
		}
		if (typeof input === "number") {
			if (Number.isSafeInteger(input) && input >= 0) {
				output.push(3);
				uint(input);
				return;
			}
			const bytes = new Uint8Array(8);
			new DataView(bytes.buffer).setFloat64(0, input);
			output.push(4, ...bytes);
			return;
		}
		if (typeof input === "string") {
			const index = indices.get(input);
			if (index !== undefined) {
				output.push(6);
				uint(index);
				return;
			}
			// UTF-8 has no representation for a lone surrogate. Keep tag 5 for valid strings.
			if (/[\uD800-\uDFFF]/u.test(input)) {
				output.push(9);
				uint(input.length);
				for (let index = 0; index < input.length; index++) {
					const unit = input.charCodeAt(index);
					output.push(unit >>> 8, unit & 255);
				}
				return;
			}
			const bytes = strToU8(input);
			output.push(5);
			uint(bytes.length);
			for (const byte of bytes) output.push(byte);
			return;
		}
		if (Array.isArray(input)) {
			output.push(7);
			uint(input.length);
			input.forEach(value);
			return;
		}
		const keys = Object.keys(input);
		output.push(8);
		uint(shapeIndices.get(JSON.stringify(keys)) as number);
		keys.forEach((key) => value(input[key]));
	}
	uint(shapes.length);
	for (const keys of shapes) {
		uint(keys.length);
		keys.forEach(value);
	}
	value(data);
	const typed = Uint8Array.from(output);
	if (typed.length > LEARNER_STATE_MAX_BYTES)
		throw new Error("ESCORM12STORAGE: evidence exceeds the typed limit");
	const compressed = zlibSync(typed);
	const body = new Uint8Array(table.length + compressed.length);
	body.set(table);
	body.set(compressed, table.length);
	return JSON.stringify([
		EVIDENCE_FORMAT,
		bytes.length,
		typed.length,
		groups.map((group) => group.length),
		crc32(bytes),
		crc32(body),
		base64(body),
	]);
}
