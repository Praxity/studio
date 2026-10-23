import { describe, expect, it } from "vitest";
import { normalizeExpiryDays, validRelativePath } from "../src/protocol";

describe("review share protocol", () => {
	it.each([
		[undefined, 14],
		[Number.NaN, 14],
		[Number.POSITIVE_INFINITY, 14],
		[Number.NEGATIVE_INFINITY, 14],
		[-1, 1],
		[0, 1],
		[0.9, 1],
		[1, 1],
		[14.9, 14],
		[60, 60],
		[60.9, 60],
		[90, 60],
	])("normalizes expiry %s to %i days", (value, expected) => {
		expect(normalizeExpiryDays(value)).toBe(expected);
	});

	it.each([
		["index.html", true],
		["assets/app.js", true],
		["assets/a..b.js", true],
		["assets/course name.js", true],
		["", false],
		["/index.html", false],
		["../secret", false],
		["assets/../secret", false],
		["./index.html", false],
		["assets/./app.js", false],
		["assets//app.js", false],
		["assets/", false],
		["assets\\app.js", false],
		["assets/\0app.js", false],
	])("validates relative path %j as %s", (path, expected) => {
		expect(validRelativePath(path)).toBe(expected);
	});
});
