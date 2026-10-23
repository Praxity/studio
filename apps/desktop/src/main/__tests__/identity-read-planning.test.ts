import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCourseContext } from "@praxity/export-pipeline";
import * as operations from "@praxity/operations";
import { afterEach, expect, it, vi } from "vitest";
import { editCliOutputSchema } from "../../shared/edit-cli-schema";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { runPraxityCli } from "../cli";
import { CourseIdentitySession, resolveReadOperation } from "../identity-store";
import { resolveLessonSources } from "../lesson-source";
import { readBlockInventory } from "../operations/block-inspection";
import { OperationService } from "../operations/operation-service";
import { withProjectFileFlushes } from "../project-file-transactions";
import { PreviewScheduler } from "../studio/preview-scheduler";

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
const a = "# P\n\n::: note\nOne\n:::\n\n::: note\nTwo\n:::\n";
const b = "# Q\n\nText\n";
const inserted =
	"# P\n\n::: tabs\n:: First\n\nNew first.\n\n:: Second\n\nNew second.\n:::\n\n::: note\nOne\n:::\n\n::: note\nTwo\n:::\n";
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(async () => {
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
async function storedIds(root: string) {
	return new Set(
		Object.entries(await bytes(root))
			.filter(([path]) => path.startsWith(".praxity/identity/"))
			.flatMap(([, text]) => text.match(uuid) ?? []),
	);
}
function unstoredUuids(value: unknown, stored: Set<string>) {
	return [...new Set(JSON.stringify(value).match(uuid) ?? [])].filter((id) => !stored.has(id));
}
async function fixture(persist = true) {
	const root = await mkdtemp(join(tmpdir(), "i4-read-plan-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: C\nlessons: [a.prax, b.prax]\n");
	await writeFile(join(root, "a.prax"), a);
	await writeFile(join(root, "b.prax"), b);
	if (persist) await persistFixtureIdentity(root);
	await writeFile(join(root, "a.prax"), inserted);
	let nextRuntimeId = 0x1003;
	const session = new CourseIdentitySession(root, {
		allocateRuntimeId: () => `rt-${(nextRuntimeId++).toString(16).padStart(32, "0")}`,
	});
	return { root, session, service: new OperationService(root, session) };
}
function edit(
	target: Awaited<ReturnType<typeof readBlockInventory>>["blocks"][number],
	text: string,
) {
	return {
		transactionId: "read-plan",
		operation: "editSource",
		files: [
			{ path: "a.prax", baseRevision: digest(inserted) },
			{ path: "b.prax", baseRevision: digest(b) },
		],
		targets: [target.target],
		args: { text },
	};
}

for (const persist of [true, false]) {
	it(`write refusals join the author view with ${persist ? "stored" : "unstored"} namespaces`, async () => {
		const { root, session, service } = await fixture(persist);
		await resolveLessonSources(root, {}, { identitySession: session });
		const target = (await readBlockInventory(root)).blocks.find((block) =>
			block.source.startsWith("New first."),
		);
		if (!target) throw new Error("Missing first tab body");
		const before = await bytes(root);
		expect(await service.apply(edit(target, "# Escape\n"))).toEqual({
			ok: false,
			transactionId: "read-plan",
			code: "escapes-range",
			file: "a.prax",
			member: persist
				? "rt-00000000000000000000000000001005"
				: "rt-00000000000000000000000000001007",
			message: { key: "op.escapes-range", params: {} },
		});
		expect(await bytes(root)).toEqual(before);
		const request = edit(target, "Changed\n");
		if (request.targets[0].ref.kind !== "node") throw new Error("Missing node target");
		request.targets[0] = {
			...request.targets[0],
			ref: { ...request.targets[0].ref, nodeId: "00000000-0000-4000-8000-000000001999" },
		};
		expect(await service.apply(request)).toEqual({
			ok: false,
			transactionId: "read-plan",
			code: "orphaned",
			file: "a.prax",
			message: { key: "op.orphaned", params: {} },
		});
		expect(await bytes(root)).toEqual(before);
	});
}

for (const persist of [true, false]) {
	it(`operation service dry-run projects the reviewer's ${persist ? 5 : 16} unstored identities`, async () => {
		const { root, session, service } = await fixture(persist);
		const view = await resolveLessonSources(root, {}, { identitySession: session });
		const expectedFocus = persist
			? "rt-00000000000000000000000000001005"
			: "rt-00000000000000000000000000001007";
		expect(
			view.identity.sourceMappings.find((m) => m.file === "a.prax" && m.path.join() === "0,0,0,0")
				?.id,
		).toBe(expectedFocus);
		const target = (await readBlockInventory(root)).blocks.find((block) =>
			block.source.startsWith("New first."),
		);
		if (!target) throw new Error("Missing first tab body");
		const request = edit(target, "New first.\n");
		const before = await bytes(root);
		const stored = await storedIds(root);
		const first = await service.resolve(request);
		expect(first.ok).toBe(true);
		expect(unstoredUuids(first, stored)).toHaveLength(0);
		if (!first.ok) throw new Error("Read plan refused");
		expect(first.focus.nodeId).toBe(expectedFocus);
		const second = await service.resolve(request);
		if (!second.ok) throw new Error("Repeated read plan refused");
		expect(second.mapping).toEqual(first.mapping);
		expect(second.inverse).toEqual(first.inverse);
		expect(await service.resolve(edit(target, "# Escape\n"))).toMatchObject({
			ok: false,
			code: "escapes-range",
			member: expectedFocus,
		});
		expect(await bytes(root)).toEqual(before);
	});

	it(`CLI dry-run JSON projects the reviewer's ${persist ? 5 : 16} unstored identities`, async () => {
		const { root } = await fixture(persist);
		const target = (await readBlockInventory(root)).blocks.find((block) =>
			block.source.startsWith("New first."),
		);
		if (!target) throw new Error("Missing first tab body");
		const before = await bytes(root);
		const stored = await storedIds(root);
		const execution = await runPraxityCli(
			[
				"edit",
				root,
				"editSource",
				"--at",
				target.address,
				"--arg",
				"text=New first.",
				"--dry-run",
				"--json",
			],
			{ appVersion: "test", exportAssetsDir: "unused" },
		);
		expect(execution.exitCode, execution.stderr).toBe(0);
		const result = JSON.parse(execution.stdout);
		expect(unstoredUuids(result, stored)).toHaveLength(0);
		expect(result.focus.nodeId).toMatch(/^rt-[0-9a-f]{32}$/);
		expect(editCliOutputSchema.safeParse(result).success).toBe(true);
		expect(editCliOutputSchema.safeParse({ ...result, dryRun: false }).success).toBe(false);
		expect(await bytes(root)).toEqual(before);
	});
}

it("dry-run uses private display bindings after the caller edits its returned view", async () => {
	const { root, session } = await fixture();
	const view = await resolveLessonSources(root, {}, { identitySession: session });
	const target = (await readBlockInventory(root)).blocks.find((block) =>
		block.source.startsWith("New first."),
	);
	if (target?.target.ref.kind !== "node") throw new Error("Missing first tab body");
	const mapping = view.identity.sourceMappings.find(
		(m) => m.file === "a.prax" && m.path.join() === "0,0,0,0",
	);
	if (!mapping) throw new Error("Missing body display identity");
	mapping.id = "00000000-0000-4000-8000-000000008888";
	view.identity.course.courseId = "00000000-0000-4000-8000-000000009999";
	const before = await bytes(root);
	const result = resolveReadOperation(view, {
		...edit(target, "New first.\n"),
		targets: [
			{
				...target.target,
				ref: { ...target.target.ref, nodeId: "rt-00000000000000000000000000001005" },
			},
		],
	});
	expect(result).toMatchObject({
		ok: true,
		focus: { nodeId: "rt-00000000000000000000000000001005" },
	});
	expect(unstoredUuids(result, await storedIds(root))).toEqual([]);
	expect(await bytes(root)).toEqual(before);
});

it("dry-run omits fabricated orphan member IDs while preserving the refusal", async () => {
	const { root, service } = await fixture();
	const target = (await readBlockInventory(root)).blocks.find((block) =>
		block.source.startsWith("New first."),
	);
	if (!target) throw new Error("Missing first tab body");
	const before = await bytes(root);
	const result = await service.resolve({
		...edit(target, "New first.\n"),
		targets: [
			{
				...target.target,
				ref: { ...target.target.ref, nodeId: "00000000-0000-4000-8000-000000008888" },
			},
		],
	});
	expect(result).toEqual({
		ok: false,
		transactionId: "read-plan",
		code: "orphaned",
		file: "a.prax",
		message: { key: "op.orphaned", params: {} },
	});
	expect(await bytes(root)).toEqual(before);
});

it("dry-run projects a course diagnostic onto the no-store course namespace", async () => {
	const { root, session } = await fixture(false);
	const view = await resolveLessonSources(root, {}, { identitySession: session });
	const target = (await readBlockInventory(root)).blocks.find((block) =>
		block.source.startsWith("New first."),
	);
	if (!target) throw new Error("Missing first tab body");
	const before = await bytes(root);
	const apply = operations.applyOperation;
	// The registry contract permits course diagnostics; current operations emit node refs.
	vi.spyOn(operations, "applyOperation").mockImplementation((...args) => {
		const planned = apply(...args);
		if (planned.ok)
			planned.diagnostics.push({
				file: "a.prax",
				ref: { kind: "course", courseId: args[2].identity.course.courseId },
				severity: "info",
				message: { key: "op.course", params: {} },
			});
		return planned;
	});
	const result = resolveReadOperation(view, edit(target, "New first.\n"));
	expect(result).toMatchObject({
		ok: true,
		diagnostics: [
			{
				file: "a.prax",
				ref: { kind: "course", courseId: "rt-00000000000000000000000000001013" },
				severity: "info",
				message: { key: "op.course", params: {} },
			},
		],
	});
	expect(unstoredUuids(result, await storedIds(root))).toEqual([]);
	expect(await bytes(root)).toEqual(before);
});

it("dry-run projects new, deleted and replacement identities without returning a candidate", async () => {
	const { root, service } = await fixture();
	const target = (await readBlockInventory(root)).blocks.find((block) => block.type === "tabs");
	if (!target) throw new Error("Missing tabs");
	const before = await bytes(root);
	const stored = await storedIds(root);
	for (const [operation, args, fate] of [
		["duplicateBlocks", {}, "copied"],
		["deleteBlocks", {}, "retired"],
		["replaceBlock", { text: "::: note\nReplacement.\n:::\n" }, "new"],
	] as const) {
		const result = await service.resolve({ ...edit(target, ""), operation, args });
		expect(result.ok, operation).toBe(true);
		expect(unstoredUuids(result, stored)).toEqual([]);
		if (!result.ok) throw new Error("Read plan refused");
		expect(result.mapping.some((mapping) => mapping.fate === fate)).toBe(true);
		expect(Object.keys(result).sort()).toEqual([
			"diagnostics",
			"files",
			"focus",
			"intent",
			"inverse",
			"mapping",
			"ok",
			"summary",
			"transactionId",
		]);
	}
	expect(await bytes(root)).toEqual(before);
});

it(
	"inventory translates an unstored container target and its advertised operation writes exact durable bytes",
	withCountingFlushes(async () => {
		const { root, service } = await fixture();
		const before = await bytes(root);
		const inventory = await readBlockInventory(root, true);
		const tabs = inventory.blocks.find((block) => block.type === "tabs");
		if (!tabs) throw new Error("Missing tabs");
		expect(tabs.nodeId).toMatch(/^rt-[0-9a-f]{32}$/);
		expect(tabs.operations).toEqual([
			"editSource",
			"deleteBlocks",
			"duplicateBlocks",
			"moveBlocks",
			"wrapInColumns",
			"wrapIn",
			"replaceBlock",
			"addItem",
			"turnInto",
			"setProperty",
		]);
		expect(tabs.target.ref).toMatchObject({ nodeId: null });
		expect(await bytes(root)).toEqual(before);
		const editable = "::: tabs\n:: First\n\nChanged first.\n\n:: Second\n\nNew second.\n";
		const written = await service.apply(edit(tabs, editable));
		expect(written.ok).toBe(true);
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe(
			inserted.replace("New first.", "Changed first."),
		);
		const stored = await storedIds(root);
		expect(
			unstoredUuids(written, stored).filter(
				(id) => !("historyId" in written && id === written.historyId),
			),
		).toEqual([]);
		const durable = (await readBlockInventory(root)).blocks.find((block) => block.type === "tabs");
		expect(durable?.nodeId).toMatch(/^[0-9a-f-]{36}$/);
		if (written.ok) expect(durable?.nodeId).toBe(written.focus.nodeId);
		expect(
			Object.entries(await bytes(root))
				.filter(([path]) => path.startsWith(".praxity/identity/"))
				.every(([, text]) => !text.includes("rt-")),
		).toBe(true);
	}),
);

it("an unstored container draft projects retained and new children before writing the exact durable result", async () => {
	const { root, session, service } = await fixture();
	const view = await resolveLessonSources(root, {}, { identitySession: session });
	const lesson = view.lessons.get("a.prax");
	const page = lesson?.pages[0];
	const tabs = page?.blocks.find((block) => block.type === "tabs");
	if (!lesson || !page || !tabs) throw new Error("Missing container view");
	const before = await bytes(root);
	const scheduler = new PreviewScheduler(
		await createCourseContext({ id: "c", title: "C", sourceLocale: "en", content: lesson.pages }),
		() => {},
	);
	const editable =
		"::: tabs\n:: First\n\nNew first.\n\n:: Second\n\nNew second.\n\nAdded paragraph.\n\n:: Third\n\nThird tab.\n";
	try {
		const rendered = scheduler.renderDraft(
			{
				seq: 1,
				pageId: page.id,
				nodeId: tabs.id,
				transactionId: "read-draft",
				source: `${editable}:::\n`,
			},
			page,
			{
				admission: view,
				files: [...view.lessons].map(([path, read]) => ({ path, source: read.tree.stream.source })),
			},
		);
		expect(rendered.ok).toBe(true);
		if (!rendered.ok) throw new Error("Container draft refused");
		const html = rendered.render.fragments[0].html;
		const renderedIds = [
			...new Set([...html.matchAll(/data-node-id="([^"]+)"/g)].map((match) => match[1])),
		];
		const retained = [
			"rt-00000000000000000000000000001003",
			"rt-00000000000000000000000000001004",
			"rt-00000000000000000000000000001005",
			"rt-00000000000000000000000000001007",
		];
		for (const id of retained) expect(renderedIds).toContain(id);
		const added = renderedIds.filter((id) => !retained.includes(id));
		expect(added).toHaveLength(4);
		for (const id of renderedIds) expect(id).toMatch(/^rt-[0-9a-f]{32}$/);
		expect(html).toContain("Added paragraph.");
		expect(html).toContain("Third tab.");
		expect(await bytes(root)).toEqual(before);
		const target = (await readBlockInventory(root)).blocks.find((block) => block.type === "tabs");
		if (!target) throw new Error("Missing saved draft target");
		const written = await service.apply(edit(target, editable));
		expect(written.ok).toBe(true);
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe(
			inserted.replace("New second.", "New second.\n\nAdded paragraph.\n\n:: Third\n\nThird tab."),
		);
		const reloaded = await resolveLessonSources(root);
		expect(reloaded.identity.sourceMappings.every((m) => !m.id.startsWith("rt-"))).toBe(true);
		expect(
			Object.entries(await bytes(root))
				.filter(([path]) => path.startsWith(".praxity/identity/"))
				.every(([, text]) => !text.includes("rt-")),
		).toBe(true);
	} finally {
		scheduler.close();
	}
});
