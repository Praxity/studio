import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCourseIdentity } from "../identity-store";
import {
	deleteLessonSource,
	parseLessonSource,
	readLessonSource,
	renameProjectSource,
	writeLessonSource,
} from "../lesson-source";
import * as pathSecurity from "../path-security";

const recreation = vi.hoisted(() => ({ path: "", content: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		link: async (...args: Parameters<typeof fs.link>) => {
			if (recreation.path === String(args[1]) && recreation.path.endsWith("target.prax")) {
				await fs.writeFile(recreation.path, recreation.content);
				recreation.path = "";
			}
			if (
				recreation.path &&
				String(args[1]).includes(
					`${join("identity", "lessons")}${process.platform === "win32" ? "\\" : "/"}`,
				)
			) {
				await fs.writeFile(recreation.path, recreation.content);
				recreation.path = "";
				throw new Error("Identity installation failed");
			}
			return fs.link(...args);
		},
	};
});
const temporaryDirectories: string[] = [];
async function project() {
	const directory = await mkdtemp(join(tmpdir(), "prax-page-identities-"));
	temporaryDirectories.push(directory);
	return directory;
}
// Windows maps chmod onto the read-only attribute alone: writable files report 0o666 and
// writing a read-only file fails with EPERM rather than EACCES.
const OWNER_ONLY_MODE = process.platform === "win32" ? 0o666 : 0o600;
const READ_ONLY_ERROR_CODE = process.platform === "win32" ? "EPERM" : "EACCES";
const lesson =
	"---\ntitle: Example\n---\n\n# First\n\nFirst page. A stable paragraph keeps its identity through the source edits tested here.\n\n# Second\n\nSecond page.\n";
const lessonWithBlocks =
	"# First\n\n::: choice First question about keeping a stable assessment identity through these source edits\n(x) Yes\n( ) No\n:::\n\n# Second\n\n::: choice Second question\n( ) Yes\n(x) No\n:::\n";
const savedIds = new Map<string, string[]>();
async function assertMatched(root: string, filename: string, source: string) {
	const previous = savedIds.get(`${root}/${filename}`);
	if (!previous) return;
	const current = await resolveCourseIdentity(root, {
		lessonPaths: [filename],
		sources: { [filename]: source },
	});
	expect(current.identity.sourceMappings.map((node) => node.id)).toEqual(
		expect.arrayContaining(previous),
	);
}
async function metadataPath(root: string) {
	const [name] = await readdir(join(root, ".praxity", "identity", "lessons"));
	return join(root, ".praxity", "identity", "lessons", name);
}
async function metadata(root: string) {
	const paths = (await readdir(root, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".prax"))
		.map((entry) => entry.name);
	const identity = await resolveCourseIdentity(root, { lessonPaths: paths });
	return {
		lessons: Object.fromEntries(
			[...identity.lessons].map(([file, read]) => [
				file,
				read.pages.map((page) => ({ id: page.id })),
			]),
		),
		blocks: Object.fromEntries(
			[...identity.lessons].map(([file, read]) => [
				file,
				read.blocks
					.filter((block) => block.type === "assessment")
					.map((block) => ({ id: block.id })),
			]),
		),
	};
}
async function save(root: string, filename: string, source: string, expected?: string) {
	await assertMatched(root, filename, source);
	await writeLessonSource(root, filename, source, expected);
	const parsed = await parseLessonSource(root, filename, source);
	savedIds.set(`${root}/${filename}`, [...parsed.nodes.keys()]);
	return {
		source,
		pageIdentities: parsed.pages.map((page) => ({ id: page.id })),
		blockIdentities: parsed.blocks
			.filter((block) => block.type === "assessment")
			.map((block) => ({ id: block.id })),
	};
}
async function isLessonWrite(root: string, path: string): Promise<boolean> {
	if (basename(path) === "lesson.prax") return true;
	const match = /^install-(\d+)$/.exec(basename(path));
	if (!match) return false;
	const journal = JSON.parse(await readFile(join(root, ".praxity-transaction.json"), "utf8"));
	return journal.plan.files[Number(match[1])]?.path === "lesson.prax";
}

afterEach(async () => {
	savedIds.clear();
	recreation.path = "";
	vi.restoreAllMocks();
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("grammar 4 source and identity transaction safety", () => {
	it("source reads retain exact bytes and recovery stages without identity migration", async () => {
		const root = await project();
		const stage = join(root, ".praxity-write-lesson.prax.abandoned");
		await mkdir(stage);
		await writeFile(join(stage, "lesson.prax"), "RECOVERY BYTES");
		await writeFile(join(root, "lesson.prax"), lesson);
		expect(await readLessonSource(root, "lesson.prax")).toBe(lesson);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(lesson);
		expect(await readFile(join(stage, "lesson.prax"), "utf8")).toBe("RECOVERY BYTES");
		expect(await readdir(root)).toEqual([".praxity-write-lesson.prax.abandoned", "lesson.prax"]);
	});
	it("parsing preserves abandoned stages and creates no identity files", async () => {
		const root = await project();
		const stage = join(root, ".praxity-write-lesson.prax.abandoned");
		await mkdir(stage);
		await writeFile(join(stage, "lesson.prax"), "RECOVERY BYTES");
		await expect(parseLessonSource(root, "lesson.prax", lesson)).rejects.toThrow(
			/established course/,
		);
		expect(await readdir(root)).toEqual([".praxity-write-lesson.prax.abandoned"]);
		expect(await readFile(join(stage, "lesson.prax"), "utf8")).toBe("RECOVERY BYTES");
	});
	it("keeps clean source unchanged and persists identities across reads and copied projects", async () => {
		const root = await project();
		const first = await save(root, "lesson.prax", lesson);
		expect(first.source).toBe(lesson);
		expect(first.pageIdentities).toHaveLength(2);
		expect(await save(root, "lesson.prax", lesson)).toEqual(first);
		const copied = await project();
		await cp(join(root, ".praxity"), join(copied, ".praxity"), { recursive: true });
		await writeFile(join(copied, "lesson.prax"), lesson);
		expect(await save(copied, "lesson.prax", lesson)).toEqual(first);
		const imported = await save(await project(), "lesson.prax", lesson);
		expect(imported.pageIdentities.map((page) => page.id)).not.toEqual(
			first.pageIdentities.map((page) => page.id),
		);
		expect(await readdir(join(root, ".praxity"))).toEqual(["identity"]);
	}, 25_000);

	it("stores generated block identities without exposing them in lesson source", async () => {
		const root = await project();
		const first = await save(root, "lesson.prax", lessonWithBlocks);
		expect(first.source).toBe(lessonWithBlocks);
		expect(first.blockIdentities).toHaveLength(2);
		expect(first.blockIdentities.every((record) => /^[0-9a-f-]{36}$/.test(record.id))).toBe(true);
		expect(await save(root, "lesson.prax", lessonWithBlocks)).toEqual(first);
		expect(await metadata(root)).toMatchObject({
			blocks: { "lesson.prax": first.blockIdentities },
		});
	});

	it("serializes source writes with their identities and rejects symlink lesson targets", async () => {
		const root = await project();
		const firstSource = lesson.replace("First page.", "First edit.");
		const secondSource = lesson.replace("First page.", "Second edit.");
		const saved = await Promise.all([
			save(root, "lesson.prax", firstSource),
			save(root, "lesson.prax", secondSource),
		]);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(saved[1].source);
		expect((await metadata(root)).lessons["lesson.prax"]).toEqual(saved[1].pageIdentities);
		const outside = await project();
		await writeFile(join(outside, "other.prax"), lesson);
		await symlink(join(outside, "other.prax"), join(root, "link.prax"));
		await expect(parseLessonSource(root, "link.prax", lesson)).rejects.toThrow();
		expect(Object.keys((await metadata(root)).lessons)).toEqual(["lesson.prax"]);
	}, 25_000);

	it("queues lesson deletion after an in-flight save", async () => {
		const root = await project();
		await save(root, "lesson.prax", lessonWithBlocks);
		const originalWrite = pathSecurity.writeFileWithin;
		await assertMatched(
			root,
			"lesson.prax",
			lessonWithBlocks.replace("First question", "Saved question"),
		);
		let signalStarted: () => void = () => {};
		let resumeWrite: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			signalStarted = resolve;
		});
		const paused = new Promise<void>((resolve) => {
			resumeWrite = resolve;
		});
		vi.spyOn(pathSecurity, "writeFileWithin").mockImplementation(async (...args) => {
			if (await isLessonWrite(args[0], args[1])) {
				signalStarted();
				await paused;
			}
			return originalWrite(...args);
		});
		const saving = writeLessonSource(
			root,
			"lesson.prax",
			lessonWithBlocks.replace("First question", "Saved question"),
		);
		await started;
		const deleting = deleteLessonSource(root, "lesson.prax");
		resumeWrite();
		await Promise.all([saving, deleting]);
		await expect(readFile(join(root, "lesson.prax"))).rejects.toMatchObject({ code: "ENOENT" });
		expect(await metadata(root)).toMatchObject({ lessons: {}, blocks: {} });
		expect((await readdir(root)).some((name) => name.endsWith(".deleting"))).toBe(false);
	}, 30_000);

	it("does not overwrite a lesson recreated while deletion rolls back", async () => {
		const root = await project();
		await save(root, "lesson.prax", lessonWithBlocks);
		const before = await readFile(await metadataPath(root), "utf8");
		recreation.path = join(root, "lesson.prax");
		recreation.content = "replacement";
		await expect(deleteLessonSource(root, "lesson.prax")).rejects.toThrow(/conflict/i);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("replacement");
		const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
		expect(stage).toBeDefined();
		const record = JSON.parse(await readFile(join(root, stage as string, "journal.tmp"), "utf8"));
		expect(
			record.plan.files.find((file: { path: string }) => file.path === "lesson.prax").from,
		).toBe(Buffer.from(lessonWithBlocks).toString("base64"));
		expect(await readFile(await metadataPath(root), "utf8")).toBe(before);
	}, 25_000);

	it("preserves existing source and metadata permissions when replacing their bytes", async () => {
		const root = await project();
		await save(root, "lesson.prax", lessonWithBlocks);
		await chmod(join(root, "lesson.prax"), 0o600);
		await chmod(await metadataPath(root), 0o600);
		await save(root, "lesson.prax", lessonWithBlocks.replace("First question", "Changed question"));
		expect((await stat(join(root, "lesson.prax"))).mode & 0o777).toBe(OWNER_ONLY_MODE);
		expect((await stat(await metadataPath(root))).mode & 0o777).toBe(OWNER_ONLY_MODE);
	}, 20_000);

	it.skipIf(process.getuid?.() === 0)(
		"rejects read-only source replacement and restores metadata",
		async () => {
			const root = await project();
			await save(root, "lesson.prax", lessonWithBlocks);
			const before = await readFile(await metadataPath(root), "utf8");
			await chmod(join(root, "lesson.prax"), 0o444);
			await expect(
				save(root, "lesson.prax", lessonWithBlocks.replace("First question", "Changed question")),
			).rejects.toMatchObject({ code: READ_ONLY_ERROR_CODE });
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(lessonWithBlocks);
			expect((await stat(join(root, "lesson.prax"))).mode & 0o777).toBe(0o444);
			expect(await readFile(await metadataPath(root), "utf8")).toBe(before);
		},
		15_000,
	);

	it("preserves source and exact metadata after a partial staged write and permits retry", async () => {
		const root = await project();
		await save(root, "lesson.prax", lessonWithBlocks);
		const before = await readFile(await metadataPath(root), "utf8");
		const originalWrite = pathSecurity.writeFileWithin;
		const failure = new Error("Source write failed");
		let fail = true;
		vi.spyOn(pathSecurity, "writeFileWithin").mockImplementation(async (...args) => {
			if (fail && (await isLessonWrite(args[0], args[1]))) {
				fail = false;
				await originalWrite(args[0], args[1], "partial", "utf-8");
				throw failure;
			}
			return originalWrite(...args);
		});
		const edited = lessonWithBlocks.replace("First question", "Changed question");
		await expect(save(root, "lesson.prax", edited)).rejects.toBe(failure);
		expect(await readFile(await metadataPath(root), "utf8")).toBe(before);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(lessonWithBlocks);
		await save(root, "lesson.prax", edited);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(edited);
	}, 20_000);

	it("reports source and rollback failures together", async () => {
		const root = await project();
		await save(root, "lesson.prax", lesson);
		const originalWrite = pathSecurity.writeFileWithin;
		const sourceFailure = new Error("Source write failed");
		const rollbackFailure = new Error("Rollback write failed");
		let sourceFailed = false;
		vi.spyOn(pathSecurity, "writeFileWithin").mockImplementation(async (...args) => {
			if (await isLessonWrite(args[0], args[1])) {
				sourceFailed = true;
				throw sourceFailure;
			}
			if (sourceFailed) throw rollbackFailure;
			return originalWrite(...args);
		});
		await expect(
			save(root, "lesson.prax", lesson.replace("First page.", "Changed body.")),
		).rejects.toMatchObject({ errors: [sourceFailure, rollbackFailure] });
	}, 15_000);

	it("rejects a directory source target before creating metadata", async () => {
		const root = await project();
		await mkdir(join(root, "lesson.prax"));
		await expect(save(root, "lesson.prax", lesson)).rejects.toThrow();
		await expect(stat(join(root, ".praxity", "identity"))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("does not overwrite an external file created after the rename collision check", async () => {
		const root = await project();
		await save(root, "lesson.prax", lessonWithBlocks);
		const before = await readFile(await metadataPath(root), "utf8");
		recreation.path = join(root, "target.prax");
		recreation.content = "external source";
		await expect(renameProjectSource(root, "lesson.prax", "target.prax")).rejects.toThrow();
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(lessonWithBlocks);
		expect(await readFile(join(root, "target.prax"), "utf8")).toBe("external source");
		expect(await readFile(await metadataPath(root), "utf8")).toBe(before);
	}, 15_000);

	it("restores a source rename when metadata fails without overwriting a recreated source", async () => {
		const root = await project();
		await save(root, "lesson.prax", lessonWithBlocks);
		const before = await readFile(await metadataPath(root), "utf8");
		recreation.path = join(root, "lesson.prax");
		recreation.content = "recreated";
		await expect(renameProjectSource(root, "lesson.prax", "renamed.prax")).rejects.toThrow(
			/conflict/i,
		);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("recreated");
		await expect(readFile(join(root, "renamed.prax"))).rejects.toMatchObject({ code: "ENOENT" });
		const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
		expect(stage).toBeDefined();
		const record = JSON.parse(await readFile(join(root, stage as string, "journal.tmp"), "utf8"));
		expect(
			record.plan.files.find((file: { path: string }) => file.path === "lesson.prax").from,
		).toBe(Buffer.from(lessonWithBlocks).toString("base64"));
		expect(await readFile(await metadataPath(root), "utf8")).toBe(before);
	}, 20_000);

	it("refuses rename collisions and sidecar symlink escapes", async () => {
		const root = await project();
		await save(root, "one.prax", lesson);
		await save(root, "two.prax", lesson);
		const before = await readFile(await metadataPath(root), "utf8");
		await expect(renameProjectSource(root, "one.prax", "two.prax")).rejects.toThrow(
			"already exist",
		);
		expect(await readFile(await metadataPath(root), "utf8")).toBe(before);
		expect(await readFile(join(root, "one.prax"), "utf8")).toBe(lesson);
		expect(await readFile(join(root, "two.prax"), "utf8")).toBe(lesson);
		const escaped = await project();
		const outside = await project();
		await symlink(outside, join(escaped, ".praxity"));
		await expect(save(escaped, "lesson.prax", lesson)).rejects.toThrow();
		expect(await readdir(outside)).toEqual([]);
		await expect(save(root, "../escape.prax", lesson)).rejects.toThrow("Invalid lesson filename");
	}, 20_000);
});
