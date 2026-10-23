import { describe, expect, it } from "vitest";
import { partitionLessonPages } from "../src/index";
import { readLessonFixture as readBlockSource } from "./helpers/lesson-fixture.ts";

const welcome =
	"---\ntitle: Welcome\nlang: en\n---\n\n# Welcome {hideTitle}\n\n## One idea\n\nPraxity tools run on your computer.\n";

describe("parsed lesson pages", () => {
	it("opens on the first declared page after frontmatter", () => {
		const pages = partitionLessonPages(readBlockSource(welcome).blocks);
		expect(pages).toHaveLength(1);
		expect(pages[0].boundary?.data.title).toBe("Welcome");
		expect(pages[0].blocks.map((block) => block.type)).toEqual(["heading", "text"]);
	});
	it.each(["\n\n", "\n \n"])("ignores a preamble that produces no blocks: %j", (preamble) => {
		const pages = partitionLessonPages(
			readBlockSource(`${preamble}# Welcome {hideTitle}\n\nBody.`).blocks,
		);
		expect(pages).toHaveLength(1);
		expect(pages[0].boundary?.data.title).toBe("Welcome");
	});
	it("keeps any real block before the first delimiter", () => {
		const pages = partitionLessonPages(
			readBlockSource(
				"# Introduction {hideTitle}\n\n## Introduction\n\n# Welcome {hideTitle}\n\nBody.\n",
			).blocks,
		);
		expect(pages).toHaveLength(2);
		expect(pages[0].boundary?.type).toBe("pageBreak");
		expect(pages[0].blocks.map((block) => block.type)).toEqual(["heading"]);
	});
	it("keeps a lesson without delimiters as one implicit page", () => {
		const pages = partitionLessonPages(
			readBlockSource("# One idea {hideTitle}\n\n## One idea\n\nBody.\n").blocks,
		);
		expect(pages).toHaveLength(1);
		expect(pages[0].boundary?.type).toBe("pageBreak");
		expect(pages[0].blocks).toHaveLength(2);
	});
	it("retains explicitly empty pages between and after consecutive delimiters", () => {
		const pages = partitionLessonPages(
			readBlockSource("# One {hideTitle}\n\n# Two {hideTitle}\n\nBody.\n\n# Three {hideTitle}\n")
				.blocks,
		);
		expect(pages.map((page) => [page.boundary?.data.title, page.blocks.length])).toEqual([
			["One", 0],
			["Two", 1],
			["Three", 0],
		]);
	});
	it("accepts an unlabelled leading delimiter", () => {
		const pages = partitionLessonPages(readBlockSource("# One idea\n\nBody.\n").blocks);
		expect(pages).toHaveLength(1);
		expect(pages[0].boundary?.type).toBe("pageBreak");
		expect(pages[0].boundary?.data.title).toBeUndefined();
		expect(pages[0].blocks).toHaveLength(2);
	});
	it("creates no page for a lesson with no blocks", () => {
		expect(partitionLessonPages(readBlockSource("---\ntitle: Empty\n---\n\n").blocks)).toEqual([]);
	});
});
