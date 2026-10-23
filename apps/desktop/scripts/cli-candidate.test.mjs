import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, parse as parsePath } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const readWorkflow = (name) =>
	parse(readFileSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), "utf8"));
const candidate = readWorkflow("cli-release");
const job = candidate.jobs.build;
const step = (name) => job.steps.find((entry) => entry.name === name);

const sharedRun = (entry) =>
	entry.run.replace(
		/(?:source \.\.\/workflow\/apps\/desktop\/scripts\/|source "\$GITHUB_WORKSPACE\/workflow\/apps\/desktop\/scripts\/)([^"\s]+)"?/g,
		(_command, file) => readFileSync(new URL(file, import.meta.url), "utf8").trimEnd(),
	);

const bash =
	process.platform === "win32"
		? join(
				process.env.ProgramFiles ??
					join(process.env.SystemDrive ?? parsePath(process.execPath).root, "Program Files"),
				"Git/bin/bash.exe",
			)
		: "/bin/bash";
const shellPath = (path) => path.replaceAll("\\", "/");

test("formal handoff download refuses unsafe run IDs and existing destinations", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "release-download-"));
	t.after(() => rmSync(directory, { recursive: true }));
	const script = candidate.jobs.publish.steps[0].run;
	const run = (id) =>
		spawnSync(bash, ["-c", `gh() { echo download; }\n${script}`], {
			encoding: "utf8",
			env: {
				...process.env,
				HOME: shellPath(directory),
				CANDIDATE_RUN_ID: id,
				GITHUB_REPOSITORY: "fixture/releases",
			},
		});
	for (const id of ["", "../other", "123/..", "branch"]) {
		const result = run(id);
		assert.notEqual(result.status, 0);
		assert.doesNotMatch(result.stdout, /download/);
	}
	assert.equal(run("123").status, 0);
	mkdirSync(join(directory, ".praxity-candidate-handoff/123"));
	const existing = run("123");
	assert.notEqual(existing.status, 0);
	assert.doesNotMatch(existing.stdout, /download/);
});

const tmpdirGuard = `set -euo pipefail
if (( \${#TMPDIR} + 60 >= 104 )); then
  printf 'TMPDIR is too long for macOS tool sockets: %s bytes plus 60 must be below 104. Use a short /tmp path.\\n' "\${#TMPDIR}" >&2
  exit 1
fi
[[ ! -L "$TMPDIR" ]] || exit 1
mkdir -m 700 -p "$TMPDIR"
`;

function assertMacTmpdirs(workflow) {
	let checked = 0;
	for (const [name, job] of Object.entries(workflow.jobs)) {
		if (!/macos/i.test(JSON.stringify([job["runs-on"], job.strategy?.matrix]))) continue;
		for (const entry of job.steps) {
			const tmpdir = entry.env?.TMPDIR ?? job.env?.TMPDIR ?? workflow.env?.TMPDIR;
			if (tmpdir === undefined) continue;
			checked++;
			assert.equal(typeof entry.run, "string", `${name}: TMPDIR tools need a guarded run step`);
			// Reserve 20 digits for the numeric run ID; unknown contexts have no safe bound.
			const longest = tmpdir.replaceAll("${{ github.run_id }}", "9".repeat(20));
			assert.match(longest, /^\/[A-Za-z0-9/_-]+$/, `${name}: TMPDIR must have a known bound`);
			assert.ok(longest.length + 60 < 104, `${name}: TMPDIR plus 60 must be below 104`);
			assert.ok(
				sharedRun(entry).startsWith(tmpdirGuard.trimEnd()),
				`${name}: guard and create TMPDIR before tools`,
			);
			assert.ok(
				job.steps.some(
					(cleanup) =>
						cleanup.if === "always()" &&
						cleanup.run?.includes(
							`"${tmpdir.replaceAll("${{ github.run_id }}", "$GITHUB_RUN_ID")}"`,
						),
				),
				`${name}: always clean the short TMPDIR`,
			);
		}
	}
	assert.ok(checked > 0, "The Mac build TMPDIR must be checked");
}

test("every Mac candidate TMPDIR is bounded, guarded before tools and always cleaned", () => {
	assertMacTmpdirs(candidate);
});

test("Mac TMPDIR policy catches planted length, guard, cleanup and future Mac-step violations", () => {
	for (const violation of [
		"long path",
		"unknown bound",
		"missing guard",
		"missing cleanup",
		"new Mac step",
	]) {
		const broken = structuredClone(candidate);
		const build = broken.jobs.build.steps.find(
			(entry) => entry.name === "Build and verify standalone CLI archives",
		);
		if (violation === "long path") build.env.TMPDIR = "/tmp/" + "x".repeat(39);
		if (violation === "unknown bound") build.env.TMPDIR = "${{ runner.temp }}/tmp";
		if (violation === "missing guard") build.run = build.run.replace(/^source [^\n]+\n/, "");
		if (violation === "missing cleanup")
			broken.jobs.build.steps.find(
				(entry) => entry.name === "Clean candidate workspace and downloads",
			).if = "success()";
		if (violation === "new Mac step")
			broken.jobs["native-smoke"].steps.push({ env: { TMPDIR: "/tmp/short" }, run: "node tool" });
		assert.throws(() => assertMacTmpdirs(broken), undefined, violation);
	}
});

test("the actual Mac TMPDIR guard accepts 43 bytes and refuses 44 or more before any tool", () => {
	const script = sharedRun(step("Build and verify standalone CLI archives"));
	for (const length of [44, 85, 43]) {
		const result = spawnSync(
			bash,
			["-e", "-o", "pipefail", "-c", `mkdir() { echo mkdir; }\nbash() { echo build; }\n${script}`],
			{
				encoding: "utf8",
				env: { ...process.env, TMPDIR: "/" + "x".repeat(length - 1), INTERNAL_INSTALL: "true" },
			},
		);
		assert.equal(result.error, undefined);
		assert.equal(result.status, length < 44 ? 0 : 1, result.stderr);
		if (length < 44) assert.equal(result.stdout, "mkdir\nbuild\n");
		else {
			assert.equal(result.stdout, "", "No tool may start with an overlong socket path");
			assert.match(result.stderr, /TMPDIR is too long for macOS tool sockets/);
		}
	}
});

test("the actual Mac TMPDIR creation refuses symlinks and permits private-directory reruns", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "cli-tmpdir-"));
	t.after(() => rmSync(directory, { recursive: true }));
	mkdirSync(join(directory, "target"));
	const script = sharedRun(step("Build and verify standalone CLI archives"));
	// MSYS cannot chmod this Windows temp volume; assert the requested mode below.
	const mkdir = process.platform === "win32" ? 'command mkdir -p "$TMPDIR"' : 'command mkdir "$@"';
	const run = (tmpdir, prefix = "") =>
		spawnSync(
			bash,
			[
				"-e",
				"-c",
				`${prefix}TMPDIR="$REQUESTED_TMPDIR"\nmkdir() { printf 'mkdir:%s\\n' "$*"; ${mkdir}; }\nbash() { echo build; }\n${script}`,
			],
			{
				cwd: directory,
				encoding: "utf8",
				env: {
					...process.env,
					MSYS: "winsymlinks:sys",
					REQUESTED_TMPDIR: tmpdir,
					INTERNAL_INSTALL: "true",
				},
			},
		);
	const symlink = run("./link", "ln -s target link\n[[ -L ./link ]] || exit 99\n");
	assert.equal(symlink.status, 1, symlink.stderr);
	assert.equal(symlink.stdout, "", "No mkdir or build may run through a symlink");
	for (const state of ["absent", "existing"]) {
		const result = run("./private-tmp");
		assert.equal(result.status, 0, `${state}: ${result.stderr}`);
		assert.equal(result.stdout, "mkdir:-m 700 -p ./private-tmp\nbuild\n");
		assert.ok(existsSync(join(directory, "private-tmp")));
	}
});

test("macOS keyboard navigation is saved before journeys and restored even on failure", () => {
	const enable = step("Enable macOS keyboard navigation");
	const restore = step("Restore macOS keyboard navigation");
	const build = step("Build and verify standalone CLI archives");
	assert.ok(enable && restore, "The owner's keyboard preference must be job-scoped");
	assert.ok(job.steps.indexOf(enable) < job.steps.indexOf(build));
	assert.ok(job.steps.indexOf(restore) > job.steps.indexOf(build));
	assert.ok(job.steps.indexOf(restore) < job.steps.indexOf(step("Hand off private CLI candidate")));
	assert.equal(enable.id, "keyboard_navigation");
	assert.match(sharedRun(enable), /defaults read -g AppleKeyboardUIMode/);
	assert.match(sharedRun(enable), /original_mode=absent/);
	const save = sharedRun(enable).indexOf('echo "original_mode=$original_mode" >> "$GITHUB_OUTPUT"');
	const write = sharedRun(enable).indexOf("defaults write -g AppleKeyboardUIMode -int 2");
	assert.ok(save >= 0 && write > save, "Save state before a write that could fail");
	assert.equal(restore.if, "always()");
	assert.equal(restore["working-directory"], "${{ runner.temp }}");
	assert.deepEqual(restore.env, {
		ORIGINAL_MODE: "${{ steps.keyboard_navigation.outputs.original_mode }}",
	});
	assert.match(
		sharedRun(restore),
		/if \[\[ "\$ORIGINAL_MODE" == absent \]\]; then\n\s+defaults delete -g AppleKeyboardUIMode/,
	);
	assert.match(
		sharedRun(restore),
		/elif \[\[ -n "\$ORIGINAL_MODE" \]\]; then\n\s+defaults write -g AppleKeyboardUIMode -int "\$ORIGINAL_MODE"/,
	);
});

for (const original of ["absent", "0", "1", "2", "3"]) {
	test(`keyboard cleanup restores the original preference: ${original}`, (t) => {
		const directory = mkdtempSync(join(tmpdir(), "cli-keyboard-"));
		t.after(() => rmSync(directory, { recursive: true, force: true }));
		// The workflow owns the shell logic; mock only the macOS defaults command.
		const result = spawnSync(
			bash,
			[
				"-e",
				"-o",
				"pipefail",
				"-c",
				`
defaults() {
  [[ "$2" == -g && "$3" == AppleKeyboardUIMode ]] || return 1
  case "$1" in
    read) [[ "$MOCK_MODE" != absent ]] || return 1; echo "$MOCK_MODE" ;;
    write) [[ "$4" == -int ]]; MOCK_MODE="$5" ;;
    delete) MOCK_MODE=absent ;;
    *) return 1 ;;
  esac
}
${sharedRun(step("Enable macOS keyboard navigation"))}
[[ "$MOCK_MODE" == 2 ]]
read -r saved < "$GITHUB_OUTPUT"
ORIGINAL_MODE="\${saved#original_mode=}"
${sharedRun(step("Restore macOS keyboard navigation"))}
echo "$MOCK_MODE"
`,
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					MOCK_MODE: original,
					GITHUB_OUTPUT: join(directory, "output").replaceAll("\\", "/"),
				},
			},
		);
		assert.equal(result.error, undefined);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout.trim(), original);
	});
}

test("formal builds stay hosted, retain all browser journeys and never cancel another release", async () => {
	assert.deepEqual(Object.keys(candidate.on), ["workflow_dispatch"]);
	assert.deepEqual(Object.keys(candidate.on.workflow_dispatch.inputs), [
		"ref",
		"pack_version",
		"publish_pack",
	]);
	assert.equal(job["runs-on"], "macos-15-intel");
	assert.equal(job.needs, "admit");
	assert.equal(candidate.concurrency["cancel-in-progress"], false);
	assert.equal(candidate.jobs["rubato-publish"].environment, "rubato-release");
	assert.match(
		step("Build and verify standalone CLI archives").run,
		/build-cli-archives.sh --browser-editor/,
	);
	assert.equal(step("Install headless browsers").if, undefined);
	assert.ok(
		job.steps.indexOf(step("Install headless browsers")) <
			job.steps.indexOf(step("Build and verify standalone CLI archives")),
	);
	const { default: config } = await import("../e2e/browser-editor/playwright.config.ts");
	assert.equal(config.use.headless, true);
	assert.equal(config.workers, 1);
	assert.deepEqual(
		config.projects.map((project) => project.name),
		["chromium", "firefox", "webkit"],
	);
	const download = candidate.jobs.publish.steps[0];
	assert.match(
		download.run,
		/gh run download "\$CANDIDATE_RUN_ID" --repo "\$GITHUB_REPOSITORY" --name cli-release-handoff/,
	);
	assert.equal(candidate.jobs.publish.permissions.contents, "write");
	for (const name of ["native-smoke", "rubato-publish"])
		assert.equal(candidate.jobs[name].permissions.contents, "write");
	for (const releaseJob of Object.values(candidate.jobs)) {
		for (const entry of releaseJob.steps) {
			if (entry.uses?.startsWith("actions/checkout@"))
				assert.equal(entry.with["persist-credentials"], false);
			assert.equal(entry["continue-on-error"], undefined);
		}
	}
});
