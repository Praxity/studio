import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	inventoryLearningPatterns,
	manifestPath,
	verifyLearningPatterns,
	verifyTrustedBase,
} from "./check-learning-patterns.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repo, "scripts/check-learning-patterns.mjs");
const pin = "7bc938f1df5383f687c9fd8a7266caf9f8ad545f";
const tarball = `https://codeload.github.com/Praxity/learning-patterns/tar.gz/${pin}`;
const require = createRequire(path.join(repo, "apps/desktop/package.json"));
const { parse, stringify } = require("yaml");

async function fixture(t) {
	const root = await mkdtemp(path.join(tmpdir(), "learning-patterns-test-"));
	t.after(() => rm(root, { recursive: true }));
	const put = async (file, content) => {
		await mkdir(path.dirname(path.join(root, file)), { recursive: true });
		await writeFile(path.join(root, file), content);
	};
	await put("package.json", '{"private":true}');
	await put(".gitignore", "node_modules\n");
	await put("packages/export-pipeline/package.json", '{"private":true}');
	await put("apps/desktop/package.json", '{"private":true}');
	await symlink(path.join(repo, "node_modules"), path.join(root, "node_modules"), "dir");
	await symlink(
		path.join(repo, "apps/desktop/node_modules"),
		path.join(root, "apps/desktop/node_modules"),
		"dir",
	);
	await mkdir(path.join(root, "packages/export-pipeline/node_modules"));
	await mkdir(path.join(root, "installed"));
	await symlink(
		path.join(root, "installed"),
		path.join(root, "packages/export-pipeline/node_modules/learning-patterns"),
		"dir",
	);
	await put(
		"installed/package.json",
		'{"name":"learning-patterns","version":"0.1.0","type":"module"}',
	);
	await put("installed/LICENSE", "Invented MIT fixture notice\n");
	await put("installed/README.md", "Invented fixture\n");
	await put("installed/logic.js", 'export { value } from "./helper.js";\n');
	await put("installed/helper.js", "export const value = 42;\n");
	await put("installed/content.schema.json", '{"type":"object"}');
	await put("installed/pattern.css", ".pattern { color: black; }\n");
	await put(
		"packages/export-pipeline/template/entry.ts",
		'import { value } from "learning-patterns/logic.js"; console.log(value);\n',
	);
	await put(
		"packages/export-pipeline/src/schema.ts",
		'import schema from "learning-patterns/content.schema.json"; export { schema };\nimport "learning-patterns/pattern.css";',
	);
	await put(
		"pnpm-workspace.yaml",
		stringify({ catalog: { "learning-patterns": `github:Praxity/learning-patterns#${pin}` } }),
	);
	const lock = {
		catalogs: {
			default: { "learning-patterns": { specifier: `github:Praxity/learning-patterns#${pin}` } },
		},
		packages: { [`learning-patterns@${tarball}`]: { resolution: { tarball } } },
		snapshots: { [`learning-patterns@${tarball}`]: {} },
		importers: {
			"packages/export-pipeline": {
				dependencies: { "learning-patterns": { specifier: "catalog:", version: tarball } },
			},
		},
	};
	await put("pnpm-lock.yaml", stringify(lock));
	execFileSync("git", ["init", "-q"], { cwd: root });
	const manifest = await inventoryLearningPatterns(root);
	for (const file of manifest.files) {
		file.reviewer = "Fixture reviewer";
		file.reviewDate = "2026-10-19";
		file.reviewReceipt = "fixture-review-receipt";
	}
	const save = () => put(manifestPath, JSON.stringify(manifest));
	await save();
	return { root, put, manifest, save, lock };
}

test("clean admission discovers imported logic/helpers, schemas, CSS and legal inputs", async (t) => {
	const { root } = await fixture(t);
	const actual = await verifyLearningPatterns(root);
	assert.deepEqual(
		actual.files.map((file) => [file.path, file.roles]),
		[
			["content.schema.json", ["node-build-time"]],
			["helper.js", ["node-build-time"]],
			["LICENSE", ["legal"]],
			["logic.js", ["node-build-time"]],
			["package.json", ["legal"]],
			["pattern.css", ["css"]],
			["README.md", ["legal"]],
		],
	);
});

test("planted changed byte in an admitted helper fails", async (t) => {
	const { root, put } = await fixture(t);
	await put("installed/helper.js", "export const value = 43;\n");
	await assert.rejects(verifyLearningPatterns(root), /sha256 mismatch: helper.js/);
});

test("planted newly reached bundle helper fails even with a reviewed importing file hash", async (t) => {
	const { root, put, manifest, save } = await fixture(t);
	await put("installed/extra.js", "export const extra = 1;\n");
	await put("installed/helper.js", 'import "./extra.js"; export const value = 42;\n');
	const actual = await inventoryLearningPatterns(root);
	manifest.files.find((file) => file.path === "helper.js").sha256 = actual.files.find(
		(file) => file.path === "helper.js",
	).sha256;
	await save();
	await assert.rejects(verifyLearningPatterns(root), /Unadmitted reached file: extra.js/);
});

test("planted missing installed file fails", async (t) => {
	const { root } = await fixture(t);
	await unlink(path.join(root, "installed/helper.js"));
	await assert.rejects(verifyLearningPatterns(root), /ENOENT/);
});

test("planted escaping symlink fails without importing its code", async (t) => {
	const { root, put } = await fixture(t);
	await put("outside.js", 'throw new Error("MUST NOT EXECUTE");');
	await unlink(path.join(root, "installed/helper.js"));
	await symlink(path.join(root, "outside.js"), path.join(root, "installed/helper.js"));
	await assert.rejects(verifyLearningPatterns(root), /Symlink in learning-patterns package/);
});

test("an internal symlink also fails", async (t) => {
	const { root, put } = await fixture(t);
	await put("installed/other.js", "export const value = 42;");
	await unlink(path.join(root, "installed/helper.js"));
	await symlink("other.js", path.join(root, "installed/helper.js"));
	await assert.rejects(verifyLearningPatterns(root), /Symlink in learning-patterns package/);
});

test("package metadata symlinks and unresolved dynamic imports refuse admission", async (t) => {
	const { root, put } = await fixture(t);
	await put(
		"installed/helper.js",
		"const file = globalThis.file; import(file); export const value = 42;",
	);
	await assert.rejects(verifyLearningPatterns(root), /Unresolved learning-patterns import/);
	await put("installed/helper.js", "export const value = 42;\n");
	await put("metadata.json", '{"name":"learning-patterns"}');
	await unlink(path.join(root, "installed/package.json"));
	await symlink(path.join(root, "metadata.json"), path.join(root, "installed/package.json"));
	await assert.rejects(verifyLearningPatterns(root), /Symlink in learning-patterns package/);
});

test("an aliased package import is discovered from its resolved installed path", async (t) => {
	const { root, put } = await fixture(t);
	await put("installed/aliased.js", "export const extra = 1;");
	await symlink(
		path.join(root, "installed"),
		path.join(root, "packages/export-pipeline/node_modules/fixture-alias"),
		"dir",
	);
	await put("packages/export-pipeline/src/alias.ts", 'import "fixture-alias/aliased.js";');
	await assert.rejects(verifyLearningPatterns(root), /Unadmitted reached file: aliased.js/);
});

test("planted lockfile importer pin mismatch fails", async (t) => {
	const { root, put, lock } = await fixture(t);
	lock.importers["packages/export-pipeline"].dependencies["learning-patterns"].version =
		tarball.replace(pin, "a".repeat(40));
	await put("pnpm-lock.yaml", stringify(lock));
	await assert.rejects(verifyLearningPatterns(root), /importer lockfile pin mismatch/);
});

test("planted catalog mismatch and manifest source mismatch each fail", async (t) => {
	const { root, put, manifest, save } = await fixture(t);
	await put(
		"pnpm-workspace.yaml",
		stringify({
			catalog: { "learning-patterns": `github:Praxity/learning-patterns#${"b".repeat(40)}` },
		}),
	);
	await assert.rejects(verifyLearningPatterns(root), /catalog\/lockfile pin mismatch/);
	await put(
		"pnpm-workspace.yaml",
		stringify({ catalog: { "learning-patterns": `github:Praxity/learning-patterns#${pin}` } }),
	);
	manifest.files[0].sourceCommit = "b".repeat(40);
	await save();
	await assert.rejects(verifyLearningPatterns(root), /sourceCommit mismatch/);
});

test("each blank review field fails", async (t) => {
	const { root, manifest, save } = await fixture(t);
	for (const key of ["reviewer", "reviewDate", "reviewReceipt"]) {
		const previous = manifest.files[0][key];
		manifest.files[0][key] = "";
		await save();
		await assert.rejects(verifyLearningPatterns(root), /Incomplete review metadata/);
		manifest.files[0][key] = previous;
	}
});

test("stale/duplicate paths, missing roles and legal substitutions fail", async (t) => {
	const { root, put, manifest, save } = await fixture(t);
	manifest.files.push({ ...manifest.files[0] });
	await save();
	await assert.rejects(verifyLearningPatterns(root), /duplicate admission path/);
	manifest.files.pop();
	manifest.files[0].roles = [];
	await save();
	await assert.rejects(verifyLearningPatterns(root), /Incomplete admission digest\/pin\/roles/);
	manifest.files[0].roles = ["learner-bundle"];
	await save();
	await assert.rejects(verifyLearningPatterns(root), /roles mismatch/);
	manifest.files[0].roles = ["node-build-time"];
	manifest.files.push({ ...manifest.files[0], path: "stale.js" });
	await save();
	await assert.rejects(verifyLearningPatterns(root), /Manifest files not reached: stale.js/);
	manifest.files.pop();
	await save();
	await put("installed/LICENSE", "Substituted legal text");
	await assert.rejects(verifyLearningPatterns(root), /sha256 mismatch: LICENSE/);
});

test("regeneration writes current bytes and clears every review field", async (t) => {
	const { root, put, lock } = await fixture(t);
	const nextPin = "c".repeat(40);
	await put("pnpm-lock.yaml", stringify(JSON.parse(JSON.stringify(lock).replaceAll(pin, nextPin))));
	await put(
		"pnpm-workspace.yaml",
		stringify({ catalog: { "learning-patterns": `github:Praxity/learning-patterns#${nextPin}` } }),
	);
	await put("installed/helper.js", "export const value = 43;\n");
	await put("bundle-inputs.json", "[]");
	await put("inspection-inputs.json", JSON.stringify([path.join(root, "installed/helper.js")]));
	execFileSync(process.execPath, [
		script,
		"--root",
		root,
		"--regenerate",
		"--bundle-inputs",
		path.join(root, "bundle-inputs.json"),
		"--inspection-inputs",
		path.join(root, "inspection-inputs.json"),
	]);
	const actual = JSON.parse(await readFile(path.join(root, manifestPath), "utf8"));
	assert.ok(actual.files.every((file) => file.sourceCommit === nextPin));
	assert.ok(
		actual.files.find((file) => file.path === "helper.js").roles.includes("studio-browser"),
	);
	assert.ok(
		actual.files.every(
			(file) => file.reviewer === "" && file.reviewDate === "" && file.reviewReceipt === "",
		),
	);
	await assert.rejects(verifyLearningPatterns(root), /Incomplete review metadata/);
});

async function trustedFixture(t) {
	const { root, put } = await fixture(t);
	await put("scripts/check-learning-patterns.mjs", await readFile(script));
	await put(
		"scripts/learning-patterns-admission.mjs",
		await readFile(path.join(repo, "scripts/learning-patterns-admission.mjs")),
	);
	const runGit = (...args) =>
		execFileSync(
			"git",
			["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args],
			{ cwd: root, encoding: "utf8" },
		).trim();
	runGit("add", ".");
	runGit("commit", "-qm", "trusted admission fixture");
	const base = runGit("rev-parse", "HEAD");
	await put("candidate.txt", "candidate descendant\n");
	runGit("add", "candidate.txt");
	runGit("commit", "-qm", "candidate descendant");
	runGit("remote", "add", "origin", root);
	await put("scripts/check-learning-patterns.mjs", "process.exit(0);\n");
	const mergeCandidate = (mainBase) => {
		const tree = runGit("write-tree");
		const candidate = runGit("commit-tree", tree, "-p", mainBase, "-m", "candidate branch");
		const merge = runGit("commit-tree", tree, "-p", mainBase, "-p", candidate, "-m", "PR merge");
		runGit("update-ref", "HEAD", merge);
	};
	return { root, put, base, runGit, mergeCandidate };
}

test("trusted base runs its verifier even when the candidate verifier is weakened", async (t) => {
	const { root, base, runGit } = await trustedFixture(t);
	assert.match(
		await verifyTrustedBase(root, "HEAD"),
		/^learning-patterns admission verified: 7 files at /m,
	);
	runGit("merge-base", "--is-ancestor", base, "HEAD");
});

test("trusted base rejects changed bytes despite a weakened candidate verifier", async (t) => {
	const { root, put, base } = await trustedFixture(t);
	await put("installed/helper.js", "export const value = 43;\n");
	await assert.rejects(verifyTrustedBase(root, base), /Command failed/);
	const candidate = spawnSync(process.execPath, [
		path.join(root, "scripts/check-learning-patterns.mjs"),
	]);
	assert.equal(candidate.status, 0, "the weakened candidate would have passed");
});

test("the actual CI shell refuses changed bytes through the fetched base verifier", async (t) => {
	const { root, put, base } = await trustedFixture(t);
	const workflow = parse(await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8"));
	const step = workflow.jobs.changes.steps.find(
		(entry) => entry.name === "Verify installed learning-patterns admission",
	);
	assert.ok(step && !step.if, "Admission must run on every CI event before dependent jobs");
	await put("installed/helper.js", "export const value = 43;\n");
	const runnerTemp = await mkdtemp(path.join(tmpdir(), "learning-patterns-ci-"));
	t.after(() => rm(runnerTemp, { recursive: true }));
	const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", step.run], {
		cwd: root,
		env: { ...process.env, ADMISSION_BASE: base, RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: root },
		encoding: "utf8",
	});
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /Admission sha256 mismatch: helper.js/);
});

test("trusted base refuses missing verifier code and failed fetches", async (t) => {
	const { root, base, runGit } = await trustedFixture(t);
	runGit("rm", "--cached", "scripts/check-learning-patterns.mjs");
	runGit("commit", "-qm", "missing trusted verifier");
	await assert.rejects(verifyTrustedBase(root, "HEAD"), /Command failed/);
	// A nonexistent child of a repository can discover its parent repository
	// through Git's local transport. Use a sibling outside that repository.
	runGit("remote", "set-url", "origin", `${root}-missing-origin`);
	await assert.rejects(verifyTrustedBase(root, base), /Command failed/);
});

// R1 planted failures. Keep the real esbuild probes independent of discovery.
test("P1-1: a symlinked CLI refuses changed admitted bytes", async (t) => {
	const { root, put } = await fixture(t);
	await put("installed/helper.js", "export const value = 43;\n");
	await symlink(path.dirname(script), path.join(root, "cli-link"), "dir");
	const result = spawnSync(
		process.execPath,
		[path.join(root, "cli-link/check-learning-patterns.mjs"), "--root", root],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /sha256 mismatch/);
});

for (const [name, file, source] of [
	[
		"relative template glob",
		"packages/export-pipeline/template/glob.ts",
		"export const load = (n: string) => import(`../node_modules/learning-patterns/patterns/${n}/logic.js`);",
	],
	[
		"fixtures directory",
		"packages/export-pipeline/template/fixtures/evil.ts",
		'export { evil } from "learning-patterns/patterns/evil/logic.js";',
	],
	[
		"tracked dist directory",
		"packages/export-pipeline/src/dist/evil.ts",
		'export { evil } from "learning-patterns/patterns/evil/logic.js";',
	],
]) {
	test(`P1-2: reviewer probe ${name} refuses unadmitted bytes`, async (t) => {
		const { root, put } = await fixture(t);
		await put("installed/patterns/evil/logic.js", "export const evil = 'UNREVIEWED';");
		await put(file, source);
		if (name === "tracked dist directory") execFileSync("git", ["add", "-f", file], { cwd: root });
		const result = await require("esbuild").build({
			absWorkingDir: root,
			entryPoints: [file],
			bundle: true,
			write: false,
			metafile: true,
			format: "esm",
			platform: "browser",
			logLevel: "silent",
		});
		assert.ok(
			Object.keys(result.metafile.inputs).some((input) => input.endsWith("patterns/evil/logic.js")),
		);
		await assert.rejects(
			verifyLearningPatterns(root),
			/Unadmitted reached file|Unresolved.*import/,
		);
	});
}

test("P1-3: documented guarantee names workflow, merge-process and metadata limits", async () => {
	const docs = await readFile(path.join(repo, "docs/context/dependency-admission.md"), "utf8");
	assert.match(docs, /real gate is the Studio merge process requiring green CI/);
	assert.match(docs, /not a defence against anyone whose PR edits the workflow/);
	assert.match(docs, /reviewer metadata is checked for presence only/);
});

test("P2-1: manual dispatch explicitly skips trusted-base mode", async () => {
	const ci = parse(await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8"));
	const step = ci.jobs.changes.steps.find(
		(entry) => entry.name === "Verify installed learning-patterns admission",
	);
	assert.equal(step.env.ADMISSION_EVENT, "${{ github.event_name }}");
	assert.equal(step.env.ADMISSION_GATE, "${{ inputs.gate }}");
	assert.match(step.run, /manual dispatch: trusted-base mode skipped/);
});

test("P1-1: CI requires a positive verified receipt", async () => {
	const ci = parse(await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8"));
	const step = ci.jobs.changes.steps.find(
		(entry) => entry.name === "Verify installed learning-patterns admission",
	);
	assert.match(step.run, /learning-patterns admission verified:/);
	assert.match(step.run, /grep/);
});

for (const [name, source] of [
	["unknown import", "export const load = (name) => import(name);"],
	["template import", "export const load = () => import(`learning-patterns/logic.js`);"],
	[
		"fs read",
		'import { readFile } from "node:fs/promises"; readFile("../node_modules/learning-patterns/evil.js");',
	],
	[
		"URL read",
		'export const input = new URL("../node_modules/learning-patterns/evil.js", import.meta.url);',
	],
	[
		"template URL read",
		"export const input = new URL(`../node_modules/learning-patterns/${name}.js`, import.meta.url);",
	],
	["resolver read", 'export const input = import.meta.resolve("learning-patterns/evil.js");'],
	["alias", 'export const alias = { shadow: "learning-patterns/evil.js" };'],
]) {
	test(`P1-2: root tooling flags ${name}`, async (t) => {
		const { root, put } = await fixture(t);
		await put("tooling.mjs", source);
		await assert.rejects(
			verifyLearningPatterns(root),
			/Unresolved.*import|Stray learning-patterns/,
		);
	});
}

test("P1-2/P2-2: actual metafile inputs reject aliases, hash changes and wrong roles", async (t) => {
	const { root, put, manifest, save } = await fixture(t);
	const { assertLearningPatternsBundleInputs } = await import("./learning-patterns-admission.mjs");
	await put("installed/evil.js", "export const value = 1;");
	await put("aliased.ts", 'export { value } from "shadow";');
	const result = await require("esbuild").build({
		absWorkingDir: root,
		entryPoints: ["aliased.ts"],
		alias: { shadow: path.join(root, "installed/evil.js") },
		bundle: true,
		write: false,
		metafile: true,
		logLevel: "silent",
	});
	await assert.rejects(
		assertLearningPatternsBundleInputs(root, [result.metafile], "learner-bundle"),
		/Unadmitted bundle input: evil.js/,
	);
	const meta = { inputs: { [path.join(root, "installed/helper.js")]: {} } };
	await assert.rejects(
		assertLearningPatternsBundleInputs(root, [meta], "learner-bundle"),
		/role mismatch/,
	);
	manifest.files.find((file) => file.path === "helper.js").roles.push("learner-bundle");
	await save();
	await assertLearningPatternsBundleInputs(root, [meta], "learner-bundle");
	await put("installed/helper.js", "export const value = 43;");
	await assert.rejects(
		assertLearningPatternsBundleInputs(root, [meta], "learner-bundle"),
		/sha256 mismatch/,
	);
});

for (const name of [
	"second pin",
	"non-tarball",
	"missing snapshot",
	"no consumers",
	"conditions",
]) {
	test(`P3: ${name} refuses admission`, async (t) => {
		const { root, put, lock } = await fixture(t);
		if (name === "second pin") lock.packages["learning-patterns@other"] = {};
		if (name === "non-tarball")
			lock.packages[`learning-patterns@${tarball}`].resolution = { integrity: "fake" };
		if (name === "missing snapshot") lock.snapshots = {};
		if (name === "no consumers") lock.importers = {};
		if (name === "conditions")
			await put("installed/package.json", '{"name":"learning-patterns","exports":{}}');
		await put("pnpm-lock.yaml", stringify(lock));
		await assert.rejects(
			verifyLearningPatterns(root),
			/Multiple|resolution\/snapshot|No learning-patterns|Unsupported.*conditions/,
		);
	});
}

test("P3: legal directories and relative CSS inputs are discovered", async (t) => {
	const { root, put } = await fixture(t);
	await put("installed/NOTICE/nested.txt", "Supplemental notice");
	await put(
		"root.css",
		'@import "./packages/export-pipeline/node_modules/learning-patterns/pattern.css";',
	);
	const actual = await inventoryLearningPatterns(root);
	assert.deepEqual(actual.files.find((file) => file.path === "NOTICE/nested.txt").roles, ["legal"]);
	assert.deepEqual(actual.files.find((file) => file.path === "pattern.css").roles, ["css"]);
});

async function runAdmissionStep(t, fx, extraEnv = {}) {
	const ci = parse(await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8"));
	const step = ci.jobs.changes.steps.find(
		(entry) => entry.name === "Verify installed learning-patterns admission",
	);
	const runnerTemp = await mkdtemp(path.join(tmpdir(), "learning-patterns-ci-"));
	t.after(() => rm(runnerTemp, { recursive: true }));
	return spawnSync("bash", ["-e", "-o", "pipefail", "-c", step.run], {
		cwd: fx.root,
		encoding: "utf8",
		env: {
			...process.env,
			ADMISSION_EVENT: "pull_request",
			ADMISSION_GATE: "",
			ADMISSION_BASE: fx.base,
			GITHUB_WORKSPACE: fx.root,
			RUNNER_TEMP: runnerTemp,
			...extraEnv,
		},
	});
}

test("P1-1: CI rejects a silent successful verifier", async (t) => {
	const fx = await trustedFixture(t);
	fx.runGit("add", "scripts/check-learning-patterns.mjs");
	fx.runGit("commit", "-qm", "silent base verifier");
	fx.base = fx.runGit("rev-parse", "HEAD");
	fx.mergeCandidate(fx.base);
	const result = await runAdmissionStep(t, fx);
	assert.equal(result.status, 1, result.stderr);
	assert.doesNotMatch(result.stdout, /admission verified:/);
});

test("PR CI refuses a fetched base without the verifier despite a valid candidate copy", async (t) => {
	const fx = await trustedFixture(t);
	fx.runGit("rm", "--cached", "scripts/check-learning-patterns.mjs");
	fx.runGit("commit", "-qm", "base without verifier");
	fx.base = fx.runGit("rev-parse", "HEAD");
	fx.mergeCandidate(fx.base);
	await fx.put("scripts/check-learning-patterns.mjs", await readFile(script));
	const result = await runAdmissionStep(t, fx);
	assert.notEqual(result.status, 0, result.stdout);
	assert.match(result.stderr, /scripts\/check-learning-patterns\.mjs.*does not exist/);
	assert.doesNotMatch(result.stdout, /admission verified:/);
});

test("PR CI refuses a base with missing shared policy or a failed fetch", async (t) => {
	const fx = await trustedFixture(t);
	fx.runGit("rm", "--cached", "scripts/learning-patterns-admission.mjs");
	fx.runGit("commit", "-qm", "broken base policy");
	fx.base = fx.runGit("rev-parse", "HEAD");
	fx.mergeCandidate(fx.base);
	let result = await runAdmissionStep(t, fx);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /scripts\/learning-patterns-admission\.mjs.*does not exist/);
	assert.doesNotMatch(result.stdout, /admission verified:/);
	fx.runGit("remote", "set-url", "origin", `${fx.root}-unreachable`);
	result = await runAdmissionStep(t, fx);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /does not appear to be a git repository/);
	assert.doesNotMatch(result.stdout, /admission verified:/);
});

test("P2-1: candidate dispatch skips base extraction and names candidate verification", async (t) => {
	const fx = await trustedFixture(t);
	await fx.put("scripts/check-learning-patterns.mjs", await readFile(script));
	const result = await runAdmissionStep(t, fx, {
		ADMISSION_EVENT: "workflow_dispatch",
		ADMISSION_GATE: "candidate",
		ADMISSION_BASE: "not-a-trusted-base",
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /manual dispatch: trusted-base mode skipped/);
	assert.match(result.stdout, /admission verified: 7 files/);
});

test("P3: receipt digest is reproducible and installed-byte cache keys change on drift", async (t) => {
	const { root, put, manifest } = await fixture(t);
	const { admissionDigest, installedLearningPatternsDigest } = await import(
		"./learning-patterns-admission.mjs"
	);
	const result = spawnSync(process.execPath, [script, "--root", root, "--digest"], {
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, new RegExp(`${pin} manifest-sha256 ${admissionDigest(manifest)}`));
	const first = await installedLearningPatternsDigest(root);
	// SHA-256 of the fixture path + NUL + content-SHA-256 + newline records.
	assert.equal(first, "585c6f1925b8e7dd774312eb6a5913c4a6d7c36cd3e78e11b982dcf0b54056ea");
	await put("installed/helper.js", "export const value = 43;");
	assert.notEqual(await installedLearningPatternsDigest(root), first);
});

test("P1-2: relative unquoted CSS reaches an unadmitted file", async (t) => {
	const { root, put } = await fixture(t);
	await put("installed/evil.css", ".evil { color: red; }");
	await put(
		"root.css",
		"@import url(./packages/export-pipeline/node_modules/learning-patterns/evil.css);",
	);
	await assert.rejects(verifyLearningPatterns(root), /Unadmitted reached file: evil.css/);
});

test("P3: digest uses the documented projection and excludes review metadata", async () => {
	const { admissionDigest } = await import("./learning-patterns-admission.mjs");
	const manifest = {
		files: [
			{
				path: "one.js",
				sha256: "a".repeat(64),
				sourceCommit: pin,
				roles: ["node-build-time"],
				reviewer: "first",
				reviewDate: "2026-10-19",
				reviewReceipt: "receipt-a",
			},
		],
	};
	assert.equal(
		admissionDigest(manifest),
		"773c90319113a59a7dd24f4917fff6b992ce93e0d52f65a7dede35e4d056ccbb",
	);
	manifest.files[0].reviewer = "second";
	manifest.files[0].reviewReceipt = "receipt-b";
	assert.equal(
		admissionDigest(manifest),
		"773c90319113a59a7dd24f4917fff6b992ce93e0d52f65a7dede35e4d056ccbb",
	);
});

test("R2 P2-2: Node discovery documents computed-path and alias limits", async () => {
	const docs = await readFile(path.join(repo, "docs/context/dependency-admission.md"), "utf8");
	assert.match(docs, /catches unrecorded or accidental changes/);
	assert.match(docs, /Studio inspection frame/);
	assert.match(docs, /computed `createRequire` paths/);
	assert.match(docs, /`fs` reads anchored on allowed package files/);
	assert.match(docs, /TypeScript path aliases/);
	assert.match(docs, /literal imports and known patterns only/);
});

test("R2 P3-4: missing or empty metafile collections refuse", async (t) => {
	const { root } = await fixture(t);
	const { assertLearningPatternsBundleInputs } = await import("./learning-patterns-admission.mjs");
	for (const metafiles of [[], [undefined], [{}]])
		await assert.rejects(assertLearningPatternsBundleInputs(root, metafiles, "node-build-time"));
});

test("R2 P3-2: all manual dispatches name candidate-only verification", async (t) => {
	const fx = await trustedFixture(t);
	await fx.put("scripts/check-learning-patterns.mjs", await readFile(script));
	const result = await runAdmissionStep(t, fx, {
		ADMISSION_EVENT: "workflow_dispatch",
		ADMISSION_GATE: "all",
		ADMISSION_BASE: "not-a-trusted-base",
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /manual dispatch: trusted-base mode skipped/);
});

test("PR CI uses the merge first parent instead of a stale event base", async (t) => {
	const fx = await trustedFixture(t);
	fx.runGit("add", "scripts/check-learning-patterns.mjs");
	const staleBase = fx.runGit(
		"commit-tree",
		fx.runGit("write-tree"),
		"-p",
		fx.base,
		"-m",
		"older main with silent verifier",
	);
	fx.base = fx.runGit(
		"commit-tree",
		fx.runGit("rev-parse", "HEAD^{tree}"),
		"-p",
		staleBase,
		"-m",
		"current main verifier",
	);
	fx.mergeCandidate(fx.base);
	const result = await runAdmissionStep(t, fx, { ADMISSION_BASE: staleBase });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /admission verified: 7 files/);
});

test("PR CI refuses an unresolved merge first parent despite a valid event base", async (t) => {
	const fx = await trustedFixture(t);
	fx.runGit("update-ref", "HEAD", fx.base);
	await fx.put("scripts/check-learning-patterns.mjs", await readFile(script));
	const result = await runAdmissionStep(t, fx);
	assert.notEqual(result.status, 0, result.stdout);
	assert.match(result.stderr, /Needed a single revision/);
	assert.doesNotMatch(result.stdout, /admission verified:/);
});
