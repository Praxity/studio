import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RetrievalSheetContent } from "@praxity/content-model";
import { readLesson } from "@praxity/grammar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	buildCoursePdfSource,
	type CoursePdfOptions,
	exportCoursePdf,
} from "../src/pipelines/course-pdf.ts";

const special = '#set text(red) $x$ *b* _i_ \\ [l] "q" @r <l> = - +';
const longTitle = "identifier".repeat(8);
const longQuestion = "a".repeat(400);
const longAnswer = "b".repeat(1500);

function fixture(locale: string, count = 3, includeAnswerSheet = false): CoursePdfOptions {
	const title = locale === "fr" ? "Approches de conception" : "Design approaches";
	const rows = Array.from(
		{ length: count },
		(_, i) => `:: Question ${i + 1}\nanswer: ANSWER${i + 1} literal answer.`,
	);
	const read = readLesson(`# Practice\n::: retrieval-sheet ${title}\n${rows.join("\n")}\n:::\n`);
	return {
		title: "Workbook",
		locale,
		includeAnswerSheet,
		lessons: [{ id: "lesson", title: "Practice", locale, blocks: read.blocks }],
	};
}

function content(input: CoursePdfOptions): RetrievalSheetContent {
	const sheet = input.lessons[0].blocks.find((block) => block.type === "retrievalSheet");
	if (!sheet) throw new Error("Missing retrieval fixture");
	return sheet.data.content as RetrievalSheetContent;
}

function addAssessment(input: CoursePdfOptions) {
	const read = readLesson(
		"# Mixed\n::: choice Later assessment\n(x) RIGHT_AFTER_SHEET\n( ) Wrong\n:::\n",
	);
	input.lessons[0].blocks.push(...read.blocks.filter((block) => block.type === "assessment"));
}

it.each(["en", "fr"])(
	"prepares %s questions, blank date and writing space without answer bytes",
	(locale) => {
		const result = buildCoursePdfSource(fixture(locale));
		expect(result.diagnostics).toEqual([]);
		expect(result.questionCount).toBe(0);
		expect(result.typstSource).toContain(locale === "fr" ? "Me tester le" : "Test myself on");
		expect(result.typstSource).toContain("#v(1.6cm)");
		expect(result.typstSource).toContain("0.75pt + px-ink");
		expect(result.typstSource).not.toContain("ANSWER");
	},
);

it("prepares the explicit answer sheet from public content, preserving local numbering", () => {
	const result = buildCoursePdfSource(fixture("en", 3, true));
	const [front, back] = result.typstSource.split("#heading(level: 1)[Answer sheet]");
	expect(front).not.toContain("ANSWER");
	for (let n = 1; n <= 3; n++) expect(back).toContain(`ANSWER${n} literal answer.`);
	expect(back).toContain("#enum(");
	expect(back.indexOf("ANSWER1")).toBeLessThan(back.indexOf("ANSWER2"));
	expect(back.indexOf("ANSWER2")).toBeLessThan(back.indexOf("ANSWER3"));
});

it("leaves subsequent assessment numbers unchanged and prints their answers before sheet sections", () => {
	const input = fixture("en", 3, true);
	addAssessment(input);
	const result = buildCoursePdfSource(input);
	expect(result.questionCount).toBe(1);
	expect(result.typstSource).toContain("[Q1]");
	expect(result.typstSource).not.toContain("[Q4]");
	const appendix = result.typstSource.split("#heading(level: 1)[Answer sheet]")[1];
	expect(appendix.indexOf("RIGHT_AFTER_SHEET")).toBeLessThan(appendix.indexOf("ANSWER1"));
});

it("discards a skipped container's partially prepared retrieval answer section", () => {
	const input = fixture("en", 3, true);
	const sheet = input.lessons[0].blocks.find((block) => block.type === "retrievalSheet");
	if (!sheet) throw new Error("Missing sheet");
	input.lessons[0].blocks = [
		{
			id: "cards",
			type: "card",
			data: {
				items: [
					{ id: "first", front: [sheet], back: [] },
					{ id: "second", label: " ", front: [], back: [] },
				],
			},
		},
		{ id: "survives", type: "text", data: { content: "SURVIVES" } },
	];
	const result = buildCoursePdfSource(input);
	expect(result.diagnostics).toContainEqual(
		expect.objectContaining({ blockId: "cards", code: "invalid_block_data" }),
	);
	expect(result.typstSource).toContain("SURVIVES");
	expect(result.typstSource).not.toContain("ANSWER");
	expect(result.typstSource).not.toContain("Answer sheet");
});

it("admits a valid sheet for native publication", () => {
	expect(readLesson("# Page\n::: retrieval-sheet T\n:: Q\nanswer: A\n:::\n").errors).toEqual([]);
});

it("rejects malformed public content without including authored text in the error", () => {
	const input = fixture("en");
	content(input).questions[0].answer = "";
	expect(() => buildCoursePdfSource(input)).toThrow("Invalid retrieval-sheet content.");
});

it.each(["title", "question", "answer"] as const)(
	"rejects %s control characters with a content-free error",
	(field) => {
		const input = fixture("en");
		const sheet = content(input);
		if (field === "title") sheet.title = "SECRET\u0000TITLE";
		else sheet.questions[0][field] = "SECRET\u0085TEXT";
		expect(() => buildCoursePdfSource(input)).toThrow("Invalid retrieval-sheet content.");
	},
);

// Two compiles total: combine all EN/FR, 3/8-row and heading-level fixtures in
// each answer mode. Poppler also runs once per output, rather than per variant.
describe.skipIf(!process.env.PRAXITY_TEST_TYPST)("native retrieval workbook", () => {
	let root: string;
	const pdfs = new Map<boolean, { text: string; structure: string; bbox: string; raw: string }>();
	// Two real exports share the existing native-test 60 s allowance. Setup took
	// 2.2–3.7 s locally; loaded CI must not inherit the unrelated 10 s hook default.
	beforeAll(async () => {
		const executablePath = process.env.PRAXITY_TEST_TYPST;
		if (!executablePath) throw new Error("Pinned Typst is required");
		root = await mkdtemp(join(tmpdir(), "retrieval-pdf-"));
		for (const answers of [false, true]) {
			const input: CoursePdfOptions = {
				title: "Workbook",
				locale: "en",
				includeAnswerSheet: answers,
				lessons: [],
			};
			for (const locale of ["en", "fr"])
				for (const count of [3, 8]) {
					const part = fixture(locale, count);
					const sheet = part.lessons[0].blocks.find((block) => block.type === "retrievalSheet");
					if (!sheet) throw new Error("Missing sheet");
					sheet.data.level = count === 3 ? 1 : 2;
					const data = content(part);
					const stress = locale === "en" && count === 8;
					data.title = locale === "en" ? longTitle : "Feuille de rappel";
					data.questions.forEach((row, i) => {
						row.question =
							stress && i === 0 ? longQuestion : `${locale}-${count} Question ${i + 1}: ${special}`;
						row.answer =
							stress && i === 0
								? longAnswer
								: `ANSWER_${locale}_${count}_${i + 1} ${stress ? "Recall the whole answer. ".repeat(60) : special}`.slice(
										0,
										1500,
									);
					});
					if (locale === "en" && count === 3) addAssessment(part);
					input.lessons.push({
						...part.lessons[0],
						id: `${locale}-${count}`,
						title: `${locale}-${count}`,
					});
				}
			const wholeWord = fixture("en");
			content(wholeWord).title = `${"W ".repeat(22)}internationalization`;
			input.lessons.push({ ...wholeWord.lessons[0], id: "whole-word", title: "Whole word" });
			const result = await exportCoursePdf({ ...input, executablePath });
			expect(result.diagnostics).toEqual([]);
			const file = join(root, `${answers}.pdf`);
			await writeFile(file, result.pdf);
			const run = (tool: string, args: string[]) => execFileSync(tool, args, { encoding: "utf8" });
			pdfs.set(answers, {
				raw: result.pdf.toString("latin1"),
				text: run("pdftotext", [file, "-"]),
				structure: run("pdfinfo", ["-struct-text", file]),
				bbox: run("pdftotext", ["-bbox", file, "-"]),
			});
		}
	}, 60_000); // timeout: docs/context/testing-strategy.md
	afterAll(async () => {
		if (root) await rm(root, { recursive: true });
	});

	for (const answers of [false, true]) {
		it(`answers ${answers}: both locales, row counts, literal text, tags and local numbering`, () => {
			const pdf = pdfs.get(answers);
			if (!pdf) throw new Error("Missing rendered variant");
			expect(pdf.raw).toContain("/Marked true");
			expect(pdf.structure).toContain(`H2 "${longTitle}"`);
			expect(pdf.structure).toContain(`H3 "${longTitle}"`);
			expect(pdf.structure).toContain('H2 "Feuille de rappel"');
			expect(pdf.structure).toContain('H3 "Feuille de rappel"');
			expect(pdf.structure).toContain("LBody");
			expect(pdf.text).toContain(special);
			for (const locale of ["en", "fr"]) {
				expect(pdf.raw).toContain(`/Lang(${locale})`);
				expect(pdf.text).toContain(locale === "fr" ? "Me tester le" : "Test myself on");
				expect(pdf.text.replace(/\s+/g, " ")).toContain(
					locale === "fr"
						? answers
							? "À la date choisie, répondez de mémoire. Consultez ensuite le corrigé."
							: "À la date choisie, répondez de mémoire."
						: answers
							? "On your chosen date, answer from memory. Then check the answer sheet."
							: "On your chosen date, answer from memory.",
				);
				for (const count of [3, 8]) {
					for (let n = locale === "en" && count === 8 ? 2 : 1; n <= count; n++) {
						expect(pdf.text).toContain(`${locale}-${count} Question ${n}`);
						if (answers)
							expect(pdf.text).toMatch(new RegExp(`${n}\\.\\s+ANSWER_${locale}_${count}_${n}`));
					}
					if (answers) {
						const start = locale === "en" && count === 8 ? 2 : 1;
						for (let n = start; n < count; n++)
							expect(pdf.text.indexOf(`ANSWER_${locale}_${count}_${n}`)).toBeLessThan(
								pdf.text.indexOf(`ANSWER_${locale}_${count}_${n + 1}`),
							);
					}
				}
			}
			if (!answers) {
				expect(pdf.text).not.toContain("ANSWER_");
				expect(pdf.text).not.toContain("Then check");
				expect(pdf.text).not.toContain("Consultez ensuite");
				expect(pdf.text.replace(/\s/g, "")).not.toContain(longAnswer);
			} else {
				expect(pdf.text).toContain("Then check the answer sheet.");
				expect(pdf.text).toContain("Consultez ensuite le corrigé.");
				const pages = pdf.text.split("\f");
				expect(pages.findIndex((page) => page.includes("ANSWER_en_3_1"))).toBeGreaterThan(
					pages.findIndex((page) => page.includes("fr-8 Question 8")),
				);
				expect(pages.filter((page) => /Recall|bbbb/.test(page)).length).toBeGreaterThan(2);
				const appendix = pdf.structure.slice(pdf.structure.indexOf('H1 "Answer sheet"'));
				expect(appendix).toContain('"Q1"');
				expect(appendix.indexOf("RIGHT_AFTER_SHEET")).toBeLessThan(
					appendix.indexOf(`H2 "${longTitle}"`),
				);
			}
		});

		it(`answers ${answers}: internationalization moves down whole rather than splitting`, () => {
			const pdf = pdfs.get(answers);
			if (!pdf) throw new Error("Missing rendered variant");
			expect(pdf.text).toContain("internationalization");
			expect(pdf.bbox).toContain(">internationalization</word>");
			expect(pdf.text).not.toMatch(/internationaliza\s+tion/);
			const words = [
				...pdf.bbox.matchAll(
					/<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)<\/word>/g,
				),
			];
			const index = words.findIndex((word) => word[2] === "internationalization");
			expect(index).toBeGreaterThan(0);
			expect(words[index - 1][2]).toBe("W");
			expect(Number(words[index][1])).toBeGreaterThan(Number(words[index - 1][1]));
		});

		it(`answers ${answers}: 80-character titles at levels 1/2, long questions and answers stay inside the page box`, () => {
			const pdf = pdfs.get(answers);
			if (!pdf) throw new Error("Missing rendered variant");
			const words = [
				...pdf.bbox.matchAll(
					/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">/g,
				),
			];
			expect(words.length).toBeGreaterThan(100);
			expect(Math.min(...words.map((word) => Number(word[1])))).toBeGreaterThanOrEqual(60);
			expect(Math.max(...words.map((word) => Number(word[3])))).toBeLessThanOrEqual(535);
			expect(Math.min(...words.map((word) => Number(word[2])))).toBeGreaterThanOrEqual(30);
			expect(Math.max(...words.map((word) => Number(word[4])))).toBeLessThanOrEqual(812);
			expect(pdf.text.replace(/\s/g, "")).toContain(longTitle);
			expect(pdf.text.replace(/\s/g, "")).toContain(longQuestion);
			if (answers) expect(pdf.text.replace(/\s/g, "")).toContain(longAnswer);
		});
	}
});
