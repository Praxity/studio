import type { PraxityBlock } from "./types";

export function readAltText(data: { altText?: unknown; alt?: unknown } | undefined): string {
	const altText = data?.altText ?? data?.alt;
	return typeof altText === "string" ? altText : "";
}

export function isDecorativeImage(
	data: { decorative?: unknown } | undefined,
	a11y?: PraxityBlock["a11y"],
): boolean {
	return data?.decorative === true || a11y?.decorative === true;
}
