import { afterEach, expect, it, vi } from "vitest";
import { nativeMessageWindow } from "../../test-support/message-window";
import type { FrameView } from "../frame-bridge/protocol";
import { connectPageFrame } from "../frame-bridge/transport";

afterEach(() => {
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});
it.each([true, false])(
	"early canvas entry replays only while the frame still owns focus: %s",
	async (ownsFocus) => {
		const frame = document.createElement("iframe");
		const outside = document.createElement("button");
		document.body.append(frame, outside);
		const contentWindow = frame.contentWindow;
		if (!contentWindow) throw new Error("Missing frame");
		const post = vi.spyOn(contentWindow, "postMessage").mockImplementation(() => {});
		const target = { file: "lesson.prax", nodeId: "page", role: "handle" as const };
		const view: FrameView = {
			file: "lesson.prax",
			pageId: "page",
			language: "en",
			alwaysShowHandles: false,
			nodes: [{ id: "page", kind: "page", parentId: null, name: "Page", description: "Page" }],
			selected: [],
			expanded: [],
			focus: null,
		};
		const identity = { channel: "u5", pageId: "page" };
		const ports = new MessageChannel();
		const commands: string[] = [];
		ports.port2.onmessage = (event) => commands.push(event.data.action);
		const bridge = connectPageFrame({
			window: nativeMessageWindow(window),
			frame,
			frameOrigin: "https://course.test",
			...identity,
			view,
			onEvent: () => {},
		});
		try {
			frame.focus();
			bridge.focus(target);
			if (!ownsFocus) outside.focus();
			window.dispatchEvent(
				new MessageEvent("message", {
					origin: "https://course.test",
					source: contentWindow,
					data: { source: "praxity-frame", version: 1, ...identity, event: "ready" },
					ports: [ports.port1],
				}),
			);
			const expected = ownsFocus ? ["render", "focus"] : ["render"];
			await vi.waitFor(() => expect(commands).toEqual(expected));
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(commands).toEqual(expected);
			expect(post).not.toHaveBeenCalled();
		} finally {
			bridge.dispose();
			ports.port1.close();
			ports.port2.close();
		}
	},
);
