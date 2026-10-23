import { afterEach, expect, it, vi } from "vitest";
import { nativeMessageWindow } from "../../test-support/message-window";
import { isTrustedEditorInput, listenEditorInput, listenFrameMessages } from "./listeners";

afterEach(() => {
	document.body.innerHTML = "";
});
it("framework input admission requires trust and the owning document", () => {
	const button = document.createElement("button");
	const foreign = document.implementation.createHTMLDocument().createElement("button");
	expect(isTrustedEditorInput({ isTrusted: false, target: button }, document)).toBe(false);
	expect(isTrustedEditorInput({ isTrusted: true, target: foreign }, document)).toBe(false);
	expect(isTrustedEditorInput({ isTrusted: true, target: null }, document)).toBe(false);
	expect(isTrustedEditorInput({ isTrusted: true, target: button }, document)).toBe(true);
});
it.each(["keydown", "click", "pointerover", "focusin", "cancel"] as const)(
	"refuses forged %s input at the owner",
	(type) => {
		const button = document.createElement("button");
		document.body.append(button);
		const receive = vi.fn();
		const dispose = listenEditorInput(document, type, receive);
		try {
			button.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
			expect(receive).not.toHaveBeenCalled();
		} finally {
			dispose();
		}
	},
);
it("admits native focus in its document and removes the listener on disposal", () => {
	const button = document.createElement("button");
	document.body.append(button);
	const receive = vi.fn();
	const dispose = listenEditorInput(document, "focusin", receive);
	button.focus();
	expect(receive).toHaveBeenCalledOnce();
	dispose();
	button.blur();
	button.focus();
	expect(receive).toHaveBeenCalledOnce();
});

it("closed-root listeners admit native focus once, refuse synthetic input and foreign documents", () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = host.attachShadow({ mode: "closed" });
	const field = document.createElement("textarea");
	root.append(field);
	const receive = vi.fn();
	const remove = listenEditorInput(document, "focusin", receive, false, false, root);
	field.focus();
	expect(receive).toHaveBeenCalledOnce();
	field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
	expect(receive).toHaveBeenCalledOnce();
	remove();
	field.blur();
	field.focus();
	expect(receive).toHaveBeenCalledOnce();
	const foreign = document.implementation.createHTMLDocument();
	const foreignHost = foreign.createElement("div");
	foreign.body.append(foreignHost);
	const foreignRoot = foreignHost.attachShadow({ mode: "closed" });
	const foreignField = foreign.createElement("textarea");
	foreignRoot.append(foreignField);
	const removeForeign = listenEditorInput(document, "focusin", receive, false, false, foreignRoot);
	foreignField.focus();
	expect(receive).toHaveBeenCalledOnce();
	removeForeign();
});
it("requires both exact origin and the current source window, then disposes", () => {
	const receive = vi.fn();
	const dispose = listenFrameMessages(
		nativeMessageWindow(window),
		"https://course.test",
		() => window,
		receive,
	);
	const send = (origin: string, source: Window | null) =>
		window.dispatchEvent(new MessageEvent("message", { origin, source }));
	try {
		send("https://attacker.test", window);
		send("https://course.test", null);
		expect(receive).not.toHaveBeenCalled();
		send("https://course.test", window);
		expect(receive).toHaveBeenCalledOnce();
		dispose();
		send("https://course.test", window);
		expect(receive).toHaveBeenCalledOnce();
	} finally {
		dispose();
	}
});
it("refuses a synthetic message even with the exact origin and source", () => {
	const receive = vi.fn();
	const dispose = listenFrameMessages(window, "https://course.test", () => window, receive);
	try {
		window.dispatchEvent(
			new MessageEvent("message", { origin: "https://course.test", source: window }),
		);
		expect(receive).not.toHaveBeenCalled();
	} finally {
		dispose();
	}
});
