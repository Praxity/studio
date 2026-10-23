import { describe, expect, it } from "vitest";
import { isSafeEmbedUrl } from "../src/utils.ts";

describe("isSafeEmbedUrl", () => {
	it("accepts https URLs from third-party origins", () => {
		expect(isSafeEmbedUrl("https://example.com/embed/123")).toBe(true);
	});

	it("rejects non-https URLs", () => {
		expect(isSafeEmbedUrl("http://example.com/embed/123")).toBe(false);
	});

	it("rejects Praxity same-origin URLs", () => {
		expect(isSafeEmbedUrl("https://praxity.io/page")).toBe(false);
		expect(isSafeEmbedUrl("https://www.praxity.io/page")).toBe(false);
		expect(isSafeEmbedUrl("https://app.praxity.io/page")).toBe(false);
		expect(isSafeEmbedUrl("https://sub.app.praxity.io/page")).toBe(false);
		expect(isSafeEmbedUrl("https://praxity.io./page")).toBe(false);
	});

	it("rejects malformed values", () => {
		expect(isSafeEmbedUrl("")).toBe(false);
		expect(isSafeEmbedUrl("not a url")).toBe(false);
		expect(isSafeEmbedUrl("javascript:alert(1)")).toBe(false);
	});
});
