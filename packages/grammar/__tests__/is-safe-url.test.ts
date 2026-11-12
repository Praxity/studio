import { readFileSync } from "node:fs";
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
	const catalogs = Object.fromEntries(
		["en", "fr"].map((locale) => [
			locale,
			JSON.parse(
				readFileSync(
					new URL(`../../editor-core/src/messages/${locale}.json`, import.meta.url),
					"utf8",
				),
			).op.diagnostic as Record<string, string>,
		]),
	);
	const read = (source: string) => readLesson(`# T\n\n${source}\n`).diagnostics;
	const codes = (source: string) => read(source).map((d) => `${d.code}/${d.severity}`);

	it.each([
		["![x](data:image/svg+xml,%3Csvg%20onload%3Dalert(1)%3E)", "svg-data-url"],
		["![x](javascript:alert(1))", "unsafe-media-url"],
		["![x](\u0001javascript:alert(1))", "unsafe-media-url"],
		["::: audio data:audio/mp3;base64,AAAA\n:::", "unsafe-media-url"],
		["::: video javascript:alert(1)\n:::", "unsafe-media-url"],
		["::: button [Go](javascript:alert(1))\n:::", "unsafe-link-url"],
		["::: bookmark [Go](data:image/png;base64,AAAA)\n:::", "unsafe-link-url"],
		['::: quote {source="javascript:alert(1)"}\nWords\n:::', "unsafe-link-url"],
	])("names why %j is refused", (source, code) => {
		const [diagnostic, ...rest] = read(source);
		expect(rest).toEqual([]);
		expect(diagnostic).toMatchObject({ code, severity: "error", line: 3 });
		// The refused URL is never echoed back.
		expect(JSON.stringify(diagnostic.message.args)).not.toMatch(/alert|AAAA|svg/);
	});

	it("explains a refused SVG data: image in English and French", () => {
		expect(catalogs.en["svg-data-url"]).toBe(
			"SVG can’t be embedded as a data: URL because it can carry scripts. Use an image file in the project’s assets folder, or a PNG or JPEG data: URL.",
		);
		expect(catalogs.fr["svg-data-url"]).toBe(
			"Une image SVG ne peut pas être intégrée comme URL data:, car elle peut contenir des scripts. Utilisez un fichier image du dossier assets du projet, ou une URL data: PNG ou JPEG.",
		);
	});

	it("names the allowed forms for a refused javascript: image and link in English and French", () => {
		expect(catalogs.en["unsafe-media-url"]).toBe(
			"This media address isn’t allowed. Use a project file path, or an https: or http: address.",
		);
		expect(catalogs.fr["unsafe-media-url"]).toBe(
			"Cette adresse de média n’est pas autorisée. Utilisez le chemin d’un fichier du projet, ou une adresse https: ou http:.",
		);
		expect(catalogs.en["unsafe-link-url"]).toBe(
			"This link address isn’t allowed. Use a project file path, or an https:, http:, mailto: or tel: address.",
		);
		expect(catalogs.fr["unsafe-link-url"]).toBe(
			"Cette adresse de lien n’est pas autorisée. Utilisez le chemin d’un fichier du projet, ou une adresse https:, http:, mailto: ou tel:.",
		);
	});

	it("keeps the general message for an empty image source", () => {
		expect(codes("![x]()")).toEqual(["bad-subject/error"]);
	});

	it.each([
		"![x](/assets/a.png)",
		"![x](data:image/png;base64,AAAA)",
		"::: button [Go](https://example.org/)\n:::",
		"::: button [Write](mailto:a@example.org)\n:::",
		'::: quote {source="https://example.org/"}\nWords\n:::',
	])("accepts %j", (source) => {
		expect(codes(source)).toEqual([]);
	});
});
