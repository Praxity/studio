import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { confirmSlowTests, readPendingSlowTests } from "./confirm-slow-tests.mjs";
import { clearVitestProcessGroups } from "./vitest-processes.mjs";

const root = resolve(import.meta.dirname, "..");
function live(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}

test("real Linux stuck teardown worker is gone before the alone measurement", {
	skip: process.platform !== "linux",
}, async (t) => {
	const dir = mkdtempSync(resolve(tmpdir(), "stuck-vitest-"));
	const groups = resolve(dir, "groups");
	const pidFile = resolve(dir, "worker.pid");
	const pending = resolve(dir, "pending.json");
	let pid;
	const saved = Object.fromEntries(
		["CI", "GITHUB_ACTIONS", "SLOW_TESTS_PROCESS_GROUPS_FILE"].map((key) => [
			key,
			process.env[key],
		]),
	);
	try {
		symlinkSync(resolve(root, "node_modules"), resolve(dir, "node_modules"), "dir");
		writeFileSync(
			resolve(dir, "stuck.test.mjs"),
			`import { test } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
test("stuck shard", () => {
  if (existsSync(${JSON.stringify(pidFile)})) return;
  writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
  process.on("SIGTERM", () => {});
  process.on("message", message => {
    if (message?.type === "stop") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 110000);
  });
});`,
		);
		writeFileSync(
			resolve(dir, "vitest.config.mjs"),
			`import Reporter from ${JSON.stringify(pathToFileURL(resolve(root, "scripts/slow-tests-reporter.mjs")).href)};
class ForcedTiming extends Reporter {
  onTestCaseResult(test) { test.diagnostic = () => ({ duration: 2109 }); super.onTestCaseResult(test); }
}
export default { root: ${JSON.stringify(dir)}, test: { include: ["stuck.test.mjs"], pool: "forks", maxWorkers: 1, reporters: ["default", new ForcedTiming()] } };`,
		);
		const shard = spawnSync(
			"bash",
			[
				resolve(root, "scripts/run-vitest-isolated.sh"),
				process.execPath,
				resolve(root, "node_modules/vitest/vitest.mjs"),
				"run",
				"--configLoader",
				"native",
				"--config",
				resolve(dir, "vitest.config.mjs"),
			],
			{
				cwd: root,
				env: {
					...process.env,
					CI: "true",
					GITHUB_ACTIONS: "true",
					SLOW_TESTS_REPORT_ONLY: "false",
					SLOW_TESTS_PENDING_FILE: pending,
					SLOW_TESTS_PROCESS_GROUPS_FILE: groups,
				},
				encoding: "utf8",
				timeout: 95000,
			},
		);
		assert.equal(shard.error, undefined);
		assert.equal(shard.status, 0, shard.stdout + shard.stderr);
		pid = Number(readFileSync(pidFile, "utf8"));
		assert.equal(live(pid), true, "fixture must reproduce a worker that outlives Vitest exit 0");
		assert.match(shard.stdout + shard.stderr, /Timeout terminating forks worker/);
		const warnings = [];
		let measurements = 0;
		process.env.CI = "true";
		process.env.GITHUB_ACTIONS = "true";
		process.env.SLOW_TESTS_PROCESS_GROUPS_FILE = groups;
		const failed = await confirmSlowTests(readPendingSlowTests(pending), {
			reportOnly: false,
			logger: {
				log() {},
				error: (message) => assert.fail(message),
				warn: (message) => warnings.push(message),
			},
			run: (...args) => {
				measurements++;
				assert.equal(
					live(pid),
					false,
					"a live shard worker must never be measured alongside confirmation",
				);
				return spawnSync(...args);
			},
		});
		assert.equal(failed, false);
		assert.equal(measurements, 1);
		assert.equal(live(pid), false);
		assert.match(warnings.join("\n"), new RegExp(`PID ${pid}:.*forks\\.js`));
		t.diagnostic(warnings.join("\n"));
	} finally {
		// Stop only the exact fixture worker this test recorded, even if an assertion fails.
		if (!pid && existsSync(pidFile)) pid = Number(readFileSync(pidFile, "utf8"));
		if (pid && live(pid)) process.kill(pid, "SIGKILL");
		if (existsSync(groups)) clearVitestProcessGroups(groups, { logger: { warn() {} } });
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(dir, { recursive: true });
	}
});
