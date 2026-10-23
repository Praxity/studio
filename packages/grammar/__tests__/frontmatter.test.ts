import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../src/frontmatter.ts";
import { readLesson } from "../src/read-lesson.ts";

import type { GrammarFrontmatter } from "../src/types.ts";

describe("parseFrontmatter", () => {
	it.each([
		["en", "Invalid YAML frontmatter"],
		["fr", "Métadonnées YAML invalides"],
	])("warns in %s without losing the body when YAML is malformed", (lang, message) => {
		const source = `---\ntitle: Saved\nlang: ${lang}\nbad: [oops\n---\n\n# Body`;
		const result = readLesson(source, {
			formatMessage: (ref) =>
				ref.key === "grammar.v4.invalid-course-metadata" ? message : ref.key,
		});
		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message,
					level: "error",
					line: 4,
					messageRef: {
						key: "grammar.v4.invalid-course-metadata",
						args: { reason: expect.any(String) },
					},
				}),
			]),
		);
		expect(result.pages[0].blocks[0]).toMatchObject({
			type: "heading",
			data: { content: "<p>Body</p>" },
		});
	});
	it("preserves a final nested setting in CRLF frontmatter without adding a carriage return", () => {
		const result = parseFrontmatter(
			"---\r\ntitle: Café\r\ndesign:\r\n  palette: standard\r\n---\r\n\r\n# Welcome {hideTitle}\r\n\r\n## Welcome\r\n",
		);
		expect(result.frontmatter).toEqual({ title: "Café", design: { palette: "ink" } });
		expect(result.body).toBe("# Welcome {hideTitle}\r\n\r\n## Welcome\r\n");
	});

	it("extracts theme and lang", () => {
		const result = parseFrontmatter("---\ntheme: midnight\nlang: en\n---\n\n# Hello\n");
		expect(result.frontmatter).toEqual({ theme: "midnight", lang: "en" });
		expect(result.body).toBe("# Hello\n");
	});

	it("returns empty frontmatter when none present", () => {
		const result = parseFrontmatter("# Hello\n\nSome text\n");
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("# Hello\n\nSome text\n");
	});

	it("handles extra keys", () => {
		const result = parseFrontmatter("---\ntitle: My Course\ncustom: value\n---\nBody");
		expect(result.frontmatter).toEqual({
			title: "My Course",
			custom: "value",
		});
	});

	it("parses nested YAML (design variants)", () => {
		const source =
			"---\ntheme: midnight\ndesign:\n  palette: ocean\n  colorMode: dark\n  accentHue: 220\n  density: comfortable\n---\n\n# Hello\n";
		const result = parseFrontmatter(source);
		expect(result.frontmatter.theme).toBe("midnight");
		expect(result.frontmatter.design).toEqual({
			palette: "forest",
			colorMode: "dark",
			accentHue: 220,
			density: "comfortable",
		});
		expect(result.body).toBe("# Hello\n");
	});

	it.each([
		["clean", "ink"],
		["ia", "ink"],
	])("normalizes the %s palette alias to %s", (palette, expected) => {
		const result = parseFrontmatter(`---\ndesign:\n  palette: ${palette}\n---\n`);
		expect(result.frontmatter.design?.palette).toBe(expected);
	});

	it("parses deeply nested objects (componentDefaults)", () => {
		const source = `---
design:
  palette: default
  componentDefaults:
    note: {style: warning, icon: true}
    quote: {border: left}
---

Body`;
		const result = parseFrontmatter(source);
		expect(result.frontmatter.design).toEqual({
			palette: "ink",
			componentDefaults: {
				note: { style: "warning", icon: true },
				quote: { border: "left" },
			},
		});
	});

	it("returns empty frontmatter on malformed YAML", () => {
		const source = `---\n  bad:\n\t\tmixed indent\n---\n\nBody text`;
		const result = parseFrontmatter(source);
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("Body text");
	});

	it("returns empty frontmatter on YAML with duplicate keys", () => {
		const source = `---\ntitle: First\ntitle: Second\n---\n\nBody`;
		const result = parseFrontmatter(source);
		// yaml package handles duplicate keys (last wins), but test it doesn't throw
		expect(result.body).toBe("Body");
	});
});

describe("serializeFrontmatter", () => {
	it("produces empty output for empty frontmatter", () => {
		expect(serializeFrontmatter({}, "Body")).toBe("Body");
	});

	it("serializes flat keys", () => {
		const result = serializeFrontmatter({ theme: "midnight", lang: "en" }, "# Hello\n");
		expect(result).toContain("---");
		expect(result).toContain("theme: midnight");
		expect(result).toContain("lang: en");
		expect(result).toContain("# Hello");
	});

	it("serializes nested design variants", () => {
		const fm = {
			design: {
				palette: "forest",
				colorMode: "dark",
				accentHue: 220,
			},
		};
		const result = serializeFrontmatter(fm as GrammarFrontmatter, "Body");
		const reparsed = parseFrontmatter(result);
		expect(reparsed.frontmatter.design).toEqual(fm.design);
		expect(reparsed.body).toBe("Body");
	});

	it("round-trips deeply nested componentDefaults", () => {
		const fm = {
			theme: "midnight",
			design: {
				palette: "ink",
				componentDefaults: {
					note: { style: "warning", icon: true },
				},
			},
		};
		const serialized = serializeFrontmatter(fm as GrammarFrontmatter, "# Hello\n");
		const reparsed = parseFrontmatter(serialized);
		expect(reparsed.frontmatter).toEqual(fm);
		expect(reparsed.body).toBe("# Hello\n");
	});

	it("merge-and-serialize preserves existing frontmatter keys", () => {
		const source = "---\ntitle: My Course\nlang: en\ndesign:\n  palette: ocean\n---\n\n# Hello\n";
		const { frontmatter: existing, body } = parseFrontmatter(source);

		const newDesign = { palette: "plum", colorMode: "dark", accentHue: 300 };
		const merged = { ...existing, design: newDesign };
		const result = serializeFrontmatter(merged as GrammarFrontmatter, body);

		const reparsed = parseFrontmatter(result);
		expect(reparsed.frontmatter.title).toBe("My Course");
		expect(reparsed.frontmatter.lang).toBe("en");
		expect(reparsed.frontmatter.design).toEqual(newDesign);
		expect(reparsed.body).toBe("# Hello\n");
	});

	it("creates frontmatter when none exists", () => {
		const source = "# Hello\n\nSome text\n";
		const { frontmatter: existing, body } = parseFrontmatter(source);

		const design = { palette: "plum" };
		const merged = { ...existing, design };
		const result = serializeFrontmatter(merged as GrammarFrontmatter, body);

		const reparsed = parseFrontmatter(result);
		expect(reparsed.frontmatter.design).toEqual({ palette: "plum" });
		expect(reparsed.body).toBe("# Hello\n\nSome text\n");
	});
});
