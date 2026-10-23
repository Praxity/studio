import { readLesson as readBlockSource } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { type CourseConfig, generateHtmlPage } from "../html-gen";

it("emits static footnote HTML and the same prepared blocks for islands", () => {
	const blocks = adaptGrammarPreviewBlocks(
		readBlockSource(
			"# Untitled {hideTitle}\n\nText @source{Source one}.\n\n::: accordion\n:: Sources {level=3}\n@sources\n:::\n\nMore @source{Source two}.\n",
		).blocks,
	);
	const page = { id: "page", title: "Sources", blocks };
	const config: CourseConfig = {
		id: "footnotes",
		title: "Footnotes",
		sourceLocale: "en",
		pages: [page],
		totalPages: 1,
	};
	const doc = new JSDOM(
		generateHtmlPage({
			config,
			page,
			index: 0,
			currentSlug: "sources",
			slugList: [{ pageId: "page", slug: "sources", title: "Sources" }],
			slugMap: new Map([["page", "sources"]]),
			islandAssets: {
				loaderFilename: "loader.js",
				islandFilenames: { nav: "nav.js", accordion: "accordion.js" },
			},
		}),
	).window.document;
	expect(doc.querySelectorAll(".praxity-footnote-ref")).toHaveLength(2);
	expect(doc.querySelectorAll("ol.praxity-footnotes")).toHaveLength(1);
	expect(
		doc.querySelector("ol.praxity-footnotes")?.closest(".praxity-block-accordion"),
	).not.toBeNull();
	expect(doc.querySelector("#praxity-config")?.textContent).not.toContain("data-footer-content");
	expect(JSON.stringify(blocks)).toContain("data-footer-content");
});
