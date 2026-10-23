import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { writeLessonSource } from "../lesson-source";
import { withProjectFileTransaction, writeProjectFiles } from "../project-file-transactions";
import { killJournalWriter } from "./fixtures/kill-journal-writer";

const faults = vi.hoisted(() => ({
	afterLink: false,
	partialStage: false,
	identityRead: 0,
	rootSync: "",
	readOnlyTarget: "",
}));
// Exercise POSIX directory synchronization on Windows while preserving path admission semantics.
vi.mock("node:path", async (importOriginal) => {
	const path = await importOriginal<typeof import("node:path")>();
	return {
		...path,
		relative: (...args: Parameters<typeof path.relative>) => {
			const value = path.relative(...args);
			return process.platform === "win32" ? value : value.replaceAll("\\", "/");
		},
	};
});
// Fail at the filesystem boundary, including a rename that completed before I/O reported failure.
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		access: async (...args: Parameters<typeof fs.access>) => {
			if (String(args[0]) === faults.readOnlyTarget)
				throw Object.assign(new Error("Read only"), { code: "EACCES" });
			return fs.access(...args);
		},
		link: async (...args: Parameters<typeof fs.link>) => {
			await fs.link(...args);
			if (faults.afterLink && String(args[1]).endsWith("lesson.prax")) {
				faults.afterLink = false;
				throw Object.assign(new Error("Replacement acknowledgement failed"), { code: "EIO" });
			}
		},
		open: async (...args: Parameters<typeof fs.open>) => {
			const entry =
				process.platform !== "win32"
					? await fs.lstat(args[0]).catch((error: NodeJS.ErrnoException) => {
							if (error.code !== "ENOENT") throw error;
							return undefined;
						})
					: undefined;
			if (entry?.isDirectory()) {
				return {
					close: async () => {},
					sync: async () => {
						if (String(args[0]) === faults.rootSync) {
							faults.rootSync = "";
							throw Object.assign(new Error("Directory fsync failed after link"), { code: "EIO" });
						}
					},
				};
			}
			const file = await fs.open(...args);
			if (
				faults.identityRead > 0 &&
				String(args[0]).includes(join(".praxity", "identity", "lessons")) &&
				String(args[0]).endsWith(".json")
			) {
				const read = file.readFile.bind(file);
				file.readFile = (async (...options: Parameters<typeof file.readFile>) => {
					const result = await read(...options);
					faults.identityRead--;
					if (faults.identityRead === 0) await fs.writeFile(args[0], "external identity");
					return result;
				}) as typeof file.readFile;
			}
			if (
				faults.partialStage &&
				String(args[0]).includes(".praxity-write-") &&
				(String(args[0]).endsWith("lesson.prax") || String(args[0]).endsWith("install-0"))
			) {
				faults.partialStage = false;
				file.writeFile = async () => {
					await file.write("PARTIAL");
					throw new Error("Staged write failed");
				};
			}
			return file;
		},
	};
});
const roots: string[] = [];
async function project() {
	const root = await mkdtemp(join(tmpdir(), "journal-fault-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), "original");
	await writeFile(join(root, "head.json"), "old head");
	return root;
}
afterEach(async () => {
	faults.afterLink = false;
	faults.partialStage = false;
	faults.identityRead = 0;
	faults.rootSync = "";
	faults.readOnlyTarget = "";
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("T1 retains the linked journal's stage when publication directory fsync fails", async () => {
	const root = await project();
	const descriptor = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
	Object.defineProperty(process, "platform", { value: "linux" });
	try {
		faults.rootSync = root;
		await expect(
			writeProjectFiles(root, [{ path: "lesson.prax", content: "edited" }]),
		).rejects.toThrow(/fsync/);
		await expect(
			withProjectFileTransaction(
				root,
				async () => readFile(join(root, "lesson.prax"), "utf8"),
				"write",
			),
		).resolves.toBe("original");
	} finally {
		Object.defineProperty(process, "platform", descriptor);
	}
});

for (const step of ["head:2", "journal"]) {
	it(`T1 finalizes ${step} without requiring write access to unchanged targets`, async () => {
		const root = await project();
		await writeFile(join(root, "lesson.prax"), "# Café 😀\r\nOld words.\nKeep this.\rLast line");
		await writeFile(join(root, "second.prax"), "second old");
		await writeFile(join(root, "head.json"), "head old");
		await killJournalWriter(root, step);
		faults.readOnlyTarget = join(root, "lesson.prax");
		await expect(
			withProjectFileTransaction(
				root,
				async () => readFile(join(root, "second.prax"), "utf8"),
				"write",
			),
		).resolves.toBe(step === "journal" ? "second old" : "second new");
	});
}

it("design probe A keeps committed peers after death at the last head and an outside edit", async () => {
	const root = await project();
	await writeFile(join(root, "a.prax"), "A0");
	await writeFile(join(root, "b.prax"), "B0");
	await killJournalWriter(root, "design:head:1");
	await writeFile(join(root, "b.prax"), "B2-outside");
	await withProjectFileTransaction(root, async () => {}, "write");
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe("B2-outside");
	expect(await readdir(root)).not.toContain(".praxity-transaction.json");
});

it("keeps a completed live save when an outside edit follows the last installed marker", async () => {
	const root = await project();
	const result = await writeProjectFiles(
		root,
		[
			{ path: "lesson.prax", content: "edited", expectedContent: "original" },
			{ path: "head.json", content: "new head", expectedContent: "old head", head: true },
		],
		{
			onStep: async ({ kind }) => {
				if (kind === "head") await writeFile(join(root, "head.json"), "outside head");
			},
		},
	);
	expect(result).toEqual({});
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("edited");
	expect(await readFile(join(root, "head.json"), "utf8")).toBe("outside head");
});

it("T1 restores a replacement whose link succeeded before reporting failure", async () => {
	const root = await project();
	faults.afterLink = true;
	await expect(
		writeProjectFiles(root, [
			{ path: "lesson.prax", content: "edited", expectedContent: "original" },
			{ path: "head.json", content: "new head", expectedContent: "old head", head: true },
		]),
	).rejects.toMatchObject({ code: "EIO" });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("original");
	expect(await readFile(join(root, "head.json"), "utf8")).toBe("old head");
	expect((await readdir(root)).filter((name) => name.startsWith(".praxity-write-"))).toHaveLength(
		1,
	);
	await withProjectFileTransaction(root, async () => {}, "write");
	expect(await readdir(root)).toEqual(["head.json", "lesson.prax"]);
});

it("T1 discards a partial staged lesson write without touching source or head", async () => {
	const root = await project();
	faults.partialStage = true;
	await expect(
		writeProjectFiles(root, [
			{ path: "lesson.prax", content: "edited", expectedContent: "original" },
			{ path: "head.json", content: "new head", expectedContent: "old head", head: true },
		]),
	).rejects.toThrow("Staged write failed");
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("original");
	expect(await readFile(join(root, "head.json"), "utf8")).toBe("old head");
	expect(await readdir(root)).toEqual(["head.json", "lesson.prax"]);
});

it("T1 refuses an identity changed after it was read without rolling over the external bytes", async () => {
	const root = await project();
	await writeLessonSource(root, "lesson.prax", "# Original\n\nOriginal words.\n", "original");
	const source = await readFile(join(root, "lesson.prax"), "utf8");
	const headPath = join(
		root,
		".praxity",
		"identity",
		"lessons",
		(await readdir(join(root, ".praxity", "identity", "lessons")))[0],
	);
	faults.identityRead = 2;
	await expect(
		writeLessonSource(
			root,
			"lesson.prax",
			source.replace("Original words.", "Edited words."),
			source,
		),
	).rejects.toThrow(/changed on disk/i);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
	expect(await readFile(headPath, "utf8")).toBe("external identity");
});
