import { describe, expect, it } from "vitest";
import {
	annotateFileLinks,
	getFileExtension,
	getFileTypeLabel,
	getFileTypeLabelFromMime,
	getLinkPreviewMeta,
	isAnnotatableExtension,
} from "./file-link-utils";

describe("getFileExtension", () => {
	it("extracts extension from URL", () => {
		expect(getFileExtension("https://example.com/report.pdf")).toBe("pdf");
		expect(getFileExtension("https://example.com/data.xlsx")).toBe("xlsx");
	});

	it("returns undefined for no extension", () => {
		expect(getFileExtension("https://example.com/page")).toBeUndefined();
	});

	it("returns undefined for invalid URLs", () => {
		expect(getFileExtension("not-a-url")).toBeUndefined();
	});

	it("lowercases extensions", () => {
		expect(getFileExtension("https://example.com/file.PDF")).toBe("pdf");
	});
});

describe("isAnnotatableExtension", () => {
	it("returns true for document extensions", () => {
		expect(isAnnotatableExtension("pdf")).toBe(true);
		expect(isAnnotatableExtension("docx")).toBe(true);
		expect(isAnnotatableExtension("csv")).toBe(true);
	});

	it("returns true for media extensions", () => {
		expect(isAnnotatableExtension("mp4")).toBe(true);
		expect(isAnnotatableExtension("mp3")).toBe(true);
	});

	it("returns false for web page extensions", () => {
		expect(isAnnotatableExtension("html")).toBe(false);
		expect(isAnnotatableExtension("htm")).toBe(false);
		expect(isAnnotatableExtension("php")).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isAnnotatableExtension(undefined)).toBe(false);
	});
});

describe("getFileTypeLabel", () => {
	it("returns uppercased extension for annotatable files", () => {
		expect(getFileTypeLabel("https://example.com/report.pdf")).toBe("PDF");
		expect(getFileTypeLabel("https://example.com/data.xlsx")).toBe("XLSX");
	});

	it("returns undefined for non-annotatable URLs", () => {
		expect(getFileTypeLabel("https://example.com/page")).toBeUndefined();
		expect(getFileTypeLabel("https://example.com/page.html")).toBeUndefined();
	});

	it("returns undefined for relative URLs (API asset paths)", () => {
		expect(getFileTypeLabel("/api/assets/abc123/download")).toBeUndefined();
	});
});

describe("getLinkPreviewMeta", () => {
	it("shows the registrable-looking host and known file type without the raw URL", () => {
		expect(getLinkPreviewMeta("https://www.amnesty.org.au/files/guide.pdf?download=1", "PDF")).toBe(
			"amnesty.org.au · PDF",
		);
	});

	it("omits a domain for local assets", () => {
		expect(getLinkPreviewMeta("/assets/guide.pdf", "PDF")).toBe("PDF");
	});
});

describe("getFileTypeLabelFromMime", () => {
	it("returns label for common MIME types", () => {
		expect(getFileTypeLabelFromMime("application/pdf")).toBe("PDF");
		expect(
			getFileTypeLabelFromMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
		).toBe("XLSX");
		expect(getFileTypeLabelFromMime("application/zip")).toBe("ZIP");
		expect(getFileTypeLabelFromMime("video/mp4")).toBe("MP4");
		expect(getFileTypeLabelFromMime("audio/mpeg")).toBe("MP3");
	});

	it("returns undefined for unknown MIME types", () => {
		expect(getFileTypeLabelFromMime("application/octet-stream")).toBeUndefined();
		expect(getFileTypeLabelFromMime("text/html")).toBeUndefined();
	});

	it("returns undefined for undefined input", () => {
		expect(getFileTypeLabelFromMime(undefined)).toBeUndefined();
	});
});

describe("annotateFileLinks", () => {
	it("appends file type to links pointing to files", () => {
		const html = '<p><a href="https://example.com/report.pdf">Annual report</a></p>';
		const result = annotateFileLinks(html);
		expect(result).toContain("Annual report");
		expect(result).toContain('<span class="praxity-file-type">(PDF)</span>');
	});

	it("does not annotate links to web pages", () => {
		const html = '<p><a href="https://example.com/about">About us</a></p>';
		expect(annotateFileLinks(html)).toBe(html);
	});

	it("does not annotate if link text already contains the file type", () => {
		const html = '<p><a href="https://example.com/report.pdf">Download PDF report</a></p>';
		expect(annotateFileLinks(html)).toBe(html);
	});

	it("handles multiple links in one HTML string", () => {
		const html =
			'<p><a href="https://example.com/a.pdf">Doc A</a> and <a href="https://example.com/b.xlsx">Doc B</a></p>';
		const result = annotateFileLinks(html);
		expect(result).toContain('Doc A <span class="praxity-file-type">(PDF)</span>');
		expect(result).toContain('Doc B <span class="praxity-file-type">(XLSX)</span>');
	});

	it("leaves non-file links untouched", () => {
		const html = '<p><a href="https://example.com">Visit site</a></p>';
		expect(annotateFileLinks(html)).toBe(html);
	});

	it("handles links with nested HTML (bold text)", () => {
		const html = '<p><a href="https://example.com/guide.pdf"><strong>User guide</strong></a></p>';
		const result = annotateFileLinks(html);
		expect(result).toContain('<span class="praxity-file-type">(PDF)</span>');
	});

	it("is case-insensitive for existing file type mentions", () => {
		const html = '<p><a href="https://example.com/file.pdf">Get the pdf</a></p>';
		expect(annotateFileLinks(html)).toBe(html);
	});
});
