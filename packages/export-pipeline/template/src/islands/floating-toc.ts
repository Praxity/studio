import {
	createSelfCheckIntersectionObserver,
	observeSelfCheckLifetime,
	requestSelfCheckFrame,
	selfCheckEpochTicket,
} from "@praxity/shared-blocks/self-check-consumers";
import { scrollElementIntoView } from "@praxity/shared-blocks/viewer/scroll-into-view";

export function initializeFloatingToc(): () => void {
	const toc = document.querySelector<HTMLElement>("[data-native-floating-toc]");
	if (!toc) return () => {};
	const listeners = new AbortController();
	const on = (target: EventTarget, event: string, handler: EventListener) =>
		target.addEventListener(event, handler, { signal: listeners.signal });
	let releaseObserver: (() => void) | undefined;
	const links = Array.from(toc.querySelectorAll<HTMLAnchorElement>("[data-toc-target]"));
	const targetFor = (link: HTMLAnchorElement) =>
		link.dataset.tocTarget ? document.getElementById(link.dataset.tocTarget) : null;
	const setActive = (active: HTMLAnchorElement) => {
		for (const link of links) {
			const current = link === active;
			link.classList.toggle("active", current);
			if (current) link.setAttribute("aria-current", "true");
			else link.removeAttribute("aria-current");
		}
	};
	const syncVisibility = () => {
		let visible = 0;
		for (const link of links) {
			const target = targetFor(link);
			const hidden = !target || target.hidden || target.closest("[hidden]") !== null;
			const row = link.closest<HTMLElement>(".praxity-toc-tick-wrap");
			if (row) row.hidden = hidden;
			if (!hidden) visible += 1;
		}
		toc.hidden = visible < 2;
		const current = links.find((link) => link.getAttribute("aria-current") === "true");
		if (!current || current.closest<HTMLElement>(".praxity-toc-tick-wrap")?.hidden) {
			const first = links.find(
				(link) => !link.closest<HTMLElement>(".praxity-toc-tick-wrap")?.hidden,
			);
			if (first) setActive(first);
		}
	};
	for (const link of links) {
		const preview = link.parentElement?.querySelector<HTMLElement>("[data-toc-preview]");
		const showPreview = () => {
			if (preview) preview.hidden = false;
		};
		const hidePreview = () => {
			if (preview) preview.hidden = true;
		};
		on(link, "mouseenter", showPreview);
		on(link, "mouseleave", hidePreview);
		on(link, "focus", showPreview);
		on(link, "blur", hidePreview);
		on(link, "click", (event) => {
			const block = targetFor(link);
			const target = block?.querySelector<HTMLElement>("h2,h3") ?? block;
			if (!target) return;
			event.preventDefault();
			if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
			target.focus({ preventScroll: true });
			scrollElementIntoView(target, { block: "start" });
			setActive(link);
		});
	}
	if (typeof IntersectionObserver !== "undefined") {
		releaseObserver = observeSelfCheckLifetime((current) => {
			const byTarget = new Map<Element, HTMLAnchorElement>();
			const observer = createSelfCheckIntersectionObserver(
				current,
				(entries) => {
					if (!current() || listeners.signal.aborted) return;
					const visible = entries
						.filter((entry) => entry.isIntersecting)
						.sort(
							(a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top),
						)[0];
					const link = visible ? byTarget.get(visible.target) : undefined;
					if (link) setActive(link);
				},
				{ rootMargin: "-10% 0px -60% 0px" },
			);
			for (const link of links) {
				const target = targetFor(link)?.querySelector<HTMLElement>("h2,h3");
				if (!target) continue;
				byTarget.set(target, link);
				observer.observe(target);
			}
			return () => observer.disconnect();
		});
	}
	syncVisibility();
	let frame: number | undefined;
	let epoch = 0;
	const cancelFrame = () => {
		++epoch;
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
	};
	on(window, "pagehide", cancelFrame);
	on(document, "praxity:self-check-owner", cancelFrame);
	on(document, "praxity:block-interaction", (event) => {
		const current = selfCheckEpochTicket(document, event);
		if (!current()) return;
		cancelFrame();
		const generation = epoch;
		frame = requestSelfCheckFrame(() => {
			if (listeners.signal.aborted || generation !== epoch || !current()) return;
			frame = undefined;
			syncVisibility();
		}, current);
	});
	on(window, "praxity:active-page-change", syncVisibility);
	return () => {
		cancelFrame();
		listeners.abort();
		releaseObserver?.();
	};
}
