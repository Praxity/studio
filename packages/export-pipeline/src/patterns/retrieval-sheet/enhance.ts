import { resolveLocale } from "@praxity/shared-blocks/i18n/locale";
import { getRetrievalSheetStrings } from "@praxity/shared-blocks/i18n/retrieval-sheet-strings";
import { requestSelfCheckFrame } from "@praxity/shared-blocks/self-check-consumers";
import {
	dateAfterDays,
	defaultDate,
	formatDate,
	isDate,
	isPartialYear,
	presetDays,
	validateState,
} from "learning-patterns/patterns/retrieval-sheet/logic.js";
import { strings } from "learning-patterns/patterns/retrieval-sheet/strings.js";
import {
	cancelRetrievalSheetPrint,
	printRetrievalSheet,
} from "../../../template/src/retrieval-sheet-print";

type Instance = { destroy(): void };
const instances = new WeakMap<HTMLElement, Instance>();

/** State belongs only to this mount. No host state or persistence adapter participates. */
export function enhanceRetrievalSheet(root: HTMLElement): Instance {
	const existing = instances.get(root);
	if (existing) return existing;
	const doc = root.ownerDocument;
	const copy = strings[resolveLocale(root.lang)];
	const notices = getRetrievalSheetStrings(root.lang);
	function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = "") {
		const el = doc.createElement(tag);
		el.textContent = text;
		el.className = className;
		return el;
	}
	function required<T extends HTMLElement>(selector: string): T {
		const el = root.querySelector<T>(selector);
		if (!el) throw new Error(`Missing retrieval-sheet markup: ${selector}`);
		return el;
	}
	const baselineStatus = root.querySelector<HTMLElement>("[data-retrieval-status]");
	const status = baselineStatus ?? node("div");
	status.textContent = "";
	status.setAttribute("role", "status");
	status.setAttribute("aria-atomic", "true");
	status.className = "praxity-sr-only";
	const removals: (() => void)[] = [];
	let restore = () => {};
	let destroyed = false;
	let announcement = 0;
	let statusFrame: number | undefined;
	function announce(message: string, { visible = false, frame = false } = {}) {
		const ticket = ++announcement;
		const current = () => !destroyed && status.isConnected && ticket === announcement;
		status.className = visible ? "praxity-retrieval-sheet-secondary" : "praxity-sr-only";
		status.textContent = "";
		const deliver = () => {
			if (current()) status.textContent = message;
		};
		// First failure speech waits for a rendered empty region. This helper uses our mount
		// ticket explicitly, so it neither reads nor joins the learner-state provider.
		if (frame) statusFrame = requestSelfCheckFrame(deliver, current);
		else queueMicrotask(deliver);
	}
	const instance = {
		destroy() {
			if (destroyed) return;
			destroyed = true;
			if (statusFrame !== undefined) window.cancelAnimationFrame(statusFrame);
			for (const remove of removals) remove();
			cancelRetrievalSheetPrint(root);
			restore();
			if (baselineStatus) {
				status.textContent = "";
				status.className = "praxity-sr-only";
			} else status.remove();
			instances.delete(root);
		},
	};
	try {
		const controls = required<HTMLElement>("[data-retrieval-controls]");
		const dateLine = required<HTMLElement>("[data-retrieval-date-line]");
		const dateRow = dateLine.parentElement;
		const noDate = required<HTMLElement>("[data-retrieval-no-date]");
		const hint = required<HTMLElement>("[data-retrieval-print-hint]");
		const panels = ["front", "back"].map((side) =>
			required<HTMLElement>(`[data-retrieval-side=${side}]`),
		);
		if (!dateRow || !panels[0].id || !panels[1].id) throw new Error("Invalid retrieval sheet");
		const prefix = panels[0].id;
		const today = new Date();
		let current: { date: string; side: "front" | "back" } = { date: "", side: "front" };
		try {
			current = validateState({ date: defaultDate(today), side: "front" }) ?? current;
		} catch (error) {
			// Local today + 7 may exceed year 9999. Keep the blank baseline date until corrected.
			if (!(error instanceof RangeError)) throw error;
		}
		let invalid = !current.date;
		let errorShown = false;
		const fieldset = node("fieldset");
		fieldset.append(node("legend", copy.spacingLegend));
		const choices = node("div", "", "praxity-retrieval-sheet-choices");
		fieldset.append(choices);
		const custom = node("div", "", "praxity-retrieval-sheet-custom");
		const label = node("label", copy.customDateLabel);
		const input = node("input");
		input.type = "date";
		input.id = `${prefix}-date`;
		input.min = "0001-01-01";
		input.max = "9999-12-31";
		label.htmlFor = input.id;
		const error = node("p", copy.dateError, "praxity-ag-required-error");
		error.id = `${prefix}-date-error`;
		error.hidden = true;
		custom.append(label, input, error);
		custom.hidden = !!current.date;
		fieldset.append(custom);
		const memory = node("p", notices.retrievalMemoryNotice, "praxity-retrieval-sheet-secondary");
		const tabs = node("div", "", "praxity-tabs-static");
		tabs.dataset.orientation = "horizontal";
		tabs.dataset.variant = "default";
		const list = node("div", "", "praxity-tabs-list");
		list.setAttribute("role", "tablist");
		list.setAttribute("aria-label", copy.sides);
		list.setAttribute("aria-orientation", "horizontal");
		tabs.append(list);
		const print = node("button", copy.print, "praxity-button");
		print.type = "button";
		print.dataset.variant = "outline";
		const originalDate = {
			text: dateLine.textContent,
			attributes: [...dateLine.attributes].map((a) => [a.name, a.value] as const),
		};
		const originalPanels = panels.map((panel) => ({
			panel,
			attributes: [...panel.attributes].map((a) => [a.name, a.value] as const),
		}));
		restore = () => {
			controls.replaceChildren();
			controls.hidden = true;
			noDate.hidden = false;
			root.insertBefore(controls, hint);
			for (const { panel, attributes } of originalPanels) {
				for (const attribute of [...panel.attributes]) panel.removeAttribute(attribute.name);
				for (const [key, value] of attributes) panel.setAttribute(key, value);
				root.insertBefore(panel, hint);
			}
			// Restore the same date node so rebind does not leave stale handles.
			dateLine.textContent = originalDate.text;
			for (const attribute of [...dateLine.attributes]) dateLine.removeAttribute(attribute.name);
			for (const [name, value] of originalDate.attributes) dateLine.setAttribute(name, value);
			tabs.remove();
			memory.remove();
			print.remove();
			delete root.dataset.retrievalEnhanced;
		};
		function listen(target: EventTarget, type: string, handler: (event: Event) => void) {
			target.addEventListener(type, handler);
			removals.push(() => target.removeEventListener(type, handler));
		}
		function showDate() {
			dateLine.textContent = current.date ? formatDate(current.date, root.lang) : "";
			dateLine.classList.toggle("praxity-retrieval-sheet-date-line", !current.date);
			dateLine.removeAttribute("aria-hidden");
			noDate.hidden = !!current.date;
		}
		function showError() {
			invalid = true;
			print.disabled = true;
			input.setAttribute("aria-invalid", "true");
			error.hidden = false;
			if (doc.activeElement !== input) input.setAttribute("aria-describedby", error.id);
			if (!errorShown) {
				announce(copy.dateError);
			}
			errorShown = true;
		}
		function commit(date: string) {
			const next = validateState({ ...current, date });
			if (!next) {
				showError();
				return;
			}
			const changed = date !== current.date || errorShown;
			current = next;
			invalid = false;
			errorShown = false;
			print.disabled = false;
			error.hidden = true;
			input.removeAttribute("aria-invalid");
			input.removeAttribute("aria-describedby");
			showDate();
			if (changed) {
				announce(copy.dateChanged.replaceAll("{date}", formatDate(date, root.lang)));
			}
		}
		for (const [index, value] of [...presetDays, "custom"].entries()) {
			const row = node("div", "", "praxity-ag-radio-row");
			const radio = node("input", "", "praxity-ag-radio");
			radio.type = "radio";
			radio.name = `${prefix}-spacing`;
			radio.value = String(value);
			radio.id = `${prefix}-spacing-${value}`;
			radio.checked = current.date ? value === 7 : value === "custom";
			const text = node(
				"label",
				[copy.in2Days, copy.in1Week, copy.in2Weeks, copy.in1Month, copy.anotherDate][index],
				"praxity-ag-radio-label",
			);
			text.htmlFor = radio.id;
			row.append(radio, text);
			choices.append(row);
			listen(radio, "change", () => {
				if (!radio.checked) return;
				custom.hidden = value !== "custom";
				input.value = current.date;
				if (value === "custom") {
					if (current.date) commit(current.date);
					else showError();
					return;
				}
				try {
					const date = dateAfterDays(today, Number(value));
					input.value = date;
					commit(date);
				} catch (error) {
					if (!(error instanceof RangeError)) throw error;
					custom.hidden = false;
					const customRadio = choices.querySelector<HTMLInputElement>('input[value="custom"]');
					if (customRadio) customRadio.checked = true;
					showError();
				}
			});
		}
		const buttons = panels.map((panel, index) => {
			const tab = node("button", "", "praxity-tabs-tab");
			tab.type = "button";
			tab.id = `${prefix}-tab-${index}`;
			tab.setAttribute("role", "tab");
			tab.setAttribute("aria-controls", panel.id);
			tab.append(node("span", index === 0 ? copy.front : copy.back, "praxity-disclosure-title"));
			list.append(tab);
			return tab;
		});
		function select(index: number) {
			current = validateState({ ...current, side: index === 0 ? "front" : "back" }) ?? {
				...current,
				side: index === 0 ? "front" : "back",
			};
			for (const [i, tab] of buttons.entries()) {
				tab.setAttribute("aria-selected", String(i === index));
				tab.tabIndex = i === index ? 0 : -1;
				panels[i].hidden = i !== index;
			}
		}
		for (const [index, tab] of buttons.entries()) {
			listen(tab, "click", () => select(index));
			listen(tab, "keydown", (event) => {
				// Match the course Tabs block: arrows move focus; Enter/Space selects.
				const keyboard = event as KeyboardEvent;
				if (keyboard.altKey || keyboard.ctrlKey || keyboard.metaKey) return;
				const key = keyboard.key;
				if (key === "Enter" || key === " ") {
					event.preventDefault();
					select(index);
					return;
				}
				const next =
					key === "ArrowRight"
						? (index + 1) % buttons.length
						: key === "ArrowLeft"
							? (index - 1 + buttons.length) % buttons.length
							: key === "Home"
								? 0
								: key === "End"
									? buttons.length - 1
									: -1;
				if (next < 0) return;
				event.preventDefault();
				buttons[next].focus();
			});
		}
		const check = (blur: boolean) => {
			if (custom.hidden) return;
			if (isPartialYear(input.value) && !blur) {
				invalid = true;
				print.disabled = true;
				return;
			}
			if (!isDate(input.value) || isPartialYear(input.value)) {
				showError();
				return;
			}
			commit(input.value);
		};
		listen(input, "input", () => check(false));
		listen(input, "change", () => check(false));
		listen(input, "blur", () => {
			check(true);
			if (errorShown) input.setAttribute("aria-describedby", error.id);
		});
		listen(print, "click", () => {
			if (invalid) return;
			announce(copy.printing);
			try {
				printRetrievalSheet(root);
			} catch {
				announce(notices.retrievalPrintUnavailable, { visible: true });
			}
		});
		controls.append(fieldset);
		root.insertBefore(controls, dateRow);
		root.insertBefore(memory, panels[0]);
		root.insertBefore(tabs, panels[0]);
		for (const [index, panel] of panels.entries()) {
			panel.classList.add("praxity-tabs-panel");
			panel.setAttribute("role", "tabpanel");
			panel.tabIndex = 0;
			panel.setAttribute("aria-labelledby", buttons[index].id);
			tabs.append(panel);
		}
		root.insertBefore(print, hint);
		if (!baselineStatus) root.append(status);
		input.value = current.date;
		showDate();
		select(0);
		if (invalid) showError();
		controls.hidden = false;
		root.dataset.retrievalEnhanced = "";
	} catch {
		for (const remove of removals) remove();
		restore();
		if (!baselineStatus) root.append(status);
		announce(notices.retrievalUnavailable, { visible: true, frame: true });
	}
	instances.set(root, instance);
	return instance;
}
