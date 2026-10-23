import {
	readLearnerBlockState,
	writeLearnerBlockState,
} from "@praxity/shared-blocks/learner-block-state";
import {
	createSelfCheckResizeObserver,
	observeSelfCheckLifetime,
	selfCheckEpochTicket,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";

type ScrollDirection = "start" | "end";
type SequenceBlockState = { position: number };

function readRestoredPosition(blockId: string): number | undefined {
	if (!blockId) return undefined;
	const state = readLearnerBlockState(blockId);
	if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
	const rawPosition = (state as { position?: unknown }).position;
	const position =
		typeof rawPosition === "number"
			? rawPosition
			: typeof rawPosition === "string"
				? Number(rawPosition)
				: Number.NaN;
	return Number.isFinite(position) ? Math.max(0, position) : undefined;
}

export function initSequenceEnhancements(scope: ParentNode = document): () => void {
	const cleanups: Array<() => void> = [];
	scope
		.querySelectorAll<HTMLElement>(
			'[data-island="sequence"] .praxity-sequence-scroll-region:not([data-sequence-enhanced])',
		)
		.forEach((root) => {
			const viewport = root.querySelector<HTMLElement>(".praxity-sequence-scroll-viewport");
			const start = root.querySelector<HTMLButtonElement>('[data-sequence-scroll="start"]');
			const end = root.querySelector<HTMLButtonElement>('[data-sequence-scroll="end"]');
			if (!viewport || !start || !end) return;

			root.dataset.sequenceEnhanced = "";
			const blockRoot = root.closest<HTMLElement>("[data-block-id]");
			const blockId = blockRoot?.dataset.blockId?.trim() ?? "";
			let restoredPosition = readRestoredPosition(blockId);
			const position = (maximum: number) => Math.min(maximum, Math.abs(viewport.scrollLeft));
			const restorePosition = (maximum: number) => {
				if (
					restoredPosition === undefined ||
					viewport.clientWidth <= 0 ||
					viewport.scrollWidth <= 0
				)
					return;
				const next = Math.min(maximum, restoredPosition);
				const rtl = getComputedStyle(viewport).direction === "rtl";
				viewport.scrollLeft = next * (rtl ? -1 : 1);
				restoredPosition = undefined;
			};
			const update = (shouldPersist = false) => {
				const current = selfCheckEpochTicket(root.ownerDocument);
				const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
				const hasMeasuredLayout = viewport.clientWidth > 0 && viewport.scrollWidth > 0;
				restorePosition(maximum);
				const currentPosition = position(maximum);
				const hasOverflow = maximum > 1;
				const canStart = hasOverflow && currentPosition > 1;
				const canEnd = hasOverflow && currentPosition < maximum - 1;
				root.dataset.overflow = canStart ? (canEnd ? "both" : "start") : canEnd ? "end" : "none";
				start.hidden = !hasOverflow;
				end.hidden = !hasOverflow;
				start.setAttribute("aria-disabled", String(!canStart));
				end.setAttribute("aria-disabled", String(!canEnd));
				if (shouldPersist && hasMeasuredLayout && blockId) {
					writeLearnerBlockState(
						blockId,
						{
							position: currentPosition,
						} satisfies SequenceBlockState,
						current,
					);
				}
			};
			const scroll = (direction: ScrollDirection) => {
				const rtl = getComputedStyle(viewport).direction === "rtl";
				const logicalDirection = direction === "start" ? -1 : 1;
				viewport.scrollBy({
					left: logicalDirection * (rtl ? -1 : 1) * viewport.clientWidth * 0.8,
					behavior: "instant",
				});
			};
			const onStart = () => start.getAttribute("aria-disabled") !== "true" && scroll("start");
			const onEnd = () => end.getAttribute("aria-disabled") !== "true" && scroll("end");
			const onKeyDown = (event: KeyboardEvent) => {
				if (
					event.target !== viewport ||
					(event.key !== "ArrowLeft" && event.key !== "ArrowRight")
				) {
					return;
				}
				event.preventDefault();
				scroll(event.key === "ArrowLeft" ? "start" : "end");
			};

			update();
			const onScroll = () => update(true);
			const onResize = () => update();
			viewport.addEventListener("scroll", onScroll, { passive: true });
			viewport.addEventListener("keydown", onKeyDown);
			start.addEventListener("click", onStart);
			end.addEventListener("click", onEnd);
			const releaseObserver = observeSelfCheckLifetime((current) => {
				const refresh = () => {
					if (current()) onResize();
				};
				const observer =
					typeof ResizeObserver === "undefined"
						? null
						: createSelfCheckResizeObserver(current, refresh);
				observer?.observe(viewport);
				if (viewport.firstElementChild) observer?.observe(viewport.firstElementChild);
				if (!observer) window.addEventListener("resize", refresh);
				return () => {
					observer?.disconnect();
					window.removeEventListener("resize", refresh);
				};
			});

			cleanups.push(() => {
				viewport.removeEventListener("scroll", onScroll);
				viewport.removeEventListener("keydown", onKeyDown);
				start.removeEventListener("click", onStart);
				end.removeEventListener("click", onEnd);
				releaseObserver();
				start.hidden = true;
				end.hidden = true;
				root.dataset.overflow = "none";
				delete root.dataset.sequenceEnhanced;
			});
		});
	return () => cleanups.forEach((cleanup) => cleanup());
}

export { initSequenceEnhancements as attachIsland };

if (shouldAttachIslandAutomatically()) initSequenceEnhancements();
