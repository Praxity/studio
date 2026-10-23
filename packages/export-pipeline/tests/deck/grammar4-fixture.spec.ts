import { expect, test } from "@playwright/test";
import { cutoverCoverageHtml } from "../fixtures/cutover-coverage";

test("converted card and question content reaches published rendering", async ({ page }) => {
	await page.setContent(cutoverCoverageHtml());
	await expect(
		page.getByRole("tablist", { name: "Tabbed content sections" }).getByRole("tab"),
	).toHaveCount(2);
	await expect(page.locator("body")).toContainText("Which action helps?");
	await expect(page.locator("body")).toContainText("Read the explanation.");
	await expect(page.locator("body")).toContainText("Respect builds trust.");
});
