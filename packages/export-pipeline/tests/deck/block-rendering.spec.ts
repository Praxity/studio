import { createServer, type Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { createTypography, readLesson } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";
import { analyzeAxe } from "../a11y/helpers";
import { moduleDeckFixture } from "../fixtures/module-deck";
import { expectFocusRing, expectUnclippedRing } from "../focus-assertions";
import { test } from "../muted-test";

let server: Server;
let base: string;
const entries = new Map<string, string>();
const files = new Map<string, Buffer>();
async function openTranscript(page: Page) {
	const toggle = page.locator("#deck-script-toggle");
	if (!(await toggle.isVisible())) await page.locator("#deck-more-toggle").click();
	await toggle.click();
}
const frenchNamesSource =
	"# Ponctuation française\n\n::: categorize Classez chaque énoncé : fait ou opinion ? {shuffle=false}\n:: Fait\n- Le rapport a été remis vendredi.\n:: Opinion\n- Je trouve que le rapport manque de détails.\n:::\n";
// Literal leadership content checks the design owner's two transcript layouts.
const leadershipSource =
	"# Vérifiez : quel style ?\n\n::: categorize Classez chaque réplique selon le style qu'elle illustre. {width=wide shuffle=false}\n:: Assertif\n- J'ai besoin du rapport jeudi pour le présenter vendredi. Est-ce réaliste pour toi ?\n- Je ne suis pas d'accord avec cette option. Voici pourquoi, et j'aimerais entendre ton point de vue.\n:: Agressif\n- C'est n'importe quoi. Tu n'as rien compris, comme d'habitude.\n:: Passif\n- Non, non, ce n'est pas grave, je vais rester ce soir pour finir ta partie.\n:: Passif-agressif\n- Merci d'être enfin arrivé. On commençait à croire que tu avais oublié la réunion.\n:::\n";
const source =
	"# Rendering examples\n\n::: cards Cards {columns=2 style=outline}\n:: Longer card\nA longer statement with several words. A longer statement with several words. A longer statement with several words. A longer statement with several words. A longer statement with several words. A longer statement with several words. A longer statement with several words. A longer statement with several words. A longer statement with several words. A longer statement with several words. A longer statement with several words. A longer statement with several words. \n\n::: back\nA useful response.\n:::\n\n:: Shorter card\nA short statement.\n\n::: back\nAnother response.\n:::\n:::\n\n::: categorize Choose a style {width=wide shuffle=false}\n:: Assertive\n- I explain what I need while respecting the other person.\n- I ask for a clear answer before deciding what to do next.\n:: Passive\n- I accept extra work without saying that I cannot take it on.\n:: Aggressive\n- I tell a colleague to stop talking and follow my instructions.\n:: Indirect\n- I agree in the meeting, then complain about the decision later.\n:::\n\n::: tabs\n:: Repetition\nRepeat the request calmly.\n\n:: Listening\nListen before speaking.\n:::\n\n::: sequence\n:: Describe the situation\nExplain what happened.\n\n- State the facts.\n  - Give a concrete example.\n- Avoid judging the person.\n\n:: Express the concern\nSay how it affects you.\n\n- Make a clear request.\n:::\n\n::: quote\nRespect builds trust.\nspeaker: Stephen Covey\n:::\n\n::: group Progress practice {mode=all}\nKeep your observations for later.\n::: match Match the stages {shuffle=false}\nThink about the first action.\n- Describe the situation -> Explain what happened\n- Express the concern -> Describe how it affects you\n:::\n::: match Match the responses {shuffle=false}\nConsider the response.\n- Ask clearly -> State the request\n- Listen carefully -> Let the person respond\n:::\n:::\n\n::: note Your learning journal\nKeep a journal during this course.\n:::\n\n::: comparison {layout=side-by-side}\n:: Première situation\nRoger speaks with conviction.\n\n:: Deuxième situation\nRoger listens and asks for the other person's opinion.\n:::\n";

test.beforeAll(async () => {
	for (const locale of ["en", "fr", "leadership", "names"]) {
		for (const colorMode of ["light", "dark"] as const) {
			if (["leadership", "names"].includes(locale) && colorMode === "dark") continue;
			const key = `${locale}-${colorMode}`;
			const course = moduleDeckFixture(
				undefined,
				["leadership", "names"].includes(locale) ? "fr" : locale,
			);
			course.id = `block-rendering-${key}`;
			course.colorMode = colorMode;
			// The specs give pixel expectations at a 16px root; shipped courses default to 17px.
			course.cssVars = {
				...course.cssVars,
				"--praxity-font-size-base": locale === "leadership" ? "17px" : "16px",
				// Supply the authored accent so the note does not use the bare CSS fallback.
				"--praxity-color-accent": colorMode === "dark" ? "#dc8fff" : "#6b21a8",
				...(locale === "leadership"
					? {
							"--praxity-max-width": "720px",
							"--praxity-font-family": '"Source Sans 3", sans-serif',
						}
					: {}),
			};
			if (locale === "leadership")
				course.typography = createTypography("Source Sans 3", "Source Serif 4");
			course.moduleDeck = { gates: {} };
			const blocks = adaptGrammarPreviewBlocks(
				readLesson(
					locale === "names"
						? frenchNamesSource
						: locale === "leadership"
							? leadershipSource
							: source,
				).pages[0].blocks,
			);
			// Stored group instructions form one narration segment with its title.
			// G4 has no instructions part, so project the converted prose into that model field.
			const groupIndex = blocks.findIndex((block) => block.type === "assessmentGroup");
			if (groupIndex >= 0) {
				const instructions = blocks[groupIndex + 1];
				if (instructions?.type !== "text") throw new Error("Missing group instructions");
				blocks[groupIndex].data.instructions = instructions.data.content;
				blocks.splice(groupIndex + 1, 1);
			}
			course.content = [
				{
					...course.content[0],
					...(locale === "names" ? { title: "Ponctuation française" } : {}),
					blocks,
				},
			];
			const artifact = await compileCourse(course, { mode: "source" });
			try {
				const output = await deployCourse(artifact, { format: "html" });
				if (!("zip" in output)) throw new Error("Expected HTML package");
				for (const entry of new AdmZip(output.zip).getEntries())
					if (!entry.isDirectory) files.set(`/${key}/${entry.entryName}`, entry.getData());
				entries.set(key, `/${key}/${artifact.manifest.pages[0].slug}.html`);
			} finally {
				await artifact.dispose();
			}
		}
	}
	server = createServer((req, res) => {
		const filename = new URL(req.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(filename);
		if (!bytes) {
			res.writeHead(404).end();
			return;
		}
		const extension = filename.split(".").at(-1) ?? "";
		res.setHeader(
			"Content-Type",
			(
				{
					html: "text/html",
					css: "text/css",
					js: "text/javascript",
					woff2: "font/woff2",
				} as Record<string, string>
			)[extension] ?? "application/octet-stream",
		);
		res.end(bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture port");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("French categorize legend exposes characters rather than entity text", async ({ page }) => {
	await page.goto(base + entries.get("names-light"));
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const group = page.locator("fieldset.praxity-categorize");
	await expect(group).toHaveAccessibleName("Classez chaque énoncé : fait ou opinion ?");
	expect(await group.ariaSnapshot()).not.toMatch(/&(?:nbsp|#\d+|#x[\da-f]+);/i);
	expect(await group.locator("legend").textContent()).toBe(
		"Classez chaque énoncé\u00a0: fait ou opinion\u202f?",
	);
});

test("slide containers expose named regions with readable content", async ({ page }) => {
	await page.goto(base + entries.get("names-light"));
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const slide = page.locator("[data-deck-slide]");
	await expect(slide).toHaveRole("region");
	await expect(slide).toHaveAccessibleName("Diapositive 1 sur 1");
	expect(await slide.ariaSnapshot()).toContain('region "Diapositive 1 sur 1"');
	await expect(slide.getByRole("radio").first()).toBeEnabled();
});

test.describe("reading without JavaScript", () => {
	test.use({ javaScriptEnabled: false });
	test("slide containers retain named regions and their question", async ({ page }) => {
		await page.goto(base + entries.get("names-light"));
		const slide = page.locator("[data-deck-slide]");
		await expect(slide).toHaveRole("region");
		await expect(slide).toHaveAccessibleName("Diapositive 1 sur 1");
		await expect(slide.getByRole("heading", { name: "Ponctuation française" })).toBeVisible();
		await expect(slide.getByRole("group")).toHaveAccessibleName(
			"Classez chaque énoncé : fait ou opinion ?",
		);
		const question = slide.locator(".praxity-assessment-stem-content");
		await expect(question).toBeVisible();
		expect(await question.textContent()).toBe(
			"Classez chaque énoncé\u00a0: fait ou opinion\u202f?",
		);
	});
});

test("sequence lists start with solid bullets and nested lists use hollow bullets", async ({
	page,
}) => {
	await page.goto(base + entries.get("en-light"));
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const lists = page.locator(".praxity-sequence-item ul");
	await lists.first().scrollIntoViewIfNeeded();
	expect(
		await lists.evaluateAll((elements) => elements.map((e) => getComputedStyle(e).listStyleType)),
	).toEqual(["disc", "circle", "disc"]);
});

test("comparison labels retain authored case and H3 size without a decorative rule", async ({
	page,
}) => {
	await page.goto(base + entries.get("fr-light"));
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const headers = page.locator(".praxity-column-preset-header");
	await expect(headers).toHaveText(["Première situation", "Deuxième situation"]);
	for (const header of await headers.all()) {
		await header.scrollIntoViewIfNeeded();
		await expect(header).toHaveCSS("text-transform", "none");
		await expect(header).toHaveCSS("font-size", "24px");
		await expect(header).toHaveCSS("font-weight", "600");
		await expect(header).toHaveCSS("letter-spacing", "normal");
		await expect(header).toHaveCSS("border-top-width", "0px");
	}
	expect((await analyzeAxe(page, new AxeBuilder({ page }))).violations).toEqual([]);
});

test("phone comparison keeps one top rule above the second heading", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(base + entries.get("fr-light"));
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const columns = page.locator('.praxity-columns[data-preset="comparison"] > .praxity-column');
	await expect(columns).toHaveCount(2);
	await expect(columns.last()).toHaveCSS("border-top-width", "1px");
	for (const heading of await columns.locator(".praxity-column-preset-header").all()) {
		await expect(heading).toHaveCSS("border-top-width", "0px");
		await expect(heading).toHaveCSS("border-bottom-width", "0px");
	}
});

test("group progress uses small text and matching prompts use body text without spacing clips", async ({
	page,
}) => {
	await page.goto(base + entries.get("en-light"));
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const progress = page.locator("[data-assessment-group-progress]");
	await progress.scrollIntoViewIfNeeded();
	await expect(progress).toHaveCSS("font-size", "15px");
	const prompts = page.locator(".praxity-matching-prompt");
	for (const question of await page
		.locator('.praxity-block[data-block-type="assessment"]:has(.praxity-matching-grid)')
		.all()) {
		await question.evaluate((element) => element.scrollIntoView({ block: "center" }));
		await expect(question).toHaveAttribute("data-hydrated", "");
		await expect(
			question.locator(".praxity-matching-select .praxity-assessment-select-input"),
		).toHaveCount(2);
	}
	await expect(prompts.first()).toHaveCSS("font-size", "19px");
	await page.addStyleTag({
		content:
			"* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }",
	});
	const controls = page.locator(".praxity-matching-select .praxity-assessment-select-input");
	await expect(controls).toHaveCount(4);
	for (const control of await controls.all()) {
		await control.scrollIntoViewIfNeeded();
		expect(await control.evaluate((e) => e.scrollHeight <= e.clientHeight)).toBe(true);
	}
	expect((await analyzeAxe(page, new AxeBuilder({ page }))).violations).toEqual([]);
});

test("transcript item titles and quote attributions retain slide reading order and flat headings", async ({
	page,
}) => {
	await page.goto(base + entries.get("en-light"));
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await openTranscript(page);
	const reading = page.locator('[data-deck-reading="slide-1"]');
	const titles = reading.locator("p.deck-script-item-title > strong");
	await expect(titles).toHaveText([
		"Longer card",
		"Shorter card",
		"Choose a style",
		"Repetition",
		"Listening",
		"Describe the situation",
		"Express the concern",
		"Progress practice",
		"Match the stages",
		"Match the responses",
		"Your learning journal",
	]);
	await expect(reading.locator("h1,h2,h3,h4,h5,h6")).toHaveCount(0);
	await expect(titles.first().locator("..")).toHaveCSS("font-size", "19px");
	await expect(titles.first().locator("..")).toHaveCSS("margin-block-start", "16px");
	await expect(titles.first().locator("..")).toHaveCSS("margin-block-end", "4px");
	const attribution = reading.locator("p.deck-script-quote-attribution");
	await expect(attribution).toHaveText("Stephen Covey");
	await expect(attribution).toHaveCSS("font-size", "15px");
	await expect(attribution.locator("..")).toHaveText("Respect builds trust.Stephen Covey");
	expect((await analyzeAxe(page, new AxeBuilder({ page }))).violations).toEqual([]);
});

for (const colorMode of ["light", "dark"]) {
	for (const width of [320, 1440]) {
		test(`transcript separates note and group titles and prompts at ${width}px in ${colorMode}`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(base + entries.get(`en-${colorMode}`));
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await openTranscript(page);
			const reading = page.locator('[data-deck-reading="slide-1"]');
			for (const [title, body] of [
				["Your learning journal", "Keep a journal during this course."],
				["Progress practice", "Keep your observations for later."],
				["Match the stages", "Think about the first action."],
				["Match the responses", "Consider the response."],
			]) {
				const heading = reading.locator("p.deck-script-item-title").filter({ hasText: title });
				await heading.scrollIntoViewIfNeeded();
				await expect(heading.locator("strong")).toHaveText(title);
				await expect(heading).toHaveCSS("margin-block-start", "16px");
				await expect(heading).toHaveCSS("margin-block-end", "4px");
				const following = heading.locator("xpath=following-sibling::*[1]");
				await expect(following).toContainText(body);
				const bounds = await heading.evaluate((element) => {
					const next = element.nextElementSibling;
					if (!next) throw new Error("Missing transcript body");
					return {
						titleBottom: element.getBoundingClientRect().bottom,
						bodyTop: next.getBoundingClientRect().top,
					};
				});
				expect(bounds.bodyTop).toBeGreaterThanOrEqual(bounds.titleBottom);
			}
			expect(await reading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
				true,
			);
			expect(
				(await analyzeAxe(page, new AxeBuilder({ page }).include("#deck-sidebar"))).violations,
			).toEqual([]);
		});
	}
}

for (const transcript of [false, true]) {
	test(`leadership categorize fits whole header words and ${transcript ? "three" : "two"} statement lines with transcript ${transcript ? "open" : "closed"}`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 860 });
		await page.goto(base + entries.get("leadership-light"));
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const toggle = page.locator("#deck-script-toggle");
		if ((await toggle.getAttribute("aria-expanded")) !== String(transcript))
			await openTranscript(page);
		await expect(toggle).toHaveAttribute("aria-expanded", String(transcript));
		await expect(async () => {
			await page.evaluate(() => document.fonts.ready);
			const layout = await page.locator(".praxity-categorize-table").evaluate((table) => {
				const lines = [...table.querySelectorAll("tbody th")].map((cell) => {
					const range = document.createRange();
					range.selectNodeContents(cell);
					return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
				});
				const broken: string[] = [];
				for (const cell of table.querySelectorAll("thead th:not(:first-child)")) {
					const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
					while (walker.nextNode()) {
						const node = walker.currentNode;
						// An authored hyphen is an allowed break in Passif-agressif.
						for (const word of (node.textContent ?? "").matchAll(/[^\s-]+/gu)) {
							const range = document.createRange();
							range.setStart(node, word.index);
							range.setEnd(node, word.index + word[0].length);
							// WebKit includes a zero-width caret at an authored hyphen break.
							const rects = [...range.getClientRects()].filter(
								(rect) => rect.width > 0 && rect.height > 0,
							);
							const bounds = cell.getBoundingClientRect();
							if (
								!rects.length ||
								rects.some(
									(rect) =>
										Math.abs(rect.top - rects[0].top) > 1 ||
										rect.left < bounds.left ||
										rect.right > bounds.right,
								)
							)
								broken.push(word[0]);
						}
					}
				}
				return { lines, broken };
			});
			expect(layout.lines).toHaveLength(5);
			for (const lines of layout.lines) expect(lines).toBeLessThanOrEqual(transcript ? 3 : 2);
			expect(layout.broken).toEqual([]);
		}).toPass({ timeout: 10_000 });
	});
}

for (const width of [1280, 390]) {
	test(`categorize keeps statements readable, answers reachable and row radio navigation at ${width}`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 860 });
		await page.goto(base + entries.get("en-light"));
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const table = page.locator(".praxity-categorize-table");
		await table.evaluate((element) => element.scrollIntoView({ block: "center" }));
		await expect(table.locator("input:not([disabled])").first()).toBeVisible();
		await expect(table).toHaveCSS("table-layout", "fixed");
		const geometry = await table.evaluate((element) => {
			const rect = element.getBoundingClientRect();
			const headers = [...element.querySelectorAll("thead th")].map(
				(e) => e.getBoundingClientRect().width,
			);
			const statements = [...element.querySelectorAll("tbody th")].map((e) => {
				const range = document.createRange();
				range.selectNodeContents(e);
				return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
			});
			return {
				width: rect.width,
				headers,
				statements,
				scroll: element.parentElement!.scrollWidth > element.parentElement!.clientWidth,
			};
		});
		if (width === 1280) {
			expect(geometry.headers[0] / geometry.width).toBeCloseTo(0.44, 2);
			for (const lines of geometry.statements) expect(lines).toBeLessThanOrEqual(2);
			expect(geometry.headers[0]).toBeGreaterThanOrEqual(256);
			for (const header of geometry.headers.slice(2))
				expect(header).toBeCloseTo(geometry.headers[1], 0);
		} else {
			// A scrolling statement column hid the last answers on phones. Keep the
			// wide table above; at this width every statement and labeled answer fits.
			expect(geometry.scroll).toBe(false);
			for (const row of await table.locator("tbody tr").all()) {
				await expect(row.locator("th")).toHaveCSS("display", "block");
				const statementWidth = await row
					.locator("th")
					.evaluate((node) => node.getBoundingClientRect().width);
				expect(statementWidth).toBeGreaterThanOrEqual(256);
				expect(statementWidth).toBeCloseTo(geometry.width, 0);
				for (const cell of await row.locator("td").all()) {
					const category = await cell.getAttribute("data-category");
					expect(category).toBeTruthy();
					const label = await cell.evaluate((node) => {
						const style = getComputedStyle(node, "::before");
						return { content: style.content, height: Number.parseFloat(style.height) };
					});
					// Gecko serializes attr() rather than the resolved generated text.
					expect(["attr(data-category)", JSON.stringify(category)]).toContain(label.content);
					expect(label.height).toBeGreaterThan(0);
					const bounds = await cell.locator("input").boundingBox();
					expect(bounds).not.toBeNull();
					if (!bounds) throw new Error("Answer control has no bounds");
					expect(bounds.x).toBeGreaterThanOrEqual(0);
					expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
				}
			}
		}
		const radios = table.locator("tbody tr").first().locator('input[type="radio"]');
		await radios.first().focus();
		await page.keyboard.press("ArrowRight");
		await expect(radios.nth(1)).toBeFocused();
		await expect(radios.nth(1)).toBeChecked();
		const targets = await radios.evaluateAll((elements) =>
			elements
				.map((e) => e.closest("label")?.getBoundingClientRect())
				.map((r) => (r ? { width: r.width, height: r.height } : null)),
		);
		for (const target of targets) {
			expect(target).not.toBeNull();
			expect(target!.width).toBeGreaterThanOrEqual(44);
			expect(target!.height).toBeGreaterThanOrEqual(44);
		}
	});
}

for (const locale of ["en", "fr"]) {
	for (const mode of ["light", "dark"]) {
		test(`flip cards retain visible focus, prompt and localized answer controls in ${locale} ${mode}`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 860 });
			await page.goto(base + entries.get(`${locale}-${mode}`));
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			const cards = page.locator(".praxity-flashcard-toggle");
			const first = cards.first();
			await expect(first).toBeVisible();
			await first.focus();
			await expect(first).toBeFocused();
			await page.keyboard.press("Shift+Tab");
			await page.keyboard.press("Tab");
			await expect(first).toBeFocused();
			await expect(first).toHaveCSS("outline-offset", "2px");
			await expectFocusRing(first, 2);
			// WebKit scrolls the focused card flush with the scrollport's edge.
			await first.evaluate((element) => element.scrollIntoView({ block: "center" }));
			await expectUnclippedRing(first);
			const heights = await cards.evaluateAll((elements) =>
				elements.map((e) => e.getBoundingClientRect().height),
			);
			expect(heights).toHaveLength(2);
			for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
			if (process.env.COURSE_AUDIT_SCREENSHOTS)
				await page.screenshot({
					path: `${process.env.COURSE_AUDIT_SCREENSHOTS}/flip-cards-${locale}-${mode}-${test.info().project.name}.png`,
				});
			const card = page.locator('.praxity-card[data-flippable="true"]').first();
			const heading = page.locator(".praxity-flashcard-face-heading").first();
			const before = await heading.boundingBox();
			await expect(heading).toHaveCSS("margin-block-end", "16px");
			await expect(first).toHaveText(locale === "fr" ? "J'ai ma réponse" : "I have my answer");
			await first.press("Space");
			await expect(first).toHaveAttribute("aria-expanded", "true");
			await expect(first).toHaveText(locale === "fr" ? "Masquer la réponse" : "Hide answer");
			await expect(card.locator('[data-card-side="front"]')).toBeVisible();
			const answer = card.locator('[data-card-side="back"]');
			await expect(answer).toBeVisible();
			await expect(answer).toHaveCSS("transform", "none");
			expect((await heading.boundingBox())?.y).toBe(before?.y);
			await first.press("Enter");
			await expect(first).toHaveAttribute("aria-expanded", "false");
			await expect(answer).toBeHidden();
			await page.emulateMedia({ reducedMotion: "reduce" });
			await first.press("Space");
			await expect(answer).toHaveCSS("animation-duration", "0s");
			expect((await analyzeAxe(page, new AxeBuilder({ page }))).violations).toEqual([]);
		});
	}
}
