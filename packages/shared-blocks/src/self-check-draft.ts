import type { LearnerStateValue } from "./learner-state";
import type { SelfCheckState } from "./self-check-state";

/** Before Check, there are no criterion IDs to validate or comparison to retain. */
export function createSelfCheckDraft(answer = ""): SelfCheckState {
	return {
		version: 1,
		kind: "self-check",
		draft: { answer, ticked: [], shown: false },
		submitted: null,
	};
}

/** Preserve opaque saved comparison bytes until Content can validate them. */
export function updateSelfCheckDraftAnswer(
	answer: string,
	previous: LearnerStateValue | undefined,
): LearnerStateValue {
	const fresh = createSelfCheckDraft(answer);
	if (
		previous &&
		typeof previous === "object" &&
		!Array.isArray(previous) &&
		previous.version === fresh.version &&
		previous.kind === fresh.kind &&
		previous.draft &&
		typeof previous.draft === "object" &&
		!Array.isArray(previous.draft)
	)
		return { ...previous, draft: { ...previous.draft, answer, shown: false } };
	return { ...fresh };
}

/** Native recovery exposes answer text without admitting the saved comparison. */
export function readSelfCheckDraftAnswer(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value) || !("draft" in value)) return;
	const draft = value.draft;
	return draft &&
		typeof draft === "object" &&
		!Array.isArray(draft) &&
		"answer" in draft &&
		typeof draft.answer === "string"
		? draft.answer
		: undefined;
}
