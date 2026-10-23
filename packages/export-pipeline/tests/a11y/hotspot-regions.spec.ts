import { expect, type Page, test } from "@playwright/test";
import { catalogSlug } from "../fixtures/authoring-catalog";
import { readTestEnv } from "./helpers";
import { applyTwoHundredPercentZoom } from "./layout-overrides";

for (const legacy of [false, true]) {
	for (const mode of ["full", "no-js"] as const) {
		test.describe(`French ${legacy ? "legacy" : "question"} ${mode} hotspot`, () => {
			test.use({ javaScriptEnabled: mode !== "no-js" });
			test("preserves authored French names and localized required status", async ({ page }) => {
				await page.goto(
					`${readTestEnv().url}/french-hotspots/hotspot-${legacy ? "legacy" : "question"}.html`,
				);
				const block = page.locator('[data-block-type="assessment"]');
				if (mode === "full") await expect(block).toHaveAttribute("data-hydrated", "");
				await expect(
					block.getByRole("group", {
						name: legacy
							? "Commandes de l'équipement avec une vanne et un manomètre"
							: /^Sélectionnez les zones pertinentes de l'image\./,
					}),
				).toBeVisible();
				await expect(block.locator(".praxity-required-indicator")).toHaveText("Obligatoire");
				await expect(block).not.toContainText("Aucun texte de question");
				if (mode === "full") {
					const valve = block.getByRole("button", { name: "Vanne", exact: true });
					await valve.focus();
					await page.keyboard.press("Enter");
					await expect(valve).toHaveAttribute("aria-pressed", "true");
				}
			});
		});
	}
}

test.describe("legacy stemless hotspot", () => {
	for (const mode of ["full", "small", "no-js"] as const) {
		test.describe(mode, () => {
			test.use({ javaScriptEnabled: mode !== "no-js" });
			test("uses the image description without losing required or scored behavior", async ({
				page,
			}) => {
				const query = mode === "small" ? "?minimal=1&praxity-small-preview=1" : "";
				await page.goto(
					`${readTestEnv().url}/authoring-catalog/catalog-legacy-hotspot.html${query}`,
				);
				const block = page.locator('[data-block-type="assessment"]');
				if (mode === "full") await expect(block).toHaveAttribute("data-hydrated", "");
				await expect(
					block.getByRole("group", {
						name: "Equipment controls with a valve and gauge",
						exact: true,
					}),
				).toBeVisible();
				await expect(block).not.toContainText("No question text");
				await expect(block.locator(".praxity-required-indicator")).toHaveText("Required");
				const valve = block.getByRole("button", { name: "Valve", exact: true });
				if (mode !== "full") {
					await expect(valve).toBeDisabled();
					return;
				}
				const assessment = block.locator("[data-max-score]");
				await expect(assessment).toHaveAttribute("data-max-score", "10");
				await expect(assessment).toHaveAttribute("data-assessment-answered", "false");
				await valve.focus();
				await page.keyboard.press("Space");
				await expect(valve).toHaveAttribute("aria-pressed", "true");
				await expect(assessment).toHaveAttribute("data-assessment-answered", "true");
				const check = block.getByRole("button", { name: "Submit", exact: true });
				await check.focus();
				await page.keyboard.press("Enter");
				await expect(assessment).toHaveAttribute("data-score", "10");
				await expect(assessment).toHaveAttribute("data-passed", "true");
				await expect(assessment).toHaveAttribute("data-completed", "true");
			});
		});
	}
});

async function openHotspot(page: Page) {
	await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("hotspot")}.html`);
	await expect(page.locator('[data-block-type="assessment"][data-hydrated]')).toHaveCount(1);
	return {
		rect: page.getByRole("button", { name: "Correct area" }),
		polygon: page.getByRole("button", { name: "Distractor area" }),
	};
}

for (const mode of ["full", "no-js"] as const) {
	test.describe(`point hotspot at 160 px, ${mode}`, () => {
		test.use({ javaScriptEnabled: mode !== "no-js" });
		test("keeps separate targets and scrolls the image locally", async ({ page }) => {
			await page.setViewportSize({ width: 160, height: 450 });
			await page.goto(`${readTestEnv().url}/complex-assessments.html?praxity-resume=0`);
			const block = page.locator('[data-block-type="assessment"]').filter({
				has: page.locator(".praxity-hotspot-region"),
			});
			await block.scrollIntoViewIfNeeded();
			if (mode === "full") await expect(block).toHaveAttribute("data-hydrated", "");
			const scroller = block.locator(".praxity-hotspot-scroll");
			await expect(scroller).toHaveAccessibleName("3 regions. Select a region.");
			const buttons = scroller.locator("button");
			await expect(buttons).toHaveCount(3);
			const targets = await buttons.evaluateAll((elements) =>
				elements.map((element) => {
					const { x, y, width, height } = element.getBoundingClientRect();
					return { x, y, width, height };
				}),
			);
			for (const target of targets) {
				expect(target.width).toBe(44);
				expect(target.height).toBe(44);
			}
			for (const [index, a] of targets.entries()) {
				for (const b of targets.slice(index + 1)) {
					expect(
						a.x + a.width <= b.x ||
							b.x + b.width <= a.x ||
							a.y + a.height <= b.y ||
							b.y + b.height <= a.y,
					).toBe(true);
				}
			}
			expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
				true,
			);
			expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
			if (mode === "full") {
				const last = buttons.last();
				await last.focus();
				await expect(last).toBeInViewport();
				expect(await scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
				await page.keyboard.press("Enter");
				await expect(last).toHaveAttribute("aria-pressed", "true");
			}
		});
	});
}

test("submitted hotspot retains readable markers and locks its selection", async ({ page }) => {
	const { rect, polygon } = await openHotspot(page);
	await rect.click();
	await page.locator("[data-assessment-submit]").click();
	await expect(rect).toHaveAttribute("aria-disabled", "true");
	await expect(rect).toHaveAttribute("aria-pressed", "true");
	await expect(rect).toHaveCSS("opacity", "1");
	const marker = rect.locator("xpath=following-sibling::span");
	await expect(marker).toHaveCSS("opacity", "1");
	await expect(marker).toHaveText("✓ 1");
	await rect.focus();
	await page.keyboard.press("Enter");
	await expect(rect).toHaveAttribute("aria-pressed", "true");
	await polygon.focus();
	await page.keyboard.press("Enter");
	await expect(polygon).toHaveAttribute("aria-pressed", "false");
});

test("hotspot retry returns focus to the first answer at 160 px", async ({ page }) => {
	await page.setViewportSize({ width: 160, height: 450 });
	const { rect, polygon } = await openHotspot(page);
	await polygon.focus();
	await page.keyboard.press("Enter");
	await page.locator("[data-assessment-submit]").click();
	const retry = page.getByRole("button", { name: "Try again", exact: true });
	await expect(retry).toBeVisible();
	await retry.focus();
	await page.keyboard.press("Enter");
	await expect(rect).toBeFocused();
	await expect(rect).toHaveAttribute("aria-pressed", "false");
	await expect(rect).toBeInViewport();
});

test("rect and polygon regions keep keyboard order and visible focus at 320 px", async ({
	page,
	browserName,
}) => {
	// WebKit on macOS skips buttons on plain Tab unless Full Keyboard Access is on.
	const tab = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
	await page.setViewportSize({ width: 320, height: 700 });
	const { rect, polygon } = await openHotspot(page);
	await expect(rect).toBeVisible();
	await expect(polygon).toBeVisible();
	await rect.focus();
	await page.keyboard.press(`Shift+${tab}`);
	await page.keyboard.press(tab);
	await expect(rect).toBeFocused();
	await expect(rect.locator("..")).toHaveCSS("outline-style", "solid");
	await expect(rect.locator("..")).toHaveCSS("outline-width", "2px");
	await page.keyboard.press(tab);
	await expect(polygon).toBeFocused();
	await expect(polygon.locator("..")).toHaveCSS("outline-style", "solid");
	await page.keyboard.press("Enter");
	await expect(polygon).toHaveAttribute("aria-pressed", "true");
	// The selected check sits outside the clipped button, so the polygon's shape cannot hide it.
	await expect(polygon.locator("xpath=following-sibling::span")).toHaveText("✓ 2");
	await expect(polygon.locator("xpath=following-sibling::span")).toBeVisible();
});

test("rect and polygon regions stay operable at 320 CSS px under 200% zoom", async ({
	page,
	browserName,
}) => {
	test.skip(browserName !== "chromium", "200% zoom uses the Chromium DevTools Protocol");
	await page.setViewportSize({ width: 640, height: 900 });
	const { rect, polygon } = await openHotspot(page);
	await applyTwoHundredPercentZoom(page);
	expect(await page.evaluate(() => window.innerWidth)).toBe(320);
	await polygon.focus();
	await expect(rect).toBeVisible();
	await expect(polygon).toBeVisible();
	await expect(polygon.locator("..")).toHaveCSS("outline-width", "2px");
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
			),
		)
		.toBe(true);
});
