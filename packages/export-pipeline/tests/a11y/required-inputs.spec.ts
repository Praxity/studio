import { expect, test } from "@playwright/test";
import { arrowRadio, expectFocusRing, expectNoFocusRing } from "../focus-assertions";
import { readTestEnv } from "./helpers";

test("required choice arrow navigation retains a single painted row indicator", async ({
	page,
}) => {
	const base = readTestEnv().navVariants?.sidebar;
	if (!base) throw new Error("Missing sidebar fixture");
	await page.goto(`${base}/page-3.html`);
	const question = page.locator('[data-island="assessment"]').first();
	await question.scrollIntoViewIfNeeded();
	await expect(question).toHaveAttribute("data-hydrated", "");
	const radios = question.getByRole("radio");
	await arrowRadio(page, radios.first(), radios.nth(1));
	await expectFocusRing(question.locator(".praxity-assessment-choice-option").nth(1), 2);
	await expectNoFocusRing(radios.nth(1));
	await expect(question.locator("input:invalid")).toHaveCount(0);
});

test("required choices stay natively valid before and after submission", async ({ page }) => {
	const env = readTestEnv();
	const baseUrl = env.navVariants?.sidebar;
	if (!baseUrl) throw new Error("Missing lightweight sidebar fixture");
	await page.goto(`${baseUrl}/index.html`);
	await expect(page.locator("#praxity-config")).toBeAttached();
	const assessmentPage = await page.evaluate(() => {
		const config = JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}");
		return (config.pages as Array<{ title: string; slug: string }>).find((entry) =>
			entry.title.includes("Page Three"),
		);
	});
	if (!assessmentPage) throw new Error("Missing assessment fixture page");
	await page.goto(`${baseUrl}/${assessmentPage.slug}.html`);
	const questions = page.locator('[data-island="assessment"]');
	for (const question of await questions.all()) {
		await question.scrollIntoViewIfNeeded();
		await expect(question).toHaveAttribute("data-hydrated", "");
		await expect(
			question.locator("input[required], input:invalid, [aria-invalid=true]"),
		).toHaveCount(0);
	}
	const first = questions.first();
	await expect(first.getByRole("radiogroup")).toHaveAttribute("aria-required", "true");
	// Keep the engine's accessibility representation as controller evidence.
	await test.info().attach("untouched-required-choice", {
		body: await first.ariaSnapshot(),
		contentType: "text/plain",
	});
	const submit = page.locator(".praxity-ag-submit-btn");
	// Native keyboard selection and the existing matching combobox remain usable.
	await first.getByRole("radio", { name: "Correct answer", exact: true }).focus();
	await page.keyboard.press("Space");
	const matching = questions.nth(1);
	const combos = matching.getByRole("combobox");
	for (const [index, answer] of ["Face shield", "Guardrail"].entries()) {
		await combos.nth(index).click();
		await page.getByRole("option", { name: answer, exact: true }).click();
	}
	await questions.nth(2).getByRole("radio", { name: "Stop work", exact: true }).check();
	await submit.click();

	await expect(questions.locator('[aria-invalid="true"]')).toHaveCount(0);
	await expect(first.locator("[data-assessment-display][data-block-id]").first()).toHaveAttribute(
		"data-completed",
		"true",
	);
});
