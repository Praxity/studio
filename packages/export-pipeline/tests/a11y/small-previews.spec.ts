import { expect, test } from "@playwright/test";
import { AUTHORING_CATALOG, catalogSlug } from "../fixtures/authoring-catalog";
import { NAV_CONFIGS, navConfigName } from "./fixtures/lightweight-fixture";
import { readNavVariantUrl, readTestEnv } from "./helpers";

for (const entry of AUTHORING_CATALOG.filter((entry) => entry.type === "assessment")) {
	test(`${entry.keyword}: small preview keeps the full assessment border, background and padding`, async ({
		page,
	}) => {
		const url = `${readTestEnv().url}/authoring-catalog/${catalogSlug(entry.keyword)}.html`;
		const appearances = [];
		const bodies = [];
		for (const small of [true, false]) {
			await page.goto(`${url}${small ? "?minimal=1&praxity-small-preview=1" : ""}`);
			const block = page.locator('[data-island="assessment"]');
			await block.scrollIntoViewIfNeeded();
			if (small) {
				await expect(page.locator("html")).toHaveAttribute(
					"data-praxity-small-preview-ready",
					"true",
				);
				await expect(block).not.toHaveAttribute("data-hydrated");
			} else {
				await expect(block).toHaveAttribute("data-hydrated", "");
			}
			const card = block.locator(".praxity-block-assessment:not(.praxity-block)");
			await expect(card).toBeVisible();
			appearances.push(
				await card.evaluate((node) => {
					const style = getComputedStyle(node);
					const stem = node.querySelector(".praxity-assessment-stem");
					if (!stem) throw new Error("Assessment heading missing");
					const headingStyle = getComputedStyle(stem);
					const input = node.querySelector('textarea, input[type="text"], input[type="number"]');
					const inputStyle = input ? getComputedStyle(input) : null;
					const points = node.querySelector(".praxity-assessment-points");
					const pointsStyle = points ? getComputedStyle(points) : null;
					return {
						border: style.border,
						borderRadius: style.borderRadius,
						background: style.backgroundColor,
						padding: style.padding,
						fontFamily: style.fontFamily,
						points: pointsStyle ? [pointsStyle.fontSize, pointsStyle.lineHeight] : null,
						heading: {
							tag: stem.tagName,
							fontSize: headingStyle.fontSize,
							fontWeight: headingStyle.fontWeight,
							lineHeight: headingStyle.lineHeight,
						},
						required: node.querySelectorAll(".praxity-required-indicator").length,
						input: inputStyle
							? {
									border: inputStyle.border,
									borderRadius: inputStyle.borderRadius,
									padding: inputStyle.padding,
									fontSize: inputStyle.fontSize,
									lineHeight: inputStyle.lineHeight,
								}
							: null,
					};
				}),
			);
			if (["matrix", "categorize", "order"].includes(entry.keyword)) {
				await page.evaluate(() => document.fonts.ready);
				bodies.push(
					await card.evaluate((node) => {
						// Compare body geometry at one content width, independent of preview navigation.
						(node as HTMLElement).style.width = "700px";
						(node as HTMLElement).style.maxWidth = "none";
						return Array.from(
							node.querySelectorAll(
								"table, thead th, tbody th, tbody td, .praxity-order-item, .praxity-order-position, .praxity-order-controls",
							),
						).map((element) => {
							const style = getComputedStyle(element);
							const bounds = element.getBoundingClientRect();
							return {
								width: Math.round(bounds.width),
								height: Math.round(bounds.height),
								padding: style.padding,
								borderInline: element.matches("th, td")
									? [
											style.borderInlineStartWidth,
											style.borderInlineStartStyle,
											style.borderInlineStartColor,
											style.borderInlineEndWidth,
											style.borderInlineEndStyle,
											style.borderInlineEndColor,
										]
									: null,
								background: style.backgroundColor,
								fontSize: style.fontSize,
								fontFamily: style.fontFamily,
								fontWeight: style.fontWeight,
							};
						});
					}),
				);
			}
		}
		expect(appearances[0]).toEqual(appearances[1]);
		if (bodies.length) {
			expect(bodies[0].length).toBeGreaterThan(0);
			expect(bodies[0]).toEqual(bodies[1]);
		}
		expect(appearances[0].border).toMatch(/^1px solid /);
		expect(appearances[0].background).not.toBe("rgba(0, 0, 0, 0)");
		expect(Number.parseFloat(appearances[0].padding)).toBeGreaterThan(0);
	});
}

test("small preview decorations need no runtime and readiness waits for fonts", async ({
	page,
}) => {
	const scripts: string[] = [];
	page.on("request", (request) => {
		if (request.resourceType() === "script") scripts.push(request.url());
	});
	await page.goto(
		`${readTestEnv().url}/inline-features/visible-formatting.html?praxity-small-preview=1`,
	);
	await expect(page.locator("html")).toHaveAttribute("data-praxity-small-preview-ready", "true");
	expect(await page.evaluate(() => document.fonts.status)).toBe("loaded");
	expect(scripts.some((url) => /island-doodle/.test(url))).toBe(false);
	expect(
		await page
			.locator('[data-doodle="box"]')
			.evaluate((element) => getComputedStyle(element).outlineStyle),
	).toBe("solid");
	await expect(page.locator("svg[data-praxity-doodle-decoration]")).toHaveCount(0);
	await expect(page.locator('[data-island="assessment"][data-hydrated]')).toHaveCount(0);
});

for (const config of NAV_CONFIGS) {
	const name = navConfigName(config);
	if (name !== "sidebar") continue;
	test(`${name}: expanding preview reports natural height and shrinks after long content`, async ({
		page,
	}) => {
		await page.goto(`${readNavVariantUrl("sidebar")}/page-one-static-content.html`);
		await page.evaluate(
			(url) => {
				document.body.innerHTML = "";
				const probe = window as typeof window & { __previewHeights: number[] };
				probe.__previewHeights = [];
				const frame = document.createElement("iframe");
				frame.style.cssText = "width:960px;height:540px;border:0";
				window.addEventListener("message", (event) => {
					if (
						event.source !== frame.contentWindow ||
						event.data?.type !== "praxity-small-preview-height"
					)
						return;
					probe.__previewHeights.push(event.data.height);
					frame.style.height = `${Math.max(540, event.data.height)}px`;
				});
				frame.src = url;
				document.body.append(frame);
			},
			`${readNavVariantUrl(name)}/page-one-static-content.html?praxity-small-preview=1&praxity-preview-expand=1`,
		);
		const iframe = page.locator("iframe");
		const main = page.frameLocator("iframe").locator("#main-content");
		await expect(main).toBeVisible();
		await expect(page.frameLocator("iframe").locator("html")).toHaveAttribute(
			"data-praxity-small-preview-ready",
			"true",
		);
		await page.clock.install();
		await main.evaluate((node) => {
			const content = document.createElement("div");
			content.id = "long-content";
			content.style.height = "1800px";
			node.append(content);
		});
		await expect.poll(async () => (await iframe.boundingBox())?.height ?? 0).toBeGreaterThan(1800);
		const expandedHeight = (await iframe.boundingBox())?.height;
		const messageCount = await page.evaluate(
			() => (window as typeof window & { __previewHeights: number[] }).__previewHeights.length,
		);
		expect(messageCount).toBeGreaterThan(0);
		// Advance rendering callbacks across a declared window. A feedback loop
		// can resend height without changing the iframe's final geometry.
		await page.evaluate(() => {
			const probe = window as typeof window & { __previewObservationComplete: boolean };
			probe.__previewObservationComplete = false;
			const start = performance.now();
			const observe = () => {
				if (performance.now() - start >= 500) {
					probe.__previewObservationComplete = true;
					return;
				}
				requestAnimationFrame(observe);
			};
			requestAnimationFrame(observe);
		});
		await page.clock.runFor(520);
		expect(
			await page.evaluate(
				() =>
					(window as typeof window & { __previewObservationComplete: boolean })
						.__previewObservationComplete,
			),
		).toBe(true);
		expect(
			await page.evaluate(
				() => (window as typeof window & { __previewHeights: number[] }).__previewHeights.length,
			),
		).toBe(messageCount);
		expect((await iframe.boundingBox())?.height).toBe(expandedHeight);
		await main.evaluate((node) => {
			node.replaceChildren();
		});
		await expect(iframe).toHaveCSS("height", "540px");
	});
}

for (const config of NAV_CONFIGS) {
	const name = navConfigName(config);
	test(`${name}: small preview releases navigation space at every width`, async ({ page }) => {
		for (const width of [960, 600, 375]) {
			await page.setViewportSize({ width, height: 540 });
			await page.goto(
				`${readNavVariantUrl(name)}/page-one-static-content.html?minimal=1&praxity-small-preview=1`,
			);
			await expect(page.locator("html")).toHaveAttribute("data-praxity-small-preview", "true");
			await expect(page.locator("main h1")).toBeVisible();
			await expect(page.locator(".praxity-layout-wrapper > :not(main):visible")).toHaveCount(0);
			await expect(
				page.locator(
					".praxity-floating-toc:visible, .praxity-scroll-progress:visible, #praxity-narrative-bar:visible, .praxity-skip-link:visible",
				),
			).toHaveCount(0);
			const bounds = await page.locator("#main-content").boundingBox();
			if (!bounds) throw new Error("Preview content is missing");
			expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThan(1);
			expect(bounds.y).toBe(0);
			expect(
				await page
					.locator("main")
					.evaluate((node) =>
						getComputedStyle(node).getPropertyValue("--praxity-container-width").trim(),
					),
			).toBe("100vw");
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				width + 1,
			);
			if (name === "sidebar" && width === 960) {
				await page.screenshot({ path: test.info().outputPath("small-preview-sidebar.png") });
			}
		}
	});
}

test("normal preview keeps its configured sidebar and header", async ({ page }) => {
	await page.setViewportSize({ width: 960, height: 540 });
	await page.goto(`${readNavVariantUrl("sidebar")}/page-one-static-content.html`);
	await expect(page.locator(".praxity-native-outline")).toBeVisible();
	await expect(page.locator(".praxity-top-bar")).toBeVisible();
	const bounds = await page.locator("#main-content").boundingBox();
	expect(bounds?.x).toBeGreaterThanOrEqual(260);
});

test("small preview keeps plain sections and wide images within stage gutters", async ({
	page,
}) => {
	await page.setViewportSize({ width: 960, height: 540 });
	await page.goto(
		`${readTestEnv().url}/small-preview-geometry/page-one-static-content.html?praxity-small-preview=1`,
	);
	await expect(page.locator(".praxity-section")).toHaveCount(0);
	const main = await page.locator("#main-content").boundingBox();
	// Read the rendered rectangle directly to avoid protocol quad subtraction.
	const image = await page
		.locator(".praxity-block-feature-width")
		.first()
		.evaluate((element) => {
			const { width, x } = element.getBoundingClientRect();
			return { width, x };
		});
	if (!main) throw new Error("Missing preview reading column");
	expect(main.width).toBeLessThan(960);
	expect(main.x).toBeGreaterThanOrEqual(32);
	expect(image?.width).toBe(896);
	// Centring a ch-sized reading column produces fractional layout positions.
	// Compare its breakout origin within half a physical pixel on every engine.
	const halfDevicePixel = await page.evaluate(() => 0.5 / devicePixelRatio);
	expect(Math.abs(image.x - 32)).toBeLessThanOrEqual(halfDevicePixel);
	await page.screenshot({ path: test.info().outputPath("small-preview-sections.png") });
});
