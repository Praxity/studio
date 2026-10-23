import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("CI fetch bounds deepening and fetches full pinned histories for a distant merge base", (t) => {
	const root = mkdtempSync(join(tmpdir(), "timeout-history-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const origin = join(root, "origin");
	const checkout = join(root, "checkout");
	const git = (cwd, ...args) =>
		execFileSync("git", ["-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args], {
			cwd,
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	git(root, "init", "-b", "main", origin);
	git(origin, "config", "user.name", "Test");
	git(origin, "config", "user.email", "test@example.invalid");
	const commit = (value) => {
		writeFileSync(join(origin, "history.txt"), value);
		git(origin, "add", ".");
		git(origin, "commit", "-m", value);
		return git(origin, "rev-parse", "HEAD");
	};
	const ancestor = commit("ancestor");
	git(origin, "checkout", "-b", "feature");
	for (let index = 0; index < 70; index++) commit(`feature ${index}`);
	git(origin, "checkout", "main");
	for (let index = 0; index < 5; index++) commit(`base ${index}`);
	const base = git(origin, "rev-parse", "HEAD");
	git(origin, "branch", "unrelated");
	git(origin, "tag", "unrelated-tag");
	git(
		root,
		"clone",
		"--depth=1",
		"--no-tags",
		"--branch",
		"feature",
		pathToFileURL(origin).href,
		checkout,
	);
	assert.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "true");
	git(checkout, "config", "maintenance.auto", "true");
	git(checkout, "config", "gc.auto", "1");
	// Keep the planted unsafe helper in the foreground during regression checks.
	git(checkout, "config", "maintenance.autoDetach", "false");
	git(checkout, "config", "gc.autoDetach", "false");
	const trace = join(root, "git-trace.jsonl");
	const script = resolve(import.meta.dirname, "fetch-timeout-base.mjs");
	const run = (sha) =>
		spawnSync(process.execPath, [script, "--base", sha], {
			cwd: checkout,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_TRACE2_EVENT: trace,
				GIT_TRACE2_CONFIG_PARAMS: "maintenance.auto,gc.auto",
			},
		});
	const result = run(base);
	assert.equal(result.status, 0, result.stderr);
	const events = readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse);
	const fetches = events.filter((event) => event.event === "cmd_name" && event.name === "fetch");
	assert.equal(
		fetches.length,
		8,
		"trace must cover the initial, six deepen and full-history fetches",
	);
	for (const { sid } of fetches) {
		for (const [param, expected] of [
			["maintenance.auto", "false"],
			["gc.auto", "0"],
		]) {
			const values = events.filter(
				(event) => event.sid === sid && event.event === "def_param" && event.param === param,
			);
			assert.equal(values.at(-1)?.value, expected, `fetch must disable ${param}`);
		}
	}
	assert.equal(
		events.some(
			(event) => event.event === "cmd_name" && ["maintenance", "gc"].includes(event.name),
		),
		false,
		"fetch must not start automatic maintenance or gc",
	);
	assert.equal(git(checkout, "merge-base", "HEAD", base), ancestor);
	assert.match(result.stdout, /Deepening timeout comparison ancestry/);
	assert.equal((result.stdout.match(/Deepening timeout comparison ancestry/g) ?? []).length, 6);
	assert.equal((result.stdout.match(/Fetching full timeout comparison ancestry/g) ?? []).length, 1);
	assert.match(result.stdout, /Timeout checkout objects: \d+ KiB; comparison fetch added \d+ KiB/);
	assert.equal(git(checkout, "tag", "--list"), "");
	assert.equal(git(checkout, "branch", "-r").includes("unrelated"), false);
	git(checkout, "remote", "set-url", "origin", pathToFileURL(join(root, "missing")).href);
	const failed = run(base);
	assert.equal(failed.status, 1);
	assert.match(failed.stderr, /Timeout history fetch failed/);
});

test("a shallow PR merge source cannot keep timeout fetching in an endless deepen loop", (t) => {
	const root = mkdtempSync(join(tmpdir(), "timeout-shallow-merge-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, "source");
	const origin = join(root, "origin");
	const checkout = join(root, "checkout");
	const git = (cwd, ...args) =>
		execFileSync("git", ["-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args], {
			cwd,
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	git(root, "init", "-b", "main", source);
	git(source, "config", "user.name", "Test");
	git(source, "config", "user.email", "test@example.invalid");
	writeFileSync(join(source, "main.txt"), "base");
	git(source, "add", ".");
	git(source, "commit", "-m", "base");
	const base = git(source, "rev-parse", "HEAD");
	git(source, "checkout", "-b", "feature");
	writeFileSync(join(source, "feature.txt"), "feature");
	git(source, "add", ".");
	git(source, "commit", "-m", "feature");
	git(source, "checkout", "main");
	git(source, "merge", "--no-ff", "feature", "-m", "PR merge");
	git(root, "clone", "--bare", "--depth=1", pathToFileURL(source).href, origin);
	git(origin, "update-ref", "refs/pull/1/merge", "HEAD");
	git(root, "init", checkout);
	git(checkout, "remote", "add", "origin", pathToFileURL(origin).href);
	git(checkout, "fetch", "--depth=1", "origin", "refs/pull/1/merge:refs/remotes/pull/1/merge");
	git(checkout, "checkout", "--detach", "refs/remotes/pull/1/merge");
	// The source contains the base object, but its merge tip remains a shallow root.
	git(origin, "fetch", "--depth=1", pathToFileURL(source).href, base);
	git(checkout, "fetch", "--depth=1", "origin", base);
	git(checkout, "fetch", "--deepen=8", "origin", git(checkout, "rev-parse", "HEAD"), base);
	assert.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "true");
	assert.equal(spawnSync("git", ["merge-base", "HEAD", base], { cwd: checkout }).status, 1);
	const result = spawnSync(
		process.execPath,
		[resolve(import.meta.dirname, "fetch-timeout-base.mjs"), "--base", base],
		{ cwd: checkout, encoding: "utf8", timeout: 20_000 },
	);
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /No merge base after full timeout history fetch/);
	assert.equal((result.stdout.match(/Fetching full timeout comparison ancestry/g) ?? []).length, 1);
	assert.ok((result.stdout.match(/Deepening timeout comparison ancestry/g) ?? []).length <= 6);
});
