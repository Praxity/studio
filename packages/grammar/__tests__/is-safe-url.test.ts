import { describe, expect, it } from "vitest";
import { readLesson } from "../src/index.ts";
import { isSafeMediaUrl, isSafeUrl } from "../src/utils.ts";

describe("isSafeUrl", () => {
	it.each([
		"https://example.org/a?b=1#c",
		"HTTP://example.org/",
		" http://example.org/ ",
		"mailto:a@example.org",
		"tel:+15551234567",
		"#page",
		"",
		"   ",
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

	it("takes linear time on long whitespace runs", () => {
		const run = " ".repeat(100_000);
		const started = performance.now();
		expect(isSafeUrl(`a${run}b`)).toBe(true);
		expect(isSafeUrl(`${run}javascript:x${run}`)).toBe(false);
		expect(isSafeMediaUrl(`/a.png${run}b`)).toBe(true);
		expect(performance.now() - started).toBeLessThan(100);
	});
});

describe("isSafeMediaUrl", () => {
	it.each([
		"/assets/a.mp3",
		"https://example.org/a.mp4",
		"tel:+15551234567",
		"mailto:a@example.org",
		"data:image/png;base64,AAAA",
		" \u0001DATA:image/JPEG;base64,AAAA",
		"data:image/webp;base64,AAAA",
	])("accepts %j", (url) => {
		expect(isSafeMediaUrl(url)).toBe(true);
	});

	it.each([
		"\u0001javascript:alert(1)",
		"java\tscript:alert(1)",
		"blob:x",
		"data:text/html,x",
		"\u0000data:text/html,x",
		"da\nta:text/html,x",
		"data:audio/mp3;base64,AAAA",
		"data:image/svg+xml,<svg/>",
		"data:image/svg\t+xml,<svg/>",
		"vbscript:x",
	])("refuses %j", (url) => {
		expect(isSafeMediaUrl(url)).toBe(false);
	});
});

describe("URLs in lesson source", () => {
	const diagnostics = (source: string) =>
		readLesson(`# T\n\n${source}\n`).diagnostics.map((d) => `${d.code}/${d.severity}`);

	it.each([
		"![x](javascript:alert(1))",
		"![x](\u0001javascript:alert(1))",
		"![x](data:image/svg+xml,x)",
		"::: audio data:audio/mp3;base64,AAAA\n:::",
		"::: button [Go](data:image/png;base64,AAAA)\n:::",
	])("refuses %j", (source) => {
		expect(diagnostics(source)).toEqual(["bad-subject/error"]);
	});

	it("refuses a quote source that is a data: URL", () => {
		expect(diagnostics('::: quote {source="data:image/png;base64,AAAA"}\nWords\n:::')).toEqual([
			"bad-setting-value/error",
		]);
	});

	it.each([
		"![x](/assets/a.png)",
		"![x](data:image/png;base64,AAAA)",
		"::: button [Go](https://example.org/)\n:::",
		'::: quote {source="https://example.org/"}\nWords\n:::',
	])("accepts %j", (source) => {
		expect(diagnostics(source)).toEqual([]);
	});
});
