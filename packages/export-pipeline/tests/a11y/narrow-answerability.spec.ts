import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
	analyzeAxe,
	findPageWithSelector,
	readFullFixtureVariantUrl,
	readTestEnv,
} from "./helpers";

async function openBlock(page: Page, theme: string, selector: string) {
	if (selector === ".praxity-matrix-table") {
		await page.goto(`${readTestEnv().url}/review-clean-${theme}/assessment-review.html`);
	} else {
		const base = readFullFixtureVariantUrl(`theme-${theme}`);
		if (!base) throw new Error(`Missing ${theme} fixture`);
		const env = readTestEnv();
		expect(
			await findPageWithSelector(page, base, env.coursePages?.[base] ?? env.pages, selector),
		).not.toBeNull();
	}
	const block = page.locator(selector).first();
	const island = block.locator("xpath=ancestor-or-self::*[@data-island][1]");
	await island.scrollIntoViewIfNeeded();
	await expect(island).toHaveAttribute("data-hydrated", "");
	await block.scrollIntoViewIfNeeded();
	await page.evaluate(() => document.fonts.ready);
	return block;
}

async function screenshot(page: Page, name: string) {
	const folder = process.env.PRAXITY_NARROW_SCREENSHOTS;
	if (folder && test.info().project.name === "chromium")
		await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
}

for (const theme of ["light", "dark"]) {
	test(`${theme} categorize and matrix expose every answer at narrow widths`, async ({ page }) => {
		for (const type of ["categorize", "matrix"]) {
			await page.setViewportSize({ width: 390, height: 900 });
			const table = await openBlock(page, theme, `.praxity-${type}-table`);
			for (const width of [390, 320, 768]) {
				await page.setViewportSize({ width, height: 900 });
				await screenshot(page, `${theme}-${type}-${width}`);
				const wrap = table.locator("..");
				expect(await wrap.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
				const cells = table.locator("tbody td");
				expect(await cells.count()).toBeGreaterThan(0);
				for (const cell of await cells.all()) {
					const category = await cell.getAttribute("data-category");
					expect(category).toBeTruthy();
					const statement = await cell.locator("../th").innerText();
					const input = cell.locator("input");
					await expect(input).toHaveAccessibleName(`${statement}: ${category}`);
					const bounds = await input.boundingBox();
					if (!bounds) throw new Error("Answer control has no bounds");
					expect(bounds.x).toBeGreaterThanOrEqual(0);
					expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
					expect(
						await cell.evaluate((node) => node.getBoundingClientRect().height),
					).toBeGreaterThanOrEqual(44);
				}
				const axe = await analyzeAxe(
					page,
					new AxeBuilder({ page })
						.include(`.praxity-${type}-table-wrap`)
						.withRules(["scrollable-region-focusable"]),
				);
				expect(axe.violations).toEqual([]);
			}
		}
	});

	test(`${theme} matching placeholder fits with text spacing`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 900 });
		const row = await openBlock(page, theme, ".praxity-matching-row");
		await page.addStyleTag({
			content:
				"* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }",
		});
		for (const width of [390, 320, 720]) {
			await page.setViewportSize({ width, height: 900 });
			await screenshot(page, `${theme}-matching-${width}-textspacing`);
			const input = row.locator(".praxity-assessment-select-input");
			expect(
				await input.evaluate((node) => node.scrollWidth - node.clientWidth),
			).toBeLessThanOrEqual(0);
			expect(
				await input.evaluate((node: HTMLInputElement) => {
					const style = getComputedStyle(node);
					const probe = document.createElement("span");
					probe.textContent = node.value || node.placeholder;
					probe.style.cssText = `position:absolute;white-space:pre;font:${style.font};letter-spacing:${style.letterSpacing};word-spacing:${style.wordSpacing}`;
					document.body.append(probe);
					const fits =
						probe.getBoundingClientRect().width <=
						node.clientWidth -
							Number.parseFloat(style.paddingLeft) -
							Number.parseFloat(style.paddingRight);
					probe.remove();
					return fits;
				}),
			).toBe(true);
		}
	});

	test(`${theme} data table gives scroll cues and retains keyboard scrolling`, async ({ page }) => {
		for (const width of [390, 320]) {
			await page.setViewportSize({ width, height: 900 });
			const region = await openBlock(page, theme, ".praxity-table-scroll-region");
			await screenshot(page, `${theme}-datatable-${width}`);
			await expect(region).toHaveAttribute("role", "region");
			await expect(region).toHaveAttribute("tabindex", "0");
			// Windows headless Firefox resolves even a native `thin` scrollbar to `none`.
			// Check the published declaration and compare rendering with a native control.
			expect(
				await region.evaluate((node) => {
					const hasThinRule = (rules: CSSRuleList): boolean =>
						Array.from(rules).some((rule) => {
							if (
								rule instanceof CSSStyleRule &&
								rule.style.scrollbarWidth === "thin" &&
								node.matches(rule.selectorText)
							)
								return true;
							return "cssRules" in rule && hasThinRule((rule as CSSGroupingRule).cssRules);
						});
					return Array.from(document.styleSheets).some((sheet) => hasThinRule(sheet.cssRules));
				}),
			).toBe(true);
			const nativeWidth = await page.evaluate(() => {
				const probe = document.createElement("div");
				probe.style.scrollbarWidth = "thin";
				document.body.append(probe);
				const width = getComputedStyle(probe).scrollbarWidth;
				probe.remove();
				return width;
			});
			await expect(region).toHaveCSS("scrollbar-width", nativeWidth);
			expect(await region.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain(
				"gradient",
			);
			// Force a wide authored table to exercise the cue and native scroll path.
			await region.locator("table").evaluate((node) => {
				node.style.minWidth = "800px";
			});
			await region.focus();
			await expect(region).toBeFocused();
			await page.keyboard.press("ArrowRight", { delay: 150 });
			await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
			await screenshot(page, `${theme}-datatable-${width}-scrolled`);
		}
	});
}

test("French deck and inert baseline stack all four choices at phone and tablet widths", async ({
	page,
}) => {
	const urls = readTestEnv().frenchMatrixUrls;
	if (!urls?.length) throw new Error("Missing French matrix fixtures");
	for (const [index, url] of urls.entries()) {
		for (const small of index === 0 ? [false, true] : [false]) {
			await page.goto(`${url}${small ? "?minimal=1&praxity-small-preview=1" : ""}`);
			for (const width of [390, 320, 768]) {
				await page.setViewportSize({ width, height: 900 });
				const table = page.locator(".praxity-categorize-table");
				const island = table.locator('xpath=ancestor::*[@data-island="assessment"]');
				await island.scrollIntoViewIfNeeded();
				if (!small) await expect(island).toHaveAttribute("data-hydrated", "");
				await table.scrollIntoViewIfNeeded();
				await screenshot(
					page,
					`french-${index === 1 ? "deck" : small ? "baseline" : "page"}-categorize-${width}`,
				);
				if (process.env.COURSE_AUDIT_SCREENSHOTS)
					await island.screenshot({
						path: `${process.env.COURSE_AUDIT_SCREENSHOTS}/categorize-${index}-${small ? "preview" : "published"}-${width}-${test.info().project.name}.png`,
					});
				const statements = table.locator("tbody th");
				expect(await statements.count()).toBeGreaterThan(0);
				for (const statement of await statements.all()) {
					await expect(statement).toHaveCSS("border-inline-start-width", "0px");
					await expect(statement).toHaveCSS("border-inline-end-width", "0px");
				}
				for (const type of ["categorize", "matrix"]) {
					const wrap = page.locator(`.praxity-${type}-table-wrap`);
					expect(await wrap.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
					for (const cell of await wrap.locator("tbody td").all()) {
						expect(await cell.getAttribute("data-category")).toBeTruthy();
						const bounds = await cell.locator("input").boundingBox();
						if (!bounds) throw new Error("Answer control has no bounds");
						expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
					}
				}
			}
		}
	}
});
