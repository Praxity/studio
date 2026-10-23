import { MantineProvider } from "@mantine/core";
import { validate } from "@praxity/grammar";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { renderBlockHtml } from "../../../export-pipeline/src/render-block-html";
import {
	readBlockFixture as readBlockSource,
	replayLesson,
} from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { adaptGrammarPreviewBlocks } from "../grammar-adapter";
import { materializeInlineIcons, prepareInlineBlocks } from "../inline-markdown";
import type { AssessmentBlockData } from "../types";
import { isFillBlankAnswerCorrect, PreviewAssessmentBlock } from "./AssessmentBlock";

afterEach(cleanup);

it.each(["dropdown", "word-bank"] as const)(
	"preserves escaped %s values in initial and activated output and grading",
	(style) => {
		const source =
			`# Fixture {hideTitle}\n\n::: fill-blank Choose {style=${style} scored}\n` +
			(style === "word-bank" ? `${String.raw`bank: a\|b | \{value\} | C:\\temp | spare`}\n` : "") +
			"\n" +
			(style === "dropdown"
				? String.raw`Keep \{literal\} and \____. Pick {*a\|b|other}, then {*\*star|plain}.`
				: String.raw`Keep \{literal\} and \____. Pick {a\|b}, then {\{value\}}, then {C:\\temp}.`) +
			"\n:::\n";
		const parsed = readBlockSource(source);
		const block = adaptGrammarPreviewBlocks(readBlockSource(replayLesson(parsed)).blocks)[0];
		const expected =
			style === "dropdown" ? ["a|b", "*star"] : ["a|b", "{value}", String.raw`C:\temp`];
		const baseline = document.createElement("div");
		baseline.innerHTML = renderBlockHtml(block);
		expect(baseline.textContent).toContain("Keep {literal} and ____.");
		expect(baseline.querySelectorAll("select")).toHaveLength(expected.length);
		const { container } = render(
			<MantineProvider>
				<PreviewAssessmentBlock
					blockId="escaped"
					data={block.data as unknown as AssessmentBlockData}
				/>
			</MantineProvider>,
		);
		expect(container.textContent).toContain("Keep {literal} and ____.");
		const selects = screen.getAllByRole("combobox");
		expect(selects).toHaveLength(expected.length);
		for (const [index, value] of expected.entries()) {
			expect([...baseline.querySelectorAll("select")][index].textContent).toContain(value);
			fireEvent.change(selects[index], { target: { value } });
		}
		fireEvent.click(screen.getByRole("button", { name: /submit/i }));
		expect(container.querySelector('[data-block-id="escaped"]')).toHaveAttribute(
			"data-result",
			"correct",
		);
	},
);

it("does not turn decoded ordinary text back into inline controls in later preparation or rendering", () => {
	const source = String.raw`Literal \*stars\*, \{{name}}, and \@icon{check}.`;
	const parsed = readBlockSource(source).blocks;
	const prepared = prepareInlineBlocks(adaptGrammarPreviewBlocks(parsed));
	materializeInlineIcons(prepared, { outline: {}, filled: {} });
	const html = renderBlockHtml(prepared[0]);
	expect(html).toContain("Literal *stars*, {{name}}, and @icon{check}.");
	expect(html).not.toMatch(/data-mention|praxity-inline-icon|<em>/);
});

it("keeps escaped typed wildcard punctuation literal while retaining legacy patterns", () => {
	const source =
		"# Untitled {hideTitle}\n\n::: fill-blank Typed {level=3}\nEnter {\\~0.5}, {~a\\*b}, {~a\\?b}, {~a*b}, then {~a?b}.\n:::\n";
	const block = adaptGrammarPreviewBlocks(
		readBlockSource(replayLesson(readBlockSource(source))).blocks,
	)[0];
	const response = (block.data as unknown as AssessmentBlockData).response;
	if (response.type !== "fillBlank") throw new Error("Expected blanks");
	for (const [index, accepted, rejected] of [
		[0, "~0.5", "0.5"],
		[1, "a*b", "axb"],
		[2, "a?b", "axb"],
		[3, "axxxb", "wrong"],
		[4, "axb", "axxb"],
	] as const) {
		expect(isFillBlankAnswerCorrect(accepted, response.blanks[index])).toBe(true);
		expect(isFillBlankAnswerCorrect(rejected, response.blanks[index])).toBe(false);
	}
});

it.each(["dropdown", "word-bank"] as const)(
	"accepts literal leading tildes in %s choices",
	(style) => {
		const source = `# Fixture {hideTitle}\n\n::: fill-blank Approximate {style=${style}}\n${style === "word-bank" ? `${String.raw`bank: \~0.5 | ~other`}\n` : ""}\nChoose ${style === "dropdown" ? String.raw`{*\~0.5|~other}.` : String.raw`{\~0.5}.`}\n:::\n`;
		const parsed = readBlockSource(source);
		expect(parsed.errors).toEqual([]);
		const response = (
			adaptGrammarPreviewBlocks(parsed.blocks)[0].data as unknown as AssessmentBlockData
		).response;
		if (response.type !== "fillBlank") throw new Error("Expected blanks");
		expect(isFillBlankAnswerCorrect("~0.5", response.blanks[0], style)).toBe(true);
		expect(isFillBlankAnswerCorrect("0.5", response.blanks[0], style)).toBe(false);
	},
);
