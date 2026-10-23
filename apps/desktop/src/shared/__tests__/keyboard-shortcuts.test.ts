import { expect, it } from "vitest";
import { formatKeyboardShortcut, getKeyboardShortcut } from "../keyboard-shortcuts";

it.each([
	["MacIntel", "⌘⇧P", "⌘S"],
	["Win32", "Ctrl+Shift+P", "Ctrl+S"],
	["Linux x86_64", "Ctrl+Shift+P", "Ctrl+S"],
])("formats shortcuts for %s and preserves native accelerators", (platform, preview, save) => {
	expect(formatKeyboardShortcut("mod+Shift+P", platform)).toBe(preview);
	expect(getKeyboardShortcut("save", platform).combo).toBe(save);
	expect(getKeyboardShortcut("preview", platform).accelerator).toBe("CmdOrCtrl+P");
});
