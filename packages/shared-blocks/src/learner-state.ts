import type { ChoiceMaterialProof } from "./choice-state-facts";

/** Persisted signature syntax stays independent of the material-hashing runtime. */
export function isChoiceContentSignature(value: unknown): value is string {
	return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

/** A versioned 96-bit digest is the SCORM 1.2 capacity policy, never an unsigned claim. */
export function isScorm12ChoiceSignature(value: unknown): value is `s96:${string}` {
	return typeof value === "string" && /^s96:[A-Za-z0-9_-]{16}$/.test(value);
}

export function choiceEvidenceSignature(signature: string, format?: "scorm12"): string {
	if (format !== "scorm12" || isScorm12ChoiceSignature(signature)) return signature;
	if (!isChoiceContentSignature(signature)) throw new TypeError("Invalid choice signature");
	let bytes = "";
	for (let at = 7; at < 31; at += 2)
		bytes += String.fromCharCode(Number.parseInt(signature.slice(at, at + 2), 16));
	return `s96:${btoa(bytes).replaceAll("+", "-").replaceAll("/", "_")}`;
}

/** Select evidence at the state destination; historical submissions retain their original claims. */
export function choiceStateForDestination(
	value: LearnerStateValue,
	format?: "scorm12",
): LearnerStateValue {
	if (
		format !== "scorm12" ||
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		value.kind !== "assessment" ||
		value.assessmentType !== "choice" ||
		!(
			isChoiceContentSignature(value.contentSignature) ||
			isScorm12ChoiceSignature(value.contentSignature)
		)
	)
		return value;
	const { materialProof: _proof, ...state } = value;
	return { ...state, contentSignature: choiceEvidenceSignature(value.contentSignature, format) };
}

export type LearnerCompletion = "incomplete" | "completed" | "passed" | "failed";

export type LearnerStateValue =
	| string
	| number
	| boolean
	| null
	| LearnerStateValue[]
	| { [key: string]: LearnerStateValue };

export interface SavedAssessmentState {
	version: 1;
	kind: "assessment";
	assessmentType: string;
	attemptCount: number;
	checked: boolean;
	correct: boolean;
	completed: boolean;
	interacted: boolean;
	answer: LearnerStateValue;
	reviewedChoiceIds?: string[];
	savedAt?: string;
	contentSignature?: string;
	materialProof?: ChoiceMaterialProof | { optionIds: string[] };
	writtenAt?: number;
	legacyBuildRevision?: string | null;
	history?: LearnerStateValue[];
}

export interface LearnerStateInteraction {
	id: string;
	response: string;
	correct?: boolean;
	score?: number;
	timestamp: number;
}

export interface LearnerStateV1 {
	schemaVersion: 1;
	courseId: string;
	attemptId: string;
	revision: string | null;
	generation: number;
	sequence: number;
	bookmark: string | null;
	visitedPageIds: string[];
	interactions: LearnerStateInteraction[];
	completion: LearnerCompletion;
	score: { raw: number; min: number; max: number } | null;
	variables: Record<string, string | number | boolean>;
	blockState: Record<string, LearnerStateValue>;
	custom: string | null;
}

export const LEARNER_STATE_SCHEMA_VERSION = 1;
export const LEARNER_STATE_MAX_BYTES = 256 * 1024;

export function createLearnerState(options: {
	courseId: string;
	attemptId: string;
	revision?: string | null;
	generation?: number;
	sequence?: number;
}): LearnerStateV1 {
	if (!options.courseId || !options.attemptId) {
		throw new Error("Learner state requires course and attempt IDs.");
	}
	return {
		schemaVersion: LEARNER_STATE_SCHEMA_VERSION,
		courseId: options.courseId,
		attemptId: options.attemptId,
		revision: options.revision ?? null,
		generation: options.generation ?? 0,
		sequence: options.sequence ?? 0,
		bookmark: null,
		visitedPageIds: [],
		interactions: [],
		completion: "incomplete",
		score: null,
		variables: {},
		blockState: {},
		custom: null,
	};
}

export function parseLearnerState(
	raw: string,
	expected: { courseId: string; attemptId: string },
): LearnerStateV1 | null {
	if (new TextEncoder().encode(raw).byteLength > LEARNER_STATE_MAX_BYTES) return null;
	try {
		const value = JSON.parse(raw) as unknown;
		return isLearnerState(value, expected) ? value : null;
	} catch {
		return null;
	}
}

export function serializeLearnerState(state: LearnerStateV1): string {
	const serialized = JSON.stringify(state);
	if (new TextEncoder().encode(serialized).byteLength > LEARNER_STATE_MAX_BYTES) {
		throw new Error(`Learner state exceeds ${LEARNER_STATE_MAX_BYTES} bytes.`);
	}
	return serialized;
}

function isLearnerState(
	value: unknown,
	expected: { courseId: string; attemptId: string },
): value is LearnerStateV1 {
	if (!isRecord(value)) return false;
	if (
		value.schemaVersion !== LEARNER_STATE_SCHEMA_VERSION ||
		value.courseId !== expected.courseId ||
		value.attemptId !== expected.attemptId ||
		!(value.revision === null || typeof value.revision === "string") ||
		!isCounter(value.generation) ||
		!isCounter(value.sequence) ||
		!(value.bookmark === null || isNonemptyString(value.bookmark)) ||
		!Array.isArray(value.visitedPageIds) ||
		!value.visitedPageIds.every(isNonemptyString) ||
		!Array.isArray(value.interactions) ||
		!value.interactions.every(isInteraction) ||
		!isCompletion(value.completion) ||
		!(value.score === null || isScore(value.score)) ||
		!isVariables(value.variables) ||
		!isRecord(value.blockState) ||
		!Object.values(value.blockState).every((item) => isJsonValue(item, 0)) ||
		!(value.custom === null || typeof value.custom === "string")
	) {
		return false;
	}
	return true;
}

function isInteraction(value: unknown): value is LearnerStateInteraction {
	if (!isRecord(value)) return false;
	return (
		isNonemptyString(value.id) &&
		typeof value.response === "string" &&
		(value.correct === undefined || typeof value.correct === "boolean") &&
		(value.score === undefined || isFiniteNumber(value.score)) &&
		isFiniteNumber(value.timestamp) &&
		value.timestamp >= 0
	);
}

function isScore(value: unknown): value is LearnerStateV1["score"] {
	return (
		isRecord(value) &&
		isFiniteNumber(value.raw) &&
		isFiniteNumber(value.min) &&
		isFiniteNumber(value.max)
	);
}

function isVariables(value: unknown): value is LearnerStateV1["variables"] {
	return (
		isRecord(value) &&
		Object.values(value).every(
			(item) => typeof item === "string" || typeof item === "boolean" || isFiniteNumber(item),
		)
	);
}

function isJsonValue(value: unknown, depth: number): value is LearnerStateValue {
	if (depth > 20) return false;
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		isFiniteNumber(value)
	) {
		return true;
	}
	if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
	return isRecord(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function isCompletion(value: unknown): value is LearnerCompletion {
	return (
		value === "incomplete" || value === "completed" || value === "passed" || value === "failed"
	);
}

function isCounter(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isNonemptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
