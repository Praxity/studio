import type { IdentityReadView } from "@praxity/content-identity";
import { normalizeLineEndings } from "@praxity/grammar/src/line-endings.ts";
import { applyEdits, type SourceEdit } from "@praxity/grammar/src/source-edit.ts";
import { canvasTextReplacement, translateRange } from "@praxity/operations/src/ranges.ts";
import type { PreviewNodeRender } from "@praxity/shared-blocks/course-preview-protocol";
import {
	bindInspectionFragmentLinks,
	stripInspectionMarkup,
} from "@praxity/shared-blocks/inspection-markup";
import {
	type CanvasMessages,
	type EditButtonKind,
	editButtonName,
} from "../../shared/canvas-messages";
import { projectPlainStoreMessage, projectPlainStorePath } from "../../shared/project-write-errors";

export interface CanvasTextBinding {
	file: string;
	nodeId: string;
	kind: string;
	field: string;
	text: string;
	baseRevision: string;
	ownerId?: string;
	pageId?: string;
	range?: { start: number; end: number };
}
export interface CanvasTextRequest {
	transactionId: string;
	operation: "setText";
	file: string;
	nodeId: string;
	baseRevision: string;
	expectedText: string;
	field: string;
	text: string;
}
export type CanvasTextReply =
	| {
			ok: true;
			files: { path: string; toRevision: string; edits?: SourceEdit[] }[];
			correspondence?: IdentityReadView["correspondence"];
			render?: PreviewNodeRender;
	  }
	| { ok: false; code: string; messageRef?: { key: string; args: { path: string } } };
export interface CanvasTextPort {
	apply(input: CanvasTextRequest): Promise<CanvasTextReply>;
	snapshot(): Promise<{ fields: CanvasTextBinding[] }>;
}

export interface CanvasTextGeometry {
	connected: boolean;
	visible: boolean;
	box: { top: number; bottom: number; left: number; right: number; width: number; height: number };
	minimum: { width: number; height: number };
	scrollY: number;
	viewport: { width: number; height: number };
	focusDeparted: boolean;
	focused: boolean;
	cornersHit: boolean;
}

function hasCanvasTextSize({ connected, visible, box, minimum }: CanvasTextGeometry) {
	return !(
		!connected ||
		!visible ||
		box.width < minimum.width - 1 ||
		box.height < minimum.height - 1
	);
}

export function canvasTextNeedsFallback(geometry: CanvasTextGeometry): boolean {
	if (!hasCanvasTextSize(geometry)) return true;
	if (geometry.focusDeparted) return false;
	if (!geometry.focused) return true;
	const { box, scrollY, viewport } = geometry;
	// A normal document position can leave the viewport after the author scrolls.
	// Negative document coordinates instead indicate course positioning defeated flow.
	if (
		(box.top < 0 || box.bottom > viewport.height) &&
		box.top + scrollY >= 0 &&
		box.left >= 0 &&
		box.right <= viewport.width
	)
		return false;
	return !geometry.cornersHit;
}

/** One in-memory field, no draft or render lifecycle. */
export function createCanvasTextSession(port: CanvasTextPort, changed: () => void) {
	type Phase = "closed" | "editing" | "saving" | "unknown" | "retry";
	let current: {
		phase: Phase;
		binding?: CanvasTextBinding;
		text: string;
		error: string;
		kept?: boolean;
		plainStorePath?: string;
		outcome?: "saved" | "cancelled";
		cause?: "enter" | "blur";
		revision?: string;
		render?: PreviewNodeRender;
		correspondence?: IdentityReadView["correspondence"];
		edits?: SourceEdit[];
		fields?: CanvasTextBinding[];
	} = { phase: "closed", text: "", error: "" };
	let attempt: CanvasTextRequest | undefined;
	let checking = false;
	let pending: Promise<void> | undefined;
	function saved(
		revision: string,
		correspondence: IdentityReadView["correspondence"] = [],
		render?: PreviewNodeRender,
		edits?: SourceEdit[],
		fields?: CanvasTextBinding[],
	) {
		const ids = new Map(correspondence.map(({ runtimeId, durableId }) => [runtimeId, durableId]));
		const opening = current.binding;
		const range = opening?.range;
		// The operation owns line endings. Retain its acknowledged bytes for the next edit.
		const text =
			opening && range && edits
				? applyEdits(
						opening.text,
						edits.map((edit) => ({
							...edit,
							start: edit.start - range.start,
							end: edit.end - range.start,
						})),
					)
				: current.text;
		const binding =
			fields?.find((field) => field.file === opening?.file && field.nodeId === opening.nodeId) ??
			(current.binding && {
				...current.binding,
				nodeId: ids.get(current.binding.nodeId) ?? current.binding.nodeId,
				...(current.binding.ownerId
					? { ownerId: ids.get(current.binding.ownerId) ?? current.binding.ownerId }
					: {}),
				...(current.binding.pageId
					? { pageId: ids.get(current.binding.pageId) ?? current.binding.pageId }
					: {}),
				text,
				...(range ? { range: { start: range.start, end: range.start + text.length } } : {}),
				baseRevision: revision,
			});
		current = {
			...current,
			phase: "closed",
			outcome: "saved",
			revision,
			render,
			binding,
			correspondence,
			edits,
			fields,
		};
		changed();
	}
	async function check() {
		if (current.phase !== "unknown" || !attempt || checking) return;
		const checkedAttempt = attempt;
		checking = true;
		try {
			const snapshot = await port.snapshot();
			if (current.phase !== "unknown" || attempt !== checkedAttempt) return;
			const field = snapshot.fields.find(
				(field) => field.file === attempt?.file && field.nodeId === attempt.nodeId,
			);
			if (
				field &&
				normalizeLineEndings(field.text) ===
					normalizeLineEndings(canvasTextReplacement(attempt.field, attempt.text))
			)
				saved(field.baseRevision, [], undefined, undefined, snapshot.fields);
			else if (
				field?.baseRevision === attempt.baseRevision &&
				field.text === attempt.expectedText
			) {
				current = { ...current, phase: "retry", error: "unknown" };
				changed();
			} else {
				current = { ...current, phase: "editing", error: "stale" };
				changed();
			}
		} catch (error) {
			console.error("[studio] Canvas saved-byte check failed", error);
			// A failed read is no proof that the write failed. Keep retries fenced.
		} finally {
			checking = false;
		}
	}
	async function send() {
		if (!attempt) return;
		current = { ...current, phase: "saving", error: "", plainStorePath: undefined };
		changed();
		try {
			const reply = await port.apply(attempt);
			if (reply.ok === true) {
				const file = reply.files.find((file) => file.path === attempt?.file);
				if (!file) throw new Error("Missing saved revision");
				saved(file.toRevision, reply.correspondence, reply.render, file.edits);
			} else if (reply.ok === false && typeof reply.code === "string") {
				current = {
					...current,
					phase: "editing",
					error: reply.code,
					kept: true,
					plainStorePath: projectPlainStorePath(reply),
				};
				changed();
			} else throw new Error("Unconfirmed canvas reply");
		} catch (error) {
			console.error("[studio] Canvas save unconfirmed", error);
			current = { ...current, phase: "unknown", error: "unknown", kept: true };
			changed();
			await check();
		}
	}
	return {
		state: () => current,
		open(binding: CanvasTextBinding) {
			if (current.phase !== "closed") return false;
			attempt = undefined;
			current = { phase: "editing", binding: { ...binding }, text: binding.text, error: "" };
			changed();
			return true;
		},
		input(text: string) {
			if (current.phase === "editing") current = { ...current, text };
		},
		async save(cause: "enter" | "blur") {
			const binding = current.binding;
			if (
				current.phase !== "editing" ||
				!binding ||
				(cause === "blur" && current.kept && current.text === attempt?.text)
			)
				return;
			if (
				normalizeLineEndings(current.text) === normalizeLineEndings(binding.text) &&
				!current.kept
			) {
				current = { ...current, phase: "closed", outcome: "cancelled", cause };
				changed();
				return;
			}
			attempt = {
				transactionId: crypto.randomUUID(),
				operation: "setText",
				file: binding.file,
				nodeId: binding.nodeId,
				baseRevision: binding.baseRevision,
				expectedText: binding.text,
				field: binding.field,
				text: current.text,
			};
			current = { ...current, cause };
			pending = send();
			await pending;
		},
		cancel(discard = false) {
			if (current.phase === "saving" || current.phase === "closed" || (current.kept && !discard))
				return false;
			current = { ...current, phase: "closed", outcome: "cancelled", cause: undefined };
			changed();
			return true;
		},
		async retry() {
			// Reuse the immutable transaction if a lost original request arrives late.
			if (current.phase === "retry") {
				pending = send();
				await pending;
			}
		},
		async prepareToLeave() {
			await pending;
			return current.phase === "closed";
		},
		check,
	};
}

/** References admit controls; rendered IDs only locate a snapshot-admitted field. */
// A11y decision, 2026-10-17: one polite announcer and a persistent described error.
// Checking an unknown save changes available actions without repeating its outcome.
// Discard confirmation is a named group; focusing Keep editing exposes its question once.
// Caption buttons sit outside figcaption. An open field replaces its run inside it;
// the figure keeps its captured authored name until its original name attributes return.
// Browser journeys verify focus and markup; NVDA/VoiceOver acceptance is separate.
export function mountCanvasTextFields(
	fields: CanvasTextBinding[],
	port: CanvasTextPort,
	messages: CanvasMessages,
	styles: string,
	status: HTMLElement,
	makeSession: typeof createCanvasTextSession,
	createElement: typeof document.createElement,
	documentRoot: HTMLElement,
	authorToggle: HTMLButtonElement,
	lifecycle?: {
		opened(): void;
		closed(binding?: CanvasTextBinding): void;
		destination?(anchor: HTMLAnchorElement | HTMLAreaElement): Promise<string | undefined>;
		editingChanged?(editing: boolean, focusHidden: boolean): void;
	},
) {
	const listeners = new AbortController();
	let editing = true;
	let unmapped = false;
	const entries: {
		binding: CanvasTextBinding;
		heading: HTMLElement;
		paragraph: boolean;
		nameKind: EditButtonKind;
		host: HTMLDivElement;
		shadow: ShadowRoot;
		button: HTMLButtonElement;
		captionContext: HTMLSpanElement;
		panel: HTMLDivElement;
		field: HTMLTextAreaElement;
		error: HTMLParagraphElement;
		recovery: HTMLDivElement;
		copy: HTMLButtonElement;
		reload: HTMLButtonElement;
		confirm: HTMLDivElement;
		retry: HTMLButtonElement;
		check: HTMLButtonElement;
		originalStyle: string | null;
		minimum: { width: number; height: number };
		figureName?: { element: Element; label: string | null; labelledby: string | null };
	}[] = [];
	let active: (typeof entries)[number] | undefined;
	let composing = false;
	let discardAction: (() => void) | undefined;
	let navigating = false;
	let movingFocus = false;
	let pointerInside = false;
	let fallback = false;
	let bodyWasInert = false;
	const body = Document.prototype.querySelector.call(document, "body");
	const session = makeSession(port, render);
	const geometry =
		"all:initial!important;display:block!important;position:static!important;box-sizing:border-box!important;width:100%!important;margin:0 0 12px!important;padding:0!important;border:0!important;opacity:1!important;visibility:visible!important;transform:none!important;translate:none!important;scale:none!important;rotate:none!important;filter:none!important;clip-path:none!important;zoom:1!important;animation:none!important;transition:none!important;pointer-events:auto!important;max-width:none!important;min-width:0!important;min-height:0!important;overflow:visible!important;content-visibility:visible!important;";
	function button(text: string) {
		const element = createElement("button");
		element.type = "button";
		element.textContent = text;
		return element;
	}
	function focus(element: HTMLElement, preventScroll = false) {
		movingFocus = true;
		try {
			element.focus({ preventScroll });
		} finally {
			movingFocus = false;
		}
	}
	function nameAll() {
		entries.sort((a, b) =>
			a.heading.compareDocumentPosition(b.heading) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
		);
		const counts = new Map<EditButtonKind, number>();
		for (const entry of entries) {
			const n = (counts.get(entry.nameKind) ?? 0) + 1;
			counts.set(entry.nameKind, n);
			entry.button.setAttribute(
				"aria-label",
				editButtonName(messages, entry.nameKind, n, entry.heading.textContent ?? ""),
			);
			if (entry.nameKind === "caption") {
				// Keep controls outside the figure name while showing which run each edits.
				entry.captionContext.textContent = entry.heading.textContent;
			}
		}
	}
	function presentation(root: Document, binding: CanvasTextBinding) {
		// Locate compiler text children so controls and list containers keep their identity.
		const selector =
			binding.field === "subject"
				? ".praxity-block[data-node-id]"
				: binding.kind === "body"
					? ".praxity-block[data-node-id],.praxity-block div[data-node-id],.praxity-block .praxity-block-caption [data-node-id]"
					: binding.kind === "list-entry"
						? ".praxity-block .praxity-text li[data-node-id]"
						: binding.kind === "option"
							? ".praxity-block label.praxity-assessment-choice-option[data-node-id]"
							: ".praxity-block .praxity-block-caption [data-node-id]";
		const matches = [...Document.prototype.querySelectorAll.call(root, selector)].filter(
			(element) => element.getAttribute("data-node-id") === binding.nodeId,
		);
		const elements =
			binding.field === "subject"
				? matches.flatMap((element) =>
						element.matches("h1,h2,h3,h4,h5,h6")
							? [element]
							: [...element.querySelectorAll("h1,h2,h3,h4,h5,h6")],
					)
				: binding.kind === "body"
					? matches.flatMap((element) =>
							element.closest(".praxity-block-caption")
								? [element]
								: [...element.querySelectorAll(":scope > .praxity-text > p, :scope > p")],
						)
					: binding.kind === "list-entry"
						? matches.flatMap((element) => [
								...element.querySelectorAll(":scope > div[data-node-id]"),
							])
						: binding.kind === "option"
							? matches.flatMap((element) => [...element.querySelectorAll(".praxity-choice-label")])
							: matches;
		return { element: elements.length === 1 ? elements[0] : undefined, found: matches.length > 0 };
	}
	function anchor(entry: (typeof entries)[number], open = false) {
		if (entry.binding.kind === "option" && !open) return entry.heading.closest("label");
		// Caption controls must not become part of the figure's caption-derived name.
		if (open) return entry.heading;
		return entry.heading.closest(".praxity-block-caption") ?? entry.heading;
	}
	function restoreFigureName(entry: (typeof entries)[number]) {
		const original = entry.figureName;
		if (!original) return;
		for (const [attribute, value] of [
			["aria-label", original.label],
			["aria-labelledby", original.labelledby],
		] as const) {
			if (value === null) original.element.removeAttribute(attribute);
			else original.element.setAttribute(attribute, value);
		}
		entry.figureName = undefined;
	}
	function reanchor(entry: (typeof entries)[number], open = false) {
		const target = anchor(entry, open);
		if (!target) return;
		// Several caption runs share a caption, but keep their buttons in run order.
		const previous = entries
			.filter(
				(other) =>
					other !== entry &&
					anchor(other, open) === target &&
					Boolean(
						other.heading.compareDocumentPosition(entry.heading) & Node.DOCUMENT_POSITION_FOLLOWING,
					),
			)
			.at(-1);
		const after = previous?.host ?? target;
		if (after.nextSibling !== entry.host) after.after(entry.host);
	}
	function reveal(entry: (typeof entries)[number]) {
		revealControl(entry, entry.button);
	}
	function hitsHost(entry: (typeof entries)[number], box: DOMRect) {
		return [
			[box.left + 4, box.top + 4],
			[(box.left + box.right) / 2, (box.top + box.bottom) / 2],
			[box.right - 4, box.bottom - 4],
		].every(([x, y]) => Document.prototype.elementFromPoint.call(document, x, y) === entry.host);
	}
	function cornersHit(entry: (typeof entries)[number]) {
		const label = entry.panel.querySelector("label");
		const box = entry.field.getBoundingClientRect();
		return Boolean(label && hitsHost(entry, label.getBoundingClientRect()) && hitsHost(entry, box));
	}
	function scrollPort(element: Element) {
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			const overflow = getComputedStyle(parent).overflowY;
			if (overflow !== "auto" && overflow !== "scroll") continue;
			if (parent === document.scrollingElement) break;
			if (parent.scrollHeight <= parent.clientHeight) continue;
			const port = parent.getBoundingClientRect();
			const scale = parent.offsetHeight ? port.height / parent.offsetHeight : 1;
			const top = port.top + parent.clientTop * scale;
			return { top, bottom: top + parent.clientHeight * scale };
		}
		return { top: 0, bottom: innerHeight };
	}
	function revealControl(
		entry: (typeof entries)[number],
		control: HTMLElement,
		block: "nearest" | "center" = "nearest",
	): boolean {
		// Focus decision, 2026-10: nearest and centre alone both lost a tall field's label.
		// Keep native host scrolling; cap the textarea so its own scroll exposes the caret.
		const open = control === entry.field;
		const box = control.getBoundingClientRect();
		const x = (box.left + box.right) / 2;
		let top = 0;
		let bottom = 0;
		for (const element of Document.prototype.querySelectorAll.call(document, "body *")) {
			const style = getComputedStyle(element);
			if (style.position !== "sticky" && style.position !== "fixed") continue;
			const bounds = element.getBoundingClientRect();
			if (x < bounds.left || x > bounds.right || !bounds.height) continue;
			const { top: portTop, bottom: portBottom } =
				style.position === "sticky" ? scrollPort(element) : { top: 0, bottom: innerHeight };
			const start = Math.max(0, portTop, bounds.top);
			const end = Math.min(innerHeight, portBottom, bounds.bottom);
			if (end <= start) continue;
			// Behind-content chrome, including negative z-index, must not reserve space.
			// A higher header can cover the midpoint while leaving this header's edges exposed.
			if (
				![start + 1, (start + end) / 2, end - 1].some((y) => {
					const hit = Document.prototype.elementFromPoint.call(document, x, y);
					return hit && element.contains(hit);
				})
			)
				continue;
			const atTop =
				style.top !== "auto" &&
				(style.bottom === "auto" || bounds.top - portTop <= portBottom - bounds.bottom);
			const overlap = atTop ? bounds.bottom - portTop : portBottom - bounds.top;
			const inset = atTop ? style.top : style.bottom;
			const scale =
				element instanceof HTMLElement && element.offsetHeight
					? bounds.height / element.offsetHeight
					: 1;
			// An unstuck header's flow gap scrolls away; only its box and inset can cover the port.
			const covered =
				style.position === "sticky" && inset.endsWith("px")
					? Math.min(overlap, bounds.height + Math.max(0, Number.parseFloat(inset)) * scale)
					: overlap;
			if (atTop) top = Math.max(top, covered);
			else bottom = Math.max(bottom, covered);
		}
		const hostBox = entry.host.getBoundingClientRect();
		const scale = entry.host.offsetHeight ? hostBox.height / entry.host.offsetHeight : 1;
		if (open) {
			// Let the native textarea scroll its caret while the label stays above course chrome.
			const port = scrollPort(entry.host);
			const height = Math.min(innerHeight, port.bottom - port.top);
			entry.field.style.maxHeight = `${Math.max(entry.minimum.height, (height - top - bottom - 16 - (box.top - hostBox.top)) / scale)}px`;
		}
		// A recovery control needs its own margin; scrolling its whole panel can hide the target.
		const target = open || control === entry.button ? entry.host : control;
		target.style.setProperty("scroll-margin-top", `${top / scale + 8}px`, "important");
		target.style.setProperty("scroll-margin-bottom", `${bottom / scale + 8}px`, "important");
		const visible = () =>
			open ? cornersHit(entry) : hitsHost(entry, control.getBoundingClientRect());
		// Leave a visible pointer target in place until its click completes.
		if (visible()) return true;
		target.scrollIntoView({ block, inline: "nearest", behavior: "instant" });
		// Nearest can uncover other sticky chrome; measure it again before the one centre pass.
		return visible() || (block === "nearest" && revealControl(entry, control, "center"));
	}
	function usable(entry: (typeof entries)[number]) {
		const box = entry.field.getBoundingClientRect();
		const geometry: CanvasTextGeometry = {
			connected: entry.host.isConnected,
			visible: entry.field.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
			box,
			minimum: entry.minimum,
			scrollY,
			viewport: { width: innerWidth, height: innerHeight },
			focusDeparted: false,
			focused: false,
			cornersHit: false,
		};
		if (!hasCanvasTextSize(geometry)) return false;
		const focused = entry.shadow.activeElement;
		const courseFocus = Document.prototype.querySelector.call(document, ":focus");
		// Resize can follow a legitimate departure while a save is pending.
		geometry.focusDeparted = Boolean(
			!focused &&
				courseFocus &&
				courseFocus !== body &&
				courseFocus !== documentRoot &&
				courseFocus !== entry.host,
		);
		if (!geometry.focusDeparted && (!focused || !entry.panel.contains(focused)))
			focus(entry.field, true);
		geometry.focused = Boolean(entry.shadow.activeElement);
		geometry.cornersHit = cornersHit(entry);
		return !canvasTextNeedsFallback(geometry);
	}
	function protect(entry: (typeof entries)[number], covered = false) {
		if (active !== entry || fallback || (!covered && usable(entry))) return;
		// Native caret scrolling after a resize can leave the field under sticky course chrome.
		// Try its normal document position before treating the course CSS as a flow failure.
		if (revealControl(entry, entry.field) && usable(entry)) return;
		const focused = entry.shadow.activeElement;
		fallback = true;
		bodyWasInert = body instanceof HTMLElement && body.inert;
		// The panel remains outside body; nothing behind this exceptional field is actionable.
		movingFocus = true;
		try {
			documentRoot.append(entry.host);
			if (body instanceof HTMLElement) body.inert = true;
			entry.host.setAttribute("popover", "manual");
			const authorRoot = status.getRootNode();
			// Keep the toggle reachable even when the author scrolls back to the header.
			const top =
				authorRoot instanceof ShadowRoot ? authorRoot.host.getBoundingClientRect().height + 16 : 8;
			entry.host.style.cssText =
				geometry +
				`position:fixed!important;inset:${top}px 8px 8px!important;margin:auto!important;width:calc(100% - 16px)!important;max-width:720px!important;max-height:calc(100dvh - ${top + 8}px)!important;overflow:auto!important;`;
			entry.host.showPopover();
			entry.panel.setAttribute("role", "group");
			entry.panel.setAttribute("aria-labelledby", "field-label");
		} finally {
			movingFocus = false;
		}
		focus(
			focused instanceof HTMLElement && entry.panel.contains(focused) ? focused : entry.field,
			true,
		);
	}
	function sizeField(entry: (typeof entries)[number]) {
		entry.field.rows = Math.max(2, entry.field.value.split("\n").length);
		// scrollHeight includes soft-wrapped lines in engines without field-sizing.
		entry.field.style.height = "auto";
		entry.field.style.height = `${entry.field.scrollHeight + 2}px`;
	}
	function revealField(entry: (typeof entries)[number]) {
		const visible = revealControl(entry, entry.field);
		protect(entry, !visible);
		// Opening selects the end before layout; a new height cap must expose that caret too.
		entry.field.scrollTop = entry.field.scrollHeight;
	}
	function confirmDiscard(action: () => void, kind: "reload" | "leave" | "cancel") {
		if (!active || session.state().phase === "saving") return;
		discardAction = action;
		active.confirm
			.querySelector("p")
			?.replaceChildren(messages[kind === "reload" ? "confirmReload" : "confirmDiscard"]);
		const discard = active.confirm.querySelector("button");
		if (discard)
			discard.textContent =
				messages[
					kind === "reload" ? "discardReload" : kind === "leave" ? "discardLeave" : "discardText"
				];
		active.confirm.hidden = false;
		if (active) sizeField(active);
		active.confirm.lastElementChild instanceof HTMLElement &&
			focus(active.confirm.lastElementChild);
	}
	function render() {
		const state = session.state();
		for (const entry of entries)
			entry.button.setAttribute("aria-disabled", String(state.phase !== "closed"));
		if (!active) return;
		const entry = active;
		if (state.phase === "closed") {
			const returnFocus =
				(state.outcome === "cancelled" && state.cause !== "blur") ||
				(state.cause === "enter" && entry.shadow.activeElement === entry.field);
			if (state.outcome === "saved") {
				const ids = new Map(
					state.correspondence?.map(({ runtimeId, durableId }) => [runtimeId, durableId]),
				);
				for (const other of entries) {
					other.binding.nodeId = ids.get(other.binding.nodeId) ?? other.binding.nodeId;
					if (other.binding.ownerId)
						other.binding.ownerId = ids.get(other.binding.ownerId) ?? other.binding.ownerId;
					if (other.binding.pageId)
						other.binding.pageId = ids.get(other.binding.pageId) ?? other.binding.pageId;
				}
				for (const element of Document.prototype.querySelectorAll.call(
					document,
					".praxity-block[data-node-id],.praxity-block [data-node-id]",
				)) {
					const next = ids.get(element.getAttribute("data-node-id") ?? "");
					if (next) element.setAttribute("data-node-id", next);
				}
				try {
					if (state.render) {
						const doc = new DOMParser().parseFromString(
							state.render.fragments.map((fragment) => fragment.html).join(""),
							"text/html",
						);
						stripInspectionMarkup(doc, true);
						bindInspectionFragmentLinks(doc, `${location.origin}${location.pathname}`);
						const saved = presentation(doc, entry.binding).element;
						if (saved) {
							entry.heading.replaceChildren(...saved.childNodes);
						}
					}
				} catch (error) {
					console.error("[studio] Saved presentation unavailable", error);
				}
				for (const other of entries) {
					if (
						other !== entry &&
						other.binding.file === entry.binding.file &&
						other.binding.range &&
						state.edits
					)
						other.binding.range =
							translateRange(other.binding.range.start, other.binding.range.end, state.edits) ??
							undefined;
				}
				Object.assign(entry.binding, state.binding);
				for (const other of entries) {
					const admitted = state.fields?.find(
						(field) => field.file === other.binding.file && field.nodeId === other.binding.nodeId,
					);
					if (admitted) Object.assign(other.binding, admitted);
				}
				for (const other of entries)
					if (other.binding.file === entry.binding.file && state.revision)
						other.binding.baseRevision = state.revision;
				nameAll();
			}
			if (entry.originalStyle === null) entry.heading.removeAttribute("style");
			else entry.heading.setAttribute("style", entry.originalStyle);
			entry.button.hidden = false;
			entry.panel.hidden = true;
			active = undefined;
			discardAction = undefined;
			if (fallback) {
				entry.host.hidePopover();
				entry.host.removeAttribute("popover");
				entry.host.style.cssText = geometry;
				if (body instanceof HTMLElement) body.inert = bodyWasInert;
				fallback = false;
				entry.panel.removeAttribute("role");
				entry.panel.removeAttribute("aria-labelledby");
			}
			reanchor(entry);
			restoreFigureName(entry);
			status.textContent = state.outcome === "saved" ? messages.saved : messages.cancelled;
			status.classList.remove("announcement-only");
			if (active) sizeField(active);
			if (returnFocus) {
				focus(entry.button);
				if (entry.shadow.activeElement !== entry.button) focus(authorToggle);
			}
			lifecycle?.closed(state.outcome === "saved" ? state.binding : undefined);
			return;
		}
		entry.field.readOnly = state.phase !== "editing";
		entry.panel.setAttribute("aria-busy", String(state.phase === "saving"));
		if (state.phase === "saving") {
			if (status.textContent) status.textContent = "";
			entry.confirm.hidden = true;
			discardAction = undefined;
		}
		const stale = ["stale", "conflict", "orphaned", "ambiguous"].includes(state.error);
		const identityPending = state.error === "identity-retirement-pending";
		const text =
			state.plainStorePath !== undefined
				? projectPlainStoreMessage(
						state.plainStorePath,
						documentRoot.lang.startsWith("fr") ? "fr" : "en",
					)
				: identityPending
					? messages.identityReviewPending
					: stale
						? messages.fileChanged
						: ((
								{
									"empty-text": messages.emptyText,
									"line-break": messages.lineBreak,
									"unsupported-syntax": messages.unsupportedSyntax,
									"list-marker": messages.listMarker,
									settings: messages.settings,
									unknown: messages.unknown,
								} as Record<string, string>
							)[state.error] ?? (state.error ? messages.refused : ""));
		// Change the persistent error only on an outcome, never for typing or repeated renders.
		if (entry.error.textContent !== text) {
			entry.error.textContent = text;
			if (text) {
				status.classList.add("announcement-only");
				status.textContent = text;
				if (identityPending) focus(entry.field);
			}
		}
		entry.error.hidden = !text;
		entry.reload.textContent = identityPending ? messages.reviewChanges : messages.reload;
		const firstRecovery = identityPending ? entry.reload : entry.copy;
		if (entry.recovery.firstElementChild !== firstRecovery) entry.recovery.prepend(firstRecovery);
		entry.field.setAttribute("aria-describedby", `hint${text ? " error" : ""}`);
		entry.field.setAttribute("aria-invalid", String(Boolean(text)));
		entry.recovery.hidden =
			!text ||
			["empty-text", "line-break", "unsupported-syntax", "list-marker", "settings"].includes(
				state.error,
			);
		entry.retry.hidden = state.phase !== "retry";
		entry.check.hidden = state.phase !== "unknown";
		if (active) sizeField(active);
	}
	const nameKinds = new Map<string, EditButtonKind>([
		["heading.subject", "heading"],
		["page.subject", "heading"],
		["body.text", "paragraph"],
		["list-entry.text", "listItem"],
		["option.text", "choiceLabel"],
		["part.value", "caption"],
	]);
	function update(fields: CanvasTextBinding[]) {
		unmapped = false;
		const retained = new Set<HTMLElement>();
		for (const binding of fields) {
			const mappedKind = nameKinds.get(`${binding.kind}.${binding.field}`);
			if (!mappedKind) continue;
			const located = presentation(document, binding);
			const heading = located.element;
			if (!(heading instanceof HTMLElement)) {
				if (located.found) unmapped = true;
				continue;
			}
			retained.add(heading);
			const existing = entries.find((entry) => entry.heading === heading);
			if (existing) {
				Object.assign(existing.binding, binding);
				continue;
			}
			const host = createElement("div");
			host.id = `studio-${crypto.randomUUID()}`;
			host.style.cssText = geometry;
			const shadow = host.attachShadow({ mode: "open" });
			const style = createElement("style");
			style.textContent = styles;
			const root = createElement("div");
			root.className = "studio";
			const edit = button(messages.editButton);
			edit.className = "edit";
			const captionContext = createElement("span");
			captionContext.className = "caption-context";
			captionContext.setAttribute("aria-hidden", "true");
			const panel = createElement("div");
			panel.className = "field";
			panel.hidden = true;
			const label = createElement("label");
			label.htmlFor = "heading";
			label.id = "field-label";
			const paragraph = binding.kind === "body" && !heading.closest(".praxity-block-caption");
			label.textContent = paragraph
				? messages.paragraphText
				: binding.kind === "list-entry"
					? messages.listItemText
					: binding.kind === "option"
						? messages.choiceLabelText
						: binding.field === "subject"
							? messages.headingText
							: messages.textLabel;
			const hint = createElement("p");
			hint.id = "hint";
			hint.textContent = paragraph ? messages.paragraphHint : messages.hint;
			const field = createElement("textarea");
			field.id = "heading";
			field.rows = 2;
			field.setAttribute("aria-describedby", "hint");
			const error = createElement("p");
			error.id = "error";
			error.style.whiteSpace = "pre-wrap";
			error.hidden = true;
			const recovery = createElement("div");
			recovery.className = "actions";
			recovery.hidden = true;
			const copy = button(messages.copyText);
			const reload = button(messages.reload);
			const retry = button(messages.retrySave);
			retry.hidden = true;
			const check = button(messages.checkSaved);
			check.hidden = true;
			const confirm = createElement("div");
			confirm.hidden = true;
			confirm.setAttribute("role", "group");
			confirm.setAttribute("aria-labelledby", "discard-question");
			const question = createElement("p");
			question.id = "discard-question";
			question.textContent = messages.confirmReload;
			const discard = button(messages.discardReload);
			const keep = button(messages.keepEditing);
			confirm.append(question, discard, keep);
			recovery.append(copy, reload, retry, check);
			panel.append(label, hint, field, error, recovery, confirm);
			root.append(edit, panel, captionContext);
			shadow.append(style, root);
			const entry: (typeof entries)[number] = {
				binding,
				heading,
				paragraph,
				nameKind: binding.kind === "body" && !paragraph ? "caption" : mappedKind,
				host,
				shadow,
				button: edit,
				captionContext,
				panel,
				field,
				error,
				recovery,
				copy,
				reload,
				retry,
				check,
				confirm,
				originalStyle: heading.getAttribute("style"),
				minimum: { width: 0, height: 0 },
			};
			entries.push(entry);
			reanchor(entry);
			if (!editing) host.style.setProperty("display", "none", "important");
			host.addEventListener("click", (event) => event.preventDefault());
			edit.addEventListener("focus", () => {
				// Pointer focus precedes click in Firefox; moving its target loses that click.
				if (active || !edit.matches(":focus-visible")) return;
				reveal(entry);
			});
			edit.addEventListener("click", (event) => {
				if (!event.isTrusted || active || !editing) return;
				active = entry;
				entry.originalStyle = heading.getAttribute("style");
				const caption = heading.closest("figcaption");
				const figure = caption?.closest("figure");
				if (caption instanceof HTMLElement && figure) {
					entry.figureName = {
						element: figure,
						label: figure.getAttribute("aria-label"),
						labelledby: figure.getAttribute("aria-labelledby"),
					};
					// The field replaces its run inside figcaption, while the figure keeps its authored name.
					figure.setAttribute("aria-label", entry.figureName.label ?? caption.innerText);
					figure.removeAttribute("aria-labelledby");
				}
				heading.style.setProperty("display", "none", "important");
				reanchor(entry, true);
				edit.hidden = true;
				panel.hidden = false;
				confirm.hidden = true;
				field.value = binding.text;
				composing = false;
				status.textContent = "";
				lifecycle?.opened();
				session.open(binding);
				sizeField(entry);
				// Layout pixels survive course transforms; content may shrink back to the CSS minimum.
				entry.minimum = {
					width: field.offsetWidth,
					height: Number.parseFloat(getComputedStyle(field).minHeight),
				};
				focus(field, true);
				field.setSelectionRange(field.value.length, field.value.length);
				revealField(entry);
				requestAnimationFrame(() => {
					if (active === entry) protect(entry, !cornersHit(entry));
				});
			});
			field.addEventListener("input", (event) => {
				if (event.isTrusted) {
					session.input(field.value);
					sizeField(entry);
				}
			});
			field.addEventListener("compositionstart", (event) => {
				if (event.isTrusted) composing = true;
			});
			field.addEventListener("compositionend", () => {
				// Chromium commits a native IME with an untrusted compositionend.
				composing = false;
			});
			field.addEventListener("keydown", (event) => {
				if (!event.isTrusted || composing || event.isComposing || event.keyCode === 229) return;
				if (event.key === "Enter" && event.shiftKey && !paragraph) {
					event.preventDefault();
					return;
				}
				if (
					event.key === "Enter" &&
					!event.altKey &&
					!event.ctrlKey &&
					!event.metaKey &&
					!event.shiftKey
				) {
					event.preventDefault();
					void session.save("enter");
				}
			});
			field.addEventListener("blur", (event) => {
				if (!event.isTrusted) return;
				if (
					movingFocus ||
					pointerInside ||
					!confirm.hidden ||
					(event.relatedTarget instanceof Node && panel.contains(event.relatedTarget))
				)
					return;
				if (!event.relatedTarget && !fallback && !usable(entry)) {
					protect(entry);
					return;
				}
				if (!event.relatedTarget && fallback) {
					focus(field, true);
					return;
				}
				if (!composing) void session.save("blur");
				composing = false;
			});
			panel.addEventListener("focusin", (event) => {
				const target = event.target;
				requestAnimationFrame(() => {
					if (target instanceof HTMLElement && shadow.activeElement === target) {
						revealControl(entry, target);
					}
				});
			});
			panel.addEventListener("keydown", (event) => {
				if (!event.isTrusted) return;
				if (composing || event.isComposing || event.keyCode === 229) {
					if (event.key === "Tab") event.preventDefault();
					return;
				}
				pointerInside = false;
				if (event.key === "Escape") {
					event.preventDefault();
					if (!session.cancel()) confirmDiscard(() => session.cancel(true), "cancel");
					return;
				}
				if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
				const controls = [...panel.querySelectorAll<HTMLElement>("textarea,button")].filter(
					(control) =>
						!control.matches(":disabled") && control.checkVisibility({ checkVisibilityCSS: true }),
				);
				const index = controls.indexOf(event.target as HTMLElement);
				if (controls[index + (event.shiftKey ? -1 : 1)]) return;
				if (confirm.hidden) void session.save("blur");
				// Let native Tab traversal continue from the heading, including shadow roots and radios.
				if (session.state().phase === "closed" && !event.shiftKey) focus(edit, true);
				else {
					host.tabIndex = -1;
					const tabStops = controls.map(
						(control) => [control, control.getAttribute("tabindex")] as const,
					);
					for (const control of controls) control.tabIndex = -1;
					focus(host, true);
					// Keep its shadow controls out of this native traversal, then restore entry.
					setTimeout(() => {
						host.removeAttribute("tabindex");
						for (const [control, value] of tabStops) {
							if (value === null) control.removeAttribute("tabindex");
							else control.setAttribute("tabindex", value);
						}
					}, 0);
				}
			});
			copy.addEventListener("click", async (event) => {
				if (!event.isTrusted) return;
				try {
					await navigator.clipboard.writeText(field.value);
					status.classList.remove("announcement-only");
					status.textContent = messages.copied;
				} catch (error) {
					console.error("[studio] Canvas copy failed", error);
					focus(field);
					field.select();
					status.classList.remove("announcement-only");
					status.textContent = messages.copyFailed;
				}
			});
			reload.addEventListener("click", (event) => {
				if (event.isTrusted) confirmDiscard(() => location.reload(), "reload");
			});
			keep.addEventListener("click", (event) => {
				if (event.isTrusted) {
					confirm.hidden = true;
					discardAction = undefined;
					if (active) sizeField(active);
					focus(field);
				}
			});
			discard.addEventListener("click", (event) => {
				if (!event.isTrusted || !discardAction) return;
				const action = discardAction;
				discardAction = undefined;
				// Explicit discard also releases the unload guard for navigation/reload.
				if (session.cancel(true)) action();
			});
			retry.addEventListener("click", (event) => {
				if (event.isTrusted) void session.retry();
			});
			check.addEventListener("click", (event) => {
				if (event.isTrusted) void session.check();
			});
		}
		for (const entry of [...entries]) {
			if (retained.has(entry.heading)) continue;
			observer.unobserve(entry.host);
			observer.unobserve(entry.heading);
			entry.host.remove();
			entries.splice(entries.indexOf(entry), 1);
		}
		for (const entry of entries) {
			observer.observe(entry.host);
			observer.observe(entry.heading);
		}
		nameAll();
		for (const entry of entries) if (active !== entry) reanchor(entry);
		if (active) sizeField(active);
	}
	function showEditing(value: boolean) {
		if (editing === value) return;
		const focusHidden = entries.some((entry) => entry.shadow.activeElement !== null);
		editing = value;
		for (const entry of entries) {
			entry.host.style.setProperty("display", value ? "block" : "none", "important");
		}
		status.textContent = value ? messages.editingOn : messages.editingOff;
		status.classList.remove("announcement-only");
		lifecycle?.editingChanged?.(value, focusHidden);
		if (active) sizeField(active);
	}
	EventTarget.prototype.addEventListener.call(
		document,
		"pointerdown",
		(event: Event) => {
			if (event.isTrusted)
				// The author panel saves on activation. Closing on mousedown can shrink the
				// document and move its toggle before the matching pointerup/click arrives.
				pointerInside = Boolean(
					active &&
						(event.composedPath().includes(active.panel) ||
							event.composedPath().includes(status.getRootNode())),
				);
		},
		{ capture: true, signal: listeners.signal },
	);
	EventTarget.prototype.addEventListener.call(
		document,
		"pointerup",
		() => {
			setTimeout(() => {
				pointerInside = false;
			}, 0);
		},
		{ signal: listeners.signal },
	);
	EventTarget.prototype.addEventListener.call(
		document,
		"click",
		async (event: Event) => {
			if (
				!(event instanceof MouseEvent) ||
				!event.isTrusted ||
				event.defaultPrevented ||
				!active ||
				event.button !== 0 ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				event.altKey
			)
				return;
			const anchor = event
				.composedPath()
				.find(
					(node): node is HTMLAnchorElement | HTMLAreaElement =>
						node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement,
				);
			if (!anchor?.href) return;
			const linkTarget = anchor.target.toLowerCase();
			if (
				linkTarget &&
				linkTarget !== "_self" &&
				!(["_top", "_parent"].includes(linkTarget) && window.top === window)
			)
				return;
			const target = new URL(anchor.href);
			if (
				target.origin === location.origin &&
				target.pathname === location.pathname &&
				target.search === location.search &&
				target.hash
			)
				return;
			event.preventDefault();
			if (navigating) return;
			navigating = true;
			if (active.confirm.hidden) await session.save("blur");
			const leave = async () =>
				location.assign((await lifecycle?.destination?.(anchor)) ?? target.href);
			if (await session.prepareToLeave()) await leave();
			else confirmDiscard(leave, "leave");
			navigating = false;
		},
		{ capture: true, signal: listeners.signal },
	);
	window.addEventListener(
		"beforeunload",
		(event) => {
			const state = session.state();
			if (state.phase === "saving" || (state.phase !== "closed" && state.kept)) {
				event.preventDefault();
				event.returnValue = "";
			}
		},
		{ signal: listeners.signal },
	);
	const observer = new ResizeObserver(() => {
		if (active && !fallback) protect(active);
		const focused = entries.find((entry) => entry.shadow.activeElement === entry.button);
		if (focused) reveal(focused);
	});
	// A loaded image moves later runs without resizing their own hosts.
	if (body) observer.observe(body);
	update(fields);
	function dispose() {
		observer.disconnect();
		listeners.abort();
		if (fallback && body instanceof HTMLElement) body.inert = bodyWasInert;
		if (active) {
			restoreFigureName(active);
			if (active.originalStyle === null) active.heading.removeAttribute("style");
			else active.heading.setAttribute("style", active.originalStyle);
		}
		for (const entry of entries) {
			entry.host.remove();
		}
	}
	window.addEventListener("pagehide", dispose, { once: true, signal: listeners.signal });
	return {
		isEditing: () => editing,
		async setEditing(value: boolean) {
			if (value === editing) return;
			if (!value && active) {
				if (!session.state().kept) await session.save("blur");
				if (!(await session.prepareToLeave())) {
					confirmDiscard(() => showEditing(false), "cancel");
					return;
				}
			}
			showEditing(value);
		},
		isOpen: () => session.state().phase !== "closed",
		get unmapped() {
			return unmapped;
		},
		update,
		owns: (node: Node) => entries.some((entry) => entry.host === node),
		focusedBinding: () =>
			entries.find((entry) => entry.shadow.activeElement === entry.button)?.binding,
		focusBinding(binding: CanvasTextBinding) {
			// An outside rename can retire a runtime ID. Source position restores focus only.
			const entry =
				entries.find((entry) => entry.binding.nodeId === binding.nodeId) ??
				entries.find(
					(entry) =>
						binding.range &&
						entry.binding.file === binding.file &&
						entry.binding.kind === binding.kind &&
						entry.binding.field === binding.field &&
						entry.binding.range?.start === binding.range.start,
				);
			if (entry) {
				focus(entry.button);
				reveal(entry);
				requestAnimationFrame(() => {
					if (entry.shadow.activeElement === entry.button) reveal(entry);
				});
			}
		},
		dispose,
	};
}
