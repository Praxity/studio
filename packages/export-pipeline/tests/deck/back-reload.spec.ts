import { createServer, type Server } from "node:http";
import { expect, type Page, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";
import { serveFixtureBytes } from "../fixtures/http-bytes";

let server: Server;
let base: string;

test.beforeAll(async () => {
	const files = new Map<string, Buffer>([
		["/outside.html", Buffer.from("<title>Outside course</title>")],
	]);
	for (const mode of ["pages", "deck"] as const) {
		const content = splitBlocksIntoPages(
			readLesson("# First page\n\nFirst content.\n\n# Second page\n\nSecond content.\n").blocks,
			"History lesson",
		);
		for (const [index, page] of content.entries()) {
			page.id = `page-${index + 1}`;
			page.lessonId = "history-lesson";
			page.lessonTitle = "History lesson";
			page.isFirstPageOfLesson = index === 0;
		}
		const artifact = await compileCourse({
			id: `history-${mode}`,
			title: "History course",
			sourceLocale: "en",
			content,
			navigationStyle: mode === "pages" ? "sidebar" : "slides",
			...(mode === "deck" ? { moduleDeck: {} } : {}),
		});
		try {
			for (const format of ["html", "scorm12", "scorm2004"] as const) {
				const output = await deployCourse(artifact, { format });
				for (const entry of new AdmZip(output.zip).getEntries())
					if (!entry.isDirectory)
						files.set(`/${mode}-${format}/${entry.entryName}`, entry.getData());
			}
		} finally {
			await artifact.dispose();
		}
	}
	server = createServer((request, response) => {
		const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(pathname);
		if (!bytes) {
			response.writeHead(404).end();
			return;
		}
		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			json: "application/json",
		};
		response.setHeader(
			"Content-Type",
			types[pathname.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		serveFixtureBytes(request, response, bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture address");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

for (const mode of ["pages", "deck"] as const) {
	for (const format of ["html", "scorm12", "scorm2004"] as const) {
		test.describe(`${mode} ${format}`, () => {
			test.beforeEach(async ({ context }) => {
				if (format === "html") return;
				// Persist the LMS location across document loads and fresh launch tabs.
				await context.addInitScript((format) => {
					const key = `lms:${location.pathname.split("/")[1]}`;
					const values: Record<string, string> = JSON.parse(localStorage.getItem(key) ?? "{}");
					const get = (name: string) =>
						name === "cmi.entry" || name === "cmi.core.entry" ? "resume" : (values[name] ?? "");
					const set = (name: string, value: string) => {
						values[name] = value;
						return "true";
					};
					const commit = () => {
						localStorage.setItem(key, JSON.stringify(values));
						return "true";
					};
					Object.assign(
						window,
						format === "scorm12"
							? {
									API: {
										LMSInitialize: () => "true",
										LMSGetValue: get,
										LMSSetValue: set,
										LMSCommit: commit,
										LMSFinish: commit,
										LMSGetLastError: () => "0",
									},
								}
							: {
									API_1484_11: {
										Initialize: () => "true",
										GetValue: get,
										SetValue: set,
										Commit: commit,
										Terminate: commit,
										GetLastError: () => "0",
									},
								},
					);
				}, format);
			});

			async function atPage(page: Page, title: string) {
				await expect(page).toHaveTitle(title);
				if (mode === "deck")
					await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				else
					await expect(page.locator('[data-island="nav"]').first()).toHaveAttribute(
						"data-hydrated",
						"",
					);
			}

			async function next(page: Page) {
				await page
					.locator(
						mode === "deck" ? "#deck-next" : '#praxity-page-nav a[data-page-direction="next"]',
					)
					.click();
				await atPage(page, "Second page");
			}

			test("Next, reload, Back returns to page one without a resume cue", async ({ page }) => {
				await page.goto(`${base}/${mode}-${format}/index.html`);
				await atPage(page, "First page");
				await next(page);
				// Gecko's automation reload navigates history-replaced URLs through about:blank.
				await Promise.all([page.waitForNavigation(), page.evaluate(() => location.reload())]);
				await atPage(page, "Second page");
				const reloadedCueCount = await page
					.locator(".praxity-resume-prefix,.praxity-resume-summary")
					.count();
				await page.goBack();
				await atPage(page, "First page");
				await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
				await page.goForward();
				await atPage(page, "Second page");
				expect(reloadedCueCount).toBe(0);
			});

			test("a fresh tab resumes the saved second page", async ({ page, context }) => {
				await page.goto(`${base}/${mode}-${format}/index.html`);
				await atPage(page, "First page");
				await next(page);
				// This fixture's LMS saves on Commit, so finish the document exit before closing its tab.
				await page.goto(`${base}/outside.html`);
				await expect(page).toHaveTitle("Outside course");
				await page.close();
				const fresh = await context.newPage();
				await fresh.goto(`${base}/${mode}-${format}/index.html`);
				await atPage(fresh, "Second page");
				await expect(fresh.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(
					1,
				);
			});

			test("Back from the first page leaves the course", async ({ page }) => {
				await page.goto(`${base}/outside.html`);
				await page.goto(`${base}/${mode}-${format}/index.html`);
				await atPage(page, "First page");
				await Promise.all([page.waitForNavigation(), page.evaluate(() => location.reload())]);
				await atPage(page, "First page");
				await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
				await page.goBack();
				await expect(page).toHaveURL(`${base}/outside.html`);
			});
		});
	}
}
