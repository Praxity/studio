import {
	readLearnerBlockState,
	writeLearnerBlockState,
} from "@praxity/shared-blocks/learner-block-state";
import {
	dispatchSelfCheckEvent,
	selfCheckEpochTicket,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";
import { bindDeckControls } from "../components/deck-control-activation";

type RatingBlockState = { value: number };

function readRestoredRatingValue(blockId: string, options: HTMLInputElement[]): number | undefined {
	if (!blockId) return undefined;
	const state = readLearnerBlockState(blockId);
	if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
	const rawValue = (state as { value?: unknown }).value;
	const value =
		typeof rawValue === "number"
			? rawValue
			: typeof rawValue === "string"
				? Number(rawValue)
				: Number.NaN;
	if (!Number.isFinite(value)) return undefined;

	const values = options.map((option) => Number(option.value)).filter(Number.isFinite);
	if (values.length === 0) return undefined;
	// A stored 0 means nothing was selected; clamping it would invent a rating.
	if (value <= 0 && !values.includes(value)) return undefined;
	const bounded = Math.max(Math.min(value, Math.max(...values)), Math.min(...values));
	return values.reduce((nearest, candidate) =>
		Math.abs(candidate - bounded) < Math.abs(nearest - bounded) ? candidate : nearest,
	);
}

function enhanceRatingRoot(root: HTMLElement): () => void {
	if (root.dataset.ratingEnhanced === "true") return () => {};
	root.dataset.ratingEnhanced = "true";
	const fieldset = root.querySelector<HTMLElement>(":scope > .praxity-rating");
	const options = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
	if (!fieldset || options.length === 0) return () => {};
	const labels = options.map((input) => input.labels?.[0] ?? null);
	const blockId = root.dataset.blockId?.trim() ?? "";
	const cleanups: Array<() => void> = [];
	const slider = fieldset.querySelector<HTMLInputElement>('input[type="range"]');
	const output = fieldset.querySelector<HTMLOutputElement>("output");
	const feedback = root.querySelector<HTMLElement>("[data-rating-feedback]");
	const feedbackTemplate = root.querySelector<HTMLTemplateElement>(
		"[data-rating-feedback-template]",
	);

	const paint = (value: number) => {
		const cumulative = ["stars", "emoji"].includes(fieldset.dataset.ratingStyle ?? "");
		for (const [index, label] of labels.entries()) {
			label?.setAttribute(
				"data-rating-active",
				String(cumulative ? index + 1 <= value : index + 1 === value),
			);
		}
	};
	const sync = () => {
		const selected = options.find((input) => input.checked);
		if (!selected) {
			if (feedback) {
				feedback.hidden = true;
				feedback.replaceChildren();
			}
			delete root.dataset.ratingValue;
			root.dataset.attempted = "false";
			root.dataset.completed = "false";
			paint(0);
			return;
		}
		root.dataset.ratingValue = selected.value;
		if (feedback?.hidden) {
			feedback.hidden = false;
			if (feedbackTemplate) {
				feedback.append(feedbackTemplate.content.cloneNode(true));
				// Authored feedback can link to course slides; clones carry no listeners.
				bindDeckControls(feedback);
			}
		}
		root.dataset.attempted = "true";
		root.dataset.completed = "true";
		paint(Number(selected.value));
		if (slider) {
			slider.value = selected.value;
			const label =
				selected.labels?.[0]?.querySelector(".praxity-sr-only")?.textContent?.trim() ??
				selected.value;
			slider.setAttribute("aria-valuetext", label);
			if (output) output.textContent = label;
		}
	};

	const choose = (input: HTMLInputElement, current: () => boolean) => {
		sync();
		dispatchSelfCheckEvent(
			new CustomEvent("praxity:block-interaction", {
				detail: { blockId: root.dataset.blockId, blockType: "rating" },
			}),
			current,
			document,
		);
		const value = Number(input.value);
		if (blockId && Number.isFinite(value)) {
			writeLearnerBlockState(blockId, { value } satisfies RatingBlockState, current);
		}
	};
	for (const [index, input] of options.entries()) {
		const change = () => choose(input, selfCheckEpochTicket(root.ownerDocument));
		input.addEventListener("change", change);
		cleanups.push(() => input.removeEventListener("change", change));

		const label = labels[index];
		if (!label || !["stars", "emoji"].includes(fieldset.dataset.ratingStyle ?? "")) continue;
		const preview = () => paint(index + 1);
		label.addEventListener("pointerenter", preview);
		cleanups.push(() => label.removeEventListener("pointerenter", preview));
	}
	if (slider) {
		slider.disabled = false;
		const optionGroup = fieldset.querySelector<HTMLElement>(".praxity-rating-options");
		if (optionGroup) optionGroup.hidden = true;
		const choose = () => {
			const selected = options.find((option) => option.value === slider.value);
			if (!selected) return;
			selected.checked = true;
			selected.dispatchEvent(new Event("change"));
		};
		for (const event of ["input", "change", "pointerup"]) {
			slider.addEventListener(event, choose);
			cleanups.push(() => slider.removeEventListener(event, choose));
		}
		const keydown = (event: KeyboardEvent) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				choose();
			}
		};
		slider.addEventListener("keydown", keydown);
		cleanups.push(() => slider.removeEventListener("keydown", keydown));
	}
	const resetPreview = () => sync();
	fieldset.addEventListener("pointerleave", resetPreview);
	cleanups.push(() => fieldset.removeEventListener("pointerleave", resetPreview));

	// Native input can precede attachment, but reset or provider replacement revokes its ticket.
	const pending =
		root.ownerDocument.defaultView?.__praxitySelfCheckDocument?.takePendingRating(root);
	for (const option of options) option.checked = false;
	const restoredValue = pending ? Number(pending.value) : readRestoredRatingValue(blockId, options);
	if (restoredValue !== undefined) {
		const restored = options.find((option) => Number(option.value) === restoredValue);
		if (restored) {
			restored.checked = true;
			if (pending) choose(restored, pending.current);
		}
	}
	sync();
	root.setAttribute("data-hydrated", "");
	return () => {
		for (const cleanup of cleanups) cleanup();
		delete root.dataset.ratingEnhanced;
	};
}

export function initRatingEnhancements(scope: ParentNode = document): () => void {
	const cleanups = Array.from(scope.querySelectorAll<HTMLElement>('[data-island="rating"]')).map(
		enhanceRatingRoot,
	);
	return () => cleanups.forEach((cleanup) => cleanup());
}

export { initRatingEnhancements as attachIsland };

if (shouldAttachIslandAutomatically()) initRatingEnhancements();

declare global {
	interface Window {
		PraxityRatingIsland?: { attachIsland: typeof initRatingEnhancements };
	}
}
