import { expect, test } from "@playwright/test";
import { readTestEnv, waitForHydration } from "./helpers";

test.describe("section transitions", () => {
	test("navigation updates do not animate layout and scroll progress uses a transform", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.goto(`${readTestEnv().url}/design-navigation/preset-sidebar/navigation.html`);
		await waitForHydration(page);
		const toggle = page.locator("[data-sidebar-collapse]");
		await toggle.focus();
		await page.keyboard.press("Enter");
		expect(
			await page
				.locator(".praxity-layout-wrapper")
				.evaluate((element) => getComputedStyle(element).transitionProperty),
		).not.toContain("grid-template-columns");
		expect(
			await page.evaluate(() =>
				document
					.getAnimations()
					.some(
						(animation) =>
							animation.effect instanceof KeyframeEffect &&
							animation.effect.getKeyframes().some((frame) => "gridTemplateColumns" in frame),
					),
			),
		).toBe(false);
		await expect(page.locator("[data-sidebar-expand]")).toBeFocused();

		await page.goto(`${readTestEnv().url}/design-layout-bounded-motion/bounded-motion.html`);
		await waitForHydration(page);
		const tick = page.locator(".praxity-toc-bar").nth(1);
		await expect(tick).toBeVisible();
		expect(
			await tick.evaluate((element) => getComputedStyle(element).transitionProperty),
		).not.toContain("padding");
		await tick.focus();
		const before = await tick.boundingBox();
		const targetId = await tick.getAttribute("data-toc-target");
		await page.keyboard.press("Enter");
		await expect(page.locator(`[id="${targetId}"]`).getByRole("heading")).toBeFocused();
		expect(await tick.boundingBox()).toEqual(before);
		// Make the document scrollable without changing the progress owner.
		await page.locator("#main-content").evaluate((main) => {
			main.style.minHeight = "3000px";
		});
		await page.evaluate(() => {
			window.dispatchEvent(new Event("resize"));
			window.scrollTo({ top: 800, behavior: "instant" });
		});
		const fill = page.locator("[data-native-scroll-progress-fill]");
		await expect(fill).not.toHaveCSS("transform", "none");
		await expect
			.poll(() =>
				fill.evaluate((element) => Number(element.parentElement?.getAttribute("aria-valuenow"))),
			)
			.toBeGreaterThan(0);
		await expect
			.poll(() =>
				fill.evaluate((element) => Number(element.parentElement?.getAttribute("aria-valuenow"))),
			)
			.toBeLessThan(100);
		const state = await fill.evaluate((element) => {
			const progress = element.parentElement;
			const value = Number(progress?.getAttribute("aria-valuenow"));
			return {
				value,
				scale: new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
				width: (element as HTMLElement).style.width,
				properties: getComputedStyle(element).transitionProperty,
			};
		});
		expect(state.value).toBeGreaterThan(0);
		expect(state.value).toBeLessThan(100);
		expect(state.width).toBe("");
		expect(state.properties).toBe("transform");
		await expect
			.poll(async () =>
				fill.evaluate((element) => {
					// The TOC scroll and resize can schedule another progress update after state was read.
					const expected = window.scrollY / (document.documentElement.scrollHeight - innerHeight);
					const value = Number(element.parentElement?.getAttribute("aria-valuenow"));
					const scale = new DOMMatrixReadOnly(getComputedStyle(element).transform).a;
					return {
						valueMatchesScroll: value === Math.round(expected * 100),
						scaleMatchesScroll: Math.abs(scale - expected) < 0.005,
					};
				}),
			)
			.toEqual({ valueMatchesScroll: true, scaleMatchesScroll: true });
	});

	test("reduced motion suppresses loading, graphic rings and progress transitions", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto(`${readTestEnv().url}/design-layout-bounded-motion/bounded-motion.html`);
		await page.locator("#main-content").evaluate((main) => {
			main.insertAdjacentHTML(
				"beforeend",
				'<div class="praxity-block-loading" role="status">Loading…</div>',
			);
		});
		await expect(page.getByRole("status")).toHaveText("Loading…");
		expect(
			await page
				.getByRole("status")
				.evaluate((element) => element.getAnimations({ subtree: true }).length),
		).toBe(0);
		const dot = page.locator(".praxity-labeled-graphic-dot--next");
		await expect(dot).toBeVisible();
		expect(
			await dot.evaluate((element) =>
				Number.parseFloat(getComputedStyle(element).transitionDuration),
			),
		).toBeLessThanOrEqual(0.001);
		await expect
			.poll(async () => dot.evaluate((element) => element.getAnimations({ subtree: true }).length))
			.toBe(0);
		expect(
			await page
				.locator("[data-native-scroll-progress-fill]")
				.evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration)),
		).toBeLessThanOrEqual(0.001);
	});

	test("multi-section page renders every section visibly", async ({ page }) => {
		// All authored sections remain visible in the plain reading column.
		await page.goto(`${readTestEnv().url}/oneof-group/page-3.html`, {
			waitUntil: "domcontentloaded",
		});
		await waitForHydration(page);

		const sectionSelector = '[data-block-type="heading"][data-heading-level="2"]';
		const sections = page.locator(sectionSelector);
		expect(await sections.count()).toBeGreaterThan(1);

		const allSectionsHaveHeight = await page.evaluate((selector) => {
			const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
			return nodes.every((node) => node.getBoundingClientRect().height > 0);
		}, sectionSelector);
		expect(allSectionsHaveHeight, "all rendered sections should have non-zero height").toBe(true);

		await expect(page.locator(".praxity-section-divider, [data-section-palette]")).toHaveCount(0);
	});
});
