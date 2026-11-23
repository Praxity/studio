import { spawnSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { projectDiskSnapshot } from "../../test-utils/interrupted-project-write";
import { prepareStudioTemporaryOutputs } from "../studio/temporary-outputs";

it("compiler workspace writes leave the opened project's disk snapshot unchanged", async () => {
	const project = await mkdtemp(path.join(os.tmpdir(), "studio-temporary-snapshot-test-"));
	expect(spawnSync("git", ["init", project]).status).toBe(0);
	await writeFile(path.join(project, "lesson.prax"), "authored");
	const active = await prepareStudioTemporaryOutputs(project);
	try {
		const before = await projectDiskSnapshot(project);
		await writeFile(path.join(active.directory, "preview.html"), "compiled preview");
		expect(await projectDiskSnapshot(project)).toEqual(before);
		const status = spawnSync(
			"git",
			["-C", project, "status", "--porcelain", "--untracked-files=all"],
			{
				encoding: "utf8",
			},
		);
		expect(status.status).toBe(0);
		expect(status.stdout.trim()).toBe("?? lesson.prax");
	} finally {
		await active.dispose();
		await rm(project, { recursive: true, force: true });
	}
});

it("recovers only marked outputs of dead owners and retains live, unowned and linked files", async () => {
	const project = await mkdtemp(path.join(os.tmpdir(), "studio-temporary-test-"));
	const owners: Awaited<ReturnType<typeof prepareStudioTemporaryOutputs>>[] = [];
	let external: string | undefined;
	try {
		const active = await prepareStudioTemporaryOutputs(project);
		owners.push(active);
		await writeFile(path.join(active.directory, "active.tmp"), "active");
		const parent = path.join(project, ".praxity/studio-tmp");
		await mkdir(path.join(project, "exports"));
		const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
		const abandoned = path.join(parent, `${deadPid}-12345678-1234-1234-1234-123456789abc`);
		await mkdir(abandoned);
		await writeFile(path.join(abandoned, "owner.pid"), `${deadPid}\n`);
		await writeFile(path.join(abandoned, "staged.zip.tmp"), "partial");
		external = path.join(await realpath(os.tmpdir()), `praxity-studio-${path.basename(abandoned)}`);
		await mkdir(external);
		await writeFile(path.join(external, "preview.html"), "interrupted preview");
		await writeFile(path.join(abandoned, "workspace"), external);
		const stageName = ".partial.zip.12345678-1234-1234-1234-123456789abc.tmp";
		await writeFile(path.join(project, "exports", stageName), "partial output");
		await writeFile(path.join(abandoned, "output-stage"), path.join("exports", stageName));
		const malformed = path.join(parent, `${deadPid}-12345678-1234-1234-1234-123456789abf`);
		await mkdir(malformed);
		await writeFile(path.join(malformed, "owner.pid"), `${deadPid}\n`);
		await writeFile(path.join(malformed, "output-stage"), "lesson.prax");
		await writeFile(path.join(project, "lesson.prax"), "authored");
		const unknownWorkspace = path.join(parent, `${deadPid}-12345678-1234-1234-1234-123456789ab1`);
		await mkdir(unknownWorkspace);
		await writeFile(path.join(unknownWorkspace, "owner.pid"), `${deadPid}\n`);
		await writeFile(path.join(unknownWorkspace, "workspace"), project);
		const unmarked = path.join(parent, `${deadPid}-12345678-1234-1234-1234-123456789abd`);
		await mkdir(unmarked);
		await writeFile(path.join(unmarked, "keep"), "unowned");
		const linked = path.join(parent, `${deadPid}-12345678-1234-1234-1234-123456789abe`);
		await symlink(unmarked, linked, "junction");
		await writeFile(path.join(project, "exports/complete.zip"), "complete");
		const next = await prepareStudioTemporaryOutputs(project);
		owners.push(next);
		expect(await readdir(parent)).not.toContain(path.basename(abandoned));
		await expect(readFile(path.join(external, "preview.html"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(await readdir(path.join(project, "exports"))).not.toContain(stageName);
		expect(await readFile(path.join(malformed, "output-stage"), "utf8")).toBe("lesson.prax");
		expect(await readFile(path.join(project, "lesson.prax"), "utf8")).toBe("authored");
		expect(await readFile(path.join(unknownWorkspace, "workspace"), "utf8")).toBe(project);
		expect(await readFile(path.join(active.directory, "active.tmp"), "utf8")).toBe("active");
		expect(await readFile(path.join(unmarked, "keep"), "utf8")).toBe("unowned");
		expect(await readFile(path.join(linked, "keep"), "utf8")).toBe("unowned");
		expect(await readFile(path.join(project, "exports/complete.zip"), "utf8")).toBe("complete");
	} finally {
		await Promise.all(owners.map((owner) => owner.dispose()));
		if (external) await rm(external, { recursive: true, force: true });
		await rm(project, { recursive: true, force: true });
	}
});

it("refuses a linked workspace root without deleting outside files", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "studio-temporary-link-test-"));
	try {
		const project = path.join(root, "course");
		const outside = path.join(root, "outside");
		await mkdir(project);
		await mkdir(outside);
		await writeFile(path.join(outside, "keep"), "outside");
		await symlink(outside, path.join(project, ".praxity"), "junction");
		await expect(prepareStudioTemporaryOutputs(project)).rejects.toThrow("Symbolic links");
		expect(await readdir(outside)).toEqual(["keep"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
