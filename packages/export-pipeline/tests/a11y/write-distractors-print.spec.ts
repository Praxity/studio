import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { writeDistractorsHarness } from "./fixtures/write-distractors-harness";

type Fixture = Window & {
	fixtureState: Map<string, unknown>;
	fixtureWrites: unknown[];
	printReports: unknown[];
	installFixtureProvider(): void;
	releaseDistractors(): void;
};
let directory: string, url: string, owned: boolean;
let server: ReturnType<typeof createServer>;
test.beforeAll(async ({ browser }) => {
	owned = !process.env.PRAXITY_DISTRACTORS_PRINT_HARNESS;
	directory =
		process.env.PRAXITY_DISTRACTORS_PRINT_HARNESS ??
		(await mkdtemp(join(tmpdir(), "distractor-print-")));
	if (owned) await writeDistractorsHarness(directory);
	// A second prompt stays unrevealed while the first activity progresses.
	for (const lang of ["en", "fr"]) {
		const file = join(directory, `${lang}-light.html`);
		let html = await readFile(file, "utf8");
		if (!html.includes('data-distractor-id="other"')) {
			const start = html.indexOf('<div class="praxity-write-distractors');
			const end = html.indexOf("</main>", start);
			if (start < 0 || end < 0) throw new Error("Missing print fixture prompt");
			const second = html
				.slice(start, end)
				.replaceAll("wd-answer", "other-answer")
				.replaceAll("wd-baseline", "other-baseline")
				.replaceAll("wd-error", "other-error")
				.replace('data-distractor-id="wd"', 'data-distractor-id="other"');
			html = html.slice(0, end) + second + html.slice(end);
			await writeFile(file, html);
		}
	}
	server = createServer(async (request, response) => {
		const file = resolve(directory, `.${new URL(request.url ?? "/", "http://localhost").pathname}`);
		if (!file.startsWith(directory + sep)) return void response.writeHead(403).end();
		try {
			response.setHeader(
				"Content-Type",
				file.endsWith(".js")
					? "text/javascript"
					: file.endsWith(".css")
						? "text/css"
						: file.endsWith(".woff2")
							? "font/woff2"
							: "text/html; charset=utf-8",
			);
			response.end(await readFile(file));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	// Warm the actual lazy presentation and fonts outside each case's timing budget.
	const warm = await browser.newPage();
	await warm.goto(`${url}/en-light.html`);
	await warm.locator("#wd-answer").fill("A draft");
	await warm.locator('[data-distractor-id="wd"] [data-distractor-action="check"]').click();
	await expect(
		warm.locator('[data-distractor-id="wd"] [data-distractor-action="yes"]'),
	).toBeVisible();
	await warm.close();
	if (process.env.PRAXITY_DISTRACTORS_PRINT_SCREENS)
		await mkdir(process.env.PRAXITY_DISTRACTORS_PRINT_SCREENS, { recursive: true });
});
test.afterAll(async () => {
	if (server)
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done())),
		);
	if (owned) await rm(directory, { recursive: true, force: true });
});

const first = (page: Page) => page.locator('[data-distractor-id="wd"]');
const other = (page: Page) => page.locator('[data-distractor-id="other"]');
const projection = (page: Page) => first(page).locator(".praxity-distractor-print");
async function settleAnnouncements(page: Page) {
	await page.evaluate(async () => {
		await document.fonts.ready;
		// Live regions clear synchronously and deliver on the next animation frame.
		// Drain pending announcements for both activities before taking the print baseline.
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	});
}
async function snapshot(page: Page) {
	return page.evaluate(() => {
		const fixture = window as unknown as Fixture;
		const copy = document.querySelector("main")?.cloneNode(true) as HTMLElement;
		copy.querySelectorAll(".praxity-distractor-print").forEach((node) => node.remove());
		// Playwright's caret suppression leaves empty style attributes after a capture.
		copy.querySelectorAll('[style=""]').forEach((node) => node.removeAttribute("style"));
		return {
			markup: copy.innerHTML,
			state: [...fixture.fixtureState],
			writes: fixture.fixtureWrites,
			reports: fixture.printReports,
			fields: [...document.querySelectorAll<HTMLInputElement>("textarea,input,select")].map(
				(node) => [node.id, node.value],
			),
			focus:
				(document.activeElement as HTMLElement)?.id ||
				document.activeElement?.getAttribute("data-distractor-action"),
		};
	});
}
async function beginPrint(page: Page) {
	await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
	await page.emulateMedia({ media: "print" });
}
async function endPrint(page: Page) {
	await page.emulateMedia({ media: "screen" });
	await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
	await expect(page.locator(".praxity-distractor-print")).toHaveCount(0);
}
async function capture(page: Page, name: string) {
	if (process.env.PRAXITY_DISTRACTORS_PRINT_SCREENS)
		await page.screenshot({
			path: join(
				process.env.PRAXITY_DISTRACTORS_PRINT_SCREENS,
				`${test.info().project.name}-${name}.png`,
			),
			fullPage: true,
		});
}

for (const lang of ["en", "fr"] as const) {
	let context: BrowserContext, page: Page;
	test.describe(`${lang} A4 learner print`, () => {
		test.beforeAll(async ({ browser }) => {
			context = await browser.newContext({ viewport: { width: 794, height: 1123 } });
			page = await context.newPage();
			await page.addInitScript(() => {
				const fixture = window as unknown as Fixture;
				fixture.printReports = [];
				document.addEventListener("praxity:assessment-response", (event) =>
					fixture.printReports.push((event as CustomEvent).detail),
				);
			});
		});
		test.beforeEach(async () => {
			// Media emulation belongs to the page and survives navigation between fixtures.
			await page.emulateMedia({ media: "screen" });
		});
		test.afterAll(async () => {
			await context.close();
		});
		for (const stage of ["unrevealed", "revealed", "builder", "compared", "recovery"] as const) {
			test.describe(stage, () => {
				// Preparing a stage is fixture setup; the timed case exercises print only.
				test.beforeAll(async () => {
					await page.goto(`${url}/${lang}-light.html${stage === "recovery" ? "?pending" : ""}`);
					await expect(first(page).locator("[data-distractor-destination]")).toBeVisible();
					if (stage === "recovery") {
						await page.evaluate(() => {
							const fixture = window as unknown as Fixture;
							fixture.fixtureState.set("wd", {
								version: 1,
								kind: "write-distractors",
								contentRevision: `sha256:${"0".repeat(64)}`,
								value: {
									answer: "RECOVERY-ANSWER ".repeat(180) + "RECOVERY-ANSWER-END",
									hadIt: true,
									shown: true,
									options: [
										{
											text: "RECOVERY-OPTION ".repeat(100) + "RECOVERY-OPTION-END",
											misconception: "late",
											custom: "RECOVERY-IDEA ".repeat(100) + "RECOVERY-IDEA-END",
										},
									],
								},
							});
							fixture.installFixtureProvider();
						});
						await expect(first(page).locator("[data-distractor-recovery] textarea")).toHaveCount(3);
					}
					await first(page).locator("[data-distractor-answer]").fill("MY-CURRENT-DRAFT");
					if (["revealed", "builder", "compared"].includes(stage)) {
						await first(page).locator('[data-distractor-action="check"]').click();
						await expect(first(page).locator('[data-distractor-action="yes"]')).toBeVisible();
					}
					if (["builder", "compared"].includes(stage)) {
						await first(page).locator('[data-distractor-action="yes"]').click();
						await first(page).locator("fieldset textarea").nth(0).fill("MY-WRONG-OPTION-B");
						if (stage === "compared")
							await first(page).locator("fieldset select").nth(0).selectOption("late");
						await first(page).locator("fieldset textarea").nth(1).fill("MY-WRONG-OPTION-C");
						await first(page).locator("fieldset select").nth(1).selectOption("other");
						await first(page).locator("fieldset input").nth(1).fill("MY-CUSTOM-IDEA");
					}
					if (stage === "compared") {
						await first(page).locator('[data-distractor-action="compare"]').click();
						await expect(first(page).locator('[data-distractor-preview="author"]')).toBeVisible();
					}
					await other(page).locator("[data-distractor-answer]").fill("SIBLING-DRAFT");
					await first(page)
						.locator(
							stage === "compared"
								? '[data-distractor-action="compare"]'
								: "[data-distractor-answer]",
						)
						.focus();
					await settleAnnouncements(page);
					if (stage === "recovery")
						await expect(first(page).locator("[data-distractor-status]")).toHaveText(
							lang === "en"
								? "Your latest work is not saved. Keep a copy before leaving this page."
								: "Votre travail le plus récent n'est pas enregistré. Gardez-en une copie avant de quitter cette page.",
						);
				});
				test("prints visible work only, with no load/write/report/state change and restores screen/focus", async ({
					browserName,
				}) => {
					let loads = 0;
					const countLoad = () => ++loads;
					page.on("request", countLoad);
					const checkSeparators = async () => {
						const answer =
							lang === "en"
								? "Correct answer: Throughout the design process."
								: "Bonne réponse\u202f: Tout au long du processus de conception.";
						// Preserve the actual U+202F code point; locator text matching normalizes whitespace.
						expect(
							await first(page)
								.locator("[data-distractor-preview] > p:nth-child(3)")
								.evaluateAll((nodes) => nodes.map((node) => node.textContent)),
						).toEqual([answer, answer]);
						expect(
							await first(page)
								.locator('[data-distractor-preview="learner"] li > p')
								.first()
								.textContent(),
						).toBe(
							lang === "en"
								? "Wrong option B: MY-WRONG-OPTION-B"
								: "Mauvaise réponse B\u202f: MY-WRONG-OPTION-B",
						);
					};
					if (stage === "compared") await checkSeparators();
					const before = await snapshot(page);
					await beginPrint(page);
					await expect(projection(page).first()).toHaveText("MY-CURRENT-DRAFT");
					await expect(
						first(page)
							.locator(
								"textarea,input,select,button:not([aria-pressed=true]),[data-distractor-status],[data-distractor-notice],[data-distractor-save],[data-distractor-destination],.praxity-text-error",
							)
							.filter({ visible: true }),
					).toHaveCount(0);
					const text = await first(page).innerText();
					expect(
						text.includes(
							lang === "en"
								? "Throughout the design process."
								: "Tout au long du processus de conception.",
						),
					).toBe(["revealed", "builder", "compared"].includes(stage));
					expect(text.includes("AUTHOR-OPTION-PRIVATE-ONE")).toBe(stage === "compared");
					if (stage !== "compared")
						expect(await page.content()).not.toContain("AUTHOR-OPTION-PRIVATE");
					else await checkSeparators();
					if (stage === "builder") {
						await expect(first(page).locator("fieldset select").first()).toHaveValue("");
						expect(text).not.toContain(lang === "en" ? "Choose one" : "Choisissez une idée fausse");
					}
					expect(text).not.toContain("SIBLING-DRAFT");
					await expect(other(page).locator(".praxity-distractor-print")).toHaveText([
						"SIBLING-DRAFT",
					]);
					expect(await other(page).innerText()).not.toMatch(
						/MY-CURRENT-DRAFT|AUTHOR-OPTION-PRIVATE/,
					);
					if (["builder", "compared"].includes(stage)) {
						expect(text).toContain("MY-WRONG-OPTION-B");
						expect(text).toContain("MY-CUSTOM-IDEA");
						expect(text).toContain(lang === "en" ? "Yes" : "Oui");
						const rating = first(page).locator('button[aria-pressed="true"]');
						await expect(rating).toBeVisible();
						await expect(rating).toHaveCSS(
							"color",
							await first(page).evaluate((node) => getComputedStyle(node).color),
						);
						await expect(rating).toHaveCSS("border-top-width", "0px");
						await expect(rating).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
					}
					if (stage === "recovery")
						for (const tail of ["RECOVERY-ANSWER-END", "RECOVERY-OPTION-END", "RECOVERY-IDEA-END"])
							expect(text).toContain(tail);
					await capture(page, `${lang}-${stage}-A4`);
					await endPrint(page);
					expect(await snapshot(page)).toEqual(before);
					if (browserName === "chromium") {
						// A forced screen media override also applies to printToPDF; use native print media.
						await page.emulateMedia({ media: null });
						const pdf = await page.pdf({
							format: "A4",
							path: process.env.PRAXITY_DISTRACTORS_PRINT_SCREENS
								? join(process.env.PRAXITY_DISTRACTORS_PRINT_SCREENS, `${lang}-${stage}-A4.pdf`)
								: undefined,
						});
						expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
						if (stage === "recovery")
							expect(pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length).toBeGreaterThan(2);
						expect(await snapshot(page)).toEqual(before);
					}
					expect(loads).toBe(0);
					page.removeListener("request", countLoad);
				});
			});
		}
		test("a long draft wraps completely, repeated print replaces projections, and pagehide/teardown clear them", async ({
			browserName,
		}) => {
			await page.goto(`${url}/${lang}-light.html`);
			await expect(first(page).locator('[data-distractor-action="check"]')).toBeVisible();
			const draft = "WRAPPING-LONG-TOKEN".repeat(200) + "\nLONG-DRAFT-END";
			await first(page).locator("textarea").fill(draft);
			await beginPrint(page);
			await expect(projection(page)).toHaveText([draft]);
			const bounds = await projection(page).evaluate((node) => ({
				height: node.getBoundingClientRect().height,
				overflow: node.scrollWidth - node.clientWidth,
			}));
			expect(bounds.height).toBeGreaterThan(200);
			expect(bounds.overflow).toBeLessThanOrEqual(1);
			await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
			await expect(projection(page)).toHaveCount(1);
			if (browserName === "chromium" && process.env.PRAXITY_DISTRACTORS_PRINT_SCREENS)
				await page.pdf({
					path: join(process.env.PRAXITY_DISTRACTORS_PRINT_SCREENS, `${lang}-long-draft-A4.pdf`),
					format: "A4",
				});
			await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
			await expect(projection(page)).toHaveCount(0);
			await page.emulateMedia({ media: "screen" });
			await page.evaluate(() =>
				window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
			);
			await beginPrint(page);
			await page.evaluate(() => (window as unknown as Fixture).releaseDistractors());
			await expect(projection(page)).toHaveCount(0);
			await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
			await expect(projection(page)).toHaveCount(0);
		});
		test("no-JS print has only the question, answer label and blank writing space", async ({
			browser,
			browserName,
		}) => {
			const baseline = await browser.newContext({
				javaScriptEnabled: false,
				viewport: { width: 794, height: 1123 },
			});
			try {
				const plain = await baseline.newPage();
				await plain.goto(`${url}/${lang}-light.html`);
				await plain.emulateMedia({ media: "print" });
				await expect(first(plain).locator("[data-distractor-writing-space]")).toBeVisible();
				await expect(
					first(plain).locator("textarea,[data-distractor-baseline]").filter({ visible: true }),
				).toHaveCount(0);
				expect(await first(plain).innerText()).not.toMatch(
					/AUTHOR-OPTION|design process|processus de conception|JavaScript/,
				);
				await capture(plain, `${lang}-no-JS-A4`);
				if (browserName === "chromium" && process.env.PRAXITY_DISTRACTORS_PRINT_SCREENS)
					await plain.pdf({
						path: join(process.env.PRAXITY_DISTRACTORS_PRINT_SCREENS, `${lang}-no-JS-A4.pdf`),
						format: "A4",
					});
			} finally {
				await baseline.close();
			}
		});
		test("empty enhanced answers keep writing space; nonempty drafts replace it", async () => {
			await page.goto(`${url}/${lang}-light.html`);
			await expect(first(page).locator('[data-distractor-action="check"]')).toBeVisible();
			await beginPrint(page);
			await expect(first(page).locator("[data-distractor-writing-space]")).toBeVisible();
			await endPrint(page);
			await first(page).locator("textarea").fill("A paper draft");
			await beginPrint(page);
			await expect(first(page).locator("[data-distractor-writing-space]")).toBeHidden();
			await expect(projection(page)).toHaveText(["A paper draft"]);
			await endPrint(page);
		});
		test("print hides field errors and notices without clearing their state", async () => {
			await page.goto(`${url}/${lang}-light.html`);
			await first(page).locator('[data-distractor-action="check"]').click();
			await expect(first(page).locator("[data-distractor-error]")).toBeVisible();
			await settleAnnouncements(page);
			await expect(first(page).locator("[data-distractor-status]")).not.toBeEmpty();
			const before = await snapshot(page);
			await beginPrint(page);
			await expect(first(page).locator("[data-distractor-error]")).toBeHidden();
			await expect(projection(page)).toHaveText([""]);
			await endPrint(page);
			expect(await snapshot(page)).toEqual(before);
		});
		test("print cleanup preserves a later control's focus", async () => {
			await page.goto(`${url}/${lang}-light.html`);
			await expect(first(page).locator('[data-distractor-action="check"]')).toBeVisible();
			await first(page).locator("textarea").focus();
			await beginPrint(page);
			await page.emulateMedia({ media: "screen" });
			await other(page).locator("textarea").focus();
			await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
			await expect(other(page).locator("textarea")).toBeFocused();
			await expect(projection(page)).toHaveCount(0);
		});
		test("pre-enhancement print stays a blank workbook even if native text was entered", async () => {
			let blocked = 0;
			await page.route("**/island-write-distractors-*.js", (route) => {
				++blocked;
				return route.abort();
			});
			await page.goto(`${url}/${lang}-light.html`);
			expect(blocked).toBeGreaterThan(0);
			await first(page).locator("textarea").fill("PRE-ENHANCEMENT-DRAFT");
			await beginPrint(page);
			await expect(first(page).locator("[data-distractor-writing-space]")).toBeVisible();
			await expect(projection(page)).toHaveCount(0);
			expect(await first(page).innerText()).not.toContain("PRE-ENHANCEMENT-DRAFT");
		});
	});
}
