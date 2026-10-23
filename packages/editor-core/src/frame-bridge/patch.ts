import type {
	PreviewCompileDiagnostic,
	PreviewDraftRender,
	PreviewHtmlFragment,
	PreviewNodeRender,
	PreviewPatch,
} from "@praxity/shared-blocks/course-preview-protocol";
import type { mountPageLens } from "./page-lens";

/** Paint feedback only. Save state is the controller's durable result (see preview.ts). */
export interface RenderFeedback {
	nodes: Record<string, { state: "updating" } | { state: "failed"; message: string }>;
	failure: PreviewCompileDiagnostic[] | null;
}
export interface DraftGesture {
	seq: number;
	epoch: number;
	transactionId: string;
	nodeIds: string[];
}

/** Draft sequences belong to a subscription epoch, durable sequences to individual fragments. */
export function createFramePatcher(options: {
	document: Document;
	pageId: string;
	lens: ReturnType<typeof mountPageLens>;
	onFeedback?: (feedback: RenderFeedback) => void;
}) {
	const { lens } = options;
	let disposed = false;
	let epoch = 0;
	let draftSeq = -1;
	let layoutSeq = -1;
	let failureSeq = -1;
	const revisions = new Map<string, number>();
	const drafts = new Map<
		string,
		DraftGesture & { painted: boolean; fragments: PreviewHtmlFragment[] }
	>();
	const settlements = new Map<string, PreviewHtmlFragment>();
	const latestDraft = new Map<string, string>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const feedback: RenderFeedback = { nodes: {}, failure: null };
	let deferred: (() => void)[] = [];
	const snapshot = () => structuredClone(feedback);
	const pending = (id: string) => [...drafts.values()].some((draft) => draft.nodeIds.includes(id));
	function changed() {
		if (!disposed) {
			lens.renderFeedback(feedback);
			options.onFeedback?.(snapshot());
		}
	}
	function clearUpdating(id: string) {
		clearTimeout(timers.get(id));
		timers.delete(id);
		delete feedback.nodes[id];
	}
	function replace(fragment: PreviewHtmlFragment): boolean {
		return lens.replaceFragment(fragment);
	}
	function fragments(render: PreviewNodeRender, refresh = true) {
		const missing: string[] = [];
		for (const fragment of render.fragments) {
			if (render.seq <= (revisions.get(fragment.id) ?? -1)) continue;
			if (!replace(fragment)) missing.push(fragment.id);
			else revisions.set(fragment.id, render.seq);
		}
		if (refresh) lens.refresh();
		return missing;
	}
	function drain() {
		if (drafts.size || disposed) return;
		const tasks = deferred;
		deferred = [];
		if (!tasks.length) {
			settlements.clear();
			return;
		}
		for (const task of tasks) task();
		if (tasks.length) for (const fragment of settlements.values()) replace(fragment);
		settlements.clear();
		lens.refresh();
	}
	const api = {
		feedback: snapshot,
		resetDraftEpoch(next: number) {
			if (next <= epoch || disposed) return;
			epoch = next;
			draftSeq = -1;
			// The resynced page replaces painted drafts, even at a revision already applied.
			for (const draft of drafts.values())
				if (draft.painted) for (const id of draft.nodeIds) revisions.delete(id);
			drafts.clear();
			settlements.clear();
			latestDraft.clear();
			for (const id of timers.keys()) clearUpdating(id);
			drain();
			changed();
		},
		beginDraft(request: DraftGesture) {
			if (disposed || request.epoch !== epoch || request.seq <= draftSeq) return;
			draftSeq = request.seq;
			drafts.set(request.transactionId, {
				...structuredClone(request),
				painted: false,
				fragments: [],
			});
			for (const id of request.nodeIds) {
				settlements.delete(id);
				latestDraft.set(id, request.transactionId);
				clearUpdating(id);
				timers.set(
					id,
					setTimeout(() => {
						timers.delete(id);
						feedback.nodes[id] = { state: "updating" };
						changed();
					}, 400),
				);
			}
			changed();
		},
		draft(render: PreviewDraftRender, renderEpoch: number) {
			const draft = drafts.get(render.transactionId);
			if (
				disposed ||
				render.pageId !== options.pageId ||
				renderEpoch !== epoch ||
				!draft ||
				render.seq !== draft.seq
			)
				return [];
			if (render.state === "draft" && draft.painted) return [];
			const missing: string[] = [];
			for (const fragment of render.fragments) {
				if (
					!draft.nodeIds.includes(fragment.id) ||
					latestDraft.get(fragment.id) !== render.transactionId
				)
					continue;
				if (!replace(fragment)) missing.push(fragment.id);
			}
			draft.painted = true;
			if (render.state === "draft") draft.fragments = structuredClone(render.fragments);
			if (render.state !== "draft") {
				const confirmed = render.fragments.length
					? render.fragments
					: render.state === "saved"
						? draft.fragments
						: [];
				for (const fragment of confirmed)
					if (latestDraft.get(fragment.id) === render.transactionId)
						settlements.set(fragment.id, fragment);
				drafts.delete(render.transactionId);
				for (const id of draft.nodeIds)
					if (!pending(id)) {
						latestDraft.delete(id);
						if (render.state === "reverted") clearUpdating(id);
					}
			}
			lens.refresh();
			drain();
			changed();
			return missing;
		},
		nodes(render: PreviewNodeRender) {
			if (disposed || render.pageId !== options.pageId) return [];
			const held = render.fragments.filter((fragment) => pending(fragment.id));
			if (held.length) deferred.push(() => api.nodes({ ...render, fragments: held }));
			return fragments({
				...render,
				fragments: render.fragments.filter((fragment) => !pending(fragment.id)),
			});
		},
		patch(patch: PreviewPatch, documentRegions: PreviewHtmlFragment[] = []) {
			if (disposed || patch.pageId !== options.pageId || patch.seq < layoutSeq) return [];
			if (drafts.size) {
				deferred.push(() => api.patch(patch, documentRegions));
				return [];
			}
			layoutSeq = patch.seq;
			const missing = lens.orderFragments(patch.order, patch.fragments, new Set());
			missing.push(
				...fragments(
					{
						...patch,
						fragments: [
							...patch.fragments.filter((f) => !f.id.startsWith("region:")),
							...documentRegions,
						],
					},
					false,
				),
			);
			const wanted = new Set(patch.order);
			for (const id of revisions.keys())
				if (!wanted.has(id) && !id.startsWith("region:")) revisions.delete(id);
			if (patch.seq >= failureSeq) {
				feedback.failure = null;
				for (const id of new Set([...timers.keys(), ...Object.keys(feedback.nodes)]))
					clearUpdating(id);
			}
			lens.refresh();
			changed();
			return [...new Set(missing)];
		},
		failed(failure: { seq: number; pageId: string; diagnostics: PreviewCompileDiagnostic[] }) {
			if (
				disposed ||
				failure.pageId !== options.pageId ||
				failure.seq < Math.max(layoutSeq, failureSeq)
			)
				return;
			if (drafts.size) {
				deferred.push(() => api.failed(failure));
				return;
			}
			failureSeq = failure.seq;
			const ids = new Set([...timers.keys(), ...revisions.keys()]);
			for (const id of timers.keys()) clearUpdating(id);
			feedback.failure = structuredClone(failure.diagnostics);
			const message = failure.diagnostics.map((d) => d.message).join(" ");
			for (const id of ids) feedback.nodes[id] = { state: "failed", message };
			changed();
		},
		dispose() {
			disposed = true;
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
			drafts.clear();
			latestDraft.clear();
			settlements.clear();
			revisions.clear();
			deferred = [];
		},
	};
	return api;
}
