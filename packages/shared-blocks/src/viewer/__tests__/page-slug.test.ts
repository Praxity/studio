import { describe, expect, it } from "vitest";
import { buildSlugMap, pageSlug } from "../page-slug";

describe("pageSlug", () => {
	it("slugifies a normal title", () => {
		expect(pageSlug("Introduction", 0)).toBe("introduction");
	});

	it("handles special characters and diacritics", () => {
		expect(pageSlug("Café & Résumé", 0)).toBe("cafe-and-resume");
	});

	it("decodes entities before slugifying", () => {
		expect(pageSlug("R&amp;D &#39;Basics&#39;", 0)).toBe("r-and-d-basics");
	});

	it("falls back to page-N for empty title", () => {
		expect(pageSlug("", 0)).toBe("page-1");
		expect(pageSlug("", 4)).toBe("page-5");
	});

	it("falls back to page-N for whitespace-only title", () => {
		expect(pageSlug("   ", 0)).toBe("page-1");
	});

	it("truncates long titles", () => {
		const long = "a".repeat(100);
		expect(pageSlug(long, 0).length).toBeLessThanOrEqual(64);
	});
});

describe("buildSlugMap", () => {
	it("builds slug map from pages", () => {
		const pages = [
			{ id: "p1", title: "Introduction", blocks: [] },
			{ id: "p2", title: "Key Concepts", blocks: [] },
		];
		const map = buildSlugMap(pages);
		expect(map.get("p1")).toBe("introduction");
		expect(map.get("p2")).toBe("key-concepts");
	});

	it("handles collisions by appending -2, -3", () => {
		const pages = [
			{ id: "p1", title: "Key Concepts", blocks: [] },
			{ id: "p2", title: "Key Concepts", blocks: [] },
			{ id: "p3", title: "Key Concepts", blocks: [] },
		];
		const map = buildSlugMap(pages);
		expect(map.get("p1")).toBe("key-concepts");
		expect(map.get("p2")).toBe("key-concepts-2");
		expect(map.get("p3")).toBe("key-concepts-3");
	});

	it("reserves 'index' slug", () => {
		const pages = [{ id: "p1", title: "Index", blocks: [] }];
		const map = buildSlugMap(pages);
		expect(map.get("p1")).toBe("index-2");
	});

	it("avoids collision between suffixed and natural slugs", () => {
		const pages = [
			{ id: "p1", title: "Key Concepts", blocks: [] },
			{ id: "p2", title: "Key Concepts", blocks: [] },
			{ id: "p3", title: "Key Concepts 2", blocks: [] },
		];
		const map = buildSlugMap(pages);
		expect(map.get("p1")).toBe("key-concepts");
		expect(map.get("p2")).toBe("key-concepts-2");
		// "key-concepts-2" is taken, so this gets -2 suffix on its own slug
		expect(map.get("p3")).toBe("key-concepts-2-2");
	});

	it("handles empty titles with fallback", () => {
		const pages = [
			{ id: "p1", title: "Introduction", blocks: [] },
			{ id: "p2", title: "", blocks: [] },
		];
		const map = buildSlugMap(pages);
		expect(map.get("p1")).toBe("introduction");
		expect(map.get("p2")).toBe("page-2");
	});
});
