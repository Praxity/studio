import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

// Literal paths also occur inside escaped strings. Scan text without decoding source syntax.
const machinePath = /\b[A-Z]:[\\/]|\bUsers[\\/][^\\/\s"'`<>]+|\/(?:Users|home)\/[^/\s"'`<>]+\//;
const fixturePath =
	/(^|\/)(?:__tests__|tests?|__fixtures__|fixtures|test-utils|test-helpers)\/|\.(?:test|spec)\.[^/]+$/;

try {
	const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
	const gitFiles = (args) =>
		execFileSync("git", ["ls-files", "-z", ...args], { cwd: root, encoding: "utf8" })
			.split("\0")
			.filter(Boolean);
	const files = gitFiles(["--cached", "--deduplicate"]);
	const deleted = new Set(gitFiles(["--deleted"]));
	const entries = JSON.parse(
		readFileSync(join(root, "scripts/machine-paths-allowlist.json"), "utf8"),
	);
	if (!Array.isArray(entries)) throw new Error("Invalid machine-path allowance: expected an array");
	const allowed = new Set();
	for (const entry of entries) {
		if (
			typeof entry?.path !== "string" ||
			typeof entry.reason !== "string" ||
			!entry.reason.trim() ||
			/[\\*?]|(^|\/)\.\.(\/|$)/.test(entry.path) ||
			!fixturePath.test(entry.path) ||
			!files.includes(entry.path) ||
			deleted.has(entry.path) ||
			allowed.has(entry.path)
		) {
			throw new Error(`Invalid machine-path allowance: ${JSON.stringify(entry)}`);
		}
		allowed.add(entry.path);
	}
	let hits = 0;
	for (const file of files) {
		if (deleted.has(file) || allowed.has(file)) continue;
		const path = join(root, file);
		const bytes = lstatSync(path).isSymbolicLink()
			? Buffer.from(readlinkSync(path))
			: readFileSync(path);
		// Git treats NUL-containing files as binary. UTF-16 BOMs identify text explicitly.
		const bigEndian = bytes[0] === 0xfe && bytes[1] === 0xff;
		const utf16 = bigEndian || (bytes[0] === 0xff && bytes[1] === 0xfe);
		if (!utf16 && bytes.includes(0)) continue;
		const text = (bigEndian ? Buffer.from(bytes).swap16() : bytes).toString(
			utf16 ? "utf16le" : "utf8",
		);
		for (const [index, line] of text.split(/\r\n|\n|\r/).entries()) {
			if (!machinePath.test(line)) continue;
			console.error(
				`${file}:${index + 1}: machine path; use an environment variable or relative path`,
			);
			hits++;
		}
	}
	if (hits) process.exitCode = 1;
	else console.log("Machine-path check passed.");
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
