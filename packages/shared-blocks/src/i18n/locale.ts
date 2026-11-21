export const supportedLocales = ["en", "fr"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export function resolveLocale(locale: string): SupportedLocale {
	return locale.split("-")[0].toLowerCase() === "fr" ? "fr" : "en";
}
