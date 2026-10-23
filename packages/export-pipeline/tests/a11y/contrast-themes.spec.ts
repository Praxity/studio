import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { expectFocusRing, expectForcedEmulationInert, forcedPalette } from "../focus-assertions";
import { computedContrast } from "./contrast-helpers";
import {
	analyzeAxe,
	readFullFixtureVariantUrl,
	readTestEnv,
	readThemeVariantUrl,
	waitForHydration,
} from "./helpers";

const THEME_URLS = {
	light: "light",
	dark: "dark",
	auto: "auto",
	custom: "custom",
} as const;

function normalizeColor(value: string): string {
	return value.replace(/\s+/g, "").toLowerCase();
}

function rgbToHex(value: string): string {
	expect(value, "convert non-RGB CSS colors through canvas first").toMatch(/^rgba?\(/);
	const channels = value
		.match(/[\d.]+/g)
		?.slice(0, 3)
		.map(Number);
	expect(channels, `expected an rgb() color, received ${value}`).toHaveLength(3);
	return `#${(channels ?? [])
		.map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
		.join("")}`;
}

async function assertNoContrastViolations(page: Page): Promise<void> {
	const results = await analyzeAxe(page, new AxeBuilder({ page }).withRules(["color-contrast"]));
	const contrastViolation = results.violations.find((entry) => entry.id === "color-contrast");
	const count = contrastViolation?.nodes.length ?? 0;
	expect(
		count,
		`color-contrast findings should be zero: ${JSON.stringify(contrastViolation?.nodes.map((node) => node.target) ?? [])}`,
	).toBe(0);
}

async function waitForAssessmentHydration(page: Page): Promise<void> {
	const assessments = page.locator('[data-island="assessment"]');
	expect(
		await assessments.count(),
		"assessment fixture needs an assessment island",
	).toBeGreaterThan(0);
	await expect
		.poll(() =>
			assessments.evaluateAll((elements) =>
				elements.every((element) => element.hasAttribute("data-hydrated")),
			),
		)
		.toBe(true);
}

test.describe("theme variants", () => {
	test("full fixture navigation keeps its outline text and states in light and dark themes", async ({
		page,
	}) => {
		for (const name of ["theme-light", "theme-dark"]) {
			const baseUrl = readFullFixtureVariantUrl(name);
			expect(baseUrl, `Missing full fixture URL for '${name}'`).toBeTruthy();
			if (!baseUrl) continue;

			await page.goto(`${baseUrl}/page-1.html?praxity-resume=0`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);
			await expect(page.locator(".praxity-native-page-nav .praxity-nav-prev")).toHaveCount(0);

			await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);
			const previous = page.locator(".praxity-native-page-nav .praxity-nav-prev");
			await expect(previous).toBeVisible();
			expect(
				await computedContrast(previous),
				`${name} previous link at rest`,
			).toBeGreaterThanOrEqual(4.5);
			await previous.hover();
			expect(
				await computedContrast(previous),
				`${name} previous link on hover`,
			).toBeGreaterThanOrEqual(4.5);
			await previous.focus();
			expect(
				await computedContrast(previous, "outlineColor"),
				`${name} previous link focus indicator`,
			).toBeGreaterThanOrEqual(3);
			await assertNoContrastViolations(page);
		}
	});

	test("light and dark variants set expected mode and pass contrast", async ({ page }) => {
		for (const [name, expectedMode] of [
			[THEME_URLS.light, "light"],
			[THEME_URLS.dark, "dark"],
		] as const) {
			const baseUrl = readThemeVariantUrl(name);
			expect(baseUrl, `Missing URL for theme variant '${name}'`).toBeTruthy();
			if (!baseUrl) continue;

			await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);

			await expect(page.locator("html")).toHaveAttribute("data-praxity-mode", expectedMode);
			await assertNoContrastViolations(page);
			const focusTarget = page.locator(".praxity-block button").first();
			await focusTarget.focus();
			expect(
				await computedContrast(focusTarget, "outlineColor"),
				`${name} focus indicator contrast`,
			).toBeGreaterThanOrEqual(3);
		}
	});

	test("auto variant follows prefers-color-scheme", async ({ page }) => {
		const baseUrl = readThemeVariantUrl(THEME_URLS.auto);
		expect(baseUrl, "Missing URL for theme variant 'auto'").toBeTruthy();
		if (!baseUrl) return;

		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		await expect(page.locator("html")).toHaveAttribute("data-praxity-mode", "dark");

		await page.emulateMedia({ colorScheme: "light" });
		await page.reload({ waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		await expect(page.locator("html")).toHaveAttribute("data-praxity-mode", "light");
		await assertNoContrastViolations(page);
	});

	test("custom variant propagates accent color to the root and checked key", async ({ page }) => {
		const baseUrl = readThemeVariantUrl(THEME_URLS.custom);
		expect(baseUrl, "Missing URL for theme variant 'custom'").toBeTruthy();
		if (!baseUrl) return;

		await page.goto(`${baseUrl}/page-3.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		const radio = page.locator("input[type='radio']").first();
		await radio.check();
		const key = page.locator(".praxity-choice-key").first();

		// The authored red is contrast-corrected to #d8293b; the painted key's
		// fill and border must both use that correction.
		await expect
			.poll(() =>
				key.evaluate((node, expected) => {
					const canvas = document.createElement("canvas");
					canvas.width = 1;
					canvas.height = 1;
					const context = canvas.getContext("2d");
					if (!context) throw new Error("Canvas 2D context unavailable");
					const toRgb = (value: string) => {
						context.fillStyle = "#000";
						context.fillStyle = value;
						context.fillRect(0, 0, 1, 1);
						return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
					};
					const expectedRgb = toRgb(expected);
					const rootRgb = toRgb(
						getComputedStyle(document.documentElement)
							.getPropertyValue("--praxity-color-accent")
							.trim(),
					);
					const style = getComputedStyle(node);
					return {
						expectedRgb,
						rootRgb,
						backgroundRgb: toRgb(style.backgroundColor),
						borderRgb: toRgb(style.borderTopColor),
					};
				}, "#e63946"),
			)
			.toEqual({
				expectedRgb: [230, 57, 70],
				rootRgb: [216, 41, 59],
				backgroundRgb: [216, 41, 59],
				borderRgb: [216, 41, 59],
			});
		expect(
			await computedContrast(key, "backgroundColor"),
			"checked key contrast",
		).toBeGreaterThanOrEqual(3);
	});

	test("every button variant keeps text contrast at rest and on hover", async ({ page }) => {
		const baseUrl = readFullFixtureVariantUrl("theme-light");
		expect(baseUrl, "Missing full light fixture URL").toBeTruthy();
		if (!baseUrl) return;

		await page.goto(`${baseUrl}/page-1.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);

		for (const variant of ["filled", "outline", "light"]) {
			const button = page
				.locator(
					`[data-block-type="button"] :is(.mantine-Button-root, .praxity-button)[data-variant="${variant}"]`,
				)
				.first();
			expect(await computedContrast(button), `${variant} button at rest`).toBeGreaterThanOrEqual(
				4.5,
			);
			await button.hover();
			expect(await computedContrast(button), `${variant} button on hover`).toBeGreaterThanOrEqual(
				4.5,
			);
		}
	});

	test("flippable cards keep reading faces unboxed", async ({ page }) => {
		const baseUrl = readFullFixtureVariantUrl("theme-light");
		expect(baseUrl, "Missing full light fixture URL").toBeTruthy();
		if (!baseUrl) return;

		await page.goto(`${baseUrl}/page-3.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		const card = page.locator('.praxity-card[data-flippable="true"]').first();
		await expect(card).toBeVisible();
		await expect(card.locator("xpath=ancestor::*[@data-card-root][1]")).toHaveAttribute(
			"data-style",
			"outline",
		);

		const styles = await card.evaluate((element) => {
			const body = element.querySelector<HTMLElement>('[data-card-side="front"]');
			const toggle = element.querySelector<HTMLElement>(".praxity-flashcard-toggle");
			const face = element.querySelector<HTMLElement>(".praxity-flashcard-face");
			const outerStyle = getComputedStyle(element);
			return {
				outerBorderWidth: outerStyle.borderTopWidth,
				outerBackground: outerStyle.backgroundColor,
				outerShadow: outerStyle.boxShadow,
				bodyPadding: body ? getComputedStyle(body).paddingTop : null,
				toggleBorderWidth: toggle ? getComputedStyle(toggle).borderTopWidth : null,
				faceBorderWidth: face ? getComputedStyle(face).borderTopWidth : null,
			};
		});

		expect(styles.outerBorderWidth).toBe("0px");
		expect(styles.outerBackground).toBe("rgba(0, 0, 0, 0)");
		expect(styles.outerShadow).toBe("none");
		expect(styles.bodyPadding).toBe("0px");
		expect(styles.toggleBorderWidth).toBe("1px");
		await expect(card.locator(".praxity-flashcard-toggle")).toHaveCSS("min-height", "44px");
		expect(styles.faceBorderWidth).toBe("0px");
		const inactiveDot = page.locator(".praxity-slides-dot:not([aria-current])").first();
		await expect(inactiveDot).toBeVisible();
		expect(
			await computedContrast(inactiveDot, "backgroundColor", false, "::before"),
			"inactive slide dot contrast",
		).toBeGreaterThanOrEqual(3);
	});

	test("sequence move controls keep text contrast on hover", async ({ page }) => {
		const baseUrl = readFullFixtureVariantUrl("theme-light");
		expect(baseUrl, "Missing full light fixture URL").toBeTruthy();
		if (!baseUrl) return;
		await page.goto(`${baseUrl}/page-4.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);

		const control = page.locator(".praxity-order-item .mantine-ActionIcon-root").first();
		await expect(control, "Missing sequence controls in full fixture").toBeVisible();
		expect(await computedContrast(control), "sequence control at rest").toBeGreaterThanOrEqual(4.5);
		await control.hover();
		expect(await computedContrast(control), "sequence control on hover").toBeGreaterThanOrEqual(
			4.5,
		);
	});

	for (const mode of ["light", "dark"] as const) {
		for (const forcedColors of ["none", "active"] as const) {
			test(`assessment controls retain contrast with their owning tokens ${mode} ${forcedColors}`, async ({
				page,
			}) => {
				await page.emulateMedia({ forcedColors });
				if (forcedColors === "active")
					test.skip(
						!(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)),
						"This engine does not emulate forced colours",
					);
				const baseUrl = readThemeVariantUrl(THEME_URLS[mode]);
				expect(baseUrl, "Missing light theme URL").toBeTruthy();
				if (!baseUrl) return;

				await page.goto(`${baseUrl}/page-3.html`, { waitUntil: "domcontentloaded" });
				await waitForHydration(page);
				await waitForAssessmentHydration(page);
				const controls = page.locator(
					".praxity-assessment-select-input, .mantine-Radio-radio:not(:checked), .mantine-Checkbox-input:not(:checked), .mantine-Textarea-input, .mantine-TextInput-input, .praxity-ag-radio:not(:checked)",
				);
				expect(await controls.count(), "assessment fixture needs boundary probes").toBeGreaterThan(
					0,
				);

				if (forcedColors === "active" && !(await forcedPalette(page)))
					await expectForcedEmulationInert(page, [controls]);
				for (const control of await controls.all()) {
					const colors = await control.evaluate((element) => {
						const style = getComputedStyle(element);
						const probe = document.createElement("span");
						probe.style.color = element.closest(".praxity-matching-select")
							? "var(--praxity-color-control-border)"
							: "var(--praxity-color-activity-border)";
						element.before(probe);
						const activityBorder = getComputedStyle(probe).color;
						probe.remove();
						return {
							border: style.borderTopColor,
							activityBorder,
						};
					});
					// Forced colours use the browser's system palette; retain the boundary checks below.
					if (forcedColors === "none")
						expect(normalizeColor(colors.border)).toBe(normalizeColor(colors.activityBorder));
					expect(
						await computedContrast(control, "borderTopColor"),
						"boundary against control fill",
					).toBeGreaterThanOrEqual(3);
					expect(
						await computedContrast(control, "borderTopColor", false),
						"boundary against surrounding surface",
					).toBeGreaterThanOrEqual(3);
				}
			});
		}
	}

	for (const mode of ["light", "dark"] as const) {
		test(`table scrolling retains keyboard focus contrast at 390px ${mode}`, async ({ page }) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`${readTestEnv().url}/radius-pages-ink-${mode}/corner-roles.html`);
			await waitForHydration(page);
			const table = page.locator(".praxity-table-scroll-region").first();
			await table.focus();
			await page.keyboard.press("Tab");
			await page.keyboard.press("Shift+Tab");
			await expect(table).toBeFocused();
			await expect(table).toHaveCSS("outline-style", "solid");
			expect(await computedContrast(table, "outlineColor", false)).toBeGreaterThanOrEqual(3);
		});
	}

	test("prefers-contrast strengthens boundaries without replacing the theme", async ({
		page,
		browserName,
	}) => {
		const baseUrl = readThemeVariantUrl(THEME_URLS.light);
		expect(baseUrl, "Missing light theme URL").toBeTruthy();
		if (!baseUrl) return;

		await page.addInitScript(() => {
			localStorage.setItem("praxity-a11y", JSON.stringify({ focusChoice: true }));
		});
		await page.goto(`${baseUrl}/page-3.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		await waitForAssessmentHydration(page);
		const addProbes = () =>
			page.evaluate(() => {
				const checked = document.querySelector<HTMLInputElement>(
					".praxity-assessment-choice-option input[type=radio]",
				);
				checked
					?.closest(".praxity-assessment-choice-option")
					?.querySelector(".praxity-choice-key")
					?.setAttribute("data-contrast-probe", "checked");
				if (checked) checked.checked = true;
				checked
					?.closest<HTMLElement>(".praxity-assessment-choice-option")
					?.setAttribute("data-contrast-probe", "selected");
				document.querySelector(".praxity-page-content")?.insertAdjacentHTML(
					"beforeend",
					`<div class="praxity-text"><p>Read the <a href="#main-content" data-contrast-probe="prose-link">linked content</a>.</p></div>
				<a class="praxity-document-bookmark" href="#main-content" data-contrast-probe="card-link"><span>Card link</span></a>
				<aside class="praxity-note-base" data-color="info" data-contrast-probe="note"><div>Platform contrast callout</div></aside>
				<input class="mantine-TextInput-input" data-contrast-probe="control">
				<div class="praxity-block-assessment" data-contrast-probe="assessment-container">Assessment container</div>
				<div class="praxity-table-scroll-region" data-contrast-probe="table"><table><tbody><tr><td>Cell</td></tr></tbody></table></div>
				<div class="praxity-card-outline" data-contrast-probe="card">Card</div>
				<div class="praxity-tabs-block" data-orientation="horizontal"><div class="mantine-Tabs-list" data-contrast-probe="tab-strip">Tabs</div></div>
				<div class="praxity-divider-line" data-contrast-probe="divider"></div>
				<div><div class="praxity-order-item">One</div><div class="praxity-order-item" data-contrast-probe="separator">Two</div></div>
				<div class="praxity-required-ring" data-contrast-probe="required">Required</div>
				<input class="praxity-fill-blank-input" aria-invalid="true" data-contrast-probe="error">
				<div class="praxity-block-assessment" data-result="incorrect" data-contrast-probe="result">Incorrect result</div>
				<div data-focus-row data-focus-dimmed data-contrast-probe="row"><p>Dimmed row</p></div>
				<button type="button" data-contrast-probe="focus">Focus target</button>`,
				);
			});
		await addProbes();

		const selectedRow = page.locator('[data-contrast-probe="selected"]');
		const probeStyles = () =>
			page.evaluate(async () => {
				const selected = document.querySelector('[data-contrast-probe="selected"]');
				if (!selected) throw new Error("Missing selected contrast probe");
				// Selection and contrast changes both transition the row's border and fill.
				await Promise.all(
					selected
						.getAnimations()
						.filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
						.map((animation) => animation.finished),
				);
				const canvas = document.createElement("canvas");
				canvas.width = 1;
				canvas.height = 1;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("Canvas 2D context unavailable");
				const toRgb = (value: string) => {
					context.clearRect(0, 0, 1, 1);
					context.fillStyle = value;
					context.fillRect(0, 0, 1, 1);
					const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
					return `rgb(${r}, ${g}, ${b})`;
				};
				const style = (name: string, pseudo?: string) => {
					const element = document.querySelector<HTMLElement>(`[data-contrast-probe="${name}"]`);
					if (!element) throw new Error(`Missing contrast probe: ${name}`);
					return getComputedStyle(element, pseudo);
				};
				const border = (name: string, side: "top" | "bottom" = "top") => {
					const value = style(name);
					return {
						color: toRgb(side === "top" ? value.borderTopColor : value.borderBottomColor),
						width: Number.parseFloat(
							side === "top" ? value.borderTopWidth : value.borderBottomWidth,
						),
						background: toRgb(value.backgroundColor),
					};
				};
				const focus = document.querySelector<HTMLElement>('[data-contrast-probe="focus"]');
				focus?.focus();
				const focusStyle = style("focus");
				const requiredStyle = style("required");
				const resultStyle = style("result");
				return {
					bodyBackground: toRgb(getComputedStyle(document.body).backgroundColor),
					control: border("control"),
					assessmentContainer: border("assessment-container"),
					table: border("table"),
					card: border("card"),
					tabStrip: border("tab-strip", "bottom"),
					divider: border("divider"),
					separator: border("separator"),
					selected: border("selected"),
					checked: border("checked"),
					error: border("error", "bottom"),
					note: border("note"),
					noteBackground: toRgb(style("note").backgroundColor),
					requiredOutlineWidth: Number.parseFloat(requiredStyle.outlineWidth),
					resultOutlineStyle: resultStyle.outlineStyle,
					resultOutlineWidth: Number.parseFloat(resultStyle.outlineWidth),
					focusOutlineColor: toRgb(focusStyle.outlineColor),
					focusOutlineWidth: Number.parseFloat(focusStyle.outlineWidth),
					veilContent: style("row", "::after").content,
					rowOpacity: style("row").opacity,
					proseLinkDecoration: style("prose-link").textDecorationLine,
					cardLinkDecoration: style("card-link").textDecorationLine,
				};
			});
		const defaults = await probeStyles();
		const defaultSelectedContrast = await computedContrast(selectedRow, "borderTopColor");

		await page.emulateMedia({ contrast: "more" });
		if (browserName === "firefox") {
			// Playwright 1.59 / firefox-1511 updates matchMedia for contrast emulation
			// without restyling existing sheets. A new document applies the preference.
			// Recreate the same probes and keep every contrast and axe assertion below.
			await page.reload({ waitUntil: "domcontentloaded" });
			await waitForHydration(page);
			await waitForAssessmentHydration(page);
			await addProbes();
		}
		expect(await page.evaluate(() => matchMedia("(prefers-contrast: more)").matches)).toBe(true);
		await expect(page.locator("html")).not.toHaveAttribute("data-praxity-high-contrast", "true");
		await expect(page.locator("html")).toHaveAttribute("data-praxity-focus-mode", "true");
		await expect
			.poll(() =>
				page
					.locator("[data-focus-row][data-focus-dimmed]")
					.evaluateAll((elements) =>
						elements.every((element) => getComputedStyle(element).opacity === "1"),
					),
			)
			.toBe(true);
		const strengthened = await probeStyles();
		const strengthenedSelectedContrast = await computedContrast(selectedRow, "borderTopColor");
		const ratio = (pair: { color: string; background: string }, fallbackBackground?: string) =>
			contrastRatio(rgbToHex(pair.color), rgbToHex(pair.background || fallbackBackground || ""));

		for (const category of ["control"] as const) {
			expect(strengthened[category].width, `${category} border weight`).toBeGreaterThanOrEqual(
				defaults[category].width,
			);
			expect(ratio(strengthened[category]), `${category} border contrast`).toBeGreaterThan(
				ratio(defaults[category]),
			);
		}
		expect(strengthened.selected.width, "selected state").toBeGreaterThanOrEqual(
			defaults.selected.width,
		);
		expect(
			strengthenedSelectedContrast,
			`selected state contrast: ${JSON.stringify(strengthened.selected)}`,
		).toBeGreaterThanOrEqual(3);
		expect(strengthenedSelectedContrast, "selected state contrast").toBeGreaterThanOrEqual(
			defaultSelectedContrast,
		);
		expect(strengthened.assessmentContainer.width, "assessment container").toBeGreaterThan(
			defaults.assessmentContainer.width,
		);
		expect(
			ratio(strengthened.assessmentContainer),
			"assessment container contrast",
		).toBeGreaterThanOrEqual(ratio(defaults.assessmentContainer));
		expect(strengthened.tabStrip.width, "tab strip rule").toBeGreaterThan(defaults.tabStrip.width);
		expect(strengthened.divider.width, "divider rule").toBeGreaterThan(defaults.divider.width);
		expect(strengthened.separator.width, "structural separator").toBeGreaterThan(
			defaults.separator.width,
		);
		expect(strengthened.checked.width, "checked control").toBeGreaterThan(defaults.checked.width);
		expect(strengthened.requiredOutlineWidth, "required state").toBeGreaterThan(
			defaults.requiredOutlineWidth,
		);
		expect(strengthened.error.width, "error state").toBeGreaterThan(defaults.error.width);
		expect(strengthened.resultOutlineStyle, "result state").toBe("solid");
		expect(strengthened.resultOutlineWidth, "result state").toBeGreaterThanOrEqual(
			defaults.resultOutlineWidth,
		);
		expect(strengthened.focusOutlineWidth, "focus indicator").toBeGreaterThan(
			defaults.focusOutlineWidth,
		);
		expect(
			contrastRatio(
				rgbToHex(strengthened.focusOutlineColor),
				rgbToHex(strengthened.bodyBackground),
			),
			"focus indicator contrast",
		).toBeGreaterThan(
			contrastRatio(rgbToHex(defaults.focusOutlineColor), rgbToHex(defaults.bodyBackground)),
		);
		expect(defaults.veilContent, "reading-guide veil").toBe("none");
		expect(defaults.rowOpacity, "reading-guide dimming").toBe("0.15");
		expect(strengthened.rowOpacity, "high-contrast reading guide").toBe("1");
		expect(strengthened.noteBackground).toBe(defaults.noteBackground);
		expect(strengthened.note.width).toBeGreaterThan(defaults.note.width);
		expect(strengthened.proseLinkDecoration).toContain("underline");
		expect(strengthened.cardLinkDecoration).toBe(defaults.cardLinkDecoration);
		await assertNoContrastViolations(page);
	});

	test("reading guide dims complete rows and restores the row on focus", async ({ page }) => {
		const baseUrl = readThemeVariantUrl(THEME_URLS.light);
		expect(baseUrl, "Missing light theme URL").toBeTruthy();
		if (!baseUrl) return;

		await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		await page.evaluate(() => {
			document.documentElement.dataset.praxityFocusMode = "true";
			document.documentElement.dataset.praxityMotionEntrance = "fade";
			document.querySelector("#main-content")?.insertAdjacentHTML(
				"beforeend",
				`<div class="praxity-block" data-entrance="visible" data-focus-row data-focus-dimmed data-reading-guide-probe>
					<iframe title="Media probe"></iframe>
					<div tabindex="0">Scrollable table probe</div>
				</div>`,
			);
		});

		const row = page.locator("[data-reading-guide-probe]");
		await expect(row).toHaveCSS("opacity", "0.15");
		expect(await row.evaluate((element) => getComputedStyle(element, "::after").content)).toBe(
			"none",
		);
		await row.locator("[tabindex='0']").focus();
		await expect(row).toHaveCSS("opacity", "1");
	});

	test("forced colors preserves structure and removes reading-guide dimming", async ({ page }) => {
		const baseUrl = readThemeVariantUrl(THEME_URLS.light);
		expect(baseUrl, "Missing light theme URL").toBeTruthy();
		if (!baseUrl) return;

		await page.emulateMedia({ forcedColors: "active" });
		await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		await page.evaluate(() => {
			document.documentElement.dataset.praxityFocusMode = "true";
			document.querySelector("#main-content")?.insertAdjacentHTML(
				"beforeend",
				`<div data-focus-row data-focus-dimmed data-contrast-probe="row"><p>Dimmed row</p></div>
				<div class="praxity-section-divider" data-contrast-probe="divider"></div>
				<div class="praxity-a11y-pill" data-contrast-probe="panel"><button type="button">Setting</button></div>
				<input class="mantine-TextInput-input" data-contrast-probe="input">`,
			);
		});
		if (!(await forcedPalette(page))) {
			const probes = page.locator("[data-contrast-probe], [data-contrast-probe=panel] button");
			await page.locator('[data-contrast-probe="panel"] button').focus();
			await expectForcedEmulationInert(page, [probes]);
			await expect(page.locator('[data-contrast-probe="row"]')).toHaveCSS("opacity", "0.15");
			await expectFocusRing(page.locator('[data-contrast-probe="panel"] button'), 2);
			return;
		}
		const styles = await page.evaluate(() => {
			const row = document.querySelector<HTMLElement>('[data-contrast-probe="row"]');
			const divider = document.querySelector<HTMLElement>('[data-contrast-probe="divider"]');
			const panel = document.querySelector<HTMLElement>('[data-contrast-probe="panel"]');
			const input = document.querySelector<HTMLElement>('[data-contrast-probe="input"]');
			const button = panel?.querySelector("button") ?? null;
			button?.focus();
			return {
				veilContent: row ? getComputedStyle(row, "::after").content : "",
				rowOpacity: row ? getComputedStyle(row).opacity : "",
				dividerBorder: divider ? getComputedStyle(divider).borderTopWidth : "",
				panelBorder: panel ? getComputedStyle(panel).borderTopWidth : "",
				inputBorder: input ? getComputedStyle(input).borderTopWidth : "",
				focusOutline: button ? getComputedStyle(button).outlineStyle : "",
				forcedColorAdjust: panel ? getComputedStyle(panel).forcedColorAdjust : "",
			};
		});

		expect(styles.veilContent).toBe("none");
		expect(styles.rowOpacity).toBe("1");
		expect(styles.dividerBorder).toBe("0px");
		expect(Number.parseFloat(styles.panelBorder)).toBeGreaterThanOrEqual(2);
		expect(Number.parseFloat(styles.inputBorder)).toBeGreaterThanOrEqual(2);
		expect(styles.focusOutline).toBe("solid");
		expect(styles.forcedColorAdjust).not.toBe("none");
	});
});
