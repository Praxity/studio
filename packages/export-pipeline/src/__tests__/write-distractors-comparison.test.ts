import {
	getDistractorPresentationStrings,
	getPracticeHostStrings,
} from "@praxity/shared-blocks/i18n/practice-host-strings";
import { createWriteDistractorsRules } from "@praxity/shared-blocks/write-distractors-content";
import { createDistractorMount } from "@praxity/shared-blocks/write-distractors-state";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { renderDistractorComparison } from "../patterns/write-distractors/comparison";
import { projectDistractorRecovery } from "../patterns/write-distractors/recovery";
import { installDistractorReveal } from "../patterns/write-distractors/reveal";

const rules = createWriteDistractorsRules({
	question: "Question <script>",
	rightAnswer: "Answer & text",
	count: 2,
	misconceptions: [
		{ id: "a", label: "Same idea" },
		{ id: "b", label: "Other idea" },
	],
	authorOptions: [
		{ text: "Author <img>", misconception: "a" },
		{ text: "Author two", misconception: "b" },
	],
});
const options = [
	{ text: "Learner <script>", misconception: "other", custom: " same IDEA " },
	{ text: "Learner two", misconception: "other", custom: "Own & idea $& $' $` $$" },
];
describe("distractor comparison presentation", () => {
	for (const lang of ["en", "fr"] as const)
		it(`${lang}: stacks literal previews, label overlap and the no-grade note`, () => {
			const result = renderDistractorComparison(
				rules.comparison(options),
				lang,
				getDistractorPresentationStrings(lang),
			);
			const doc = new JSDOM(result.html).window.document;
			expect(doc.querySelectorAll("script, img, table")).toHaveLength(0);
			expect(doc.querySelector('[data-distractor-preview="learner"]')?.textContent).toContain(
				"Learner <script>",
			);
			expect(doc.querySelector('[data-distractor-preview="author"]')?.textContent).toContain(
				"Author <img>",
			);
			expect(
				doc
					.querySelector('[data-distractor-preview="learner"]')
					?.nextElementSibling?.getAttribute("data-distractor-preview"),
			).toBe("author");
			expect(doc.querySelectorAll("[data-distractor-match]")).toHaveLength(1);
			expect(doc.body.textContent).toContain("Own & idea $& $' $` $$");
			expect(doc.body.textContent).toContain(
				lang === "en" ? "It is not a score." : "Ce n'est pas un score.",
			);
			expect(result.announcement).toBe(
				lang === "en"
					? "Your labels match 1 of the author's 2 mistaken ideas. You added 1 of your own."
					: "Idées fausses en commun avec l'auteur : 1 sur 2. Autres idées fausses : 1.",
			);
			expect(result.announcement).not.toContain("Learner");
		});
	it.each(["en", "fr", "fr-CA"])(
		"%s: localizes answer and option separators in both previews",
		(lang) => {
			const { html } = renderDistractorComparison(
				rules.comparison(options),
				lang,
				getDistractorPresentationStrings(lang),
			);
			const doc = new JSDOM(html).window.document;
			const answer =
				lang === "en" ? "Correct answer: Answer & text" : "Bonne réponse\u202f: Answer & text";
			expect(
				[...doc.querySelectorAll("[data-distractor-preview] > p:nth-child(3)")].map(
					(node) => node.textContent,
				),
			).toEqual([answer, answer]);
			expect(doc.querySelector('[data-distractor-preview="learner"] li > p')?.textContent).toBe(
				lang === "en"
					? "Wrong option B: Learner <script>"
					: "Mauvaise réponse B\u202f: Learner <script>",
			);
			expect(doc.querySelector('[data-distractor-preview="author"] li > p')?.textContent).toBe(
				lang === "en" ? "Wrong option B: Author <img>" : "Mauvaise réponse B\u202f: Author <img>",
			);
		},
	);
	it("uses singular coverage for one author label and counts unique labels", () => {
		const one = createWriteDistractorsRules({
			question: "Q",
			rightAnswer: "A",
			count: 2,
			misconceptions: [{ id: "a", label: "Same idea" }],
			authorOptions: [{ text: "Wrong", misconception: "a" }],
		});
		expect(
			renderDistractorComparison(
				one.comparison([options[0], { ...options[1], custom: "Same idea" }]),
				"en",
				getDistractorPresentationStrings("en"),
			).announcement,
		).toBe("Your labels match 1 of the author's 1 mistaken idea. You added 0 of your own.");
	});
});
describe("distractor recovery presentation", () => {
	for (const lang of ["en", "fr"] as const)
		it(`${lang}: copies only extracted paths, retaining full text and focused fields`, () => {
			const doc = new JSDOM('<div id="recovery"></div>').window.document;
			const root = doc.getElementById("recovery") as HTMLElement;
			const fields = [
				{ path: "value.answer", text: `<script>${"x".repeat(2100)}` },
				{ path: "value.options[4].custom", text: "Old idea" },
				{ path: "value.options[8].text", text: "Never display" },
				{ path: "value.options[1].custom", text: "" },
			];
			projectDistractorRecovery(root, fields, getPracticeHostStrings(lang), lang, "recovered");
			const inputs = root.querySelectorAll("textarea");
			expect(inputs).toHaveLength(2);
			expect(inputs[0].value).toBe(fields[0].text);
			expect(inputs[0].readOnly).toBe(true);
			expect(inputs[0].disabled).toBe(false);
			expect(root.querySelector("script, [maxlength]")).toBeNull();
			expect(root.textContent).toContain(
				lang === "en" ? "Previous mistaken idea 5" : "Idée fausse précédente 5",
			);
			inputs[1].focus();
			projectDistractorRecovery(root, fields, getPracticeHostStrings(lang), lang, "recovered");
			expect(doc.activeElement).toBe(inputs[1]);
			projectDistractorRecovery(root, [], getPracticeHostStrings(lang), lang, "recovered");
			expect(root.childElementCount).toBe(0);
		});
});

for (const error of ["content-unavailable", "invalid-draft"] as const)
	it(`Compare announces unavailable for ${error}`, async () => {
		const doc = new JSDOM(
			'<div data-distractor-id="wd" data-distractor-count="2" lang="en"><textarea data-distractor-answer id="answer"></textarea><button id="reset"></button></div>',
		).window.document;
		const root = doc.body.firstElementChild as HTMLElement;
		root.dataset.distractorStrings = JSON.stringify(getDistractorPresentationStrings("en"));
		const spoken: string[] = [];
		const reset = doc.getElementById("reset");
		if (!reset) throw new Error("Missing reset");
		const reveal = installDistractorReveal(
			root,
			reset,
			async () => {},
			(node, type, action) => {
				node.addEventListener(type, action);
				return () => node.removeEventListener(type, action);
			},
			(text) => spoken.push(text),
			() => () => true,
		);
		const mount = createDistractorMount({
			contentRevision: `sha256:${"0".repeat(64)}`,
			count: 2,
			itemIds: ["a", "b"],
		});
		mount.value.hadIt = true;
		mount.error = error;
		reveal.project(
			{ blockId: "wd", mount, loading: false, cancelled: false, notice: null, announcement: null },
			rules.firstHalf(),
		);
		const compare = root.querySelector<HTMLButtonElement>('[data-distractor-action="compare"]');
		if (!compare) throw new Error("Missing Compare");
		compare.click();
		await Promise.resolve();
		expect(spoken).toEqual([
			"Comparison is unavailable. You can still write and copy your answer.",
		]);
		reveal.destroy();
	});
