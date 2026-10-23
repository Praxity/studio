import { expect, it } from "vitest";
import { compileDocument, compileDocumentFrame } from "../src/preview/compile-page.ts";
import { createCourseContext, refreshCourseContext } from "../src/preview/course-context.ts";
import { compilerFixture, compilerIslandAssets } from "./fixtures/page-compiler.ts";

it("document frame uses the same shell digest and regions as a full document compile", async () => {
	const input = {
		...(await compilerFixture("leadership")),
		htmlOutput: { islandAssets: compilerIslandAssets },
	};
	const context = await createCourseContext(input);
	expect(() => compileDocumentFrame(context, "missing")).toThrow(
		"Unknown course document: missing",
	);
	for (const document of context.documents) {
		const frame = compileDocumentFrame(context, document.slug);
		const compiled = compileDocument(context, document.slug);
		expect(frame.shellDigest).toBe(compiled.shellDigest);
		expect(frame.regions).toEqual(compiled.regions);
	}
});
it("a paragraph edit leaves the shell digest alone; a page rename changes it", async () => {
	const input = {
		id: "course",
		title: "Course",
		sourceLocale: "en",
		content: [
			{
				id: "page",
				title: "Page",
				blocks: [{ id: "node", type: "text" as const, data: { content: "Before." } }],
			},
		],
	};
	const context = await createCourseContext(input);
	const slug = context.documents[0]?.slug;
	if (!slug) throw new Error("Missing document");
	const changed = await refreshCourseContext(
		context,
		{
			...input,
			content: [
				{
					...input.content[0],
					blocks: [{ id: "node", type: "text", data: { content: "After!." } }],
				},
			],
		},
		{},
	);
	// Only the inert config JSON differs, and no inspection script needs it swapped in.
	expect(compileDocumentFrame(changed, slug).shellDigest).toBe(
		compileDocumentFrame(context, slug).shellDigest,
	);
	const renamed = await refreshCourseContext(
		changed,
		{ ...input, content: [{ ...input.content[0], title: "Renamed" }] },
		{},
	);
	const renamedSlug = renamed.documents[0]?.slug;
	if (!renamedSlug) throw new Error("Missing renamed document");
	expect(compileDocumentFrame(renamed, renamedSlug).shellDigest).not.toBe(
		compileDocumentFrame(changed, slug).shellDigest,
	);
});
