import { supportsDeckPassGate } from "@praxity/content-model";
import { describe, expect, it } from "vitest";

describe("deck Pass response capability", () => {
	it.each(["textResponse", "fileUpload", "matrix", "likert"])("excludes %s", (type) => {
		expect(supportsDeckPassGate(type)).toBe(false);
	});
	it.each([
		"choice",
		"fillBlank",
		"hotspot",
		"matching",
		"sequence",
		"categorize",
		undefined,
		"unknown",
	])("preserves the existing capability for %s without replacing answer validation", (type) => {
		expect(supportsDeckPassGate(type)).toBe(true);
	});
});
