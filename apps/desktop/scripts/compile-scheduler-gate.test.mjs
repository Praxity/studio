import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import * as gate from "./compile-scheduler-gate.mjs";
import {
	cpuUsage,
	darwinDiskQueue,
	diskPreflight,
	evaluateGate,
	evaluateRun,
	linuxDiskQueues,
	monitorCpu,
	parseDarwinFilesystem,
	parseWindowsQueues,
} from "./compile-scheduler-gate.mjs";

const timings = (p95 = 590, max = 900) => [
	...Array(18).fill(200),
	p95,
	max,
	...Array(10).fill(300),
];
const quiet = () => ({
	cpu: { samples: [{ percent: 20, durationMs: 1000 }], error: null },
	disk: { queues: [0, 0, 0.1, 0, 0], error: null },
	filesystem: "NTFS",
	t2a: Array(30).fill(50),
	t2b: timings(),
});

test("busy, boundary and unavailable probes refuse eligibility", () => {
	for (const percent of [30, 31, 50, 51]) {
		const run = quiet();
		run.cpu.samples[0].percent = percent;
		assert.equal(evaluateRun(run).eligible, false, `${percent}% CPU`);
	}
	for (const percent of [50, 51]) {
		const peak = quiet();
		peak.cpu.samples = [
			...Array(9).fill({ percent: 10, durationMs: 1000 }),
			{ percent, durationMs: 1000 },
		];
		assert.equal(evaluateRun(peak).eligible, false, "low mean cannot hide a busy second");
	}
	for (const probe of ["cpu", "disk"]) {
		const run = quiet();
		run[probe].error = "unavailable";
		assert.equal(evaluateRun(run).eligible, false, probe);
	}
	for (const changes of [
		{ filesystem: null },
		{ cpu: { samples: [], error: null } },
		{ cpu: { samples: [{ percent: Number.NaN, durationMs: 1000 }], error: null } },
		{ cpu: { samples: [{ percent: 20, durationMs: 3000 }], error: null } },
		{ disk: { queues: [0, 0, 0, 0, 0.11], error: null } },
		{ disk: { queues: [], error: null } },
		{ disk: { queues: [0, 0, 0, 0, Number.NaN], error: null } },
	])
		assert.equal(evaluateRun({ ...quiet(), ...changes }).eligible, false);
	assert.equal(evaluateRun(quiet()).eligible, true);
});

test("CPU mean covers the whole run with duration weighting", () => {
	const run = quiet();
	run.cpu.samples = [
		{ percent: 1, durationMs: 100 },
		...Array(10).fill({ percent: 32, durationMs: 1000 }),
	];
	assert.equal(evaluateRun(run).eligible, false);
	assert.ok(evaluateRun(run).cpu.mean > 31);
});

test("whole-machine CPU below the benchmark's share refuses eligibility", () => {
	const run = { ...quiet(), ownCpuMean: 21 };
	assert.equal(evaluateRun(run).eligible, false);
	assert.match(evaluateRun(run).reasons.join("; "), /CPU probe implausible/);
	assert.equal(evaluateRun({ ...run, ownCpuMean: 20 }).eligible, true);
	assert.equal(evaluateRun({ ...run, ownCpuMean: Number.NaN }).eligible, false);
	assert.equal(evaluateRun({ ...run, ownCpuMean: -1 }).eligible, false);
});

test("Windows CPU parser accepts PDH rows and refuses malformed counters", () => {
	const header = '"(PDH-CSV 4.0)","\\\\host\\Processor(_Total)\\% Processor Time"\n';
	const row = '"10/09/2026 10:00:01.000","20.5"\n';
	assert.deepEqual(gate.parseWindowsCpu(header + row), [
		{ at: new Date("10/09/2026 10:00:01.000").getTime(), percent: 20.5 },
	]);
	assert.equal(gate.parseWindowsCpu(header + row.replace("20.5", "20,5"))[0].percent, 20.5);
	for (const text of [
		"",
		header,
		header + row.replace("20.5", ""),
		header + row.replace("20.5", "invalid"),
		header + row.replace("20.5", "-1"),
		header + row.replace("20.5", "101"),
		header + row.replace("10/09/2026 10:00:01.000", "invalid"),
		header + row.replace('"20.5"', '"20.5","1"'),
	])
		assert.throws(() => gate.parseWindowsCpu(text));
});

test("benchmark CPU share uses the whole-machine inventory despite affinity", () => {
	assert.equal(gate.processCpuShare({ user: 900_000, system: 100_000 }, 1000, 16), 6.25);
	assert.throws(() => gate.processCpuShare({ user: 1, system: 0 }, 0, 16));
	assert.throws(() => gate.processCpuShare({ user: 1, system: 0 }, 1000, 0));
});

test("Windows CPU monitor samples PDH across the full window and clips the final interval", async () => {
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	let killed = false;
	child.kill = () => {
		killed = true;
	};
	let clock = new Date("10/09/2026 10:00:01.000").getTime();
	const pending = gate.monitorWindowsCpu({
		start: (command, args, options) => {
			assert.equal(command, "typeperf");
			assert.equal(args[0], "\\Processor(_Total)\\% Processor Time");
			assert.deepEqual(args.slice(1), ["-si", "1"]);
			assert.equal(options.windowsHide, true);
			return child;
		},
		now: () => clock,
	});
	child.stdout.write('"(PDH-CSV 4.0)","counter"\n"10/09/2026 10:00:01.000","10"\n');
	const stop = await pending;
	clock += 1000;
	child.stdout.write('"10/09/2026 10:00:02.000","20"\n');
	clock += 500;
	const result = stop();
	clock += 500;
	child.stdout.write('"10/09/2026 10:00:03.000","30"\n');
	assert.deepEqual((await result).samples, [
		{ percent: 20, durationMs: 1000 },
		{ percent: 30, durationMs: 500 },
	]);
	assert.equal(killed, true);
});

test("Windows CPU monitor refuses a failed probe, counter reset and sampling gap", async () => {
	for (const ending of ["error", "exit", "reset", "gap", "invalid"]) {
		const child = new EventEmitter();
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.kill = () => {};
		let clock = new Date("10/09/2026 10:00:01.000").getTime();
		const pending = gate.monitorWindowsCpu({ start: () => child, now: () => clock });
		child.stdout.write('"(PDH-CSV 4.0)","counter"\n"10/09/2026 10:00:01.000","10"\n');
		const stop = await pending;
		clock += 1000;
		if (ending === "error") child.emit("error", new Error("probe failed"));
		else if (ending === "exit") child.emit("close", 1);
		else
			child.stdout.write(
				`"10/09/2026 10:00:0${ending === "reset" ? "0" : ending === "gap" ? "4" : "2"}.000","${ending === "invalid" ? "invalid" : "20"}"\n`,
			);
		assert.ok((await stop()).error, ending);
	}
});

test("Windows CPU monitor refuses a stopped counter stream", async () => {
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	let killed = false;
	child.kill = () => {
		killed = true;
	};
	const pending = gate.monitorWindowsCpu({ start: () => child });
	child.stdout.write('"(PDH-CSV 4.0)","counter"\n"10/09/2026 10:00:01.000","10"\n');
	const stop = await pending;
	assert.match((await stop()).error, /sampling gap/);
	assert.equal(killed, true);
});

test("three eligible first-20 p95s use the median, publish maxima and keep T2a", () => {
	const runs = [590, 600, 900].map((p95, index) =>
		evaluateRun({ ...quiet(), t2b: timings(p95, 2500 + index) }),
	);
	const result = evaluateGate(runs);
	assert.equal(result.verdict, "pass");
	assert.equal(result.medianP95, 600);
	assert.deepEqual(
		result.runs.map((run) => run.t2b.p95),
		[590, 600, 900],
	);
	assert.deepEqual(
		result.runs.map((run) => run.t2b.max),
		[2500, 2501, 2502],
	);
	assert.equal(evaluateGate([runs[0], runs[2], runs[2]]).verdict, "fail");
	assert.equal(evaluateGate([runs[0], runs[1]]).verdict, null);
	const busy = quiet();
	busy.cpu.samples[0].percent = 31;
	const incomplete = evaluateGate([runs[0], runs[1], evaluateRun(busy)]);
	assert.equal(incomplete.verdict, null);
	assert.equal(incomplete.exitCode, 2);
	assert.equal(incomplete.eligibleRuns, 2);
	assert.equal(incomplete.medianP95, null);
	assert.equal(evaluateGate([runs[0], runs[1], { ...runs[2], filesystem: "ReFS" }]).verdict, null);
	const lateTail = quiet();
	lateTail.t2b[29] = 9999;
	lateTail.t2b[28] = 5000;
	const lateResult = evaluateRun(lateTail);
	assert.equal(lateResult.t2b.max, 9999);
	assert.equal(evaluateGate([runs[0], runs[1], lateResult]).verdict, "pass");
	const slowDraft = quiet();
	slowDraft.t2a[29] = 101;
	slowDraft.t2a[28] = 101;
	assert.equal(evaluateGate([runs[0], runs[1], evaluateRun(slowDraft)]).verdict, "fail");
	const short = quiet();
	short.t2b = short.t2b.slice(0, 20);
	assert.equal(evaluateGate([runs[0], runs[1], evaluateRun(short)]).verdict, null);
});

test("unsupported disk probe is explicitly unavailable", async () => {
	const run = quiet();
	run.disk = await diskPreflight("unsupported");
	assert.match(run.disk.error, /unsupported/);
	assert.equal(evaluateRun(run).eligible, false);
});

test("CPU deltas and monitor capture startup, periodic samples and final interval", () => {
	const snapshot = (idle, user) => [{ times: { idle, user, sys: 0, nice: 0, irq: 0 } }];
	assert.equal(cpuUsage(snapshot(100, 100), snapshot(180, 120)), 20);
	assert.throws(() => cpuUsage([], []));
	assert.throws(() => cpuUsage(snapshot(100, 100), snapshot(10, 10)));
	let tick;
	let clock = 0;
	let idle = 0;
	let user = 0;
	let cleared = false;
	const stop = monitorCpu({
		read: () => snapshot(idle, user),
		now: () => clock,
		every: (callback, interval) => {
			assert.equal(interval, 1000);
			tick = callback;
			return 1;
		},
		clear: () => {
			cleared = true;
		},
	});
	clock = 1000;
	idle = 80;
	user = 20;
	tick();
	clock = 1500;
	idle = 120;
	user = 30;
	assert.deepEqual(stop().samples, [
		{ percent: 20, durationMs: 1000 },
		{ percent: 20, durationMs: 500 },
	]);
	assert.equal(cleared, true);
	const missing = monitorCpu({ read: () => [], every: () => 1, clear: () => {} });
	assert.match(missing().error, /CPU/);
});

test("disk parsers reject missing, reset and malformed counters", () => {
	const csv =
		'"PDH-CSV 4.0","queue"\n' +
		Array(5).fill('"timestamp","0.050000"').join("\n") +
		"\nThe command completed successfully.";
	assert.deepEqual(parseWindowsQueues(csv), Array(5).fill(0.05));
	assert.throws(() => parseWindowsQueues(csv.replace("0.050000", "invalid")));
	assert.throws(() => parseWindowsQueues(csv.replace("0.050000", "-1")));
	assert.throws(() => parseWindowsQueues('"timestamp","invalid"'));
	const stats = (weighted, inflight = 0) =>
		`259 0 nvme0n1 1 0 1 0 1 0 1 0 ${inflight} 0 ${weighted}`;
	assert.equal(linuxDiskQueues(stats(100), stats(200), ["nvme0n1"], 1000), 0.1);
	assert.equal(linuxDiskQueues(stats(100), stats(200, 1), ["nvme0n1"], 1000), 1);
	assert.throws(() => linuxDiskQueues(stats(100), stats(99), ["nvme0n1"], 1000));
	assert.throws(() => linuxDiskQueues("", "", ["nvme0n1"], 1000));
	assert.throws(() => linuxDiskQueues(stats(100), stats(200), [], 1000));
	assert.throws(() => linuxDiskQueues(stats(100), stats(200), ["nvme0n1"], Number.NaN));
	const ioreg = (read, write) =>
		`  |   "Statistics" = {"Operations (Write)"=9,"Total Time (Read)"=${read},"Latency Time (Read)"=0,"Total Time (Write)"=${write}}`;
	assert.equal(darwinDiskQueue(ioreg(0, 0), ioreg(40_000_000, 60_000_000), 1000), 0.1);
	assert.equal(
		darwinDiskQueue(ioreg(488043578868215n, 0), ioreg(488043578868215n + 500_000_000n, 0), 1000),
		0.5,
	);
	assert.throws(() => darwinDiskQueue(ioreg(10, 0), ioreg(9, 0), 1000));
	assert.throws(() => darwinDiskQueue("", "", 1000));
	assert.throws(() => darwinDiskQueue(ioreg(0, 0), ioreg(0, 0), 0));
	const df =
		"Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk3s5 1 1 1 94% /System/Volumes/Data\n";
	const mounts =
		"/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)\n/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse)\n";
	assert.equal(parseDarwinFilesystem(df, mounts), "apfs");
	assert.throws(() => parseDarwinFilesystem(df, ""));
});
