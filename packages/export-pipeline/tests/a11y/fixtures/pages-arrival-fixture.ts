import type { CourseExportInput } from "../../../src/build";

/** Three free-moving slide-style Pages documents plus glossary and resources pages. */
export function buildPagesArrivalCourse(locale: "en" | "fr"): CourseExportInput {
	const french = locale === "fr";
	const titles = french
		? ["Bienvenue", "Ajouter une image", "Étapes suivantes"]
		: ["Welcome", "Add an image", "Next steps"];
	return {
		id: `pages-arrival-${locale}`,
		title: french ? "Arrivée sur une page" : "Page arrival",
		sourceLocale: locale,
		navigationStyle: "slides",
		content: titles.map((title, index) => ({
			id: `arrival-page-${index}`,
			title,
			blocks: [
				{ id: `heading-${index}`, type: "heading" as const, data: { content: title, level: 1 } },
				{
					id: `text-${index}`,
					type: "text" as const,
					data: { content: `<p>${french ? "Lisez" : "Read"} ${title}.</p>` },
				},
				...(index === 0
					? [
							{
								id: "glossary-text",
								type: "text" as const,
								data: {
									content: `[SCORM]{${french ? "Norme de suivi." : "A tracking standard."}}`,
								},
							},
						]
					: []),
			],
		})),
		resourceEntries: [
			{
				title: french ? "Guide" : "Guide",
				description: french ? "Guide de référence." : "Reference guide.",
				url: "https://example.com/guide",
				resourceType: "link",
			},
		],
	};
}
