import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isExportStageFilename } from "../export/save-export";
import { readFileWithin, resolveWritablePathWithin } from "../path-security";
import { assertProjectWritesAllowed, isProjectRecoveryPath } from "../project-file-transactions";

/** Keep compiler writes outside the course; retain receipts for interrupted outputs. */
export async function prepareStudioTemporaryOutputs(projectDir: string) {
	assertProjectWritesAllowed();
	const workspaceRoot = await realpath(tmpdir());
	async function reclaim(directory: string): Promise<boolean> {
		let workspace: string | undefined;
		try {
			const recorded = String(
				await readFileWithin(projectDir, path.join(directory, "workspace"), "utf8"),
			);
			const expected = path.join(workspaceRoot, `praxity-studio-${path.basename(directory)}`);
			// A changed temp root or unknown receipt must not authorize arbitrary recursive deletion.
			if (recorded !== expected) return false;
			workspace = await resolveWritablePathWithin(workspaceRoot, expected);
			const entry = await lstat(workspace).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
				return undefined;
			});
			if (entry && !entry.isDirectory()) return false;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		let relative: string;
		try {
			relative = String(
				await readFileWithin(projectDir, path.join(directory, "output-stage"), "utf8"),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			relative = "";
		}
		// Unknown receipts must not authorize deleting authored or journal recovery bytes.
		if (relative) {
			if (path.dirname(relative) !== "exports" || !isExportStageFilename(path.basename(relative)))
				return false;
			const stage = await resolveWritablePathWithin(projectDir, path.join(projectDir, relative));
			if (isProjectRecoveryPath(path.relative(projectDir, stage))) return false;
			await rm(stage, { force: true });
		}
		if (workspace)
			await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		return true;
	}
	let parent = projectDir;
	for (const name of [".praxity", "studio-tmp"]) {
		parent = await resolveWritablePathWithin(projectDir, path.join(parent, name));
		try {
			await mkdir(parent);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (!(await lstat(parent)).isDirectory()) throw error;
		}
	}
	for (const entry of await readdir(parent, { withFileTypes: true })) {
		const match = /^(\d+)-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.exec(entry.name);
		if (!entry.isDirectory() || !match) continue;
		const pid = Number(match[1]);
		if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2_147_483_647) continue;
		const directory = await resolveWritablePathWithin(projectDir, path.join(parent, entry.name));
		const owner = path.join(directory, "owner.pid");
		try {
			if (!(await lstat(owner)).isFile()) continue;
			if ((await readFileWithin(projectDir, owner, "utf8")) !== `${pid}\n`) continue;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		// A reused live PID delays recovery; it must never authorize deleting active outputs.
		try {
			process.kill(pid, 0);
			continue;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "EPERM") continue;
			if (code !== "ESRCH") throw error;
		}
		if (await reclaim(directory))
			await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
	const directory = path.join(parent, `${process.pid}-${randomUUID()}`);
	await mkdir(directory);
	const workspace = path.join(workspaceRoot, `praxity-studio-${path.basename(directory)}`);
	try {
		await resolveWritablePathWithin(workspaceRoot, workspace);
		await mkdir(workspace);
	} catch (error) {
		await rm(directory, { recursive: true });
		throw error;
	}
	try {
		// Receipts contain machine-local paths; keep them out of the course's Git history.
		await writeFile(path.join(directory, ".gitignore"), "*\n", { flag: "wx" });
		await writeFile(path.join(directory, "owner.pid"), `${process.pid}\n`, { flag: "wx" });
		await writeFile(path.join(directory, "workspace"), workspace, { flag: "wx", flush: true });
	} catch (error) {
		await rm(workspace, { recursive: true });
		await rm(directory, { recursive: true });
		throw error;
	}
	return {
		directory: workspace,
		async recordOutputStage(file: string) {
			const relative = path.join("exports", path.basename(file));
			if (
				!isExportStageFilename(path.basename(file)) ||
				(await resolveWritablePathWithin(projectDir, path.join(projectDir, relative))) !== file ||
				isProjectRecoveryPath(path.relative(projectDir, file))
			)
				throw new Error("Invalid owned export stage");
			// Persist before opening the stage, so even a hard exit leaves a recovery receipt.
			await writeFile(path.join(directory, "output-stage"), relative, { flush: true });
		},
		async dispose() {
			if (!(await reclaim(directory))) throw new Error("Unrecognized export recovery receipt");
			await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		},
	};
}
