import { expect, test } from "@playwright/test";
import { DESIGN_SEPARATOR_STYLES } from "./fixtures/design-separators-fixture";
import { readTestEnv } from "./helpers";

for (const mode of ["small", "full"]) {
	for (const style of DESIGN_SEPARATOR_STYLES) {
		test(`${mode} preview keeps H2 sections plain with retired separator ${style}`, async ({
			page,
		}) => {
			await page.goto(
				`${readTestEnv().url}/design-separator-${style}/separator-audit.html${mode === "small" ? "?minimal=1&praxity-small-preview=1" : ""}`,
			);
			await expect(page.locator(".praxity-section-divider")).toHaveCount(0);
			await expect(
				page.getByRole("heading", { name: "Second section", exact: true }),
			).toBeVisible();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
			).toBeLessThanOrEqual(1);
		});
	}
}
