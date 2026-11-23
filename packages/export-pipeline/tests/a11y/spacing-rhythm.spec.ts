import { expect, type Page } from "@playwright/test";
import { test } from "../muted-test";
import { readTestEnv, textFitsWithin, waitForHydration } from "./helpers";

function measure(page: Page) {
	return page.evaluate(() => {
		const main = document.querySelector("#main-content");
		if (!main) throw new Error("Missing main content");
		const paragraph = (text: string) => {
			const found = [...main.querySelectorAll("p")].find(
				(node) => node.textContent?.trim() === text,
			);
			if (!found) throw new Error(`Missing paragraph: ${text}`);
			return found;
		};
		const one = (selector: string) => {
			const found = main.querySelector(selector);
			if (!found) throw new Error(`Missing ${selector}`);
			return found;
		};
		const between = (before: Element, after: Element) =>
			Math.round(after.getBoundingClientRect().top - before.getBoundingClientRect().bottom);
		const heading = one("h2");
		return {
			root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
			paragraphToHeading: between(paragraph("The opening paragraph introduces the page."), heading),
			headingToBody: between(heading, paragraph("Body text follows the heading.")),
			textToList: between(paragraph("Bring these items:"), one("ul")),
			betweenComponents: between(one('[data-block-type="note"]'), one('[data-block-type="quote"]')),
		};
	});
}

const EXPECTED = {
	1280: {
		default: {
			root: 16,
			paragraphToHeading: 64,
			headingToBody: 16,
			textToList: 8,
			betweenComponents: 32,
		},
		large: {
			root: 20,
			paragraphToHeading: 80,
			headingToBody: 20,
			textToList: 10,
			betweenComponents: 40,
		},
	},
	320: {
		default: {
			root: 16,
			paragraphToHeading: 48,
			headingToBody: 12,
			textToList: 8,
			betweenComponents: 24,
		},
		large: {
			root: 20,
			paragraphToHeading: 60,
			headingToBody: 15,
			textToList: 10,
			betweenComponents: 30,
		},
	},
} as const;

for (const width of [1280, 320] as const) {
	test(`exported block gaps grow with Larger text at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${readTestEnv().url}/spacing-rhythm/spacing-rhythm.html`);
		await waitForHydration(page);
		await page.evaluate(() => document.fonts.ready);
		expect(await measure(page), "default text size").toEqual(EXPECTED[width].default);

		await page.getByRole("button", { name: "Larger text" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-praxity-text-size", "large");
		await page.evaluate(() => document.fonts.ready);
		expect(await measure(page), "Larger text").toEqual(EXPECTED[width].large);

		if (width !== 320) return;
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
			"no horizontal scroll at 320px with Larger text",
		).toBeLessThanOrEqual(1);
		const text = page.locator("#main-content :is(h1, h2, p, li)");
		for (const element of await text.all())
			expect(await textFitsWithin(element), await element.innerText()).toBe(true);
	});
}
