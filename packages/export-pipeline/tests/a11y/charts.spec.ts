import { expect, test } from "@playwright/test";
import { findPageWithSelector, getCoursePages, readTestEnv, waitForHydration } from "./helpers";

test.describe("chart rendering", () => {
	for (const width of [360, 1024]) {
		for (const small of [true, false]) {
			test(`annual labels stay readable at ${width}px in ${small ? "small" : "full"} preview`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height: 900 });
				const url = `${readTestEnv().url}/authoring-catalog/catalog-annual-chart.html`;
				await page.goto(`${url}${small ? "?minimal=1&praxity-small-preview=1" : ""}`);
				if (small) {
					await expect(page.locator("html")).toHaveAttribute(
						"data-praxity-small-preview-ready",
						"true",
					);
				} else {
					await waitForHydration(page);
				}
				await page.evaluate(() => document.fonts.ready);
				const chart = page.locator("[data-block-type='chart']");
				const visual = chart.locator("svg.praxity-chart-visual:visible");
				await expect(visual).toHaveCount(1);
				await expect(chart.locator("[data-chart-enhanced], svg[tabindex]")).toHaveCount(0);
				await expect(chart.locator(".praxity-chart-title")).toHaveCSS("text-align", "center");
				const labels = await visual.locator("text").evaluateAll((nodes) =>
					nodes
						.filter((node) => /^\d{4}$/.test(node.textContent ?? ""))
						.map((node) => {
							const bounds = node.getBoundingClientRect();
							const transform = (node as SVGGraphicsElement).getScreenCTM();
							const scale = Math.hypot(transform?.a ?? 0, transform?.b ?? 0);
							return {
								year: Number(node.textContent),
								left: bounds.left,
								right: bounds.right,
								fontSize: Number.parseFloat(getComputedStyle(node).fontSize) * scale,
							};
						}),
				);
				expect(labels[0]?.year).toBe(1961);
				expect(labels.at(-1)?.year).toBe(2021);
				expect(labels.length).toBeLessThanOrEqual(16);
				for (const label of labels) {
					expect(label.fontSize).toBeGreaterThanOrEqual(11.95);
				}
				for (let index = 1; index < labels.length; index++) {
					expect(
						labels[index].left,
						`year ${labels[index].year} must not overlap its neighbor`,
					).toBeGreaterThan(labels[index - 1].right);
				}
				const ticks = await visual.locator(".praxity-chart-category-ticks").getAttribute("d");
				expect(ticks?.match(/\bM /g)).toHaveLength(61);
				await expect(visual.locator("circle title, rect title, path title")).toHaveCount(61);
				await expect(chart.locator("table.praxity-chart-data tbody tr")).toHaveCount(61);
				await expect(chart.locator("table.praxity-chart-data tbody th").first()).toHaveText("1961");
				await expect(chart.locator("table.praxity-chart-data tbody th").last()).toHaveText("2021");
			});
		}
	}

	test("annual chart responds to its own width and prints a single visual", async ({ page }) => {
		await page.goto(`${readTestEnv().url}/authoring-catalog/catalog-annual-chart.html`);
		await waitForHydration(page);
		const chart = page.locator(".praxity-chart-container");
		for (const [width, variant] of [
			[224, "compact"],
			[401, "medium"],
			[641, "wide"],
		] as const) {
			await chart.evaluate((node, value) => {
				(node as HTMLElement).style.width = `${value}px`;
			}, width);
			await expect(chart.locator("svg.praxity-chart-visual:visible")).toHaveCount(1);
			const visual = chart.locator(`svg.praxity-chart-visual--${variant}`);
			await expect(visual).toBeVisible();
			const fontSize = await visual
				.locator("text")
				.first()
				.evaluate((node) => {
					const matrix = (node as SVGGraphicsElement).getScreenCTM();
					return (
						Number.parseFloat(getComputedStyle(node).fontSize) *
						Math.hypot(matrix?.a ?? 0, matrix?.b ?? 0)
					);
				});
			expect(fontSize).toBeGreaterThanOrEqual(11.95);
			expect(fontSize).toBeLessThan(14.5);
		}
		await page.emulateMedia({ media: "print" });
		await expect(chart.locator("svg.praxity-chart-visual:visible")).toHaveCount(1);
		await expect(chart.locator("svg.praxity-chart-visual--wide")).toBeVisible();
	});

	test("annual chart and data table render without JavaScript", async ({ browser }) => {
		const context = await browser.newContext({
			javaScriptEnabled: false,
			viewport: { width: 360, height: 900 },
		});
		try {
			const page = await context.newPage();
			await page.goto(`${readTestEnv().url}/authoring-catalog/catalog-annual-chart.html`);
			const chart = page.locator(".praxity-chart-container");
			await expect(chart.locator("svg.praxity-chart-visual:visible")).toHaveCount(1);
			await expect(chart.locator("table.praxity-chart-data tbody tr")).toHaveCount(61);
		} finally {
			await context.close();
		}
	});

	test("chart renders visual, has label, and stays within container bounds", async ({ page }) => {
		const env = readTestEnv();
		const pages = await getCoursePages(page, env.url);
		const chartPage = await findPageWithSelector(page, env.url, pages, "[data-block-type='chart']");
		if (!chartPage) throw new Error("No chart block found in fixture");

		const chartBlock = page.locator("[data-block-type='chart']").first();
		await expect(chartBlock).toBeVisible();
		await chartBlock.scrollIntoViewIfNeeded();

		const visual = chartBlock.locator("svg.praxity-chart-visual:visible, canvas:visible").first();
		await expect(visual).toBeVisible();

		const hasDimensions = await visual.evaluate((el) => {
			const rect = (el as HTMLElement).getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		});
		expect(hasDimensions, "chart visual should have non-zero dimensions").toBe(true);

		const hasAccessibleName = await chartBlock.evaluate((root) => {
			const byAriaLabel = root.querySelector(
				"svg[aria-label], canvas[aria-label], img[aria-label], img[alt]",
			);
			if (byAriaLabel) return true;
			const title = root.querySelector("svg title");
			if (title?.textContent?.trim()) return true;
			const figcaption = root.querySelector("figcaption");
			if (figcaption?.textContent?.trim()) return true;
			const tableCaption = root.querySelector("table caption");
			if (tableCaption?.textContent?.trim()) return true;
			const dataTable = root.querySelector("table.praxity-chart-data");
			if (dataTable?.querySelector("thead th") && dataTable?.querySelector("tbody tr")) return true;
			const nearbyHeading = root.querySelector("h1, h2, h3, h4");
			if (nearbyHeading?.textContent?.trim()) return true;
			return false;
		});
		expect(hasAccessibleName, "chart should expose an accessible name or data-table caption").toBe(
			true,
		);

		const noOverflow = await chartBlock.evaluate((root) => {
			const container =
				(root.querySelector(".praxity-chart-container") as HTMLElement | null) ??
				(root as HTMLElement);
			return container.scrollWidth <= container.clientWidth + 1;
		});
		expect(noOverflow, "chart container should not overflow horizontally").toBe(true);
	});
});

for (const input of ["mouse", "touch"] as const) {
	test(`charts remain static with ${input} input and retain accessible data`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			viewport: { width: input === "touch" ? 360 : 1024, height: 900 },
			hasTouch: input === "touch",
		});
		try {
			const page = await context.newPage();
			for (const type of ["bar", "line", "area", "scatter", "radar", "stacked"]) {
				await page.goto(
					`${readTestEnv().url}/authoring-catalog/catalog-inspect-${type}-chart.html`,
				);
				await waitForHydration(page);
				const chart = page.locator(".praxity-chart-container");
				const visual = chart.locator("svg.praxity-chart-visual:visible");
				await expect(visual).toHaveCount(1);
				if (input === "touch") await visual.tap();
				else await visual.hover();
				await expect(visual).toHaveAttribute("role", "img");
				await expect(
					chart.locator("[tabindex], [data-chart-point], [data-chart-active], [role=tooltip]"),
				).toHaveCount(0);
				await expect(chart.locator("table tbody tr")).toHaveCount(3);
				await expect(chart.locator("table tbody th")).toHaveText(["Q1", "Q2", "Q3"]);
				await expect(chart.locator("table thead")).toContainText("Alpha");
				await expect(chart.locator("table thead")).toContainText("Beta");
			}
		} finally {
			await context.close();
		}
	});
}
