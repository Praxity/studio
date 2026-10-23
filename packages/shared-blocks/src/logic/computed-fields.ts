export interface ComputedFieldValues {
	[fieldName: string]: string | number | boolean;
}

type BlockFieldComputer = (blockEl: Element) => ComputedFieldValues;

const computers: Record<string, BlockFieldComputer> = {
	checklist: (el) => {
		const items = el.querySelectorAll("[data-checklist-item]");
		const checked = el.querySelectorAll("[data-checklist-item][data-checked]");
		const selectedLabels: string[] = [];
		for (let i = 0; i < checked.length; i++) {
			selectedLabels.push(checked[i].textContent ?? "");
		}
		return {
			isAttempted: checked.length > 0,
			isCompleted: items.length > 0 && checked.length === items.length,
			completedCount: checked.length,
			allChecked: items.length > 0 && checked.length === items.length,
			selectedOptions: selectedLabels.join(","),
		};
	},
	rating: (el) => {
		const val = Number(el.getAttribute("data-rating-value") ?? 0);
		return {
			isAttempted: el.getAttribute("data-rating-value") !== null,
			isCompleted: el.getAttribute("data-rating-value") !== null,
			ratingScore: val,
			value: val, // backward compat alias
		};
	},
	signature: (el) => {
		const s = el.getAttribute("data-signed") === "true";
		return {
			isAttempted: s,
			isCompleted: s,
			isSigned: s,
			signed: s, // backward compat alias
		};
	},
	assessment: (el) => {
		const score = Number(el.getAttribute("data-score") ?? 0);
		const passed = el.getAttribute("data-passed") === "true";
		const selectedOption = el.getAttribute("data-selected-option") ?? "";
		const result = el.getAttribute("data-result") ?? "";
		return {
			isAttempted: el.getAttribute("data-attempted") === "true",
			isCompleted: el.getAttribute("data-completed") === "true",
			score,
			passed,
			selectedOption,
			result,
			isCorrect: result === "correct" || passed,
		};
	},
	card: (el) => ({
		isAttempted: el.getAttribute("data-attempted") === "true",
		isCompleted: el.getAttribute("data-completed") === "true",
		flippedPercentage: Number(el.getAttribute("data-flipped-percentage") ?? 0),
		flippedCount: Number(el.getAttribute("data-flipped-count") ?? 0),
	}),
};

export function computeBlockFields(blockType: string, blockEl: Element): ComputedFieldValues {
	const computer = computers[blockType];
	return computer ? computer(blockEl) : {};
}
