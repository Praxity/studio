import { htmlToPlainText } from "@praxity/shared-blocks/sanitize";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { escapeHtml, sanitizeInline } from "../../published-markup.ts";

export function renderQuote(block: PraxityBlock): string {
	const data = block.data as Record<string, unknown>;
	const text = sanitizeInline(typeof data.text === "string" ? data.text : data.content);
	const body = /<p(?:\s|>)/i.test(text) ? text : `<p>${text}</p>`;
	const plainText = (value: unknown) =>
		typeof value === "string"
			? htmlToPlainText(value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " "))
			: "";
	const speaker = plainText(data.speaker) || plainText(data.attribution);
	const work = plainText(data.work);
	let sourceUrl = "";
	if (typeof data.sourceUrl === "string") {
		try {
			const url = new URL(data.sourceUrl);
			if (url.protocol === "https:" || url.protocol === "http:") sourceUrl = url.href;
		} catch {
			// Persisted quote data is untrusted; omit malformed citation URLs.
		}
	}
	const source = work
		? `<cite>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}">${escapeHtml(work)}</a>` : escapeHtml(work)}</cite>`
		: sourceUrl
			? `<a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a>`
			: "";
	const attribution =
		speaker || source
			? `<figcaption class="praxity-quote-attribution">${speaker ? `<span class="praxity-quote__speaker">${escapeHtml(speaker)}</span>` : ""}${speaker && source ? ", " : ""}${source}</figcaption>`
			: "";
	const style = ["none", "outline", "shaded", "primary", "secondary"].includes(String(data.style))
		? ` data-style="${escapeHtml(String(data.style))}"`
		: "";
	const size = data.size === "large" || data.size === "very-large" ? data.size : "default";
	return `<figure class="praxity-quote"${style} data-size="${size}"><blockquote${sourceUrl ? ` cite="${escapeHtml(sourceUrl)}"` : ""}>${body}</blockquote>${attribution}</figure>`;
}
