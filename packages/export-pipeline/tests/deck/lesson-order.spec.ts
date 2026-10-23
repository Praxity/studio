import { createServer, type Server } from "node:http";
import { expect, type Page } from "@playwright/test";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";
import { serveFixtureBytes } from "../fixtures/http-bytes";
import { moduleDeckFixture } from "../fixtures/module-deck";
import { test } from "../muted-test";

let server: Server;
let base: string;
const entries = new Map<string, { first: string; second: string }>();
test.use({ viewport: { width: 1280, height: 900 } });

async function openOutline(page: Page) {
	const toggle = page.locator("#deck-outline-toggle");
	if (!(await toggle.isVisible())) await page.locator("#deck-more-toggle").click();
	await toggle.click();
}

test.beforeAll(async () => {
	const files = new Map<string, Buffer>();
	for (const variant of [
		"absent",
		"sequential",
		"optional",
		"gated-absent",
		"gated-optional",
		"gated-sequential",
	] as const) {
		const course = moduleDeckFixture();
		course.id = `lesson-order-${variant}`;
		for (const slide of course.content)
			slide.blocks = slide.blocks.filter((block) => block.type !== "image");
		if (!variant.endsWith("absent"))
			course.deckDesign = { sequentialLessons: variant.endsWith("sequential") };
		if (!variant.startsWith("gated")) {
			course.moduleDeck = {};
			for (const slide of course.content)
				slide.blocks = slide.blocks.filter((block) => block.type !== "assessment");
		}
		const artifact = await compileCourse(course, { mode: "source" });
		try {
			const deployment = await deployCourse(artifact, { format: "html" });
			if (!("zip" in deployment)) throw new Error("Expected HTML package");
			for (const file of new AdmZip(deployment.zip).getEntries())
				if (!file.isDirectory) files.set(`/${variant}/${file.entryName}`, file.getData());
			const second = artifact.manifest.pages.find((page) => page.id === "module-two");
			if (!second) throw new Error("Missing second lesson");
			entries.set(variant, {
				first: `/${variant}/${artifact.manifest.pages[0].slug}.html`,
				second: `/${variant}/${second.slug}.html`,
			});
		} finally {
			await artifact.dispose();
		}
	}
	server = createServer((request, response) => {
		const bytes = files.get(new URL(request.url ?? "/", "http://fixture.invalid").pathname);
		if (!bytes) {
			response.writeHead(404).end();
			return;
		}
		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			json: "application/json",
			woff2: "font/woff2",
		};
		response.setHeader(
			"Content-Type",
			types[
				new URL(request.url ?? "/", "http://fixture.invalid").pathname.split(".").at(-1) ?? ""
			] ?? "application/octet-stream",
		);
		serveFixtureBytes(request, response, bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture address");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function urls(variant: string) {
	const entry = entries.get(variant);
	if (!entry) throw new Error(`Missing fixture ${variant}`);
	return { first: base + entry.first, second: base + entry.second };
}

for (const variant of ["sequential"]) {
	test(`lesson ordering ${variant} locks later lessons until earlier slides are visited`, async ({
		page,
	}) => {
		await page.goto(urls(variant).first);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await openOutline(page);
		const second = page.locator('[data-deck-page="module-two"]');
		await expect(second).toHaveAttribute("aria-disabled", "true");
		await expect(second.locator("[data-deck-lock]")).toBeVisible();
		await second.press("Enter");
		await expect(page.locator('[data-deck-slide="slide-1"]')).toBeVisible();
		await expect(page.locator("#deck-status")).toHaveText(
			"Continue through the earlier slides to reach this one.",
		);
		for (const id of ["slide-2", "slide-3", "slide-4"]) {
			await page.locator("#deck-next").click();
			await expect(page.locator(`[data-deck-slide="${id}"]`)).toBeVisible();
		}
		await expect(second).toHaveAttribute("aria-disabled", "false");
		await page.locator("#deck-next").click();
		await expect(page.locator("#deck-completion")).toBeVisible();
		await page.locator("#deck-next").click();
		await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
	});
}

for (const variant of ["absent", "optional"]) {
	test(`${variant} lessons open from the outline without locks or an access notice`, async ({
		page,
	}) => {
		await page.goto(urls(variant).first);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await openOutline(page);
		const second = page.locator('[data-deck-page="module-two"]');
		await expect(second).toHaveAttribute("aria-disabled", "false");
		await expect(second.locator("[data-deck-lock]")).toBeHidden();
		await expect(page.locator('[data-deck-page="slide-4"]')).toHaveAttribute(
			"aria-disabled",
			"false",
		);
		await second.press("Enter");
		await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
		await expect(page.locator("#deck-status")).toBeEmpty();
		await page.locator("#deck-previous").click();
		await expect(page.locator('[data-deck-slide="slide-4"]')).toBeVisible();
		await page.locator("#deck-next").click();
		await expect(page.locator("#deck-completion")).toBeVisible();
		await page.locator("#deck-next").click();
		await expect(page.locator('[data-deck-slide="module-two"]')).toBeVisible();
	});

	for (const destination of ["slide-4", "module-two"]) {
		test(`${variant} lessons admit a fresh deep link to ${destination}`, async ({ page }) => {
			await page.goto(
				`${urls(variant)[destination === "module-two" ? "second" : "first"]}#${destination}`,
			);
			await expect(page.locator(`[data-deck-slide="${destination}"]`)).toBeVisible();
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(page.locator("#deck-status")).toBeEmpty();
			expect(new URL(page.url()).searchParams.has("praxity-deck-redirect")).toBe(false);
		});
	}
}

for (const variant of ["gated-absent", "gated-optional", "gated-sequential"]) {
	test(`${variant} lessons retain authored gates and their access message`, async ({ page }) => {
		await page.goto(urls(variant).first);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await openOutline(page);
		const second = page.locator('[data-deck-page="module-two"]');
		await expect(second).toHaveAttribute("aria-disabled", "true");
		await expect(second.locator("[data-deck-lock]")).toBeVisible();
		if (variant === "gated-sequential") {
			await expect(page.locator('[data-deck-page="slide-4"]')).toHaveAttribute(
				"aria-disabled",
				"true",
			);
			// Visit the opening slide before the assessment becomes the limiting rule.
			await page.locator("#deck-next").click();
			await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
		}
		await second.press("Enter");
		await expect(page.locator("#deck-status")).toHaveText(
			"Complete the required activity to continue.",
		);
		await page.goto(`${urls(variant).second}#module-two`);
		await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
		await expect(page.locator("#deck-status")).toHaveText(
			"Complete the required activity to continue.",
		);
		await page.locator("#deck-next").click();
		await expect(page.locator('[data-deck-slide="slide-2"]')).toBeVisible();
		await expect(page.locator(".deck-gate-notice")).toBeVisible();
	});
}
