import { expect, it } from "vitest";
import { formatSelfCheckCounts } from "./self-check-island-strings";

it.each([
	["en", 0, 1, "0 of 1 selected", "You included 0 of 1 part."],
	["en", 1, 1, "1 of 1 selected", "You included 1 of 1 part."],
	["en", 2, 1000, "2 of 1,000 selected", "You included 2 of 1,000 parts."],
	["en", 1000, 1000, "1,000 of 1,000 selected", "You included 1,000 of 1,000 parts."],
	["fr", 0, 1, "0 sur 1 sélectionné", "Éléments inclus : 0 sur 1."],
	["fr", 1, 1, "1 sur 1 sélectionné", "Éléments inclus : 1 sur 1."],
	["fr", 2, 1000, "2 sur 1 000 sélectionnés", "Éléments inclus : 2 sur 1 000."],
	["fr", 1000, 1000, "1 000 sur 1 000 sélectionnés", "Éléments inclus : 1 000 sur 1 000."],
] as const)("formats %s count %s of %s", (locale, count, total, selected, summary) => {
	expect(formatSelfCheckCounts(locale, count, total)).toEqual({ selected, summary });
});
