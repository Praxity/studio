import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { runPraxityCli } from "../cli";
import { CoursePreviewService } from "../course-preview-service";
import { buildCourseExportInput } from "../export/build-export-input-from-project";
import { IdentitySourceError } from "../identity-store";
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
] as const)("prepares write-distractors %s %s including native PDF input", async (scope, mode) => {
	const root = await mkdtemp(join(tmpdir(), "distractors-publication-"));
	roots.push(root);
	await mkdir(join(root, "assets"));
	await writeFile(join(root, "course.yaml"), "title: Practice\nlessons:\n  - lesson.prax\n");
	await writeFile(
		join(root, "lesson.prax"),
		"# P\n::: write-distractors Question\nanswer: HiddenRight\n:: HiddenLabel\noption: HiddenOption\n:::\n",
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
	expect(JSON.stringify(result)).toContain("writeDistractors");
	expect(result.preparedLessons).toHaveLength(1);
	expect(JSON.stringify(result.blocks)).not.toMatch(/HiddenRight|HiddenLabel|HiddenOption/);
	expect(result.preparedLessons?.[0]?.writeDistractorsContents).toBeUndefined();
	const answers = await buildCourseExportInput({ ...options, includeAnswerSheet: true });
	expect(answers.preparedLessons?.[0]?.writeDistractorsContents?.size).toBe(1);
	expect(result.preparedLessons?.[0]?.blocks).toContainEqual(
		expect.objectContaining({
			type: "writeDistractors",
			data: expect.objectContaining({
				content: expect.objectContaining({
					question: "Question",
					count: 2,
					items: [expect.objectContaining({ id: expect.any(String) })],
				}),
			}),
		}),
	);
});

const sheet =
	"# Sheet\n::: write-distractors Question\nanswer: HiddenRight\n:: HiddenLabel\noption: HiddenOption\n:::\n";
async function authoringFixture(source = sheet, assets?: string) {
	const root = await mkdtemp(join(tmpdir(), "distractors-authoring-"));
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
	["distractors sheet", sheet],
])("keeps a project with %s editable in an editor session", async (_name, source) => {
	const { session } = await authoringFixture(source);
	const snapshot = (await session.invoke("editorSnapshot", {})) as {
		lessons: Array<{ file: string; source: string }>;
	};
	expect(snapshot.lessons).toContainEqual(expect.objectContaining({ file: "lesson.prax", source }));
});

it("refreshes an editable distractors sheet without an unsupported-runtime diagnostic", async () => {
	const { root, session } = await authoringFixture(
		sheet,
		fileURLToPath(new URL("../../../resources/export-assets/", import.meta.url)),
	);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	const refreshed = new Promise<void>((resolve, reject) => {
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "compileFailed") {
				unsubscribe();
				reject(new Error(JSON.stringify(event)));
			}
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
	expect(
		JSON.stringify(
			events.filter((event) => event.type === "pageCompiled").map((event) => event.patch.fragments),
		),
	).not.toMatch(/HiddenRight|HiddenLabel|HiddenOption/);
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
		blocks: expect.arrayContaining([expect.objectContaining({ type: "writeDistractors" })]),
	});
	vi.mocked(lessonSources.readLessonSource).mockImplementation(original.readLessonSource);
});

for (const mode of ["export", "preview"] as const)
	for (const kind of ["condition", "require", "container", "gate", "requireContainer"] as const) {
		it(`refuses sheet ${kind} through ${mode} admission`, async () => {
			const root = await mkdtemp(join(tmpdir(), "distractors-refusal-"));
			roots.push(root);
			const prefix = "---\nvariables:\n  picked: false\n---\n# P\n";
			const contained = ["container", "gate", "requireContainer"].includes(kind);
			let source =
				prefix +
				(contained
					? `::: accordion {${kind === "container" ? "required=true" : kind === "gate" ? "deckGate=attempt" : "name=outer"}}\n:: Panel\n`
					: "") +
				"::: write-distractors Q {name=sheet}\nanswer: R\n:: L\noption: O\n:::\n" +
				(contained ? ":::\n" : "");
			let line = 6;
			if (kind !== "container" && kind !== "gate") {
				const lines = source.trimEnd().split("\n");
				while (lines.length < 19) lines.push("");
				source =
					lines.join("\n") +
					"\n::: rule\nif: " +
					(kind === "condition" ? "@sheet.isCompleted" : "picked") +
					" is true\nthen: " +
					(kind === "require"
						? "require @sheet"
						: kind === "requireContainer"
							? "require @outer"
							: "set picked = true") +
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
						column: line === 6 ? 16 : 1,
					}),
				]),
			});
			const cli = await runPraxityCli(
				["export", root, "--format", "html", "--output", join(root, "refused.zip")],
				{
					appVersion: "test",
					exportAssetsDir: fileURLToPath(
						new URL("../../../resources/export-assets/", import.meta.url),
					),
				},
			);
			expect(cli.exitCode).toBe(1);
			expect(JSON.parse(cli.stdout).error).toMatchObject({
				code: "export_failed",
				message: expect.stringContaining("practice-no-tracking"),
			});
			const preview = new CoursePreviewService({
				getProjectDir: () => root,
				getExportAssetsDir: () =>
					fileURLToPath(new URL("../../../resources/export-assets/", import.meta.url)),
				getWorkspacePath: () => null,
				getFallbackCompletionThreshold: () => 0,
				stateStore: {} as never,
				hostCourseArtifact: vi.fn(),
				inheritWorkspaceSettings: false,
			});
			try {
				await expect(preview.build()).rejects.toMatchObject({ code: "practice-no-tracking" });
			} finally {
				await preview.dispose();
			}
		});
	}

const distractors = sheet;
// Author snapshots retain source and source-outline labels; generic blocks/data
// have no snapshot channel. Inspection is a separate prompt-only projection.
it("allows author source/outline labels in snapshots, excludes generic data, and keeps inspect prompt-only", async () => {
	const { root, session } = await authoringFixture();
	const snapshot = (await session.invoke("editorSnapshot", {})) as {
		lessons: Array<{ file: string; source: string; nodes: Array<{ label: string }> }>;
	};
	const lesson = snapshot.lessons.find((lesson) => lesson.file === "lesson.prax");
	if (!lesson) throw new Error("Missing snapshot lesson");
	expect(lesson.source).toBe(distractors);
	expect(lesson.nodes.some((node) => node.label.includes("HiddenLabel"))).toBe(true);
	const assertNoGenericData = (value: unknown): void => {
		if (!value || typeof value !== "object") return;
		expect(Object.keys(value)).not.toContain("blocks");
		expect(Object.keys(value)).not.toContain("data");
		for (const child of Object.values(value)) assertNoGenericData(child);
	};
	assertNoGenericData(snapshot);
	for (const schema of ["0", "1"]) {
		const result = await runPraxityCli(["inspect", root, "--schema", schema], {
			appVersion: "0.3.0",
			exportAssetsDir: join(root, "missing-runtime"),
		});
		expect(result.exitCode, result.stderr).toBe(0);
		expect(JSON.stringify(result)).not.toMatch(/HiddenRight|HiddenLabel|HiddenOption/);
		if (schema === "0") expect(result.stdout).toContain("Question");
	}
});

for (const [name, invalid, code] of [
	...[
		"private=true",
		"scored=false",
		"required=false",
		"points=0",
		"deckGate=attempt",
		"id=forged",
	].map((setting) => [
		setting,
		sheet.replace("write-distractors Question", `write-distractors Question {${setting}}`),
		"unknown-setting",
	]),
	[
		"assessment group",
		"# P\n::: group Practice {mode=all}\n::: choice Public {required=false}\n(x) Yes\n( ) No\n:::\n" +
			sheet.slice(sheet.indexOf("::: write-distractors")) +
			":::\n",
		"response-invariant",
	],
] as const) {
	it(`retains ${name} source refusal at export, CLI and preview`, async () => {
		const { root } = await authoringFixture();
		await writeFile(join(root, "lesson.prax"), invalid);
		const identity = await lessonSources.resolveLessonSources(root);
		const read = identity.lessons.get("lesson.prax");
		expect(read?.diagnostics).toContainEqual(expect.objectContaining({ code, severity: "error" }));
		const options = {
			projectDir: root,
			scope: "course" as const,
			completionThreshold: 0,
			viewerVersionPath: join(root, "missing"),
			loadAssets: false,
			inheritWorkspaceSettings: false,
		};
		await expect(buildCourseExportInput({ ...options, mode: "export" })).rejects.toMatchObject({
			constructor: IdentitySourceError,
			file: "lesson.prax",
			line: name === "assessment group" ? 7 : 2,
		});
		const result = await runPraxityCli(
			["export", root, "--format", "html", "--output", join(root, "refused.zip")],
			{
				appVersion: "test",
				exportAssetsDir: fileURLToPath(
					new URL("../../../resources/export-assets/", import.meta.url),
				),
			},
		);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error.code).toBe("project_invalid");
		const preview = await buildCourseExportInput({ ...options, mode: "preview" });
		expect(preview.unresolvedNodes?.size).toBeGreaterThan(0);
	});
}
