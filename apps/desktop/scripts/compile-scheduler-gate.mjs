import { execFile, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

// Owner decision 2026-10-07. T2a retains both its first-20 and all-30 checks.
export const gateRule = Object.freeze({
	commits: 30,
	gateCommits: 20,
	runs: 3,
	// Keep attempting after ineligible runs, but stop rather than wait indefinitely on a busy machine.
	maxAttempts: 6,
	preflightTries: 12,
	t2aMs: 100,
	t2bMs: 600,
	cpuMean: 30,
	cpuMax: 50,
	sampleMs: 1000,
	maxSampleGapMs: 2500,
	diskSamples: 5,
	diskQueueMax: 0.1,
	ineligibleExitCode: 2,
});

export function summarize(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		samples: sorted.length,
		median: sorted.length
			? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
			: null,
		p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
		max: sorted.at(-1) ?? null,
	};
}

export function preflightReasons(disk, filesystem) {
	const reasons = [];
	if (
		disk.error ||
		disk.queues.length !== gateRule.diskSamples ||
		disk.queues.some((queue) => !Number.isFinite(queue) || queue < 0)
	)
		reasons.push(`Disk probe unavailable: ${disk.error ?? "missing/invalid counters"}`);
	else if (disk.queues.some((queue) => queue > gateRule.diskQueueMax))
		reasons.push(
			`Disk preflight queue ${Math.max(...disk.queues).toFixed(3)} exceeds ${gateRule.diskQueueMax}`,
		);
	if (!filesystem) reasons.push("Filesystem probe unavailable");
	return reasons;
}

export function evaluateRun({ cpu, disk, filesystem, t2a, t2b, ownCpuMean }) {
	const reasons = preflightReasons(disk, filesystem);
	const validCpu =
		cpu.samples.length > 0 &&
		cpu.samples.every(
			({ percent, durationMs }) =>
				Number.isFinite(percent) &&
				percent >= 0 &&
				percent <= 100 &&
				Number.isFinite(durationMs) &&
				durationMs > 0 &&
				durationMs <= gateRule.maxSampleGapMs,
		);
	const duration = cpu.samples.reduce((sum, sample) => sum + sample.durationMs, 0);
	const mean = validCpu
		? cpu.samples.reduce((sum, sample) => sum + sample.percent * sample.durationMs, 0) / duration
		: null;
	const max = validCpu ? Math.max(...cpu.samples.map((sample) => sample.percent)) : null;
	if (cpu.error || !validCpu)
		reasons.push(
			`CPU probe unavailable: ${cpu.error ?? "missing/invalid samples or sampling gap"}`,
		);
	if (mean !== null && mean >= gateRule.cpuMean)
		reasons.push(`CPU mean ${mean.toFixed(1)}% must be <${gateRule.cpuMean}%`);
	if (max !== null && max >= gateRule.cpuMax)
		reasons.push(`CPU max ${max.toFixed(1)}% must be <${gateRule.cpuMax}%`);
	if (
		ownCpuMean !== undefined &&
		(!Number.isFinite(ownCpuMean) ||
			ownCpuMean < 0 ||
			ownCpuMean > 100 ||
			(mean !== null && mean < ownCpuMean))
	)
		reasons.push(
			"CPU probe implausible: whole-machine mean below benchmark's own share or invalid own share",
		);
	if (
		[t2a, t2b].some(
			(values) =>
				values.length !== gateRule.commits ||
				values.some((value) => !Number.isFinite(value) || value < 0),
		)
	)
		reasons.push(`A gate run requires ${gateRule.commits} valid commits`);
	return {
		eligible: reasons.length === 0,
		reasons,
		filesystem,
		cpu: { mean, max, samples: cpu.samples, error: cpu.error },
		disk,
		t2a: { ...summarize(t2a.slice(0, gateRule.gateCommits)), all: summarize(t2a) },
		t2b: {
			...summarize(t2b.slice(0, gateRule.gateCommits)),
			max: summarize(t2b).max,
			all: summarize(t2b),
		},
	};
}

export function processCpuShare(usage, durationMs, processors = cpus().length) {
	if (
		!Number.isFinite(durationMs) ||
		durationMs <= 0 ||
		!Number.isInteger(processors) ||
		processors <= 0
	)
		throw new Error("CPU duration or whole-machine processor inventory unavailable");
	// Affinity limits availableParallelism(), but PDH _Total still covers every processor.
	return (100 * (usage.user + usage.system)) / 1000 / durationMs / processors;
}

export function evaluateGate(runs) {
	const eligible = runs.filter((run) => run.eligible);
	const enough =
		eligible.length === gateRule.runs && new Set(eligible.map((run) => run.filesystem)).size === 1;
	const medianP95 = enough ? summarize(eligible.map((run) => run.t2b.p95)).median : null;
	const verdict = enough
		? medianP95 <= gateRule.t2bMs &&
			eligible.every((run) => run.t2a.p95 <= gateRule.t2aMs && run.t2a.all.p95 <= gateRule.t2aMs)
			? "pass"
			: "fail"
		: null;
	return {
		rules: gateRule,
		runs,
		eligibleRuns: eligible.length,
		medianP95,
		verdict,
		exitCode: verdict === null ? gateRule.ineligibleExitCode : verdict === "pass" ? 0 : 1,
	};
}

export function cpuUsage(before, after) {
	if (!before.length || before.length !== after.length)
		throw new Error("CPU counters unavailable or CPU inventory changed");
	let idle = 0;
	let total = 0;
	for (let index = 0; index < before.length; index++) {
		for (const key of ["user", "nice", "sys", "idle", "irq"]) {
			const delta = after[index].times[key] - before[index].times[key];
			if (!Number.isFinite(delta) || delta < 0)
				throw new Error("CPU counters reset or unavailable");
			total += delta;
			if (key === "idle") idle += delta;
		}
	}
	if (total <= 0) throw new Error("CPU counters did not advance");
	return (100 * (total - idle)) / total;
}

export function monitorCpu({
	read = cpus,
	now = () => performance.now(),
	every = setInterval,
	clear = clearInterval,
} = {}) {
	const samples = [];
	let error = null;
	let previous;
	let at = now();
	try {
		previous = read();
		if (!previous.length) throw new Error("CPU counters unavailable");
	} catch (failure) {
		error = String(failure);
	}
	const sample = () => {
		const end = now();
		if (end <= at || error) return;
		try {
			const current = read();
			samples.push({ percent: cpuUsage(previous, current), durationMs: end - at });
			previous = current;
			at = end;
		} catch (failure) {
			error = String(failure);
		}
	};
	const timer = every(sample, gateRule.sampleMs);
	return () => {
		clear(timer);
		sample();
		return { samples, error };
	};
}

export function parseWindowsCpu(csv) {
	const rows = csv
		.split(/\r?\n/)
		.filter((line) => line.trim().startsWith('"'))
		.slice(1);
	if (!rows.length) throw new Error("Missing PDH CPU counters");
	return rows.map((row) => {
		const cells = [...row.matchAll(/"([^"]*)"/g)].map((cell) => cell[1]);
		const at = Date.parse(cells[0]);
		const percent = cells[1]?.trim() ? Number(cells[1].replace(",", ".")) : Number.NaN;
		if (
			cells.length !== 2 ||
			!Number.isFinite(at) ||
			!Number.isFinite(percent) ||
			percent < 0 ||
			percent > 100
		)
			throw new Error("Invalid PDH CPU timestamp or percentage");
		return { at, percent };
	});
}

export async function monitorWindowsCpu({ start = spawn, now = Date.now } = {}) {
	const samples = [];
	let error = null;
	let child;
	let timer;
	let previous;
	let began;
	let ended;
	let closed = false;
	let resolveReady;
	let resolveStopped;
	const ready = new Promise((resolve) => {
		resolveReady = resolve;
	});
	const stopped = new Promise((resolve) => {
		resolveStopped = resolve;
	});
	const finish = (failure) => {
		if (closed) return;
		closed = true;
		if (failure) error = String(failure);
		clearTimeout(timer);
		child?.kill();
		resolveReady();
		resolveStopped({ samples, error });
	};
	const watch = (ms) => {
		clearTimeout(timer);
		timer = setTimeout(() => finish(new Error("PDH CPU sampling gap or unavailable probe")), ms);
	};
	try {
		// Processor Utility can exceed 100% with turbo. Processor Time matches the bounded gate.
		child = start("typeperf", ["\\Processor(_Total)\\% Processor Time", "-si", "1"], {
			windowsHide: true,
		});
		let buffer = "";
		let header;
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", finish);
		child.on("close", (code) =>
			finish(new Error(`PDH CPU probe exited ${code}: ${stderr.trim()}`)),
		);
		child.stdout.on("data", (chunk) => {
			if (closed) return;
			buffer += chunk.toString();
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop();
			try {
				for (const line of lines) {
					if (!line.trim().startsWith('"')) continue;
					if (!header) {
						header = line;
						continue;
					}
					const { at, percent } = parseWindowsCpu(`${header}\n${line}`)[0];
					if (previous === undefined) {
						previous = at;
						began = now();
						resolveReady();
					} else {
						const gap = at - previous;
						if (gap <= 0 || gap > gateRule.maxSampleGapMs)
							throw new Error("PDH CPU counter reset or sampling gap");
						const durationMs = Math.min(at, ended ?? at) - Math.max(previous, began);
						if (durationMs > 0) samples.push({ percent, durationMs });
						previous = at;
						if (ended !== undefined && at >= ended) {
							finish();
							return;
						}
					}
					watch(gateRule.maxSampleGapMs);
				}
			} catch (failure) {
				finish(failure);
			}
		});
		watch(5000);
	} catch (failure) {
		finish(failure);
	}
	await ready;
	return () => {
		ended = now();
		if (previous >= ended) finish();
		return stopped;
	};
}

export function parseWindowsQueues(csv) {
	const rows = csv
		.split(/\r?\n/)
		.filter((line) => line.trim().startsWith('"'))
		.slice(1);
	const queues = rows.map((row) => {
		const cells = [...row.matchAll(/"([^"]*)"/g)].map((cell) => cell[1]);
		return cells.length === 2 && cells[1].trim() ? Number(cells[1].replace(",", ".")) : Number.NaN;
	});
	if (
		queues.length !== gateRule.diskSamples ||
		queues.some((queue) => !Number.isFinite(queue) || queue < 0)
	)
		throw new Error("Missing or invalid PhysicalDisk queue counters");
	return queues;
}

export function linuxDiskQueues(before, after, devices, durationMs) {
	const parse = (text) =>
		new Map(
			text
				.trim()
				.split("\n")
				.map((line) => {
					const fields = line.trim().split(/\s+/);
					return [fields[2], { inflight: Number(fields[11]), weightedMs: Number(fields[13]) }];
				}),
		);
	const start = parse(before);
	const end = parse(after);
	if (!devices.length || !Number.isFinite(durationMs) || durationMs <= 0)
		throw new Error("No physical disk counters");
	let queue = 0;
	for (const device of devices) {
		const a = start.get(device);
		const b = end.get(device);
		if (
			!a ||
			!b ||
			![a.inflight, b.inflight, a.weightedMs, b.weightedMs].every(Number.isFinite) ||
			a.inflight < 0 ||
			b.inflight < 0 ||
			a.weightedMs < 0 ||
			b.weightedMs < a.weightedMs
		)
			throw new Error(`Missing/reset disk counters for ${device}`);
		queue += Math.max(a.inflight, b.inflight, (b.weightedMs - a.weightedMs) / durationMs);
	}
	return queue;
}

// IOBlockStorageDriver's "Total Time" counters accumulate nanoseconds spent on completed
// reads and writes. Their summed delta over elapsed time is the mean queue length (Little's
// law), the same measure as Linux's weighted milliseconds. macOS exposes no in-flight count.
export function darwinDiskQueue(before, after, durationMs) {
	const parse = (text) =>
		[...text.matchAll(/"Total Time \((?:Read|Write)\)"=(\d+)/g)].map((match) => BigInt(match[1]));
	const start = parse(before);
	const end = parse(after);
	if (
		!start.length ||
		start.length !== end.length ||
		!Number.isFinite(durationMs) ||
		durationMs <= 0
	)
		throw new Error("Missing IOBlockStorageDriver statistics");
	let busyNs = 0n;
	for (let index = 0; index < start.length; index++) {
		if (end[index] < start[index]) throw new Error("IOBlockStorageDriver counters reset");
		busyNs += end[index] - start[index];
	}
	return Number(busyNs) / 1e6 / durationMs;
}

export function parseDarwinFilesystem(df, mounts) {
	const device = df.trim().split("\n").at(-1)?.split(/\s+/)[0];
	const line = mounts.split("\n").find((entry) => device && entry.startsWith(`${device} on `));
	const type = line?.match(/\(([^,)]+)/)?.[1];
	if (!type) throw new Error("Volume filesystem unavailable");
	return type;
}

const exec = promisify(execFile);
export async function diskPreflight(platform = process.platform) {
	try {
		if (platform === "win32") {
			const { stdout } = await exec(
				"typeperf",
				[
					"\\PhysicalDisk(_Total)\\Avg. Disk Queue Length",
					"-si",
					"1",
					"-sc",
					String(gateRule.diskSamples),
				],
				{ timeout: 15000, windowsHide: true },
			);
			return { queues: parseWindowsQueues(stdout), error: null };
		}
		if (platform === "darwin") {
			const read = async () =>
				(await exec("ioreg", ["-c", "IOBlockStorageDriver", "-r", "-w", "0"], { timeout: 5000 }))
					.stdout;
			let before = await read();
			let at = performance.now();
			const queues = [];
			for (let index = 0; index < gateRule.diskSamples; index++) {
				await delay(gateRule.sampleMs);
				const after = await read();
				const end = performance.now();
				if (end - at > gateRule.maxSampleGapMs) throw new Error("Disk sampling gap");
				queues.push(darwinDiskQueue(before, after, end - at));
				before = after;
				at = end;
			}
			return { queues, error: null };
		}
		if (platform !== "linux") throw new Error(`Disk probe unsupported on ${platform}`);
		const devices = (await readdir("/sys/block")).filter((name) => !/^(loop|ram)/.test(name));
		let before = await readFile("/proc/diskstats", "utf8");
		let at = performance.now();
		const queues = [];
		for (let index = 0; index < gateRule.diskSamples; index++) {
			await delay(gateRule.sampleMs);
			const after = await readFile("/proc/diskstats", "utf8");
			const end = performance.now();
			if (end - at > gateRule.maxSampleGapMs) throw new Error("Disk sampling gap");
			queues.push(linuxDiskQueues(before, after, devices, end - at));
			before = after;
			at = end;
		}
		return { queues, error: null };
	} catch (failure) {
		return { queues: [], error: String(failure) };
	}
}

export async function readFilesystem(path) {
	if (process.platform === "win32") {
		const escaped = path.replaceAll("'", "''");
		const { stdout } = await exec(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`$ErrorActionPreference='Stop'; (Get-Volume -FilePath '${escaped}').FileSystemType`,
			],
			{ timeout: 15000, windowsHide: true },
		);
		if (!stdout.trim()) throw new Error("Volume filesystem unavailable");
		return stdout.trim();
	}
	if (process.platform === "linux") {
		const { stdout } = await exec(
			"findmnt",
			["--noheadings", "--output", "FSTYPE", "--target", path],
			{ timeout: 5000 },
		);
		if (!stdout.trim()) throw new Error("Volume filesystem unavailable");
		return stdout.trim();
	}
	if (process.platform === "darwin") {
		const [{ stdout: df }, { stdout: mounts }] = await Promise.all([
			exec("df", ["-P", path], { timeout: 5000 }),
			exec("mount", [], { timeout: 5000 }),
		]);
		return parseDarwinFilesystem(df, mounts);
	}
	throw new Error(`Filesystem probe unsupported on ${process.platform}`);
}
