import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseLessonSource } from "../lesson-source";

it("returns resolved turns and dialogue warnings from the lesson parse point", async () => {
	const courseDir = await mkdtemp(join(tmpdir(), "prax-dialogue-cast-"));
	try {
		const source =
			"---\ncast: {roger: {}, zed: {}}\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- Roger: Hi\n- Zed: Hey\n:::\n";
		await writeFile(join(courseDir, "lesson.prax"), source);
		const parsed = await parseLessonSource(courseDir, "lesson.prax", source, {
			cast: { roger: { name: "Roger R." } },
		});
		const dialogue = parsed.blocks.find((block) => block.type === "dialogue");
		if (!dialogue) throw new Error("Missing lesson dialogue fixture");
		expect(dialogue.data.turns).toEqual([
			{
				id: expect.stringMatching(/^rt-[0-9a-f]{32}$/),
				speaker: "Roger",
				paragraphs: ["Hi"],
				name: "Roger R.",
			},
			{
				id: expect.stringMatching(/^rt-[0-9a-f]{32}$/),
				speaker: "Zed",
				paragraphs: ["Hey"],
				name: "Zed",
			},
		]);
		expect(parsed.dialogueWarnings).toEqual([
			{
				blockId: dialogue.id,
				code: "unknown-speaker",
				speaker: "Zed",
			},
		]);
	} finally {
		await rm(courseDir, { recursive: true, force: true });
	}
});
