import type { ProjectConfig } from "@praxity/editor-core/types";
import { vi } from "vitest";
import type {
	PraxityBridge,
	PreviewRefreshData,
	UpdateCheckResult,
	UpdateInfo,
	UpdateProgress,
} from "../shared/bridge";
import type {
	AppSettings,
	CourseData,
	FileTreeNode,
	LessonData,
	OpenProjectResult,
	ProjectState,
	WorkspaceData,
} from "../shared/types";

type ListenerMap = {
	grammarChanged: Set<(grammar: string) => void>;
	treeChanged: Set<(tree: FileTreeNode[]) => void>;
	menuAction: Set<(action: string) => void>;
	menuOpenRecent: Set<(path: string) => void>;
	exportProgress: Set<(step: string, percent: number) => void>;
	settingsChanged: Set<(settings: AppSettings) => void>;
	checkUnsaved: Set<() => void>;
	previewRefresh: Set<(data: PreviewRefreshData) => void>;
	previewWindowClosed: Set<() => void>;
	updateChecking: Set<() => void>;
	updateAvailable: Set<(info: UpdateInfo) => void>;
	updateDownloaded: Set<(info: UpdateInfo) => void>;
	updateError: Set<(error: string) => void>;
	updateNotAvailable: Set<() => void>;
	updateProgress: Set<(progress: UpdateProgress) => void>;
};

export interface MockBridgeController {
	bridge: PraxityBridge;
	listeners: ListenerMap;
	emit: {
		grammarChanged: (grammar: string) => void;
		treeChanged: (tree: FileTreeNode[]) => void;
		menuAction: (action: string) => void;
		menuOpenRecent: (path: string) => void;
		exportProgress: (step: string, percent: number) => void;
		settingsChanged: (settings: AppSettings) => void;
		checkUnsaved: () => void;
		previewRefresh: (data: PreviewRefreshData) => void;
		previewWindowClosed: () => void;
		updateChecking: () => void;
		updateAvailable: (info: UpdateInfo) => void;
		updateDownloaded: (info: UpdateInfo) => void;
		updateError: (error: string) => void;
		updateNotAvailable: () => void;
		updateProgress: (progress: UpdateProgress) => void;
	};
	install: (target?: Window) => PraxityBridge;
	resetListeners: () => void;
}

function createListenerMap(): ListenerMap {
	return {
		grammarChanged: new Set(),
		treeChanged: new Set(),
		menuAction: new Set(),
		menuOpenRecent: new Set(),
		exportProgress: new Set(),
		settingsChanged: new Set(),
		checkUnsaved: new Set(),
		previewRefresh: new Set(),
		previewWindowClosed: new Set(),
		updateChecking: new Set(),
		updateAvailable: new Set(),
		updateDownloaded: new Set(),
		updateError: new Set(),
		updateNotAvailable: new Set(),
		updateProgress: new Set(),
	};
}

function createSubscription<T extends (...args: never[]) => void>(
	listeners: Set<T>,
	callback: T,
): () => void {
	listeners.add(callback);
	return () => listeners.delete(callback);
}

function emitListeners<T extends (...args: never[]) => void>(
	listeners: Set<T>,
	...args: Parameters<T>
) {
	for (const listener of listeners) {
		listener(...args);
	}
}

function createDefaultProjectConfig(): ProjectConfig {
	return {
		version: 1,
		export: {
			format: "scorm-1.2",
			completionThreshold: 0.8,
		},
	};
}

function createDefaultProject(): OpenProjectResult {
	return {
		grammar: "---\ntitle: Test\n---\n",
		config: createDefaultProjectConfig(),
		projectPath: "/tmp/project",
		lessonFilename: "course.prax",
	};
}

function createDefaultWorkspace(): WorkspaceData {
	return {
		dirPath: "/tmp/workspace",
		config: {},
		courses: [],
	};
}

function createDefaultCourseData(): CourseData {
	return {
		coursePath: "/tmp/course",
		manifest: { title: "Course", lessons: [], design: {} },
		manifestSource: "title: Course\nlessons: []\n",
		lessons: [],
		unlistedLessons: [],
		workspacePath: "/tmp/workspace",
	};
}

function createDefaultLessonData(): LessonData {
	return {
		grammar: "---\ntitle: Lesson\n---\n",
		lessonPath: "/tmp/course/lesson-1.prax",
		coursePath: "/tmp/course",
	};
}

function createDefaultSettings(): AppSettings {
	return {
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
		defaultExportFormat: "scorm-1.2",
		defaultCompletionThreshold: 0.8,
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
}

export function createMockBridge(overrides: Partial<PraxityBridge> = {}): MockBridgeController {
	const listeners = createListenerMap();

	const project = createDefaultProject();
	const workspace = createDefaultWorkspace();
	const course = createDefaultCourseData();
	const lesson = createDefaultLessonData();
	const updateCheckResult: UpdateCheckResult = { available: false };
	const settings = createDefaultSettings();

	const bridge: PraxityBridge = {
		projectNew: vi.fn().mockResolvedValue(project),
		projectCreateSample: vi.fn().mockResolvedValue(project),
		projectOpen: vi.fn().mockResolvedValue(project),
		projectOpenByPath: vi.fn().mockResolvedValue(project),
		projectSave: vi.fn().mockResolvedValue(undefined),
		projectGetRecent: vi.fn().mockResolvedValue([]),

		configRead: vi.fn().mockResolvedValue(project.config),
		configWrite: vi.fn().mockResolvedValue(undefined),

		assetWrite: vi.fn().mockResolvedValue("assets/file.png"),
		assetRead: vi.fn().mockResolvedValue(new Uint8Array()),
		assetList: vi.fn().mockResolvedValue([]),
		narrationAuthoringRead: vi.fn().mockRejectedValue(new Error("No narration fixture")),
		narrationAuthoringWrite: vi.fn().mockRejectedValue(new Error("No narration fixture")),
		narrationStatus: vi.fn().mockResolvedValue({
			configured: false,
			region: "eu",
			disclosureRequired: true,
		}),
		narrationConfigure: vi.fn().mockResolvedValue({
			configured: true,
			region: "eu",
			disclosureRequired: false,
		}),
		narrationGetVoices: vi.fn().mockResolvedValue([]),
		narrationSynthesize: vi.fn(),
		narrationCancel: vi.fn().mockResolvedValue(undefined),
		narrationAttach: vi.fn().mockResolvedValue(null),
		narrationCleanup: vi.fn().mockResolvedValue(undefined),
		projectReadTree: vi.fn().mockResolvedValue([]),
		projectPickFile: vi.fn().mockResolvedValue(null),
		projectDeleteFile: vi.fn().mockResolvedValue(undefined),
		projectRenameFile: vi.fn().mockResolvedValue(undefined),
		projectRevealFile: vi.fn().mockResolvedValue(undefined),
		projectReadTextFile: vi.fn().mockResolvedValue(""),
		projectWriteTextFile: vi.fn().mockResolvedValue({}),
		workspaceOpen: vi.fn().mockResolvedValue(workspace),
		workspaceScan: vi.fn().mockResolvedValue([]),
		workspaceSwitchProject: vi.fn().mockResolvedValue(project),
		workspaceCreate: vi.fn().mockResolvedValue(workspace),
		courseLoad: vi.fn().mockResolvedValue(course),
		courseReadLesson: vi.fn().mockResolvedValue(lesson),
		courseWriteLesson: vi.fn().mockResolvedValue({}),
		courseCreateLesson: vi
			.fn()
			.mockResolvedValue({ filename: "lesson-1.prax", lessonPath: "/tmp/course/lesson-1.prax" }),
		settingsGet: vi
			.fn()
			.mockImplementation((key: keyof AppSettings) => Promise.resolve(settings[key])),
		settingsSet: vi.fn().mockResolvedValue(undefined),
		settingsGetAll: vi.fn().mockResolvedValue(settings),
		setAccessibilityExportEnforcement: vi.fn().mockImplementation(async (enforced: boolean) => {
			settings.accessibilityExportEnforced = enforced;
			return enforced;
		}),

		appGetVersion: vi.fn().mockResolvedValue("1.0.0"),
		appGetPlatform: vi.fn().mockResolvedValue("darwin"),
		appGetReportIssueContext: vi.fn().mockResolvedValue({
			appVersion: "1.0.0",
			platform: "darwin",
			screenshot: "data:image/jpeg;base64,dGVzdA==",
		}),
		appSubmitIssueReport: vi.fn().mockResolvedValue(undefined),
		appCheckForUpdates: vi.fn().mockResolvedValue(updateCheckResult),
		appInstallUpdate: vi.fn().mockResolvedValue(undefined),

		telemetryTrack: vi.fn(),
		telemetryReinit: vi.fn().mockResolvedValue(undefined),
		telemetryCaptureException: vi.fn(),

		watchGrammarStart: vi.fn(),
		watchGrammarStop: vi.fn(),

		windowStateSave: vi.fn().mockResolvedValue(undefined),
		windowStateLoad: vi.fn().mockResolvedValue(null as ProjectState | null),

		exportScorm: vi.fn().mockResolvedValue({ outputPath: "/tmp/export.zip" }),
		cancelExport: vi.fn().mockResolvedValue(undefined),
		pickExportDirectory: vi.fn().mockResolvedValue(null),
		revealExportFile: vi.fn().mockResolvedValue(undefined),
		shareForReview: vi.fn().mockResolvedValue({
			url: "https://reviews.example/s/abcdefghijklmnop/",
			expiresAt: "2026-08-05T16:00:00.000Z",
		}),
		estimateScorm12Storage: vi.fn().mockResolvedValue({
			atRisk: false,
			estimatedLength: 600,
			limit: 4096,
			reportingSelfCheckCount: 0,
		}),
		openExternalUrl: vi.fn().mockResolvedValue(undefined),
		previewOpenWindow: vi.fn().mockResolvedValue(undefined),
		previewRefresh: vi.fn(),
		coursePreviewOpenExternal: vi.fn().mockResolvedValue(undefined),
		coursePreviewBuild: vi.fn().mockRejectedValue(new Error("Course preview is not configured")),
		coursePreviewRelease: vi.fn().mockResolvedValue(undefined),
		coursePreviewStateRead: vi
			.fn()
			.mockRejectedValue(new Error("Course preview is not configured")),
		coursePreviewStateActivate: vi
			.fn()
			.mockRejectedValue(new Error("Course preview is not configured")),
		coursePreviewStatePersist: vi.fn().mockResolvedValue(false),
		coursePreviewStateReset: vi
			.fn()
			.mockRejectedValue(new Error("Course preview is not configured")),

		onGrammarChanged: vi.fn((cb) => createSubscription(listeners.grammarChanged, cb)),
		onTreeChanged: vi.fn((cb) => createSubscription(listeners.treeChanged, cb)),
		onMenuAction: vi.fn((cb) => createSubscription(listeners.menuAction, cb)),
		onMenuOpenRecent: vi.fn((cb) => createSubscription(listeners.menuOpenRecent, cb)),
		onExportProgress: vi.fn((cb) => createSubscription(listeners.exportProgress, cb)),
		onSettingsChanged: vi.fn((cb) => createSubscription(listeners.settingsChanged, cb)),
		onCheckUnsaved: vi.fn((cb) => createSubscription(listeners.checkUnsaved, cb)),
		onPreviewRefresh: vi.fn((cb) => createSubscription(listeners.previewRefresh, cb)),
		onPreviewWindowClosed: vi.fn((cb) => createSubscription(listeners.previewWindowClosed, cb)),
		onUpdateChecking: vi.fn((cb) => createSubscription(listeners.updateChecking, cb)),
		onUpdateAvailable: vi.fn((cb) => createSubscription(listeners.updateAvailable, cb)),
		onUpdateDownloaded: vi.fn((cb) => createSubscription(listeners.updateDownloaded, cb)),
		onUpdateError: vi.fn((cb) => createSubscription(listeners.updateError, cb)),
		onUpdateNotAvailable: vi.fn((cb) => createSubscription(listeners.updateNotAvailable, cb)),
		onUpdateProgress: vi.fn((cb) => createSubscription(listeners.updateProgress, cb)),
		confirmClose: vi.fn(),
	};

	const mergedBridge = Object.assign(bridge, overrides);

	return {
		bridge: mergedBridge,
		listeners,
		emit: {
			grammarChanged: (grammar) => emitListeners(listeners.grammarChanged, grammar),
			treeChanged: (tree) => emitListeners(listeners.treeChanged, tree),
			menuAction: (action) => emitListeners(listeners.menuAction, action),
			menuOpenRecent: (path) => emitListeners(listeners.menuOpenRecent, path),
			exportProgress: (step, percent) => emitListeners(listeners.exportProgress, step, percent),
			settingsChanged: (nextSettings) => emitListeners(listeners.settingsChanged, nextSettings),
			checkUnsaved: () => emitListeners(listeners.checkUnsaved),
			previewRefresh: (data) => emitListeners(listeners.previewRefresh, data),
			previewWindowClosed: () => emitListeners(listeners.previewWindowClosed),
			updateChecking: () => emitListeners(listeners.updateChecking),
			updateAvailable: (info) => emitListeners(listeners.updateAvailable, info),
			updateDownloaded: (info) => emitListeners(listeners.updateDownloaded, info),
			updateError: (error) => emitListeners(listeners.updateError, error),
			updateNotAvailable: () => emitListeners(listeners.updateNotAvailable),
			updateProgress: (progress) => emitListeners(listeners.updateProgress, progress),
		},
		install: (target = window) => {
			Object.defineProperty(target, "praxity", {
				value: mergedBridge,
				configurable: true,
				writable: true,
			});
			return mergedBridge;
		},
		resetListeners: () => {
			for (const set of Object.values(listeners)) {
				set.clear();
			}
		},
	};
}

export function installMockBridge(
	overrides: Partial<PraxityBridge> = {},
	target?: Window,
): MockBridgeController {
	const controller = createMockBridge(overrides);
	controller.install(target);
	return controller;
}
