import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CourseHomeUrlError } from "../../shared/course-manifest";
import { ExportAccessibilityError } from "../export/accessibility-enforcement";

const mocks = vi.hoisted(() => ({ exportProject: vi.fn() }));

vi.mock("../export/export-project", () => ({
	exportProject: mocks.exportProject,
	ProjectExportError: class ProjectExportError extends Error {},
}));

import { runPraxityCli } from "../cli";

const tempDirs: string[] = [];
const runtime = { appVersion: "0.1.2", exportAssetsDir: "/studio/export-assets" };

beforeAll(async () => {
	// The first compiler refusal lazily loads the real error classes from this module.
	await import("@praxity/export-pipeline");
});

afterEach(async () => {
	vi.clearAllMocks();
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Praxity CLI", () => {
	it.each([
		["en", "courseHomeUrl must be a relative URL or an absolute HTTPS URL."],
		["fr", "courseHomeUrl doit être une URL relative ou une URL HTTPS absolue."],
	])("localizes a manifest URL refusal with --lang %s", async (locale, message) => {
		const root = await mkdtemp(path.join(os.tmpdir(), "praxity-cli-home-"));
		tempDirs.push(root);
		mocks.exportProject.mockRejectedValue(
			new Error("Invalid project", { cause: new CourseHomeUrlError() }),
		);
		const result = await runPraxityCli(
			[
				"export",
				root,
				"--format",
				"html",
				"--output",
				path.join(root, "course.zip"),
				"--lang",
				locale,
			],
			runtime,
		);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error.message).toBe(message);
		expect(result.stderr).toContain(message);
	});
	it("writes a PDF with the same host options and preserves an existing PDF on failure", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "praxity-cli-pdf-"));
		tempDirs.push(root);
		const output = path.join(root, "course.pdf");
		await writeFile(output, "previous");
		const diagnostics = [
			{
				lessonId: "module-1",
				blockId: "block-1",
				pageTitle: "Page one",
				code: "invalid_block_data",
				message: "Skipped a block in the PDF because its content is empty or invalid.",
			},
		];
		mocks.exportProject.mockResolvedValue({
			pdf: Buffer.from("%PDF-new"),
			diagnostics,
			title: "Course",
			pageCount: 2,
			criticalAccessibilityIssues: [],
		});
		const args = [
			"export",
			root,
			"--format",
			"pdf",
			"--output",
			output,
			"--paper-size",
			"letter",
			"--include-answer-sheet",
		];
		const execution = await runPraxityCli(args, runtime);
		expect(execution.exitCode).toBe(0);
		expect(JSON.parse(execution.stdout).diagnostics).toEqual(diagnostics);
		expect(execution.stderr).toContain("module-1 / block-1: Skipped a block in the PDF");
		expect(mocks.exportProject).toHaveBeenCalledWith(
			expect.objectContaining({ format: "pdf", pageSize: "letter", includeAnswerSheet: true }),
		);
		expect(await readFile(output, "utf8")).toBe("%PDF-new");
		mocks.exportProject.mockRejectedValue(new Error("Compiler failed"));
		expect((await runPraxityCli(args, runtime)).exitCode).toBe(1);
		expect(await readFile(output, "utf8")).toBe("%PDF-new");
	});
	it.each([
		["--format", "pdf", "--output", "course.zip"],
		["--format", "pdf", "--output", "course.pdf", "--paper-size", "legal"],
		["--format", "html", "--output", "course.zip", "--include-answer-sheet"],
	])("rejects incompatible PDF options: format $1, output $3, extra $4 $5", async (...options) => {
		expect((await runPraxityCli(["export", "/project", ...options], runtime)).exitCode).toBe(2);
		expect(mocks.exportProject).not.toHaveBeenCalled();
	});

	it("replaces the exact ZIP and reports an accessibility override", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "praxity-cli-"));
		tempDirs.push(root);
		const projectDir = path.join(root, "course");
		const outputPath = path.join(root, "course.zip");
		await mkdir(projectDir);
		await writeFile(outputPath, "old");
		const issues = [{ severity: "critical" as const, rule: "image-alt", message: "Add alt text" }];
		mocks.exportProject.mockResolvedValue({
			zip: Buffer.from("new zip"),
			title: "Course",
			pageCount: 3,
			blockCount: 5,
			criticalAccessibilityIssues: issues,
		});

		const execution = await runPraxityCli(
			[
				"export",
				projectDir,
				"--format",
				"scorm-2004",
				"--output",
				outputPath,
				"--allow-critical-a11y-issues",
			],
			runtime,
		);

		expect(execution.exitCode).toBe(0);
		expect(JSON.parse(execution.stdout)).toEqual(
			expect.objectContaining({
				ok: true,
				outputPath,
				format: "scorm-2004",
				pageCount: 3,
				accessibility: expect.objectContaining({
					status: "overridden",
					criticalIssueCount: 1,
				}),
			}),
		);
		expect(execution.stderr).toContain("exported with 1 critical accessibility issue");
		expect(await readFile(outputPath, "utf-8")).toBe("new zip");
		expect(mocks.exportProject).toHaveBeenCalledWith(
			expect.objectContaining({
				projectDir: await realpath(projectDir),
				format: "scorm-2004",
				scope: "course",
				fallbackCompletionThreshold: 1,
				enforceAccessibility: false,
			}),
		);
	});

	it.each([0, 1])(
		"warns for a long SCORM 1.2 course with %i reporting self-checks",
		async (reportingSelfCheckCount) => {
			const root = await mkdtemp(path.join(os.tmpdir(), "praxity-cli-"));
			tempDirs.push(root);
			const projectDir = path.join(root, "course");
			await mkdir(projectDir);
			const scorm12Storage = {
				atRisk: true,
				estimatedLength: 11548,
				limit: 4096,
				reportingSelfCheckCount,
			};
			mocks.exportProject.mockResolvedValue({
				zip: Buffer.from("zip"),
				title: "Course",
				pageCount: 250,
				blockCount: 250,
				criticalAccessibilityIssues: [],
				scorm12Storage,
			});

			const execution = await runPraxityCli(
				["export", projectDir, "--format", "scorm-1.2", "--output", path.join(root, "course.zip")],
				runtime,
			);

			expect(execution.exitCode).toBe(0);
			expect(JSON.parse(execution.stdout)).toEqual(
				expect.objectContaining({ ok: true, format: "scorm-1.2", scorm12Storage }),
			);
			expect(execution.stderr).toBe(
				reportingSelfCheckCount > 0
					? "Warning: a full attempt needs about 11548 characters of SCORM 1.2 progress storage, which holds 4096. Progress and answer text may exceed SCORM 1.2's storage limit. Export to SCORM 2004 if your LMS supports it, or use device-only mode for self-check answers.\n"
					: "Warning: a full attempt needs about 11548 characters of SCORM 1.2 progress storage, which holds 4096. This course may be too long for SCORM 1.2. Progress may stop saving partway through. Export to SCORM 2004 if your LMS supports it.\n",
			);

			mocks.exportProject.mockResolvedValue({
				zip: Buffer.from("zip"),
				title: "Course",
				pageCount: 3,
				blockCount: 3,
				criticalAccessibilityIssues: [],
				scorm12Storage: {
					atRisk: false,
					estimatedLength: 700,
					limit: 4096,
					reportingSelfCheckCount: 0,
				},
			});
			const fits = await runPraxityCli(
				["export", projectDir, "--format", "scorm-1.2", "--output", path.join(root, "course.zip")],
				runtime,
			);
			expect(fits.exitCode).toBe(0);
			expect(fits.stderr).toBe("");
		},
	);

	it("returns structured accessibility failures in strict mode", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "praxity-cli-"));
		tempDirs.push(root);
		const projectDir = path.join(root, "course");
		await mkdir(projectDir);
		mocks.exportProject.mockRejectedValue(
			new ExportAccessibilityError([
				{
					severity: "critical",
					rule: "image-alt",
					outcome: "failed",
					message: "Add alt text",
					sourceLocation: "data.altText",
				},
			]),
		);

		const execution = await runPraxityCli(
			["export", projectDir, "--format", "html", "--output", path.join(root, "course.zip")],
			runtime,
		);

		expect(execution.exitCode).toBe(1);
		expect(JSON.parse(execution.stdout)).toEqual(
			expect.objectContaining({
				ok: false,
				error: expect.objectContaining({
					code: "accessibility_blocked",
					details: expect.objectContaining({ criticalIssueCount: 1 }),
				}),
			}),
		);
		expect(mocks.exportProject).toHaveBeenCalledWith(
			expect.objectContaining({ enforceAccessibility: true }),
		);
	});

	it("uses exit status 2 for invalid command usage", async () => {
		const execution = await runPraxityCli(
			["export", "/tmp/course", "--format", "html", "--output", "/tmp/course.html"],
			runtime,
		);

		expect(execution.exitCode).toBe(2);
		expect(JSON.parse(execution.stdout).error.code).toBe("invalid_arguments");
		expect(mocks.exportProject).not.toHaveBeenCalled();
	});
});

it.each(["inspect", "export"])(
	"refuses missing, invalid and duplicate advice language for %s",
	async (command) => {
		for (const options of [["--lang"], ["--lang", "de"], ["--lang", "fr", "--lang", "en"]]) {
			const result = await runPraxityCli([command, "unused", ...options], runtime);
			expect(result.exitCode).toBe(2);
			expect(JSON.parse(result.stdout).error.code).toBe("invalid_arguments");
			expect(result.stderr).toContain(
				options[1] === "fr" ? "--lang attend en ou fr" : "--lang requires en or fr",
			);
		}
	},
);
it.each(["en", "fr"])("export advice uses %s rather than the course locale", async (language) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "praxity-cli-advice-"));
	tempDirs.push(root);
	mocks.exportProject.mockResolvedValue({
		zip: Buffer.from("zip"),
		title: "French course",
		pageCount: 1,
		criticalAccessibilityIssues: [],
		narrationWarnings: [{ code: "ENARRATIONSELFCHECKSPOILER", file: "french.prax", line: 9 }],
	});
	const result = await runPraxityCli(
		[
			"export",
			root,
			"--format",
			"html",
			"--output",
			path.join(root, "course.zip"),
			"--lang",
			language,
		],
		runtime,
	);
	expect(result.exitCode, result.stderr).toBe(0);
	expect(result.stderr).toContain(
		language === "en" ? "french.prax: Line 9:" : "french.prax: Ligne 9",
	);
	expect(JSON.parse(result.stdout).warnings).toEqual([
		{ code: "ENARRATIONSELFCHECKSPOILER", file: "french.prax", line: 9 },
	]);
});
