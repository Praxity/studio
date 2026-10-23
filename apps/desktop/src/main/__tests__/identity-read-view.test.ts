import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePage, createCourseContext } from "@praxity/export-pipeline";
import { applyOperation } from "@praxity/operations";
import { afterEach, expect, it, vi } from "vitest";
import { inspectProjectV1 } from "../export/inspect-project-v1";
import {
	assertIdentityExportable,
	CourseIdentitySession,
	persistCourseIdentity,
	resolveCourseIdentity,
} from "../identity-store";
import { resolveLessonSources } from "../lesson-source";
import { readBlockInventory } from "../operations/block-inspection";
import { OperationService } from "../operations/operation-service";
import { withProjectFileFlushes, withProjectFileTransaction } from "../project-file-transactions";

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
const inserted = "# P\n\n::: note\nNew\n:::\n\n::: note\nOne\n:::\n\n::: note\nTwo\n:::\n";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "i4-read-view-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: C\nlessons: [a.prax, b.prax]\n");
	await writeFile(join(root, "a.prax"), a);
	await writeFile(join(root, "b.prax"), b);
	const stored = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["a.prax", "b.prax"] }),
			),
		"write",
		false,
	);
	let runtimeId = 0x1003;
	return {
		root,
		stored,
		identitySession: new CourseIdentitySession(root, {
			allocateRuntimeId: () => `rt-${(runtimeId++).toString(16).padStart(32, "0")}`,
		}),
	};
}
async function bytes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await bytes(root, path));
		else result[path] = (await readFile(join(root, path))).toString("base64");
	}
	return result;
}

it(
	"I4 read views retain New and its body across the literal outside-edit sequence",
	withCountingFlushes(async () => {
		const { root, stored, identitySession } = await fixture();
		await writeFile(join(root, "a.prax"), inserted);
		const before = await bytes(root);
		const first = await resolveLessonSources(root, {}, { identitySession });
		const firstLesson = first.lessons.get("a.prax");
		const note = firstLesson?.blocks.find((block) => block.type === "note");
		if (!note || !firstLesson) throw new Error("Missing New");
		const newIds = [
			note.id,
			...[...firstLesson.nodes]
				.filter(([, record]) => record.node.raw.trim() === "New")
				.map(([id]) => id),
		];
		expect(newIds).toEqual([
			"rt-00000000000000000000000000001003",
			"rt-00000000000000000000000000001004",
		]);
		for (const mapping of stored.identity.sourceMappings)
			expect(first.identity.sourceMappings.some((m) => m.id === mapping.id)).toBe(true);
		const readAndCheck = async () => {
			const read = await resolveLessonSources(root, {}, { identitySession });
			for (const [file, lesson] of read.lessons) {
				const mappingIds = new Set(
					read.identity.sourceMappings.filter((m) => m.file === file).map((m) => m.id),
				);
				expect([...lesson.nodes.keys()].filter((id) => !mappingIds.has(id))).toEqual([]);
				for (const [id, record] of lesson.nodes)
					expect(read.ids.get(file)?.(record.node, record.role)).toBe(id);
			}
			for (const id of newIds)
				expect(read.identity.sourceMappings.some((m) => m.id === id)).toBe(true);
			const lesson = read.lessons.get("a.prax");
			if (!lesson) throw new Error("Missing lesson");
			const context = await createCourseContext({
				id: read.identity.course.courseId,
				title: "C",
				sourceLocale: "en",
				content: lesson.pages,
			});
			const rendered = JSON.stringify(compilePage(context, lesson.pages[0].id));
			for (const id of newIds) expect(rendered).toContain(`data-node-id=\\"${id}\\"`);
			return read;
		};
		await readAndCheck();
		expect(await bytes(root)).toEqual(before);
		await writeFile(join(root, "b.prax"), "# Q\n\nText changed\n");
		await readAndCheck();
		await writeFile(join(root, "a.prax"), inserted.replace("Two", "Two changed"));
		await readAndCheck();
		await writeFile(
			join(root, "a.prax"),
			inserted.replace("Two", "Two changed").replace("# P\n", "# P\n\nUnrelated before.\n"),
		);
		const lastBefore = await bytes(root);
		await readAndCheck();
		expect(await bytes(root)).toEqual(lastBefore);
	}),
);

it("I4 refuses every read view as persistence, publication and an operation base with zero writes", async () => {
	const { root, identitySession } = await fixture();
	for (const source of [a, inserted]) {
		await writeFile(join(root, "a.prax"), source);
		const read = await resolveLessonSources(root, {}, { identitySession });
		const candidate = await resolveCourseIdentity(root, { lessonPaths: ["a.prax", "b.prax"] });
		const node = candidate.identity.sourceMappings.find(
			(m) => m.file === "b.prax" && m.path.join() === "0,0",
		);
		if (!node) throw new Error("Missing Text");
		const planned = applyOperation(
			[...candidate.lessons].map(([path, lesson]) => ({ path, source: lesson.tree.stream.source })),
			{
				transactionId: "read-refusal",
				operation: "editSource",
				files: [
					{ path: "a.prax", baseRevision: digest(source) },
					{ path: "b.prax", baseRevision: digest(b) },
				],
				targets: [
					{
						file: "b.prax",
						ref: { kind: "node", nodeId: node.id, path: node.path, fingerprint: node.fingerprint },
						expectedText: "Text\n",
					},
				],
				args: { text: "Changed" },
			},
			{ identity: candidate.identity, readerRoles: true, allocateId: randomUUID, digest },
		);
		if (!planned.ok) throw new Error("Fixture operation refused");
		const before = await bytes(root);
		await expect(persistCourseIdentity(root, read)).rejects.toThrow(
			"Identity: resolution was changed or was not issued by this store",
		);
		expect(() => assertIdentityExportable(read)).toThrow(
			"Identity: changed or unknown export resolution",
		);
		await expect(
			resolveCourseIdentity(root, {
				lessonPaths: ["a.prax", "b.prax"],
				operationBase: read,
				sources: Object.fromEntries(planned.history.after.map((f) => [f.path, f.source])),
				operations: planned.evidence,
			}),
		).rejects.toThrow("Identity: invalid operation base");
		expect(await bytes(root)).toEqual(before);
	}
});

it(
	"inspect and block inspection expose runtime IDs until an explicit save",
	withCountingFlushes(async () => {
		const { root } = await fixture();
		await writeFile(join(root, "a.prax"), inserted);
		const before = await bytes(root);
		const inspection = await inspectProjectV1(root, "test");
		expect(JSON.stringify(inspection)).toMatch(/rt-[a-f0-9]{32}/);
		const inventory = await readBlockInventory(root);
		const fresh = inventory.blocks.find(
			(block) => block.source.includes("New") && block.type === "note",
		);
		expect(fresh?.nodeId).toMatch(/^rt-[a-f0-9]{32}$/);
		expect(fresh?.target.ref).toMatchObject({ nodeId: null });
		if (!fresh) throw new Error("Missing New");
		expect(
			await new OperationService(root).draftResolve({
				draft: {
					file: "a.prax",
					scope: "node",
					target: fresh.target.ref,
					baseRevision: digest(inserted),
					expectedText: fresh.source,
					editableText: "::: note\nNew\n",
				},
			}),
		).toMatchObject({ kind: "unchanged", seed: { target: { nodeId: null } } });
		expect(await bytes(root)).toEqual(before);
		await withProjectFileTransaction(
			root,
			async () =>
				persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, { lessonPaths: ["a.prax", "b.prax"] }),
				),
			"write",
			false,
		);
		expect(JSON.stringify(await inspectProjectV1(root, "test"))).not.toMatch(/rt-[a-f0-9]{32}/);
	}),
);

it("draft reads and caller mutation cannot contaminate the saved read scope", async () => {
	const { root, identitySession } = await fixture();
	const before = await bytes(root);
	const first = await resolveLessonSources(root, { "a.prax": inserted }, { identitySession });
	const newIds = first.identity.sourceMappings
		.filter((m) => m.id.startsWith("rt-"))
		.map((m) => m.id);
	expect(newIds).toEqual([
		"rt-00000000000000000000000000001003",
		"rt-00000000000000000000000000001004",
	]);
	first.identity.sourceMappings.length = 0;
	first.lessons.get("a.prax")?.nodes.clear();
	const second = await resolveLessonSources(root, { "a.prax": inserted }, { identitySession });
	expect(
		second.identity.sourceMappings.filter((m) => m.id.startsWith("rt-")).map((m) => m.id),
	).toEqual(newIds);
	const saved = await resolveLessonSources(root, {}, { identitySession });
	expect(saved.identity.sourceMappings.some((m) => m.id.startsWith("rt-"))).toBe(false);
	expect(saved.lessons.get("a.prax")?.tree.stream.source).toBe(a);
	const third = await resolveLessonSources(root, { "a.prax": inserted }, { identitySession });
	expect(
		third.identity.sourceMappings.filter((m) => m.id.startsWith("rt-")).map((m) => m.id),
	).toEqual(["rt-00000000000000000000000000001003", "rt-00000000000000000000000000001004"]);
	expect(await bytes(root)).toEqual(before);
});

it("I4 invalidation at the runtime-allocation barrier revokes the in-flight read admission", async () => {
	const { root } = await fixture();
	await writeFile(join(root, "a.prax"), inserted);
	const before = await bytes(root);
	let runtimeId = 0x1003;
	const identitySession = new CourseIdentitySession(root, {
		allocateRuntimeId: () => {
			if (runtimeId === 0x1003) queueMicrotask(() => identitySession.invalidate());
			return `rt-${(runtimeId++).toString(16).padStart(32, "0")}`;
		},
	});
	await expect(resolveLessonSources(root, {}, { identitySession })).rejects.toThrow(
		"Identity: read admission revoked",
	);
	expect(await bytes(root)).toEqual(before);
});

it("an absent identity store gives inspect only runtime course, lesson and node IDs", async () => {
	const root = await mkdtemp(join(tmpdir(), "i4-read-absent-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: C\nlessons: [a.prax]\n");
	await writeFile(join(root, "a.prax"), a);
	const before = await bytes(root);
	const inspection = await inspectProjectV1(root, "test");
	expect(inspection.course.id).toMatch(/^rt-[a-f0-9]{32}$/);
	for (const lesson of inspection.lessons) {
		expect(lesson.entityId).toMatch(/^rt-[a-f0-9]{32}$/);
		for (const page of lesson.pages) {
			expect(page.entityId).toMatch(/^rt-[a-f0-9]{32}$/);
			for (const block of page.blocks) expect(block.entityId).toMatch(/^rt-[a-f0-9]{32}$/);
		}
	}
	expect(await bytes(root)).toEqual(before);
});
