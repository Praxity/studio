import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFrameView } from "@praxity/editor-core/frame-bridge";
import { createSession } from "@praxity/editor-core/session";
import { afterEach, expect, it, vi } from "vitest";
import {
	editorDraftSeed,
	editorSnapshotSchema,
	type EditorSnapshot as RangeSnapshot,
} from "../../shared/editor-session";
import { resolveLessonSources } from "../lesson-source";
import { withProjectFileFlushes } from "../project-file-transactions";
import type { StudioEvent } from "../studio/project-session";
import { createStudioProjectSession } from "../studio/project-session";
import { startStudioServer } from "../studio/server";
import { nodeMetadataBudget } from "./fixtures/editor-snapshot";
import { sessionResult } from "./fixtures/studio-session";

const source =
	"\uFEFF---\r\ntitle: Lesson\r\n---\r\n\r\n# Page\r\n\r\n::: note\r\nText\r\n:::\r\n\r\nTail without newline";
const roots: string[] = [];
const sessions: { close(): Promise<void> }[] = [];
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function withCountingFlushes<Args extends unknown[]>(work: (...args: Args) => Promise<void>) {
	return async (...args: Args) => {
		const flushes = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
		await withProjectFileFlushes(flushes, () => work(...args));
		expect(flushes.syncFile).toHaveBeenCalled();
		expect(flushes.syncDirectory).toHaveBeenCalled();
	};
}
function expand(snapshot: RangeSnapshot) {
	return {
		...snapshot,
		lessons: snapshot.lessons.map((lesson) => ({
			...lesson,
			seed: editorDraftSeed(lesson),
			nodes: lesson.nodes.map((node) => ({
				...node,
				seed: editorDraftSeed(lesson, node),
			})),
		})),
	};
}
type EditorSnapshot = ReturnType<typeof expand>;
async function snapshot(session: Awaited<ReturnType<typeof createStudioProjectSession>>) {
	return expand(editorSnapshotSchema.parse(await session.invoke("editorSnapshot", {})));
}
async function projectFixture(contents = source) {
	const root = await mkdtemp(join(tmpdir(), "studio-editor-snapshot-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Course\nlessons: [lesson.prax]\n");
	await writeFile(join(root, "lesson.prax"), contents);
	return root;
}
async function fixture(contents = source) {
	const root = await projectFixture(contents);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	return { root, session };
}
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("D1 D2 I4 admits exact CRLF node and whole-file seeds through the rooted session", async () => {
	const root = await projectFixture();
	const flushes = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const rpc = async (args: unknown) => {
		const response = await sessionResult(session, "editorSnapshot", args);
		return { status: response.status, body: response };
	};
	const response = await rpc({});
	expect(response.status).toBe(200);
	const wire = JSON.stringify(response.body.result);
	expect(wire.split(JSON.stringify(source))).toHaveLength(2);
	for (const lesson of response.body.result.lessons)
		for (const node of lesson.nodes)
			expect(Buffer.byteLength(JSON.stringify(node))).toBeLessThanOrEqual(nodeMetadataBudget);
	const snapshot = expand(editorSnapshotSchema.parse(response.body.result));
	expect(snapshot.schema).toBe(1);
	expect(snapshot.seq).toBe(0);
	expect(snapshot.transientIdentity).toBe(true);
	const lesson = snapshot.lessons[0];
	expect(lesson.file).toBe("lesson.prax");
	expect(lesson.seed).toMatchObject({
		scope: "file",
		baseRevision: digest(source),
		expectedText: source,
		editableText: source,
	});
	const note = lesson.nodes.find((node) => node.type === "note");
	if (!note) throw new Error("Missing note seed");
	expect(note.seed).toMatchObject({
		file: "lesson.prax",
		scope: "node",
		baseRevision: digest(source),
		expectedText: "::: note\r\nText\r\n:::\r\n",
		editableText: "::: note\r\nText\r\n",
		target: { kind: "node", nodeId: note.id },
	});
	const page = lesson.nodes.find((node) => node.kind === "page");
	expect(note.parentId).toBe(page?.id);
	expect(note.pageId).toBe(page?.id);
	expect(page?.parentId).toBe(null);
	expect(Buffer.compare(await readFile(join(root, "lesson.prax")), Buffer.from(source))).toBe(0);
	for (const args of [{ file: "../outside.prax" }, { path: [0, 0] }, { nodeId: randomUUID() }]) {
		const refused = await rpc(args);
		expect(refused.status).toBe(400);
		expect(JSON.stringify(refused.body)).not.toContain("Text");
	}
	for (const args of ['{"__proto__":{}}', '{"constructor":1}', "null", "[]", '"x"']) {
		await expect(session.invoke("editorSnapshot", JSON.parse(args))).rejects.toThrow();
	}
	for (const [transactionId, previous, text] of [
		["http-one", "Text", "One"],
		["http-two", "One", "Two"],
	]) {
		flushes.syncFile.mockClear();
		flushes.syncDirectory.mockClear();
		const committed = await withProjectFileFlushes(flushes, () =>
			sessionResult(session, "operationApply", {
				transactionId,
				operation: "editSource",
				files: [{ path: lesson.file, baseRevision: note.seed.baseRevision }],
				targets: [
					{
						file: lesson.file,
						ref: note.seed.target,
						expectedText: `::: note\r\n${previous}\r\n:::\r\n`,
					},
				],
				args: { text: `::: note\r\n${text}\r\n` },
			}),
		);
		expect(committed).toMatchObject({ ok: true, result: { ok: true } });
		expect(flushes.syncFile).toHaveBeenCalled();
		expect(flushes.syncDirectory).toHaveBeenCalled();
	}
	expect((await session.readSnapshot()).editorSeq).toBe(2);
	expect((await rpc({})).body.result.seq).toBe(2);
});

it.each(["UTF-8", "identity", "manifest"])(
	"redacts %s admission failures over real HTTP",
	async (failure) => {
		const root = await projectFixture();
		const ui = await mkdtemp(join(tmpdir(), "studio-snapshot-redaction-"));
		roots.push(ui);
		await writeFile(join(ui, "index.html"), "<!doctype html><title>Test</title>");
		await writeFile(join(ui, "canvas.js"), "void 0;");
		await writeFile(
			join(ui, "canvas.sha256"),
			"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
		);
		const server = await startStudioServer({
			projectDir: root,
			editorAssetsDir: ui,
			appVersion: "test",
			exportAssetsDir: join(import.meta.dirname, "../../../resources/export-assets"),
		});
		sessions.push(server);
		const path =
			failure === "UTF-8"
				? join(root, "lesson.prax")
				: failure === "identity"
					? join(root, ".praxity", "identity", "course.json")
					: join(root, "course.yaml");
		const original = await readFile(path);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await writeFile(
				path,
				failure === "UTF-8"
					? Buffer.from([0xff])
					: failure === "identity"
						? "{broken SECRET-AUTHOR-SOURCE"
						: "title: [broken SECRET-AUTHOR-SOURCE\n",
			);
			const response = await fetch(`${server.origin}/launch?canvas=read`);
			expect(response.status).toBe(failure === "manifest" ? 400 : 500);
			const error = await response.json();
			expect(error).toMatchObject({ ok: false, error: { message: "Project operation failed" } });
			const serialized = JSON.stringify(error);
			for (const secret of [
				root,
				root.replaceAll("\\", "\\\\"),
				"SECRET-AUTHOR-SOURCE",
				".praxity",
				"lesson.prax",
			])
				expect(serialized).not.toContain(secret);
		} finally {
			await writeFile(path, original);
			log.mockRestore();
		}
	},
);

it(
	"R2 P2-1 advances literal server snapshot and session sequences after outside and own writes",
	withCountingFlushes(async () => {
		const stableSource = source.replace(
			"Text",
			"A stable note paragraph retains its identity during the original edit.",
		);
		const { root, session } = await fixture(stableSource);
		const bodyId = (await snapshot(session)).lessons[0].nodes.find(
			(node) => node.kind === "body",
		)?.id;
		expect(bodyId).toBeTruthy();
		expect((await snapshot(session)).seq).toBe(0);
		const events: StudioEvent[] = [];
		session.subscribe((event) => events.push(event));
		await writeFile(join(root, "lesson.prax"), stableSource.replace("original", "outside"));
		await vi.waitFor(() => expect(events).toContainEqual({ type: "editorChanged", seq: 1 }));
		const current = await snapshot(session);
		expect(current.lessons[0].nodes.find((node) => node.kind === "body")?.id).toBe(bodyId);
		expect(current.seq).toBe(1);
		const note = current.lessons[0].nodes.find((node) => node.type === "note");
		if (!note) throw new Error("Missing note");
		expect(
			await session.invoke("operationApply", {
				transactionId: "sequence-write",
				operation: "editSource",
				files: [{ path: "lesson.prax", baseRevision: note.seed.baseRevision }],
				targets: [
					{ file: "lesson.prax", ref: note.seed.target, expectedText: note.seed.expectedText },
				],
				args: { text: "::: note\r\nCommitted\r\n" },
			}),
		).toMatchObject({ ok: true, seq: 2 });
		expect(events).toContainEqual({ type: "editorChanged", seq: 2 });
		expect((await snapshot(session)).seq).toBe(2);
		expect(await session.readSnapshot()).toMatchObject({ editorSeq: 2 });
	}),
);

it(
	"D10 P2-1 notifies both subscribers for history independently of preview compilation",
	withCountingFlushes(async () => {
		const { session } = await fixture();
		const current = await snapshot(session);
		const note = current.lessons[0].nodes.find((node) => node.type === "note");
		if (!note) throw new Error("Missing note");
		const result = (await session.invoke("operationApply", {
			transactionId: "history-setup",
			operation: "editSource",
			files: [{ path: "lesson.prax", baseRevision: note.seed.baseRevision }],
			targets: [
				{ file: "lesson.prax", ref: note.seed.target, expectedText: note.seed.expectedText },
			],
			args: { text: "::: note\r\nEdited\r\n" },
		})) as { historyId: string };
		const first: StudioEvent[] = [],
			second: StudioEvent[] = [];
		session.subscribe((event) => first.push(event));
		session.subscribe((event) => second.push(event));
		expect(
			await session.invoke("historyApply", {
				transactionId: "undo",
				historyId: result.historyId,
				direction: "undo",
			}),
		).toMatchObject({ ok: true, seq: 2 });
		expect(first).toContainEqual({ type: "editorChanged", seq: 2 });
		expect(second).toContainEqual({ type: "editorChanged", seq: 2 });
		expect((await snapshot(session)).seq).toBe(2);
	}),
);

it("D10 F8 refreshes after admitted outside edits and stale paths cannot redirect a seed", async () => {
	const flushes = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
	const { root, session } = await withProjectFileFlushes(flushes, fixture);
	const initial = await snapshot(session);
	const note = initial.lessons[0].nodes.find((node) => node.type === "note");
	if (!note) throw new Error("Missing note seed");
	const changed = vi.fn();
	const stop = session.subscribe((event) => {
		if (event.type === "editorChanged") changed();
	});
	const outside = source.replace("::: note\r\n", "::: note\r\nOther\r\n:::\r\n\r\n::: note\r\n");
	await writeFile(join(root, "lesson.prax"), outside);
	await vi.waitFor(() => expect(changed).toHaveBeenCalled());
	stop();
	const refreshed = await snapshot(session);
	const current = refreshed.lessons[0].nodes.find((node) => node.id === note.id);
	expect(current?.seed.expectedText).toBe("::: note\r\nText\r\n:::\r\n");
	expect(current?.seed.baseRevision).toBe(digest(outside));
	expect(current?.seed.target).not.toEqual(note.seed.target);
	const resolved = await session.invoke("draftResolve", { draft: note.seed });
	expect(resolved).toMatchObject({
		kind: "unchanged",
		seed: {
			baseRevision: digest(outside),
			expectedText: "::: note\r\nText\r\n:::\r\n",
			editableText: "::: note\r\nText\r\n",
			target: { kind: "node", nodeId: note.id },
		},
	});
	expect(flushes.syncFile).toHaveBeenCalled();
	expect(flushes.syncDirectory).toHaveBeenCalled();
	flushes.syncFile.mockClear();
	flushes.syncDirectory.mockClear();
	const result = await withProjectFileFlushes(flushes, () =>
		session.invoke("operationApply", {
			transactionId: randomUUID(),
			operation: "editSource",
			files: [{ path: "lesson.prax", baseRevision: note.seed.baseRevision }],
			targets: [
				{ file: "lesson.prax", ref: note.seed.target, expectedText: note.seed.expectedText },
			],
			args: { text: "::: note\r\nEdited\r\n" },
		}),
	);
	expect(result).toMatchObject({ ok: true });
	expect(flushes.syncFile).toHaveBeenCalled();
	expect(flushes.syncDirectory).toHaveBeenCalled();
	expect(
		Buffer.compare(
			await readFile(join(root, "lesson.prax")),
			Buffer.from(outside.replace("Text\r\n", "Edited\r\n")),
		),
	).toBe(0);
	if (note.seed.target.kind !== "node") throw new Error("Missing node target");
	const stale = await session.invoke("draftResolve", {
		draft: { ...note.seed, target: { ...note.seed.target, nodeId: null } },
	});
	expect(stale).toEqual({ kind: "removed" });
});

it("I4 admits the manifest's lesson order, empty lessons and nested item owners", async () => {
	const root = await mkdtemp(join(tmpdir(), "studio-editor-snapshot-outline-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Course\nlessons: [b.prax, a.prax]\n");
	await writeFile(join(root, "a.prax"), "---\ntitle: Empty\n---\n");
	await writeFile(join(root, "unlisted.prax"), "# Unlisted\n");
	await writeFile(
		join(root, "b.prax"),
		"# Page\n\n::: tabs\n:: First\n::: note\nNested\n:::\n:::\n",
	);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const current = await snapshot(session);
	expect(current.lessons.map((lesson) => lesson.file)).toEqual([
		"b.prax",
		"a.prax",
		"unlisted.prax",
	]);
	expect(current.lessons.map((lesson) => lesson.listed)).toEqual([true, true, false]);
	expect(current.lessons[1].nodes).toEqual([]);
	expect(current.lessons[1].seed.editableText).toBe("---\ntitle: Empty\n---\n");
	const nodes = current.lessons[0].nodes;
	const tabs = nodes.find((node) => node.type === "tabs");
	const item = nodes.find((node) => node.kind === "item");
	const note = nodes.find((node) => node.type === "note");
	expect(item?.parentId).toBe(tabs?.id);
	expect(note?.parentId).toBe(item?.id);
	expect(note?.pageId).toBe(tabs?.pageId);
	expect(note?.seed.editableText).toBe("::: note\nNested\n");
});

it("D10 refuses duplicate fingerprint seeds rather than choosing their recorded path", async () => {
	const { root, session } = await fixture();
	const initial = await snapshot(session);
	const note = initial.lessons[0].nodes.find((node) => node.type === "note");
	if (note?.seed.target.kind !== "node") throw new Error("Missing note seed");
	const outside = source.replace(
		"::: note\r\nText\r\n:::\r\n",
		"::: note\r\nText\r\n:::\r\n\r\n::: note\r\nText\r\n:::\r\n",
	);
	await writeFile(join(root, "lesson.prax"), outside);
	const draft = { ...note.seed, target: { ...note.seed.target, nodeId: null } };
	expect(await session.invoke("draftResolve", { draft })).toEqual({
		kind: "refused",
		message: { key: "op.ambiguous", params: {} },
	});
	expect(
		await session.invoke("operationApply", {
			transactionId: randomUUID(),
			operation: "editSource",
			files: [{ path: "lesson.prax", baseRevision: draft.baseRevision }],
			targets: [{ file: draft.file, ref: draft.target, expectedText: draft.expectedText }],
			args: { text: "::: note\r\nEdited\r\n" },
		}),
	).toMatchObject({ ok: false, code: "ambiguous" });
	expect(Buffer.compare(await readFile(join(root, "lesson.prax")), Buffer.from(outside))).toBe(0);
});

it("I4 P1-1 P3-2 keeps unstored snapshot IDs equal to the preview across reads", async () => {
	const { root, session } = await fixture();
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	await writeFile(
		join(root, "lesson.prax"),
		source.replace("::: note\r\n", "::: note\r\nNew\r\n:::\r\n\r\n::: note\r\n"),
	);
	await vi.waitFor(() => expect(events.some((event) => event.type === "editorChanged")).toBe(true));
	const first = await snapshot(session);
	const second = await snapshot(session);
	const pick = (snapshot: EditorSnapshot) =>
		snapshot.lessons[0].nodes.find((node) => node.seed.editableText === "::: note\r\nNew\r\n");
	const node = pick(first);
	if (node?.seed.target.kind !== "node") throw new Error("Missing inserted note");
	expect(node.seed.target.nodeId).toBe(null);
	expect(pick(second)?.id).toBe(node?.id);
	const body = first.lessons[0].nodes.find(
		(node) => node.kind === "body" && node.seed.editableText === "New\r\n",
	);
	expect(body?.seed.target).toMatchObject({ nodeId: null });
	expect(second.lessons[0].nodes.find((node) => node.id === body?.id)?.id).toBe(body?.id);
	await vi.waitFor(() =>
		expect(
			JSON.stringify(
				events.filter((event) => event.type === "nodesRendered" || event.type === "pageCompiled"),
			),
		).toContain(`data-node-id=\\"${node?.id}\\"`),
	);
});

it("I4 R2 P1-1 joins both unstored note and body IDs to current preview after another lesson changes", async () => {
	const root = await mkdtemp(join(tmpdir(), "studio-snapshot-join-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: C\nlessons: [a.prax, b.prax]\n");
	await writeFile(join(root, "a.prax"), "# P\n\n::: note\nOne\n:::\n\n::: note\nTwo\n:::\n");
	await writeFile(join(root, "b.prax"), "# Q\n\nText\n");
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	await writeFile(
		join(root, "a.prax"),
		"# P\n\n::: note\nNew\n:::\n\n::: note\nOne\n:::\n\n::: note\nTwo\n:::\n",
	);
	await vi.waitFor(() => expect(events).toContainEqual({ type: "editorChanged", seq: 1 }));
	const first = await snapshot(session);
	const inserted = first.lessons[0].nodes.filter((node) =>
		["::: note\nNew\n", "New\n"].includes(node.seed.editableText),
	);
	expect(inserted).toHaveLength(2);
	for (const node of inserted) expect(node.seed.target).toMatchObject({ nodeId: null });
	events.length = 0;
	await writeFile(join(root, "b.prax"), "# Q\n\nText changed\n");
	await vi.waitFor(() => expect(events).toContainEqual({ type: "editorChanged", seq: 2 }));
	const latest = await snapshot(session);
	for (const node of inserted)
		expect(latest.lessons[0].nodes.find((current) => current.id === node.id)?.seed).toEqual(
			node.seed,
		);
	await session.invoke("previewSelectPage", { pageId: inserted[0].pageId });
	await vi.waitFor(() => {
		const html = JSON.stringify(
			events.filter((event) => event.type === "nodesRendered" || event.type === "pageCompiled"),
		);
		for (const node of inserted) expect(html).toContain(`data-node-id=\\"${node.id}\\"`);
	});
});

it("P3 page heading uses its authored page entry while every reader ID stays in the admitted mappings", async () => {
	const { root, session } = await fixture();
	const admitted = await resolveLessonSources(root);
	const lesson = admitted.lessons.get("lesson.prax");
	if (!lesson) throw new Error("Missing lesson");
	const pageId = lesson.pages[0].id;
	const title = [...lesson.nodes.values()].find(
		(record) => record.role === "title" && record.node.kind === "page",
	);
	if (!title) throw new Error("Missing reader title");
	const mappings = new Set(
		admitted.identity.sourceMappings
			.filter((mapping) => mapping.file === "lesson.prax")
			.map((mapping) => mapping.id),
	);
	expect([...lesson.nodes.keys()].filter((id) => !mappings.has(id))).toEqual([]);
	const current = await snapshot(session);
	const page = current.lessons[0].nodes.find((node) => node.id === pageId);
	expect(page).toMatchObject({ kind: "page", seed: { target: { nodeId: pageId, path: [1] } } });
	expect(current.lessons[0].nodes.some((node) => node.id === title.id)).toBe(false);
	const frame = buildFrameView({
		lesson,
		file: "lesson.prax",
		pageId,
		session: createSession(),
		translate: (key) => key,
	});
	expect(frame.nodes.find((node) => node.kind === "page")?.id).toBe(pageId);
	expect(
		frame.nodes
			.map((node) => node.id)
			.filter((id) => !current.lessons[0].nodes.some((node) => node.id === id)),
	).toEqual([]);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	await session.invoke("previewSelectPage", { pageId });
	await vi.waitFor(() =>
		expect(JSON.stringify(events.filter((event) => event.type === "pageCompiled"))).toContain(
			`data-node-id=\\"${title.id}\\"`,
		),
	);
});

it("D10 P2-1 notifies both subscribers for committed writes", async () => {
	const { session } = await fixture();
	const writer = vi.fn();
	const observer = vi.fn();
	session.subscribe((event) => {
		if (event.type === "editorChanged") writer(event);
	});
	session.subscribe((event) => {
		if (event.type === "editorChanged") observer(event);
	});
	const current = await snapshot(session);
	const note = current.lessons[0].nodes.find((node) => node.type === "note");
	if (!note) throw new Error("Missing note");
	const result = (await session.invoke("operationApply", {
		transactionId: randomUUID(),
		operation: "editSource",
		files: [{ path: "lesson.prax", baseRevision: note.seed.baseRevision }],
		targets: [{ file: "lesson.prax", ref: note.seed.target, expectedText: note.seed.expectedText }],
		args: { text: "::: note\r\nEdited\r\n" },
	})) as { ok: boolean; historyId: string };
	expect(result.ok).toBe(true);
	expect(writer).toHaveBeenCalledWith({ type: "editorChanged", seq: 1 });
	expect(observer).toHaveBeenCalledWith({ type: "editorChanged", seq: 1 });
});

it("D10 notifies both snapshot subscribers when committed source cannot compile", async () => {
	const { session } = await fixture();
	const current = await snapshot(session);
	const note = current.lessons[0].nodes.find((node) => node.type === "note");
	if (!note) throw new Error("Missing note");
	const first: StudioEvent[] = [],
		second: StudioEvent[] = [];
	session.subscribe((event) => first.push(event));
	session.subscribe((event) => second.push(event));
	expect(
		await session.invoke("operationApply", {
			transactionId: "contained-invalid",
			operation: "editSource",
			files: [{ path: "lesson.prax", baseRevision: note.seed.baseRevision }],
			targets: [
				{ file: "lesson.prax", ref: note.seed.target, expectedText: note.seed.expectedText },
			],
			args: { text: "::: no-such-type\r\nText\r\n" },
		}),
	).toMatchObject({ ok: true, seq: 1 });
	expect(first).toContainEqual({ type: "editorChanged", seq: 1 });
	expect(second).toContainEqual({ type: "editorChanged", seq: 1 });
	await vi.waitFor(() => expect(first.some((event) => event.type === "compileFailed")).toBe(true));
	await vi.waitFor(() => expect(first.some((event) => event.type === "treeChanged")).toBe(true));
	expect(first.filter((event) => event.type === "editorChanged")).toEqual([
		{ type: "editorChanged", seq: 1 },
	]);
	expect((await snapshot(session)).seq).toBe(1);
});

it("D1 D2 preserves BOM CRLF and astral bytes around a nested RPC seed edit", async () => {
	const root = await mkdtemp(join(tmpdir(), "studio-snapshot-bytes-"));
	roots.push(root);
	const before =
		"\uFEFF# Page\r\n\r\n::: tabs\r\n:: First\r\n::: note\r\nText\u{1F642}\r\n:::\r\n:: Second\r\nTail\r\n:::\r\n";
	await writeFile(join(root, "course.yaml"), "title: C\nlessons: [a.prax]\n");
	await writeFile(join(root, "a.prax"), before);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const current = await snapshot(session);
	expect(current.lessons[0].seed.expectedText).toBe(before);
	const note = current.lessons[0].nodes.find((node) => node.type === "note");
	if (!note) throw new Error("Missing note");
	expect(note.seed.expectedText).toBe("::: note\r\nText\u{1F642}\r\n:::\r\n");
	expect(note.seed.editableText).toBe("::: note\r\nText\u{1F642}\r\n");
	expect(
		await session.invoke("operationApply", {
			transactionId: "byte-edit",
			operation: "editSource",
			files: [{ path: "a.prax", baseRevision: note.seed.baseRevision }],
			targets: [{ file: "a.prax", ref: note.seed.target, expectedText: note.seed.expectedText }],
			args: { text: "::: note\r\nEdited\u{1F642}\r\n" },
		}),
	).toMatchObject({ ok: true });
	expect(await readFile(join(root, "a.prax"))).toEqual(
		Buffer.from(before.replace("Text", "Edited")),
	);
});

it.each([
	["operationApply", "after"],
	["operationApply", "before"],
	["operationResolve", "after"],
])(
	"01c %s anchors an insertion %s an unstored node by admitted fingerprint",
	withCountingFlushes(async (method: string, side: string) => {
		const { root, session } = await fixture();
		const events: StudioEvent[] = [];
		session.subscribe((event) => events.push(event));
		const outside = source.replace("::: note\r\n", "::: note\r\nNew\r\n:::\r\n\r\n::: note\r\n");
		await writeFile(join(root, "lesson.prax"), outside);
		await vi.waitFor(() => expect(events).toContainEqual({ type: "editorChanged", seq: 1 }));
		const current = await snapshot(session);
		const inserted = current.lessons[0].nodes.find(
			(node) => node.seed.editableText === "::: note\r\nNew\r\n",
		);
		const next = current.lessons[0].nodes.find(
			(node) => node.seed.editableText === "::: note\r\nText\r\n",
		);
		if (!inserted || !next) throw new Error("Missing anchors");
		expect(inserted.seed.target).toMatchObject({ nodeId: null });
		expect(
			await session.invoke(method, {
				transactionId: "fallback-insert",
				operation: "insertBlock",
				files: [{ path: "lesson.prax", baseRevision: current.lessons[0].baseRevision }],
				targets: [
					{
						file: "lesson.prax",
						ref:
							side === "after"
								? {
										kind: "insertion",
										parentId: inserted.parentId,
										after: null,
										afterRef: inserted.seed.target,
										before: next.id,
									}
								: {
										kind: "insertion",
										parentId: inserted.parentId,
										after: null,
										before: null,
										beforeRef: inserted.seed.target,
									},
					},
				],
				args: { text: "::: note\r\nInserted\r\n:::\r\n" },
			}),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			method === "operationApply"
				? outside.replace(
						`::: note\r\n${side === "after" ? "Text" : "New"}`,
						`::: note\r\nInserted\r\n:::\r\n\r\n::: note\r\n${side === "after" ? "Text" : "New"}`,
					)
				: outside,
		);
	}),
);

it(
	"01c refuses ambiguous unstored insertion anchors with zero writes",
	withCountingFlushes(async () => {
		const { root, session } = await fixture();
		const events: StudioEvent[] = [];
		session.subscribe((event) => events.push(event));
		const outside = source.replace(
			"::: note\r\n",
			"::: note\r\nNew\r\n:::\r\n\r\n::: note\r\nNew\r\n:::\r\n\r\n::: note\r\n",
		);
		await writeFile(join(root, "lesson.prax"), outside);
		await vi.waitFor(() => expect(events).toContainEqual({ type: "editorChanged", seq: 1 }));
		const current = await snapshot(session);
		const inserted = current.lessons[0].nodes.find(
			(node) => node.seed.editableText === "::: note\r\nNew\r\n",
		);
		if (!inserted) throw new Error("Missing anchor");
		const result = await session.invoke("operationApply", {
			transactionId: "ambiguous-insert",
			operation: "insertBlock",
			files: [{ path: "lesson.prax", baseRevision: current.lessons[0].baseRevision }],
			targets: [
				{
					file: "lesson.prax",
					ref: {
						kind: "insertion",
						parentId: inserted.parentId,
						after: null,
						afterRef: inserted.seed.target,
						before: null,
					},
				},
			],
			args: { text: "::: note\r\nInserted\r\n:::\r\n" },
		});
		expect(result).toMatchObject({ ok: false, code: "ambiguous" });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(outside);
		expect((await snapshot(session)).seq).toBe(1);
	}),
);

it.each(["wrong path", "runtime ID", "contradictory ID", "stale revision"])(
	"01c refuses %s insertion fallback with zero writes",
	withCountingFlushes(async (attack: string) => {
		const { root, session } = await fixture();
		const events: StudioEvent[] = [];
		session.subscribe((event) => events.push(event));
		const outside = source.replace("::: note\r\n", "::: note\r\nNew\r\n:::\r\n\r\n::: note\r\n");
		await writeFile(join(root, "lesson.prax"), outside);
		await vi.waitFor(() => expect(events).toContainEqual({ type: "editorChanged", seq: 1 }));
		const current = await snapshot(session);
		const inserted = current.lessons[0].nodes.find(
			(node) => node.seed.editableText === "::: note\r\nNew\r\n",
		);
		const next = current.lessons[0].nodes.find(
			(node) => node.seed.editableText === "::: note\r\nText\r\n",
		);
		if (!inserted || !next) throw new Error("Missing anchors");
		const files = (await readdir(root, { recursive: true })).filter((path) =>
			/\.(?:json|prax|yaml)$/.test(path),
		);
		const before = await Promise.all(files.map((file) => readFile(join(root, file))));
		const result = await session.invoke("operationApply", {
			transactionId: "guarded-insert",
			operation: "insertBlock",
			files: [
				{
					path: "lesson.prax",
					baseRevision:
						attack === "stale revision" ? digest(source) : current.lessons[0].baseRevision,
				},
			],
			targets: [
				{
					file: "lesson.prax",
					ref: {
						kind: "insertion",
						parentId: inserted.parentId,
						after: attack === "contradictory ID" ? next.id : null,
						afterRef: {
							...inserted.seed.target,
							...(attack === "runtime ID" ? { nodeId: inserted.id } : {}),
							...(attack === "wrong path" ? { path: [0, 99] } : {}),
						},
						before: next.id,
					},
				},
			],
			args: { text: "::: note\r\nInserted\r\n:::\r\n" },
		});
		expect(result).toMatchObject({
			ok: false,
			code: ["runtime ID", "contradictory ID"].includes(attack) ? "invalid-args" : "stale",
		});
		expect(await Promise.all(files.map((file) => readFile(join(root, file))))).toEqual(before);
		expect(
			(await readdir(root, { recursive: true })).filter((path) =>
				/\.(?:json|prax|yaml)$/.test(path),
			),
		).toEqual(files);
	}),
);

it(
	"01c inserts inside an unstored page using its null parent target",
	withCountingFlushes(async () => {
		const { root, session } = await fixture();
		const events: StudioEvent[] = [];
		session.subscribe((event) => events.push(event));
		const outside = `${source}\r\n\r\n# New page\r\n\r\n`;
		await writeFile(join(root, "lesson.prax"), outside);
		await vi.waitFor(() => expect(events).toContainEqual({ type: "editorChanged", seq: 1 }));
		const current = await snapshot(session);
		const page = current.lessons[0].nodes.find(
			(node) => node.kind === "page" && node.seed.expectedText === "# New page\r\n\r\n",
		);
		if (!page) throw new Error("Missing page");
		expect(page.seed.target).toMatchObject({ nodeId: null });
		expect(
			await session.invoke("operationApply", {
				transactionId: "parent-fallback",
				operation: "insertBlock",
				files: [{ path: "lesson.prax", baseRevision: current.lessons[0].baseRevision }],
				targets: [
					{
						file: "lesson.prax",
						ref: {
							kind: "insertion",
							parentId: null,
							parentRef: page.seed.target,
							after: null,
							before: null,
						},
					},
				],
				args: { text: "::: note\r\nInside\r\n:::\r\n" },
			}),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			`${source}\r\n\r\n# New page\r\n\r\n::: note\r\nInside\r\n:::\r\n\r\n`,
		);
	}),
);
