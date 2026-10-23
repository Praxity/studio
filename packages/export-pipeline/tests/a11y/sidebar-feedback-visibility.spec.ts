import { createServer, type Server } from "node:http";
import { expect, type Locator, type Page } from "@playwright/test";
import { COURSE_PRESET_IDS } from "@praxity/grammar";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import AdmZip from "adm-zip";
import { buildScormPackage } from "../../src/build";
import { serveFixtureBytes } from "../fixtures/http-bytes";
import { expectFocusRing, expectForcedEmulationInert, forcedPalette } from "../focus-assertions";
import { test } from "../muted-test";
import { computedContrast } from "./contrast-helpers";
import {
	type FeedbackLayout,
	feedbackLayoutFixture,
	feedbackLayouts,
	sidebarFeedbackFixture,
} from "./fixtures/sidebar-feedback-fixture";

let server: Server;
let base: string;

async function expectInsideViewport(locator: Locator, includeFocusRing = false) {
	await expect
		.poll(() =>
			locator.evaluate((node, includeFocusRing) => {
				const rect = node.getBoundingClientRect();
				const style = getComputedStyle(node);
				const ring = includeFocusRing
					? Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
					: 0;
				return (
					rect.top - ring >= -1 &&
					rect.left - ring >= -1 &&
					rect.bottom + ring <= innerHeight + 1 &&
					rect.right + ring <= innerWidth + 1
				);
			}, includeFocusRing),
		)
		.toBe(true);
}

test.beforeAll(async () => {
	const files = new Map<string, Buffer>();
	for (const palette of COURSE_PRESET_IDS) {
		for (const mode of ["light", "dark"] as const) {
			for (const locale of palette === "clear" ? (["en", "fr"] as const) : (["en"] as const)) {
				const result = await buildScormPackage(sidebarFeedbackFixture(locale, palette, mode), {
					format: "html",
				});
				for (const entry of new AdmZip(result.zip).getEntries())
					if (!entry.isDirectory)
						files.set(`/${locale}/${palette}/${mode}/${entry.entryName}`, entry.getData());
			}
		}
	}
	for (const layout of feedbackLayouts) {
		for (const locale of layout === "bottomBar" || layout === "deck"
			? (["en", "fr"] as const)
			: (["en"] as const)) {
			const result = await buildScormPackage(feedbackLayoutFixture(layout, locale), {
				format: "html",
			});
			for (const entry of new AdmZip(result.zip).getEntries())
				if (!entry.isDirectory)
					files.set(`/layout/${layout}/${locale}/${entry.entryName}`, entry.getData());
		}
	}
	server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(path);
		if (!bytes) return void response.writeHead(404).end();
		response.setHeader(
			"Content-Type",
			path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
		);
		serveFixtureBytes(request, response, bytes);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture address");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

for (const palette of COURSE_PRESET_IDS) {
	for (const mode of ["light", "dark"] as const) {
		for (const forcedColors of ["none", "active"] as const) {
			test(`T37 sidebar icons at rest ${palette} ${mode} ${forcedColors}`, async ({ page }) => {
				await page.setViewportSize({ width: 1440, height: 900 });
				await page.emulateMedia({ forcedColors });
				if (forcedColors === "active")
					test.skip(
						!(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)),
						"This engine does not emulate forced colours",
					);
				await page.goto(`${base}/en/${palette}/${mode}/practice.html`);
				for (const selector of [".praxity-sidebar-collapse", ".praxity-sidebar-expand"]) {
					const button = page.locator(selector);
					await expect(button).toBeVisible();
					await page.mouse.move(700, 700);
					await button.evaluate((node) => (node as HTMLElement).blur());
					// Full opacity makes the computed icon/background pair the painted pair.
					await expect(button).toHaveCSS("opacity", "1");
					expect(await computedContrast(button.locator("svg"))).toBeGreaterThanOrEqual(3);
					if (forcedColors === "active" && !(await forcedPalette(page))) {
						await page.keyboard.press("Tab");
						await button.focus();
						await expect(button).toBeFocused();
						await expectForcedEmulationInert(page, [button, button.locator("svg")]);
						await expectFocusRing(button, 2);
					}
					if (selector === ".praxity-sidebar-collapse") await button.click();
				}
			});
		}
	}
}

async function expectUnobscured(locator: Locator, ring = false) {
	await expect
		.poll(() =>
			locator.evaluate((node, ring) => {
				const rect = node.getBoundingClientRect();
				const style = getComputedStyle(node);
				const outset = ring
					? Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
					: 0;
				const deck = document.querySelector('.praxity-deck[data-ready="true"]');
				const main = deck?.querySelector<HTMLElement>("#main-content");
				let top = main?.getBoundingClientRect().top ?? 0;
				let bottom = main
					? main.getBoundingClientRect().bottom -
						Number.parseFloat(
							getComputedStyle(main).getPropertyValue("--deck-footer-height") || "0",
						)
					: innerHeight;
				if (!deck) {
					for (const [selector, edge] of [
						[".praxity-top-bar-fallback", "top"],
						["#praxity-page-nav", "bottom"],
					] as const) {
						const bar = document.querySelector<HTMLElement>(selector);
						if (!bar || !["sticky", "fixed"].includes(getComputedStyle(bar).position)) continue;
						if (bar.getBoundingClientRect().height === 0) continue;
						if (edge === "top") top = Math.max(top, bar.getBoundingClientRect().bottom);
						else bottom = Math.min(bottom, bar.getBoundingClientRect().top);
					}
				}
				return (
					rect.top - outset >= top - 1 &&
					rect.bottom + outset <= bottom + 1 &&
					rect.left - outset >= -1 &&
					rect.right + outset <= innerWidth + 1
				);
			}, ring),
		)
		.toBe(true);
}

async function expectControlPainted(action: Locator, ringWidth = 2, outlineOffset = 2) {
	await action.page().evaluate(async () => {
		await Promise.all(
			document.getAnimations().map((animation) => animation.finished.catch(() => {})),
		);
		await new Promise<void>((done) =>
			requestAnimationFrame(() => requestAnimationFrame(() => done())),
		);
	});
	await expect(action).toBeFocused();
	await expect.poll(() => action.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
	await expect(action).toHaveCSS("outline-style", "solid");
	await expect
		.poll(() =>
			action.evaluate((node) => {
				const style = getComputedStyle(node);
				return {
					width: Number.parseFloat(style.outlineWidth),
					offset: Number.parseFloat(style.outlineOffset),
					color: style.outlineColor,
				};
			}),
		)
		.toMatchObject({
			width: ringWidth,
			offset: outlineOffset,
			color: expect.not.stringMatching(/transparent|rgba\(0, 0, 0, 0\)/),
		});
	await expectInsideViewport(action, true);
	await expect
		.poll(() =>
			action.evaluate((node) => {
				const rect = node.getBoundingClientRect();
				return node.contains(
					document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
				);
			}),
		)
		.toBe(true);
	await expect
		.poll(() =>
			action.evaluate((node) => {
				const rect = node.getBoundingClientRect();
				const style = getComputedStyle(node);
				const ring = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
				const clipped = [];
				for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
					const style = getComputedStyle(ancestor);
					if (!/(hidden|clip|auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
					const clip = ancestor.getBoundingClientRect();
					if (
						rect.left - ring < clip.left - 1 ||
						rect.right + ring > clip.right + 1 ||
						rect.top - ring < clip.top - 1 ||
						rect.bottom + ring > clip.bottom + 1
					)
						clipped.push({
							ancestor: ancestor.id || ancestor.className || ancestor.tagName,
							clip: clip.toJSON(),
							ring,
							rect: rect.toJSON(),
						});
				}
				return clipped;
			}),
		)
		.toEqual([]);
	const points = await action.evaluate((node) => {
		const rect = node.getBoundingClientRect();
		const style = getComputedStyle(node);
		const offset = Number.parseFloat(style.outlineOffset);
		const ring = offset + Number.parseFloat(style.outlineWidth) / 2;
		const gap = offset < 0 ? offset - 2 : offset / 2;
		return [
			[
				[rect.left - ring, rect.top + rect.height / 2],
				[rect.left - gap, rect.top + rect.height / 2],
			],
			[
				[rect.right + ring, rect.top + rect.height / 2],
				[rect.right + gap, rect.top + rect.height / 2],
			],
			[
				[rect.left + rect.width / 2, rect.top - ring],
				[rect.left + rect.width / 2, rect.top - gap],
			],
			[
				[rect.left + rect.width / 2, rect.bottom + ring],
				[rect.left + rect.width / 2, rect.bottom + gap],
			],
		];
	});
	const screenshot = await action.page().screenshot({ scale: "css" });
	const outlineColor = await action.evaluate((node) => getComputedStyle(node).outlineColor);
	const pixels = await action.page().evaluate(
		async ({ png, points, outlineColor }) => {
			const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
			const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
			const canvas = document.createElement("canvas");
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas 2D context unavailable");
			context.drawImage(bitmap, 0, 0);
			bitmap.close();
			const samples = points.map((pair) =>
				pair.map(([x, y]) => {
					// Match the geometry assertion's 1 px sub-pixel tolerance in the raster too.
					const patch = context.getImageData(Math.floor(x) - 1, Math.floor(y) - 1, 3, 3).data;
					const colors: string[] = [];
					for (let index = 0; index < patch.length; index += 4) {
						if (patch[index + 3] !== 255) continue;
						colors.push(
							`#${Array.from(patch.slice(index, index + 3))
								.map((channel) => channel.toString(16).padStart(2, "0"))
								.join("")}`,
						);
					}
					return colors;
				}),
			);
			context.fillStyle = outlineColor;
			context.fillRect(0, 0, 1, 1);
			const expected = `#${Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
				.map((channel) => channel.toString(16).padStart(2, "0"))
				.join("")}`;
			return { samples, expected };
		},
		{ png: screenshot.toString("base64"), points, outlineColor },
	);
	if (pixels.samples.some(([ring]) => !ring.includes(pixels.expected)))
		await test.info().attach("focus-ring", { body: screenshot, contentType: "image/png" });
	for (const [ring, gap] of pixels.samples) {
		expect(ring, JSON.stringify({ pixels, points })).toContain(pixels.expected);
		if (ringWidth === 3) {
			// Forced colours paint the user's Highlight colour, which can be below 3:1.
			expect(gap.some((color) => color !== pixels.expected)).toBe(true);
		} else {
			expect(
				Math.max(...gap.map((color) => contrastRatio(pixels.expected, color))),
			).toBeGreaterThanOrEqual(3);
		}
	}
}

async function expectActionPainted(action: Locator) {
	await expectControlPainted(action);
	await expectUnobscured(action, true);
}

async function prepareCheck(
	page: Page,
	layout: FeedbackLayout,
	width: number,
	height: number,
	correct = false,
	upper = false,
) {
	await page.setViewportSize({ width, height });
	await page.goto(`${base}/layout/${layout}/en/practice.html`);
	if (layout === "deck")
		await expect(page.locator('.praxity-deck[data-ready="true"]')).toBeVisible();
	else await expect(page.locator('[data-island="nav"][data-hydrated]')).not.toHaveCount(0);
	if (layout === "bottomBar") await expect(page.locator("#praxity-page-nav")).toBeVisible();
	const card = page.locator('[data-island="assessment"][data-block-id="choice"]');
	await card.scrollIntoViewIfNeeded();
	await expect(card).toHaveAttribute("data-hydrated", "");
	if (layout === "text")
		await card.getByRole("textbox").fill("Read the request and check the instructions.");
	else if (layout === "multi") {
		await card.getByRole("checkbox").nth(0).check();
		await card.getByRole("checkbox").nth(1).check();
	} else
		await card
			.getByRole("radio")
			.nth(layout === "options" ? 0 : correct ? 0 : 1)
			.check();
	const submit =
		layout === "group"
			? page.locator("[data-assessment-group-submit] .praxity-ag-submit-btn")
			: card.locator("[data-assessment-submit]");
	for (
		let step = 0;
		step < 12 && !(await submit.evaluate((node) => document.activeElement === node));
		++step
	)
		await page.keyboard.press("Tab");
	await expect(submit).toBeFocused();
	await submit.evaluate((node, upper) => {
		node.scrollIntoView({ block: "end", behavior: "instant" });
		if (upper) window.scrollBy(0, node.getBoundingClientRect().top - innerHeight * 0.25);
	}, upper);
	return {
		card,
		submit,
		action: card.locator(correct ? "[data-assessment-continue]" : "[data-assessment-retry]"),
	};
}

for (const [width, height] of [
	[1440, 900],
	[390, 844],
]) {
	for (const correct of [false, true]) {
		test(`T38 review bottom bar ${width} ${correct}`, async ({ page }) => {
			const { submit, action } = await prepareCheck(page, "bottomBar", width, height, correct);
			await submit.press("Enter");
			await expectActionPainted(action);
		});
	}
}

test("T38 review narrow long feedback clears the sticky header", async ({ page }) => {
	const { card, submit, action } = await prepareCheck(page, "long", 390, 844);
	await submit.press("Enter");
	await expectActionPainted(action);
	await expectUnobscured(card.locator("[data-feedback-explanation]"));
});

test("T38 review native Tab clears sticky navigation after resize", async ({ page }) => {
	const { card, submit } = await prepareCheck(page, "bottomBar", 1440, 900);
	await page.setViewportSize({ width: 390, height: 844 });
	await card
		.getByRole("radio")
		.last()
		.evaluate((node) => {
			window.scrollBy(0, -500);
			(node as HTMLElement).focus({ preventScroll: true });
		});
	await page.keyboard.press("Tab");
	await expect(submit).toBeFocused();
	await expectUnobscured(submit, true);
});

test("T38 review retry ring fits inside the reveal clip", async ({ page }) => {
	const { submit, action } = await prepareCheck(page, "long", 1440, 900);
	await submit.press("Enter");
	await expectActionPainted(action);
});

for (const [width, height] of [
	[1280, 800],
	[390, 844],
]) {
	for (const forcedColors of ["none", "active"] as const) {
		test(`T38 review deck footer and transcript ${width} ${forcedColors}`, async ({ page }) => {
			await page.emulateMedia({ forcedColors });
			await prepareCheck(page, "deck", width, height);
			const tools = page.locator("#deck-more-toggle");
			for (
				let step = 0;
				step < 12 && !(await tools.evaluate((node) => document.activeElement === node));
				step++
			)
				await page.keyboard.press("Tab");
			if (forcedColors === "active" && !(await forcedPalette(page))) {
				await expectForcedEmulationInert(page, [tools]);
				await expectFocusRing(tools, 2);
				await expectControlPainted(tools);
			} else {
				await expectControlPainted(tools, forcedColors === "active" ? 3 : 2);
			}
			for (const selector of ["#main-content", "#deck-more-below"]) {
				const target = page.locator(selector);
				await expect(target).toBeVisible();
				await target.focus();
				await expect(target).toBeFocused();
				await expect(target).toHaveCSS("outline-offset", "-3px");
				await expectInsideViewport(target, true);
				if (forcedColors === "active" && !(await forcedPalette(page))) {
					await expectForcedEmulationInert(page, [target]);
					await expectFocusRing(target, 2, true);
				}
			}
			await tools.press("Enter");
			await page.locator("#deck-script-toggle").press("Enter");
			const reading = page.getByRole("region", { name: "Reading text", exact: true });
			await expect(reading).toBeVisible();
			if (width === 390) {
				const sheet = page.locator("dialog.deck-transcript-sheet");
				await expect(sheet).toBeVisible();
				await expect.poll(() => sheet.evaluate((node) => node.matches(":modal"))).toBe(true);
				await expect(sheet.locator("#deck-sidebar #deck-script-scroll")).toHaveCount(1);
			}
			for (
				let step = 0;
				step < 12 && !(await reading.evaluate((node) => document.activeElement === node));
				step++
			)
				await page.keyboard.press("Tab");
			if (forcedColors === "active" && !(await forcedPalette(page))) {
				await expectForcedEmulationInert(page, [reading]);
				await expectFocusRing(reading, 2, true);
				await expectControlPainted(reading, 2, -3);
			} else {
				await expectControlPainted(reading, forcedColors === "active" ? 3 : 2, -3);
			}
			if (
				process.env.COURSE_AUDIT_SCREENSHOTS &&
				forcedColors === "none" &&
				test.info().project.name === "chromium"
			)
				await page.screenshot({
					path: `${process.env.COURSE_AUDIT_SCREENSHOTS}/deck-${width}-en-transcript.png`,
				});
		});
	}
	for (const correct of [false, true]) {
		test(`T38 review deck ${width} ${correct}`, async ({ page }) => {
			const { submit, action } = await prepareCheck(page, "deck", width, height, correct);
			const shellPosition = () =>
				page.evaluate(() => ({
					index: [...document.querySelectorAll<HTMLElement>("[data-deck-slide]")].findIndex(
						(slide) => slide.getBoundingClientRect().height > 0,
					),
					positions: [".deck-panels", ".deck-workspace"].map((selector) => {
						const node = document.querySelector(selector);
						if (!node) throw new Error(`Missing deck container ${selector}`);
						return [node.scrollTop, node.scrollLeft];
					}),
				}));
			const before = await shellPosition();
			await submit.press("Enter");
			await expectActionPainted(action);
			await expect.poll(shellPosition).toEqual(before);
		});
	}
}

for (const layout of ["options", "multi", "text", "group"] as const) {
	test(`T38 review Pages ${layout}`, async ({ page }) => {
		const { card, submit, action } = await prepareCheck(
			page,
			layout,
			1280,
			900,
			false,
			layout === "options" || layout === "multi",
		);
		if (layout === "options" || layout === "multi") {
			await expect
				.poll(() =>
					card
						.locator(".praxity-assessment-choice-option")
						.first()
						.evaluate((node) => node.getBoundingClientRect().bottom),
				)
				.toBeLessThan(0);
		}
		await submit.press("Enter");
		await expect(action).toBeFocused();
		if (layout === "options" || layout === "multi") {
			const first = card.locator(".praxity-choice-feedback").first();
			await expect(first).toHaveText("Explanation 1: stop and check the instructions.");
			await expectUnobscured(first);
		}
		await expectActionPainted(action);
	});
}

test("T38 review action wins when option feedback cannot fit with it", async ({ page }) => {
	const { card, submit, action } = await prepareCheck(page, "options", 390, 400, false, true);
	await submit.press("Enter");
	await expectActionPainted(action);
	const first = card.locator(".praxity-choice-feedback").first();
	const span = await card.evaluate((node) => {
		const feedback = node.querySelector(".praxity-choice-feedback")?.getBoundingClientRect();
		const action = node.querySelector("[data-assessment-retry]")?.getBoundingClientRect();
		if (!feedback || !action) throw new Error("Missing option feedback or Retry");
		return action.bottom - feedback.top;
	});
	expect(span).toBeGreaterThan(400);
	await expect(first).toBeVisible();
});

test("T38 review reduced motion scrolls in one jump", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const { submit, action } = await prepareCheck(page, "bottomBar", 1440, 900);
	await page.evaluate(
		() =>
			new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
	);
	await page.evaluate(() => {
		const positions: number[] = [];
		Object.assign(window, { checkScrollPositions: positions });
		document.addEventListener(
			"scroll",
			(event) => {
				if (event.target === document) positions.push(scrollY);
			},
			true,
		);
	});
	await submit.press("Enter");
	await expectActionPainted(action);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					new Set((window as unknown as { checkScrollPositions: number[] }).checkScrollPositions)
						.size,
			),
		)
		.toBe(1);
});

test("T38 review load and restored checked answers do not scroll", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(`${base}/layout/bottomBar/en/practice.html`);
	await expect(page.locator('[data-island="nav"][data-hydrated]')).not.toHaveCount(0);
	await page.evaluate(
		() =>
			new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
	);
	expect(await page.evaluate(() => scrollY)).toBe(0);
	const { card, submit, action } = await prepareCheck(page, "bottomBar", 1280, 900);
	await submit.press("Enter");
	await expect(action).toBeFocused();
	await expect
		.poll(() =>
			page.evaluate(() => {
				const state = window.__praxityBlockState?.get("choice");
				return (
					state && typeof state === "object" && !Array.isArray(state) && state.checked === true
				);
			}),
		)
		.toBe(true);
	for (let reload = 0; reload < 2; reload++) {
		await page.evaluate(() => {
			history.scrollRestoration = "manual";
			window.scrollTo(0, 0);
		});
		await page.reload();
		await expect(page.locator('[data-island="nav"][data-hydrated]')).not.toHaveCount(0);
		await card.scrollIntoViewIfNeeded();
		const before = await page.evaluate(() => scrollY);
		await expect(card).toHaveAttribute("data-hydrated", "");
		await expect(card.getByRole("radio").nth(1)).toBeChecked();
		await expect(card.getByRole("radio").nth(1)).toBeDisabled();
		await page.evaluate(async () => {
			await Promise.all(
				document.getAnimations().map((animation) => animation.finished.catch(() => {})),
			);
			await new Promise<void>((done) =>
				requestAnimationFrame(() => requestAnimationFrame(() => done())),
			);
		});
		expect(await page.evaluate(() => scrollY)).toBe(before);
		await expect(action).not.toBeFocused();
	}
});

test("T38 review self-check Check keeps the document in place", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(`${base}/layout/self-check/en/practice.html`);
	const root = page.locator("[data-self-check]");
	await root.evaluate((node) => node.scrollIntoView({ block: "center", behavior: "instant" }));
	await root.getByRole("textbox").fill("Read the request.");
	const check = root.locator('[data-self-check-action="check"]');
	await expect(check).toBeEnabled();
	await expect(check).not.toHaveAttribute("data-praxity-js-control", /.*/);
	await check.focus();
	const before = await page.evaluate(() => scrollY);
	await check.press("Enter");
	await expect(root.getByRole("checkbox")).toBeFocused();
	await page.evaluate(async () => {
		await Promise.all(
			document.getAnimations().map((animation) => animation.finished.catch(() => {})),
		);
		await new Promise<void>((done) =>
			requestAnimationFrame(() => requestAnimationFrame(() => done())),
		);
	});
	expect(await page.evaluate(() => scrollY)).toBe(before);
});

for (const locale of ["en", "fr"] as const) {
	for (const reducedMotion of ["no-preference", "reduce"] as const) {
		for (const answer of ["Stop", "Continue"]) {
			test(`T38 Check keeps feedback and action in view ${locale} ${reducedMotion} ${answer}`, async ({
				page,
			}) => {
				await page.setViewportSize({ width: 1440, height: 900 });
				await page.emulateMedia({ reducedMotion });
				await page.goto(
					`${base}/${locale}/clear/light/${locale === "en" ? "practice" : "exercice"}.html`,
				);
				const card = page.locator('[data-island="assessment"][data-block-id="choice"]');
				await card.scrollIntoViewIfNeeded();
				await expect(card).toHaveAttribute("data-hydrated", "");
				await card
					.getByRole("radio", {
						name: locale === "en" ? answer : answer === "Stop" ? "Arrêter" : "Continuer",
						exact: true,
					})
					.check();
				const submit = card.locator("[data-assessment-submit]");
				await page.keyboard.press("Tab");
				await expect(submit).toBeFocused();
				// Put Check near the lower edge. The revealed result grows beyond that edge.
				await submit.evaluate((node) => {
					node.scrollIntoView({ block: "end", behavior: "instant" });
				});
				await expectInsideViewport(submit);
				await submit.press("Enter");
				const action = card.locator(
					answer === "Stop" ? "[data-assessment-continue]" : "[data-assessment-retry]",
				);
				await expect(action).toBeFocused();
				await expect(action).not.toHaveCSS("outline-style", "none");
				await expectInsideViewport(action, true);
				const explanation = card.locator("[data-feedback-explanation]");
				await expect(explanation).toBeVisible();
				await expectInsideViewport(card.locator("[data-assessment-feedback]"));
				await expect(action).toHaveAccessibleDescription(
					`${answer === "Stop" ? "Correct" : locale === "en" ? "Not quite" : "Pas tout à fait"} ${
						locale === "en"
							? "Stop and check the instructions before continuing."
							: "Arrêtez et vérifiez les consignes avant de continuer."
					}`,
				);
			});
		}
	}
}
