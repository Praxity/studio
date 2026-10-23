import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureTmpdir } from "../../test-utils/fixture-temp";
import {
	defaultProjectFileFlushes,
	reclaimProtectedArchives,
	restoreProjectRecovery,
	withProjectFileFlushes,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";

const io = vi.hoisted(() => ({
	synced: [] as { kind: "file" | "directory"; path: string }[],
	events: [] as {
		kind: "file" | "directory" | "publish" | "quarantine" | "remove";
		path: string;
	}[],
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const handle = await fs.open(...args);
			const sync = handle.sync.bind(handle);
			handle.sync = async () => {
				const kind = (await handle.stat()).isDirectory() ? "directory" : "file";
				await sync();
				io.synced.push({ kind, path: String(args[0]) });
			};
			return handle;
		},
		rename: async (...args: Parameters<typeof fs.rename>) => {
			if (basename(String(args[1])) === "staged-0")
				io.events.push({ kind: "publish", path: String(args[1]) });
			await fs.rename(...args);
			if (String(args[1]).includes(".reclaim-"))
				io.events.push({ kind: "quarantine", path: String(args[1]) });
		},
		rm: async (...args: Parameters<typeof fs.rm>) => {
			await fs.rm(...args);
			if (String(args[0]).includes(".reclaim-"))
				io.events.push({ kind: "remove", path: String(args[0]) });
		},
	};
});

const roots: string[] = [];
afterEach(async () => {
	io.synced = [];
	io.events = [];
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function project() {
	const root = await mkdtemp(
		join(fixtureTmpdir("project-journal-flush-dependency"), "journal-flush-dependency-"),
	);
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), "original\n");
	return root;
}
const changes = [{ path: "lesson.prax", content: "replacement\n" }];

it("retention flushes the directory after quarantine rename and after removal through real storage", async () => {
	const root = await project();
	await writeFile(join(root, "narration.yaml"), "original narration");
	await writeProjectFiles(root, [{ path: "narration.yaml", content: "replacement narration" }]);
	io.events = [];
	await withProjectFileFlushes(
		{
			syncFile: async (course, path) => {
				await defaultProjectFileFlushes.syncFile(course, path);
				io.events.push({ kind: "file", path });
			},
			syncDirectory: async (path) => {
				await defaultProjectFileFlushes.syncDirectory(path);
				io.events.push({ kind: "directory", path });
			},
		},
		() =>
			withProjectFileTransaction(
				root,
				(canonical) => reclaimProtectedArchives(canonical, async () => false),
				"write",
				false,
			),
	);
	const quarantines = io.events.filter(({ kind }) => kind === "quarantine");
	expect(quarantines).toHaveLength(1);
	const quarantine = quarantines[0];
	const parent = dirname(quarantine.path);
	expect(io.events.slice(io.events.indexOf(quarantine))).toEqual([
		quarantine,
		{ kind: "directory", path: parent },
		{ kind: "remove", path: quarantine.path },
		{ kind: "directory", path: parent },
	]);
	expect((await readdir(root)).filter((name) => name.startsWith(".praxity-write-"))).toEqual([]);
	expect(await readFile(join(root, "narration.yaml"), "utf8")).toBe("replacement narration");
});

it("defaults are immutable and perform actual file and supported directory flushes", async () => {
	expect(Object.isFrozen(defaultProjectFileFlushes)).toBe(true);
	expect(Reflect.set(defaultProjectFileFlushes, "syncFile", async () => {})).toBe(false);
	expect(Reflect.set(defaultProjectFileFlushes, "syncDirectory", async () => {})).toBe(false);
	const root = await project();
	await writeProjectFiles(root, changes);
	expect(io.synced.filter(({ kind }) => kind === "file").length).toBeGreaterThan(0);
	if (process.platform !== "win32")
		expect(io.synced.filter(({ kind }) => kind === "directory").length).toBeGreaterThan(0);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("replacement\n");
});

it.each(["write", "restore"])(
	"%s flushes exact file/directory pairs before staging publication through real storage",
	async (operation) => {
		const root = await project();
		let archive = "";
		if (operation === "restore") {
			await writeProjectFiles(root, changes);
			const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
			if (!stage) throw new Error("Missing recovery archive");
			archive = stage;
		}
		io.synced = [];
		io.events = [];
		await withProjectFileFlushes(
			{
				syncFile: async (course, path) => {
					await defaultProjectFileFlushes.syncFile(course, path);
					io.events.push({ kind: "file", path });
				},
				syncDirectory: async (path) => {
					await defaultProjectFileFlushes.syncDirectory(path);
					io.events.push({ kind: "directory", path });
				},
			},
			() =>
				operation === "write"
					? writeProjectFiles(root, changes)
					: restoreProjectRecovery(root, archive, "original", "lesson.prax"),
		);
		const publications = io.events.filter(({ kind }) => kind === "publish");
		expect(publications).toHaveLength(1);
		const publication = publications[0];
		const stage = dirname(publication.path);
		const source = join(stage, "install-0");
		const firstFlush = io.events.findIndex(({ kind, path }) => kind === "file" && path === source);
		expect(firstFlush).toBeGreaterThanOrEqual(0);
		// One data flush and one marker flush, each followed by its directory before publication.
		expect(io.events.slice(firstFlush, io.events.indexOf(publication) + 1)).toEqual([
			{ kind: "file", path: source },
			{ kind: "directory", path: stage },
			{ kind: "file", path: join(stage, "staged-0.tmp") },
			{ kind: "directory", path: stage },
			{ kind: "publish", path: join(stage, "staged-0") },
		]);
		for (const kind of ["file", "directory"] as const) {
			const requested = io.events.filter((event) => event.kind === kind);
			const actual = io.synced.filter((event) => event.kind === kind);
			expect(requested.length).toBeGreaterThan(0);
			expect(actual).toHaveLength(
				kind === "directory" && process.platform === "win32" ? 0 : requested.length,
			);
		}
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			operation === "write" ? "replacement\n" : "original\n",
		);
	},
);

it("scopes counting no-op flushes across queued and nested work without replacing real defaults", async () => {
	const [first, second, third] = await Promise.all([project(), project(), project()]);
	const outer = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
	const inner = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
	await withProjectFileFlushes(outer, async () => {
		await Promise.all([
			writeProjectFiles(first, changes),
			withProjectFileFlushes(inner, () => writeProjectFiles(second, changes)),
		]);
		const innerCount = inner.syncFile.mock.calls.length;
		const outerCount = outer.syncFile.mock.calls.length;
		await writeProjectFiles(first, [{ path: "lesson.prax", content: "second edit\n" }]);
		expect(outer.syncFile.mock.calls.length).toBeGreaterThan(outerCount);
		expect(inner.syncFile).toHaveBeenCalledTimes(innerCount);
	});
	expect(outer.syncFile).toHaveBeenCalled();
	expect(outer.syncDirectory).toHaveBeenCalled();
	expect(inner.syncFile).toHaveBeenCalled();
	expect(inner.syncDirectory).toHaveBeenCalled();
	expect(io.synced).toHaveLength(0);
	expect(await readFile(join(first, "lesson.prax"), "utf8")).toBe("second edit\n");
	expect(await readFile(join(second, "lesson.prax"), "utf8")).toBe("replacement\n");
	await writeProjectFiles(third, changes);
	expect(io.synced.filter(({ kind }) => kind === "file").length).toBeGreaterThan(0);
});

it.each(["syncFile", "syncDirectory"] as const)(
	"propagates an injected %s failure and restores real defaults after rejection",
	async (method) => {
		const root = await project();
		const flushes = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
		flushes[method].mockRejectedValueOnce(new Error("Flush refused"));
		await expect(
			withProjectFileFlushes(flushes, () => writeProjectFiles(root, changes)),
		).rejects.toThrow("Flush refused");
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("original\n");
		await writeProjectFiles(root, changes);
		expect(io.synced.filter(({ kind }) => kind === "file").length).toBeGreaterThan(0);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("replacement\n");
	},
);
