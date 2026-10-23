import type { PreviewRenderEvent } from "@praxity/shared-blocks/course-preview-protocol";
import { expect, it, vi } from "vitest";
import { connectRenderPreview } from "./preview";
import type { connectPageFrame } from "./transport";

function fixture() {
	const frame = {
		patch: vi.fn(),
		nodes: vi.fn(),
		draft: vi.fn(),
		beginDraft: vi.fn(),
		resetDraftEpoch: vi.fn(),
		compileFailed: vi.fn(),
	};
	let receive: (event: PreviewRenderEvent) => void = () => {};
	const unsubscribe = vi.fn();
	const status = document.createElement("span");
	const announce = vi.fn();
	const selectPage = vi.fn(async () => {});
	const onPagesChanged = vi.fn();
	const preview = connectRenderPreview({
		pageId: "page",
		frame: frame as unknown as ReturnType<typeof connectPageFrame>,
		subscribe: (handler) => {
			receive = handler;
			return unsubscribe;
		},
		selectPage,
		onError: vi.fn(),
		onPagesChanged,
		status,
		translate: (key) => key,
		announce,
	});
	return {
		frame,
		preview,
		receive: (event: PreviewRenderEvent) => receive(event),
		unsubscribe,
		status,
		announce,
		selectPage,
		onPagesChanged,
	};
}
it("F9 reveal explicitly resyncs the retained page without resetting draft epoch", () => {
	const h = fixture();
	h.preview.select();
	h.preview.select();
	expect(h.selectPage).toHaveBeenCalledTimes(1);
	h.preview.select(true);
	expect(h.selectPage).toHaveBeenCalledTimes(2);
	expect(h.frame.resetDraftEpoch).not.toHaveBeenCalled();
	h.preview.dispose();
	h.preview.select(true);
	expect(h.selectPage).toHaveBeenCalledTimes(2);
});
it("A1 feedback supplies its owned message reference to the controller adapter", () => {
	const h = fixture();
	h.preview.feedback({
		nodes: {},
		failure: [{ message: "Broken page", line: 1 }],
	});
	expect(h.announce).toHaveBeenCalledWith(
		"renderFeedback.pageFailed",
		{
			key: "renderFeedback.pageFailed",
			params: { message: "Broken page" },
		},
		expect.any(Function),
	);
});
it("routes only host events for the selected page and disposes its subscription", () => {
	const { preview, frame, receive, unsubscribe } = fixture();
	receive({ type: "nodesRendered", render: { pageId: "other", seq: 1, fragments: [] } });
	expect(frame.nodes).not.toHaveBeenCalled();
	receive({ type: "nodesRendered", render: { pageId: "page", seq: 2, fragments: [] } });
	expect(frame.nodes).toHaveBeenCalledOnce();
	preview.dispose();
	receive({ type: "nodesRendered", render: { pageId: "page", seq: 3, fragments: [] } });
	expect(frame.nodes).toHaveBeenCalledOnce();
	expect(unsubscribe).toHaveBeenCalledOnce();
});
it("reports a changed page list to its owner without touching the frame", () => {
	const { receive, frame, onPagesChanged } = fixture();
	receive({ type: "pagesChanged", pageIds: ["other"] });
	expect(onPagesChanged).toHaveBeenCalledOnce();
	expect(Object.values(frame).every((call) => call.mock.calls.length === 0)).toBe(true);
});
it("starts Saving at the gesture and ignores a draft response after an epoch change", async () => {
	const { preview, frame, status } = fixture();
	let finish: (result: {
		ok: boolean;
		render: { pageId: string; seq: number; transactionId: string; state: "draft"; fragments: [] };
	}) => void = () => {};
	const rendering = preview.renderDraft(
		{ seq: 1, transactionId: "a", nodeId: "one", source: "Draft" },
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	expect(status.textContent).toBe("renderFeedback.saving");
	expect(frame.beginDraft).toHaveBeenCalledWith({
		seq: 1,
		epoch: 0,
		transactionId: "a",
		nodeIds: ["one"],
	});
	preview.resetDraftEpoch(1);
	finish({
		ok: true,
		render: { pageId: "page", seq: 1, transactionId: "a", state: "draft", fragments: [] },
	});
	await rendering;
	expect(frame.draft).not.toHaveBeenCalled();
});
it("deduplicates failure announcements and never announces Updating", () => {
	const { preview, status, announce } = fixture();
	const feedback = { nodes: { one: { state: "updating" as const } }, failure: null };
	preview.feedback(feedback);
	preview.feedback(feedback);
	expect(status.textContent).toBe("renderFeedback.saved");
	expect(announce).not.toHaveBeenCalled();
	preview.feedback({ nodes: {}, failure: [{ message: "Failure" }] });
	preview.feedback({ nodes: {}, failure: [{ message: "Failure" }] });
	expect(announce).toHaveBeenCalledOnce();
});
it("a preview refusal paints nothing and waits for the durable result", async () => {
	const { preview, frame, status, announce } = fixture();
	await preview.renderDraft(
		{ seq: 1, transactionId: "a", nodeId: "one", source: "First.\n\nSecond." },
		async () => ({ ok: false }),
	);
	expect(frame.draft).not.toHaveBeenCalled();
	expect(status.textContent).toBe("renderFeedback.saving");
	preview.settle("a", true);
	// Releases the frame's hold without claiming a refusal.
	expect(frame.draft).toHaveBeenCalledWith(
		{ pageId: "page", seq: 1, transactionId: "a", state: "saved", fragments: [] },
		0,
	);
	expect(status.textContent).toBe("renderFeedback.saved");
	expect(announce.mock.calls).toEqual([
		["renderFeedback.saved", { key: "renderFeedback.saved", params: {} }],
	]);
});
it("a durable refusal of a painted draft reports Changes not saved; the scheduler repaints", async () => {
	const { preview, frame, status, announce } = fixture();
	const render = {
		pageId: "page",
		seq: 1,
		transactionId: "a",
		state: "draft" as const,
		fragments: [],
	};
	await preview.renderDraft(
		{ seq: 1, transactionId: "a", nodeId: "one", source: "Draft" },
		async () => ({
			ok: true,
			render,
		}),
	);
	expect(frame.draft).toHaveBeenCalledOnce();
	preview.settle("a", false);
	expect(frame.draft).toHaveBeenCalledOnce();
	expect(status.textContent).toBe("renderFeedback.refused");
	expect(announce.mock.calls).toEqual([
		["renderFeedback.refused", { key: "renderFeedback.refused", params: {} }],
	]);
});
it("a refusal stays until its own node saves or is reverted", async () => {
	const { preview, status } = fixture();
	const save = async (transactionId: string, nodeId: string, ok: boolean) => {
		await preview.renderDraft({ seq: 1, transactionId, nodeId, source: "Draft" }, async () => ({
			ok: false,
		}));
		preview.settle(transactionId, ok);
	};
	await save("a", "one", false);
	await save("b", "two", true);
	expect(status.textContent).toBe("renderFeedback.refused");
	await save("c", "one", true);
	expect(status.textContent).toBe("renderFeedback.saved");
	await save("d", "one", false);
	preview.revert("one");
	expect(status.textContent).toBe("renderFeedback.saved");
});
it("a durable result that beats the preview response still releases the frame", async () => {
	const { preview, frame, status } = fixture();
	let finish: (result: { ok: boolean }) => void = () => {};
	const rendering = preview.renderDraft(
		{ seq: 4, transactionId: "a", nodeId: "one", source: "Draft" },
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	preview.settle("a", false);
	expect(status.textContent).toBe("renderFeedback.refused");
	finish({ ok: false });
	await rendering;
	expect(frame.draft).toHaveBeenCalledWith(
		{ pageId: "page", seq: 4, transactionId: "a", state: "reverted", fragments: [] },
		0,
	);
});
it("a reconnect resyncs the selected page and keeps a save in flight as Saving", async () => {
	const { preview, frame, status, selectPage, announce } = fixture();
	preview.resetDraftEpoch(1);
	// Only the displayed frame selects a page.
	expect(selectPage).not.toHaveBeenCalled();
	preview.select();
	expect(selectPage).toHaveBeenCalledTimes(1);
	const render = {
		pageId: "page",
		seq: 1,
		transactionId: "a",
		state: "draft" as const,
		fragments: [],
	};
	await preview.renderDraft(
		{ seq: 1, transactionId: "a", nodeId: "one", source: "Draft" },
		async () => ({
			ok: true,
			render,
		}),
	);
	preview.resetDraftEpoch(2);
	expect(frame.resetDraftEpoch).toHaveBeenLastCalledWith(2);
	expect(selectPage).toHaveBeenCalledTimes(2);
	expect(status.textContent).toBe("renderFeedback.saving");
	preview.settle("a", true);
	expect(status.textContent).toBe("renderFeedback.saved");
	expect(announce.mock.calls).toEqual([
		["renderFeedback.saved", { key: "renderFeedback.saved", params: {} }],
	]);
});
it("shows grammar diagnostics from the author's catalogue, keeping unknown codes as sent", () => {
	const frame = { compileFailed: vi.fn() };
	let receive: (event: PreviewRenderEvent) => void = () => {};
	connectRenderPreview({
		pageId: "page",
		frame: frame as unknown as ReturnType<typeof connectPageFrame>,
		subscribe: (handler) => {
			receive = handler;
			return () => {};
		},
		selectPage: async () => {},
		onError: vi.fn(),
		translate: (key, values) =>
			key === "op.diagnostic.unclosed-block" ? `Le bloc ${values?.type} n'est pas fermé` : key,
	});
	receive({
		type: "compileFailed",
		seq: 3,
		pageId: "page",
		diagnostics: [
			{
				message: "grammar.v4.unclosed-block",
				line: 4,
				messageRef: { key: "grammar.v4.unclosed-block", args: { type: "note" } },
			},
			{
				message: "grammar.v4.future-code",
				messageRef: { key: "grammar.v4.future-code", args: {} },
			},
		],
	});
	expect(frame.compileFailed).toHaveBeenCalledWith(3, [
		expect.objectContaining({ message: "Le bloc note n'est pas fermé", line: 4 }),
		expect.objectContaining({ message: "grammar.v4.future-code" }),
	]);
});

it.each([
	[
		"write-distractors",
		"unsupported-runtime",
		"Write distractors can’t be published yet.",
		"La rédaction de mauvaises réponses ne peut pas encore être publiée.",
	],
	[
		"highlight",
		"highlight-invalid",
		"The highlight library refuses this content. Check the passages, targets and explanations.",
		"La bibliothèque de surlignage refuse ce contenu. Vérifiez les passages, les cibles et les explications.",
	],
])(
	"localizes the %s publication diagnostic without private-choice copy",
	(type, code, english, french) => {
		const frame = { compileFailed: vi.fn() };
		let receive: (event: PreviewRenderEvent) => void = () => {};
		const translate = vi.fn((key: string) =>
			key ===
			`op.diagnostic.${code === "unsupported-runtime" ? `${type}-unsupported-runtime` : code}`
				? french
				: key,
		);
		connectRenderPreview({
			pageId: "page",
			frame: frame as unknown as ReturnType<typeof connectPageFrame>,
			subscribe: (handler) => {
				receive = handler;
				return () => {};
			},
			selectPage: async () => {},
			onError: vi.fn(),
			translate,
		});
		receive({
			type: "compileFailed",
			seq: 1,
			pageId: "page",
			diagnostics: [
				{
					message: english,
					line: 5,
					column: 1,
					messageRef: {
						key: `grammar.v4.${code}`,
						args: { type, line: 5, column: 1 },
					},
				},
			],
		});
		expect(frame.compileFailed).toHaveBeenCalledWith(1, [
			expect.objectContaining({
				message: french,
				line: 5,
				column: 1,
			}),
		]);
		expect(translate).toHaveBeenCalledWith(
			`op.diagnostic.${code === "unsupported-runtime" ? `${type}-unsupported-runtime` : code}`,
			{
				type,
				line: "5",
				column: "1",
			},
		);
	},
);
