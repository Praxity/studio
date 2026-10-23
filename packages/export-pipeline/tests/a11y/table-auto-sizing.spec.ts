import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { analyzeAxe, readTestEnv } from "./helpers";

async function openTable(page: Page, slug: string, small = false) {
	await page.goto(
		`${readTestEnv().url}/container-layouts/${slug}.html${small ? "?minimal=1&praxity-small-preview=1" : ""}`,
	);
	await page.evaluate(() => document.fonts.ready);
	await expect(page.locator('[data-island="table"]').first()).toHaveAttribute("data-hydrated", "");
}

for (const small of [false, true]) {
	test(`${small ? "small preview" : "published"} fits icon labels and restores native sizing when narrow`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await openTable(page, "automatic-table", small);
		const table = page.getByRole("table");
		const originalText = await table.textContent();
		await expect(table).toHaveCSS("table-layout", "fixed");
		await expect(page.getByRole("rowheader")).toHaveCount(3);
		for (const header of await page.getByRole("rowheader").all()) {
			const lineCount = await header.evaluate((node) => {
				const range = document.createRange();
				range.selectNodeContents(node);
				const ys = [...range.getClientRects()]
					.filter((r) => r.width && r.height)
					.map((r) => r.top)
					.sort((a, b) => a - b);
				const lines: number[] = [];
				for (const y of ys)
					if (
						!lines.length ||
						y - lines[lines.length - 1] > Number.parseFloat(getComputedStyle(node).lineHeight) / 2
					)
						lines.push(y);
				return lines.length;
			});
			expect(lineCount).toBe(1);
		}
		await page.screenshot({ path: test.info().outputPath("wide.png"), fullPage: true });
		await page.setViewportSize({ width: 320, height: 900 });
		await expect(table).toHaveCSS("table-layout", "auto");
		expect(await table.textContent()).toBe(originalText);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
		).toBeLessThanOrEqual(1);
		await page.setViewportSize({ width: 1280, height: 900 });
		await expect(table).toHaveCSS("table-layout", "fixed");
		await expect(table.locator("colgroup")).toHaveCount(1);
		await expect(table.locator("col")).toHaveCount(2);
	});

	test(`${small ? "small preview" : "published"} retains native allocation for compact and all-prose tables`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		for (const slug of ["compact-table", "prose-table"]) {
			await openTable(page, slug, small);
			await expect(page.getByRole("table")).toHaveCSS("table-layout", "auto");
			await expect(page.getByRole("table").locator("colgroup")).toHaveCount(0);
		}
	});
}

test("sizing follows changed content, nested width, enlarged text and hidden/revealed containers", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await openTable(page, "automatic-table");
	const table = page.getByRole("table");
	await expect(table).toHaveCSS("table-layout", "fixed");
	const header = page.getByRole("rowheader").first();
	const initialWidth = await header.evaluate((node) => node.getBoundingClientRect().width);
	await header.evaluate((node) => {
		node.textContent = "Observatoires mobiles";
	});
	await expect
		.poll(() => header.evaluate((node) => node.getBoundingClientRect().width))
		.toBeGreaterThan(initialWidth + 30);
	const region = page.locator(".praxity-table-scroll-region");
	await region.evaluate((node) => {
		node.style.maxWidth = "300px";
	});
	await expect(table).toHaveCSS("table-layout", "auto");
	await region.evaluate((node) => {
		node.style.maxWidth = "";
	});
	await expect(table).toHaveCSS("table-layout", "fixed");
	await table.evaluate((node) => {
		node.style.fontSize = "32px";
	});
	await expect(table).toHaveCSS("table-layout", "auto");
	await region.evaluate((node) => {
		node.style.display = "none";
	});
	await page.locator("table").evaluate((node) => {
		node.style.fontSize = "";
	});
	await region.evaluate((node) => {
		node.style.display = "";
	});
	await expect(table).toHaveCSS("table-layout", "fixed");
	await expect(table.locator("colgroup")).toHaveCount(1);
	await region.focus();
	await expect(region).toBeFocused();
	const results = await analyzeAxe(
		page,
		new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]),
	);
	expect(results.violations).toEqual([]);
});

test("column measurements ignore visual scaling on an ancestor", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await openTable(page, "automatic-table");
	const table = page.getByRole("table");
	await expect(table).toHaveCSS("table-layout", "fixed");
	const header = page.getByRole("rowheader").first();
	const before = await header.evaluate((node: HTMLTableCellElement) => node.offsetWidth);
	await page.locator(".praxity-table-scroll-region").evaluate((node) => {
		node.style.transform = "scale(0.8)";
	});
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	expect(await header.evaluate((node: HTMLTableCellElement) => node.offsetWidth)).toBe(before);
	await expect(table).toHaveCSS("table-layout", "fixed");
});

test("semantic table remains usable without JavaScript", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(`${readTestEnv().url}/container-layouts/automatic-table.html`);
		await expect(page.getByRole("table")).toBeVisible();
		await expect(page.getByRole("rowheader")).toHaveCount(3);
		await expect(page.getByRole("table")).toHaveCSS("table-layout", "auto");
		await page.locator(".praxity-table-scroll-region").focus();
		await expect(page.locator(".praxity-table-scroll-region")).toBeFocused();
	} finally {
		await context.close();
	}
});
