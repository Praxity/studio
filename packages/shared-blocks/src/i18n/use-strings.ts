"use client";

import { useMemo } from "react";
import { getStrings } from "./strings.ts";

export function useStrings(locale: string) {
	return useMemo(() => getStrings(locale), [locale]);
}
