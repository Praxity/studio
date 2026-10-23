import {
	selfCheckConsumers,
	selfCheckEpochTicket,
	setSelfCheckTimeout,
} from "../self-check-consumers";
import { scrollElementIntoView } from "./scroll-into-view";

let _reqMsgCounter = 0;
let _activeRequiredValidationBlock: HTMLElement | null = null;
let _highlightTimer: ReturnType<typeof setSelfCheckTimeout> | undefined;
let _ownedAria:
	| {
			element: HTMLElement;
			invalid: string | null;
			messageId: string;
			required: string | null;
	  }
	| undefined;

/** Contextual validation messages by block type. */
const REQUIRED_MESSAGES: Record<string, string> = {
	assessment: "Please attempt this question",
	checklist: "Please complete this checklist",
	rating: "Please provide a rating",
	signature: "Please sign above",
	card: "Please review these cards",
};

export interface RequiredBlocksResult {
	valid: boolean;
	firstIncomplete: HTMLElement | null;
	blockType: string | null;
}

export function getActiveRequiredValidationBlock(): HTMLElement | null {
	return _activeRequiredValidationBlock;
}

/**
 * Check whether an attribute is "true" on the element itself OR any descendant.
 * This is necessary because `data-required` is set on the `.praxity-block` wrapper
 * by the logic engine, but React components set completion attributes (like
 * `data-completed`) on inner elements (Card, section, div).
 */
function hasAttrTrue(el: HTMLElement, attr: string): boolean {
	if (el.getAttribute(attr) === "true") return true;
	return el.querySelector(`[${attr}="true"]`) !== null;
}

/** Read a numeric attribute from the element or any descendant. */
function readNumericAttr(el: HTMLElement, attr: string): number {
	const val = el.getAttribute(attr);
	if (val !== null) return Number(val);
	const child = el.querySelector(`[${attr}]`);
	if (child) return Number(child.getAttribute(attr) ?? 0);
	return 0;
}

export function isRequiredBlockComplete(el: HTMLElement): boolean {
	if (el.dataset.blockType === "selfCheck" || el.querySelector("[data-self-check]")) {
		const id =
			el.dataset.blockId ??
			el.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ??
			"";
		const activity = selfCheckConsumers(el.ownerDocument)?.read(id);
		return activity?.ready === true && activity.available && activity.completed;
	}
	if (
		hasAttrTrue(el, "data-completed") ||
		hasAttrTrue(el, "data-signed") ||
		hasAttrTrue(el, "data-paid")
	) {
		return true;
	}
	const minRequired = el.getAttribute("data-required-min");
	if (!minRequired) return false;
	const min = Number(minRequired);
	const blockType = el.getAttribute("data-block-type");
	if (blockType === "checklist") {
		return el.querySelectorAll("[data-checklist-item][data-checked]").length >= min;
	}
	if (blockType === "card") return readNumericAttr(el, "data-flipped-count") >= min;
	return false;
}

/** Check if all [data-required] blocks have been completed.
 *
 * Uses `data-completed` as the primary signal, plus the block-specific
 * `data-signed` and `data-paid` completion signals. Does NOT use `data-attempted`
 * — a graded assessment that has been attempted but not completed (e.g.
 * wrong answer, attempts remaining) should still block forward navigation.
 */
export function checkRequiredBlocks(): RequiredBlocksResult {
	if (typeof document === "undefined")
		return { valid: true, firstIncomplete: null, blockType: null };
	const requiredEls = document.querySelectorAll('[data-required="true"]');
	for (let i = 0; i < requiredEls.length; i++) {
		const el = requiredEls[i] as HTMLElement;
		if (el.closest("[hidden]")) continue;
		const blockType = el.getAttribute("data-block-type") ?? null;
		if (!isRequiredBlockComplete(el)) {
			return { valid: false, firstIncomplete: el, blockType };
		}
	}
	return { valid: true, firstIncomplete: null, blockType: null };
}

/** Remove any existing validation messages and highlight rings. */
export function clearRequiredValidation(): void {
	if (typeof document === "undefined") return;
	clearTimeout(_highlightTimer);
	_highlightTimer = undefined;
	if (_ownedAria) {
		for (const [attribute, value] of [
			["aria-invalid", _ownedAria.invalid],
			["aria-required", _ownedAria.required],
		] as const) {
			if (value === null) _ownedAria.element.removeAttribute(attribute);
			else _ownedAria.element.setAttribute(attribute, value);
		}
		const describedBy = (_ownedAria.element.getAttribute("aria-describedby") ?? "")
			.split(/\s+/)
			.filter((id) => id && id !== _ownedAria?.messageId);
		if (describedBy.length > 0) {
			_ownedAria.element.setAttribute("aria-describedby", describedBy.join(" "));
		} else {
			_ownedAria.element.removeAttribute("aria-describedby");
		}
		_ownedAria.element.removeAttribute("data-required-validation-target");
		_ownedAria = undefined;
	}
	_activeRequiredValidationBlock = null;
	for (const el of document.querySelectorAll(".praxity-required-message")) {
		el.remove();
	}
	for (const el of document.querySelectorAll("[data-required-highlight]")) {
		el.removeAttribute("data-required-highlight");
	}
	for (const el of document.querySelectorAll('[data-required-validation-target="true"]')) {
		el.removeAttribute("data-required-validation-target");
	}
}

function findFirstInvalidTarget(root: HTMLElement): HTMLElement | null {
	return root.querySelector<HTMLElement>(
		[
			'input:not([type="hidden"]):not([disabled])',
			"select:not([disabled])",
			"textarea:not([disabled])",
			'button:not([disabled]):not([aria-disabled="true"])',
			'[role="radio"][tabindex]',
			'[role="checkbox"][tabindex]',
			'[role="combobox"]',
			'[tabindex]:not([tabindex="-1"])',
		].join(", "),
	);
}

/** Show validation UI for the first incomplete required block.
 *  Injects a contextual message, applies a highlight ring (2s), and scrolls to it.
 *  Returns true if validation failed (blocked), false if all clear.
 */
export function showRequiredValidation(): boolean {
	clearRequiredValidation();
	const result = checkRequiredBlocks();
	if (result.valid || !result.firstIncomplete) return false;

	const message =
		result.firstIncomplete.querySelector<HTMLElement>("[data-self-check]")?.dataset
			.selfCheckIncomplete ??
		REQUIRED_MESSAGES[result.blockType ?? ""] ??
		"Please complete this activity";
	const msgEl = document.createElement("div");
	msgEl.className = "praxity-required-message";
	msgEl.setAttribute("role", "alert");
	msgEl.textContent = message;
	const msgId = `praxity-required-msg-${++_reqMsgCounter}`;
	msgEl.id = msgId;
	const invalidTarget = findFirstInvalidTarget(result.firstIncomplete) ?? result.firstIncomplete;
	_ownedAria = {
		element: invalidTarget,
		invalid: invalidTarget.getAttribute("aria-invalid"),
		messageId: msgId,
		required: invalidTarget.getAttribute("aria-required"),
	};
	invalidTarget.setAttribute("aria-invalid", "true");
	invalidTarget.setAttribute(
		"aria-describedby",
		[...new Set([...(invalidTarget.getAttribute("aria-describedby")?.split(/\s+/) ?? []), msgId])]
			.filter(Boolean)
			.join(" "),
	);
	invalidTarget.setAttribute("aria-required", "true");
	invalidTarget.setAttribute("data-required-validation-target", "true");
	result.firstIncomplete.after(msgEl);

	_activeRequiredValidationBlock = result.firstIncomplete;
	result.firstIncomplete.setAttribute("data-required-highlight", "true");
	const validation = _ownedAria;
	const current = selfCheckEpochTicket();
	_highlightTimer = setSelfCheckTimeout(
		() => {
			if (_ownedAria !== validation || !current()) return;
			_highlightTimer = undefined;
			result.firstIncomplete?.removeAttribute("data-required-highlight");
		},
		2000,
		current,
	);

	scrollElementIntoView(invalidTarget, { block: "center" });
	// Ensure keyboard/screen-reader users land on actionable control.
	if (!invalidTarget.matches("input, select, textarea, button, [tabindex], a")) {
		invalidTarget.setAttribute("tabindex", "-1");
	}
	invalidTarget.focus({ preventScroll: true });
	return true;
}
