import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { analyzeAxe, readSlidesNarrationUrl, waitForHydration } from "./helpers";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const SLIDE_SLUGS = ["accessible-slide-course", "narrated-slide", "knowledge-check"];

test.describe("slides course published-output accessibility", () => {
	test("has zero axe violations across slides, narration controls, and the outline drawer", async ({
		page,
	}) => {
		const baseUrl = readSlidesNarrationUrl();
		expect(baseUrl, "Missing slides+narration fixture URL").toBeTruthy();
		if (!baseUrl) return;

		for (const [index, slug] of SLIDE_SLUGS.entries()) {
			await page.goto(`${baseUrl}/${slug}.html`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);
			await expect(page.locator("body")).toHaveClass(/\bpraxity-layout-slides\b/);
			await expect(page.locator("#main-content > .praxity-slide")).toBeVisible();
			await expect(page.locator('.praxity-slide-counter [aria-hidden="true"]')).toHaveText(
				`${index + 1} / 3`,
			);

			if (slug === "narrated-slide") {
				const listen = page.getByRole("button", { name: "Listen", exact: true });
				await expect(
					page.locator("#praxity-a11y-preferences .praxity-narration-toggle"),
				).toHaveCount(1);
				await expect(listen).toHaveAttribute("aria-expanded", "false");
				await expect(page.locator(".praxity-narration-controls")).toHaveCount(0);
				await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveCount(0);
				await listen.click();
				const narration = page.locator(".praxity-narration-controls");
				await expect(narration).toBeVisible();
				await expect(narration.getByRole("status")).toHaveCount(0);
				await expect(narration.getByRole("button", { name: "Captions" })).toHaveCount(0);
				await expect(narration.getByRole("button", { name: "Transcript" })).toHaveCount(0);
			}

			const results = await analyzeAxe(page, new AxeBuilder({ page }).withTags(AXE_TAGS));
			expect(
				results.violations,
				`${slug} axe violations: ${results.violations.map((violation) => violation.id).join(", ")}`,
			).toEqual([]);
		}

		await page.goto(`${baseUrl}/${SLIDE_SLUGS[0]}.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		const hamburger = page.locator("button.praxity-hamburger");
		await hamburger.click();
		await expect(page.locator("[data-native-outline][data-nav-drawer]")).toBeVisible();
		await expect(hamburger).toHaveCSS("display", "none");
		await page.keyboard.press("Shift+Tab");
		await expect(hamburger).not.toBeFocused();
		const drawerResults = await analyzeAxe(page, new AxeBuilder({ page }).withTags(AXE_TAGS));
		expect(
			drawerResults.violations,
			`open outline axe violations: ${drawerResults.violations
				.map((violation) => violation.id)
				.join(", ")}`,
		).toEqual([]);
	});

	test("mirrors slide navigation and its outline drawer in RTL", async ({ page }) => {
		const baseUrl = readSlidesNarrationUrl();
		expect(baseUrl, "Missing slides+narration fixture URL").toBeTruthy();
		if (!baseUrl) return;

		await page.goto(`${baseUrl}/${SLIDE_SLUGS[1]}.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		await page.evaluate(() => {
			document.documentElement.dir = "rtl";
			return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		});
		const hamburger = page.locator("button.praxity-hamburger");
		const hamburgerRight = await hamburger.evaluate(
			(element) => element.getBoundingClientRect().right,
		);
		expect(hamburgerRight).toBeCloseTo((await page.evaluate(() => innerWidth)) - 20, 0);

		await hamburger.click();
		const drawer = page.locator("[data-native-outline][data-nav-drawer]");
		await expect(drawer).toBeVisible();
		await expect(drawer).toHaveCSS("transform", /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
		const drawerGeometry = await drawer.evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				right: element.getBoundingClientRect().right,
				borderInlineEndWidth: style.borderInlineEndWidth,
			};
		});
		expect(drawerGeometry.right).toBeCloseTo(await page.evaluate(() => innerWidth), 0);
		expect(Number.parseFloat(drawerGeometry.borderInlineEndWidth)).toBeGreaterThanOrEqual(1);
		await expect(page.locator(".praxity-slide-nav__arrow--prev span")).not.toHaveCSS(
			"transform",
			"none",
		);
	});

	test("keeps the mobile controls in view and highlights only during playback", async ({
		page,
	}) => {
		const baseUrl = readSlidesNarrationUrl();
		expect(baseUrl, "Missing slides+narration fixture URL").toBeTruthy();
		if (!baseUrl) return;

		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto(`${baseUrl}/narrated-slide.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		const listen = page.getByRole("button", { name: "Listen", exact: true });
		await expect(listen).toBeVisible();
		await expect(page.locator("[data-narration-active]")).toHaveCount(0);
		await listen.click();
		const narration = page.locator(".praxity-narration-controls");
		await expect(narration).toBeVisible();

		const bounds = await narration.boundingBox();
		expect(bounds, "narration controls should have measurable bounds").not.toBeNull();
		if (bounds) {
			expect(bounds.x).toBeGreaterThanOrEqual(0);
			expect(bounds.y).toBeGreaterThanOrEqual(0);
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
			expect(bounds.y + bounds.height).toBeLessThanOrEqual(667);
		}
		await narration.getByRole("button", { name: "Narration options", exact: true }).click();
		for (const name of ["Play", "Previous sentence", "Next sentence", "Follow narration"]) {
			await expect(narration.getByRole("button", { name, exact: true }).locator("svg")).toHaveCount(
				1,
			);
		}
		expect(
			await page.evaluate(() =>
				Boolean(
					(CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.has(
						"praxity-narration-current",
					),
				),
			),
		).toBe(false);

		await narration.getByRole("button", { name: "Play", exact: true }).click();
		await expect(narration.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						document.querySelectorAll("[data-narration-active]").length +
						Number(
							(CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.has(
								"praxity-narration-current",
							) ?? false,
						),
				),
			)
			.toBeGreaterThan(0);

		await page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				),
		);
		await page
			.locator("#main-content")
			.evaluate((element) => element.dispatchEvent(new Event("scroll")));
		const follow = narration.getByRole("button", { name: "Follow narration", exact: true });
		// Programmatic scroll alone must not pause speech or change the preference.
		await expect(narration.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
		await expect(follow).toHaveAttribute("aria-pressed", "true");
		await page.locator("#main-content").evaluate((element) => {
			element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
			element.dispatchEvent(new Event("scroll"));
		});
		await expect(narration.getByRole("button", { name: "Play", exact: true })).toBeVisible();
		await expect(follow).toHaveAttribute("aria-pressed", "true");
		await expect(narration.getByRole("button")).toHaveCount(6);
		await narration.getByRole("button", { name: "Play", exact: true }).click();
		await expect(narration.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
		await expect(follow).toHaveAttribute("aria-pressed", "true");
		await narration.getByRole("button", { name: "Pause", exact: true }).click();
		await expect(page.locator("[data-narration-active]")).toHaveCount(0);
		expect(
			await page.evaluate(() =>
				Boolean(
					(CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.has(
						"praxity-narration-current",
					),
				),
			),
		).toBe(false);
	});
});
