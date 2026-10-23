import {
	createSelfCheckIntersectionObserver,
	createSelfCheckResizeObserver,
	observeSelfCheckLifetime,
	requestSelfCheckFrame,
	selfCheckEpochTicket,
	setSelfCheckTimeout,
} from "../self-check-consumers";

const DIMMED_ATTRIBUTE = "data-focus-dimmed";
const ROW_SELECTOR = "[data-focus-row]";
const SCROLL_ROOT_SELECTOR =
	".praxity-viewer-shell, .preview-overlay__content, .preview-window__content";

export interface FocusModeSession {
	previousPageKey?: string;
	lastPointerPosition?: { x: number; y: number };
}

export function isFocusDimExemptBlock(element: HTMLElement): boolean {
	return element.hasAttribute("data-focus-exempt");
}

export function getFocusReadingRows(scopeRoot: HTMLElement): HTMLElement[][] {
	return Array.from(scopeRoot.querySelectorAll<HTMLElement>(ROW_SELECTOR))
		.filter((row) => {
			const parentRow = row.parentElement?.closest<HTMLElement>(ROW_SELECTOR);
			return !parentRow || !scopeRoot.contains(parentRow);
		})
		.map((block) => [block]);
}

function clearFocusModeAttributes(scopeRoot: ParentNode): void {
	for (const element of scopeRoot.querySelectorAll<HTMLElement>(`[${DIMMED_ATTRIBUTE}]`)) {
		element.removeAttribute(DIMMED_ATTRIBUTE);
	}
}

function isScrollable(element: HTMLElement): boolean {
	const overflowY = window.getComputedStyle(element).overflowY;
	return (
		element.scrollHeight - element.clientHeight > 4 &&
		(overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
	);
}

function getScrollRoot(scopeRoot: HTMLElement): HTMLElement | null {
	const candidates = [
		scopeRoot,
		scopeRoot.closest<HTMLElement>(".preview-overlay__content"),
		scopeRoot.closest<HTMLElement>(".preview-window__content"),
	].filter((candidate): candidate is HTMLElement => Boolean(candidate));
	for (const candidate of candidates) {
		if (isScrollable(candidate)) return candidate;
	}
	let parent = scopeRoot.parentElement;
	while (parent) {
		if (parent.matches(SCROLL_ROOT_SELECTOR) && isScrollable(parent)) return parent;
		parent = parent.parentElement;
	}
	return null;
}

function getRootRect(scrollRoot: HTMLElement | null): Pick<DOMRect, "top" | "bottom" | "height"> {
	if (scrollRoot) return scrollRoot.getBoundingClientRect();
	return { top: 0, bottom: window.innerHeight, height: window.innerHeight };
}

function getRowRect(row: HTMLElement[]) {
	const rects = row.map((element) => element.getBoundingClientRect());
	const top = Math.min(...rects.map((rect) => rect.top));
	const bottom = Math.max(...rects.map((rect) => rect.bottom));
	return {
		top,
		bottom,
		height: bottom - top,
		width: Math.max(...rects.map((rect) => rect.width)),
	};
}

function isVisibleInRoot(row: HTMLElement[], scrollRoot: HTMLElement | null): boolean {
	const rect = getRowRect(row);
	const root = getRootRect(scrollRoot);
	return rect.bottom > root.top && rect.top < root.bottom;
}

function pickReadingTarget(
	targets: HTMLElement[][],
	scrollRoot: HTMLElement | null,
	compact: boolean,
): HTMLElement[] {
	const root = getRootRect(scrollRoot);
	const readingLine = root.top + root.height * (compact ? 0.36 : 0.3);
	let best = targets[0];
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const target of targets) {
		const rect = getRowRect(target);
		if (rect.height <= 0 || rect.width <= 0) continue;
		const distance =
			rect.top <= readingLine && rect.bottom >= readingLine ? 0 : Math.abs(rect.top - readingLine);
		if (distance < bestDistance) {
			best = target;
			bestDistance = distance;
		}
	}
	return best;
}

function hasMeaningfulScroll(scrollRoot: HTMLElement | null): boolean {
	return scrollRoot
		? scrollRoot.scrollHeight - scrollRoot.clientHeight > 4
		: document.documentElement.scrollHeight - window.innerHeight > 4;
}

function isCompactViewer(scopeRoot: HTMLElement): boolean {
	const previewMode =
		scopeRoot.closest<HTMLElement>("[data-preview-viewport]")?.dataset.previewViewport;
	return (
		scopeRoot.getBoundingClientRect().width <= 768 ||
		previewMode === "tablet" ||
		previewMode === "mobile" ||
		window.matchMedia("(max-width: 768px), (pointer: coarse)").matches
	);
}

export function installFocusMode(
	enabled: boolean,
	scopeRoot: HTMLElement,
	session: FocusModeSession = {},
	pageKey?: string,
): () => void {
	if (!enabled) {
		session.previousPageKey = pageKey;
		clearFocusModeAttributes(scopeRoot);
		return () => undefined;
	}

	const rows = getFocusReadingRows(scopeRoot);
	const targets = rows.filter((row) => row.some((element) => !isFocusDimExemptBlock(element)));
	if (targets.length <= 1) {
		clearFocusModeAttributes(scopeRoot);
		return () => undefined;
	}

	const scrollRoot = getScrollRoot(scopeRoot);
	const pageChanged = session.previousPageKey !== undefined && session.previousPageKey !== pageKey;
	session.previousPageKey = pageKey;
	if (pageChanged && scrollRoot) scrollRoot.scrollTop = 0;
	const pointedElement =
		pageChanged && session.lastPointerPosition && typeof document.elementFromPoint === "function"
			? document.elementFromPoint(session.lastPointerPosition.x, session.lastPointerPosition.y)
			: null;
	const pointedTarget = pointedElement
		? targets.find((row) =>
				row.some((element) => element === pointedElement || element.contains(pointedElement)),
			)
		: undefined;
	const compact = isCompactViewer(scopeRoot);
	const staticTouchViewport =
		compact &&
		window.matchMedia("(hover: none), (pointer: coarse)").matches &&
		!hasMeaningfulScroll(scrollRoot);
	const intersecting = new Set<HTMLElement>();
	let waitingForInteraction = pageChanged;
	let lastActive = new Set<HTMLElement[]>(
		staticTouchViewport
			? targets
			: [
					pageChanged
						? (pointedTarget ?? targets[0])
						: pickReadingTarget(targets, scrollRoot, compact),
				],
	);
	let timer: number | null = null;
	let frame: number | null = null;
	const debounceMs = compact ? 80 : 100;

	const applyActiveTargets = (activeTargets: Set<HTMLElement[]>) => {
		lastActive = new Set(activeTargets);
		for (const row of rows) {
			for (const target of row) {
				if (activeTargets.has(row) || isFocusDimExemptBlock(target)) {
					target.removeAttribute(DIMMED_ATTRIBUTE);
				} else target.setAttribute(DIMMED_ATTRIBUTE, "true");
			}
		}
	};

	const updateFromGeometry = () => {
		if (staticTouchViewport && lastActive.size > 1) {
			applyActiveTargets(lastActive);
			return;
		}
		const visibleTargets = targets.filter((target) => isVisibleInRoot(target, scrollRoot));
		applyActiveTargets(
			new Set([
				pickReadingTarget(
					visibleTargets.length > 0 ? visibleTargets : targets,
					scrollRoot,
					compact,
				),
			]),
		);
	};

	const scheduleUpdate = () => {
		const current = selfCheckEpochTicket(scopeRoot.ownerDocument);
		if (timer) window.clearTimeout(timer);
		timer = setSelfCheckTimeout(
			() => {
				if (staticTouchViewport && lastActive.size > 1) return;
				if (intersecting.size === 0) {
					updateFromGeometry();
					return;
				}
				const intersectingRows = targets.filter((row) =>
					row.some((element) => intersecting.has(element)),
				);
				applyActiveTargets(
					new Set([
						pickReadingTarget(
							intersectingRows.length > 0 ? intersectingRows : targets,
							scrollRoot,
							compact,
						),
					]),
				);
			},
			debounceMs,
			current,
		);
	};

	const releaseObserver = observeSelfCheckLifetime((current) => {
		intersecting.clear();
		const observer =
			typeof IntersectionObserver === "undefined"
				? null
				: createSelfCheckIntersectionObserver(
						current,
						(entries) => {
							for (const entry of entries) {
								const target = entry.target as HTMLElement;
								if (entry.isIntersecting) intersecting.add(target);
								else intersecting.delete(target);
							}
							if (!waitingForInteraction) scheduleUpdate();
						},
						{
							root: scrollRoot,
							rootMargin: compact ? "-8% 0px -56% 0px" : "-10% 0px -70% 0px",
							threshold: [0, 0.01, 0.25],
						},
					);
		for (const row of targets) {
			for (const target of row) observer?.observe(target);
		}

		return () => observer?.disconnect();
	}, scopeRoot.ownerDocument);

	const handleActivation = (event: Event) => {
		waitingForInteraction = false;
		const activated = event.target as HTMLElement | null;
		if (!activated) return;
		const target = targets.find((row) =>
			row.some((candidate) => candidate === activated || candidate.contains(activated)),
		);
		if (!target) return;
		intersecting.clear();
		for (const element of target) intersecting.add(element);
		applyActiveTargets(new Set([target]));
	};
	const handlePointerMove = (event: PointerEvent) => {
		session.lastPointerPosition = { x: event.clientX, y: event.clientY };
	};
	scopeRoot.addEventListener("click", handleActivation, true);
	scopeRoot.addEventListener("focusin", handleActivation, true);
	scopeRoot.addEventListener("pointermove", handlePointerMove, { passive: true });

	const requestGeometryUpdate = () => {
		const current = selfCheckEpochTicket(scopeRoot.ownerDocument);
		if (frame) window.cancelAnimationFrame(frame);
		frame = requestSelfCheckFrame(() => {
			frame = null;
			updateFromGeometry();
		}, current);
	};
	const handleScroll = () => {
		waitingForInteraction = false;
		requestGeometryUpdate();
	};
	const handleResize = () => {
		if (!waitingForInteraction) requestGeometryUpdate();
	};
	const scrollTarget: HTMLElement | Window = scrollRoot ?? window;
	scrollTarget.addEventListener("scroll", handleScroll, { passive: true });
	window.addEventListener("resize", handleResize);
	const releaseResizeObserver = observeSelfCheckLifetime((current) => {
		const resizeObserver =
			typeof ResizeObserver === "undefined"
				? null
				: createSelfCheckResizeObserver(current, handleResize);
		resizeObserver?.observe(scopeRoot);
		return () => resizeObserver?.disconnect();
	}, scopeRoot.ownerDocument);

	const hoverCleanups: Array<() => void> = [];
	if (window.matchMedia("(hover: hover)").matches) {
		for (const row of targets) {
			for (const element of row) {
				const handler = () => {
					waitingForInteraction = false;
					intersecting.clear();
					for (const target of row) intersecting.add(target);
					applyActiveTargets(new Set([row]));
				};
				element.addEventListener("mouseenter", handler, { passive: true });
				hoverCleanups.push(() => element.removeEventListener("mouseenter", handler));
			}
		}
	}

	applyActiveTargets(lastActive);
	if (!staticTouchViewport && !pageChanged)
		requestSelfCheckFrame(updateFromGeometry, selfCheckEpochTicket(scopeRoot.ownerDocument));

	return () => {
		if (timer) window.clearTimeout(timer);
		if (frame) window.cancelAnimationFrame(frame);
		scopeRoot.removeEventListener("click", handleActivation, true);
		scopeRoot.removeEventListener("focusin", handleActivation, true);
		scopeRoot.removeEventListener("pointermove", handlePointerMove);
		scrollTarget.removeEventListener("scroll", handleScroll);
		window.removeEventListener("resize", handleResize);
		releaseResizeObserver();
		for (const cleanup of hoverCleanups) cleanup();
		releaseObserver();
		clearFocusModeAttributes(scopeRoot);
	};
}
