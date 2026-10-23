import { describe, expect, it } from "vitest";
import { isValidHex, normalizeHex } from "../color-utils";

describe("normalizeHex", () => {
	it("passes through 6-digit hex lowercase", () => {
		expect(normalizeHex("#aabbcc")).toBe("#aabbcc");
	});

	it("lowercases 6-digit hex", () => {
		expect(normalizeHex("#AABBCC")).toBe("#aabbcc");
	});

	it("expands 3-digit shorthand", () => {
		expect(normalizeHex("#abc")).toBe("#aabbcc");
	});

	it("expands and lowercases 3-digit shorthand", () => {
		expect(normalizeHex("#ABC")).toBe("#aabbcc");
	});

	it("rejects 4-digit alpha shorthand", () => {
		expect(normalizeHex("#abcd")).toBeNull();
	});

	it("rejects 8-digit alpha hex", () => {
		expect(normalizeHex("#aabbccdd")).toBeNull();
	});

	it("rejects invalid hex", () => {
		expect(normalizeHex("not-a-color")).toBeNull();
		expect(normalizeHex("#xyz")).toBeNull();
		expect(normalizeHex("")).toBeNull();
	});

	it("trims whitespace", () => {
		expect(normalizeHex("  #aabbcc  ")).toBe("#aabbcc");
	});
});

describe("isValidHex", () => {
	it("existing behavior unchanged", () => {
		expect(isValidHex("#abc")).toBe(true);
		expect(isValidHex("#abcd")).toBe(true);
		expect(isValidHex("#aabbcc")).toBe(true);
		expect(isValidHex("#aabbccdd")).toBe(true);
		expect(isValidHex("abc")).toBe(false);
	});
});
