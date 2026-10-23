import { expect, it } from "vitest";
import { gateSatisfied } from "../template/src/islands/island-deck";

it.each([
	["attempt", false, false, true, true],
	["pass", false, false, true, false],
	["pass", false, true, true, true],
	["pass", false, true, false, true],
	["pass", true, false, false, true],
] as const)(
	"gate %s correct=%s exhausted=%s unknown=%s releases=%s",
	(rule, correct, exhausted, unknown, released) => {
		expect(gateSatisfied(rule, correct, exhausted)).toBe(released);
	},
);
