import type { CanvasPageScope } from "./editor-session";

/** Keep a replaced page's position, but never substitute a surviving captured sibling. */
export function selectCanvasPage<T extends { pageId: string; pageIndex: number }>(
	pages: readonly T[],
	captured: Pick<CanvasPageScope, "pageId" | "pageIndex" | "pageIds">,
) {
	const exact = pages.find((page) => page.pageId === captured.pageId);
	if (exact) return exact;
	const candidate = pages.find((page) => page.pageIndex === captured.pageIndex);
	return candidate && !captured.pageIds?.includes(candidate.pageId)
		? candidate
		: pages.find((page) => page.pageIndex === 0);
}
