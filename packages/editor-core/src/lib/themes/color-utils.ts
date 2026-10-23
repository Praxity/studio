/**
 * Check if a string is a valid CSS hex color (#RGB, #RGBA, #RRGGBB, #RRGGBBAA).
 */
export function isValidHex(value: string): boolean {
	if (!value.startsWith("#")) return false;
	const cleaned = value.slice(1);
	return /^[0-9a-fA-F]{3,4}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(cleaned);
}

/**
 * Normalize a hex color to canonical lowercase 6-digit form (#rrggbb).
 * Accepts #RGB (expands) and #RRGGBB. Rejects alpha forms and invalid input.
 */
export function normalizeHex(hex: string): string | null {
	const value = hex.trim();
	const short = /^#([0-9a-fA-F]{3})$/.exec(value);
	if (short) {
		return `#${short[1]
			.split("")
			.map((digit) => digit + digit)
			.join("")
			.toLowerCase()}`;
	}

	const long = /^#([0-9a-fA-F]{6})$/.exec(value);
	if (!long) return null;
	return `#${long[1].toLowerCase()}`;
}
