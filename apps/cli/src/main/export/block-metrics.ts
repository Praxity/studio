import { partitionLessonPages } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";

export function getMetricsFromBlocks(blocks: PraxityBlock[]) {
	const contentBlocks = blocks.filter((block) => block.type !== "pageBreak");
	const uniqueTypes = new Set<string>();
	for (const block of contentBlocks) {
		uniqueTypes.add(block.type);
	}
	return {
		pageCount: partitionLessonPages(blocks).length,
		blockCount: contentBlocks.length,
		blockTypes: [...uniqueTypes].sort(),
	};
}
