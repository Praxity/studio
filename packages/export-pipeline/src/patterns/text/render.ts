import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { sanitizeInline } from "../../published-markup.ts";

export function renderText(block: PraxityBlock): string {
	const data = block.data as Record<string, unknown>;
	return `<div class="praxity-text">${sanitizeInline(data.content)}</div>`;
}
