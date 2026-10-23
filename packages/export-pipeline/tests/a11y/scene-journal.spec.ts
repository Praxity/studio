import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import AdmZip from "adm-zip";
import { expectForcedEmulationInert, forcedPalette } from "../focus-assertions";
import { test } from "../muted-test";
import { computedContrast } from "./contrast-helpers";
import { readTestEnv } from "./helpers";

test.use({ timezoneId: "UTC" });

const savedAt = "2026-10-08T14:05:00.000Z";
const journalSelector = '[data-island="assessment"][data-block-id="journal"]';
async function open(page: Page, palette = "ink", mode = "light", locale = "en") {
	await page.goto(`${readTestEnv().url}/${palette}-${mode}-${locale}/index.html`);
	const journal = page.locator(journalSelector);
	await journal.scrollIntoViewIfNeeded();
	await expect(journal).toHaveAttribute("data-hydrated", "");
	await page.evaluate(() => document.fonts.ready);
	return journal;
}
async function capture(journal: Locator, name: string, browserName: string) {
	const folder = process.env.PRAXITY_JOURNAL_SHOTS;
	if (folder && browserName === "chromium") {
		await mkdir(folder, { recursive: true });
		await journal.screenshot({ path: resolve(folder, `${name}.png`) });
	}
}
for (const [palette, mode] of [
	["ink", "light"],
	["clay", "dark"],
]) {
	for (const width of [1280, 390]) {
		for (const direction of ["ltr", "rtl"]) {
			test(`scene geometry ${palette} ${mode} ${width} ${direction}`, async ({
				page,
				browserName,
			}) => {
				await page.setViewportSize({ width, height: 900 });
				await page.clock.setFixedTime(new Date(savedAt));
				const journal = await open(page, palette, mode);
				await page.evaluate((dir) => {
					document.documentElement.dir = dir;
				}, direction);
				const band = journal.locator(".praxity-scene");
				await expect(band).toHaveCount(1);
				const measured = await band.evaluate((element) => {
					const card = element.closest(".praxity-block-assessment");
					const tile = element.querySelector(".praxity-scene-icon");
					const title = element.querySelector(".praxity-scene-title");
					if (!card || !tile || !title) throw new Error("Missing scene geometry");
					const b = element.getBoundingClientRect(),
						c = card.getBoundingClientRect(),
						i = tile.getBoundingClientRect(),
						t = title.getBoundingClientRect();
					return {
						width: i.width,
						height: i.height,
						center: Math.abs(i.y + i.height / 2 - t.y - t.height / 2),
						left: Math.abs(b.left - c.left),
						right: Math.abs(b.right - c.right),
						top: Math.abs(b.top - c.top),
						bandRadius: getComputedStyle(element).borderStartStartRadius,
						cardRadius: getComputedStyle(card).borderStartStartRadius,
					};
				});
				expect(measured.width).toBe(40);
				expect(measured.height).toBe(40);
				expect(measured.center).toBeLessThanOrEqual(1);
				for (const edge of [measured.left, measured.right, measured.top])
					expect(edge).toBeLessThanOrEqual(0.5);
				expect(measured.bandRadius).toBe(measured.cardRadius);
				await expect(band.locator("p#assessment-question-journal")).toHaveCount(1);
				await expect(journal.locator("h1,h2,h3,h4,h5,h6")).toHaveCount(0);
				await expect(band.locator(".praxity-assessment-stem")).toHaveCSS(
					"text-wrap",
					await page.evaluate(() => (CSS.supports("text-wrap", "pretty") ? "pretty" : "wrap")),
				);
				for (const id of ["choice", "plain-response"])
					await expect(page.locator(`[data-block-id="${id}"] .praxity-scene`)).toHaveCount(0);
				if (mode === "dark")
					await expect(journal.locator(".praxity-block-assessment")).toHaveCSS(
						"box-shadow",
						"none",
					);
				const name = `${palette}-${mode}-${width}-${direction}`;
				await capture(journal, `${name}-before`, browserName);
				await journal.getByRole("textbox").fill("I will listen before responding.");
				await journal.getByRole("button", { name: "Complete reflection", exact: true }).click();
				await expect(journal.locator("[data-journal-saved-date]")).toHaveText(/^Saved /);
				await capture(journal, `${name}-saved`, browserName);
			});
		}
	}
}

test("scene icon contrast in every preset and mode", async ({ page }) => {
	for (const palette of ["ink", "forest", "plum", "clay", "clear"]) {
		for (const mode of ["light", "dark"]) {
			const journal = await open(page, palette, mode);
			const ratio = await computedContrast(journal.locator(".praxity-scene-icon"));
			expect(ratio, `${palette} ${mode}`).toBeGreaterThanOrEqual(3);
		}
	}
});

test("forced colors and print retain the prompt", async ({ page, browserName }) => {
	await page.emulateMedia({ forcedColors: "active" });
	const journal = await open(page);
	const tile = journal.locator(".praxity-scene-icon");
	if (!(await forcedPalette(page))) {
		await expectForcedEmulationInert(page, [tile]);
		expect(await computedContrast(tile)).toBeGreaterThanOrEqual(3);
	} else {
		await expect(tile).toHaveCSS("border-top-width", "1px");
		await expect(tile).toHaveCSS("border-top-style", "solid");
	}
	await capture(journal, "forced-colors", browserName);
	await page.emulateMedia({ forcedColors: "none", media: "print" });
	await expect(tile).toBeHidden();
	await expect(journal.locator(".praxity-scene")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await expect(journal.locator("#assessment-question-journal")).toBeVisible();
});

for (const locale of ["en", "fr"]) {
	test(`saved entry date, restore and downloads ${locale}`, async ({ page }) => {
		await page.clock.setFixedTime(new Date(savedAt));
		const journal = await open(page, "ink", "light", locale);
		await page.evaluate(
			(lang) => {
				document.documentElement.lang = lang;
			},
			locale === "en" ? "en-GB" : "fr-CA",
		);
		await journal.getByRole("textbox").fill("My saved response");
		await expect(journal.locator("[data-journal-saved-date]")).toHaveCount(0);
		await journal
			.getByRole("button", {
				name: locale === "en" ? "Complete reflection" : "Terminer la réflexion",
				exact: true,
			})
			.click();
		const date =
			locale === "en"
				? "Saved 8 October 2026 at 14:05"
				: await page.evaluate(() => {
						const instant = new Date("2026-10-08T14:05:00.000Z");
						const day = new Intl.DateTimeFormat("fr-CA", {
							dateStyle: "long",
							timeZone: "UTC",
						}).format(instant);
						const time = new Intl.DateTimeFormat("fr-CA", {
							timeStyle: "short",
							timeZone: "UTC",
						}).format(instant);
						return `Enregistré le ${day} à ${time}`;
					});
		await expect(journal.locator("[data-journal-saved-date]")).toHaveText(date);
		await expect(journal.locator("[data-journal-saved-date]")).toContainText(
			locale === "en" ? "8 October 2026" : "8 octobre 2026",
		);
		await expect(journal.locator("[data-journal-saved-date]")).not.toHaveAttribute("aria-live");
		for (const [format, name] of [
			["txt", locale === "en" ? "Download as text" : "Télécharger en texte"],
			["docx", locale === "en" ? "Download as Word" : "Télécharger en Word"],
		]) {
			const event = page.waitForEvent("download");
			await journal.getByRole("button", { name, exact: true }).click();
			const file = await (await event).path();
			if (!file) throw new Error("Missing download");
			const bytes = await readFile(file);
			const text =
				format === "txt"
					? bytes.toString("utf8")
					: new AdmZip(bytes).readAsText("word/document.xml");
			expect(text).toContain(date);
			expect(text).toContain("My saved response");
		}
		await page.clock.setFixedTime(new Date("2026-10-09T18:00:00.000Z"));
		await page.reload();
		await journal.scrollIntoViewIfNeeded();
		await expect(journal).toHaveAttribute("data-hydrated", "");
		await page.evaluate(
			(lang) => {
				document.documentElement.lang = lang;
			},
			locale === "en" ? "en-GB" : "fr-CA",
		);
		await expect(journal.getByRole("textbox")).toHaveValue("My saved response");
		await expect(journal.locator("[data-journal-saved-date]")).toHaveText(date);
		await expect(journal.locator("[data-journal-saved-date]")).toHaveAttribute(
			"data-saved-at",
			savedAt,
		);
	});
}

for (const saved of [undefined, "corrupt", "2026-02-30T14:05:00.000Z"]) {
	test(`old or corrupt timestamp restores response ${saved}`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.addInitScript(
			({ saved }) => {
				Object.defineProperty(window, "__praxityBlockState", {
					configurable: true,
					get: () => ({
						get: (id: string) =>
							id === "journal"
								? {
										version: 1,
										kind: "assessment",
										assessmentType: "textResponse",
										attemptCount: 1,
										checked: true,
										correct: false,
										completed: true,
										interacted: true,
										answer: "Older reflection",
										savedAt: saved,
									}
								: undefined,
						set: () => {},
					}),
					set: () => {},
				});
			},
			{ saved },
		);
		const journal = await open(page);
		await expect(journal.getByRole("textbox")).toHaveValue("Older reflection");
		await expect(journal.locator("[data-journal-saved-date]")).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}
