import { createHash } from "node:crypto";
import {
	type CompiledPage,
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
import type {
	PreviewCompileDiagnostic,
	PreviewHtmlFragment,
	PreviewNodeRender,
	PreviewPatch,
	PreviewRenderEvent,
} from "@praxity/shared-blocks/course-preview-protocol";
import { imageFloatRegions } from "@praxity/shared-blocks/image-float";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";

import { previewDiagnostics } from "./preview-diagnostics";

function wireFragment({ id, html, island }: PreviewHtmlFragment): PreviewHtmlFragment {
	return { id, html, ...(island ? { island } : {}) };
}

export type PreviewSchedulerEvent = PreviewRenderEvent;
function pageKey(context: CourseContext, pageId: string): string {
	return JSON.stringify([
		context.pages.find((page) => page.id === pageId)?.renderDigest,
		getPageDependencies(context, pageId, "fragments"),
		getPageDependencies(context, pageId, "page-frame"),
		getPageDependencies(context, pageId, "shell"),
	]);
}

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
	private admittedSeq = 0;
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
				const sent = this.sent.get(page.id) ?? new Map();
				for (const fragment of fragments) sent.set(fragment.id, fragment);
				this.sent.set(page.id, sent);
				this.publish({ type: "nodesRendered", render: structuredClone(render) });
			} catch (error) {
				this.publishFailure(seq, page.id, error);
			}
		}
		this.timings.renderMs = performance.now() - start;
		return structuredClone(
			renders.find((render) => render.pageId === this.visiblePageId) ?? renders[0],
		);
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
		if (!present.has(this.visiblePageId)) this.visiblePageId = next.pages[0]?.id ?? "";
		const invalidated = next.pages
			.filter((page) => {
				const old = previous.pages.find((candidate) => candidate.id === page.id);
				if (!old) return true;
				return pageKey(previous, page.id) !== pageKey(next, page.id) || this.failures.has(page.id);
			})
			.map((page) => page.id);
		this.failures.clear();
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
		this.closed = true;
		this.cancelWake?.();
	}

	private request(pageIds: string[], seq: number): void {
		this.queue.request({ seq, pageIds, visiblePageId: this.visiblePageId });
		this.wake();
	}
	private wake(): void {
		this.cancelWake?.();
		this.cancelWake = undefined;
		if (this.closed) return;
		const readyAt = this.queue.readyAt();
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
