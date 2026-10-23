import { expect } from "@playwright/test";
import { test } from "../muted-test";
import { readTestEnv } from "./helpers";

for (const theme of ["light", "dark"]) {
	for (const width of [320, 390, 768]) {
		for (const spaced of [false, true]) {
			test(`tabs reflow ${theme} at ${width}, text spacing=${spaced}`, async ({ page }, info) => {
				await page.setViewportSize({ width, height: 900 });
				const env = readTestEnv();
				const base = env.fullFixtureVariants?.[`theme-${theme}`];
				if (!base) throw new Error(`Missing ${theme} fixture`);
				const meta = env.coursePages?.[base]?.find((entry) => entry.title === "Container Blocks");
				if (!meta) throw new Error("Missing comprehensive container page");
				await page.goto(`${base}/${meta.slug}.html`);
				const block = page.locator('[data-block-type="tabs"]').first();
				await block.scrollIntoViewIfNeeded();
				await expect(block).toHaveAttribute("data-hydrated", "");
				if (spaced)
					await page.addStyleTag({
						content:
							"* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }",
					});
				await block.screenshot({ path: info.outputPath("tabs.png") });
				if (process.env.COURSE_AUDIT_SCREENSHOTS && info.project.name === "chromium" && !spaced)
					await block.screenshot({
						path: `${process.env.COURSE_AUDIT_SCREENSHOTS}/tabs-${theme}-${width}.png`,
					});
				await expect(block.getByRole("tablist")).toHaveCount(0);
				const buttons = block.locator(".praxity-tabs-tab");
				for (const button of await buttons.all()) {
					await expect(button).toBeVisible();
					expect(
						await button.evaluate((element) => element.getBoundingClientRect().right),
					).toBeLessThanOrEqual(width);
				}
				await buttons.nth(1).focus();
				await page.keyboard.press("Enter");
				await expect(buttons.nth(1)).toHaveAttribute("aria-expanded", "true");
				await expect(buttons.first()).toHaveAttribute("aria-expanded", "false");
				await expect(block.locator(".praxity-tabs-panel:visible")).toHaveCount(1);
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
			});
		}
	}
}

for (const theme of ["light", "dark"]) {
	test(`disclosure controls retain visible boundaries in ${theme} high contrast`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 900 });
		await page.emulateMedia({ contrast: "more" });
		const env = readTestEnv();
		const base = env.fullFixtureVariants?.[`theme-${theme}`];
		const meta =
			base && env.coursePages?.[base]?.find((entry) => entry.title === "Container Blocks");
		if (!meta) throw new Error("Missing comprehensive container page");
		await page.goto(`${base}/${meta.slug}.html`);
		const block = page.locator('[data-block-type="tabs"]').first();
		await block.scrollIntoViewIfNeeded();
		await expect(block).toHaveAttribute("data-hydrated", "");
		await expect(block.getByRole("tablist")).toHaveCount(0);
		for (const button of await block.locator(".praxity-tabs-tab").all()) {
			await expect(button).toHaveCSS("border-top-width", "1px");
			await expect(button).toHaveCSS("border-top-style", "solid");
		}
		const button = block.locator(".praxity-tabs-tab").nth(1);
		await button.click();
		await expect(button).toHaveAttribute("aria-expanded", "true");
	});
}
