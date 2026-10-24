import { readLesson } from "@praxity/grammar";
import type { PraxityPage } from "@praxity/shared-blocks";
import { JSDOM } from "jsdom";
import { assert, describe, expect, it } from "vitest";
import type { DesktopExportInput } from "../src/build";
import { type CourseConfig, generateHtmlPage } from "../src/html-gen";
import { compileDocument, compilePage } from "../src/preview/compile-page";
import {
	createCourseContext,
	createCourseContextFromHtml,
	refreshCourseContext,
} from "../src/preview/course-context";

const output = {
	islandAssets: {
		loaderFilename: "island-loader.js",
		islandFilenames: {
			nav: "island-nav.js",
			logic: "island-logic.js",
			deck: "deck.js",
			assessment: "assessment.js",
			assessmentGroup: "assessment-group.js",
		},
	},
};

const laterFoldedTitle =
	"---\nkicker: Module 1\ntime: About 12 minutes\n---\n# Lesson\nnav: Lesson\n::: group Other {level=1}\n::: choice Answer {scored}\n(x) Yes\n( ) No\n:::\n:::\n::: group Lesson {level=1}\n::: choice Answer {scored}\n(x) Yes\n( ) No\n:::\n:::\n";

function desktopInput(sources: string[], deck = false): DesktopExportInput {
	const blocks = sources.flatMap((source, index) => {
		const read = readLesson(source);
		expect(read.hasErrors).toBe(false);
		const boundary = read.blocks.find((block) => block.type === "pageBreak");
		assert(boundary);
		Object.assign(boundary.data, {
			lessonId: `lesson-${index + 1}`,
			lessonTitle: read.frontmatter.title ?? "Lesson",
			isFirstPageOfLesson: true,
			lessonKicker: read.frontmatter.kicker,
			lessonTime: read.frontmatter.time,
		});
		return read.blocks;
	});
	return {
		courseId: "course",
		blocks,
		frontmatter: { title: "Course", lang: "en" },
		config: { completionThreshold: 0.8, ...(deck ? { moduleDeck: {} } : {}) },
		resolvedAssets: new Map(),
		viewerVersion: "test",
		locale: "en",
	};
}

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
	it("prefers the marked page title over an earlier level-one body heading", async () => {
		const input = desktopInput([
			laterFoldedTitle.replace("::: group Other", "## Introduction {level=1}\n::: group Other"),
		]);
		const context = await createCourseContext({ ...input, htmlOutput: output });
		const doc = new JSDOM(compileDocument(context, context.documents[0].slug).html).window.document;
		expect(
			doc.querySelector("#main-content .praxity-kicker")?.nextElementSibling?.textContent,
		).toBe("Lesson");
	});
	it.each(["Pages", "deck"])(
		"decorates the later folded group once in %s flat-input output",
		async (presentation) => {
			const input = desktopInput([laterFoldedTitle], presentation === "deck");
			const groups = input.blocks.filter((block) => block.type === "assessmentGroup");
			groups[0].id = "other-group";
			groups[1].id = "lesson-group";
			const context = await createCourseContext({ ...input, htmlOutput: output });
			const html = compileDocument(context, context.documents[0].slug).html;
			const main = new JSDOM(html).window.document.querySelector("#main-content");
			assert(main);
			const other = main.querySelector("#assessment-group-title-other-group");
			const lesson = main.querySelector("#assessment-group-title-lesson-group");
			assert(other);
			assert(lesson);
			expect(other.textContent).toBe("Other");
			expect(
				other.parentElement?.querySelector(".praxity-kicker, .praxity-lesson-time"),
			).toBeNull();
			expect(lesson.textContent).toBe("Lesson");
			expect(lesson.previousElementSibling?.outerHTML).toBe(
				'<p class="praxity-kicker">Module 1</p>',
			);
			expect(lesson.nextElementSibling?.outerHTML).toBe(
				'<p class="praxity-lesson-time">About 12 minutes</p>',
			);
			expect(main.querySelectorAll(".praxity-kicker")).toHaveLength(1);
			expect(main.querySelectorAll(".praxity-lesson-time")).toHaveLength(1);
			expect(
				main
					.querySelector('[data-assessment-group-header="lesson-group"]')
					?.getAttribute("aria-labelledby"),
			).toBe("assessment-group-title-lesson-group assessment-group-progress-lesson-group");
			expect(
				context.pages[0].blocks
					.filter((block) => block.type === "assessmentGroup")
					.map((block) => block.data._foldedPageTitle),
			).toEqual([undefined, true]);
			expect(html).not.toContain("_foldedPageTitle");
		},
	);
	it.each(["true", 1])(
		"ignores a non-boolean folded-title mark %j in compiled input",
		async (mark) => {
			const input = desktopInput([laterFoldedTitle]);
			const other = input.blocks.find((block) => block.type === "assessmentGroup");
			assert(other);
			other.data._foldedPageTitle = mark;
			const context = await createCourseContext({ ...input, htmlOutput: output });
			const doc = new JSDOM(compileDocument(context, context.documents[0].slug).html).window
				.document;
			expect(
				doc.querySelector("#main-content .praxity-kicker")?.nextElementSibling?.textContent,
			).toBe("Lesson");
		},
	);
	it("keeps persisted component defaults from assigning the compiler's folded-title mark", async () => {
		const input = desktopInput([laterFoldedTitle]);
		input.frontmatter = readLesson(
			"---\ntitle: Course\ndesign:\n  componentDefaults:\n    assessment-group:\n      _foldedPageTitle: true\n---\n# Settings\n",
		).frontmatter;
		const context = await createCourseContext({ ...input, htmlOutput: output });
		expect(
			context.pages[0].blocks
				.filter((block) => block.type === "assessmentGroup")
				.map((block) => block.data._foldedPageTitle),
		).toEqual([undefined, true]);
		const doc = new JSDOM(compileDocument(context, context.documents[0].slug).html).window.document;
		expect(
			doc.querySelector("#main-content .praxity-kicker")?.nextElementSibling?.textContent,
		).toBe("Lesson");
	});
	it.each([
		["Pages", "plain"],
		["Pages", "nav"],
		["Pages", "formatted"],
		["deck", "plain"],
		["deck", "nav"],
		["deck", "formatted"],
	] as const)(
		"decorates a folded assessment-group title in %s output with a %s title through flat input",
		async (presentation, variant) => {
			const title = variant === "formatted" ? "**Quiz**" : "Quiz";
			const input = desktopInput(
				[
					`---\nkicker: Module 1\ntime: About 12 minutes\n${presentation === "Pages" ? "variables:\n  ready: false\n" : ""}---\n# ${title}\n${variant === "nav" ? "nav: Short\n" : ""}::: group ${title} {level=1}\n::: choice Answer {scored}\n(x) Yes\n( ) No\n:::\n:::\n`,
				],
				presentation === "deck",
			);
			const group = input.blocks.find((block) => block.type === "assessmentGroup");
			assert(group);
			group.id = "quiz-group";
			const context = await createCourseContext({ ...input, htmlOutput: output });
			const doc = new JSDOM(compileDocument(context, context.documents[0].slug).html).window
				.document;
			const heading = doc.querySelector("#assessment-group-title-quiz-group");
			assert(heading);
			expect(heading.tagName).toBe("H1");
			expect(heading.textContent).toBe("Quiz");
			expect(heading.previousElementSibling?.outerHTML).toBe(
				'<p class="praxity-kicker">Module 1</p>',
			);
			expect(heading.nextElementSibling?.outerHTML).toBe(
				'<p class="praxity-lesson-time">About 12 minutes</p>',
			);
			expect(
				doc
					.querySelector('[data-assessment-group-header="quiz-group"]')
					?.getAttribute("aria-labelledby"),
			).toBe("assessment-group-title-quiz-group assessment-group-progress-quiz-group");
			expect(doc.querySelector("#assessment-group-progress-quiz-group")?.textContent).toBe(
				"Questions completed: 0 of 1",
			);
		},
	);
	it.each([
		["single", "About 12 minutes"],
		["multiple", "2 pages · ~1 min"],
	] as const)(
		"keeps the correct sidebar duration for %s lessons after hiding a first page",
		async (kind, expected) => {
			const sources = [
				"---\ntime: About 12 minutes\n---\n# Hidden {hide}\nBody\n# Content\nBody\n",
			];
			if (kind === "multiple")
				sources.push("---\ntime: About 25 minutes\n---\n# Other lesson\nBody\n");
			const context = await createCourseContext({ ...desktopInput(sources), htmlOutput: output });
			expect(context.pages.map((page) => page.lessonId)).toEqual(
				kind === "single" ? ["lesson-1"] : ["lesson-1", "lesson-2"],
			);
			expect(context.pages[0].isFirstPageOfLesson).toBe(false);
			for (const document of context.documents) {
				const doc = new JSDOM(compileDocument(context, document.slug).html).window.document;
				expect(doc.querySelector(".praxity-native-sidebar-meta")?.textContent).toBe(expected);
			}
		},
	);
	it.each([0, 1])("shows authored single-lesson time in the sidebar on page %s", (index) => {
		const pages = lessonPages({ lessonTime: "About 12 minutes, including the lab" });
		expect(document(pages, index).querySelector(".praxity-native-sidebar-meta")?.textContent).toBe(
			"2 pages · About 12 minutes, including the lab",
		);
	});
	it("keeps an explicit course duration ahead of authored lesson time", () => {
		expect(
			document(lessonPages({ lessonTime: "About 12 minutes" }), 0, {
				estimatedDuration: "About 20 minutes",
			}).querySelector(".praxity-native-sidebar-meta")?.textContent,
		).toBe("2 pages · About 20 minutes");
	});
	it("keeps computed duration without authored time or across multiple lessons", () => {
		expect(
			document(lessonPages(), 0).querySelector(".praxity-native-sidebar-meta")?.textContent,
		).toBe("2 pages · ~1 min");
		const pages = lessonPages({ lessonTime: "About 12 minutes" });
		pages[1] = { ...pages[1], lessonId: "lesson-2", isFirstPageOfLesson: true };
		expect(document(pages, 0).querySelector(".praxity-native-sidebar-meta")?.textContent).toBe(
			"2 pages · ~1 min",
		);
	});
	it("uses the shared spacing wrapper when time is the only lesson line", () => {
		expect(
			document(lessonPages({ lessonTime: "About 12 minutes" }), 0).querySelector("#main-content h1")
				?.parentElement?.className,
		).toBe("praxity-heading-with-kicker");
	});
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
		const doc = document(lessonPages({ lessonKicker: text, lessonTime: text }), 0);
		const main = doc.querySelector("#main-content");
		assert(main);
		expect(main.querySelector(".praxity-kicker")?.textContent).toBe(text);
		expect(main.querySelector(".praxity-lesson-time")?.textContent).toBe(text);
		expect(main.querySelector("img")).toBeNull();
		expect(doc.querySelector(".praxity-native-sidebar-meta")?.textContent).toBe(
			'2 pages · MODULE <img src=x onerror="alert(1)"> & "time"',
		);
		expect(doc.querySelector(".praxity-native-sidebar-meta img")).toBeNull();
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
		).toBeUndefined();
		expect(document(pages, 0).querySelector("#main-content .praxity-kicker")).toBeNull();
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
