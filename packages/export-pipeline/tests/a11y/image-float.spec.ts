import { expect, type Page, test } from "@playwright/test";
import { readNavVariantUrl, waitForHydration } from "./helpers";
import { applyTextSpacing, applyTwoHundredPercentZoom } from "./layout-overrides";

const MEDIUM_THRESHOLD = "27em";
const FLOATED_TEXT_CARRIER =
	'[data-block-type="image"]:has(figure[data-image-float]) + [data-block-type="text"]';

async function openFloatedImage(page: Page): Promise<void> {
	const baseUrl = readNavVariantUrl("scroll");
	expect(baseUrl, "Missing scroll fixture URL").toBeTruthy();
	if (!baseUrl) throw new Error("Missing scroll fixture URL");

	await page.goto(`${baseUrl}/page-1.html`, { waitUntil: "domcontentloaded" });
	await waitForHydration(page);
	await page.evaluate(async () => document.fonts?.ready);
	const image = page.locator('figure[data-image-float="right"][data-image-width="medium"] img');
	await expect(image).toBeVisible();
	await image.evaluate((element: HTMLImageElement) => {
		if (element.complete) return;
		return new Promise<void>((resolve) => {
			element.addEventListener("load", () => resolve(), { once: true });
			element.addEventListener("error", () => resolve(), { once: true });
		});
	});
}

async function setContentWidth(page: Page, width: string): Promise<void> {
	await page.addStyleTag({
		content: `#main-content.praxity-page-content { box-sizing: content-box; width: ${width}; max-width: none; padding-inline: 0; }`,
	});
}

async function floatGeometry(page: Page) {
	return page.evaluate((textCarrierSelector) => {
		const figure = document.querySelector<HTMLElement>("figure[data-image-float]");
		const textCarrier = document.querySelector<HTMLElement>(textCarrierSelector);
		const text =
			textCarrier?.querySelector<HTMLElement>(":scope > .praxity-block-text") ?? textCarrier;
		if (!figure || !text) throw new Error("Missing wrapped image fixture markup");
		const figureRect = figure.getBoundingClientRect();
		const textRect = text.getBoundingClientRect();
		return {
			float: getComputedStyle(figure).float,
			figure: {
				left: figureRect.left,
				right: figureRect.right,
				top: figureRect.top,
				bottom: figureRect.bottom,
			},
			text: {
				left: textRect.left,
				right: textRect.right,
				top: textRect.top,
				bottom: textRect.bottom,
			},
		};
	}, FLOATED_TEXT_CARRIER);
}

async function expectStackedWithoutOverflow(page: Page): Promise<void> {
	const geometry = await floatGeometry(page);
	expect(geometry.float).toBe("none");
	expect(geometry.text.top).toBeGreaterThanOrEqual(geometry.figure.bottom - 1);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
	).toBe(true);
}

async function proseLane(page: Page) {
	return page.evaluate((textCarrierSelector) => {
		const figure = document.querySelector<HTMLElement>("figure[data-image-float]");
		const textCarrier = document.querySelector<HTMLElement>(textCarrierSelector);
		const text =
			textCarrier?.querySelector<HTMLElement>(":scope > .praxity-block-text") ?? textCarrier;
		if (!figure || !text) throw new Error("Missing wrapped image fixture markup");
		const probe = document.createElement("span");
		probe.style.cssText = "position:absolute;visibility:hidden;width:22ch;font:inherit";
		text.append(probe);
		const required = probe.getBoundingClientRect().width;
		probe.remove();
		const figureRect = figure.getBoundingClientRect();
		const textRect = text.getBoundingClientRect();
		const gutter = Number.parseFloat(getComputedStyle(figure).marginInlineStart) || 0;
		return { available: figureRect.left - gutter - textRect.left, required };
	}, FLOATED_TEXT_CARRIER);
}

test.describe("image float regions", () => {
	test("stacks just below and floats just above the medium threshold", async ({ page }) => {
		await page.setViewportSize({ width: 900, height: 900 });
		await openFloatedImage(page);
		await setContentWidth(page, `calc(${MEDIUM_THRESHOLD} - 1px)`);
		const below = await floatGeometry(page);
		expect(below.float).toBe("none");
		expect(below.text.top).toBeGreaterThanOrEqual(below.figure.bottom - 1);

		await setContentWidth(page, `calc(${MEDIUM_THRESHOLD} + 1px)`);
		const above = await floatGeometry(page);
		expect(above.float).not.toBe("none");
		expect(above.figure.left).toBeGreaterThan(above.text.left);
		expect(above.text.top).toBeLessThan(above.figure.bottom);
	});

	for (const size of ["small", "medium"] as const) {
		test(`stacked ${size} images use phone width and retain float-side alignment`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 390, height: 900 });
			await openFloatedImage(page);
			await setContentWidth(page, "18rem");
			const figure = page.locator("figure[data-image-float]");
			await figure.evaluate((element, value) => {
				element.setAttribute("data-image-width", value);
				(element as HTMLElement).style.maxWidth = value === "small" ? "33%" : "50%";
			}, size);
			for (const side of ["left", "right"] as const) {
				for (const intrinsicWidth of [800, 120]) {
					await figure.evaluate(
						async (element, options) => {
							element.setAttribute("data-image-float", options.side);
							const image = element.querySelector("img");
							if (!image) throw new Error("Missing float image");
							image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${options.intrinsicWidth}" height="80"><rect width="100%" height="100%" fill="teal"/></svg>`)}`;
							image.width = options.intrinsicWidth;
							image.height = 80;
							await image.decode();
						},
						{ side, intrinsicWidth },
					);
					const geometry = await figure.evaluate((element) => {
						const image = element.querySelector("img");
						const region = element.closest(".praxity-float-region");
						if (!image || !region) throw new Error("Missing float region");
						const bounds = element.getBoundingClientRect();
						const container = region.getBoundingClientRect();
						return {
							width: bounds.width,
							expected: Math.min(image.naturalWidth, container.width),
							left: bounds.left - container.left,
							right: container.right - bounds.right,
						};
					});
					expect(Math.abs(geometry.width - geometry.expected)).toBeLessThan(1);
					expect(Math.abs(geometry[side])).toBeLessThan(1);
					await expectStackedWithoutOverflow(page);
				}
			}
		});
	}

	test("leaves a prose lane at least 22ch wide", async ({ page }) => {
		await page.setViewportSize({ width: 900, height: 900 });
		await openFloatedImage(page);
		await setContentWidth(page, "32em");

		const lane = await proseLane(page);

		expect(lane.available).toBeGreaterThanOrEqual(lane.required - 1);
	});

	test("uses the viewer text size when the host root is smaller", async ({ page }) => {
		await page.setViewportSize({ width: 900, height: 900 });
		await openFloatedImage(page);
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "14px";
			const content = document.querySelector<HTMLElement>(".praxity-page-content");
			if (!content) throw new Error("Missing page content");
			content.style.fontSize = "20px";
		});
		await setContentWidth(page, "379px");
		await expectStackedWithoutOverflow(page);

		await setContentWidth(page, "30em");
		expect((await floatGeometry(page)).float).not.toBe("none");
		const lane = await proseLane(page);
		expect(lane.available).toBeGreaterThanOrEqual(lane.required - 1);
	});

	test("stacks without horizontal overflow at 320 CSS px under 200% zoom", async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "200% zoom uses the Chromium DevTools Protocol");
		await page.setViewportSize({ width: 640, height: 900 });
		await openFloatedImage(page);
		await applyTwoHundredPercentZoom(page);
		expect(await page.evaluate(() => window.innerWidth)).toBe(320);
		await expectStackedWithoutOverflow(page);
	});

	test("stacks without horizontal overflow at 320px with WCAG text spacing", async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 900 });
		await openFloatedImage(page);
		await applyTextSpacing(page);
		await expectStackedWithoutOverflow(page);
	});

	test("resets the float for print without freezing the prose", async ({ page }) => {
		await page.setViewportSize({ width: 1000, height: 900 });
		await openFloatedImage(page);
		await setContentWidth(page, "32em");
		expect((await floatGeometry(page)).float).not.toBe("none");

		await page.emulateMedia({ media: "print" });
		const printStyles = await page.locator("figure[data-image-float]").evaluate((figure) => {
			const style = getComputedStyle(figure);
			return { float: style.float, breakInside: style.breakInside };
		});
		expect(printStyles.float).toBe("none");
		expect(printStyles.breakInside).toBe("avoid");
		expect(
			await page.locator(FLOATED_TEXT_CARRIER).evaluate((carrier) => {
				const text = carrier.querySelector<HTMLElement>(":scope > .praxity-block-text") ?? carrier;
				return getComputedStyle(text).breakInside;
			}),
		).not.toBe("avoid");
	});
});

test("headings and lists stay in the float region until the explicit close", async ({ page }) => {
	await page.setViewportSize({ width: 1200, height: 900 });
	await openFloatedImage(page);
	await setContentWidth(page, "48rem");
	await page.addStyleTag({
		content:
			"figure[data-image-float] img { height: 650px !important; max-height: none; object-fit: cover; }",
	});
	const region = page.locator(".praxity-float-region");
	await expect(region).toHaveCount(1);
	await expect(region.getByRole("heading", { name: "Learning beside the image" })).toBeVisible();
	await expect(region.getByRole("list")).toBeVisible();
	for (const side of ["right", "left"] as const) {
		await page.locator("figure[data-image-float]").evaluate((figure, value) => {
			figure.setAttribute("data-image-float", value);
		}, side);
		const geometry = await region.evaluate((element) => {
			const figure = element.querySelector("figure");
			const heading = element.querySelector("h2");
			const item = element.querySelector("li");
			if (!figure || !heading || !item) throw new Error("Float region content missing");
			const textRect = (node: Element) => {
				const range = document.createRange();
				range.selectNodeContents(node);
				const rect = range.getBoundingClientRect();
				return { left: rect.left, right: rect.right, top: rect.top };
			};
			const bounds = figure.getBoundingClientRect();
			return {
				figure: { left: bounds.left, right: bounds.right, bottom: bounds.bottom },
				heading: textRect(heading),
				item: textRect(item),
			};
		});
		for (const text of [geometry.heading, geometry.item]) {
			expect(text.top).toBeLessThan(geometry.figure.bottom);
			if (side === "right") expect(text.right).toBeLessThanOrEqual(geometry.figure.left);
			else expect(text.left).toBeGreaterThanOrEqual(geometry.figure.right);
		}
		const after = page.getByText("This paragraph follows the cleared float region.");
		expect((await after.boundingBox())?.y).toBeGreaterThanOrEqual(geometry.figure.bottom);
	}
});

test("uses the float region width inside a narrow container", async ({ page }) => {
	await page.setViewportSize({ width: 1200, height: 900 });
	await openFloatedImage(page);
	await setContentWidth(page, "48rem");
	await page.locator(".praxity-float-region").evaluate((region) => {
		(region as HTMLElement).style.width = "20rem";
	});
	const geometry = await floatGeometry(page);
	expect(geometry.float).toBe("none");
	expect(geometry.text.top).toBeGreaterThanOrEqual(geometry.figure.bottom - 1);
});
