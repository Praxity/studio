import { inflateRawSync } from "node:zlib";
import { hash } from "./provenance.mjs";

// Preserve array and Map order; no string, whitespace, path or markup normalization.
export function literal(value) {
	if (value instanceof Map) return { $map: [...value].map(([k, v]) => [literal(k), literal(v)]) };
	if (value instanceof Set) return { $set: [...value].map(literal) };
	if (value instanceof Date) return { $date: value.toISOString() };
	if (value instanceof RegExp) return { $regexp: [value.source, value.flags, value.lastIndex] };
	if (value === undefined) return { $undefined: true };
	if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0)))
		return { $number: String(Object.is(value, -0) ? "-0" : value) };
	if (typeof value === "bigint") return { $bigint: value.toString() };
	if (["function", "symbol"].includes(typeof value))
		throw new Error(`Unsupported literal type: ${typeof value}`);
	if (Array.isArray(value)) return Array.from(value, literal);
	if (value && typeof value === "object") {
		if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
			throw new Error("Unsupported literal object prototype");
		const entries = Object.entries(value).map(([k, v]) => [k, literal(v)]);
		// Escape marker-shaped author data, keeping it distinct from undefined/Map/etc.
		return entries.some(([key]) => key.startsWith("$"))
			? { $record: entries }
			: Object.fromEntries(entries);
	}
	return value;
}

export function firstDifference(base, candidate, location = "$") {
	if (Object.is(base, candidate)) return null;
	if (typeof base !== typeof candidate || base === null || candidate === null)
		return { path: location, base, candidate };
	if (typeof base === "string") {
		let offset = 0;
		while (offset < base.length && offset < candidate.length && base[offset] === candidate[offset])
			offset++;
		const start = Math.max(0, offset - 40);
		return {
			path: location,
			character: offset,
			base: base.slice(start, offset + 80),
			candidate: candidate.slice(start, offset + 80),
			baseLength: base.length,
			candidateLength: candidate.length,
		};
	}
	if (typeof base !== "object") return { path: location, base, candidate };
	if (Array.isArray(base) !== Array.isArray(candidate)) return { path: location, base, candidate };
	const keys = [...new Set([...Object.keys(base), ...Object.keys(candidate)])];
	for (const key of keys) {
		const at = `${location}[${JSON.stringify(key)}]`;
		if (!Object.hasOwn(base, key) || !Object.hasOwn(candidate, key))
			return { path: at, base: base[key], candidate: candidate[key], reason: "missing key" };
		const difference = firstDifference(base[key], candidate[key], at);
		if (difference) return difference;
	}
	return null;
}

// Parse central/local records, not a byte-signature scan (payload may contain signatures).
// The ONLY rewritten bytes are local +10..13 and central +12..15: DOS time/date.
export function zipPayloads(bytes) {
	const normalized = Buffer.from(bytes);
	let end = bytes.length - 22;
	for (; end >= Math.max(0, bytes.length - 65557); end--)
		if (
			bytes.readUInt32LE(end) === 0x06054b50 &&
			end + 22 + bytes.readUInt16LE(end + 20) === bytes.length
		)
			break;
	if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error("Missing ZIP end record");
	const count = bytes.readUInt16LE(end + 10);
	if (
		bytes.readUInt16LE(end + 4) ||
		bytes.readUInt16LE(end + 6) ||
		count === 65535 ||
		bytes.readUInt16LE(end + 8) !== count
	)
		throw new Error("Unsupported multipart/ZIP64 archive");
	let offset = bytes.readUInt32LE(end + 16);
	if (offset + bytes.readUInt32LE(end + 12) !== end) throw new Error("Invalid ZIP central bounds");
	const entries = [];
	const names = new Set();
	for (let index = 0; index < count; index++) {
		if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid ZIP central header");
		const flags = bytes.readUInt16LE(offset + 8);
		const method = bytes.readUInt16LE(offset + 10);
		const compressed = bytes.readUInt32LE(offset + 20);
		const length = bytes.readUInt32LE(offset + 24);
		const nameLength = bytes.readUInt16LE(offset + 28);
		const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
		const local = bytes.readUInt32LE(offset + 42);
		if (flags & 1 || ![0, 8].includes(method)) throw new Error(`Unsupported ZIP encoding: ${name}`);
		if (names.has(name) || !name || name.startsWith("/") || name.split("/").includes(".."))
			throw new Error(`Invalid ZIP name: ${name}`);
		names.add(name);
		if (bytes.readUInt32LE(local) !== 0x04034b50)
			throw new Error(`Missing ZIP local header: ${name}`);
		const localNameLength = bytes.readUInt16LE(local + 26);
		if (
			!bytes
				.subarray(local + 30, local + 30 + localNameLength)
				.equals(bytes.subarray(offset + 46, offset + 46 + nameLength))
		)
			throw new Error(`ZIP header name mismatch: ${name}`);
		const start = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
		if (start + compressed > bytes.readUInt32LE(end + 16))
			throw new Error(`ZIP payload out of bounds: ${name}`);
		const packed = bytes.subarray(start, start + compressed);
		const payload = method === 0 ? packed : inflateRawSync(packed);
		if (payload.length !== length) throw new Error(`ZIP payload length mismatch: ${name}`);
		normalized.fill(0, local + 10, local + 14);
		normalized.fill(0, offset + 12, offset + 16);
		entries.push({ name, length, sha256: hash(payload), payload });
		offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
	}
	if (!entries.length || offset !== end) throw new Error("Empty or invalid ZIP inventory");
	return { normalized, entries };
}

export function comparePackages(base, candidate) {
	const left = zipPayloads(base);
	const right = zipPayloads(candidate);
	const manifest = (zip) =>
		zip.entries
			.map(({ payload: _payload, ...entry }) => entry)
			.sort((a, b) => a.name.localeCompare(b.name, "en"));
	const difference = firstDifference(manifest(left), manifest(right));
	// Deliberately stricter than manifest-backed aliasing: filenames must match exactly.
	// No fingerprint stripping or inferred aliases; a manifest change is itself a payload change.
	return {
		pass: !difference && left.normalized.equals(right.normalized),
		files: left.entries.length,
		difference:
			difference ??
			(left.normalized.equals(right.normalized)
				? null
				: {
						path: "$zip",
						reason: "ZIP bytes differ beyond DOS timestamp fields",
						firstByte: (() => {
							const changed = left.normalized.findIndex(
								(byte, index) => right.normalized[index] !== byte,
							);
							return changed < 0 ? left.normalized.length : changed;
						})(),
					}),
		base: manifest(left),
		candidate: manifest(right),
	};
}

// XMP equivalents of /CreationDate, /ModDate and trailer /ID; observed in
// repeated Typst 0.15.1 builds. No broad date/ID/whitespace replacement.
export const PDF_VOLATILE_METADATA = [
	"xmp:CreateDate",
	"xmp:ModifyDate",
	"xmpMM:DocumentID",
	"xmpMM:InstanceID",
];
export function normalizePdfMetadata(xml) {
	if (!xml.includes("<x:xmpmeta")) throw new Error("Missing PDF XMP metadata");
	for (const field of PDF_VOLATILE_METADATA) {
		const pattern = new RegExp(`(<${field}>)[^<]*(</${field}>)`, "g");
		xml = xml.replace(pattern, "$1[volatile]$2");
	}
	return xml;
}

// Typst 0.15.1 emits classic xref tables and an uncompressed XMP stream.
// Follow their references: never search/replace arbitrary content streams.
export function normalizePdfBytes(bytes) {
	const normalized = Buffer.from(bytes);
	const raw = bytes.toString("latin1");
	if (!raw.startsWith("%PDF-")) throw new Error("Missing native PDF bytes");
	const ending = /\ntrailer\s*(<<[\s\S]*?>>)\s*startxref\s+(\d+)\s+%%EOF\s*$/.exec(raw);
	if (!ending) throw new Error("Unsupported PDF trailer");
	const xrefOffset = Number(ending[2]);
	const xref = raw.slice(xrefOffset, ending.index);
	const records = /^xref\s+0 (\d+)\s*\n([\s\S]*)$/.exec(xref);
	if (!records) throw new Error("Unsupported PDF xref table");
	const entries = records[2].trim().split(/\r?\n/);
	if (entries.length !== Number(records[1])) throw new Error("Invalid PDF xref count");
	const object = (id) => {
		const record = /^(\d{10}) 00000 n$/.exec(entries[Number(id)]?.trim() ?? "");
		if (!record) throw new Error(`Missing PDF object ${id}`);
		const start = Number(record[1]);
		const prefix = `${id} 0 obj\n`;
		if (!raw.startsWith(prefix, start)) throw new Error(`Invalid PDF object ${id}`);
		const end = raw.indexOf("\nendobj", start);
		if (end < 0) throw new Error(`Unterminated PDF object ${id}`);
		return { start: start + prefix.length, value: raw.slice(start + prefix.length, end) };
	};
	const reference = (dict, name) => {
		const match = new RegExp(`/${name} (\\d+) 0 R`).exec(dict);
		if (!match) throw new Error(`Missing PDF /${name} reference`);
		return match[1];
	};
	const info = object(reference(ending[1], "Info"));
	const root = object(reference(ending[1], "Root"));
	const metadata = object(reference(root.value, "Metadata"));
	const stream = /^(<<[\s\S]*?>>)\nstream\n/.exec(metadata.value);
	if (
		!stream ||
		!/\/Type\s*\/Metadata\b/.test(stream[1]) ||
		!/\/Subtype\s*\/XML\b/.test(stream[1]) ||
		/\/Filter\b/.test(stream[1])
	)
		throw new Error("Unsupported PDF XMP stream");
	const length = /\/Length (\d+)\b/.exec(stream[1]);
	if (!length) throw new Error("Missing PDF XMP length");
	const xml = metadata.value.slice(stream[0].length, stream[0].length + Number(length[1]));
	if (
		!xml.includes("<x:xmpmeta") ||
		metadata.value.slice(stream[0].length + Number(length[1])) !== "\nendstream"
	)
		throw new Error("Invalid PDF XMP bounds");
	const replaceValue = (text, pattern, start) => {
		const matches = [...text.matchAll(pattern)];
		if (matches.length !== 1) throw new Error(`Expected one volatile PDF field: ${pattern}`);
		const match = matches[0];
		const offset = start + match.index + match[1].length;
		normalized.fill(0x30, offset, offset + match[2].length);
		return match[2];
	};
	const volatile = {};
	for (const field of PDF_VOLATILE_METADATA)
		volatile[field] = replaceValue(
			xml,
			new RegExp(`(<${field}>)([^<]*)(</${field}>)`, "g"),
			metadata.start + stream[0].length,
		);
	for (const field of ["CreationDate", "ModDate"])
		replaceValue(
			info.value,
			new RegExp(`(/${field}\\()(D:[0-9]{14}(?:Z|[+-][0-9]{2}'[0-9]{2}))(\\))`, "g"),
			info.start,
		);
	const ids = /\/ID\s*\[\(([^()\\]*)\)\(([^()\\]*)\)\]/.exec(ending[1]);
	if (!ids || ids[1] !== volatile["xmpMM:DocumentID"] || ids[2] !== volatile["xmpMM:InstanceID"])
		throw new Error("Trailer /ID does not match XMP IDs");
	const trailerStart = ending.index + ending[0].indexOf(ending[1]);
	replaceValue(ending[1], /(\/ID\s*\[\()([^()\\]*)(\))/g, trailerStart);
	replaceValue(ending[1], /(\/ID\s*\[\([^()\\]*\)\()([^()\\]*)(\))/g, trailerStart);
	return normalized;
}

export function comparePdf(base, candidate) {
	if (
		!base.text?.trim() ||
		!candidate.text?.trim() ||
		!base.structure?.trim() ||
		!candidate.structure?.trim()
	)
		throw new Error("Missing PDF text or structure tree");
	const left = normalizePdfBytes(base.bytes);
	const right = normalizePdfBytes(candidate.bytes);
	const { bytes: _left, ...leftExtracted } = base;
	const { bytes: _right, ...rightExtracted } = candidate;
	const difference = firstDifference(leftExtracted, rightExtracted);
	if (difference) return difference;
	if (left.equals(right)) return null;
	const offset = left.findIndex((byte, index) => right[index] !== byte);
	return {
		path: "$pdf",
		firstByte: offset < 0 ? left.length : offset,
		base: { length: left.length, sha256: hash(left) },
		candidate: { length: right.length, sha256: hash(right) },
	};
}
