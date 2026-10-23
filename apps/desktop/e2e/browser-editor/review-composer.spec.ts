import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { runPraxityCli } from "../../src/main/cli";
import type { StudioServer } from "../../src/main/studio/server";
import { servedReview } from "./review-fixture";

test.beforeEach(({ page }) => {
	page.on("dialog", (dialog) => dialog.accept());
});

async function selectQuote(page: Page) {
	await page.evaluate(() => {
		const range = document.createRange();
		range.selectNodeContents(document.querySelector('[data-node-id="quote"]') as Element);
		getSelection()?.removeAllRanges();
		getSelection()?.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));
	});
}

test("keyboard picker, selection and pin create durable store-visible comments and recover a draft", async ({
	page,
}) => {
	const fixture = await servedReview("en");
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await page.goto(fixture.url);
		const choose = page.getByRole("button", { name: "Comment on…", exact: true });
		for (
			let i = 0;
			i < 15 && !(await choose.evaluate((node) => document.activeElement === node));
			i++
		)
			await page.keyboard.press("Tab");
		await expect(choose).toBeFocused();
		await page.keyboard.press("Enter");
		const picker = page.getByRole("dialog", { name: "Choose what to comment on" });
		await expect(picker).toBeVisible();
		await expect(picker.getByRole("radio").nth(1)).toBeFocused();
		await page.keyboard.press("Tab");
		await page.keyboard.press("Enter");
		const field = page.getByRole("textbox", { name: "Comment", exact: true });
		await expect(field).toBeFocused();
		await page.keyboard.type("Keyboard comment");
		await page.keyboard.press("Tab");
		await page.keyboard.press("Enter");
		await expect(page.locator(".prx-review-comment")).toBeFocused();
		const listed = await fixture.list();
		if (!("threads" in listed)) throw new Error(listed.code);
		expect(listed.threads).toHaveLength(1);
		expect(listed.threads[0]).toMatchObject({
			anchor: { nodeId: "quote", pageId: "page" },
			messages: [{ body: "Keyboard comment" }],
		});
		await page.getByRole("button", { name: "Collapse comments" }).click();
		await page.locator('[data-node-id="quote"]').click({ clickCount: 3 });
		await page.locator(".prx-review-selection").click();
		await expect(page.locator(".prx-review-composer blockquote")).toHaveText(
			"A passage to read carefully.",
		);
		await field.fill("Selected passage comment");
		await page.getByRole("button", { name: "Save comment", exact: true }).click();
		await expect(page.locator(".prx-review-comment")).toHaveCount(2);
		await page.getByRole("button", { name: "Collapse comments" }).click();
		await page.getByRole("button", { name: "Pin", exact: true }).click();
		await page.locator(".pin-target").click();
		expect(new URL(page.url()).hash).toBe("");
		await field.fill("Pinned link comment");
		await page.getByRole("button", { name: "Save comment", exact: true }).click();
		await expect(page.locator(".prx-review-comment")).toHaveCount(3);
		await page.getByRole("button", { name: "Collapse comments" }).click();
		await choose.click();
		await page.getByRole("radio", { name: "Whole page", exact: true }).check();
		await page
			.locator(".prx-review-picker")
			.getByRole("button", { name: "Next", exact: true })
			.click();
		await field.fill("Draft survives reload");
		await page.keyboard.press("Escape");
		await expect(choose).toBeFocused();
		await expect(page.locator(".prx-review-draft-body")).toHaveText("Draft survives reload");
		await page.reload();
		await page.getByRole("button", { name: "Expand comments" }).click();
		await page.getByRole("button", { name: "Open draft" }).click();
		await expect(field).toHaveValue("Draft survives reload");
		await page.setViewportSize({ width: 320, height: 900 });
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "200%";
		});
		expect(
			await page
				.locator(".prx-review-composer")
				.evaluate((node) => node.scrollWidth <= node.clientWidth),
		).toBe(true);
		await page.keyboard.press("Escape");
		expect(errors).toEqual([]);
	} finally {
		await page.goto("about:blank");
		await fixture.close();
	}
});

for (const locale of ["en", "fr"] as const) {
	for (const reused of [false, true]) {
		test(`two tabs announce ${reused ? "a reused draft ID" : "a replay"} in ${locale}`, async ({
			page,
			context,
		}) => {
			const fixture = await servedReview(locale);
			// Without Web Locks each tab persists its own copy; Duplicate tab copies that store.
			await context.addInitScript(() =>
				Object.defineProperty(navigator, "locks", { value: undefined }),
			);
			const duplicate = await context.newPage();
			duplicate.on("dialog", (dialog) => dialog.accept());
			const posts: Array<{ requestId: string; body: string }>[] = [[], []];
			for (const [index, tab] of [page, duplicate].entries())
				tab.on("request", (request) => {
					if (
						request.method() === "POST" &&
						new URL(request.url()).pathname.endsWith("/comments")
					) {
						const { requestId, body } = request.postDataJSON();
						posts[index].push({ requestId, body });
					}
				});
			const originalBody =
				locale === "fr" ? "Le texte du premier onglet." : "The first tab's text.";
			const keptBody =
				locale === "fr" ? "Le texte modifié du second onglet." : "The second tab's edited text.";
			const notice = reused
				? locale === "fr"
					? "Ce brouillon a été publié depuis un autre onglet. Votre texte a été conservé dans un nouveau brouillon."
					: "This draft was posted from another tab. Your text was kept as a new draft."
				: locale === "fr"
					? "Déjà publié"
					: "Already posted";
			try {
				await page.goto(fixture.url);
				await page.locator(".prx-review-choose").click();
				await page
					.getByRole("radio", {
						name: locale === "fr" ? "Toute la page" : "Whole page",
						exact: true,
					})
					.check();
				await page.locator(".prx-review-next").click();
				await page.locator(".prx-review-composer textarea").fill(originalBody);
				const snapshot = await page.evaluate(() =>
					Object.entries(sessionStorage).filter(([key]) => key.startsWith("praxity-review-draft:")),
				);
				expect(snapshot.filter(([key]) => key.startsWith("praxity-review-draft:"))).toHaveLength(1);
				await page.locator(".prx-review-submit").click();
				await expect(page.locator(".prx-review-comment-text")).toHaveText(originalBody);
				expect(posts[0]).toHaveLength(1);
				// A browser's Duplicate tab copies sessionStorage, not the shared localStorage.
				// Restore the real tab-only snapshot after the first tab acknowledges.
				await duplicate.addInitScript(
					({ origin, snapshot }) => {
						if (location.origin === origin)
							for (const [key, raw] of snapshot) sessionStorage.setItem(key, raw);
					},
					{ origin: new URL(fixture.url).origin, snapshot },
				);
				await duplicate.goto(fixture.url);
				await duplicate.locator(".prx-review-toggle").click();
				await duplicate.locator(".prx-review-open-draft").click();
				const field = duplicate.locator(".prx-review-composer textarea");
				await expect(field).toHaveValue(originalBody);
				if (reused) await field.fill(keptBody);
				const responsePromise = duplicate.waitForResponse(
					(response) =>
						response.request().method() === "POST" &&
						new URL(response.url()).pathname.endsWith("/comments"),
				);
				await duplicate.locator(".prx-review-submit").click();
				const response = await responsePromise;
				expect(response.status()).toBe(reused ? 409 : 200);
				expect(await response.json()).toMatchObject(
					reused ? { ok: false, code: "request_id_reused" } : { ok: true, replayed: true },
				);
				expect(posts[1]).toEqual([
					{ requestId: posts[0][0].requestId, body: reused ? keptBody : originalBody },
				]);
				if (reused) {
					await expect(duplicate.locator(".prx-review-composer-status")).toHaveAttribute(
						"role",
						"status",
					);
					await expect(duplicate.locator(".prx-review-composer-status")).toHaveText(notice);
					await expect(duplicate.locator(".prx-review-composer-notice")).toHaveText(notice);
					await expect(duplicate.locator(".prx-review-composer-notice")).toBeVisible();
					await expect(field).toHaveValue(keptBody);
					await expect(field).toBeEditable();
				} else {
					await expect(duplicate.locator(".prx-review-status")).toHaveAttribute(
						"aria-live",
						"polite",
					);
					await expect(duplicate.locator(".prx-review-status")).toHaveText(notice);
					await expect(duplicate.locator(".prx-review-composer")).not.toBeVisible();
				}
				const shots =
					process.env.PRAXITY_REVIEW_NOTICE_SCREENSHOTS ?? process.env.PRAXITY_REVIEW_SCREENSHOTS;
				if (shots) {
					await mkdir(shots, { recursive: true });
					for (const { width, theme } of [
						{ width: 1280, theme: "light" },
						{ width: 390, theme: "dark" },
					]) {
						await duplicate.setViewportSize({ width, height: 900 });
						await duplicate.evaluate(
							(mode) => document.documentElement.setAttribute("data-praxity-mode", mode),
							theme,
						);
						await duplicate.screenshot({
							path: join(
								shots,
								`c8-notice-${reused ? "reused" : "replay"}-${width}-${theme}-${locale}.png`,
							),
						});
						if (reused && locale === "en" && width === 1280) {
							await duplicate.emulateMedia({ forcedColors: "active" });
							await duplicate.screenshot({
								path: join(shots, "c8-notice-reused-1280-forced-colors-en.png"),
							});
							await duplicate.emulateMedia({ forcedColors: "none" });
						}
					}
				}
				await duplicate.evaluate(() => new Promise(requestAnimationFrame));
				expect(posts[1]).toHaveLength(1);
				const listed = await fixture.list();
				if (!("threads" in listed)) throw new Error(listed.code);
				expect(listed.threads).toHaveLength(1);
				expect(listed.threads[0].messages[0].body).toBe(originalBody);
			} finally {
				await duplicate.close();
				await page.goto("about:blank");
				await fixture.close();
			}
		});
	}
}

test("review dialogs coexist with the deck More disclosure", async ({ page }) => {
	const fixture = await servedReview("en", true);
	try {
		await page.setViewportSize({ width: 390, height: 900 });
		await page.goto(fixture.url);
		const more = page.getByRole("button", { name: "More", exact: true });
		await more.click();
		const choose = page.getByRole("button", { name: "Comment on…", exact: true });
		const dockStyles = await page
			.locator(".deck-utility-items > .prx-review-action,.deck-utility-items > .prx-review-toggle")
			.evaluateAll((buttons) =>
				buttons.map((button) => {
					const style = getComputedStyle(button);
					return [style.fontSize, style.fontWeight, style.minHeight].join(" ");
				}),
			);
		expect(dockStyles).toHaveLength(3);
		expect(new Set(dockStyles).size).toBe(1);
		await choose.click();
		await page.keyboard.press("Escape");
		await expect(choose).toBeFocused();
		await choose.click();
		await page
			.locator(".prx-review-picker")
			.getByRole("button", { name: "Next", exact: true })
			.click();
		await page.getByRole("textbox", { name: "Comment", exact: true }).fill("Deck draft");
		await page.keyboard.press("Escape");
		await expect(choose).toBeFocused();
		await more.click();
		await expect(choose).toBeHidden();
		await more.click();
		await expect(choose).toBeVisible();
		await page.getByRole("button", { name: "Expand comments" }).click();
		await expect(more).toHaveAttribute("aria-expanded", "false");
		await page.getByRole("button", { name: "Comment on…", exact: true }).click();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("button", { name: "Comment on…", exact: true })).toBeFocused();
	} finally {
		await page.goto("about:blank");
		await fixture.close();
	}
});

test("touch pinning captures a link without navigating", async ({ browser }) => {
	const fixture = await servedReview("en");
	const context = await browser.newContext({
		hasTouch: true,
		viewport: { width: 390, height: 900 },
	});
	const page = await context.newPage();
	try {
		await page.goto(fixture.url);
		await page.tap(".prx-review-pin");
		await page.tap(".pin-target");
		await expect(page.locator(".prx-review-composer")).toBeVisible();
		expect(new URL(page.url()).hash).toBe("");
		await page.locator(".prx-review-composer textarea").fill("Touch pin comment");
		await page.tap(".prx-review-composer .prx-review-submit");
		await expect(page.locator(".prx-review-comment")).toHaveCount(1);
	} finally {
		await context.close();
		await fixture.close();
	}
});

test("fixed CLI port restores browser drafts across a real restart and busy fallback retains published comments", async ({
	page,
}) => {
	const root = await mkdtemp(
		join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "review-restart-"),
	);
	const projectDir = join(root, "project"),
		assetsDir = join(root, "assets");
	await mkdir(projectDir);
	await cp(resolve(import.meta.dirname, "../../resources/export-assets"), assetsDir, {
		recursive: true,
	});
	for (const file of ["review-comments.js", "review-comments.css"])
		await cp(
			resolve(import.meta.dirname, `../../../../packages/export-pipeline/template/${file}`),
			join(assetsDir, file),
		);
	await writeFile(
		join(projectDir, "course.yaml"),
		"title: Restart review\nlessons: [lesson.prax]\n",
	);
	await writeFile(
		join(projectDir, "lesson.prax"),
		"---\ntitle: Restart lesson\n---\n# First page\n\nReview this paragraph.\n",
	);
	const probe = createServer();
	await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
	const address = probe.address();
	if (!address || typeof address === "string") throw new Error("Missing test port");
	const editorPort = address.port > 64535 ? address.port - 1000 : address.port;
	await new Promise<void>((resolve) => probe.close(() => resolve()));
	const servers: StudioServer[] = [];
	const blocker = createServer();
	let blocked = false;
	async function start() {
		const result = await runPraxityCli(
			["studio", projectDir, "--review", "--no-open", "--port", String(editorPort)],
			{
				appVersion: "0.3.0",
				editorAssetsDir: process.env.PRAXITY_BROWSER_EDITOR_ASSETS,
				exportAssetsDir: assetsDir,
			},
		);
		expect(result.exitCode, result.stderr).toBe(0);
		if (!result.studioServer) throw new Error(result.stderr);
		servers.push(result.studioServer);
		await page.goto(result.studioServer.readyUrl);
		return result.studioServer;
	}
	async function wholePage() {
		await page.locator(".prx-review-choose").click();
		await page.getByRole("radio", { name: "Whole page", exact: true }).check();
		await page.locator(".prx-review-next").click();
	}
	try {
		const first = await start();
		expect(new URL(page.url()).port).toBe(String(editorPort + 1000));
		const learnerOrigin = new URL(page.url()).origin;
		const published = ["Published before restart", "Another published comment"];
		for (const [index, body] of published.entries()) {
			await wholePage();
			await page.locator(".prx-review-composer textarea").fill(body);
			await page.locator(".prx-review-submit").click();
			await expect(page.locator(".prx-review-comment")).toHaveCount(index + 1);
		}
		await wholePage();
		await page.locator(".prx-review-composer textarea").fill("Browser draft across restart");
		await page.keyboard.press("Escape");
		await expect(page.locator(".prx-review-draft-body")).toHaveText("Browser draft across restart");
		await first.close();
		const second = await start();
		expect(new URL(page.url()).origin).toBe(learnerOrigin);
		await page.locator(".prx-review-toggle").click();
		await page.locator(".prx-review-open-draft").click();
		await expect(page.locator(".prx-review-composer textarea")).toHaveValue(
			"Browser draft across restart",
		);
		await page.keyboard.press("Escape");
		await second.close();
		await new Promise<void>((resolve) => blocker.listen(editorPort + 1000, "127.0.0.1", resolve));
		blocked = true;
		await start();
		expect(new URL(page.url()).origin).not.toBe(learnerOrigin);
		await expect(page.locator(".prx-review-draft-origin")).toHaveText(
			"Earlier drafts may be unavailable. New drafts may not survive a restart.",
		);
		await expect(page.locator(".prx-review-draft-origin")).toBeVisible();
		await page.locator(".prx-review-toggle").click();
		await expect(page.locator(".prx-review-comment-text")).toHaveText(published);
		await wholePage();
		await expect(page.locator(".prx-review-composer-origin")).toBeVisible();
		await page.keyboard.press("Escape");
	} finally {
		await page.goto("about:blank");
		for (const server of servers) await server.close();
		if (blocked) await new Promise<void>((resolve) => blocker.close(() => resolve()));
		await rm(root, { recursive: true });
	}
});

test("C8 visual states in English and French, light and dark, desktop and phone", async ({
	page,
}) => {
	const shots = process.env.PRAXITY_REVIEW_SCREENSHOTS;
	if (!shots) return;
	await mkdir(shots, { recursive: true });
	for (const locale of ["en", "fr"]) {
		const fixture = await servedReview(locale);
		try {
			await page.goto(fixture.url);
			for (const width of [390, 1280]) {
				await page.setViewportSize({ width, height: 900 });
				for (const theme of ["light", "dark"] as const) {
					await page.evaluate(
						(mode) => document.documentElement.setAttribute("data-praxity-mode", mode),
						theme,
					);
					await selectQuote(page);
					await expect(page.locator(".prx-review-selection")).toBeVisible();
					await page.screenshot({
						path: join(shots, `c8-selection-${width}-${theme}-${locale}.png`),
					});
					await page.locator(".prx-review-selection").click();
					await expect(page.locator(".prx-review-selection")).toBeHidden();
					await page.screenshot({
						path: join(shots, `c8-composer-${width}-${theme}-${locale}.png`),
					});
					if (locale === "en" && width === 1280 && theme === "light") {
						await page.emulateMedia({ forcedColors: "active" });
						await page.screenshot({ path: join(shots, "c8-composer-1280-forced-colors-en.png") });
						await page.emulateMedia({ forcedColors: "none" });
					}
					await page.keyboard.press("Escape");
					await page.locator(".prx-review-choose").click();
					await page.screenshot({ path: join(shots, `c8-picker-${width}-${theme}-${locale}.png`) });
					await page.keyboard.press("Escape");
					await page.locator(".prx-review-pin").click();
					if (locale === "en" && width === 1280 && theme === "light") {
						await page.emulateMedia({ forcedColors: "active" });
						const pressed = await page
							.locator(".prx-review-pin")
							.evaluate((button) => getComputedStyle(button).backgroundColor);
						const normal = await page
							.locator(".prx-review-choose")
							.evaluate((button) => getComputedStyle(button).backgroundColor);
						expect(pressed).not.toBe(normal);
						await page.emulateMedia({ forcedColors: "none" });
					}
					expect(
						await page.locator(".prx-review-pin").evaluate((button) => {
							const expected = document.createElement("span");
							expected.style.background = "var(--praxity-color-accent)";
							button.append(expected);
							const pressed =
								getComputedStyle(button).backgroundColor ===
								getComputedStyle(expected).backgroundColor;
							expected.remove();
							return pressed;
						}),
					).toBe(true);
					await expect(page.locator(".prx-review-pin-hint [role='status']")).not.toHaveText("");
					if (width === 390) {
						expect(
							await page
								.locator(".prx-review-pin-hint button")
								.evaluate((node) => node.scrollWidth <= node.clientWidth),
						).toBe(true);
						const hint = await page.locator(".prx-review-pin-hint").boundingBox(),
							heading = await page.locator("main h1").boundingBox();
						expect(hint && heading && hint.y >= heading.y + heading.height).toBeTruthy();
					}
					await page.screenshot({ path: join(shots, `c8-pin-${width}-${theme}-${locale}.png`) });
					await page.keyboard.press("Escape");
					await page.locator(".prx-review-choose").click();
					await page
						.getByRole("radio", {
							name: locale === "fr" ? "Toute la page" : "Whole page",
							exact: true,
						})
						.check();
					await page.locator(".prx-review-next").click();
					await page
						.locator(".prx-review-composer textarea")
						.fill(
							locale === "fr"
								? "Brouillon restauré après rechargement."
								: "Draft restored after reload.",
						);
					await page.keyboard.press("Escape");
					await expect(page.locator(".prx-review-draft-body")).toHaveText(
						locale === "fr"
							? "Brouillon restauré après rechargement."
							: "Draft restored after reload.",
					);
					await page.reload();
					await page.evaluate(
						(mode) => document.documentElement.setAttribute("data-praxity-mode", mode),
						theme,
					);
					await page.locator(".prx-review-toggle").click();
					await page.locator(".prx-review-open-draft").click();
					await expect(page.locator(".prx-review-composer textarea")).toHaveValue(
						locale === "fr"
							? "Brouillon restaur\u00e9 apr\u00e8s rechargement."
							: "Draft restored after reload.",
					);
					await page.screenshot({
						path: join(shots, `c8-draft-restored-${width}-${theme}-${locale}.png`),
					});
					await page.keyboard.press("Escape");
					await page.locator(".prx-review-discard-draft").click();
					await page.locator(".prx-review-toggle").click();
				}
			}
		} finally {
			await page.goto("about:blank");
			await fixture.close();
		}
	}
});
