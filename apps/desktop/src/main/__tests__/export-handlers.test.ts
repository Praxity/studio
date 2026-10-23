import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { PraxityBridge } from "../../shared/bridge";
import {
	type ExportFormat,
	type ExportRequest,
	type ExportRequestWithDestination,
	exportScormSchema,
} from "../../shared/ipc-schemas";

describe("exportScormSchema", () => {
	it("shares the incoming contract while keeping scope defaulting and destination requirements", () => {
		expectTypeOf<ExportRequest>().toEqualTypeOf<z.input<typeof exportScormSchema>>();
		expectTypeOf<Parameters<PraxityBridge["exportScorm"]>[0]>().toEqualTypeOf<ExportRequest>();
		expectTypeOf<ExportFormat>().toEqualTypeOf<
			"scorm-1.2" | "scorm-2004" | "xapi" | "html" | "pdf"
		>();
		expectTypeOf<keyof ExportRequest>().toEqualTypeOf<
			| "format"
			| "locale"
			| "pageSize"
			| "includeAnswerSheet"
			| "scorm2004Edition"
			| "completionThreshold"
			| "requireKnowledgeChecks"
			| "passingScore"
			| "outputDir"
			| "scope"
			| "lessonFilename"
		>();
		expectTypeOf<ExportRequest["scope"]>().toEqualTypeOf<"lesson" | "course" | undefined>();
		expectTypeOf<ExportRequest["outputDir"]>().toEqualTypeOf<string | undefined>();
		expectTypeOf<ExportRequestWithDestination["scope"]>().toEqualTypeOf<"lesson" | "course">();
		expectTypeOf<ExportRequestWithDestination["outputDir"]>().toEqualTypeOf<string>();
		const request: ExportRequest = { format: "pdf" };
		expect(exportScormSchema.parse(request)).toEqual({ format: "pdf", scope: "lesson" });
	});
	it("validates PDF settings without accepting a renderer compiler path", () => {
		const options = exportScormSchema.parse({
			format: "pdf",
			pageSize: "letter",
			includeAnswerSheet: true,
			typstExecutablePath: "/tmp/untrusted",
		});
		expect(options).toMatchObject({ format: "pdf", pageSize: "letter", includeAnswerSheet: true });
		expect(options).not.toHaveProperty("typstExecutablePath");
		expect(exportScormSchema.safeParse({ format: "pdf", pageSize: "legal" }).success).toBe(false);
		expect(exportScormSchema.safeParse({ format: "pdf", includeAnswerSheet: "yes" }).success).toBe(
			false,
		);
	});
	it("accepts valid SCORM 1.2 input", () => {
		const result = exportScormSchema.safeParse({
			format: "scorm-1.2",
			completionThreshold: 0.8,
		});
		expect(result.success).toBe(true);
	});

	it("validates the optional knowledge check rule at the export boundary", () => {
		expect(
			exportScormSchema.parse({ format: "scorm-1.2", requireKnowledgeChecks: true })
				.requireKnowledgeChecks,
		).toBe(true);
		expect(
			exportScormSchema.safeParse({ format: "scorm-1.2", requireKnowledgeChecks: "true" }).success,
		).toBe(false);
	});

	it("validates the optional fractional passing score", () => {
		expect(exportScormSchema.parse({ format: "xapi", passingScore: 0.8 }).passingScore).toBe(0.8);
		for (const passingScore of [0, 1.5]) {
			expect(exportScormSchema.safeParse({ format: "xapi", passingScore }).success).toBe(false);
		}
	});

	it("accepts valid SCORM 2004 input", () => {
		const result = exportScormSchema.safeParse({
			format: "scorm-2004",
			scorm2004Edition: "4th",
			completionThreshold: 1,
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.scorm2004Edition).toBe("4th");
	});

	it("accepts valid HTML input", () => {
		const result = exportScormSchema.safeParse({
			format: "html",
			outputDir: "/tmp/exports",
		});
		expect(result.success).toBe(true);
	});

	it("accepts input without optional completionThreshold", () => {
		const result = exportScormSchema.safeParse({ format: "scorm-1.2" });
		expect(result.success).toBe(true);
	});

	it("defaults scope to lesson", () => {
		const result = exportScormSchema.safeParse({ format: "scorm-1.2" });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.scope).toBe("lesson");
		}
	});

	it("accepts course scope", () => {
		const result = exportScormSchema.safeParse({
			format: "scorm-2004",
			scope: "course",
		});
		expect(result.success).toBe(true);
	});

	it("strips an accessibility override flag from the export IPC payload", () => {
		const result = exportScormSchema.safeParse({
			format: "scorm-2004",
			scope: "course",
			allowA11yViolations: true,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).not.toHaveProperty("allowA11yViolations");
		}
	});

	it("accepts lesson scope with .prax lesson filename", () => {
		const result = exportScormSchema.safeParse({
			format: "html",
			scope: "lesson",
			lessonFilename: "intro.prax",
		});
		expect(result.success).toBe(true);
	});

	it("rejects outputDir path traversal", () => {
		const result = exportScormSchema.safeParse({
			format: "html",
			outputDir: "../tmp/exports",
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid format", () => {
		const result = exportScormSchema.safeParse({
			format: "scorm-3.0",
			completionThreshold: 0.8,
		});
		expect(result.success).toBe(false);
	});

	it("rejects completionThreshold > 1", () => {
		const result = exportScormSchema.safeParse({
			format: "scorm-1.2",
			completionThreshold: 1.5,
		});
		expect(result.success).toBe(false);
	});

	it("rejects completionThreshold < 0", () => {
		const result = exportScormSchema.safeParse({
			format: "scorm-1.2",
			completionThreshold: -0.1,
		});
		expect(result.success).toBe(false);
	});

	it("rejects lessonFilename values without .prax extension", () => {
		const result = exportScormSchema.safeParse({
			format: "html",
			scope: "lesson",
			lessonFilename: "intro.md",
		});
		expect(result.success).toBe(false);
	});

	it("rejects lessonFilename path traversal", () => {
		expect(
			exportScormSchema.safeParse({
				format: "html",
				lessonFilename: "../intro.prax",
			}).success,
		).toBe(false);
	});
});
