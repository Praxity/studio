import { describe, expect, it } from "vitest";
import {
	collectTypographyFontFaces,
	createTypography,
	fontFamilyListToCss,
	getTypographyWarnings,
	normalizeTypography,
	resolveHeadingTypography,
	typographyToCssVariables,
} from "../src/font-catalog.ts";

describe("frontmatter typography", () => {
	it("uses Next regular body and ExtraBold headings for Clear, including legacy courses", () => {
		for (const raw of [
			{ pairing: "clear" },
			{ body: { fontFamily: ["Atkinson Hyperlegible", "sans-serif"] } },
		]) {
			const typography = normalizeTypography(raw);
			expect(typography.body).toEqual({
				fontFamily: ["Atkinson Hyperlegible Next", "sans-serif"],
				fontWeight: 400,
				fontStyle: "normal",
			});
			for (const level of [1, 2, 3, 4, 5, 6] as const)
				expect(resolveHeadingTypography(typography, level)).toEqual({
					fontFamily: ["Atkinson Hyperlegible Next", "sans-serif"],
					fontWeight: 800,
					fontStyle: "normal",
				});
			expect(
				collectTypographyFontFaces(typography).map(({ entry, weights, styles }) => ({
					family: entry.label,
					weights,
					styles,
				})),
			).toEqual([
				{
					family: "Atkinson Hyperlegible Next",
					weights: [400, 600, 700, 800],
					styles: ["normal", "italic"],
				},
			]);
		}
	});
	it("warns once per ignored font setting without changing pairing resolution", () => {
		expect(
			getTypographyWarnings({
				body: { fontFamily: ["Poppins", "sans-serif"] },
				headings: { fontFamily: ["Inter"], h2: { fontWeight: 700, fontStyle: "italic" } },
				code: { fontFamily: ["Fira Code", "monospace"] },
				fontDisplay: "optional",
			}),
		).toEqual([
			{ code: "ignored-font-setting", path: "design.typography.body.fontFamily", pairing: "sans" },
			{
				code: "ignored-font-setting",
				path: "design.typography.headings.fontFamily",
				pairing: "sans",
			},
			{
				code: "ignored-font-setting",
				path: "design.typography.headings.h2.fontWeight",
				pairing: "sans",
			},
			{
				code: "ignored-font-setting",
				path: "design.typography.headings.h2.fontStyle",
				pairing: "sans",
			},
			{ code: "ignored-font-setting", path: "design.typography.code.fontFamily", pairing: "sans" },
		]);
	});
	it.each([
		{
			pairing: "book",
			body: { fontFamily: ["Source Sans 3", "sans-serif"] },
			headings: { h2: { fontFamily: ["Source Serif 4"], fontWeight: 600 } },
		},
		normalizeTypography({ pairing: "clear" }),
		{ body: { fontFamily: ["Atkinson Hyperlegible", "sans-serif"] } },
		{
			pairing: "clear",
			fontDisplay: "swap",
			code: { fontFamily: ["monospace"] },
			body: {
				fontFamily: ["Atkinson Hyperlegible", "sans-serif"],
				fontWeight: 400,
				fontStyle: "normal",
			},
			headings: {
				fontFamily: ["Atkinson Hyperlegible", "sans-serif"],
				fontWeight: 600,
				fontStyle: "normal",
			},
		},
		{ fontDisplay: "optional", code: { fontFamily: ["monospace"] } },
		undefined,
		null,
		[],
	])("does not warn for resolved fonts or supported typography settings: case %#, %j", (raw) => {
		expect(getTypographyWarnings(raw)).toEqual([]);
	});
	it("names the resolved pairing, including unknown ids and explicit choices", () => {
		for (const pairing of ["sans", "book", "clear", "unknown"])
			expect(getTypographyWarnings({ pairing, body: { fontFamily: ["Poppins"] } })).toEqual([
				{
					code: "ignored-font-setting",
					path: "design.typography.body.fontFamily",
					pairing: pairing === "unknown" ? "sans" : pairing,
				},
			]);
	});
	it.each([
		{ fontFamily: ["Atkinson Hyperlegible", "Poppins", "sans-serif"] },
		{ fontFamily: ["Atkinson Hyperlegible", "sans-serif", "Unknown"] },
		{ fontFamily: [] },
	])("still warns for ignored entries in a legacy Clear font stack: %j", ({ fontFamily }) => {
		expect(getTypographyWarnings({ pairing: "clear", body: { fontFamily } })).toEqual([
			{ code: "ignored-font-setting", path: "design.typography.body.fontFamily", pairing: "clear" },
		]);
	});
	it.each([
		[
			"legacy serif",
			{
				body: { fontFamily: ["Source Sans 3", "sans-serif"] },
				headings: { fontFamily: ["Source Serif 4", "serif"] },
			},
			"sans",
			"Source Sans 3",
			"Source Sans 3",
		],
		["explicit Book", { pairing: "book" }, "book", "Source Sans 3", "Source Serif 4"],
		[
			"legacy Atkinson",
			{ body: { fontFamily: ["Atkinson Hyperlegible", "sans-serif"] } },
			"clear",
			"Atkinson Hyperlegible Next",
			"Atkinson Hyperlegible Next",
		],
		[
			"unknown id",
			{ pairing: "unknown", body: { fontFamily: ["Atkinson Hyperlegible"] } },
			"sans",
			"Source Sans 3",
			"Source Sans 3",
		],
		[
			"explicit Sans overrides legacy Atkinson",
			{ pairing: "sans", body: { fontFamily: ["Atkinson Hyperlegible"] } },
			"sans",
			"Source Sans 3",
			"Source Sans 3",
		],
	] as const)("persists %s as the selected pairing", (_label, raw, pairing, body, headings) => {
		const typography = normalizeTypography(raw);
		expect(typography).toMatchObject({
			pairing,
			body: { fontFamily: [body, "sans-serif"] },
			headings: { fontFamily: [headings, headings === "Source Serif 4" ? "serif" : "sans-serif"] },
		});
		expect(normalizeTypography(typography)).toEqual(typography);
	});
	it("bundles the regular and strong reading weights", () => {
		expect(
			collectTypographyFontFaces(normalizeTypography({})).map((face) => ({
				family: face.entry.label,
				weights: face.weights,
			})),
		).toEqual([{ family: "Source Sans 3", weights: [400, 600] }]);
	});
	it("uses one heading weight by default", () => {
		const typography = createTypography("Inter", "Merriweather");
		expect(resolveHeadingTypography(typography, 1).fontWeight).toBe(600);
		expect(resolveHeadingTypography(typography, 2).fontWeight).toBe(600);
		expect(resolveHeadingTypography(typography, 4).fontWeight).toBe(600);
	});

	it("normalizes font stacks and lets heading defaults flow into each level", () => {
		const typography = normalizeTypography({
			fontDisplay: "optional",
			body: {
				fontFamily: ["Inter", "DM Sans", "sans-serif"],
				fontWeight: 400,
				fontStyle: "normal",
			},
			headings: {
				fontFamily: ["Merriweather", "Inter", "serif"],
				fontWeight: 500,
				fontStyle: "normal",
				h2: { fontWeight: 700, fontStyle: "italic" },
			},
		});

		expect(resolveHeadingTypography(typography, 1).fontWeight).toBe(600);
		expect(resolveHeadingTypography(typography, 2)).toMatchObject({
			fontWeight: 600,
			fontStyle: "normal",
			fontFamily: ["Source Sans 3", "sans-serif"],
		});
		expect(fontFamilyListToCss(typography.body.fontFamily)).toBe("'Source Sans 3', sans-serif");
	});

	it("rejects unknown and excessive family values before they reach CSS", () => {
		const typography = normalizeTypography({
			body: {
				fontFamily: ["Inter'; color: red", "Inter", "DM Sans", "Roboto", "Lato", "Poppins"],
				fontWeight: 300,
				fontStyle: "oblique",
			},
			headings: {
				fontFamily: ["Merriweather", "serif"],
				h3: { fontFamily: ["unknown-font"] },
			},
		});

		expect(typography.body).toEqual({
			fontFamily: ["Source Sans 3", "sans-serif"],
			fontWeight: 400,
			fontStyle: "normal",
		});
		expect(resolveHeadingTypography(typography, 3).fontFamily).toEqual([
			"Source Sans 3",
			"sans-serif",
		]);
	});

	it("collects every packaged primary and fallback face used by body and headings", () => {
		const typography = normalizeTypography({
			body: {
				fontFamily: ["Inter", "DM Sans", "sans-serif"],
				fontWeight: 400,
				fontStyle: "normal",
			},
			headings: {
				fontFamily: ["Merriweather", "Inter", "serif"],
				fontWeight: 600,
				fontStyle: "italic",
			},
		});

		expect(collectTypographyFontFaces(typography).map((request) => request.entry.label)).toEqual([
			"Source Sans 3",
		]);
	});
});

describe("code typography", () => {
	it.each([undefined, null, "Fira Code", [], { fontFamily: ["bad;css"], fontWeight: 123 }])(
		"keeps system monospace for missing or malformed persisted code settings: case %#, %j",
		(code) => {
			const typography = normalizeTypography({ code });
			expect(typography.code).toEqual({
				fontFamily: ["monospace"],
			});
			expect(typographyToCssVariables(typography)["--praxity-font-code"]).toBeUndefined();
		},
	);

	it("retires bundled code faces while retaining system monospace", () => {
		const typography = normalizeTypography({ code: { fontFamily: ["Fira Code", "monospace"] } });
		expect(typographyToCssVariables(typography)["--praxity-font-code"]).toBeUndefined();
		expect(collectTypographyFontFaces(typography).map((request) => request.entry.label)).toEqual([
			"Source Sans 3",
		]);
	});
});
