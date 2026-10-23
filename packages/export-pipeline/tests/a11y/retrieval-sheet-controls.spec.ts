import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { writeRetrievalSheetHarness } from "./fixtures/retrieval-sheet-harness";

let directory: string;
let url: string;
let server: ReturnType<typeof createServer>;

test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "retrieval-sheet-controls-"));
	await writeRetrievalSheetHarness(directory, true);
	server = createServer(async (request, response) => {
		const file = resolve(directory, `.${new URL(request.url ?? "/", "http://localhost").pathname}`);
		if (!file.startsWith(directory + sep)) {
			response.writeHead(403).end();
			return;
		}
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
});

test.afterAll(async () => {
	if (server)
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done())),
		);
	if (directory) await rm(directory, { recursive: true, force: true });
});

const copy = {
	en: {
		front: "Front",
		back: "Back",
		another: "Another date",
		date: "Date",
		print: "Print the sheet",
	},
	fr: {
		front: "Recto",
		back: "Verso",
		another: "Une autre date",
		date: "Date",
		print: "Imprimer la feuille",
	},
};

for (const lang of ["en", "fr"] as const) {
	for (const mode of ["light", "dark"]) {
		test.describe(`${lang} ${mode} layout states`, () => {
			let page: Page;
			let context: BrowserContext;
			test.beforeAll(async ({ browser }) => {
				context = await browser.newContext();
				page = await context.newPage();
				await page.clock.setFixedTime(new Date("2026-10-17T12:00:00"));
				await page.goto(`${url}/${lang}-${mode}-3.html`);
				await expect(page.getByRole("tab", { name: copy[lang].front, exact: true })).toBeVisible();
			});
			test.afterAll(async () => {
				await context?.close();
			});
			for (const width of [1280, 320]) {
				for (const state of ["front", "back", "invalid"] as const) {
					test(`${width}px ${state}: controls, reflow and axe`, async () => {
						await page.setViewportSize({ width, height: 900 });
						await page.getByRole("tab", { name: copy[lang].front, exact: true }).click();
						await page.locator('input[value="7"]').check();
						await expect(
							page.getByRole("tab", { name: copy[lang].front, exact: true }),
						).toHaveAttribute("aria-selected", "true");
						await expect(page.locator('input[value="7"]')).toBeChecked();
						await expect(page.locator("link[rel=stylesheet]").first()).toHaveAttribute(
							"href",
							/^retrieval-sheet\.[a-f0-9]{12}\.css$/,
						);
						await expect(page.getByRole("tab").first()).toHaveCSS("white-space", "normal");
						if (state === "back")
							await page.getByRole("tab", { name: copy[lang].back, exact: true }).click();
						if (state === "invalid") {
							await page.getByRole("radio", { name: copy[lang].another, exact: true }).check();
							await page.getByLabel(copy[lang].date, { exact: true }).fill("");
							await page.getByRole("tab", { name: copy[lang].front, exact: true }).focus();
							await expect(page.getByLabel(copy[lang].date, { exact: true })).toHaveAttribute(
								"aria-invalid",
								"true",
							);
							await expect(page.getByLabel(copy[lang].date, { exact: true })).toHaveAttribute(
								"aria-describedby",
								/date-error$/,
							);
							await expect(page.getByRole("button", { name: copy[lang].print })).toBeDisabled();
						}
						await expect(page.locator("[role=tabpanel]:visible")).toHaveCount(1);
						expect(
							await page
								.locator("[data-retrieval-sheet]")
								.evaluate((el) => el.scrollWidth - el.clientWidth),
						).toBeLessThanOrEqual(1);
						expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
						if (state === "back" && process.env.PRAXITY_RETRIEVAL_SCREENSHOTS)
							await page.screenshot({
								path: join(
									process.env.PRAXITY_RETRIEVAL_SCREENSHOTS,
									`${lang}-${mode}-${width}-back.png`,
								),
								fullPage: true,
							});
					});
				}
			}
		});
	}
}

test.describe("date and print transitions", () => {
	let page: Page;
	let context: BrowserContext;
	test.beforeAll(async ({ browser }) => {
		context = await browser.newContext();
		page = await context.newPage();
		await page.clock.setFixedTime(new Date("2026-10-17T12:00:00"));
		await page.addInitScript(() => {
			window.print = () => {
				document.documentElement.dataset.printRequested = "true";
			};
		});
		await page.goto(`${url}/en-light-3.html`);
		await expect(page.getByRole("tab", { name: "Front", exact: true })).toBeVisible();
	});
	test.afterAll(async () => {
		await context?.close();
	});
	for (const state of ["preset", "valid", "recovered", "print"] as const) {
		test(`${state}: browser transition and axe`, async () => {
			await page.getByRole("tab", { name: "Front", exact: true }).click();
			await page.locator('input[value="7"]').check();
			if (state === "preset") {
				for (const [value, date] of [
					["2", "October 19, 2026"],
					["7", "October 24, 2026"],
					["14", "October 31, 2026"],
					["30", "November 16, 2026"],
				]) {
					await page.locator(`input[value="${value}"]`).check();
					await expect(page.locator("[data-retrieval-date-line]")).toHaveText(date);
				}
			}
			if (state === "valid" || state === "recovered") {
				await page.getByRole("radio", { name: "Another date", exact: true }).check();
				const input = page.getByLabel("Date", { exact: true });
				if (state === "recovered") {
					await input.fill("");
					await input.blur();
					await expect(page.getByRole("button", { name: "Print the sheet" })).toBeDisabled();
				}
				await input.fill("2024-02-29");
				await input.blur();
				await expect(page.locator("[data-retrieval-date-line]")).toHaveText("February 29, 2024");
				await expect(input).not.toHaveAttribute("aria-invalid");
				await expect(page.getByRole("button", { name: "Print the sheet" })).toBeEnabled();
			}
			if (state === "print") {
				await page.getByRole("tab", { name: "Back", exact: true }).click();
				for (let i = 0; i < 2; i++) {
					await page.getByRole("button", { name: "Print the sheet" }).click();
					await expect(page.locator("html")).toHaveAttribute("data-print-requested", "true");
					await expect(page.locator("html")).toHaveAttribute(
						"data-praxity-retrieval-print",
						"sheet",
					);
					await expect(page.getByRole("status")).toHaveText("Print dialog opened.");
					await expect(page.getByRole("tab", { name: "Back", exact: true })).toHaveAttribute(
						"aria-selected",
						"true",
					);
					await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
					await expect(page.locator("html")).not.toHaveAttribute("data-praxity-retrieval-print");
				}
			}
			expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
		});
	}
});

test.describe("failed enhancer", () => {
	let page: Page;
	let context: BrowserContext;
	test.beforeAll(async ({ browser }) => {
		context = await browser.newContext();
		page = await context.newPage();
		await page.addInitScript(() => {
			Object.defineProperty(Intl, "DateTimeFormat", {
				value() {
					throw new Error("Formatter unavailable");
				},
			});
		});
		await page.goto(`${url}/en-light-3.html`);
	});
	test.afterAll(async () => {
		await context?.close();
	});
	test("complete baseline and axe", async () => {
		await expect(page.getByRole("status")).toContainText("Date and side controls are unavailable.");
		await expect(page.locator("[data-retrieval-side]:visible")).toHaveCount(2);
		await expect(page.locator("[data-retrieval-date-line]")).toHaveText("");
		await expect(page.locator("[data-retrieval-controls]")).toBeHidden();
		expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
	});
});

test("tab arrows only move focus; Enter and Space select without status announcements", async ({
	page,
}) => {
	await page.goto(`${url}/en-light-3.html`);
	const front = page.getByRole("tab", { name: "Front", exact: true }),
		back = page.getByRole("tab", { name: "Back", exact: true });
	await front.focus();
	for (const [key, focused] of [
		["ArrowLeft", back],
		["ArrowLeft", front],
		["ArrowRight", back],
		["ArrowRight", front],
		["End", back],
		["Home", front],
	] as const) {
		await page.keyboard.press(key);
		await expect(focused).toBeFocused();
		await expect(front).toHaveAttribute("aria-selected", "true");
		await expect(back).toHaveAttribute("aria-selected", "false");
		await expect(page.locator('[role=tab][tabindex="0"]')).toHaveCount(1);
	}
	await page.keyboard.press("End");
	await page.keyboard.press("Enter");
	await expect(back).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Tab");
	await expect(page.getByRole("tabpanel")).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(back).toBeFocused();
	await page.keyboard.press("Home");
	await expect(back).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Space");
	await expect(front).toHaveAttribute("aria-selected", "true");
	await expect(page.getByRole("status")).toHaveText("");
});

test("sheet print scopes the sheet, opens both sides, and leaves ordinary print intact", async ({
	page,
}) => {
	await page.addInitScript(() => {
		window.print = () => {};
	});
	await page.goto(`${url}/en-light-3.html`);
	await page.getByRole("tab", { name: "Back", exact: true }).click();
	await page.getByRole("button", { name: "Print the sheet" }).click();
	await page.emulateMedia({ media: "print" });
	await expect(page.locator("[data-retrieval-side]:visible")).toHaveCount(2);
	await expect(page.getByRole("heading", { name: "Course complete", exact: true })).toBeHidden();
	await expect(page.getByRole("button", { name: "Print the sheet" })).toBeHidden();
	await page.emulateMedia({ media: "screen" });
	await expect(page.getByRole("tab", { name: "Back", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.locator("[data-retrieval-side=front]")).toBeHidden();
	await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
	await page.emulateMedia({ media: "print" });
	await expect(page.getByRole("heading", { name: "Course complete", exact: true })).toBeVisible();
	await expect(page.locator("[data-retrieval-side]:visible")).toHaveCount(2);
});
