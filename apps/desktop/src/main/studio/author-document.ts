import { createHash, randomBytes } from "node:crypto";
import reviewEn from "@praxity/editor-core/messages/en" with { type: "json" };
import reviewFr from "@praxity/editor-core/messages/fr" with { type: "json" };
import { REVIEW_LIMITS, REVIEW_TEXT_RULES } from "@praxity/review-share/review";
import { escapeHtml } from "@praxity/shared-blocks/constants";
import { EMBED_FRAME_CSP_SOURCES } from "@praxity/shared-blocks/embed-url-utils";
import {
	bindInspectionFragmentLinks,
	stripInspectionMarkup,
} from "@praxity/shared-blocks/inspection-markup";
import { canvasMessages } from "../../shared/canvas-messages";
import type { CanvasPageScope } from "../../shared/editor-session";

/** Projects only admitted captured HTML. All course resources stay on the learner origin. */
export async function serveStudioAuthorDocument(
	request: Request,
	html: string,
	readUrl: string,
	canvasScript: string,
): Promise<Response> {
	const editorOrigin = new URL(request.url).origin;
	const learnerOrigin = new URL(readUrl).origin;
	if (learnerOrigin === editorOrigin) throw new Error("Learner and author origins must differ");
	const { JSDOM } = await import("jsdom");
	const dom = new JSDOM(html, { runScripts: "outside-only" });
	try {
		const doc = dom.window.document;
		stripInspectionMarkup(doc, true);
		for (const base of doc.querySelectorAll("base")) base.remove();
		bindInspectionFragmentLinks(doc, request.url);
		const base = doc.createElement("base");
		base.href = readUrl;
		doc.head.prepend(base);
		const nonce = randomBytes(32).toString("base64");
		const messages = canvasMessages[doc.documentElement.lang.startsWith("fr") ? "fr" : "en"];
		const bridge = doc.createElement("script");
		bridge.setAttribute("nonce", nonce);
		bridge.textContent =
			`${canvasScript}\nPraxityCanvas.startStudioAuthor(${JSON.stringify(editorOrigin)},${JSON.stringify(readUrl)},${JSON.stringify(messages)})`.replace(
				/<\/script/gi,
				"<\\/script",
			);
		// Capture browser APIs and erase the bearer before any course element is parsed.
		doc.head.prepend(bridge);
		const policy = [
			"default-src 'none'",
			`script-src 'nonce-${nonce}'`,
			"script-src-attr 'none'",
			`style-src ${learnerOrigin} 'unsafe-inline'`,
			`img-src ${learnerOrigin} https: data:`,
			`media-src ${learnerOrigin} https: data:`,
			`font-src ${learnerOrigin} data:`,
			"connect-src 'self'",
			`frame-src ${learnerOrigin} ${EMBED_FRAME_CSP_SOURCES.join(" ")}`,
			"object-src 'none'",
			`base-uri ${learnerOrigin}`,
			"form-action 'none'",
			"frame-ancestors 'none'",
			"worker-src 'none'",
		].join("; ");
		return new Response(request.method === "HEAD" ? null : dom.serialize(), {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Content-Security-Policy": policy,
				"Cache-Control": "no-store",
				"Referrer-Policy": "no-referrer",
				"X-Content-Type-Options": "nosniff",
				"X-Frame-Options": "DENY",
				"Cross-Origin-Opener-Policy": "same-origin",
			},
		});
	} finally {
		dom.window.close();
	}
}

/** Learner scripts and content are preserved. The mode link contains no editor capability. */
export async function addStudioReadModeLink(
	html: string,
	editUrl: string,
	review?: {
		reviewId: string;
		capability: string;
		page: CanvasPageScope | undefined;
		pages?: { id: string; href: string }[];
		draftOriginChanged?: boolean;
	},
): Promise<string> {
	const { JSDOM } = await import("jsdom");
	const dom = new JSDOM(html, { runScripts: "outside-only", includeNodeLocations: true });
	try {
		const doc = dom.window.document;
		const locale = doc.documentElement.lang.startsWith("fr") ? "fr" : "en";
		const label = canvasMessages[locale].enter;
		// The full-viewport deck must reserve a row for Studio instead of covering its header.
		const deck = doc.querySelector('.praxity-deck[data-island="deck"]');
		const container = deck ?? doc.body;
		const body = dom.nodeLocation(container) as
			| {
					startTag?: { endOffset: number };
			  }
			| null
			| undefined;
		const first = container.firstChild;
		const offset =
			body?.startTag?.endOffset ?? (first ? dom.nodeLocation(first)?.startOffset : undefined);
		if (offset === undefined) throw new Error("Captured document has no body insertion boundary");
		// Reserve a row in plain Read; the review client moves this same link into its header.
		const link = `<style data-praxity-studio-read>.praxity-studio-read-tools{flex:0 0 64px;min-height:64px}.praxity-studio-read-tools>a{position:fixed;inset-block-start:8px;inset-inline-end:8px;z-index:10001}.praxity-studio-edit-link{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:8px 12px;border:2px solid var(--praxity-color-border,#8c959f);border-radius:6px;font:inherit;color:var(--praxity-color-text,#212529);background:var(--praxity-color-background,#fff)}.praxity-studio-edit-link:focus-visible{outline:3px solid var(--praxity-color-focus,#005fcc);outline-offset:2px}@media(forced-colors:active){.praxity-studio-edit-link{color:LinkText;background:Canvas;border-color:ButtonText}.praxity-studio-edit-link:focus-visible{outline-color:Highlight}}</style><div class="praxity-studio-read-tools"><a class="praxity-studio-edit-link" href="${escapeHtml(editUrl)}" rel="noreferrer">${escapeHtml(label)}</a></div>`;
		const linked = html.slice(0, offset) + link + html.slice(offset);
		if (!review) return linked;
		const scope = review.page;
		// Hash the captured source set; the manifest does not map lesson IDs to source paths.
		const revision = scope?.sourceRevisions
			? createHash("sha256")
					.update(
						JSON.stringify(
							Object.entries(scope.sourceRevisions).sort(([a], [b]) =>
								a < b ? -1 : a > b ? 1 : 0,
							),
						),
					)
					.digest("hex")
			: null;
		const config = JSON.stringify({
			schema: 1,
			reviewId: review.reviewId,
			capability: review.capability,
			endpoint: `/api/reviews/${review.reviewId}`,
			limits: REVIEW_LIMITS,
			textRules: {
				controls: REVIEW_TEXT_RULES.bodyControls,
				surrogates: REVIEW_TEXT_RULES.surrogates,
			},
			blockNames: (locale === "fr" ? reviewFr : reviewEn).pedagogyAudit.blockTypes,
			locale,
			...(review.pages ? { pages: review.pages } : {}),
			...(review.draftOriginChanged ? { draftOriginChanged: true } : {}),
			page: {
				lessonId: scope?.lessonId ?? null,
				pageId: scope?.pageId ?? null,
				pageIds: scope?.pageIds ?? null,
				pageIndex: scope?.pageIndex ?? null,
				revision,
			},
		}).replace(
			/[<>&\u2028\u2029]/gu,
			(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
		const head = dom.nodeLocation(doc.head) as { startTag?: { endOffset: number } } | null;
		const bodyStart = dom.nodeLocation(doc.body) as { startTag?: { endOffset: number } } | null;
		const configOffset = head?.startTag?.endOffset ?? bodyStart?.startTag?.endOffset;
		if (configOffset === undefined)
			throw new Error("Captured document has no review insertion boundary");
		const assets = `<script type="application/json" id="praxity-review-config">${config}</script><link rel="stylesheet" href="/_praxity/review/review-comments.css"><script defer src="/_praxity/review/review-comments.js" data-praxity-review-comments="true"></script>`;
		return linked.slice(0, configOffset) + assets + linked.slice(configOffset);
	} finally {
		dom.window.close();
	}
}
