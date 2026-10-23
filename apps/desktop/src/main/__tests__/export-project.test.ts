import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type DesktopExportInput, selfCheckContentInput } from "@praxity/export-pipeline";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	assertViewerAssetsReady: vi.fn(),
	buildCourseExportInput: vi.fn(),
	buildExportInputFromProject: vi.fn(),
	assertExportAccessibility: vi.fn(),
	getMetricsFromBlocks: vi.fn(),
	compileCourse: vi.fn(),
	deployCourse: vi.fn(),
	exportCoursePdf: vi.fn(),
	resolvePdfAssets: vi.fn(),
}));

vi.mock("@praxity/format-renderers/pipelines/course-pdf", async (importOriginal) => ({
	...(await importOriginal<typeof import("@praxity/format-renderers/pipelines/course-pdf")>()),
	exportCoursePdf: mocks.exportCoursePdf,
}));
vi.mock("../export/resolve-pdf-assets", () => ({ resolvePdfAssets: mocks.resolvePdfAssets }));

vi.mock("@praxity/export-pipeline/bundle-viewer", () => ({
	assertViewerAssetsReady: mocks.assertViewerAssetsReady,
}));
vi.mock("@praxity/export-pipeline", async (importOriginal) => ({
	...(await importOriginal<typeof import("@praxity/export-pipeline")>()),
	compileCourse: mocks.compileCourse,
	deployCourse: mocks.deployCourse,
}));
vi.mock("../export/build-export-input-from-project", () => ({
	buildCourseExportInput: mocks.buildCourseExportInput,
	buildExportInputFromProject: mocks.buildExportInputFromProject,
}));
vi.mock("../export/accessibility-enforcement", () => ({
	assertExportAccessibility: mocks.assertExportAccessibility,
}));
vi.mock("../telemetry-utils", () => ({
	getMetricsFromBlocks: mocks.getMetricsFromBlocks,
}));

import { estimateProjectScorm12Storage, exportProject } from "../export/export-project";
import { resolveCompletionSettings } from "../project-config";

const tempDirs: string[] = [];
let admittedProjectDir: string;
beforeEach(async () => {
	admittedProjectDir = await mkdtemp(path.join(os.tmpdir(), "export-admission-"));
	tempDirs.push(admittedProjectDir);
});

afterEach(async () => {
	vi.clearAllMocks();
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("exportProject", () => {
	it.each(["en", "fr"] as const)(
		"reports every unsupported PDF grapheme with its %s source location",
		async (locale) => {
			const read = readLesson(
				"# Practice\n::: self-check Explain.\nmodel: 王秀英 👩🏽‍💻\n:: Reason\nmissed: Hint.\n:::\n",
			);
			const block = read.blocks.find((block) => block.type === "selfCheck");
			if (!block) throw new Error("Missing self-check");
			const content = readSelfCheckContent(read, block.id);
			block.id = "unicode-block";
			mocks.buildCourseExportInput.mockResolvedValue({
				courseId: "glyphs",
				blocks: read.blocks,
				frontmatter: { title: "Workbook" },
				config: { completionThreshold: 0 },
				resolvedAssets: new Map(),
				viewerVersion: "viewer-1",
				locale,
				selfCheckContents: [selfCheckContentInput(block.id, content)],
				preparedLessons: [
					{
						id: "lesson.prax",
						title: "Practice",
						locale,
						blocks: read.blocks,
						selfCheckContents: new Map([[block.id, content]]),
					},
				],
			});
			mocks.assertExportAccessibility.mockReturnValue([]);
			mocks.getMetricsFromBlocks.mockReturnValue({ pageCount: 1, blockCount: 1 });
			mocks.resolvePdfAssets.mockResolvedValue(new Map());
			const errors = ["王", "秀", "英", "👩", "🏽", "\\u{200d}", "💻", "王"].map(
				(character) =>
					`error: PDF/UA-1 error: the text \`"${character}"\` could not be displayed with font \`"Source Sans 3"\``,
			);
			mocks.exportCoursePdf.mockRejectedValueOnce(
				new Error(
					`Typst compilation failed: ${errors.join('\n/private/temp/input.typ\nSECRET_GENERATED_SOURCE the text `"Z"` could not be displayed\n')}`,
				),
			);
			const expected =
				locale === "en"
					? 'The bundled PDF fonts cannot display: "王", "秀", "英", "👩🏽‍💻". Replace these characters before exporting.\nLesson lesson.prax, block unicode-block: "王", "秀", "英", "👩🏽‍💻".'
					: 'Les polices PDF incluses ne peuvent pas afficher : "王", "秀", "英", "👩🏽‍💻". Remplacez ces caractères avant l’export.\nLeçon lesson.prax, bloc unicode-block : "王", "秀", "英", "👩🏽‍💻".';
			await expect(
				exportProject({
					manifestPolicy: "write" as const,
					projectDir: admittedProjectDir,
					format: "pdf",
					exportAssetsDir: "/missing/export-assets",
					scope: "course",
					fallbackCompletionThreshold: 0.8,
					enforceAccessibility: true,
					includeAnswerSheet: true,
				}),
			).rejects.toMatchObject({ code: "export_failed", message: expected });
		},
	);

	it.each(["html", "scorm-2004", "pdf"] as const)(
		"returns author warnings and file/fix diagnostics for %s",
		async (format) => {
			const warning = {
				code: "lesson-title",
				severity: "warning",
				file: "draft.prax",
				message: "Lesson has no title",
				hint: "Add title: to the lesson frontmatter.",
			};
			mocks.buildCourseExportInput.mockResolvedValue({
				courseId: "warnings",
				blocks: readLesson("# Read\n\nBody\n").blocks,
				frontmatter: { title: "Course" },
				config: { completionThreshold: 0.8 },
				resolvedAssets: new Map(),
				viewerVersion: "viewer-1",
				locale: "en",
				preparedLessons: [],
				authorWarnings: [warning],
			});
			mocks.assertExportAccessibility.mockReturnValue([]);
			mocks.getMetricsFromBlocks.mockReturnValue({ pageCount: 1, blockCount: 1 });
			mocks.compileCourse.mockResolvedValue({ manifest: { revision: "r" }, dispose: vi.fn() });
			mocks.deployCourse.mockResolvedValue({
				zip: Buffer.from("zip"),
				pageCount: 1,
				format: "html",
			});
			mocks.resolvePdfAssets.mockResolvedValue(new Map());
			mocks.exportCoursePdf.mockResolvedValue({ pdf: Buffer.from("%PDF"), diagnostics: [] });
			const result = await exportProject({
				manifestPolicy: "write" as const,
				projectDir: admittedProjectDir,
				format,
				exportAssetsDir: "/studio/export-assets",
				scope: "course",
				fallbackCompletionThreshold: 0.8,
				enforceAccessibility: true,
			});
			expect(result.authorWarnings).toEqual([warning]);
			expect(result.diagnostics).toEqual([
				{
					lessonId: "draft.prax",
					code: "lesson-title",
					message: "Lesson has no title. Add title: to the lesson frontmatter.",
				},
			]);
		},
	);
	it("exports prepared PDF lessons without viewer assets or completion gates", async () => {
		const blocks = readLesson("# Bonjour\n\nWorkbook body.\n").blocks;
		const lessons = [{ id: "lesson", title: "Bonjour", locale: "fr", blocks }];
		const input = {
			courseId: "workbook",
			blocks,
			frontmatter: { title: "Workbook" },
			config: { completionThreshold: 0 },
			resolvedAssets: new Map(),
			viewerVersion: "viewer-1",
			locale: "en",
			preparedLessons: lessons,
		};
		mocks.buildCourseExportInput.mockResolvedValue(input);
		mocks.assertExportAccessibility.mockReturnValue([]);
		mocks.getMetricsFromBlocks.mockReturnValue({ pageCount: 1, blockCount: 1 });
		mocks.resolvePdfAssets.mockResolvedValue(new Map());
		const diagnostics = [
			{
				lessonId: "lesson",
				blockId: "block-1",
				pageTitle: "Page",
				code: "invalid_block_data",
				message: "Skipped a block in the PDF because its content is empty or invalid.",
			},
		];
		mocks.exportCoursePdf.mockResolvedValue({
			pdf: Buffer.from("%PDF"),
			questionCount: 0,
			diagnostics,
		});
		const result = await exportProject({
			manifestPolicy: "write" as const,
			projectDir: admittedProjectDir,
			format: "pdf",
			exportAssetsDir: "/missing/export-assets",
			scope: "course",
			fallbackCompletionThreshold: 0.8,
			enforceAccessibility: true,
			adviceLocale: "fr",
			pageSize: "letter",
			includeAnswerSheet: true,
			passingScore: 0.8,
		});
		expect(result.pdf.toString()).toBe("%PDF");
		expect(result.diagnostics).toEqual(diagnostics);
		expect(result).not.toHaveProperty("zip");
		expect(mocks.assertViewerAssetsReady).not.toHaveBeenCalled();
		expect(mocks.compileCourse).not.toHaveBeenCalled();
		expect(mocks.assertExportAccessibility).toHaveBeenCalledWith(input, true);
		expect(mocks.buildCourseExportInput).toHaveBeenCalledWith(
			expect.objectContaining({
				preparePdf: true,
				includeAnswerSheet: true,
				loadAssets: false,
				requireKnowledgeChecks: false,
				completionThreshold: 0,
				passingScore: undefined,
			}),
		);
		expect(mocks.resolvePdfAssets).toHaveBeenCalledWith(admittedProjectDir, lessons, true, "fr");
		expect(mocks.exportCoursePdf).toHaveBeenCalledWith(
			expect.objectContaining({
				lessons,
				diagnosticLocale: "fr",
				pageSize: "letter",
				includeAnswerSheet: true,
				executablePath: path.resolve("/missing/typst/typst"),
			}),
		);
		mocks.exportCoursePdf.mockRejectedValueOnce(
			new Error(
				"Typst compilation failed: invalid document\n/private/temp/input.typ\nANSWERONLY generated source",
			),
		);
		await expect(
			exportProject({
				manifestPolicy: "write" as const,
				projectDir: admittedProjectDir,
				format: "pdf",
				exportAssetsDir: "/missing/export-assets",
				scope: "course",
				fallbackCompletionThreshold: 0.8,
				enforceAccessibility: true,
			}),
		).rejects.toThrow(/^Typst compilation failed: invalid document$/);
	});
	it("defaults missing rules to pages and respects an explicit false override", async () => {
		const projectDir = await mkdtemp(path.join(os.tmpdir(), "praxity-completion-"));
		tempDirs.push(projectDir);
		const options = { projectDir, fallbackCompletionThreshold: 0.8 };
		expect(await resolveCompletionSettings(options)).toEqual({
			completionThreshold: 0.8,
			requireKnowledgeChecks: false,
			passingScore: undefined,
		});
		await writeFile(
			path.join(projectDir, "praxity.json"),
			JSON.stringify({
				version: 1,
				export: {
					format: "scorm-1.2",
					completionThreshold: 0.9,
					requireKnowledgeChecks: true,
					passingScore: 0.8,
				},
			}),
		);
		expect(await resolveCompletionSettings({ ...options, requireKnowledgeChecks: false })).toEqual({
			completionThreshold: 0.9,
			requireKnowledgeChecks: false,
			passingScore: 0.8,
		});
		expect(await resolveCompletionSettings({ ...options, passingScore: 0.5 })).toEqual({
			completionThreshold: 0.9,
			requireKnowledgeChecks: true,
			passingScore: 0.5,
		});
		// An unusable pass mark must stop the export rather than weaken it to completion-only.
		for (const invalid of [0, 1.5, "0.8", -1]) {
			await writeFile(
				path.join(projectDir, "praxity.json"),
				JSON.stringify({
					version: 1,
					export: {
						format: "scorm-1.2",
						completionThreshold: 0.9,
						requireKnowledgeChecks: true,
						passingScore: invalid,
					},
				}),
			);
			await expect(resolveCompletionSettings(options)).rejects.toThrow(
				"export.passingScore must be a fraction",
			);
		}
	});

	it("applies a saved pass mark to SCORM and standalone HTML", async () => {
		const projectDir = await mkdtemp(path.join(os.tmpdir(), "praxity-pass-mark-"));
		tempDirs.push(projectDir);
		await writeFile(
			path.join(projectDir, "praxity.json"),
			JSON.stringify({
				version: 1,
				export: { format: "scorm-2004", completionThreshold: 0.8, passingScore: 0.7 },
			}),
		);
		const input: DesktopExportInput = {
			courseId: "pass-mark-course",
			blocks: [{ id: "b1", type: "text", data: { content: "<p>Course</p>" } }],
			frontmatter: { title: "Pass mark" },
			config: { completionThreshold: 0.8 },
			resolvedAssets: new Map(),
			viewerVersion: "viewer-1",
			locale: "en",
		};
		mocks.buildCourseExportInput.mockResolvedValue(input);
		mocks.assertExportAccessibility.mockReturnValue([]);
		mocks.getMetricsFromBlocks.mockReturnValue({ pageCount: 1, blockCount: 1 });
		mocks.compileCourse.mockResolvedValue({ manifest: { revision: "r" }, dispose: vi.fn() });
		mocks.deployCourse.mockResolvedValue({ zip: Buffer.from("zip"), pageCount: 1, format: "html" });
		for (const [format, expected] of [
			["scorm-2004", 0.7],
			["html", 0.7],
		] as const) {
			mocks.buildCourseExportInput.mockClear();
			await exportProject({
				manifestPolicy: "write" as const,
				projectDir,
				format,
				exportAssetsDir: "/studio/export-assets",
				scope: "course",
				fallbackCompletionThreshold: 0.8,
				enforceAccessibility: false,
			});
			expect(mocks.buildCourseExportInput).toHaveBeenCalledWith(
				expect.objectContaining({ passingScore: expected }),
			);
		}
	});

	it("estimates SCORM 1.2 progress storage for 1.2 exports and before export", async () => {
		const input: DesktopExportInput = {
			courseId: "storage-course",
			blocks: [{ id: "b1", type: "text", data: { content: "<p>Course</p>" } }],
			frontmatter: { title: "Storage" },
			config: { completionThreshold: 0.8 },
			resolvedAssets: new Map(),
			viewerVersion: "viewer-1",
			locale: "en",
		};
		const estimate = {
			atRisk: false,
			estimatedLength: 557,
			limit: 4096,
			reportingSelfCheckCount: 0,
		};
		mocks.buildCourseExportInput.mockResolvedValue(input);
		mocks.assertExportAccessibility.mockReturnValue([]);
		mocks.getMetricsFromBlocks.mockReturnValue({ pageCount: 1, blockCount: 1 });
		mocks.compileCourse.mockResolvedValue({ manifest: { revision: "r" }, dispose: vi.fn() });
		mocks.deployCourse.mockResolvedValue({
			zip: Buffer.from("zip"),
			pageCount: 1,
			format: "scorm12",
		});
		const options = {
			projectDir: admittedProjectDir,
			exportAssetsDir: "/studio/export-assets",
			scope: "course" as const,
			fallbackCompletionThreshold: 0.8,
			enforceAccessibility: false,
		};

		expect(
			(
				await exportProject({
					manifestPolicy: "write" as const,
					...options,
					format: "scorm-1.2",
				})
			).scorm12Storage,
		).toEqual(estimate);
		expect(
			(
				await exportProject({
					manifestPolicy: "write" as const,
					...options,
					format: "scorm-2004",
				})
			).scorm12Storage,
		).toBeUndefined();

		mocks.buildCourseExportInput.mockClear();
		expect(
			await estimateProjectScorm12Storage({
				projectDir: admittedProjectDir,
				exportAssetsDir: "/studio/export-assets",
				scope: "lesson",
				lessonFilename: "intro.prax",
			}),
		).toEqual(estimate);
		expect(mocks.buildCourseExportInput).toHaveBeenCalledWith(
			expect.objectContaining({
				projectDir: admittedProjectDir,
				scope: "lesson",
				lessonFilename: "intro.prax",
				loadAssets: false,
			}),
		);
	});
});
