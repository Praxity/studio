// @vitest-environment jsdom
import { getHighlightStrings } from "@praxity/shared-blocks/i18n/highlight-strings";
import type { HighlightContent } from "@praxity/shared-blocks/types";
import { expect, it } from "vitest";
import { renderHighlight } from "../patterns/highlight/render";
import frenchSpacingFixtures from "./fixtures/highlight-french-spacing.json";

const content: HighlightContent = {
	mode: "key",
	title: "A useful pause",
	question: "What matters?",
	paragraphs: [
		[
			{ id: "context", text: "You need a moment to think.", note: "This explains the pause." },
			{ id: "return", text: "They know when to expect you.", key: true, note: "A target note." },
		],
		[
			{ id: "blue", text: "The wall is blue." },
			{ id: "time", text: "Agree on a time.", key: true },
		],
	],
};
const render = (value = content, lang = "en", level = 2, prefix = "practice") =>
	new DOMParser().parseFromString(
		renderHighlight(value, { prefix, lang, headingLevel: level }),
		"text/html",
	);

it.each([
	{
		mode: "key" as const,
		lang: "en",
		instruction: "Highlight the key ideas.",
		heading: "A useful pause",
	},
	{
		mode: "evidence" as const,
		lang: "en",
		instruction: "Highlight the text that answers this question. What matters?",
		heading: "A useful pause",
	},
	{
		mode: "key" as const,
		lang: "fr",
		instruction: "Surlignez les idées clés.",
		heading: "Une pause utile",
	},
	{
		mode: "evidence" as const,
		lang: "fr-CA",
		instruction: "Surlignez le texte qui répond à cette question. What matters?",
		heading: "Une pause utile",
	},
])(
	"renders $mode in $lang with an explicit language and one question",
	({ mode, lang, instruction, heading }) => {
		const doc = render({ ...content, mode, title: heading }, lang, 4);
		expect(doc.querySelector("[data-highlight]")?.getAttribute("lang")).toBe(lang);
		expect(doc.querySelector("h4")?.textContent).toBe(heading);
		expect(doc.body.textContent).not.toContain(getHighlightStrings(lang).highlightMemoryNotice);
		expect(doc.querySelector("[data-highlight]")?.textContent?.split("What matters?")).toHaveLength(
			2,
		);
		expect([...doc.querySelectorAll("[data-highlight] > p")].map((p) => p.textContent)).toContain(
			instruction,
		);
		expect(doc.querySelector("[data-highlight-passage]")?.getAttribute("aria-labelledby")).toBe(
			"practice-title",
		);
		expect(doc.querySelector("[data-highlight-count]")?.textContent).toBe(
			lang.startsWith("fr")
				? `Passages marqués\u00a0: 0 sur ${mode === "key" ? 3 : 2}`
				: `0 of ${mode === "key" ? 3 : 2} marked`,
		);
	},
);

it.each([1, 2, 3, 4, 5, 6])("uses resolved heading level %s", (level) => {
	expect(
		render(content, "en", level).querySelector("[data-highlight] > :first-child")?.tagName,
	).toBe(`H${level}`);
});
it.each([
	{ level: 0, expected: 1 },
	{ level: 9, expected: 6 },
	{ level: Number.NaN, expected: 2 },
])("normalizes heading $level", ({ level, expected }) => {
	expect(
		render(content, "en", level).querySelector("[data-highlight] > :first-child")?.tagName,
	).toBe(`H${expected}`);
});
it("omits an absent key question and respects an explicit upstream mark limit", () => {
	const { question: _question, ...withoutQuestion } = content;
	const doc = render({ ...withoutQuestion, maxMarks: 1 });
	expect(doc.querySelector("[data-highlight]")?.textContent).not.toContain("What matters?");
	expect(doc.querySelector("[data-highlight-count]")?.textContent).toBe("0 of 1 marked");
});
it("keeps the complete ordered baseline readable, controls hidden and status silent", () => {
	const doc = render();
	expect(
		[...doc.querySelectorAll("[data-highlight-passage] > p")].map((p) => p.textContent),
	).toEqual([
		"You need a moment to think. They know when to expect you.",
		"The wall is blue. Agree on a time.",
	]);
	expect(
		doc.querySelector("[data-highlight-passage] [hidden]")?.matches("[data-highlight-feedback]"),
	).toBe(true);
	expect(
		doc.querySelectorAll(
			"[data-highlight-chunk][hidden], [data-highlight-chunk][role], [data-highlight-chunk][tabindex]",
		),
	).toHaveLength(0);
	for (const span of doc.querySelectorAll("[data-highlight-chunk]")) {
		expect(span.nextElementSibling?.matches("[data-highlight-feedback][hidden]:empty")).toBe(true);
	}
	expect(doc.querySelector("details")?.hasAttribute("open")).toBe(false);
	expect(doc.querySelector("details")?.hasAttribute("hidden")).toBe(false);
	expect(doc.querySelectorAll("details li")).toHaveLength(3);
	expect(doc.querySelector("[data-highlight-flow]")?.hasAttribute("hidden")).toBe(true);
	expect(doc.querySelectorAll("button[data-praxity-js-control]")).toHaveLength(2);
	for (const button of doc.querySelectorAll("button"))
		expect(button.closest("[hidden]")).not.toBeNull();
	expect(doc.querySelector("[data-highlight-restart]")?.getAttribute("data-variant")).toBe(
		"outline",
	);
	expect(doc.querySelectorAll("[role=status]")).toHaveLength(1);
	const status = doc.querySelector("[role=status]")!;
	expect(status.textContent).toBe("");
	expect(status.getAttribute("aria-live")).toBe("polite");
	expect(status.getAttribute("aria-atomic")).toBe("true");
	expect(status.getAttribute("data-highlight-unavailable")).toBe(
		"Marking is unavailable. Read the passage and open Answer.",
	);
	expect(doc.body.textContent).not.toContain("Your marks reset");
	expect(doc.querySelector("[data-highlight-memory-notice]")).toBeNull();
	expect(doc.querySelector("[data-highlight-print-answer]")?.hasAttribute("hidden")).toBe(true);
	expect(
		[...doc.querySelector("[data-highlight]")!.children].map((n) =>
			n.hasAttribute("data-highlight-flow")
				? "flow"
				: n.hasAttribute("data-highlight-fallback")
					? "answer"
					: n.tagName,
		),
	).toContain("flow");
	expect(doc.querySelector("[data-highlight-flow]")?.nextElementSibling?.matches("details")).toBe(
		true,
	);
	expect(
		[...doc.querySelector("[data-highlight-flow]")!.children].map((n) =>
			n.getAttributeNames().find((name) => name.startsWith("data-highlight-")),
		),
	).toEqual([
		"data-highlight-count",
		"data-highlight-limit",
		"data-highlight-summary",
		"data-highlight-controls",
	]);
});
it.each(["en", "fr"])(
	"uses separated labels and the same complete list for screen and print in %s",
	(lang) => {
		const doc = render(content, lang);
		const paragraphs = [...doc.querySelectorAll("details li > p:first-child")].map(
			(p) => p.textContent,
		);
		expect(paragraphs).toEqual(
			lang === "en"
				? [
						"Not a key idea: You need a moment to think.",
						"Key idea: They know when to expect you.",
						"Key idea: Agree on a time.",
					]
				: [
						"Ce n'est pas une idée clé\u202f: You need a moment to think.",
						"Idée clé\u202f: They know when to expect you.",
						"Idée clé\u202f: Agree on a time.",
					],
		);
		expect(doc.querySelector("details ul")?.innerHTML).toBe(
			doc.querySelector("[data-highlight-print-answer] ul")?.innerHTML,
		);
		expect(
			[...doc.querySelectorAll("details li .praxity-assessment-choice-hint")].map(
				(p) => p.textContent,
			),
		).toEqual(["This explains the pause.", "A target note."]);
	},
);
it.each(["en", "fr"])("uses evidence labels for target and noted distractor in %s", (lang) => {
	const doc = render({ ...content, mode: "evidence" }, lang);
	expect([...doc.querySelectorAll("details strong")].map((p) => p.textContent)).toEqual(
		lang === "en"
			? ["This doesn't answer the question: ", "Answers the question: ", "Answers the question: "]
			: [
					"Ce passage ne répond pas à la question\u202f: ",
					"Répond à la question\u202f: ",
					"Répond à la question\u202f: ",
				],
	);
});
it.each(["en", "fr-CA"])(
	"round-trips entities, quotes, punctuation and hostile authored text in %s",
	(lang) => {
		const text = `&amp; &lt; " ' <img src=x onerror="bad()"> {{name}} [term]{meaning} @icon{star} ? ! : ; « »`;
		const value = {
			...content,
			title: text,
			question: text,
			paragraphs: [[{ id: "literal", text, key: true, note: text }]],
		};
		const doc = render(value, lang, 3, '" onfocus="bad()');
		expect(doc.querySelector("[data-highlight-chunk]")?.textContent).toBe(text);
		expect(doc.querySelector("h3")?.textContent).toBe(text);
		expect(doc.querySelector("details li > p + p")?.textContent).toBe(text);
		expect(doc.querySelector("img, script, svg, a, [onerror], [onfocus]")).toBeNull();
		expect(doc.querySelector("[data-highlight-passage]")?.getAttribute("aria-labelledby")).toBe(
			'" onfocus="bad()-title',
		);
	},
);
it("preserves French exactly as authored and escapes the language attribute", () => {
	const text = `Il dit : « Je reviens à midi ! » Pourquoi ? L'incertitude; oui:non!`;
	const doc = render(
		{ ...content, paragraphs: [[{ id: "fr", text, key: true, note: text }]] },
		'fr" onfocus="bad()',
	);
	expect(doc.querySelector("[data-highlight-chunk]")?.textContent).toBe(text);
	expect(doc.querySelector("details li > p + p")?.textContent).toBe(text);
	expect(doc.querySelector("[onfocus]")).toBeNull();
});
it.each([
	{ ...content, paragraphs: [[{ id: 'bad" id', text: "Literal", key: true }]] },
	{
		...content,
		paragraphs: [
			[
				{ id: "dup", text: "One", key: true },
				{ id: "dup", text: "Two" },
			],
		],
	},
	{ ...content, mode: "evidence" as const, question: undefined },
	{ ...content, maxMarks: 0 },
])("refuses tampered content %# through upstream validation", (value) => {
	expect(() => render(value)).toThrow();
});
it("keeps language, heading level and instance IDs through the direct renderer", () => {
	const options = { lang: "fr", headingLevel: 5 };
	const doc = new DOMParser().parseFromString(
		renderHighlight(content, { ...options, prefix: "first" }) +
			renderHighlight(content, { ...options, prefix: "second" }),
		"text/html",
	);
	expect(doc.querySelector("[data-highlight]")?.getAttribute("lang")).toBe("fr");
	expect(doc.querySelectorAll("h5")).toHaveLength(2);
	const ids = [...doc.querySelectorAll("[id]")].map((n) => n.id);
	expect(new Set(ids).size).toBe(ids.length);
});
it("owns the approved bilingual enhancer-only copy", () => {
	expect(getHighlightStrings("en").highlightMemoryNotice).toBe(
		"Your marks reset when this page reloads.",
	);
	expect(getHighlightStrings("fr-CA").highlightMemoryNotice).toBe(
		"Vos marques sont effacées au rechargement de cette page.",
	);
	expect(getHighlightStrings("fr").highlightControls).toBe(
		"Sélectionnez un passage pour le marquer ou enlever sa marque. Les flèches, Début et Fin permettent de changer de passage.",
	);
	expect(
		render(content, "fr")
			.querySelector("[data-highlight-status]")
			?.getAttribute("data-highlight-unavailable"),
	).toBe("Le surlignage n'est pas disponible. Lisez le texte et ouvrez Réponse.");
});

it.each(["en", "fr"])(
	"interpolates replacement-like question text literally once in %s",
	(lang) => {
		const question = "$& $$ $` $' {question} ? ! : ;";
		const doc = render({ ...content, mode: "evidence", question }, lang);
		expect(doc.querySelector("[data-highlight] > p")?.textContent).toBe(
			lang === "en"
				? "Highlight the text that answers this question. $& $$ $` $' {question} ? ! : ;"
				: "Surlignez le texte qui répond à cette question. $& $$ $` $' {question} ? ! : ;",
		);
	},
);

it.each(["en", "fr"])(
	"keeps the evidence question literal in its body-text element in %s",
	(lang) => {
		const question = `$& $$ $\` $' {question} </span><img src=x onerror="bad()"> &amp; &lt; " ' ? ! : ;`;
		const doc = render({ ...content, mode: "evidence", question }, lang);
		const prompt = doc.querySelector(".praxity-highlight-question");
		expect(doc.querySelectorAll(".praxity-highlight-question")).toHaveLength(1);
		expect(prompt?.textContent).toBe(question);
		expect(prompt?.parentElement?.className).toBe("praxity-assessment-choice-hint");
		expect(prompt?.parentElement?.textContent).toBe(
			(lang === "en"
				? "Highlight the text that answers this question. "
				: "Surlignez le texte qui répond à cette question. ") + question,
		);
		expect(doc.querySelector("img, [onerror]")).toBeNull();
	},
);

it.each(frenchSpacingFixtures)(
	"preserves authored NBSP, NNBSP and ordinary spaces through rendering in $locale",
	({ locale, content: fixture }) => {
		const doc = render(fixture as HighlightContent, locale);
		const expected = "Pourquoi\u202f? «\u00a0midi\u00a0»\u00a0! oui : non";
		for (const selector of [
			"h2",
			".praxity-highlight-question",
			"[data-highlight-chunk]",
			"details li > p + p",
			"[data-highlight-print-answer] li > p + p",
		]) {
			const text = doc.querySelector(selector)?.textContent;
			expect(text).toBe(expected);
			expect(text?.slice(-9)).toBe("oui : non");
		}
	},
);
