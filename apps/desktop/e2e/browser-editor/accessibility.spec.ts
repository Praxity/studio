import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { startJourney } from "./global-setup";

test("Read is accessible without browser editor chrome", async ({ page }) => {
	const stop = await startJourney(page.context(), {
		standaloneSource:
			"# First\n\n::: accordion Container {style=shaded level=2}\n:: Item {level=3}\nBody.\n:::\n\n# Second page\n\n::: choice Practice {shuffle level=2}\nQuestion?\n(x) Yes\n( ) No\n:::\n",
	});
	try {
		await page.goto(process.env.PRAXITY_BROWSER_READY_URL ?? "");
		for (const next of [false, true]) {
			if (next) await page.locator("a.praxity-nav-next").click();
			expect(
				(
					await new AxeBuilder({ page })
						.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
						.analyze()
				).violations,
			).toEqual([]);
		}
	} finally {
		await stop();
	}
});
