import { createServer, type Server } from "node:http";
import { expect, type Locator, type Page } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { resolveNarrationV2 } from "@praxity/shared-blocks/narration";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import { type CourseExportInput, compileCourse, deployCourse } from "../../src/build";
import { serveFixtureBytes } from "../fixtures/http-bytes";
import { silentWav } from "../fixtures/silent-audio";
import { test } from "../muted-test";

let server: Server;
let base: string;
const entries = new Map<string, string>();

function cards(id: string, advance = 1, count = 3): PraxityBlock {
	return {
		id,
		type: "card",
		data: {
			layout: "single",
			advance,
			showProgress: true,
			transition: "slide",
			items: Array.from({ length: count }, (_, index) => ({
				id: `${id}-${index}`,
				label: `Card ${index + 1}`,
				front: [
					{
						id: `${id}-text-${index}`,
						type: "text",
						data: { content: `<p>Prompt ${index + 1}. <a href="#main-content">Review</a></p>` },
					},
				],
				back: [],
			})),
		},
	};
}

test.beforeAll(async () => {
	const files = new Map<string, Buffer>();
	for (const variant of [
		"en",
		"fr",
		"guided",
		"cue",
		"whole-cue",
		"unnarrated",
		"nested",
		"invalid",
	]) {
		const guided = variant === "guided" || variant.endsWith("cue");
		const block = cards("cards");
		if (variant === "nested") {
			const items = block.data.items as Array<{ front: PraxityBlock[] }>;
			items[0].front.push(cards("inner-cards"));
		}
		const course: CourseExportInput = {
			id: `playthrough-${variant}`,
			title: "Card playthrough",
			sourceLocale: variant === "fr" ? "fr" : "en",
			...(guided || variant === "unnarrated"
				? { moduleDeck: {}, deckDesign: { autoAdvance: true } }
				: {}),
			content: [
				{
					id: "start",
					title: "Card playthrough",
					lessonId: "lesson",
					lessonTitle: "Cards",
					isFirstPageOfLesson: true,
					narrationEnabled: guided,
					data:
						variant === "guided"
							? { narrationAudio: "https://playthrough.example/voice.wav", narrationDuration: 60 }
							: { narrationDisabled: true },
					blocks:
						variant === "invalid"
							? [
									cards("zero", 0),
									cards("one", 1, 1),
									{ ...cards("grid"), data: { ...cards("grid").data, layout: "grid" } },
								]
							: [block],
				},
				...(guided
					? [
							{
								id: "silent",
								title: "Silent slide",
								lessonId: "lesson",
								lessonTitle: "Cards",
								narrationEnabled: false,
								blocks: [cards("silent-cards")],
							},
							{
								id: "missing",
								title: "Missing audio",
								lessonId: "lesson",
								lessonTitle: "Cards",
								narrationEnabled: true,
								blocks: [cards("missing-cards")],
							},
						]
					: []),
			],
		};
		if (variant.endsWith("cue")) {
			let identity = 0;
			const read = readLesson(
				"# Cue cards\n\n::: cards {layout=slides advance=1}\n:: First\nPrompt one.\n:: Second\nPrompt two.\n:: Third\nPrompt three.\n:::\n",
				{ ids: () => `00000000-0000-4000-8000-${String(++identity).padStart(12, "0")}` },
			);
			expect(read.hasErrors).toBe(false);
			const cueCards = read.pages[0].blocks.find((candidate) => candidate.type === "card");
			if (!cueCards) throw new Error("Missing cue card fixture");
			const resolved = resolveNarrationV2({
				courseId: course.id,
				lessonId: "lesson",
				pages: read.pages,
				sidecar: {
					version: 2,
					courseId: course.id,
					lessons: {
						lesson: {
							enabled: true,
							segments: [
								{ target: { id: read.pages[0].id, role: "title" }, disabled: true },
								...(variant === "whole-cue"
									? [
											{
												target: { id: cueCards.id, role: "body" as const },
												audio: "https://playthrough.example/voice.wav",
												timings: "https://playthrough.example/cards.vtt",
												duration: 60,
											},
										]
									: (cueCards.data.items as Array<{ id: string }>).map((item) => ({
											target: { id: item.id, role: "front" as const },
											audio: "https://playthrough.example/voice.wav",
											duration: 60,
										}))),
							],
						},
					},
				},
				locale: "en",
				digest: (text) => text,
			});
			expect(resolved.unresolved).toEqual([]);
			course.content = read.pages.map((cuePage, index) => ({
				...cuePage,
				lessonId: "lesson",
				narrationEnabled: true,
				data: { ...cuePage.data, _narrationSegments: resolved.pages[index].segments },
			}));
		}
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (input, options) =>
			String(input).startsWith("https://playthrough.example/")
				? Promise.resolve(
						String(input).endsWith(".vtt")
							? new Response(
									"WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nPrompt one.\n\n00:00:03.000 --> 00:00:06.000\nPrompt two.\n\n00:00:06.000 --> 00:01:00.000\nPrompt three.\n",
									{ headers: { "Content-Type": "text/vtt" } },
								)
							: new Response(new Uint8Array(silentWav(60)), {
									headers: { "Content-Type": "audio/wav" },
								}),
					)
				: originalFetch(input, options);
		try {
			const artifact = await compileCourse(course, { mode: "source" });
			try {
				const result = await deployCourse(artifact, { format: "html" });
				if (!("zip" in result)) throw new Error("Expected HTML package");
				for (const file of new AdmZip(result.zip).getEntries()) {
					if (!file.isDirectory) files.set(`/${variant}/${file.entryName}`, file.getData());
				}
				entries.set(variant, `/${variant}/${artifact.manifest.pages[0].slug}.html`);
			} finally {
				await artifact.dispose();
			}
		} finally {
			globalThis.fetch = originalFetch;
		}
	}
	server = createServer((req, res) => {
		const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
		const file = files.get(pathname);
		if (!file) return void res.writeHead(404).end();
		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			wav: "audio/wav",
			vtt: "text/vtt",
			json: "application/json",
			woff2: "font/woff2",
		};
		res.setHeader(
			"Content-Type",
			types[pathname.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		serveFixtureBytes(req, res, file);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing server address");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

async function open(page: Page, variant = "en") {
	await page.clock.install({ time: new Date("2026-01-01T08:00:00Z") });
	await page.clock.pauseAt(new Date("2026-01-01T08:01:00Z"));
	// The transport's real state machine runs; its media clock is held still.
	await page.addInitScript(() => {
		HTMLMediaElement.prototype.play = async () => {};
	});
	await page.goto(base + entries.get(variant));
	const root = page.locator("[data-card-root]").first();
	await root.scrollIntoViewIfNeeded();
	await expect(root).toHaveAttribute("data-card-enhanced", "true");
	if (variant === "guided" || variant.endsWith("cue") || variant === "unnarrated")
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	return root;
}

async function position(root: Locator, current: number) {
	await expect(root.locator("[data-card-counter]")).toHaveText(`${current} / 3`);
}

test("Pages and narrated Guided stay on the first card before learner Play", async ({ page }) => {
	for (const variant of ["en", "guided"]) {
		const root = await open(page, variant);
		await page.clock.runFor(2200);
		await position(root, 1);
	}
});

for (const locale of ["en", "fr"]) {
	test(`${locale}: Play makes one pass, announces once per turn, retains focus and restarts from the first`, async ({
		page,
	}) => {
		const root = await open(page, locale);
		const play = root.getByRole("button", {
			name: locale === "en" ? "Play cards" : "Lire les cartes",
			exact: true,
		});
		const pauseName = locale === "en" ? "Pause cards" : "Mettre les cartes en pause";
		await expect(play).not.toHaveAttribute("aria-pressed");
		const box = await play.boundingBox();
		expect(box?.width).toBeGreaterThanOrEqual(44);
		expect(box?.height).toBeGreaterThanOrEqual(44);
		await page.evaluate(() => {
			const messages: string[] = [];
			Object.assign(window, { cardMessages: messages });
			const live = document.getElementById("praxity-live-region");
			if (!live) throw new Error("Missing live region");
			new MutationObserver(() => messages.push(live.textContent ?? "")).observe(live, {
				childList: true,
				characterData: true,
				subtree: true,
			});
		});
		await play.press("Enter");
		const button = root.getByRole("button", { name: pauseName, exact: true });
		await expect(button).toBeFocused();
		await page.clock.runFor(999);
		await position(root, 1);
		await page.clock.runFor(1);
		await position(root, 2);
		await expect(button).toBeFocused();
		await page.clock.runFor(1000);
		await position(root, 3);
		await expect(play).toBeFocused();
		await page.clock.runFor(2500);
		await position(root, 3);
		expect(
			await page.evaluate(() => (window as Window & { cardMessages?: string[] }).cardMessages),
		).toEqual(
			locale === "en" ? ["Card 2 of 3", "Card 3 of 3"] : ["Carte 2 sur 3", "Carte 3 sur 3"],
		);
		await play.press("Space");
		await position(root, 1);
		await expect(root.getByRole("button", { name: pauseName, exact: true })).toBeFocused();
		await page.clock.runFor(1000);
		await position(root, 2);
	});
}

test("Pause and every manual card move stop the pass; Play starts from the current card", async ({
	page,
}) => {
	const root = await open(page);
	const toggle = root.locator("[data-card-play]");
	await expect(toggle).toHaveAccessibleName("Play cards");
	for (const move of ["pause", "next", "previous", "dot", "keyboard"]) {
		await root.locator("[data-card-goto]").first().click();
		await toggle.click();
		await page.clock.runFor(1000);
		await position(root, 2);
		if (move === "pause") await toggle.click();
		else if (move === "next") await root.locator("[data-card-next]").click();
		else if (move === "previous") await root.locator("[data-card-previous]").click();
		else if (move === "dot") await root.locator("[data-card-goto]").first().click();
		else await root.press("ArrowLeft");
		await expect(toggle).toHaveAccessibleName("Play cards");
		await page.clock.runFor(2200);
		await position(root, move === "next" ? 3 : move === "pause" ? 2 : 1);
	}
	await root.locator("[data-card-next]").click();
	await toggle.click();
	await position(root, 2);
	await page.clock.runFor(1000);
	await position(root, 3);
});

test("automatic turns preserve focus in card content and at a disabling Next boundary", async ({
	page,
}) => {
	const root = await open(page);
	await root.getByRole("button", { name: "Play cards", exact: true }).click();
	const link = root.locator('[data-active="true"]').getByRole("link");
	await link.focus();
	await page.clock.runFor(2200);
	await expect(link).toBeFocused();
	await position(root, 1);
	await root.getByRole("button", { name: "Play cards", exact: true }).click();
	await page.clock.runFor(1000);
	await position(root, 2);
	const next = root.locator("[data-card-next]");
	await next.focus();
	await page.clock.runFor(2200);
	await expect(next).toBeFocused();
	await position(root, 2);
});

test("Guided follows narration playback, pause, fresh resume wait, end and the Transcript advancement setting", async ({
	page,
}) => {
	const root = await open(page, "guided");
	await expect(root.locator("[data-card-play]")).toHaveCount(0);
	const transport = page.locator(".praxity-narration-transport button");
	await transport.press("Enter");
	await expect(transport).toHaveAccessibleName("Pause");
	await page.clock.runFor(1000);
	await position(root, 2);
	await transport.press("Enter");
	await expect(transport).toHaveAccessibleName("Play");
	await page.clock.runFor(2200);
	await position(root, 2);
	await transport.press("Enter");
	await expect(transport).toHaveAccessibleName("Pause");
	await page.clock.runFor(999);
	await position(root, 2);
	await page.clock.runFor(1);
	await position(root, 3);
	await page.clock.runFor(2200);
	await position(root, 3);
	await transport.press("Enter");
	await root.locator("[data-card-goto]").first().click();
	await transport.press("Enter");
	await expect(transport).toHaveAccessibleName("Pause");
	const transcript = page.locator("#deck-script-toggle");
	if (!(await transcript.isVisible())) await page.locator("#deck-more-toggle").click();
	await transcript.click();
	// Opening Transcript closes More, which owns the automatic-advance switch.
	await page.locator("#deck-more-toggle").click();
	await expect(page.locator("#deck-advance")).toBeVisible();
	await page.locator("#deck-advance").click();
	await expect(page.locator("#deck-advance")).toHaveAttribute("aria-checked", "false");
	await page.clock.runFor(2200);
	await position(root, 1);
	await expect(transport).toHaveAccessibleName("Pause");
	await page.locator("#deck-advance").click();
	await page
		.locator("[data-narration-player]")
		.evaluate((audio) => audio.dispatchEvent(new Event("ended")));
	await page.clock.runFor(2200);
	await position(root, 1);
});

test("Guided unnarrated and missing-audio slides get learner Play controls", async ({ page }) => {
	await open(page, "guided");
	for (const id of ["silent", "missing"]) {
		await page.locator("#deck-next").click();
		const root = page.locator(`[data-card-root][data-block-id="${id}-cards"]`);
		await expect(root).toHaveAttribute("data-card-enhanced", "true");
		await expect(root).toBeVisible();
		await expect(root.getByRole("button", { name: "Play cards", exact: true })).toBeVisible();
		await root.getByRole("button", { name: "Play cards", exact: true }).press("Enter");
		await page.clock.runFor(1000);
		await position(root, 2);
	}
});

test("v2 sidecar card-target narration cues take precedence over advance", async ({ page }) => {
	const root = await open(page, "cue");
	await expect(root.locator("[data-card-play]")).toHaveCount(0);
	await page.locator(".praxity-narration-transport button").click();
	await expect(page.locator(".praxity-narration-transport button")).toHaveAccessibleName("Pause");
	await page.clock.runFor(2200);
	await position(root, 1);
	await page
		.locator("[data-narration-player]")
		.evaluate((audio) => audio.dispatchEvent(new Event("ended")));
	await position(root, 2);
	await page.clock.runFor(2200);
	await position(root, 2);
});

test("whole-card v2 word timings leave the narration-driven playthrough active", async ({
	page,
}) => {
	const root = await open(page, "whole-cue");
	await expect(root.locator("[data-card-play]")).toHaveCount(0);
	const transport = page.locator(".praxity-narration-transport button");
	await transport.press("Enter");
	await expect(transport).toHaveAccessibleName("Pause");
	await page.clock.runFor(999);
	await position(root, 1);
	await page.clock.runFor(1);
	await position(root, 2);
	await page.clock.runFor(2200);
	await position(root, 3);
});

test("wholly unnarrated Guided decks get a bounded learner-started pass", async ({ page }) => {
	const root = await open(page, "unnarrated");
	const play = root.getByRole("button", { name: "Play cards", exact: true });
	await expect(play).toBeVisible();
	await page.clock.runFor(2200);
	await position(root, 1);
	await play.press("Enter");
	await page.clock.runFor(1000);
	await position(root, 2);
	await page.clock.runFor(1000);
	await position(root, 3);
	await expect(play).toBeFocused();
	await page.clock.runFor(2200);
	await position(root, 3);
});

test("nested cards keep each playthrough's controls and position in its own deck", async ({
	page,
}) => {
	const root = await open(page, "nested");
	const controls = root.locator(":scope > .praxity-card-controls");
	const play = controls.locator("[data-card-play]");
	await expect(play).toBeVisible();
	await expect(play).toHaveAccessibleName("Play cards");
	const inner = root.locator('[data-card-root][data-block-id="inner-cards"]');
	await expect(inner).toHaveAttribute("data-card-enhanced", "true");
	await play.press("Enter");
	await page.clock.runFor(1000);
	await expect(controls.locator("[data-card-counter]")).toHaveText("2 / 3");
	await position(inner, 1);
	await expect(play).toHaveAccessibleName("Pause cards");
	await expect(play).toBeFocused();
	await page.clock.runFor(1000);
	await expect(controls.locator("[data-card-counter]")).toHaveText("3 / 3");
	await expect(play).toHaveAccessibleName("Play cards");
	await expect(play).toBeFocused();
});

test("reduced-motion playthrough turns instantly", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const root = await open(page);
	await root.getByRole("button", { name: "Play cards", exact: true }).click();
	await page.clock.runFor(1000);
	await position(root, 2);
	const current = root.locator('[data-active="true"]');
	await expect(current).toHaveCSS("transition-duration", "0s");
	await expect(current).toHaveCSS("transform", "none");
});

test("print and no-JS expose all cards without a Play control", async ({ page, browser }) => {
	const root = await open(page);
	await page.emulateMedia({ media: "print" });
	await expect(root.locator("[data-card-play]")).toBeHidden();
	for (const card of await root.locator("[data-card-item]").all()) await expect(card).toBeVisible();
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const staticPage = await context.newPage();
		await staticPage.goto(base + entries.get("en"));
		await expect(staticPage.locator("[data-card-play]")).toHaveCount(0);
		for (const card of await staticPage.locator("[data-card-item]").all())
			await expect(card).toBeVisible();
	} finally {
		await context.close();
	}
});

test("zero advance, one card and grid layouts have no Play control", async ({ page }) => {
	await page.goto(base + entries.get("invalid"));
	for (const root of await page.locator("[data-card-root]").all()) {
		await root.scrollIntoViewIfNeeded();
		await expect(root).toHaveAttribute("data-card-enhanced", "true");
		await expect(root.locator("[data-card-play]")).toHaveCount(0);
	}
});
