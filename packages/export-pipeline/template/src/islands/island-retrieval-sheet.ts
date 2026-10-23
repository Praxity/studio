import { enhanceRetrievalSheet } from "../../../src/patterns/retrieval-sheet/enhance";

/** Repeated bootstrap attachment reuses each mount's memory and listeners. */
export function attachIsland(): () => void {
	const mounted = [...document.querySelectorAll<HTMLElement>("[data-retrieval-sheet]")].map(
		enhanceRetrievalSheet,
	);
	return () => {
		for (const instance of mounted) instance.destroy();
	};
}

// Memory-only controls do not join the learner-state provider's lifetime.
attachIsland();
