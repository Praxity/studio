import { describe, expect, it } from "vitest";
import {
	type CourseManifest,
	parseCourseManifest,
	serializeCourseManifest,
	validateManifest,
} from "../../shared/course-manifest";

describe("parseCourseManifest", () => {
	it.each([
		"../course/",
		"/courses/start",
		"?course=1",
		"#overview",
		"https://example.org/course?a=1&b=2",
	])("round-trips courseHomeUrl %s", (courseHomeUrl) => {
		const manifest = parseCourseManifest(`courseHomeUrl: '${courseHomeUrl}'`);
		expect(manifest.courseHomeUrl).toBe(courseHomeUrl);
		expect(parseCourseManifest(serializeCourseManifest(manifest)).courseHomeUrl).toBe(
			courseHomeUrl,
		);
	});
	it.each([
		"javascript:alert(1)",
		"JaVaScRiPt:alert(1)",
		"data:text/html,test",
		"http://example.org/",
		"mailto:hello@example.org",
		"file:///course",
		"//example.org/",
		"\\\\example.org/",
		"java\nscript:alert(1)",
		"https:example.org",
		"https://",
		"",
		"  javascript:alert(1)",
		42,
		null,
	])("refuses malformed or unsafe courseHomeUrl %j", (value) => {
		expect(() => parseCourseManifest(`courseHomeUrl: ${JSON.stringify(value)}`)).toThrow(
			"courseHomeUrl must be a relative URL or an absolute HTTPS URL.",
		);
	});
	it("uses the caller language rather than the course language for refusals", () => {
		expect(() =>
			parseCourseManifest("locale: fr-CA\ncourseHomeUrl: 'data:text/html,test'"),
		).toThrow("courseHomeUrl must be a relative URL or an absolute HTTPS URL.");
		expect(() =>
			parseCourseManifest("locale: en\ncourseHomeUrl: 'data:text/html,test'", "fr"),
		).toThrow("courseHomeUrl doit être une URL relative ou une URL HTTPS absolue.");
	});
	it("leaves courseHomeUrl absent by default", () => {
		expect(parseCourseManifest("title: Course").courseHomeUrl).toBeUndefined();
		expect(serializeCourseManifest(parseCourseManifest("title: Course"))).toBe("title: Course\n");
	});
	it("parses, validates and preserves cast", () => {
		const manifest = parseCourseManifest(
			"title: T\nlessons: [a.prax]\ncast:\n  roger:\n    name: Roger\n    avatar: assets/roger.png\n    side: end\n  'bad key':\n    name: X\n",
		);
		expect(manifest.cast).toEqual({
			roger: { name: "Roger", avatar: "assets/roger.png", side: "end" },
		});
		expect(parseCourseManifest(serializeCourseManifest(manifest)).cast).toEqual(manifest.cast);
		expect(() => parseCourseManifest("title: T\ncast: 3\n")).not.toThrow();
	});
	it("keeps invalid authored cast entries available for serialization", () => {
		const manifest = parseCourseManifest(
			"title: T\ncast:\n  good:\n    name: Good\n  nameless:\n    avatar: assets/missing.png\n",
		);
		expect(manifest.cast).toEqual({ good: { name: "Good" } });
		expect(manifest.castWarnings?.join(" ")).toContain("nameless");
		expect(serializeCourseManifest(manifest)).toContain("nameless:");
	});
	it("round-trips the deck opt-in and rejects malformed persisted values", () => {
		expect(parseCourseManifest("title: Old course").moduleDeck).toBeUndefined();
		for (const enabled of [true, false]) {
			const manifest = parseCourseManifest(`title: Course\nmoduleDeck: ${enabled}`);
			expect(parseCourseManifest(serializeCourseManifest(manifest)).moduleDeck).toBe(enabled);
		}
		for (const value of ["yes", "{}", "[]", "1", "null"])
			expect(() => parseCourseManifest(`moduleDeck: ${value}`)).toThrow(
				"moduleDeck must be a boolean",
			);
	});
	it("parses a valid course.yaml", () => {
		const yaml = `
title: Safety Training
id: 3f26f6f8-6377-4c99-ab86-cb3593d67a5e
description: Workplace safety program
locale: en
theme: brand-theme
lessons:
  - intro.prax
  - hazards.prax
design:
  accentHue: 200
badge: false
`;
		const result = parseCourseManifest(yaml);
		expect(result).not.toHaveProperty("id");
		expect(result.title).toBe("Safety Training");
		expect(result.description).toBe("Workplace safety program");
		expect(result.locale).toBe("en");
		expect(result.theme).toBe("brand-theme");
		expect(result.lessons).toEqual(["intro.prax", "hazards.prax"]);
		expect(result.design).toEqual({ accentHue: 200 });
		expect(result).not.toHaveProperty("badge");
	});

	it("provides defaults for missing fields", () => {
		const result = parseCourseManifest("title: Minimal Course\n");
		expect(result.lessons).toEqual([]);
		expect(result.locale).toBeUndefined();
		expect(result.theme).toBeUndefined();
		expect(result.design).toEqual({});
		expect(result).not.toHaveProperty("badge");
	});

	it("handles empty/invalid YAML gracefully", () => {
		expect(parseCourseManifest("")).toEqual(expect.objectContaining({ title: "", lessons: [] }));
		expect(parseCourseManifest("not: [valid: yaml: {")).toEqual(
			expect.objectContaining({ title: "", lessons: [] }),
		);
	});
});

describe("validateManifest", () => {
	it("reports missing lesson files", () => {
		const manifest: CourseManifest = {
			title: "Test",
			lessons: ["exists.prax", "missing.prax"],
			design: {},
		};
		const filesOnDisk = ["exists.prax", "unlisted.prax"];
		const result = validateManifest(manifest, filesOnDisk);
		expect(result.missingFiles).toEqual(["missing.prax"]);
		expect(result.unlistedFiles).toEqual(["unlisted.prax"]);
		expect(result.duplicates).toEqual([]);
	});

	it("detects duplicate entries", () => {
		const manifest: CourseManifest = {
			title: "Test",
			lessons: ["a.prax", "b.prax", "a.prax"],
			design: {},
		};
		const result = validateManifest(manifest, ["a.prax", "b.prax"]);
		expect(result.duplicates).toEqual(["a.prax"]);
	});
});

describe("serializeCourseManifest", () => {
	it("round-trips through parse and serialize", () => {
		const original: CourseManifest = {
			title: "Safety Training",
			description: "A course",
			locale: "en",
			theme: "brand-theme",
			lessons: ["intro.prax", "hazards.prax"],
			design: { accentHue: 200 },
		};
		const yaml = serializeCourseManifest(original);
		const parsed = parseCourseManifest(yaml);
		expect(yaml).not.toContain("id:");
		expect(parsed.title).toBe(original.title);
		expect(parsed.lessons).toEqual(original.lessons);
		expect(parsed.design).toEqual(original.design);
		expect(yaml).not.toContain("badge:");
	});
});
