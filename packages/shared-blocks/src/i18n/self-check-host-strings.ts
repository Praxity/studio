import { resolveLocale } from "./locale";

export const selfCheckHostStrings = {
	en: {
		selfCheckDeviceNotice:
			"Your answer is saved in this browser on this device. It is not sent to the LMS.",
		selfCheckLmsNotice:
			"Your answer is reported to the LMS. Drafts and comparison state may also be saved there.",
		selfCheckNotSavedDevice:
			"Your answer is not saved on this device. Keep a copy before leaving this page.",
		selfCheckNotSavedLms:
			"Your answer is not saved to the LMS. Keep a copy before leaving this page.",
	},
	fr: {
		selfCheckDeviceNotice:
			"Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.",
		selfCheckLmsNotice:
			"Votre réponse est transmise au LMS. Les brouillons et l'état de la comparaison peuvent aussi y être enregistrés.",
		selfCheckNotSavedDevice:
			"Votre réponse n'est pas enregistrée sur cet appareil. Gardez-en une copie avant de quitter cette page.",
		selfCheckNotSavedLms:
			"Votre réponse n'est pas enregistrée dans le LMS. Gardez-en une copie avant de quitter cette page.",
	},
} as const;

export function getSelfCheckHostStrings(locale: string) {
	return selfCheckHostStrings[resolveLocale(locale)];
}

export const selfCheckActivationStrings = {
	en: {
		selfCheckChanged:
			"The activity changed since your last comparison. Your draft answer is kept in the answer field.",
		selfCheckInvalidState:
			"Your previous comparison could not be restored. Check your draft answer again.",
		selfCheckDeviceMode:
			"Your answer stays in this browser on this device. It is not sent to the LMS.",
		selfCheckSavedDevice: "Your answer and comparison are saved in this browser on this device.",
		selfCheckUnavailable: "Comparison is unavailable. You can still write and copy your answer.",
		selfCheckRefreshing: "The activity is updating. Comparison will be available after the update.",
		selfCheckRestoring: "Restoring your progress. You can still write and copy your answer.",
		selfCheckRetry: "Retry",
		selfCheckStartOver: "Start over",
		selfCheckReturn: "Return to activity",
		selfCheckContact: "If this keeps happening, tell whoever runs this course.",
	},
	fr: {
		selfCheckChanged:
			"L'activité a changé depuis votre dernière comparaison. Votre brouillon est conservé dans le champ de réponse.",
		selfCheckInvalidState:
			"Votre comparaison précédente n'a pas pu être restaurée. Vérifiez de nouveau votre brouillon.",
		selfCheckDeviceMode:
			"Votre réponse reste dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.",
		selfCheckSavedDevice:
			"Votre réponse et la comparaison sont enregistrées dans ce navigateur sur cet appareil.",
		selfCheckUnavailable:
			"La comparaison n'est pas disponible. Vous pouvez encore écrire et copier votre réponse.",
		selfCheckRefreshing:
			"L'activité est en cours de mise à jour. La comparaison sera disponible après la mise à jour.",
		selfCheckRestoring:
			"Restauration de votre progression. Vous pouvez encore écrire et copier votre réponse.",
		selfCheckRetry: "Réessayer",
		selfCheckStartOver: "Recommencer",
		selfCheckReturn: "Revenir à l’activité",
		selfCheckContact: "Si le problème persiste, prévenez la personne responsable de ce cours.",
	},
} as const;

export function getSelfCheckActivationStrings(locale: string) {
	return selfCheckActivationStrings[resolveLocale(locale)];
}
