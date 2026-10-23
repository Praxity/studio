import type {
	PreviewCompileDiagnostic,
	PreviewDraftRender,
	PreviewRenderEvent,
} from "@praxity/shared-blocks/course-preview-protocol";
import type { Message } from "../session/types";
import type { RenderFeedback } from "./patch";
import type { connectPageFrame } from "./transport";

type DraftRequest = { seq: number; transactionId: string; nodeId: string; source: string };
type SaveState = "saving" | "saved" | "refused";

/** Only the authenticated host stream enters here. Frame events return on its private bridge.
 * Save state is the controller's durable result, reported through `settle`; the frame only paints. */
export function connectRenderPreview(options: {
	pageId: string;
	frame: ReturnType<typeof connectPageFrame>;
	subscribe: (receive: (event: PreviewRenderEvent) => void) => () => void;
	selectPage: (pageId: string) => Promise<unknown>;
	onError: (error: unknown) => void;
	onShellStale?: () => void;
	/** The course's page list changed, so this page's document is out of date. */
	onPagesChanged?: () => void;
	status?: HTMLElement;
	translate?: (key: string, values?: Record<string, string>) => string;
	/** Delayed speech acknowledges delivery or cancellation through the third argument. */
	announce?: (
		message: string,
		reference?: Message,
		acknowledge?: (delivered: boolean) => void,
	) => void;
}) {
	let disposed = false;
	let selected = false;
	let epoch = 0;
	let announcedFailure = "";
	let shownSave: SaveState = "saved";
	const transactions = new Set<string>();
	// Durable operations started here and not yet settled by the controller, with their node.
	const saving = new Map<string, string>();
	// Nodes whose latest durable result was a refusal. Another node's save leaves them refused.
	const refused = new Set<string>();
	// Preview-refused drafts the frame still holds unpainted, by sequence.
	const held = new Map<string, number>();
	// Durable results that arrived while their preview request was still in flight.
	const previewing = new Map<string, boolean | undefined>();
	function release(transactionId: string, seq: number, ok: boolean) {
		options.frame.draft(
			{
				pageId: options.pageId,
				seq,
				transactionId,
				state: ok ? "saved" : "reverted",
				fragments: [],
			},
			epoch,
		);
	}
	function status() {
		const save: SaveState = saving.size ? "saving" : refused.size ? "refused" : "saved";
		if (options.status && options.translate) {
			const text = options.translate(`renderFeedback.${save}`);
			if (options.status.textContent !== text) options.status.textContent = text;
			// Only settled outcomes reach the live region; Saving… stays visual.
			if (save !== shownSave && save !== "saving")
				options.announce?.(text, { key: `renderFeedback.${save}`, params: {} });
		}
		shownSave = save;
	}
	// Grammar diagnostics name their op.diagnostic catalogue entry. The frame shows that
	// text in the author's language; a code without an entry keeps the compiler's message.
	function localized(diagnostic: PreviewCompileDiagnostic): PreviewCompileDiagnostic {
		const ref = diagnostic.messageRef;
		if (!ref?.key.startsWith("grammar.v4.") || !options.translate) return diagnostic;
		const code = ref.key.slice("grammar.v4.".length);
		const key = `op.diagnostic.${code === "unsupported-runtime" && ref.args.type === "write-distractors" ? `${ref.args.type}-unsupported-runtime` : code}`;
		const values = Object.fromEntries(
			Object.entries({ line: diagnostic.line, ...ref.args })
				.filter(([, value]) => value !== undefined)
				.map(([name, value]) => [name, String(value)]),
		);
		const message = options.translate(key, values);
		return message && message !== key ? { ...diagnostic, message } : diagnostic;
	}
	function select() {
		void options.selectPage(options.pageId).catch((error) => {
			if (!disposed) options.onError(error);
		});
	}
	const receive = (event: PreviewRenderEvent) => {
		if (disposed) return;
		if (event.type === "pagesChanged") {
			options.onPagesChanged?.();
			return;
		}
		const pageId =
			event.type === "pageCompiled"
				? event.patch.pageId
				: event.type === "compileFailed"
					? event.pageId
					: event.render.pageId;
		if (pageId !== options.pageId) return;
		switch (event.type) {
			case "pageCompiled":
				options.frame.patch(event.patch, event.documentRegions);
				if (event.patch.shellStale) options.onShellStale?.();
				break;
			case "nodesRendered":
				options.frame.nodes(event.render);
				break;
			case "draftRendered":
				if (event.render.state === "draft" && !transactions.has(event.render.transactionId)) {
					transactions.add(event.render.transactionId);
					options.frame.beginDraft({
						seq: event.render.seq,
						epoch,
						transactionId: event.render.transactionId,
						nodeIds: event.render.fragments.map((f) => f.id),
					});
				}
				options.frame.draft(event.render, epoch);
				if (event.render.state !== "draft") transactions.delete(event.render.transactionId);
				break;
			case "compileFailed":
				options.frame.compileFailed(event.seq, event.diagnostics.map(localized));
				break;
		}
	};
	const unsubscribe = options.subscribe(receive);
	status();
	return {
		receive,
		/** Make this frame the scheduler's visible page. Only the displayed frame selects. */
		select(resync = false) {
			if (disposed || (selected && !resync)) return;
			selected = true;
			select();
		},
		/** A new stream lost the old one's events: drop drafts and resync the page.
		 * Saves in flight stay Saving… until the controller settles them. */
		resetDraftEpoch(next: number) {
			if (disposed || next <= epoch) return;
			epoch = next;
			transactions.clear();
			held.clear();
			options.frame.resetDraftEpoch(epoch);
			if (selected) select();
		},
		feedback(feedback: RenderFeedback) {
			if (disposed) return;
			const failure = (feedback.failure ?? []).map((d) => d.message).join(" ");
			const previous = announcedFailure;
			announcedFailure = failure;
			if (failure && failure !== previous && options.translate) {
				const reference = { key: "renderFeedback.pageFailed", params: { message: failure } };
				options.announce?.(
					options.translate(reference.key, reference.params),
					reference,
					(delivered) => {
						if (!delivered && announcedFailure === failure) announcedFailure = "";
					},
				);
			}
		},
		/** Submit complete node source, including its authored closer, before the durable request.
		 * A preview refusal paints nothing and leaves the save to `settle`. */
		async renderDraft(
			request: DraftRequest,
			render: (
				request: DraftRequest & { pageId: string },
			) => Promise<{ ok: boolean; render?: PreviewDraftRender }>,
		) {
			const requestEpoch = epoch;
			previewing.set(request.transactionId, undefined);
			transactions.add(request.transactionId);
			saving.set(request.transactionId, request.nodeId);
			options.frame.beginDraft({
				seq: request.seq,
				epoch,
				transactionId: request.transactionId,
				nodeIds: [request.nodeId],
			});
			status();
			const hold = () => {
				const settled = previewing.get(request.transactionId);
				previewing.delete(request.transactionId);
				if (disposed || requestEpoch !== epoch) return;
				transactions.delete(request.transactionId);
				if (settled !== undefined) release(request.transactionId, request.seq, settled);
				else if (saving.has(request.transactionId)) held.set(request.transactionId, request.seq);
			};
			try {
				const result = await render({ ...request, pageId: options.pageId });
				if (!result.render) hold();
				else {
					previewing.delete(request.transactionId);
					if (!disposed && requestEpoch === epoch) options.frame.draft(result.render, epoch);
				}
				return result;
			} catch (error) {
				hold();
				throw error;
			}
		},
		/** The durable result for a transaction begun by `renderDraft`. The scheduler's own
		 * acknowledgement repaints accepted drafts; this releases preview-refused ones.
		 * Left for U7, which wires the draft controller: settles that arrive out of order for
		 * one node, and a refused node that an outside edit deletes (it stays refused). */
		settle(transactionId: string, ok: boolean) {
			const nodeId = saving.get(transactionId);
			if (disposed || nodeId === undefined) return;
			saving.delete(transactionId);
			if (ok) refused.delete(nodeId);
			else refused.add(nodeId);
			const seq = held.get(transactionId);
			held.delete(transactionId);
			if (seq !== undefined) release(transactionId, seq, ok);
			else if (previewing.has(transactionId)) previewing.set(transactionId, ok);
			status();
		},
		/** The author discarded this node's draft, so its refusal no longer applies. */
		revert(nodeId: string) {
			if (disposed || !refused.delete(nodeId)) return;
			status();
		},
		dispose() {
			disposed = true;
			transactions.clear();
			saving.clear();
			refused.clear();
			held.clear();
			previewing.clear();
			unsubscribe();
		},
	};
}
