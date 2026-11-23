import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { initializeCourseIdentity } from "../../src/main/identity-store";
import { startJourney } from "./global-setup";

const source =
	"---\ntitle: Admission\nvariables:\n  picked: false\n---\n# Practice\n::: text {name=publicText}\nPublic\n:::\n::: choice HIDDEN QUESTION {private name=priv}\n(x) HIDDEN ANSWER\n( ) Other\n:::\n";
const lines = source.trimEnd().split("\n");
while (lines.length < 19) lines.push("");
const refused =
	`${lines.join("\n")}\n::: rule\nif: @priv.isCompleted is true\nthen: set picked = true\n:::\n`.replace(
		"private name",
		"private required name",
	);
const expected = {
	en: "lesson.prax, line 10, column 1: A private choice must be optional, unscored, outside assessment groups and without a gate.\nlesson.prax, line 21, column 1: This practice activity cannot be read by course logic, write course state, supply a score or progression condition, or be required directly or through a container.",
	fr: "lesson.prax, ligne 10, colonne 1 : Un choix privé doit être facultatif, sans score, hors des groupes d’évaluations et sans condition de progression.\nlesson.prax, ligne 21, colonne 1 : Cette activité de pratique ne peut être lue par la logique du cours, modifier l’état du cours, fournir un score ou une condition de progression, ni être obligatoire directement ou par l’intermédiaire d’un conteneur.",
};

for (const locale of ["en", "fr"] as const) {
	for (const width of [1280, 390, 320]) {
		test(`${locale} ${width}: localized refusal preserves Read and clears after repair`, async ({
			browser,
			page,
		}) => {
			const fixture = await mkdtemp(
				join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "practice-refusal-"),
			);
			let stop: (() => Promise<void>) | undefined;
			try {
				await writeFile(
					join(fixture, "course.yaml"),
					`title: Admission\nlocale: ${locale}\nlessons: [lesson.prax]\n`,
				);
				await writeFile(join(fixture, "lesson.prax"), source);
				await initializeCourseIdentity(fixture, ["lesson.prax"]);
				stop = await startJourney(browser, { courseFixture: fixture });
				const ready = process.env.PRAXITY_BROWSER_READY_URL ?? "";
				const origin = new URL(ready).origin;
				const file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "lesson.prax");
				await page.setViewportSize({ width, height: 900 });
				await page.goto(ready);
				await expect(page.getByRole("heading", { name: "Practice", exact: true })).toBeVisible();
				const originalRead = page.url();
				for (const invalid of [refused, `${refused}\nExtra prose.\n`]) {
					await writeFile(file, invalid);
					const launch = await page.request.get(`${origin}/launch?canvas=read`, {
						maxRedirects: 0,
					});
					const response = await page.request.get(new URL(launch.headers().location, origin).href, {
						maxRedirects: 0,
					});
					expect(response.status()).toBe(422);
					const message = (await response.json()).error.message;
					expect(message).toBe(expected[locale]);
					expect(message).not.toMatch(/HIDDEN|@priv|picked/);
					expect((await page.request.get(originalRead)).status()).toBe(200);
					await expect(page.getByRole("heading", { name: "Practice", exact: true })).toBeVisible();
				}
				await writeFile(file, source);
				await page.goto(ready);
				await expect(page.getByRole("heading", { name: "Practice", exact: true })).toBeVisible();
			} finally {
				await page.goto("about:blank");
				await stop?.();
				await rm(fixture, { recursive: true });
			}
		});
	}
}
