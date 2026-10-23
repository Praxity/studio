import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { JSDOM } from "jsdom";
import { runPraxityCli } from "../../src/main/cli";

for (const review of [true, false]) {
	test(`${review ? "Review-enabled" : "Plain"} Read activates a named, focusable YouTube iframe with self-only scripts`, async ({
		page,
	}) => {
		const root = await mkdtemp(
			join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "review-video-"),
		);
		const projectDir = join(root, "project");
		await mkdir(projectDir);
		await writeFile(join(projectDir, "course.yaml"), "title: Video\nlessons: [one.prax]\n");
		await writeFile(
			join(projectDir, "one.prax"),
			"# Video lesson\n\n::: video https://www.youtube.com/watch?v=aqz-KE-bpKQ\ntitle: Forest walk\n:::\n",
		);
		const youtubeScripts: string[] = [];
		page.on("request", (request) => {
			if (
				request.resourceType() === "script" &&
				/(^|\.)youtube(?:-nocookie)?\.com$/.test(new URL(request.url()).hostname)
			) {
				youtubeScripts.push(request.url());
			}
		});
		// Stub provider content, while exercising the real cross-origin navigation and course CSP.
		await page.route(/^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//, async (route) => {
			if (route.request().resourceType() !== "document") return route.continue();
			await route.fulfill({
				contentType: "text/html",
				body: "<!doctype html><title>Provider fixture</title><button>Embedded player</button>",
			});
		});
		await page.route("https://i.ytimg.com/**", (route) => route.abort());
		const result = await runPraxityCli(
			["studio", projectDir, ...(review ? ["--review"] : []), "--no-open"],
			{
				appVersion: "0.3.0",
				editorAssetsDir: process.env.PRAXITY_BROWSER_EDITOR_ASSETS,
				exportAssetsDir: resolve(import.meta.dirname, "../../resources/export-assets"),
			},
		);
		try {
			expect(result.exitCode, result.stderr).toBe(0);
			const response = await page.goto(result.stdout.trim());
			if (!response) throw new Error("Read navigation returned no response");
			expect(response.ok()).toBe(true);
			const csp = response.headers()["content-security-policy"] ?? "";
			const directives = csp.split(";").map((directive) => directive.trim());
			expect(directives.filter((directive) => directive.startsWith("script-src "))).toEqual([
				"script-src 'self'",
			]);
			const served = new JSDOM(await response.text());
			try {
				const bootstrap = served.window.document.querySelector(
					'script[type="application/json"]#praxity-review-config',
				);
				expect(Boolean(bootstrap)).toBe(review);
				if (review) {
					const config = JSON.parse(bootstrap?.textContent ?? "null");
					expect(config.page.pageId).toEqual(expect.any(String));
					expect(config.page.pageIds).toContain(config.page.pageId);
				}
			} finally {
				served.window.close();
			}
			if (review) {
				await expect(page.locator(".prx-review-sidebar--local")).toHaveCount(1);
				await expect(page.locator(".prx-review-status")).toHaveText(
					"No comments in this review yet.",
				);
			} else await expect(page.locator(".prx-review-sidebar")).toHaveCount(0);
			await expect(page.locator("#praxity-review-config")).toHaveCount(0);
			const iframe = page.locator('[data-block-type="video"] iframe');
			await expect(iframe).toBeVisible();
			await expect(iframe).toHaveAccessibleName("Forest walk");
			const src = await iframe.getAttribute("src");
			expect(src).toBeTruthy();
			const embed = new URL(src ?? "");
			expect(["https://www.youtube.com", "https://www.youtube-nocookie.com"]).toContain(
				embed.origin,
			);
			expect(
				directives.find((directive) => directive.startsWith("frame-src "))?.split(" "),
			).toContain(embed.origin);
			const facade = iframe.contentFrame().getByRole("link", { name: "Play Forest walk" });
			await facade.focus();
			await expect(facade).toBeFocused();
			await page.keyboard.press("Enter");
			await expect(
				iframe.contentFrame().getByRole("button", { name: "Embedded player" }),
			).toBeVisible();
			await expect
				.poll(
					async () =>
						await iframe
							.contentFrame()
							.locator("body")
							.evaluate(() => location.href),
				)
				.toBe(`${src}?autoplay=1`);
			await iframe.focus();
			await expect(iframe).toBeFocused();
			expect(youtubeScripts).toEqual([]);
		} finally {
			await page.goto("about:blank");
			await result.studioServer?.close();
			await rm(root, { recursive: true });
		}
	});
}
