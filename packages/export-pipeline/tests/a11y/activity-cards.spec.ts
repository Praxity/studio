import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Locator } from "@playwright/test";
import {
	expectFocusRing,
	expectForcedEmulationInert,
	expectNoFocusRing,
	forcedPalette,
} from "../focus-assertions";
import { test } from "../muted-test";
import { choiceBaselines } from "./choice-baselines";
import { readTestEnv, waitForSettledStyles } from "./helpers";

async function token(target: Locator, property: string, name: string) {
	return target.evaluate(
		(element, { property, name }) => {
			const probe = document.createElement("span");
			probe.style.setProperty(property, `var(${name})`);
			element.append(probe);
			const value = getComputedStyle(probe).getPropertyValue(property);
			probe.remove();
			return value;
		},
		{ property, name },
	);
}

for (const mode of ["light", "dark"] as const) {
	for (const width of [1280, 390]) {
		for (const direction of ["ltr", "rtl"] as const) {
			test(`keyed rows ${mode} ${width} ${direction}`, async ({ page }, testInfo) => {
				await page.addInitScript(() =>
					localStorage.setItem("praxity-a11y", JSON.stringify({ focusChoice: false })),
				);
				await page.setViewportSize({ width, height: 900 });
				await page.emulateMedia({ reducedMotion: "reduce" });
				await page.goto(`${readTestEnv().url}/activity-cards-en-${mode}/index.html`);
				await page.evaluate((dir) => {
					document.documentElement.dir = dir;
				}, direction);
				const measurements = [];
				for (const id of ["choice", "multiple"]) {
					const island = page.locator(`[data-island="assessment"][data-block-id="${id}"]`);
					await island.scrollIntoViewIfNeeded();
					await expect(island).toHaveAttribute("data-hydrated", "");
					await page.evaluate(() => document.fonts.ready);
					const rows = island.locator(".praxity-assessment-choice-option");
					const first = rows.first();
					await expect(first.locator("input")).toHaveAccessibleName("Listen");
					await expect(first).toHaveCSS("border-radius", "10px");
					await expect(first).toHaveCSS("border-top-width", "1px");
					await expect(first).toHaveCSS(
						"border-top-color",
						await token(first, "color", "--line-mid"),
					);
					expect((await first.boundingBox())?.height).toBeGreaterThanOrEqual(48);
					const key = first.locator(".praxity-choice-key");
					if (id === "choice") {
						await expect(key).toHaveCSS("width", "26px");
						await expect(key).toHaveCSS("height", "26px");
						await expect(key).toHaveCSS("border-radius", "6px");
					} else await expect(first.locator("input")).toHaveCSS("width", "22px");
					await first.scrollIntoViewIfNeeded();
					await expect(first).toBeInViewport({ ratio: 1 });
					const geometry = () =>
						first.evaluate((row) => {
							const label = row.querySelector(".praxity-choice-label");
							if (!label) throw new Error("Missing choice label");
							const r = row.getBoundingClientRect();
							const l = label.getBoundingClientRect();
							const scroll = [];
							for (let node: Element | null = row.parentElement; node; node = node.parentElement)
								scroll.push({ left: node.scrollLeft, top: node.scrollTop });
							return {
								label: { x: l.x - r.x, y: l.y - r.y, width: l.width, height: l.height },
								row: { x: r.x, y: r.y, width: r.width, height: r.height },
								documentPosition: {
									x: r.x + scroll.reduce((sum, offset) => sum + offset.left, 0),
									y: r.y + scroll.reduce((sum, offset) => sum + offset.top, 0),
								},
								scroll,
							};
						});
					await waitForSettledStyles(page);
					await expect
						.poll(async () => {
							const sample = await geometry();
							await page.evaluate(() => new Promise(requestAnimationFrame));
							return JSON.stringify(await geometry()) === JSON.stringify(sample);
						})
						.toBe(true);
					const before = await geometry();
					await first.hover();
					await expect(first).toHaveCSS(
						"background-color",
						await token(first, "background-color", "--paper-2"),
					);
					await first.locator("input").check();
					await page.mouse.move(0, 0);
					await expect(first).toHaveCSS("border-top-width", "2px");
					await expect(first).toHaveCSS(
						"border-top-color",
						await token(first, "color", "--accent"),
					);
					await expect(first).toHaveCSS(
						"background-color",
						await token(first, "background-color", "--accent-soft"),
					);
					await expect(first).toHaveCSS("box-shadow", "none");
					const after = await geometry();
					for (const axis of ["x", "y", "width", "height"] as const)
						expect(Math.abs(after.label[axis] - before.label[axis])).toBeLessThanOrEqual(0.5);
					for (const axis of ["width", "height"] as const)
						expect(Math.abs(after.row[axis] - before.row[axis])).toBeLessThanOrEqual(0.5);
					for (const axis of ["x", "y"] as const)
						expect(
							Math.abs(after.documentPosition[axis] - before.documentPosition[axis]),
							`${id} row document ${axis}`,
						).toBeLessThanOrEqual(0.5);
					const measured = await choiceBaselines(rows);
					for (const result of measured) {
						expect(result.delta, `${id} first-line baseline`).toBeLessThanOrEqual(1);
						expect(result.shift, "baseline probe preserves key geometry").toBeLessThanOrEqual(0.1);
					}
					expect(measured[0].lines).toBe(1);
					if (width === 390) expect(measured[1].lines).toBeGreaterThan(1);
					measurements.push({ id, before, after, measured });
					await first.locator("input").focus();
					await page.keyboard.press("Shift+Tab");
					await page.keyboard.press("Tab");
					await page.keyboard.press(id === "choice" ? "ArrowDown" : "Space");
					await expect(rows.nth(id === "choice" ? 1 : 0).locator("input")).toBeFocused();
					await expect(rows.nth(id === "choice" ? 1 : 0)).toHaveCSS("outline-width", "2px");
					if (id === "choice") await expect(rows.nth(1).locator("input")).toBeChecked();
					else await expect(first.locator("input")).not.toBeChecked();
				}
				await testInfo.attach("baseline-measurements", {
					body: JSON.stringify(measurements),
					contentType: "application/json",
				});
			});
		}
	}
}

for (const locale of ["en", "fr"] as const) {
	for (const width of [195, 240, 320, 390, 1280]) {
		test(`submitted marks fit their rows ${locale} ${width}`, async ({ page, browserName }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ reducedMotion: "reduce" });
			const open = async () => {
				await page.goto(readTestEnv().url);
				await page.evaluate(() => {
					localStorage.clear();
					sessionStorage.clear();
				});
				await page.goto(`${readTestEnv().url}/activity-cards-${locale}-light/index.html`);
				await page.evaluate(() => document.fonts.ready);
			};
			const assertMarksFit = async (island: Locator) => {
				const marks = await island.locator(".praxity-choice-status").evaluateAll((elements) =>
					elements.map((mark) => {
						const row = mark.closest(".praxity-assessment-choice-option");
						const icon = mark.querySelector("svg");
						const text = mark.lastChild;
						if (!row || !icon || !text) throw new Error("Missing marked choice geometry");
						const rowRect = row.getBoundingClientRect();
						const markRect = mark.getBoundingClientRect();
						const iconRect = icon.getBoundingClientRect();
						const range = document.createRange();
						range.selectNodeContents(text);
						const line = range.getClientRects()[0];
						if (!line) throw new Error("Missing verdict text line");
						return {
							left: markRect.left - rowRect.left,
							right: rowRect.right - markRect.right,
							top: markRect.top - rowRect.top,
							bottom: rowRect.bottom - markRect.bottom,
							overflow: row.scrollWidth - row.clientWidth,
							iconCenter: (iconRect.top + iconRect.bottom) / 2,
							lineTop: line.top,
							lineBottom: line.bottom,
						};
					}),
				);
				expect(marks.length).toBeGreaterThan(0);
				for (const mark of marks) {
					for (const inset of [mark.left, mark.right, mark.top, mark.bottom])
						expect.soft(inset, "mark stays inside its row").toBeGreaterThanOrEqual(-0.5);
					expect.soft(mark.overflow, "row overflow").toBe(0);
					expect
						.soft(mark.iconCenter, "icon stays on the first line")
						.toBeGreaterThanOrEqual(mark.lineTop - 0.5);
					expect
						.soft(mark.iconCenter, "icon stays on the first line")
						.toBeLessThanOrEqual(mark.lineBottom + 0.5);
				}
				expect
					.soft(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
					.toBe(0);
			};
			for (const id of ["choice", "multiple"]) {
				await open();
				const island = page.locator(`[data-island="assessment"][data-block-id="${id}"]`);
				await island.scrollIntoViewIfNeeded();
				await expect(island).toHaveAttribute("data-hydrated", "");
				const rows = island.locator(".praxity-assessment-choice-option");
				const capture = async (state: string) => {
					const folder = process.env.PRAXITY_ACTIVITY_SHOTS;
					if (
						folder &&
						browserName === "chromium" &&
						locale === "fr" &&
						[240, 390].includes(width)
					) {
						await mkdir(folder, { recursive: true });
						await island.screenshot({ path: resolve(folder, `fr-${width}-${id}-${state}.png`) });
					}
				};
				await rows.nth(1).locator("input").check();
				await island.locator("[data-assessment-submit]").click();
				await expect(rows.nth(1)).toHaveAttribute("data-choice-result", "incorrect");
				await assertMarksFit(island);
				await capture("incorrect");
				await island
					.getByRole("button", { name: locale === "fr" ? "Réessayer" : "Try again" })
					.click();
				await expect(rows.nth(1)).toHaveAttribute("data-choice-result", "incorrect");
				await assertMarksFit(island);
				await capture("retry");
				await rows.nth(1).locator("input").check();
				await island.locator("[data-assessment-submit]").click();
				await expect(rows.first().locator(".praxity-choice-status")).toHaveText(
					locale === "fr" ? "Bonne réponse" : "Correct answer",
				);
				await assertMarksFit(island);
				await open();
				await island.scrollIntoViewIfNeeded();
				await expect(island).toHaveAttribute("data-hydrated", "");
				await rows.first().locator("input").check();
				await island.locator("[data-assessment-submit]").click();
				await expect(rows.first().locator(".praxity-choice-status")).toHaveText("Correct");
				await assertMarksFit(island);
			}
		});
	}
}

for (const locale of ["en", "fr"] as const) {
	test(`marks survive retry and reveal the final answer ${locale}`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto(`${readTestEnv().url}/activity-cards-${locale}-light/index.html`);
		for (const id of ["choice", "multiple"]) {
			const island = page.locator(`[data-island="assessment"][data-block-id="${id}"]`);
			await island.scrollIntoViewIfNeeded();
			await expect(island).toHaveAttribute("data-hydrated", "");
			const rows = island.locator(".praxity-assessment-choice-option");
			await rows.nth(1).locator("input").check();
			await island.locator("[data-assessment-submit]").click();
			const wrong = rows.nth(1);
			await expect(wrong).toHaveAttribute("data-choice-result", "incorrect");
			await expect(wrong.locator(".praxity-choice-status")).toHaveText(
				locale === "fr" ? "Pas tout à fait" : "Not quite",
			);
			await expect(wrong.locator(".praxity-choice-status svg")).toHaveCount(1);
			await expect(wrong.locator(".praxity-choice-status")).toHaveCSS(
				"color",
				await token(wrong, "color", "--error-ink"),
			);
			if (id === "choice")
				await expect(wrong.locator(".praxity-choice-key")).toHaveCSS(
					"background-color",
					await token(wrong, "background-color", "--error-ink"),
				);
			await expect(wrong).toHaveCSS("border-top-color", await token(wrong, "color", "--error-ink"));
			await expect(wrong).toHaveCSS(
				"background-color",
				await token(wrong, "background-color", "--error-tint"),
			);
			await expect(wrong.locator(".praxity-choice-feedback")).toContainText(
				"Give the person time to explain.",
			);
			await island
				.getByRole("button", { name: locale === "fr" ? "Réessayer" : "Try again" })
				.click();
			await expect(wrong).toHaveAttribute("data-choice-result", "incorrect");
			await rows.nth(1).locator("input").check();
			await island.locator("[data-assessment-submit]").click();
			await expect(rows.first()).toHaveAttribute("data-choice-result", "correct");
			await expect(rows.first().locator(".praxity-choice-status")).toHaveText(
				locale === "fr" ? "Bonne réponse" : "Correct answer",
			);
			await expect(rows.first().locator(".praxity-choice-status svg")).toHaveCount(1);
			await expect(rows.first()).toHaveCSS(
				"border-top-color",
				await token(rows.first(), "color", "--success-ink"),
			);
		}
	});
}

test("forced colours expose native controls and hide generated keys", async ({ page }) => {
	await page.emulateMedia({ forcedColors: "active" });
	await page.goto(`${readTestEnv().url}/activity-cards-en-light/index.html`);
	await page.addStyleTag({ content: ":root { --activity-test-highlight: Highlight; }" });
	for (const id of ["choice", "multiple"]) {
		const island = page.locator(`[data-island="assessment"][data-block-id="${id}"]`);
		await island.scrollIntoViewIfNeeded();
		await expect(island).toHaveAttribute("data-hydrated", "");
		const row = island.locator(".praxity-assessment-choice-option").first();
		await row.locator("input").check();
		if (!(await forcedPalette(page))) {
			await row.locator("input").focus();
			await page.keyboard.press("Shift+Tab");
			await page.keyboard.press("Tab");
			await expect(row.locator("input")).toBeFocused();
			await expectForcedEmulationInert(page, [
				row,
				row.locator("input"),
				...(id === "choice" ? [row.locator(".praxity-choice-key")] : []),
			]);
			await expectFocusRing(row, 2);
			await expectNoFocusRing(row.locator("input"));
			continue;
		}
		await expect(row.locator("input")).toHaveCSS("opacity", "1");
		await expect(row.locator("input")).toHaveCSS("appearance", "auto");
		if (id === "choice") await expect(row.locator(".praxity-choice-key")).toBeHidden();
		await expect(row).toHaveCSS("border-top-width", "2px");
		await expect(row).toHaveCSS(
			"border-top-color",
			await token(row, "color", "--activity-test-highlight"),
		);
	}
});

test("activity card visual evidence", async ({ page, browserName }) => {
	const folder = process.env.PRAXITY_ACTIVITY_SHOTS;
	test.skip(!folder || browserName !== "chromium", "Opt-in Linux Chromium captures");
	if (!folder) throw new Error("Missing capture folder");
	await mkdir(folder, { recursive: true });
	for (const mode of ["light", "dark"]) {
		for (const width of [1280, 390]) {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ reducedMotion: "reduce" });
			for (const id of ["choice", "multiple"]) {
				const open = async () => {
					await page.goto(readTestEnv().url);
					await page.evaluate(() => {
						localStorage.clear();
						sessionStorage.clear();
					});
					await page.goto(`${readTestEnv().url}/activity-cards-en-${mode}/index.html`);
					const island = page.locator(`[data-island="assessment"][data-block-id="${id}"]`);
					await island.scrollIntoViewIfNeeded();
					await expect(island).toHaveAttribute("data-hydrated", "");
					await page.evaluate(() => document.fonts.ready);
					return island;
				};
				let island = await open();
				const capture = async (state: string) => {
					await island.screenshot({ path: resolve(folder, `${mode}-${width}-${id}-${state}.png`) });
				};
				await page.mouse.move(0, 0);
				await capture("unselected");
				await island.locator(".praxity-assessment-choice-option").first().hover();
				await capture("hover");
				await island.locator("input").first().check();
				await page.mouse.move(0, 0);
				await capture("selected");
				await island.locator("[data-assessment-submit]").click();
				await capture("correct");
				island = await open();
				await island.locator("input").nth(1).check();
				await island.locator("[data-assessment-submit]").click();
				await capture("incorrect");
				await island.getByRole("button", { name: "Try again" }).click();
				await page.mouse.move(0, 0);
				await capture("retry");
				await island.locator("input").nth(1).check();
				await island.locator("[data-assessment-submit]").click();
				await capture("final");
				if (mode === "light" && width === 390) {
					island = await open();
					await page.evaluate(() => {
						document.documentElement.dir = "rtl";
					});
					await island.locator("input").first().check();
					await capture("rtl");
					await page.emulateMedia({ forcedColors: "active" });
					await capture("forced-colours");
					await page.emulateMedia({ forcedColors: "none" });
				}
			}
		}
	}
});

for (const mode of ["light", "dark"] as const) {
	for (const width of [1280, 390]) {
		test(`one card per activity ${mode} ${width}`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ reducedMotion: "reduce" });
			const env = readTestEnv();
			const courseUrl =
				env.fullFixtureVariants?.[`theme-${mode}`] ?? `${env.url}/comprehensive-${mode}`;
			let count = 0;
			for (const entry of env.pages) {
				await page.goto(`${courseUrl}/${entry.slug}.html`);
				const activities = page.locator(
					"[data-block-type='assessment'], [data-block-type='checklist'], [data-block-type='rating'], [data-block-type='signature']",
				);
				for (const activity of await activities.all()) {
					if (!(await activity.isVisible())) continue;
					await activity.scrollIntoViewIfNeeded();
					await expect(activity).toHaveAttribute("data-hydrated", "");
					const card = activity
						.locator(
							":scope > .praxity-block-assessment, :scope > .praxity-fieldset-reset, :scope > .praxity-signature",
						)
						.first();
					await expect(card).toHaveCSS("border-radius", "16px");
					await expect(card).toHaveCSS("border-top-width", "1px");
					await expect(card).toHaveCSS("border-top-color", await token(card, "color", "--rule"));
					await expect(card).toHaveCSS(
						"background-color",
						await token(card, "background-color", "--paper"),
					);
					await expect(card).toHaveCSS("padding-top", width === 390 ? "18px" : "28px");
					await expect(card).toHaveCSS("padding-left", width === 390 ? "16px" : "28px");
					if (mode === "dark") await expect(card).toHaveCSS("box-shadow", "none");
					else {
						await expect(card).toHaveCSS(
							"box-shadow",
							await token(card, "box-shadow", "--shadow-card"),
						);
						await expect(card).not.toHaveCSS("box-shadow", "none");
					}
					const nested = await card.locator("div, fieldset").evaluateAll((elements) =>
						elements
							.filter((element) => {
								if (element.closest(".praxity-assessment-choice-option")) return false;
								const style = getComputedStyle(element);
								return (
									element.getBoundingClientRect().height > 0 &&
									Number.parseFloat(style.borderRadius) > 0 &&
									[
										style.borderTopWidth,
										style.borderRightWidth,
										style.borderBottomWidth,
										style.borderLeftWidth,
									].every((v) => Number.parseFloat(v) > 0)
								);
							})
							.map((element) => element.className),
					);
					expect(nested, "activity has no nested box").toEqual([]);
					count++;
				}
			}
			expect(count).toBeGreaterThan(10);
		});
	}
}

test("a correct chosen row carries its verdict and feedback", async ({ page }) => {
	await page.goto(`${readTestEnv().url}/activity-cards-en-light/index.html`);
	for (const id of ["choice", "multiple"]) {
		const island = page.locator(`[data-island="assessment"][data-block-id="${id}"]`);
		await island.scrollIntoViewIfNeeded();
		await expect(island).toHaveAttribute("data-hydrated", "");
		const row = island.locator(".praxity-assessment-choice-option").first();
		// Exercise the desktop mark column even in the compact two-question fixture.
		await island.locator(":scope > .praxity-block-assessment").evaluate((element) => {
			(element as HTMLElement).style.maxWidth = "none";
			(element as HTMLElement).style.width = "800px";
		});
		await page.evaluate(() => document.fonts.ready);
		const labelPosition = () =>
			row.evaluate((element) => {
				const label = element.querySelector(".praxity-choice-label");
				if (!label) throw new Error("Missing choice label");
				const text = label.getBoundingClientRect();
				const bounds = element.getBoundingClientRect();
				return { x: text.x - bounds.x, y: text.y - bounds.y };
			});
		const labelBefore = await labelPosition();
		await row.locator("input").check();
		await island.locator("[data-assessment-submit]").click();
		await expect(row).toHaveAttribute("data-choice-result", "correct");
		await expect(row.locator(".praxity-choice-status")).toHaveText("Correct");
		const mark = await row.locator(".praxity-choice-status").boundingBox();
		expect(mark?.height).toBeLessThanOrEqual(36);
		const labelAfter = await labelPosition();
		expect(Math.abs(labelAfter.x - labelBefore.x)).toBeLessThanOrEqual(0.5);
		expect(Math.abs(labelAfter.y - labelBefore.y)).toBeLessThanOrEqual(0.5);
		await expect(row.locator(".praxity-choice-status svg")).toHaveCount(1);
		await expect(row.locator(".praxity-choice-status")).toHaveCSS(
			"color",
			await token(row, "color", "--success-ink"),
		);
		if (id === "choice")
			await expect(row.locator(".praxity-choice-key")).toHaveCSS(
				"background-color",
				await token(row, "background-color", "--success-ink"),
			);
		await expect(row).toHaveCSS("border-top-color", await token(row, "color", "--success-ink"));
		await expect(row).toHaveCSS(
			"background-color",
			await token(row, "background-color", "--success-tint"),
		);
		await expect(row.locator(".praxity-choice-feedback")).toHaveText("Let the person finish.");
	}
});

for (const width of [1280, 390]) {
	test(`leadership activity card at ${width}`, async ({ page, browserName }) => {
		const manifest = process.env.PRAXITY_DESIGN_SYSTEM_ENV;
		test.skip(!manifest, "Maintainer course supplied by the scratch capture runner");
		if (!manifest) throw new Error("Missing leadership exports");
		const courses = JSON.parse(await readFile(manifest, "utf8")) as Array<{
			name: string;
			variant: string;
			url: string;
			entries: string[];
		}>;
		const leadership = courses.filter((entry) => entry.name === "leadership");
		if (!leadership.length) throw new Error("Missing leadership course");
		await page.setViewportSize({ width, height: 900 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		for (const course of leadership) {
			let found = false;
			for (const entry of course.entries) {
				await page.goto(`${course.url}/${entry}?praxity-inspect=1`);
				await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				const slide = page
					.locator(".deck-slide")
					.filter({ has: page.locator(".praxity-assessment-choice-option") })
					.first();
				if (!(await slide.count())) continue;
				await slide.evaluate((target) => {
					for (const sibling of document.querySelectorAll<HTMLElement>(".deck-slide")) {
						sibling.hidden = sibling !== target;
						sibling.inert = sibling !== target;
					}
				});
				const island = slide
					.locator('[data-island="assessment"]')
					.filter({ has: page.locator(".praxity-assessment-choice-option") })
					.first();
				await island.scrollIntoViewIfNeeded();
				await expect(island).toHaveAttribute("data-hydrated", "");
				const card = island.locator(":scope > .praxity-block-assessment");
				await expect(card).toHaveCSS("border-radius", "16px");
				await expect(card).toHaveCSS("border-top-width", "1px");
				await expect(card).toHaveCSS("border-top-color", await token(card, "color", "--rule"));
				await expect(card).toHaveCSS(
					"background-color",
					await token(card, "background-color", "--paper"),
				);
				await expect(card).toHaveCSS(
					"box-shadow",
					await token(card, "box-shadow", "--shadow-card"),
				);
				if (course.variant === "dark") await expect(card).toHaveCSS("box-shadow", "none");
				else await expect(card).not.toHaveCSS("box-shadow", "none");
				const measurements = await choiceBaselines(
					card.locator(".praxity-assessment-choice-option"),
				);
				expect(measurements.length).toBeGreaterThan(1);
				for (const measured of measurements) expect(measured.delta).toBeLessThanOrEqual(1);
				if (process.env.PRAXITY_ACTIVITY_SHOTS && browserName === "chromium") {
					await page.evaluate(() => document.fonts.ready);
					await page.screenshot({
						path: resolve(
							process.env.PRAXITY_ACTIVITY_SHOTS,
							`leadership-${course.variant === "dark" ? "dark-" : ""}${width}.png`,
						),
					});
				}
				found = true;
				break;
			}
			expect(found, "module-1 check exists").toBe(true);
		}
	});
}
