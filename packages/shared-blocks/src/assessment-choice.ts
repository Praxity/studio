import { assessmentStatePolicy } from "@praxity/content-model";
import DOMPurify from "isomorphic-dompurify";
import { DONT_KNOW } from "learning-patterns/patterns/dont-know/logic.js";
import {
	assessmentMaterialContent,
	assessmentMaterialOptionHtml,
	prepareAssessmentDescriptionHtml,
} from "./assessment-content";
import {
	type ChoiceStateQuestion,
	choiceAnswerSignature,
	choiceMaterialProof,
	choiceMaterialSignature,
	choiceProofSignature,
} from "./choice-state-facts";
import { getStrings } from "./i18n/strings";
import { BLOCK_NAMES } from "./sanitize";
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
	type ChoiceMaterialProof,
	type ChoiceStateQuestion,
	choiceAnswerSignature,
	choiceMaterialProof,
	choiceMaterialSignature,
	choiceProofSignature,
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

export type ChoiceMaterialTree = (string | [string, string, string[][], ChoiceMaterialTree])[];
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const EMPHASIS = new Set(["b", "strong", "i", "em", "u", "mark", "span"]);
let materialDocument: Document | null = null;

/** Parse the renderer's output, without applying another content sanitizer. */
export function choiceMaterialContent(html: string): ChoiceMaterialTree {
	materialDocument ??= DOMPurify.sanitize("", { RETURN_DOM: true }).ownerDocument;
	if (!materialDocument) throw new Error("Missing learner HTML document");
	const template = materialDocument.createElement("template");
	template.innerHTML = html;
	function children(parent: Node, preserve: boolean, block = false): ChoiceMaterialTree {
		const result: ChoiceMaterialTree = [];
		const append = (node: ChoiceMaterialTree[number]) => {
			if (typeof node === "string" && typeof result.at(-1) === "string")
				result[result.length - 1] = String(result.at(-1)) + node;
			else result.push(node);
		};
		for (const node of Array.from(parent.childNodes)) {
			if (node.nodeType === 3) append(node.textContent ?? "");
			else if (node.nodeType === 1) {
				const element = node as Element;
				const attributes = Array.from(element.attributes)
					.filter(({ name }) => name !== "class" && name !== "style")
					.map(({ name, value }) => [name, value])
					.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
				const html = element.namespaceURI === HTML_NAMESPACE;
				const content = children(
					element,
					preserve || (html && ["pre", "code", "textarea"].includes(element.localName)),
					html && BLOCK_NAMES.has(element.localName),
				);
				if (html && !attributes.length && EMPHASIS.has(element.localName)) content.forEach(append);
				else append([element.namespaceURI ?? "", element.localName, attributes, content]);
			}
		}
		const normalized = result.map((node) =>
			typeof node === "string" && !preserve ? node.replace(/[ \t\r\n\f]+/g, " ") : node,
		);
		if (block && !preserve) {
			if (typeof normalized[0] === "string")
				normalized[0] = normalized[0].replace(/^[ \t\r\n\f]+/, "");
			const last = normalized.length - 1;
			if (typeof normalized[last] === "string")
				normalized[last] = (normalized[last] as string).replace(/[ \t\r\n\f]+$/, "");
		}
		return normalized.filter((node) => node !== "");
	}
	return children(template.content, false, true);
}

/** The same effective policy drives controls and the dormant signature. */
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
	const correctAnswerSignature = choiceAnswerSignature(
		response.options.filter((option) => option.isCorrect).map((option) => option.id),
	);
	return {
		selectionMode: response.selectionMode,
		dontKnow,
		canAutoScore: policy.canAutoScore,
		graded: policy.graded,
		maxAttempts: policy.maxAttempts === Infinity ? 0 : policy.maxAttempts,
		correctAnswerSignature,
		materialSignature: choiceMaterialSignature([
			[
				choiceMaterialContent(content.stemContent.heading),
				choiceMaterialContent(content.stemContent.body),
			],
			choiceMaterialContent(prepareAssessmentDescriptionHtml(content.descriptionHtml)),
			policy.gradingMode,
			data.points ?? 100,
			policy.maxAttempts === Infinity ? 0 : policy.maxAttempts,
			data.required ?? policy.graded,
			response.selectionMode,
			dontKnow,
			correctAnswerSignature,
		]),
		options: response.options
			.map((option) => ({
				id: option.id,
				materialSignature: choiceMaterialSignature([
					option.id,
					choiceMaterialContent(assessmentMaterialOptionHtml(option)),
					option.image ?? null,
					option.isCorrect === true,
				]),
			}))
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
	};
}

export function choiceContentSignature(data: AssessmentBlockData, dontKnow: boolean): string {
	return choiceProofSignature(choiceMaterialProof(choiceStateQuestion(data, dontKnow)));
}
