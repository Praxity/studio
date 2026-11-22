import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createStudioProjectSession } from "../../src/main/studio/project-session";
import { startJourney } from "./global-setup";

const expected = {
	en: "lesson.prax, line 27, column 1: Fix the feedback lines in this lesson's .prax file to edit its text. Put correct: and incorrect: before the answer choices, and feedback: directly under its choice, with no blank line.",
	fr: "lesson.prax, ligne 27, colonne 1 : Corrigez les lignes de rétroaction dans le fichier .prax de cette leçon pour en modifier le texte. Placez correct: et incorrect: avant les choix de réponse, et feedback: directement sous le choix concerné, sans ligne vide.",
};

for (const locale of ["en", "fr"] as const) {
	test(`${locale}: located source refusal and repaired Read retain the same lesson`, async ({
		browser,
		page,
	}) => {
		const fixture = await mkdtemp(
			join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "source-error-"),
		);
		let stop: (() => Promise<void>) | undefined;
		let session: Awaited<ReturnType<typeof createStudioProjectSession>> | undefined;
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
			const root = process.env.PRAXITY_BROWSER_PROJECT ?? "";
			session = await createStudioProjectSession(root, "test", undefined, undefined, locale);
			const scope = {
				editorSeq: 0,
				file: "lesson.prax",
				lessonId: "lesson",
				pageId: "page",
				pageIds: ["page"],
				pageIndex: 0,
			};
			const refused = (await session.invoke("canvasTextSnapshot", {}, scope)) as {
				sourceRefusal?: string;
			};
			expect(refused.sourceRefusal).toBe(expected[locale]);
			expect(refused.sourceRefusal).not.toMatch(/grammar\.v4|rt-|Datenschutz|bartholomew/);
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
			await writeFile(
				join(root, "lesson.prax"),
				source.replace(/^(correct:.*|incorrect:.*)\r?\n/gmu, ""),
			);
			expect(
				((await session.invoke("canvasTextSnapshot", {}, scope)) as { sourceRefusal?: string })
					.sourceRefusal,
			).toBeUndefined();
			await page.goto(process.env.PRAXITY_BROWSER_READY_URL ?? "");
			await page.getByRole("link", { name: "d-c1.prax", exact: true }).click();
			await page.getByRole("link", { name: "Page d-c1.prax", exact: true }).click();
			await expect(
				page.getByRole("heading", { name: "Page d-c1.prax", exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("heading", { name: "First course page", exact: true }),
			).toHaveCount(0);
			await expect(page.getByRole("heading", { name: "Lesson opening", exact: true })).toHaveCount(
				0,
			);
		} finally {
			await session?.close();
			await page.goto("about:blank");
			await stop?.();
			await rm(fixture, { recursive: true });
		}
	});
}
