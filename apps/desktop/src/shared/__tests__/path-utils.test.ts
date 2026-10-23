import { describe, expect, it } from "vitest";
import { getFileExtension } from "../path-utils";

describe("getFileExtension", () => {
	it.each([
		["lesson.PRAX", "prax"],
		["archive.tar.GZ", "gz"],
		[".gitignore", "gitignore"],
		["README", ""],
		["lesson.", ""],
		["", ""],
	])("returns the filename extension for %s", (filename, extension) => {
		expect(getFileExtension(filename)).toBe(extension);
	});
});
