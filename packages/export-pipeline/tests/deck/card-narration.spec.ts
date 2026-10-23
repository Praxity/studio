import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { readLesson as readBlockSource } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { type CourseExportInput, compileCourse, deployCourse } from "../../src/build";

let server: Server;
let base: string;
const entries = new Map<string, string>();
const files = new Map<string, Buffer>();
const variants = ["single", "grid", "deck", "nested", "reentry", "heading-only"] as const;

test.beforeAll(async () => {
	test.setTimeout(120_000);
	const bytes = await readFile(
		resolve(import.meta.dirname, "../../../../docs/test-fixtures/assets/narration-sample.mp3"),
	);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (input, options) =>
		String(input).startsWith("https://card-audio.example/")
			? Promise.resolve(new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } }))
			: originalFetch(input, options);
	try {
		for (const variant of variants) {
			const course: CourseExportInput = {
				id: `cards-${variant}`,
				title: "Narrated cards",
				sourceLocale: "en",
				navigationStyle: "slides",
				...(["deck", "reentry"].includes(variant) ? { moduleDeck: {} } : {}),
				content: [
					{
						id: "card-page",
						title: "Narrated cards",
						narrationEnabled: true,
						lessonId: "cards",
						lessonTitle: "Cards",
						isFirstPageOfLesson: true,
						data: { narrationDisabled: true },
						blocks: [
							{
								id: "cards",
								type: "card",
								data: {
									layout: variant === "grid" ? "grid" : "single",
									columns: 2,
									shuffle: true,
									trackCompletion: variant !== "grid",
									advance: 1,
									showProgress: true,
									items: [0, 1].map((index) => ({
										id: `item-${index}`,
										backId: `face-${index}`,
										label: "Repeated label",
										front: [
											{
												id: `front-${index}`,
												type: "text",
												data: { content: "<p>Repeated front.</p>" },
											},
										],
										back: [
											{
												id: `back-${index}`,
												type: "text",
												data: { content: "<p>Repeated back.</p>" },
											},
										],
										narrationAudio: `https://card-audio.example/front-${index}.mp3`,
										narrationDuration: 10,
										narrationBack: {
											narrationAudio: `https://card-audio.example/back-${index}.mp3`,
											narrationDuration: 10,
										},
									})),
								},
							},
						],
					},
				],
			};
			if (variant === "heading-only") {
				course.content[0].narrationEnabled = false;
				course.content[0].blocks = readBlockSource(
					"# Untitled {hideTitle}\n\n::: cards {columns=2}\n:: First question\n\n::: back\nFirst answer.\n:::\n\n:: Second question\n\n::: back\nSecond answer.\n:::\n:::\n",
				).pages[0].blocks;
			}
			if (variant === "reentry") {
				course.deckDesign = { autoAdvance: true };
				course.content[0].isFirstPageOfLesson = false;
				course.content[0].blocks.unshift({
					id: "card-intro",
					type: "text",
					data: {
						content: "Here are the cards.",
						narrationAudio: "https://card-audio.example/card-intro.mp3",
						narrationDuration: 10,
					},
				});
				course.content.unshift({
					id: "previous-page",
					title: "Previous slide",
					narrationEnabled: true,
					lessonId: "cards",
					lessonTitle: "Cards",
					isFirstPageOfLesson: true,
					data: { narrationDisabled: true },
					blocks: [
						{
							id: "previous-text",
							type: "text",
							data: {
								content: "The previous slide.",
								narrationAudio: "https://card-audio.example/previous.mp3",
								narrationDuration: 10,
							},
						},
					],
				});
			}
			if (variant === "nested") {
				const items = course.content[0].blocks[0].data.items as Record<string, unknown>[];
				delete items[0].narrationBack;
				items[0].back = [
					{
						id: "inner",
						type: "card",
						data: {
							layout: "single",
							items: [
								{
									id: "inner-item",
									backId: "inner-back-face",
									label: "Nested card",
									front: [{ id: "inner-front", type: "text", data: { content: "Nested front." } }],
									back: [{ id: "inner-back", type: "text", data: { content: "Nested back." } }],
									narrationAudio: "https://card-audio.example/inner-front.mp3",
									narrationDuration: 10,
									narrationBack: {
										narrationAudio: "https://card-audio.example/inner-back.mp3",
										narrationDuration: 10,
									},
								},
							],
						},
					},
				];
			}
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
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	server = createServer((req, res) => {
		const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
		const file = files.get(pathname);
		if (!file) {
			res.writeHead(404).end();
			return;
		}
		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			mp3: "audio/mpeg",
			json: "application/json",
			woff2: "font/woff2",
		};
		res.setHeader(
			"Content-Type",
			types[pathname.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		res.end(file);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

for (const variant of ["single", "grid", "deck"] as const) {
	test(`${variant}: narration reads exact shuffled prompts and waits for learner commitment`, async ({
		page,
	}) => {
		await page.clock.install();
		// Hold playback still; advance using the actual media ended event.
		await page.addInitScript(() => {
			HTMLMediaElement.prototype.play = async () => {};
		});
		await page.goto(base + entries.get(variant));
		if (variant === "deck")
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		else await page.getByRole("button", { name: "Listen", exact: true }).click();
		const root = page.locator('[data-card-root][data-block-id="cards"]');
		const first = root.locator('[data-card-item][data-card-index="0"]');
		const second = root.locator('[data-card-item][data-card-index="1"]');
		const transport = page.locator(".praxity-narration-transport button");
		await transport.click();
		await expect(first).toBeVisible();
		await expect(first).toHaveAttribute("data-flipped", "false");
		await expect(root).toHaveAttribute("data-narration-playing", "true");
		await page
			.locator("[data-narration-player]")
			.evaluate((audio) => audio.dispatchEvent(new Event("ended")));
		await expect(transport).toHaveAttribute("aria-label", "Play");
		await expect(first).toHaveAttribute("data-flipped", "false");
		await expect(first.locator('[data-card-side="front"]')).toBeVisible();
		await expect(first.locator('[data-card-side="back"]')).toBeHidden();
		if (variant !== "grid") await expect(root).toHaveAttribute("data-completed", "false");
		// Authored autoplay stays retired after narration stops.
		await page.clock.runFor(1200);
		await expect(first).toBeVisible();
		await expect(first).toHaveAttribute("data-flipped", "false");
		await first.getByRole("button", { name: "I have my answer" }).click();
		await expect(first.locator('[data-card-side="back"]')).toBeVisible();
		if (variant !== "grid") await expect(root).toHaveAttribute("data-flipped-count", "1");
		await transport.click();
		await expect(transport).toHaveAttribute("aria-label", "Pause");
		await expect(page.locator("[data-narration-player]")).toHaveAttribute("src", /back-0/);
		await page
			.locator("[data-narration-player]")
			.evaluate((audio) => audio.dispatchEvent(new Event("ended")));
		await expect(second).toBeVisible();
		await expect(second).toHaveAttribute("data-flipped", "false");
		await expect(page.locator("[data-narration-player]")).toHaveAttribute("src", /front-1/);
		await page
			.locator("[data-narration-player]")
			.evaluate((audio) => audio.dispatchEvent(new Event("ended")));
		await expect(transport).toHaveAttribute("aria-label", "Play");
		await expect(second.locator('[data-card-side="back"]')).toBeHidden();
		await second.getByRole("button", { name: "I have my answer" }).click();
		await expect(second).toHaveAttribute("data-flipped", "true");
		if (variant !== "grid") await expect(root).toHaveAttribute("data-completed", "true");
		await page.clock.runFor(1200);
		await expect(second).toBeVisible();
		await transport.click();
		await expect(page.locator("[data-narration-player]")).toHaveAttribute("src", /back-1/);
		await expect(second.locator('[data-card-side="back"]')).toBeVisible();
		await expect(transport).toHaveAttribute("aria-label", "Pause");
		await transport.click();
		await expect(root).not.toHaveAttribute("data-narration-playing", "true");
		// Paused reverse seeking reveals the front without restarting audio.
		const seek = page.getByRole("slider", { name: "Position in narration" });
		await seek.focus();
		await page.keyboard.press("Home");
		await expect(first).toHaveAttribute("data-flipped", "false");
		await expect(transport).toHaveAttribute("aria-label", "Play");
	});
}

for (const cancel of [false, true]) {
	test(`delayed card runtime ${cancel ? "cancels" : "replays"} the latest prompt request`, async ({
		page,
	}) => {
		let release = () => {};
		const ready = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(/\/island-card-[^/]+\.js$/, async (route) => {
			await ready;
			await route.continue();
		});
		await page.addInitScript(() => {
			HTMLMediaElement.prototype.play = async () => {};
		});
		try {
			await page.goto(base + entries.get("single"), { waitUntil: "domcontentloaded" });
			await page.getByRole("button", { name: "Listen", exact: true }).click();
			await page.locator(".praxity-narration-transport button").click();
			const root = page.locator('[data-card-root][data-block-id="cards"]');
			await expect(root).toHaveAttribute("data-narration-pending-side", "front");
			if (cancel) {
				await page.getByRole("button", { name: "Follow narration", exact: true }).click();
				await expect(root).not.toHaveAttribute("data-narration-pending-side", /.+/);
			}
			release();
			await expect(root).toHaveAttribute("data-card-enhanced", "true");
			await expect(root.locator('[data-card-item][data-card-index="0"]')).toHaveAttribute(
				"data-flipped",
				"false",
			);
			await expect(root).not.toHaveAttribute("data-narration-pending-side", /.+/);
		} finally {
			release();
		}
	});
}

test("nested narration waits for each ancestor commitment and reverse seek returns to the prompt", async ({
	page,
}) => {
	await page.addInitScript(() => {
		HTMLMediaElement.prototype.play = async () => {};
	});
	await page.goto(base + entries.get("nested"));
	await page.getByRole("button", { name: "Listen", exact: true }).click();
	const transport = page.locator(".praxity-narration-transport button");
	await transport.click();
	const outer = page.locator(
		'[data-card-root][data-block-id="cards"] > .praxity-slides-grid > .praxity-slides-item > [data-card-index="0"]',
	);
	const inner = page.locator('[data-card-root][data-block-id="inner"] [data-card-item]');
	await expect(outer).toHaveAttribute("data-flipped", "false");
	await page
		.locator("[data-narration-player]")
		.evaluate((audio) => audio.dispatchEvent(new Event("ended")));
	await expect(transport).toHaveAttribute("aria-label", "Play");
	await expect(outer).toHaveAttribute("data-flipped", "false");
	await outer.locator(":scope > .praxity-flashcard-inner > [data-card-flip]").click();
	await transport.click();

	await expect(outer).toHaveAttribute("data-flipped", "true");
	await expect(inner).toHaveAttribute("data-flipped", "false");
	await page
		.locator("[data-narration-player]")
		.evaluate((audio) => audio.dispatchEvent(new Event("ended")));
	await expect(transport).toHaveAttribute("aria-label", "Play");
	await expect(inner).toHaveAttribute("data-flipped", "false");
	await inner.getByRole("button", { name: "I have my answer" }).click();
	await transport.click();

	await expect(inner).toHaveAttribute("data-flipped", "true");
	await expect(transport).toHaveAttribute("aria-label", "Pause");
	await transport.click();
	await expect(transport).toHaveAttribute("aria-label", "Play");
	await page.getByRole("slider", { name: "Position in narration" }).focus();
	await page.keyboard.press("Home");
	await expect(outer).toHaveAttribute("data-flipped", "false");
	await expect(transport).toHaveAttribute("aria-label", "Play");
});

test("reentering a slide through narration resets browsed cards before its introduction", async ({
	page,
}) => {
	await page.addInitScript(() => {
		HTMLMediaElement.prototype.play = async () => {};
	});
	await page.goto(base + entries.get("reentry"));
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-next").click();
	const root = page.locator('[data-card-root][data-block-id="cards"]');
	await expect(root).toHaveAttribute("data-card-enhanced", "true");
	await root.locator('[data-card-goto="1"]').click();
	const browsed = root.locator('.praxity-slides-item[data-active="true"] [data-card-item]');
	await browsed.locator("[data-card-flip]").click();
	await expect(browsed).toHaveAttribute("data-flipped", "true");
	const flippedCount = await root.getAttribute("data-flipped-count");
	await page.locator("#deck-previous").click();
	const transport = page.locator(".praxity-narration-transport button");
	await transport.click();
	await expect(transport).toHaveAttribute("aria-label", "Pause");
	await page
		.locator("[data-narration-player]")
		.evaluate((audio) => audio.dispatchEvent(new Event("ended")));
	await expect(page.locator('[data-deck-slide="card-page"]')).toBeVisible();
	const first = root.locator('[data-card-item][data-card-index="0"]');
	await expect(first).toBeVisible();
	await expect(first).toHaveAttribute("data-flipped", "false");
	await expect(root.locator('[data-card-item][data-flipped="true"]')).toHaveCount(0);
	await expect(root).toHaveAttribute("data-flipped-count", flippedCount ?? "");
	await expect(page.locator('[data-deck-segment][aria-current="true"]')).toContainText(
		"Here are the cards.",
	);
});

test("scrolling slide content keeps narration playing with Follow intact", async ({ page }) => {
	await page.addInitScript(() => {
		HTMLMediaElement.prototype.play = async () => {};
	});
	await page.goto(base + entries.get("deck"));
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("[data-card-root]").evaluate((root) => {
		(root as HTMLElement).style.minHeight = "1800px";
	});
	const transport = page.locator(".praxity-narration-transport button");
	await transport.click();
	await expect(transport).toHaveAttribute("aria-label", "Pause");
	const main = page.locator("#main-content");
	const bounds = await main.boundingBox();
	if (!bounds) throw new Error("Expected slide scrollport");
	await page.mouse.move(bounds.x + 5, bounds.y + 80);
	await page.mouse.wheel(0, 300);
	await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await expect(transport).toHaveAttribute("aria-label", "Pause");
	await expect(page.locator("#deck-follow")).toHaveAttribute("aria-pressed", "true");
});

test("standalone heading-only cards keep separate fronts and reveal answers with the keyboard", async ({
	page,
}) => {
	await page.goto(base + entries.get("heading-only"));
	const root = page.locator("[data-card-root]");
	await expect(root).toHaveAttribute("data-card-enhanced", "true");
	const cards = root.locator("[data-card-item]");
	await expect(cards).toHaveCount(2);
	for (const [index, label] of ["First", "Second"].entries()) {
		const card = cards.nth(index);
		await expect(card).toHaveAttribute("data-flipped", "false");
		await expect(card.getByRole("heading", { name: `${label} question`, level: 2 })).toBeVisible();
		await expect(card.locator('[data-card-side="back"]')).toHaveAttribute("inert", "");
	}
	const first = cards.first();
	const toggle = first.locator("[data-card-flip]");
	await toggle.focus();
	await page.keyboard.press("Enter");
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	await expect(first.getByRole("heading", { name: "First question", level: 2 })).toBeVisible();
	await expect(first.locator('[data-card-side="front"]')).not.toHaveAttribute("inert", "");
	await expect(first.locator('[data-card-side="back"]')).not.toHaveAttribute("inert", "");
	await expect(first.getByText("First answer.", { exact: true })).toBeVisible();
	await expect(cards.nth(1)).toHaveAttribute("data-flipped", "false");
	await page.keyboard.press("Space");
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await expect(first.getByRole("heading", { name: "First question", level: 2 })).toBeVisible();
});
