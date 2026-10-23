import type { ReactNode } from "react";

// Tabler outline paths, MIT. Export's third-party notice owner includes @tabler/icons.
const paths = {
	notebook: [
		"M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-11a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1m3 0v18",
		"M13 8l2 0",
		"M13 12l2 0",
	],
	"clipboard-check": [
		"M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2",
		"M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2",
		"M9 14l2 2l4 -4",
	],
} as const;
export type SceneIcon = keyof typeof paths;

export function SceneHeader({ icon, children }: { icon: SceneIcon; children: ReactNode }) {
	return (
		<div className="praxity-scene">
			<span className="praxity-scene-icon" aria-hidden="true">
				<svg
					className="icon-tabler"
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
					focusable="false"
				>
					{paths[icon].map((d) => (
						<path key={d} d={d} />
					))}
				</svg>
			</span>
			<div className="praxity-scene-title">{children}</div>
		</div>
	);
}

/** Title HTML and attributes are admitted by the renderer; preserves its existing element. */
export function renderSceneHeader({
	icon,
	headingLevel,
	titleHtml,
	headingAttributes,
	bodyHtml = "",
}: {
	icon: SceneIcon;
	headingLevel: 1 | 2 | 3 | 4 | 5 | 6 | "p";
	titleHtml: string;
	headingAttributes: string;
	bodyHtml?: string;
}): string {
	const tag = headingLevel === "p" ? "p" : `h${headingLevel}`;
	const svg = `<svg class="icon-tabler" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[icon].map((d) => `<path d="${d}"/>`).join("")}</svg>`;
	return `<div class="praxity-scene"><span class="praxity-scene-icon" aria-hidden="true">${svg}</span><div class="praxity-scene-title"><div class="praxity-assessment-question-header"><${tag}${headingAttributes}>${titleHtml}</${tag}>${bodyHtml}</div></div></div>`;
}
