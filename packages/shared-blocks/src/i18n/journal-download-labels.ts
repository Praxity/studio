export const journalDownloadLabels = {
	en: {
		downloadResponseAs: "Download response as",
		downloadTxt: "Download as text",
		downloadDocx: "Download as Word",
		copyResponse: "Copy response",
		copyResponseDone: "Copied the question and your answer.",
		copyResponseFailed: "Copying didn't work. Select the text in the answer box and copy it.",
		copyResponseEmpty: "Write an answer before copying.",
	},
	fr: {
		downloadResponseAs: "Télécharger la réponse au format",
		downloadTxt: "Télécharger en texte",
		downloadDocx: "Télécharger en Word",
		copyResponse: "Copier la réponse",
		copyResponseDone: "La question et votre réponse ont été copiées.",
		copyResponseFailed:
			"La copie n’a pas fonctionné. Sélectionnez le texte dans la zone de réponse et copiez-le.",
		copyResponseEmpty: "Rédigez une réponse avant de copier.",
	},
} as const;

export const journalDateLabels = {
	en: "Saved {date} at {time}",
	fr: "Enregistré le {date} à {time}",
} as const;
