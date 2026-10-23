import { expect, test } from "../fixtures/published-navigation";

for (const locale of ["en", "fr"]) {
	for (const mode of ["deck", "pages"]) {
		test(`${mode} ${locale} live region uses the document language`, async ({
			page,
			publishedNavigation,
		}) => {
			await page.goto(`${publishedNavigation}/${mode}-${locale}/index.html`);
			if (mode === "deck")
				await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(page.locator("html")).toHaveAttribute("lang", locale);
			await expect(page.locator("#praxity-live-region")).toHaveAttribute("lang", locale);
			const term = page.locator(".inline-tooltip-trigger").first();
			await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
			await term.focus();
			await page.keyboard.press("Enter");
			await expect(page.locator('.inline-tooltip-popover [id$="-definition"]')).toHaveAttribute(
				"lang",
				locale,
			);
		});
	}
}

test("a definition preserves an inline language outside its original container", async ({
	page,
	publishedNavigation,
}) => {
	await page.goto(`${publishedNavigation}/deck-en/index.html`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const term = page.locator(".inline-tooltip-trigger").first();
	await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
	await term.evaluate((element) => {
		element.setAttribute("lang", "fr");
		element.setAttribute("data-tooltip-content", "Une aide disponible.");
	});
	await term.focus();
	await page.keyboard.press("Enter");
	const definition = page.locator('.inline-tooltip-popover [id$="-definition"]');
	await expect(definition).toHaveText("Une aide disponible.");
	await expect(definition).toHaveAttribute("lang", "fr");
	const popover = page.locator(".inline-tooltip-popover");
	const action = popover.locator(".praxity-glossary-link");
	await expect(action).toHaveAccessibleName("Full glossary , (opens in a new tab)");
	expect(await popover.evaluate((element) => element.closest("[lang]")?.getAttribute("lang"))).toBe(
		"en",
	);
	expect(await action.evaluate((element) => element.closest("[lang]")?.getAttribute("lang"))).toBe(
		"en",
	);
});
