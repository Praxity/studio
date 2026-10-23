import { expect, type Locator } from "@playwright/test";
import { test } from "../muted-test";
import {
	CARD_SURFACE_LAYOUTS,
	CONTAINER_SURFACE_STYLES,
	NOTE_SURFACE_TONES,
} from "./fixtures/design-container-surfaces-fixture";
import { readTestEnv } from "./helpers";

async function paint(element: Locator, colorProperty = "background-color") {
	return element.evaluate((node, property) => {
		const style = getComputedStyle(node);
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas unavailable");
		context.fillStyle = style.getPropertyValue(property);
		context.fillRect(0, 0, 1, 1);
		return {
			background: Array.from(context.getImageData(0, 0, 1, 1).data),
			border: Number.parseFloat(style.borderTopWidth),
			borderLeft: Number.parseFloat(style.borderLeftWidth),
			borderStart: Number.parseFloat(style.borderInlineStartWidth),
		};
	}, colorProperty);
}

for (const appearance of ["light", "dark"]) {
	for (const mode of ["small", "full"]) {
		test.describe(`${appearance} ${mode} container surfaces`, () => {
			test.beforeEach(async ({ page }) => {
				await page.setViewportSize({ width: mode === "small" ? 640 : 1280, height: 900 });
				await page.goto(
					`${readTestEnv().url}/design-container-surfaces-${appearance}/container-surfaces.html${mode === "small" ? "?minimal=1&praxity-small-preview=1" : ""}`,
				);
			});

			test("tables stay on plain paper across retired shade and stripe settings", async ({
				page,
			}) => {
				const table = page.getByRole("table", { name: "Reading table" });
				await expect(table).toHaveCount(1);
				for (const part of await table.locator("tr, th, td").all())
					expect((await paint(part)).background[3]).toBe(0);
			});

			test("accordions stay unboxed across retired treatments", async ({ page }) => {
				for (const style of CONTAINER_SURFACE_STYLES) {
					const root = page
						.locator(".praxity-accordion-static")
						.filter({ hasText: `Accordion ${style}` });
					await expect(root).toHaveCount(1);
					const surface = await paint(root);
					expect(surface.background[3]).toBe(0);
					expect(surface.border).toBe(0);
					for (const child of await root
						.locator("[data-disclosure-trigger], .praxity-accordion-panel")
						.all())
						expect((await paint(child)).background[3]).toBe(0);
				}
			});

			test("quotes keep attribution and plain paper across retired treatments", async ({
				page,
			}) => {
				for (const style of CONTAINER_SURFACE_STYLES) {
					const root = page.locator(`figure.praxity-quote[data-style="${style}"]`);
					await expect(root).toHaveCount(1);
					await expect(root.locator("blockquote")).toContainText(`Quote ${style} text.`);
					const attribution = root.locator("figcaption");
					await expect(attribution).toBeVisible();
					await expect(attribution).toContainText(`Speaker ${style}`);
					await expect(attribution.locator("cite")).toContainText(`Work ${style}`);
					await expect(root.getByRole("link")).toHaveAttribute(
						"href",
						`https://example.com/${style}`,
					);
					const bounds = await root.boundingBox();
					const captionBounds = await attribution.boundingBox();
					if (!bounds || !captionBounds) throw new Error("Quote attribution is not painted");
					expect(captionBounds.y).toBeGreaterThanOrEqual(bounds.y);
					expect(captionBounds.y + captionBounds.height).toBeLessThanOrEqual(
						bounds.y + bounds.height + 1,
					);
					const surface = await paint(root);
					expect(surface.background[3]).toBe(0);
					expect(surface.border).toBe(0);
				}

				const legacy = page.locator("figure.praxity-quote:not([data-style])");
				await expect(legacy).toHaveCount(1);
				expect((await paint(legacy)).border).toBe(0);
				await expect(legacy.locator("blockquote")).toHaveAttribute(
					"cite",
					"https://example.com/legacy",
				);
				await expect(legacy.locator("figcaption")).toContainText("Legacy speaker");
				await expect(legacy.locator("figcaption cite")).toContainText("Legacy work");
			});

			test("notes use one top rule and preserve spoken labels", async ({ page }) => {
				for (const tone of NOTE_SURFACE_TONES) {
					const notes = ["shaded", "filled", "outline"].map((style) =>
						page.getByRole("note").filter({ hasText: `Note ${tone} ${style} text.` }),
					);
					for (const [index, note] of notes.entries()) {
						await expect(note).toHaveCount(1);
						await expect(note).toHaveAttribute("data-style", index === 2 ? "outline" : "shaded");
						await expect(note).toHaveAttribute(
							"data-color",
							tone === "warning" ? "warning" : "note",
						);
						const label = tone === "warning" ? "Warning" : "Note";
						await expect(note.locator(".praxity-note-label")).toHaveText(label);
						expect(await note.ariaSnapshot()).toContain(label);
					}
					for (const note of notes) {
						const surface = await paint(note);
						expect(surface.background[3]).toBe(0);
						expect(surface.border).toBe(1);
						expect(surface.borderLeft).toBe(0);
					}
				}
			});

			for (const layout of CARD_SURFACE_LAYOUTS) {
				for (const flip of [false, true]) {
					test(`${layout} ${flip ? "flip" : "static"} cards stay unboxed on every face`, async ({
						page,
					}) => {
						for (const style of CONTAINER_SURFACE_STYLES) {
							const root = page
								.locator("[data-card-root]")
								.filter({ hasText: `Card ${layout} ${flip ? "flip" : "static"} ${style}` });
							await expect(root).toHaveCount(1);
							if (layout === "single") {
								const active = root.locator('.praxity-slides-item[data-active="true"]');
								await expect(active).toHaveCSS("opacity", "1");
								await expect(active).toHaveCSS("transform", "none");
							}
							const faces = root.locator(
								flip ? ".praxity-flashcard-face" : ".praxity-card[data-flippable=false]",
							);
							await expect(faces).toHaveCount(flip ? 2 : 1);
							const front = await paint(faces.first());
							expect(front.background[3]).toBe(0);
							expect(front.border).toBe(0);
							if (flip) {
								for (const face of await faces.all()) {
									expect(await paint(face)).toEqual(front);
								}
							}
						}
					});
				}
			}

			test("standalone and heading-attached cards share plain paper", async ({ page }) => {
				const accent = page.locator("[data-card-root]").filter({ hasText: "Before the meeting" });
				const shaded = page.locator("[data-card-root]").filter({ hasText: "After the meeting" });
				await expect(accent).toHaveCount(1);
				await expect(shaded).toHaveCount(1);
				expect((await paint(accent.locator(".praxity-card"))).background).toEqual(
					(await paint(shaded.locator(".praxity-card"))).background,
				);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
					),
				).toBeLessThanOrEqual(1);
			});
		});
	}
}

for (const width of [320, 1280]) {
	test(`accordion title and content spacing at ${width}px`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${readTestEnv().url}/design-container-surfaces-light/container-surfaces.html`);
		for (const style of CONTAINER_SURFACE_STYLES) {
			const root = page
				.locator(".praxity-accordion-static")
				.filter({ hasText: `Accordion ${style}` });
			const trigger = root.locator("[data-disclosure-trigger]").first();
			await trigger.click();
			await expect(trigger).toHaveAttribute("aria-expanded", "true");
			await expect(root.locator(".praxity-accordion-panel").first()).toBeVisible();
			const geometry = await root
				.locator("[data-accordion-item]")
				.first()
				.evaluate((node) => {
					const summary = node.querySelector("[data-disclosure-trigger]");
					const panel = node.querySelector(".praxity-accordion-panel");
					const paragraph = panel?.querySelector("p");
					if (!summary || !panel || !paragraph) throw new Error("Missing accordion content");
					const labelStyle = getComputedStyle(summary);
					const bodyStyle = getComputedStyle(panel);
					const body = panel.getBoundingClientRect();
					const text = paragraph.getBoundingClientRect();
					return {
						top: text.top - body.top,
						bottom: body.bottom - text.bottom,
						aligned:
							text.left - summary.getBoundingClientRect().left - parseFloat(labelStyle.paddingLeft),
						font: parseFloat(bodyStyle.fontSize),
						weight: parseFloat(
							getComputedStyle(summary.querySelector(".praxity-disclosure-title") ?? summary)
								.fontWeight,
						),
						overflow: document.documentElement.scrollWidth - innerWidth,
					};
				});
			expect(geometry.top).toBeGreaterThanOrEqual(geometry.font * 0.5);
			expect(geometry.top).toBeLessThanOrEqual(geometry.font * 1.5);
			expect(geometry.bottom).toBeGreaterThanOrEqual(geometry.font * 0.5);
			expect(Math.abs(geometry.aligned)).toBeLessThanOrEqual(1);
			expect(geometry.weight).toBeGreaterThanOrEqual(500);
			expect(geometry.overflow).toBeLessThanOrEqual(1);
			if (style === "shaded")
				await root.screenshot({ path: testInfo.outputPath(`accordion-${width}.png`) });
		}
	});
}
