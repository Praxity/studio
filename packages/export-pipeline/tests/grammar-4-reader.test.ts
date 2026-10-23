import { readFileSync } from "node:fs";
import { MantineProvider } from "@mantine/core";
import { readLesson } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks, PreviewAssessmentBlock } from "@praxity/shared-blocks";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BLOCK_SCHEMA } from "../../grammar/src/v4/schema";
import { buildScormPackage } from "../src/build";
import { renderBlockHtml } from "../src/render-block-html";

describe("grammar 4 through the existing HTML export", () => {
	it("keeps page IDs and navigation labels through the current flat-block page splitter", () => {
		const lesson = readLesson("# Long title\nnav: Short\nBody\n# Hidden {hideTitle}\nOther\n");
		const pages = splitBlocksIntoPages(lesson.blocks, "Lesson");
		expect(pages.map((page) => [page.id, page.title])).toEqual(
			lesson.pages.map((page) => [page.id, page.title]),
		);
	});
	it.each(["choice", "match", "order", "matrix"])(
		"keeps %s node attributes when the assessment renderer replaces its static shell",
		(type) => {
			const lesson = readLesson(`# P\n${BLOCK_SCHEMA[type].insertTemplate}`);
			const block = lesson.pages[0].blocks[1];
			const html = renderToStaticMarkup(
				createElement(
					MantineProvider,
					{},
					createElement(PreviewAssessmentBlock, { blockId: block.id, data: block.data as never }),
				),
			);
			const document = new JSDOM(html).window.document;
			for (const wrapper of document.querySelectorAll(
				"[data-block-id], .praxity-assessment-choice-option, .praxity-matching-row, .praxity-order-item, .praxity-matrix-table tbody tr",
			))
				expect(wrapper.getAttribute("data-node-id")).toBeTruthy();
		},
	);
	it.each([
		"accordion",
		"tabs",
		"sequence",
		"cards",
		"columns",
		"comparison",
		"dialogue",
		"checklist",
		"rating",
		"categorize",
		"fill-blank",
		"hotspot",
	])("identifies %s item wrappers in canonical HTML", (type) => {
		const lesson = readLesson(`# P\n${BLOCK_SCHEMA[type].insertTemplate}`);
		const blocks = adaptGrammarPreviewBlocks(lesson.pages[0].blocks);
		const html = blocks.map((block) => renderBlockHtml(block)).join("");
		const document = new JSDOM(html).window.document;
		const wrappers = document.querySelectorAll(
			"[data-accordion-item], .praxity-tabs-panel, [data-card-item], .praxity-column, .praxity-sequence-item, .praxity-dialogue-turn, [data-checklist-item], .praxity-rating-option, .praxity-categorize-table tbody tr, .praxity-fill-blank-input, [data-shape]",
		);
		expect(wrappers.length, type).toBeGreaterThan(0);
		for (const wrapper of wrappers) {
			const nodeId = wrapper.getAttribute("data-node-id");
			expect(nodeId, wrapper.outerHTML.slice(0, 200)).toBeTruthy();
			expect(lesson.nodes.has(nodeId ?? "")).toBe(true);
		}
	});
	it.each([
		[
			"leadership",
			[
				"00-avant-de-commencer",
				"01-affirmez-vous",
				"02-quatre-cavaliers",
				"03-resoudre-un-conflit",
			],
		],
		["toolkit", ["welcome"]],
	] as const)(
		"compiles converted %s lessons and identifies every block/item wrapper",
		async (course, paths) => {
			const lessons = paths.map((path) =>
				readLesson(
					readFileSync(
						new URL(`../../grammar/__tests__/fixtures/v4/${course}/${path}.prax`, import.meta.url),
						"utf8",
					),
				),
			);
			for (const lesson of lessons) expect(lesson.errors).toEqual([]);
			const result = await buildScormPackage(
				{
					id: course,
					title: course,
					sourceLocale: course === "leadership" ? "fr" : "en",
					content: lessons.flatMap((lesson) => lesson.pages),
				},
				{ format: "html" },
			);
			const zip = new AdmZip(result.zip);
			const documents = zip
				.getEntries()
				.filter((entry) => entry.entryName.endsWith(".html"))
				.map((entry) => new JSDOM(zip.readAsText(entry)).window.document);
			const wrappers = documents.flatMap((document) =>
				Array.from(
					document.querySelectorAll(
						"[data-block-id], [data-card-id], [data-item-id], .praxity-column, .praxity-tabs-panel, .praxity-sequence-item, .praxity-dialogue-turn, .praxity-assessment-choice-option, .praxity-matching-row, .praxity-order-item, .praxity-rating-option, .praxity-categorize-table tbody tr",
					),
				),
			);
			expect(wrappers.length).toBeGreaterThan(course === "leadership" ? 250 : 1);
			for (const wrapper of wrappers)
				expect(wrapper.getAttribute("data-node-id"), wrapper.outerHTML.slice(0, 220)).toBeTruthy();
			for (const page of lessons.flatMap((lesson) => lesson.pages))
				for (const block of page.blocks.filter((block) => block.type !== "logic")) {
					expect(
						documents.some((document) => document.querySelector(`[data-node-id="${block.id}"]`)),
						`${block.type} ${block.id}`,
					).toBe(true);
				}
			if (course === "toolkit")
				expect(
					documents
						.flatMap((document) => Array.from(document.querySelectorAll("h1")))
						.some((heading) => heading.textContent === "Welcome"),
				).toBe(false);
		},
	);
	it("renders float contents and code inside lists without loss", () => {
		const lesson = readLesson(
			"# P\n::: float {side=right}\n![Portrait](/assets/image.png)\nVisible words\n:::\n- Example\n  ```js\n  const x = 1;\n  ```\n",
		);
		const html = lesson.pages[0].blocks.map((block) => renderBlockHtml(block)).join("");
		const document = new JSDOM(html).window.document;
		expect(document.querySelector('img[alt="Portrait"]')).toBeTruthy();
		expect(document.body.textContent).toContain("Visible words");
		expect(document.querySelector("li pre code")?.textContent).toContain("const x = 1;");
	});
	it("renders embed URLs and figure images with their source identity", () => {
		const lesson = readLesson(
			"# P\n::: embed https://example.com/resource\ntitle: Resource\n:::\n::: figure\n![Portrait](/assets/image.png)\nCaption\n:::\n",
		);
		const document = new JSDOM(
			lesson.pages[0].blocks.map((block) => renderBlockHtml(block)).join(""),
		).window.document;
		expect(document.querySelector('a[href="https://example.com/resource"]')).toBeTruthy();
		const image = [...lesson.nodes.values()].find((record) => record.node.kind === "image");
		expect(document.querySelector("img")?.getAttribute("data-node-id")).toBe(image?.id);
		expect(document.querySelectorAll("img")).toHaveLength(1);
	});
	it.each(["text", "note", "quote"])("preserves rich prose inside %s", (type) => {
		const lesson = readLesson(
			`# P\n::: ${type}\n## Detail\n![Portrait](/assets/image.png)\n\n| A | B |\n| --- | --- |\n| One | Two |\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\n$$\nx^2\n$$\n:::\n`,
		);
		expect(lesson.errors).toEqual([]);
		const document = new JSDOM(
			lesson.pages[0].blocks.map((block) => renderBlockHtml(block)).join(""),
		).window.document;
		expect(document.querySelector("h2")?.textContent).toBe("Detail");
		expect(document.querySelector('img[alt="Portrait"]')).toBeTruthy();
		expect(document.querySelector("td")?.textContent).toBe("One");
		expect(document.querySelector("pre code")?.textContent).toContain("const x = 1;");
		expect(document.body.textContent).toContain("x^2");
	});
	it.each(
		Object.entries(BLOCK_SCHEMA).filter(
			([type]) => !["page", "retrieval-sheet", "write-distractors", "highlight"].includes(type),
		),
	)(
		"renders %s template and its source nodes through the existing adapter",
		(_type, definition) => {
			const lesson = readLesson(`# Example\n${definition.insertTemplate}`);
			const blocks = adaptGrammarPreviewBlocks(lesson.pages[0].blocks);
			const document = new JSDOM(blocks.map((block) => renderBlockHtml(block)).join("")).window
				.document;
			for (const record of lesson.nodes.values()) {
				if (
					[
						"block",
						"item",
						"back",
						"option",
						"pair",
						"step",
						"turn",
						"task",
						"spot",
						"list-entry",
					].includes(record.node.kind) &&
					record.role !== "stem"
				)
					expect(
						document.querySelector(`[data-node-id="${record.id}"]`),
						`${_type} ${record.node.kind} ${record.role ?? ""}`,
					).toBeTruthy();
			}
		},
	);
	it("preserves highlight source data in direct publication rendering", () => {
		const read = readLesson(`# Example\n${BLOCK_SCHEMA.highlight.insertTemplate}`);
		const blocks = adaptGrammarPreviewBlocks(read.pages[0].blocks);
		const highlight = blocks.find((block) => block.type === "highlight");
		if (!highlight) throw new Error("Missing typed highlight fixture");
		const html = renderBlockHtml(highlight);
		expect(html).toContain("data-highlight");
		expect(html).toContain("data-highlight-fallback");
		const document = new JSDOM(html).window.document;
		expect(document.querySelectorAll("[data-highlight] [data-node-id]")).toHaveLength(0);
	});
	it("renders the typed retrieval-sheet adapter output", () => {
		const lesson = readLesson(`# Example\n${BLOCK_SCHEMA["retrieval-sheet"].insertTemplate}`);
		const blocks = adaptGrammarPreviewBlocks(lesson.pages[0].blocks);
		const sheet = blocks.find((block) => block.type === "retrievalSheet");
		if (!sheet) throw new Error("Missing typed retrieval sheet");
		expect(sheet).toEqual(lesson.pages[0].blocks.find((block) => block.id === sheet.id));
		const document = new JSDOM(renderBlockHtml(sheet)).window.document;
		expect(document.querySelectorAll("[data-retrieval-side]")).toHaveLength(2);
		expect(document.querySelector("[data-retrieval-sheet] h2")?.textContent).toBe(
			"Design approaches",
		);
	});
	it("preserves prompt-only typed write-distractors adapter output and renders a prompt-only baseline", () => {
		const lesson = readLesson(
			`# Example\n${BLOCK_SCHEMA["write-distractors"].insertTemplate.replace("Right answer", "HIDDEN_RIGHT").replace("Mistaken idea", "HIDDEN_LABEL").replace("Wrong option", "HIDDEN_OPTION")}`,
			{
				ids: (node, role) =>
					!role && node.kind === "item"
						? "distractor-item"
						: `id-${node.span.start}-${role ?? node.kind}`,
			},
		);
		const blocks = adaptGrammarPreviewBlocks(lesson.pages[0].blocks);
		const distractors = blocks.find((block) => block.type === "writeDistractors");
		if (!distractors) throw new Error("Missing typed write distractors");
		expect(distractors).toEqual(
			lesson.pages[0].blocks.find((block) => block.id === distractors.id),
		);
		expect(distractors.data).toEqual({
			content: { question: "Question", count: 2, items: [{ id: "distractor-item" }] },
			level: 2,
		});
		for (const hidden of ["HIDDEN_RIGHT", "HIDDEN_LABEL", "HIDDEN_OPTION"])
			expect(JSON.stringify(blocks)).not.toContain(hidden);
		const html = renderBlockHtml(distractors);
		expect(html).toContain("data-write-distractors");
		for (const hidden of ["HIDDEN_RIGHT", "HIDDEN_LABEL", "HIDDEN_OPTION"])
			expect(html).not.toContain(hidden);
	});
	it("identifies nested items, back faces and list entries from supplied IDs", () => {
		const lesson = readLesson(
			"# P\n::: columns\n:: {weight=3}\n::: tabs\n:: A\n- One\n- Two\n:: B\nBody\n:::\n:: {weight=2}\n::: cards Cards\n:: Front\nWords\n::: back\nBack\n:::\n:::\n:::\n",
			{ ids: (node, role) => `id-${node.span.start}-${role ?? node.kind}` },
		);
		expect(lesson.errors).toEqual([]);
		const document = new JSDOM(
			lesson.pages[0].blocks.map((block) => renderBlockHtml(block)).join(""),
		).window.document;
		for (const node of lesson.nodes.values()) {
			if (["block", "item", "back", "list-entry"].includes(node.node.kind))
				expect(document.querySelector(`[data-node-id="${node.id}"]`), node.id).toBeTruthy();
		}
	});
	it("publishes supplied float and matrix scale IDs in compiled and semantic HTML", async () => {
		const lesson = readLesson(
			"# P\n::: float {side=left}\n![Portrait](portrait.png) {size=small}\nWords\n:::\n::: float {side=right}\n![Portrait](portrait.png) {size=small}\n:::\n::: columns\n::\n::: float {side=left}\n![Portrait](portrait.png) {size=small}\nNested words\n:::\n::\nPeer\n:::\n::: matrix Confidence?\n1. Low\n2. High\n\n- Skill one\n- Skill two\n:::\n",
			{ ids: (node, role) => `id-${node.span.start}-${role ?? node.kind}` },
		);
		expect(lesson.errors).toEqual([]);
		const blocks = adaptGrammarPreviewBlocks(lesson.pages[0].blocks);
		const result = await buildScormPackage(
			{ id: "identities", title: "Identities", sourceLocale: "en", content: lesson.pages },
			{ format: "html" },
		);
		const zip = new AdmZip(result.zip);
		const published = zip
			.getEntries()
			.filter((entry) => entry.entryName.endsWith(".html"))
			.map((entry) => new JSDOM(entry.getData().toString("utf8")).window.document);
		const semantic = new JSDOM(blocks.map((block) => renderBlockHtml(block)).join("")).window
			.document;
		const records = [...lesson.nodes.values()].filter(
			(record) => record.node.type === "float" || record.node.kind === "list-entry",
		);
		expect(records).toHaveLength(7);
		for (const record of records) {
			const selector = `[data-node-id="${record.id}"]`;
			expect(
				published.some((document) => document.querySelector(selector)),
				record.id,
			).toBe(true);
			expect(semantic.querySelector(selector), record.id).toBeTruthy();
		}
	});
	it("retains a card back's identity through canonical rendering", () => {
		const lesson = readLesson(
			"# P\n::: cards {layout=grid}\n:: Front\nWords\n::: back\nBack\n:::\n:::\n",
		);
		const block = adaptGrammarPreviewBlocks(lesson.pages[0].blocks)[1];
		const document = new JSDOM(renderBlockHtml(block)).window.document;
		const back = [...lesson.nodes.values()].find((record) => record.node.kind === "back");
		expect(document.querySelector('[data-card-side="back"]')?.getAttribute("data-node-id")).toBe(
			back?.id,
		);
	});
});
