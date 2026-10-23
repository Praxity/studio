/// <reference path="../types/raw-css.d.ts" />

import { colorToHex, luminance } from "@praxity/shared-blocks/color-math";
import type { PreviewHtmlFragment } from "@praxity/shared-blocks/course-preview-protocol";
import {
	INSPECTION_INVOKER_ATTRIBUTES,
	stripInspectionMarkup,
} from "@praxity/shared-blocks/inspection-markup";
import { renderFeedback as englishFeedback } from "../messages/en.json";
import { renderFeedback as frenchFeedback } from "../messages/fr.json";
import {
	type EditorShortcutHandlers,
	findEditorShortcut,
	invokeEditorShortcut,
} from "../shortcuts/registry";
import type { FrameShortcutAction } from "../shortcuts/session-commands";
import tokenSheet from "../styles/editor-tokens.css?raw";
import { createEscapeDispatcher } from "./escape";
import {
	isEditorElementAvailable,
	measureOrigins,
	observeGeometry,
	positionFixed,
} from "./geometry";
import { listenEditorInput } from "./listeners";
import type { RenderFeedback } from "./patch";
import {
	type FrameEventBody,
	type FrameFocus,
	type FrameFocusOptions,
	type FrameNode,
	type FrameView,
	isFrameView,
} from "./protocol";
import { mountSourceField, sourceFieldGuardCss } from "./source-field";

const LEARNER_CONTROLS =
	'a[href],button,input,select,textarea,summary,iframe,embed,object,[role="button"],[tabindex],[contenteditable],audio[controls],video[controls]';
// Carousel and flip controls do nothing without course scripts, and laid-open
// slides would otherwise expose them; they still occupy the page (V5).
const LEARNER_ONLY = ".praxity-card-controls,[data-card-flip]";
let lensNumber = 0;
const MIN_INSPECTION_GUTTER = 60;

interface HandleBox {
	left: number;
	top: number;
	size: number;
}
/**
 * Handles never overlap, and keep WCAG 2.5.8 spacing: a 24px circle centred on
 * either handle misses the other's box, and two undersized (item) handles'
 * circles miss each other. Touching 24px handles pass; the 390px gutter has no
 * room for a gap.
 */
function crowds(a: HandleBox, b: HandleBox) {
	const reach = (from: HandleBox, to: HandleBox) =>
		Math.hypot(
			Math.max(
				to.left - from.left - from.size / 2,
				0,
				from.left + from.size / 2 - to.left - to.size,
			),
			Math.max(to.top - from.top - from.size / 2, 0, from.top + from.size / 2 - to.top - to.size),
		);
	const centres = Math.hypot(
		a.left + a.size / 2 - b.left - b.size / 2,
		a.top + a.size / 2 - b.top - b.size / 2,
	);
	const overlap =
		a.left < b.left + b.size &&
		b.left < a.left + a.size &&
		a.top < b.top + b.size &&
		b.top < a.top + a.size;
	return (
		overlap || reach(a, b) < 12 || reach(b, a) < 12 || (a.size < 24 && b.size < 24 && centres < 24)
	);
}

/** DOM adapter for the controller view. refresh is the P3 patch/remount boundary. */
export function mountPageLens(options: {
	document: Document;
	view: FrameView;
	onEvent: (event: FrameEventBody) => void;
	presenting?: boolean;
}) {
	const { document: doc } = options;
	const onEvent = (event: FrameEventBody) => {
		if (
			event.event === "escape" ||
			event.event === "sourceAction" ||
			event.event === "select" ||
			event.event === "intent"
		) {
			const finalInput = captureSource();
			options.onEvent(finalInput ? { ...event, finalInput } : event);
		} else options.onEvent(event);
	};
	const defaultView = doc.defaultView;
	if (!defaultView) throw new Error("Page lens needs a live document");
	const win = defaultView;
	if (new URL(win.location.href).searchParams.get("praxity-inspect") !== "1")
		throw new Error("Page lens requires inspection mode");
	let view = options.view;
	if (!isFrameView(view)) throw new Error("Invalid frame view");
	// A read-only page view (preview inspection) receives patches and feedback only.
	// It keeps the learner's Tab stops, clicks and served hidden state; it has no handles.
	const readOnly = view.readOnly === true;
	// Unpredictable per mount: a course element with a guessed id placed earlier in the
	// document would win the handle's aria-describedby and rewrite what AT reads. The
	// renderer's own ids (praxity-ag-question-…, praxity-config) stay untouched.
	const nonce = [...win.crypto.getRandomValues(new Uint32Array(2))]
		.map((n) => n.toString(36))
		.join("");
	const prefix = `praxity-lens-${nonce}-${++lensNumber}`;
	const handles = new Map<string, HTMLButtonElement>();
	const admittedFragments = new Map<string, HTMLElement>();
	let orderedIds: Set<string> | null = null;
	const regionHtml = new Map<string, string>();
	const regionElements = new WeakSet<Node>();
	const badges = new Map<string, HTMLElement>();
	let failureBanner: HTMLElement | null = null;
	let failureDescription = "";
	const ownedChrome = new WeakSet<Element>();
	const controls = new WeakMap<HTMLElement, FrameFocus>();
	const controlRefs = new Set<WeakRef<HTMLElement>>();
	const indexedControls = new WeakSet<HTMLElement>();
	const inputRoots = new Map<ShadowRoot, (() => void)[]>();
	let sourceField: ReturnType<typeof mountSourceField> | undefined;
	let sourceDraftId: string | undefined;
	let sourceNodeId: string | undefined;
	let sourceText = "";
	let sourceSelection: readonly [number, number] = [0, 0];
	const retiredChrome = new Set<HTMLElement>();
	const geometryProbes = new Map<Element | null, HTMLElement>();
	// Any frame node removal ends Chromium's typing group; close is the safe boundary.
	let deferredStructure: (() => string[])[] = [];
	function retireChrome(element: HTMLElement) {
		if (!sourceField) {
			element.remove();
			return;
		}
		if (retiredChrome.has(element)) return;
		retiredChrome.add(element);
		element.hidden = true;
		element.inert = true;
		element.setAttribute("aria-hidden", "true");
		element.tabIndex = -1;
		element.style.setProperty("display", "none", "important");
	}
	function restoreChrome(element: HTMLElement) {
		if (!retiredChrome.delete(element)) return;
		element.hidden = false;
		element.inert = false;
		element.removeAttribute("aria-hidden");
		element.style.removeProperty("display");
	}
	function feedbackText(element: HTMLElement, value: string) {
		const text = element.firstChild;
		if (!text) element.append(doc.createTextNode(value));
		else if (text.nodeValue !== value) text.nodeValue = value;
	}
	function chrome(element: Element): boolean {
		for (let current: Element | null = element; current; current = current.parentElement)
			if (ownedChrome.has(current)) return true;
		return false;
	}
	function controlOf(element: Element | null): HTMLElement | null {
		for (let current = element; current; current = current.parentElement)
			if (current instanceof win.HTMLElement && controls.has(current)) return current;
		return null;
	}
	let descriptionNumber = 0;
	const tabStops = new Map<HTMLElement, string | null>();
	const ownedAttributes = new Map<Element, Map<string, string | null>>();
	let observedFocus: FrameFocus | null = null;
	let observedControl: HTMLElement | null = null;
	let removedFocus: FrameFocus | null = null;
	const clearRemovedFocus = () => {
		removedFocus = null;
	};
	let disposed = false;
	let presenting = options.presenting ?? true;
	let presentationGeneration = 0;
	let latestFeedback: RenderFeedback | null = null;
	let scheduled = false;
	// Rendered node boxes from the last placement pass, for pointer hover.
	let hoverBoxes: { id: string; element: HTMLElement; box: DOMRect }[] = [];
	const bodyPadding = doc.body.style.paddingInlineStart;
	let gutterReserved = false;
	const style = doc.createElement("style");
	ownedChrome.add(style);
	style.dataset.praxityChrome = "style";
	style.textContent = tokenSheet + PAGE_LENS_CSS;
	doc.head.append(style);
	// F11: handles live in the top layer, above any course stacking context, overlay or
	// clipping ancestor, while staying beside their node in the DOM for reading and Tab
	// order. An engine without the Popover API keeps fixed-position handles.
	const topLayer = !readOnly && typeof win.HTMLElement.prototype.showPopover === "function";
	const hitClip = `--praxity-hit-clip-${nonce}`;
	const guard = doc.createElement("style");
	ownedChrome.add(guard);
	guard.dataset.praxityChrome = "style";
	guard.textContent = handleGuardCss(nonce);
	// First in tree order, so its layer precedes every course layer.
	if (!readOnly) doc.head.prepend(guard);
	function setOwned(element: Element, key: string, value: string | null) {
		let originals = ownedAttributes.get(element);
		if (!originals) {
			originals = new Map();
			ownedAttributes.set(element, originals);
		}
		if (!originals.has(key)) originals.set(key, element.getAttribute(key));
		if (element.getAttribute(key) === value) return;
		if (value === null) element.removeAttribute(key);
		else element.setAttribute(key, value);
	}
	function describeHandle(button: HTMLButtonElement | undefined, detail: string) {
		const text = button?.querySelector("span")?.firstChild;
		// Removing even an unrelated text node splits Chromium's native typing group.
		if (text && text.nodeValue !== detail) text.nodeValue = detail;
	}
	let chromeTheme: "light" | "dark" = "light";
	function syncChromeTheme() {
		// Transparent ancestors contribute no colour.
		const backgrounds = [doc.body, doc.documentElement].map(
			(el) => win.getComputedStyle(el).backgroundColor,
		);
		const background =
			backgrounds.find((colour) => colour !== "transparent" && colour !== "rgba(0, 0, 0, 0)") ??
			"rgb(255, 255, 255)";
		const channels = /^rgba?\(/u.test(background)
			? background
					.match(/[\d.]+/gu)
					?.slice(0, 3)
					.map(Number)
			: null;
		const hex =
			colorToHex(background) ??
			(channels?.length === 3
				? `#${channels.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`
				: null);
		if (!hex) throw new Error(`Unsupported page background: ${background}`);
		chromeTheme = luminance(hex) > 0.179 ? "light" : "dark";
		// Keep the spec's public marker; only the private marker selects chrome tokens.
		setOwned(doc.documentElement, "data-chrome", chromeTheme);
		setOwned(doc.documentElement, "data-praxity-chrome-theme", chromeTheme);
	}
	syncChromeTheme();
	// The private handshake can finish before an exported stylesheet loads in Gecko.
	win.addEventListener("load", syncChromeTheme);
	function elements(id: string, root: ParentNode = doc) {
		return [...root.querySelectorAll<HTMLElement>("[data-node-id]")].filter(
			(el) => !chrome(el) && el.dataset.nodeId === id,
		);
	}
	function admitFragment(id: string, element: HTMLElement) {
		const previous = admittedFragments.get(id);
		admittedFragments.set(id, element);
		// Only a patcher-admitted subtree can replace a retained descendant's identity.
		if (!previous) return;
		for (const [childId, child] of admittedFragments) {
			if (childId === id || !previous.contains(child)) continue;
			const matches = elements(childId, element);
			const replacement =
				matches.find((el) => el.dataset.blockId === childId) ??
				matches.find((el) => el.getAttribute("role") === "tab") ??
				matches[0];
			if (replacement) admittedFragments.set(childId, replacement);
		}
	}
	function fragmentElement(id: string): HTMLElement | undefined {
		const retained = admittedFragments.get(id);
		if (retained?.isConnected) return retained;
		if (id.startsWith("region:")) {
			const key = id.slice(7);
			const region =
				key === "deck-outline"
					? doc.getElementById("deck-outline")
					: key === "deck-top-bar"
						? doc.querySelector<HTMLElement>(".deck-top-bar")
						: key.startsWith("deck-reading:")
							? [...doc.querySelectorAll<HTMLElement>("[data-deck-reading]")].find(
									(el) => el.getAttribute("data-deck-reading") === key.slice(13),
								)
							: undefined;
			if (region) {
				admittedFragments.set(id, region);
				return region;
			}
			return undefined;
		}
		// Once admitted, authored mutation cannot redirect a patch to a duplicate marker.
		if (admittedFragments.has(id)) return undefined;
		const node = view.nodes.find((node) => node.id === id);
		const element = node
			? nodeElement(node, true)
			: (elements(id).find((el) => el.dataset.blockId === id) ?? elements(id)[0]);
		if (element) admittedFragments.set(id, element);
		return element;
	}
	function readFragment(fragment: PreviewHtmlFragment): HTMLElement | null {
		const template = doc.createElement("template");
		template.innerHTML = fragment.html;
		// Patches pass the same strip as the served inspection document.
		stripInspectionMarkup(template.content);
		const root = template.content.firstElementChild;
		if (!(root instanceof win.HTMLElement) || template.content.children.length !== 1) return null;
		if (!fragment.id.startsWith("region:") && root.dataset.nodeId !== fragment.id) return null;
		return root;
	}
	function orderFragments(
		order: string[],
		fragments: PreviewHtmlFragment[],
		held: ReadonlySet<string>,
	): string[] {
		for (const fragment of fragments)
			if (fragment.id.startsWith("region:")) regionHtml.set(fragment.id, fragment.html);
		if (order.some((id) => id.startsWith("region:")))
			return orderRegionFragments(order, fragments, held);
		const missing: string[] = [];
		const contentOrder = order.filter((id) => !id.startsWith("region:"));
		const wanted = new Set(contentOrder);
		const previousOrder = orderedIds ?? new Set(admittedFragments.keys());
		for (const [id, element] of admittedFragments) {
			if (id.startsWith("region:") || wanted.has(id) || held.has(id)) continue;
			if (!previousOrder.has(id)) continue;
			element.remove();
			handles.get(id)?.remove();
			admittedFragments.delete(id);
		}
		orderedIds = new Set([...wanted, ...held]);
		for (const [index, id] of contentOrder.entries()) {
			let element = fragmentElement(id);
			if (!element) {
				const fragment = fragments.find((fragment) => fragment.id === id);
				const next = fragment ? readFragment(fragment) : null;
				const neighbour =
					contentOrder
						.slice(index + 1)
						.map(fragmentElement)
						.find(Boolean) ??
					contentOrder.slice(0, index).reverse().map(fragmentElement).find(Boolean);
				if (!next) {
					missing.push(id);
					continue;
				}
				if (!neighbour) {
					const parent =
						doc.getElementById(view.pageId) ??
						doc.getElementById("main-content") ??
						doc.querySelector("main");
					if (!parent) {
						missing.push(id);
						continue;
					}
					parent.append(next);
				} else if (
					contentOrder.slice(index + 1).some((other) => fragmentElement(other) === neighbour)
				)
					neighbour.before(next);
				else neighbour.after(next);
				admitFragment(id, next);
				element = next;
			}
			const preceding = contentOrder
				.slice(0, index)
				.reverse()
				.map(fragmentElement)
				.find((peer) => peer?.parentElement === element?.parentElement);
			if (preceding && !(preceding.compareDocumentPosition(element) & 4)) preceding.after(element);
		}
		return missing;
	}
	function orderRegionFragments(
		order: string[],
		fragments: PreviewHtmlFragment[],
		held: ReadonlySet<string>,
	): string[] {
		const missing: string[] = [];
		const nodeIds = order.filter((id) => !id.startsWith("region:"));
		const previousOrder = orderedIds ?? new Set(admittedFragments.keys());
		const parent =
			doc.getElementById(view.pageId) ??
			doc.getElementById("main-content") ??
			doc.querySelector("main");
		if (!parent) return nodeIds;
		const template = doc.createElement("template");
		template.innerHTML = order
			.map((id) => {
				if (id.startsWith("region:")) {
					const html = regionHtml.get(id);
					if (html === undefined) missing.push(id);
					return html ?? "";
				}
				const placeholder = doc.createElement("template");
				placeholder.dataset.nodeId = id;
				return placeholder.outerHTML;
			})
			.join("");
		stripInspectionMarkup(template.content);
		if (missing.length) return missing;
		function structuralMatch(actual: Element, wanted: Element) {
			return (
				actual.tagName === wanted.tagName &&
				actual.id === wanted.id &&
				actual.className === wanted.className &&
				[...wanted.attributes]
					.filter((a) => a.name.startsWith("data-"))
					.every((a) => actual.getAttribute(a.name) === a.value)
			);
		}
		function arrange(actual: Element, desired: ParentNode, top = false) {
			const available = [...actual.childNodes];
			const chosen: Node[] = [];
			for (const wanted of [...desired.childNodes]) {
				if (wanted instanceof win.HTMLTemplateElement && wanted.dataset.nodeId) {
					const id = wanted.dataset.nodeId;
					let element = fragmentElement(id);
					if (!element) {
						const fragment = fragments.find((f) => f.id === id);
						element = fragment ? (readFragment(fragment) ?? undefined) : undefined;
						if (element) admitFragment(id, element);
					}
					if (!element) {
						missing.push(id);
						continue;
					}
					chosen.push(element);
					continue;
				}
				if (wanted instanceof win.HTMLElement) {
					const candidate = available.find(
						(node) =>
							node instanceof win.HTMLElement &&
							!chrome(node) &&
							!chosen.includes(node) &&
							!nodeIds.some((id) => admittedFragments.get(id) === node) &&
							structuralMatch(node, wanted),
					);
					const element =
						candidate instanceof win.HTMLElement
							? candidate
							: (wanted.cloneNode(false) as HTMLElement);
					regionElements.add(element);
					for (const attribute of [...wanted.attributes])
						if (element.getAttribute(attribute.name) !== attribute.value)
							element.setAttribute(attribute.name, attribute.value);
					arrange(element, wanted);
					chosen.push(element);
				} else {
					const existing = available.find(
						(node) =>
							node.nodeType === wanted.nodeType &&
							node.textContent === wanted.textContent &&
							!chosen.includes(node),
					);
					chosen.push(existing ?? wanted.cloneNode(true));
				}
			}
			const managed = (node: Node) =>
				regionElements.has(node) ||
				[...previousOrder].some((id) => {
					const element = admittedFragments.get(id);
					return (
						element === node ||
						(node instanceof win.HTMLElement && !!element && node.contains(element))
					);
				});
			for (const node of available) {
				if (node.parentNode !== actual) continue;
				if (chosen.includes(node) || (node instanceof win.HTMLElement && chrome(node))) continue;
				if (
					[...held].some((id) => {
						const element = admittedFragments.get(id);
						return !!element && node.contains(element);
					})
				)
					continue;
				if (!top || managed(node)) node.remove();
			}
			let anchor: ChildNode | null =
				[...actual.childNodes].find(
					(node) =>
						chosen.includes(node) || (!top && !(node instanceof win.HTMLElement && chrome(node))),
				) ?? null;
			for (const node of chosen) {
				if (node === anchor) anchor = anchor.nextSibling;
				else actual.insertBefore(node, anchor);
				while (anchor instanceof win.HTMLElement && chrome(anchor)) anchor = anchor.nextSibling;
			}
		}
		const layoutRoot = template.content.firstElementChild;
		// Deck order includes its slide boundary. Reconcile that boundary with
		// the existing slide rather than creating a nested, duplicate page ID.
		arrange(
			parent,
			layoutRoot?.id === parent.id && layoutRoot.tagName === parent.tagName
				? layoutRoot
				: template.content,
			true,
		);
		orderedIds = new Set([...nodeIds, ...held]);
		for (const key of regionHtml.keys()) if (!order.includes(key)) regionHtml.delete(key);
		return missing;
	}
	function nodeElement(node: FrameNode, rendered = false): HTMLElement | undefined {
		if (
			!rendered &&
			sourceNodeId === node.id &&
			sourceField?.slot.isConnected &&
			!sourceField.slot.hidden
		)
			return sourceField.slot;
		if (sourceNodeId === node.id && admittedFragments.has(node.id)) {
			const admitted = admittedFragments.get(node.id);
			return admitted?.isConnected ? admitted : undefined;
		}
		if (node.kind === "page") {
			const heading = doc.querySelector<HTMLElement>("h1.praxity-page-title,h1");
			if (heading) {
				setOwned(heading, "data-node-id", node.id);
				return heading;
			}
		}
		const matches = elements(node.id);
		return (
			matches.find((el) => el.dataset.blockId === node.id) ??
			matches.find((el) => el.getAttribute("role") === "tab") ??
			matches[0]
		);
	}
	// A display:contents node (a matching pair's row) has no box; its contents do.
	function boxOf(element: HTMLElement) {
		if (win.getComputedStyle(element).display !== "contents")
			return element.getBoundingClientRect();
		const range = doc.createRange();
		range.selectNodeContents(element);
		return range.getBoundingClientRect();
	}
	function visible(element: HTMLElement) {
		if (!isEditorElementAvailable(element)) return false;
		const box = boxOf(element);
		return box.width > 0 && box.height > 0;
	}
	function targetOf(element: Element | null): FrameFocus | null {
		const control = controlOf(element);
		const target = control ? controls.get(control) : undefined;
		if (!target || !view.nodes.some((node) => node.id === target.nodeId)) return null;
		return {
			...target,
			...(target.role === "source" && control instanceof win.HTMLTextAreaElement
				? { selection: [control.selectionStart, control.selectionEnd] as const }
				: {}),
		};
	}
	function focusControl(target: FrameFocus): HTMLElement | null {
		if (disposed || target.file !== view.file) return null;
		const control = liveControls()
			.filter(
				([el, focus]) =>
					el.isConnected &&
					el.getRootNode({ composed: true }) === doc &&
					el.matches("[data-focus-role][data-node-id]") &&
					focus.nodeId === target.nodeId &&
					focus.role === target.role,
			)
			.sort(([a], [b]) => (a.compareDocumentPosition(b) & 4 ? -1 : 1))[0]?.[0];
		return control && visible(control) ? control : null;
	}
	function hasNativeFocus(element: Element): boolean {
		const root = element.getRootNode();
		return root === doc
			? doc.activeElement === element
			: root instanceof win.ShadowRoot &&
					root.activeElement === element &&
					hasNativeFocus(root.host);
	}
	function activeElement() {
		return (
			liveControls()
				.map(([element]) => element)
				.find(hasNativeFocus) ?? doc.activeElement
		);
	}
	function liveControls(): [HTMLElement, FrameFocus][] {
		const live: [HTMLElement, FrameFocus][] = [];
		for (const ref of controlRefs) {
			const element = ref.deref();
			const target = element && controls.get(element);
			if (element?.isConnected && target) live.push([element, target]);
			else {
				controlRefs.delete(ref);
				// Detached controls still supply their final native caret during replacement.
				if (element) indexedControls.delete(element);
			}
		}
		for (const [root, removers] of inputRoots)
			if (!live.some(([element]) => element.getRootNode() === root)) {
				for (const remove of removers) remove();
				inputRoots.delete(root);
			}
		return live;
	}
	function focus(target: FrameFocus, options: FrameFocusOptions = {}): boolean {
		if (!presenting) return false;
		if (options.expect) {
			const active = activeElement();
			const here = targetOf(active) ?? (active === doc.body ? removedFocus : null);
			if (
				!doc.hasFocus() ||
				!here ||
				!options.expect.some((owner) => owner.file === here.file && owner.nodeId === here.nodeId)
			)
				return false;
		}
		const control = focusControl(target);
		if (!control) return false;
		// A settlement command can arrive after native focus moved, before its report reaches the host.
		if (options.preserveFocus && (!doc.hasFocus() || !hasNativeFocus(control))) return false;
		// A focused native field owns its caret; the host selection can lag typing.
		if (target.selection && control instanceof win.HTMLTextAreaElement && !hasNativeFocus(control))
			control.setSelectionRange(target.selection[0], target.selection[1]);
		// Gecko keeps focus on the frame body unless its browsing context owns
		// focus before an explicit cross-document control focus command.
		if (win !== win.top && !doc.hasFocus()) win.focus();
		if (!hasNativeFocus(control)) control.focus();
		const applied = hasNativeFocus(control);
		if (applied) removedFocus = null;
		return applied;
	}
	function reveal() {
		// Without course scripts, later card slides and conditional blocks keep their
		// hidden server form. Neither has a visible anchor for its handle, as a tab
		// does, so the lens lays them open to keep every handle in the Tab order (F1).
		for (const slide of doc.querySelectorAll<HTMLElement>("[data-slide-position]")) {
			if (chrome(slide)) continue;
			setOwned(slide, "data-slide-position", "active");
			setOwned(slide, "data-active", "true");
			setOwned(slide, "aria-hidden", null);
			setOwned(slide, "inert", null);
			// Slides share one grid cell; stack them instead. Record the original
			// inline style, then add to it so its custom properties survive.
			setOwned(slide, "style", slide.getAttribute("style"));
			if (slide.style.getPropertyValue("grid-area") !== "auto")
				slide.style.setProperty("grid-area", "auto");
		}
		for (const control of doc.querySelectorAll(LEARNER_ONLY))
			if (!chrome(control)) setOwned(control, "inert", "");
		for (const block of doc.querySelectorAll<HTMLElement>("[data-block-id][hidden]"))
			if (!chrome(block)) setOwned(block, "hidden", null);
		const id = view.focus?.nodeId ?? view.selected[0];
		let node = view.nodes.find((node) => node.id === id);
		while (node) {
			for (const element of elements(node.id)) {
				if (element.getAttribute("role") === "tabpanel") {
					const root = element.parentElement;
					if (root)
						for (const panel of root.querySelectorAll<HTMLElement>('[role="tabpanel"]')) {
							if (panel.parentElement === element.parentElement)
								setOwned(panel, "hidden", panel === element ? null : "");
						}
					const tab = elements(node.id).find((el) => el.getAttribute("role") === "tab");
					const list = tab?.closest('[role="tablist"]');
					if (list)
						for (const peer of list.querySelectorAll('[role="tab"]'))
							setOwned(peer, "aria-selected", peer === tab ? "true" : "false");
				}
				if (element.hasAttribute("data-accordion-item")) {
					const panel = element.querySelector<HTMLElement>("[data-disclosure-panel]");
					const trigger = element.querySelector("[data-disclosure-trigger]");
					if (panel) setOwned(panel, "hidden", null);
					if (trigger) setOwned(trigger, "aria-expanded", "true");
				}
			}
			node = view.nodes.find((parent) => parent.id === node?.parentId);
		}
	}
	// Course CSS can key a node's visibility to its handle's state, because the handle is
	// its preceding sibling: `:popover-open + *`, `[data-selected] + *`, `:focus + *` or
	// the same through `:has()`. Showing a handle would then hide its node, and hiding the
	// handle show it again. When a node with an open or focused handle has no box, every
	// handle is measured again in a neutral state: closed, without its state attributes.
	// Focus and pointer hover cannot be neutralized, so such a handle keeps its node's last
	// box. Course selectors can always see a sibling's pseudo-classes and aria-expanded, so
	// the lens neutralizes state for measurement rather than hiding it from selectors.
	const QUIET_STATE_ATTRIBUTES = ["data-hovered", "data-selected"];
	const STATE_ATTRIBUTES = [...QUIET_STATE_ATTRIBUTES, "aria-expanded"];
	let lastBoxes = new Map<string, DOMRect>();
	const lastOrigins = new WeakMap<Element, DOMRect>();
	function measureNodes(rendered: Map<string, HTMLElement | undefined>) {
		const measure = () => {
			const boxes = new Map<HTMLElement, DOMRect>();
			for (const element of rendered.values())
				if (element && !boxes.has(element) && visible(element)) boxes.set(element, boxOf(element));
			return boxes;
		};
		let boxes = measure();
		let reshown = false;
		// Only CSS can key a node to handle state. A node the lens or course hides with
		// markup (a tab panel's hidden attribute on every Tab to a tab) is simply hidden, so
		// legitimate flows never run the neutral pass.
		const lost = [...rendered].some(([id, element]) => {
			const button = handles.get(id);
			return (
				!!element &&
				!!button &&
				!boxes.has(element) &&
				!element.closest("[hidden],[inert],[aria-hidden='true']") &&
				(button === doc.activeElement || (topLayer && button.matches(":popover-open")))
			);
		});
		if (lost) {
			// The focused handle keeps its aria-expanded: removing and restoring it in one
			// task can still reach assistive technology. Its other state is neutralized like
			// any handle's, or CSS keyed to it would hide its node's descendants too.
			const focused = doc.activeElement;
			const open = [...handles.values()]
				.filter((button) => button.matches(":popover-open"))
				.sort((a, b) => Number(a.dataset.kind === "item") - Number(b.dataset.kind === "item"));
			const saved = [...handles.values()].map(
				(button) =>
					[
						button,
						(button === focused || button === handles.get(sourceNodeId ?? "")
							? QUIET_STATE_ATTRIBUTES
							: STATE_ATTRIBUTES
						).map((name) => [name, button.getAttribute(name)] as const),
					] as const,
			);
			for (const [button, values] of saved)
				for (const [name] of values) button.removeAttribute(name);
			for (const button of open) button.hidePopover();
			boxes = measure();
			for (const [button, values] of saved)
				for (const [name, value] of values) if (value !== null) button.setAttribute(name, value);
			for (const button of open) button.showPopover();
			if (open.length) {
				topHandle = open.at(-1) ?? null;
				reshown = true;
			}
		}
		for (const [id, element] of rendered) {
			const button = handles.get(id);
			const last = lastBoxes.get(id);
			if (
				element &&
				button &&
				last &&
				!boxes.has(element) &&
				(button === doc.activeElement || button.matches(":hover"))
			)
				boxes.set(element, last);
		}
		// Remember each node's last box, also while it has none, so the fallback above can
		// use it once that node's handle has focus or hover. Nodes that are rendered always
		// use their current box: the fallback applies only to a node with no box.
		lastBoxes = new Map(
			[...rendered].flatMap(([id, element]) => {
				const box = (element && boxes.get(element)) ?? lastBoxes.get(id);
				return box ? [[id, box] as const] : [];
			}),
		);
		return { boxes, reshown };
	}
	function position() {
		if (disposed || !presenting) return;
		sourceField?.position();
		const rtl = win.getComputedStyle(doc.body).direction === "rtl";
		const viewportWidth = doc.documentElement.clientWidth || win.innerWidth;
		const inlineStart = (rect: DOMRect) => (rtl ? viewportWidth - rect.right : rect.left);
		const occupied: {
			button: HTMLButtonElement;
			left: number;
			top: number;
			size: number;
			item: boolean;
		}[] = [];
		const renderedElements = new Map(view.nodes.map((node) => [node.id, nodeElement(node)]));
		let measured = measureNodes(renderedElements);
		const firstContent = [...renderedElements.values()].find(
			(element) => element && measured.boxes.has(element),
		);
		const firstBox = () => (firstContent ? measured.boxes.get(firstContent) : undefined);
		const first = firstBox();
		if (!gutterReserved && first && inlineStart(first) < MIN_INSPECTION_GUTTER) {
			const padding = Number.parseFloat(win.getComputedStyle(doc.body).paddingInlineStart) || 0;
			const scale = doc.body.offsetWidth
				? doc.body.getBoundingClientRect().width / doc.body.offsetWidth
				: 1;
			doc.body.style.paddingInlineStart = `${padding + (MIN_INSPECTION_GUTTER - inlineStart(first)) / scale}px`;
			gutterReserved = true;
			measured = measureNodes(renderedElements);
		}
		const { boxes } = measured;
		const renderedBoxes = [...boxes].map(([element, box]) => ({ element, box }));
		// A focusable container (main's skip-link target, a carousel, a tab panel)
		// holds the nodes themselves; only controls beside the content are kept clear.
		const controlBoxes = [...doc.querySelectorAll<HTMLElement>(LEARNER_CONTROLS)]
			.filter((element) => {
				if (chrome(element) || renderedBoxes.some((rendered) => element.contains(rendered.element)))
					return false;
				const learnerOnly = element.closest(LEARNER_ONLY)?.parentElement;
				if (!(learnerOnly instanceof win.HTMLElement)) return visible(element);
				const box = element.getBoundingClientRect();
				return visible(learnerOnly) && box.width > 0 && box.height > 0;
			})
			.map((element) => element.getBoundingClientRect());
		const start = firstBox();
		const pageStart = start ? inlineStart(start) : MIN_INSPECTION_GUTTER;
		hoverBoxes = [...renderedElements].flatMap(([id, element]) => {
			const box = element && boxes.get(element);
			return element && box ? [{ id, element, box }] : [];
		});
		// Reserve the tight leaf boxes before choosing positions for taller items.
		const ordered = [...view.nodes].sort(
			(a, b) => Number(a.kind === "item") - Number(b.kind === "item"),
		);
		// One write pass before any measurement, so engines lay out once (WebKit pays
		// for each show interleaved with reads). At first mount this order paints item
		// handles above block handles (z-index 11 over 10); later re-shows append, and
		// raise() reorders only the focused handle and L3 popups.
		let shown = measured.reshown;
		for (const node of ordered) {
			const button = handles.get(node.id);
			const element = renderedElements.get(node.id);
			if (!button || !element) continue;
			const hidden = !boxes.has(element);
			if (button.hidden !== hidden) button.hidden = hidden;
			if (!topLayer) continue;
			if (button.hidden) {
				if (button.matches(":popover-open")) button.hidePopover();
			} else if (!button.matches(":popover-open")) {
				// Inserting or moving a handle (a patch replacing its node) closes it.
				button.showPopover();
				topHandle = button;
				shown = true;
			}
		}
		const admitGeometry = (element: Element, kind: "geometry" | "popup") => {
			ownedChrome.add(element);
			element.setAttribute("data-praxity-chrome", kind);
		};
		const placed = ordered.flatMap((node) => {
			const button = handles.get(node.id);
			return button && !button.hidden && renderedElements.get(node.id) ? [button] : [];
		});
		// Course CSS can hide a probe or its parent (`:has(> probe)`, `probe ~ *`), which also
		// collapses the page and resets its scroll while the probe is there. A handle
		// cannot be restyled, so top-layer handles avoid probes where they can. Their
		// containing block is the viewport, so in Chromium and Firefox the only scale is
		// the inherited CSS zoom that currentCSSZoom reports. WebKit lacks it and offsets
		// top-layer handles by a transformed ancestor, so a placed handle is its own probe:
		// its rendered box against its inline translation yields the origin and scale. Only a
		// handle never placed needs a probe there.
		const zoomOnly = topLayer && "currentCSSZoom" in win.Element.prototype;
		const selfMeasured = new Map<HTMLButtonElement, DOMRect>();
		if (topLayer && !zoomOnly)
			for (const button of placed) {
				const rendered = button.getBoundingClientRect();
				const zoom = Number.parseFloat(button.style.zoom) || 1;
				const [left, top] = button.style.translate.split(/\s+/u).map(Number.parseFloat);
				const scale = rendered.width / (Number.parseFloat(button.style.width) * zoom);
				if (scale > 0 && Number.isFinite(scale + left + top))
					selfMeasured.set(
						button,
						new win.DOMRect(
							rendered.left - left * scale * zoom,
							rendered.top - top * scale * zoom,
							100 * scale,
							100 * scale,
						),
					);
			}
		const origins = measureOrigins(
			placed.filter((button) => !selfMeasured.has(button)),
			admitGeometry,
			sourceField ? geometryProbes : undefined,
		);
		for (const button of placed) {
			const parent = button.parentElement;
			if (!parent) continue;
			const self = selfMeasured.get(button);
			const last = lastOrigins.get(parent);
			// Rendered boxes snap to layout units, so a self-measured origin wobbles by a
			// fraction of a pixel; keep the last exact origin while it agrees.
			if (self && !origins.has(parent))
				origins.set(
					parent,
					last &&
						Math.abs(last.left - self.left) < 0.1 &&
						Math.abs(last.top - self.top) < 0.1 &&
						Math.abs(last.width - self.width) < 0.1
						? last
						: self,
				);
			// A probe that measured nothing leaves the parent's last good origin, else the
			// viewport's, so every handle is still placed.
			const origin = origins.get(parent);
			if (origin && origin.width > 0 && origin.height > 0) lastOrigins.set(parent, origin);
			else origins.set(parent, last ?? new win.DOMRect(0, 0, 100, 100));
		}
		// Read every anchor before writing handle geometry. A style write invalidates
		// the following getComputedStyle/offsetHeight even when no content moved.
		const anchors = new Map(
			ordered.flatMap((node) => {
				const element = renderedElements.get(node.id);
				const button = handles.get(node.id);
				if (!element || !button || button.hidden) return [];
				const rect = boxes.get(element) ?? boxOf(element);
				const size = node.kind === "item" ? 20 : 24;
				const scaleY = element.offsetHeight ? rect.height / element.offsetHeight : 1;
				const lineHeight =
					(Number.parseFloat(win.getComputedStyle(element).lineHeight) || size) * scaleY;
				const tabList =
					element.getAttribute("role") === "tab" ? element.closest('[role="tablist"]') : null;
				const parent = view.nodes.find((candidate) => candidate.id === node.parentId);
				const parentElement = parent?.kind === "item" ? renderedElements.get(parent.id) : undefined;
				return [
					[
						node.id,
						{
							rect,
							lineHeight,
							tabList,
							anchorStart: inlineStart(tabList?.getBoundingClientRect() ?? rect),
							sharedItemLine:
								parentElement?.contains(element) &&
								inlineStart(boxes.get(parentElement) ?? boxOf(parentElement)) === inlineStart(rect),
						},
					] as const,
				];
			}),
		);
		for (const node of ordered) {
			const button = handles.get(node.id);
			const element = renderedElements.get(node.id);
			if (!button || !element || button.hidden) continue;
			const anchor = anchors.get(node.id);
			if (!anchor) continue;
			const { rect, lineHeight, tabList, anchorStart, sharedItemLine } = anchor;
			const size = node.kind === "item" ? 20 : 24;
			const item = node.kind === "item";
			const container = view.nodes.some((child) => {
				const childElement =
					child.parentId === node.id ? renderedElements.get(child.id) : undefined;
				return childElement && element.contains(childElement) && boxes.has(childElement);
			});
			// A horizontal tab's local left edge is between labels. All its item
			// handles use the tab list's gutter, in source order, within the tab row.
			// Fixed-position coordinates are quantized separately from DOM rectangles
			// in WebKit/Firefox. Keep centres just inside the measured boundaries.
			const inset = Math.min(0.25, rect.height / 2);
			const inViewport = rect.bottom > 0 && rect.top < win.innerHeight;
			const minimum = inViewport
				? Math.min(win.innerHeight - size / 2, Math.max(rect.top + inset, size / 2))
				: rect.top + inset;
			// After its first line scrolls away, use the remaining node box. This
			// keeps visible controls apart instead of stacking them on the viewport edge.
			const nodeMaximum =
				(tabList || (inViewport && rect.top < 0)
					? rect.bottom
					: Math.min(rect.bottom, rect.top + lineHeight)) - inset;
			const maximum = inViewport
				? Math.max(
						minimum,
						Math.min(
							rect.bottom - inset,
							Math.max(size / 2, nodeMaximum),
							win.innerHeight - size / 2,
						),
					)
				: nodeMaximum;
			const preferred =
				sharedItemLine && !container
					? maximum
					: container && !item
						? minimum
						: Math.min(maximum, rect.top + Math.max(size, lineHeight) / 2);
			const centres = [preferred, minimum, maximum];
			for (let distance = 4; distance <= maximum - minimum; distance += 4)
				centres.push(preferred - distance, preferred + distance);
			const candidates = centres
				.filter((y) => y >= minimum && y <= maximum)
				.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
			// The 54px container lane leaves a 2px gap before a child in the 28px lane
			// wherever the gutter is wide enough; at 390px both clamp and touch.
			const starts = [
				Math.max(
					8,
					anchorStart -
						((container && !item) || sharedItemLine ? 54 : tabList ? 22 : item ? 30 : 38),
				),
				Math.max(8, anchorStart - 54),
				Math.max(8, anchorStart - (item ? 22 : size + 4)),
				Math.max(8, anchorStart - (item ? 22 : size)),
				Math.max(8, pageStart - (item ? 22 : 54)),
				Math.max(8, pageStart - 54),
				Math.max(8, pageStart - size - 4),
			];
			// A local column gutter can be inside its neighbour's content box.
			// Protect peers as well as controls, including after their text reflows.
			const protectedBoxes = [
				...controlBoxes,
				...renderedBoxes
					.filter((peer) => !peer.element.contains(element) && !element.contains(peer.element))
					.map((peer) => peer.box),
			];
			const place = (start: number, y: number) => ({
				start,
				left: rtl ? viewportWidth - start - size : start,
				top: y - size / 2,
			});
			const placements = starts.flatMap((start) => candidates.map((y) => place(start, y)));
			const clear = (candidate: { start: number; left: number; top: number }) =>
				candidate.start + size <= anchorStart &&
				protectedBoxes.every(
					(box) =>
						candidate.left >= box.right ||
						candidate.left + size <= box.left ||
						candidate.top >= box.bottom ||
						candidate.top + size <= box.top,
				);
			// Containers stay on their own first line. Adjacent gutter lanes keep
			// short child boxes reachable without moving handles below their nodes.
			const free = (candidate: { start: number; left: number; top: number }) =>
				clear(candidate) &&
				occupied.every((box) => !crowds({ left: candidate.left, top: candidate.top, size }, box));
			// Nested nodes clamped to a viewport edge, or a one-line container and its
			// child, can fill every lane beside the node. The nearest free slot beyond
			// it still points at the node; a shared slot would hide one handle.
			const beyond = () => {
				const low = inViewport ? size / 2 : preferred - win.innerHeight;
				const high = inViewport ? win.innerHeight - size / 2 : preferred + win.innerHeight;
				for (
					let distance = 4;
					preferred - distance >= low || preferred + distance <= high;
					distance += 4
				)
					for (const y of [preferred - distance, preferred + distance])
						if (y >= low && y <= high)
							for (const start of starts) {
								const candidate = place(start, y);
								if (free(candidate)) return candidate;
							}
			};
			// A gutter full for the whole viewport height is the only way to reach the
			// last fallback; it still keeps content clear (V5).
			const placement = placements.find(free) ?? beyond() ?? placements.find(clear);
			// Never throw from placement: a failed pass would leave every handle stale. A
			// focused handle keeps its last place; any other handle waits for the next pass.
			if (!placement) {
				if (button !== doc.activeElement) {
					button.hidden = true;
					if (topLayer && button.matches(":popover-open")) button.hidePopover();
				}
				continue;
			}
			const { left, top } = placement;
			occupied.push({ button, left, top, size, item });
			positionFixed(button, { left, top, width: size, height: size }, admitGeometry, rtl, origins);
		}
		// Expanded targets may share the gutter, but must never steal another
		// handle's visible button. Keep the 44px extent and cut out those boxes.
		for (const box of occupied) {
			const originX = box.left - 10;
			const originY = box.top - (box.item ? 12 : 10);
			let path = "M0 0H44V44H0Z";
			for (const peer of occupied) {
				if (peer === box) continue;
				const left = Math.max(0, peer.left - originX);
				const right = Math.min(44, peer.left + peer.size - originX);
				const top = Math.max(0, peer.top - originY);
				const bottom = Math.min(44, peer.top + peer.size - originY);
				if (left < right && top < bottom) path += `M${left} ${top}H${right}V${bottom}H${left}Z`;
			}
			box.button.style.setProperty(hitClip, `path(evenodd, '${path}')`, "important");
		}
		hoverAt();
		const active = activeElement();
		raise(
			active instanceof win.HTMLButtonElement && handles.get(active.dataset.nodeId ?? "") === active
				? active
				: null,
			shown,
		);
	}
	// Top-layer chrome paints in the order it was shown, so z-index no longer orders it.
	// Re-showing the focused handle keeps F11's focused-handle stacking above its
	// neighbours; re-showing open L3 popups then keeps every handle beneath them.
	let topHandle: HTMLButtonElement | null = null;
	const l3Popups = new Set<HTMLElement>();
	function raise(handle: HTMLButtonElement | null, popups: boolean) {
		if (handle && topHandle !== handle && handle.matches(":popover-open")) {
			handle.hidePopover();
			handle.showPopover();
			topHandle = handle;
			popups = true;
		}
		if (popups)
			for (const popup of l3Popups) {
				if (!popup.isConnected) l3Popups.delete(popup);
				else if (popup.matches(":popover-open")) {
					popup.hidePopover();
					popup.showPopover();
				}
			}
	}
	function positionBadges() {
		if (!presenting) return;
		for (const [id, badge] of badges) {
			if (retiredChrome.has(badge)) continue;
			const element = fragmentElement(id);
			badge.hidden = !element || !visible(element);
			if (element && !badge.hidden) {
				const rect = element.getBoundingClientRect();
				positionFixed(
					badge,
					{
						left: Math.max(
							8,
							Math.min(win.innerWidth - badge.offsetWidth - 8, rect.right - badge.offsetWidth),
						),
						top: Math.max(0, rect.top),
						width: badge.offsetWidth,
						height: badge.offsetHeight,
					},
					(element) => ownedChrome.add(element),
					false,
					measureOrigins(
						[badge],
						(element) => ownedChrome.add(element),
						sourceField ? geometryProbes : undefined,
					),
				);
			}
		}
	}
	function focusables(root: HTMLElement) {
		return [...root.querySelectorAll<HTMLElement>(LEARNER_CONTROLS)].filter((el) => !chrome(el));
	}
	function retainFocus<T>(mutate: () => T): T {
		if (!presenting) return mutate();
		const active = activeElement();
		const hadFocus = active instanceof win.HTMLElement && chrome(active) && doc.hasFocus();
		// The next view can already omit this node; its admitted control still owns the removal.
		const owner = hadFocus ? controls.get(active) : undefined;
		const field =
			active instanceof win.HTMLTextAreaElement || active instanceof win.HTMLInputElement;
		const selection =
			field && active.selectionStart !== null
				? ([
						active.selectionStart,
						active.selectionEnd ?? active.selectionStart,
						active.selectionDirection ?? "none",
					] as const)
				: null;
		// A read-only page view has no chrome: the author's focus sits on a course control.
		// Remember it by each admitted node that holds it, innermost first, with its position
		// there, and the page's nodes in document order in case the patch removes them all.
		let content: { id: string; index: number }[] = [];
		let pageOrder: string[] = [];
		if (
			readOnly &&
			active instanceof win.HTMLElement &&
			active !== doc.body &&
			!chrome(active) &&
			doc.hasFocus()
		) {
			const admitted = [...admittedFragments].filter(
				([id, element]) => !id.startsWith("region:") && element.isConnected,
			);
			admitted.sort(([, a], [, b]) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
			pageOrder = admitted.map(([id]) => id);
			content = admitted
				.filter(([, element]) => element.contains(active))
				.reverse()
				.map(([id, element]) => ({ id, index: focusables(element).indexOf(active) }));
		}
		const result = mutate();
		if (owner && active && !active.isConnected && doc.activeElement === doc.body)
			removedFocus = owner;
		if (content.length && active instanceof win.HTMLElement && doc.activeElement === doc.body) {
			let target: HTMLElement | undefined = active.isConnected ? active : undefined;
			for (const { id, index } of target ? [] : content) {
				const root = fragmentElement(id);
				if (!root) continue;
				target = focusables(root)[index] ?? root;
				break;
			}
			// The patch removed the focused node: go to the next surviving node, else the previous.
			const at = pageOrder.indexOf(content.at(-1)?.id ?? "");
			for (const id of target
				? []
				: [...pageOrder.slice(at + 1), ...pageOrder.slice(0, at).reverse()]) {
				target = fragmentElement(id);
				if (target) break;
			}
			// A node root is not a control; make it focusable without adding a tab stop.
			if (target && target !== active && !target.matches(LEARNER_CONTROLS))
				setOwned(target, "tabindex", "-1");
			target?.focus({ preventScroll: true });
		}
		// Moving a retained control with insertBefore drops native focus in all engines.
		if (
			hadFocus &&
			active instanceof win.HTMLElement &&
			chrome(active) &&
			active.isConnected &&
			doc.activeElement === doc.body
		) {
			if (selection && field) active.setSelectionRange(...selection);
			active.focus({ preventScroll: true });
		}
		return result;
	}
	function refresh() {
		retainFocus(refreshContent);
		// This refresh already reconciled these mutations, including its own reveal writes.
		observer.takeRecords();
	}
	function refreshContent() {
		if (disposed) return;
		liveControls();
		for (const element of ownedAttributes.keys())
			if (!element.isConnected) ownedAttributes.delete(element);
		for (const element of tabStops.keys()) if (!element.isConnected) tabStops.delete(element);
		// A retained source must not rebind to an authored duplicate after a miss.
		for (const [id, element] of admittedFragments)
			if (!element.isConnected && sourceNodeId !== id) admittedFragments.delete(id);
		// The course's learner announcements are inactive while authors inspect it.
		for (const element of readOnly
			? []
			: doc.querySelectorAll(
					'[aria-live],output,[role~="log"],[role~="status"],[role~="alert"],[role~="marquee"],[role~="timer"]',
				)) {
			if (chrome(element)) continue;
			// Explicit off overrides implicit live roles, including native output.
			setOwned(element, "aria-live", "off");
			setOwned(element, "aria-atomic", null);
			setOwned(element, "aria-relevant", null);
		}
		// A detached source control still holds the caret at the instant of the patch.
		// The controller view may still be in transit; never save a DOM node in session state.
		const restoreTarget = targetOf(observedControl) ?? observedFocus;
		// Compiler node IDs remain intact. Authored chrome claims confer no trust
		// and must not activate the chrome CSS or masquerade as compiler nodes.
		for (const element of doc.querySelectorAll<HTMLElement>(
			"[data-praxity-chrome],[data-focus-role]",
		))
			if (!chrome(element)) {
				setOwned(element, "data-praxity-chrome", null);
				setOwned(element, "data-focus-role", null);
				setOwned(element, "data-node-id", null);
				if (!tabStops.has(element)) tabStops.set(element, element.getAttribute("tabindex"));
				if (element.tabIndex !== -1) element.tabIndex = -1;
			}
		// Invokers could open course dialogs or popovers over the handles.
		for (const name of readOnly ? [] : INSPECTION_INVOKER_ATTRIBUTES)
			for (const element of doc.querySelectorAll(`[${name}]`))
				if (!chrome(element)) setOwned(element, name, null);
		// Document hygiene still runs on retained patches; presentation reconciliation waits.
		if (!presenting) return;
		setOwned(
			doc.documentElement,
			"data-praxity-handles",
			view.alwaysShowHandles ? "always" : "hover",
		);
		if (!readOnly) reveal();
		syncSourceField();
		const missing: string[] = [];
		const keep = new Set(view.nodes.map((node) => node.id));
		for (const [id, button] of handles)
			if (!keep.has(id)) {
				controls.delete(button);
				retireChrome(button);
				if (!button.isConnected) handles.delete(id);
			}
		for (const node of view.nodes) {
			const element = nodeElement(node);
			if (!element) {
				missing.push(node.id);
				const button = handles.get(node.id);
				if (button) {
					controls.delete(button);
					retireChrome(button);
					if (!button.isConnected) handles.delete(node.id);
				}
				continue;
			}
			let button = handles.get(node.id);
			if (!button?.isConnected) {
				button = doc.createElement("button");
				ownedChrome.add(button);
				controls.set(button, { file: view.file, nodeId: node.id, role: "handle" });
				controlRefs.add(new WeakRef(button));
				indexedControls.add(button);
				button.type = "button";
				button.dataset.praxityChrome = "handle";
				button.dataset.nodeId = node.id;
				button.dataset.focusRole = "handle";
				button.dataset.kind = node.kind;
				const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
				svg.setAttribute("viewBox", "0 0 14 14");
				svg.setAttribute("width", node.kind === "item" ? "12" : "14");
				svg.setAttribute("height", node.kind === "item" ? "12" : "14");
				svg.setAttribute("aria-hidden", "true");
				for (const x of [5, 9])
					for (const y of [3, 7, 11]) {
						const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
						circle.setAttribute("cx", String(x));
						circle.setAttribute("cy", String(y));
						circle.setAttribute("r", "1");
						circle.setAttribute("fill", "currentColor");
						// Where geometry is CSS, inline !important keeps course CSS from moving the dots.
						circle.style.cssText = `cx:${x}px!important;cy:${y}px!important;r:1px!important`;
						svg.append(circle);
					}
				const description = doc.createElement("span");
				description.dataset.praxityChrome = "description";
				description.id = `${prefix}-${++descriptionNumber}`;
				description.append(doc.createTextNode(""));
				button.append(svg, description);
				button.setAttribute("aria-describedby", description.id);
				if (topLayer) button.setAttribute("popover", "manual");
				handles.set(node.id, button);
			}
			// A tab's handle is placed on its tab but read before its panel, so Tab
			// passes through each panel's children before the next tab (F1).
			const content =
				(node.kind === "item" &&
					element.getAttribute("role") === "tab" &&
					elements(node.id).find((el) => el.getAttribute("role") === "tabpanel")) ||
				element;
			restoreChrome(button);
			if (!indexedControls.has(button)) {
				controlRefs.add(new WeakRef(button));
				indexedControls.add(button);
			}
			controls.set(button, { file: view.file, nodeId: node.id, role: "handle" });
			if ((!sourceField || !button.isConnected) && button.nextElementSibling !== content)
				content.before(button);
			setOwned(button, "lang", view.language);
			setOwned(button, "aria-label", node.name);
			setOwned(button, "aria-haspopup", "menu");
			setOwned(
				button,
				"aria-expanded",
				String(view.expanded.includes(node.id) || view.source?.nodeId === node.id),
			);
			setOwned(button, "tabindex", "0");
			const detail = [node.description, failureDescription].filter(Boolean).join(" ");
			describeHandle(button, detail);
			const selected = view.selected.includes(node.id);
			if (button.hasAttribute("data-selected") !== selected)
				button.toggleAttribute("data-selected", selected);
			setOwned(element, "data-praxity-selected", selected ? "" : null);
		}
		for (const element of readOnly ? [] : doc.querySelectorAll<HTMLElement>(LEARNER_CONTROLS))
			if (!chrome(element)) {
				// Learner card semantics must not contain editor buttons during inspection.
				if (
					element.getAttribute("role") === "button" &&
					[...handles.values()].some((handle) => element.contains(handle))
				) {
					setOwned(element, "role", null);
					for (const attribute of ["aria-pressed", "aria-expanded", "aria-haspopup", "aria-label"])
						setOwned(element, attribute, null);
				}
				if (!tabStops.has(element)) tabStops.set(element, element.getAttribute("tabindex"));
				if (element.tabIndex !== -1) element.tabIndex = -1;
				if (element.matches("iframe,embed,object")) {
					// Inert only the embed wrapper, never the owning block or its handle.
					const wrapper = element.parentElement;
					const boundary = wrapper?.hasAttribute("data-node-id") || wrapper === doc.body;
					setOwned(wrapper && !boundary ? wrapper : element, "inert", "");
				}
			}
		geometry.observe([
			doc.body,
			...(sourceField
				? [sourceField.slot, sourceField.field, sourceField.group, ...sourceGeometryAncestors()]
				: []),
			...view.nodes.flatMap((node) => {
				const element = nodeElement(node);
				return element ? [element] : [];
			}),
		]);
		position();
		positionBadges();
		if (
			restoreTarget &&
			observedControl &&
			!observedControl.isConnected &&
			doc.activeElement === doc.body &&
			doc.hasFocus()
		)
			if (view.nodes.some((node) => node.id === restoreTarget.nodeId)) focus(restoreTarget);
		if (missing.length) onEvent({ event: "missing", nodeIds: missing });
	}
	function focused(event: FocusEvent) {
		if (!presenting) return;
		// The owning root reports its control; document focusin sees only its host.
		if ([...inputRoots.keys()].some((root) => root.host === event.target)) return;
		observedControl = controlOf(event.target as Element | null);
		const target = targetOf(observedControl);
		observedFocus = target;
		if (topLayer && target?.role === "handle" && observedControl instanceof win.HTMLButtonElement)
			raise(observedControl, false);
		if (target) onEvent({ event: "focusChanged", focus: target });
	}
	function pointer(event: MouseEvent) {
		if (!presenting) return;
		if (
			event.type === "pointerdown" &&
			(!sourceField || !hasNativeFocus(sourceField.field) || event.button !== 0)
		)
			return;
		const element = event.target as Element | null;
		const target = targetOf(element);
		// Gecko can keep native focus on body after a retained iframe resumes.
		if (target?.role === "source") {
			if (!element || !hasNativeFocus(element))
				focus({ file: target.file, nodeId: target.nodeId, role: "source" });
			return;
		}
		if (!element || chrome(element)) return;
		const node = element.closest<HTMLElement>("[data-node-id]");
		if (!node?.dataset.nodeId || !view.nodes.some((n) => n.id === node.dataset.nodeId)) {
			if (event.type === "click") {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		// Keep the source's native owner until the click's queued select is delivered.
		if (event.type === "pointerdown") return;
		onEvent({
			event: "select",
			focus: { file: view.file, nodeId: node.dataset.nodeId, role: "handle" },
			mode: event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "single",
		});
	}
	function caretChanged() {
		if (
			!presenting ||
			!sourceField ||
			!hasNativeFocus(sourceField.field) ||
			sourceField.field.value !== sourceText
		)
			return;
		const target = targetOf(sourceField.field);
		if (target && sourceDraftId) {
			if (target.selection) sourceSelection = target.selection;
			observedFocus = target;
			onEvent({
				event: "sourceChanged",
				draftId: sourceDraftId,
				focus: target,
				text: sourceText,
			});
		}
	}
	function sourceInput(event: Event) {
		if (!presenting || !sourceField || event.target !== sourceField.field) return;
		sourceText = sourceField.field.value;
		if (hasNativeFocus(sourceField.field)) {
			caretChanged();
			return;
		}
		// Trusted input can arrive after the author has already moved native focus.
		const target = targetOf(sourceField.field);
		if (target?.selection && sourceDraftId) {
			sourceSelection = target.selection;
			onEvent({ event: "sourceChanged", draftId: sourceDraftId, focus: target, text: sourceText });
		}
	}
	function click(event: MouseEvent) {
		if (!presenting) return;
		const target = targetOf(event.target as Element | null);
		if (target?.role === "handle") {
			event.preventDefault();
			onEvent({ event: "intent", intent: "actions", focus: target });
		}
	}
	function key(event: KeyboardEvent) {
		if (!presenting || event.defaultPrevented) return;
		const target = targetOf(event.target as Element | null);
		if (
			event.key === "Tab" &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.isComposing &&
			event.keyCode !== 229 &&
			sourceField &&
			sourceNodeId &&
			target
		) {
			const controls = liveControls()
				.filter(
					([element, focus]) =>
						focus.role !== "source" && visible(element) && element.tabIndex >= 0,
				)
				.sort(([a], [b]) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
			const chips = controls.filter(
				([, focus]) => focus.nodeId === sourceNodeId && focus.role.startsWith("chip:"),
			);
			for (const chip of chips) controls.splice(controls.indexOf(chip), 1);
			const owner = controls.findIndex(
				([, focus]) => focus.role === "handle" && focus.nodeId === sourceNodeId,
			);
			if (owner >= 0) {
				controls.splice(
					owner + 1,
					0,
					[sourceField.field, { file: view.file, nodeId: sourceNodeId, role: "source" }],
					...chips,
				);
				const at = controls.findIndex(([element]) => hasNativeFocus(element));
				const next = controls[at + (event.shiftKey ? -1 : 1)];
				if (
					at >= 0 &&
					next &&
					(target.nodeId === sourceNodeId || next[1].nodeId === sourceNodeId)
				) {
					event.preventDefault();
					event.stopImmediatePropagation();
					// Native Tab moves now; the controller keeps main's field lifetime until save replies.
					focus(next[1]);
					if (target.nodeId === sourceNodeId && next[1].nodeId !== sourceNodeId)
						onEvent({ event: "select", focus: next[1], mode: "single" });
					return;
				}
			}
		}
		const entry = findEditorShortcut(
			event,
			target?.role === "handle" ? "handle" : "field",
			view.platform ?? "windows",
		);
		if (!entry) return;
		const capturedKey = {
			key: event.key,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			altKey: event.altKey,
			shiftKey: event.shiftKey,
		};
		if (entry.context === "global") {
			event.preventDefault();
			event.stopImmediatePropagation();
			const handlers: EditorShortcutHandlers<"global"> = {
				nextRegion: () => onEvent({ event: "region", direction: 1, key: capturedKey }),
				previousRegion: () => onEvent({ event: "region", direction: -1, key: capturedKey }),
			};
			invokeEditorShortcut(entry, handlers);
			return;
		}
		if (entry.context === "field") {
			if (
				!sourceField ||
				!sourceDraftId ||
				event.target !== sourceField.field ||
				!hasNativeFocus(sourceField.field) ||
				target?.role !== "source"
			)
				return;
			// Native undo/redo owns dirty text. Only its base boundary is an editor action.
			if (entry.action === "redoSource" || (entry.action === "undoSource" && !sourceField.atBase()))
				return;
			event.preventDefault();
			event.stopImmediatePropagation();
			caretChanged();
			const action = entry.action;
			if (action === "commitSource" || action === "saveSource" || action === "undoSource")
				onEvent({
					event: "sourceAction",
					draftId: sourceDraftId,
					focus: target,
					action,
					key: capturedKey,
				});
			return;
		}
		if (
			target?.role !== "handle" ||
			controlOf(event.target as Element | null) !== doc.activeElement
		)
			return;
		event.preventDefault();
		const navigate = (direction: "previous" | "next" | "start" | "end", extend = false) =>
			onEvent({ event: "navigate", direction, extend });
		const shortcut = (action: FrameShortcutAction) => {
			event.stopImmediatePropagation();
			onEvent({ event: "shortcut", action, focus: target, key: capturedKey });
		};
		const handlers: EditorShortcutHandlers<"handle"> = {
			previous: () => navigate("previous"),
			next: () => navigate("next"),
			start: () => navigate("start"),
			end: () => navigate("end"),
			rangePrevious: () => navigate("previous", true),
			rangeNext: () => navigate("next", true),
			rangeStart: () => navigate("start", true),
			rangeEnd: () => navigate("end", true),
			source: () => onEvent({ event: "intent", intent: "source", focus: target }),
			actions: () => onEvent({ event: "intent", intent: "actions", focus: target }),
			toggle: () => shortcut("toggle"),
			selectAll: () => shortcut("selectAll"),
			moveUp: () => shortcut("moveUp"),
			moveDown: () => shortcut("moveDown"),
			delete: () => shortcut("delete"),
		};
		invokeEditorShortcut(entry, handlers);
	}
	// Course CSS can cover the page or switch off its pointer events, so the event
	// target says nothing about the node under the pointer. Hit-test the node boxes
	// measured by the last placement pass instead; the hit that contains no other hit
	// is the innermost node, as the event target's closest node was. A handle under the pointer names its own node. Each placement
	// pass hit-tests the last pointer position again, since scrolling moves the boxes.
	let pointerAt: { x: number; y: number; handle?: string } | null = null;
	function hover(event: PointerEvent) {
		if (!presenting) return;
		// Only leaving the document ends hover; moving between elements changes nothing.
		if (event.type === "pointerout") {
			if (event.relatedTarget) return;
			pointerAt = null;
		} else {
			const target = event.target;
			pointerAt = {
				x: event.clientX,
				y: event.clientY,
				handle:
					target instanceof win.HTMLButtonElement &&
					handles.get(target.dataset.nodeId ?? "") === target
						? target.dataset.nodeId
						: undefined,
			};
		}
		hoverAt();
	}
	function hoverAt() {
		const at = pointerAt;
		const hits = at
			? hoverBoxes.filter(
					({ box }) => at.x >= box.left && at.x < box.right && at.y >= box.top && at.y < box.bottom,
				)
			: [];
		const id = at
			? (at.handle ??
				hits.find(
					(hit) => !hits.some((other) => other !== hit && hit.element.contains(other.element)),
				)?.id)
			: undefined;
		// Compare per button, not against a cached id: a patch re-creates handles, and the
		// new handle of the hovered node needs the attribute too. Unchanged values write nothing.
		for (const [nodeId, button] of handles)
			if (button.hasAttribute("data-hovered") !== (nodeId === id))
				button.toggleAttribute("data-hovered", nodeId === id);
	}
	const observer = new win.MutationObserver((records) => {
		if (!presenting) {
			refresh();
			return;
		}
		if (
			records.every(
				(r) =>
					chrome(
						r.target.nodeType === 1
							? (r.target as Element)
							: (r.target.parentElement ?? doc.documentElement),
					) ||
					(r.type === "childList" &&
						[...r.addedNodes, ...r.removedNodes].every(
							(node) =>
								node.nodeType === 1 &&
								chrome(node as Element) &&
								(node.isConnected ||
									(node as Element).getAttribute("data-praxity-chrome") !== "handle"),
						)),
			)
		)
			return;
		if (!scheduled) {
			scheduled = true;
			const generation = presentationGeneration;
			queueMicrotask(() => {
				scheduled = false;
				if (generation === presentationGeneration) refresh();
			});
		}
	});
	const removeInput = readOnly
		? []
		: [
				listenEditorInput(doc, "pointerdown", clearRemovedFocus, true),
				listenEditorInput(doc, "pointerdown", pointer, true),
				listenEditorInput(doc, "keydown", clearRemovedFocus, true),
				listenEditorInput(doc, "focusin", clearRemovedFocus, true),
				listenEditorInput(doc, "focusin", focused),
				listenEditorInput(doc, "selectionchange", caretChanged),
				listenEditorInput(doc, "select", caretChanged),
				listenEditorInput(doc, "input", sourceInput),
				listenEditorInput(doc, "click", pointer, true),
				listenEditorInput(doc, "click", click),
				listenEditorInput(doc, "keydown", key),
				listenEditorInput(doc, "pointermove", hover, false, true),
				listenEditorInput(doc, "pointerout", hover, false, true),
			];
	const geometry = observeGeometry(doc, position, {
		anchor: () => (presenting && !disposed ? sourceField?.slot : undefined),
		affects: (target, anchor) =>
			!chrome(target) &&
			(target.contains(anchor) ||
				sourceGeometryAncestors().some((peer) => !peer.contains(anchor) && peer.contains(target))),
	});
	// A handle sits in its content, so a transformed ancestor is its containing
	// block. A course animation or transition (a flip card's back face rising in)
	// can end that transform without resizing anything; measure again then.
	// Handles' own transitions move nothing.
	const settled = (event: Event) => {
		if (!chrome(event.target as Element)) geometry.schedule();
	};
	doc.addEventListener("animationend", settled, true);
	doc.addEventListener("transitionend", settled, true);
	const escapeDispatcher = createEscapeDispatcher(() => {
		if (!presenting) return false;
		onEvent({ event: "escape" });
		return view.escapeEnabled ?? false;
	});
	if (!readOnly) escapeDispatcher.attach(doc);
	for (const element of doc.querySelectorAll<HTMLElement>("[data-block-id][data-node-id]")) {
		if (element.dataset.blockId === element.dataset.nodeId && element.dataset.nodeId)
			admittedFragments.set(element.dataset.nodeId, element);
	}
	const pageRoot =
		doc.getElementById(view.pageId) ??
		doc.getElementById("main-content") ??
		doc.querySelector("main") ??
		doc.body;
	orderedIds = new Set(
		[...admittedFragments]
			.filter(
				([, element]) =>
					pageRoot.contains(element) && !element.parentElement?.closest("[data-block-id]"),
			)
			.map(([id]) => id),
	);
	refresh();
	observer.observe(doc.body, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: [
			"hidden",
			"inert",
			"aria-hidden",
			"aria-live",
			"aria-atomic",
			"aria-relevant",
			"role",
			"class",
			"style",
			"tabindex",
			"data-node-id",
			"data-praxity-chrome",
			"data-focus-role",
		],
	});
	function captureSource() {
		if (!presenting || disposed || !sourceField) return;
		const draftId = sourceDraftId;
		if (!draftId) return;
		const field = sourceField.field;
		return {
			draftId,
			text: sourceText,
			selection:
				field.value === sourceText
					? ([field.selectionStart, field.selectionEnd] as [number, number])
					: ([...sourceSelection] as [number, number]),
		};
	}
	const api = {
		fragmentElement,
		readFragment,
		replaceFragment(fragment: PreviewHtmlFragment): boolean {
			const previous = fragmentElement(fragment.id);
			const next = readFragment(fragment);
			if (!next) return false;
			if (sourceField) {
				deferredStructure.push(() => (api.replaceFragment(fragment) ? [] : [fragment.id]));
				return true;
			}
			if (!previous) return false;
			return retainFocus(() => {
				// Editor controls belong to their adapter, even when mounted within course content.
				for (const element of previous.querySelectorAll<HTMLElement>("*"))
					if (ownedChrome.has(element) && !chrome(element.parentElement ?? previous))
						previous.before(element);
				previous.replaceWith(next);
				admitFragment(fragment.id, next);
				return true;
			});
		},
		admitFragment,
		orderFragments(...args: Parameters<typeof orderFragments>): string[] {
			if (sourceField) {
				deferredStructure.push(() => api.orderFragments(...args));
				return [];
			}
			return retainFocus(() => orderFragments(...args));
		},
		renderFeedback(feedback: RenderFeedback) {
			latestFeedback = feedback;
			if (!presenting) return;
			const copy = view.language === "fr" ? frenchFeedback : englishFeedback;
			// The host has already localized grammar diagnostics (preview.ts).
			const message = feedback.failure?.map((d) => d.message).join(" ") ?? "";
			// A function replacer keeps `$&` and similar patterns in diagnostics literal.
			failureDescription = message ? copy.pageFailed.replace("{message}", () => message) : "";
			for (const node of view.nodes)
				describeHandle(
					handles.get(node.id),
					[node.description, failureDescription].filter(Boolean).join(" "),
				);
			for (const [id, badge] of badges)
				if (
					!feedback.nodes[id] ||
					(feedback.failure?.length && feedback.nodes[id]?.state === "failed")
				) {
					retireChrome(badge);
					if (!badge.isConnected) badges.delete(id);
				}
			for (const [id, state] of Object.entries(feedback.nodes)) {
				// Page diagnostics do not identify an offending node. The banner and
				// descriptions carry that failure without obscuring every node's text.
				if (state.state === "failed" && feedback.failure?.length) continue;
				let badge = badges.get(id);
				if (!badge?.isConnected) {
					badge = doc.createElement("span");
					ownedChrome.add(badge);
					badge.dataset.praxityChrome = "render-badge";
					doc.body.append(badge);
					badges.set(id, badge);
				}
				restoreChrome(badge);
				feedbackText(badge, state.state === "updating" ? copy.updating : copy.outOfDate);
				badge.dataset.state = state.state;
				badge.title = state.state === "failed" ? state.message : "";
				badge.setAttribute(
					"aria-label",
					state.state === "failed" ? `${copy.outOfDate}: ${state.message}` : copy.updating,
				);
			}
			if (feedback.failure?.length) {
				if (!failureBanner?.isConnected) {
					failureBanner = doc.createElement("div");
					ownedChrome.add(failureBanner);
					failureBanner.dataset.praxityChrome = "render-banner";
					doc.body.prepend(failureBanner);
				}
				restoreChrome(failureBanner);
				feedbackText(failureBanner, failureDescription);
			} else if (failureBanner) {
				retireChrome(failureBanner);
				if (!failureBanner.isConnected) failureBanner = null;
			}
			positionBadges();
			if (feedback.failure?.length) geometry.schedule();
		},
		registerChrome,
		registerControl,
		render(next: FrameView) {
			if (!isFrameView(next) || (next.readOnly === true) !== readOnly)
				throw new Error("Invalid frame view");
			view = next;
			refresh();
		},
		suspend() {
			presenting = false;
			sourceField?.setPresenting(false);
			presentationGeneration++;
			observedControl = null;
			observedFocus = null;
			removedFocus = null;
			pointerAt = null;
		},
		resume(next: FrameView) {
			if (!isFrameView(next) || (next.readOnly === true) !== readOnly)
				throw new Error("Invalid frame view");
			view = next;
			presenting = true;
			// Reconcile latest data without capturing or replaying the old native focus.
			refreshContent();
			sourceField?.setPresenting(true);
			observer.takeRecords();
			if (latestFeedback) api.renderFeedback(latestFeedback);
		},
		refresh,
		focus,
		canFocus: (target: FrameFocus) => focusControl(target) !== null,
		dispose() {
			disposed = true;
			clearSourceField();
			controlRefs.clear();
			for (const removers of inputRoots.values()) for (const remove of removers) remove();
			inputRoots.clear();
			win.removeEventListener("load", syncChromeTheme);
			observer.disconnect();
			for (const remove of removeInput) remove();
			geometry.dispose();
			doc.removeEventListener("animationend", settled, true);
			doc.removeEventListener("transitionend", settled, true);
			escapeDispatcher.dispose();
			for (const button of handles.values()) button.remove();
			for (const badge of badges.values()) badge.remove();
			failureBanner?.remove();
			admittedFragments.clear();
			regionHtml.clear();
			style.remove();
			guard.remove();
			doc.body.style.paddingInlineStart = bodyPadding;
			for (const [element, value] of tabStops)
				if (value === null) element.removeAttribute("tabindex");
				else element.setAttribute("tabindex", value);
			for (const [element, attrs] of ownedAttributes)
				for (const [key, value] of attrs)
					if (value === null) element.removeAttribute(key);
					else element.setAttribute(key, value);
		},
	};
	return api;
	function clearSourceField() {
		if (sourceField) {
			controls.delete(sourceField.field);
			for (const element of [sourceField.field, sourceField.slot, sourceField.group]) {
				ownedAttributes.delete(element);
				ownedChrome.delete(element);
			}
			if (observedControl === sourceField.field) {
				observedControl = null;
				observedFocus = null;
			}
		}
		sourceField?.dispose();
		liveControls();
		sourceField = undefined;
		sourceDraftId = undefined;
		sourceNodeId = undefined;
		sourceText = "";
		for (const element of retiredChrome) element.remove();
		retiredChrome.clear();
		for (const [id, button] of handles) if (!button.isConnected) handles.delete(id);
		for (const [id, badge] of badges) if (!badge.isConnected) badges.delete(id);
		if (!failureBanner?.isConnected) failureBanner = null;
		for (const probe of geometryProbes.values()) probe.remove();
		geometryProbes.clear();
		const structure = deferredStructure;
		deferredStructure = [];
		if (!disposed) {
			const missing = structure.flatMap((apply) => apply());
			if (missing.length) onEvent({ event: "missing", nodeIds: [...new Set(missing)] });
		}
	}
	function syncSourceField() {
		const source = readOnly ? undefined : view.source;
		const node = source && view.nodes.find((node) => node.id === source.nodeId);
		if (!source) {
			clearSourceField();
			return;
		}
		if (sourceDraftId !== source.draftId || sourceNodeId !== source.nodeId) clearSourceField();
		const anchor = node && fragmentElement(node.id);
		if (!sourceField) {
			if (!anchor) return;
			sourceField = mountSourceField({
				document: doc,
				source,
				file: view.file,
				descriptionId: `${prefix}-source-${++descriptionNumber}`,
				guardLayer: `praxity-${nonce}`,
				token: chromeToken,
				anchor,
				registerChrome,
				registerControl,
			});
			sourceDraftId = source.draftId;
			sourceNodeId = source.nodeId;
			sourceText = sourceField.field.value;
			sourceSelection = [0, 0];
		}
		sourceField.attach(anchor);
		sourceField.update(source, view.language, chromeTheme);
	}
	function sourceGeometryAncestors() {
		const elements: Element[] = [];
		for (let parent = sourceField?.slot.parentElement; parent; parent = parent.parentElement)
			elements.push(parent, ...[...parent.children].filter((element) => !chrome(element)));
		return elements;
	}
	function registerChrome(element: Element, kind?: "popup" | "geometry") {
		if (disposed || element.ownerDocument !== doc) throw new Error("Invalid chrome registration");
		ownedChrome.add(element);
		// Caller-owned chrome keeps its markers. In particular, the learner
		// restoration map must not retain detached measurement probes.
		if (kind) element.setAttribute("data-praxity-chrome", kind);
		if (kind === "popup" && element instanceof win.HTMLElement) l3Popups.add(element);
	}
	// U6/U12 adapters admit controls by reference. Markup is never admission.
	function registerControl(element: HTMLElement, target: FrameFocus) {
		if (
			disposed ||
			element.ownerDocument !== doc ||
			target.file !== view.file ||
			!view.nodes.some((node) => node.id === target.nodeId) ||
			target.role === "handle"
		)
			throw new Error("Invalid editor control registration");
		ownedChrome.add(element);
		if (!indexedControls.has(element)) {
			controlRefs.add(new WeakRef(element));
			indexedControls.add(element);
		}
		controls.set(element, { file: target.file, nodeId: target.nodeId, role: target.role });
		setOwned(element, "data-praxity-chrome", "control");
		setOwned(element, "data-node-id", target.nodeId);
		setOwned(element, "data-focus-role", target.role);
		if (tabStops.has(element)) {
			const original = tabStops.get(element) ?? null;
			if (original === null) element.removeAttribute("tabindex");
			else element.setAttribute("tabindex", original);
			tabStops.delete(element);
		}
		setOwned(element, "tabindex", "0");
		const root = element.getRootNode();
		if (root instanceof win.ShadowRoot && !inputRoots.has(root)) {
			ownedChrome.add(root.host);
			inputRoots.set(root, [
				listenEditorInput(doc, "focusin", focused, false, false, root),
				listenEditorInput(doc, "selectionchange", caretChanged, false, false, root),
				listenEditorInput(doc, "select", caretChanged, false, false, root),
				listenEditorInput(doc, "input", sourceInput, false, false, root),
				listenEditorInput(doc, "click", pointer, true, false, root),
				listenEditorInput(doc, "click", click, false, false, root),
				listenEditorInput(doc, "keydown", key, false, false, root),
			]);
		}
	}
}

// Frame chrome takes the course's scheme, independently of the editor shell.
const PAGE_LENS_CSS = `
[data-praxity-chrome="render-badge"] { all:initial; position:fixed; z-index:13; box-sizing:border-box; max-width:calc(100vw - 16px); padding:3px 7px; border:1px solid var(--edge); border-radius:4px; background:var(--panel); color:var(--ink-2); font:12px/1.5 var(--chrome-font); pointer-events:none; }
[data-praxity-chrome="render-badge"][data-state="failed"] { color:var(--warn); }
[data-praxity-chrome="render-badge"][hidden] { display:none; }
[data-praxity-chrome="render-banner"] { position:relative; padding:8px 12px; border:1px solid var(--warn-edge); background:var(--warn-wash); color:var(--ink); font:12.5px/1.5 var(--chrome-font); }
[data-praxity-selected] { outline:2px solid var(--praxity-chrome-accent); outline-offset:4px; border-radius:2px; }
`;

const HANDLE = 'button[data-praxity-chrome="handle"]';
/** Literal values: a course can override or re-register a custom property, never a literal. */
function chromeToken(theme: "light" | "dark", name: string) {
	const block = tokenSheet
		.split(`:root[data-praxity-chrome-theme="${theme}"] [data-praxity-chrome] {`)[1]
		?.split("}")[0];
	const value = block?.match(new RegExp(`${name}:\\s*([^;]+);`, "u"))?.[1]?.trim();
	if (!value) throw new Error(`Missing ${theme} chrome token ${name}`);
	return value;
}
/**
 * Course CSS shares the frame document and knows this markup. Every handle declaration
 * is !important inside a layer that the lens declares before any course stylesheet:
 * important declarations in the earliest layer outrank all later author CSS, layered or
 * not, including pseudo-elements and states that inline styles cannot reach. The
 * per-mount name stops a course joining the layer or registering the hit-clip property.
 * positionFixed's inline !important geometry still outranks the layer.
 */
function handleGuardCss(nonce: string) {
	const themes = (["light", "dark"] as const).map((theme) => {
		const token = (name: string) => chromeToken(theme, name);
		const root = `:root[data-praxity-chrome-theme="${theme}"]`;
		return `${root} ${HANDLE} { border-color:${token("--edge")}; background:${token("--paper")}; color:${token("--ink-2")}; }
${root} ${HANDLE}[data-selected] { color:${token("--accent")}; border-color:${token("--accent")}; }
${root} ${HANDLE}:focus-visible { box-shadow:0 0 0 2px ${token("--focus-halo")},0 0 0 4px ${token("--focus")}; }`;
	});
	const rules = `${HANDLE} {
  all:initial; box-sizing:border-box; position:fixed; z-index:10; display:flex;
  align-items:center; justify-content:center; width:24px; height:24px; margin:0; zoom:1;
  border:1px solid; border-radius:6px; cursor:pointer; opacity:0; visibility:visible; pointer-events:auto;
  font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  transition:opacity 150ms ease,border-color 150ms ease,background-color 150ms ease,color 150ms ease;
}
${HANDLE}[data-kind="item"] { width:20px; height:20px; z-index:11; }
${HANDLE}:is(:hover,:focus,[data-selected],[data-hovered]), :root[data-praxity-handles="always"] ${HANDLE} { opacity:1; }
${HANDLE}:focus-visible { outline:2px solid transparent; outline-offset:2px; z-index:12; }
${HANDLE}[hidden] { display:none; }
${HANDLE}::before, ${HANDLE}::backdrop { all:initial; display:none; pointer-events:none; }
${HANDLE}::after { all:initial; content:""; position:absolute; inset:-11px; cursor:pointer; clip-path:var(--praxity-hit-clip-${nonce}); }
${HANDLE}[data-kind="item"]::after { inset:-13px -15px -13px -11px; }
${HANDLE} > svg { all:initial; display:block; width:14px; height:14px; overflow:hidden; color:inherit; fill:currentColor; pointer-events:none; }
${HANDLE}[data-kind="item"] > svg { width:12px; height:12px; }
${HANDLE} > svg > circle { all:initial; color:inherit; fill:currentColor; }
${HANDLE} > [data-praxity-chrome="description"] { all:initial; position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
${HANDLE} > [data-praxity-chrome="description"]::before, ${HANDLE} > [data-praxity-chrome="description"]::after { all:initial; content:none; }
/* Course "interactivity: inert" on an ancestor makes top-layer handles inert in Chromium.
   The inert attribute keeps working, and the hostile lens-reveal spec checks it. */
:where(*) { interactivity:auto; }
/* Firefox paints the top layer through a root filter, so a course filter on the root would hide every handle. */
:root { filter:none; }
${themes.join("\n")}
${sourceFieldGuardCss()}
@media(prefers-reduced-motion:reduce) { ${HANDLE} { transition:none; } }`;
	// Every declaration ends in a semicolon; none contains one.
	return `@layer praxity-${nonce} {\n${rules.replaceAll(";", " !important;")}\n}`;
}
