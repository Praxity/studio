import editorEn from "@praxity/editor-core/messages/en" with { type: "json" };
import editorFr from "@praxity/editor-core/messages/fr" with { type: "json" };
import type { identityRetirements } from "../identity-store";

export const identityReviewMessages = {
	en: {
		badYaml: "Fix the YAML frontmatter before reviewing content changes.",
		invalidSource: "Fix the source errors before reviewing content changes.",
		draftRetirements:
			"This save would remove saved content: {list}. Keep that text, or make the change in the canvas, where Studio keeps track of it.",
	},
	fr: {
		badYaml: "Corrigez les métadonnées YAML avant d'examiner les modifications du contenu.",
		invalidSource:
			"Corrigez les erreurs du texte source avant d'examiner les modifications du contenu.",
		draftRetirements:
			"Cet enregistrement retirerait du contenu enregistré : {list}. Gardez ce texte, ou faites la modification dans le canevas, où Studio en garde la trace.",
	},
};

const URL_REFUSALS = ["svg-data-url", "unsafe-media-url", "unsafe-link-url"] as const;

export function sourceErrorMessage(
	locale: "en" | "fr",
	error: { code: "bad_yaml" | "source_invalid"; diagnostic?: string },
): string {
	const refusal = URL_REFUSALS.find((code) => code === error.diagnostic);
	if (refusal) return (locale === "fr" ? editorFr : editorEn).op.diagnostic[refusal];
	return identityReviewMessages[locale][error.code === "bad_yaml" ? "badYaml" : "invalidSource"];
}

export interface StudioIdentityReview {
	locale: "en" | "fr";
	revision: string;
	confirmationBlocked: boolean;
	sourceError?: {
		code: "bad_yaml" | "source_invalid";
		file: string;
		line: number;
		message: string;
	};
	duplicate?: { file: string; line: number };
	retirements: ReturnType<typeof identityRetirements>;
}
