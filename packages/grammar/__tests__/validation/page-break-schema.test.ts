import { describe, expect, it } from "vitest";
import { validate } from "../../src/validation/validate.ts";
import { readLessonFixture } from "../helpers/lesson-fixture.ts";

function validatePrax(params: string) {
	const source = "# Intro\n\nIntro text.\n\n# Quiz\n\nMore text.\n";
	const parsed = readLessonFixture(source);
	const page = parsed.blocks.filter((block) => block.type === "pageBreak")[1];
	// These persisted model fields remain public until X1d. Grammar 4 authors
	// navigation at course level, so inject them at the validator's interface.
	for (const line of params.split("\n")) {
		const [key, raw] = line.split(/:\s*/, 2);
		page.data[key] =
			raw === "true" ? true : raw === "false" ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
	}
	return validate(parsed.blocks, source, { strictness: "normal", spans: parsed.spans });
}

const DOC = (params: string) => params;

function pageBreakErrors(result: ReturnType<typeof validatePrax>) {
	return result.errors.filter((e) => e.blockType === "pageBreak");
}

describe("pageBreak nav param validation", () => {
	it("accepts named page styles and rejects non-text references", () => {
		for (const value of ["illustrated", "plain"])
			expect(pageBreakErrors(validatePrax(DOC(`pageStyle: ${value}`)))).toEqual([]);
		expect(pageBreakErrors(validatePrax(DOC("pageStyle: 42")))).toEqual(
			expect.arrayContaining([expect.objectContaining({ attribute: "pageStyle" })]),
		);
	});

	it("accepts valid nav archetype, focus, and toggle params", () => {
		const result = validatePrax(DOC("nav: minimal\nfocus: off\nnavKeyboardArrows: false"));
		expect(pageBreakErrors(result)).toEqual([]);
	});

	it("accepts boolean-coerced focus values without a type warning", () => {
		// parseParamValue turns `focus: true` into boolean true
		const result = validatePrax(DOC("focus: true"));
		expect(pageBreakErrors(result)).toEqual([]);
	});

	it("warns on an invalid nav archetype and on custom", () => {
		for (const value of ["sparkles", "custom"]) {
			const result = validatePrax(DOC(`nav: ${value}`));
			const warning = pageBreakErrors(result).find((e) => e.attribute === "nav");
			expect(warning?.level).toBe("warning");
		}
	});

	it("warns on a junk focus value", () => {
		const result = validatePrax(DOC("focus: maybe"));
		const warning = pageBreakErrors(result).find((e) => e.attribute === "focus");
		expect(warning?.level).toBe("warning");
	});

	it("warns on a non-boolean value for a boolean nav key", () => {
		const result = validatePrax(DOC("navOutline: nope"));
		const warning = pageBreakErrors(result).find((e) => e.attribute === "navOutline");
		expect(warning?.level).toBe("warning");
	});

	it("warns on a misspelled nav toggle key", () => {
		const result = validatePrax(DOC("navOutlin: false"));
		const warning = pageBreakErrors(result).find((e) => e.attribute === "navOutlin");
		expect(warning?.level).toBe("warning");
	});

	it("does not warn on known non-nav params", () => {
		const result = validatePrax(
			DOC("style: hero\nduration: show\nnarrationAudio: assets/narration/intro.mp3"),
		);
		expect(pageBreakErrors(result)).toEqual([]);
	});

	it("accepts a CSS-time duration (documented page-transition override)", () => {
		const result = validatePrax(DOC("transition: slide-left\nduration: 500ms"));
		expect(pageBreakErrors(result)).toEqual([]);
	});

	it("warns on a junk duration value", () => {
		const result = validatePrax(DOC("duration: banana"));
		const warning = pageBreakErrors(result).find((e) => e.attribute === "duration");
		expect(warning?.level).toBe("warning");
	});
});
