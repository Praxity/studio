import { initDomLogicRuntime } from "@praxity/shared-blocks/logic";
import { shouldAttachIslandAutomatically } from "@praxity/shared-blocks/self-check-consumers";

export function attachIsland() {
	const raw = document.getElementById("praxity-config")?.textContent;
	if (raw) {
		try {
			initDomLogicRuntime(JSON.parse(raw));
		} catch {}
	}
}
declare global {
	interface Window {
		PraxityLogicIsland?: { attachIsland: typeof attachIsland };
	}
}
window.PraxityLogicIsland = { attachIsland };
if (shouldAttachIslandAutomatically()) attachIsland();
