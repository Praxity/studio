import { beforeAll, describe, expect, test } from "vitest";
import { type BuildResult, getBuild, stylesheetEntry } from "./setup";

let build: BuildResult;

beforeAll(async () => {
	build = await getBuild();
}, 120_000);

describe("Typography and theme", () => {
	test("font preload links are present", () => {
		const firstPage = build.pages[0];
		const preloads = firstPage.document.querySelectorAll('link[rel="preload"][as="font"]');
		expect(preloads.length, "no font preload links").toBeGreaterThan(0);
	});

	test("color mode attribute is set on html", () => {
		let checkedPages = 0;
		for (const page of build.pages) {
			if (!page.document.documentElement.hasAttribute("data-praxity-root")) {
				continue;
			}
			const mode = page.document.documentElement.getAttribute("data-praxity-mode");
			expect(mode, `${page.entryName} missing data-praxity-mode`).toBeTruthy();
			expect(["light", "dark"]).toContain(mode);
			checkedPages += 1;
		}
		expect(checkedPages).toBeGreaterThan(0);
	});

	test("highlight style attribute is set on html", () => {
		let checkedPages = 0;
		for (const page of build.pages) {
			if (!page.document.documentElement.hasAttribute("data-praxity-root")) {
				continue;
			}
			const style = page.document.documentElement.getAttribute("data-praxity-highlight-style");
			expect(style, `${page.entryName} missing highlight style`).toBeTruthy();
			checkedPages += 1;
		}
		expect(checkedPages).toBeGreaterThan(0);
	});

	test("theme CSS variables are emitted in the shared stylesheet", () => {
		const css = build.zip.readAsText(stylesheetEntry(build.zip));
		expect(css, "no --praxity- CSS variables in styles.css").toContain("--praxity-");
	});
});
