"use client";

import { createContext, useContext } from "react";

/**
 * React context for the current learner-facing locale.
 * Set at the assessment island root; consumed by renderers via useLocale().
 * Falls back to "en" when no provider is present.
 */
export const LocaleContext = createContext<string>("en");

/** Read the current locale from context. */
export function useLocale(): string {
	return useContext(LocaleContext);
}
