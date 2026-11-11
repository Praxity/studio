import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { canvasMessages } from "../../src/shared/canvas-messages";
import { startJourney } from "./global-setup";

const expected = {
	en: "lesson.prax, line 23, column 1: Move correct: and incorrect: before the choice options in the .prax file to edit this lesson's text.",
	fr: "lesson.prax, ligne 23, colonne 1 : Déplacez correct: et incorrect: avant les options du choix dans le fichier .prax pour modifier le texte de cette leçon.",
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
				const source = await readFile(
					new URL("./fixtures/source-error-feedback-after-options.prax", import.meta.url),
					"utf8",
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
				await expect(
					page.getByRole("heading", { name: "Page d-c1.prax", exact: true }),
				).toBeVisible();
				await page.getByRole("link", { name: canvasMessages[locale].enter, exact: true }).click();
				const status = page.locator("#studio-status");
				await expect(status).toHaveText(expected[locale]);
				await expect(status).toHaveAttribute("aria-live", "polite");
				await expect(status).not.toContainText(/grammar\.v4|rt-|Datenschutz|bartholomew/);
				await expect(
					page.getByRole("button", {
						name: /^(Edit|Modifier) (heading|paragraph|choice|le titre|le paragraphe|le libellé)/,
					}),
				).toHaveCount(0);
				await page.reload();
				await expect(status).toHaveText(expected[locale]);
				const authorUrl = page.url();
				const readUrl = await page
					.getByRole("link", { name: canvasMessages[locale].read, exact: true })
					.getAttribute("href");
				if (!readUrl) throw new Error("Missing Read destination");
				// Close the old document so automatic refresh cannot mask a broken recovery route.
				if (recovery !== "refresh") {
					await page.goto("about:blank");
				}
				await writeFile(
					join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "lesson.prax"),
					source.replace(/^(correct:.*|incorrect:.*)\r?\n/gmu, ""),
				);
				if (recovery === "reload") await page.goto(authorUrl);
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
