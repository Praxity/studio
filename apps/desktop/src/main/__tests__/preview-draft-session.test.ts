import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { EditorOperationResult, PreviewRenderDraftRequest } from "../../shared/editor-session";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { resolveLessonSources } from "../lesson-source";
import { withProjectFileTransaction } from "../project-file-transactions";
import { createStudioProjectSession, type StudioEvent } from "../studio/project-session";

const source = "# Page\n\n::: note Note {tone=info}\nSaved.\n:::\n";
const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof createStudioProjectSession>>[] = [];
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(initialSource = source) {
	const root = await mkdtemp(join(tmpdir(), "p3-t2-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), initialSource);
	await persistFixtureIdentity(root);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const identity = await resolveLessonSources(root);
	const page = identity.lessons
		.get("lesson.prax")
		?.pages.find((page) => page.blocks.some((block) => block.type === "note"));
	const node = identity.identity.sourceMappings.find(
		(node) => node.id === page?.blocks.find((block) => block.type === "note")?.id,
	);
	if (!page || !node) throw Error("Missing note");
	const events: StudioEvent[] = [];
	const disconnect = session.subscribe((e) => events.push(e));
	const draft: PreviewRenderDraftRequest = {
		transactionId: randomUUID(),
		pageId: page.id,
		nodeId: node.id,
		seq: 1,
		source: "::: note Note {tone=warning}\nDraft.\n:::",
	};
	const operation = {
		transactionId: draft.transactionId,
		operation: "editSource",
		files: [
			{
				path: "lesson.prax",
				baseRevision: createHash("sha256").update(initialSource).digest("hex"),
			},
		],
		targets: [
			{
				file: "lesson.prax",
				ref: { kind: "node", nodeId: node.id, path: node.path, fingerprint: node.fingerprint },
				expectedText: initialSource.slice(node.span.start, node.span.end),
			},
		],
		args: { text: "::: note Note {tone=warning}\nDraft.\n" },
	};
	return { root, session, events, draft, operation, disconnect };
}

async function eventFor(events: StudioEvent[], predicate: (event: StudioEvent) => boolean) {
	await vi.waitUntil(() => events.some(predicate), { timeout: 1000, interval: 10 });
	const event = events.find(predicate);
	if (!event) throw Error("Missing preview event");
	return event;
}

it.each(["draft node", "sibling node"])(
	"a refused draft restores a watcher-admitted outside edit to the %s",
	async (target) => {
		const initialSource = `${source}\n::: note Sibling {tone=info}\nSaved sibling.\n:::\n`;
		const { root, session, events, draft, operation } = await fixture(initialSource);
		await session.invoke("previewSelectPage", { pageId: draft.pageId });
		await eventFor(events, (event) => event.type === "pageCompiled");
		await session.invoke("previewRenderDraft", draft);
		const outside =
			target === "draft node"
				? initialSource.replace("Saved.", "Outside.")
				: initialSource.replace("Saved sibling.", "Outside sibling.");
		await writeFile(join(root, "lesson.prax"), outside);
		await eventFor(events, (event) => event.type === "grammarChanged" && event.grammar === outside);
		await vi.waitUntil(
			async () => {
				const stats = (await session.invoke("previewStats", {})) as {
					contextSeq: number;
					compiles: number;
				};
				return stats.contextSeq === 1 && stats.compiles >= 2;
			},
			{ timeout: 1000, interval: 10 },
		);
		const before = events.length;
		const refused =
			target === "draft node"
				? operation
				: {
						...operation,
						targets: [{ ...operation.targets[0], expectedText: "Wrong saved bytes" }],
					};
		expect(await session.invoke("operationApply", refused)).toMatchObject({ ok: false });
		await eventFor(events, (event) => event.type === "pageCompiled" && event.patch.seq === 1);
		const tail = events.slice(before);
		expect(tail).toContainEqual(
			expect.objectContaining({
				type: "draftRendered",
				render: expect.objectContaining({ state: "reverted", transactionId: draft.transactionId }),
			}),
		);
		expect(JSON.stringify(tail)).toContain(
			target === "draft node" ? "Outside." : "Outside sibling.",
		);
		if (target === "draft node") expect(JSON.stringify(tail)).not.toContain("Saved.");
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(outside);
	},
);

it("a renderer subscription reconnect starts a fresh draft sequence domain on every page", async () => {
	const {
		root,
		session: reloaded,
		draft,
		events: oldEvents,
		disconnect,
	} = await fixture(`${source}\n# Second\n\nSecond saved.\n`);
	const identity = await resolveLessonSources(root);
	const admittedPages = identity.lessons.get("lesson.prax")?.pages;
	if (admittedPages?.length !== 2) throw Error("Missing reload pages");
	const requests = admittedPages.map((page, index) => ({
		...draft,
		pageId: page.id,
		nodeId: page.blocks.find((block) => block.type === "text" || block.type === "note")?.id ?? "",
		seq: 8,
		transactionId: `old-${index}`,
	}));
	for (const request of requests) {
		expect(await reloaded.invoke("previewRenderDraft", request)).toMatchObject({ ok: true });
		expect(
			await reloaded.invoke("previewRenderDraft", { ...request, seq: 1, transactionId: "stale" }),
		).toMatchObject({ ok: false, code: "stale" });
	}
	disconnect();
	const newEvents: StudioEvent[] = [];
	reloaded.subscribe((event) => newEvents.push(event));
	for (const [index, request] of requests.entries())
		expect(
			await reloaded.invoke("previewRenderDraft", {
				...request,
				seq: 1,
				transactionId: `new-${index}`,
			}),
		).toMatchObject({ ok: true });
	// A repeated unsubscribe from the old connection must not end the new epoch.
	disconnect();
	for (const request of requests)
		expect(
			await reloaded.invoke("previewRenderDraft", {
				...request,
				seq: 0,
				transactionId: "new-stale",
			}),
		).toMatchObject({ ok: false, code: "stale" });
	expect(newEvents.filter((event) => event.type === "draftRendered")).toHaveLength(2);
	expect(
		oldEvents.filter(
			(event) => event.type === "draftRendered" && event.render.state === "reverted",
		),
	).toHaveLength(2);
});

it("a renderer reload starts its seq epoch before the previous stream has closed", async () => {
	const { session, draft, events: oldEvents, disconnect } = await fixture();
	expect(await session.invoke("previewRenderDraft", { ...draft, seq: 8 })).toMatchObject({
		ok: true,
	});
	const newEvents: StudioEvent[] = [];
	const disconnectNew = session.subscribe((event) => newEvents.push(event));
	const replacement = { ...draft, seq: 1, transactionId: "replacement" };
	expect(await session.invoke("previewRenderDraft", replacement)).toMatchObject({ ok: true });
	expect(
		oldEvents.filter(
			(event) =>
				event.type === "draftRendered" &&
				event.render.transactionId === draft.transactionId &&
				event.render.state === "reverted",
		),
	).toHaveLength(1);
	// The current renderer owns teardown even while the old stream remains open.
	disconnectNew();
	expect(newEvents).toMatchObject([
		{ type: "draftRendered", render: { transactionId: "replacement", state: "draft" } },
		{ type: "draftRendered", render: { transactionId: "replacement", state: "reverted" } },
	]);
	const latest: StudioEvent[] = [];
	session.subscribe((event) => latest.push(event));
	expect(
		await session.invoke("previewRenderDraft", { ...replacement, transactionId: "latest" }),
	).toMatchObject({ ok: true });
	disconnect();
	expect(
		await session.invoke("previewRenderDraft", { ...replacement, seq: 0, transactionId: "late" }),
	).toMatchObject({ ok: false, code: "stale" });
	expect(latest).toHaveLength(1);
});

it("an older sibling commit across reload still reaches the current renderer after its draft reverts", async () => {
	const initialSource = `---\ndesign:\n  navArchetype: none\n---\n${source}\n::: note Sibling {tone=info}\nSaved sibling.\n:::\n`;
	const { root, session, events, draft, operation, disconnect } = await fixture(initialSource);
	const identity = await resolveLessonSources(root);
	const sibling = identity.identity.sourceMappings.find(
		(node) =>
			node.file === "lesson.prax" &&
			initialSource.slice(node.span.start, node.span.end).startsWith("::: note Sibling"),
	);
	if (!sibling) throw Error("Missing sibling");
	const siblingOperation = {
		...operation,
		transactionId: randomUUID(),
		targets: [
			{
				file: "lesson.prax",
				ref: {
					kind: "node",
					nodeId: sibling.id,
					path: sibling.path,
					fingerprint: sibling.fingerprint,
				},
				expectedText: initialSource.slice(sibling.span.start, sibling.span.end),
			},
		],
		args: { text: "::: note Sibling {tone=info}\nCommitted sibling.\n" },
	};
	await session.invoke("previewSelectPage", { pageId: draft.pageId });
	await eventFor(events, (event) => event.type === "pageCompiled");
	expect(
		await session.invoke("previewRenderDraft", {
			...draft,
			nodeId: sibling.id,
			transactionId: siblingOperation.transactionId,
		}),
	).toMatchObject({ ok: true });
	let entered: () => void = () => {};
	let release: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const hold = withProjectFileTransaction(
		root,
		async () => {
			entered();
			await gate;
		},
		"read",
	);
	await started;
	const pending = session.invoke("operationApply", siblingOperation);
	const replacementEvents: StudioEvent[] = [];
	try {
		session.subscribe((event) => replacementEvents.push(event));
		disconnect();
		await session.invoke("previewSelectPage", { pageId: draft.pageId });
		expect(replacementEvents).toContainEqual(
			expect.objectContaining({
				type: "pageCompiled",
				patch: expect.objectContaining({
					fragments: expect.arrayContaining([
						expect.objectContaining({
							id: sibling.id,
							html: expect.stringContaining("Saved sibling."),
						}),
					]),
				}),
			}),
		);
		expect(await session.invoke("previewRenderDraft", draft)).toMatchObject({ ok: true });
	} finally {
		release();
		await hold;
	}
	expect(await pending).toMatchObject({ ok: true });
	await vi.waitUntil(
		async () =>
			((await session.invoke("previewStats", {})) as { contextSeq: number }).contextSeq === 1,
		{ timeout: 1000, interval: 10 },
	);
	expect(
		await session.invoke("operationApply", {
			...operation,
			targets: [{ ...operation.targets[0], expectedText: "Wrong saved bytes" }],
		}),
	).toMatchObject({ ok: false });
	const compiled = await eventFor(
		replacementEvents,
		(event) => event.type === "pageCompiled" && event.patch.seq === 1,
	);
	expect(compiled).toMatchObject({
		patch: {
			shellStale: false,
			fragments: expect.arrayContaining([
				expect.objectContaining({
					id: sibling.id,
					html: expect.stringContaining("Committed sibling."),
				}),
			]),
		},
	});
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toContain("Committed sibling.");
	expect(replacementEvents.filter((event) => event.type === "compileFailed")).toEqual([]);
});

it("queued commit refresh reads identity and manifest in one fresh admission before the watcher catches up", async () => {
	const { root, session, events, operation } = await fixture();
	const delay = globalThis.setTimeout;
	vi.useFakeTimers({
		toFake: [
			"setTimeout",
			"clearTimeout",
			"setInterval",
			"clearInterval",
			"setImmediate",
			"clearImmediate",
		],
	});
	expect(await session.invoke("operationApply", operation)).toMatchObject({ ok: true, seq: 1 });
	await writeFile(join(root, "added.prax"), "# Added\n\nOutside lesson.\n");
	await writeFile(
		join(root, "course.yaml"),
		"title: Course\nlessons:\n  - lesson.prax\n  - added.prax\n",
	);
	// Freeze Chokidar's 100 ms stability timer while letting the queued refresh use real I/O.
	const deadline = Date.now() + 1000;
	let stats: { contextSeq: number } = { contextSeq: 0 };
	while (Date.now() < deadline) {
		await vi.advanceTimersByTimeAsync(0);
		stats = (await session.invoke("previewStats", {})) as { contextSeq: number };
		if (stats.contextSeq === 1 || events.some((event) => event.type === "compileFailed")) break;
		await new Promise<void>((done) => delay(done, 10));
	}
	expect(events.filter((event) => event.type === "grammarChanged")).toEqual([]);
	expect(events.filter((event) => event.type === "compileFailed")).toEqual([]);
	expect(stats.contextSeq).toBe(1);
	const navigation = (await session.invoke("previewSelectPage", {})) as { pages: { id: string }[] };
	expect(navigation.pages).toHaveLength(2);
}, 10_000);
async function bytes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const name = join(prefix, entry.name);
		if (entry.isDirectory()) Object.assign(result, await bytes(root, name));
		else result[name] = (await readFile(join(root, name))).toString("base64");
	}
	return result;
}

it("non-durable draft RPC leaves every project byte unchanged and returns the typed draft event", async () => {
	const { root, session, events, draft } = await fixture();
	const before = await bytes(root);
	expect(await session.invoke("previewRenderDraft", draft)).toMatchObject({
		ok: true,
		render: {
			state: "draft",
			fragments: [{ id: draft.nodeId, html: expect.stringContaining("Draft.") }],
		},
	});
	expect(await bytes(root)).toEqual(before);
	expect(events.map((e) => e.type)).toEqual(["draftRendered"]);
});

it("durable response contains only the changed node before queued input/context refresh", async () => {
	const { root, session, events, draft, operation } = await fixture();
	await session.invoke("previewRenderDraft", draft);
	const result = (await session.invoke("operationApply", operation)) as EditorOperationResult;
	if (!result.ok) throw Error(JSON.stringify(result));
	expect(result).toMatchObject({
		ok: true,
		seq: 1,
		render: { fragments: [{ id: draft.nodeId, html: expect.stringContaining("Draft.") }] },
	});
	if (!result.ok) throw Error("Commit refused");
	expect(result.render?.fragments).toHaveLength(1);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toContain("Draft.");
	expect(events).toContainEqual(
		expect.objectContaining({
			type: "draftRendered",
			render: expect.objectContaining({ state: "saved" }),
		}),
	);
	expect(await session.invoke("previewStats", {})).toMatchObject({ contextSeq: 0 });
}, 10_000);

it("refused commit returns saved HTML, retains the persisted draft and returns its announcement key", async () => {
	const { root, session, events, draft, operation } = await fixture();
	const ref = operation.targets[0].ref;
	const persisted = {
		id: "author",
		file: "lesson.prax",
		target: ref,
		baseRevision: operation.files[0].baseRevision,
		expectedText: operation.targets[0].expectedText,
		editableText: operation.targets[0].expectedText,
		baseText: operation.targets[0].expectedText,
		text: draft.source,
		selection: [0, 0],
		generation: 1,
		status: "dirty",
		diagnostics: [],
		changedAt: 1,
		validatedGeneration: 1,
		persistedGeneration: -1,
	};
	expect(await session.invoke("draftPut", { draft: persisted })).toMatchObject({ ok: true });
	await session.invoke("previewRenderDraft", draft);
	const before = await bytes(root);
	const result = await session.invoke("operationApply", {
		...operation,
		targets: [{ ...operation.targets[0], expectedText: "Wrong saved bytes" }],
	});
	expect(result).toMatchObject({ ok: false, code: "conflict", message: { key: "op.conflict" } });
	expect(events.at(-1)).toMatchObject({
		type: "draftRendered",
		render: {
			state: "reverted",
			seq: 1,
			fragments: [{ id: draft.nodeId, html: expect.stringContaining("Saved.") }],
		},
	});
	expect(await session.invoke("draftList", {})).toMatchObject([{ text: draft.source }]);
	expect(await bytes(root)).toEqual(before);
});

it.each([{ pageId: "absent" }, { nodeId: "absent" }, { source: "One.\n\nTwo." }])(
	"draft refusal leaves source and identity unchanged: %j",
	async (mutation) => {
		const { root, session, draft, events } = await fixture();
		const before = await bytes(root);
		expect(await session.invoke("previewRenderDraft", { ...draft, ...mutation })).toMatchObject({
			ok: false,
		});
		expect(events).toEqual([]);
		expect(await bytes(root)).toEqual(before);
	},
);

it.each([
	{ seq: -1 },
	{ seq: 0.5 },
	{ seq: Number.MAX_SAFE_INTEGER + 1 },
	{ transactionId: "" },
	{ pageId: "" },
	{ pageId: "p".repeat(1025) },
	{ nodeId: "" },
	{ nodeId: "n".repeat(1025) },
	{ source: "x".repeat(5_000_001) },
	{ unknown: true },
])("invalid draft RPC input $0 is rejected before rendering or writing", async (mutation) => {
	const { root, session, draft, events } = await fixture();
	const before = await bytes(root);
	await expect(session.invoke("previewRenderDraft", { ...draft, ...mutation })).rejects.toThrow();
	expect(events).toEqual([]);
	expect(await bytes(root)).toEqual(before);
});
