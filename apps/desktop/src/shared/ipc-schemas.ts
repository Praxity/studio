import { z } from "zod";

/**
 * Zod schemas for validating IPC inputs in the main process.
 * Every ipcMain.handle() call validates its arguments before processing.
 */

export const studioPortSchema = z.number().int().min(1).max(65_535);

export const grammarSourceSchema = z.string().max(5_000_000);

export const narrationAuthoringReadSchema = z
	.object({
		filename: z.string().regex(/^[^/\\:\x00-\x1f]+\.prax$/i),
		source: grammarSourceSchema.optional(),
	})
	.strict();
export const narrationAuthoringWriteSchema = z
	.object({
		source: grammarSourceSchema,
		expectedSource: grammarSourceSchema.nullable(),
	})
	.strict();

export const projectConfigSchema = z.object({
	version: z.number().int().positive(),
	export: z.object({
		format: z.enum(["scorm-1.2", "scorm-2004", "html"]),
		completionThreshold: z.number().min(0).max(1),
		requireKnowledgeChecks: z.boolean().optional(),
		passingScore: z.number().gt(0).max(1).optional(),
	}),
	cloud: z
		.object({
			projectId: z.string(),
		})
		.optional(),
});

export const sampleCourseCreateSchema = z.object({
	/** Omitted means "use the stored UI locale". */
	locale: z.enum(["en", "fr"]).optional(),
});

export const assetWriteSchema = z.object({
	filename: z
		.string()
		.min(1)
		.max(255)
		.refine(
			(name) => !name.includes("..") && !name.includes("/") && !name.includes("\\"),
			"Filename must not contain path separators or parent references",
		),
	data: z
		.instanceof(Uint8Array)
		.refine((arr) => arr.byteLength <= 50_000_000, "Asset exceeds 50MB limit"),
});

export const assetReadSchema = z.object({
	relativePath: z
		.string()
		.min(1)
		.refine((p) => !p.includes(".."), "Asset path must not contain parent directory references")
		.refine((p) => p.startsWith("assets/"), "Asset path must be inside assets"),
});

const narrationLanguageSchema = z.enum(["en", "fr"]);
const narrationVoiceSchema = z
	.string()
	.min(1)
	.max(50)
	.regex(/^\w[\w-]*$/u);
const pronunciationLexemeSchema = z.object({
	grapheme: z.string().min(1).max(100),
	alias: z.string().min(1).max(200),
	lang: narrationLanguageSchema,
});

export const narrationConfigureSchema = z.object({
	apiKey: z.string().trim().min(1).max(250).nullable(),
	region: z.enum(["eu", "us", "jp"]),
});

export const narrationSynthesizeSchema = z.object({
	requestId: z.string().min(1).max(100),
	originalScript: z.string().trim().min(1).max(5_000),
	language: narrationLanguageSchema,
	voice: narrationVoiceSchema,
	speed: z.number().min(0.7).max(1.3),
	lexemes: z.array(pronunciationLexemeSchema).max(500),
	segmentId: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/u),
});

export const narrationCancelSchema = z.object({ requestId: z.string().min(1).max(100) });
export const narrationAttachSchema = z.object({
	kind: z.enum(["audio", "timings"]),
	script: z.string().max(5_000).optional(),
});
export const narrationCleanupSchema = z.object({
	paths: z
		.array(z.string().regex(/^assets\/narration\/narration-[a-f0-9]{12}\.(?:mp3|vtt)$/u))
		.max(2),
	currentSource: z.string().max(5_000_000),
});

export const filePathSchema = z
	.string()
	.min(1)
	.refine((p) => !p.includes(".."), "Path must not contain parent directory references");

export const projectTextFileReadSchema = z.object({
	relativePath: z
		.string()
		.min(1)
		.refine((p) => !p.includes(".."), "Path must not contain parent directory references"),
});

export const projectTextFileWriteSchema = z.object({
	relativePath: z
		.string()
		.min(1)
		.refine((p) => !p.includes(".."), "Path must not contain parent directory references"),
	content: z.string().max(5_000_000),
	expectedContent: z.string().max(5_000_000).optional(),
});

export const renameFileSchema = z.object({
	oldPath: filePathSchema,
	newPath: filePathSchema,
});

export const workspaceScanSchema = z.object({
	dirPath: z.string().min(1),
});

export const workspaceSwitchSchema = z.object({
	projectPath: z.string().min(1),
});

const lessonFilenameSchema = z
	.string()
	.min(1)
	.max(255)
	.regex(/^[^/\\]+\.prax$/i, { message: "Must be a .prax filename" });

export const coursePreviewBuildSchema = z.object({
	scope: z.literal("lesson"),
	lessonFilename: lessonFilenameSchema,
	source: grammarSourceSchema,
});

export const courseLoadSchema = z.object({
	courseDir: z
		.string()
		.min(1)
		.refine((p) => !p.includes(".."), { message: "No path traversal" }),
});

export const courseLessonSchema = z.object({
	courseDir: z
		.string()
		.min(1)
		.refine((p) => !p.includes(".."), { message: "No path traversal" }),
	filename: lessonFilenameSchema,
});

/** Browser authoring admits visible lesson names without streams or control characters. */
export const studioLessonFilenameSchema = courseLessonSchema.shape.filename.refine(
	(filename) => !filename.startsWith(".") && !/[:\x00-\x1f]/u.test(filename),
);

export const courseWriteLessonSchema = courseLessonSchema.extend({
	grammar: z.string().max(5_000_000),
	expectedGrammar: z.string().max(5_000_000).optional(),
});

export const courseCreateLessonSchema = z.object({
	courseDir: z.string().min(1),
	lessonName: z.string().min(1).max(255),
});

export const exportScormSchema = z.object({
	/** Author UI language for export advice, independent of course language. */
	locale: z.enum(["en", "fr"]).optional(),
	format: z.enum(["scorm-1.2", "scorm-2004", "xapi", "html", "pdf"]),
	pageSize: z.enum(["a4", "letter"]).optional(),
	includeAnswerSheet: z.boolean().optional(),
	scorm2004Edition: z.enum(["3rd", "4th"]).optional(),
	completionThreshold: z.number().min(0).max(1).optional(),
	requireKnowledgeChecks: z.boolean().optional(),
	passingScore: z.number().gt(0).max(1).optional(),
	outputDir: z
		.string()
		.min(1)
		.refine(
			(p) => !p.includes(".."),
			"Output directory must not contain parent directory references",
		)
		.optional(),
	scope: z.enum(["lesson", "course"]).default("lesson"),
	lessonFilename: lessonFilenameSchema.optional(),
});

/** Incoming request fields before the schema supplies defaults. */
export type ExportRequest = z.input<typeof exportScormSchema>;
export type ExportFormat = ExportRequest["format"];
export type ExportRequestWithDestination = ExportRequest & {
	outputDir: NonNullable<ExportRequest["outputDir"]>;
	scope: NonNullable<ExportRequest["scope"]>;
};

/** Which lessons an export, review share or export estimate covers. */
export const exportScopeSchema = z.object({
	scope: z.enum(["lesson", "course"]).default("lesson"),
	lessonFilename: lessonFilenameSchema.optional(),
});

export const shareReviewSchema = exportScopeSchema;

export const settingsKeySchema = z.enum([
	"locale",
	"autoSave",
	"autoSaveIntervalMs",
	"autoUpdate",
	"updateChannel",
	"telemetryUsageData",
	"telemetryCrashReports",
	"telemetryDistinctId",
	"recentProjects",
	"windowBounds",
	"editorTheme",
	"appearance",
	"theme",
	"defaultExportFormat",
	"defaultCompletionThreshold",
	"accessibilityExportEnforced",
	"lastAccessibilityOverrideExport",
	"smartPunctuation",
	"recentExportPath",
	"firstLaunchComplete",
	"activeWorkspace",
	"leftSidebarMode",
	"recentWorkspaces",
	"editorLineLength",
	"contentDensityWarnings",
	"showNarrationControls",
	"narrationControlsAutoEnabled",
	"sonioxDisclosureShown",
	"uiScale",
	"reviewShareUrl",
	"reviewShareToken",
]);

export const accessibilityExportEnforcementRequestSchema = z.discriminatedUnion("enforced", [
	z.object({ enforced: z.literal(true) }),
	z.object({
		enforced: z.literal(false),
		confirmation: z.object({
			title: z.string().min(1).max(200),
			message: z.string().min(1).max(500),
			detail: z.string().min(1).max(1_000),
			confirmLabel: z.string().min(1).max(100),
			cancelLabel: z.string().min(1).max(100),
		}),
	}),
]);

export const settingsSetSchema = z.discriminatedUnion("key", [
	z.object({ key: z.literal("locale"), value: z.enum(["en", "fr"]) }),
	z.object({ key: z.literal("autoSave"), value: z.boolean() }),
	z.object({ key: z.literal("autoSaveIntervalMs"), value: z.number().int().positive() }),
	z.object({ key: z.literal("autoUpdate"), value: z.boolean() }),
	z.object({ key: z.literal("updateChannel"), value: z.enum(["stable", "beta"]) }),
	z.object({ key: z.literal("telemetryUsageData"), value: z.boolean() }),
	z.object({ key: z.literal("telemetryCrashReports"), value: z.boolean() }),
	z.object({ key: z.literal("editorTheme"), value: z.string().min(1) }),
	z.object({ key: z.literal("appearance"), value: z.enum(["system", "light", "dark"]) }),
	z.object({ key: z.literal("theme"), value: z.enum(["system", "light", "dark"]) }),
	z.object({
		key: z.literal("defaultExportFormat"),
		value: z.enum(["scorm-1.2", "scorm-2004", "xapi", "html"]),
	}),
	z.object({
		key: z.literal("defaultCompletionThreshold"),
		value: z.number().min(0).max(1),
	}),
	z.object({ key: z.literal("smartPunctuation"), value: z.boolean() }),
	z.object({ key: z.literal("showNarrationControls"), value: z.boolean() }),
	z.object({ key: z.literal("narrationControlsAutoEnabled"), value: z.boolean() }),
	z.object({ key: z.literal("firstLaunchComplete"), value: z.boolean() }),
	z.object({
		key: z.literal("leftSidebarMode"),
		value: z.enum(["pages", "files", "preview"]),
	}),
	z.object({
		key: z.literal("editorLineLength"),
		value: z.union([z.literal(72), z.literal(80), z.literal(100), z.literal(120), z.literal(0)]),
	}),
	z.object({
		key: z.literal("contentDensityWarnings"),
		value: z.boolean(),
	}),
	z.object({
		key: z.literal("uiScale"),
		value: z.number().min(0.5).max(2),
	}),
	z.object({ key: z.literal("reviewShareUrl"), value: z.string().max(2_000) }),
	z.object({ key: z.literal("reviewShareToken"), value: z.string().max(2_000) }),
]);

export const projectStateSchema = z.object({
	cursor: z.object({ line: z.number(), ch: z.number() }),
	panelLayout: z.enum(["editor-preview", "editor-only", "preview-only"]),
	activePanel: z.string(),
	panelWidths: z.object({ left: z.number(), right: z.number() }),
	recentExportPath: z.string().nullable(),
	leftCollapsed: z.boolean().optional(),
	rightCollapsed: z.boolean().optional(),
	focusMode: z.boolean().optional(),
});

export const telemetryTrackSchema = z.object({
	name: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[a-z][a-z0-9_]*$/, "Event name must be snake_case"),
	properties: z.record(z.unknown()).optional(),
});

export const reportIssueSchema = z.object({
	kind: z.enum([
		"Something is broken",
		"I hit an accessibility barrier",
		"I need help using it",
		"Feedback or feature request",
		"Other",
	]),
	tryingToDo: z.string().max(10_000),
	happenedInstead: z.string().max(10_000),
	setup: z.string().max(5_000),
	email: z.union([z.literal(""), z.string().email().max(320)]),
	name: z.string().max(200),
	locale: z.enum(["en", "fr"]),
	screenshot: z
		.string()
		.max(800_000)
		.regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
		.nullable(),
});

export const telemetryCaptureExceptionSchema = z.object({
	message: z.string(),
	name: z.string(),
	stack: z.string().optional(),
	context: z.record(z.unknown()).optional(),
});
