import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { normalizeDesignVariants } from "../../../../editor-core/src/lib/themes/normalize-design-variants";
import type { CourseExportInput } from "../../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../../src/desktop-design";
import { activityBugsFixture } from "./activity-bugs-fixture";
import { FIXTURE_AUDIO_URL } from "./lightweight-fixture";

export function revealFixture(): CourseExportInput {
	const parsed = readLesson(`# Reveals

::: cards {columns=2}
${Array.from(
	{ length: 4 },
	(_, index) => `:: Question ${index + 1} {level=3}
Recall a constructive response.
::: back
Ask a question before proposing a solution. Listen to the reply and agree on a next step.
:::
`,
).join("\n")}
:::

::: accordion
:: A constructive response {level=3}
Ask a question before proposing a solution. Listen to the reply and agree on a next step.
:: Second response {level=3}
Describe what you heard.
:::

::: tabs
:: A long label that becomes a disclosure on a narrow screen
Ask a question before proposing a solution. Listen to the reply and agree on a next step.
:: Another long label that becomes a disclosure on a narrow screen
Describe what you heard.
:::

::: choice Choose a response {level=3}
(x) Ask a question
( ) Make an assumption
:::

`);
	if (parsed.hasErrors) throw new Error(JSON.stringify(parsed.errors));
	const content = splitBlocksIntoPages(parsed.blocks, "Reveals");
	content[0].blocks.push({
		id: "self-check-reveal",
		type: "selfCheck",
		data: { content: { task: "Describe a constructive response.", parts: [{ id: "criterion" }] } },
	});
	const question = parsed.blocks.find((block) => block.type === "assessment");
	if (!question) throw new Error("Missing reveal question");
	question.data.feedbackMode = "reveal";
	question.data.feedbackEnabled = true;
	question.data.feedback = {
		correct: [{ id: "explanation", type: "text", data: { content: "Listen before responding." } }],
		incorrect: [
			{ id: "explanation-wrong", type: "text", data: { content: "Ask before assuming." } },
		],
	};
	const response = question.data.response as { options: Array<{ feedback?: string }> };
	response.options[0].feedback = "Give the person time to explain.";
	content[0].blocks.push({
		id: "transcript-reveal",
		type: "audio",
		data: {
			src: FIXTURE_AUDIO_URL,
			transcript: "Ask a question before proposing a solution.",
		},
	});
	const categorized = activityBugsFixture("en").content[0].blocks.find(
		(block) => block.id === "categorize",
	);
	if (!categorized) throw new Error("Missing categorical reveal fixture");
	content[0].blocks.push(structuredClone(categorized), {
		id: "answer-list",
		type: "assessment",
		data: {
			assessmentType: "fillBlank",
			gradingMode: "exact",
			attempts: 2,
			feedbackMode: "reveal",
			feedbackEnabled: false,
			stem: [{ id: "answer-stem", type: "text", data: { content: "Complete the response" } }],
			response: { type: "fillBlank", blanks: [{ id: "word", answer: "questions" }] },
		},
	});
	return {
		...extractDesktopDesignFromFrontmatter({
			design: normalizeDesignVariants({ palette: "ink", colorMode: "auto" }),
		}),
		id: "shared-reveals",
		title: "Reveals",
		sourceLocale: "en",
		content,
		navigationStyle: "sidebar",
	};
}
