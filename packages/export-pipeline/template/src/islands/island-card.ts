import { createContentReveal } from "@praxity/shared-blocks/content-reveal";
import {
	readLearnerBlockState,
	writeLearnerBlockState,
} from "@praxity/shared-blocks/learner-block-state";
import {
	dispatchSelfCheckEvent,
	selfCheckEpochTicket,
	setSelfCheckTimeout,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";
import { updateBoundaryNavigation } from "../components/navigation-boundary-focus";

type CardStrings = Record<string, string>;

type CardBlockState = {
	currentId: string | null;
	flippedIds: string[];
	completedIds: string[];
};

function readRestoredCardState(
	blockId: string,
	cards: Array<HTMLElement | null>,
	single: boolean,
): CardBlockState | undefined {
	if (!blockId) return undefined;
	const state = readLearnerBlockState(blockId);
	if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
	const validIds = new Set(
		cards.flatMap((card) => (card?.dataset.cardId ? [card.dataset.cardId] : [])),
	);
	const flippableIds = new Set(
		cards.flatMap((card) =>
			card?.dataset.flippable === "true" && card.dataset.cardId ? [card.dataset.cardId] : [],
		),
	);
	const rawFlippedIds = (state as { flippedIds?: unknown }).flippedIds;
	const rawCompletedIds = (state as { completedIds?: unknown }).completedIds;
	if (!Array.isArray(rawFlippedIds) || !Array.isArray(rawCompletedIds)) return undefined;
	const flippedIds = [...new Set(rawFlippedIds)].filter(
		(id): id is string => typeof id === "string" && flippableIds.has(id),
	);
	const completedIds = [...new Set(rawCompletedIds)].filter(
		(id): id is string => typeof id === "string" && flippableIds.has(id),
	);
	const rawCurrentId = (state as { currentId?: unknown }).currentId;
	const currentId =
		single && typeof rawCurrentId === "string" && validIds.has(rawCurrentId) ? rawCurrentId : null;
	return { currentId, flippedIds, completedIds };
}

declare global {
	interface Window {
		__PRAXITY_STRINGS__?: CardStrings;
	}
}

function message(name: string, fallback: string): string {
	return window.__PRAXITY_STRINGS__?.[name] || fallback;
}

function interpolate(template: string, values: Record<string, string | number>): string {
	return Object.entries(values).reduce(
		(result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
		template,
	);
}

function announce(text: string): void {
	const liveRegion = document.getElementById("praxity-live-region");
	if (liveRegion) liveRegion.textContent = text;
}

function shuffle(items: HTMLElement[]): HTMLElement[] {
	for (let index = items.length - 1; index > 0; index--) {
		const swapIndex = Math.floor(Math.random() * (index + 1));
		[items[index], items[swapIndex]] = [items[swapIndex], items[index]];
	}
	return items;
}

function directChildren(parent: Element, selector: string): HTMLElement[] {
	return Array.from(parent.children).filter(
		(child): child is HTMLElement => child instanceof HTMLElement && child.matches(selector),
	);
}

function enhanceCardRoot(root: HTMLElement): () => void {
	if (root.dataset.cardEnhanced === "true") return () => {};
	root.dataset.cardEnhanced = "true";
	const single = root.dataset.layout === "single";
	const itemContainer = single ? root.querySelector<HTMLElement>(".praxity-slides-grid") : root;
	if (!itemContainer) {
		delete root.dataset.cardEnhanced;
		return () => {};
	}

	let slides = directChildren(itemContainer, single ? ".praxity-slides-item" : "[data-card-item]");
	if (root.dataset.shuffle === "true" && slides.length > 1) {
		slides = shuffle(slides);
		for (const slide of slides) itemContainer.append(slide);
	}
	const cards = slides.map((slide) =>
		single ? slide.querySelector<HTMLElement>("[data-card-item]") : slide,
	);
	const reveals = new Map<HTMLElement, ReturnType<typeof createContentReveal>>();
	for (const card of cards) {
		for (const face of card?.querySelectorAll<HTMLElement>('[data-card-side="back"]') ?? []) {
			if (face.closest("[data-card-item]") !== card) continue;
			const reveal = createContentReveal(face);
			reveal.element.dataset.revealPrint = "expand";
			reveals.set(face, reveal);
		}
	}
	const clearPending = () => {
		delete root.dataset.narrationPendingIndex;
		delete root.dataset.narrationPendingSide;
		delete root.dataset.narrationPendingReset;
	};
	const cleanups: Array<() => void> = [
		() => {
			for (const reveal of reveals.values()) reveal.destroy();
			clearPending();
			delete root.dataset.cardEnhanced;
		},
	];
	const blockId = root.dataset.blockId?.trim() ?? "";
	const restored = readRestoredCardState(blockId, cards, single);
	const restoredFlippedIds = new Set(restored?.flippedIds ?? []);
	const flippedIds = new Set(restoredFlippedIds);
	const completed = new Set(restored?.completedIds ?? []);
	let current = 0;
	let playing = false;
	let playthrough: (() => boolean) | undefined;
	let timer: ReturnType<typeof setSelfCheckTimeout> | undefined;
	let playButton: HTMLButtonElement | undefined;
	const updatePlayButton = () => {
		if (!playButton) return;
		const label = playing
			? message("pauseCards", "Pause cards")
			: message("playCards", "Play cards");
		playButton.setAttribute("aria-label", label);
		playButton.title = label;
		playButton.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${playing ? '<path d="M8 5v14M16 5v14" />' : '<path d="m8 5 11 7-11 7Z" />'}</svg>`;
	};
	const stopPlaythrough = () => {
		clearTimeout(timer);
		timer = undefined;
		playing = false;
		playthrough = undefined;
		updatePlayButton();
	};
	cleanups.push(stopPlaythrough);
	const revokePlaythrough = () => {
		if (playthrough && !playthrough()) stopPlaythrough();
	};
	root.ownerDocument.addEventListener("praxity:self-check-owner", revokePlaythrough);
	cleanups.push(() =>
		root.ownerDocument.removeEventListener("praxity:self-check-owner", revokePlaythrough),
	);

	const manualNavigation = () => {
		stopPlaythrough();
		clearPending();
		root.dispatchEvent(new CustomEvent("praxity:narration-manual-navigation", { bubbles: true }));
	};
	const setFlipped = (card: HTMLElement, flipped: boolean, index: number) => {
		if (card.dataset.flippable !== "true") return;
		card.dataset.flipped = String(flipped);
		const toggle = card.querySelector<HTMLElement>("[data-card-flip]");
		const inner = card.querySelector<HTMLElement>(".praxity-flashcard-inner");
		if (toggle) {
			toggle.hidden = false;
			toggle.setAttribute("aria-expanded", String(flipped));
			toggle.textContent = flipped
				? message("backToFront", "Hide answer")
				: message("turnCard", "I have my answer");
		}
		if (inner) inner.dataset.flipped = String(flipped);
		for (const face of card.querySelectorAll<HTMLElement>("[data-card-side]")) {
			if (face.closest("[data-card-item]") !== card) continue;
			const hidden = face.dataset.cardSide === "back" && !flipped;
			if (hidden && face.contains(document.activeElement)) toggle?.focus();
			reveals.get(face)?.setOpen(!hidden);
			face.toggleAttribute("inert", hidden);
			if (hidden) face.setAttribute("aria-hidden", "true");
			else face.removeAttribute("aria-hidden");
		}
	};
	const restoreFlips = () => {
		for (const [index, card] of cards.entries()) {
			if (card) {
				setFlipped(card, flippedIds.has(card.dataset.cardId ?? ""), index);
			}
		}
	};
	const persist = (owned: () => boolean) => {
		if (!blockId) return;
		writeLearnerBlockState(
			blockId,
			{
				currentId: single ? (cards[current]?.dataset.cardId ?? null) : null,
				flippedIds: [...flippedIds].sort(),
				completedIds: [...completed].sort(),
			} satisfies CardBlockState,
			owned,
		);
	};

	const updateCompletion = () => {
		if (!single) return;
		const flippable = cards.filter((card) => card?.dataset.flippable === "true").length;
		root.dataset.attempted = String(completed.size > 0);
		root.dataset.flippedCount = String(completed.size);
		root.dataset.flippedPercentage = String(
			flippable > 0 ? Math.round((completed.size / flippable) * 100) : 100,
		);
		root.dataset.completed = String(flippable === 0 || completed.size >= flippable);
	};

	for (const [index, card] of cards.entries()) {
		if (!card) continue;
		const toggle = card.querySelector<HTMLElement>("[data-card-flip]");
		if (!toggle) continue;
		const flip = (event: Event) => {
			const owned = selfCheckEpochTicket(root.ownerDocument);
			const target = event.target instanceof Element ? event.target : null;
			const nestedControl = target?.closest("a,button,input,select,textarea,[role='button']");
			if (nestedControl && nestedControl !== toggle) return;
			manualNavigation();
			const flipped = card.dataset.flipped !== "true";
			setFlipped(card, flipped, index);
			const cardId = card.dataset.cardId || String(index);
			if (flipped) flippedIds.add(cardId);
			else flippedIds.delete(cardId);
			if (single && flipped) {
				completed.add(card.dataset.cardId || String(index));
				updateCompletion();
				dispatchSelfCheckEvent(
					new CustomEvent("praxity:block-interaction", {
						detail: { blockId: root.dataset.blockId, blockType: "card" },
					}),
					owned,
					document,
				);
			}
			persist(owned);
		};
		const keydown = (event: KeyboardEvent) => {
			if (toggle instanceof HTMLButtonElement || (event.key !== "Enter" && event.key !== " "))
				return;
			event.preventDefault();
			flip(event);
		};
		toggle.addEventListener("click", flip);
		toggle.addEventListener("keydown", keydown);
		cleanups.push(() => {
			toggle.removeEventListener("click", flip);
			toggle.removeEventListener("keydown", keydown);
		});
	}

	const reveal = (event: Event) => {
		if (root.contains(document.activeElement) && document.activeElement !== root) return;
		const target = event.target instanceof Element ? event.target : null;
		if ((event as CustomEvent).detail?.resetCards === true) {
			if (target !== root) return;
			delete root.dataset.narrationPendingReset;
			for (const [index, card] of cards.entries()) {
				if (card) setFlipped(card, false, index);
			}
			if (single)
				goTo(
					cards.findIndex((card) => card?.dataset.cardIndex === "0"),
					false,
				);
			return;
		}
		const detail = (event as CustomEvent).detail?.cardTarget;
		if (detail && detail.containerId !== blockId) return;
		if (!detail && target?.closest("[data-card-root]") !== root) return;
		const card = detail
			? cards.find((candidate) => Number(candidate?.dataset.cardIndex) === detail.itemIndex)
			: (target?.closest<HTMLElement>("[data-card-item]") ??
				target?.querySelector<HTMLElement>("[data-card-item]"));
		const index = card ? cards.indexOf(card) : -1;
		if (index < 0 || !card) return;
		const back =
			(detail?.side ?? target?.closest<HTMLElement>("[data-card-side]")?.dataset.cardSide) ===
			"back";
		// Narration may follow an answer already committed by the learner, never reveal it.
		if (back && card.dataset.flipped !== "true") return;
		if (single) goTo(index, false);
		setFlipped(card, back, index);
	};
	root.addEventListener("praxity:narration-reveal", reveal);
	cleanups.push(() => root.removeEventListener("praxity:narration-reveal", reveal));

	const replayPending = () => {
		const itemIndex = Number(root.dataset.narrationPendingIndex);
		const side = root.dataset.narrationPendingSide;
		const reset = root.dataset.narrationPendingReset === "true";
		clearPending();
		if (reset)
			root.dispatchEvent(
				new CustomEvent("praxity:narration-reveal", { detail: { resetCards: true } }),
			);
		if (Number.isInteger(itemIndex) && itemIndex >= 0 && (side === "front" || side === "back")) {
			root.dispatchEvent(
				new CustomEvent("praxity:narration-reveal", {
					bubbles: true,
					detail: { cardTarget: { containerId: blockId, itemIndex, side } },
				}),
			);
		}
	};
	if (!single) {
		restoreFlips();
		replayPending();
		return () => cleanups.forEach((cleanup) => cleanup());
	}

	const controls = root.querySelector<HTMLElement>(":scope > .praxity-card-controls");
	const previous = controls?.querySelector<HTMLButtonElement>("[data-card-previous]") ?? null;
	const next = controls?.querySelector<HTMLButtonElement>("[data-card-next]") ?? null;
	const counter = controls?.querySelector<HTMLElement>("[data-card-counter]");
	const dots = Array.from(controls?.querySelectorAll<HTMLButtonElement>("[data-card-goto]") ?? []);
	const goTo = (index: number, shouldAnnounce = true, shouldPersist = false) => {
		const owned = selfCheckEpochTicket(root.ownerDocument);
		if (shouldPersist) manualNavigation();
		if (index < 0 || index >= slides.length) return;
		cards.forEach((card, cardIndex) => {
			if (card) setFlipped(card, false, cardIndex);
		});
		flippedIds.clear();
		current = index;
		for (const [slideIndex, slide] of slides.entries()) {
			const active = slideIndex === current;
			slide.dataset.active = String(active);
			slide.dataset.slideIndex = String(slideIndex);
			slide.dataset.slidePosition = active ? "active" : slideIndex < current ? "before" : "after";
			if (active) {
				slide.removeAttribute("aria-hidden");
				slide.removeAttribute("inert");
			} else {
				slide.setAttribute("aria-hidden", "true");
				slide.setAttribute("inert", "");
			}
		}
		updateBoundaryNavigation(
			previous,
			next,
			current === 0,
			current === slides.length - 1,
			slides[current],
		);
		if (counter) counter.textContent = `${current + 1} / ${slides.length}`;
		for (const [dotIndex, dot] of dots.entries()) {
			if (dotIndex === current) dot.setAttribute("aria-current", "step");
			else dot.removeAttribute("aria-current");
		}
		if (shouldAnnounce) {
			announce(
				interpolate(message("cardAnnouncement", "Card {current} of {total}"), {
					current: current + 1,
					total: slides.length,
				}),
			);
		}
		if (shouldPersist) persist(owned);
		if (current === slides.length - 1) stopPlaythrough();
	};
	const previousClick = () => goTo(current - 1, true, true);
	const nextClick = () => goTo(current + 1, true, true);
	previous?.addEventListener("click", previousClick);
	next?.addEventListener("click", nextClick);
	cleanups.push(() => {
		previous?.removeEventListener("click", previousClick);
		next?.removeEventListener("click", nextClick);
	});
	for (const [index, dot] of dots.entries()) {
		const click = () => goTo(index, true, true);
		dot.addEventListener("click", click);
		cleanups.push(() => dot.removeEventListener("click", click));
	}
	const keydown = (event: KeyboardEvent) => {
		if ((event.target as Element).closest("[data-card-root]") !== root) return;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") {
			event.preventDefault();
			goTo(current + 1, true, true);
		} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
			event.preventDefault();
			goTo(current - 1, true, true);
		}
	};
	root.addEventListener("keydown", keydown);
	cleanups.push(() => root.removeEventListener("keydown", keydown));

	const restoredIndex = restored?.currentId
		? cards.findIndex((card) => card?.dataset.cardId === restored.currentId)
		: -1;
	goTo(restoredIndex >= 0 ? restoredIndex : 0, false);
	for (const cardId of restoredFlippedIds) flippedIds.add(cardId);
	restoreFlips();
	updateCompletion();
	replayPending();

	const advance = Number(root.dataset.advance);
	if (Number.isFinite(advance) && advance > 0 && slides.length > 1) {
		const scheduleTurn = (owned: () => boolean) => {
			if (!owned()) return;
			if (!playing || current === slides.length - 1) return stopPlaythrough();
			timer = setSelfCheckTimeout(
				() => {
					if (!owned() || !playing) return;
					// Never hide focused content or disable its focused navigation control.
					if (
						root.closest("[hidden], [inert]") ||
						slides[current].contains(document.activeElement) ||
						(current === slides.length - 2 && document.activeElement === next)
					)
						return stopPlaythrough();
					goTo(current + 1);
					persist(owned);
					scheduleTurn(owned);
				},
				advance * 1000,
				owned,
			);
		};
		const start = (owned: () => boolean) => {
			if (!owned() || playing || current === slides.length - 1) return;
			playthrough = owned;
			playing = true;
			updatePlayButton();
			scheduleTurn(owned);
		};
		const toggle = () => {
			const owned = selfCheckEpochTicket(root.ownerDocument);
			if (playing) return stopPlaythrough();
			if (current === slides.length - 1) goTo(0);
			start(owned);
		};
		const syncPlayback = (event?: Event) => {
			const owned = selfCheckEpochTicket(root.ownerDocument, event);
			if (!owned()) return;
			const mode =
				root.dataset.cardPlaythroughMode ?? (root.closest(".praxity-deck") ? "pending" : "manual");
			if (mode === "manual") {
				if (!playButton) {
					playButton = document.createElement("button");
					playButton.type = "button";
					playButton.dataset.cardPlay = "";
					playButton.addEventListener("click", toggle);
					updatePlayButton();
					controls?.prepend(playButton);
				}
			} else {
				playButton?.removeEventListener("click", toggle);
				playButton?.remove();
				playButton = undefined;
				if (mode === "narration" && root.dataset.cardPlaythroughPlaying === "true") start(owned);
				else stopPlaythrough();
			}
		};
		const focus = () => {
			if (slides[current].contains(document.activeElement)) stopPlaythrough();
		};
		const activePage = () => {
			if (root.closest("[hidden], [inert]")) stopPlaythrough();
		};
		root.addEventListener("praxity:card-playthrough", syncPlayback);
		root.addEventListener("focusin", focus);
		window.addEventListener("praxity:active-page-change", activePage);
		window.addEventListener("pagehide", stopPlaythrough);
		cleanups.push(() => {
			root.removeEventListener("praxity:card-playthrough", syncPlayback);
			root.removeEventListener("focusin", focus);
			window.removeEventListener("praxity:active-page-change", activePage);
			window.removeEventListener("pagehide", stopPlaythrough);
			playButton?.removeEventListener("click", toggle);
			playButton?.remove();
		});
		syncPlayback();
	}
	return () => cleanups.forEach((cleanup) => cleanup());
}

export function initCardEnhancements(scope: ParentNode = document): () => void {
	const cleanups = Array.from(scope.querySelectorAll<HTMLElement>("[data-card-root]")).map(
		enhanceCardRoot,
	);
	return () => cleanups.forEach((cleanup) => cleanup());
}

export { initCardEnhancements as attachIsland };

if (shouldAttachIslandAutomatically()) initCardEnhancements();
