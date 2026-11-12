import { describe, expect, it } from "vitest";
import { isSafeMediaUrl, isSafeUrl } from "../src/utils.ts";

const RASTER_IMAGE = /^data:image\/(?!svg\+xml)/i;

describe("isSafeUrl", () => {
	it.each([
		"https://example.org/a?b=1#c",
		"HTTP://example.org/",
		" http://example.org/ ",
		"mailto:a@example.org",
		"tel:+15551234567",
		"#page",
		"",
		"?query=1",
		"/assets/guide.pdf",
		"./page-2.html",
		"../media/a.png",
		"assets/a.png",
		"//cdn.example.org/a.png",
		"page.html#x:y",
		"jav&#x61;script:bad()",
		"https://example.org/a(b)",
		"\u0001https://example.org/",
	])("accepts %j", (url) => {
		expect(isSafeUrl(url)).toBe(true);
	});

	const controls = Array.from({ length: 0x21 }, (_, code) => String.fromCharCode(code));
	it.each(controls.map((c) => [c.charCodeAt(0).toString(16).padStart(4, "0"), c]))(
		"refuses javascript: after a leading U+%s",
		(_code, c) => {
			expect(isSafeUrl(`${c}javascript:alert(1)`)).toBe(false);
			expect(isSafeUrl(`${c}${c}JaVaScRiPt:alert(1)${c}`)).toBe(false);
		},
	);

	it.each([
		"javascript:alert(1)",
		"java\tscript:alert(1)",
		"java\nscript:alert(1)",
		"java\rscript:alert(1)",
		"\tjava\nscr\ript:alert(1)",
		"vbscript:x",
		"VBSCRIPT:x",
		"vb\tscript:x",
		"blob:https://example.org/id",
		"file:///etc/passwd",
		"about:blank",
		"ftp://example.org/",
		"data:image/png;base64,AAAA",
		"data:text/html,<script>alert(1)</script>",
	])("refuses %j", (url) => {
		expect(isSafeUrl(url)).toBe(false);
	});

	it("admits data: only when the caller's pattern matches the normalized URL", () => {
		expect(isSafeUrl("data:image/png;base64,AAAA", RASTER_IMAGE)).toBe(true);
		expect(isSafeUrl(" \u0001DATA:image/JPEG;base64,AAAA", RASTER_IMAGE)).toBe(true);
		expect(isSafeUrl("data:image/svg+xml,<svg/>", RASTER_IMAGE)).toBe(false);
		expect(isSafeUrl("data:image/svg\t+xml,<svg/>", RASTER_IMAGE)).toBe(false);
		expect(isSafeUrl("da\nta:text/html,x", RASTER_IMAGE)).toBe(false);
	});
});

describe("isSafeMediaUrl", () => {
	it.each([
		"/assets/a.mp3",
		"https://example.org/a.mp4",
		"data:audio/mp3;base64,AAAA",
		"data:image/svg+xml,<svg/>",
		"tel:+15551234567",
		"mailto:a@example.org",
	])("accepts %j", (url) => {
		expect(isSafeMediaUrl(url)).toBe(true);
	});

	it.each([
		"\u0001javascript:alert(1)",
		"java\tscript:alert(1)",
		"blob:x",
		"data:text/html,x",
		"\u0000data:text/html,x",
		"vbscript:x",
	])("refuses %j", (url) => {
		expect(isSafeMediaUrl(url)).toBe(false);
	});
});
