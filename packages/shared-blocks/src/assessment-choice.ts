import { assessmentStatePolicy } from "@praxity/content-model";
import { DONT_KNOW } from "learning-patterns/patterns/dont-know/logic.js";
import { assessmentMaterialContent, assessmentMaterialOption } from "./assessment-content";
import { type ChoiceStateQuestion, choiceQuestionSignature } from "./choice-state-facts";
import { getStrings } from "./i18n/strings";
import type { AssessmentBlockData, ChoiceResponse } from "./types";

export {
	type AssessmentDeckOptions,
	assessmentOffersDontKnow,
	choiceFactError,
	deckPageGates,
	hasAutomaticAnswer,
	resolveAssessmentDontKnow,
} from "@praxity/content-model";
export {
	type ChoiceStateQuestion,
	choiceMaterialSignature,
	choiceQuestionSignature,
} from "./choice-state-facts";
export { DONT_KNOW };

/** Choice settings override component defaults, including an explicit false. */
export function assessmentShuffle(data: { shuffle?: unknown; response?: unknown }): boolean {
	const response = data.response;
	if (
		response !== null &&
		typeof response === "object" &&
		"type" in response &&
		response.type === "choice" &&
		"shuffle" in response &&
		typeof response.shuffle === "boolean"
	)
		return response.shuffle;
	return data.shuffle === true;
}

/** Studio grades sets and surveys, rather than the library's authored quiz/points shape. */
export function choiceAnswerResult(response: ChoiceResponse, selected: readonly string[]) {
	if (!selected.length) return "unanswered";
	if (response.selectionMode === "single" && selected.length === 1 && selected[0] === DONT_KNOW)
		return "unknown";
	const correct = response.options.filter((option) => option.isCorrect).map((option) => option.id);
	return selected.length === correct.length && selected.every((id) => correct.includes(id))
		? "correct"
		: "incorrect";
}

/** Allocate stable readable IDs for the whole question, before choosing a subset. */
export function choiceInteractionReport(
	options: readonly { id: string; label: string }[],
	selected: ReadonlySet<string>,
	language: string,
	responseLimit?: number,
	dontKnow = false,
) {
	const limit =
		responseLimit === undefined
			? 250
			: Math.min(250, Math.floor((responseLimit - 3 * (options.length - 1)) / options.length));
	const identifiers = new Map<string, string>();
	const used = new Set<string>(dontKnow ? [DONT_KNOW] : []);
	for (const [index, option] of options.entries()) {
		if (limit < String(options.length).length + 2) {
			identifiers.set(option.id, String(index + 1));
			continue;
		}
		const slug =
			option.label
				.normalize("NFD")
				.replace(/\p{Diacritic}/gu, "")
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "")
				.slice(0, limit)
				.replace(/-$/g, "") || "choice".slice(0, limit);
		let identifier = slug;
		for (let suffix = 2; used.has(identifier); suffix++) {
			const ending = `-${suffix}`;
			identifier = slug.slice(0, limit - ending.length).replace(/-$/g, "") + ending;
		}
		used.add(identifier);
		identifiers.set(option.id, identifier);
	}
	let responseText = [...identifiers]
		.filter(([id]) => selected.has(id))
		.map(([, value]) => value)
		.join(limit < String(options.length).length + 2 ? "," : "[,]");
	if (limit < String(options.length).length + 2 && responseText.length > (responseLimit ?? 255)) {
		// SCORM 1.2 only: hex digits encode four positions each, low bit first.
		responseText =
			"positions-hex:" +
			Array.from({ length: Math.ceil(options.length / 4) }, (_, index) =>
				options
					.slice(index * 4, index * 4 + 4)
					.reduce((bits, option, bit) => bits | (selected.has(option.id) ? 1 << bit : 0), 0)
					.toString(16),
			).join("");
		if (responseText.length > (responseLimit ?? 255))
			throw new Error("Choice response exceeds the reporting budget");
	}
	const choices = options.map((option) => ({
		id: identifiers.get(option.id) ?? "",
		description: { [language]: option.label },
	}));
	if (dontKnow)
		choices.push({
			id: DONT_KNOW,
			description: { en: getStrings("en").dontKnow, fr: getStrings("fr").dontKnow },
		});
	return {
		responseText: dontKnow && selected.has(DONT_KNOW) ? DONT_KNOW : responseText,
		choiceDefinition: { interactionType: "choice" as const, choices },
	};
}

/** The same effective policy drives controls and the saved-answer signature. */
export function choiceStatePolicy(data: AssessmentBlockData) {
	const response = data.response as ChoiceResponse;
	const canAutoScore = response.options.some((option) => option.isCorrect === true);
	return { canAutoScore, ...assessmentStatePolicy(data, canAutoScore) };
}

/** Provenance is recorded by inline producers, never inferred from authored classes. */
export function choiceStateQuestion(
	data: AssessmentBlockData,
	dontKnow: boolean,
): ChoiceStateQuestion {
	const response = data.response as ChoiceResponse;
	const policy = choiceStatePolicy(data);
	const content = assessmentMaterialContent(data);
	return {
		selectionMode: response.selectionMode,
		dontKnow,
		canAutoScore: policy.canAutoScore,
		graded: policy.graded,
		gradingMode: policy.gradingMode,
		points: data.points ?? 100,
		required: data.required ?? policy.graded,
		maxAttempts: policy.maxAttempts === Infinity ? 0 : policy.maxAttempts,
		correctIds: response.options
			.filter((option) => option.isCorrect)
			.map((option) => option.id)
			.sort(),
		content,
		options: response.options
			.map((option) => ({
				id: option.id,
				content: assessmentMaterialOption(option),
				image: option.image ?? null,
			}))
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
	};
}

export function choiceContentSignature(data: AssessmentBlockData, dontKnow: boolean): string {
	return choiceQuestionSignature(choiceStateQuestion(data, dontKnow));
}
