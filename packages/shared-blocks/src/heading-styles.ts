import type { CSSProperties } from "react";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export function normalizeHeadingLevel(value: unknown, fallback: HeadingLevel = 2): HeadingLevel {
	const level = Number(value);
	return Number.isFinite(level)
		? (Math.min(6, Math.max(1, Math.trunc(level))) as HeadingLevel)
		: fallback;
}

export function publishedHeadingFontSize(level: HeadingLevel): string {
	return `var(--praxity-type-h${level})`;
}

export function unwrapHeadingParagraph(html: string): string {
	const trimmed = html.trim();
	const match = trimmed.match(/^<p>([\s\S]*)<\/p>$/i);
	return match ? match[1] : trimmed;
}

/** Change display case without changing markup or the stored authored value. */
export function sentenceCaseKicker(html: string): string {
	let first = true;
	return html.replace(/(^|>)([^<]+)/g, (_match, boundary: string, text: string) => {
		let value = text.toLowerCase();
		if (first && /\p{L}/u.test(value)) {
			value = value.replace(/\p{L}/u, (letter) => letter.toUpperCase());
			first = false;
		}
		return boundary + value;
	});
}

/**
 * Canonical heading styles for editor canvas and published output.
 * Single source of truth — imported by both heading-block-editor.tsx and HeadingBlock.tsx.
 */
export const HEADING_STYLES: Record<number, CSSProperties> = {
	1: {
		fontSize: publishedHeadingFontSize(1),
		fontFamily: "var(--praxity-font-family-h1, var(--praxity-font-heading))",
		fontWeight: "var(--praxity-font-weight-h1, var(--praxity-font-weight-heading))",
		fontStyle: "var(--praxity-font-style-h1, var(--praxity-font-style-heading))",
		lineHeight: "var(--leading-heading)",
	},
	2: {
		fontSize: publishedHeadingFontSize(2),
		fontFamily: "var(--praxity-font-family-h2, var(--praxity-font-heading))",
		fontWeight: "var(--praxity-font-weight-h2, var(--praxity-font-weight-heading))",
		fontStyle: "var(--praxity-font-style-h2, var(--praxity-font-style-heading))",
		lineHeight: "var(--leading-heading)",
	},
	3: {
		fontSize: publishedHeadingFontSize(3),
		fontFamily: "var(--praxity-font-family-h3, var(--praxity-font-heading))",
		fontWeight: "var(--praxity-font-weight-h3, var(--praxity-font-weight-heading))",
		fontStyle: "var(--praxity-font-style-h3, var(--praxity-font-style-heading))",
		lineHeight: "var(--leading-heading)",
	},
	4: {
		fontSize: publishedHeadingFontSize(4),
		fontFamily: "var(--praxity-font-family-h4, var(--praxity-font-heading))",
		fontWeight: "var(--praxity-font-weight-h4, var(--praxity-font-weight-heading))",
		fontStyle: "var(--praxity-font-style-h4, var(--praxity-font-style-heading))",
		lineHeight: "var(--leading-heading)",
	},
	5: {
		fontSize: publishedHeadingFontSize(5),
		fontFamily: "var(--praxity-font-family-h5, var(--praxity-font-heading))",
		fontWeight: "var(--praxity-font-weight-h5, var(--praxity-font-weight-heading))",
		fontStyle: "var(--praxity-font-style-h5, var(--praxity-font-style-heading))",
		lineHeight: "var(--leading-heading)",
	},
	6: {
		fontSize: publishedHeadingFontSize(6),
		fontFamily: "var(--praxity-font-family-h6, var(--praxity-font-heading))",
		fontWeight: "var(--praxity-font-weight-h6, var(--praxity-font-weight-heading))",
		fontStyle: "var(--praxity-font-style-h6, var(--praxity-font-style-heading))",
		lineHeight: "var(--leading-heading)",
	},
};

/** Published output variant adds margin/padding resets */
export const HEADING_STYLES_PUBLISHED: Record<number, CSSProperties> = Object.fromEntries(
	Object.entries(HEADING_STYLES).map(([level, style]) => [
		level,
		{ ...style, margin: 0, padding: 0 },
	]),
);
