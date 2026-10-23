import { expect, test } from "@playwright/test";
import { readTestEnv } from "./helpers";

for (const width of [1280, 390]) {
	for (const outline of [true, false]) {
		test(`course header stays visible while scrolling at ${width}px with outline ${outline}`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 720 });
			const url = `${readTestEnv().url}/design-navigation/outline-${outline}/navigation.html`;
			await page.goto(url);
			const header = page.locator(".praxity-top-bar-fallback").filter({ visible: true });
			await expect(header).toBeVisible();
			// Make this navigation fixture long enough to exercise real document scrolling.
			await page.locator("#main-content").evaluate((main) => {
				for (let index = 0; index < 50; index++) {
					const paragraph = document.createElement("p");
					paragraph.textContent = `Long course content ${index + 1}`;
					main.append(paragraph);
				}
			});
			await page.evaluate(() => window.scrollTo(0, 600));
			await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
			await expect
				.poll(() => header.evaluate((element) => element.getBoundingClientRect().top))
				.toBe(0);
			await page.goto(`${url}?minimal=1&praxity-small-preview=1`);
			await expect(page.locator(".praxity-top-bar-fallback")).toBeHidden();
			await expect(page.locator("#main-content")).toBeVisible();
		});
	}
}
