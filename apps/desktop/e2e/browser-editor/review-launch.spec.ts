import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { runPraxityCli } from "../../src/main/cli";

for (const width of [1280, 390]) {
	test(`review-enabled Read page loads shipped assets without legacy requests or author credentials at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		const root = await mkdtemp(
			join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "review-launch-"),
		);
		const projectDir = join(root, "project");
		await mkdir(projectDir);
		await writeFile(
			join(projectDir, "course.yaml"),
			"title: Review\nlessons: [one.prax, two.prax]\n",
		);
		await writeFile(
			join(projectDir, "one.prax"),
			"# First page\n\nFirst body.\n\n# Second page\n\nSecond body.\n",
		);
		await writeFile(join(projectDir, "two.prax"), "# Third page\n\nThird body.\n");
		const result = await runPraxityCli(["studio", projectDir, "--review", "--no-open"], {
			appVersion: "0.3.0",
			editorAssetsDir: process.env.PRAXITY_BROWSER_EDITOR_ASSETS,
			exportAssetsDir: resolve(import.meta.dirname, "../../resources/export-assets"),
		});
		const errors: string[] = [];
		const legacy: string[] = [];
		const assets: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("request", (request) => {
			if (
				new URL(request.url()).pathname.startsWith("/s/") ||
				new URL(request.url()).pathname === "/comments"
			)
				legacy.push(request.url());
		});
		page.on("response", (response) => {
			if (new URL(response.url()).pathname.startsWith("/_praxity/review/")) {
				expect(response.status()).toBe(200);
				assets.push(new URL(response.url()).pathname);
			}
		});
		try {
			expect(result.exitCode, result.stderr).toBe(0);
			const authorToken = new URLSearchParams(new URL(result.stdout.trim()).hash.slice(1)).get(
				"session",
			);
			expect(authorToken).toBeTruthy();
			await page.goto(result.stdout.trim());
			await expect(page.getByRole("link", { name: "Edit text", exact: true })).toBeVisible();
			await expect.poll(() => assets.length).toBe(2);
			expect(assets.sort()).toEqual([
				"/_praxity/review/review-comments.css",
				"/_praxity/review/review-comments.js",
			]);
			await expect(page.locator(".prx-review-sidebar")).toHaveCount(1);
			await expect(page.locator("#praxity-review-config")).toHaveCount(0);
			const readUrl = page.url();
			for (const navigate of [
				() => page.reload(),
				() => page.locator("a.praxity-nav-next").click(),
			]) {
				await navigate();
				await expect(page.locator(".prx-review-sidebar")).toHaveCount(1);
				await expect(page.locator("#praxity-review-config")).toHaveCount(0);
				expect(await page.content()).not.toContain(authorToken);
				expect(
					await page.evaluate(() => [
						...Object.values(sessionStorage),
						...Object.values(localStorage),
					]),
				).not.toContain(authorToken);
			}
			await expect(page.getByText("Second body.", { exact: true })).toBeVisible();
			await page.getByRole("link", { name: "Edit text", exact: true }).click();
			await expect(page.getByRole("link", { name: "Read mode", exact: true })).toBeVisible();
			await expect(page.locator("#praxity-review-config")).toHaveCount(0);
			await page.getByRole("link", { name: "Read mode", exact: true }).click();
			await expect(page.locator(".prx-review-sidebar")).toHaveCount(1);
			await expect(page.locator("#praxity-review-config")).toHaveCount(0);
			expect(new URL(page.url()).origin).toBe(new URL(readUrl).origin);
			expect(legacy).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await page.goto("about:blank");
			await result.studioServer?.close();
			await rm(root, { recursive: true });
		}
	});
}
