import { readLesson } from "@praxity/grammar";
import { preparePageFootnotes } from "@praxity/shared-blocks/page-footnotes";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { renderBlockHtml } from "../src/render-block-html.ts";

it.each([
	["First [caption\n\nSecond caption](https://example.com).", "a", "caption Second caption"],
	["First *caption\n\nSecond caption*.", "em", "caption Second caption"],
	["First `caption\n\nSecond caption`.", "code", "caption Second caption"],
])("C08a cross-run inline syntax stays published: %s", (caption, tag, label) => {
	const lesson = readLesson(
		`# Page\n\n::: figure\n![Alt](https://example.com/x.png)\n${caption}\n:::\n`,
	);
	expect(lesson.errors).toEqual([]);
	const image = lesson.blocks.find((block) => block.type === "image");
	if (!image) throw new Error("Missing figure");
	const dom = new JSDOM(renderBlockHtml(image));
	try {
		const token = dom.window.document.querySelector(`figcaption ${tag}`);
		expect(token?.textContent?.replace(/\s+/g, " ")).toBe(label);
		if (tag === "a") expect(token?.getAttribute("href")).toBe("https://example.com");
		expect(dom.window.document.querySelectorAll("figcaption [data-node-id]")).toHaveLength(0);
	} finally {
		dom.window.close();
	}
});

it("C08a separate figure runs keep their published separator", () => {
	const lesson = readLesson(
		"# Page\n\n::: figure\n![Alt](https://example.com/x.png)\nFirst caption.\n\nSecond caption.\n:::\n",
	);
	const image = lesson.blocks.find((block) => block.type === "image");
	if (!image) throw new Error("Missing figure");
	const dom = new JSDOM(renderBlockHtml(image));
	try {
		expect(dom.window.document.querySelector("figcaption")?.textContent).toBe(
			"First caption.\n\nSecond caption.",
		);
	} finally {
		dom.window.close();
	}
});

it.each(["video", "audio"])("C08a blank %s captions emit no paragraph or binding", (kind) => {
	for (const caption of ["", "caption:\n", "caption:   \n"]) {
		const lesson = readLesson(
			`# Page\n\n::: ${kind} https://example.com/clip.mp4\n${caption}:::\n`,
		);
		const media = lesson.blocks.find((block) => block.type === kind);
		if (!media) throw new Error("Missing media");
		const dom = new JSDOM(renderBlockHtml(media));
		try {
			expect(dom.window.document.querySelectorAll(".praxity-block-caption")).toHaveLength(0);
		} finally {
			dom.window.close();
		}
	}
});

it.each(["video", "audio"])("C08a %s caption sources use grammar-4 footnotes", (kind) => {
	const lesson = readLesson(
		`# Page\n\n::: ${kind} https://example.com/clip.mp4\ncaption: Cap @source{Src}.\n:::\n`,
	);
	const blocks = preparePageFootnotes(lesson.blocks, "page", {
		footnote: "Footnote",
		footnotes: "Sources",
	});
	const media = blocks.find((block) => block.type === kind);
	if (!media) throw new Error("Missing media");
	const dom = new JSDOM(renderBlockHtml(media));
	try {
		expect(dom.window.document.querySelector(".praxity-block-caption")?.textContent).toBe(
			"Cap Footnote [1].",
		);
		expect(dom.window.document.querySelector(".praxity-block-caption sup")?.innerHTML).toBe(
			'<span class="praxity-sr-only">Footnote </span>[1]',
		);
	} finally {
		dom.window.close();
	}
});

it.each(["figure", "video", "audio"])("C08a %s captions bind each authored run", (kind) => {
	const source =
		kind === "figure"
			? "# Page\n\n::: figure\n![Keep alt](https://example.com/image.png)\nFirst *caption*.\n\nSecond caption.\n:::\n"
			: `# Page\n\n::: ${kind} https://example.com/clip.${kind === "audio" ? "mp3" : "mp4"}\ncaption: First *caption*.\n:::\n`;
	const lesson = readLesson(source);
	const block = lesson.blocks.find((block) => block.type === (kind === "figure" ? "image" : kind));
	if (!block) throw new Error("Missing media block");
	const dom = new JSDOM(renderBlockHtml(block));
	try {
		const runs = [
			...dom.window.document.querySelectorAll(
				".praxity-block-caption [data-node-id], p.praxity-block-caption[data-node-id]",
			),
		];
		expect(runs.map((run) => run.textContent?.trim())).toEqual(
			kind === "figure" ? ["First caption.", "Second caption."] : ["First caption."],
		);
		for (const run of runs) {
			const record = lesson.nodes.get(run.getAttribute("data-node-id") ?? "");
			expect(record?.node.kind).toBe(kind === "figure" ? "body" : "part");
			expect(record?.node.raw).toContain(
				run.textContent?.includes("First") ? "First *caption*." : "Second caption.",
			);
		}
	} finally {
		dom.window.close();
	}
});

it("C08a bound figure runs retain the existing inline footnote preparation", () => {
	const lesson = readLesson(
		"# Page\n\n::: figure\n![Alt](https://example.com/image.png)\nFirst @source{First source}.\n\nSecond @source{Second source}.\n:::\n",
	);
	const blocks = preparePageFootnotes(lesson.blocks, "page", {
		footnote: "Footnote",
		footnotes: "Sources",
	});
	const image = blocks.find((block) => block.type === "image");
	if (!image) throw new Error("Missing figure");
	const dom = new JSDOM(renderBlockHtml(image));
	try {
		expect(
			[...dom.window.document.querySelectorAll("figcaption > span[data-node-id]")].map(
				(run) => run.textContent,
			),
		).toEqual(["First Footnote [1].", "Second Footnote [2]."]);
	} finally {
		dom.window.close();
	}
});
