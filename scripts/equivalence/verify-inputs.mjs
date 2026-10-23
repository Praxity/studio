import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const inputsPath = fileURLToPath(new URL("./inputs.json", import.meta.url));

/** Validate frozen paths and hashes without requiring a course checkout. */
export function validateInputEntries(input) {
	const expected = new Map();
	for (const files of Object.values(input.files)) {
		for (const [name, hash] of Object.entries(files)) {
			if (
				!name ||
				path.posix.isAbsolute(name) ||
				name.includes("\\") ||
				name.split("/").some((part) => ["", ".", ".."].includes(part)) ||
				!/^[a-f0-9]{64}$/.test(hash) ||
				expected.has(name)
			)
				throw new Error(`invalid input manifest entry: ${name}`);
			expected.set(name, hash);
		}
	}
	return expected;
}

/** Compare the checkout, including ignored extras, with the pinned Git inventory. */
export async function verifyInput(input, coursePath) {
	const cwd = path.resolve(coursePath);
	const git = (...args) =>
		execFileSync("git", ["-C", cwd, ...args], {
			encoding: "utf8",
			env: Object.fromEntries(
				Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
			),
			stdio: ["ignore", "pipe", "pipe"],
		});
	const problems = [];
	const commit = git("rev-parse", "HEAD").trim();
	if (commit !== input.commit) problems.push(`commit: expected ${input.commit}, found ${commit}`);
	const prefix = git("rev-parse", "--show-prefix").trim().replace(/\/$/, "");
	if (prefix !== input.path)
		throw new Error(`course path: expected ${input.path}, found ${prefix || "."}`);
	const expected = validateInputEntries(input);
	// ls-tree (not the index or a directory walk) defines the frozen inventory.
	const pinned = new Set(
		git("ls-tree", "-r", "--name-only", "-z", input.commit, "--", ".").split("\0").filter(Boolean),
	);
	for (const name of pinned)
		if (!expected.has(name)) problems.push(`unpinned tracked file: ${name}`);
	for (const name of expected.keys())
		if (!pinned.has(name)) problems.push(`not tracked at pinned commit: ${name}`);
	// Deliberately omit --exclude-standard: ignored additions are drift too.
	const present = new Set(
		git(
			"-c",
			"core.ignorecase=false",
			"ls-files",
			"--cached",
			"--others",
			"--deduplicate",
			"-z",
			"--",
			".",
		)
			.split("\0")
			.filter(Boolean),
	);
	for (const name of present) if (!expected.has(name)) problems.push(`extra: ${name}`);
	for (const [name, hash] of expected) {
		try {
			const filename = path.join(cwd, name);
			// Never follow a replaced identity/assets directory outside this checkout.
			let current = cwd;
			for (const part of name.split("/")) {
				current = path.join(current, part);
				if ((await lstat(current)).isSymbolicLink()) throw new Error("symbolic link");
			}
			const actual = createHash("sha256")
				.update(await readFile(filename))
				.digest("hex");
			if (actual !== hash) problems.push(`changed: ${name} (expected ${hash}, found ${actual})`);
		} catch (error) {
			problems.push(
				error.code === "ENOENT" ? `missing: ${name}` : `unreadable: ${name} (${error.message})`,
			);
		}
	}
	return problems.sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		const { values, positionals } = parseArgs({
			options: { inputs: { type: "string", default: inputsPath } },
			allowPositionals: true,
		});
		const [course, checkout, ...extra] = positionals;
		const manifest = JSON.parse(await readFile(values.inputs, "utf8"));
		if (manifest.version !== 1) throw new Error("Unsupported input manifest version");
		if (!checkout || extra.length || !Object.hasOwn(manifest.courses, course))
			throw new Error(
				`Usage: node scripts/equivalence/verify-inputs.mjs [--inputs manifest.json] <${Object.keys(manifest.courses).join("|")}> <course-directory>`,
			);
		const problems = await verifyInput(manifest.courses[course], checkout);
		if (problems.length) {
			console.error(problems.join("\n"));
			process.exitCode = 1;
		} else console.log(`${course}: pinned commit and all input files verified`);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
