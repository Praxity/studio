/** Simple template string interpolation: replaces {key} with values. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
	let result = template;
	for (const [key, val] of Object.entries(vars)) {
		result = result.replaceAll(`{${key}}`, String(val));
	}
	return result;
}
