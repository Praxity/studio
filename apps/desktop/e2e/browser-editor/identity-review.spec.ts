import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { initializeCourseIdentity } from "../../src/main/identity-store";
import { startJourney } from "./global-setup";

async function identityBytes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const file = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await identityBytes(root, file));
		else result[file] = (await readFile(join(root, file))).toString("base64");
	}
	return result;
}

for (const locale of ["en", "fr"] as const) {
	for (const duplicated of [false, true]) {
		test(`${locale} retirement gate ${duplicated ? "blocks ambiguous rederive" : "confirms retirement"}, focuses and describes the heading, supports keyboard decline and preserves Read`, async ({
			browser,
			page,
		}, testInfo) => {
			const fixture = await mkdtemp(
				join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "identity-gate-"),
			);
			let stop: (() => Promise<void>) | undefined;
			try {
				await mkdir(join(fixture, "course"));
				const course = join(fixture, "course");
				await writeFile(
					join(course, "course.yaml"),
					`title: Example\nlocale: ${locale}\nlessons: [first.prax]\n`,
				);
				await writeFile(
					join(course, "first.prax"),
					`# First\n\nDeleted body.\n\nRetained body.\n${duplicated ? "\nDuplicated body.\n" : ""}`,
				);
				await initializeCourseIdentity(course, ["first.prax"]);
				const source = `# First\n\nRetained body.\n${duplicated ? "\nDuplicated body.\n\nDuplicated body.\n" : ""}`;
				await writeFile(join(course, "first.prax"), source);
				const original = await identityBytes(join(course, ".praxity", "identity"));
				stop = await startJourney(browser, { courseFixture: course });
				const ready = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "");
				const project = process.env.PRAXITY_BROWSER_PROJECT ?? "";
				const heading =
					locale === "fr"
						? "Certains blocs recevraient de nouveaux identifiants"
						: "Some blocks would get new IDs";
				const warning =
					locale === "fr"
						? "Si ce cours a été publié, les données des apprenants ne correspondront plus à ces blocs."
						: "If this course has been published, learner records for these blocks stop matching.";
				const duplicates =
					locale === "fr"
						? "Initialisation des identités refusée : first.prax:5 répète un texte existant. Rendez-le unique, puis lancez praxity identity init <course>. Si d'autres modifications restent à traiter, lancez cette commande avec --rederive --confirm-unpublished uniquement si ce cours n'a jamais été publié."
						: "Identity initialization refused: first.prax:5 repeats existing text. Make it unique, then run praxity identity init <course>. If other changes remain, run it with --rederive --confirm-unpublished only if this course has never been published.";
				await page.goto(`${ready.origin}/launch`);
				await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeFocused();
				await expect(page.getByRole("heading", { name: heading })).toHaveAccessibleDescription(
					`${warning}${duplicated ? ` ${duplicates}` : ""}`,
				);
				await expect(page.locator("html")).toHaveAttribute("lang", locale);
				await expect(page.getByRole("list")).toContainText("first.prax: First; Deleted body.");
				await expect(page.getByRole("list")).toContainText(
					locale === "fr" ? "Ligne inconnue" : "Line unknown",
				);
				await page.screenshot({
					path: testInfo.outputPath(`identity-gate-${locale}-wide.png`),
					fullPage: true,
				});
				expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
				await page.setViewportSize({ width: 375, height: 900 });
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
				await page.keyboard.press("Tab");
				if (duplicated) {
					await expect(page.getByRole("button")).toHaveCount(0);
					await expect(page.getByText(duplicates, { exact: true })).toBeVisible();
					await expect(page.getByRole("list")).not.toContainText("Duplicated body.");
				} else {
					await expect(
						page.getByRole("button", {
							name:
								locale === "fr"
									? "Je n'ai pas publié ce cours : continuer."
									: "I haven't published this course: continue.",
						}),
					).toBeFocused();
				}
				await page.screenshot({
					path: testInfo.outputPath(`identity-gate-${locale}-keyboard-narrow.png`),
					fullPage: true,
				});
				if (!duplicated) await page.keyboard.press("Tab");
				await expect(
					page.getByRole("link", { name: locale === "fr" ? "Fermer" : "Close", exact: true }),
				).toBeFocused();
				await page.keyboard.press("Enter");
				await expect(page.getByText("Retained body.", { exact: true })).toBeVisible();
				expect(new URL(page.url()).origin).not.toBe(ready.origin);
				expect(await identityBytes(join(project, ".praxity", "identity"))).toEqual(original);
				await page.goto(`${ready.origin}/launch?canvas=1`);
				await expect(page.getByRole("heading", { name: heading })).toBeFocused();
				expect(await identityBytes(join(project, ".praxity", "identity"))).toEqual(original);
				if (duplicated) {
					await expect(page.getByRole("button")).toHaveCount(0);
					expect(await readFile(join(project, "first.prax"), "utf8")).toBe(source);
					return;
				}
				await page.keyboard.press("Tab");
				await page.keyboard.press("Enter");
				await expect(
					page.getByRole("button", {
						name: locale === "fr" ? "Modifier le texte" : "Edit text",
						exact: true,
					}),
				).toBeVisible();
				expect(new URL(page.url()).origin).toBe(ready.origin);
				expect(await identityBytes(join(project, ".praxity", "identity"))).not.toEqual(original);
				expect(await readFile(join(project, "first.prax"), "utf8")).toBe(source);
			} finally {
				await stop?.();
				await rm(fixture, { recursive: true, force: true });
			}
		});
	}

	test(`${locale} outside refresh stays transient and a refused write reviews changes without losing kept input`, async ({
		browser,
		page,
	}) => {
		const fixture = await mkdtemp(
			join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "identity-live-"),
		);
		let stop: (() => Promise<void>) | undefined;
		try {
			const before = "# First\n\n## Editable heading\n\nOriginal body.\n";
			const after = "# First\n\n## Editable heading\n\nA wholly different explanation.\n";
			await mkdir(join(fixture, "course"));
			const course = join(fixture, "course");
			await writeFile(
				join(course, "course.yaml"),
				`title: Example\nlocale: ${locale}\nlessons: [first.prax]\n`,
			);
			await writeFile(join(course, "first.prax"), before);
			await initializeCourseIdentity(course, ["first.prax"]);
			stop = await startJourney(browser, { courseFixture: course });
			const ready = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "");
			const project = process.env.PRAXITY_BROWSER_PROJECT ?? "";
			const original = await identityBytes(join(project, ".praxity", "identity"));
			await page.goto(`${ready.origin}/launch?canvas=1`);
			await expect(page.getByRole("status")).toHaveText(locale === "fr" ? "Connecté" : "Connected");
			await writeFile(join(project, "first.prax"), after);
			await expect(
				page.getByText("A wholly different explanation.", { exact: true }),
			).toBeVisible();
			expect(await identityBytes(join(project, ".praxity", "identity"))).toEqual(original);
			const edit = page.getByRole("button", {
				name:
					locale === "fr"
						? "Modifier le titre 2 : Editable heading"
						: "Edit heading 2: Editable heading",
				exact: true,
			});
			await edit.click();
			const field = page.getByRole("textbox", {
				name: locale === "fr" ? "Texte du titre" : "Heading text",
				exact: true,
			});
			await field.fill("Kept exact *text*");
			const refused = page.waitForResponse(
				(response) =>
					response.url().endsWith("/api/rpc") &&
					response.request().postDataJSON().method === "canvasTextApply",
			);
			await field.press("Enter");
			expect((await refused).status()).toBe(200);
			expect(await (await refused).json()).toMatchObject({
				ok: true,
				result: { ok: false, code: "identity-retirement-pending", reviewUrl: "/launch" },
			});
			const message =
				locale === "fr"
					? "Ce cours a été modifié hors de Studio, et du contenu enregistré a été retiré. Examinez les modifications avant de modifier. Copiez d'abord votre texte si vous voulez le garder."
					: "This course changed outside Studio, and some saved content was removed. Review the changes before you edit. Copy your text first if you want to keep it.";
			await expect(page.getByRole("status")).toHaveText(message);
			await expect(field).toBeFocused();
			await expect(field).toHaveValue("Kept exact *text*");
			await expect(
				page.getByRole("button", {
					name: locale === "fr" ? "Copier le texte" : "Copy text",
					exact: true,
				}),
			).toBeVisible();
			const review = page.getByRole("button", {
				name: locale === "fr" ? "Examiner les modifications" : "Review changes",
				exact: true,
			});
			await page.keyboard.press("Tab");
			await expect(review).toBeFocused();
			await review.click();
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Continuer la modification" : "Keep editing",
					exact: true,
				})
				.click();
			await expect(field).toBeFocused();
			await expect(field).toHaveValue("Kept exact *text*");
			expect(await identityBytes(join(project, ".praxity", "identity"))).toEqual(original);
			expect(await readFile(join(project, "first.prax"), "utf8")).toBe(after);
			await review.click();
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Abandonner le texte et recharger" : "Discard text and reload",
					exact: true,
				})
				.click();
			await expect(page.locator("main > ul > li")).toHaveText([
				`first.prax: First; Original body.; ${locale === "fr" ? "Ligne inconnue" : "Line unknown"}`,
			]);
			await page
				.getByRole("link", { name: locale === "fr" ? "Fermer" : "Close", exact: true })
				.click();
			await expect(
				page.getByText("A wholly different explanation.", { exact: true }),
			).toBeVisible();
			expect(await identityBytes(join(project, ".praxity", "identity"))).toEqual(original);
			await page.goto(`${ready.origin}/launch`);
			await page
				.getByRole("button", {
					name:
						locale === "fr"
							? "Je n'ai pas publié ce cours : continuer."
							: "I haven't published this course: continue.",
					exact: true,
				})
				.click();
			await edit.click();
			await field.fill("Saved after review");
			await field.press("Enter");
			await expect(
				page.getByRole("heading", { name: "Saved after review", exact: true }),
			).toBeVisible();
			expect(await readFile(join(project, "first.prax"), "utf8")).toBe(
				"# First\n\n## Saved after review\n\nA wholly different explanation.\n",
			);
		} finally {
			await stop?.();
			await rm(fixture, { recursive: true });
		}
	});
}
