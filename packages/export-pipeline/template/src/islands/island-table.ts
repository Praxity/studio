import { shouldAttachIslandAutomatically } from "@praxity/shared-blocks/self-check-consumers";
import { enhanceTableSizing } from "@praxity/shared-blocks/table-sizing";

export function initTableEnhancements(scope: ParentNode = document): () => void {
	const cleanups = Array.from(
		scope.querySelectorAll<HTMLTableElement>('[data-island="table"] .praxity-data-table'),
		enhanceTableSizing,
	);
	return () => cleanups.forEach((cleanup) => cleanup());
}

export { initTableEnhancements as attachIsland };

if (shouldAttachIslandAutomatically()) initTableEnhancements();
