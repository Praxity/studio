import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { expect, it } from "vitest";
import { compileDocument, createCourseContext, selfCheckContentInput } from "../build";

const selfCheck =
	"::: self-check Explain <b>why</b> & how\nmodel: The hidden model answer.\n:: Secret label\nmissed: Add the secret hint.\nevidence: hidden model\n:::\n";

// The native baseline and config carry only prompt content until S7.
it.each([
	["on a page", `# Page\n\n${selfCheck}`],
	["inside an accordion", `# Page\n\n::: accordion\n:: Panel\n${selfCheck}:::\n`],
])("a self-check %s renders its native baseline without hidden content", async (where, source) => {
	const lesson = readLesson(source);
	const blocks = adaptGrammarPreviewBlocks(lesson.blocks);
	expect(blocks.map((block) => block.type)).toEqual([
		"pageBreak",
		"heading",
		where === "on a page" ? "selfCheck" : "accordion",
	]);
	const owner = [...lesson.nodes.values()].find(
		(record) => !record.role && record.node.type === "self-check",
	);
	if (!owner) throw new Error("Missing self-check fixture");
	expect(readSelfCheckContent(lesson, owner.id).model).toBe("The hidden model answer.");
	for (const hidden of ["hidden model", "Secret label", "secret hint"])
		expect(JSON.stringify(blocks)).not.toContain(hidden);
	const page = { id: "page", title: "Page", blocks };
	const context = await createCourseContext({
		id: "self-check",
		title: "Self-check",
		sourceLocale: "en",
		content: [page],
		selfCheckContents: [selfCheckContentInput(owner.id, readSelfCheckContent(lesson, owner.id))],
		htmlOutput: {
			islandAssets: {
				loaderFilename: "loader.js",
				islandFilenames: { nav: "nav.js", accordion: "accordion.js", selfCheck: "self-check.js" },
			},
		},
	});
	const html = compileDocument(context, "page").html;
	expect(html).toContain(
		' class="praxity-assessment-stem">Explain &lt;b&gt;why&lt;/b&gt; &amp; how</h',
	);
	expect(html).toContain("<textarea");
	for (const hidden of ["hidden model", "Secret label", "secret hint"])
		expect(html).not.toContain(hidden);
});
