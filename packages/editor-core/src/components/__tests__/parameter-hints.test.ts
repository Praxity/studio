import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

type Hints = Record<string, string>;
const hints = (m: unknown): Hints =>
	(m as { editor: { slashMenu: { parameterHints: Hints } } }).editor.slashMenu.parameterHints;

describe("parameter hints", () => {
	it("translates every hint", () => {
		expect(Object.keys(hints(fr)).sort()).toEqual(Object.keys(hints(en)).sort());
		for (const [key, value] of Object.entries(hints(fr))) {
			expect(value, `${key} not translated`).toBeTruthy();
			expect(value, `${key} left in English`).not.toBe(hints(en)[key]);
		}
	});

	it("never just restates the parameter name", () => {
		// The whole point: a hint that repeats the label is worse than none, because it
		// costs a line of the menu and tells the author nothing.
		for (const [key, value] of Object.entries(hints(en))) {
			const words = value.toLowerCase().split(/\s+/);
			expect(words.length, `${key} hint is a single word`).toBeGreaterThan(1);
			expect(value.toLowerCase(), `${key} hint restates the name`).not.toBe(key.toLowerCase());
		}
	});

	it("stays short enough for one menu line", () => {
		for (const [key, value] of Object.entries({ ...hints(en), ...hints(fr) })) {
			expect(value.length, `${key} hint is too long: ${value}`).toBeLessThanOrEqual(46);
		}
	});

	it("reads as a sentence fragment, not a heading", () => {
		// Sentence case, no trailing full stop — these sit under a label, not alone.
		for (const [key, value] of Object.entries(hints(en))) {
			expect(value, `${key} ends with a full stop`).not.toMatch(/\.$/);
			expect(value[0], `${key} starts capitalised`).toBe(value[0].toLowerCase());
		}
	});
});
