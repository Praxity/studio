/**
 * Utilities for detecting file extensions in URLs and annotating links
 * with file type indicators for accessibility.
 *
 * Screen reader users navigating by links benefit from knowing the file type
 * before activating a link (WCAG 2.1 SC 1.4.1, SC 2.4.4).
 */

/** Extensions that indicate a downloadable file (not a web page). */
const ANNOTATABLE_EXTENSIONS = new Set([
	// Documents
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
	// Media
	"mp3",
	"mp4",
	"wav",
	"ogg",
	"webm",
	"avi",
	"mov",
	"flac",
	// Archives
	"zip",
	"tar",
	"gz",
	"rar",
	"7z",
	// eBooks
	"epub",
	"mobi",
]);

/** Extract file extension from URL (e.g. "pdf" from "https://example.com/file.pdf"). */
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

/** Check if an extension represents a downloadable file worth annotating. */
export function isAnnotatableExtension(ext: string | undefined): ext is string {
	return ext !== undefined && ANNOTATABLE_EXTENSIONS.has(ext);
}

/** Get a human-readable label for a file extension (uppercased). */
export function getFileTypeLabel(url: string): string | undefined {
	const ext = getFileExtension(url);
	return isAnnotatableExtension(ext) ? ext.toUpperCase() : undefined;
}

/** Format the short, non-link metadata shown beneath a bookmark title. */
export function getLinkPreviewMeta(url: string, fileType?: string): string | undefined {
	let domain: string | undefined;
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			domain = parsed.hostname.replace(/^www\./i, "");
		}
	} catch {
		// Relative/local assets have no useful domain label.
	}
	return [domain, fileType].filter(Boolean).join(" · ") || undefined;
}

/** Derive a file type label from a MIME type (e.g. "application/pdf" → "PDF"). */
export function getFileTypeLabelFromMime(mimeType: string | undefined): string | undefined {
	if (!mimeType) return undefined;
	const sub = mimeType.split("/")[1];
	if (!sub) return undefined;
	// Map common MIME subtypes to extensions
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

/**
 * Post-process sanitized TipTap HTML to annotate file links with their type.
 *
 * Finds `<a href="...">text</a>` where the URL points to a downloadable file,
 * and appends a file type indicator like `(PDF)` if the link text doesn't
 * already mention it.
 *
 * Must be called AFTER sanitizeHtml() — operates on trusted HTML.
 */
export function annotateFileLinks(html: string): string {
	// Match <a ...href="URL"...>text</a> — non-greedy, handles attributes in any order
	return html.replace(/<a\b([^>]*?)>(.*?)<\/a>/gi, (match, attrs: string, innerHtml: string) => {
		// Extract href from attributes
		const hrefMatch = attrs.match(/\bhref="([^"]*)"/i);
		if (!hrefMatch) return match;

		const href = hrefMatch[1];
		const label = getFileTypeLabel(href);
		if (!label) return match;

		// Strip HTML tags from inner content to check plain text
		const plainText = innerHtml.replace(/<[^>]*>/g, "").trim();

		// Don't annotate if the text already mentions the file type
		if (plainText.toUpperCase().includes(label)) return match;

		return `<a${attrs}>${innerHtml} <span class="praxity-file-type">(${label})</span></a>`;
	});
}
