const ANNOTATABLE_EXTENSIONS = new Set([
	"pdf",
	"doc",
	"docx",
	"xls",
	"xlsx",
	"ppt",
	"pptx",
	"odt",
	"ods",
	"odp",
	"rtf",
	"csv",
	"mp3",
	"mp4",
	"wav",
	"ogg",
	"webm",
	"avi",
	"mov",
	"flac",
	"zip",
	"tar",
	"gz",
	"rar",
	"7z",
	"epub",
	"mobi",
]);

export function getFileExtension(url: string): string | undefined {
	try {
		const pathname = new URL(url).pathname;
		const lastDot = pathname.lastIndexOf(".");
		if (lastDot === -1) return undefined;
		const ext = pathname.slice(lastDot + 1).toLowerCase();
		return ext && ext.length <= 5 ? ext : undefined;
	} catch {
		return undefined;
	}
}

export function isAnnotatableExtension(ext: string | undefined): ext is string {
	return ext !== undefined && ANNOTATABLE_EXTENSIONS.has(ext);
}

export function getFileTypeLabel(url: string): string | undefined {
	const ext = getFileExtension(url);
	return isAnnotatableExtension(ext) ? ext.toUpperCase() : undefined;
}

export function getLinkPreviewMeta(url: string, fileType?: string): string | undefined {
	let domain: string | undefined;
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			domain = parsed.hostname.replace(/^www\./i, "");
		}
	} catch {}
	return [domain, fileType].filter(Boolean).join(" · ") || undefined;
}

export function getFileTypeLabelFromMime(mimeType: string | undefined): string | undefined {
	if (!mimeType) return undefined;
	const sub = mimeType.split("/")[1];
	if (!sub) return undefined;
	const mimeToExt: Record<string, string> = {
		pdf: "pdf",
		msword: "doc",
		"vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
		"vnd.ms-excel": "xls",
		"vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
		"vnd.ms-powerpoint": "ppt",
		"vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
		csv: "csv",
		mp4: "mp4",
		mpeg: "mp3",
		wav: "wav",
		ogg: "ogg",
		webm: "webm",
		zip: "zip",
		"x-tar": "tar",
		gzip: "gz",
		"x-rar-compressed": "rar",
		"epub+zip": "epub",
	};
	const ext = mimeToExt[sub];
	return ext ? ext.toUpperCase() : undefined;
}

export function annotateFileLinks(html: string): string {
	return html.replace(/<a\b([^>]*?)>(.*?)<\/a>/gi, (match, attrs: string, innerHtml: string) => {
		const hrefMatch = attrs.match(/\bhref="([^"]*)"/i);
		if (!hrefMatch) return match;

		const href = hrefMatch[1];
		const label = getFileTypeLabel(href);
		if (!label) return match;

		const plainText = innerHtml.replace(/<[^>]*>/g, "").trim();

		if (plainText.toUpperCase().includes(label)) return match;

		return `<a${attrs}>${innerHtml} <span class="praxity-file-type">(${label})</span></a>`;
	});
}
