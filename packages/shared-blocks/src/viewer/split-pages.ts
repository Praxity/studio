import { partitionLessonPages } from "@praxity/grammar";
import type { PraxityBlock } from "../types";
import { buildSlugMap, decodeHtmlEntities, pageSlug } from "./page-slug";

export interface PageData {
	/** 1-based page number. */
	pageNumber: number;
	/** Page id for config references. */
	id: string;
	/** Display title from pageBreak data or fallback. */
	title: string;
	/** URL-safe slug derived from title. */
	slug: string;
	/** Metadata from the pageBreak that starts this page. */
	data: Record<string, unknown>;
	lessonTitle?: string;
	lessonTitleIsFallback?: boolean;
	lessonKicker?: string;
	lessonTime?: string;
	lessonId?: string;
	locale?: string;
	isFirstPageOfLesson?: boolean;
	narrationEnabled?: boolean;
	narrationDefaults?: Record<string, unknown>;
	/** Blocks for this page (excludes the pageBreak itself). */
	blocks: PraxityBlock[];
}

/** Navigation label from the grammar 4 page boundary. */
function explicitPageTitle(data: Record<string, unknown>): string | undefined {
	const maybeTitle = data.title ?? data.label;
	if (typeof maybeTitle === "string" && maybeTitle.trim()) {
		return maybeTitle.trim();
	}
	return undefined;
}

function headingPageTitle(blocks: PraxityBlock[]): string | undefined {
	// An assessment group's name is the authored `##` heading the parser
	// swallowed, so it counts as the page's first heading.
	const source = blocks.find(
		(block) =>
			(block.type === "heading" && typeof block.data.content === "string") ||
			(block.type === "assessmentGroup" && typeof block.data.groupName === "string"),
	);
	if (!source) return undefined;
	const content =
		source.type === "heading" ? (source.data.content as string) : (source.data.groupName as string);
	return (
		decodeHtmlEntities(content.replace(/<[^>]*>/g, " "))
			.replace(/\s+/g, " ")
			.trim() || undefined
	);
}

/**
 * Split a flat block array into per-page arrays at pageBreak boundaries.
 * An implicit first page exists only when blocks precede the first pageBreak.
 * Each pageBreak starts a new page; the pageBreak block itself is excluded.
 */
export function splitBlocksIntoPages(
	blocks: PraxityBlock[],
	_courseTitle: string,
	initialPageData: Record<string, unknown> = {},
	options: { includeHidden?: boolean } = {},
): PageData[] {
	if (blocks.length === 0) return [];

	const pages: Array<Omit<PageData, "slug">> = [];
	let currentBlocks: PraxityBlock[] = [];
	let pendingData: Record<string, unknown> = initialPageData;
	let currentLessonTitle: string | undefined;
	let currentLessonTitleIsFallback: boolean | undefined;
	let currentLessonKicker: string | undefined;
	let currentLessonTime: string | undefined;
	let currentLessonId: string | undefined;
	let currentLocale: string | undefined;
	let currentNarrationEnabled: boolean | undefined;
	let currentNarrationDefaults: Record<string, unknown> | undefined;

	const pushPage = (lessonDefaults: Record<string, unknown>) => {
		const metadata = { ...lessonDefaults, ...pendingData };
		const isFirstPageOfLesson = metadata.isFirstPageOfLesson === true;
		const lessonTitle = metadata.lessonTitle;
		if (typeof lessonTitle === "string" && lessonTitle.trim()) {
			currentLessonTitle = lessonTitle.trim();
		}
		if (isFirstPageOfLesson || Object.hasOwn(metadata, "lessonTitleIsFallback")) {
			currentLessonTitleIsFallback = metadata.lessonTitleIsFallback === true || undefined;
		}
		if (isFirstPageOfLesson) currentLocale = undefined;
		if (typeof metadata.lessonLocale === "string" && metadata.lessonLocale.trim()) {
			currentLocale = metadata.lessonLocale.trim();
		}
		if (typeof metadata.lessonId === "string" && metadata.lessonId.trim()) {
			currentLessonId = metadata.lessonId;
		}
		if (isFirstPageOfLesson || Object.hasOwn(metadata, "lessonKicker")) {
			currentLessonKicker =
				typeof metadata.lessonKicker === "string"
					? metadata.lessonKicker.trim() || undefined
					: undefined;
		}
		if (typeof metadata._narrationEnabled === "boolean") {
			currentNarrationEnabled = metadata._narrationEnabled;
		}
		if (isFirstPageOfLesson || Object.hasOwn(metadata, "lessonTime")) {
			currentLessonTime =
				typeof metadata.lessonTime === "string"
					? metadata.lessonTime.trim() || undefined
					: undefined;
		}
		if (
			metadata._narrationDefaults &&
			typeof metadata._narrationDefaults === "object" &&
			!Array.isArray(metadata._narrationDefaults)
		) {
			currentNarrationDefaults = metadata._narrationDefaults as Record<string, unknown>;
		}
		if (pendingData.hide === true && !options.includeHidden) return;
		const visiblePageNumber = pages.length + 1;
		pages.push({
			pageNumber: visiblePageNumber,
			id:
				typeof pendingData.id === "string" && pendingData.id.trim()
					? pendingData.id
					: `page-${visiblePageNumber}`,
			title: explicitPageTitle(pendingData) ?? headingPageTitle(currentBlocks) ?? "Untitled",
			data: pendingData,
			blocks: currentBlocks,
			lessonTitle: currentLessonTitle,
			...(currentLessonTitleIsFallback ? { lessonTitleIsFallback: true } : {}),
			lessonKicker: currentLessonKicker,
			lessonTime: currentLessonTime,
			lessonId: currentLessonId,
			...(currentLocale ? { locale: currentLocale } : {}),
			isFirstPageOfLesson,
			narrationEnabled: currentNarrationEnabled,
			narrationDefaults: currentNarrationDefaults,
		});
	};

	// Lesson metadata belongs to the lesson even when it has no implicit page.
	const lessonData = Object.fromEntries(
		Object.entries(initialPageData).filter(([key]) =>
			[
				"lessonTitle",
				"lessonTitleIsFallback",
				"lessonKicker",
				"lessonTime",
				"lessonId",
				"lessonLocale",
				"isFirstPageOfLesson",
				"_narrationEnabled",
				"_narrationDefaults",
			].includes(key),
		),
	);
	for (const [index, page] of partitionLessonPages(blocks).entries()) {
		currentBlocks = page.blocks;
		pendingData = page.boundary?.data ?? initialPageData;
		pushPage(index === 0 ? lessonData : {});
	}

	const slugMap = buildSlugMap(
		pages.map((page, index) => ({
			id: page.id,
			title: page.title || pageSlug("", index),
		})),
	);

	return pages.map((page, index) => ({
		...page,
		slug: slugMap.get(page.id) ?? pageSlug(page.title, index),
	}));
}
