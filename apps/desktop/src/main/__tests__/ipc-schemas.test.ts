import { describe, expect, it } from "vitest";
import {
	grammarSourceSchema,
	narrationCleanupSchema,
	projectConfigSchema,
} from "../../shared/ipc-schemas";

describe("IPC Zod schemas", () => {
	it("refuses oversized narration cleanup before validating its elements", () => {
		const result = narrationCleanupSchema.safeParse({
			paths: Array(1_000).fill(0),
			currentSource: "",
		});
		expect(result.success).toBe(false);
		if (result.success) throw new Error("Expected oversized cleanup refusal");
		expect(result.error.issues).toEqual([
			expect.objectContaining({ code: "too_big", path: ["paths"], maximum: 2 }),
		]);
	});

	describe("grammarSourceSchema", () => {
		it("accepts valid grammar text", () => {
			const result = grammarSourceSchema.safeParse("---\ntitle: Hello\n---\n\n--- Intro\n");
			expect(result.success).toBe(true);
		});

		it("rejects grammar exceeding 5MB", () => {
			const huge = "x".repeat(5_000_001);
			const result = grammarSourceSchema.safeParse(huge);
			expect(result.success).toBe(false);
		});
	});

	describe("projectConfigSchema", () => {
		it("accepts valid config", () => {
			const result = projectConfigSchema.safeParse({
				version: 1,
				export: { format: "scorm-1.2", completionThreshold: 0.8 },
			});
			expect(result.success).toBe(true);
		});

		it("accepts old projects and validates the persisted completion rule", () => {
			const config = { version: 1, export: { format: "scorm-1.2", completionThreshold: 0.8 } };
			expect(projectConfigSchema.parse(config).export.requireKnowledgeChecks ?? false).toBe(false);
			expect(
				projectConfigSchema.parse({
					...config,
					export: { ...config.export, requireKnowledgeChecks: true },
				}).export.requireKnowledgeChecks,
			).toBe(true);
			expect(
				projectConfigSchema.safeParse({
					...config,
					export: { ...config.export, requireKnowledgeChecks: "true" },
				}).success,
			).toBe(false);
		});

		it("validates the optional fractional passing score", () => {
			const config = { version: 1, export: { format: "scorm-1.2", completionThreshold: 0.8 } };
			expect(projectConfigSchema.parse(config).export.passingScore).toBeUndefined();
			expect(
				projectConfigSchema.parse({ ...config, export: { ...config.export, passingScore: 0.5 } })
					.export.passingScore,
			).toBe(0.5);
			for (const passingScore of [0, 1.5]) {
				expect(
					projectConfigSchema.safeParse({ ...config, export: { ...config.export, passingScore } })
						.success,
				).toBe(false);
			}
		});

		it("accepts html export format", () => {
			const result = projectConfigSchema.safeParse({
				version: 1,
				export: { format: "html", completionThreshold: 0.8 },
			});
			expect(result.success).toBe(true);
		});

		it("discards the retired badge field from older persisted config", () => {
			const result = projectConfigSchema.parse({
				version: 1,
				export: { format: "html", completionThreshold: 0.8 },
				badge: false,
			});
			expect(result).not.toHaveProperty("badge");
		});

		it("rejects invalid export format", () => {
			const result = projectConfigSchema.safeParse({
				version: 1,
				export: { format: "scorm-3.0", completionThreshold: 0.8 },
			});
			expect(result.success).toBe(false);
		});

		it("rejects completionThreshold > 1", () => {
			const result = projectConfigSchema.safeParse({
				version: 1,
				export: { format: "scorm-1.2", completionThreshold: 1.5 },
			});
			expect(result.success).toBe(false);
		});
	});
});
