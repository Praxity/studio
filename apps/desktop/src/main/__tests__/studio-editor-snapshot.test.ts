import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import type { StudioEvent } from "../studio/project-session";
import { createStudioProjectSession } from "../studio/project-session";
import { startStudioServer } from "../studio/server";
import { nodeMetadataBudget } from "./fixtures/editor-snapshot";
import { sessionResult } from "./fixtures/studio-session";

const source =
	"\uFEFF---\r\ntitle: Lesson\r\n---\r\n\r\n# Page\r\n\r\n::: note\r\nText\r\n:::\r\n\r\nTail without newline";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
const sessions: { close(): Promise<void> }[] = [];

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

it.each(["UTF-8", "identity", "manifest"])(
	"redacts %s admission failures over real HTTP",
	async (failure) => {
		const root = await projectFixture();
		const ui = await mkdtemp(join(tmpdir(), "studio-snapshot-redaction-"));
		roots.push(ui);
		await writeFile(join(ui, "index.html"), "<!doctype html><title>Test</title>");

		const server = await startStudioServer({
			projectDir: root,

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

it("D1 D2 I4 admits exact CRLF node and whole-file seeds through the rooted session", async () => {
	const root = await projectFixture();
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
});
