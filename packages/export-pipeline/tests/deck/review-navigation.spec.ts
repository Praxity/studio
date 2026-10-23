import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";
import { moduleDeckFixture } from "../fixtures/module-deck";
import { test } from "../muted-test";

let server: Server;
let url: string;
const files = new Map<string, Buffer>();

test.beforeAll(async () => {
	test.setTimeout(120_000);
	const audio = await readFile(
		resolve(import.meta.dirname, "../../../../docs/test-fixtures/assets/narration-sample.mp3"),
	);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (input, options) =>
		String(input).startsWith("https://review-audio.example/")
			? Promise.resolve(new Response(audio, { headers: { "Content-Type": "audio/mpeg" } }))
			: originalFetch(input, options);
	try {
		const course = moduleDeckFixture("https://review-audio.example/fixture.mp3");
		course.content = course.content.slice(0, 2);
		course.moduleDeck = { gates: { "practice-gate": "attempt" } };
		const artifact = await compileCourse(course, { mode: "source" });
		try {
			const deployment = await deployCourse(artifact, {
				format: "html",
				reviewMode: true,
				reviewExpiresAt: "2030-01-01T00:00:00Z",
			});
			if (!("zip" in deployment)) throw new Error("Expected review package");
			for (const file of new AdmZip(deployment.zip).getEntries())
				if (!file.isDirectory) files.set(`/${file.entryName}`, file.getData());
			url = `/${artifact.manifest.pages[0].slug}.html`;
		} finally {
			await artifact.dispose();
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		if (path === "/comments") {
			res.setHeader("Content-Type", "application/json");
			res.end("[]");
			return;
		}
		const bytes = files.get(path);
		if (!bytes) {
			res.writeHead(404);
			res.end();
			return;
		}
		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			mp3: "audio/mpeg",
			json: "application/json",
			woff2: "font/woff2",
		};
		res.setHeader(
			"Content-Type",
			types[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		res.end(bytes);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	url = `http://127.0.0.1:${(server.address() as { port: number }).port}${url}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

for (const [width, height] of [
	[1440, 900],
	[768, 1024],
	[390, 844],
	[320, 568],
	[844, 390],
	[480, 240],
	[320, 240],
]) {
	test(`transcript and comments leave navigation exposed at ${width}x${height}`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height });
		await page.goto(url);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator(".prx-review-toggle--deck .prx-review-count")).toHaveCount(0);
		if (!(await page.locator("#deck-script-toggle").isVisible()))
			await page.locator("#deck-more-toggle").click();
		await page.locator("#deck-script-toggle").click();
		await expect(page.locator("#deck-sidebar")).toBeVisible();
		if (width < 600) {
			const sheet = page.locator("dialog.deck-transcript-sheet");
			expect(await sheet.evaluate((element) => element.matches(":modal"))).toBe(true);
			const sheetBox = await sheet.boundingBox();
			const footerBox = await page.locator("#deck-controls").boundingBox();
			if (!sheetBox || !footerBox) throw new Error("Missing transcript or footer bounds");
			expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(footerBox.y);
			await expect(page.locator("#deck-next")).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(page.locator("#deck-script-toggle")).toBeFocused();
		}
		for (const comments of [false, true]) {
			if (comments) {
				if (!(await page.locator(".prx-review-toggle--deck").isVisible()))
					await page.locator("#deck-more-toggle").click();
				await page.locator(".prx-review-toggle--deck").click();
				await expect(page.locator(".prx-review-sidebar")).toBeVisible();
				await page.locator("#prx-review-text").scrollIntoViewIfNeeded();
			}
			// toBeVisible alone does not detect another panel intercepting the button.
			for (const id of ["deck-previous", "deck-next"]) {
				await expect
					.poll(() =>
						page.locator(`#${id}`).evaluate((button) => {
							const r = button.getBoundingClientRect();
							return (
								r.top >= 0 &&
								r.bottom <= innerHeight &&
								r.left >= 0 &&
								r.right <= innerWidth &&
								[
									[0.2, 0.2],
									[0.5, 0.5],
									[0.8, 0.8],
								].every(([x, y]) => {
									const hit = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y);
									// Disabled controls have pointer-events:none; their navigation row receives the hit.
									return (
										button.contains(hit) ||
										(button.hasAttribute("disabled") && hit === button.parentElement)
									);
								})
							);
						}),
					)
					.toBe(true);
			}
			await page.locator("#deck-next").focus();
			await page.keyboard.press("Enter");
			await expect(page.locator('[data-deck-slide="slide-2"]')).toHaveJSProperty("hidden", false);
			if (comments)
				await expect(page.locator(".prx-review-context")).toContainText("Which choice is helpful?");
			await page.locator("#deck-previous").click();
			await expect(page.locator('[data-deck-slide="slide-1"]')).toHaveJSProperty("hidden", false);
		}
		await page.screenshot({ path: testInfo.outputPath("comments-and-navigation.png") });
		await page.locator(".prx-review-toggle--deck").focus();
		await page.keyboard.press("Enter");
		await expect(page.locator(".prx-review-toggle--deck")).toBeFocused();
		await expect(page.locator(".prx-review-sidebar")).toBeHidden();
		if (width < 480)
			await expect(page.locator("#deck-more-toggle")).toHaveAttribute("aria-expanded", "true");
	});
}
