import { createServer, type Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { parseFrontmatter } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { buildScormPackage } from "../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../src/desktop-design";
import { analyzeAxe } from "../a11y/helpers";
import { applyTextSpacing } from "../a11y/layout-overrides";
import { moduleDeckFixture } from "../fixtures/module-deck";
import { expectUnclippedRing } from "../focus-assertions";
import { test } from "../muted-test";

let server: Server;
let base: string;
const entries: Record<string, string> = {};
const files = new Map<string, Buffer>();
// The longest destination title in the leadership sample course.
const longestDestination = "Distinguer les faits, opinions et interprétations";

test.beforeAll(async () => {
	test.setTimeout(120_000);
	for (const variant of [
		"en-light",
		"fr-light",
		"en-dark",
		"fr-dark",
		"cross",
		"en-spacing",
		"fr-spacing",
	]) {
		const course = {
			...extractDesktopDesignFromFrontmatter(
				parseFrontmatter(
					`---\ndesign:\n  colorMode: ${variant.endsWith("dark") ? "dark" : "light"}\n---`,
				).frontmatter,
			),
			...moduleDeckFixture(undefined, variant.startsWith("fr") ? "fr" : "en"),
		};
		const first = course.content[0];
		const nextModule = course.content[course.content.length - 1];
		course.content =
			variant === "cross"
				? [first, nextModule]
				: [
						first,
						{
							...course.content[1],
							blocks: [{ id: "second-text", type: "text", data: { content: "Continue reading." } }],
						},
						nextModule,
					];
		course.moduleDeck = { gates: {} };
		if (variant.endsWith("spacing")) {
			course.content = [first, course.content[1], { ...course.content[1], id: "slide-3" }].map(
				(page, index) => ({
					...page,
					title: index === 1 ? "Practice" : longestDestination,
					blocks: page.blocks.map((block) => ({ ...block, id: `spacing-${index}-${block.id}` })),
				}),
			);
		}
		if (variant === "cross" || variant === "en-light")
			course.deckDesign = { ...course.deckDesign, sequentialLessons: true };
		const result = await buildScormPackage(course, { format: "html" });
		for (const file of new AdmZip(result.zip).getEntries()) {
			if (file.isDirectory) continue;
			const path = `/${variant}/${file.entryName}`;
			const bytes = file.getData();
			files.set(path, bytes);
			if (
				file.entryName !== "index.html" &&
				file.entryName.endsWith(".html") &&
				bytes.toString().includes('data-deck-slide="slide-1"')
			)
				entries[variant] = path;
		}
		if (!entries[variant]) throw new Error(`Missing ${variant} deck entry`);
	}
	server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(path);
		if (!bytes) {
			res.writeHead(404);
			res.end();
			return;
		}
		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			json: "application/json",
			woff2: "font/woff2",
		};
		res.setHeader(
			"Content-Type",
			types[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		res.end(bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
	if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

for (const locale of ["en", "fr"]) {
	for (const width of [1280, 390]) {
		test(`navigation text spacing at ${width}px ${locale}`, async ({ page }) => {
			await page.setViewportSize({ width, height: 844 });
			await page.goto(base + entries[`${locale}-spacing`]);
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await page.locator("#deck-next").click();
			await expect(page.locator("#deck-position")).toHaveText("2 / 3");
			await applyTextSpacing(page);
			for (const direction of ["previous", "next"]) {
				const control = page.locator(`#deck-${direction}`);
				await expect(control).toHaveAccessibleDescription(new RegExp(longestDestination));
				await control.click({ trial: true });
			}
			const clipped = await page.locator(".deck-controls").evaluate((footer) => {
				const problems: string[] = [];
				const walker = document.createTreeWalker(footer, NodeFilter.SHOW_TEXT);
				while (walker.nextNode()) {
					const node = walker.currentNode;
					const parent = node.parentElement;
					if (
						!node.textContent?.trim() ||
						!parent ||
						parent.closest("svg, .praxity-a11y-sr-only, .praxity-sr-only")
					)
						continue;
					if (!parent.getClientRects().length || getComputedStyle(parent).visibility !== "visible")
						continue;
					const range = document.createRange();
					range.selectNodeContents(node);
					for (const rect of range.getClientRects()) {
						for (
							let ancestor: Element | null = parent;
							ancestor;
							ancestor = ancestor.parentElement
						) {
							const style = getComputedStyle(ancestor);
							const box = ancestor.getBoundingClientRect();
							if (
								(["hidden", "clip"].includes(style.overflowX) &&
									(rect.left < box.left - 1 || rect.right > box.right + 1)) ||
								(["hidden", "clip"].includes(style.overflowY) &&
									(rect.top < box.top - 1 || rect.bottom > box.bottom + 1))
							)
								problems.push(node.textContent ?? "");
							if (ancestor === footer) break;
						}
					}
				}
				return problems;
			});
			expect(clipped).toEqual([]);
			const boxes = await page
				.locator(
					"#deck-previous, #deck-next, #deck-narration, .deck-utilities, .praxity-native-page-position",
				)
				.evaluateAll((controls) =>
					controls
						.map((control) => control.getBoundingClientRect().toJSON())
						.filter((box) => box.width && box.height),
				);
			for (const [index, box] of boxes.entries()) {
				expect(box.left).toBeGreaterThanOrEqual(0);
				expect(box.right).toBeLessThanOrEqual(width);
				for (const other of boxes.slice(index + 1)) {
					expect(
						box.right <= other.left + 1 ||
							other.right <= box.left + 1 ||
							box.bottom <= other.top + 1 ||
							other.bottom <= box.top + 1,
					).toBe(true);
				}
			}
		});
	}
}

for (const theme of ["light", "dark"]) {
	for (const width of [320, 390, 1440]) {
		for (const locale of ["en", "fr"]) {
			test(`Tools labels are painted at ${width}, ${locale}, ${theme}`, async ({ page }, info) => {
				await page.setViewportSize({ width, height: 900 });
				await page.goto(
					base +
						(theme === "dark"
							? locale === "fr"
								? entries["fr-dark"]
								: entries["en-dark"]
							: locale === "fr"
								? entries["fr-light"]
								: entries["en-light"]),
				);
				await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				await page.locator("#deck-more-toggle").click();
				if (process.env.COURSE_AUDIT_SCREENSHOTS && info.project.name === "chromium")
					await page.screenshot({
						path: `${process.env.COURSE_AUDIT_SCREENSHOTS}/deck-menu-${locale}-${theme}-${width}.png`,
					});
				for (const [selector, name] of [
					["#deck-outline-toggle", locale === "fr" ? "Plan du cours" : "Course outline"],
					["#deck-script-toggle", locale === "fr" ? "Transcription" : "Transcript"],
					['[data-a11y-action="text"]', locale === "fr" ? "Texte plus grand" : "Larger text"],
				]) {
					const button = page.locator(selector);
					await expect(button).toHaveAccessibleName(name);
					await expect(button).toHaveText(name);
					const label = button.locator(".deck-utility-label");
					expect(await label.evaluate((element) => getComputedStyle(element).clipPath)).toBe(
						"none",
					);
					await expect(button).not.toHaveAttribute("aria-label");
					await expect(button).not.toHaveAttribute("title");
				}
				await expect(page.locator("#deck-advance")).toHaveText(
					locale === "fr" ? "Avancer automatiquement" : "Auto-advance",
				);
				await expect(page.locator("#deck-advance")).toBeHidden();
				await expect(page.locator('[data-a11y-action="text"]')).toHaveAttribute(
					"aria-pressed",
					"false",
				);
				{
					const fonts = await page
						.locator(".deck-utility-label")
						.evaluateAll((labels) => labels.map((label) => getComputedStyle(label).fontSize));
					expect(fonts).toHaveLength(4);
					expect(new Set(fonts).size, "Tools labels use the same font size").toBe(1);
				}
				expect((await analyzeAxe(page, new AxeBuilder({ page }))).violations).toEqual([]);
			});
		}
	}
}

for (const theme of ["light", "dark"]) {
	test(`prefers-contrast strengthens the phone utility menu in ${theme}`, async ({
		page,
	}, info) => {
		await page.setViewportSize({ width: 320, height: 900 });
		await page.goto(base + entries[`en-${theme}`]);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await page.locator("#deck-more-toggle").click();
		const menu = page.locator("#deck-more-panel");
		await expect(menu).toHaveCSS("border-top-width", "1px");
		const { background, total } = await menu.evaluate((element) => {
			const background = getComputedStyle(element).backgroundColor;
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = 1;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Missing canvas context");
			context.fillStyle = background;
			context.fillRect(0, 0, 1, 1);
			const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
			return { background, total: r + g + b };
		});
		if (theme === "dark") expect(total).toBeLessThan(3 * 128);
		else expect(total).toBeGreaterThan(3 * 128);
		await page.emulateMedia({ contrast: "more" });
		if (info.project.name === "firefox") {
			await page.reload();
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await page.locator("#deck-more-toggle").click();
		}
		await expect(menu).toHaveCSS("border-top-style", "solid");
		await expect(menu).toHaveCSS("border-top-width", "2px");
		await expect(menu).toHaveCSS("background-color", background);
		const transcript = menu.getByRole("button", { name: "Transcript", exact: true });
		await page.keyboard.press("Tab");
		await transcript.focus();
		await expect(transcript).toHaveCSS("outline-width", "3px");
		await expect(transcript).toHaveCSS("outline-offset", "2px");
		await expect(transcript).toBeFocused();
		await expectUnclippedRing(transcript);
		expect(
			await menu.evaluate((element) => element.getBoundingClientRect().right),
		).toBeLessThanOrEqual(320);
		await menu.screenshot({ path: info.outputPath("contrast-menu.png") });
	});
}

test("successful host navigation clears a redirected sequence notice", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 900 });
	await page.goto(`${base}${entries.cross}#module-two`);
	await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
	await expect(page.locator("#deck-status")).toContainText("earlier slides");
	await page.evaluate(() => {
		window.__praxityNavigatePageHref = () => true;
	});
	await page.locator("#deck-next").click();
	await expect(page.locator("#deck-completion h1")).toHaveText("Module complete");
	await expect(page.locator("#deck-next")).toHaveAccessibleName("Next module: Module two");
	await page.locator("#deck-next").click();
	await expect(page.locator("#deck-status")).toBeEmpty();
});

test("successful local navigation clears a redirected sequence notice", async ({ page }, info) => {
	await page.setViewportSize({ width: 390, height: 900 });
	await page.goto(`${base}${entries["en-light"]}#module-two`);
	await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
	await expect(page.locator("#deck-status")).toContainText("earlier slides");
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
	if (process.env.COURSE_AUDIT_SCREENSHOTS && info.project.name === "chromium")
		await page.screenshot({ path: `${process.env.COURSE_AUDIT_SCREENSHOTS}/deck-status-390.png` });
	await expect(page.locator("#deck-status")).toBeEmpty();
});
