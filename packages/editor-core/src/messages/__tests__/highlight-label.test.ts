import { expect, it } from "vitest";
import en from "../en.json";
import fr from "../fr.json";

it.each([
	["en", en, "Highlight practice"],
	["fr", fr, "Exercice de surlignage"],
] as const)("owns the %s highlight block-type label", (_locale, messages, expected) => {
	expect(messages.a11yAudit.blockTypes.highlight).toBe(expected);
	expect(messages.session.labels.grammar_v4_type_highlight).toBe(expected);
});
