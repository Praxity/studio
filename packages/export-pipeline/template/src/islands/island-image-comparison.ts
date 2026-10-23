import {
	readLearnerBlockState,
	writeLearnerBlockState,
} from "@praxity/shared-blocks/learner-block-state";
import {
	selfCheckEpochTicket,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";

type ImageComparisonBlockState = { position: number };

function readRestoredPosition(blockId: string, input: HTMLInputElement): number | undefined {
	if (!blockId) return undefined;
	const state = readLearnerBlockState(blockId);
	if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
	const rawPosition = (state as { position?: unknown }).position;
	const position =
		typeof rawPosition === "number"
			? rawPosition
			: typeof rawPosition === "string"
				? Number(rawPosition)
				: Number.NaN;
	if (!Number.isFinite(position)) return undefined;

	const rawMin = Number(input.min);
	const rawMax = Number(input.max);
	const min = Number.isFinite(rawMin) ? rawMin : 0;
	const max = Number.isFinite(rawMax) ? rawMax : 100;
	const bounded = Math.max(min, Math.min(max, position));
	const step = input.step === "any" ? 0 : Number(input.step);
	if (!Number.isFinite(step) || step <= 0) return bounded;
	const stepped = min + Math.round((bounded - min) / step) * step;
	return Math.max(min, Math.min(max, stepped));
}

function enhanceImageComparison(root: HTMLElement): () => void {
	if (root.dataset.comparisonEnhanced === "true") return () => {};
	const slider = root.querySelector<HTMLElement>(".praxity-comparison-slider");
	const input = slider?.querySelector<HTMLInputElement>('input[type="range"]');
	if (!slider || !input) return () => {};

	root.dataset.comparisonEnhanced = "true";
	const blockId = root.dataset.blockId?.trim() ?? "";
	const beforeLabel =
		slider.querySelector<HTMLElement>(".praxity-comparison-label--before")?.textContent?.trim() ||
		"Before";
	const afterLabel =
		slider.querySelector<HTMLElement>(".praxity-comparison-label--after")?.textContent?.trim() ||
		"After";
	const sync = () => {
		const position = Math.max(0, Math.min(100, Math.round(input.valueAsNumber)));
		slider.style.setProperty("--praxity-comparison-position", `${position}%`);
		input.setAttribute("aria-valuenow", String(position));
		input.setAttribute(
			"aria-valuetext",
			`${position}% ${beforeLabel}, ${100 - position}% ${afterLabel}`,
		);
	};

	const onInput = () => {
		const current = selfCheckEpochTicket(root.ownerDocument);
		sync();
		const position = input.valueAsNumber;
		if (blockId && Number.isFinite(position)) {
			writeLearnerBlockState(blockId, { position } satisfies ImageComparisonBlockState, current);
		}
	};
	input.addEventListener("input", onInput);
	const restoredPosition = readRestoredPosition(blockId, input);
	if (restoredPosition !== undefined) input.value = String(restoredPosition);
	sync();
	root.setAttribute("data-hydrated", "");
	return () => input.removeEventListener("input", onInput);
}

export function initImageComparisonEnhancements(scope: ParentNode = document): () => void {
	const cleanups = Array.from(
		scope.querySelectorAll<HTMLElement>('[data-island="imageComparison"]'),
	).map(enhanceImageComparison);
	return () => cleanups.forEach((cleanup) => cleanup());
}

export { initImageComparisonEnhancements as attachIsland };

if (shouldAttachIslandAutomatically()) initImageComparisonEnhancements();
