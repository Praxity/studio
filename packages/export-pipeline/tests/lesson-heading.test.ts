import { readLesson } from "@praxity/grammar";
import type { PraxityPage } from "@praxity/shared-blocks";
import { JSDOM } from "jsdom";
import { assert, describe, expect, it } from "vitest";
import { type CourseConfig, generateHtmlPage } from "../src/html-gen";
import { compilePage } from "../src/preview/compile-page";
import { createCourseContextFromHtml, refreshCourseContext } from "../src/preview/course-context";

const output = {
	islandAssets: {
		loaderFilename: "island-loader.js",
		islandFilenames: { nav: "island-nav.js", logic: "island-logic.js" },
	},
};

function lessonPages(metadata: Partial<PraxityPage> = {}): PraxityPage[] {
	return readLesson("# First\nBody\n# Next\nMore\n").pages.map((page, index) => ({
		...page,
		lessonId: "lesson-1",
		isFirstPageOfLesson: index === 0,
		...metadata,
	}));
}

function config(pages: PraxityPage[]): CourseConfig {
	return {
		id: "course",
		title: "Course",
		sourceLocale: "en",
		pages,
		totalPages: pages.length,
		navigationStyle: "sidebar",
	};
}

function document(pages: PraxityPage[], index: number, overrides: Partial<CourseConfig> = {}) {
	return new JSDOM(
		generateHtmlPage({
			...output,
			config: { ...config(pages), ...overrides },
			page: pages[index],
			index,
			currentSlug: `page-${index + 1}`,
			slugList: pages.map((page, i) => ({
				pageId: page.id,
				title: page.title,
				slug: `page-${i + 1}`,
			})),
			slugMap: new Map(pages.map((page, i) => [page.id, `page-${i + 1}`])),
		}),
	).window.document;
}

describe("lesson heading metadata", () => {
	it.each(["single", "multi"])("renders first-page lines in a %s-lesson course", (kind) => {
		const pages = lessonPages({
			lessonKicker: "Module 1",
			lessonTime: "About 12 minutes, including the lab",
		});
		if (kind === "multi")
			pages.push(
				...lessonPages({
					lessonId: "lesson-2",
					lessonKicker: "Module 2",
					lessonTime: "Environ 8 minutes",
				}).map((page) => ({ ...page, id: `second-${page.id}` })),
			);
		for (let index = 0; index < pages.length; index++) {
			const main = document(pages, index).querySelector("#main-content");
			assert(main);
			const heading = main.querySelector("h1");
			assert(heading);
			expect(heading.textContent).toBe(index % 2 === 0 ? "First" : "Next");
			expect(heading.hasAttribute("aria-describedby")).toBe(false);
			if (index % 2 === 0) {
				expect(heading.previousElementSibling?.className).toBe("praxity-kicker");
				expect(heading.previousElementSibling?.textContent).toBe(
					index === 0 ? "Module 1" : "Module 2",
				);
				expect(heading.nextElementSibling?.className).toBe("praxity-lesson-time");
				expect(heading.nextElementSibling?.textContent).toBe(
					index === 0 ? "About 12 minutes, including the lab" : "Environ 8 minutes",
				);
			} else expect(main.querySelectorAll(".praxity-kicker, .praxity-lesson-time")).toHaveLength(0);
		}
	});
	it("omits absent and blank lesson fields", () => {
		for (const metadata of [{}, { lessonKicker: "  ", lessonTime: "  " }])
			expect(
				document(lessonPages(metadata), 0).querySelectorAll(
					"#main-content .praxity-kicker, .praxity-lesson-time",
				),
			).toHaveLength(0);
	});
	it("escapes author text without interpreting markup or changing casing", () => {
		const text = 'MODULE <img src=x onerror="alert(1)"> & "time"';
		const main = document(lessonPages({ lessonKicker: text, lessonTime: text }), 0).querySelector(
			"#main-content",
		);
		assert(main);
		expect(main.querySelector(".praxity-kicker")?.textContent).toBe(text);
		expect(main.querySelector(".praxity-lesson-time")?.textContent).toBe(text);
		expect(main.querySelector("img")).toBeNull();
	});
	it.each([
		["paper", "var(--praxity-color-text-light)"],
		["surface", "var(--praxity-color-text-light)"],
		["accent", "var(--praxity-color-accent-foreground)"],
		["ink", "var(--praxity-color-background)"],
	] as const)("applies the readable label colour on %s slides", (background, expected) => {
		const pages = lessonPages({
			lessonKicker: "Module 1",
			lessonTime: "About 12 minutes",
			data: { style: "custom" },
		});
		const doc = document(pages, 0, {
			navigationStyle: "slides",
			slideStyles: { custom: { background } },
		});
		expect(
			doc.querySelector<HTMLElement>(".praxity-slide")?.style.getPropertyValue("--slide-muted"),
		).toBe(expected);
		expect(doc.querySelector("#main-content h1")?.nextElementSibling?.textContent).toBe(
			"About 12 minutes",
		);
	});
	it("uses the lesson kicker once on the first h1 and preserves other heading kickers", () => {
		const pages = lessonPages({ lessonKicker: "Module 1", lessonTime: "About 12 minutes" });
		pages[0].blocks[0].data.kicker = "Module 1";
		pages[1].blocks[0].data.kicker = "Page group";
		expect(document(pages, 0).querySelectorAll("#main-content .praxity-kicker")).toHaveLength(1);
		pages[0].blocks[0].data.kicker = "Heading group";
		expect(document(pages, 0).querySelector("#main-content .praxity-kicker")?.textContent).toBe(
			"Module 1",
		);
		expect(document(pages, 1).querySelector("#main-content .praxity-kicker")?.textContent).toBe(
			"Page group",
		);
		delete pages[0].lessonKicker;
		expect(document(pages, 0).querySelector("#main-content .praxity-kicker")?.textContent).toBe(
			"Heading group",
		);
	});
	it("keeps lesson lines beside a chapter heading", () => {
		const pages = lessonPages({ lessonKicker: "Module 1", lessonTime: "About 12 minutes" });
		pages[0].blocks[0].data.display = "chapter";
		const heading = document(pages, 0).querySelector("#main-content h1");
		assert(heading);
		expect(heading.previousElementSibling?.textContent).toBe("Module 1");
		expect(heading.nextElementSibling?.textContent).toBe("About 12 minutes");
		delete pages[0].lessonKicker;
		pages[0].blocks[0].data.kicker = "Heading group";
		expect(
			document(pages, 0).querySelector("#main-content h1")?.previousElementSibling?.textContent,
		).toBe("Heading group");
	});
	it("decorates only the page title when another heading uses level one", () => {
		const pages = lessonPages({ lessonKicker: "Module 1", lessonTime: "About 12 minutes" });
		pages[0].blocks.push({
			id: "other-heading",
			type: "heading",
			data: { level: 1, content: "Another heading", kicker: "Heading group" },
		});
		const main = document(pages, 0).querySelector("#main-content");
		assert(main);
		expect([...main.querySelectorAll(".praxity-kicker")].map((node) => node.textContent)).toEqual([
			"Module 1",
			"Heading group",
		]);
		expect(main.querySelectorAll(".praxity-lesson-time")).toHaveLength(1);
	});
	it("omits lesson lines when the page title is hidden", () => {
		const page = readLesson("# First {hideTitle}\nBody\n").pages[0];
		const main = document(
			[
				{
					...page,
					isFirstPageOfLesson: true,
					lessonKicker: "Module 1",
					lessonTime: "About 12 minutes",
				},
			],
			0,
		).querySelector("#main-content");
		assert(main);
		expect(main.querySelector("h1")).toBeNull();
		expect(main.querySelector(".praxity-kicker, .praxity-lesson-time")).toBeNull();
	});
	it("refreshes the shared compiler output used by Read, review and canvas", async () => {
		const course = config(
			lessonPages({ lessonKicker: "Module 1", lessonTime: "About 12 minutes" }),
		);
		const context = await createCourseContextFromHtml(course, output);
		expect(compilePage(context, course.pages[0].id).html).toContain(
			'<p class="praxity-lesson-time">About 12 minutes</p>',
		);
		const pages = course.pages.map((page) => ({
			...page,
			lessonKicker: "Module 2",
			lessonTime: "About 8 minutes",
		}));
		const next = await refreshCourseContext(
			context,
			{
				id: course.id,
				title: course.title,
				sourceLocale: "en",
				navigationStyle: "sidebar",
				content: pages,
			},
			{},
		);
		const html = compilePage(next, pages[0].id).html;
		expect(html).toContain('<p class="praxity-kicker">Module 2</p>');
		expect(html).toContain('<p class="praxity-lesson-time">About 8 minutes</p>');
		expect(html).not.toContain("About 12 minutes");
	});
});
