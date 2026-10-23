import { expect } from "@playwright/test";
import { test } from "../muted-test";
import { readTestEnv, waitForHydration } from "./helpers";

for (const locale of ["en", "fr"] as const) {
	test(`course outline glossary label stays on one line ${locale}`, async ({ page }, info) => {
		await page.setViewportSize({ width: 1280, height: 844 });
		await page.goto(`${readTestEnv().url}/outline-glossary-${locale}/index.html`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const link = page.locator("#deck-outline .deck-glossary-link");
		await expect(link).toBeVisible();
		const label = locale === "fr" ? "Glossaire" : "Glossary";
		await expect(link).toContainText(label);
		const geometry = await link.evaluate((element) => {
			const text = Array.from(element.childNodes).find(
				(node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
			);
			const icon = element.querySelector("svg");
			if (!text || !icon) throw new Error("Missing glossary label or external-link icon");
			const range = document.createRange();
			range.selectNode(text);
			const lines = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
			const bounds = range.getBoundingClientRect();
			const iconBounds = icon.getBoundingClientRect();
			return {
				lines: new Set(lines.map((rect) => rect.top)).size,
				height: element.getBoundingClientRect().height,
				iconBesideLabel: iconBounds.left >= bounds.right - 1,
			};
		});
		await page.screenshot({ path: info.outputPath(`outline-glossary-${locale}-1280.png`) });
		expect.soft(geometry.lines, "glossary label does not wrap mid-word").toBe(1);
		expect.soft(geometry.height, "glossary link retains normal row height").toBeLessThanOrEqual(48);
		expect.soft(geometry.iconBesideLabel, "external-link icon follows the label").toBe(true);
	});
}

for (const presentation of ["pages", "deck"] as const) {
	for (const direction of ["ltr", "rtl"] as const) {
		for (const width of [1280, 320]) {
			test(`course outline forced colours ${presentation} ${direction} ${width}`, async ({
				page,
				browserName,
			}) => {
				await page.setViewportSize({ width, height: 844 });
				await page.emulateMedia({
					forcedColors: "active",
					contrast: "more",
					reducedMotion: "reduce",
				});
				await page.addInitScript((dir) => {
					document.addEventListener("DOMContentLoaded", () => {
						document.documentElement.dir = dir;
					});
				}, direction);
				await page.goto(`${readTestEnv().url}/outline-${presentation}-ink-light/introduction.html`);
				await waitForHydration(page);
				const sidebar = page.locator(
					presentation === "pages" ? "#course-nav-sidebar" : "#deck-outline-sidebar",
				);
				if (presentation === "deck") {
					await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
					if (!(await sidebar.isVisible())) {
						await page.locator("#deck-more-toggle").click();
						await page.locator("#deck-outline-toggle").click();
					}
				} else if (width === 320) {
					await page.locator("[data-nav-menu-toggle]:visible").click();
					// Drawer entry moves focus on the next frame. Let that finish
					// before exercising keyboard navigation between rows.
					await expect(sidebar.locator('a[aria-current="page"]')).toBeFocused();
				}
				await expect(sidebar).toBeVisible();
				const rows = sidebar.locator(
					presentation === "pages" ? "a[data-page-id]" : "a[data-deck-page]",
				);
				await page.evaluate(() => document.fonts.ready);
				await rows.nth(1).focus();
				// Safari's Option+Tab includes native links on macOS.
				const tab = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
				await page.keyboard.press(`Shift+${tab}`);
				await expect(rows.first()).toBeFocused();
				await expect(rows.first()).toHaveCSS("outline-width", "3px");
				await expect(rows.first()).toHaveCSS("outline-style", "solid");
				await page.evaluate(
					() =>
						new Promise<void>((resolve) =>
							requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
						),
				);
				const edges = await rows.first().evaluate((row) => {
					const sidebar = row.closest<HTMLElement>("#course-nav-sidebar, #deck-outline-sidebar");
					if (!sidebar) throw new Error("Missing outline scrollport");
					const scroll = sidebar.querySelector<HTMLElement>(".deck-panel-scroll") ?? sidebar;
					const viewport = scroll.getBoundingClientRect();
					const bounds = row.getBoundingClientRect();
					const style = getComputedStyle(row);
					const outside =
						Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
					return {
						left: bounds.left - outside - (viewport.left + scroll.clientLeft),
						right:
							viewport.left + scroll.clientLeft + scroll.clientWidth - (bounds.right + outside),
						top: bounds.top - outside - (viewport.top + scroll.clientTop),
						bottom:
							viewport.top + scroll.clientTop + scroll.clientHeight - (bounds.bottom + outside),
					};
				});
				for (const [side, clearance] of Object.entries(edges)) {
					expect
						.soft(clearance, `${side} focus edge lies inside the scrollport`)
						.toBeGreaterThanOrEqual(-1);
				}
			});
		}
	}
}
