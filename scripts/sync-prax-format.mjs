#!/usr/bin/env node

// Mirrors docs/prax-format to the public github.com/Praxity/prax-format repository.
// Studio's docs/prax-format is the only place the spec is edited; the public repo
// receives it at release time through a PR opened by this script.
//
// Usage:
//   pnpm sync:prax-format --version 0.2.1 [--ref origin/main] [--target ../prax-format] [--dry-run] [--no-push]
//
// Files are copied from committed blobs at --ref, so local edits in the Studio
// checkout never leak into the mirror. docs/prax-format/scripts/ stays private, and
// dotfiles in the public repo (for example .github/) are left alone.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SOURCE_DIR = "docs/prax-format/";
const PRIVATE_PREFIXES = ["scripts/"];
const PUBLIC_REPO = "Praxity/prax-format";
const PUBLIC_REMOTE_PATTERN = /[/:]Praxity\/prax-format(\.git)?$/i;

const studioRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(cwd, args, options = {}) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});
}

function fail(message) {
	console.error(`sync-prax-format: ${message}`);
	process.exit(1);
}

function listBlobs(cwd, ref, prefix = "") {
	const args = ["ls-tree", "-r", "-z", ref];
	if (prefix) args.push("--", prefix);
	const entries = new Map();
	for (const record of git(cwd, args).split("\0")) {
		if (!record) continue;
		const [meta, path] = record.split("\t");
		const [mode, type, oid] = meta.split(" ");
		if (type !== "blob") continue;
		entries.set(path.slice(prefix.length), { mode, oid });
	}
	return entries;
}

function planSync(source, target) {
	const added = [];
	const modified = [];
	const removed = [];
	for (const [path, entry] of source) {
		const existing = target.get(path);
		if (!existing) added.push(path);
		else if (existing.oid !== entry.oid) modified.push(path);
	}
	for (const path of target.keys()) {
		if (!source.has(path)) removed.push(path);
	}
	return { added: added.sort(), modified: modified.sort(), removed: removed.sort() };
}

function printPlan(plan) {
	for (const [label, paths] of [
		["added", plan.added],
		["modified", plan.modified],
		["removed", plan.removed],
	]) {
		for (const path of paths) console.log(`  ${label.padEnd(8)} ${path}`);
	}
}

const { values } = parseArgs({
	args: process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--")),
	options: {
		version: { type: "string" },
		ref: { type: "string", default: "origin/main" },
		target: { type: "string", default: resolve(studioRoot, "../prax-format") },
		"dry-run": { type: "boolean", default: false },
		"no-push": { type: "boolean", default: false },
	},
});

const dryRun = values["dry-run"];
const version = values.version;
if (!dryRun && !version) fail("--version is required, for example --version 0.2.1");
if (version && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version))
	fail(`invalid version "${version}"`);

const target = resolve(values.target);
if (!existsSync(join(target, ".git"))) fail(`${target} is not a clone of ${PUBLIC_REPO}`);
const targetRemote = git(target, ["remote", "get-url", "origin"]).trim();
if (!PUBLIC_REMOTE_PATTERN.test(targetRemote))
	fail(`${target} has origin ${targetRemote}, expected ${PUBLIC_REPO}`);

git(studioRoot, ["fetch", "--quiet", "origin"]);
git(target, ["fetch", "--quiet", "--prune", "origin"]);

const sourceCommit = git(studioRoot, ["rev-parse", "--verify", `${values.ref}^{commit}`]).trim();
const source = new Map(
	[...listBlobs(studioRoot, sourceCommit, SOURCE_DIR)].filter(
		([path]) => !PRIVATE_PREFIXES.some((prefix) => path.startsWith(prefix)),
	),
);
if (source.size === 0) fail(`no files under ${SOURCE_DIR} at ${values.ref}`);
const published = new Map(
	[...listBlobs(target, "origin/main")].filter(([path]) => !path.startsWith(".")),
);

const plan = planSync(source, published);
const changeCount = plan.added.length + plan.modified.length + plan.removed.length;
console.log(`Studio ${values.ref} (${sourceCommit.slice(0, 8)}) vs ${PUBLIC_REPO} main:`);
if (changeCount === 0) {
	console.log("  already in sync");
	process.exit(0);
}
printPlan(plan);
if (dryRun) process.exit(0);

if (git(target, ["status", "--porcelain"]).trim()) fail(`${target} has uncommitted changes`);
try {
	git(target, ["var", "GIT_COMMITTER_IDENT"]);
} catch {
	fail(`git has no user.name/user.email for ${target}; configure them before syncing`);
}
const branch = `release/studio-${version}`;
if (git(target, ["branch", "--list", branch]).trim())
	fail(`branch ${branch} already exists in ${target}`);
if (git(target, ["ls-remote", "--heads", "origin", branch]).trim())
	fail(`branch ${branch} already exists on origin`);

const title = `Update format reference for Studio ${version}`;
git(target, ["switch", "--quiet", "-c", branch, "--no-track", "origin/main"]);
try {
	for (const path of [...plan.added, ...plan.modified]) {
		const file = join(target, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(
			file,
			git(studioRoot, ["cat-file", "blob", source.get(path).oid], { encoding: "buffer" }),
		);
	}
	if (plan.added.length + plan.modified.length > 0)
		git(target, ["add", "--", ...plan.added, ...plan.modified]);
	if (plan.removed.length > 0) git(target, ["rm", "--quiet", "--", ...plan.removed]);
	git(target, ["commit", "--quiet", "-m", title]);
} catch (error) {
	console.error(error.stderr?.toString().trim() || error.message);
	fail(
		`could not commit on ${branch}. To undo: git -C "${target}" reset --hard && git -C "${target}" switch main && git -C "${target}" branch -D ${branch}`,
	);
}
console.log(`Committed ${changeCount} file(s) on ${branch} in ${target}.`);

if (values["no-push"]) {
	console.log(`Review, then: git -C "${target}" push -u origin ${branch} and open a PR.`);
	process.exit(0);
}

git(target, ["push", "--quiet", "-u", "origin", branch]);
const fileList = (label, paths) =>
	paths.length ? `\n**${label}**\n${paths.map((p) => `- \`${p}\``).join("\n")}\n` : "";
const body = [
	`Mirrors the .prax format reference as shipped in Studio ${version}.`,
	fileList("Added", plan.added),
	fileList("Modified", plan.modified),
	fileList("Removed", plan.removed),
].join("\n");
const prUrl = execFileSync(
	"gh",
	[
		"pr",
		"create",
		"--repo",
		PUBLIC_REPO,
		"--base",
		"main",
		"--head",
		branch,
		"--title",
		title,
		"--body",
		body,
	],
	{ cwd: target, encoding: "utf8" },
).trim();
console.log(prUrl);
