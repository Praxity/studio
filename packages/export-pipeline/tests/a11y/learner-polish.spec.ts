import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { renderCartesianChartSvg } from "@praxity/shared-blocks/chart-svg";
import { LEARNER_POLISH_VARIANTS } from "./fixtures/learner-polish-fixture";
import {
	readNavVariantUrl,
	readSlidesNarrationUrl,
	readTestEnv,
	WEBKIT_TAB_ORDER_SKIP,
	waitForHydration,
} from "./helpers";

async function choiceGeometry(assessment: Locator) {
	return assessment.evaluate((element) =>
		[
			element,
			...element.querySelectorAll(
				".praxity-assessment-stem, .praxity-assessment-choice-option, .praxity-assessment-actions",
			),
		].map((node) => {
			const { x, y, width, height } = node.getBoundingClientRect();
			return { x, y, width, height };
		}),
	);
}

async function flowGeometry(part: Locator) {
	return part.evaluate((element) => {
		const main = document.querySelector("main");
		if (!main) throw new Error("Missing page content");
		const rect = element.getBoundingClientRect();
		const origin = main.getBoundingClientRect();
		return {
			x: rect.x - origin.x + main.scrollLeft,
			y: rect.y - origin.y + main.scrollTop,
			width: rect.width,
			height: rect.height,
		};
	});
}

test("reduced-motion entrance states keep reading content fully visible", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const env = readTestEnv();
	await page.goto(`${env.url}/${env.pages[0].slug}.html`);
	await waitForHydration(page);
	const states = await page
		.locator(".praxity-block")
		.first()
		.evaluate((element) => {
			const root = element.closest<HTMLElement>("[data-praxity-root]");
			if (!root) throw new Error("Missing course root");
			root.dataset.praxityMotionEntrance = "slide";
			return ["pending", "visible"].map((state) => {
				element.setAttribute("data-entrance", state);
				const style = getComputedStyle(element);
				return {
					opacity: style.opacity,
					transform: style.transform,
					transitionDuration: style.transitionDuration,
				};
			});
		});
	expect(states).toEqual([
		{ opacity: "1", transform: "none", transitionDuration: "0s" },
		{ opacity: "1", transform: "none", transitionDuration: "0s" },
	]);
});

for (const width of [390, 768, 1280]) {
	test(`choice options keep their geometry during activation at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 800 });
		const baseUrl = readSlidesNarrationUrl();
		await page.goto(`${baseUrl}/index.html`);
		const slug = await page.evaluate(
			() =>
				JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}").pages.find(
					(p: { title: string }) => p.title === "Knowledge check",
				).slug,
		);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(/island-assessment-[A-Z0-9]+\.js$/, async (route) => {
			await gate;
			await route.continue();
		});
		await page.goto(`${baseUrl}/${slug}.html`, { waitUntil: "domcontentloaded" });
		const assessment = page.locator('[data-island="assessment"]').first();
		await assessment.scrollIntoViewIfNeeded();
		await expect(assessment).not.toHaveAttribute("data-hydrated");
		await expect(assessment.getByRole("radio")).toHaveCount(4);
		for (const option of await assessment.getByRole("radio").all()) {
			await expect(option).toBeVisible();
			await expect(option).toBeDisabled();
		}
		const before = await choiceGeometry(assessment);
		release();
		await expect(assessment).toHaveAttribute("data-hydrated", "");
		const after = await choiceGeometry(assessment);
		expect(after).toHaveLength(before.length);
		for (const [index, rect] of after.entries()) {
			for (const dimension of ["x", "y", "width", "height"] as const) {
				expect(
					Math.abs(rect[dimension] - before[index][dimension]),
					`${index}: ${dimension}`,
				).toBeLessThan(1);
			}
		}
		await assessment.getByRole("radio").first().focus();
		await page.keyboard.press("Space");
		await expect(assessment.getByRole("radio").first()).toBeChecked();
		await expect(assessment.getByRole("button", { name: "Submit" })).toBeVisible();
	});
}

for (const width of [390, 768, 1280]) {
	test(`grouped assessments keep the group width during activation at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 800 });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(/island-assessment(?:-group)?-[A-Z0-9]+\.js$/, async (route) => {
			await gate;
			await route.continue();
		});
		await page.goto(`${readNavVariantUrl("sidebar")}/page-3.html`, {
			waitUntil: "domcontentloaded",
		});
		await waitForHydration(page);
		const memberIds = await page.evaluate(() => {
			const config = JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}");
			return config.blocks.find((block: { type: string }) => block.type === "assessmentGroup").data
				.memberBlockIds as string[];
		});
		expect(memberIds).toHaveLength(3);
		const members = memberIds.map((id) =>
			page.locator(`[data-island="assessment"][data-block-id="${id}"]`),
		);
		for (const member of members) {
			await member.scrollIntoViewIfNeeded();
			await expect(member).not.toHaveAttribute("data-hydrated");
		}
		// The explicit group width overrides the member's authored full width.
		expect(
			JSON.parse((await members[1].getAttribute("data-block-json")) ?? "{}").data.layoutMode,
		).toBe("full");
		for (const member of members) await expect(member).toHaveClass(/praxity-layout-wide/);
		const groupHeader = page.locator("[data-assessment-group-header]").first();
		const groupFooter = page.locator("[data-assessment-group-submit]").first();
		await expect(groupFooter).toBeVisible();
		await expect(groupFooter.locator("button")).toBeDisabled();
		for (const member of members) await expect(member).toHaveAttribute("data-assessment-group");
		const parts = [groupHeader, ...members, groupFooter];
		const beforeGroup = await Promise.all(parts.map(flowGeometry));
		release();
		for (const member of members) await expect(member).toHaveAttribute("data-hydrated", "");
		await expect(page.locator(".praxity-ag-submit-btn").first()).toBeVisible();
		await expect(groupFooter.locator("button")).toBeEnabled();
		const afterGroup = await Promise.all(parts.map(flowGeometry));
		for (const [index, rect] of afterGroup.entries()) {
			const prior = beforeGroup[index];
			if (!prior) throw new Error("Missing assessment group geometry");
			for (const dimension of ["x", "y", "width", "height"] as const)
				expect(
					Math.abs(rect[dimension] - prior[dimension]),
					`${index}: ${dimension}`,
				).toBeLessThanOrEqual(1);
		}
		for (const member of members) await expect(member).toHaveClass(/praxity-layout-wide/);
		await members[0].getByRole("radio").first().check();
		await expect(members[0].getByRole("radio").first()).toBeChecked();
	});
}

test("choose-one group keeps its first-paint geometry through hydration", async ({ page }) => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(/island-assessment(?:-group)?-[A-Z0-9]+\.js$/, async (route) => {
		await gate;
		await route.continue();
	});
	await page.goto(`${readTestEnv().url}/oneof-group/page-3.html`, {
		waitUntil: "domcontentloaded",
	});
	const members = page.locator('[data-island="assessment"][data-assessment-group]');
	const picker = page.locator(".praxity-assessment-group-picker");
	const parts = [
		page.locator("[data-assessment-group-header]").first(),
		picker,
		members.first(),
		page.locator("[data-assessment-group-submit]").first(),
	];
	await members.first().scrollIntoViewIfNeeded();
	await expect(page.locator(".praxity-section-divider")).toHaveCount(0);
	await expect(members.first()).not.toHaveAttribute("data-hydrated");
	await expect(picker.getByRole("radio")).toHaveCount(3);
	await expect(picker.getByRole("radio").first()).toBeDisabled();
	await expect(members.nth(1)).toBeHidden();
	const before = await Promise.all(parts.map(flowGeometry));
	release();
	await expect(members.first()).toHaveAttribute("data-hydrated", "");
	await expect(picker.getByRole("radio").first()).toBeEnabled();
	const after = await Promise.all(parts.map(flowGeometry));
	for (const [index, rect] of after.entries()) {
		const prior = before[index];
		if (!prior) throw new Error("Missing choose-one group geometry");
		for (const dimension of ["x", "y", "width", "height"] as const)
			expect(
				Math.abs(rect[dimension] - prior[dimension]),
				`${index}: ${dimension}`,
			).toBeLessThanOrEqual(1);
	}
});

for (const island of ["assessment", "assessment-group"] as const) {
	test(`choose-one questions remain readable when the ${island} island fails`, async ({ page }) => {
		await page.route(new RegExp(`island-${island}-[A-Z0-9]+\\.js$`), (route) => route.abort());
		await page.goto(`${readTestEnv().url}/oneof-group/page-3.html`, {
			waitUntil: "domcontentloaded",
		});
		const members = page.locator('[data-island="assessment"][data-assessment-group]');
		await members.first().scrollIntoViewIfNeeded();
		await expect(page.locator("html")).not.toHaveClass(/praxity-assessment-group-ready/);
		await expect(members).toHaveCount(3);
		for (const member of await members.all()) await expect(member).toBeVisible();
	});
}

test("choose-one questions remain readable without JavaScript", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(`${readTestEnv().url}/oneof-group/page-3.html`);
		const members = page.locator('[data-island="assessment"][data-assessment-group]');
		await expect(members).toHaveCount(3);
		for (const member of await members.all()) await expect(member).toBeVisible();
		await expect(page.locator(".praxity-assessment-group-picker input")).toHaveCount(3);
		await expect(page.locator(".praxity-assessment-group-submit button")).toBeDisabled();
	} finally {
		await context.close();
	}
});

for (const width of [390, 740]) {
	test(`header title has space beside the menu at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`${readTestEnv().url}/sidebar-narration/narrated-slide.html`);
		await waitForHydration(page);
		const menu = await page.locator(".praxity-top-bar .praxity-native-menu-toggle").boundingBox();
		const title = await page.locator(".praxity-toolbar-context").boundingBox();
		expect(menu).not.toBeNull();
		expect(title).not.toBeNull();
		if (!menu || !title) throw new Error("Header menu and title must be visible");
		expect(title.x - (menu.x + menu.width)).toBeGreaterThanOrEqual(12);
	});
}

test("previous and next controls stay still while pressed", async ({ page }) => {
	await page.goto(`${readNavVariantUrl("sidebar")}/page-2.html`);
	await waitForHydration(page);
	for (const selector of [".praxity-nav-prev", ".praxity-nav-next"]) {
		const control = page.locator(selector).first();
		await control.hover();
		const before = await control.boundingBox();
		await page.mouse.down();
		await expect(control).toHaveCSS("transform", "none");
		expect(await control.boundingBox()).toEqual(before);
		await page.mouse.move(0, 0);
		await page.mouse.up();
	}
});

for (const width of [390, 768, 1280]) {
	test(`default slide image and caption stay inside the scroll container at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`${readSlidesNarrationUrl()}/accessible-slide-course.html`);
		await waitForHydration(page);
		const imageBlock = page.locator(".praxity-slide .praxity-block-feature-width");
		await expect(imageBlock.locator("img")).toBeVisible();
		await expect(imageBlock.locator("figcaption")).toBeVisible();
		const bounds = await imageBlock.evaluate((element) => {
			const main = document.querySelector("main")?.getBoundingClientRect();
			if (!main) throw new Error("Missing slide scroll container");
			return [...element.querySelectorAll("img, figcaption")].map((node) => {
				const rect = node.getBoundingClientRect();
				return rect.left >= main.left && rect.right <= main.right;
			});
		});
		expect(bounds).toEqual([true, true]);
	});
}

type Rgb = [number, number, number];

function linear(channel: number): number {
	const value = channel / 255;
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(first: Rgb, second: Rgb): number {
	const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
	return (light + 0.05) / (dark + 0.05);
}

/** OKLab distance; about 0.02 is the smallest step people reliably see. */
function deltaE(first: Rgb, second: Rgb): number {
	const lab = (rgb: Rgb) => {
		const [r, g, b] = rgb.map(linear);
		const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
		const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
		const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
		return [
			0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
			1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
			0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
		];
	};
	const a = lab(first);
	const b = lab(second);
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function distance(first: Rgb, second: Rgb): number {
	return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

/** Read painted pixels, so the checks see what the learner sees after the cascade. */
async function capture(page: Page, clip: { x: number; y: number; width: number; height: number }) {
	const png = await page.screenshot({
		clip,
		scale: "device",
		animations: "disabled",
		caret: "hide",
	});
	const { width, height, data } = await page.evaluate(
		async (source) => {
			const image = new Image();
			image.src = source;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas unavailable");
			context.drawImage(image, 0, 0);
			return {
				width: canvas.width,
				height: canvas.height,
				data: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
			};
		},
		`data:image/png;base64,${png.toString("base64")}`,
	);
	const pixel = (column: number, row: number): Rgb => {
		const index = (row * width + column) * 4;
		return [data[index], data[index + 1], data[index + 2]];
	};
	const column = (x: number) =>
		Math.min(width - 1, Math.max(0, Math.floor(((x - clip.x) * width) / clip.width)));
	const row = (y: number) =>
		Math.min(height - 1, Math.max(0, Math.floor(((y - clip.y) * height) / clip.height)));
	return {
		at: (x: number, y: number) => pixel(column(x), row(y)),
		/** Pixels on one row between two page x positions, inclusive. */
		span: (fromX: number, toX: number, y: number) =>
			Array.from({ length: column(toX) - column(fromX) + 1 }, (_, index) =>
				pixel(column(fromX) + index, row(y)),
			),
		all: () =>
			Array.from({ length: width * height }, (_, index) =>
				pixel(index % width, Math.floor(index / width)),
			),
	};
}

function darkest(pixels: Rgb[]): Rgb {
	return pixels.reduce((dark, pixel) => (luminance(pixel) < luminance(dark) ? pixel : dark));
}

async function paintedColor(target: Locator, property: "color" | "backgroundColor"): Promise<Rgb> {
	return target.evaluate((element, property) => {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas unavailable");
		context.fillStyle = getComputedStyle(element)[property];
		context.fillRect(0, 0, 1, 1);
		const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
		return [r, g, b] as [number, number, number];
	}, property);
}

async function box(target: Locator) {
	await target.scrollIntoViewIfNeeded();
	const rect = await target.boundingBox();
	if (!rect) throw new Error("Expected a rendered element");
	return rect;
}

async function openLearnerPolish(page: Page, route: string, pageIndex = 0) {
	const baseUrl = `${readTestEnv().url}/${route}`;
	await page.goto(`${baseUrl}/index.html`);
	const slug = await page.evaluate(
		(index) =>
			JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}").pages[index]
				.slug as string,
		pageIndex,
	);
	await page.goto(`${baseUrl}/${slug}.html`);
	await waitForHydration(page);
}

const POLISH_COPY = {
	en: {
		skip: "Skip to page navigation",
		heading: /^Check every harness/,
		placeholder: "Type your answer",
		labels: { info: "Note", success: "Note" },
	},
	fr: {
		skip: "Aller à la navigation des pages",
		heading: /^Vérifiez chaque harnais/,
		placeholder: "Saisissez votre réponse",
		labels: { info: "Note", success: "Note" },
	},
} as const;

const LIGHT_POLISH = LEARNER_POLISH_VARIANTS.filter((variant) => variant.colorMode === "light");

for (const { route, locale } of LIGHT_POLISH) {
	test(`plain pages show the page navigation skip link only while it has focus (${locale})`, async ({
		page,
		browserName,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await openLearnerPolish(page, route);
		const main = page.locator("main#main-content");
		await expect(main).not.toHaveAttribute("data-texture");
		const skip = main.locator(".praxity-page-nav-skip");
		await expect(skip).toHaveText(POLISH_COPY[locale].skip);
		const painted = () =>
			skip.evaluate((link) => {
				const rect = link.getBoundingClientRect();
				if (
					rect.width === 0 ||
					rect.bottom <= 0 ||
					rect.right <= 0 ||
					rect.top >= innerHeight ||
					rect.left >= innerWidth
				)
					return false;
				const hit = document.elementFromPoint(
					rect.left + rect.width / 2,
					rect.top + rect.height / 2,
				);
				return Boolean(hit && link.contains(hit));
			});
		expect(await painted(), "hidden over the page title").toBe(false);
		await page.evaluate(() => {
			for (const scroller of [document.scrollingElement, document.querySelector("main")])
				scroller?.scrollTo(0, scroller.scrollHeight);
		});
		expect(await painted(), "hidden at the end of the page").toBe(false);

		// Playwright's WebKit Tab skips links (see WEBKIT_TAB_ORDER_SKIP), so WebKit checks the
		// focused link's painting and activation; the other engines also prove Tab reaches it.
		const sequentialTab = browserName !== "webkit";
		if (sequentialTab) {
			await page.locator(".praxity-nav-next").first().focus();
			await page.keyboard.press("Shift+Tab");
		} else {
			test.info().annotations.push({ type: "webkit", description: WEBKIT_TAB_ORDER_SKIP });
			await skip.focus();
		}
		await expect(skip).toBeFocused();
		expect(await painted(), "visible while focused").toBe(true);
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(/#praxity-page-nav(?:-fallback)?$/);
		if (sequentialTab) {
			await page.keyboard.press("Tab");
			expect(
				await page.evaluate(() =>
					Boolean(document.activeElement?.closest("#praxity-page-nav, #praxity-page-nav-fallback")),
				),
			).toBe(true);
		} else {
			await skip.evaluate((link) => (link as HTMLElement).blur());
		}
		expect(await painted(), "hidden again after use").toBe(false);
	});

	test(`long headings balance and question stems wrap as prose at 390px with Larger text (${locale})`, async ({
		page,
		browserName,
	}, testInfo) => {
		await page.addInitScript(() =>
			localStorage.setItem("praxity-a11y", JSON.stringify({ textSize: "large" })),
		);
		await page.setViewportSize({ width: 390, height: 844 });
		await openLearnerPolish(page, route);
		await expect(page.locator("html")).toHaveAttribute("data-praxity-text-size", "large");
		// The stem re-renders when its lazy island hydrates; measure the settled text.
		const island = page.locator('[data-island="assessment"]').first();
		await island.scrollIntoViewIfNeeded();
		await expect(island).toHaveAttribute("data-hydrated", "");
		await page.evaluate(() => document.fonts.ready.then(() => undefined));
		const targets = [
			page.locator("main h2").filter({ hasText: POLISH_COPY[locale].heading }),
			page.locator(".praxity-assessment-stem").first(),
		];
		for (const [index, target] of targets.entries()) {
			const isStem = index === 1;
			await target.scrollIntoViewIfNeeded();
			const layout = await target.evaluate((element, isStem) => {
				const range = document.createRange();
				range.selectNodeContents(element);
				const fragments = [];
				if (isStem) {
					// Word ranges avoid counting inline element boxes as full lines.
					const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
					let word = 0;
					for (let node = walker.nextNode(); node; node = walker.nextNode()) {
						for (const match of (node.textContent ?? "").matchAll(/\S+/gu)) {
							range.setStart(node, match.index);
							range.setEnd(node, match.index + match[0].length);
							for (const rect of range.getClientRects()) fragments.push({ rect, word });
							word++;
						}
					}
				} else {
					for (const rect of range.getClientRects()) fragments.push({ rect, word: 0 });
				}
				const lines: Array<{ left: number; right: number; middle: number; words: number[] }> = [];
				for (const { rect, word } of fragments) {
					if (rect.width < 1) continue;
					const middle = rect.top + rect.height / 2;
					const line = lines.find((entry) => Math.abs(entry.middle - middle) < rect.height / 2);
					if (line) {
						line.left = Math.min(line.left, rect.left);
						line.right = Math.max(line.right, rect.right);
						if (!line.words.includes(word)) line.words.push(word);
					} else lines.push({ left: rect.left, right: rect.right, middle, words: [word] });
				}
				const style = getComputedStyle(element);
				const bounds = element.getBoundingClientRect();
				return {
					lines: lines.sort((a, b) => a.middle - b.middle),
					left: bounds.left + Number.parseFloat(style.paddingLeft),
					right: bounds.right - Number.parseFloat(style.paddingRight),
					overflow: document.documentElement.scrollWidth - innerWidth,
					wrapStyle: style.getPropertyValue("text-wrap-style"),
					prettySupported: CSS.supports("text-wrap", "pretty"),
				};
			}, isStem);
			expect(layout.overflow).toBeLessThanOrEqual(0);
			expect(layout.lines.length, "wraps at this width").toBeGreaterThan(1);
			for (const line of layout.lines) {
				expect(line.left).toBeGreaterThanOrEqual(layout.left - 1);
				expect(line.right).toBeLessThanOrEqual(layout.right + 1);
			}
			const widths = layout.lines.map((line) => line.right - line.left);
			if (isStem) {
				if (layout.prettySupported)
					expect(layout.wrapStyle, "stem uses pretty wrapping").toBe("pretty");
				const lastLineWords = layout.lines.at(-1)?.words.length ?? 0;
				if (!layout.prettySupported && lastLineWords === 1) {
					const prettyRuleApplied = await target.evaluate(async (element) => {
						for (const sheet of Array.from(document.styleSheets)) {
							if (!sheet.href) continue;
							const response = await fetch(sheet.href);
							if (!response.ok) throw new Error(`Cannot read stylesheet: ${sheet.href}`);
							for (const [, selector, declarations] of (await response.text()).matchAll(
								/([^{}]+)\{([^{}]*)\}/g,
							)) {
								if (
									/text-wrap\s*:\s*pretty\s*(?:;|$)/.test(declarations) &&
									element.matches(selector.trim())
								)
									return true;
							}
						}
						return false;
					});
					expect(prettyRuleApplied, "loaded pretty rule matches the stem").toBe(true);
					testInfo.annotations.push({
						type: "skip-assertion",
						description: `${browserName} does not support text-wrap: pretty; only the last-line orphan assertion is skipped after verifying the applied stylesheet rule`,
					});
				} else {
					expect(lastLineWords, "last stem line has at least two words").toBeGreaterThanOrEqual(2);
				}
				for (const width of widths.slice(0, -1)) {
					expect(
						width / (layout.right - layout.left),
						// Balance split two-line stems into halves; pretty may shorten a line slightly to avoid an orphan.
						"prose lines fill at least 60% of the stem",
					).toBeGreaterThanOrEqual(0.6);
				}
			} else {
				expect(
					Math.min(...widths) / Math.max(...widths),
					`balanced lines: ${widths.map(Math.round).join(", ")}`,
				).toBeGreaterThanOrEqual(0.6);
			}
		}
	});
}

/** Leaf legend parts: each swatch and each name, whatever elements draw them. */
const LEGEND_PARTS = ".praxity-chart-legend :is(rect, text, tspan):not(:has(tspan))";

/**
 * The visible chart's legend parts in its own user units. Text is measured per character because
 * WebKit reports a tspan's bounding box as its whole text run.
 */
function legendLayout(root: Element, selector: string) {
	const svg = [...root.querySelectorAll<SVGSVGElement>("svg.praxity-chart-visual")].find(
		(visual) => getComputedStyle(visual).display !== "none",
	);
	if (!svg) throw new Error("No visible chart");
	const parts = [...svg.querySelectorAll<SVGGraphicsElement>(selector)].map((part) => {
		if (part instanceof SVGTextContentElement) {
			const first = part.getExtentOfChar(0);
			const last = part.getExtentOfChar(part.getNumberOfChars() - 1);
			return { left: first.x, right: last.x + last.width, middle: first.y + first.height / 2 };
		}
		const bounds = part.getBBox();
		return { left: bounds.x, right: bounds.x + bounds.width, middle: bounds.y + bounds.height / 2 };
	});
	return { width: svg.viewBox.baseVal.width, parts };
}

test.describe("learner polish surfaces", () => {
	// Two device pixels per CSS pixel keep a 1px edge as a whole painted pixel.
	test.use({ deviceScaleFactor: 2 });

	for (const variant of LEARNER_POLISH_VARIANTS) {
		test(`info and success notes keep plain, readable surfaces (${variant.locale} ${variant.colorMode})`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 900 });
			await openLearnerPolish(page, variant.route);
			const notes = {
				info: page.locator('.praxity-note-base[data-color="note"]').nth(0),
				success: page.locator('.praxity-note-base[data-color="note"]').nth(1),
			};
			const fills: Partial<Record<keyof typeof notes, Rgb>> = {};
			for (const [tone, note] of Object.entries(notes) as Array<[keyof typeof notes, Locator]>) {
				await expect(note).toHaveAttribute("data-style", "shaded");
				const rect = await box(note);
				const shot = await capture(page, rect);
				// The bottom padding holds no text: it shows the fill itself.
				const fill = shot.at(rect.x + rect.width / 2, rect.y + rect.height - 5);
				expect(
					deltaE(fill, shot.at(rect.x + rect.width - 8, rect.y + rect.height / 2)),
				).toBeLessThan(0.01);
				fills[tone] = fill;
				const label = note.locator(".praxity-note-label");
				// Ordinary notes share the spoken Note label and neutral paper.
				await expect(label).toHaveText(POLISH_COPY[variant.locale].labels[tone]);
				for (const text of [label, note.locator(".praxity-note-body p").first()])
					expect(contrast(await paintedColor(text, "color"), fill)).toBeGreaterThanOrEqual(4.5);
			}
			if (!fills.info || !fills.success) throw new Error("Missing note fills");
			expect(fills.info).toEqual(fills.success);
		});
	}

	test("table headers share the plain, readable page surface", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await openLearnerPolish(page, "learner-polish-en");
		const table = page.locator("table.praxity-data-table").first();
		const header = table.locator("thead th").last();
		const cell = table.locator("tbody td").last();
		const headerBox = await box(header);
		const cellBox = await box(cell);
		const tableShot = await capture(page, await box(table));
		const headerFill = tableShot.at(
			headerBox.x + headerBox.width - 6,
			headerBox.y + headerBox.height / 2,
		);
		const cellFill = tableShot.at(cellBox.x + cellBox.width - 6, cellBox.y + cellBox.height / 2);
		expect(deltaE(headerFill, cellFill), `header ${headerFill} vs cell ${cellFill}`).toBe(0);
		expect(contrast(await paintedColor(header, "color"), headerFill)).toBeGreaterThanOrEqual(4.5);
	});

	test("bar charts keep their data table, centre the legend and drop text-coloured outlines", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await openLearnerPolish(page, "learner-polish-en");
		const text = await paintedColor(page.locator("main#main-content"), "color");
		const chart = page.locator(".praxity-chart-container").first();
		const data = chart.getByRole("table");
		await expect(data).toHaveCount(1);
		await expect(data.getByRole("row")).toHaveCount(4);
		await expect(data.getByRole("columnheader")).toHaveText(["Label", "North", "South"]);
		await chart.scrollIntoViewIfNeeded();
		const legend = await chart.evaluate(legendLayout, LEGEND_PARTS);
		expect(legend.parts).toHaveLength(4);
		const legendLeft = Math.min(...legend.parts.map((part) => part.left));
		const legendRight = Math.max(...legend.parts.map((part) => part.right));
		expect
			.soft(
				Math.abs((legendLeft + legendRight) / 2 - legend.width / 2),
				"legend centred under the chart",
			)
			.toBeLessThanOrEqual(legend.width * 0.03);
		const gap = legend.parts[2].left - legend.parts[1].right;
		expect.soft(gap, "legend entries stay together").toBeGreaterThan(8);
		expect.soft(gap, "legend entries stay together").toBeLessThanOrEqual(48);

		const bar = chart.locator('svg.praxity-chart-visual:visible rect[fill*="chart-2"]').first();
		const barBox = await box(bar);
		const barMiddle = barBox.y + barBox.height / 2;
		const barShot = await capture(page, {
			x: barBox.x - 4,
			y: barMiddle - 2,
			width: barBox.width + 8,
			height: 4,
		});
		// The second series is the last bar in each group, so its right edge meets the plot.
		const right = barBox.x + barBox.width;
		const background = barShot.at(right + 3, barMiddle);
		const edge = darkest(barShot.span(right - 2, right + 2, barMiddle));
		expect.soft(contrast(edge, background), "bars keep a 3:1 boundary").toBeGreaterThanOrEqual(3);
		expect
			.soft(distance(edge, text), `bar edge ${edge} is not a text-coloured outline`)
			.toBeGreaterThan(60);
	});

	for (const variant of LEARNER_POLISH_VARIANTS) {
		test(`free-response placeholder is muted but keeps 4.5:1 contrast (${variant.locale} ${variant.colorMode})`, async ({
			page,
		}) => {
			const copy = POLISH_COPY[variant.locale];
			await page.setViewportSize({ width: 1280, height: 900 });
			await openLearnerPolish(page, variant.route);
			const island = page.locator('[data-island="assessment"]').first();
			await island.scrollIntoViewIfNeeded();
			await expect(island).toHaveAttribute("data-hydrated", "");
			const field = island.locator("textarea");
			await expect(field).toHaveAttribute("placeholder", copy.placeholder);
			const ink = async () => {
				const rect = await box(field);
				const shot = await capture(page, {
					x: rect.x + 3,
					y: rect.y + 3,
					width: rect.width - 6,
					height: Math.min(rect.height - 6, 40),
				});
				const background = shot.at(rect.x + rect.width - 12, rect.y + 6);
				// Text is the pixel furthest from the field: darker on light fields, lighter on dark.
				const ink = shot
					.all()
					.reduce((best, pixel) =>
						contrast(pixel, background) > contrast(best, background) ? pixel : best,
					);
				return { ink, background };
			};
			const placeholder = await ink();
			await field.fill(copy.placeholder);
			await field.evaluate((element) => (element as HTMLTextAreaElement).blur());
			const typed = await ink();
			const placeholderContrast = contrast(placeholder.ink, placeholder.background);
			const typedContrast = contrast(typed.ink, typed.background);
			expect(placeholderContrast, "placeholder stays readable").toBeGreaterThanOrEqual(4.5);
			expect(
				placeholderContrast,
				`placeholder ${placeholderContrast.toFixed(2)}:1 is quieter than answers ${typedContrast.toFixed(2)}:1`,
			).toBeLessThanOrEqual(typedContrast * 0.8);
		});
	}
});

const LEGEND_CASES = [
	{ name: "wide glyphs", series: ["WWWWWWWWWW", "i"] },
	{ name: "unequal names", series: ["International operations", "A"] },
	{ name: "similar names", series: ["Initial limits", "Information"] },
	{ name: "a second row", series: ["North", "South", "International operations"] },
] as const;

// Supported fonts with very different advance widths; Arial is the system baseline.
const LEGEND_FONTS = ["Source Sans 3", "Source Serif 4", "Atkinson Hyperlegible Next"] as const;

function legendFontFaces(): string {
	const require = createRequire(import.meta.url);
	return LEGEND_FONTS.map((family) => {
		const slug = family.toLowerCase().replace(/ /g, "-");
		const file = resolve(
			dirname(require.resolve(`@fontsource/${slug}/package.json`)),
			`files/${slug}-latin-400-normal.woff2`,
		);
		return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${readFileSync(file).toString("base64")})}`;
	}).join("");
}

for (const width of [720, 440, 280] as const) {
	test(`chart legends keep entries apart and centred at ${width} units in supported fonts`, async ({
		page,
	}) => {
		const svgs = LEGEND_CASES.map(({ series }) =>
			renderCartesianChartSvg(
				{ chartType: "bar" } as Parameters<typeof renderCartesianChartSvg>[0],
				["Q1", "Q2"],
				series.map((name) => ({ name, values: [1, 2] })),
				"Chart",
				width,
				String,
			),
		);
		// The shared stylesheet sets the chart's real text size.
		await page.setContent(
			`<style>${legendFontFaces()}${readFileSync(
				resolve(import.meta.dirname, "../../../shared-blocks/src/blocks/shared-blocks.css"),
				"utf8",
			).replace(/^@import[^;]+;/gm, "")}</style><body style="margin:0">${["Arial", ...LEGEND_FONTS]
				.map((font) =>
					svgs
						.map(
							(svg) =>
								`<div class="praxity-chart-container" data-font="${font}" style="width:${width}px;padding:0;font-family:'${font}';font-weight:400">${svg}</div>`,
						)
						.join(""),
				)
				.join("")}</body>`,
		);
		await page.evaluate(
			async (fonts) => {
				await Promise.all(fonts.map((font) => document.fonts.load(`16px "${font}"`)));
				await document.fonts.ready;
			},
			[...LEGEND_FONTS],
		);
		const legends = await Promise.all(
			(await page.locator(".praxity-chart-container").all()).map(async (container) => ({
				font: await container.getAttribute("data-font"),
				...(await container.evaluate(legendLayout, LEGEND_PARTS)),
			})),
		);
		legends.forEach((legend, index) => {
			const { name, series } = LEGEND_CASES[index % LEGEND_CASES.length];
			const label = `${name} in ${legend.font} at ${width}`;
			// A swatch and a name for every series.
			expect(legend.parts, label).toHaveLength(series.length * 2);
			const rows = new Map<number, typeof legend.parts>();
			for (const part of legend.parts) {
				const key = [...rows.keys()].find((middle) => Math.abs(middle - part.middle) < 8);
				rows.set(key ?? part.middle, [...(rows.get(key ?? part.middle) ?? []), part]);
			}
			const centre = legend.width / 2;
			for (const row of rows.values()) {
				row.sort((first, second) => first.left - second.left);
				for (const [before, after] of row.slice(1).map((part, at) => [row[at], part] as const))
					expect(after.left - before.right, `${label}: parts stay apart`).toBeGreaterThanOrEqual(4);
				const left = row[0].left;
				const right = row[row.length - 1].right;
				expect(left, `${label}: inside the chart`).toBeGreaterThanOrEqual(0);
				expect(right, `${label}: inside the chart`).toBeLessThanOrEqual(legend.width);
				expect(
					Math.abs((left + right) / 2 - centre),
					`${label}: row centred under the chart`,
				).toBeLessThanOrEqual(width * 0.03);
			}
		});
	});
}
