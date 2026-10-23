// Adapted from learning-patterns/patterns/highlight/enhance.js at
// b3f82d2415982da20dda28b61770d7e85084901b. Copyright (c) 2026 Ariel Harlap.
// MIT licensed; see LICENSE in this folder. Studio owns this presentation.
import { getHighlightStrings } from "@praxity/shared-blocks/i18n/highlight-strings";
import { labelWithSeparator } from "@praxity/shared-blocks/i18n/label-separator";
import { resolveLocale } from "@praxity/shared-blocks/i18n/locale";
import type { HighlightContent } from "@praxity/shared-blocks/types";
import { preservePrintFocus } from "@praxity/shared-blocks/viewer/print-focus-return";
import { check, markLimit, validateContent } from "learning-patterns/patterns/highlight/logic.js";
import { strings } from "learning-patterns/patterns/highlight/strings.js";
import { formatCount } from "./format-count.ts";
import { HIGHLIGHT_ADDED_ATTRIBUTES, HIGHLIGHT_RESULT_ATTRIBUTES } from "./recovery.ts";

type Instance = { destroy(): void };
const instances = new WeakMap<HTMLElement, Instance>();

/** Each mount owns only memory. Attach validates the literal presentation before mutation. */
export function enhanceHighlight(root: HTMLElement): Instance {
	const existing = instances.get(root);
	if (existing) return existing;
	const doc = root.ownerDocument;
	const content: HighlightContent = JSON.parse(
		root.getAttribute("data-highlight-content") ?? "null",
	);
	validateContent(content);
	const copy = strings[resolveLocale(root.lang)];
	function required<T extends HTMLElement>(selector: string): T {
		const nodes = root.querySelectorAll<T>(selector);
		if (nodes.length !== 1) throw new Error(`Invalid highlight markup: ${selector}`);
		return nodes[0];
	}
	const passage = required<HTMLElement>("[data-highlight-passage]");
	const instructions = required<HTMLElement>("[data-highlight-instructions]");
	const answer = required<HTMLDetailsElement>("[data-highlight-fallback]");
	const flow = required<HTMLElement>("[data-highlight-flow]");
	const count = required<HTMLElement>("[data-highlight-count]");
	const limit = required<HTMLElement>("[data-highlight-limit]");
	const summary = required<HTMLElement>("[data-highlight-summary]");
	const submit = required<HTMLButtonElement>("[data-highlight-check]");
	const restart = required<HTMLButtonElement>("[data-highlight-restart]");
	const status = required<HTMLElement>("[data-highlight-status]");
	const chunks = [...passage.querySelectorAll<HTMLElement>("span[data-highlight-chunk]")];
	const feedback = [...passage.querySelectorAll<HTMLElement>("span[data-highlight-feedback]")];
	const authored = content.paragraphs.flat();
	const paragraphs = [...passage.children];
	const idCounts = new Map<string, number>();
	for (const node of doc.querySelectorAll("[id]"))
		idCounts.set(node.id, (idCounts.get(node.id) ?? 0) + 1);
	const ids = [
		instructions.id,
		summary.id,
		passage.getAttribute("aria-labelledby"),
		...feedback.map((node) => node.id),
	];
	if (
		!root.lang ||
		answer.tagName !== "DETAILS" ||
		submit.tagName !== "BUTTON" ||
		restart.tagName !== "BUTTON" ||
		root.querySelector("[data-highlight-memory-notice]") ||
		!root.contains(doc.getElementById(passage.getAttribute("aria-labelledby") ?? "")) ||
		ids.some((id) => !id) ||
		new Set(ids).size !== ids.length ||
		ids.some((id) => idCounts.get(id ?? "") !== 1) ||
		paragraphs.length !== content.paragraphs.length ||
		paragraphs.some(
			(p, i) =>
				p.tagName !== "P" ||
				p.children.length !== content.paragraphs[i].length * 2 ||
				content.paragraphs[i].some(
					(item, j) => p.children[j * 2]?.getAttribute("data-highlight-chunk") !== item.id,
				),
		) ||
		chunks.length !== authored.length ||
		feedback.length !== authored.length ||
		chunks.some(
			(chunk, i) =>
				chunk.getAttribute("data-highlight-chunk") !== authored[i].id ||
				chunk.textContent !== authored[i].text ||
				chunk.nextElementSibling !== feedback[i],
		)
	)
		throw new Error("Invalid highlight passage markup");
	// Capture controls that initial projection will hide before changing their visibility.
	const focusedBeforeAttach = doc.activeElement;
	const hidesFocus = [answer, restart, summary, limit, ...feedback].some((node) =>
		node.contains(focusedBeforeAttach),
	);
	const max = markLimit(content);
	const marked = new Set<string>();
	let shown = false,
		destroyed = false;
	const removals: (() => void)[] = [];
	const memory = doc.createElement("p");
	memory.className = "praxity-assessment-choice-hint";
	memory.setAttribute("data-highlight-memory-notice", "");
	memory.textContent = getHighlightStrings(root.lang).highlightMemoryNotice;
	const current = () => !destroyed && root.isConnected && instances.get(root) === instance;
	function listen(target: HTMLElement, type: string, handler: (event: Event) => void) {
		const guarded = (event: Event) => {
			if (current()) handler(event);
		};
		// Record removal first so a partially throwing registration also rolls back.
		removals.push(() => target.removeEventListener(type, guarded));
		target.addEventListener(type, guarded);
	}
	function move(index: number) {
		if (current()) chunks[(index + chunks.length) % chunks.length].focus();
	}
	function paintMarks() {
		chunks.forEach((chunk, i) =>
			chunk.setAttribute("aria-pressed", String(marked.has(authored[i].id))),
		);
		count.textContent = formatCount(copy, marked.size, max);
		restart.hidden = marked.size === 0 && !shown;
	}
	function clearLimit() {
		limit.textContent = "";
		limit.hidden = true;
		status.textContent = "";
	}
	function clearResult() {
		clearLimit();
		for (const chunk of chunks)
			for (const attribute of HIGHLIGHT_RESULT_ATTRIBUTES) chunk.removeAttribute(attribute);
		for (const node of feedback) {
			node.replaceChildren();
			node.hidden = true;
			node.removeAttribute("data-highlight-outcome");
		}
		summary.textContent = "";
		summary.hidden = true;
		restart.removeAttribute("aria-describedby");
		submit.hidden = false;
		answer.open = false;
		answer.hidden = true;
	}
	function toggle(index: number) {
		if (shown) return;
		const id = authored[index].id;
		if (marked.has(id)) {
			marked.delete(id);
			clearLimit();
		} else if (marked.size >= max) {
			if (limit.hidden) {
				const message = (max === 1 ? copy.limitOne : copy.limitMany).replaceAll("{n}", String(max));
				limit.textContent = message;
				limit.hidden = false;
				status.textContent = message;
			}
			return;
		} else marked.add(id);
		paintMarks();
	}
	function show() {
		if (shown) return;
		const focused = doc.activeElement;
		const result = check(
			content,
			authored.filter((item) => marked.has(item.id)).map((item) => item.id),
		);
		clearLimit();
		result.items.forEach((item, i) => {
			const chunk = chunks[i],
				mark = feedback[i];
			chunk.setAttribute("aria-disabled", "true");
			if (item.outcome === "unmarked") return;
			chunk.setAttribute("data-highlight-outcome", item.outcome);
			mark.setAttribute("data-highlight-outcome", item.outcome);
			const labelText =
				item.outcome === "correct"
					? content.mode === "key"
						? copy.correctKey
						: copy.correctEvidence
					: item.outcome === "missed"
						? copy.missed
						: content.mode === "key"
							? copy.wrongKey
							: copy.wrongEvidence;
			const note = item.outcome === "wrong" ? item.note : undefined;
			mark.replaceChildren();
			if (!(content.mode === "evidence" && note)) {
				const label = doc.createElement("span");
				label.className = "praxity-highlight-verdict";
				label.textContent = note ? labelWithSeparator(labelText, root.lang) : labelText;
				mark.append(label);
			}
			if (note) {
				const explanation = doc.createElement("span");
				explanation.className = "praxity-highlight-note";
				explanation.textContent = note;
				mark.append(explanation);
			}
			mark.hidden = false;
			chunk.setAttribute("aria-describedby", mark.id);
		});
		shown = true;
		summary.textContent = (content.mode === "key" ? copy.keySummary : copy.evidenceSummary)
			.replaceAll("{n}", String(result.found))
			.replaceAll("{total}", String(result.total));
		summary.hidden = false;
		restart.setAttribute("aria-describedby", summary.id);
		submit.hidden = true;
		restart.hidden = false;
		answer.hidden = false;
		answer.open = true;
		// A synchronous host callback may destroy this mount or take focus during projection.
		if (
			current() &&
			(doc.activeElement === focused || (focused === submit && doc.activeElement === doc.body))
		)
			restart.focus();
	}
	const instance: Instance = {
		destroy() {
			if (destroyed) return;
			destroyed = true;
			for (const remove of removals) remove();
			marked.clear();
			shown = false;
			clearResult();
			paintMarks();
			for (const chunk of chunks)
				for (const attribute of HIGHLIGHT_ADDED_ATTRIBUTES) chunk.removeAttribute(attribute);
			passage.removeAttribute("aria-describedby");
			flow.hidden = true;
			instructions.hidden = true;
			memory.remove();
			delete root.dataset.highlightEnhanced;
			instances.delete(root);
		},
	};
	try {
		chunks.forEach((chunk, i) => {
			chunk.setAttribute("role", "button");
			chunk.tabIndex = 0;
			listen(chunk, "click", () => toggle(i));
			listen(chunk, "keydown", (event) => {
				const keyboard = event as KeyboardEvent;
				if (keyboard.altKey || keyboard.ctrlKey || keyboard.metaKey) return;
				const key = keyboard.key;
				if (
					![
						"ArrowLeft",
						"ArrowUp",
						"ArrowRight",
						"ArrowDown",
						"Home",
						"End",
						" ",
						"Enter",
					].includes(key)
				)
					return;
				event.preventDefault();
				if (key === " " || key === "Enter") {
					if (!keyboard.repeat) toggle(i);
				} else
					move(
						key === "Home"
							? 0
							: key === "End"
								? chunks.length - 1
								: i + (key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1),
					);
			});
		});
		listen(submit, "click", show);
		// Holding Enter on Check repeats onto Start over after the focus handoff.
		listen(restart, "keydown", (event) => {
			if ((event as KeyboardEvent).repeat) event.preventDefault();
		});
		listen(restart, "click", () => {
			marked.clear();
			shown = false;
			clearResult();
			paintMarks();
			move(0);
		});
		clearResult();
		paintMarks();
		status.className = "praxity-sr-only";
		passage.setAttribute("aria-describedby", instructions.id);
		instructions.hidden = false;
		flow.hidden = false;
		root.append(memory);
		root.dataset.highlightEnhanced = "";
		instances.set(root, instance);
		removals.push(preservePrintFocus(root, current));
		if (hidesFocus && (doc.activeElement === focusedBeforeAttach || doc.activeElement === doc.body))
			move(0);
	} catch (error) {
		instance.destroy();
		// The adapter restores the baseline; bootstrap fills the local failure notice.
		answer.hidden = false;
		throw error;
	}
	return instance;
}
