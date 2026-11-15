import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startJourney } from "./global-setup";

for (const language of ["en", "fr"] as const) {
	test(`long toolbar titles truncate in Read and Edit (${language})`, async ({ page }) => {
		const title = `${"ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(4)}AB`;
		expect(title).toHaveLength(106);
		const fixture = await mkdtemp(join(tmpdir(), "toolbar-title-"));
		await writeFile(
			join(fixture, "course.yaml"),
			`title: ${title}\nlocale: ${language}\nlessons: [lesson.prax]\ndesign:\n  navTopBar: true\n  navCourseTitle: true\n`,
		);
		await writeFile(
			join(fixture, "lesson.prax"),
			`---\ntitle: ${title}\n---\n\n# Page\n\nText.\n\n# Next page\n\nMore text.\n`,
		);
		try {
			const stop = await startJourney(page.context(), { courseFixture: fixture });
			try {
				const ready = process.env.PRAXITY_BROWSER_READY_URL ?? "";
				for (const mode of ["Read", "Edit"] as const) {
					await page.setViewportSize({ width: 1280, height: 900 });
					await page.goto(mode === "Read" ? ready : `${new URL(ready).origin}/launch?canvas=1`);
					if (mode === "Edit")
						await expect(page.getByRole("status")).toHaveText(
							language === "fr" ? "Connect\u00e9" : "Connected",
						);
					const position = page.locator(".praxity-toolbar-position");
					for (const width of [1280, 390]) {
						await page.setViewportSize({ width, height: 900 });
						await expect
							.poll(() => page.evaluate(() => document.documentElement.scrollWidth))
							.toBe(width);
						const buttons = page.locator(".praxity-top-bar .praxity-a11y-pill button");
						expect(await buttons.count()).toBeGreaterThan(0);
						for (const button of await buttons.all()) {
							// The author document has no learner scripts, so its preferences stay hidden.
							if (mode === "Edit") {
								await expect(button).toBeHidden();
								continue;
							}
							await expect(button).toBeVisible();
							const box = await button.boundingBox();
							if (!box) throw new Error("Reading-preferences button has no box");
							expect(box.x).toBeGreaterThanOrEqual(0);
							expect(box.x + box.width).toBeLessThanOrEqual(width);
						}
						if (mode === "Read") {
							const textSize = buttons.first();
							await textSize.click();
							await expect(textSize).toHaveAttribute("aria-pressed", "true");
							await textSize.click();
							await expect(textSize).toHaveAttribute("aria-pressed", "false");
						}
						const visibleTitle =
							width === 390 ? page.locator(".praxity-toolbar-context") : position;
						await expect(position).toHaveAttribute("title", title);
						await expect(position).toHaveCSS("text-overflow", "ellipsis");
						if (mode === "Edit" && width === 390) {
							// Without learner scripts, the narrow author layout hides the whole top bar.
							await expect(page.locator(".praxity-top-bar-fallback")).toBeHidden();
							await expect(visibleTitle).toHaveAttribute("title", title);
							await expect(visibleTitle).toHaveCSS("text-overflow", "ellipsis");
							continue;
						}
						await expect(visibleTitle).toHaveAttribute("title", title);
						await expect(visibleTitle).toBeVisible();
						await expect(visibleTitle).toHaveCSS("text-overflow", "ellipsis");
						expect(await visibleTitle.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
					}
				}
			} finally {
				await stop();
			}
		} finally {
			await rm(fixture, { recursive: true });
		}
	});
}
