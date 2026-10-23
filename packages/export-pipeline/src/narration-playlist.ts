import {
	extractNarrationSegments,
	hasNarrationContent,
	type NarrationSegment,
} from "@praxity/shared-blocks/narration";
import { BLOCK_TYPES, type PraxityBlock } from "@praxity/shared-blocks/types";
import type { NarrationPlaylistItem } from "@praxity/shared-blocks/viewer/narration-bar";

interface NarrationPageConfig {
	narrationEnabled?: boolean;
	narrationDefaults?: Record<string, unknown>;
	data?: Record<string, unknown>;
}

export interface NarrationConfig {
	grammarVersion?: 4;
	/** Grammar 4 hosts resolve identities before building the published config. */
	narrationSegments?: NarrationSegment[];
	pageTitle?: string;
	currentPage?: number;
	sourceLocale?: string;
	narrationEnabled?: boolean;
	narrationDefaults?: Record<string, unknown>;
	pages?: NarrationPageConfig[];
	blocks?: unknown[];
}

export interface NarrationPlaylist {
	items: Array<NarrationPlaylistItem & { authoredIndex: number; conditionalBlockId?: string }>;
	stops: Array<{
		after: number;
		blockId: string;
		ancestorBlockIds?: string[];
		conditionalBlockId?: string;
	}>;
}

const blockTypes = new Set<string>(BLOCK_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readBlocks(value: unknown): PraxityBlock[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(block): block is PraxityBlock =>
			isRecord(block) &&
			typeof block.id === "string" &&
			typeof block.type === "string" &&
			blockTypes.has(block.type) &&
			isRecord(block.data),
	);
}

function narrationSegmentsFromConfig(config: NarrationConfig): NarrationSegment[] {
	const pageIndex = Number.isInteger(config.currentPage) ? Number(config.currentPage) - 1 : 0;
	const page = config.pages?.[Math.max(0, pageIndex)];
	if ((page?.narrationEnabled ?? config.narrationEnabled) !== true) return [];
	if (config.grammarVersion === 4 || config.narrationSegments) {
		if (!config.narrationSegments)
			throw new Error("Grammar 4 narration requires identity-resolved segments.");
		return config.narrationSegments;
	}
	return extractNarrationSegments(
		typeof config.pageTitle === "string" ? config.pageTitle : "",
		isRecord(page?.data) ? page.data : {},
		readBlocks(config.blocks),
		isRecord(page?.narrationDefaults)
			? page.narrationDefaults
			: isRecord(config.narrationDefaults)
				? config.narrationDefaults
				: {},
		typeof config.sourceLocale === "string" ? config.sourceLocale : undefined,
	);
}

function audioItem(segment: NarrationSegment): NarrationPlaylistItem {
	return {
		id: segment.id,
		src: segment.audioUrl as string,
		...(segment.timingsUrl ? { timingsSrc: segment.timingsUrl } : {}),
		...(segment.blockId ? { blockId: segment.blockId } : {}),
		...(segment.blockType === "dialogue" && segment.itemIndex !== undefined
			? { turnIndex: segment.itemIndex }
			: {}),
		...(segment.cardTargets ? { cardTargets: segment.cardTargets } : {}),
		...(segment.duration !== undefined ? { duration: segment.duration } : {}),
		pauseAfter: segment.pauseAfter,
	};
}

export function narrationPlaylistFromConfig(config: NarrationConfig): NarrationPlaylist {
	const segments = narrationSegmentsFromConfig(config);
	const items: NarrationPlaylist["items"] = [];
	const stops: NarrationPlaylist["stops"] = [];
	let index = 0;
	for (const segment of segments) {
		const after = index + Number(hasNarrationContent(segment));
		for (const stop of segment.stopBefore ?? []) stops.push({ after: index, ...stop });
		for (const blockId of segment.authoredStopBlockIds ?? []) {
			const ancestorBlockIds =
				blockId !== segment.blockId && segment.blockId
					? [...(segment.ancestorBlockIds ?? []), segment.blockId]
					: segment.ancestorBlockIds;
			stops.push({
				after,
				blockId,
				...(ancestorBlockIds?.length ? { ancestorBlockIds } : {}),
				...(segment.conditionalBlockId ? { conditionalBlockId: segment.conditionalBlockId } : {}),
			});
		}
		if (!segment.disabled && segment.audioUrl)
			items.push({
				...audioItem(segment),
				authoredIndex: index,
				...(segment.ancestorBlockIds?.length ? { ancestorBlockIds: segment.ancestorBlockIds } : {}),
				...(segment.conditionalBlockId ? { conditionalBlockId: segment.conditionalBlockId } : {}),
			});
		index = after;
	}
	for (const stop of segments.at(-1)?.trailingStops ?? []) {
		stops.push({ after: index, ...stop });
	}
	return { items, stops };
}
