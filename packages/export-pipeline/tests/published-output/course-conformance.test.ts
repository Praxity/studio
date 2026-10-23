import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { type CourseConfig, generateHtmlPage } from "../../src/html-gen";
import { renderBlockHtml } from "../../src/render-block-html";

describe("published code scroll regions", () => {
	for (const locale of ["en", "fr"] as const) {
		for (const title of ["", 'Example <script> & "quoted"']) {
			it(`names the keyboard scroll target in ${locale}, title ${JSON.stringify(title)}`, () => {
				const document = new JSDOM(
					renderBlockHtml(
						{
							id: "code",
							type: "code",
							data: { language: "javascript", code: "const answer = 42;", title },
						},
						{ strings: getStrings(locale) },
					),
				).window.document;
				const pre = document.querySelector("pre");
				expect(pre?.getAttribute("tabindex")).toBe("0");
				expect(pre?.getAttribute("role")).toBe("region");
				expect(pre?.getAttribute("aria-label")).toBe(`Code ${title || "JavaScript"}`);
				expect(pre?.classList.contains("praxity-code-pre")).toBe(true);
				expect(pre?.hasAttribute("style")).toBe(false);
				expect(pre?.querySelector("code")?.textContent).toContain("const answer = 42;");
				expect(document.querySelector("script")).toBeNull();
			});
		}
	}
});

describe("published slide position landmark", () => {
	for (const [navPrevNext, navTopBar] of [
		[true, true],
		[true, false],
		[false, true],
		[false, false],
	]) {
		it(`keeps one counter banner with navigation ${navPrevNext}, top bar ${navTopBar}`, () => {
			const pages: PraxityPage[] = [
				{ id: "intro", title: "Introduction", blocks: [] },
				{ id: "summary", title: "Summary", blocks: [] },
			];
			const config: CourseConfig = {
				id: "course",
				title: "Course",
				sourceLocale: "en",
				pages,
				totalPages: 2,
				navigationStyle: "slides",
				navToggles: { navSlideCounter: true, navPrevNext, navTopBar },
			};
			const document = new JSDOM(
				generateHtmlPage({
					config,
					page: pages[1],
					index: 1,
					currentSlug: "summary",
					slugList: pages.map((page) => ({ pageId: page.id, slug: page.id, title: page.title })),
					slugMap: new Map(pages.map((page) => [page.id, page.id])),
					islandAssets: {
						loaderFilename: "island-loader.js",
						islandFilenames: { nav: "island-nav.js" },
					},
				}),
			).window.document;
			const position = document.querySelector(".praxity-slide-counter .praxity-a11y-sr-only");
			expect(position?.textContent).toBe("Page 2 of 2");
			expect(position?.closest("header, [role='banner']")).not.toBeNull();
			expect(document.querySelectorAll("header, [role='banner']")).toHaveLength(1);
		});
	}
});
