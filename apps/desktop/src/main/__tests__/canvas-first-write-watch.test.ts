import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FSWatcher } from "chokidar";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { OperationService } from "../operations/operation-service";
import { createStudioProjectSession, type StudioEvent } from "../studio/project-session";

const io = vi.hoisted(() => ({
	beforeLink: undefined as ((to: string) => Promise<void>) | undefined,
}));
vi.mock("node:fs", async (importOriginal) => {
	const { admissionNativeFilesystem } = await import("../../test-utils/admission-filesystem");
	return admissionNativeFilesystem(await importOriginal<typeof import("node:fs")>());
});
vi.mock("node:fs/promises", async (importOriginal) => {
	const { admissionFilesystem } = await import("../../test-utils/admission-filesystem");
	const fs = admissionFilesystem(
		await importOriginal<typeof import("node:fs/promises")>(),
		await vi.importActual<typeof import("node:fs")>("node:fs"),
	);
	return {
		...fs,
		link: async (...args: Parameters<typeof fs.link>) => {
			await io.beforeLink?.(String(args[1]));
			return fs.link(...args);
		},
	};
});

type Session = Awaited<ReturnType<typeof createStudioProjectSession>>;
type Snapshot = Awaited<ReturnType<OperationService["canvasTextSnapshot"]>>;
type Field = Snapshot["fields"][number];
const roots: string[] = [];
const sessions: Session[] = [];
const writes: Promise<unknown>[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
	for (const release of releases.splice(0)) release();
	await Promise.allSettled(writes.splice(0));
	io.beforeLink = undefined;
	vi.restoreAllMocks();
});
afterAll(async () => {
	for (const session of sessions.splice(0)) await session.close();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function nextEvent(session: Session, accepts: (event: StudioEvent) => boolean) {
	return new Promise<void>((resolve, reject) => {
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "error") {
				unsubscribe();
				reject(new Error(event.message));
				return;
			}
			if (!accepts(event)) return;
			unsubscribe();
			resolve();
		});
	});
}
function nextSourceAdmission(session: Session, file: string) {
	let changed = false;
	return nextEvent(session, (event) => {
		if (event.type === "grammarChanged" && event.filename === file) changed = true;
		return changed && event.type === "treeChanged";
	});
}
function request(field: Field, text: string) {
	return {
		transactionId: randomUUID(),
		operation: "setText",
		file: field.file,
		nodeId: field.nodeId,
		baseRevision: field.baseRevision,
		expectedText: field.text,
		field: field.field,
		text,
	};
}

async function fixture() {
	// T1 and Chokidar use canonical paths, including hosts whose temp directory is a symlink.
	const root = await realpath(await mkdtemp(join(tmpdir(), "canvas-first-write-watch-")));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Watcher admission\nlessons: []\n");
	await writeFile(join(root, "a.prax"), "# a.prax\n\nBody.\n");
	await writeFile(join(root, "b.prax"), "# b.prax\n\nBody.\n");
	await expect(stat(join(root, ".praxity", "identity"))).rejects.toMatchObject({ code: "ENOENT" });
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	expect((await stat(join(root, ".praxity", "identity"))).isDirectory()).toBe(true);
	// New headings have runtime IDs; the real watcher admits their outside source revision.
	for (const file of ["a.prax", "b.prax"]) {
		const originalBody = ((await session.invoke("canvasTextSnapshot", {})) as Snapshot).fields.find(
			(field) => field.file === file && field.kind === "body",
		)?.nodeId;
		expect(originalBody).toBeTruthy();
		const admitted = nextSourceAdmission(session, file);
		await writeFile(join(root, file), `# ${file}\n\n## Held heading\n\nBody.\n`);
		await admitted;
		expect(
			((await session.invoke("canvasTextSnapshot", {})) as Snapshot).fields.find(
				(field) => field.file === file && field.kind === "body",
			)?.nodeId,
		).toBe(originalBody);
	}
	const snapshot = (await session.invoke("canvasTextSnapshot", {})) as Snapshot;
	const first = snapshot.fields.find(
		(field) => field.file === "a.prax" && field.kind === "heading",
	);
	const held = snapshot.fields.find((field) => field.file === "b.prax" && field.kind === "heading");
	if (!first || !held) throw new Error("Missing runtime heading fields");
	return { root, session, first, held };
}

let unlinkFixture: Awaited<ReturnType<typeof fixture>>;
let orphanFixture: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
	// Each case keeps a fresh project; initial watcher admission is fixture setup.
	unlinkFixture = await fixture();
	orphanFixture = await fixture();
});

it("a real watcher preserves a held field after the session's first save emits unlink", async () => {
	const { root, session, first, held } = unlinkFixture;
	const target = join(root, "a.prax");
	let delivered = () => {};
	const unlink = new Promise<void>((resolve) => {
		delivered = resolve;
	});
	let resume = () => {};
	const install = new Promise<void>((resolve) => {
		resume = resolve;
	});
	releases.push(resume);
	// Observe actual Chokidar delivery without replacing watch() or synthesizing an event.
	const emit = EventEmitter.prototype.emit;
	vi.spyOn(FSWatcher.prototype, "emit").mockImplementation(function (
		this: FSWatcher,
		name,
		...args
	) {
		const result = emit.call(this, name, ...args);
		if (name === "all" && args[0] === "unlink" && args[1] === target) delivered();
		return result;
	});
	io.beforeLink = async (to) => {
		if (to === target) await install;
	};
	const settled = nextEvent(session, (event) => event.type === "treeChanged");
	const saving = session.invoke("canvasTextApply", request(first, "Saved A"));
	writes.push(saving);
	try {
		// Keep T1's live-name gap open until the real atomic window expires and unlink arrives.
		await unlink;
		resume();
		expect(await saving).toMatchObject({ ok: true });
		await settled;
		const result = await session.invoke("canvasTextApply", request(held, "Saved B"));
		expect(result, JSON.stringify(result)).toMatchObject({
			ok: true,
		});
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("# a.prax\n\n## Saved A\n\nBody.\n");
		expect(await readFile(join(root, "b.prax"), "utf8")).toBe("# b.prax\n\n## Saved B\n\nBody.\n");
	} finally {
		resume();
		await saving;
	}
});

it("a real watcher reports orphaned after the held field's lesson is deleted", async () => {
	const { root, session, first, held } = orphanFixture;
	// Main suppresses grammarChanged for committed echoes, but still completes the tree event.
	const saved = nextEvent(session, (event) => event.type === "treeChanged");
	expect(await session.invoke("canvasTextApply", request(first, "Saved A"))).toMatchObject({
		ok: true,
	});
	await saved;
	let changed = false;
	const removed = nextEvent(session, (event) => {
		if (event.type === "editorChanged") changed = true;
		return changed && event.type === "treeChanged";
	});
	await rm(join(root, "b.prax"));
	await removed;
	const before = await readFile(join(root, "a.prax"));
	expect(await session.invoke("canvasTextApply", request(held, "Must refuse"))).toMatchObject({
		ok: false,
		code: "orphaned",
	});
	expect(await readFile(join(root, "a.prax"))).toEqual(before);
	await expect(stat(join(root, "b.prax"))).rejects.toMatchObject({ code: "ENOENT" });
	const restored = nextSourceAdmission(session, "b.prax");
	await writeFile(join(root, "b.prax"), "# b.prax\n\n## Held heading\n\nBody.\n");
	await restored;
	// Recreating identical bytes cannot resurrect evidence revoked by a real deletion.
	expect(await session.invoke("canvasTextApply", request(held, "Must still refuse"))).toMatchObject(
		{
			ok: false,
			code: "orphaned",
		},
	);
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe(
		"# b.prax\n\n## Held heading\n\nBody.\n",
	);
});
