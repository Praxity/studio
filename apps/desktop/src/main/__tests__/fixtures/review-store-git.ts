import { randomUUID } from "node:crypto";
import { openReviewStore } from "../../studio/review-store";

try {
	const store = await openReviewStore(process.argv[2], undefined, {
		gitTimeoutMs: process.argv[3] ? Number(process.argv[3]) : undefined,
	});
	const principal = await store.principalFor("reviewer", "local-preview");
	const result = await store.create(principal, {
		reviewId: store.reviewId,
		requestId: randomUUID(),
		body: "Private feedback",
		anchor: {
			courseId: null,
			lessonId: null,
			pageId: "page-1",
			nodeId: null,
			blockId: null,
			revision: null,
			quote: null,
			pin: null,
			tab: null,
			revealPath: [],
			cssPath: null,
			context: { pageTitle: "Page one", targetLabel: null },
		},
	});
	console.log(JSON.stringify({ ok: result.ok }));
} catch (error) {
	const failure = error as { code?: string; reason?: string };
	console.log(
		JSON.stringify({ code: failure.code, reason: failure.reason, message: String(error) }),
	);
}
