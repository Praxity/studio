import { readSelfCheckField, selfCheckConsumers } from "../self-check-consumers";
import { findBlockElement } from "./block-element.ts";
import { computeBlockFields } from "./computed-fields.ts";
import type { LearnerTracker } from "./learner-tracker.ts";
import type { VariableStore } from "./variable-store.ts";

export class MentionResolver {
	constructor(
		private variableStore: VariableStore,
		private pageBlocks: Array<{ id: string; type: string }>,
		private learnerTracker?: LearnerTracker,
	) {}

	/**
	 * Resolve all mention placeholders in the DOM.
	 * Call after logic evaluation and on block interactions.
	 */
	resolve(): void {
		const mentions = document.querySelectorAll("[data-mention]");
		for (let i = 0; i < mentions.length; i++) {
			const el = mentions[i];
			if (!(el instanceof HTMLElement)) continue;
			const ref = el.getAttribute("data-mention") ?? "";
			const fallback = el.getAttribute("data-fallback") ?? "";
			const value = this.resolveValue(ref);
			el.textContent = value !== undefined ? String(value) : fallback;
		}
	}

	private resolveValue(ref: string): string | number | boolean | undefined {
		if (ref.startsWith("variable:")) {
			const varName = ref.slice("variable:".length);
			return this.variableStore.get(varName);
		}
		if (ref.startsWith("blockOutput:")) {
			const parts = ref.split(":");
			const blockId = parts[1];
			const field = parts[2];
			if (!blockId || !field) return undefined;
			const block = this.pageBlocks.find((b) => b.id === blockId);
			if (!block) return undefined;
			if (block.type === "selfCheck")
				return readSelfCheckField(selfCheckConsumers(), blockId, field);
			const blockEl = findBlockElement(blockId);
			if (!blockEl) return undefined;
			const fields = computeBlockFields(block.type, blockEl);
			return fields[field];
		}
		if (ref.startsWith("learnerInfo:")) {
			// ref format: "learnerInfo:scope:metric" e.g. "learnerInfo:course:grade"
			const parts = ref.split(":");
			const scope = parts[1];
			const metric = parts[2];
			if (this.learnerTracker && scope && metric) {
				return this.learnerTracker.getMetric(
					metric as "grade" | "progress" | "visitCount" | "timeOn",
					scope as "course" | "lesson" | "page",
				);
			}
			return undefined;
		}
		return undefined;
	}
}
