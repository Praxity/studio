import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { initializeCourseIdentity } from "../../src/main/identity-store";
import { canvasMessages } from "../../src/shared/canvas-messages";
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
				const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
				const file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "lesson.prax");
				await page.setViewportSize({ width, height: 900 });
				await page.goto(`${origin}/launch?canvas=1`);
				const status = page.locator("#studio-status");
				const read = page.getByRole("link", { name: canvasMessages[locale].read, exact: true });
				await expect(status).toHaveText(canvasMessages[locale].connected);
				const originalRead = await read.getAttribute("href");
				await expect(page.getByRole("heading", { name: "Practice", exact: true })).toBeVisible();
				await writeFile(file, refused);
				await expect(status).toHaveText(expected[locale]);
				await expect(status).toHaveAttribute("role", "status");
				await expect(status).toHaveAttribute("aria-live", "polite");
				await expect(status).toHaveAttribute("aria-atomic", "true");
				await expect(status).not.toContainText(/HIDDEN|@priv|picked/);
				await expect(read).toHaveAttribute("href", originalRead ?? "");
				await expect(read).toBeVisible();
				await expect(page.getByRole("heading", { name: "Practice", exact: true })).toBeVisible();
				const bounds = await read.boundingBox();
				if (!bounds) throw new Error("Read link has no layout box");
				expect(bounds.x).toBeGreaterThanOrEqual(0);
				expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
				await read.focus();
				await expect(read).toBeFocused();
				await status.evaluate((element) => {
					Reflect.set(element, "practiceMutations", 0);
					new MutationObserver(() => {
						Reflect.set(
							element,
							"practiceMutations",
							Number(Reflect.get(element, "practiceMutations")) + 1,
						);
					}).observe(element, { childList: true, characterData: true, subtree: true });
				});
				const repeat = page.waitForResponse(
					(response) =>
						response.url().endsWith("/api/rpc") &&
						response.request().postDataJSON()?.method === "canvasPreviewBuild",
				);
				await writeFile(file, `${refused}\nExtra prose.\n`);
				expect((await repeat).status()).toBe(422);
				await expect(read).not.toHaveAttribute("aria-busy", "true");
				expect(await status.evaluate((element) => Reflect.get(element, "practiceMutations"))).toBe(
					0,
				);
				await writeFile(file, source);
				await expect(status).toHaveText(canvasMessages[locale].connected);
				await expect(read).toHaveAttribute("href", /canvas\/preview/);
			} finally {
				await page.goto("about:blank");
				await stop?.();
				await rm(fixture, { recursive: true, force: true });
			}
		});
	}
}
