declare module "katex/contrib/render-a11y-string" {
	/**
	 * Converts a LaTeX string to a human-readable speech string.
	 * e.g. "\\frac{1}{2}" → "start fraction, 1, divided by, 2, end fraction"
	 */
	export default function renderA11yString(
		text: string,
		settings?: { displayMode?: boolean },
	): string;
}
