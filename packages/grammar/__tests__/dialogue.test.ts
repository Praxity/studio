import { describe, expect, it } from "vitest";
import {
	grammar4Starter,
	readBlockFixture as readBlockSource,
	replayLesson,
} from "./helpers/lesson-fixture.ts";

const dialogue = (source: string) => {
	const result = readBlockSource(source);
	return { block: result.blocks.find((block) => block.type === "dialogue"), result };
};

describe("grammar 4 dialogue", () => {
	it("parses list items into speaker turns and keeps parameters", () => {
		const { block } = dialogue(
			"---\n{\n  cast:\n    {\n      coach: { name: Coach Lee, avatar: /assets/lee.png },\n      roger: {},\n      roxanne: {}\n    }\n}\n---\n\n# Untitled {hideTitle}\n\n::: dialogue {style=script}\n- Roger: Wow ! Je réalise\n  que tout a changé.\n- Roxanne: [warm] Personnellement,\n\n  un temps mort.\ncaption: Au bureau\n:::\n",
		);
		expect(block?.data).toEqual({
			turns: [
				{
					id: "00000000-0000-4000-8000-000000000002",
					speaker: "Roger",
					paragraphs: ["Wow ! Je réalise que tout a changé."],
				},
				{
					id: "00000000-0000-4000-8000-000000000003",
					speaker: "Roxanne",
					paragraphs: ["[warm] Personnellement,", "un temps mort."],
				},
			],
			style: "script",
			caption: "Au bureau",
			speakers: { coach: { name: "Coach Lee", avatar: "/assets/lee.png" } },
		});
	});

	it("keeps a checklist item paragraph after a blank line", () => {
		const blocks = readBlockSource(
			"# Untitled {hideTitle}\n\n::: checklist\n- [ ] First\n\n  Second\n:::\n",
		).blocks;
		expect(blocks).toHaveLength(1);
		expect(blocks[0].data.items[0].text).toBe("First Second");
	});

	it("leaves an ordinary list untouched outside a dialogue fence", () => {
		expect(
			readBlockSource("# Untitled {hideTitle}\n\n- Roger: Hi\n- Roxanne: Hello\n").blocks[0].type,
		).toBe("text");
	});

	it("round-trips escaped punctuation in speaker declarations", () => {
		const source =
			"---\n{ cast: { coach: { name: Dr.; Lee, voice: en:CA } } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- coach: Hi\n:::\n";
		const read = readBlockSource(source);
		const [block] = read.blocks;
		expect(block.data.speakers).toEqual({ coach: { name: "Dr.; Lee", voice: "en:CA" } });
		const saved = replayLesson(read);
		expect(saved).toBe(source);
		expect(dialogue(saved).block?.data.speakers).toEqual(block.data.speakers);
	});

	it("round-trips a local speaker side", () => {
		const source =
			"---\n{ cast: { learner: { side: end } } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- learner: Hi\n:::\n";
		const read = readBlockSource(source);
		const [block] = read.blocks;
		expect(block.data.speakers.learner.side).toBe("end");
		expect(replayLesson(read)).toBe(source);
	});
});

describe("dialogue starter and speaker declarations", () => {
	it("has a starter that parses to two attributed turns", () => {
		const result = readBlockSource(grammar4Starter("dialogue"));
		expect(result.warnings).toEqual([]);
		expect(result.blocks[0]).toMatchObject({
			type: "dialogue",
			data: {
				turns: [
					{ speaker: "Alex", paragraphs: ["What should I say when the meeting starts?"] },
					{ speaker: "Sam", paragraphs: ["Start with the goal, then ask what everyone needs."] },
				],
			},
		});
	});

	it("allows two local speaker declarations without errors", () => {
		const source =
			"---\n{ cast: { alex: { name: Alex }, sam: { name: Sam } } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- alex: Hello\n- sam: Hi\n:::\n";
		const result = readBlockSource(source);
		expect(result.warnings).toEqual([]);
		expect(result.blocks[0].data.speakers).toEqual({
			alex: { name: "Alex" },
			sam: { name: "Sam" },
		});
		expect(result.errors).toEqual([]);
	});

	it("keeps an indented unknown key in the first dialogue turn", () => {
		const source =
			"# Fixture {hideTitle}\n\n::: dialogue\n- Alex: Hi\n  aside: text\n- Sam: No speaker\n:::\n";
		const result = readBlockSource(source);
		expect(result.blocks).toHaveLength(1);
		const [block] = result.blocks;
		expect(block.data.turns).toHaveLength(2);
		expect(block.data.turns[0].paragraphs).toEqual(["Hi aside: text"]);
		expect((result.spans.get(block.id)?.startLine ?? -1) + 1).toBe(3);
	});
});
