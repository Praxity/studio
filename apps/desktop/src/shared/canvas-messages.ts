export const canvasMessages = {
	en: {
		edit: "Edit mode",
		read: "Read mode",
		readUpdating: "Read mode: Updating",
		enter: "Edit text",
		editingOn: "Text editing on",
		editingOff: "Text editing off",
		editCaption: "Edit caption {n}",
		editSeparator: ": ",
		connecting: "Connecting",
		connected: "Connected",
		unmapped: "Some text could not be matched to the saved page.",
		refreshFailed: "Studio could not refresh the saved page. Reload to try again.",
		failed: "Studio could not connect. Reopen the Studio launch link.",
		editButton: "Edit",
		editHeading: "Edit heading {n}",
		headingText: "Heading text",
		editParagraph: "Edit paragraph {n}",
		paragraphText: "Paragraph text",
		editListItem: "Edit list item {n}",
		listItemText: "List item text",
		editChoiceLabel: "Edit choice label {n}",
		choiceLabelText: "Choice label text",
		paragraphHint:
			"Enter saves. Leaving the field saves. Esc cancels. Shift+Enter adds a wrapped line. Uses .prax inline syntax.",
		textLabel: "Text",
		hint: "Enter saves. Leaving the field saves. Esc cancels. Uses .prax inline syntax.",
		saved: "Saved",
		cancelled: "Cancelled",
		fileChanged: "The file changed. Your text is kept. Copy it, then reload.",
		emptyText: "Enter some text.",
		lineBreak: "Keep the text on one line.",
		unsupportedSyntax: "Use inline text only.",
		listMarker: "This line would become a list item. Remove the list marker to keep it as text.",
		settings: "Braces would become heading settings. Remove the braces to keep this as text.",
		refused: "The save was refused. Your text is kept. Copy it, then reload.",
		identityReviewPending:
			"This course changed outside Studio, and some saved content was removed. Review the changes before you edit. Copy your text first if you want to keep it.",
		reviewChanges: "Review changes",
		unknown: "The save could not be confirmed. Your text is kept.",
		copyText: "Copy text",
		copied: "Text copied",
		copyFailed: "Copy was unavailable. The text is selected; use your copy command.",
		reload: "Reload",
		confirmReload: "Reload and discard your text?",
		confirmDiscard: "Discard your kept text?",
		discardText: "Discard text",
		discardLeave: "Discard text and leave",
		discardReload: "Discard text and reload",
		keepEditing: "Keep editing",
		retrySave: "Retry save",
		checkSaved: "Check saved bytes",
	},
	fr: {
		edit: "Mode édition",
		read: "Mode lecture",
		readUpdating: "Mode lecture : Mise à jour",
		enter: "Modifier le texte",
		editingOn: "Modification du texte activée",
		editingOff: "Modification du texte désactivée",
		editCaption: "Modifier la légende {n}",
		editSeparator: " : ",
		connecting: "Connexion",
		connected: "Connecté",
		unmapped: "Certains textes ne correspondent pas à la page enregistrée.",
		refreshFailed: "Studio n'a pas pu actualiser la page enregistrée. Rechargez pour réessayer.",
		failed: "Studio n'a pas pu se connecter. Rouvrez le lien de lancement de Studio.",
		editButton: "Modifier",
		editHeading: "Modifier le titre {n}",
		headingText: "Texte du titre",
		editParagraph: "Modifier le paragraphe {n}",
		paragraphText: "Texte du paragraphe",
		editListItem: "Modifier l'élément de liste {n}",
		listItemText: "Texte de l'élément de liste",
		editChoiceLabel: "Modifier le libellé du choix {n}",
		choiceLabelText: "Texte du libellé du choix",
		paragraphHint:
			"Entrée enregistre. Quitter le champ enregistre. Échap annule. Maj+Entrée ajoute une ligne au paragraphe. Syntaxe .prax en ligne.",
		textLabel: "Texte",
		hint: "Entrée enregistre. Quitter le champ enregistre. Échap annule. Syntaxe .prax en ligne.",
		saved: "Enregistré",
		cancelled: "Annulé",
		fileChanged:
			"Le fichier a changé. Votre texte est conservé. Copiez-le, puis rechargez la page.",
		emptyText: "Saisissez du texte.",
		lineBreak: "Gardez le texte sur une seule ligne.",
		unsupportedSyntax: "Utilisez uniquement du texte en ligne.",
		listMarker:
			"Cette ligne deviendrait un élément de liste. Retirez le marqueur de liste pour la garder comme texte.",
		settings:
			"Les accolades deviendraient des paramètres du titre. Retirez les accolades pour garder ce contenu comme texte.",
		refused:
			"L'enregistrement a été refusé. Votre texte est conservé. Copiez-le, puis rechargez la page.",
		identityReviewPending:
			"Ce cours a été modifié hors de Studio, et du contenu enregistré a été retiré. Examinez les modifications avant de modifier. Copiez d'abord votre texte si vous voulez le garder.",
		reviewChanges: "Examiner les modifications",
		unknown: "L'enregistrement n'a pas pu être confirmé. Votre texte est conservé.",
		copyText: "Copier le texte",
		copied: "Texte copié",
		copyFailed:
			"La copie est indisponible. Le texte est sélectionné. Utilisez votre commande de copie.",
		reload: "Recharger",
		confirmReload: "Recharger et abandonner votre texte ?",
		confirmDiscard: "Abandonner votre texte conservé ?",
		discardText: "Abandonner le texte",
		discardLeave: "Abandonner le texte et quitter",
		discardReload: "Abandonner le texte et recharger",
		keepEditing: "Continuer la modification",
		retrySave: "Réessayer l'enregistrement",
		checkSaved: "Vérifier le texte enregistré",
	},
} as const;

export type CanvasMessages = { [K in keyof typeof canvasMessages.en]: string };

export type EditButtonKind = "heading" | "paragraph" | "listItem" | "choiceLabel" | "caption";

const editTemplates = {
	heading: "editHeading",
	paragraph: "editParagraph",
	listItem: "editListItem",
	choiceLabel: "editChoiceLabel",
	caption: "editCaption",
} as const satisfies Record<EditButtonKind, keyof CanvasMessages>;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Naming decision, 2026-10-17: kind and ordinal precede the literal authored excerpt.
// Rejected: collision suffixes, which authored text can copy, and replacement after text insertion.
// EN/FR unit and browser tests cover names; NVDA/VoiceOver speech acceptance is separate.
export function editButtonName(
	messages: CanvasMessages,
	kind: EditButtonKind,
	n: number,
	text: string,
) {
	const prefix = messages[editTemplates[kind]].replace("{n}", String(n));
	const normalized = text.replace(/\s+/gu, " ").trim();
	let excerpt = "";
	let count = 0;
	for (const { segment } of graphemes.segment(normalized)) {
		if (count === 40) {
			excerpt += "…";
			break;
		}
		excerpt += segment;
		count++;
	}
	return prefix + (excerpt ? messages.editSeparator + excerpt : "");
}
