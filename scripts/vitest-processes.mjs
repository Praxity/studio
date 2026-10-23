import { readdirSync, readFileSync } from "node:fs";

function listLinuxProcesses() {
	return readdirSync("/proc")
		.filter((name) => /^\d+$/.test(name))
		.flatMap((name) => {
			try {
				const stat = readFileSync(`/proc/${name}/stat`, "utf8");
				const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
				return [
					{
						pid: Number(name),
						group: Number(fields[2]),
						state: fields[0],
						command: readFileSync(`/proc/${name}/cmdline`, "utf8").replaceAll("\0", " ").trim(),
					},
				];
			} catch (error) {
				if (error.code === "ENOENT" || error.code === "ESRCH") return [];
				throw error;
			}
		});
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Only the dedicated setsid groups recorded by this job may be signalled.
export function clearVitestProcessGroups(
	file,
	{
		list = listLinuxProcesses,
		kill = process.kill,
		wait = sleep,
		now = Date.now,
		logger = console,
		deadline = Infinity,
	} = {},
) {
	if (!file) throw new Error("Missing Vitest process-group file");
	const values = readFileSync(file, "utf8").trim().split("\n");
	if (
		values.some(
			(value) =>
				!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 1,
		)
	)
		throw new Error("Invalid Vitest process-group file");
	// shortcut: descendants using setsid or a double fork escape, causing false reds, never false passes.
	// Upgrade by tagging step processes with an environment variable and scanning
	// /proc/<pid>/environ, which also avoids process-group-ID reuse.
	// A child with a cleared environment still escapes; skip other users' processes.
	const groups = new Set(values.map(Number));
	let processes = list();
	if (processes.some((member) => member.pid === process.pid && groups.has(member.group)))
		throw new Error("Refusing to signal the confirmation process group");
	// Zombies have already exited and cannot consume CPU or receive signals.
	const leftovers = () =>
		processes.filter((member) => groups.has(member.group) && member.state !== "Z");
	const describe = (members) =>
		members.map(({ pid, command }) => `PID ${pid}: ${JSON.stringify(command)}`).join("\n");
	if (!leftovers().length) return;
	logger.warn(`::warning::Leaked Vitest processes after step exit:\n${describe(leftovers())}`);
	for (const signal of ["SIGTERM", "SIGKILL"]) {
		for (const group of new Set(leftovers().map((member) => member.group))) {
			try {
				kill(-group, signal);
			} catch (error) {
				if (error.code !== "ESRCH") throw error;
			}
		}
		const until = Math.min(deadline, now() + 1000);
		do {
			processes = list();
			if (!leftovers().length) return;
			const remaining = until - now();
			if (remaining <= 0) break;
			wait(Math.min(50, remaining));
		} while (true);
	}
	throw new Error(
		`Vitest processes survived SIGKILL; slow tests remain unconfirmed:\n${describe(leftovers())}`,
	);
}
