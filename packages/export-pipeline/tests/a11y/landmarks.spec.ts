import { expect, test } from "@playwright/test";
import { getCoursePages, readTestEnv, type TestEnv, waitForHydration } from "./helpers";

let env: TestEnv;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe("Semantic landmarks and heading structure", () => {
	test.beforeAll(() => {
		env = readTestEnv();
	});

	test("exported pages expose expected landmarks and heading hierarchy", async ({ page }) => {
		const pages = await getCoursePages(page, env.url);
		const pageTitleBySlug = new Map(pages.map((entry) => [entry.slug, entry.title]));

		for (const meta of pages) {
			await page.goto(`${env.url}/${meta.slug}.html`);
			await waitForHydration(page);

			await expect(page.locator('[role="main"], main')).toHaveCount(1);
			const unexpectedRegions = await page
				.getByRole("region")
				.evaluateAll((regions) =>
					regions
						.filter(
							(region) =>
								!region.matches(
									".praxity-table-scroll-region, pre.praxity-code-pre[tabindex='0'][aria-label], [aria-roledescription='carousel'], .praxity-narration-controls, .praxity-nav-band[aria-label], .praxity-pages-completion[aria-labelledby='praxity-completion-heading'], section[aria-label]:has(> .praxity-pages-progress)",
								) && !region.closest("[data-block-type='accordion']"),
						)
						.map((region) => region.outerHTML.slice(0, 240)),
				);
			expect(
				unexpectedRegions,
				`${meta.slug}.html should not turn ordinary content blocks into region landmarks`,
			).toEqual([]);
			for (const code of await page
				.locator("pre.praxity-code-pre:not(.praxity-code-pre--empty)")
				.all()) {
				await expect(code).toHaveRole("region");
				await expect(code).toHaveAccessibleName(/^Code \S/);
				await expect(code).toHaveAttribute("tabindex", "0");
			}
			for (const band of await page.locator(".praxity-nav-band").all()) {
				await expect(band).toHaveRole("region");
				await expect(band).toHaveAccessibleName(/course controls/i);
			}

			// A page may turn its chrome off — `nav: minimal` and `nav: none` are page-break
			// params, added after this spec was written, and the fixture uses `minimal` on
			// one page. Those layouts navigate by keyboard arrows, swipe and progress dots,
			// none of which is a landmark, so requiring one there asserted a bug that isn't.
			const layoutClass = await page.evaluate(() => document.body.className);
			const chromelessLayout = /praxity-layout-(minimal|none)\b/.test(layoutClass);
			const pageNavCount = await page.getByRole("navigation", { name: /^pages$/i }).count();
			if (!chromelessLayout) {
				expect(
					pageNavCount,
					`${meta.slug}.html should expose page navigation landmark`,
				).toBeGreaterThan(0);
			}

			const expectedTitle = pageTitleBySlug.get(meta.slug) ?? meta.title;
			await expect(page).toHaveTitle(new RegExp(escapeRegExp(expectedTitle), "i"));
			const headingTexts = await page.evaluate(() =>
				Array.from(
					document.querySelectorAll("main h1, main h2, main h3, main h4, main h5, main h6"),
				).map((heading) => (heading.textContent ?? "").trim()),
			);
			expect(
				headingTexts.length,
				`${meta.slug}.html should render at least one heading`,
			).toBeGreaterThan(0);
			await expect(page.locator("main h1")).toHaveCount(1);

			const headingLevels = await page.evaluate(() =>
				Array.from(
					document.querySelectorAll(
						"main h1, main h2, main h3, main h4, main h5, main h6, main [role='heading'][aria-level]",
					),
				).map((heading) =>
					heading.getAttribute("role") === "heading"
						? Number.parseInt(heading.getAttribute("aria-level") ?? "", 10)
						: Number.parseInt(heading.tagName.slice(1), 10),
				),
			);

			for (let i = 1; i < headingLevels.length; i++) {
				const previous = headingLevels[i - 1] ?? 1;
				const current = headingLevels[i] ?? 1;
				expect(
					current - previous,
					`Heading level jumps from h${previous} to h${current} on ${meta.slug}.html`,
				).toBeLessThanOrEqual(1);
			}
		}
	});

	test("compact query modes expose one page-navigation path", async ({ page }) => {
		const pages = await getCoursePages(page, env.url);
		const pageMeta = pages[1] ?? pages[0];
		expect(pageMeta, "fixture should expose a course page").toBeTruthy();
		if (!pageMeta) return;

		for (const query of ["minimal=1", "embed=1"]) {
			await test.step(query, async () => {
				await page.goto(`${env.url}/${pageMeta.slug}.html?${query}`);
				await waitForHydration(page);

				await expect(page.locator("body")).toHaveClass(/\bpraxity-minimal\b/);
				await expect(page.getByRole("navigation", { name: /^pages$/i })).toHaveCount(1);
				await expect(page.locator(".praxity-page-nav-skip")).toBeHidden();
				await expect(page.getByRole("link", { name: /skip to page navigation/i })).toHaveCount(1);
				await expect(page.locator(".praxity-page-nav-fallback")).toBeHidden();
				await expect(page.locator(".praxity-embed-nav")).toBeVisible();
			});
		}
	});
});
