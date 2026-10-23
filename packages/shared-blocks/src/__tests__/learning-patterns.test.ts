import schema from "learning-patterns/patterns/self-check/content.schema.json";
import {
	annotate,
	type Content,
	feedback,
	validateContent,
	validateState,
} from "learning-patterns/patterns/self-check/logic.js";
import { strings } from "learning-patterns/patterns/self-check/strings.js";
import { describe, expect, expectTypeOf, it } from "vitest";

const content = {
	task: "Explain the delay.",
	model: "The data arrived late. Could I send the report on Tuesday?",
	parts: [
		{
			id: "reason",
			label: "Reason for the delay",
			missed: "Explain what caused the delay.",
			evidence: "The data arrived late.",
		},
		{
			id: "date",
			label: "New delivery date",
			missed: "Propose a specific delivery date.",
			evidence: "Tuesday",
		},
		{
			id: "tone",
			label: "Respectful wording",
			missed: "Make a clear request without blaming anyone.",
			evidence: null,
		},
	],
} satisfies Content;

describe("pinned self-check dependency", () => {
	it("validates typed content without context and imports its schema", () => {
		const authored: unknown = content;
		validateContent(authored);
		expectTypeOf(authored).toEqualTypeOf<Content>();
		expect(authored).toEqual(content);
		expect(schema.required).toEqual(["task", "parts", "model"]);
	});

	it("returns literal feedback and annotated model spans", () => {
		const result = feedback(content, ["reason"]);
		expectTypeOf(result.count).toEqualTypeOf<number>();
		expect(result).toEqual({
			count: 1,
			total: 3,
			items: [
				{ id: "reason", included: true, label: "Reason for the delay", hint: null },
				{
					id: "date",
					included: false,
					label: "New delivery date",
					hint: "Propose a specific delivery date.",
				},
				{
					id: "tone",
					included: false,
					label: "Respectful wording",
					hint: "Make a clear request without blaming anyone.",
				},
			],
		});
		expect(annotate(content.model, content.parts, ["reason"])).toEqual([
			{ text: "The data arrived late.", partIndex: 0, included: true },
			{ text: " Could I send the report on ", partIndex: null, included: false },
			{ text: "Tuesday", partIndex: 1, included: false },
			{ text: "?", partIndex: null, included: false },
		]);
	});

	it("resolves general-answer French strings", () => {
		expectTypeOf(strings.fr.answer).toEqualTypeOf<string>();
		expect(strings.en.answer).toBe("Your answer");
		expect(strings.fr.answer).toBe("Votre réponse");
		expect(strings.fr.show).toBe("Afficher la rétroaction");
		expect(strings.fr.empty).toBe("Écrivez d'abord votre réponse.");
		expect(Object.keys(strings.fr).sort()).toEqual(Object.keys(strings.en).sort());
	});

	it("accepts known ticks and rejects unknown or duplicate ticks in saved state", () => {
		const state = { answer: "Draft", ticked: ["reason"], shown: true };
		expect(validateState(content, state)).toEqual({
			answer: "Draft",
			ticked: ["reason"],
			shown: true,
		});
		expect(validateState(content, { ...state, ticked: ["unknown"] })).toBeNull();
		expect(validateState(content, { ...state, ticked: ["reason", "reason"] })).toBeNull();
	});
});
