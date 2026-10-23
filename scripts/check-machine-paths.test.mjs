import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-machine-paths.mjs", import.meta.url));

function repository(t, files, allowlist = []) {
	const root = mkdtempSync(join(tmpdir(), "machine-paths-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "--quiet", root]);
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
	for (const [path, content] of Object.entries({
		...files,
		"scripts/machine-paths-allowlist.json": JSON.stringify(allowlist),
	})) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	execFileSync("git", ["add", "."], { cwd: root });
	return root;
}

function check(root) {
	const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
	if (result.error) throw result.error;
	return result;
}

test("accepts portable tracked text and ignores untracked files and binary data", (t) => {
	const root = repository(t, {
		"README.md": "${HOME}/work\nrelative/course\nhttps://example.org/course\n",
		"image.bin": Buffer.from("\0C:/Users/alex/private"),
	});
	writeFileSync(join(root, "local.md"), "/home/alex/private/");
	const result = check(root);
	assert.equal(result.status, 0, result.stderr);
});

for (const path of [
	"D:/GitHub/private",
	String.raw`C:\tools\private`,
	"Users/alex/private",
	String.raw`Users\alex\private`,
	"/Users/alex/private/",
	"/home/alex/private/",
]) {
	test(`rejects tracked text containing ${path}`, (t) => {
		const root = repository(t, { "docs/notes with spaces.md": `portable\n${path}\n` });
		const result = check(root);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /docs\/notes with spaces\.md:2: machine path/);
	});
}

test("reads current tracked content, including changes since the index", (t) => {
	const root = repository(t, { "README.md": "portable" });
	writeFileSync(join(root, "README.md"), "C:/private");
	assert.equal(check(root).status, 1);
});

for (const encoding of ["utf16le", "utf16be"]) {
	test(`rejects machine paths in ${encoding} text with a BOM`, (t) => {
		const bytes = Buffer.from("\uFEFFC:/private", "utf16le");
		const root = repository(t, { "notes.txt": encoding === "utf16be" ? bytes.swap16() : bytes });
		const result = check(root);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /notes\.txt:1: machine path/);
	});
}

test("allows only the exact fixture file named with a reason", (t) => {
	const allowance = { path: "tests/fixtures/windows.txt", reason: "Windows path parser input." };
	const root = repository(t, { [allowance.path]: "C:/fixture" }, [allowance]);
	assert.equal(check(root).status, 0);
	writeFileSync(join(root, "tests/fixtures/other.txt"), "C:/accident");
	execFileSync("git", ["add", "."], { cwd: root });
	const result = check(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /tests\/fixtures\/other\.txt:1: machine path/);
});

for (const entries of [
	[{ path: "tests/fixtures/windows.txt", reason: "" }],
	[{ path: "tests/fixtures/*.txt", reason: "Too broad." }],
	[{ path: "src/production.ts", reason: "Production cannot be exempted." }],
	[{ path: "tests/fixtures/missing.txt", reason: "Stale entry." }],
	[
		{ path: "tests/fixtures/windows.txt", reason: "First." },
		{ path: "tests/fixtures/windows.txt", reason: "Duplicate." },
	],
]) {
	test(`rejects invalid allowlist ${JSON.stringify(entries)}`, (t) => {
		const root = repository(t, { "tests/fixtures/windows.txt": "C:/fixture" }, entries);
		const result = check(root);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Invalid machine-path allowance/);
	});
}

test("fails when the allowlist cannot be read", (t) => {
	const root = repository(t, {});
	rmSync(join(root, "scripts/machine-paths-allowlist.json"));
	assert.equal(check(root).status, 1);
});
