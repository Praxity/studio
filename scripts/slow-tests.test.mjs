import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { confirmSlowTests } from "./confirm-slow-tests.mjs";
import SlowTestsReporter, { validateAllowlist } from "./slow-tests-reporter.mjs";

const root = resolve(import.meta.dirname, "..");
const entry = {
	file: "apps/desktop/src/slow.test.ts",
	name: "suite > slow",
	reason: "Measured on Linux; remove after reducing filesystem setup.",
};

test("allowlist may only shrink; names, files, duplicate entries and reasons are checked", () => {
	validateAllowlist([entry], [entry]);
	validateAllowlist([], [entry]);
	assert.throws(
		() => validateAllowlist([entry, { ...entry, name: "new" }], [entry]),
		/may only shrink/,
	);
	assert.throws(() => validateAllowlist([{ ...entry, reason: "" }], []), /reason/);
	assert.throws(() => validateAllowlist([{ ...entry, file: "../slow.test.ts" }]), /relative/);
	assert.throws(() => validateAllowlist([{ ...entry, file: "/slow.test.ts" }]), /relative/);
	assert.throws(
		() => validateAllowlist([{ ...entry, file: "apps/desktop//slow.test.ts" }]),
		/relative/,
	);
	assert.throws(
		() => validateAllowlist([{ ...entry, file: "apps/desktop/src\\slow.test.ts" }]),
		/relative/,
	);
	assert.throws(() => validateAllowlist([{ ...entry, name: "" }]), /name/);
	assert.throws(() => validateAllowlist([entry, entry]), /Duplicate/);
});

const today = Date.parse("2026-10-18T23:59:59Z");
const datedEntry = {
	...entry,
	added: "2026-10-18",
	run: "https://github.com/example/studio/actions/runs/12345",
	backlog: "Run 12345; expire 2026-11-01",
};

test("dated additions pass from an empty or absent base and from a plain entry", () => {
	for (const previous of [undefined, [], [entry]])
		for (const run of [12345, "12345", datedEntry.run])
			assert.doesNotThrow(() => validateAllowlist([{ ...datedEntry, run }], previous, today));
});

test("dated entries require all three fields, even when the key was plain", () => {
	for (const field of ["added", "run", "backlog"]) {
		const partial = { ...datedEntry };
		delete partial[field];
		for (const previous of [undefined, [], [entry]])
			assert.throws(
				() => validateAllowlist([partial], previous, today),
				/may only shrink.*added, run and backlog/,
				field,
			);
	}
});

test("dated entries refuse malformed calendar dates and future dates", () => {
	for (const added of [
		"",
		null,
		20261018,
		"2026-1-18",
		"2026-02-30",
		"2026-13-01",
		"2026-10-18T00:00:00Z",
	])
		assert.throws(
			() => validateAllowlist([{ ...datedEntry, added }], undefined, today),
			/added must be an ISO date/,
			String(added),
		);
	assert.throws(
		() => validateAllowlist([{ ...datedEntry, added: "2026-10-19" }], [], today),
		/added must not be in the future/,
	);
	assert.doesNotThrow(() =>
		validateAllowlist(
			[{ ...datedEntry, added: "2024-02-29" }],
			[],
			Date.parse("2024-03-14T00:00:00Z"),
		),
	);
});

test("dated entries require a GitHub Actions run URL or positive numeric run ID", () => {
	for (const run of [
		"",
		null,
		0,
		-1,
		1.5,
		Number.MAX_SAFE_INTEGER + 1,
		"0",
		"123x",
		"http://github.com/example/studio/actions/runs/12345",
		"https://example.com/example/studio/actions/runs/12345",
		"https://github.com/example/studio/pull/12345",
		"https://github.com/example/studio/actions/runs/nope",
	])
		assert.throws(
			() => validateAllowlist([{ ...datedEntry, run }], undefined, today),
			/run must be a GitHub Actions run URL or numeric run ID/,
			String(run),
		);
	for (const backlog of ["", "   ", null, 123])
		assert.throws(
			() => validateAllowlist([{ ...datedEntry, backlog }], [], today),
			/backlog pointer is required/,
		);
});

test("dated entries still require valid file, name and reason and stay unique", () => {
	for (const [field, value, message] of [
		["file", "../slow.test.ts", /repo-relative/],
		["name", " ", /name is required/],
		["reason", " ", /reason is required/],
	])
		assert.throws(() => validateAllowlist([{ ...datedEntry, [field]: value }], [], today), message);
	assert.throws(() => validateAllowlist([datedEntry, datedEntry], [], today), /Duplicate/);
});

test("dated entries expire after 14 UTC calendar days regardless of the base", () => {
	const expired = { ...datedEntry, added: "2026-10-03" };
	for (const previous of [undefined, [], [expired]])
		assert.throws(() => validateAllowlist([expired], previous, today), {
			message:
				'Slow-test entry expired after 14 days: ["apps/desktop/src/slow.test.ts","suite > slow"]; fix the test or re-add it deliberately with a new date and run',
		});
	assert.doesNotThrow(() => validateAllowlist([{ ...datedEntry, added: "2026-10-04" }], [], today));
	assert.doesNotThrow(() => validateAllowlist([expired], [], Date.parse("2026-10-17T23:59:59Z")));
	assert.throws(
		() => validateAllowlist([expired], [], Date.parse("2026-10-18T00:00:00Z")),
		/expired after 14 days/,
	);
});

test("re-adding an expired entry requires a new date and a different run", () => {
	const expired = { ...datedEntry, added: "2026-10-03" };
	assert.doesNotThrow(() => validateAllowlist([{ ...datedEntry, run: "67890" }], [expired], today));
	assert.doesNotThrow(() => validateAllowlist([datedEntry], [datedEntry], today));
	for (const run of [datedEntry.run, 12345, "12345"])
		assert.throws(
			() => validateAllowlist([{ ...datedEntry, run }], [expired], today),
			/new added date requires a different run/,
		);
});

test("an existing dated entry cannot become plain to escape expiry", () => {
	assert.throws(
		() => validateAllowlist([entry], [{ ...datedEntry, added: "2026-10-03" }], today),
		/dated metadata cannot be removed/,
	);
});

test("plain additions stay shrink-only and removing plain or expired entries always passes", () => {
	assert.throws(() => validateAllowlist([entry], [], today), /may only shrink/);
	assert.doesNotThrow(() => validateAllowlist([entry], [entry], today));
	assert.doesNotThrow(() => validateAllowlist([], [entry], today));
	assert.doesNotThrow(() => validateAllowlist([], [{ ...datedEntry, added: "2026-10-03" }], today));
});

test("checked-in allowlist has reasons and permits only dated additions relative to the CI base", () => {
	const current = JSON.parse(readFileSync(resolve(root, "scripts/slow-tests.json"), "utf8"));
	let previous;
	if (process.env.CI === "true") {
		const base = process.env.SLOW_TESTS_BASE;
		assert.ok(base, "CI must supply the PR base or pre-push commit for the shrink check");
		// An absent list is the one-time bootstrap, not a reason to ignore Git errors.
		const files = execFileSync(
			"git",
			["ls-tree", "--name-only", base, "--", "scripts/slow-tests.json"],
			{ cwd: root, encoding: "utf8" },
		);
		if (files.trim())
			previous = JSON.parse(
				execFileSync("git", ["show", `${base}:scripts/slow-tests.json`], {
					cwd: root,
					encoding: "utf8",
				}),
			);
	}
	validateAllowlist(current, previous);
});

const task = (file, name, duration) => ({
	module: {
		moduleId: resolve(root, file),
		project: {
			name: "desktop",
			config: { root: resolve(root, "apps/desktop") },
			vite: { config: { configFile: resolve(root, "apps/desktop/vitest.config.ts") } },
		},
	},
	name,
	parent: { type: "module" },
	fullName: name,
	diagnostic: () => ({ duration }),
});

async function checkConfirmation(
	initial,
	{
		duration = 180,
		status = 0,
		assertions,
		error,
		writeReport = true,
		reportOnError = false,
		stderr = "",
		reportedFile,
		reportOnly,
		jobDeadline,
		now,
		afterRun,
		viaReporter = false,
		unhandledErrors = [],
	} = {},
) {
	const initialTests = Array.isArray(initial) ? initial : [initial];
	const calls = [];
	const logs = [];
	const oldCI = process.env.CI;
	const oldCode = process.exitCode;
	const oldReportOnly = process.env.SLOW_TESTS_REPORT_ONLY;
	const oldDeadline = process.env.CI_JOB_DEADLINE_MS;
	if (jobDeadline === undefined) delete process.env.CI_JOB_DEADLINE_MS;
	else process.env.CI_JOB_DEADLINE_MS = jobDeadline;
	if (reportOnly === undefined) delete process.env.SLOW_TESTS_REPORT_ONLY;
	else process.env.SLOW_TESTS_REPORT_ONLY = reportOnly;
	const run = (executable, args, options) => {
		calls.push({ executable, args, options });
		afterRun?.(options);
		if (error && !reportOnError) return { status: null, error };
		if (writeReport) {
			const results =
				assertions ??
				initialTests
					.filter((initial) => initial.module.moduleId === args.at(-1))
					.map((initial) => ({ fullName: initial.fullName, status: "passed", duration }));
			writeFileSync(
				args.find((arg) => arg.startsWith("--outputFile=")).slice("--outputFile=".length),
				JSON.stringify({
					unhandledErrors,
					testResults: [
						{
							name: reportedFile ?? args.at(-1),
							status: results.some((result) => result.status === "failed") ? "failed" : "passed",
							assertionResults: results.map((result) => ({
								retryCount: 0,
								repeatCount: 0,
								...result,
								ancestorTitles: result.ancestorTitles ?? [],
								title: result.title ?? result.fullName,
							})),
						},
					],
				}),
			);
		}
		return { status, error, stdout: "", stderr };
	};
	const logger = { error: (message) => logs.push(message), log: (message) => logs.push(message) };
	try {
		if (viaReporter) {
			delete process.env.CI;
			const reporter = new SlowTestsReporter(run, now);
			reporter.onInit({ config: { root }, logger });
			for (const initial of initialTests) reporter.onTestCaseResult(initial);
			await reporter.onTestRunEnd();
		} else if (
			await confirmSlowTests(
				{
					root,
					violations: initialTests.map((initial) => ({
						nameParts: [initial.fullName],
						entry: {
							file: initial.module.moduleId.slice(root.length + 1).replaceAll("\\", "/"),
							name: initial.fullName,
						},
						duration: initial.diagnostic().duration,
						moduleId: initial.module.moduleId,
						projectRoot: initial.module.project.config.root,
						projectName: initial.module.project.name,
						configFile: initial.module.project.vite.config.configFile,
					})),
				},
				{ run, now, logger, cleanup() {} },
			)
		)
			process.exitCode = 1;
		return { calls, logs: logs.join("\n"), code: process.exitCode };
	} finally {
		if (oldCI === undefined) delete process.env.CI;
		else process.env.CI = oldCI;
		process.exitCode = oldCode;
		if (oldDeadline === undefined) delete process.env.CI_JOB_DEADLINE_MS;
		else process.env.CI_JOB_DEADLINE_MS = oldDeadline;
		if (oldReportOnly === undefined) delete process.env.SLOW_TESTS_REPORT_ONLY;
		else process.env.SLOW_TESTS_REPORT_ONLY = oldReportOnly;
	}
}

test("only the explicit report-only switch makes timings advisory; failures stay fatal", async () => {
	for (const reportOnly of [undefined, "false", "1", "true"]) {
		const result = await checkConfirmation(task(entry.file, entry.name, 2109), {
			duration: 4500,
			reportOnly,
		});
		assert.equal(result.code, reportOnly === "true" ? undefined : 1);
		assert.match(result.logs, /budget exceeded.*4500 ms alone/s);
	}
	const allowed = JSON.parse(readFileSync(resolve(root, "scripts/slow-tests.json"), "utf8"))[0];
	const result = await checkConfirmation(task(allowed.file, allowed.name, 4500), {
		reportOnly: "true",
		viaReporter: true,
	});
	assert.match(result.logs, /Slow-test timing:.*4500 ms in shard/);
	assert.equal(result.calls.length, 0);
	for (const options of [
		{ status: 1, assertions: [{ fullName: entry.name, status: "failed", duration: 80 }] },
		{ error: new Error("planted infrastructure failure") },
	])
		assert.equal(
			(
				await checkConfirmation(task(entry.file, entry.name, 2109), {
					...options,
					reportOnly: "true",
				})
			).code,
			1,
		);
	const oldCode = process.exitCode;
	try {
		process.exitCode = 1;
		assert.equal(
			(
				await checkConfirmation(task(entry.file, entry.name, 2109), {
					duration: 4500,
					reportOnly: "true",
				})
			).code,
			1,
		);
	} finally {
		process.exitCode = oldCode;
	}
});

test("a load spike over budget then under passes after a one-worker file confirmation", async () => {
	const result = await checkConfirmation(task(entry.file, "slow [busy]. (once+)", 2109));
	assert.equal(result.code, undefined);
	assert.equal(result.calls.length, 1);
	assert.equal(result.calls[0].executable, process.execPath);
	assert.equal(result.calls[0].options.timeout, 120000);
	assert.equal(result.calls[0].options.killSignal, "SIGKILL");
	assert.ok(result.calls[0].args.includes("--maxWorkers=1"));
	assert.ok(result.calls[0].args.includes("--no-file-parallelism"));
	assert.ok(result.calls[0].args.includes("--project=desktop"));
	assert.ok(result.calls[0].args.includes(resolve(root, "apps/desktop/vitest.config.ts")));
	assert.ok(result.calls[0].args.includes(`--root=${resolve(root, "apps/desktop")}`));
	assert.ok(
		result.calls[0].args.includes(
			`--testNamePattern=^(?:${RegExp.escape("slow [busy]. (once+)")})$`,
		),
	);
	assert.ok(result.calls[0].args.includes(resolve(root, entry.file)));
	assert.ok(result.calls[0].args.every((arg) => !arg.startsWith("--shard")));
	assert.match(result.logs, /passed alone.*2109.*180/s);
});

test("slow tests in one project file share one rerun and use their own durations", async () => {
	const result = await checkConfirmation(
		[task(entry.file, "first", 2109), task(entry.file, "second", 2517)],
		{
			assertions: [
				{ fullName: "first", status: "passed", duration: 180 },
				{ fullName: "second", status: "passed", duration: 2100 },
			],
		},
	);
	assert.equal(result.calls.length, 1);
	assert.equal(result.code, 1);
	assert.match(result.logs, /passed alone:.*first.*180 ms alone/s);
	assert.match(result.logs, /budget exceeded.*second.*2100 ms alone/s);
});

test("confirmation has one three-minute deadline and names every unfinished file", async () => {
	for (const reportOnly of [undefined, "true"]) {
		let elapsed = 0;
		const result = await checkConfirmation(
			[
				task(entry.file, "slow", 2109),
				task("apps/desktop/src/second.test.ts", "slow", 2109),
				task("apps/desktop/src/third.test.ts", "slow", 2109),
			],
			{
				now: () => elapsed,
				afterRun: (options) => {
					elapsed += options.timeout;
				},
				reportOnly,
			},
		);
		assert.equal(result.calls.length, 2);
		assert.deepEqual(
			result.calls.map(({ options }) => options.timeout),
			[120000, 60000],
		);
		assert.equal(result.code, reportOnly === "true" ? undefined : 1);
		assert.match(
			result.logs,
			reportOnly === "true"
				? /::warning::.*third\.test/s
				: /confirmation infrastructure failed.*third\.test/s,
		);
		assert.match(
			result.logs,
			/confirmation deadline exceeded \(180000 ms maximum or CI job deadline\)/,
		);
	}
});

test("confirmation stops at the job deadline and names every unconfirmed file", async () => {
	for (const reportOnly of [undefined, "true"]) {
		let now = 1700000000000;
		const result = await checkConfirmation(
			[task(entry.file, "slow", 2109), task("apps/desktop/src/second.test.ts", "slow", 2109)],
			{
				jobDeadline: "1700000010000",
				now: () => now,
				afterRun: (options) => {
					now += options.timeout;
				},
				error: new Error("spawnSync ETIMEDOUT"),
				reportOnly,
			},
		);
		assert.deepEqual(
			result.calls.map(({ options }) => options.timeout),
			[10000],
		);
		assert.equal(result.code, 1);
		assert.match(result.logs, /slow\.test.ts, confirmation could not run/);
		assert.match(result.logs, /second\.test.ts, confirmation deadline exceeded/);
	}
});

test("a timed-out rerun leaves every remaining file unconfirmed", async () => {
	let elapsed = 0;
	const result = await checkConfirmation(
		[
			task(entry.file, "slow", 2109),
			task("apps/desktop/src/second.test.ts", "slow", 2109),
			task("apps/desktop/src/third.test.ts", "slow", 2109),
		],
		{
			now: () => elapsed,
			afterRun: ({ timeout }) => {
				elapsed += timeout;
			},
			error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }),
		},
	);
	assert.deepEqual(
		{
			timeouts: result.calls.map(({ options }) => options.timeout),
			code: result.code,
			logs: result.logs,
		},
		{
			timeouts: [120000],
			code: 1,
			logs:
				"Confirming slow tests in file: apps/desktop/src/slow.test.ts\n" +
				"Slow-test confirmation infrastructure failed:\n" +
				"apps/desktop/src/slow.test.ts, confirmation could not run: slow: spawnSync ETIMEDOUT\n" +
				"apps/desktop/src/second.test.ts, previous confirmation timed out; slow tests remain unconfirmed: slow\n" +
				"apps/desktop/src/third.test.ts, previous confirmation timed out; slow tests remain unconfirmed: slow",
		},
	);
});

test("report-only confirmation timeout warns for every unconfirmed file and preserves earlier failures", async () => {
	for (const viaReporter of [false, true]) {
		const result = await checkConfirmation(
			[task(entry.file, "slow", 2109), task("apps/desktop/src/second.test.ts", "slow", 2109)],
			{
				error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }),
				reportOnly: "true",
				viaReporter,
			},
		);
		assert.equal(result.code, undefined);
		assert.equal(result.calls.length, 1);
		for (const file of ["slow.test.ts", "second.test.ts"])
			assert.ok(
				result.logs
					.split("\n")
					.some((line) => line.startsWith("::warning::") && line.includes(file)),
				result.logs,
			);
	}
	const oldCode = process.exitCode;
	try {
		process.exitCode = 1;
		assert.equal(
			(
				await checkConfirmation(task(entry.file, "slow", 2109), {
					error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }),
					reportOnly: "true",
					viaReporter: true,
				})
			).code,
			1,
		);
	} finally {
		process.exitCode = oldCode;
	}
});

test("report-only confirmation assertion and five-second test timeout failures remain fatal", async () => {
	for (const stderr of ["planted assertion failure", "Test timed out in 5000ms"]) {
		const result = await checkConfirmation(task(entry.file, "slow", 5100), {
			status: 1,
			assertions: [{ fullName: "slow", status: "failed", duration: 5000 }],
			stderr,
			reportOnly: "true",
		});
		assert.equal(result.code, 1);
		assert.match(result.logs, /confirmation failed/);
		assert.ok(result.logs.includes(stderr));
	}
});

test("report-only emits one warning containing every unconfirmed file beyond ten annotations", async () => {
	const files = Array.from(
		{ length: 12 },
		(_, index) => `apps/desktop/src/unconfirmed-${index}.test.ts`,
	);
	const result = await checkConfirmation(
		files.map((file) => task(file, "slow", 2109)),
		{
			error: Object.assign(new Error("spawn ETIMEDOUT"), { code: "ETIMEDOUT" }),
			reportOnly: "true",
		},
	);
	assert.equal(result.code, undefined);
	const warnings = result.logs.split("\n").filter((line) => line.startsWith("::warning::"));
	assert.equal(warnings.length, 1);
	for (const file of files) assert.ok(warnings[0].includes(file), file);
});

test("a confirmation timeout cannot hide a completed failing or invalid report", async () => {
	for (const options of [
		{ assertions: [{ fullName: "slow", status: "failed", duration: 5000 }] },
		{ unhandledErrors: [{ message: "planted infrastructure" }] },
		{ reportedFile: resolve(root, "apps/desktop/wrong.test.ts") },
	]) {
		const result = await checkConfirmation(task(entry.file, "slow", 5100), {
			...options,
			error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }),
			reportOnError: true,
			reportOnly: "true",
		});
		assert.equal(result.code, 1);
	}
	const result = await checkConfirmation(task(entry.file, "slow", 2109), {
		error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }),
		reportOnError: true,
		reportOnly: "true",
	});
	assert.equal(result.code, undefined);
	assert.match(result.logs, /::warning::.*slow.test.ts/);
});

test("an infrastructure exception named ETIMEDOUT remains fatal in report-only mode", async () => {
	const result = await checkConfirmation(task(entry.file, "slow", 2109), {
		afterRun: () => {
			throw Object.assign(new Error("infrastructure timeout"), { code: "ETIMEDOUT" });
		},
		reportOnly: "true",
	});
	assert.equal(result.code, 1);
	assert.match(result.logs, /infrastructure failed/);
	assert.doesNotMatch(result.logs, /::warning::/);
});

test("confirmation refuses a different file even when its test name matches", async () => {
	const result = await checkConfirmation(task(entry.file, "same name", 2109), {
		reportedFile: resolve(root, "apps/desktop/src/other.test.ts"),
	});
	assert.equal(result.code, 1);
	assert.match(result.logs, /confirmation must report exactly the selected file/);
});

test("over budget on both runs fails, including a genuinely regressed test", async () => {
	for (const duration of [2517, 4500]) {
		const result = await checkConfirmation(task(entry.file, entry.name, 2109), { duration });
		assert.equal(result.calls.length, 1);
		assert.equal(result.code, 1);
		assert.match(result.logs, /Slow-test budget exceeded.*2109/s);
		assert.match(result.logs, new RegExp(`${duration} ms`));
	}
});

test("reporter permits both exact budget boundaries and matches allowlist file plus name", async () => {
	assert.equal(
		(await checkConfirmation(task(entry.file, entry.name, 2000), { viaReporter: true })).calls
			.length,
		0,
	);
	assert.equal(
		(
			await checkConfirmation(task(entry.file, entry.name, 2001), {
				duration: 2000,
				viaReporter: true,
			})
		).code,
		undefined,
	);
	const allowed = JSON.parse(readFileSync(resolve(root, "scripts/slow-tests.json"), "utf8"))[0];
	assert.ok(allowed, "Seed the list from measured Linux test durations");
	assert.equal(
		(await checkConfirmation(task(allowed.file, allowed.name, 5000), { viaReporter: true })).calls
			.length,
		0,
	);
	assert.equal(
		(
			await checkConfirmation(task(allowed.file, `${allowed.name} changed`, 2001), {
				viaReporter: true,
			})
		).calls.length,
		1,
	);
	assert.equal(
		(await checkConfirmation(task(entry.file, allowed.name, 2001), { viaReporter: true })).calls
			.length,
		1,
	);
});

test("failed, hung, skipped or unmeasured confirmations cannot clear a slow test", async () => {
	for (const options of [
		{ status: 1 },
		{ error: new Error("spawnSync ETIMEDOUT") },
		{ assertions: [] },
		{ assertions: [{ fullName: entry.name, status: "skipped", duration: 0 }] },
		{ assertions: [{ fullName: entry.name, status: "passed" }] },
	]) {
		const result = await checkConfirmation(task(entry.file, entry.name, 2109), options);
		assert.equal(result.code, 1);
		assert.equal(result.calls.length, 1);
	}
	const oldCode = process.exitCode;
	try {
		process.exitCode = 1;
		assert.equal((await checkConfirmation(task(entry.file, entry.name, 2109))).code, 1);
	} finally {
		process.exitCode = oldCode;
	}
});

test("confirmation infrastructure errors fail without reporting a budget violation", async () => {
	for (const options of [
		{ error: new Error("confirmation config could not load") },
		{ status: 1, writeReport: false, stderr: "confirmation config could not load" },
	]) {
		const result = await checkConfirmation(task(entry.file, entry.name, 2109), options);
		assert.equal(result.code, 1);
		assert.match(result.logs, /confirmation infrastructure failed.*config could not load/s);
		assert.doesNotMatch(result.logs, /Slow-test budget exceeded/);
	}
});

test("a failing confirmation test is reported separately from infrastructure and budgets", async () => {
	const result = await checkConfirmation(task(entry.file, entry.name, 2109), {
		status: 1,
		assertions: [{ fullName: entry.name, status: "failed", duration: 80 }],
		stderr: "planted assertion",
	});
	assert.equal(result.code, 1);
	assert.match(result.logs, /Slow-test confirmation failed.*test failed alone.*planted assertion/s);
	assert.doesNotMatch(result.logs, /budget exceeded|infrastructure failed/);
});

function spawnShard(args, options) {
	const env = {
		...options.env,
		GITHUB_ACTIONS: "true",
		SLOW_TESTS_PROCESS_GROUPS_FILE: `${options.env.SLOW_TESTS_PENDING_FILE}.groups`,
	};
	return spawnSync(
		process.platform === "linux" ? "bash" : process.execPath,
		process.platform === "linux"
			? [resolve(root, "scripts/run-vitest-isolated.sh"), process.execPath, ...args]
			: args,
		{ ...options, env },
	);
}

function finishCI(result, pendingFile, trace = false) {
	assert.equal(result.error, undefined, "Shard must exit before confirmation starts");
	assert.notEqual(result.status, null, "Shard must exit normally before confirmation starts");
	if (!existsSync(pendingFile)) return result;
	const confirmation = spawnSync(
		process.execPath,
		trace
			? [
					"--input-type=module",
					"--eval",
					`
import { spawnSync } from "node:child_process";
import { confirmSlowTests, readPendingSlowTests } from ${JSON.stringify(pathToFileURL(resolve(root, "scripts/confirm-slow-tests.mjs")).href)};
if (await confirmSlowTests(readPendingSlowTests(${JSON.stringify(pendingFile)}), { run: (...args) => {
  console.log("Confirmation command:", JSON.stringify(args[1]));
  return spawnSync(...args);
} })) process.exitCode = 1;`,
				]
			: [resolve(root, "scripts/confirm-slow-tests.mjs"), pendingFile],
		{
			cwd: root,
			env: {
				...process.env,
				CI: "true",
				GITHUB_ACTIONS: "true",
				SLOW_TESTS_REPORT_ONLY: "false",
				SLOW_TESTS_PROCESS_GROUPS_FILE: `${pendingFile}.groups`,
			},
			encoding: "utf8",
			timeout: 60000,
			windowsHide: true,
		},
	);
	assert.equal(confirmation.error, undefined, "Confirmation process must exit");
	assert.notEqual(confirmation.status, null);
	return {
		status: result.status || confirmation.status,
		stdout: result.stdout + confirmation.stdout,
		stderr: result.stderr + confirmation.stderr,
	};
}

for (const [project, relativeFile, name] of [
	[
		"desktop",
		"apps/desktop/src/main/__tests__/preview-scheduler-regressions.test.ts",
		"review: continuous edits must not starve trailing compile",
	],
	[
		"desktop",
		"apps/desktop/src/main/__tests__/project-text-file.test.ts",
		"preserves both refusal and cleanup errors without acknowledging a failed stage",
	],
	[
		"editor-core",
		"packages/editor-core/src/__tests__/parse-debounce.test.tsx",
		"PraxityEditor parse debouncing > parses immediately on initial load",
	],
	[
		"desktop",
		"apps/desktop/src/main/__tests__/identity-store-parallel.test.ts",
		"reads independent store files concurrently, with a fixed cap and fresh result ordering",
	],
]) {
	test(`real workspace reporter confirms ${relativeFile} with intact mocks`, () => {
		// Force only the shard diagnostic; the unchanged confirmation file measures real tests.
		const file = resolve(root, relativeFile);
		const projectRoot = resolve(
			root,
			project === "desktop" ? "apps/desktop" : "packages/editor-core",
		);
		const pendingDir = mkdtempSync(resolve(tmpdir(), "slow-workspace-"));
		const pendingFile = resolve(pendingDir, "pending.json");
		try {
			const shard = spawnShard(
				[
					"--input-type=module",
					"--eval",
					`import assert from "node:assert/strict";
import { createVitest } from "vitest/node";
const ctx = await createVitest("test", {
  root: ${JSON.stringify(root)}, config: ${JSON.stringify(resolve(root, "vitest.workspace.ts"))},
  project: [${JSON.stringify(project)}], testNamePattern: ${JSON.stringify(`^${name.replaceAll(" > ", " ")}$`)},
  maxWorkers: 1, fileParallelism: false, watch: false,
});
try {
  const reporter = ctx.reporters.find(reporter => reporter.constructor.name === "SlowTestsReporter");
  assert.ok(reporter, "Use the reporter loaded by the real workspace config");
  const onResult = reporter.onTestCaseResult;
  reporter.onTestCaseResult = function(test) {
    if (test.fullName !== ${JSON.stringify(name)}) return;
    assert.equal(test.module.project.name, ${JSON.stringify(project)});
    assert.equal(test.result().state, "passed", "The real original test must pass");
    const diagnostic = test.diagnostic.bind(test);
    test.diagnostic = () => ({ ...diagnostic(), duration: 2109 });
    onResult.call(this, test);
  };
  reporter.run = () => assert.fail("Confirmation started before the shard process exited");
  await ctx.start([${JSON.stringify(file)}]);
} finally { await ctx.close(); }`,
				],
				{
					cwd: root,
					env: {
						...process.env,
						CI: "true",
						SLOW_TESTS_REPORT_ONLY: "false",
						SLOW_TESTS_PENDING_FILE: pendingFile,
					},
					encoding: "utf8",
					timeout: 60000,
					windowsHide: true,
				},
			);
			const result = finishCI(shard, pendingFile, true);
			const output = result.stdout + result.stderr;
			assert.equal(result.status, 0, output);
			assert.ok(
				output.includes(`Slow test passed alone: ${relativeFile} > ${name}: 2109 ms in shard`),
				output,
			);
			assert.equal(output.split("Confirmation command: ").length - 1, 1, output);
			const command = JSON.parse(
				output
					.split("\n")
					.find((line) => line.startsWith("Confirmation command: "))
					.slice("Confirmation command: ".length),
			);
			assert.equal(
				command[command.indexOf("--config") + 1].replaceAll("\\", "/"),
				resolve(projectRoot, "vitest.config.ts").replaceAll("\\", "/"),
			);
			assert.ok(command.includes(`--project=${project}`));
			assert.ok(
				command
					.map((arg) => arg.replaceAll("\\", "/"))
					.includes(`--root=${projectRoot.replaceAll("\\", "/")}`),
			);
			assert.ok(command.some((arg) => arg.startsWith("--testNamePattern=")));
			assert.doesNotMatch(output, /budget exceeded|infrastructure failed|failed alone/);
		} finally {
			rmSync(pendingDir, { recursive: true });
		}
	});
}

test("a planted slow Vitest test fails CI through the real workspace reporter, but passes locally", () => {
	const dir = mkdtempSync(resolve(tmpdir(), "slow-budget-"));
	try {
		symlinkSync(resolve(root, "node_modules"), resolve(dir, "node_modules"), "junction");
		writeFileSync(
			resolve(dir, "planted.test.ts"),
			'import { test } from "vitest"; test("planted slow violation", async () => { await new Promise(resolve => setTimeout(resolve, 2100)); });',
		);
		writeFileSync(
			resolve(dir, "vitest.config.mts"),
			`import config from ${JSON.stringify(pathToFileURL(resolve(root, "vitest.workspace.ts")).href)}; export default { ...config, root: ${JSON.stringify(dir)}, test: { ...config.test, projects: undefined, include: ["planted.test.ts"] } };`,
		);
		const run = (ci, reportOnly = "false") =>
			spawnShard(
				[
					resolve(root, "node_modules/vitest/vitest.mjs"),
					"run",
					"--config",
					resolve(dir, "vitest.config.mts"),
					"--maxWorkers=1",
				],
				{
					cwd: root,
					env: {
						...process.env,
						CI: ci,
						SLOW_TESTS_REPORT_ONLY: reportOnly,
						SLOW_TESTS_PENDING_FILE: resolve(dir, "pending.json"),
					},
					encoding: "utf8",
					timeout: 30000,
					windowsHide: true,
				},
			);
		const ci = finishCI(run("true"), resolve(dir, "pending.json"));
		rmSync(resolve(dir, "pending.json"));
		assert.equal(ci.status, 1, ci.stdout + ci.stderr);
		assert.match(ci.stdout + ci.stderr, /Slow-test budget.*planted slow violation/s);
		const advisory = run("true", "true");
		assert.equal(advisory.status, 0, advisory.stdout + advisory.stderr);
		assert.match(advisory.stdout + advisory.stderr, /Slow-test timing:.*planted slow violation/s);
		const local = run("false");
		assert.equal(local.status, 0, local.stdout + local.stderr);
		writeFileSync(
			resolve(dir, "planted.test.ts"),
			'import { test } from "vitest"; test("planted correctness failure", () => { throw new Error("planted assertion"); });',
		);
		const failed = run("true", "true");
		assert.equal(failed.status, 1, failed.stdout + failed.stderr);
		assert.match(failed.stdout + failed.stderr, /planted assertion/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

for (const mode of ["load", "hang", "assertion", "original assertion", "cjs config", "mixed"]) {
	test(`real workspace confirmation handles ${mode}, nested names and unrelated tests`, () => {
		const dir = mkdtempSync(resolve(tmpdir(), "slow-budget-"));
		const marker = resolve(dir, "runs.txt");
		const configPath = resolve(
			dir,
			mode === "cjs config" ? "vitest.config.cts" : "vitest.config.mts",
		);
		try {
			symlinkSync(resolve(root, "node_modules"), resolve(dir, "node_modules"), "junction");
			writeFileSync(
				resolve(dir, "planted.test.ts"),
				`import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const marker = ${JSON.stringify(marker)};
const count = existsSync(marker) ? Number(readFileSync(marker, "utf8")) : 0;
describe("budget > [busy]", () => {
  test("planted slow (once+)", async () => {
    writeFileSync(marker, String(count + 1));
    if (count > 0 && ${JSON.stringify(mode)} === "assertion") throw new Error("planted assertion");
    if (count > 0 && ${JSON.stringify(mode)} === "hang") await new Promise(() => {});
    if (count > 0 && ${JSON.stringify(mode)} === "mixed") {
      setImmediate(() => { throw new Error("planted infrastructure"); });
      await new Promise(resolve => setImmediate(resolve));
      expect("planted assertion").toBe("expected");
    }
    if (count === 0) await new Promise(resolve => setTimeout(resolve, 2100));
    if (count === 0 && ${JSON.stringify(mode)} === "original assertion") throw new Error("original assertion");
  }, count > 0 ? 100 : 5000);
  test("sibling", () => { writeFileSync(${JSON.stringify(resolve(dir, "sibling.txt"))}, String(count + 1)); });
});`,
			);
			writeFileSync(
				configPath,
				`import config from ${JSON.stringify(pathToFileURL(resolve(root, "vitest.workspace.ts")).href)};
export default { ...config, root: ${JSON.stringify(dir)}, test: { ...config.test,
  projects: undefined, name: "budget-fixture", include: ["planted.test.ts"] } };`,
			);
			const shard = spawnShard(
				[
					resolve(root, "node_modules/vitest/vitest.mjs"),
					"run",
					"--config",
					configPath,
					"--shard=1/1",
					"--maxWorkers=1",
				],
				{
					cwd: root,
					env: {
						...process.env,
						CI: "true",
						SLOW_TESTS_REPORT_ONLY: "false",
						SLOW_TESTS_PENDING_FILE: resolve(dir, "pending.json"),
					},
					encoding: "utf8",
					timeout: 30000,
					windowsHide: true,
				},
			);
			const result = finishCI(shard, resolve(dir, "pending.json"));
			const output = result.stdout + result.stderr;
			assert.equal(result.status, mode === "load" || mode === "cjs config" ? 0 : 1, output);
			assert.equal(readFileSync(marker, "utf8"), "2", output);
			assert.equal(
				readFileSync(resolve(dir, "sibling.txt"), "utf8"),
				"1",
				"Confirmation must skip the sibling",
			);
			assert.match(
				output,
				mode === "load" || mode === "cjs config" || mode === "original assertion"
					? /passed alone/
					: /failed alone/,
			);
			if (mode === "hang") assert.match(output, /Test timed out in 100ms/);
			if (mode === "assertion") assert.match(output, /planted assertion/);
			if (mode === "original assertion") assert.match(output, /original assertion/);
			if (mode === "mixed") {
				assert.match(output, /Slow-test confirmation failed:.*planted assertion/s);
				assert.match(
					output,
					/Slow-test confirmation infrastructure failed:.*planted infrastructure/s,
				);
				assert.doesNotMatch(output, /Slow-test budget exceeded/);
			}
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
}

for (const scenario of [
	"cold",
	"timeout",
	"assertion",
	"sibling assertion",
	"infrastructure",
	"directory alias",
]) {
	test(`targeted confirmation preserves cold fixtures and failures: ${scenario}`, async () => {
		const mode = scenario === "directory alias" ? "cold" : scenario;
		const scratch = mkdtempSync(resolve(tmpdir(), "slow-file-"));
		let dir = scratch;
		if (scenario === "directory alias") {
			mkdirSync(resolve(scratch, "actual"));
			dir = resolve(scratch, "alias");
			symlinkSync(resolve(scratch, "actual"), dir, "junction");
		}
		const file = resolve(dir, "planted.test.ts");
		const configFile = resolve(dir, "vitest.config.mts");
		const marker = resolve(dir, "runs.jsonl");
		const logs = [];
		const calls = [];
		const oldCode = process.exitCode;
		try {
			symlinkSync(resolve(root, "node_modules"), resolve(dir, "node_modules"), "junction");
			writeFileSync(
				resolve(dir, "fixture.ts"),
				`let runs = 0;
export async function next() {
  const count = ++runs;
  if (count === 1 && ${JSON.stringify(mode)} === "cold") await new Promise(resolve => setTimeout(resolve, 2100));
  return count;
}`,
			);
			writeFileSync(
				configFile,
				`export default { root: ${JSON.stringify(dir)}, test: { name: "file-fixture", include: ["planted.test.ts"] } };`,
			);
			writeFileSync(
				file,
				`import { test } from "vitest";
import { appendFileSync } from "node:fs";
import { next } from "./fixture";
const mode = ${JSON.stringify(mode)};
async function visit(title) {
  const count = await next();
  appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid, count, title }) + "\\n");
}
test("warm fixture", async () => {
  await visit("warm fixture");
  if (mode === "sibling assertion") throw new Error("planted sibling assertion");
});
for (const title of ["process fixture", "second fixture"]) test(title, async () => {
  await visit(title);
  if (title !== "process fixture") return;
  if (mode === "assertion") throw new Error("planted assertion");
  if (mode === "timeout") await new Promise(() => {});
  if (mode === "infrastructure") {
    setImmediate(() => { throw new Error("planted infrastructure"); });
    await new Promise(resolve => setImmediate(resolve));
  }
}, mode === "timeout" ? 100 : 5000);`,
			);
			if (
				await confirmSlowTests(
					{
						root,
						violations: ["process fixture", "second fixture"].map((name) => ({
							nameParts: [name],
							entry: { file: "apps/desktop/src/slow.test.ts", name },
							duration: 2109,
							moduleId: file,
							projectRoot: dir,
							projectName: "file-fixture",
							configFile,
						})),
					},
					{
						run: (...args) => {
							calls.push(args);
							return spawnSync(...args);
						},
						logger: {
							log: (message) => logs.push(message),
							error: (message) => logs.push(message),
						},
						reportOnly: false,
						cleanup() {},
					},
				)
			)
				process.exitCode = 1;
			const output = logs.join("\n");
			assert.equal(process.exitCode, mode === "sibling assertion" ? undefined : 1, output);
			assert.equal(calls.length, 1, "Slow tests in the same file must share one process");
			const runs = readFileSync(marker, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			assert.deepEqual(
				runs.map((run) => run.count),
				[1, 2],
				output,
			);
			assert.equal(new Set(runs.map((run) => run.pid)).size, 1);
			if (mode === "cold") {
				assert.match(output, /budget exceeded.*process fixture.*ms alone/s);
			} else if (mode === "sibling assertion") {
				assert.equal(output.split("Slow test passed alone: ").length - 1, 2, output);
				assert.doesNotMatch(output, /planted sibling assertion/);
			} else if (mode === "infrastructure") {
				assert.match(output, /confirmation infrastructure failed.*planted infrastructure/s);
				assert.doesNotMatch(output, /Slow-test confirmation failed/);
			} else {
				assert.match(output, /Slow-test confirmation failed.*test failed alone/s);
				assert.doesNotMatch(output, /infrastructure failed/);
				if (mode === "timeout") assert.match(output, /Test timed out in 100ms/);
			}
			if (mode !== "cold") assert.doesNotMatch(output, /budget exceeded/);
		} finally {
			process.exitCode = oldCode;
			rmSync(scratch, { recursive: true });
		}
	});
}

test("confirmation reports simultaneous assertion and infrastructure failures through its interface", async () => {
	const result = await checkConfirmation(task(entry.file, entry.name, 2109), {
		status: 1,
		assertions: [{ fullName: entry.name, status: "failed", duration: 80 }],
		unhandledErrors: [{ message: "planted infrastructure" }],
		stderr: "planted assertion",
	});
	assert.equal(result.code, 1);
	assert.match(result.logs, /Slow-test confirmation failed:.*planted assertion/s);
	assert.match(
		result.logs,
		/Slow-test confirmation infrastructure failed:.*planted infrastructure/s,
	);
	assert.doesNotMatch(result.logs, /budget exceeded/);
});

test("confirmation refuses duplicate targets, negative durations and unmatched names", async () => {
	for (const assertions of [
		[{ fullName: entry.name, status: "passed", duration: -1 }],
		[
			{ fullName: entry.name, status: "passed", duration: 1 },
			{ fullName: entry.name, status: "passed", duration: 2 },
		],
		[{ fullName: "other", status: "passed", duration: 1 }],
	]) {
		const result = await checkConfirmation(task(entry.file, entry.name, 2109), { assertions });
		assert.equal(result.code, 1);
		assert.match(result.logs, /exactly one passing target|unrequested test/);
	}
});

test("confirmation refuses an extra unfinished or dynamically skipped test", async () => {
	for (const extra of [
		{ fullName: "extra", status: "pending" },
		{ fullName: "extra", status: "skipped", duration: 0 },
	]) {
		const result = await checkConfirmation(task(entry.file, "target", 2109), {
			assertions: [{ fullName: "target", status: "passed", duration: 1 }, extra],
		});
		assert.equal(result.code, 1, result.logs);
		assert.match(result.logs, /unrequested test/);
	}
});
