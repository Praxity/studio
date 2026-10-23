/** Escape authored text, never generated Typst markup. */
export function escapeTypst(text: string): string {
	return text.replace(/[\\#$@*_`<>[\]{}=+\-~/:.!(;]/g, "\\$&");
}

/** A complete Typst string literal, for function arguments rather than content. */
export function typstString(text: string): string {
	return `"${text.replace(/["\\\u0000-\u001f\u007f-\u009f]/g, (char) => {
		if (char === '"' || char === "\\") return `\\${char}`;
		return `\\u{${char.charCodeAt(0).toString(16)}}`;
	})}"`;
}
