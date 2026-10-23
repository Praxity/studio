import type { getDistractorPresentationStrings } from "@praxity/shared-blocks/i18n/practice-host-strings";
import {
	DISTRACTOR_OTHER,
	distractorOptionKey,
	MAX_CUSTOM,
	MAX_OPTION,
	type WriteDistractorsRules,
} from "@praxity/shared-blocks/write-distractors-content";
import type {
	WriteDistractorsCommand,
	WriteDistractorsView,
} from "@praxity/shared-blocks/write-distractors-session";
import { renderDistractorComparison } from "./comparison";

/** Check-only presentation: never requested to enable initial drafting or persistence. */
export function installDistractorReveal(
	root: HTMLElement,
	before: HTMLElement,
	dispatch: (command: WriteDistractorsCommand) => Promise<unknown>,
	bind: (node: HTMLElement, type: string, action: () => void) => () => void,
	announce: (text: string) => void,
	captureCurrent: () => () => boolean,
) {
	const doc = root.ownerDocument;
	const removals: Array<() => void> = [],
		fieldRemovals: Array<() => void> = [];
	const answer = root.querySelector<HTMLTextAreaElement>("[data-distractor-answer]");
	const blockId = root.dataset.distractorId;
	if (!answer || !blockId) throw new Error("EWRITEDISTRACTORSMARKUP");
	const ui = JSON.parse(root.dataset.distractorStrings ?? "{}") as ReturnType<
		typeof getDistractorPresentationStrings
	>;
	const reveal = doc.createElement("div"),
		rating = doc.createElement("div"),
		builder = doc.createElement("div");
	const label = doc.createElement("p"),
		value = doc.createElement("p");
	label.textContent = ui.revealLabel;
	label.className = "praxity-distractor-label";
	reveal.append(label, value);
	rating.setAttribute("role", "group");
	rating.setAttribute("aria-labelledby", `${answer.id}-rating`);
	const ratingLabel = doc.createElement("p");
	ratingLabel.textContent = ui.hadIt;
	ratingLabel.id = `${answer.id}-rating`;
	const button = (label: string, hadIt: boolean) => {
		const button = doc.createElement("button");
		button.type = "button";
		button.className = "praxity-button";
		button.dataset.variant = "outline";
		button.textContent = label;
		removals.push(
			bind(button, "click", () => {
				if (button.getAttribute("aria-disabled") === "true") return;
				button.focus();
				void dispatch({ type: "rate", blockId, hadIt });
			}),
		);
		return button;
	};
	const yes = button(ui.yes, true),
		no = button(ui.notQuite, false);
	yes.dataset.distractorAction = "yes";
	no.dataset.distractorAction = "not-quite";
	rating.append(ratingLabel, yes, no);
	const comparison = doc.createElement("div"),
		compare = doc.createElement("button");
	comparison.dataset.distractorComparison = "";
	compare.type = "button";
	compare.className = "praxity-button";
	compare.dataset.variant = "filled";
	compare.dataset.distractorAction = "compare";
	compare.textContent = ui.compare;
	let currentView: WriteDistractorsView | undefined;
	let comparisonSpeech = "";
	let disposed = false;
	removals.push(
		bind(compare, "click", () => {
			if (compare.getAttribute("aria-disabled") === "true") return;
			const current = captureCurrent();
			compare.focus();
			void dispatch({ type: "compare", blockId }).then(() => {
				if (disposed || !current()) return;
				const errors = currentView?.mount.error;
				if (Array.isArray(errors) && errors.length) {
					const count = new Set(errors.map((error) => `${error.option}:${error.field}`)).size;
					announce(
						count === 1
							? ui.errorsOne
							: ui.errorsMany.replace("{count}", new Intl.NumberFormat(root.lang).format(count)),
					);
					const first = errors[0];
					const field = fields[first.option];
					(
						field &&
						(first.field === "text"
							? field.text
							: first.field === "custom"
								? field.custom
								: field.select)
					)?.focus();
				} else if (currentView?.mount.value.shown) announce(comparisonSpeech);
				else if (errors) announce(ui.selfCheckUnavailable);
			});
		}),
	);
	before.before(reveal, rating, builder, comparison, compare);
	let builtRevision: string | undefined;
	const fields: Array<{
		text: HTMLTextAreaElement;
		select: HTMLSelectElement;
		custom: HTMLInputElement;
		label: HTMLLabelElement;
		errors: Record<"text" | "misconception" | "custom", HTMLElement>;
	}> = [];
	const build = (
		presentation: ReturnType<WriteDistractorsRules["firstHalf"]>,
		revision: string,
	) => {
		if (builtRevision === revision) return;
		builtRevision = revision;
		for (const remove of fieldRemovals.splice(0)) remove();
		builder.replaceChildren();
		fields.length = 0;
		const instruction = doc.createElement("p");
		const count = Number(root.dataset.distractorCount);
		const words = ["", "", ui.two, ui.three, ui.four, ui.five];
		instruction.textContent = count === 1 ? ui.writeOne : ui.write.replace("{count}", words[count]);
		builder.append(instruction);
		for (let index = 0; index < count; index++) {
			const key = distractorOptionKey(index + 1),
				id = `${answer.id}-option-${key}`;
			const group = doc.createElement("fieldset"),
				legend = doc.createElement("legend"),
				text = doc.createElement("textarea"),
				label = doc.createElement("label"),
				select = doc.createElement("select"),
				customLabel = doc.createElement("label"),
				custom = doc.createElement("input");
			text.className = "praxity-assessment-text-input";
			select.className = "praxity-assessment-select-input";
			custom.className = "praxity-assessment-text-input";
			legend.id = `${id}-legend`;
			legend.textContent = ui.option.replace("{key}", key);
			text.rows = 3;
			text.id = id;
			text.setAttribute("aria-labelledby", legend.id);
			select.id = `${id}-idea`;
			label.htmlFor = select.id;
			label.textContent = ui.misconception;
			for (const item of [
				{ id: "", label: ui.chooseOne },
				...presentation.items,
				{ id: DISTRACTOR_OTHER, label: ui.other },
			]) {
				const option = doc.createElement("option");
				option.value = item.id;
				option.textContent = item.label;
				select.append(option);
			}
			custom.type = "text";
			custom.id = `${id}-custom`;
			customLabel.htmlFor = custom.id;
			customLabel.textContent = ui.custom;
			group.append(legend, text, label, select, customLabel, custom);
			builder.append(group);
			const errors = {} as Record<"text" | "misconception" | "custom", HTMLElement>;
			for (const [field, input] of [
				["text", text],
				["misconception", select],
				["custom", custom],
			] as const) {
				const error = doc.createElement("p");
				error.className = "praxity-text-error";
				error.id = `${input.id}-error`;
				error.hidden = true;
				input.after(error);
				errors[field] = error;
			}
			fields.push({ text, select, custom, label: customLabel, errors });
			for (const [node, field, event] of [
				[text, "text", "input"],
				[select, "misconception", "change"],
				[custom, "custom", "input"],
			] as const)
				fieldRemovals.push(
					bind(node, event, () => {
						void dispatch({ type: "edit-option", blockId, index, field, text: node.value });
					}),
				);
		}
	};

	return {
		project(
			view: WriteDistractorsView,
			presentation: ReturnType<WriteDistractorsRules["firstHalf"]>,
			result?: ReturnType<WriteDistractorsRules["comparison"]>,
		) {
			currentView = view;
			const mount = view.mount;
			value.textContent = presentation.answer;
			build(presentation, mount.reference.contentRevision);
			yes.setAttribute("aria-disabled", String(mount.value.shown));
			no.setAttribute("aria-disabled", String(mount.value.shown));
			yes.setAttribute("aria-pressed", String(mount.value.hadIt === true));
			yes.dataset.variant = mount.value.hadIt === true ? "filled" : "outline";
			no.dataset.variant = mount.value.hadIt === false ? "filled" : "outline";
			no.setAttribute("aria-pressed", String(mount.value.hadIt === false));
			builder.hidden = mount.value.hadIt === null || mount.value.shown;
			compare.hidden = mount.value.hadIt === null;
			compare.setAttribute("aria-disabled", String(mount.value.shown));
			comparison.hidden = !mount.value.shown;
			if (mount.value.shown && result) {
				const rendered = renderDistractorComparison(result, root.lang, ui);
				// Keep result nodes stable across receipts, flushes and persisted return.
				if (comparison.innerHTML !== rendered.html) comparison.innerHTML = rendered.html;
				comparisonSpeech = rendered.announcement;
			} else comparison.replaceChildren();
			for (const [index, field] of fields.entries()) {
				const option = mount.value.options[index];
				field.text.disabled = field.select.disabled = field.custom.disabled = false;
				if (field.text.value !== option.text) field.text.value = option.text;
				field.select.value = option.misconception;
				field.custom.hidden = field.label.hidden = option.misconception !== DISTRACTOR_OTHER;
				if (field.custom.value !== option.custom) field.custom.value = option.custom;
				for (const [name, input] of [
					["text", field.text],
					["misconception", field.select],
					["custom", field.custom],
				] as const) {
					const errors = Array.isArray(mount.error)
						? mount.error.filter((error) => error.option === index && error.field === name)
						: [];
					const error = field.errors[name];
					error.textContent = errors
						.map(({ code }) =>
							ui[code]
								.replace("{n}", distractorOptionKey(index + 1))
								.replace("{max}", String(code === "longCustom" ? MAX_CUSTOM : MAX_OPTION)),
						)
						.join(" ");
					error.hidden = errors.length === 0;
					if (errors.length) {
						input.setAttribute("aria-invalid", "true");
						input.setAttribute("aria-describedby", error.id);
					} else {
						input.removeAttribute("aria-invalid");
						input.removeAttribute("aria-describedby");
					}
				}
			}
		},
		suspend() {
			yes.setAttribute("aria-disabled", "true");
			no.setAttribute("aria-disabled", "true");
			compare.setAttribute("aria-disabled", "true");
			for (const field of fields)
				field.text.disabled = field.select.disabled = field.custom.disabled = true;
		},
		destroy() {
			disposed = true;
			for (const remove of [...removals.splice(0), ...fieldRemovals.splice(0)]) remove();
			reveal.remove();
			rating.remove();
			builder.remove();
			comparison.remove();
			compare.remove();
		},
	};
}
