import { materialInlineTree, renderInlineTree } from "@praxity/content-model/inline-tree";
import { expect, it } from "vitest";
import { choiceContentSignature, choiceStateQuestion } from "../src/assessment-choice";
import {
	assessmentMaterialContent,
	prepareAssessmentDescriptionHtml,
} from "../src/assessment-content";
import { compiled, fieldQuestion, producers, question } from "./fixtures/choice-material";

const sig = (data: Parameters<typeof choiceContentSignature>[0]) =>
	choiceContentSignature(data, false);

it.each([["@source{Note}"], ["@sources"], ["@footer{Note}"], ["@footer.insert"]])(
	"erases either producer's valid footnote material for %s",
	(source) => {
		for (const producer of producers) {
			const material = materialInlineTree(producer.parse(source), true);
			expect(material ? renderInlineTree(material) : "").toBe("");
		}
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

for (const producer of producers)
	for (const field of ["stem", "description", "option"] as const) {
		it.each(whitespace)(
			`${producer.name} ${field} erases owned note separators %#`,
			(plain, source) => {
				expect(sig(fieldQuestion(source.replaceAll("NOTE", producer.note), field, producer))).toBe(
					sig(fieldQuestion(plain, field, producer)),
				);
			},
		);
		it.each(["*VALUE*", "**VALUE**", "==VALUE==", "@circle{VALUE}", "[VALUE]{Definition}"])(
			`${producer.name} ${field} nested note separators %s`,
			(wrapper) => {
				for (const [plain, source] of whitespace) {
					const before = wrapper.replace("VALUE", plain),
						after = wrapper.replace("VALUE", source.replaceAll("NOTE", producer.note));
					expect(sig(fieldQuestion(after, field, producer))).toBe(
						sig(fieldQuestion(before, field, producer)),
					);
				}
			},
		);
		it.each(["==WORD==", "@circle{WORD}", "[WORD]{Definition}"])(
			`${producer.name} ${field} drops partial %s`,
			(mark) => {
				const before = fieldQuestion(`Pick ${mark.replace("WORD", "old")} now`, field, producer);
				const after = fieldQuestion(`Pick ${mark.replace("WORD", "new")} now`, field, producer);
				expect(sig(before)).toBe(sig(after));
				expect(sig(before)).toBe(sig(fieldQuestion("Pick now", field, producer)));
			},
		);
		if (field !== "description")
			it.each([
				"==WORD==",
				"@circle{WORD}",
				"[WORD]{Definition}",
				"[==WORD==]{Definition}",
				"@circle{[WORD]{Definition}}",
				"**==WORD==**",
			])(`${producer.name} ${field} retains whole-mark words %s`, (mark) => {
				expect(sig(fieldQuestion(mark.replace("WORD", "Yes"), field, producer))).toBe(
					sig(fieldQuestion("Yes", field, producer)),
				);
				expect(sig(fieldQuestion(mark.replace("WORD", "No"), field, producer))).not.toBe(
					sig(fieldQuestion(mark.replace("WORD", "Yes"), field, producer)),
				);
			});
		it.each(["WORD", "**WORD**", "*WORD*", "~~WORD~~", "`WORD`"])(
			`${producer.name} ${field} retains word edits %s`,
			(mark) => {
				expect(sig(fieldQuestion(mark.replace("WORD", "One"), field, producer))).not.toBe(
					sig(fieldQuestion(mark.replace("WORD", "Two"), field, producer)),
				);
			},
		);
	}

it.each(["@sources", "@source{N}", "@source{N}\n\n@sources"])(
	"projects ancillary description envelopes before fields: %s",
	(description) => {
		const data = compiled("Pick", description);
		expect(assessmentMaterialContent(data).descriptionHtml).toBe("");
		expect(sig(data)).toBe(sig(compiled("Pick")));
	},
);
it("projects a description list insertion before joining fields", () => {
	const data = compiled("Pick", "Read\n\n@sources");
	expect(prepareAssessmentDescriptionHtml(assessmentMaterialContent(data).descriptionHtml)).toBe(
		"<p>Read</p>",
	);
	expect(sig(data)).toBe(sig(compiled("Pick", "Read")));
});
it.each(["<p></p>", "<p><br></p>"])("preserves authored empty HTML %s", (description) => {
	const data = { ...question(), description };
	expect(assessmentMaterialContent(data).descriptionHtml).toBe(description);
	expect(sig(data)).not.toBe(sig(question()));
});
it("page preparation, unrelated notes and fresh builds keep the material proof", () => {
	const plain = compiled("Pick one");
	for (const data of [
		compiled("Pick one @source{N}"),
		compiled("Pick one @source{N}", "", "Yes", "Earlier @source{Other}.", "Elsewhere"),
		compiled(
			"Pick one @source{N}",
			"",
			"Yes",
			"Earlier @source{Other}.\n\n# Second page",
			"First page",
		),
		compiled("Pick one @source{N}"),
	]) {
		expect(choiceStateQuestion(data, false)).toEqual(choiceStateQuestion(plain, false));
		expect(sig(data)).toBe(sig(plain));
	}
});
