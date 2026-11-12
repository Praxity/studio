import { readLesson } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { type CourseConfig, generateHtmlPage } from "../html-gen";
import { renderBlockHtml } from "../render-block-html";
import { generateResourcesPageHtml } from "../resources-page";

// Course text can come from imported material or an agent, and SCORM content may run on the
// LMS origin, so learner pages must never carry a URL that runs script or markup from text.
function renderPage(source: string, title = "Page") {
	const blocks = adaptGrammarPreviewBlocks(readLesson(source).blocks);
	const page = { id: "page", title, blocks };
	const config: CourseConfig = {
		id: "course",
		title,
		sourceLocale: "en",
		pages: [page],
		totalPages: 1,
	};
	const html = generateHtmlPage({
		config,
		page,
		index: 0,
		currentSlug: "page",
		slugList: [{ pageId: "page", slug: "page", title }],
		slugMap: new Map([["page", "page"]]),
		islandAssets: {
			loaderFilename: "loader.js",
			islandFilenames: {
				nav: "nav.js",
				assessment: "assessment.js",
				assessmentGroup: "assessment-group.js",
				narration: "narration.js",
			},
		},
	});
	return { html, doc: new JSDOM(html).window.document };
}

const URL_ATTRIBUTES = ["href", "src", "poster", "cite", "action", "formaction", "data"];
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const RASTER_IMAGE_DATA = /^data:image\/(?!svg\+xml)/i;

/** Every URL attribute that resolves to an unsafe scheme, or to a data: URL other than a raster image source. */
function unsafeUrls(doc: Document): string[] {
	return [...doc.querySelectorAll("*")].flatMap((element) =>
		URL_ATTRIBUTES.flatMap((name) => {
			const value = element.getAttribute(name);
			if (value === null) return [];
			const url = new URL(value, "https://course.example/page.html");
			const safe =
				SAFE_PROTOCOLS.has(url.protocol) ||
				(url.protocol === "data:" && name !== "href" && RASTER_IMAGE_DATA.test(url.href));
			return safe ? [] : [`${element.tagName} ${name}=${value}`];
		}),
	);
}

describe("URLs from course source", () => {
	it.each([
		[
			"a button link with a leading control character",
			"::: button [Go](\u0001javascript:alert(1))\n:::",
		],
		["an audio source with an embedded tab", "::: audio java\tscript:alert(1)\n:::"],
		[
			"an audio source with a leading control character",
			"::: audio \u0001javascript:alert(1)\n:::",
		],
		[
			"a quote citation with a javascript: URL",
			'::: quote {source="javascript:alert(1)"}\nWords\nspeaker: Someone\n:::',
		],
	])("never ship an executable URL: %s", (_name, body) => {
		const { doc } = renderPage(`# Links\n\nIntro.\n\n${body}\n`);
		expect(unsafeUrls(doc)).toEqual([]);
	});

	it.each([
		"javascript:alert(1)",
		"\u0001javascript:alert(1)",
		"java\tscript:alert(1)",
		" vbscript:x",
		"data:text/html,<script>alert(1)</script>",
	])("omit a quote citation that is not http or https: %j", (sourceUrl) => {
		const html = renderBlockHtml({
			id: "q",
			type: "quote",
			data: { text: "Words", speaker: "Someone", work: "Book", sourceUrl },
		} as unknown as PraxityBlock);
		expect(html).not.toContain("href=");
		expect(html).not.toContain("cite=");
		expect(html).toContain("<cite>Book</cite>");
	});

	it("keeps safe button links exactly as authored", () => {
		const { doc } = renderPage(
			"# Links\n\n::: button [Mail](mailto:a@example.org)\n:::\n\n::: button [Site](https://example.org/a?b=1#c)\n:::\n\n::: button [Doc](/assets/guide.pdf)\n:::\n",
		);
		expect(
			[...doc.querySelectorAll("a.praxity-button")].map((a) => a.getAttribute("href")),
		).toEqual(["mailto:a@example.org", "https://example.org/a?b=1#c", "/assets/guide.pdf"]);
	});
});

describe("question stems in a one-of group picker", () => {
	const source = [
		"# Quiz",
		"",
		"::: group Check {mode=oneOf}",
		"button: Submit answers",
		"::: choice Plain <img src=y onerror=alert(2)> text",
		"(x) Yes",
		"( ) No",
		":::",
		"::: choice Is a<b true?",
		"(x) Yes",
		"( ) No",
		":::",
		":::",
		"",
	].join("\n");

	it("show as text and never become markup", () => {
		const { doc } = renderPage(source);
		const labels = [...doc.querySelectorAll(".praxity-ag-radio-label")];
		expect(labels.map((label) => label.textContent)).toEqual([
			"Plain <img src=y onerror=alert(2)> text",
			"Is a<b true?",
		]);
		expect(labels.every((label) => label.children.length === 0)).toBe(true);
		expect(doc.querySelectorAll("img[onerror], [onerror]")).toHaveLength(0);
	});
});

describe("inline JSON configuration", () => {
	it("survives a title that opens an HTML comment and a script tag", () => {
		const title = "Comments: <!--<script> in HTML";
		const { html, doc } = renderPage(`# ${title}\n\nBody text that should be visible.\n`, title);
		expect(doc.body.textContent).toContain("Body text that should be visible.");
		expect(doc.querySelector(".praxity-text")).not.toBeNull();
		const scripts = [...doc.querySelectorAll('script[type="application/json"]')];
		expect(scripts.map((script) => script.id)).toEqual(expect.arrayContaining(["praxity-config"]));
		for (const script of scripts) {
			expect(script.textContent).not.toMatch(/[<>&]/);
			expect(() => JSON.parse(script.textContent ?? "")).not.toThrow();
		}
		const config = JSON.parse(doc.getElementById("praxity-config")?.textContent ?? "");
		expect(config.pageTitle).toBe(title);
		expect(config.courseTitle).toBe(title);
		expect(html).not.toContain("<!--<script>");
	});
});

// Grammar 4 produces neither block nor the resources page, but imported block data can.
describe("hidden renderers that take block data", () => {
	const hostile = ["\u0001javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,x"];
	const render = (html: string) => new JSDOM(`<body>${html}</body>`).window.document;

	it.each(hostile)("omit a document link to %j", (url) => {
		const html = renderBlockHtml({
			id: "d",
			type: "document",
			data: { url, title: "Guide" },
		} as unknown as PraxityBlock);
		expect(render(html).querySelector("a, [href]")).toBeNull();
	});

	it("keep a safe document link", () => {
		const doc = render(
			renderBlockHtml({
				id: "d",
				type: "document",
				data: { url: "https://example.org/guide.pdf", title: "Guide" },
			} as unknown as PraxityBlock),
		);
		expect(doc.querySelector("a")?.getAttribute("href")).toBe("https://example.org/guide.pdf");
	});

	it.each(hostile)("neutralize a resources page link to %j", (url) => {
		const doc = render(
			generateResourcesPageHtml({
				courseTitle: "Course",
				entries: [
					{ title: "Bad", description: "", url, resourceType: "link" },
					{ title: "Good", description: "", url: "/assets/a.pdf", resourceType: "file" },
				],
			}),
		);
		expect(unsafeUrls(doc)).toEqual([]);
		expect([...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(
			expect.arrayContaining(["#", "/assets/a.pdf"]),
		);
	});

	it("escape a resource entry's screen-reader title", () => {
		const doc = render(
			renderBlockHtml({
				id: "r",
				type: "resourceEntry",
				data: {
					includeInResourcesPage: true,
					resourceType: "link",
					url: "https://example.org/",
					title: "<code>&lt;img src=x onerror=alert(1)&gt;</code>",
				},
			} as unknown as PraxityBlock),
		);
		expect(doc.querySelectorAll("[onerror]")).toHaveLength(0);
		expect(doc.querySelector(".praxity-sr-only")?.textContent).toBe(
			": <img src=x onerror=alert(1)>",
		);
	});
});
