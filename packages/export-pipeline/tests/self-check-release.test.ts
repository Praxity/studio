import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSelfCheckContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { expect, it } from "vitest";
import { runPraxityCli } from "../../../apps/desktop/src/main/cli";
import { resolveLessonSources } from "../../../apps/desktop/src/main/lesson-source";
import { persistFixtureIdentity } from "../../../apps/desktop/src/test-utils/identity-fixture";
import {
	buildCoursePdfSource,
	exportCoursePdf,
} from "../../format-renderers/src/pipelines/course-pdf";
import {
	compileCourse,
	createCourseContext,
	deployCourse,
	selfCheckContentInput,
} from "../src/build";
import { compilerIslandAssets } from "./fixtures/page-compiler";
import { assertSelfCheckPackage } from "./fixtures/self-check-package";
import { releaseCourse, releaseExpected, releaseSource } from "./fixtures/self-check-release";

it.skipIf(!process.env.PRAXITY_TEST_TYPST).each(["en", "fr"] as const)(
	"names every unsupported grapheme and its location in a native %s CLI PDF refusal",
	async (locale) => {
		const root = await mkdtemp(join(tmpdir(), "self-check-font-refusal-"));
		try {
			await writeFile(
				join(root, "course.yaml"),
				`title: Practice\nlocale: ${locale}\nlessons: [lesson.prax]\n`,
			);
			await writeFile(
				join(root, "lesson.prax"),
				`---\nlang: ${locale}\n---\n# Practice\n::: self-check Explain.\nmodel: 王秀英 👩🏽‍💻\n:: Reason\nmissed: Hint.\n:::\n`,
			);
			await persistFixtureIdentity(root);
			const resolved = await resolveLessonSources(root);
			const read = resolved.lessons.get("lesson.prax");
			const lessonId = resolved.identity.snapshots[0]?.lessonId;
			if (!lessonId) throw new Error("Missing refusal lesson identity");
			if (!read) throw new Error("Missing refusal lesson");
			const block = read.blocks.find((block) => block.type === "selfCheck");
			if (!block) throw new Error("Missing refusal activity");
			const output = join(root, "workbook.pdf");
			const result = await runPraxityCli(
				["export", root, "--format", "pdf", "--include-answer-sheet", "--output", output],
				{
					appVersion: "test",
					typstExecutablePath: process.env.PRAXITY_TEST_TYPST,
					exportAssetsDir: join(
						import.meta.dirname,
						"../../../apps/desktop/resources/export-assets",
					),
				},
			);
			expect(result.exitCode).toBe(1);
			const error = JSON.parse(result.stdout).error;
			expect(error.code).toBe("export_failed");
			for (const character of ["王", "秀", "英", "👩🏽‍💻"])
				expect(error.message).toContain(JSON.stringify(character));
			expect(error.message).toContain(
				locale === "en"
					? `Lesson ${lessonId}, block ${block.id}:`
					: `Leçon ${lessonId}, bloc ${block.id} :`,
			);
			expect(error.message).toContain(
				locale === "en"
					? "Replace these characters before exporting."
					: "Remplacez ces caractères avant l’export.",
			);
			expect(error.message).not.toMatch(
				/input\.typ|model:|could not be displayed|Source Sans|Typst compilation/,
			);
			expect(error.message).not.toContain(root);
			expect(existsSync(output)).toBe(false);
		} finally {
			await rm(root, { recursive: true });
		}
	},
);

it.each(["en", "fr"] as const)(
	"publishes the %s fixture through the project CLI",
	async (locale) => {
		const root = await mkdtemp(join(tmpdir(), "self-check-release-project-"));
		try {
			await writeFile(
				join(root, "course.yaml"),
				`title: Self-check\nlang: ${locale}\nlessons: [lesson.prax]\n`,
			);
			await writeFile(join(root, "lesson.prax"), releaseSource(locale));
			await persistFixtureIdentity(root);
			const read = (await resolveLessonSources(root)).lessons.get("lesson.prax");
			if (!read) throw new Error("Missing release lesson");
			const expected = read.blocks
				.filter((block) => block.type === "selfCheck")
				.map((block) => selfCheckContentInput(block.id, readSelfCheckContent(read, block.id)));
			expect(expected).toHaveLength(1);
			expect(expected[0].content.model).toBe(releaseExpected[locale].model);
			for (const format of ["html", "scorm-1.2", "scorm-2004"]) {
				const output = join(root, "course.zip");
				const result = await runPraxityCli(
					["export", root, "--format", format, "--output", output],
					{
						appVersion: "test",
						exportAssetsDir: join(
							import.meta.dirname,
							"../../../apps/desktop/resources/export-assets",
						),
					},
				);
				expect(result.exitCode, result.stderr + result.stdout).toBe(0);
				const zip = new AdmZip(await readFile(output));
				assertSelfCheckPackage(zip, expected);
			}
		} finally {
			await rm(root, { recursive: true });
		}
	},
);

it.each(["en", "fr"] as const)(
	"keeps %s runtime admission and all delivery notices",
	async (locale) => {
		const { read, input } = releaseCourse(locale);
		const expected = releaseExpected[locale];
		await expect(
			createCourseContext({
				...input,
				htmlOutput: {
					islandAssets: { ...compilerIslandAssets, islandFilenames: { nav: "nav.js" } },
				},
			}),
		).rejects.toMatchObject({
			code: "EISLANDASSET",
			message: "Required island assets unavailable: selfCheck.",
		});
		const artifact = await compileCourse(input);
		try {
			for (const format of ["html", "scorm12", "scorm2004"] as const) {
				const zip = new AdmZip((await deployCourse(artifact, { format })).zip);
				const notice = zip
					.getEntries()
					.find((entry) => entry.entryName.endsWith("learning-patterns@0.1.0.txt"));
				expect(notice).toBeDefined();
				if (!notice) throw new Error("Missing learning-patterns notice");
				const license = notice.getData().toString().split("===== LICENSE =====\n")[1];
				expect(createHash("sha256").update(license).digest("hex")).toBe(
					"d817c04f10efaffd1ab6dba0792a6567dce98f8ab41e86c64833a7b9cff7ecc5",
				);
			}
		} finally {
			await artifact.dispose();
		}
		const workbookInput = {
			title: input.title,
			locale,
			includeAnswerSheet: true,
			lessons: [
				{
					id: locale,
					title: input.title,
					locale,
					blocks: read.blocks,
					selfCheckContents: new Map(
						input.selfCheckContents.map((entry) => [entry.blockId, entry.content]),
					),
				},
			],
		};
		const workbook = buildCoursePdfSource(workbookInput);
		expect(workbook.questionCount).toBe(1);
		expect(workbook.diagnostics).toEqual([]);
		for (const text of [expected.task, ...expected.labels, ...expected.hints])
			expect(workbook.typstSource).toContain(text);
		expect(workbook.typstSource).toContain(expected.whole);
		expect(workbook.typstSource).toContain('super("[1]")');
		expect(workbook.typstSource).toContain('super("[2]")');
		if (process.env.PRAXITY_TEST_TYPST) {
			const root = await mkdtemp(join(tmpdir(), "self-check-release-pdf-"));
			try {
				const pdf = await exportCoursePdf({
					...workbookInput,
					executablePath: process.env.PRAXITY_TEST_TYPST,
				});
				const file = join(root, "workbook.pdf");
				await writeFile(file, pdf.pdf);
				const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
				for (const phrase of [
					expected.task,
					expected.printedModel,
					...expected.labels,
					...expected.hints,
					expected.whole,
				])
					expect(text.replace(/\s+/g, " ")).toContain(phrase);
			} finally {
				await rm(root, { recursive: true });
			}
		}
	},
);
