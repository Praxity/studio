import { describe, expect, it } from "vitest";
import { readBlockFixture as readBlockSource } from "./helpers/lesson-fixture.ts";

/**
 * Prose written after a question is course content, not part of the question.
 * It used to be swallowed: fill-blank joined it into the sentence with the
 * blank, and the shape-filtered types dropped it. Either way it vanished with
 * no error.
 */
describe("assessment bodies stop at prose", () => {
	const prose = "This paragraph is course prose, not part of the question.";

	it("keeps prose after a choice question", () => {
		const blocks = readBlockSource(
			"# Untitled {hideTitle}\n\n::: choice Pick one {level=3}\n(x) Right\n( ) Wrong\n:::\n\n" +
				prose +
				"\n",
		).blocks;
		expect(blocks.map((b) => b.type)).toEqual(["assessment", "text"]);
		expect(String(blocks[1].data.content)).toContain(prose);
	});

	it("keeps prose after a fill-blank out of the sentence", () => {
		const blocks = readBlockSource(
			"# Untitled {hideTitle}\n\n::: fill-blank Complete it {level=3}\nThe answer is {permit} and it matters.\n:::\n\n" +
				prose +
				"\n",
		).blocks;
		expect(blocks[0].data.response.template).toBe("The answer is {permit} and it matters.");
		expect(String(blocks[1].data.content)).toContain(prose);
	});

	it("keeps prose after a free-response with an explicit placeholder", () => {
		const blocks = readBlockSource(
			"# Untitled {hideTitle}\n\n::: free-response What did you learn? {level=3}\nplaceholder: Type here\n:::\n\n" +
				prose +
				"\n",
		).blocks;
		expect(blocks[0].data.response.placeholder).toBe("Type here");
		expect(String(blocks[1].data.content)).toContain(prose);
	});

	it("still reads a bare free-response body as the legacy placeholder", () => {
		const blocks = readBlockSource(
			"# Untitled {hideTitle}\n\n::: free-response Describe it {level=3}\nplaceholder: Consider both changes.\n:::\n",
		).blocks;
		expect(blocks).toHaveLength(1);
		expect(blocks[0].data.response.placeholder).toBe("Consider both changes.");
	});

	it("ends the legacy placeholder at the paragraph, not at the next block", () => {
		const blocks = readBlockSource(
			"# Untitled {hideTitle}\n\n::: free-response Describe it {level=3}\nplaceholder: Consider both changes.\n:::\n\n" +
				prose +
				"\n",
		).blocks;
		expect(blocks[0].data.response.placeholder).toBe("Consider both changes.");
		expect(String(blocks[1].data.content)).toContain(prose);
	});

	it("keeps match pairs, ordered items and scale labels in the body", () => {
		expect(
			readBlockSource("# Untitled {hideTitle}\n\n::: match M {level=3}\n- A -> B\n- C -> D\n:::\n")
				.blocks,
		).toHaveLength(1);
		expect(
			readBlockSource("# Untitled {hideTitle}\n\n::: order O {level=3}\n1. First\n2. Second\n:::\n")
				.blocks,
		).toHaveLength(1);
		expect(
			readBlockSource("# Untitled {hideTitle}\n\n::: rating R {level=3}\n1. Low\n5. High\n:::\n")
				.blocks,
		).toHaveLength(1);
	});
});

/**
 * Hotspot body content keeps the same assessment scope, so the
 * heading form every other assessment uses fell through to a loose heading, a
 * loose image and a bullet list — no assessment, no error.
 */
describe("hotspot accepts the heading form", () => {
	const source =
		"# Untitled {hideTitle}\n\n::: hotspot Where is the hazard?\n![Warehouse floor](/assets/floor.png)\n- Spill {x=30 y=40 correct}\n- Shelf {x=70 y=20}\n:::\n";

	it("builds one assessment with the heading as its question", () => {
		const blocks = readBlockSource(source).blocks;
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("assessment");
		expect(blocks[0].data.stem).toMatchObject([
			{ type: "text", data: { content: "<p>Where is the hazard?</p>" } },
		]);
		expect(blocks[0].data.assessmentType).toBe("hotspot");
		expect(blocks[0].data.response.image).toBe("/assets/floor.png");
		expect(blocks[0].data.response.hotspots).toHaveLength(2);
	});

	it("leaves a heading alone when no image follows", () => {
		const blocks = readBlockSource("### Orphan hotspot\n\nJust prose.").blocks;
		expect(blocks.map((b) => b.type)).toEqual(["heading", "text"]);
	});
});
