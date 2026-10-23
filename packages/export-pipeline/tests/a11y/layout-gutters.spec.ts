import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const tokensCss = readFileSync(
	resolve(import.meta.dirname, "../../../shared-blocks/src/reading-rhythm.css"),
	"utf8",
);
const globalCss = readFileSync(
	resolve(import.meta.dirname, "../../template/src/styles/global.css"),
	"utf8",
);
const blockCss = readFileSync(
	resolve(import.meta.dirname, "../../../shared-blocks/src/blocks/shared-blocks.css"),
	"utf8",
).replace(/^@import[^;]+;/m, "");
const viewerCss = readFileSync(
	resolve(import.meta.dirname, "../../../shared-blocks/src/viewer/viewer-shell.css"),
	"utf8",
);
const deckCss = readFileSync(
	resolve(import.meta.dirname, "../../../shared-blocks/src/viewer/deck-shell.css"),
	"utf8",
);

const blocks = `
	<h1>Observing the Night Sky</h1>
	<p>Reading-column paragraph</p>
	<div id="chart" class="praxity-block praxity-layout-full"><figure class="praxity-chart-container praxity-figure-reset"><h2>Annual observatory equipment allocations</h2><svg viewBox="0 0 400 100" role="img" aria-label="Chart"><text x="0" y="30">Lenses ordered</text></svg></figure></div>
	<div id="paired-charts" class="praxity-block praxity-layout-breakout"><h2>Lenses polished</h2><h2>Share of clear lenses</h2></div>
	<div id="card-grid" class="praxity-block praxity-layout-wide">Seven optical calibration stages</div>
	<div id="card-rows" class="praxity-block praxity-layout-wide">Observatory teams and instrument roles</div>
	<div id="group-header" class="praxity-block praxity-layout-wide">Learning</div>
	<div id="group-member" class="praxity-block praxity-layout-wide">Survey question</div>
	<div id="group-footer" class="praxity-block praxity-layout-wide">Submit</div>
	<section class="praxity-section"><div id="section-chart" class="praxity-block praxity-layout-full">Section chart</div></section>
`;

async function mount(page: Page, mode: "slides" | "sidebar" | "static", width: number) {
	await page.setViewportSize({ width, height: 900 });
	const shell =
		mode === "static"
			? `<main id="main-content" class="praxity-page-content">${blocks}</main>`
			: `<div class="praxity-viewer-shell praxity-layout-${mode}" style="--praxity-viewer-shell-width:${width}px;--praxity-viewer-content-frame-width:${mode === "sidebar" ? width - 260 : width}px"><div class="praxity-layout-wrapper praxity-layout-${mode}">${mode === "sidebar" ? '<div id="praxity-course-menu"><div class="praxity-course-menu-root"></div></div>' : ""}<main id="main-content" class="praxity-page-content">${mode === "slides" ? `<div class="praxity-slide">${blocks}</div>` : blocks}</main></div></div>`;
	await page.setContent(
		`<html data-praxity-root><body class="praxity-layout-${mode}" style="--praxity-max-width:720px;--praxity-space-boundary:16px">${shell}</body></html>`,
	);
	await page.addStyleTag({ content: tokensCss });
	await page.addStyleTag({ content: globalCss });
	await page.addStyleTag({ content: blockCss });
	await page.addStyleTag({ content: viewerCss });
}

async function checkGutters(page: Page, minimum: number) {
	const geometry = await page.evaluate(() => {
		const rect = (selector: string) => {
			const node = document.querySelector(selector);
			if (!node) throw new Error(`Missing ${selector}`);
			return node.getBoundingClientRect();
		};
		const frame = document.querySelector(".praxity-deck #main-content")
			? { left: rect("#main-content").left, right: rect("#main-content").right }
			: document.querySelector(".praxity-layout-sidebar")
				? { left: rect("#praxity-course-menu .praxity-course-menu-root").right, right: innerWidth }
				: { left: 0, right: innerWidth };
		return {
			frame,
			blocks: [
				"#chart",
				"#paired-charts",
				"#card-grid",
				"#card-rows",
				"#group-header",
				"#group-member",
				"#group-footer",
				"#section-chart",
			].map((selector) => ({ selector, left: rect(selector).left, right: rect(selector).right })),
			section: { left: rect(".praxity-section").left, right: rect(".praxity-section").right },
			overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
		};
	});
	for (const block of geometry.blocks) {
		const left = block.left - geometry.frame.left;
		const right = geometry.frame.right - block.right;
		expect(left, `${block.selector} left gutter`).toBeGreaterThanOrEqual(minimum - 1);
		expect(right, `${block.selector} right gutter`).toBeGreaterThanOrEqual(minimum - 1);
		expect(Math.abs(left - right), `${block.selector} centering`).toBeLessThanOrEqual(2);
	}
	expect(geometry.section.left).toBeGreaterThanOrEqual(geometry.frame.left + minimum - 1);
	expect(geometry.section.right).toBeLessThanOrEqual(geometry.frame.right - minimum + 1);
	expect(geometry.overflow).toBeLessThanOrEqual(1);
}

test("published and preview layouts center content with sections in the paper column", async ({
	page,
}) => {
	for (const width of [320, 390, 800, 900, 901, 1280]) {
		await mount(page, "slides", width);
		await checkGutters(page, width <= 768 ? 16 : 24);
		if (width === 800)
			await page.screenshot({ path: test.info().outputPath("slides-800.png"), fullPage: true });
	}
	for (const width of [320, 800]) {
		await mount(page, "static", width);
		await checkGutters(page, 24);
	}
});

test("persistent sidebar centers wide content in its available frame", async ({ page }) => {
	for (const width of [1024, 1440]) {
		await mount(page, "sidebar", width);
		await checkGutters(page, 24);
		if (width === 1024)
			await page.screenshot({ path: test.info().outputPath("sidebar-1024.png"), fullPage: true });
	}
});

test("open deck panels center content in the remaining slide canvas", async ({ page }) => {
	for (const panel of ["script", "outline"]) {
		for (const width of [1280, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			await page.setContent(
				`<html data-praxity-root><body class="praxity-layout-slides" style="--praxity-max-width:720px;--praxity-space-boundary:16px"><div class="praxity-deck" data-ready="true" data-panel="${panel}"><div class="deck-workspace"><main id="main-content" class="praxity-page-content"><div class="deck-slide"><article class="praxity-slide">${blocks}</article></div></main><aside class="deck-panels"></aside></div></div></body></html>`,
			);
			await page.addStyleTag({ content: tokensCss });
			await page.addStyleTag({ content: globalCss });
			await page.addStyleTag({ content: blockCss });
			await page.addStyleTag({ content: viewerCss });
			await page.addStyleTag({ content: deckCss });
			await checkGutters(page, 24);
		}
	}
});
