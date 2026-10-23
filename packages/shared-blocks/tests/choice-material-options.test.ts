import { prepareInlineBlocks } from "@praxity/content-model/inline-preparation";
import { expect, it } from "vitest";
import { choiceContentSignature } from "../src/assessment-choice";
import { assessmentMaterialOptionHtml, optionLabelHtml } from "../src/assessment-content";
import { preparePageFootnotes } from "../src/page-footnotes";
import { question } from "./fixtures/choice-material";

const sig = (data: Parameters<typeof choiceContentSignature>[0]) =>
	choiceContentSignature(data, false);

it("uses a prepared learner label when no source tree owns it", () => {
	const data = question();
	if (data.response.type !== "choice") throw new Error("Expected choice");
	const option = data.response.options[0];
	Object.assign(option, { _inline: { label: "Different" } });
	expect(assessmentMaterialOptionHtml(option)).toBe("Different");
	const expected = question();
	if (expected.response.type !== "choice") throw new Error("Expected choice");
	expected.response.options[0].label = "Different";
	expect(sig(data)).toBe(sig(expected));
});

it.each(["Pick @footer{N} one", "==Yes==", "Pick ==aside== one", "[Yes]{Definition}"])(
	"keeps source ownership through raw preparation: %s",
	(label) => {
		const data = question();
		if (data.response.type !== "choice") throw new Error("Expected choice");
		data.response.options[0].label = label;
		const blocks = [
			{ id: "q", type: "assessment" as const, data: data as unknown as Record<string, unknown> },
		];
		for (const prepared of [
			prepareInlineBlocks(blocks),
			preparePageFootnotes(blocks, "page", { footnote: "Footnote", footnotes: "Sources" }),
		])
			expect(sig(prepared[0].data as unknown as typeof data)).toBe(sig(data));
	},
);
const whitespace = [
	["Pick one", "Pick one NOTE"],
	["Pick one", "NOTE Pick one"],
	["Pick one", "Pick NOTE one"],
	["Pickone", "PickNOTEone"],
	["Pick [one](https://x.test)", "Pick NOTE[one](https://x.test)"],
	["[Pick](https://x.test)", "[Pick NOTE](https://x.test)"],
	["[Pick](https://x.test)", "[NOTE Pick](https://x.test)"],
	["~~Pick~~", "~~Pick NOTE~~"],
	["~~Pick~~", "~~NOTE Pick~~"],
	["Pick.", "Pick. NOTE NOTE"],
	["Pick one", "NOTE Pick one NOTE"],
] as const;

for (const field of ["label", "text", "content"] as const) {
	it.each(["==WORD==", "@circle{WORD}", "[WORD]{Definition}"])(
		`raw option ${field} drops partial marks %s`,
		(mark) => {
			const option = (word: string) => {
				const text = `Pick ${mark.replace("WORD", word)} now`;
				return field === "content" ? { content: [{ type: "text", text }] } : { [field]: text };
			};
			for (const word of ["Old", "New"])
				expect(assessmentMaterialOptionHtml(option(word))).toBe("Pick now");
		},
	);
	it.each([
		"Yes",
		"[Yes]{Definition}",
		"[Yes]{Other definition}",
		"@circle{Yes}",
		"==Yes==",
		"**Yes**",
	])(`raw option ${field} and material keep whole label %s`, (text) => {
		const data = question();
		if (data.response.type !== "choice") throw new Error("Expected choice");
		const option = {
			id: "a",
			isCorrect: true,
			...(field === "content" ? { content: [{ type: "text", text }] } : { [field]: text }),
		};
		data.response.options[0] = option as (typeof data.response.options)[number];
		expect(sig(data)).toBe(sig(question()));
		expect(assessmentMaterialOptionHtml(option)).toBe(
			text === "**Yes**" ? "<strong>Yes</strong>" : "Yes",
		);
		if (text.startsWith("["))
			expect(optionLabelHtml(option)).toBe(
				`Yes (${text.includes("Other") ? "Other definition" : "Definition"})`,
			);
	});
	it.each(whitespace)(`raw option ${field} note erasure %#`, (plain, marked) => {
		const make = (text: string) => {
			const data = question();
			if (data.response.type !== "choice") throw new Error("Expected choice");
			data.response.options[0] = {
				id: "a",
				isCorrect: true,
				...(field === "content" ? { content: [{ type: "text", text }] } : { [field]: text }),
			} as (typeof data.response.options)[number];
			return data;
		};
		expect(sig(make(marked.replaceAll("NOTE", "@footer{N}")))).toBe(sig(make(plain)));
	});
}
