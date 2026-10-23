import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse as parsePath } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../../../", import.meta.url);
const bash =
	process.platform === "win32"
		? join(
				process.env.ProgramFiles ??
					join(process.env.SystemDrive ?? parsePath(process.execPath).root, "Program Files"),
				"Git/bin/bash.exe",
			)
		: "/bin/bash";

// Workflow fixtures run before cutover unless they explicitly supply repository variables.
export function workflowFunction(...parameters) {
	const body = parameters.pop();
	const defaults = `${parameters.includes("vars") ? "" : "const vars = {};"}${parameters.includes("github") ? "" : 'const github = { repository: "fixture/studio" };'}`;
	return Function(...parameters, defaults + body);
}
export function retentionFixture(t, files) {
	const root = pathToFileURL(`${mkdtempSync(`${tmpdir()}/artifact-policy-`)}/`);
	t.after(() => rmSync(root, { recursive: true }));
	for (const [path, text] of Object.entries(files)) {
		const file = new URL(path, root);
		mkdirSync(new URL(".", file), { recursive: true });
		writeFileSync(file, text);
	}
	return root;
}

export function stepArguments(job, step, exitCode = 0, directory = root, program = "node") {
	const run = spawnSync(
		bash,
		[
			"--noprofile",
			"--norc",
			"-e",
			"-o",
			"pipefail",
			"-c",
			`
${program}() { printf '%s\\n' "$@"; return "$TEST_EXIT"; }
${step.run}`,
		],
		{
			cwd: directory,
			encoding: "utf8",
			env: {
				...process.env,
				...job.env,
				...step.env,
				TEST_EXIT: String(exitCode),
				GITHUB_STEP_SUMMARY: step.env?.GITHUB_STEP_SUMMARY ?? "/dev/null",
			},
		},
	);
	assert.equal(run.status, exitCode, run.stderr);
	return run.stdout.trim().split(/\r?\n/);
}

export function assertNodeCheckPartition(job, workers = 4, workspace = root, serialCondition) {
	const serial = job.steps.find((step) => step.id === "node-serial");
	const parallel = job.steps.find((step) => step.id === "node-parallel");
	assert.ok(serial && parallel, "Node checks need serial and parallel steps");
	assert.equal(serial.shell, "bash");
	assert.equal(parallel.shell, "bash");
	assert.ok(job.steps.indexOf(serial) < job.steps.indexOf(parallel));
	assert.equal(serial.if, serialCondition);
	assert.equal(parallel.if, "${{ !cancelled() && steps.install.outcome == 'success' }}");
	assert.ok(job.steps.some((step) => step.id === "install"));
	for (const entry of [job, serial, parallel])
		assert.equal(entry["continue-on-error"], undefined, "Either test failure must fail the job");
	assert.equal(job.env?.SERIAL_NODE_TESTS, undefined, "The file owns the serial list");
	const listed = readFileSync(new URL("scripts/serial-node-tests.txt", workspace), "utf8")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	assert.ok(listed.length > 0, "scripts/serial-node-tests.txt must list at least one test");
	const serialArgs = stepArguments(job, serial, 0, workspace);
	const parallelArgs = stepArguments(job, parallel, 0, workspace);
	assert.deepEqual(serialArgs, ["--test", "--test-concurrency=1", ...listed]);
	assert.deepEqual(parallelArgs.slice(0, 2), ["--test", `--test-concurrency=${workers}`]);
	const actual = [...serialArgs.slice(2), ...parallelArgs.slice(2)].sort();
	const expected = ["scripts/", "apps/desktop/scripts/"].flatMap((directory) =>
		readdirSync(new URL(directory, workspace))
			.filter((file) => file.endsWith(".test.mjs"))
			.map((file) => `${directory}${file}`),
	);
	assert.deepEqual(actual, expected.sort(), "Every Node test file must run exactly once");
	for (const step of [serial, parallel]) stepArguments(job, step, 23, workspace);
}

export function nodePartitionFixture(t) {
	const listed = readFileSync(new URL("scripts/serial-node-tests.txt", root), "utf8")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	const neighbour = "apps/desktop/scripts/x-standalone-cli-lifecycle.test.mjs";
	// A listed extension makes the neighbour a prefix, exposing a lost end boundary.
	const fixtureSerial = [...listed, `${neighbour}-extra.test.mjs`];
	return retentionFixture(t, {
		"scripts/serial-node-tests.txt": `${fixtureSerial.join("\n")}\n`,
		...Object.fromEntries(
			[
				...fixtureSerial,
				neighbour,
				"scripts/standalone-cli-lifecycle.test.mjs",
				"scripts/ordinary.test.mjs",
			].map((file) => [file, ""]),
		),
	});
}

export function couldBeSelfHosted(value, matrix) {
	if (Array.isArray(value)) return value.some((label) => couldBeSelfHosted(label, matrix));
	if (value && typeof value === "object")
		return Boolean(value.group) || couldBeSelfHosted(value.labels, matrix);
	if (typeof value !== "string") return true;
	const axis = /^\$\{\{\s*matrix\.(\w+)\s*\}\}$/.exec(value)?.[1];
	if (axis) {
		if (
			!matrix ||
			typeof matrix !== "object" ||
			(matrix[axis] !== undefined && !Array.isArray(matrix[axis])) ||
			(matrix.include !== undefined && !Array.isArray(matrix.include))
		)
			return true;
		const values = [
			...(matrix?.[axis] ?? []),
			...(matrix?.include ?? []).map((item) => item[axis]).filter(Boolean),
		];
		return !values.length || values.some((item) => couldBeSelfHosted(item, matrix));
	}
	// The fork-routing expression chooses only between hosted labels.
	if (
		value ===
		"${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository && 'ubuntu-24.04' || 'ubicloud-standard-2' }}"
	)
		return false;
	// Unknown expressions/labels cannot establish that a PR stays on hosted runners.
	return !/^(?:ubicloud-[\w.-]+|ubuntu-(?:latest|22\.04|24\.04)(?:-arm)?|windows-(?:latest|2022|2025)|macos-(?:latest|13|14|15|26)(?:-intel|-large|-xlarge)?)$/.test(
		value,
	);
}

export function assertNoRetiredCommands(name, config) {
	for (const job of Object.values(config.jobs)) {
		const commands = [
			job.uses ?? "",
			...(job.steps ?? []).flatMap((step) => [step.run ?? "", step.uses ?? ""]),
		];
		for (const command of commands)
			assert.doesNotMatch(command, /qa\.config|authoring-smoke|e2e:stage|desktop e2e\b/, name);
	}
}
export function assertNoRetiredRunner(name, source) {
	assert.doesNotMatch(source, /praxity-release/, name);
}
const rootScripts = JSON.parse(
	readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
).scripts;
export function runsSlowReporter(step, seen = new Set()) {
	return (step.run ?? "").split(/[\n;&|]+/).some((command) => {
		if (command.trim().startsWith("#") || command.includes("--select-only")) return false;
		if (
			/(?:^|\s)(?:pnpm\s+(?:exec\s+)?|pnpm\s+run\s+)?vitest(?:\s|$)/.test(command) ||
			/\bpnpm\s+(?:run\s+)?test(?::affected)?(?:\s|$)/.test(command) ||
			/\bvitest\.(?:config|workspace)\.[cm]?[jt]s\b|slow-tests-reporter\.mjs/.test(command)
		)
			return true;
		for (const match of command.matchAll(/\bpnpm\s+(?:run\s+)?([\w:-]+)/g)) {
			const script = match[1];
			if (
				rootScripts[script] &&
				!seen.has(script) &&
				runsSlowReporter({ run: rootScripts[script] }, new Set([...seen, script]))
			)
				return true;
		}
		return false;
	});
}

export function assertSlowConfirmation(config) {
	const jobs = Object.entries(config.jobs).filter(
		([, job]) =>
			!/macos|windows/i.test(JSON.stringify(job["runs-on"] ?? "")) &&
			job.steps?.some((step) => runsSlowReporter(step)),
	);
	for (const [name, job] of jobs) {
		const runs = job.steps.flatMap((step, index) => (runsSlowReporter(step) ? [index] : []));
		for (const index of runs)
			assert.match(
				job.steps[index].run,
				/bash scripts\/run-vitest-isolated\.sh /,
				`${name}: isolate every Vitest command`,
			);
		const confirms = job.steps.flatMap((step, index) =>
			step.run === 'node scripts/confirm-slow-tests.mjs "$SLOW_TESTS_PENDING_FILE"' ? [index] : [],
		);
		assert.equal(confirms.length, 1, name);
		assert.ok(confirms[0] > Math.max(...runs), `${name}: confirm only after Vitest exits`);
		const step = job.steps[confirms[0]];
		assert.equal(
			step.if,
			"${{ !cancelled() && hashFiles('.slow-tests-pending.json') != '' }}",
			name,
		);
		assert.equal(step["continue-on-error"], undefined, name);
		assert.equal(
			job.env.SLOW_TESTS_PENDING_FILE,
			"${{ github.workspace }}/.slow-tests-pending.json",
			name,
		);
		assert.equal(
			job.env.SLOW_TESTS_PROCESS_GROUPS_FILE,
			"${{ github.workspace }}/.slow-tests-process-groups",
			name,
		);
		const deadline = job.steps[0];
		assert.equal(deadline.name, "Set confirmation deadline", name);
		assert.equal(
			Number(deadline.run.match(/\+ (\d+) \* 60 - 45/)[1]),
			job["timeout-minutes"],
			name,
		);
		assert.match(deadline.run, /CI_JOB_DEADLINE_MS=.*date \+%s.*\* 1000.*GITHUB_ENV/);
		assert.equal(step.env?.CI_JOB_DEADLINE_MS, undefined, "inherit the deadline via GITHUB_ENV");
	}
}

export function isPrivateWorkflow(name, source, manifest) {
	return (
		manifest.workflows.includes(name) &&
		manifest.workflowSha256?.[name] === createHash("sha256").update(source).digest("hex")
	);
}
