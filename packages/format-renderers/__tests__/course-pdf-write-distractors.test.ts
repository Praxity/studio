import { readWriteDistractorsContent } from "@praxity/grammar";
import { describe, expect, it } from "vitest";
import { readLessonFixture } from "../../grammar/__tests__/helpers/lesson-fixture.ts";
import { buildCoursePdfSource, type CoursePdfLesson } from "../src/pipelines/course-pdf.ts";

function fixture(locale = "en") {
	const read = readLessonFixture(
		`# Practice\n\n::: write-distractors PUBLICQUESTION {count=2}\nanswer: WD_${locale}_RIGHT\n:: WD_${locale}_LABEL_A\noption: WD_${locale}_OPTION_A\n:: WD_${locale}_LABEL_B\noption: WD_${locale}_OPTION_B\n:::\n`,
	);
	const block = read.blocks.find((block) => block.type === "writeDistractors");
	if (!block) throw new Error("Missing distractor fixture");
	const content = readWriteDistractorsContent(read, block.id);
	const lesson: CoursePdfLesson = {
		id: "lesson",
		title: "Practice",
		locale,
		blocks: read.blocks,
		writeDistractorsContents: new Map([[block.id, content]]),
	};
	return { lesson, block, content };
}

for (const locale of ["en", "fr"])
	for (const pageSize of ["a4", "letter"] as const)
		describe(`${locale} ${pageSize}`, () => {
			it("prints a prompt-only workbook without needing or reading author input", () => {
				const { lesson } = fixture(locale);
				delete lesson.writeDistractorsContents;
				const result = buildCoursePdfSource({
					title: "Workbook",
					locale,
					pageSize,
					lessons: [lesson],
				});
				expect(result.typstSource).toContain("PUBLICQUESTION");
				expect(result.typstSource).toContain(
					locale === "fr" ? "mauvaises réponses" : "wrong options",
				);
				expect(result.typstSource).not.toMatch(/WD_|Answer sheet|Corrigé/);
				expect(result.diagnostics).toEqual([]);
				expect(result.questionCount).toBe(1);
				lesson.writeDistractorsContents = new Map();
				lesson.writeDistractorsContents.get = () => {
					throw new Error("Must not read hidden input");
				};
				expect(
					buildCoursePdfSource({ title: "Workbook", locale, pageSize, lessons: [lesson] })
						.typstSource,
				).toBe(result.typstSource);
			});
			it("puts right answer and numbered label/option pairs only in the explicit answer sheet", () => {
				const { lesson } = fixture(locale);
				const result = buildCoursePdfSource({
					title: "Workbook",
					locale,
					pageSize,
					lessons: [lesson],
					includeAnswerSheet: true,
				});
				const heading = `#heading(level: 1)[${locale === "fr" ? "Corrigé" : "Answer sheet"}]`;
				const [workbook, appendix] = result.typstSource.split(heading);
				expect(workbook).not.toContain("WD_");
				for (const suffix of ["RIGHT", "LABEL_A", "LABEL_B", "OPTION_A", "OPTION_B"])
					expect(appendix).toContain(`"WD_${locale}_${suffix}"`);
				const indices = ["LABEL_A", "OPTION_A", "LABEL_B", "OPTION_B"].map((suffix) =>
					appendix.indexOf(`"WD_${locale}_${suffix}"`),
				);
				expect(
					indices.every((position, index) => index === 0 || position > indices[index - 1]),
				).toBe(true);
				expect(appendix).toContain("#enum(");
				expect(result.questionCount).toBe(1);
			});
		});

it("refuses an answer sheet without its typed owning input", () => {
	const { lesson, block } = fixture();
	delete lesson.writeDistractorsContents;
	expect(() =>
		buildCoursePdfSource({
			title: "Workbook",
			locale: "en",
			lessons: [lesson],
			includeAnswerSheet: true,
		}),
	).toThrow(
		expect.objectContaining({ code: "write-distractors-content-missing", blockId: block.id }),
	);
});

it.each([
	"question",
	"count",
	"identity",
	"option-pair",
	"control",
	"blank-right",
	"blank-label",
	"blank-option",
	"duplicate-pair",
	"missing-pair",
	"extra-pair",
])("refuses %s correspondence/content without echoing hidden text", (mutation) => {
	const { lesson, content } = fixture();
	if (mutation === "question") content.question = "different";
	if (mutation === "count") content.count = 1;
	if (mutation === "identity") content.misconceptions.reverse();
	if (mutation === "option-pair") content.authorOptions[0].misconception = "foreign";
	if (mutation === "control") content.rightAnswer += "\u0000";
	if (mutation === "blank-right") content.rightAnswer = " ";
	if (mutation === "blank-label") content.misconceptions[0].label = " ";
	if (mutation === "blank-option") content.authorOptions[0].text = " ";
	if (mutation === "duplicate-pair")
		content.authorOptions[1].misconception = content.misconceptions[0].id;
	if (mutation === "missing-pair") content.authorOptions.pop();
	if (mutation === "extra-pair") content.authorOptions.push({ ...content.authorOptions[0] });
	expect(() =>
		buildCoursePdfSource({
			title: "Workbook",
			locale: "en",
			lessons: [lesson],
			includeAnswerSheet: true,
		}),
	).toThrow(
		expect.objectContaining({
			code: "write-distractors-content-invalid",
			reason: "Invalid write-distractors answer-sheet content.",
		}),
	);
});

it("pairs numbered labels with their own author option even when the option array is reordered", () => {
	const { lesson, content } = fixture();
	content.misconceptions[0].label = "Label A";
	content.misconceptions[1].label = "Label B";
	content.authorOptions[0].text = "Option A";
	content.authorOptions[1].text = "Option B";
	content.authorOptions.reverse();
	const result = buildCoursePdfSource({
		title: "Workbook",
		locale: "en",
		lessons: [lesson],
		includeAnswerSheet: true,
	});
	const appendix = result.typstSource.split("#heading(level: 1)[Answer sheet]")[1];
	const labelA = appendix.indexOf('"Label A"'),
		optionA = appendix.indexOf('"Option A"'),
		labelB = appendix.indexOf('"Label B"'),
		optionB = appendix.indexOf('"Option B"');
	expect(labelA).toBeGreaterThan(-1);
	expect(optionA).toBeGreaterThan(labelA);
	expect(labelB).toBeGreaterThan(optionA);
	expect(optionB).toBeGreaterThan(labelB);
});
