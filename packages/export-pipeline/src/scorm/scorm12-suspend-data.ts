import { LEARNER_STATE_MAX_BYTES } from "@praxity/shared-blocks/learner-state";
import { inflateSync, strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";
import type { InteractionRecord } from "./types";

/** Shape stored inside cmi.suspend_data as JSON. */
export interface Scorm12SuspendData {
	visitedPages: string[];
	interactions: InteractionRecord[];
	custom?: string;
}

export const SCORM12_SUSPEND_DATA_LIMIT = 4096;

function suspendDataPayload(data: unknown): Scorm12SuspendData | null {
	if (!data || typeof data !== "object") return null;
	const value = data as Partial<Scorm12SuspendData>;
	return Array.isArray(value.visitedPages) &&
		value.visitedPages.every((id: unknown) => typeof id === "string") &&
		Array.isArray(value.interactions) &&
		(value.custom === undefined || typeof value.custom === "string")
		? (value as Scorm12SuspendData)
		: null;
}

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

function hasAdler32(bytes: Uint8Array, compressed: Uint8Array): boolean {
	let a = 1;
	let b = 0;
	for (const byte of bytes) {
		a = (a + byte) % 65521;
		b = (b + a) % 65521;
	}
	return (
		((b << 16) | a) >>> 0 ===
		new DataView(compressed.buffer, compressed.byteOffset).getUint32(compressed.length - 4)
	);
}

const EVIDENCE_FORMAT = "praxity-evidence-1";
// Dictionary tokens mirror learner-state signature syntax; update when that format changes.
const EVIDENCE_TOKEN =
	/sha256:[a-f0-9]{64}|s96:[A-Za-z0-9_-]{16}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g;
const TOKEN_WIDTHS = [16, 32, 12];
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
function encodeEvidence(raw: string): string {
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

function decodeEvidence(envelope: unknown[]): JsonValue {
	if (envelope.length !== 7 || envelope[0] !== EVIDENCE_FORMAT) throw new Error("Evidence format");
	const [, size, typedSize, counts, crc, bodyCrc, text] = envelope;
	if (
		!Number.isSafeInteger(size) ||
		(size as number) < 1 ||
		(size as number) > LEARNER_STATE_MAX_BYTES ||
		!Number.isSafeInteger(typedSize) ||
		(typedSize as number) < 1 ||
		(typedSize as number) > LEARNER_STATE_MAX_BYTES ||
		!Array.isArray(counts) ||
		counts.length !== TOKEN_WIDTHS.length ||
		!Array.from(counts).every((count) => Number.isSafeInteger(count) && count >= 0) ||
		counts.reduce((sum, count) => sum + count, 0) > (size as number) ||
		typeof text !== "string"
	)
		throw new Error("Evidence bounds");
	const body = fromBase64(text);
	if (crc32(body) !== bodyCrc) throw new Error("Evidence body CRC");
	const tableSize = counts.reduce((sum, count, kind) => sum + count * TOKEN_WIDTHS[kind], 0);
	if (tableSize > body.length - 6) throw new Error("Evidence dictionary bounds");
	const dictionary: string[] = [];
	let cursor = 0;
	for (let kind = 0; kind < counts.length; kind++) {
		for (let index = 0; index < counts[kind]; index++) {
			const bytes = body.subarray(cursor, cursor + TOKEN_WIDTHS[kind]);
			cursor += TOKEN_WIDTHS[kind];
			const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
			dictionary.push(
				kind === 0
					? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
					: kind === 1
						? `sha256:${hex}`
						: `s96:${base64(bytes).replaceAll("+", "-").replaceAll("/", "_")}`,
			);
		}
	}
	const compressed = body.subarray(tableSize);
	// Allocate from the checked declaration, never the untrusted DEFLATE stream.
	const typed = unzlibSync(compressed, { out: new Uint8Array((typedSize as number) + 1) });
	if (typed.length !== typedSize) throw new Error("Evidence inflated length");
	// fflate accepts bytes after DEFLATE's end. A complete stream must need its last byte.
	let completeWithoutLastByte = false;
	try {
		const prefix = inflateSync(compressed.subarray(2, -5), {
			out: new Uint8Array((typedSize as number) + 1),
		});
		completeWithoutLastByte =
			prefix.length === typed.length && prefix.every((byte, index) => byte === typed[index]);
	} catch {
		// Removing the last DEFLATE byte normally makes the stream incomplete.
	}
	if (completeWithoutLastByte) throw new Error("Evidence trailing compressed byte");
	if (!hasAdler32(typed, compressed)) throw new Error("Evidence Adler");
	let at = 0,
		budget = 0;
	const shapes: string[][] = [];
	function charge(count: number): void {
		budget += count;
		if (budget > LEARNER_STATE_MAX_BYTES) throw new Error("Evidence expanded bound");
	}
	function uint(): number {
		let result = 0,
			power = 1,
			byte: number;
		do {
			if (at >= typed.length || power > 2 ** 49) throw new Error("Evidence integer");
			byte = typed[at++];
			result += (byte & 127) * power;
			power *= 128;
		} while (byte & 128);
		if (!Number.isSafeInteger(result)) throw new Error("Evidence integer range");
		return result;
	}
	function take(count: number): Uint8Array {
		if (count > typed.length - at) throw new Error("Evidence truncated");
		const bytes = typed.subarray(at, at + count);
		at += count;
		return bytes;
	}
	function value(depth = 0): JsonValue {
		if (depth > 64 || at >= typed.length) throw new Error("Evidence depth/value");
		const tag = typed[at++];
		charge(1);
		switch (tag) {
			case 0:
				return null;
			case 1:
				return false;
			case 2:
				return true;
			case 3:
				return uint();
			case 4: {
				const bytes = take(8),
					number = new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0);
				if (!Number.isFinite(number)) throw new Error("Evidence number");
				return number;
			}
			case 5: {
				const bytes = take(uint());
				charge(bytes.length);
				// Tag 5 retains its original, valid UTF-8 meaning.
				return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
			}
			case 9: {
				// Tag 9 stores UTF-16 code units in big-endian order, including lone surrogates.
				const bytes = take(uint() * 2);
				charge(bytes.length);
				const units = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
				let text = "";
				for (let index = 0; index < bytes.length; index += 2)
					text += String.fromCharCode(units.getUint16(index));
				return text;
			}
			case 6: {
				const index = uint();
				if (index >= dictionary.length) throw new Error("Evidence reference");
				charge(dictionary[index].length);
				return dictionary[index];
			}
			case 7: {
				const count = uint();
				if (count > typed.length - at) throw new Error("Evidence array count");
				return Array.from({ length: count }, () => value(depth + 1));
			}
			case 8: {
				const shape = uint();
				if (shape >= shapes.length) throw new Error("Evidence shape reference");
				const object: { [key: string]: JsonValue } = Object.create(null);
				for (const key of shapes[shape]) {
					charge(key.length);
					object[key] = value(depth + 1);
				}
				return object;
			}
			default:
				throw new Error("Evidence tag");
		}
	}
	const expanded = typed[at++];
	if (expanded !== 0 && expanded !== 1) throw new Error("Evidence custom flag");
	const count = uint();
	if (count > typed.length) throw new Error("Evidence shape count");
	for (let index = 0; index < count; index++) {
		const length = uint();
		if (length > typed.length - at) throw new Error("Evidence key count");
		const keys = Array.from({ length }, () => value());
		if (
			!keys.every((key): key is string => typeof key === "string") ||
			new Set(keys).size !== keys.length
		)
			throw new Error("Evidence keys");
		shapes.push(keys);
	}
	const data = value();
	if (at !== typed.length) throw new Error("Evidence trailing byte");
	if (expanded) {
		if (!isObject(data) || !Object.hasOwn(data, "custom")) throw new Error("Evidence custom root");
		data.custom = JSON.stringify(data.custom);
	}
	const serialized = JSON.stringify(data);
	const bytes = strToU8(serialized);
	if (bytes.length !== size || crc32(bytes) !== crc)
		throw new Error("Evidence original CRC/length");
	return data;
}

/** Dormant compact reader for replacement preflight and later restoration admission. */
export function parseScorm12CompactSuspendData(raw: string): Scorm12SuspendData | null {
	try {
		if (raw.length > SCORM12_SUSPEND_DATA_LIMIT) return null;
		const envelope: unknown = JSON.parse(raw);
		if (!Array.isArray(envelope)) return null;
		// Reuse ordinary payload validation; compact input stays held by that parser.
		return suspendDataPayload(decodeEvidence(envelope));
	} catch {
		return null;
	}
}

export interface Scorm12SuspendDataCodec {
	serialize(data: Scorm12SuspendData): string;
	parse(raw: string): Scorm12SuspendData | null;
}

/** Dormant writer; hosts select this codec only when compact evidence is admitted. */
export function serializeScorm12CompactSuspendData(data: Scorm12SuspendData): string {
	return preflightScorm12SuspendData(
		data,
		encodeEvidence(JSON.stringify(data)),
		parseScorm12CompactSuspendData,
	);
}

export const scorm12CompactSuspendDataCodec: Scorm12SuspendDataCodec = {
	serialize: serializeScorm12CompactSuspendData,
	parse: (raw) => parseScorm12CompactSuspendData(raw) ?? parseScorm12SuspendData(raw),
};

/** Verify the exact filtered payload before replacing readable LMS bytes. */
export function preflightScorm12SuspendData(
	data: Scorm12SuspendData,
	candidate: string,
	read: Scorm12SuspendDataCodec["parse"],
): string {
	if (candidate.length > SCORM12_SUSPEND_DATA_LIMIT)
		throw new Error("ESCORM12STORAGE: replacement exceeds the character limit");
	const decoded = read(candidate);
	if (JSON.stringify(decoded) !== JSON.stringify(data))
		throw new Error("ESCORM12STORAGE: replacement does not preserve the payload");
	return candidate;
}

/** The adapter and export-time estimate use the same wire representation. */
export function serializeScorm12SuspendData(
	data: Scorm12SuspendData,
	reservedCharacters = 0,
): string {
	const raw = JSON.stringify(data);
	if (raw.length + reservedCharacters <= SCORM12_SUSPEND_DATA_LIMIT) return raw;
	// Choice answers repeat option IDs. Preserve the existing opaque custom-data
	// and self-check size contracts for envelopes without choice state.
	try {
		const states = data.custom && JSON.parse(data.custom).blockState;
		if (
			!states ||
			!Object.values(states).some(
				(state: unknown) =>
					!!state &&
					typeof state === "object" &&
					"assessmentType" in state &&
					state.assessmentType === "choice",
			)
		)
			return raw;
	} catch {
		return raw;
	}
	const bytes = strToU8(raw);
	if (bytes.length > LEARNER_STATE_MAX_BYTES) return raw;
	const compressed = zlibSync(bytes);
	const encoded = JSON.stringify({
		encoding: "praxity-zlib-1",
		size: bytes.length,
		crc32: crc32(bytes),
		// Cover unused DEFLATE padding bits as well as changes in decoded data.
		compressedCrc32: crc32(compressed),
		data: base64(compressed),
	});
	return encoded.length < raw.length ? encoded : raw;
}

export function parseScorm12SuspendData(raw: string): Scorm12SuspendData | null {
	try {
		if (raw.length > LEARNER_STATE_MAX_BYTES) return null;
		let data = JSON.parse(raw);
		if (data?.encoding === "praxity-zlib-1") {
			if (
				!Number.isSafeInteger(data.size) ||
				data.size < 1 ||
				data.size > LEARNER_STATE_MAX_BYTES ||
				typeof data.data !== "string" ||
				raw.length > SCORM12_SUSPEND_DATA_LIMIT
			)
				return null;
			const compressed = fromBase64(data.data);
			if (crc32(compressed) !== data.compressedCrc32) return null;
			// One extra byte detects output beyond the declared length without unbounded allocation.
			// fflate does not verify the zlib trailer's Adler-32.
			const bytes = unzlibSync(compressed, { out: new Uint8Array(data.size + 1) });
			if (bytes.length !== data.size || crc32(bytes) !== data.crc32 || compressed.length < 6)
				return null;
			if (!hasAdler32(bytes, compressed)) return null;
			data = JSON.parse(strFromU8(bytes));
		}
		return suspendDataPayload(data);
	} catch {
		return null;
	}
}

/** Refuse an over-cap write without discarding any saved answer or row. */
export function fitScorm12SuspendData(data: Scorm12SuspendData): string {
	const serialized = serializeScorm12SuspendData(data);
	if (serialized.length > SCORM12_SUSPEND_DATA_LIMIT) {
		throw new Error(
			`SCORM 1.2 suspend_data payload is ${serialized.length} characters; limit is ${SCORM12_SUSPEND_DATA_LIMIT} (ESCORM12STORAGE).`,
		);
	}
	return serialized;
}
