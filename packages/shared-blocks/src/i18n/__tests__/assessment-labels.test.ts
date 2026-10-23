import { expect, it } from "vitest";
import { assessmentAttemptsLabel, assessmentPointsLabel } from "../assessment-labels";

it.each([
	["en", 1, 1284, "1 of 1,284 attempts used"],
	["fr", 1, 1284, "Tentatives utilisées\u00a0: 1 sur 1\u202f284"],
	["fr-CA", 1234, 1284, "Tentatives utilisées\u00a0: 1\u00a0234 sur 1\u00a0284"],
])("formats %s attempts %s of %s", (locale, used, total, expected) => {
	expect(assessmentAttemptsLabel(used, total, locale)).toBe(expected);
});

it.each([
	["en", 1000000, "1,000,000 points"],
	["fr", 1000000, "1\u202f000\u202f000 points"],
	["en", 1, "1 point"],
	["fr", 1, "1 point"],
	["en", 0, "0 points"],
	["en", 0.0001, "0.0001 points"],
	["en", 0.0000001, "0.0000001 points"],
	["en", 0.1 + 0.2, "0.3 points"],
	["en", 1.0001, "1.0001 points"],
	["en", 1234.0001, "1,234.0001 points"],
	["fr", 0.0001, "0,0001 points"],
	["fr", 0.0000001, "0,0000001 points"],
	["fr", 0.1 + 0.2, "0,3 points"],
	["fr", 1.0001, "1,0001 points"],
	["fr", 1234.0001, "1\u202f234,0001 points"],
	["fr-CA", 1000000, "1\u00a0000\u00a0000 points"],
] as const)("formats %s point count %s", (locale, points, expected) => {
	expect(assessmentPointsLabel(points, locale)).toBe(expected);
});
