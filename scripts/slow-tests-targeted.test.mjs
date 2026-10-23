import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { confirmSlowTests, runConfirmation } from "./confirm-slow-tests.mjs";

const root = resolve(import.meta.dirname, "..");
const violation = (dir, nameParts) => ({
	moduleId: resolve(dir, "target.test.ts"),
	projectRoot: dir,
	configFile: resolve(dir, "vitest.config.mjs"),
	entry: { file: "packages/example/target.test.ts", name: nameParts.join(" > ") },
	nameParts,
	duration: 2109,
});

async function fixture(source, names, options = {}) {
	const dir = mkdtempSync(resolve(tmpdir(), "slow-targeted-"));
	const logs = [];
	const calls = [];
	try {
		symlinkSync(resolve(root, "node_modules"), resolve(dir, "node_modules"), "junction");
		writeFileSync(
			resolve(dir, "vitest.config.mjs"),
			`export default { test: { include: ["target.test.ts"] } };`,
		);
		writeFileSync(resolve(dir, "target.test.ts"), source);
		const failed = await confirmSlowTests(
			{ root, violations: names.map((parts) => violation(dir, parts)) },
			{
				reportOnly: false,
				cleanup() {},
				logger: { log: (line) => logs.push(line), error: (line) => logs.push(line) },
				run: async (executable, args, config) => {
					calls.push({ args, config });
					return runConfirmation(executable, args, config);
				},
				...options,
			},
		);
		return { failed, logs: logs.join("\n"), calls };
	} finally {
		rmSync(dir, { recursive: true });
	}
}

test("targeted confirmation skips siblings whose whole-file duration exceeds the file cap, preserving hooks", async () => {
	const result = await fixture(
		`
import { beforeAll, beforeEach, expect, test } from "vitest";
let ready = false;
let visits = 0;
beforeAll(() => { ready = true; });
beforeEach(() => { visits++; });
test("target", () => { expect(ready).toBe(true); expect(visits).toBe(1); });
test("sibling exceeds cap", async () => { await new Promise(resolve => setTimeout(resolve, 120001)); }, 121000);
`,
		[["target"]],
		{
			// Keep this regression bounded even when the name filter is removed.
			run: (exe, args, config) => runConfirmation(exe, args, { ...config, timeout: 10000 }),
		},
	);
	assert.equal(result.failed, false, result.logs);
	assert.match(result.logs, /target: 2109 ms in shard, \d+ ms alone/);
});

test("real filters preserve nested, parameterised and literal special-character names", async () => {
	const result = await fixture(
		`
import { describe, expect, test } from "vitest";
describe("outer > [a]", () => describe("inner (b+)?", () => {
  test.each(["first.$^|\\\\", "second.*"])("case %s", value => expect(value).toBeTruthy());
  test("duplicate leaf", () => {});
}));
describe("other", () => test("duplicate leaf", () => { throw new Error("unrequested duplicate leaf ran"); }));
test("outer > [a] > inner (b+)? > duplicate leaf", () => { throw new Error("literal separator collision ran"); });
test("prefix outer > [a] inner (b+)? duplicate leaf suffix", () => { throw new Error("unanchored match ran"); });
`,
		[
			["outer > [a]", "inner (b+)?", "case first.$^|\\"],
			["outer > [a]", "inner (b+)?", "case second.*"],
			["outer > [a]", "inner (b+)?", "duplicate leaf"],
		],
	);
	assert.equal(result.failed, false, result.logs);
	assert.equal(result.calls.length, 1);
	assert.equal(result.logs.match(/Slow test passed alone:/g)?.length, 3, result.logs);
});

for (const [scenario, source, names] of [
	["filter miss", 'test("other", () => {});', [["missing"]]],
	["duplicate full names", 'test("same", () => {}); test("same", () => {});', [["same"]]],
	["duplicate pending targets", 'test("same", () => {});', [["same"], ["same"]]],
	[
		"space-joined name collision",
		'test("a b", () => {}); describe("a", () => test("b", () => {}));',
		[["a", "b"]],
	],
	["dynamic skip", 'test("target", ctx => ctx.skip());', [["target"]]],
]) {
	test(`targeted confirmation refuses ${scenario}`, async () => {
		const result = await fixture(`import { describe, test } from "vitest"; ${source}`, names);
		assert.equal(result.failed, true, result.logs);
		assert.match(result.logs, /confirmation infrastructure failed/);
		assert.doesNotMatch(result.logs, /Slow test passed alone/);
	});
}

test("a genuinely slow targeted test still fails the two-second budget", async () => {
	const result = await fixture(
		`import { test } from "vitest";
test("slow", async () => { await new Promise(resolve => setTimeout(resolve, 2100)); });`,
		[["slow"]],
	);
	assert.equal(result.failed, true, result.logs);
	assert.match(result.logs, /Slow-test budget exceeded \(2000 ms\).*slow.*ms alone/s);
});

async function retryScenario(outcomes, { reportOnly = false, deadline = 180000 } = {}) {
	let elapsed = 0;
	let timeoutNotifications = 0;
	const calls = [];
	const logs = [];
	const reportPaths = [];
	const failed = await confirmSlowTests(
		{ root, violations: [violation(root, ["target"])] },
		{
			now: () => elapsed,
			jobDeadline: String(deadline),
			cleanup() {},
			reportOnly,
			onConfirmationTimeout: () => {
				timeoutNotifications++;
			},
			logger: { log: (line) => logs.push(line), error: (line) => logs.push(line) },
			run: (_exe, args, config) => {
				const outcome = outcomes[calls.length];
				calls.push(config.timeout);
				if (!outcome) return { started: true, error: new Error("Unexpected extra attempt") };
				reportPaths.push(args.find((arg) => arg.startsWith("--outputFile=")).slice(13));
				elapsed += outcome.elapsed ?? 0;
				if (outcome.report)
					writeFileSync(
						outcome.lateReport ? reportPaths[0] : reportPaths.at(-1),
						JSON.stringify({
							unhandledErrors: [],
							selectionErrors: [],
							testResults: [
								{
									name: args.at(-1),
									status: outcome.report === "failed" ? "failed" : "passed",
									message: "planted assertion",
									assertionResults: [
										{
											ancestorTitles: [],
											title: "target",
											status: outcome.report,
											duration: outcome.duration ?? 1,
											retryCount: 0,
											repeatCount: 0,
											...outcome.diagnostics,
										},
									],
								},
							],
						}),
					);
				if (outcome.code)
					return {
						started: Object.hasOwn(outcome, "started") ? outcome.started : true,
						error: Object.assign(new Error(outcome.code), { code: outcome.code }),
						status: null,
					};
				return {
					started: true,
					status: outcome.report === "failed" ? 1 : 0,
					stdout: "",
					stderr: "",
				};
			},
		},
	);
	return { failed, calls, logs: logs.join("\n"), timeoutNotifications };
}

test("persistent pre-start failures stop after two attempts even with time remaining", async () => {
	for (const reportOnly of [false, true]) {
		let attempts = 0;
		let elapsed = 0;
		const logs = [];
		const failed = await confirmSlowTests(
			{ root, violations: [violation(root, ["target"])] },
			{
				cleanup() {},
				reportOnly,
				now: () => elapsed,
				jobDeadline: 180000,
				logger: { log: (line) => logs.push(line), error: (line) => logs.push(line) },
				run: () => {
					attempts++;
					elapsed += 1000;
					return {
						started: false,
						error: Object.assign(new Error("spawn EAGAIN"), { code: "EAGAIN" }),
					};
				},
			},
		);
		assert.equal(failed, true, logs.join("\n"));
		assert.equal(attempts, 2, logs.join("\n"));
		assert.equal(elapsed, 2000);
		assert.match(logs.join("\n"), /target.*EAGAIN/s);
	}
});

test("a started child is final even when afterAll hangs before the JSON report", async () => {
	let attempts = 0;
	let measured;
	const result = await fixture(
		`
import { test, afterAll } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
const visits = new URL("./visits", import.meta.url);
const cold = !existsSync(visits);
test("slow", async () => {
  const start = Date.now();
  if (cold) await new Promise(resolve => setTimeout(resolve, 2100));
  writeFileSync(visits, String(Date.now() - start));
});
afterAll(() => cold ? new Promise(() => {}) : undefined);
`,
		[["slow"]],
		{
			run: async (exe, args, config) => {
				attempts++;
				const outcome = await runConfirmation(exe, args, { ...config, timeout: 8000 });
				if (attempts === 1) {
					measured = Number(readFileSync(resolve(args.at(-1), "../visits"), "utf8"));
					assert.equal(
						existsSync(args.find((arg) => arg.startsWith("--outputFile=")).slice(13)),
						false,
					);
				}
				return outcome;
			},
		},
	);
	assert.ok(measured >= 2000, `Target must finish over budget before its hook hangs: ${measured}`);
	assert.equal(result.failed, true, result.logs);
	assert.equal(attempts, 1, result.logs);
	assert.match(result.logs, /ETIMEDOUT/);
	assert.doesNotMatch(result.logs, /Slow test passed alone/);
});

test("only a proven pre-spawn failure can be retried", async () => {
	for (const started of [true, undefined]) {
		for (const code of ["EAGAIN", "EMFILE", "ENOENT", "ETIMEDOUT"]) {
			const result = await retryScenario([{ code, started }, { report: "passed" }]);
			assert.equal(result.failed, true, JSON.stringify({ code, started, logs: result.logs }));
			assert.equal(result.calls.length, 1, result.logs);
		}
	}
	const timeout = await retryScenario([
		{ code: "ETIMEDOUT", started: false },
		{ report: "passed" },
	]);
	assert.equal(timeout.failed, true);
	assert.equal(timeout.calls.length, 1);
});

test("a real executable start failure is retried once before a successful confirmation", async () => {
	const starts = [];
	const result = await fixture(
		'import { test } from "vitest"; test("target", () => {});',
		[["target"]],
		{
			run: async (exe, args, config) => {
				const outcome = await runConfirmation(
					starts.length ? exe : resolve(root, "missing-command"),
					args,
					config,
				);
				starts.push(outcome.started);
				return outcome;
			},
		},
	);
	assert.equal(result.failed, false, result.logs);
	assert.deepEqual(starts, [false, true]);
	assert.match(result.logs, /Retrying.*ENOENT/);
	assert.match(result.logs, /Slow test passed alone/);
});

test("a complete measurement survives teardown timeout without a best-of-two retry", async () => {
	for (const [first, second] of [
		[2116, 1],
		[3000, 1500],
		[1000, 1],
	]) {
		for (const reportOnly of [false, true]) {
			const result = await retryScenario(
				[
					{ code: "ETIMEDOUT", report: "passed", duration: first },
					{ report: "passed", duration: second },
				],
				{ reportOnly },
			);
			assert.equal(result.calls.length, 1, result.logs);
			assert.equal(result.failed, !reportOnly, result.logs);
			assert.match(
				result.logs,
				first > 2000
					? new RegExp(`budget exceeded.*${first} ms alone`, "s")
					: /passed alone.*1000 ms alone/s,
			);
			assert.match(result.logs, /ETIMEDOUT/);
			assert.doesNotMatch(result.logs, /Retrying/);
		}
	}
});

test("a report-only timeout warns without retrying a later failed start", async () => {
	const result = await retryScenario([{ code: "ETIMEDOUT" }, { code: "EAGAIN", started: false }], {
		reportOnly: true,
	});
	assert.equal(result.failed, false, result.logs);
	assert.equal(result.calls.length, 1);
	assert.equal(result.timeoutNotifications, 1);
	assert.match(result.logs, /::warning::.*ETIMEDOUT/);
	assert.doesNotMatch(result.logs, /Retrying|infrastructure failed/);
});

test("per-test retry overrides cannot hide an earlier assertion failure", async () => {
	const result = await fixture(
		`import { expect, test } from "vitest";
let attempt = 0;
test("explicit retry", { retry: 1 }, () => expect(++attempt).toBe(2));`,
		[["explicit retry"]],
	);
	assert.equal(result.failed, true, result.logs);
	assert.equal(result.calls.length, 1);
	assert.match(result.logs, /retried target|more than one attempt/);
	assert.doesNotMatch(result.logs, /Slow test passed alone/);
});

test("confirmation requires zero retries and repeats, including explicit attempt diagnostics", async () => {
	for (const diagnostics of [
		{ retryCount: 1 },
		{ repeatCount: 1 },
		{ retryCount: undefined },
		{ retryCount: -1 },
		{ repeatCount: "0" },
		{ retryCount: null },
	]) {
		const result = await retryScenario([{ report: "passed", diagnostics }]);
		assert.equal(result.failed, true, JSON.stringify({ diagnostics, logs: result.logs }));
		assert.match(result.logs, /retried target|more than one attempt/);
		assert.doesNotMatch(result.logs, /Slow test passed alone/);
	}
});

test("confirmation retries a proven failed start once, inside the remaining shared budget", async () => {
	for (const code of ["ENOENT", "EAGAIN", "EMFILE"]) {
		const result = await retryScenario([
			{ code, started: false, elapsed: 120000 },
			{ report: "passed" },
		]);
		assert.equal(result.failed, false, result.logs);
		assert.deepEqual(result.calls, [120000, 60000]);
		assert.match(result.logs, /Retrying.*target.*(ENOENT|EAGAIN|EMFILE)/);
	}
});

test("retry exhaustion names the unconfirmed test and cause; report-only timeouts remain warnings", async () => {
	for (const reportOnly of [false, true])
		for (const code of ["ENOENT", "ETIMEDOUT"]) {
			const result = await retryScenario(
				[
					{ code, started: false },
					{ code, started: false },
				],
				{ reportOnly },
			);
			assert.equal(result.failed, !(reportOnly && code === "ETIMEDOUT"), result.logs);
			assert.equal(result.calls.length, code === "ETIMEDOUT" ? 1 : 2);
			assert.match(result.logs, new RegExp(`target.*${code}`, "s"));
			assert.match(
				result.logs,
				reportOnly && code === "ETIMEDOUT" ? /::warning::/ : /infrastructure failed/,
			);
		}
});

test("no retry crosses the job deadline or reuses a late report from the earlier attempt", async () => {
	const expired = await retryScenario([{ code: "ETIMEDOUT", elapsed: 500 }], { deadline: 500 });
	assert.equal(expired.failed, true);
	assert.deepEqual(expired.calls, [500]);
	assert.match(expired.logs, /target.*ETIMEDOUT/s);
	const stale = await retryScenario([
		{ code: "EAGAIN", started: false },
		{ report: "passed", lateReport: true },
	]);
	assert.equal(stale.failed, true, stale.logs);
	assert.equal(stale.calls.length, 2);
	assert.match(stale.logs, /no usable JSON/);
});

test("retry cannot swallow a real assertion, hook, budget or infrastructure failure", async () => {
	for (const reportOnly of [false, true]) {
		const assertion = await retryScenario(
			[{ code: "EAGAIN", started: false }, { report: "failed" }],
			{
				reportOnly,
			},
		);
		assert.equal(assertion.failed, true, assertion.logs);
		assert.equal(assertion.calls.length, 2);
		assert.match(assertion.logs, /test failed alone.*planted assertion/s);
		const timedFailure = await retryScenario(
			[{ code: "ETIMEDOUT", report: "failed" }, { report: "passed" }],
			{
				reportOnly,
			},
		);
		assert.equal(timedFailure.failed, true, timedFailure.logs);
		assert.equal(timedFailure.calls.length, 1, "A completed real failure must never be retried");
		assert.match(timedFailure.logs, /test failed alone.*planted assertion/s);
	}
	const slow = await retryScenario([
		{ code: "ENOENT", started: false },
		{ report: "passed", duration: 2001 },
	]);
	assert.equal(slow.failed, true, slow.logs);
	assert.match(slow.logs, /budget exceeded/);
	const broken = await retryScenario([{ code: "ENOBUFS" }]);
	assert.equal(broken.failed, true, broken.logs);
	assert.equal(broken.calls.length, 1);
});
