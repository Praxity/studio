import type { LearnerStateValue } from "./learner-state";
import type { SelfCheckState } from "./self-check-state";

export function createSelfCheckDraft(answer = ""): SelfCheckState {
	return {
		version: 1,
		kind: "self-check",
		draft: { answer, ticked: [], shown: false },
		submitted: null,
	};
}

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
