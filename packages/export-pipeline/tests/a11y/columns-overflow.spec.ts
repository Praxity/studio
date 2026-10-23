import { expect, type Page, test } from "@playwright/test";
import { findPageWithSelector, getCoursePages, readTestEnv, waitForHydration } from "./helpers";

async function horizontalScrollReport(page: Page) {
	return page.evaluate(() => {
		const doc = document.documentElement;
		const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
			.filter((element) => {
				const style = getComputedStyle(element);
				if (style.display === "none" || style.visibility === "hidden") return false;
				const rect = element.getBoundingClientRect();
				return rect.width > 0 && (rect.right > doc.clientWidth + 1 || rect.left < -1);
			})
			.slice(0, 8)
			.map((element) => {
				const rect = element.getBoundingClientRect();
				const tabs = element.closest<HTMLElement>(".mantine-Tabs-list, .praxity-tabs-list");
				const tabsRect = tabs?.getBoundingClientRect();
				const tabsDetails = tabs
					? ` tabs=${getComputedStyle(tabs).overflowX}/${tabs.clientWidth}/${tabs.scrollWidth}/${tabsRect?.left.toFixed(1)}-${tabsRect?.right.toFixed(1)}`
					: "";
				return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${Array.from(
					element.classList,
				)
					.slice(0, 2)
					.map((name) => `.${name}`)
					.join("")} [${rect.left.toFixed(1)}, ${rect.right.toFixed(1)}]${tabsDetails}`;
			});
		return {
			hasScroll: doc.scrollWidth > doc.clientWidth + 1,
			clientWidth: doc.clientWidth,
			scrollWidth: doc.scrollWidth,
			offenders,
		};
	});
}

test.describe("columns responsive layout", () => {
	test("columns stack on narrow screens and remain side-by-side on wide screens without overflow", async ({
		page,
	}) => {
		const env = readTestEnv();
		const pages = await getCoursePages(page, env.url);
		const columnsPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='columns'] .praxity-column",
		);
		if (!columnsPage) throw new Error("No columns block found in fixture");

		await page.setViewportSize({ width: 1200, height: 900 });

		const columns = page.locator("[data-block-type='columns'] .praxity-column");
		const columnCount = await columns.count();
		expect(columnCount).toBeGreaterThan(1);

		const wideOverflow = await horizontalScrollReport(page);
		expect(wideOverflow.hasScroll, JSON.stringify(wideOverflow)).toBe(false);

		const wideGeometry = await page.evaluate(() => {
			const nodes = Array.from(
				document.querySelectorAll<HTMLElement>("[data-block-type='columns'] .praxity-column"),
			).slice(0, 2);
			if (nodes.length < 2) return null;
			const [a, b] = nodes.map((node) => node.getBoundingClientRect());
			return { topDiff: Math.abs(a.top - b.top), leftDiff: Math.abs(a.left - b.left) };
		});
		expect(wideGeometry).not.toBeNull();
		if (!wideGeometry) return;
		expect(wideGeometry.topDiff, "wide viewport should keep columns on the same row").toBeLessThan(
			20,
		);
		expect(wideGeometry.leftDiff, "wide viewport columns should be side-by-side").toBeGreaterThan(
			20,
		);

		await page.setViewportSize({ width: 375, height: 812 });
		await page.reload({ waitUntil: "domcontentloaded" });
		await waitForHydration(page);

		const narrowOverflow = await horizontalScrollReport(page);
		expect(narrowOverflow.hasScroll, JSON.stringify(narrowOverflow)).toBe(false);

		const narrowGeometry = await page.evaluate(() => {
			const nodes = Array.from(
				document.querySelectorAll<HTMLElement>("[data-block-type='columns'] .praxity-column"),
			).slice(0, 2);
			if (nodes.length < 2) return null;
			const [a, b] = nodes.map((node) => node.getBoundingClientRect());
			return { topDiff: Math.abs(a.top - b.top), leftDiff: Math.abs(a.left - b.left) };
		});
		expect(narrowGeometry).not.toBeNull();
		if (!narrowGeometry) return;
		expect(
			narrowGeometry.topDiff,
			"narrow viewport should stack columns vertically",
		).toBeGreaterThan(20);
		expect(
			narrowGeometry.leftDiff,
			"stacked columns should align to similar x-position",
		).toBeLessThan(20);
	});
});
