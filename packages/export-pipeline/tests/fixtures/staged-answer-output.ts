import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import AdmZip from "adm-zip";
import { fullyDecodeEntities } from "../../src/html-entities";

// Both staged-answer patterns share byte scanning and exact per-activity allowances.
// Their builders and positive controls stay with each pattern's contract tests.
export function stagedAnswerOutputInvariant(prefix: "SC" | "WD") {
	const outputs: Array<{ name: string; bytes: Buffer; allowed: readonly string[] }> = [];
	const runtimeOutputFiles = new Set<string>();
	function scan(name: string, bytes: string | Uint8Array, allowed: readonly string[] = []) {
		outputs.push({ name, bytes: Buffer.from(bytes), allowed });
	}
	function scanHtml(name: string, html: string, allowed: readonly string[] = []) {
		scan(name, html, allowed);
		for (const [index, match] of [
			...html.matchAll(/<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/g),
		].entries())
			scan(`${name}/config-${index}`, JSON.stringify(JSON.parse(match[1])), allowed);
	}
	function scanZip(
		name: string,
		bytes: Buffer,
		ownedFiles: ReadonlyMap<string, readonly string[]>,
	) {
		const entries = new AdmZip(bytes).getEntries();
		assert.ok(entries.length > 0);
		const start = outputs.length;
		scan(`${name}/archive`, unownedArchiveBytes(bytes, ownedFiles));
		for (const entry of entries) {
			scan(`${name}/filename`, entry.entryName);
			const data = entry.getData();
			scanRuntimeAsset(`${name}/${entry.entryName}`, entry.entryName, data, ownedFiles);
			if (entry.entryName.endsWith(".html"))
				scanHtml(`${name}/${entry.entryName}`, data.toString());
		}
		for (const output of outputs.slice(start))
			assertOutput(output.name, output.bytes, output.allowed);
	}
	function unownedArchiveBytes(bytes: Buffer, ownedFiles: ReadonlyMap<string, readonly string[]>) {
		const unowned = Buffer.from(bytes);
		for (const entry of new AdmZip(bytes).getEntries()) {
			if (!ownedFiles.has(entry.entryName)) continue;
			const offset = entry.header.offset;
			assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
			// Only the compressed payload is owned. Names, extras, comments and trailing bytes still scan.
			const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
			const end = start + entry.header.compressedSize;
			assert.ok(end <= bytes.length);
			unowned.fill(0, start, end);
		}
		return unowned;
	}
	function scanRuntimeAsset(
		name: string,
		path: string,
		bytes: Uint8Array,
		ownedFiles: ReadonlyMap<string, readonly string[]>,
	) {
		if (ownedFiles.has(path)) runtimeOutputFiles.add(name);
		scan(name, bytes, ownedFiles.get(path));
	}

	function assertOutput(name: string, bytes: Uint8Array, allowed: readonly string[] = []) {
		if (allowed.length) assert.ok(name.startsWith("explicit/") || runtimeOutputFiles.has(name));
		const decode = (value: string) =>
			fullyDecodeEntities(
				value.replace(/(?:%[\da-f]{2})+/gi, (encoded) =>
					encoded.replace(/%([\da-f]{2})/gi, (_match, hex: string) =>
						String.fromCharCode(Number.parseInt(hex, 16)),
					),
				),
			)
				.replace(/\\\\/g, "\\")
				.replace(
					/\\u\{([\da-f]{1,6})\}|\\u([\da-f]{4})|\\x([\da-f]{2})/gi,
					(_match, point: string, unicode: string, hex: string) =>
						String.fromCodePoint(Number.parseInt(point ?? unicode ?? hex, 16)),
				);
		let text =
			Buffer.from(bytes).subarray(0, 5).toString() === "%PDF-"
				? normalizePdfOutput(bytes)
				: Buffer.from(bytes).toString("latin1");
		for (let pass = 0; pass < 4 && /\\(?:u|x|\\)|&(?:#|amp;)|%[\da-f]{2}/i.test(text); pass++)
			text = decode(text);

		const base64Prefixes = ["en", "fr"].flatMap((locale) =>
			[0, 1, 2].map((padding) =>
				Buffer.from(`${" ".repeat(padding)}${prefix.toUpperCase()}_${locale}_`)
					.toString("base64")
					.slice(
						Math.ceil((padding * 8) / 6),
						Math.floor(((padding + `${prefix}_${locale}_`.length) * 8) / 6),
					),
			),
		);
		function checkText(value: string) {
			for (const hit of value.matchAll(new RegExp(`${prefix}[_-]?(en|fr)[_-]`, "gi"))) {
				const remainder = value.slice(hit.index);
				assert.ok(
					allowed.some((marker) =>
						new RegExp(`^${marker.replaceAll("_", "[_-]")}`, "i").test(remainder),
					),
					`${name} published ${remainder.slice(0, 60)}`,
				);
			}
		}
		// Never let another decode complete a truncated marker at either boundary.
		checkText(text);
		for (const [token] of text.matchAll(/[A-Za-z0-9+/_-]{12,}={0,2}/g)) {
			if (!base64Prefixes.some((encoded) => token.includes(encoded))) continue;
			// A digest/URL prefix can be part of the same token. Four offsets cover
			// every base64 alignment without joining independent strings.
			for (let offset = 0; offset < 4; offset++)
				checkText(decode(Buffer.from(token.slice(offset), "base64url").toString("latin1")));
		}
	}

	return { outputs, scan, scanHtml, scanZip, scanRuntimeAsset, unownedArchiveBytes, assertOutput };
}

/** Decode PDF metadata/outline/ActualText channels as well as compressed streams.
 * Glyph-mapped content still needs pdftotext; neither view substitutes for the other.
 */
export function normalizePdfOutput(bytes: Uint8Array): string {
	const raw = Buffer.from(bytes).toString("latin1");
	const channels = [raw];
	for (const match of raw.matchAll(/(?:\r\n|\n|\r)stream(?:\r\n|\n|\r)/g)) {
		// DecodeParms can follow Filter, so the nearest opener may belong to a nested dictionary.
		const endOfDictionary = raw.slice(0, match.index).trimEnd().length;
		assert.equal(raw.slice(endOfDictionary - 2, endOfDictionary), ">>");
		let depth = 0;
		let dictionaryStart = -1;
		for (let index = endOfDictionary - 2; index >= 0; index--) {
			const token = raw.slice(index, index + 2);
			if (token === ">>") {
				depth++;
				index--;
			} else if (token === "<<") {
				if (--depth === 0) {
					dictionaryStart = index;
					break;
				}
				index--;
			}
		}
		assert.ok(dictionaryStart >= 0, "PDF stream dictionary must balance");
		const dictionary = raw.slice(dictionaryStart, endOfDictionary);
		if (!/\/FlateDecode\b/.test(dictionary)) continue;
		const start = match.index + match[0].length;
		const length = /\/Length\s+(\d+)\s*(?:\/|>>)/.exec(dictionary);
		const end = length ? start + Number(length[1]) : raw.indexOf("endstream", start);
		assert.ok(end >= start, "PDF stream must terminate");
		const body = Buffer.from(raw.slice(start, end), "latin1");
		channels.push(inflateSync(body).toString("latin1"));
	}
	const decode = (buffer: Buffer) => {
		if (buffer[0] === 0xfe && buffer[1] === 0xff)
			return buffer.subarray(2).swap16().toString("utf16le");
		if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
		return buffer.toString("latin1");
	};
	const decoded: string[] = [];
	for (const channel of channels) {
		for (const match of channel.matchAll(/<([\da-f\s]+)>/gi)) {
			const hex = match[1].replace(/\s/g, "");
			decoded.push(decode(Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex")));
		}
		for (const match of channel.matchAll(/\((?:\\[\s\S]|[^\\()])*\)/g)) {
			const literal = match[0]
				.slice(1, -1)
				.replace(/\\([0-7]{1,3}|\r\n|[\s\S])/g, (_all, escapedCharacter: string) => {
					if (/^[0-7]/.test(escapedCharacter))
						return String.fromCharCode(Number.parseInt(escapedCharacter, 8));
					if (/^[\r\n]/.test(escapedCharacter)) return "";
					return (
						({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[
							escapedCharacter
						] ?? escapedCharacter
					);
				});
			decoded.push(decode(Buffer.from(literal, "latin1")));
		}
	}
	return [...channels, ...decoded].join("\n");
}
