import { sha256 } from "@noble/hashes/sha2.js";
import {
	type Content,
	type LearnerState,
	validateContent,
	validateState,
} from "learning-patterns/patterns/self-check/logic.js";
import { createSelfCheckDraft, readSelfCheckDraftAnswer } from "./self-check-draft";

export interface SelfCheckState {
	version: 1;
	kind: "self-check";
	draft: LearnerState & { shown: false };
	submitted: (LearnerState & { shown: true; contentRevision: string }) | null;
}

/** Data for praxity:assessment-response. Only a deliberate submit returns it. */
export interface SelfCheckAssessmentResponse {
	blockId: string;
	assessmentType: "textResponse";
	responseText: string;
	questionText: string;
	language: string;
	result: "neutral";
	submitted: true;
}

export interface SelfCheckStateResult {
	status: "empty" | "valid" | "invalid" | "out-of-date";
	state: SelfCheckState | null;
	recoverableAnswer: string | null;
	attempted: boolean;
	completed: boolean;
	response: SelfCheckAssessmentResponse | null;
}

/** Reset is also the initial state. No completion or feedback is persisted. */
export function resetSelfCheckState(): SelfCheckStateResult {
	return {
		status: "empty",
		state: createSelfCheckDraft(),
		recoverableAnswer: "",
		attempted: false,
		completed: false,
		response: null,
	};
}

/** Comparison compatibility, independent of source/artifact revision and part order.
 * Hash exact decoded Content: grammar already handles structural line endings and
 * continuation indentation; authored whitespace and Unicode spelling can carry meaning.
 */
export function selfCheckContentRevision(content: Content): string {
	assertContent(content);
	const context = content.context;
	const canonical = JSON.stringify([
		"self-check",
		1,
		content.task,
		content.model,
		context ? [context.to, context.initials, context.subject, context.placeholder ?? null] : null,
		[...content.parts]
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
			.map((part) => [part.id, part.label, part.missed, part.evidence]),
	]);
	try {
		// Synchronous SHA-256 also works in HTTP-framed and offline learner contexts.
		const digest = sha256(new TextEncoder().encode(canonical));
		return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
	} catch {
		throw new Error("ESELFCHECKREVISION");
	}
}

/** Pure read: never rewrites saved bytes or replays a response. Invalid IDs refuse
 * the entire envelope; readable draft text remains available for learner recovery.
 */
export function restoreSelfCheckState(content: Content, value: unknown): SelfCheckStateResult {
	assertContent(content);
	if (value === undefined) return resetSelfCheckState();
	const recoverableAnswer = readSelfCheckDraftAnswer(value) ?? null;
	const invalid: SelfCheckStateResult = {
		status: "invalid",
		state: null,
		recoverableAnswer,
		attempted: false,
		completed: false,
		response: null,
	};
	if (
		!hasFields(value, ["version", "kind", "draft", "submitted"]) ||
		value.version !== 1 ||
		value.kind !== "self-check"
	)
		return invalid;
	const draft = readDraft(content, value.draft);
	let submitted: SelfCheckState["submitted"] = null;
	let submittedRevision: string | null = null;
	if (value.submitted !== null) {
		if (
			!hasFields(value.submitted, ["answer", "ticked", "shown", "contentRevision"]) ||
			value.submitted.shown !== true ||
			typeof value.submitted.answer !== "string" ||
			!value.submitted.answer.trim() ||
			typeof value.submitted.contentRevision !== "string" ||
			!/^sha256:[a-f0-9]{64}$/.test(value.submitted.contentRevision)
		)
			return invalid;
		const validated = validateState(content, value.submitted);
		submittedRevision = value.submitted.contentRevision;
		if (validated) submitted = { ...validated, shown: true, contentRevision: submittedRevision };
	}
	const current =
		submittedRevision === null || submittedRevision === selfCheckContentRevision(content);
	if (!draft || (submittedRevision !== null && submitted === null))
		return { ...invalid, status: current ? "invalid" : "out-of-date" };
	return {
		status: current ? "valid" : "out-of-date",
		state: { version: 1, kind: "self-check", draft, submitted },
		recoverableAnswer: draft.answer,
		attempted: current && submitted !== null,
		completed: current && submitted !== null,
		response: null,
	};
}

/** An explicit edit may replace rejected state. A readable previous comparison
 * stays separate from the draft, including when its content revision is stale.
 */
export function editSelfCheckDraft(
	content: Content,
	value: unknown,
	draftValue: unknown,
): SelfCheckStateResult {
	const previous = restoreSelfCheckState(content, value);
	const draft = readDraft(content, draftValue);
	if (!draft) throw new Error("ESELFCHECKSTATE");
	return restoreSelfCheckState(content, {
		version: 1,
		kind: "self-check",
		draft,
		submitted: previous.state?.submitted ?? null,
	});
}

export function submitSelfCheck(
	content: Content,
	value: unknown,
	metadata: { blockId: string; language: string },
): SelfCheckStateResult {
	const restored = restoreSelfCheckState(content, value);
	if (!restored.state) throw new Error("ESELFCHECKSTATE");
	const { draft } = restored.state;
	if (!draft.answer.trim()) throw new Error("ESELFCHECKANSWER");
	const submitted: NonNullable<SelfCheckState["submitted"]> = {
		answer: draft.answer,
		ticked: [...draft.ticked],
		shown: true,
		contentRevision: selfCheckContentRevision(content),
	};
	return {
		status: "valid",
		state: { ...restored.state, submitted },
		recoverableAnswer: draft.answer,
		attempted: true,
		completed: true,
		response: {
			blockId: metadata.blockId,
			assessmentType: "textResponse",
			responseText: submitted.answer,
			questionText: normalizeText(content.task),
			language: metadata.language,
			result: "neutral",
			submitted: true,
		},
	};
}

function readDraft(content: Content, value: unknown): SelfCheckState["draft"] | null {
	if (!hasFields(value, ["answer", "ticked", "shown"]) || value.shown !== false) return null;
	const validated = validateState(content, value);
	return validated ? { ...validated, shown: false } : null;
}

function assertContent(content: Content): void {
	try {
		validateContent(content);
	} catch {
		throw new Error("ESELFCHECKCONTENT");
	}
}

function normalizeText(text: string): string {
	return text
		.normalize("NFC")
		.replace(/[\p{White_Space}\uFEFF]+/gu, " ")
		.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasFields(value: unknown, fields: string[]): value is Record<string, unknown> {
	return (
		isRecord(value) &&
		Object.keys(value).length === fields.length &&
		fields.every((field) => Object.hasOwn(value, field))
	);
}
