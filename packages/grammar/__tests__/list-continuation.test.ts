import { describe, expect, it } from "vitest";
import {
	readBlockFixture as readBlockSource,
	replayLesson,
	withoutNodeIdentity,
} from "./helpers/lesson-fixture.ts";

const content = (source: string) =>
	readBlockSource(source).blocks.map((block) => [
		block.type,
		block.data.content ? withoutNodeIdentity(block.data.content) : block.data.items,
	]);

describe("list continuation", () => {
	it("joins an indented line to the item above it", () => {
		expect(content("- First item\n  continues here\n- Second")).toEqual([
			["text", "<ul><li>First item continues here</li><li>Second</li></ul>"],
		]);
	});

	it("keeps a blank line plus indented line as a second paragraph of the same item", () => {
		expect(content("- First\n\n  Second paragraph\n- Next")).toEqual([
			["text", "<ul><li><p>First</p><p>Second paragraph</p></li><li><p>Next</p></li></ul>"],
		]);
	});

	it("still nests sub-lists and still ends the list at unindented text", () => {
		expect(content("- Parent\n  - Child\nAfter")).toEqual([
			["text", "<ul><li>Parent<ul><li>Child</li></ul></li></ul>"],
			["text", "<p>After</p>"],
		]);
	});

	it("keeps a checklist item whose text wraps onto an indented line", () => {
		const [block] = readBlockSource(
			"# Untitled {hideTitle}\n\n::: checklist\n- [ ] Inspect the exits\n  and the stairwells\n- [ ] Check PPE\n:::\n",
		).blocks;
		expect(block.type).toBe("checklist");
		expect(block.data.items).toEqual([
			{ id: "00000000-0000-4000-8000-000000000002", text: "Inspect the exits and the stairwells" },
			{ id: "00000000-0000-4000-8000-000000000003", text: "Check PPE" },
		]);
	});

	it("keeps the checklist declaration separate from task item text", () => {
		const [block] = readBlockSource(
			"# Untitled {hideTitle}\n\n::: checklist\n- [ ] Inspect\n:::\n",
		).blocks;
		expect(block).toMatchObject({
			type: "checklist",
			data: { items: [{ id: "00000000-0000-4000-8000-000000000002", text: "Inspect" }] },
		});
	});

	it("keeps indented list parameters separate from item text", () => {
		const [block] = readBlockSource(
			"# Untitled {hideTitle}\n\n::: text {width=narrow}\n- First\n:::\n",
		).blocks;
		expect({
			...block,
			data: { ...block.data, content: withoutNodeIdentity(block.data.content) },
		}).toMatchObject({
			type: "text",
			data: { content: "<ul><li>First</li></ul>", layoutMode: "narrow" },
		});
		const [legacyBlock] = readBlockSource(
			"# Untitled {hideTitle}\n\n::: text {width=narrow}\n- First\n:::\n",
		).blocks;
		expect({
			...legacyBlock.data,
			content: withoutNodeIdentity(legacyBlock.data.content),
		}).toMatchObject({
			content: "<ul><li>First</li></ul>",
			layoutMode: "narrow",
		});
	});

	it("continues list items with an indented prose line containing a colon", () => {
		expect(content("- Inspect\n  Note: bring gloves")).toEqual([
			["text", "<ul><li>Inspect Note: bring gloves</li></ul>"],
		]);
		const [block] = readBlockSource(
			"# Untitled {hideTitle}\n\n::: checklist\n- [ ] Inspect\n  Note: bring gloves\n:::\n",
		).blocks;
		expect(block.data.items).toEqual([
			{ id: "00000000-0000-4000-8000-000000000002", text: "Inspect Note: bring gloves" },
		]);
	});

	it("round-trips multi-paragraph items", () => {
		const source = "- First\n\n  Second paragraph\n- Next";
		const once = replayLesson(readBlockSource(source));
		expect(replayLesson(readBlockSource(once))).toBe(once);
		expect(withoutNodeIdentity(readBlockSource(once).blocks[0].data.content)).toBe(
			"<ul><li><p>First</p><p>Second paragraph</p></li><li><p>Next</p></li></ul>",
		);
	});

	it("round-trips persisted list content around paragraph elements", () => {
		const original = "- Lead\n\n  Second\n\n  Middle\n\n  Third\n\n  Tail";
		const source = replayLesson(readBlockSource(original))
			.replace(/^# Fixture \{hideTitle\}\n\n/, "")
			.trimEnd();
		expect(source).toBe("- Lead\n\n  Second\n\n  Middle\n\n  Third\n\n  Tail");
		expect(withoutNodeIdentity(readBlockSource(source).blocks[0].data.content)).toBe(
			"<ul><li><p>Lead</p><p>Second</p><p>Middle</p><p>Third</p><p>Tail</p></li></ul>",
		);
	});
});
