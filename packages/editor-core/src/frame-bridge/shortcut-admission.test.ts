import { afterEach, expect, it, vi } from "vitest";
import { nativeMessageWindow } from "../../test-support/message-window";
import type { FrameView } from "./protocol";
import { connectPageFrame } from "./transport";

const identity = { channel: "keys", pageId: "page" };
const focus = { file: "lesson.prax", nodeId: "block", role: "handle" };
const key = { key: "Delete", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
const view: FrameView = {
	file: "lesson.prax",
	pageId: "page",
	language: "en",
	alwaysShowHandles: false,
	nodes: [
		{ id: "page", parentId: null, kind: "page", name: "Page", description: "Page" },
		{ id: "block", parentId: "page", kind: "block", name: "Block", description: "Block" },
	],
	selected: ["block"],
	expanded: [],
	focus: { ...focus, role: "handle" },
};
const disposers: (() => void)[] = [];
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	document.body.innerHTML = "";
});
function setup(frameView = view, connect = true) {
	const frame = document.createElement("iframe");
	const outside = document.createElement("button");
	document.body.append(frame, outside);
	const onEvent = vi.fn();
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "https://course.test",
		...identity,
		view: frameView,
		onEvent,
	});
	const channel = new MessageChannel();
	disposers.push(
		bridge.dispose,
		() => channel.port1.close(),
		() => channel.port2.close(),
	);
	const envelope = (body: object) => ({
		source: "praxity-frame",
		version: 1,
		...identity,
		...((body as { event: string }).event === "ready" ? {} : { presentationId: 0 }),
		...body,
	});
	const ready = (port: MessagePort, channelId = identity.channel) =>
		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "https://course.test",
				source: frame.contentWindow,
				data: { ...envelope({ event: "ready" }), channel: channelId },
				ports: [port],
			}),
		);
	if (connect) ready(channel.port2);
	onEvent.mockClear();
	frame.focus();
	return {
		frame,
		outside,
		onEvent,
		bridge,
		ready,
		channel,
		send: async (body: object) => {
			channel.port1.postMessage(envelope(body));
			await new Promise((resolve) => setTimeout(resolve, 25));
		},
	};
}

const sourceFocus = { ...focus, role: "source" as const, selection: [0, 0] as const };
const sourceView: FrameView = {
	...view,
	focus: sourceFocus,
	source: {
		draftId: "draft",
		nodeId: "block",
		value: "Text",
		baseText: "Text",
		name: "Source of Block",
		caption: "Source",
		closer: false,
	},
};
const sourceAction = {
	event: "sourceAction",
	draftId: "draft",
	focus: sourceFocus,
	action: "saveSource",
	key: { ...key, key: "s", ctrlKey: true },
};
async function drainSource(h: ReturnType<typeof setup>, body: object) {
	const envelope = (body: object) => ({
		source: "praxity-frame",
		version: 1,
		...identity,
		...((body as { event: string }).event === "height" ? {} : { presentationId: 0 }),
		...body,
	});
	h.channel.port1.postMessage(envelope(body));
	h.channel.port1.postMessage(envelope({ event: "height", height: 123 }));
	await vi.waitFor(() =>
		expect(h.onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event: "height", height: 123 }),
		),
	);
	return h.onEvent.mock.calls.filter(([e]) => e.event.startsWith("source"));
}
it("D3 D6 admits current source text and the matching save binding on the private port", async () => {
	const h = setup(sourceView);
	expect(
		await drainSource(h, {
			event: "sourceChanged",
			draftId: "draft",
			focus: sourceFocus,
			text: "Changed",
		}),
	).toHaveLength(1);
	h.onEvent.mockClear();
	expect(await drainSource(h, sourceAction)).toHaveLength(1);
});
it.each([
	{ ...sourceAction, draftId: "old" },
	{ ...sourceAction, focus: { ...sourceFocus, nodeId: "page" } },
	{ ...sourceAction, focus: { ...sourceFocus, file: "elsewhere.prax" } },
	{ ...sourceAction, focus: { ...sourceFocus, role: "handle" } },
	{ ...sourceAction, key: { ...sourceAction.key, shiftKey: true } },
	{ ...sourceAction, presentationId: 99 },
	{
		event: "sourceChanged",
		draftId: "draft",
		focus: { ...sourceFocus, selection: [0, 8] },
		text: "Text",
	},
	{
		event: "sourceChanged",
		draftId: "draft",
		focus: { ...sourceFocus, selection: [-1, 0] },
		text: "Text",
	},
	{ event: "sourceChanged", draftId: "draft", focus: sourceFocus, text: "Text", rawInput: true },
	{
		event: "sourceChanged",
		draftId: "draft",
		focus: {
			file: sourceFocus.file,
			nodeId: sourceFocus.nodeId,
			role: "source",
		},
		text: "Text",
	},
])("D3 D6 source admission refuses stale, foreign or malformed input %#", async (body) => {
	const h = setup(sourceView);
	expect(await drainSource(h, body)).toEqual([]);
});
it("D6 source actions cannot run after focus leaves the frame or source closes", async () => {
	const h = setup(sourceView);
	h.outside.focus();
	expect(await drainSource(h, sourceAction)).toEqual([]);
	h.frame.focus();
	h.bridge.render(view);
	h.onEvent.mockClear();
	expect(await drainSource(h, sourceAction)).toEqual([]);
});
it.each(["host", "handle"])(
	"D3 final trusted input survives focus leaving to %s",
	async (destination) => {
		const h = setup(sourceView);
		if (destination === "host") h.outside.focus();
		else h.bridge.render({ ...sourceView, focus });
		expect(
			await drainSource(h, {
				event: "sourceChanged",
				draftId: "draft",
				focus: { ...sourceFocus, selection: [7, 7] },
				text: "TextABC",
			}),
		).toHaveLength(1);
	},
);
it.each(["old", "draft"])(
	"D6 stale optional input preserves the current draft-bound action %s",
	async (draftId) => {
		const h = setup(sourceView);
		const event = { ...sourceAction, finalInput: { draftId, text: "TextABC", selection: [7, 7] } };
		expect(await drainSource(h, event)).toHaveLength(1);
		expect(h.onEvent.mock.calls[0][0].finalInput).toEqual(
			draftId === "draft" ? event.finalInput : undefined,
		);
		h.bridge.render(view);
		h.onEvent.mockClear();
		expect(await drainSource(h, event)).toEqual([]);
	},
);
it("admits a captured Delete only through the private key port while its handle owns focus", async () => {
	const h = setup();
	await h.send({ event: "shortcut", action: "delete", focus, key });
	expect(h.onEvent).toHaveBeenCalledWith(
		expect.objectContaining({ event: "shortcut", action: "delete" }),
	);
});
it.each([
	{ action: "moveUp", key, focus },
	{ action: "delete", key, focus: { ...focus, role: "source" } },
	{ action: "delete", key, focus: { ...focus, nodeId: "absent" } },
	{ action: "delete", key: { ...key, key: "F2" }, focus },
	{ action: "delete", key: { ...key, shiftKey: true }, focus },
])(
	"refuses captured $action with focus $focus.role at $focus.nodeId and key $key.key, shift $key.shiftKey",
	async (body) => {
		const h = setup();
		await h.send({ event: "shortcut", ...body });
		expect(h.onEvent).not.toHaveBeenCalled();
	},
);
it("refuses a captured command after focus leaves the frame", async () => {
	const h = setup();
	h.outside.focus();
	await h.send({ event: "shortcut", action: "delete", focus, key });
	expect(h.onEvent).not.toHaveBeenCalled();
});
it("does not replace the private key port on an unsolicited ready message", async () => {
	const h = setup();
	const rogue = new MessageChannel();
	disposers.push(
		() => rogue.port1.close(),
		() => rogue.port2.close(),
	);
	h.ready(rogue.port2);
	h.onEvent.mockClear();
	rogue.port1.postMessage({
		source: "praxity-frame",
		version: 1,
		...identity,
		event: "shortcut",
		action: "delete",
		focus,
		key,
	});
	await new Promise((resolve) => setTimeout(resolve, 25));
	expect(h.onEvent).not.toHaveBeenCalled();
	await h.send({ event: "shortcut", action: "delete", focus, key });
	expect(h.onEvent).toHaveBeenCalledOnce();
});
it("swap closes the old key port until the new bridge is ready", async () => {
	const h = setup();
	h.bridge.prepareSwap();
	await h.send({ event: "shortcut", action: "delete", focus, key });
	expect(h.onEvent).not.toHaveBeenCalled();
});
it("swap refuses the old document's ready and admits only the fresh channel", async () => {
	const h = setup();
	const nextChannel = h.bridge.prepareSwap();
	const next = new MessageChannel();
	disposers.push(
		() => next.port1.close(),
		() => next.port2.close(),
	);
	h.ready(next.port2);
	expect(h.onEvent).not.toHaveBeenCalled();
	expect(nextChannel).not.toBe(identity.channel);
	h.ready(next.port2, nextChannel);
	h.onEvent.mockClear();
	next.port1.postMessage({
		source: "praxity-frame",
		version: 1,
		pageId: identity.pageId,
		channel: nextChannel,
		event: "shortcut",
		presentationId: 0,
		action: "delete",
		focus,
		key,
	});
	await vi.waitFor(() =>
		expect(h.onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event: "shortcut", action: "delete" }),
		),
	);
});
it("canvas entry resolves only after a private focus acknowledgement lands in the frame", async () => {
	const h = setup();
	const result = h.bridge.focus({ ...focus, role: "handle" });
	await h.send({ event: "focusResult", requestId: 1, focus, success: true });
	expect(await result).toBe(true);
	const outsideResult = h.bridge.focus({ ...focus, role: "handle" });
	h.outside.focus();
	await h.send({ event: "focusResult", requestId: 2, focus, success: true });
	expect(await outsideResult).toBe(false);
});
it("disposal resolves pending canvas entry as refused", async () => {
	const h = setup();
	const result = h.bridge.focus({ ...focus, role: "handle" });
	h.bridge.dispose();
	expect(await result).toBe(false);
});

it.each(["closed", "replaced", "readOnly"])(
	"G1 stale optional input strips only its payload at %s",
	async (boundary) => {
		const h = setup(sourceView);
		if (boundary === "closed") h.bridge.render(view);
		if (boundary === "replaced")
			h.bridge.render({ ...sourceView, source: { ...sourceView.source, draftId: "replacement" } });
		if (boundary === "readOnly")
			h.bridge.render({ ...view, readOnly: true, focus: null, selected: [], expanded: [] });
		h.onEvent.mockClear();
		await h.send({
			event: "select",
			focus,
			mode: "single",
			finalInput: { draftId: "draft", text: "obsolete", selection: [8, 8] },
		});
		expect(h.onEvent).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ event: "select", focus, mode: "single" }),
		);
		expect(h.onEvent.mock.calls[0][0]).not.toHaveProperty("finalInput");
	},
);
