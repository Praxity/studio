import { expect, it } from "vitest";
import { compilePage, renderNode } from "../src/preview/compile-page.ts";
import type { CourseContextInput } from "../src/preview/course-context.ts";
import { createCourseContext } from "../src/preview/course-context.ts";

const original: CourseContextInput = {
	id: "course",
	title: "Course",
	sourceLocale: "en",
	content: [
		{ id: "page", title: "Page", blocks: [{ id: "old", type: "text", data: { content: "Old." } }] },
	],
};

it("renders an inserted node before the whole context refresh and preserves the old page", async () => {
	const context = await createCourseContext(original);
	const block = { id: "new", type: "text" as const, data: { content: "<p>Inserted.</p>" } };
	const blocks = [...original.content[0].blocks, block];
	expect(renderNode(context, "page", "new", block, blocks).html).toContain("Inserted.");
	expect(compilePage(context, "page").html).not.toContain("Inserted.");
});

it("latest siblings supply page facts even after an earlier commit has not refreshed the context", async () => {
	const context = await createCourseContext(original);
	const blocks = [
		{
			id: "old",
			type: "text" as const,
			data: { content: '<p>First<span data-footer-content="First note">@footer</span></p>' },
		},
		{
			id: "new",
			type: "text" as const,
			data: { content: '<p>Second<span data-footer-content="Second note">@footer</span></p>' },
		},
	];
	const changed = { ...original, content: [{ ...original.content[0], blocks }] };
	const fresh = compilePage(await createCourseContext(changed), "page");
	expect(renderNode(context, "page", "new", blocks[1], blocks).html).toBe(
		fresh.fragments.get("new")?.html,
	);
	expect(renderNode(context, "page", "new", blocks[1], blocks).html).toContain("[2]");
});

it("a sibling list cannot render an absent target or a mismatched draft identity", async () => {
	const context = await createCourseContext(original);
	const block = original.content[0].blocks[0];
	expect(() => renderNode(context, "page", "old", block, [])).toThrow("Unknown page node");
	expect(() => renderNode(context, "page", "old", { ...block, id: "wrong" }, [block])).toThrow(
		"identity",
	);
});
