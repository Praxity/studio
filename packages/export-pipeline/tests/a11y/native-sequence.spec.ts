import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { computeViewerSourceHash } from "../../src/bundle-viewer";
import { renderBlockHtml } from "../../src/render-block-html";
import { readCachedViewer, VIEWER_CACHE_DIR } from "../../src/viewer-cache";
import { inlineIslandImports } from "../fixtures/inline-island";
import { readTestEnv } from "./helpers";

const blocksCss = resolve(
	import.meta.dirname,
	"../../../shared-blocks/src/blocks/shared-blocks.css",
);
const blocksCssText = readFileSync(blocksCss, "utf8").replace(/^@import[^;]+;/m, "");

function sequenceBlock(data: Record<string, unknown>): PraxityBlock {
	return { id: "sequence", type: "sequence", data } as unknown as PraxityBlock;
}

async function renderSequence(page: Page, block: PraxityBlock) {
	await page.setViewportSize({ width: 1200, height: 800 });
	await page.setContent(
		`<main data-praxity-root style="width:600px;margin:auto;--praxity-container-width:1000px"><div class="host">${renderBlockHtml(block, { enabledIslands: new Set(["sequence"]) })}</div></main>`,
	);
	await page.addStyleTag({ content: blocksCssText });
}

async function loadBuiltSequenceIsland(page: Page): Promise<void> {
	const cached = await readCachedViewer(VIEWER_CACHE_DIR, await computeViewerSourceHash());
	if (!cached) throw new Error("Missing complete built viewer cache");
	const islandsDir = resolve(cached.directory, "islands");
	const filename = cached.manifest.islands["island-sequence"];

	const source = inlineIslandImports(resolve(islandsDir, filename));
	await page.addScriptTag({
		content: source,
		type: "module",
	});
}

test.describe("native sequence layout", () => {
	for (const alignment of ["left", "right", "center"]) {
		test(`keeps ordered and unordered list text start-aligned in ${alignment} sequences`, async ({
			page,
		}, testInfo) => {
			await renderSequence(
				page,
				sequenceBlock({
					variant: "timeline",
					orientation: "vertical",
					alignment,
					items: ["Earlier", "Later"].map((label) => ({
						id: label,
						label,
						children: [
							{
								id: `${label}-text`,
								type: "text",
								data: {
									content:
										"<p>A short paragraph.</p><ul><li>New investment in precision lenses and instruments for the observatory.</li><li>Expanded telescope storage.</li></ul><ol><li>Review instrument needs and consult with telescope operators.</li><li>Record the maintenance schedule.</li></ol>",
								},
							},
						],
					})),
				}),
			);
			await page.locator("main").evaluate((element) => {
				element.style.width = "360px";
			});
			const lists = page.locator(".praxity-sequence-content ul, .praxity-sequence-content ol");
			await expect(lists).toHaveCount(4);
			for (const list of await lists.all()) {
				await expect(list).toHaveCSS("text-align", "start");
				await expect(list).toHaveCSS("list-style-position", "outside");
				const item = list.locator(":scope > li").first();
				const starts = await item.evaluate((element) => {
					const range = document.createRange();
					range.selectNodeContents(element);
					return Array.from(range.getClientRects(), (rect) => rect.left);
				});
				expect(starts.length).toBeGreaterThan(1);
				expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(1);
			}
			await expect(page.locator(".praxity-sequence-content p").first()).toHaveCSS(
				"text-align",
				alignment === "left" ? /^(start|left)$/ : "right",
			);
			await page.screenshot({
				path: testInfo.outputPath(`sequence-lists-${alignment}.png`),
				fullPage: true,
			});
		});
	}

	test("aligns vertical markers and connector ends with item headings", async ({ page }) => {
		await renderSequence(
			page,
			sequenceBlock({
				variant: "numbered",
				orientation: "vertical",
				items: ["One", "Two"].map((label) => ({
					id: label,
					label,
					children: [
						{
							id: `${label}-text`,
							type: "text",
							data: { content: "<p>First line</p><p>Second line</p>" },
						},
					],
				})),
			}),
		);
		const positions = await page.locator(".praxity-sequence-item").evaluateAll((items) =>
			items.map((item) => {
				const marker = item.querySelector(".praxity-sequence-marker")?.getBoundingClientRect();
				const label = item.querySelector(".praxity-sequence-label")?.getBoundingClientRect();
				return {
					markerTop: marker?.top ?? 0,
					labelTop: label?.top ?? 100,
					markerHeight: marker?.height ?? 0,
				};
			}),
		);
		for (const position of positions) {
			expect(Math.abs(position.markerTop - position.labelTop)).toBeLessThan(1);
			expect(position.markerHeight).toBe(28);
		}
	});
	test("centres a vertical sequence within the authored content width", async ({ page }) => {
		await renderSequence(
			page,
			sequenceBlock({
				variant: "numbered",
				orientation: "vertical",
				alignment: "center",
				items: ["Plan", "Build", "Test", "Ship"].map((label) => ({
					id: label,
					label,
					children: [{ id: `${label}-body`, type: "text", data: { content: label } }],
				})),
			}),
		);

		const geometry = await page.locator(".praxity-sequence-frame").evaluate((frame) => {
			const frameRect = frame.getBoundingClientRect();
			const markers = Array.from(frame.querySelectorAll<HTMLElement>(".praxity-sequence-marker"));
			const contents = Array.from(frame.querySelectorAll<HTMLElement>(".praxity-sequence-content"));
			return {
				frameWidth: frameRect.width,
				markerCenters: markers.map((marker) => {
					const rect = marker.getBoundingClientRect();
					return rect.left + rect.width / 2;
				}),
				contentSides: contents.slice(0, 2).map((content) => {
					const rect = content.getBoundingClientRect();
					return { left: rect.left, right: rect.right };
				}),
			};
		});

		expect(geometry.frameWidth).toBe(600);
		expect(Math.max(...geometry.markerCenters) - Math.min(...geometry.markerCenters)).toBeLessThan(
			1,
		);
		expect(geometry.contentSides[0].right).toBeLessThan(geometry.markerCenters[0]);
		expect(geometry.contentSides[1].left).toBeGreaterThan(geometry.markerCenters[1]);
	});

	test("preserves scaled spacing and keyboard scrolling without page overflow", async ({
		page,
	}) => {
		await renderSequence(
			page,
			sequenceBlock({
				variant: "timeline",
				orientation: "horizontal",
				distribution: "scaled",
				scrollable: true,
				items: ["2000", "2001", "2010", "2020"].map((label) => ({
					id: label,
					label,
					children: [{ id: `${label}-body`, type: "text", data: { content: label } }],
				})),
			}),
		);
		await loadBuiltSequenceIsland(page);

		const viewport = page.getByRole("group", { name: "Scrollable sequence" });
		await expect(viewport).toBeVisible();
		await expect(page.getByRole("button", { name: "Scroll sequence right" })).toBeVisible();
		const before = await viewport.evaluate((element) => ({
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
			scrollLeft: element.scrollLeft,
		}));
		expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);

		const markerCenters = await page.locator(".praxity-sequence-marker").evaluateAll((markers) =>
			markers.map((marker) => {
				const rect = marker.getBoundingClientRect();
				return rect.left + rect.width / 2;
			}),
		);
		expect(markerCenters[2] - markerCenters[1]).toBeGreaterThan(
			markerCenters[1] - markerCenters[0],
		);

		await viewport.focus();
		await page.keyboard.press("ArrowRight");
		await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
		const pageOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(pageOverflow).toBeLessThanOrEqual(1);
	});
});

for (const small of [false, true]) {
	test(`${small ? "small" : "full"} saved narrow notes, quotes and cards center within the reading width`, async ({
		page,
	}, testInfo) => {
		await page.goto(
			`${readTestEnv().url}/container-layouts/narrow-reading.html${small ? "?minimal=1&praxity-small-preview=1" : ""}`,
		);
		await page.evaluate(() => document.fonts.ready);
		if (small) {
			await expect(page.locator("html")).toHaveAttribute(
				"data-praxity-small-preview-ready",
				"true",
			);
		}
		await expect(page.locator(".praxity-layout-narrow")).toHaveCount(3);
		await expect(page.getByRole("heading", { name: "A narrow card", exact: true })).toBeVisible();
		for (const width of [320, 768, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			const geometry = await page.locator(".praxity-layout-narrow").evaluateAll((elements) =>
				elements.map((element) => {
					const bounds = element.getBoundingClientRect();
					const parentElement = element.parentElement;
					if (!parentElement) throw new Error("Missing parent");
					const parent = parentElement.getBoundingClientRect();
					const style = getComputedStyle(parentElement);
					const contentLeft =
						parent.left +
						Number.parseFloat(style.borderLeftWidth) +
						Number.parseFloat(style.paddingLeft);
					const parentWidth =
						parent.width -
						Number.parseFloat(style.borderLeftWidth) -
						Number.parseFloat(style.borderRightWidth) -
						Number.parseFloat(style.paddingLeft) -
						Number.parseFloat(style.paddingRight);
					// Measure the published 45ch contract independently, using the surrounding
					// body font rather than the card heading or the target's own CSS width.
					const probe = document.createElement("div");
					probe.style.cssText =
						"position:absolute;visibility:hidden;width:45ch;max-width:none;padding:0;border:0;font:inherit";
					parentElement.append(probe);
					const measure = probe.getBoundingClientRect().width;
					probe.remove();
					const wrapperStyle = getComputedStyle(element);
					return {
						width: bounds.width,
						parentWidth,
						expectedWidth: Math.min(parentWidth, measure),
						bodyFont: [style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle],
						wrapperFont: [
							wrapperStyle.fontFamily,
							wrapperStyle.fontSize,
							wrapperStyle.fontWeight,
							wrapperStyle.fontStyle,
						],
						offset: Math.abs(bounds.left - contentLeft - (parentWidth - bounds.width) / 2),
					};
				}),
			);
			for (const box of geometry) {
				expect(box.offset).toBeLessThan(1);
				expect(box.wrapperFont).toEqual(box.bodyFont);
				expect(box.width).toBeCloseTo(box.expectedWidth, 0);
				expect(box.width).toBeLessThanOrEqual(box.parentWidth);
				if (width === 320) expect(box.width).toBeCloseTo(box.parentWidth, 0);
			}
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true,
			);
			await page.screenshot({ path: testInfo.outputPath(`narrow-${width}.png`), fullPage: true });
		}
		await page.setViewportSize({ width: 320, height: 900 });
		await page.locator("main").evaluate((element) => {
			element.style.fontSize = "36px";
		});
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
	});
}
