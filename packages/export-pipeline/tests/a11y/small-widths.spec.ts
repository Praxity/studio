import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { expect, type Page } from "@playwright/test";
import { parseFrontmatter, readLesson } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { buildScormPackage } from "../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../src/desktop-design";
import { loadGrammarFixture } from "../fixtures/load-grammar-fixture";
import { silentWav } from "../fixtures/silent-audio";
import { test } from "../muted-test";
import { stubFixtureDownloads } from "./global-setup";
import { waitForHydration } from "./helpers";

const spacing =
	"*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}";
let server: Server;
let base: string;
const entries = new Map<string, string>();
const files = new Map<string, Buffer>();

test.use({ deviceScaleFactor: 2 });
test.beforeAll(async () => {
	test.setTimeout(120_000);
	const courseControls = await readFile(
		new URL("./fixtures/leadership-course-controls.png", import.meta.url),
	);
	for (const prefix of ["", "/light", "/dark"])
		files.set(`${prefix}/assets/img/commandes-du-cours.png`, courseControls);
	const lessons = await Promise.all(
		[
			"00-avant-de-commencer",
			"01-affirmez-vous",
			"02-quatre-cavaliers",
			"03-resoudre-un-conflit",
		].map(async (name) =>
			readLesson(
				await readFile(
					new URL(
						`../../../grammar/__tests__/fixtures/v4/leadership/${name}.prax`,
						import.meta.url,
					),
					"utf8",
				),
			),
		),
	);
	for (const lesson of lessons) expect(lesson.errors).toEqual([]);
	const content = lessons.flatMap((lesson, index) =>
		lesson.pages.map((page, i) => ({
			...page,
			lessonId: `lesson-${index}`,
			lessonTitle: lesson.frontmatter.title,
			isFirstPageOfLesson: i === 0,
			narrationEnabled: true,
			data: {
				...page.data,
				narrationAudio: "https://small-widths.example/voice.wav",
				narrationDuration: 83,
			},
		})),
	);
	const target = content.find((page) => page.title === "Naviguer dans le parcours");
	expect(target).toBeDefined();
	const originalFetch = globalThis.fetch;
	const audio = silentWav(83);
	globalThis.fetch = (input, options) =>
		String(input) === "https://small-widths.example/voice.wav"
			? Promise.resolve(
					new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/wav" } }),
				)
			: originalFetch(input, options);
	try {
		for (const theme of ["light", "dark"] as const) {
			const built = await buildScormPackage(
				{
					...extractDesktopDesignFromFrontmatter(
						parseFrontmatter(`---
design:
  colorMode: ${theme}
  palette: waves
  headingSize: 2.2
  lineHeight: 1.6
  contentMaxWidth: 720
  navArchetype: slides
  navTopBar: true
  navCourseTitle: true
  navLessonTitles: true
  deck:
    preset: transcript
  typography:
    body:
      fontFamily: ["Source Sans 3", "sans-serif"]
    headings:
      fontFamily: ["Source Serif 4", "serif"]
      fontWeight: 600
---`).frontmatter,
					),
					id: `small-leadership-${theme}`,
					title: "Conversations difficiles au travail",
					sourceLocale: "fr",
					content,
					moduleDeck: { gates: {} },
				},
				{ format: "html" },
			);
			for (const file of new AdmZip(built.zip).getEntries()) {
				if (file.isDirectory) continue;
				const path = `/${theme}/${file.entryName}`;
				files.set(path, file.getData());
				if (
					file.entryName !== "index.html" &&
					file.entryName.endsWith(".html") &&
					file.getData().toString().includes(`data-deck-slide="${target?.id}"`)
				)
					entries.set(theme, path);
			}
			expect(entries.has(theme)).toBe(true);
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	const fixture = await loadGrammarFixture(
		JSON.parse(
			await readFile(
				new URL(
					"../../../../docs/test-fixtures/sample-course-pagespeed-extras.json",
					import.meta.url,
				),
				"utf8",
			),
		),
	);
	const restoreFetch = stubFixtureDownloads();
	const design = fixture.designConfig;
	if (!design) throw new Error("Comprehensive fixture must include its design");
	try {
		for (const theme of ["light", "dark"] as const) {
			const built = await buildScormPackage(
				{
					...fixture.course,
					frontmatter: {
						...fixture.frontmatter,
						design: { ...design, colorMode: theme },
					},
				},
				{ ...fixture.buildOptions, format: "html" },
			);
			for (const file of new AdmZip(built.zip).getEntries()) {
				if (!file.isDirectory)
					files.set(`/comprehensive-${theme}/${file.entryName}`, file.getData());
			}
		}
	} finally {
		restoreFetch();
	}
	server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(path);
		if (!bytes) {
			res.writeHead(404).end();
			return;
		}
		res.setHeader(
			"Content-Type",
			(
				{
					html: "text/html",
					css: "text/css",
					js: "text/javascript",
					wav: "audio/wav",
					png: "image/png",
					woff2: "font/woff2",
				} as Record<string, string>
			)[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		res.end(bytes);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
	server?.closeAllConnections();
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

async function geometry(page: Page) {
	return page.evaluate(() => {
		const controls = [
			...document.querySelectorAll<HTMLElement>(
				"button,a[href],input,select,textarea,[role='button'],canvas[tabindex]",
			),
		].filter(
			(e) =>
				e.getClientRects().length &&
				getComputedStyle(e).visibility !== "hidden" &&
				getComputedStyle(e).clipPath === "none" &&
				!e.closest("[inert]"),
		);
		const overlaps: string[] = [];
		const hitBox = (element: HTMLElement) => {
			const rect = element.getBoundingClientRect();
			const box = {
				left: Math.max(0, rect.left),
				right: Math.min(innerWidth, rect.right),
				top: Math.max(0, rect.top),
				bottom: Math.min(innerHeight, rect.bottom),
			};
			for (let parent = element.parentElement; parent; parent = parent.parentElement) {
				const css = getComputedStyle(parent),
					bounds = parent.getBoundingClientRect();
				if (css.overflowX !== "visible") {
					box.left = Math.max(box.left, bounds.left);
					box.right = Math.min(box.right, bounds.right);
				}
				if (css.overflowY !== "visible") {
					box.top = Math.max(box.top, bounds.top);
					box.bottom = Math.min(box.bottom, bounds.bottom);
				}
			}
			return box;
		};
		for (let i = 0; i < controls.length; i++)
			for (let j = i + 1; j < controls.length; j++) {
				const a = controls[i],
					b = controls[j];
				if (a.contains(b) || b.contains(a)) continue;
				const x = hitBox(a),
					y = hitBox(b);
				if (
					Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 &&
					Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1
				)
					overlaps.push(`${a.id || a.className} / ${b.id || b.className}`);
			}
		return {
			overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
			overflowElements:
				document.documentElement.scrollWidth > document.documentElement.clientWidth
					? [...document.querySelectorAll<HTMLElement>("body *")].flatMap((element) => {
							if (!element.getClientRects().length || element.closest("svg,script,style"))
								return [];
							for (let parent: Element | null = element; parent; parent = parent.parentElement) {
								const css = getComputedStyle(parent);
								if (css.clipPath !== "none" || css.clip !== "auto" || css.visibility !== "visible")
									return [];
							}
							const bounds = element.getBoundingClientRect();
							const words: string[] = [];
							for (const node of element.childNodes) {
								if (node.nodeType !== Node.TEXT_NODE) continue;
								for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
									const range = document.createRange();
									range.setStart(node, match.index);
									range.setEnd(node, match.index + match[0].length);
									const right = range.getBoundingClientRect().right;
									if (right > innerWidth) words.push(`${match[0]} ends at ${right.toFixed(2)}px`);
								}
							}
							if (bounds.right <= innerWidth && !words.length) return [];
							return [
								`${element.tagName}#${element.id}.${element.className} in ${element.closest("[data-block-id]")?.getAttribute("data-block-id") ?? "shell"}: right=${bounds.right.toFixed(2)}px, words=${JSON.stringify(words)}, font=${getComputedStyle(element).font}`,
							];
						})
					: [],
			overlaps,
		};
	});
}

async function textBreaks(page: Page) {
	return page.evaluate(() => {
		const brokenWords: string[] = [];
		const buttonLines = new Map<Element, Map<number, string>>();
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		const measure = document.createElement("span");
		measure.style.cssText =
			"position:fixed;left:-10000px;white-space:nowrap;width:max-content;hyphens:none";
		document.body.append(measure);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const element = node.parentElement;
			if (
				!element ||
				element === measure ||
				element.closest("script,style,svg,[inert]") ||
				!element.getClientRects().length ||
				getComputedStyle(element).visibility !== "visible"
			)
				continue;
			let box = element;
			while (getComputedStyle(box).display === "inline" && box.parentElement)
				box = box.parentElement;
			// Ignore text hidden visually for screen readers, including clipped ancestors.
			let clipped = false;
			for (let parent: Element | null = element; parent; parent = parent.parentElement) {
				const css = getComputedStyle(parent);
				if (css.clipPath !== "none" || css.clip !== "auto") clipped = true;
			}
			if (clipped) continue;
			const css = getComputedStyle(element);
			const boxCss = getComputedStyle(box);
			const contentWidth =
				box.getBoundingClientRect().width -
				[
					boxCss.paddingLeft,
					boxCss.paddingRight,
					boxCss.borderLeftWidth,
					boxCss.borderRightWidth,
				].reduce((sum, value) => sum + parseFloat(value), 0);
			measure.style.font = css.font;
			// Copy longhands too: computed font shorthands can be empty when variants differ.
			measure.style.fontFamily = css.fontFamily;
			measure.style.fontSize = css.fontSize;
			measure.style.fontWeight = css.fontWeight;
			measure.style.fontStyle = css.fontStyle;
			measure.style.fontStretch = css.fontStretch;
			measure.style.fontVariant = css.fontVariant;
			measure.style.letterSpacing = css.letterSpacing;
			measure.style.wordSpacing = css.wordSpacing;
			const value = node.textContent ?? "";
			const button = element.closest("button,[role='button'],.praxity-nav-prev,.praxity-nav-next");
			for (const match of value.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)) {
				const range = document.createRange();
				range.setStart(node, match.index);
				range.setEnd(node, match.index + match[0].length);
				// WebKit includes an empty rect on the next line at some word boundaries.
				// Only rectangles containing rendered glyphs establish a word break.
				const lines = [...range.getClientRects()].filter((rect) => rect.width > 0);
				measure.textContent = match[0];
				const unbroken = document.createRange();
				unbroken.selectNodeContents(measure);
				const width = unbroken.getBoundingClientRect().width;
				const split = new Set(lines.map((r) => Math.round(r.top))).size > 1;
				if (split && (width <= contentWidth || button))
					brokenWords.push(
						`${element.id || element.className || element.tagName} in ${element.closest("[data-block-id]")?.getAttribute("data-block-id") ?? "shell"}: ${match[0]} (${width.toFixed(2)}/${contentWidth.toFixed(2)}px; ${css.fontSize} ${css.fontFamily}; lines=${JSON.stringify(lines.map((rect) => ({ top: rect.top, width: rect.width })))})`,
					);
			}
			if (button) {
				const lines = buttonLines.get(button) ?? new Map<number, string>();
				buttonLines.set(button, lines);
				for (let i = 0; i < value.length; i++) {
					if (!value[i].trim()) continue;
					const range = document.createRange();
					range.setStart(node, i);
					range.setEnd(node, i + 1);
					const rect = range.getClientRects()[0];
					if (rect) {
						const top = Math.round(rect.top);
						lines.set(top, (lines.get(top) ?? "") + value[i]);
					}
				}
			}
		}
		measure.remove();
		return {
			brokenWords,
			singleLetterButtonLines: [...buttonLines].flatMap(([button, lines]) =>
				[...lines.values()]
					.filter((line) => /^\p{L}$/u.test(line))
					.map((line) => `${button.id || button.className}: ${line}`),
			),
		};
	});
}

for (const width of [160, 195, 240, 320, 360])
	for (const spaced of [false, true])
		for (const theme of ["light", "dark"]) {
			test(`leadership ${width}px ${theme} spacing=${spaced}`, async ({ page }, info) => {
				await page.setViewportSize({ width, height: 450 });
				await page.goto(`${base}${entries.get(theme)}?praxity-inspect=1&praxity-resume=0`);
				await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				const slide = page.locator("[data-deck-slide]").filter({
					has: page.getByRole("heading", {
						name: "Naviguer dans le parcours",
						exact: true,
						includeHidden: true,
					}),
				});
				const id = await slide.getAttribute("data-deck-slide");
				await page.locator("#deck-more-toggle").click();
				await page.locator("#deck-outline-toggle").click();
				await page.locator(`[data-deck-page='${id}']`).click();
				await page.keyboard.press("Escape");
				await expect(slide).toBeVisible();
				const image = slide.locator("img").first();
				await image.evaluate((image) => {
					(image as HTMLImageElement).loading = "eager";
				});
				await expect
					.poll(() => image.evaluate((image) => (image as HTMLImageElement).naturalWidth))
					.toBeGreaterThan(0);
				if (spaced) await page.addStyleTag({ content: spacing });
				await page.evaluate(() => document.fonts.ready);
				expect
					.soft(await textBreaks(page))
					.toEqual({ brokenWords: [], singleLetterButtonLines: [] });
				expect(await geometry(page)).toEqual({ overflow: 0, overflowElements: [], overlaps: [] });
				const footer = page.locator("#deck-controls");
				expect((await footer.boundingBox())?.height).toBeLessThanOrEqual(135);
				for (const selector of ["#deck-more-toggle", "#deck-previous", "#deck-next"]) {
					const box = await page.locator(selector).boundingBox();
					// Gecko's rect serialization can return 43.999992 for a 44px layout box.
					expect(Number(box?.width.toFixed(3))).toBeGreaterThanOrEqual(44);
					expect(Number(box?.height.toFixed(3))).toBeGreaterThanOrEqual(44);
				}
				await page.locator("#deck-previous").focus();
				await expect(page.locator(".praxity-narration-position input")).toBeEnabled();
				const order = [".praxity-narration-transport button", "#deck-more-toggle", "#deck-next"];
				for (const selector of order) {
					if (await page.locator(selector).isEnabled()) {
						await page.keyboard.press("Tab");
						await expect(page.locator(selector)).toBeFocused();
					}
				}
				if (width < 768) {
					await page.locator("#deck-more-toggle").click();
					await expect(page.locator("#deck-more-panel .praxity-narration-time")).toBeVisible();
					const speed = page.locator("#deck-more-panel .praxity-narration-speed");
					await expect(speed).toHaveAccessibleName("Vitesse: 1×");
					await speed.click();
					await expect(speed).toHaveAccessibleName("Vitesse: 1.25×");
					if (width < 240) await expect(page.locator(".deck-more-position")).toBeVisible();
					await page.locator("#deck-script-toggle").click();
					const sheet = page.locator("dialog.deck-transcript-sheet");
					await expect(sheet).toHaveRole("dialog");
					expect(await sheet.evaluate((element) => element.matches(":modal"))).toBe(true);
					await expect(sheet).toBeVisible();
					await expect(page.locator("#deck-script-title")).toBeFocused();
					await page.keyboard.press("Tab");
					await expect(page.locator("#deck-sidebar-close")).toBeFocused();
					const text = page.locator("#deck-script-scroll");
					expect((await text.boundingBox())?.width).toBeGreaterThanOrEqual(width * 0.9);
					const readableHeight = await text.evaluate((element) => {
						const line = element.querySelector("[data-deck-segment]");
						if (!line) throw new Error("Missing transcript text");
						return {
							height: element.clientHeight,
							line: parseFloat(getComputedStyle(line).lineHeight),
						};
					});
					expect(readableHeight.height).toBeGreaterThanOrEqual(readableHeight.line * 2);
					if (width <= 195) expect(readableHeight.height).toBeGreaterThanOrEqual(450 * 0.5);
					expect(await textBreaks(page)).toEqual({ brokenWords: [], singleLetterButtonLines: [] });
					for (let i = 0; i < 12; i++) {
						await page.keyboard.press("Tab");
						expect(await sheet.evaluate((e) => e.contains(document.activeElement))).toBe(true);
					}
					await page.screenshot({
						path: info.outputPath(`transcript-${width}-${theme}-${spaced}.png`),
					});
					await page.keyboard.press("Escape");
					await expect(page.locator("#deck-script-toggle")).toBeFocused();
					await page.keyboard.press("Escape");
				}
				await page.screenshot({
					path: info.outputPath(`leadership-${width}-${theme}-${spaced}.png`),
				});
			});
		}

for (const width of [320, 480, 500, 600]) {
	test(`transcript uses its ${width}px container in a wide viewport`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(`${base}${entries.get("light")}?praxity-inspect=1&praxity-resume=0`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		if (await page.locator("#deck-sidebar").isVisible())
			await page.locator("#deck-sidebar-close").click();
		await page.locator(".praxity-layout-wrapper").evaluate((element, width) => {
			(element as HTMLElement).style.width = `${width}px`;
		}, width);
		const toggle = page.locator("#deck-script-toggle");
		await expect(page.locator("#deck-more-toggle")).toBeVisible();
		if (!(await toggle.isVisible())) await page.locator("#deck-more-toggle").click();
		await toggle.click();
		await expect(page.locator("#deck-script-title")).toBeFocused();
		const sheet = page.locator("dialog.deck-transcript-sheet");
		if (width < 600) {
			expect(await sheet.evaluate((element) => element.matches(":modal"))).toBe(true);
			expect(
				(await page.locator("#deck-script-scroll").boundingBox())?.width,
			).toBeGreaterThanOrEqual(width * 0.9);
			await page.keyboard.press("Tab");
			await expect(page.locator("#deck-sidebar-close")).toBeFocused();
		} else {
			await expect(sheet).not.toBeVisible();
			await expect(page.locator("#deck-sidebar")).toHaveAttribute("role", "complementary");
			await expect(page.locator("#main-content")).toBeVisible();
			await expect(page.locator("#main-content")).toHaveJSProperty("inert", false);
		}
		await page.keyboard.press("Escape");
		await expect(toggle).toBeFocused();
	});
}

test("choose-one picker reflows at 160px with 200% text and added spacing", async ({ page }) => {
	await page.setViewportSize({ width: 160, height: 450 });
	await page.goto(
		`${base}/comprehensive-light/assessment-groups.html?praxity-inspect=1&praxity-resume=0`,
	);
	await waitForHydration(page);
	const picker = page.locator(".praxity-assessment-group-picker");
	await expect(picker).toBeVisible();
	await page.addStyleTag({ content: `${spacing}.praxity-assessment-group-picker{font-size:200%}` });
	await page.evaluate(() => document.fonts.ready);
	expect(await geometry(page)).toEqual({ overflow: 0, overflowElements: [], overlaps: [] });
});

for (const width of [160, 195, 240, 320])
	for (const spaced of [false, true])
		for (const theme of ["light", "dark"])
			for (const slug of ["assessment-groups", "complex-assessments", "narrated-page"]) {
				test(`comprehensive ${slug} ${width}px ${theme} spacing=${spaced}`, async ({
					page,
				}, info) => {
					await page.setViewportSize({ width, height: 450 });
					await page.goto(
						`${base}/comprehensive-${theme}/${slug}.html?praxity-inspect=1&praxity-resume=0`,
					);
					await waitForHydration(page);
					if (spaced) await page.addStyleTag({ content: spacing });
					const entryScroll = await page.evaluate(() => ({ left: scrollX, top: scrollY }));
					for (const island of await page.locator('[data-island="assessment"]:visible').all()) {
						await island.scrollIntoViewIfNeeded();
						await expect
							.poll(() => island.evaluate((element) => element.hasAttribute("data-hydrated")))
							.toBe(true);
					}
					await page.evaluate(() => document.fonts.ready);
					// Hydration visits must not choose the scroll position for the static reflow check.
					await page.evaluate(
						(position) => scrollTo({ ...position, behavior: "instant" }),
						entryScroll,
					);
					if (width < 400) {
						for (const header of await page
							.locator(".praxity-assessment-question-header:visible")
							.all()) {
							const stem = header.locator(".praxity-assessment-stem").first();
							expect
								.soft((await stem.boundingBox())?.width)
								.toBeCloseTo((await header.boundingBox())?.width ?? 0, 0);
						}
					}
					expect
						.soft(await textBreaks(page))
						.toEqual({ brokenWords: [], singleLetterButtonLines: [] });
					expect(await geometry(page)).toEqual({ overflow: 0, overflowElements: [], overlaps: [] });
					if (width < 360) {
						const nav = page.locator(".praxity-page-nav-fallback");
						for (const control of await nav.locator(".praxity-nav-prev,.praxity-nav-next").all()) {
							await expect(control).toHaveAccessibleName(/Previous|Next/);
							const box = await control.boundingBox();
							expect(Number(box?.width.toFixed(3))).toBeGreaterThanOrEqual(44);
							expect(Number(box?.height.toFixed(3))).toBeGreaterThanOrEqual(44);
						}
						if (width < 240) {
							const position = await nav.locator(".praxity-pages-position").boundingBox();
							const previous = await nav.locator(".praxity-nav-prev").boundingBox();
							expect((position?.y ?? 0) + (position?.height ?? 0)).toBeLessThanOrEqual(
								previous?.y ?? 0,
							);
						}
					}
					if (width <= 195 && slug === "assessment-groups") {
						const rows = page.locator(".praxity-assessment-choice-option:visible");
						expect(await rows.count()).toBeGreaterThan(0);
						for (const row of await rows.all()) {
							const label = row.locator(".praxity-choice-text");
							await expect(label).toBeVisible();
							await expect(row).toHaveCSS("padding-left", "14px");
							await expect(row).toHaveCSS("padding-right", "14px");
						}
					}
					await page.screenshot({
						path: info.outputPath(`${slug}-${width}-${theme}-${spaced}.png`),
						fullPage: true,
					});
				});
			}

test("deck footer growth keeps the reading area above its controls in the same frame", async ({
	page,
}) => {
	await page.setViewportSize({ width: 240, height: 450 });
	await page.goto(`${base}${entries.get("light")}?praxity-inspect=1&praxity-resume=0`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const bounds = await page.evaluate(() => {
		const controls = document.querySelector<HTMLElement>("#deck-controls");
		const workspace = document.querySelector(".deck-workspace");
		if (!controls || !workspace) throw new Error("Missing deck controls or workspace");
		controls.style.minHeight = `${controls.getBoundingClientRect().height + 44}px`;
		return {
			workspaceBottom: workspace.getBoundingClientRect().bottom,
			controlsTop: controls.getBoundingClientRect().top,
		};
	});
	expect(bounds.workspaceBottom).toBeLessThanOrEqual(bounds.controlsTop);
});
