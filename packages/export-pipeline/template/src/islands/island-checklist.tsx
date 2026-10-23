import {
	readLearnerBlockState,
	writeLearnerBlockState,
} from "@praxity/shared-blocks/learner-block-state";
import {
	dispatchSelfCheckEvent,
	selfCheckEpochTicket,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";

export function initChecklistEnhancements(scope: ParentNode = document): () => void {
	const cleanups: Array<() => void> = [];
	for (const root of scope.querySelectorAll<HTMLElement>('[data-island="checklist"]')) {
		if (root.dataset.checklistEnhanced === "true") continue;
		root.dataset.checklistEnhanced = "true";
		cleanups.push(() => {
			delete root.dataset.checklistEnhanced;
		});
		const items = Array.from(root.querySelectorAll<HTMLElement>("[data-checklist-item]"));
		const blockId = root.dataset.blockId?.trim() ?? "";
		const validItemIds = new Set(
			items.map((item) => item.dataset.itemId?.trim() ?? "").filter((itemId) => itemId.length > 0),
		);
		const restored = readLearnerBlockState(blockId);
		const restoredCheckedIds =
			restored && typeof restored === "object" && !Array.isArray(restored)
				? (restored as { checkedItemIds?: unknown }).checkedItemIds
				: undefined;
		const checkedIds = new Set(
			Array.isArray(restoredCheckedIds)
				? restoredCheckedIds.filter(
						(itemId): itemId is string => typeof itemId === "string" && validItemIds.has(itemId),
					)
				: [],
		);
		for (const item of items) {
			const input = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
			const itemId = item.dataset.itemId?.trim() ?? "";
			if (input) input.checked = checkedIds.has(itemId);
		}
		const persist = (current: () => boolean) => {
			if (!blockId) return;
			writeLearnerBlockState(
				blockId,
				{
					checkedItemIds: items
						.filter(
							(item) => item.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked,
						)
						.map((item) => item.dataset.itemId?.trim() ?? "")
						.filter((itemId) => itemId.length > 0),
				},
				current,
			);
		};
		const sync = () => {
			let checked = 0;
			for (const item of items) {
				const input = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
				if (input?.checked) {
					item.setAttribute("data-checked", "");
					checked++;
				} else {
					item.removeAttribute("data-checked");
				}
			}
			root.dataset.attempted = String(checked > 0);
			root.dataset.completed = String(items.length > 0 && checked === items.length);
		};
		for (const input of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
			const onChange = () => {
				const current = selfCheckEpochTicket(root.ownerDocument);
				sync();
				persist(current);
				dispatchSelfCheckEvent(
					new CustomEvent("praxity:block-interaction", {
						detail: { blockId: root.dataset.blockId, blockType: "checklist" },
					}),
					current,
					document,
				);
			};
			input.addEventListener("change", onChange);
			cleanups.push(() => input.removeEventListener("change", onChange));
		}
		sync();
		root.setAttribute("data-hydrated", "");
	}
	return () => cleanups.forEach((cleanup) => cleanup());
}

export { initChecklistEnhancements as attachIsland };

if (shouldAttachIslandAutomatically()) initChecklistEnhancements();
