import { expect, test } from "../fixtures/published-navigation";

for (const locale of ["en", "fr"]) {
	test(`definition ${locale} glossary opens a named new tab`, async ({
		page,
		publishedNavigation,
	}) => {
		await page.goto(`${publishedNavigation}/deck-${locale}/index.html`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const term = page.locator(".inline-tooltip-trigger").first();
		await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
		await term.focus();
		await page.keyboard.press("Enter");
		const link = page.locator(".inline-tooltip-popover .praxity-glossary-link");
		await expect(link).toHaveAttribute("target", "_blank");
		await expect(link).toHaveAttribute("rel", "noopener");
		await expect(link).toHaveAccessibleName(
			locale === "fr"
				? "Glossaire complet , (s’ouvre dans un nouvel onglet)"
				: "Full glossary , (opens in a new tab)",
		);
		const popup = page.waitForEvent("popup");
		await link.click();
		const glossary = await popup;
		await expect(glossary).toHaveURL(/glossary\.html$/);
		await expect(page.getByRole("heading", { name: "First slide", exact: true })).toBeVisible();
		await glossary.close();
	});
}
