import { LIMITS, needsReply, type StaffThread } from "./threads";

const STRINGS = {
	en: {
		lang: "en",
		title: "Learner questions",
		intro:
			"Each learner sees only their own questions and your replies, in the course's help panel, the next time they open a page. Learners get no email. Times are UTC.",
		open: "Needs a reply",
		answered: "Replied",
		none: "No questions yet.",
		asked: (page: string, at: string) => `${page}. Asked ${at} UTC.`,
		about: "About:",
		staffReply: (at: string, read: boolean) =>
			`Staff reply, ${at} UTC. ${read ? "Seen by the learner." : "Not seen yet."}`,
		learnerReply: (at: string) => `Learner follow-up, ${at} UTC.`,
		replyTo: (email: string) => `Reply to ${email}`,
		send: "Send reply",
	},
	fr: {
		lang: "fr",
		title: "Questions des personnes apprenantes",
		intro:
			"Chaque personne apprenante ne voit que ses propres questions et vos réponses, dans le panneau d’aide du cours, la prochaine fois qu’elle ouvre une page. Aucun courriel n’est envoyé. Heures en UTC.",
		open: "Réponse attendue",
		answered: "Répondu",
		none: "Aucune question pour l’instant.",
		asked: (page: string, at: string) => `${page}. Posée le ${at} UTC.`,
		about: "À propos de :",
		staffReply: (at: string, read: boolean) =>
			`Réponse de l’équipe, ${at} UTC. ${read ? "Vue par la personne apprenante." : "Pas encore vue."}`,
		learnerReply: (at: string) => `Suivi de la personne apprenante, ${at} UTC.`,
		replyTo: (email: string) => `Répondre à ${email}`,
		send: "Envoyer la réponse",
	},
} as const;

const esc = (value: string) =>
	value.replace(
		/[&<>"']/gu,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string,
	);
const utc = (iso: string) => iso.slice(0, 16).replace("T", " ");

const STYLE =
	"*{box-sizing:border-box}body{font:1rem/1.5 system-ui,sans-serif;color:#1f2328;background:#f6f8fa;margin:0;overflow-wrap:anywhere}main{max-width:52rem;margin:auto;padding:1.25rem}article{background:#fff;border:1px solid #d0d7de;border-radius:12px;padding:1.25rem;margin:1rem 0}h2{font-size:1.125rem;margin:0 0 .25rem}.meta{color:#57606a;font-size:.9375rem;margin:.25rem 0}.body{white-space:pre-wrap}blockquote{margin:.5rem 0;padding-left:.75rem;border-left:3px solid #d0d7de;color:#57606a}.reply{margin:.75rem 0 0 1rem;padding:.5rem .75rem;background:#f6f8fa;border-radius:8px}.reply.learner{background:#fff;border:1px solid #d0d7de}label{display:block;font-weight:600;margin-top:1rem}textarea{display:block;width:100%;font:inherit;padding:.5rem;border:1px solid #8c959f;border-radius:6px}button{margin-top:.5rem;min-height:2.75rem;padding:.5rem 1rem;font:inherit;font-weight:600;color:#fff;background:#0969da;border:0;border-radius:6px;cursor:pointer}:focus-visible{outline:3px solid #0969da;outline-offset:2px}";

/** The staff page: every thread, open ones first, each with a reply form. */
export function staffPage(threads: StaffThread[], prefix: string, locale: "en" | "fr"): string {
	const t = STRINGS[locale];
	const thread = (
		q: StaffThread,
	) => `<article id="thread-${q.id}" aria-labelledby="thread-${q.id}-who">
<h2 id="thread-${q.id}-who">${esc(q.learnerEmail)}</h2>
<p class="meta"><strong>${needsReply(q) ? t.open : t.answered}</strong>. ${esc(t.asked(q.pageTitle || q.pageId, utc(q.createdAt)))}</p>
${q.quote ? `<blockquote>${esc(t.about)} ${esc(q.quote)}</blockquote>` : ""}<p class="body">${esc(q.body)}</p>
${q.replies
	.map((r) =>
		r.fromStaff
			? `<div class="reply"><p class="meta">${esc(t.staffReply(utc(r.createdAt), r.read))}</p><p class="body">${esc(r.body)}</p></div>`
			: `<div class="reply learner"><p class="meta">${esc(t.learnerReply(utc(r.createdAt)))}</p><p class="body">${esc(r.body)}</p></div>`,
	)
	.join("\n")}
<form method="post" action="${esc(`${prefix}/staff/threads/${q.id}/replies`)}"><label for="reply-${q.id}">${esc(t.replyTo(q.learnerEmail))}</label><textarea id="reply-${q.id}" name="body" rows="3" maxlength="${LIMITS.body}" required></textarea><button type="submit">${t.send}</button></form>
</article>`;
	const ordered = [...threads.filter(needsReply), ...threads.filter((q) => !needsReply(q))];
	return `<!doctype html>
<html lang="${t.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title}</title><style>${STYLE}</style></head>
<body><main><h1>${t.title}</h1><p>${esc(t.intro)}</p>
${ordered.length ? ordered.map(thread).join("\n") : `<p>${t.none}</p>`}
</main></body></html>`;
}
