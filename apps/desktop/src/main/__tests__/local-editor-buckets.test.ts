import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Draft } from "@praxity/editor-core/session";
import { afterEach, expect, it, vi } from "vitest";
import { LocalEditorStore } from "../operations/local-editor-store";

const roots: string[] = [];
const fault = vi.hoisted(() => ({
	outside: undefined as { path: string; text: string; reads: number } | undefined,
	migrationTarget: undefined as { legacy: string; link: string; directory: string } | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const file = await fs.open(...args);
			const migrationTarget = fault.migrationTarget;
			if (migrationTarget && String(args[0]) === migrationTarget.legacy) {
				fault.migrationTarget = undefined;
				await fs.symlink(migrationTarget.directory, migrationTarget.link, "junction");
			}
			const outside = fault.outside;
			if (outside && String(args[0]) === outside.path && ++outside.reads === 2) {
				fault.outside = undefined;
				await fs.writeFile(outside.path, outside.text);
			}
			return file;
		},
	};
});
const source = "# P\n\nText\n";
const draft: Draft = {
	id: "draft-new",
	file: "a.prax",
	scope: "file",
	target: { kind: "node", nodeId: null, path: [], fingerprint: "a".repeat(64) },
	baseRevision: "b".repeat(64),
	expectedText: source,
	editableText: source,
	baseText: source,
	text: "My unsaved text",
	selection: [2, 4],
	generation: 1,
	status: "held",
	diagnostics: [],
	changedAt: 10,
	validatedGeneration: 1,
	persistedGeneration: 1,
};
afterEach(async () => {
	fault.outside = undefined;
	fault.migrationTarget = undefined;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("D17 migration refuses an outside bucket change and preserves the winning text", async () => {
	const { root, store } = await fixture();
	await mkdir(join(root, ".praxity/local/drafts"), { recursive: true });
	const path = join(root, ".praxity/local/drafts/00000000-0000-4000-8000-000000000099.json");
	const legacy = {
		schema: 1,
		lessonId: "00000000-0000-4000-8000-000000000099",
		file: "a.prax",
		drafts: [draft],
	};
	await writeFile(path, JSON.stringify(legacy));
	const winning = { ...draft, generation: 2, text: "Outside unsaved work" };
	const text = JSON.stringify({ ...legacy, drafts: [winning] });
	fault.outside = { path, text, reads: 0 };
	await expect(store.draftPut({ draft })).rejects.toMatchObject({ code: "ECONFLICT" });
	expect(fault.outside).toBeUndefined();
	expect(await readFile(path, "utf8")).toBe(text);
	expect(await store.draftList()).toEqual([winning]);
	expect(await readdir(join(root, ".praxity/local/drafts"))).toEqual([
		"00000000-0000-4000-8000-000000000099.json",
	]);
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "local-buckets-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: C\nlessons: [a.prax]\n");
	await writeFile(join(root, "a.prax"), source);
	return { root, store: new LocalEditorStore(root) };
}

it("D3 first-draft membership refuses an extension the identity owner rejects", async () => {
	const { root, store } = await fixture();
	await writeFile(join(root, "u.PRAX"), source);
	await expect(store.draftPut({ draft: { ...draft, file: "u.PRAX" } })).rejects.toThrow(
		"Identity: unsafe relative lesson path",
	);
	expect(await store.draftList()).toEqual([]);
	expect(await readFile(join(root, "u.PRAX"), "utf8")).toBe("# P\n\nText\n");
	expect((await readdir(root)).sort()).toEqual(["a.prax", "course.yaml", "u.PRAX"]);
});

for (const identityFault of ["corrupt", "archive"] as const) {
	it(`D3 first drafts survive ${identityFault} identity evidence`, async () => {
		const { root, store } = await fixture();
		if (identityFault === "corrupt") {
			await mkdir(join(root, ".praxity/identity/lessons"), { recursive: true });
			await mkdir(join(root, ".praxity/identity/snapshots"));
			await writeFile(join(root, ".praxity/identity/course.json"), "{corrupt");
		} else {
			await mkdir(join(root, ".praxity-write-retained"));
			await writeFile(join(root, ".praxity-write-retained/evidence.txt"), "Retained evidence\n");
		}
		expect(await store.draftPut({ draft })).toEqual({ ok: true, writeResult: {} });
		expect(await store.draftList()).toEqual([draft]);
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("# P\n\nText\n");
		expect(
			await readFile(
				join(
					root,
					identityFault === "corrupt"
						? ".praxity/identity/course.json"
						: ".praxity-write-retained/evidence.txt",
				),
				"utf8",
			),
		).toBe(identityFault === "corrupt" ? "{corrupt" : "Retained evidence\n");
	});
}

for (const action of ["update", "delete"] as const) {
	it(`D17 schema-2 ${action} refuses a changed bucket and retains outside drafts`, async () => {
		const { root, store } = await fixture();
		await store.draftPut({ draft });
		const path = join(
			root,
			".praxity/local/drafts/file-14a277dd84ec9941559d0840ca9337dad079606160a5ba4a558f15408e078055.json",
		);
		const winning = { ...draft, generation: 3, text: "Outside unsaved work" };
		const sibling = { ...draft, id: "outside-sibling", text: "Outside sibling" };
		const text = JSON.stringify({ schema: 2, file: "a.prax", drafts: [winning, sibling] });
		fault.outside = { path, text, reads: 0 };
		await expect(
			action === "update"
				? store.draftPut({ draft: { ...draft, generation: 2, text: "My new text" } })
				: store.draftDelete({ file: "a.prax", id: "draft-new" }),
		).rejects.toMatchObject({ code: "ECONFLICT" });
		expect(fault.outside).toBeUndefined();
		expect(await readFile(path, "utf8")).toBe(text);
		expect(await store.draftList()).toEqual([winning, sibling]);
	});
}

it("D17 legacy last-draft deletion refuses a symbolic migration target before deleting bytes", async () => {
	const { root, store } = await fixture();
	await mkdir(join(root, ".praxity/local/drafts"), { recursive: true });
	const legacy = join(root, ".praxity/local/drafts/00000000-0000-4000-8000-000000000099.json");
	const text = JSON.stringify({
		schema: 1,
		lessonId: "00000000-0000-4000-8000-000000000099",
		file: "a.prax",
		drafts: [draft],
	});
	await writeFile(legacy, text);
	const directory = join(root, "outside-drafts");
	await mkdir(directory);
	await writeFile(join(directory, "evidence.txt"), "Keep these bytes\n");
	const link = join(
		root,
		".praxity/local/drafts/file-14a277dd84ec9941559d0840ca9337dad079606160a5ba4a558f15408e078055.json",
	);
	fault.migrationTarget = { legacy, link, directory };
	await expect(store.draftDelete({ file: "a.prax", id: "draft-new" })).rejects.toThrow(
		"Local editor paths cannot be symbolic links",
	);
	expect(fault.migrationTarget).toBeUndefined();
	expect(await readFile(legacy, "utf8")).toBe(text);
	expect(await readFile(join(directory, "evidence.txt"), "utf8")).toBe("Keep these bytes\n");
});

it("D3 D17 an unstored lesson saves its draft without a provisional lesson ID", async () => {
	const { root, store } = await fixture();
	expect(await store.draftPut({ draft })).toMatchObject({ ok: true });
	const names = await readdir(join(root, ".praxity/local/drafts"));
	expect(names).toEqual([
		"file-14a277dd84ec9941559d0840ca9337dad079606160a5ba4a558f15408e078055.json",
	]);
	expect(JSON.parse(await readFile(join(root, ".praxity/local/drafts", names[0]), "utf8"))).toEqual(
		{
			schema: 2,
			file: "a.prax",
			drafts: [draft],
		},
	);
	expect(await new LocalEditorStore(root).draftList()).toEqual([draft]);
	expect(await readdir(join(root, ".praxity"))).toEqual(["local"]);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("# P\n\nText\n");
});

it.each(["retry", "update", "delete"])(
	"D17 %s migrates a legacy never-stored lesson UUID without losing sibling drafts",
	async (action) => {
		const { root, store } = await fixture();
		const sibling = { ...draft, id: "draft-sibling", text: "Keep this sibling" };
		await mkdir(join(root, ".praxity/local/drafts"), { recursive: true });
		await writeFile(join(root, ".praxity/local/.gitignore"), "*\n");
		const legacy = join(root, ".praxity/local/drafts/00000000-0000-4000-8000-000000000099.json");
		await writeFile(
			legacy,
			JSON.stringify({
				schema: 1,
				lessonId: "00000000-0000-4000-8000-000000000099",
				file: "a.prax",
				drafts: [draft, sibling],
			}),
		);
		expect(await store.draftList()).toEqual([draft, sibling]);
		const updated = { ...draft, generation: 2, text: "Updated unsaved text" };
		if (action === "delete") await store.draftDelete({ file: "a.prax", id: "draft-new" });
		else
			expect(await store.draftPut({ draft: action === "retry" ? draft : updated })).toMatchObject({
				ok: true,
			});
		expect(await readdir(join(root, ".praxity/local/drafts"))).toEqual([
			"file-14a277dd84ec9941559d0840ca9337dad079606160a5ba4a558f15408e078055.json",
		]);
		const expected =
			action === "delete" ? [sibling] : action === "retry" ? [draft, sibling] : [sibling, updated];
		expect(await new LocalEditorStore(root).draftList()).toEqual(expected);
		expect(
			JSON.parse(
				await readFile(
					join(
						root,
						".praxity/local/drafts/file-14a277dd84ec9941559d0840ca9337dad079606160a5ba4a558f15408e078055.json",
					),
					"utf8",
				),
			),
		).toEqual({
			schema: 2,
			file: "a.prax",
			drafts: expected,
		});
		expect(await readdir(join(root, ".praxity"))).toEqual(["local"]);
	},
);

it("D3 runtime draft targets refuse before creating local bytes", async () => {
	const { root, store } = await fixture();
	await expect(
		store.draftPut({
			draft: {
				...draft,
				target: { ...draft.target, nodeId: "rt-00000000000000000000000000001003" },
			},
		}),
	).rejects.toMatchObject({ name: "ZodError" });
	expect(await readdir(root)).toEqual(["a.prax", "course.yaml"]);
});

it("D17 a malformed legacy bucket refuses reads and writes while retaining its exact bytes", async () => {
	const { root, store } = await fixture();
	await mkdir(join(root, ".praxity/local/drafts"), { recursive: true });
	const path = join(root, ".praxity/local/drafts/00000000-0000-4000-8000-000000000099.json");
	const text =
		'{"schema":1,"lessonId":"rt-00000000000000000000000000001003","file":"a.prax","drafts":[]}';
	await writeFile(path, text);
	await expect(store.draftList()).rejects.toMatchObject({ name: "ZodError" });
	await expect(store.draftPut({ draft })).rejects.toMatchObject({ name: "ZodError" });
	await expect(store.draftDelete({ file: "a.prax", id: "draft-new" })).rejects.toMatchObject({
		name: "ZodError",
	});
	expect(await readFile(path, "utf8")).toBe(text);
	expect(await readdir(join(root, ".praxity/local/drafts"))).toEqual([
		"00000000-0000-4000-8000-000000000099.json",
	]);
});

it("D17 conflicting legacy and file buckets refuse migration without overwriting either draft", async () => {
	const { root, store } = await fixture();
	await store.draftPut({ draft });
	const path = join(root, ".praxity/local/drafts/00000000-0000-4000-8000-000000000099.json");
	const text = JSON.stringify({
		schema: 1,
		lessonId: "00000000-0000-4000-8000-000000000099",
		file: "a.prax",
		drafts: [{ ...draft, id: "legacy-draft", text: "Keep this legacy work" }],
	});
	await writeFile(path, text);
	await expect(store.draftList()).rejects.toThrow("Duplicate draft lesson file");
	await expect(store.draftPut({ draft: { ...draft, generation: 2 } })).rejects.toThrow(
		"Duplicate draft lesson file",
	);
	expect(await readFile(path, "utf8")).toBe(text);
	expect(
		JSON.parse(
			await readFile(
				join(
					root,
					".praxity/local/drafts/file-14a277dd84ec9941559d0840ca9337dad079606160a5ba4a558f15408e078055.json",
				),
				"utf8",
			),
		).drafts,
	).toEqual([draft]);
});
