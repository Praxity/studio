import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
	type AdmittedAssets,
	ProjectAssetInventory,
} from "../src/main/export/project-asset-inventory.ts";

const base = process.argv[2];
const clockSkew = Number(process.argv[3] ?? 0);
const iterationsPerMode = Number(process.argv[4] ?? 500);
if (!base) throw new Error("Pass scratch directory on tested volume");
if (!Number.isFinite(clockSkew)) throw new Error("Clock skew must be finite milliseconds");
if (!Number.isSafeInteger(iterationsPerMode) || iterationsPerMode < 1)
	throw new Error("Iterations per mode must be a positive integer");
await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, "native-"));
await mkdir(path.join(root, "assets"));
const file = path.join(root, "assets", "a.png");
const firstTarget = path.join(root, "one");
const secondTarget = path.join(root, "two");
await writeFile(firstTarget, "first");
await writeFile(secondTarget, "other");
// Eight admissions per read exercise the actual #1404 parallel batch.
for (let i = 0; i < 7; i++) await writeFile(path.join(root, "assets", `b${i}.png`), "batch");
const writer = new Worker(new URL("./inventory-native-writer.mjs", import.meta.url));
const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
let sequence = 0;
writer.on("message", (result) => {
	const p = pending.get(result.id);
	if (!p) throw new Error(`Unsolicited writer result ${result.id}`);
	pending.delete(result.id);
	if (result.error) p.reject(new Error(result.stack ?? result.error));
	else p.resolve();
});
writer.on("error", (error) => {
	for (const p of pending.values()) p.reject(error);
	pending.clear();
});
writer.on("exit", (code) => {
	for (const p of pending.values())
		p.reject(new Error(`Writer exited with pending mutation: ${code}`));
	pending.clear();
});
const mutate = (data: object) =>
	new Promise<void>((resolve, reject) => {
		const id = ++sequence;
		pending.set(id, { resolve, reject });
		writer.postMessage({ id, file, replacement: "other", ...data });
	});
const realNow = Date.now;
Date.now = () => realNow() + clockSkew;
const stamps = (s: BigIntStats) => ({
	dev: String(s.dev),
	ino: String(s.ino),
	size: String(s.size),
	mtimeNs: String(s.mtimeNs),
	ctimeNs: String(s.ctimeNs),
});
interface Summary {
	mode: string;
	iterations: number;
	staleRaced: number;
	stalePostWrite: number;
	refusals: number;
	changedStamps: number;
	repeatedStamps: number;
}
const summaries: Summary[] = [];
try {
	for (const mode of ["same-size", "truncate-extend", "rename-replace", "symlink-retarget"]) {
		let staleRaced = 0,
			stalePostWrite = 0,
			refusals = 0,
			changedStamps = 0,
			repeatedStamps = 0;
		for (let iteration = 0; iteration < iterationsPerMode; iteration++) {
			await unlink(file).catch((error) => {
				if (error.code !== "ENOENT") throw error;
			});
			if (mode === "symlink-retarget") await symlink(firstTarget, file, "file");
			else await writeFile(file, "first");
			let mutation: Promise<void> | undefined;
			let sample:
				| {
						before: ReturnType<typeof stamps>;
						after: ReturnType<typeof stamps>;
						current: ReturnType<typeof stamps>;
				  }
				| undefined;
			const restore = mode === "symlink-retarget" && iteration % 2 === 1 ? firstTarget : undefined;
			const expected = restore ? "first" : "other";
			const inventory = new ProjectAssetInventory(root, async (handle) => {
				const before = await handle.stat({ bigint: true });
				const bytes = await handle.readFile();
				if (!mutation && bytes.toString() === "first") {
					// Writer thread operates while the inventory read owns its handle.
					// Completion barrier makes the following byte verification owe current bytes.
					mutation = mutate({ mode, target: secondTarget, restore });
					await mutation;
					const after = await handle.stat({ bigint: true });
					const current = await stat(file, { bigint: true });
					sample = { before: stamps(before), after: stamps(after), current: stamps(current) };
					if (
						before.mtimeNs === after.mtimeNs &&
						before.ctimeNs === after.ctimeNs &&
						before.ino === after.ino &&
						before.size === after.size
					)
						repeatedStamps++;
					else changedStamps++;
				}
				return bytes;
			});
			let raced: AdmittedAssets | undefined;
			try {
				raced = await inventory.read();
			} catch (error) {
				if (!String(error).includes("Asset changed while reading")) throw error;
				refusals++;
			}
			if (!mutation) throw new Error("Mutation did not run");
			await mutation;
			const retained = await inventory.read();
			// Independent cold read occurs after writer completion and before another mutation.
			const fresh = await new ProjectAssetInventory(root).read();
			const disk = await readFile(file, "utf8");
			const actual = raced
				? Buffer.from(raced.bytes.get("assets/a.png") ?? []).toString()
				: undefined;
			const next = Buffer.from(retained.bytes.get("assets/a.png") ?? []).toString();
			const cold = Buffer.from(fresh.bytes.get("assets/a.png") ?? []).toString();
			if (disk !== expected || cold !== expected)
				throw new Error(`Bad oracle ${JSON.stringify({ disk, cold, expected })}`);
			const digest = createHash("sha256").update(expected).digest("hex");
			if (raced && (actual !== expected || raced.digests.get("assets/a.png") !== digest))
				staleRaced++;
			if (next !== expected || retained.digests.get("assets/a.png") !== digest) stalePostWrite++;
			if ((actual !== undefined && actual !== expected) || next !== expected) {
				if (staleRaced + stalePostWrite <= 12)
					console.log(
						JSON.stringify({
							event: "stale",
							mode,
							iteration,
							actual,
							next,
							expected,
							disk,
							cold,
							clockSkew,
							...sample,
						}),
					);
			}
		}
		const summary = {
			mode,
			iterations: iterationsPerMode,
			staleRaced,
			stalePostWrite,
			refusals,
			changedStamps,
			repeatedStamps,
		};
		summaries.push(summary);
		console.log(JSON.stringify(summary));
	}
	console.log(
		JSON.stringify({
			event: "summary",
			root,
			clockSkew,
			iterations: 4 * iterationsPerMode,
			results: summaries,
		}),
	);
	if (summaries.some((result) => result.staleRaced > 0 || result.stalePostWrite > 0))
		process.exitCode = 1;
} finally {
	Date.now = realNow;
	await writer.terminate();
}
