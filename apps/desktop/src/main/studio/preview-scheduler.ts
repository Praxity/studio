import { createHash } from "node:crypto";
import {
	type CompiledPage,
	type CompileJob,
	CompileQueue,
	type CourseContext,
	type CourseContextChanges,
	type CourseContextInput,
	compileDocumentFrame,
	compilePage,
	createCourseContext,
	getPageDependencies,
	refreshCourseContext,
	renderNode,
} from "@praxity/export-pipeline";
import {
	assertCoursePracticeAdmission,
	CoursePracticeAdmissionError,
	lessonPageBodyBlocks,
	readLesson,
} from "@praxity/grammar";
import type { OperationSourceFile } from "@praxity/operations";
import { draftRange } from "@praxity/operations/src/ranges.ts";
import type {
	PreviewCompileDiagnostic,
	PreviewDraftRender,
	PreviewHtmlFragment,
	PreviewNodeRender,
	PreviewPatch,
	PreviewRenderEvent,
} from "@praxity/shared-blocks/course-preview-protocol";
import { imageFloatRegions } from "@praxity/shared-blocks/image-float";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import type {
	PreviewRenderDraftRequest,
	PreviewRenderDraftResult,
} from "../../shared/editor-session";
import { planReadIdentity, type ResolvedCourseIdentity } from "../identity-store";

import { previewDiagnostics } from "./preview-diagnostics";

function wireFragment({ id, html, island }: PreviewHtmlFragment): PreviewHtmlFragment {
	return { id, html, ...(island ? { island } : {}) };
}

export type PreviewSchedulerEvent = PreviewRenderEvent;
export interface PreviewDraftIdentity {
	admission: ResolvedCourseIdentity;
	files: readonly OperationSourceFile[];
}

function pageKey(context: CourseContext, pageId: string): string {
	return JSON.stringify([
		context.pages.find((page) => page.id === pageId)?.renderDigest,
		getPageDependencies(context, pageId, "fragments"),
		getPageDependencies(context, pageId, "page-frame"),
		getPageDependencies(context, pageId, "shell"),
	]);
}

/** Session compiler. Admitted inputs enter here; filesystem and revision ownership
 * remain in the host and operation service. One job yields one event-loop turn. */
export class PreviewScheduler {
	private readonly queue: CompileQueue;
	private visiblePageId: string;
	private closed = false;
	private cancelWake?: () => void;
	private readonly failures = new Map<
		string,
		{ seq: number; diagnostics: PreviewCompileDiagnostic[] }
	>();
	private readonly good = new Map<string, CompiledPage>();
	private readonly sent = new Map<string, Map<string, { html: string; island?: string }>>();
	private readonly frames = new Map<string, ReturnType<typeof compileDocumentFrame>>();
	private readonly now: () => number;
	private readonly drafts = new Map<
		string,
		{
			render: PreviewDraftRender;
			saved?: PreviewHtmlFragment;
			confirmed?: PreviewHtmlFragment;
		}
	>();
	private readonly draftSequences = new Map<string, number>();
	private readonly suppressedPages = new Map<string, CompileJob>();
	private pendingRefresh?: { seq: number; work: () => Promise<void> };
	private refreshing = false;
	private admittedSeq = 0;
	private queuedSeq = 0;
	private refreshDone?: Promise<void>;
	private readonly timings = { contextMs: 0, renderMs: 0, compileMs: 0 };
	constructor(
		private current: CourseContext,
		private readonly publish: (event: PreviewSchedulerEvent) => void,
		private readonly options: {
			now?: () => number;
			compile?: (context: CourseContext, pageId: string) => CompiledPage | Promise<CompiledPage>;
			runJob?: (job: () => void) => void;
		} = {},
	) {
		this.now = options.now ?? Date.now;
		this.queue = new CompileQueue(this.now);
		this.visiblePageId = current.pages[0]?.id ?? "";
		this.admittedSeq = current.seq;
		this.queuedSeq = current.seq;
	}

	static async create(
		input: CourseContextInput,
		publish: (event: PreviewSchedulerEvent) => void,
		options: ConstructorParameters<typeof PreviewScheduler>[2] = {},
	) {
		return new PreviewScheduler(await createCourseContext(input), publish, options);
	}
	context(): CourseContext {
		return this.current;
	}
	stats() {
		return { ...this.queue.stats(), timings: { ...this.timings }, contextSeq: this.current.seq };
	}
	lastGood(pageId: string): CompiledPage | undefined {
		return this.good.get(pageId);
	}

	renderDraft(
		request: PreviewRenderDraftRequest,
		/** Null means the latest admission removed this page; undefined uses context facts. */
		savedPage?: PraxityPage | null,
		admitted?: PreviewDraftIdentity,
	): PreviewRenderDraftResult & { diagnostics?: PreviewCompileDiagnostic[] } {
		const refused = (
			code: "stale" | "orphaned" | "invalid-args" | "not-allowed",
			diagnostics?: PreviewCompileDiagnostic[],
		): PreviewRenderDraftResult & { diagnostics?: PreviewCompileDiagnostic[] } => ({
			ok: false,
			transactionId: request.transactionId,
			code,
			message: { key: `op.${code}`, params: {} },
			...(diagnostics ? { diagnostics } : {}),
		});
		if (this.closed) return refused("not-allowed");
		const previousSeq = this.draftSequences.get(request.pageId);
		if (
			(previousSeq !== undefined && request.seq <= previousSeq) ||
			this.drafts.has(request.transactionId)
		)
			return refused("stale");
		const page =
			savedPage === null
				? undefined
				: (savedPage ?? this.current.pages.find((page) => page.id === request.pageId));
		const node = page?.blocks.find((block) => block.id === request.nodeId);
		if (!page || !node) return refused("orphaned");
		// Grammar requires a page boundary. It belongs only to this in-memory
		// parse; a draft introducing another boundary is an escaping edit.
		const parsed = readLesson(`# Draft\n\n${request.source}`);
		const mapping = admitted?.admission.identity.sourceMappings.find(
			(mapping) => mapping.id === request.nodeId,
		);
		const file = admitted?.files.find((file) => file.path === mapping?.file);
		if (admitted && (!mapping || !file)) return refused("orphaned");
		const lessons = new Map(admitted?.admission.lessons);
		// Replace the entire source node, retaining sibling pages and real file
		// coordinates. A field without a trailing newline must not swallow its sibling.
		const replacement = /[\r\n]$/.test(request.source) ? request.source : `${request.source}\n`;
		lessons.set(
			file?.path ?? "draft",
			file && mapping
				? readLesson(
						file.source.slice(0, mapping.span.start) +
							replacement +
							file.source.slice(mapping.span.end),
					)
				: parsed,
		);
		try {
			assertCoursePracticeAdmission([...lessons].map(([path, read]) => ({ path, read })));
		} catch (error) {
			if (!(error instanceof CoursePracticeAdmissionError)) throw error;
			return refused("invalid-args", previewDiagnostics(error));
		}
		const blocks = lessonPageBodyBlocks(parsed, parsed.pages[0]?.id ?? "");
		if (parsed.hasErrors || parsed.pages.length !== 1 || blocks.length !== 1)
			return refused("invalid-args");
		let block = blocks[0];
		if (!block) return refused("invalid-args");
		// Container drafts need the same child identities as editSource's durable plan.
		// Leaf and type-changing drafts keep P3a's small parse: a new container
		// has no previous child identities to retain. Neither path touches a file.
		if (admitted && node.type === block.type && parsed.nodes.get(block.id)?.node.children.length) {
			const draftNode = parsed.nodes.get(block.id)?.node;
			if (!draftNode) return refused("invalid-args");
			const range = draftRange(draftNode);
			const mapping = admitted.admission.identity.sourceMappings.find(
				(mapping) => mapping.id === request.nodeId,
			);
			const file = admitted.files.find((file) => file.path === mapping?.file);
			if (!mapping || !file) return refused("orphaned");
			const digest = (source: string) => createHash("sha256").update(source).digest("hex");
			const planned = planReadIdentity(
				admitted.admission,
				{
					transactionId: request.transactionId,
					operation: "editSource",
					files: [{ path: file.path, baseRevision: digest(file.source) }],
					targets: [
						{
							file: file.path,
							ref: {
								kind: "node",
								nodeId: mapping.id,
								path: mapping.path,
								fingerprint: mapping.fingerprint,
							},
							expectedText: file.source.slice(mapping.span.start, mapping.span.end),
						},
					],
					args: { text: parsed.tree.stream.source.slice(range.start, range.end) },
				},
				true,
			);
			if (!planned.ok) return refused("not-allowed");
			const projected = planned.lessons
				.get(file.path)
				?.blocks.find((block) => block.id === request.nodeId);
			if (!projected) return refused("not-allowed");
			block = projected;
		}
		let saved: PreviewHtmlFragment;
		let fragment: PreviewHtmlFragment;
		try {
			saved = wireFragment(
				renderNode(this.current, request.pageId, request.nodeId, node, savedPage?.blocks),
			);
			fragment = wireFragment(
				renderNode(
					this.current,
					request.pageId,
					request.nodeId,
					{ ...block, id: request.nodeId },
					savedPage?.blocks,
				),
			);
		} catch {
			// Layout regions have no standalone node fragment. The durable path
			// and whole-page compile still handle them.
			return refused("not-allowed");
		}
		const render: PreviewDraftRender = {
			seq: request.seq,
			pageId: request.pageId,
			transactionId: request.transactionId,
			state: "draft",
			fragments: [fragment],
		};
		this.draftSequences.set(request.pageId, request.seq);
		this.drafts.set(request.transactionId, { render, saved });
		this.publish({ type: "draftRendered", render: structuredClone(render) });
		return { ok: true, render: structuredClone(render) };
	}

	settleDraft(transactionId: string, committed: boolean): void {
		const draft = this.drafts.get(transactionId);
		if (!draft) return;
		this.drafts.delete(transactionId);
		const fragment = committed ? draft.confirmed : draft.saved;
		const render: PreviewDraftRender = {
			...draft.render,
			state: committed ? "saved" : "reverted",
			fragments: fragment ? [fragment] : [],
		};
		this.publish({ type: "draftRendered", render: structuredClone(render) });
		const pageId = render.pageId;
		const suppressed = this.suppressedPages.get(pageId);
		if (suppressed && !this.hasPendingDraft(pageId)) {
			this.suppressedPages.delete(pageId);
			this.queue.retry(suppressed);
			this.wake();
		}
	}

	/** End the current renderer's drafts before reusing its per-page sequences. */
	endDraftSubscription(): void {
		for (const transactionId of this.drafts.keys()) this.settleDraft(transactionId, false);
		this.draftSequences.clear();
		this.sent.clear();
	}

	private hasPendingDraft(pageId: string): boolean {
		return [...this.drafts.values()].some((draft) => draft.render.pageId === pageId);
	}

	/** Render changed nodes from admitted page facts. The queued refresh corrects
	 * course dependencies, layout and document regions after the acknowledgement. */
	renderCommitted(
		seq: number,
		previous: readonly PraxityPage[],
		pages: readonly PraxityPage[],
	): PreviewNodeRender | undefined {
		this.admittedSeq = Math.max(this.admittedSeq, seq);
		for (const draft of this.drafts.values())
			if (previous.some((page) => page.id === draft.render.pageId)) draft.confirmed = undefined;
		return this.renderSmallEdit(seq, previous, pages, (page, block) =>
			renderNode(this.current, page.id, block.id, block, page.blocks),
		);
	}

	private renderSmallEdit(
		seq: number,
		previous: readonly PraxityPage[],
		pages: readonly PraxityPage[],
		renderFragment: (page: PraxityPage, block: PraxityBlock) => ReturnType<typeof renderNode>,
	): PreviewNodeRender | undefined {
		const touched = pages.flatMap((page) =>
			imageFloatRegions(page.blocks)
				.flatMap((region) => region.blocks)
				.filter(
					(block) =>
						JSON.stringify(block) !==
						JSON.stringify(
							previous.find((old) => old.id === page.id)?.blocks.find((old) => old.id === block.id),
						),
				)
				.map((block) => ({ page, block })),
		);
		const removed = previous
			.flatMap((page) => page.blocks)
			.filter(
				(block) => !pages.some((page) => page.blocks.some((next) => next.id === block.id)),
			).length;
		if (!touched.length || touched.length + removed > 8) return undefined;
		const renders: PreviewNodeRender[] = [];
		const start = performance.now();
		for (const page of pages) {
			const nodes = touched.filter((node) => node.page.id === page.id);
			if (!nodes.length || !this.current.pages.some((current) => current.id === page.id)) continue;
			try {
				const fragments = nodes.map(({ block }) => wireFragment(renderFragment(page, block)));
				const render = { seq, pageId: page.id, fragments };
				renders.push(render);
				for (const draft of this.drafts.values()) {
					if (draft.render.pageId !== page.id) continue;
					const saved = fragments.find((fragment) => fragment.id === draft.render.fragments[0]?.id);
					if (saved) {
						draft.saved = saved;
						draft.confirmed = saved;
					}
				}
				if (!this.hasPendingDraft(page.id)) {
					const sent = this.sent.get(page.id) ?? new Map();
					for (const fragment of fragments) sent.set(fragment.id, fragment);
					this.sent.set(page.id, sent);
					this.publish({ type: "nodesRendered", render: structuredClone(render) });
				}
				// A suppressed event's RPC response may belong to an obsolete renderer.
				// Keep its fragments eligible for the current subscription's page patch.
			} catch (error) {
				this.publishFailure(seq, page.id, error);
			}
		}
		this.timings.renderMs = performance.now() - start;
		return structuredClone(
			renders.find((render) => render.pageId === this.visiblePageId) ?? renders[0],
		);
	}

	/** Queue full input/context preparation with page compilation. A newer complete
	 * admitted input replaces any refresh that has not started. */
	enqueueRefresh(seq: number, work: () => Promise<void>): void {
		if (this.closed || seq <= Math.max(this.queuedSeq, this.current.seq)) return;
		this.queuedSeq = seq;
		this.admittedSeq = Math.max(this.admittedSeq, seq);
		this.pendingRefresh = { seq, work };
		this.wake();
	}

	async drained(): Promise<void> {
		await this.refreshDone;
	}

	selectPage(pageId: string): void {
		if (!this.current.pages.some((page) => page.id === pageId))
			throw new Error("Unknown preview page.");
		this.visiblePageId = pageId;
		const cached = this.good.get(pageId);
		const failure = this.failures.get(pageId);
		if (
			cached &&
			(cached.seq === this.current.seq || failure) &&
			!this.hasPendingDraft(pageId) &&
			(failure || cached.seq >= this.admittedSeq)
		) {
			this.sent.set(pageId, new Map(cached.fragments));
			this.publish({
				type: "pageCompiled",
				patch: {
					seq: cached.seq,
					pageId,
					order: [...cached.order],
					fragments: [...cached.fragments.values()].map(wireFragment),
					shellStale: false,
				},
				documentRegions: [...(this.frames.get(cached.documentSlug)?.regions.values() ?? [])].map(
					wireFragment,
				),
			});
			if (failure) this.publish({ type: "compileFailed", pageId, ...structuredClone(failure) });
			return;
		}
		if (failure) {
			this.publish({ type: "compileFailed", pageId, ...structuredClone(failure) });
			return;
		}
		// `sent` tracks a page, not a frame: a newly selected frame may lack what an earlier one received.
		this.sent.delete(pageId);
		this.request([pageId], this.current.seq);
	}

	async refresh(
		input: CourseContextInput,
		changed: CourseContextChanges,
		optimistic: boolean,
	): Promise<PreviewNodeRender | undefined> {
		const previous = this.current;
		const measuredAt = performance.now();
		const next = await refreshCourseContext(previous, input, changed);
		this.timings.contextMs = performance.now() - measuredAt;
		if (this.closed || next.seq < this.admittedSeq) return undefined;
		this.current = next;
		this.admittedSeq = Math.max(this.admittedSeq, next.seq);
		const pageIds = next.pages.map((page) => page.id);
		// A patched page cannot follow a changed page list; its frame needs a new document.
		if (JSON.stringify(pageIds) !== JSON.stringify(previous.pages.map((page) => page.id)))
			this.publish({ type: "pagesChanged", pageIds });
		const present = new Set(pageIds);
		this.queue.retainPages([...present]);
		for (const id of this.good.keys())
			if (!present.has(id)) {
				this.good.delete(id);
				this.sent.delete(id);
			}
		this.pruneFrames();
		for (const id of this.suppressedPages.keys())
			if (!present.has(id)) this.suppressedPages.delete(id);
		for (const draft of this.drafts.values()) {
			const page = next.pages.find((page) => page.id === draft.render.pageId);
			const node =
				page &&
				imageFloatRegions(page.blocks)
					.flatMap((region) => region.blocks)
					.find((block) => block.id === draft.render.fragments[0]?.id);
			draft.saved = node ? wireFragment(renderNode(next, draft.render.pageId, node.id)) : undefined;
		}
		if (!present.has(this.visiblePageId)) this.visiblePageId = next.pages[0]?.id ?? "";
		const invalidated = next.pages
			.filter((page) => {
				const old = previous.pages.find((candidate) => candidate.id === page.id);
				if (!old) return true;
				return pageKey(previous, page.id) !== pageKey(next, page.id) || this.failures.has(page.id);
			})
			.map((page) => page.id);
		this.failures.clear();
		// Fence running work before sending an optimistic fragment for the new seq.
		this.request(
			optimistic || !invalidated.length
				? invalidated
				: [...new Set([...invalidated, this.visiblePageId].filter(Boolean))],
			next.seq,
		);
		if (!optimistic) return undefined;
		return this.renderSmallEdit(next.seq, previous.pages, next.pages, (page, block) =>
			renderNode(next, page.id, block.id),
		);
	}

	fail(
		seq: number,
		diagnostics: PreviewCompileDiagnostic[],
		pageIds = [...new Set([...this.current.pages.map((page) => page.id), ...this.failures.keys()])],
	): void {
		if (seq < this.admittedSeq || this.closed) return;
		this.admittedSeq = seq;
		this.request(pageIds, seq);
		for (const pageId of pageIds) {
			this.failures.set(pageId, { seq, diagnostics: structuredClone(diagnostics) });
			this.publish({
				type: "compileFailed",
				seq,
				pageId,
				diagnostics: structuredClone(diagnostics),
			});
		}
	}
	replayFailures(listener: (event: PreviewSchedulerEvent) => void): void {
		for (const [pageId, failure] of this.failures)
			listener({ type: "compileFailed", pageId, ...structuredClone(failure) });
	}

	close(): void {
		this.endDraftSubscription();
		this.closed = true;
		this.cancelWake?.();
		this.pendingRefresh = undefined;
		this.drafts.clear();
		this.draftSequences.clear();
		this.suppressedPages.clear();
	}

	private request(pageIds: string[], seq: number): void {
		this.queue.request({ seq, pageIds, visiblePageId: this.visiblePageId });
		this.wake();
	}
	private wake(): void {
		this.cancelWake?.();
		this.cancelWake = undefined;
		if (this.closed || this.refreshing) return;
		const readyAt = this.pendingRefresh ? this.now() : this.queue.readyAt();
		if (readyAt === null) return;
		const run = () => {
			this.cancelWake = undefined;
			const job = () => {
				void this.run();
			};
			if (this.options.runJob) this.options.runJob(job);
			else job();
		};
		const delay = readyAt - this.now();
		if (delay <= 0) {
			const handle = setImmediate(run);
			this.cancelWake = () => clearImmediate(handle);
		} else {
			const handle = setTimeout(run, delay);
			this.cancelWake = () => clearTimeout(handle);
		}
	}
	private async run(): Promise<void> {
		if (this.pendingRefresh) {
			const refresh = this.pendingRefresh;
			this.pendingRefresh = undefined;
			this.refreshing = true;
			this.refreshDone = (async () => {
				try {
					await refresh.work();
				} catch (error) {
					if (!this.closed && refresh.seq >= this.admittedSeq)
						this.fail(refresh.seq, previewDiagnostics(error));
				} finally {
					this.refreshing = false;
					this.wake();
				}
			})();
			await this.refreshDone;
			return;
		}
		const job = this.queue.next();
		if (!job) {
			this.wake();
			return;
		}
		const context = this.current;
		try {
			const compileAt = performance.now();
			let result: CompiledPage | undefined;
			let frame: ReturnType<typeof compileDocumentFrame> | undefined;
			try {
				result = this.failures.has(job.pageId)
					? undefined
					: await (this.options.compile ?? compilePage)(context, job.pageId);
				frame = result ? compileDocumentFrame(context, result.documentSlug) : undefined;
			} catch (error) {
				if (this.queue.complete(job, true) && !this.closed)
					this.publishFailure(job.seq, job.pageId, error);
				return;
			}
			this.timings.compileMs = performance.now() - compileAt;
			const accepted = this.queue.complete(job, { result, frame });
			if (!accepted?.result || !accepted.frame || this.closed || context.seq < this.admittedSeq)
				return;
			if (this.hasPendingDraft(job.pageId)) {
				this.suppressedPages.set(job.pageId, job);
				return;
			}
			const page = accepted.result;
			const previousFrame =
				this.frames.get(page.documentSlug) ??
				this.frames.get(this.good.get(page.pageId)?.documentSlug ?? "");
			const shellStale =
				previousFrame !== undefined && previousFrame.shellDigest !== accepted.frame.shellDigest;
			const documentRegions = [...accepted.frame.regions.values()]
				.filter((fragment) => previousFrame?.regions.get(fragment.id)?.html !== fragment.html)
				.map(wireFragment);
			this.frames.set(page.documentSlug, accepted.frame);
			const sent = this.sent.get(page.pageId) ?? new Map();
			const fragments = [...page.fragments.values()].filter((fragment) => {
				const old = sent.get(fragment.id);
				return old?.html !== fragment.html || old?.island !== fragment.island;
			});
			this.sent.set(page.pageId, new Map(page.fragments));
			this.good.set(page.pageId, page);
			this.pruneFrames();
			this.publish({
				type: "pageCompiled",
				patch: {
					seq: page.seq,
					pageId: page.pageId,
					order: [...page.order],
					fragments: fragments.map(wireFragment),
					shellStale,
				},
				documentRegions,
			});
		} finally {
			this.wake();
		}
	}
	private publishFailure(seq: number, pageId: string, error: unknown): void {
		const diagnostics = previewDiagnostics(error);
		this.failures.set(pageId, { seq, diagnostics });
		this.publish({
			type: "compileFailed",
			seq,
			pageId,
			diagnostics: structuredClone(diagnostics),
		});
	}

	private pruneFrames(): void {
		const retained = new Set([
			...this.current.documents.map((document) => document.slug),
			...[...this.good.values()].map((page) => page.documentSlug),
		]);
		for (const slug of this.frames.keys()) if (!retained.has(slug)) this.frames.delete(slug);
	}
}
