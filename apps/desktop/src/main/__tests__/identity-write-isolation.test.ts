import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	initializeCourseIdentity,
	loadIdentityStore,
	persistCourseIdentity,
	resolveCourseIdentity,
} from "../identity-store";
import { resolveLessonSources, writeLessonSource } from "../lesson-source";
import { editManifest } from "../operations/manifest-editor";
import { OperationService } from "../operations/operation-service";
import { withProjectFileTransaction } from "../project-file-transactions";
import { createStudioProjectSession, type StudioEvent } from "../studio/project-session";

const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof createStudioProjectSession>>[] = [];
const good = "# Good\n\n## Heading\n\nSaved body.\n";
const bad = "# Other\n\n::: note\nUnclosed.\n";
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

it.each([
	[bad, "source-invalid"],
	["---\ntitle: [\n---\n\n# Other\n", "bad-yaml"],
])("an invalid target lesson refuses a recorded edit as %s", async (source, code) => {
	const root = await fixture();
	const service = new OperationService(root);
	const heading = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.text === "Other",
	);
	if (!heading) throw new Error("Missing other title");
	await writeFile(join(root, "bad.prax"), source);
	const original = await bytes(root);
	expect(
		await service.apply({
			transactionId: randomUUID(),
			operation: "setText",
			files: [{ path: "bad.prax", baseRevision: heading.baseRevision }],
			targets: [
				{
					file: "bad.prax",
					ref: { kind: "node", nodeId: heading.ownerId, path: [0], fingerprint: "0".repeat(64) },
					expectedText: "# Other\n",
				},
			],
			args: { text: "New title", field: heading.field },
		}),
	).toMatchObject({ ok: false, code, file: "bad.prax" });
	expect(await bytes(root)).toEqual(original);
});

it("an invalid unsaved lesson receives no identity during a valid save", async () => {
	const root = await mkdtemp(join(tmpdir(), "identity-write-isolation-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [good.prax, bad.prax]\n");
	await writeFile(join(root, "good.prax"), good);
	await writeFile(join(root, "bad.prax"), bad);
	await writeLessonSource(root, "good.prax", `${good}\nAddition.\n`, good);
	const store = await loadIdentityStore(root);
	expect(store.heads.map((head) => head.path)).toEqual(["good.prax"]);
	expect(store.snapshots).toHaveLength(1);
	expect(await readFile(join(root, "bad.prax"), "utf8")).toBe(bad);
});

it("a recorded invalid save keeps stored identity and a retiring repair refuses", async () => {
	const root = await fixture();
	const source = "# Good\n\n::: note\nSaved note body.\n:::\n";
	await writeFile(join(root, "good.prax"), source);
	await initializeCourseIdentity(root, ["good.prax", "bad.prax"], { rederive: true });
	const current = await resolveLessonSources(root);
	const note = current.identity.sourceMappings.find(
		(node) => node.file === "good.prax" && node.path.join() === "0,0",
	);
	if (!note) throw new Error("Missing note");
	const original = await bytes(root);
	const service = new OperationService(root);
	expect(
		await service.apply({
			transactionId: randomUUID(),
			operation: "editSource",
			files: [
				{ path: "good.prax", baseRevision: createHash("sha256").update(source).digest("hex") },
			],
			targets: [
				{
					file: "good.prax",
					ref: { kind: "node", nodeId: note.id, path: note.path, fingerprint: note.fingerprint },
					expectedText: source.slice(note.span.start, note.span.end),
				},
			],
			args: { text: "::: no-such-type\nSaved note body.\n" },
		}),
	).toMatchObject({ ok: true });
	const invalid = await readFile(join(root, "good.prax"), "utf8");
	expect(invalid).toContain("::: no-such-type");
	await withProjectFileTransaction(root, async () => {}, "write");
	const after = await bytes(root);
	expect(
		Object.fromEntries(
			Object.entries(after).filter(([path]) => path.startsWith(".praxity/identity/")),
		),
	).toEqual(
		Object.fromEntries(
			Object.entries(original).filter(([path]) => path.startsWith(".praxity/identity/")),
		),
	);
	await expect(
		writeLessonSource(root, "good.prax", "# Good\n\n::: note\nReplacement body.\n:::\n", invalid),
	).rejects.toMatchObject({
		retirements: [
			expect.objectContaining({ file: "good.prax", page: "Good", label: "note", line: null }),
			expect.objectContaining({
				file: "good.prax",
				page: "Good",
				label: "Saved note body.",
				line: null,
			}),
		],
	});
	expect(await bytes(root)).toEqual(after);
});

it("a real watcher returns an outside-retirement refusal without an error event or writes", async () => {
	const root = await fixture();
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	const snapshot = (await session.invoke("canvasTextSnapshot", {})) as Awaited<
		ReturnType<OperationService["canvasTextSnapshot"]>
	>;
	const heading = snapshot.fields.find((field) => field.text === "Heading");
	if (!heading) throw new Error("Missing heading");
	await writeFile(join(root, "bad.prax"), "# Other\n");
	await vi.waitFor(() =>
		expect(
			events.some((event) => event.type === "grammarChanged" && event.filename === "bad.prax"),
		).toBe(true),
	);
	const original = await bytes(root);
	expect(
		await session.invoke("canvasTextApply", {
			transactionId: randomUUID(),
			operation: "setText",
			file: heading.file,
			nodeId: heading.nodeId,
			baseRevision: heading.baseRevision,
			expectedText: heading.text,
			field: heading.field,
			text: "Saved heading",
		}),
	).toMatchObject({
		ok: false,
		code: "identity-retirement-pending",
		reviewUrl: "/launch",
		retirements: [{ file: "bad.prax", page: "Other", label: "Saved other body.", line: null }],
	});
	expect(events.filter((event) => event.type === "error")).toEqual([]);
	expect(await bytes(root)).toEqual(original);
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
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "identity-write-isolation-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [good.prax, bad.prax]\n");
	await writeFile(join(root, "good.prax"), good);
	await writeFile(join(root, "bad.prax"), "# Other\n\nSaved other body.\n");
	await initializeCourseIdentity(root, ["good.prax", "bad.prax"]);
	return root;
}

it("a valid lesson save leaves an invalid lesson's stored identity exactly untouched", async () => {
	const root = await fixture();
	const prior = await loadIdentityStore(root);
	const head = prior.heads.find((head) => head.path === "bad.prax");
	if (!head) throw new Error("Missing saved other head");
	const snapshot = prior.snapshots.find((snapshot) =>
		Object.values(snapshot.nodes).some((node) => node.kind === "page" && node.label === "Other"),
	);
	await writeFile(join(root, "bad.prax"), bad);
	const original = await bytes(root);
	await writeLessonSource(root, "good.prax", `${good}\nAn added paragraph.\n`, good);
	expect(await readFile(join(root, "bad.prax"), "utf8")).toBe(bad);
	const after = await loadIdentityStore(root);
	expect(after.heads.find((candidate) => candidate.path === "bad.prax")).toEqual(head);
	for (const [path, value] of Object.entries(original).filter(([path]) => path.includes(head.head)))
		expect((await bytes(root))[path]).toBe(value);
	if (!snapshot) throw new Error("Missing saved other snapshot");
	expect(after.snapshots.find((candidate) => candidate.lessonId === snapshot.lessonId)).toEqual(
		snapshot,
	);
	const snapshots = Object.entries(await bytes(root)).filter(([path]) =>
		path.startsWith(".praxity/identity/snapshots/"),
	);
	expect(snapshots).toHaveLength(
		Object.keys(original).filter((path) => path.startsWith(".praxity/identity/snapshots/")).length +
			1,
	);
});

it("a recorded write to the valid lesson also leaves invalid lesson identity untouched", async () => {
	const root = await fixture();
	await writeFile(join(root, "bad.prax"), bad);
	const before = (await loadIdentityStore(root)).heads.find((head) => head.path === "bad.prax");
	const service = new OperationService(root);
	const heading = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.text === "Heading",
	);
	if (!heading) throw new Error("Missing valid heading");
	const result = await service.canvasTextApply({
		transactionId: randomUUID(),
		operation: "setText",
		file: heading.file,
		nodeId: heading.nodeId,
		baseRevision: heading.baseRevision,
		expectedText: heading.text,
		field: heading.field,
		text: "Saved heading",
	});
	expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
	expect((await loadIdentityStore(root)).heads.find((head) => head.path === "bad.prax")).toEqual(
		before,
	);
	expect(await readFile(join(root, "bad.prax"), "utf8")).toBe(bad);
});

it("canvas outside-loss refusal is a coded result with unchanged storage", async () => {
	const root = await fixture();
	const service = new OperationService(root);
	const heading = (await service.canvasTextSnapshot()).fields.find(
		(field) => field.text === "Heading",
	);
	if (!heading) throw new Error("Missing heading");
	await writeFile(join(root, "bad.prax"), "# Other\n");
	const original = await bytes(root);
	expect(
		await service.canvasTextApply({
			transactionId: randomUUID(),
			operation: "setText",
			file: heading.file,
			nodeId: heading.nodeId,
			baseRevision: heading.baseRevision,
			expectedText: heading.text,
			field: heading.field,
			text: "Saved heading",
		}),
	).toMatchObject({
		ok: false,
		code: "identity-retirement-pending",
		retirements: [{ file: "bad.prax", page: "Other", label: "Saved other body.", line: null }],
		reviewUrl: "/launch",
	});
	expect(await bytes(root)).toEqual(original);
});

it("invalid lesson design metadata edits save exact bytes and leave identity unchanged", async () => {
	const root = await fixture();
	const source = `---\ntitle: Other\ndesign: { colorAccent: red }\n---\n\n${bad}`;
	await writeFile(join(root, "bad.prax"), source);
	const original = await bytes(root);
	expect(
		await editManifest(root, {
			file: "bad.prax",
			baseRevision: createHash("sha256").update(source).digest("hex"),
			path: ["design", "colorAccent"],
			value: "blue",
		}),
	).toMatchObject({ ok: true });
	expect(await readFile(join(root, "bad.prax"), "utf8")).toBe(
		source.replace("colorAccent: red", "colorAccent: blue"),
	);
	const identity = (files: Record<string, string>) =>
		Object.fromEntries(
			Object.entries(files).filter(([path]) => path.startsWith(".praxity/identity/")),
		);
	expect(identity(await bytes(root))).toEqual(identity(original));
});

it.each(["course", "head"])(
	"an outside identity %s replacement is a conflict before parsing its new bytes",
	async (file) => {
		const root = await fixture();
		await withProjectFileTransaction(
			root,
			async () => {
				const candidate = await resolveCourseIdentity(root, {
					lessonPaths: ["good.prax", "bad.prax"],
					sources: { "good.prax": `${good}\nAddition.\n` },
				});
				const store = await loadIdentityStore(root);
				const snapshot = store.snapshots[0];
				await writeFile(
					file === "course"
						? join(root, ".praxity/identity/course.json")
						: join(root, ".praxity/identity/lessons", `${snapshot.lessonId}.json`),
					"outside invalid identity",
				);
				const original = await bytes(root);
				await expect(persistCourseIdentity(root, candidate)).rejects.toMatchObject({
					code: "ECONFLICT",
					message: expect.stringMatching(/changed on disk/i),
				});
				expect(await bytes(root)).toEqual(original);
			},
			"write",
			false,
		);
	},
);
