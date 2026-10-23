import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { expectForcedEmulationInert, forcedPalette } from "../focus-assertions";
import { computedContrast } from "./contrast-helpers";
import { DIALOGUE_PALETTES } from "./fixtures/dialogue-layout-fixture";
import { analyzeAxe, readTestEnv, waitForHydration } from "./helpers";
import { applyTextSpacing, applyTwoHundredPercentZoom } from "./layout-overrides";

async function openLayout(
	page: Page,
	presentation: "pages" | "deck",
	palette = "ink",
	mode = "light",
) {
	await page.goto(
		`${readTestEnv().url}/dialogue-layout-${presentation}-${palette}-${mode}/dialogue-layout.html`,
	);
	await waitForHydration(page);
	if (presentation === "deck")
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.evaluate(() => document.fonts.ready);
}

const layoutDialogue = (page: Page) => page.locator("figure.praxity-dialogue").first();

for (const presentation of ["pages", "deck"] as const) {
	for (const width of [1280, 768, 390]) {
		for (const direction of ["ltr", "rtl"]) {
			test(`bubble geometry ${presentation} ${width} ${direction}`, async ({ page }, testInfo) => {
				await page.setViewportSize({ width, height: 900 });
				await openLayout(page, presentation);
				await page.evaluate((dir) => {
					document.documentElement.dir = dir;
				}, direction);
				const figure = layoutDialogue(page);
				const turns = figure.getByRole("listitem");
				for (const [index, name] of ["Alex", "Sam", "Sam", "Guide", "Alex"].entries()) {
					await expect(turns.nth(index)).toHaveAttribute("data-turn-index", String(index));
					await expect(turns.nth(index)).toHaveAttribute(
						"data-node-id",
						["alex-long", "sam-short", "sam-again", "guide", "alex-url"][index],
					);
					await expect(
						turns.nth(index).locator(".praxity-dialogue-bubble > .praxity-dialogue-name"),
					).toHaveText(name);
					expect(await turns.nth(index).ariaSnapshot()).toContain(name);
				}
				const measurements = await figure.evaluate((figure) => {
					const box = (node: Element) => {
						const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
						return { left, right, top, bottom, width, height };
					};
					const required = (node: Element, selector: string) => {
						const found = node.querySelector(selector);
						if (!found) throw new Error(`Missing ${selector}`);
						return found;
					};
					return {
						container: box(figure),
						caption: box(required(figure, "figcaption")),
						turns: Array.from(figure.querySelectorAll("li")).map((turn) => {
							const bubble = required(turn, ".praxity-dialogue-bubble");
							const name = required(bubble, ".praxity-dialogue-name");
							const paragraphs = bubble.querySelectorAll(".praxity-dialogue-text > p");
							const avatar = turn.querySelector("img");
							const style = getComputedStyle(bubble);
							return {
								turn: box(turn),
								bubble: box(bubble),
								name: box(name),
								text: box(required(bubble, ".praxity-dialogue-text")),
								avatar: avatar ? box(avatar) : null,
								avatarFit: avatar ? getComputedStyle(avatar).objectFit : null,
								avatarRadius: avatar ? getComputedStyle(avatar).borderTopLeftRadius : null,
								avatarRing: avatar ? getComputedStyle(avatar).borderTopWidth : null,
								avatarHidden: avatar ? getComputedStyle(avatar).visibility === "hidden" : false,
								paragraphGap:
									paragraphs.length > 1 ? box(paragraphs[1]).top - box(paragraphs[0]).bottom : null,
								paddingBlock: Number.parseFloat(style.paddingBlockStart),
								paddingInline: Number.parseFloat(style.paddingInlineStart),
								radiusStart: style.borderStartStartRadius,
								radiusEnd: style.borderStartEndRadius,
								nameSize: getComputedStyle(name).fontSize,
								nameFace: getComputedStyle(name).fontFamily,
								bodyFace: getComputedStyle(figure).fontFamily,
								weight: getComputedStyle(name).fontWeight,
								textSize: getComputedStyle(required(bubble, ".praxity-dialogue-text")).fontSize,
								bodySize: getComputedStyle(figure).getPropertyValue("--type-body").trim(),
								shadow: style.boxShadow,
								animation: style.animationName,
								border: style.borderTopWidth,
								textAlign: getComputedStyle(required(bubble, ".praxity-dialogue-text")).textAlign,
								hyphens: getComputedStyle(required(bubble, ".praxity-dialogue-text")).hyphens,
								pretty: getComputedStyle(paragraphs[0]).getPropertyValue("text-wrap-style"),
							};
						}),
					};
				});
				const narrow = measurements.container.width < 576;
				const [long, short, continuation, noAvatar] = measurements.turns;
				const nameGap = long.text.top - long.name.bottom;
				expect(nameGap).toBeCloseTo(4, 1);
				expect(long.paragraphGap).toBeCloseTo(8, 1);
				expect(long.bubble.top - measurements.caption.bottom).toBeCloseTo(12, 1);
				for (const [index, item] of measurements.turns.entries()) {
					expect(item.paddingBlock).toBe(12);
					expect(item.paddingInline).toBe(narrow ? 12 : 16);
					expect(item.shadow).toBe("none");
					expect(item.animation).toBe("none");
					expect(item.border).toBe("0px");
					expect(item.weight).toBe("600");
					expect(item.nameSize).toBe("15px");
					expect(item.nameFace).toBe(item.bodyFace);
					if (await page.evaluate(() => CSS.supports("text-wrap", "pretty")))
						expect(item.pretty).toBe("pretty");
					expect(item.hyphens).toBe("manual");
					expect(item.textAlign).toBe("start");
					const rootSize = await page
						.locator("html")
						.evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
					expect(Number.parseFloat(item.textSize)).toBeCloseTo(
						Number.parseFloat(item.bodySize) * rootSize,
						1,
					);
					if (!narrow)
						expect(item.turn.width).toBeLessThanOrEqual(measurements.container.width * 0.85 + 1);
					if (item.avatar) {
						expect(Math.abs(item.avatar.top - item.bubble.top)).toBeLessThanOrEqual(1);
						expect(item.avatar.width).toBe(narrow ? 40 : 48);
						expect(item.avatarFit).toBe("cover");
						expect(item.avatarRadius).toBe("50%");
						expect(item.avatarRing).toBe("1px");
						const end = index === 1 || index === 2;
						const avatarRight = end === (direction === "ltr");
						expect(
							avatarRight
								? item.avatar.left - item.bubble.right
								: item.bubble.left - item.avatar.right,
						).toBeCloseTo(narrow ? 8 : 12, 1);
					}
					expect(item.radiusStart).toBe("16px");
					expect(item.radiusEnd).toBe("16px");
					if (index > 0) {
						const gap = item.bubble.top - measurements.turns[index - 1].bubble.bottom;
						expect(gap).toBeCloseTo(index === 2 ? 8 : narrow ? 16 : 24, 1);
						expect(gap).toBeGreaterThanOrEqual(2 * nameGap);
					}
				}
				expect(short.bubble.width).toBeLessThan(long.bubble.width);
				expect(continuation.avatarHidden).toBe(true);
				await expect(turns.nth(2).locator(".praxity-dialogue-name")).toHaveCSS(
					"clip-path",
					"inset(50%)",
				);
				expect(continuation.radiusStart).toBe("16px");
				expect(continuation.radiusEnd).toBe("16px");
				expect(direction === "ltr" ? noAvatar.bubble.left : noAvatar.bubble.right).toBeCloseTo(
					direction === "ltr" ? long.bubble.left : long.bubble.right,
					1,
				);
				const plain = page.locator("figure.praxity-dialogue").nth(1);
				const plainBox = await plain.boundingBox();
				const plainBubble = await plain.locator(".praxity-dialogue-bubble").boundingBox();
				if (!plainBox || !plainBubble) throw new Error("Missing unillustrated dialogue");
				expect(
					direction === "ltr"
						? plainBubble.x - plainBox.x
						: plainBox.x + plainBox.width - plainBubble.x - plainBubble.width,
				).toBeCloseTo(0, 1);
				await testInfo.attach("geometry.json", {
					body: JSON.stringify(measurements),
					contentType: "application/json",
				});
			});
		}
	}
	for (const direction of ["ltr", "rtl"]) {
		test(`bubble inline avatars ${presentation} ${direction} under 20rem`, async ({
			page,
		}, testInfo) => {
			for (const width of [320, 1280]) {
				await page.setViewportSize({ width, height: 900 });
				await openLayout(page, presentation);
				await page.evaluate((dir) => {
					document.documentElement.dir = dir;
				}, direction);
				const figure = layoutDialogue(page);
				// A narrow block on a wide page must use the same container breakpoint.
				if (width === 1280)
					await figure.evaluate((e) => ((e as HTMLElement).style.inlineSize = "19rem"));
				const turns = figure.getByRole("listitem");
				const values = await figure.evaluate((figure) => {
					const box = (e: Element) => {
						const { left, right, top, bottom, width, height } = e.getBoundingClientRect();
						return { left, right, top, bottom, width, height };
					};
					return {
						container: box(figure),
						overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
						turns: Array.from(figure.querySelectorAll("li")).map((turn) => {
							const bubble = turn.querySelector(".praxity-dialogue-bubble");
							const name = turn.querySelector("bdi");
							const text = turn.querySelector(".praxity-dialogue-text");
							const avatar = turn.querySelector("img");
							if (!bubble || !name || !text) throw new Error("Missing inline dialogue content");
							return {
								bubble: box(bubble),
								name: box(name),
								text: box(text),
								avatar: avatar ? box(avatar) : null,
							};
						}),
					};
				});
				expect(values.container.width).toBeLessThan(320);
				expect(values.overflow).toBe(0);
				expect(await noOverflow(page)).toBe(true);
				for (const [index, item] of values.turns.entries()) {
					expect(item.bubble.width).toBeCloseTo(values.container.width, 1);
					expect(item.text.width).toBeGreaterThanOrEqual(220);
					expect(await turns.nth(index).ariaSnapshot()).toContain(
						index === 3 ? "Guide" : index === 1 || index === 2 ? "Sam" : "Alex",
					);
					if (!item.avatar || index === 2) continue;
					expect(item.avatar.width).toBe(24);
					expect(item.avatar.height).toBe(24);
					expect(item.avatar.top - item.bubble.top).toBeCloseTo(12, 1);
					const avatarRight = (index === 1) === (direction === "ltr");
					expect(
						avatarRight ? item.avatar.left - item.name.right : item.name.left - item.avatar.right,
					).toBeCloseTo(8, 1);
					expect(
						avatarRight
							? item.bubble.right - item.avatar.right
							: item.avatar.left - item.bubble.left,
					).toBeCloseTo(12, 1);
					// Firefox DOMRect subtraction can report 3.99998 for the 4px CSS gap.
					expect(Number((item.text.top - item.avatar.bottom).toFixed(2))).toBeGreaterThanOrEqual(4);
					await expect(turns.nth(index).locator("img")).toHaveAttribute("alt", "");
					await expect(turns.nth(index).locator("img")).toHaveAttribute("role", "presentation");
				}
				await expect(turns.nth(2).locator("img")).toHaveCSS("visibility", "hidden");
				await expect(turns.nth(2).locator(".praxity-dialogue-name")).toHaveCSS(
					"clip-path",
					"inset(50%)",
				);
				expect(values.turns[2].bubble.top - values.turns[1].bubble.bottom).toBeCloseTo(8, 1);
				await testInfo.attach(`inline-${width}.json`, {
					body: JSON.stringify(values),
					contentType: "application/json",
				});
			}
		});
	}
	test(`bubble reflow ${presentation} at 320px and 200% text`, async ({ page }) => {
		for (const fontSize of [16, 32]) {
			await page.setViewportSize({ width: 320, height: 900 });
			await openLayout(page, presentation);
			await page.evaluate((size) => {
				document.documentElement.style.fontSize = `${size}px`;
			}, fontSize);
			expect(await noOverflow(page)).toBe(true);
			expect(
				await page
					.locator(".praxity-dialogue-bubble")
					.evaluateAll((nodes) => nodes.every((e) => e.scrollWidth <= e.clientWidth + 1)),
			).toBe(true);
		}
	});
	for (const palette of DIALOGUE_PALETTES) {
		for (const mode of ["light", "dark"] as const) {
			test(`bubble colour ${presentation} ${palette} ${mode}`, async ({
				page,
				browserName,
			}, testInfo) => {
				await openLayout(page, presentation, palette, mode);
				const figure = layoutDialogue(page);
				const bubble = figure.locator(".praxity-dialogue-bubble").first();
				const textRatio = await computedContrast(bubble);
				const fillRatio = await computedContrast(bubble, "backgroundColor", false);
				expect(textRatio).toBeGreaterThanOrEqual(4.5);
				expect(fillRatio).toBeGreaterThan(1);
				await testInfo.attach("contrast.json", {
					body: JSON.stringify({ palette, mode, textRatio, fillRatio }),
					contentType: "application/json",
				});
				const captureDir = process.env.PRAXITY_DIALOGUE_CAPTURES;
				if (
					browserName === "chromium" &&
					captureDir &&
					((palette === "ink" && mode === "light") ||
						(palette === "clay" && mode === "dark") ||
						(palette === "clear" && mode === "light"))
				) {
					await mkdir(captureDir, { recursive: true });
					await page.emulateMedia({ reducedMotion: "reduce" });
					for (const width of palette === "clear" ? [390] : [1280, 768, 390]) {
						await page.setViewportSize({ width, height: 1600 });
						await openLayout(page, presentation, palette, mode);
						await figure.screenshot({
							path: resolve(captureDir, `fixture-${presentation}-${palette}-${mode}-${width}.png`),
						});
					}
					if (palette === "ink") {
						for (const direction of ["ltr", "rtl"]) {
							await page.setViewportSize({ width: 320, height: 1600 });
							await openLayout(page, presentation, palette, mode);
							await page.evaluate((dir) => {
								document.documentElement.dir = dir;
							}, direction);
							await figure.screenshot({
								path: resolve(captureDir, `fixture-${presentation}-ink-light-320-${direction}.png`),
							});
						}
					}
					if (presentation === "pages" && palette === "ink") {
						await page.setViewportSize({ width: 768, height: 1600 });
						await openLayout(page, presentation, palette, mode);
						await page.evaluate(() => {
							document.documentElement.dir = "rtl";
						});
						await figure.screenshot({ path: resolve(captureDir, "fixture-rtl-768.png") });
						await page.evaluate(() => {
							document.documentElement.dir = "ltr";
						});
						await page.emulateMedia({ forcedColors: "active" });
						await figure.screenshot({ path: resolve(captureDir, "fixture-forced-colours.png") });
					}
				}
			});
		}
	}
	test(`bubble forced colours and narration gutter ${presentation}`, async ({ page }) => {
		for (const width of [390, 320]) {
			await page.setViewportSize({ width, height: 900 });
			await openLayout(page, presentation);
			const turns = layoutDialogue(page).locator("li");
			for (const dir of ["ltr", "rtl"]) {
				await page.evaluate((value) => {
					document.documentElement.dir = value;
				}, dir);
				for (const index of [0, 1]) {
					const turn = turns.nth(index);
					await turn.evaluate((e) => e.setAttribute("aria-current", "true"));
					const marker = await turn.evaluate((e) => {
						const style = getComputedStyle(e, "::before");
						const bubble = e.querySelector(".praxity-dialogue-bubble");
						const avatar = e.querySelector("img");
						if (!bubble || !avatar) throw new Error("Missing narration turn content");
						// CSSOM exposes offsets within an absolute grid area, not the li.
						// A temporary absolute probe measures those same used properties.
						const probe = document.createElement("span");
						for (const property of [
							"position",
							"grid-column",
							"grid-row",
							"inset-inline-start",
							"inset-block",
							"width",
							"box-sizing",
							"border-inline-start",
						]) {
							probe.style.setProperty(property, style.getPropertyValue(property));
						}
						probe.setAttribute("aria-hidden", "true");
						e.append(probe);
						const { left, right } = probe.getBoundingClientRect();
						probe.remove();
						const b = bubble.getBoundingClientRect();
						const a = avatar.getBoundingClientRect();
						return {
							border: style.borderInlineStartWidth,
							transition: style.transitionDuration,
							animation: style.animationName,
							noAvatar: right <= a.left || left >= a.right,
							noBubble: right <= b.left || left >= b.right,
						};
					});
					expect(marker.border).toBe("3px");
					expect(marker.transition).toBe("0s");
					expect(marker.animation).toBe("none");
					expect(marker.noAvatar).toBe(true);
					expect(marker.noBubble).toBe(true);
				}
			}
		}
		const turns = layoutDialogue(page).locator("li");
		await page.emulateMedia({ forcedColors: "active" });
		if (!(await forcedPalette(page))) {
			await expectForcedEmulationInert(page, [
				turns.first().locator(".praxity-dialogue-bubble"),
				{ locator: turns.first(), pseudo: "::before" },
			]);
		} else {
			await expect(turns.first().locator(".praxity-dialogue-bubble")).toHaveCSS(
				"border-top-width",
				"1px",
			);
			await expect(turns.first().locator(".praxity-dialogue-bubble")).toHaveCSS(
				"border-top-style",
				"solid",
			);
			const systemColours = await page.evaluate(() => {
				const probe = document.createElement("span");
				document.body.append(probe);
				probe.style.color = "CanvasText";
				const text = getComputedStyle(probe).color;
				probe.style.color = "Highlight";
				const highlight = getComputedStyle(probe).color;
				probe.remove();
				return { text, highlight };
			});
			await expect(turns.first().locator(".praxity-dialogue-bubble")).toHaveCSS(
				"border-top-color",
				systemColours.text,
			);
			expect(
				await turns.first().evaluate((e) => getComputedStyle(e, "::before").borderInlineStartColor),
			).toBe(systemColours.highlight);
		}
	});
}

async function openDialogue(page: Page): Promise<void> {
	await page.goto(`${readTestEnv().url}/dialogue/page-1.html`);
	await waitForHydration(page);
}

const noOverflow = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("both dialogue styles expose names in ordered lists and pass axe", async ({ page }) => {
	await openDialogue(page);
	const figures = page.locator("figure.praxity-dialogue");
	await expect(figures).toHaveCount(2);
	for (const [index, style, names] of [
		[0, "bubbles", ["Roger", "AlexandriaMorganFromTheCommunityLearningSupportOffice", "Roger"]],
		[1, "script", ["Guide"]],
	] as const) {
		const figure = figures.nth(index);
		await expect(figure).toHaveAttribute("data-style", style);
		const list = figure.getByRole("list");
		await expect(list).toHaveJSProperty("tagName", "OL");
		const turns = list.getByRole("listitem");
		await expect(turns).toHaveCount(names.length);
		for (const [turnIndex, name] of names.entries()) {
			const visibleName = turns.nth(turnIndex).locator(".praxity-dialogue-name bdi");
			await expect(visibleName).toBeVisible();
			await expect(visibleName).toHaveText(name);
		}
	}
	await expect(figures.first().locator("img").first()).toHaveAttribute("alt", "");
	expect(
		(await analyzeAxe(page, new AxeBuilder({ page }).include("figure.praxity-dialogue")))
			.violations,
	).toEqual([]);
});

test("an explicit end-side first speaker reflows to a full-width bubble at 320 px", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await openDialogue(page);
	const turns = page.locator('figure[data-style="bubbles"] li');
	const left = async (index: number) =>
		(await turns.nth(index).locator(".praxity-dialogue-text").boundingBox())?.x ?? 0;
	await expect(turns.first()).toHaveAttribute("data-side", "end");
	expect(await left(0)).toBeGreaterThan(await left(1));
	await page.setViewportSize({ width: 320, height: 800 });
	expect(Math.abs((await left(1)) - (await left(0)))).toBeLessThan(60);
	expect(await noOverflow(page)).toBe(true);
	const width = await turns
		.first()
		.locator(".praxity-dialogue-text")
		.evaluate((bubble) => {
			const style = getComputedStyle(bubble);
			return (
				bubble.clientWidth -
				Number.parseFloat(style.paddingLeft) -
				Number.parseFloat(style.paddingRight)
			);
		});
	expect(width).toBeGreaterThanOrEqual(220);
	await testInfo.attach("legacy-width-320.json", {
		body: JSON.stringify({
			textWidth: width,
			overflow: await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			),
		}),
		contentType: "application/json",
	});
});

test("long URL and name stay visible with WCAG text spacing", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await openDialogue(page);
	await expect(page.locator('figure[data-style="script"] .praxity-dialogue-text')).toContainText(
		"https://example.com/",
	);
	await applyTextSpacing(page);
	expect(await noOverflow(page)).toBe(true);
	const clipped = await page
		.locator(".praxity-dialogue-name, .praxity-dialogue-text")
		.evaluateAll(
			(nodes) =>
				nodes.filter(
					(node) =>
						node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1,
				).length,
		);
	expect(clipped).toBe(0);
	const longName = page.locator('figure[data-style="bubbles"] .praxity-dialogue-name').nth(1);
	await expect(longName).toBeVisible();
	const nameInsideTurn = await longName.evaluate((name) => {
		const turn = name.closest(".praxity-dialogue-turn");
		if (!turn) throw new Error("Missing long-name dialogue turn");
		const nameBounds = name.getBoundingClientRect();
		const turnBounds = turn.getBoundingClientRect();
		return (
			nameBounds.left >= turnBounds.left - 1 &&
			nameBounds.right <= turnBounds.right + 1 &&
			nameBounds.top >= turnBounds.top - 1 &&
			nameBounds.bottom <= turnBounds.bottom + 1
		);
	});
	expect(nameInsideTurn).toBe(true);
});

test("reflows at 200% zoom", async ({ page, browserName }) => {
	test.skip(browserName !== "chromium", "200% zoom uses the Chromium DevTools Protocol");
	await page.setViewportSize({ width: 640, height: 900 });
	await openDialogue(page);
	await applyTwoHundredPercentZoom(page);
	expect(await noOverflow(page)).toBe(true);
});

test("reflows at 400% zoom", async ({ page, browserName }) => {
	test.skip(browserName !== "chromium", "Browser zoom uses the Chromium DevTools Protocol");
	await page.setViewportSize({ width: 1280, height: 900 });
	await openDialogue(page);
	const session = await page.context().newCDPSession(page);
	await session.send("Emulation.setDeviceMetricsOverride", {
		width: 320,
		height: 225,
		screenWidth: 1280,
		screenHeight: 900,
		deviceScaleFactor: 4,
		mobile: false,
	});
	expect(await noOverflow(page)).toBe(true);
});

test("an Arabic turn reads right to left inside its bubble", async ({ page }) => {
	await openDialogue(page);
	const arabic = page.locator(".praxity-dialogue-text", { hasText: "مرحبا" });
	await expect(arabic).toHaveAttribute("dir", "auto");
	expect(await arabic.evaluate((node) => getComputedStyle(node).direction)).toBe("rtl");
});

test("playing narration marks the current turn without moving focus", async ({ page }) => {
	await openDialogue(page);
	const turns = page.locator('figure[data-style="bubbles"] li.praxity-dialogue-turn');
	const listen = page.getByRole("button", { name: "Listen", exact: true });
	await listen.focus();
	await listen.press("Enter");
	const player = page.getByRole("button", { name: "Play", exact: true });
	await player.focus();
	await player.press("Enter");
	const transport = page.locator(".praxity-narration-transport button");
	await expect(transport).toBeFocused();
	const focusedElement = await page.evaluateHandle(() => document.activeElement);
	await expect(turns.nth(0)).toHaveAttribute("aria-current", "true");
	await expect
		.poll(() =>
			turns.nth(0).evaluate((turn) => getComputedStyle(turn, "::before").borderInlineStartWidth),
		)
		.toBe("3px");
	await page
		.locator("audio[data-narration-player]")
		.evaluate((audio) => audio.dispatchEvent(new Event("ended")));
	await expect(turns.nth(1)).toHaveAttribute("aria-current", "true");
	await expect(turns.nth(0)).not.toHaveAttribute("aria-current");
	expect(await focusedElement.evaluate((element) => element === document.activeElement)).toBe(true);
	expect(
		await page
			.locator("li.praxity-dialogue-turn")
			.evaluateAll((turns) => turns.some((turn) => turn.contains(document.activeElement))),
	).toBe(false);
	const arabicTurn = turns.nth(2);
	await page
		.locator("audio[data-narration-player]")
		.evaluate((audio) => audio.dispatchEvent(new Event("ended")));
	await expect(arabicTurn).toHaveAttribute("aria-current", "true");
	expect(await focusedElement.evaluate((element) => element === document.activeElement)).toBe(true);
	expect(
		await page
			.locator("li.praxity-dialogue-turn")
			.evaluateAll((turns) => turns.some((turn) => turn.contains(document.activeElement))),
	).toBe(false);
	await transport.click();
	await expect(arabicTurn).not.toHaveAttribute("aria-current");
});
