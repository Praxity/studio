import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { getHighlightStrings } from "@praxity/shared-blocks/i18n/highlight-strings";
import { build } from "esbuild";
import { renderHighlight } from "../../src/patterns/highlight/render";
import { highlightHarnessContent, writeHighlightHarness } from "./fixtures/highlight-harness";

let throwingAdapter: string;
let directory: string, url: string, server: ReturnType<typeof createServer>;
const evidence = process.env.PRAXITY_HIGHLIGHT_EVIDENCE_DIR;

test.beforeAll(async ({ browser }) => {
	await test
		.info()
		.attach("browser-version", { body: browser.version(), contentType: "text/plain" });
	directory = await mkdtemp(join(tmpdir(), "highlight-delivery-"));
	await writeHighlightHarness(directory, true);
	const entry = resolve(import.meta.dirname, "../../template/src/islands/island-highlight.ts");
	await build({
		entryPoints: [entry],
		bundle: true,
		format: "esm",
		outfile: join(directory, "island-highlight.js"),
	});
	// Keep the production adapter; replace only its enhancer at the dependency seam.
	const failing = await build({
		entryPoints: [entry],
		bundle: true,
		format: "esm",
		write: false,
		plugins: [
			{
				name: "throwing-highlight-enhancer",
				setup(builder) {
					builder.onLoad({ filter: /patterns[\\/]highlight[\\/]enhance\.ts$/ }, () => ({
						loader: "ts",
						contents: `export function enhanceHighlight(root) {
     const flow=root.querySelector('[data-highlight-flow]'); flow.hidden=false;
     const button=document.createElement('button'); button.dataset.praxityJsControl='';
     button.textContent='Partial control'; flow.append(button); button.focus();
     root.querySelector('[data-highlight-chunk]').setAttribute('data-highlight-outcome','wrong');
     const feedback=root.querySelector('[data-highlight-feedback]');
     feedback.setAttribute('data-highlight-outcome','wrong'); feedback.textContent='Stale'; feedback.hidden=false;
     root.querySelector('details').hidden=true; throw new Error('partial attach');
    }`,
					}));
				},
			},
		],
	});
	throwingAdapter = failing.outputFiles[0].text;
	await build({
		entryPoints: [entry],
		bundle: true,
		format: "iife",
		globalName: "PraxityHighlightIsland",
		outfile: join(directory, "island-highlight.classic.js"),
	});
	await build({
		entryPoints: [resolve(import.meta.dirname, "../../template/src/island-bootstrap.ts")],
		bundle: true,
		format: "iife",
		outfile: join(directory, "island-loader.js"),
	});
	for (const [lang, theme] of [
		["en", "light"],
		["fr", "dark"],
	]) {
		const file = join(directory, `key-${lang}-${theme}.html`);
		const html = (await readFile(file, "utf8"))
			.replace("</head>", '<script defer src="island-loader.js"></script></head>')
			.replace(
				"</body>",
				`<script>window.highlightAnnouncements=[];new MutationObserver(()=>{window.highlightAnnouncements.push(document.querySelector('[data-highlight-status]').textContent)}).observe(document.querySelector('[data-highlight-status]'),{childList:true});</script></body>`,
			);
		await writeFile(file, html);
		if (lang === "en" && theme === "light")
			await writeFile(
				join(directory, "two.html"),
				html.replace(
					"</main>",
					`<div class="praxity-block" data-island="highlight">${renderHighlight(highlightHarnessContent("en", "key"), { prefix: "second", lang: "en", headingLevel: 2 })}</div></main>`,
				),
			);
	}
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
	// Warm fonts and the scanner outside each failure-state timing budget.
	const warm = await browser.newPage();
	await warm.goto(`${url}/key-en-light.html`);
	await warm.evaluate(() => document.fonts.ready);
	await new AxeBuilder({ page: warm })
		.include("main")
		.setLegacyMode(true)
		.options({ resultTypes: ["violations"] })
		.analyze();
	await warm.close();
});
test.afterAll(async () => {
	if (server)
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done())),
		);
	if (directory) await rm(directory, { recursive: true });
});

for (const [lang, theme] of [
	["en", "light"],
	["fr", "dark"],
] as const)
	for (const failure of ["denied", "attach"] as const)
		test(`${failure} restores ${lang} ${theme} baseline at 320px`, async ({
			page,
			browserName,
		}) => {
			await page.setViewportSize({ width: 320, height: 900 });
			await page.route("**/island-highlight.js", (route) =>
				failure === "denied"
					? route.abort("accessdenied")
					: route.fulfill({
							contentType: "text/javascript",
							body: throwingAdapter,
						}),
			);
			await page.goto(`${url}/key-${lang}-${theme}.html`);
			const status = page.locator("[data-highlight-status]");
			await expect(status).toHaveText(getHighlightStrings(lang).highlightUnavailable);
			await expect(status).toHaveClass("praxity-assessment-choice-hint");
			await expect(page.locator("[data-highlight-flow]")).toBeHidden();
			await expect(page.locator("[data-highlight-fallback]")).toBeVisible();
			await expect(page.locator("[data-highlight-fallback]")).not.toHaveAttribute("open");
			await expect(page.getByRole("button", { name: "Partial control" })).toHaveCount(0);
			if (failure === "attach") {
				await expect(page.locator("summary")).toBeFocused();
				await expect(page.locator("[data-highlight-outcome]")).toHaveCount(0);
				await expect(page.locator("[data-highlight-feedback]").first()).toHaveText("");
			}
			expect(
				await page.evaluate(
					() => (window as Window & { highlightAnnouncements?: string[] }).highlightAnnouncements,
				),
			).toEqual([getHighlightStrings(lang).highlightUnavailable]);
			expect(
				(
					await new AxeBuilder({ page })
						.include("main")
						.setLegacyMode(true)
						.options({ resultTypes: ["violations"] })
						.analyze()
				).violations,
			).toEqual([]);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
			).toBeLessThanOrEqual(1);
			if (evidence && failure === "denied" && browserName === "chromium")
				await page.screenshot({
					path: join(evidence, `failure-${lang}-${theme}-320.png`),
					fullPage: true,
				});
		});

test("absent bootstrap leaves the silent useful baseline", async ({ page }) => {
	await page.route("**/island-loader.js", (route) => route.abort());
	await page.goto(`${url}/key-en-light.html`);
	await expect(page.locator("[data-highlight-status]")).toHaveText("");
	await expect(page.locator("[data-highlight-flow]")).toBeHidden();
	await page.locator("summary").click();
	await expect(page.locator("details ul")).toBeVisible();
});
test("ESM delivery attaches memory-only controls silently", async ({ page }) => {
	await page.goto(`${url}/key-en-light.html`);
	await expect(page.locator('[data-island="highlight"]')).toHaveAttribute("data-hydrated", "");
	await expect(page.locator("[data-highlight-status]")).toHaveText("");
	await expect(page.locator("[data-highlight-flow]")).toBeVisible();
	await expect(page.locator("[data-highlight-fallback]")).toBeHidden();
});
test("offline file delivery uses the classic highlight adapter", async ({ page }) => {
	await page.goto(pathToFileURL(join(directory, "key-en-light.html")).href);
	await expect(page.locator('[data-island="highlight"]')).toHaveAttribute("data-hydrated", "");
	// Firefox does not expose every file:// script through Playwright request events.
	// Only the executed classic bundle publishes this adapter on window.
	expect(await page.evaluate(() => typeof window.PraxityHighlightIsland?.attachIsland)).toBe(
		"function",
	);
	await expect(page.locator("[data-highlight-status]")).toHaveText("");
});

test("pending import retains the silent usable baseline and does not steal focus on attach", async ({
	page,
}) => {
	let release!: () => void;
	const gate = new Promise<void>((done) => {
		release = done;
	});
	await page.route("**/island-highlight.js", async (route) => {
		await gate;
		await route.continue();
	});
	const requested = page.waitForRequest("**/island-highlight.js");
	try {
		await page.goto(`${url}/key-en-light.html`, { waitUntil: "domcontentloaded" });
		await requested;
		await expect(page.locator("[data-highlight-flow]")).toBeHidden();
		await expect(page.locator("[data-highlight-fallback]")).toBeVisible();
		await expect(page.locator("[data-highlight-fallback]")).not.toHaveAttribute("open");
		await expect(page.locator("[data-highlight-memory-notice]")).toHaveCount(0);
		await expect(page.locator("[data-highlight-status]")).toHaveText("");
		await page.evaluate(() => {
			const outside = document.createElement("button");
			outside.id = "outside";
			outside.textContent = "Outside";
			document.body.append(outside);
			outside.focus();
		});
		expect(
			(
				await new AxeBuilder({ page })
					.include("main")
					.setLegacyMode(true)
					.options({ resultTypes: ["violations"] })
					.analyze()
			).violations,
		).toEqual([]);
	} finally {
		release();
	}
	await expect(page.locator('[data-island="highlight"]')).toHaveAttribute("data-hydrated", "");
	await expect(page.locator("#outside")).toBeFocused();
	await expect(page.locator("[data-highlight-memory-notice]")).toHaveCount(1);
	await expect(page.locator("[data-highlight-status]")).toHaveText("");
});

for (const target of ["summary", "answer link"] as const)
	test(`pending attach moves focused ${target} to the first chunk it reveals`, async ({ page }) => {
		let release!: () => void;
		const gate = new Promise<void>((done) => {
			release = done;
		});
		await page.route("**/island-highlight.js", async (route) => {
			await gate;
			await route.continue();
		});
		const requested = page.waitForRequest("**/island-highlight.js");
		try {
			await page.goto(`${url}/key-en-light.html`, { waitUntil: "domcontentloaded" });
			await requested;
			await page.locator("[data-highlight-fallback]").evaluate((answer, target) => {
				if (target === "summary") (answer.querySelector("summary") as HTMLElement).focus();
				else {
					(answer as HTMLDetailsElement).open = true;
					const link = document.createElement("a");
					link.href = "#reading";
					link.textContent = "Reading";
					answer.append(link);
					link.focus();
				}
			}, target);
			expect(
				await page
					.locator("[data-highlight-fallback]")
					.evaluate((answer) => answer.contains(document.activeElement)),
			).toBe(true);
		} finally {
			release();
		}
		await expect(page.locator('[data-island="highlight"]')).toHaveAttribute("data-hydrated", "");
		await expect(page.locator("[data-highlight-chunk]").first()).toBeFocused();
		await expect(page.locator("[data-highlight-fallback]")).toBeHidden();
		await expect(page.locator("[data-highlight-status]")).toHaveText("");
		expect(
			(
				await new AxeBuilder({ page })
					.include("main")
					.setLegacyMode(true)
					.options({ resultTypes: ["violations"] })
					.analyze()
			).violations,
		).toEqual([]);
	});

for (const failure of ["tampered text", "listener registration"] as const)
	test(`real enhancer ${failure} failure recovers through the adapter and announces once`, async ({
		page,
	}) => {
		let release!: () => void;
		const gate = new Promise<void>((done) => {
			release = done;
		});
		await page.route("**/island-highlight.js", async (route) => {
			await gate;
			await route.continue();
		});
		const requested = page.waitForRequest("**/island-highlight.js");
		try {
			await page.goto(`${url}/key-en-light.html`, { waitUntil: "domcontentloaded" });
			await requested;
			await page
				.locator("[data-highlight-chunk]")
				.nth(1)
				.evaluate((chunk, failure) => {
					if (failure === "tampered text") chunk.textContent += " altered";
					else {
						// The native registration boundary fails after earlier listeners were installed.
						chunk.addEventListener = () => {
							throw new Error("registration");
						};
					}
				}, failure);
		} finally {
			release();
		}
		const status = page.locator("[data-highlight-status]");
		await expect(status).toHaveText(getHighlightStrings("en").highlightUnavailable);
		await expect(page.locator("[data-highlight-flow]")).toBeHidden();
		await expect(page.locator("[data-highlight-fallback]")).toBeVisible();
		await expect(page.locator("[data-highlight-fallback]")).not.toHaveAttribute("open");
		await expect(
			page.locator(
				"[data-highlight-enhanced], [data-highlight-memory-notice], [data-highlight-chunk][role], [data-highlight-chunk][tabindex], [data-highlight-outcome]",
			),
		).toHaveCount(0);
		expect(
			await page.evaluate(
				() => (window as Window & { highlightAnnouncements?: string[] }).highlightAnnouncements,
			),
		).toEqual([getHighlightStrings("en").highlightUnavailable]);
		expect(
			(
				await new AxeBuilder({ page })
					.include("main")
					.setLegacyMode(true)
					.options({ resultTypes: ["violations"] })
					.analyze()
			).violations,
		).toEqual([]);
	});

test("later block failure restores pending Answer focus after earlier chunk attachment", async ({
	page,
}) => {
	let release!: () => void;
	const gate = new Promise<void>((done) => {
		release = done;
	});
	await page.route("**/island-highlight.js", async (route) => {
		await gate;
		await route.continue();
	});
	const requested = page.waitForRequest("**/island-highlight.js");
	const roots = page.locator("[data-highlight]");
	try {
		await page.goto(`${url}/two.html`, { waitUntil: "domcontentloaded" });
		await requested;
		await expect(roots).toHaveCount(2);
		await roots
			.last()
			.locator("[data-highlight-chunk]")
			.first()
			.evaluate((chunk) => {
				chunk.textContent += " altered";
			});
		await roots.first().locator("summary").focus();
		await expect(roots.first().locator("summary")).toBeFocused();
	} finally {
		release();
	}
	const notice = getHighlightStrings("en").highlightUnavailable;
	await expect(roots.locator("[data-highlight-status]")).toHaveText([notice, notice]);
	await expect(roots.first().locator("summary")).toBeFocused();
	for (const root of [roots.first(), roots.last()]) {
		await expect(root.locator("[data-highlight-flow]")).toBeHidden();
		await expect(root.locator("[data-highlight-fallback]")).toBeVisible();
		await expect(root.locator("[data-highlight-fallback]")).not.toHaveAttribute("open");
	}
	await expect(
		page.locator(
			"[data-highlight-enhanced], [data-highlight-memory-notice], [data-highlight-chunk][tabindex]",
		),
	).toHaveCount(0);
	expect(
		await page.evaluate(
			() => (window as Window & { highlightAnnouncements?: string[] }).highlightAnnouncements,
		),
	).toEqual([notice]);
	expect(
		(
			await new AxeBuilder({ page })
				.include("main")
				.setLegacyMode(true)
				.options({ resultTypes: ["violations"] })
				.analyze()
		).violations,
	).toEqual([]);
});
