import { expect, type Page, test } from "@playwright/test";
import { LONG_MATCH } from "./fixtures/activity-bugs-fixture";
import { readTestEnv } from "./helpers";

async function open(page: Page, locale = "en", width = 1440) {
	await page.setViewportSize({ width, height: 900 });
	await page.goto(`${readTestEnv().url}/activity-bugs-${locale}/activity-fixes.html`);
	await expect(
		page.locator('[data-island="assessment"][data-block-id="categorize"]'),
	).toHaveAttribute("data-hydrated", "");
}

async function capture(page: Page, name: string) {
	const folder = process.env.PRAXITY_ACTIVITY_SCREENSHOTS;
	if (folder) await page.screenshot({ path: `${folder}/${test.info().project.name}-${name}.png` });
}

for (const locale of ["en", "fr"])
	for (const width of [1280, 390]) {
		test(`${locale} ${width}px choice feedback stays at the answer through retry and exhaustion`, async ({
			page,
		}) => {
			await open(page, locale, width);
			const block = page.locator('.mantine-Card-root[data-block-id="choice"]');
			const wrong = block.locator('[data-node-id="wrong"]');
			const right = block.locator('[data-node-id="right"]');
			await wrong.getByRole("radio").check();
			await expect(wrong).toHaveCSS("border-top-width", "2px");
			const submit = block.locator("[data-assessment-submit]");
			await submit.scrollIntoViewIfNeeded();
			const before = await page.evaluate(() => scrollY);
			await submit.click();
			await expect(
				block.getByRole("button", {
					name: locale === "en" ? "Try again" : "Réessayer",
					exact: true,
				}),
			).toBeFocused();
			await expect(
				block.getByRole("button", {
					name: locale === "en" ? "Try again" : "Réessayer",
					exact: true,
				}),
			).toHaveAccessibleDescription(
				`${locale === "en" ? "Not quite" : "Pas tout à fait"} Consider how the other person feels.`,
			);
			expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThanOrEqual(1);
			await expect(wrong.locator("[data-option-feedback]")).toContainText(
				locale === "en" ? "Not quite" : "Pas tout à fait",
			);
			await expect(wrong.locator(".praxity-choice-feedback")).toContainText(
				"Let the other person finish.",
			);
			await expect(wrong.locator("[data-option-feedback] svg")).toHaveCount(1);
			await expect(right).not.toContainText(locale === "en" ? "Correct answer" : "Bonne réponse");
			const retry = block.getByRole("button", {
				name: locale === "en" ? "Try again" : "Réessayer",
				exact: true,
			});
			expect(await retry.evaluate((e) => e.closest("[data-assessment-feedback]") !== null)).toBe(
				true,
			);
			await retry.click();
			await expect(wrong.locator("[data-option-feedback]")).toBeVisible();
			await wrong.getByRole("radio").check();
			await submit.click();
			await expect(right.locator("[data-option-feedback]")).toHaveText(
				locale === "en" ? "Correct answer" : "Bonne réponse",
			);
			await expect(retry).toHaveCount(0);
		});
		test(`${locale} ${width}px rating endpoints and signature type roles`, async ({ page }) => {
			await open(page, locale, width);
			const rating = page.locator('[data-block-type="rating"]');
			await rating.scrollIntoViewIfNeeded();
			await expect(rating.locator("[data-rating-endpoints]")).toHaveText("RarelyVery often");
			const before = await page.evaluate(() => scrollY);
			await rating.locator(".praxity-rating-option").nth(4).click();
			await expect(rating.getByRole("radio").nth(4)).toBeChecked();
			expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThanOrEqual(1);
			const signature = page.locator('[data-block-type="signature"]');
			await expect(signature.locator(".praxity-signature-label")).toHaveCSS(
				"font-size",
				width === 390 ? "18px" : "19px",
			);
			await expect(signature.locator(".praxity-signature-status").last()).toHaveCSS(
				"font-size",
				"15px",
			);
		});
	}

test("tables center 44px answer targets at 600px and stack below it", async ({ page }) => {
	await open(page);
	for (const type of ["categorize", "matrix"]) {
		const table = page.locator(`.praxity-${type}-table`);
		for (const width of [600, 599]) {
			await table.evaluate((node, width) => {
				const block = node.closest<HTMLElement>(".praxity-block-assessment");
				if (!block) throw new Error("Missing assessment");
				block.style.width = `${width}px`;
				block.style.boxSizing = "content-box";
			}, width);
			await expect(table.locator("thead")).toHaveCSS(
				"position",
				width === 600 ? "static" : "absolute",
			);
			if (width === 600) {
				const geometry = await table.locator("tbody td").evaluateAll((cells) =>
					cells.map((cell) => {
						const target = cell.querySelector("label");
						const input = cell.querySelector("input");
						if (!target || !input) throw new Error("Missing answer target");
						const c = cell.getBoundingClientRect(),
							t = target.getBoundingClientRect(),
							r = input.getBoundingClientRect();
						return {
							width: c.width,
							height: c.height,
							targetWidth: t.width,
							targetHeight: t.height,
							dx: Math.abs((c.left + c.right - r.left - r.right) / 2),
							dy: Math.abs((c.top + c.bottom - r.top - r.bottom) / 2),
						};
					}),
				);
				for (const cell of geometry) {
					expect(
						Math.min(cell.width, cell.height, cell.targetWidth, cell.targetHeight),
					).toBeGreaterThanOrEqual(44);
					expect(cell.dx).toBeLessThanOrEqual(1);
					expect(cell.dy).toBeLessThanOrEqual(1);
				}
			}
		}
		await table.evaluate((node) =>
			node.closest<HTMLElement>(".praxity-block-assessment")?.removeAttribute("style"),
		);
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: 900 });
			await table.scrollIntoViewIfNeeded();
			await capture(page, `${type}-${width}`);
		}
	}
});

for (const locale of ["en", "fr"]) {
	for (const width of [1440, 390]) {
		test(`${locale} ${width}px rows explain results and summary focus preserves scroll and saved answers`, async ({
			page,
		}) => {
			await open(page, locale, width);
			for (const type of ["categorize", "matrix"]) {
				const block = page.locator(`.mantine-Card-root[data-block-id="${type}"]`);
				const rows = block.locator("tbody tr");
				for (let index = 0; index < (await rows.count()); index++)
					await rows.nth(index).getByRole("radio").first().check();
				const submit = block.locator("[data-assessment-submit]");
				await submit.scrollIntoViewIfNeeded();
				const before = await page.evaluate(() => scrollY);
				await submit.click();
				const summary = block.locator("[data-row-summary]");
				const expectedSummary =
					locale === "en"
						? type === "categorize"
							? "2 of 4 correct"
							: "1 of 2 correct"
						: type === "categorize"
							? "2 sur 4 corrects"
							: "1 sur 2 corrects";
				await expect(summary).toHaveText(expectedSummary);
				const action = block.getByRole("button", {
					name:
						type === "categorize"
							? locale === "en"
								? "Try again"
								: "Réessayer"
							: locale === "en"
								? "Continue"
								: "Continuer",
					exact: true,
				});
				await expect(action).toBeFocused();
				await expect(action).toHaveAccessibleDescription(expectedSummary);
				expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThanOrEqual(1);
				await expect(rows.locator("[data-row-result='correct']")).toHaveCount(
					type === "categorize" ? 2 : 1,
				);
				const wrong = rows.locator("[data-row-result='incorrect']");
				await expect(wrong).toHaveCount(type === "categorize" ? 2 : 1);
				for (const result of await wrong.all()) {
					await expect(result).toHaveText(
						locale === "en" ? "Should be: Unhelpful" : "Réponse attendue : Unhelpful",
					);
					await expect(result.locator("svg")).toHaveCount(1);
				}
				for (const width of [1440, 390]) {
					await page.setViewportSize({ width, height: 900 });
					await summary.scrollIntoViewIfNeeded();
					await capture(page, `${locale}-${type}-submitted-${width}`);
				}
			}
			await page.reload();
			await expect(
				page.locator('[data-island="assessment"][data-block-id="categorize"]'),
			).toHaveAttribute("data-hydrated", "");
			await expect(page.locator(".praxity-categorize-table input:checked")).toHaveCount(4);
			await expect(page.locator('[data-block-id="categorize"] [data-row-summary]')).toHaveText(
				locale === "en" ? "2 of 4 correct" : "2 sur 4 corrects",
			);
		});
	}
}

test("matching displays the full selected answer with a separate chevron", async ({ page }) => {
	await open(page);
	const matching = page.locator('.mantine-Card-root[data-block-id="matching"]');
	await matching.scrollIntoViewIfNeeded();
	await expect(matching.locator("xpath=ancestor::*[@data-island]")).toHaveAttribute(
		"data-hydrated",
		"",
	);
	await matching.getByRole("combobox").click();
	await page.getByRole("option", { name: LONG_MATCH }).click();
	for (const width of [1440, 390, 320]) {
		await page.setViewportSize({ width, height: 900 });
		const answer = matching.locator(".praxity-matching-value");
		await expect(answer).toHaveText(LONG_MATCH);
		const geometry = await answer.evaluate((node) => {
			const value = node.getBoundingClientRect();
			const chevron = node.parentElement
				?.querySelector(".mantine-Input-section")
				?.getBoundingClientRect();
			if (!chevron) throw new Error("Missing chevron");
			return {
				overflow: node.scrollWidth - node.clientWidth,
				end: value.right,
				chevronStart: chevron.left,
				height: node.parentElement?.getBoundingClientRect().height ?? 0,
			};
		});
		expect(geometry.overflow).toBeLessThanOrEqual(1);
		expect(geometry.end).toBeLessThanOrEqual(geometry.chevronStart);
		expect(geometry.height).toBeGreaterThanOrEqual(44);
		await matching.scrollIntoViewIfNeeded();
		await capture(page, `matching-${width}`);
	}
});

test("unchecked checklist border has at least 3:1 rendered contrast", async ({ page }) => {
	await open(page);
	const checklist = page.locator('[data-block-type="checklist"]');
	await checklist.scrollIntoViewIfNeeded();
	await expect(checklist).toHaveAttribute("data-hydrated", "");
	await expect(checklist.locator("input")).toBeVisible();
	const boundary = await checklist.locator("input").evaluate((input) => {
		const probe = document.createElement("span");
		probe.style.color = "var(--ink-2, var(--praxity-color-text-light))";
		input.parentElement?.append(probe);
		const expected = getComputedStyle(probe).color;
		probe.remove();
		return { actual: getComputedStyle(input).borderColor, expected };
	});
	expect(boundary.actual).toBe(boundary.expected);
	const contrast = await checklist.locator("input").evaluate((input) => {
		const luminance = (color: string) => {
			const canvas = document.createElement("canvas");
			const context = canvas.getContext("2d");
			if (!context) throw new Error("No color conversion context");
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
			return channels
				.map((c) => c / 255)
				.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
				.reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
		};
		const style = getComputedStyle(input);
		const a = luminance(style.borderColor),
			b = luminance(style.backgroundColor);
		return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
	});
	expect(contrast).toBeGreaterThanOrEqual(3);
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await checklist.scrollIntoViewIfNeeded();
		await capture(page, `checklist-${width}`);
	}
	const checkbox = checklist.getByRole("checkbox", { name: "Read the instructions", exact: true });
	await checkbox.focus();
	await page.keyboard.press("Space");
	await expect(checkbox).toBeChecked();
	await expect(checkbox).toHaveAccessibleName("Read the instructions");
	await capture(page, "checklist-checked-390");
	await page.reload();
	await checklist.scrollIntoViewIfNeeded();
	await expect(checklist).toHaveAttribute("data-hydrated", "");
	await expect(checkbox).toBeChecked();
});

test("journal has localized secondary text downloads", async ({ page }) => {
	for (const locale of ["en", "fr"]) {
		await open(page, locale);
		const journal = page.locator('.mantine-Card-root[data-block-id="journal"]');
		await journal.scrollIntoViewIfNeeded();
		await expect(journal.locator("xpath=ancestor::*[@data-island]")).toHaveAttribute(
			"data-hydrated",
			"",
		);
		await journal.getByRole("textbox").fill("My response");
		for (const name of locale === "en"
			? ["Download as text", "Download as Word"]
			: ["Télécharger en texte", "Télécharger en Word"]) {
			const button = journal.getByRole("button", { name, exact: true });
			await expect(button).toHaveText(name);
			await page.mouse.move(0, 0);
			const surface = await button.evaluate((element) => {
				const probe = document.createElement("span");
				probe.style.backgroundColor = "var(--paper)";
				probe.style.borderColor = "var(--line-mid)";
				element.before(probe);
				const style = getComputedStyle(probe);
				const result = { background: style.backgroundColor, border: style.borderTopColor };
				probe.remove();
				return result;
			});
			await expect(button).toHaveCSS("background-color", surface.background);
			await expect(button).toHaveCSS("border-top-color", surface.border);
			await expect(button).toHaveCSS("border-radius", "10px");
			expect(
				await button.evaluate((node) => node.getBoundingClientRect().height),
			).toBeGreaterThanOrEqual(44);
			const download = page.waitForEvent("download");
			await button.click();
			expect((await download).suggestedFilename()).toMatch(
				name.endsWith("Word") ? /\.docx$/ : /\.txt$/,
			);
		}
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: 900 });
			await journal.scrollIntoViewIfNeeded();
			await capture(page, `${locale}-journal-${width}`);
		}
	}
});
