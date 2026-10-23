import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import type { CourseExportInput } from "../../../src/build";

const grammar =
	'---\ntitle: Inline sources and icons\nlang: en\nvariables:\n  learnerName: Taylor\n---\n\n# Sources in prose\n\nUse @icon{mail} Mail or @icon{IconMailFilled} Mail selected to identify the control.\n\nThe first statement has a source.@source{First **source**, 2026.}\n\n::: accordion\n:: Sources {level=3}\n@sources\n:::\n\nThe second statement follows the list placement.@source{Second source with [details](https://example.com/source).}\n\n# Sources restart\nnav: Another page\n\nUse @icon{IconMail} Mail to send a message.\n\nThis page starts a fresh list.@source{Third source.}\n\n# Inline formatting across blocks\nnav: Cross-block formatting\n\n| Action | Meaning |\n| **Mail** @icon{mail} | [PPE]{Protective equipment} @source{Table source.} |\n\n::: accordion\n:: **Details** @icon{mail} @footer{Heading source.} {level=3}\nRead @highlight{the [manual](https://example.com/manual)} carefully before continuing.\n:::\n\n# Formatting remains visible\nnav: Visible formatting\n\nNormal text, **bold text**, and ==highlighted text==.\n\nDraw @box{a box} around these words.\n\nThe last block contains @arrow{the target}.\n\n# Variable values\n\nHello {{learnerName}}.\n\nLiteral code: `{{learnerName}}`.\n\n# Assessment feedback\n\n::: choice Which description is correct? {scored level=3}\nincorrect: @highlight.purple{Review "The calibration of a telescope".}\n( ) A telescope as a decoration\n(x) A telescope as a measuring tool\n\n:::\n';

export function buildInlineFeaturesCourse(): CourseExportInput {
	return {
		id: "inline-features",
		title: "Inline sources and icons",
		sourceLocale: "en",
		content: [
			...splitBlocksIntoPages(readLesson(grammar).blocks, "Inline sources and icons"),
			{
				id: "equation-code",
				title: "Equation and code fidelity",
				blocks: [
					{
						id: "inline-fraction",
						type: "text",
						data: {
							content:
								'<p>Half <span class="praxity-math-inline" data-math-latex="\\frac{1}{2}">\\frac{1}{2}</span>.</p>',
						},
					},
					{ id: "display-equation", type: "equation", data: { latex: "E=mc^2" } },
					{
						id: "display-matrix",
						type: "equation",
						data: { latex: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}" },
					},
					{ id: "invalid-equation", type: "equation", data: { latex: "\\invalid{" } },
					...[true, false].map((showLineNumbers) => ({
						id: showLineNumbers ? "numbered-code" : "unnumbered-code",
						type: "code" as const,
						data: {
							code: 'const answer = 42;\n\n\tconsole.log("<safe>");\n',
							language: "javascript",
							showLineNumbers,
							startLine: 4,
							highlightLines: [6],
						},
					})),
				],
			},
		],
		navigationStyle: "sidebar",
	};
}
