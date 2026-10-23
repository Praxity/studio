import type { ProjectConfig } from "@praxity/editor-core/types";
import type { Scorm12StorageEstimate } from "@praxity/export-pipeline/scorm12-storage";
import type { GrammarFrontmatter, PronunciationLexeme } from "@praxity/grammar";
import type { StudioEditorBridge } from "./editor-session";
import type { ExportRequest } from "./ipc-schemas";
import type {
	NarrationPanelDocument,
	NarrationSidecarV2,
	ProjectNarrationWarning,
} from "./narration-sidecar";
import type { ProjectWriteResult } from "./project-write-errors";
import type {
	AppSettings,
	CourseData,
	ExportDiagnostic,
	FileTreeNode,
	LessonData,
	OpenProjectResult,
	ProjectState,
	RecentProject,
	WorkspaceCourse,
	WorkspaceData,
} from "./types";

export interface PreviewRefreshData {
	sourceRevision: number;
	locale: "en" | "fr";
}

export interface CoursePreviewArtifactDescriptor {
	warnings?: ProjectNarrationWarning[];
	leaseId: string;
	entryUrl: string;
	courseId: string;
	coreRevision: string;
	responseRevision: string;
	pages: Array<{ id: string; slug: string }>;
}

/** A live lesson snapshot used by authoring-only small previews. */
export interface CoursePreviewBuildRequest {
	scope: "lesson";
	lessonFilename: string;
	source: string;
}

export interface UpdateCheckResult {
	available: boolean;
	version?: string;
	releaseNotes?: string;
}

export interface UpdateInfo {
	version: string;
	releaseNotes?: string;
}

export interface UpdateProgress {
	percent: number;
	bytesPerSecond: number;
	transferred: number;
	total: number;
}

export type ReportIssueKind =
	| "Something is broken"
	| "I hit an accessibility barrier"
	| "I need help using it"
	| "Feedback or feature request"
	| "Other";

export interface ReportIssueContext {
	appVersion: string;
	platform: "darwin" | "win32" | "linux";
	screenshot: string | null;
}

export interface ReportIssueInput {
	kind: ReportIssueKind;
	tryingToDo: string;
	happenedInstead: string;
	setup: string;
	email: string;
	name: string;
	locale: "en" | "fr";
	screenshot: string | null;
}

export interface NarrationVoice {
	id: string;
	description: string;
	gender?: string;
	languages: string[];
}

export type SonioxRegion = "eu" | "us" | "jp";

export interface NarrationSynthesisRequest {
	requestId: string;
	originalScript: string;
	language: "en" | "fr";
	voice: string;
	speed: number;
	lexemes: PronunciationLexeme[];
	segmentId: string;
}

export interface NarrationSynthesisResult {
	narrationAudio: string;
	narrationTimings: string;
	durationSeconds: number;
	scriptHash: string;
	lexiconHash: string;
	voice: string;
	language: "en" | "fr";
}

/**
 * The API exposed to the renderer process via contextBridge.
 * Access in renderer code via `window.praxity`.
 */
export interface PraxityBridge {
	/** Present only in the rooted browser editor. No native folder switching. */
	readonly browser?: {
		initialProject: OpenProjectResult;
		resolveAssetUrl?: (relativePath: string) => string;
		editor?: StudioEditorBridge;
	};
	/** Absent in Electron. Browser adapters publish their fixed preference policy. */
	readonly writableSettings?: readonly (keyof AppSettings)[];
	projectNew(): Promise<OpenProjectResult>;
	/** Scaffolds the bundled sample course and opens it. Null if cancelled. */
	projectCreateSample(locale?: "en" | "fr"): Promise<OpenProjectResult | null>;
	projectOpen(): Promise<OpenProjectResult | null>;
	projectOpenByPath(path: string): Promise<OpenProjectResult | null>;
	projectSave(grammar: string, expectedGrammar: string): Promise<void>;
	projectGetRecent(): Promise<RecentProject[]>;

	configRead(): Promise<ProjectConfig>;
	configWrite(config: ProjectConfig): Promise<void>;

	assetWrite(filename: string, data: Uint8Array): Promise<string>;
	assetRead(relativePath: string): Promise<Uint8Array>;
	assetList(): Promise<string[]>;
	narrationAuthoringRead(
		filename: string,
		source?: string,
	): Promise<{
		sidecar: NarrationSidecarV2;
		source: string | null;
		document: NarrationPanelDocument & { filename: string; frontmatter: GrammarFrontmatter };
	}>;
	narrationAuthoringWrite(source: string, expectedSource: string | null): Promise<string>;
	narrationStatus(): Promise<{
		configured: boolean;
		region: SonioxRegion;
		disclosureRequired: boolean;
	}>;
	narrationConfigure(
		apiKey: string | null,
		region: SonioxRegion,
	): Promise<{ configured: boolean; region: SonioxRegion; disclosureRequired: boolean }>;
	narrationGetVoices(): Promise<NarrationVoice[]>;
	narrationSynthesize(request: NarrationSynthesisRequest): Promise<NarrationSynthesisResult>;
	narrationCancel(requestId: string): Promise<void>;
	narrationAttach(kind: "audio" | "timings", script?: string): Promise<string | null>;
	narrationCleanup(paths: string[], currentSource: string): Promise<void>;
	projectReadTree(): Promise<FileTreeNode[]>;
	projectPickFile(): Promise<string | null>;
	projectDeleteFile(relativePath: string): Promise<void>;
	projectRenameFile(oldPath: string, newPath: string): Promise<void>;
	projectRevealFile(relativePath: string): Promise<void>;
	projectReadTextFile(relativePath: string): Promise<string>;
	projectWriteTextFile(
		relativePath: string,
		content: string,
		expectedContent?: string,
	): Promise<ProjectWriteResult>;
	workspaceOpen(): Promise<WorkspaceData | null>;
	workspaceScan(dirPath: string): Promise<WorkspaceCourse[]>;
	workspaceSwitchProject(projectPath: string): Promise<OpenProjectResult | null>;
	workspaceCreate(): Promise<WorkspaceData | null>;
	courseLoad(courseDir: string): Promise<CourseData>;
	courseReadLesson(courseDir: string, filename: string): Promise<LessonData>;
	courseWriteLesson(
		courseDir: string,
		filename: string,
		grammar: string,
		expectedGrammar?: string,
	): Promise<ProjectWriteResult>;
	courseCreateLesson(
		courseDir: string,
		lessonName: string,
	): Promise<{ filename: string; lessonPath: string }>;

	settingsGet<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]>;
	settingsSet<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>;
	settingsGetAll(): Promise<AppSettings>;
	setAccessibilityExportEnforcement(enforced: true): Promise<boolean>;
	setAccessibilityExportEnforcement(
		enforced: false,
		confirmation: {
			title: string;
			message: string;
			detail: string;
			confirmLabel: string;
			cancelLabel: string;
		},
	): Promise<boolean>;

	appGetVersion(): Promise<string>;
	appGetPlatform(): Promise<"darwin" | "win32" | "linux">;
	appGetReportIssueContext(): Promise<ReportIssueContext>;
	appSubmitIssueReport(report: ReportIssueInput): Promise<void>;
	appCheckForUpdates(): Promise<UpdateCheckResult>;
	appInstallUpdate(): Promise<void>;

	telemetryTrack(name: string, properties?: Record<string, unknown>): void;
	telemetryReinit(): Promise<void>;
	telemetryCaptureException(data: {
		message: string;
		name: string;
		stack?: string;
		context?: Record<string, unknown>;
	}): void;

	watchGrammarStart(filename?: string): void;
	watchGrammarStop(): void;

	windowStateSave(state: ProjectState): Promise<void>;
	windowStateLoad(): Promise<ProjectState | null>;

	exportScorm(options: ExportRequest): Promise<{
		outputPath: string;
		diagnostics?: ExportDiagnostic[];
		accessibilityOverride?: {
			exportedAt: string;
			criticalIssueCount: number;
		};
	} | null>;
	pickExportDirectory(initialPath?: string): Promise<string | null>;
	cancelExport(): Promise<void>;
	revealExportFile(absolutePath: string): Promise<void>;
	shareForReview(options: {
		scope?: "lesson" | "course";
		lessonFilename?: string;
	}): Promise<{ url: string; expiresAt: string }>;
	/** Estimates SCORM 1.2 progress storage from the saved project files. */
	estimateScorm12Storage(options: {
		scope: "lesson" | "course";
		lessonFilename?: string;
	}): Promise<Scorm12StorageEstimate>;

	openExternalUrl(url: string): Promise<void>;

	previewOpenWindow(): Promise<void>;
	previewRefresh(data: PreviewRefreshData): void;
	coursePreviewOpenExternal(url: string): Promise<void>;
	coursePreviewBuild(request?: CoursePreviewBuildRequest): Promise<CoursePreviewArtifactDescriptor>;
	coursePreviewRelease(leaseId: string): Promise<void>;
	coursePreviewStateRead(leaseId: string): Promise<string>;
	coursePreviewStateActivate(leaseId: string): Promise<{ state: string; writerToken: string }>;
	coursePreviewStatePersist(leaseId: string, writerToken: string, state: string): Promise<boolean>;
	coursePreviewStateReset(leaseId: string): Promise<string>;

	onGrammarChanged(callback: (change: { filename: string; grammar: string }) => void): () => void;
	onTreeChanged(callback: (tree: FileTreeNode[]) => void): () => void;
	onMenuAction(callback: (action: string) => void): () => void;
	onMenuOpenRecent(callback: (path: string) => void): () => void;
	onExportProgress(callback: (step: string, percent: number) => void): () => void;
	onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
	onCheckUnsaved(callback: () => void): () => void;
	onPreviewRefresh(callback: (data: PreviewRefreshData) => void): () => void;
	onPreviewWindowClosed(callback: () => void): () => void;
	onUpdateChecking(callback: () => void): () => void;
	onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void;
	onUpdateDownloaded(callback: (info: UpdateInfo) => void): () => void;
	onUpdateError(callback: (error: string) => void): () => void;
	onUpdateNotAvailable(callback: () => void): () => void;
	onUpdateProgress(callback: (progress: UpdateProgress) => void): () => void;
	confirmClose(): void;
}

declare global {
	interface Window {
		praxity: PraxityBridge;
	}
}
