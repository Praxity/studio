import { type LearnerBlockStateRuntime, readLearnerBlockPolicy } from "./learner-block-state";
import { dispatchSelfCheckEvent, selfCheckEpochTicket } from "./self-check-consumers";

export interface LearnerBlockResponseTruncated {
	blockId: string;
	responseLimit: number;
}

export function reportLearnerBlockResponse(
	detail: {
		blockId: string;
		[key: string]: unknown;
	},
	owner?: { document: Document; provider?: LearnerBlockStateRuntime; current(): boolean },
): void {
	const doc = owner?.document ?? (typeof document === "undefined" ? undefined : document);
	if (!doc) return;
	const current = owner ? () => owner.current() : selfCheckEpochTicket(doc);
	if (!current()) return;
	const policy = owner
		? owner.provider?.getPolicy?.(detail.blockId)
		: readLearnerBlockPolicy(detail.blockId);
	if (!current() || policy === "device") return;
	dispatchSelfCheckEvent(
		new CustomEvent("praxity:assessment-response", { detail, cancelable: true }),
		current,
		doc,
	);
}
