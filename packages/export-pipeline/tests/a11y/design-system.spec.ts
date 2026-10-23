import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { Button, MantineProvider, Radio } from "@mantine/core";
import { expect, type Page } from "@playwright/test";
import { colorToHex, hexToOklab } from "@praxity/shared-blocks/color-math";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderBlockHtml } from "../../src/render-block-html";
import { expectFocusRing, expectForcedEmulationInert, forcedPalette } from "../focus-assertions";
import { test } from "../muted-test";
import { computedContrast } from "./contrast-helpers";
import {
	analyzeAxe,
	LAYOUT_UNIT,
	readTestEnv,
	waitForHydration,
	waitForSettledStyles,
} from "./helpers";

async function previousOutlineLink(page: Page, browserName: string) {
	// Safari's default Tab order includes links with Option (Alt).
	// https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac
	await page.keyboard.press(
		browserName === "webkit" && process.platform === "darwin" ? "Alt+Shift+Tab" : "Shift+Tab",
	);
}

for (const width of [1280, 390]) {
	test(`recall controls stay secondary at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/shared-reveals/reveals.html`);
		const toggles = page.locator("[data-card-flip]");
		await expect(toggles).toHaveCount(4);
		const accentCount = async () =>
			toggles.evaluateAll(
				(buttons) =>
					buttons.filter((button) => {
						const probe = document.createElement("span");
						probe.style.backgroundColor = "var(--accent)";
						button.append(probe);
						const filled =
							getComputedStyle(button).backgroundColor === getComputedStyle(probe).backgroundColor;
						probe.remove();
						return filled;
					}).length,
			);
		expect(await accentCount()).toBeLessThanOrEqual(1);
		for (const toggle of await toggles.all()) await toggle.click();
		expect(await accentCount()).toBeLessThanOrEqual(1);
		await toggles.first().hover();
		const hover = await toggles.first().evaluate((button) => {
			const probe = document.createElement("span");
			probe.style.backgroundColor = "var(--paper-2)";
			button.append(probe);
			const result = [
				getComputedStyle(button).backgroundColor,
				getComputedStyle(probe).backgroundColor,
			];
			probe.remove();
			return result;
		});
		expect(hover[0]).toBe(hover[1]);
	});
}

test("shared reveal keeps both recall faces in browser print", async ({ page }) => {
	await page.goto(`${readTestEnv().url}/shared-reveals/reveals.html`);
	const root = page.locator("[data-card-root]");
	await root.scrollIntoViewIfNeeded();
	await expect(
		root.getByRole("button", { name: "I have my answer", exact: true }).first(),
	).toBeVisible();
	const answers = root.locator('[data-card-side="back"]');
	for (const answer of await answers.all()) await expect(answer).toBeHidden();
	await page.emulateMedia({ media: "print" });
	for (const answer of await answers.all()) await expect(answer).toBeVisible();
	await page.emulateMedia({ media: "screen" });
	for (const answer of await answers.all()) await expect(answer).toBeHidden();
});

test("shared reveal preserves focused fallback content during delayed enhancement", async ({
	page,
}) => {
	let release: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/island-accordion-*.js", async (route) => {
		await ready;
		await route.continue();
	});
	try {
		await page.goto(`${readTestEnv().url}/shared-reveals/reveals.html`, {
			waitUntil: "domcontentloaded",
		});
		const root = page.locator('[data-island="accordion"]');
		await root
			.locator("[data-disclosure-panel]")
			.first()
			.evaluate((panel) => {
				const link = document.createElement("a");
				link.id = "fallback-link";
				link.href = "#main-content";
				link.textContent = "Continue reading";
				panel.append(link);
			});
		const link = page.locator("#fallback-link");
		await link.focus();
		release();
		await expect(root).toHaveAttribute("data-hydrated", "");
		await expect(link).toBeFocused();
		await expect(root.locator("[data-disclosure-trigger]").first()).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		await expect(link).toBeVisible();
	} finally {
		release();
	}
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
	test(`rule 12 shares reveal growth and fade ${reducedMotion}`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion });
		await page.goto(`${readTestEnv().url}/shared-reveals/reveals.html`);
		const checkRule = async (selector: string) => {
			const target = page.locator(selector).first();
			await expect(target).toBeVisible();
			const rule = await target.evaluate((element) => {
				const reveal = element.closest("[data-content-reveal]");
				if (!reveal) return null;
				const style = getComputedStyle(reveal);
				return {
					properties: style.transitionProperty,
					durations: style.transitionDuration,
					easings: style.transitionTimingFunction,
					animation: style.animationName,
				};
			});
			expect.soft(rule, selector).toEqual({
				properties: reducedMotion === "reduce" ? "none" : "grid-template-rows, opacity",
				durations: reducedMotion === "reduce" ? "0s" : "0.2s, 0.2s",
				easings:
					reducedMotion === "reduce"
						? "ease"
						: "cubic-bezier(0.2, 0.8, 0.2, 1), cubic-bezier(0.2, 0.8, 0.2, 1)",
				animation: "none",
			});
			if (reducedMotion === "reduce") {
				expect(
					await target.evaluate(
						(element) =>
							getComputedStyle(element.closest("[data-content-reveal]") ?? element).opacity,
					),
				).toBe("1");
			}
		};
		await page.locator("[data-card-flip]").first().click();
		await checkRule('[data-card-side="back"]');
		await page.locator('[data-island="accordion"] [data-disclosure-trigger]').first().click();
		await checkRule('[data-island="accordion"] [data-disclosure-panel]');
		await page.locator(".praxity-media-transcript [data-disclosure-trigger]").click();
		await checkRule(".praxity-media-transcript [data-disclosure-panel]");
		const tabs = page.locator('[data-island="tabs"]');
		await tabs.scrollIntoViewIfNeeded();
		await expect(tabs).toHaveAttribute("data-hydrated", "");
		await tabs.locator(".praxity-tabs-tab").nth(1).click();
		await checkRule('.praxity-tabs-panel:has-text("Describe what you heard")');
		const assessment = page.locator(
			'[data-island="assessment"]:has(.praxity-assessment-choice-options)',
		);
		await assessment.getByRole("radio").first().check();
		await assessment.locator("[data-assessment-submit]").click();
		await checkRule(".praxity-choice-status");
		await checkRule(".praxity-choice-feedback");
		await checkRule("[data-feedback-explanation]");
		const selfCheck = page.locator('[data-island="selfCheck"]');
		await selfCheck.locator("textarea").fill("My answer");
		await selfCheck.locator('[data-self-check-action="check"]').click();
		await checkRule("[data-self-check-parts]");
		await selfCheck.locator('[data-self-check-action="show-feedback"]').click();
		await checkRule("[data-self-check-comparison]");
		await checkRule('[data-self-check-comparison] li p:has-text("Fixture hint.")');
		const categorize = page.locator('[data-island="assessment"][data-block-id="categorize"]');
		for (const row of await categorize.locator("tbody tr").all())
			await row.getByRole("radio").last().check();
		await categorize.locator("[data-assessment-submit]").click();
		await checkRule('[data-block-id="categorize"] [data-row-result="incorrect"]');
		const answers = page.locator('[data-island="assessment"][data-block-id="answer-list"]');
		await answers.locator("input").fill("assumptions");
		await answers.locator("[data-assessment-submit]").click();
		await checkRule("[data-assessment-correct-answers]");
		await waitForSettledStyles(page);
		expect(
			(await analyzeAxe(page, new AxeBuilder({ page }).withRules(["color-contrast"]))).violations,
		).toEqual([]);
	});
}

// Native scrolling is not reported by getAnimations(). Record requests before
// any runtime loads so rule 12 can check the reduced-motion contract too.
function recordSmoothScroll() {
	const state = window as Window & { motionScrollViolations?: string[] };
	if (state.motionScrollViolations) return;
	state.motionScrollViolations = [];
	const record = (options: unknown) => {
		if (
			options &&
			typeof options === "object" &&
			"behavior" in options &&
			options.behavior === "smooth"
		) {
			state.motionScrollViolations?.push("native smooth scroll has no duration ceiling");
		}
	};
	const into = Element.prototype.scrollIntoView;
	Element.prototype.scrollIntoView = function (options) {
		record(options);
		return into.call(this, options);
	};
	for (const owner of [Element.prototype, window]) {
		for (const name of ["scrollTo", "scrollBy"] as const) {
			const original = owner[name];
			owner[name] = function (...args: [number, number] | [ScrollToOptions?]) {
				record(args[0]);
				return Reflect.apply(original, this, args);
			};
		}
	}
}

test.beforeEach(async ({ page }) => {
	await page.addInitScript(recordSmoothScroll);
	await page.evaluate(recordSmoothScroll);
});

// The outline is navigation, not an assessment result: its check means Visited.
for (const presentation of ["pages", "deck"] as const) {
	for (const palette of ["ink", "forest", "plum", "clay", "clear"] as const) {
		for (const mode of ["light", "dark"] as const) {
			test(`course outline ${presentation} ${palette} ${mode}`, async ({
				page,
				browserName,
			}, testInfo) => {
				const base = `${readTestEnv().url}/outline-${presentation}-${palette}-${mode}`;
				let desktopDividerColor: string | undefined;
				for (const width of [1280, 390, 320, 640]) {
					await page.setViewportSize({ width, height: 844 });
					await page.emulateMedia({ reducedMotion: "reduce" });
					await page.goto(`${base}/introduction.html`);
					await waitForHydration(page);
					const outline = page.locator(
						presentation === "pages" ? "#course-nav-sidebar" : "#deck-outline",
					);
					const rows = outline.locator(
						presentation === "pages" ? "a[data-page-id]" : "a[data-deck-page]",
					);
					const open = async () => {
						await waitForHydration(page);
						if (presentation === "deck")
							await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
						if (
							(await outline.isVisible()) &&
							(await outline.evaluate((e) => e.getBoundingClientRect().right > 0))
						)
							return;
						if (presentation === "deck") {
							const tools = page.locator("#deck-more-toggle");
							if ((await tools.getAttribute("aria-expanded")) === "false") await tools.click();
							await page.locator("#deck-outline-toggle").click();
						} else {
							await page.locator("[data-nav-menu-toggle]:visible").click();
							// Drawer entry transfers focus on the next animation frame.
							await expect(outline.locator('a[aria-current="page"]')).toBeFocused();
						}
					};
					await open();
					if (width === 1280) {
						for (const row of (await rows.all()).slice(1)) {
							await expect(row).not.toHaveAttribute("data-visited", "true");
							await expect(row.locator(".praxity-nav-marker-spacer > svg")).toHaveCount(1);
							await expect(row.locator(".praxity-nav-marker-spacer > svg")).toBeHidden();
						}
					}
					// Visit two rows through the real navigation, retaining the title/status names.
					const secondUrl = await rows.nth(1).getAttribute("href");
					if (!secondUrl) throw new Error("Missing second outline destination");
					await rows.nth(1).click();
					if (presentation === "pages") await page.waitForURL(new URL(secondUrl, `${base}/`).href);
					await open();
					await rows.nth(2).click();
					if (presentation === "pages")
						await page.waitForURL(`${base}/lectures-complementaires.html`);
					await open();
					if (width === 640) {
						// 1280px at 200% browser zoom has a 640 CSS-pixel layout viewport.
						await page.evaluate(() => {
							document.documentElement.style.fontSize = "32px";
						});
					}
					await page.evaluate(() => document.fonts.ready);
					if (presentation === "pages") {
						if (width === 1280) {
							desktopDividerColor = await outline.evaluate(
								(sidebar) => getComputedStyle(sidebar).borderInlineEndColor,
							);
						} else if (width === 390) {
							await expect
								.soft(outline, "drawer has a visible inline-end edge")
								.toHaveCSS("border-inline-end-width", "1px");
							await expect.soft(outline).toHaveCSS("border-inline-end-style", "solid");
							if (!desktopDividerColor) throw new Error("Missing desktop divider color");
							await expect
								.soft(outline, "drawer uses the desktop divider color")
								.toHaveCSS("border-inline-end-color", desktopDividerColor);
							await expect.soft(outline).toHaveCSS("box-shadow", "none");
						}
					} else {
						const heading = await outline.evaluate((nav) => {
							const title = nav.querySelector(".deck-panel-title");
							const module = nav.querySelector(".deck-module-title");
							const chevron = nav.querySelector(".praxity-native-menu-close svg");
							if (!title || !module || !chevron) throw new Error("Missing outline heading");
							const text = document.createRange();
							text.selectNodeContents(title);
							const bounds = text.getBoundingClientRect();
							text.selectNodeContents(module);
							const moduleBounds = text.getBoundingClientRect();
							const close = chevron.getBoundingClientRect();
							return {
								x: bounds.left - moduleBounds.left,
								center: bounds.top + bounds.height / 2 - (close.top + close.height / 2),
							};
						});
						expect
							.soft(Math.abs(heading.x), "outline heading aligns with module label")
							.toBeLessThanOrEqual(1);
						expect
							.soft(Math.abs(heading.center), "heading text and chevron share a center")
							.toBeLessThanOrEqual(1);
					}
					const current = rows.nth(2);
					await expect
						.soft(current, "current row semantics")
						.toHaveAttribute("aria-current", "page");
					await expect
						.soft(current, "current row style follows its semantic state")
						.toHaveCSS("font-weight", "600");
					const geometry = await current.evaluate((row) => {
						const sidebar = row.closest<HTMLElement>("#course-nav-sidebar, #deck-outline-sidebar");
						if (!sidebar) throw new Error("Missing outline sidebar");
						const bounds = row.getBoundingClientRect();
						const frame = sidebar.getBoundingClientRect();
						const scrollport = sidebar.querySelector<HTMLElement>(".deck-panel-scroll") ?? sidebar;
						const overflowing = scrollport.scrollHeight > scrollport.clientHeight;
						const end = overflowing
							? scrollport.getBoundingClientRect().left +
								scrollport.clientLeft +
								scrollport.clientWidth
							: frame.right - Number.parseFloat(getComputedStyle(sidebar).borderRightWidth);
						const style = getComputedStyle(row);
						return {
							left: bounds.left - frame.left,
							right: end - bounds.right,
							accent: style.borderLeftColor,
							accentWidth: Number.parseFloat(style.borderLeftWidth),
							paper: style.backgroundColor,
							weight: style.fontWeight,
						};
					});
					// Only overflowing outlines may leave room for a scrollbar before the divider.
					expect.soft(geometry.left, "current row spans full sidebar width").toBeCloseTo(0, 0);
					expect.soft(geometry.right, "current row reaches sidebar end").toBeCloseTo(0, 0);
					expect.soft(geometry.left, "accent sits at sidebar left edge").toBeCloseTo(0, 0);
					expect.soft(geometry.accentWidth, "visible accent bar").toBeGreaterThanOrEqual(2);
					expect.soft(geometry.weight, "current state also uses weight").toBe("600");
					const colors = await current.evaluate((row) => {
						const probe = document.createElement("span");
						row.append(probe);
						probe.style.color = "var(--accent)";
						probe.style.backgroundColor = "var(--paper-2)";
						const style = getComputedStyle(probe);
						const result = { accent: style.color, paper: style.backgroundColor };
						probe.remove();
						return result;
					});
					expect.soft(geometry.accent).toBe(colors.accent);
					expect.soft(geometry.paper).toBe(colors.paper);
					const statuses = rows.locator(".praxity-nav-marker-spacer");
					await expect.soft(statuses, "every row reserves a status column").toHaveCount(3);
					const positions = await statuses.evaluateAll((markers) =>
						markers.map((marker) => {
							const row = marker.closest("a");
							if (!row) throw new Error("Missing status row");
							const bounds = marker.getBoundingClientRect();
							return {
								x: bounds.x,
								trailing:
									bounds.left >
									row.getBoundingClientRect().left + row.getBoundingClientRect().width / 2,
							};
						}),
					);
					expect
						.soft(positions, "status icons share one x position on all three rows")
						.toHaveLength(3);
					for (const position of positions) {
						expect
							.soft(position.x, "status icons share one x position")
							.toBeCloseTo(positions[0].x, 0);
						expect.soft(position.trailing, "status icons follow labels").toBe(true);
					}
					await expect
						.soft(rows.first(), "visited state announced in text")
						.toHaveAccessibleName(/Consultée/);
					await expect
						.soft(rows.nth(1), "full long title remains accessible")
						.toHaveAccessibleName(
							/Vérifiez votre compréhension des cartes et coordonnées dans notre observatoire/,
						);
					const overflow = await rows.evaluateAll((links) =>
						links.map((link) => ({
							width: link.scrollWidth - link.clientWidth,
							clipped: Array.from(link.querySelectorAll("span")).some((span) => {
								if (span.closest(".praxity-sr-only")) return false;
								const style = getComputedStyle(span);
								return style.textOverflow === "ellipsis" || style.whiteSpace === "nowrap";
							}),
						})),
					);
					for (const row of overflow) {
						expect
							.soft(row.width, "rows reflow without horizontal overflow")
							.toBeLessThanOrEqual(1);
						expect.soft(row.clipped, "titles wrap instead of truncating").toBe(false);
					}
					// Reach the first row by keyboard; programmatic focus can retain mouse modality.
					await rows.nth(1).focus();
					await previousOutlineLink(page, browserName);
					await page.evaluate(
						() =>
							new Promise<void>((resolve) =>
								requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
							),
					);
					await expect(rows.first(), "keyboard focus reaches the outline row").toBeFocused();
					await expect.soft(rows.first()).toHaveCSS("outline-style", "solid");
					await expect.soft(rows.first()).toHaveCSS("outline-width", "2px");
					await expect.soft(rows.first()).toHaveCSS("outline-color", colors.accent);
					for (const row of await rows.all()) {
						expect
							.soft(await computedContrast(row), "outline text contrast")
							.toBeGreaterThanOrEqual(4.5);
					}
					expect
						.soft(
							await computedContrast(current, "borderLeftColor", true),
							"accent contrast on selection",
						)
						.toBeGreaterThanOrEqual(3);
					expect
						.soft(await computedContrast(rows.first(), "outlineColor", true), "focus contrast")
						.toBeGreaterThanOrEqual(3);
					const visitedIcon = rows.first().locator(".praxity-nav-marker-spacer > svg");
					await expect(visitedIcon, "visited row has a check SVG").toHaveCount(1);
					await expect(visitedIcon, "visited check is painted").toBeVisible();
					const checkBounds = await visitedIcon.boundingBox();
					if (!checkBounds) throw new Error("Visited check has no bounding box");
					expect(checkBounds.width).toBeGreaterThan(0);
					expect(checkBounds.height).toBeGreaterThan(0);
					expect
						.soft(await computedContrast(visitedIcon), "status icon contrast")
						.toBeGreaterThanOrEqual(3);
					if (
						[1280, 390].includes(width) &&
						((palette === "ink" && mode === "light") ||
							(palette === "clay" && mode === "dark") ||
							(palette === "clear" && mode === "light"))
					) {
						const name = `outline-${presentation}-${palette}-${mode}-${width}`;
						const path = testInfo.outputPath(`${name}.png`);
						await page.screenshot({ path });
						await testInfo.attach(name, { path, contentType: "image/png" });
					}
				}
			});
		}
	}
}

test("course outline deck current row is semantic before enhancement", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(`${readTestEnv().url}/outline-deck-ink-light/introduction.html`);
		await expect(page.locator("#deck-outline a[data-deck-page]").first()).toHaveAttribute(
			"aria-current",
			"page",
		);
	} finally {
		await context.close();
	}
});

interface DesignCourse {
	name: string;
	url: string;
	entries: string[];
	deck: boolean;
}

function courses(): DesignCourse[] {
	// Maintainer courses stay outside the repository. The capture runner exports a
	// scratch copy and supplies its URLs; CI exercises the public fixtures instead.
	const evidence = process.env.PRAXITY_DESIGN_SYSTEM_ENV;
	if (evidence) return JSON.parse(readFileSync(evidence, "utf8")) as DesignCourse[];
	const env = readTestEnv();
	return [
		{
			name: "comprehensive",
			url: env.url,
			entries: env.pages.map((p) => `${p.slug}.html`),
			deck: false,
		},
		{ name: "deck fixture", url: `${env.url}/design-deck`, entries: ["index.html"], deck: true },
	];
}

test("numeric data cells align at the end with tabular figures", async ({ page }) => {
	const course = courses().find((course) => !course.deck);
	if (!course) throw new Error("Missing Pages design-system export");
	await page.goto(`${course.url}/${course.entries[0]}`);
	const markup = renderBlockHtml({
		id: "numeric-polish",
		type: "table",
		data: {
			headers: ["Label", "Number"],
			rows: [
				["Positive", "12,345,678.90"],
				["Negative", "-42.5"],
			],
		},
	});
	await page
		.locator("#main-content")
		.evaluate((main, html) => main.insertAdjacentHTML("beforeend", html), markup);
	for (const number of ["12,345,678.90", "-42.5"]) {
		const cell = page.locator('[data-block-id="numeric-polish"] td').filter({ hasText: number });
		await expect(cell).toHaveCSS("text-align", "end");
		await expect(cell).toHaveCSS("font-variant-numeric", "tabular-nums");
	}
});

test("forced colours Pages outline has one visible inline-start border", async ({ page }) => {
	const course = courses().find((course) => !course.deck);
	if (!course) throw new Error("Missing Pages design-system export");
	await page.emulateMedia({ forcedColors: "active" });
	await page.goto(`${course.url}/${course.entries[0]}`);
	const rows = page.locator(".praxity-native-outline a");
	if (!(await forcedPalette(page))) {
		await rows.first().focus();
		await expectForcedEmulationInert(page, [rows]);
		await expectFocusRing(rows.first(), 2);
		return;
	}
	const borders = await rows.evaluateAll((rows) =>
		rows.map((row) => ({
			current: row.getAttribute("aria-current") === "page",
			width: Number.parseFloat(getComputedStyle(row).borderInlineStartWidth),
		})),
	);
	expect(borders.filter((row) => row.current)).toHaveLength(1);
	expect(borders.filter((row) => row.width > 0)).toEqual([
		expect.objectContaining({ current: true }),
	]);
});

test("Pages pagination aligns with prose and stacks adjacent titles on phones", async ({
	page,
}) => {
	const course = courses().find((course) => !course.deck && course.entries.length > 2);
	if (!course) throw new Error("Missing Pages design-system export");
	for (const width of [1280, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${course.url}/${course.entries[1]}`);
		await waitForHydration(page);
		await page.evaluate(async () => {
			await document.fonts.ready;
			const next = document.querySelector(".praxity-nav-next .praxity-pagination-title");
			if (!next) throw new Error("Missing adjacent title");
			next.textContent =
				"Distinguish the facts, opinions and interpretations before preparing your conversation";
		});
		const geometry = await page.evaluate(() => {
			const main = document.querySelector<HTMLElement>("#main-content");
			const prev = document.querySelector<HTMLElement>(
				".praxity-pages-pagination .praxity-nav-prev",
			);
			const next = document.querySelector<HTMLElement>(
				".praxity-pages-pagination .praxity-nav-next",
			);
			if (!main || !prev || !next) throw new Error("Missing Pages pagination");
			const bounds = main.getBoundingClientRect();
			const style = getComputedStyle(main);
			const previous = prev.getBoundingClientRect();
			const following = next.getBoundingClientRect();
			const labelTop = (element: HTMLElement) => {
				const text = document.createRange();
				text.selectNodeContents(element);
				return text.getBoundingClientRect().top;
			};
			return {
				left: bounds.left + Number.parseFloat(style.paddingLeft),
				right: bounds.right - Number.parseFloat(style.paddingRight),
				previous: { left: previous.left, right: previous.right, bottom: previous.bottom },
				next: { left: following.left, right: following.right, top: following.top },
				labelDifference: Math.abs(labelTop(prev) - labelTop(next)),
			};
		});
		expect.soft(Math.abs(geometry.previous.left - geometry.left)).toBeLessThanOrEqual(1);
		expect.soft(Math.abs(geometry.next.right - geometry.right)).toBeLessThanOrEqual(1);
		if (width === 1280) expect.soft(geometry.labelDifference).toBeLessThanOrEqual(1);
		else {
			expect.soft(geometry.next.top).toBeGreaterThanOrEqual(geometry.previous.bottom - LAYOUT_UNIT);
			expect.soft(Math.abs(geometry.previous.right - geometry.right)).toBeLessThanOrEqual(1);
			expect.soft(Math.abs(geometry.next.left - geometry.left)).toBeLessThanOrEqual(1);
		}
	}
});

test("Pages phone header shows the same parts for authored and generated lesson titles", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 900 });
	for (const [locale, courseTitle, generatedTitle, authoredTitle] of [
		["en", "Visit status", "Lesson 1", "Practice module"],
		["fr", "État des visites", "Leçon 1", "Module de pratique"],
	]) {
		for (const [kind, lessonTitle] of [
			["authored", authoredTitle],
			["untitled", generatedTitle],
		]) {
			await page.goto(`${readTestEnv().url}/${kind}-header-${locale}/introduction.html`);
			await waitForHydration(page);
			const header = page.locator(".praxity-top-bar");
			await expect(header.locator(".praxity-toolbar-context")).toBeVisible();
			await expect(header.locator(".praxity-toolbar-context")).toHaveText(courseTitle);
			await expect(
				header.locator(".praxity-toolbar-context:visible, .praxity-toolbar-position:visible"),
			).toHaveText([courseTitle]);
			await expect(header.locator(".praxity-toolbar-position")).toBeHidden();
			await expect(page.locator(".praxity-native-lesson-title")).toHaveText(lessonTitle);
		}
	}
});

test("Pages sidebar limits long titles and separates the scrolled outline", async ({ page }) => {
	const course = courses().find((course) => !course.deck && course.entries.length > 2);
	if (!course) throw new Error("Missing Pages design-system export");
	await page.setViewportSize({ width: 1280, height: 600 });
	await page.goto(`${course.url}/${course.entries[1]}`);
	await waitForHydration(page);
	await page.evaluate(() => document.fonts.ready);
	const title = page.locator(".praxity-native-sidebar-header .praxity-sidebar-title");
	await title.evaluate((element) => {
		const text =
			"Privacy and security settings for international Platform Infrastructure teams across the organisation";
		element.textContent = text;
		element.setAttribute("title", text);
	});
	const height = await title.evaluate((element) => ({
		height: element.getBoundingClientRect().height,
		line: Number.parseFloat(getComputedStyle(element).lineHeight),
	}));
	expect.soft(height.height).toBeLessThanOrEqual(3 * height.line + 1);
	await expect.soft(page.locator(".praxity-top-bar .praxity-toolbar-context")).toBeHidden();
	const outline = page.locator("[data-native-outline]");
	await outline.evaluate((element) => {
		element.scrollTop = 0;
	});
	const header = page.locator(".praxity-native-sidebar-header");
	await expect.soft(header).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
	await outline.evaluate((element) => {
		element.scrollTop = 100;
	});
	await expect.soft(header).toHaveCSS("border-bottom-width", "1px");
	await expect.soft(header).not.toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
	await page.locator("[data-sidebar-collapse]").click();
	await expect.soft(page.locator(".praxity-top-bar .praxity-toolbar-context")).toBeVisible();
});

async function inspect(page: Page) {
	const result = await page.evaluate(() => {
		const failures: string[][] = Array.from({ length: 13 }, () => []);
		const activityTargets: string[] = [];
		const phoneMargins: string[] = [];
		const label = (e: Element) => `${e.tagName.toLowerCase()}.${Array.from(e.classList).join(".")}`;
		const visible = (e: Element) => {
			const r = e.getBoundingClientRect();
			const s = getComputedStyle(e);
			return (
				r.width > 0 &&
				r.height > 0 &&
				s.visibility !== "hidden" &&
				s.clip !== "rect(0px, 0px, 0px, 0px)" &&
				s.clipPath !== "inset(50%)" &&
				!e.closest(".praxity-sr-only, .mantine-VisuallyHidden-root") &&
				s.display !== "none" &&
				!e.closest("[hidden], [inert]")
			);
		};
		const paintedBounds = (element: Element) => {
			const rect = element.getBoundingClientRect();
			let { left, right, top, bottom } = rect;
			for (let parent = element.parentElement; parent; parent = parent.parentElement) {
				const style = getComputedStyle(parent);
				const bounds = parent.getBoundingClientRect();
				if (["hidden", "auto", "scroll", "clip"].includes(style.overflowX)) {
					left = Math.max(left, bounds.left);
					right = Math.min(right, bounds.right);
				}
				if (["hidden", "auto", "scroll", "clip"].includes(style.overflowY)) {
					top = Math.max(top, bounds.top);
					bottom = Math.min(bottom, bounds.bottom);
				}
			}
			return { left, right, top, bottom };
		};
		const paintedStyles = (e: Element) => {
			const bounds = e.getBoundingClientRect();
			const styles = [
				{ style: getComputedStyle(e), pseudo: "", width: bounds.width, height: bounds.height },
			];
			for (const pseudo of ["::before", "::after"]) {
				const style = getComputedStyle(e, pseudo);
				if (
					["none", "normal"].includes(style.content) ||
					style.display === "none" ||
					style.visibility === "hidden" ||
					Number(style.opacity) === 0
				)
					continue;
				const width = Number.parseFloat(style.width);
				const height = Number.parseFloat(style.height);
				const text = !['""', "''"].includes(style.content);
				const paint =
					style.boxShadow !== "none" ||
					style.backgroundImage !== "none" ||
					style.backgroundColor !== "rgba(0, 0, 0, 0)" ||
					[
						style.borderTopWidth,
						style.borderRightWidth,
						style.borderBottomWidth,
						style.borderLeftWidth,
					].some((v) => Number.parseFloat(v) > 0);
				if ((width > 0 && height > 0) || text || paint)
					styles.push({ style, pseudo, width, height });
			}
			return styles;
		};
		const content = Array.from(document.querySelectorAll("#main-content *")).filter(visible);
		for (const element of content) {
			if (
				!(element instanceof HTMLElement) ||
				!element.clientWidth ||
				element.scrollWidth <= element.clientWidth + 1 ||
				!Array.from(element.childNodes).some(
					(node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
				)
			)
				continue;
			let scrollable = false;
			for (
				let ancestor: HTMLElement | null = element;
				ancestor;
				ancestor = ancestor.parentElement
			) {
				if (["auto", "scroll"].includes(getComputedStyle(ancestor).overflowX)) {
					scrollable = true;
					break;
				}
			}
			// Image overlay labels may truncate only when their full text is also visible below.
			const style = getComputedStyle(element);
			const caption = element.closest("figure")?.querySelector("figcaption");
			const preservedLabel =
				element.matches(".praxity-comparison-label") &&
				style.display === "block" &&
				style.textOverflow === "ellipsis" &&
				element.title === element.textContent?.trim() &&
				caption &&
				visible(caption) &&
				caption?.textContent?.includes(element.title);
			if (!scrollable && !preservedLabel) failures[12].push(`${label(element)} clipped text`);
		}
		const text = Array.from(document.querySelectorAll("body *")).filter(
			(e) =>
				visible(e) &&
				!e.closest(".katex, pre, code, kbd, samp") &&
				Array.from(e.childNodes).some(
					(n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
				),
		);
		const sizes = new Set(text.map((e) => getComputedStyle(e).fontSize));
		if (sizes.size > 6) failures[0].push(`font sizes: ${Array.from(sizes).join(", ")}`);
		for (const e of content.filter((e) =>
			e.matches(
				".praxity-text-content > p, .praxity-text > p, .praxity-assessment-choice-option label, .praxity-choice-label, .praxity-categorize-table tbody th, .praxity-matrix-table tbody th, .praxity-categorize-table thead th, .praxity-matrix-table thead th, .praxity-button, textarea",
			),
		)) {
			if (Number.parseFloat(getComputedStyle(e).fontSize) < 18)
				failures[0].push(`${label(e)} body ${getComputedStyle(e).fontSize}`);
		}
		for (const e of content.filter((e) =>
			e.matches(".praxity-text-content > p, .praxity-text > p"),
		)) {
			const probe = document.createElement("span");
			probe.textContent = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
			probe.style.cssText = `position:absolute;white-space:nowrap;font:${getComputedStyle(e).font}`;
			document.body.append(probe);
			const average = probe.getBoundingClientRect().width / 62;
			probe.remove();
			const measure = e.getBoundingClientRect().width / average;
			if (measure > 75) failures[1].push(`${label(e)} ${measure.toFixed(1)} characters`);
		}
		const boxed = (e: Element) => {
			if (
				e.matches("button, input, select, textarea, [role=button], [role=radio], label") ||
				e.closest(".praxity-assessment-choice-option")
			)
				return false;
			const s = getComputedStyle(e);
			return (
				[s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].every(
					(v) => Number.parseFloat(v) > 0,
				) &&
				Number.parseFloat(s.borderTopLeftRadius) > 0 &&
				![s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor].some(
					(c) => c === "rgba(0, 0, 0, 0)",
				)
			);
		};
		const activityCard = (e: Element) =>
			e.matches(
				".praxity-block-assessment:not(.praxity-block), .praxity-block-checklist > .praxity-fieldset-reset, .praxity-block-rating > .praxity-fieldset-reset, .praxity-block-signature > div, .praxity-block-journal > div",
			);
		const computedToken = (e: Element, property: string, token: string) => {
			const probe = document.createElement("span");
			probe.style.setProperty(property, `var(${token})`);
			e.append(probe);
			const value = getComputedStyle(probe).getPropertyValue(property);
			probe.remove();
			return value;
		};
		const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
		const durations = (value: string) =>
			value.split(",").map((v) => Number.parseFloat(v) * (v.trim().endsWith("ms") ? 1 : 1000));
		const keyframes = new Map<string, CSSKeyframesRule>();
		const collect = (rules: CSSRuleList) => {
			for (const rule of Array.from(rules)) {
				if (rule instanceof CSSKeyframesRule) keyframes.set(rule.name, rule);
				else if ("cssRules" in rule) collect((rule as CSSGroupingRule).cssRules);
			}
		};
		for (const sheet of Array.from(document.styleSheets)) collect(sheet.cssRules);
		failures[11].push(
			...((window as Window & { motionScrollViolations?: string[] }).motionScrollViolations ?? []),
		);
		for (const e of Array.from(document.querySelectorAll("body *")).filter(visible)) {
			const s = getComputedStyle(e);
			if (s.scrollBehavior === "smooth")
				failures[11].push(`${label(e)} CSS smooth scroll has no duration ceiling`);
			if (s.textTransform === "uppercase" && Number.parseFloat(s.letterSpacing) > 0)
				failures[2].push(label(e));

			const paper = getComputedStyle(document.body).backgroundColor;
			const borders = [
				s.borderTopWidth,
				s.borderRightWidth,
				s.borderBottomWidth,
				s.borderLeftWidth,
			].map(Number.parseFloat);
			const corners = [
				s.borderTopLeftRadius,
				s.borderTopRightRadius,
				s.borderBottomRightRadius,
				s.borderBottomLeftRadius,
			];
			if (
				!activityCard(e) &&
				borders.some((width) => width > 0) &&
				s.backgroundColor !== "rgba(0, 0, 0, 0)" &&
				s.backgroundColor !== paper &&
				s.boxShadow !== "none"
			)
				failures[4].push(`${label(e)} border + tint + shadow`);
			for (const [side, width] of borders.entries()) {
				if (
					width > 1 &&
					borders.filter((_, index) => index !== side).every((other) => other <= 1) &&
					[side, (side + 1) % 4].some((corner) => Number.parseFloat(corners[corner]) > 0)
				)
					failures[4].push(`${label(e)} rounded single-side border ${width}px`);
			}
			if (boxed(e)) {
				for (
					let parent = e.parentElement;
					parent && parent.id !== "main-content";
					parent = parent.parentElement
				) {
					if (boxed(parent)) {
						failures[4].push(`${label(e)} inside ${label(parent)}`);
						break;
					}
				}
			}
			for (const { style, pseudo, width, height } of paintedStyles(e)) {
				if (style.boxShadow !== "none") {
					const token = e.classList.contains("praxity-floating-layer")
						? "--shadow-floating"
						: activityCard(e)
							? "--shadow-card"
							: undefined;
					if (!token || style.boxShadow !== computedToken(e, "box-shadow", token))
						failures[3].push(`${label(e)}${pseudo} ${style.boxShadow}`);
				}
				const radii = [
					style.borderTopLeftRadius,
					style.borderTopRightRadius,
					style.borderBottomRightRadius,
					style.borderBottomLeftRadius,
				];
				for (const radius of radii) {
					// Generated circles use their own dimensions, not the host's box.
					const round =
						["50%", "999px"].includes(radius) &&
						(e.matches(".praxity-assessment-choice-option .praxity-choice-status") ||
							(radii.every((corner) => corner === radius) &&
								width > 0 &&
								height > 0 &&
								Math.abs(width - height) < 0.1));
					if (
						!radius
							.split(" ")
							.every((value) => ["0px", "4px", "6px", "10px", "16px"].includes(value)) &&
						!round
					)
						failures[5].push(`${label(e)}${pseudo} radius ${radius}`);
				}
			}
			for (const pseudo of [null, "::before", "::after"]) {
				const motion = getComputedStyle(e, pseudo);
				if (pseudo && ["none", "normal"].includes(motion.content)) continue;
				const transitionDurations = durations(motion.transitionDuration);
				const transitionDelays = durations(motion.transitionDelay);
				const transition = motion.transitionProperty
					.split(",")
					.map((property, index) =>
						property.trim() === "none"
							? 0
							: Math.max(
									0,
									transitionDurations[index % transitionDurations.length] +
										transitionDelays[index % transitionDelays.length],
								),
					);
				const animationDurations = durations(motion.animationDuration);
				const animationDelays = durations(motion.animationDelay);
				const iterations = motion.animationIterationCount
					.split(",")
					.map((count) => (count.trim() === "infinite" ? Infinity : Number(count)));
				const animation = motion.animationName
					.split(",")
					.map((name, index) =>
						name.trim() === "none"
							? 0
							: iterations[index % iterations.length] === Infinity
								? Infinity
								: Math.max(
										0,
										animationDelays[index % animationDelays.length] +
											animationDurations[index % animationDurations.length] *
												iterations[index % iterations.length],
									),
					);
				// The browser owns active timing, including WAAPI effects and CSS repetition.
				const activeTimings = e.getAnimations().flatMap((animation) => {
					const effect = animation.effect;
					if (
						!(effect instanceof KeyframeEffect) ||
						effect.target !== e ||
						(effect.pseudoElement || null) !== pseudo
					)
						return [];
					return [effect.getComputedTiming()];
				});
				const active = activeTimings.map((timing) =>
					timing.iterations === Infinity
						? Infinity
						: // Browser timings in seconds can leave a last-digit binary roundoff at 300ms.
							Math.max(
								0,
								Number(((timing.delay ?? 0) + Number(timing.activeDuration)).toPrecision(15)),
							),
				);
				const activeEffects = e
					.getAnimations()
					.flatMap((animation) =>
						animation.effect instanceof KeyframeEffect &&
						animation.effect.target === e &&
						(animation.effect.pseudoElement || null) === pseudo
							? [animation.effect]
							: [],
					);
				const animatedProperties = new Set(
					activeEffects.flatMap((effect) =>
						effect
							.getKeyframes()
							.flatMap((frame) =>
								Object.keys(frame).filter(
									(key) => !["offset", "computedOffset", "easing", "composite"].includes(key),
								),
							),
					),
				);
				for (const name of motion.animationName.split(",").map((value) => value.trim())) {
					const rule = keyframes.get(name);
					if (rule)
						for (const frame of Array.from(rule.cssRules)) {
							if (!(frame instanceof CSSKeyframeRule)) continue;
							for (const property of Array.from(frame.style)) animatedProperties.add(property);
						}
				}
				const transitionedProperties = motion.transitionProperty
					.split(",")
					.flatMap((property, index) =>
						transitionDurations[index % transitionDurations.length] > 0 ? [property.trim()] : [],
					);
				const properties = [...animatedProperties, ...transitionedProperties];
				const bounds = e.getBoundingClientRect();
				const large = bounds.width > 240 || bounds.height > 120;
				const sharedReveal =
					e.hasAttribute("data-content-reveal") &&
					(motion.transitionProperty === "grid-template-rows, opacity" ||
						(reduced && motion.transitionProperty === "none")) &&
					properties.every((property) => ["grid-template-rows", "opacity"].includes(property));
				const paint =
					properties.some(
						(property) => !["transform", "opacity", "visibility"].includes(property),
					) && !sharedReveal;
				const reveal = e.matches(
					".praxity-flashcard-face--back, .inline-tooltip-popover, [data-disclosure-panel], .praxity-tabs-panel",
				);
				const loop =
					iterations.some(
						(count, index) =>
							count > 1 && motion.animationName.split(",")[index]?.trim() !== "none",
					) || activeTimings.some((timing) => (timing.iterations ?? 1) > 1);
				// Only progress indicators may use a long, linear animation. They still stop in reduced motion.
				const progress =
					e.matches(
						"progress, [role=progressbar], .praxity-scroll-progress-bar, .praxity-scroll-progress-fill",
					) &&
					[
						...activeTimings.map((timing) => timing.easing ?? "linear"),
						...(animation.some((v) => v > 0) ? [motion.animationTimingFunction] : []),
						...(transition.some((v) => v > 0) ? [motion.transitionTimingFunction] : []),
					].every((v) => v.split(",").every((item) => item.trim() === "linear"));
				const easings = motion.transitionTimingFunction.split(/,(?![^(]*\))/).map((v) => v.trim());
				const tokenTiming = motion.transitionProperty.split(",").every((property, index) => {
					const duration = transitionDurations[index % transitionDurations.length];
					if (property.trim() === "none" || duration === 0 || progress) return true;
					return (
						[120, 200].includes(duration) &&
						[
							"cubic-bezier(0.2, 0.8, 0.2, 1)",
							"cubic-bezier(0.8, 0.2, 1, 0.2)",
							"cubic-bezier(0.4, 0, 0.2, 1)",
						].includes(easings[index % easings.length])
					);
				});
				if (
					!tokenTiming ||
					loop ||
					(e.hasAttribute("data-content-reveal") && !sharedReveal) ||
					(large && paint) ||
					(reveal && properties.includes("opacity")) ||
					properties.includes("outline-color") ||
					(!progress &&
						[...transition, ...animation, ...active].some((duration) => duration > 300)) ||
					(motion.transitionProperty.split(",").some((v) => v.trim() === "all") &&
						transition.some((duration) => duration > 0)) ||
					(reduced &&
						[
							...transition,
							...animation,
							...active,
							...transitionDurations,
							...(motion.animationName === "none" ? [] : animationDurations),
						].some((duration) => duration > 0))
				)
					failures[11].push(
						`${label(e)}${pseudo ?? ""} motion ${motion.transitionProperty} ${motion.transitionDuration}; ${motion.animationName} ${motion.animationDuration} x ${motion.animationIterationCount} delay ${motion.animationDelay}; transition delay ${motion.transitionDelay}${reduced ? " reduced" : ""}`,
					);
			}
		}
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Cannot inspect rendered colours");
		const rgb = (color: string) => {
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
		};
		const root = getComputedStyle(document.documentElement);
		const roles = [
			"--ink",
			"--ink-2",
			"--accent",
			"--on-accent",
			"--success-ink",
			"--error-ink",
			"--warning-ink",
			"--praxity-color-text",
			"--praxity-color-text-light",
			"--praxity-color-text-muted",
			"--praxity-color-accent",
			"--praxity-color-button-text",
			"--praxity-color-success",
			"--praxity-color-error",
			"--praxity-color-warning",
		]
			.map((role) => root.getPropertyValue(role).trim())
			.filter(Boolean)
			.map(rgb);
		for (const e of text) {
			const color = rgb(getComputedStyle(e).color);
			const chroma = Math.max(...color) - Math.min(...color);
			if (
				chroma > 20 &&
				!roles.some((role) => Math.hypot(...color.map((v, i) => v - role[i])) < 12)
			)
				failures[6].push(`${label(e)} ${getComputedStyle(e).color}`);
		}
		for (const e of Array.from(
			document.querySelectorAll(
				"button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], a[href]",
			),
		).filter(visible)) {
			// Choice labels stretch their activation pseudo-element across the option.
			const target = e.matches("input[type=radio], input[type=checkbox]")
				? (e.closest(".praxity-assessment-choice-option") ??
					e.closest(".praxity-ag-radio-row") ??
					e.closest("label") ??
					(e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`) : null) ??
					e)
				: e;
			const r = target.getBoundingClientRect();
			if (
				(r.width < 43.9 || r.height < 43.9) &&
				e.closest(
					'[data-block-type="assessment"], [data-block-type="button"], [data-block-type="rating"], [data-block-type="checklist"], [data-block-type="signature"], [data-assessment-group-header], [data-assessment-group-submit]',
				)
			)
				activityTargets.push(`${label(e)} ${r.width.toFixed(1)} × ${r.height.toFixed(1)}`);
			if (r.width < 43.9 || r.height < 43.9)
				failures[7].push(`${label(e)} ${r.width.toFixed(1)} Ã— ${r.height.toFixed(1)}`);
		}
		if (innerWidth === 390)
			for (const e of content.filter((e) => e.matches("p, h1, h2, h3, img, table, fieldset"))) {
				const r = paintedBounds(e);
				if (r.right > r.left && (r.left < 15.9 || r.right > innerWidth - 15.9))
					phoneMargins.push(`${label(e)} phone edges ${r.left.toFixed(1)}, ${r.right.toFixed(1)}`);
			}
		const title = document.querySelector(
			".deck-slide:not([hidden]) h1, .deck-slide:not([hidden]) .praxity-slide-title",
		);
		const footer = document.querySelector(".deck-controls");
		if (footer) {
			const f = footer.getBoundingClientRect();
			for (const e of content.filter((e) => e.matches(".praxity-block"))) {
				const { top, bottom } = paintedBounds(e);
				if (bottom > top && top < f.bottom && bottom > f.top)
					failures[8].push(`${label(e)} intersects footer`);
			}
		}
		for (const e of Array.from(document.querySelectorAll("body *")).filter(visible)) {
			for (const { style, pseudo } of paintedStyles(e)) {
				const families = style.fontFamily
					.split(",")
					.map((family) => family.replaceAll(/['"]/g, "").trim());
				const allowed = e.closest(".katex")
					? families.every(
							(family) =>
								family.startsWith("KaTeX_") ||
								["Source Sans 3", "Source Serif 4", "Atkinson Hyperlegible Next", "math"].includes(
									family,
								) ||
								["serif", "sans-serif", "monospace"].includes(family),
						)
					: e.closest("pre, code, kbd, samp")
						? families.every((family) =>
								[
									"monospace",
									"ui-monospace",
									"SFMono-Regular",
									"Menlo",
									"Monaco",
									"Consolas",
									"Liberation Mono",
									"Courier New",
								].includes(family),
							)
						: ["Source Sans 3", "Source Serif 4", "Atkinson Hyperlegible Next"].includes(
								families[0],
							) &&
							families.every((family) =>
								[
									"Source Sans 3",
									"Source Serif 4",
									"Atkinson Hyperlegible Next",
									"serif",
									"sans-serif",
								].includes(family),
							);
				if (!allowed) failures[10].push(`${label(e)}${pseudo} ${families.join(", ")}`);
			}
		}
		return {
			activityTargets,
			failures: failures.map((items) => Array.from(new Set(items))),
			phoneMargins,
			titleTop:
				title && visible(title)
					? title.getBoundingClientRect().top -
						(document.querySelector("#main-content")?.getBoundingClientRect().top ?? 0)
					: undefined,
		};
	});
	result.failures[5].push(...(await inspectRadiusRoles(page)));
	return result;
}

// Zero is an edge treatment, never a second control radius.
test("reading geometry top-aligns unequal cards within each grid row", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 844 });
	await page.goto(`${readTestEnv().url}/reading-geometry/reading-geometry.html`);
	await page.evaluate(() => document.fonts.ready);
	const cards = await page
		.locator('[data-card-root][data-columns="2"][data-layout="grid"] [data-card-item]')
		.evaluateAll((items) =>
			items.map((item) => {
				const heading = item.querySelector("h3");
				const body = item.querySelector('[class*="praxity-card-body"]');
				if (!heading || !body) throw new Error("Missing card heading or body");
				const headingText = document.createRange();
				headingText.selectNodeContents(heading);
				const bodyText = document.createRange();
				bodyText.selectNodeContents(body);
				return {
					top: item.getBoundingClientRect().top,
					headingTop: heading.getBoundingClientRect().top,
					gap: bodyText.getBoundingClientRect().top - headingText.getBoundingClientRect().bottom,
				};
			}),
		);
	expect(cards).toHaveLength(4);
	for (const [first, second] of [
		[cards[0], cards[1]],
		[cards[2], cards[3]],
	]) {
		expect.soft(Math.abs(first.top - second.top)).toBeLessThanOrEqual(1);
		expect
			.soft(
				Math.abs(first.gap - second.gap),
				"row-mate height cannot distribute the heading/body gap",
			)
			.toBeLessThanOrEqual(1);
		for (const card of [first, second]) {
			expect.soft(card.headingTop - card.top, "content starts at the top").toBeCloseTo(0, 0);
		}
	}
});

test("reading geometry spaces divided items from both rules at 390px", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`${readTestEnv().url}/reading-geometry/reading-geometry.html`);
	await page.evaluate(() => document.fonts.ready);
	const items = await page
		.locator(
			'[data-card-root][data-columns="2"][data-layout="grid"] [data-card-item] > :is(h3, [class*="praxity-card-body"])',
		)
		.evaluateAll((children) =>
			children.map((child) => {
				const bounds = child.getBoundingClientRect();
				const style = getComputedStyle(child);
				// Heading font bounds can exceed their 1.2 line box. Measure reading
				// space from the laid-out line box, not the font's invisible ascenders.
				const first = child.firstElementChild?.getBoundingClientRect();
				const last = child.lastElementChild?.getBoundingClientRect();
				const start =
					first?.top ??
					bounds.top +
						Number.parseFloat(style.borderTopWidth) +
						Number.parseFloat(style.paddingBlockStart);
				const end = last?.bottom ?? bounds.bottom - Number.parseFloat(style.paddingBlockEnd);
				return {
					before: start - bounds.top - Number.parseFloat(style.borderTopWidth),
					after: bounds.bottom - end,
					border: Number.parseFloat(style.borderTopWidth),
					paddingBefore: style.paddingBlockStart,
					paddingAfter: style.paddingBlockEnd,
					token: Number.parseFloat(style.getPropertyValue("--block-gap")),
				};
			}),
		);
	expect(items).toHaveLength(8);
	for (const item of items) {
		expect(item.border, "the item is separated by a rule").toBeGreaterThan(0);
		expect(item.token, "phone reading-rhythm block gap").toBe(24);
		expect
			.soft(item.before, "space before the divided item")
			.toBeGreaterThanOrEqual(item.token - LAYOUT_UNIT);
		expect
			.soft(item.after, "space after the divided item")
			.toBeGreaterThanOrEqual(item.token - LAYOUT_UNIT);
		expect.soft(item.paddingBefore, "symmetric vertical padding").toBe(item.paddingAfter);
	}
});

for (const width of [1280, 390]) {
	for (const mode of ["light", "dark"]) {
		test(`circle roles retain their shapes at ${width}px ${mode}`, async ({ page }) => {
			await page.setViewportSize({ width, height: 844 });
			const rhythm = readFileSync(
				new URL("../../../shared-blocks/src/reading-rhythm.css", import.meta.url),
				"utf8",
			);
			const styles = [
				"../../../shared-blocks/src/blocks/shared-blocks.css",
				"../../../shared-blocks/src/viewer/viewer-shell.css",
				"../../template/src/styles/global.css",
			]
				.map((file) =>
					readFileSync(new URL(file, import.meta.url), "utf8").replace(
						'@import "../reading-rhythm.css";',
						rhythm,
					),
				)
				.join("\n");
			await page.setContent(`<style>${rhythm}\n${styles}</style><main data-praxity-root data-praxity-mode="${mode}">
				<img class="praxity-dialogue-avatar" alt="Alex" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3C/svg%3E">
				<span class="praxity-assessment-choice-baseline"><input type="radio" aria-label="Response"></span>
				<span class="praxity-ag-radio"></span>
				<span class="praxity-accent-badge">1</span>
				<button class="praxity-sequence-scroll-button" aria-label="Scroll">+</button>
				<button class="praxity-comparison-handle" aria-label="Compare">+</button>
				<button class="praxity-edge-arrow" aria-label="Next">+</button>
				<button class="praxity-labeled-graphic-dot" aria-label="Point">1</button>
				<span class="praxity-nav-current-marker"></span>
				<span class="praxity-progress-dot"></span>
				<span class="praxity-progress-dot is-current"></span>
				<button class="praxity-slides-dot" aria-label="Slide"></button>
				<span class="praxity-assessment-choice-option"><span class="praxity-choice-status">Correct</span></span>
			</main>`);
			for (const circle of await page
				.locator(
					".praxity-dialogue-avatar, input[type=radio], .praxity-ag-radio, .praxity-accent-badge, .praxity-sequence-scroll-button, .praxity-comparison-handle, .praxity-edge-arrow, .praxity-labeled-graphic-dot, .praxity-nav-current-marker, .praxity-progress-dot:not(.is-current)",
				)
				.all()) {
				await expect.soft(circle).toHaveCSS("border-radius", "50%");
			}
			for (const selector of [".praxity-ag-radio", ".praxity-slides-dot"]) {
				expect
					.soft(
						await page
							.locator(selector)
							.evaluate((e) => getComputedStyle(e, "::before").borderRadius),
					)
					.toBe("50%");
			}
			await expect(page.locator(".praxity-choice-status")).toHaveCSS("border-radius", "999px");
			await expect(page.locator(".praxity-progress-dot.is-current")).toHaveCSS(
				"border-radius",
				"4px",
			);
			const avatar = page.locator(".praxity-dialogue-avatar");
			for (const size of [24, 38, 48, 96]) {
				await avatar.evaluate((e, size) => {
					e.style.inlineSize = `${size}px`;
					e.style.blockSize = `${size}px`;
				}, size);
				await expect(avatar).toHaveCSS("border-radius", "50%");
			}
		});
	}
}

async function inspectRadiusRoles(page: Page) {
	return page.evaluate(() => {
		const straightEdges = [
			[
				"img:not(.praxity-dialogue-avatar), .praxity-card-media[data-media=flush] figure",
				"authored images stay square",
			],
			[
				".praxity-narration, .deck-header, .deck-controls, #deck-more-below",
				"bands dock to the viewport",
			],
			[
				".praxity-outline-fallback a, .deck-outline-link, .praxity-native-outline-link",
				"outline selection stripe",
			],
			[".praxity-callout, .praxity-blockquote", "reading accent stripe"],
			[
				".praxity-accordion-static .praxity-disclosure-trigger, [data-disclosure=true] .praxity-tabs-tab",
				"BL3 disclosure rows keep their separating rules straight",
			],
			[
				".praxity-table-scroll-region, .praxity-signature-tab",
				"BL4 table edges and AC7 selected tab underline",
			],
			["th, td, .praxity-table-scroll-region > table", "cells and clipped inner table edges"],
			[
				".praxity-matrix-table-wrap, .praxity-block-assessment .praxity-table-scroll-region",
				"activity table inset is at least the card radius",
			],
			[".praxity-categorize-table-wrap", "only the six-pixel wide inset exposes curved corners"],
		] as const;
		const roles = [
			[
				".praxity-dialogue-avatar, input[type=radio], .mantine-Radio-radio, .praxity-ag-radio, .praxity-sequence-scroll-button, .praxity-comparison-handle, .praxity-edge-arrow, .praxity-accent-badge, .praxity-labeled-graphic-dot, .praxity-nav-current-marker, .praxity-progress-dot:not(.is-current)",
				"circle",
			],
			[
				straightEdges
					.filter(([selector]) => selector !== ".praxity-categorize-table-wrap")
					.map(([selector]) => selector)
					.join(","),
				0,
			],
			[
				".praxity-block-assessment:not(.praxity-block), .praxity-block-checklist > :is(.praxity-fieldset-reset, div), .praxity-block-rating > :is(.praxity-fieldset-reset, div), .praxity-block-signature > div, .praxity-block-journal > div, .praxity-dialogue[data-style=bubbles] .praxity-dialogue-bubble",
				16,
			],
			[
				".praxity-choice-key, .praxity-choice-key-spacer, input[type=checkbox], .mantine-Checkbox-input",
				6,
			],
			[
				"mark, .praxity-required-marker, .praxity-task-list-marker, .praxity-labeled-graphic-pin, .praxity-progress-dot.is-current",
				4,
			],
			[
				"button, input:not([type=checkbox]):not([type=hidden]), select, textarea, [role=button], [role=tab], .praxity-assessment-choice-option, .praxity-ag-radio-row, .praxity-rating-option, .praxity-rating-numeric, .praxity-code-body, .praxity-media-frame, .praxity-media-container, .praxity-embed-iframe, .praxity-accordion-panel, .mantine-Accordion-panel, .praxity-table-scroll-region, .praxity-categorize-table-wrap, .praxity-matrix-table-wrap, .praxity-comparison-handle, .praxity-nav-prev, .praxity-nav-next, .praxity-a11y-pill",
				10,
			],
		] as const;
		const failures: string[] = [];
		for (const element of document.querySelectorAll(
			roles.map(([selector]) => selector).join(","),
		)) {
			const bounds = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			if (
				!bounds.width ||
				!bounds.height ||
				style.display === "none" ||
				style.visibility === "hidden" ||
				element.closest("[hidden], [inert], .praxity-sr-only")
			)
				continue;
			const role = roles.find(([selector]) => element.matches(selector));
			if (!role) throw new Error("Missing radius role");
			const straight = straightEdges.some(
				([selector]) =>
					element.matches(selector) &&
					(selector !== ".praxity-categorize-table-wrap" ||
						Number.parseFloat(style.marginInlineStart) >= 0),
			);
			const attachedTab =
				// Only the panel's joined edge is straight; disclosure buttons have four corners.
				element.matches("[role=tab]") &&
				!!element.closest(".praxity-tabs-block, .praxity-tabs-static") &&
				!element.classList.contains("praxity-disclosure-trigger");
			const radii = [
				style.borderTopLeftRadius,
				style.borderTopRightRadius,
				style.borderBottomRightRadius,
				style.borderBottomLeftRadius,
			];
			const expected = radii.map((_, corner) =>
				role[1] === "circle"
					? "50%"
					: `${straight || (attachedTab && corner >= 2) ? 0 : role[1]}px`,
			);
			if (radii.some((radius, corner) => radius !== expected[corner]))
				failures.push(
					`${element.tagName}.${element.className}: expected ${expected.join(" ")}, got ${radii.join(" ")}`,
				);
		}
		return failures;
	});
}

const rules = [
	"type scale",
	"measure",
	"sentence case",
	"floating shadows",
	"single box",
	"radius family",
	"colour roles",
	"targets and phone margins",
	"deck geometry",
	"feedback words and icons",
	"font pairings",
	"motion",
	"text overflow remains reachable",
];

for (const palette of ["ink", "forest", "plum", "clay", "clear"])
	for (const mode of ["light", "dark"])
		for (const presentation of ["pages", "deck"])
			test(`radius roles ${presentation} ${palette} ${mode} full and lite`, async ({ page }) => {
				const base = `${readTestEnv().url}/radius-${presentation}-${palette}-${mode}`;
				for (const width of [1280, 390]) {
					await page.setViewportSize({ width, height: 844 });
					await page.goto(`${base}/corner-roles.html?praxity-inspect=1`);
					await waitForHydration(page);
					await hydrateContent(page);
					for (const css of ["lite", "full"]) {
						if (css === "full") {
							const fullBase = base.replace("radius-deck-", "radius-pages-");
							const response = await page.request.get(`${fullBase}/full-css.json`);
							const stylesheet = await response.json();
							await page.evaluate(
								(href) =>
									new Promise<void>((resolve, reject) => {
										const link = document.createElement("link");
										link.rel = "stylesheet";
										link.href = href;
										link.onload = () => resolve();
										link.onerror = () => reject(new Error(`Cannot load ${href}`));
										document.head.append(link);
									}),
								`${fullBase}/${stylesheet}`,
							);
						}
						expect.soft(await inspectRadiusRoles(page), `${width}px ${css}`).toEqual([]);
					}
				}
			});

for (const presentation of ["pages", "deck"]) {
	test(`linear scale follows its container in ${presentation}`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 844 });
		await page.goto(`${readTestEnv().url}/radius-${presentation}-ink-light/corner-roles.html`);
		await waitForHydration(page);
		await hydrateContent(page);
		for (const count of [10, 11]) {
			const rating = page.locator('.praxity-rating[data-rating-style="numeric"]').nth(count - 10);
			const minimum = count * 44 + (count - 1) * 4;
			for (const width of [
				minimum + (count - 1) * 4,
				minimum + 1,
				minimum,
				minimum - 1,
				304,
				252,
				210,
			]) {
				await rating.evaluate((element, width) => {
					element.style.inlineSize = `${width}px`;
					element.style.boxSizing = "content-box";
					element.style.minInlineSize = "0";
				}, width);
				const geometry = await rating.evaluate((element) => {
					const options = element.querySelector(".praxity-rating-options");
					const endpoints = element.querySelector(".praxity-rating-endpoints");
					if (!options || !endpoints) throw new Error("Missing numeric scale row or labels");
					const row = options.getBoundingClientRect();
					const labels = endpoints.getBoundingClientRect();
					return {
						row: { left: row.left, right: row.right, width: row.width },
						labels: { left: labels.left, right: labels.right },
						gap: Number.parseFloat(getComputedStyle(options).columnGap),
						keys: [...options.querySelectorAll(".praxity-rating-numeric")].map((key) => {
							const bounds = key.getBoundingClientRect();
							return {
								top: bounds.top,
								left: bounds.left,
								right: bounds.right,
								width: bounds.width,
								height: bounds.height,
							};
						}),
					};
				});
				const rows = [...new Set(geometry.keys.map((key) => key.top))].map((top) =>
					geometry.keys.filter((key) => key.top === top),
				);
				const context = `${count} keys in ${width}px`;
				if (width >= minimum)
					expect
						.soft(
							rows.map((row) => row.length),
							context,
						)
						.toEqual([count]);
				else if (width >= Math.ceil(count / 2) * 44 + (Math.ceil(count / 2) - 1) * 8)
					expect
						.soft(
							rows.map((row) => row.length),
							context,
						)
						.toEqual(count === 10 ? [5, 5] : [6, 5]);
				for (const row of rows) {
					for (const key of row) {
						expect.soft(key.width, context).toBeGreaterThanOrEqual(44 - LAYOUT_UNIT);
						expect.soft(key.height, context).toBeGreaterThanOrEqual(48 - LAYOUT_UNIT);
						expect.soft(key.right, context).toBeLessThanOrEqual(geometry.row.right + 1);
						expect.soft(key.width, context).toBeCloseTo(row[0].width, 0);
					}
				}
				expect.soft(geometry.gap, context).toBeGreaterThanOrEqual(4);
				expect.soft(geometry.gap, context).toBeLessThanOrEqual(8);
				if (width === minimum) expect.soft(geometry.gap, context).toBeCloseTo(4, 0);
				expect.soft(geometry.labels.left, context).toBeCloseTo(geometry.row.left, 0);
				expect.soft(geometry.labels.right, context).toBeCloseTo(geometry.row.right, 0);
			}
		}
	});
}

for (const width of [1280, 390, 320])
	test(`linear scale keys and keyboard at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/radius-pages-ink-light/corner-roles.html`);
		await waitForHydration(page);
		await hydrateContent(page);
		for (const count of [10, 11]) {
			const rating = page.locator('.praxity-rating[data-rating-style="numeric"]').nth(count - 10);
			const keys = rating.locator(".praxity-rating-numeric");
			await expect(keys).toHaveCount(count);
			const shapes = await keys.evaluateAll((elements) =>
				elements.map((element) => {
					const style = getComputedStyle(element);
					const bounds = element.getBoundingClientRect();
					return {
						radius: style.borderRadius,
						width: bounds.width,
						height: bounds.height,
						top: bounds.top,
						left: bounds.left,
						shadow: style.boxShadow,
						font: style.fontSize,
						border: style.borderWidth,
					};
				}),
			);
			for (const shape of shapes) {
				expect.soft(shape.radius).toBe("10px");
				expect.soft(shape.width).toBeGreaterThanOrEqual(44 - LAYOUT_UNIT);
				expect.soft(shape.height).toBeGreaterThanOrEqual((width === 1280 ? 48 : 44) - LAYOUT_UNIT);
				expect.soft(shape.shadow).toBe("none");
				expect.soft(shape.font).toBe(width === 1280 ? "19px" : width === 390 ? "18px" : "16px");
				expect.soft(shape.border).toBe("1px");
			}
			const containerWidth = await rating.evaluate((element) => {
				const style = getComputedStyle(element);
				return (
					element.clientWidth -
					Number.parseFloat(style.paddingLeft) -
					Number.parseFloat(style.paddingRight)
				);
			});
			const minimum = count * 44 + (count - 1) * 4;
			const gap = shapes[1].left - shapes[0].left - shapes[0].width;
			expect.soft(gap).toBeGreaterThanOrEqual(4 - 0.1);
			expect.soft(gap).toBeLessThanOrEqual(8 + 0.1);
			if (
				containerWidth >= minimum ||
				containerWidth >= Math.ceil(count / 2) * 44 + (Math.ceil(count / 2) - 1) * 8
			) {
				const rows = [...new Set(shapes.map((shape) => shape.top))].map(
					(top) => shapes.filter((shape) => shape.top === top).length,
				);
				expect
					.soft(rows)
					.toEqual(containerWidth >= minimum ? [count] : count === 10 ? [5, 5] : [6, 5]);
			}
			await expect(rating.locator(".praxity-rating-endpoints")).toBeVisible();
			await keys.first().hover();
			const hovered = await keys.first().evaluate((element) => {
				const probe = document.createElement("span");
				probe.style.cssText = "color:var(--ink-2);background:var(--paper)";
				element.append(probe);
				const expected = getComputedStyle(probe);
				const actual = getComputedStyle(element);
				const result = {
					border: actual.borderColor,
					paper: actual.backgroundColor,
					ink: expected.color,
					expectedPaper: expected.backgroundColor,
				};
				probe.remove();
				return result;
			});
			expect.soft(hovered.border).toBe(hovered.ink);
			expect.soft(hovered.paper).toBe(hovered.expectedPaper);
			await page.emulateMedia({ reducedMotion: "no-preference" });
			await page.mouse.down();
			await expect
				.poll(() =>
					keys
						.first()
						.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a),
				)
				.toBeCloseTo(0.96, 2);
			await page.emulateMedia({ reducedMotion: "reduce" });
			await expect(keys.first()).toHaveCSS("transition-duration", "0s");
			expect(
				await keys
					.first()
					.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a),
			).toBeCloseTo(0.96, 2);
			await page.mouse.up();
			const radios = rating.locator("input[type=radio]");
			await radios.first().focus();
			for (let value = 2; value <= count; value++) {
				await page.keyboard.press("ArrowRight");
				await expect(radios.nth(value - 1)).toBeFocused();
				await expect(radios.nth(value - 1)).toBeChecked();
			}
			await expect(keys.last()).toHaveCSS("border-width", "2px");
			const colors = await keys.last().evaluate((element) => {
				const probe = document.createElement("span");
				probe.style.cssText = "color:var(--accent);background:var(--accent-soft)";
				element.append(probe);
				const expected = getComputedStyle(probe);
				const actual = getComputedStyle(element);
				const result = {
					border: actual.borderColor,
					tint: actual.backgroundColor,
					accent: expected.color,
					soft: expected.backgroundColor,
				};
				probe.remove();
				return result;
			});
			expect.soft(colors.border).toBe(colors.accent);
			expect.soft(colors.tint).toBe(colors.soft);
		}
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
		).toBeLessThanOrEqual(1);
	});

for (const width of [1280, 390]) {
	test(`reading geometry keeps unboxed cards aligned at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/reading-geometry/reading-geometry.html`);
		await page.evaluate(() => document.fonts.ready);
		const card = page.locator("[data-card-item]").first();
		const geometry = await card.evaluate((element) => {
			const heading = element.querySelector<HTMLElement>("h3");
			const body = element.querySelector<HTMLElement>(
				".praxity-card-body--outline, .praxity-card-body--minimal",
			);
			if (!heading || !body) throw new Error("Missing card heading or body");
			const range = document.createRange();
			range.selectNodeContents(heading);
			const text = range.getBoundingClientRect();
			const style = getComputedStyle(heading);
			return {
				inset: text.left - element.getBoundingClientRect().left,
				leading: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize),
				gap: body.getBoundingClientRect().top - heading.getBoundingClientRect().bottom,
				bodyPadding: getComputedStyle(body).padding,
			};
		});
		expect.soft(geometry.inset, "unboxed heading meets the reading edge").toBeCloseTo(0, 0);
		expect.soft(geometry.leading, "block headings use heading leading").toBeLessThanOrEqual(1.25);
		expect.soft(geometry.gap, "heading to body gap is space-4").toBeCloseTo(16, 0);
		expect
			.soft(geometry.bodyPadding, "unboxed body keeps only divided-item vertical padding")
			.toBe(width === 390 ? "24px 0px" : "0px");
	});

	test(`reading geometry keeps stats numbers whole at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/reading-geometry/reading-geometry.html`);
		await page.evaluate(() => document.fonts.ready);
		await expect(page.locator(".praxity-stats-value")).toHaveText("142%");
		const lines = await page.locator(".praxity-stats-value").evaluate((element) => {
			const range = document.createRange();
			range.selectNodeContents(element);
			return new Set(Array.from(range.getClientRects(), (rect) => rect.top)).size;
		});
		expect(lines, "142% fits on one line").toBe(1);
	});

	test(`reading geometry preserves truncated comparison labels at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/reading-geometry/reading-geometry.html`);
		const labels = await page.locator(".praxity-comparison-label").evaluateAll((elements) =>
			elements.map((element) => ({
				text: element.textContent ?? "",
				display: getComputedStyle(element).display,
				overflow: getComputedStyle(element).textOverflow,
				title: element.getAttribute("title"),
				caption: element.closest("figure")?.querySelector("figcaption")?.textContent ?? "",
			})),
		);
		expect(labels).toHaveLength(2);
		const expectedLabels = [
			"Privacy and security settings before the change for international teams",
			"Privacy and security settings after the change for international teams",
		];
		for (const [index, label] of labels.entries()) {
			expect.soft(label.text).toBe(expectedLabels[index]);
			expect.soft(label.display).toBe("block");
			expect.soft(label.overflow).toBe("ellipsis");
			expect.soft(label.title).toBe(expectedLabels[index]);
			expect.soft(label.caption).toContain(expectedLabels[index]);
		}
	});

	test(`reading geometry keeps wide equation text reachable at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/reading-geometry/reading-geometry.html`);
		const equation = page.locator(".praxity-block-equation .praxity-math-block");
		const geometry = await equation.evaluate((element) => {
			const content = element.querySelector("math");
			if (!content) throw new Error("Missing display equation");
			const start = content.getBoundingClientRect().left - element.getBoundingClientRect().left;
			element.scrollLeft = element.scrollWidth;
			return {
				start,
				scrollLeft: element.scrollLeft,
				overflow: element.scrollWidth - element.clientWidth,
				overflowX: getComputedStyle(element).overflowX,
			};
		});
		expect.soft(geometry.start, "equation's left side is reachable").toBeGreaterThanOrEqual(-1);
		expect.soft(geometry.overflowX).toBe("auto");
		if (width === 390) {
			expect.soft(geometry.overflow, "fixture is wider than the phone").toBeGreaterThan(0);
			expect.soft(geometry.scrollLeft, "learner can reach the right side").toBeGreaterThan(0);
		}
	});
}

test("text wrapping follows sentence and title roles", async ({ page, browserName }) => {
	test.skip(browserName !== "chromium", "Chromium establishes the pretty wrapping contract");
	const rhythm = readFileSync(
		new URL("../../../shared-blocks/src/reading-rhythm.css", import.meta.url),
		"utf8",
	);
	const blocks = readFileSync(
		new URL("../../../shared-blocks/src/blocks/shared-blocks.css", import.meta.url),
		"utf8",
	).replace('@import "../reading-rhythm.css";', rhythm);
	await page.setContent(`<style>${blocks}</style><main data-praxity-root>
		<h1>Weekly reflection</h1>
		<section class="praxity-block praxity-block-assessment">
			<p class="praxity-assessment-stem">What did you notice this week when you tried to stay assertive?</p>
			<h2 class="praxity-assessment-stem">Highlight the passage that answers: Why does the other person feel ignored or rejected?</h2>
			<div class="praxity-assessment-stem"><p>Which response would help you stay assertive while acknowledging the other person's concerns?</p></div>
			<div class="praxity-assessment-stem-body"><h3>Explain how you would respond when the other person feels ignored or rejected.</h3></div>
			<div class="praxity-matching-prompt">Match each response to the concern it addresses.</div>
			<div data-assessment-feedback><h3>You acknowledged the concern before explaining your own needs.</h3></div>
			<div class="praxity-choice-feedback">You acknowledged the other person's concerns.</div>
		</section>
		<div class="praxity-chart-title">Weekly responses</div>
		<div class="praxity-chart-subtitle">These responses show how often you acknowledged the other person's concerns.</div>
		<figure class="praxity-dialogue" data-style="bubbles"><figcaption>Consider the speaker's response.</figcaption><div class="praxity-dialogue-text"><p>How would you respond when the other person feels ignored or rejected?</p></div></figure>
	</main>`);
	for (const sentence of await page
		.locator(
			".praxity-assessment-stem, .praxity-assessment-stem p, .praxity-assessment-stem-body, .praxity-assessment-stem-body h3, .praxity-matching-prompt, [data-assessment-feedback], [data-assessment-feedback] h3, .praxity-choice-feedback, .praxity-chart-subtitle, figcaption, .praxity-dialogue-text p",
		)
		.all()) {
		expect
			.soft(
				await sentence.evaluate((element) =>
					getComputedStyle(element).getPropertyValue("text-wrap-style"),
				),
				await sentence.innerText(),
			)
			.toBe("pretty");
	}
	await expect(page.locator("h1")).toHaveCSS("text-wrap-style", "balance");
	await expect(page.locator(".praxity-chart-title")).toHaveCSS("text-wrap-style", "balance");
});

for (const width of [1280, 390]) {
	test(`look v2 activity and reading tokens at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/assessment-blocks.html`);
		await waitForHydration(page);
		await hydrateContent(page);
		const card = page.locator(".praxity-block-assessment:not(.praxity-block)").first();
		await expect(card).toHaveCSS("border-top-left-radius", "16px");
		await expect(card).not.toHaveCSS("box-shadow", "none");
		await expect(card.locator(".praxity-assessment-choice-option").first()).toHaveCSS(
			"border-radius",
			"10px",
		);
		await expect(page.locator(".praxity-rating").first()).toHaveCSS("border-radius", "16px");
		// Firefox does not implement `pretty`; it keeps the default wrap there.
		if (await page.evaluate(() => CSS.supports("text-wrap", "pretty")))
			await expect(page.locator(".praxity-choice-label").first()).toHaveCSS(
				"text-wrap-style",
				"pretty",
			);
		await expect(page.locator("h1, h2, h3").first()).toHaveCSS("text-wrap-style", "balance");
		const tokens = await card.evaluate((e) =>
			Object.fromEntries(
				["--radius-key", "--duration-press", "--duration-state", "--duration-reveal"].map(
					(name) => {
						const value = getComputedStyle(e).getPropertyValue(name).trim();
						return [
							name,
							name === "--radius-key"
								? value
								: Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000),
						];
					},
				),
			),
		);
		expect(tokens).toEqual({
			"--radius-key": "6px",
			"--duration-press": 120,
			"--duration-state": 200,
			"--duration-reveal": 200,
		});
	});
}

for (const pseudo of ["::before", "::after"])
	for (const [name, rule, declaration] of [
		["shadow", 3, "box-shadow:0 1px 2px black"],
		["radius", 5, "border-radius:8px"],
		["font", 10, "font-family:Inter"],
	] as const)
		test(`design guard catches ${pseudo} ${name}`, async ({ page }) => {
			await page.setContent(
				`<style>body{font-family:'Source Sans 3',sans-serif}.planted${pseudo}{content:"paint";display:block;${declaration}}</style><div class="planted">Host</div>`,
			);
			expect((await inspect(page)).failures[rule]).not.toEqual([]);
		});

test("disclosure chevrons align with the first label line and rules stay straight", async ({
	page,
}) => {
	const rhythm = readFileSync(
		new URL("../../../shared-blocks/src/reading-rhythm.css", import.meta.url),
		"utf8",
	);
	const blocks = readFileSync(
		new URL("../../../shared-blocks/src/blocks/shared-blocks.css", import.meta.url),
		"utf8",
	).replace('@import "../reading-rhythm.css";', rhythm);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.setContent(`<style>${blocks}</style><main data-praxity-root style="width:300px;font:18px/1.55 sans-serif">
		<section class="praxity-accordion-static"><button class="praxity-disclosure-trigger"><span class="praxity-disclosure-title">A long label that wraps onto several lines while the chevron stays beside the first line of text</span><svg class="praxity-disclosure-icon" width="20" height="20"></svg></button></section>
		<div data-disclosure="true"><button class="praxity-tabs-tab praxity-disclosure-trigger"><span class="praxity-disclosure-title">Another long disclosure label that wraps onto several lines with a straight top rule</span><svg class="praxity-disclosure-icon" width="20" height="20"></svg></button></div>
	</main>`);
	for (const selector of [
		".praxity-accordion-static .praxity-disclosure-trigger",
		".praxity-tabs-tab",
	]) {
		const geometry = await page.locator(selector).evaluate((trigger) => {
			const title = trigger.querySelector(".praxity-disclosure-title");
			const icon = trigger.querySelector("svg");
			if (!title || !icon) throw new Error("Missing disclosure label or chevron");
			const line = Number.parseFloat(getComputedStyle(title).lineHeight);
			return {
				lines: title.getBoundingClientRect().height / line,
				firstLineCenter: title.getBoundingClientRect().top + line / 2,
				iconCenter: icon.getBoundingClientRect().top + icon.getBoundingClientRect().height / 2,
			};
		});
		expect(geometry.lines).toBeGreaterThan(2);
		expect.soft(Math.abs(geometry.firstLineCenter - geometry.iconCenter)).toBeLessThanOrEqual(1);
	}
	await expect(page.locator(".praxity-tabs-tab")).toHaveCSS("border-radius", "0px");
});

test("desktop sidebar toggle has no dormant transition", async ({ page }) => {
	const shell = readFileSync(
		new URL("../../../shared-blocks/src/viewer/viewer-shell.css", import.meta.url),
		"utf8",
	);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.setContent(
		`<style>${shell}</style><main class="praxity-layout-sidebar"><nav class="praxity-course-menu">Outline</nav></main>`,
	);
	await expect(page.locator("nav")).toHaveCSS("transition-duration", "0s");
});

test("rule 12 uses motion tokens for shell and carousel transitions", async ({ page }) => {
	const source = (file: string) =>
		readFileSync(new URL(`../../../shared-blocks/src/${file}`, import.meta.url), "utf8");
	const rhythm = source("reading-rhythm.css");
	const blocks = source("blocks/shared-blocks.css").replace(
		'@import "../reading-rhythm.css";',
		rhythm,
	);
	const library = readFileSync(
		new URL("../../node_modules/@mantine/core/styles.css", import.meta.url),
		"utf8",
	);
	const controls = renderToStaticMarkup(
		createElement(
			MantineProvider,
			{ forceColorScheme: "light" },
			createElement(
				"div",
				{ className: "praxity-block-assessment" },
				createElement(Radio, { label: "Matrix statement" }),
				createElement(Button<"button">, null, "Check"),
			),
		),
	);
	await page.setContent(`<style>${library}${rhythm}${blocks}${source("viewer/viewer-shell.css")}</style>
		<main data-praxity-root data-praxity-focus-mode="true">
			<button class="praxity-sidebar-collapse">Collapse</button>
			<button class="praxity-sidebar-expand">Expand</button>
			<button class="praxity-hamburger">Outline</button>
			<button class="praxity-outline-drawer__close">Close</button>
			<button class="praxity-toc-bar">Contents</button>
			<footer class="praxity-embed-nav">Footer</footer>
			<button class="praxity-labeled-graphic-dot">1</button>
			<label class="praxity-rating-emoji" data-rating-active="true">Rating</label>
			${controls}
			<input class="praxity-ag-radio" type="radio" aria-label="Question group" />
			<p data-focus-row data-focus-dimmed>Reading guide</p>
			<div role="progressbar"><div class="praxity-scroll-progress-fill" style="width:200px;height:2px;transform:none">Progress</div></div>
			<div data-praxity-root data-praxity-motion-entrance="fade"><p class="praxity-block" data-entrance="visible">Saved course entrance</p></div>
			${["fade", "slide", "zoom"].map((mode) => `<div class="praxity-slides-grid" data-transition="${mode}"><div class="praxity-slides-item" data-active="true">Card</div><div class="praxity-slides-item" data-active="false">Outgoing card</div></div>`).join("")}
		</main>`);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	expect((await inspect(page)).failures[11]).toEqual([]);
	await page.emulateMedia({ reducedMotion: "reduce" });
	expect((await inspect(page)).failures[11]).toEqual([]);
});

for (const [name, declaration] of [
	["non-token duration", "transition:transform 150ms cubic-bezier(.2,.8,.2,1)"],
	["keyword easing", "transition:opacity 200ms ease-out"],
	["linear non-progress", "transition:opacity 200ms linear"],
	[
		"second non-token easing",
		"transition:transform 120ms cubic-bezier(.2,.8,.2,1),opacity 200ms ease",
	],
	[
		"second non-token duration",
		"transition:transform 120ms cubic-bezier(.2,.8,.2,1),opacity 150ms cubic-bezier(.2,.8,.2,1)",
	],
	["repeated animation", "animation:move 200ms 3"],
	["infinite animation", "animation:move 200ms infinite"],
	["delayed animation", "animation:move 200ms 4s"],
	["delayed transition", "transition:transform 200ms 4s;transform:translateY(6px)"],
] as const)
	test(`design guard catches learner-started ${name}`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.setContent(
			`<style>button{transform:none}.run{${declaration}}@keyframes move{to{transform:translateY(6px)}}</style><button>Reveal</button>`,
		);
		await page
			.locator("button")
			.evaluate((e) => e.addEventListener("click", () => e.classList.add("run")));
		await page.getByRole("button").click();
		expect((await inspect(page)).failures[11]).not.toEqual([]);
	});

for (const [name, rule, markup] of [
	["unowned shadow", 3, '<div style="box-shadow:0 1px 2px black">Shadow</div>'],
	[
		"wrong floating token",
		3,
		'<div class="praxity-floating-layer" style="box-shadow:0 1px 2px black">Menu</div>',
	],
	[
		"wrong activity token",
		3,
		'<div class="praxity-block-rating"><fieldset class="praxity-fieldset-reset" style="box-shadow:0 1px 2px black">Rating</fieldset></div>',
	],
	[
		"tinted shadow with a side border",
		4,
		'<div style="border-left:1px solid black;background:pink;box-shadow:0 1px 2px black">Tint</div>',
	],
	[
		"nested boxes",
		4,
		'<div style="border:1px solid black;border-radius:16px"><div style="border:1px solid black;border-radius:10px">Nested</div></div>',
	],
	["rounded stripe", 4, '<div style="border-left:3px solid black;border-radius:10px">Stripe</div>'],
	["retired radius", 5, '<div style="border-radius:8px">Radius</div>'],
	["square button", 5, '<button style="border-radius:0">Check</button>'],
	["authored input radius", 5, '<input style="border-radius:3px" aria-label="Response">'],
	[
		"square rating key",
		5,
		'<label class="praxity-rating-numeric" style="border-radius:0">1</label>',
	],
	["wide pill", 5, '<div style="width:80px;height:20px;border-radius:999px">Pill</div>'],
	[
		"partial circle",
		5,
		'<div style="width:20px;height:20px;border-radius:999px 0 0 0">Corner</div>',
	],
	[
		"unknown fallback font",
		10,
		'<p style="font-family:&quot;Source Sans 3&quot;,Inter,sans-serif">Font</p>',
	],
	["code font", 10, '<code style="font-family:Inter">Code</code>'],
	["long transition", 11, '<button style="transition:transform 400ms">Move</button>'],
	["transition all", 11, '<button style="transition:all 200ms">All</button>'],
	["long animation", 11, '<button style="animation:move 400ms">Animate</button>'],
	[
		"clipped text",
		12,
		'<p style="width:40px;overflow:hidden;white-space:nowrap">The learner needs the full sentence.</p>',
	],
	[
		"flex label without working ellipsis",
		12,
		'<figure><span class="praxity-comparison-label" title="Privacy settings" style="display:inline-flex;width:40px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Privacy settings</span><figcaption>Privacy settings</figcaption></figure>',
	],
	[
		"truncated label with a hidden caption",
		12,
		'<figure><span class="praxity-comparison-label" title="Privacy settings" style="display:block;width:40px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Privacy settings</span><figcaption hidden>Privacy settings</figcaption></figure>',
	],
] as const) {
	test(`design guard catches ${name}`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.setContent(
			`<style>body{font-family:'Source Sans 3',sans-serif;background:white;--shadow-floating:0 8px 24px rgb(0 0 0 / .12);--shadow-card:0 1px 2px rgb(22 24 29 / .05)}button{font:inherit}@keyframes move{from{transform:translateY(6px)}to{transform:none}}</style><main id="main-content">${markup}</main>`,
		);
		expect((await inspect(page)).failures[rule]).not.toEqual([]);
	});
}

test("design guard admits scrollable text and comparison labels with a visible caption", async ({
	page,
}) => {
	await page.setContent(`<main id="main-content">
		<div style="width:40px;overflow-x:auto"><p style="white-space:nowrap">Read the full sentence.</p></div>
		<figure><span class="praxity-comparison-label" title="Privacy settings" style="display:block;width:40px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Privacy settings</span><figcaption>Privacy settings</figcaption></figure>
	</main>`);
	expect((await inspect(page)).failures[12]).toEqual([]);
});

test("design guard admits role tokens and the in-row result pill", async ({ page }) => {
	await page.setContent(
		`<style>body{font-family:'Source Sans 3',sans-serif;background:white;--shadow-floating:0 8px 24px rgb(0 0 0 / .12);--shadow-card:0 1px 2px rgb(22 24 29 / .05)}</style><main id="main-content"><div class="praxity-floating-layer" style="box-shadow:var(--shadow-floating)">Menu</div><div class="praxity-block-rating"><fieldset class="praxity-fieldset-reset" style="border:1px solid black;border-radius:16px;background:pink;box-shadow:var(--shadow-card)">Activity</fieldset></div><div class="praxity-progress-dot" style="width:20px;height:20px;border-radius:50%">Mark</div><div class="praxity-assessment-choice-option" style="border-radius:10px"><span class="praxity-choice-status" style="border-radius:999px">Correct</span></div><code style="font-family:monospace">Code</code><span class="katex" style="font-family:KaTeX_Main,serif">Math</span></main>`,
	);
	const result = await inspect(page);
	for (const rule of [3, 4, 5, 10, 11]) expect(result.failures[rule]).toEqual([]);
});

for (const pseudo of ["::before", "::after"])
	test(`design guard admits ${pseudo} tokens and narrow font/radius exceptions`, async ({
		page,
	}) => {
		await page.setContent(`<style>
			body{font-family:'Source Sans 3',sans-serif;--shadow-floating:0 8px 24px rgb(0 0 0 / .12);--shadow-card:0 1px 2px rgb(22 24 29 / .05)}
			.painted${pseudo}{content:"paint";display:block;border-radius:10px}
			.praxity-floating-layer${pseudo}{box-shadow:var(--shadow-floating)}
			.praxity-fieldset-reset{border-radius:16px}
            .praxity-fieldset-reset${pseudo}{box-shadow:var(--shadow-card)}
			.dot${pseudo}{content:"";width:20px;height:20px;border-radius:4px}
			.praxity-choice-status${pseudo}{border-radius:999px}
			code${pseudo}{font-family:monospace}.katex${pseudo}{font-family:KaTeX_Main,serif}
			.unpainted${pseudo}{content:"";width:0;height:0;font-family:Inter;border-radius:8px}
			.absent${pseudo}{content:none;box-shadow:0 1px 2px black}
			.hidden${pseudo}{display:none;box-shadow:0 1px 2px black}
		</style><main id="main-content"><div class="painted praxity-floating-layer">Menu</div>
		<div class="praxity-block-rating"><fieldset class="painted praxity-fieldset-reset">Activity</fieldset></div>
		<div class="painted dot">Dot on a wide host</div>
		<div class="praxity-assessment-choice-option" style="border-radius:10px"><span class="painted praxity-choice-status">Correct</span></div>
		<code class="painted">Code</code><span class="painted katex">Math</span>
		<div class="unpainted">Host</div><div class="painted absent">Host</div><div class="painted hidden">Host</div></main>`);
		const result = await inspect(page);
		for (const rule of [3, 5, 10]) expect(result.failures[rule]).toEqual([]);
	});

for (const property of ["background-color", "border-color", "outline-color", "box-shadow"]) {
	test(`design guard rejects large paint transition ${property}`, async ({ page }) => {
		await page.setContent(
			`<div style="width:600px;height:180px;transition:${property} 150ms">Panel</div>`,
		);
		expect((await inspect(page)).failures[11]).not.toEqual([]);
	});
}

for (const selector of ["praxity-flashcard-face--back", "inline-tooltip-popover"]) {
	test(`design guard rejects revealed content fade ${selector}`, async ({ page }) => {
		await page.setContent(
			`<style>@keyframes reveal{from{opacity:0}to{opacity:1}}</style><div class="${selector}" style="animation:reveal 200ms">Answer</div>`,
		);
		expect((await inspect(page)).failures[11]).not.toEqual([]);
	});
}

test("rule 12 rejects a reveal that fades without opening space", async ({ page }) => {
	await page.setContent(
		'<div data-content-reveal="open" style="transition:opacity 200ms">Answer</div>',
	);
	expect((await inspect(page)).failures[11]).not.toEqual([]);
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
	for (const method of ["scrollIntoView", "scrollTo", "scrollBy"] as const) {
		test(`design guard rejects ${reducedMotion} smooth ${method}`, async ({ page }) => {
			await page.emulateMedia({ reducedMotion });
			await page.setContent('<div style="height:2000px">Scroll</div><button>Destination</button>');
			await page
				.getByRole("button")
				.evaluate(
					(element, method) => Reflect.apply(element[method], element, [{ behavior: "smooth" }]),
					method,
				);
			expect((await inspect(page)).failures[11]).not.toEqual([]);
		});
	}
}

test("design guard rejects CSS smooth scrolling under reduced motion", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.setContent(
		'<div style="overflow:auto;height:100px;scroll-behavior:smooth"><p style="height:2000px">Scroll</p></div>',
	);
	expect((await inspect(page)).failures[11]).not.toEqual([]);
});

test("design guard requires zero motion under reduced motion, including pseudo-elements", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.setContent(
		'<style>button{transition:transform 200ms}button::after{content:"answer";animation:move 200ms}@keyframes move{from{transform:translateY(6px)}to{transform:none}}</style><button>Reveal</button>',
	);
	expect((await inspect(page)).failures[11]).toHaveLength(2);
	await page.addStyleTag({
		content: "*,*::before,*::after{transition:none!important;animation:none!important}",
	});
	expect((await inspect(page)).failures[11]).toEqual([]);
	await expect(page.locator("button")).toHaveCSS("transform", "none");
});

test("design guard exempts only active linear progress motion", async ({ page }) => {
	await page.setContent(
		'<div role="progressbar" style="transition:transform 600ms linear">Progress</div>',
	);
	expect((await inspect(page)).failures[11]).toEqual([]);
	await page
		.locator("[role=progressbar]")
		.evaluate((e) => e.setAttribute("style", "transition:opacity 100ms, all 100ms"));
	expect((await inspect(page)).failures[11]).toHaveLength(1);
});

test("design guard rejects infinite progress even with linear timing", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.setContent(
		'<style>@keyframes move{to{transform:translateX(6px)}}[role=progressbar]{animation:move 200ms infinite linear}</style><div role="progressbar">Progress</div>',
	);
	expect((await inspect(page)).failures[11]).not.toEqual([]);
	await page.addStyleTag({ content: "[role=progressbar]{animation-timing-function:ease}" });
	expect((await inspect(page)).failures[11]).not.toEqual([]);
	await page.addStyleTag({ content: "[role=progressbar]{animation-timing-function:linear}" });
	await page.emulateMedia({ reducedMotion: "reduce" });
	expect((await inspect(page)).failures[11]).not.toEqual([]);
	await page.addStyleTag({ content: "[role=progressbar]{animation:none}" });
	expect((await inspect(page)).failures[11]).toEqual([]);
});

test("design guard rejects looping browser effects including linear progress", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	for (const easing of ["ease", "linear"]) {
		await page.setContent('<div role="progressbar">Progress</div>');
		await page.locator('[role="progressbar"]').evaluate((e, easing) => {
			e.animate([{ opacity: 1 }, { opacity: 0.5 }], {
				duration: 200,
				iterations: Infinity,
				easing,
			});
		}, easing);
		const failures = (await inspect(page)).failures[11];
		expect(failures).not.toEqual([]);
	}
});

test("design guard keeps the elapsed ceiling at exactly 300ms", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	for (const [duration, allowed] of [
		[300, true],
		[300.001, false],
	] as const) {
		await page.setContent(
			`<style>@keyframes move{to{opacity:.5}}button{animation:move ${duration}ms}</style><button>Move</button>`,
		);
		const failures = (await inspect(page)).failures[11];
		if (allowed) expect(failures).toEqual([]);
		else expect(failures).not.toEqual([]);
	}
});

test("published sequential entrances include their delay in the 300ms budget", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto(`${readTestEnv().url}/design-layout-motionStagger-sequential/layout-audit.html`);
	await waitForHydration(page);
	await page.evaluate(() => {
		for (const e of document.querySelectorAll<HTMLElement>(
			".praxity-block, .praxity-sequence-item",
		)) {
			e.dataset.entrance = "visible";
			e.style.setProperty("--praxity-stagger-index", "20");
			e.style.setProperty("--i", "20");
		}
	});
	expect((await inspect(page)).failures[11]).toEqual([]);
});

test("published motion stops decorative loops and shows reduced-motion end states", async ({
	page,
}) => {
	await page.goto(`${readTestEnv().url}/assessment-blocks.html`);
	await page.evaluate(() => {
		const host = document.createElement("div");
		host.innerHTML =
			'<div class="praxity-block-loading">Loading</div><button class="praxity-labeled-graphic-dot praxity-labeled-graphic-dot--next">1</button><div id="motion-end">Revealed content</div>';
		document.body.append(host);
	});
	for (const selector of [".praxity-block-loading", ".praxity-labeled-graphic-dot--next"])
		expect(
			await page
				.locator(selector)
				.last()
				.evaluate((e) => getComputedStyle(e, "::before").animationName),
		).toBe("none");
	await page.addStyleTag({
		content:
			"#motion-end { animation: motion-end 200ms both; transition: color 120ms; } @keyframes motion-end { from { transform: translateY(6px); opacity: 0; } to { transform: none; opacity: 1; } }",
	});
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect(page.locator("#motion-end")).toHaveCSS("animation-duration", "0s");
	await expect(page.locator("#motion-end")).toHaveCSS("transition-duration", "0s");
	await expect(page.locator("#motion-end")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
	await expect(page.locator("#motion-end")).toHaveCSS("opacity", "1");
});

// Exercise the authored activity contract through the compiled learner output.
async function openFeedbackQuestion(page: Page, width: number, authored = true, required = true) {
	await page.setViewportSize({ width, height: 844 });
	await page.route("**/activity-bugs-en/activity-fixes.html", async (route) => {
		const response = await route.fetch();
		const rewrite = (json: string) => {
			const value = JSON.parse(json);
			const visit = (node: unknown) => {
				if (!node || typeof node !== "object") return;
				if ("assessmentType" in node && node.assessmentType === "choice") {
					Object.assign(node, { required, ...(authored ? {} : { feedback: {} }) });
				}
				Object.values(node).forEach(visit);
			};
			visit(value);
			return JSON.stringify(value);
		};
		await route.fulfill({
			response,
			body: (await response.text())
				.replace(
					/data-block-json='([^']*)'/g,
					(_, json) => `data-block-json='${rewrite(json).replaceAll("'", "&#39;")}'`,
				)
				.replace(
					/(<script[^>]*type="application\/json"[^>]*>)([\s\S]*?)(<\/script>)/g,
					(_, start, json, end) => start + rewrite(json) + end,
				),
		});
	});
	await page.goto(`${readTestEnv().url}/activity-bugs-en/activity-fixes.html`);
	const island = page.locator('[data-island="assessment"][data-block-id="choice"]');
	await island.scrollIntoViewIfNeeded();
	await expect(island).toHaveAttribute("data-hydrated", "");
	const block = island.locator(".praxity-block-assessment");
	await block.getByRole("radio", { name: "Interrupt", exact: true }).check();
	await block.locator("[data-assessment-submit]").focus();
	await page.keyboard.press("Enter");
	// Continue discovers its next target after the submitted render commits.
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	return block;
}

for (const width of [1280, 390]) {
	test(`feedback summary has only a top rule and preserves focus at ${width}px`, async ({
		page,
	}) => {
		const block = await openFeedbackQuestion(page, width);
		const summary = block.locator("[data-assessment-feedback]");
		await expect(
			block.locator("[data-assessment-retry], [data-assessment-continue]").first(),
		).toBeFocused();
		await expect(
			block.locator("[data-assessment-retry], [data-assessment-continue]").first(),
		).toHaveAccessibleDescription("Not quite Consider how the other person feels.");
		await expect.soft(summary).toHaveCSS("outline-style", "none");
		await expect(summary).toHaveCSS("border-top-width", "1px");
		for (const side of ["left", "right", "bottom"])
			await expect.soft(summary).toHaveCSS(`border-${side}-width`, "0px");
		const retry = block.getByRole("button", { name: "Try again", exact: true });
		await expect(retry).toBeFocused();
		// WebKit's programmatic focus uses its native outline until keyboard traversal.
		await page.keyboard.press("Tab");
		await page.keyboard.press("Shift+Tab");
		await expect(retry).toBeFocused();
		await expect(retry).toHaveCSS("outline-width", "2px");
	});
	test(`feedback summary contains authored text without a repeated verdict at ${width}px`, async ({
		page,
	}) => {
		const block = await openFeedbackQuestion(page, width);
		await expect.soft(block.locator("[data-assessment-feedback]")).not.toContainText("Not quite");
		await expect(block.locator("[data-feedback-details]")).toHaveText(
			"Feedback: Consider how the other person feels.",
		);
		await expect(block.locator("[data-option-feedback]")).toContainText("Not quite");
	});
	test(`feedback summary uses one attempt status without authored feedback at ${width}px`, async ({
		page,
	}) => {
		const block = await openFeedbackQuestion(page, width, false);
		const summary = block.locator("[data-assessment-feedback]");
		await expect.soft(summary).not.toContainText("Not quite");
		await expect(summary).toHaveText("1 of 2 attempts usedTry again");
	});
	for (const required of [true, false]) {
		test(`feedback Continue is actionable for ${required ? "required" : "skippable"} questions at ${width}px`, async ({
			page,
		}) => {
			const block = await openFeedbackQuestion(page, width, true, required);
			const next = block.getByRole("button", { name: "Continue", exact: true });
			const retry = block.getByRole("button", { name: "Try again", exact: true });
			await expect(retry).toHaveAttribute("data-variant", "outline");
			for (const action of await block.locator("button:visible").all()) {
				// Firefox protocol quads lose precision when subtracting large
				// positions (44 becomes 43.999969). DOMRect retains the CSS size.
				const bounds = await action.evaluate((element) => {
					const rect = element.getBoundingClientRect();
					return { width: rect.width, height: rect.height };
				});
				expect
					.soft(bounds.width, "submitted action width")
					.toBeGreaterThanOrEqual(44 - LAYOUT_UNIT);
				expect
					.soft(bounds.height, "submitted action height")
					.toBeGreaterThanOrEqual(44 - LAYOUT_UNIT);
			}
			if (required) await expect.soft(next).toHaveCount(0);
			else await expect(next).toBeEnabled();
			await retry.click();
			await block.getByRole("radio", { name: "Interrupt", exact: true }).check();
			await block.locator("[data-assessment-submit]").click();
			await expect(retry).toHaveCount(0);
			await expect(next).toBeEnabled();
			const bounds = await next.evaluate((element) => {
				const rect = element.getBoundingClientRect();
				return { width: rect.width, height: rect.height };
			});
			expect
				.soft(bounds.width, "Continue width after final attempt")
				.toBeGreaterThanOrEqual(44 - LAYOUT_UNIT);
			expect
				.soft(bounds.height, "Continue height after final attempt")
				.toBeGreaterThanOrEqual(44 - LAYOUT_UNIT);
			await next.click();
			await expect(page.locator('[data-block-id="rating"] input').first()).toBeFocused();
		});
	}
}

for (const width of [1280, 390]) {
	test(`activity legends stay inside their fieldsets at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		const course = courses().find((c) => c.name === "comprehensive");
		if (!course) throw new Error("Missing comprehensive design-system export");
		let count = 0;
		for (const url of [
			`${course.url}/interactive-and-social-blocks.html`,
			`${readTestEnv().url}/activity-bugs-en/activity-fixes.html`,
			`${readTestEnv().url}/oneof-group/page-three-assessment.html`,
		]) {
			await page.goto(url);
			await waitForHydration(page);
			await hydrateContent(page);
			const legends = await page
				.locator("fieldset > legend:not(.praxity-sr-only)")
				.evaluateAll((elements) =>
					elements.map((legend) => {
						const fieldset = legend.parentElement;
						if (!fieldset) throw new Error("Missing fieldset");
						const style = getComputedStyle(fieldset);
						const box = fieldset.getBoundingClientRect();
						const bounds = legend.getBoundingClientRect();
						return {
							text: legend.textContent,
							top: bounds.top - box.top,
							inset: Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop),
							bottom: bounds.bottom <= box.bottom,
						};
					}),
				);
			count += legends.length;
			for (const legend of legends) {
				expect
					.soft(legend.top, legend.text ?? "legend inset")
					.toBeGreaterThanOrEqual(legend.inset - LAYOUT_UNIT);
				expect.soft(legend.bottom, "legend within bottom border").toBe(true);
			}
		}
		expect(count, "rating, checklist and group picker legends").toBeGreaterThanOrEqual(3);
	});
	test(`Tools has aligned 44px rows and a labelled switch at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		const course = courses().find((c) => c.name === "leadership");
		await page.goto(
			course
				? `${course.url}/${course.entries[0]}`
				: `${readTestEnv().url}/design-deck-narrated/introduction.html`,
		);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await page.locator("#deck-more-toggle").click();
		const menu = page.locator("#deck-more-panel");
		const advance = menu.getByRole("switch", { name: "Avancer automatiquement", exact: true });
		await expect.soft(advance).toBeVisible();
		await expect.soft(page.locator("#deck-advance")).toHaveAttribute("aria-checked", "false");
		const rows = await menu
			.locator("button:visible, .praxity-narration-time:visible")
			.evaluateAll((elements) =>
				elements.map((element) => {
					const bounds = element.getBoundingClientRect();
					const style = getComputedStyle(element);
					return {
						text: element.textContent,
						height: bounds.height,
						inset: bounds.left + Number.parseFloat(style.paddingLeft),
					};
				}),
			);
		expect(rows.length).toBeGreaterThanOrEqual(5);
		for (const row of rows) {
			expect.soft(row.height, row.text ?? "row height").toBeGreaterThanOrEqual(44 - LAYOUT_UNIT);
			expect.soft(row.inset, row.text ?? "row inset").toBeCloseTo(rows[0].inset, 0);
		}
		await page.locator("#deck-advance").focus();
		await page.keyboard.press("Space");
		await expect.soft(page.locator("#deck-advance")).toHaveAttribute("aria-checked", "true");
		await page.keyboard.press("Space");
		await expect.soft(page.locator("#deck-advance")).toHaveAttribute("aria-checked", "false");
	});
}

test("aborted embed navigation replaces the frame with its fallback", async ({ page }) => {
	const course = courses().find((c) => c.name === "comprehensive");
	if (!course) throw new Error("Missing comprehensive design-system export");
	await page.route("**/rich-content-and-typography.html", async (route) => {
		const response = await route.fetch();
		const headers = { ...response.headers() };
		delete headers["content-security-policy"];
		await route.fulfill({ response, headers });
	});
	await page.route("https://**", (route) => route.abort("aborted"));
	await page.goto(`${course.url}/rich-content-and-typography.html`);
	await waitForHydration(page);
	const embed = page
		.locator('[data-block-type="embed"]')
		.filter({ has: page.locator("iframe[data-embed-src]") })
		.first();
	await embed.scrollIntoViewIfNeeded();
	await expect(embed).toHaveAttribute("data-hydrated", "");
	await expect(embed.locator("iframe")).toBeHidden();
	const bounds = await embed.evaluate((element) => {
		const frame = element.querySelector(".praxity-media-frame");
		const fallback = element.querySelector(".praxity-media-fallback");
		if (!frame || !fallback) throw new Error("Missing embed fallback frame");
		const style = getComputedStyle(frame);
		return {
			height: frame.getBoundingClientRect().height,
			fallback:
				fallback.getBoundingClientRect().height +
				Number.parseFloat(style.borderTopWidth) +
				Number.parseFloat(style.borderBottomWidth),
		};
	});
	expect(bounds.height).toBeCloseTo(bounds.fallback, 1);
	await embed.getByRole("button", { name: "Show embedded content", exact: true }).click();
	await expect(embed.locator("iframe")).toBeVisible();
	await expect(embed.locator("iframe")).toBeFocused();
});

test("a confirming provider stays visible beyond the embed fallback deadline", async ({ page }) => {
	const course = courses().find((c) => c.name === "comprehensive");
	if (!course) throw new Error("Missing comprehensive design-system export");
	await page.route("**/rich-content-and-typography.html", async (route) => {
		const response = await route.fetch();
		const headers = { ...response.headers() };
		delete headers["content-security-policy"];
		await route.fulfill({ response, headers });
	});
	await page.route("https://www.figma.com/**", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: '<!doctype html><script>parent.postMessage("ready", "*")</script><p>Loaded provider</p>',
		}),
	);
	await page.goto(`${course.url}/rich-content-and-typography.html`);
	const embed = page
		.locator('[data-block-type="embed"]')
		.filter({ has: page.locator("iframe[data-embed-src]") })
		.first();
	await embed.scrollIntoViewIfNeeded();
	await expect(embed).toHaveAttribute("data-hydrated", "");
	await expect(embed.locator("iframe").contentFrame().getByText("Loaded provider")).toBeVisible();
	// Real elapsed time establishes that confirmation cancelled the fallback timer.
	await page.waitForTimeout(3200);
	await expect(embed.locator("iframe")).toBeVisible();
	await expect(
		embed.getByRole("button", { name: "Show embedded content", exact: true }),
	).toBeHidden();
});

for (const width of [1280, 390]) {
	test(`activity layout follows section 6 at ${width}px`, async ({ page }) => {
		const course = courses().find((c) => c.name === "comprehensive");
		if (!course) throw new Error("Missing comprehensive design-system export");
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${course.url}/assessment-blocks.html`);
		await waitForHydration(page);
		await hydrateContent(page);
		const layouts = await page
			.locator(".mantine-Card-root.praxity-block-assessment")
			.evaluateAll((cards) =>
				cards.map((card) => {
					const stem = card.querySelector(".praxity-assessment-stem");
					if (!stem) throw new Error("Missing stem");
					const points = card.querySelector(".praxity-assessment-points");
					const actions = card.querySelector(".praxity-assessment-actions");
					const style = getComputedStyle(stem);
					return {
						font: style.fontSize,
						lineHeight: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize),
						expected: style.getPropertyValue("--type-h3").trim(),
						pointsBelow:
							!points || points.getBoundingClientRect().top >= stem.getBoundingClientRect().bottom,
						emptyActionHeight:
							actions && !actions.textContent?.trim() ? actions.getBoundingClientRect().height : 0,
					};
				}),
			);
		for (const layout of layouts) {
			expect.soft(layout.pointsBelow, "points below stem").toBe(true);
			expect.soft(layout.emptyActionHeight, "no reserved action band").toBe(0);
			expect.soft(Number.parseFloat(layout.font)).toBe(width === 390 ? 21 : 24);
			expect.soft(layout.lineHeight, "heading line height").toBeCloseTo(1.2);
		}
		for (const option of await page.locator(".praxity-assessment-choice-option").all()) {
			await expect(option).toHaveCSS("border-top-width", "1px");
			await expect(option).toHaveCSS("border-radius", "10px");
			await expect(option).toHaveCSS("padding-top", "10px");
			await expect(option).toHaveCSS("padding-left", "14px");
		}
	});
	test(`choice indicators use letter keys and square checkboxes at ${width}px`, async ({
		page,
	}) => {
		const course = courses().find((c) => c.name === "comprehensive");
		if (!course) throw new Error("Missing comprehensive design-system export");
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${course.url}/assessment-blocks.html`);
		await waitForHydration(page);
		await hydrateContent(page);
		for (const type of ["radio", "checkbox"]) {
			const inputs = page.locator(
				`.praxity-assessment-choice-option:not([data-dont-know]) input[type="${type}"]`,
			);
			expect(await inputs.count()).toBeGreaterThan(0);
			for (const input of await inputs.all()) {
				const shape = await input.evaluate((e) => {
					const key = e
						.closest(".praxity-assessment-choice-option")
						?.querySelector(".praxity-choice-key");
					const painted = key ?? e;
					return {
						width: painted.getBoundingClientRect().width,
						radius: Number.parseFloat(getComputedStyle(painted).borderTopLeftRadius),
						hiddenRadio: key ? getComputedStyle(e).opacity === "0" : false,
					};
				});
				expect(shape.width).toBe(type === "radio" ? 26 : 22);
				expect.soft(shape.radius).toBe(6);
				if (type === "radio") expect(shape.hiddenRadio).toBe(true);
			}
		}
	});
	test(`option rows keep closed borders and 8px gaps at ${width}px`, async ({ page }) => {
		const course = courses().find((c) => c.name === "comprehensive");
		if (!course) throw new Error("Missing comprehensive design-system export");
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${course.url}/assessment-blocks.html`);
		await waitForHydration(page);
		await hydrateContent(page);
		const rows = await page.locator(".praxity-assessment-choice-option").evaluateAll((elements) =>
			elements.map((e) => {
				const style = getComputedStyle(e);
				const next = e.nextElementSibling;
				const adjacent = next?.matches(".praxity-assessment-choice-option") ? next : null;
				const sides = [style.borderLeftWidth, style.borderRightWidth].map(Number.parseFloat);
				const gap = adjacent
					? adjacent.getBoundingClientRect().top - e.getBoundingClientRect().bottom
					: null;
				// Closed option boxes have short side borders joining their horizontal edges.
				// Two unjoined horizontal rules within 12px are the phone regression.
				const parallelRules =
					adjacent &&
					gap !== null &&
					gap > 0 &&
					gap < 12 &&
					Number.parseFloat(style.borderBottomWidth) > 0 &&
					Number.parseFloat(getComputedStyle(adjacent).borderTopWidth) > 0 &&
					(sides.some((side) => side === 0) ||
						[
							getComputedStyle(adjacent).borderLeftWidth,
							getComputedStyle(adjacent).borderRightWidth,
						].some((side) => Number.parseFloat(side) === 0));
				return {
					sides,
					radius: Number.parseFloat(style.borderTopLeftRadius),
					gap,
					uncertaintyDivider: adjacent?.hasAttribute("data-dont-know") === true,
					parallelRules: !!parallelRules,
				};
			}),
		);
		expect(rows.length).toBeGreaterThan(1);
		for (const row of rows) {
			expect
				.soft(row.parallelRules, "adjacent rows must not form double rules within 12px")
				.toBe(false);
			expect.soft(row.sides).toEqual([1, 1]);
			expect.soft(row.radius).toBe(10);
			if (row.gap !== null) expect.soft(row.gap).toBeCloseTo(row.uncertaintyDivider ? 17 : 8, 1);
		}
	});
}

async function hydrateContent(page: Page) {
	const islands = await page
		.locator("#main-content [data-island][data-block-id]")
		.evaluateAll((elements) =>
			elements.map((element) => ({
				id: element.getAttribute("data-block-id"),
				kind: element.getAttribute("data-island"),
			})),
		);
	for (const { id, kind } of islands) {
		const island = page.locator(`#main-content [data-island="${kind}"][data-block-id="${id}"]`);
		if (
			!(await island.isVisible()) ||
			(await island.evaluate((e) => !!e.closest("[hidden], [inert]")))
		)
			continue;
		await island.scrollIntoViewIfNeeded();
		await expect(island).toHaveAttribute("data-hydrated", "");
	}
	await page.evaluate(() => {
		document.querySelector("#main-content")?.scrollTo(0, 0);
		window.scrollTo(0, 0);
	});
}

test("deck footer Next remains actionable at retries and the final slide", async ({ page }) => {
	await page.goto(`${readTestEnv().url}/design-deck/introduction.html`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const next = page.locator("#deck-next");
	await next.click();
	for (let index = 0; index < 2; index++) {
		const slide = page.locator(".deck-slide:not([hidden])");
		const island = slide.locator('[data-island="assessment"]');
		await island.scrollIntoViewIfNeeded();
		await expect(island).toHaveAttribute("data-hydrated", "");
		await island.getByRole("radio").nth(1).check();
		await island.locator("[data-assessment-submit]").click();
		await expect(next).toBeEnabled();
		if (index === 1) {
			await next.click();
			await expect(slide).toBeVisible();
			await island.getByRole("button", { name: "Réessayer", exact: true }).click();
			await island.getByRole("radio").first().check();
			await island.locator("[data-assessment-submit]").click();
		}
		await next.click();
	}
	await next.click();
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect.soft(next).toBeEnabled();
	await expect(next).toHaveAccessibleName("Module suivant : Module two");
	const completion = page.locator("#deck-completion");
	await expect(completion).toBeVisible();
	await expect(completion.locator("h1")).toHaveText("Module terminé");
	await expect(completion.getByRole("button")).toHaveCount(1);
	await expect(completion.getByRole("button")).toHaveCSS("font-weight", "600");
	const accentButtons = await page.locator("button:visible").evaluateAll(
		(buttons) =>
			buttons.filter((button) => {
				const probe = document.createElement("span");
				button.append(probe);
				probe.style.backgroundColor = "var(--accent)";
				const accent = getComputedStyle(probe).backgroundColor;
				probe.remove();
				return getComputedStyle(button).backgroundColor === accent;
			}).length,
	);
	expect(accentButtons).toBe(1);
	await expect(completion.locator("h1")).toBeFocused();
	await next.click();
	await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(next).toHaveAccessibleName("Terminer le module");
	await next.click();
	await expect(completion).toBeVisible();
	await expect(completion.locator("h1")).toHaveText("Module terminé");
	await expect(completion.locator("h1")).toBeFocused();
	await expect(next).toBeEnabled();
	await expect(next).toHaveAccessibleName("Retour au cours");
	await completion.getByRole("button", { name: "Revoir le module", exact: true }).click();
	await expect(completion).toBeHidden();
	await expect(page.locator("#main-content")).toBeFocused();
});

async function* inspectPages(page: Page, course: DesignCourse, width: number) {
	await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	for (const entry of course.entries) {
		const entryUrl = new URL(`${course.url}/${entry}`);
		if (course.deck) entryUrl.searchParams.set("praxity-inspect", "1");
		await page.goto(entryUrl.href);
		await waitForHydration(page);
		if (course.deck)
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const slides = course.deck ? await page.locator(".deck-slide").count() : 1;
		for (let slide = 0; slide < slides; slide++) {
			if (course.deck)
				await page.evaluate((index) => {
					const deck = document.querySelector<HTMLElement>(".praxity-deck");
					if (deck) deck.dataset.panel = "closed";
					// Inspection mode visits gated content without changing learner answers.
					Array.from(document.querySelectorAll<HTMLElement>(".deck-slide")).forEach((e, i) => {
						e.hidden = i !== index;
						e.inert = i !== index;
						e.setAttribute("aria-hidden", String(i !== index));
					});
					document.querySelector("#main-content")?.scrollTo(0, 0);
				}, slide);
			await hydrateContent(page);
			await page.evaluate(async () => {
				await document.fonts.ready;
			});
			await page.emulateMedia({ reducedMotion: "no-preference" });
			const result = await inspect(page);
			await page.emulateMedia({ reducedMotion: "reduce" });
			const reduced = await inspect(page);
			result.failures[11].push(...reduced.failures[11]);
			yield { entry, slide, result };
		}
	}
}

for (const width of [1280, 390])
	for (const name of ["comprehensive", "leadership"]) {
		test(`${name} design system at ${width}px`, async ({ page }) => {
			test.setTimeout(120_000);
			const course = courses().find(
				(c) => c.name === name || (name === "leadership" && c.name === "deck fixture"),
			);
			if (!course) throw new Error(`Missing ${name} design-system export`);
			for await (const { entry, slide, result } of inspectPages(page, course, width)) {
				expect.soft(result.activityTargets, `${entry}: activity 44px targets`).toEqual([]);
				expect.soft(result.phoneMargins, `${entry}: phone margins`).toEqual([]);
				for (const [index, failures] of result.failures.entries()) {
					if (index === 9 || index === 7) continue;
					expect.soft(failures, `${entry} slide ${slide + 1}: ${rules[index]}`).toEqual([]);
				}
			}
		});
	}

test("correct and incorrect feedback differ in words and icons", async ({ page }) => {
	const course = courses().find((c) => c.name === "comprehensive");
	if (!course) throw new Error("Missing comprehensive design-system export");
	await page.goto(`${course.url}/assessment-blocks.html`);
	await waitForHydration(page);
	const assessment = page.locator('[data-block-type="assessment"]').first();
	const radios = assessment.locator('input[type="radio"]');
	await expect(radios).toHaveCount(4);
	const marks = [];
	for (const answer of ["3:1", "4.5:1"]) {
		await assessment.getByRole("radio", { name: answer, exact: true }).check();
		await assessment.getByRole("button", { name: /submit|check/i }).click();
		const feedback = assessment
			.locator(".praxity-assessment-choice-option")
			.filter({ has: page.getByRole("radio", { name: answer, exact: true }) })
			.locator(".praxity-choice-status");
		await expect(feedback).toBeVisible();
		await expect(feedback).toContainText(answer === "4.5:1" ? "Correct" : "Not quite");
		marks.push(
			await feedback.evaluate((e) => ({
				text: e.textContent?.trim(),
				icon: e.querySelector("svg")?.innerHTML ?? e.querySelector("[aria-hidden]")?.textContent,
				color: getComputedStyle(e).color,
			})),
		);
		if (answer === "3:1") {
			await page.evaluate(() => localStorage.clear());
			await page.reload();
			await waitForHydration(page);
		}
	}
	expect(marks[0].text).not.toEqual(marks[1].text);
	expect(marks[0].icon).toBeTruthy();
	expect(marks[1].icon).toBeTruthy();
	expect(marks[0].icon).not.toEqual(marks[1].icon);
});

for (const width of [1280, 768, 390]) {
	test(`choice labels use the row width before Check and marks follow the label at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${readTestEnv().url}/assessment-blocks.html`);
		await waitForHydration(page);
		await hydrateContent(page);
		const rows = page.locator(".praxity-assessment-choice-option");
		expect(await rows.count()).toBeGreaterThan(0);
		for (const ratio of await rows.evaluateAll((elements) =>
			elements.map((row) => {
				const text = row.querySelector(".praxity-choice-label");
				if (!text) throw new Error("Missing choice text");
				const style = getComputedStyle(row);
				const content =
					row.getBoundingClientRect().width -
					Number.parseFloat(style.paddingLeft) -
					Number.parseFloat(style.paddingRight) -
					Number.parseFloat(style.borderLeftWidth) -
					Number.parseFloat(style.borderRightWidth);
				return text.getBoundingClientRect().width / content;
			}),
		))
			expect.soft(ratio, "no reserved result column").toBeGreaterThanOrEqual(0.75);
		for (const type of ["radio", "checkbox"]) {
			const card = page
				.locator('[data-block-type="assessment"]')
				.filter({ has: page.locator(`input[type=${type}]`) })
				.first();
			if (type === "checkbox")
				await expect(card.locator(".praxity-assessment-choice-hint")).toBeVisible();
			await card.locator(`input[type=${type}]`).first().check();
			await card.locator("[data-assessment-submit]").click();
			const mark = card.locator(".praxity-choice-status").first();
			await expect(mark).toBeVisible();
			const geometry = await mark.evaluate((status) => {
				const row = status.closest(".praxity-assessment-choice-option");
				const label = row?.querySelector(".praxity-choice-label");
				if (!label) throw new Error("Missing option label");
				const a = status.getBoundingClientRect();
				const b = label.getBoundingClientRect();
				const authored = row?.querySelector(".praxity-choice-feedback");
				return {
					start: a.left - b.left,
					below: a.top >= b.bottom,
					authoredAfter: !authored || authored.getBoundingClientRect().top >= a.bottom,
				};
			});
			expect(geometry.start).toBeCloseTo(0, 0);
			expect(geometry.below).toBe(true);
			expect(geometry.authoredAfter).toBe(true);
		}
	});
}

test("dark choice result borders differ by at least 15 Delta E OK", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(`${readTestEnv().url}/activity-cards-en-dark/index.html`);
	const card = page.locator('[data-island="assessment"][data-block-id="multiple"]');
	await card.scrollIntoViewIfNeeded();
	await expect(card).toHaveAttribute("data-hydrated", "");
	for (const input of await card.getByRole("checkbox").all()) await input.check();
	await card.locator("[data-assessment-submit]").click();
	const colors: string[] = [];
	for (const index of [0, 1]) {
		const row = card.locator(".praxity-assessment-choice-option").nth(index);
		await expect(row).toHaveAttribute("data-choice-result", index === 0 ? "correct" : "incorrect");
		const color = colorToHex(await row.evaluate((e) => getComputedStyle(e).borderTopColor));
		if (!color) throw new Error("Missing result border colour");
		colors.push(color);
	}
	const a = hexToOklab(colors[0]);
	const b = hexToOklab(colors[1]);
	expect(100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThanOrEqual(15);
});

// Sections 5 (reading interactions) and 6 (activities) own these block controls.
// Keep the original 44px assertion for those batches to enable.
test.fixme("44px targets across remaining reading interactions (section 5)", async ({ page }) => {
	for (const width of [1280, 390])
		for (const course of courses())
			for await (const { entry, result } of inspectPages(page, course, width))
				expect.soft(result.failures[7], `${entry}: 44px targets`).toEqual([]);
});

// A group's authored H1 is inside its padded activity header. Sections 6 (activities)
// and 7 (deck) own moving that title into the common slide title row.
test("activity-group slide titles share the deck title row (sections 6 and 7)", async ({
	page,
}) => {
	for (const width of [1280, 390])
		for (const course of courses().filter((c) => c.deck)) {
			let titleTop: number | undefined;
			await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
			await page.emulateMedia({ reducedMotion: "reduce" });
			for (const entry of course.entries) {
				await page.goto(`${course.url}/${entry}?praxity-inspect=1`);
				await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				const positions = await page.evaluate(async () => {
					await document.fonts.ready;
					const main = document.querySelector<HTMLElement>("#main-content");
					const deck = document.querySelector<HTMLElement>(".praxity-deck");
					if (!main || !deck) throw new Error("Missing deck stage");
					deck.dataset.panel = "closed";
					const slides = Array.from(document.querySelectorAll<HTMLElement>(".deck-slide"));
					const original = slides.map((slide) => ({ hidden: slide.hidden, inert: slide.inert }));
					try {
						return slides.map((slide) => {
							for (const other of slides) {
								other.hidden = other !== slide;
								other.inert = other !== slide;
							}
							main.scrollTop = 0;
							const title = slide.querySelector("h1, .praxity-slide-title");
							return title
								? title.getBoundingClientRect().top - main.getBoundingClientRect().top
								: null;
						});
					} finally {
						slides.forEach((slide, index) => Object.assign(slide, original[index]));
					}
				});
				for (const [slide, top] of positions.entries()) {
					if (top === null) continue;
					titleTop ??= top;
					expect
						.soft(Math.abs(top - titleTop), `${entry} slide ${slide + 1}: title top`)
						.toBeLessThanOrEqual(1);
				}
			}
		}
});

for (const width of [1280, 390]) {
	test(`activity typography learner-read text at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${readTestEnv().url}/activity-typography/activity-typography.html`);
		await waitForHydration(page);
		await hydrateContent(page);
		const statements = page.locator(
			".praxity-categorize-table tbody th, .praxity-matrix-table tbody th, .praxity-choice-label",
		);
		await expect(statements).toHaveCount(6);
		for (const statement of await statements.all()) {
			expect
				.soft(await statement.evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize)))
				.toBeGreaterThanOrEqual(18);
		}
		if (width === 390) {
			const labels = page.locator(
				".praxity-categorize-table td[data-category], .praxity-matrix-table td[data-category]",
			);
			await expect(labels).toHaveCount(6);
			for (const label of await labels.all()) {
				expect
					.soft(
						await label.evaluate((e) =>
							Number.parseFloat(getComputedStyle(e, "::before").fontSize),
						),
					)
					.toBeGreaterThanOrEqual(18);
			}
		} else {
			const headers = page.locator(
				".praxity-categorize-table thead th:not(:first-child), .praxity-matrix-table thead th:not(:first-child)",
			);
			await expect(headers).toHaveCount(4);
			for (const header of await headers.all()) {
				expect
					.soft(await header.evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize)))
					.toBeGreaterThanOrEqual(18);
				await expect.soft(header).toHaveCSS("font-weight", "600");
				const fits = await header.evaluate((e) => {
					const bounds = e.getBoundingClientRect();
					const text = document.createRange();
					text.selectNodeContents(e);
					return (
						e.scrollWidth <= e.clientWidth + 1 &&
						e.scrollHeight <= e.clientHeight + 1 &&
						[...text.getClientRects()].every(
							(r) =>
								r.left >= bounds.left - 1 &&
								r.right <= bounds.right + 1 &&
								r.top >= bounds.top - 1 &&
								r.bottom <= bounds.bottom + 1,
						)
					);
				});
				expect.soft(fits, "long French category text fits its column header").toBe(true);
			}
		}
	});

	test(`activity typography button label and target at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${readTestEnv().url}/activity-typography/activity-typography.html`);
		await waitForHydration(page);
		await hydrateContent(page);
		const buttons = page.locator(".praxity-button");
		await expect(buttons).toHaveCount(2);
		for (const button of await buttons.all()) {
			const style = await button.evaluate((e) => {
				const s = getComputedStyle(e);
				return {
					size: Number.parseFloat(s.fontSize),
					leading: Number.parseFloat(s.lineHeight) / Number.parseFloat(s.fontSize),
					height: e.getBoundingClientRect().height,
					width: e.getBoundingClientRect().width,
					overflow: e.scrollWidth - e.clientWidth,
				};
			});
			expect.soft(style.size).toBeGreaterThanOrEqual(18);
			expect.soft(style.leading).toBeCloseTo(1.25, 2);
			expect.soft(style.height).toBeGreaterThanOrEqual(44 - LAYOUT_UNIT);
			expect.soft(style.width).toBeGreaterThanOrEqual(44 - LAYOUT_UNIT);
			expect.soft(style.overflow).toBeLessThanOrEqual(1);
		}
		const button = buttons.first();
		await page.emulateMedia({ reducedMotion: "reduce" });
		await button.scrollIntoViewIfNeeded();
		await page.mouse.move(0, 0);
		const rest = await button.evaluate((e) => getComputedStyle(e).backgroundColor);
		await button.hover();
		expect.soft(await button.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(rest);
		await page.mouse.down();
		try {
			await expect.soft(button).toHaveCSS("transform", "matrix(0.96, 0, 0, 0.96, 0, 0)");
		} finally {
			// Release off the link so this test never leaves the local fixture.
			await page.mouse.move(0, 0);
			await page.mouse.up();
		}
	});

	test(`activity typography fill-blank reading rhythm at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${readTestEnv().url}/activity-typography/activity-typography.html`);
		await waitForHydration(page);
		await hydrateContent(page);
		const paragraph = page.locator(".praxity-fill-blank-template");
		await expect(paragraph).toHaveCount(1);
		const leading = await paragraph.evaluate((e) => {
			const style = getComputedStyle(e);
			return Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize);
		});
		expect.soft(leading).toBeCloseTo(1.55, 2);
		const input = page.locator(".praxity-fill-blank-input");
		await expect(input).toHaveCount(1);
		expect.soft((await input.boundingBox())?.height).toBeGreaterThanOrEqual(44 - LAYOUT_UNIT);
		await expect.soft(input).toHaveCSS("vertical-align", "middle");
	});
}

// Review DK1-DK5: phone transcript margins and one action for each intent.
test("deck transcript sheet keeps 16px phone text margins", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`${readTestEnv().url}/design-deck-narrated/introduction.html`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-more-toggle").click();
	await page.locator("#deck-script-toggle").click();
	const sheet = page.locator("dialog[open] #deck-script");
	await expect(sheet).toBeVisible();
	const margins = await sheet
		.locator("[data-deck-segment]:visible .deck-script-content, .deck-panel-title")
		.evaluateAll((segments) =>
			segments.map((segment) => {
				const range = document.createRange();
				range.selectNodeContents(segment);
				const rect = range.getBoundingClientRect();
				return [rect.left, innerWidth - rect.right];
			}),
		);
	expect(margins.length).toBeGreaterThan(0);
	for (const sides of margins)
		for (const margin of sides)
			expect.soft(margin, "transcript text gutter").toBeGreaterThanOrEqual(16);
});

test("deck Tools stays outlined without an open-state dot", async ({ page }) => {
	await page.goto(`${readTestEnv().url}/design-deck-narrated/introduction.html`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const tools = page.locator("#deck-more-toggle");
	const play = page.locator("#deck-narration .praxity-narration-transport button");
	await expect(tools).toHaveCSS(
		"border-top-color",
		await play.evaluate((e) => getComputedStyle(e).borderTopColor),
	);
	await expect(tools).toHaveCSS("border-top-width", "1px");
	await tools.click();
	await expect(tools).toHaveAttribute("aria-expanded", "true");
	expect(await tools.evaluate((e) => getComputedStyle(e, "::after").content)).toBe("none");
});

test("deck uses one play control and hides the timeline without narration", async ({ page }) => {
	await page.goto(`${readTestEnv().url}/design-deck-narrated/introduction.html?praxity-inspect=1`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(
		page.locator(
			"#deck-narration .praxity-narration-transport button:visible, .deck-opening-narration:visible",
		),
	).toHaveCount(1);
	await expect(page.locator("#deck-narration input[type=range]")).toBeVisible();
	await page
		.locator('#deck-outline a[data-deck-page="module-two"]')
		.evaluate((e: HTMLElement) => e.click());
	await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
	await expect(page.locator(".praxity-narration-position")).toBeHidden();
	await page.locator("#deck-next").click();
	await expect(page.locator("#deck-completion")).toBeVisible();
	await expect(page.locator(".praxity-narration-position")).toBeHidden();
});

test("deck hides the timeline on a silent slide and completion within a narrated module", async ({
	page,
}) => {
	// Supply an authored silent slide through the published configuration boundary.
	await page.route("**/design-deck-narrated/introduction.html*", async (route) => {
		const response = await route.fetch();
		const body = await response.text();
		const match = body.match(
			/<script id="praxity-config" type="application\/json">([\s\S]*?)<\/script>/,
		);
		if (!match) throw new Error("Missing published deck configuration");
		const config = JSON.parse(match[1]);
		config.deckPages[1].narrationSilent = true;
		for (const segment of config.deckPages[1].segments) delete segment.src;
		await route.fulfill({ response, body: body.replace(match[1], JSON.stringify(config)) });
	});
	await page.goto(`${readTestEnv().url}/design-deck-narrated/introduction.html?praxity-inspect=1`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const timeline = page.locator("#deck-narration .praxity-narration-position");
	await expect(timeline).toBeVisible();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
	await expect(timeline).toBeHidden();
	await page.locator("#deck-previous").click();
	await expect(timeline).toBeVisible();
	await page
		.locator('#deck-outline a[data-deck-page="slide-4"]')
		.evaluate((e: HTMLElement) => e.click());
	await expect(timeline).toBeVisible();
	await page.locator("#deck-next").click();
	await expect(page.locator("#deck-completion")).toBeVisible();
	await expect(timeline).toBeHidden();
	await page.locator("#deck-review").click();
	await expect(timeline).toBeVisible();
});
