import { escapeHtml } from "../constants";

export const EXTERNAL_LINK_SVG_PATH =
	"M10 1h5v5h-1.5V3.56L8.28 8.78l-1.06-1.06L12.44 2.5H10V1ZM3.5 3H7v1.5H3.5v8h8V9H13v4.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z";

export const EXTERNAL_LINK_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="praxity-external-icon"><path d="${EXTERNAL_LINK_SVG_PATH}"/></svg>`;

export function externalLinkIndicatorHtml(srText: string): string {
	return `${EXTERNAL_LINK_ICON_HTML}<span class="praxity-sr-only">, ${escapeHtml(srText)}</span>`;
}
