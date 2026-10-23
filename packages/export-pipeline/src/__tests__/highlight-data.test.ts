import { expect, it } from "vitest";
import { assertHighlightData } from "../practice-admission";
import { renderBlockHtml } from "../render-block-html";

const content = {
	mode: "key",
	title: "PRIVATE-TITLE",
	paragraphs: [[{ id: "target", text: "PRIVATE-TARGET", key: true, note: "PRIVATE-NOTE" }]],
};
it.each(["en", "fr"])(
	"admits public content and wraps upstream errors without excerpts in %s",
	(locale) => {
		expect(() =>
			assertHighlightData({ content }, "block", "pages[0].blocks[1].data", locale),
		).not.toThrow();
		for (const data of [
			null,
			[],
			{},
			{ content: null },
			{
				content: {
					...content,
					paragraphs: [[{ id: "PRIVATE-BAD ID", text: "PRIVATE-TEXT", key: true }]],
				},
			},
			{ content: { ...content, mode: "PRIVATE-MODE" } },
			{ content: { ...content, "PRIVATE-FIELD": "PRIVATE-VALUE" } },
			{
				get content() {
					throw new Error("PRIVATE-GETTER");
				},
			},
		]) {
			let error: unknown;
			try {
				assertHighlightData(data, "block", "pages[0].blocks[1].data", locale);
			} catch (caught) {
				error = caught;
			}
			expect(error).toMatchObject({
				name: "PracticeAdmissionError",
				message:
					locale === "fr"
						? "La bibliothèque de surlignage refuse ce contenu. Vérifiez les passages, les cibles et les explications."
						: "The highlight library refuses this content. Check the passages, targets and explanations.",
				code: "highlight-invalid",
				blockId: "block",
				referencePath: "pages[0].blocks[1].data",
				messageRef: { key: "grammar.v4.highlight-invalid" },
			});
			expect(String(error) + JSON.stringify(error)).not.toMatch(/PRIVATE-/);
		}
	},
);
it.each(["en", "fr"])(
	"guards raw renderer input before rendering valid publication in %s",
	(locale) => {
		for (const data of [
			null,
			[],
			false,
			{
				get content() {
					throw new Error("PRIVATE-GETTER");
				},
			},
			{ content: { ...content, "PRIVATE-FIELD": "PRIVATE-VALUE" } },
			{
				content: {
					...content,
					paragraphs: [[{ id: "PRIVATE-BAD ID", text: "PRIVATE-TEXT", key: true }]],
				},
			},
		]) {
			let error: unknown;
			try {
				renderBlockHtml(
					{ id: "hl", type: "highlight", data: data as never },
					{ sourceLocale: locale },
				);
			} catch (caught) {
				error = caught;
			}
			expect(error).toMatchObject({
				code: "highlight-invalid",
				message:
					locale === "fr"
						? "La bibliothèque de surlignage refuse ce contenu. Vérifiez les passages, les cibles et les explications."
						: "The highlight library refuses this content. Check the passages, targets and explanations.",
				blockId: "hl",
				referencePath: "data",
				messageRef: { key: "grammar.v4.highlight-invalid" },
			});
			expect(error).not.toHaveProperty("line");
			expect(error).not.toHaveProperty("column");
			expect(String(error) + JSON.stringify(error)).not.toContain("PRIVATE-");
		}
		const html = renderBlockHtml(
			{ id: "hl", type: "highlight", data: { content } },
			{ sourceLocale: locale },
		);
		expect(html).toContain("data-highlight");
		expect(html).toContain("PRIVATE-TARGET");
	},
);
