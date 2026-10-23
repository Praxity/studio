import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { getNavPreset, NAV_ARCHETYPES, type NavArchetype } from "@praxity/grammar";
import { NAV_TOGGLES } from "./fixtures/lightweight-fixture";
import {
	analyzeAxe,
	getCoursePages,
	readNavVariantUrl,
	readTestEnv,
	waitForHydration,
} from "./helpers";

interface NavA11yExpectation {
	archetype: Exclude<NavArchetype, "custom">;
	name: string;
	hasVisibleNav: boolean;
	hasPrevNext: boolean;
}

/**
 * Derived from the fixture's toggles rather than restated.
 *
 * The table this replaces expected a visible nav landmark for every archetype but
 * `none` — including `minimal`, whose whole point is that it hides the outline and
 * prev/next. Only the outline and prev/next render as `<nav>`; edge arrows and the
 * hamburger are buttons, so they do not add a landmark.
 */
const NAV_VARIANTS: NavA11yExpectation[] = NAV_ARCHETYPES.filter(
	(archetype): archetype is Exclude<NavArchetype, "custom"> => archetype !== "custom",
).map((archetype) => {
	// What the learner actually gets: the archetype's preset, with the fixture's
	// overrides on top — the same merge the viewer performs.
	const effective = {
		...getNavPreset(archetype),
		...(NAV_TOGGLES[archetype as keyof typeof NAV_TOGGLES] ?? {}),
	} as Record<string, unknown>;
	const hasOutline = effective.navOutline === true || effective.navHamburgerMenu === true;
	const hasPrevNext = effective.navPrevNext === true;
	return {
		archetype,
		name: archetype.toLowerCase(),
		// Only the outline, prev/next and the slides layout's own slide-nav render as
		// `<nav>`. Edge arrows, the hamburger and the progress dots are buttons, so
		// they navigate without adding a landmark — which is why `minimal` correctly
		// exposes none.
		hasVisibleNav: hasOutline || hasPrevNext || archetype === "slides",
		hasPrevNext: hasPrevNext || effective.navEdgeArrows === true,
	};
});

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

// Windows WebKit exclusions: native link Tab traversal in sidebar, bottombar,
// slides, scroll and embedded. Skip-link activation remains covered elsewhere.
const WINDOWS_WEBKIT_LINK_TRAVERSAL = ["sidebar", "bottombar", "slides", "scroll", "embedded"];

test.describe("outline visit status", () => {
	for (const locale of ["en", "fr"] as const) {
		for (const nested of [false, true]) {
			const french = locale === "fr";
			const route = `visited-status-${locale}-${nested ? "modules" : "flat"}`;
			const activityTitle = french ? "Vérifiez votre compréhension" : "Check your understanding";
			const visitedName = `${activityTitle}, ${french ? "Consultée" : "Visited"}`;
			const moduleName = french ? "Module de pratique, Consulté" : "Practice module, Visited";
			// Chromium may add a space at the hidden marker's boundary; the text itself has none.
			// These names are plain words, so they need no regex escaping.
			const spokenAs = (name: string) => new RegExp(`^${name.replace(", ", " ?, ")}$`);
			test(`${route}: unanswered, wrong, retry and right retain visit meaning on HTML return`, async ({
				page,
			}) => {
				const baseUrl = `${readTestEnv().url}/${route}`;
				await page.goto(`${baseUrl}/index.html`);
				await waitForHydration(page);
				const outline = page.locator("#course-nav-sidebar");
				const activityLink = outline.locator('a[data-page-id="stable-page-1"]');
				await expect(activityLink).toHaveAccessibleName(activityTitle);
				const activityHref = await activityLink.getAttribute("href");
				await activityLink.focus();
				await page.keyboard.press("Enter");
				await waitForHydration(page);
				await expect(activityLink).toHaveAccessibleName(spokenAs(visitedName));
				expect(await activityLink.textContent()).toBe(visitedName);
				await expect(activityLink).toHaveAttribute("aria-current", "page");
				await expect(activityLink).toHaveAttribute("href", activityHref ?? "");
				const question = page.locator("[data-assessment-display][data-block-id]");
				await expect(question).toBeVisible();
				await expect(question.getByRole("radio", { checked: true })).toHaveCount(0);
				await expect(question.getByRole("radiogroup")).toHaveAttribute("aria-required", "true");
				if (nested)
					await expect(outline.locator("a[data-module-pages]").first()).toHaveAccessibleName(
						spokenAs(moduleName),
					);
				else
					await expect(outline.locator('a[data-page-id="stable-page-2"]')).toHaveAccessibleName(
						french ? "Lectures complémentaires" : "Further reading",
					);
				await question
					.getByRole("radio", { name: french ? "Mauvaise réponse" : "Wrong answer", exact: true })
					.check();
				await question.locator('[data-assessment-submit="true"]').click();
				await expect(question).toHaveAttribute("data-passed", "false");
				await expect(activityLink).toHaveAccessibleName(spokenAs(visitedName));
				await question
					.getByRole("button", { name: french ? "Réessayer" : "Try again", exact: true })
					.click();
				await expect(activityLink).toHaveAccessibleName(spokenAs(visitedName));
				await question
					.getByRole("radio", { name: french ? "Bonne réponse" : "Correct answer", exact: true })
					.check();
				await question.locator('[data-assessment-submit="true"]').click();
				await expect(question).toHaveAttribute("data-passed", "true");
				await expect(activityLink).toHaveAccessibleName(spokenAs(visitedName));
				await page.goto(`${baseUrl}/index.html`);
				await waitForHydration(page);
				await expect(activityLink).toHaveAccessibleName(spokenAs(visitedName));
				await expect(activityLink).toHaveAttribute("aria-current", "page");
				await expect(outline.locator('a[data-page-id="stable-page-0"]')).not.toHaveAttribute(
					"aria-current",
				);
				if (nested)
					await expect(outline.locator("a[data-module-pages]").first()).toHaveAccessibleName(
						spokenAs(moduleName),
					);
				await test.info().attach("hydrated-landmarks", {
					body: JSON.stringify(
						await page
							.locator('main, nav, header, footer, [role="region"]')
							.evaluateAll((elements) =>
								elements.map((element) => ({
									tag: element.tagName,
									role: element.getAttribute("role"),
									name: element.getAttribute("aria-label"),
								})),
							),
						null,
						2,
					),
					contentType: "application/json",
				});
			});

			test(`${route}: legacy slug visits retain page and module names`, async ({ page }) => {
				const baseUrl = `${readTestEnv().url}/${route}`;
				await page.goto(`${baseUrl}/index.html`);
				await waitForHydration(page);
				await page.evaluate(() => {
					const config = JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}");
					const key = `praxity:${encodeURIComponent(config.courseId)}:default:state`;
					const state = JSON.parse(localStorage.getItem(key) ?? "{}");
					state.visitedPageIds = [
						config.pageIdMap["stable-page-0"],
						config.pageIdMap["stable-page-1"],
					];
					localStorage.setItem(key, JSON.stringify(state));
				});
				await page.reload();
				await waitForHydration(page);
				const outline = page.locator("#course-nav-sidebar");
				await expect(outline.locator('a[data-page-id="stable-page-1"]')).toHaveAccessibleName(
					spokenAs(visitedName),
				);
				if (nested)
					await expect(outline.locator("a[data-module-pages]").first()).toHaveAccessibleName(
						spokenAs(moduleName),
					);
			});
		}
	}
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

function prevNavControl(page: Page): Locator {
	return page
		.getByRole("button", { name: /previous/i })
		.or(page.getByRole("link", { name: /previous/i }))
		.first();
}

function nextNavControl(page: Page): Locator {
	return page
		.getByRole("button", { name: /next/i })
		.or(page.getByRole("link", { name: /next/i }))
		.first();
}

async function pressTabUntilFocused(page: Page, locator: Locator): Promise<boolean> {
	for (let i = 0; i < 50; i++) {
		const focused = await locator
			.evaluate((element) => element === document.activeElement)
			.catch(() => false);
		if (focused) {
			return true;
		}
		await page.keyboard.press("Tab");
	}
	return false;
}

async function assertNavAxe(page: Page, variantName: string): Promise<void> {
	const results = await analyzeAxe(page, new AxeBuilder({ page }).withTags(AXE_TAGS));
	const unexpected = results.violations.map((violation) => violation.id);
	expect(unexpected, `${variantName} has unexpected axe violations`).toEqual([]);
}

test.describe("nav a11y variants", () => {
	for (const variant of NAV_VARIANTS) {
		test(`nav a11y ${variant.name}: axe + landmarks`, async ({ page }) => {
			const baseUrl = readNavVariantUrl(variant.name);
			expect(baseUrl, `Missing URL for nav variant '${variant.name}'`).toBeTruthy();
			if (!baseUrl) {
				return;
			}

			await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);

			await assertNavAxe(page, variant.name);
			await expect(page.locator('[role="main"], main')).toHaveCount(1);

			const visibleNavLandmarks = await visibleCount(page, "nav");
			if (variant.hasVisibleNav) {
				expect(
					visibleNavLandmarks,
					`${variant.name} should expose visible nav landmark(s)`,
				).toBeGreaterThan(0);
			} else {
				expect(
					visibleNavLandmarks,
					`${variant.name} should not expose visible nav landmark(s)`,
				).toBe(0);
			}
		});

		test(`nav a11y ${variant.name}: skip link + keyboard nav`, async ({ page, browserName }) => {
			test.skip(
				process.platform === "win32" &&
					browserName === "webkit" &&
					WINDOWS_WEBKIT_LINK_TRAVERSAL.includes(variant.name),
				"Windows WebKit skips native links with both Tab and Alt+Tab.",
			);
			const tab = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
			const baseUrl = readNavVariantUrl(variant.name);
			expect(baseUrl, `Missing URL for nav variant '${variant.name}'`).toBeTruthy();
			if (!baseUrl) {
				return;
			}

			await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);

			const skipLink = page.locator('a[href="#main-content"]').first();
			await expect(skipLink, `${variant.name} should expose a skip-to-content link`).toHaveCount(1);
			const skipTarget = await skipLink.getAttribute("href");
			expect(skipTarget).toBe("#main-content");
			const targetId = skipTarget?.slice(1) ?? "";
			expect(
				await page.evaluate((id) => document.getElementById(id) !== null, targetId),
				`${variant.name} skip link target should exist`,
			).toBe(true);
			await skipLink.focus();
			await page.keyboard.press("Enter");
			await page.waitForFunction((id) => {
				const target = document.getElementById(id);
				const active = document.activeElement;
				return active === target || (active?.tagName === "H1" && Boolean(target?.contains(active)));
			}, targetId);

			if (!variant.hasPrevNext) {
				expect(await visibleCount(page, "button[aria-label*='page'], a[aria-label*='page']")).toBe(
					0,
				);
				return;
			}

			const prev = prevNavControl(page);
			const next = nextNavControl(page);
			await expect(prev).toBeVisible();
			await expect(next).toBeVisible();
			await expect(prev).toHaveAttribute("aria-label", /previous/i);
			await expect(next).toHaveAttribute("aria-label", /next/i);

			if (browserName !== "webkit") {
				await page.keyboard.press("Home");
				const tabReachedNext = await pressTabUntilFocused(page, next);
				expect(tabReachedNext, `${variant.name}: Tab should reach next-page control`).toBe(true);
			} else {
				await next.focus();
				await page.keyboard.press(`Shift+${tab}`);
				await page.keyboard.press(tab);
				await expect(next).toBeFocused();
			}

			const beforePath = new URL(page.url()).pathname;
			const pages = await getCoursePages(page, baseUrl);
			const currentIndex = pages.findIndex(({ slug }) => beforePath.endsWith(`/${slug}.html`));
			expect(
				currentIndex,
				`${variant.name}: current page must be in the fixture`,
			).toBeGreaterThanOrEqual(0);
			const nextSlug = pages[currentIndex + 1]?.slug;
			expect(nextSlug, `${variant.name}: expected a next page`).toBeTruthy();
			const destination = `${baseUrl}/${nextSlug}.html`;
			await Promise.all([
				page.waitForURL(destination, { waitUntil: "domcontentloaded" }),
				page.keyboard.press("Enter"),
			]);
			await waitForHydration(page);
			const afterPath = new URL(page.url()).pathname;
			expect(afterPath).not.toBe(beforePath);
			expect(afterPath.endsWith(".html")).toBe(true);
			await expect(page.locator("#main-content h1").first()).toBeFocused();

			const focusInsideNav = await page.evaluate(() => {
				const active = document.activeElement;
				return active instanceof HTMLElement ? active.closest("nav") !== null : false;
			});
			expect(focusInsideNav, `${variant.name}: focus should not remain trapped inside nav`).toBe(
				false,
			);
		});
	}
});

// Records every non-empty text the shared live region receives in each document.
async function recordLiveWrites(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const writes: string[] = [];
		Object.assign(window, { praxityLiveWrites: writes });
		new MutationObserver((records) => {
			for (const record of records) {
				const node = record.target instanceof Element ? record.target : record.target.parentElement;
				const region = node?.closest("#praxity-live-region");
				if (region?.textContent) writes.push(region.textContent);
			}
		}).observe(document, { childList: true, characterData: true, subtree: true });
	});
}

async function liveWrites(page: Page): Promise<string[]> {
	// Arrival writes ran in an animation frame after hydration; wait well past it.
	await page.waitForTimeout(500);
	return page.evaluate(
		() => (window as unknown as { praxityLiveWrites: string[] }).praxityLiveWrites,
	);
}

async function activate(page: Page, selector: string): Promise<void> {
	const control = page.locator(selector);
	const href = await control.getAttribute("href");
	if (!href) throw new Error(`Missing destination for ${selector}`);
	const destination = new URL(href, page.url()).href;
	await control.focus();
	await Promise.all([page.waitForURL(destination), control.press("Enter")]);
	await waitForHydration(page);
}

test.describe("Pages arrival orientation", () => {
	for (const locale of ["en", "fr"] as const) {
		const french = locale === "fr";
		const titles = french
			? ["Bienvenue", "Ajouter une image", "Étapes suivantes"]
			: ["Welcome", "Add an image", "Next steps"];
		const position = (current: number) =>
			french ? `Page ${current} sur 3` : `Page ${current} of 3`;
		const base = () => `${readTestEnv().url}/pages-arrival-${locale}`;

		async function expectCounter(page: Page, current: number): Promise<void> {
			const counter = page.locator(".praxity-slide-counter");
			// Each page is a full document, so its counter is static text, not a status.
			await expect(counter).not.toHaveAttribute("role", /./);
			await expect(counter).not.toHaveAttribute("aria-live", /./);
			await expect(counter).not.toHaveAttribute("aria-label", /./);
			await expect(counter.locator('[aria-hidden="true"]')).toHaveText(`${current} / 3`);
			await expect(counter.locator('[aria-hidden="true"]')).toBeVisible();
			await expect(counter).toMatchAriaSnapshot(`- text: ${position(current)}`);
		}

		test(`${locale} Next, Previous and Back focus the heading without a live message`, async ({
			page,
		}) => {
			await recordLiveWrites(page);
			await page.goto(`${base()}/index.html`);
			await page.waitForURL((url) => !url.pathname.endsWith("/index.html"));
			await waitForHydration(page);
			const heading = page.locator("#main-content h1").first();
			await expect(heading).toHaveText(titles[0]);
			await expectCounter(page, 1);
			expect(await liveWrites(page)).toEqual([]);

			await activate(page, "a.praxity-slide-nav__arrow--next");
			await expect(heading).toHaveText(titles[1]);
			await expect(heading).toBeFocused();
			expect(await liveWrites(page)).toEqual([]);
			await expectCounter(page, 2);
			expect(await page.title()).toBe(titles[1]);

			await activate(page, "a.praxity-slide-nav__arrow--next");
			await expect(heading).toHaveText(titles[2]);
			await expect(heading).toBeFocused();
			expect(await liveWrites(page)).toEqual([]);

			await activate(page, "a.praxity-slide-nav__arrow--prev");
			await expect(heading).toHaveText(titles[1]);
			await expect(heading).toBeFocused();
			expect(await liveWrites(page)).toEqual([]);

			await page.goBack();
			await waitForHydration(page);
			await expect(heading).toHaveText(titles[2]);
			expect(await liveWrites(page)).toEqual([]);
			await expectCounter(page, 3);
		});

		test(`${locale} direct arrival keeps position in the counter without a live message`, async ({
			page,
		}) => {
			await recordLiveWrites(page);
			await page.goto(`${base()}/index.html`);
			await page.waitForURL((url) => !url.pathname.endsWith("/index.html"));
			const next = await page.locator("a.praxity-slide-nav__arrow--next").getAttribute("href");
			if (!next) throw new Error("Missing second page");
			await page.goto(new URL(next, page.url()).href);
			await waitForHydration(page);
			await expect(page.locator("#main-content h1").first()).toHaveText(titles[1]);
			expect(await liveWrites(page)).toEqual([]);
			await expectCounter(page, 2);
		});

		test(`${locale} utility pages keep their existing arrival messages`, async ({ page }) => {
			await recordLiveWrites(page);
			// Resources stays in the course tab and keeps its title-only message.
			await page.goto(`${base()}/resources.html`);
			await waitForHydration(page);
			const title = await page.title();
			expect(title).toBeTruthy();
			expect(await liveWrites(page)).toEqual([title]);
			await expect(page.locator(".praxity-slide-counter")).toHaveCount(0);
			// The glossary opens in its own tab without the navigation island.
			await page.goto(`${base()}/glossary.html`);
			await expect(page.locator('[data-island="nav"]')).toHaveCount(0);
			expect(await liveWrites(page)).toEqual([]);
			await expect(page.locator(".praxity-slide-counter")).toHaveCount(0);
		});
	}
});
