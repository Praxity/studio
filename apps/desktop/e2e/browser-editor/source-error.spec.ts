import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { canvasMessages } from "../../src/shared/canvas-messages";
import { startJourney } from "./global-setup";

const expected = {
	en: "lesson.prax, line 27, column 1: Fix the feedback lines in this lesson's .prax file to edit its text. Put correct: and incorrect: before the answer choices, and feedback: directly under its choice, with no blank line.",
	fr: "lesson.prax, ligne 27, colonne 1 : Corrigez les lignes de rétroaction dans le fichier .prax de cette leçon pour en modifier le texte. Placez correct: et incorrect: avant les choix de réponse, et feedback: directement sous le choix concerné, sans ligne vide.",
};

for (const locale of ["en", "fr"] as const) {
	for (const recovery of ["refresh", "reload", "edit-link"] as const) {
		test(`${locale}: source refusal and ${recovery} recover the same lesson`, async ({
			browser,
			page,
		}) => {
			const fixture = await mkdtemp(
				join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "source-error-"),
			);
			let stop: (() => Promise<void>) | undefined;
			try {
				const original = await readFile(
					new URL("./fixtures/source-error-feedback-after-options.prax", import.meta.url),
					"utf8",
				);
				const source = original.replace(
					"# Page d-c1.prax",
					"# Lesson opening\n\nOpening text.\n\n# Page d-c1.prax",
				);
				await writeFile(
					join(fixture, "course.yaml"),
					`title: Example\nlocale: ${locale}\nlessons: [intro.prax, lesson.prax]\n`,
				);
				await writeFile(
					join(fixture, "intro.prax"),
					"---\ntitle: Introduction\n---\n# First course page\n\nIntro.\n",
				);
				await writeFile(join(fixture, "lesson.prax"), source);
				stop = await startJourney(browser, { courseFixture: fixture });
				const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
				await page.goto(`${origin}/launch?canvas=read`);
				await page.getByRole("link", { name: "d-c1.prax", exact: true }).click();
				await page.getByRole("link", { name: "Page d-c1.prax", exact: true }).click();
				await expect(
					page.getByRole("heading", { name: "Page d-c1.prax", exact: true }),
				).toBeVisible();
				await page.getByRole("link", { name: canvasMessages[locale].enter, exact: true }).click();
				const status = page.locator("#studio-status");
				await expect(status).toHaveText(expected[locale]);
				await expect(status).toHaveAttribute("aria-live", "polite");
				await expect(status).not.toContainText(/grammar\.v4|rt-|Datenschutz|bartholomew/);
				// The toggle is the only author button, regardless of editable kind.
				await expect(page.getByRole("button", { name: /^(Edit|Modifier) / })).toHaveCount(1);
				const toggle = page.getByRole("button", {
					name: canvasMessages[locale].enter,
					exact: true,
				});
				await toggle.click();
				await expect(status).toHaveText(expected[locale]);
				await toggle.click();
				await expect(status).toHaveText(expected[locale]);
				await page.reload();
				await expect(status).toHaveText(expected[locale]);
				const authorUrl = page.url();
				const readUrl = await page
					.getByRole("link", { name: canvasMessages[locale].read, exact: true })
					.getAttribute("href");
				if (!readUrl) throw new Error("Missing Read destination");
				await writeFile(
					join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "lesson.prax"),
					source.replace(/^(correct:.*|incorrect:.*)\r?\n/gmu, ""),
				);
				// Keep Edit open until a newer captured build exists. Both routes below use the old revision.
				await expect(status).toHaveText(canvasMessages[locale].connected);
				await expect(page).not.toHaveURL(authorUrl);
				if (recovery === "reload") {
					// Evict the captured source-error build from the four-build ring.
					for (let revision = 0; revision < 3; revision++) {
						const previousUrl = page.url();
						await writeFile(
							join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "intro.prax"),
							`# First course page\n\nOutside change ${revision}.\n`,
						);
						await expect(page).not.toHaveURL(previousUrl);
						await expect(status).toHaveText(canvasMessages[locale].connected);
					}
					// Address a tab to its retained old revision, then exercise the real document Reload redirect.
					await page.evaluate((url) => history.replaceState(null, "", url), authorUrl);
					const response = await page.reload();
					expect(response?.request().redirectedFrom()?.url()).toBe(authorUrl);
				}
				if (recovery === "edit-link") {
					await page.goto(readUrl);
					await page.getByRole("link", { name: canvasMessages[locale].enter, exact: true }).click();
				}
				await expect(status).toHaveText(canvasMessages[locale].connected);
				await expect(
					page.getByRole("heading", { name: "Page d-c1.prax", exact: true }),
				).toBeVisible();
				await expect(
					page.getByRole("heading", { name: "First course page", exact: true }),
				).toHaveCount(0);
				await expect(
					page.getByRole("heading", { name: "Lesson opening", exact: true }),
				).toHaveCount(0);
				await expect(
					page.getByRole("button", {
						name: `${locale === "en" ? "Edit paragraph 1: " : "Modifier le paragraphe 1 : "}Intro paragraph.`,
						exact: true,
					}),
				).toBeVisible();
			} finally {
				await page.goto("about:blank");
				await stop?.();
				await rm(fixture, { recursive: true, force: true });
			}
		});
	}
}
