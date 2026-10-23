import { expect, test } from "@playwright/test";
import { catalogSlug } from "../fixtures/authoring-catalog";
import { arrowRadio, expectFocusRing, expectNoFocusRing } from "../focus-assertions";
import { ASSESSMENT_REVIEW_THEMES } from "./fixtures/assessment-review-fixture";
import { readTestEnv } from "./helpers";
import { expectSubmittedReview } from "./review-assertions";

test.use({ screenshot: { mode: "only-on-failure", fullPage: true } });

test.describe(() => {
	// Each theme owns a fresh page/context; CI can schedule complete journeys independently.
	test.describe.configure({ mode: "parallel" });
	for (const theme of ASSESSMENT_REVIEW_THEMES) {
		test(`submitted review colors in ${theme.name}`, async ({ page }, testInfo) => {
			test.setTimeout(90_000);
			await page.goto(`${readTestEnv().url}/review-${theme.name}/index.html`);
			const islands = page.locator('[data-island="assessment"]');
			await expect(islands).toHaveCount(6);
			for (const island of await islands.all()) {
				// Native scrolling triggers lazy hydration; the learner actions still check actionability.
				await island.evaluate((element) =>
					element.scrollIntoView({ block: "center", behavior: "instant" }),
				);
				await expect(island).toHaveAttribute("data-hydrated", "");
				const radios = island.getByRole("radio");
				const checkboxes = island.getByRole("checkbox");
				const selects = island.getByRole("combobox");
				if (await selects.count()) {
					for (const select of await selects.all()) {
						await select.click();
						await page.getByRole("option", { name: "Right item 2", exact: true }).click();
					}
				} else if (await radios.count()) {
					// Table rows each own a group; choice owns one group.
					const rows = island.locator("tbody tr");
					if (await rows.count())
						for (const row of await rows.all()) await row.getByRole("radio").first().check();
					else await radios.first().check();
				} else if (await checkboxes.count()) await checkboxes.first().check();
				else await island.getByRole("button", { name: "Correct area" }).click();
				await island.locator("[data-assessment-submit]").click();
			}
			const waitForPaint = async () => {
				await page.evaluate(
					() =>
						new Promise<void>((resolve) =>
							requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
						),
				);
				await expect
					.poll(() =>
						islands.evaluateAll((elements) =>
							elements.some((element) =>
								element
									.getAnimations({ subtree: true })
									.some((animation) => animation.playState === "running"),
							),
						),
					)
					.toBe(false);
			};
			await waitForPaint();
			const reviewStates: Array<{
				width: number;
				larger: boolean;
				forcedColors: boolean;
				islands: Awaited<ReturnType<typeof expectSubmittedReview>>;
			}> = [];
			// Preferences apply to the whole document. Submit once, then inspect all islands per state.
			for (const width of [390, 1280]) {
				await page.setViewportSize({ width, height: 900 });
				for (const larger of [false, true]) {
					await test.step(`review at ${width}, larger=${larger}`, async () => {
						const textSize = page.locator('[data-a11y-action="text"]');
						if ((await textSize.getAttribute("aria-pressed")) !== String(larger)) {
							await expect(textSize).toBeVisible();
							await textSize.press("Enter");
						}
						await expect(textSize).toHaveAttribute("aria-pressed", String(larger));
						await waitForPaint();
						// Element screenshots required visible, nonempty bounds; retain that guard without encoding PNGs.
						for (const island of await islands.all()) await expect(island).toBeVisible();
						reviewStates.push({
							width,
							larger,
							forcedColors: false,
							islands: await expectSubmittedReview(islands),
						});
						await page.emulateMedia({ forcedColors: "active" });
						await waitForPaint();
						reviewStates.push({
							width,
							larger,
							forcedColors: true,
							islands: await expectSubmittedReview(islands),
						});
						await page.emulateMedia({ forcedColors: "none" });
					});
				}
			}
			// Persist every measured state; the former PNGs had no image-comparison assertions.
			await testInfo.attach("submitted-review-states", {
				body: JSON.stringify(reviewStates, null, 2),
				contentType: "application/json",
			});
			await testInfo.attach("hydrated-landmarks", {
				body: JSON.stringify(
					await page
						.locator('main, nav, aside, header, footer, [role="region"]')
						.evaluateAll((elements) =>
							elements.map((element) => ({
								tag: element.tagName,
								role: element.getAttribute("role"),
								label: element.getAttribute("aria-label"),
								labelledBy: element.getAttribute("aria-labelledby"),
							})),
						),
					null,
					2,
				),
				contentType: "application/json",
			});
		});
	}
});

for (const width of [390, 1280]) {
	for (const larger of [false, true]) {
		test(`assessment actions appear without reserved space at ${width}, larger=${larger}`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await page.addInitScript(
				(enabled) =>
					localStorage.setItem(
						"praxity-a11y",
						JSON.stringify({ textSize: enabled ? "large" : "default" }),
					),
				larger,
			);
			await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("choose-one")}.html`);
			const island = page.locator('[data-island="assessment"]');
			await island.scrollIntoViewIfNeeded();
			await expect(island).toHaveAttribute("data-hydrated", "");
			await page.evaluate(() => document.fonts.ready);
			const card = island.locator(".praxity-block-assessment");
			const before = await card.boundingBox();
			const action = card.locator(".praxity-assessment-actions");
			const actionBefore = await action.boundingBox();
			const optionBefore = await card.getByRole("radio").first().boundingBox();
			await expect(card.getByRole("button", { name: "Check" })).toHaveCount(0);
			await card.getByRole("radio").first().check();
			await expect(card.locator("[data-assessment-submit]")).toBeVisible();
			const after = await card.boundingBox();
			const actionAfter = await action.boundingBox();
			const optionAfter = await card.getByRole("radio").first().boundingBox();
			expect(before).not.toBeNull();
			expect(after).not.toBeNull();
			expect(actionBefore).toBeNull();
			expect(actionAfter).not.toBeNull();
			expect(actionAfter?.height ?? 0).toBeGreaterThanOrEqual(44);
			expect((after?.height ?? 0) - (before?.height ?? 0)).toBeGreaterThanOrEqual(44);
			expect(optionBefore).not.toBeNull();
			expect(optionAfter).not.toBeNull();
			expect(Math.abs((optionAfter?.y ?? 0) - (optionBefore?.y ?? 0))).toBeLessThanOrEqual(1);
		});
	}
}

for (const width of [390, 1280]) {
	for (const larger of [false, true]) {
		test(`keyboard focus stays on one choice or chooser row at ${width}, larger=${larger}`, async ({
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
			await page.goto(`${readTestEnv().url}/authoring-catalog/composition-assessment-choice.html`);
			const picker = page.locator(".praxity-assessment-group-picker");
			await expect(picker).toBeVisible();
			const initialMember = page.locator('[data-island="assessment"]').first();
			await initialMember.scrollIntoViewIfNeeded();
			await expect(initialMember).toHaveAttribute("data-hydrated", "");
			const groupRadios = picker.getByRole("radio");
			await arrowRadio(page, groupRadios.first(), groupRadios.nth(1));
			await expectFocusRing(page.locator(".praxity-ag-radio-row").nth(1), 2);
			await expectNoFocusRing(groupRadios.nth(1));
			await expectNoFocusRing(page.locator(".praxity-ag-radio-row").first());
			await page.keyboard.press("ArrowUp");
			await expect(groupRadios.first()).toBeChecked();
			const member = page.locator('[data-island="assessment"]:visible');
			await member.scrollIntoViewIfNeeded();
			await expect(member).toHaveAttribute("data-hydrated", "");
			const choices = member.getByRole("radio");
			await arrowRadio(page, choices.first(), choices.nth(1));
			await expectFocusRing(member.locator(".praxity-assessment-choice-option").nth(1), 2);
			await expectNoFocusRing(choices.nth(1));
			await member.screenshot({ path: testInfo.outputPath("choice-focus.png") });
		});
	}
}

test("choose-a-question composition keeps its group presentation in small and full previews", async ({
	page,
}, testInfo) => {
	const url = `${readTestEnv().url}/authoring-catalog/composition-assessment-choice.html`;
	for (const small of [true, false]) {
		await page.goto(`${url}${small ? "?minimal=1&praxity-small-preview=1" : ""}`);
		if (small) {
			await expect(page.locator("html")).toHaveAttribute(
				"data-praxity-small-preview-ready",
				"true",
			);
		}
		const picker = page.locator(".praxity-assessment-group-picker");
		await expect(picker).toBeVisible();
		await expect(picker.locator("input")).toHaveCount(2);
		await expect(picker.locator("input").first()).toBeChecked();
		const members = page.locator('.praxity-block[data-island="assessment"]');
		await expect(members).toHaveCount(2);
		await expect(members.first()).toBeVisible();
		await expect(members.last()).toBeHidden();
		await expect(members.first().locator(".praxity-assessment-description")).toHaveText(
			"A calendar invite has the wrong room. Select the first step.",
		);
		await expect(members.first().locator('input[type="radio"]')).toHaveCount(3);
		await expect(page.locator(".praxity-ag-submit-btn")).toHaveText("Submit selected");
		await expect(page.locator("#main-content")).not.toContainText("feedback:");
		await page.locator("#main-content").screenshot({
			path: testInfo.outputPath(`${small ? "small" : "full"}-assessment-group.png`),
		});
		if (small) {
			await expect(members.first()).not.toHaveAttribute("data-hydrated");
			await expect(picker.locator("input").first()).toBeDisabled();
		} else {
			await picker.locator("input").last().check();
			await expect(members.first()).toBeHidden();
			await expect(members.last()).toBeVisible();
		}
	}
});
