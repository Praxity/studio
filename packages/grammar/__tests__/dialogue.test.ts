import type { PraxityBlock } from "@praxity/content-model/types";
import { describe, expect, it } from "vitest";
import { getManifest, type ValidationConfig, validate as validateBlocks } from "../src/index.ts";
import {
	grammar4Starter,
	readBlockFixture as readBlockSource,
	replayLesson,
} from "./helpers/lesson-fixture.ts";

const validate = (blocks: PraxityBlock[], source: string, config: ValidationConfig = {}) =>
	validateBlocks(blocks, source, { spans: readBlockSource(source).spans, ...config });

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

	it("round-trips turns, paragraphs, parameters and shared parameters", () => {
		const source =
			"---\n{ cast: { coach: { name: Coach Lee }, roger: {}, roxanne: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue {style=bubbles name=opening hide}\n- Roger: Wow !\n- Roxanne: First\n\n  Second\n:::\n";
		const once = replayLesson(readBlockSource(source));
		expect(once).toBe(
			"---\n{ cast: { coach: { name: Coach Lee }, roger: {}, roxanne: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue {style=bubbles name=opening hide}\n- Roger: Wow !\n- Roxanne: First\n\n  Second\n:::\n",
		);
		expect(replayLesson(readBlockSource(once))).toBe(once);
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

	it("never serializes resolved fields", () => {
		const read = readBlockSource(
			"---\n{ cast: { roger: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- Roger: Hi\n:::\n",
		);
		const [block] = read.blocks;
		block.data.turns[0] = { ...block.data.turns[0], name: "Roger R.", avatar: "a.png" };
		expect(replayLesson(read)).toBe(
			"---\n{ cast: { roger: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- Roger: Hi\n:::\n",
		);
	});
});

describe("dialogue registration", () => {
	it("declares the content block, style, caption, and repeatable speaker parameter", () => {
		const entry = getManifest({ include: "all" }).get("dialogue");
		expect(entry?.layer).toBe("content");
		expect(entry?.variants[0]).toMatchObject({
			name: "style",
			options: ["bubbles", "script"],
			default: "bubbles",
		});
		expect(entry?.parameters.map((parameter) => parameter.name)).toEqual([
			"caption",
			"speaker",
			"width",
		]);
	});

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

	it("validates empty and unattributed turns with localized messages and source lines", () => {
		const source = "# Fixture {hideTitle}\n\n::: dialogue\n- Alex: Hello\n:::\n";
		const [block] = readBlockSource(source).blocks;
		delete block.data.turns[0].speaker;
		const en = validate([block], source).errors.find(
			(error) => error.id === "dialogue-turn-speaker",
		);
		expect(en).toMatchObject({ level: "error", category: "content", line: 4 });
		expect(en?.message).toBe("Turn 1 has no speaker. Start it with a speaker key and a colon.");
		const fr = validate([block], source, { frontmatter: { lang: "fr" } }).errors.find(
			(error) => error.id === "dialogue-turn-speaker",
		);
		expect(fr?.message).toBe(
			"La réplique 1 n'a pas d'interlocuteur. Commencez-la par une clé d'interlocuteur suivie de deux-points.",
		);
		block.data.turns = [];
		expect(
			validate([block], source).errors.find((error) => error.id === "dialogue-empty"),
		).toMatchObject({
			level: "error",
			message: "This dialogue has no turns. Add list items like - Alex: Hello.",
			line: 3,
		});
		expect(
			validate([block], source, { frontmatter: { lang: "fr" } }).errors.find(
				(error) => error.id === "dialogue-empty",
			)?.message,
		).toBe("Ce dialogue n'a aucune réplique. Ajoutez des éléments comme - Alex : Bonjour.");
	});

	it("reports malformed persisted dialogue data as empty", () => {
		const source =
			"---\n{ cast: { alex: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- Alex: Hello\n:::\n";
		const [block] = readBlockSource(source).blocks;
		for (const data of [null, "broken", { turns: "broken" }]) {
			block.data = data as never;
			expect(validate([block], source).errors).toContainEqual(
				expect.objectContaining({ id: "dialogue-empty", level: "error", line: 7 }),
			);
		}
	});

	it("diagnoses malformed persisted turns and speaker maps in English and French", () => {
		const source =
			"---\n{ cast: { alex: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- Alex: Hello\n:::\n";
		const [block] = readBlockSource(source).blocks;
		block.data = {
			turns: [null, { speaker: 42, paragraphs: "bad" }, { speaker: "Alex", paragraphs: [42] }],
			speakers: [],
		} as never;
		for (const [lang, expected] of [
			["en", /turn|paragraph|speaker/i],
			["fr", /réplique|paragraphe|interlocuteur/i],
		] as const) {
			const errors = validate([block], source, { frontmatter: { lang } }).errors;
			expect(errors.map((error) => error.id)).toEqual(
				expect.arrayContaining([
					"dialogue-turn-shape",
					"dialogue-paragraphs",
					"dialogue-speakers-shape",
					"dialogue-speaker-shape",
				]),
			);
			expect(errors.every((error) => expected.test(error.message))).toBe(true);
		}
		block.data.speakers = { alex: { name: 42 } } as never;
		expect(validate([block], source).errors.map((error) => error.id)).toContain(
			"dialogue-local-speaker-shape",
		);
	});

	it("allows two local speaker declarations without validation errors", () => {
		const source =
			"---\n{ cast: { alex: { name: Alex }, sam: { name: Sam } } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- alex: Hello\n- sam: Hi\n:::\n";
		const result = readBlockSource(source);
		expect(result.warnings).toEqual([]);
		expect(result.blocks[0].data.speakers).toEqual({
			alex: { name: "Alex" },
			sam: { name: "Sam" },
		});
		expect(validate(result.blocks, source).errors).toEqual([]);
	});

	it("maps validation to the offending item of a multi-turn list", () => {
		const source = "# Fixture {hideTitle}\n\n::: dialogue\n- alex: Hi\n- sam: No speaker\n:::\n";
		const [block] = readBlockSource(source).blocks;
		delete block.data.turns[1].speaker;
		expect(
			validate([block], source).errors.find((error) => error.id === "dialogue-turn-speaker")?.line,
		).toBe(5);
		block.data.style = "invalid";
		expect(
			validate([block], source).errors.find((error) => error.id === "dialogue-style"),
		).toMatchObject({
			level: "warning",
			line: 3,
		});
		expect(
			validate([block], source, { frontmatter: { lang: "fr" } }).errors.find(
				(error) => error.id === "dialogue-style",
			)?.message,
		).toBe("Le style du dialogue doit être bubbles ou script.");
	});

	it("warns when a persisted style is not bubbles or script", () => {
		const source = "# Fixture {hideTitle}\n\n::: dialogue\n- alex: Hi\n:::\n";
		const blocks = readBlockSource(source).blocks;
		blocks[0].data.style = "invalid";
		expect(
			validate(blocks, source).errors.find((error) => error.id === "dialogue-style"),
		).toMatchObject({
			level: "warning",
			line: 3,
		});
	});

	it("locates a dialogue after a plain list with parameters", () => {
		const source =
			"# Fixture {hideTitle}\n\n- Plain item\n\n::: dialogue\n- alex: No speaker\n:::\n";
		const blocks = readBlockSource(source).blocks.filter((block) => block.type === "dialogue");
		expect(blocks).toHaveLength(1);
		delete blocks[0].data.turns[0].speaker;
		blocks[0].data.style = "invalid";
		const errors = validate(blocks, source).errors;
		expect(errors.find((error) => error.id === "dialogue-turn-speaker")?.line).toBe(6);
		expect(errors.find((error) => error.id === "dialogue-style")?.line).toBe(5);
	});

	it("keeps an indented unknown key in the first dialogue turn when mapping lines", () => {
		const source =
			"# Fixture {hideTitle}\n\n::: dialogue\n- Alex: Hi\n  aside: text\n- Sam: No speaker\n:::\n";
		const result = readBlockSource(source);
		expect(result.blocks).toHaveLength(1);
		const [block] = result.blocks;
		expect(block.data.turns).toHaveLength(2);
		expect(block.data.turns[0].paragraphs).toEqual(["Hi aside: text"]);
		expect((result.spans.get(block.id)?.startLine ?? -1) + 1).toBe(3);
		delete block.data.turns[1].speaker;
		const warning = validate([block], source).errors.find(
			(error) => error.id === "dialogue-turn-speaker",
		);
		expect(source.split("\n")[(warning?.line ?? 0) - 1]).toBe("- Sam: No speaker");
	});
});
