import { expect, it } from "vitest";
import { isFrameCommand, isFrameEvent } from "./protocol";

const identity = { channel: "private", pageId: "page" };
it("D6 final-input payload admits exact LF text and refuses malformed caret and extra fields", () => {
	const message = {
		source: "praxity-frame",
		version: 1,
		...identity,
		presentationId: 0,
		event: "escape",
	};
	const finalInput = { draftId: "draft", text: "ABC\n", selection: [3, 3] };
	expect(isFrameEvent({ ...message, finalInput }, identity)).toBe(true);
	for (const invalid of [
		{ ...finalInput, draftId: "" },
		{ ...finalInput, extra: true },
		{ ...finalInput, text: null },
		{ ...finalInput, selection: [-1, 0] },
		{ ...finalInput, selection: [4, 3] },
		{ ...finalInput, selection: [0, 5] },
		{ ...finalInput, selection: [0, 1.5] },
		{ ...finalInput, selection: [0] },
	])
		expect(isFrameEvent({ ...message, finalInput: invalid }, identity)).toBe(false);
});
const command = (body: object) => ({ source: "praxity-editor", version: 1, ...identity, ...body });
it("D6 host capture requests and replies have no protocol authority", () => {
	const request = { action: "captureSource", draftId: "draft", requestId: 1, presentationId: 0 };
	expect(isFrameCommand(command(request), identity)).toBe(false);
	for (const invalid of [
		{ ...request, draftId: "" },
		{ ...request, requestId: -1 },
		{ ...request, presentationId: -1 },
		{ ...request, extra: true },
	])
		expect(isFrameCommand(command(invalid), identity)).toBe(false);
	const reply = {
		source: "praxity-frame",
		version: 1,
		...identity,
		presentationId: 0,
		event: "sourceCaptured",
		requestId: 1,
		input: null,
	};
	expect(isFrameEvent(reply, identity)).toBe(false);
	for (const invalid of [
		{ ...reply, requestId: -1 },
		{ ...reply, input: {} },
		{ ...reply, extra: true },
	])
		expect(isFrameEvent(invalid, identity)).toBe(false);
});
const fragment = { id: "one", html: '<div data-node-id="one">One</div>' };
const render = { seq: 1, pageId: "page", fragments: [fragment] };
it.each([
	{ action: "nodes", render },
	{ action: "patch", patch: { ...render, order: ["one"], shellStale: false }, documentRegions: [] },
	{ action: "draft", render: { ...render, state: "draft", transactionId: "a" }, epoch: 0 },
	{ action: "beginDraft", request: { seq: 1, epoch: 0, transactionId: "a", nodeIds: ["one"] } },
	{ action: "draftEpoch", epoch: 1 },
	{
		action: "compileFailed",
		seq: 1,
		diagnostics: [{ message: "Failure", file: "lesson.prax", line: 2 }],
	},
	{
		action: "compileFailed",
		seq: 2,
		diagnostics: [
			{
				message: "Unclosed note",
				messageRef: { key: "grammar.v4.unclosed", args: { type: "note" } },
			},
		],
	},
])("admits a complete private envelope %j and refuses extra identity or fields", (body) => {
	expect(isFrameCommand(command(body), identity)).toBe(true);
	expect(isFrameCommand(command({ ...body, extra: true }), identity)).toBe(false);
	expect(isFrameCommand({ ...command(body), channel: "learner" }, identity)).toBe(false);
});
it.each([
	{ action: "nodes", render: { ...render, pageId: "other" } },
	{ action: "nodes", render: { ...render, seq: -1 } },
	{ action: "nodes", render: { ...render, seq: 0.1 } },
	{ action: "nodes", render: { ...render, seq: Number.MAX_SAFE_INTEGER + 1 } },
	{ action: "nodes", render: { ...render, fragments: [fragment, fragment] } },
	{ action: "nodes", render: { ...render, fragments: [{ ...fragment, html: null }] } },
	{ action: "nodes", render: { ...render, fragments: [{ ...fragment, island: 1 }] } },
	{ action: "draft", render: { ...render, state: "pending", transactionId: "a" }, epoch: 0 },
	{ action: "draft", render: { ...render, state: ["draft"], transactionId: "a" }, epoch: 0 },
	{ action: "draft", render: { ...render, state: "draft", transactionId: "" }, epoch: -1 },
	{
		action: "patch",
		patch: { ...render, order: ["one", "one"], shellStale: false },
		documentRegions: [],
	},
	{
		action: "patch",
		patch: { ...render, order: ["one"], shellStale: "false" },
		documentRegions: [],
	},
	{
		action: "beginDraft",
		request: { seq: 1, epoch: 0, transactionId: "a", nodeIds: ["one", "one"] },
	},
	{ action: "compileFailed", seq: 1, diagnostics: [{ message: "Failure", line: -1 }] },
	{ action: "compileFailed", seq: 1, diagnostics: [{ message: 12 }] },
])("refuses malformed patch and feedback input %#", (body) => {
	expect(isFrameCommand(command(body), identity)).toBe(false);
});
it("admits feedback only with exact states and diagnostics", () => {
	const message = {
		source: "praxity-frame",
		version: 1,
		...identity,
		event: "renderFeedback",
		feedback: { nodes: { one: { state: "updating" } }, failure: null },
	};
	expect(isFrameEvent(message, identity)).toBe(true);
	for (const feedback of [
		// Save state is the controller's; a frame cannot report it.
		{ ...message.feedback, save: "saved" },
		{ ...message.feedback, nodes: { one: { state: "failed" } } },
		{ ...message.feedback, failure: [{ message: false }] },
	])
		expect(isFrameEvent({ ...message, feedback }, identity)).toBe(false);
});
