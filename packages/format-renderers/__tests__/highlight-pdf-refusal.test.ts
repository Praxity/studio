import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLesson } from "@praxity/grammar";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	buildCoursePdfSource,
	type CoursePdfOptions,
	exportCoursePdf,
} from "../src/pipelines/course-pdf";

let scratch: string;
beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), "highlight-pdf-"));
});
afterAll(async () => {
	await rm(scratch, { recursive: true });
});
it.each(
	["en", "fr-CA"].flatMap((locale) =>
		[false, true].flatMap((includeAnswerSheet) =>
			[false, true].map((nested) => ({ locale, includeAnswerSheet, nested })),
		),
	),
)(
	"refuses native PDF before source or bytes: $locale answer=$includeAnswerSheet nested=$nested",
	async ({ locale, includeAnswerSheet, nested }) => {
		const highlight = {
			id: "highlight-id",
			type: "highlight" as const,
			data: {
				hide: true,
				content: {
					mode: "key",
					title: "AUTHORED TITLE",
					paragraphs: [[{ id: "chunk", text: "AUTHORED TEXT", key: true }]],
				},
			},
		};
		const block = nested
			? {
					id: "outer",
					type: "accordion" as const,
					data: { hide: true, items: [{ blocks: [highlight] }] },
				}
			: highlight;
		const input: CoursePdfOptions = {
			title: "C",
			locale,
			includeAnswerSheet,
			lessons: [{ id: "lesson", title: "L", locale, blocks: [block] }],
		};
		const expected = {
			code: "highlight-native-pdf-unsupported",
			lessonId: "lesson",
			blockId: "highlight-id",
			referencePath: nested
				? "lessons[0].blocks[0].data.items[0].blocks[0]"
				: "lessons[0].blocks[0]",
			reason:
				locale === "en"
					? "Highlight is not supported in native PDF export. Use your browser's Print or Save as PDF."
					: "Le surlignage n'est pas pris en charge dans l'export PDF natif. Utilisez Imprimer ou Enregistrer au format PDF dans votre navigateur.",
		};
		expect(() => buildCoursePdfSource(input)).toThrowError(expect.objectContaining(expected));
		await expect(
			exportCoursePdf({
				...input,
				executablePath: join(scratch, "missing-typst"),
				temporaryRoot: scratch,
			}),
		).rejects.toMatchObject(expected);
		expect(await readdir(scratch)).toEqual([]);
	},
);
it("refuses a grammar-produced source lesson without partial workbook text", () => {
	const read = readLesson("# Page\n::: highlight Title\n:: Target {key}\n:::\n");
	expect(() =>
		buildCoursePdfSource({
			title: "C",
			locale: "en",
			lessons: [{ id: "lesson", title: "L", locale: "en", blocks: read.blocks }],
		}),
	).toThrowError(expect.objectContaining({ code: "highlight-native-pdf-unsupported" }));
});
