"use client";

import type { FontDisplay, FontFaceRequest } from "@praxity/grammar";

export function loadFont(request: FontFaceRequest, display: FontDisplay): void {
	if (typeof document === "undefined") return;
	const { entry, styles, weights } = request;
	if (!entry.fontsource) return;
	const id = `praxity-font-${entry.label.replace(/\s+/g, "-").toLowerCase()}-${weights.join("-")}-${styles.join("-")}-${display}`;
	if (document.getElementById(id)) return;
	const variants = styles.flatMap((style) =>
		weights.map((weight) => `${style === "italic" ? 1 : 0},${weight}`),
	);
	const link = document.createElement("link");
	link.id = id;
	link.rel = "stylesheet";
	link.href = `https://api.fonts.coollabs.io/css2?family=${encodeURIComponent(entry.label)}:ital,wght@${variants.join(";")}&display=${display}`;
	document.head.appendChild(link);
}
