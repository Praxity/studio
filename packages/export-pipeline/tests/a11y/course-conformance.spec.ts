import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { test } from "../muted-test";
import { analyzeAxe, getCoursePages, readTestEnv, waitForHydration } from "./helpers";

for (const theme of ["light", "dark"] as const) {
	test(`code regions support keyboard scrolling in ${theme} at 390px`, async ({
		page,
	}, testInfo) => {
		const baseUrl = readTestEnv().fullFixtureVariants?.[`theme-${theme}`];
		if (!baseUrl) throw new Error(`Missing comprehensive ${theme} fixture`);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`${baseUrl}/rich-content-and-typography.html`);
		await waitForHydration(page);
		await expect(page.locator("html")).toHaveAttribute("data-praxity-mode", theme);
		const blocks = page.locator(".praxity-code-container");
		await expect(blocks).toHaveCount(4);
		await blocks.first().scrollIntoViewIfNeeded();
		await page.screenshot({ path: testInfo.outputPath(`code-${theme}-390.png`), fullPage: true });
		await page.setViewportSize({ width: 768, height: 900 });
		await blocks.first().scrollIntoViewIfNeeded();
		await page.screenshot({ path: testInfo.outputPath(`code-${theme}-768.png`), fullPage: true });
		await page.setViewportSize({ width: 390, height: 844 });
		const results = await analyzeAxe(
			page,
			new AxeBuilder({ page })
				.include(".praxity-code-container")
				.withRules(["scrollable-region-focusable", "color-contrast"]),
		);
		expect(results.violations).toEqual([]);
		for (const [index, block] of (await blocks.all()).entries()) {
			const pre = block.locator("pre");
			await expect(pre).toHaveAttribute("role", "region");
			await expect(pre).toHaveAccessibleName(/^Code .+/);
			await expect(pre).toHaveAttribute("tabindex", "0");
			await block.getByRole("button", { name: "Copy code to clipboard" }).focus();
			await page.keyboard.press("Tab");
			await expect(pre).toBeFocused();
			const focus = await pre.evaluate((element) => ({
				style: getComputedStyle(element).outlineStyle,
				width: Number.parseFloat(getComputedStyle(element).outlineWidth),
			}));
			expect(focus.style).not.toBe("none");
			expect(focus.width).toBeGreaterThanOrEqual(2);
			expect(await pre.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
				await pre.evaluate((element) => element.clientWidth),
			);
			await page.keyboard.press("ArrowRight", { delay: 150 });
			await expect.poll(() => pre.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
			if (index === 0) {
				await page.screenshot({ path: testInfo.outputPath(`code-${theme}-focus-390.png`) });
			}
			await page.keyboard.press("Tab");
			await expect(pre).not.toBeFocused();
		}
	});
}

for (const width of [1440, 390]) {
	test(`page position stays inside a landmark across all comprehensive pages at ${width}px`, async ({
		page,
	}, testInfo) => {
		test.setTimeout(120_000);
		const baseUrl = `${readTestEnv().url}/course-conformance`;
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
		const pages = await getCoursePages(page, baseUrl);
		expect(pages).toHaveLength(13);
		for (const meta of pages) {
			await page.goto(`${baseUrl}/${meta.slug}.html`);
			await waitForHydration(page);
			if (meta.slug === "summary") {
				await page.screenshot({
					path: testInfo.outputPath(`summary-${width}.png`),
					fullPage: true,
				});
				await expect(page.locator(".praxity-pages-position")).toContainText("Page 13 of 13");
				await expect(page.getByRole("banner")).toHaveCount(1);
				const counter = await page.locator(".praxity-pages-position").boundingBox();
				expect(counter).not.toBeNull();
				const previous = await page.locator(".praxity-nav-prev").boundingBox();
				if (!counter || !previous) throw new Error("Summary needs position and previous link");
				expect(counter.y + counter.height).toBeLessThanOrEqual(previous.y);
				await expect(page.locator(".praxity-deck")).toHaveCount(0);
				await expect(page.locator(".praxity-pages-completion")).toBeVisible();
			}
			const results = await analyzeAxe(page, new AxeBuilder({ page }).withRules(["region"]));
			expect(results.violations, `${meta.slug} at ${width}px`).toEqual([]);
		}
	});
}
