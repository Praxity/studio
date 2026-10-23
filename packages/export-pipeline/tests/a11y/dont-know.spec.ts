import { expect } from "@playwright/test";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { test } from "../muted-test";
import { DONT_KNOW_PALETTES } from "./fixtures/dont-know-fixture";
import { readTestEnv } from "./helpers";

for (const direction of ["ltr", "rtl"] as const)
	for (const width of [1280, 390]) {
		test(`unkeyed label alignment ${direction} ${width}`, async ({ page }, testInfo) => {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ reducedMotion: "reduce" });
			await page.goto(`${readTestEnv().url}/dont-know-ink-false-en-false/index.html`);
			await page.evaluate((dir) => {
				document.documentElement.dir = dir;
			}, direction);
			const card = page.locator('[data-island="assessment"][data-block-id="practice"]');
			await card.scrollIntoViewIfNeeded();
			await expect(card).toHaveAttribute("data-hydrated", "");
			const keyed = card.locator(".praxity-assessment-choice-option").first();
			const unknown = card.locator("[data-dont-know]");
			for (const submitted of [false, true]) {
				if (submitted) {
					await unknown.getByRole("radio", { name: "I don't know", exact: true }).check();
					await card.locator("[data-assessment-submit]").click();
					await expect(unknown.locator(".praxity-choice-status")).toHaveText(
						'You chose "I don\'t know"',
					);
				}
				const keyedBox = await keyed.locator(".praxity-choice-label").boundingBox();
				const unknownBox = await unknown.locator(".praxity-choice-label").boundingBox();
				if (!keyedBox || !unknownBox) throw new Error("Missing choice label geometry");
				const keyedRow = await keyed.boundingBox();
				const unknownRow = await unknown.boundingBox();
				if (!keyedRow || !unknownRow) throw new Error("Missing choice row geometry");
				expect(
					Math.abs(unknownBox.y - unknownRow.y - (keyedBox.y - keyedRow.y)),
				).toBeLessThanOrEqual(0.5);
				expect(Math.abs(unknownRow.height - keyedRow.height)).toBeLessThanOrEqual(0.5);
				const keyedStart = direction === "rtl" ? keyedBox.x + keyedBox.width : keyedBox.x;
				const unknownStart = direction === "rtl" ? unknownBox.x + unknownBox.width : unknownBox.x;
				expect(Math.abs(unknownStart - keyedStart)).toBeLessThanOrEqual(0.5);
				if (submitted && width === 390) {
					const mark = await unknown.locator(".praxity-choice-status").boundingBox();
					if (!mark) throw new Error("Missing unknown mark geometry");
					expect(
						Math.abs((direction === "rtl" ? mark.x + mark.width : mark.x) - unknownStart),
					).toBeLessThanOrEqual(0.5);
				}
			}
			await expect(unknown.locator(".praxity-choice-key")).toHaveCount(0);
			if (direction === "rtl" && width === 390 && testInfo.project.name === "chromium")
				await card.screenshot({ path: testInfo.outputPath("r3-rtl-390-after.png") });
		});
	}

for (const [palette, dark, locale] of [
	["ink", false, "en"],
	["clay", true, "en"],
	["ink", false, "fr"],
] as const) {
	for (const width of [1280, 390]) {
		test(`uncertainty row, mark and group ${palette} ${dark} ${locale} ${width}`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ reducedMotion: "reduce" });
			await page.goto(
				`${readTestEnv().url}/dont-know-${palette}-${dark}-${locale}-false/index.html`,
			);
			const card = page.locator('[data-island="assessment"][data-block-id="practice"]');
			await card.scrollIntoViewIfNeeded();
			await expect(card).toHaveAttribute("data-hydrated", "");
			const label = locale === "fr" ? "Je ne sais pas" : "I don't know";
			const row = card.locator("[data-dont-know]");
			const radio = row.getByRole("radio", { name: label, exact: true });
			await expect(card.getByRole("radio").last()).toHaveAccessibleName(label);
			await expect(row.locator(".praxity-choice-key")).toHaveCount(0);
			expect(await row.evaluate((e) => getComputedStyle(e, "::before").borderTopWidth)).toBe("1px");
			expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(48);
			await card.getByRole("radio").first().focus();
			await page.keyboard.press("ArrowDown");
			await page.keyboard.press("ArrowDown");
			await expect(radio).toBeChecked();
			await expect(radio).toBeFocused();
			if (testInfo.project.name === "chromium")
				await card.screenshot({
					path: testInfo.outputPath(`r3-${palette}-${dark}-${locale}-${width}-before.png`),
				});
			await card.locator("[data-assessment-submit]").click();
			await expect(row.locator(".praxity-choice-status")).toHaveText(
				locale === "fr" ? "Vous avez choisi « Je ne sais pas »" : 'You chose "I don\'t know"',
			);
			await expect(row).toHaveAttribute("data-choice-result", "unknown");
			await expect(
				card.getByText(locale === "fr" ? "Bonne réponse" : "Correct answer", { exact: true }),
			).toBeVisible();
			await expect(
				card.getByText(
					locale === "fr" ? "Écoutez avant de répondre." : "Listen before responding.",
					{ exact: true },
				),
			).toBeVisible();
			await expect(
				card.getByText(locale === "fr" ? "Pas tout à fait" : "Not quite", { exact: true }),
			).toHaveCount(0);
			if (testInfo.project.name === "chromium")
				await card.screenshot({
					path: testInfo.outputPath(`r3-${palette}-${dark}-${locale}-${width}-after.png`),
				});
			const graded = page.locator('[data-island="assessment"][data-block-id="graded"]');
			await graded.scrollIntoViewIfNeeded();
			await expect(graded).toHaveAttribute("data-hydrated", "");
			await expect(graded.locator("[data-dont-know]")).toHaveCount(0);
			const opted = page.locator('[data-island="assessment"][data-block-id="graded-optin"]');
			await opted.scrollIntoViewIfNeeded();
			await expect(opted).toHaveAttribute("data-hydrated", "");
			await opted.getByRole("radio", { name: label, exact: true }).check();
			await opted.locator("[data-assessment-submit]").click();
			await expect(opted.locator("[data-assessment-display][data-score]").first()).toHaveAttribute(
				"data-score",
				"0",
			);
			await expect(opted.locator("[data-assessment-display][data-passed]").first()).toHaveAttribute(
				"data-passed",
				"false",
			);
			for (const id of ["group-first", "group-second"]) {
				const member = page.locator(`[data-island="assessment"][data-block-id="${id}"]`);
				await member.scrollIntoViewIfNeeded();
				await expect(member).toHaveAttribute("data-hydrated", "");
				await member
					.getByRole("radio", { name: id === "group-first" ? label : "Listen", exact: true })
					.check();
			}
			await page.locator('[data-assessment-group-submit="group"] .praxity-ag-submit-btn').click();
			const summary = page.locator(
				'[data-assessment-group-submit="group"] .praxity-ag-results-score',
			);
			await expect(summary).toHaveText(
				locale === "fr"
					? "1 sur 2 correctes, 1 « Je ne sais pas » · Non réussi"
					: '1 of 2 correct, 1 "I don\'t know" · Not passed',
			);
			await expect(summary).toBeFocused();
			await expect(
				page.locator('[data-assessment-group-submit="group"] [role="status"]'),
			).toBeEmpty();
			if (testInfo.project.name === "chromium")
				await page.locator('[data-assessment-group-submit="group"]').screenshot({
					path: testInfo.outputPath(`r3-${palette}-${dark}-${locale}-${width}-group.png`),
				});
		});
	}
}

for (const palette of DONT_KNOW_PALETTES)
	for (const dark of [false, true]) {
		test(`neutral icon and text contrast ${palette} ${dark}`, async ({ page }) => {
			await page.emulateMedia({ reducedMotion: "reduce" });
			await page.goto(`${readTestEnv().url}/dont-know-${palette}-${dark}-en-false/index.html`);
			const card = page.locator('[data-island="assessment"][data-block-id="practice"]');
			await expect(card).toHaveAttribute("data-hydrated", "");
			await card.getByRole("radio", { name: "I don't know", exact: true }).check();
			await card.locator("[data-assessment-submit]").click();
			const colors = await card
				.locator('[data-choice-result="unknown"] .praxity-choice-status')
				.evaluate((e) => {
					const context = document.createElement("canvas").getContext("2d");
					if (!context) throw new Error("Missing canvas color conversion");
					const hex = (color: string) => {
						context.clearRect(0, 0, 1, 1);
						context.fillStyle = color;
						context.fillRect(0, 0, 1, 1);
						return (
							"#" +
							Array.from(context.getImageData(0, 0, 1, 1).data)
								.slice(0, 3)
								.map((n) => n.toString(16).padStart(2, "0"))
								.join("")
						);
					};
					return {
						text: hex(getComputedStyle(e).color),
						background: hex(getComputedStyle(e).backgroundColor),
						icon: hex(getComputedStyle(e.querySelector("svg") ?? e).color),
					};
				});
			expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(colors.icon, colors.background)).toBeGreaterThanOrEqual(3);
		});
	}

for (const answer of ["Je ne sais pas", "Interrupt"])
	test(`wrong and unknown gate parity: ${answer}`, async ({ page }) => {
		await page.goto(`${readTestEnv().url}/dont-know-ink-false-fr-true/index.html`);
		const next = page.locator("#deck-next");
		const attempt = page.locator('[data-island="assessment"][data-block-id="attempt"]');
		await expect(attempt).toHaveAttribute("data-hydrated", "");
		await next.click();
		await expect(page.locator('[data-deck-slide="attempt-page"]')).toBeVisible();
		await expect(page.locator('[data-deck-slide="pass-page"]')).toBeHidden();
		await attempt.getByRole("radio", { name: "Je ne sais pas", exact: true }).check();
		await attempt.locator("[data-assessment-submit]").click();
		await next.click();
		await expect(page.locator('[data-deck-slide="pass-page"]')).toBeVisible();
		const pass = page.locator('[data-island="assessment"][data-block-id="pass"]');
		await expect(pass).toHaveAttribute("data-hydrated", "");
		const defaultPass = page.locator('[data-island="assessment"][data-block-id="default-pass"]');
		await defaultPass.scrollIntoViewIfNeeded();
		await expect(defaultPass).toHaveAttribute("data-hydrated", "");
		await expect(defaultPass.locator("[data-dont-know]")).toHaveCount(0);
		await defaultPass.getByRole("radio", { name: "Listen", exact: true }).check();
		await defaultPass.locator("[data-assessment-submit]").click();
		await pass.getByRole("radio", { name: answer, exact: true }).check();
		await pass.locator("[data-assessment-submit]").click();
		await next.click();
		await expect(page.locator('[data-deck-slide="pass-page"]')).toBeVisible();
		await expect(page.locator('[data-deck-slide="done-page"]')).toBeHidden();
		await pass.locator(".praxity-assessment-retry button").click();
		await pass.getByRole("radio", { name: answer, exact: true }).check();
		await pass.locator("[data-assessment-submit]").click();
		await next.click();
		await expect(page.locator('[data-deck-slide="final-page"]')).toBeVisible();
		const final = page.locator('[data-island="assessment"][data-block-id="final"]');
		await expect(final).toHaveAttribute("data-hydrated", "");
		await final.getByRole("radio", { name: answer, exact: true }).check();
		await final.locator("[data-assessment-submit]").click();
		await next.click();
		await expect(page.locator('[data-deck-slide="group-page"]')).toBeVisible();
		for (const id of ["final-first", "final-second"]) {
			const card = page.locator(`[data-island="assessment"][data-block-id="${id}"]`);
			await card.scrollIntoViewIfNeeded();
			await expect(card).toHaveAttribute("data-hydrated", "");
			await card
				.getByRole("radio", { name: id === "final-first" ? answer : "Listen", exact: true })
				.check();
		}
		await page
			.locator('[data-assessment-group-submit="final-group"] .praxity-ag-submit-btn')
			.click();
		await expect(
			page.locator('[data-assessment-group-submit="final-group"] .praxity-ag-results-score'),
		).toContainText(
			answer === "Je ne sais pas" ? "1 sur 2 correctes, 1 « Je ne sais pas »" : "1 sur 2 correctes",
		);
		await next.click();
		await expect(page.locator('[data-deck-slide="done-page"]')).toBeVisible();
	});
