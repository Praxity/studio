import { resolveLocale } from "./locale";

export const nextPageUnavailable = {
	en: "The next page is unavailable.",
	fr: "La page suivante est indisponible.",
};

export function getNextPageUnavailable(locale: string): string {
	return nextPageUnavailable[resolveLocale(locale)];
}
