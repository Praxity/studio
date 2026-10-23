import { readFileSync } from "node:fs";
import { validateContent } from "learning-patterns/patterns/self-check/logic.js";
import { expect, it, vi } from "vitest";
import { readLesson, readSelfCheckContent, SelfCheckContentError } from "../src/index";

vi.mock("learning-patterns/patterns/self-check/logic.js", async (importOriginal) => {
	const library =
		await importOriginal<typeof import("learning-patterns/patterns/self-check/logic.js")>();
	return { ...library, validateContent: vi.fn(library.validateContent) };
});

const copy = (lang: "en" | "fr") =>
	JSON.parse(
		readFileSync(new URL(`../../editor-core/src/messages/${lang}.json`, import.meta.url), "utf8"),
	).op.diagnostic;
const errors = (text: string, lang: "en" | "fr" = "en") =>
	readLesson(text, {
		formatMessage: (message) => String(copy(lang)[message.key.replace("grammar.v4.", "")]),
	}).errors.map((error) => ({ message: error.message, line: error.line }));
const source = (evidence: string) =>
	`# P\n::: self-check Task\nmodel: Model\n:: Criterion\nmissed: Hint\nevidence: ${evidence}\n:::\n`;

it("reports a library refusal no other diagnostic covers", () => {
	vi.mocked(validateContent).mockImplementationOnce(() => {
		throw new Error("Invalid parts[0].label: a rule this host doesn't know");
	});
	expect(errors(source("Model"))).toEqual([
		{
			message: "The self-check library refuses this content. Check the task, model and criteria.",
			line: 2,
		},
	]);
});

it("names the evidence and model parts in French", () => {
	expect(errors(source("Missing"), "fr")).toEqual([
		{
			message:
				"Le texte de la partie evidence: doit apparaître exactement une fois dans la partie model:",
			line: 6,
		},
	]);
});

it("does not forward a library error or its cause from author content access", () => {
	const lesson = readLesson(source("Model"));
	const block = lesson.pages[0].blocks.find((block) => block.type === "selfCheck");
	if (!block) throw new Error("Missing self-check fixture");
	vi.mocked(validateContent).mockImplementationOnce(() => {
		throw new Error("Library failure with MODELMARK, HINTMARK and LABELMARK", {
			cause: "EVIDMARK",
		});
	});
	try {
		readSelfCheckContent(lesson, block.id);
		throw new Error("Expected accessor refusal");
	} catch (error) {
		expect(error).toBeInstanceOf(SelfCheckContentError);
		expect(error).toMatchObject({
			code: "self-check-content-invalid",
			message: "self-check-content-invalid",
		});
		expect(error).not.toHaveProperty("cause");
		expect(JSON.stringify(error)).not.toMatch(/MODELMARK|HINTMARK|LABELMARK|EVIDMARK/);
	}
});
