import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { compilerFixture } from "../../export-pipeline/tests/fixtures/page-compiler";
import { readLesson } from "../../grammar/src/read-lesson";
import {
	prepareAssessmentContent,
	prepareAssessmentDescriptionHtml,
	prepareAssessmentOptionHtml,
} from "../src/assessment-content";
import { PreviewAssessmentBlock } from "../src/blocks/AssessmentBlock";
import { getStrings } from "../src/i18n/strings";
import { flattenLogicBlocks } from "../src/logic/flatten-blocks";
import { preparePageFootnotes } from "../src/page-footnotes";
import type { AssessmentBlockData } from "../src/types";

const cases: { name: string; id: string; data: AssessmentBlockData }[] = (
	await Promise.all(
		(["leadership", "toolkit", "comprehensive"] as const).map(async (name) => {
			const fixture = await compilerFixture(name);
			return fixture.content.flatMap((page) =>
				flattenLogicBlocks(preparePageFootnotes(page.blocks, page.id, getStrings("en")))
					.filter((block) => block.type === "assessment" && block.data.assessmentType === "choice")
					.map((block) => ({
						name,
						id: block.id,
						data: block.data as unknown as AssessmentBlockData,
					})),
			);
		}),
	)
).flat();

let ordinary = 0;
const ancillary = readLesson(
	"# Practice\n::: choice @circle{[==Pick==]{Definition}} @source{Note}\n(x) @circle{[==Yes==]{Option definition}}\n( ) No\n:::\n",
	{
		ids: (node, role) =>
			node.kind === "option"
				? node.correct
					? "a"
					: "b"
				: node.type === "choice"
					? `question-${role ?? "root"}`
					: `other-${++ordinary}`,
	},
);
const ancillaryQuestion = preparePageFootnotes(
	ancillary.pages[0].blocks,
	ancillary.pages[0].id,
	getStrings("en"),
).find((block) => block.type === "assessment");
if (!ancillaryQuestion) throw new Error("Missing ancillary golden");
cases.push({
	name: "ancillary",
	id: ancillaryQuestion.id,
	data: {
		...ancillaryQuestion.data,
		gradingMode: "exact",
		points: 100,
		required: true,
	} as unknown as AssessmentBlockData,
});

it.each(cases)("preserves learner renderer HTML for $name/$id", ({ data, id, name }) => {
	const content = prepareAssessmentContent(data, "Question");
	const html = renderToStaticMarkup(
		<MantineProvider>
			<PreviewAssessmentBlock data={data} blockId={id} />
		</MantineProvider>,
	);
	if (content.stemHtml)
		expect(html).toContain(
			`<span class="praxity-assessment-stem-content">${content.stemContent.heading}</span>`,
		);
	if (content.stemContent.body)
		expect(html).toContain(
			`<div class="praxity-assessment-stem-body">${content.stemContent.body}</div>`,
		);
	if (content.descriptionHtml)
		expect(html).toContain(
			`<div id="assessment-description-${id}" class="praxity-assessment-description">${prepareAssessmentDescriptionHtml(content.descriptionHtml)}</div>`,
		);
	if (data.response.type !== "choice") throw new Error("Missing choice");
	for (const option of data.response.options)
		expect(html).toContain(
			`class="praxity-choice-label"><span>${prepareAssessmentOptionHtml(option)}</span></span>`,
		);
});
