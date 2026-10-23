export const DEFAULT_EXPIRY_DAYS = 14;
export const DAY_MS = 24 * 60 * 60 * 1_000;

const MAX_EXPIRY_DAYS = 60;

export function normalizeExpiryDays(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DEFAULT_EXPIRY_DAYS;
	return Math.min(MAX_EXPIRY_DAYS, Math.max(1, Math.floor(value)));
}

export function validRelativePath(path: string): boolean {
	if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
		return false;
	}
	return path
		.split("/")
		.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
