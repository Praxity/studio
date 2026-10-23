import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const script = fileURLToPath(
	new URL("../../../packages/export-pipeline/tests/a11y/timing-summary.mjs", import.meta.url),
);

function run(report, reportPath = "results.json") {
	const directory = mkdtempSync(join(tmpdir(), "published-timing-"));
	try {
		const path = join(directory, reportPath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(report));
		return spawnSync(process.execPath, [script, path], { encoding: "utf8" });
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

const result = (retry, duration, status) => ({ retry, duration, status });
const spec = (title, results, projectName = "webkit", status = "expected") => ({
	title,
	file: "lesson.spec.ts",
	line: 12,
	tests: [{ projectName, status, results }],
});
const report = (specs, errors = []) => ({
	stats: {
		startTime: "2026-10-02T12:00:00.000Z",
		duration: 10000,
		expected: 1,
		unexpected: 1,
		flaky: 1,
		skipped: 1,
	},
	suites: [{ title: "lesson.spec.ts", suites: [{ title: "journey", specs }] }],
	errors,
});

for (const suite of ["a11y", "deck"]) {
	test(`${suite} timing reads the suite's JSON evidence with failed and retried journeys`, async () => {
		const ci = parse(
			readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8"),
		);
		const { default: config } = await import(
			`../../../packages/export-pipeline/tests/${suite}/playwright.config.ts`
		);
		assert.ok(Array.isArray(config.reporter), "Every suite needs JSON timing evidence");
		const json = config.reporter.find(([name]) => name === "json");
		assert.equal(json[1].outputFile, `../../test-results/${suite}/results.json`);
		const summary = ci.jobs[`published-output-${suite}`].steps.find(
			(step) => step.name === "Summarize published-output timing",
		);
		const reportPath = `packages/export-pipeline/test-results/${suite}/results.json`;
		assert.ok(
			summary.run.includes(
				`timing-summary.mjs ${reportPath} > packages/export-pipeline/test-results/${suite}/timing-summary.md`,
			),
		);
		assert.match(summary.run, /Playwright did not produce a JSON report/);
		const output = run(
			report([
				spec(
					`${suite} learner journey`,
					[result(0, 1000, "failed"), result(1, 2000, "passed")],
					"webkit",
					"flaky",
				),
				spec(`${suite} terminal failure`, [result(0, 500, "failed")], "firefox", "unexpected"),
			]),
			reportPath,
		);
		assert.equal(output.status, 0, output.stderr);
		assert.match(output.stdout, /2 tests, 3 attempts/);
		assert.match(output.stdout, /3\.000 \| 1\.000 \| flaky \| 0:failed, 1:passed/);
		assert.ok(output.stdout.includes(`${suite} terminal failure`));
	});
}

test("timing summary ranks retry cost separately from first attempts and retains failed evidence", () => {
	const output = run(
		report(
			[
				spec(
					"retry case",
					[result(0, 1000, "failed"), result(1, 6000, "passed")],
					"webkit",
					"flaky",
				),
				spec("first slow", [result(0, 5000, "passed")]),
				spec(
					"failed case",
					[result(0, 2000, "timedOut"), result(1, 3000, "failed")],
					"firefox",
					"unexpected",
				),
				spec("skipped", [result(0, 0, "skipped")], "webkit", "skipped"),
			],
			[{ message: "setup cleanup failed" }],
		),
	);
	assert.equal(output.status, 0, output.stderr);
	assert.match(output.stdout, /Started: 2026-10-02T12:00:00.000Z/);
	assert.match(output.stdout, /Ended: 2026-10-02T12:00:10.000Z/);
	assert.match(output.stdout, /4 tests, 6 attempts/);
	const [all, first] = output.stdout.split("## Slowest first attempts");
	assert.ok(all.indexOf("retry case") < all.indexOf("first slow"));
	assert.ok(first.indexOf("first slow") < first.indexOf("retry case"));
	assert.match(all, /7\.000 \| 1\.000 \| flaky \| 0:failed, 1:passed/);
	assert.match(all, /firefox.*failed case.*timedOut, 1:failed/);
	assert.match(output.stdout, /setup cleanup failed/);
});

test("identical titles in separate projects and suites remain separate test identities", () => {
	const input = report([
		spec("same | title", [result(0, 1100, "passed")], "chromium"),
		spec("same | title", [result(0, 2200, "passed")], "webkit"),
	]);
	input.suites[0].suites.push({
		title: "other",
		specs: [spec("same | title", [result(0, 3300, "passed")], "webkit")],
	});
	const output = run(input);
	assert.equal(output.status, 0, output.stderr);
	assert.match(output.stdout, /3 tests, 3 attempts/);
	assert.match(output.stdout, /chromium.*journey.*same \\?\| title/);
	assert.match(output.stdout, /webkit.*other.*same \\?\| title/);
});

test("setup failure with no test results still yields timing and error evidence", () => {
	const output = run(report([], [{ message: "fixture build failed" }]));
	assert.equal(output.status, 0, output.stderr);
	assert.match(output.stdout, /0 tests, 0 attempts/);
	assert.match(output.stdout, /fixture build failed/);
});

test("malformed timing evidence fails loudly instead of printing a successful empty summary", () => {
	for (const input of [{}, report([spec("bad duration", [result(0, -1, "passed")])])]) {
		const output = run(input);
		assert.notEqual(output.status, 0);
		assert.match(output.stderr, /Invalid Playwright timing report/);
	}
});
