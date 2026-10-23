import { expect, test } from "@playwright/test";
import { cutoverCoverageHtml } from "../fixtures/cutover-coverage";

test("converted fixture retains named tabs and disclosure controls", async ({ page }) => {
	await page.setContent(cutoverCoverageHtml());
	await expect(
		page.getByRole("tablist", { name: "Tabbed content sections" }).getByRole("tab"),
	).toHaveCount(2);
	await expect(page.locator("[data-disclosure-trigger]")).toHaveCount(2);
	await expect(page.getByRole("table", { name: "Data table", exact: true })).toContainText(
		"Read pressure",
	);
});
