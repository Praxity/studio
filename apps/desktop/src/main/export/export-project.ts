import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { A11yIssue } from "@praxity/editor-core/lib/a11y/checker.ts";
import {
	type CoursePackageDeploymentTarget,
	EmptyCourseError,
	type ExportResult,
	preparePublicationContext,
} from "@praxity/export-pipeline";
import { assertViewerAssetsReady } from "@praxity/export-pipeline/bundle-viewer";
import {
	estimateScorm12Storage,
	type Scorm12StorageEstimate,
} from "@praxity/export-pipeline/scorm12-storage";
import { CoursePdfError } from "@praxity/format-renderers/pipelines/course-pdf";
import {
	assertCoursePracticeAdmission,
	CoursePracticeAdmissionError,
	LessonRuntimeError,
} from "@praxity/grammar";
import { interpolate } from "@praxity/shared-blocks/i18n/interpolate";
import { resolveLocale } from "@praxity/shared-blocks/i18n/locale";
import { isInlineProjectionMetadataKey } from "@praxity/shared-blocks/inline-markdown";
import { HighlightNarrationError } from "@praxity/shared-blocks/narration";
import type { ExportFormat } from "../../shared/ipc-schemas";
import type { SelfCheckNarrationWarning } from "../../shared/narration-sidecar";
import type { DesignWarning } from "../../shared/settings-inheritance";
import type { ExportDiagnostic, Scorm2004Edition } from "../../shared/types";
import { resolveLessonSources } from "../lesson-source";
import { resolveCompletionSettings } from "../project-config";
import { withProjectFileTransaction } from "../project-file-transactions";
import { getMetricsFromBlocks } from "../telemetry-utils";
import { type AuthorWarning, assertExportAccessibility } from "./accessibility-enforcement";
import {
	buildCourseExportInput,
	buildExportInputFromProject,
	NarrationUnlinkedError,
	type ProjectExportInput,
} from "./build-export-input-from-project";
import { resolvePdfAssets } from "./resolve-pdf-assets";

export interface ExportProjectOptions {
	/** Author advice language, independent of the published course locale. */
	adviceLocale?: "en" | "fr";
	pageSize?: "a4" | "letter";
	includeAnswerSheet?: boolean;
	/** Trusted host option; never accepted from renderer IPC. */
	typstExecutablePath?: string;
	signal?: AbortSignal;
	/** Trusted host workspace, never renderer input. */
	temporaryRoot?: string;
	projectDir: string;
	format: ExportFormat;
	scorm2004Edition?: Scorm2004Edition;
	exportAssetsDir: string;
	scope: "lesson" | "course";
	lessonFilename?: string;
	workspacePath?: string | null;
	/** Trusted host policy; disable for project-rooted server sessions. */
	inheritWorkspaceSettings?: boolean;
	/** Read-only by default; persistence requires explicit writer admission. */
	manifestPolicy?: "read-only" | "write";
	completionThreshold?: number;
	requireKnowledgeChecks?: boolean;
	passingScore?: number;
	fallbackCompletionThreshold: number;
	enforceAccessibility: boolean;
	reviewMode?: boolean;
	reviewExpiresAt?: string;
	expectedAppVersion?: string;
	expectedViewerSourceHash?: string;
	onProgress?: (step: string, percent: number) => void;
}

export interface ExportProjectResult {
	authorWarnings?: AuthorWarning[];
	diagnostics?: ExportDiagnostic[];
	designWarnings?: DesignWarning[];
	narrationWarnings?: Array<SelfCheckNarrationWarning & { file: string }>;
	zip: Buffer;
	title: string;
	pageCount: number;
	blockCount: number;
	criticalAccessibilityIssues: A11yIssue[];
	/** Present for SCORM 1.2 exports, whose progress storage is capped. */
	scorm12Storage?: Scorm12StorageEstimate;
}
export interface PdfExportProjectResult extends Omit<ExportProjectResult, "zip"> {
	pdf: Buffer;
	diagnostics: ExportDiagnostic[];
}

export class ProjectExportError extends Error {
	readonly code:
		| "project_invalid"
		| "export_failed"
		| "unsupported-runtime"
		| CoursePracticeAdmissionError["code"]
		| HighlightNarrationError["code"];

	constructor(code: ProjectExportError["code"], message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ProjectExportError";
		this.code = code;
	}
}

function pdfErrorCode(error: unknown): ProjectExportError["code"] {
	return error instanceof CoursePdfError && error.code ? error.code : "export_failed";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const pdfRefusalCopy = {
	en: {
		unsupported:
			"The bundled PDF fonts cannot display: {characters}. Replace these characters before exporting.",
		location: "Lesson {lesson}, block {block}: {characters}.",
	},
	fr: {
		unsupported:
			"Les polices PDF incluses ne peuvent pas afficher : {characters}. Remplacez ces caractères avant l’export.",
		location: "Leçon {lesson}, bloc {block} : {characters}.",
	},
} as const;

function pdfRefusalMessage(message: string, input: ProjectExportInput): string {
	if (!message.startsWith("Typst compilation failed:")) return message;
	const unsupported = new Set<string>();
	for (const match of message.matchAll(
		/^(?:Typst compilation failed: )?error: [^\r\n]*?the text `"((?:\\.|[^"\\\r\n])*)"` could not be displayed/gm,
	)) {
		const text = match[1]
			.replace(/\\u\{([\da-f]{1,6})\}/gi, (_, code: string) =>
				String.fromCodePoint(Number.parseInt(code, 16)),
			)
			.replace(/\\(["\\])/g, "$1");
		for (const character of text) unsupported.add(character);
	}
	if (!unsupported.size) return message.split("\n", 1)[0];
	const locale = resolveLocale(input.locale ?? "en");
	const graphemes = new Intl.Segmenter(locale, { granularity: "grapheme" });
	const locations = new Map<string, { lesson: string; block: string; characters: Set<string> }>();
	const inspect = (value: unknown, lesson: string, block?: string): void => {
		if (typeof value === "string" && block) {
			for (const { segment } of graphemes.segment(value)) {
				if (![...segment].some((character) => unsupported.has(character))) continue;
				const key = JSON.stringify([lesson, block]);
				let location = locations.get(key);
				if (!location) {
					location = { lesson, block, characters: new Set() };
					locations.set(key, location);
				}
				location.characters.add(segment);
			}
		} else if (Array.isArray(value)) {
			for (const child of value) inspect(child, lesson, block);
		} else if (value && typeof value === "object") {
			const record = value as Record<string, unknown>;
			const owner =
				typeof record.id === "string" && typeof record.type === "string" && record.data
					? record.id
					: block;
			for (const [key, child] of Object.entries(record))
				if (!isInlineProjectionMetadataKey(key, { keepDisplay: true }))
					inspect(child, lesson, owner);
		}
	};
	for (const lesson of input.preparedLessons ?? []) {
		inspect(lesson.blocks, lesson.id);
		for (const [block, content] of lesson.selfCheckContents ?? [])
			inspect(content, lesson.id, block);
		// Native answer-sheet font refusals identify the owning block without emitting Content.
		for (const [block, content] of lesson.writeDistractorsContents ?? [])
			inspect(content, lesson.id, block);
	}
	const characters = new Set(
		[...locations.values()].flatMap((location) => [...location.characters]),
	);
	const represented = new Set([...characters].flatMap((character) => [...character]));
	for (const character of unsupported) if (!represented.has(character)) characters.add(character);
	const list = (values: Iterable<string>) =>
		[...values].map((value) => JSON.stringify(value)).join(", ");
	const copy = pdfRefusalCopy[locale];
	return [
		interpolate(copy.unsupported, { characters: list(characters) }),
		...[...locations.values()].map((location) =>
			interpolate(copy.location, { ...location, characters: list(location.characters) }),
		),
	].join("\n");
}

function toPipelineFormat(
	format: Exclude<ExportFormat, "pdf">,
): "scorm12" | "scorm2004" | "xapi" | "html" {
	if (format === "scorm-1.2") return "scorm12";
	if (format === "scorm-2004") return "scorm2004";
	return format;
}

/** Whether a full attempt at the project fits in SCORM 1.2 progress storage, before exporting. */
export async function estimateProjectScorm12Storage(
	options: Pick<
		ExportProjectOptions,
		| "projectDir"
		| "exportAssetsDir"
		| "scope"
		| "lessonFilename"
		| "workspacePath"
		| "inheritWorkspaceSettings"
	>,
): Promise<Scorm12StorageEstimate> {
	// Page IDs and assessments do not depend on completion settings or assets.
	const input = await buildCourseExportInput({
		projectDir: options.projectDir,
		scope: options.scope,
		lessonFilename: options.lessonFilename,
		workspacePath: options.workspacePath,
		inheritWorkspaceSettings: options.inheritWorkspaceSettings,
		completionThreshold: 0,
		viewerVersionPath: path.join(options.exportAssetsDir, "viewer.version.json"),
		loadAssets: false,
		manifestPolicy: "read-only",
	});
	return estimateScorm12Storage(input);
}

export function exportProject(
	options: ExportProjectOptions & { format: "pdf" },
): Promise<PdfExportProjectResult>;
export function exportProject(
	options: ExportProjectOptions & { format: Exclude<ExportFormat, "pdf"> },
): Promise<ExportProjectResult>;
export function exportProject(
	options: ExportProjectOptions,
): Promise<ExportProjectResult | PdfExportProjectResult>;
export async function exportProject(
	options: ExportProjectOptions,
): Promise<ExportProjectResult | PdfExportProjectResult> {
	options.signal?.throwIfAborted();
	if (options.format !== "pdf")
		await assertViewerAssetsReady(options.exportAssetsDir, options.format, {
			reviewMode: options.reviewMode,
			expectedAppVersion: options.expectedAppVersion,
			expectedViewerSourceHash: options.expectedViewerSourceHash,
		});

	let baseInput: ProjectExportInput;
	let pdfAssets: Map<string, Uint8Array> | undefined;
	try {
		baseInput = await withProjectFileTransaction(
			options.projectDir,
			async () => {
				// Validate the captured course before lesson projection or PDF/HTML
				// branching. The selective admission owner decides which diagnostics refuse output.
				const admission = await resolveLessonSources(options.projectDir);
				assertCoursePracticeAdmission(
					[...admission.lessons].map(([path, read]) => ({ path, read })),
					options.adviceLocale,
					options.format === "pdf" ? "native-pdf" : "runtime",
				);
				const completionSettings =
					options.format === "pdf"
						? { completionThreshold: 0, requireKnowledgeChecks: false, passingScore: undefined }
						: await resolveCompletionSettings(options);
				const inputOptions = {
					projectDir: options.projectDir,
					...completionSettings,
					viewerVersionPath: path.join(options.exportAssetsDir, "viewer.version.json"),
					lessonFilename: options.lessonFilename,
					workspacePath: options.workspacePath,
					inheritWorkspaceSettings: options.inheritWorkspaceSettings,
					manifestPolicy: options.manifestPolicy,
					loadAssets: options.format !== "pdf",
					preparePdf: options.format === "pdf",
					includeAnswerSheet: options.format === "pdf" && options.includeAnswerSheet === true,
				};
				const input =
					options.scope === "course"
						? await buildCourseExportInput({ ...inputOptions, scope: "course" })
						: await buildExportInputFromProject(inputOptions);
				if (options.format === "pdf") {
					try {
						pdfAssets = await resolvePdfAssets(
							options.projectDir,
							input.preparedLessons ?? [],
							options.includeAnswerSheet ?? false,
							options.adviceLocale,
						);
					} catch (error) {
						throw new ProjectExportError(pdfErrorCode(error), errorMessage(error), {
							cause: error,
						});
					}
				}
				return input;
			},
			options.manifestPolicy === "write" ? "write" : "read",
		);
	} catch (error) {
		if (error instanceof HighlightNarrationError)
			throw new ProjectExportError(error.code, error.message, { cause: error });
		if (error instanceof LessonRuntimeError)
			throw new ProjectExportError(error.code, error.formatMessage(options.adviceLocale), {
				cause: error,
			});
		if (
			error instanceof ProjectExportError ||
			error instanceof NarrationUnlinkedError ||
			error instanceof CoursePracticeAdmissionError
		)
			throw error;
		throw new ProjectExportError("project_invalid", errorMessage(error), { cause: error });
	}
	const exportInput = options.reviewMode
		? {
				...baseInput,
				reviewMode: true,
				reviewExpiresAt: options.reviewExpiresAt,
			}
		: baseInput;
	const criticalAccessibilityIssues = assertExportAccessibility(
		exportInput,
		options.enforceAccessibility,
	);
	options.signal?.throwIfAborted();
	const metrics = getMetricsFromBlocks(exportInput.blocks);
	if (options.format === "pdf") {
		await preparePublicationContext(exportInput);
		try {
			options.signal?.throwIfAborted();
			const { exportCoursePdf } = await import("@praxity/format-renderers/pipelines/course-pdf");
			const lessons = baseInput.preparedLessons ?? [];
			if (!pdfAssets) throw new Error("PDF assets were not prepared");
			options.onProgress?.("pdfCompiling", 30);
			// Flush progress before synchronous PDF source rendering, and admit
			// pending cancellation before starting the native compiler.
			await yieldToEventLoop();
			options.signal?.throwIfAborted();
			const result = await exportCoursePdf({
				title: String(exportInput.frontmatter.title || "Course"),
				locale: exportInput.locale ?? "en",
				diagnosticLocale: options.adviceLocale,
				lessons,
				resolvedAssets: pdfAssets,
				pageSize: options.pageSize,
				includeAnswerSheet: options.includeAnswerSheet,
				executablePath:
					options.typstExecutablePath ?? path.resolve(options.exportAssetsDir, "../typst/typst"),
				signal: options.signal,
				temporaryRoot: options.temporaryRoot,
			});
			options.signal?.throwIfAborted();
			options.onProgress?.("pdfComplete", 100);
			return {
				designWarnings: baseInput.designWarnings,
				authorWarnings: baseInput.authorWarnings,
				narrationWarnings: baseInput.warnings?.filter(
					(warning) => warning.code === "ENARRATIONSELFCHECKSPOILER",
				),
				pdf: result.pdf,
				diagnostics: [...authorDiagnostics(baseInput), ...result.diagnostics],
				title: String(exportInput.frontmatter.title || "Course"),
				pageCount: metrics.pageCount,
				blockCount: metrics.blockCount,
				criticalAccessibilityIssues,
			};
		} catch (error) {
			throw new ProjectExportError(
				pdfErrorCode(error),
				pdfRefusalMessage(errorMessage(error), baseInput),
				{ cause: error },
			);
		}
	}
	let result: ExportResult;
	try {
		const { compileCourse, deployCourse } = await import("@praxity/export-pipeline");
		const artifact = await compileCourse(exportInput, {
			mode: "desktop",
			prebuiltAssetsDir: options.exportAssetsDir,
			projectDir: options.projectDir,
			onProgress: options.onProgress,
			temporaryRoot: options.temporaryRoot,
		});
		const format = toPipelineFormat(options.format);
		const target: CoursePackageDeploymentTarget = {
			format,
			...(options.scorm2004Edition ? { scorm2004Edition: options.scorm2004Edition } : {}),
			...(format === "html" && options.reviewMode
				? { reviewMode: true, reviewExpiresAt: options.reviewExpiresAt }
				: {}),
		};
		try {
			options.signal?.throwIfAborted();
			result = await deployCourse(artifact, target);
			options.signal?.throwIfAborted();
		} finally {
			await artifact.dispose();
		}
	} catch (error) {
		if (error instanceof EmptyCourseError) throw error;
		throw new ProjectExportError("export_failed", errorMessage(error), { cause: error });
	}
	const rawTitle = exportInput.frontmatter.title;

	return {
		designWarnings: baseInput.designWarnings,
		authorWarnings: baseInput.authorWarnings,
		diagnostics: authorDiagnostics(baseInput),
		narrationWarnings: baseInput.warnings?.filter(
			(warning) => warning.code === "ENARRATIONSELFCHECKSPOILER",
		),
		zip: result.zip,
		title: typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : "Course",
		pageCount: result.pageCount,
		blockCount: metrics.blockCount,
		criticalAccessibilityIssues,
		...(options.format === "scorm-1.2"
			? { scorm12Storage: estimateScorm12Storage(exportInput) }
			: {}),
	};
}

function authorDiagnostics(input: ProjectExportInput): ExportDiagnostic[] {
	return (input.authorWarnings ?? []).map((warning) => ({
		lessonId: warning.file,
		code: warning.code,
		message: `${warning.message}. ${warning.hint}`,
	}));
}
