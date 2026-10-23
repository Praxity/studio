import { IMAGE_WIDTHS, type ImageFloat, type PraxityBlock } from "./types";

export function getImageFloatSide(block: PraxityBlock): ImageFloat | null {
	if (block.type !== "image" || (block.data.float !== "left" && block.data.float !== "right"))
		return null;
	if (!(IMAGE_WIDTHS as readonly unknown[]).includes(block.data.width)) return null;
	if ([block.data.layoutMode, block.data.layout].some((value) => value != null && value !== ""))
		return null;
	return block.data.float;
}

/** Keep block identities flat; only presentation groups the explicitly bounded flow. */
export function imageFloatRegions(blocks: readonly PraxityBlock[]): Array<{
	blocks: PraxityBlock[];
	float: ImageFloat | null;
	nodeId?: string;
}> {
	const regions: ReturnType<typeof imageFloatRegions> = [];
	let active: (typeof regions)[number] | undefined;
	for (const block of blocks) {
		if (block.type === "blockBreak" && block.data.close === "float") {
			// The closing boundary owns the grammar-4 float's source identity.
			// Carry it on the region rather than adding an empty layout item.
			const region = active ?? regions.at(-1);
			if (region && !region.nodeId) region.nodeId = block.id;
			else regions.push({ blocks: [], float: null, nodeId: block.id });
			active = undefined;
			continue;
		}
		if (block.type === "pageBreak") active = undefined;
		const side = getImageFloatSide(block);
		if (side) {
			active = { blocks: [], float: side };
			regions.push(active);
		}
		if (active) active.blocks.push(block);
		else regions.push({ blocks: [block], float: null });
	}
	return regions;
}
