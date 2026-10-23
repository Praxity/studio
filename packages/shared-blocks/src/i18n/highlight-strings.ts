import { resolveLocale } from "./locale";

const highlightStrings = {
	en: {
		highlightControls:
			"Select a passage to mark or unmark it. Arrow keys, Home and End move between passages.",
		highlightMemoryNotice: "Your marks reset when this page reloads.",
		highlightUnavailable: "Marking is unavailable. Read the passage and open Answer.",
	},
	fr: {
		highlightControls:
			"Sélectionnez un passage pour le marquer ou enlever sa marque. Les flèches, Début et Fin permettent de changer de passage.",
		highlightMemoryNotice: "Vos marques sont effacées au rechargement de cette page.",
		highlightUnavailable: "Le surlignage n'est pas disponible. Lisez le texte et ouvrez Réponse.",
	},
} as const;

export function getHighlightStrings(locale: string) {
	return highlightStrings[resolveLocale(locale)];
}
