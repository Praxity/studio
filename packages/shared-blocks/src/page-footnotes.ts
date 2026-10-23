import { rebindInlineFields } from "@praxity/content-model/inline-fields";
import { escapeHtml } from "./constants";
import { inlineMarkdown, prepareInlineBlocks } from "./inline-markdown";
import { isLiteralTextBlockType, type PraxityBlock } from "./types";

const FOOTNOTE = /<span\b[^>]*\bdata-footer-content="([^"]*)"[^>]*>[\s\S]*?<\/span>/g;
const INSERT =
	/<p>\s*<span data-footer-insert="true">@footer\.insert<\/span>\s*<\/p>|^<span data-footer-insert="true">@footer\.insert<\/span>$/g;

function decodeSource(value: string): string {
	// Reverse exactly the entities emitted by escapeHtml, once, ampersand last.
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

/** Render-only preparation, shared by canonical output and page projections.
 * Never write the numbered copy back to the author's source. */
export function preparePageFootnotes(
	blocks: PraxityBlock[],
	pageId: string,
	strings: { footnote: string; footnotes: string },
): PraxityBlock[] {
	const notes: string[] = [];
	let hasInsert = false;
	const transform = (value: unknown, replace: (html: string) => string): unknown => {
		if (typeof value === "string") return replace(value);
		if (Array.isArray(value)) return value.map((entry) => transform(entry, replace));
		if (!value || typeof value !== "object") return value;
		const record = value as Record<string, unknown>;
		if (isLiteralTextBlockType(record.type)) return value;
		const data = record.data as Record<string, unknown> | undefined;
		if (data?.hide === true || data?.hidden === true) return value;
		const transformed = Object.fromEntries(
			Object.entries(record)
				.sort(([a], [b]) => (a === "_inline" ? -1 : b === "_inline" ? 1 : 0))
				.map(([key, entry]) => [
					key,
					(key.startsWith("_") && key !== "_inline") ||
					(record._inline && Object.hasOwn(record._inline as object, key))
						? entry
						: transform(entry, replace),
				]),
		);
		rebindInlineFields(record, transformed);
		return transformed;
	};
	const inlineBlocks = prepareInlineBlocks(blocks);
	const numbered = transform(inlineBlocks, (html) =>
		html.replace(FOOTNOTE, (_match, source: string) => {
			notes.push(inlineMarkdown(decodeSource(source)));
			return `<sup class="praxity-footnote-ref"><span class="praxity-sr-only">${escapeHtml(strings.footnote)} </span>[${notes.length}]</sup>`;
		}),
	) as PraxityBlock[];
	const list = notes.length
		? `<ol class="praxity-footnotes" aria-label="${escapeHtml(strings.footnotes)}">${notes.map((note) => `<li>${note}</li>`).join("")}</ol>`
		: "";
	const placed = transform(numbered, (html) =>
		html.replace(INSERT, () => {
			const content = hasInsert ? "" : list;
			hasInsert = true;
			return content;
		}),
	) as PraxityBlock[];
	if (!notes.length && !hasInsert) return inlineBlocks;
	if (hasInsert || !list) return placed;
	return [
		...placed,
		{ id: `${pageId}-footnotes`, type: "text", data: { content: list, _footnotes: true } },
	];
}
