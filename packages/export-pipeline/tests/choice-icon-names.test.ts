import { choiceContentSignature } from "@praxity/shared-blocks/assessment-choice";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { beforeAll, expect, it } from "vitest";
import { parseInlineIconName, renderInlineIconSvg } from "../../content-model/src/inline-icons";
import { preparedIconQuestion } from "../../shared-blocks/tests/fixtures/choice-material-icons";
import {
	type CourseExportInput,
	compileCourse,
	compilePage,
	createCourseContext,
	deployCourse,
} from "../src/build";
import baseline from "./fixtures/choice-icon-mixed-main.json";
import { compilerIslandAssets } from "./fixtures/page-compiler";

const captures = new Map<
	string,
	{
		compiledHtml: string;
		exportedQuestionHtml: string;
		pageCount: number;
		data: ReturnType<typeof preparedIconQuestion>;
	}
>();
// Compile/export are shared fixture setup; failures here fail the whole interface suite.
beforeAll(async () => {
	for (const producer of ["grammar", "display"] as const) {
		const data = preparedIconQuestion(producer, "stem", "Then @icon{mail}", {
			outline: { mail: [["path", { d: "M1 1L2 2" }]] },
			filled: {},
		});
		const spec = parseInlineIconName("mail");
		if (!spec) throw new Error("Expected mail spec");
		const svg = renderInlineIconSvg("mail", spec, [["path", { d: "M1 1L2 2" }]]);
		(data.stem as unknown[]).push({
			id: "opaque",
			type: "text",
			data: { content: `<p>\` ${svg} \` <svg data-praxity-inline-icon="mail"></svg></p>` },
		});
		const input: CourseExportInput = {
			id: "icon-course",
			title: "Icons",
			sourceLocale: "en",
			content: [
				{
					id: "p",
					title: "Practice",
					blocks: [{ id: "q", type: "assessment", data: { ...data } }],
				},
			],
		};
		const context = await createCourseContext({
			...input,
			htmlOutput: { islandAssets: compilerIslandAssets },
		});
		const compiledHtml = compilePage(context, "p").html;
		const artifact = await compileCourse(input, {
			temporaryRoot: process.env.PRAXITY_TEST_ARTIFACTS,
		});
		try {
			const result = await deployCourse(artifact, { format: "html" });
			let exportedQuestionHtml = "";
			for (const entry of new AdmZip(result.zip)
				.getEntries()
				.filter((entry) => entry.entryName.endsWith(".html"))) {
				const dom = new JSDOM(entry.getData().toString("utf8"));
				const question = dom.window.document.querySelector("#block-q");
				if (question) exportedQuestionHtml = question.outerHTML;
				dom.window.close();
			}
			if (!exportedQuestionHtml) throw new Error("Missing exported question");
			captures.set(producer, {
				compiledHtml,
				exportedQuestionHtml,
				pageCount: result.pageCount,
				data,
			});
		} finally {
			await artifact.dispose();
		}
	}
});
for (const producer of ["grammar", "display"] as const) {
	it(`${producer} compiles and exports mixed raw and compiler icons with exact main learner bytes`, () => {
		const capture = captures.get(producer);
		if (!capture) throw new Error("Missing compiled/exported capture");
		// Pinned from the display owners at the recorded main revision, with no signature call.
		expect(capture.compiledHtml).toBe(baseline[producer].compiledHtml);
		expect(capture.exportedQuestionHtml).toBe(baseline[producer].exportedQuestionHtml);
		expect(capture.pageCount).toBe(1);
		expect(capture.exportedQuestionHtml).toContain("@icon{mail}");
	});
	it(`${producer} hashes the mixed icon question without refusal`, () => {
		const capture = captures.get(producer);
		if (!capture) throw new Error("Missing compiled/exported capture");
		expect(choiceContentSignature(capture.data, false)).toMatch(/^sha256:[0-9a-f]{64}$/);
	});
}
