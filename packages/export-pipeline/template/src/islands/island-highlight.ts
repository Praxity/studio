import { enhanceHighlight } from "../../../src/patterns/highlight/enhance";
import { restoreHighlightBaseline } from "../../../src/patterns/highlight/recovery";

/** Own atomic attach and rollback; bootstrap only reports the local failure. */
export function attachIsland(): () => void {
	const instances: ReturnType<typeof enhanceHighlight>[] = [];
	const roots = [
		...document.querySelectorAll<HTMLElement>('[data-island="highlight"] [data-highlight]'),
	];
	try {
		for (const root of roots) instances.push(enhanceHighlight(root));
	} catch (error) {
		const active = document.activeElement;
		const focus = roots.map((root) => (root.contains(active) ? active : null));
		for (const instance of instances) instance.destroy();
		roots.forEach((root, index) => {
			if (!root.hasAttribute("data-highlight-enhanced"))
				restoreHighlightBaseline(root, focus[index]);
		});
		throw error;
	}
	return () => {
		for (const instance of instances) instance.destroy();
	};
}

declare global {
	interface Window {
		PraxityHighlightIsland?: { attachIsland: typeof attachIsland };
	}
}
