import { readLesson } from "@praxity/grammar";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { type CourseConfig, generateHtmlPage } from "../src/html-gen";

function extractFirstBlockData(html: string): Record<string, unknown> {
	const configMatch = html.match(
		/<script id="praxity-config" type="application\/json">([\s\S]*?)<\/script>/,
	);
	if (!configMatch?.[1]) throw new Error("No praxity-config JSON found");
	const parsed = JSON.parse(configMatch[1]) as {
		blocks?: Array<{ data?: Record<string, unknown> }>;
	};
	return parsed.blocks?.[0]?.data ?? {};
}

function renderHtml(page: PraxityPage, configOverrides?: Partial<CourseConfig>): string {
	const config: CourseConfig = {
		id: "course-1",
		title: "Course",
		sourceLocale: "en",
		pages: [page],
		totalPages: 1,
		navigationStyle: "slides",
		...configOverrides,
	};
	return generateHtmlPage({
		config,
		page,
		index: 0,
		currentSlug: "page-1",
		slugList: [{ pageId: page.id, slug: "page-1", title: page.title }],
		slugMap: new Map([[page.id, "page-1"]]),
		islandAssets: {
			loaderFilename: "island-loader.js",
			islandFilenames: { nav: "island-nav.js", logic: "island-logic.js" },
		},
	});
}

function heroBlock(title: string): PraxityBlock {
	return {
		id: "hero-1",
		type: "heroCover",
		data: {
			imageSrc: "",
			imageAlt: "",
			title,
			overlayOpacity: 0.5,
			alignment: "center",
		},
	};
}

describe("html-gen hero heading", () => {
	it("keeps the authored hero as the only primary heading", () => {
		const page: PraxityPage = {
			id: "p1",
			title: "Page title",
			blocks: [heroBlock("Hero heading")],
		};

		const html = renderHtml(page, { showLessonNameAsTitle: true });
		const blockData = extractFirstBlockData(html);

		expect(html).not.toContain("praxity-page-title");
		expect(html).not.toContain("praxity-lesson-title");
		expect(blockData.headingOffset).toBeUndefined();
	});

	it("does not inject a course or lesson title before a hero", () => {
		const page: PraxityPage = {
			id: "p1",
			title: "Page title",
			lessonTitle: "Lesson title",
			isFirstPageOfLesson: true,
			blocks: [heroBlock("Hero heading")],
		};

		const html = renderHtml(page, { showLessonNameAsTitle: true });
		const blockData = extractFirstBlockData(html);

		expect(html).not.toContain("praxity-page-title");
		expect(html).not.toContain("praxity-lesson-title");
		expect(blockData.headingOffset).toBeUndefined();
	});
});

it("publishes relocated variables after the title without changing the older-logic reading order", () => {
	const lesson = readLesson(
		"---\nvariables:\n  passedQuiz: false\n---\n# Hazard response\nShow remediation if the learner has not passed.\n::: rule\nif: passedQuiz is false\nthen: show @remediation\n:::\n",
	);
	expect(lesson.hasErrors).toBe(false);
	const document = new JSDOM(renderHtml(lesson.pages[0])).window.document;
	const blocks = [...document.querySelectorAll("#main-content [data-block-type]")];
	expect(blocks.map((block) => block.getAttribute("data-block-type"))).toEqual([
		"heading",
		"variable",
		"text",
		"logic",
	]);
	expect(document.querySelectorAll("#main-content h1")).toHaveLength(1);
	expect(blocks[0].querySelector("h1")?.textContent).toBe("Hazard response");
	expect(blocks[2].textContent).toBe("Show remediation if the learner has not passed.");
	for (const index of [1, 3]) {
		expect(blocks[index].hasAttribute("hidden")).toBe(true);
		expect(blocks[index].getAttribute("data-island")).toBe("logic");
		expect(blocks[index].innerHTML).toBe("");
	}
});
