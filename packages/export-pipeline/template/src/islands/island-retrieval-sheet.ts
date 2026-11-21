import { enhanceRetrievalSheet } from "../../../src/patterns/retrieval-sheet/enhance";

export function attachIsland(): () => void {
	const mounted = [...document.querySelectorAll<HTMLElement>("[data-retrieval-sheet]")].map(
		enhanceRetrievalSheet,
	);
	return () => {
		for (const instance of mounted) instance.destroy();
	};
}

attachIsland();
