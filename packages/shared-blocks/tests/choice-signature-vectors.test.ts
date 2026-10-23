import { createHash } from "node:crypto";
import {
	inlineParagraph,
	materialInlineTree,
	renderInlineTree,
} from "@praxity/content-model/inline-tree";
import { describe, expect, it } from "vitest";
import {
	choiceContentSignature,
	choiceMaterialContent,
	choiceMaterialSignature,
	choiceStateQuestion,
} from "../src/assessment-choice";
import type { AssessmentBlockData } from "../src/types";
import { fieldQuestion, producers } from "./fixtures/choice-material";
import { exemptHtml, rebuild } from "./fixtures/choice-signature-html";
import vectors from "./fixtures/choice-signature-vectors.json";

it.each(producers)("$name erasure is idempotent for retained whole-mark paragraphs", (producer) => {
	for (const source of ["==Yes==", "@circle{Yes}", "[Yes]{Definition}", "**==Yes==**"]) {
		const once = materialInlineTree(inlineParagraph(producer.parse(source)), true);
		if (!once) throw new Error("Whole-label text was erased");
		const twice = materialInlineTree(once, true);
		expect(twice ? renderInlineTree(twice) : "").toBe(
			source === "**==Yes==**" ? "<p><strong>Yes</strong></p>" : "<p>Yes</p>",
		);
		expect(choiceMaterialContent(renderInlineTree(once))).toEqual(
			choiceMaterialContent(twice ? renderInlineTree(twice) : ""),
		);
	}
});

function data(stem: string): AssessmentBlockData {
	return { ...structuredClone(vectors.question.data), stem } as AssessmentBlockData;
}

it.each(vectors.inline)("pins both node producers for $source", (vector) => {
	for (const producer of producers) {
		const tree = producer.parse(vector.source),
			material = materialInlineTree(tree, true);
		const html = material ? renderInlineTree(material) : "";
		expect(renderInlineTree(tree)).toBe(vector.interactive);
		expect(renderInlineTree(tree, { interactive: false })).toBe(vector.label);
		expect(html).toBe(vector.material);
		expect(choiceMaterialContent(html)).toEqual(vector.canonical);
		expect(choiceMaterialSignature([html])).toBe(vector.hash);
		expect(choiceContentSignature(fieldQuestion(vector.source, "stem", producer), false)).toBe(
			vector.signature,
		);
	}
});
describe("choice material literals", () => {
	it.each(vectors.vectors)(
		"pins $name and round-trips every retained node",
		({ html, canonical, hash }) => {
			const tree = choiceMaterialContent(html);
			expect(tree).toEqual(canonical);
			expect(choiceMaterialSignature(tree)).toBe(hash);
			expect(createHash("sha256").update(JSON.stringify(canonical)).digest("hex")).toBe(
				hash.slice(7),
			);
			const rebuilt = rebuild(tree);
			expect(choiceMaterialContent(rebuilt)).toEqual(tree);
			expect(exemptHtml(rebuilt)).toBe(exemptHtml(html));
		},
	);

	it("pins the complete version-3 question payload with independent hashes", () => {
		const question = choiceStateQuestion(data("Pick"), false);
		expect(question.materialSignature).toBe(choiceMaterialSignature(vectors.question.question));
		expect(question.options.map((option) => option.materialSignature)).toEqual(
			vectors.question.options.map(choiceMaterialSignature),
		);
		expect(choiceContentSignature(data("Pick"), false)).toBe(vectors.question.hash);
		expect(choiceMaterialSignature(vectors.question.payload)).toBe(vectors.question.hash);
	});
});
