import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { createStudioProjectSession, type StudioEvent } from "../studio/project-session";

const filesystem = vi.hoisted(() => ({
	root: "",
	watcher: undefined as import("node:events").EventEmitter | undefined,
}));
vi.mock("chokidar", async () => {
	const { EventEmitter } = await import("node:events");
	return {
		watch: (root: string) => {
			const watcher = Object.assign(new EventEmitter(), { close: async () => {} });
			filesystem.root = root;
			filesystem.watcher = watcher;
			queueMicrotask(() => watcher.emit("ready"));
			return watcher;
		},
	};
});

const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof createStudioProjectSession>>[] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const source = "# Page\n\nBefore.\n";
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "preview-watch-echo-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), source);
	await persistFixtureIdentity(root);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const events: StudioEvent[] = [];
	session.subscribe((value) => events.push(value));
	await session.invoke("previewSelectPage", {});
	return { root, session, events };
}
async function emit(session: (typeof sessions)[number], event: string, filename = "lesson.prax") {
	if (!filesystem.watcher) throw new Error("Missing filesystem watcher");
	const completed = new Promise<void>((resolve) => {
		const unsubscribe = session.subscribe((value) => {
			if (value.type !== "treeChanged") return;
			unsubscribe();
			resolve();
		});
	});
	filesystem.watcher.emit("all", event, join(filesystem.root, filename));
	await completed;
}

it.each(["change", "unlink", "add"])(
	"ignores a writer's %s echo after admitting its saved bytes",
	async (event) => {
		const { root, session, events } = await fixture();
		await emit(session, event);
		expect(await session.invoke("previewStats", {})).toMatchObject({ contextSeq: 0 });
		expect(
			events.filter((value) => value.type === "compileFailed" || value.type === "error"),
		).toEqual([]);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
	},
);

it.each(["change", "add", "unlink"])(
	"admits different outside bytes reported as %s",
	async (event) => {
		const { root, session, events } = await fixture();
		await writeFile(join(root, "lesson.prax"), source.replace("Before.", "Outside."));
		await emit(session, event);
		expect(await session.invoke("previewStats", {})).toMatchObject({ contextSeq: 1 });
		expect(
			events.filter((value) => value.type === "compileFailed" || value.type === "error"),
		).toEqual([]);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("# Page\n\nOutside.\n");
		expect(events).toContainEqual({
			type: "grammarChanged",
			filename: "lesson.prax",
			grammar: "# Page\n\nOutside.\n",
		});
	},
);

it("reports an outside deletion when an unlink event has no remaining source", async () => {
	const { root, session, events } = await fixture();
	await rm(join(root, "lesson.prax"));
	await emit(session, "unlink");
	await vi.waitFor(() => {
		expect(events).toContainEqual(expect.objectContaining({ type: "compileFailed", seq: 1 }));
		expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "watch_failed" }));
	});
	await expect(readFile(join(root, "lesson.prax"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains directory admission for names ending in .prax", async () => {
	const { root, session, events } = await fixture();
	await mkdir(join(root, "nested.prax"));
	await emit(session, "addDir", "nested.prax");
	expect(await session.invoke("previewStats", {})).toMatchObject({ contextSeq: 1 });
	expect(
		events.filter((value) => value.type === "compileFailed" || value.type === "error"),
	).toEqual([]);
});
