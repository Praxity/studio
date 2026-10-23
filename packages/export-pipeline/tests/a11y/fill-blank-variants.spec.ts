import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { catalogSlug } from "../fixtures/authoring-catalog";
import { analyzeAxe, readTestEnv } from "./helpers";

async function openVariant(page: Page, title: string, small = false) {
	const base = `${readTestEnv().url}/fill-blank-variants`;
	await page.goto(`${base}/index.html`);
	const slug = await page.evaluate((title) => {
		const config = JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}");
		return config.pages.find((entry: { title: string }) => entry.title === title)?.slug;
	}, title);
	expect(slug).toBeTruthy();
	await page.goto(`${base}/${slug}.html${small ? "?minimal=1&praxity-small-preview=1" : ""}`);
	const block = page.locator('[data-island="assessment"]');
	await block.scrollIntoViewIfNeeded();
	if (small) {
		await expect(page.locator("html")).toHaveAttribute("data-praxity-small-preview-ready", "true");
	} else {
		await expect(block).toHaveAttribute("data-hydrated", "");
	}
	return block;
}

test("inline-only fill-blank focuses a visible summary before retry", async ({ page }) => {
	await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("fill-blank")}.html`);
	const block = page.locator('[data-island="assessment"]');
	await block.scrollIntoViewIfNeeded();
	await expect(block).toHaveAttribute("data-hydrated", "");
	await block.getByRole("textbox").fill("wrong");
	await block.locator("[data-assessment-submit]").click();
	const feedback = block.locator("[data-assessment-feedback]");
	await expect(feedback.locator(".praxity-assessment-result")).toHaveText(
		"Answer checked. Review the results above.",
	);
	await expect(block.getByRole("button", { name: "Try again", exact: true })).toBeFocused();
	await expect(
		block.getByRole("button", { name: "Try again", exact: true }),
	).toHaveAccessibleDescription("");
	expect((await feedback.boundingBox())?.height).toBeGreaterThan(0);
	const retry = block.getByRole("button", { name: "Try again" });
	await expect(feedback.getByRole("button", { name: "Try again" })).toBeVisible();
	expect(
		await feedback.evaluate((element) =>
			Boolean(
				element.compareDocumentPosition(
					element.closest(".praxity-block-assessment")?.querySelector("button") as Node,
				) & Node.DOCUMENT_POSITION_FOLLOWING,
			),
		),
	).toBe(true);
	await retry.click();
	await expect(block.getByRole("textbox")).toBeFocused();
	await expect(block.getByRole("textbox")).toBeEditable();
});

test("dropdown blanks retain distractors, support keyboard answers, retry and resume", async ({
	page,
}) => {
	const block = await openVariant(page, "Dropdown blanks");
	const fields = block.getByRole("combobox");
	await expect(fields).toHaveCount(2);
	await expect(fields.first()).toHaveAccessibleName(/blank 1/i);
	await expect(fields.nth(1)).toHaveAccessibleName(/blank 2/i);
	await expect(fields.first().locator("option")).toHaveText([
		"Select an answer",
		"red",
		"blue",
		"green",
		"a longer distractor that needs more room",
	]);
	await fields.first().focus();
	// Native select type-ahead works without automating an operating-system popup.
	await page.keyboard.press("r");
	await expect(fields.first()).toHaveValue("red");
	await page.keyboard.press("Tab");
	await expect(fields.nth(1)).toBeFocused();
	await fields.nth(1).selectOption("open");
	await block.locator("[data-assessment-submit]").click();
	await expect(block.locator(".praxity-block-assessment[data-assessment-display]")).toHaveAttribute(
		"data-score",
		"0",
	);
	await block.getByRole("button", { name: "Try again" }).click();
	await fields.first().selectOption("blue");
	await fields.nth(1).selectOption("open");
	await block.locator("[data-assessment-submit]").click();
	await expect(block.locator(".praxity-block-assessment[data-assessment-display]")).toHaveAttribute(
		"data-score",
		"100",
	);
	await page.reload();
	await expect(block).toHaveAttribute("data-hydrated", "");
	await expect(fields.first()).toHaveValue("blue");
	await expect(fields.nth(1)).toHaveValue("open");
	await expect(fields.first()).toBeDisabled();
	await expect(block.locator(".praxity-block-assessment[data-assessment-display]")).toHaveAttribute(
		"data-score",
		"100",
	);
});

test("word bank counts repeated words and returns released words to the bank", async ({ page }) => {
	const block = await openVariant(page, "Word bank");
	const fields = block.getByRole("combobox");
	await expect(fields).toHaveCount(3);
	await fields.nth(1).selectOption("red");
	await fields.nth(2).selectOption("red");
	await expect(fields.first().locator('option[value="red"]')).toBeDisabled();
	await expect(fields.nth(1).locator('option[value="red"]')).toBeEnabled();
	await fields.nth(1).selectOption("");
	await expect(fields.first().locator('option[value="red"]')).toBeEnabled();
	await fields.first().selectOption("green");
	await fields.nth(1).selectOption("red");
	await block.locator("[data-assessment-submit]").click();
	await expect(block.locator(".praxity-block-assessment[data-assessment-display]")).toHaveAttribute(
		"data-score",
		"0",
	);
	await block.getByRole("button", { name: "Try again" }).click();
	await fields.first().selectOption("blue");
	await fields.nth(1).selectOption("red");
	await fields.nth(2).selectOption("red");
	await block.locator("[data-assessment-submit]").click();
	await expect(block.locator(".praxity-block-assessment[data-assessment-display]")).toHaveAttribute(
		"data-score",
		"100",
	);
	await page.reload();
	await expect(block).toHaveAttribute("data-hydrated", "");
	for (const [index, value] of ["blue", "red", "red"].entries()) {
		await expect(fields.nth(index)).toHaveValue(value);
		await expect(fields.nth(index)).toBeDisabled();
	}
});

test("reveal locks the submitted dropdown and restores its correction", async ({ page }) => {
	const block = await openVariant(page, "Reveal dropdown");
	await block.getByRole("combobox").selectOption("left");
	await block.locator("[data-assessment-submit]").click();
	for (let pass = 0; pass < 2; pass++) {
		await expect(block.getByRole("combobox")).toHaveValue("left");
		await expect(block.getByRole("combobox")).toBeDisabled();
		await expect(block.locator("[data-assessment-correct-answers] li")).toHaveText(["right"]);
		await expect(block.getByRole("button", { name: "Try again" })).toHaveCount(0);
		if (pass === 0) {
			await page.reload();
			await expect(block).toHaveAttribute("data-hydrated", "");
		}
	}
});

for (const small of [true, false]) {
	test(`${small ? "small" : "full"} blank variants preserve escaped text and answer values`, async ({
		page,
	}) => {
		for (const [title, answers] of [
			["Escaped dropdown", ["a|b", "*star"]],
			["Escaped word bank", ["a|b", "{value}", String.raw`C:\temp`]],
		] as const) {
			const block = await openVariant(page, title, small);
			const fields = block.getByRole("combobox");
			await expect(fields).toHaveCount(answers.length);
			if (title === "Escaped dropdown") {
				await expect(
					page.getByText("Literal *stars*, {{name}}, and @icon{check}.", { exact: true }),
				).toBeVisible();
				await expect(block.locator(".praxity-fill-blank-template")).toContainText(
					"Keep {literal} and ____ as text.",
				);
				await expect(fields.first().locator("option")).toHaveText([
					"Select an answer",
					"a|b",
					"other",
				]);
				await expect(fields.nth(1).locator("option")).toHaveText([
					"Select an answer",
					"*star",
					"plain",
				]);
			} else {
				await expect(fields.first().locator("option")).toHaveText([
					"Select an answer",
					...answers,
					"spare",
				]);
			}
			for (const [index, answer] of answers.entries()) {
				if (small) await expect(fields.nth(index)).toBeDisabled();
				else await fields.nth(index).selectOption(answer);
			}
			if (!small) {
				await block.locator("[data-assessment-submit]").click();
				await expect(
					block.locator(".praxity-block-assessment[data-assessment-display]"),
				).toHaveAttribute("data-score", "100");
				await page.reload();
				await expect(block).toHaveAttribute("data-hydrated", "");
				for (const [index, answer] of answers.entries()) {
					await expect(fields.nth(index)).toHaveValue(answer);
					await expect(fields.nth(index)).toBeDisabled();
				}
			}
		}
	});

	test(`${small ? "small" : "full"} blank variants keep labelled controls at narrow widths`, async ({
		page,
	}, testInfo) => {
		for (const title of ["Dropdown blanks", "Word bank"]) {
			const block = await openVariant(page, title, small);
			for (const field of await block.getByRole("combobox").all()) {
				await expect(field).toHaveAccessibleName(/blank \d/i);
				if (small) await expect(field).toBeDisabled();
			}
			for (const width of [1280, 320]) {
				await page.setViewportSize({ width, height: 900 });
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true,
				);
			}
			const originalSize = await block
				.getByRole("combobox")
				.first()
				.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
			await block.locator(".praxity-fill-blank-template").evaluate((element) => {
				const size = Number.parseFloat(getComputedStyle(element).fontSize);
				(element as HTMLElement).style.fontSize = `${size * 2}px`;
			});
			expect(
				await block
					.getByRole("combobox")
					.first()
					.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
			).toBeGreaterThanOrEqual(originalSize * 2);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true,
			);
			const assertBounds = async () => {
				const geometry = await block
					.locator("select, .praxity-fill-blank-status")
					.evaluateAll((controls) =>
						controls.map((control) => {
							const template = control.closest(".praxity-fill-blank-template");
							if (!template) throw new Error("Missing blank template");
							const field = control.getBoundingClientRect();
							const content = template.getBoundingClientRect();
							return { left: field.left - content.left, right: field.right - content.right };
						}),
					);
				for (const field of geometry) {
					expect(field.left).toBeGreaterThanOrEqual(-1);
					expect(field.right).toBeLessThanOrEqual(1);
				}
			};
			await assertBounds();
			if (!small) {
				const answers = title === "Dropdown blanks" ? ["red", "open"] : ["green", "red", "red"];
				for (const [index, answer] of answers.entries()) {
					await block.getByRole("combobox").nth(index).selectOption(answer);
				}
				await block.locator("[data-assessment-submit]").click();
				await expect(block.locator(".praxity-fill-blank-status")).toHaveCount(answers.length);
				await assertBounds();
			}
			const results = await analyzeAxe(
				page,
				new AxeBuilder({ page })
					.include('[data-island="assessment"]')
					.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]),
			);
			expect(results.violations).toEqual([]);
			await block.screenshot({
				path: testInfo.outputPath(`${title}-${small ? "small" : "full"}.png`),
			});
		}
	});
}
