import { materializeInlineIcons } from "@praxity/content-model/inline-icons";
import { prepareInlineBlocks } from "@praxity/content-model/inline-preparation";
import { renderInlineTree } from "@praxity/content-model/inline-tree";
import { expect, it } from "vitest";
import { choiceContentSignature, choiceStateQuestion } from "../src/assessment-choice";
import { assessmentMaterialContent, assessmentMaterialOptionHtml } from "../src/assessment-content";
import { fieldQuestion, producers, question } from "./fixtures/choice-material";

it.each(["label", "text"])("current %s wins over a stale bound display", (field) => {
	const option = {
		[field]: "No",
		_inlineTrees: { [field]: { trees: [producers[1].parse("Yes")], display: "Yes" } },
	};
	expect(assessmentMaterialOptionHtml(option)).toBe("No");
});

it("current stem content wins over a stale bound display", () => {
	const data = fieldQuestion("Yes", "stem", producers[0]);
	const stem = data.stem as { data: Record<string, unknown> }[];
	stem[0].data._inlineTrees = {
		content: {
			trees: (stem[0].data._inlineTrees as { content: unknown[] }).content,
			display: "<p>Yes</p>",
		},
	};
	stem[0].data.content = "<p>No</p>";
	expect(assessmentMaterialContent(data).stemContent.heading).toBe("No");
});

for (const producer of producers)
	for (const wrap of [(s: string) => `[${s}](https://x.test)`, (s: string) => `~~${s}~~`])
		for (const mark of ["==WORD==", "@circle{WORD}", "[WORD]{Definition}"])
			for (const field of ["stem", "option"] as const)
				it(`${producer.name} ${field} retains ${wrap(mark)} beside notes`, () => {
					const pristine = fieldQuestion(wrap(mark.replace("WORD", "Yes")), field, producer);
					for (const source of [
						`${producer.note} ${mark}`,
						`${producer.note} ${producer.note} ${mark}`,
						`${producer.note} ${mark} ${producer.note}`,
					]) {
						const decorated = fieldQuestion(wrap(source.replace("WORD", "Yes")), field, producer);
						expect(choiceStateQuestion(decorated, false)).toEqual(
							choiceStateQuestion(pristine, false),
						);
						expect(choiceContentSignature(decorated, false)).toBe(
							choiceContentSignature(pristine, false),
						);
					}
				});

for (const producer of producers)
	for (const mode of ["block", "tree"])
		it(`${producer.name} whole-stem coverage ignores a note-only second ${mode}`, () => {
			const make = (word: string, extra = true) => {
				const data = fieldQuestion(`==${word}==`, "stem", producer);
				const stem = data.stem as {
					data: { content: string; _inlineTrees: { content: unknown[] } };
				}[];
				const note = (
					fieldQuestion(producer.note, "description", producer).description as typeof stem
				)[0];
				if (extra && mode === "block") stem.push(note);
				if (extra && mode === "tree") {
					stem[0].data.content += note.data.content;
					stem[0].data._inlineTrees.content.push(...note.data._inlineTrees.content);
				}
				return data;
			};
			expect(choiceStateQuestion(make("Yes"), false)).toEqual(
				choiceStateQuestion(make("Yes", false), false),
			);
			expect(choiceContentSignature(make("Yes"), false)).not.toBe(
				choiceContentSignature(make("No"), false),
			);
		});

it.each(["Yes", "**Yes**"])("current option display wins over stale trees: %s", (source) => {
	const stale = producers[1].parse(source);
	const option = { label: source.replace("Yes", "No"), _inlineTrees: { label: [stale] } };
	expect(assessmentMaterialOptionHtml(option)).toBe(
		source === "Yes" ? "No" : "<strong>No</strong>",
	);
	const data = question();
	if (data.response.type !== "choice") throw new Error("Expected choice");
	Object.assign(data.response.options[0], option);
	const prepared = prepareInlineBlocks([
		{ id: "q", type: "assessment", data: data as unknown as Record<string, unknown> },
	]);
	const response = prepared[0].data.response as typeof data.response;
	expect(assessmentMaterialOptionHtml(response.options[0])).toBe(
		source === "Yes" ? "No" : "<strong>No</strong>",
	);
});

it("current stem display wins over stale trees", () => {
	const data = fieldQuestion("Yes", "stem", producers[0]);
	const stem = data.stem as { data: { content: string } }[];
	stem[0].data.content = "<p>No</p>";
	expect(choiceStateQuestion(data, false)).toEqual(
		choiceStateQuestion(fieldQuestion("No", "stem", producers[0]), false),
	);
	expect(renderInlineTree(producers[0].parse("Yes"))).toBe("Yes");
});

for (const field of ["label", "text", "content"] as const)
	for (const container of ["link", "strike"])
		for (const mark of ["==WORD==", "@circle{WORD}", "[WORD]{Definition}"])
			it(`raw ${field} ${container} whole ${mark} beside repeated notes`, () => {
				const wrap = (text: string) =>
					container === "link" ? `[${text}](https://x.test)` : `~~${text}~~`;
				const source = wrap(`@footer{A} @footer{B} ${mark.replace("WORD", "Yes")} @footer{C}`);
				const option =
					field === "content" ? { content: [{ type: "text", text: source }] } : { [field]: source };
				expect(assessmentMaterialOptionHtml(option)).toBe(
					container === "link" ? "Yes" : "<del>Yes</del>",
				);
			});

for (const producer of producers) {
	it(`${producer.name} refuses to rebind a stale input display`, () => {
		const option = {
			label: "No",
			_inlineTrees: { label: { trees: [producer.parse("Yes")], display: "Yes" } },
		};
		materializeInlineIcons(option, { outline: {}, filled: {} });
		expect(assessmentMaterialOptionHtml(option)).toBe("No");
	});
	it(`${producer.name} drops a partial stem mark beside an unowned block`, () => {
		const data = fieldQuestion("==Yes==", "stem", producer);
		(data.stem as unknown[]).push({ id: "opaque", type: "text", data: { content: "<p>More</p>" } });
		expect(assessmentMaterialContent(data).stemContent).toEqual({ heading: "More", body: "" });
	});
	it(`${producer.name} retains authored spacing inside a whole-mark link`, () => {
		const plain = fieldQuestion("[== Yes==](https://x.test)", "stem", producer);
		const decorated = fieldQuestion(
			`[${producer.note} == Yes==](https://x.test)`,
			"stem",
			producer,
		);
		expect(choiceStateQuestion(decorated, false)).toEqual(choiceStateQuestion(plain, false));
		expect(choiceContentSignature(decorated, false)).not.toBe(
			choiceContentSignature(fieldQuestion("[==Yes==](https://x.test)", "stem", producer), false),
		);
	});
	it(`${producer.name} two marked paragraphs cannot each cover the whole field`, () => {
		const data = fieldQuestion("==Yes==", "stem", producer);
		(data.stem as unknown[]).push(...(fieldQuestion("==No==", "stem", producer).stem as unknown[]));
		const empty = question();
		empty.stem = [];
		expect(choiceStateQuestion(data, false)).toEqual(choiceStateQuestion(empty, false));
	});
}
