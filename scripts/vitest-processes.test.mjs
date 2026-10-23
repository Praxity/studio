import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { confirmSlowTests } from "./confirm-slow-tests.mjs";
import { clearVitestProcessGroups } from "./vitest-processes.mjs";

async function fixture(check) {
	const dir = mkdtempSync(resolve(tmpdir(), "vitest-groups-"));
	const file = resolve(dir, "groups");
	writeFileSync(file, "313131\n");
	try {
		await check(file);
	} finally {
		rmSync(dir, { recursive: true });
	}
}

const leaked = {
	pid: 313132,
	group: 313131,
	state: "S",
	command: "node vitest/dist/workers/forks.js",
};
const pending = {
	root: import.meta.dirname,
	violations: [
		{
			moduleId: resolve(import.meta.dirname, "fixture.test.ts"),
			projectRoot: import.meta.dirname,
			entry: { file: "fixture.test.ts", name: "slow" },
			nameParts: ["slow"],
			duration: 2109,
		},
	],
};

for (const outcome of ["term", "kill", "survive"]) {
	test(`leftover check ${outcome} runs before confirmation; survivors fail as infrastructure`, async () => {
		await fixture(async (file) => {
			let active = true;
			let elapsed = 0;
			let confirmations = 0;
			const signals = [];
			const warnings = [];
			const errors = [];
			const logger = {
				warn: (message) => warnings.push(message),
				error: (message) => errors.push(message),
				log() {},
			};
			const failed = await confirmSlowTests(pending, {
				now: () => elapsed,
				logger,
				cleanup: (options) =>
					clearVitestProcessGroups(file, {
						...options,
						list: () => [
							{ pid: 900, group: 900, state: "R", command: "unrelated node" },
							...(active ? [leaked] : []),
						],
						kill: (group, signal) => {
							assert.equal(group, -313131, "only the recorded job group may be signalled");
							signals.push(signal);
							if (outcome === "term" || (outcome === "kill" && signal === "SIGKILL"))
								active = false;
						},
						wait: (ms) => {
							elapsed += ms;
						},
					}),
				run: (_, args) => {
					confirmations++;
					assert.equal(active, false, "uncertified timing cannot clear the gate");
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
											duration: 1,
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
			});
			assert.equal(failed, outcome === "survive");
			assert.equal(confirmations, outcome === "survive" ? 0 : 1);
			assert.deepEqual(signals, outcome === "term" ? ["SIGTERM"] : ["SIGTERM", "SIGKILL"]);
			assert.match(warnings.join("\n"), /warning.*Leaked Vitest processes.*PID 313132.*forks\.js/s);
			if (outcome === "survive")
				assert.match(
					errors.join("\n"),
					/Slow-test confirmation infrastructure failed:.*survived SIGKILL/s,
				);
			else assert.deepEqual(errors, []);
		});
	});
}

test("empty groups and exited zombies require no signals; cleanup waits respect the hard deadline", async () => {
	await fixture((file) => {
		for (const members of [[], [{ ...leaked, state: "Z" }]])
			clearVitestProcessGroups(file, {
				list: () => members,
				kill: () => assert.fail("unexpected signal"),
			});
		let now = 0;
		assert.throws(
			() =>
				clearVitestProcessGroups(file, {
					list: () => [leaked],
					kill() {},
					now: () => now,
					deadline: 17,
					wait: (ms) => {
						now += ms;
					},
					logger: { warn() {} },
				}),
			/survived SIGKILL/,
		);
		assert.equal(now, 17);
	});
});

test("production cleanup polls until killed workers become zombies or disappear", async () => {
	await fixture((file) => {
		for (const gone of [[], [{ ...leaked, state: "Z" }]]) {
			let elapsed = 0;
			const signals = [];
			clearVitestProcessGroups(file, {
				list: () => (elapsed < 1050 ? [leaked] : gone),
				kill: (_group, signal) => signals.push(signal),
				wait: (ms) => {
					elapsed += ms;
				},
				now: () => elapsed,
				logger: { warn() {} },
			});
			assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
			assert.equal(elapsed, 1050);
		}
	});
});

test("invalid ownership, process-list failures and kill failures cannot certify cleanup", async () => {
	await fixture((file) => {
		const original = readFileSync(file, "utf8");
		for (const value of ["", "0", "1", "-3", "123\nunsafe", "9007199254740992"]) {
			writeFileSync(file, value);
			assert.throws(
				() => clearVitestProcessGroups(file, { list: () => [] }),
				/Invalid Vitest process-group file/,
			);
		}
		writeFileSync(file, original);
		assert.throws(() => clearVitestProcessGroups(undefined), /Missing Vitest process-group file/);
		assert.throws(
			() =>
				clearVitestProcessGroups(file, {
					list: () => [{ ...leaked, pid: process.pid }],
					kill: () => assert.fail("must refuse before signalling"),
				}),
			/Refusing to signal/,
		);
		assert.throws(
			() =>
				clearVitestProcessGroups(file, {
					list: () => {
						throw new Error("listing failed");
					},
				}),
			/listing failed/,
		);
		assert.throws(
			() =>
				clearVitestProcessGroups(file, {
					list: () => [leaked],
					logger: { warn() {} },
					kill: () => {
						throw new Error("kill failed");
					},
				}),
			/kill failed/,
		);
		let calls = 0;
		clearVitestProcessGroups(file, {
			list: () => (calls++ ? [] : [leaked]),
			logger: { warn() {} },
			kill: () => {
				throw Object.assign(new Error("already gone"), { code: "ESRCH" });
			},
		});
	});
});
