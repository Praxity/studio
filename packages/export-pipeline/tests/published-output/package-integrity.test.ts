import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getBuild } from "./setup";

const FIXTURE_ROOT = resolve(import.meta.dirname, "../../../../docs/test-fixtures");

describe("published fixture package integrity", () => {
	it("contains every referenced local file and no host filesystem URLs", async () => {
		const { pages, zip } = await getBuild();
		const entries = new Set(zip.getEntries().map((entry) => entry.entryName));

		for (const page of pages) {
			const html = zip.readAsText(page.entryName);
			expect(html).not.toContain(FIXTURE_ROOT);
			expect(html).not.toMatch(/file:\/{2,3}/);

			for (const element of page.document.querySelectorAll("[src], [href], [poster]")) {
				for (const attribute of ["src", "href", "poster"] as const) {
					const value = element.getAttribute(attribute)?.trim();
					if (!value || value.startsWith("#")) continue;
					const url = new URL(value, `https://praxity.test/${page.entryName}`);
					if (url.origin !== "https://praxity.test") continue;
					const entry = decodeURIComponent(url.pathname).replace(/^\//, "") || "index.html";
					expect(entries.has(entry), `${page.entryName} references missing ${entry}`).toBe(true);
				}
			}
		}

		let localCssReferences = 0;
		for (const stylesheet of zip.getEntries().filter((entry) => entry.entryName.endsWith(".css"))) {
			const css = stylesheet.getData().toString("utf-8");
			expect(css).not.toContain(FIXTURE_ROOT);
			expect(css).not.toMatch(/file:\/{2,3}/);
			for (const match of css.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/g)) {
				const value = match[1] ?? match[2] ?? match[3];
				if (value.startsWith("#")) continue;
				const url = new URL(value, `https://praxity.test/${stylesheet.entryName}`);
				if (url.origin !== "https://praxity.test") continue;
				localCssReferences++;
				const entry = decodeURIComponent(url.pathname).replace(/^\//, "");
				expect(entries.has(entry), `${stylesheet.entryName} references missing ${entry}`).toBe(
					true,
				);
			}
		}
		expect(localCssReferences).toBeGreaterThan(0);
	});
});
