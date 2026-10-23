import { sha256 } from "@noble/hashes/sha2.js";
import {
	type Content,
	coverage,
	coverageMessage,
	type LearnerOption,
	type LearnerState,
	targetOf,
	validateContent,
	validateOptions,
	validateState,
} from "learning-patterns/patterns/write-distractors/logic.js";

export type {
	FieldError,
	LearnerOption as DistractorOption,
	LearnerState as DistractorValue,
} from "learning-patterns/patterns/write-distractors/logic.js";
export {
	MAX_ANSWER,
	MAX_CUSTOM,
	MAX_OPTION,
	OTHER as DISTRACTOR_OTHER,
	optionKey as distractorOptionKey,
	validateAnswer as validateDistractorAnswer,
} from "learning-patterns/patterns/write-distractors/logic.js";

export interface WriteDistractorsAssetReference {
	readonly blockId: string;
	readonly contentRevision: string;
	readonly path: string;
	readonly sha256: string;
}

/** Only this owner reads authored Content. Reducers receive validation authority,
 * never an answer-bearing projection or a prompt cast to Content. */
export function createWriteDistractorsRules(content: Content) {
	// Capture private copies so later caller mutation cannot change the authority.
	validateContent(content);
	const captured: Content = {
		question: content.question,
		rightAnswer: content.rightAnswer,
		count: content.count,
		misconceptions: content.misconceptions.map((item) => ({ ...item })),
		authorOptions: content.authorOptions.map((item) => ({ ...item })),
	};
	const trimmedOptions = (options: LearnerOption[]) =>
		options.map((option) => ({
			...option,
			text: option.text.trim(),
			custom: option.custom.trim(),
		}));
	return Object.freeze({
		contentRevision: writeDistractorsContentRevision(captured),
		count: captured.count,
		/** Deliberate Check exposes only first-half presentation, never author options. */
		firstHalf() {
			return {
				answer: captured.rightAnswer,
				items: captured.misconceptions.map(({ id, label }) => ({ id, label })),
			};
		},
		itemIds: Object.freeze(captured.misconceptions.map((item) => item.id)),
		validateValue(value: LearnerState): boolean {
			// shortcut: the pin counts raw option/custom length. CONTRACTS.md:458-459
			// retains draft text and counts after trim. Remove these trim copies once
			// W00's aligned pin lands; never normalise or truncate the stored draft.
			return validateState(captured, { ...value, options: trimmedOptions(value.options) }) !== null;
		},
		compare(options: LearnerOption[]) {
			return validateOptions(captured, trimmedOptions(options));
		},
		/** Only a shown result requests this projection; overlap compares labels alone. */
		comparison(options: LearnerOption[]) {
			const checked = validateOptions(captured, trimmedOptions(options));
			if (!checked.ok) throw new Error("EWRITEDISTRACTORSCOMPARISON");
			const overlap = coverage(captured, checked.options);
			return {
				question: captured.question,
				answer: captured.rightAnswer,
				learner: checked.options.map((option, index) => ({
					text: option.text,
					label: targetOf(captured, option),
					match: overlap.matches[index],
				})),
				author: captured.authorOptions.map((option) => ({
					text: option.text,
					label: targetOf(captured, option),
				})),
				counts: coverageMessage(captured, checked.options),
			};
		},
	});
}
export type WriteDistractorsRules = ReturnType<typeof createWriteDistractorsRules>;

/** Exact decoded text and authored order determine comparison compatibility. */
export function writeDistractorsContentRevision(content: Content): string {
	try {
		validateContent(content);
	} catch {
		throw Object.assign(new Error("write-distractors-content-invalid"), {
			code: "write-distractors-content-invalid",
		});
	}
	const canonical = JSON.stringify([
		"write-distractors",
		1,
		content.question,
		content.rightAnswer,
		content.count,
		content.misconceptions.map((item) => [item.id, item.label]),
		content.authorOptions.map((option) => [option.misconception, option.text]),
	]);
	const digest = sha256(new TextEncoder().encode(canonical));
	return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Asset admission owns Content and its digest; generic presentation receives only rules. */
export function admitWriteDistractorsAsset(
	payload: unknown,
	reference: { blockId: string; contentRevision: string },
): WriteDistractorsRules {
	record(payload, ["blockId", "contentRevision", "content"]);
	if (
		!payload ||
		typeof payload !== "object" ||
		!("blockId" in payload) ||
		payload.blockId !== reference.blockId ||
		!("contentRevision" in payload) ||
		payload.contentRevision !== reference.contentRevision ||
		!("content" in payload)
	)
		refuse("invalid");
	const rules = createWriteDistractorsRules(copyWriteDistractorsContent(payload.content));
	if (rules.contentRevision !== reference.contentRevision) refuse("revision");
	return rules;
}

function refuse(kind: "invalid" | "revision"): never {
	const code = `write-distractors-content-${kind}`;
	throw Object.assign(new Error(code), { code });
}
function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value))
	)
		refuse("invalid");
	const own = Reflect.ownKeys(value);
	if (
		own.length !== keys.length ||
		own.some((key) => typeof key !== "string" || !keys.includes(key))
	)
		refuse("invalid");
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) refuse("invalid");
	}
}
function array(value: unknown): asserts value is unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse("invalid");
	if (Reflect.ownKeys(value).length !== value.length + 1) refuse("invalid");
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) refuse("invalid");
	}
}
export function copyWriteDistractorsContent(value: unknown): Content {
	try {
		record(value, ["question", "rightAnswer", "count", "misconceptions", "authorOptions"]);
		array(value.misconceptions);
		array(value.authorOptions);
		for (const item of value.misconceptions) record(item, ["id", "label"]);
		for (const option of value.authorOptions) record(option, ["text", "misconception"]);
		validateContent(value);
		// Studio's source subset pairs one option with each ordered misconception.
		if (
			!value.question.trim() ||
			!value.rightAnswer.trim() ||
			value.authorOptions.length !== value.misconceptions.length ||
			value.misconceptions.some(
				(item, index) =>
					!item.label.trim() ||
					value.authorOptions[index].misconception !== item.id ||
					!value.authorOptions[index].text.trim(),
			) ||
			new Set(
				value.misconceptions.map((item) => item.label.trim().replace(/\s+/g, " ").toLowerCase()),
			).size !== value.misconceptions.length
		)
			refuse("invalid");
		return {
			question: value.question,
			rightAnswer: value.rightAnswer,
			count: value.count,
			misconceptions: value.misconceptions.map(({ id, label }) => ({ id, label })),
			authorOptions: value.authorOptions.map(({ text, misconception }) => ({
				text,
				misconception,
			})),
		};
	} catch {
		return refuse("invalid");
	}
}
