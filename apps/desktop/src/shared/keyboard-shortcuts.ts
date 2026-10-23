export interface KeyboardShortcutSpec {
	id: string;
	context: "legacy-shell";
	combo: string;
	actionKey: string;
	accelerator?: string;
}

const LEGACY_SHORTCUTS = [
	{ id: "cycle-panels", combo: "F6", actionKey: "cyclePanels" },
	{ id: "cycle-panels-reverse", combo: "Shift+F6", actionKey: "cyclePanelsReverse" },
	{
		id: "show-shortcuts",
		combo: "mod+/",
		accelerator: "CmdOrCtrl+/",
		actionKey: "showShortcuts",
	},
	{
		id: "preview",
		combo: "mod+P",
		accelerator: "CmdOrCtrl+P",
		actionKey: "togglePreview",
	},
	{
		id: "publish",
		combo: "mod+E",
		accelerator: "CmdOrCtrl+E",
		actionKey: "togglePublish",
	},
	{ id: "find", combo: "mod+F", actionKey: "toggleSearch" },
	{ id: "quick-switcher", combo: "mod+K", actionKey: "quickSwitcher" },
	{ id: "close-tab", combo: "mod+W", actionKey: "closeTab" },
	{ id: "close-focused-tab", combo: "Delete / Backspace", actionKey: "closeFocusedTab" },
	{ id: "toggle-left-panel", combo: "mod+\\", actionKey: "toggleLeftPanel" },
	// Digits follow each ribbon top-to-bottom, so the number matches what the eye
	// counts. They used to be arbitrary — Design was 1, Accessibility 2,
	// Compositions 3, and Blocks (the most-used panel) had no binding at all.
	{
		id: "sidebar-files",
		combo: "mod+Shift+1",
		accelerator: "CmdOrCtrl+Shift+1",
		actionKey: "sidebarFiles",
	},
	{
		id: "sidebar-pages",
		combo: "mod+Shift+2",
		accelerator: "CmdOrCtrl+Shift+2",
		actionKey: "sidebarPages",
	},
	{
		id: "sidebar-miniature",
		combo: "mod+Shift+3",
		accelerator: "CmdOrCtrl+Shift+3",
		actionKey: "sidebarMiniature",
	},
	{ id: "panel-blocks", combo: "mod+1", actionKey: "panelBlocks" },
	{ id: "panel-compositions", combo: "mod+2", actionKey: "panelCompositions" },
	{ id: "panel-design", combo: "mod+3", actionKey: "panelDesign" },
	{
		id: "panel-accessibility",
		combo: "mod+4",
		actionKey: "panelAccessibility",
	},
	{
		id: "app-settings",
		combo: "mod+,",
		accelerator: "CmdOrCtrl+,",
		actionKey: "appSettings",
	},
	{
		id: "new-project",
		combo: "mod+N",
		accelerator: "CmdOrCtrl+N",
		actionKey: "newProject",
	},
	{
		id: "open-project",
		combo: "mod+O",
		accelerator: "CmdOrCtrl+O",
		actionKey: "openProject",
	},
	{
		id: "open-workspace",
		combo: "mod+Shift+O",
		accelerator: "CmdOrCtrl+Shift+O",
		actionKey: "openWorkspace",
	},
	{
		id: "save",
		combo: "mod+S",
		accelerator: "CmdOrCtrl+S",
		actionKey: "save",
	},
	{
		id: "zoom-in",
		combo: "mod+=",
		accelerator: "CmdOrCtrl+=",
		actionKey: "zoomIn",
	},
	{
		id: "zoom-out",
		combo: "mod+-",
		accelerator: "CmdOrCtrl+-",
		actionKey: "zoomOut",
	},
	{
		id: "zoom-reset",
		combo: "mod+0",
		accelerator: "CmdOrCtrl+0",
		actionKey: "zoomReset",
	},
	// Implemented in PageCard, but absent here until now, so the only way to learn
	// it was to read the source. A shortcut nobody can discover is not a keyboard
	// alternative to dragging.
	{ id: "move-page-up", combo: "Alt+Up", actionKey: "movePageUp" },
	{ id: "move-page-down", combo: "Alt+Down", actionKey: "movePageDown" },
] as const;

export const KEYBOARD_SHORTCUT_REGISTRY = LEGACY_SHORTCUTS.map((shortcut) => ({
	...shortcut,
	context: "legacy-shell" as const,
})) satisfies readonly KeyboardShortcutSpec[];
export {
	BROWSER_RESERVED_SHORTCUTS,
	EDITOR_SHORTCUT_REGISTRY,
	editorShortcutRows,
	validateEditorShortcuts,
} from "@praxity/editor-core/shortcuts";

export type KeyboardShortcutId = (typeof KEYBOARD_SHORTCUT_REGISTRY)[number]["id"];
export type KeyboardShortcutActionKey = (typeof KEYBOARD_SHORTCUT_REGISTRY)[number]["actionKey"];

// These combinations address browser tabs, windows, navigation, print, bookmarks or zoom.
const LEGACY_BROWSER_UNAVAILABLE_SHORTCUT_IDS = new Set<string>([
	"new-project",
	"open-project",
	"open-workspace",
	"close-tab",
	"preview",
	"publish",
	"quick-switcher",
	"panel-blocks",
	"panel-compositions",
	"panel-design",
	"panel-accessibility",
	"zoom-in",
	"zoom-out",
	"zoom-reset",
]);

export function availableKeyboardShortcuts(browser = false): readonly KeyboardShortcutSpec[] {
	if (!browser) return KEYBOARD_SHORTCUT_REGISTRY;
	return KEYBOARD_SHORTCUT_REGISTRY.filter(
		(shortcut) => !LEGACY_BROWSER_UNAVAILABLE_SHORTCUT_IDS.has(shortcut.id),
	).map((shortcut) => ({
		...shortcut,
		combo: shortcut.id.startsWith("cycle-panels") ? `Alt+${shortcut.combo}` : shortcut.combo,
	}));
}

const MAC_SHORTCUT_SYMBOLS: Record<string, string> = {
	mod: "⌘",
	Ctrl: "⌃",
	Alt: "⌥",
	Shift: "⇧",
};

export function formatKeyboardShortcut(
	combo: string,
	platform = typeof navigator === "undefined" ? "" : navigator.platform,
): string {
	if (!platform.startsWith("Mac")) return combo.replaceAll("mod", "Ctrl");
	return combo
		.split("+")
		.map((key) => MAC_SHORTCUT_SYMBOLS[key] ?? key)
		.join("");
}

export function getKeyboardShortcut(
	id: KeyboardShortcutId,
	platform = typeof navigator === "undefined" ? "" : navigator.platform,
): KeyboardShortcutSpec {
	const shortcut = KEYBOARD_SHORTCUT_REGISTRY.find((candidate) => candidate.id === id);
	if (!shortcut) {
		throw new Error(`Unknown keyboard shortcut: ${id}`);
	}
	return { ...shortcut, combo: formatKeyboardShortcut(shortcut.combo, platform) };
}
