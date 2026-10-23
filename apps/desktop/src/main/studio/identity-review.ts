import { randomBytes } from "node:crypto";
import { escapeHtml } from "@praxity/shared-blocks/constants";
import en from "../cli-messages/en.json" with { type: "json" };
import fr from "../cli-messages/fr.json" with { type: "json" };
import { formatIdentityAdvice } from "../identity-init-cli";
import type { identityRetirements } from "../identity-store";

export const identityReviewMessages = {
	en: {
		title: "Some blocks would get new IDs",
		warning: "If this course has been published, learner records for these blocks stop matching.",
		question: "Has this course been published?",
		duplicates: en.identityInit.mixedRederiveRequired,
		confirm: "I haven't published this course: continue.",
		close: "Close",
		read: "Read",
		help: "To keep the existing IDs, undo the source edit, or run praxity identity init <course> to see the details.",
		line: "Line",
		unknown: "unknown",
		stale: "The course changed. Reopen Edit text to review the current blocks.",
		failed: "Studio could not confirm the new IDs. Reopen Edit text to try again.",
		badYaml: "Fix the YAML frontmatter before reviewing content changes.",
		invalidSource: "Fix the source errors before reviewing content changes.",
		draftRetirements:
			"This save would remove saved content: {list}. Keep that text, or make the change in the canvas, where Studio keeps track of it.",
	},
	fr: {
		title: "Certains blocs recevraient de nouveaux identifiants",
		warning:
			"Si ce cours a été publié, les données des apprenants ne correspondront plus à ces blocs.",
		question: "Ce cours a-t-il été publié ?",
		duplicates: fr.identityInit.mixedRederiveRequired,
		confirm: "Je n'ai pas publié ce cours : continuer.",
		close: "Fermer",
		read: "Lire",
		help: "Pour conserver les identifiants existants, annulez la modification du texte source, ou exécutez praxity identity init <cours> pour voir les détails.",
		line: "Ligne",
		unknown: "inconnue",
		stale: "Le cours a changé. Rouvrez Modifier le texte pour vérifier les blocs actuels.",
		failed:
			"Studio n'a pas pu confirmer les nouveaux identifiants. Rouvrez Modifier le texte pour réessayer.",
		badYaml: "Corrigez les métadonnées YAML avant d'examiner les modifications du contenu.",
		invalidSource:
			"Corrigez les erreurs du texte source avant d'examiner les modifications du contenu.",
		draftRetirements:
			"Cet enregistrement retirerait du contenu enregistré : {list}. Gardez ce texte, ou faites la modification dans le canevas, où Studio en garde la trace.",
	},
};

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

/** This page contains only escaped diagnostics, never authored HTML. */
export function renderIdentityReview(review: StudioIdentityReview, token: string) {
	const messages = identityReviewMessages[review.locale];
	const nonce = randomBytes(32).toString("base64");
	const blockedId = review.sourceError ? "review-source-error" : "review-duplicates";
	const blockedMessage = review.sourceError
		? `${review.sourceError.file}: ${messages.line} ${review.sourceError.line}. ${review.sourceError.message}`
		: formatIdentityAdvice(messages.duplicates, undefined, review.duplicate);
	const literal = (value: string) => JSON.stringify(value).replaceAll("<", "\\u003c");
	return {
		nonce,
		html: `<!doctype html><html lang="${review.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(messages.title)} | Praxity Studio</title>
<style>body{font:1rem/1.6 system-ui,sans-serif;background:#fff;color:#181818;margin:0}main{max-width:48rem;margin:3rem auto;padding:0 1.5rem;overflow-wrap:anywhere}h1{line-height:1.2}li{margin-block:1rem}button,a{font:inherit;display:inline-block;padding:.75rem 1rem;margin:.5rem .5rem .5rem 0}button{background:#181818;color:#fff;border:2px solid #181818;cursor:pointer}a{color:#123a72}button:focus-visible,a:focus-visible{outline:3px solid #005fcc;outline-offset:3px}h1:focus{outline:none}</style></head>
<body><main><h1 id="review-heading" tabindex="-1" aria-describedby="review-warning${review.confirmationBlocked ? ` ${blockedId}` : ""}">${escapeHtml(messages.title)}</h1>
<p id="review-warning">${escapeHtml(messages.warning)}</p>
<ul>${review.retirements.map((item) => `<li><strong>${escapeHtml(item.file)}</strong>: ${escapeHtml(item.page)}; ${escapeHtml(item.label)}; ${messages.line} ${item.line ?? messages.unknown}</li>`).join("")}</ul>
${review.confirmationBlocked ? `<p id="${blockedId}">${escapeHtml(blockedMessage)}</p>${review.sourceError ? `<a href="/launch?canvas=read">${escapeHtml(messages.read)}</a>` : ""}<a href="/">${escapeHtml(messages.close)}</a>` : `<p>${escapeHtml(messages.question)}</p><form id="confirm" method="post" action="/api/identity/confirm"><input type="hidden" name="revision" value="${escapeHtml(review.revision)}"><button type="submit">${escapeHtml(messages.confirm)}</button><a href="/">${escapeHtml(messages.close)}</a></form>`}
<p>${escapeHtml(messages.help)}</p><p id="error" role="alert"></p></main>
<script nonce="${nonce}">
document.getElementById('review-heading').focus();
const form = document.getElementById('confirm');
const error = document.getElementById('error');
form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const revision = new FormData(form).get('revision');
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch(form.action, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Authorization: ${literal(`Bearer ${token}`)} },
      body: JSON.stringify({ revision })
    });
    if (response.type === 'opaqueredirect') {
      location.replace('/launch');
      return;
    }
    const result = await response.json();
    error.textContent = ['identity_review_changed', 'identity_duplicate_pending'].includes(result.error?.code)
      ? result.error.message : ${literal(messages.failed)};
  } catch {
    error.textContent = ${literal(messages.failed)};
  }
  button.disabled = false;
});
</script></body></html>`,
	};
}
