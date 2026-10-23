import { describe, expect, it } from "vitest";
import { readLessonFixture as readBlockSource } from "../../../../grammar/__tests__/helpers/lesson-fixture.ts";
import type { PraxityBlock } from "../../types";
import { splitBlocksIntoPages } from "../split-pages";

function block(
	type: PraxityBlock["type"],
	id: string,
	data?: Record<string, unknown>,
): PraxityBlock {
	return { id, type, data: data ?? {} };
}

function pageBreak(title?: string): PraxityBlock {
	return block("pageBreak", `pb-${title ?? "untitled"}`, title ? { title } : {});
}

describe("splitBlocksIntoPages", () => {
	it("uses leading delimiter metadata while retaining lesson identity", () => {
		const parsed = readBlockSource("# One idea\n\nBody.\n");
		const pages = splitBlocksIntoPages(parsed.blocks, "Lesson", {
			id: "unused-implicit-page",
			title: "Unused",
			hide: true,
			lessonId: "lesson-stable",
			lessonTitle: "Lesson",
			isFirstPageOfLesson: true,
		});
		expect(pages).toMatchObject([
			{
				pageNumber: 1,
				id: "00000000-0000-4000-8000-000000000001",
				title: "One idea",
				lessonId: "lesson-stable",
				isFirstPageOfLesson: true,
			},
		]);
	});
	it("starts on Welcome when the lesson opens with a page delimiter", () => {
		const parsed = readBlockSource(
			"---\ntitle: Welcome\nlang: en\n---\n\n# Welcome {hideTitle}\n\n## One idea\n\nPraxity tools run on your computer.\n",
		);
		const pages = splitBlocksIntoPages(parsed.blocks, "Welcome");
		expect(pages).toMatchObject([
			{
				pageNumber: 1,
				title: "Welcome",
				slug: "welcome",
				blocks: [{ type: "heading" }, { type: "text" }],
			},
		]);
		expect(pages).toHaveLength(1);
	});
	it("returns one page when no pageBreaks exist", () => {
		const blocks = [block("text", "t1"), block("heading", "h1")];
		const pages = splitBlocksIntoPages(blocks, "Course Title");
		expect(pages).toHaveLength(1);
		expect(pages[0].title).toBe("Untitled");
		expect(pages[0].blocks).toHaveLength(2);
		expect(pages[0].pageNumber).toBe(1);
	});

	it("splits at pageBreak blocks and uses break title", () => {
		const blocks = [block("text", "t1"), pageBreak("Second Page"), block("text", "t2")];
		const pages = splitBlocksIntoPages(blocks, "First Page");
		expect(pages).toHaveLength(2);
		expect(pages[0].title).toBe("Untitled");
		expect(pages[0].blocks).toEqual([blocks[0]]);
		expect(pages[1].title).toBe("Second Page");
		expect(pages[1].blocks).toEqual([blocks[2]]);
	});

	it("attaches pageBreak params to the following page", () => {
		const blocks: PraxityBlock[] = [
			block("text", "t1", { content: "intro" }),
			block("pageBreak", "pb1", {
				title: "Lens",
				narration: "audio/s2.mp3",
				style: "scenario",
			}),
			block("text", "t2", { content: "body" }),
		];
		const pages = splitBlocksIntoPages(blocks, "Course");

		expect(pages[0].data).toEqual({});
		expect(pages[1].data).toMatchObject({
			title: "Lens",
			narration: "audio/s2.mp3",
			style: "scenario",
		});
	});

	it("uses durable page and lesson ids without changing the page slug", () => {
		const pages = splitBlocksIntoPages(
			[
				block("text", "t1"),
				block("pageBreak", "pb1", {
					id: "page-durable-2",
					lessonId: "lesson-durable",
					title: "Second Page",
				}),
				block("text", "t2"),
			],
			"Course",
			{ id: "page-durable-1", lessonId: "lesson-durable" },
		);

		expect(pages.map(({ id, lessonId, slug }) => ({ id, lessonId, slug }))).toEqual([
			{ id: "page-durable-1", lessonId: "lesson-durable", slug: "untitled" },
			{ id: "page-durable-2", lessonId: "lesson-durable", slug: "second-page" },
		]);
	});

	it("uses the first page heading when frontmatter has no title", () => {
		const blocks = [block("heading", "h1", { content: "<p>Welcome</p>" })];
		const pages = splitBlocksIntoPages(blocks, "Course", {
			narration: "assets/intro.mp3",
			captions: "assets/intro.vtt",
		});
		expect(pages[0].title).toBe("Welcome");
		expect(pages[0].data).toEqual({
			narration: "assets/intro.mp3",
			captions: "assets/intro.vtt",
		});
	});

	it("carries lesson identity across pages and resets it at the next lesson", () => {
		const blocks = [
			block("text", "lesson-1-page-1"),
			pageBreak("Lesson 1 page 2"),
			block("text", "lesson-1-page-2"),
			block("pageBreak", "lesson-2", {
				title: "Lesson 2",
				lessonTitle: "Second lesson",
				isFirstPageOfLesson: true,
			}),
			block("text", "lesson-2-page-1"),
		];
		const pages = splitBlocksIntoPages(blocks, "Course", {
			lessonTitle: "First lesson",
			lessonKicker: "Module 1",
			isFirstPageOfLesson: true,
		});

		expect(
			pages.map(({ lessonTitle, lessonKicker, isFirstPageOfLesson }) => ({
				lessonTitle,
				lessonKicker,
				isFirstPageOfLesson,
			})),
		).toEqual([
			{ lessonTitle: "First lesson", lessonKicker: "Module 1", isFirstPageOfLesson: true },
			{ lessonTitle: "First lesson", lessonKicker: "Module 1", isFirstPageOfLesson: false },
			{ lessonTitle: "Second lesson", lessonKicker: undefined, isFirstPageOfLesson: true },
		]);
	});

	it("carries filename title provenance across pages and clears it for an authored lesson", () => {
		const pages = splitBlocksIntoPages(
			[
				pageBreak("One"),
				block("text", "one"),
				pageBreak("Two"),
				block("text", "two"),
				block("pageBreak", "authored", {
					title: "Three",
					lessonTitle: "worst-case",
					isFirstPageOfLesson: true,
				}),
				block("text", "three"),
			],
			"Course",
			{ lessonTitle: "worst-case", lessonTitleIsFallback: true, isFirstPageOfLesson: true },
		);
		expect(pages.map((page) => page.lessonTitleIsFallback)).toEqual([true, true, undefined]);
		expect(pages.map((page) => page.lessonTitle)).toEqual([
			"worst-case",
			"worst-case",
			"worst-case",
		]);
	});

	it("excludes pageBreak blocks from page block arrays", () => {
		const blocks = [block("text", "t1"), pageBreak("P2"), block("text", "t2")];
		const pages = splitBlocksIntoPages(blocks, "P1");
		const allBlocks = pages.flatMap((page) => page.blocks);
		expect(allBlocks.every((entry) => entry.type !== "pageBreak")).toBe(true);
	});

	it("generates fallback title for untitled breaks", () => {
		const blocks = [block("text", "t1"), pageBreak(), block("text", "t2")];
		const pages = splitBlocksIntoPages(blocks, "P1");
		expect(pages[1].title).toBe("Untitled");
	});

	it("uses the first heading anywhere on an unlabelled page", () => {
		const blocks = [
			block("text", "t1"),
			pageBreak(),
			block("text", "t2"),
			block("heading", "h2", { content: "<p>Second &amp; Slide</p>" }),
		];
		const pages = splitBlocksIntoPages(blocks, "slides");
		expect(pages[0].title).toBe("Untitled");
		expect(pages[1].title).toBe("Second & Slide");
	});

	it("uses an assessment group's name as the swallowed page heading", () => {
		const blocks = [
			block("text", "t1"),
			pageBreak(),
			block("assessmentGroup", "g1", { groupName: "Final Checkpoint", mode: "all" }),
		];
		const pages = splitBlocksIntoPages(blocks, "Course");
		expect(pages[1].title).toBe("Final Checkpoint");
	});

	it("prefers an explicit page-break title over the leading heading", () => {
		const blocks = [
			block("text", "t0"),
			pageBreak("Explicit Title"),
			block("heading", "h1", { content: "<p>Heading Text</p>" }),
		];
		const pages = splitBlocksIntoPages(blocks, "Course");
		expect(pages[1].title).toBe("Explicit Title");
	});

	it("returns empty array for empty input", () => {
		expect(splitBlocksIntoPages([], "Title")).toEqual([]);
	});

	it("omits a page with hide: true and renumbers the visible pages", () => {
		const blocks = [
			block("text", "visible-1"),
			block("pageBreak", "hidden-break", { title: "Hidden", hide: true }),
			block("text", "hidden"),
			pageBreak("Visible 2"),
			block("text", "visible-2"),
		];

		const pages = splitBlocksIntoPages(blocks, "Course", { title: "Visible 1" });
		expect(pages.map(({ title, pageNumber }) => ({ title, pageNumber }))).toEqual([
			{ title: "Visible 1", pageNumber: 1 },
			{ title: "Visible 2", pageNumber: 2 },
		]);
		expect(pages.flatMap((page) => page.blocks).map((entry) => entry.id)).toEqual([
			"visible-1",
			"visible-2",
		]);
	});

	it("generates slug from title", () => {
		const blocks = [block("text", "t1"), pageBreak("Notes & Quotes"), block("text", "t2")];
		const pages = splitBlocksIntoPages(blocks, "Intro Page");
		expect(pages[0].slug).toBe("untitled");
		expect(pages[1].slug).toBe("notes-and-quotes");
	});
});
