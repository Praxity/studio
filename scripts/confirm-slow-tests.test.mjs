import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { observeConfirmationHost, runConfirmation } from "./confirm-slow-tests.mjs";

const options = { encoding: "utf8", timeout: 10000, killSignal: "SIGKILL", windowsHide: true };

test("real Node EMFILE and ENFILE spawn failures retain their cause without stdio or a crash", () => {
	for (const code of ["EMFILE", "ENFILE"]) {
		// Inject only libuv's errno; Node retains its real child/stdio/error lifecycle.
		const probe = spawnSync(
			process.execPath,
			[
				"--expose-internals",
				"--input-type=module",
				"--eval",
				`
import { createRequire } from "node:module";
import { runConfirmation } from ${JSON.stringify(new URL("./confirm-slow-tests.mjs", import.meta.url).href)};
const require = createRequire(import.meta.url);
const { internalBinding } = require("internal/test/binding");
const { Process } = internalBinding("process_wrap");
const original = Process.prototype.spawn;
Process.prototype.spawn = function () {
  Process.prototype.spawn = original;
  return internalBinding("uv").UV_${code};
};
const result = await runConfirmation(process.execPath, ["--eval", "process.exit(0)"], {
  encoding: "utf8", timeout: 100, killSignal: "SIGKILL", windowsHide: true,
});
console.log(JSON.stringify({ started: result.started, code: result.error?.code, stdout: result.stdout, stderr: result.stderr }));
`,
			],
			{ encoding: "utf8", windowsHide: true, timeout: 5000 },
		);
		assert.equal(probe.error, undefined);
		assert.equal(probe.status, 0, probe.stdout + probe.stderr);
		assert.deepEqual(JSON.parse(probe.stdout), { started: false, code, stdout: "", stderr: "" });
	}
});

function workerAlive(pid, read = readFileSync) {
	try {
		return !read(`/proc/${pid}/stat`, "utf8").split(") ")[1].startsWith("Z ");
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}

async function workerExited(pid) {
	// Leader close can precede a worker's delivery of the same group SIGKILL.
	const deadline = performance.now() + 1000;
	while (workerAlive(pid)) {
		const remaining = deadline - performance.now();
		if (remaining <= 0) return false;
		await sleep(Math.min(10, remaining));
	}
	return true;
}

test("worker exit during a procfs read counts as gone, while a live worker cannot pass", () => {
	assert.equal(
		workerAlive(123, () => {
			throw Object.assign(new Error("gone"), { code: "ENOENT" });
		}),
		false,
	);
	assert.equal(
		workerAlive(123, () => "123 (node) Z 1 2"),
		false,
	);
	assert.equal(
		workerAlive(123, () => "123 (node) S 1 2"),
		true,
	);
	assert.throws(
		() =>
			workerAlive(123, () => {
				throw Object.assign(new Error("denied"), { code: "EACCES" });
			}),
		/denied/,
	);
});

test("confirmation owns a process group on Linux and macOS, with child-only termination on Windows", async () => {
	for (const platform of ["linux", "darwin", "win32"]) {
		const child = new EventEmitter();
		child.pid = 313131;
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		const signals = [];
		const finish = () => queueMicrotask(() => child.emit("close", null, "SIGKILL"));
		child.kill = (signal) => {
			signals.push(["child", signal]);
			finish();
		};
		let detached;
		const result = await runConfirmation(
			"node",
			[],
			{ ...options, timeout: 1 },
			{
				platform,
				spawnProcess: (_exe, _args, config) => {
					detached = config.detached;
					queueMicrotask(() => child.emit("spawn"));
					return child;
				},
				killProcess: (pid, signal) => {
					signals.push([pid, signal]);
					finish();
				},
			},
		);
		assert.equal(detached, platform !== "win32");
		assert.equal(result.started, true);
		assert.equal(result.error.code, "ETIMEDOUT");
		assert.deepEqual(signals, [[platform === "win32" ? "child" : -313131, "SIGKILL"]]);
	}
});

test("Linux confirmation samples load, I/O pressure and interval CPU waits without counting guest twice", () => {
	let end = false;
	const read = (path) =>
		path === "/proc/pressure/io"
			? `some avg10=${end ? "2.34" : "1.23"} avg60=0.10 avg300=0.01 total=123\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`
			: path === "/proc/loadavg"
				? end
					? "0.10 0.20 0.30 1/20 99\n"
					: "1.00 2.00 3.00 2/20 90\n"
				: end
					? "cpu 29 0 20 160 11 0 0 10 9999 9999\ncpu0 0\n"
					: "cpu 10 0 10 100 5 0 0 5 999 999\n";
	const finish = observeConfirmationHost({ platform: "linux", read });
	end = true;
	assert.deepEqual(finish(), {
		loadavgStart: "1.00 2.00 3.00 2/20 90",
		loadavgEnd: "0.10 0.20 0.30 1/20 99",
		cpuTicks: 100,
		stealTicks: 5,
		stealPercent: 5,
		iowaitTicks: 6,
		iowaitPercent: 6,
		ioPressureStart: "some avg10=1.23 avg60=0.10 avg300=0.01 total=123",
		ioPressureEnd: "some avg10=2.34 avg60=0.10 avg300=0.01 total=123",
	});
});

test("optional I/O pressure failures preserve CPU samples and decreasing iowait stays visible", () => {
	for (const code of ["ENOENT", "EACCES"]) {
		let end = false;
		const finish = observeConfirmationHost({
			platform: "linux",
			read(path) {
				if (path === "/proc/pressure/io") throw Object.assign(new Error(code), { code });
				if (path === "/proc/stat")
					return end ? "cpu 30 0 0 100 9 0 0 0" : "cpu 10 0 0 100 10 0 0 0";
				return "0 0 0 1/10 1";
			},
		});
		end = true;
		const sample = finish();
		assert.equal(sample.cpuTicks, 19);
		assert.equal(sample.iowaitTicks, -1);
		assert.equal(sample.iowaitPercent, -5.26);
		assert.equal(sample.stealPercent, 0);
		assert.equal(sample.ioPressureStart, code === "ENOENT" ? null : `unavailable: ${code}`);
		assert.equal(sample.ioPressureEnd, sample.ioPressureStart);
	}
});

test("host observation skips other platforms and reports unavailable counters without throwing", () => {
	assert.equal(
		observeConfirmationHost({
			platform: "win32",
			read() {
				throw new Error("must not read");
			},
		})(),
		undefined,
	);
	for (const text of [
		"cpu 1 2 3",
		"cpu 1 2 3 4 5 6 7 NaN",
		"not-cpu 1 2 3 4 5 6 7 8",
		"cpu 1 2 3 4 5 6 7 -1",
		"cpu 1 2 3 4 5 6 7 1.5",
		"cpu 1 2 3 4 5 6 7 9007199254740992",
	]) {
		const finish = observeConfirmationHost({ platform: "linux", read: () => text });
		assert.match(finish().error, /Invalid aggregate CPU counters/);
	}
	const unavailable = observeConfirmationHost({
		platform: "linux",
		read() {
			throw new Error("proc unavailable");
		},
	});
	assert.match(unavailable().error, /proc unavailable/);
	let stopped = false;
	const afterFailure = observeConfirmationHost({
		platform: "linux",
		read: (path) => {
			if (stopped) throw new Error("proc disappeared");
			return path === "/proc/stat" ? "cpu 1 2 3 4 5 6 7 8" : "0 0 0 1/10 1";
		},
	});
	stopped = true;
	assert.match(afterFailure().error, /proc disappeared/);
	const noInterval = observeConfirmationHost({
		platform: "linux",
		read: (path) => (path === "/proc/stat" ? "cpu 1 2 3 4 5 6 7 8" : "0 0 0 1/10 1"),
	});
	assert.equal(noInterval().stealPercent, null);
	assert.equal(noInterval().iowaitPercent, null);
});

test("async confirmation captures both streams and preserves real child failures", async () => {
	for (const status of [0, 1, 7]) {
		const result = await runConfirmation(
			process.execPath,
			["--eval", `console.log("out"); console.error("err"); process.exitCode = ${status};`],
			options,
		);
		assert.equal(result.status, status);
		assert.equal(result.error, undefined);
		assert.equal(result.started, true);
		assert.equal(result.stdout.trim(), "out");
		assert.equal(result.stderr.trim(), "err");
	}
});

test("async confirmation identifies its own timeout and waits for child exit", async () => {
	const result = await runConfirmation(
		process.execPath,
		["--eval", "setInterval(() => {}, 1000)"],
		{ ...options, timeout: 100 },
	);
	assert.equal(result.error?.code, "ETIMEDOUT");
	assert.equal(result.status, null);
	assert.equal(result.signal, "SIGKILL");
	assert.equal(result.started, true);
});

for (const delayed of [false, true]) {
	test(delayed
		? "Linux timeout tolerates worker exit after the group leader closes"
		: "Linux timeout removes its owned workers before another measurement", {
		skip: process.platform !== "linux",
	}, async (context) => {
		const dir = mkdtempSync(resolve(tmpdir(), "confirmation-workers-"));
		const pidFile = resolve(dir, "worker.pid");
		let pid;
		let delayedKill;
		try {
			const result = await runConfirmation(
				process.execPath,
				[
					"--input-type=module",
					"--eval",
					`
import { spawn } from "node:child_process";
spawn(process.execPath, ["--eval", ${JSON.stringify(`require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`)}], { stdio: "ignore" });
setInterval(() => {}, 1000);
`,
				],
				{ ...options, timeout: 1000 },
				delayed
					? {
							killProcess: (group, signal) => {
								// The owned leader exits first; its worker receives the same kill later.
								process.kill(-group, signal);
								delayedKill = sleep(100).then(() => process.kill(group, signal));
							},
						}
					: undefined,
			);
			assert.equal(result.error?.code, "ETIMEDOUT");
			assert.ok(existsSync(pidFile), "Worker must start before testing its cleanup");
			pid = Number(readFileSync(pidFile, "utf8"));
			context.diagnostic(
				`Worker running at leader close: ${workerAlive(pid)}; delayed signal: ${delayed}`,
			);
			const exited = await workerExited(pid);
			context.diagnostic(`Worker running after bounded exit check: ${workerAlive(pid)}`);
			assert.equal(exited, true, "Owned worker survived timeout");
		} finally {
			await delayedKill;
			// This is the PID written by this fixture, never a process-name or parent-PID lookup.
			if (pid && existsSync(`/proc/${pid}`)) {
				try {
					process.kill(pid, "SIGKILL");
				} catch (error) {
					assert.equal(error.code, "ESRCH");
				}
			}
			rmSync(dir, { recursive: true });
		}
	});
}

test("async confirmation preserves spawn errors and the previous output limit", async () => {
	const missing = await runConfirmation(
		resolve(import.meta.dirname, "missing-command"),
		[],
		options,
	);
	assert.equal(missing.error?.code, "ENOENT");
	assert.equal(missing.started, false);
	const overflow = await runConfirmation(
		process.execPath,
		["--eval", 'process.stdout.write("x".repeat(2 * 1024 * 1024)); setInterval(() => {}, 1000);'],
		options,
	);
	assert.equal(overflow.error?.code, "ENOBUFS");
	assert.equal(overflow.started, true);
	assert.notEqual(overflow.status, 0);
});

test("spawn state follows the event even when an error code and PID cannot distinguish it", async () => {
	for (const started of [false, true]) {
		const child = new EventEmitter();
		child.pid = 313131;
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		const failure = Object.assign(new Error("EAGAIN"), { code: "EAGAIN" });
		const result = await runConfirmation("node", [], options, {
			spawnProcess: () => {
				queueMicrotask(() => {
					if (started) child.emit("spawn");
					child.emit("error", failure);
					child.emit("close", null, null);
				});
				return child;
			},
		});
		assert.equal(result.started, started);
		assert.equal(result.error, failure);
	}
});
