import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readLesson } from "../src/read-lesson.ts";
import { withoutNodeIdentity } from "./helpers/lesson-fixture.ts";

describe("free-response descriptions", () => {
	it.each(["en", "fr"])("preserves all paragraphs and nested lists in %s", (locale) => {
		const source = readFileSync(
			new URL(`./fixtures/free-response-description.${locale}.prax`, import.meta.url),
			"utf8",
		);
		const read = readLesson(source);
		expect(read.errors).toEqual([]);
		const description = read.blocks.find((block) => block.type === "assessment")?.data
			.description as { data: { content: string } }[];
		expect(description).toHaveLength(4);
		expect(description.map((block) => withoutNodeIdentity(block.data.content))).toEqual(
			locale === "en"
				? [
						"<p>First <strong>paragraph</strong>.</p>",
						'<p>Second <em>paragraph</em> with a <a href="https://example.com/guide">guide</a>.</p>',
						"<ul><li>First idea.<ol><li>Nested idea.</li><li>Another idea.</li></ol></li><li>Last idea.</li></ul>",
						"<p>Final paragraph.</p>",
					]
				: [
						"<p>Premier <strong>paragraphe</strong>.</p>",
						'<p>Deuxième <em>paragraphe</em> avec un <a href="https://example.com/guide">guide</a>.</p>',
						"<ul><li>Première idée.<ol><li>Idée imbriquée.</li><li>Autre idée.</li></ol></li><li>Dernière idée.</li></ul>",
						"<p>Dernier paragraphe.</p>",
					],
		);
	});

	it("keeps the three French reflection prompts from the content inventory", () => {
		const read = readLesson(
			readFileSync(
				new URL("./fixtures/free-response-list-inventory.prax", import.meta.url),
				"utf8",
			),
		);
		expect(read.errors).toEqual([]);
		const description = read.blocks.find((block) => block.type === "assessment")?.data
			.description as { data: { content: string } }[];
		expect(description?.map((block) => withoutNodeIdentity(block.data.content))).toEqual([
			"<ul><li>Qu’avez-vous ressenti ?</li><li>Comment l’autre personne a-t-elle réagi ?</li><li>Qu’avez-vous appris ?</li></ul>",
		]);
	});

	it.each([
		"![Diagram](https://example.com/image.png)",
		"| Heading |\n| --- |\n| Cell |",
		"---",
		"## Supporting heading",
		"::: note\nSupporting note.\n:::",
		"```js\nconst value = 1;\n```",
		"$$\nx^2\n$$",
		"::: text\n::: note\nNested note.\n:::\n:::",
		"::: text\n```js\nconst value = 1;\n```\n:::",
	])("refuses unsupported description structure at its source: %s", (body) => {
		const source = `# Reflection\n::: free-response Reflect.\n${body}\n:::\n`;
		const read = readLesson(source);
		expect(read.hasErrors).toBe(true);
		const error = read.errors.find(
			(error) => error.messageRef.key === "grammar.v4.disallowed-child",
		);
		expect(error).toMatchObject({ line: body.startsWith("::: text") ? 4 : 3 });
		expect(error?.messageRef.args).toMatchObject({ type: "free-response" });
	});

	it("keeps a text wrapper and loose list continuations", () => {
		const read = readLesson(
			"# Reflection\n::: free-response Reflect.\n::: text\nBefore.\n\n- First.\n\n  Continued.\n\n- Last.\n\nAfter.\n:::\n:::\n",
		);
		expect(read.errors).toEqual([]);
		const description = read.blocks.find((block) => block.type === "assessment")?.data
			.description as { data: { content: string } }[];
		expect(withoutNodeIdentity(description[0].data.content)).toBe(
			"<p>Before.</p><ul><li><p>First.</p><p>Continued.</p></li><li><p>Last.</p></li></ul><p>After.</p>",
		);
	});
});
