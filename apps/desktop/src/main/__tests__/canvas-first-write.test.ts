import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { serializeIdentity } from "@praxity/content-identity";
import { afterEach, expect, it, vi } from "vitest";
import { persistFixtureIdentity, writeIdentityFixture } from "../../test-utils/identity-fixture";
import { CourseIdentitySession } from "../identity-store";
import { resolveLessonSources, resolveLessonSourcesForWrite } from "../lesson-source";
import { OperationService } from "../operations/operation-service";
import { createStudioProjectSession } from "../studio/project-session";

vi.mock("node:fs", async (importOriginal) => {
	const { admissionNativeFilesystem } = await import("../../test-utils/admission-filesystem");
	return admissionNativeFilesystem(await importOriginal<typeof import("node:fs")>());
});

vi.mock("node:fs/promises", async (importOriginal) => {
	const { admissionFilesystem } = await import("../../test-utils/admission-filesystem");
	return admissionFilesystem(
		await importOriginal<typeof import("node:fs/promises")>(),
		await vi.importActual<typeof import("node:fs")>("node:fs"),
	);
});

const watchers = vi.hoisted(() => [] as import("node:events").EventEmitter[]);
// Admission is tested before and after explicit watcher delivery, never against its timer.
vi.mock("chokidar", async () => {
	const { EventEmitter } = await import("node:events");
	return {
		watch: () => {
			const watcher = new EventEmitter();
			watchers.push(watcher);
			queueMicrotask(() => watcher.emit("ready"));
			return Object.assign(watcher, {
				close: async () => {
					watcher.removeAllListeners();
				},
			});
		},
	};
});

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
	watchers.length = 0;
});
const a = "# First page\n\n## Same heading\n\nBody A.\n\n# Later page\n\n## Later heading\n";
const b = "\uFEFF# Other lesson\r\n\r\n## Same heading\r\n\r\nBody B.";
type Snapshot = Awaited<ReturnType<OperationService["canvasTextSnapshot"]>>;
type Field = Snapshot["fields"][number];
function request(field: Field, text = "Held exact *text*") {
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

it("C05f a held field and a fresh field both save after attempted retired-token reuse", async () => {
	const { root } = await fixture(false, false);
	const original = "# Page\n\n## Same heading\n\nBody.\n";
	await writeFile(join(root, "a.prax"), original);
	const third = "# Third page\n\nThird body.\n";
	await writeFile(join(root, "c.prax"), third);
	await writeFile(
		join(root, "course.yaml"),
		"title: First write\nlessons: [a.prax, b.prax, c.prax]\n",
	);
	let next = 0;
	let reuse: string | undefined;
	const identity = new CourseIdentitySession(root, {
		allocateRuntimeId: () => {
			const id = reuse ?? `rt-${(++next).toString(16).padStart(32, "0")}`;
			reuse = undefined;
			return id;
		},
	});
	const service = new OperationService(root, identity);
	const initial = await service.canvasTextSnapshot();
	const first = initial.fields.find((f) => f.file === "b.prax" && f.kind === "heading");
	const held = initial.fields.find((f) => f.file === "a.prax" && f.kind === "heading");
	if (!first || !held) throw new Error("Missing headings");
	expect(await service.canvasTextApply(request(first, "Saved B"), first)).toMatchObject({
		ok: true,
	});
	await service.canvasTextSnapshot();
	const appended = `${third}\n## Fresh heading\n`;
	await writeFile(join(root, "c.prax"), appended);
	reuse = held.nodeId;
	const fresh = (await service.canvasTextSnapshot()).fields.find((f) => f.text === "Fresh heading");
	if (!fresh) throw new Error("Missing fresh heading");
	expect(fresh.nodeId).not.toBe(held.nodeId);
	expect(await service.canvasTextApply(request(fresh, "Fresh saved"), fresh)).toMatchObject({
		ok: true,
	});
	expect(await service.canvasTextApply(request(held, "Held A"), held)).toMatchObject({ ok: true });
	expect(await readFile(join(root, "c.prax"), "utf8")).toBe(
		appended.replace("Fresh heading", "Fresh saved"),
	);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe(
		original.replace("Same heading", "Held A"),
	);
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe(b.replace("Same heading", "Saved B"));
});

it("C05f a deleted held field cannot target a new field after attempted alias reuse", async () => {
	const { root } = await fixture(false, false);
	const original = "# Page\n\n## Same heading\n\nBody.\n";
	await writeFile(join(root, "a.prax"), original);
	let next = 0;
	let reuse: string | undefined;
	const identity = new CourseIdentitySession(root, {
		allocateRuntimeId: () => {
			const id = reuse ?? `rt-${(++next).toString(16).padStart(32, "0")}`;
			reuse = undefined;
			return id;
		},
	});
	const service = new OperationService(root, identity);
	const initial = await service.canvasTextSnapshot();
	const held = initial.fields.find((f) => f.file === "a.prax" && f.kind === "heading");
	const first = initial.fields.find((f) => f.file === "b.prax" && f.kind === "heading");
	if (!held || !first) throw new Error("Missing headings");
	expect(await service.canvasTextApply(request(first, "Saved B"), first)).toMatchObject({
		ok: true,
	});
	const current = await resolveLessonSources(root);
	const heading = current.identity.sourceMappings.find(
		(node) => node.file === "a.prax" && node.path.join() === "0,0",
	);
	if (!heading) throw new Error("Missing heading to delete");
	expect(
		await service.apply({
			transactionId: randomUUID(),
			operation: "deleteBlocks",
			files: [
				{ path: "a.prax", baseRevision: createHash("sha256").update(original).digest("hex") },
			],
			targets: [
				{
					file: "a.prax",
					ref: {
						kind: "node",
						nodeId: heading.id,
						path: heading.path,
						fingerprint: heading.fingerprint,
					},
					expectedText: original.slice(heading.span.start, heading.span.end),
				},
			],
			args: {},
		}),
	).toMatchObject({ ok: true });
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("# Page\n\nBody.\n");
	const other = (await service.canvasTextSnapshot()).fields.find(
		(f) => f.file === "b.prax" && f.kind === "heading",
	);
	if (!other) throw new Error("Missing other heading");
	expect(await service.canvasTextApply(request(other, "Saved B again"), other)).toMatchObject({
		ok: true,
	});
	await writeFile(join(root, "a.prax"), original);
	reuse = held.nodeId;
	await service.canvasTextSnapshot();
	const before = await bytes(root);
	expect(await service.canvasTextApply(request(held, "Wrong new field"), held)).toMatchObject({
		ok: false,
		code: "orphaned",
	});
	expect(await bytes(root)).toEqual(before);
});

it("C05f a removed captured middle page cannot admit its promoted neighbour", async () => {
	const { root, snapshot, apply } = await fixture(false, false);
	const three = `${a}\n# Last page\n\n## Last heading\n`;
	await writeFile(join(root, "a.prax"), three);
	const initial = await snapshot();
	const first = initial.fields.find((f) => f.file === "b.prax" && f.kind === "heading");
	const middle = initial.fields.find((f) => f.text === "Later heading");
	if (!first || !middle) throw new Error("Missing fields");
	const scope = {
		...middle,
		pageIds: [...new Set(initial.fields.filter((f) => f.file === "a.prax").map((f) => f.pageId))],
	};
	expect(scope.pageIds.every((id) => id.startsWith("rt-"))).toBe(true);
	expect(await apply(request(first, "Promote"), first)).toMatchObject({ ok: true });
	await writeFile(join(root, "a.prax"), three.replace("# Later page\n\n## Later heading\n\n", ""));
	const neighbour = (await snapshot()).fields.find((f) => f.text === "Last heading");
	if (!neighbour) throw new Error("Missing neighbour");
	const before = await bytes(root);
	expect(await apply(request(neighbour), scope)).toMatchObject({ ok: false, code: "not-allowed" });
	expect(await bytes(root)).toEqual(before);
});

it("C05f correspondence never crosses a new course namespace with identical durable node IDs", async () => {
	const { root, snapshot, apply } = await fixture(false, false);
	const initial = await snapshot();
	const first = initial.fields.find((f) => f.file === "a.prax" && f.kind === "heading");
	const held = initial.fields.find((f) => f.file === "b.prax" && f.kind === "heading");
	if (!first || !held) throw new Error("Missing fields");
	expect(await apply(request(first, "Promote"), first)).toMatchObject({ ok: true });
	const replacement = await resolveLessonSourcesForWrite(root);
	replacement.identity.course.courseId = randomUUID();
	for (const saved of replacement.identity.snapshots) {
		const oldHash = createHash("sha256").update(serializeIdentity(saved)).digest("hex");
		const head = replacement.identity.heads.find((head) => head.head === oldHash);
		if (!head) throw new Error("Missing head");
		saved.courseId = replacement.identity.course.courseId;
		saved.parents = [];
		head.head = createHash("sha256").update(serializeIdentity(saved)).digest("hex");
	}
	await rm(join(root, ".praxity/identity"), { recursive: true });
	await writeIdentityFixture(root, replacement);
	const current = await snapshot();
	expect(current.fields.find((f) => f.file === "b.prax" && f.kind === "heading")?.nodeId).not.toBe(
		held.nodeId,
	);
	const before = await bytes(root);
	expect(await apply(request(held), held)).toMatchObject({ ok: false, code: "orphaned" });
	expect(await bytes(root)).toEqual(before);
});

it("C05f captured sibling page IDs survive collection without sibling fields", async () => {
	setFlagsFromString("--expose-gc");
	const collect = runInNewContext("gc") as () => void;
	const { root, identitySession } = await fixture(false, false);
	const service = new OperationService(root, identitySession);
	const three = `${a}\n# Last page\n`;
	await writeFile(join(root, "a.prax"), three);
	const { scope, first } = await (async () => {
		const initial = await service.canvasTextSnapshot();
		const middle = initial.fields.find((f) => f.text === "Later heading");
		const first = initial.fields.find((f) => f.file === "b.prax" && f.kind === "heading");
		if (!middle || !first) throw new Error("Missing headings");
		return {
			scope: {
				...middle,
				pageIds: [
					...new Set(initial.fields.filter((f) => f.file === "a.prax").map((f) => f.pageId)),
				],
			},
			first: request(first, "Promote"),
		};
	})();
	expect(scope.pageIds).toHaveLength(3);
	// Only the middle page has admitted fields; the captured last page has none.
	expect(
		(await service.canvasTextSnapshot(scope)).fields.every((f) => f.pageId === scope.pageId),
	).toBe(true);
	expect(await service.canvasTextApply(first)).toMatchObject({ ok: true });
	await new Promise((resolve) => setImmediate(resolve));
	collect();
	await writeFile(join(root, "a.prax"), three.replace("# Later page\n\n## Later heading\n\n", ""));
	const neighbour = (await service.canvasTextSnapshot()).fields.find((f) => f.text === "Last page");
	if (!neighbour) throw new Error("Missing neighbour");
	const before = await bytes(root);
	expect(await service.canvasTextApply(request(neighbour), scope)).toMatchObject({
		ok: false,
		code: "not-allowed",
	});
	expect(await bytes(root)).toEqual(before);
});

it("C05f a new namespace installs correspondence for its next held field", async () => {
	const { root, snapshot, apply } = await fixture(false, false);
	const first = (await snapshot()).fields.find((f) => f.file === "a.prax" && f.kind === "heading");
	if (!first) throw new Error("Missing first heading");
	expect(await apply(request(first, "Promote"), first)).toMatchObject({ ok: true });
	const replacement = await resolveLessonSourcesForWrite(root);
	replacement.identity.course.courseId = randomUUID();
	for (const saved of replacement.identity.snapshots) {
		const oldHash = createHash("sha256").update(serializeIdentity(saved)).digest("hex");
		const head = replacement.identity.heads.find((head) => head.head === oldHash);
		if (!head) throw new Error("Missing head");
		saved.courseId = replacement.identity.course.courseId;
		saved.parents = [];
		head.head = createHash("sha256").update(serializeIdentity(saved)).digest("hex");
	}
	await rm(join(root, ".praxity/identity"), { recursive: true });
	await writeIdentityFixture(root, replacement);
	const appended = `${b}\r\n\r\n## New namespace heading\r\n`;
	await writeFile(join(root, "b.prax"), appended);
	const current = await snapshot();
	const promote = current.fields.find((f) => f.file === "a.prax" && f.kind === "heading");
	const held = current.fields.find((f) => f.text === "New namespace heading");
	if (!promote || !held) throw new Error("Missing new namespace fields");
	expect(held.nodeId.startsWith("rt-")).toBe(true);
	expect(await apply(request(promote, "New namespace promotion"), promote)).toMatchObject({
		ok: true,
	});
	expect(await apply(request(held, "Held namespace saved"), held)).toMatchObject({ ok: true });
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe(
		appended.replace("New namespace heading", "Held namespace saved"),
	);
});

async function bytes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await bytes(root, path));
		else result[path] = (await readFile(join(root, path))).toString("base64");
	}
	return result;
}
async function fixture(stored: boolean, rpc: boolean) {
	const root = await mkdtemp(join(tmpdir(), "canvas-first-write-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: First write\nlessons: [a.prax, b.prax]\n");
	await writeFile(join(root, "a.prax"), rpc ? a.replace(/##[^\n]*\n(?:\n)?/g, "") : a);
	await writeFile(join(root, "b.prax"), rpc ? b.replace("## Same heading\r\n\r\n", "") : b);
	// canvas-first-write-watch.test.ts covers opening without identity; seed this RPC setup.
	if (stored || rpc) await persistFixtureIdentity(root);
	const session = rpc ? await createStudioProjectSession(root, "test") : undefined;
	// Studio opens existing courses before the agent supplies these unpersisted nodes.
	if (rpc) {
		const bodies = (current: Awaited<ReturnType<typeof resolveLessonSources>>) =>
			[...current.lessons].flatMap(([file, lesson]) =>
				[...lesson.nodes.values()]
					.filter((record) => record.node.kind === "body")
					.map((record) => [file, record.id]),
			);
		const before = bodies(await resolveLessonSources(root));
		await writeFile(join(root, "a.prax"), a);
		await writeFile(join(root, "b.prax"), b);
		expect(bodies(await resolveLessonSources(root))).toEqual(before);
		if (stored) await persistFixtureIdentity(root);
	}
	const identitySession = new CourseIdentitySession(root);
	const service = new OperationService(root, identitySession);
	const snapshot = async () =>
		(session
			? await session.invoke("canvasTextSnapshot", {})
			: await service.canvasTextSnapshot()) as Snapshot;
	const apply = (input: ReturnType<typeof request>, scope?: Field) =>
		session
			? session.invoke("canvasTextApply", input, scope)
			: service.canvasTextApply(input, scope);
	return {
		root,
		session,
		snapshot,
		apply,
		identitySession,
		watcher: rpc ? watchers.at(-1) : undefined,
	};
}

it("C05f revoked identity evidence cannot admit an old runtime locator by its unchanged text", async () => {
	const { root, snapshot, apply, identitySession } = await fixture(false, false);
	const initial = await snapshot();
	const first = initial.fields.find((f) => f.file === "a.prax" && f.kind === "heading");
	const held = initial.fields.find((f) => f.file === "b.prax" && f.kind === "heading");
	if (!first || !held) throw new Error("Missing fields");
	expect(await apply(request(first, "Saved 0"), first)).toMatchObject({ ok: true });
	identitySession.invalidate();
	const before = await bytes(root);
	expect(await apply(request(held))).toMatchObject({ ok: false, code: "orphaned" });
	expect(await bytes(root)).toEqual(before);
	const fresh = (await snapshot()).fields.find((f) => f.file === "b.prax" && f.kind === "heading");
	if (!fresh) throw new Error("Missing current field");
	expect(await apply(request(fresh), fresh)).toMatchObject({ ok: true });
});

for (const rpc of [false, true])
	for (const stored of [false, true]) {
		for (const first of ["a.prax", "b.prax"]) {
			it(`C05f held fields survive promotion: rpc=${rpc} stored=${stored} first=${first}`, async () => {
				const { root, session, snapshot, apply } = await fixture(stored, rpc);
				try {
					const initial = await snapshot();
					const fields = ["a.prax", "b.prax"].map((file) => {
						const field = initial.fields.find((f) => f.file === file && f.kind === "heading");
						if (!field) throw new Error("Missing heading");
						return field;
					});
					fields.sort((left) => (left.file === first ? -1 : 1));
					const ids = new Map(initial.fields.map((f) => [f.nodeId, f.nodeId]));
					let expectedA = a;
					let expectedB = b;
					for (const [index, field] of fields.entries()) {
						const text = index === 0 ? "Saved 0" : "Held exact *text*";
						const result = await apply(request(field, text), field);
						expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
						if (typeof result !== "object" || !result || !("correspondence" in result))
							throw new Error("Missing correspondence");
						for (const pair of result.correspondence as { runtimeId: string; durableId: string }[])
							ids.set(pair.runtimeId, pair.durableId);
						if (field.file === "a.prax") expectedA = a.replace("## Same heading", `## ${text}`);
						else expectedB = b.replace("## Same heading", `## ${text}`);
						expect(await readFile(join(root, "a.prax"), "utf8")).toBe(expectedA);
						expect(await readFile(join(root, "b.prax"), "utf8")).toBe(expectedB);
						const current = await snapshot();
						expect(current.fields.map((f) => f.nodeId)).toEqual(
							initial.fields.map((f) => ids.get(f.nodeId)),
						);
					}
				} finally {
					await session?.close();
				}
			});
		}
	}

for (const change of [
	"body",
	"field",
	"field-unlink-echo",
	"deleted",
	"forged-id",
	"cross-page",
	"cross-lesson",
	"expected-text",
] as const) {
	it(`C05f promotion retains ${change} refusal and zero writes`, async () => {
		const { root, session, snapshot, apply, watcher } = await fixture(false, true);
		try {
			const initial = await snapshot();
			const first = initial.fields.find((f) => f.file === "a.prax" && f.kind === "heading");
			const held = initial.fields.find((f) => f.file === "b.prax" && f.kind === "heading");
			const foreign = initial.fields.find(
				(f) => f.file === "a.prax" && f.pageIndex === 1 && f.kind === "heading",
			);
			if (!first || !held || !foreign) throw new Error("Missing fields");
			expect(await apply(request(first, "Saved 0"), first)).toMatchObject({ ok: true });
			if (change === "body")
				await writeFile(join(root, "b.prax"), b.replace("Body B.", "Outside body."));
			if (change === "field" || change === "field-unlink-echo") {
				const outside = new OperationService(root);
				const field = (await outside.canvasTextSnapshot()).fields.find(
					(f) => f.file === "b.prax" && f.kind === "heading",
				);
				if (!field) throw new Error("Missing outside field");
				expect(await outside.canvasTextApply(request(field, "Outside heading"))).toMatchObject({
					ok: true,
				});
			}
			if (change === "field-unlink-echo") {
				if (!session || !watcher) throw new Error("Missing watcher fixture");
				const delivered = new Promise<void>((resolve, reject) => {
					const unsubscribe = session.subscribe((event) => {
						if (event.type === "error") {
							unsubscribe();
							reject(new Error(event.message));
						}
						if (event.type === "treeChanged") {
							unsubscribe();
							resolve();
						}
					});
				});
				// A replacement's unlink echo still leaves a changed field, so it must be stale.
				watcher.emit("all", "unlink", join(root, "b.prax"));
				await delivered;
			}
			if (change === "deleted")
				await writeFile(join(root, "b.prax"), "\uFEFF# Other lesson\r\n\r\nBody B.");
			const before = await bytes(root);
			const input = request(change === "cross-page" ? foreign : held);
			if (change === "forged-id") input.nodeId = first.nodeId;
			if (change === "expected-text") input.expectedText = "Forged baseline";
			// Fresh file hash isolates scope checks from the earlier save's revision change.
			if (change === "cross-page")
				input.baseRevision = (await snapshot()).sourceRevisions["a.prax"];
			expect(
				await apply(input, change === "cross-page" || change === "cross-lesson" ? first : held),
			).toMatchObject({
				ok: false,
				code:
					change === "deleted" || change === "forged-id"
						? "orphaned"
						: change.startsWith("cross-")
							? "not-allowed"
							: "stale",
			});
			expect(await bytes(root)).toEqual(before);
		} finally {
			await session?.close();
		}
	});
}
