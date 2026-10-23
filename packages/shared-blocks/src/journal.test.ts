import { describe, expect, it } from "vitest";
import { isJournal, journalSavedDate, readJournalSavedAt } from "./journal";

describe("journal classification", () => {
	const journal = {
		assessmentType: "textResponse",
		gradingMode: "none",
		private: true,
		response: { type: "textResponse", inputType: "long" },
	} as const;
	it("recognizes only private, ungraded, long free responses", () => {
		expect(isJournal(journal)).toBe(true);
		for (const change of [
			{ private: false },
			{ gradingMode: "exact" },
			{ assessmentType: "choice" },
			{ response: { type: "textResponse", inputType: "short" } },
			{ response: { type: "choice" } },
			{ response: undefined },
		])
			expect(isJournal({ ...journal, ...change })).toBe(false);
		expect(isJournal({ ...journal, gradingMode: undefined, graded: true })).toBe(false);
		expect(isJournal({ ...journal, gradingMode: undefined, graded: false })).toBe(true);
	});
});

describe("saved journal dates", () => {
	it.each([
		undefined,
		null,
		123,
		"",
		"yesterday",
		"2026-10-08",
		"2026-02-30T14:05:00.000Z",
		"2026-10-08T25:05:00.000Z",
	])("ignores invalid savedAt %s", (value) => {
		expect(readJournalSavedAt(value)).toBeNull();
		expect(journalSavedDate(value, "en-GB")).toBe("");
	});
	it("keeps a valid timestamp and formats it in the course language", () => {
		const savedAt = "2026-10-08T14:05:00.000Z";
		expect(readJournalSavedAt(savedAt)).toBe(savedAt);
		expect(journalSavedDate(savedAt, "en-GB", "UTC")).toBe("Saved 8 October 2026 at 14:05");
		expect(journalSavedDate(savedAt, "fr-CA", "UTC")).toBe(
			"Enregistré le 8 octobre 2026 à 14 h 05",
		);
	});
});
