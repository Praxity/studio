import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSelfCheckContent } from "@praxity/grammar";
import { expect, it } from "vitest";
import { readLessonFixture } from "../../grammar/__tests__/helpers/lesson-fixture.ts";
import {
	buildCoursePdfSource,
	type CoursePdfOptions,
	exportCoursePdf,
} from "../src/pipelines/course-pdf.ts";

function fixture(locale = "en"): CoursePdfOptions {
	const read = readLessonFixture(
		"# Practice\n::: self-check Explain the delay.\nmodel: Late data.\n  Send it Tuesday?\n:: Reason\nmissed: Name the cause.\nevidence: Late data.\n:: Respectful wording\nmissed: Ask politely.\n:::\n",
	);
	const block = read.blocks.find((block) => block.type === "selfCheck");
	if (!block) throw new Error("Missing self-check fixture");
	return {
		title: "Workbook",
		locale,
		includeAnswerSheet: true,
		lessons: [
			{
				id: "lesson",
				title: "Practice",
				locale,
				blocks: read.blocks,
				selfCheckContents: new Map([[block.id, readSelfCheckContent(read, block.id)]]),
			},
		],
	};
}

function authored(input: CoursePdfOptions) {
	const content = input.lessons[0].selfCheckContents?.values().next().value;
	if (!content) throw new Error("Missing author Content fixture");
	return content;
}

it("prints explicit author answers, numbered evidence and the whole-answer legend after the task", () => {
	const result = buildCoursePdfSource(fixture());
	expect(result.questionCount).toBe(1);
	expect(result.diagnostics).toEqual([]);
	const [task, answers] = result.typstSource.split("#heading(level: 1)[Answer sheet]");
	expect(task).toContain('"Explain the delay."');
	expect(task).not.toMatch(/Late data|Reason|Name the cause|Ask politely/);
	expect(answers).toContain(
		'underline({"Late data."}); super("[1]"); linebreak(); "Send it Tuesday?"',
	);
	expect(answers).toContain('#strong[#{"Reason"};]\n\n#{"Name the cause."};');
	expect(answers).toContain(
		'#strong[#{"Respectful wording"};]\n\n#{"Whole answer"};\n\n#{"Ask politely."};',
	);
});

it("uses the French pattern strings in the author answer sheet", () => {
	const source = buildCoursePdfSource(fixture("fr-CA")).typstSource;
	expect(source).toContain("Réponse modèle");
	expect(source).toContain("Toute la réponse");
});

it.each([false, true])(
	"refuses prompt-only PDF input with includeAnswerSheet=%s",
	(includeAnswerSheet) => {
		const input = fixture();
		delete input.lessons[0].selfCheckContents;
		expect(() => buildCoursePdfSource({ ...input, includeAnswerSheet })).toThrow(
			"Self-check can’t be exported to PDF yet.",
		);
	},
);

it("still refuses learner PDF even when author Content is supplied", () => {
	expect(() => buildCoursePdfSource({ ...fixture(), includeAnswerSheet: false })).toThrow(
		"Self-check can’t be exported to PDF yet.",
	);
});

it.each(["model", "task", "parts", "context"])(
	"refuses invalid or mismatched %s with a content-free code",
	(field) => {
		const input = fixture();
		const content = authored(input);
		if (field === "model") content.model = "SECRET_WRONG_MODEL";
		if (field === "task") content.task = "SECRET_WRONG_TASK";
		if (field === "parts") content.parts[0].id = "wrong-part";
		if (field === "context") content.context = { to: "Secret", initials: "S", subject: "Secret" };
		expect(() => buildCoursePdfSource(input)).toThrowError(
			expect.objectContaining({
				code: "ESELFCHECKPDFCONTENT",
				reason: "Invalid self-check answer-sheet content.",
			}),
		);
	},
);

it("keeps authored markup literal in the answer sheet", () => {
	const input = fixture();
	const content = authored(input);
	content.model = '<script>#panic("SECRET")</script> Late data.';
	content.parts[0].label = "**Reason**";
	const source = buildCoursePdfSource(input).typstSource;
	expect(source).toContain('#strong[#{"**Reason**"};]');
	expect(source.replace(/"(?:\\.|[^"\\])*"/g, '""')).not.toContain("#panic(");
});

it("retains overlapping criteria in the legend using the upstream evidence choice", () => {
	const input = fixture();
	const content = authored(input);
	content.parts[1].evidence = "data";
	const source = buildCoursePdfSource(input).typstSource;
	expect(source).toContain('underline({"Late data."}); super("[1]")');
	expect(source).not.toContain('super("[2]")');
	expect(source).toContain('#strong[#{"Respectful wording"};]\n\n#{"Ask politely."};');
});

it("rejects control characters without quoting the authored content", () => {
	const input = fixture();
	authored(input).parts[1].missed = "SECRET\u0000HINT";
	expect(() => buildCoursePdfSource(input)).toThrowError(
		expect.objectContaining({
			code: "ESELFCHECKPDFCONTENT",
			reason: "Invalid self-check answer-sheet content.",
		}),
	);
});

it.skipIf(!process.env.PRAXITY_TEST_TYPST).each(["en", "fr"])(
	"separates %s PDF criterion items more than their internal paragraphs",
	async (locale) => {
		const input = fixture(locale);
		const root = await mkdtemp(join(tmpdir(), "self-check-spacing-"));
		try {
			const executablePath = process.env.PRAXITY_TEST_TYPST;
			if (!executablePath) throw new Error("Bundled Typst is required");
			const result = await exportCoursePdf({ ...input, executablePath });
			const file = join(root, "workbook.pdf");
			await writeFile(file, result.pdf);
			const xml = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8" });
			const words = [
				...xml.matchAll(
					/<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)<\/word>/g,
				),
			];
			const word = (text: string) => {
				const found = words.find((w) => w[3] === text);
				if (!found) throw new Error(`Missing PDF word: ${text}`);
				return { top: Number(found[1]), bottom: Number(found[2]) };
			};
			const label = word("Reason"),
				hint = word("Name"),
				next = word("Respectful");
			expect(next.top - hint.bottom).toBeGreaterThan(hint.top - label.bottom);
		} finally {
			await rm(root, { recursive: true });
		}
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"compiles the self-check author workbook with bundled Typst",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "self-check-workbook-"));
		try {
			const executablePath = process.env.PRAXITY_TEST_TYPST;
			if (!executablePath) throw new Error("Bundled Typst is required");
			const result = await exportCoursePdf({
				...fixture(),
				executablePath,
			});
			const file = join(root, "workbook.pdf");
			await writeFile(file, result.pdf);
			expect(result.questionCount).toBe(1);
			expect(result.diagnostics).toEqual([]);
			expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
			const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
			for (const phrase of [
				"Explain the delay.",
				"Late data.",
				"Send it Tuesday?",
				"Respectful wording",
				"Whole answer",
				"Name the cause.",
				"Ask politely.",
			])
				expect(text).toContain(phrase);
			expect(text).not.toMatch(/Included|To add|Score/);
		} finally {
			await rm(root, { recursive: true });
		}
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"exports function-call punctuation literally in every authored field",
	async () => {
		const input = fixture();
		const content = authored(input);
		content.task = "Why does getUserFromStore(sessionIdentifier) fail?";
		(
			input.lessons[0].blocks.find((block) => block.type === "selfCheck")?.data.content as {
				task: string;
			}
		).task = content.task;
		content.model = "getUserFromStore(sessionIdentifier) returns null.";
		content.parts[0].evidence = "null";
		content.parts[0].label = "Calling getUserFromStore(sessionIdentifier)";
		content.parts[0].missed = "Check getUserFromStore(sessionIdentifier).";
		const root = await mkdtemp(join(tmpdir(), "self-check-call-"));
		try {
			const executablePath = process.env.PRAXITY_TEST_TYPST;
			if (!executablePath) throw new Error("Bundled Typst is required");
			const result = await exportCoursePdf({ ...input, executablePath });
			const file = join(root, "workbook.pdf");
			await writeFile(file, result.pdf);
			const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
			for (const phrase of [
				"Why does getUserFromStore(sessionIdentifier) fail?",
				"getUserFromStore(sessionIdentifier) returns null[1].",
				"Calling getUserFromStore(sessionIdentifier)",
				"Check getUserFromStore(sessionIdentifier).",
			])
				expect(text).toContain(phrase);
		} finally {
			await rm(root, { recursive: true });
		}
	},
);
