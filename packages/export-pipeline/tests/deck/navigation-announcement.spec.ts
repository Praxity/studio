import { expect, test } from "../fixtures/published-navigation";

for (const locale of ["en", "fr"]) {
	test(`heading-free deck ${locale} retains the title when navigation focuses main`, async ({
		page,
		publishedNavigation,
	}) => {
		await page.goto(`${publishedNavigation}/headless-${locale}/index.html`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await page.locator("#deck-next").click();
		await expect(page.locator("#main-content")).toBeFocused();
		await expect(page.locator("#deck-announcement")).toHaveText(
			locale === "fr" ? "Diapositive 2 sur 3: Second slide" : "Slide 2 of 3: Second slide",
		);
	});

	test(`deck ${locale} names the slide by position without live writes when navigation focuses content`, async ({
		page,
		publishedNavigation,
	}) => {
		await page.goto(`${publishedNavigation}/deck-${locale}/index.html`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const announcement = page.locator("#deck-announcement");
		await announcement.evaluate((element) => {
			(window as unknown as { arrivalWrites: string[] }).arrivalWrites = [];
			new MutationObserver(() => {
				(window as unknown as { arrivalWrites: string[] }).arrivalWrites.push(
					element.textContent ?? "",
				);
			}).observe(element, { childList: true, subtree: true, characterData: true });
		});
		await page.locator("#deck-next").click();
		await expect(page.getByRole("heading", { name: "Second slide", exact: true })).toBeFocused();
		await expect(page.locator("#page-2")).toHaveAccessibleName(
			locale === "fr" ? "Diapositive 2 sur 3" : "Slide 2 of 3",
		);
		await expect(
			page.getByRole("region", {
				name: locale === "fr" ? "Diapositive 2 sur 3" : "Slide 2 of 3",
				exact: true,
			}),
		).toBeVisible();
		await expect(announcement).toBeEmpty();
		await page.locator("#deck-previous").click();
		await expect(page.getByRole("heading", { name: "First slide", exact: true })).toBeFocused();
		await expect(page.locator("#page-1")).toHaveAccessibleName(
			locale === "fr" ? "Diapositive 1 sur 3" : "Slide 1 of 3",
		);
		await expect(announcement).toBeEmpty();
		expect(
			await page.evaluate(() => (window as unknown as { arrivalWrites: string[] }).arrivalWrites),
		).toEqual([]);
	});

	test(`narration ${locale} auto-advance retains position and title without heading focus`, async ({
		page,
		publishedNavigation,
	}) => {
		await page.goto(`${publishedNavigation}/narrated-${locale}/index.html?praxity-inspect=1`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const slider = page.locator('input[type="range"]');
		await expect(slider).toBeEnabled();
		await slider.focus();
		await page
			.locator(".praxity-narration-transport button")
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(page.locator("[data-narration-player]")).toHaveJSProperty("paused", false);
		await expect(page.locator("#page-2")).toBeVisible();
		await expect(page.locator("#page-2")).toHaveAccessibleName(
			locale === "fr" ? "Diapositive 2 sur 3" : "Slide 2 of 3",
		);
		await expect(slider).toBeFocused();
		await expect(page.locator("#deck-announcement")).toHaveText(
			locale === "fr" ? "Diapositive 2 sur 3: Second slide" : "Slide 2 of 3: Second slide",
		);
	});

	test(`Pages ${locale} navigation focuses content without a competing live message`, async ({
		page,
		publishedNavigation,
	}) => {
		await page.goto(`${publishedNavigation}/pages-${locale}/index.html`);
		await page.locator('#praxity-page-nav a[data-page-direction="next"]').click();
		await expect(page.getByRole("heading", { name: "Second slide", exact: true })).toBeFocused();
		await expect(page.locator("#praxity-live-region")).toBeEmpty();
		await page.locator('#praxity-page-nav a[data-page-direction="previous"]').click();
		await expect(page.getByRole("heading", { name: "First slide", exact: true })).toBeFocused();
		await expect(page.locator("#praxity-live-region")).toBeEmpty();
	});
}

for (const locale of ["en", "fr"]) {
	test(`deck ${locale} keeps slide position names through browser history`, async ({
		page,
		publishedNavigation,
	}) => {
		await page.goto(`${publishedNavigation}/deck-${locale}/index.html`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await page.locator("#deck-next").click();
		await page.goBack();
		await expect(page.locator("#page-1")).toBeVisible();
		await expect(page.locator("#page-1")).toHaveAccessibleName(
			locale === "fr" ? "Diapositive 1 sur 3" : "Slide 1 of 3",
		);
		await page.goForward();
		await expect(page.locator("#page-2")).toBeVisible();
		await expect(page.locator("#page-2")).toHaveAccessibleName(
			locale === "fr" ? "Diapositive 2 sur 3" : "Slide 2 of 3",
		);
	});
}
