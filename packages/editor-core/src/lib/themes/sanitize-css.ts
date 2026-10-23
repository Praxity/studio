const DANGEROUS_PATTERNS = [
	/<script[\s>]/gi,
	/<\/script>/gi,
	/expression\s*\(/gi,
	/url\s*\(\s*["']?\s*javascript:/gi,
	/@import\s/gi,
	/-moz-binding/gi,
	/behavior\s*:/gi,
];

export function sanitizeCss(css: string): string {
	if (!css) return "";
	let result = css;
	for (const pattern of DANGEROUS_PATTERNS) {
		result = result.replace(pattern, "/* removed */");
	}
	return result;
}
