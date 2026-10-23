/** Escapes HTML special characters so ProseMirror treats them as text. */
function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Converts a plain-text string into TipTap-compatible HTML paragraphs. */
export function textToParagraphs(text: string): string {
	if (!text) return "<p></p>";
	const lines = text.split("\n");
	return lines.map((line) => `<p>${line === "" ? "" : escapeHtml(line)}</p>`).join("");
}
