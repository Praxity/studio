import { createServer, type Server } from "node:http";
import { test as baseTest, expect, type Page } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";

let server: Server;
let base: string;

const test = baseTest.extend({
	browser: [
		async ({ playwright, browserName, launchOptions }, use) => {
			// Chromium's full headless browser supports BFCache; headless-shell does not.
			const browser = await playwright[browserName].launch({
				...launchOptions,
				...(browserName === "chromium" ? { channel: "chromium" } : {}),
			});
			try {
				await use(browser);
			} finally {
				await browser.close();
			}
		},
		{ scope: "worker" },
	],
});

// Permit native BFCache; the disabled variant installs an unload listener.
test.use({ launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] } });

test.beforeAll(async () => {
	const content = splitBlocksIntoPages(
		readLesson("# First\n\nRead first.\n\n# Second\n\nRead second.\n\n# Third\n\nRead third.\n")
			.blocks,
		"Arrival",
	);
	content.forEach((page, index) => {
		page.id = `arrival-page-${index + 1}`;
		page.lessonId = "arrival";
		page.lessonTitle = "Arrival";
		page.isFirstPageOfLesson = index === 0;
		page.narrationEnabled = false;
	});
	const artifact = await compileCourse({
		id: "standalone-arrival",
		title: "Arrival",
		sourceLocale: "en",
		content,
		navigationStyle: "sidebar",
	});
	const files = new Map<string, Buffer>();
	try {
		const result = await deployCourse(artifact, { format: "html" });
		for (const entry of new AdmZip(result.zip).getEntries()) {
			if (!entry.isDirectory) files.set(`/${entry.entryName}`, entry.getData());
		}
	} finally {
		await artifact.dispose();
	}
	server = createServer((request, response) => {
		const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(pathname);
		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			woff2: "font/woff2",
		};
		response.writeHead(bytes ? 200 : 404, {
			"Content-Type": types[pathname.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		});
		response.end(bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing course server address");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	if (!server) return;
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
});

async function ready(page: Page, title: string) {
	await page.waitForFunction(() => !!window.__praxityRuntime);
	await expect(page.locator("main h1").first()).toHaveText(title);
}

async function next(page: Page, title: string) {
	await page.locator("a.praxity-nav-next:visible").last().click();
	await ready(page, title);
}

for (const cache of ["disabled", "enabled"] as const) {
	test.describe(`standalone history with BFCache ${cache}`, () => {
		test("Back and Forward preserve the chosen pages and history", async ({
			page,
			browserName,
		}, testInfo) => {
			await page.addInitScript((cache) => {
				Object.assign(window, { arrivalPersisted: false });
				window.addEventListener("pageshow", (event) => {
					Object.assign(window, { arrivalPersisted: event.persisted });
				});
				if (cache === "disabled") window.addEventListener("unload", () => {});
			}, cache);
			await page.goto(`${base}/index.html`);
			await ready(page, "First");
			const firstUrl = page.url();
			await next(page, "Second");
			const secondUrl = page.url();
			const historyLength = await page.evaluate(() => history.length);
			// A BFCache restore commits without another document load event.
			await page.goBack({ waitUntil: "commit" });
			await ready(page, "First");
			await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
			expect(page.url()).toBe(firstUrl);
			expect(await page.evaluate(() => history.length)).toBe(historyLength);
			if (browserName === "chromium")
				expect(
					await page.evaluate(
						() => (window as unknown as { arrivalPersisted: boolean }).arrivalPersisted,
					),
				).toBe(cache === "enabled");
			await testInfo.attach("history-arrival", {
				body: JSON.stringify(
					await page.evaluate(() => ({
						persisted: (window as unknown as { arrivalPersisted: boolean }).arrivalPersisted,
						navigation: performance
							.getEntriesByType("navigation")
							.map((entry) => (entry as PerformanceNavigationTiming).type),
					})),
				),
				contentType: "application/json",
			});
			await page.goForward({ waitUntil: "commit" });
			await ready(page, "Second");
			expect(page.url()).toBe(secondUrl);
			expect(await page.evaluate(() => history.length)).toBe(historyLength);
			await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		});
	});
}

for (const selection of ["outline", "previous"] as const) {
	test(`standalone native new-tab ${selection} First keeps the native destination`, async ({
		page,
		context,
		browserName,
	}) => {
		await page.goto(`${base}/index.html`);
		await ready(page, "First");
		await next(page, "Second");
		await next(page, "Third");
		if (selection === "previous") {
			await page.locator("a.praxity-nav-prev:visible").last().click();
			await ready(page, "Second");
		}
		const link = page
			.locator(
				selection === "outline"
					? "a[data-page-slug='first']:not([data-page-direction])"
					: "a.praxity-nav-prev:visible",
			)
			.last();
		const popupPromise = context.waitForEvent("page");
		// Desktop WebKit needs its native new-tab modifier on macOS and Windows.
		await link.click(
			browserName === "webkit" && (process.platform === "darwin" || process.platform === "win32")
				? { modifiers: [process.platform === "darwin" ? "Meta" : "Control"] }
				: { button: "middle" },
		);
		const popup = await popupPromise;
		await popup.waitForLoadState("networkidle");
		await ready(popup, "First");
		await expect(popup.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		await ready(page, selection === "outline" ? "Third" : "Second");
	});
}

test("standalone outline href keeps the chosen destination before context-menu activation", async ({
	page,
	context,
}) => {
	await page.goto(`${base}/index.html`);
	await ready(page, "First");
	await next(page, "Second");
	await next(page, "Third");
	const link = page.locator("a[data-page-slug='first']:not([data-page-direction])").last();
	const href = await link.evaluate((anchor) => (anchor as HTMLAnchorElement).href);
	expect(new URL(href).searchParams.get("praxity-resume")).toBe("0");
	await link.click({ button: "right" });
	// Browser menus are outside Playwright's DOM. Follow the same native href
	// the menu uses, without firing click or auxclick on the original link.
	const popup = await context.newPage();
	await popup.goto(href);
	await ready(popup, "First");
	await expect(popup.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
});

for (const denial of ["read", "legacy-quota"] as const) {
	test(`standalone storage ${denial} keeps runtime-ready and working Next`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.addInitScript((denial) => {
			Object.assign(window, { arrivalRuntimeReady: 0 });
			window.addEventListener("praxity:runtime-ready", () => {
				const observed = window as unknown as { arrivalRuntimeReady: number };
				observed.arrivalRuntimeReady += 1;
			});
			if (denial === "read") {
				Storage.prototype.getItem = () => {
					throw new DOMException("Denied storage read", "SecurityError");
				};
			} else {
				if (location.pathname.endsWith("/index.html"))
					localStorage.setItem("praxity:standalone-arrival:default:bookmark", "arrival-page-3");
				Storage.prototype.setItem = () => {
					throw new DOMException("Storage quota exceeded", "QuotaExceededError");
				};
			}
		}, denial);
		await page.goto(`${base}/index.html`);
		await expect(page.locator("main h1").first()).toHaveText("First");
		expect(errors).toEqual([]);
		await ready(page, "First");
		expect(
			await page.evaluate(
				() => (window as unknown as { arrivalRuntimeReady: number }).arrivalRuntimeReady,
			),
		).toBe(1);
		await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		await next(page, "Second");
		expect(
			await page.evaluate(
				() => (window as unknown as { arrivalRuntimeReady: number }).arrivalRuntimeReady,
			),
		).toBe(1);
		expect(errors).toEqual([]);
	});
}
