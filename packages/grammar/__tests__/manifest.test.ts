import { describe, expect, it } from "vitest";
import { getAllKeywords, getManifest, getVariantAxes } from "../src/index";

describe("manifest", () => {
	it("returns authorable grammar keywords by default", () => {
		const manifest = getManifest();
		expect(manifest.has("accordion")).toBe(true);
		expect(manifest.has("tabs")).toBe(true);
		expect(manifest.has("choose-one")).toBe(true);
		expect(manifest.has("matrix")).toBe(true);
		for (const keyword of ["code", "equation", "sequence", "rate", "signature"]) {
			expect(manifest.has(keyword)).toBe(true);
		}
		expect(manifest.has("text")).toBe(true);
		expect(manifest.has("ai-chat")).toBe(false);
		expect(manifest.has("branch")).toBe(false);
	});

	it("returns variant axes for accordion", () => {
		const axes = getVariantAxes("accordion");
		expect(axes).toContainEqual(expect.objectContaining({ name: "style", type: "enum" }));
	});

	it("returns empty axes for content primitives", () => {
		const axes = getVariantAxes("text");
		expect(axes).toHaveLength(0);
	});

	it("offers quote surfaces alongside semantic citation fields", () => {
		const quote = getManifest().get("quote");
		expect(quote?.variants).toEqual([
			{
				name: "style",
				type: "enum",
				options: ["none", "outline", "shaded", "primary", "secondary"],
				default: "default",
			},
		]);
		expect(quote?.parameters.map((parameter) => parameter.name)).toEqual(
			expect.arrayContaining(["speaker", "work", "sourceUrl"]),
		);
	});

	it("returns all keyword strings", () => {
		const keywords = getAllKeywords();
		expect(keywords).toContain("text");
		expect(keywords).toContain("accordion");
		expect(keywords).toContain("tabs");
		expect(keywords).toContain("choose-one");
		expect(keywords.length).toBeGreaterThan(15);
	});

	it("returns empty axes for unknown keyword", () => {
		const axes = getVariantAxes("nonexistent");
		expect(axes).toHaveLength(0);
	});

	it("every manifest entry has a category field", () => {
		const manifest = getManifest({ include: "all" });
		for (const [keyword, entry] of manifest) {
			expect(entry.category, `${keyword} missing category`).toBeDefined();
			expect(["content", "flow", "assessment", "interactive"]).toContain(entry.category);
		}
	});

	it("choose-one has shuffle, points, required parameters", () => {
		const manifest = getManifest();
		const chooseOne = manifest.get("choose-one");
		expect(chooseOne).toBeDefined();
		const paramNames = chooseOne?.parameters.map((p) => p.name) ?? [];
		expect(paramNames).toContain("shuffle");
		expect(paramNames).toContain("points");
		expect(paramNames).toContain("required");
	});

	const ASSESSMENT_KEYWORDS = [
		"choose-one",
		"choose-many",
		"match",
		"order",
		"free-response",
		"categorize",
		"fill-blank",
		"hotspot",
		"matrix",
	];

	it("assessment blocks have timed and attempts parameters", () => {
		const manifest = getManifest({ include: "all" });
		for (const keyword of ASSESSMENT_KEYWORDS) {
			const entry = manifest.get(keyword);
			expect(entry, `${keyword} missing from manifest`).toBeDefined();
			const paramNames = entry?.parameters.map((p) => p.name) ?? [];
			expect(paramNames, `${keyword} missing timed`).toContain("timed");
			expect(paramNames, `${keyword} missing attempts`).toContain("attempts");
		}
	});

	it("free responses expose buttonLabel and response downloads", () => {
		const freeResponseParameters = getManifest()
			.get("free-response")
			?.parameters.map((parameter) => parameter.name);
		expect(freeResponseParameters).toContain("buttonLabel");
		expect(freeResponseParameters).toContain("downloadAs");
		expect(
			getManifest()
				.get("assessment-group")
				?.parameters.map((parameter) => parameter.name),
		).toContain("buttonLabel");
	});

	it("no longer offers `pass`, which was reconciled to `passingScore`", () => {
		// `pass` and `passingScore` meant the same thing on sibling blocks, and
		// `pass` was the half nothing read. It still validates via
		// assessment-schema so existing .prax files parse, but authoring UI must
		// not teach a name that does nothing.
		const manifest = getManifest({ include: "all" });
		for (const [keyword, entry] of manifest) {
			const names = entry.parameters.map((p) => p.name);
			expect(names, `${keyword} still offers pass`).not.toContain("pass");
		}
		const group = manifest.get("assessment-group");
		expect(group?.parameters.map((p) => p.name)).toContain("passingScore");
	});

	it("retains literal inert parameter flags through the manifest interface", () => {
		expect(
			Object.fromEntries(
				Array.from(getManifest({ include: "all" }), ([keyword, entry]) => [
					keyword,
					entry.parameters
						.filter((parameter) => parameter.implemented === false)
						.map((parameter) => parameter.name),
				]).filter(([, names]) => names.length > 0),
			),
		).toEqual({
			"data-table": ["colors", "visual"],
			"choose-one": ["competency", "confidence", "retrieval", "timed"],
			"choose-many": ["competency", "confidence", "retrieval", "timed"],
			match: ["competency", "confidence", "retrieval", "timed"],
			order: ["competency", "confidence", "retrieval", "timed"],
			"free-response": ["competency", "confidence", "retrieval", "timed"],
			hotspot: ["competency", "confidence", "retrieval", "timed"],
			"fill-blank": ["competency", "confidence", "retrieval", "timed"],
			categorize: ["competency", "confidence", "retrieval", "timed"],
			matrix: ["competency", "confidence", "retrieval", "timed"],
		});
	});

	it("offers one outer width independently of block presentation and sizing", () => {
		for (const entry of getManifest({ include: "all" }).values()) {
			const widths = [...entry.parameters, ...entry.variants].filter(
				(param) => param.name === "width",
			);
			expect(widths).toHaveLength(1);
			expect(widths[0].options).toEqual(["narrow", "wide", "full", "breakout"]);
		}
		expect(
			getManifest()
				.get("card")
				?.variants.find((axis) => axis.name === "layout")?.options,
		).toEqual(["grid", "masonry", "slides", "rows"]);
	});

	it("does not advertise retired generic reveal", () => {
		for (const entry of getManifest({ include: "all" }).values()) {
			expect(entry.parameters.some((param) => param.name === "reveal")).toBe(false);
		}
	});

	it("image manifest reflects current image block parameters", () => {
		const manifest = getManifest();
		const image = manifest.get("image");
		expect(image).toBeDefined();

		const variantNames = image?.variants.map((v) => v.name) ?? [];
		expect(variantNames).toContain("size");
		expect(variantNames).toContain("alignment");

		const paramNames = image?.parameters.map((p) => p.name) ?? [];
		expect(paramNames).toContain("alt");
		expect(paramNames).toContain("decorative");
		expect(paramNames).toContain("caption");
		expect(paramNames).toContain("effects");

		expect(paramNames).not.toContain("filter");
		expect(paramNames).not.toContain("opacity");
		expect(paramNames).not.toContain("size");
		expect(paramNames).not.toContain("x");
		expect(paramNames).not.toContain("order");
		expect(paramNames).not.toContain("motionBlur");
	});
});
