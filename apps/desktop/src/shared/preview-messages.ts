export const previewMessages = {
	en: {
		exportAccessibilityBlocked:
			"Accessibility issues blocked export. Fix the reported issues, then try again.",
		sourceLocation: "{file}, line {line}, column {column}: {message}",
		sourceError: "Fix the source error in this lesson's .prax file to edit its text.",
		detachedFeedback:
			"Fix the feedback lines in this lesson's .prax file to edit its text. Put correct: and incorrect: before the answer choices, and feedback: directly under its choice, with no blank line.",
		lessonGone:
			"This lesson was deleted or renamed. Restore its file or update the course's lesson list, then reopen Studio.",
		identityReviewPending:
			"This course changed outside Studio, and some saved content was removed. Review the changes before you edit. Copy your text first if you want to keep it.",
	},
	fr: {
		exportAccessibilityBlocked:
			"Des problèmes d’accessibilité empêchent l’exportation. Corrigez les problèmes signalés, puis réessayez.",
		sourceLocation: "{file}, ligne {line}, colonne {column} : {message}",
		sourceError:
			"Corrigez l'erreur dans le fichier .prax de cette leçon pour en modifier le texte.",
		detachedFeedback:
			"Corrigez les lignes de rétroaction dans le fichier .prax de cette leçon pour en modifier le texte. Placez correct: et incorrect: avant les choix de réponse, et feedback: directement sous le choix concerné, sans ligne vide.",
		lessonGone:
			"Cette leçon a été supprimée ou renommée. Restaurez son fichier ou mettez à jour la liste des leçons du cours, puis rouvrez Studio.",
		identityReviewPending:
			"Ce cours a été modifié hors de Studio, et du contenu enregistré a été retiré. Examinez les modifications avant de modifier. Copiez d'abord votre texte si vous voulez le garder.",
	},
} as const;
