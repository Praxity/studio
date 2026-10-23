import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { runPraxityCli } from "../../src/main/cli";
import { persistFixtureIdentity } from "../../src/test-utils/identity-fixture";
import {
	interruptProjectWrite,
	projectDiskSnapshot,
} from "../../src/test-utils/interrupted-project-write";

for (const target of ["lesson.prax", "course.yaml"]) {
	test(`editor open recovers a dead writer's ${target} and loads the original lesson`, async ({
		page,
	}) => {
		const parent = await mkdtemp(
			join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "browser-recovery-"),
		);
		const root = join(parent, "course");
		await mkdir(root);
		const source = "---\ntitle: Recovery\n---\n\n# Original\n\nOriginal body.\n";
		const manifest = "id: recovery-course\ntitle: Recovery\nlessons: [lesson.prax]\n";
		await writeFile(join(root, "lesson.prax"), source);
		await writeFile(join(root, "course.yaml"), manifest);
		await persistFixtureIdentity(root);
		await interruptProjectWrite(
			root,
			target,
			target === "lesson.prax" ? `${source}New.\n` : `${manifest}description: New\n`,
		);
		const result = await runPraxityCli(["studio", root, "--no-open"], {
			appVersion: "0.3.0",
			exportAssetsDir: join(import.meta.dirname, "../../resources/export-assets"),
			editorAssetsDir: process.env.PRAXITY_BROWSER_EDITOR_ASSETS,
		});
		try {
			expect(result.exitCode, result.stderr).toBe(0);
			if (!result.studioServer) throw new Error(result.stderr);
			const before = await projectDiskSnapshot(root);
			await page.addInitScript(() =>
				localStorage.setItem(
					"praxity.studio.preferences",
					JSON.stringify({ locale: "en", autoSave: false }),
				),
			);
			await page.goto(result.studioServer.readyUrl);
			const editor = page.getByRole("main");
			await expect(editor).toContainText("Original body.");
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
			expect(await readFile(join(root, "course.yaml"), "utf8")).toBe(manifest);
			await expect(readFile(join(root, ".praxity-transaction.json"))).rejects.toMatchObject({
				code: "ENOENT",
			});
			await page.reload();
			await expect(editor).toContainText("Original body.");
			expect(await projectDiskSnapshot(root)).toEqual(before);
		} finally {
			await page.goto("about:blank");
			await result.studioServer?.close();
			await rm(parent, { recursive: true, force: true });
		}
	});
}
