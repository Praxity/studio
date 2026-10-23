import { createHash, randomUUID } from "node:crypto";
import {
	cp,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { EditorOperationResult } from "../../shared/editor-session";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { resolveLessonSources } from "../lesson-source";
import { withProjectFileFlushes } from "../project-file-transactions";
import { createStudioProjectSession, type StudioEvent } from "../studio/project-session";

// Real journal bytes, admissions and recovery remain; journal-flush tests own durability.
// No-op syncFile also omits the default adapter's post-write path checks.
function withCountingFlushes<Args extends unknown[]>(work: (...args: Args) => Promise<void>) {
	return async (...args: Args) => {
		const flushes = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
		await withProjectFileFlushes(flushes, () => work(...args));
		expect(flushes.syncFile).toHaveBeenCalled();
		expect(flushes.syncDirectory).toHaveBeenCalled();
	};
}

const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof createStudioProjectSession>>[] = [];
const source = "# Page\n\n::: note Note {tone=info}\nBefore.\n:::\n";
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(initialSource = source) {
	const root = await mkdtemp(join(tmpdir(), "p3-preview-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), initialSource);
	await persistFixtureIdentity(root);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	return { root, session, events };
}
async function waitFor(events: StudioEvent[], predicate: (event: StudioEvent) => boolean) {
	const deadline = Date.now() + 1000;
	while (Date.now() < deadline) {
		const event = events.find(predicate);
		if (event) return event;
		await new Promise((done) => setTimeout(done, 10));
	}
	throw new Error("Preview event missed T6's 1 s deadline");
}
// These cases exercise commit results and rendering; journal tests cover real flushes.
async function applyNoteTone() {
	const { root, session } = await fixture();
	const current = await resolveLessonSources(root);
	const node = current.identity.sourceMappings.find(
		(node) => node.file === "lesson.prax" && node.path.join() === "0,0",
	);
	if (!node) throw new Error("Missing note");
	const request = {
		transactionId: randomUUID(),
		operation: "setProperty",
		files: [
			{ path: "lesson.prax", baseRevision: createHash("sha256").update(source).digest("hex") },
		],
		targets: [
			{
				file: "lesson.prax",
				ref: { kind: "node", nodeId: node.id, path: node.path, fingerprint: node.fingerprint },
				expectedText: source.slice(node.span.start, node.span.end),
			},
		],
		args: { name: "tone", value: "warning" },
	};
	const result = (await session.invoke("operationApply", request)) as EditorOperationResult;
	return { session, request, node, result };
}

it(
	"T2 operationApply returns new node HTML and a monotonic seq; refusal does not advance",
	withCountingFlushes(async () => {
		const { session, request, node, result } = await applyNoteTone();
		expect(result).toMatchObject({
			ok: true,
			seq: 1,
			render: { seq: 1, fragments: [{ id: node.id, html: expect.stringContaining("warning") }] },
		});
		expect(await session.invoke("operationApply", request)).toMatchObject({ ok: false });
	}),
	15_000,
);

// Two durable commits: Intel Mac max 6590.8 ms, Linux CI 335 ms; allow twice the slower run.
it(
	"T2 historyApply after an operation advances the render seq",
	withCountingFlushes(async () => {
		const { session, result } = await applyNoteTone();
		if (!result.ok) throw new Error("Operation refused");
		expect(
			await session.invoke("historyApply", {
				transactionId: randomUUID(),
				historyId: result.historyId,
				direction: "undo",
			}),
		).toMatchObject({ ok: true, seq: 2, render: { seq: 2 } });
	}),
	13_182, // timeout: docs/context/testing-strategy.md; run 38146537167
);
it("T6 watcher admits an outside revision and compiles the visible page", async () => {
	const { root, session, events } = await fixture();
	const selected = (await session.invoke("previewSelectPage", {})) as { pageId: string };
	await waitFor(events, (event) => event.type === "pageCompiled");
	events.length = 0;
	await writeFile(join(root, "lesson.prax"), source.replace("Before.", "Outside."));
	const event = await waitFor(events, (event) => event.type === "pageCompiled");
	expect(event).toMatchObject({
		type: "pageCompiled",
		patch: { pageId: selected.pageId, fragments: [{ html: expect.stringContaining("Outside.") }] },
	});
});

it("parse failure retains output and restoring the exact previous bytes compiles again", async () => {
	const outside = source.replace("Before.", "Outside.");
	const { root, session, events } = await fixture(outside);
	const selected = (await session.invoke("previewSelectPage", {})) as { pageId: string };
	await waitFor(events, (event) => event.type === "pageCompiled");
	events.length = 0;
	await writeFile(join(root, "lesson.prax"), "# Page\n\n::: note Broken\nUnclosed.\n");
	const failure = await waitFor(events, (event) => event.type === "compileFailed");
	expect(failure).toMatchObject({
		type: "compileFailed",
		pageId: selected.pageId,
		diagnostics: [expect.objectContaining({ line: expect.any(Number) })],
	});
	expect(events.some((event) => event.type === "pageCompiled")).toBe(false);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toContain("Unclosed.");
	events.length = 0;
	await writeFile(join(root, "lesson.prax"), outside);
	expect(await waitFor(events, (event) => event.type === "pageCompiled")).toMatchObject({
		type: "pageCompiled",
		patch: { pageId: selected.pageId },
	});
});

it("unreadable UTF-8 outside source emits compileFailed and keeps the good page", async () => {
	const { root, session, events } = await fixture();
	await session.invoke("previewSelectPage", {});
	await waitFor(events, (event) => event.type === "pageCompiled");
	events.length = 0;
	await writeFile(join(root, "lesson.prax"), Buffer.from([0xff]));
	expect(await waitFor(events, (event) => event.type === "compileFailed")).toMatchObject({
		type: "compileFailed",
		diagnostics: [{ file: "lesson.prax", message: expect.any(String) }],
	});
	expect(events.some((event) => event.type === "pageCompiled")).toBe(false);
});

it("a newly added invalid lesson emits diagnostics when it has no prior page IDs", async () => {
	const { root, session, events } = await fixture();
	const selected = (await session.invoke("previewSelectPage", {})) as { pageId: string };
	await waitFor(events, (event) => event.type === "pageCompiled");
	events.length = 0;
	// Keep lesson order stable; a changed ordinal must refresh an untitled lesson's label.
	await writeFile(join(root, "z-broken.prax"), "# Broken\n\n::: note Unclosed\nText.\n");
	expect(await waitFor(events, (event) => event.type === "compileFailed")).toMatchObject({
		type: "compileFailed",
		pageId: selected.pageId,
		diagnostics: [expect.objectContaining({ file: "z-broken.prax", line: expect.any(Number) })],
	});
	expect(events.some((event) => event.type === "pageCompiled")).toBe(false);
});

it("same-size source changes within one timestamp second equal a fresh render", async () => {
	const { root, session, events } = await fixture();
	await session.invoke("previewSelectPage", {});
	await waitFor(events, (event) => event.type === "pageCompiled");
	const file = join(root, "lesson.prax");
	const second = Math.floor(Date.now() / 1000);
	await utimes(file, second + 0.1, second + 0.1);
	const before = await stat(file);
	events.length = 0;
	const changed = source.replace("Before.", "After!.");
	await writeFile(file, changed);
	await utimes(file, second + 0.2, second + 0.2);
	const after = await stat(file);
	expect(after.size).toBe(before.size);
	expect(Math.floor(after.mtimeMs / 1000)).toBe(Math.floor(before.mtimeMs / 1000));
	const cached = await waitFor(events, (event) => event.type === "pageCompiled");
	expect(cached).toMatchObject({
		patch: { fragments: [{ html: expect.stringContaining("After!.") }] },
	});
	const fresh = await fixture(changed);
	await fresh.session.invoke("previewSelectPage", {});
	const output = await waitFor(fresh.events, (event) => event.type === "pageCompiled");
	if (output.type !== "pageCompiled") throw new Error("Missing fresh output");
	if (cached.type !== "pageCompiled") throw new Error("Missing cached output");
	const normalize = (html: string | undefined) =>
		html?.replace(/rt-[0-9a-f]{32}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/g, "node");
	expect(
		normalize(cached.patch.fragments.find((fragment) => fragment.html.includes("After!."))?.html),
	).toBe(
		normalize(output.patch.fragments.find((fragment) => fragment.html.includes("After!."))?.html),
	);
});

it("a retargeted identity junction fails admission and restoration recovers cached preview", async () => {
	const { root, session, events } = await fixture();
	await session.invoke("previewSelectPage", {});
	const baseline = await waitFor(events, (event) => event.type === "pageCompiled");
	const saved = join(root, "saved-store");
	const link = join(root, ".praxity");
	const outside = await mkdtemp(join(tmpdir(), "p3-outside-"));
	roots.push(outside);
	await rename(link, saved);
	await cp(saved, outside, { recursive: true });
	await symlink(outside, link, "junction");
	events.length = 0;
	await writeFile(join(root, "lesson.prax"), source.replace("Before.", "Changed"));
	expect(await waitFor(events, (event) => event.type === "compileFailed")).toMatchObject({
		type: "compileFailed",
	});
	expect(events.some((event) => event.type === "pageCompiled")).toBe(false);
	await rm(link);
	await symlink(saved, link, "junction");
	events.length = 0;
	await writeFile(join(root, "lesson.prax"), source);
	const recovered = await waitFor(events, (event) => event.type === "pageCompiled");
	if (baseline.type !== "pageCompiled" || recovered.type !== "pageCompiled")
		throw new Error("Missing preview output");
	expect(recovered.patch.seq).toBeGreaterThan(baseline.patch.seq);
	events.length = 0;
	await session.invoke("previewSelectPage", {});
	const replay = await waitFor(events, (event) => event.type === "pageCompiled");
	if (replay.type !== "pageCompiled") throw new Error("Missing restored output");
	expect(replay.patch.fragments).toEqual(baseline.patch.fragments);
});
