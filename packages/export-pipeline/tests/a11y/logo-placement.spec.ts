import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { type CourseConfig, generateHtmlPage } from "../../src/html-gen";

const styles = [
	"../../../shared-blocks/src/viewer/viewer-shell.css",
	"../../template/src/styles/global.css",
]
	.map((path) => readFileSync(resolve(import.meta.dirname, path), "utf8"))
	.join("\n");
const logo = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#4869c9"/></svg>').toString("base64")}`;

for (const placement of ["sidebar", "header"] as const) {
	for (const width of [320, 390, 768, 1280]) {
		test(`${placement} logo stays beside its title at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });
			await page.emulateMedia({ reducedMotion: "reduce" });
			const config: CourseConfig = {
				id: "branding",
				title: "Edit your first course in Praxity Studio",
				sourceLocale: "en",
				totalPages: 1,
				navigationStyle: "sidebar",
				navToggles: { navTopBar: true, navCourseTitle: true },
				pages: [{ id: "intro", title: "Introduction", blocks: [] }],
				brandLogo: { localPath: logo, darkLocalPath: logo, placement },
			};
			const html = generateHtmlPage({
				config,
				page: config.pages[0],
				index: 0,
				currentSlug: "intro",
				slugList: [{ pageId: "intro", slug: "intro", title: "Introduction" }],
				slugMap: new Map([["intro", "intro"]]),
				islandAssets: { loaderFilename: "loader.js", islandFilenames: { nav: "nav.js" } },
			});
			// Inspect the actual server-rendered chrome without loading unrelated interaction bundles.
			await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""));
			await page.addStyleTag({ content: styles });
			await page.evaluate(
				(openMenu) => {
					document.documentElement.classList.add("praxity-js");
					document.body.classList.toggle("praxity-nav-open", openMenu);
				},
				placement === "sidebar" && width < 768,
			);
			const surface = page
				.locator(placement === "sidebar" ? ".praxity-native-sidebar-header" : ".praxity-top-bar")
				.first();
			const lightLogo = surface.locator(".praxity-brand-logo--light");
			const darkLogo = surface.locator(".praxity-brand-logo--dark");
			await expect(lightLogo).toBeVisible();
			await expect(darkLogo).toBeHidden();
			await expect(page.locator("main .praxity-brand-logo")).toHaveCount(0);
			const title = surface.locator(
				placement === "sidebar" ? ".praxity-sidebar-title" : ".praxity-toolbar-context",
			);
			const bounds = await lightLogo.boundingBox();
			const titleBounds = await title.boundingBox();
			expect(bounds).not.toBeNull();
			expect(titleBounds).not.toBeNull();
			if (!bounds || !titleBounds) throw new Error("Missing visible branding");
			expect(bounds.x).toBeGreaterThanOrEqual(0);
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
			expect(
				Math.abs(bounds.y + bounds.height / 2 - titleBounds.y - titleBounds.height / 2),
			).toBeLessThan(2);
			await page.evaluate(() => document.documentElement.setAttribute("data-praxity-mode", "dark"));
			await expect(darkLogo).toBeVisible();
			await expect(lightLogo).toBeHidden();
			await surface.screenshot({
				path: test.info().outputPath(`${placement}-${width}.png`),
				animations: "disabled",
			});
		});
	}
}
