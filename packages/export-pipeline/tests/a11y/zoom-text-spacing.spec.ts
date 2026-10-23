import { expect, type Locator, type Page } from "@playwright/test";
import type { NavArchetype } from "@praxity/grammar";
import { test } from "../muted-test";
import { NAV_CONFIGS, navConfigName } from "./fixtures/lightweight-fixture";
import {
	readNavVariantUrl,
	readSlidesNarrationUrl,
	waitForHydration,
	waitForSettledStyles,
} from "./helpers";
import { applyTextSpacing, applyTwoHundredPercentZoom } from "./layout-overrides";

/**
 * 200% browser zoom is emulated via `Emulation.setDeviceMetricsOverride` over the
 * Chrome DevTools Protocol, which only Chromium exposes. This is a harness limit, not
 * a WebKit or Firefox exemption -- 1.4.4 applies in every engine. The 1.4.12 text-spacing
 * mode injects CSS and runs in all three, so WebKit and Firefox reflow is covered there;
 * WebKit and Firefox zoom itself needs a manual check.
 */
const CDP_ZOOM_SKIP = "200% zoom is emulated over the Chrome DevTools Protocol (Chromium-only)";

const TEST_ARCHETYPES = new Set<NavArchetype>(["slides", "scroll", "sidebar"]);
const LAYOUTS = NAV_CONFIGS.filter(({ navigationStyle }) => TEST_ARCHETYPES.has(navigationStyle));

const MODES = [
	{
		name: "200% browser zoom",
		criterion: "WCAG 1.4.4",
		apply: applyTwoHundredPercentZoom,
		// Emulated through the Chrome DevTools Protocol, which only Chromium exposes.
		// Not a WebKit or Firefox reflow exemption -- 1.4.4 applies in every engine;
		// neither exposes this zoom-emulation hook. Verify zoom reflow manually.
		// The 1.4.12 text-spacing mode below injects CSS and runs in all three engines.
		chromiumOnly: true,
	},
	{
		name: "WCAG text spacing",
		criterion: "WCAG 1.4.12",
		apply: applyTextSpacing,
		chromiumOnly: false,
	},
] as const;

async function openWithMode(
	page: Page,
	url: string,
	applyMode: (page: Page) => Promise<void>,
): Promise<void> {
	await page.goto(url, { waitUntil: "domcontentloaded" });
	await waitForHydration(page);
	await applyMode(page);
	await page.evaluate(async () => {
		await document.fonts?.ready;
	});
	await expect(page.locator(".praxity-layout-wrapper")).toBeVisible();

	// This assertion walks and scrolls every text node. Load the page's deferred
	// content islands first so React cannot replace an SSR node mid-measurement.
	const contentIslands = page.locator("#main-content [data-island]");
	for (let index = 0; index < (await contentIslands.count()); index += 1) {
		await contentIslands.nth(index).scrollIntoViewIfNeeded();
	}
	if ((await contentIslands.count()) > 0) {
		await expect
			.poll(() =>
				contentIslands.evaluateAll((elements) =>
					elements.every((element) => element.hasAttribute("data-hydrated")),
				),
			)
			.toBe(true);
	}
}

async function assertActionable(target: Locator, label: string): Promise<void> {
	await expect(target, `${label} should remain visible`).toBeVisible();
	await target.click({ trial: true });
}

async function assertPageNavigationIsActionable(page: Page, label: string): Promise<void> {
	const previous = page
		.locator(
			[
				".praxity-page-nav button[aria-label*='Previous page']:not([disabled]):visible",
				".praxity-slide-nav button[aria-label*='Previous page']:not([disabled]):visible",
				"a.praxity-slide-nav__arrow--prev[href]:visible",
				"a.praxity-nav-prev[href]:visible",
			].join(", "),
		)
		.first();
	const next = page
		.locator(
			[
				".praxity-page-nav button[aria-label*='Next page']:not([disabled]):visible",
				".praxity-slide-nav button[aria-label*='Next page']:not([disabled]):visible",
				"a.praxity-slide-nav__arrow--next[href]:visible",
				"a.praxity-nav-next[href]:visible",
			].join(", "),
		)
		.first();

	await assertActionable(previous, `${label} previous-page control`);
	await assertActionable(next, `${label} next-page control`);
}

async function assertAssessmentIsActionable(page: Page, label: string): Promise<void> {
	const assessment = page.locator(".praxity-block-assessment[data-assessment-display]").first();
	await expect(assessment, `${label} knowledge check should remain visible`).toBeVisible();

	const option = assessment.locator("input[type='radio'], input[type='checkbox']").first();
	await expect(option, `${label} knowledge-check option should remain visible`).toBeVisible();
	await option.check();

	const submit = page
		.locator(".praxity-ag-submit-btn:visible, [data-assessment-submit='true']:visible")
		.first();
	await assertActionable(submit, `${label} knowledge-check submit`);
}

async function assertNoContentLoss(page: Page, label: string): Promise<void> {
	await waitForSettledStyles(page);
	const result = await page.evaluate(async () => {
		const main = document.querySelector<HTMLElement>("#main-content");
		const root = main ? document.body : null;
		if (!root || !main) {
			return {
				measurementError: "missing viewer shell or main content",
				horizontal: [],
				clipped: [],
				obscured: [],
			};
		}

		const describe = (element: Element): string => {
			const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
			const identity = [
				element.tagName.toLowerCase(),
				element.id ? `#${element.id}` : "",
				...Array.from(element.classList)
					.slice(0, 2)
					.map((name) => `.${name}`),
			].join("");
			return text ? `${identity} (“${text}”)` : identity;
		};
		const isVisuallyHidden = (element: Element): boolean => {
			if (!(element instanceof HTMLElement)) return false;
			const style = getComputedStyle(element);
			const tiny = Number.parseFloat(style.width) <= 1 && Number.parseFloat(style.height) <= 1;
			const clipsOverflow =
				["hidden", "clip"].includes(style.overflowX) &&
				["hidden", "clip"].includes(style.overflowY);
			const hasClip = style.clip !== "auto" || style.clipPath !== "none";
			return tiny && ((clipsOverflow && hasClip) || style.position === "absolute");
		};
		const isIgnored = (element: Element): boolean => {
			if (
				element.closest(
					"[hidden], [aria-hidden='true'], details:not([open]) > :not(summary), script, style, svg",
				)
			)
				return true;
			for (let current: Element | null = element; current; current = current.parentElement) {
				if (isVisuallyHidden(current)) return true;
			}
			return false;
		};
		const isRendered = (element: HTMLElement): boolean => {
			const style = getComputedStyle(element);
			return (
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				element.getClientRects().length > 0
			);
		};

		// Full-width blocks intentionally extend beyond the centered <main>. They only
		// fail reflow when that extension reaches the page/root scrolling boundary.
		const horizontal = [...new Set([document.documentElement, document.body, root])]
			.filter((element) => element.scrollWidth > element.clientWidth + 1)
			.map(describe);

		const clipped = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
			.filter(
				(element) =>
					!isIgnored(element) &&
					isRendered(element) &&
					(element.textContent ?? "").trim().length > 0,
			)
			.filter((element) => {
				const style = getComputedStyle(element);
				const clipsX = ["hidden", "clip"].includes(style.overflowX);
				const clipsY = ["hidden", "clip"].includes(style.overflowY);
				const clippedByOverflow =
					(clipsX && element.scrollWidth > element.clientWidth + 1) ||
					(clipsY && element.scrollHeight > element.clientHeight + 1);
				const contentEllipsis =
					main.contains(element) &&
					style.textOverflow === "ellipsis" &&
					element.scrollWidth > element.clientWidth + 1;
				return clippedByOverflow || contentEllipsis;
			})
			.map(describe);

		const obscured: string[] = [];
		const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!node.textContent?.trim()) continue;
			const parent = node.parentElement;
			if (
				!parent ||
				isIgnored(parent) ||
				!isRendered(parent) ||
				parent.closest("button, a, input, select, textarea, [role='button']")
			) {
				continue;
			}

			parent.scrollIntoView({ block: "center", inline: "nearest" });
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

			const range = document.createRange();
			range.selectNodeContents(node);
			const visibleRect = Array.from(range.getClientRects()).find(
				(rect) =>
					rect.width > 0 &&
					rect.height > 0 &&
					rect.bottom > 0 &&
					rect.right > 0 &&
					rect.top < window.innerHeight &&
					rect.left < window.innerWidth,
			);
			if (!visibleRect) {
				obscured.push(`${describe(parent)} is unreachable`);
				continue;
			}

			const x = Math.min(
				window.innerWidth - 1,
				Math.max(0, visibleRect.left + visibleRect.width / 2),
			);
			const y = Math.min(
				window.innerHeight - 1,
				Math.max(0, visibleRect.top + visibleRect.height / 2),
			);
			const topmost = document.elementFromPoint(x, y);
			if (
				topmost &&
				!parent.contains(topmost) &&
				!topmost.contains(parent) &&
				!topmost.closest(".praxity-skip-link")
			) {
				obscured.push(`${describe(parent)} is covered by ${describe(topmost)}`);
			}
		}

		return { measurementError: null, horizontal, clipped, obscured };
	});

	if (result.measurementError) {
		throw new Error(`${label} could not measure content loss: ${result.measurementError}`);
	}

	// Known content loss, recorded so this suite can gate regressions while the
	// underlying defects are fixed separately. Anything not listed here fails.
	// Removing an entry once fixed is the point -- do not add to this list to
	// silence a new finding.
	const KNOWN_CLIPPED = [
		// Mantine Badge fixes its height per size and ellipsises its label, so the
		// assessment status badges truncate. AssessmentBlock.tsx:1382-1397.
		"span.m_5add502a.mantine-Badge-label",
	];
	const unexpectedClipped = result.clipped.filter(
		(entry) => !KNOWN_CLIPPED.some((known) => entry.startsWith(known)),
	);

	expect(result.horizontal, `${label} introduced horizontal scrolling`).toEqual([]);
	expect(unexpectedClipped, `${label} clipped or truncated text`).toEqual([]);
	expect(result.obscured, `${label} made text unreachable or obscured`).toEqual([]);
}

async function assertAccordionPanelsHaveNoContentLoss(page: Page, label: string): Promise<void> {
	const summaries = page.locator(
		"main [data-accordion-item] > .praxity-disclosure-heading > button",
	);
	for (let index = 0; index < (await summaries.count()); index += 1) {
		const summary = summaries.nth(index);
		if ((await summary.getAttribute("aria-expanded")) !== "true") {
			await summary.click();
		}
		await assertNoContentLoss(page, `${label} accordion panel ${index + 1}`);
	}
}

test.describe("published output text resize and spacing", () => {
	test("larger text compounds with 200% zoom at 320 CSS px and can be reset", async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", CDP_ZOOM_SKIP);
		const baseUrl = readNavVariantUrl("scroll");
		expect(baseUrl, "Missing scroll fixture URL").toBeTruthy();
		if (!baseUrl) throw new Error("Missing scroll fixture URL");

		await page.setViewportSize({ width: 640, height: 900 });
		await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		const largerText = page.getByRole("button", { name: "Larger text" });
		await largerText.click();
		await expect(page.locator("html")).toHaveAttribute("data-praxity-text-size", "large");

		await applyTwoHundredPercentZoom(page);
		await page.evaluate(async () => document.fonts?.ready);
		expect(await page.evaluate(() => window.innerWidth)).toBe(320);
		expect(
			await page.evaluate(() =>
				Number.parseFloat(
					getComputedStyle(document.querySelector("#main-content") ?? document.body).fontSize,
				),
			),
		).toBeGreaterThanOrEqual(20);
		await assertNoContentLoss(page, "scroll larger text plus 200% zoom at 320px");
		await assertPageNavigationIsActionable(page, "scroll larger text plus 200% zoom at 320px");

		await assertActionable(largerText, "larger-text reset");
		await largerText.click();
		await expect(page.locator("html")).not.toHaveAttribute("data-praxity-text-size");
		await expect(largerText).toHaveAttribute("aria-pressed", "false");
	});

	for (const layout of LAYOUTS) {
		for (const mode of MODES) {
			const archetype = navConfigName(layout);
			test(`${archetype}: ${mode.criterion} ${mode.name}`, async ({ page, browserName }) => {
				test.skip(mode.chromiumOnly && browserName !== "chromium", CDP_ZOOM_SKIP);
				const baseUrl = readNavVariantUrl(archetype);
				expect(baseUrl, `Missing ${archetype} fixture URL`).toBeTruthy();
				if (!baseUrl) throw new Error(`Missing ${archetype} fixture URL`);

				await openWithMode(page, `${baseUrl}/page-2.html`, mode.apply);
				await assertNoContentLoss(page, `${archetype} ${mode.name} interactive page`);
				await assertAccordionPanelsHaveNoContentLoss(
					page,
					`${archetype} ${mode.name} interactive page`,
				);
				await assertPageNavigationIsActionable(page, `${archetype} ${mode.name}`);

				await openWithMode(page, `${baseUrl}/page-3.html`, mode.apply);
				await assertAssessmentIsActionable(page, `${archetype} ${mode.name}`);
				await assertNoContentLoss(page, `${archetype} ${mode.name} assessment page`);
			});
		}
	}

	for (const mode of MODES) {
		test(`slides chrome: ${mode.criterion} ${mode.name}`, async ({ page, browserName }) => {
			test.skip(mode.chromiumOnly && browserName !== "chromium", CDP_ZOOM_SKIP);
			const baseUrl = readSlidesNarrationUrl();
			expect(baseUrl, "Missing slides+narration fixture URL").toBeTruthy();
			if (!baseUrl) throw new Error("Missing slides+narration fixture URL");

			await openWithMode(page, `${baseUrl}/narrated-slide.html`, mode.apply);
			const hamburger = page.locator("button.praxity-hamburger");
			await assertActionable(hamburger, `slides ${mode.name} hamburger`);
			await hamburger.click();
			const outlineClose = page.locator(".praxity-native-menu-close");
			await assertActionable(outlineClose, `slides ${mode.name} outline close`);
			await outlineClose.click();
			const narrationDisclosure = page.getByRole("button", { name: "Listen", exact: true });
			await assertActionable(narrationDisclosure, `slides ${mode.name} narration disclosure`);
			await narrationDisclosure.click();

			const narrationOptions = page.getByRole("button", { name: "Narration options", exact: true });
			if (await narrationOptions.isVisible()) await narrationOptions.click();
			const narrationControls = page.locator(
				".praxity-narration-controls button:visible, .praxity-narration-controls input[type='range']",
			);
			expect(
				await narrationControls.count(),
				"narration fixture should expose controls",
			).toBeGreaterThan(0);
			for (const control of await narrationControls.all()) {
				await assertActionable(control, `slides ${mode.name} narration control`);
			}
			await assertPageNavigationIsActionable(page, `slides ${mode.name}`);
			await narrationDisclosure.click();
			await expect(page.locator(".praxity-narration-controls")).toHaveCount(0);
			await assertNoContentLoss(page, `slides ${mode.name} narrated slide`);

			await openWithMode(page, `${baseUrl}/knowledge-check.html`, mode.apply);
			await assertAssessmentIsActionable(page, `slides ${mode.name}`);
			await assertNoContentLoss(page, `slides ${mode.name} knowledge check`);
		});
	}
});
