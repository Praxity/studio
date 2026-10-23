import { resolveLocale } from "./locale";

export const selfCheckCompletionStrings = {
	en: {
		selfCheckIncomplete:
			"Write an answer, check its parts, then show feedback to complete this activity.",
	},
	fr: {
		selfCheckIncomplete:
			"Écrivez une réponse, vérifiez ses éléments, puis affichez la rétroaction pour terminer cette activité.",
	},
} as const;
export function getSelfCheckCompletionStrings(locale: string) {
	return selfCheckCompletionStrings[resolveLocale(locale)];
}
