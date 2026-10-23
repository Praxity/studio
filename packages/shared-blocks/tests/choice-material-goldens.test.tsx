import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { compilerFixture } from "../../export-pipeline/tests/fixtures/page-compiler";
import { readLesson } from "../../grammar/src/read-lesson";
import { choiceContentSignature, choiceMaterialContent } from "../src/assessment-choice";
import {
	assessmentMaterialContent,
	assessmentMaterialOptionHtml,
	prepareAssessmentContent,
	prepareAssessmentDescriptionHtml,
	prepareAssessmentOptionHtml,
} from "../src/assessment-content";
import { PreviewAssessmentBlock } from "../src/blocks/AssessmentBlock";
import { getStrings } from "../src/i18n/strings";
import { flattenLogicBlocks } from "../src/logic/flatten-blocks";
import { preparePageFootnotes } from "../src/page-footnotes";
import type { AssessmentBlockData } from "../src/types";
import { exemptHtml, rebuild } from "./fixtures/choice-signature-html";
import vectors from "./fixtures/choice-signature-vectors.json";

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

it.each(cases)("round-trips renderer and material HTML for $name/$id", ({ data, id, name }) => {
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
	const projection = assessmentMaterialContent(data);
	if (data.response.type !== "choice") throw new Error("Missing material choice");
	if (name === "ancillary") {
		// Independent literals apply the compiler-node exemptions to the visible question words.
		expect(exemptHtml(projection.stemContent.heading)).toBe("Pick");
		expect(exemptHtml(projection.stemContent.body)).toBe("");
		expect(
			data.response.options.map((option) => exemptHtml(assessmentMaterialOptionHtml(option))),
		).toEqual(["Yes", "No"]);
		expect(choiceContentSignature(data, false)).toBe(vectors.question.hash);
	}
	if (name !== "ancillary") {
		expect(exemptHtml(projection.stemContent.heading)).toBe(
			exemptHtml(content.stemContent.heading),
		);
		expect(exemptHtml(projection.stemContent.body)).toBe(exemptHtml(content.stemContent.body));
		expect(exemptHtml(prepareAssessmentDescriptionHtml(projection.descriptionHtml))).toBe(
			exemptHtml(prepareAssessmentDescriptionHtml(content.descriptionHtml)),
		);
	}
	for (const input of [
		content.stemContent.heading,
		content.stemContent.body,
		prepareAssessmentDescriptionHtml(content.descriptionHtml),
		projection.stemContent.heading,
		projection.stemContent.body,
		prepareAssessmentDescriptionHtml(projection.descriptionHtml),
		...data.response.options.map((option) => assessmentMaterialOptionHtml(option)),
	]) {
		const tree = choiceMaterialContent(input);
		const rebuilt = rebuild(tree);
		expect(choiceMaterialContent(rebuilt)).toEqual(tree);
		expect(exemptHtml(rebuilt)).toBe(exemptHtml(input));
	}
});
