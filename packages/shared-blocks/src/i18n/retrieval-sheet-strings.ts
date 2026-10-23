import { resolveLocale } from "./locale";

const retrievalSheetStrings = {
	en: {
		retrievalMemoryNotice:
			"Your date and sheet side reset when this page reloads. Choosing a date sends no reminder.",
		retrievalUnavailable:
			"Date and side controls are unavailable. Both sides remain readable and printable.",
		retrievalPrintUnavailable:
			"The print dialog could not be opened. Use your browser's Print command.",
		retrievalNoDate:
			"Choose a date when the controls are available, or write one on your printed sheet.",
	},
	fr: {
		retrievalMemoryNotice:
			"La date et le côté de la feuille sont réinitialisés au rechargement de cette page. Choisir une date n'envoie aucun rappel.",
		retrievalUnavailable:
			"Les commandes de date et de côté ne sont pas disponibles. Les deux côtés restent lisibles et imprimables.",
		retrievalPrintUnavailable:
			"La boîte de dialogue d'impression n'a pas pu s'ouvrir. Utilisez la commande Imprimer du navigateur.",
		retrievalNoDate:
			"Choisissez une date lorsque les commandes sont disponibles, ou inscrivez-en une sur la feuille imprimée.",
	},
} as const;

export function getRetrievalSheetStrings(locale: string) {
	return retrievalSheetStrings[resolveLocale(locale)];
}
