import { createHash } from "node:crypto";
import { compileBlockStatePolicy } from "@praxity/shared-blocks/block-state-policy";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { prepareInlineBlocks } from "@praxity/shared-blocks/inline-markdown";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import {
	availableIslandNames,
	type HtmlFragment,
	type PreparedHtmlCourse,
	prepareHtmlCourse,
	renderHtmlDocument,
	renderPageFragments,
} from "../html-gen.ts";
import { PracticeAdmissionError } from "../practice-admission";
import { planPageRuntime } from "../runtime-plan.ts";
import { bindSelfCheckAssets, bindSelfCheckDocument } from "../self-check.ts";
import { cloneAdmittedSelfCheckData, constructSelfCheckPromptData } from "../self-check-prompt.ts";
import { admitWriteDistractorsRuntime, bindWriteDistractorsAssets } from "../write-distractors.ts";
import { type CourseContext, getPageDependencies, type SliceKey } from "./course-context.ts";

export type Fragment = HtmlFragment;
export interface CompiledPage {
	pageId: string;
	documentSlug: string;
	seq: number;
	order: string[];
	fragments: Map<string, Fragment>;
	deps: Partial<Record<SliceKey, string>>;
	html: string;
}

const renderContexts = new WeakMap<CourseContext, PreparedHtmlCourse>();
const contextPages = new WeakMap<CourseContext, Map<string, CompiledPage>>();
const pageCaches = new WeakMap<object, Map<string, CompiledPage>>();
function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function preparePageCompiler(context: CourseContext): PreparedHtmlCourse {
	let prepared = renderContexts.get(context);
	if (!prepared && context.htmlRendering && context.renderingOutput === context.htmlOutput) {
		prepared = context.htmlRendering;
		renderContexts.set(context, prepared);
	}
	if (!prepared) {
		const course = context.normalizedCourse;
		prepared = prepareHtmlCourse(
			{
				...course,
				brandLogo: context.desktopBrandLogo,
				pages: [...context.pages],
				totalPages: context.pages.length,
			},
			context.htmlOutput
				? (context.htmlOutput.islandAssets ?? { loaderFilename: "", islandFilenames: {} })
				: undefined,
		);
		renderContexts.set(context, prepared);
	}
	const cache = pageCaches.get(context.compilerCache);
	if (cache) {
		const present = new Set(context.pages.map((page) => page.id));
		for (const [id, compiled] of cache)
			if (!present.has(id) && compiled.seq <= context.seq) cache.delete(id);
	}

	return prepared;
}
function pageEntry(context: CourseContext, pageId: string) {
	const page = context.pages.find((page) => page.id === pageId);
	if (!page) throw new Error(`Unknown course context page: ${pageId}`);
	return page;
}
function pageFacts(context: CourseContext, pageId: string) {
	const entry = pageEntry(context, pageId);
	const prepared = preparePageCompiler(context);
	const page = prepared.config.pages.find((page) => page.id === pageId);
	const runtime = prepared.pageRuntimePlans.get(pageId);
	if (!page || !runtime) throw new Error(`Missing render facts for page: ${pageId}`);
	return { entry, prepared, page, runtime };
}

export function compilePage(context: CourseContext, pageId: string): CompiledPage {
	const local = contextPages.get(context) ?? new Map<string, CompiledPage>();
	contextPages.set(context, local);
	const cached = local.get(pageId);
	if (cached) return cached;
	const { entry, prepared, page, runtime } = pageFacts(context, pageId);
	const deps = {
		...getPageDependencies(context, pageId, "fragments"),
		...getPageDependencies(context, pageId, "page-frame"),
		// The effective locale, frame navigation and module capability union also
		// affect node HTML. Another page can introduce an island in this document.
		manifest: digest({
			locale: page.locale ?? prepared.config.sourceLocale,
			moduleDeck: !!prepared.config.moduleDeck,
			navigation: prepared.config.navigationStyle,
			navToggles: prepared.config.navToggles,
			islands: runtime.islands,
			unresolved: page.blocks
				.map((block) => [block.id, context.unresolvedNodes?.get(block.id)])
				.filter(([, error]) => error !== undefined),
		}),
	};
	let cache = pageCaches.get(context.compilerCache);
	if (!cache) {
		cache = new Map();
		pageCaches.set(context.compilerCache, cache);
	}
	const previous = cache.get(pageId);
	if (previous && digest(previous.deps) === digest(deps)) {
		if (previous.seq === context.seq && previous.documentSlug === entry.documentSlug) {
			local.set(pageId, previous);
			return previous;
		}
		// Keep shared fragment bytes while binding the delivery to the latest seq.
		const next = { ...previous, seq: context.seq, documentSlug: entry.documentSlug };
		if (next.seq >= previous.seq) cache.set(pageId, next);
		local.set(pageId, next);
		return next;
	}
	const fragments = new Map<string, Fragment>();
	const order: string[] = [];
	for (const fragment of renderPageFragments(
		prepared.config,
		page,
		new Set(runtime.islands),
		undefined,
		context.unresolvedNodes,
	)) {
		if (!fragment.id || fragments.has(fragment.id))
			throw new Error(`Duplicate or empty page fragment identity: ${fragment.id}`);
		order.push(fragment.id);
		fragments.set(fragment.id, {
			...fragment,
			html: bindWriteDistractorsAssets(
				bindSelfCheckAssets(fragment.html, context.selfCheckRuntime, page.blocks),
				context.writeDistractorsRuntime,
				page.blocks,
			),
		});
	}
	const result = {
		pageId,
		documentSlug: entry.documentSlug,
		seq: context.seq,
		order,
		fragments,
		deps,
		html: order.map((id) => fragments.get(id)?.html).join("\n"),
	};
	if (!previous || result.seq >= previous.seq) cache.set(pageId, result);
	local.set(pageId, result);
	return result;
}

export function renderNode(
	context: CourseContext,
	pageId: string,
	nodeId: string,
	block?: PraxityBlock,
	/** Latest admitted siblings, when the whole context refresh is queued. */
	pageBlocks?: readonly PraxityBlock[],
): Fragment {
	if (block) block = cloneAdmittedSelfCheckData(block);
	if (pageBlocks) pageBlocks = cloneAdmittedSelfCheckData(pageBlocks);
	if (block || pageBlocks) {
		const admittedPages = context.pages.map((page) =>
			page.id !== pageId
				? page
				: {
						...page,
						blocks: (pageBlocks ?? page.blocks).map((candidate) =>
							candidate.id === nodeId && block ? block : candidate,
						),
					},
		);
		// Admit replacement prompts against their captured Content before rendering.
		admitWriteDistractorsRuntime(
			admittedPages,
			context.writeDistractorsRuntime,
			new Set(context.unresolvedNodes?.keys()),
		);
	}
	if (!block && !pageBlocks) {
		const cached = contextPages.get(context)?.get(pageId)?.fragments.get(nodeId);
		if (cached?.kind === "node") return cached;
	}
	const { prepared, page, runtime } = pageFacts(context, pageId);
	if (!(pageBlocks ?? page.blocks).some((block) => block.id === nodeId))
		throw new Error(`Unknown page node: ${nodeId}`);
	if (block && block.id !== nodeId)
		throw new Error("Draft node identity must match the substituted node.");
	const normalize = (blocks: PraxityBlock[]) =>
		prepareInlineBlocks(
			constructSelfCheckPromptData(
				adaptGrammarPreviewBlocks(
					blocks,
					context.normalizedCourse.componentDefaults,
					page.locale ?? prepared.config.sourceLocale,
				),
			),
		);
	const draft =
		block || pageBlocks
			? {
					...page,
					blocks: pageBlocks
						? normalize(
								pageBlocks.map((candidate) =>
									candidate.id === nodeId && block ? block : candidate,
								),
							)
						: page.blocks.flatMap((candidate) =>
								candidate.id === nodeId && block ? normalize([block]) : [candidate],
							),
				}
			: page;
	// A fragment cannot add a private store to a host admitted without that policy.
	const admittedPolicy = compileBlockStatePolicy(
		prepared.config.pages.flatMap((page) => page.blocks),
	);
	const draftPolicy = compileBlockStatePolicy(draft.blocks);
	for (const candidate of flattenLogicBlocks(draft.blocks))
		if (
			candidate.type === "assessment" &&
			candidate.data.assessmentType === "choice" &&
			draftPolicy[candidate.id] === "device" &&
			admittedPolicy[candidate.id] !== "device"
		)
			throw new PracticeAdmissionError(
				"private-choice-practice-only",
				candidate.id,
				"draft.blockStatePolicy",
				page.locale ?? prepared.config.sourceLocale,
			);
	// A draft may introduce an island. Plan the substituted page/module before
	// rendering; all layout, group, visibility and footnote facts use that draft.
	const available = context.htmlOutput
		? availableIslandNames(context.htmlOutput.islandAssets)
		: true;
	const draftPlan =
		block || pageBlocks ? planPageRuntime(prepared.config, draft, available) : runtime;
	// Existing module capabilities remain admitted; only the draft page can add
	// capabilities. Removed capabilities do not affect this node's HTML.
	const plan =
		(block || pageBlocks) && prepared.config.moduleDeck
			? {
					...runtime,
					islands: [
						...new Set([
							...runtime.islands,
							...draftPlan.islands.filter((island) => island !== "nav" && island !== "narration"),
						]),
					],
				}
			: draftPlan;
	const config =
		block || pageBlocks
			? {
					...prepared.config,
					pages: prepared.config.pages.map((candidate) =>
						candidate.id === page.id ? draft : candidate,
					),
				}
			: prepared.config;
	const fragment = renderPageFragments(
		config,
		draft,
		new Set(plan.islands),
		nodeId,
		block || pageBlocks ? undefined : context.unresolvedNodes,
		!!(block || pageBlocks),
	).find((fragment) => fragment.id === nodeId);
	if (!fragment) throw new Error(`Node is a page region rather than a renderable block: ${nodeId}`);
	return {
		...fragment,
		html: bindWriteDistractorsAssets(
			bindSelfCheckAssets(fragment.html, context.selfCheckRuntime, draft.blocks),
			context.writeDistractorsRuntime,
			draft.blocks,
		),
	};
}

export function compileDocument(
	context: CourseContext,
	slug: string,
): {
	html: string;
	shellDigest: string;
	pages: CompiledPage[];
	stylesheetsUsed: string[];
	regions: Map<string, Fragment>;
} {
	const document = context.documents.find((document) => document.slug === slug);
	if (!document) throw new Error(`Unknown course document: ${slug}`);
	const prepared = preparePageCompiler(context);
	const pages = document.pageIds.map((id) => compilePage(context, id));
	const contents = new Map(pages.map((page) => [page.pageId, page.html]));
	return { ...renderDocumentFrame(context, slug, prepared, contents), pages };
}

/** Shell and deck regions can change without compiling hidden page bodies. */
export function compileDocumentFrame(
	context: CourseContext,
	slug: string,
): {
	shellDigest: string;
	regions: Map<string, Fragment>;
} {
	const document = context.documents.find((document) => document.slug === slug);
	if (!document) throw new Error(`Unknown course document: ${slug}`);
	const frame = renderDocumentFrame(
		context,
		slug,
		preparePageCompiler(context),
		new Map(document.pageIds.map((id) => [id, ""])),
	);
	return { shellDigest: frame.shellDigest, regions: frame.regions };
}

function renderDocumentFrame(
	context: CourseContext,
	slug: string,
	prepared: PreparedHtmlCourse,
	contents: ReadonlyMap<string, string>,
) {
	const stylesheets = new Set<string>();
	const regions = new Map<string, Fragment>();
	const replacements: string[] = [];
	const marker = (html: string) => `\0praxity-fragment:${replacements.push(html) - 1}\0`;
	let shell = renderHtmlDocument(
		prepared,
		slug,
		context.htmlOutput ?? {},
		(page) => {
			const content = contents.get(page.id);
			if (content === undefined) throw new Error(`Missing compiled page content: ${page.id}`);
			return marker(content);
		},
		stylesheets,
		(fragment) => {
			regions.set(fragment.id, fragment);
			return marker(fragment.html);
		},
	);
	shell = bindSelfCheckDocument(shell, context.selfCheckRuntime, context.pages);
	const seen = new Set<number>();
	const html = shell.replace(/\0praxity-fragment:(\d+)\0/g, (_match, key: string) => {
		const index = Number(key);
		const replacement = replacements[index];
		if (replacement === undefined || seen.has(index))
			throw new Error("Ambiguous HTML fragment marker.");
		seen.add(index);
		return replacement;
	});
	if (seen.size !== replacements.length) throw new Error("Missing HTML fragment marker.");

	// The inert config JSON changes with every edit. In a patched inspection only the
	// inspection runtime's logic overlay reads it (course scripts don't run under its
	// nonce), so it is left out: a shell is stale only when its markup or head changes.
	const shellDigest = digest(
		shell.replace(/<script id="praxity-config" type="application\/json">[\s\S]*?<\/script>/, ""),
	);
	return { html, shellDigest, stylesheetsUsed: [...stylesheets], regions };
}
