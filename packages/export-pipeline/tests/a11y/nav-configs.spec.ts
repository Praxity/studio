import { expect, type Page, test } from "@playwright/test";
import {
	getNavPreset,
	NAV_ARCHETYPES,
	type NavArchetype,
	navArchetypeToLayoutClass,
} from "@praxity/grammar";
import { NAV_TOGGLES } from "./fixtures/lightweight-fixture";
import { readNavVariantUrl, waitForHydration } from "./helpers";

interface NavVariantExpectation {
	archetype: Exclude<NavArchetype, "custom">;
	name: string;
	layoutClass: string;
	outlineVisible: boolean;
	prevNextVisible: boolean;
	breadcrumbTopBarVisible?: boolean;
}

interface NavPageConfig {
	currentSlug: string;
	currentIndex: number;
	pageSlugs: string[];
}

/**
 * Derived from the fixture's own toggles, not restated here.
 *
 * The hand-written table this replaces claimed minimal shows prev/next and that
 * sidebar shows an outline, while the fixture turned the first off and the viewer
 * renders the second under a different class after hydration — four specs failed
 * for two years' worth of drift rather than any product defect.
 */
const NAV_VARIANTS: NavVariantExpectation[] = NAV_ARCHETYPES.filter(
	(archetype): archetype is Exclude<NavArchetype, "custom"> => archetype !== "custom",
).map((archetype) => {
	const toggles = NAV_TOGGLES[archetype as keyof typeof NAV_TOGGLES] ?? {};
	const resolved = { ...getNavPreset(archetype), ...toggles };
	return {
		archetype,
		name: archetype.toLowerCase(),
		layoutClass: navArchetypeToLayoutClass(archetype),
		outlineVisible: resolved.navOutline || resolved.navHamburgerMenu,
		prevNextVisible: resolved.navPrevNext || resolved.navEdgeArrows,
		breadcrumbTopBarVisible: resolved.navBreadcrumbs,
	};
});

async function visibleCount(page: Page, selector: string): Promise<number> {
	return page.locator(selector).evaluateAll(
		(elements) =>
			elements.filter((element) => {
				const style = window.getComputedStyle(element);
				if (style.display === "none" || style.visibility === "hidden") {
					return false;
				}
				const rect = (element as HTMLElement).getBoundingClientRect();
				return rect.width > 0 && rect.height > 0;
			}).length,
	);
}

async function readPageConfig(page: Page): Promise<NavPageConfig> {
	return page.evaluate(() => {
		const script = document.getElementById("praxity-config");
		if (!script?.textContent) {
			return { currentSlug: "", currentIndex: -1, pageSlugs: [] };
		}
		try {
			const parsed = JSON.parse(script.textContent) as {
				currentSlug?: string;
				pages?: Array<{ slug?: string }>;
			};
			const pageSlugs = Array.isArray(parsed.pages)
				? parsed.pages
						.map((entry) => (typeof entry.slug === "string" ? entry.slug : ""))
						.filter((slug) => slug.length > 0)
				: [];
			const currentSlug = typeof parsed.currentSlug === "string" ? parsed.currentSlug : "";
			return {
				currentSlug,
				currentIndex: pageSlugs.indexOf(currentSlug),
				pageSlugs,
			};
		} catch {
			return { currentSlug: "", currentIndex: -1, pageSlugs: [] };
		}
	});
}

async function enabledPrevCount(page: Page): Promise<number> {
	return page
		.locator(
			[
				"a.praxity-nav-prev[href]:visible",
				"a.praxity-slide-nav__arrow--prev[href]:visible",
				".praxity-page-nav button[aria-label*='Previous page']:not([disabled]):visible",
				".praxity-slide-nav button[aria-label*='Previous page']:not([disabled]):visible",
				".praxity-edge-arrow-nav button[aria-label*='Previous page']:not([disabled]):visible",
			].join(", "),
		)
		.count();
}

async function enabledNextCount(page: Page): Promise<number> {
	return page
		.locator(
			[
				"a.praxity-nav-next[href]:visible",
				"a.praxity-slide-nav__arrow--next[href]:visible",
				".praxity-page-nav button[aria-label*='Next page']:not([disabled]):visible",
				".praxity-slide-nav button[aria-label*='Next page']:not([disabled]):visible",
				".praxity-edge-arrow-nav button[aria-label*='Next page']:not([disabled]):visible",
			].join(", "),
		)
		.count();
}

test.describe("nav config variants", () => {
	test("sidebar typography stays stable across lightweight and assessment pages", async ({
		page,
	}) => {
		const baseUrl = readNavVariantUrl("sidebar");
		expect(baseUrl).toBeTruthy();
		const measurements = [];
		for (const slug of ["page-2", "page-3"]) {
			await page.goto(`${baseUrl}/${slug}.html`);
			await waitForHydration(page);
			measurements.push(
				await page
					.locator("[data-native-outline] a")
					.first()
					.evaluate((link) => {
						const bounds = link.getBoundingClientRect();
						return {
							bodyLineHeight: getComputedStyle(document.body).lineHeight,
							linkLineHeight: getComputedStyle(link).lineHeight,
							linkTop: bounds.top,
							linkHeight: bounds.height,
						};
					}),
			);
		}
		expect(measurements[1]).toEqual(measurements[0]);
	});

	test("sidebar links show focus for keyboard navigation without a pointer outline", async ({
		page,
	}) => {
		const baseUrl = readNavVariantUrl("sidebar");
		expect(baseUrl).toBeTruthy();
		await page.goto(`${baseUrl}/page-2.html`);
		await waitForHydration(page);
		// The current-page link stays put, so its pointer focus can be inspected.
		const link = page.locator('[data-native-outline] a[aria-current="page"]');
		await link.click();
		await expect(link).toHaveCSS("outline-style", "none");
		await page.keyboard.press("Tab");
		await link.focus();
		await expect(link).toBeFocused();
		await expect(link).toHaveCSS("outline-style", "solid");
	});

	for (const variant of NAV_VARIANTS) {
		test(`nav config ${variant.name}: layout + visible controls`, async ({ page }) => {
			const baseUrl = readNavVariantUrl(variant.name);
			expect(baseUrl, `Missing URL for nav variant '${variant.name}'`).toBeTruthy();
			if (!baseUrl) {
				return;
			}

			await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);

			await expect(page.locator("body")).toHaveClass(new RegExp(`\\b${variant.layoutClass}\\b`));

			// Count the SSR fallback, persistent sidebar, or drawer toggle that replaces it.
			// viewer-entry removes the fallback the moment it hydrates.
			const outlineVisibleCount = await visibleCount(
				page,
				".praxity-outline-fallback, .praxity-course-menu, .praxity-hamburger, .praxity-native-menu-toggle",
			);
			if (variant.outlineVisible) {
				expect(outlineVisibleCount, `${variant.name} should show outline nav`).toBeGreaterThan(0);
			} else {
				expect(outlineVisibleCount, `${variant.name} should hide outline nav`).toBe(0);
			}

			const pageNavVisibleCount = await visibleCount(
				page,
				[
					".praxity-page-nav-fallback",
					".praxity-page-nav",
					".praxity-slide-nav",
					".praxity-edge-arrow-nav",
				].join(", "),
			);
			if (variant.prevNextVisible) {
				expect(pageNavVisibleCount, `${variant.name} should show prev/next nav`).toBeGreaterThan(0);
			} else {
				expect(pageNavVisibleCount, `${variant.name} should hide prev/next nav`).toBe(0);
			}

			if (variant.breadcrumbTopBarVisible) {
				await expect(page.locator(".praxity-top-bar")).toBeVisible();
			}

			if (!variant.outlineVisible && !variant.prevNextVisible) {
				const visibleNavLandmarks = await visibleCount(page, "nav");
				expect(visibleNavLandmarks, `${variant.name} should have no visible nav landmarks`).toBe(0);
			}
		});

		test(`nav config ${variant.name}: first/last page prev-next boundaries`, async ({ page }) => {
			const baseUrl = readNavVariantUrl(variant.name);
			expect(baseUrl, `Missing URL for nav variant '${variant.name}'`).toBeTruthy();
			if (!baseUrl || !variant.prevNextVisible) {
				return;
			}

			await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);
			const pageConfig = await readPageConfig(page);
			const firstSlug = pageConfig.pageSlugs[0];
			const lastSlug = pageConfig.pageSlugs[pageConfig.pageSlugs.length - 1];
			expect(firstSlug, `${variant.name}: missing first page slug`).toBeTruthy();
			expect(lastSlug, `${variant.name}: missing last page slug`).toBeTruthy();
			if (!firstSlug || !lastSlug) {
				return;
			}

			await page.goto(`${baseUrl}/${firstSlug}.html?praxity-resume=0`, {
				waitUntil: "domcontentloaded",
			});
			await waitForHydration(page);
			expect(
				await enabledPrevCount(page),
				`${variant.name} first page should not have previous`,
			).toBe(0);
			expect(
				await enabledNextCount(page),
				`${variant.name} first page should have next`,
			).toBeGreaterThan(0);

			await page.goto(`${baseUrl}/${lastSlug}.html`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);
			expect(await enabledNextCount(page), `${variant.name} last page should not have next`).toBe(
				0,
			);
			expect(
				await enabledPrevCount(page),
				`${variant.name} last page should have previous`,
			).toBeGreaterThan(0);
		});
	}

	for (const [direction, reducedMotion] of [
		["ltr", "reduce"],
		["rtl", "reduce"],
		["ltr", "no-preference"],
		["rtl", "no-preference"],
	] as const) {
		test(`sidebar collapse preserves geometry and state across navigation and resize (${direction}, ${reducedMotion})`, async ({
			page,
		}) => {
			const baseUrl = readNavVariantUrl("sidebar");
			expect(baseUrl, "Missing sidebar fixture URL").toBeTruthy();
			if (!baseUrl) return;
			await page.setViewportSize({ width: 1200, height: 1000 });
			await page.emulateMedia({ reducedMotion });
			await page.addInitScript((dir) => {
				document.addEventListener("DOMContentLoaded", () => {
					document.documentElement.dir = dir;
				});
			}, direction);
			await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);
			const { pageSlugs } = await readPageConfig(page);
			expect(pageSlugs[0]).toBeTruthy();
			await page.goto(`${baseUrl}/${pageSlugs[0]}.html?praxity-resume=0`, {
				waitUntil: "domcontentloaded",
			});
			await waitForHydration(page);

			const outline = page.locator("[data-native-outline]");
			const collapse = page.locator("[data-sidebar-collapse]");
			const expand = page.locator("[data-sidebar-expand]");
			const main = page.locator("#main-content");
			await expect(collapse).toBeVisible();
			await expect(outline).not.toHaveAttribute("inert", "");
			const expandedLeft = await main.evaluate((element) => element.getBoundingClientRect().left);
			await page.locator(".praxity-native-page-nav").scrollIntoViewIfNeeded();
			for (const selector of [".praxity-top-bar", ".praxity-native-page-nav"]) {
				const bounds = await page.locator(selector).boundingBox();
				expect(bounds).not.toBeNull();
				expect(bounds?.y).toBeGreaterThanOrEqual(0);
				expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(1001);
			}
			await collapse.focus();
			await page.keyboard.press("Enter");
			await expect(expand).toBeFocused();
			await expect(expand).toHaveAttribute("aria-expanded", "false");
			await expect(outline).toHaveAttribute("inert", "");
			await expect(outline).toBeHidden();
			expect(await outline.boundingBox()).toBeNull();
			await expect
				.poll(async () => {
					const left = await main.evaluate((element) => element.getBoundingClientRect().left);
					return direction === "ltr" ? expandedLeft - left : left - expandedLeft;
				})
				.toBeGreaterThan(100);

			await page.locator(".praxity-native-page-nav .praxity-nav-next").press("Enter");
			await page.waitForURL(`${baseUrl}/${pageSlugs[1]}.html`);
			await waitForHydration(page);
			await page.reload({ waitUntil: "domcontentloaded" });
			await waitForHydration(page);
			await expect(outline).toBeHidden();
			await expect(outline).toHaveAttribute("inert", "");
			expect(await outline.boundingBox()).toBeNull();
			await expect(expand).toBeVisible();

			await page.setViewportSize({ width: 600, height: 1000 });
			const toggle = page.locator("[data-nav-menu-toggle]");
			await expect(toggle).toBeVisible();
			await toggle.press("Enter");
			await expect(outline).not.toHaveAttribute("inert", "");
			await expect(outline).toBeVisible();
			await expect(main).toHaveAttribute("inert", "");
			await page.keyboard.press("Escape");
			await expect(toggle).toBeFocused();
			await expect(main).not.toHaveAttribute("inert", "");
			await page.setViewportSize({ width: 1200, height: 1000 });
			await expect(outline).toBeHidden();
			expect(await outline.boundingBox()).toBeNull();
			await expand.press("Enter");
			await expect(collapse).toBeFocused();
			await expect(collapse).toHaveAttribute("aria-expanded", "true");
			await expect(outline).toBeVisible();
			await expect(outline).not.toHaveAttribute("inert", "");
			await expect(outline).toHaveCSS("width", "260px");
			await expect
				.poll(() => main.evaluate((element) => element.getBoundingClientRect().left))
				.toBeCloseTo(expandedLeft, 0);
		});
	}

	test("compact sidebar top bar fills the published layout", async ({ page }) => {
		const baseUrl = readNavVariantUrl("sidebar");
		expect(baseUrl, "Missing sidebar fixture URL").toBeTruthy();
		if (!baseUrl) return;

		await page.setViewportSize({ width: 600, height: 900 });
		await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		const layout = page.locator(".praxity-viewer-shell, .praxity-layout-wrapper").first();
		await expect(layout).toBeVisible();
		await expect(page.locator(".praxity-top-bar")).toBeVisible();

		const widths = await page.evaluate(() => ({
			layout: document
				.querySelector<HTMLElement>(".praxity-viewer-shell, .praxity-layout-wrapper")
				?.getBoundingClientRect().width,
			topBar: document.querySelector<HTMLElement>(".praxity-top-bar")?.getBoundingClientRect()
				.width,
		}));
		expect(widths.layout).toBeGreaterThan(0);
		expect(widths.topBar).toBeCloseTo(widths.layout ?? 0, 0);
	});

	test("native bottom-bar outline is an accessible desktop, RTL, and mobile drawer", async ({
		page,
	}) => {
		const baseUrl = readNavVariantUrl("bottombar");
		expect(baseUrl, "Missing bottom-bar fixture URL").toBeTruthy();
		if (!baseUrl) return;

		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		const outline = page.locator("[data-native-outline]");
		const toggle = page.locator("[data-nav-menu-toggle]");
		const main = page.locator("#main-content");
		const pageNav = page.locator(".praxity-page-nav-fallback");
		const readingTools = page.locator(".praxity-toolbar-tools [data-a11y-toolbar]");

		await expect(outline).toHaveAttribute("inert", "");
		await expect(toggle).toBeVisible();
		await expect(toggle).toHaveAttribute("aria-expanded", "false");
		await expect(readingTools).toHaveAttribute("role", "toolbar");
		await expect(pageNav).toHaveCSS("position", "sticky");
		const keyboardOwnership = await readingTools.evaluate((toolbar) => {
			const text = toolbar.querySelector<HTMLButtonElement>('[data-a11y-action="text"]');
			const focus = toolbar.querySelector<HTMLButtonElement>('[data-a11y-action="focus"]');
			const next = document.createElement("button");
			next.dataset.pageDirection = "next";
			let pageClicks = 0;
			next.addEventListener("click", () => {
				pageClicks++;
			});
			document.body.prepend(next);
			text?.focus();
			text?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
			);
			const focusMoved = document.activeElement === focus;
			const modifiers = ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const;
			for (const modifier of modifiers) {
				document.body.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "ArrowRight",
						[modifier]: true,
						bubbles: true,
						cancelable: true,
					}),
				);
			}
			const cancel = (event: KeyboardEvent) => event.preventDefault();
			document.body.addEventListener("keydown", cancel, { once: true });
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
			);
			next.remove();
			return { focusMoved, pageClicks };
		});
		expect(keyboardOwnership).toEqual({
			focusMoved: true,
			pageClicks: 0,
		});

		await page.evaluate(() => {
			document.documentElement.dir = "rtl";
		});
		await toggle.click();
		await expect(page.locator("body")).toHaveClass(/\bpraxity-nav-open\b/);
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
		await expect(outline).not.toHaveAttribute("inert", "");
		await expect(main).toHaveAttribute("inert", "");
		await expect(pageNav).toHaveAttribute("inert", "");
		await expect(outline.locator('[aria-current="page"]')).toBeFocused();
		await expect(outline).toHaveCSS("transform", /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
		const rtlEdge = await outline.evaluate((element) => element.getBoundingClientRect().right);
		expect(rtlEdge).toBeCloseTo(await page.evaluate(() => innerWidth), 0);
		await outline.locator('[aria-current="page"]').click();
		await expect(page.locator("body")).not.toHaveClass(/\bpraxity-nav-open\b/);
		await expect(toggle).toBeFocused();

		await toggle.click();
		await page.keyboard.press("Escape");
		await expect(toggle).toBeFocused();
		await expect(main).not.toHaveAttribute("inert", "");

		await page.setViewportSize({ width: 600, height: 900 });
		await page.evaluate(() => {
			document.documentElement.dir = "ltr";
		});
		await expect(toggle).toBeVisible();
		await toggle.click();
		await expect(outline).toBeVisible();
		await expect(main).toHaveAttribute("inert", "");
		await page.keyboard.press("Escape");
		await expect(toggle).toBeFocused();
	});

	test("native sidebar mirrors its persistent controls in RTL", async ({ page }) => {
		const baseUrl = readNavVariantUrl("sidebar");
		expect(baseUrl, "Missing sidebar fixture URL").toBeTruthy();
		if (!baseUrl) return;

		await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		await page.evaluate(() => {
			document.documentElement.dir = "rtl";
			return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		});
		const geometry = await page.evaluate(() => {
			const outline = document.querySelector<HTMLElement>("[data-native-outline]");
			const current = outline?.querySelector<HTMLElement>('[aria-current="page"]');
			const collapse = outline?.querySelector<HTMLElement>("[data-sidebar-collapse]");
			const outlineBox = outline?.getBoundingClientRect();
			const collapseBox = collapse?.getBoundingClientRect();
			return {
				outlineRight: outlineBox?.right ?? -1,
				viewportRight: innerWidth,
				collapseInset: collapse ? getComputedStyle(collapse).insetInlineEnd : "",
				collapseEdge: (collapseBox?.left ?? 0) - (outlineBox?.left ?? 0),
				activeBorder: current ? getComputedStyle(current).borderInlineStartWidth : "",
				chevronTransform: collapse?.querySelector("svg")
					? getComputedStyle(collapse.querySelector("svg") as SVGElement).transform
					: "none",
			};
		});

		expect(geometry.outlineRight).toBeCloseTo(geometry.viewportRight, 0);
		expect(geometry.collapseInset).toBe("12px");
		// The one-pixel inline-end sidebar border sits outside the authored inset.
		expect(geometry.collapseEdge).toBeCloseTo(13, 0);
		expect(Number.parseFloat(geometry.activeBorder)).toBeGreaterThanOrEqual(3);
		expect(geometry.chevronTransform).not.toBe("none");
	});

	test("native navigation remains stable and omits dead drawer controls without JavaScript", async ({
		browser,
	}) => {
		const baseUrl = readNavVariantUrl("bottombar");
		expect(baseUrl, "Missing bottom-bar fixture URL").toBeTruthy();
		if (!baseUrl) return;
		const context = await browser.newContext({
			javaScriptEnabled: false,
			viewport: { width: 600, height: 900 },
		});
		const noJsPage = await context.newPage();
		try {
			await noJsPage.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
			await expect(noJsPage.locator("html")).not.toHaveClass(/\bpraxity-js\b/);
			await expect(noJsPage.locator("[data-native-outline]")).toHaveCSS("position", "static");
			await expect(noJsPage.locator("[data-nav-menu-toggle]")).toHaveCSS("display", "none");
			await expect(noJsPage.locator("[data-nav-menu-close]")).toHaveCSS("display", "none");
			await expect(noJsPage.locator(".praxity-mobile-top-bar")).toHaveCount(0);
			await expect(noJsPage.locator(".praxity-native-page-nav")).toHaveCSS("display", "block");
			await expect(noJsPage.locator(".praxity-native-page-nav")).toHaveCSS("padding", "0px");
			await expect(noJsPage.locator(".praxity-a11y-pill")).toHaveCSS("display", "none");

			await noJsPage.setViewportSize({ width: 1024, height: 768 });
			await noJsPage.goto(`${readNavVariantUrl("sidebar")}/page-2.html`, {
				waitUntil: "domcontentloaded",
			});
			await expect(noJsPage.locator(".praxity-sidebar-collapse")).toHaveCSS("display", "none");
			await expect(noJsPage.locator(".praxity-sidebar-expand")).toHaveCSS("display", "none");
			await expect(noJsPage.locator(".praxity-a11y-pill")).toHaveCSS("display", "none");
			await expect(noJsPage.locator("[data-native-outline] a").first()).toBeVisible();
		} finally {
			await context.close();
		}
	});

	for (const failedRuntime of ["loader", "nav"] as const) {
		test(`a failed ${failedRuntime} restores a previously collapsed sidebar`, async ({ page }) => {
			const baseUrl = readNavVariantUrl("sidebar");
			expect(baseUrl, "Missing sidebar fixture URL").toBeTruthy();
			if (!baseUrl) return;
			await page.setViewportSize({ width: 1200, height: 1000 });
			const response = await page.request.get(`${baseUrl}/page-two-interactive.html`);
			const shellConfig = (await response.text()).match(
				/<script id="praxity-shell-config" type="application\/json">([\s\S]*?)<\/script>/,
			);
			expect(shellConfig?.[1]).toBeTruthy();
			const { sidebarPreferenceKey } = JSON.parse(shellConfig?.[1] ?? "{}") as {
				sidebarPreferenceKey: string;
			};
			expect(sidebarPreferenceKey).toBeTruthy();
			await page.addInitScript(
				(key) => localStorage.setItem(key, "collapsed"),
				sidebarPreferenceKey,
			);
			await page.route(new RegExp(`island-${failedRuntime}[^/]*\\.js(?:\\?.*)?$`), (route) =>
				route.abort(),
			);
			await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("html")).not.toHaveClass(/(?:^|\s)praxity-js(?:\s|$)/);
			await expect(page.locator("body")).not.toHaveClass(/\bpraxity-sidebar-collapsed\b/);
			const outline = page.locator("[data-native-outline]");
			await expect(outline).toBeVisible();
			await expect(outline).not.toHaveAttribute("inert", "");
			await expect(outline.locator("a").first()).toBeVisible();
			await expect(page.locator("[data-sidebar-collapse]")).toBeHidden();
			await expect(page.locator("[data-sidebar-expand]")).toBeHidden();
			await expect(page.locator("[data-nav-menu-toggle]")).toBeHidden();
		});
	}

	test("a failed navigation island restores static navigation while shell controls remain available", async ({
		page,
	}) => {
		const baseUrl = readNavVariantUrl("bottombar");
		expect(baseUrl, "Missing bottom-bar fixture URL").toBeTruthy();
		if (!baseUrl) return;
		await page.route(/island-nav[^/]*\.js(?:\?.*)?$/, (route) => route.abort());

		await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
		await page.waitForFunction(() => !document.documentElement.classList.contains("praxity-js"));
		await expect(page.locator("[data-native-outline]")).toBeVisible();
		await expect(page.locator("[data-nav-menu-toggle]")).toHaveCSS("display", "none");
		await expect(page.locator("[data-nav-menu-close]")).toHaveCSS("display", "none");
		await expect(page.locator(".praxity-a11y-pill")).toHaveCSS("display", "flex");
		await page.getByRole("button", { name: "Larger text" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-praxity-text-size", "large");
		await expect(page.locator(".praxity-native-page-nav")).toHaveCSS("display", "block");
		await expect(page.locator(".praxity-native-page-nav")).toHaveCSS("padding", "0px");
	});
});
