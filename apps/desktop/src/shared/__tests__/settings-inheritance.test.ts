import { describe, expect, it } from "vitest";
import { resolveDesignSettings, resolveNarrationLocale } from "../settings-inheritance";

describe("language provenance", () => {
	it.each([
		[" fr-CA ", "en", "en", { value: "fr-CA", source: "lesson" }],
		[undefined, "fr", "en", { value: "fr", source: "course" }],
		[undefined, undefined, "fr", { value: "fr", source: "workspace" }],
		[undefined, undefined, undefined, { value: "en", source: "default" }],
		["   ", "en", "fr", { value: "en", source: "course" }],
		[42, undefined, "fr", { value: "fr", source: "workspace" }],
	] as const)(
		"resolves lesson %s, course %s, workspace %s with provenance",
		(lang, locale, defaultLocale, expected) => {
			const result = resolveDesignSettings(
				{ defaultLocale },
				{ title: "Course", lessons: [], locale, design: {} },
				{ lang },
			);
			expect({ value: result.locale, source: result.localeSource }).toEqual(expected);
		},
	);
});

describe("design radius warnings", () => {
	it.each([
		["en", "design.borderRadius is ignored. Courses use look v2 corner radii."],
		["fr", "design.borderRadius est ignoré. Les cours utilisent les rayons de coin du look v2."],
	])("reports each course and lesson setting once in %s", (locale, message) => {
		const result = resolveDesignSettings(
			null,
			{
				title: "Corners",
				lessons: [],
				locale,
				design: { borderRadius: 3 },
			},
			{ design: { borderRadius: 10 } },
		);
		expect(result.designWarnings).toEqual(
			["course", "lesson"].map((source) => ({
				code: "ignored-radius-setting",
				path: "design.borderRadius",
				source,
				message,
			})),
		);
	});
	it("warns even for zero and a matching radius, but not for an absent setting", () => {
		for (const borderRadius of [0, 10, 16])
			expect(
				resolveDesignSettings(null, { title: "Corners", lessons: [], design: { borderRadius } }, {})
					.designWarnings,
			).toHaveLength(1);
		expect(
			resolveDesignSettings(null, { title: "Corners", lessons: [], design: {} }, {}).designWarnings,
		).toEqual([]);
	});
});

describe("design font warnings", () => {
	it.each([
		[
			"en",
			"design.typography.body.fontFamily is ignored. Courses use the Sans pairing; set typography.pairing to sans, book or clear.",
		],
		[
			"fr",
			"design.typography.body.fontFamily est ignoré. Les cours utilisent la combinaison Sans ; choisissez sans, book ou clear avec typography.pairing.",
		],
		[
			"not a locale",
			"design.typography.body.fontFamily is ignored. Courses use the Sans pairing; set typography.pairing to sans, book or clear.",
		],
	])("localizes ignored settings in %s", (locale, message) => {
		const resolved = resolveDesignSettings(
			null,
			{
				title: "Fonts",
				lessons: [],
				locale,
				design: { typography: { body: { fontFamily: ["Poppins", "sans-serif"] } } },
			},
			{},
		);
		expect(resolved.designWarnings).toEqual([
			{
				code: "ignored-font-setting",
				source: "course",
				path: "design.typography.body.fontFamily",
				pairing: "sans",
				message,
			},
		]);
	});
	it("keeps inherited font families and reports the effective pairing for each authored setting", () => {
		const resolved = resolveDesignSettings(
			null,
			{
				title: "Fonts",
				lessons: [],
				design: {
					typography: {
						body: { fontFamily: ["Atkinson Hyperlegible", "sans-serif"] },
						headings: { h2: { fontWeight: 700 } },
					},
				},
			},
			{
				design: {
					typography: { body: { fontWeight: 400 }, headings: { h2: { fontStyle: "italic" } } },
				},
			},
		);
		expect(resolved.design.typography).toMatchObject({
			body: { fontFamily: ["Atkinson Hyperlegible", "sans-serif"], fontWeight: 400 },
			headings: { h2: { fontWeight: 700, fontStyle: "italic" } },
		});
		expect(
			resolved.designWarnings.map((warning) => ({
				source: warning.source,
				path: warning.path,
				pairing: "pairing" in warning ? warning.pairing : undefined,
			})),
		).toEqual([
			{ source: "course", path: "design.typography.headings.h2.fontWeight", pairing: "clear" },
			{ source: "lesson", path: "design.typography.headings.h2.fontStyle", pairing: "clear" },
		]);
	});
});

describe("resolveNarrationLocale", () => {
	it.each([
		[undefined, "fr", "fr"],
		["en", "fr", "en"],
		[undefined, undefined, "en"],
	])("resolves lesson %s and course %s to %s", (lesson, course, expected) => {
		expect(resolveNarrationLocale(lesson, course)).toBe(expected);
	});
});
