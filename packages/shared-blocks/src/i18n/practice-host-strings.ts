import { strings as distractorStrings } from "learning-patterns/patterns/write-distractors/strings.js";
import { resolveLocale } from "./locale";
import { getSelfCheckActivationStrings } from "./self-check-host-strings";

/** Private practice copy shares the host i18n owner; no successful-save states. */
export const practiceHostStrings = {
	en: {
		practiceDeviceMode: "Your answers stay in this browser and aren’t sent to the LMS.",
		practiceIdentifiedScope: "A new attempt starts fresh.",
		practiceSharedDeviceScope: "Anyone using this browser may see them.",
		practiceRestoring: "Restoring your progress.",
		practiceNotSaved: "Your latest work is not saved. Keep a copy before leaving this page.",
		distractorsNeedsScript:
			"Checking your answer needs JavaScript. What you type here isn't saved.",
		distractorsResetHint:
			"Start over clears your answer, options and comparison. Copy anything you want to keep first.",
		distractorsLoading: "Loading the comparison. Your answer is kept.",
		distractorsAnswerRevealed: "The right answer is shown. Decide whether your answer was right.",
		distractorsNoGrade:
			"This compares labels, not the meaning or quality of your answers. It is not a score.",
		distractorsInvalid:
			"Your previous work could not be restored. Any readable text is kept below for copying.",
		distractorsChanged:
			"This activity has changed. Your previous comparison is no longer current. Any readable text is kept below for copying.",
		distractorsRecoveryAnswer: "Previous answer — copy before starting over",
		distractorsRecoveryOption: "Previous option {n} — copy before starting over",
		distractorsRecoveryCustom: "Previous mistaken idea {n} — copy before starting over",
	},
	fr: {
		practiceDeviceMode: "Vos réponses restent dans ce navigateur et ne sont pas envoyées au LMS.",
		practiceIdentifiedScope: "Une nouvelle tentative repart de zéro.",
		practiceSharedDeviceScope: "Toute personne qui utilise ce navigateur peut les voir.",
		practiceRestoring: "Restauration de votre progression.",
		practiceNotSaved:
			"Votre travail le plus récent n'est pas enregistré. Gardez-en une copie avant de quitter cette page.",
		distractorsNeedsScript:
			"La vérification de votre réponse nécessite JavaScript. Ce que vous saisissez ici n'est pas enregistré.",
		distractorsResetHint:
			"Recommencer efface votre réponse, vos propositions et la comparaison. Copiez d'abord ce que vous voulez conserver.",
		distractorsLoading: "Chargement de la comparaison. Votre réponse est conservée.",
		distractorsAnswerRevealed:
			"La bonne réponse est affichée. Décidez si votre réponse était bonne.",
		distractorsNoGrade:
			"Cette comparaison porte sur les libellés, pas sur le sens ni la qualité de vos réponses. Ce n'est pas un score.",
		distractorsInvalid:
			"Votre travail précédent n'a pas pu être restauré. Tout texte lisible est conservé ci-dessous pour être copié.",
		distractorsChanged:
			"Cette activité a changé. Votre comparaison précédente n'est plus à jour. Tout texte lisible est conservé ci-dessous pour être copié.",
		distractorsRecoveryAnswer: "Réponse précédente — à copier avant de recommencer",
		distractorsRecoveryOption: "Réponse proposée précédente {n} — à copier avant de recommencer",
		distractorsRecoveryCustom: "Idée fausse précédente {n} — à copier avant de recommencer",
	},
} as const;

export function getPracticeHostStrings(locale: string) {
	return practiceHostStrings[resolveLocale(locale)];
}

/** Serialize localized UI alongside the baseline so the initial island needs no catalogs. */
export function getDistractorPresentationStrings(locale: string) {
	const upstream = distractorStrings[resolveLocale(locale)];
	return {
		...upstream,
		...getPracticeHostStrings(locale),
		...getSelfCheckActivationStrings(locale),
		revealLabel: distractorStrings[resolveLocale(locale)].rightAnswer,
	};
}
