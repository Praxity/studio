import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { extractNarrationSegments } from "@praxity/shared-blocks/narration";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { computeAccessibleName } from "dom-accessibility-api";
import { JSDOM } from "jsdom";
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

it.each([
	["en", "I don't know"],
	["fr", "Je ne sais pas"],
] as const)("keeps the shell marker decorative in %s", (locale, label) => {
	const block = question(
		{
			type: "choice",
			selectionMode: "single",
			options: [
				{ id: "a", label: "Amber" },
				{ id: "b", label: "Blue" },
			],
		},
		{ assessmentType: "choice", gradingMode: "none", _dontKnow: true },
	);
	const dom = new JSDOM(renderBlockHtml(block, { sourceLocale: locale }));
	try {
		const radios = dom.window.document.querySelectorAll("input[type=radio]");
		expect(radios).toHaveLength(3);
		const radio = radios[2];
		expect(computeAccessibleName(radio)).toBe(label);
		const keys = radio.closest("label")?.querySelectorAll(".praxity-choice-key");
		expect(keys).toHaveLength(1);
		expect(keys?.[0].getAttribute("aria-hidden")).toBe("true");
		expect(keys?.[0].childNodes.length).toBe(0);
	} finally {
		dom.window.close();
	}
});

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
			const dom = new JSDOM(renderBlockHtml(resolved));
			try {
				const row = dom.window.document.querySelector("[data-dont-know]");
				expect(Boolean(row)).toBe(offered);
				if (offered) {
					expect(row?.querySelectorAll(".praxity-choice-key")).toHaveLength(1);
					expect(row?.querySelector(".praxity-choice-key")?.getAttribute("aria-hidden")).toBe(
						"true",
					);
					expect(row?.querySelector(".praxity-choice-key")?.textContent).toBe("");
					const radio = row?.querySelector("input");
					if (!radio) throw new Error("Missing unknown radio");
					expect(computeAccessibleName(radio)).toBe("I don't know");
				}
			} finally {
				dom.window.close();
			}
			expect(renderPdfAssessment(resolved, pdfContext).body.includes("I don't know")).toBe(offered);
			expect(
				extractNarrationSegments("", {}, normalized).some(({ script }) =>
					script.includes("I don't know"),
				),
			).toBe(offered);
		}
	},
);
