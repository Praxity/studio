import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { writeProjectFiles } from "../project-file-transactions";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it("D7 stages one source per replacement in a flat archive and consumes it at installation", async () => {
	const root = await mkdtemp(join(tmpdir(), "journal-stage-"));
	roots.push(root);
	await writeFile(join(root, "a.prax"), "A0");
	await writeFile(join(root, "b.prax"), "B0");
	await writeProjectFiles(
		root,
		[
			{ path: "a.prax", content: "A1" },
			{ path: "b.prax", content: "B1", head: true },
		],
		{
			onStep: async ({ kind, index }) => {
				if (kind !== "staged" || index !== 1) return;
				const journal = JSON.parse(await readFile(join(root, ".praxity-transaction.json"), "utf8"));
				const stage = join(root, journal.plan.stage);
				expect(
					(await readdir(stage, { withFileTypes: true })).filter((entry) => entry.isDirectory()),
				).toEqual([]);
				expect(await readFile(join(stage, "install-0"), "utf8")).toBe("A1");
				expect(await readFile(join(stage, "install-1"), "utf8")).toBe("B1");
			},
		},
	);
	const stage = join(
		root,
		(await readdir(root)).find((name) => name.startsWith(".praxity-write-")) as string,
	);
	expect(
		(await readdir(stage, { withFileTypes: true })).filter((entry) => entry.isDirectory()),
	).toEqual([]);
	for (const source of ["install-0", "install-1"])
		await expect(lstat(join(stage, source))).rejects.toMatchObject({ code: "ENOENT" });
});
