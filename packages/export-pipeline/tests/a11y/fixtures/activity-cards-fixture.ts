import { DEFAULT_DESIGN_VARIANTS } from "../../../../editor-core/src/lib/themes/design-variant-defaults";
import { extractDesktopDesignFromFrontmatter } from "../../../src/desktop-design";
import { activityBugsFixture } from "./activity-bugs-fixture";

export function activityCardsFixture(locale: "en" | "fr", dark = false) {
	const course = activityBugsFixture(locale);
	Object.assign(
		course,
		extractDesktopDesignFromFrontmatter({
			design: {
				...DEFAULT_DESIGN_VARIANTS,
				palette: dark ? "clay" : "ink",
				colorMode: dark ? "dark" : "light",
			},
		}),
	);
	const question = course.content[0].blocks.find((block) => block.type === "assessment");
	if (!question) throw new Error("Missing choice fixture");
	const multiple = structuredClone(question);
	multiple.id = "multiple";
	multiple.data.stem = [
		{ id: "multi-stem", type: "text", data: { content: "Select constructive responses" } },
	];
	multiple.data.feedback = {
		correct: [
			{
				id: "multi-feedback-correct",
				type: "text",
				data: { content: "Listen before responding." },
			},
		],
		incorrect: [
			{
				id: "multi-feedback-wrong",
				type: "text",
				data: { content: "Consider how the other person feels." },
			},
		],
	};
	const response = {
		type: "choice",
		selectionMode: "multiple",
		options: [
			{ id: "multi-right", label: "Listen", isCorrect: true, feedback: "Let the person finish." },
			{
				id: "multi-wrong",
				label:
					"Interrupt before the other person has finished explaining the concern and tell them what they should do next without asking any questions.",
				isCorrect: false,
				feedback: "Give the person time to explain.",
			},
		],
	};
	multiple.data.response = response;
	question.data.response = {
		...response,
		selectionMode: "single",
		options: response.options.map((option) => ({
			...option,
			id: option.id.replace("multi", "single"),
		})),
	};
	course.content[0].blocks.splice(2, 0, multiple);
	return course;
}
