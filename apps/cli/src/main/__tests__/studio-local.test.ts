import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Draft } from "@praxity/editor-core/session";
import { afterEach, expect, it } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { buildCourseExportInput } from "../export/build-export-input-from-project";
import { resolveLessonSources } from "../lesson-source";
import { LocalEditorStore } from "../operations/local-editor-store";
import { createStudioProjectSession } from "../studio/project-session";

const roots: string[] = [];
const sessions: { close(): Promise<void> }[] = [];
const source =
	"---\ntitle: Lesson\n---\n\n# Safety\n\n::: note Exit {tone=info}\nKeep clear. Leave room for colleagues to reach the emergency door safely and follow the marked route to the nearest exit.\n:::\n\nOther paragraph.\n";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "studio-local-"));
	roots.push(root);
	await writeFile(
		join(root, "course.yaml"),
		"# Course comment\ntitle: Course\nlessons: [lesson.prax]\n",
	);
	await writeFile(join(root, "lesson.prax"), source);
	await persistFixtureIdentity(root);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const current = await resolveLessonSources(root);
	const mapping = current.identity.sourceMappings.find((node) =>
		source.slice(node.span.start, node.span.end).startsWith("::: note"),
	);
	if (!mapping) throw new Error("Missing fixture note");
	const text = source.slice(mapping.span.start, mapping.span.end);
	const draft: Draft = {
		id: "draft-1",
		file: "lesson.prax",
		target: {
			kind: "node",
			nodeId: mapping.id,
			path: mapping.path,
			fingerprint: mapping.fingerprint,
		},
		baseRevision: digest(source),
		expectedText: text,
		editableText: text.slice(0, text.lastIndexOf(":::")),
		baseText: text,
		text: "My unsaved text",
		selection: [2, 4],
		generation: 1,
		status: "held",
		diagnostics: [],
		changedAt: 10,
		validatedGeneration: 1,
		persistedGeneration: 1,
	};
	return { root, session, draft };
}

afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("assetList lists nested files and refuses symlinks leaving the root", async () => {
	const { root, session } = await fixture();
	await mkdir(join(root, "assets", "nested"), { recursive: true });
	await writeFile(join(root, "assets", "one.png"), "image");
	await writeFile(join(root, "assets", "nested", "two.mp3"), "audio");
	expect(await session.invoke("assetList", {})).toEqual([
		"assets/nested/two.mp3",
		"assets/one.png",
	]);
	const outside = await mkdtemp(join(tmpdir(), "studio-assets-outside-"));
	roots.push(outside);
	await symlink(outside, join(root, "assets", "escape"), "junction");
	await expect(session.invoke("assetList", {})).rejects.toThrow("Path traversal blocked");
});

it(".praxity/local never enters an export, including an asset alias", async () => {
	const { root, draft } = await fixture();
	await new LocalEditorStore(root).draftPut({ draft });
	const versionPath = join(root, "viewer.version.json");
	await writeFile(versionPath, '{"viewerSourceHash":"test"}');
	const options = {
		projectDir: root,
		completionThreshold: 0.8,
		viewerVersionPath: versionPath,
		manifestPolicy: "read-only" as const,
		inheritWorkspaceSettings: false,
	};
	const input = await buildCourseExportInput(options);
	expect([...(input.resolvedAssets ?? new Map()).keys()]).toEqual([]);
	expect(JSON.stringify(input.blocks)).not.toContain(draft.text);
	await mkdir(join(root, "assets"));
	await symlink(join(root, ".praxity", "local"), join(root, "assets", "local-alias"), "junction");
	await expect(buildCourseExportInput(options)).rejects.toMatchObject({
		code: "asset-internal-refused",
	});
});

it.each(["list", "export"])(
	"%s refuses local data whose canonical directory moved into assets",
	async (operation) => {
		const { root, session, draft } = await fixture();
		await new LocalEditorStore(root).draftPut({ draft });
		await mkdir(join(root, "assets"));
		await rename(join(root, ".praxity", "local"), join(root, "assets", "private"));
		await symlink(join(root, "assets", "private"), join(root, ".praxity", "local"), "junction");
		const versionPath = join(root, "viewer.version.json");
		await writeFile(versionPath, '{"viewerSourceHash":"test"}');
		const result =
			operation === "list"
				? session.invoke("assetList", {})
				: buildCourseExportInput({
						projectDir: root,
						completionThreshold: 0.8,
						viewerVersionPath: versionPath,
						manifestPolicy: "read-only",
						inheritWorkspaceSettings: false,
					});
		await expect(result).rejects.toMatchObject({ code: "asset-internal-refused" });
	},
);

it("refuses retired session APIs without changing course source", async () => {
	const { root, session } = await fixture();
	const before = await readFile(join(root, "lesson.prax"));
	for (const method of [
		"projectSave",
		"courseWriteLesson",
		"operationApply",
		"operationResolve",
		"canvasTextSnapshot",
		"canvasTextApply",
		"historyApply",
		"draftResolve",
		"draftPut",
		"draftDelete",
		"draftList",
		"draftPersistenceSession",
		"draftPersistenceSubmit",
		"draftPersistenceReconcile",
		"clipboardGet",
		"clipboardPut",
		"clipboardDiscard",
		"manifestEdit",
		"projectReadTextFile",
		"narrationCleanup",
		"narrationAuthoringRead",
		"narrationAuthoringWrite",
		"narrationStatus",
		"previewRenderDraft",
	]) {
		expect(session.registeredMethods).not.toContain(method);
		await expect(session.invoke(method, {})).rejects.toMatchObject({
			status: 404,
			code: "method_not_allowed",
		});
	}
	expect(await readFile(join(root, "lesson.prax"))).toEqual(before);
});
