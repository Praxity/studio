import schema from "learning-patterns/patterns/self-check/content.schema.json";
import {
	type Content,
	validateContent,
	validateState,
} from "learning-patterns/patterns/self-check/logic.js";
import { strings } from "learning-patterns/patterns/self-check/strings.js";
import { expect, it } from "vitest";

const content = (): Content => ({
	task: "Task",
	model: "Model",
	parts: [{ id: "part", label: "Label", missed: "Hint", evidence: null }],
});
const limits = [
	["task", 400],
	["model", 1500],
	["id", 120],
	["label", 120],
	["missed", 1500],
	["evidence", 1500],
	["to", 120],
	["initials", 120],
	["subject", 120],
	["placeholder", 120],
] as const;
function field(name: (typeof limits)[number][0], text: string): Content {
	const value = content();
	if (name === "task" || name === "model") value[name] = text;
	else if (name === "id" || name === "label" || name === "missed" || name === "evidence") {
		value.parts[0][name] = text;
		// Keep the model admissible when evidence overflows: isolate the field's
		// length error rather than failing the earlier model check.
		if (name === "evidence") value.model = text === "x".repeat(1500) ? text : "Model";
	} else value.context = { to: "A", initials: "AB", subject: "Subject", [name]: text };
	return value;
}
it.each(limits)("enforces the inclusive %s maximum %i without mutation", (name, maximum) => {
	const valid = field(name, "x".repeat(maximum));
	const original = structuredClone(valid);
	expect(() => validateContent(valid)).not.toThrow();
	expect(valid).toEqual(original);
	const invalid = field(name, "x".repeat(maximum + 1));
	const oversized = structuredClone(invalid);
	const path =
		name === "task" || name === "model"
			? name
			: ["id", "label", "missed", "evidence"].includes(name)
				? `parts[0].${name}`
				: `context.${name}`;
	expect(() => validateContent(invalid)).toThrow(`Invalid ${path}: maximum ${maximum} characters`);
	expect(invalid).toEqual(oversized);
	const property =
		name === "task" || name === "model"
			? schema.properties[name]
			: name === "id" || name === "label" || name === "missed" || name === "evidence"
				? schema.properties.parts.items.properties[name]
				: schema.properties.context.properties[name];
	expect(property.maxLength).toBe(maximum);
});
it("counts astral code points, combining marks and whitespace without normalization", () => {
	for (const [task, allowed] of [
		["😀".repeat(400), true],
		["😀".repeat(401), false],
		["e\u0301".repeat(200), true],
		["e\u0301".repeat(200) + "x", false],
		[" ".repeat(400), true],
		[" ".repeat(401), false],
	] as const) {
		const value = { ...content(), task };
		if (allowed) expect(() => validateContent(value)).not.toThrow();
		else expect(() => validateContent(value)).toThrow("Invalid task");
		expect(value.task).toBe(task);
	}
});
it("retains long learner drafts and has no criterion-count cap", () => {
	const value = content();
	value.parts = Array.from({ length: 1000 }, (_, i) => ({ ...value.parts[0], id: `part-${i}` }));
	expect(() => validateContent(value)).not.toThrow();
	const state = { answer: "😀".repeat(10000), ticked: ["part-999"], shown: true };
	expect(validateState(value, state)).toEqual(state);
});
it("adopts exactly the five consumed C1 strings and preserves Studio's summary owner", () => {
	expect([
		strings.en.tick,
		strings.fr.tick,
		strings.en.whole,
		strings.fr.whole,
		strings.en.cleared,
	]).toEqual([
		"Tick each part your answer includes.",
		"Cochez chaque élément présent dans votre réponse.",
		"Whole answer",
		"Toute la réponse",
		"Answer cleared.",
	]);
	expect(strings.fr.cleared).toBe("Réponse effacée.");
});
