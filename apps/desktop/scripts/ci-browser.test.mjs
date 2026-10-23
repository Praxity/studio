import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { browserRequired, candidateDiff } from "./ci-browser.mjs";

const ci = parse(
	readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8"),
);
const skip = () =>
	JSON.parse(ci.jobs.changes.steps.find((step) => step.id === "browser").env.BROWSER_SKIP);

test("candidate diff fetches main and compares HEAD with its merge base", () => {
	const calls = [];
	const base = "a".repeat(40);
	const main = "b".repeat(40);
	const recorded = [];
	const diff = candidateDiff(
		(...args) => {
			calls.push(args);
			return args[0] === "rev-parse"
				? `${main}\n`
				: args[0] === "merge-base"
					? `${base}\n`
					: args[0] === "diff"
						? "docs/context/x.md\0"
						: "";
		},
		(sha) => recorded.push(sha),
	);
	assert.deepEqual(recorded, [main]);
	assert.deepEqual(calls, [
		["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"],
		["rev-parse", "origin/main"],
		["merge-base", "origin/main", "HEAD"],
		["diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--"],
	]);
	assert.equal(
		browserRequired(skip(), () => diff),
		false,
	);
});

for (const failed of ["fetch", "merge-base", "diff", "invalid-base", "incomplete-diff"]) {
	test(`candidate diff fails safe after ${failed}`, () => {
		assert.equal(
			browserRequired(skip(), () =>
				candidateDiff((command) => {
					if (command === failed) throw new Error(`git ${failed} failed`);
					if (["merge-base", "rev-parse"].includes(command))
						return failed === "invalid-base" ? "" : "a".repeat(40);
					return command === "diff" ? "docs/context/x.md" : "";
				}),
			),
			true,
		);
	});
}
for (const [files, expected] of [
	[["docs/context/x.md"], false],
	[["docs/context/x.md", "packages/export-pipeline/src/html-gen.ts"], true],
	[["packages/export-pipeline/src/html-gen.ts"], true],
	[[".claude/.hidden/x.md"], false],
	[[".claude/rules/x.md"], false],
	[["README.md"], false],
	[[".hidden.md"], false],
	[["nested/README.md"], true],
	[["nested/.hidden.md"], true],
	[[".github/workflows/ci.yml"], true],
	[[".github/workflows/security.yml"], false],
	[[".github/actions/x/action.yml"], true],
	[[], true],
]) {
	test(`immutable browser diff: ${JSON.stringify(files)}`, () => {
		assert.equal(
			browserRequired(skip(), () => files.map((file) => `${file}\0`).join("")),
			expected,
		);
	});
}

test("same-count drift uses the checked-out runtime diff even if the current PR is docs-only", () => {
	const checkedOutDiff = "packages/export-pipeline/src/html-gen.ts\0";
	const laterPrDiff = "docs/context/x.md\0";
	assert.equal(
		browserRequired(skip(), () => checkedOutDiff),
		true,
	);
	assert.equal(
		browserRequired(skip(), () => laterPrDiff),
		false,
	);
});

for (const message of ["git diff failed", "fatal: ambiguous argument HEAD^1: no parent"]) {
	test(`browser diff fails safe: ${message}`, () => {
		assert.equal(
			browserRequired(skip(), () => {
				throw new Error(message);
			}),
			true,
		);
	});
}

test("invalid skip configuration and incomplete diff output fail safe", () => {
	for (const invalid of [undefined, [], ["**", 1]])
		assert.equal(
			browserRequired(invalid, () => "docs/context/x.md\0"),
			true,
		);
	assert.equal(
		browserRequired(skip(), () => "docs/context/x.md"),
		true,
	);
});

test("the real CLI always writes the selected decision through a linked path, including candidates", (t) => {
	const root = mkdtempSync(join(tmpdir(), "ci-browser-cli-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
	git("init", "--quiet", "--initial-branch=main");
	const commit = (message) =>
		git(
			"-c",
			"user.name=Ariel Harlap",
			"-c",
			"user.email=3870784+aharlap@users.noreply.github.com",
			"commit",
			"--quiet",
			"--allow-empty",
			"-m",
			message,
		);
	commit("CLI fixture base");
	git("remote", "add", "origin", root);
	git("checkout", "--quiet", "-b", "candidate");
	const runtime = "packages/export-pipeline/src/html-gen.ts";
	mkdirSync(join(root, dirname(runtime)), { recursive: true });
	writeFileSync(join(root, runtime), "export const runtime = true;\n");
	git("add", ".");
	commit("CLI fixture runtime change");
	assert.equal(git("diff", "--name-only", "HEAD^1", "HEAD").toString().trim(), runtime);
	const docs = "docs/context/latest.md";
	mkdirSync(join(root, dirname(docs)), { recursive: true });
	writeFileSync(join(root, docs), "Latest commit changes only documentation.\n");
	git("add", ".");
	commit("CLI fixture later documentation");
	const [, entry, ...workflowArgs] = ci.jobs.changes.steps
		.find((step) => step.id === "browser")
		.run.split(" ");
	assert.deepEqual(workflowArgs, ["--candidate"]);
	const cli = fileURLToPath(new URL(`../../../${entry}`, import.meta.url));
	const linked = join(root, "script-link");
	symlinkSync(dirname(cli), linked, process.platform === "win32" ? "junction" : "dir");
	const output = join(root, "github-output");
	const run = (args, config = JSON.stringify(skip())) => {
		writeFileSync(output, "");
		const result = spawnSync(process.execPath, [join(linked, basename(cli)), ...args], {
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, GITHUB_OUTPUT: output, BROWSER_SKIP: config },
		});
		assert.equal(result.status, 0, result.stderr);
		return readFileSync(output, "utf8");
	};
	for (const [args, config, expected] of [
		[workflowArgs, JSON.stringify(skip()), true],
		[[], JSON.stringify(skip()), false],
		[workflowArgs, "{", true],
		[[], "{", true],
	]) {
		const output = run(args, config);
		assert.equal(output.split("\n")[0], `browser=${expected}`);
		if (args.includes("--candidate"))
			assert.match(output, config === "{" ? /candidate_base=\n/ : /candidate_base=[a-f0-9]{40}\n/);
	}
	git("update-ref", "refs/heads/main", "HEAD^");
	assert.match(run(workflowArgs), /^browser=false\ncandidate_base=[a-f0-9]{40}\n$/);
	git("remote", "remove", "origin");
	assert.equal(run(workflowArgs), "browser=true\ncandidate_base=\n");
});
