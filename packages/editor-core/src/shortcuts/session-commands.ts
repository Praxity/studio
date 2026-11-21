import type { Command } from "../session/types";
export type FrameShortcutAction = "toggle" | "selectAll" | "moveUp" | "moveDown" | "delete";
export function frameShortcutCommand(action: FrameShortcutAction | "membershipToggle"): Command {
	switch (action) {
		case "toggle":
			return { type: "selectionKey", key: "toggle" };
		case "membershipToggle":
			return { type: "selectionKey", key: "membership" };
		case "selectAll":
			return { type: "selectionKey", key: "all" };
		case "moveUp":
		case "moveDown":
			return {
				type: "selectionOperation",
				operation: "moveBlocks",
				args: { direction: action === "moveUp" ? "up" : "down" },
			};
		case "delete":
			return { type: "selectionOperation", operation: "deleteBlocks", args: {} };
	}
}
