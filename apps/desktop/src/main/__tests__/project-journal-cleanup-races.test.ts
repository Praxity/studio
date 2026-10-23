import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
	extractProjectRecovery,
	listProjectRecovery,
	projectRecoveryArchives,
	withProjectFileTransaction,
} from "../project-file-transactions";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function contents(directory: string): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) result.push(...(await contents(path)));
		else result.push(await readFile(path, "utf8"));
	}
	return result;
}

for (const outcome of ["save", "rollback"] as const)
	for (const [edit, death, checkpoint, createOnly] of [
		["detach-edit", "finish", "before-unlink", false],
		["detach-edit", "after-unlink", "before-unlink", false],
		["rewrite", "finish", "before-unlink", false],
		["detach-known", "finish", "before-unlink", false],
		["detach-edit", "finish", "retired", true],
	] as const) {
		if (createOnly && outcome === "rollback") continue;
		it(`${outcome} retains the cleanup inode after ${edit}, ${death}, ${checkpoint}, createOnly=${createOnly}`, async () => {
			const root = await mkdtemp(join(tmpdir(), "journal-cleanup-race-"));
			roots.push(root);
			const live = join(root, "lesson.prax");
			if (!createOnly) await writeFile(live, "Original lesson");
			const child = fork(
				fileURLToPath(new URL("./fixtures/journal-cleanup-writer.ts", import.meta.url)),
				[root, outcome, death, checkpoint],
				{
					execArgv: ["--import", "tsx"],
					stdio: ["ignore", "ignore", "pipe", "ipc"],
				},
			);
			let errors = "";
			child.stderr?.on("data", (chunk) => {
				errors += chunk;
			});
			const exited = once(child, "exit");
			const nextCheckpoint = () =>
				Promise.race([
					once(child, "message").then(([message]) => message as { label: string; path: string }),
					exited.then(([code]) => {
						throw new Error(`Cleanup writer exited ${code}: ${errors}`);
					}),
				]);
			try {
				const paused = await nextCheckpoint();
				expect(paused.label).toBe(checkpoint);
				if (edit !== "detach-known") {
					const handle = await open(live, "r+");
					try {
						await handle.truncate(0);
						await handle.writeFile("Unique outside edit on the displaced inode");
						await handle.sync();
					} finally {
						await handle.close();
					}
				}
				if (edit !== "rewrite") {
					await writeFile(join(root, "outside.tmp"), "Outside visible replacement");
					await rename(join(root, "outside.tmp"), live);
					expect((await stat(paused.path)).ino).not.toBe((await stat(live)).ino);
				}
				expect(await readFile(paused.path, "utf8")).toBe(
					edit === "detach-known"
						? outcome === "save"
							? "Saved lesson"
							: "Original lesson"
						: "Unique outside edit on the displaced inode",
				);
				const resumed = nextCheckpoint();
				child.send({ resume: true });
				expect((await resumed).label).toBe(death === "finish" ? "done" : "after-unlink");
			} finally {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
				await exited;
			}
			// Admission after a real death must preserve and report the unique outside bytes.
			// A death during source retirement now precedes installed-N. It reports
			// the preserved outside bytes before the next admission can proceed.
			if (death === "after-unlink")
				await expect(
					withProjectFileTransaction(root, async () => {}, "write", false),
				).rejects.toThrow(/recovery conflict/i);
			await withProjectFileTransaction(root, async () => {}, "write", false);
			expect(await readFile(live, "utf8")).toBe(
				edit === "rewrite"
					? "Unique outside edit on the displaced inode"
					: "Outside visible replacement",
			);
			const archives = await listProjectRecovery(root);
			expect(archives).toHaveLength(1);
			await withProjectFileTransaction(
				root,
				async (canonical) => {
					expect(await projectRecoveryArchives(canonical)).toEqual(
						edit === "detach-known" ? [] : [archives[0].stage],
					);
				},
				"read",
				false,
			);
			const extracted = join(root, "extracted");
			await extractProjectRecovery(root, archives[0].stage, extracted);
			if (edit === "detach-known") {
				// A matching hash alone must not delete the detached inode's archive copy.
				const expected = outcome === "save" ? "Saved lesson" : "Original lesson";
				expect(
					(await contents(extracted)).filter((bytes) => bytes === expected).length,
				).toBeGreaterThan(1);
			} else
				expect(await contents(extracted)).toContain("Unique outside edit on the displaced inode");
		}, 20_000);
	}
