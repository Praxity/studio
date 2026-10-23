import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { generateHtmlPages } from "../src/html-pages";
import { deckPageData } from "../src/module-deck";
import { moduleDeckFixture } from "./fixtures/module-deck";

describe("deck transcript titles", () => {
	it.each(["light", "dark"] as const)(
		"separates note and journal titles and question prompts from their bodies in %s mode",
		async (colorMode) => {
			const course = moduleDeckFixture(undefined, "fr");
			const page = course.content[0];
			page.blocks = adaptGrammarPreviewBlocks([
				{
					id: "journal-note",
					type: "note",
					data: {
						title: "Votre journal d'apprentissage",
						content: "<p>Tenez un journal pendant ce parcours.</p>",
						narration: "Votre journal d'apprentissage Tenez un journal pendant ce parcours.",
						narrationAudio: "note.mp3",
						narrationTimings: "note.vtt",
					},
				},
				{
					id: "journal-group",
					type: "assessmentGroup",
					data: {
						groupName: "Votre journal de la semaine",
						instructions: "Gardez vos observations.",
						memberBlockIds: ["reflection"],
					},
				},
				{
					id: "reflection",
					type: "assessment",
					data: {
						assessmentType: "textResponse",
						stem: [
							{
								id: "reflection-stem",
								type: "text",
								data: { content: "Réflexion : qu'avez-vous observé cette semaine ?" },
							},
						],
						description: [
							{
								id: "reflection-description",
								type: "text",
								data: { content: "Quand et avec qui avez-vous essayé ?" },
							},
						],
						response: { type: "textResponse" },
					},
				},
				{
					id: "untitled",
					type: "note",
					data: { content: "Une note sans titre." },
				},
				{
					id: "custom",
					type: "note",
					data: { title: "Titre du résumé", narration: "Un autre **script**." },
				},
			]);
			page.narrationEnabled = true;
			const directory = await mkdtemp(join(tmpdir(), "deck-reading-markup-"));
			try {
				const result = await generateHtmlPages(
					{
						id: course.id,
						title: course.title,
						sourceLocale: "fr",
						colorMode,
						moduleDeck: {},
						pages: [page],
						totalPages: 1,
					},
					directory,
					{
						loaderFilename: "loader.js",
						islandFilenames: {
							deck: "deck.js",
							assessment: "assessment.js",
							assessmentGroup: "assessment-group.js",
							narration: "narration.js",
							nav: "nav.js",
						},
					},
				);
				const html = await readFile(join(directory, `${result.pages[0].slug}.html`), "utf8");
				const document = new JSDOM(html).window.document;
				const reading = document.querySelector('[data-deck-reading="slide-1"]');
				for (const [id, title, body] of [
					[
						"journal-note",
						"Votre journal d'apprentissage",
						"Tenez un journal pendant ce parcours.",
					],
					["journal-group", "Votre journal de la semaine", "Gardez vos observations."],
					[
						"reflection",
						"Réflexion : qu'avez-vous observé cette semaine ?",
						"Quand et avec qui avez-vous essayé ?",
					],
				]) {
					const content = reading?.querySelector(`[data-block-id="slide-1:${id}"]`);
					expect(content?.firstElementChild?.tagName).toBe("P");
					expect(content?.firstElementChild?.innerHTML).toBe(`<strong>${title}</strong>`);
					expect(content?.children[1]?.tagName).toBe("P");
					expect(content?.children[1]?.textContent).toContain(body);
					expect(content?.textContent?.split(title)).toHaveLength(2);
				}
				expect(reading?.querySelector('[data-block-id="slide-1:untitled"]')?.innerHTML).toBe(
					"<p>Une note sans titre.</p>",
				);
				expect(reading?.querySelector('[data-block-id="slide-1:custom"]')?.innerHTML).toBe(
					"<p>Un autre <strong>script</strong>.</p>",
				);
				expect(deckPageData(page, {}, "one", "one", "fr").segments[1]).toMatchObject({
					id: "slide-1:journal-note",
					script: "Votre journal d'apprentissage Tenez un journal pendant ce parcours.",
					src: "note.mp3",
					timings: "note.vtt",
				});
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		},
	);
});
