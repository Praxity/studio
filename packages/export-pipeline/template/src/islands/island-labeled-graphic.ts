import {
	readLearnerBlockState,
	writeLearnerBlockState,
} from "@praxity/shared-blocks/learner-block-state";
import {
	dispatchSelfCheckEvent,
	selfCheckEpochTicket,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";

type LabeledGraphicBlockState = { revealedIds: string[]; activeId: string | null };

function readRestoredState(
	blockId: string,
	labelIds: string[],
	sequential: boolean,
): { revealed: number[]; active: number } | undefined {
	if (!blockId) return undefined;
	const state = readLearnerBlockState(blockId);
	if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
	const rawRevealedIds = (state as { revealedIds?: unknown }).revealedIds;
	if (!Array.isArray(rawRevealedIds)) return undefined;
	const restoredIds = new Set(
		rawRevealedIds.filter((id): id is string => typeof id === "string" && labelIds.includes(id)),
	);
	const revealed = labelIds.flatMap((id, index) => (restoredIds.has(id) ? [index] : []));
	if (sequential) {
		let prefixLength = 0;
		while (revealed.includes(prefixLength)) prefixLength++;
		revealed.length = prefixLength;
	}
	const rawActiveId = (state as { activeId?: unknown }).activeId;
	const activeIndex = typeof rawActiveId === "string" ? labelIds.indexOf(rawActiveId) : -1;
	const active = activeIndex >= 0 && revealed.includes(activeIndex) ? activeIndex : -1;
	return { revealed, active };
}

function interpolate(template: string, revealed: number, total: number): string {
	return template.replaceAll("{revealed}", String(revealed)).replaceAll("{total}", String(total));
}

export function initLabeledGraphicEnhancements(scope: ParentNode = document): () => void {
	const cleanups: Array<() => void> = [];
	for (const root of scope.querySelectorAll<HTMLElement>('[data-island="labeledGraphic"]')) {
		if (root.dataset.labeledGraphicEnhanced === "true") continue;
		const graphic = root.querySelector<HTMLElement>(".praxity-labeled-graphic");
		if (!graphic || graphic.dataset.reveal === "all") continue;
		root.dataset.labeledGraphicEnhanced = "true";
		const markers = Array.from(
			graphic.querySelectorAll<HTMLElement>(".praxity-labeled-graphic-marker"),
		);
		const buttons = markers.flatMap((marker) => {
			const button = marker.querySelector<HTMLButtonElement>(".praxity-labeled-graphic-dot");
			return button ? [button] : [];
		});
		const popovers = markers.map((marker) =>
			marker.querySelector<HTMLElement>(".praxity-labeled-graphic-popover"),
		);
		const blockId = root.dataset.blockId?.trim() ?? "";
		const labelIds = markers.map((marker) => marker.dataset.labelId?.trim() ?? "");
		const hasDurableIds = labelIds.every(Boolean) && new Set(labelIds).size === labelIds.length;
		const progress = root.querySelector<HTMLElement>("[data-labeled-graphic-progress]");
		const restored = readRestoredState(
			hasDurableIds ? blockId : "",
			labelIds,
			graphic.dataset.reveal === "sequential",
		);
		const revealed = new Set(restored?.revealed ?? []);
		let active = restored?.active ?? -1;

		const update = () => {
			const next = buttons.findIndex((_, index) => !revealed.has(index));
			for (const [index, button] of buttons.entries()) {
				const expanded = index === active;
				const locked =
					graphic.dataset.reveal === "sequential" && !revealed.has(index) && index !== next;
				button.disabled = locked;
				button.setAttribute("aria-expanded", String(expanded));
				button.classList.toggle(
					"praxity-labeled-graphic-dot--next",
					graphic.dataset.reveal === "sequential" && index === next,
				);
				markers[index]?.toggleAttribute("data-active", expanded);
				if (popovers[index]) popovers[index].hidden = !expanded;
			}
			if (progress) {
				progress.textContent = interpolate(
					progress.dataset.template || "{revealed} of {total} revealed",
					revealed.size,
					buttons.length,
				);
			}
		};

		for (const [index, button] of buttons.entries()) {
			const click = () => {
				const current = selfCheckEpochTicket(root.ownerDocument);
				const next = buttons.findIndex((_, candidate) => !revealed.has(candidate));
				if (graphic.dataset.reveal === "sequential" && !revealed.has(index) && index !== next)
					return;
				const firstReveal = !revealed.has(index);
				revealed.add(index);
				active = active === index ? -1 : index;
				update();
				if (firstReveal) {
					dispatchSelfCheckEvent(
						new CustomEvent("praxity:block-interaction", {
							detail: { blockId: root.dataset.blockId, blockType: "labeledGraphic" },
						}),
						current,
						document,
					);
				}
				if (blockId && hasDurableIds) {
					writeLearnerBlockState(
						blockId,
						{
							revealedIds: labelIds.filter((_, candidate) => revealed.has(candidate)),
							activeId: active >= 0 ? labelIds[active] : null,
						} satisfies LabeledGraphicBlockState,
						current,
					);
				}
			};
			button.addEventListener("click", click);
			cleanups.push(() => button.removeEventListener("click", click));
		}
		update();
		root.setAttribute("data-hydrated", "");
	}
	return () => cleanups.forEach((cleanup) => cleanup());
}

export { initLabeledGraphicEnhancements as attachIsland };

if (shouldAttachIslandAutomatically()) initLabeledGraphicEnhancements();
