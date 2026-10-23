import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { readTestEnv, waitForHydration } from "./helpers";

async function answer(page: Page, french: boolean, passed: boolean) {
	await page
		.getByRole("radio", {
			name: french ? (passed ? "Oui" : "Non") : passed ? "Yes" : "No",
			exact: true,
		})
		.check();
	await page.locator("[data-assessment-submit]").click();
	await expect(page.locator('[data-block-id="choice"][data-assessment-display]')).toHaveAttribute(
		"data-completed",
		"true",
	);
}

for (const locale of ["en", "fr"] as const) {
	for (const theme of ["light", "dark"]) {
		for (const width of [1280, 390]) {
			for (const passed of [true, false]) {
				test(`${locale} ${theme} ${width} ${passed ? "pass" : "fail"}`, async ({ page }, info) => {
					await page.setViewportSize({ width, height: 844 });
					const url = `${readTestEnv().url}/outcomes/${locale}-${theme}`;
					await page.goto(`${url}/question.html`);
					await waitForHydration(page);
					await answer(page, locale === "fr", passed);
					await page.evaluate(() => {
						const courseId = document.getElementById("praxity-course-meta")?.dataset.courseId;
						sessionStorage.setItem(
							`praxity-course-session:${courseId}`,
							String(Date.now() - 125_000),
						);
					});
					await page.goto(`${url}/${locale === "fr" ? "resume" : "summary"}.html`);
					await waitForHydration(page);
					const result = page.locator("[data-course-outcome]");
					const baseline = process.env.PRAXITY_OUTCOME_PHASE === "before";
					if (!baseline) {
						await expect(result).toHaveText(
							locale === "fr"
								? passed
									? "Réussi"
									: "Non réussi"
								: passed
									? "Passed"
									: "Not passed",
						);
						await expect(result).toBeVisible();
						await expect(result.locator("svg")).toBeVisible();
						await expect(page.locator("[data-course-time]")).toHaveText(
							locale === "fr" ? "Temps passé : 2 minutes" : "Time spent: 2 minutes",
						);
						for (const action of await page.locator(".praxity-pages-completion-actions a").all()) {
							await expect(action).toHaveCSS("border-top-width", "1px");
							await expect(action).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
						}
						await expect(result).toHaveAttribute("data-result", passed ? "correct" : "incorrect");
						await expect(page.locator("[data-course-score]")).toHaveText(
							locale === "fr"
								? passed
									? "Score : 100 / 100 · Seuil de réussite : 80"
									: "Score : 0 / 100 · Seuil de réussite : 80"
								: passed
									? "Score: 100 / 100 · Pass mark: 80"
									: "Score: 0 / 100 · Pass mark: 80",
						);
						await page.reload();
						await waitForHydration(page);
						await expect(result).toHaveText(
							locale === "fr"
								? passed
									? "Réussi"
									: "Non réussi"
								: passed
									? "Passed"
									: "Not passed",
						);
						await expect(result).toBeVisible();
					}
					expect(await page.context().cookies()).toEqual([]);
					const completion = page.locator(".praxity-pages-completion");
					await completion.scrollIntoViewIfNeeded();
					const violations = (
						await new AxeBuilder({ page })
							.include(".praxity-pages-completion")
							.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
							.analyze()
					).violations;
					expect(violations).toEqual([]);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
					).toBe(true);
					const directory = process.env.PRAXITY_OUTCOME_SHOTS;
					if (directory && info.project.name === "chromium") {
						await mkdir(directory, { recursive: true });
						await page.screenshot({
							path: join(
								directory,
								`${baseline ? "before" : "after"}-${locale}-${theme}-${width}-${passed ? "pass" : "fail"}${process.env.PRAXITY_OUTCOME_SHOT_SUFFIX ? `-${process.env.PRAXITY_OUTCOME_SHOT_SUFFIX}` : ""}.png`,
							),
							animations: "disabled",
						});
					}
				});
			}
		}
	}
}

test("an answer on the completion page updates the outcome without reload", async ({ page }) => {
	await page.goto(`${readTestEnv().url}/outcomes/last-page/summary.html`);
	await waitForHydration(page);
	await expect(page.locator("[data-course-outcome]:visible")).toHaveCount(0);
	await answer(page, false, true);
	await expect(page.locator("[data-course-outcome]")).toHaveText("Passed");
	await expect(page.locator("[data-course-outcome]")).toBeVisible();
});

for (const passed of [true, false]) {
	test(`module completion shows ${passed ? "pass" : "fail"}`, async ({ page }) => {
		await page.goto(`${readTestEnv().url}/outcomes/deck/question.html`);
		await waitForHydration(page);
		await answer(page, false, passed);
		await page.locator("#deck-next").click();
		await page.locator("#deck-next").click();
		await expect(page.locator("[data-course-outcome]")).toHaveText(
			passed ? "Passed" : "Not passed",
		);
		await expect(page.locator("[data-course-outcome]")).toBeVisible();
		await expect(page.locator("[data-course-outcome] svg")).toBeVisible();
		await expect(page.locator("#deck-completion-score")).toHaveText(
			passed ? "Score: 100 / 100 · Pass mark: 80" : "Score: 0 / 100 · Pass mark: 80",
		);
		await expect(page.locator("#deck-completion").getByRole("button")).toHaveCount(1);
		await expect(page.locator("#deck-continue")).toHaveCount(0);
		await expect(page.locator("#deck-next")).toBeVisible();
		await expect(page.locator("#deck-next")).toHaveClass(/deck-finish/);
		await expect(page.getByRole("button", { name: "Back to course", exact: true })).toHaveCount(1);
	});
	test(`forced colours keep the ${passed ? "pass" : "fail"} icon and word`, async ({ page }) => {
		await page.emulateMedia({ forcedColors: "active" });
		test.skip(
			!(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)),
			"This engine does not emulate forced colours",
		);
		await page.goto(`${readTestEnv().url}/outcomes/en-light/question.html`);
		await waitForHydration(page);
		await answer(page, false, passed);
		await page.goto(`${readTestEnv().url}/outcomes/en-light/summary.html`);
		await waitForHydration(page);
		const status = page.locator("[data-course-outcome]");
		await expect(status).toHaveText(passed ? "Passed" : "Not passed");
		await expect(status).toBeVisible();
		await expect(status.locator("svg")).toBeVisible();
		expect(await status.locator("svg").evaluate((icon) => getComputedStyle(icon).stroke)).not.toBe(
			"none",
		);
	});
}

test("pending, retryable and completion-only courses show no outcome", async ({ page }) => {
	for (const name of ["en-light", "retry", "no-mark"]) {
		const url = `${readTestEnv().url}/outcomes/${name}`;
		await page.goto(`${url}/question.html`);
		await waitForHydration(page);
		if (name !== "en-light") {
			await page.getByRole("radio", { name: "No", exact: true }).check();
			await page.locator("[data-assessment-submit]").click();
		}
		await page.goto(`${url}/summary.html`);
		await waitForHydration(page);
		await expect(page.locator("[data-course-outcome]:visible")).toHaveCount(0);
		await page.reload();
		await waitForHydration(page);
		await expect(page.locator("[data-course-outcome]:visible")).toHaveCount(0);
	}
});
