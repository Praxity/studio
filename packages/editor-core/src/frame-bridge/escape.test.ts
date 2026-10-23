import { afterEach, expect, it, vi } from "vitest";
import { createEscapeDispatcher } from "./escape";

afterEach(() => {
	document.body.innerHTML = "";
});
it("M2 ignores forged keys in both documents and disposes", () => {
	const frame = document.createElement("iframe");
	document.body.append(frame);
	const frameDocument = frame.contentDocument;
	if (!frameDocument) throw new Error("Missing frame document");
	const send = vi.fn(() => false);
	const dispatcher = createEscapeDispatcher(send);
	dispatcher.attach(document);
	dispatcher.attach(frameDocument);
	const bubble = vi.fn();
	frameDocument.addEventListener("keydown", bubble);
	const frameWindow = frame.contentWindow;
	if (!frameWindow) throw new Error("Missing frame window");
	const unused = new frameWindow.KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	frameDocument.body.dispatchEvent(unused);
	expect(unused.defaultPrevented).toBe(false);
	expect(send).not.toHaveBeenCalled();
	expect(bubble).toHaveBeenCalledOnce();
	send.mockReturnValue(true);
	const used = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
	document.body.dispatchEvent(used);
	expect(used.defaultPrevented).toBe(false);
	expect(send).not.toHaveBeenCalled();
	dispatcher.dispose();
	document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	expect(send).not.toHaveBeenCalled();
});
it("M2 ignores forged dialog cancellation", () => {
	const send = vi.fn(() => true);
	const dispatcher = createEscapeDispatcher(send);
	dispatcher.attach(document);
	const dialog = document.createElement("dialog");
	document.body.append(dialog);
	const cancel = new Event("cancel", { cancelable: true });
	dialog.dispatchEvent(cancel);
	expect(cancel.defaultPrevented).toBe(false);
	expect(send).not.toHaveBeenCalled();
	dispatcher.dispose();
});
