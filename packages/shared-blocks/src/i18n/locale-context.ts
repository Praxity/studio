"use client";

import { createContext, useContext } from "react";

export const LocaleContext = createContext<string>("en");

export function useLocale(): string {
	return useContext(LocaleContext);
}
