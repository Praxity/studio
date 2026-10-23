import { describe, expect, it } from "vitest";
import { canvasMessages, editButtonName } from "../canvas-messages";

const prefixes = {
	en: ["Edit heading", "Edit paragraph", "Edit list item", "Edit choice label", "Edit caption"],
	fr: [
		"Modifier le titre",
		"Modifier le paragraphe",
		"Modifier l'élément de liste",
		"Modifier le libellé du choix",
		"Modifier la légende",
	],
};
const kinds = ["heading", "paragraph", "listItem", "choiceLabel", "caption"] as const;
const adversarial = [
	"Repeated paragraph., position 2",
	"Use {position} here.",
	"{n}",
	"{text}",
	"$&",
	"$1",
	"$$",
	"Edit paragraph 2: Another name",
	"Modifier le paragraphe 2 : Autre nom",
	"123",
	"مرحبا بالعالم",
];

for (const lang of ["en", "fr"] as const) {
	const messages = canvasMessages[lang];
	const separator = lang === "fr" ? " : " : ": ";
	describe(`Edit button names, ${lang}`, () => {
		it.each(adversarial)("keeps authored text literal: %s", (text) => {
			expect(editButtonName(messages, "paragraph", 3, text)).toBe(
				`${prefixes[lang][1]} 3${separator}${text}`,
			);
		});
		it.each(["", " \n\t "])("omits the separator for empty text %j", (text) => {
			expect(editButtonName(messages, "heading", 1, text)).toBe(`${prefixes[lang][0]} 1`);
		});
		it("collapses whitespace and keeps 40 whole graphemes, with an ellipsis only when cut", () => {
			expect(editButtonName(messages, "paragraph", 1, " \n First\t  second. \n")).toBe(
				`${prefixes[lang][1]} 1${separator}First second.`,
			);
			for (const grapheme of ["e\u0301", "🇨🇦", "👩🏽‍💻"]) {
				expect(editButtonName(messages, "caption", 12, `${"a".repeat(39)}${grapheme}z`)).toBe(
					`${prefixes[lang][4]} 12${separator}${"a".repeat(39)}${grapheme}…`,
				);
				expect(editButtonName(messages, "caption", 12, `${"a".repeat(39)}${grapheme}`)).toBe(
					`${prefixes[lang][4]} 12${separator}${"a".repeat(39)}${grapheme}`,
				);
			}
		});
		it.each([...adversarial, "", " ", "a".repeat(500)])(
			"keeps 10,000 ordinals per kind distinct: %s",
			(text) => {
				// One document per adversarial text; changing text on the same run may keep its name.
				const names = new Set<string>();
				for (const [index, kind] of kinds.entries()) {
					for (let n = 1; n <= 10_000; n++) {
						const name = editButtonName(messages, kind, n, text);
						const prefix = `${prefixes[lang][index]} ${n}`;
						if (name !== prefix && !name.startsWith(prefix + separator))
							throw new Error(`Unexpected name: ${name}`);
						names.add(name);
					}
				}
				expect(names.size).toBe(50_000);
			},
		);
		it("has no ambiguous kind prefixes", () => {
			const starts = prefixes[lang].map((prefix) => `${prefix} 1${separator}`);
			for (const start of starts)
				expect(starts.filter((other) => other.startsWith(start))).toEqual([start]);
		});
	});
}
