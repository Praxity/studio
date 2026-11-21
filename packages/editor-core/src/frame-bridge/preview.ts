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

export function connectRenderPreview(options: {
	pageId: string;
	frame: ReturnType<typeof connectPageFrame>;
	subscribe: (receive: (event: PreviewRenderEvent) => void) => () => void;
	selectPage: (pageId: string) => Promise<unknown>;
	onError: (error: unknown) => void;
	onShellStale?: () => void;
	onPagesChanged?: () => void;
	status?: HTMLElement;
	translate?: (key: string, values?: Record<string, string>) => string;
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
	const saving = new Map<string, string>();
	const refused = new Set<string>();
	const held = new Map<string, number>();
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
			if (save !== shownSave && save !== "saving")
				options.announce?.(text, { key: `renderFeedback.${save}`, params: {} });
		}
		shownSave = save;
	}
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
		select(resync = false) {
			if (disposed || (selected && !resync)) return;
			selected = true;
			select();
		},
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
