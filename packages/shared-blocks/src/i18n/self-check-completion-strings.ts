import { resolveLocale } from "./locale";

export const selfCheckCompletionStrings = {
	en: {
		selfCheckIncomplete:
			"Write an answer, review it against the checklist, then show the example and feedback to complete this activity.",
	},
	fr: {
		selfCheckIncomplete:
			"Écrivez une réponse, revoyez-la avec la liste de vérification, puis affichez l'exemple et la rétroaction pour terminer cette activité.",
	},
} as const;
export function getSelfCheckCompletionStrings(locale: string) {
	return selfCheckCompletionStrings[resolveLocale(locale)];
}
