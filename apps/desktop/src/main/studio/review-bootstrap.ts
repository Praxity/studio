import { createHash } from "node:crypto";
import reviewEn from "@praxity/editor-core/messages/en" with { type: "json" };
import reviewFr from "@praxity/editor-core/messages/fr" with { type: "json" };
import { REVIEW_LIMITS, REVIEW_TEXT_RULES } from "@praxity/review-share/review";
import type { CanvasPageScope } from "../../shared/editor-session";

export interface StudioReviewBootstrap {
	reviewId: string;
	capability: string;
	page: CanvasPageScope | undefined;
	pages?: { id: string; href: string; title: string }[];
	draftOriginChanged?: boolean;
}

export async function addStudioReviewBootstrap(
	html: string,
	review: StudioReviewBootstrap,
): Promise<string> {
	const { JSDOM } = await import("jsdom");
	const dom = new JSDOM(html, { runScripts: "outside-only", includeNodeLocations: true });
	try {
		const doc = dom.window.document;
		const locale = doc.documentElement.lang.startsWith("fr") ? "fr" : "en";
		const scope = review.page;
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
		return html.slice(0, configOffset) + assets + html.slice(configOffset);
	} finally {
		dom.window.close();
	}
}
