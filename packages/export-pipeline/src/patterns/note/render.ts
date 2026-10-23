import {
	getNoteTypeLabel,
	NoteIcon,
	normalizeNoteProps,
	noteBodyHtml,
} from "@praxity/shared-blocks/note";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { escapeHtml, renderInlineField, sanitizeInline } from "../../published-markup.ts";
import type { RenderBlockHtmlStrings } from "../../render-block-html.ts";

export function renderNote(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as Record<string, unknown>;
	const { color, style } = normalizeNoteProps(data.style, data.color);
	const content = sanitizeInline(data.content);
	const titleText = typeof data.title === "string" ? data.title.trim() : "";
	const label = titleText
		? renderInlineField(data, "title")
		: escapeHtml(getNoteTypeLabel(color, strings));
	const icon = renderToStaticMarkup(
		createElement(NoteIcon, { color, icon: data.icon, iconNodes: data._tablerIconNodes }),
	);
	return `<aside role="note" class="praxity-note-base" data-color="${escapeHtml(color)}" data-style="${escapeHtml(style)}"><div class="praxity-note-body">${noteBodyHtml(label, content, icon)}</div></aside>`;
}
