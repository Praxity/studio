import { describe, expect, it } from "vitest";
import {
	readBlockFixture as readSource,
	replayLesson,
	withoutNodeIdentity,
} from "./helpers/lesson-fixture.ts";

function parseBody(body: string) {
	return readSource(`---\ntitle: T\n---\n\n${body}\n`).blocks;
}

describe("prose lists", () => {
	it("parses a bullet list into a <ul>", () => {
		const [block] = parseBody("# Untitled {hideTitle}\n\n- alpha\n- beta\n");
		expect(block.type).toBe("text");
		expect(withoutNodeIdentity(block.data.content)).toBe("<ul><li>alpha</li><li>beta</li></ul>");
	});

	it("parses an ordered list into an <ol>", () => {
		const [block] = parseBody("# Untitled {hideTitle}\n\n1. first\n2. second\n");
		expect(block.type).toBe("text");
		expect(withoutNodeIdentity(block.data.content)).toBe("<ol><li>first</li><li>second</li></ol>");
	});

	it("keeps inline markdown inside list items", () => {
		const [block] = parseBody("# Untitled {hideTitle}\n\n1. **bold** step\n");
		expect(withoutNodeIdentity(block.data.content)).toBe(
			"<ol><li><strong>bold</strong> step</li></ol>",
		);
	});

	it("does not treat a rating scale line as an ordered list", () => {
		const [block] = parseBody("# Untitled {hideTitle}\n\nSome prose\n1: Poor\n");
		expect(String(block.data.content)).not.toContain("<ol>");
	});

	it.each([
		["bullet", "- alpha\n- beta"],
		["ordered", "1. first\n2. second"],
		["ordered with inline markdown", "1. **bold** step\n2. plain step"],
	])("round-trips a %s list through parse → serialize", (_label, body) => {
		const blocks = parseBody(body);
		const reserialized = replayLesson(readSource(body)).replace(/^# Fixture \{hideTitle\}\n\n/, "");
		expect(reserialized.trim()).toBe(body);
		expect(parseBody(reserialized.trim())[0].data.content).toBe(blocks[0].data.content);
	});

	describe("blank lines between items", () => {
		it("keeps an ordered list whole across a blank line", () => {
			const blocks = parseBody("# Untitled {hideTitle}\n\n1. first\n\n2. second\n");
			expect(blocks).toHaveLength(1);
			expect(withoutNodeIdentity(blocks[0].data.content)).toBe(
				"<ol><li>first</li><li>second</li></ol>",
			);
		});

		it("keeps a bullet list whole across a blank line", () => {
			const blocks = parseBody("# Untitled {hideTitle}\n\n- alpha\n\n- beta\n");
			expect(blocks).toHaveLength(1);
			expect(withoutNodeIdentity(blocks[0].data.content)).toBe(
				"<ul><li>alpha</li><li>beta</li></ul>",
			);
		});

		it("still ends the list when prose follows the blank line", () => {
			const blocks = parseBody("# Untitled {hideTitle}\n\n1. first\n\nSome prose.\n\n1. second\n");
			expect(blocks).toHaveLength(3);
			expect(withoutNodeIdentity(blocks[0].data.content)).toBe("<ol><li>first</li></ol>");
			expect(String(blocks[1].data.content)).toContain("Some prose.");
			expect(withoutNodeIdentity(blocks[2].data.content)).toBe("<ol><li>second</li></ol>");
		});
	});

	describe("nested lists", () => {
		it("nests indented ordered items inside the parent item", () => {
			const [block] = parseBody(
				"# Untitled {hideTitle}\n\n1. first\n   1. nested a\n   2. nested b\n2. second\n",
			);
			expect(withoutNodeIdentity(block.data.content)).toBe(
				"<ol><li>first<ol><li>nested a</li><li>nested b</li></ol></li><li>second</li></ol>",
			);
		});

		it("nests a bullet sub-list under an ordered parent", () => {
			const [block] = parseBody(
				"# Untitled {hideTitle}\n\n1. first\n   - alpha\n   - beta\n2. second\n",
			);
			expect(withoutNodeIdentity(block.data.content)).toBe(
				"<ol><li>first<ul><li>alpha</li><li>beta</li></ul></li><li>second</li></ol>",
			);
		});

		it("closes two levels at once when returning to the top", () => {
			const [block] = parseBody("# Untitled {hideTitle}\n\n- a\n  - b\n    - c\n- d\n");
			expect(withoutNodeIdentity(block.data.content)).toBe(
				"<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>",
			);
		});

		it("does not nest an indented task list into a prose list", () => {
			const blocks = parseBody("# Untitled {hideTitle}\n\n- alpha\n  - [ ] a task\n");
			for (const block of blocks) {
				expect(String(block.data.content ?? "")).not.toContain("[ ]</li>");
			}
		});
	});

	it.each([
		["nested ordered", "1. first\n  1. nested a\n  2. nested b\n2. second"],
		["nested bullet", "- alpha\n  - beta\n- gamma"],
		["mixed nesting", "1. first\n  - alpha\n2. second"],
		["blank-separated", "1. first\n2. second"],
	])("round-trips a %s list through parse → serialize", (_label, body) => {
		const blocks = parseBody(body);
		const reserialized = replayLesson(readSource(body)).replace(/^# Fixture \{hideTitle\}\n\n/, "");
		expect(reserialized.trim()).toBe(body);
		expect(parseBody(reserialized.trim())[0].data.content).toBe(blocks[0].data.content);
	});

	describe("task lists that do not resolve to a checklist", () => {
		it.each([
			["as: before items", "::: checklist\n- [ ] First task\n- [ ] Second task\n:::"],
			[
				"as: before items, blank line between",
				"::: checklist\n\n- [ ] First task\n- [ ] Second\n:::",
			],
			["task list with no as: at all", "- [ ] Orphan task\n- [x] Done task"],
			["single unresolved task item", "- [ ] Only one"],
		])("terminates on %s", (_label, body) => {
			const blocks = parseBody(body);
			expect(Array.isArray(blocks)).toBe(true);
		});

		it("degrades to text rather than emitting an empty list", () => {
			const blocks = parseBody("::: checklist\n- [ ] First task\n:::");
			for (const block of blocks) {
				expect(String(block.data.content ?? "")).not.toContain("<ul></ul>");
			}
		});

		it("still builds a checklist when as: follows the items", () => {
			const blocks = parseBody(
				"# Untitled {hideTitle}\n\n::: checklist\n- [ ] First task\n- [x] Second task\n:::\n",
			);
			expect(blocks.map((b) => b.type)).toContain("checklist");
		});
	});
});
