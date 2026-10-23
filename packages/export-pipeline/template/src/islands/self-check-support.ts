import { createContentReveal } from "@praxity/shared-blocks/content-reveal";
import { resolveLocale } from "@praxity/shared-blocks/i18n/locale";
import { getSelfCheckActivationStrings } from "@praxity/shared-blocks/i18n/self-check-host-strings";
import {
	formatSelfCheckCounts,
	getSelfCheckIslandStrings,
} from "@praxity/shared-blocks/i18n/self-check-island-strings";
import type { LearnerBlockResponseTruncated } from "@praxity/shared-blocks/learner-block-response";
import type {
	SelfCheckCommand,
	SelfCheckOperations,
	SelfCheckReference,
} from "@praxity/shared-blocks/self-check-session";
import type { SelfCheckStateResult } from "@praxity/shared-blocks/self-check-state";
import {
	editSelfCheckDraft,
	resetSelfCheckState,
	restoreSelfCheckState,
	selfCheckContentRevision,
	submitSelfCheck,
} from "@praxity/shared-blocks/self-check-state";
import {
	annotate,
	type Content,
	feedback,
	validateContent,
} from "learning-patterns/patterns/self-check/logic.js";
import { strings } from "learning-patterns/patterns/self-check/strings.js";
import { loadSelfCheckAsset } from "../self-check-asset";
import type { SelfCheckControls } from "../self-check-controls";
import type { SelfCheckEffectTicket, selfCheckRuntime } from "../self-check-runtime";

const admitted = new WeakMap<Document, Map<string, Content>>();
export async function admit(
	reference: SelfCheckReference,
	doc: Document,
): Promise<SelfCheckOperations> {
	const payload = await loadSelfCheckAsset(reference, doc);
	const content = (payload as { content?: unknown }).content;
	try {
		validateContent(content);
	} catch {
		throw new Error("ESELFCHECKCONTENT");
	}
	if (selfCheckContentRevision(content) !== reference.contentRevision)
		throw new Error("ESELFCHECKREVISION");
	return {
		restore: (value) => {
			// Only the current generation calls restore; late asset loads stay private.
			const values = admitted.get(doc) ?? new Map<string, Content>();
			values.set(reference.blockId, content);
			admitted.set(doc, values);
			return restoreSelfCheckState(content, value);
		},
		edit: (value, draft) => editSelfCheckDraft(content, value, draft),
		submit: (value) =>
			submitSelfCheck(content, value, {
				blockId: reference.blockId,
				language: resolveLocale(doc.documentElement.lang),
			}),
		reset: resetSelfCheckState,
	};
}

export { loadSelfCheckAsset } from "../self-check-asset";

interface Enhancement {
	cleanup(): void;
	check(ticket?: SelfCheckEffectTicket): void;
	project(ticket: SelfCheckEffectTicket, command?: SelfCheckCommand): void;
	finish(ticket: SelfCheckEffectTicket, command: SelfCheckCommand): void;
}
const mounted = new WeakMap<HTMLElement, Enhancement>();

export function enhance(
	root: HTMLElement,
	controls: SelfCheckControls,
	runtime: ReturnType<typeof selfCheckRuntime>,
): Enhancement {
	if (runtime.session.read(root.dataset.selfCheckId ?? "")?.outcome === "cancelled")
		throw new Error("ESELFCHECKNOTREADY");
	const existing = mounted.get(root);
	if (existing) return existing;
	const doc = root.ownerDocument;
	const answer = root.querySelector<HTMLTextAreaElement>("textarea");
	const notice = root.querySelector<HTMLElement>("[data-self-check-notice]");
	const status = root.querySelector<HTMLElement>("[data-self-check-status]");
	const parts = root.querySelector<HTMLElement>("[data-self-check-parts]");
	const button = (action: string) =>
		root.querySelector<HTMLButtonElement>(`[data-self-check-action="${action}"]`);
	const check = button("check"),
		show = button("show-feedback"),
		reset = button("start-over");
	if (!answer || !notice || !status || !parts || !check || !show || !reset)
		throw new Error("ESELFCHECKCONTROL");
	const blockId = root.dataset.selfCheckId ?? "";
	const locale = resolveLocale(root.lang);
	const s = strings[locale];
	const ui = { ...getSelfCheckActivationStrings(locale), ...getSelfCheckIslandStrings(locale) };
	const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
		const node = doc.createElement(tag);
		if (text !== undefined) node.textContent = text;
		return node;
	};
	const { validAnswer } = controls;
	const comparison = root.querySelector<HTMLElement>("[data-self-check-comparison]");
	const recovery = root.querySelector<HTMLElement>("[data-self-check-recovery]");
	if (!comparison || !recovery) throw new Error("ESELFCHECKCONTROL");
	let result: SelfCheckStateResult = runtime.results.get(blockId) ?? resetSelfCheckState();
	const partsReveal = createContentReveal(parts, result.completed);
	const comparisonReveal = createContentReveal(comparison, result.completed);
	const originalActions = show.parentElement;
	const feedbackActions = element("div");
	feedbackActions.className = "praxity-assessment-actions";
	feedbackActions.append(show, reset);
	partsReveal.element.after(feedbackActions);
	let content = admitted.get(doc)?.get(blockId);
	let disposed = false;
	let reportingTicket: SelfCheckEffectTicket | undefined;
	const listeners: Array<() => void> = [];
	const on = (target: EventTarget, type: string, handler: EventListener) => {
		target.addEventListener(type, handler);
		listeners.push(() => target.removeEventListener(type, handler));
	};
	const reportNotice = element("p");
	reportNotice.dataset.selfCheckReport = "";
	comparison.before(reportNotice);
	on(doc, "praxity:assessment-response-truncated", (event) => {
		const detail = (event as CustomEvent<LearnerBlockResponseTruncated>).detail;
		const pass = reportingTicket;
		if (disposed || !pass?.current() || detail?.blockId !== blockId) return;
		const policy = pass.call(() => runtime.provider?.getPolicy?.(blockId));
		if (pass.current() && policy === "lms") reportNotice.textContent = ui.selfCheckReportTruncated;
	});
	const setHidden = (node: HTMLElement, hidden: boolean) => {
		if (!hidden || !node.contains(doc.activeElement)) node.hidden = hidden;
	};
	const previous = () => {
		const heading = comparison.querySelector<HTMLElement>("[data-self-check-comparison-title]");
		if (heading && result.state?.submitted) {
			const { draft, submitted } = result.state;
			heading.textContent =
				draft.answer !== submitted.answer ||
				draft.ticked.length !== submitted.ticked.length ||
				draft.ticked.some((id) => !submitted.ticked.includes(id))
					? ui.selfCheckPrevious
					: ui.selfCheckComparison;
		}
	};
	const count = () => {
		const meter = parts.querySelector<HTMLElement>("[data-self-check-count]");
		if (meter && content)
			meter.textContent = formatSelfCheckCounts(
				locale,
				result.state?.draft.ticked.length ?? 0,
				content.parts.length,
			).selected;
	};
	const draft = () => {
		if (disposed || !runtime.ticket().current() || !content) return;
		const ticked = parts.querySelector("fieldset")
			? [...parts.querySelectorAll<HTMLInputElement>("input:checked")].map((input) => input.value)
			: (result.state?.draft.ticked ?? []);
		void runtime.session.dispatch({ type: "edit", blockId, answer: answer.value, ticked });
	};
	const renderParts = () => {
		if (!content) return;
		if (parts.querySelector("fieldset")) {
			parts.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
				input.checked = result.state?.draft.ticked.includes(input.value) ?? false;
			});
			count();
			return;
		}
		const targets = [...parts.querySelectorAll<HTMLElement>("[data-node-id]")];
		const fieldset = element("fieldset");
		fieldset.className = "praxity-fieldset-reset";
		fieldset.append(element("legend", s.tick));
		for (const [index, part] of content.parts.entries()) {
			const target = targets[index] ?? element("div");
			const label = element("label"),
				input = element("input");
			input.type = "checkbox";
			input.id = `${answer.id}-criterion-${index}`;
			input.value = part.id;
			input.checked = result.state?.draft.ticked.includes(part.id) ?? false;
			label.htmlFor = input.id;
			label.append(input, doc.createTextNode(part.label));
			target.replaceChildren(label);
			fieldset.append(target);
		}
		parts.append(fieldset);
		const meter = element("p");
		meter.dataset.selfCheckCount = "";
		parts.append(meter);
		count();
	};
	const renderComparison = () => {
		const submitted = result.state?.submitted;
		if (!content || !submitted || !result.completed) return;
		const response = feedback(content, submitted.ticked);
		const title = element("p", ui.selfCheckComparison);
		title.dataset.selfCheckComparisonTitle = "";
		const columns = element("div");
		columns.className = "praxity-self-check-columns";
		const mine = element("div");
		mine.append(element("p", s.mine), element("p", submitted.answer));
		const model = element("div");
		model.append(element("p", s.model));
		const modelText = element("p");
		for (const segment of annotate(content.model, content.parts, submitted.ticked)) {
			if (segment.partIndex === null) modelText.append(doc.createTextNode(segment.text));
			else {
				const mark = element("mark", segment.text);
				mark.dataset.included = String(segment.included);
				mark.append(element("sup", ` [${segment.partIndex + 1}]`));
				modelText.append(mark);
			}
		}
		model.append(modelText);
		columns.append(mine, model);
		const legend = element("ol");
		for (const [index, item] of response.items.entries()) {
			const row = element("li");
			const name = element("p");
			name.append(element("strong", item.label));
			name.className = "praxity-scene-title";
			const state = element("p");
			state.dataset.selfCheckPartState = "";
			const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
			icon.setAttribute("aria-hidden", "true");
			icon.setAttribute("focusable", "false");
			icon.setAttribute("viewBox", "0 0 16 16");
			icon.setAttribute("width", "16");
			icon.setAttribute("height", "16");
			const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", item.included ? "M3 8l3 3 7-7" : "M3 8h10M8 3v10");
			path.setAttribute("fill", "none");
			path.setAttribute("stroke", "currentColor");
			path.setAttribute("stroke-width", "2");
			icon.append(path);
			state.append(
				icon,
				doc.createTextNode(` ${item.included ? ui.selfCheckIncluded : ui.selfCheckToAdd}`),
			);
			row.append(name, state);
			if (content.parts[index].evidence === null) row.append(element("p", s.whole));
			if (item.hint !== null) row.append(element("p", item.hint));
			legend.append(row);
		}
		const partsLabel = element("p");
		partsLabel.append(element("strong", s.legend));
		partsLabel.dataset.selfCheckPartsLabel = "";
		partsLabel.className = "praxity-scene-title";
		comparison.replaceChildren(title, columns, partsLabel, legend);
		comparisonReveal.setOpen(true);
		previous();
	};
	on(parts, "change", draft);
	const checkAnswer = (pass: SelfCheckEffectTicket = runtime.ticket(() => !disposed)) => {
		if (disposed || !pass.current() || !content || !validAnswer(pass) || !pass.current()) return;
		pass.call(renderParts);
		if (!pass.current()) return;
		parts.hidden = false;
		partsReveal.setOpen(true);
		show.hidden = false;
		reset.hidden = false;
		notice.hidden = true;
		pass.call(() => parts.querySelector<HTMLInputElement>("input")?.focus());
	};
	on(show, "click", () => {
		const pass = runtime.ticket(() => !disposed);
		if (!content || !pass.current() || !validAnswer(pass) || !pass.current()) return;
		void runtime.session.dispatch({ type: "show-feedback", blockId });
	});
	const project = (pass: SelfCheckEffectTicket, command?: SelfCheckCommand) => {
		if (disposed || !pass.current()) return;
		content = admitted.get(doc)?.get(blockId);
		result = runtime.results.get(blockId) ?? result;
		const state = runtime.session.read(blockId);
		if (!state?.ready || state.outcome === "cancelled" || state.outcome === "unavailable") return;
		if (command?.blockId === blockId && command.type === "show-feedback") {
			reportingTicket = pass;
			reportNotice.textContent = "";
			recovery.textContent = "";
		}
		if (result.status === "empty" && state.origin === "interaction") reportNotice.textContent = "";
		if (!result.completed) comparisonReveal.setOpen(false);
		if (parts.hidden) partsReveal.setOpen(false);
		if (result.completed && content) {
			pass.call(renderParts);
			if (!pass.current()) return;
			parts.hidden = false;
			partsReveal.setOpen(true);
			show.hidden = false;
			reset.hidden = false;
			pass.call(renderComparison);
			if (!pass.current()) return;
		}
		pass.call(count);
		if (!pass.current()) return;
		pass.call(previous);
	};
	const finish = (pass: SelfCheckEffectTicket, command: SelfCheckCommand) => {
		if (disposed || !pass.current() || command.blockId !== blockId) return;
		if (command.type === "start-over") {
			status.textContent = s.cleared;
			return;
		}
		if (command.type !== "show-feedback" || !content) return;
		const summary = pass.call(() =>
			feedback(content as Content, result.state?.submitted?.ticked ?? []),
		);
		if (!summary || !pass.current()) return;
		status.textContent = [
			formatSelfCheckCounts(locale, summary.count, summary.total).summary,
			reportNotice.textContent,
		]
			.filter(Boolean)
			.join(" ");
	};
	const cleanup = () => {
		disposed = true;
		listeners.forEach((remove) => remove());
		reportNotice.remove();
		if (mounted.get(root) !== enhancement) {
			feedbackActions.remove();
			return;
		}
		mounted.delete(root);
		partsReveal.destroy();
		comparisonReveal.destroy();
		status.replaceChildren();
		comparison.replaceChildren();
		const fieldset = parts.querySelector("fieldset");
		for (const target of fieldset?.querySelectorAll<HTMLElement>("[data-node-id]") ?? []) {
			target.replaceChildren();
			parts.append(target);
		}
		fieldset?.remove();
		parts.querySelector("[data-self-check-count]")?.remove();
		originalActions?.append(show, reset);
		feedbackActions.remove();
	};
	const enhancement = { cleanup, check: checkAnswer, project, finish };
	mounted.set(root, enhancement);
	// Install handlers before exposing controls; preserve a region containing focus.
	for (const control of [check, show, reset]) control.removeAttribute("data-praxity-js-control");
	setHidden(show, !result.completed);
	setHidden(parts, !result.completed);
	partsReveal.setOpen(!parts.hidden);
	comparisonReveal.setOpen(result.completed);
	setHidden(
		reset,
		!result.completed && result.status !== "invalid" && result.status !== "out-of-date",
	);
	notice.hidden = true;
	if (root.hasAttribute("data-self-check-context-pending")) {
		check.disabled = true;
		recovery.textContent = ui.selfCheckRefreshing;
	}
	return enhancement;
}

export const selfCheckSupport = { enhance, loadSelfCheckAsset, admit };
if (typeof window !== "undefined") window.__praxitySelfCheckSupport = selfCheckSupport;
declare global {
	interface Window {
		__praxitySelfCheckSupport?: typeof selfCheckSupport;
	}
}
