import {
	applyKeyboardNavFloor,
	compileVisibleExpression,
	getNavPreset,
	getPageNavArchetype,
	inferNavStyleFromToggles,
	mergePageNavToggles,
	type NavArchetype,
	type NavToggleValues,
	pageHasNavOverrides,
	RETIRED_BLOCK_TYPES,
	toNavArchetype,
} from "@praxity/grammar";
import { navArchetypeSuppressesNav } from "@praxity/grammar/src/nav-archetype-layout.ts";
import { isEmbeddableHost } from "@praxity/shared-blocks/embed-url-utils";
import {
	isInlineProjectionMetadataKey,
	prepareInlineBlocks,
} from "@praxity/shared-blocks/inline-markdown";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import {
	type DependencyRule,
	selfCheckDependencies,
} from "@praxity/shared-blocks/logic/self-check-dependencies";
import { extractNarrationSegments, type NarrationSegment } from "@praxity/shared-blocks/narration";
import {
	groupBlocksIntoSections,
	type SectionRhythm,
} from "@praxity/shared-blocks/section-grouping";
import {
	isLiteralTextBlockType,
	type PraxityBlock,
	type PraxityPage,
} from "@praxity/shared-blocks/types";
import { isDirectVideoUrl, isVimeoEmbed, toEmbedUrl } from "@praxity/shared-blocks/video-url-utils";
import { deckPageGates, type ModuleDeckOptions } from "./module-deck";

export type RuntimeMode = "static" | "islands";
export type IslandName =
	| "deck"
	| "nav"
	| "accordion"
	| "tabs"
	| "assessment"
	| "assessmentGroup"
	| "logic"
	| "selfCheck"
	| "retrievalSheet"
	| "highlight"
	| "writeDistractors"
	| "checklist"
	| "rating"
	| "signature"
	| "narration"
	| "imageComparison"
	| "labeledGraphic"
	| "card"
	| "code"
	| "tooltip"
	| "media"
	| "sequence"
	| "table";

export const ISLAND_BLOCK_MAP: Partial<Record<PraxityBlock["type"], IslandName>> = {
	accordion: "accordion",
	tabs: "tabs",
	assessment: "assessment",
	assessmentGroup: "assessmentGroup",
	logic: "logic",
	variable: "logic",
	checklist: "checklist",
	selfCheck: "selfCheck",
	retrievalSheet: "retrievalSheet",
	highlight: "highlight",
	writeDistractors: "writeDistractors",
	rating: "rating",
	signature: "signature",
	card: "card",
	code: "code",
	table: "table",
};

export function getBlockIsland(block: PraxityBlock): IslandName | undefined {
	if (block.type === "embed") {
		return block.data.display !== "bookmark" &&
			typeof block.data.src === "string" &&
			isEmbeddableHost(block.data.src)
			? "media"
			: undefined;
	}
	if (block.type === "sequence") {
		return block.data.orientation === "horizontal" && block.data.scrollable === true
			? "sequence"
			: undefined;
	}
	if (block.type === "audio" || block.type === "video") {
		const data = block.data as unknown as Record<string, unknown>;
		if (block.type === "audio") return "narration";
		const source = data.source;
		const sourceSrc =
			source && typeof source === "object" && (source as Record<string, unknown>).type === "url"
				? (source as Record<string, unknown>).src
				: data.src;
		if (typeof sourceSrc === "string" && !isDirectVideoUrl(sourceSrc)) return "media";
		if (typeof data.transcript === "string" && data.transcript.trim()) return "media";
		const start = data.startTime ?? data.start;
		const end = data.endTime ?? data.end;
		const hasClipBounds =
			(typeof start === "number" && Number.isFinite(start) && start >= 0) ||
			(typeof end === "number" && Number.isFinite(end) && end > 0);
		if (!hasClipBounds) return undefined;
		if (typeof sourceSrc !== "string") return undefined;
		return isDirectVideoUrl(sourceSrc) || isVimeoEmbed(toEmbedUrl(sourceSrc)) ? "media" : undefined;
	}
	if (block.type === "imageComparison") {
		return block.data.display === "slider" ? "imageComparison" : undefined;
	}
	if (block.type === "labeledGraphic") {
		return block.data.reveal === "click" || block.data.reveal === "sequential"
			? "labeledGraphic"
			: undefined;
	}
	return ISLAND_BLOCK_MAP[block.type];
}

export function blockRequiresPageGate(block: PraxityBlock): boolean {
	return (
		(block.type === "checklist" ||
			block.type === "rating" ||
			block.type === "signature" ||
			block.type === "selfCheck") &&
		block.data.required === true
	);
}

const SUPPORTED_BLOCK_TYPES = new Set<PraxityBlock["type"]>([
	"text",
	"heading",
	"image",
	"video",
	"audio",
	"document",
	"quote",
	"dialogue",
	"divider",
	"embed",
	"button",
	"chart",
	"table",
	"stats",
	"note",
	"code",
	"equation",
	"heroCover",
	"accordion",
	"tabs",
	"columns",
	"sequence",
	"card",
	"checklist",
	"assessment",
	"assessmentGroup",
	"logic",
	"variable",
	"rating",
	"imageComparison",
	"labeledGraphic",
	"signature",
	"selfCheck",
	"retrievalSheet",
	"highlight",
	// Declared prompt-only practice block; publication admission refuses it.
	"writeDistractors",
	"pageBreak",
	"blockBreak",
	"resourceEntry",
]);

export interface PageRuntimePlan {
	presentation?: "module-deck";
	mode: RuntimeMode;
	islands: IslandName[];
	/** @deprecated Kept empty in artifact v1 for reader compatibility. */
	legacyReasons: [];
}

export interface RuntimePlanningConfig {
	pages?: readonly PraxityPage[];
	sourceLocale: string;
	navigationStyle?: NavArchetype;
	navToggles?: Partial<NavToggleValues>;
	slideStyles?: Record<string, unknown>;
	glossaryTabEnabled?: boolean;
	resourcesTabEnabled?: boolean;
	glossaryTerms?: unknown[];
	resourceEntries?: unknown[];
	sectionRhythm?: SectionRhythm;
}

export function getPageNarrationSegments(
	config: RuntimePlanningConfig,
	page: PraxityPage,
): ReturnType<typeof extractNarrationSegments> {
	if (page.narrationEnabled !== true) return [];
	if (Array.isArray(page.data?._narrationSegments))
		return (page.data._narrationSegments as NarrationSegment[]).filter(
			(segment) => !segment.disabled && Boolean(segment.audioUrl),
		);
	return extractNarrationSegments(
		page.title,
		page.data ?? {},
		page.blocks,
		page.narrationDefaults,
		config.sourceLocale,
	).filter((segment) => !segment.disabled && Boolean(segment.audioUrl));
}

function visitBlocks(
	blocks: readonly PraxityBlock[],
	visit: (block: PraxityBlock) => boolean,
): void {
	for (const block of blocks) {
		if (!visit(block)) continue;
		const visitValue = (value: unknown): void => {
			if (Array.isArray(value)) {
				for (const item of value) visitValue(item);
				return;
			}
			if (!value || typeof value !== "object") return;
			const candidate = value as Record<string, unknown>;
			if (
				typeof candidate.id === "string" &&
				typeof candidate.type === "string" &&
				candidate.data &&
				typeof candidate.data === "object"
			) {
				visitBlocks([candidate as unknown as PraxityBlock], visit);
				return;
			}
			for (const [key, child] of Object.entries(candidate))
				if (!isInlineProjectionMetadataKey(key, { keepDisplay: true })) visitValue(child);
		};
		visitValue(block.data);
	}
}

function collectStringValues(value: unknown, out: string[]): void {
	if (typeof value === "string") {
		out.push(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectStringValues(item, out);
		return;
	}
	if (value && typeof value === "object") {
		const owner = value as Record<string, unknown>;
		if (isLiteralTextBlockType(owner.type)) return;
		const values =
			typeof owner.type === "string" && "data" in owner
				? [owner.data]
				: Object.entries(owner)
						.filter(([key]) => !isInlineProjectionMetadataKey(key, { keepDisplay: true }))
						.map(([, child]) => child);
		for (const item of values) {
			collectStringValues(item, out);
		}
	}
}

function pageMarkupContains(page: PraxityPage, needle: string): boolean {
	const strings: string[] = [];
	for (const block of page.blocks) collectStringValues(block, strings);
	return strings.some((value) => value.includes(needle));
}

export function pageHasTooltipMarkup(page: PraxityPage): boolean {
	return pageMarkupContains(page, "inline-tooltip-trigger");
}

export function resolvePageNavigation(config: RuntimePlanningConfig, page: PraxityPage) {
	const hasPageNavOverrides = pageHasNavOverrides(page.data);
	const pageNavArchetype = getPageNavArchetype(page.data);
	const pageNavToggles = applyKeyboardNavFloor(
		mergePageNavToggles(
			{ ...getNavPreset(toNavArchetype(config.navigationStyle)), ...(config.navToggles ?? {}) },
			page.data,
		),
	);
	const effectiveLayoutArchetype = hasPageNavOverrides
		? (pageNavArchetype ??
			inferNavStyleFromToggles(pageNavToggles, toNavArchetype(config.navigationStyle)))
		: toNavArchetype(config.navigationStyle);

	return { hasPageNavOverrides, pageNavToggles, effectiveLayoutArchetype };
}

function navigationNeedsIsland(
	config: RuntimePlanningConfig,
	archetype: NavArchetype | undefined,
	nav: Partial<NavToggleValues>,
): boolean {
	const needsGestureOrScrollEnhancer =
		nav.navBottomArrows === true ||
		nav.navEdgeArrows === true ||
		nav.navSwipeGestures === true ||
		nav.navFloatingToc === true ||
		nav.navScrollProgress === true;
	if (needsGestureOrScrollEnhancer) return true;
	if (navArchetypeSuppressesNav(archetype)) return false;
	return (
		nav.navTopBar === true ||
		nav.navHamburgerMenu === true ||
		(nav.showA11yPill === true && nav.navReadingSupportPlacement !== "none") ||
		(config.glossaryTabEnabled !== false && Boolean(config.glossaryTerms?.length)) ||
		(config.resourcesTabEnabled !== false && Boolean(config.resourceEntries?.length))
	);
}

function hasVisiblePageNavigation(nav: Partial<NavToggleValues>): boolean {
	return (
		nav.navOutline === true ||
		nav.navPrevNext === true ||
		nav.navBottomArrows === true ||
		nav.navEdgeArrows === true ||
		nav.navHamburgerMenu === true ||
		nav.navFloatingToc === true
	);
}

function hasIslandAsset(
	availableIslands: boolean | ReadonlySet<IslandName>,
	island: IslandName,
): boolean {
	return typeof availableIslands === "boolean" ? availableIslands : availableIslands.has(island);
}

export function planPageRuntime(
	config: RuntimePlanningConfig,
	page: PraxityPage,
	availableIslands: boolean | ReadonlySet<IslandName>,
): PageRuntimePlan {
	page = { ...page, blocks: prepareInlineBlocks(page.blocks) };
	const { pageNavToggles, effectiveLayoutArchetype } = resolvePageNavigation(config, page);
	const islands = new Set<IslandName>();
	const coursePages = config.pages;
	if (coursePages) {
		const blocks = flattenLogicBlocks(coursePages.flatMap((page) => page.blocks));
		const rules = flattenLogicBlocks(page.blocks).flatMap((block): DependencyRule[] => {
			const visible = block.data?.visible;
			return [
				...(block.type === "logic" ? [block.data as unknown as DependencyRule] : []),
				...(typeof visible === "string" && visible.trim()
					? [{ conditions: compileVisibleExpression(visible), actions: [] }]
					: []),
			];
		});
		const writers = blocks
			.filter((block) => block.type === "logic")
			.map((block) => block.data as unknown as DependencyRule);
		if (rules.some((rule) => selfCheckDependencies(blocks, [...rules, ...writers], rule).length))
			islands.add("selfCheck");
	}
	let needsGateAwareNavigation = false;

	visitBlocks(page.blocks, (block) => {
		if (RETIRED_BLOCK_TYPES.has(block.type)) {
			throw new Error(`Block type "${block.type}" has been retired and cannot be compiled.`);
		}
		const island = getBlockIsland(block);
		if (block.type === "logic" || block.type === "variable") islands.add("logic");
		if (!SUPPORTED_BLOCK_TYPES.has(block.type)) {
			throw new Error(`Unsupported published block type "${String(block.type)}".`);
		}
		if (block.type === "button" && block.data.action === "goToPage") {
			if (typeof block.data.targetPageId === "string" && block.data.targetPageId.trim()) {
				islands.add("nav");
			}
		}
		if (island) islands.add(island);
		if (blockRequiresPageGate(block)) needsGateAwareNavigation = true;
		const visible = (block.data as Record<string, unknown>)?.visible;
		if (typeof visible === "string" && visible.trim().length > 0) islands.add("logic");
		// These DOM enhancers keep their server-rendered descendants composable.
		// React-owned islands render their own subtree, so do not plan it twice.
		return island === undefined || island === "card" || island === "accordion" || island === "tabs";
	});
	const hasNarration = getPageNarrationSegments(config, page).length > 0;
	if (hasNarration) islands.add("narration");
	if (pageHasTooltipMarkup(page)) {
		islands.add("tooltip");
	}
	const needsNarrativeSectionRuntime =
		groupBlocksIntoSections(page.blocks, config.sectionRhythm ?? "uniform").length > 1;
	if (
		navigationNeedsIsland(config, effectiveLayoutArchetype, pageNavToggles) ||
		needsNarrativeSectionRuntime ||
		((hasNarration || islands.has("logic") || needsGateAwareNavigation) &&
			(hasVisiblePageNavigation(pageNavToggles) ||
				pageNavToggles.navKeyboardArrows === true ||
				pageNavToggles.navSwipeGestures === true))
	) {
		islands.add("nav");
	}

	if (islands.size === 0) return { mode: "static", islands: [], legacyReasons: [] };
	const missingIslands = [...islands].filter((island) => !hasIslandAsset(availableIslands, island));
	if (missingIslands.length > 0) {
		throw Object.assign(
			new Error(`Required island assets unavailable: ${missingIslands.sort().join(", ")}.`),
			{ code: "EISLANDASSET" },
		);
	}
	return { mode: "islands", islands: [...islands].sort(), legacyReasons: [] };
}

/** A module keeps one deck player and the content capabilities of all its logical slides. */
export function planModuleRuntime(
	config: RuntimePlanningConfig,
	pages: readonly PraxityPage[],
	availableIslands: boolean | ReadonlySet<IslandName>,
	options: ModuleDeckOptions = {},
): PageRuntimePlan {
	if (!hasIslandAsset(availableIslands, "deck"))
		throw new Error("Missing module deck runtime asset");
	const islands = new Set<IslandName>(["deck"]);
	const coursePages = config.pages ?? pages;
	const blocks = flattenLogicBlocks(coursePages.flatMap((page) => page.blocks));
	if (
		deckPageGates(blocks, options).some((gate) =>
			blocks.some((block) => block.id === gate.id && block.type === "selfCheck"),
		)
	)
		islands.add("selfCheck");
	for (const page of pages) {
		for (const island of planPageRuntime(config, page, availableIslands).islands) {
			if (island !== "nav" && island !== "narration") islands.add(island);
		}
	}
	return {
		mode: "islands",
		presentation: "module-deck",
		islands: [...islands].sort(),
		legacyReasons: [],
	};
}
