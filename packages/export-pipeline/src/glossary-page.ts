import {
	formatInlineText,
	inlineMarkdown,
	isInlineProjectionMetadataKey,
} from "@praxity/shared-blocks/inline-markdown";
import { sanitizeHtml } from "@praxity/shared-blocks/sanitize";
import { isLiteralTextBlockType } from "@praxity/shared-blocks/types";
import { buildSlugMap } from "@praxity/shared-blocks/viewer/page-slug";

export interface GlossaryPageTerm {
	term: string;
	definition: string;
	lessonTitle: string;
	lessonSlug: string;
}

interface GlossaryPageOptions {
	terms: GlossaryPageTerm[];
}

/** Escape characters that are unsafe in HTML text/attribute contexts. */
function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Generate the body HTML for the glossary page.
 * Returns an empty string when no terms are provided.
 */
export function generateGlossaryPageHtml(opts: GlossaryPageOptions): string {
	const { terms } = opts;
	if (terms.length === 0) return "";

	const sorted = [...terms].sort((a, b) => a.term.localeCompare(b.term));

	const termEntries = sorted
		.map((t) => {
			const id = `term-${t.term
				.toLowerCase()
				.replace(/\s+/g, "-")
				.replace(/[^a-z0-9-]/g, "")}`;
			const sanitizedDef = sanitizeHtml(t.definition);
			return `
			<div class="praxity-glossary-term" id="${escapeHtml(id)}">
				<dt class="praxity-glossary-term-name">${escapeHtml(t.term)}</dt>
				<dd class="praxity-glossary-term-definition">
					${sanitizedDef}
				</dd>
			</div>`;
		})
		.join("\n");

	return `
		<div class="praxity-glossary-page">
			<dl>
				${termEntries}
			</dl>
		</div>`;
}

/** Inline tooltip triggers, as emitted by the grammar and the rich editor. */
const TOOLTIP_TRIGGER = /<span[^>]*\bdata-tooltip-content="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi;

/** The term is written back out through escapeHtml, so it must arrive as plain text. */
function toPlainText(html: string): string {
	return html
		.replace(/<[^>]+>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.trim();
}

/**
 * Collect glossary entries from the inline tooltips authored in page content.
 * Walks rich block data at any nesting depth, leaving literal blocks intact.
 * First definition of a term wins; matching is
 * case-insensitive so "PPE" and "ppe" are one entry.
 */
export function collectGlossaryTerms(
	pages: Array<{ id: string; title: string; blocks: unknown }>,
): GlossaryPageTerm[] {
	const slugMap = buildSlugMap(pages);
	const byTerm = new Map<string, GlossaryPageTerm>();

	const visit = (value: unknown, page: { id: string; title: string }, prepared?: boolean): void => {
		if (typeof value === "string") {
			const html =
				prepared === true
					? value
					: prepared === false
						? /\[[^\]]+\]\{[^}]+\}/.test(value)
							? inlineMarkdown(value)
							: ""
						: formatInlineText(value);
			if (!html) return;
			TOOLTIP_TRIGGER.lastIndex = 0;
			for (const [, definition, term] of html.matchAll(TOOLTIP_TRIGGER)) {
				const plainTerm = toPlainText(term);
				if (!plainTerm || !definition.trim()) continue;
				const key = plainTerm.toLowerCase();
				if (byTerm.has(key)) continue;
				byTerm.set(key, {
					term: plainTerm,
					definition,
					lessonTitle: page.title,
					lessonSlug: slugMap.get(page.id) ?? "",
				});
			}
			return;
		}
		if (Array.isArray(value)) {
			for (const entry of value) visit(entry, page, prepared);
			return;
		}
		if (value && typeof value === "object") {
			const owner = value as Record<string, unknown>;
			if (isLiteralTextBlockType(owner.type)) return;
			const htmlFields = Array.isArray(owner._htmlFields) ? owner._htmlFields : [];
			for (const [key, entry] of Object.entries(owner)) {
				if (isInlineProjectionMetadataKey(key, { keepDisplay: true })) continue;
				// Grammar marks HTML-valued fields where it projects them. Other labels stay raw.
				visit(
					entry,
					page,
					prepared === true || key === "_inline" || htmlFields.includes(key)
						? true
						: key === "content" && typeof entry === "string"
							? undefined
							: false,
				);
			}
		}
	};

	for (const page of pages) visit(page.blocks, page);
	return [...byTerm.values()];
}
