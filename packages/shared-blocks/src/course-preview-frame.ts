import {
	COURSE_PREVIEW_PROTOCOL_VERSION,
	type CoursePreviewEvent,
	type CoursePreviewIdentity,
	type CoursePreviewInspectionOffer,
	isCoursePreviewCommand,
	isSafeExternalUrl,
	readCoursePreviewChannel,
	readCoursePreviewParentOrigin,
} from "./course-preview-protocol";

type EventBody<T extends CoursePreviewEvent> = T extends unknown
	? Omit<T, "source" | "version" | keyof CoursePreviewIdentity>
	: never;
type CoursePreviewEventBody = EventBody<CoursePreviewEvent>;

const TABBABLE_SELECTOR = [
	"a[href]",
	"area[href]",
	"button:not([disabled])",
	"input:not([disabled]):not([type='hidden'])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"iframe",
	"[tabindex]:not([tabindex='-1'])",
	"[contenteditable]:not([contenteditable='false'])",
	"audio[controls]",
	"video[controls]",
	"summary",
].join(",");

export function tabbableElements(doc: Document): HTMLElement[] {
	const elements = [...doc.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)].filter((element) => {
		if (element.tabIndex < 0 || element.closest("[hidden],[inert],[aria-hidden='true']"))
			return false;
		const styles = doc.defaultView?.getComputedStyle(element);
		return (
			styles?.display !== "none" &&
			styles?.visibility !== "hidden" &&
			(typeof element.checkVisibility !== "function" || element.checkVisibility())
		);
	});
	return elements.filter((element) => {
		const radio = element.tagName === "INPUT" ? (element as HTMLInputElement) : null;
		if (radio?.type !== "radio" || !radio.name) {
			return true;
		}
		const group = elements.filter((candidate): candidate is HTMLInputElement => {
			if (candidate.tagName !== "INPUT") return false;
			const input = candidate as HTMLInputElement;
			return input.type === "radio" && input.name === radio.name && input.form === radio.form;
		});
		return radio === (group.find((candidate) => candidate.checked) ?? group[0]);
	});
}

/**
 * The host asks for an edge whenever Tab enters the frame. A stop the browser chose for this
 * entry stays. WebKit chooses none when Tab skips links: it focuses the document instead.
 */
export function frameEdgeFocus(win: Window): (edge: "first" | "last") => void {
	const doc = win.document;
	let browserStop = false;
	// The window's focus event precedes the focus of any element in the same entry.
	win.addEventListener("focus", () => {
		browserStop = false;
	});
	doc.addEventListener("focusin", () => {
		browserStop = true;
	});
	return (edge) => {
		if (browserStop && doc.activeElement !== doc.body) return;
		const tabbable = tabbableElements(doc);
		(edge === "first" ? tabbable[0] : tabbable.at(-1))?.focus();
	};
}

/** Keys the editor takes over from a preview frame. Cancels the ones it handles itself. */
export function coursePreviewKeyEvent(
	event: KeyboardEvent,
	doc: Document,
): Extract<
	CoursePreviewEventBody,
	{ event: "escape" | "focus-boundary" | "author-bypass" }
> | null {
	if (event.key === "Escape") {
		return !event.defaultPrevented && !doc.fullscreenElement ? { event: "escape" } : null;
	}
	if (
		event.key === "Tab" &&
		!event.defaultPrevented &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey
	) {
		const tabbable = tabbableElements(doc);
		const atBoundary = event.shiftKey
			? doc.activeElement === tabbable[0]
			: doc.activeElement === tabbable.at(-1);
		if (!atBoundary) return null;
		event.preventDefault();
		return { event: "focus-boundary", direction: event.shiftKey ? "backward" : "forward" };
	}
	if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null;
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return null;
	const target = event.target as Element | null;
	if (
		typeof target?.closest === "function" &&
		target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false'])")
	) {
		return null;
	}
	event.preventDefault();
	return { event: "author-bypass", direction: event.key === "ArrowLeft" ? "previous" : "next" };
}

export function renderLogicAnnotations(enabled: boolean, doc: Document = document): void {
	doc.querySelectorAll("[data-praxity-preview-logic]").forEach((node) => node.remove());
	if (!enabled) return;

	let config: Record<string, unknown> = {};
	try {
		config = JSON.parse(doc.getElementById("praxity-config")?.textContent ?? "{}") as Record<
			string,
			unknown
		>;
	} catch {
		return;
	}
	const logic = config.logic as { rules?: unknown } | undefined;
	if (!Array.isArray(logic?.rules)) return;
	const configuredStrings =
		config.strings && typeof config.strings === "object" && !Array.isArray(config.strings)
			? (config.strings as Record<string, unknown>)
			: {};
	const message = (key: string) =>
		typeof configuredStrings[key] === "string" ? configuredStrings[key] : "";
	const logicAuthoringOverlay = message("logicAuthoringOverlay");
	const logicCondition = message("logicCondition");
	const logicConditions = message("logicConditions");
	const logicAction = message("logicAction");
	const logicActions = message("logicActions");

	for (const candidate of logic.rules) {
		if (!candidate || typeof candidate !== "object") continue;
		const rule = candidate as Record<string, unknown>;
		if (typeof rule.blockId !== "string") continue;
		const root = doc.getElementById(`block-${rule.blockId}`);
		if (!root || root.querySelector("[data-praxity-preview-logic]")) continue;
		const conditions = rule.conditions as { rules?: unknown } | undefined;
		const conditionCount = Array.isArray(conditions?.rules) ? conditions.rules.length : 0;
		const actionCount = Array.isArray(rule.actions) ? rule.actions.length : 0;
		const note = doc.createElement("aside");
		note.className = "praxity-logic-overlay";
		note.dataset.praxityPreviewLogic = "";
		note.setAttribute("role", "note");
		note.setAttribute("aria-label", logicAuthoringOverlay);
		const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
		icon.setAttribute("aria-hidden", "true");
		icon.setAttribute("viewBox", "0 0 24 24");
		icon.setAttribute("width", "20");
		icon.setAttribute("height", "20");
		icon.innerHTML =
			'<path d="M6 3v6m0 6v6m12-18v6m0 6v6M6 9h12M6 15h12" fill="none" stroke="currentColor" stroke-width="1.5"/>';
		const text = doc.createElement("span");
		const heading = doc.createElement("strong");
		heading.textContent = logicAuthoringOverlay;
		const summary = doc.createElement("span");
		summary.textContent = `${conditionCount} ${conditionCount === 1 ? logicCondition : logicConditions} → ${actionCount} ${actionCount === 1 ? logicAction : logicActions}`;
		text.append(heading, summary);
		note.append(icon, text);
		root.append(note);
	}
}

const XLINK = "http://www.w3.org/1999/xlink";

/**
 * The Page lens runtime: the only script an inspection response runs, under its nonce.
 * It owns every course-preview duty there. The lens never navigates itself: the host
 * remounts any page a link asks for, so no learner document can load in the lens.
 */
export function startInspectionPreview(
	win: Window,
	onConnect?: (identity: CoursePreviewIdentity, parentOrigin: string) => void,
): boolean {
	const doc = win.document;
	const channel = readCoursePreviewChannel(win.location.search);
	const parentOrigin = readCoursePreviewParentOrigin(win.location.search);
	if (!channel || !parentOrigin || win.parent === win) return false;
	const ports = new MessageChannel();
	const port = ports.port1;
	let identity: CoursePreviewIdentity | null = null;
	const focusEdge = frameEdgeFocus(win);
	const send = (body: CoursePreviewEventBody) => {
		if (identity)
			port.postMessage({
				source: "praxity-course",
				version: COURSE_PREVIEW_PROTOCOL_VERSION,
				...body,
				...identity,
			});
	};
	port.onmessage = ({ data }: MessageEvent<unknown>) => {
		if (!identity) {
			// Only the host holds the other end of this port, so the page it names is authoritative.
			const named = (data ?? {}) as Partial<Record<keyof CoursePreviewIdentity, unknown>>;
			const expected = {
				channel,
				courseId: String(named.courseId),
				revision: String(named.revision),
				pageId: String(named.pageId),
			};
			if (!isCoursePreviewCommand(data, expected) || data.action !== "connect") return;
			identity = expected;
			send({ event: "connected" });
			onConnect?.(identity, parentOrigin);
			return;
		}
		if (!isCoursePreviewCommand(data, identity)) return;
		if (data.action === "restore") {
			const ready = () => send({ event: "ready", mode: "inspection" });
			if (doc.readyState === "loading")
				doc.addEventListener("DOMContentLoaded", ready, { once: true });
			else ready();
		} else if (data.action === "logic") renderLogicAnnotations(data.enabled, doc);
		else if (data.action === "focus") focusEdge(data.edge);
	};
	port.start();
	win.addEventListener("keydown", (event) => {
		const body = coursePreviewKeyEvent(event, doc);
		if (body) send(body);
	});
	const isLink = (node: Element) =>
		(node.localName === "a" || node.localName === "area") &&
		(node.hasAttribute("href") || node.hasAttributeNS(XLINK, "href"));
	const follow = (event: MouseEvent) => {
		let link: Element | undefined;
		for (const node of event.composedPath()) {
			if (!(node instanceof Element)) continue;
			if (isLink(node)) {
				link = node;
				break;
			}
			// A <use> instance is a closed shadow tree, so a cloned link retargets its click to
			// <use>. Never resolve the reference (chained, percent-encoded and SMIL-animated ones
			// all differ from the attribute): cancel, and send only a light-DOM link to the host.
			if (node.localName === "use") event.preventDefault();
		}
		if (!link) return;
		event.preventDefault();
		if (event.type !== "click") return;
		let url: URL;
		try {
			url = new URL(
				link.getAttribute("href") ?? link.getAttributeNS(XLINK, "href") ?? "",
				doc.baseURI,
			);
		} catch {
			return;
		}
		const [target, ...fragment] = url.href.split("#");
		if (fragment.length > 0 && target === win.location.href.split("#")[0]) {
			// Skip links and contents links move focus here, without navigating: WebKit fires the
			// frame's load event for a fragment navigation, and the host remounts on a second load.
			// Like the browser, try the fragment as written, then percent-decoded (`#café` is
			// `#caf%C3%A9` here). Malformed encoding matches nothing.
			const raw = url.hash.slice(1);
			let element = doc.getElementById(raw);
			try {
				element ??= doc.getElementById(decodeURIComponent(raw));
			} catch {}
			if (element && !element.hasAttribute("tabindex") && element.tabIndex < 0)
				element.tabIndex = -1;
			element?.focus();
			return;
		}
		if (url.protocol === win.location.protocol && url.host === win.location.host) {
			if (url.pathname.endsWith(".html")) send({ event: "navigate", state: "", url: url.href });
		} else if (isSafeExternalUrl(url.href)) send({ event: "open-external", url: url.href });
	};
	// Capture runs before any target listener. Middle clicks and keyboard activation dispatch these too.
	doc.addEventListener("click", follow, true);
	doc.addEventListener("auxclick", follow, true);
	win.addEventListener("pagehide", () => port.close(), { once: true });
	const offer: CoursePreviewInspectionOffer = {
		source: "praxity-course",
		version: COURSE_PREVIEW_PROTOCOL_VERSION,
		event: "inspect",
		channel,
	};
	win.parent.postMessage(offer, parentOrigin === "null" ? "*" : parentOrigin, [ports.port2]);
	return true;
}
