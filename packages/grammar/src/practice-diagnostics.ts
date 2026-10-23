/** Compiler/reader diagnostic copy. Kept outside learner bundles and content-free.
 * The editor's op.diagnostic entries use the same frozen EN/FR messages. */
const messages = {
	en: {
		"highlight-invalid":
			"The highlight library refuses this content. Check the passages, targets and explanations.",
		"write-distractors-unsupported-runtime": "Write distractors can’t be published yet.",
		"retrieval-sheet-invalid":
			"The retrieval-sheet library refuses this content. Check the title, questions and answers.",
		"private-choice-practice-only":
			"A private choice must be optional, unscored, outside assessment groups and without a gate.",
		"practice-no-tracking":
			"This practice activity cannot be read by course logic, write course state, supply a score or progression condition, or be required directly or through a container.",
		"highlight-native-pdf-unsupported":
			"Highlight is not supported in native PDF export. Use your browser's Print or Save as PDF.",
		"unsupported-runtime":
			"A private choice needs explicit single-answer selection and device-only storage.",
	},
	fr: {
		"highlight-invalid":
			"La bibliothèque de surlignage refuse ce contenu. Vérifiez les passages, les cibles et les explications.",
		"write-distractors-unsupported-runtime":
			"La rédaction de mauvaises réponses ne peut pas encore être publiée.",
		"retrieval-sheet-invalid":
			"La bibliothèque de fiches de rappel refuse ce contenu. Vérifiez le titre, les questions et les réponses.",
		"private-choice-practice-only":
			"Un choix privé doit être facultatif, sans score, hors des groupes d’évaluations et sans condition de progression.",
		"practice-no-tracking":
			"Cette activité de pratique ne peut être lue par la logique du cours, modifier l’état du cours, fournir un score ou une condition de progression, ni être obligatoire directement ou par l’intermédiaire d’un conteneur.",
		"highlight-native-pdf-unsupported":
			"Le surlignage n'est pas pris en charge dans l'export PDF natif. Utilisez Imprimer ou Enregistrer au format PDF dans votre navigateur.",
		"unsupported-runtime":
			"Un choix privé nécessite une sélection explicite à réponse unique et un stockage sur l’appareil uniquement.",
	},
} as const;

export type PracticeDiagnosticCode = Exclude<
	keyof typeof messages.en,
	"write-distractors-unsupported-runtime"
>;
export function practiceDiagnosticMessage(
	code: PracticeDiagnosticCode,
	locale = "en",
	blockType?: "write-distractors",
): string {
	const language = locale.toLowerCase().split(/[-_]/)[0] === "fr" ? "fr" : "en";
	const key: keyof typeof messages.en =
		code === "unsupported-runtime" && blockType === "write-distractors"
			? "write-distractors-unsupported-runtime"
			: code;
	return messages[language][key];
}

export function lessonRuntimeRefusalMessage(
	diagnostic: { blockType: string; line?: number; column: number },
	path: string,
	page: string,
	locale = "en",
): string {
	const language = locale.toLowerCase().split(/[-_]/)[0] === "fr" ? "fr" : "en";
	const reason =
		diagnostic.blockType === "write-distractors"
			? messages[language]["write-distractors-unsupported-runtime"]
			: messages[language]["unsupported-runtime"];
	const location = `${path}:${diagnostic.line}:${diagnostic.column}`;
	return language === "fr"
		? `${location}: page ${JSON.stringify(page)}, bloc ${diagnostic.blockType}: ${reason} Le moteur d’exécution ne prend pas en charge ce bloc.`
		: `${location}: page ${JSON.stringify(page)}, block ${diagnostic.blockType}: ${reason} Runtime support is not available.`;
}

/** Default-English field diagnostics for grammar/CLI. Runtime refusal copy lives
 * in the bilingual catalogue above; localized author UI uses op.diagnostic. */
const practiceFieldMessages = {
	"highlight-chunk-too-long": "Keep each passage to {max} Unicode code points or fewer.",
	"highlight-note-too-long": "Keep each explanation to {max} Unicode code points or fewer.",
	"highlight-chunk-whitespace": "Remove whitespace at the start and end of this passage.",
	"highlight-no-target": "Mark at least one passage with key=true.",
	"practice-right-answer-too-long": "Keep the right answer to {max} Unicode code points or fewer.",
	"practice-misconception-too-long":
		"Keep the mistaken idea label to {max} Unicode code points or fewer.",
	"practice-option-too-long": "Keep the wrong option to {max} Unicode code points or fewer.",
	"write-distractors-invalid":
		"The write-distractors library refuses this content. Check the question, answer and items.",
	"write-distractors-duplicate-label": "Give each mistaken idea a distinct label.",
	"write-distractors-author-right": "This wrong option matches the right answer. Review it.",
	"practice-title-too-long": "Keep the title to {max} Unicode code points or fewer.",
	"practice-question-too-long": "Keep the question to {max} Unicode code points or fewer.",
	"practice-answer-too-long": "Keep the answer to {max} Unicode code points or fewer.",
	"missing-subject": "The block needs a title or subject",
	"bad-subject": "The block’s subject is invalid",
	"unknown-setting": "Unknown setting",
	"bad-setting-value": "A setting has an invalid value",
	"duplicate-setting": "The setting is repeated",
	"missing-part": "Add the required {name}: part",
	"empty-part": "The {name}: part must contain text",
	"duplicate-part": "Write the {name}: part only once",
	"disallowed-child": "This content is not allowed in its parent",
	"child-count": "The block has the wrong number of items",
	"unclosed-block": "The block is not closed",
	"response-invariant": "The assessment’s answers are inconsistent",
} as const;

export function writeDistractorsDiagnosticMessage(
	code: string,
	args: Record<string, unknown>,
	locale = "en",
): string | undefined {
	if (code === "unsupported-runtime")
		return messages[locale.toLowerCase().split(/[-_]/)[0] === "fr" ? "fr" : "en"][
			"write-distractors-unsupported-runtime"
		];
	return practiceFieldDiagnosticMessage(code, args);
}

export function retrievalSheetDiagnosticMessage(
	code: string,
	args: Record<string, unknown>,
): string | undefined {
	if (code === "retrieval-sheet-invalid") return practiceDiagnosticMessage(code);
	return practiceFieldDiagnosticMessage(code, args);
}

export function practiceFieldDiagnosticMessage(
	code: string,
	args: Record<string, unknown>,
): string | undefined {
	if (code === "highlight-invalid") return practiceDiagnosticMessage(code);
	const template = practiceFieldMessages[code as keyof typeof practiceFieldMessages];
	return template?.replace(/\{(\w+)\}/g, (_match, name: string) => String(args[name] ?? ""));
}
