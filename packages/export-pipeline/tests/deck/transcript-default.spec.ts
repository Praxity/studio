import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";
import { moduleDeckFixture } from "../fixtures/module-deck";

let server: Server;
let base: string;
const entries: Record<string, string> = {};
const files = new Map<string, Buffer>();

test.beforeAll(async () => {
	test.setTimeout(120_000);
	for (const variant of [
		"default",
		"transcript",
		"authored-transcript",
		"authored-outline",
	] as const) {
		const course = moduleDeckFixture(undefined, "fr");
		course.content = [course.content[0]];
		course.moduleDeck = {};
		if (variant === "transcript") course.deckDesign = { preset: "transcript" };
		if (variant === "authored-transcript")
			course.deckDesign = { preset: "transcript", initialPanel: "transcript" };
		if (variant === "authored-outline")
			course.deckDesign = { preset: "transcript", initialPanel: "outline" };
		const artifact = await compileCourse(course, { mode: "source" });
		try {
			const deployment = await deployCourse(artifact, { format: "html" });
			for (const file of new AdmZip(deployment.zip).getEntries()) {
				if (!file.isDirectory) files.set(`/${variant}/${file.entryName}`, file.getData());
			}
			entries[variant] = `/${variant}/${artifact.manifest.pages[0].slug}.html`;
		} finally {
			await artifact.dispose();
		}
	}
	server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
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
			json: "application/json",
			woff2: "font/woff2",
		};
		res.setHeader(
			"Content-Type",
			types[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		res.end(bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture server port");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

for (const width of [1280, 390]) {
	for (const variant of ["default", "transcript"]) {
		test(`${variant} deck starts closed and remembers transcript choices at ${width}px`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(base + entries[variant]);
			const deck = page.locator(".praxity-deck");
			const toggle = page.locator("#deck-script-toggle");
			const sidebar = page.locator("#deck-sidebar");
			await expect(deck).toHaveAttribute("data-ready", "true");
			await expect(deck).toHaveAttribute("data-panel", "");
			await expect(sidebar).toBeHidden();
			await expect(toggle).toHaveAttribute("aria-expanded", "false");
			await expect(page.getByRole("main")).toBeVisible();
			await expect(page.getByRole("main")).toHaveJSProperty("inert", false);
			await page.screenshot({ path: testInfo.outputPath(`${variant}-closed-${width}.png`) });
			await page.getByRole("button", { name: "Outils", exact: true }).click();
			await page.getByRole("button", { name: "Transcription", exact: true }).click();
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			await expect(sidebar).toBeVisible();
			await page.reload();
			await expect(deck).toHaveAttribute("data-ready", "true");
			await expect(sidebar).toBeVisible();
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			await page.locator("#deck-sidebar-close").click();
			await expect(sidebar).toBeHidden();
			await page.reload();
			await expect(deck).toHaveAttribute("data-ready", "true");
			await expect(sidebar).toBeHidden();
			await expect(toggle).toHaveAttribute("aria-expanded", "false");
			await expect(page.getByRole("main")).toBeVisible();
			await expect(page.getByRole("main")).toHaveJSProperty("inert", false);
		});
	}
}

for (const panel of ["transcript", "outline"]) {
	test(`authored ${panel} still opens on wide arrival`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(base + entries[`authored-${panel}`]);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator(".praxity-deck")).toHaveAttribute(
			"data-panel",
			panel === "transcript" ? "script" : "outline",
		);
		await expect(
			page.locator(`#deck-${panel === "transcript" ? "script" : panel}-toggle`),
		).toHaveAttribute("aria-expanded", "true");
	});
}
