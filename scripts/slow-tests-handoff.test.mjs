import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { readPendingSlowTests } from "./confirm-slow-tests.mjs";
import SlowTestsReporter from "./slow-tests-reporter.mjs";

const root = resolve(import.meta.dirname, "..");

function runNameFixture(files, reportOnly) {
	const dir = mkdtempSync(resolve(tmpdir(), "duplicate-test-names-"));
	try {
		symlinkSync(resolve(root, "node_modules"), resolve(dir, "node_modules"), "junction");
		for (const [file, source] of Object.entries(files)) writeFileSync(resolve(dir, file), source);
		writeFileSync(
			resolve(dir, "vitest.config.mjs"),
			`import SlowTestsReporter from ${JSON.stringify(new URL("./slow-tests-reporter.mjs", import.meta.url).href)};
export default { test: { include: ["*.test.ts"], maxWorkers: 1,
  reporters: ["default", new SlowTestsReporter()] } };`,
		);
		return spawnSync(
			process.execPath,
			[resolve(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.config.mjs"],
			{
				cwd: dir,
				encoding: "utf8",
				windowsHide: true,
				env: { ...process.env, SLOW_TESTS_REPORT_ONLY: reportOnly },
			},
		);
	} finally {
		rmSync(dir, { recursive: true });
	}
}

for (const reportOnly of ["false", "true"]) {
	const mode = reportOnly === "true" ? "report-only" : "gate";
	test(`fast duplicate .each names fail in ${mode} mode`, () => {
		const result = runNameFixture(
			{
				"duplicate.test.ts": `import { describe, test } from "vitest";
describe("commands", () => {
  test.each([["recovery", "restore"], ["recovery", "run"]])("refuses %s", () => {});
});`,
				"distinct.test.ts": `import { describe, test } from "vitest";
describe("commands", () => test("refuses recovery", () => {}));
describe("other", () => test("refuses recovery", () => {}));`,
			},
			reportOnly,
		);
		const output = result.stdout + result.stderr;
		assert.equal(result.error, undefined);
		assert.equal(result.status, 1, output);
		assert.match(output, /Duplicate test name: duplicate\.test\.ts > commands > refuses recovery/);
		assert.doesNotMatch(output, /Duplicate test name: distinct\.test\.ts/);
		assert.doesNotMatch(output, /Slow-test timing|Slow-test budget|confirmation infrastructure/);
	});

	test(`space-joined names fail in ${mode} mode`, () => {
		const result = runNameFixture(
			{
				"duplicate.test.ts": `import { describe, test } from "vitest";
describe("a b", () => test("c", () => {}));
describe("a", () => test("b c", () => {}));`,
			},
			reportOnly,
		);
		const output = result.stdout + result.stderr;
		assert.equal(result.error, undefined);
		assert.equal(result.status, 1, output);
		assert.match(output, /Duplicate test name: duplicate\.test\.ts > a > b c/);
		assert.doesNotMatch(output, /Slow-test timing|Slow-test budget|confirmation infrastructure/);
	});

	test(`identical names in separate files pass in ${mode} mode`, () => {
		const source = 'import { test } from "vitest"; test("same", () => {});';
		const result = runNameFixture(
			{ "first.test.ts": source, "second.test.ts": source },
			reportOnly,
		);
		const output = result.stdout + result.stderr;
		assert.equal(result.error, undefined);
		assert.equal(result.status, 0, output);
		assert.doesNotMatch(output, /Duplicate test name:/);
	});
}

test("real Vitest report-only confirmation keeps worker teardown responsive", () => {
	const dir = mkdtempSync(resolve(tmpdir(), "slow-responsive-"));
	try {
		mkdirSync(resolve(dir, "apps"));
		writeFileSync(
			resolve(dir, "apps/slow.test.js"),
			`test("slow", async () => { await new Promise(resolve => setTimeout(resolve, 2500)); });`,
		);
		writeFileSync(
			resolve(dir, "vitest.config.mjs"),
			`
import SlowTestsReporter from ${JSON.stringify(new URL("./slow-tests-reporter.mjs", import.meta.url).href)};
export default { test: { globals: true, pool: "forks", maxWorkers: 1,
  testTimeout: 5000, teardownTimeout: 500, include: ["apps/**/*.test.js"],
  reporters: ["default", new SlowTestsReporter()] } };
`,
		);
		const result = spawnSync(
			process.execPath,
			[resolve(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.config.mjs"],
			{
				cwd: dir,
				encoding: "utf8",
				windowsHide: true,
				env: {
					...process.env,
					CI: "true",
					SLOW_TESTS_REPORT_ONLY: "true",
					CI_JOB_DEADLINE_MS: String(Date.now() + 180000),
				},
			},
		);
		assert.equal(result.error, undefined);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout + result.stderr, /Slow-test budget exceeded/);
		assert.doesNotMatch(result.stdout + result.stderr, /Timeout terminating forks worker/);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

for (const [scenario, reportOnly, status] of [
	["timeout", true, 0],
	["assertion", true, 1],
	["test timeout", true, 1],
	["timeout then forks", true, 0],
	["forks only", true, 1],
	["timeout", false, 1],
	["original failure", true, 1],
]) {
	test(`${reportOnly ? "report-only" : "gate"} runner exits ${status} for ${scenario}`, () => {
		const result = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				`
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import SlowTestsReporter from ${JSON.stringify(new URL("./slow-tests-reporter.mjs", import.meta.url).href)};
const root = ${JSON.stringify(root)};
const scenario = ${JSON.stringify(scenario)};
const reporter = new SlowTestsReporter((executable, args) => {
  if (!["assertion", "test timeout"].includes(scenario))
    return { error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }) };
  writeFileSync(args.find(arg => arg.startsWith("--outputFile=")).slice("--outputFile=".length), JSON.stringify({
    unhandledErrors: [],
    testResults: [{ name: args.at(-1), status: "failed", message: scenario === "test timeout" ? "Test timed out in 5000ms" : "planted assertion", assertionResults: [{ ancestorTitles: [], title: "slow", status: "failed", duration: 5000 }] }],
  }));
  return { status: 1, stdout: "", stderr: "" };
});
reporter.onInit({ config: { root }, logger: console });
reporter.onTestRunStart();
if (scenario === "original failure") process.exitCode = 1;
if (scenario !== "forks only") {
  for (const file of ["slow.test.ts", "second.test.ts"])
    reporter.onTestCaseResult({ name: "slow", fullName: "slow", diagnostic: () => ({ duration: 5100 }), module: { moduleId: resolve(root, "apps/desktop", file), project: { name: "desktop", config: { root }, vite: { config: { configFile: false } } } } });
  await reporter.onTestRunEnd();
}
if (["timeout then forks", "forks only"].includes(scenario))
  console.error("[vitest-pool]: Timeout terminating forks worker for test files apps/desktop/path-utils.test.ts.");
`,
			],
			{
				cwd: root,
				env: {
					...process.env,
					CI: "false",
					SLOW_TESTS_REPORT_ONLY: String(reportOnly),
					CI_JOB_DEADLINE_MS: String(Date.now() + 180000),
				},
				encoding: "utf8",
				windowsHide: true,
			},
		);
		assert.equal(result.error, undefined);
		assert.equal(result.status, status, result.stdout + result.stderr);
		if (reportOnly && scenario.startsWith("timeout")) {
			for (const file of ["slow.test.ts", "second.test.ts"])
				assert.ok(
					result.stdout
						.split("\n")
						.some((line) => line.startsWith("::warning::") && line.includes(file)),
					result.stdout,
				);
		}
		if (scenario === "test timeout") assert.match(result.stderr, /Test timed out in 5000ms/);
	});
}

test("report-only forks termination warns only after a confirmation timeout in the same run", async () => {
	const savedMode = process.env.SLOW_TESTS_REPORT_ONLY;
	const oldCode = process.exitCode;
	process.env.SLOW_TESTS_REPORT_ONLY = "true";
	try {
		for (const scenario of [
			"timeout",
			"no timeout",
			"failure",
			"test timeout",
			"infrastructure",
			"earlier hang",
			"other worker",
			"other infrastructure",
			"next run",
			"extra error",
		]) {
			process.exitCode = undefined;
			const logs = [];
			const logger = {
				log: (message) => logs.push(message),
				error: (message) => logs.push(message),
			};
			const reporter = new SlowTestsReporter(() => ({
				error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }),
			}));
			reporter.onInit({ config: { root }, logger });
			const hang =
				"[vitest-pool]: Timeout terminating forks worker for test files apps/desktop/path-utils.test.ts.";
			if (scenario === "earlier hang") logger.error(hang);
			if (scenario !== "no timeout") {
				reporter.onTestCaseResult({
					fullName: "slow",
					name: "slow",
					diagnostic: () => ({ duration: 2109 }),
					module: {
						moduleId: resolve(root, "apps/desktop/slow.test.ts"),
						project: { name: "desktop", config: { root }, vite: { config: { configFile: false } } },
					},
				});
				await reporter.onTestRunEnd();
			}
			// Vitest sets failure status before onTestRunEnd; no warning may clear it.
			if (["failure", "test timeout", "infrastructure"].includes(scenario)) process.exitCode = 1;
			if (scenario === "next run") reporter.onTestRunStart();
			if (scenario === "extra error") logger.error(hang, new Error("other infrastructure"));
			else
				logger.error(
					scenario === "other worker"
						? hang.replace("forks", "threads")
						: scenario === "other infrastructure"
							? "[vitest-pool]: Failed to terminate forks worker"
							: hang,
				);
			assert.equal(
				process.exitCode,
				["timeout", "other worker", "other infrastructure", "extra error"].includes(scenario)
					? undefined
					: 1,
				scenario,
			);
			if (scenario === "timeout")
				assert.ok(
					logs.some(
						(line) => line.startsWith("::warning::") && line.includes("path-utils.test.ts"),
					),
				);
		}
	} finally {
		process.exitCode = oldCode;
		if (savedMode === undefined) delete process.env.SLOW_TESTS_REPORT_ONLY;
		else process.env.SLOW_TESTS_REPORT_ONLY = savedMode;
	}
});

test("report-only preserves other logger errors and only a lone forks line sets failure", () => {
	const oldMode = process.env.SLOW_TESTS_REPORT_ONLY;
	const oldCode = process.exitCode;
	try {
		for (const reportOnly of ["true", "false"]) {
			process.env.SLOW_TESTS_REPORT_ONLY = reportOnly;
			const calls = [];
			const logger = { log() {}, error: (...args) => calls.push(args) };
			const reporter = new SlowTestsReporter();
			reporter.onInit({ config: { root }, logger });
			for (const originalCode of [undefined, 7]) {
				process.exitCode = originalCode;
				const detail = new Error("Vite diagnostic");
				logger.error("advisory error output", detail);
				assert.equal(process.exitCode, originalCode);
				assert.deepEqual(calls.at(-1), ["advisory error output", detail]);
			}
			process.exitCode = undefined;
			logger.error(
				"[vitest-pool]: Timeout terminating forks worker for test files apps/slow.test.ts.",
			);
			assert.equal(process.exitCode, reportOnly === "true" ? 1 : undefined);
		}
	} finally {
		process.exitCode = oldCode;
		if (oldMode === undefined) delete process.env.SLOW_TESTS_REPORT_ONLY;
		else process.env.SLOW_TESTS_REPORT_ONLY = oldMode;
	}
});

async function withPendingFile(check) {
	const dir = mkdtempSync(resolve(tmpdir(), "slow-handoff-"));
	const saved = Object.fromEntries(
		["CI", "GITHUB_ACTIONS", "SLOW_TESTS_REPORT_ONLY", "SLOW_TESTS_PENDING_FILE"].map((key) => [
			key,
			process.env[key],
		]),
	);
	process.env.CI = "true";
	process.env.GITHUB_ACTIONS = "true";
	delete process.env.SLOW_TESTS_REPORT_ONLY;
	const file = resolve(dir, "pending.json");
	process.env.SLOW_TESTS_PENDING_FILE = file;
	try {
		await check(file);
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(dir, { recursive: true });
	}
}
async function record(name = "slow", reportRoot = root) {
	let spawns = 0;
	const reporter = new SlowTestsReporter(() => {
		spawns++;
		throw new Error("shard worker still consuming CPU");
	});
	reporter.onInit({ config: { root: reportRoot }, logger: { log() {}, error() {} } });
	reporter.onTestCaseResult({
		fullName: name,
		name,
		diagnostic: () => ({ duration: 2109 }),
		module: {
			moduleId: resolve(root, "apps/desktop/slow.test.ts"),
			project: {
				name: "desktop",
				config: { root: resolve(root, "apps/desktop") },
				vite: { config: { configFile: resolve(root, "apps/desktop/vitest.config.ts") } },
			},
		},
	});
	await reporter.onTestRunEnd();
	return spawns;
}

test("CI reporter finishes without spawning while a stuck shard worker is still active", async () => {
	await withPendingFile(async (file) => {
		const oldCode = process.exitCode;
		try {
			assert.equal(await record(), 0, "No alone measurement may start before Vitest exits");
			assert.equal(process.exitCode, oldCode);
			assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
				root,
				violations: [
					{
						entry: { file: "apps/desktop/slow.test.ts", name: "slow" },
						nameParts: ["slow"],
						duration: 2109,
						moduleId: resolve(root, "apps/desktop/slow.test.ts"),
						projectRoot: resolve(root, "apps/desktop"),
						projectName: "desktop",
						configFile: resolve(root, "apps/desktop/vitest.config.ts"),
					},
				],
			});
		} finally {
			process.exitCode = oldCode;
		}
	});
});

test("multiple affected Vitest invocations retain all pending violations", async () => {
	await withPendingFile(async (file) => {
		await record("first");
		await record("second");
		assert.deepEqual(
			JSON.parse(readFileSync(file, "utf8")).violations.map(({ entry }) => entry.name),
			["first", "second"],
		);
	});
});

test("a clean reporter run creates no pending file", async () => {
	await withPendingFile(async (file) => {
		const reporter = new SlowTestsReporter(() => assert.fail("unexpected spawn"));
		reporter.onInit({ config: { root }, logger: console });
		await reporter.onTestRunEnd();
		assert.equal(existsSync(file), false);
	});
});

test("pending input refuses malformed JSON, envelopes and every invalid record field", async () => {
	await withPendingFile(async (file) => {
		await record();
		const valid = readPendingSlowTests(file);
		for (const field of [
			"moduleId",
			"projectRoot",
			"projectName",
			"configFile",
			"entry",
			"duration",
			"nameParts",
		]) {
			const invalid = structuredClone(valid);
			invalid.violations[0][field] = null;
			writeFileSync(file, JSON.stringify(invalid));
			assert.throws(() => readPendingSlowTests(file), /Invalid slow-test pending violation/, field);
		}
		for (const [field, value] of [
			["moduleId", ""],
			["moduleId", 123],
			["projectRoot", ""],
			["projectRoot", 123],
			["duration", 2000],
			["duration", "2109"],
			["nameParts", []],
			["nameParts", "slow"],
			["nameParts", [123]],
			["nameParts", ["different"]],
		]) {
			const invalid = structuredClone(valid);
			invalid.violations[0][field] = value;
			writeFileSync(file, JSON.stringify(invalid));
			assert.throws(() => readPendingSlowTests(file), /Invalid slow-test pending violation/);
		}
		for (const field of ["file", "name"]) {
			const invalid = structuredClone(valid);
			invalid.violations[0].entry[field] = null;
			writeFileSync(file, JSON.stringify(invalid));
			assert.throws(() => readPendingSlowTests(file), /Invalid slow-test pending violation/);
		}
		for (const invalid of [
			null,
			{},
			{ root: "", violations: [] },
			{ root: 123, violations: [] },
			{ root, violations: null },
			{ root, violations: [null] },
		]) {
			writeFileSync(file, JSON.stringify(invalid));
			assert.throws(() => readPendingSlowTests(file), /Invalid slow-test pending/);
		}
		writeFileSync(file, "{");
		assert.throws(() => readPendingSlowTests(file), SyntaxError);
		writeFileSync(file, JSON.stringify({ root, violations: [] }));
		assert.deepEqual(readPendingSlowTests(file), { root, violations: [] });
		delete valid.violations[0].projectName;
		valid.violations[0].configFile = false;
		writeFileSync(file, JSON.stringify(valid));
		assert.deepEqual(
			readPendingSlowTests(file),
			valid,
			"projects without a config file remain supported",
		);
	});
});

test("reporter refuses foreign or corrupt pending data without overwriting it", async () => {
	await withPendingFile(async (file) => {
		for (const data of [JSON.stringify({ root: resolve(root, "foreign"), violations: [] }), "{"]) {
			writeFileSync(file, data);
			await assert.rejects(async () => await record(), /another root|JSON/);
			assert.equal(readFileSync(file, "utf8"), data);
		}
	});
});

test("confirm CLI fails loudly for missing, corrupt and absent input and passes an empty batch", async () => {
	await withPendingFile((file) => {
		const cli = (...args) =>
			spawnSync(process.execPath, [resolve(root, "scripts/confirm-slow-tests.mjs"), ...args], {
				encoding: "utf8",
				windowsHide: true,
			});
		for (const args of [[], [file]]) {
			const result = cli(...args);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /Slow-test confirmation infrastructure failed/);
		}
		writeFileSync(file, "{");
		assert.equal(cli(file).status, 1);
		writeFileSync(file, JSON.stringify({ root, violations: [] }));
		assert.equal(cli(file).status, 0);
	});
});

test("CI report-only and explicit local reporters retain in-reporter confirmation", async () => {
	await withPendingFile(async (file) => {
		for (const mode of ["local", "report-only"]) {
			process.env.CI = mode === "local" ? "false" : "true";
			process.env.SLOW_TESTS_REPORT_ONLY = mode === "report-only" ? "true" : "false";
			const oldCode = process.exitCode;
			try {
				assert.equal(await record(), 1, mode);
				assert.equal(process.exitCode, 1, "infrastructure failures stay fatal");
				assert.equal(existsSync(file), false);
			} finally {
				process.exitCode = oldCode;
			}
		}
	});
});

test("CI handoff defaults to the repository pending file", async () => {
	await withPendingFile(async (file) => {
		delete process.env.SLOW_TESTS_PENDING_FILE;
		const reportRoot = resolve(file, "..");
		assert.equal(await record("slow", reportRoot), 0);
		assert.equal(existsSync(resolve(reportRoot, ".slow-tests-pending.json")), true);
	});
});

test("local CI=true still confirms in-process and leaves no pending file", async () => {
	await withPendingFile(async (file) => {
		delete process.env.GITHUB_ACTIONS;
		const oldCode = process.exitCode;
		try {
			assert.equal(await record(), 1);
			assert.equal(process.exitCode, 1, "infrastructure failures remain fatal locally");
			assert.equal(existsSync(file), false);
		} finally {
			process.exitCode = oldCode;
		}
	});
});

test("in-process report-only confirmation keeps its 120-second wall cap and timeout warning", async () => {
	await withPendingFile(async () => {
		process.env.SLOW_TESTS_REPORT_ONLY = "true";
		const oldDeadline = process.env.CI_JOB_DEADLINE_MS;
		delete process.env.CI_JOB_DEADLINE_MS;
		const oldCode = process.exitCode;
		try {
			for (const scenario of ["start retry", "timeout", "exhausted"]) {
				process.exitCode = undefined;
				let elapsed = 0;
				const timeouts = [];
				const logs = [];
				const logger = { log: (line) => logs.push(line), error: (line) => logs.push(line) };
				const reporter = new SlowTestsReporter(
					(_exe, args, options) => {
						timeouts.push(options.timeout);
						if (timeouts.length === 1) {
							elapsed += scenario === "exhausted" ? options.timeout : 60000;
							const code = scenario === "start retry" ? "EAGAIN" : "ETIMEDOUT";
							return {
								started: scenario !== "start retry",
								error: Object.assign(new Error(`spawn ${code}`), { code }),
							};
						}
						elapsed += options.timeout;
						writeFileSync(
							args.find((arg) => arg.startsWith("--outputFile=")).slice(13),
							JSON.stringify({
								unhandledErrors: [],
								testResults: [
									{
										name: args.at(-1),
										status: "passed",
										assertionResults: [
											{
												ancestorTitles: [],
												title: "slow",
												status: "passed",
												duration: 900,
												retryCount: 0,
												repeatCount: 0,
											},
										],
									},
								],
							}),
						);
						return { status: 0, stdout: "", stderr: "" };
					},
					() => elapsed,
				);
				reporter.onInit({ config: { root }, logger });
				reporter.onTestCaseResult({
					name: "slow",
					fullName: "slow",
					diagnostic: () => ({ duration: 2109 }),
					module: {
						moduleId: resolve(root, "apps/desktop/slow.test.ts"),
						project: { name: "desktop", config: { root }, vite: { config: { configFile: false } } },
					},
				});
				await reporter.onTestRunEnd();
				assert.deepEqual(timeouts, scenario === "start retry" ? [120000, 60000] : [120000]);
				assert.equal(elapsed, scenario === "timeout" ? 60000 : 120000, logs.join("\n"));
				if (scenario === "start retry") assert.match(logs.join("\n"), /passed alone/);
				logger.error(
					"[vitest-pool]: Timeout terminating forks worker for test files apps/desktop/path-utils.test.ts.",
				);
				assert.equal(process.exitCode, scenario === "start retry" ? 1 : undefined, logs.join("\n"));
				assert.equal(
					logs.some(
						(line) => line.startsWith("::warning::") && line.includes("path-utils.test.ts"),
					),
					scenario !== "start retry",
				);
			}
		} finally {
			process.exitCode = oldCode;
			if (oldDeadline === undefined) delete process.env.CI_JOB_DEADLINE_MS;
			else process.env.CI_JOB_DEADLINE_MS = oldDeadline;
		}
	});
});
