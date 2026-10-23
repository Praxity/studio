"use client";

import type { DesignVariants } from "@praxity/grammar";
import { parseFrontmatter } from "@praxity/grammar";
import {
	type DesignNumberDiagnostic,
	normalizeDesignVariants,
} from "../lib/themes/normalize-design-variants";

function sortObjectKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => sortObjectKeysDeep(item));
	}
	if (value && typeof value === "object") {
		const sortedEntries = Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, nested]) => [key, sortObjectKeysDeep(nested)] as const);
		return Object.fromEntries(sortedEntries);
	}
	return value;
}

export { normalizeDesignVariants };

export function getNormalizedDesignVariantsFromSource(source: string): DesignVariants {
	if (!source) return normalizeDesignVariants(undefined);
	const { frontmatter } = parseFrontmatter(source);
	return normalizeDesignVariants(frontmatter.design);
}

export function toStableDesignJson(
	variants: DesignVariants,
	diagnostics: readonly DesignNumberDiagnostic[] = [],
): string {
	// Raw rejected values may contain YAML alias cycles. Only recovery state belongs in this key.
	return JSON.stringify([
		sortObjectKeysDeep(variants),
		diagnostics.map(({ key, value, reason }) => [key, value, reason]),
	]);
}
