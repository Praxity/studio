import { appendFile, lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	extractProjectRecovery,
	projectRecoveryArchives,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";
import { killCommittedJournal, killJournalWriter } from "./fixtures/kill-journal-writer";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function project() {
	const root = await mkdtemp(join(tmpdir(), "journal-design-"));
	roots.push(root);
	await writeFile(join(root, "a.prax"), "A0");
	await writeFile(join(root, "b.prax"), "B0");
	return root;
}
async function independentStage(directory: string) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await independentStage(path);
		else expect((await lstat(path)).nlink, path).toBe(1);
	}
}
for (const outcome of ["save", "rollback"] as const) {
	it(`D2 leaves only independent archive files after ${outcome}`, async () => {
		const root = await project();
		const save = writeProjectFiles(root, [{ path: "a.prax", content: "A1" }], {
			onStep: async ({ kind }) => {
				if (outcome === "rollback" && kind === "installed") throw new Error("Refuse");
			},
		});
		if (outcome === "rollback") await expect(save).rejects.toThrow("Refuse");
		else await save;
		for (const name of await readdir(root)) {
			if (!name.startsWith(".praxity-write-")) continue;
			await independentStage(join(root, name));
			expect(
				(await readdir(join(root, name))).filter((name) =>
					/^(install|rollback)-\d+(?:\.attempt-[\da-f-]+)?$/.test(name),
				),
			).toEqual([]);
		}
	});
}
for (const step of ["design:capture", "design:capture-directory-1", "design:capture-directory-2"]) {
	const checkpoint = step === "design:capture" ? "" : ` at ${step}`;
	it(`design probe B restores a capture after real process death without aliasing the live file${checkpoint}`, async () => {
		const root = await project();
		await killJournalWriter(root, step);
		await expect(readFile(join(root, "a.prax"))).rejects.toMatchObject({ code: "ENOENT" });
		const journal = JSON.parse(await readFile(join(root, ".praxity-transaction.json"), "utf8"));
		const stage = join(root, journal.plan.stage);
		const capture = join(
			stage,
			(await readdir(stage)).find((name) => /^install-0\.capture-/.test(name)) as string,
		);
		expect(await readFile(capture, "utf8")).toBe("A0");
		await withProjectFileTransaction(root, async () => {}, "write");
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A0");
		expect(await readFile(join(root, "b.prax"), "utf8")).toBe("B0");
		const extracted = join(root, "extracted");
		await extractProjectRecovery(root, journal.plan.stage, extracted);
		expect(await readFile(join(extracted, "original", "a.prax"), "utf8")).toBe("A0");
		expect(await readFile(join(extracted, "replacement", "a.prax"), "utf8")).toBe("A1");
		expect((await lstat(capture)).ino).not.toBe((await lstat(join(root, "a.prax"))).ino);
		await independentStage(stage);
		await appendFile(join(root, "a.prax"), " outside-in-place-edit");
		await withProjectFileTransaction(
			root,
			async (canonical) => {
				expect(await projectRecoveryArchives(canonical)).toEqual([]);
			},
			"write",
		);
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A0 outside-in-place-edit");
	});
}

it("design probe B restores the second capture and rolls back the installed first file", async () => {
	const root = await project();
	await killJournalWriter(root, "design:capture-b");
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
	await expect(readFile(join(root, "b.prax"))).rejects.toMatchObject({ code: "ENOENT" });
	const journal = JSON.parse(await readFile(join(root, ".praxity-transaction.json"), "utf8"));
	const stage = join(root, journal.plan.stage);
	const capture = (await readdir(stage)).find((name) =>
		/^install-1\.capture-/.test(name),
	) as string;
	expect(await readFile(join(stage, capture), "utf8")).toBe("B0");
	await withProjectFileTransaction(root, async () => {}, "write");
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A0");
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe("B0");
	await withProjectFileTransaction(
		root,
		async (canonical) => {
			expect(await projectRecoveryArchives(canonical)).toEqual([]);
		},
		"write",
	);
	expect((await readdir(root)).sort()).toEqual(["a.prax", "b.prax"]);
});

for (const step of ["design:link", "design:recover-link"] as const) {
	it(`D2 isolates archives after death between publication and source retirement at ${step}`, async () => {
		const root = await project();
		if (step === "design:recover-link") await killJournalWriter(root, "design:capture");
		await killJournalWriter(root, step);
		await withProjectFileTransaction(root, async () => {}, "write");
		for (const name of await readdir(root))
			if (name.startsWith(".praxity-write-")) await independentStage(join(root, name));
		await appendFile(join(root, "a.prax"), " outside");
		await withProjectFileTransaction(
			root,
			async (canonical) => {
				expect(await projectRecoveryArchives(canonical)).toEqual([]);
			},
			"write",
		);
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A0 outside");
	});
}

it("D3 resumes reclamation after death immediately after the quarantine rename", async () => {
	const root = await project();
	await killCommittedJournal(root, [{ path: "a.prax", content: "A1" }]);
	await withProjectFileTransaction(root, async () => {}, "write", false);
	await killJournalWriter(root, "design:reclaim");
	expect((await readdir(root)).some((name) => name.includes(".reclaim-"))).toBe(true);
	await withProjectFileTransaction(
		root,
		async (canonical) => {
			expect(await projectRecoveryArchives(canonical, true)).toEqual([]);
		},
		"write",
	);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
});

it("retains a malformed archived installation identity without blocking the next write admission", async () => {
	const root = await project();
	await killCommittedJournal(root, [{ path: "a.prax", content: "A1" }]);
	await withProjectFileTransaction(root, async () => {}, "write", false);
	const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-")) as string;
	const path = join(root, stage, "install-0.identity");
	await writeFile(path, "partial identity record");
	await withProjectFileTransaction(
		root,
		async (canonical) => {
			expect(await projectRecoveryArchives(canonical)).toEqual([stage]);
		},
		"write",
	);
	expect(await readFile(path, "utf8")).toBe("partial identity record");
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
});
