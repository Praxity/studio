/**
 * Escape a JSON string for safe embedding inside a single-quoted HTML attribute.
 * Handles characters that can break markup parsing in attribute context.
 */
export function escapeJsonForHtml(json: string): string {
	return json
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/'/g, "&#39;");
}
