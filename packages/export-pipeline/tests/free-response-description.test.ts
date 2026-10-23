import { readFileSync } from "node:fs";
import { readLesson } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { extractNarrationSegments } from "@praxity/shared-blocks/narration";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CourseArtifact, compileCourse, deployCourse } from "../src/build.ts";

for (const [locale, ...expected] of [
	[
		"en",
		"First paragraph.",
		"Second paragraph",
		"First idea.",
		"Nested idea.",
		"Another idea.",
		"Last idea.",
		"Final paragraph.",
	],
	[
		"fr",
		"Premier paragraphe.",
		"Deuxième paragraphe",
		"Première idée.",
		"Idée imbriquée.",
		"Autre idée.",
		"Dernière idée.",
		"Dernier paragraphe.",
	],
]) {
	const read = readLesson(
		readFileSync(
			new URL(
				`../../grammar/__tests__/fixtures/free-response-description.${locale}.prax`,
				import.meta.url,
			),
			"utf8",
		),
	);
	it(`narrates the whole free-response description in ${locale}`, () => {
		expect(read.errors).toEqual([]);
		const blocks = adaptGrammarPreviewBlocks(read.pages[0].blocks);
		const script = extractNarrationSegments(read.pages[0].title, {}, blocks, {}, locale)
			.map((segment) => segment.script)
			.join("\n");
		let previous = -1;
		for (const text of expected) {
			const position = script.indexOf(text);
			expect(position, text).toBeGreaterThan(previous);
			previous = position;
		}
		expect(script).toContain("guide");
		expect(script).not.toContain("<strong>");
	});
	describe(`${locale} description deployments`, () => {
		let artifact: CourseArtifact;
		beforeAll(async () => {
			artifact = await compileCourse({
				id: `description-${locale}`,
				title: "Reflection",
				sourceLocale: locale,
				content: read.pages,
			});
		});
		afterAll(async () => {
			await artifact?.dispose();
		});
		it.each(["html", "scorm12", "scorm2004"] as const)(
			"packages the complete description in %s",
			async (format) => {
				const result = await deployCourse(artifact, { format });
				const zip = new AdmZip(result.zip);
				const entry = zip.getEntry(`${artifact.manifest.pages[0].slug}.html`);
				expect(entry).toBeDefined();
				const document = new JSDOM(entry?.getData().toString("utf8")).window.document;
				const description = document.querySelector(".praxity-assessment-description");
				let previous = -1;
				for (const text of expected) {
					const position = description?.textContent?.indexOf(text) ?? -1;
					expect(position, `${format}: ${text}`).toBeGreaterThan(previous);
					previous = position;
				}
				expect(description?.querySelectorAll("p")).toHaveLength(3);
				expect(description?.querySelectorAll("ul ol li")).toHaveLength(2);
				expect(description?.querySelector("strong")).not.toBeNull();
				expect(description?.querySelector("em")).not.toBeNull();
				expect(description?.querySelector("a")?.getAttribute("href")).toBe(
					"https://example.com/guide",
				);
				const input = document.querySelector("textarea");
				expect(input?.getAttribute("aria-describedby")).toBe(description?.id);
			},
		);
	});
}
