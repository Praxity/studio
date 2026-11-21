export function escapeTypst(text: string): string {
	return text.replace(/[\\#$@*_`<>[\]{}=+\-~/:.!(;]/g, "\\$&");
}

export function typstString(text: string): string {
	return `"${text.replace(/["\\\u0000-\u001f\u007f-\u009f]/g, (char) => {
		if (char === '"' || char === "\\") return `\\${char}`;
		return `\\u{${char.charCodeAt(0).toString(16)}}`;
	})}"`;
}
