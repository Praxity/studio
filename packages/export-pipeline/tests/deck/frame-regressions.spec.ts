import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import AdmZip from "adm-zip";
import { buildScormPackage } from "../../src/build";
import type { SCORMRuntime } from "../../src/scorm/types";
import { moduleDeckFixture } from "../fixtures/module-deck";
import { test } from "../muted-test";

let server: Server;
let base: string;
const files = new Map<string, Buffer>();
const entries: Record<string, string> = {};

test.beforeAll(async () => {
	test.setTimeout(120_000);
	const audio = await readFile(
		resolve(import.meta.dirname, "../../../../docs/test-fixtures/assets/narration-sample.mp3"),
	);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (input, options) =>
		String(input).startsWith("https://frame.example/")
			? Promise.resolve(
					new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg" } }),
				)
			: originalFetch(input, options);
	try {
		for (const locale of ["en", "fr"]) {
			const course = moduleDeckFixture(undefined, locale);
			course.moduleDeck = { gates: {} };
			course.navToggles = {
				...course.navToggles,
				navTopBar: true,
				navCourseTitle: true,
				navLessonTitles: true,
			};
			course.content = course.content.slice(0, 3).map((page, index) => ({
				...page,
				title: index === 1 ? "Autoévaluation rapide" : `Reading ${index + 1}`,
				blocks: readLesson(
					index === 1
						? `# Autoévaluation rapide\n\n${"Read the complete guidance before choosing a rating. ".repeat(180)}\n\n::: rating How confident are you?\n1. Not confident\n2. Somewhat confident\n3. Very confident\n:::\n\nThe final content stays above the footer.`
						: index === 2
							? "::: group Reading 3 {level=1}\n\n::: choice A review question {required=false}\n(x) Review\n( ) Continue\n:::\n"
							: "# Reading 1\n\nA short introduction.",
				).blocks.filter((block) => block.type !== "heading" || block.data.content !== "<p></p>"),
				narrationEnabled: true,
				data: { ...page.data, narrationAudio: "https://frame.example/title.mp3" },
			}));
			const result = await buildScormPackage(course, { format: "html" });
			for (const file of new AdmZip(result.zip).getEntries()) {
				if (file.isDirectory) continue;
				const path = `/${locale}/${file.entryName}`;
				const bytes = file.getData();
				files.set(path, bytes);
				if (
					file.entryName !== "index.html" &&
					file.entryName.endsWith(".html") &&
					bytes.toString().includes('data-deck-slide="slide-1"')
				)
					entries[locale] = path;
			}
			if (!entries[locale]) throw new Error(`Missing ${locale} deck entry`);
		}
		const early = await buildScormPackage(
			{
				id: "early-rating",
				title: "Early rating",
				sourceLocale: "en",
				content: [
					{
						id: "early",
						title: "Early rating",
						blocks: [
							{
								id: "early-radio",
								type: "rating",
								data: { label: "Confidence", maxValue: 3, style: "numeric", required: true },
							},
							{
								id: "early-slider",
								type: "rating",
								data: { label: "Confidence slider", maxValue: 3, style: "slider", required: true },
							},
						],
					},
				],
			},
			{ format: "html" },
		);
		for (const file of new AdmZip(early.zip).getEntries()) {
			if (file.isDirectory) continue;
			const bytes = file.getData();
			files.set(`/early/${file.entryName}`, bytes);
			if (
				file.entryName.endsWith(".html") &&
				bytes.toString().includes('data-block-id="early-radio"')
			)
				entries.early = `/early/${file.entryName}`;
		}
		if (!entries.early) throw new Error("Missing early rating entry");
	} finally {
		globalThis.fetch = originalFetch;
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
			mp3: "audio/mpeg",
		};
		res.setHeader(
			"Content-Type",
			types[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		res.end(bytes);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

async function open(page: Page, width: number, locale = "en") {
	await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
	await page.goto(base + entries[locale]);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.evaluate(() => document.fonts.ready);
}
async function capture(page: Page, info: TestInfo, name: string, width: number) {
	if (process.env.COURSE_AUDIT_SCREENSHOTS)
		await page.screenshot({
			path: `${process.env.COURSE_AUDIT_SCREENSHOTS}/${name}-${width}-${info.project.name}.png`,
		});
}

test("rating capture runs before controls and retains input before the first provider", async ({
	page,
}) => {
	let releaseOwner = () => {};
	let releaseHost = () => {};
	let ownerRequested = () => {};
	const ownerSeen = new Promise<void>((resolve) => {
		ownerRequested = resolve;
	});
	const ownerHeld = new Promise<void>((resolve) => {
		releaseOwner = resolve;
	});
	const hostHeld = new Promise<void>((resolve) => {
		releaseHost = resolve;
	});
	await page.route(/\/self-check-lifetime-[^/]+\.classic\.js$/, async (route) => {
		ownerRequested();
		await ownerHeld;
		await route.continue();
	});
	await page.route(/\/host-[^/]+\.js$/, async (route) => {
		await hostHeld;
		await route.continue();
	});
	try {
		await page.goto(base + entries.early, { waitUntil: "commit" });
		await ownerSeen;
		const ownerScript = page.locator('script[src*="self-check-lifetime-"]');
		await expect(ownerScript).not.toHaveAttribute("defer");
		await expect(page.locator('[data-island="rating"]')).toHaveCount(0);
		releaseOwner();
		const radioRoot = page.locator('[data-block-id="early-radio"]');
		const sliderRoot = page.locator('[data-block-id="early-slider"]');
		const radio = radioRoot.getByRole("radio").last();
		await radio.focus();
		await page.keyboard.press("Space");
		await expect(radio).toBeChecked();
		const slider = sliderRoot.getByRole("slider");
		await slider.focus();
		await page.keyboard.press("End");
		await expect(slider).toHaveValue("3");
		await expect(radioRoot).not.toHaveAttribute("data-hydrated", "");
		expect(await page.evaluate(() => window.__praxityBlockState === undefined)).toBe(true);
		releaseHost();
		for (const root of [radioRoot, sliderRoot])
			await expect(root).toHaveAttribute("data-completed", "true");
		await expect(radio).toBeChecked();
		await expect(slider).toHaveValue("3");
		expect(
			await page.evaluate(() =>
				["early-radio", "early-slider"].map((id) => window.__praxityBlockState?.get(id)),
			),
		).toEqual([{ value: 3 }, { value: 3 }]);
	} finally {
		releaseOwner();
		releaseHost();
	}
});

test("rating preserves Space while island hydration is held", async ({ page }) => {
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(/\/island-rating[^/]*\.js$/, async (route) => {
		await held;
		await route.continue();
	});
	try {
		await page.setViewportSize({ width: 768, height: 800 });
		await page.goto(base + entries.en, { waitUntil: "domcontentloaded" });
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await page.locator("#deck-next").click();
		const root = page.locator('.deck-slide:visible [data-island="rating"]');
		await expect(root).not.toHaveAttribute("data-hydrated", "");
		const rating = root.getByRole("radio").last();
		await rating.focus();
		await page.keyboard.press("Space");
		await expect(rating).toBeChecked();
		release();
		await expect(root).toHaveAttribute("data-hydrated", "");
		await expect(rating).toBeFocused();
		await expect(rating).toBeChecked();
	} finally {
		release();
	}
});

for (const change of ["reset", "provider"] as const) {
	test(`rating keeps a fresh same-label pointer choice after ${change} before hydration`, async ({
		page,
	}) => {
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(/\/island-rating[^/]*\.js$/, async (route) => {
			await held;
			await route.continue();
		});
		try {
			await page.goto(base + entries.en, { waitUntil: "domcontentloaded" });
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await page.locator("#deck-next").click();
			const root = page.locator('.deck-slide:visible [data-island="rating"]');
			const label = root.locator(".praxity-rating-option").last();
			const radio = root.getByRole("radio").last();
			await label.click();
			await expect(radio).toBeChecked();
			await page.evaluate((transition) => {
				if (transition === "reset") {
					if (!window.__praxitySelfCheckDocument) throw new Error("Missing document owner");
					window.__praxitySelfCheckDocument.reset();
				} else {
					const values = new Map<string, LearnerStateValue>();
					window.__praxityBlockState = {
						get: (id) => values.get(id) ?? { value: 1 },
						set: (id, value) => {
							values.set(id, value);
						},
					};
				}
			}, change);
			await label.click();
			await expect(root).not.toHaveAttribute("data-hydrated", "");
			release();
			await expect(root).toHaveAttribute("data-hydrated", "");
			await expect(radio).toBeChecked();
			expect(
				await root.evaluate((element) =>
					window.__praxityBlockState?.get(element.getAttribute("data-block-id") ?? ""),
				),
			).toEqual({ value: 3 });
		} finally {
			release();
		}
	});
}

for (const width of [1280, 768, 390]) {
	test(`rating and focus keep the document and frame fixed at ${width}px`, async ({
		page,
	}, info) => {
		await open(page, width);
		await page.locator("#deck-next").click();
		const rating = page.locator('.deck-slide:visible input[type="radio"]').last();
		await expect(rating).toBeEnabled();
		await rating.focus();
		await page.keyboard.press("Space");
		await expect(rating).toBeChecked();
		const labels = page.locator(".deck-slide:visible .praxity-rating-option");
		await expect(labels.last()).toBeInViewport({ ratio: 1 });
		const stage = page.locator("#main-content");
		const selectedScroll = await stage.evaluate((element) => element.scrollTop);
		await labels.first().click();
		await expect(page.locator('.deck-slide:visible input[type="radio"]').first()).toBeChecked();
		await labels.last().click();
		await expect(rating).toBeChecked();
		expect(await stage.evaluate((element) => element.scrollTop)).toBe(selectedScroll);
		await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
		await page.evaluate(() => window.scrollTo(0, 500));
		expect(
			await page.evaluate(() => ({
				y: scrollY,
				rootY: document.documentElement.scrollTop,
				bodyY: document.body.scrollTop,
			})),
		).toEqual({ y: 0, rootY: 0, bodyY: 0 });
		const header = await page.locator(".deck-identity").boundingBox();
		const footer = await page.locator("#deck-controls").boundingBox();
		if (!header || !footer) throw new Error("Deck frame must have geometry");
		expect(header.y).toBe(0);
		expect(footer.y + footer.height).toBe(width === 390 ? 844 : 800);
		await capture(page, info, "rating-fixed", width);
	});
	test(`tall stage has footer padding, a fade and a More below cue at ${width}px`, async ({
		page,
	}, info) => {
		await open(page, width);
		await page.locator("#deck-next").click();
		const main = page.locator("#main-content");
		await expect(main).toHaveCSS("overflow-y", "auto");
		await expect(page.locator("#deck-more-below")).toBeVisible();
		await expect(page.locator("#deck-more-below")).toHaveText("More below");
		expect(
			await page
				.locator("#deck-more-below")
				.evaluate((element) => getComputedStyle(element, "::before").backgroundImage),
		).toContain("linear-gradient");
		const padding = await main.evaluate((element) =>
			Number.parseFloat(getComputedStyle(element).paddingBottom),
		);
		const footer = await page.locator("#deck-controls").boundingBox();
		if (!footer) throw new Error("Missing footer geometry");
		expect(padding).toBeCloseTo(footer.height, 0);
		await capture(page, info, "stage-overflow", width);
		await main.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		await expect(page.locator("#deck-more-below")).toBeHidden();
		const final = await page
			.locator(".deck-slide:visible .praxity-slide > :last-child")
			.boundingBox();
		if (!final) throw new Error("Missing final content geometry");
		expect(final.y + final.height).toBeLessThanOrEqual(footer.y);
		await capture(page, info, "stage-bottom", width);
		await page.locator("#deck-next").click();
		await expect(page.locator("#deck-more-below")).toBeHidden();
	});
	test(`every slide title starts at the same stage offset at ${width}px`, async ({
		page,
	}, info) => {
		await open(page, width);
		const positions: number[] = [];
		for (let index = 0; index < 3; index++) {
			const title = await page.locator(".deck-slide:visible h1").boundingBox();
			await expect(page.locator(".deck-slide:visible h1")).toHaveCSS(
				"font-size",
				width === 390 ? "30px" : "38px",
			);
			const stage = await page.locator("#main-content").boundingBox();
			if (!title || !stage) throw new Error("Missing title or stage geometry");
			positions.push(title.y);
			expect(title.y - stage.y).toBe(width === 390 ? 24 : 48);
			await capture(page, info, `title-${index + 1}`, width);
			if (index < 2) await page.locator("#deck-next").click();
		}
		expect(new Set(positions).size).toBe(1);
	});
	for (const locale of ["en", "fr"]) {
		test(`auto-advance starts off and shows localized footer text when enabled, ${locale}, ${width}px`, async ({
			page,
		}, info) => {
			await open(page, width, locale);
			await expect(page.locator("#deck-advance")).toHaveAttribute("aria-checked", "false");
			await expect(page.locator("#deck-advance-status")).toBeHidden();
			await page.locator("#deck-more-toggle").click();
			await page.locator("#deck-script-toggle").click();
			await page.locator("#deck-sidebar-close").click();
			await page.locator("#deck-advance").click();
			await expect(page.locator("#deck-controls #deck-advance-status")).toBeVisible();
			await expect(page.locator("#deck-advance-status")).toHaveText(
				locale === "fr" ? "Avance automatique activée" : "Auto-advance on",
			);
			if (width >= 768) {
				const footer = await page.locator("#deck-controls").boundingBox();
				if (!footer) throw new Error("Auto-advance footer requires geometry");
				expect(footer.height).toBeLessThanOrEqual(64);
				for (const label of await page.locator(".deck-navigation-label").all()) {
					const geometry = await label.evaluate((element) => ({
						height: element.getBoundingClientRect().height,
						line: Number.parseFloat(getComputedStyle(element).lineHeight),
					}));
					expect(geometry.height).toBeCloseTo(geometry.line, 0);
				}
			}
			await capture(page, info, `auto-advance-${locale}`, width);
		});
	}
}

for (const width of [1280, 768, 390]) {
	test(`header stays within its frame and laptop footer stays one row at ${width}px`, async ({
		page,
	}) => {
		await open(page, width);
		const header = page.locator(".deck-identity");
		await expect(header).toHaveCSS("height", "40px");
		const moduleTitle = header.locator(".deck-module-title");
		await expect(moduleTitle).toHaveCSS("font-size", "15px");
		await expect(moduleTitle).toHaveCSS("white-space", "nowrap");
		if (width === 390) await expect(header.locator(".deck-course-title")).toBeHidden();
		const footer = await page.locator("#deck-controls").boundingBox();
		if (!footer) throw new Error("Deck footer must have geometry");
		if (width >= 768) expect(footer.height).toBeLessThanOrEqual(64);
		const play = page.locator("#deck-narration .praxity-narration-transport button").first();
		await expect(play).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await expect(play).toHaveCSS("border-top-width", "1px");
		await expect(page.locator(".deck-opening-narration")).toHaveCount(0);
		await play.focus();
		await expect(play).toHaveCSS("outline-offset", "2px");
		await expect(play).toHaveCSS("outline-width", "2px");
		await expect(page.locator("#deck-next")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	});
}

for (const width of [1280, 768, 390]) {
	test(`frame controls have 44px targets and labelled Tools at ${width}px`, async ({ page }) => {
		await open(page, width);
		// Assertion 8 applies to frame controls independently of block activities.
		for (const control of await page.locator(".deck-panel-heading button").all()) {
			if (!(await control.isVisible())) continue;
			const box = await control.boundingBox();
			if (!box) throw new Error("Visible panel control needs geometry");
			expect.soft(box.width).toBeGreaterThanOrEqual(44);
			expect.soft(box.height).toBeGreaterThanOrEqual(44);
		}
		const tools = page.getByRole("button", { name: "Tools", exact: true });
		await expect(tools).toBeVisible();
		await tools.click();
		for (const name of ["Course outline", "Transcript", "Larger text"]) {
			await expect(
				page.locator("#deck-more-panel").getByRole("button", { name, exact: true }),
			).toBeVisible();
		}
		await expect(page.getByRole("switch", { name: "Auto-advance", exact: true })).toBeVisible();
		for (const control of await page
			.locator(
				"#deck-controls button, #deck-controls input, #deck-controls select, .deck-panel-heading button",
			)
			.all()) {
			if (!(await control.isVisible())) continue;
			const box = await control.boundingBox();
			if (!box) throw new Error("Visible frame control needs geometry");
			expect
				.soft(box.width, (await control.getAttribute("aria-label")) ?? "control width")
				.toBeGreaterThanOrEqual(44);
			// Firefox's protocol quads round fractional origins; DOMRect preserves the target height.
			const height = await control.evaluate((element) => element.getBoundingClientRect().height);
			expect.soft(height, "control height").toBeGreaterThanOrEqual(44);
		}
		await tools.press("Escape");
		await expect(tools).toBeFocused();
		await expect(page.locator("#deck-more-panel")).toBeHidden();
	});
	test(`adjacent titles and module completion at ${width}px`, async ({ page }) => {
		await open(page, width);
		await page.locator("#deck-next").click();
		if (width >= 768) {
			await expect(page.locator("#deck-previous")).toContainText("Previous");
			await expect(page.locator("#deck-next")).toContainText("Next");
		}
		if (width === 1280) {
			await expect(page.locator("#deck-previous .deck-adjacent-title")).toHaveText("Reading 1");
			await expect(page.locator("#deck-next .deck-adjacent-title")).toHaveText("Reading 3");
		}
		await page.locator("#deck-next").click();
		await expect(page.locator("#deck-next")).toHaveAccessibleName("Finish module");
		await expect(page.locator("#deck-next")).toBeEnabled();
		await page.locator("#deck-next").click();
		await expect(page.getByRole("heading", { name: "Module complete", exact: true })).toBeVisible();
		await expect(page.locator("#deck-completion-time")).toHaveText(
			"Time spent: less than a minute",
		);
		for (const control of await page.locator("#deck-completion button").all()) {
			const box = await control.boundingBox();
			if (!box) throw new Error("Completion actions require geometry");
			expect(box.width).toBeGreaterThanOrEqual(44);
			expect(box.height).toBeGreaterThanOrEqual(44);
		}
		await expect(page.locator("#deck-next")).toHaveAccessibleName("Back to course");
		await expect(page.locator("#deck-next")).toBeEnabled();
		await page.getByRole("button", { name: "Review module", exact: true }).click();
		await expect(page.locator(".deck-slide:visible h1")).toHaveText("Reading 1");
		await expect(page.locator(".deck-slide:visible h1")).toBeFocused();
	});
}

test("laptop transcript reserves its own column beside the stage", async ({ page }) => {
	await open(page, 1280);
	await page.locator("#deck-more-toggle").click();
	await page.locator("#deck-script-toggle").click();
	const main = await page.locator("#main-content").boundingBox();
	const panel = await page.locator("#deck-sidebar").boundingBox();
	const footer = await page.locator("#deck-controls").boundingBox();
	if (!main || !panel || !footer) throw new Error("Transcript and stage require geometry");
	expect(main.x + main.width).toBeLessThanOrEqual(panel.x);
	expect(main.y + main.height).toBeLessThanOrEqual(footer.y);
	expect(panel.y + panel.height).toBeLessThanOrEqual(footer.y);
	await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "");
});

for (const width of [390, 320]) {
	test(`French Tools menu stays within the phone viewport at ${width}px`, async ({ page }) => {
		await open(page, width, "fr");
		await page.locator("#deck-more-toggle").click();
		const menu = await page.locator("#deck-more-panel").boundingBox();
		if (!menu) throw new Error("Tools menu requires geometry");
		expect(menu.x).toBeGreaterThanOrEqual(0);
		expect(menu.x + menu.width).toBeLessThanOrEqual(width);
	});
}

test("completion exposes the recorded grade and hides an absent score", async ({ page }) => {
	await open(page, 1280);
	await page.locator("#deck-next").click();
	await page.locator("#deck-next").click();
	await page.locator("#deck-next").click();
	await expect(page.locator("#deck-completion-score")).toBeHidden();
	await page.getByRole("button", { name: "Review module", exact: true }).click();
	await page.evaluate(() => {
		const runtime = window.__praxityRuntime as SCORMRuntime | undefined;
		if (!runtime) throw new Error("Completion grade requires a runtime");
		runtime.setScore(75, 0, 100);
	});
	await page.locator("#deck-next").click();
	await page.locator("#deck-next").click();
	await page.locator("#deck-next").click();
	await expect(page.locator("#deck-completion-score")).toHaveText("Score: 75 / 100");
	await expect(page.locator("#deck-completion-score")).toBeVisible();
});

test("a playback error keeps the laptop footer within 64px", async ({ page }) => {
	await open(page, 1280);
	await page.locator("[data-narration-player]").dispatchEvent("error");
	await expect(page.locator("#deck-status")).toContainText("Playback stopped");
	const footer = await page.locator("#deck-controls").boundingBox();
	if (!footer) throw new Error("Missing footer geometry");
	expect(footer.height).toBeLessThanOrEqual(64);
});
