import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { extractNarrationSegments } from "@praxity/shared-blocks/narration";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { expect, it } from "vitest";
import {
	type PdfAssessmentContext,
	renderPdfAssessment,
} from "../../format-renderers/src/pipelines/course-pdf-assessments";
import { renderBlockHtml } from "../src/render-block-html";

function question(response: Record<string, unknown>, extra: Record<string, unknown>): PraxityBlock {
	return {
		id: "question",
		type: "assessment",
		data: { stem: [{ id: "stem", type: "text", data: { content: "Prompt" } }], response, ...extra },
	};
}
const pdfContext: PdfAssessmentContext = {
	locale: "en",
	includeAnswers: false,
	number: 1,
	rich: (value) => String(value),
	renderBlocks: () => "Prompt",
	image: () => "",
	fail: (message) => {
		throw new Error(message);
	},
};

it.each(["group-pass", "group-score", "deck-pass", "practice"])(
	"uses one resolved option in HTML, narration and print: %s",
	(scope) => {
		for (const explicit of [undefined, true, false]) {
			const q = question(
				{
					type: "choice",
					selectionMode: "single",
					options: [
						{ id: "a", label: "First", isCorrect: true },
						{ id: "b", label: "Last" },
					],
				},
				{
					assessmentType: "choice",
					gradingMode: "none",
					required: false,
					...(explicit === undefined ? {} : { dontKnow: explicit }),
				},
			);
			const blocks: PraxityBlock[] = scope.startsWith("group")
				? [
						{
							id: "group",
							type: "assessmentGroup",
							data: {
								memberBlockIds: ["question"],
								...(scope === "group-pass" ? { deckGate: "pass" } : { passingScore: 80 }),
							},
						},
						q,
					]
				: [q];
			const normalized = adaptGrammarPreviewBlocks(blocks, undefined, "en", {
				moduleDeck: scope === "deck-pass" ? { gates: { question: "pass" } } : undefined,
			});
			const resolved = normalized.find((block) => block.id === "question");
			if (!resolved) throw new Error("Missing question");
			const offered = explicit ?? scope === "practice";
			expect(renderBlockHtml(resolved).includes("data-dont-know")).toBe(offered);
			expect(
				renderBlockHtml(resolved).includes('class="praxity-choice-key-spacer" aria-hidden="true"'),
			).toBe(offered);
			expect(renderPdfAssessment(resolved, pdfContext).body.includes("I don't know")).toBe(offered);
			expect(
				extractNarrationSegments("", {}, normalized).some(({ script }) =>
					script.includes("I don't know"),
				),
			).toBe(offered);
		}
	},
);
