import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import {
	CourseIdentitySession,
	persistCourseIdentity,
	resolveCourseIdentity,
} from "../identity-store";
import { resolveLessonSources } from "../lesson-source";
import { readBlockInventory } from "../operations/block-inspection";
import { OperationService } from "../operations/operation-service";
import { withProjectFileTransaction } from "../project-file-transactions";
import { createStudioProjectSession, type StudioEvent } from "../studio/project-session";

const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof createStudioProjectSession>>[] = [];
const a = "# P\n\n::: note\nOne\n:::\n";
const b = "# Q\n\nText\n";
const inserted = "# P\n\n::: note\nNew\n:::\n\n::: note\nOne\n:::\n";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function bytes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await bytes(root, path));
		else result[path] = await readFile(join(root, path), "utf8");
	}
	return result;
}
async function fixture(source = inserted, stored = true) {
	const root = await mkdtemp(join(tmpdir(), "i4-write-match-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: C\nlessons: [a.prax, b.prax]\n");
	await writeFile(join(root, "a.prax"), a);
	await writeFile(join(root, "b.prax"), b);
	if (stored) await persistFixtureIdentity(root);
	await writeFile(join(root, "a.prax"), source);
	let runtime = 0x1003;
	const session = new CourseIdentitySession(root, {
		allocateRuntimeId: () => `rt-${(runtime++).toString(16).padStart(32, "0")}`,
	});
	const view = await resolveLessonSources(root, {}, { identitySession: session });
	const frameMessages: unknown[] = [];
	const service = new OperationService(root, session, async (result, identity) => {
		frameMessages.push(
			result,
			[...identity.lessons.values()].map((lesson) => lesson.pages),
		);
		return undefined;
	});
	return { root, session, service, view, frameMessages };
}
async function edit(root: string, file: string, startsWith: string, text: string) {
	const inventory = await readBlockInventory(root);
	const block = inventory.blocks.find(
		(block) => block.file === file && block.source.startsWith(startsWith),
	);
	if (!block) throw new Error("Missing target");
	return {
		transactionId: "write",
		operation: "editSource",
		files: [{ path: file, baseRevision: digest(await readFile(join(root, file), "utf8")) }],
		targets: [block.target],
		args: { text },
	};
}

it("I4 a successful edit returns New and its child to the author, then reloads durable IDs", async () => {
	const { root, session, service, view, frameMessages } = await fixture();
	expect(view.readView?.runtimeIds).toEqual([
		"rt-00000000000000000000000000001003",
		"rt-00000000000000000000000000001004",
	]);
	const request = await edit(root, "a.prax", "New", "Changed\n");
	expect(request.targets[0].ref).toMatchObject({ nodeId: null });
	const result = await service.apply(request);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.code);
	const durable = await resolveLessonSources(root, {}, { identitySession: session });
	const note = durable.identity.sourceMappings.find(
		(m) => m.file === "a.prax" && m.path.join() === "0,0",
	);
	const body = durable.identity.sourceMappings.find(
		(m) => m.file === "a.prax" && m.path.join() === "0,0,0",
	);
	if (!note || !body) throw new Error("Missing durable New");
	expect(result.correspondence).toEqual([
		{ runtimeId: "rt-00000000000000000000000000001003", durableId: note.id },
		{ runtimeId: "rt-00000000000000000000000000001004", durableId: result.focus.nodeId },
	]);
	expect(result.focus.nodeId).toBe(body.id);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe(
		"# P\n\n::: note\nChanged\n:::\n\n::: note\nOne\n:::\n",
	);
	expect(durable.readView?.correspondence).toEqual([]);
	expect((await resolveLessonSources(root)).identity.sourceMappings).toEqual(
		durable.identity.sourceMappings,
	);
	for (const [path, content] of Object.entries(await bytes(root))) {
		expect(content, path).not.toContain("rt-");
		expect(content, path).not.toContain("correspondence");
	}
	expect(JSON.stringify(frameMessages)).not.toContain("correspondence");
	expect(JSON.stringify(frameMessages)).not.toContain("rt-");
	const undo = await service.historyApply({
		transactionId: "undo",
		historyId: result.historyId,
		direction: "undo",
	});
	expect(undo).toMatchObject({ ok: true, correspondence: [] });
	expect(JSON.stringify(undo)).not.toContain("rt-");
});

it("I4 a read after a session-less write suppresses runtime-to-durable correspondence", async () => {
	const { root, session, view } = await fixture();
	expect(view.readView?.runtimeIds).toEqual([
		"rt-00000000000000000000000000001003",
		"rt-00000000000000000000000000001004",
	]);
	const result = await new OperationService(root).apply(
		await edit(root, "b.prax", "Text", "Changed\n"),
	);
	expect(result).toMatchObject({ ok: true, correspondence: [] });
	const read = await resolveLessonSources(root, {}, { identitySession: session });
	expect(read.readView?.runtimeIds).toEqual([]);
	expect(read.readView?.sourceMappings.filter((m) => m.file === "a.prax")).toEqual(
		read.identity.sourceMappings.filter((m) => m.file === "a.prax"),
	);
	expect(read.readView?.correspondence).toEqual([]);
	expect(read.correspondence).toBeUndefined();
});

it("I4 an unrelated B write reports every unstored node in A, including repeated notes", async () => {
	const source = "# P\n\n::: note\nNew\n:::\n\n::: note\nNew\n:::\n\n::: note\nOne\n:::\n";
	const { root, service, view } = await fixture(source);
	expect(view.readView?.runtimeIds).toEqual([
		"rt-00000000000000000000000000001003",
		"rt-00000000000000000000000000001004",
		"rt-00000000000000000000000000001005",
		"rt-00000000000000000000000000001006",
	]);
	const result = await service.apply(await edit(root, "b.prax", "Text", "Changed\n"));
	if (!result.ok) throw new Error(result.code);
	const durable = await resolveLessonSources(root);
	const ids = [
		[0, 0],
		[0, 0, 0],
		[0, 1],
		[0, 1, 0],
	].map(
		(path) =>
			durable.identity.sourceMappings.find(
				(m) => m.file === "a.prax" && m.path.join() === path.join(),
			)?.id,
	);
	expect(result.correspondence).toEqual([
		{ runtimeId: "rt-00000000000000000000000000001003", durableId: ids[0] },
		{ runtimeId: "rt-00000000000000000000000000001004", durableId: ids[1] },
		{ runtimeId: "rt-00000000000000000000000000001005", durableId: ids[2] },
		{ runtimeId: "rt-00000000000000000000000000001006", durableId: ids[3] },
	]);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe(source);
});

it("I4 a write refreshes saved display identity after an unread outside source change", async () => {
	const { root, service, view } = await fixture(a);
	expect(view.readView?.runtimeIds).toEqual([]);
	await writeFile(join(root, "a.prax"), inserted);
	// The watcher has not admitted A; B's write must admit the current saved sources itself.
	const result = await service.apply(await edit(root, "b.prax", "Text", "Changed\n"));
	if (!result.ok) throw new Error(result.code);
	const durable = await resolveLessonSources(root);
	const note = durable.identity.sourceMappings.find(
		(m) => m.file === "a.prax" && m.path.join() === "0,0",
	);
	const body = durable.identity.sourceMappings.find(
		(m) => m.file === "a.prax" && m.path.join() === "0,0,0",
	);
	if (!note || !body) throw new Error("Missing admitted outside nodes");
	expect(result.correspondence).toEqual([
		{ runtimeId: "rt-00000000000000000000000000001003", durableId: note.id },
		{ runtimeId: "rt-00000000000000000000000000001004", durableId: body.id },
	]);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe(inserted);
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe("# Q\n\nChanged\n");
});

it("I4 an absent store returns correspondence for all runtime nodes and namespaces", async () => {
	const { root, service, view } = await fixture(a, false);
	expect(view.readView?.runtimeIds).toEqual([
		"rt-00000000000000000000000000001003",
		"rt-00000000000000000000000000001004",
		"rt-00000000000000000000000000001005",
		"rt-00000000000000000000000000001006",
		"rt-00000000000000000000000000001007",
		"rt-00000000000000000000000000001008",
		"rt-00000000000000000000000000001009",
		"rt-0000000000000000000000000000100a",
		"rt-0000000000000000000000000000100b",
	]);
	const result = await service.apply(await edit(root, "b.prax", "Text", "Changed\n"));
	if (!result.ok) throw new Error(result.code);
	const durable = await resolveLessonSources(root);
	expect(result.correspondence).toEqual([
		...[
			"rt-00000000000000000000000000001003",
			"rt-00000000000000000000000000001004",
			"rt-00000000000000000000000000001005",
			"rt-00000000000000000000000000001006",
			"rt-00000000000000000000000000001007",
			"rt-00000000000000000000000000001008",
			"rt-00000000000000000000000000001009",
			"rt-0000000000000000000000000000100a",
			"rt-0000000000000000000000000000100b",
		].map((runtimeId, index) => ({
			runtimeId,
			durableId: durable.identity.sourceMappings[index].id,
		})),
		{
			runtimeId: "rt-0000000000000000000000000000100c",
			durableId: durable.identity.course.courseId,
		},
	]);
});

it("I4 a write storing no new nodes has empty correspondence", async () => {
	const { root, service } = await fixture(a);
	const before = await bytes(root);
	const result = await service.apply(await edit(root, "b.prax", "Text", "Text\n"));
	expect(result).toMatchObject({ ok: true, correspondence: [] });
	expect(await bytes(root)).toEqual(before);
});

it("I4 a node retired by the write still joins its installed historical UUID", async () => {
	const { root, service } = await fixture();
	const result = await service.apply(await edit(root, "a.prax", "New", ""));
	if (!result.ok) throw new Error(result.code);
	const retired = result.mapping.find((m) => m.fate === "retired" && m.oldId);
	if (!retired) throw new Error("Missing retired body");
	expect(result.correspondence).toContainEqual({
		runtimeId: "rt-00000000000000000000000000001004",
		durableId: retired.oldId,
	});
	const persisted = await bytes(root);
	expect(
		Object.entries(persisted)
			.filter(([path]) => path.startsWith(".praxity/identity/snapshots/"))
			.some(
				([, content]) => JSON.parse(content).nodes[retired.oldId as string]?.status === "retired",
			),
	).toBe(true);
	for (const content of Object.values(persisted)) {
		expect(content).not.toContain("rt-");
		expect(content).not.toContain("correspondence");
	}
	expect(JSON.stringify(result.mapping)).not.toContain("rt-");
});

it("I4 the parsed open draft's runtime nodes also join the write that stores them", async () => {
	const { root, session, service } = await fixture(a);
	const draft = await resolveLessonSources(
		root,
		{ "a.prax": inserted },
		{ identitySession: session },
	);
	expect(draft.readView?.runtimeIds).toEqual([
		"rt-00000000000000000000000000001003",
		"rt-00000000000000000000000000001004",
	]);
	const request = await edit(root, "a.prax", "::: note", "::: note\nNew\n:::\n\n::: note\nOne\n");
	const result = await service.apply(request);
	if (!result.ok) throw new Error(result.code);
	const durable = await resolveLessonSources(root);
	expect(result.correspondence).toEqual([
		{
			runtimeId: "rt-00000000000000000000000000001003",
			durableId: durable.identity.sourceMappings.find(
				(m) => m.file === "a.prax" && m.path.join() === "0,0",
			)?.id,
		},
		{
			runtimeId: "rt-00000000000000000000000000001004",
			durableId: durable.identity.sourceMappings.find(
				(m) => m.file === "a.prax" && m.path.join() === "0,0,0",
			)?.id,
		},
	]);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe(inserted);
});

it("I4 a refused write returns no correspondence and preserves every file", async () => {
	const { root, service } = await fixture();
	const before = await bytes(root);
	const result = await service.apply(await edit(root, "a.prax", "New", "# Escape\n"));
	expect(result).toMatchObject({ ok: false, code: "escapes-range" });
	expect(result).not.toHaveProperty("correspondence");
	expect(await bytes(root)).toEqual(before);
});

it("I4 an unpersisted write candidate cannot contaminate saved runtime continuity with draft bytes", async () => {
	const { root, session } = await fixture();
	const before = await bytes(root);
	await withProjectFileTransaction(
		root,
		() =>
			resolveCourseIdentity(root, {
				lessonPaths: ["a.prax", "b.prax"],
				identitySession: session,
				sources: {
					"a.prax": "# P\n\n::: note\nNew\n:::\n\n::: note\nNew\n:::\n\n::: note\nOne\n:::\n",
				},
			}),
		"write",
		false,
	);
	expect(
		(await resolveLessonSources(root, {}, { identitySession: session })).readView?.runtimeIds,
	).toEqual(["rt-00000000000000000000000000001003", "rt-00000000000000000000000000001004"]);
	expect(await bytes(root)).toEqual(before);
});

it("I4 a direct successful source-override write returns correspondence without staging a saved read", async () => {
	const { root, session } = await fixture();
	const result = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, {
					lessonPaths: ["a.prax", "b.prax"],
					sources: { "a.prax": inserted },
					identitySession: session,
				}),
			),
		"write",
		false,
	);
	const note = result.identity.sourceMappings.find(
		(m) => m.file === "a.prax" && m.path.join() === "0,0",
	);
	const body = result.identity.sourceMappings.find(
		(m) => m.file === "a.prax" && m.path.join() === "0,0,0",
	);
	if (!note || !body) throw new Error("Missing saved nodes");
	expect(result.correspondence).toEqual([
		{ runtimeId: "rt-00000000000000000000000000001003", durableId: note.id },
		{ runtimeId: "rt-00000000000000000000000000001004", durableId: body.id },
	]);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe(inserted);
});

it("I4 the real author session returns correspondence separately from every preview event and its sequence", async () => {
	const { root } = await fixture(a);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const events: StudioEvent[] = [];
	let admitted!: () => void;
	const outside = new Promise<void>((resolve) => {
		admitted = resolve;
	});
	session.subscribe((event) => {
		events.push(event);
		if (
			event.type === "grammarChanged" &&
			event.filename === "a.prax" &&
			event.grammar === inserted
		)
			admitted();
	});
	expect(await session.readSnapshot()).toHaveProperty("editorSeq", 0);
	await writeFile(join(root, "a.prax"), inserted);
	await outside;
	expect(await session.readSnapshot()).toHaveProperty("editorSeq", 1);
	const request = await edit(root, "a.prax", "New", "Changed\n");
	const dry = (await session.invoke("operationResolve", request)) as Awaited<
		ReturnType<OperationService["resolve"]>
	>;
	if (!dry.ok) throw new Error(dry.code);
	expect(dry.focus.nodeId).toMatch(/^rt-[0-9a-f]{32}$/);
	const result = (await session.invoke("operationApply", request)) as Awaited<
		ReturnType<OperationService["apply"]>
	>;
	if (!result.ok) throw new Error(result.code);
	expect(result.correspondence).toHaveLength(2);
	expect(result.correspondence).toContainEqual({
		runtimeId: dry.focus.nodeId,
		durableId: result.focus.nodeId,
	});
	expect(result.seq).toBe(2);
	expect(await session.readSnapshot()).toHaveProperty("editorSeq", 2);
	expect(events.filter((event) => event.type === "editorChanged")).toEqual([
		{ type: "editorChanged", seq: 1 },
		{ type: "editorChanged", seq: 2 },
	]);
	expect(JSON.stringify(events)).not.toContain("correspondence");
	for (const [path, content] of Object.entries(await bytes(root))) {
		expect(content, path).not.toContain("rt-");
		expect(content, path).not.toContain("correspondence");
	}
});
