import { resolveDeckDesign } from "@praxity/grammar";
import { describe, expect, it } from "vitest";
import type { CourseManifest } from "../../shared/course-manifest";
import { resolveDesignSettings } from "../../shared/settings-inheritance";
import type { WorkspaceConfig } from "../../shared/types";

it("merges lesson ordering per key without losing the course flow setting", () => {
	expect(
		resolveDeckDesign(
			resolveDesignSettings(null, { title: "Course", lessons: [], design: {} }, {}).design.deck,
		).sequentialLessons,
	).toBe(false);
	for (const sequentialLessons of [true, false]) {
		const course = { title: "Course", lessons: [], design: { deck: { sequentialLessons } } };
		for (const deck of [undefined, { slideCounter: false }, { sequentialLessons: "false" }]) {
			expect(
				resolveDeckDesign(resolveDesignSettings(null, course, { design: { deck } }).design.deck)
					.sequentialLessons,
			).toBe(sequentialLessons);
		}
		expect(
			resolveDeckDesign(
				resolveDesignSettings(null, course, {
					design: { deck: { sequentialLessons: !sequentialLessons } },
				}).design.deck,
			).sequentialLessons,
		).toBe(!sequentialLessons);
	}
});

describe("resolveDesignSettings", () => {
	it.each([
		["fr", "en", "en", "fr"],
		[undefined, "fr", "en", "fr"],
		[undefined, undefined, "fr", "fr"],
		[undefined, undefined, undefined, "en"],
		["", "fr", "en", "fr"],
		[42, "fr", "en", "fr"],
	] as const)(
		"resolves lesson %s, course %s, workspace %s to %s",
		(lang, locale, defaultLocale, expected) => {
			expect(
				resolveDesignSettings(
					{ defaultLocale },
					{ title: "Course", lessons: [], locale, design: {} },
					{ lang },
				).locale,
			).toBe(expected);
		},
	);

	it("merges workspace -> course -> lesson frontmatter", () => {
		const workspace: WorkspaceConfig = {
			defaultLocale: "en",
			defaultTheme: "corporate",
		};
		const course: CourseManifest = {
			title: "Test",
			lessons: [],
			design: {
				accentHue: 200,
				typography: {
					body: { fontFamily: ["Inter", "sans-serif"], fontWeight: 400 },
					headings: { fontFamily: ["DM Sans", "sans-serif"], h1: { fontWeight: 700 } },
				},
			},
			locale: "fr",
			theme: "corporate",
		};
		const lessonFrontmatter = {
			design: { accentHue: 300, typography: { headings: { h1: { fontStyle: "italic" } } } },
		};

		const result = resolveDesignSettings(workspace, course, lessonFrontmatter);
		expect(result.locale).toBe("fr");
		expect(result.theme).toBe("corporate");
		expect(result.design.accentHue).toBe(300);
		expect(result.design.typography).toMatchObject({
			body: { fontFamily: ["Inter", "sans-serif"], fontWeight: 400 },
			headings: {
				fontFamily: ["DM Sans", "sans-serif"],
				h1: { fontWeight: 700, fontStyle: "italic" },
			},
		});
	});

	it("works with no workspace", () => {
		const course: CourseManifest = {
			title: "Test",
			lessons: [],
			design: { accentHue: 100 },
		};
		const result = resolveDesignSettings(null, course, {});
		expect(result.design.accentHue).toBe(100);
	});

	it("works with no lesson frontmatter overrides", () => {
		const course: CourseManifest = {
			title: "Test",
			lessons: [],
			design: { typography: { body: { fontFamily: ["Merriweather", "serif"] } } },
		};
		const result = resolveDesignSettings(null, course, {});
		expect(result.design.typography).toMatchObject({
			body: { fontFamily: ["Merriweather", "serif"] },
		});
	});
});

it("inherits deck choices per key without replacing unrelated course defaults", () => {
	const result = resolveDesignSettings(
		null,
		{
			title: "Course",
			lessons: [],
			design: {
				deck: { preset: "transcript", outline: false, followNarration: true },
			},
		},
		{ design: { deck: { autoAdvance: false } } },
	);
	expect(result.design.deck).toEqual({
		preset: "transcript",
		outline: false,
		followNarration: true,
		autoAdvance: false,
	});
});

it("ignores invalid lesson deck keys before merging course defaults", () => {
	const result = resolveDesignSettings(
		null,
		{
			title: "Course",
			lessons: [],
			design: { deck: { autoAdvance: false, outline: false } },
		},
		{ design: { deck: { autoAdvance: "invalid", outline: true } } },
	);
	expect(result.design.deck).toEqual({ autoAdvance: false, outline: true });
});
