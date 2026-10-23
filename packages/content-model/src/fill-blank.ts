import { decodeEscapes, escapeLength, findUnescaped, splitUnescaped } from "./escaping";
import type { FillBlankResponse } from "./types";

/** Keep source markers separate from literal text, including escaped braces and underscores. */
export function fillBlankParts(content: string): Array<{ text: string; blank: boolean }> {
	const parts: Array<{ text: string; blank: boolean }> = [];
	let start = 0;
	for (let index = 0; index < content.length; index++) {
		if (escapeLength(content, index)) {
			index++;
			continue;
		}
		if (content[index] === "`") {
			const end = content.indexOf("`", index + 1);
			if (end !== -1) {
				index = end;
				continue;
			}
		}
		let end = -1;
		if (content[index] === "{") {
			const close = findUnescaped(content, "}", index + 1);
			const nested = findUnescaped(content, "{", index + 1);
			if (close > index + 1 && (nested === -1 || nested > close)) end = close + 1;
		} else if (content.startsWith("____", index)) {
			end = index + 4;
			while (content[end] === "_") end++;
		}
		if (end === -1) continue;
		parts.push({ text: content.slice(start, index), blank: false });
		parts.push({ text: content.slice(index, end), blank: true });
		start = end;
		index = end - 1;
	}
	parts.push({ text: content.slice(start), blank: false });
	return parts;
}

/** Dropdown markers use * for correct choices; typed blanks keep their original alternatives. */
export function parseFillBlankContent(
	content: string,
	style?: unknown,
): Omit<FillBlankResponse["blanks"][number], "id">[] {
	return fillBlankParts(content)
		.filter((part) => part.blank)
		.map(({ text }) => {
			const entries = splitUnescaped(text.startsWith("{") ? text.slice(1, -1) : "", "|")
				.map((entry) => entry.trim())
				.filter((entry) => style === "dropdown" || Boolean(entry));
			const answers =
				style === "dropdown"
					? entries.filter((entry) => entry.startsWith("*")).map((entry) => entry.slice(1).trim())
					: entries;
			const [answer = "", ...alternatives] = answers.map((entry) => decodeEscapes(entry));
			return {
				answer,
				...(style !== "dropdown" &&
				style !== "word-bank" &&
				answers.some((entry) => decodeEscapes(entry) !== entry)
					? { answerSources: answers }
					: {}),
				...(alternatives.length ? { alternatives } : {}),
				...(style === "dropdown"
					? { choices: entries.map((entry) => decodeEscapes(entry.replace(/^\*/, "").trim())) }
					: {}),
			};
		});
}

export function fillBlankChoices(
	response: FillBlankResponse,
	blank: FillBlankResponse["blanks"][number],
): string[] | undefined {
	const choices =
		response.style === "word-bank"
			? response.wordBank
			: response.style === "dropdown"
				? blank.choices
				: undefined;
	return response.style === "word-bank" || response.style === "dropdown"
		? Array.isArray(choices)
			? choices.filter(
					(choice): choice is string => typeof choice === "string" && choice.trim().length > 0,
				)
			: []
		: undefined;
}

/** Checks partial selections as well as complete attempts, including bank occurrence counts. */
export function validFillBlankSelections(
	response: FillBlankResponse,
	values: Record<string, string>,
): boolean {
	if (!Array.isArray(response.blanks)) return false;
	const used = new Map<string, number>();
	for (const blank of response.blanks) {
		if (!blank || typeof blank.id !== "string") return false;
		const value = values[blank.id];
		if (!value) continue;
		const choices = fillBlankChoices(response, blank);
		if (choices && !choices.includes(value)) return false;
		if (response.style === "word-bank") {
			const count = (used.get(value) ?? 0) + 1;
			if (count > (choices ?? []).filter((choice) => choice === value).length) return false;
			used.set(value, count);
		}
	}
	return true;
}
