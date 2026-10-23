import { inlineIconPlaceholder, materializeInlineIcons } from "@praxity/content-model/inline-icons";
import { materialInlineTree, renderInlineTree } from "@praxity/content-model/inline-tree";
import { expect, it } from "vitest";
import { choiceContentSignature } from "../src/assessment-choice";
import { assessmentMaterialContent, assessmentMaterialOptionHtml } from "../src/assessment-content";
import { fieldQuestion, producers, question } from "./fixtures/choice-material";
import { type IconField, preparedIconQuestion } from "./fixtures/choice-material-icons";

const catalogA = {
	outline: {
		mail: [["path", { d: "M1 1L2 2", stroke: "currentColor" }]],
		phone: [["path", { d: "M2 2L3 3" }]],
	},
	filled: {},
};
const catalogB = {
	outline: {
		mail: [["path", { d: "M8 8L9 9", fill: "currentColor", opacity: 0.5 }]],
		phone: [["path", { d: "M6 6L7 7" }]],
	},
	filled: {},
};
const unresolved = { outline: {}, filled: {} };
const hash = /^sha256:[0-9a-f]{64}$/;

for (const producer of producers) {
	it(`${producer.name} material retains name-only compiler placeholders`, () => {
		const tree = producer.parse("Pick @icon{mail} then @icon{phone}");
		const material = materialInlineTree(tree);
		const expected =
			'Pick <span class="praxity-inline-icon" data-praxity-inline-icon="mail" data-icon="mail" data-icon-variant="outline" aria-hidden="true"></span> then <span class="praxity-inline-icon" data-praxity-inline-icon="phone" data-icon="phone" data-icon-variant="outline" aria-hidden="true"></span>';
		expect(material && renderInlineTree(material)).toBe(expected);
		expect(renderInlineTree(tree)).toBe(expected);
		const icon = tree.children.find((node) => node.kind === "icon");
		if (icon?.kind !== "icon") throw new Error("Expected compiler icon");
		icon.raw = "Ignored spelling";
		icon.name.raw = "Ignored spelling";
		const changedSpelling = materialInlineTree(tree);
		expect(changedSpelling && renderInlineTree(changedSpelling)).toBe(expected);
	});
	for (const field of ["stem", "description", "option"] as const) {
		const prepare = (source: string, catalog = catalogA) =>
			preparedIconQuestion(producer.name, field, source, catalog);
		const signature = (source: string) => choiceContentSignature(prepare(source), false);
		it(`${producer.name} ${field} distinguishes an icon from its escaped literal`, () => {
			for (const catalog of [catalogA, catalogB, unresolved]) {
				const icon = choiceContentSignature(prepare("Pick @icon{mail} tail", catalog), false);
				const literal = choiceContentSignature(
					prepare(String.raw`Pick @icon\{mail\} tail`, catalog),
					false,
				);
				expect(icon).toMatch(hash);
				expect(literal).toMatch(hash);
				expect(icon).not.toBe(literal);
			}
		});
		it(`${producer.name} ${field} changes for swapping, adding and removing an icon`, () => {
			const original = signature("Pick @icon{mail} tail");
			expect(original).toMatch(hash);
			for (const source of [
				"Pick @icon{phone} tail",
				"Pick @icon{mail} @icon{phone} tail",
				"Pick tail",
			])
				expect(signature(source), source).not.toBe(original);
			expect(signature("Pick @icon{mail} @icon{phone} tail")).not.toBe(
				signature("Pick @icon{phone} @icon{mail} tail"),
			);
		});
		it(`${producer.name} ${field} ignores catalog paths, paint and resolution in every context`, () => {
			for (const source of [
				"Pick @icon{mail} tail",
				"Pick ` then @icon{mail}",
				"`@icon{mail}` then @icon{phone}",
				"<table><tr><td>@icon{mail}</td></tr></table>",
				"<b title='@icon{mail}'>T</b>",
				`Pick @icon{mail} ${producer.note}\n\n${producer.sources}`,
			]) {
				const expected = choiceContentSignature(prepare(source), false);
				expect(expected, source).toMatch(hash);
				for (const catalog of [catalogB, unresolved]) {
					const data = prepare(source, catalog);
					const before = structuredClone(data);
					expect(choiceContentSignature(data, false), source).toBe(expected);
					expect(data).toEqual(before);
				}
			}
		});
		it(`${producer.name} ${field} ignores fragment details bound to the same compiler nodes`, () => {
			const data = prepare("Pick @icon{mail} tail");
			const expected = choiceContentSignature(data, false);
			const owner =
				field === "option"
					? (data.response as { options: Record<string, unknown>[] }).options[0]
					: (data[field] as { data: Record<string, unknown> }[])[0].data;
			const key = field === "option" ? "label" : "content";
			const binding = (owner._inlineTrees as Record<string, { display: string }>)[key];
			const display = binding.display
				.replace(
					'data-praxity-inline-icon="mail"',
					'title="Changed fragment" data-praxity-inline-icon="phone"',
				)
				.replace("M1 1L2 2", "M7 7L8 8");
			if (field === "option") owner._inline = { label: display };
			else owner.content = display;
			binding.display = display;
			expect(choiceContentSignature(data, false)).toBe(expected);
		});
		it(`${producer.name} ${field} retains the stale-display binding guard`, () => {
			const data = prepare("Pick @icon{mail}");
			const original = choiceContentSignature(data, false);
			if (field === "option") {
				if (data.response.type !== "choice") throw new Error("Expected choice");
				Object.assign(data.response.options[0], {
					label: "Changed",
					_inline: { label: "Changed" },
				});
			} else (data[field] as { data: { content: string } }[])[0].data.content = "<p>Changed</p>";
			materializeInlineIcons(data, catalogA);
			expect(choiceContentSignature(data, false)).toMatch(hash);
			expect(choiceContentSignature(data, false)).not.toBe(original);
		});
	}
	it(`${producer.name} hashes icon-shaped literals in prepared source lists`, () => {
		const source = producer.name === "grammar" ? "@source" : "@footer";
		const data = (name: string) =>
			preparedIconQuestion(
				producer.name,
				"description",
				`Read ${source}{Note @icon\\{${name}\\}}\n\n${producer.sources}\n\nThen @icon{mail}.`,
				catalogA,
			);
		const first = choiceContentSignature(data("mail"), false);
		expect(first).toMatch(hash);
		expect(choiceContentSignature(data("phone"), false)).toBe(first);
	});
	it(`${producer.name} raw HTML marker strings have no compiler icon nodes`, () => {
		const source = '<span data-praxity-inline-icon="mail" title="Detail"></span>';
		expect(producer.parse(source).children.map((node) => node.kind)).toEqual(["text"]);
		const data = fieldQuestion(source, "stem", producer);
		expect(assessmentMaterialContent(data).stemContent.heading).toContain(
			"data-praxity-inline-icon",
		);
	});
}

it("raw HTML without compiler provenance keeps ordinary material attributes", () => {
	const data = question();
	const option = (data.response as { options: Record<string, unknown>[] }).options[0];
	option.label = '<span data-praxity-inline-icon="mail" title="A"></span>';
	const first = choiceContentSignature(data, false);
	option.label = '<span data-praxity-inline-icon="mail" title="B"></span>';
	expect(choiceContentSignature(data, false)).not.toBe(first);
	expect(assessmentMaterialOptionHtml(option)).toContain('title="B"');
});

it.each(["stem", "description", "option"] as const)(
	"keeps class-only tooltip edits exempt beside a raw icon in %s",
	(field) => {
		const data = preparedIconQuestion("display", field, "Pick @icon{mail}", catalogA);
		const icon = inlineIconPlaceholder("mail", catalogA.outline.mail);
		const html = (className: string) =>
			`<p><span data-tooltip-content="Def">${icon}<span class="${className}">label</span></span></p>`;
		const raw = { id: "raw", type: "text", data: { content: html("inline-tooltip-fallback") } };
		if (field === "option") {
			if (data.response.type !== "choice") throw new Error("Expected choice");
			Object.assign(data.response.options[1], {
				label: "Raw",
				_inline: { label: raw.data.content },
			});
		} else (data[field] as unknown[]).push(raw);
		const expected = choiceContentSignature(data, false);
		if (field === "option" && data.response.type === "choice")
			Object.assign(data.response.options[1], { _inline: { label: html("other") } });
		else raw.data.content = html("other");
		expect(choiceContentSignature(data, false)).toBe(expected);
	},
);

it.each(["stem", "description", "option"] as const)(
	"hashes mixed absent/fallback raw SVGs in %s",
	(field: IconField) => {
		const data = preparedIconQuestion("display", field, "Pick @icon{mail}", catalogA);
		const raw =
			'<p>` <svg data-praxity-inline-icon="mail"></svg> ` <span data-praxity-inline-icon="mail" data-praxity-inline-icon-nodes="bad"></span></p>';
		if (field === "option") {
			if (data.response.type !== "choice") throw new Error("Expected choice");
			Object.assign(data.response.options[1], { label: "Raw", _inline: { label: raw } });
		} else (data[field] as unknown[]).push({ id: "raw", type: "text", data: { content: raw } });
		expect(choiceContentSignature(data, false)).toMatch(hash);
	},
);
