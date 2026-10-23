// Pinned public main e844d74, with imports relocated for the compatibility fixture.
import { LEARNER_STATE_MAX_BYTES } from "@praxity/shared-blocks/learner-state";
import { strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";
import type { InteractionRecord } from "../../src/scorm/types";

/** Shape stored inside cmi.suspend_data as JSON. */
export interface Scorm12SuspendData {
	visitedPages: string[];
	interactions: InteractionRecord[];
	custom?: string;
}

export const SCORM12_SUSPEND_DATA_LIMIT = 4096;

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
		data: btoa(Array.from(compressed, (byte) => String.fromCharCode(byte)).join("")),
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
			const binary = atob(data.data);
			if (btoa(binary) !== data.data) return null;
			// Indexed copying keeps checksum rejection fast for damaged saves.
			const compressed = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index++)
				compressed[index] = binary.charCodeAt(index);
			if (crc32(compressed) !== data.compressedCrc32) return null;
			// One extra byte detects output beyond the declared length without unbounded allocation.
			// fflate does not verify the zlib trailer's Adler-32.
			const bytes = unzlibSync(compressed, { out: new Uint8Array(data.size + 1) });
			if (bytes.length !== data.size || crc32(bytes) !== data.crc32 || compressed.length < 6)
				return null;
			let a = 1;
			let b = 0;
			for (const byte of bytes) {
				a = (a + byte) % 65521;
				b = (b + a) % 65521;
			}
			const checksum = new DataView(compressed.buffer, compressed.byteOffset).getUint32(
				compressed.length - 4,
			);
			if (((b << 16) | a) >>> 0 !== checksum) return null;
			data = JSON.parse(strFromU8(bytes));
		}
		return data &&
			Array.isArray(data.visitedPages) &&
			data.visitedPages.every((id: unknown) => typeof id === "string") &&
			Array.isArray(data.interactions) &&
			(data.custom === undefined || typeof data.custom === "string")
			? data
			: null;
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
