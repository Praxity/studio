/**
 * Utilities for annotating links that open in new tabs with a visual icon
 * and screen-reader text per W3C technique G201.
 *
 * Must be called AFTER sanitizeHtml() — operates on trusted HTML.
 */
import { escapeHtml } from "../constants";

/** SVG path for the external link icon (box with arrow). */
export const EXTERNAL_LINK_SVG_PATH =
	"M10 1h5v5h-1.5V3.56L8.28 8.78l-1.06-1.06L12.44 2.5H10V1ZM3.5 3H7v1.5H3.5v8h8V9H13v4.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z";

/** Inline SVG icon HTML for post-processed content. Uses currentColor to inherit text color. */
export const EXTERNAL_LINK_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="praxity-external-icon"><path d="${EXTERNAL_LINK_SVG_PATH}"/></svg>`;

/** Mark a generated new-tab link after sanitizing its authored content. */
export function externalLinkIndicatorHtml(srText: string): string {
	return `${EXTERNAL_LINK_ICON_HTML}<span class="praxity-sr-only">, ${escapeHtml(srText)}</span>`;
}
