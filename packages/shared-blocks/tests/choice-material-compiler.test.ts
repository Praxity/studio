import { type InlineTree, inlineMaterial } from "@praxity/content-model/inline-tree";
import { expect, it } from "vitest";
import { choiceContentSignature, choiceStateQuestion } from "../src/assessment-choice";
import { assessmentMaterialContent, assessmentMaterialOption } from "../src/assessment-content";
import { compiled, fieldQuestion, producers, question } from "./fixtures/choice-material";
import { preparedIconQuestion } from "./fixtures/choice-material-icons";

for (const producer of producers) {
	for (const field of ["stem", "description", "option"] as const) {
		it(`${producer.name} ${field} excludes compiler footnotes`, () => {
			for (const source of [
				`Pick ${producer.note}`,
				`${producer.note} Pick`,
				`Pick ${producer.note} ${producer.note}`,
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
					field === "description"
						? "s96:U056WhNj1y_B63Za"
						: field === "option"
							? "s96:8oqfLJgfuNUov_QX"
							: "s96:3bsC6Tn5WgY9dA00",
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
it("compiled term labels count while definitions and footnotes drop by kind", () => {
	expect(assessmentMaterialContent(compiled("Pick @source{Old}")).text).toBe("Pick");
	expect(choiceContentSignature(compiled("Pick @source{Old}"), false)).toBe(
		choiceContentSignature(
			compiled("Pick @source{New}", "", "Yes", "Earlier @source{Before}\n\n# Next\n"),
			false,
		),
	);
	for (const stem of ["Pick [term]{Old}", "Pick [term]{New}", "Pick term"])
		expect(choiceContentSignature(compiled(stem), false)).toBe("s96:Jz6OeinvzYvnaDe7");
});

for (const producer of producers)
	for (const [field, whole, changedWhole, partial, changedPartial] of [
		[
			"stem",
			"s96:3Leq5l4bhE9WDFtC",
			"s96:RUZ_vfmd2GSl99u3",
			"s96:oPQho5JgWicvgq7V",
			"s96:LU-O3oLffr0RTv-6",
		],
		[
			"description",
			"s96:-oQjVcx6TVqyu5A-",
			"s96:PNBAezPDjjTUFGD9",
			"s96:a3leoMBjY0vhIKHm",
			"s96:t8n6-MeJvJVwj2z7",
		],
		[
			"option",
			"s96:R076OdZTDe1L3zKx",
			"s96:-KpkLGYTWQuySfR8",
			"s96:bE9kR8d0zEFZ1jWQ",
			"s96:Q5zaAbil4q7i3MWp",
		],
	] as const)
		it(`${producer.name} ${field} literal visible term, highlight and doodle vectors`, () => {
			for (const [source, expected] of [
				["gas", whole],
				["liquid", changedWhole],
				["the gas", partial],
				["the liquid", changedPartial],
				["[gas]{Old}", whole],
				["[gas]{New}", whole],
				["[liquid]{Old}", changedWhole],
				["the [gas]{Old}", partial],
				["the [gas]{New}", partial],
				["the [liquid]{Old}", changedPartial],
				["==gas==", whole],
				["==liquid==", changedWhole],
				["the ==gas==", partial],
				["the ==liquid==", changedPartial],
				["@circle{gas}", whole],
				["@circle{liquid}", changedWhole],
				["the @circle{gas}", partial],
				["the @circle{liquid}", changedPartial],
			] as const)
				expect(choiceContentSignature(fieldQuestion(source, field, producer), false), source).toBe(
					expected,
				);
		});

it("separates paragraphs inside one compiler field before normalizing", () => {
	for (const [description, expected] of [
		["ab\n\nc", "s96:ZX1T6H2h3-bIcC47"],
		["ab c", "s96:ZX1T6H2h3-bIcC47"],
		["a\n\nbc", "s96:2rtrSo1n5xzdvFOL"],
		["a bc", "s96:2rtrSo1n5xzdvFOL"],
	] as const)
		expect(choiceContentSignature(compiled("Pick", description), false)).toBe(expected);
	for (const producer of producers) {
		const data = fieldQuestion("ab", "description", producer);
		const blocks = data.description as {
			data: { content: string; _inlineTrees: { content: InlineTree[] } };
		}[];
		const tail = fieldQuestion("c", "description", producer).description as typeof blocks;
		blocks[0].data.content += tail[0].data.content;
		blocks[0].data._inlineTrees.content.push(...tail[0].data._inlineTrees.content);
		expect(choiceContentSignature(data, false)).toBe("s96:ZX1T6H2h3-bIcC47");
	}
	for (const [description, expected] of [
		["<p>ab</p><p>c</p>", "s96:ZX1T6H2h3-bIcC47"],
		["<p>a</p><p>bc</p>", "s96:2rtrSo1n5xzdvFOL"],
	] as const)
		expect(choiceContentSignature({ ...question(), description }, false)).toBe(expected);
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
