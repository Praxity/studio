import { mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
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
	const scope = { lessonId: page.lessonId, pageId: page.id, pageIndex: 0 };
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
	expect(
		canvasTextSnapshotFields(current, {
			...scope,
			file: "lesson.prax",
			lessonId: "rt-00000000000000000000000000000000",
		}),
	).toEqual([]);
	const service = new OperationService(root, identitySession);
	const refused = await service.canvasTextSnapshot(scope);
	expect(refused.fields).toEqual([]);
	expect(refused.sourceError).toEqual({
		file: "lesson.prax",
		line: 23,
		column: 1,
		code: "detached-feedback",
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
	const identitySession = new CourseIdentitySession(root);
	const current = await resolveLessonSources(root, {}, { identitySession });
	const page = current.lessons.get("lesson.prax")?.pages[0];
	if (!page) throw new Error("Missing page");
	const snapshot = await new OperationService(root, identitySession).canvasTextSnapshot({
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
		"lesson.prax, line 6, column 1: Fix the feedback lines in this lesson's .prax file. Put correct: and incorrect: before the answer choices, and feedback: directly under its choice, with no blank line.",
	],
	[
		"fr",
		"lesson.prax, ligne 6, colonne 1 : Corrigez les lignes de rétroaction du fichier .prax pour en modifier le texte. Placez correct: et incorrect: avant les choix de réponse, et feedback: directement sous le choix concerné, sans ligne vide.",
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
		const session = await createStudioProjectSession(root, "test");
		const inventory = (await session.invoke("canvasTextSnapshot", {})) as Awaited<
			ReturnType<OperationService["canvasTextSnapshot"]>
		>;
		const scope = (file: string) => {
			const field = inventory.fields.find((field) => field.file === file);
			if (!field) throw new Error("Missing fixture fields");
			return { lessonId: field.lessonId, pageId: field.pageId, pageIndex: field.pageIndex };
		};
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

for (const locale of ["en", "fr"] as const) {
	it(`gives truthful feedback advice for a detached feedback: line in ${locale}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "canvas-option-feedback-"));
		roots.push(root);
		await writeFile(
			join(root, "course.yaml"),
			`title: Example\nlocale: ${locale}\nlessons: [lesson.prax]\n`,
		);
		await writeFile(
			join(root, "lesson.prax"),
			"# Lesson\n\n::: choice Hidden question\n(x) Hidden answer\n\nfeedback: Hidden feedback\n( ) Other\n:::\n",
		);
		const session = await createStudioProjectSession(root, "test");
		try {
			const inventory = (await session.invoke("canvasTextSnapshot", {})) as Awaited<
				ReturnType<OperationService["canvasTextSnapshot"]>
			>;
			const field = inventory.fields[0];
			const snapshot = await session.invoke(
				"canvasTextSnapshot",
				{},
				{ lessonId: field.lessonId, pageId: field.pageId, pageIndex: 0 },
			);
			const message =
				locale === "en"
					? "lesson.prax, line 6, column 1: Fix the feedback lines in this lesson's .prax file. Put correct: and incorrect: before the answer choices, and feedback: directly under its choice, with no blank line."
					: "lesson.prax, ligne 6, colonne 1 : Corrigez les lignes de rétroaction du fichier .prax pour en modifier le texte. Placez correct: et incorrect: avant les choix de réponse, et feedback: directement sous le choix concerné, sans ligne vide.";
			expect(snapshot).toMatchObject({ fields: [], sourceRefusal: message });
			expect(JSON.stringify(snapshot)).not.toMatch(/Hidden|grammar\.v4/);
		} finally {
			await session.close();
		}
	});

	for (const action of ["delete", "rename"] as const) {
		it(`${locale}: reports a lesson ${action} instead of admitting another lesson`, async () => {
			const root = await mkdtemp(join(tmpdir(), "canvas-missing-lesson-"));
			roots.push(root);
			await writeFile(
				join(root, "course.yaml"),
				`title: Example\nlocale: ${locale}\nlessons: [lesson.prax, other.prax]\n`,
			);
			await writeFile(join(root, "lesson.prax"), "# Lesson\n\nOriginal text.\n");
			await writeFile(join(root, "other.prax"), "# Other\n\nOther text.\n");
			const session = await createStudioProjectSession(root, "test");
			try {
				const inventory = (await session.invoke("canvasTextSnapshot", {})) as Awaited<
					ReturnType<OperationService["canvasTextSnapshot"]>
				>;
				const field = inventory.fields.find((field) => field.file === "lesson.prax");
				if (!field) throw new Error("Missing original lesson");
				if (action === "rename")
					await rename(join(root, "lesson.prax"), join(root, "renamed.prax"));
				else await unlink(join(root, "lesson.prax"));
				const captured = {
					file: field.file,
					lessonId: field.lessonId,
					pageId: field.pageId,
					pageIndex: field.pageIndex,
				};
				const expected = {
					fields: [],
					lessonMissing: true,
					sourceRefusal:
						locale === "en"
							? "This lesson was deleted or renamed. Restore its file or update the course's lesson list, then reopen Studio."
							: "Cette leçon a été supprimée ou renommée. Restaurez son fichier ou mettez à jour la liste des leçons du cours, puis rouvrez Studio.",
				};
				// Check before and after the author repairs the manifest's old filename.
				expect(await session.invoke("canvasTextSnapshot", {}, captured)).toMatchObject(expected);
				await writeFile(
					join(root, "course.yaml"),
					`title: Example\nlocale: ${locale}\nlessons: [${action === "rename" ? "renamed.prax, " : ""}other.prax]\n`,
				);
				expect(await session.invoke("canvasTextSnapshot", {}, captured)).toMatchObject(expected);
			} finally {
				await session.close();
			}
		});
	}
}
