import { resolveLocale } from "./locale";

export const nextPageUnavailable = {
	en: "The next page is unavailable.",
	fr: "La page suivante est indisponible.",
};

/** The logic island needs this fallback without downloading the full catalog. */
export function getNextPageUnavailable(locale: string): string {
	return nextPageUnavailable[resolveLocale(locale)];
}
