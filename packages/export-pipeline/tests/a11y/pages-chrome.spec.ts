import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { readTestEnv, waitForHydration } from "./helpers";

async function capture(page: Page, name: string) {
	const directory = process.env.PRAXITY_PAGES_EVIDENCE_DIR;
	if (!directory) return;
	await mkdir(directory, { recursive: true });
	await page.screenshot({
		path: join(directory, `${test.info().project.name}-${name}.png`),
		animations: "disabled",
	});
}

for (const width of [1280, 768, 390]) {
	test(`Pages pagination keeps titles and position separate at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/media-and-embeds.html`);
		await waitForHydration(page);
		const nav = page.locator("#praxity-page-nav");
		await nav.scrollIntoViewIfNeeded();
		const previous = nav.getByRole("link", { name: "Previous page: Rich Content & Typography" });
		const next = nav.getByRole("link", { name: "Next page: Container Blocks" });
		await expect(previous).toContainText("Rich Content & Typography");
		await expect(next).toContainText("Container Blocks");
		const position = nav.getByText("Page 2 of 10", { exact: true });
		await expect(position).toBeVisible();
		const p = await position.boundingBox();
		const a = await previous.boundingBox();
		const b = await next.boundingBox();
		if (!p || !a || !b) throw new Error("Pagination geometry missing");
		expect(p.y + p.height).toBeLessThanOrEqual(Math.min(a.y, b.y));
		expect(a.height).toBeGreaterThanOrEqual(44);
		expect(b.height).toBeGreaterThanOrEqual(44);
		const rail = page.locator(".praxity-pages-progress");
		await expect(rail).toBeVisible();
		expect(
			await rail.evaluate((element) => ({
				position: getComputedStyle(element).position,
				height: element.getBoundingClientRect().height,
				top: element.getBoundingClientRect().top,
				pointerEvents: getComputedStyle(element).pointerEvents,
			})),
		).toEqual({ position: "fixed", height: 2, top: 0, pointerEvents: "none" });
		await capture(page, `pagination-${width}`);
		await Promise.all([
			page.waitForURL(`${readTestEnv().url}/rich-content-and-typography.html`),
			previous.click(),
		]);
	});
}

for (const width of [1280, 390]) {
	test(`Pages content retains side margins at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/rich-content-and-typography.html`);
		await waitForHydration(page);
		const padding = await page.locator("#main-content").evaluate((element) => {
			const style = getComputedStyle(element);
			return [Number.parseFloat(style.paddingLeft), Number.parseFloat(style.paddingRight)];
		});
		for (const value of padding) expect(value).toBeGreaterThanOrEqual(20);
		if (width === 390) {
			for (const element of await page.locator(".praxity-section > .praxity-block").all()) {
				const bounds = await element.boundingBox();
				if (!bounds) continue;
				expect(bounds.x).toBeGreaterThanOrEqual(20);
				expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 20);
			}
		}
		await capture(page, `margins-${width}`);
	});

	test(`Summary keeps Pages chrome and ends with completion at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/summary.html`);
		await waitForHydration(page);
		await expect(page.locator("body")).toHaveClass(/praxity-layout-sidebar/);
		await expect(page.locator(".praxity-slide-nav")).toHaveCount(0);
		await expect(page.locator("#praxity-page-nav .praxity-nav-next")).toHaveCount(0);
		const completion = page.getByRole("region", { name: "Course complete" });
		await expect(completion).toBeVisible();
		for (const action of await completion.getByRole("link").all()) {
			const bounds = await action.boundingBox();
			if (!bounds) throw new Error("Completion action requires geometry");
			expect(bounds.width).toBeGreaterThanOrEqual(44);
			expect(bounds.height).toBeGreaterThanOrEqual(44);
		}
		await expect(completion.getByRole("link", { name: "Review course" })).toHaveAttribute(
			"href",
			"rich-content-and-typography.html",
		);
		await expect(completion.getByRole("link", { name: "Back to course" })).toHaveAttribute(
			"href",
			"index.html",
		);
		await completion.scrollIntoViewIfNeeded();
		await capture(page, `summary-${width}`);
	});

	test(`Blocked embeds retain an in-frame fallback at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/rich-content-and-typography.html`);
		const embed = page
			.locator("[data-block-type='embed']")
			.filter({ has: page.locator("iframe") })
			.first();
		await embed.scrollIntoViewIfNeeded();
		const iframe = embed.locator("iframe");
		const title = await iframe.getAttribute("title");
		const frame = embed.locator(".praxity-embed-frame");
		const link = frame.getByRole("link", {
			name: `Open ${title} , (opens in a new tab)`,
			exact: true,
		});
		await expect(link).toBeVisible();
		await expect(link.locator(".praxity-external-icon")).toHaveAttribute("aria-hidden", "true");
		await expect(link).toHaveAttribute("target", "_blank");
		await expect(link).toHaveAttribute("rel", "noopener noreferrer");
		const href = await link.getAttribute("href");
		await expect(frame).toContainText(href ?? "missing URL");
		await expect(iframe).toBeHidden();
		await capture(page, `embed-${width}`);
	});

	test(`Glossary definitions open by pointer and keyboard at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/rich-content-and-typography.html`);
		const term = page.locator("[data-tooltip-content]").filter({ hasText: "PPE" }).first();
		await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
		for (const action of ["click", "Enter", "Space"]) {
			await term.scrollIntoViewIfNeeded();
			await page.mouse.move(0, 0);
			if (action === "click") await term.click();
			else {
				await term.focus();
				await term.press(action);
			}
			const definition = page.getByRole("definition");
			await expect(definition).toBeVisible();
			await expect(definition).toContainText("Personal Protective Equipment");
			await expect(definition.getByRole("link", { name: "Full glossary" })).toHaveAttribute(
				"href",
				"glossary.html",
			);
			await term.press("Tab");
			await expect(definition.getByRole("link", { name: "Full glossary" })).toBeFocused();
			await capture(page, `glossary-${action}-${width}`);
			await page.keyboard.press("Escape");
			await expect(term).toBeFocused();
			await expect(term).toHaveAttribute("aria-expanded", "false");
		}
		await page.goto(`${readTestEnv().url}/glossary.html`);
		const back = page.getByRole("link", { name: "Back to the course", exact: true });
		await expect(back).toHaveAttribute("href", "index.html");
		await capture(page, `glossary-page-${width}`);
		await Promise.all([
			page.waitForURL(`${readTestEnv().url}/rich-content-and-typography.html`),
			back.click(),
		]);
	});
}
