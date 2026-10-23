import { mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	projectRecoveryArchives,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";
import { killCommittedJournal, killJournalWriter } from "./fixtures/kill-journal-writer";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("removes its finished committed stage when it has no displaced recovery inode", async () => {
	const root = await mkdtemp(join(tmpdir(), "save-stage-cleanup-"));
	roots.push(root);
	expect(
		await writeProjectFiles(root, [
			{ path: "new.prax", content: "New lesson", expectedContent: null },
		]),
	).toEqual({});
	expect(await readdir(root)).toEqual(["new.prax"]);
	expect(await readFile(join(root, "new.prax"), "utf8")).toBe("New lesson");
});

it.each(["replacement", "deletion"])(
	"keeps the displaced %s inode after commit for a later outside edit",
	async (operation) => {
		const root = await mkdtemp(join(tmpdir(), "save-stage-cleanup-"));
		roots.push(root);
		await writeFile(join(root, "lesson.prax"), "Original lesson");
		const outside = await open(join(root, "lesson.prax"), "r+");
		try {
			expect(
				await writeProjectFiles(root, [
					{
						path: "lesson.prax",
						content: operation === "replacement" ? "Saved lesson" : null,
						expectedContent: "Original lesson",
					},
				]),
			).toEqual({});
			const [archive] = await projectRecoveryArchives(root, true);
			expect(archive).toBeTruthy();
			const [capture] = (await readdir(join(root, archive))).filter((name) =>
				/^install-0\.capture-/.test(name),
			);
			expect(await readFile(join(root, archive, capture), "utf8")).toBe("Original lesson");
			await outside.truncate(0);
			await outside.writeFile("Outside edit after save");
			await outside.sync();
			expect(await projectRecoveryArchives(root)).toEqual([archive]);
			await writeProjectFiles(root, [{ path: "new.prax", content: "New lesson" }]);
			expect(await readFile(join(root, archive, capture), "utf8")).toBe("Outside edit after save");
			expect(await projectRecoveryArchives(root, true)).toEqual([archive]);
			if (operation === "replacement")
				expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("Saved lesson");
			else
				await expect(readFile(join(root, "lesson.prax"))).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await outside.close();
		}
	},
);

it("read admission keeps an uncommitted stage and its pending journal unchanged", async () => {
	const root = await mkdtemp(join(tmpdir(), "save-stage-cleanup-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), "Old words.");
	await writeFile(join(root, "second.prax"), "second old");
	await writeFile(join(root, "head.json"), "head old");
	await killJournalWriter(root, "staged:0", ["Old words.", "second old"]);
	const [archive] = await projectRecoveryArchives(root, true);
	const journal = await readFile(join(root, ".praxity-transaction.json"));
	await expect(withProjectFileTransaction(root, async () => {})).rejects.toMatchObject({
		code: "ERECOVERYREQUIRED",
	});
	expect(await readFile(join(root, ".praxity-transaction.json"))).toEqual(journal);
	expect(await readFile(join(root, archive, "install-0"), "utf8")).toBe("New words.");
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("Old words.");
});

it("keeps a recovered committed crash archive through another save in the same admission", async () => {
	const root = await mkdtemp(join(tmpdir(), "save-stage-cleanup-"));
	roots.push(root);
	await writeFile(join(root, "a.prax"), "A0");
	await killCommittedJournal(root, [{ path: "a.prax", content: "A1" }]);
	const [archive] = await projectRecoveryArchives(root, true);
	await withProjectFileTransaction(
		root,
		async () => {
			await writeProjectFiles(root, [{ path: "new.prax", content: "New lesson" }]);
		},
		"write",
		false,
	);
	expect(await projectRecoveryArchives(root, true)).toEqual([archive]);
	const [capture] = (await readdir(join(root, archive))).filter((name) =>
		/^install-0\.capture-/.test(name),
	);
	expect(await readFile(join(root, archive, capture), "utf8")).toBe("A0");
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
	expect(await readFile(join(root, "new.prax"), "utf8")).toBe("New lesson");
});

it("retains original recovery bytes after acknowledging replacements, creation and deletion", async () => {
	const root = await mkdtemp(join(tmpdir(), "save-stage-cleanup-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), "Original lesson");
	await writeFile(join(root, "old.prax"), "Deleted lesson");
	expect(
		await writeProjectFiles(root, [
			{ path: "lesson.prax", content: "Saved lesson", expectedContent: "Original lesson" },
			{ path: "new.prax", content: "New lesson", expectedContent: null },
			{ path: "old.prax", content: null, expectedContent: "Deleted lesson" },
		]),
	).toEqual({});
	const [archive] = await projectRecoveryArchives(root, true);
	expect(archive).toBeTruthy();
	expect((await readdir(root)).sort()).toEqual([archive, "lesson.prax", "new.prax"].sort());
	const captures = (await readdir(join(root, archive))).filter((name) => /\.capture-/.test(name));
	expect(captures).toHaveLength(2);
	expect(
		(await Promise.all(captures.map((name) => readFile(join(root, archive, name), "utf8")))).sort(),
	).toEqual(["Deleted lesson", "Original lesson"]);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("Saved lesson");
	expect(await readFile(join(root, "new.prax"), "utf8")).toBe("New lesson");
});
