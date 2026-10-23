import { expect } from "@playwright/test";
import { test } from "../muted-test";
import { assertAxeScenario } from "./helpers";

for (const target of ["text", "ancestor"] as const) {
	test(`axe scans wait for the ${target} entrance fade`, async ({ page }) => {
		await page.setContent(`<!doctype html><html lang="en"><head><title>Contrast</title>
			<style>body { background: #fff; color: #111; } p { font-size: 16px; }</style>
			</head><body><main><h1>Expanded content</h1><div id="ancestor">
			<p id="text">European standard for ICT accessibility.</p></div></main></body></html>`);
		await page.locator(`#${target}`).evaluate((element) => {
			element.animate([{ opacity: 0.2 }, { opacity: 0.2, offset: 0.8 }, { opacity: 1 }], {
				duration: 2000,
				fill: "forwards",
			});
		});
		await assertAxeScenario(page, `settled-contrast::${target}-fade`);
		await expect(page.locator(`#${target}`)).toHaveCSS("opacity", "1");
	});
}

test("axe scans wait for delayed CSS transitions on ancestors", async ({ page }) => {
	await page.setContent(`<!doctype html><html lang="en"><head><title>Contrast</title>
		<style>body { background: #fff; color: #111; } p { font-size: 16px; }
		main { opacity: 0.2; transition: opacity 1s steps(1, end) 250ms; }</style>
		</head><body><main><h1>Expanded content</h1><p>Accessibility standards.</p></main></body></html>`);
	await page.locator("main").evaluate((element) => {
		getComputedStyle(element).opacity;
		element.style.opacity = "1";
	});
	await assertAxeScenario(page, "settled-contrast::delayed-transition");
	await expect(page.locator("main")).toHaveCSS("opacity", "1");
});

test("axe scans wait for animations started when another animation finishes", async ({ page }) => {
	await page.setContent(`<!doctype html><html lang="en"><head><title>Contrast</title>
		<style>body { background: #fff; color: #111; } p { font-size: 16px; }</style>
		</head><body><main><h1>Expanded content</h1><p>Accessibility standards.</p></main></body></html>`);
	await page.locator("main").evaluate((element) => {
		const first = element.animate([{ opacity: 0.2 }, { opacity: 0.2 }], { duration: 300 });
		first.addEventListener("finish", () => {
			element.animate([{ opacity: 0.2 }, { opacity: 0.2, offset: 0.8 }, { opacity: 1 }], {
				duration: 1000,
				fill: "forwards",
			});
		});
	});
	await assertAxeScenario(page, "settled-contrast::chained-motion");
	await expect(page.locator("main")).toHaveCSS("opacity", "1");
});

test("settled scans still reject insufficient text contrast", async ({ page }) => {
	await page.setContent(`<!doctype html><html lang="en"><head><title>Contrast</title>
		<style>body { background: #fff; color: #aaa; } p { font-size: 16px; }</style>
		</head><body><main><h1>Expanded content</h1><p>Unreadable settled text.</p></main></body></html>`);
	await expect(assertAxeScenario(page, "settled-contrast::bad-colors")).rejects.toThrow(
		/color-contrast/,
	);
});
