import { readFileSync } from "node:fs";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import { selfCheckContentInput } from "../../src/build";

// Literal release expectations, independent of renderer and library output.
export const releaseExpected = {
	en: {
		task: "Explain why the report needs another day.",
		answer: "The data was late. May I send it Tuesday?",
		model: "The data arrived late. Could I send the report on Tuesday?",
		printedModel: "The data arrived late.[1] Could I send the report on Tuesday[2]?",
		labels: ["Reason for the delay", "New delivery date", "Respectful wording"],
		hints: [
			"Explain what caused the delay.",
			"Propose a specific delivery date.",
			"Make a clear request without blaming anyone.",
		],
		count: "0 of 3 selected",
		summary: "You included 0 of 3 parts.",
		toAdd: "To add",
		whole: "Whole answer",
	},
	fr: {
		task: "Expliquez pourquoi le rapport exige une journée de plus.",
		answer: "Les données sont en retard. Puis-je envoyer le rapport mardi?",
		model: "Les données sont arrivées en retard. Puis-je vous envoyer le rapport mardi?",
		printedModel:
			"Les données sont arrivées en retard.[1] Puis-je vous envoyer le rapport mardi[2]?",
		labels: ["Raison du retard", "Nouvelle date de livraison", "Formulation respectueuse"],
		hints: [
			"Expliquez ce qui a causé le retard.",
			"Proposez une date de livraison précise.",
			"Formulez une demande claire sans blâmer qui que ce soit.",
		],
		count: "0 sur 3 sélectionné",
		summary: "Éléments inclus : 0 sur 3.",
		toAdd: "À ajouter",
		whole: "Toute la réponse",
	},
} as const;

export function releaseSource(locale: "en" | "fr") {
	return readFileSync(new URL(`./self-check-release/${locale}.prax`, import.meta.url), "utf8");
}

export function releaseCourse(locale: "en" | "fr") {
	const read = readLesson(releaseSource(locale));
	return {
		read,
		input: {
			id: `self-check-release-${locale}`,
			title: read.frontmatter.title ?? "Self-check",
			sourceLocale: locale,
			content: read.pages,
			selfCheckContents: read.blocks
				.filter((block) => block.type === "selfCheck")
				.map((block) => selfCheckContentInput(block.id, readSelfCheckContent(read, block.id))),
		},
	};
}
