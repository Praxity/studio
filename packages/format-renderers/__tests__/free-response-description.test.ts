import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { buildCoursePdfSource, exportCoursePdf } from "../src/pipelines/course-pdf.ts";
import { parsePdfStructure, structureNodes } from "./helpers/pdf-structure.ts";

for (const [locale, first, nested, last] of [
	["en", "First", "Nested idea.", "Final paragraph."],
	["fr", "Premier", "Idée imbriquée.", "Dernier paragraphe."],
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
	const input = {
		title: "Reflection",
		locale,
		lessons: [{ id: "lesson", title: "Reflection", locale, blocks: read.blocks }],
	};
	it(`keeps free-response prose, list nesting, emphasis and links in ${locale} PDF source`, () => {
		expect(read.errors).toEqual([]);
		const { typstSource, questionCount, diagnostics } = buildCoursePdfSource(input);
		expect(questionCount).toBe(1);
		expect(diagnostics).toEqual([]);
		expect(typstSource).toContain(first);
		expect(typstSource).toContain(locale === "en" ? "Nested idea\\." : "Idée imbriquée\\.");
		expect(typstSource).toContain(locale === "en" ? "Final paragraph\\." : "Dernier paragraphe\\.");
		expect(typstSource).toContain('#link("https://example.com/guide")');
		expect(typstSource).toContain("#strong[");
		expect(typstSource).toContain("#emph[");
	});
	it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
		`retains the complete ${locale} description in tagged native PDF`,
		async () => {
			const directory = await mkdtemp(join(tmpdir(), "free-response-pdf-"));
			try {
				const { pdf, diagnostics } = await exportCoursePdf({
					...input,
					executablePath: process.env.PRAXITY_TEST_TYPST as string,
				});
				expect(diagnostics).toEqual([]);
				const file = join(directory, "reflection.pdf");
				await writeFile(file, pdf);
				const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
				expect(text).toContain(first);
				expect(text).toContain(nested);
				expect(text).toContain(last);
				const structure = parsePdfStructure(
					execFileSync("pdfinfo", ["-struct", file], { encoding: "utf8" }),
				);
				const tags = structureNodes(structure).map((node) => node.tag);
				expect(tags.filter((tag) => tag === "L").length).toBeGreaterThanOrEqual(2);
				expect(tags).toContain("Link");
			} finally {
				await rm(directory, { recursive: true });
			}
		},
	);
}
