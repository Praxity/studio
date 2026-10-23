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
let matrixContext: BrowserContext;
let matrixPage: Page;

// Launch the engine in shared setup, rather than charging its cold start to the first case.
test.beforeAll(async ({ browser }) => {
	await test.info().attach("browser-version", {
		body: browser.version(),
		contentType: "text/plain",
	});
	directory = await mkdtemp(join(tmpdir(), "retrieval-sheet-baseline-"));
	await writeRetrievalSheetHarness(directory);
	server = createServer(async (request, response) => {
		const file = resolve(directory, `.${new URL(request.url ?? "/", "http://localhost").pathname}`);
		if (!file.startsWith(directory + sep)) {
			response.writeHead(403).end();
			return;
		}
		try {
			response.setHeader(
				"Content-Type",
				file.endsWith(".css")
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
	// The read-only matrix navigates afresh for every case. Share the content process,
	// fonts and scanner warm-up so cold engine work stays outside the per-case budget.
	matrixContext = await browser.newContext();
	matrixPage = await matrixContext.newPage();
	await matrixPage.goto(`${url}/en-light-3.html`);
	await matrixPage.evaluate(() => document.fonts.ready);
	expect((await new AxeBuilder({ page: matrixPage }).analyze()).violations).toEqual([]);
});

test.afterAll(async () => {
	await matrixContext?.close();
	if (server)
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done())),
		);
	if (directory) await rm(directory, { recursive: true, force: true });
});

for (const lang of ["en", "fr"]) {
	for (const mode of ["light", "dark"]) {
		for (const width of [1280, 320]) {
			for (const rows of [3, 8]) {
				test(`${lang} ${mode} ${width}px ${rows} rows: complete baseline and axe`, async () => {
					const page = matrixPage;
					await page.emulateMedia({ media: "screen" });
					await page.setViewportSize({ width, height: 900 });
					await page.goto(`${url}/${lang}-${mode}-${rows}.html`);
					await page.evaluate(() => document.fonts.ready);
					await expect(page.locator("[data-retrieval-sheet]")).toHaveAttribute("lang", lang);
					for (const side of ["front", "back"]) {
						const panel = page.locator(`[data-retrieval-side=${side}]`);
						await expect(panel).toBeVisible();
						await expect(panel.locator("li")).toHaveCount(rows);
						expect(
							await panel
								.locator("ol")
								.evaluate((element) => getComputedStyle(element).listStyleType),
						).toBe("decimal");
					}
					await expect(page.locator("button, input, [role=tab], [role=region]")).toHaveCount(0);
					expect(
						await page
							.locator("[data-retrieval-sheet]")
							.evaluate((element) => element.scrollWidth - element.clientWidth),
					).toBeLessThanOrEqual(1);
					const dateLine = await page.locator("[data-retrieval-date-line]").boundingBox();
					expect(dateLine?.width).toBeGreaterThan(50);
					const wrapping = await page.locator(".praxity-retrieval-sheet").evaluate((element) => ({
						prettySupported: CSS.supports("text-wrap", "pretty"),
						values: [...element.querySelectorAll("p, li")].map(
							(node) => getComputedStyle(node).textWrap,
						),
					}));
					expect(new Set(wrapping.values)).toEqual(
						new Set([wrapping.prettySupported ? "pretty" : "wrap"]),
					);
					expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
					await page.emulateMedia({ media: "print" });
					await expect(page.locator("[data-retrieval-no-date]")).toBeHidden();
					await expect(page.locator("[data-retrieval-print-hint]")).toBeHidden();
					await expect(page.locator("[data-retrieval-side=back]")).toHaveCSS(
						"break-before",
						"auto",
					);
					await expect(page.locator("[data-retrieval-side=back]")).toHaveCSS(
						"break-inside",
						"avoid",
					);
					const rules = await page
						.locator(".praxity-retrieval-sheet-space")
						.evaluateAll((elements) =>
							elements.map((element) => {
								const style = getComputedStyle(element);
								return {
									start: style.borderBlockStartWidth,
									end: style.borderBlockEndWidth,
									line: style.borderBlockEndColor,
									ink: style.color,
								};
							}),
						);
					expect(rules).toHaveLength(rows);
					for (const rule of rules) {
						expect(rule.start).toBe("0px");
						expect(rule.end).toBe("1px");
						expect(rule.line).toBe(rule.ink);
					}
				});
			}
		}
	}
}

for (const { lang, mode, width } of [
	{ lang: "en", mode: "light", width: 1280 },
	{ lang: "en", mode: "light", width: 320 },
	{ lang: "en", mode: "dark", width: 320 },
	{ lang: "fr", mode: "light", width: 1280 },
	{ lang: "fr", mode: "light", width: 320 },
]) {
	test(`${lang} ${mode}: both sides remain styled with JavaScript disabled at ${width}px`, async ({
		browser,
	}, testInfo) => {
		const context = await browser.newContext({
			javaScriptEnabled: false,
			viewport: { width, height: 900 },
		});
		try {
			const page = await context.newPage();
			const requested: string[] = [];
			page.on("request", (request) => requested.push(request.url()));
			await page.goto(`${url}/${lang}-${mode}-3.html`);
			await expect(page.locator("link[rel=stylesheet]")).toHaveCount(2);
			await expect(page.locator("link[rel=stylesheet]").first()).toHaveAttribute(
				"href",
				/^retrieval-sheet\.[a-f0-9]{12}\.css$/,
			);
			await expect(page.locator("[data-retrieval-side=front] li")).toHaveCount(3);
			await expect(page.locator("[data-retrieval-side=back]")).toBeVisible();
			await expect(page.locator("[data-retrieval-controls]")).toBeHidden();
			await expect(page.locator(".praxity-retrieval-sheet-space").first()).toHaveCSS(
				"height",
				"32px",
			);
			await expect(page.locator("[data-retrieval-date-line]")).toHaveCSS(
				"border-bottom-width",
				"1px",
			);
			expect(requested.some((request) => /retrieval-sheet\.[a-f0-9]{12}\.css$/.test(request))).toBe(
				true,
			);
			// Chromium can fetch the existing shell preload with scripting disabled.
			// No retrieval enhancer or other executable dependency is requested.
			expect(
				requested.filter(
					(request) => request.endsWith(".js") && !/\/course-shell-[A-Z0-9]{8}\.js$/.test(request),
				),
			).toEqual([]);
			for (const paragraph of [
				page.locator("[data-retrieval-sheet] > p").nth(0),
				page.locator("[data-retrieval-sheet] > p").nth(1),
				page.locator("[data-retrieval-no-date]"),
				page.locator("[data-retrieval-print-hint]"),
			])
				await expect(paragraph).toHaveCSS("margin-top", "16px");
			await page.screenshot({
				path: testInfo.outputPath(`${lang}-${mode}-${width}-no-js.png`),
				fullPage: true,
			});
		} finally {
			await context.close();
		}
	});
}
