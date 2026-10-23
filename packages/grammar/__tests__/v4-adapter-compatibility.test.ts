import { withoutInlineProjectionMetadata } from "@praxity/content-model/inline-fields";
import { expect, it } from "vitest";
import { readLesson } from "../src/read-lesson";

const content = (source: string) => readLesson(`# Page\n${source}`).pages[0].blocks.slice(1);

it("keeps filled comparison items separate from both following blocks", () => {
	const blocks = content(
		"::: comparison {layout=side-by-side}\n:: Before\nOld process.\n:: After\nNew process.\n:::\n\nFollowing paragraph.\n\n## Following heading\n",
	);
	expect(blocks.map((block) => block.type)).toEqual(["columns", "text", "heading"]);
	expect(blocks[0].data.items).toMatchObject([
		{ label: "Before", children: [{ type: "text", data: { content: "<p>Old process.</p>" } }] },
		{ label: "After", children: [{ type: "text", data: { content: "<p>New process.</p>" } }] },
	]);
	expect(blocks[1].data.content).toBe("<p>Following paragraph.</p>");
	expect(blocks[2].data).toMatchObject({ content: "<p>Following heading</p>", level: 2 });
});

it("keeps the page title before relocated declarations in the older-logic structure", () => {
	const lesson = readLesson(
		"---\ntitle: Hazard response\nlang: en\nvariables:\n  passedQuiz: false\n---\n\n# Hazard response\n\nShow remediation if the learner has not passed.\n\n::: rule\nif: passedQuiz is false\nthen: show @remediation\n:::\n\n# Follow-up {hideTitle}\n\n::: note {name=remediation}\nAsk a supervisor for help.\n:::\n",
	);
	expect(lesson.hasErrors).toBe(false);
	expect(lesson.pages[0].blocks.map((block) => block.type)).toEqual([
		"heading",
		"variable",
		"text",
		"logic",
	]);
	expect(lesson.pages[0].blocks[0].data).toMatchObject({
		level: 1,
		content: "<p>Hazard response</p>",
	});
	expect(lesson.pages[0].blocks[1].data).toEqual({
		variableName: "passedQuiz",
		dataType: "boolean",
		defaultValue: false,
		source: "manual",
	});
	expect(lesson.blocks.map((block) => block.type)).toEqual([
		"pageBreak",
		"heading",
		"variable",
		"text",
		"logic",
		"pageBreak",
		"note",
	]);
});

it("retains declarations and the first content block when the page title is hidden", () => {
	const lesson = readLesson(
		"---\nvariables:\n  passedQuiz: false\n---\n# Hazard response {hideTitle}\nShow remediation.\n# Follow-up\nOther content.\n",
	);
	expect(lesson.hasErrors).toBe(false);
	expect(lesson.pages.map((page) => page.blocks.map((block) => block.type))).toEqual([
		["variable", "text"],
		["heading", "text"],
	]);
	expect(lesson.pages[0].blocks[0].data).toEqual({
		variableName: "passedQuiz",
		dataType: "boolean",
		defaultValue: false,
		source: "manual",
	});
	expect(lesson.pages[0].blocks[1].data.content).toBe("<p>Show remediation.</p>");
});

it("keeps image alt, dimensions and plain captions in the renderer shape", () => {
	const [image] = content("::: figure\n![Exit](exit.png) {size=small}\nThe exit\n:::\n");
	expect(image.data).toMatchObject({
		src: "exit.png",
		alt: "Exit",
		width: "small",
		caption: "The exit",
	});
	for (const key of ["size", "altText", "captionEnabled", "decorative"])
		expect(image.data).not.toHaveProperty(key);
});

it("keeps response metadata on the question and prose children free of settings", () => {
	const [question] = content(
		"::: choice Ready? {name=ready required scored shuffle points=2}\n(x) Yes\n( ) No\n:::\n",
	);
	expect(question.data).toMatchObject({
		required: true,
		points: 2,
		response: { shuffle: true },
	});
	// The compiler-node binding amendment adds compile-only provenance; keep the
	// original literal checking that response settings stay off prose children.
	expect(withoutInlineProjectionMetadata(question.data.stem, { keepDisplay: true })).toEqual([
		expect.objectContaining({ type: "text", data: { content: "<p>Ready?</p>" } }),
	]);
	expect(question.name).toBe("ready");
	expect(question.data).not.toHaveProperty("name");
	for (const key of ["description", "feedbackEnabled", "shuffle"])
		expect(question.data).not.toHaveProperty(key);
	expect(question.data.response).toMatchObject({
		options: [expect.not.objectContaining({ _inline: expect.anything() }), expect.anything()],
	});
});

it("keeps container heading metadata and item widths at their owners", () => {
	const [container] = content(
		"::: accordion {level=2}\n:: First {level=3}\nWords\n:: Second {level=3}\nOther\n:::\n",
	);
	expect(container.data).toMatchObject({ headingLevel: 3 });
	for (const item of container.data.items as Record<string, unknown>[]) {
		expect(item).not.toHaveProperty("width");
		expect(item).not.toHaveProperty("headingLevel");
		expect(item).not.toHaveProperty("_inline");
	}
});

it("keeps tight list items without paragraph wrappers and fence content without delimiter newlines", () => {
	const [list] = content("- One\n- Two\n");
	const [code] = content("```js\nconst x = 1;\n```\n");
	expect(list.data.content).toMatch(/<li[^>]*>(?:<div[^>]*>)?One(?:<\/div>)?<\/li>/);
	expect(code.data).toEqual({ code: "const x = 1;", language: "js" });
});

it("adapts floats as image, prose and a closing block boundary", () => {
	const blocks = content("::: float {side=left}\n![Exit](exit.png)\nWords\n:::\n");
	expect(blocks.map((block) => block.type)).toEqual(["image", "text", "blockBreak"]);
	expect(blocks[0].data).toMatchObject({ float: "left" });
	expect(blocks[2].data).toEqual({ close: "float" });
});

it("keeps media bounds and button settings only under their runtime names", () => {
	const [video, button] = content(
		"::: video movie.mp4 {start=2 end=9}\n:::\n::: button [Open](https://example.com) {newTab}\n:::\n",
	);
	expect(video.data).toEqual({ src: "movie.mp4", startTime: 2, endTime: 9 });
	expect(button.data).toMatchObject({ action: "link", openInNewTab: true });
	expect(button.data).not.toHaveProperty("newTab");
});

it("does not duplicate a page's folded group introduction", () => {
	const lesson = readLesson(
		"# Vérifiez\u202f: les étapes\n::: group Vérifiez\u202f: les étapes {level=1}\n::: choice Q\n(x) Yes\n( ) No\n:::\n:::\n",
	);
	expect(lesson.pages[0].blocks.map((block) => block.type)).toEqual([
		"assessmentGroup",
		"assessment",
	]);
	expect(lesson.blocks[0].data).not.toHaveProperty("title");
});

it("uses the existing source placeholders, table defaults and required defaults", () => {
	const [prose, table, signature] = content(
		"@source{Reference} @sources\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n::: signature Confirm\n:::\n",
	);
	expect(prose.data.content).toBe(
		'<p><span data-footer-content="Reference">@footer{Reference}</span> <span data-footer-insert="true">@footer.insert</span></p>',
	);
	expect(table.data).toEqual({ headers: ["A", "B"], rows: [["1", "2"]] });
	expect(signature.data).toEqual({ label: "Confirm", required: false });
});

it("keeps loose list paragraph wrappers and nested image alt text", () => {
	const [list] = content("- First paragraph\n\n  Second paragraph\n- Peer\n");
	expect(list.data.content).toContain("<p>First paragraph</p>");
	expect(list.data.content).toContain("<p>Second paragraph</p>");
	expect(list.data.content).toContain("<p>Peer</p>");
	const [text] = content("::: text\n![Diagram](diagram.png)\n:::\n");
	expect(text.data.content).toContain('alt="Diagram"');
});

it("keeps figure caption Markdown for the caption renderer", () => {
	const [image] = content("::: figure\n![Diagram](diagram.png)\nA **bold** caption\n:::\n");
	expect(image.data.caption).toBe("A **bold** caption");
});

it("keeps ordered matrix scale labels separate from unordered statements", () => {
	const [question] = content(
		"::: matrix Confidence?\n1. Low\n2. High\n\n- Skill one\n- Skill two\n:::\n",
	);
	expect(question.data.response).toMatchObject({
		scalePoints: [
			{ value: 1, label: "Low" },
			{ value: 2, label: "High" },
		],
		statements: [{ text: "Skill one" }, { text: "Skill two" }],
	});
});
