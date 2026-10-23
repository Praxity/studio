import type { ProjectConfig } from "@praxity/editor-core/types";
import { DEFAULT_COMPLETION_THRESHOLD } from "@praxity/shared-blocks/constants";

export type Scorm2004Edition = "3rd" | "4th";

export interface AppSettings {
	locale: "en" | "fr";
	autoSave: boolean;
	autoSaveIntervalMs: number;
	autoUpdate: boolean;
	updateChannel: "stable" | "beta";
	telemetryUsageData: boolean;
	telemetryCrashReports: boolean;
	telemetryDistinctId: string | null;
	recentProjects: RecentProject[];
	windowBounds: WindowBounds | null;
	editorTheme: string;
	appearance: "system" | "light" | "dark";
	uiScale: number;
	theme: "system" | "light" | "dark";
	defaultExportFormat: "scorm-1.2" | "scorm-2004" | "html";
	defaultCompletionThreshold: number;
	accessibilityExportEnforced: boolean;
	lastAccessibilityOverrideExport: AccessibilityOverrideExportRecord | null;
	smartPunctuation: boolean;
	recentExportPath: string | null;
	firstLaunchComplete: boolean;
	activeWorkspace: string | null;
	leftSidebarMode: LeftSidebarMode;
	recentWorkspaces: RecentWorkspace[];
	editorLineLength: 72 | 80 | 100 | 120 | 0;
	contentDensityWarnings: boolean;
	showNarrationControls: boolean;
	narrationControlsAutoEnabled: boolean;
	sonioxDisclosureShown: boolean;
	reviewShareUrl: string;
	reviewShareToken: string;
}

export interface RecentProject {
	path: string;
	title: string;
	lastOpened: string;
}

export interface FileTreeNode {
	name: string;
	path: string;
	type: "file" | "directory";
	size?: number;
	extension?: string;
	children?: FileTreeNode[];
	isHidden?: boolean;
}

export interface WorkspaceCourse {
	name: string;
	path: string;
	title: string;
	pageCount: number;
	estimatedMinutes: number;
	lastModified: string;
}

export interface WorkspaceConfig {
	name?: string;
	description?: string;
	defaultTheme?: string;
	defaultLocale?: string;
	lexicons?: Record<string, string>;
	[key: string]: unknown;
}

export interface WorkspaceData {
	dirPath: string;
	config: WorkspaceConfig;
	courses: WorkspaceCourse[];
}

/** A lesson file within a multi-file course */
export interface LessonFileInfo {
	filename: string; // "intro.prax"
	title: string; // from frontmatter, or filename sans .prax
	path: string; // absolute path
	pageCount: number; // count of parsed lesson pages
	wordCount: number;
	lastModified: string; // ISO date
}

/** Result of loading a multi-file course folder */
export interface CourseData {
	coursePath: string; // absolute path to course folder
	manifest: import("./course-manifest").CourseManifest;
	/** Exact raw bytes belonging to this loaded snapshot, after any loader migration. */
	manifestSource: string | undefined;
	lessons: LessonFileInfo[]; // ordered per manifest
	unlistedLessons: LessonFileInfo[]; // .prax files not in manifest
	workspacePath: string | null; // parent workspace if any
}

/** Result of opening a specific lesson for editing */
export interface LessonData {
	grammar: string;
	lessonPath: string; // absolute path to .prax file
	coursePath: string; // absolute path to course folder
}

export type LeftSidebarMode = "pages" | "files" | "preview";

export interface RecentWorkspace {
	path: string;
	name: string;
	courseCount: number;
	lastOpened: string;
}

export interface WindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	isMaximized: boolean;
}

export interface AccessibilityOverrideExportRecord {
	exportedAt: string;
	outputPath: string;
	criticalIssueCount: number;
}

export interface ProjectState {
	cursor: { line: number; ch: number };
	panelLayout: "editor-preview" | "editor-only" | "preview-only";
	activePanel: string;
	panelWidths: { left: number; right: number };
	recentExportPath: string | null;
	focusMode?: boolean;
	leftCollapsed?: boolean;
	rightCollapsed?: boolean;
}

export interface OpenProjectResult {
	recoveryArchives?: string[];
	grammar: string;
	config: ProjectConfig;
	projectPath: string;
	lessonFilename: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
	locale: "en",
	autoSave: true,
	autoSaveIntervalMs: 5000,
	autoUpdate: true,
	updateChannel: "stable",
	telemetryUsageData: false,
	telemetryCrashReports: false,
	telemetryDistinctId: null,
	recentProjects: [],
	windowBounds: null,
	editorTheme: "default",
	appearance: "system",
	uiScale: 1,
	theme: "system",
	defaultExportFormat: "scorm-2004",
	defaultCompletionThreshold: DEFAULT_COMPLETION_THRESHOLD,
	accessibilityExportEnforced: true,
	lastAccessibilityOverrideExport: null,
	smartPunctuation: true,
	recentExportPath: null,
	firstLaunchComplete: false,
	activeWorkspace: null,
	leftSidebarMode: "pages",
	recentWorkspaces: [],
	editorLineLength: 100,
	contentDensityWarnings: true,
	showNarrationControls: false,
	narrationControlsAutoEnabled: false,
	sonioxDisclosureShown: false,
	reviewShareUrl: "",
	reviewShareToken: "",
};
export interface ExportDiagnostic {
	lessonId: string;
	blockId?: string;
	pageTitle?: string;
	code?: string;
	message: string;
}
