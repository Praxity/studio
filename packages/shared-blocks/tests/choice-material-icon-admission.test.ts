import {
	type InlineIconCatalogs,
	inlineIconPlaceholder,
} from "@praxity/content-model/inline-icons";
import { expect, it } from "vitest";
import { choiceContentSignature } from "../src/assessment-choice";
import { prepareAssessmentContent, prepareAssessmentOptionHtml } from "../src/assessment-content";
import { producers, question } from "./fixtures/choice-material";
import { preparedIconQuestion } from "./fixtures/choice-material-icons";

const catalogs: InlineIconCatalogs = {
	outline: { mail: [["path", { d: "M1 1L2 2" }]] },
	filled: {},
};
const placeholder = inlineIconPlaceholder("mail", catalogs.outline.mail);
if (!placeholder) throw new Error("Expected icon fixture");
const shapes = [
	["placeholder", `<p>${placeholder}</p>`],
	[
		"resolved SVG",
		prepareAssessmentOptionHtml({ label: "Cached", _inline: { label: placeholder } }),
	],
	["repaired table", `<table>${placeholder}</table>`],
	["table cell", `<table><tr><td>${placeholder}</td></tr></table>`],
	["single-quoted attribute", `<p><b title='${placeholder}'>T</b></p>`],
	["textarea", `<textarea>${placeholder}</textarea>`],
	["escaped text", placeholder.replaceAll("<", "&lt;").replaceAll(">", "&gt;")],
	["unquoted name", "<span data-praxity-inline-icon=mail></span>"],
	[
		"uppercase marker text",
		"<p title='&lt;span DATA-PRAXITY-INLINE-ICON=\"mail\"&gt;&lt;/span&gt;'>T</p>",
	],
	["fallback text", "<p>@icon{mail}</p>"],
	["fallback in attribute", '<p title="@icon{mail}">T</p>'],
] as const;

for (const producer of producers) {
	for (const field of ["stem", "description", "option"] as const) {
		it.each(["Pick @icon{mail}", "Pick ` then @icon{mail}", "Pick ==@icon{mail}==", "@icon{mail}"])(
			`${producer.name} ${field} hashes learner icons in %s`,
			(source) => {
				for (const catalog of [catalogs, { outline: {}, filled: {} }]) {
					const data = preparedIconQuestion(producer.name, field, source, catalog);
					const before = structuredClone(data);
					// Compiler icon names now hash; raw HTML follows ordinary material rules.
					expect(choiceContentSignature(data, false)).toMatch(/^sha256:[0-9a-f]{64}$/);
					expect(data).toEqual(before);
				}
			},
		);
		it.each(shapes)(`${producer.name} ${field} hashes raw learner %s`, (_name, html) => {
			const data = preparedIconQuestion(producer.name, field, "Pick", catalogs);
			if (field === "option") {
				if (data.response.type !== "choice") throw new Error("Expected choice");
				data.response.options[1] = { id: "b", label: "Cached", _inline: { label: html } } as never;
			} else (data[field] as unknown[]).push({ id: "raw", type: "text", data: { content: html } });
			// Compiler icon names now hash; raw HTML follows ordinary material rules.
			expect(choiceContentSignature(data, false)).toMatch(/^sha256:[0-9a-f]{64}$/);
		});
		it(`${producer.name} ${field} trusts learner display over an obsolete icon tree`, () => {
			const data = preparedIconQuestion(producer.name, field, "@icon{mail}", catalogs);
			if (field === "option") {
				if (data.response.type !== "choice") throw new Error("Expected choice");
				Object.assign(data.response.options[0], { label: "Plain", _inline: { label: "Plain" } });
			} else (data[field] as { data: { content: string } }[])[0].data.content = "<p>Plain</p>";
			// Compiler icon names now hash; raw HTML follows ordinary material rules.
			expect(choiceContentSignature(data, false)).toMatch(/^sha256:[0-9a-f]{64}$/);
		});
	}
}

it.each(["label", "text", "content"] as const)("hashes raw option %s icon fallback", (field) => {
	const data = question();
	if (data.response.type !== "choice") throw new Error("Expected choice");
	data.response.options[0] = {
		id: "a",
		...(field === "content"
			? { content: [{ type: "text", text: "@icon{mail}" }] }
			: { [field]: "@icon{mail}" }),
	} as never;
	// Compiler icon names now hash; raw HTML follows ordinary material rules.
	expect(choiceContentSignature(data, false)).toMatch(/^sha256:[0-9a-f]{64}$/);
});

it("does not refuse an icon removed by the actual learner sanitizer", () => {
	const data = question();
	data.stem = [
		{
			id: "s",
			type: "text",
			data: { content: '<p>Pick</p><svg data-praxity-inline-icon="bad_name"></svg>' },
		},
	] as never;
	expect(prepareAssessmentContent(data, "").stemContent).toEqual({ heading: "Pick", body: "" });
	// Compiler icon names now hash; raw HTML follows ordinary material rules.
	expect(choiceContentSignature(data, false)).toMatch(/^sha256:[0-9a-f]{64}$/);
});

it("ignores icon metadata and feedback outside the learner material fields", () => {
	const data = question();
	Object.assign(data, {
		_inlineTrees: { display: placeholder },
		feedback: { correct: placeholder },
	});
	// Compiler icon names now hash; raw HTML follows ordinary material rules.
	expect(choiceContentSignature(data, false)).toMatch(/^sha256:[0-9a-f]{64}$/);
});
