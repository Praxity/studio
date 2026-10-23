import { expect, type Page } from "@playwright/test";
import { test } from "../muted-test";
import { readTestEnv } from "./helpers";

async function findDisclosurePage(page: Page, selector: string) {
	const env = readTestEnv();
	// The comprehensive fixture contains third-party embeds. These checks are local.
	await page.route("https://**", (route) => route.abort());
	for (const candidate of env.pages) {
		await page.goto(`${env.url}/${candidate.slug}.html`, { waitUntil: "domcontentloaded" });
		if (await page.locator(selector).count()) return candidate;
	}
	return null;
}

for (const selector of [
	".praxity-accordion-static",
	'[data-block-type="audio"] .praxity-media-transcript',
	'[data-block-type="video"] .praxity-media-transcript',
]) {
	test(`${selector} remains readable without JavaScript`, async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();
		try {
			expect(await findDisclosurePage(page, selector)).toBeTruthy();
			const root = page.locator(selector).first();
			await expect(root.locator("[data-disclosure-panel]").first()).toBeVisible();
			await expect(root.locator("[data-disclosure-label]").first()).toBeVisible();
			await expect(root.locator("[data-disclosure-trigger]").first()).toBeHidden();
		} finally {
			await context.close();
		}
	});

	test(`${selector} exposes button state, a decorative icon and printable content`, async ({
		page,
	}) => {
		expect(await findDisclosurePage(page, selector)).toBeTruthy();
		const root = page.locator(selector).first();
		const button = root.locator("[data-disclosure-trigger]").first();
		await expect(button).toBeVisible();
		await expect(button).toHaveAttribute("aria-expanded", "false");
		const id = await button.getAttribute("aria-controls");
		expect(id).toBeTruthy();
		const panel = page.locator(`[id="${id}"]`);
		await expect(panel).toBeHidden();
		const name = await button.locator(".praxity-disclosure-title").innerText();
		await expect(button).toHaveAccessibleName(name);
		await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
		const alignment = await button.evaluate((element) => {
			const control = element.getBoundingClientRect();
			const icon = element.querySelector("svg")?.getBoundingClientRect();
			if (!icon) throw new Error("Missing disclosure icon");
			return Math.abs(icon.top + icon.height / 2 - control.top - control.height / 2);
		});
		expect(alignment).toBeLessThanOrEqual(1);
		const typography = await button.evaluate((element) => {
			const panelId = element.getAttribute("aria-controls");
			const panel = panelId && document.getElementById(panelId);
			if (!panel) throw new Error("Missing disclosure panel");
			const controlStyle = getComputedStyle(element);
			const panelStyle = getComputedStyle(panel);
			return {
				control: [controlStyle.fontSize, controlStyle.fontFamily, controlStyle.lineHeight],
				panel: [panelStyle.fontSize, panelStyle.fontFamily, panelStyle.lineHeight],
			};
		});
		expect(typography.control).toEqual(typography.panel);
		await button.focus();
		await page.keyboard.press("Space");
		await expect(button).toHaveAttribute("aria-expanded", "true");
		await expect(panel).toBeVisible();
		await expect(button).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(button).toHaveAttribute("aria-expanded", "false");
		await expect(panel).toBeHidden();
		await page.evaluate((panelId) => {
			location.hash = panelId ?? "";
		}, id);
		await expect(button).toHaveAttribute("aria-expanded", "true");
		await expect(panel).toBeVisible();
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(button).toHaveAttribute("aria-expanded", "true");
		await expect(panel).toBeVisible();
		await button.click();
		await expect(panel).toBeHidden();
		await page.emulateMedia({ media: "print" });
		await expect(panel).toBeVisible();
		await page.emulateMedia({ media: "screen" });
		await expect(panel).toBeHidden();
	});
}

test("failed island loading leaves headings and content readable", async ({ page }) => {
	await page.route("**/*.js", (route) => route.abort());
	expect(await findDisclosurePage(page, ".praxity-accordion-static")).toBeTruthy();
	const root = page.locator(".praxity-accordion-static").first();
	for (const panel of await root.locator("[data-disclosure-panel]").all())
		await expect(panel).toBeVisible();
	await expect(root.locator("[data-disclosure-label]").first()).toBeVisible();
	await expect(root.locator("[data-disclosure-trigger]").first()).toBeHidden();
});

test("accordion preserves single-open, narration reveal and old item fragments", async ({
	page,
}) => {
	expect(
		await findDisclosurePage(page, '.praxity-accordion-static[data-multiple="false"]'),
	).toBeTruthy();
	const root = page.locator('.praxity-accordion-static[data-multiple="false"]').first();
	const buttons = root.locator(
		":scope > [data-accordion-item] > .praxity-disclosure-heading > button",
	);
	expect(await buttons.count()).toBeGreaterThan(1);
	await buttons.first().click();
	await buttons.nth(1).click();
	await expect(buttons.first()).toHaveAttribute("aria-expanded", "false");
	await expect(buttons.nth(1)).toHaveAttribute("aria-expanded", "true");
	await buttons.first().focus();
	await page.keyboard.press("End");
	await expect(buttons.last()).toBeFocused();
	await page.keyboard.press("Home");
	await expect(buttons.first()).toBeFocused();
	await root
		.locator(":scope > [data-accordion-item]")
		.first()
		.dispatchEvent("praxity:narration-reveal");
	await expect(buttons.first()).toHaveAttribute("aria-expanded", "true");
	await expect(buttons.nth(1)).toHaveAttribute("aria-expanded", "false");
	const id = await buttons.nth(1).getAttribute("id");
	await page.goto(`${page.url().split("#")[0]}#${id}`);
	await expect(buttons.nth(1)).toHaveAttribute("aria-expanded", "true");
});
