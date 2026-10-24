import { inlineMaterial } from "@praxity/content-model/inline-tree";
import { expect, it } from "vitest";
import { choiceContentSignature, choiceStateQuestion } from "../src/assessment-choice";
import { assessmentMaterialContent, assessmentMaterialOption } from "../src/assessment-content";
import { compiled, fieldQuestion, producers, question } from "./fixtures/choice-material";
import { preparedIconQuestion } from "./fixtures/choice-material-icons";

for (const producer of producers) {
	for (const field of ["stem", "description", "option"] as const) {
		it(`${producer.name} ${field} excludes compiler footnotes and glossary`, () => {
			for (const source of [
				`Pick ${producer.note}`,
				`${producer.note} Pick`,
				`Pick ${producer.note} ${producer.note}`,
				"Pick [term]{Definition}",
				"Pick [edited]{Other}",
			]) {
				const data = fieldQuestion(source, field, producer);
				const content =
					field === "option"
						? assessmentMaterialOption(
								(data.response as { options: Record<string, unknown>[] }).options[0],
							)
						: assessmentMaterialContent(data);
				expect(content.text).toBe(field === "description" ? "Pick Pick" : "Pick");
				expect(choiceContentSignature(data, false)).toBe(
					choiceContentSignature(fieldQuestion("Pick", field, producer), false),
				);
			}
		});
		it(`${producer.name} ${field} counts whole and partial mark text`, () => {
			for (const source of [
				"==Yes==",
				"@circle{Yes}",
				"**Yes**",
				"Yes",
				"~~Yes~~",
				"[Yes](https://a.test)",
			]) {
				expect(choiceContentSignature(fieldQuestion(source, field, producer), false)).toBe(
					choiceContentSignature(fieldQuestion("Yes", field, producer), false),
				);
				expect(
					choiceContentSignature(fieldQuestion(`Pick ${source}`, field, producer), false),
				).toBe(choiceContentSignature(fieldQuestion("Pick Yes", field, producer), false));
			}
			expect(choiceContentSignature(fieldQuestion("==Yes==", field, producer), false)).not.toBe(
				choiceContentSignature(fieldQuestion("==No==", field, producer), false),
			);
		});
		it(`${producer.name} ${field} uses icon names across catalog redraws`, () => {
			const make = (name: string, path: string) =>
				preparedIconQuestion(producer.name, field, `Pick @icon{${name}}`, {
					outline: { mail: [["path", { d: path }]], star: [["path", { d: path }]] },
					filled: {},
				});
			expect(choiceContentSignature(make("mail", "M1 1"), false)).toBe(
				choiceContentSignature(make("mail", "M2 2"), false),
			);
			expect(choiceContentSignature(make("mail", "M1 1"), false)).not.toBe(
				choiceContentSignature(make("star", "M1 1"), false),
			);
		});
	}
	it(`${producer.name} tree projection preserves literal code and the source tree`, () => {
		const tree = producer.parse("**x** `@source{N}` @icon{mail}");
		const before = structuredClone(tree);
		expect(inlineMaterial(tree)).toEqual({ text: "x @source{N} ", icons: ["mail"] });
		expect(tree).toEqual(before);
	});
	it(`${producer.name} rejects stale display ownership`, () => {
		const data = fieldQuestion("Old", "stem", producer);
		(data.stem as { data: { content: string } }[])[0].data.content = "<p>New</p>";
		expect(assessmentMaterialContent(data).text).toBe("New");
		const tree = producer.parse("Old");
		for (const binding of [[tree], { trees: [tree], display: "Old" }]) {
			expect(
				assessmentMaterialOption({
					label: "New",
					_inline: { label: "New" },
					_inlineTrees: { label: binding },
				}).text,
			).toBe("New");
		}
	});
}
it("compiled glossary and footnotes drop by kind before page numbering", () => {
	expect(assessmentMaterialContent(compiled("Pick @source{Old}")).text).toBe("Pick");
	expect(choiceContentSignature(compiled("Pick @source{Old}"), false)).toBe(
		choiceContentSignature(
			compiled("Pick @source{New}", "", "Yes", "Earlier @source{Before}\n\n# Next\n"),
			false,
		),
	);
	expect(choiceContentSignature(compiled("Pick [term]{Old}"), false)).toBe(
		choiceContentSignature(compiled("Pick [edited]{New}"), false),
	);
});
it("raw HTML label footnotes retain option (a), and attributes stay immaterial", () => {
	const make = (note: string) => {
		const data = question();
		if (data.response.type !== "choice") throw new Error("Expected choice");
		data.response.options[0].label = `<span>Yes @footer{${note}}</span>`;
		return data;
	};
	expect(choiceContentSignature(make("Old"), false)).not.toBe(
		choiceContentSignature(make("New"), false),
	);
	expect(assessmentMaterialOption({ label: '<span title="@icon{mail}">Yes</span>' })).toEqual({
		text: "Yes",
		images: [],
		icons: [],
	});
});
it("uses a prepared raw label and refuses to sign stale source trees", () => {
	expect(assessmentMaterialOption({ label: "Yes", _inline: { label: "Different" } })).toEqual({
		text: "Different",
		images: [],
		icons: [],
	});
	expect(choiceStateQuestion(question(), false).content.text).toBe("Pick");
});

it("compiler variables contribute no initial visible text; missing image sources are empty", () => {
	expect(inlineMaterial(producers[0].parse("Pick {{score}}"))).toEqual({
		text: "Pick ",
		icons: [],
	});
	const data = question();
	data.stem = '<p>Pick<img alt="Empty"></p>';
	expect(assessmentMaterialContent(data)).toEqual({ text: "Pick", images: [], icons: [] });
});

it("normalizes after joining compiler blocks, so element boundaries never erase spaces", () => {
	const data = fieldQuestion("Pick ", "stem", producers[0]);
	const tail = fieldQuestion("one", "stem", producers[0]);
	(data.stem as unknown[]).push(...(tail.stem as unknown[]));
	expect(assessmentMaterialContent(data).text).toBe("Pick one");
	const raw = question();
	raw.stem = "<p>Pick </p><p>one</p>";
	expect(choiceContentSignature(data, false)).toBe(choiceContentSignature(raw, false));
});

for (const producer of producers)
	it(`${producer.name} compiler source-list nodes contribute no text`, () => {
		expect(inlineMaterial(producer.parse(producer.sources))).toEqual({ text: "", icons: [] });
		expect(
			choiceContentSignature(fieldQuestion(`Pick ${producer.sources}`, "stem", producer), false),
		).toBe(choiceContentSignature(fieldQuestion("Pick", "stem", producer), false));
	});
