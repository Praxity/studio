import { describe, expect, it } from "vitest";
import { getNextPageUnavailable } from "../completion-gate-strings";
import { getStrings, supportedLocales } from "../strings";

describe("shared-blocks i18n strings", () => {
	it("returns English strings by default", () => {
		const s = getStrings("en");
		expect(s.next).toBe("Next");
		expect(s.previous).toBe("Previous");
	});

	it("returns French strings", () => {
		const s = getStrings("fr");
		expect(s.next).toBe("Suivant");
		expect(s.previous).toBe("Précédent");
	});

	it.each([
		["en", "Open {title}"],
		["fr", "Ouvrir {title}"],
	])("keeps the %s media action separate from the new-tab warning", (locale, expected) => {
		expect(getStrings(locale).mediaOpen).toBe(expected);
		expect(getStrings(locale)).not.toHaveProperty("mediaOpenInNewTab");
	});

	it("distinguishes page and module visits from actual completion in both locales", () => {
		const en = getStrings("en");
		const fr = getStrings("fr");
		expect(en.visitedPage).toBe("Visited");
		expect(en.visitedModule).toBe("Visited");
		expect(fr.visitedPage).toBe("Consultée");
		expect(fr.visitedModule).toBe("Consulté");
		expect(en.completed).toBe("Completed");
		expect(fr.completed).toBe("Terminé");
	});

	// NVDA reads the resume prefix line and the title as one run of layout text. An
	// ordinary trailing space collapses at the line end, so NVDA said "6:Build".
	it.each(supportedLocales)("ends %s resume prefixes with a non-breaking space", (locale) => {
		const s = getStrings(locale);
		for (const prefix of [s.scormResumePositionPrefix, s.deckResumePositionPrefix]) {
			expect(prefix.endsWith(": ")).toBe(true);
		}
	});

	it("falls back to English for unknown locales", () => {
		const s = getStrings("zz");
		expect(s.next).toBe("Next");
	});

	it.each([
		["en", "The next page is unavailable."],
		["EN-US", "The next page is unavailable."],
		["fr", "La page suivante est indisponible."],
		["FR-CA", "La page suivante est indisponible."],
		["zz", "The next page is unavailable."],
		["", "The next page is unavailable."],
	])("uses the same completion fallback in both catalogs for %j", (locale, expected) => {
		expect(getNextPageUnavailable(locale)).toBe(expected);
		expect(getStrings(locale).nextPageUnavailable).toBe(expected);
	});

	it("has the same keys for all supported locales", () => {
		const enKeys = Object.keys(getStrings("en")).sort();
		for (const locale of supportedLocales) {
			const keys = Object.keys(getStrings(locale)).sort();
			expect(keys).toEqual(enKeys);
		}
	});

	it("has no empty values in any locale", () => {
		for (const locale of supportedLocales) {
			const s = getStrings(locale);
			const empty = Object.entries(s).filter(([, v]) => !v.trim());
			expect(empty, `Empty values in ${locale}`).toEqual([]);
		}
	});

	it("has matching template variables across locales", () => {
		const varPattern = /\{(\w+)\}/g;
		const en = getStrings("en");
		for (const locale of supportedLocales) {
			if (locale === "en") continue;
			const localeStrings = getStrings(locale);
			for (const key of Object.keys(en) as (keyof typeof en)[]) {
				const enVars = [...en[key].matchAll(varPattern)].map((m) => m[1]).sort();
				const localeVars = [...localeStrings[key].matchAll(varPattern)].map((m) => m[1]).sort();
				expect(localeVars, `Mismatched vars in "${key}" for ${locale}`).toEqual(enVars);
			}
		}
	});
});
