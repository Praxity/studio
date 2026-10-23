import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import AdmZip from "adm-zip";
import handler from "serve-handler";
import { buildScormPackage } from "../../src/build";
import { groupedDeckFixture } from "../fixtures/module-deck";
import { test } from "../muted-test";
import { computedContrast } from "./contrast-helpers";
import { LONG_MATCH } from "./fixtures/activity-bugs-fixture";
import { activityCardsFixture } from "./fixtures/activity-cards-fixture";
import { buildLightweightCourse } from "./fixtures/lightweight-fixture";

let server: Server;
let base: string;
const entries = new Map<string, string>();

async function captureGroup(page: Page, name: string) {
	const directory = process.env.PRAXITY_ACTIVITY_DETAILS_CAPTURES;
	if (!directory || test.info().project.name !== "chromium") return;
	await mkdir(directory, { recursive: true });
	const clip = await page.evaluate(() => {
		const header = document.querySelector('[data-assessment-group-header="details-group"]');
		const footer = document.querySelector('[data-assessment-group-submit="details-group"]');
		if (!header || !footer) throw new Error("Missing group capture boundaries");
		const start = header.getBoundingClientRect();
		const end = footer.getBoundingClientRect();
		return {
			x: start.left + window.scrollX,
			y: start.top + window.scrollY,
			width: start.width,
			height: end.bottom - start.top,
		};
	});
	await page.screenshot({
		path: resolve(directory, `${name}.png`),
		clip,
		fullPage: true,
		style: "header, .praxity-scroll-progress, .praxity-pages-progress { visibility: hidden; }",
	});
}

async function token(target: Locator, property: string, name: string) {
	return target.evaluate(
		(element, { property, name }) => {
			const probe = document.createElement("span");
			probe.style.setProperty(property, getComputedStyle(element).getPropertyValue(name));
			element.parentElement?.append(probe);
			const value = getComputedStyle(probe).getPropertyValue(property);
			probe.remove();
			return value;
		},
		{ property, name },
	);
}

test.beforeAll(async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "activity-details-"));
	for (const locale of ["en", "fr"] as const) {
		for (const layout of ["pages", "deck"] as const) {
			for (const dark of [false, true]) {
				const fixture = activityCardsFixture(locale, dark);
				const blocks = fixture.content[0].blocks;
				const rating = blocks.find((block) => block.id === "rating");
				if (!rating) throw new Error("Missing rating fixture");
				for (const style of ["stars", "emoji", "likert"] as const) {
					const copy = JSON.parse(JSON.stringify(rating), (key, value) =>
						key === "id" && typeof value === "string" ? `${value}-${style}` : value,
					) as typeof rating;
					copy.data.style = style;
					blocks.push(copy);
				}
				const question = blocks.find((block) => block.id === "choice");
				if (!question) throw new Error("Missing choice fixture");
				const members = Array.from({ length: 4 }, (_, index) => {
					const member = JSON.parse(JSON.stringify(question), (key, value) =>
						key === "id" && typeof value === "string" ? `${value}-group-${index}` : value,
					) as typeof question;
					member.id = `group-question-${index}`;
					member.data.attempts = 1;
					member.data.stem = [
						{
							id: `${member.id}-stem`,
							type: "text",
							data: {
								content: locale === "en" ? "What should you do?" : "Que devriez-vous faire ?",
							},
						},
					];
					return member;
				});
				blocks.splice(
					1,
					0,
					{
						id: "details-group",
						type: "assessmentGroup",
						data: {
							groupName: "Review your responses",
							mode: "all",
							requireAll: true,
							showResultsSummary: true,
							memberBlockIds: members.map((member) => member.id),
						},
					},
					{
						id: "group-context",
						type: "text",
						data: { content: "Answer each question before checking your responses." },
					},
					...members,
				);
				const grouped = groupedDeckFixture();
				const course = {
					...grouped,
					...fixture,
					navigationStyle: layout === "deck" ? ("slides" as const) : ("sidebar" as const),
					moduleDeck: layout === "deck" ? { gates: {} } : undefined,
					content: [
						grouped.content[0],
						{
							...fixture.content[0],
							id: "details-slide",
							lessonId: "group-module",
							lessonTitle: "Activity details",
							isFirstPageOfLesson: false,
						},
					],
				};
				const key = `${locale}-${layout}-${dark ? "dark" : "light"}`;
				const output = resolve(directory, key);
				await mkdir(output);
				const result = await buildScormPackage(course, { format: "html" });
				const zip = new AdmZip(result.zip);
				zip.extractAllTo(output);
				const entry = zip
					.getEntries()
					.find(
						(file) =>
							file.entryName.endsWith(".html") &&
							file.getData().toString().includes('data-assessment-group-header="details-group"'),
					);
				if (!entry) throw new Error(`Missing activity details in ${key}`);
				entries.set(key, `/${key}/${entry.entryName}`);
			}
		}
	}
	for (const palette of ["ink", "forest", "plum", "clay", "clear"] as const) {
		for (const colorMode of ["light", "dark"] as const) {
			const course = buildLightweightCourse({
				theme: { name: `${palette}-${colorMode}`, palette, colorMode },
			});
			const checklist = activityCardsFixture("en").content[0].blocks.find(
				(block) => block.id === "checklist",
			);
			if (!checklist) throw new Error("Missing checklist fixture");
			course.content = [{ id: "checklist-page", title: "Checklist", blocks: [checklist] }];
			const key = `checklist-${palette}-${colorMode}`;
			const output = resolve(directory, key);
			await mkdir(output);
			const result = await buildScormPackage(course, { format: "html" });
			const zip = new AdmZip(result.zip);
			zip.extractAllTo(output);
			const entry = zip
				.getEntries()
				.find(
					(file) =>
						file.entryName.endsWith(".html") &&
						file.getData().toString().includes('data-block-id="checklist"'),
				);
			if (!entry) throw new Error("Missing checklist output");
			entries.set(key, `/${key}/${entry.entryName}`);
		}
	}
	server = createServer(
		(req, res) => void handler(req, res, { public: directory, cleanUrls: false }),
	);
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

for (const locale of ["en", "fr"] as const) {
	for (const layout of ["pages", "deck"] as const) {
		for (const width of [1280, 390]) {
			for (const direction of ["ltr", "rtl"] as const) {
				test(`group summary ${locale} ${layout} ${width} ${direction}`, async ({ page }) => {
					await page.setViewportSize({ width, height: 900 });
					await page.emulateMedia({ reducedMotion: "reduce" });
					await page.goto(
						`${base}${entries.get(`${locale}-${layout}-light`)}?praxity-inspect=1#details-slide`,
					);
					await page.evaluate((dir) => {
						document.documentElement.dir = dir;
					}, direction);
					const members = page.locator('.praxity-block[data-assessment-group="details-group"]');
					await expect(members).toHaveCount(4);
					for (const [index, member] of (await members.all()).entries()) {
						await member.scrollIntoViewIfNeeded();
						await expect(member).toHaveAttribute("data-hydrated", "");
						await member
							.getByRole("radio", {
								name: index === 3 ? /^Interrupt/ : "Listen",
								exact: index !== 3,
							})
							.check();
					}
					const header = page.locator('[data-assessment-group-header="details-group"]');
					const card = members.first().locator(":scope > .praxity-block-assessment");
					for (const target of [
						header.locator(".praxity-assessment-group-title"),
						header.locator("[data-assessment-group-progress]"),
						page.locator('[data-block-id="group-context"]'),
					]) {
						const geometry = await target.boundingBox();
						const edge = await card.boundingBox();
						if (!geometry || !edge) throw new Error("Missing group geometry");
						expect.soft(Math.abs(geometry.x - edge.x)).toBeLessThanOrEqual(0.5);
					}
					const submit = page.locator('[data-assessment-group-submit="details-group"] button');
					await submit.scrollIntoViewIfNeeded();
					const before = await page.evaluate(() => window.scrollY);
					await submit.click();
					const summary = page.locator("[data-assessment-group-results] .praxity-ag-results-score");
					await expect
						.soft(summary)
						.toContainText(locale === "en" ? "3 of 4 correct" : "3 sur 4 correctes");
					if (layout === "deck") {
						const next = page.locator("#deck-next");
						await expect(next).toBeFocused();
						await expect(next).toHaveAccessibleDescription(
							locale === "en"
								? "3 of 4 correct · Score: 75% - Not passed"
								: "3 sur 4 correctes · Score : 75 % - Non réussi",
						);
						await expect(summary).not.toHaveAttribute("tabindex");
					} else await expect(summary).toBeFocused();
					await expect(summary).not.toHaveAttribute("role");
					await expect(summary).toHaveAccessibleName("");
					expect(await page.evaluate(() => window.scrollY)).toBe(before);
					const summaryBox = await summary.boundingBox();
					const cardBox = await card.boundingBox();
					if (!summaryBox || !cardBox) throw new Error("Missing summary geometry");
					expect.soft(Math.abs(summaryBox.x - cardBox.x)).toBeLessThanOrEqual(0.5);
					await expect(
						page.locator("[data-assessment-group-results] :is(ul,ol), .praxity-ag-results-title"),
					).toHaveCount(0);
					const links = page.locator("[data-assessment-group-results] a");
					await expect.soft(links).toHaveCount(4);
					const announcement = await summary.evaluate((element) => {
						const liveSelector = '[aria-live], [role="status"]';
						return {
							focused:
								document.activeElement === element ||
								document.activeElement?.getAttribute("aria-describedby") ===
									element.querySelector("span")?.id,
							live: [...document.querySelectorAll(liveSelector)].some((live) =>
								live.textContent?.includes(element.textContent ?? ""),
							),
							linksOutsideLive: [...document.querySelectorAll(".praxity-ag-review-links a")].every(
								(link) => link.closest(liveSelector) === null,
							),
						};
					});
					expect(announcement.linksOutsideLive).toBe(true);
					expect(Number(announcement.focused) + Number(announcement.live)).toBe(1);
					for (const [index, link] of (await links.all()).entries()) {
						const name =
							locale === "en"
								? `Question ${index + 1}: What should you do?`
								: `Question ${index + 1} : Que devriez-vous faire ?`;
						await expect(link).toHaveAccessibleName(name);
						expect(await link.textContent()).toBe(
							locale === "en" ? name : name.replace(" :", "\u00a0:"),
						);
						// Firefox loses precision when Playwright serializes the rectangle coordinates.
						const targetHeight = await link.evaluate(
							(element) => element.getBoundingClientRect().height,
						);
						expect.soft(targetHeight).toBeGreaterThanOrEqual(44);
						await link.focus();
						await page.keyboard.press("Enter");
						const heading = members.nth(index).locator(".praxity-assessment-stem");
						await expect(heading).toBeFocused();
						const destination = await heading.evaluate((element) => {
							const box = element.getBoundingClientRect();
							const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
							const chrome = [
								...document.querySelectorAll(".praxity-top-bar-fallback, .deck-identity"),
							]
								.filter((header) => header.checkVisibility())
								.map((header) => header.getBoundingClientRect().bottom);
							return {
								top: box.top,
								headerBottom: Math.max(0, ...chrome),
								visible: !!hit && element.contains(hit),
							};
						});
						expect.soft(destination.top).toBeGreaterThanOrEqual(destination.headerBottom);
						expect.soft(destination.visible).toBe(true);
						const captures = process.env.PRAXITY_ACTIVITY_DETAILS_CAPTURES;
						if (
							captures &&
							locale === "en" &&
							direction === "ltr" &&
							index === 1 &&
							test.info().project.name === "chromium"
						) {
							await mkdir(captures, { recursive: true });
							await page.screenshot({
								path: resolve(captures, `${locale}-${layout}-${width}-review-focus.png`),
							});
						}
					}
				});
			}
		}
	}
	for (const dark of [false, true]) {
		for (const width of [1280, 390]) {
			// Separate independent journeys: WebKit's light desktop frame waits exhaust a combined 30s test.
			const open = async (page: Page) => {
				await page.setViewportSize({ width, height: 900 });
				await page.emulateMedia({ reducedMotion: "reduce" });
				await page.goto(
					`${base}${entries.get(`${locale}-pages-${dark ? "dark" : "light"}`)}?praxity-inspect=1#details-slide`,
				);
			};
			const capture = async (page: Page, id: string, state = "") => {
				if (
					locale !== "en" ||
					test.info().project.name !== "chromium" ||
					!process.env.PRAXITY_ACTIVITY_DETAILS_CAPTURES
				)
					return;
				await mkdir(process.env.PRAXITY_ACTIVITY_DETAILS_CAPTURES, { recursive: true });
				await page
					.locator(`[data-block-id="${id}"]`)
					.first()
					.screenshot({
						path: resolve(
							process.env.PRAXITY_ACTIVITY_DETAILS_CAPTURES,
							`${locale}-${dark ? "clay-dark" : "ink-light"}-${width}-${id}${state}.png`,
						),
					});
			};
			test(`activity controls ${locale} ${dark ? "dark" : "light"} ${width} assessment feedback`, async ({
				page,
			}) => {
				await open(page);
				const members = page.locator('.praxity-block[data-assessment-group="details-group"]');
				for (const member of await members.all()) {
					await member.scrollIntoViewIfNeeded();
					await expect(member).toHaveAttribute("data-hydrated", "");
				}
				if (locale === "en")
					await captureGroup(
						page,
						`${locale}-${dark ? "clay-dark" : "ink-light"}-${width}-group-before`,
					);
				for (const [index, member] of (await members.all()).entries())
					await member
						.getByRole("radio", { name: index === 3 ? /^Interrupt/ : "Listen", exact: index !== 3 })
						.check();
				await page.locator('[data-assessment-group-submit="details-group"] button').click();
				await expect(page.locator(".praxity-ag-results-score")).toContainText(
					locale === "en" ? "3 of 4 correct" : "3 sur 4 correctes",
				);
				if (locale === "en")
					await captureGroup(
						page,
						`${locale}-${dark ? "clay-dark" : "ink-light"}-${width}-group-after`,
					);
				const choice = page.locator('[data-island="assessment"][data-block-id="choice"]');
				await choice.scrollIntoViewIfNeeded();
				await choice.getByRole("radio", { name: /^Interrupt/ }).check();
				const primary = choice.locator("[data-assessment-submit]");
				await expect.soft(primary).toHaveText(locale === "en" ? "Submit" : "Soumettre");
				await expect.soft(primary).toHaveCSS("border-radius", "10px");
				await expect
					.soft(primary)
					.toHaveCSS("background-color", await token(primary, "background-color", "--accent"));
				await choice.locator("[data-assessment-submit]").click();
				const retry = choice.getByRole("button", {
					name: locale === "en" ? "Try again" : "Réessayer",
					exact: true,
				});
				await expect.soft(retry).toBeVisible();
				await expect.soft(retry).toHaveCSS("border-radius", "10px");
				await expect
					.soft(retry)
					.toHaveCSS("border-top-color", await token(retry, "color", "--line-mid"));
				await expect
					.soft(retry)
					.toHaveCSS("background-color", await token(retry, "background-color", "--paper"));
				const gap = await retry.evaluate((button) => {
					const feedback = button
						.closest("[data-assessment-feedback]")
						?.querySelector("[data-feedback-details]");
					if (!feedback) throw new Error("Missing question feedback");
					return button.getBoundingClientRect().top - feedback.getBoundingClientRect().bottom;
				});
				expect.soft(gap).toBeGreaterThanOrEqual(0);
				expect.soft(gap).toBeLessThanOrEqual(24);
				await capture(page, "choice", "-retry");
				await expect.soft(retry).toHaveCSS("transition-duration", "0s");
				const retryBox = await retry.boundingBox();
				if (!retryBox) throw new Error("Missing retry button geometry");
				await page.mouse.move(retryBox.x + retryBox.width / 2, retryBox.y + retryBox.height / 2);
				await page.mouse.down();
				await expect.soft(retry).toHaveCSS("transform", "matrix(0.96, 0, 0, 0.96, 0, 0)");
				await page.mouse.up();
			});
			test(`activity controls ${locale} ${dark ? "dark" : "light"} ${width} categorize`, async ({
				page,
			}) => {
				await open(page);
				const categorize = page.locator('[data-island="assessment"][data-block-id="categorize"]');
				await categorize.scrollIntoViewIfNeeded();
				await expect.soft(categorize).toHaveAttribute("data-hydrated", "");
				await expect.soft(categorize.locator("tbody th").first()).toHaveCSS("font-weight", "400");
				const wrap = categorize.locator(".praxity-categorize-table-wrap");
				const tableCorners = await wrap.evaluate((element) => {
					const card = element.closest(".praxity-block-assessment:not(.praxity-block)");
					if (!card) throw new Error("Missing table card");
					return {
						inset: element.getBoundingClientRect().left - card.getBoundingClientRect().left,
						radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
					};
				});
				expect.soft([0, 4, 6, 10, 16]).toContain(tableCorners.radius);
				expect.soft(tableCorners.inset + tableCorners.radius).toBeGreaterThanOrEqual(16);
				for (const [index, row] of (await categorize.locator("tbody tr").all()).entries())
					await row
						.getByRole("radio")
						.nth(index < 3 ? 0 : 1)
						.check();
				await categorize.locator("[data-assessment-submit]").click();
				await expect.soft(categorize.locator("[data-row-result]")).toHaveCount(4);
				await expect.soft(categorize.locator("[data-row-result] svg")).toHaveCount(4);
				await expect
					.soft(categorize.locator("[data-row-summary]"))
					.toHaveText(locale === "en" ? "3 of 4 correct" : "3 sur 4 corrects");
				await capture(page, "categorize");
			});
			test(`activity controls ${locale} ${dark ? "dark" : "light"} ${width} matching`, async ({
				page,
			}) => {
				await open(page);
				const matching = page.locator('[data-island="assessment"][data-block-id="matching"]');
				await matching.scrollIntoViewIfNeeded();
				await matching.getByRole("combobox").click();
				await page.getByRole("option", { name: LONG_MATCH, exact: true }).click();
				const answer = matching.locator(".praxity-matching-value");
				await expect.soft(answer).toHaveText(LONG_MATCH);
				await expect.soft(answer).toBeVisible();
				await expect
					.soft(answer)
					.toHaveCSS("font-size", await token(answer, "font-size", "--type-body"));
				expect
					.soft(await answer.evaluate((element) => element.scrollWidth <= element.clientWidth))
					.toBe(true);

				await expect
					.soft(matching.getByRole("combobox"))
					.toHaveCSS(
						"border-top-color",
						await token(answer, "color", "--praxity-color-control-border"),
					);
				expect
					.soft(await computedContrast(matching.getByRole("combobox"), "borderTopColor"))
					.toBeGreaterThanOrEqual(3);
				expect
					.soft(await computedContrast(matching.getByRole("combobox"), "borderTopColor", false))
					.toBeGreaterThanOrEqual(3);
				await capture(page, "matching");
				const chevron = matching.locator(".mantine-ComboboxChevron-chevron");
				await expect.soft(chevron).toHaveCSS("color", await token(chevron, "color", "--ink-2"));
				expect.soft(await computedContrast(chevron)).toBeGreaterThanOrEqual(3);
			});
			test(`activity controls ${locale} ${dark ? "dark" : "light"} ${width} journal and supporting controls`, async ({
				page,
			}) => {
				await open(page);
				const rating = page.locator('[data-island="rating"][data-block-id="rating"]');
				await rating.scrollIntoViewIfNeeded();
				await expect
					.soft(rating.locator(".praxity-rating-endpoints"))
					.toHaveText("RarelyVery often");
				const value = rating.locator(".praxity-rating-option").nth(4);
				const scroll = await page.evaluate(() => window.scrollY);
				await value.click();
				expect.soft(await page.evaluate(() => window.scrollY)).toBe(scroll);
				await expect.soft(value).toHaveCSS("border-top-width", "2px");
				await expect
					.soft(value)
					.toHaveCSS("border-top-color", await token(value, "color", "--accent"));
				await expect
					.soft(value)
					.toHaveCSS("background-color", await token(value, "background-color", "--accent-soft"));
				expect.soft((await value.boundingBox())?.height).toBeGreaterThanOrEqual(44);
				await capture(page, "rating");
				const checklist = page.locator('[data-block-id="checklist"]');
				const checkbox = checklist.getByRole("checkbox");
				await expect.soft(checkbox).toHaveCSS("width", "22px");
				await expect
					.soft(checkbox)
					.toHaveCSS("border-top-color", await token(checkbox, "color", "--ink-2"));
				expect.soft(await computedContrast(checkbox, "borderTopColor")).toBeGreaterThanOrEqual(3);
				await capture(page, "checklist");
				const signature = page.locator('[data-block-id="signature"]');
				await expect
					.soft(signature.locator(".praxity-signature-label"))
					.toHaveCSS("font-size", await token(signature, "font-size", "--type-body"));
				await expect
					.soft(signature.locator(".praxity-signature-status").last())
					.toHaveCSS("font-size", await token(signature, "font-size", "--type-small"));
				await capture(page, "signature");
				const journal = page.locator('[data-island="assessment"][data-block-id="journal"]');
				await journal.scrollIntoViewIfNeeded();
				const response =
					locale === "en" ? "A response to keep." : "Une r\u00e9ponse conserv\u00e9e.";
				await journal.getByRole("textbox").fill(response);
				for (const [name, extension] of [
					[locale === "en" ? "Download as text" : "Télécharger en texte", ".txt"],
					[locale === "en" ? "Download as Word" : "Télécharger en Word", ".docx"],
				]) {
					const button = journal.getByRole("button", { name, exact: true });
					await expect.soft(button).toHaveCSS("border-radius", "10px");
					await expect
						.soft(button)
						.toHaveCSS("border-top-color", await token(button, "color", "--line-mid"));
					await button.hover();
					const idleFrames = await button.evaluate(async (element) => {
						const frames = [];
						for (let index = 0; index < 3; index++) {
							await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
							const { x, y, width, height } = element.getBoundingClientRect();
							frames.push({
								x,
								y,
								width,
								height,
								scrollY,
								animations: element
									.getAnimations({ subtree: true })
									.filter((animation) => animation.pending || animation.playState === "running")
									.length,
							});
						}
						return frames;
					});
					expect(idleFrames.map((frame) => frame.animations)).toEqual([0, 0, 0]);
					expect(new Set(idleFrames.map((frame) => JSON.stringify(frame))).size).toBe(1);
					const downloaded = page.waitForEvent("download");
					await button.click();
					const download = await downloaded;
					expect.soft(download.suggestedFilename()).toContain(extension);
					const file = await download.path();
					if (!file) throw new Error("Missing journal download");
					const bytes = await readFile(file);
					const content =
						extension === ".txt"
							? bytes.toString("utf8")
							: await page.evaluate((xml) => {
									const document = new DOMParser().parseFromString(xml, "application/xml");
									if (document.querySelector("parsererror"))
										throw new Error("Invalid DOCX document XML");
									return document.documentElement.textContent;
								}, new AdmZip(bytes).readAsText("word/document.xml"));
					expect.soft(content).toContain(response);
				}
				await capture(page, "journal");
			});
		}
	}
}

for (const palette of ["ink", "forest", "plum", "clay", "clear"] as const) {
	for (const mode of ["light", "dark"] as const) {
		test(`checklist boundary contrast ${palette} ${mode}`, async ({ page }) => {
			await page.goto(`${base}${entries.get(`checklist-${palette}-${mode}`)}`);
			const checkbox = page.getByRole("checkbox");
			await expect(checkbox).toHaveCSS("width", "22px");
			await expect(checkbox).toHaveCSS(
				"border-top-color",
				await token(checkbox, "color", "--ink-2"),
			);
			expect(await computedContrast(checkbox, "borderTopColor")).toBeGreaterThanOrEqual(3);
		});
	}
}

for (const width of [1280, 390]) {
	test(`rating value styles ${width}`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${base}${entries.get("en-pages-light")}?praxity-inspect=1#details-slide`);
		for (const style of ["stars", "emoji", "likert"]) {
			const rating = page.locator(`[data-block-id="rating-${style}"]`);
			await rating.scrollIntoViewIfNeeded();
			await expect(rating).toHaveAttribute("data-hydrated", "");
			const value = rating.locator(".praxity-rating-option").nth(4);
			const before = await page.evaluate(() => scrollY);
			await value.click();
			expect(await page.evaluate(() => scrollY)).toBe(before);
			await expect(value).toHaveCSS("border-radius", "10px");
			await expect(value).toHaveCSS("border-top-width", "2px");
			await expect(value).toHaveCSS("border-top-color", await token(value, "color", "--accent"));
			await expect(value).toHaveCSS(
				"background-color",
				await token(value, "background-color", "--accent-soft"),
			);
		}
	});
}
