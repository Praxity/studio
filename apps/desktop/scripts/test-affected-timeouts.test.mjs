import assert, { AssertionError } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { classifyTimeouts, executeVitest } from "./test-affected.mjs";
import AffectedReporter from "./test-affected-reporter.mjs";

const root = resolve(import.meta.dirname, "../../..");

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/vitest-timeouts.json", import.meta.url), "utf8"),
);

test("assertion errors retain their identity even when their message looks like a timeout", () => {
	const dir = mkdtempSync(resolve(tmpdir(), "affected-assertion-"));
	try {
		const outputFile = resolve(dir, "report.json");
		const reporter = new AffectedReporter();
		reporter.onInit({ config: { outputFile } });
		reporter.onTestRunEnd(
			[
				{
					moduleId: "/repo/assertion.test.ts",
					state: () => "failed",
					errors: () => [],
					children: {
						allSuites: () => [],
						allTests: () => [
							{
								result: () => ({
									state: "failed",
									errors: [new AssertionError({ message: "Test timed out in 5000ms." })],
								}),
							},
						],
					},
				},
			],
			[],
		);
		assert.deepEqual(classifyTimeouts(JSON.parse(readFileSync(outputFile, "utf8"))), {
			files: [],
			hardFailure: true,
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("only timeout-only files qualify; assertion, hook and unhandled errors stay failures", () => {
	assert.deepEqual(classifyTimeouts(fixture), { files: ["/repo/slow.test.ts"], hardFailure: true });
	const clean = { ...fixture, testResults: fixture.testResults.slice(0, 1), numFailedTests: 1 };
	assert.deepEqual(classifyTimeouts(clean), { files: ["/repo/slow.test.ts"], hardFailure: false });
	assert.equal(classifyTimeouts({ ...clean, numFailedTests: 2 }).hardFailure, true);
	assert.equal(classifyTimeouts({ ...clean, numUnhandledErrors: 1 }).hardFailure, true);
	assert.equal(classifyTimeouts({ ...clean, nonTestErrors: true }).hardFailure, true);
	assert.deepEqual(
		classifyTimeouts({ ...clean, testResults: [{ ...clean.testResults[0], nonTestErrors: true }] }),
		{ files: [], hardFailure: true },
	);
	assert.deepEqual(
		classifyTimeouts({
			...clean,
			testResults: [
				{ ...clean.testResults[0], assertionResults: [{ status: "failed", failureMessages: [] }] },
			],
		}),
		{ files: [], hardFailure: true },
	);
	assert.throws(() => classifyTimeouts({}), /Invalid Vitest/);
});

test("each qualifying file retries once, sequentially, and any isolated failure retains failure", async () => {
	const report = {
		...timeoutOnly,
		numFailedTests: 2,
		testResults: [
			timeoutOnly.testResults[0],
			{ ...timeoutOnly.testResults[0], name: "/repo/other.test.ts" },
		],
	};
	const retried = [];
	let running = false;
	const code = await executeVitest(step, "/repo", {
		ci: "false",
		log: () => {},
		execute: async (command) => {
			assert.equal(running, false);
			running = true;
			await Promise.resolve();
			running = false;
			const output = command.args.find((arg) => arg.startsWith("--outputFile="));
			if (output) {
				writeFileSync(output.slice(13), JSON.stringify(report));
				return 1;
			}
			retried.push(command.args.at(-1));
			return command.args.at(-1) === "/repo/other.test.ts" ? 1 : 0;
		},
	});
	assert.equal(code, 1);
	assert.deepEqual(retried, ["/repo/other.test.ts", "/repo/slow.test.ts"]);
});

const step = {
	executable: "pnpm",
	args: [
		"exec",
		"vitest",
		"related",
		"--run",
		"--config",
		"vitest.workspace.ts",
		"--maxWorkers=2",
		"src.ts",
	],
};
const timeoutOnly = { ...fixture, testResults: fixture.testResults.slice(0, 1), numFailedTests: 1 };

for (const [alone, expected, label] of [
	[0, 0, "load timeout, passed alone"],
	[1, 1, "failed alone"],
]) {
	test(`one isolated retry is ${label}`, async () => {
		const calls = [];
		const labels = [];
		const code = await executeVitest(step, "/repo", {
			ci: "false",
			log: (message) => labels.push(message),
			execute: async (command) => {
				calls.push(command.args);
				if (calls.length === 1) {
					writeFileSync(
						command.args.find((arg) => arg.startsWith("--outputFile=")).slice(13),
						JSON.stringify(timeoutOnly),
					);
					return 1;
				}
				return alone;
			},
		});
		assert.equal(code, expected);
		assert.equal(calls.length, 2);
		assert.deepEqual(calls[1], [
			"exec",
			"vitest",
			"run",
			"--config",
			"vitest.workspace.ts",
			"--maxWorkers=1",
			"--exclude=/repo/slow.test.ts?*",
			"/repo/slow.test.ts",
		]);
		assert.match(labels.join("\n"), new RegExp(label));
	});
}

test("CI executes the original command once, without recovery", async () => {
	let calls = 0;
	assert.equal(
		await executeVitest(step, "/repo", {
			ci: "true",
			execute: async (command) => {
				calls++;
				assert.deepEqual(command, step);
				return 1;
			},
		}),
		1,
	);
	assert.equal(calls, 1);
});

test("passing alone cannot erase other failures; missing reports fail loudly", async () => {
	let calls = 0;
	assert.equal(
		await executeVitest(step, "/repo", {
			ci: "false",
			log: () => {},
			execute: async (command) => {
				if (++calls === 1) {
					writeFileSync(
						command.args.find((arg) => arg.startsWith("--outputFile=")).slice(13),
						JSON.stringify(fixture),
					);
					return 1;
				}
				return 0;
			},
		}),
		1,
	);
	await assert.rejects(
		executeVitest(step, "/repo", { ci: "false", execute: async () => 1 }),
		/ENOENT/,
	);
});

for (const nestedFailure of [false, true]) {
	test(`real Vitest output ${nestedFailure ? "retains nested cleanup failures without retry" : "recovers one timeout alone"}`, async () => {
		const dir = mkdtempSync(resolve(tmpdir(), "affected-timeout-proof-[literal]-"));
		try {
			symlinkSync(resolve(root, "node_modules"), resolve(dir, "node_modules"), "junction");
			mkdirSync(resolve(dir, "apps/desktop"), { recursive: true });
			symlinkSync(
				resolve(root, "apps/desktop/scripts"),
				resolve(dir, "apps/desktop/scripts"),
				"junction",
			);
			writeFileSync(
				resolve(dir, "vitest.workspace.ts"),
				'export default { test: { include: ["planted.test.ts*"], testTimeout: 50 } };',
			);
			writeFileSync(resolve(dir, "marker.ts"), "export const marker = true;");
			writeFileSync(
				resolve(dir, "planted.test.tsx"),
				'throw new Error("A neighbouring file must not run in the isolated retry");',
			);
			writeFileSync(
				resolve(dir, "planted.test.ts"),
				`import { marker } from "./marker"; import { existsSync, writeFileSync } from "node:fs"; import { afterAll, describe, test } from "vitest"; describe("nested", () => { afterAll(() => { if (${nestedFailure}) throw new Error("Nested cleanup failed"); }); test("load timeout fixture", async () => { if (marker && !existsSync("attempt")) { writeFileSync("attempt", "first"); await new Promise(() => {}); } }); });`,
			);
			const calls = [];
			const labels = [];
			const output = [];
			const code = await executeVitest(
				{
					executable: "pnpm",
					args: [
						"exec",
						"vitest",
						"related",
						"--run",
						"--config",
						"vitest.workspace.ts",
						"--maxWorkers=2",
						"marker.ts",
					],
				},
				dir,
				{
					ci: "false",
					log: (line) => labels.push(line),
					execute: async (command) => {
						calls.push(command.args);
						const result = spawnSync(
							process.execPath,
							[resolve(root, "node_modules/vitest/vitest.mjs"), ...command.args.slice(2)],
							{
								cwd: dir,
								env: { ...process.env, CI: "false" },
								encoding: "utf8",
								timeout: 30000,
								windowsHide: true,
							},
						);
						assert.notEqual(result.status, null, result.stdout + result.stderr);
						output.push(result.stdout + result.stderr);
						const reportArg = command.args.find((arg) => arg.startsWith("--outputFile="));
						if (reportArg) output.push(readFileSync(reportArg.slice(13), "utf8"));
						return result.status;
					},
				},
			);
			assert.equal(code, nestedFailure ? 1 : 0, output.join("\n"));
			assert.equal(calls.length, nestedFailure ? 1 : 2, output.join("\n"));
			if (nestedFailure) assert.deepEqual(labels, []);
			else assert.match(labels.join("\n"), /load timeout, passed alone/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}
