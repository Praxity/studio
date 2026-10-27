import { describe, expect, it } from "vitest";
import {
	assetReadSchema,
	assetWriteSchema,
	grammarSourceSchema,
	narrationCleanupSchema,
	narrationSynthesizeSchema,
	projectConfigSchema,
	settingsKeySchema,
	settingsSetSchema,
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

	describe("assetWriteSchema", () => {
		it("accepts valid asset", () => {
			const result = assetWriteSchema.safeParse({
				filename: "hero.webp",
				data: new Uint8Array([1, 2, 3]),
			});
			expect(result.success).toBe(true);
		});

		it("rejects filename with path traversal", () => {
			const result = assetWriteSchema.safeParse({
				filename: "../etc/passwd",
				data: new Uint8Array([1]),
			});
			expect(result.success).toBe(false);
		});

		it("rejects filename with forward slash", () => {
			const result = assetWriteSchema.safeParse({
				filename: "sub/dir/file.png",
				data: new Uint8Array([1]),
			});
			expect(result.success).toBe(false);
		});

		it("rejects filename with backslash", () => {
			const result = assetWriteSchema.safeParse({
				filename: "sub\\dir\\file.png",
				data: new Uint8Array([1]),
			});
			expect(result.success).toBe(false);
		});
	});

	describe("assetReadSchema", () => {
		it("accepts valid asset path", () => {
			const result = assetReadSchema.safeParse({ relativePath: "assets/hero.webp" });
			expect(result.success).toBe(true);
		});

		it("rejects path traversal", () => {
			const result = assetReadSchema.safeParse({ relativePath: "../secret.txt" });
			expect(result.success).toBe(false);
		});
	});

	describe("narrationSynthesizeSchema", () => {
		const valid = {
			requestId: "request-1",
			originalScript: "Welcome.",
			language: "en",
			voice: "Maya",
			speed: 1,
			lexemes: [{ grapheme: "WCAG", alias: "W C A G", lang: "en" }],
			segmentId: "welcome:text-1",
		};

		it("accepts bounded, typed generation input", () => {
			expect(narrationSynthesizeSchema.safeParse(valid).success).toBe(true);
		});

		it("rejects excessive text, unsafe voice IDs, and unsupported languages", () => {
			expect(
				narrationSynthesizeSchema.safeParse({ ...valid, originalScript: "x".repeat(5_001) })
					.success,
			).toBe(false);
			expect(narrationSynthesizeSchema.safeParse({ ...valid, voice: "../../key" }).success).toBe(
				false,
			);
			expect(narrationSynthesizeSchema.safeParse({ ...valid, language: "de" }).success).toBe(false);
		});
	});

	describe("settingsKeySchema", () => {
		it("accepts valid settings keys", () => {
			expect(settingsKeySchema.safeParse("locale").success).toBe(true);
			expect(settingsKeySchema.safeParse("autoSave").success).toBe(true);
			expect(settingsKeySchema.safeParse("telemetryUsageData").success).toBe(true);
			expect(settingsKeySchema.safeParse("editorTheme").success).toBe(true);
			expect(settingsKeySchema.safeParse("appearance").success).toBe(true);
			expect(settingsKeySchema.safeParse("editorLineLength").success).toBe(true);
			expect(settingsKeySchema.safeParse("contentDensityWarnings").success).toBe(true);
			expect(settingsKeySchema.safeParse("showNarrationControls").success).toBe(true);
			expect(settingsKeySchema.safeParse("narrationControlsAutoEnabled").success).toBe(true);
			expect(settingsKeySchema.safeParse("uiScale").success).toBe(true);
			expect(settingsKeySchema.safeParse("reviewShareUrl").success).toBe(true);
			expect(settingsKeySchema.safeParse("reviewShareToken").success).toBe(true);
			expect(settingsKeySchema.safeParse("accessibilityExportEnforced").success).toBe(true);
		});

		it("rejects unknown keys", () => {
			expect(settingsKeySchema.safeParse("databaseUrl").success).toBe(false);
		});
	});

	describe("settingsSetSchema", () => {
		it("accepts valid key/value pairs", () => {
			expect(
				settingsSetSchema.safeParse({
					key: "locale",
					value: "fr",
				}).success,
			).toBe(true);
			expect(
				settingsSetSchema.safeParse({
					key: "editorTheme",
					value: "dracula",
				}).success,
			).toBe(true);
			expect(
				settingsSetSchema.safeParse({
					key: "appearance",
					value: "light",
				}).success,
			).toBe(true);
			expect(
				settingsSetSchema.safeParse({
					key: "theme",
					value: "dark",
				}).success,
			).toBe(true);
			expect(
				settingsSetSchema.safeParse({
					key: "defaultExportFormat",
					value: "html",
				}).success,
			).toBe(true);
			expect(
				settingsSetSchema.safeParse({
					key: "editorLineLength",
					value: 120,
				}).success,
			).toBe(true);
			expect(
				settingsSetSchema.safeParse({
					key: "contentDensityWarnings",
					value: true,
				}).success,
			).toBe(true);
			expect(
				settingsSetSchema.safeParse({
					key: "showNarrationControls",
					value: true,
				}).success,
			).toBe(true);
			expect(
				settingsSetSchema.safeParse({
					key: "narrationControlsAutoEnabled",
					value: true,
				}).success,
			).toBe(true);
			expect(
				settingsSetSchema.safeParse({
					key: "uiScale",
					value: 1.25,
				}).success,
			).toBe(true);
			expect(
				settingsSetSchema.safeParse({
					key: "reviewShareUrl",
					value: "https://reviews.example",
				}).success,
			).toBe(true);
			expect(
				settingsSetSchema.safeParse({
					key: "reviewShareToken",
					value: "secret",
				}).success,
			).toBe(true);
		});

		it("rejects invalid value types for known keys", () => {
			expect(
				settingsSetSchema.safeParse({
					key: "telemetryUsageData",
					value: "yes",
				}).success,
			).toBe(false);
			expect(
				settingsSetSchema.safeParse({
					key: "windowBounds",
					value: { x: 0, y: 0 },
				}).success,
			).toBe(false);
			expect(
				settingsSetSchema.safeParse({
					key: "uiScale",
					value: 0.4,
				}).success,
			).toBe(false);
			expect(
				settingsSetSchema.safeParse({
					key: "uiScale",
					value: 2.1,
				}).success,
			).toBe(false);
		});

		it("does not allow the generic settings setter to disable export enforcement", () => {
			expect(
				settingsSetSchema.safeParse({
					key: "accessibilityExportEnforced",
					value: false,
				}).success,
			).toBe(false);
		});

		it("does not allow the generic settings setter to change main-owned paths", () => {
			expect(
				settingsSetSchema.safeParse({ key: "activeWorkspace", value: "/tmp/workspace" }).success,
			).toBe(false);
			expect(
				settingsSetSchema.safeParse({ key: "recentExportPath", value: "/tmp/exports" }).success,
			).toBe(false);
		});
	});
});
