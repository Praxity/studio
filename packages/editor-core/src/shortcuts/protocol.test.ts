import { expect, it, vi } from "vitest";
import { isFrameEvent } from "../frame-bridge/protocol";
import { EDITOR_ACTIONS, EDITOR_SHORTCUT_REGISTRY, invokeEditorShortcut } from "./registry";
import { frameShortcutCommand } from "./session-commands";

it("K1: every documented entry invokes exactly its registered handler", () => {
	const handlers = Object.fromEntries(EDITOR_ACTIONS.map((action) => [action, vi.fn()])) as Record<
		(typeof EDITOR_ACTIONS)[number],
		ReturnType<typeof vi.fn>
	>;
	for (const entry of EDITOR_SHORTCUT_REGISTRY) {
		for (const handler of Object.values(handlers)) handler.mockClear();
		invokeEditorShortcut(entry, handlers);
		expect(handlers[entry.action]).toHaveBeenCalledOnce();
		expect(
			Object.entries(handlers)
				.filter(([, handler]) => handler.mock.calls.length)
				.map(([name]) => name),
		).toEqual([entry.action]);
	}
});
it("region and command transport refuses coercible actions, extra fields and invalid directions", () => {
	const identity = { channel: "u5", pageId: "page" };
	const envelope = { source: "praxity-frame", version: 1, ...identity, presentationId: 0 };
	const key = { key: "ArrowDown", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true };
	const focus = { file: "lesson.prax", nodeId: "block", role: "handle" };
	expect(
		isFrameEvent({ ...envelope, event: "shortcut", action: "moveDown", key, focus }, identity),
	).toBe(true);
	expect(isFrameEvent({ ...envelope, event: "shortcut", action: "moveDown" }, identity)).toBe(
		false,
	);
	expect(
		isFrameEvent({ ...envelope, event: "shortcut", action: ["moveDown"], key, focus }, identity),
	).toBe(false);
	expect(
		isFrameEvent({ ...envelope, event: "shortcut", action: "source", key, focus }, identity),
	).toBe(false);
	expect(
		isFrameEvent({ ...envelope, event: "region", direction: 1, key, focus: "forged" }, identity),
	).toBe(false);
	expect(isFrameEvent({ ...envelope, event: "region", direction: 0, key }, identity)).toBe(false);
});
it("shared operation routing delegates literal commands to U2", () => {
	expect(frameShortcutCommand("moveDown")).toEqual({
		type: "selectionOperation",
		operation: "moveBlocks",
		args: { direction: "down" },
	});
	expect(frameShortcutCommand("delete")).toEqual({
		type: "selectionOperation",
		operation: "deleteBlocks",
		args: {},
	});
});
