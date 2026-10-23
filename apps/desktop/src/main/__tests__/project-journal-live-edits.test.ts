import { mkdir, mkdtemp, open, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	listProjectRecovery,
	projectRecoveryArchives,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";

const scratch: string[] = [];
afterEach(async () => {
	await Promise.all(scratch.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("retirement keeps unknown installation-like bytes for recovery", async () => {
	const root = await project();
	const unknown = "install-0.attempt-deadbeef";
	await writeProjectFiles(root, [{ path: "lesson.prax", content: "Saved lesson" }], {
		onStep: async ({ kind }) => {
			if (kind !== "installed") return;
			const [archive] = await listProjectRecovery(root);
			// Forward installation never creates an attempt name, even with known bytes.
			await writeFile(join(root, archive.stage, unknown), "Saved lesson");
		},
	});
	await withProjectFileTransaction(root, async (canonical) => {
		const [archive] = await projectRecoveryArchives(canonical);
		expect(archive).toBeDefined();
		expect(await readFile(join(canonical, archive, unknown), "utf8")).toBe("Saved lesson");
	});
});

async function project() {
	const parent = await mkdtemp(join(tmpdir(), "journal-live-edits-"));
	scratch.push(parent);
	await mkdir(join(parent, "real"));
	await mkdir(join(parent, "real", "project"));
	await symlink(join(parent, "real"), join(parent, "alias"), "junction");
	const root = join(parent, "alias", "project");
	await writeFile(join(root, "lesson.prax"), "Original lesson");
	return root;
}

for (const outcome of ["save", "rollback"] as const)
	for (const edit of ["rewrite", "remove"] as const) {
		it(`a lesson reached through a linked parent can ${edit} after ${outcome} without a recovery notice`, async () => {
			const root = await project();
			const write = writeProjectFiles(root, [{ path: "lesson.prax", content: "Saved lesson" }], {
				onStep: async ({ kind }) => {
					if (outcome === "rollback" && kind === "installed") throw new Error("Forced refusal");
				},
			});
			if (outcome === "rollback") await expect(write).rejects.toThrow("Forced refusal");
			else await write;
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
				outcome === "rollback" ? "Original lesson" : "Saved lesson",
			);
			// Outside editors may change the visible file before another Studio admission.
			await writeFile(join(root, "lesson.prax"), "Outside edit of the saved lesson");
			if (edit === "remove") await rm(join(root, "lesson.prax"));
			await withProjectFileTransaction(root, async (canonical) => {
				expect(await projectRecoveryArchives(canonical)).toEqual([]);
				if (edit === "rewrite")
					expect(await readFile(join(canonical, "lesson.prax"), "utf8")).toBe(
						"Outside edit of the saved lesson",
					);
				else
					await expect(readFile(join(canonical, "lesson.prax"))).rejects.toMatchObject({
						code: "ENOENT",
					});
			});
		});
	}

it("a linked parent's displaced open inode still keeps outside edits for recovery", async () => {
	const root = await project();
	const handle = await open(join(root, "lesson.prax"), "r+");
	try {
		await writeProjectFiles(root, [{ path: "lesson.prax", content: "Saved lesson" }]);
		await handle.truncate(0);
		await handle.writeFile("Outside edit through the displaced handle");
		await handle.sync();
		await withProjectFileTransaction(root, async (canonical) => {
			const archives = await projectRecoveryArchives(canonical);
			expect(archives).toHaveLength(1);
			const capture = (await readdir(join(canonical, archives[0]))).find((name) =>
				name.startsWith("install-0.capture-"),
			);
			expect(capture).toBeDefined();
			expect(await readFile(join(canonical, archives[0], capture as string), "utf8")).toBe(
				"Outside edit through the displaced handle",
			);
			expect(await readFile(join(canonical, "lesson.prax"), "utf8")).toBe("Saved lesson");
		});
	} finally {
		await handle.close();
	}
});
