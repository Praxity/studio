import { expect, test } from "@playwright/test";
import { assertAxeScenario, readFullFixtureVariantUrl, waitForHydration } from "./helpers";

const FULL_FIXTURE_VARIANTS = ["theme-light", "theme-dark", "nav-sidebar", "nav-minimal"];

test.describe("full fixture a11y matrix", () => {
	for (const variant of FULL_FIXTURE_VARIANTS) {
		test(`full fixture ${variant}: axe + landmarks`, async ({ page }) => {
			const baseUrl = readFullFixtureVariantUrl(variant);
			expect(baseUrl, `Missing full fixture variant '${variant}'`).toBeTruthy();
			if (!baseUrl) {
				return;
			}

			await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);

			await assertAxeScenario(page, `full-${variant}::page-2`);
			await expect(page.locator('[role="main"], main')).toHaveCount(1);

			const skipToMain = page.locator('a[href="#main-content"], a[href="#main-content"]').first();
			await expect(skipToMain).toBeAttached();
		});
	}
});
