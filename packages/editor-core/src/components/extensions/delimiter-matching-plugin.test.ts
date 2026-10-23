import { describe, expect, it } from "vitest";
import { analyzeDelimiterStructure, type DelimiterLine } from "./delimiter-matching-plugin";

function makeLines(textLines: string[]): DelimiterLine[] {
	let offset = 1;
	return textLines.map((text, index) => {
		const from = offset;
		const to = from + text.length;
		offset = to + 2;
		return {
			index,
			text,
			from,
			to,
			nodePos: from - 1,
			nodeSize: text.length + 2,
		};
	});
}

describe("analyzeDelimiterStructure", () => {
	it("matches nested grammar 4 fences and diagnoses a stray closer outside inert code", () => {
		const analysis = analyzeDelimiterStructure(
			makeLines([
				"# Page",
				"::: columns",
				"::",
				"::: accordion",
				":: Item",
				"Words",
				":::",
				":::",
				"```",
				":::",
				"```",
				":::",
			]),
		);
		expect(
			analysis.pairs.map(({ openerLine, closerLine, level }) => [openerLine, closerLine, level]),
		).toEqual([
			[1, 7, 1],
			[3, 6, 2],
		]);
		expect(analysis.unmatchedOpeners).toEqual([]);
		expect(analysis.unmatchedClosers).toEqual([11]);
		expect(analysis.lineLevels.get(5)).toEqual([1, 2]);
	});
});
