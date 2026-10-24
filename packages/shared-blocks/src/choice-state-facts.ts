import { sha256 } from "@noble/hashes/sha2.js";
import { isChoiceContentSignature } from "./learner-state";

export interface ChoiceMaterialContent {
	text: string;
	images: readonly string[];
	icons: readonly string[];
}

/** Published effective facts. Saved-answer admission remains dormant. */
export interface ChoiceStateQuestion {
	selectionMode: "single" | "multiple";
	dontKnow: boolean;
	canAutoScore: boolean;
	graded: boolean;
	gradingMode: "none" | "exact" | "partial";
	points: number;
	required: boolean;
	/** Zero means unlimited. */
	maxAttempts: number;
	correctIds: readonly string[];
	content: ChoiceMaterialContent;
	options: readonly { id: string; content: ChoiceMaterialContent; image: string | null }[];
}

export function choiceMaterialSignature(value: unknown): string {
	const bytes = sha256(new TextEncoder().encode(JSON.stringify(value))).subarray(0, 12);
	return `s96:${btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")}`;
}

/** Explicit fields make property order and unrelated metadata immaterial. */
export function choiceQuestionSignature(question: ChoiceStateQuestion): string {
	const content = (value: ChoiceMaterialContent) => [value.text, value.images, value.icons];
	return choiceMaterialSignature([
		"choice-material",
		4,
		question.selectionMode,
		question.dontKnow,
		question.gradingMode,
		question.points,
		question.required,
		question.maxAttempts,
		[...question.correctIds].sort(),
		content(question.content),
		[...question.options]
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
			.map((option) => [option.id, content(option.content), option.image]),
	]);
}

function isMaterialContent(value: unknown): value is ChoiceMaterialContent {
	return (
		isRecord(value) &&
		typeof value.text === "string" &&
		Array.isArray(value.images) &&
		Array.from(value.images).every(isNonemptyString) &&
		Array.isArray(value.icons) &&
		Array.from(value.icons).every(isNonemptyString)
	);
}

export function isChoiceStateQuestion(value: unknown): value is ChoiceStateQuestion {
	return (
		isRecord(value) &&
		(value.selectionMode === "single" || value.selectionMode === "multiple") &&
		typeof value.dontKnow === "boolean" &&
		typeof value.canAutoScore === "boolean" &&
		typeof value.graded === "boolean" &&
		(value.gradingMode === "none" ||
			value.gradingMode === "exact" ||
			value.gradingMode === "partial") &&
		value.graded === (value.gradingMode !== "none") &&
		Number.isFinite(value.points) &&
		(value.points as number) >= 0 &&
		typeof value.required === "boolean" &&
		isCounter(value.maxAttempts) &&
		isMaterialContent(value.content) &&
		Array.isArray(value.options) &&
		Array.from(value.options).every(
			(option) =>
				isRecord(option) &&
				isNonemptyString(option.id) &&
				isMaterialContent(option.content) &&
				(option.image === null || typeof option.image === "string"),
		) &&
		new Set(value.options.map((option) => option.id)).size === value.options.length &&
		Array.isArray(value.correctIds) &&
		Array.from(value.correctIds).every((id) =>
			(value.options as { id: string }[]).some((option) => option.id === id),
		) &&
		new Set(value.correctIds).size === value.correctIds.length &&
		value.canAutoScore === value.correctIds.length > 0
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
		value.signature === choiceQuestionSignature(value.question)
	);
}

export interface ChoiceStateFacts {
	choiceStateQuestions: Record<string, ChoiceStateQuestion>;
	choiceStateSignatures: Record<string, string>;
	choiceStateGroups?: Record<string, ChoiceStateGroup>;
}

export interface AdmittedChoiceStateFacts extends ChoiceStateFacts {
	/** Invalid metadata must remain history when saved admission activates. */
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
			gradingMode: question.gradingMode,
			points: question.points,
			required: question.required,
			correctIds: [...question.correctIds],
			content: {
				text: question.content.text,
				images: [...question.content.images],
				icons: [...question.content.icons],
			},
			options: question.options.map(({ id, content, image }) => ({
				id,
				image,
				content: { text: content.text, images: [...content.images], icons: [...content.icons] },
			})),
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
