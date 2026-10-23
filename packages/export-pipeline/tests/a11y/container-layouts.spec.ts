import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { analyzeAxe, readTestEnv } from "./helpers";

async function openExample(page: Page, slug: string, small: boolean) {
	await page.goto(
		`${readTestEnv().url}/container-layouts/${slug}.html${small ? "?minimal=1&praxity-small-preview=1" : ""}`,
	);
	await page.evaluate(() => document.fonts.ready);
	if (small) {
		await expect(page.locator("html")).toHaveAttribute("data-praxity-small-preview-ready", "true");
	}
}

for (const small of [false, true]) {
	for (const width of [1280, 320]) {
		test.describe(`${small ? "small" : "full"} container layouts at ${width}px`, () => {
			test.beforeEach(async ({ page }) => {
				await page.setViewportSize({ width, height: 900 });
			});

			test("card rows preserve headings and rich content while stacking when narrow", async ({
				page,
			}) => {
				for (const slug of ["card-rows", "narrow-card-rows"]) {
					await openExample(page, slug, small);
					const cards = page.locator("[data-card-root] article");
					await expect(cards).toHaveCount(2);
					const heading = cards
						.first()
						.getByRole("heading", { name: "Before the meeting", level: 3 });
					await expect(heading).toBeVisible();
					await expect(cards.first().getByRole("listitem")).toHaveCount(2);
					const title = await heading.boundingBox();
					const body = await cards.first().locator("p").first().boundingBox();
					if (!title || !body) throw new Error("Row content missing");
					await expect(cards.first()).toHaveCSS("border-radius", "0px");
					if (width === 320 || slug === "narrow-card-rows") {
						expect(body.y).toBeGreaterThanOrEqual(title.y + title.height);
						expect(body.y - title.y - title.height).toBeLessThanOrEqual(40);
					} else {
						expect(body.x).toBeGreaterThan(title.x + title.width);
						const lines = await heading.evaluate((node) => {
							const range = document.createRange();
							range.selectNodeContents(node);
							return range.getClientRects().length;
						});
						expect(lines).toBeLessThanOrEqual(2);
					}
					await page.screenshot({ path: test.info().outputPath(`${slug}.png`), fullPage: true });
				}
			});

			test("media cards keep image-before-heading order and authored ratio/fit", async ({
				page,
			}) => {
				for (const media of ["flush", "inset"]) {
					await openExample(page, `media-${media}`, small);
					const cards = page.locator("[data-card-root] article");
					await expect(cards).toHaveCount(media === "flush" ? 2 : 1);
					for (const card of await cards.all()) {
						const img = card.getByRole("img");
						await img.scrollIntoViewIfNeeded();
						await expect
							.poll(() => img.evaluate((node: HTMLImageElement) => node.naturalWidth))
							.toBeGreaterThan(0);
						await expect(img).toHaveCSS("object-fit", media === "flush" ? "cover" : "contain");
						const geometry = await card.evaluate((node) => {
							const image = node.querySelector("img");
							const heading = node.querySelector("h3");
							if (!image || !heading) throw new Error("Media/heading missing");
							const bounds = node.getBoundingClientRect();
							const imageBounds = image.getBoundingClientRect();
							return {
								imageBefore: Boolean(
									image.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
								),
								ratio: imageBounds.width / imageBounds.height,
								inset: imageBounds.left - bounds.left,
								headingBelow: heading.getBoundingClientRect().top >= imageBounds.bottom - 1,
							};
						});
						expect(geometry.imageBefore).toBe(true);
						expect(geometry.headingBelow).toBe(true);
						expect(geometry.ratio).toBeCloseTo(16 / 9, 1);
						if (media === "flush") expect(geometry.inset).toBeLessThanOrEqual(2);
						else expect(geometry.inset).toBeGreaterThanOrEqual(12);
					}
					await page.screenshot({
						path: test.info().outputPath(`media-${media}.png`),
						fullPage: true,
					});
				}
			});

			test("comparison defaults are equal and authored column weights survive saving", async ({
				page,
			}) => {
				for (const slug of ["comparison-columns", "weighted-columns"]) {
					await openExample(page, slug, small);
					const columns = page.locator(".praxity-column");
					await expect(columns).toHaveCount(2);
					const bounds = await columns.evaluateAll((nodes) =>
						nodes.map((node) => {
							const { x, y, width, height } = node.getBoundingClientRect();
							return { x, y, width, height };
						}),
					);
					if (width === 320) {
						expect(bounds[1].y).toBeGreaterThanOrEqual(bounds[0].y + bounds[0].height);
						expect(Math.abs(bounds[0].width - bounds[1].width)).toBeLessThanOrEqual(1);
					} else {
						expect(bounds[1].width / bounds[0].width).toBeCloseTo(
							slug === "weighted-columns" ? 2 : 1,
							1,
						);
					}
				}
			});

			test("table labels remain whole and long tokens stay inside the scroll region", async ({
				page,
			}) => {
				await openExample(page, "row-table", small);
				const table = page.getByRole("table");
				await expect(table).toHaveAttribute("data-shade-headers", "false");
				await expect(table).toHaveAttribute("data-first-row-line", "false");
				await expect(table).toHaveAttribute("data-first-col-line", "true");
				const label = page.getByRole("rowheader", { name: "Inspect", exact: true });
				await expect(label).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
				await expect(label).toHaveCSS("border-right-width", "0px");
				await expect(label).toHaveCSS("border-right-style", "none");
				await expect(label).toHaveCSS("border-bottom-width", "1px");
				await expect(label).toHaveCSS("text-align", "left");
				await expect(table.getByRole("cell").first()).toHaveCSS("text-align", "left");
				const lines = await label.evaluate((node) => {
					const range = document.createRange();
					range.selectNodeContents(node);
					return range.getClientRects().length;
				});
				expect(lines).toBe(1);
				await openExample(page, "long-table-token", small);
				const region = page.locator(".praxity-table-scroll-region");
				await expect(region).toHaveCSS("overflow-x", "auto");
				await expect(region).toHaveAttribute("tabindex", "0");
				const reachable = await region.evaluate((node) => {
					node.scrollLeft = node.scrollWidth;
					return node.scrollWidth <= node.clientWidth + 1 || node.scrollLeft > 0;
				});
				expect(reachable).toBe(true);
			});

			test.afterEach(async ({ page }) => {
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
					),
				).toBeLessThanOrEqual(1);
			});
		});
	}
}

test("row and media cards introduce no automated accessibility violations", async ({ page }) => {
	for (const slug of ["card-rows", "media-flush"]) {
		await openExample(page, slug, false);
		const results = await analyzeAxe(
			page,
			new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]),
		);
		expect(results.violations).toEqual([]);
	}
});

for (const layout of ["rows", "slides", "masonry"]) {
	for (const width of [320, 1280]) {
		test(`${layout} media flip card preserves captions and back content at ${width}px`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ reducedMotion: "reduce" });
			await openExample(page, `media-${layout}-flip`, false);
			const root = page.locator("[data-card-root]");
			const front = root.locator('[data-card-side="front"]');
			const image = root.getByRole("img", { name: "Front illustration" });
			await expect
				.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
				.toBeGreaterThan(0);
			await expect(image).toHaveCSS("object-fit", "contain");
			await expect(root.getByText("Front image credit", { exact: true })).toBeVisible();
			const order = await root.evaluate((node) => {
				const image = node.querySelector("img");
				const caption = node.querySelector("figcaption");
				const heading = node.querySelector("h3");
				if (!image || !caption || !heading) throw new Error("Missing media card content");
				return {
					imageBeforeCaption: Boolean(
						image.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING,
					),
					captionBeforeHeading: Boolean(
						caption.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
					),
					headingBelow:
						heading.getBoundingClientRect().top >= caption.getBoundingClientRect().bottom - 1,
				};
			});
			expect(order).toEqual({
				imageBeforeCaption: true,
				captionBeforeHeading: true,
				headingBelow: true,
			});
			const toggle = root.locator("[data-card-flip]");
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			await expect(front).toBeVisible();
			const back = root.locator('[data-card-side="back"]');
			await expect(back.getByText("Back image credit", { exact: true })).toBeVisible();
			const backOrder = await back.evaluate((node) => {
				const paragraph = node.querySelector("p");
				const image = node.querySelector("img");
				return Boolean(
					paragraph &&
						image &&
						paragraph.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING,
				);
			});
			expect(backOrder).toBe(true);
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-expanded", "false");
			await expect(back).toBeHidden();
			await expect(root.getByText("Front image credit", { exact: true })).toBeVisible();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
				),
			).toBeLessThanOrEqual(1);
		});
	}
}
