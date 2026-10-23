import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { checkCourseAccessibility, collectAllBlocksDeep } from "../checker";

it("checks converted containers and assessments without losing the authored question", () => {
	const source = readFileSync(
		resolve(import.meta.dirname, "../../../../../../docs/test-fixtures/cutover-coverage.md"),
		"utf8",
	);
	const lesson = readLesson(source);
	expect(lesson.diagnostics).toEqual([]);
	const blocks = collectAllBlocksDeep(lesson.blocks);
	expect(blocks.map((block) => block.type)).toEqual(
		expect.arrayContaining(["accordion", "tabs", "assessmentGroup", "assessment"]),
	);
	const question = blocks.find(
		(block) => block.type === "assessment" && block.data.assessmentType === "choice",
	);
	expect(question?.data).toMatchObject({
		stem: [{ data: { content: "<p>Which action helps?</p>" } }],
		scored: true,
		points: 2,
	});
	const report = checkCourseAccessibility(lesson.pages);
	expect(report.issues.filter((issue) => issue.rule === "image-alt")).toEqual([]);
});
