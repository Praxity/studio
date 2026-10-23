import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { DesignVariants } from "@praxity/grammar";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import { buildSync } from "esbuild";
import { ensureContrast } from "../../../editor-core/src/lib/themes/oklch";
import { THEME_PRESET_DEFAULTS } from "../../../editor-core/src/lib/themes/theme-preset-defaults";
import { type CourseConfig, generateCourseCss, generateHtmlPage } from "../../src/html-gen";
import { waitForSettledStyles } from "./helpers";

const styles = [
	"../../../shared-blocks/src/reading-rhythm.css",
	"../../../shared-blocks/src/blocks/shared-blocks.css",
	"../../../shared-blocks/src/viewer/viewer-shell.css",
	"../../template/src/styles/global.css",
]
	.map((path) =>
		readFileSync(resolve(import.meta.dirname, path), "utf8").replace(/^@import[^;]+;/gm, ""),
	)
	.join("\n");

const disclosureScript = buildSync({
	stdin: {
		resolveDir: resolve(import.meta.dirname, "../.."),
		contents: `import { enhanceDisclosure } from "./template/src/disclosure";
			for (const button of document.querySelectorAll("[data-disclosure-trigger]")) {
				const panel = document.getElementById(button.getAttribute("aria-controls"));
				if (!panel) throw new Error("Missing accordion panel");
				enhanceDisclosure(button, panel).setExpanded(true);
			}`,
	},
	bundle: true,
	write: false,
	format: "iife",
}).outputFiles[0].text;

for (const palette of ["ink", "forest", "plum", "clay", "clear"] as const)
	for (const mode of ["light", "dark"] as const) {
		test(`${palette} ${mode} rendered text and controls retain contrast`, async ({ page }) => {
			await page.setViewportSize({ width: 1100, height: 900 });
			const cssVars = resolveDesignTokens(
				{ ...THEME_PRESET_DEFAULTS[palette], palette } as DesignVariants,
				mode,
			);
			const config: CourseConfig = {
				id: "reading-palettes",
				title: "Build a course",
				sourceLocale: "en",
				totalPages: 2,
				navigationStyle: "sidebar",
				colorMode: mode,
				cssVars,
				navToggles: { navTopBar: true, navCourseTitle: true },
				pages: [
					{
						id: "one",
						title: "Review your work",
						blocks: [
							{ id: "heading", type: "heading", data: { content: "Review your work", level: 1 } },
							{
								id: "text",
								type: "text",
								data: {
									content:
										'<p>Preview your lesson and <a href="#details">review the details</a> before publishing.</p><div data-praxity-root=""><p class="praxity-text-error">Choose an answer before continuing.</p></div>',
								},
							},
							{
								id: "accordion",
								type: "accordion",
								data: {
									items: [
										{
											id: "standard",
											label: "Accessibility standards",
											children: [
												{
													id: "standard-text",
													type: "text",
													data: { content: "<p>European standard for ICT accessibility.</p>" },
												},
											],
										},
									],
								},
							},
							...(["warning", "success", "accent"] as const).map((color) => ({
								id: color,
								type: "note" as const,
								data: {
									color,
									style: "heavy",
									content: "Your changes remain saved in this project.",
								},
							})),
						],
					},
					{ id: "two", title: "Publish", blocks: [] },
				],
			};
			const html = generateHtmlPage({
				config,
				page: config.pages[0],
				index: 0,
				currentSlug: "one",
				slugList: config.pages.map((p) => ({ pageId: p.id, slug: p.id, title: p.title })),
				slugMap: new Map([
					["one", "one"],
					["two", "two"],
				]),
				islandAssets: {
					loaderFilename: "loader.js",
					islandFilenames: { nav: "nav.js", accordion: "accordion.js" },
				},
			});
			await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""));
			await page.addStyleTag({ content: styles + generateCourseCss(config) });
			await page.evaluate((mode) => {
				document.documentElement.setAttribute("data-praxity-mode", mode);
				document.documentElement.classList.add("praxity-js");
				document
					.querySelectorAll(".praxity-native-outline a[data-page-id]")
					.forEach((link) => link.setAttribute("data-visited", "true"));
			}, mode);
			await page.addScriptTag({ content: disclosureScript });
			const accordion = page.locator(".praxity-accordion-static");
			await expect(accordion.locator("[data-disclosure-trigger]")).toHaveAttribute(
				"aria-expanded",
				"true",
			);
			await expect(accordion.locator("[data-disclosure-label]")).toBeVisible();
			await expect(accordion.locator("[data-disclosure-panel] p")).toBeVisible();
			const selectors = [
				".praxity-page-nav-skip",
				"main p",
				".praxity-accordion-static [data-disclosure-label]",
				"main a:not(.praxity-skip-link)",
				".praxity-note-label",
				".praxity-note-body > div",
				".praxity-nav-next",
				".praxity-nav-prev:not(:disabled)",
				".praxity-sidebar-title",
				".praxity-native-sidebar-meta",
				".praxity-native-outline a[data-page-id]",
				".praxity-native-outline a[data-visited] svg",
			];
			const measurements: unknown[] = [];
			for (const selector of selectors)
				for (const element of await page.locator(selector).all()) {
					if (!(await element.isVisible())) continue;
					for (const state of selector === ".praxity-page-nav-skip"
						? ["focus"]
						: selector === "main a:not(.praxity-skip-link)" || selector === ".praxity-nav-next"
							? ["rest", "hover", "focus"]
							: ["rest"]) {
						if (state === "hover") await element.hover();
						if (state === "focus") await element.focus();
						await waitForSettledStyles(page);
						const colours = await element.evaluate((node) => {
							const canvas = document.createElement("canvas");
							canvas.width = canvas.height = 1;
							const ctx = canvas.getContext("2d");
							if (!ctx) throw new Error("Canvas unavailable");
							const hex = () =>
								"#" +
								Array.from(ctx.getImageData(0, 0, 1, 1).data)
									.slice(0, 3)
									.map((v) => v.toString(16).padStart(2, "0"))
									.join("");
							const ancestors: Element[] = [];
							for (let parent: Element | null = node; parent; parent = parent.parentElement)
								ancestors.unshift(parent);
							ctx.fillStyle = "#ffffff";
							ctx.fillRect(0, 0, 1, 1);
							for (const parent of ancestors) {
								ctx.fillStyle = getComputedStyle(parent).backgroundColor;
								ctx.fillRect(0, 0, 1, 1);
							}
							const background = hex();
							const computed = getComputedStyle(node);
							ctx.fillStyle = computed.color;
							ctx.fillRect(0, 0, 1, 1);
							return {
								foreground: hex(),
								feedback: node.classList.contains("praxity-text-error"),
								background,
								size: parseFloat(computed.fontSize),
								weight: computed.fontWeight,
								font: computed.fontFamily,
							};
						});
						const contrast = ensureContrast(colours.foreground, colours.background);
						measurements.push({ selector, state, ...colours, ...contrast });
						expect(contrast.wcagRatio, selector).toBeGreaterThanOrEqual(4.5);
						expect(
							Math.abs(contrast.apcaLc),
							JSON.stringify({ selector, state, ...colours }),
						).toBeGreaterThanOrEqual(
							selector === ".praxity-note-body > div" ||
								(selector === "main p" && !colours.feedback) ||
								(colours.size < 15 && Number(colours.weight) < 700)
								? 90
								: 75,
						);
					}
				}
			await test.info().attach("contrast.json", {
				body: JSON.stringify(measurements, null, 2),
				contentType: "application/json",
			});
			const next = page.locator(".praxity-nav-next").first();
			await next.hover();
			await next.focus();
			await expect(next).toBeFocused();
			await page.screenshot({
				path: test.info().outputPath(`${palette}-${mode}.png`),
				fullPage: true,
			});
		});
	}

for (const width of [320, 1100]) {
	test(`module navigation ${width === 320 ? "stacks phone controls" : "keeps desktop columns"} at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		const config: CourseConfig = {
			id: "module-navigation-layout",
			title: "Build a course",
			sourceLocale: "en",
			totalPages: 3,
			pages: Array.from({ length: 3 }, (_, index) => ({
				id: `page-${index}`,
				title: `Page ${index + 1}`,
				lessonId: index < 2 ? "first" : "second",
				lessonTitle: index < 2 ? "Introduction" : "Practice",
				isFirstPageOfLesson: index !== 1,
				blocks: [],
			})),
		};
		const slugs = config.pages.map((entry) => ({
			pageId: entry.id,
			slug: entry.id,
			title: entry.title,
		}));
		for (const index of [0, 1, 2]) {
			await page.setContent(
				generateHtmlPage({
					config,
					page: config.pages[index],
					index,
					currentSlug: slugs[index].slug,
					slugList: slugs,
					slugMap: new Map(slugs.map((entry) => [entry.pageId, entry.slug])),
					islandAssets: { loaderFilename: "loader.js", islandFilenames: { nav: "nav.js" } },
				}).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""),
			);
			await page.addStyleTag({ content: styles + generateCourseCss(config) });
			await page.evaluate(() => document.documentElement.classList.add("praxity-js"));
			const nav = page.locator(".praxity-native-page-nav-inner");
			const position = nav.locator(".praxity-pages-position");
			await expect(position).toHaveCSS("grid-column-start", "1");
			await expect(position).toHaveCSS("grid-column-end", "-1");
			for (const [selector, column] of [
				[".praxity-nav-prev", "1"],
				[".praxity-nav-next", width === 320 ? "1" : "2"],
			]) {
				const control = nav.locator(selector);
				if (await control.count()) {
					await expect(control).toHaveCSS("grid-column-start", column);
					const controlBox = await control.boundingBox();
					const positionBox = await position.boundingBox();
					if (!controlBox || !positionBox) throw new Error("Pagination needs visible geometry");
					expect(positionBox.y + positionBox.height).toBeLessThanOrEqual(controlBox.y);
					await control.focus();
					await expect(control).toBeFocused();
				}
			}
			const bounds = await position.boundingBox();
			const navBounds = await nav.boundingBox();
			expect(bounds).not.toBeNull();
			expect(navBounds).not.toBeNull();
			if (bounds && navBounds && width === 1100) {
				expect(
					Math.abs(bounds.x + bounds.width / 2 - navBounds.x - navBounds.width / 2),
				).toBeLessThan(2);
			}
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
				),
			).toBeLessThanOrEqual(1);
		}
	});
}
