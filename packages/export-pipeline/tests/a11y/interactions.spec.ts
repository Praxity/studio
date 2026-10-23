import { expect, type Locator, type Page } from "@playwright/test";
import { catalogSlug } from "../fixtures/authoring-catalog";
import {
	arrowRadio,
	expectFocusRing,
	expectForcedEmulationInert,
	expectNoFocusRing,
	expectUnclippedRing,
	forcedPalette,
} from "../focus-assertions";
import { test } from "../muted-test";
import { CONTAINER_SURFACE_STYLES } from "./fixtures/design-container-surfaces-fixture";
import {
	assertAxeScenario,
	findPageWithSelector,
	getCoursePages,
	readNavVariantUrl,
	readTestEnv,
	type TestEnv,
	waitForHydration,
} from "./helpers";

interface ChoiceAssessmentTarget {
	blockId: string;
	correctOptionId: string;
	wrongOptionId: string;
}

for (const width of [390, 1280]) {
	for (const larger of [false, true]) {
		for (const family of ["rate", "matrix"] as const) {
			test(`keyboard ${family} indicator survives arrows at ${width}, larger=${larger}`, async ({
				page,
			}, testInfo) => {
				await page.setViewportSize({ width, height: 900 });
				await page.addInitScript(
					(enabled) =>
						localStorage.setItem(
							"praxity-a11y",
							JSON.stringify({ textSize: enabled ? "large" : "default" }),
						),
					larger,
				);
				await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug(family)}.html`);
				const block = page.locator(
					family === "matrix" ? '[data-island="assessment"]' : '[data-island="rating"]',
				);
				await block.scrollIntoViewIfNeeded();
				await expect(block).toHaveAttribute("data-hydrated", "");
				const radios = block.getByRole("radio");
				await arrowRadio(page, radios.first(), radios.nth(1));
				const indicator =
					family === "rate" ? block.locator(".praxity-rating-option").nth(1) : radios.nth(1);
				await expectFocusRing(indicator, 2);
				await block.screenshot({ path: testInfo.outputPath(`${family}-focus.png`) });
				await page.keyboard.press("Tab");
				await expectNoFocusRing(indicator);
				await block.screenshot({ path: testInfo.outputPath(`${family}-selection.png`) });
			});
		}
		test(`keyboard responsive tabs retain unclipped rings at ${width}, larger=${larger}`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize({ width, height: 900 });
			await page.addInitScript(
				(enabled) =>
					localStorage.setItem(
						"praxity-a11y",
						JSON.stringify({ textSize: enabled ? "large" : "default" }),
					),
				larger,
			);
			await page.goto(`${readTestEnv().url}/authoring-catalog/catalog-focus-tabs.html`);
			const block = page.locator('[data-island="tabs"]');
			await block.scrollIntoViewIfNeeded();
			await expect(block).toHaveAttribute("data-hydrated", "");

			if (
				(await block.locator(".praxity-tabs-static").getAttribute("data-disclosure")) === "true"
			) {
				const buttons = block.locator(".praxity-tabs-tab");
				expect(await buttons.count()).toBeGreaterThan(1);
				await expect(block.getByRole("tablist")).toHaveCount(0);
				for (const button of await buttons.all()) {
					await expect(button).toBeVisible();
					await button.focus();
					await page.keyboard.press("Enter");
					await expectFocusRing(button, 2);
					expect(await button.evaluate((element) => getComputedStyle(element).outlineOffset)).toBe(
						"2px",
					);
					await expectUnclippedRing(button);
					expect(
						await block.locator('.praxity-tabs-tab[aria-expanded="true"]').count(),
					).toBeLessThanOrEqual(1);
				}
				await block.screenshot({ path: testInfo.outputPath("tabs-focus.png") });
				return;
			}
			const tabs = block.getByRole("tab");
			const list = block.getByRole("tablist");
			expect(await list.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
			for (const tab of await tabs.all()) {
				await tab.focus();
				await page.keyboard.press("ArrowRight");
				const focused = block.locator('[role="tab"]:focus');
				await expectFocusRing(focused, 2);
				expect(await focused.evaluate((element) => getComputedStyle(element).outlineOffset)).toBe(
					"2px",
				);
				await expectUnclippedRing(focused);
			}
			await block.screenshot({ path: testInfo.outputPath("tabs-focus.png") });
		});
	}
}

test("keyboard checklist and media use one themed control ring", async ({ page }) => {
	for (const [keyword, selector] of [
		["checklist", 'input[type="checkbox"]'],
		["choose-many", 'input[type="checkbox"]'],
		["accordion", "[data-disclosure-trigger]"],
		["audio", ".praxity-narration-transport button"],
		["video", "video"],
	]) {
		await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug(keyword)}.html`);
		if (keyword === "choose-many") {
			const assessment = page.locator('[data-island="assessment"]');
			await assessment.scrollIntoViewIfNeeded();
			await expect(assessment).toHaveAttribute("data-hydrated", "");
		}
		const target = page.locator(selector).first();
		await target.scrollIntoViewIfNeeded();
		await target.focus();
		await page.keyboard.press("Shift+Tab");
		await page.keyboard.press("Tab");
		// Native media may put Tab focus on an internal player control.
		if (keyword === "audio" || keyword === "video") await target.focus();
		if (keyword === "choose-many") {
			await expectFocusRing(page.locator(".praxity-assessment-choice-option").first(), 2);
			await expectNoFocusRing(target);
		} else await expectFocusRing(target, 2, keyword === "accordion");
		if (keyword === "accordion") {
			await expectUnclippedRing(target);
		}
	}
});

for (const width of [320, 1280]) {
	for (const mode of ["light", "dark"]) {
		for (const forcedColors of ["none", "active"] as const) {
			test(`keyboard accordion keeps aligned text and an unclipped ring at ${width}, ${mode}, forced=${forcedColors}`, async ({
				page,
				browserName,
			}, testInfo) => {
				await page.setViewportSize({ width, height: 900 });
				await page.emulateMedia({ forcedColors });
				await page.goto(
					`${readTestEnv().url}/design-container-surfaces-${mode}/container-surfaces.html`,
				);
				for (const style of CONTAINER_SURFACE_STYLES) {
					const accordion = page.locator(`.praxity-accordion-static[data-style="${style}"]`);
					const summary = accordion.locator("[data-disclosure-trigger]").first();
					await summary.scrollIntoViewIfNeeded();
					const before = await summary.boundingBox();
					await summary.focus();
					await page.keyboard.press("Shift+Tab");
					await page.keyboard.press("Tab");
					await expect(summary).toBeFocused();
					await page.keyboard.press("Enter");
					await expect(summary).toHaveAttribute("aria-expanded", "true");
					const alignment = await summary.evaluate((element) => {
						const title = element.querySelector(".praxity-disclosure-title");
						const paragraph = element
							.closest("[data-accordion-item]")
							?.querySelector(".praxity-accordion-panel p");
						if (!title || !paragraph) throw new Error("Missing accordion title or body");
						return title.getBoundingClientRect().left - paragraph.getBoundingClientRect().left;
					});
					// Section 5 places the leading 24px chevron and 8px gap before the title.
					expect(alignment).toBeCloseTo(32, 0);
					if (forcedColors === "active" && !(await forcedPalette(page))) {
						await expectForcedEmulationInert(page, [summary]);
						await expectFocusRing(summary, 2, true);
					} else {
						// Published buttons keep the thicker forced-color ring and native palette mapping.
						await expectFocusRing(
							summary,
							forcedColors === "active" ? 3 : 2,
							true,
							browserName === "chromium" ? "Highlight" : "CanvasText",
						);
					}
					await expectUnclippedRing(summary);
					const after = await summary.boundingBox();
					expect(after?.x).toBe(before?.x);
					expect(after?.width).toBe(before?.width);
					await accordion.screenshot({ path: testInfo.outputPath(`accordion-${style}-focus.png`) });
				}
			});
		}
	}
}

test("keyboard forced colors distinguishes selected rating from focused rating", async ({
	page,
}) => {
	await page.emulateMedia({ forcedColors: "active" });
	await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("rate")}.html`);
	const block = page.locator('[data-island="rating"]');
	await block.scrollIntoViewIfNeeded();
	await expect(block).toHaveAttribute("data-hydrated", "");
	const radios = block.getByRole("radio");
	await arrowRadio(page, radios.first(), radios.nth(1));
	const indicator = block.locator(".praxity-rating-option").nth(1);
	await expectFocusRing(indicator, 2);
	await page.keyboard.press("Tab");
	await expectNoFocusRing(indicator);
	await expect(radios.nth(1)).toBeChecked();
	if (!(await forcedPalette(page))) {
		await expectForcedEmulationInert(page, [block.locator(".praxity-rating-option")]);
	} else {
		const selectionBorders = await block.locator(".praxity-rating-option").evaluateAll((labels) =>
			labels.map((label) => {
				const style = getComputedStyle(label);
				return { width: Number.parseFloat(style.borderTopWidth), style: style.borderTopStyle };
			}),
		);
		expect(selectionBorders[1]).toEqual({ width: 2, style: "solid" });
		expect(selectionBorders[0].width).toBeLessThan(selectionBorders[1].width);
	}
});

test("keyboard forced colors retains one choice row ring and inset tab ring", async ({ page }) => {
	await page.emulateMedia({ forcedColors: "active" });
	await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("choose-one")}.html`);
	const block = page.locator('[data-island="assessment"]');
	await block.scrollIntoViewIfNeeded();
	await expect(block).toHaveAttribute("data-hydrated", "");
	const radios = block.getByRole("radio");
	await arrowRadio(page, radios.first(), radios.nth(1));
	if (!(await forcedPalette(page)))
		await expectForcedEmulationInert(page, [
			block.locator(".praxity-assessment-choice-option").nth(1),
			radios.nth(1),
		]);
	await expectFocusRing(
		block.locator(".praxity-assessment-choice-option").nth(1),
		2,
		false,
		"Highlight",
	);
	await expectNoFocusRing(radios.nth(1));
	await page.goto(`${readTestEnv().url}/authoring-catalog/catalog-focus-tabs.html`);
	const tabs = page.locator('[data-island="tabs"]');
	await tabs.scrollIntoViewIfNeeded();
	await expect(tabs).toHaveAttribute("data-hydrated", "");
	await tabs.getByRole("tab").first().focus();
	if (!(await forcedPalette(page))) {
		await expectForcedEmulationInert(page, [tabs.getByRole("tab").first()]);
		await expectFocusRing(tabs.getByRole("tab").first(), 2);
	} else {
		await expectFocusRing(tabs.getByRole("tab").first(), 3, true, "Highlight");
	}
	await expectUnclippedRing(tabs.getByRole("tab").first());
});

for (const mode of ["light", "dark"]) {
	test(`keyboard forced colors suppresses the inner choose-many ring in ${mode} mode`, async ({
		page,
	}) => {
		await page.emulateMedia({ forcedColors: "active" });
		await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("choose-many")}.html`);
		await page.locator("html").evaluate((root, mode) => {
			root.dataset.praxityMode = mode;
		}, mode);
		const block = page.locator('[data-island="assessment"]');
		await block.scrollIntoViewIfNeeded();
		await expect(block).toHaveAttribute("data-hydrated", "");
		const checkbox = block.getByRole("checkbox").first();
		await checkbox.focus();
		await page.keyboard.press("Shift+Tab");
		await page.keyboard.press("Tab");
		await expect(checkbox).toBeFocused();
		const row = block.locator(".praxity-assessment-choice-option").first();
		if (!(await forcedPalette(page))) await expectForcedEmulationInert(page, [row, checkbox]);
		await expectFocusRing(row, 2, false, "Highlight");
		await expectNoFocusRing(checkbox);
	});
}

for (const mode of ["light", "dark"]) {
	test(`keyboard prefers-contrast more suppresses the inner choose-many ring in ${mode} mode`, async ({
		page,
	}) => {
		await page.emulateMedia({ forcedColors: "none", contrast: "more" });
		await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("choose-many")}.html`);
		await page.locator("html").evaluate((root, mode) => {
			root.dataset.praxityMode = mode;
		}, mode);
		const block = page.locator('[data-island="assessment"]');
		await block.scrollIntoViewIfNeeded();
		await expect(block).toHaveAttribute("data-hydrated", "");
		const checkbox = block.getByRole("checkbox").first();
		await checkbox.focus();
		await page.keyboard.press("Shift+Tab");
		await page.keyboard.press("Tab");
		await expect(checkbox).toBeFocused();
		const row = block.locator(".praxity-assessment-choice-option").first();
		await expectFocusRing(row, 2);
		await expectNoFocusRing(checkbox);
	});
}

let env: TestEnv;

function prevNavCandidates(page: Page): Locator[] {
	return [
		page.locator("a.praxity-nav-prev[href]").first(),
		page.locator(".praxity-page-nav button[aria-label*='Previous page']:not([disabled])").first(),
		page.locator(".praxity-embed-nav button[aria-label*='Previous page']:not([disabled])").first(),
		page.locator(".praxity-slide-nav__arrow--prev:not([disabled])").first(),
	];
}

function nextNavCandidates(page: Page): Locator[] {
	return [
		page.locator("a.praxity-nav-next[href]").first(),
		page.locator(".praxity-page-nav button[aria-label*='Next page']:not([disabled])").first(),
		page.locator(".praxity-embed-nav button[aria-label*='Next page']:not([disabled])").first(),
		page.locator(".praxity-slide-nav__arrow--next:not([disabled])").first(),
	];
}

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
	for (const candidate of candidates) {
		if ((await candidate.count()) === 0) continue;
		if (await candidate.isVisible().catch(() => false)) {
			return candidate;
		}
	}
	return null;
}

async function clickFirstVisible(candidates: Locator[]): Promise<boolean> {
	const target = await firstVisible(candidates);
	if (!target) return false;
	await target.click();
	return true;
}

async function hasVisible(candidates: Locator[]): Promise<boolean> {
	return (await firstVisible(candidates)) !== null;
}

async function readChoiceAssessmentTargetFromConfig(
	page: Page,
): Promise<ChoiceAssessmentTarget | null> {
	return page.evaluate(() => {
		const configText = document.getElementById("praxity-config")?.textContent;
		if (!configText) return null;

		try {
			const parsed = JSON.parse(configText) as {
				blocks?: Array<{
					id?: string;
					type?: string;
					data?: {
						assessmentType?: string;
						gradingMode?: string;
						graded?: boolean;
						response?: {
							type?: string;
							selectionMode?: string;
							options?: Array<{ id?: string; isCorrect?: boolean }>;
						};
					};
				}>;
			};

			for (const block of parsed.blocks ?? []) {
				if (block.type !== "assessment" || typeof block.id !== "string") continue;
				if (block.data?.assessmentType !== "choice") continue;
				if (block.data.response?.type !== "choice") continue;
				if (block.data.response?.selectionMode === "multiple") continue;
				// data-passed/data-score only exist on graded assessments; knowledge
				// checks deliberately omit them (AssessmentBlock.tsx:1370).
				const gradingMode = block.data.gradingMode ?? (block.data.graded ? "exact" : "none");
				if (gradingMode === "none") continue;

				const options = block.data.response.options ?? [];
				const correct = options.find((opt) => opt.isCorrect === true && typeof opt.id === "string");
				const wrong = options.find((opt) => opt.isCorrect !== true && typeof opt.id === "string");
				if (!correct?.id || !wrong?.id) continue;

				return {
					blockId: block.id,
					correctOptionId: correct.id,
					wrongOptionId: wrong.id,
				};
			}
		} catch {
			return null;
		}
		return null;
	});
}

async function locateInputByValue(block: Locator, optionId: string): Promise<Locator> {
	const inputs = block.locator("input[type='radio'], input[type='checkbox']");
	const index = await inputs.evaluateAll(
		(elements, target) => elements.findIndex((el) => (el as HTMLInputElement).value === target),
		optionId,
	);
	if (index < 0) {
		throw new Error(`Assessment option input '${optionId}' was not rendered`);
	}
	return inputs.nth(index);
}

test.describe("interactions", () => {
	test.beforeAll(() => {
		env = readTestEnv();
	});

	test("assessment choice supports wrong and correct submission flows", async ({ page }) => {
		const baseUrl = readNavVariantUrl("sidebar");
		expect(baseUrl, "Missing sidebar fixture URL").toBeTruthy();
		if (!baseUrl) {
			throw new Error("Missing sidebar fixture URL");
		}

		await page.goto(`${baseUrl}/page-3.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);

		const target = await readChoiceAssessmentTargetFromConfig(page);
		expect(target, "Known assessment fixture is missing its single-select choice").not.toBeNull();
		if (!target) {
			throw new Error("Known assessment fixture is missing its single-select choice");
		}

		// The static wrapper from render-block-html.ts and the hydrated React Card
		// share the .praxity-block-assessment class, so .first() would match the
		// wrapper, which never carries the graded attributes. data-assessment-display
		// is set only by the Card (AssessmentBlock.tsx:1369).
		const block = page
			.locator(
				`.praxity-block-assessment[data-block-id='${target.blockId}'][data-assessment-display]`,
			)
			.first();
		await expect(block).toBeVisible();
		await expect(
			block.locator('[data-doodle="highlight"][data-doodle-mods="red"]', {
				hasText: "Correct answer",
			}),
		).toBeVisible();
		await expect(block).not.toContainText("@highlight.red");
		await expect(block.getByRole("radio", { name: "Correct answer" })).toBeVisible();

		const wrongInput = await locateInputByValue(block, target.wrongOptionId);
		await wrongInput.check();
		await expect(wrongInput).toBeChecked();

		const submit = block
			.locator("[data-assessment-submit='true']:visible")
			.or(page.locator("button.praxity-ag-submit-btn:visible"))
			.first();
		await expect(submit).toBeVisible();
		await submit.focus();
		await page.keyboard.press("Enter");
		await expect(block).toHaveAttribute("data-passed", "false");
		const feedback = block.locator("[data-assessment-feedback]");
		await expect(
			feedback
				.locator("[data-assessment-retry]")
				.or(block.locator("[data-assessment-continue]"))
				.first(),
		).toBeFocused();
		await expect(feedback.locator("[data-assessment-status]")).toHaveText("1 of 2 attempts used");
		await expect(feedback).not.toBeEmpty();
		await expect(feedback).toHaveCSS("outline-style", "none");

		const retry = block.getByRole("button", { name: /try again/i });
		await expect(retry).toBeVisible();
		await expect(retry).toBeFocused();
		// Keep the keyboard ring check after the new submission focus assertion.
		await page.keyboard.press("Tab");
		await page.keyboard.press("Shift+Tab");
		await expect(retry).toBeFocused();
		await expectFocusRing(retry, 2);
		await retry.click();

		const correctInput = await locateInputByValue(block, target.correctOptionId);
		await correctInput.check();
		await expect(correctInput).toBeChecked();

		const submitRetry = block
			.locator("[data-assessment-submit='true']:visible")
			.or(page.locator("button.praxity-ag-submit-btn:visible"))
			.first();
		await expect(submitRetry).toBeVisible();
		await submitRetry.click();
		await expect(block).toHaveAttribute("data-passed", "true");
	});

	test("assessment choice row padding activates its native input", async ({ page }) => {
		const baseUrl = readNavVariantUrl("sidebar");
		expect(baseUrl, "Missing sidebar fixture URL").toBeTruthy();
		if (!baseUrl) throw new Error("Missing sidebar fixture URL");

		await page.goto(`${baseUrl}/page-3.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		const target = await readChoiceAssessmentTargetFromConfig(page);
		expect(target).not.toBeNull();
		if (!target) return;

		const block = page
			.locator(
				`.praxity-block-assessment[data-block-id='${target.blockId}'][data-assessment-display]`,
			)
			.first();
		await expect(block).toBeVisible();
		const input = await locateInputByValue(block, target.wrongOptionId);
		const row = input.locator(
			"xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' praxity-assessment-choice-option ')][1]",
		);
		const box = await row.boundingBox();
		expect(box).not.toBeNull();
		if (!box) return;

		await row.click({ position: { x: box.width - 4, y: 4 } });
		await expect(input).toBeChecked();
	});

	test("matching uses a labelled keyboard combobox", async ({ page }) => {
		const baseUrl = readNavVariantUrl("sidebar");
		expect(baseUrl, "Missing sidebar fixture URL").toBeTruthy();
		if (!baseUrl) throw new Error("Missing sidebar fixture URL");

		await page.goto(`${baseUrl}/page-3.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);

		const select = page.getByRole("combobox", { name: "Match for: Chemical splash" });
		await expect(select).toHaveJSProperty("tagName", "INPUT");
		await expect(select).toHaveAttribute("aria-expanded", "false");
		await expect(select).not.toHaveAttribute("aria-controls");
		await expect(select).toHaveValue("");

		await select.focus();
		await expect(select).toBeFocused();
		await select.press("ArrowDown");
		await expect(select).toHaveAttribute("aria-expanded", "true");
		await expect(select).toHaveAttribute("aria-controls", /.+/);
		const listboxId = await select.getAttribute("aria-controls");
		expect(listboxId).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
		await expect(page.locator(`[id="${listboxId}"]`)).toHaveAttribute("role", "listbox");
		await expect(page.locator(`[id="${listboxId}"]`)).toBeVisible();
		await select.press("ArrowDown");
		await select.press("Enter");
		await expect(select).toHaveValue("Face shield");
		await select.click();
		await page.getByRole("option", { name: "Guardrail" }).click();
		await expect(select).toHaveValue("Guardrail");
	});

	test("Submit all commits three members, updates group progress, and announces results", async ({
		page,
	}) => {
		const baseUrl = readNavVariantUrl("sidebar");
		expect(baseUrl, "Missing sidebar fixture URL").toBeTruthy();
		if (!baseUrl) throw new Error("Missing sidebar fixture URL");

		await page.goto(`${baseUrl}/page-3.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);

		await page.getByRole("radio", { name: "Correct answer" }).check();
		const chemicalMatch = page.getByRole("combobox", { name: "Match for: Chemical splash" });
		const matchingBlock = chemicalMatch.locator("xpath=ancestor::*[@data-assessment-display][1]");
		await chemicalMatch.click();
		await page.getByRole("option", { name: "Face shield", exact: true }).click();
		const fallMatch = page.getByRole("combobox", { name: "Match for: Fall risk" });
		await fallMatch.click();
		await page.getByRole("option", { name: "Face shield", exact: true }).click();
		await page.getByRole("radio", { name: "Stop work" }).check();

		await page.getByRole("button", { name: "Submit all" }).click();
		await expect(
			matchingBlock.locator('.praxity-matching-result[data-result="correct"]'),
		).toHaveText("Correct");
		await expect(
			matchingBlock.locator('.praxity-matching-result[data-result="incorrect"]'),
		).toHaveText("Incorrect");
		await expect(chemicalMatch).toBeDisabled();
		await expect(fallMatch).toBeDisabled();
		await assertAxeScenario(page, "matching-results");

		await expect(
			page.locator(".praxity-block-assessment[data-assessment-display][data-completed='true']"),
		).toHaveCount(3);
		const group = page.locator("[data-assessment-group-header]").first();
		const groupedAssessments = page.locator(".praxity-block-assessment[data-assessment-group]");
		await expect(group.locator('[data-doodle="highlight"]')).toHaveText("Combined assessment");
		await expect(group).not.toContainText("@highlight");
		await expect(groupedAssessments.nth(0)).toHaveClass(/praxity-layout-wide/);
		// The group owns one coherent width, including members with an explicit layout.
		await expect(groupedAssessments.nth(1)).toHaveClass(/praxity-layout-wide/);
		await expect(groupedAssessments.nth(1)).not.toHaveClass(/praxity-layout-full/);
		await expect(groupedAssessments.nth(2)).toHaveClass(/praxity-layout-wide/);
		await expect(page.locator(".praxity-assessment-group-submit")).toHaveClass(
			/praxity-layout-wide/,
		);
		await expect(group.getByText("Questions completed: 3 of 3")).toBeVisible();
		await expect(group).toHaveAccessibleName(/Questions completed: 3 of 3/);
		await expect(page.getByRole("button", { name: "Submit all" })).toHaveCount(0);
		const summary = page.locator(".praxity-assessment-group-submit .praxity-ag-results-score");
		await expect(summary).toContainText(/2 of 3 correct.*Score: 67% - Passed/);
		await expect(summary).not.toHaveAttribute("role");
		await expect(summary).toHaveAccessibleName("");
		await expect
			.poll(() =>
				summary.evaluate(
					(element) =>
						document.activeElement === element ||
						document.activeElement?.getAttribute("aria-describedby") ===
							element.firstElementChild?.id,
				),
			)
			.toBe(true);
		await expect(page.locator("[data-assessment-group-status]")).toHaveText("");
	});

	test("typing in an autosizing assessment does not repaint doodles", async ({ page }) => {
		const baseUrl = readNavVariantUrl("sidebar");
		expect(baseUrl).toBeTruthy();
		if (!baseUrl) return;

		await page.goto(`${baseUrl}/page-3.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		const decoration = page.locator(".praxity-doodle").first();
		await expect(decoration).toBeAttached();
		const assessment = page
			.locator('[data-island="assessment"]')
			.filter({ has: page.locator("textarea") })
			.first();
		await assessment.scrollIntoViewIfNeeded();
		await expect(assessment).toHaveAttribute("data-hydrated", "");
		const textarea = assessment.locator("textarea").first();
		await page.clock.install();
		await decoration.evaluate((node) => {
			(window as typeof window & { __praxityDoodleProbe?: Element }).__praxityDoodleProbe = node;
		});

		await textarea.pressSequentially("A response that grows the field.");
		await expect(textarea).toHaveValue("A response that grows the field.");
		// Let autosizing settle before checking the inline decoration.
		await page.clock.runFor(200);

		expect(
			await page.evaluate(() => {
				const probe = (window as typeof window & { __praxityDoodleProbe?: Element })
					.__praxityDoodleProbe;
				return probe?.isConnected && document.querySelector(".praxity-doodle") === probe;
			}),
		).toBe(true);
	});

	test("accordion toggles open and closed", async ({ page }) => {
		const pages = await getCoursePages(page, env.url);
		const accordionPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='accordion'] [data-disclosure-trigger]",
		);
		if (!accordionPage) throw new Error("No accordion block found in fixture");

		const trigger = page.locator("[data-block-type='accordion'] [data-disclosure-trigger]").first();
		const accordionIsland = page.locator('[data-island="accordion"]').first();
		await accordionIsland.scrollIntoViewIfNeeded();
		await expect(accordionIsland).toHaveAttribute("data-hydrated", "");
		await expect(trigger).toBeVisible();

		await expect(trigger).toHaveAttribute("aria-expanded", "false");
		await trigger.click();
		await expect(trigger).toHaveAttribute("aria-expanded", "true");
		await trigger.click();
		await expect(trigger).toHaveAttribute("aria-expanded", "false");
	});

	test("tabs switch active tab and maintain panel linkage", async ({ page }) => {
		const pages = await getCoursePages(page, env.url);
		const tabsPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='tabs'] [role='tab']",
		);
		if (!tabsPage) throw new Error("No tabs block found in fixture");

		const tabsIsland = page.locator('[data-island="tabs"]').first();
		await tabsIsland.scrollIntoViewIfNeeded();
		await expect(tabsIsland).toHaveAttribute("data-hydrated", "");
		const tabs = page.locator("[data-block-type='tabs'] [role='tab']");
		await expect(tabs).toHaveCount(await tabs.count());
		const count = await tabs.count();
		expect(count).toBeGreaterThan(1);

		const firstTab = tabs.first();
		const secondTab = tabs.nth(1);
		await expect(secondTab).toBeVisible();
		await secondTab.click();

		const secondControls = await secondTab.getAttribute("aria-controls");
		expect(secondControls, "second tab missing aria-controls").toBeTruthy();
		if (!secondControls) return;

		const secondPanel = page.locator(`[id="${secondControls}"]`);
		await expect(secondPanel).toBeVisible();

		const firstSelected = await firstTab.getAttribute("aria-selected");
		const secondSelected = await secondTab.getAttribute("aria-selected");
		if (firstSelected !== null && secondSelected !== null) {
			expect(secondSelected).toBe("true");
			expect(firstSelected).toBe("false");
		}

		const firstControls = await firstTab.getAttribute("aria-controls");
		if (!firstControls) return;
		const firstPanel = page.locator(`[id="${firstControls}"]`).first();
		const firstPanelVisibility = await firstPanel.isVisible().catch(() => false);
		const secondPanelVisibility = await secondPanel.isVisible().catch(() => false);
		expect(secondPanelVisibility).toBe(true);

		const hasHiddenSemantics = await page.evaluate((panelId) => {
			const panel = document.getElementById(panelId);
			if (!panel) return false;
			if (panel.hasAttribute("hidden")) return true;
			const ariaHidden = panel.getAttribute("aria-hidden");
			if (ariaHidden === "true" || ariaHidden === "false") return true;
			const style = window.getComputedStyle(panel);
			return style.display === "none";
		}, firstControls);
		if (hasHiddenSemantics) {
			expect(firstPanelVisibility).toBe(false);
		}
	});

	test("checklist item can be toggled", async ({ page }) => {
		const pages = await getCoursePages(page, env.url);
		const checklistPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='checklist'] input[type='checkbox']",
		);
		if (!checklistPage) throw new Error("No checklist block found in fixture");

		const firstItem = page.locator("[data-block-type='checklist'] input[type='checkbox']").first();
		await expect(firstItem).toBeVisible();
		await firstItem.check();
		await expect(firstItem).toBeChecked();

		const checklistState = await firstItem.evaluate((input) => {
			const itemEl = input.closest("[data-checklist-item]");
			return {
				checked: (input as HTMLInputElement).checked,
				markedChecked: itemEl?.hasAttribute("data-checked") ?? false,
			};
		});
		expect(checklistState.checked || checklistState.markedChecked).toBe(true);
	});

	test("glossary terms expose and dismiss their associated definition", async ({ page }) => {
		const pages = await getCoursePages(page, env.url);
		const glossaryPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			".inline-tooltip-trigger",
		);
		if (!glossaryPage) throw new Error("No inline glossary term found in fixture");

		const trigger = page.locator(".inline-tooltip-trigger").first();
		await expect(trigger).toHaveAttribute("role", "button");
		await expect(trigger).toHaveAttribute("tabindex", "0");
		expect(
			await trigger.evaluate(
				(element) => element.closest('.praxity-doodle[data-doodle="highlight"]') !== null,
			),
		).toBe(true);
		expect(await trigger.evaluate((element) => getComputedStyle(element).textDecorationStyle)).toBe(
			"dotted",
		);

		await trigger.focus();
		await trigger.press("Enter");
		const definition = page.locator('.inline-tooltip-popover[role="definition"]').first();
		await expect(definition).toBeVisible();
		await expect(trigger).toHaveAccessibleDescription(
			"Personal Protective Equipment — gear that protects the wearer from injury.",
		);

		await trigger.press("Escape");
		await expect(definition).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	test("page navigation lifecycle supports next/previous boundaries", async ({ page }) => {
		const pages = await getCoursePages(page, env.url);
		expect(pages.length).toBeGreaterThan(1);

		const first = pages[0];
		const last = pages[pages.length - 1];
		expect(first?.slug).toBeTruthy();
		expect(last?.slug).toBeTruthy();
		if (!first?.slug || !last?.slug) return;

		await page.goto(`${env.url}/${first.slug}.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		expect(
			await hasVisible(prevNavCandidates(page)),
			"first page should not have active previous",
		).toBe(false);

		for (let i = 1; i < pages.length; i++) {
			const beforePath = new URL(page.url()).pathname;
			// A page may switch its chrome off with `nav: minimal` / `nav: none`, a
			// page-break param added after this walk was written. Those pages have no
			// next control to click, so step over them by URL rather than assert one
			// exists — the rest of the lifecycle is still what this test is for.
			const layoutClass = await page.evaluate(() => document.body.className);
			if (/praxity-layout-(minimal|none)\b/.test(layoutClass)) {
				await page.goto(`${env.url}/${pages[i].slug}.html`, { waitUntil: "domcontentloaded" });
				await waitForHydration(page);
				expect(new URL(page.url()).pathname).not.toBe(beforePath);
				continue;
			}
			const requiredChecklist = page
				.locator('[data-block-type="checklist"][data-required="true"]')
				.first();
			const hasRequiredChecklist = await requiredChecklist.isVisible().catch(() => false);
			if (hasRequiredChecklist) {
				await requiredChecklist.scrollIntoViewIfNeeded();
				await expect(requiredChecklist).toHaveAttribute("data-hydrated", "");
			}
			if (
				hasRequiredChecklist &&
				(await requiredChecklist.getAttribute("data-completed")) === "false"
			) {
				const blockedControl = await firstVisible(nextNavCandidates(page));
				expect(blockedControl, `missing usable next control at required step ${i}`).not.toBeNull();
				await blockedControl?.click();
				expect(new URL(page.url()).pathname).toBe(beforePath);
				const firstItem = requiredChecklist.locator('input[type="checkbox"]').first();
				await expect(firstItem).toBeFocused();
				await expect(firstItem).toHaveAttribute("aria-invalid", "true");
				await expect(firstItem).toHaveAttribute("aria-required", "true");
				await expect(page.locator(".praxity-required-message")).toHaveAttribute("role", "alert");
				for (const checkbox of await requiredChecklist.locator('input[type="checkbox"]').all()) {
					await checkbox.check();
				}
				await expect(requiredChecklist).toHaveAttribute("data-completed", "true");
				expect(
					await page.locator('[data-required="true"]').evaluateAll((elements) =>
						elements.map((element) => ({
							completed: element.getAttribute("data-completed"),
							type: element.getAttribute("data-block-type"),
						})),
					),
				).toEqual([{ completed: "true", type: "checklist" }]);
			}
			const moved = await clickFirstVisible(nextNavCandidates(page));
			expect(moved, `missing usable next control at step ${i}`).toBe(true);
			await page.waitForURL(`${env.url}/${pages[i].slug}.html`, {
				waitUntil: "domcontentloaded",
			});
			await waitForHydration(page);
			const afterPath = new URL(page.url()).pathname;
			expect(afterPath).not.toBe(beforePath);
		}

		expect(new URL(page.url()).pathname).toContain(`/${last.slug}.html`);
		expect(await hasVisible(nextNavCandidates(page)), "last page should not have active next").toBe(
			false,
		);

		for (let i = pages.length - 1; i >= 1; i--) {
			const beforePath = new URL(page.url()).pathname;
			// Same as the forward walk: a chromeless page has no control to click.
			const layoutClass = await page.evaluate(() => document.body.className);
			if (/praxity-layout-(minimal|none)\b/.test(layoutClass)) {
				await page.goto(`${env.url}/${pages[i - 1].slug}.html`, {
					waitUntil: "domcontentloaded",
				});
				await waitForHydration(page);
				expect(new URL(page.url()).pathname).not.toBe(beforePath);
				continue;
			}
			const moved = await clickFirstVisible(prevNavCandidates(page));
			expect(moved, `missing usable previous control at step ${i}`).toBe(true);
			await page.waitForURL(`${env.url}/${pages[i - 1].slug}.html`, {
				waitUntil: "domcontentloaded",
			});
			await waitForHydration(page);
			const afterPath = new URL(page.url()).pathname;
			expect(afterPath).not.toBe(beforePath);
		}

		expect(new URL(page.url()).pathname).toContain(`/${first.slug}.html`);
		expect(
			await hasVisible(prevNavCandidates(page)),
			"first page should not have active previous",
		).toBe(false);
	});
});
