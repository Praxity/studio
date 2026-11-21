const requests = new WeakMap<Document, { root: HTMLElement; clear(): void }>();

const PRINT_FALLBACK_MS = 5 * 60 * 1000;

export function printRetrievalSheet(root: HTMLElement): void {
	const doc = root.ownerDocument;
	const view = doc.defaultView;
	if (!root.isConnected || !root.matches("[data-retrieval-sheet]") || !view || requests.has(doc))
		throw new Error("Retrieval sheet print unavailable");
	const ancestors: HTMLElement[] = [];
	for (let node = root.parentElement; node; node = node.parentElement) ancestors.push(node);
	const originalFocus = doc.activeElement;
	let focusMoved = false;
	const trackFocus = (event: FocusEvent) => {
		if (
			event.target !== originalFocus &&
			event.target !== doc.body &&
			event.target !== doc.documentElement
		)
			focusMoved = true;
	};
	const endOnInteraction = () => clear(false);
	const media = view.matchMedia?.("print");
	let timer: number | undefined;
	const request = { root, clear: () => clear(false) };
	const clear = (restoreFocus: boolean) => {
		if (requests.get(doc) !== request) return;
		delete doc.documentElement.dataset.praxityRetrievalPrint;
		delete root.dataset.praxityPrintSelected;
		for (const node of ancestors) delete node.dataset.praxityPrintPath;
		view.removeEventListener("afterprint", finished);
		view.removeEventListener("pagehide", request.clear);
		doc.removeEventListener("focusin", trackFocus);
		doc.removeEventListener("pointerdown", endOnInteraction);
		doc.removeEventListener("keydown", endOnInteraction);
		media?.removeEventListener("change", mediaChanged);
		view.clearTimeout(timer);
		requests.delete(doc);
		if (
			restoreFocus &&
			!focusMoved &&
			originalFocus instanceof view.HTMLElement &&
			originalFocus.isConnected &&
			originalFocus !== doc.body &&
			originalFocus !== doc.documentElement &&
			(doc.activeElement === doc.body ||
				doc.activeElement === doc.documentElement ||
				!doc.activeElement)
		) {
			originalFocus.focus({ preventScroll: true });
		}
	};
	const finished = () => clear(true);
	const mediaChanged = (event: MediaQueryListEvent) => {
		if (!event.matches) finished();
	};
	requests.set(doc, request);
	const block = root.closest<HTMLElement>('[data-block-type="retrievalSheet"][data-block-id]');
	doc.documentElement.dataset.praxityRetrievalPrint =
		block?.dataset.blockId ?? root.querySelector("[data-retrieval-side]")?.id ?? "";
	root.dataset.praxityPrintSelected = "";
	for (const node of ancestors) node.dataset.praxityPrintPath = "";
	try {
		view.addEventListener("afterprint", finished);
		view.addEventListener("pagehide", request.clear);
		doc.addEventListener("focusin", trackFocus);
		doc.addEventListener("pointerdown", endOnInteraction);
		doc.addEventListener("keydown", endOnInteraction);
		media?.addEventListener("change", mediaChanged);
		timer = view.setTimeout(request.clear, PRINT_FALLBACK_MS);
		view.print();
	} catch (error) {
		finished();
		throw error;
	}
}

export function cancelRetrievalSheetPrint(root: HTMLElement): void {
	const request = requests.get(root.ownerDocument);
	if (request?.root === root) request.clear();
}
