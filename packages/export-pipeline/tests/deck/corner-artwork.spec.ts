import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, test } from "@playwright/test";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";
import { analyzeAxe } from "../a11y/helpers";
import { moduleDeckFixture } from "../fixtures/module-deck";
import { expectForcedEmulationInert, forcedPalette } from "../focus-assertions";

let server: Server;
let url: string;
let standardUrl: string;
const files = new Map<string, Buffer>();

// Windows WebKit exclusions: native artwork-link Tab traversal at these widths.
const WINDOWS_WEBKIT_LINK_TRAVERSAL_WIDTHS = [1440, 700, 390, 320];

test.beforeAll(async () => {
	test.setTimeout(120_000);
	const course = moduleDeckFixture();
	course.moduleDeck = {};
	// Guided slides must provide their frame even when the course navigation is not slides.
	course.navigationStyle = "minimal";
	course.deckDesign = { initialPanel: "closed" };
	course.slideStyles = { decorated: { cornerImage: "https://artwork.example/corners.png" } };
	course.content = ["corners", "plain", "full", "breakout"].map((name, index) => ({
		...course.content[0],
		id: name,
		title: name,
		isFirstPageOfLesson: index === 0,
		data: name === "plain" || index === 0 ? {} : { pageStyle: "decorated" },
		blocks: [
			{
				id: `${name}-heading`,
				type: "heading",
				data: {
					level: 1,
					content: "Reading with room to breathe",
					...(index === 0 ? { pageStyle: "decorated" } : {}),
				},
			},
			{
				id: `${name}-text`,
				type: "text",
				data: {
					content:
						'Readable slide content stays clear of decorative artwork. Take time to consider the options, discuss what matters, and choose the next step that fits your needs. <a href="https://example.org/learning">Read more about learning at your own pace</a>.',
					narration: "A reading script is available in the docked panel.",
					...(name === "full" || name === "breakout" ? { layout: name } : {}),
				},
			},
		],
	}));
	const artwork = process.env.PRAX_CORNER_ARTWORK
		? await readFile(process.env.PRAX_CORNER_ARTWORK)
		: Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
				"base64",
			);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (input, options) =>
		String(input) === "https://artwork.example/corners.png"
			? Promise.resolve(new Response(artwork, { headers: { "Content-Type": "image/png" } }))
			: originalFetch(input, options);
	try {
		for (const variant of ["deck", "standard"] as const) {
			const input =
				variant === "deck"
					? course
					: {
							...course,
							navigationStyle: "slides" as const,
							moduleDeck: undefined,
							content: [course.content[0]],
						};
			const artifact = await compileCourse(input, { mode: "source" });
			try {
				const deployment = await deployCourse(artifact, {
					format: "html",
					reviewMode: variant === "deck",
					reviewExpiresAt: "2030-01-01T00:00:00Z",
				});
				for (const file of new AdmZip(deployment.zip).getEntries())
					if (!file.isDirectory) files.set(`/${variant}/${file.entryName}`, file.getData());
				const entry = `/${variant}/${artifact.manifest.pages[0].slug}.html`;
				if (variant === "deck") url = entry;
				else standardUrl = entry;
			} finally {
				await artifact.dispose();
			}
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	server = createServer((req, res) => {
		const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
		if (pathname.endsWith("/comments")) {
			res.setHeader("Content-Type", "application/json");
			res.end("[]");
			return;
		}
		const bytes = files.get(pathname);
		if (!bytes) {
			res.writeHead(404);
			res.end();
			return;
		}
		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			png: "image/png",
			webp: "image/webp",
			woff2: "font/woff2",
		};
		res.setHeader(
			"Content-Type",
			types[pathname.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		res.end(bytes);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	url = origin + url;
	standardUrl = origin + standardUrl;
});
test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

async function artworkGeometry(artwork: Locator) {
	return artwork.evaluate((element) => {
		const before = getComputedStyle(element, "::before");
		const after = getComputedStyle(element, "::after");
		const canvasElement = element.parentElement;
		const contentElement = element.querySelector(".praxity-slide");
		if (!canvasElement || !contentElement) throw new Error("Missing slide artwork structure");
		const canvas = canvasElement.getBoundingClientRect();
		const heading = contentElement.querySelector("h1");
		if (!heading) throw new Error("Missing slide heading");
		const headingBounds = heading.getBoundingClientRect();
		return {
			canvas: canvas.width,
			titleClearance:
				Math.min(headingBounds.left - canvas.left, canvas.right - headingBounds.right) -
				parseFloat(after.width),
			flowGap: parseFloat(after.marginTop),
			before: before.display,
			position: after.position,
			width: parseFloat(after.width),
			height: parseFloat(after.height),
			image: after.backgroundImage,
			overflow: document.documentElement.scrollWidth - innerWidth,
		};
	});
}

function expectPackagedArtwork(backgroundImage: string, variant: "deck" | "standard") {
	const assetUrl = backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
	expect(assetUrl).toBeTruthy();
	const pathname = new URL(assetUrl ?? "", "http://localhost").pathname;
	expect(pathname).toMatch(new RegExp(`^/${variant}/assets/[^/]+\\.(?:png|webp)$`));
	expect(files.has(pathname)).toBe(true);
}

for (const width of [1440, 700, 390, 320]) {
	test(`artwork respects the ${width}px canvas and ordinary sibling slides`, async ({
		page,
		browserName,
	}) => {
		test.skip(
			process.platform === "win32" &&
				browserName === "webkit" &&
				WINDOWS_WEBKIT_LINK_TRAVERSAL_WIDTHS.includes(width),
			"Windows WebKit skips native links with both Tab and Alt+Tab.",
		);
		await page.setViewportSize({ width, height: 900 });
		await page.goto(url);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const art = page.locator('[data-deck-slide="corners"] .praxity-slide-artwork');
		const geometry = await artworkGeometry(art);
		expectPackagedArtwork(geometry.image, "deck");
		expect(geometry.overflow).toBeLessThanOrEqual(1);
		if (geometry.canvas > 650) {
			expect(geometry.position).toBe("absolute");
			expect(geometry.titleClearance, JSON.stringify(geometry)).toBeGreaterThanOrEqual(16);
			expect(geometry.height).toBe(geometry.canvas > 850 ? 280 : 180);
		} else {
			expect(geometry.before).toBe("none");
			expect(geometry.position).toBe("relative");
			expect(geometry.width).toBe(140);
			expect(geometry.height).toBe(100);
			expect(geometry.flowGap).toBe(32);
		}
		const scan = await analyzeAxe(
			page,
			new AxeBuilder({ page }).include('[data-deck-slide="corners"]'),
		);
		expect(
			scan.violations.filter(
				(violation) =>
					violation.id === "color-contrast" ||
					violation.impact === "serious" ||
					violation.impact === "critical",
			),
		).toEqual([]);
		const link = art.getByRole("link");
		// Start before slide content, then reach the link through the browser's tab order.
		await art.getByRole("heading").evaluate((heading) => {
			heading.setAttribute("tabindex", "-1");
			(heading as HTMLElement).focus();
		});
		// Match the existing macOS WebKit keyboard policy: Option+Tab includes links.
		await page.keyboard.press(
			browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
		);
		await expect(link).toBeFocused();
		await link.click({ trial: true });
		await page.screenshot({ path: test.info().outputPath(`artwork-${width}.png`) });
		await page.locator("#deck-next").click();
		const plain = page.locator('[data-deck-slide="plain"]');
		await expect(plain).toBeVisible();
		await expect(plain.locator(".praxity-slide-canvas")).toHaveCount(0);
		expect(await plain.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
		for (const name of ["full", "breakout"]) {
			await page.locator("#deck-next").click();
			const canvas = page.locator(`[data-deck-slide="${name}"] .praxity-slide-canvas`);
			await expect(canvas).toHaveAttribute("data-corner-placement", "flow");
			const flow = await artworkGeometry(canvas.locator(".praxity-slide-artwork"));
			expect(flow.position).toBe("relative");
			expect(flow.flowGap).toBe(32);
			expect(flow.overflow).toBeLessThanOrEqual(1);
		}
	});
}

for (const { width, panel } of [
	{ width: 1996, panel: "outline" },
	{ width: 1200, panel: "script" },
	{ width: 900, panel: "closed" },
	{ width: 700, panel: "closed" },
	{ width: 390, panel: "closed" },
] as const) {
	test(`artwork and plain reading gutters match at ${width}px with ${panel} panel`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(url);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator('[data-deck-slide="corners"]')).toBeVisible();
		if (panel !== "closed") {
			await page.locator("#deck-more-toggle").click();
			await page.locator(`#deck-${panel === "outline" ? "outline" : "script"}-toggle`).click();
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-panel", panel);
		}
		const edges = async (name: string) =>
			page.locator(`[data-deck-slide="${name}"] .praxity-slide h1`).evaluate((element) => {
				const { left, right } = element.getBoundingClientRect();
				return { left, right };
			});
		const decorated = await edges("corners");
		await page.locator("#deck-next").click();
		await expect(page.locator('[data-deck-slide="plain"]')).toBeVisible();
		const plain = await edges("plain");
		expect(Math.abs(decorated.left - plain.left), `${width}px ${panel} left`).toBeLessThanOrEqual(
			1,
		);
		expect(
			Math.abs(decorated.right - plain.right),
			`${width}px ${panel} right`,
		).toBeLessThanOrEqual(1);
	});
}

test("docked panel uses remaining canvas width", async ({ page }) => {
	await page.setViewportSize({ width: 1200, height: 900 });
	await page.goto(url);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const art = page.locator('[data-deck-slide="corners"] .praxity-slide-artwork');
	const before = await artworkGeometry(art);
	await page.locator("#deck-more-toggle").click();
	await page.locator("#deck-script-toggle").click();
	await expect(page.locator("#deck-sidebar")).toBeVisible();
	await expect.poll(async () => (await artworkGeometry(art)).canvas).toBeLessThan(before.canvas);
	const after = await artworkGeometry(art);
	expect(after.height).toBe(after.canvas > 850 ? 280 : after.canvas > 650 ? 180 : 100);
	expect(after.overflow).toBeLessThanOrEqual(1);
	await page.screenshot({ path: test.info().outputPath("artwork-docked-1200.png") });
});

test("decoration disappears in print, forced colors and dark mode", async ({ page }) => {
	await page.goto(url);
	const art = page.locator('[data-deck-slide="corners"] .praxity-slide-artwork');
	for (const media of [
		{ media: "print" as const },
		{ media: "screen" as const, forcedColors: "active" as const },
	]) {
		await page.emulateMedia(media);
		if (media.forcedColors === "active" && !(await forcedPalette(page))) {
			await expectForcedEmulationInert(
				page,
				["::before", "::after"].map((pseudo) => ({ locator: art, pseudo })),
			);
			continue;
		}
		for (const pseudo of ["::before", "::after"])
			expect(await art.evaluate((el, p) => getComputedStyle(el, p).display, pseudo)).toBe("none");
	}
	await page.emulateMedia({ forcedColors: "none" });
	await page.locator("html").evaluate((el) => el.classList.add("praxity-theme-dark"));
	expect(await art.evaluate((el) => getComputedStyle(el, "::after").display)).toBe("none");
});

test("server-rendered slides remain readable without JavaScript", async ({ browser }) => {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		viewport: { width: 390, height: 844 },
	});
	try {
		const page = await context.newPage();
		await page.goto(url);
		await expect(
			page
				.getByText("Readable slide content stays clear of decorative artwork.", { exact: false })
				.first(),
		).toBeVisible();
		expect(
			await page.locator("html").evaluate((el) => el.scrollWidth - innerWidth),
		).toBeLessThanOrEqual(1);
	} finally {
		await context.close();
	}
});

test("768px transcript replaces the slide and comments overlay preserves its canvas", async ({
	page,
}) => {
	await page.setViewportSize({ width: 768, height: 1024 });
	await page.goto(url);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const art = page.locator('[data-deck-slide="corners"] .praxity-slide-artwork');
	const before = await artworkGeometry(art);
	await page.screenshot({ path: test.info().outputPath("artwork-768-closed.png") });
	await page.locator("#deck-more-toggle").click();
	await page.locator("#deck-script-toggle").click();
	await expect(page.locator("#main-content")).toBeHidden();
	await expect(page.locator("#deck-sidebar")).toBeVisible();
	await page.screenshot({ path: test.info().outputPath("artwork-768-transcript.png") });
	await page.locator("#deck-sidebar-close").click();
	await expect(art).toBeVisible();
	await page.locator(".prx-review-toggle--deck").click();
	await expect(page.locator(".prx-review-sidebar")).toBeVisible();
	expect((await artworkGeometry(art)).canvas).toBeCloseTo(before.canvas, 0);
	await page.screenshot({ path: test.info().outputPath("artwork-768-comments.png") });
});

test("200% slide text reflows at 320px without horizontal scrolling", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto(url);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const slide = page.locator('[data-deck-slide="corners"] .praxity-slide');
	// Text-only enlargement: capture computed sizes before changing ancestor sizes.
	await slide.evaluate((element) => {
		const sizes = [element, ...element.querySelectorAll("*")].map(
			(el) => [el, parseFloat(getComputedStyle(el).fontSize)] as const,
		);
		for (const [el, size] of sizes) (el as HTMLElement).style.fontSize = `${size * 2}px`;
	});
	await expect(slide.getByRole("heading")).toBeVisible();
	await slide.getByRole("link").scrollIntoViewIfNeeded();
	await expect(slide.getByRole("link")).toBeVisible();
	expect(
		await page.locator("html").evaluate((el) => el.scrollWidth - innerWidth),
	).toBeLessThanOrEqual(1);
	expect(await slide.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
	await page.screenshot({ path: test.info().outputPath("artwork-320-text-200.png") });
});

for (const width of [1440, 390]) {
	test(`ordinary slide page preserves artwork and readable width at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(standardUrl);
		await expect(page.locator(".praxity-deck")).toHaveCount(0);
		const art = page.locator(".praxity-slide-artwork");
		await expect(art.getByRole("heading")).toBeVisible();
		const geometry = await artworkGeometry(art);
		expectPackagedArtwork(geometry.image, "standard");
		const loaded = await art.evaluate(async (element) => {
			const url = getComputedStyle(element, "::after").backgroundImage.match(
				/^url\(["']?(.*?)["']?\)$/,
			)?.[1];
			if (!url) return false;
			const image = new Image();
			image.src = url;
			await image.decode();
			return image.naturalWidth > 0;
		});
		expect(loaded).toBe(true);
		expect(geometry.overflow).toBeLessThanOrEqual(1);
		if (geometry.canvas > 650) expect(geometry.titleClearance).toBeGreaterThanOrEqual(16);
		else {
			expect(geometry.position).toBe("relative");
			expect(geometry.flowGap).toBe(32);
		}
		await page.screenshot({ path: test.info().outputPath(`artwork-standard-${width}.png`) });
	});
}
