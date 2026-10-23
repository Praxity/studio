import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Draft } from "@praxity/editor-core/session";
import { afterEach, beforeAll, expect, it } from "vitest";
import { runPraxityCli } from "../cli";
import { LocalEditorStore } from "../operations/local-editor-store";
import type { StudioServer } from "../studio/server";

const roots: string[] = [];
const servers: StudioServer[] = [];
const runtime = { appVersion: "0.3.0", exportAssetsDir: "unused" };
const original = "# Page\n\nSaved text.\n";
const text = "\uFEFFUnsaved *French* text: été.\r\nSecond line.\r\n";
beforeAll(async () => {
	// CLI routing stays real; load its lazy server once outside the recovery scenarios.
	await import("../studio/server");
});
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "legacy-draft-recovery-"));
	roots.push(root);
	const project = join(root, "project");
	await mkdir(project);
	await writeFile(join(project, "course.yaml"), "title: Course\nlessons: [lesson.prax]\n");
	await writeFile(join(project, "lesson.prax"), original);
	const store = new LocalEditorStore(project);
	const draft: Draft = {
		id: "retained-draft",
		file: "lesson.prax",
		scope: "file",
		target: { kind: "node", nodeId: null, path: [], fingerprint: "a".repeat(64) },
		baseRevision: "b".repeat(64),
		expectedText: original,
		editableText: original,
		baseText: original,
		text,
		selection: [1, 1],
		generation: 1,
		status: "held",
		diagnostics: [],
		changedAt: 10,
		validatedGeneration: 1,
		persistedGeneration: 1,
	};
	return { root, project, store, draft };
}

it("lists and exports every retained draft as exact plain text without changing saved records", async () => {
	const { root, project, store, draft } = await fixture();
	expect((await store.draftPut({ draft })).ok).toBe(true);
	expect((await store.draftPut({ draft: { ...draft, id: "empty-draft", text: "" } })).ok).toBe(
		true,
	);
	const buckets = join(project, ".praxity/local/drafts");
	const files = await readdir(buckets);
	const before = await Promise.all(files.map((name) => readFile(join(buckets, name))));
	const listed = await runPraxityCli(["recovery", "list", project], runtime);
	expect(listed.exitCode).toBe(0);
	expect(JSON.parse(listed.stdout).drafts).toEqual([
		expect.objectContaining({ id: "retained-draft", file: "lesson.prax", text }),
		expect.objectContaining({ id: "empty-draft", text: "" }),
	]);
	// Orphaned drafts still belong to the author after the source file disappears.
	await unlink(join(project, "lesson.prax"));
	const output = join(root, "recovered drafts");
	const exported = await runPraxityCli(["recovery", "export-drafts", project, output], runtime);
	expect(exported.exitCode, exported.stderr).toBe(0);
	expect((await readdir(output)).sort()).toEqual(["draft-1.txt", "draft-2.txt"]);
	expect(await readFile(join(output, "draft-1.txt"))).toEqual(Buffer.from(text));
	expect(await readFile(join(output, "draft-2.txt"))).toEqual(Buffer.alloc(0));
	expect(await Promise.all(files.map((name) => readFile(join(buckets, name))))).toEqual(before);
	expect(await store.draftList()).toHaveLength(2);
});

it("refuses existing export destinations without replacing files or removing drafts", async () => {
	const { root, project, store, draft } = await fixture();
	await store.draftPut({ draft });
	const output = join(root, "recovered");
	await mkdir(output);
	await writeFile(join(output, "draft-1.txt"), "Author file");
	const result = await runPraxityCli(["recovery", "export-drafts", project, output], runtime);
	expect(result.exitCode).toBe(1);
	expect(await readFile(join(output, "draft-1.txt"), "utf8")).toBe("Author file");
	expect(await readFile(join(project, "lesson.prax"), "utf8")).toBe(original);
	expect(await store.draftList()).toEqual([draft]);
});

it.each([false, true])("refuses an existing export folder, unrelated file=%s", async (withFile) => {
	const { root, project, store, draft } = await fixture();
	await store.draftPut({ draft });
	const output = join(root, "existing");
	await mkdir(output);
	if (withFile) await writeFile(join(output, "notes.txt"), "Author notes");
	const result = await runPraxityCli(["recovery", "export-drafts", project, output], runtime);
	expect(result.exitCode).toBe(1);
	expect(await readdir(output)).toEqual(withFile ? ["notes.txt"] : []);
});

it("recovery skips foreign and malformed files, exports valid drafts and preserves local bytes", async () => {
	const { root, project, store, draft } = await fixture();
	await store.draftPut({ draft });
	const directory = join(project, ".praxity/local/drafts");
	const [bucket] = await readdir(directory);
	const copy = bucket.replace(".json", " 2.json");
	await writeFile(join(directory, copy), await readFile(join(directory, bucket)));
	await writeFile(join(directory, ".DS_Store"), "Finder");
	await writeFile(join(directory, "bad.json"), "{truncated");
	const files = await readdir(directory);
	const before = await Promise.all(files.map((name) => readFile(join(directory, name))));
	const listed = await runPraxityCli(["recovery", "list", project], runtime);
	expect(listed.exitCode, listed.stderr).toBe(0);
	const result = JSON.parse(listed.stdout);
	expect(result.archives).toEqual([]);
	expect(result.drafts).toEqual([draft]);
	expect(result.skippedDraftFiles).toEqual([
		{ file: ".DS_Store", reason: "unrecognized-file" },
		{ file: "bad.json", reason: "invalid-draft" },
		{ file: copy, reason: "unrecognized-file" },
	]);
	const output = join(root, "export");
	const exported = await runPraxityCli(["recovery", "export-drafts", project, output], runtime);
	expect(exported.exitCode, exported.stderr).toBe(0);
	expect(JSON.parse(exported.stdout).skippedDraftFiles).toEqual(result.skippedDraftFiles);
	expect(await readFile(join(output, "draft-1.txt"))).toEqual(Buffer.from(text));
	expect(await Promise.all(files.map((name) => readFile(join(directory, name))))).toEqual(before);
});

it("refuses aliased draft storage before creating any exported files", async () => {
	const { root, project } = await fixture();
	const outside = join(root, "outside");
	await mkdir(outside);
	await mkdir(join(project, ".praxity/local"), { recursive: true });
	await symlink(outside, join(project, ".praxity/local/drafts"), "junction");
	const result = await runPraxityCli(
		["recovery", "export-drafts", project, join(root, "output")],
		runtime,
	);
	expect(result.exitCode).toBe(1);
	expect(await readdir(outside)).toEqual([]);
	expect(await readdir(root)).not.toContain("output");
	const listed = await runPraxityCli(["recovery", "list", project], runtime);
	expect(listed.exitCode).toBe(0);
	expect(JSON.parse(listed.stdout)).toMatchObject({
		archives: [],
		drafts: [],
		draftsError: expect.stringContaining("symbolic links"),
	});
	const editorAssetsDir = join(root, "editor");
	await mkdir(editorAssetsDir);
	await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
	await writeFile(
		join(editorAssetsDir, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	const studio = await runPraxityCli(["studio", project, "--no-open"], {
		...runtime,
		editorAssetsDir,
	});
	if (studio.studioServer) servers.push(studio.studioServer);
	expect(studio.exitCode, studio.stderr).toBe(0);
	expect(studio.stdout).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#session=/);
	expect(studio.stderr).toContain("praxity recovery list");
	expect(await readdir(outside)).toEqual([]);
});

it("exports competing valid legacy buckets without discarding either author's text", async () => {
	const { root, project, store, draft } = await fixture();
	await store.draftPut({ draft });
	const lessonId = "00000000-0000-4000-8000-000000000099";
	await writeFile(
		join(project, `.praxity/local/drafts/${lessonId}.json`),
		JSON.stringify({
			schema: 1,
			lessonId,
			file: draft.file,
			drafts: [{ ...draft, text: "Competing unsaved text" }],
		}),
	);
	const output = join(root, "export");
	const result = await runPraxityCli(["recovery", "export-drafts", project, output], runtime);
	expect(result.exitCode, result.stderr).toBe(0);
	expect(await readFile(join(output, "draft-1.txt"), "utf8")).toBe("Competing unsaved text");
	expect(await readFile(join(output, "draft-2.txt"), "utf8")).toBe(text);
	await expect(store.draftList()).rejects.toThrow("Duplicate draft lesson file");
});

it.each([".praxity", ".praxity-write-retained"])(
	"refuses export into protected %s storage",
	async (name) => {
		const { project, store, draft } = await fixture();
		await store.draftPut({ draft });
		await mkdir(join(project, name), { recursive: true });
		const result = await runPraxityCli(
			["recovery", "export-drafts", project, join(project, name, "output")],
			runtime,
		);
		expect(result.exitCode).toBe(1);
		expect(await readdir(join(project, name))).not.toContain("output");
		expect(await store.draftList()).toEqual([draft]);
	},
);

it("lists absent draft storage without creating author records", async () => {
	const { project } = await fixture();
	const before = await readdir(project);
	const result = await runPraxityCli(["recovery", "list", project], runtime);
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(result.stdout).drafts).toEqual([]);
	expect(await readdir(project)).toEqual(before);
});

it("lists recovery metadata with uppercase spelling when no drafts exist", async () => {
	const { project } = await fixture();
	await mkdir(join(project, ".PRAXITY"));
	const result = await runPraxityCli(["recovery", "list", project], runtime);
	expect(result.exitCode, result.stderr).toBe(0);
	expect(JSON.parse(result.stdout).drafts).toEqual([]);
	expect(await readdir(join(project, ".PRAXITY"))).toEqual([]);
});

it.skipIf(process.platform !== "win32")(
	"refuses case-aliased existing drafts without exporting their bytes",
	async () => {
		const { root, project, store, draft } = await fixture();
		await store.draftPut({ draft });
		await rename(join(project, ".praxity"), join(project, ".PRAXITY"));
		const result = await runPraxityCli(
			["recovery", "export-drafts", project, join(root, "output")],
			runtime,
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("case alias");
		expect(await readdir(root)).not.toContain("output");
	},
);

it("refuses an export destination whose parent aliases project metadata", async () => {
	const { root, project, store, draft } = await fixture();
	await store.draftPut({ draft });
	await symlink(join(project, ".praxity"), join(root, "alias"), "junction");
	const result = await runPraxityCli(
		["recovery", "export-drafts", project, join(root, "alias/output")],
		runtime,
	);
	expect(result.exitCode).toBe(1);
	expect(await readdir(join(project, ".praxity"))).not.toContain("output");
	expect(await store.draftList()).toEqual([draft]);
});

it.each(["en", "fr"] as const)("Studio reports a recoverable draft count in %s", async (locale) => {
	const { root, project, store, draft } = await fixture();
	await store.draftPut({ draft });
	const editorAssetsDir = join(root, "editor");
	await mkdir(editorAssetsDir);
	await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
	await writeFile(
		join(editorAssetsDir, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	const result = await runPraxityCli(["studio", project, "--no-open", "--lang", locale], {
		...runtime,
		editorAssetsDir,
	});
	if (result.studioServer) servers.push(result.studioServer);
	expect(result.exitCode, result.stderr).toBe(0);
	expect(result.stderr).toContain(locale === "en" ? "1 retained draft" : "1 brouillon conservé");
	expect(result.stderr.trim().split("\n")).toHaveLength(1);
	expect(result.stderr).toContain("praxity recovery export-drafts");
	expect(result.stderr).not.toContain(text);
	expect(await readFile(join(project, "lesson.prax"), "utf8")).toBe(original);
	expect(await store.draftList()).toEqual([draft]);
});
