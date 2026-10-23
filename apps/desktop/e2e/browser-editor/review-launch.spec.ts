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

function centreIsVisible(element: HTMLElement) {
	const box = element.getBoundingClientRect();
	return element.contains(
		document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
	);
}

for (const layout of ["sidebar", "bottomBar"]) {
	test.describe(`review toolbar in ${layout}`, () => {
		let root: string;
		let result: Awaited<ReturnType<typeof runPraxityCli>>;
		test.beforeAll(async () => {
			root = await mkdtemp(join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "review-toolbar-"));
			await writeFile(
				join(root, "course.yaml"),
				`title: Review toolbar\nlessons: [one.prax]\ndesign:\n  navArchetype: ${layout}\n`,
			);
			const paragraphs = Array.from(
				{ length: 24 },
				(_, index) =>
					`Paragraph ${index + 1} of the course body, with enough words to wrap on a narrow screen.`,
			).join("\n\n");
			await writeFile(
				join(root, "one.prax"),
				`# First page\n\n${paragraphs}\n\nLast line of course content.\n\n# Second page\n\nSecond body.\n`,
			);
			result = await runPraxityCli(["studio", root, "--review", "--no-open"], {
				appVersion: "0.3.0",
				editorAssetsDir: process.env.PRAXITY_BROWSER_EDITOR_ASSETS,
				exportAssetsDir: resolve(import.meta.dirname, "../../resources/export-assets"),
			});
			expect(result.exitCode, result.stderr).toBe(0);
		});
		test.afterAll(async () => {
			await result?.studioServer?.close();
			if (root) await rm(root, { recursive: true });
		});

		for (const viewport of [
			{ width: 1280, height: 900 },
			{ width: 390, height: 844 },
			{ width: 320, height: 256 },
			{ width: 320, height: 180 },
		]) {
			test(`keeps content and Next clear at ${viewport.width}x${viewport.height}px`, async ({
				page,
			}, testInfo) => {
				await page.setViewportSize(viewport);
				await page.emulateMedia({ reducedMotion: "reduce" });
				await page.goto(result.stdout.trim());
				await expect(page.locator(".prx-review-sidebar")).toHaveClass(/--collapsed/);
				await expect
					.poll(() =>
						page.evaluate(() =>
							Number.parseFloat(
								getComputedStyle(document.documentElement).getPropertyValue(
									"--prx-review-toolbar-space",
								),
							),
						),
					)
					.toBeGreaterThan(0);
				const nav = page.locator("#praxity-page-nav");
				const next = page.locator("a.praxity-nav-next");
				const last = page.getByText("Last line of course content.", { exact: true });
				expect(await nav.evaluate((element) => getComputedStyle(element).position)).toBe(
					layout === "bottomBar" ? "sticky" : "relative",
				);
				if (layout === "sidebar")
					expect(await nav.evaluate((element) => getComputedStyle(element).bottom)).toBe("0px");
				const output = process.env.PRAXITY_TOOLBAR_SCREENSHOTS ?? testInfo.outputDir;
				await mkdir(output, { recursive: true });
				for (const position of ["mid", "max"]) {
					await page.evaluate((position) => {
						const root = document.scrollingElement;
						if (!root) throw new Error("Missing scroll container");
						const max = root.scrollHeight - root.clientHeight;
						window.scrollTo({ top: position === "mid" ? max / 2 : max, behavior: "instant" });
					}, position);
					if (
						(layout === "bottomBar" && position === "mid") ||
						(position === "max" && viewport.height > 320)
					)
						await expect.poll(() => next.evaluate(centreIsVisible)).toBe(true);
					if (position === "max") {
						if (viewport.height > 320)
							await expect.poll(() => last.evaluate(centreIsVisible)).toBe(true);
						const navTop = await nav.evaluate((element) => element.getBoundingClientRect().top);
						const lastBottom = await last.evaluate(
							(element) => element.getBoundingClientRect().bottom,
						);
						expect(navTop).toBeGreaterThanOrEqual(lastBottom);
					}
					const size = viewport.height === 180 ? "320-short" : String(viewport.width);
					await page.screenshot({ path: join(output, `${layout}-${size}-${position}.png`) });
				}
				await last.evaluate((element) =>
					element.scrollIntoView({ block: "center", behavior: "instant" }),
				);
				await expect.poll(() => last.evaluate(centreIsVisible)).toBe(true);
				await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
				await next.focus();
				await page.keyboard.press("Shift+Tab");
				await page.keyboard.press("Tab");
				await expect(next).toBeFocused();
				await expect.poll(() => next.evaluate(centreIsVisible)).toBe(true);
				const nextBox = await next.boundingBox();
				const toolbarBox = await page.locator(".prx-review-header").boundingBox();
				if (!nextBox || !toolbarBox) throw new Error("Missing navigation or toolbar bounds");
				expect(nextBox.y).toBeGreaterThanOrEqual(0);
				expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(toolbarBox.y);
				await next.click();
				await expect(page.getByText("Second body.", { exact: true })).toBeVisible();
			});
		}
	});
}
