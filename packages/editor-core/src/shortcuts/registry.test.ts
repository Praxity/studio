import { expect, it } from "vitest";
import {
	EDITOR_SHORTCUT_REGISTRY,
	editorShortcutRows,
	findEditorShortcut,
	validateEditorShortcuts,
} from "./registry";

it("K1: each dialog row has exactly one context, combo and executable action", () => {
	expect(validateEditorShortcuts()).toEqual([]);
	expect(editorShortcutRows()).toEqual(EDITOR_SHORTCUT_REGISTRY);
	expect(
		validateEditorShortcuts([
			{ ...EDITOR_SHORTCUT_REGISTRY[0], context: "" },
			EDITOR_SHORTCUT_REGISTRY[1],
			EDITOR_SHORTCUT_REGISTRY[1],
			{ ...EDITOR_SHORTCUT_REGISTRY[0], action: "missing" },
		]),
	).toEqual(
		expect.arrayContaining([
			expect.stringContaining("context"),
			expect.stringContaining("Duplicate"),
			expect.stringContaining("handler"),
		]),
	);
});

it.each([
	"mod+D",
	"mod+Shift+D",
	"mod+Shift+H",
	"mod+Shift+M",
	"mod+L",
	"mod+T",
	"mod+N",
	"mod+W",
	"mod+J",
	"mod+H",
	"F5",
	"F6",
	"F7",
	"F11",
	"F12",
	"Ctrl+Space",
	"Ctrl+Alt+Shift+ArrowUp",
	"Insert+A",
	"CapsLock+A",
	"Ctrl+ArrowLeft",
])("K2 refuses %s", (combo) => {
	expect(validateEditorShortcuts([{ ...EDITOR_SHORTCUT_REGISTRY[0], combo }])).toEqual(
		expect.arrayContaining([expect.stringContaining("Reserved")]),
	);
});

it("context and platform leave native field selection and OS keys alone", () => {
	const event = { key: "ArrowDown", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true };
	expect(findEditorShortcut(event, "outline", "windows")?.action).toBe("moveDown");
	expect(findEditorShortcut(event, "field", "windows")).toBeUndefined();
	expect(findEditorShortcut(event, "outline", "mac")).toBeUndefined();
	expect(
		findEditorShortcut({ ...event, ctrlKey: false, metaKey: true }, "outline", "mac")?.action,
	).toBe("moveDown");
});
it("D19 every context refuses composing shortcuts and legacy IME 229", () => {
	for (const context of ["field", "outline", "handle", "global"] as const) {
		for (const guard of [{ isComposing: true }, { keyCode: 229 }])
			expect(
				findEditorShortcut(
					{ key: "F6", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...guard },
					context,
					"windows",
				),
			).toBeUndefined();
	}
});
it.each([
	{ context: "outline", combo: "F3", action: "nextRegion" },
	{ context: "field", combo: "F2", action: "source" },
	{ context: "handle", combo: "ArrowRight", action: "expand" },
])("K1 refuses an action without a handler in $context", (entry) => {
	expect(validateEditorShortcuts([entry])).toContainEqual(expect.stringContaining("handler"));
});
it.each(["Shift+mod+D", "Shift+mod+H", "Shift+mod+M", "Space+Ctrl"])(
	"K2 refuses reordered reserved chord %s",
	(combo) => {
		expect(
			validateEditorShortcuts([{ context: "outline", combo, action: "source" }]),
		).toContainEqual(expect.stringContaining("Reserved"));
	},
);
it("K1 treats reordered modifiers as the same binding", () => {
	expect(
		validateEditorShortcuts([
			{ context: "outline", combo: "mod+Shift+ArrowDown", action: "moveDown" },
			{ context: "outline", combo: "Shift+mod+ArrowDown", action: "moveDown" },
		]),
	).toContainEqual(expect.stringContaining("Duplicate"));
});
it.each(["field", "margin", "global"])("K4 refuses a move binding in %s", (context) => {
	expect(
		validateEditorShortcuts([{ context, combo: "mod+Shift+ArrowDown", action: "moveDown" }]),
	).toEqual([expect.stringContaining("Missing handler"), expect.stringContaining("Move context")]);
});
