import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import { buildSync } from "esbuild";
import { DEFAULT_DESIGN_VARIANTS } from "../../../editor-core/src/lib/themes/design-variant-defaults";
import {
	grammar4Starter,
	withFixtureSetting,
} from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { renderBlockHtml } from "../../src/render-block-html";
import { expectForcedEmulationInert, forcedPalette } from "../focus-assertions";
import { findPageWithSelector, readTestEnv } from "./helpers";

const css =
	`html:root{${Object.entries(resolveDesignTokens(DEFAULT_DESIGN_VARIANTS, "light"))
		.map(([key, value]) => `${key}:${value}`)
		.join(";")}}` +
	readFileSync(
		resolve(import.meta.dirname, "../../../shared-blocks/src/reading-rhythm.css"),
		"utf8",
	) +
	readFileSync(
		resolve(import.meta.dirname, "../../../shared-blocks/src/blocks/shared-blocks.css"),
		"utf8",
	).replace(/^@import[^;]+;/m, "");
const ratingScript = buildSync({
	entryPoints: [resolve(import.meta.dirname, "../../template/src/islands/island-rating.ts")],
	bundle: true,
	write: false,
	format: "iife",
}).outputFiles[0].text;

for (const width of [360, 1024]) {
	for (const mode of ["small", "full"]) {
		test(`${mode} preview gives reading notes full body width at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });
			const query = mode === "small" ? "?minimal=1&praxity-small-preview=1" : "";
			for (const iconless of [true, false]) {
				const slug = iconless ? "catalog-iconless-note" : "catalog-note";
				await page.goto(`${readTestEnv().url}/authoring-catalog/${slug}.html${query}`);
				const note = page.getByRole("note");
				await expect(note).toBeVisible();
				await expect(note.locator(".praxity-note-icon")).toHaveCount(0);
				if (iconless) {
					await expect(note).toContainText("For sample review");
					await expect(note.locator(".praxity-note-label")).toHaveText("For sample review");
					await expect(note.locator(".praxity-note-title")).toHaveCount(0);
					await expect(note).toContainText("Note text");
				}
				const geometry = await note.evaluate((element) => {
					const body = element.querySelector(".praxity-note-body");
					if (!body) throw new Error("Missing note body");
					const style = getComputedStyle(element);
					const rect = element.getBoundingClientRect();
					const bodyRect = body.getBoundingClientRect();
					return {
						available:
							element.clientWidth -
							Number.parseFloat(style.paddingLeft) -
							Number.parseFloat(style.paddingRight),
						bodyWidth: bodyRect.width,
						height: rect.height,
						columns: style.gridTemplateColumns.split(" ").length,
						bodyOffset:
							bodyRect.left -
							rect.left -
							Number.parseFloat(style.borderLeftWidth) -
							Number.parseFloat(style.paddingLeft),
						overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
					};
				});
				expect(geometry.columns).toBe(1);
				expect(Math.abs(geometry.bodyWidth - geometry.available)).toBeLessThanOrEqual(1);
				expect(Math.abs(geometry.bodyOffset)).toBeLessThanOrEqual(1);
				expect(geometry.height).toBeGreaterThan(40);
				expect(geometry.height).toBeLessThan(200);
				expect(geometry.overflow).toBeLessThanOrEqual(1);
			}
		});
	}
}

test("rating styles survive parsing and support keyboard selection", async ({ page }) => {
	const blocks = ["likert", "stars", "slider"].map(
		(style) =>
			readLesson(
				`# Fixture {hideTitle}\n\n::: rating ${style} {style=${style} level=3}\n1. Low\n2. Medium\n3. High\n:::\n`,
			).pages[0].blocks[0],
	);
	blocks.forEach((block, index) => {
		block.id = `rating-${index}`;
	});
	await page.setContent(
		`<main data-praxity-root>${blocks.map((block) => renderBlockHtml(block, { enabledIslands: new Set(["rating"]) })).join("")}</main>`,
	);
	await page.addStyleTag({ content: css });
	await page.addScriptTag({ content: ratingScript });
	await expect(
		page.locator('[data-rating-style="likert"] .praxity-rating-visual').first(),
	).toHaveText("Low");
	const firstStar = page.getByRole("radiogroup", { name: "stars" }).getByRole("radio").first();
	await firstStar.focus();
	await firstStar.press("ArrowRight");
	await expect(
		page.getByRole("radiogroup", { name: "stars" }).getByRole("radio").nth(1),
	).toBeChecked();
	const slider = page.getByRole("slider", { name: "slider" });
	await slider.focus();
	await slider.press("ArrowRight");
	await expect(slider).toHaveValue("2");
	await expect(slider).toHaveAttribute("aria-valuetext", /Medium/);
	await expect(page.locator('[data-block-id="rating-2"]')).toHaveAttribute(
		"data-completed",
		"true",
	);
	await expect(page.locator('[data-rating-style="slider"] .praxity-rating-options')).toBeHidden();
});

for (const [type, control] of [
	["matching", "select"],
	["sequence", "ol"],
	["textResponse", "textarea"],
]) {
	test(`${type} remains visible in small and full previews`, async ({ page }) => {
		const env = readTestEnv();
		const selector = `[data-island="assessment"][data-block-json*='"assessmentType":"${type}"']`;
		const meta = await findPageWithSelector(page, env.url, env.pages, selector);
		if (!meta) throw new Error(`Missing ${type} assessment fixture`);
		const block = page.locator(selector).first();
		await block.scrollIntoViewIfNeeded();
		await expect(block).toHaveAttribute("data-hydrated", "");
		await expect(block).not.toBeEmpty();
		await page.goto(`${env.url}/${meta.slug}.html?minimal=1&praxity-small-preview=1`);
		await expect(block.locator(control).first()).toBeVisible();
		const stem = block.locator(".praxity-assessment-stem");
		await expect(stem).toBeVisible();
		await expect(stem).not.toBeEmpty();
		await expect(stem).toHaveJSProperty("tagName", "P");
		const stemId = await stem.getAttribute("id");
		if (!stemId) throw new Error("Assessment stem needs an ID for its fieldset");
		await expect(block.getByRole("group")).toHaveAttribute("aria-labelledby", stemId);
		await expect(block.getByRole("group")).toHaveAccessibleName(/\S/);
		await expect(block).not.toHaveAttribute("data-hydrated", "");
	});
}

for (const orientation of ["horizontal", "vertical"]) {
	test(`saved tab styles converge on an underline list, authored ${orientation}`, async ({
		page,
	}) => {
		const blocks = ["default", "outline", "pills"].map((variant) => {
			const block = readLesson(
				`# Fixture {hideTitle}\n\n::: tabs {style=${variant} orientation=${orientation}}\n:: Draft {level=3}\nFirst panel.\n:: Revise {level=3}\nSecond panel.\n:::\n`,
			).pages[0].blocks[0];
			block.id = variant;
			return block;
		});
		await page.setContent(
			`<main data-praxity-root style="width:600px;margin:auto;--praxity-color-activity-border:#ccc">${blocks.map((block) => renderBlockHtml(block)).join("")}</main>`,
		);
		await page.addStyleTag({ content: css });
		for (const block of blocks) {
			const list = page.locator(`[data-block-id="${block.id}"] [role="tablist"]`);
			await expect(list).toHaveAttribute("aria-orientation", "horizontal");
			const [first, second] = await list.getByRole("tab").evaluateAll((tabs) =>
				tabs.map((tab) => {
					const rect = tab.getBoundingClientRect();
					return { x: rect.x, y: rect.y };
				}),
			);
			expect(second.y).toBe(first.y);
			expect(second.x).toBeGreaterThan(first.x);
		}
		const active = (id: string) => page.locator(`[data-block-id="${id}"] [aria-selected="true"]`);
		await expect(active("default")).toHaveCSS("border-top-width", "0px");
		await expect(active("outline")).toHaveCSS("border-top-width", "0px");
		await expect(active("pills")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		for (const block of blocks) await expect(active(block.id)).toHaveCSS("font-weight", "600");
	});
}

for (const width of [360, 1024]) {
	test(`small-preview free response uses readable full-width controls at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(
			`${readTestEnv().url}/authoring-catalog/catalog-free-response.html?minimal=1&praxity-small-preview=1`,
		);
		const block = page.locator('[data-block-type="assessment"]');
		const input = block.getByRole("textbox");
		await expect(input).toBeVisible();
		await expect(input).toBeDisabled();
		await expect(block).not.toHaveAttribute("data-hydrated", "");
		const geometry = await input.evaluate((element) => {
			const fieldset = element.closest("fieldset");
			if (!fieldset) throw new Error("Missing response fieldset");
			const input = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return {
				width: input.width,
				available: fieldset.getBoundingClientRect().width,
				height: input.height,
				fontSize: Number.parseFloat(style.fontSize),
				padding: Number.parseFloat(style.paddingLeft),
				radius: Number.parseFloat(style.borderRadius),
				border: style.borderTopWidth,
				overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
			};
		});
		expect(geometry.width).toBeGreaterThanOrEqual(geometry.available - 2);
		expect(geometry.width).toBeLessThanOrEqual(geometry.available + 2);
		expect(geometry.height).toBeGreaterThan(90);
		expect(geometry.fontSize).toBeGreaterThanOrEqual(16);
		expect(geometry.padding).toBeGreaterThanOrEqual(8);
		expect(geometry.radius).toBeGreaterThan(0);
		expect(geometry.border).toBe("1px");
		expect(geometry.overflow).toBeLessThanOrEqual(1);
		await expect(block.locator("fieldset")).toHaveCSS("border-top-width", "0px");
	});
}

test("small-preview fill blanks keep the themed fieldset reset and supporting-text order", async ({
	page,
}) => {
	await page.goto(
		`${readTestEnv().url}/authoring-catalog/catalog-fill-blank.html?minimal=1&praxity-small-preview=1`,
	);
	const block = page.locator('[data-block-type="assessment"]');
	await expect(block.locator("fieldset")).toHaveCSS("border-top-width", "0px");
	const stem = block.locator("p.praxity-assessment-stem", { hasText: "Complete the sentence" });
	await expect(stem).toBeVisible();
	await expect(block.getByRole("group")).toHaveAccessibleName(/Complete the sentence/);
	expect(
		await block.evaluate((element) => {
			const stem = element.querySelector("p.praxity-assessment-stem");
			const fieldset = element.querySelector("fieldset");
			if (!stem || !fieldset) throw new Error("Missing assessment stem or fieldset");
			return fieldset.getBoundingClientRect().top - stem.getBoundingClientRect().bottom;
		}),
	).toBeGreaterThanOrEqual(8);
	await expect(block.getByRole("textbox")).toBeDisabled();
	await expect(block).toContainText("Complete the sentence");
	await expect(block).toContainText("and it helps learners practice.");
});

for (const mode of ["small", "full"]) {
	test(`${mode} preview paints the authored divider`, async ({ page }) => {
		const query = mode === "small" ? "?minimal=1&praxity-small-preview=1" : "";
		await page.goto(`${readTestEnv().url}/authoring-catalog/catalog-divider.html${query}`);
		const rule = page.getByRole("separator");
		await expect(rule).toBeVisible();
		const paint = await rule.evaluate((element) => {
			if (!element.parentElement) throw new Error("Divider has no block wrapper");
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return {
				width: rect.width,
				height: rect.height,
				background: style.backgroundColor,
				opacity: style.opacity,
				border: style.borderTopWidth,
				parentWidth: element.parentElement.getBoundingClientRect().width,
			};
		});
		expect(paint.height).toBeGreaterThanOrEqual(2);
		expect(paint.width).toBeGreaterThanOrEqual(paint.parentWidth - 2);
		expect(paint.background).not.toBe("rgba(0, 0, 0, 0)");
		expect(paint.opacity).toBe("1");
		await page.emulateMedia({ forcedColors: "active" });
		if (!(await forcedPalette(page))) {
			await expectForcedEmulationInert(page, [rule]);
		} else {
			await expect(rule).toHaveCSS("border-top-width", "2px");
		}
	});
}

for (const layout of ["grid", "single"]) {
	test(`card ${layout} saved treatments keep plain reading surfaces`, async ({ page }) => {
		const blocks = ["outline", "shaded", "accent"].flatMap((style) => {
			const [block] = adaptGrammarPreviewBlocks(
				readLesson(
					withFixtureSetting(
						withFixtureSetting(
							grammar4Starter("card"),
							"style",
							style === "accent" ? "primary" : style,
						),
						"layout",
						layout === "single" ? "slides" : layout,
					),
				).pages[0].blocks,
			);
			block.id = style;
			return block;
		});
		await page.setContent(
			`<main data-praxity-root style="--praxity-color-surface:#fff;--praxity-color-background-alt:#eee;--praxity-color-accent-light:#e0d0ff;--praxity-color-border:#555;--praxity-color-text:#222">${blocks.map((block) => renderBlockHtml(block)).join("")}</main>`,
		);
		await page.addStyleTag({ content: css });
		const card = (id: string) => page.locator(`[data-block-id="${id}"] article`).first();
		await expect(card("outline")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await expect(card("outline").locator("h3")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await expect(card("outline")).toHaveCSS("border-top-width", "0px");
		await expect(card("shaded")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await expect(card("accent")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	});
}

for (const mode of ["small", "full"]) {
	test(`${mode} preview renders the comparison starter with both local images`, async ({
		page,
	}) => {
		const query = mode === "small" ? "?minimal=1&praxity-small-preview=1" : "";
		await page.goto(`${readTestEnv().url}/authoring-catalog/catalog-comparison.html${query}`);
		const block = page.locator('[data-block-type="imageComparison"]');
		const images = block.locator("img");
		await expect(images).toHaveCount(2);
		await expect
			.poll(() =>
				images.evaluateAll((nodes) =>
					nodes.every((node) => (node as HTMLImageElement).naturalWidth > 0),
				),
			)
			.toBe(true);
		const slider = block.getByRole("slider", { name: "Image comparison slider" });
		await expect(slider).toBeVisible();
		const before = block.locator(".praxity-comparison-before");
		const clip = await before.evaluate((element) => getComputedStyle(element).clipPath);
		expect(clip).toContain("50%");
		if (mode === "full") {
			await expect(block).toHaveAttribute("data-hydrated", "");
			await slider.focus();
			await slider.press("ArrowRight");
			await expect(slider).toHaveValue("52");
			await expect
				.poll(() => before.evaluate((element) => getComputedStyle(element).clipPath))
				.not.toBe(clip);
			await page.reload();
			await expect(block).toHaveAttribute("data-hydrated", "");
			await expect(slider).toHaveValue("52");
			await expect(slider).toHaveAttribute("aria-valuetext", "52% Before, 48% After");
			await expect(before).toHaveCSS("clip-path", /48%/);
			await slider.press("Home");
			await expect(slider).toHaveValue("0");
			await slider.press("End");
			await expect(slider).toHaveValue("100");
		} else await expect(block).not.toHaveAttribute("data-hydrated", "");
	});
}
