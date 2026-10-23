import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { DEFAULT_DESIGN_VARIANTS } from "../../../editor-core/src/lib/themes/design-variant-defaults";
import { renderBlockHtml } from "../../src/render-block-html";
import { inlineIslandImports } from "../fixtures/inline-island";

const instruction = {
	en: "Explore the numbered pins in order. Later pins become available after the preceding pin.",
	fr: "Explorez les épingles numérotées dans l'ordre. Les épingles suivantes deviennent disponibles après la précédente.",
};
const block = {
	id: "diagram",
	type: "labeledGraphic",
	data: {
		imageSrc: `data:image/webp;base64,${readFileSync(resolve(import.meta.dirname, "../../../../docs/test-fixtures/assets/test-hotspot.webp")).toString("base64")}`,
		imageAlt: "Annotated diagram",
		reveal: "sequential",
		labels: ["First", "Second", "Third"].map((title, index) => ({
			id: `pin-${index + 1}`,
			x: 20 + index * 30,
			y: 50,
			title,
			body: `${title} description`,
		})),
	},
} as unknown as PraxityBlock;

async function renderGraphic(page: Page, locale: "en" | "fr" = "en") {
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
	await page.setContent(
		`<html lang="${locale}"><head><title>Sequential graphic</title><style>${css}\n.praxity-labeled-graphic > img { height: 240px; }</style></head><body><main data-praxity-root><button type="button">Before graphic</button>${renderBlockHtml(
			block,
			{
				enabledIslands: new Set(["labeledGraphic"]),
				strings: getStrings(locale),
			},
		)}<button type="button">After graphic</button></main></body></html>`,
	);
}

async function hydrateGraphic(page: Page) {
	await expect(page.locator(".praxity-labeled-graphic > img")).toHaveJSProperty("complete", true);
	await expect
		.poll(() =>
			page
				.locator(".praxity-labeled-graphic > img")
				.evaluate((image) => (image as HTMLImageElement).naturalWidth),
		)
		.toBeGreaterThan(0);
	const islandsDir = resolve(
		import.meta.dirname,
		"../../../../apps/desktop/resources/export-assets/islands",
	);
	const filename = readdirSync(islandsDir).find((entry) =>
		/^island-labeled-graphic-[A-Z0-9]{8}\.js$/u.test(entry),
	);
	if (!filename) throw new Error("Run desktop prebuild before the sequential pin specs");

	await page.addScriptTag({
		content: inlineIslandImports(resolve(islandsDir, filename)),
		type: "module",
	});
	await expect(page.locator('[data-island="labeledGraphic"]')).toHaveAttribute("data-hydrated", "");
}

for (const locale of ["en", "fr"] as const) {
	test(`${locale} sequential pins explain order, skip future pins and preserve rereading`, async ({
		page,
		browserName,
	}) => {
		await renderGraphic(page, locale);
		await hydrateGraphic(page);
		await expect(page.getByRole("main")).toHaveCount(1);
		await expect(page.getByRole("region")).toHaveCount(0);
		const tab = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
		const pins = page.locator(".praxity-labeled-graphic-dot");
		const hint = page.locator(".praxity-labeled-graphic-hint");
		const progress = page.locator("[data-labeled-graphic-progress]");
		await expect(hint).toBeVisible();
		await expect(hint).toHaveText(instruction[locale]);
		await expect(
			page.getByRole("group", { name: "Annotated diagram" }),
		).toHaveAccessibleDescription(instruction[locale]);
		for (const pin of await pins.all())
			await expect(pin).toHaveAccessibleDescription(instruction[locale]);
		await expect(pins.nth(1)).toBeDisabled();
		await expect(pins.nth(2)).toBeDisabled();
		await page.getByRole("button", { name: "Before graphic" }).focus();
		await page.keyboard.press(tab);
		await expect(pins.nth(0)).toBeFocused();
		await page.keyboard.press(tab);
		await expect(page.getByRole("button", { name: "After graphic" })).toBeFocused();
		await page.keyboard.press(`Shift+${tab}`);
		await expect(pins.nth(0)).toBeFocused();
		// A pointer event at the disabled pin and an AT-style synthetic activation stay blocked.
		const future = await pins.nth(2).boundingBox();
		if (!future) throw new Error("Missing future pin geometry");
		await page.mouse.click(future.x + future.width / 2, future.y + future.height / 2);
		await pins.nth(2).dispatchEvent("click");
		await expect(pins.nth(2)).toHaveAttribute("aria-expanded", "false");
		await expect(progress).toHaveText(locale === "en" ? "0 of 3 revealed" : "0 sur 3 révélés");
		await pins.nth(0).focus();
		for (let index = 0; index < 3; index++) {
			await expect(pins.nth(index)).toBeFocused();
			await page.keyboard.press(index === 1 ? "Space" : "Enter");
			await expect(pins.nth(index)).toBeFocused();
			await expect(pins.nth(index)).toBeEnabled();
			await expect(page.locator(".praxity-labeled-graphic-popover").nth(index)).toBeVisible();
			if (index < 2) await page.keyboard.press(tab);
		}
		await expect(progress).toHaveText(locale === "en" ? "3 of 3 revealed" : "3 sur 3 révélés");
		for (let index = 2; index >= 0; index--) {
			await expect(pins.nth(index)).toBeFocused();
			if (index === 2) await page.keyboard.press("Enter");
			await page.keyboard.press("Enter");
			await expect(page.locator(".praxity-labeled-graphic-popover").nth(index)).toBeVisible();
			if (index > 0) await page.keyboard.press(`Shift+${tab}`);
		}
	});
}

test("restores partial progress without taking focus or locking revealed pins", async ({
	page,
}) => {
	await renderGraphic(page);
	await page.evaluate(() => {
		window.__praxityBlockState = {
			get: () => ({ revealedIds: ["pin-1"], activeId: "pin-1" }),
			set: () => {},
		};
	});
	await page.getByRole("button", { name: "After graphic" }).focus();
	await hydrateGraphic(page);
	await expect(page.getByRole("button", { name: "After graphic" })).toBeFocused();
	const pins = page.locator(".praxity-labeled-graphic-dot");
	await expect(pins.nth(0)).toBeEnabled();
	await expect(pins.nth(1)).toBeEnabled();
	await expect(pins.nth(2)).toBeDisabled();
	await expect(page.locator("[data-labeled-graphic-progress]")).toHaveText("1 of 3 revealed");
	await pins.nth(0).click();
	await pins.nth(0).click();
	await expect(page.locator(".praxity-labeled-graphic-popover").nth(0)).toBeVisible();
	await expect(pins.nth(0)).toHaveAccessibleDescription(instruction.en);
});

test("keeps order instructions and numerals visible in forced colors", async ({
	page,
}, testInfo) => {
	await page.emulateMedia({ forcedColors: "active" });
	test.skip(
		!(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)),
		"This engine does not emulate forced colors",
	);
	await renderGraphic(page);
	await hydrateGraphic(page);
	await expect(page.locator(".praxity-labeled-graphic-hint")).toBeVisible();
	for (const [index, pin] of (await page.locator(".praxity-labeled-graphic-dot").all()).entries()) {
		await expect(pin).toBeVisible();
		await expect(pin).toHaveText(String(index + 1));
	}
	const first = page.getByRole("button", { name: "1. First" });
	await first.focus();
	await expect(first).toHaveCSS("outline-style", "solid");
	await page.screenshot({
		path: testInfo.outputPath("sequential-pins-forced-colors.png"),
		fullPage: true,
	});
});

test.describe("without JavaScript", () => {
	test.use({ javaScriptEnabled: false });
	test("shows every title and description in an ordered list", async ({ page }) => {
		await renderGraphic(page);
		const items = page.locator(".praxity-labeled-graphic-fallback li");
		await expect(items).toHaveCount(3);
		for (const [index, title] of ["First", "Second", "Third"].entries()) {
			await expect(items.nth(index)).toBeVisible();
			await expect(items.nth(index)).toHaveText(`${title}${title} description`);
		}
	});
});
