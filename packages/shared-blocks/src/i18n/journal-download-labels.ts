// The journal island uses this small subset without loading every learner label.
export const journalDownloadLabels = {
	en: {
		downloadResponseAs: "Download response as",
		downloadTxt: "Download as text",
		downloadDocx: "Download as Word",
	},
	fr: {
		downloadResponseAs: "Télécharger la réponse au format",
		downloadTxt: "Télécharger en texte",
		downloadDocx: "Télécharger en Word",
	},
} as const;

export const journalDateLabels = {
	en: "Saved {date} at {time}",
	fr: "Enregistré le {date} à {time}",
} as const;
