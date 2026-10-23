import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { screenshotName } from "./compare.mjs";
import { inventory } from "./inventory.mjs";

const require = createRequire(
	new URL("../../packages/export-pipeline/package.json", import.meta.url),
);
const serve = require("serve-handler");
export const conditions = Object.freeze({
	viewport: { width: 1280, height: 900 },
	deviceScaleFactor: 1,
	locale: "en-US",
	timezoneId: "UTC",
	colorScheme: "light",
	reducedMotion: "reduce",
	seed: 0x1234abcd,
	fixedTime: "2026-01-01T00:00:00.000Z",
	initialStorage: "empty; fresh context for each view",
});

// The shared narration player probes durations sequentially after document load.
// Deck readiness and network-idle can precede verification between those probes.
export function narrationReady(doc = document) {
	return [...doc.querySelectorAll('.praxity-narration-position input[type="range"]')].every(
		(input) => !input.disabled,
	);
}

// Browser-side audit: fullPage alone cannot see nested scrollports.
export function scrollRegions(doc = document) {
	return [...doc.querySelectorAll("*")].flatMap((node) => {
		const rect = node.getBoundingClientRect();
		const style = doc.defaultView.getComputedStyle(node);
		if (
			!rect.width ||
			!rect.height ||
			style.visibility === "hidden" ||
			node === doc.scrollingElement
		)
			return [];
		const vertical = /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
		const horizontal = /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
		return vertical || horizontal
			? [
					{
						element: `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}.${[...node.classList].join(".")}`,
						clientHeight: node.clientHeight,
						scrollHeight: node.scrollHeight,
						clientWidth: node.clientWidth,
						scrollWidth: node.scrollWidth,
						vertical,
						horizontal,
					},
				]
			: [];
	});
}

export function islandsReady(doc = document) {
	return [...doc.querySelectorAll("[data-island]")].every((node) => {
		const rect = node.getBoundingClientRect();
		return (
			!rect.width ||
			!rect.height ||
			doc.defaultView.getComputedStyle(node).visibility === "hidden" ||
			node.hasAttribute("data-hydrated")
		);
	});
}

// Observe every request for the lifetime of the page, including resize-triggered
// fetches after Playwright's one-shot load-state networkidle has already fired.
const networks = new WeakMap();
export function trackNetworkRequests(page) {
	if (networks.has(page)) return networks.get(page);
	const pending = new Set();
	let changed = performance.now();
	page.on("request", (request) => {
		pending.add(request);
		changed = performance.now();
	});
	const finished = (request) => {
		pending.delete(request);
		changed = performance.now();
	};
	page.on("requestfinished", finished);
	page.on("requestfailed", finished);
	const tracker = {
		async waitForQuiet({ quietMs = 500, timeoutMs = 30000 } = {}) {
			const started = performance.now();
			// Always require a fresh quiet interval after the caller's layout change.
			while (pending.size || performance.now() - Math.max(started, changed) < quietMs) {
				if (performance.now() - started >= timeoutMs)
					throw new Error(`Network did not settle: ${[...pending].map((r) => r.url()).join(", ")}`);
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		},
	};
	networks.set(page, tracker);
	return tracker;
}

// Zero offsets are covered by the initial screenshot. Identify only nonzero
// scrollers, in their own document order, so unrelated DOM insertions are inert.
export function initialScrollPositions(doc = document) {
	return [...doc.querySelectorAll("*")]
		.filter((node) => {
			if (!node.scrollTop && !node.scrollLeft) return false;
			const style = doc.defaultView.getComputedStyle(node);
			const rect = node.getBoundingClientRect();
			if (
				node !== doc.scrollingElement &&
				(!rect.width ||
					!rect.height ||
					style.visibility === "hidden" ||
					!/auto|scroll|hidden/.test(`${style.overflowX} ${style.overflowY}`))
			)
				return false;
			return true;
		})
		.map((node, index) => {
			const classes = [...node.classList].sort();
			return {
				element: `${index}:${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${classes.length ? `.${classes.join(".")}` : ""}`,
				top: node.scrollTop,
				left: node.scrollLeft,
			};
		});
}

export function clippedFocusables(doc = document) {
	const clipped = [];
	for (const node of doc.querySelectorAll(
		"a[href],button,input,select,textarea,summary,[tabindex],[contenteditable],iframe,audio[controls],video[controls]",
	)) {
		if (node.tabIndex < 0 || node.disabled || node.closest("[inert]")) continue;
		const rect = node.getBoundingClientRect();
		if (
			!rect.width ||
			!rect.height ||
			doc.defaultView.getComputedStyle(node).visibility === "hidden"
		)
			continue;
		for (let parent = node.parentElement; parent; parent = parent.parentElement) {
			const style = doc.defaultView.getComputedStyle(parent);
			const box = parent.getBoundingClientRect();
			// Content outside a scrollable ancestor is covered by expansion. Audit
			// hidden/clip ancestors inside it, without blaming outer deck clipping.
			if (
				(/auto|scroll/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) ||
				(/auto|scroll/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth)
			)
				break;
			const x = /hidden|clip/.test(style.overflowX);
			const y = /hidden|clip/.test(style.overflowY);
			const left = box.left + parent.clientLeft,
				top = box.top + parent.clientTop;
			if (
				(x && (rect.left < left || rect.right > left + parent.clientWidth)) ||
				(y && (rect.top < top || rect.bottom > top + parent.clientHeight))
			) {
				clipped.push({
					tag: node.tagName.toLowerCase(),
					href: node.getAttribute("href"),
					text: (
						(node.getAttribute("aria-labelledby") || "")
							.split(/\s+/)
							.filter(Boolean)
							.map((id) => doc.getElementById(id)?.textContent || "")
							.join(" ")
							.trim() ||
						node.getAttribute("aria-label") ||
						[...(node.labels || [])].map((label) => label.textContent).join(" ") ||
						node.textContent ||
						node.alt ||
						node.title ||
						""
					)
						.replaceAll(/\s+/g, " ")
						.trim(),
					element: node.outerHTML.slice(0, 300),
					ancestor: parent.tagName.toLowerCase(),
					bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
				});
				break;
			}
		}
	}
	return clipped;
}

export async function settleCapture(page) {
	const network = trackNetworkRequests(page);
	await network.waitForQuiet();
	// Lazy hydration may need temporary scrolling. Retain node references so DOM
	// insertions cannot corrupt restoration of the runtime's natural scroll state.
	const positions = await page.evaluateHandle(() =>
		[...document.querySelectorAll("*")].map((node) => ({
			node,
			top: node.scrollTop,
			left: node.scrollLeft,
		})),
	);
	try {
		const islands = page.locator("[data-island]");
		for (let i = 0; i < (await islands.count()); i++) {
			const island = islands.nth(i);
			if (
				(await island.isVisible()) &&
				!(await island.evaluate((node) => node.hasAttribute("data-hydrated")))
			) {
				await island.scrollIntoViewIfNeeded();
				await network.waitForQuiet();
			}
		}
		await page.waitForFunction(islandsReady);
	} finally {
		await page.evaluate((saved) => {
			for (const { node, top, left } of saved)
				if (node.isConnected) {
					node.scrollTop = top;
					node.scrollLeft = left;
				}
		}, positions);
		await positions.dispose();
	}
	await page.evaluate(() => {
		for (const image of document.images) image.loading = "eager";
	});
	await page.waitForFunction(
		() =>
			document.fonts.status === "loaded" && [...document.images].every((image) => image.complete),
	);
	await page.waitForFunction(narrationReady);
	await page.evaluate(async () => {
		await document.fonts.ready;
		await Promise.all(
			[...document.images].filter((image) => image.naturalWidth).map((image) => image.decode()),
		);
		for (const media of document.querySelectorAll("audio,video")) {
			media.muted = true;
			media.pause();
		}
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	await network.waitForQuiet();
}

export async function captureFullRegion(page) {
	const history = [];
	for (let attempt = 0; attempt < 10; attempt++) {
		await settleCapture(page);
		const regions = await page.evaluate(scrollRegions);
		const viewport = page.viewportSize();
		history.push({ viewport, regions });
		if (!regions.length) return { viewport, history, remaining: [] };
		if (regions.some((region) => region.horizontal))
			throw new Error(`Uncaptured horizontal scroll region: ${JSON.stringify(regions)}`);
		const height =
			viewport.height +
			Math.max(...regions.map((region) => region.scrollHeight - region.clientHeight));
		if (height > 20000) break;
		await page.setViewportSize({ width: viewport.width, height });
	}
	throw new Error(`Uncaptured scroll regions after viewport expansion: ${JSON.stringify(history)}`);
}

export function unprovenMediaCancellations(cancelled, completed) {
	const successful = new Set(completed);
	return [...new Set(cancelled)].filter((url) => !successful.has(url));
}

/** One loopback origin is reused across both sides; no warmed browser state. */
export async function capturePair(chromium, baseRoot, candidateRoot, out) {
	const inventories = [await inventory(baseRoot), await inventory(candidateRoot)];
	await mkdir(out, { recursive: true });
	await writeFile(
		path.join(out, "inventory.json"),
		JSON.stringify({ base: inventories[0], candidate: inventories[1] }, null, 2),
	);
	let root = baseRoot;
	const server = createServer((req, res) => {
		serve(req, res, { public: root, cleanUrls: false, directoryListing: false }).catch((error) => {
			res.writeHead(500);
			res.end(String(error));
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const origin = `http://127.0.0.1:${server.address().port}`;
	let browser;
	try {
		browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
		await writeFile(
			path.join(out, "browser.json"),
			JSON.stringify(
				{
					browser: "Chromium",
					version: browser.version(),
					installedChromiumExecutable: chromium.executablePath(),
					headless: true,
					...conditions,
				},
				null,
				2,
			),
		);
		for (const [index, side] of ["base", "candidate"].entries()) {
			root = index === 0 ? baseRoot : candidateRoot;
			const directory = path.join(out, side);
			await mkdir(directory, { recursive: true });
			const ledger = inventories[index].map((view) => ({
				...view,
				status: "pending",
				errors: [],
				brokenImages: [],
				cancelledMedia: [],
				completedMedia: [],
				verifiedMedia: [],
				screenshot: screenshotName(view.key),
			}));
			const save = () =>
				writeFile(path.join(directory, "capture.json"), JSON.stringify(ledger, null, 2));
			await save();
			for (const entry of ledger) {
				let context;
				try {
					context = await browser.newContext({
						viewport: conditions.viewport,
						deviceScaleFactor: conditions.deviceScaleFactor,
						locale: conditions.locale,
						timezoneId: conditions.timezoneId,
						colorScheme: conditions.colorScheme,
						reducedMotion: conditions.reducedMotion,
						serviceWorkers: "block",
					});
					await context.addInitScript((seed) => {
						let value = seed;
						Math.random = () => {
							value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
							return value / 4294967296;
						};
					}, conditions.seed);
					const page = await context.newPage();
					trackNetworkRequests(page);
					const requestedMedia = new Set();
					page.on("request", (request) => {
						if (request.resourceType() === "media") requestedMedia.add(request.url());
					});
					page.on("pageerror", (error) => entry.errors.push(`pageerror: ${error.message}`));
					page.on("console", (message) => {
						if (message.type() === "error") entry.errors.push(`console: ${message.text()}`);
					});
					page.on("requestfailed", (request) => {
						const error = request.failure()?.errorText;
						// A cancellation is accepted only with a completed load of the same URL.
						if (request.resourceType() === "media" && error === "net::ERR_ABORTED")
							entry.cancelledMedia.push(request.url());
						else entry.errors.push(`requestfailed: ${request.url()} ${error}`);
					});
					page.on("requestfinished", (request) => {
						if (request.resourceType() === "media") entry.completedMedia.push(request.url());
					});
					page.on("response", (response) => {
						if (response.status() >= 400)
							entry.errors.push(`HTTP ${response.status()}: ${response.url()}`);
					});
					await context.route("**/*", (route) => {
						const url = new URL(route.request().url());
						if (["data:", "blob:"].includes(url.protocol) || url.origin === origin)
							return route.continue();
						entry.errors.push(`external request: ${url.href}`);
						return route.abort();
					});
					await page.clock.setFixedTime(new Date(conditions.fixedTime));
					await page.goto(`${origin}/${entry.url}`, { waitUntil: "networkidle" });
					if (await page.locator(".praxity-deck").count())
						await page.locator('.praxity-deck[data-ready="true"]').waitFor();
					if (entry.id)
						await page.waitForFunction((id) => {
							const slide = [...document.querySelectorAll("[data-deck-slide]")].find(
								(node) => node.getAttribute("data-deck-slide") === id,
							);
							return (
								slide &&
								slide.getBoundingClientRect().width > 0 &&
								slide.getBoundingClientRect().height > 0
							);
						}, entry.id);
					await settleCapture(page);
					entry.initialScrollPositions = await page.evaluate(initialScrollPositions);
					entry.clippedFocusables = await page.evaluate(clippedFocusables);
					entry.initialScreenshot = `initial-${entry.screenshot}`;
					await page.screenshot({
						path: path.join(directory, entry.initialScreenshot),
						fullPage: false,
						animations: "disabled",
						caret: "hide",
					});
					entry.scrollCapture = await captureFullRegion(page);
					// Chromium often aborts metadata preloads once the header is read. Fully
					// load each unfinished media URL in this view to corroborate availability.
					entry.verifiedMedia = await page.evaluate(
						async (urls) => {
							const verified = [];
							for (const url of urls) {
								const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
								if (!response.ok)
									throw new Error(`Media verification HTTP ${response.status}: ${url}`);
								await response.arrayBuffer();
								verified.push(url);
							}
							return verified;
						},
						[...requestedMedia].filter((url) => !entry.completedMedia.includes(url)),
					);
					entry.islands = await page.locator("[data-island]").evaluateAll((nodes) =>
						nodes.map((node) => ({
							type: node.getAttribute("data-island"),
							hydrated: node.hasAttribute("data-hydrated"),
							rendered: Boolean(
								node.getBoundingClientRect().width && node.getBoundingClientRect().height,
							),
						})),
					);
					entry.brokenImages = await page
						.locator("img")
						.evaluateAll((images) =>
							images
								.filter((image) => !image.complete || !image.naturalWidth)
								.map((image) => image.src),
						);
					entry.narration = await page
						.locator('.praxity-narration-position input[type="range"]')
						.evaluateAll((inputs) =>
							inputs.map((input) => ({
								value: input.value,
								max: input.max,
								disabled: input.disabled,
							})),
						);
					await page.screenshot({
						path: path.join(directory, entry.screenshot),
						fullPage: true,
						animations: "disabled",
						caret: "hide",
					});
					entry.finalClippedFocusables = await page.evaluate(clippedFocusables);
					const remaining = await page.evaluate(scrollRegions);
					if (remaining.length)
						throw new Error(
							`Uncaptured scroll regions after screenshot: ${JSON.stringify(remaining)}`,
						);
					await page.waitForFunction(islandsReady);
					entry.finalUrl = page.url().replace(origin, "");
					entry.status = "captured";
				} catch (error) {
					entry.status = "failed";
					entry.errors.push(String(error));
				} finally {
					await context?.close();
					for (const url of unprovenMediaCancellations(entry.cancelledMedia, [
						...entry.completedMedia,
						...entry.verifiedMedia,
					]))
						entry.errors.push(`media cancelled without completed load: ${url}`);
					await save();
				}
			}
		}
	} finally {
		await browser?.close();
		await new Promise((resolve) => server.close(resolve));
	}
}
