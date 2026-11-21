function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function textToParagraphs(text: string): string {
	if (!text) return "<p></p>";
	const lines = text.split("\n");
	return lines.map((line) => `<p>${line === "" ? "" : escapeHtml(line)}</p>`).join("");
}
