import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { ReviewAnchor } from "@praxity/review-share/review";
import { colorToHex, contrastRatio } from "@praxity/shared-blocks/color-math";
import { JSDOM } from "jsdom";
import { runPraxityCli } from "../../src/main/cli";
import { openReviewStore } from "../../src/main/studio/review-store";
import type { StudioServer } from "../../src/main/studio/server";

const stem =
	"A grower moves seedlings from the cold frame to the open bed in late spring. Which check should come first before the move?";
const source = `---
title: Growing together
---
# Sort the seedlings

The greenhouse team sorts young plants by their growing needs. Each tray has a label showing when its seeds were planted.

Before moving a tray outdoors, compare the weather with the plants' needs. Keep a small notebook beside the greenhouse door to record observations.

::: choice ${stem} {dontKnow=false}
(x) Check the overnight forecast and harden off the young plants.
( ) Move every tray outside before checking the soil temperature.
( ) Water the leaves heavily and leave the roots completely dry.
( ) Remove all tray labels before deciding where plants should grow.
:::

# Water on a schedule

Check the soil each morning before watering the growing beds.
`;

for (const locale of ["en", "fr"] as const) {
	test.describe(`${locale} review panel polish`, () => {
		let root: string, url: string, projectDir: string, assetsDir: string, server: StudioServer;
		let threadId: string;
		const courseManifest = `title: Greenhouse basics\nlang: ${locale}\ndesign:\n  navArchetype: sidebar\n  colorMode: auto\n  navEdgeArrows: true\nlessons: [beds.prax]\n`;
		const copy =
			locale === "fr"
				? {
						expand: "Développer les commentaires",
						close: "Fermer les commentaires",
						choose: "Commenter…",
						pin: "Repère",
						edit: "Modifier le texte",
						whole: "Toute la page",
						next: "Suivant",
						title: "Commentaire sur toute la page",
						field: "Commentaire",
						current: "Page actuelle",
					}
				: {
						expand: "Expand comments",
						close: "Close comments",
						choose: "Comment on…",
						pin: "Pin",
						edit: "Edit text",
						whole: "Whole page",
						next: "Next",
						title: "Comment on whole page",
						field: "Comment",
						current: "Current page",
					};

		test.beforeAll(async () => {
			root = await mkdtemp(
				join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "review-panel-polish-"),
			);
			projectDir = join(root, "course");
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
			await writeFile(join(projectDir, "course.yaml"), courseManifest);
			await writeFile(
				join(projectDir, "beds.prax"),
				source.replace("title: Growing together", `title: Growing together\nlang: ${locale}`),
			);
			await startServer();
			const response = await fetch(url);
			url = response.url;
			const parsed = new JSDOM(await response.text());
			const config = JSON.parse(
				parsed.window.document.querySelector("#praxity-review-config")?.textContent ?? "null",
			);
			const questionId = parsed.window.document
				.querySelector('[data-block-type="assessment"][data-node-id]')
				?.getAttribute("data-node-id");
			parsed.window.close();
			if (!questionId) throw new Error("Missing question identity");
			const store = await openReviewStore(projectDir);
			const reviewer = await store.principalFor("reviewer", "local-preview"),
				agent = await store.principalFor("author", "local-cli");
			const anchor: ReviewAnchor = {
				courseId: null,
				lessonId: config.page.lessonId,
				pageId: config.page.pageId,
				nodeId: null,
				blockId: null,
				revision: config.page.revision,
				quote: null,
				pin: null,
				tab: null,
				revealPath: [],
				cssPath: null,
				context: { pageTitle: "Predict the seedlings", targetLabel: null },
			};
			for (const [index, target] of [
				anchor,
				{
					...anchor,
					nodeId: questionId,
					context: { pageTitle: "Predict the seedlings", targetLabel: stem },
				},
				{
					...anchor,
					pageId: "removed-compost-page",
					context: { pageTitle: "Compost notes", targetLabel: null },
				},
			].entries()) {
				const created = await store.create(reviewer, {
					reviewId: store.reviewId,
					requestId: randomUUID(),
					anchor: target,
					body: [
						"Could we explain how to sort the trays?",
						"Keep the question beside its context.",
						"Keep these compost notes for the next planting.",
					][index],
				});
				if (!created.ok || !created.thread) throw new Error(JSON.stringify(created));
				if (index === 0) {
					threadId = created.thread.id;
					const replied = await store.reply(agent, {
						reviewId: store.reviewId,
						threadId,
						expectVersion: created.thread.version,
						requestId: randomUUID(),
						body: "I checked the sequence against our greenhouse notebook. The trays should stay together until we have compared their labels and checked the overnight forecast. We can add a short example showing how two growers share this work, then ask learners to explain their own choice. That will keep the instructions useful when the weather changes during the week.",
					});
					if (!replied.ok) throw new Error(JSON.stringify(replied));
				} else if (index === 1) {
					const resolved = await store.resolve(agent, {
						body: "The question now stays beside its context.",
						reviewId: store.reviewId,
						threadId: created.thread.id,
						expectVersion: created.thread.version,
						requestId: randomUUID(),
					});
					if (!resolved.ok) throw new Error(JSON.stringify(resolved));
				}
			}
		});
		test.afterAll(async () => {
			await server?.close();
			if (root) await rm(root, { recursive: true });
		});
		async function startServer() {
			const started = await runPraxityCli(["studio", projectDir, "--review", "--no-open"], {
				appVersion: "test",
				exportAssetsDir: assetsDir,
				editorAssetsDir: process.env.PRAXITY_BROWSER_EDITOR_ASSETS,
			});
			expect(started.exitCode, started.stderr).toBe(0);
			if (!started.studioServer) throw new Error(started.stderr);
			server = started.studioServer;
			url = (await fetch(server.readyUrl)).url;
		}
		async function setTheme(page: Page, theme: "light" | "dark") {
			await page.emulateMedia({ colorScheme: "light" });
			await expect(page.locator("html")).toHaveAttribute("data-praxity-mode", "light");
			const light = await page
				.locator(".prx-review-sidebar")
				.evaluate((node) => getComputedStyle(node).backgroundColor);
			if (theme === "dark") {
				await page.emulateMedia({ colorScheme: "dark" });
				await expect(page.locator("html")).toHaveAttribute("data-praxity-mode", "dark");
				await expect(page.locator(".prx-review-sidebar")).not.toHaveCSS("background-color", light);
			}
		}
		async function expectOneRow(page: Page, selector: string) {
			const tops = await page
				.locator(selector)
				.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
			expect(tops.length).toBeGreaterThan(1);
			expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
		}
		async function openPanel(page: Page) {
			await page.goto(url);
			await page.getByRole("button", { name: copy.expand, exact: true }).click();
			await page.locator('.prx-review-filters input[value="all"]').check();
			await expect(page.locator(".prx-review-comment")).toHaveCount(3);
		}
		async function compose(page: Page, block = false) {
			await page.getByRole("button", { name: copy.choose, exact: true }).click();
			await page
				.getByRole("radio", { name: block ? /A grower moves seedlings/ : copy.whole, exact: true })
				.check();
			await page
				.locator(".prx-review-picker")
				.getByRole("button", { name: copy.next, exact: true })
				.click();
		}

		test("current titles, composer names and header keyboard order", async ({ page }) => {
			await openPanel(page);
			await expect(page.locator(".prx-review-page-heading")).toHaveText([
				`Sort the seedlings · ${copy.current}`,
				"Compost notes",
			]);
			const controls = [
				page.getByRole("button", { name: copy.close, exact: true }),
				page.getByRole("button", { name: copy.choose, exact: true }),
				page.getByRole("button", { name: copy.pin, exact: true }),
				page.getByRole("link", { name: copy.edit, exact: true }),
			];
			await controls[0].focus();
			for (const control of controls.slice(1)) {
				await page.keyboard.press("Tab");
				await expect(control).toBeFocused();
			}
			for (const control of controls) {
				await expect(control).toHaveCSS("font-weight", "600");
				const box = await control.boundingBox();
				expect(box?.height).toBeGreaterThanOrEqual(44);
			}
			await expect(page.locator(".prx-review-header-actions")).toHaveCSS("gap", "8px");
			await expect(page.locator(".prx-review-header-actions")).toHaveCSS(
				"justify-content",
				"flex-start",
			);
			const titleBox = await page.locator(".prx-review-title").boundingBox();
			const closeBox = await controls[0].boundingBox();
			expect(
				titleBox &&
					closeBox &&
					titleBox.y < closeBox.y + closeBox.height &&
					closeBox.y < titleBox.y + titleBox.height,
			).toBe(true);
			const chooseBox = await controls[1].boundingBox(),
				pinBox = await controls[2].boundingBox(),
				editBox = await controls[3].boundingBox();
			expect(chooseBox?.y).toBe(pinBox?.y);
			if (locale === "en") expect(editBox?.y).toBe(chooseBox?.y);
			await compose(page);
			const dialog = page.getByRole("dialog", { name: copy.title, exact: true });
			await expect(dialog).toBeVisible();
			await expect(dialog.locator(".prx-review-target-preview")).toBeHidden();
			await expect(dialog.locator(".prx-review-count-text")).toHaveText("0 / 2000");
			await expect(dialog).not.toHaveAttribute("aria-describedby");
			await expect(dialog.getByRole("textbox", { name: copy.field, exact: true })).toBeFocused();
			await expect(dialog.locator("label")).toHaveClass(/prx-review-visually-hidden/);
			for (const theme of ["light", "dark"] as const) {
				await setTheme(page, theme);
				const buttons = await dialog
					.locator(".prx-review-actions > button:visible")
					.evaluateAll((nodes) =>
						nodes.map((node) => {
							const style = getComputedStyle(node);
							return {
								weight: style.fontWeight,
								flex: style.flexGrow,
								height: node.getBoundingClientRect().height,
								width: node.getBoundingClientRect().width,
								color: style.color,
								background: style.backgroundColor,
								border: style.borderTopColor,
								panel: getComputedStyle(node.closest("dialog")!).backgroundColor,
							};
						}),
					);
				expect(buttons).toHaveLength(2);
				for (const button of buttons) {
					expect(button.weight).toBe("600");
					expect(button.flex).toBe("0");
					expect(button.height).toBeGreaterThanOrEqual(44);
					expect(
						contrastRatio(colorToHex(button.color)!, colorToHex(button.background)!),
					).toBeGreaterThanOrEqual(4.5);
					expect(
						contrastRatio(colorToHex(button.border)!, colorToHex(button.panel)!),
					).toBeGreaterThanOrEqual(3);
				}
				expect(buttons[0].height).toBe(buttons[1].height);
				expect(buttons[0].background).not.toBe(buttons[1].background);
			}
			await page.emulateMedia({ forcedColors: "active" });
			await page.keyboard.press("Tab");
			await page.keyboard.press("Tab");
			await expect(dialog.locator(".prx-review-cancel")).toBeFocused();
			await expect(dialog.locator(".prx-review-cancel")).toHaveCSS("outline-style", "solid");
			for (const button of await dialog.locator(".prx-review-actions > button:visible").all())
				await expect(button).toHaveCSS("border-top-style", "solid");
			await page.emulateMedia({ forcedColors: "none" });
			await page.keyboard.press("Escape");
			await compose(page, true);
			await expect(page.locator(".prx-review-target-preview")).toBeVisible();
			await expect(page.locator(".prx-review-target-preview")).toContainText(stem);
		});

		if (locale === "en")
			test("panel reserves wide content and releases it on close; narrow layouts reflow", async ({
				page,
			}) => {
				await openPanel(page);
				for (const width of [1024, 1025, 1280, 1440, 1920, 1023, 320, 640]) {
					await page.setViewportSize({ width, height: width === 640 ? 450 : 900 });
					const geometry = await page.locator(".praxity-layout-wrapper").evaluate((wrapper) => ({
						right: wrapper.getBoundingClientRect().right,
						panelLeft: document.querySelector(".prx-review-sidebar")!.getBoundingClientRect().left,
						margin: getComputedStyle(wrapper).marginRight,
						scroll: document.documentElement.scrollWidth,
						viewport: innerWidth,
					}));
					expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport);
					if (width >= 1024) {
						expect(geometry.right).toBeLessThanOrEqual(geometry.panelLeft);
						expect(geometry.margin).toBe("360px");
						const next = page.locator(".praxity-edge-arrow--next");
						await expect(next).toHaveCSS("right", "376px");
						if (width === 1024) await expect(next).toBeHidden();
						else {
							await expect(next).toBeVisible();
							const arrow = await next.boundingBox();
							expect(arrow && arrow.x + arrow.width <= geometry.panelLeft).toBe(true);
						}
					} else expect(geometry.margin).toBe("0px");
					if (width === 640) {
						await expectOneRow(page, ".prx-review-header button, .prx-review-header a");
						const header = await page.locator(".prx-review-header").boundingBox();
						const panel = await page.locator(".prx-review-sidebar").boundingBox();
						expect(header?.height).toBeLessThanOrEqual(64);
						expect(panel && header && panel.height - header.height).toBeGreaterThanOrEqual(180);
					}
				}
				await page.setViewportSize({ width: 1280, height: 900 });
				await page.getByRole("button", { name: copy.close, exact: true }).click();
				await expect(page.locator(".praxity-layout-wrapper")).toHaveCSS("margin-right", "0px");
				await expectOneRow(page, ".prx-review-header button, .prx-review-header a");
			});

		test("C12 panel screenshots", async ({ page }) => {
			const shots = process.env.PRAXITY_C12_PANEL_SCREENSHOTS;
			if (!shots) return;
			await mkdir(shots, { recursive: true });
			for (const theme of ["light", "dark"] as const) {
				await openPanel(page);
				await page.setViewportSize({ width: 1280, height: 900 });
				await setTheme(page, theme);
				const shot = async (
					item: number,
					state: string,
					width: number | string = 1280,
					header = false,
				) => {
					const path = join(shots, `${item}-${state}-${width}-${theme}-${locale}.png`);
					if (header) await page.locator(".prx-review-header").screenshot({ path });
					else await page.screenshot({ path });
				};
				await shot(4, "header", 1280, true);
				if (theme === "light") {
					await shot(2, "groups");
					await page.locator(".prx-review-page-heading").last().scrollIntoViewIfNeeded();
					await shot(2, "groups-missing");
					await page.locator(".prx-review-content").evaluate((node) => {
						node.scrollTop = 0;
					});
				}
				await compose(page);
				await shot(1, "composer-page");
				await page.keyboard.press("Escape");
				if (locale === "en") {
					if (theme === "light") {
						await compose(page, true);
						await shot(1, "composer-block");
						await page.keyboard.press("Escape");
					}
					const thread = page.locator(`[data-thread-id="${threadId}"]`);
					await thread.locator(".prx-review-reply-toggle").click();
					await thread.locator("textarea").fill("Please keep the tray labels visible.");
					await shot(1, "thread-actions");
					await thread.locator(".prx-review-reply-cancel").click();
					await page.locator(".prx-review-content").evaluate((node) => {
						node.scrollTop = 0;
					});
					for (const width of theme === "light" ? [1024, 1280, 1440, 1920, 320, 640] : [1440]) {
						await page.setViewportSize({ width, height: width === 640 ? 450 : 900 });
						await page
							.locator(".praxity-native-outline")
							.evaluate((node) =>
								Promise.all(node.getAnimations().map((animation) => animation.finished)),
							);
						if (width <= 640)
							await page.locator('[data-block-type="assessment"]').scrollIntoViewIfNeeded();
						else await page.evaluate(() => window.scrollTo(0, 0));
						await shot(3, "panel-open", width === 640 ? "640x450" : width);
					}
					if (theme === "light") {
						await page.setViewportSize({ width: 1280, height: 900 });
						await page.emulateMedia({ forcedColors: "active" });
						await page.getByRole("button", { name: copy.close, exact: true }).focus();
						await page.keyboard.press("Tab");
						await expect(page.getByRole("button", { name: copy.choose, exact: true })).toHaveCSS(
							"outline-style",
							"solid",
						);
						await shot(4, "forced", 1280, true);
						await compose(page);
						await shot(1, "forced");
						await page.keyboard.press("Escape");
						await page.emulateMedia({ forcedColors: "none" });
						await page.getByRole("button", { name: copy.close, exact: true }).click();
						await page.evaluate(() => window.scrollTo(0, 0));
						await shot(3, "collapsed");
					}
				}
			}
		});

		if (locale === "en")
			test("bottom-bar collapsed toolbar stays on one row", async ({ page }) => {
				await server.close();
				await writeFile(
					join(projectDir, "course.yaml"),
					courseManifest.replace("navArchetype: sidebar", "navArchetype: bottomBar"),
				);
				await startServer();
				await page.goto(url);
				await expect(page.locator("body")).toHaveClass(/praxity-layout-bottombar/);
				await expectOneRow(page, ".prx-review-header button, .prx-review-header a");
				const shots = process.env.PRAXITY_C12_PANEL_SCREENSHOTS;
				if (shots)
					await page.screenshot({ path: join(shots, "3-collapsed-bottombar-1280-light-en.png") });
			});
	});
}
