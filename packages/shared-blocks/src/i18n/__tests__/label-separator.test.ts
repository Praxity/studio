import { describe, expect, it } from "vitest";
import { labelWithSeparator } from "../label-separator.ts";

describe("generated label separators", () => {
	it.each(["fr", "fr-CA", "fr-FR"])("uses a narrow no-break space for %s", (locale) => {
		expect(labelWithSeparator("Indice", locale)).toBe("Indice\u202f: ");
		for (const punctuation of ["?", "!", ";"] as const)
			expect(labelWithSeparator("Libellé", locale, punctuation)).toBe(
				`Libellé\u202f${punctuation} `,
			);
	});
	it("retains English separators", () => {
		expect(labelWithSeparator("Hint", "en")).toBe("Hint: ");
		expect(labelWithSeparator("Hint", "en-CA")).toBe("Hint: ");
	});
});

it.each([
	{
		label: "This doesn't answer the question.",
		locale: "en",
		expected: "This doesn't answer the question: ",
	},
	{ label: "Key idea", locale: "en", expected: "Key idea: " },
	{
		label: "Ce passage ne répond pas à la question.",
		locale: "fr",
		expected: "Ce passage ne répond pas à la question\u202f: ",
	},
	{ label: "Idée clé", locale: "fr", expected: "Idée clé\u202f: " },
])("adds one separator to $label in $locale", ({ label, locale, expected }) => {
	expect(labelWithSeparator(label, locale)).toBe(expected);
});
