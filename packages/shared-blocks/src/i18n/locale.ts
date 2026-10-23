export const supportedLocales = ["en", "fr"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

/** Resolve regional variants and unsupported locales consistently across catalogs. */
export function resolveLocale(locale: string): SupportedLocale {
	return locale.split("-")[0].toLowerCase() === "fr" ? "fr" : "en";
}
