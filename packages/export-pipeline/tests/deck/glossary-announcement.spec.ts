import { expect, test } from "../fixtures/published-navigation";

test("definition uses its accessible description without a live announcement", async ({
	page,
	publishedNavigation,
}) => {
	await page.goto(`${publishedNavigation}/deck-en/index.html`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const term = page.locator(".inline-tooltip-trigger").first();
	await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
	const region = page.locator("#praxity-live-region");
	await region.evaluate((element) => {
		element.textContent = "Existing status";
	});
	await term.focus();
	await page.keyboard.press("Enter");
	await expect(term).toHaveAccessibleDescription("Help when you need it.");
	await expect(term).toBeFocused();
	await expect(region).toHaveText("Existing status");
	await page.keyboard.press("Escape");
	await expect(region).toHaveText("Existing status");
});
