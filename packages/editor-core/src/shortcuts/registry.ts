export type ShortcutContext = "global" | "outline" | "handle" | "field" | "margin";
export type ShortcutPlatform = "windows" | "mac";
export const EDITOR_ACTIONS = [
	"previous",
	"next",
	"start",
	"end",
	"expand",
	"collapse",
	"enter",
	"toggle",
	"membershipToggle",
	"rangePrevious",
	"rangeNext",
	"rangeStart",
	"rangeEnd",
	"selectAll",
	"source",
	"actions",
	"moveUp",
	"moveDown",
	"delete",
	"nextRegion",
	"previousRegion",
	"commitSource",
	"saveSource",
	"undoSource",
	"redoSource",
] as const;
export type EditorAction = (typeof EDITOR_ACTIONS)[number];
export interface EditorShortcut {
	context: ShortcutContext;
	combo: string;
	action: EditorAction;
}
const navigation = [
	["ArrowUp", "previous"],
	["ArrowDown", "next"],
	["Home", "start"],
	["End", "end"],
	["Shift+ArrowUp", "rangePrevious"],
	["Shift+ArrowDown", "rangeNext"],
	["Shift+Home", "rangeStart"],
	["Shift+End", "rangeEnd"],
	["Shift+Space", "toggle"],
	["mod+A", "selectAll"],
	["F2", "source"],
	["Shift+F10", "actions"],
	["ContextMenu", "actions"],
	["mod+Shift+ArrowUp", "moveUp"],
	["mod+Shift+ArrowDown", "moveDown"],
	["Delete", "delete"],
] as const;
export const EDITOR_SHORTCUT_REGISTRY: readonly EditorShortcut[] = [
	...(["outline", "handle"] as const).flatMap((context) =>
		navigation.map(([combo, action]) => ({ context, combo, action })),
	),
	{ context: "outline", combo: "ArrowRight", action: "expand" },
	{ context: "outline", combo: "ArrowLeft", action: "collapse" },
	{ context: "outline", combo: "Enter", action: "enter" },
	{ context: "outline", combo: "Space", action: "membershipToggle" },
	{ context: "handle", combo: "Enter", action: "actions" },
	{ context: "handle", combo: "Space", action: "actions" },
	{ context: "handle", combo: "Alt+ArrowDown", action: "actions" },
	{ context: "global", combo: "Alt+F6", action: "nextRegion" },
	{ context: "global", combo: "Alt+Shift+F6", action: "previousRegion" },
	{ context: "field", combo: "mod+Enter", action: "commitSource" },
	{ context: "field", combo: "mod+S", action: "saveSource" },
	{ context: "field", combo: "mod+Z", action: "undoSource" },
	{ context: "field", combo: "mod+Shift+Z", action: "redoSource" },
];

// These contracts are implemented by the adapters' exhaustive handler records.
// An action existing elsewhere does not make it executable in this context.
export const EDITOR_CONTEXT_ACTIONS = {
	outline: [
		...navigation.map(([, action]) => action),
		"expand",
		"collapse",
		"enter",
		"membershipToggle",
	],
	handle: [...navigation.map(([, action]) => action)],
	global: ["nextRegion", "previousRegion"],
	field: ["commitSource", "saveSource", "undoSource", "redoSource"],
	margin: [],
} as const satisfies Record<ShortcutContext, readonly EditorAction[]>;
export type EditorShortcutHandlers<C extends ShortcutContext> = Record<
	(typeof EDITOR_CONTEXT_ACTIONS)[C][number],
	() => void
>;
const MODIFIERS = ["mod", "ctrl", "meta", "alt", "shift"];
function normalizeCombo(combo: string): string {
	const parts = combo.toLowerCase().split("+");
	return [
		...MODIFIERS.filter((modifier) => parts.includes(modifier)),
		...parts.filter((part) => !MODIFIERS.includes(part)),
	].join("+");
}

// K2 applies in Electron too. The legacy desktop's application accelerators
// remain separate until U20 retires that shell.
export const BROWSER_RESERVED_SHORTCUTS = new Set([
	"mod+d",
	"mod+shift+d",
	"mod+shift+h",
	"mod+shift+m",
	"mod+l",
	"mod+t",
	"mod+n",
	"mod+w",
	"mod+j",
	"mod+h",
	"mod+p",
	"mod+o",
	"mod+shift+o",
	"mod+k",
	"mod+e",
	"mod+1",
	"mod+2",
	"mod+3",
	"mod+4",
	"mod+=",
	"mod+-",
	"mod+0",
	"f5",
	"f6",
	"shift+f6",
	"f7",
	"f11",
	"f12",
	"ctrl+space",
]);
export function validateEditorShortcuts(
	entries: readonly { context: string; combo: string; action: string }[] = EDITOR_SHORTCUT_REGISTRY,
): string[] {
	const errors: string[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		const combo = normalizeCombo(entry.combo);
		const parts = combo.split("+");
		if (!["global", "outline", "handle", "field", "margin"].includes(entry.context))
			errors.push(`Missing context: ${entry.combo}`);
		const actions: readonly string[] =
			EDITOR_CONTEXT_ACTIONS[entry.context as ShortcutContext] ?? [];
		if (!actions.includes(entry.action))
			errors.push(`Missing handler in ${entry.context}: ${entry.action}`);
		if (
			(entry.action === "moveUp" || entry.action === "moveDown") &&
			entry.context !== "outline" &&
			entry.context !== "handle"
		)
			errors.push(`Move context must be outline or handle: ${entry.context}`);
		const identity = `${entry.context}:${combo}`;
		if (seen.has(identity)) errors.push(`Duplicate shortcut: ${identity}`);
		seen.add(identity);
		if (
			[...BROWSER_RESERVED_SHORTCUTS].some((reserved) => normalizeCombo(reserved) === combo) ||
			parts.includes("insert") ||
			parts.includes("capslock") ||
			(parts.includes("ctrl") && parts.includes("alt")) ||
			(parts.includes("ctrl") && parts.some((p) => p.startsWith("arrow")))
		)
			errors.push(`Reserved shortcut: ${entry.combo}`);
	}
	return errors;
}
/** U19 renders these exact entries; no separate documentation bindings. */
export const editorShortcutRows = () => EDITOR_SHORTCUT_REGISTRY;
type Key = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> &
	Partial<Pick<KeyboardEvent, "isComposing" | "keyCode">>;
export function findEditorShortcut(
	event: Key,
	context: ShortcutContext,
	platform: ShortcutPlatform,
): EditorShortcut | undefined {
	if (event.isComposing || event.keyCode === 229) return undefined;
	const key = event.key === " " ? "space" : event.key.toLowerCase();
	return EDITOR_SHORTCUT_REGISTRY.find((entry) => {
		if (entry.context !== context && entry.context !== "global") return false;
		const parts = normalizeCombo(entry.combo).split("+");
		const mod = parts.includes("mod");
		return (
			parts.at(-1) === key &&
			event.ctrlKey === (parts.includes("ctrl") || (mod && platform === "windows")) &&
			event.metaKey === (parts.includes("meta") || (mod && platform === "mac")) &&
			event.altKey === parts.includes("alt") &&
			event.shiftKey === parts.includes("shift")
		);
	});
}
export function invokeEditorShortcut(
	entry: EditorShortcut,
	handlers: Partial<Record<EditorAction, () => void>>,
): void {
	const handler = handlers[entry.action];
	if (!handler) throw new Error(`Missing handler in ${entry.context}: ${entry.action}`);
	handler();
}
