import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import AdmZip from "adm-zip";
import { type CoursePackageDeploymentTarget, compileCourse, deployCourse } from "../../src/build";
import { analyzeAxe } from "../a11y/helpers";
import { serveFixtureBytes } from "../fixtures/http-bytes";
import {
	formattedDeckFixture,
	groupedDeckFixture,
	moduleDeckFixture,
} from "../fixtures/module-deck";
import { silentWav } from "../fixtures/silent-audio";
import { expectFocusRing, expectUnclippedRing } from "../focus-assertions";
import { test } from "../muted-test";

let server: Server;
let base: string;
let entry: string;
let gradedEntry: string;
let secondModuleEntry: string;
let audioEntry: string;
let shortAudioEntry: string;
let headingFreeEntry: string;
let mixedAudioEntry: string;
let frenchEntry: string;
let frenchAudioEntry: string;
let designedEntry: string;
let groupedEntry: string;
let floatedGroupEntry: string;
let formattedEntry: string;
let localOutlineEntry: string;
let openOutlineEntry: string;
let listEntry: string;
let widthEntry: string;
let widthSectionEntry: string;
let singleSlideEntry: string;
let twoSlideEntry: string;
let linksEntry: string;
const files = new Map<string, Buffer>();

// Windows WebKit exclusions: formatted transcript's exact paused-media seek.
const WINDOWS_WEBKIT_EXCLUSIONS = [
	"formatted transcript preserves semantic text through seeking and highlighting",
];

// Stable-playback journeys use a separate server prefix. WebKit's media loader
// can bypass page.route, so serve real long bytes at the fixture server itself.
const stablePlaybackAudio = silentWav(60);

// Preserve the real media clock while keeping browser checks quiet on shared hosts.
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const play = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function () {
			this.muted = true;
			return play.call(this);
		};
	});
});

for (const width of [390, 1280]) {
	for (const larger of [false, true]) {
		test(`keyboard Guided title and controls retain unclipped rings at ${width}, larger=${larger}`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize({ width, height: 900 });
			await page.addInitScript(
				(enabled) =>
					localStorage.setItem(
						"praxity-a11y",
						JSON.stringify({ textSize: enabled ? "large" : "default" }),
					),
				larger,
			);
			await page.goto(base + openOutlineEntry);
			const deck = page.locator(".praxity-deck");
			await expect(deck).toHaveAttribute("data-ready", "true");
			// Fresh narrow visits start lesson-first, so open the authored outline explicitly.
			// Use the keyboard so the following focus stays :focus-visible.
			if ((await deck.getAttribute("data-panel")) !== "outline") {
				const toggle = page.locator("#deck-outline-toggle");
				const more = page.locator("#deck-more-toggle");
				if ((await more.isVisible()) && !(await toggle.isVisible())) {
					await more.focus();
					await page.keyboard.press("Enter");
				}
				await expect(toggle).toBeVisible();
				await toggle.focus();
				await page.keyboard.press("Enter");
			}
			await expect(deck).toHaveAttribute("data-panel", "outline");
			const title = page.locator("#deck-outline-title");
			await title.focus();
			await expectFocusRing(title, 2, true);
			await expectUnclippedRing(title);
			await title.screenshot({ path: testInfo.outputPath("guided-title-focus.png") });
			await clickDeckTool(page, "#deck-outline-toggle");
			const next = page.locator("#deck-next");
			await next.focus();
			await page.keyboard.press("Shift+Tab");
			await page.keyboard.press("Tab");
			await expect(next).toBeFocused();
			await expectFocusRing(next, 2);
			await expect(next).toHaveCSS("outline-offset", "2px");
			await expectUnclippedRing(next);
		});
	}
}
async function revealDeckTool(page: Page, tool: Locator) {
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const more = page.locator("#deck-more-toggle");
	if ((await more.isVisible()) && !(await tool.isVisible())) await more.click();
	await expect(tool).toBeVisible();
}

async function clickDeckTool(page: Page, selector: string) {
	const tool = page.locator(selector);
	await revealDeckTool(page, tool);
	await tool.click();
}

test.beforeAll(async () => {
	test.setTimeout(120_000);
	const audio = await readFile(
		resolve(import.meta.dirname, "../../../../docs/test-fixtures/assets/narration-sample.mp3"),
	);
	const illustration = await readFile(
		resolve(import.meta.dirname, "../../../../docs/test-fixtures/assets/sample-slide-image.webp"),
	);
	const originalFetch = globalThis.fetch;
	// Outlast the 45s journey timeout. Formatted playback can also seek to the
	// final cue at 22s, so its clock needs more time after that seek.
	const stableAudio = silentWav(60);
	const formattedAudio = silentWav(90);
	const formattedTimings =
		"WEBVTT\n\n00:00.000 --> 00:02.000\nReading context\n\n00:02.000 --> 00:06.000\n[sincerely] Read with care and at your pace.\n\n00:06.000 --> 00:10.000\n[delighted] Ask for support.\n\n00:10.000 --> 00:14.000\nReview the options.\n\n00:14.000 --> 00:18.000\nChoose a response.\n\n00:18.000 --> 00:22.000\nContinue when ready.\n";
	globalThis.fetch = (input, options) =>
		String(input).startsWith("https://deck.example/")
			? Promise.resolve(
					new Response(
						String(input).endsWith(".vtt")
							? formattedTimings
							: String(input).endsWith(".wav")
								? String(input).endsWith("/formatted.wav")
									? new Uint8Array(formattedAudio)
									: new Uint8Array(stableAudio)
								: String(input).endsWith(".webp")
									? new Uint8Array(illustration)
									: new Uint8Array(audio),
						{
							headers: {
								"Content-Type": String(input).endsWith(".vtt")
									? "text/vtt"
									: String(input).endsWith(".wav")
										? "audio/wav"
										: String(input).endsWith(".webp")
											? "image/webp"
											: "audio/mpeg",
							},
						},
					),
				)
			: originalFetch(input, options);
	try {
		for (const variant of [
			"reading",
			"graded",
			"audio",
			"audio-short",
			"mixed-audio",
			"heading-free",
			"fr",
			"fr-audio",
			"designed",
			"grouped",
			"grouped-float",
			"formatted",
			"local-outline",
			"open-outline",
			"list",
			"widths",
			"widths-section",
			"single-slide",
			"two-slides",
			"links",
		]) {
			const narrated =
				variant === "audio" ||
				variant === "audio-short" ||
				variant === "fr-audio" ||
				variant === "designed" ||
				variant === "mixed-audio" ||
				variant === "heading-free";
			const course =
				variant === "formatted"
					? formattedDeckFixture()
					: variant === "grouped" || variant === "grouped-float"
						? groupedDeckFixture(variant === "grouped-float")
						: moduleDeckFixture(
								narrated ? "https://deck.example/fixture.mp3" : undefined,
								variant.startsWith("fr") ? "fr" : "en",
							);
			if (variant === "audio" || variant === "audio-short")
				course.cssVars = { "--praxity-font-family": "Georgia, serif" };
			// Existing narration journeys cover the explicit opt-in; frame-regressions covers defaults.
			course.deckDesign = {
				...course.deckDesign,
				autoAdvance: true,
				// Direct-entry and cross-module redirect journeys retain their authored ordering lock.
				...(variant === "reading" ? { sequentialLessons: true } : {}),
			};
			if (narrated && variant !== "audio-short")
				for (const page of course.content) {
					if (typeof page.data?.narrationAudio === "string")
						page.data.narrationAudio = page.data.narrationAudio.replace(/\.mp3$/, ".wav");
					for (const block of page.blocks) {
						if (typeof block.data.narrationAudio === "string")
							block.data.narrationAudio = block.data.narrationAudio.replace(/\.mp3$/, ".wav");
						if (block.type === "audio" && typeof block.data.src === "string")
							block.data.src = block.data.src.replace(/\.mp3$/, ".wav");
					}
				}
			if (variant === "single-slide" || variant === "two-slides") {
				course.content = course.content.slice(0, variant === "single-slide" ? 1 : 2);
				for (const slide of course.content)
					slide.blocks = slide.blocks.filter((block) => block.type !== "assessment");
				course.moduleDeck = {};
			}
			if (variant === "heading-free") {
				course.content[0].blocks = course.content[0].blocks.filter(
					(block) => block.type !== "heading",
				);
			}
			if (variant === "mixed-audio") {
				// Assessment intentionally excluded from narration; the following slide
				// keeps its reading script but has narration explicitly switched off.
				const silent = course.content[1];
				silent.data = { ...silent.data, narrationDisabled: true };
				for (const block of silent.blocks) block.data.narrationDisabled = true;
				course.content[2].narrationEnabled = false;
			}
			if (variant === "graded") {
				const question = course.content
					.flatMap((page) => page.blocks)
					.find((block) => block.id === "pass-gate");
				if (!question) throw new Error("Missing certification question");
				question.data.gradingMode = "exact";
				course.moduleDeck = { gates: { "practice-gate": "attempt" } };
			}
			if (variant === "designed")
				course.deckDesign = {
					preset: "custom",
					outline: false,
					initialPanel: "transcript",
					slideCounter: false,
					followNarration: false,
					autoAdvance: false,
				};
			if (variant === "local-outline") course.deckDesign = { outlineDetail: "currentModule" };
			if (variant === "open-outline") course.deckDesign = { initialPanel: "outline" };
			if (variant === "list")
				course.content[0].blocks.push(
					{
						id: "list-float-image",
						type: "image",
						data: {
							src: "https://deck.example/context.webp",
							decorative: true,
							float: "left",
							width: "small",
						},
					},
					{ id: "list-intro", type: "text", data: { content: "People who need support:" } },
					{
						id: "list-items",
						type: "text",
						data: {
							content:
								"<ul><li>Observers returning from remote expeditions or overnight sessions without calibrated instruments.</li><li>Curators of antique telescopes.</li></ul>",
						},
					},
					{
						id: "list-following",
						type: "text",
						data: { content: "Stable telescopes need supports." },
					},
					{ id: "list-float-end", type: "blockBreak", data: { close: "float" } },
				);
			if (variant === "widths" || variant === "widths-section")
				for (const width of ["breakout", "full"] as const)
					course.content[0].blocks.push({
						id: `width-${width}`,
						type: "image",
						data: {
							src: "https://deck.example/slide.webp",
							alt: `Slide image at ${width} width`,
							layoutMode: width,
						},
					});
			if (variant === "widths-section") course.sectionRhythm = "alternate";
			if (variant === "links") {
				course.content[0].blocks.push({
					id: "links-rating",
					type: "rating",
					data: { label: "Confidence", style: "numeric", maxValue: 3 },
				});
				course.content[0].blocks.push({
					id: "authored-links",
					type: "text",
					data: {
						content:
							'Authored links: <a href="#slide-2"><strong>Practice</strong> question</a>, <a href="introduction.html#slide-4">Reading slide</a>, <a href="#block-text-1">Summary section</a> and <a href="https://external.example/">External guide</a>. A <span class="inline-tooltip-trigger" data-tooltip-content="A step that must be finished first.">gate</span> blocks progress.',
					},
				});
				const practice = course.content[1].blocks.find((block) => block.id === "practice-gate");
				if (!practice) throw new Error("Missing practice question");
				// Feedback renders after submission, long after the deck has started.
				const feedback = practice.data.feedback as {
					correct: Array<{ data: { content: string } }>;
					incorrect: Array<{ data: { content: string } }>;
				};
				feedback.correct[0].data.content =
					'<p>Correct. <a href="#slide-1">Back to the introduction</a>.</p>';
				feedback.incorrect[0].data.content =
					'<p>Review <a href="#slide-1">the introduction</a> before trying again.</p>';
			}
			const artifact = await compileCourse(course, { mode: "source" });
			try {
				const deployment = await deployCourse(artifact, {
					format: "html",
				} as CoursePackageDeploymentTarget);
				if (!("zip" in deployment)) throw new Error("Expected package");
				const prefix = `/${variant}/`;
				for (const file of new AdmZip(deployment.zip).getEntries())
					if (!file.isDirectory) {
						files.set(prefix + file.entryName, file.getData());
						if (process.env.DECK_ARTIFACT_DIR) {
							const destination = resolve(
								process.env.DECK_ARTIFACT_DIR,
								prefix.slice(1),
								file.entryName,
							);
							await mkdir(resolve(destination, ".."), { recursive: true });
							await writeFile(destination, file.getData());
						}
					}
				const path = `${prefix}${artifact.manifest.pages[0].slug}.html`;
				if (variant === "reading") {
					const secondModule = artifact.manifest.pages.find((page) => page.id === "module-two");
					if (!secondModule) throw new Error("Missing second module fixture page");
					secondModuleEntry = `${prefix}${secondModule.slug}.html`;
				}
				if (variant === "graded") gradedEntry = path;
				else if (variant === "single-slide") singleSlideEntry = path;
				else if (variant === "two-slides") twoSlideEntry = path;
				else if (variant === "links") linksEntry = path;
				else if (variant === "local-outline") localOutlineEntry = path;
				else if (variant === "open-outline") openOutlineEntry = path;
				else if (variant === "list") listEntry = path;
				else if (variant === "formatted") formattedEntry = path;
				else if (variant === "grouped") groupedEntry = path;
				else if (variant === "mixed-audio") mixedAudioEntry = path;
				else if (variant === "heading-free") headingFreeEntry = path;
				else if (variant === "grouped-float") floatedGroupEntry = path;
				else if (variant === "designed") designedEntry = path;
				else if (variant === "fr-audio") frenchAudioEntry = path;
				else if (variant === "audio-short") shortAudioEntry = path;
				else if (narrated) audioEntry = path;
				else if (variant === "fr") frenchEntry = path;
				else if (variant === "widths") widthEntry = path;
				else if (variant === "widths-section") widthSectionEntry = path;
				else entry = path;
			} finally {
				await artifact.dispose();
			}
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		const stablePlayback = path.startsWith("/stable/");
		const unavailable = path.startsWith("/unavailable/");
		const fixturePath = stablePlayback
			? path.slice("/stable".length)
			: unavailable
				? path.slice("/unavailable".length)
				: path;
		const fixtureBytes = files.get(fixturePath);
		const bytes =
			fixtureBytes && stablePlayback && fixturePath.endsWith(".mp3")
				? stablePlaybackAudio
				: fixtureBytes;
		if (!bytes) {
			res.writeHead(404);
			res.end();
			return;
		}
		if (unavailable && /\.(mp3|wav)$/.test(fixturePath)) {
			res.writeHead(503);
			res.end();
			return;
		}
		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			mp3: "audio/mpeg",
			wav: "audio/wav",
			webp: "image/webp",
			json: "application/json",
			woff2: "font/woff2",
		};
		res.setHeader(
			"Content-Type",
			stablePlayback && fixturePath.endsWith(".mp3")
				? "audio/wav"
				: types[path.split(".").at(-1) ?? ""] || "application/octet-stream",
		);
		serveFixtureBytes(req, res, bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
	if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

for (const sectioned of [false, true])
	test(`deck block widths fit the slide${sectioned ? " with sections" : ""} beside a transcript and reflow at 320px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto(base + (sectioned ? widthSectionEntry : widthEntry));
		await clickDeckTool(page, "#deck-script-toggle");
		await expect(page.locator("#deck-sidebar")).toBeVisible();
		const widths = await page.evaluate(() => {
			const main = document.querySelector("#main-content");
			if (!main) throw new Error("Missing deck main content");
			const rect = (selector: string) => {
				const element = document.querySelector(selector);
				if (!element) throw new Error(`Missing ${selector}`);
				const { left, right, width } = element.getBoundingClientRect();
				return { left, right, width };
			};
			return {
				sectioned: ["width-breakout", "width-full"].map((id) =>
					Boolean(document.querySelector(`[data-block-id="${id}"]`)?.closest(".praxity-section")),
				),
				text: rect('[data-deck-slide="slide-1"] .praxity-block-text'),
				breakout: rect('[data-block-id="width-breakout"]'),
				full: rect('[data-block-id="width-full"]'),
				slide: rect("#main-content"),
				sidebar: rect("#deck-sidebar"),
				gutter: 32,
				overflow: main.scrollWidth > main.clientWidth,
			};
		});
		expect(widths.sectioned).toEqual([false, false]);
		expect(widths.breakout.width).toBeGreaterThan(widths.text.width);
		expect(widths.full.width).toBeCloseTo(widths.breakout.width, 0);
		expect(Math.abs(widths.full.left - widths.slide.left - widths.gutter)).toBeLessThan(2);
		expect(Math.abs(widths.slide.right - widths.full.right - widths.gutter)).toBeLessThan(2);
		expect(widths.full.left).toBeGreaterThanOrEqual(widths.slide.left);
		expect(widths.full.right).toBeLessThanOrEqual(widths.slide.right);
		expect(widths.full.right).toBeLessThanOrEqual(widths.sidebar.left);
		expect(widths.overflow).toBe(false);

		await page.locator("#deck-sidebar-close").click();
		await page.setViewportSize({ width: 320, height: 720 });
		for (const dir of ["ltr", "rtl"] as const) {
			await page.locator("html").evaluate((element, value) => {
				element.setAttribute("dir", value);
			}, dir);
			const fits = await page.evaluate(() => {
				const main = document.querySelector("#main-content");
				if (!main) throw new Error("Missing deck main content");
				const slide = main.getBoundingClientRect();
				const text = document
					.querySelector('[data-deck-slide="slide-1"] .praxity-block-text')
					?.getBoundingClientRect();
				if (!text) throw new Error("Missing deck paragraph");
				return (
					main.scrollWidth <= main.clientWidth &&
					["width-breakout", "width-full"].every((id) => {
						const block = document
							.querySelector(`[data-block-id="${id}"]`)
							?.getBoundingClientRect();
						if (!block) throw new Error(`Missing ${id}`);
						return (
							block.width >= text.width - 1 &&
							block.left >= slide.left &&
							block.right <= slide.right
						);
					})
				);
			});
			expect(fits).toBe(true);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true,
			);
		}
	});

for (const width of [1280, 320]) {
	test(`grouped survey scrolls within one slide and releases after submission at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 720 });
		await page.goto(base + groupedEntry);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await page.locator("#deck-next").click();
		const survey = page.locator('[data-deck-slide="group-slide-2"]');
		await expect(survey).toBeVisible();
		await expect(survey.getByRole("radio")).toHaveCount(18);
		await expect(survey.getByRole("radio", { name: "I don't know", exact: true })).toHaveCount(6);
		await expect(survey.locator(".praxity-assessment-stem p")).toHaveCount(0);
		const submit = survey.getByRole("button", { name: "Send survey", exact: true });
		await expect(submit).toBeVisible();
		expect(
			await survey.evaluate((element) => element.getBoundingClientRect().height),
		).toBeGreaterThan(720);
		await submit.click();
		await expect(survey.getByRole("radio", { name: "Confident 1", exact: true })).toBeFocused();
		await expect(survey.getByRole("alert")).toContainText("Answer all required questions");
		for (let index = 1; index <= 6; index++)
			await survey.getByRole("radio", { name: `Confident ${index}`, exact: true }).check();
		const lastAnswer = survey.getByRole("radio", { name: "Need practice 6", exact: true });
		await lastAnswer.focus();
		await expect(lastAnswer).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await expect(survey).toBeVisible();
		await page.locator("#deck-next").click();
		await expect(survey).toBeVisible();
		await submit.scrollIntoViewIfNeeded();
		await expect(submit).toBeInViewport();
		await page.screenshot({ path: testInfo.outputPath(`grouped-survey-${width}.png`) });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		const scan = await analyzeAxe(
			page,
			new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]),
		);
		expect(scan.violations).toEqual([]);
		await submit.click();
		await expect(survey.locator("[data-assessment-group-results]")).toContainText("Completed");
		await page.reload();
		await expect(survey).toBeVisible();
		await page.locator("#deck-next").click();
		await expect(page.locator('[data-deck-slide="group-slide-3"]')).toBeVisible();
	});
}

test("a grouped choose-one check retries and releases without answering hidden alternatives", async ({
	page,
}) => {
	await page.goto(base + groupedEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-next").click();
	for (let index = 1; index <= 6; index++)
		await page.getByRole("radio", { name: `Confident ${index}`, exact: true }).check();
	await page.getByRole("button", { name: "Send survey", exact: true }).click();
	await expect(page.locator("[data-assessment-group-results]:visible")).toContainText("Completed");
	await expect(page.locator("#deck-next")).toBeFocused();
	await expect(page.locator("#deck-next")).toHaveAccessibleDescription("Completed");
	await page.locator("#deck-next").click();
	const check = page.locator('[data-deck-slide="group-slide-3"]');
	await expect(check).toBeVisible();
	await expect(page.locator("#deck-next")).not.toHaveAttribute("aria-describedby");
	await expect(page.locator("#deck-next")).toHaveAccessibleDescription("Next slide: Reflection");
	await check.getByRole("radio", { name: "Second scenario", exact: true }).check();
	await expect(check.getByRole("radio", { name: "Ask before helping", exact: true })).toBeHidden();
	await check.getByRole("radio", { name: "Decide for someone", exact: true }).check();
	const submit = check.getByRole("button", { name: "Submit chosen answer", exact: true });
	await submit.click();
	await expect(check.locator("[data-assessment-group-results]")).toContainText("Not passed");
	await page.locator("#deck-next").click();
	await expect(check).toBeVisible();
	await check.getByRole("button", { name: "Try again", exact: true }).click();
	await check.getByRole("radio", { name: "Offer a choice", exact: true }).check();
	await submit.click();
	await expect(check.locator("[data-assessment-group-results]")).toContainText("Passed");
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="group-slide-4"]')).toBeVisible();
});

test("grouped questions remain readable without JavaScript", async ({ browser }) => {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		viewport: { width: 320, height: 720 },
	});
	try {
		const page = await context.newPage();
		await page.goto(base + groupedEntry);
		await expect(page.locator('[data-deck-slide="group-slide-2"]')).toBeVisible();
		await expect(page.getByRole("heading", { name: "Experience survey" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "Choose your check" })).toBeVisible();
		await expect(
			page.locator("p.praxity-assessment-stem", { hasText: "Experience question 6" }),
		).toBeVisible();
		await expect(
			page.locator("p.praxity-assessment-stem", { hasText: "First scenario" }),
		).toBeVisible();
		await expect(
			page.locator("p.praxity-assessment-stem", { hasText: "Second scenario" }),
		).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
	} finally {
		await context.close();
	}
});

test("script-only reading, attempt gate, pass gate, resume and module boundary", async ({
	page,
}) => {
	await page.goto(base + entry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator("[data-deck-slide]:visible")).toHaveCount(1);
	await clickDeckTool(page, "#deck-outline-toggle");
	const currentOutline = page.locator('[data-deck-page="slide-1"]');
	const lockedOutline = page.locator('[data-deck-page="slide-3"]');
	await expect(currentOutline).toHaveAttribute("aria-current", "page");
	await expect(lockedOutline).toHaveAttribute("aria-disabled", "true");
	await expect(lockedOutline.locator("[data-deck-lock]")).toBeVisible();
	expect(await lockedOutline.innerText()).not.toContain("Locked");
	await lockedOutline.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
	await expect(page.locator("#deck-status")).toContainText("Complete the required activity");
	await page.locator("#deck-outline-close").click();
	await clickDeckTool(page, "#deck-script-toggle");
	await expect(page.locator("#deck-script")).toBeVisible();
	await expect(page.locator("#deck-script-title")).toBeFocused();
	await expect(page.locator("#deck-script")).toContainText("complete reading script");
	await expect(page.locator('[data-deck-reading="slide-3"]')).toBeHidden();
	await page.locator("#deck-sidebar-close").click();
	await page.locator("#deck-next").click();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
	await page.getByRole("radio", { name: "Make an assumption" }).check();
	await page.getByRole("button", { name: /submit|check/i }).click();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	await expect(lockedOutline).toHaveAttribute("aria-current", "page");
	await expect(lockedOutline).toHaveAttribute("aria-disabled", "false");
	await expect(lockedOutline.locator("[data-deck-lock]")).toBeHidden();
	await page.getByRole("radio", { name: "Decide for someone" }).check();
	await page.getByRole("button", { name: /submit|check/i }).click();
	const feedback = page.locator('[data-deck-slide="slide-3"] [data-assessment-feedback]');
	await expect(feedback.getByRole("button", { name: "Try again", exact: true })).toBeFocused();
	await expect(feedback).toContainText("1 of 2 attempts used");
	const wrongOption = page
		.locator('[data-deck-slide="slide-3"] .praxity-assessment-choice-option')
		.filter({ has: page.getByRole("radio", { name: "Decide for someone", exact: true }) });
	await expect(wrongOption.locator(".praxity-choice-status")).toHaveText("Not quite");
	await expect(wrongOption.locator(".praxity-choice-feedback")).toContainText("Try again.");
	expect((await feedback.boundingBox())?.height).toBeGreaterThan(0);
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	await page.getByRole("button", { name: /try again|retry/i }).click();
	await expect(page.getByRole("radio", { name: "Offer options" })).toBeEnabled();
	await expect(page.locator('[data-deck-slide="slide-3"] input').first()).toBeFocused();
	await page.getByRole("radio", { name: "Offer options" }).check();
	await page.getByRole("button", { name: /submit|check/i }).click();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
	await page.reload();
	await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
	await expect(page.locator("[data-narration-player]")).toHaveCount(0);
	await expect(page.locator(".deck-module-links")).toBeHidden();
	await clickDeckTool(page, "#deck-script-toggle");
	await page.getByRole("button", { name: "Finish module", exact: true }).click();
	await expect(page.locator("#deck-completion")).toBeVisible();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
	await expect(page.locator("[data-narration-player]")).toHaveCount(0);
	await expect(page.locator("#deck-sidebar")).toBeVisible();
	await expect(page.locator("#main-content")).toBeFocused();
	await page.locator("#deck-sidebar-close").click();
	await page.getByRole("button", { name: "Previous module", exact: true }).click();
	await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
	await expect(page.locator("#deck-sidebar")).toBeHidden();
	await page.getByRole("button", { name: "Finish module", exact: true }).click();
	await expect(page.locator("#deck-completion")).toBeVisible();
	await page.locator("#deck-next").click();
	await clickDeckTool(page, "#deck-outline-toggle");
	await expect(page.locator("#deck-outline [data-deck-page]")).toHaveCount(2);
	await expect(page.locator('#deck-outline [data-deck-page="slide-2"]')).toHaveCount(0);
	await expect(page.locator('#deck-outline [data-deck-page="module-two"]')).toHaveAttribute(
		"aria-current",
		"page",
	);
});

for (const width of [1280, 390]) {
	test(`boundary navigation preserves focus and Tab order at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 720 });
		await page.goto(base + twoSlideEntry);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		// Keep the next Tab within the document instead of testing browser-chrome wrapping.
		await page.evaluate(() => {
			const afterDeck = document.createElement("button");
			afterDeck.id = "after-deck";
			afterDeck.textContent = "After the deck";
			document.querySelector(".praxity-deck")?.after(afterDeck);
		});
		const previous = page.locator("#deck-previous");
		const next = page.locator("#deck-next");
		await next.focus();
		await page.keyboard.press("Enter");
		await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
		await expect(next).toBeEnabled();
		await expect(next).toHaveAccessibleName("Finish module");
		await expect(previous).toBeEnabled();
		await expect(page.locator("#main-content")).toBeFocused();
		await expect(previous).toBeInViewport();
		expect(await previous.evaluate((node) => Boolean(node.closest("[hidden],[inert]")))).toBe(
			false,
		);
		await next.focus();
		await page.keyboard.press("Tab");
		await expect(page.locator("#after-deck")).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(next).toBeFocused();
		await previous.focus();
		await page.keyboard.press("Enter");
		await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
		await expect(previous).toBeDisabled();
		await expect(next).toBeEnabled();
		await expect(page.locator('[data-deck-slide="slide-1"] h1')).toBeFocused();
		await expect(next).toBeInViewport();
		expect(await next.evaluate((node) => Boolean(node.closest("[hidden],[inert]")))).toBe(false);
		await previous.focus();
		await expect(previous).not.toBeFocused();
		await next.focus();
		await page.keyboard.press("Shift+Tab");
		await page.keyboard.press("Tab");
		await expect(next).toBeFocused();
	});
}

test("Guided containers expose no click action while course controls keep theirs", async ({
	page,
	browserName,
}) => {
	test.skip(browserName !== "chromium", "Chromium CDP reports listener ownership and clickability");
	await page.goto(base + linksEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator('[data-island="rating"]')).toHaveAttribute("data-hydrated", "");
	// Inline tooltips once delegated click from body, which made everything clickable.
	const term = page.locator("[data-tooltip-content]");
	await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
	const cdp = await page.context().newCDPSession(page);
	// Count only course scripts. Playwright's injected scripts add their own
	// window listeners for hit-target checks.
	const scriptUrls = new Map<string, string>();
	cdp.on("Debugger.scriptParsed", (script) => scriptUrls.set(script.scriptId, script.url));
	await cdp.send("Debugger.enable");
	// Chromium's mouse-button event list; any of these makes an element clickable.
	const mouseButtonEvents = new Set(["click", "mousedown", "mouseup", "DOMActivate"]);
	const mouseButtonListeners = async (expression: string) => {
		const { result } = await cdp.send("Runtime.evaluate", { expression });
		if (!result.objectId) throw new Error(`Missing ${expression}`);
		const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
			objectId: result.objectId,
		});
		return listeners
			.filter((listener) => scriptUrls.get(listener.scriptId)?.startsWith(base))
			.map((listener) => listener.type)
			.filter((type) => mouseButtonEvents.has(type));
	};
	const expectPlainContainers = async () => {
		for (const expression of [
			"window",
			"document",
			"document.documentElement",
			"document.body",
			'document.querySelector(".praxity-deck")',
			'document.querySelector(".deck-workspace")',
			'document.querySelector("main")',
		])
			expect(await mouseButtonListeners(expression), expression).toEqual([]);
	};
	await expectPlainContainers();
	expect(
		await mouseButtonListeners(`document.querySelector('[data-deck-page="slide-2"]')`),
	).toContain("click");
	expect(await mouseButtonListeners(`document.querySelector("[data-tooltip-content]")`)).toEqual([
		"click",
	]);
	const definition = page.locator(".inline-tooltip-popover[data-visible]");
	await term.click();
	await expect(definition).toHaveText(
		"A step that must be finished first.Full glossary , (opens in a new tab)",
	);
	await expect(
		definition.getByRole("link", { name: "Full glossary , (opens in a new tab)", exact: true }),
	).toHaveAttribute("href", "glossary.html");
	await page.locator("main h1").first().click();
	await expect(definition).toHaveCount(0);
	const snapshot = await cdp.send("DOMSnapshot.captureSnapshot", { computedStyles: [] });
	const clickable = snapshot.documents.flatMap((document) =>
		(document.nodes.isClickable?.index ?? []).map((index) => {
			const attributes = (document.nodes.attributes?.[index] ?? []).map(
				(value) => snapshot.strings[value],
			);
			const classAt = attributes.findIndex(
				(value, position) => position % 2 === 0 && value === "class",
			);
			return {
				name: snapshot.strings[document.nodes.nodeName?.[index] ?? -1],
				classes: classAt < 0 ? [] : attributes[classAt + 1].split(/\s+/),
			};
		}),
	);
	type ClickableNode = (typeof clickable)[number];
	for (const [label, matches] of [
		["#document", (node: ClickableNode) => node.name === "#document"],
		["html", (node: ClickableNode) => node.name === "HTML"],
		["body", (node: ClickableNode) => node.name === "BODY"],
		["deck", (node: ClickableNode) => node.classes.includes("praxity-deck")],
		["workspace", (node: ClickableNode) => node.classes.includes("deck-workspace")],
		["main", (node: ClickableNode) => node.name === "MAIN"],
	] as const)
		expect(clickable.filter(matches), label).toEqual([]);
	expect(
		clickable.some((node) => node.name === "A" && node.classes.includes("deck-module-link")),
	).toBe(true);
	await page.getByRole("link", { name: "Practice question" }).click();
	await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
	// Hydrated islands must not add container listeners either.
	await expect(
		page.locator('[data-deck-slide="slide-2"] [data-island="assessment"][data-hydrated]'),
	).toHaveCount(1);
	await expectPlainContainers();
});

test("authored course links resolve in place while section and external links stay native", async ({
	page,
}) => {
	await page.goto(base + linksEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const introduction = page.locator('[data-deck-slide="slide-1"]');
	const practice = page.locator('[data-deck-slide="slide-2"]');
	const practiceLink = introduction.getByRole("link", { name: "Practice question" });
	// A pointer on nested text resolves to the owning link.
	await practiceLink.locator("strong").click();
	await expect(practice).toBeVisible();
	await expect(page).toHaveURL(/introduction\.html#slide-2$/);
	await page.goBack();
	await expect(introduction).toBeVisible();
	await expect(page).toHaveURL(/#slide-1$/);
	const gated = introduction.getByRole("link", { name: "Reading slide" });
	await gated.focus();
	await page.keyboard.press("Enter");
	await expect(introduction).toBeVisible();
	await expect(page.locator("#deck-status")).toHaveText(
		"Complete the required activity to continue.",
	);
	await expect(page).toHaveURL(/#slide-1$/);
	await gated.click();
	await expect(introduction).toBeVisible();
	await expect(page).toHaveURL(/#slide-1$/);
	await practiceLink.focus();
	await page.keyboard.press("Enter");
	await expect(practice).toBeVisible();
	await page.locator("#deck-previous").click();
	await expect(introduction).toBeVisible();
	await introduction.getByRole("link", { name: "Summary section" }).click();
	await expect(page).toHaveURL(/introduction\.html#block-text-1$/);
	await expect(introduction).toBeVisible();
	await expect(page.locator("[data-deck-slide]:visible")).toHaveCount(1);
	await page.route("https://external.example/**", (route) =>
		route.fulfill({ contentType: "text/html", body: "<title>External guide</title>" }),
	);
	await introduction.getByRole("link", { name: "External guide" }).click();
	await expect(page).toHaveURL("https://external.example/");
	await expect(page).toHaveTitle("External guide");
});

test("links in feedback rendered after the deck starts resolve in place", async ({ page }) => {
	await page.goto(base + linksEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-next").click();
	const practice = page.locator('[data-deck-slide="slide-2"]');
	await expect(practice).toBeVisible();
	await page.getByRole("radio", { name: "Make an assumption" }).check();
	await page.getByRole("button", { name: /submit|check/i }).click();
	const back = practice.getByRole("link", { name: "the introduction" });
	await expect(back).toBeVisible();
	await back.click();
	await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
	await expect(page).toHaveURL(/introduction\.html#slide-1$/);
	await page.locator("#deck-next").click();
	await expect(practice).toBeVisible();
	await back.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
});

test("outline and module links resolve nested pointer targets, gates and other modules", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 720 });
	await page.goto(base + linksEntry);
	const deck = page.locator(".praxity-deck");
	await clickDeckTool(page, "#deck-outline-toggle");
	await expect(deck).toHaveAttribute("data-panel", "outline");
	const outline = page.locator("#deck-outline");
	await outline.locator('[data-deck-page="slide-3"] svg').first().click();
	await expect(page.locator("#deck-status")).toHaveText(
		"Complete the required activity to continue.",
	);
	await expect(deck).toHaveAttribute("data-panel", "outline");
	await outline.locator('[data-deck-page="slide-2"] svg').first().click();
	await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
	await expect(deck).toHaveAttribute("data-panel", "");
	await expect(page.locator("#deck-outline-sidebar")).toBeHidden();

	await page.goto(`${base}${linksEntry}?praxity-inspect=1#slide-4`);
	await clickDeckTool(page, "#deck-outline-toggle");
	await expect(page.locator("#deck-outline-title")).toBeFocused();
	await outline.locator('[data-deck-page="module-two"]').focus();
	await page.keyboard.press("Enter");
	await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
	await expect(page).toHaveURL(/\?praxity-inspect=1#module-two$/);
	await page.getByRole("link", { name: "Review certification", exact: true }).click();
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	await expect(page).toHaveURL(/introduction\.html\?praxity-inspect=1#slide-3$/);
});

test("transcript seek buttons respond to keyboard and focusless activation", async ({ page }) => {
	await page.goto(`${base}/stable${audioEntry}?praxity-inspect=1#slide-4`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await clickDeckTool(page, "#deck-script-toggle");
	const seeks = page.locator('#deck-script [data-deck-seek="slide-4"]');
	const segment = (index: number) => seeks.nth(index).locator("xpath=..");
	const last = (await seeks.count()) - 1;
	expect(last).toBeGreaterThan(0);
	// Screen readers can activate a control without moving focus to it.
	await seeks.nth(last).dispatchEvent("click");
	await expect(segment(last)).toHaveAttribute("aria-current", "true");
	await expect(seeks.nth(last)).not.toBeFocused();
	await seeks.first().focus();
	await page.keyboard.press("Enter");
	await expect(segment(0)).toHaveAttribute("aria-current", "true");
	await expect(segment(last)).not.toHaveAttribute("aria-current", "true");
});

test("mobile More closes on an outside pointer, Escape or focus leaving", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 720 });
	await page.goto(base + linksEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const toggle = page.locator("#deck-more-toggle");
	const outline = page.locator("#deck-outline-toggle");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	// A pointer on the toggle itself closes once, without close-then-reopen.
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await toggle.click();
	await page.locator('[data-deck-slide="slide-1"] h1').click();
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await expect(outline).toBeHidden();
	await toggle.focus();
	await page.keyboard.press("Enter");
	await expect(outline).toBeVisible();
	await outline.focus();
	await page.keyboard.press("Escape");
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await expect(toggle).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	const next = page.locator("#deck-next");
	await next.focus();
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await expect(next).toBeFocused();
});

test("one-slide Finish stays enabled and keyboard access reaches active content", async ({
	page,
}) => {
	await page.goto(base + singleSlideEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator("#deck-previous")).toBeDisabled();
	await expect(page.locator("#deck-next")).toBeEnabled();
	await expect(page.locator("#deck-next")).toHaveAccessibleName("Finish module");
	const main = page.locator("#main-content");
	await main.focus();
	await page.keyboard.press("ArrowRight");
	await expect(page.locator("#deck-completion h1")).toBeFocused();
	await expect(page.locator("#deck-completion")).toBeVisible();
	await expect(main).not.toHaveAttribute("inert", "");
});

test("outline jumps to boundaries focus the destination content", async ({ page }) => {
	await page.goto(base + twoSlideEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-next").click();
	await clickDeckTool(page, "#deck-outline-toggle");
	for (const id of ["slide-1", "slide-2"]) {
		const link = page.locator(`[data-deck-page="${id}"]`);
		await link.focus();
		await page.keyboard.press("Enter");
		await expect(
			id === "slide-1"
				? page.locator('[data-deck-slide="slide-1"] h1')
				: page.locator("#main-content"),
		).toBeFocused();
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute("aria-current", "page");
	}
});

test("outline detail keeps module slides local and optionally shows gated module links", async ({
	page,
}) => {
	for (const [url, includeModules] of [
		[entry, true],
		[localOutlineEntry, false],
	] as const) {
		await page.goto(base + url);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await clickDeckTool(page, "#deck-outline-toggle");
		const outline = page.locator("#deck-outline");
		await expect(outline.locator("[data-deck-page]")).toHaveCount(includeModules ? 5 : 4);
		await expect(outline.locator('[data-deck-page="slide-1"]')).toHaveAttribute(
			"aria-current",
			"page",
		);
		const otherModule = outline.locator('[data-deck-page="module-two"]');
		if (includeModules) {
			await expect(otherModule).toContainText("Module two");
			await expect(otherModule).toHaveAttribute("aria-disabled", "true");
			await otherModule.focus();
			await page.keyboard.press("Enter");
			await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
		} else await expect(otherModule).toHaveCount(0);
	}
});

for (const [variant, locale] of [
	["reading", "en"],
	["reading", "fr"],
	["group", "en"],
] as const) {
	test(`required activity guidance follows the ${variant} question in ${locale} without stealing focus`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 1800, height: 1000 });
		await page.goto(
			base + (variant === "group" ? groupedEntry : locale === "fr" ? frenchEntry : entry),
		);
		const next = page.locator("#deck-next");
		await next.click();
		const gateId = variant === "group" ? "experience-survey" : "practice-gate";
		const target = page
			.locator(`[data-deck-slide]:not([hidden]) [data-block-id="${gateId}"]`)
			.first();
		await expect(target).toBeVisible();
		await expect(target).toHaveAttribute("data-hydrated", "");
		await page.locator("#main-content").evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		await next.focus();
		await page.keyboard.press("Enter");
		const notice = page.locator(".deck-gate-notice");
		await expect(notice).toBeVisible();
		await expect(notice).toContainText(
			locale === "fr" ? "Aller à l’activité requise" : "Go to required activity",
		);
		await expect(next).toBeFocused();
		await expect(page.locator("#deck-status")).toHaveText(
			locale === "fr"
				? "Terminez l’activité requise pour continuer."
				: "Complete the required activity to continue.",
		);
		await expect(page.locator("#deck-status")).toBeVisible();
		const heading = target
			.locator(".praxity-assessment-stem, .praxity-assessment-group-title")
			.first();
		const content = heading.locator(".praxity-assessment-stem-content");
		const titleNode = (await content.count()) ? content : heading;
		const title = (await titleNode.textContent())?.trim() ?? "";
		await expect(notice).toHaveText(
			`${locale === "fr" ? "Aller à l’activité requise" : "Go to required activity"}: ${title}`,
		);
		const nextBox = await next.boundingBox();
		const noticeBox = await notice.boundingBox();
		if (!nextBox || !noticeBox) throw new Error("Missing gate layout");
		expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(nextBox.y);
		expect(noticeBox.height).toBeGreaterThanOrEqual(44);
		expect((await page.locator("#deck-controls").boundingBox())?.height).toBeLessThanOrEqual(64);
		await page.screenshot({ path: testInfo.outputPath("gate-footer.png") });
		await notice.click();
		await expect(heading).toBeFocused();
		await page.setViewportSize({ width: 320, height: 640 });
		await next.click();
		const narrowNotice = await notice.boundingBox();
		const controls = await page.locator("#deck-controls").boundingBox();
		const more = await page.locator("#deck-more-toggle").boundingBox();
		const previous = await page.locator("#deck-previous").boundingBox();
		const narrowNext = await next.boundingBox();
		if (!narrowNotice || !controls || !more || !previous || !narrowNext)
			throw new Error("Missing narrow gate layout");
		expect(Math.abs(more.y - previous.y)).toBeLessThan(8);
		expect(Math.abs(narrowNext.y - previous.y)).toBeLessThan(8);
		expect(narrowNotice.y + narrowNotice.height).toBeLessThanOrEqual(narrowNext.y);
		expect(narrowNotice.x).toBeGreaterThanOrEqual(0);
		expect(narrowNotice.x + narrowNotice.width).toBeLessThanOrEqual(320);
		expect(controls.height).toBeLessThan(260);
		expect(controls.y + controls.height).toBeLessThanOrEqual(640);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await page.screenshot({ path: testInfo.outputPath("gate-footer-mobile.png") });
		await page.locator("#deck-previous").click();
		await expect(notice).toBeHidden();
	});
}

test("direct entry and history explain denied destinations, then open a completed slide", async ({
	page,
}) => {
	await page.goto(`${base}${entry}#slide-4`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
	await expect(page).toHaveURL(/#slide-1$/);
	await expect(page.locator("#deck-status")).toHaveText(
		"Continue through the earlier slides to reach this one.",
	);
	await expect(page.locator("#deck-status")).toBeVisible();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
	await page.goto(`${base}${entry}#slide-4`);
	await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
	await expect(page).toHaveURL(/#slide-2$/);
	await expect(page.locator(".deck-gate-notice")).toContainText("Go to required activity");
	await expect(page.locator(".deck-gate-notice")).toBeVisible();
	await page.evaluate(() => {
		location.hash = "slide-4";
	});
	await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
	await expect(page).toHaveURL(/#slide-2$/);
	await page.getByRole("radio", { name: "Make an assumption" }).check();
	await page.getByRole("button", { name: /submit|check/i }).click();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	await page.getByRole("radio", { name: "Offer options" }).check();
	await page.getByRole("button", { name: /submit|check/i }).click();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
	await page.goto(`${base}${entry}#slide-4`);
	await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
	await expect(page).toHaveURL(/#slide-4$/);
	await expect(page.locator("#deck-status")).toBeEmpty();
});

test("cross-module deep link explains its redirect without leaving a query marker", async ({
	page,
}) => {
	await page.goto(`${base}${secondModuleEntry}#module-two`);
	await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
	await expect(page.locator("#deck-status")).toHaveText(
		"Continue through the earlier slides to reach this one.",
	);
	await expect(page.locator("#deck-status")).toBeVisible();
	await expect(page).toHaveURL(/#slide-1$/);
	expect(new URL(page.url()).searchParams.has("praxity-deck-redirect")).toBe(false);
});

test("reflow, keyboard and full reading remain accessible", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 320, height: 640 });
	await page.goto(base + entry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-next").focus();
	await page.keyboard.press("Enter");
	await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
	await expect(page.locator("#main-content")).toBeFocused();
	await page.evaluate(() => window.scrollTo(0, 0));
	const controls = await page.locator("#deck-controls").boundingBox();
	if (!controls) throw new Error("Transport must have a visible layout box");
	expect(controls.y).toBeGreaterThanOrEqual(0);
	expect(controls.y + controls.height).toBeLessThanOrEqual(640);
	expect(controls.height).toBeLessThan(260);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	const results = await analyzeAxe(
		page,
		new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]),
	);
	expect(results.violations).toEqual([]);
	await page.screenshot({ path: testInfo.outputPath("narrow-deck.png"), fullPage: true });
});

test("one audio node continues across sources and pauses at an interaction", async ({ page }) => {
	await page.goto(base + shortAudioEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	// Start with keyboard focus so natural advancement can verify its retention.
	await page.locator(".praxity-narration-transport button").press("Enter");
	const originalAudio = await page.locator("[data-narration-player]").elementHandle();
	const originalSource = await originalAudio?.getAttribute("src");
	await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible({ timeout: 25_000 });
	await expect(page.locator(".praxity-narration-transport button")).toBeFocused();
	await expect(page.locator("#deck-status")).toContainText("Paused", { timeout: 15_000 });
	await expect(page.locator("[data-narration-player]")).toHaveJSProperty("paused", true);
	await expect(page.locator("[data-narration-player]")).toHaveCount(1);
	expect(
		await originalAudio?.evaluate(
			(el) => el.isConnected && el === document.querySelector("[data-narration-player]"),
		),
	).toBe(true);
	expect(await originalAudio?.getAttribute("src")).not.toBe(originalSource);
});

for (const locale of ["en", "fr"]) {
	test(`module boundaries use localized toolbar controls and keyboard in ${locale}`, async ({
		page,
	}) => {
		await page.goto(`${base}${locale === "fr" ? frenchEntry : entry}?praxity-inspect=1#slide-4`);
		const next = page.locator("#deck-next");
		const previous = page.locator("#deck-previous");
		const nextModule = locale === "fr" ? "Module suivant : Module two" : "Next module: Module two";
		const previousModule = locale === "fr" ? "Module précédent" : "Previous module";
		await expect(next).toHaveAccessibleName(
			locale === "fr" ? "Terminer le module" : "Finish module",
		);
		await expect(next).toHaveAttribute(
			"title",
			locale === "fr" ? "Terminer le module" : "Finish module",
		);
		await expect(page.locator(".deck-module-links")).toBeHidden();
		await next.focus();
		await page.keyboard.press("Enter");
		await expect(page.locator("#deck-completion")).toBeVisible();
		await expect(next).toHaveAccessibleName(nextModule);
		await expect(next).toHaveAttribute("title", nextModule);
		await next.click();
		await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
		await expect(next).toBeEnabled();
		await expect(next).toHaveAccessibleName(
			locale === "fr" ? "Terminer le module" : "Finish module",
		);
		await expect(previous).toHaveAccessibleName(previousModule);
		await expect(previous).toHaveAttribute("title", `${previousModule}: Reading`);
		await previous.focus();
		await page.keyboard.press("Enter");
		await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
		await expect(next).toHaveAccessibleName(
			locale === "fr" ? "Terminer le module" : "Finish module",
		);
		await page.locator("#main-content").focus();
		await page.keyboard.press("ArrowRight");
		await expect(page.locator("#deck-completion")).toBeVisible();
		await page.keyboard.press("ArrowRight");
		await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
		await expect(previous).toHaveAccessibleName(previousModule);
		await page.locator("#main-content").focus();
		await page.keyboard.press("ArrowLeft");
		await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
		await page.goto(`${base}${locale === "fr" ? frenchEntry : entry}`);
		await expect(previous).toBeDisabled();
	});
}

test("entering an unnarrated module removes footer playback while retaining reading controls", async ({
	page,
}) => {
	await page.goto(`${base}${audioEntry}?praxity-inspect=1`);
	await expect(page.locator("#deck-narration .praxity-narration-transport button")).toBeVisible();
	await page.goto(`${base}${audioEntry}?praxity-inspect=1#slide-4`);
	await page.getByRole("button", { name: "Finish module", exact: true }).click();
	await expect(page.locator("#deck-completion")).toBeVisible();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator(".deck-opening-narration")).toHaveCount(0);
	await expect(page.locator("[data-narration-player]")).toHaveCount(0);
	await revealDeckTool(page, page.locator("#deck-script-toggle"));
	await clickDeckTool(page, "#deck-script-toggle");
	await expect(page.locator("#deck-script-scroll")).toContainText(
		"The second module starts paused.",
	);
	await page.getByRole("button", { name: "Previous module", exact: true }).click();
	await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
	await expect(page.locator(".deck-opening-narration")).toHaveCount(0);
	await expect(page.locator("#deck-narration .praxity-narration-transport button")).toBeVisible();
});

test("narration stops at the module boundary until manual continuation", async ({ page }) => {
	await page.goto(`${base}/stable${audioEntry}?praxity-inspect=1#slide-4`);
	await expect(page.locator("#deck-next")).toHaveAccessibleName("Finish module");
	await clickDeckTool(page, "#deck-script-toggle");
	await page.locator('[data-deck-seek="slide-4"]').last().focus();
	await page.keyboard.press("Enter");
	await page.locator("#deck-sidebar-close").click();
	await page.locator(".praxity-narration-transport button").click();
	const audio = page.locator("[data-narration-player]");
	await expect(audio).toHaveJSProperty("paused", false);
	await audio.dispatchEvent("ended");
	await expect(audio).toHaveJSProperty("paused", true);
	await expect(page.locator("#deck-status")).toContainText("Paused");
	await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
	await page.getByRole("button", { name: "Finish module", exact: true }).click();
	await expect(page.locator("#deck-completion")).toBeVisible();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
	await expect(page.locator("[data-narration-player]")).toHaveCount(0);
});

test("no JavaScript leaves every slide and script readable", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(base + entry);
		await expect(page.locator("[data-deck-slide]:visible")).toHaveCount(4);
		await expect(page.locator("#deck-script")).toContainText("complete reading script");
		await page
			.getByRole("link", { name: "Next module", exact: true })
			.and(page.locator("[data-deck-module]"))
			.click();
		await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
	} finally {
		await context.close();
	}
});

test("slow deck import retains pending presentation until access is resolved", async ({ page }) => {
	let release!: () => void;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(/island-deck[^/]*\.js$/, async (route) => {
		await blocked;
		await route.continue();
	});
	try {
		await page.goto(`${base}${entry}#slide-4`, { waitUntil: "domcontentloaded" });
		await expect(page.locator("html")).toHaveClass(/praxity-shell-ready/);
		await expect(page.locator(".praxity-deck")).not.toHaveAttribute("data-ready", "true");
		await expect(page.locator("[data-deck-slide]:visible")).toHaveCount(0);
		await expect(page.locator(".deck-panels:visible")).toHaveCount(0);
		await page.emulateMedia({ media: "print" });
		await expect(page.locator("[data-deck-slide]:visible")).toHaveCount(4);
		await page.emulateMedia({ media: "screen" });
		await expect(page.locator("[data-deck-slide]:visible")).toHaveCount(0);
		release();
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
		await expect(page.locator("[data-deck-slide]:visible")).toHaveCount(1);
	} finally {
		release();
	}
});

for (const script of [
	/island-deck[^/]*\.js$/,
	/island-loader[^/]*\.js$/,
	/host-standalone[^/]*\.js$/,
]) {
	test(`failed ${script.source} restores readable deck fallback`, async ({ page }) => {
		await page.route(script, (route) => route.abort());
		await page.goto(base + entry);
		await expect(page.locator("[data-deck-slide]:visible")).toHaveCount(4);
		await expect(page.locator("#deck-script")).toBeVisible();
		await expect(page.locator(".deck-module-links")).toBeVisible();
	});
}

test("a missing shell never conceals deck content", async ({ page }) => {
	await page.route(/course-shell[^/]*\.js$/, (route) => route.abort());
	await page.goto(base + entry);
	await expect(page.locator("html")).not.toHaveClass(/praxity-shell-ready/);
	await expect(page.locator("[data-deck-slide]:visible").first()).toBeVisible();
});

test("a wrong answer with a retry left stays locked after reload", async ({ page }) => {
	await page.goto(base + entry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-next").click();
	await page.getByRole("radio", { name: "Make an assumption" }).check();
	await page.getByRole("button", { name: /^check$|submit/i }).click();
	await page.locator("#deck-next").click();
	await page.getByRole("radio", { name: "Decide for someone" }).check();
	await page.getByRole("button", { name: /^check$|submit/i }).click();
	await expect(page.getByRole("button", { name: /try again|retry/i })).toBeVisible();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	await page.reload();
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
});

test("a graded final wrong answer unlocks Next and survives reload", async ({ page }) => {
	await page.goto(base + gradedEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-next").click();
	await page.getByRole("radio", { name: "Make an assumption" }).check();
	await page.getByRole("button", { name: /^check$|submit/i }).click();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	await expect(page.locator('[data-deck-page="slide-4"]')).toHaveAttribute("aria-disabled", "true");
	await page.getByRole("radio", { name: "Decide for someone" }).check();
	await page.getByRole("button", { name: /^check$|submit/i }).click();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	await page.getByRole("button", { name: /try again|retry/i }).click();
	await page.getByRole("radio", { name: "Decide for someone" }).check();
	await page.getByRole("button", { name: /^check$|submit/i }).click();
	await expect(page.getByRole("button", { name: /try again|retry/i })).toHaveCount(0);
	await expect(page.locator('[data-deck-page="slide-4"]')).toHaveAttribute(
		"aria-disabled",
		"false",
	);
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
	await page.reload();
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
});

test("paused navigation, missing media and slide visits remain independent", async ({ page }) => {
	await page.goto(base + entry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	expect(await page.evaluate(() => window.__praxityRuntime?.getVisitedPages?.())).toEqual([
		"slide-1",
	]);
	await expect(page.locator("#deck-narration")).toBeEmpty();
	await expect(page.locator("#deck-status")).not.toContainText("not available");
	await page.locator("#deck-next").click();
	await expect(page.locator("[data-narration-player]")).toHaveCount(0);
	expect(await page.evaluate(() => window.__praxityRuntime?.getVisitedPages?.())).toEqual([
		"slide-1",
		"slide-2",
	]);
});

test("skip links stay in the document without changing the active slide", async ({ page }) => {
	await page.goto(base + entry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-next").click();
	const skip = page.getByRole("link", { name: "Skip to course controls", exact: true });
	await skip.focus();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/#deck-controls$/);
	await expect(page.locator("#deck-controls")).toBeFocused();
	await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
	await expect(page.locator("#deck-status")).not.toContainText("required activity");
});

test("French controls work at a narrow width", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 640 });
	await page.goto(base + frenchEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator("html")).toHaveAttribute("lang", "fr");
	await expect(page.locator("#deck-narration")).toBeEmpty();
	await page.getByRole("button", { name: "Diapositive suivante", exact: true }).click();
	await expect(page.locator("#deck-position")).toHaveText("2 / 4");
	await clickDeckTool(page, "#deck-script-toggle");
	await expect(page.locator("#deck-script .deck-panel-title")).toHaveText("Transcription");
	await expect(page.locator("#deck-script")).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("heading-free opening slide keeps narration in the footer", async ({ page }) => {
	await page.goto(`${base}/stable${headingFreeEntry}`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const slide = page.locator('[data-deck-slide="slide-1"]');
	await expect(slide.locator("h1,h2,h3,h4,h5,h6")).toHaveCount(0);
	await expect(slide.locator(".deck-opening-narration")).toHaveCount(0);
	const button = page.locator("#deck-narration .praxity-narration-transport button");
	await expect(button).toBeVisible();
	await button.focus();
	await page.keyboard.press("Enter");
	await expect(button).toHaveAccessibleName("Pause");
	await expect(button).toBeFocused();
});

for (const width of [1280, 768, 390]) {
	test(`footer narration stays after content and supports playback at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${base}/stable${audioEntry}`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator(".deck-opening-narration")).toHaveCount(0);
		const transport = page.locator("#deck-narration .praxity-narration-transport button");
		await expect(transport).toBeVisible();
		await expect(transport).toHaveAttribute("type", "button");
		const geometry = await transport.evaluate((button) => {
			const slide = document.querySelector('[data-deck-slide="slide-1"]');
			const paragraph = slide?.querySelector("p");
			if (!paragraph) throw new Error("Missing opening content");
			const rect = button.getBoundingClientRect();
			return {
				height: rect.height,
				width: rect.width,
				left: rect.left,
				right: rect.right,
				contentBefore: Boolean(
					paragraph.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
				),
				overflow: document.documentElement.scrollWidth > innerWidth,
			};
		});
		expect(geometry.height).toBeGreaterThanOrEqual(44);
		expect(geometry.width).toBeGreaterThanOrEqual(44);
		expect(geometry.width).toBeLessThan(width - 32);
		expect(geometry.left).toBeGreaterThanOrEqual(0);
		expect(geometry.right).toBeLessThanOrEqual(width);
		expect(geometry.contentBefore).toBe(true);
		expect(geometry.overflow).toBe(false);
		await page.screenshot({ path: testInfo.outputPath(`footer-narration-${width}.png`) });
		await transport.focus();
		await page.keyboard.press("Enter");
		await expect(transport).toHaveAccessibleName("Pause");
		await expect(transport).toBeFocused();
		await page.keyboard.press("Space");
		await expect(transport).toHaveAccessibleName("Play");
		await expect(transport).toBeFocused();
		await transport.click();
		await expect(transport).toHaveAccessibleName("Pause");
		await transport.click();
		await expect(transport).toHaveAccessibleName("Play");
		await page.locator("#deck-next").click();
		await expect(page.locator(".deck-opening-narration")).toHaveCount(0);
		await page.goto(base + entry);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator(".praxity-narration-transport button")).toHaveCount(0);
	});
}

test("shared playback toggle and keyboard seeking preserve paused intent", async ({ page }) => {
	await page.goto(`${base}/stable${audioEntry}`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const play = page.locator(".praxity-narration-transport button");
	await expect(play).toHaveAttribute("aria-label", "Play");
	await play.click();
	await expect(play).toHaveAttribute("aria-label", "Pause");
	await play.click();
	await expect(play).toHaveAttribute("aria-label", "Play");
	await expect(page.locator("[data-narration-player]")).toHaveJSProperty("paused", true);
	const progress = page.getByRole("slider", { name: "Position in narration" });
	await expect(progress).toBeEnabled();
	await progress.focus();
	await page.keyboard.press("Home");
	await page.keyboard.press("ArrowRight");
	expect(await progress.inputValue()).not.toBe("0");
	await page.keyboard.press("Home");
	await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
	await expect(play).toHaveAttribute("aria-label", "Play");
	await expect(page.getByRole("button", { name: "Previous sentence" })).toHaveCount(0);
	await clickDeckTool(page, "#deck-script-toggle");
	const seek = page.locator("[data-deck-seek]").first();
	const passage = page.locator("#deck-script [data-deck-segment]").first();
	// Keyboard browsing reveals Resume following before the seek control itself.
	await page.locator("#deck-script-scroll").focus();
	await expect(page.locator("#deck-resume-follow")).toBeVisible();
	const passageBox = await passage.boundingBox();
	await passage.hover();
	await expect(seek).toHaveCSS("clip-path", "inset(50%)");
	await seek.focus();
	await expect(seek).toHaveCSS("clip-path", "none");
	expect(await passage.boundingBox()).toEqual(passageBox);
	await page.keyboard.press("Enter");
	await expect(page.locator("[data-narration-player]")).toHaveJSProperty("currentTime", 0);
	await expect(page.locator("[data-narration-player]")).toHaveJSProperty("paused", true);
	expect(Number(await progress.inputValue())).toBeGreaterThan(0);
});

test("outline open at start leaves a usable slide at 960px and becomes a drawer below the rail threshold", async ({
	page,
}) => {
	await page.setViewportSize({ width: 960, height: 700 });
	await page.goto(base + openOutlineEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const outline = page.locator("#deck-outline-sidebar");
	const main = page.locator("#main-content");
	await expect(outline).toBeVisible();
	await expect(main).toBeVisible();
	await expect(main).toHaveJSProperty("inert", false);
	const outlineBox = await outline.boundingBox();
	const mainBox = await main.boundingBox();
	const slideBox = await page.locator(".deck-slide:visible > .praxity-slide").boundingBox();
	if (!outlineBox || !mainBox || !slideBox) throw new Error("Outline and slide need layout boxes");
	expect(outlineBox.x + outlineBox.width).toBeLessThanOrEqual(mainBox.x + 1);
	expect(mainBox.width).toBeGreaterThanOrEqual(576);
	expect(slideBox.width).toBeGreaterThanOrEqual(500);
	await page.locator("#deck-more-toggle").click();
	await page.getByRole("button", { name: "Larger text" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-praxity-text-size", "large");
	const enlargedMainBox = await main.boundingBox();
	const enlargedSlideBox = await page.locator(".deck-slide:visible > .praxity-slide").boundingBox();
	if (!enlargedMainBox || !enlargedSlideBox)
		throw new Error("Larger-text slide needs layout boxes");
	expect(enlargedMainBox.width).toBeGreaterThanOrEqual(576);
	expect(enlargedSlideBox.width).toBeGreaterThanOrEqual(500);
	await clickDeckTool(page, "#deck-script-toggle");
	await expect(outline).toBeHidden();
	const transcript = page.locator("#deck-sidebar");
	await expect(transcript).toBeVisible();
	await expect(main).toBeVisible();
	const transcriptBox = await transcript.boundingBox();
	const mainWithTranscript = await main.boundingBox();
	if (!transcriptBox || !mainWithTranscript)
		throw new Error("Transcript and slide need layout boxes");
	expect(transcriptBox.x).toBeGreaterThanOrEqual(
		mainWithTranscript.x + mainWithTranscript.width - 1,
	);
	expect(mainWithTranscript.width).toBeGreaterThanOrEqual(576);
	await clickDeckTool(page, "#deck-outline-toggle");
	await expect(transcript).toBeHidden();
	await page.setViewportSize({ width: 375, height: 700 });
	await expect(outline).toHaveAttribute("role", "dialog");
	await expect(main).toBeHidden();
	await expect(main).toHaveJSProperty("inert", true);
	// 320 CSS px is the reflow width of a 1280px viewport at 400% browser zoom.
	await page.setViewportSize({ width: 320, height: 700 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.locator("#deck-outline-close").click();
	await expect(main).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("left outline and right transcript share shell styling and preserve native content sizing", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 800 });
	await page.goto(base + audioEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const main = page.locator("#main-content");
	const sidebar = page.locator("#deck-sidebar");
	const outlineSidebar = page.locator("#deck-outline-sidebar");
	const outlineToggle = page.locator("#deck-outline-toggle");
	const scriptToggle = page.locator("#deck-script-toggle");
	await expect(sidebar).toBeHidden();
	await expect(outlineSidebar).toBeHidden();
	await expect(outlineToggle).toHaveAttribute("aria-controls", "deck-outline-sidebar");
	await expect(scriptToggle).toHaveAttribute("aria-controls", "deck-sidebar");
	await expect(scriptToggle).toHaveAttribute("aria-expanded", "false");
	await expect(page.locator("#deck-outline-toggle")).toHaveAttribute("aria-expanded", "false");
	expect(
		await main.evaluate((element) => {
			const sidebar = document.getElementById("deck-sidebar");
			const outline = document.getElementById("deck-outline-sidebar");
			const shell = document.querySelector(".praxity-deck");
			return (
				element.parentElement === sidebar?.parentElement &&
				element.parentElement === outline?.parentElement &&
				!element.contains(outline) &&
				shell?.contains(element) &&
				!element.contains(shell) &&
				!element.contains(sidebar)
			);
		}),
	).toBe(true);
	const closed = await main.boundingBox();
	const shell = await page.locator(".praxity-deck").boundingBox();
	if (!closed || !shell) throw new Error("Native content and shell must have layout boxes");
	// A closed sidebar leaves no empty track beside the centered learner content.
	expect(closed.x + closed.width / 2).toBeCloseTo(shell.x + shell.width / 2, 0);

	const measure = () =>
		main.evaluate((element) => {
			const style = getComputedStyle(element);
			return Math.round(
				element.clientWidth -
					parseFloat(style.paddingInlineStart) -
					parseFloat(style.paddingInlineEnd),
			);
		});
	const baselineMeasure = await measure();
	for (const width of [840, 560]) {
		await page.evaluate((value) => {
			document.documentElement.style.setProperty("--praxity-max-width", `${value}px`);
			document.documentElement.style.setProperty("--praxity-space-boundary", "56px");
		}, width);
		await expect.poll(measure).toBe(baselineMeasure);
		expect(
			await main.evaluate((element) => {
				const style = getComputedStyle(element);
				return [
					style.paddingTop,
					style.paddingBottom,
					style.paddingInlineStart === style.paddingInlineEnd,
				];
			}),
		).toEqual([
			"0px",
			await page.locator("#deck-controls").evaluate((element) => getComputedStyle(element).height),
			true,
		]);
		await expect(page.locator(".deck-slide:visible")).toHaveCSS("padding-top", "48px");
		await expect(page.locator(".deck-slide:visible")).toHaveCSS("padding-bottom", "0px");
	}

	await page.evaluate(() => {
		document.documentElement.style.removeProperty("--praxity-max-width");
		document.documentElement.style.removeProperty("--praxity-space-boundary");
	});
	await clickDeckTool(page, "#deck-script-toggle");
	await expect(sidebar).toBeVisible();
	await expect(scriptToggle).toHaveAttribute("aria-expanded", "true");
	await expect(page.locator("#deck-script")).toBeVisible();
	await expect
		.poll(() =>
			main.evaluate(
				(element) =>
					element.getBoundingClientRect().width +
					(document.getElementById("deck-sidebar")?.getBoundingClientRect().width ?? 0),
			),
		)
		.toBe(closed.width);
	const rightBox = await sidebar.boundingBox();
	const mainWithRight = await main.boundingBox();
	if (!rightBox || !mainWithRight)
		throw new Error("Open transcript and native content need layout boxes");
	expect(rightBox.x).toBeGreaterThanOrEqual(mainWithRight.x + mainWithRight.width - 1);
	const headerStyle = (element: Element) => {
		const style = getComputedStyle(element);
		return {
			background: style.backgroundColor,
			color: style.color,
			fontSize: style.fontSize,
			fontWeight: style.fontWeight,
			padding: style.padding,
			borderBottom: style.borderBottom,
		};
	};
	const rightHeader = await sidebar.locator(".deck-panel-heading").evaluate(headerStyle);
	const rightSummary = await sidebar.locator(".deck-panel-title").evaluate(headerStyle);
	expect(rightSummary.padding, "script heading retains its padding").toBe("4px 8px");
	await page.screenshot({ path: testInfo.outputPath("desktop-script.png"), fullPage: true });
	await page.locator("#deck-sidebar-close").click();
	await expect(sidebar).toBeHidden();
	await expect(scriptToggle).toBeFocused();
	await expect
		.poll(() => main.evaluate((element) => element.getBoundingClientRect().x))
		.toBe(closed.x);
	await clickDeckTool(page, "#deck-outline-toggle");
	await expect(outlineSidebar).toBeVisible();
	await expect(sidebar).toBeHidden();
	await expect(outlineToggle).toHaveAttribute("aria-expanded", "true");
	const leftBox = await outlineSidebar.boundingBox();
	const mainWithLeft = await main.boundingBox();
	if (!leftBox || !mainWithLeft)
		throw new Error("Open outline and native content need layout boxes");
	expect(leftBox.x + leftBox.width).toBeLessThanOrEqual(mainWithLeft.x + 1);
	expect(leftBox.width).toBeCloseTo(rightBox.width, 0);
	expect(mainWithLeft.width).toBeCloseTo(mainWithRight.width, 0);
	expect(await outlineSidebar.locator(".deck-panel-heading").evaluate(headerStyle)).toEqual(
		rightHeader,
	);
	expect(await outlineSidebar.locator(".deck-panel-title").evaluate(headerStyle)).toEqual({
		...rightSummary,
		padding: "4px 0px",
	});
	await page.screenshot({ path: testInfo.outputPath("desktop-outline.png"), fullPage: true });
	await page.locator("#deck-outline-close").click();
	await expect(outlineSidebar).toBeHidden();
	await expect(outlineToggle).toHaveAttribute("aria-expanded", "false");
	await expect(outlineToggle).toBeFocused();
	await expect
		.poll(() => main.evaluate((element) => element.getBoundingClientRect().x))
		.toBe(closed.x);
});

test("inspection opens the selected locked slide without learner writes", async ({ page }) => {
	await page.goto(`${base}${entry}?praxity-inspect=1#slide-4`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
	expect(await page.evaluate(() => window.__praxityRuntime?.getVisitedPages?.())).toEqual([]);
	await page.locator("#deck-previous").click();
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	expect(await page.evaluate(() => window.__praxityRuntime?.getVisitedPages?.())).toEqual([]);
});

test("authored cross-module fragment links retain the selected slide and inspection mode", async ({
	page,
}) => {
	await page.goto(`${base}${entry}?praxity-inspect=1#slide-4`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator(".deck-module-links")).toBeHidden();
	await page.getByRole("button", { name: "Finish module", exact: true }).click();
	await expect(page.locator("#deck-completion")).toBeVisible();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
	await page.getByRole("link", { name: "Review certification", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/introduction\.html\?praxity-inspect=1#slide-3$/);
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	expect(await page.evaluate(() => window.__praxityRuntime?.getVisitedPages?.())).toEqual([]);
});

test("small preview projects only its requested slide", async ({ page }) => {
	await page.goto(`${base}${entry}?praxity-small-preview=1#slide-3`);
	await expect(page.locator("[data-deck-slide]:visible")).toHaveCount(1);
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	await expect(page.locator("#deck-script")).toBeHidden();
	await expect(page.locator("#deck-controls")).toBeHidden();
});

test("transcript follows the current slide and resets only when the slide changes", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 800 });
	await page.goto(`${base}${entry}?praxity-inspect=1#slide-4`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await clickDeckTool(page, "#deck-script-toggle");
	const pane = page.locator("#deck-script-scroll");
	const current = pane.locator('[data-deck-reading="slide-4"]');
	await expect(pane.locator("[data-deck-reading]:visible")).toHaveCount(1);
	await expect(current).toBeVisible();
	await expect(pane.locator('[data-deck-reading="slide-1"]')).toHaveAttribute("inert", "");
	expect(await pane.ariaSnapshot()).not.toContain("complete reading script");
	await pane.hover();
	await page.mouse.wheel(0, 500);
	await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await page.locator("#deck-previous").click();
	await expect(pane.locator('[data-deck-reading="slide-3"]')).toBeVisible();
	await expect(current).toBeHidden();
	await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBe(0);
	await page.goBack();
	await expect(current).toBeVisible();
	await expect(pane.locator("[data-deck-reading]:visible")).toHaveCount(1);
	await page.reload();
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator("#deck-script-toggle")).toHaveAttribute("aria-expanded", "true");
	await expect(current).toBeVisible();
	await expect(pane.locator("[data-deck-reading]:visible")).toHaveCount(1);
});

test("transcript scroll is independent and panels are mutually exclusive", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 800 });
	await page.goto(`${base}${entry}?praxity-inspect=1#slide-4`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await clickDeckTool(page, "#deck-script-toggle");
	await expect(page.locator("#deck-sidebar")).toBeVisible();
	const pane = page.locator("#deck-script-scroll");
	const before = await page.evaluate(() => ({
		outer: scrollY,
		slide: document.querySelector("#main-content")?.scrollTop,
	}));
	await pane.hover();
	await page.mouse.wheel(0, 500);
	await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	expect(
		await page.evaluate(() => ({
			outer: scrollY,
			slide: document.querySelector("#main-content")?.scrollTop,
		})),
	).toEqual(before);
	await clickDeckTool(page, "#deck-outline-toggle");
	await expect(page.locator("#deck-outline-toggle")).toHaveAttribute("aria-expanded", "true");
	await expect(page.locator("#deck-script-toggle")).toHaveAttribute("aria-expanded", "false");
	await expect(page.locator("#deck-script")).toBeHidden();
	await expect(page.locator("#deck-sidebar")).toBeHidden();
	await expect(page.locator("#deck-outline-sidebar")).toBeVisible();
	await clickDeckTool(page, "#deck-script-toggle");
	await expect(page.locator("#deck-outline-toggle")).toHaveAttribute("aria-expanded", "false");
	await expect(page.locator("#deck-outline")).toBeHidden();
	await expect(page.locator("#deck-outline-sidebar")).toBeHidden();
	await expect(page.locator("#deck-sidebar")).toBeVisible();
	await expect(page.locator("#deck-script")).toBeVisible();
	await expect(page.locator("#deck-script")).not.toContainText(/\b\d+:\d{2}\b/);
	await page.screenshot({ path: testInfo.outputPath("transcript-sidebar.png"), fullPage: true });
});

test("authored audio and shared narration pause each other", async ({ page }) => {
	await page.goto(`${base}/stable${audioEntry}?praxity-inspect=1#slide-4`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const narration = page.locator("[data-narration-player]");
	const embedded = page.locator("#deck-slides audio[controls]");
	await expect
		.poll(() => narration.evaluate((audio: HTMLAudioElement) => audio.duration))
		.toBeGreaterThan(45);
	await expect
		.poll(() => embedded.evaluate((audio: HTMLAudioElement) => audio.duration))
		.toBeGreaterThan(45);
	await page.locator(".praxity-narration-transport button").click();
	await expect(narration).toHaveJSProperty("paused", false);
	await expect
		.poll(() => narration.evaluate((audio: HTMLAudioElement) => audio.currentTime))
		.toBeGreaterThan(0.1);
	await embedded.evaluate((audio: HTMLAudioElement) => audio.play());
	await expect(narration).toHaveJSProperty("paused", true);
	await expect(embedded).toHaveJSProperty("paused", false);
	await expect
		.poll(() => embedded.evaluate((audio: HTMLAudioElement) => audio.currentTime))
		.toBeGreaterThan(0.1);
	await page.locator(".praxity-narration-transport button").click();
	await expect(embedded).toHaveJSProperty("paused", true);
	await expect(narration).toHaveJSProperty("paused", false);
});

test("failed narration exposes retry feedback while reading stays available", async ({
	page,
	request,
}) => {
	await page.goto(`${base}/unavailable${audioEntry}`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const mediaUrl = await page
		.locator("[data-narration-player]")
		.evaluate((audio: HTMLAudioElement) => audio.src);
	// WebKit media fetches also bypass page response events. Check the actual
	// server endpoint, then retain the learner's playback and reading assertions.
	const failedMedia = await request.get(mediaUrl);
	expect(failedMedia.status()).toBe(503);
	await page.locator(".praxity-narration-transport button").click();
	await expect(page.locator("#deck-status")).toContainText("Playback stopped");
	await clickDeckTool(page, "#deck-script-toggle");
	await expect(page.locator("#deck-script")).toBeVisible();
	await expect(page.locator("#deck-script")).toContainText("complete reading script");
	await expect(page.locator("[data-narration-player]")).toHaveJSProperty("paused", true);
});

test("section navigation stays beside active content and never advances on scroll", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`${base}${entry}?praxity-inspect=1#slide-4`);
	const toc = page.locator("[data-native-floating-toc]");
	await expect(toc).toBeVisible();
	await expect(toc.locator("a:visible")).toHaveCount(2);
	await clickDeckTool(page, "#deck-script-toggle");
	const rail = await page.locator("#deck-sidebar").boundingBox();
	const bounds = await toc.boundingBox();
	if (!bounds || !rail)
		throw new Error("Section navigation and transcript must have visible bounds");
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(rail.x);
	await toc.getByRole("link", { name: "Applying what you learned" }).click();
	await expect(page.getByRole("heading", { name: "Applying what you learned" })).toBeFocused();
	await expect
		.poll(() => page.locator("#main-content").evaluate((el) => el.scrollTop))
		.toBeGreaterThan(0);
	await page.mouse.wheel(0, 1500);
	await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
	await page.keyboard.press("ArrowLeft");
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	await expect(toc).toBeHidden();
	const option = page.getByRole("radio", { name: "Offer options" });
	await expect(option).toBeEnabled();
	await option.focus();
	await expect(option).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect(page.locator('[data-deck-slide="slide-3"]')).toBeVisible();
	await clickDeckTool(page, "#deck-outline-toggle");
	await page.locator('[data-deck-page="slide-4"]').click();
	await expect(toc).toBeVisible();
	const leftRail = await page.locator("#deck-outline-sidebar").boundingBox();
	const reopened = await toc.boundingBox();
	if (!reopened || !leftRail)
		throw new Error("Section navigation and outline must have visible bounds");
	expect(reopened.x).toBeGreaterThan(leftRail.x + leftRail.width);
	await expect(page.locator("#main-content")).toHaveJSProperty("scrollTop", 0);
});

test("automatic slide advancement can stop while narration continues within the slide", async ({
	page,
}) => {
	await page.goto(base + shortAudioEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await clickDeckTool(page, "#deck-script-toggle");
	await clickDeckTool(page, "#deck-advance");
	await expect(page.locator("#deck-advance")).toHaveAttribute("aria-checked", "false");
	const audio = page.locator("[data-narration-player]");
	const firstSource = await audio.getAttribute("src");
	if (!firstSource) throw new Error("Narration must have its first source");
	await page.locator(".praxity-narration-transport button").click();
	await expect(audio).not.toHaveAttribute("src", firstSource, { timeout: 10_000 });
	await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
	await expect(page.locator("#deck-status")).toContainText("Paused", { timeout: 10_000 });
	await expect(audio).toHaveJSProperty("paused", true);
	await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
});

test("authored deck preferences open transcript without focus theft and preserve learner controls", async ({
	page,
}) => {
	await page.setViewportSize({ width: 951, height: 577 });
	await page.goto(base + designedEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator("#deck-sidebar")).toBeVisible();
	await expect(page.locator("#deck-outline-toggle")).toBeHidden();
	await expect(page.locator("#deck-position")).toBeHidden();
	await expect(page.locator("#deck-follow")).toHaveAttribute("aria-pressed", "false");
	await expect(page.locator("#deck-advance")).toHaveAttribute("aria-checked", "false");
	await expect(page.locator("#deck-script-title")).not.toBeFocused();
	await page.locator("#deck-follow").click();
	await expect(page.locator("#deck-follow")).toHaveAttribute("aria-pressed", "true");
	await page.locator("#deck-sidebar-close").click();
	await expect(page.locator("#deck-script-toggle")).toBeFocused();
	await expect(page.locator("#deck-sidebar")).toBeHidden();
});

for (const viewport of [
	{ width: 390, height: 844, replacing: true },
	{ width: 949, height: 576, replacing: true },
	{ width: 1280, height: 575, replacing: true },
	{ width: 951, height: 577, replacing: false },
]) {
	for (const panel of ["script", "outline"] as const) {
		test(`fresh authored ${panel} arrival exposes lesson at ${viewport.width}x${viewport.height}`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await page.goto(base + (panel === "script" ? designedEntry : openOutlineEntry));
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			expect(
				await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
			).toEqual({ width: viewport.width, height: viewport.height });
			const main = page.getByRole("main");
			await expect(main).toBeVisible();
			await expect(main).toHaveJSProperty("inert", false);
			const heading = main.getByRole("heading", { level: 1, name: "Introduction", exact: true });
			await expect(heading).toBeVisible();
			await expect(main.getByText("Brief summary.", { exact: true })).toBeVisible();
			expect(await heading.evaluate((element) => element.closest("[inert]"))).toBeNull();
			await expect(page.locator(`#deck-${panel}-title`)).not.toBeFocused();
			await expect(page.locator(".praxity-deck")).toHaveAttribute(
				"data-panel",
				viewport.replacing ? "" : panel,
			);
			await testInfo.attach("arrival-accessibility-tree", {
				body: await page.locator("body").ariaSnapshot(),
				contentType: "text/plain",
			});
			await page.screenshot({ path: testInfo.outputPath(`fresh-${panel}-arrival.png`) });
			if (viewport.replacing) {
				await page.setViewportSize({ width: 1280, height: 900 });
				await page.reload();
				await expect(page.locator(".praxity-deck")).toHaveAttribute("data-panel", panel);
				await expect(page.locator(`#deck-${panel}-title`)).not.toBeFocused();
			}
		});
	}
}

for (const viewport of [
	{ width: 390, height: 844 },
	{ width: 1280, height: 575 },
]) {
	for (const panel of ["script", "outline"] as const) {
		test(`stored ${panel} preference focuses replacing panel at ${viewport.width}x${viewport.height}`, async ({
			page,
		}) => {
			await page.setViewportSize(viewport);
			await page.goto(base + entry);
			await clickDeckTool(page, `#deck-${panel}-toggle`);
			// Explicit arrival isolates panel preference from bookmark resume focus.
			await page.goto(`${base}${entry}?praxity-resume=0`);
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			const heading = page.getByRole("heading", {
				name: panel === "script" ? "Transcript" : "Course outline",
				exact: true,
			});
			await expect(heading).toBeVisible();
			await expect(heading).toBeFocused();
			await expect(page.locator("#main-content")).toBeHidden();
			await expect(page.locator("#main-content")).toHaveJSProperty("inert", true);
			expect(await page.getByRole("dialog").evaluate((element) => element.matches(":modal"))).toBe(
				panel === "script" && viewport.width < 600,
			);
			await expect(page.locator("#deck-next")).toBeEnabled();
			const close = panel === "script" ? "#deck-sidebar-close" : "#deck-outline-close";
			await page.locator(close).click();
			await expect(page.locator(`#deck-${panel}-toggle`)).toBeFocused();
			await expect(page.getByRole("main")).toBeVisible();
			await expect(page.getByRole("main")).toHaveJSProperty("inert", false);
			await expect(
				page.getByRole("main").getByRole("heading", { name: "Introduction", exact: true }),
			).toBeVisible();
			await page.keyboard.press("Enter");
			await expect(heading).toBeFocused();
			if (panel === "script" && viewport.width < 600) {
				await page.keyboard.press("Tab");
				await expect(page.locator(close)).toBeFocused();
				await page.keyboard.press("Enter");
			} else {
				await revealDeckTool(page, page.locator(`#deck-${panel}-toggle`));
				await page.locator(`#deck-${panel}-toggle`).focus();
				await page.keyboard.press("Enter");
			}
			await expect(page.locator(`#deck-${panel}-toggle`)).toBeFocused();
			await expect(page.getByRole("main")).toBeVisible();
			await expect(page.getByRole("main")).toHaveJSProperty("inert", false);
			await expect(
				page.getByRole("main").getByRole("heading", { name: "Introduction", exact: true }),
			).toBeVisible();
			await page.keyboard.press("Enter");
			await expect(heading).toBeFocused();
			if (panel === "script" && viewport.width < 600) await page.locator(close).click();
			else await clickDeckTool(page, `#deck-${panel}-toggle`);
			await expect(page.locator(`#deck-${panel}-toggle`)).toBeFocused();
			await expect(page.getByRole("main")).toHaveJSProperty("inert", false);
		});
	}
}

for (const viewport of [
	{ width: 390, height: 844 },
	{ width: 1280, height: 575 },
	{ width: 1280, height: 900 },
]) {
	test(`stored closed preference overrides authored transcript at ${viewport.width}x${viewport.height}`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(base + designedEntry);
		await expect(page.locator("#deck-sidebar")).toBeVisible();
		await page.locator("#deck-sidebar-close").click();
		await page.setViewportSize(viewport);
		await page.goto(`${base}${designedEntry}?praxity-resume=0`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator("#deck-sidebar")).toBeHidden();
		await expect(page.getByRole("main")).toHaveJSProperty("inert", false);
		await expect(
			page.getByRole("main").getByRole("heading", { name: "Introduction", exact: true }),
		).toBeVisible();
	});
}

test("closing an authored transcript stays closed in the next module", async ({ page }) => {
	await page.goto(base + designedEntry);
	await expect(page.locator("#deck-sidebar")).toBeVisible();
	await page.locator("#deck-sidebar-close").click();
	await page.locator("#deck-next").click();
	await page.getByRole("radio", { name: "Make an assumption" }).check();
	await page.getByRole("button", { name: /submit|check/i }).click();
	await page.locator("#deck-next").click();
	await page.getByRole("radio", { name: "Offer options" }).check();
	await page.getByRole("button", { name: /submit|check/i }).click();
	await page.locator("#deck-next").click();
	await page.getByRole("button", { name: "Finish module", exact: true }).click();
	await expect(page.locator("#deck-completion")).toBeVisible();
	await page.locator("#deck-next").click();
	await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
	await expect(page.locator("#deck-sidebar")).toBeHidden();
	await clickDeckTool(page, "#deck-script-toggle");
	await page.getByRole("button", { name: "Previous module", exact: true }).click();
	await expect(page.locator("#deck-sidebar")).toBeVisible();
});

test("formatted transcript preserves semantic text through seeking and highlighting", async ({
	page,
	browserName,
}, testInfo) => {
	test.skip(
		process.platform === "win32" &&
			browserName === "webkit" &&
			WINDOWS_WEBKIT_EXCLUSIONS.includes(testInfo.title),
		"Windows WebKit can settle paused WAV seeks 10 ms after the requested time.",
	);
	const timings = page.waitForResponse((response) => response.url().endsWith(".vtt"));
	await page.goto(base + formattedEntry);
	await timings;
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator(".deck-identity")).toBeVisible();
	await expect(page.locator(".deck-identity")).toContainText("Module deck");
	await expect(page.locator(".deck-identity")).toContainText("Module one");
	const reading = page.locator('#deck-script [data-deck-reading="slide-1"]');
	await expect(reading.getByRole("heading", { name: "Reading context" })).toBeVisible();
	await expect(
		reading.getByRole("button", { name: "Go here: Reading context", exact: true }),
	).toHaveCount(1);
	await expect(page.locator('#deck-outline-sidebar[role="complementary"]')).toHaveCount(0);
	await expect(
		page.locator('#deck-outline-sidebar nav[aria-labelledby="deck-outline-title"]'),
	).toHaveCount(1);
	await expect(reading).not.toContainText("[sincerely]");
	await expect(reading).not.toContainText("[delighted]");
	await expect(reading.locator("strong")).toHaveText("with care");
	await expect(reading.locator("em")).toHaveText("at your pace");
	await expect(reading.locator("ul > li")).toHaveText(["Ask for support.", "Review the options."]);
	await expect(reading.locator("ol > li")).toHaveText([
		"Choose a response.",
		"Continue when ready.",
	]);
	const audio = page.locator("[data-narration-player]");
	await expect(page.getByRole("slider", { name: "Position in narration" })).toBeEnabled();
	await reading.locator("strong").click();
	await expect(audio).toHaveJSProperty("paused", true);
	await expect
		.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
		.toBe(2);
	await page.locator(".praxity-narration-transport button").click();
	await expect
		.poll(() =>
			page.evaluate(() => {
				const highlights = (CSS as unknown as { highlights: Map<string, Iterable<Range>> })
					.highlights;
				return Array.from(highlights.get("praxity-narration-current") ?? [])
					.map((range) => range.toString())
					.join(" ");
			}),
		)
		.toContain("Read with care and at your pace.");
	await expect(reading.locator("strong")).toHaveText("with care");
	await expect(reading.locator("em")).toHaveText("at your pace");
});

test("follow reveals a partially clipped transcript phrase without scrolling the slide", async ({
	page,
}) => {
	await page.goto(base + formattedEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const pane = page.locator("#deck-script-scroll");
	const phrase = page.locator('#deck-script [data-deck-reading="slide-1"] p').first();
	await pane.evaluate((element) => {
		element.style.height = "180px";
		element.style.flex = "none";
	});
	await phrase.evaluate((element) => {
		element.style.marginTop = "150px";
		element.style.paddingBottom = "50px";
	});
	const before = await page.evaluate(() => ({
		outer: scrollY,
		main: document.querySelector("#main-content")?.scrollTop,
	}));
	await page.locator(".praxity-narration-transport button").click();
	await page.locator("[data-narration-player]").evaluate((element: HTMLAudioElement) => {
		element.currentTime = 2;
		element.dispatchEvent(new Event("timeupdate"));
	});
	await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await expect
		.poll(() =>
			phrase.evaluate((element) => {
				const range = document.createRange();
				range.selectNodeContents(element);
				const text = range.getBoundingClientRect();
				const pane = document.querySelector("#deck-script-scroll")?.getBoundingClientRect();
				return !!pane && text.top >= pane.top && text.bottom <= pane.bottom;
			}),
		)
		.toBe(true);
	expect(
		await page.evaluate(() => ({
			outer: scrollY,
			main: document.querySelector("#main-content")?.scrollTop,
		})),
	).toEqual(before);
});

for (const width of [1280, 390]) {
	test(`resume following restores transcript tracking without starting paused audio at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 720 });
		await page.goto(base + formattedEntry);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		if (!(await page.locator("#deck-script-scroll").isVisible()))
			await clickDeckTool(page, "#deck-script-toggle");
		const pane = page.locator("#deck-script-scroll");
		const resume = page.locator("#deck-resume-follow");
		const follow = page.locator("#deck-follow");
		const audio = page.locator("[data-narration-player]");
		await expect(resume).toBeHidden();
		await pane.evaluate((element) => {
			element.style.height = "180px";
			element.style.flex = "none";
		});
		const paneTop = await pane.evaluate((element) => element.getBoundingClientRect().top);
		if (width < 600) await page.locator("#deck-sidebar-close").click();
		await page.locator(".praxity-narration-transport button").click();
		await expect(audio).toHaveJSProperty("paused", false);
		if (width < 600) await clickDeckTool(page, "#deck-script-toggle");
		await pane.hover();
		await page.mouse.wheel(0, 220);
		await expect(resume).toBeVisible();
		expect(await pane.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(
			paneTop,
			0,
		);
		await expect(follow).toHaveAttribute("aria-pressed", "true");
		await expect(audio).toHaveJSProperty("paused", true);
		await expect(page.locator(".praxity-narration-transport button")).toHaveAttribute(
			"aria-label",
			"Play",
		);
		await page.screenshot({ path: testInfo.outputPath(`resume-follow-${width}.png`) });
		// Observe application seeks directly: WebKit can settle its initial media
		// clock after pause, and this fixture server does not serve byte ranges.
		await audio.evaluate((element: HTMLAudioElement) => {
			const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
			if (!descriptor?.get || !descriptor.set) throw new Error("Missing media clock descriptor");
			Object.defineProperty(element, "currentTime", {
				get: () => descriptor.get?.call(element),
				set: (value) => {
					element.dataset.seekRequested = "true";
					descriptor.set?.call(element, value);
				},
			});
		});
		const source = await audio.getAttribute("src");
		await resume.focus();
		await resume.press("Enter");
		await expect(resume).toBeHidden();
		await expect(follow).toBeFocused();
		await expect(follow).toHaveAttribute("aria-pressed", "true");
		await expect(audio).toHaveJSProperty("paused", true);
		await expect(audio).not.toHaveAttribute("data-seek-requested");
		expect(await audio.getAttribute("src")).toBe(source);
		expect(
			(await analyzeAxe(page, new AxeBuilder({ page }).include("#deck-sidebar"))).violations,
		).toEqual([]);
	});
}

test("transcript seeks retain the explicit follow preference during playback", async ({ page }) => {
	await page.goto(base + formattedEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const follow = page.locator("#deck-follow");
	const audio = page.locator("[data-narration-player]");
	const reading = page.locator('#deck-script [data-deck-reading="slide-1"]');
	await expect(follow).toHaveAttribute("aria-pressed", "true");
	await page.locator(".praxity-narration-transport button").click();
	await expect(audio).toHaveJSProperty("paused", false);
	await reading.locator("strong").click();
	await expect(follow).toHaveAttribute("aria-pressed", "true");
	await expect(audio).toHaveJSProperty("paused", false);
	const seek = reading.locator("[data-deck-seek]").last();
	await seek.focus();
	await seek.press("Enter");
	await expect(follow).toHaveAttribute("aria-pressed", "true");
	await follow.click();
	await expect(follow).toHaveAttribute("aria-pressed", "false");
	await reading.locator("strong").click();
	await expect(follow).toHaveAttribute("aria-pressed", "false");
});

test("formatted transcript and identity header reflow with enlarged text", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 720 });
	await page.goto(base + formattedEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.addStyleTag({
		content: `html { font-size: 200% !important; }
		#deck-script * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }
		#deck-script p { margin-bottom: 2em !important; }`,
	});
	await expect(page.locator(".deck-identity")).toBeVisible();
	await expect(page.locator(".deck-identity")).toContainText("Module deck");
	await expect(page.locator(".deck-identity")).toContainText("Module one");
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await clickDeckTool(page, "#deck-script-toggle");
	await expect(page.locator(".deck-identity")).toBeHidden();
	await expect(page.locator("dialog.deck-transcript-sheet")).toBeVisible();
	await expect(page.locator("#deck-script-title")).toBeVisible();
	await expect(page.locator("#deck-sidebar-close")).toBeVisible();
	expect(
		await page.locator("#deck-script-scroll").evaluate((element) => element.clientHeight),
	).toBeGreaterThanOrEqual(720 * 0.5);
	const reading = page.locator('#deck-script [data-deck-reading="slide-1"]');
	await expect(reading.getByRole("heading", { name: "Reading context" })).toBeVisible();
	await expect(
		reading.getByRole("button", { name: "Go here: Reading context", exact: true }),
	).toHaveCount(1);
	await expect(page.locator('#deck-outline-sidebar[role="complementary"]')).toHaveCount(0);
	await expect(
		page.locator('#deck-outline-sidebar nav[aria-labelledby="deck-outline-title"]'),
	).toHaveCount(1);
	await expect(reading.locator("ol > li")).toHaveCount(2);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	const violations = (await analyzeAxe(page, new AxeBuilder({ page }).include("#deck-sidebar")))
		.violations;
	expect(violations).toEqual([]);
	await page.keyboard.press("Escape");
	await expect(page.locator(".deck-identity")).toBeVisible();
	await expect(page.locator("#deck-script-toggle")).toBeFocused();
});

test("slide gutters scroll the content while transcript scrolling stays independent", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 800 });
	await page.goto(`${base}${groupedEntry}?praxity-inspect=1#group-slide-2`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const main = page.locator("#main-content");
	const bounds = await main.boundingBox();
	if (!bounds) throw new Error("Slide scrollport needs bounds");
	expect(bounds.width).toBe(1440);
	await page.mouse.move(bounds.x + 10, bounds.y + 100);
	await page.mouse.wheel(0, 500);
	await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("scrolling a narrated slide keeps audio playing, while slide navigation pauses it", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 800 });
	await page.goto(`${base}/stable${audioEntry}?praxity-inspect=1#slide-4`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const audio = page.locator("[data-narration-player]");
	await expect
		.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration))
		.toBeGreaterThan(45);
	await page.locator(".praxity-narration-transport button").click();
	await expect(audio).toHaveJSProperty("paused", false);
	await expect
		.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
		.toBeGreaterThan(0.1);
	const main = page.locator("#main-content");
	await main.hover();
	await page.mouse.wheel(0, 500);
	await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await expect(audio).toHaveJSProperty("paused", false);
	await expect(page.locator("#deck-follow")).toHaveAttribute("aria-pressed", "true");
	await page.locator("#deck-previous").click();
	await expect(audio).toHaveJSProperty("paused", true);
});

test("other module titles are prominent, less indented, and navigable", async ({ page }) => {
	await page.goto(`${base}${entry}?praxity-inspect=1`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await clickDeckTool(page, "#deck-outline-toggle");
	for (const [otherId, currentId] of [
		["module-two", "slide-1"],
		["slide-1", "module-two"],
	] as const) {
		await expect(page.locator("#deck-outline-toggle")).toHaveAttribute("aria-expanded", "true");
		const other = page.locator(`#deck-outline a.deck-module-link[data-deck-page="${otherId}"]`);
		await expect(other).toBeVisible();
		const layout = await page.evaluate(
			({ otherId, currentId }) => {
				const other = document.querySelector<HTMLElement>(
					`#deck-outline a[data-deck-page="${otherId}"] span`,
				);
				const current = document.querySelector<HTMLElement>(
					`#deck-outline a[data-deck-page="${currentId}"] span`,
				);
				if (!other || !current) throw new Error("Missing outline labels");
				return {
					weight: Number(getComputedStyle(other.parentElement as HTMLElement).fontWeight),
					otherStart: other.getBoundingClientRect().left,
					currentStart: current.getBoundingClientRect().left,
				};
			},
			{ otherId, currentId },
		);
		expect(layout.weight).toBe(600);
		expect(layout.otherStart).toBeLessThan(layout.currentStart);
		await other.click();
		await expect(page.locator(`[data-deck-slide="${otherId}"]`)).toBeVisible();
	}
});

test("list belongs with its introduction and wrapped text hangs after its marker", async ({
	page,
}) => {
	await page.setViewportSize({ width: 640, height: 720 });
	await page.goto(base + listEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator('.praxity-float-region [data-block-id="list-items"]')).toBeVisible();
	const layout = await page.evaluate(() => {
		const intro = document.querySelector<HTMLElement>('[data-block-id="list-intro"]');
		const list = document.querySelector<HTMLElement>('[data-block-id="list-items"]');
		const following = document.querySelector<HTMLElement>('[data-block-id="list-following"]');
		const image = document.querySelector<HTMLElement>(
			'[data-block-id="list-float-image"] figure[data-image-float]',
		);
		const listElement = list?.querySelector("ul");
		const item = list?.querySelector("li");
		if (!intro || !list || !following || !image || !listElement || !item?.firstChild)
			throw new Error("Missing list fixture");
		const text = item.firstChild;
		const lines = new Map<number, number>();
		for (let index = 0; index < (text.textContent?.length ?? 0); index++) {
			const range = document.createRange();
			range.setStart(text, index);
			range.setEnd(text, index + 1);
			const rect = range.getBoundingClientRect();
			if (rect.width) lines.set(rect.top, Math.min(lines.get(rect.top) ?? Infinity, rect.left));
		}
		return {
			before: list.getBoundingClientRect().top - intro.getBoundingClientRect().bottom,
			after: following.getBoundingClientRect().top - list.getBoundingClientRect().bottom,
			markerStart: listElement.getBoundingClientRect().left,
			imageEnd: image.getBoundingClientRect().right,
			lineStarts: [...lines.values()],
		};
	});
	expect(layout.after).toBeGreaterThan(layout.before);
	expect(layout.markerStart).toBeGreaterThanOrEqual(layout.imageEnd - 1);
	expect(layout.lineStarts.length).toBeGreaterThan(1);
	expect(layout.lineStarts[1]).toBeCloseTo(layout.lineStarts[0], 0);
});

test("mobile More keeps tools reachable by keyboard and across resize", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 720 });
	await page.goto(base + entry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const more = page.locator("#deck-more");
	const summary = more.locator("#deck-more-toggle");
	const outline = page.locator("#deck-outline-toggle");
	await expect(summary).toHaveAttribute("aria-expanded", "false");
	await expect(outline).toBeHidden();
	await summary.focus();
	await page.keyboard.press("Enter");
	await expect(outline).toBeVisible();
	await page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab");
	await expect(outline).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(outline).toBeHidden();
	await expect(summary).toBeFocused();
	await clickDeckTool(page, "#deck-script-toggle");
	await expect(page.locator("#deck-script-title")).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(page.locator("#deck-script-toggle")).toBeFocused();
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(summary).toBeVisible();
	await expect(summary).toHaveAttribute("aria-expanded", "true");
	await expect(outline).toBeVisible();
	await expect(page.locator("#deck-script-toggle")).toBeVisible();
});

for (const width of [320, 390]) {
	test(`mobile transcript replaces slide and preserves playback and close focus at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 720 });
		await page.goto(`${base}/stable${audioEntry}?praxity-inspect=1#slide-4`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const toggle = page.locator("#deck-script-toggle");
		await revealDeckTool(page, toggle);
		await toggle.click();
		const sheet = page.locator("dialog.deck-transcript-sheet");
		await expect(sheet).toHaveRole("dialog");
		expect(await sheet.evaluate((element) => element.matches(":modal"))).toBe(true);
		await expect(page.locator("#main-content")).toBeHidden();
		await expect(page.locator("#main-content")).toHaveJSProperty("inert", true);
		await expect(page.locator("#deck-script-title")).toBeFocused();
		const pane = page.locator("#deck-script-scroll");
		await pane.hover();
		await page.mouse.wheel(0, 500);
		await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
		const controls = await page.locator("#deck-controls").boundingBox();
		if (!controls) throw new Error("Playback controls need bounds");
		expect(controls.height).toBeLessThan(130);
		expect(controls.y + controls.height).toBeLessThanOrEqual(720);
		await page.locator("#deck-sidebar-close").click();
		await page.locator(".praxity-narration-transport button").click();
		await expect(page.locator("[data-narration-player]")).toHaveJSProperty("paused", false);
		await clickDeckTool(page, "#deck-script-toggle");
		await expect(page.locator("[data-narration-player]")).toHaveJSProperty("paused", false);
		await page.screenshot({ path: testInfo.outputPath(`mobile-transcript-${width}.png`) });
		expect(
			(
				await analyzeAxe(
					page,
					new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]),
				)
			).violations,
		).toEqual([]);
		await page.locator("#deck-sidebar-close").click();
		await expect(toggle).toBeFocused();
		await expect(page.locator("#main-content")).toBeVisible();
		await expect(page.locator("#main-content")).toHaveJSProperty("inert", false);
		await page.locator(".praxity-narration-transport button").click();
		await expect(page.locator("[data-narration-player]")).toHaveJSProperty("paused", true);
		await clickDeckTool(page, "#deck-outline-toggle");
		await expect(page.locator("#deck-outline-sidebar")).toHaveAttribute("role", "dialog");
		await page.keyboard.press("Escape");
		await expect(page.locator("#deck-outline-toggle")).toBeFocused();
	});
}

for (const panel of ["script", "outline"] as const) {
	test(`short viewport recovers focused lesson into the open ${panel} panel and back`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(`${base}${entry}?praxity-inspect=1#slide-3`);
		await clickDeckTool(page, `#deck-${panel}-toggle`);
		const main = page.getByRole("main");
		await main.focus();
		await expect(main).toBeFocused();
		await page.setViewportSize({ width: 1280, height: 575 });
		await expect(page.locator(`#deck-${panel}-title`)).toBeFocused();
		await expect(page.locator("#main-content")).toBeHidden();
		await expect(page.locator("#main-content")).toHaveJSProperty("inert", true);
		await page.setViewportSize({ width: 1280, height: 900 });
		await expect(main).toBeVisible();
		await expect(main).toHaveJSProperty("inert", false);
		await expect(page.locator(`#deck-${panel}-title`)).toBeFocused();
		await page.locator(panel === "script" ? "#deck-sidebar-close" : "#deck-outline-close").click();
		await expect(page.locator(`#deck-${panel}-toggle`)).toBeFocused();
	});

	test(`resizing an open desktop ${panel} panel recovers focus from the hidden slide`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 800 });
		await page.goto(`${base}${entry}?praxity-inspect=1#slide-3`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await clickDeckTool(page, `#deck-${panel}-toggle`);
		const radio = page.getByRole("radio", { name: "Offer options" });
		await expect(radio).toBeEnabled();
		await radio.focus();
		await expect(radio).toBeFocused();
		await page.setViewportSize({ width: 390, height: 720 });
		await expect(page.locator(`#deck-${panel}-title`)).toBeFocused();
		await expect(page.locator("#main-content")).toHaveJSProperty("inert", true);
	});
}

test("resizing an open desktop transcript focuses the modal heading from its hidden tool", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 800 });
	await page.goto(`${base}${entry}?praxity-inspect=1#slide-3`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const toggle = page.locator("#deck-script-toggle");
	await revealDeckTool(page, toggle);
	await toggle.click();
	await revealDeckTool(page, toggle);
	await toggle.focus();
	await expect(toggle).toBeFocused();
	await page.setViewportSize({ width: 390, height: 720 });
	await expect(page.locator("#deck-script-title")).toBeFocused();
	await expect(page.locator("#main-content")).toHaveJSProperty("inert", true);
});

test("resizing an open desktop transcript moves outside focus into the modal", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 800 });
	await page.goto(`${base}${entry}?praxity-inspect=1#slide-3`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await clickDeckTool(page, "#deck-script-toggle");
	const radio = page.getByRole("radio", { name: "Offer options" });
	await expect(radio).toBeEnabled();
	await radio.focus();
	await expect(radio).toBeFocused();
	await page.evaluate(() => {
		const outside = document.createElement("button");
		outside.id = "outside-deck-focus";
		document.body.append(outside);
		outside.focus();
	});
	const outside = page.locator("#outside-deck-focus");
	await expect(outside).toBeFocused();
	await page.setViewportSize({ width: 390, height: 720 });
	await expect(page.locator("#deck-script-title")).toBeFocused();
	await expect(page.locator("#main-content")).toHaveJSProperty("inert", true);
});

test("printing an open mobile transcript retains every slide and reading", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 720 });
	await page.goto(base + entry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await clickDeckTool(page, "#deck-script-toggle");
	await expect(page.locator("#main-content")).toBeHidden();
	await page.emulateMedia({ media: "print" });
	await expect(page.locator("#main-content")).toBeVisible();
	await expect(page.locator("[data-deck-slide]:visible")).toHaveCount(4);
	await expect(page.locator("[data-deck-reading]:visible")).toHaveCount(4);
	await page.emulateMedia({ media: "screen" });
	await expect(page.locator("[data-deck-reading]:visible")).toHaveCount(1);
	await expect(page.locator('[data-deck-reading="slide-1"]')).toBeVisible();
});

test("a fitting slide has one vertical boundary while long and enlarged slides still scroll", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 800 });
	await page.goto(`${base}${entry}?praxity-inspect=1`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const main = page.locator("#main-content");
	const canvas = page.locator(".deck-slide:visible > .praxity-slide");
	// A 600px block fits with the fixed 48px start and one footer-height end inset.
	await canvas.evaluate((element) => {
		element.replaceChildren(
			Object.assign(document.createElement("div"), { textContent: "Fitting content" }),
		);
		(element.firstElementChild as HTMLElement).style.height = "600px";
		document.documentElement.style.setProperty("--praxity-space-boundary", "56px");
	});
	await expect
		.poll(() => main.evaluate((element) => element.scrollHeight - element.clientHeight))
		.toBe(0);
	const positions: number[] = [];
	for (const alignment of ["start", "center", "end"]) {
		await canvas.evaluate((element, value) => {
			element.setAttribute("data-slide-style", "custom");
			(element as HTMLElement).style.setProperty("--slide-align", value);
		}, alignment);
		await expect(canvas).toHaveCSS("align-content", "start");
		positions.push(
			await canvas.evaluate(
				(element) => element.firstElementChild?.getBoundingClientRect().top ?? 0,
			),
		);
		await expect
			.poll(() => main.evaluate((element) => element.scrollHeight - element.clientHeight))
			.toBe(0);
	}
	const stage = await main.boundingBox();
	if (!stage) throw new Error("Missing stage bounds");
	expect(positions).toEqual([stage.y + 48, stage.y + 48, stage.y + 48]);
	await canvas.evaluate((element) => {
		(element.firstElementChild as HTMLElement).style.height = "1000px";
	});
	await expect
		.poll(() => main.evaluate((element) => element.scrollHeight - element.clientHeight))
		.toBeGreaterThan(250);
	await page.goto(`${base}${entry}?praxity-inspect=1#slide-4`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
	await expect
		.poll(() => main.evaluate((element) => element.scrollHeight - element.clientHeight))
		.toBeGreaterThan(0);
});

for (const width of [1280, 390]) {
	test(`assessment float context stays unboxed and keeps its image gutter at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`${base}${floatedGroupEntry}?praxity-inspect=1#group-slide-2`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const slide = page.locator('[data-deck-slide="group-slide-2"]');
		const context = slide.locator(".praxity-float-region[data-assessment-group-context]");
		await expect(context).toBeVisible();
		// Make the image taller than its companion text, as in the reported scenario.
		await context.locator("img").evaluate((image) => {
			image.style.height = "360px";
			image.style.objectFit = "cover";
		});
		const geometry = await context.evaluate((region) => {
			const header = region.previousElementSibling!;
			const question = region.nextElementSibling!;
			const bounds = region.getBoundingClientRect();
			const image = region.querySelector("img")!.getBoundingClientRect();
			return {
				topGap: bounds.top - header.getBoundingClientRect().bottom,
				bottomGap: question.getBoundingClientRect().top - bounds.bottom,
				imageGutter: bounds.bottom - image.bottom,
				border: getComputedStyle(region).borderInlineStartWidth,
			};
		});
		expect(Math.abs(geometry.topGap)).toBeLessThanOrEqual(1);
		expect(Math.abs(geometry.bottomGap)).toBeLessThanOrEqual(1);
		expect(geometry.imageGutter).toBeGreaterThanOrEqual(16);
		expect(geometry.border).toBe("0px");
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await page.screenshot({ path: testInfo.outputPath(`assessment-float-frame-${width}.png`) });
		for (let index = 1; index <= 6; index++) {
			await slide.getByRole("radio", { name: `Confident ${index}`, exact: true }).check();
		}
		await slide.getByRole("button", { name: "Send survey", exact: true }).click();
		const last = slide.locator("[data-group-last]");
		await expect(last).not.toHaveAttribute("data-group-has-footer");
		const radii = await last.evaluate((element) => ({
			outer: getComputedStyle(element).borderBottomLeftRadius,
			inner: getComputedStyle(element.querySelector(".praxity-block-assessment")!)
				.borderBottomLeftRadius,
		}));
		expect(radii.outer).toBe("0px");
		expect(radii.inner).toBe("16px");
		await last.scrollIntoViewIfNeeded();
		await page.screenshot({ path: testInfo.outputPath(`assessment-rounded-bottom-${width}.png`) });
	});
}

for (const width of [1280, 390]) {
	test(`silent slides expose an unavailable narration control at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`${base}/stable${mixedAudioEntry}?praxity-inspect=1`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const transport = page.locator(".praxity-narration-transport button");
		const audio = page.locator("[data-narration-player]");
		await transport.click();
		await expect(audio).toHaveJSProperty("paused", false);
		await page.locator("#deck-next").click();
		await expect(audio).toHaveJSProperty("paused", true);
		await expect(transport).toHaveAttribute("aria-disabled", "true");
		await expect(transport).toHaveAccessibleName("No narration on this slide");
		await transport.focus();
		await expect(transport).toBeFocused();
		await expect(page.getByRole("tooltip")).toHaveText("No narration on this slide");
		await page.keyboard.press("Escape");
		await expect(page.getByRole("tooltip")).toHaveCount(0);
		await transport.hover();
		await expect(page.getByRole("tooltip")).toHaveText("No narration on this slide");
		await page.keyboard.press("Enter");
		await page.keyboard.press("Space");
		await expect(audio).toHaveJSProperty("paused", true);
		await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
		await page.screenshot({ path: testInfo.outputPath(`silent-narration-${width}.png`) });
		await page.locator("#deck-next").click();
		await expect(transport).toHaveAttribute("aria-disabled", "true");
		await expect(transport).toHaveAccessibleName("No narration on this slide");
		await page.locator("#deck-next").click();
		await expect(transport).not.toHaveAttribute("aria-disabled", "true");
		await expect(transport).toHaveAccessibleName("Play");
		await transport.click();
		await expect(audio).toHaveJSProperty("paused", false);
	});
}

for (const width of [1280, 390]) {
	test(`plain assessment introduction aligns with cards at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`${base}${groupedEntry}?praxity-inspect=1#group-slide-2`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const intro = page.locator('[data-deck-slide="group-slide-2"] [data-assessment-group-context]');
		await expect(intro).toHaveText("Read this scenario before answering the questions below.");
		const padding = await intro.evaluate((element) => {
			const style = getComputedStyle(element);
			return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
				parseFloat,
			);
		});
		expect(padding[1]).toBe(0);
		expect(padding[3]).toBe(0);
		for (const value of [padding[0], padding[2]]) expect(value).toBeGreaterThanOrEqual(16);
		const card = page
			.locator(
				'[data-deck-slide="group-slide-2"] .praxity-block[data-assessment-group] > .praxity-block-assessment',
			)
			.first();
		const introBox = await intro.boundingBox();
		const cardBox = await card.boundingBox();
		if (!introBox || !cardBox) throw new Error("Missing group introduction geometry");
		expect(Math.abs(introBox.x - cardBox.x)).toBeLessThanOrEqual(0.5);
		await page.screenshot({ path: testInfo.outputPath(`plain-intro-${width}.png`) });
	});
}

for (const width of [1280, 390]) {
	test(`More below reserves a band without covering text at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`${base}${entry}?praxity-inspect=1#slide-4`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const main = page.locator("#main-content");
		const cue = page.locator("#deck-more-below");
		await main
			.locator('[data-deck-slide="slide-4"] p')
			.first()
			.evaluate((paragraph) => {
				paragraph.textContent = (paragraph.textContent ?? "").repeat(3);
			});
		await expect(cue).toBeVisible();
		const assertClearBand = async () => {
			const geometry = await main.evaluate((element) => {
				const cue = document.querySelector("#deck-more-below");
				if (!cue) throw new Error("Missing More below cue");
				const band = cue.getBoundingClientRect();
				const stage = element.getBoundingClientRect();
				const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
				let intersections = 0;
				while (walker.nextNode()) {
					const range = document.createRange();
					range.selectNodeContents(walker.currentNode);
					for (const line of range.getClientRects()) {
						// Text outside the scrollport is clipped and cannot cover the cue.
						const top = Math.max(line.top, stage.top);
						const bottom = Math.min(line.bottom, stage.bottom);
						if (
							bottom > top &&
							top < band.bottom &&
							bottom > band.top &&
							line.left < band.right &&
							line.right > band.left
						)
							intersections++;
					}
				}
				return { intersections, height: band.height, gap: band.top - stage.bottom };
			});
			expect(geometry.intersections).toBe(0);
			expect(geometry.height).toBe(44);
			expect(geometry.gap).toBeGreaterThanOrEqual(0);
		};
		await assertClearBand();
		await expect(cue).toHaveRole("button");
		await expect(cue).toHaveAccessibleName("More below");
		await page.screenshot({ path: testInfo.outputPath(`stage-overflow-${width}.png`) });
		const screen = await main.evaluate((element) => element.clientHeight);
		await cue.click();
		await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(screen);
		if (await cue.isVisible()) await assertClearBand();
		// Scrolling reveals a lazy assessment whose hydration can move the content end.
		const finalChoice = main.getByRole("radio", { name: "Review the script", exact: true });
		await finalChoice.scrollIntoViewIfNeeded();
		await expect(finalChoice).toBeEnabled();
		await main.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		await expect(cue).toBeHidden();
		await page.screenshot({ path: testInfo.outputPath(`stage-end-${width}.png`) });
		await main.evaluate((element) => {
			element.scrollTop = 0;
		});
		await expect(cue).toBeVisible();
		await assertClearBand();
		await cue.focus();
		await page.keyboard.press("Enter");
		await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(screen);
	});
}

test("course body font survives player styles and island hydration", async ({ page }) => {
	await page.goto(base + audioEntry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(page.locator("#deck-narration button").first()).toBeVisible();
	for (const selector of ["body", '[data-deck-slide="slide-1"] p'])
		await expect(page.locator(selector).first()).toHaveCSS(
			"font-family",
			'"Source Sans 3", sans-serif',
		);
});

test("slide content is keyboard scrollable", async ({ page, browserName }) => {
	await page.setViewportSize({ width: 800, height: 600 });
	await page.goto(base + entry);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const main = page.locator("#main-content");
	await main
		.locator(".deck-slide")
		.first()
		.evaluate((slide) => {
			for (let i = 0; i < 30; i++) {
				const paragraph = document.createElement("p");
				paragraph.textContent = `Reading paragraph ${i + 1}`;
				slide.append(paragraph);
			}
		});
	await page.locator('a[href="#deck-controls"]').focus();
	await page.keyboard.press(
		browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
	);
	await expect(main).toBeFocused();
	await expect(main).toHaveCSS("outline-style", "solid");
	await expect(main).toHaveCSS("outline-width", "2px");
	await expect(main).toHaveCSS("outline-offset", "-3px");
	await page.keyboard.press("PageDown");
	await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("outline labels reflow with increased text spacing inside their landmark", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(base + entry);
	await clickDeckTool(page, "#deck-outline-toggle");
	await page
		.locator('#deck-outline [data-deck-page="slide-1"] span')
		.first()
		.evaluate((label) => {
			label.textContent =
				"Understanding responsibilities and interoperableaccessibilityrequirements for everyone";
		});
	await page.addStyleTag({
		content: `#deck-outline * {
		line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important;
	} #deck-outline p { margin-bottom: 2em !important; }`,
	});
	const outline = page.getByRole("navigation", { name: "Course outline", exact: true });
	await expect(outline.getByRole("heading", { name: "Course outline" })).toBeVisible();
	const sizes = await outline.locator(".deck-panel-scroll, a, a > span").evaluateAll((elements) =>
		elements.map((element) => ({
			width: element.clientWidth,
			overflow: element.scrollWidth - element.clientWidth,
		})),
	);
	for (const size of sizes) expect(size.overflow, JSON.stringify(size)).toBeLessThanOrEqual(1);
	const scan = await analyzeAxe(
		page,
		new AxeBuilder({ page }).withRules(["region", "scrollable-region-focusable"]),
	);
	expect(scan.violations).toEqual([]);
});

type ChromeState = {
	name: string;
	on: boolean;
	color: string;
	background: string;
	shadow: string;
	outline: string;
	marker: string;
};

/** Reads each Guided toggle's resting appearance, away from hover and focus styling. */
async function chromeStates(page: Page): Promise<ChromeState[]> {
	await page.mouse.move(0, 0);
	return page
		.locator(
			"#deck-controls button[aria-expanded], #deck-controls button[aria-pressed], #deck-controls button[aria-checked], .deck-follow > button",
		)
		.evaluateAll((controls) =>
			controls
				.filter(
					(control) =>
						control.checkVisibility() ||
						// The modal hides its Transcript trigger in More; keep checking its state styling.
						(control.id === "deck-script-toggle" &&
							!!document.querySelector("dialog.deck-transcript-sheet:modal")),
				)
				.map((control) => {
					const style = getComputedStyle(control);
					const marker = getComputedStyle(control, "::after");
					return {
						name: control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "",
						on:
							control.getAttribute("aria-pressed") === "true" ||
							control.getAttribute("aria-checked") === "true" ||
							control.getAttribute("aria-expanded") === "true",
						color: style.color,
						background: style.backgroundColor,
						shadow: style.boxShadow,
						outline: style.outlineStyle,
						marker:
							marker.content === "none" || marker.content === "normal"
								? "none"
								: `${marker.width}x${marker.height} ${marker.backgroundColor}`,
					};
				}),
		);
}

const luminance = (color: string) => {
	const [r, g, b] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
		const channel = Number(value) / 255;
		return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (first: string, second: string) => {
	const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
	return (high + 0.05) / (low + 0.05);
};

for (const width of [390, 900, 1280]) {
	for (const locale of ["en", "fr"] as const) {
		for (const larger of [false, true]) {
			test(`Guided chrome keeps one icon-button treatment and one options disclosure at ${width}px, ${locale}, larger=${larger}`, async ({
				page,
			}, testInfo) => {
				await page.setViewportSize({ width, height: 800 });
				await page.addInitScript(
					(enabled) =>
						localStorage.setItem(
							"praxity-a11y",
							JSON.stringify({ textSize: enabled ? "large" : "default" }),
						),
					larger,
				);
				// Chrome geometry needs a hydrated deck, not media metadata readiness.
				await page.goto(base + (locale === "fr" ? frenchAudioEntry : audioEntry), {
					waitUntil: "domcontentloaded",
				});
				await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				await expect(page.locator(".praxity-narration-transport button")).toBeVisible();
				const controls = page.locator("#deck-controls");

				// Footer controls stay whole, separate and unobscured.
				const footer = await controls
					.locator("button, summary, input, #deck-position")
					.evaluateAll((elements) => {
						// Closed native details can retain descendant rectangles without painting them.
						const visible = elements.filter((element) => element.checkVisibility());
						return visible.map((element, index) => {
							const box = element.getBoundingClientRect();
							const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
							return {
								name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
								iconOnly:
									element.matches("button, summary") &&
									!element.classList.contains("deck-gate-notice") &&
									!element.textContent?.trim(),
								width: box.width,
								height: box.height,
								inside: box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
								unobscured: !!hit && element.contains(hit),
								overlaps: visible
									.slice(index + 1)
									.filter((other) => {
										const next = other.getBoundingClientRect();
										const x = Math.min(box.right, next.right) - Math.max(box.left, next.left);
										const y = Math.min(box.bottom, next.bottom) - Math.max(box.top, next.top);
										return x > 1 && y > 1;
									})
									.map((other) => other.getAttribute("aria-label") ?? other.id),
							};
						});
					});
				for (const control of footer) {
					expect(control.inside, `${control.name} inside viewport`).toBe(true);
					expect(control.unobscured, `${control.name} unobscured`).toBe(true);
					expect(control.overlaps, `${control.name} overlaps`).toEqual([]);
					if (control.iconOnly) {
						expect(control.width, `${control.name} width`).toBeCloseTo(44, 0);
						expect(control.height, `${control.name} height`).toBeCloseTo(44, 0);
					}
				}
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true,
				);

				// Playback settings share the labelled Tools disclosure at every width.
				const disclosures = await controls
					.locator(
						'summary, button[aria-expanded]:not([aria-controls="deck-sidebar"], [aria-controls="deck-outline-sidebar"])',
					)
					.evaluateAll(
						(elements) => elements.filter((element) => element.checkVisibility()).length,
					);
				expect(disclosures).toBeLessThanOrEqual(1);
				let menuStates: ChromeState[] = [];
				{
					expect(disclosures).toBe(1);
					const more = controls.getByRole("button", {
						name: locale === "fr" ? "Outils" : "Tools",
						exact: true,
					});
					await expect(more).toHaveAttribute("type", "button");
					await expect(more).toHaveAttribute("aria-controls", "deck-more-panel");
					await expect(more).toHaveAttribute("aria-expanded", "false");
					await more.focus();
					await page.keyboard.press("Space");
					await expect(more).toHaveAttribute("aria-expanded", "true");
					await expect(page.locator("#deck-more-panel")).toBeVisible();
					await expect(more).toBeFocused();
					const advance = page.locator("#deck-advance");
					if ((await advance.getAttribute("aria-checked")) !== "true") await advance.click();
					const speed = controls.locator(".praxity-narration-speed");
					await expect(speed).toBeVisible();
					await expect(speed).toHaveAttribute("aria-label", /: 1×$/);
					await more.evaluate((element) => element.blur());
					menuStates = await chromeStates(page);
					await more.focus();
					await page.keyboard.press("Escape");
					await expect(more).toHaveAttribute("aria-expanded", "false");
					await expect(page.locator("#deck-more-panel")).toBeHidden();
					await expect(more).toBeFocused();
				}

				// Toggle buttons share a dot; Auto-advance uses a labelled switch with a moving thumb.
				const followName = locale === "fr" ? "Suivre la narration" : "Follow narration";
				const advanceName = locale === "fr" ? "Avancer automatiquement" : "Auto-advance";
				await clickDeckTool(page, "#deck-script-toggle");
				await expect(page.locator("#deck-follow")).toBeVisible();
				if (width >= 600) {
					await revealDeckTool(page, page.locator("#deck-script-toggle"));
				} else {
					expect(
						await page
							.locator("dialog.deck-transcript-sheet")
							.evaluate((element) => element.matches(":modal")),
					).toBe(true);
					await expect(page.locator("#deck-more-toggle")).toHaveAttribute("aria-expanded", "false");
				}
				// Focus moving out of More closes it, so clear focus rings by blurring instead.
				await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
				const states = await chromeStates(page);
				await page.screenshot({
					path: testInfo.outputPath(`guided-chrome-open-${width}-${locale}-${larger}.png`),
				});
				// More and the modal's actions are compared in their separate visible states.
				const on = Array.from(
					new Map(
						[...menuStates, ...states]
							.filter((state) => state.on)
							.map((state) => [state.name, state]),
					).values(),
				);
				expect(on.map((state) => state.name)).toContain(locale === "fr" ? "Outils" : "Tools");
				const off = [...menuStates, ...states].filter(
					(state) => !state.on && !on.some((enabled) => enabled.name === state.name),
				);
				expect(on.map((state) => state.name)).toEqual(
					expect.arrayContaining([
						followName,
						advanceName,
						locale === "fr" ? "Transcription" : "Transcript",
					]),
				);
				expect(off.length).toBeGreaterThan(0);
				const toolsName = locale === "fr" ? "Outils" : "Tools";
				expect(on.find((state) => state.name === toolsName)?.marker).toBe("none");
				const {
					name: _onName,
					on: _onState,
					...onLook
				} = on.find((state) => state.name === followName)!;
				for (const { name, on: _state, ...look } of on.filter(
					(state) => state.name !== advanceName && state.name !== toolsName,
				))
					expect(look, name).toEqual(onLook);
				expect(onLook.shadow !== "none" || onLook.marker !== "none").toBe(true);
				for (const { name, on: _state, ...look } of off)
					expect(look.shadow === onLook.shadow && look.marker === onLook.marker, name).toBe(false);
				const indicator =
					onLook.shadow.match(/rgba?\([^)]*\)/)?.[0] ??
					onLook.marker.match(/rgba?\([^)]*\)/)?.[0] ??
					onLook.color;
				const surfaces = await page
					.locator("#deck-controls, #deck-script .deck-panel-heading")
					.evaluateAll((elements) =>
						elements.map((element) => {
							let node: Element | null = element;
							while (node) {
								const color = getComputedStyle(node).backgroundColor;
								if (!/rgba\(.*,\s*0\)$|transparent/.test(color)) return color;
								node = node.parentElement;
							}
							return "rgb(255, 255, 255)";
						}),
					);
				for (const surface of surfaces) {
					// Computed paints can be oklch or color(), so resolve through the browser.
					const [foreground, background] = await page.evaluate(
						({ indicator, surface }) => {
							const canvas = document.createElement("canvas");
							canvas.width = canvas.height = 1;
							const context = canvas.getContext("2d");
							if (!context) throw new Error("Missing canvas color conversion");
							return [indicator, surface].map((color) => {
								context.clearRect(0, 0, 1, 1);
								context.fillStyle = color;
								context.fillRect(0, 0, 1, 1);
								return `rgb(${Array.from(context.getImageData(0, 0, 1, 1).data)
									.slice(0, 3)
									.join(",")})`;
							});
						},
						{ indicator, surface },
					);
					expect(
						contrast(foreground, background),
						`${indicator} on ${surface}`,
					).toBeGreaterThanOrEqual(3);
				}

				// The same control changes only by state, and forced colors keep the cue.
				const advance = page.locator("#deck-advance");
				if (width < 600) await page.locator("#deck-sidebar-close").click();
				await revealDeckTool(page, advance);
				await expect(advance).toHaveAttribute("role", "switch");
				const thumb = advance.locator(".deck-utility-icon circle");
				const onInset = await thumb.evaluate((element) => element.getBoundingClientRect().left);
				await advance.click();
				await expect(advance).toHaveAttribute("aria-checked", "false");
				const offInset = await thumb.evaluate((element) => element.getBoundingClientRect().left);
				expect(
					onInset - offInset,
					"switch thumb changes position, including without colour",
				).toBeGreaterThanOrEqual(12);
				await advance.evaluate((element) => element.blur());
				const advanceOff = (await chromeStates(page)).find((state) => state.name === advanceName);
				expect(advanceOff?.on).toBe(false);
				expect(advanceOff?.shadow === onLook.shadow && advanceOff?.marker === onLook.marker).toBe(
					false,
				);
				await page.screenshot({
					path: testInfo.outputPath(`guided-chrome-${width}-${locale}-${larger}.png`),
				});
				if (testInfo.project.name === "chromium") {
					await page.emulateMedia({ forcedColors: "active" });
					for (const state of await chromeStates(page))
						expect(state.outline !== "none", `${state.name} forced colors, on=${state.on}`).toBe(
							state.on,
						);
				}
			});
		}
	}
}

for (const width of [390, 1280]) {
	test(`outline titles share one start edge beside activity icons at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(base + entry);
		await clickDeckTool(page, "#deck-outline-toggle");
		const links = page.locator("#deck-outline a[data-deck-page]:not(.deck-module-link)");
		await expect(links.first()).toBeVisible();
		const geometry = await links.evaluateAll((elements) =>
			elements.map((link) => {
				const icon = link.querySelector("span[title]:not([data-deck-lock])");
				const label = link.querySelector("span:not([title], [data-deck-lock])");
				if (!label) throw new Error("Outline entry needs a label");
				return {
					label: label.getBoundingClientRect().left,
					icon: icon?.getBoundingClientRect().right,
				};
			}),
		);
		expect(geometry.some((entry) => entry.icon !== undefined)).toBe(true);
		expect(geometry.some((entry) => entry.icon === undefined)).toBe(true);
		for (const entry of geometry) {
			expect(entry.label).toBeCloseTo(geometry[0].label, 0);
			if (entry.icon !== undefined) expect(entry.icon).toBeLessThanOrEqual(entry.label);
		}
	});
}
