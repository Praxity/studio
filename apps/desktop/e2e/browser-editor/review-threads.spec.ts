import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { ReviewAnchor } from "@praxity/review-share/review";
import { JSDOM } from "jsdom";
import { runPraxityCli } from "../../src/main/cli";
import { openReviewStore } from "../../src/main/studio/review-store";
import type { StudioServer } from "../../src/main/studio/server";

for (const locale of ["en", "fr"] as const) {
	for (const deck of [false, true]) {
		test.describe(`${locale} ${deck ? "deck" : "pages"} review thread list`, () => {
			let root: string, projectDir: string, url: string, threadId: string;
			let store: Awaited<ReturnType<typeof openReviewStore>>;
			let server: StudioServer;
			const ids: string[] = [];
			const nodeIds: string[] = [];
			async function openComments(page: Page, keyboard = false) {
				if (deck) {
					await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
					const tools = page.getByRole("button", {
						name: locale === "fr" ? "Outils" : "Tools",
						exact: true,
					});
					if (keyboard) {
						await tools.focus();
						await page.keyboard.press("Enter");
					} else await tools.click();
				}
				const expand = page.getByRole("button", {
					name: locale === "fr" ? "Développer les commentaires" : "Expand comments",
					exact: true,
				});
				await expect(expand).toHaveCount(1);
				await expect(expand).toBeVisible();
				if (keyboard) {
					for (
						let i = 0;
						i < 24 && !(await expand.evaluate((node) => node === document.activeElement));
						i++
					)
						await page.keyboard.press("Tab");
					await expect(expand).toBeFocused();
					await page.keyboard.press("Enter");
				} else await expand.click();
				await expect(
					page.getByRole("complementary", {
						name: locale === "fr" ? "Commentaires" : "Comments",
						exact: true,
					}),
				).toBeVisible();
			}
			test.beforeAll(async ({ browser }) => {
				root = await mkdtemp(
					join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "review-threads-"),
				);
				projectDir = join(root, "course");
				const assetsDir = join(root, "assets");
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
					`title: Review threads\nlang: ${locale}\nmoduleDeck: ${deck}\nlessons: [one.prax, two.prax]\n`,
				);
				await writeFile(
					join(projectDir, "one.prax"),
					`---\ntitle: First lesson\nlang: ${locale}\n---\n# First page\n\nFirst passage.\n\n# Second page\n\nSecond passage.\n`,
				);
				await writeFile(
					join(projectDir, "two.prax"),
					`---\ntitle: Other lesson\nlang: ${locale}\n---\n# Other lesson page\n\nThird passage.\n`,
				);
				const started = await runPraxityCli(["studio", projectDir, "--review", "--no-open"], {
					appVersion: "test",
					exportAssetsDir: assetsDir,
					editorAssetsDir: process.env.PRAXITY_BROWSER_EDITOR_ASSETS,
				});
				expect(started.exitCode, started.stderr).toBe(0);
				if (!started.studioServer) throw new Error(started.stderr);
				server = started.studioServer;
				const response = await fetch(server.readyUrl);
				url = response.url;
				const parsed = new JSDOM(await response.text());
				const config = JSON.parse(
					parsed.window.document.querySelector("#praxity-review-config")?.textContent ?? "null",
				);
				parsed.window.close();
				ids.push(...config.pages.map((page: { id: string }) => page.id));
				expect(ids).toHaveLength(3);
				store = await openReviewStore(projectDir);
				const anchorPage = await browser.newPage();
				try {
					for (const [index, id] of ids.entries()) {
						// Later deck slides are script redirects; load the learner document before reading nodes.
						await anchorPage.goto(new URL(config.pages[index].href, url).href);
						const pageRoot = deck
							? anchorPage.locator(`[data-deck-slide="${id}"]`)
							: anchorPage.locator("main");
						const node = pageRoot.locator("[data-node-id]").first();
						await expect(node).toBeAttached();
						const nodeId = await node.getAttribute("data-node-id");
						if (!nodeId) throw new Error(`No rendered anchor node on page ${id}`);
						nodeIds.push(nodeId);
						const anchor: ReviewAnchor = {
							courseId: null,
							lessonId: index < 2 ? config.page.lessonId : null,
							pageId: id,
							nodeId: index === 0 ? "removed-target" : nodeId,
							blockId: null,
							revision: null,
							quote: null,
							pin: null,
							tab: null,
							revealPath: [],
							cssPath: null,
							context: {
								pageTitle: ["First page", "Second page", "Other lesson page"][index],
								targetLabel: null,
							},
						};
						const created = await store.create(
							await store.principalFor("reviewer", "local-preview"),
							{
								reviewId: store.reviewId,
								requestId: randomUUID(),
								anchor,
								body: `Review page ${index + 1}`,
							},
						);
						if (!created.ok || !created.thread) throw new Error(JSON.stringify(created));
						if (index === 0) threadId = created.thread.id;
					}
				} finally {
					await anchorPage.close();
				}
			});
			test.afterAll(async () => {
				await server?.close();
				if (root) await rm(root, { recursive: true });
			});
			test.beforeEach(async ({ page }) => {
				await page.goto(url);
				await openComments(page);
				await expect(page.locator(".prx-review-comment")).toHaveCount(3);
			});
			test("CLI lifecycle appears on refresh and reload; reviewer replies and reopens with keyboard focus retained", async ({
				page,
			}) => {
				const thread = page.locator(`[data-thread-id="${threadId}"]`);
				await thread.locator(".prx-review-reply-toggle").focus();
				await page.keyboard.press("Enter");
				const reply = thread.locator("textarea");
				await expect(reply).toBeFocused();
				await reply.fill("Unsent reviewer reply");
				const before = await store.list(await store.principalFor("author", "local-cli"));
				if (!("threads" in before)) throw new Error(before.code);
				const version = before.threads.find((thread) => thread.id === threadId)?.version;
				const textFile = join(root, "agent-reply.txt");
				await writeFile(textFile, "Agent verified the change.");
				const resolved = await runPraxityCli(
					[
						"comments",
						"resolve",
						projectDir,
						threadId,
						"--reply-file",
						textFile,
						"--expect-version",
						String(version),
						"--request-id",
						randomUUID(),
						"--json",
					],
					{ appVersion: "test", exportAssetsDir: "unused" },
				);
				expect(resolved.exitCode, resolved.stderr).toBe(0);
				await page.evaluate(() => window.dispatchEvent(new Event("focus")));
				await expect(thread.locator(".prx-review-comment-text").last()).toHaveText(
					"Agent verified the change.",
				);
				await expect(reply).toBeFocused();
				await expect(reply).toHaveValue("Unsent reviewer reply");
				await expect(thread.locator(".prx-review-thread-status")).toHaveText(
					locale === "fr" ? "Résolu par Agent" : "Resolved by Agent",
				);
				await reply.press("Tab");
				await page.keyboard.press("Enter");
				await expect(thread.locator(".prx-review-thread-status")).toHaveText(
					locale === "fr" ? "Ouvert" : "Open",
				);
				await expect(thread.locator(".prx-review-reply-toggle")).toBeFocused();
				await page.reload();
				await openComments(page);
				await expect(thread.locator(".prx-review-comment-text").last()).toHaveText(
					"Unsent reviewer reply",
				);
				await expect(thread.locator(".prx-review-message-author")).toHaveText(
					locale === "fr" ? ["Vous", "Agent", "Vous"] : ["You", "Agent", "You"],
				);
			});
			test("all-page jumps focus the slide or lesson and missing targets remain readable at narrow reflow", async ({
				page,
			}) => {
				const missing = page.locator(`[data-thread-id="${threadId}"]`);
				await missing.locator(".prx-review-show").click();
				await expect(page.locator(".prx-review-status")).toHaveText(
					locale === "fr" ? "Cible supprimée" : "Target deleted",
				);
				const second = page.locator(".prx-review-comment").filter({ hasText: "Review page 2" });
				await expect(second.locator(".prx-review-anchor-status")).toHaveText(
					locale === "fr" ? "Sur une autre page" : "On another page",
				);
				await second.locator(".prx-review-show").focus();
				await page.keyboard.press("Enter");
				await expect(
					page.locator(
						`${deck ? `[data-deck-slide="${ids[1]}"]` : "main"} [data-node-id="${nodeIds[1]}"]`,
					),
				).toBeFocused();
				await expect(page.locator(".prx-review-comment")).toHaveCount(3);
				await page
					.locator(".prx-review-comment")
					.filter({ hasText: "Review page 3" })
					.locator(".prx-review-show")
					.click();
				await expect(
					page.locator(
						`${deck ? `[data-deck-slide="${ids[2]}"]` : "main"} [data-node-id="${nodeIds[2]}"]`,
					),
				).toBeFocused();
				await page.setViewportSize({ width: 390, height: 844 });
				await page.evaluate(() => {
					document.documentElement.style.fontSize = "400%";
				});
				const content = page.locator(".prx-review-content");
				expect(await content.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
				for (const control of await page
					.locator(".prx-review-sidebar button:visible,.prx-review-filter:visible")
					.all()) {
					const box = await control.boundingBox();
					expect(box?.height).toBeGreaterThanOrEqual(44);
				}
				const collapse = page.getByRole("button", {
					name: locale === "fr" ? "Réduire les commentaires" : "Collapse comments",
					exact: true,
				});
				await expect(collapse).toHaveCount(1);
				await collapse.focus();
				await page.keyboard.press("Enter");
				const expand = page.getByRole("button", {
					name: locale === "fr" ? "Développer les commentaires" : "Expand comments",
					exact: true,
				});
				await expect(expand).toBeFocused();
				await expect(expand).toHaveAttribute("aria-expanded", "false");
			});
			if (deck)
				for (const width of [1280, 390])
					test(`comments open by pointer and keyboard at ${width}px`, async ({ page }) => {
						await page.setViewportSize({ width, height: 900 });
						for (const keyboard of [false, true]) {
							await page.goto(url);
							await openComments(page, keyboard);
							const collapse = page.getByRole("button", {
								name: locale === "fr" ? "Réduire les commentaires" : "Collapse comments",
								exact: true,
							});
							await expect(collapse).toHaveCount(1);
							await expect(collapse).toBeVisible();
							await expect(page.locator("#deck-more-toggle")).toHaveAttribute(
								"aria-expanded",
								"false",
							);
							if (keyboard) {
								await collapse.focus();
								await page.keyboard.press("Enter");
							} else await collapse.click();
							const expand = page.getByRole("button", {
								name: locale === "fr" ? "Développer les commentaires" : "Expand comments",
								exact: true,
							});
							await expect(expand).toHaveCount(1);
							await expect(expand).toBeVisible();
							await expect(expand).toBeFocused();
						}
					});
			test("cross-lesson jumps protect an unsent reply with a keyboard-operable dialog", async ({
				page,
			}) => {
				const first = page.locator(`[data-thread-id="${threadId}"]`);
				await first.locator(".prx-review-reply-toggle").click();
				await first.locator("textarea").fill("Unsent reply to keep");
				const show = page
					.locator(".prx-review-comment")
					.filter({ hasText: "Review page 3" })
					.locator(".prx-review-show");
				await show.focus();
				await page.keyboard.press("Enter");
				const dialog = page.getByRole("dialog", {
					name:
						locale === "fr"
							? "Vous avez des modifications de révision non envoyées. Quitter quand même ?"
							: "You have unsent review changes. Leave anyway?",
				});
				await expect(dialog).toBeVisible();
				await expect(
					dialog.getByRole("button", { name: locale === "fr" ? "Annuler" : "Cancel", exact: true }),
				).toBeFocused();
				await page.keyboard.press("Escape");
				await expect(dialog).not.toBeVisible();
				await expect(show).toBeFocused();
				await expect(first.locator("textarea")).toHaveValue("Unsent reply to keep");
				await page.keyboard.press("Enter");
				await page.keyboard.press("Tab");
				await page.keyboard.press("Enter");
				await expect(
					page.locator(
						`${deck ? `[data-deck-slide="${ids[2]}"]` : "main"} [data-node-id="${nodeIds[2]}"]`,
					),
				).toBeFocused();
				await expect(page).not.toHaveURL(/review-thread=/);
			});
			test("filters announce counts and a reviewer can explicitly reopen by keyboard", async ({
				page,
			}) => {
				const principal = await store.principalFor("author", "local-cli");
				const listed = await store.list(principal);
				if (!("threads" in listed)) throw new Error(listed.code);
				const current = listed.threads.find((thread) => thread.id === threadId);
				if (!current) throw new Error("Missing fixture thread");
				const closed = await store.resolve(principal, {
					reviewId: store.reviewId,
					threadId,
					expectVersion: current.version,
					requestId: randomUUID(),
					body: "Verified for reopen journey",
				});
				expect(closed.ok).toBe(true);
				await page.evaluate(() => window.dispatchEvent(new Event("focus")));
				const thread = page.locator(`[data-thread-id="${threadId}"]`);
				await expect(thread.locator(".prx-review-thread-status")).toHaveText(
					locale === "fr" ? "Résolu par Agent" : "Resolved by Agent",
				);
				await page.locator('[data-review-filter="resolved"]').check();
				await expect(page.locator(".prx-review-status")).toHaveText(
					locale === "fr" ? "1 commentaire, filtre : Résolu." : "1 comment, filter: Resolved.",
				);
				await expect(page.locator(".prx-review-comment:visible")).toHaveCount(1);
				await thread.locator(".prx-review-reopen").focus();
				await page.keyboard.press("Enter");
				await expect(thread).toBeFocused();
				await expect(thread.locator(".prx-review-thread-status")).toHaveText(
					locale === "fr" ? "Ouvert" : "Open",
				);
				await expect(page.locator('[data-review-filter="all"]')).toBeChecked();
			});
		});
	}
}
