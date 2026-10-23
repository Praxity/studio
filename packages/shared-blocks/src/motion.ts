export type MotionEntrance = "none" | "fade" | "slide" | "scale";
export type MotionStagger = "none" | "sequential";

export const ENTRANCE_MOTION_GLOBAL = "__PRAXITY_INIT_ENTRANCE_MOTION__";

type MotionWindow = Window & {
	[ENTRANCE_MOTION_GLOBAL]?: typeof initializeEntranceMotion;
};

const ITEM_SELECTOR = ".praxity-sequence-item, .praxity-card-item, .praxity-stats-item";

function setVisible(root: ParentNode): void {
	for (const element of root.querySelectorAll<HTMLElement>(`.praxity-block, ${ITEM_SELECTOR}`)) {
		element.dataset.entrance = "visible";
	}
}

/** Initialize block and item entrance motion below a single Praxity root. */
export function initializeEntranceMotion(root: HTMLElement): () => void {
	let observer: IntersectionObserver | undefined;
	const showAll = () => setVisible(root);

	try {
		const view = root.ownerDocument.defaultView;
		const entrance = (root.dataset.praxityMotionEntrance ?? "none") as MotionEntrance;
		const stagger = (root.dataset.praxityMotionStagger ?? "none") as MotionStagger;
		const reducedMotion =
			root.hasAttribute("data-praxity-reduced-motion") ||
			root.ownerDocument.documentElement.hasAttribute("data-praxity-reduced-motion") ||
			view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		const Observer = view?.IntersectionObserver;

		if (entrance === "none" || reducedMotion || !Observer) {
			showAll();
			return showAll;
		}

		const blocks = root.querySelectorAll<HTMLElement>(".praxity-block");
		for (const [index, block] of blocks.entries()) {
			block.dataset.entrance = "pending";
			block.style.setProperty("--praxity-stagger-index", String(Math.min(index, 5)));
		}

		for (const item of root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
			item.dataset.entrance = stagger === "sequential" ? "pending" : "visible";
		}
		if (stagger === "sequential") {
			for (const parent of root.querySelectorAll<HTMLElement>(
				".praxity-block-sequence, .praxity-block-card, .praxity-block-stats",
			)) {
				for (const [index, item] of parent.querySelectorAll<HTMLElement>(ITEM_SELECTOR).entries()) {
					item.style.setProperty("--praxity-stagger-index", String(Math.min(index, 5)));
				}
			}
		}

		observer = new Observer(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const block = entry.target as HTMLElement;
					block.dataset.entrance = "visible";
					for (const item of block.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
						item.dataset.entrance = "visible";
					}
					observer?.unobserve(block);
				}
			},
			{ threshold: 0.1 },
		);
		for (const block of blocks) observer.observe(block);
	} catch {
		observer?.disconnect();
		showAll();
	}

	return () => {
		observer?.disconnect();
		showAll();
	};
}

export function installEntranceMotionGlobal(target: Window = window): void {
	(target as MotionWindow)[ENTRANCE_MOTION_GLOBAL] = initializeEntranceMotion;
}
