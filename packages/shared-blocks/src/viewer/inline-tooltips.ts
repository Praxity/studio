import {
	createSelfCheckMutationObserver,
	observeSelfCheckLifetime,
	requestSelfCheckFrame,
	selfCheckEpochTicket,
	setSelfCheckTimeout,
} from "../self-check-consumers";

("use client");

import { externalLinkIndicatorHtml } from "../lib/external-link-utils";
import { rememberGlossaryFocusReturn } from "./glossary-focus-return";

/**
 * Toggletip behaviour for `[term]{definition}` triggers.
 *
 * Shared by the desktop viewer and the published tooltip island. Whichever
 * consumer initialises first claims the page, so nested renderers never bind the
 * document listeners twice.
 */

const BOUND_FLAG = "__praxityInlineTooltips";
const HIDE_DELAY_MS = 200;
const HOVER_DELAY_MS = 300;
const ALLOWED_CONTENT_TAGS = new Set([
	"A",
	"B",
	"BLOCKQUOTE",
	"BR",
	"CODE",
	"DD",
	"DEL",
	"DL",
	"DT",
	"EM",
	"I",
	"INS",
	"KBD",
	"LI",
	"MARK",
	"OL",
	"P",
	"S",
	"SAMP",
	"SMALL",
	"SPAN",
	"STRONG",
	"SUB",
	"SUP",
	"U",
	"UL",
]);
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

declare global {
	interface Window {
		__praxityInlineTooltips?: boolean;
	}
}

function isTriggerButton(el: Element): boolean {
	return el.matches("button,[role='button']");
}

function sanitizeTooltipHtml(raw: string, newTabText: string): string {
	const parsed = new DOMParser().parseFromString(raw, "text/html");
	for (const element of [...parsed.body.querySelectorAll("*")]) {
		if (!ALLOWED_CONTENT_TAGS.has(element.tagName)) {
			element.replaceWith(...element.childNodes);
			continue;
		}
		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			const allowed =
				name === "class" ||
				name === "dir" ||
				name === "lang" ||
				name === "title" ||
				(element.tagName === "A" && ["href", "rel", "target"].includes(name));
			if (!allowed) element.removeAttribute(attribute.name);
		}
		if (element instanceof HTMLAnchorElement) {
			const href = element.getAttribute("href");
			if (href && !href.startsWith("#")) {
				try {
					const url = new URL(href, document.baseURI);
					if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) element.removeAttribute("href");
				} catch {
					element.removeAttribute("href");
				}
			}
			if (element.target === "_blank") element.rel = "noopener noreferrer";
			else element.removeAttribute("target");
		}
	}
	// Add owned markup after the allowlist, using the sanitized DOM's real targets.
	for (const link of parsed.body.querySelectorAll('a[target="_blank"]')) {
		link.insertAdjacentHTML("beforeend", externalLinkIndicatorHtml(newTabText));
		link.lastElementChild?.setAttribute("lang", document.documentElement.lang);
	}
	return parsed.body.innerHTML;
}

/**
 * Bind toggletips for the whole document. Returns a cleanup that unbinds and
 * releases the page, so a viewer unmount does not leave the flag set.
 */
export function initInlineTooltips(
	definitionCue: string,
	newTabText: string,
	glossary?: { href: string; label: string },
): () => void {
	if (typeof window === "undefined" || typeof document === "undefined") return () => {};
	if (window[BOUND_FLAG]) return () => {};
	window[BOUND_FLAG] = true;

	let openTrigger: HTMLElement | null = null;
	let openPopover: HTMLElement | null = null;
	let hoverTimer: ReturnType<typeof setSelfCheckTimeout> | null = null;
	let hideTimer: ReturnType<typeof setSelfCheckTimeout> | null = null;
	let popoverId = 0;
	let pinned = false;

	const clearTimers = () => {
		if (hoverTimer) clearTimeout(hoverTimer);
		if (hideTimer) clearTimeout(hideTimer);
		hoverTimer = null;
		hideTimer = null;
	};

	const hide = (restoreFocus: boolean) => {
		clearTimers();
		const popover = openPopover;
		const trigger = openTrigger;
		// Removing a focused popover fires focusout synchronously in Chromium.
		// Clear ownership before removal so dismissal cannot re-enter and lose the trigger.
		openTrigger = null;
		openPopover = null;
		pinned = false;
		if (popover) {
			popover.inert = true;
			popover.setAttribute("aria-hidden", "true");
			popover.removeAttribute("data-visible");
			popover.remove();
		}
		if (trigger) {
			trigger.setAttribute("aria-expanded", "false");
			trigger.removeAttribute("aria-controls");
			trigger.removeAttribute("aria-describedby");
			if (restoreFocus) trigger.focus();
		}
	};

	const scheduleHide = () => {
		if (pinned) return;
		if (hideTimer) return;
		hideTimer = setSelfCheckTimeout(() => hide(false), HIDE_DELAY_MS, selfCheckEpochTicket());
	};

	const show = (trigger: HTMLElement, pin = false) => {
		hide(false);
		pinned = pin;
		const popover = document.createElement("div");
		popover.id = `prx-tooltip-${++popoverId}`;
		popover.className = "inline-tooltip-popover praxity-floating-layer";
		// Definitions can scroll at large text sizes; keyboard users need access.
		popover.tabIndex = 0;
		popover.setAttribute("role", "definition");
		// The named popover describes the term; its text describes the trigger.
		// Referring to the popover itself exposes its aria-labelledby name instead.
		const definition = document.createElement("div");
		definition.id = `${popover.id}-definition`;
		// Only authored content retains the term's language; the action uses the UI language.
		definition.lang =
			trigger.closest("[lang]")?.getAttribute("lang") ?? document.documentElement.lang;
		definition.innerHTML = sanitizeTooltipHtml(
			trigger.getAttribute("data-tooltip-content") ?? "",
			newTabText,
		);
		popover.appendChild(definition);
		if (glossary) {
			const link = document.createElement("a");
			link.href = glossary.href;
			link.textContent = glossary.label;
			link.target = "_blank";
			link.rel = "noopener";
			link.insertAdjacentHTML("beforeend", ` ${externalLinkIndicatorHtml(newTabText)}`);
			link.className = "praxity-glossary-link";
			link.addEventListener("click", () => rememberGlossaryFocusReturn(link, trigger));
			popover.appendChild(link);
		}
		document.body.appendChild(popover);
		if (!trigger.id) trigger.id = `prx-tooltip-trigger-${popoverId}`;
		popover.setAttribute("aria-labelledby", trigger.id);
		trigger.setAttribute("aria-controls", popover.id);
		trigger.setAttribute("aria-describedby", definition.id);

		// Position above the trigger, flipping below when it would clip the top edge.
		const rect = trigger.getBoundingClientRect();
		const margin = 8;
		const arrow = 6;
		let top = rect.top - popover.offsetHeight - arrow + window.scrollY;
		if (top - window.scrollY < margin) {
			top = rect.bottom + arrow + window.scrollY;
			popover.setAttribute("data-placement", "bottom");
		}
		const maxLeft = window.innerWidth - popover.offsetWidth - margin + window.scrollX;
		const left = Math.min(
			Math.max(
				rect.left + rect.width / 2 - popover.offsetWidth / 2 + window.scrollX,
				margin + window.scrollX,
			),
			maxLeft,
		);
		popover.style.top = `${top}px`;
		popover.style.left = `${left}px`;

		requestSelfCheckFrame(() => {
			if (openPopover === popover) popover.setAttribute("data-visible", "");
		}, selfCheckEpochTicket());
		trigger.setAttribute("aria-expanded", "true");
		openTrigger = trigger;
		openPopover = popover;

		popover.addEventListener("mouseenter", clearTimers);
		popover.addEventListener("mouseleave", scheduleHide);
	};

	const toggle = (trigger: HTMLElement) => {
		clearTimers();
		if (openTrigger === trigger && pinned) hide(false);
		else show(trigger, true);
	};

	const closestTrigger = (target: EventTarget | null): HTMLElement | null =>
		target instanceof Element
			? (target.closest<HTMLElement>("[data-tooltip-content]") ?? null)
			: null;

	// Click binds to each trigger, not to body: Chromium exposes an element with a
	// click listener as clickable, and every descendant inherits that, so NVDA said
	// "clickable" before ordinary course content. Keyboard and hover stay delegated.
	const onTriggerClick = (event: MouseEvent) => {
		const trigger = event.currentTarget;
		if (!(trigger instanceof HTMLElement) || !isTriggerButton(trigger)) return;
		event.preventDefault();
		toggle(trigger);
	};

	/** A bare span is not operable; give it button semantics unless it already has some. */
	const ensureAria = (el: Element) => {
		el.setAttribute("data-tooltip-enhanced", "");
		(el as HTMLElement).addEventListener("click", onTriggerClick);
		if (!el.querySelector(":scope > .praxity-definition-cue")) {
			const cue = document.createElement("span");
			cue.className = "praxity-sr-only praxity-definition-cue";
			cue.textContent = ` ${definitionCue}`;
			el.appendChild(cue);
		}
		if (!el.matches("a[href],button,input,select,textarea,summary")) {
			el.setAttribute("tabindex", "0");
			el.setAttribute("role", "button");
			el.setAttribute("aria-expanded", "false");
		}
	};

	for (const el of document.querySelectorAll("[data-tooltip-content]")) ensureAria(el);

	// The viewer re-renders content after this runs, so watch for later triggers.
	const releaseObserver = observeSelfCheckLifetime((current) => {
		const observer = createSelfCheckMutationObserver(current, (mutations) => {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (!(node instanceof Element)) continue;
					if (node.hasAttribute("data-tooltip-content")) ensureAria(node);
					for (const nested of node.querySelectorAll("[data-tooltip-content]")) ensureAria(nested);
				}
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		return () => observer.disconnect();
	});

	// Outside dismissal uses pointerdown, which Chromium does not treat as a click action.
	const onPointerDown = (event: PointerEvent) => {
		if (!openPopover || closestTrigger(event.target)) return;
		if (!(event.target as Element)?.closest?.(".inline-tooltip-popover")) hide(false);
	};

	const onKeyDown = (event: KeyboardEvent) => {
		const trigger = closestTrigger(event.target);
		if (event.key === "Tab" && !event.shiftKey && trigger === openTrigger && openPopover) {
			event.preventDefault();
			clearTimers();
			(openPopover.querySelector<HTMLElement>("a[href]") ?? openPopover).focus();
			return;
		}
		if (trigger && isTriggerButton(trigger) && (event.key === "Enter" || event.key === " ")) {
			event.preventDefault();
			toggle(trigger);
			return;
		}
		if (event.key === "Escape" && openPopover) {
			event.preventDefault();
			hide(true);
		}
	};

	const onFocusIn = (event: FocusEvent) => {
		const trigger = closestTrigger(event.target);
		if (trigger && !isTriggerButton(trigger)) show(trigger);
	};

	const onFocusOut = (event: FocusEvent) => {
		const trigger = closestTrigger(event.target);
		const next = event.relatedTarget;
		if (
			openPopover?.contains(event.target as Node) &&
			next !== openTrigger &&
			!(next instanceof Node && openPopover.contains(next))
		) {
			hide(false);
			return;
		}
		if (trigger && !(next instanceof Element && next.closest(".inline-tooltip-popover"))) {
			scheduleHide();
		}
	};

	const onMouseOver = (event: MouseEvent) => {
		const trigger = closestTrigger(event.target);
		if (!trigger || openTrigger === trigger) return;
		clearTimers();
		hoverTimer = setSelfCheckTimeout(() => show(trigger), HOVER_DELAY_MS, selfCheckEpochTicket());
	};

	const onMouseOut = (event: MouseEvent) => {
		const trigger = closestTrigger(event.target);
		if (!trigger) return;
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = null;
		if (openTrigger === trigger) scheduleHide();
	};

	const body = document.body;
	document.addEventListener("pointerdown", onPointerDown);
	body.addEventListener("keydown", onKeyDown);
	body.addEventListener("focusin", onFocusIn);
	body.addEventListener("focusout", onFocusOut);
	body.addEventListener("mouseover", onMouseOver);
	body.addEventListener("mouseout", onMouseOut);

	return () => {
		hide(false);
		releaseObserver();
		document.querySelectorAll<HTMLElement>("[data-tooltip-enhanced]").forEach((element) => {
			element.removeEventListener("click", onTriggerClick);
			element.removeAttribute("data-tooltip-enhanced");
		});
		document.removeEventListener("pointerdown", onPointerDown);
		body.removeEventListener("keydown", onKeyDown);
		body.removeEventListener("focusin", onFocusIn);
		body.removeEventListener("focusout", onFocusOut);
		body.removeEventListener("mouseover", onMouseOver);
		body.removeEventListener("mouseout", onMouseOut);
		window[BOUND_FLAG] = false;
	};
}
