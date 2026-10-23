import { describe, expect, it } from "vitest";
import {
	assertCoursePracticeAdmission,
	CoursePracticeAdmissionError,
	practiceAdmissionDiagnostics,
	readLesson,
	validateCourse,
} from "../src/index";

const source = `# Practice\n::: choice PRIVATE PROMPT {private name=priv}\n(x) SECRET ANSWER\n( ) Other\n:::\n::: rule\nif: @priv.isCompleted is true\nthen: disableCompletion\n:::\n`;
describe("selective practice publication admission", () => {
	it.each(["en", "fr-CA"])("carries source spans and content-free %s copy", (locale) => {
		const read = readLesson(source);
		const diagnostics = practiceAdmissionDiagnostics([{ path: "lesson.prax", read }], locale);
		expect(diagnostics).toMatchObject([
			{
				code: "practice-no-tracking",
				file: "lesson.prax",
				line: 7,
				column: 1,
				span: { start: source.indexOf("if:"), end: source.indexOf("then:") },
				messageRef: { key: "grammar.v4.practice-no-tracking", args: { line: 7, column: 1 } },
			},
		]);
		expect(diagnostics[0].message).toBe(
			locale === "en"
				? "This practice activity cannot be read by course logic, write course state, supply a score or progression condition, or be required directly or through a container."
				: "Cette activité de pratique ne peut être lue par la logique du cours, modifier l’état du cours, fournir un score ou une condition de progression, ni être obligatoire directement ou par l’intermédiaire d’un conteneur.",
		);
		expect(JSON.stringify(diagnostics)).not.toMatch(/SECRET|PRIVATE PROMPT|isCompleted|priv"/);
		expect(() => assertCoursePracticeAdmission([{ path: "lesson.prax", read }], locale)).toThrow(
			CoursePracticeAdmissionError,
		);
	});
	it("keeps every existing course code non-blocking, including duplicate names and unknown references", () => {
		const read = readLesson(
			'# P\n::: text {name=same}\nOne\n:::\n::: text {name=same visible="@missing.isCompleted is true"}\nTwo\n:::\n',
		);
		const codes = validateCourse([{ path: "old.prax", tree: read.tree }]).diagnostics.map(
			(d) => d.code,
		);
		expect(codes).toEqual(["duplicate-logic-name", "unknown-logic-name"]);
		expect(practiceAdmissionDiagnostics([{ path: "old.prax", read }])).toEqual([]);
		expect(() => assertCoursePracticeAdmission([{ path: "old.prax", read }])).not.toThrow();
	});
});

it.each([
	["2.5", "en"],
	["'2'", "en"],
	["2", "en"],
	["2.5", "fr-CA"],
	["'2'", "fr-CA"],
	["2", "fr-CA"],
])("locates choice attempts=%s in %s without making other errors fatal", (attempts, locale) => {
	let id = 0;
	const read = readLesson(
		`# Page\n\n::: choice Pick one {attempts=${attempts}}\n(x) Yes\n( ) No\n:::\n`,
		{ ids: () => `source-${++id}` },
	);
	for (const format of ["runtime", "native-pdf"] as const) {
		const diagnostics = practiceAdmissionDiagnostics(
			[{ path: "lesson.prax", read }],
			locale,
			format,
		);
		if (attempts === "2") {
			expect(diagnostics).toEqual([]);
			expect(() =>
				assertCoursePracticeAdmission([{ path: "lesson.prax", read }], locale, format),
			).not.toThrow();
		} else {
			expect(diagnostics).toEqual([
				{
					code: "choice-invalid-attempts",
					message:
						locale === "en"
							? 'Invalid choice fact for block "source-6": attempts'
							: 'Donnée de choix invalide pour le bloc "source-6" : attempts',
					messageRef: {
						key: "grammar.v4.choice-invalid-attempts",
						args: { blockId: "source-6", line: 3, column: 22 },
					},
					file: "lesson.prax",
					line: 3,
					column: 22,
					span: { start: 29, end: 41 },
				},
			]);
			expect(() =>
				assertCoursePracticeAdmission([{ path: "lesson.prax", read }], locale, format),
			).toThrow(CoursePracticeAdmissionError);
		}
	}
});

it("keeps unrelated invalid settings advisory at publication", () => {
	const read = readLesson(
		"# Practice\n::: choice Pick {shuffle=invalid}\n(x) Yes\n( ) No\n:::\n::: text {attempts=invalid}\nStill visible\n:::\n",
	);
	expect(read.hasErrors).toBe(true);
	expect(practiceAdmissionDiagnostics([{ path: "lesson.prax", read }])).toEqual([]);
});

it.each(
	["match", "order"].flatMap((type) => ["2.5", "'2'", "2"].map((attempts) => [type, attempts])),
)("keeps %s attempts=%s advisory at publication", (type, attempts) => {
	const response = type === "match" ? "- A -> B\n- C -> D" : "1. First\n2. Second";
	const read = readLesson(
		`# Page\n::: ${type} Question {attempts=${attempts}}\n${response}\n:::\n`,
	);
	expect(read.errors).toEqual(
		attempts === "2"
			? []
			: [
					expect.objectContaining({
						attribute: "attempts",
						messageRef: {
							key: "grammar.v4.bad-setting-value",
							args: expect.objectContaining({ type }),
						},
					}),
				],
	);
	for (const format of ["runtime", "native-pdf"] as const) {
		expect(practiceAdmissionDiagnostics([{ path: "lesson.prax", read }], "en", format)).toEqual([]);
		expect(() =>
			assertCoursePracticeAdmission([{ path: "lesson.prax", read }], "en", format),
		).not.toThrow();
	}
});
