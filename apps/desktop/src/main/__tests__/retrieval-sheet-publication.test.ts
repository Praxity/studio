import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { buildCourseExportInput } from "../export/build-export-input-from-project";
import * as lessonSources from "../lesson-source";
import { createStudioProjectSession, type StudioEvent } from "../studio/project-session";

const filesystem = vi.hoisted(() => ({
	watcher: undefined as import("node:events").EventEmitter | undefined,
}));
vi.mock("chokidar", async () => {
	const { EventEmitter } = await import("node:events");
	return {
		watch: () => {
			const watcher = Object.assign(new EventEmitter(), { close: async () => {} });
			filesystem.watcher = watcher;
			queueMicrotask(() => watcher.emit("ready"));
			return watcher;
		},
	};
});
vi.mock("../lesson-source", async (importOriginal) => {
	const original = await importOriginal<typeof import("../lesson-source")>();
	return { ...original, readLessonSource: vi.fn(original.readLessonSource) };
});
const sessions: Awaited<ReturnType<typeof createStudioProjectSession>>[] = [];

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it.each([
	["lesson", "export"],
	["course", "export"],
	["lesson", "preview"],
	["course", "preview"],
] as const)("prepares retrieval-sheet %s %s including native PDF input", async (scope, mode) => {
	const root = await mkdtemp(join(tmpdir(), "retrieval-publication-"));
	roots.push(root);
	await mkdir(join(root, "assets"));
	await writeFile(join(root, "course.yaml"), "title: Practice\nlessons:\n  - lesson.prax\n");
	await writeFile(
		join(root, "lesson.prax"),
		"# P\n::: retrieval-sheet Title\n:: Question\nanswer: Answer\n:::\n",
	);
	await persistFixtureIdentity(root);
	const options = {
		manifestPolicy: "write" as const,
		projectDir: root,
		completionThreshold: 0.8,
		viewerVersionPath: join(root, "missing-runtime.json"),
		mode,
		loadAssets: false,
		preparePdf: true,
		scope,
		lessonFilename: "lesson.prax",
		inheritWorkspaceSettings: false,
	};
	const result = await buildCourseExportInput(options);
	expect(JSON.stringify(result)).toContain("retrievalSheet");
	expect(result.preparedLessons).toHaveLength(1);
	expect(result.preparedLessons?.[0]?.blocks).toContainEqual(
		expect.objectContaining({
			type: "retrievalSheet",
			data: expect.objectContaining({
				content: expect.objectContaining({
					title: "Title",
					questions: [expect.objectContaining({ question: "Question", answer: "Answer" })],
				}),
			}),
		}),
	);
});

const sheet = "# Sheet\n::: retrieval-sheet Title\n:: Question\nanswer: Answer\n:::\n";
async function authoringFixture(source = sheet, assets?: string) {
	const root = await mkdtemp(join(tmpdir(), "retrieval-authoring-"));
	roots.push(root);
	await writeFile(
		join(root, "course.yaml"),
		"title: Practice\nlessons: [good.prax, lesson.prax]\n",
	);
	await writeFile(join(root, "good.prax"), "# Public\nOrdinary text.\n");
	await writeFile(join(root, "lesson.prax"), source);
	await persistFixtureIdentity(root);
	const session = await createStudioProjectSession(root, "test", undefined, {
		projectDir: root,
		exportAssetsDir: assets ?? join(root, "missing-runtime"),
		registerDownload: vi.fn(),
	});
	sessions.push(session);
	return { root, session };
}

it.each([
	["unknown type", "# Draft\n::: nosuch\n:::\n"],
	["private choice", "# Draft\n::: choice Q {private}\n( ) Yes\n( ) No\n:::\n"],
	["retrieval sheet", sheet],
])("keeps a project with %s editable in an editor session", async (_name, source) => {
	const { session } = await authoringFixture(source);
	const snapshot = (await session.invoke("editorSnapshot", {})) as {
		lessons: Array<{ file: string; source: string }>;
	};
	expect(snapshot.lessons).toContainEqual(expect.objectContaining({ file: "lesson.prax", source }));
});

it("refreshes an editable retrieval sheet without an unsupported-runtime diagnostic", async () => {
	const { root, session } = await authoringFixture(
		sheet,
		fileURLToPath(new URL("../../../resources/export-assets/", import.meta.url)),
	);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	const refreshed = new Promise<void>((resolve) => {
		const unsubscribe = session.subscribe((event) => {
			if (
				event.type === "pageCompiled" &&
				JSON.stringify(event.patch.fragments).includes("Updated question")
			) {
				unsubscribe();
				resolve();
			}
		});
	});
	await writeFile(join(root, "lesson.prax"), sheet.replace("Question", "Updated question"));
	if (!filesystem.watcher) throw new Error("Missing fixture watcher");
	filesystem.watcher.emit("all", "change", join(root, "lesson.prax"));
	const identity = await lessonSources.resolveLessonSources(root);
	const pageId = identity.lessons.get("lesson.prax")?.pages[0]?.id;
	if (!pageId) throw new Error("Missing sheet page");
	await session.invoke("previewSelectPage", { pageId });
	await refreshed;
	expect(events.some((event) => event.type === "pageCompiled")).toBe(true);
	expect(events.filter((event) => event.type === "compileFailed")).toEqual([]);
});

it("prepares publication even if lesson reading stops populating its cache", async () => {
	const { root } = await authoringFixture();
	const original = await vi.importActual<typeof import("../lesson-source")>("../lesson-source");
	vi.mocked(lessonSources.readLessonSource).mockImplementation(async (root, file, options) => {
		const source = await original.readLessonSource(root, file, options);
		options?.lessonReads?.delete(source);
		return source;
	});
	await expect(
		buildCourseExportInput({
			manifestPolicy: "write" as const,
			projectDir: root,
			scope: "course",
			completionThreshold: 0.8,
			viewerVersionPath: join(root, "missing-runtime"),
			loadAssets: false,
		}),
	).resolves.toMatchObject({
		blocks: expect.arrayContaining([expect.objectContaining({ type: "retrievalSheet" })]),
	});
	vi.mocked(lessonSources.readLessonSource).mockImplementation(original.readLessonSource);
});

for (const mode of ["export", "preview"] as const)
	for (const kind of ["condition", "require", "container"] as const) {
		it(`refuses sheet ${kind} through ${mode} admission`, async () => {
			const root = await mkdtemp(join(tmpdir(), "retrieval-refusal-"));
			roots.push(root);
			const prefix = "---\nvariables:\n  picked: false\n---\n# P\n";
			let source =
				prefix +
				(kind === "container" ? "::: accordion {required=true}\n:: Panel\n" : "") +
				"::: retrieval-sheet Title {name=sheet}\n:: Q\nanswer: A\n:::\n" +
				(kind === "container" ? ":::\n" : "");
			let line = 6;
			if (kind !== "container") {
				const lines = source.trimEnd().split("\n");
				while (lines.length < 19) lines.push("");
				source =
					lines.join("\n") +
					"\n::: rule\nif: " +
					(kind === "condition" ? "@sheet.isCompleted" : "picked") +
					" is true\nthen: " +
					(kind === "require" ? "require @sheet" : "set picked = true") +
					"\n:::\n";
				line = kind === "condition" ? 21 : 22;
			}
			await writeFile(join(root, "course.yaml"), "title: Practice\nlessons: [lesson.prax]\n");
			await writeFile(join(root, "lesson.prax"), source);
			await persistFixtureIdentity(root);
			await expect(
				buildCourseExportInput({
					projectDir: root,
					mode,
					scope: "course",
					completionThreshold: 0.8,
					viewerVersionPath: join(root, "missing"),
					loadAssets: false,
				}),
			).rejects.toMatchObject({
				code: "practice-no-tracking",
				diagnostics: expect.arrayContaining([
					expect.objectContaining({
						file: "lesson.prax",
						line,
						column: kind === "container" ? 16 : 1,
					}),
				]),
			});
		});
	}
