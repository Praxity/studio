import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLesson } from "@praxity/grammar";
import type {
	OperationRequest,
	OperationTarget,
} from "@praxity/grammar/src/operations/contract.ts";
import { applyOperation } from "@praxity/operations";
import { withoutInlineProjectionMetadata } from "@praxity/shared-blocks/inline-markdown";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { loadIdentityStore, persistCourseIdentity, resolveCourseIdentity } from "../identity-store";
import { resolveLessonSources } from "../lesson-source";
import { readNarrationAuthoring, writeNarrationAuthoring } from "../narration-authoring";
import { readBlockInventory } from "../operations/block-inspection";
import { OperationService } from "../operations/operation-service";
import { withProjectFileTransaction } from "../project-file-transactions";
import { createStudioProjectSession } from "../studio/project-session";

const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof createStudioProjectSession>>[] = [];
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const card =
	"::: note Same card {tone=info}\nKeep the exit clear. Leave room for colleagues to reach the emergency door safely.\n:::\n";
const cards =
	"::: cards {style=none}\n:: Same card\nKeep the exit clear.\n::: back\nLeave room for colleagues to reach the emergency door safely.\n:::\n:::\n";
const source = `# Safety\n\n${card}\nA separate paragraph.\n`;
const faults = vi.hoisted(() => ({
	cleanup: false,
	storeReads: 0,
	outside: undefined as
		| { path: string; source: string; phase: "resolution" | "journal"; reads: number }
		| undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	const nativeFs = await import("node:fs");
	return {
		...fs,
		// Keep native filesystem checks and real handles/bytes, without a
		// thread-pool round trip for each small fixture read or journal step.
		realpath: async (...args: Parameters<typeof fs.realpath>) =>
			nativeFs.realpathSync.native(...args),
		lstat: async (...args: Parameters<typeof fs.lstat>) => nativeFs.lstatSync(...args),
		readdir: async (...args: Parameters<typeof fs.readdir>) => nativeFs.readdirSync(...args),
		mkdir: async (...args: Parameters<typeof fs.mkdir>) => nativeFs.mkdirSync(...args),
		unlink: async (...args: Parameters<typeof fs.unlink>) => nativeFs.unlinkSync(...args),
		rmdir: async (...args: Parameters<typeof fs.rmdir>) => nativeFs.rmdirSync(...args),
		open: async (...args: Parameters<typeof fs.open>) => {
			type Handle = Awaited<ReturnType<typeof fs.open>>;
			const fd = nativeFs.openSync(args[0], args[1] ?? "r", args[2]);
			const file = {
				readFile: async (...options: Parameters<Handle["readFile"]>) =>
					nativeFs.readFileSync(fd, ...options),
				writeFile: async (...options: Parameters<Handle["writeFile"]>) =>
					nativeFs.writeFileSync(fd, ...options),
				stat: async (...options: Parameters<Handle["stat"]>) => nativeFs.fstatSync(fd, ...options),
				close: async () => nativeFs.closeSync(fd),
				// These contracts exercise real bytes, admissions, journals and cleanup.
				// The journal suites own flush ordering, failure and crash durability.
				sync: async () => {},
			};
			const courseIdentity = String(args[0])
				.replaceAll("\\", "/")
				.endsWith("/.praxity/identity/course.json");
			if (courseIdentity) faults.storeReads++;
			const outside = faults.outside;
			if (outside?.phase === "resolution" && courseIdentity && ++outside.reads === 2) {
				faults.outside = undefined;
				await fs.writeFile(outside.path, outside.source);
			}
			return file;
		},
		link: async (...args: Parameters<typeof fs.link>) => {
			nativeFs.linkSync(...args);
			const outside = faults.outside;
			if (outside?.phase === "journal" && String(args[1]).endsWith(".praxity-transaction.json")) {
				faults.outside = undefined;
				await fs.writeFile(outside.path, outside.source);
			}
		},
		rename: async (...args: Parameters<typeof fs.rename>) => {
			if (faults.cleanup && String(args[0]).endsWith(".praxity-transaction.json")) {
				faults.cleanup = false;
				throw new Error("Injected journal cleanup failure");
			}
			nativeFs.renameSync(...args);
		},
	};
});

let fixtureRoot: string;
let fixtureBytes: Record<string, string>;
const fixtureTemplates = new Map<string, string>();
beforeAll(async () => {
	fixtureRoot = await mkdtemp(join(tmpdir(), "operation-templates-"));
	const definitions: Record<string, string>[] = [
		{ "lesson.prax": source },
		{ "lesson.prax": moveSource },
		{ "lesson.prax": source, "second.prax": "# Second\n\nExisting content.\n" },
		{ "lesson.prax": `# Safety\n\n${cards}\nA separate paragraph.\n` },
	];
	for (const [index, files] of definitions.entries()) {
		const root = join(fixtureRoot, String(index));
		await mkdir(root);
		await buildFixture(root, files);
		fixtureTemplates.set(JSON.stringify(files), root);
	}
	fixtureBytes = await bytes(fixtureRoot);
});

afterAll(async () => {
	try {
		expect(await bytes(fixtureRoot)).toEqual(fixtureBytes);
	} finally {
		await rm(fixtureRoot, { recursive: true, force: true });
	}
});

afterEach(async () => {
	faults.cleanup = false;
	faults.storeReads = 0;
	faults.outside = undefined;
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(Object.getOwnPropertyNames(Object.prototype))(
	"S1 RPC refuses inherited setting name %s without writes",
	async (name) => {
		const { root } = await fixture();
		const session = await createStudioProjectSession(root, "test");
		sessions.push(session);
		const input = await request(root);
		input.args = { name, value: "warning" };
		const before = await bytes(root);
		for (const method of ["operationResolve", "operationApply"]) {
			expect(await session.invoke(method, JSON.parse(JSON.stringify(input)))).toMatchObject({
				ok: false,
				code: "invalid-args",
			});
			expect(await bytes(root)).toEqual(before);
		}
	},
);

it.each(["apply", "resolve"] as const)(
	"S1 %s refuses prototype argument keys before filesystem admission",
	async (method) => {
		const service = new OperationService(join(tmpdir(), `missing-s1-${randomUUID()}`));
		expect(
			await service[method]({
				transactionId: randomUUID(),
				operation: "setProperty",
				files: [{ path: "lesson.prax", baseRevision: digest("") }],
				targets: [
					{
						file: "lesson.prax",
						ref: { kind: "node", nodeId: randomUUID(), path: [0, 0], fingerprint: digest("") },
						expectedText: "",
					},
				],
				args: JSON.parse('{"name":"tone","value":"warning","__proto__":true}'),
			}),
		).toMatchObject({ ok: false, code: "invalid-args" });
	},
);

it.each(["resolution", "journal"] as const)(
	"T1 an outside write during %s refuses every file with a structured conflict",
	async (phase) => {
		const first = "# First\n\nFirst paragraph.\n";
		const second = "# Second\n\nSecond paragraph.\n";
		const { root, service } = await fixture({ "lesson.prax": first, "second.prax": second });
		const current = await resolveLessonSources(root);
		const firstInput = await request(root, "lesson.prax", [0, 0], current);
		const secondInput = await request(root, "second.prax", [0, 0], current);
		const identityBefore = await bytes(root, ".praxity/identity");
		const outside = second.replace("Second paragraph.", "Outside second paragraph.");
		faults.outside = { path: join(root, "second.prax"), source: outside, phase, reads: 0 };
		expect(
			await service.apply({
				...firstInput,
				operation: "deleteBlocks",
				args: {},
				files: [...firstInput.files, ...secondInput.files],
				targets: [...firstInput.targets, ...secondInput.targets],
			}),
		).toMatchObject({ ok: false, code: "conflict" });
		expect(faults.outside).toBeUndefined();
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(first);
		expect(await readFile(join(root, "second.prax"), "utf8")).toBe(outside);
		expect(await bytes(root, ".praxity/identity")).toEqual(identityBefore);
	},
);

it("T1 acknowledges committed operations when journal cleanup fails", async () => {
	const { root, service } = await fixture();
	const input = await request(root);
	faults.cleanup = true;
	const result = await service.apply(input);
	if (!result.ok) throw new Error(`Operation refused: ${result.code}`);
	expect(result.writeResult.cleanupError).toContain("Injected journal cleanup failure");
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		source.replace("tone=info", "tone=warning"),
	);
	expect(
		(
			await service.historyApply({
				transactionId: randomUUID(),
				historyId: result.historyId,
				direction: "undo",
			})
		).ok,
	).toBe(true);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
});

it("S1 public results cannot mutate the server-owned inverse", async () => {
	const { root, service } = await fixture();
	const result = await service.apply(await request(root));
	if (!result.ok) throw new Error("Operation refused");
	result.inverse.files[0].edits[0].text = "corrupted";
	expect(
		(
			await service.historyApply({
				transactionId: randomUUID(),
				historyId: result.historyId,
				direction: "undo",
			})
		).ok,
	).toBe(true);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
});

it("S1 glossary changes refuse files without client revision bindings", async () => {
	const mention = "# Mention\n\nUse [Safety]{} here.\n";
	const definition = "# Definition\n\n[Safety]{Stay safe.}\n";
	const { root, service } = await fixture({
		"lesson.prax": mention,
		"definition.prax": definition,
	});
	const input = await request(root);
	const token = "[Safety]{}";
	const start = mention.indexOf(token);
	input.operation = "editInline";
	input.args = { definition: "Keep every exit clear." };
	input.targets[0].inline = { start, end: start + token.length, expectedText: token };
	const before = await bytes(root);
	expect(await service.apply(input)).toMatchObject({ ok: false, code: "invalid-args" });
	expect(await bytes(root)).toEqual(before);
});

it("D10 persists an unchanged outside revision alongside the edited lesson", async () => {
	const second = "# Second\n\nA separate paragraph.\n";
	const { root, service } = await fixture({ "lesson.prax": source, "second.prax": second });
	const input = await request(root);
	const outside = `${second}\nA separately added paragraph.\n`;
	await writeFile(join(root, "second.prax"), outside);
	expect((await service.apply(input)).ok).toBe(true);
	expect(await readFile(join(root, "second.prax"), "utf8")).toBe(outside);
	expect((await resolveLessonSources(root, {}, { strict: true })).transientIds).toBe(false);
});

it("D10 all members refuse together when a second owned slice changes", async () => {
	const second = source
		.replace("# Safety", "# Second")
		.replace("Same card", "Second card")
		.replace("Keep the exit clear.", "Keep the corridor clear.");
	const { root, service } = await fixture({ "lesson.prax": source, "second.prax": second });
	const firstInput = await request(root);
	const secondInput = await request(root, "second.prax");
	await writeFile(join(root, "second.prax"), second.replace("tone=info", "tone=success"));
	const before = await bytes(root);
	expect(
		await service.apply({
			...firstInput,
			operation: "deleteBlocks",
			args: {},
			files: [...firstInput.files, ...secondInput.files],
			targets: [...firstInput.targets, ...secondInput.targets],
		}),
	).toMatchObject({ ok: false, code: "conflict", file: "second.prax" });
	expect(await bytes(root)).toEqual(before);
});

it("D14 deleting and undoing a card restores every descendant ID", async () => {
	const { root, service } = await fixture();
	const input = await request(root);
	const original = (await resolveLessonSources(root)).identity.sourceMappings;
	const deleted = await service.apply({ ...input, operation: "deleteBlocks", args: {} });
	if (!deleted.ok) throw new Error(`Deletion refused: ${deleted.code}`);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).not.toContain(card);
	expect(
		(
			await service.historyApply({
				transactionId: randomUUID(),
				historyId: deleted.historyId,
				direction: "undo",
			})
		).ok,
	).toBe(true);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
	expect((await resolveLessonSources(root)).identity.sourceMappings).toEqual(original);
});

it("D14 recorded card deletion retires its descendants without a retirement gate", async () => {
	const { root, service } = await fixture();
	const body = (await resolveLessonSources(root)).identity.sourceMappings.find(
		(node) =>
			source.slice(node.span.start, node.span.end).trim() ===
			"Keep the exit clear. Leave room for colleagues to reach the emergency door safely.",
	);
	if (!body) throw new Error("Fixture lacks the card body");
	expect(
		await service.apply({ ...(await request(root)), operation: "deleteBlocks", args: {} }),
	).toMatchObject({ ok: true });
	const nodes = Object.fromEntries(
		(await loadIdentityStore(root)).snapshots.flatMap((snapshot) => Object.entries(snapshot.nodes)),
	);
	expect(nodes[body.id]?.status).toBe("retired");
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	expect((await session.identityReview()).retirements).toEqual([]);
});

it("S1 rejects forged history, direct inverse payloads and transaction replay", async () => {
	const { root, service } = await fixture();
	const input = await request(root);
	const applied = await service.apply(input);
	if (!applied.ok) throw new Error("Operation refused");
	const before = await bytes(root);
	expect(await service.apply(input)).toMatchObject({ ok: false, code: "not-allowed" });
	expect(
		await service.apply({
			...input,
			transactionId: randomUUID(),
			operation: "applyInverse",
			args: { operation: applied },
		}),
	).toMatchObject({ ok: false, code: "not-allowed" });
	expect(
		await service.historyApply({
			transactionId: randomUUID(),
			historyId: randomUUID(),
			direction: "undo",
		}),
	).toMatchObject({ ok: false, code: "not-allowed" });
	expect(
		await service.historyApply({
			transactionId: randomUUID(),
			historyId: applied.historyId,
			direction: "undo",
			operation: applied,
		}),
	).toMatchObject({ ok: false, code: "invalid-args" });
	expect(await bytes(root)).toEqual(before);
});

it("S1 the first page returns every persisted reader identity", async () => {
	const { root, service } = await fixture({ "lesson.prax": "" });
	const applied = await service.apply({
		transactionId: randomUUID(),
		operation: "insertPage",
		files: [{ path: "lesson.prax", baseRevision: digest("") }],
		targets: [
			{
				file: "lesson.prax",
				ref: { kind: "insertion", parentId: null, after: null, before: null },
			},
		],
		args: { title: "First page" },
	});
	if (!applied.ok) throw new Error(`Insertion refused: ${applied.code}`);
	expect(
		new Set((await resolveLessonSources(root)).identity.sourceMappings.map((node) => node.id)),
	).toEqual(new Set(applied.mapping.flatMap((mapping) => (mapping.newId ? [mapping.newId] : []))));
	expect(
		(
			await service.historyApply({
				transactionId: randomUUID(),
				historyId: applied.historyId,
				direction: "undo",
			})
		).ok,
	).toBe(true);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("");
});

async function fixture(files: Record<string, string> = { "lesson.prax": source }) {
	const root = await mkdtemp(join(tmpdir(), "s1-operation-"));
	roots.push(root);
	const template = fixtureTemplates.get(JSON.stringify(files));
	// Copy persisted identities, never hard-link mutable project files or share a service.
	if (template) await cp(template, root, { recursive: true });
	else await buildFixture(root, files);
	return { root, service: new OperationService(root) };
}

async function buildFixture(root: string, files: Record<string, string>) {
	for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
	await writeFile(
		join(root, "course.yaml"),
		`title: Test\nlessons: ${JSON.stringify(Object.keys(files))}\n`,
	);
	await persistFixtureIdentity(root);
}

async function request(
	root: string,
	file = "lesson.prax",
	path = [0, 0],
	current?: Awaited<ReturnType<typeof resolveLessonSources>>,
): Promise<OperationRequest> {
	const resolved = current ?? (await resolveLessonSources(root));
	const lesson = resolved.lessons.get(file);
	const mapping = resolved.identity.sourceMappings.find(
		(node) => node.file === file && node.path.join() === path.join(),
	);
	if (!lesson || !mapping) throw new Error("Missing test target");
	return {
		transactionId: randomUUID(),
		operation: "setProperty",
		files: [{ path: file, baseRevision: digest(lesson.tree.stream.source) }],
		targets: [
			{
				file,
				ref: {
					kind: "node",
					nodeId: mapping.id,
					path: mapping.path,
					fingerprint: mapping.fingerprint,
				},
				expectedText: lesson.tree.stream.source.slice(mapping.span.start, mapping.span.end),
			},
		],
		args: { name: "tone", value: "warning" },
	};
}

async function bytes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const file = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await bytes(root, file));
		else result[file] = (await readFile(join(root, file))).toString("base64");
	}
	return result;
}

it("D10 finding 9 rebases the original ID when an identical card takes its path", async () => {
	const { root, service } = await fixture({
		"lesson.prax": `# Safety\n\n${cards}\nA separate paragraph.\n`,
	});
	const input = await request(root);
	input.args = { name: "style", value: "outline" };
	// An outside writer records its copy and move while the first request stays open.
	const outsideWriter = new OperationService(root);
	const duplicate = await outsideWriter.apply({
		...input,
		transactionId: randomUUID(),
		operation: "duplicateBlocks",
		args: {},
	});
	expect(duplicate.ok).toBe(true);
	const moved = await request(root, "lesson.prax", [0, 0]);
	expect(
		(await outsideWriter.apply({ ...moved, operation: "moveBlocks", args: { direction: "down" } }))
			.ok,
	).toBe(true);
	const before = await readFile(join(root, "lesson.prax"), "utf8");
	expect(before.match(/style=none/gu)).toHaveLength(2);
	const result = await service.apply(input);
	expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
	const after = await readFile(join(root, "lesson.prax"), "utf8");
	expect(after).toBe(
		before.replace(
			`${cards}\n${cards}`,
			`${cards}\n${cards.replace("style=none", "style=outline")}`,
		),
	);
	const resolved = await resolveLessonSources(root);
	const ref = input.targets[0].ref;
	if (ref.kind !== "node") throw new Error("Missing node ref");
	expect(resolved.identity.sourceMappings.find((node) => node.id === ref.nodeId)?.path).toEqual([
		0, 1,
	]);
});

it("D10 finding 9 refuses ambiguous transient cards, preserving every byte", async () => {
	const { root, service } = await fixture({ "lesson.prax": `# Safety\n\n${cards}\n${cards}` });
	const input = await request(root);
	input.args = { name: "style", value: "outline" };
	const ref = input.targets[0].ref;
	if (ref.kind !== "node") throw new Error("Missing node ref");
	ref.nodeId = null;
	await writeFile(
		join(root, "lesson.prax"),
		`# Safety\n\nAn outside insertion.\n\n${cards}\n${cards}`,
	);
	const before = await bytes(root);
	expect(await service.apply(input)).toMatchObject({ ok: false, code: "ambiguous" });
	expect(await bytes(root)).toEqual(before);
});

it("D10 rebases an unrelated outside edit and resolves without writes", async () => {
	const { root, service } = await fixture();
	const input = await request(root);
	const outside = `${source}\nAn independently added paragraph.\n`;
	await writeFile(join(root, "lesson.prax"), outside);
	const before = await bytes(root);
	faults.storeReads = 0;
	const planned = await service.resolve(input);
	expect(faults.storeReads).toBe(1);
	expect(planned.ok).toBe(true);
	expect(await bytes(root)).toEqual(before);
	const applied = await service.apply(input);
	expect(applied).toMatchObject({ ok: true, files: [{ fromRevision: digest(outside) }] });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		outside.replace("tone=info", "tone=warning"),
	);
});

it.each(["apply", "resolve"] as const)("D10 %s refuses a changed owned slice", async (method) => {
	const { root, service } = await fixture();
	const input = await request(root);
	await writeFile(
		join(root, "lesson.prax"),
		source.replace("Keep the exit clear.", "Keep every exit clear."),
	);
	const before = await bytes(root);
	expect(await service[method](input)).toMatchObject({ ok: false, code: "conflict" });
	expect(await bytes(root)).toEqual(before);
});

it("D10 refuses an orphaned ID rather than adopting the node at its path", async () => {
	const { root, service } = await fixture();
	const input = await request(root);
	const ref = input.targets[0].ref;
	if (ref.kind !== "node") throw new Error("Missing node ref");
	ref.nodeId = randomUUID();
	expect(await service.apply(input)).toMatchObject({ ok: false, code: "orphaned" });
});

it("D14 undo and redo preserve IDs and unrelated outside bytes", async () => {
	const { root, service } = await fixture();
	const input = await request(root);
	const applied = await service.apply(input);
	if (!applied.ok) throw new Error("Operation refused");
	const outside = `${source}\nAn independently added paragraph.\n`;
	await writeFile(join(root, "lesson.prax"), outside.replace("tone=info", "tone=warning"));
	const undone = await service.historyApply({
		transactionId: randomUUID(),
		historyId: applied.historyId,
		direction: "undo",
	});
	expect(undone, JSON.stringify(undone)).toMatchObject({ ok: true });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(outside);
	expect((await request(root)).targets[0].ref).toMatchObject({
		nodeId: input.targets[0].ref.kind === "node" ? input.targets[0].ref.nodeId : null,
	});
	const redone = await service.historyApply({
		transactionId: randomUUID(),
		historyId: applied.historyId,
		direction: "redo",
	});
	expect(redone.ok).toBe(true);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		outside.replace("tone=info", "tone=warning"),
	);
});

it("D14 refuses undo after an unrecorded outside paragraph retirement without changing any bytes", async () => {
	const { root, service } = await fixture();
	const applied = await service.apply(await request(root));
	if (!applied.ok) throw new Error("Operation refused");
	await writeFile(
		join(root, "lesson.prax"),
		source
			.replace("tone=info", "tone=warning")
			.replace("A separate paragraph.", "An independently edited paragraph."),
	);
	const before = await bytes(root);
	await expect(
		service.historyApply({
			transactionId: randomUUID(),
			historyId: applied.historyId,
			direction: "undo",
		}),
	).resolves.toMatchObject({
		ok: false,
		code: "identity-retirement-pending",
		retirements: [
			{
				file: "lesson.prax",
				page: "Safety",
				label: "A separate paragraph.",
				line: null,
			},
		],
	});
	expect(await bytes(root)).toEqual(before);
});

it.each(["title aliases", "slug rename"])(
	"D14 undo and redo preserve unrelated page metadata after %s",
	async (change) => {
		const { root, service } = await fixture();
		const applied = await service.apply(await request(root));
		if (!applied.ok) throw new Error(`Operation refused: ${applied.code}`);
		const page = (await request(root, "lesson.prax", [0])).targets[0].ref;
		if (page.kind !== "node" || !page.nodeId) throw new Error("Missing page ID");
		const pageId = page.nodeId;
		if (change === "title aliases") {
			const outside = new OperationService(root);
			for (const title of ["Updated safety", "Safety"]) {
				const rename = await request(root, "lesson.prax", [0]);
				expect(
					await outside.apply({ ...rename, operation: "setPageTitle", args: { title } }),
				).toMatchObject({ ok: true });
			}
		} else {
			await withProjectFileTransaction(
				root,
				async () =>
					persistCourseIdentity(
						root,
						await resolveCourseIdentity(root, {
							lessonPaths: ["lesson.prax"],
							slugRenames: { [pageId]: "outside-slug" },
						}),
					),
				"write",
				false,
			);
		}
		const expected =
			change === "title aliases"
				? { slug: "safety", aliases: ["updated-safety"] }
				: { slug: "outside-slug", aliases: ["safety"] };
		for (const direction of ["undo", "redo"] as const) {
			expect(
				await service.historyApply({
					transactionId: randomUUID(),
					historyId: applied.historyId,
					direction,
				}),
			).toMatchObject({ ok: true });
			const current = await resolveLessonSources(root);
			const node = current.identity.snapshots
				.flatMap((snapshot) => Object.entries(snapshot.nodes))
				.find(([id]) => id === page.nodeId)?.[1];
			expect(node).toMatchObject(expected);
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
				direction === "undo" ? source : source.replace("tone=info", "tone=warning"),
			);
		}
	},
	10_000,
);

it("D14 refuses undo when written aliases changed despite unchanged written source", async () => {
	const { root, service } = await fixture();
	const rename = await request(root, "lesson.prax", [0]);
	const applied = await service.apply({
		...rename,
		operation: "setPageTitle",
		args: { title: "Updated safety" },
	});
	if (!applied.ok) throw new Error(`Operation refused: ${applied.code}`);
	const outside = new OperationService(root);
	for (const title of ["Outside safety", "Updated safety"]) {
		const input = await request(root, "lesson.prax", [0]);
		expect(
			await outside.apply({ ...input, operation: "setPageTitle", args: { title } }),
		).toMatchObject({ ok: true });
	}
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		source.replace("# Safety", "# Updated safety"),
	);
	const before = await bytes(root);
	expect(
		await service.historyApply({
			transactionId: randomUUID(),
			historyId: applied.historyId,
			direction: "undo",
		}),
	).toMatchObject({ ok: false, code: "conflict" });
	expect(await bytes(root)).toEqual(before);
});

it("D14 undo and redo preserve an unrelated cross-file move and its IDs", async () => {
	const second = "# Second\n\nExisting content.\n";
	const { root, service } = await fixture({ "lesson.prax": source, "second.prax": second });
	const applied = await service.apply(await request(root));
	if (!applied.ok) throw new Error(`Operation refused: ${applied.code}`);
	const current = await resolveLessonSources(root);
	const move = await request(root, "lesson.prax", [0, 1], current);
	const ref = move.targets[0].ref;
	if (ref.kind !== "node") throw new Error("Missing moved node ref");
	const movedIds = current.identity.sourceMappings
		.filter((node) => node.file === "lesson.prax" && ref.path.every((v, i) => node.path[i] === v))
		.map((node) => node.id);
	const page = current.identity.sourceMappings.find(
		(node) => node.file === "second.prax" && node.path.join() === "0",
	);
	const last = current.identity.sourceMappings.find(
		(node) => node.file === "second.prax" && node.path.join() === "0,0",
	);
	if (!page || !last) throw new Error("Missing insertion boundary");
	move.operation = "moveBlocks";
	move.args = {};
	move.files.push({ path: "second.prax", baseRevision: digest(second) });
	move.targets.push({
		file: "second.prax",
		ref: { kind: "insertion", parentId: page.id, after: last.id, before: null },
	});
	expect(await new OperationService(root).apply(move)).toMatchObject({ ok: true });
	const movedSource = await readFile(join(root, "second.prax"), "utf8");
	for (const direction of ["undo", "redo"] as const) {
		expect(
			await service.historyApply({
				transactionId: randomUUID(),
				historyId: applied.historyId,
				direction,
			}),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "second.prax"), "utf8")).toBe(movedSource);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			direction === "undo"
				? `# Safety\n\n${card}\n`
				: `# Safety\n\n${card.replace("tone=info", "tone=warning")}\n`,
		);
		const resolved = await resolveLessonSources(root);
		for (const id of movedIds)
			expect(resolved.identity.sourceMappings.find((node) => node.id === id)?.file).toBe(
				"second.prax",
			);
	}
});

it("D14 refuses undo when the written slice changed", async () => {
	const { root, service } = await fixture();
	const applied = await service.apply(await request(root));
	if (!applied.ok) throw new Error("Operation refused");
	await writeFile(
		join(root, "lesson.prax"),
		source
			.replace("tone=info", "tone=warning")
			.replace("Keep the exit clear.", "Keep every exit clear."),
	);
	const before = await bytes(root);
	expect(
		await service.historyApply({
			transactionId: randomUUID(),
			historyId: applied.historyId,
			direction: "undo",
		}),
	).toMatchObject({ ok: false, code: "conflict" });
	expect(await bytes(root)).toEqual(before);
});

const moveCases = ["block within page", "block across pages", "page within lesson"] as const;
type MoveCase = (typeof moveCases)[number];
const moveSource = `# Safety\n\n${card}\nA separate paragraph.\n\nA third paragraph.\n\n# Second\n\nDestination paragraph.\n\nDestination tail.\n\n# Third\n\nUnrelated paragraph.\n`;

async function moveFixture(kind: MoveCase, direction: "up" | "down" = "down") {
	const { root, service } = await fixture({ "lesson.prax": moveSource });
	const current = await resolveLessonSources(root);
	const pageMove = kind === "page within lesson";
	const path = pageMove
		? direction === "down"
			? [0]
			: [1]
		: kind === "block across pages" && direction === "up"
			? [1, 0]
			: direction === "down"
				? [0, 0]
				: [0, 1];
	const input = await request(root, "lesson.prax", path, current);
	input.operation = pageMove ? "movePage" : "moveBlocks";
	input.args = { direction };
	if (kind === "block across pages") {
		const pagePath = direction === "down" ? "1" : "0";
		const page = current.identity.sourceMappings.find((node) => node.path.join() === pagePath);
		const last = current.identity.sourceMappings.find(
			(node) => node.path.join() === `${pagePath},${direction === "down" ? 0 : 1}`,
		);
		const next = current.identity.sourceMappings.find(
			(node) => node.path.join() === `${pagePath},${direction === "down" ? 1 : 2}`,
		);
		if (!page || !last || !next) throw new Error("Missing move destination");
		input.args = {};
		input.targets.push({
			file: "lesson.prax",
			ref: { kind: "insertion", parentId: page.id, after: last.id, before: next.id },
		});
	}
	const ref = input.targets[0].ref;
	if (ref.kind !== "node" || !ref.nodeId) throw new Error("Missing moved ID");
	const movedIds = current.identity.sourceMappings
		.filter((node) => ref.path.every((index, i) => node.path[i] === index))
		.map((node) => node.id);
	const applied = await service.apply(input);
	if (!applied.ok) throw new Error(`Move refused: ${applied.code}`);
	return { root, service, applied, movedIds, movedId: ref.nodeId };
}

it.each(
	moveCases.flatMap((kind) => (["up", "down"] as const).map((direction) => ({ kind, direction }))),
)(
	"D14 move undo and redo restore $kind moving $direction with the same IDs",
	async ({ kind, direction }) => {
		const { root, service, applied, movedIds, movedId } = await moveFixture(kind, direction);
		const movedSource = await readFile(join(root, "lesson.prax"), "utf8");
		const movedPath =
			kind === "page within lesson"
				? direction === "down"
					? [1]
					: [0]
				: kind === "block across pages"
					? direction === "down"
						? [1, 1]
						: [0, 2]
					: direction === "down"
						? [0, 1]
						: [0, 0];
		expect(
			(await resolveLessonSources(root)).identity.sourceMappings.find((node) => node.id === movedId)
				?.path,
		).toEqual(movedPath);
		expect(movedSource).not.toBe(moveSource);
		for (const historyDirection of ["undo", "redo"] as const) {
			const result = await service.historyApply({
				transactionId: randomUUID(),
				historyId: applied.historyId,
				direction: historyDirection,
			});
			expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
				historyDirection === "undo" ? moveSource : movedSource,
			);
			const current = await resolveLessonSources(root);
			for (const id of movedIds)
				expect(current.identity.sourceMappings.some((node) => node.id === id)).toBe(true);
			expect(current.identity.sourceMappings.find((node) => node.id === movedId)?.path).toEqual(
				historyDirection === "redo"
					? movedPath
					: kind === "page within lesson"
						? direction === "down"
							? [0]
							: [1]
						: kind === "block across pages" && direction === "up"
							? [1, 0]
							: direction === "down"
								? [0, 0]
								: [0, 1],
			);
		}
	},
);

it.each(
	moveCases.flatMap((kind) =>
		(["undo", "redo"] as const).flatMap((direction) =>
			(["moved node", "neighbour text", "next neighbour text", "neighbour order"] as const).map(
				(change) => ({
					kind,
					direction,
					change,
				}),
			),
		),
	),
)(
	"D14 move $direction refuses $kind after outside $change changes",
	async ({ kind, direction, change }) => {
		const { root, service, applied, movedId } = await moveFixture(kind);
		if (direction === "redo") {
			expect(
				await service.historyApply({
					transactionId: randomUUID(),
					historyId: applied.historyId,
					direction: "undo",
				}),
			).toMatchObject({ ok: true });
		}
		const current = await resolveLessonSources(root);
		const moved = current.identity.sourceMappings.find((node) => node.id === movedId);
		if (!moved) throw new Error("Missing moved node");
		const neighbourPath =
			kind === "page within lesson"
				? [direction === "undo" ? 0 : 1]
				: kind === "block across pages"
					? [1, 0]
					: [0, direction === "undo" ? 0 : 1];
		const nextNeighbourPath =
			kind === "page within lesson"
				? [2]
				: kind === "block across pages"
					? [1, direction === "undo" ? 2 : 1]
					: [0, 2];
		const targetPath =
			change === "moved node"
				? moved.path
				: change === "next neighbour text"
					? nextNeighbourPath
					: neighbourPath;
		const outsideInput = await request(root, "lesson.prax", targetPath, current);
		if (change === "neighbour order") {
			outsideInput.operation = kind === "page within lesson" ? "movePage" : "moveBlocks";
			outsideInput.args = { direction: "down" };
			if (kind === "block across pages" && direction === "redo") {
				const page = current.identity.sourceMappings.find((node) => node.path.join() === "2");
				const last = current.identity.sourceMappings.find((node) => node.path.join() === "2,0");
				if (!page || !last) throw new Error("Missing outside destination");
				outsideInput.args = {};
				outsideInput.targets.push({
					file: "lesson.prax",
					ref: { kind: "insertion", parentId: page.id, after: last.id, before: null },
				});
			}
		} else {
			outsideInput.operation = kind === "page within lesson" ? "setPageTitle" : "setText";
			outsideInput.args =
				kind === "page within lesson"
					? { title: "Outside title" }
					: {
							field: outsideInput.targets[0].expectedText?.startsWith(":::") ? "subject" : "text",
							text: "An outside edit.",
						};
		}
		const outside = await new OperationService(root).apply(outsideInput);
		expect(outside, JSON.stringify(outside)).toMatchObject({ ok: true });
		const before = await bytes(root);
		expect(
			await service.historyApply({
				transactionId: randomUUID(),
				historyId: applied.historyId,
				direction,
			}),
		).toMatchObject({ ok: false, code: "conflict" });
		expect(await bytes(root)).toEqual(before);
	},
);

it("T1 moves between lessons and restores both files in one history entry", async () => {
	const second = "# Second\n\nExisting content.\n";
	const { root, service } = await fixture({ "lesson.prax": source, "second.prax": second });
	const input = await request(root);
	const destination = await resolveLessonSources(root);
	const page = destination.identity.sourceMappings.find(
		(node) => node.file === "second.prax" && node.path.join() === "0",
	);
	const last = destination.identity.sourceMappings.find(
		(node) => node.file === "second.prax" && node.path.join() === "0,0",
	);
	if (!page || !last) throw new Error("Missing insertion boundary");
	const insertion: OperationTarget = {
		file: "second.prax",
		ref: { kind: "insertion", parentId: page.id, after: last.id, before: null },
	};
	const moved = await service.apply({
		...input,
		operation: "moveBlocks",
		args: {},
		files: [...input.files, { path: "second.prax", baseRevision: digest(second) }],
		targets: [...input.targets, insertion],
	});
	if (!moved.ok) throw new Error(`Move refused: ${moved.code}`);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).not.toContain(card);
	expect(await readFile(join(root, "second.prax"), "utf8")).toContain(card);
	const ref = input.targets[0].ref;
	if (ref.kind !== "node") throw new Error("Missing node ref");
	expect(
		(await resolveLessonSources(root)).identity.sourceMappings.find(
			(node) => node.id === ref.nodeId,
		)?.file,
	).toBe("second.prax");
	expect(
		(
			await service.historyApply({
				transactionId: randomUUID(),
				historyId: moved.historyId,
				direction: "undo",
			})
		).ok,
	).toBe(true);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
	expect(await readFile(join(root, "second.prax"), "utf8")).toBe(second);
});

it.each(["top", "file", "target", "ref", "args"])(
	"S1 refuses extra properties in %s",
	async (level) => {
		const { root, service } = await fixture();
		const input = await request(root);
		const owner =
			level === "top"
				? input
				: level === "file"
					? input.files[0]
					: level === "target"
						? input.targets[0]
						: level === "ref"
							? input.targets[0].ref
							: input.args;
		Object.assign(owner, { unexpected: true });
		const before = await bytes(root);
		expect(await service.apply(input)).toMatchObject({ ok: false, code: "invalid-args" });
		expect(await bytes(root)).toEqual(before);
	},
);

it.each([
	"../outside.prax",
	"sub/../../outside.prax",
	"sub\\outside.prax",
	"/outside.prax",
	".praxity/identity/course.json",
	"file:stream.prax",
])("S1 refuses unauthorized path %s", async (file) => {
	const { root, service } = await fixture();
	const input = await request(root);
	input.files[0].path = file;
	input.targets[0].file = file;
	const before = await bytes(root);
	expect(await service.apply(input)).toMatchObject({ ok: false, code: "invalid-args" });
	expect(await bytes(root)).toEqual(before);
});

it("S1 admits operationApply, operationResolve and historyApply through session RPC", async () => {
	const { root } = await fixture();
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const input = await request(root);
	const before = await bytes(root);
	expect(await session.invoke("operationResolve", input)).toMatchObject({ ok: true });
	expect(await bytes(root)).toEqual(before);
	const result = (await session.invoke("operationApply", input)) as {
		ok: boolean;
		historyId: string;
	};
	expect(result.ok).toBe(true);
	expect(
		await session.invoke("historyApply", {
			transactionId: randomUUID(),
			historyId: result.historyId,
			direction: "undo",
		}),
	).toMatchObject({ ok: true });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
});

const canvasSource =
	"\uFEFF# Safety {style=none}\r\n\r\n## Keep *clear* {level=3}\r\n\r\nA separate paragraph.\r\n";

const captionStarts = [
	"figure",
	"two runs",
	"video",
	"audio",
	"missing",
	"blank",
	"duplicate",
	"empty",
];
it.each(captionStarts.flatMap((start) => [17, 29].map((seed) => ({ start, seed }))))(
	"C08a caption byte model from $start seed $seed",
	async ({ start, seed }) => {
		const captions = ["Same *caption*.", "Same *caption*."];
		const figure = start === "figure" || start === "two runs";
		const prefix =
			start === "empty"
				? ""
				: figure
					? "# Page\n\n::: figure {width=wide}\n![Exact alt](https://example.com/image.png) {size=medium}\n"
					: `# Page\n\n::: ${start === "audio" ? "audio" : "video"} https://example.com/clip.${start === "audio" ? "mp3" : "mp4"} {start=2 end=9}\ntitle: Keep title\n`;
		const render = () =>
			(seed === 29 ? "\uFEFF" : "") +
			(start === "empty"
				? ""
				: prefix +
					(start === "missing"
						? ""
						: start === "blank"
							? "caption:\n"
							: `${figure ? "" : "caption: "}${captions[0]}\n`) +
					(start === "two runs"
						? `\n${captions[1]}\n`
						: start === "duplicate"
							? "caption: Other caption.\n"
							: "") +
					(figure ? "" : "transcript: Keep transcript\n") +
					":::\n\nNeighbour stays."
			).replaceAll("\n", seed === 29 ? "\r\n" : "\n");
		let model = render();
		const { root, service } = await fixture({ "lesson.prax": model });
		const original = await resolveLessonSources(root);
		const ids = [...original.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()]);
		let random = seed;
		for (let step = 0; step < 2; step++) {
			const fields = (await service.canvasTextSnapshot()).fields;
			const expected = ["missing", "blank", "duplicate", "empty"].includes(start)
				? []
				: start === "two runs"
					? captions
					: [captions[0]];
			expect(fields.map((field) => field.text)).toEqual(
				start === "empty" ? [] : ["Page", ...expected, "Neighbour stays."],
			);
			const before = await bytes(root);
			if (!expected.length) {
				const owner = [...original.lessons.values()]
					.flatMap((lesson) => [...lesson.nodes.values()])
					.find((record) => record.node.type === "video");
				expect(
					await service.canvasTextApply({
						transactionId: randomUUID(),
						operation: "setText",
						file: "lesson.prax",
						nodeId: owner?.id ?? "missing",
						baseRevision: digest(model),
						expectedText: captions[0],
						field: "value",
						text: "Forged",
					}),
				).toMatchObject({ ok: false, code: "orphaned" });
				expect(await bytes(root)).toEqual(before);
				continue;
			}
			// Edit the second equal run first, then the first run at its literal position.
			const index = start === "two runs" ? 1 - step : 0;
			const target = fields[1 + index];
			if (!target) throw new Error("Missing caption binding");
			const caption = captions[index];
			const offset = index === 1 ? model.lastIndexOf(caption) : model.indexOf(caption);
			expect(target.range).toEqual({ start: offset, end: offset + caption.length });
			expect(
				await service.canvasTextApply({
					...canvasInput(target, "\n::: note Injected\n"),
					field: target.field,
				}),
			).toMatchObject({ ok: false, code: "unsupported-syntax" });
			expect(await bytes(root)).toEqual(before);
			random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
			captions[index] = `Revised *caption* ${random}.`;
			expect(
				await service.canvasTextApply({
					...canvasInput(target, captions[index]),
					field: target.field,
				}),
			).toMatchObject({ ok: true });
			model = render();
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(model);
			const after = await resolveLessonSources(root, {}, { strict: true });
			expect([...after.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()])).toEqual(
				ids,
			);
		}
	},
);

it.each([
	{ forged: { field: "subject" }, code: "not-allowed" },
	{ forged: { expectedText: "Forged baseline" }, code: "stale" },
	{ forged: { operation: "replaceBlock" }, code: "invalid-args" },
	{ forged: { text: "" }, code: "empty-text" },
])("C08a caption request refuses $code without writes", async ({ forged, code }) => {
	const initial = "# Page\n\n::: video https://example.com/clip.mp4\ncaption: Caption.\n:::\n";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const field = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.text === "Caption.",
	);
	if (!field) throw new Error("Missing caption");
	const before = await bytes(root);
	expect(
		await service.canvasTextApply({
			...canvasInput(field, "Changed"),
			field: field.field,
			...forged,
		}),
	).toMatchObject({ ok: false, code });
	expect(await bytes(root)).toEqual(before);
});

it("C08a refuses a combined figure edit and a changed-file caption with zero writes", async () => {
	const initial =
		"# Page\n\n::: figure\n![Alt](https://example.com/image.png)\nFirst caption.\n\nSecond caption.\n:::\n";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const field = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.text === "First caption.",
	);
	const resolved = await resolveLessonSources(root);
	const figure = [...resolved.lessons.values()]
		.flatMap((lesson) => [...lesson.nodes.values()])
		.find((record) => record.node.type === "figure");
	if (!field || !figure) throw new Error("Missing figure caption");
	const before = await bytes(root);
	expect(
		await service.canvasTextApply({
			...canvasInput(field),
			nodeId: figure.id,
			expectedText: "First caption.\n\nSecond caption.",
			field: "text",
		}),
	).toMatchObject({ ok: false, code: "orphaned" });
	expect(await bytes(root)).toEqual(before);
	await writeFile(join(root, "lesson.prax"), initial + "\nOutside paragraph.\n");
	const changed = await bytes(root);
	expect(
		await service.canvasTextApply({
			...canvasInput(field, "Changed caption."),
			field: field.field,
		}),
	).toMatchObject({ ok: false, code: "stale" });
	expect(await bytes(root)).toEqual(changed);
});

it("C08a unstored ambiguous captions refuse with zero writes", async () => {
	const initial =
		"# Page\n\n::: figure\n![Alt](https://example.com/image.png)\nSame caption.\n:::\n\n::: figure\n![Alt](https://example.com/image.png)\nSame caption.\n:::\n";
	const { root } = await fixture({ "lesson.prax": initial });
	await rm(join(root, ".praxity"), { recursive: true });
	const service = new OperationService(root);
	const field = (await service.canvasTextSnapshot()).fields.filter(
		(field) => field.text === "Same caption.",
	)[1];
	if (!field) throw new Error("Missing caption binding");
	const before = await bytes(root);
	expect(
		await service.canvasTextApply({
			...canvasInput(field, "Changed caption."),
			field: field.field,
		}),
	).toMatchObject({ ok: false, code: "ambiguous" });
	expect(await bytes(root)).toEqual(before);
});

const choiceSource =
	"# Page\n\n::: choice Pick {shuffle}\nfeedback: Shared *advice*.\n(x) Same label\nfeedback: First option bytes.\n( ) Same label\nfeedback: Second option bytes.\n:::\n\nTail.";

it.each(["\n", "\r\n", "\r", "mixed"])(
	"C07a choice labels preserve markers, feedback, siblings and all IDs with %j endings",
	async (ending) => {
		const initial =
			"\uFEFF" +
			choiceSource.replace(/\n/g, (_, offset: number) =>
				ending === "mixed" ? (offset % 2 ? "\r\n" : "\n") : ending,
			);
		const { root, service } = await fixture({ "lesson.prax": initial });
		const before = await resolveLessonSources(root);
		const ids = [...before.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()]);
		const mappings = before.identity.sourceMappings.map(({ id, path }) => ({ id, path }));
		const options = (await service.canvasTextSnapshot()).fields.filter(
			(field) => field.kind === "option",
		);
		expect(options.map(({ field, text }) => ({ field, text }))).toEqual([
			{ field: "text", text: "Same label" },
			{ field: "text", text: "Same label" },
		]);
		const target = options[1];
		if (!target) throw new Error("Missing second option");
		const start = initial.lastIndexOf("Same label");
		expect(target.range).toEqual({ start, end: start + "Same label".length });
		const result = await service.canvasTextApply({
			...canvasInput(target, "Changed **label** 🦊"),
			field: "text",
		});
		expect(result).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			initial.slice(0, start) + "Changed **label** 🦊" + initial.slice(start + "Same label".length),
		);
		const after = await resolveLessonSources(root, {}, { strict: true });
		expect([...after.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()])).toEqual(ids);
		expect(after.identity.sourceMappings.map(({ id, path }) => ({ id, path }))).toEqual(mappings);
		if (!result.ok) throw new Error("Expected committed label");
		expect(
			await service.historyApply({
				transactionId: randomUUID(),
				historyId: result.historyId,
				direction: "undo",
			}),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(initial);
	},
);

const allOptionFeedback =
	"# Page\n\n::: choice Q\n(x) A\nfeedback: First.\n( ) B\nfeedback: Second.\n( ) C\nfeedback: Third *advice*.\n( ) D\nfeedback: Fourth.\n:::\n\nTail.\n";

it("C06c1 adds option records without changing existing reader IDs or learner data", () => {
	let next = 0;
	const lesson = readLesson(allOptionFeedback, { ids: () => `id-${next++}` });
	// The compiler-node binding amendment keeps projection metadata compile-only.
	// Keep the original learner-data digest and reader-ID expectations.
	expect(
		digest(JSON.stringify(withoutInlineProjectionMetadata(lesson.pages, { keepDisplay: true }))),
	).toBe("67f46fbd27c19a3fc2880b7a12256e0f53711c13d0216c5b9d7f8dfe00dc1cea");
	expect(
		[...lesson.nodes.values()]
			.filter((record) => record.role !== "option-feedback")
			.map(({ id, node, role }) => [id, node.kind, role ?? null, node.span.start]),
	).toEqual([
		["id-0", "page", null, 0],
		["id-1", "page", "title", 0],
		["id-2", "block", "stem", 8],
		["id-3", "part", "correct", 27],
		["id-4", "part", "incorrect", 50],
		["id-5", "option", null, 21],
		["id-6", "option", null, 44],
		["id-7", "option", null, 68],
		["id-8", "option", null, 100],
		["id-9", "block", null, 8],
		["id-10", "body", null, 129],
	]);
	expect(
		[...lesson.nodes.values()].filter((record) => record.role === "option-feedback"),
	).toHaveLength(4);
});

it.each(["Third *advice*.", "Fourth."])(
	"C06c1 saves %s through its option binding and returns fresh scoped fields",
	async (text) => {
		const initial = `${allOptionFeedback}\n# Other page\n\nOther text.\n`;
		const { root, service } = await fixture({ "lesson.prax": initial });
		const before = await resolveLessonSources(root);
		const originalLesson = before.lessons.get("lesson.prax");
		if (!originalLesson) throw new Error("Missing fixture lesson");
		const ids = [...originalLesson.nodes.keys()];
		const snapshot = await service.canvasTextSnapshot();
		const options = snapshot.fields.filter((field) => field.kind === "option");
		const rows = snapshot.fields.filter((field) => field.feedback);
		expect(rows.map((field) => field.text)).toEqual([
			"First.",
			"Second.",
			"Third *advice*.",
			"Fourth.",
		]);
		expect(rows.map((field) => field.feedback)).toEqual([
			{ html: "<p>First.</p>", place: { option: options[0].nodeId } },
			{ html: "<p>Second.</p>", place: { option: options[1].nodeId }, alsoIncorrect: true },
			{ html: "Third <em>advice</em>.", place: { option: options[2].nodeId } },
			{ html: "Fourth.", place: { option: options[3].nodeId } },
		]);
		const field = rows.find((field) => field.text === text);
		if (!field) throw new Error("Missing later option feedback");
		expect(originalLesson.nodes.get(field.nodeId)?.role).toBe("option-feedback");
		const result = await service.canvasTextApply(
			{ ...canvasInput(field, "Revised **advice**."), field: "value" },
			field,
		);
		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error("Feedback save refused");
		expect(result.fields).toEqual((await service.canvasTextSnapshot(field)).fields);
		expect(
			result.fields?.find((candidate) => candidate.nodeId === field.nodeId)?.feedback?.html,
		).toBe("Revised <strong>advice</strong>.");
		expect(result.fields?.some((candidate) => candidate.text === "Other text.")).toBe(false);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			initial.replace(text, "Revised **advice**."),
		);
		expect([
			...((await resolveLessonSources(root)).lessons.get("lesson.prax")?.nodes.keys() ?? []),
		]).toEqual(ids);
	},
);

it("C06c1 presents promoted option feedback with the learner's inline renderer", async () => {
	const { service } = await fixture({
		"lesson.prax":
			"# Page\n\n::: choice Q\n(x) A\nfeedback: [x](javascript:alert(1)) advice.\n( ) B\nfeedback: [x](javascript:alert(1)) advice.\n( ) C\nfeedback: Third *advice*.\n:::\n",
	});
	const rows = (await service.canvasTextSnapshot()).fields.filter((field) => field.feedback);
	expect(rows.map((field) => field.feedback?.html)).toEqual([
		"<p><a>x</a> advice.</p>",
		"<p><a>x</a> advice.</p>",
		"Third <em>advice</em>.",
	]);
});

it.each([
	{
		parts: "feedback: Shared *advice*.\n",
		marker: "(x)",
		expected: [["Shared *advice*.", "<p>Shared <em>advice</em>.</p>", "any"]],
	},
	{
		parts: "correct: Right.\nincorrect: Try *again*.\nfeedback: Shadowed.\n",
		marker: "(x)",
		expected: [
			["Right.", "<p>Right.</p>", "correct"],
			["Try *again*.", "<p>Try <em>again</em>.</p>", "incorrect"],
		],
	},
	{
		parts: "correct: Right.\nincorrect: Try again.\n",
		marker: "( )",
		expected: [
			["Right.", "<p>Right.</p>", "any"],
			["Try again.", "<p>Try again.</p>", "any"],
		],
	},
	{ parts: "feedback: never\ncorrect:\n", marker: "(x)", expected: [] },
	{ parts: "", marker: "(x)", expected: [] },
])(
	"C06c1 presents authored question feedback once per owner for $parts",
	async ({ parts, marker, expected }) => {
		const { root, service } = await fixture({
			"lesson.prax": `# Page\n\n::: choice Q\n${parts}${marker} A\n( ) B\n:::\n`,
		});
		const rows = (await service.canvasTextSnapshot()).fields.filter((field) => field.feedback);
		expect(
			rows.map((field) => [
				field.text,
				field.feedback?.html,
				field.feedback?.place && "block" in field.feedback.place
					? field.feedback.place.result
					: undefined,
			]),
		).toEqual(expected);
		expect(new Set(rows.map((field) => field.ownerId)).size).toBe(rows.length);
		const identity = await resolveLessonSources(root);
		const block = identity.lessons
			.get("lesson.prax")
			?.blocks.find((block) => block.type === "assessment");
		for (const row of rows) expect(row.feedback?.place).toMatchObject({ block: block?.id });
	},
);

const feedbackCases = [
	{
		name: "result-specific",
		parts: "correct: Authored correct.\nincorrect: Authored incorrect.\nfeedback: Unused shared.\n",
		options: "(x) First\nfeedback: Unused option.\n( ) Second\n",
		expected: ["Authored correct.", "Authored incorrect.", "Unused option."],
		owners: ["correct", "incorrect", "feedback"],
	},
	{
		name: "promoted",
		parts: "",
		options: "(x) First\nfeedback: Correct option.\n( ) Second\nfeedback: Incorrect option.\n",
		expected: ["Correct option.", "Incorrect option.", "Correct option.", "Incorrect option."],
		owners: ["feedback", "feedback", "feedback", "feedback"],
	},
	{
		name: "shared",
		parts: "feedback: Shared advice.\n",
		options: "(x) First\n( ) Second\n",
		expected: ["Shared advice.", "Shared advice."],
		owners: ["feedback", "feedback"],
	},
	{
		name: "mixed precedence",
		parts: "incorrect: Try again.\nfeedback: Shared advice.\n",
		options: "(x) First\n( ) Second\n",
		expected: ["Shared advice.", "Try again."],
		owners: ["feedback", "incorrect"],
	},
];

it.each(feedbackCases)("C07a $name feedback edits its actual authored owner", async (scenario) => {
	const initial = `# Page\n\n::: choice Pick\n${scenario.parts}${scenario.options}:::\n`;
	const { root, service } = await fixture({ "lesson.prax": initial });
	const original = await resolveLessonSources(root);
	const ids = [...original.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()]);
	const fields = (await service.canvasTextSnapshot()).fields.filter(
		(field) => field.kind === "part",
	);
	expect(fields.map((field) => field.text)).toEqual(scenario.expected);
	for (const [index, field] of fields.entries()) {
		expect(field.field).toBe("value");
		const owner = original.identity.sourceMappings.find((mapping) => mapping.id === field.ownerId);
		const record = original.lessons.get("lesson.prax")?.nodes.get(field.nodeId);
		expect(owner?.span.start).toBe(
			initial.indexOf(`${scenario.owners[index]}: ${scenario.expected[index]}`),
		);
		expect(record?.node.span.start).toBe(owner?.span.start);
		expect(initial.slice(field.range.start, field.range.end)).toBe(field.text);
	}
	if (scenario.name === "shared") expect(fields[0].ownerId).toBe(fields[1].ownerId);
	const target = fields[1];
	if (!target) throw new Error("Missing incorrect feedback binding");
	const start = initial.indexOf(scenario.expected[1]);
	expect(target.range).toEqual({ start, end: start + scenario.expected[1].length });
	expect(
		await service.canvasTextApply({ ...canvasInput(target, "Revised *advice*."), field: "value" }),
	).toMatchObject({ ok: true });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		initial.slice(0, start) +
			"Revised *advice*." +
			initial.slice(start + scenario.expected[1].length),
	);
	const updated = await resolveLessonSources(root, {}, { strict: true });
	expect([...updated.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()])).toEqual(ids);
});

it("C07a refuses forged fields, markers, option lines and stale feedback with zero writes", async () => {
	const { root, service } = await fixture({ "lesson.prax": choiceSource });
	const fields = (await service.canvasTextSnapshot()).fields;
	const option = fields.find((field) => field.kind === "option");
	const feedback = fields.find((field) => field.kind === "part");
	if (!option || !feedback) throw new Error("Missing choice bindings");
	const before = await bytes(root);
	for (const [target, field, text, code] of [
		[option, "correct", "true", "not-allowed"],
		[option, "subject", "Changed", "not-allowed"],
		[feedback, "text", "Changed", "not-allowed"],
		[option, "text", "(x) New answer", "unsupported-syntax"],
		[option, "text", "[x] New answer", "unsupported-syntax"],
		[option, "text", "(X)", "unsupported-syntax"],
		[option, "text", "Label\n  [ ] New option", "unsupported-syntax"],
		[option, "text", "Label\n( ) New option", "unsupported-syntax"],
		[feedback, "value", "Advice\n( ) New option", "unsupported-syntax"],
		[option, "text", "", "empty-text"],
		[feedback, "value", " ", "empty-text"],
		[option, "text", "Bad\u0000text", "unsupported-syntax"],
		[feedback, "value", "Bad\uD800text", "unsupported-syntax"],
	] as const) {
		expect(await service.canvasTextApply({ ...canvasInput(target, text), field })).toMatchObject({
			ok: false,
			code,
		});
		expect(await bytes(root)).toEqual(before);
	}
	await writeFile(join(root, "lesson.prax"), choiceSource.replace("Tail.", "Outside edit."));
	const outside = await bytes(root);
	expect(
		await service.canvasTextApply({ ...canvasInput(feedback, "Changed"), field: "value" }),
	).toMatchObject({ ok: false, code: "stale" });
	expect(await bytes(root)).toEqual(outside);
});

it.each(
	["en", "fr"].flatMap((lang) =>
		["", "feedback: immediate\n", "feedback: never\n", "feedback: deferred\n"].map((parts) => ({
			lang,
			parts,
		})),
	),
)(
	"C07a $lang generated or translated defaults have no authored field with $parts",
	async ({ lang, parts }) => {
		const initial = `---\nlang: ${lang}\n---\n# Page\n\n::: choice Pick {dontKnow}\n${parts}(x) First\n( ) Second\n:::\n`;
		const { root, service } = await fixture({ "lesson.prax": initial });
		const fields = (await service.canvasTextSnapshot()).fields;
		expect(fields.map((field) => field.kind).sort()).toEqual(["option", "option", "page"]);
		const page = fields.find((field) => field.kind === "page");
		if (!page) throw new Error("Missing page binding");
		const before = await bytes(root);
		for (const nodeId of ["dont-know", "generated-correct", "generated-incorrect"]) {
			expect(
				await service.canvasTextApply({
					...canvasInput(page, "Translated default"),
					nodeId,
					field: "value",
				}),
			).toMatchObject({ ok: false, code: "orphaned" });
			expect(await bytes(root)).toEqual(before);
		}
	},
);

it("C07a preserves wrapped label and authored feedback bytes and identities", async () => {
	const initial =
		"\uFEFF# Page\r\n\r\n::: choice Pick\r\n(x) First *label*\r\n  wrapped label\r\nfeedback: First advice.\r\n  Continued advice.\r\n( ) Second\r\nfeedback: Second advice.\r\n:::\r\n";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const before = await resolveLessonSources(root);
	const ids = [...before.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()]);
	const options = (await service.canvasTextSnapshot()).fields.filter(
		(field) => field.kind === "option",
	);
	const option = options.find((field) => field.text === "First *label*\r\n  wrapped label");
	if (!option) throw new Error("Missing wrapped option");
	expect(
		await service.canvasTextApply({
			...canvasInput(option, "Longer **label**\n  wrapped label"),
			field: "text",
		}),
	).toMatchObject({ ok: true });
	let expected = initial.replace("First *label*", "Longer **label**");
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(expected);
	const feedback = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.text === "First advice.\r\n  Continued advice.",
	);
	if (!feedback) throw new Error("Missing wrapped feedback");
	const unchanged = await bytes(root);
	expect(
		await service.canvasTextApply({
			...canvasInput(feedback, "Advice\n\n  New paragraph."),
			field: "value",
		}),
	).toMatchObject({ ok: false, code: "unsupported-syntax" });
	expect(await bytes(root)).toEqual(unchanged);
	expect(
		await service.canvasTextApply({
			...canvasInput(feedback, "Longer first advice.\n  Continued advice."),
			field: "value",
		}),
	).toMatchObject({ ok: true });
	expected = expected.replace("First advice.", "Longer first advice.");
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(expected);
	const after = await resolveLessonSources(root, {}, { strict: true });
	expect([...after.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()])).toEqual(ids);
});

it.each(["option", "part"])(
	"C07a ordinary setText shares %s admission and exact bytes",
	async (kind) => {
		const { root, service } = await fixture({ "lesson.prax": choiceSource });
		const field = (await service.canvasTextSnapshot()).fields.find((field) => field.kind === kind);
		if (!field) throw new Error("Missing scalar field");
		const current = await resolveLessonSources(root);
		const owner = current.identity.sourceMappings.find((mapping) => mapping.id === field.ownerId);
		if (!owner) throw new Error("Missing source owner");
		const input = {
			...(await request(root, field.file, owner.path, current)),
			operation: "setText",
		};
		const before = await bytes(root);
		for (const text of ["", kind === "option" ? "(x) Forged" : "Advice\n( ) New option"]) {
			expect(await service.apply({ ...input, args: { field: field.field, text } })).toMatchObject({
				ok: false,
			});
			expect(await bytes(root)).toEqual(before);
		}
		expect(
			await service.apply({ ...input, args: { field: field.field, text: "Changed *source*." } }),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			choiceSource.slice(0, field.range.start) +
				"Changed *source*." +
				choiceSource.slice(field.range.end),
		);
	},
);

it.each(["Changed caption.", ""])(
	"C07a retains ordinary setText for non-feedback named parts with %j",
	async (text) => {
		const initial = "# Page\n\n::: video clip.mp4\ncaption: Existing caption.\n:::\n";
		const { root, service } = await fixture({ "lesson.prax": initial });
		const input = await request(root, "lesson.prax", [0, 0, 0]);
		expect(
			await service.apply({
				...input,
				operation: "setText",
				args: { field: "value", text },
			}),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			`# Page\n\n::: video clip.mp4\ncaption: ${text}\n:::\n`,
		);
	},
);

it.each([
	[" ", "empty-text"],
	[" New", "unsupported-syntax"],
])("C08a ordinary caption setText refuses %j without writes", async (text, code) => {
	const initial = "# Page\n\n::: video clip.mp4\ncaption: Existing caption.\n:::\n";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const input = await request(root, "lesson.prax", [0, 0, 0]);
	const before = await bytes(root);
	expect(
		await service.apply({ ...input, operation: "setText", args: { field: "value", text } }),
	).toMatchObject({ ok: false, code });
	expect(await bytes(root)).toEqual(before);
});

it.each(["title", "transcript"])(
	"C08a ordinary %s parts keep their existing text policy",
	async (name) => {
		const initial = `# Page\n\n::: video clip.mp4\n${name}: Original.\n:::\n`;
		const { root, service } = await fixture({ "lesson.prax": initial });
		const input = await request(root, "lesson.prax", [0, 0, 0]);
		expect(
			await service.apply({
				...input,
				operation: "setText",
				args: { field: "value", text: " New" },
			}),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			`# Page\n\n::: video clip.mp4\n${name}:  New\n:::\n`,
		);
	},
);

it.each(["feedback", "correct", "incorrect"])(
	"C07a review ordinary setText fills an empty %s part without offering it on canvas",
	async (name) => {
		const initial = `# Page\r\n\r\n::: choice Q\r\n${name}:\r\n(x) A\r\n( ) B\r\n:::\r\n`;
		const { root, service } = await fixture({ "lesson.prax": initial });
		expect(
			(await service.canvasTextSnapshot()).fields.filter((field) => field.kind === "part"),
		).toEqual([]);
		const input = await request(root, "lesson.prax", [0, 0, 0]);
		expect(
			await service.apply({
				...input,
				operation: "setText",
				args: { field: "value", text: "Filled" },
			}),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			initial.replace(`${name}:`, `${name}:Filled`),
		);
	},
);

it.each([
	{
		name: "option prose to timing word",
		block: "choice Q",
		parts: "(x) A\nfeedback: Advice\n( ) B",
		path: [0, 0, 0, 0],
		old: "Advice",
		text: "never",
	},
	{
		name: "question timing to timing",
		block: "choice Q",
		parts: "feedback: never\n(x) A\n( ) B",
		path: [0, 0, 0],
		old: "never",
		text: "immediate",
	},
	{
		name: "rating prose to timing word",
		block: "rating Q",
		parts: "feedback: Advice\n1. Low\n2. High",
		path: [0, 0, 0],
		old: "Advice",
		text: "never",
	},
	{
		name: "empty rating feedback",
		block: "rating Q",
		parts: "feedback:\n1. Low\n2. High",
		path: [0, 0, 0],
		old: "feedback:",
		text: "Filled",
	},
])("C07a review ordinary setText preserves $name", async ({ block, parts, path, old, text }) => {
	const initial = `# Page\n\n::: ${block}\n${parts}\n:::\n`;
	const { root, service } = await fixture({ "lesson.prax": initial });
	const input = await request(root, "lesson.prax", path);
	expect(
		await service.apply({ ...input, operation: "setText", args: { field: "value", text } }),
	).toMatchObject({ ok: true });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		initial.replace(old, old === "feedback:" ? `feedback:${text}` : text),
	);
});

it.each(["never", "immediate", "after-submit", "after-all", "deferred"])(
	"C07a review option feedback accepts literal %s while generic question feedback refuses it",
	async (text) => {
		const initial =
			"# Page\n\n::: choice Q\nfeedback: Shared\n(x) A\nfeedback: Option\n( ) B\n:::\n";
		const { root, service } = await fixture({ "lesson.prax": initial });
		const fields = (await service.canvasTextSnapshot()).fields;
		const generic = fields.find((field) => field.text === "Shared");
		const option = fields.find((field) => field.text === "Option");
		if (!generic || !option) throw new Error("Missing feedback owners");
		const before = await bytes(root);
		expect(
			await service.canvasTextApply({ ...canvasInput(generic, text), field: "value" }),
		).toMatchObject({ ok: false, code: "unsupported-syntax" });
		expect(await bytes(root)).toEqual(before);
		expect(
			await service.canvasTextApply({ ...canvasInput(option, text), field: "value" }),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			initial.replace("feedback: Option", `feedback: ${text}`),
		);
		expect(
			(await service.canvasTextSnapshot()).fields.find((field) => field.nodeId === option.nodeId)
				?.text,
		).toBe(text);
	},
);

it.each([
	{ old: "One line", text: "One\n  line" },
	{ old: "One\n  line", text: "One line" },
])("C07a review feedback retains continuation structure for $old", async ({ old, text }) => {
	const initial = `# Page\n\n::: choice Q\n(x) A\nfeedback: ${old}\n( ) B\n:::\n`;
	const { root, service } = await fixture({ "lesson.prax": initial });
	const field = (await service.canvasTextSnapshot()).fields.find((field) => field.kind === "part");
	if (!field) throw new Error("Missing feedback");
	const before = await bytes(root);
	expect(
		await service.canvasTextApply({ ...canvasInput(field, text), field: "value" }),
	).toMatchObject({ ok: false, code: "unsupported-syntax" });
	expect(await bytes(root)).toEqual(before);
});

it.each(["correct", "incorrect"])(
	"C07a review result-specific %s feedback accepts a literal timing word",
	async (name) => {
		const initial = `# Page\n\n::: choice Q\n${name}: Advice\n(x) A\n( ) B\n:::\n`;
		const { root, service } = await fixture({ "lesson.prax": initial });
		const field = (await service.canvasTextSnapshot()).fields.find(
			(field) => field.kind === "part",
		);
		if (!field) throw new Error("Missing result feedback");
		expect(
			await service.canvasTextApply({ ...canvasInput(field, "never"), field: "value" }),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			initial.replace("Advice", "never"),
		);
	},
);

it.each(["correct", "incorrect", "feedback"])(
	"C07a review fill-blank %s feedback stays editable while scored sentences do not",
	async (name) => {
		const initial = `# Page\n\n::: fill-blank Q\n${name}: Advice\nVerify {isolation} and {authorization}.\n:::\n`;
		const { root, service } = await fixture({ "lesson.prax": initial });
		const before = await resolveLessonSources(root);
		expect(
			Object.values(before.identity.snapshots[0].nodes).filter((node) => node.type === "blank"),
		).toHaveLength(2);
		const snapshot = await service.canvasTextSnapshot();
		expect(snapshot.fields.map((field) => field.text)).not.toContain(
			"Verify {isolation} and {authorization}.",
		);
		const feedback = snapshot.fields.find(
			(field) => field.kind === "part" && field.text === "Advice",
		);
		expect(feedback).toBeDefined();
		if (!feedback) throw new Error("Missing fill-blank feedback");
		expect(
			await service.canvasTextApply({ ...canvasInput(feedback, "Revised advice"), field: "value" }),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			initial.replace("Advice", "Revised advice"),
		);
		const after = await resolveLessonSources(root);
		expect(after.identity.sourceMappings.map(({ id, path }) => ({ id, path }))).toEqual(
			before.identity.sourceMappings.map(({ id, path }) => ({ id, path })),
		);
		expect([...after.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()])).toEqual(
			[...before.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()]),
		);
	},
);

it("C07a ambiguous unstored feedback refuses without source or identity writes", async () => {
	const initial =
		"# Page\n\n::: choice Pick\nfeedback: Same advice.\n(x) First\n( ) Second\n:::\n\n::: choice Pick\nfeedback: Same advice.\n(x) First\n( ) Second\n:::\n";
	const { root } = await fixture({ "lesson.prax": initial });
	await rm(join(root, ".praxity"), { recursive: true });
	const service = new OperationService(root);
	const fields = (await service.canvasTextSnapshot()).fields.filter(
		(field) => field.kind === "part",
	);
	const feedback = fields[2];
	if (!feedback) throw new Error("Missing second activity feedback");
	const before = await bytes(root);
	expect(
		await service.canvasTextApply({ ...canvasInput(feedback, "Changed advice."), field: "value" }),
	).toMatchObject({ ok: false, code: "ambiguous" });
	expect(await bytes(root)).toEqual(before);
});

const choiceModelStarts = [
	"explicit",
	"shared",
	"promoted",
	"default",
	"timing",
	"multiple",
	"poll",
	"unstored",
	"empty",
];
it.each(choiceModelStarts.flatMap((start) => [17, 29].map((seed) => ({ start, seed }))))(
	"C07a generated model from $start seed $seed edits IDs and never offers generated feedback",
	async ({ start, seed }) => {
		let label = "Same";
		let advice = "Authored advice.";
		const prefix =
			start === "empty"
				? ""
				: `# Page\n\n::: choice Pick\n${start === "explicit" ? "incorrect: Authored advice.\n" : start === "shared" ? "feedback: Authored advice.\n" : start === "timing" ? "feedback: never\n" : ""}${start === "multiple" ? "[x]" : start === "poll" ? "( )" : "(x)"} ${start === "unstored" ? "First" : "Same"}\n${start === "multiple" ? "[ ]" : "( )"} `;
		const suffix = `${start === "promoted" ? "\nfeedback: Authored advice." : ""}\n:::\n`;
		const render = () =>
			start === "empty" ? "" : (prefix + label + suffix).replace("Authored advice.", advice);
		let model = render();
		const { root } = await fixture({ "lesson.prax": model });
		if (start === "unstored") await rm(join(root, ".praxity"), { recursive: true });
		const service = new OperationService(root);
		let random = seed;
		for (let step = 0; step < 2; step++) {
			random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
			const fields = (await service.canvasTextSnapshot()).fields;
			const options = fields
				.filter((field) => field.kind === "option")
				.sort((a, b) => a.range.start - b.range.start);
			const feedback = fields.filter((field) => field.kind === "part");
			expect(fields.map((field) => field.kind).sort()).toEqual(
				start === "empty"
					? []
					: [
							"page",
							"option",
							"option",
							...(start === "shared"
								? ["part", "part"]
								: start === "promoted"
									? ["part", "part"]
									: start === "explicit"
										? ["part"]
										: []),
						].sort(),
			);
			expect(options.map((field) => field.text)).toEqual(
				start === "empty" ? [] : [start === "unstored" ? "First" : "Same", label],
			);
			expect(feedback.map((field) => field.text)).toEqual(
				["shared", "promoted"].includes(start)
					? [advice, advice]
					: ["explicit", "promoted"].includes(start)
						? [advice]
						: [],
			);
			for (const field of fields) {
				expect(field.baseRevision).toBe(digest(model));
				expect(model.slice(field.range.start, field.range.end)).toBe(field.text);
			}
			if (start === "empty") continue;
			const target = step && feedback.length ? feedback[0] : options[1];
			if (!target) throw new Error("Missing model target");
			const before = await bytes(root);
			expect(
				await service.canvasTextApply({ ...canvasInput(target, "Forged"), field: "answer" }),
			).toMatchObject({ ok: false, code: "not-allowed" });
			expect(await bytes(root)).toEqual(before);
			expect(
				await service.canvasTextApply({
					...canvasInput(
						target,
						target.kind === "option" ? "(x) Forged answer" : "Advice\n( ) New option",
					),
					field: target.field,
				}),
			).toMatchObject({ ok: false, code: "unsupported-syntax" });
			expect(await bytes(root)).toEqual(before);
			const replacement = `Saved ${random}.`;
			expect(
				await service.canvasTextApply({
					...canvasInput(target, replacement),
					field: target.field,
				}),
			).toMatchObject({ ok: true });
			if (target.kind === "part") advice = replacement;
			else label = replacement;
			model = render();
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(model);
			const saved = await bytes(root);
			// A first save promotes runtime IDs. Keep the old hash with the current rendered ID.
			const current = (await service.canvasTextSnapshot()).fields.find(
				(field) => field.kind === target.kind && field.range.start === target.range.start,
			);
			if (!current) throw new Error("Missing saved model field");
			expect(
				await service.canvasTextApply({
					...canvasInput(current, "Stale save."),
					baseRevision: target.baseRevision,
					field: target.field,
				}),
			).toMatchObject({ ok: false, code: "stale" });
			expect(await bytes(root)).toEqual(saved);
		}
	},
);

const proseFixtures = [
	{
		name: "LF",
		prefix: "# Page\n\n",
		text: "First *line*\nsecond line",
		suffix: "\n\n- Parent\n  - Child\n- Sibling\n\nTail.",
	},
	{
		name: "CRLF",
		prefix: "# Page\r\n\r\n",
		text: "First *line*\r\nsecond line",
		suffix: "\r\n\r\n7. Parent\r\n   - Child\r\n8. Sibling\r\n\r\nTail.",
	},
	{
		name: "BOM",
		prefix: "\uFEFF# Page\r\n\r\n",
		text: "First *line*\r\nsecond line",
		suffix: "\r\n\r\n- Parent\r\n  - Child\r\n- Sibling\r\n\r\nTail.",
	},
	{
		name: "mixed",
		prefix: "\uFEFF# Page\r\n\n",
		text: "First *line*\nsecond line\rthird line",
		suffix: "\r\n\n- Parent\r\n  - Child\n- Sibling\r\n\nTail.",
	},
];

it.each(proseFixtures)(
	"C06a $name edits raw paragraph and leaf text without other byte or ID changes",
	async ({ prefix, text, suffix }) => {
		const initial = prefix + text + suffix;
		const { root, service } = await fixture({ "lesson.prax": initial });
		const original = await resolveLessonSources(root);
		const ids = [...original.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()]);
		const mappings = original.identity.sourceMappings.map(({ id, path }) => ({ id, path }));
		const snapshot = await service.canvasTextSnapshot();
		expect(
			snapshot.fields.filter((field) => field.kind === "list-entry").map((field) => field.text),
		).toEqual(["Parent", "Child", "Sibling"]);
		const paragraph = snapshot.fields.find((field) => field.text === text);
		if (!paragraph) throw new Error("Missing paragraph field");
		expect(paragraph).toMatchObject({
			field: "text",
			range: { start: prefix.length, end: prefix.length + text.length },
			baseRevision: digest(initial),
		});
		const replacement = text.replace("First *line*", "Edited **line** 🦊");
		// Native textareas supply LF. Existing wrap terminators must survive even in mixed source.
		expect(
			await service.canvasTextApply({
				...canvasInput(paragraph, replacement.replace(/\r\n|\r/g, "\n")),
				field: "text",
			}),
		).toMatchObject({ ok: true });
		const expected = prefix + replacement + suffix;
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(expected);
		const child = (await service.canvasTextSnapshot()).fields.find(
			(field) => field.text === "Child",
		);
		if (!child) throw new Error("Missing leaf field");
		expect(
			await service.canvasTextApply({
				...canvasInput(child, "Changed [link](https://example.org)"),
				field: "text",
			}),
		).toMatchObject({ ok: true });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			prefix + replacement + suffix.replace("Child", "Changed [link](https://example.org)"),
		);
		const updated = await resolveLessonSources(root, {}, { strict: true });
		expect([...updated.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()])).toEqual(
			ids,
		);
		expect(updated.identity.sourceMappings.map(({ id, path }) => ({ id, path }))).toEqual(mappings);
	},
);

it("C06a refuses structure, controls, empty deletion and forged fields with zero writes", async () => {
	const initial = "# Page\n\nOriginal paragraph\nwrap.\n\n- Parent\n  - Child\n- Sibling\n";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const snapshot = await service.canvasTextSnapshot();
	const paragraph = snapshot.fields.find((field) => field.kind === "body");
	const leaf = snapshot.fields.find((field) => field.text === "Child");
	if (!paragraph || !leaf) throw new Error("Missing prose bindings");
	const before = await bytes(root);
	for (const [text, code] of [
		["", "empty-text"],
		[" \t", "empty-text"],
		["## Pasted heading", "unsupported-syntax"],
		["::: note\nNew block\n:::", "unsupported-syntax"],
		["First\n\nSecond", "unsupported-syntax"],
		["- New list", "list-marker"],
		["Text\n## Heading", "unsupported-syntax"],
		["Text\u2028line", "line-break"],
		["Bad\uD800text", "unsupported-syntax"],
		["Bad\u0000text", "unsupported-syntax"],
	] as const) {
		expect(
			await service.canvasTextApply({ ...canvasInput(paragraph, text), field: "text" }),
			text,
		).toMatchObject({ ok: false, code });
		expect(await bytes(root)).toEqual(before);
	}
	for (const input of [
		{ ...canvasInput(leaf, "Child\n\n    Split paragraph"), field: "text" },
		{ ...canvasInput(leaf, "Child\n    ```\n    code\n    ```"), field: "text" },
		{ ...canvasInput(leaf, "Child\n  - Forged sibling"), field: "text" },
		{ ...canvasInput(paragraph, "Changed"), field: "value" },
		{ ...canvasInput(leaf, "Changed"), range: { start: 0, end: initial.length }, field: "text" },
	]) {
		expect(await service.canvasTextApply(input), JSON.stringify(input)).toMatchObject({
			ok: false,
		});
		expect(await bytes(root)).toEqual(before);
	}
	const parent = [...(await resolveLessonSources(root)).lessons.values()]
		.flatMap((lesson) => [...lesson.nodes.values()])
		.find((record) => record.node.kind === "list-entry" && record.node.children.length > 0);
	if (!parent) throw new Error("Missing nested parent");
	expect(
		await service.canvasTextApply({
			...canvasInput(leaf, "- x"),
			field: "text",
			nodeId: parent.id,
			expectedText: "Parent",
		}),
	).toMatchObject({ ok: false, code: "unsupported-syntax" });
	expect(await bytes(root)).toEqual(before);
});

it("C06a permits prose wraps in paragraphs and leaf entries, retaining their IDs through undo", async () => {
	const initial = "# Page\r\n\r\nParagraph.\r\n\r\n7. First\r\n   wrapped\r\n8. Last";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const before = await resolveLessonSources(root);
	const ids = before.identity.sourceMappings.map(({ id, path }) => ({ id, path }));
	const paragraph = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.text === "Paragraph.",
	);
	if (!paragraph) throw new Error("Missing single-line paragraph");
	expect(
		await service.canvasTextApply({
			...canvasInput(paragraph, "Paragraph\nwith a wrap."),
			field: "text",
		}),
	).toMatchObject({ ok: true });
	const leaf = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.text === "First\r\n   wrapped",
	);
	if (!leaf) throw new Error("Missing wrapped leaf");
	const result = await service.canvasTextApply({
		...canvasInput(leaf, "Edited\n   wrapped\n   again"),
		field: "text",
	});
	expect(result).toMatchObject({ ok: true });
	if (!result.ok) throw new Error(result.code);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"# Page\r\n\r\nParagraph\r\nwith a wrap.\r\n\r\n7. Edited\r\n   wrapped\r\n   again\r\n8. Last",
	);
	expect(
		(await resolveLessonSources(root)).identity.sourceMappings.map(({ id, path }) => ({
			id,
			path,
		})),
	).toEqual(ids);
	expect(
		await service.historyApply({
			transactionId: randomUUID(),
			historyId: result.historyId,
			direction: "undo",
		}),
	).toMatchObject({ ok: true });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"# Page\r\n\r\nParagraph\r\nwith a wrap.\r\n\r\n7. First\r\n   wrapped\r\n8. Last",
	);
	expect(
		(await resolveLessonSources(root)).identity.sourceMappings.map(({ id, path }) => ({
			id,
			path,
		})),
	).toEqual(ids);
});

it("C06a admits resolved paragraph lines that resemble unknown named parts", async () => {
	const initial = "# Page\n\ntip: Keep *clear*.\n";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const paragraph = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.text === "tip: Keep *clear*.",
	);
	if (!paragraph) throw new Error("Missing resolved named prose");
	expect(
		await service.canvasTextApply({
			...canvasInput(paragraph, "tip: Stay **safe**."),
			field: "text",
		}),
	).toMatchObject({ ok: true });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("# Page\n\ntip: Stay **safe**.\n");
});

it("C06a protected bodies stay unavailable and stale prose requests write nothing", async () => {
	const initial = "# Page\n\nParagraph.\n\n```\ncode\n```\n\n> Quote\n";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const snapshot = await service.canvasTextSnapshot();
	expect(
		snapshot.fields.filter((field) => field.kind === "body").map((field) => field.text),
	).toEqual(["Paragraph."]);
	const paragraph = snapshot.fields.find((field) => field.text === "Paragraph.");
	if (!paragraph) throw new Error("Missing prose");
	await writeFile(join(root, "lesson.prax"), initial.replace("Quote", "Outside"));
	const before = await bytes(root);
	expect(
		await service.canvasTextApply({ ...canvasInput(paragraph, "Changed."), field: "text" }),
	).toMatchObject({ ok: false, code: "stale" });
	expect(await bytes(root)).toEqual(before);
});

it("C06a review keeps parent list text available to CLI/agents and inspect, with children intact", async () => {
	const initial = "# Page\r\n\r\n- Parent\r\n  - Child\r\n- Sibling\r\n";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const inventory = await readBlockInventory(root, true);
	const parent = inventory.blocks.find(
		(block) => block.kind === "list-entry" && block.source.startsWith("- Parent"),
	);
	if (!parent) throw new Error("Missing parent list entry");
	expect(parent.operations).toContain("setText");
	expect((await service.canvasTextSnapshot()).fields.map((field) => field.text)).toContain(
		"Parent",
	);
	const before = await resolveLessonSources(root);
	expect(
		await service.apply({
			transactionId: randomUUID(),
			operation: "setText",
			files: inventory.files,
			targets: [parent.target],
			args: { field: "text", text: "Renamed" },
		}),
	).toMatchObject({ ok: true });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"# Page\r\n\r\n- Renamed\r\n  - Child\r\n- Sibling\r\n",
	);
	const after = await resolveLessonSources(root);
	expect(after.identity.sourceMappings.map(({ id, path }) => ({ id, path }))).toEqual(
		before.identity.sourceMappings.map(({ id, path }) => ({ id, path })),
	);
});

it("C06a review excludes fill-blank sentences and forged saves never change blank IDs", async () => {
	const initial =
		"# Page\n\n::: fill-blank Q\nVerify {isolation} and {authorization}.\n:::\n\nOrdinary paragraph.\n";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const resolved = await resolveLessonSources(root);
	expect(
		Object.values(resolved.identity.snapshots[0].nodes).filter((node) => node.type === "blank"),
	).toHaveLength(2);
	const lesson = [...resolved.lessons.values()][0];
	const body = [...lesson.nodes.values()].find(
		(record) => record.node.kind === "body" && record.node.raw.startsWith("Verify"),
	);
	if (!body) throw new Error("Missing fill-blank body");
	const snapshot = await service.canvasTextSnapshot();
	expect(snapshot.fields.map((field) => field.text)).not.toContain(
		"Verify {isolation} and {authorization}.",
	);
	const before = await bytes(root);
	for (const text of [
		"Verify {isolation} only.",
		"Verify {isolation} and {authorization} and {permit}.",
		"Verify {c} and {authorization}.",
		"Verify now.",
	]) {
		expect(
			await service.canvasTextApply({
				transactionId: randomUUID(),
				operation: "setText",
				file: "lesson.prax",
				nodeId: body.id,
				baseRevision: digest(initial),
				expectedText: "Verify {isolation} and {authorization}.",
				field: "text",
				text,
			}),
		).toMatchObject({ ok: false, code: "orphaned" });
		expect(await bytes(root)).toEqual(before);
	}
	const paragraph = snapshot.fields.find((field) => field.text === "Ordinary paragraph.");
	if (!paragraph) throw new Error("Missing ordinary paragraph");
	expect(
		await service.canvasTextApply({
			...canvasInput(paragraph, "Edited paragraph."),
			field: "text",
		}),
	).toMatchObject({ ok: true });
	const after = await resolveLessonSources(root);
	expect(after.identity.sourceMappings.map(({ id, path }) => ({ id, path }))).toEqual(
		resolved.identity.sourceMappings.map(({ id, path }) => ({ id, path })),
	);
});

it.each([
	["A\r\nB\nC", "AB\nC", "AB\nC"],
	["A\r\nB\nC\rD", "A\nBC\nD", "A\r\nBC\rD"],
	["A\r\nB\nC", "A\nB-new\nC", "A\r\nB-new\nC"],
	["A\r\nB\nC", "A\nX\nB\nC", "A\r\nX\r\nB\nC"],
	["A\r\nB\nC\rD\r\nE", "AB\nCD\nE", "AB\nCD\r\nE"],
])("C06a review preserves surviving mixed wraps from %j to %j", async (body, text, expected) => {
	const initial = `# Page\n\n${body}\n\nOutside.\n`;
	const { root, service } = await fixture({ "lesson.prax": initial });
	const field = (await service.canvasTextSnapshot()).fields.find((field) => field.text === body);
	if (!field) throw new Error("Missing mixed paragraph");
	expect(
		await service.canvasTextApply({ ...canvasInput(field, text), field: "text" }),
	).toMatchObject({ ok: true });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		`# Page\n\n${expected}\n\nOutside.\n`,
	);
});

it("C06a ordinary setText shares structural admission and permits wrapped prose", async () => {
	const initial = "# Page\n\nOriginal\nwrapped paragraph.\n\n- Leaf\n";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const current = await resolveLessonSources(root);
	const body = current.identity.sourceMappings.find(
		(mapping) =>
			initial.slice(mapping.span.start, mapping.span.end) === "Original\nwrapped paragraph.\n",
	);
	if (!body) throw new Error("Missing paragraph mapping");
	const input = (text: string) => ({
		transactionId: randomUUID(),
		operation: "setText",
		files: [{ path: "lesson.prax", baseRevision: digest(initial) }],
		targets: [
			{
				file: "lesson.prax",
				ref: { kind: "node", nodeId: body.id, path: body.path, fingerprint: body.fingerprint },
				expectedText: "Original\nwrapped paragraph.\n",
			},
		],
		args: { field: "text", text },
	});
	const before = await bytes(root);
	expect(await service.apply(input("First\n\nSecond"))).toMatchObject({
		ok: false,
		code: "unsupported-syntax",
	});
	expect(await bytes(root)).toEqual(before);
	expect(await service.apply(input("Edited\nwrapped paragraph."))).toMatchObject({ ok: true });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"# Page\n\nEdited\nwrapped paragraph.\n\n- Leaf\n",
	);
});

it.each(
	["LF", "CRLF", "BOM", "mixed", "unstored", "empty"].flatMap((start) =>
		[1701, 42, 20261016].map((seed) => ({ start, seed })),
	),
)(
	"C06a generated paragraph histories obey literal byte model from $start seed $seed",
	async ({ start, seed }) => {
		const style = proseFixtures.find((fixture) => fixture.name === start) ?? proseFixtures[0];
		const initial =
			start === "empty"
				? ""
				: style.prefix +
					"Same paragraph." +
					"\n\n" +
					"::: note\nSame paragraph.\n:::\n\n- Parent\n  - Child\n- Sibling\n";
		const root = await mkdtemp(join(tmpdir(), "canvas-prose-model-"));
		roots.push(root);
		await writeFile(join(root, "course.yaml"), "title: Test\nlessons: [lesson.prax]\n");
		await writeFile(join(root, "lesson.prax"), initial);
		if (start !== "unstored" && start !== "empty") await persistFixtureIdentity(root);
		const service = new OperationService(root);
		let model = initial;
		let second = "Same paragraph.";
		let durable = start !== "unstored" && start !== "empty";
		let state = seed;
		for (let step = 0; step < 4; step++) {
			const snapshot = await service.canvasTextSnapshot();
			expect(
				snapshot.fields.filter((field) => field.kind === "list-entry").map((field) => field.text),
			).toEqual(model ? ["Parent", "Child", "Sibling"] : []);
			const paragraphs = snapshot.fields.filter((field) => field.kind === "body");
			expect(paragraphs.map((field) => field.text)).toEqual(
				model ? ["Same paragraph.", second] : [],
			);
			if (!model) {
				expect(snapshot.fields).toEqual([]);
				model =
					"# Page\n\nSame paragraph.\n\n::: note\nSame paragraph.\n:::\n\n- Parent\n  - Child\n- Sibling\n";
				await writeFile(join(root, "lesson.prax"), model);
				continue;
			}
			const field = paragraphs[1];
			if (!field) throw new Error("Missing repeated paragraph");
			expect(field.baseRevision).toBe(digest(model));
			const before = await bytes(root);
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			const invalid = state % 2 ? "First\n\nSecond" : "::: note\nInjected\n:::";
			expect(
				await service.canvasTextApply({ ...canvasInput(field, invalid), field: "text" }),
			).toMatchObject({ ok: false, code: "unsupported-syntax" });
			expect(await bytes(root)).toEqual(before);
			const result = await service.canvasTextApply({
				...canvasInput(field, `Saved ${step}.`),
				field: "text",
			});
			if (!durable) {
				expect(result).toMatchObject({ ok: false, code: "ambiguous" });
				expect(await bytes(root)).toEqual(before);
				await persistFixtureIdentity(root);
				durable = true;
				continue;
			}
			expect(result).toMatchObject({ ok: true });
			second = `Saved ${step}.`;
			// The spec identifies the second body in the note, never the first equal quote.
			model = model.replace(/(?<=::: note\n)(?:Same paragraph\.|Saved \d+\.)/u, `Saved ${step}.`);
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(model);
		}
	},
);
const canvasInput = (
	field: { file: string; nodeId: string; baseRevision: string; text: string },
	text = "Stay **safe**",
) => ({
	transactionId: randomUUID(),
	operation: "setText",
	file: field.file,
	nodeId: field.nodeId,
	baseRevision: field.baseRevision,
	expectedText: field.text,
	field: "subject",
	text,
});

it("C04 distinguishes author input refusals and guards the captured text, without writes", async () => {
	const { root, service } = await fixture({ "lesson.prax": canvasSource });
	const field = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.kind === "heading",
	);
	if (!field) throw new Error("Missing heading");
	const before = await bytes(root);
	for (const [text, code] of [
		["", "empty-text"],
		["  ", "empty-text"],
		["One\nTwo", "line-break"],
		["One\u0085Two", "line-break"],
		["Title {hideTitle}", "settings"],
		["Bad \uD800", "unsupported-syntax"],
		["Bad\u0000", "unsupported-syntax"],
	]) {
		expect(await service.canvasTextApply(canvasInput(field, text))).toMatchObject({
			ok: false,
			code,
		});
		expect(await bytes(root)).toEqual(before);
	}
	expect(
		await service.canvasTextApply({ ...canvasInput(field), expectedText: "Forged baseline" }),
	).toMatchObject({ ok: false, code: "stale" });
	const { expectedText: _expected, ...missing } = canvasInput(field);
	expect(await service.canvasTextApply(missing)).toMatchObject({ ok: false, code: "invalid-args" });
	expect(await bytes(root)).toEqual(before);
});

it("break-ui B trims heading edges during canvas admission and writes the trimmed subject", async () => {
	const { root, service } = await fixture({
		"lesson.prax": canvasSource.replace("Keep *clear*", "Original"),
	});
	const field = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.kind === "heading",
	);
	if (!field) throw new Error("Missing heading");
	expect(await service.canvasTextApply(canvasInput(field, "Keep *clear* "))).toMatchObject({
		ok: true,
	});
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(canvasSource);
});

it("C03 changes only heading subject bytes, retaining every reader ID and unrelated sidecar", async () => {
	const { root, service } = await fixture({ "lesson.prax": canvasSource });
	await mkdir(join(root, ".praxity", "local"), { recursive: true });
	await writeFile(join(root, ".praxity", "local", "sentinel.json"), "untouched\n");
	const original = await resolveLessonSources(root);
	const ids = [...original.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()]);
	const snapshot = await service.canvasTextSnapshot();
	const field = snapshot.fields.find((field) => field.kind === "heading");
	if (!field) throw new Error("Missing heading field");
	expect(field).toMatchObject({
		field: "subject",
		text: "Keep *clear*",
		baseRevision: digest(canvasSource),
	});
	expect(canvasSource.slice(field.range.start, field.range.end)).toBe("Keep *clear*");
	const before = await bytes(root);
	expect(await service.canvasTextApply(canvasInput(field))).toMatchObject({ ok: true });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"\uFEFF# Safety {style=none}\r\n\r\n## Stay **safe** {level=3}\r\n\r\nA separate paragraph.\r\n",
	);
	const after = await bytes(root);
	const changed = Object.keys(after)
		.filter((file) => after[file] !== before[file])
		.sort();
	expect(Object.keys(before).every((file) => file in after)).toBe(true);
	expect(
		changed.filter(
			(file) =>
				(file.endsWith(".prax") || file.startsWith(".praxity/")) &&
				!file.startsWith(".praxity/identity/snapshots/") &&
				!file.startsWith(".praxity/identity/lessons/"),
		),
	).toEqual(["lesson.prax"]);
	expect(changed.filter((file) => file.startsWith(".praxity/identity/snapshots/"))).toHaveLength(1);
	expect(changed.filter((file) => file.startsWith(".praxity/identity/lessons/"))).toHaveLength(1);
	const updated = await resolveLessonSources(root, {}, { strict: true });
	expect([...updated.lessons.values()].flatMap((lesson) => [...lesson.nodes.keys()])).toEqual(ids);
	expect(updated.identity.sourceMappings.map(({ id, path }) => ({ id, path }))).toEqual(
		original.identity.sourceMappings.map(({ id, path }) => ({ id, path })),
	);
	const hashes = (files: Record<string, string>) =>
		Object.fromEntries(
			Object.entries(files).map(([file, value]) => [
				file,
				createHash("sha256").update(Buffer.from(value, "base64")).digest("hex"),
			]),
		);
	console.info("C03 file hashes", JSON.stringify({ before: hashes(before), after: hashes(after) }));
});

it("C03 refuses another-block disk edit without watcher delivery or identity writes", async () => {
	const { root, service } = await fixture({ "lesson.prax": canvasSource });
	const field = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.kind === "heading",
	);
	if (!field) throw new Error("Missing heading field");
	await writeFile(
		join(root, "lesson.prax"),
		canvasSource.replace("A separate paragraph.", "An outside paragraph."),
	);
	const before = await bytes(root);
	expect(await service.canvasTextApply(canvasInput(field))).toMatchObject({
		ok: false,
		code: "stale",
	});
	expect(await bytes(root)).toEqual(before);
});

it.each(["service", "RPC"])(
	"C03 %s refuses forged canvas operations and fields with zero writes",
	async (transport) => {
		const { root, service } = await fixture({ "lesson.prax": canvasSource });
		const session =
			transport === "RPC" ? await createStudioProjectSession(root, "test") : undefined;
		if (session) sessions.push(session);
		const invoke = (args: unknown) =>
			session ? session.invoke("canvasTextApply", args) : service.canvasTextApply(args);
		const field = (await service.canvasTextSnapshot()).fields.find(
			(field) => field.kind === "heading",
		);
		if (!field) throw new Error("Missing heading field");
		const input = canvasInput(field);
		const { baseRevision: _hash, ...withoutHash } = input;
		const { nodeId: _node, ...withoutNode } = input;
		const { transactionId: _transaction, ...withoutTransaction } = input;
		const { field: _field, ...withoutField } = input;
		const { text: _text, ...withoutText } = input;
		const cases = [
			...["replaceBlock", "editSource", "deleteBlocks", "insertPage", "moveBlocks"].map(
				(operation) => ({ ...input, operation }),
			),
			...["text", "alt", "value", "constructor", "__proto__"].map((field) => ({ ...input, field })),
			...[
				"",
				"  ",
				"New\nline",
				"New\rline",
				"New\r\nline",
				"New\u2028line",
				"New\u2029line",
				"Title {level=1}",
				"Title {hideTitle}",
			].map((text) => ({ ...input, text })),
			{ ...input, targets: [field, field] },
			{ ...input, files: [field, field] },
			{ ...input, baseRevision: "0".repeat(64) },
			{ ...input, baseRevision: "bad" },
			{ ...input, transactionId: "" },
			{ ...input, field: "" },
			{ ...input, text: null },
			{ ...input, text: 3 },
			withoutHash,
			withoutNode,
			withoutTransaction,
			withoutField,
			withoutText,
			{ ...input, nodeId: randomUUID() },
			{ ...input, file: "../outside.prax" },
		];
		const before = await bytes(root);
		for (const forged of cases) {
			expect(await invoke(forged), JSON.stringify(forged)).toMatchObject({ ok: false });
			expect(await bytes(root)).toEqual(before);
		}
	},
);

it("C03 maps generated page-title RPC saves to the owning page subject", async () => {
	const { root, service } = await fixture({ "lesson.prax": canvasSource });
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const snapshot = (await session.invoke("canvasTextSnapshot", {})) as Awaited<
		ReturnType<OperationService["canvasTextSnapshot"]>
	>;
	const field = snapshot.fields.find((field) => field.kind === "page");
	if (!field) throw new Error("Missing page-title field");
	const original = await resolveLessonSources(root);
	const lesson = original.lessons.get("lesson.prax");
	expect(lesson?.nodes.get(field.nodeId)).toMatchObject({ role: "title", node: { kind: "page" } });
	expect(field.nodeId).not.toBe(field.ownerId);
	const ids = [...(lesson?.nodes.keys() ?? [])];
	const result = await session.invoke("canvasTextApply", canvasInput(field, "Emergency response"));
	expect(result, JSON.stringify(result)).toMatchObject({
		ok: true,
	});
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"\uFEFF# Emergency response {style=none}\r\n\r\n## Keep *clear* {level=3}\r\n\r\nA separate paragraph.\r\n",
	);
	expect([
		...((await resolveLessonSources(root)).lessons.get("lesson.prax")?.nodes.keys() ?? []),
	]).toEqual(ids);
	expect(
		(await resolveLessonSources(root)).identity.sourceMappings.map(({ id, path }) => ({
			id,
			path,
		})),
	).toEqual(original.identity.sourceMappings.map(({ id, path }) => ({ id, path })));
	expect(
		(await service.canvasTextSnapshot()).fields.find((candidate) => candidate.kind === "page")
			?.nodeId,
	).toBe(field.nodeId);
});

it("C03 refuses non-heading nodes and ambiguous unstored source mappings", async () => {
	const { root, service } = await fixture({
		"lesson.prax": "# Safety\n\n## Same\n\n## Same\n\nText.\n",
	});
	const current = await resolveLessonSources(root);
	const body = [...current.lessons.values()]
		.flatMap((lesson) => [...lesson.nodes.values()])
		.find((record) => record.node.kind === "body");
	if (!body) throw new Error("Missing body");
	const field = (await service.canvasTextSnapshot()).fields[0];
	if (!field) throw new Error("Missing title");
	const before = await bytes(root);
	expect(await service.canvasTextApply({ ...canvasInput(field), nodeId: body.id })).toMatchObject({
		ok: false,
	});
	expect(await bytes(root)).toEqual(before);
	const bare = await mkdtemp(join(tmpdir(), "canvas-bare-"));
	roots.push(bare);
	await writeFile(join(bare, "course.yaml"), "title: Test\nlessons: [lesson.prax]\n");
	await writeFile(join(bare, "lesson.prax"), "# Safety\n\n## Same\n\n## Same\n");
	const bareService = new OperationService(bare);
	const ambiguous = (await bareService.canvasTextSnapshot()).fields.find(
		(field) => field.kind === "heading",
	);
	if (!ambiguous) throw new Error("Missing runtime heading");
	const bareBefore = await bytes(bare);
	expect(await bareService.canvasTextApply(canvasInput(ambiguous))).toMatchObject({
		ok: false,
		code: "ambiguous",
	});
	expect(await bytes(bare)).toEqual(bareBefore);
});

it.each(
	["stored LF", "stored BOM CRLF", "unstored", "empty"].flatMap((start) =>
		[1701, 42, 20261016].map((seed) => ({ start, seed })),
	),
)(
	"C03 generated histories follow the whole-file reference model from $start seed $seed",
	async ({ start, seed }) => {
		const initial =
			start === "empty"
				? ""
				: start === "stored BOM CRLF"
					? "\uFEFF# Safety\r\n\r\n## Heading\r\n\r\nOutside 0. Keep the exit clear so colleagues can reach the emergency door safely.\r\n"
					: "# Safety\n\n## Heading\n\nOutside 0. Keep the exit clear so colleagues can reach the emergency door safely.\n";
		const root = await mkdtemp(join(tmpdir(), "canvas-model-"));
		roots.push(root);
		await writeFile(join(root, "course.yaml"), "title: Test\nlessons: [lesson.prax]\n");
		await writeFile(join(root, "lesson.prax"), initial);
		if (start.startsWith("stored")) await persistFixtureIdentity(root);
		const service = new OperationService(root);
		let model = initial;
		const capture = async () => {
			const snapshot = await service.canvasTextSnapshot();
			expect(snapshot.fields.map((field) => field.kind).sort()).toEqual(
				model ? ["body", "heading", "page"] : [],
			);
			for (const field of snapshot.fields) expect(field.baseRevision).toBe(digest(model));
			return snapshot;
		};
		let captured = await capture();
		let state = seed;
		const random = () => {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			return state;
		};
		const prefix = [0, 1, 2, 0, 3, 2, 0, 1, 2];
		for (let step = 0; step < 16; step++) {
			const action = prefix[step] ?? (random() >>> 16) % 4;
			if (action === 0) captured = await capture();
			else if (action === 1) {
				const outsideId = (await service.canvasTextSnapshot()).fields.find(
					(field) => field.kind === "body",
				)?.nodeId;
				model =
					model === ""
						? "# Safety\n\n## Heading\n\nOutside 1. Keep the exit clear so colleagues can reach the emergency door safely.\n"
						: model.replace(/Outside \d+\./u, `Outside ${step + 1}.`);
				await writeFile(join(root, "lesson.prax"), model);
				if (outsideId)
					expect(
						(await service.canvasTextSnapshot()).fields.find((field) => field.kind === "body")
							?.nodeId,
					).toBe(outsideId);
			} else {
				const field = captured.fields.find((field) => field.kind === "heading");
				const text = `Saved ${step}`;
				const hash = field?.baseRevision ?? digest(initial);
				const expectedApply = Boolean(field) && hash === digest(model) && action !== 3;
				const before = await bytes(root);
				const result = await service.canvasTextApply({
					...canvasInput(
						field ?? { file: "lesson.prax", nodeId: "missing", baseRevision: hash, text: "" },
						text,
					),
					operation: action === 3 ? "editSource" : "setText",
				});
				expect(
					result.ok,
					`${start}, step ${step}, action ${action}, ${JSON.stringify(result)}`,
				).toBe(expectedApply);
				if (expectedApply) model = model.replace(/(?<=## )(?:Heading|Saved \d+)/u, text);
				else expect(await bytes(root)).toEqual(before);
				expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(model);
			}
		}
	},
);

it("C05-r1 scopes canvas snapshots and writes to the served page, across and within lessons", async () => {
	const { root, service } = await fixture({
		"lesson.prax":
			"---\ntitle: Scoped pages\n---\n\n# Alpha\n\n## Alpha heading\n\n# Beta\n\n## Beta heading\n",
		"other.prax": "# Gamma\n\n## Gamma heading\n",
	});
	const all = await service.canvasTextSnapshot();
	const alpha = all.fields.find((field) => field.text === "Alpha");
	if (!alpha) throw new Error("Missing page title");
	const scoped = await service.canvasTextSnapshot(alpha);
	expect(scoped.fields.map((field) => field.text)).toEqual(["Alpha", "Alpha heading"]);
	const before = await bytes(root);
	for (const text of ["Beta heading", "Gamma heading"]) {
		const other = all.fields.find((field) => field.text === text);
		if (!other) throw new Error("Missing other heading");
		expect(await service.canvasTextApply(canvasInput(other, "Forbidden"), alpha)).toMatchObject({
			ok: false,
			code: "not-allowed",
		});
		expect(await bytes(root)).toEqual(before);
	}
	expect(await service.canvasTextApply(canvasInput(alpha, "Alpha saved"), alpha)).toMatchObject({
		ok: true,
	});
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"---\ntitle: Scoped pages\n---\n\n# Alpha saved\n\n## Alpha heading\n\n# Beta\n\n## Beta heading\n",
	);
});

it("admits every slide in a captured deck lesson and refuses another lesson", async () => {
	const { root, service } = await fixture({
		"lesson.prax": "# Alpha\n\n## Alpha heading\n\n# Beta\n\n## Beta heading\n",
		"other.prax": "# Gamma\n\n## Gamma heading\n",
	});
	const all = await service.canvasTextSnapshot();
	const alpha = all.fields.find((field) => field.text === "Alpha");
	const beta = all.fields.find((field) => field.text === "Beta heading");
	const gamma = all.fields.find((field) => field.text === "Gamma heading");
	if (!alpha || !beta || !gamma) throw new Error("Missing fixture heading");
	const scope = { ...alpha, allLessonPages: true };
	expect((await service.canvasTextSnapshot(scope)).fields.map((field) => field.text)).toEqual([
		"Alpha",
		"Alpha heading",
		"Beta",
		"Beta heading",
	]);
	const before = await bytes(root);
	expect(await service.canvasTextApply(canvasInput(gamma, "Forbidden"), scope)).toMatchObject({
		ok: false,
		code: "not-allowed",
	});
	expect(await bytes(root)).toEqual(before);
	expect(await service.canvasTextApply(canvasInput(beta, "Beta saved"), scope)).toMatchObject({
		ok: true,
	});
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"# Alpha\n\n## Alpha heading\n\n# Beta\n\n## Beta saved\n",
	);
	const stale = await bytes(root);
	expect(await service.canvasTextApply(canvasInput(alpha, "Must refuse"), scope)).toMatchObject({
		ok: false,
		code: "stale",
	});
	expect(await bytes(root)).toEqual(stale);
});

it("C05-r1 captured page identity survives an agent inserting an earlier page", async () => {
	const initial = "# Alpha\n\n## Alpha heading\n";
	const { root, service } = await fixture({ "lesson.prax": initial });
	const alpha = (await service.canvasTextSnapshot()).fields.find((field) => field.text === "Alpha");
	if (!alpha) throw new Error("Missing Alpha page");
	await writeFile(join(root, "lesson.prax"), "# Inserted\n\nInserted body.\n\n" + initial);
	const before = await bytes(root);
	const current = await service.canvasTextSnapshot(alpha);
	expect(current.fields.map((field) => field.text)).toEqual(["Alpha", "Alpha heading"]);
	expect(
		await service.canvasTextApply(canvasInput(alpha, "Must refuse old revision"), alpha),
	).toMatchObject({ ok: false, code: "stale" });
	expect(await bytes(root)).toEqual(before);
	const fresh = current.fields.find((field) => field.text === "Alpha heading");
	if (!fresh) throw new Error("Missing current Alpha heading");
	expect(await service.canvasTextApply(canvasInput(fresh, "Alpha saved"), alpha)).toMatchObject({
		ok: true,
	});
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"# Inserted\n\nInserted body.\n\n# Alpha\n\n## Alpha saved\n",
	);
});

const projectedChoiceSource =
	"# P\n::: choice ==Pick== {scored}\nRead first.\n$$\nx^2\n$$\nThen @source{N} more.\n(x) Yes\n( ) No\n:::\n";
const compilerMetadata = /_inlineTrees|referenceTrivia|generatedBy/;

it("keeps compile-only choice trees out of narration and editor RPC payloads", async () => {
	const { root, service } = await fixture({ "lesson.prax": projectedChoiceSource });
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const narration = (await session.invoke("narrationAuthoringRead", {
		filename: "lesson.prax",
	})) as {
		document: Awaited<ReturnType<typeof readNarrationAuthoring>>["documents"][number];
	};
	expect(
		narration.document.pages.some((page) =>
			page.blocks.some((block) => block.type === "assessment"),
		),
	).toBe(true);
	expect(JSON.stringify(narration)).not.toMatch(compilerMetadata);
	for (const method of ["editorSnapshot", "canvasTextSnapshot", "courseReadLesson", "courseLoad"]) {
		const args =
			method === "courseReadLesson"
				? { courseDir: root, filename: "lesson.prax" }
				: method === "courseLoad"
					? { courseDir: root }
					: {};
		expect(JSON.stringify(await session.invoke(method, args)), method).not.toMatch(
			compilerMetadata,
		);
	}
	expect(JSON.stringify(await service.canvasTextSnapshot())).not.toMatch(compilerMetadata);
});

it("keeps compile-only choice trees out of recorded-operation evidence and undo snapshots", async () => {
	const { root, service } = await fixture({ "lesson.prax": projectedChoiceSource });
	const current = await resolveLessonSources(root);
	const field = (await service.canvasTextSnapshot()).fields.find((field) => field.text === "Yes");
	const mapping = current.identity.sourceMappings.find((mapping) => mapping.id === field?.nodeId);
	if (!field || !mapping) throw new Error("Missing choice option");
	const planned = applyOperation(
		[{ path: "lesson.prax", source: projectedChoiceSource }],
		{
			transactionId: randomUUID(),
			operation: "setText",
			files: [{ path: "lesson.prax", baseRevision: digest(projectedChoiceSource) }],
			targets: [
				{
					file: "lesson.prax",
					ref: {
						kind: "node",
						nodeId: mapping.id,
						path: mapping.path,
						fingerprint: mapping.fingerprint,
					},
					expectedText: projectedChoiceSource.slice(mapping.span.start, mapping.span.end),
				},
			],
			args: { field: "text", text: "Yep" },
		},
		{ identity: current.identity, readerRoles: true, allocateId: randomUUID, digest },
	);
	expect(planned).toMatchObject({ ok: true });
	if (!planned.ok) throw new Error("Expected choice operation");
	expect(planned.evidence.length).toBeGreaterThan(0);
	expect(planned.history.before[0].source).toBe(projectedChoiceSource);
	expect(planned.history.after[0].source).toContain("(x) Yep");
	expect(JSON.stringify(planned)).not.toMatch(compilerMetadata);
});

it("keeps compile-only choice trees out of journal bytes, sidecars and committed undo", async () => {
	const { root, service } = await fixture({ "lesson.prax": projectedChoiceSource });
	const narration = await readNarrationAuthoring(root);
	const document = narration.documents[0];
	const segment = document.items.find(({ segment }) => segment.script.includes("Pick"))?.segment;
	if (!segment) throw new Error("Missing choice narration");
	narration.sidecar.lessons[document.lessonId] = {
		segments: [
			{
				target: segment.target,
				reviewedRevision: segment.revision,
				script: "Recorded choice prompt.",
			},
		],
	};
	await writeNarrationAuthoring(root, narration.sidecar, narration.source);
	const field = (await service.canvasTextSnapshot()).fields.find((field) => field.text === "Yes");
	if (!field) throw new Error("Missing choice option");
	faults.cleanup = true;
	const applied = await service.canvasTextApply({ ...canvasInput(field, "Yep"), field: "text" });
	if (!applied.ok) throw new Error(`Choice operation refused: ${applied.code}`);
	expect(applied.writeResult.cleanupError).toContain("Injected journal cleanup failure");
	expect(JSON.stringify(applied)).not.toMatch(compilerMetadata);
	const disk = await bytes(root);
	const journalBytes = disk[".praxity-transaction.json"];
	if (!journalBytes) throw new Error("Expected retained journal");
	const journal = JSON.parse(Buffer.from(journalBytes, "base64").toString("utf8")) as {
		plan: { files: { from: string | null; to: string | null }[] };
	};
	for (const file of journal.plan.files)
		for (const encoded of [file.from, file.to])
			expect(Buffer.from(encoded ?? "", "base64").toString("utf8")).not.toMatch(compilerMetadata);
	for (const [path, encoded] of Object.entries(disk))
		expect(Buffer.from(encoded, "base64").toString("utf8"), path).not.toMatch(compilerMetadata);
	for (const direction of ["undo", "redo"] as const) {
		const result = await service.historyApply({
			transactionId: randomUUID(),
			historyId: applied.historyId,
			direction,
		});
		expect(result).toMatchObject({ ok: true });
		expect(JSON.stringify(result)).not.toMatch(compilerMetadata);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			direction === "undo"
				? projectedChoiceSource
				: projectedChoiceSource.replace("(x) Yes", "(x) Yep"),
		);
	}
	for (const [path, encoded] of Object.entries(await bytes(root)))
		expect(Buffer.from(encoded, "base64").toString("utf8"), path).not.toMatch(compilerMetadata);
});
