import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { type BrowserContext, expect, type Locator, type Page } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";
import { moduleDeckFixture } from "../fixtures/module-deck";
import { test } from "../muted-test";

let server: Server;
let origin: string;
const entries = new Map<string, string>();
const files = new Map<string, Buffer>();

function images(prefix: string, index: number) {
	return ["a", "b"].map((suffix) => ({
		id: `${prefix}-${index}-${suffix}`,
		type: "image" as const,
		data: {
			src: `https://warming.example/${prefix}-${index}-${suffix}.svg`,
			alt: `Illustration ${index + 1} ${suffix}`,
		},
	}));
}

function tabs(prefix: string): PraxityBlock {
	return {
		id: `${prefix}-tabs`,
		type: "tabs" as const,
		data: {
			items: Array.from({ length: 6 }, (_, index) => ({
				id: `${prefix}-${index}`,
				label: `Pane ${index + 1}`,
				children: images(prefix, index),
			})),
		},
	};
}

test.beforeAll(async () => {
	const audio = await readFile(
		resolve(import.meta.dirname, "../../../../docs/test-fixtures/assets/narration-sample.mp3"),
	);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (input, options) => {
		const url = String(input);
		if (!url.startsWith("https://warming.example/")) return originalFetch(input, options);
		if (url.endsWith(".mp3"))
			return Promise.resolve(new Response(audio, { headers: { "Content-Type": "audio/mpeg" } }));
		return Promise.resolve(
			new Response(
				`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="teal"/><text x="10" y="60">${new URL(url).pathname}</text></svg>`,
				{ headers: { "Content-Type": "image/svg+xml" } },
			),
		);
	};
	try {
		for (const variant of ["en", "narrated-fr", "cards", "deck-tabs"]) {
			const course = moduleDeckFixture();
			course.id = `image-warming-${variant}`;
			course.sourceLocale = variant === "narrated-fr" ? "fr" : "en";
			course.moduleDeck = variant === "cards" ? undefined : {};
			course.deckDesign = { initialPanel: "closed" };
			const template = course.content[0];
			course.content = Array.from({ length: 6 }, (_, index) => ({
				...template,
				id: `pane-${index}`,
				title: `Pane ${index + 1}`,
				isFirstPageOfLesson: index === 0,
				narrationEnabled: variant === "narrated-fr",
				data:
					variant === "narrated-fr"
						? { narrationAudio: `https://warming.example/narration-${index}.mp3` }
						: {},
				blocks: [
					{
						id: `heading-${index}`,
						type: "heading",
						data: { level: 1, content: `Pane ${index + 1}` },
					},
					...images(variant, index),
					...(variant === "deck-tabs" ? [tabs(`slide-${index}`)] : []),
				],
			}));
			if (variant === "cards") {
				course.navigationStyle = "minimal";
				course.content = [
					{
						...course.content[0],
						blocks: [
							{
								id: "panes",
								type: "card",
								data: {
									layout: "single",
									items: Array.from({ length: 6 }, (_, index) => ({
										id: `item-${index}`,
										label: `Pane ${index + 1}`,
										front: images(variant, index),
									})),
								},
							},
						],
					},
				];
			}
			if (variant === "deck-tabs") {
				// Stateful output eagerly attaches all islands, including tabs before the deck chunk.
				course.content[0].blocks.push(
					...readLesson(
						"::: choice Try a response {private=true scored=false required=false}\n(x) First response\n( ) Second response\n:::\n",
					).blocks,
				);
			}
			const artifact = await compileCourse(course, { mode: "source" });
			try {
				const deployment = await deployCourse(artifact, {
					format: variant === "deck-tabs" ? "scorm12" : "html",
				});
				for (const file of new AdmZip(deployment.zip).getEntries())
					if (!file.isDirectory) files.set(`/${variant}/${file.entryName}`, file.getData());
				entries.set(variant, `/${variant}/${artifact.manifest.pages[0].slug}.html`);
			} finally {
				await artifact.dispose();
			}
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(path);
		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			svg: "image/svg+xml",
			mp3: "audio/mpeg",
			woff2: "font/woff2",
		};
		res.writeHead(bytes ? 200 : 404, {
			"Content-Type": types[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		});
		res.end(bytes);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

async function loaded(pane: Locator) {
	return pane.locator("img").evaluateAll(
		(elements) =>
			elements.length === 2 &&
			elements.every((element) => {
				const image = element as HTMLImageElement;
				return image.complete && image.naturalWidth > 0;
			}),
	);
}

async function throttle(page: Page, context: BrowserContext) {
	const cdp = await context.newCDPSession(page);
	await cdp.send("Network.enable");
	await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
	await cdp.send("Network.emulateNetworkConditions", {
		offline: false,
		latency: 150,
		downloadThroughput: 128_000,
		uploadThroughput: 64_000,
	});
	const requested = new Set<string>();
	page.on("request", (request) => {
		if (request.resourceType() === "image") requested.add(request.url());
	});
	return requested;
}

async function imageSources(pane: Locator) {
	return pane
		.locator("img")
		.evaluateAll((elements) => elements.map((image) => (image as HTMLImageElement).src));
}

async function recordFirstFrame(pane: Locator) {
	await pane.evaluate((element) => {
		element.removeAttribute("data-first-frame-ready");
		const observer = new MutationObserver(() => {
			if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return;
			observer.disconnect();
			requestAnimationFrame(() => {
				element.setAttribute(
					"data-first-frame-ready",
					String(
						Array.from(element.querySelectorAll("img")).every(
							(image) => image.complete && image.naturalWidth > 0,
						),
					),
				);
			});
		});
		observer.observe(element, { attributes: true });
		// A selected inner panel becomes visible when its containing slide or panel opens.
		for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
			observer.observe(ancestor, {
				attributes: true,
				attributeFilter: ["hidden", "inert", "aria-hidden"],
			});
		}
	});
}

for (const variant of ["en", "narrated-fr", "cards"]) {
	const name =
		variant === "cards"
			? "cards retain preloaded images through every transition"
			: `${variant} warms only adjacent panes before navigation under throttling`;
	test(name, async ({ page, context, browserName }) => {
		test.skip(browserName !== "chromium", "CDP network throttling requires Chromium");
		const requested = await throttle(page, context);
		await page.emulateMedia({ reducedMotion: variant === "cards" ? "no-preference" : "reduce" });
		await page.goto(`${origin}${entries.get(variant)}`);
		if (variant === "cards")
			await expect(page.locator("[data-card-root]")).toHaveAttribute("data-card-enhanced", "true");
		if (variant === "narrated-fr") {
			await expect(page.locator("html")).toHaveAttribute("lang", "fr");
			await expect(page.locator("#deck-narration audio")).toHaveAttribute("src", /\.mp3$/);
		}
		const panes = page.locator(variant === "cards" ? ".praxity-slides-item" : "[data-deck-slide]");
		await expect(panes).toHaveCount(6);
		await expect.poll(() => loaded(panes.nth(0))).toBe(true);
		await expect.poll(() => loaded(panes.nth(1))).toBe(true);
		const sources = await panes.evaluateAll((elements) =>
			elements.map((element) => Array.from(element.querySelectorAll("img"), (image) => image.src)),
		);
		if (variant === "cards") {
			// Opacity transitions keep all cards rendered; Chromium already fetches all images on main.
			for (const pane of await panes.all()) await expect.poll(() => loaded(pane)).toBe(true);
			expect([...requested].sort()).toEqual(sources.flat().sort());
		} else {
			expect(requested.size).toBe(4);
			expect([...requested].sort()).toEqual([0, 1].flatMap((index) => sources[index]).sort());
			for (const source of sources.slice(2).flat()) expect(requested.has(source)).toBe(false);
		}
		await recordFirstFrame(panes.nth(1));
		if (variant === "cards") await page.locator("[data-card-next]").click();
		else await page.locator("#deck-next").click();
		await expect(panes.nth(1)).toHaveAttribute("data-first-frame-ready", "true");
		await expect.poll(() => loaded(panes.nth(2))).toBe(true);
		if (variant === "cards") {
			await expect(panes.nth(1)).toHaveCSS("opacity", "1");
			for (let index = 2; index < 6; index++) {
				await recordFirstFrame(panes.nth(index));
				await page.locator("[data-card-next]").click();
				await expect(panes.nth(index)).toHaveAttribute("data-first-frame-ready", "true");
				await expect(panes.nth(index)).toHaveCSS("opacity", "1");
			}
		} else {
			for (const source of sources.slice(3).flat()) expect(requested.has(source)).toBe(false);
		}
		if (variant === "en" || variant === "narrated-fr") {
			await expect(panes.nth(0).locator("img").first()).toHaveAttribute("fetchpriority", "low");
			await page.locator("#deck-previous").click();
			await expect(panes.nth(0).locator("img").first()).toHaveAttribute("fetchpriority", "high");
		}
	});
}

test("a deep-linked slide warms both neighbours, and failed/offline images do not block navigation", async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*.svg", (route) => route.abort());
	await page.goto(`${origin}${entries.get("en")}#pane-3`);
	const panes = page.locator("[data-deck-slide]");
	await expect(panes.nth(3)).toBeVisible();
	for (const index of [2, 3, 4])
		await expect(panes.nth(index).locator("img").first()).toHaveAttribute("loading", "eager");
	await expect(panes.nth(5).locator("img").first()).toHaveAttribute("loading", "lazy");
	await context.setOffline(true);
	await page.locator("#deck-next").click();
	await expect(panes.nth(4)).toBeVisible();
	await page.locator("#deck-previous").click();
	await expect(panes.nth(3)).toBeVisible();
	await expect(page.locator("#deck-status")).toHaveText("");
	expect(errors).toEqual([]);
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
	test(`en keyboard neighbours and end boundaries, motion ${reducedMotion}`, async ({
		page,
		context,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "CDP network throttling requires Chromium");
		const requested = await throttle(page, context);
		await page.emulateMedia({ reducedMotion });
		await page.goto(`${origin}${entries.get("en")}`);
		const panes = page.locator("[data-deck-slide]");
		await expect.poll(() => loaded(panes.nth(1))).toBe(true);
		expect(requested.size).toBe(4);
		await page.locator("#main-content").focus();
		await page.keyboard.press("ArrowLeft");
		await expect(panes.nth(0)).toBeVisible();
		await recordFirstFrame(panes.nth(1));
		await page.keyboard.press("ArrowRight");
		await expect(panes.nth(1)).toHaveAttribute("data-first-frame-ready", "true");
		await recordFirstFrame(panes.nth(0));
		await page.keyboard.press("ArrowLeft");
		await expect(panes.nth(0)).toHaveAttribute("data-first-frame-ready", "true");
		for (let index = 1; index < 6; index++) {
			await expect.poll(() => loaded(panes.nth(index))).toBe(true);
			await recordFirstFrame(panes.nth(index));
			await page.keyboard.press("ArrowRight");
			await expect(panes.nth(index)).toHaveAttribute("data-first-frame-ready", "true");
		}
		await expect(page.locator("#deck-next")).toHaveAccessibleName("Finish module");
		await page.keyboard.press("ArrowRight");
		await expect(page.locator("#deck-completion")).toBeVisible();
		await expect(panes.nth(0)).toBeHidden();
		await page.keyboard.press("ArrowLeft");
		await expect(panes.nth(5)).toBeVisible();
	});
}

test("en fast keyboard navigation only requests visited panes and their neighbours", async ({
	page,
	context,
	browserName,
}) => {
	test.skip(browserName !== "chromium", "CDP network throttling requires Chromium");
	const requested = await throttle(page, context);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto(`${origin}${entries.get("en")}`);
	const panes = page.locator("[data-deck-slide]");
	await expect.poll(() => loaded(panes.nth(1))).toBe(true);
	await page.locator("#main-content").focus();
	for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowRight"]) {
		await page.keyboard.press(key);
	}
	await expect(panes.nth(2)).toBeVisible();
	for (const index of [0, 1, 2, 3]) await expect.poll(() => loaded(panes.nth(index))).toBe(true);
	const expected = await Promise.all([0, 1, 2, 3].map((index) => imageSources(panes.nth(index))));
	expect(requested.size).toBe(8);
	expect([...requested].sort()).toEqual(expected.flat().sort());
});

for (const arrival of ["deep link", "restore"]) {
	test(`${arrival} warms real images within request bounds under throttling`, async ({
		page,
		context,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "CDP network throttling requires Chromium");
		const requested = await throttle(page, context);
		await page.emulateMedia({ reducedMotion: "reduce" });
		if (arrival === "restore") {
			await page.goto(`${origin}${entries.get("en")}#pane-3`);
			await expect(page.locator('[data-deck-slide="pane-3"]')).toBeVisible();
			await page.goto("about:blank");
			requested.clear();
		}
		await page.goto(`${origin}${entries.get("en")}${arrival === "deep link" ? "#pane-3" : ""}`);
		const panes = page.locator("[data-deck-slide]");
		await expect(panes.nth(3)).toBeVisible();
		for (const index of [2, 3, 4]) await expect.poll(() => loaded(panes.nth(index))).toBe(true);
		const expected = await Promise.all([2, 3, 4].map((index) => imageSources(panes.nth(index))));
		// The document's static LCP image is discoverable before the runtime resolves arrival.
		const first = (await imageSources(panes.nth(0)))[0];
		expect(requested.size).toBe(7);
		expect([...requested].sort()).toEqual([first, ...expected.flat()].sort());
		await recordFirstFrame(panes.nth(4));
		await page.locator("#deck-next").click();
		await expect(panes.nth(4)).toHaveAttribute("data-first-frame-ready", "true");
		await recordFirstFrame(panes.nth(3));
		await page.locator("#deck-previous").click();
		await expect(panes.nth(3)).toHaveAttribute("data-first-frame-ready", "true");
	});
}

test("tabs inside deck slides wait for deck activation and respect nested request bounds", async ({
	page,
	context,
	browserName,
}) => {
	test.skip(browserName !== "chromium", "CDP network throttling requires Chromium");
	const requested = await throttle(page, context);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.addInitScript(() => {
		Object.assign(window, {
			API: {
				LMSInitialize: () => "true",
				LMSGetValue: (key: string) => (key === "cmi.core.lesson_status" ? "not attempted" : ""),
				LMSSetValue: () => "true",
				LMSCommit: () => "true",
				LMSFinish: () => "true",
				LMSGetLastError: () => "0",
			},
		});
	});
	let releaseDeck!: () => void;
	const deckHeld = new Promise<void>((resolve) => {
		releaseDeck = resolve;
	});
	await page.route(/island-deck[^/]*\.js$/, async (route) => {
		await deckHeld;
		await route.continue();
	});
	try {
		await page.goto(`${origin}${entries.get("deck-tabs")}`, { waitUntil: "domcontentloaded" });
		await expect(page.locator('[data-island="tabs"][data-hydrated]')).toHaveCount(6);
		await expect(page.locator(".praxity-deck")).not.toHaveAttribute("data-ready", "true");
		// Before deck init, static slides have no hidden attribute. Tabs must still refrain.
		const premature = await page
			.locator('[data-deck-slide="pane-5"] .praxity-tabs-panel img')
			.evaluateAll((images) => images.some((image) => image.getAttribute("loading") === "eager"));
		expect(premature).toBe(false);
	} finally {
		releaseDeck();
	}
	const slides = page.locator("[data-deck-slide]");
	await expect(slides.nth(0)).toBeVisible();
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const panels = (index: number) => slides.nth(index).locator(".praxity-tabs-panel");
	await expect.poll(() => loaded(panels(0).nth(0))).toBe(true);
	const sources = await slides.evaluateAll((elements) =>
		elements.map((slide, index) =>
			Array.from(slide.querySelectorAll("img"))
				.filter((image) => {
					const panel = image.closest(".praxity-tabs-panel");
					return !panel || panel.getAttribute("data-node-id") === `slide-${index}-0`;
				})
				.map((image) => image.src),
		),
	);
	await expect.poll(() => loaded(panels(1).nth(0))).toBe(true);
	expect(requested.size).toBe(8);
	expect([...requested].sort()).toEqual([...sources[0], ...sources[1]].sort());
	await recordFirstFrame(panels(1).nth(0));
	await page.locator("#deck-next").click();
	await expect(panels(1).nth(0)).toHaveAttribute("data-first-frame-ready", "true");
	await expect(slides.nth(1)).toBeVisible();
	await expect.poll(() => loaded(panels(2).nth(0))).toBe(true);
	expect(requested.size).toBe(12);
	expect([...requested].sort()).toEqual([...sources[0], ...sources[1], ...sources[2]].sort());
	for (const slide of [0, 1, 2, 3, 4, 5]) {
		for (const panel of [1, 2, 3, 4, 5]) {
			await expect(panels(slide).nth(panel).locator("img").first()).toHaveAttribute(
				"loading",
				"lazy",
			);
		}
	}
});
