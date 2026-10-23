import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inputsPath, validateInputEntries, verifyInput } from "./equivalence/verify-inputs.mjs";

const verifier = new URL("./equivalence/verify-inputs.mjs", import.meta.url);

let root;
let course;
let input;
const git = (...args) =>
	execFileSync("git", ["-C", root, ...args], {
		encoding: "utf8",
		env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
	});
beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "praxity-pinned-inputs-"));
	course = path.join(root, "course");
	await mkdir(course);
	await writeFile(path.join(course, "lesson.prax"), "Synthetic baseline\r\n");
	await writeFile(path.join(root, ".gitignore"), "*.ignored\n");
	git("init", "--quiet");
	git("add", ".");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"--quiet",
		"-m",
		"fixture",
	);
	input = {
		commit: git("rev-parse", "HEAD").trim(),
		path: "course",
		files: {
			source: {
				"lesson.prax": createHash("sha256").update("Synthetic baseline\r\n").digest("hex"),
			},
		},
	};
});
afterEach(async () => rm(root, { recursive: true, force: true }));

test("clean tracked input passes; sibling files are outside the course", async () => {
	await writeFile(path.join(root, "sibling.prax"), "not an input");
	assert.deepEqual(await verifyInput(input, course), []);
});
test("a same-size byte change names the changed file", async () => {
	await writeFile(path.join(course, "lesson.prax"), "Synthetic baseline\n\n");
	assert.match((await verifyInput(input, course)).join("\n"), /^changed: lesson\.prax /);
});
test("missing input names the file", async () => {
	await rm(path.join(course, "lesson.prax"));
	assert.deepEqual(await verifyInput(input, course), ["missing: lesson.prax"]);
});
test("extra untracked, ignored and staged files are all named", async () => {
	for (const name of ["extra.prax", "extra.ignored", "staged.prax"])
		await writeFile(path.join(course, name), "extra");
	git("add", "course/staged.prax");
	assert.deepEqual(await verifyInput(input, course), [
		"extra: extra.ignored",
		"extra: extra.prax",
		"extra: staged.prax",
	]);
});
test("a different commit fails even when course bytes match", async () => {
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"--allow-empty",
		"--quiet",
		"-m",
		"later",
	);
	assert.match((await verifyInput(input, course)).join("\n"), /^commit: expected /);
});
test("omitting a tracked file from the manifest fails", async () => {
	input.files.source = {};
	assert.deepEqual(await verifyInput(input, course), [
		"extra: lesson.prax",
		"unpinned tracked file: lesson.prax",
	]);
});
test("a manifest cannot escape the course", async () => {
	input.files.source["../outside"] = "0".repeat(64);
	await assert.rejects(verifyInput(input, course), /invalid input manifest entry: \.\.\/outside/);
});

test("a symlink substitution fails even when its target has identical bytes", async () => {
	const outside = path.join(root, "outside.prax");
	await writeFile(outside, "Synthetic baseline\r\n");
	await rm(path.join(course, "lesson.prax"));
	await symlink(outside, path.join(course, "lesson.prax"));
	assert.deepEqual(await verifyInput(input, course), ["unreadable: lesson.prax (symbolic link)"]);
});

test("the CLI passes clean input and exits nonzero naming every planted drift", async () => {
	const manifest = path.join(root, "inputs.json");
	await writeFile(manifest, JSON.stringify({ version: 1, courses: { synthetic: input } }));
	const run = () =>
		spawnSync(
			process.execPath,
			[fileURLToPath(verifier), "--inputs", manifest, "synthetic", course],
			{
				encoding: "utf8",
			},
		);
	assert.equal(run().status, 0);
	await writeFile(path.join(course, "lesson.prax"), "changed byte");
	assert.equal(run().status, 1);
	assert.match(run().stderr, /changed: lesson\.prax/);
	await rm(path.join(course, "lesson.prax"));
	assert.equal(run().status, 1);
	assert.match(run().stderr, /missing: lesson\.prax/);
	await writeFile(path.join(course, "extra.ignored"), "extra");
	const drift = run();
	assert.equal(drift.status, 1);
	assert.match(drift.stderr, /extra: extra\.ignored/);
	assert.match(drift.stderr, /missing: lesson\.prax/);
});

test("a case-only rename is drift on a case-insensitive filesystem", async (t) => {
	try {
		await access(path.join(course, "Lesson.prax"));
	} catch {
		t.skip("requires a case-insensitive filesystem");
		return;
	}
	git("config", "core.ignorecase", "true");
	await rename(path.join(course, "lesson.prax"), path.join(course, "Lesson.prax"));
	assert.match((await verifyInput(input, course)).join("\n"), /extra: Lesson\.prax/);
});

test("verification ignores inherited Git repository and index variables", async (t) => {
	const manifest = path.join(root, "inputs.json");
	await writeFile(manifest, JSON.stringify({ version: 1, courses: { synthetic: input } }));
	const inherited = { ...process.env };
	t.after(() => {
		process.env = inherited;
	});
	process.env.GIT_DIR = path.join(root, "wrong.git");
	process.env.GIT_WORK_TREE = path.join(root, "wrong-worktree");
	process.env.GIT_INDEX_FILE = path.join(root, "wrong-index");
	assert.deepEqual(await verifyInput(input, course), []);
	const result = spawnSync(
		process.execPath,
		[fileURLToPath(verifier), "--inputs", manifest, "synthetic", course],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
});

test("the committed manifest pins both courses with valid paths and SHA-256 hashes", async () => {
	const manifest = JSON.parse(await readFile(inputsPath, "utf8"));
	assert.equal(manifest.version, 1);
	assert.deepEqual(Object.keys(manifest.courses).sort(), ["leadership", "toolkit"]);
	for (const input of Object.values(manifest.courses)) {
		assert.match(input.repo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
		assert.match(input.commit, /^[a-f0-9]{40}$/);
		assert.match(input.path, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/);
		assert.ok(input.path.split("/").every((part) => ![".", ".."].includes(part)));
		assert.deepEqual(Object.keys(input.files).sort(), [
			"assets",
			"identity",
			"narration",
			"other",
			"source",
		]);
		assert.ok(validateInputEntries(input).size > 0);
	}
});
