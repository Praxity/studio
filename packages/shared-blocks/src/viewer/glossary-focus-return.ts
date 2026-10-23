import {
	requestSelfCheckFrame,
	selfCheckEpochTicket,
	setSelfCheckTimeout,
} from "../self-check-consumers";

declare global {
	interface Window {
		__praxityCancelGlossaryFocusReturn?: () => void;
	}
}

/** Native new tabs do not consistently restore the originating link in Firefox. */
export function rememberGlossaryFocusReturn(link: HTMLAnchorElement, term?: HTMLElement): void {
	// Shell and tooltip are separate bundles; the last activation owns the return.
	window.__praxityCancelGlossaryFocusReturn?.();
	let frame: number | undefined;
	let timer: ReturnType<typeof setSelfCheckTimeout> | undefined;
	let restoring = false;
	const current = selfCheckEpochTicket(link.ownerDocument);
	const visible = (element: HTMLElement | undefined): element is HTMLElement =>
		!!element?.isConnected &&
		!element.closest('[hidden], [inert], [aria-hidden="true"]') &&
		element.getClientRects().length > 0 &&
		getComputedStyle(element).visibility === "visible";
	const restore = () => {
		if (document.visibilityState === "hidden") return;
		if (document.activeElement !== document.body) return;
		const target = visible(link) ? link : visible(term) ? term : undefined;
		restoring = true;
		target?.focus({ preventScroll: true });
		restoring = false;
	};
	const clearPending = () => {
		if (frame !== undefined) cancelAnimationFrame(frame);
		if (timer !== undefined) clearTimeout(timer);
	};
	const onReturn = () => {
		if (!current() || restoring || document.visibilityState === "hidden") return;
		// Popover focus changes before the tab return must not consume the request.
		document.addEventListener("focusin", onReturn);
		clearPending();
		frame = requestSelfCheckFrame(() => {
			frame = undefined;
			restore();
			// Firefox can reset focus to BODY after the window's return events.
			timer = setSelfCheckTimeout(
				() => {
					timer = undefined;
					if (document.visibilityState === "hidden") return;
					restore();
					if (current()) window.__praxityCancelGlossaryFocusReturn?.();
				},
				0,
				current,
			);
		}, current);
	};
	window.__praxityCancelGlossaryFocusReturn = () => {
		clearPending();
		window.removeEventListener("focus", onReturn);
		window.removeEventListener("pageshow", onReturn);
		document.removeEventListener("visibilitychange", onReturn);
		document.removeEventListener("focusin", onReturn);
		window.__praxityCancelGlossaryFocusReturn = undefined;
	};
	window.addEventListener("focus", onReturn);
	window.addEventListener("pageshow", onReturn);
	document.addEventListener("visibilitychange", onReturn);
}
