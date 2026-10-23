import { expect, test } from "../fixtures/published-navigation";

test("deck titles decode entities on initialization and navigation, matching Pages", async ({
	page,
	publishedNavigation,
}) => {
	await page.goto(`${publishedNavigation}/pages-entities-en/index.html`);
	await expect(page).toHaveTitle("First & slide");
	await page.locator('#praxity-page-nav a[data-page-direction="next"]').click();
	await expect(page).toHaveTitle("Second & slide");
	await page.goto(`${publishedNavigation}/deck-entities-en/index.html`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page).toHaveTitle("First & slide");
	await page.locator("#deck-next").click();
	await expect(page).toHaveTitle("Second & slide");
});

test("deck title follows slides, fragments and browser history", async ({
	page,
	publishedNavigation,
}) => {
	await page.goto(`${publishedNavigation}/deck-en/index.html`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page).toHaveTitle("First slide");
	await page.locator("#deck-next").click();
	await expect(page).toHaveTitle("Second slide");
	await page.locator("#deck-next").click();
	await expect(page).toHaveTitle("Third slide");
	await page.goBack();
	await expect(page).toHaveTitle("Second slide");
	await page.evaluate(() => {
		location.hash = "page-1";
	});
	await expect(page).toHaveTitle("First slide");
	await page.goto(`${publishedNavigation}/deck-en/first-slide.html#page-3`);
	await expect(page).toHaveTitle("Third slide");
	await page.locator("#deck-next").click();
	await expect(page).toHaveTitle("Module complete");
	await page.locator("#deck-previous").click();
	await expect(page).toHaveTitle("Third slide");
});

test("deck title follows a confirmed resume without a navigation arrival focus", async ({
	page,
	publishedNavigation,
}) => {
	await page.addInitScript(() => {
		const values: Record<string, string> = {
			"cmi.entry": "resume",
			"cmi.location": "index.html?praxity-page=page-2",
			"cmi.suspend_data": JSON.stringify({ visitedPages: ["page-1", "page-2"] }),
		};
		Object.assign(window, {
			API_1484_11: {
				Initialize: () => "true",
				GetValue: (key: string) => values[key] ?? "",
				SetValue: (key: string, value: string) => {
					values[key] = value;
					return "true";
				},
				Commit: () => "true",
				Terminate: () => "true",
				GetLastError: () => "0",
				GetErrorString: () => "",
				GetDiagnostic: () => "",
			},
		});
	});
	await page.goto(`${publishedNavigation}/deck-en-scorm/index.html`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page).toHaveURL(/#page-2$/);
	await expect(page).toHaveTitle("Second slide");
	await expect(
		page.getByRole("heading", { name: "Resumed at slide 2 of 3: Second slide", exact: true }),
	).toBeFocused();
});
