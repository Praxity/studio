import type { PraxityBlock } from "@praxity/content-model";

export interface LessonPage {
	/** Absent only for content before the first delimiter. */
	boundary?: PraxityBlock;
	blocks: PraxityBlock[];
}

/** Authored pages, including hidden and explicitly empty pages. */
export function partitionLessonPages(blocks: readonly PraxityBlock[]): LessonPage[] {
	const pages: LessonPage[] = [];
	let page: LessonPage = { blocks: [] };
	for (const block of blocks) {
		if (block.type === "pageBreak") {
			if (page.boundary || page.blocks.length) pages.push(page);
			page = { boundary: block, blocks: [] };
		} else page.blocks.push(block);
	}
	if (page.boundary || page.blocks.length) pages.push(page);
	return pages;
}
