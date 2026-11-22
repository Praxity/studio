import { randomBytes } from "node:crypto";
import { escapeHtml } from "@praxity/shared-blocks/constants";
import { EMBED_FRAME_CSP_SOURCES } from "@praxity/shared-blocks/embed-url-utils";
import {
	bindInspectionFragmentLinks,
	stripInspectionMarkup,
} from "@praxity/shared-blocks/inspection-markup";
import { canvasMessages } from "../../shared/canvas-messages";

import { addStudioReviewBootstrap, type StudioReviewBootstrap } from "./review-bootstrap";

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

export async function addStudioReadModeLink(
	html: string,
	editUrl: string,
	review?: StudioReviewBootstrap,
): Promise<string> {
	const { JSDOM } = await import("jsdom");
	const dom = new JSDOM(html, { runScripts: "outside-only", includeNodeLocations: true });
	try {
		const doc = dom.window.document;
		const locale = doc.documentElement.lang.startsWith("fr") ? "fr" : "en";
		const label = canvasMessages[locale].enter;
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
		const link = `<style data-praxity-studio-read>.praxity-studio-read-tools{flex:0 0 64px;min-height:64px}.praxity-studio-read-tools>a{position:fixed;inset-block-start:8px;inset-inline-end:8px;z-index:10001}.praxity-studio-edit-link{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:8px 12px;border:2px solid var(--praxity-color-border,#8c959f);border-radius:6px;font:inherit;color:var(--praxity-color-text,#212529);background:var(--praxity-color-background,#fff)}.praxity-studio-edit-link:focus-visible{outline:3px solid var(--praxity-color-focus,#005fcc);outline-offset:2px}@media(forced-colors:active){.praxity-studio-edit-link{color:LinkText;background:Canvas;border-color:ButtonText}.praxity-studio-edit-link:focus-visible{outline-color:Highlight}}</style><div class="praxity-studio-read-tools"><a class="praxity-studio-edit-link" href="${escapeHtml(editUrl)}" rel="noreferrer">${escapeHtml(label)}</a></div>`;
		const linked = html.slice(0, offset) + link + html.slice(offset);
		if (!review) return linked;
		return addStudioReviewBootstrap(linked, review);
	} finally {
		dom.window.close();
	}
}
