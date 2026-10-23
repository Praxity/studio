import { expect, test } from "@playwright/test";
import { readTestEnv } from "./helpers";

for (const [name, index, small] of [
	["published page", 0, false],
	["small preview", 0, true],
	["module deck", 1, false],
] as const) {
	test(`${name} keeps French assessment headers whole and gives them room`, async ({ page }) => {
		const url = readTestEnv().frenchMatrixUrls?.[index];
		if (!url) throw new Error("Missing French matrix fixture");
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(`${url}${small ? "?minimal=1&praxity-small-preview=1" : ""}`);
		for (const [type, rows] of [
			["categorize", 5],
			["matrix", 2],
		] as const) {
			const table = page.locator(`.praxity-${type}-table`);
			if (!small)
				await expect(table.locator('xpath=ancestor::*[@data-island="assessment"]')).toHaveAttribute(
					"data-hydrated",
					"",
				);
			await expect(table).toBeVisible();
			// Viewport width alone does not establish wide content in previews or decks.
			await table.evaluate((node) => {
				const assessment = node.closest<HTMLElement>(".praxity-block-assessment");
				if (!assessment) throw new Error("Missing assessment container");
				assessment.style.minWidth = "50rem";
			});
			await expect(table.locator("thead")).toHaveCSS("position", "static");
			await expect(table.locator('thead th[scope="col"]')).toHaveCount(5);
			await expect(table.locator('tbody th[scope="row"]')).toHaveCount(rows);
			await expect(async () => {
				await page.evaluate(async () => {
					await document.fonts.ready;
					await new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					);
				});
				const layout = await table.evaluate((element) => {
					const headers = [...element.querySelectorAll<HTMLTableCellElement>("thead th")].slice(1);
					const broken: string[] = [];
					const headerStyles: string[] = [];
					for (const header of headers) {
						const style = getComputedStyle(header);
						headerStyles.push(`${style.wordBreak}/${style.overflowWrap}/${style.hyphens}`);
						const available =
							header.clientWidth -
							Number.parseFloat(style.paddingLeft) -
							Number.parseFloat(style.paddingRight);
						const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
						while (walker.nextNode()) {
							const node = walker.currentNode;
							// Each range covers one full word, so wrapping at spaces is allowed.
							for (const match of (node.textContent ?? "").matchAll(/\S+/gu)) {
								const range = document.createRange();
								range.setStart(node, match.index);
								range.setEnd(node, match.index + match[0].length);
								const textStyle = getComputedStyle(node.parentElement ?? header);
								const probe = document.createElement("span");
								probe.textContent = match[0];
								probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${textStyle.font};letter-spacing:${textStyle.letterSpacing}`;
								header.append(probe);
								const wordWidth = probe.getBoundingClientRect().width;
								probe.remove();
								const rects = [...range.getClientRects()];
								if (
									!rects.length ||
									rects.some((rect) => Math.abs(rect.top - rects[0].top) > 1) ||
									wordWidth > available + 1
								)
									broken.push(match[0]);
							}
						}
					}
					const statement = element.querySelector("tbody th")?.getBoundingClientRect().width ?? 0;
					const controls = [...element.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
					return {
						broken,
						headerStyles,
						statementWidth: statement,
						statementShare: statement / element.getBoundingClientRect().width,
						controlCount: controls.length,
						targetSpacing: controls.every((input, index) => {
							const rect = input.getBoundingClientRect();
							if (Math.min(rect.width, rect.height) >= 24) return true;
							// WCAG 2.5.8 AA permits smaller targets when their 24px spacing circles do not overlap.
							return controls.every((other, otherIndex) => {
								if (index === otherIndex) return true;
								const peer = other.getBoundingClientRect();
								return (
									Math.hypot(
										(rect.left + rect.right - peer.left - peer.right) / 2,
										(rect.top + rect.bottom - peer.top - peer.bottom) / 2,
									) >= 24
								);
							});
						}),
					};
				});
				expect(layout.broken).toEqual([]);
				expect(layout.headerStyles).toEqual(Array(4).fill("normal/normal/none"));
				// Both tables reserve the existing 16rem statement measure at this wide setup.
				expect(layout.statementWidth).toBeGreaterThanOrEqual(256);
				expect(layout.statementShare).toBeLessThan(0.45);
				expect(layout.controlCount).toBe(rows * 4);
				expect(layout.targetSpacing).toBe(true);
			}).toPass({ timeout: 10_000 });
		}
		await page.evaluate(() => {
			document.documentElement.dir = "rtl";
		});
		const rtlColumns = await page.locator(".praxity-categorize-table").evaluate((element) => {
			const headers = element.querySelectorAll("thead th");
			return [headers[0].getBoundingClientRect().left, headers[4].getBoundingClientRect().left];
		});
		expect(rtlColumns[0]).toBeGreaterThan(rtlColumns[1]);
		await page.locator(".praxity-block-assessment").evaluateAll((nodes) => {
			for (const node of nodes) (node as HTMLElement).style.minWidth = "";
		});
		await page.evaluate(() => {
			document.documentElement.dir = "ltr";
		});
		// At reflow width, RTL answer rows stack and every control stays reachable.
		await page.setViewportSize({ width: 320, height: 900 });
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
		).toBeLessThanOrEqual(1);
		await page.evaluate(() => {
			document.documentElement.dir = "rtl";
		});
		for (const wrap of await page
			.locator(".praxity-categorize-table-wrap, .praxity-matrix-table-wrap")
			.all()) {
			expect(await wrap.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
			for (const input of await wrap.locator("input").all()) {
				const bounds = await input.boundingBox();
				if (!bounds) throw new Error("Missing RTL answer bounds");
				expect(bounds.x).toBeGreaterThanOrEqual(0);
				expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
			}
		}
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
		).toBeLessThanOrEqual(1);
	});
}
