import { resolveLocale } from "./locale";

export const selfCheckIslandStrings = {
	en: {
		selfCheckReportTruncated:
			"The LMS answer report was shortened. Your full answer is still shown here.",
		selfCheckSelected: "{count} of {total} selected",
		selfCheckSelectedOne: "{count} of {total} selected",
		selfCheckSummary: "You included {count} of {total} parts.",
		selfCheckSummaryOne: "You included {count} of {total} part.",
		selfCheckIncluded: "Included",
		selfCheckToAdd: "To add",
		selfCheckComparison: "Comparison",
		selfCheckPrevious: "Previous comparison",
	},
	fr: {
		selfCheckReportTruncated:
			"Le rapport de réponse au LMS a été raccourci. Votre réponse complète est toujours affichée ici.",
		selfCheckSelected: "{count} sur {total} sélectionnés",
		selfCheckSelectedOne: "{count} sur {total} sélectionné",
		selfCheckSummary: "Éléments inclus : {count} sur {total}.",
		selfCheckSummaryOne: "Éléments inclus : {count} sur {total}.",
		selfCheckIncluded: "Incluse",
		selfCheckToAdd: "À ajouter",
		selfCheckComparison: "Comparaison",
		selfCheckPrevious: "Comparaison précédente",
	},
} as const;

export function getSelfCheckIslandStrings(locale: string) {
	return selfCheckIslandStrings[resolveLocale(locale)];
}

export function formatSelfCheckCounts(locale: string, count: number, total: number) {
	const language = resolveLocale(locale);
	const ui = getSelfCheckIslandStrings(language);
	const numbers = new Intl.NumberFormat(language);
	const plurals = new Intl.PluralRules(language);
	const format = (text: string) =>
		text.replace("{count}", numbers.format(count)).replace("{total}", numbers.format(total));
	return {
		selected: format(
			plurals.select(count) === "one" ? ui.selfCheckSelectedOne : ui.selfCheckSelected,
		),
		summary: format(plurals.select(total) === "one" ? ui.selfCheckSummaryOne : ui.selfCheckSummary),
	};
}
