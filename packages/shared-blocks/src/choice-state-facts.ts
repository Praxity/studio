import { sha256 } from "@noble/hashes/sha2.js";
import { isChoiceContentSignature } from "./learner-state";

export { isChoiceContentSignature } from "./learner-state";

/** Published effective facts. Saved-answer admission remains dormant. */
export interface ChoiceStateQuestion {
	selectionMode: "single" | "multiple";
	dontKnow: boolean;
	canAutoScore: boolean;
	graded: boolean;
	/** Zero means unlimited. */
	maxAttempts: number;
	correctAnswerSignature: string;
	materialSignature: string;
	options: readonly { id: string; materialSignature: string }[];
}

export interface ChoiceMaterialProof {
	question: string;
	options: string[];
}

export function choiceMaterialSignature(value: unknown): string {
	return `sha256:${Array.from(sha256(new TextEncoder().encode(JSON.stringify(value))), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function choiceAnswerSignature(selected: readonly string[]): string {
	return choiceMaterialSignature([...selected].sort());
}

export function choiceMaterialProof(question: ChoiceStateQuestion): ChoiceMaterialProof {
	return {
		question: question.materialSignature,
		options: question.options.map((option) => option.materialSignature).sort(),
	};
}

export function choiceProofSignature(proof: ChoiceMaterialProof): string {
	return choiceMaterialSignature(["choice-material", 3, proof.question, [...proof.options].sort()]);
}

export function isChoiceStateQuestion(value: unknown): value is ChoiceStateQuestion {
	return (
		isRecord(value) &&
		(value.selectionMode === "single" || value.selectionMode === "multiple") &&
		typeof value.dontKnow === "boolean" &&
		typeof value.canAutoScore === "boolean" &&
		typeof value.graded === "boolean" &&
		isCounter(value.maxAttempts) &&
		isChoiceContentSignature(value.correctAnswerSignature) &&
		isChoiceContentSignature(value.materialSignature) &&
		Array.isArray(value.options) &&
		Array.from(value.options).every(
			(option) =>
				isRecord(option) &&
				isNonemptyString(option.id) &&
				isChoiceContentSignature(option.materialSignature),
		) &&
		new Set(value.options.map((option) => option.id)).size === value.options.length
	);
}

export interface ChoiceAssessmentFacts {
	question: ChoiceStateQuestion;
	signature: string;
}

export interface ChoiceStateGroup {
	mode: "all" | "oneOf";
	memberIds: readonly string[];
	requiredIds: readonly string[];
}

function isChoiceGroupMode(value: unknown): value is ChoiceStateGroup["mode"] {
	return value === "all" || value === "oneOf";
}

/** Refuse lossy normalization; omitted mode retains the renderer's schema default. */
export function choiceGroupDefinitionIsValid(value: unknown): boolean {
	return (
		isRecord(value) &&
		(value.mode === undefined || isChoiceGroupMode(value.mode)) &&
		Array.isArray(value.memberBlockIds) &&
		value.memberBlockIds.length > 0 &&
		Array.from(value.memberBlockIds).every(isNonemptyString)
	);
}

/** Group dependency rules are shared by compiled metadata and saved admission. */
export function choiceGroupFactsAreValid(
	group: ChoiceStateGroup | undefined,
	groups: Readonly<Record<string, unknown>>,
): boolean {
	return Boolean(
		group &&
			isChoiceGroupMode(group.mode) &&
			group.memberIds.length > 0 &&
			Array.from(group.memberIds).every(
				(member) => isNonemptyString(member) && !Object.hasOwn(groups, member),
			) &&
			new Set(group.memberIds).size === group.memberIds.length &&
			group.requiredIds.length > 0 &&
			Array.from(group.requiredIds).every((member) => group.memberIds.includes(member)),
	);
}

/** Pair consistency belongs to the facts owner, for compiled config and saved-answer admission. */
export function isChoiceAssessmentFacts(value: unknown): value is ChoiceAssessmentFacts {
	return (
		isRecord(value) &&
		isChoiceStateQuestion(value.question) &&
		isChoiceContentSignature(value.signature) &&
		value.signature === choiceProofSignature(choiceMaterialProof(value.question))
	);
}

export interface ChoiceStateFacts {
	choiceStateQuestions: Record<string, ChoiceStateQuestion>;
	choiceStateSignatures: Record<string, string>;
	choiceStateGroups?: Record<string, ChoiceStateGroup>;
}

export interface AdmittedChoiceStateFacts extends ChoiceStateFacts {
	/** Invalid metadata must never become legacy unsigned admission when history activates. */
	choiceStateFactsStatus: "absent" | "valid" | "invalid";
	choiceStateInvalidIds: string[];
}

/** Both config scripts admit complete pairs independently of core course configuration. */
export function admitChoiceStateFacts(value: Record<string, unknown>): AdmittedChoiceStateFacts {
	const result: AdmittedChoiceStateFacts = {
		choiceStateQuestions: Object.create(null),
		choiceStateSignatures: Object.create(null),
		choiceStateFactsStatus: "absent",
		choiceStateInvalidIds: [],
	};
	const reject = (id: string) => {
		result.choiceStateFactsStatus = "invalid";
		result.choiceStateInvalidIds.push(id);
		console.warn(`Invalid choice facts for ID "${id}"`);
	};
	if (Object.hasOwn(value, "choiceStateGroups")) {
		const admitted: Record<string, ChoiceStateGroup> = Object.create(null);
		result.choiceStateGroups = admitted;
		result.choiceStateFactsStatus = "valid";
		const groups = value.choiceStateGroups;
		if (!isRecord(groups)) reject("*");
		else
			for (const [id, group] of Object.entries(groups)) {
				if (
					!id ||
					!isRecord(group) ||
					!Array.isArray(group.memberIds) ||
					!Array.isArray(group.requiredIds) ||
					!choiceGroupFactsAreValid(group as unknown as ChoiceStateGroup, groups) ||
					(isRecord(value.choiceStateQuestions) && Object.hasOwn(value.choiceStateQuestions, id))
				) {
					reject(id);
					continue;
				}
				admitted[id] = {
					mode: group.mode as ChoiceStateGroup["mode"],
					memberIds: [...group.memberIds],
					requiredIds: [...group.requiredIds],
				};
			}
	}
	if (
		!Object.hasOwn(value, "choiceStateQuestions") &&
		!Object.hasOwn(value, "choiceStateSignatures")
	)
		return result;
	if (result.choiceStateFactsStatus !== "invalid") result.choiceStateFactsStatus = "valid";
	const questions = value.choiceStateQuestions;
	const signatures = value.choiceStateSignatures;
	if (!isRecord(questions) || !isRecord(signatures)) {
		reject("*");
		return result;
	}
	for (const id of new Set([...Object.keys(questions), ...Object.keys(signatures)])) {
		const pair = {
			question: Object.hasOwn(questions, id) ? questions[id] : undefined,
			signature: Object.hasOwn(signatures, id) ? signatures[id] : undefined,
		};
		if (!id || !isChoiceAssessmentFacts(pair)) {
			reject(id);
			continue;
		}
		const { question, signature } = pair;
		result.choiceStateQuestions[id] = {
			selectionMode: question.selectionMode,
			dontKnow: question.dontKnow,
			canAutoScore: question.canAutoScore,
			graded: question.graded,
			maxAttempts: question.maxAttempts,
			correctAnswerSignature: question.correctAnswerSignature,
			materialSignature: question.materialSignature,
			options: question.options.map(({ id, materialSignature }) => ({ id, materialSignature })),
		};
		result.choiceStateSignatures[id] = signature;
	}
	return result;
}

function isCounter(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonemptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
