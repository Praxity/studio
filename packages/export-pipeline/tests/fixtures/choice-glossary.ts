import { readLesson } from "@praxity/grammar";
import { createCourseContext } from "../../src/preview/course-context";
import { compilerIslandAssets } from "./page-compiler";

export async function choiceGlossaryContext() {
	let n = 0;
	const lesson = readLesson(
		String.raw`# Practice
Earlier @source{Other}.

::: choice ==Pick one== [x](https://x.test) @source{N} \[STEM\]\{escaped\} {scored}
Read ==old== @source{More [NOTE]{note def}} \[DESC\]\{escaped\}.

@sources
(x) [Yes]{Option definition} @footer{F [FOOT]{foot def}}
( ) ~~@circle{No}~~ \[OPT\]\{escaped\}
:::
`,
		{ ids: () => `fixture-${++n}` },
	);
	if (lesson.hasErrors) throw new Error(JSON.stringify(lesson.diagnostics));
	return createCourseContext({
		id: "c",
		title: "c",
		sourceLocale: "en",
		htmlOutput: { islandAssets: compilerIslandAssets },
		content: [
			{ id: "grammar", title: "Grammar", blocks: lesson.pages[0].blocks },
			{
				id: "raw",
				title: "Raw",
				blocks: [
					{
						id: "raw",
						type: "assessment",
						data: {
							assessmentType: "choice",
							gradingMode: "exact",
							stem: [{ id: "s", type: "text", data: { content: "<p>Pick</p>" } }],
							response: {
								type: "choice",
								selectionMode: "single",
								options: [
									{ id: "a", label: "==Yes== @footer{N}", isCorrect: true },
									{ id: "b", text: "**No** [t]{d}" },
									{ id: "c", content: [{ type: "text", text: "@circle{Maybe}" }] },
								],
							},
						},
					},
				],
			},
		],
	});
}
