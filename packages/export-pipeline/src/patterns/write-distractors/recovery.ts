import type { getPracticeHostStrings } from "@praxity/shared-blocks/i18n/practice-host-strings";
import type { DistractorRecoveryField } from "@praxity/shared-blocks/write-distractors-state";

/** Only codec-extracted answer and five old text/custom pairs have display labels. */
export function projectDistractorRecovery(
	root: HTMLElement,
	fields: readonly DistractorRecoveryField[],
	ui: ReturnType<typeof getPracticeHostStrings>,
	lang: string,
	prefix: string,
) {
	const retained = new Set<string>();
	for (const field of fields) {
		const option = /^value\.options\[([0-4])\]\.(text|custom)$/.exec(field.path);
		if (field.text === "" || (field.path !== "value.answer" && !option)) continue;
		const id = `${prefix}-${field.path.replace(/\W/g, "-")}`;
		if (retained.has(id)) continue;
		retained.add(id);
		let group = [...root.children].find((node) => node.getAttribute("data-recovery-id") === id);
		if (!group) {
			group = root.ownerDocument.createElement("div");
			group.setAttribute("data-recovery-id", id);
			const label = root.ownerDocument.createElement("label");
			label.htmlFor = id;
			label.textContent = option
				? (option[2] === "text"
						? ui.distractorsRecoveryOption
						: ui.distractorsRecoveryCustom
					).replace("{n}", new Intl.NumberFormat(lang).format(Number(option[1]) + 1))
				: ui.distractorsRecoveryAnswer;
			const input = root.ownerDocument.createElement("textarea");
			input.id = id;
			input.readOnly = true;
			input.rows = 3;
			input.className = "praxity-assessment-text-input";
			group.append(label, input);
			root.append(group);
		}
		const input = group.querySelector("textarea");
		if (input && input.value !== field.text) input.value = field.text;
	}
	for (const group of [...root.children])
		if (!retained.has(group.getAttribute("data-recovery-id") ?? "")) group.remove();
	root.hidden = retained.size === 0;
}
