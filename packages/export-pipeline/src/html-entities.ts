function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

export function fullyDecodeEntities(value: string): string {
	let prev = value;
	let decoded = decodeHtmlEntities(prev);
	// Max 3 passes to prevent infinite loop on malformed input
	for (let i = 0; i < 3 && decoded !== prev; i++) {
		prev = decoded;
		decoded = decodeHtmlEntities(prev);
	}
	return decoded;
}
