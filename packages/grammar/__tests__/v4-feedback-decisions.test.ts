import { describe, expect, it } from "vitest";
import { readLesson } from "../src/read-lesson";

describe("question and option feedback placement", () => {
	it("keeps named question parts separate from adjacent option feedback", () => {
		const lesson = readLesson(
			"# Page\n::: choice Q\nfeedback: Generic\ncorrect: Right\nincorrect: Wrong\n(x) Yes\nfeedback: Option right\n( ) No\nfeedback: Option wrong\n:::\n",
		);
		expect(lesson.errors).toEqual([]);
		const choice = lesson.tree.root.children[0].children.find((n) => n.type === "choice");
		expect(choice?.children.filter((n) => n.kind === "part").map((n) => n.name)).toEqual([
			"feedback",
			"correct",
			"incorrect",
		]);
		expect(
			choice?.children.filter((n) => n.kind === "option").map((n) => n.children[0].value?.value),
		).toEqual(["Option right", "Option wrong"]);
		expect(lesson.blocks.find((b) => b.type === "assessment")?.data.feedback).toMatchObject({
			correct: [{ data: { content: "<p>Right</p>" } }],
			incorrect: [{ data: { content: "<p>Wrong</p>" } }],
		});
	});
	it("uses generic feedback for both results with distinct child IDs", () => {
		const lesson = readLesson("# Page\n::: choice Q\nfeedback: Generic\n(x) Yes\n( ) No\n:::\n");
		expect(lesson.errors).toEqual([]);
		const feedback = lesson.blocks.find((b) => b.type === "assessment")?.data.feedback as {
			correct: { id: string; data: { content: string } }[];
			incorrect: { id: string; data: { content: string } }[];
		};
		expect(feedback.correct[0].data.content).toBe("<p>Generic</p>");
		expect(feedback.incorrect[0].data.content).toBe("<p>Generic</p>");
		expect(feedback.correct[0].id).not.toBe(feedback.incorrect[0].id);
	});
	it.each(["immediate", "after-submit", "after-all", "never", "deferred"])(
		"does not publish legacy timing %s as feedback",
		(timing) => {
			const lesson = readLesson(
				`# Page\n::: choice Q\nfeedback: ${timing}\n(x) Yes\n( ) No\n:::\n`,
			);
			expect(lesson.errors).toEqual([]);
			expect(lesson.blocks.find((b) => b.type === "assessment")?.data.feedbackEnabled).toBe(false);
		},
	);
	it.each(["feedback", "correct", "incorrect"])("refuses detached or late question %s", (name) => {
		const lesson = readLesson(`# Page\n::: choice Q\n(x) Yes\n\n${name}: Late\n( ) No\n:::\n`);
		expect(lesson.hasErrors).toBe(true);
		expect(lesson.errors.some((e) => e.line === 5)).toBe(true);
	});
	it.each([2, 3, 4])("accepts stats columns %s", (columns) => {
		expect(
			readLesson(`# Page\n::: stats {columns=${columns}}\n| 3 | Examples |\n:::\n`).errors,
		).toEqual([]);
	});
	it.each([0, 1, 5, 2.5])("rejects stats columns %s", (columns) => {
		expect(
			readLesson(`# Page\n::: stats {columns=${columns}}\n| 3 | Examples |\n:::\n`).hasErrors,
		).toBe(true);
	});
});
