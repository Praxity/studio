import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { afterEach, expect, it } from "vitest";
import { buildCourseExportInput } from "../export/build-export-input-from-project";
import { CourseIdentitySession } from "../identity-store";
import { resolveLessonSources, resolveLessonSourcesForWrite } from "../lesson-source";
import { canvasTextSnapshotFields } from "../operations/canvas-text-bindings";
import { OperationService } from "../operations/operation-service";
import { createStudioProjectSession } from "../studio/project-session";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("admits the repro lesson's text fields with the compiler's transient lesson and page scope", async () => {
	const root = await mkdtemp(join(tmpdir(), "canvas-source-error-"));
	roots.push(root);
	const source = await readFile(
		new URL(
			"../../../e2e/browser-editor/fixtures/source-error-feedback-after-options.prax",
			import.meta.url,
		),
		"utf8",
	);
	await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [lesson.prax]\n");
	await writeFile(join(root, "lesson.prax"), source);
	const identitySession = new CourseIdentitySession(root);
	const input = await buildCourseExportInput({
		projectDir: root,
		mode: "preview",
		completionThreshold: 80,
		viewerVersionPath: join(
			import.meta.dirname,
			"../../../resources/export-assets/viewer.version.json",
		),
		identitySession,
		scope: "course",
	});
	const page = splitBlocksIntoPages(input.blocks, "Example")[0];
	if (!page.lessonId) throw new Error("Missing compiled lesson identity");
	const scope = { file: "lesson.prax", lessonId: page.lessonId, pageId: page.id, pageIndex: 0 };
	// Entering the author document runs the identity review gate after compilation.
	await resolveLessonSourcesForWrite(root, {}, { identitySession });
	const current = await resolveLessonSources(root, {}, { identitySession });
	expect(current.transientIds).toBe(true);
	expect(input.lessonFiles?.[scope.lessonId]).toBe("lesson.prax");
	expect(current.identity.snapshots[0].lessonId).toBe(scope.lessonId);
	expect(
		current.lessons
			.get("lesson.prax")
			?.errors.map((error) => [error.messageRef.key, error.line, error.column]),
	).toEqual([
		["grammar.v4.detached-option-feedback", 23, 1],
		["grammar.v4.detached-option-feedback", 24, 1],
	]);
	expect(canvasTextSnapshotFields(current)).toHaveLength(14);
	expect(canvasTextSnapshotFields(current, scope)).toHaveLength(14);
	const service = new OperationService(root, identitySession);
	const refused = await service.canvasTextSnapshot(scope);
	expect(refused.fields).toEqual([]);
	expect(refused.sourceError).toEqual({
		file: "lesson.prax",
		line: 23,
		column: 1,
		code: "feedback-after-options",
	});
	const field = canvasTextSnapshotFields(current)[0];
	expect(
		await service.canvasTextApply(
			{
				transactionId: "12345678-1234-4234-8234-123456789abc",
				operation: "setText",
				file: field.file,
				nodeId: field.nodeId,
				baseRevision: field.baseRevision,
				expectedText: field.text,
				field: field.field,
				text: "Revised intro.",
			},
			scope,
		),
	).toMatchObject({ ok: false, code: "source-invalid" });
	const repaired = source.replace(/^(correct:.*|incorrect:.*)\r?\n/gmu, "");
	await writeFile(join(root, "lesson.prax"), repaired);
	const recovered = await service.canvasTextSnapshot(scope);
	expect(recovered.sourceError).toBeUndefined();
	expect(recovered.fields.map((field) => field.text)).toContain("Page d-c1.prax");
	expect(recovered.fields.every((field) => field.file === "lesson.prax")).toBe(true);
});

it("leaves practice admission to its existing course-wide build refusal", async () => {
	const root = await mkdtemp(join(tmpdir(), "canvas-practice-snapshot-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [lesson.prax]\n");
	await writeFile(
		join(root, "lesson.prax"),
		"# Practice\n\n::: choice Question {private required}\n(x) A\n( ) B\n:::\n",
	);
	const identitySession = new CourseIdentitySession(root);
	const current = await resolveLessonSources(root, {}, { identitySession });
	const page = current.lessons.get("lesson.prax")?.pages[0];
	if (!page) throw new Error("Missing practice page");
	expect(current.lessons.get("lesson.prax")?.hasErrors).toBe(true);
	const snapshot = await new OperationService(root, identitySession).canvasTextSnapshot({
		file: "lesson.prax",
		lessonId: current.identity.snapshots[0].lessonId,
		pageId: page.id,
		pageIndex: 0,
	});
	expect(snapshot.sourceError).toBeUndefined();
});

it("returns only the source location for other source errors", async () => {
	const root = await mkdtemp(join(tmpdir(), "canvas-generic-source-error-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [lesson.prax]\n");
	await writeFile(
		join(root, "lesson.prax"),
		"# Lesson\n\n::: unknown-secret-type\nHidden body\n:::\n",
	);
	const current = await resolveLessonSources(root);
	const page = current.lessons.get("lesson.prax")?.pages[0];
	if (!page) throw new Error("Missing page");
	const snapshot = await new OperationService(root).canvasTextSnapshot({
		file: "lesson.prax",
		lessonId: current.identity.snapshots[0].lessonId,
		pageId: page.id,
		pageIndex: 0,
	});
	expect(snapshot.fields).toEqual([]);
	expect(snapshot.sourceError).toEqual({
		file: "lesson.prax",
		line: 3,
		column: 1,
		code: "source-error",
	});
	expect(JSON.stringify(snapshot)).not.toMatch(/unknown-secret-type|Hidden|grammar\.v4/);
});

it.each([
	[
		"en",
		"lesson.prax, line 6, column 1: Move correct: and incorrect: before the choice options in the .prax file to edit this lesson's text.",
	],
	[
		"fr",
		"lesson.prax, ligne 6, colonne 1 : Déplacez correct: et incorrect: avant les options du choix dans le fichier .prax pour modifier le texte de cette leçon.",
	],
])(
	"returns a content-free source refusal in %s on the first scoped snapshot",
	async (locale, message) => {
		const root = await mkdtemp(join(tmpdir(), "canvas-source-refusal-"));
		roots.push(root);
		await writeFile(
			join(root, "course.yaml"),
			`title: Example\nlocale: ${locale}\nlessons: [lesson.prax, other.prax]\n`,
		);
		await writeFile(
			join(root, "lesson.prax"),
			"# Lesson\n\n::: choice Hidden authored question\n(x) Hidden answer\n( ) Other\ncorrect: Hidden feedback\n:::\n",
		);
		await writeFile(join(root, "other.prax"), "# Other lesson\n\nValid text.\n");
		const current = await resolveLessonSources(root);
		const scope = (file: string) => ({
			file,
			lessonId: "retired-lesson",
			pageId: current.lessons.get(file)?.pages[0].id ?? "",
			pageIndex: 0,
		});
		const session = await createStudioProjectSession(root, "test");
		try {
			const snapshot = await session.invoke("canvasTextSnapshot", {}, scope("lesson.prax"));
			expect(snapshot).toMatchObject({ fields: [], sourceRefusal: message });
			expect(JSON.stringify(snapshot)).not.toMatch(/Hidden|grammar\.v4/);
			const healthy = await session.invoke("canvasTextSnapshot", {}, scope("other.prax"));
			expect(healthy).toMatchObject({
				sourceRefusal: undefined,
				fields: expect.arrayContaining([expect.objectContaining({ text: "Valid text." })]),
			});
		} finally {
			await session.close();
		}
	},
);
