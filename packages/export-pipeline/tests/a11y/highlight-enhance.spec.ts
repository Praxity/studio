import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { getHighlightStrings } from "@praxity/shared-blocks/i18n/highlight-strings";
import { build } from "esbuild";
import { renderHighlight } from "../../src/patterns/highlight/render";
import { highlightHarnessContent, writeHighlightHarness } from "./fixtures/highlight-harness";

let directory: string, url: string, server: ReturnType<typeof createServer>;
const evidence = process.env.PRAXITY_HIGHLIGHT_EVIDENCE_DIR;
const captureNames = process.env.PRAXITY_HIGHLIGHT_SCREENSHOTS?.split(",");
const chunk = (page: Page) => page.locator("[data-highlight-chunk]");
const ui = (page: Page, name: string) => page.locator(`[data-highlight-${name}]`);
async function scan(page: Page) {
	expect(
		(
			await new AxeBuilder({ page })
				.include("main")
				.setLegacyMode(true)
				.options({ resultTypes: ["violations"] })
				.analyze()
		).violations,
	).toEqual([]);
}
async function speech(page: Page) {
	return page.evaluate(
		() => (window as unknown as { highlightAnnouncements: string[] }).highlightAnnouncements,
	);
}
async function capture(page: Page, name: string, browserName: string) {
	if (evidence && browserName === "chromium" && (!captureNames || captureNames.includes(name)))
		await page.screenshot({
			path: join(evidence, `${name}.png`),
			fullPage: true,
			animations: "disabled",
		});
}

test.beforeAll(async ({ browser }) => {
	directory = await mkdtemp(join(tmpdir(), "highlight-enhance-"));
	await test
		.info()
		.attach("browser-version", { body: browser.version(), contentType: "text/plain" });
	await writeHighlightHarness(directory, true);
	await build({
		entryPoints: [resolve(import.meta.dirname, "../../src/patterns/highlight/enhance.ts")],
		bundle: true,
		format: "iife",
		globalName: "HighlightTest",
		outfile: join(directory, "enhance.js"),
	});
	for (const lang of ["en", "fr"] as const)
		for (const theme of ["light", "dark"] as const)
			for (const mode of ["key", "evidence"] as const) {
				const file = join(directory, `${mode}-${lang}-${theme}.html`);
				let html = await readFile(file, "utf8");
				// Preserve all four outcomes, target and unmarked notes, and literal punctuation.
				const content = highlightHarnessContent(lang, mode);
				content.maxMarks = 2;
				content.paragraphs[0][1].key = true;
				content.paragraphs[1][0].key = true;
				content.paragraphs[1][1].note =
					lang === "en" ? "An unmarked note." : "Une note non sélectionnée.";
				const original = renderHighlight(highlightHarnessContent(lang, mode), {
					prefix: `practice-${mode}`,
					lang,
					headingLevel: 2,
				});
				const markup = renderHighlight(content, {
					prefix: `practice-${mode}`,
					lang,
					headingLevel: 2,
				});
				html = html.replace(original, markup);
				if (lang === "en" && theme === "light" && mode === "key") {
					await writeFile(
						join(directory, "two.html"),
						html.replace(
							markup,
							markup + renderHighlight(content, { prefix: "second", lang, headingLevel: 2 }),
						),
					);
					await writeFile(
						join(directory, "baseline.html"),
						html.replace("</body>", '<script src="enhance.js"></script></body>'),
					);
					const single = structuredClone(content);
					single.maxMarks = 1;
					await writeFile(
						join(directory, "single.html"),
						html.replace(
							markup,
							renderHighlight(single, { prefix: "single", lang, headingLevel: 2 }),
						),
					);
					const literal = structuredClone(content);
					literal.paragraphs[0][0].text = "&amp; &lt; \" '";
					await writeFile(
						join(directory, "literal.html"),
						html.replace(
							markup,
							renderHighlight(literal, { prefix: "literal", lang, headingLevel: 2 }),
						),
					);
				}
				await writeFile(file, html);
			}
	for (const name of [
		"two",
		"literal",
		"single",
		...["key", "evidence"].flatMap((mode) =>
			["en", "fr"].flatMap((lang) => ["light", "dark"].map((theme) => `${mode}-${lang}-${theme}`)),
		),
	]) {
		const file = join(directory, `${name}.html`);
		await writeFile(
			file,
			(await readFile(file, "utf8")).replace(
				"</body>",
				`<script src="enhance.js"></script><script>window.highlightAnnouncements=[];for(const root of document.querySelectorAll('[data-highlight]')){new MutationObserver(()=>{const text=root.querySelector('[data-highlight-status]').textContent;if(text)window.highlightAnnouncements.push(text)}).observe(root.querySelector('[data-highlight-status]'),{childList:true});HighlightTest.enhanceHighlight(root);}</script></body>`,
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
	const warm = await browser.newPage();
	await warm.goto(`${url}/key-en-light.html`);
	await warm.evaluate(() => document.fonts.ready);
	await scan(warm);
	await warm.close();
});
test.afterAll(async () => {
	if (server)
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done())),
		);
	if (directory) await rm(directory, { recursive: true });
});

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const accesses: string[] = [];
		Object.defineProperty(document, "cookie", {
			configurable: true,
			get() {
				return "";
			},
			set() {
				accesses.push("cookie");
			},
		});
		Object.assign(window, { highlightStorageAccess: accesses });
		window.fetch = () => {
			accesses.push("fetch");
			throw new Error("Unexpected fetch");
		};
		XMLHttpRequest.prototype.open = () => {
			accesses.push("xhr");
			throw new Error("Unexpected xhr");
		};
		const refuse = (name: string): never => {
			accesses.push(name);
			throw new Error(`Unexpected ${name}`);
		};
		navigator.sendBeacon = () => refuse("sendBeacon");
		window.postMessage = () => refuse("postMessage");
		for (const name of ["WebSocket", "EventSource", "BroadcastChannel"])
			Object.defineProperty(window, name, {
				configurable: true,
				value: class {
					constructor() {
						refuse(name);
					}
				},
			});
		for (const name of ["pushState", "replaceState"] as const)
			history[name] = () => refuse(`history.${name}`);
		Object.defineProperty(navigator, "storage", {
			configurable: true,
			get: () => refuse("navigator.storage"),
		});
		Object.defineProperty(window, "name", {
			configurable: true,
			get: () => refuse("window.name"),
			set: () => refuse("window.name"),
		});
		// Location.hash is non-configurable, so observe fragment writes instead.
		window.addEventListener("hashchange", () => accesses.push("location.hash"));
		for (const key of ["localStorage", "sessionStorage", "indexedDB", "caches"])
			Object.defineProperty(window, key, {
				configurable: true,
				get() {
					accesses.push(key);
					throw new Error(`Unexpected ${key}`);
				},
			});
	});
});
test.afterEach(async ({ page }) => {
	expect(
		await page.evaluate(
			() => (window as unknown as { highlightStorageAccess: string[] }).highlightStorageAccess,
		),
	).toEqual([]);
	expect(await page.context().cookies()).toEqual([]);
	expect(await page.evaluate(() => location.hash)).toBe("");
});

for (const mode of ["key", "evidence"] as const)
	for (const lang of ["en", "fr"] as const) {
		const theme = lang === "en" ? "light" : "dark";
		test(`${mode} ${lang}: keyboard navigation wraps and every chunk is a Tab stop`, async ({
			page,
		}) => {
			await page.goto(`${url}/${mode}-${lang}-${theme}.html`);
			const items = chunk(page);
			await expect(items).toHaveCount(4);
			await expect(ui(page, "memory-notice")).toHaveText(
				getHighlightStrings(lang).highlightMemoryNotice,
			);
			await items.first().focus();
			await page.keyboard.press("ArrowLeft");
			await expect(items.last()).toBeFocused();
			await page.keyboard.press("ArrowRight");
			await expect(items.first()).toBeFocused();
			await page.keyboard.press("ArrowUp");
			await expect(items.last()).toBeFocused();
			await page.keyboard.press("ArrowDown");
			await expect(items.first()).toBeFocused();
			await page.keyboard.press("End");
			await expect(items.last()).toBeFocused();
			await page.keyboard.press("Home");
			await expect(items.first()).toBeFocused();
			await page.keyboard.press("Tab");
			await expect(items.nth(1)).toBeFocused();
			await page.keyboard.press("Shift+Tab");
			await expect(items.first()).toBeFocused();
			expect(await speech(page)).toEqual([]);
			await scan(page);
		});
		test(`${mode} ${lang}: repeated presses, silent marks and limit lifetime`, async ({ page }) => {
			await page.goto(`${url}/${mode}-${lang}-${theme}.html`);
			const items = chunk(page);
			await items.first().focus();
			await page.keyboard.down(" ");
			await page.keyboard.down(" ");
			await page.keyboard.up(" ");
			await expect(items.first()).toHaveAttribute("aria-pressed", "true");
			await page.keyboard.press(" ");
			await expect(items.first()).toHaveAttribute("aria-pressed", "false");
			await expect(ui(page, "restart")).toBeHidden();
			await page.keyboard.press(" ");
			await items.nth(1).focus();
			await page.keyboard.down("Enter");
			await page.keyboard.down("Enter");
			await page.keyboard.up("Enter");
			await expect(items.nth(1)).toHaveAttribute("aria-pressed", "true");
			expect(await speech(page)).toEqual([]);
			await expect(ui(page, "limit")).toBeHidden();
			await items.nth(2).press("Enter");
			await expect(ui(page, "limit")).toBeVisible();
			await expect(items.nth(2)).toBeFocused();
			const message = await ui(page, "limit").textContent();
			await items.nth(2).press("Enter");
			expect(await speech(page)).toEqual([message]);
			await items.first().press("Enter");
			await expect(ui(page, "limit")).toBeHidden();
			await expect(ui(page, "status")).toHaveText("");
			await ui(page, "restart").click();
			await expect(items.first()).toBeFocused();
			await expect(ui(page, "restart")).toBeHidden();
			await scan(page);
		});
		for (const selection of ["zero", "partial", "all"] as const)
			test(`${mode} ${lang}: ${selection} Check locks, describes Start over, opens all notes`, async ({
				page,
			}) => {
				await page.goto(`${url}/${mode}-${lang}-${theme}.html`);
				const items = chunk(page);
				if (selection === "partial") {
					await items.nth(0).click();
					await items.nth(1).click();
				}
				if (selection === "all") {
					await items.nth(1).click();
					await items.nth(2).click();
				}
				await items.first().focus();
				// A successful deliberate Check transfers focus even when Check did not own it.
				await ui(page, "check").evaluate((button: HTMLButtonElement) => button.click());
				await expect(ui(page, "restart")).toBeFocused();
				await expect(ui(page, "status")).toHaveText("");
				await expect(ui(page, "restart")).toHaveAttribute(
					"aria-describedby",
					`practice-${mode}-summary`,
				);
				await expect(ui(page, "fallback")).toHaveAttribute("open", "");
				await expect(ui(page, "fallback").locator("li")).toHaveCount(4);
				await expect(ui(page, "check")).toBeHidden();
				expect(
					await items.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-disabled"))),
				).toEqual(["true", "true", "true", "true"]);
				const outcomes =
					selection === "zero"
						? [null, "missed", "missed", null]
						: selection === "partial"
							? ["wrong", "correct", "missed", null]
							: [null, "correct", "correct", null];
				expect(
					await items.evaluateAll((nodes) =>
						nodes.map((n) => n.getAttribute("data-highlight-outcome")),
					),
				).toEqual(outcomes);
				await expect(ui(page, "summary")).toContainText(
					selection === "zero" ? "0" : selection === "partial" ? "1" : "2",
				);
				await items.first().press("Enter");
				expect(await items.first().getAttribute("aria-pressed")).toBe(
					selection === "partial" ? "true" : "false",
				);
				expect(await speech(page)).toEqual([]);
				await scan(page);
			});
	}

for (const [lang, theme, width] of [
	["en", "light", 1280],
	["en", "light", 320],
	["fr", "dark", 320],
] as const)
	for (const state of ["initial", "marked", "limit", "checked", "answer-open", "reset"] as const)
		test(`${state} ${lang} ${theme} ${width}: state and reflow`, async ({ page, browserName }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(`${url}/key-${lang}-${theme}.html`);
			if (state !== "initial") await chunk(page).first().click();
			if (state === "limit") {
				await chunk(page).nth(1).click();
				await chunk(page).nth(2).click();
			}
			if (["checked", "answer-open", "reset"].includes(state)) {
				await chunk(page).nth(1).click();
				await ui(page, "check").click();
			}
			if (state === "reset") {
				await ui(page, "fallback").locator("summary").click();
				await ui(page, "fallback").locator("summary").click();
				await ui(page, "restart").click();
				await expect(chunk(page).first()).toBeFocused();
			}
			await expect(ui(page, "fallback")).toHaveJSProperty(
				"open",
				state === "checked" || state === "answer-open",
			);
			await expect(ui(page, "fallback")).toHaveJSProperty(
				"hidden",
				state !== "checked" && state !== "answer-open",
			);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
			).toBeLessThanOrEqual(1);
			await scan(page);
			await capture(page, `${state}-${lang}-${theme}-${width}`, browserName);
		});

test("two mounts retain independent memory, repeated attach, hidden return and reload", async ({
	page,
}) => {
	await page.goto(`${url}/two.html`);
	const roots = page.locator("[data-highlight]");
	await roots.first().locator("[data-highlight-chunk]").first().click();
	await roots.first().evaluate((root) => {
		const api = (
			window as unknown as { HighlightTest: { enhanceHighlight(root: HTMLElement): unknown } }
		).HighlightTest;
		const first = api.enhanceHighlight(root as HTMLElement);
		if (first !== api.enhanceHighlight(root as HTMLElement)) throw new Error("duplicate instance");
		(root as HTMLElement).hidden = true;
		(root as HTMLElement).hidden = false;
		window.dispatchEvent(new Event("pageshow"));
		document.dispatchEvent(new Event("praxity:self-check-owner"));
		window.dispatchEvent(new Event("praxity:runtime-ready"));
	});
	await expect(roots.first().locator("[aria-pressed=true]")).toHaveCount(1);
	await expect(roots.last().locator("[aria-pressed=true]")).toHaveCount(0);
	await expect(ui(page, "memory-notice")).toHaveCount(2);
	await roots.first().locator("[data-highlight-chunk]").nth(1).click();
	await roots.first().locator("[data-highlight-chunk]").nth(2).click();
	const message = "You can mark up to 2 passages. Unmark one to choose another.";
	await expect(roots.first().locator("[data-highlight-limit]")).toBeVisible();
	await expect(roots.first().locator("[data-highlight-status]")).toHaveText(message);
	await expect(roots.last().locator("[data-highlight-limit]")).toBeHidden();
	await expect(roots.last().locator("[data-highlight-status]")).toHaveText("");
	await roots.last().locator("[data-highlight-chunk]").first().click();
	await expect(roots.last().locator("[data-highlight-count]")).toHaveText("1 of 2 marked");
	await expect(roots.first().locator("[data-highlight-status]")).toHaveText(message);
	await roots.last().locator("[data-highlight-restart]").click();
	await expect(roots.first().locator("[data-highlight-limit]")).toBeVisible();
	await expect(roots.first().locator("[data-highlight-status]")).toHaveText(message);
	await page.reload();
	await expect(page.locator("[aria-pressed=true]")).toHaveCount(0);
	expect(await speech(page)).toEqual([]);
	await scan(page);
});

test("Answer closes/reopens natively, destroy hides it, reattach starts empty without focus", async ({
	page,
}) => {
	await page.goto(`${url}/key-en-light.html`);
	await ui(page, "check").click();
	await page.keyboard.press("Tab");
	await expect(ui(page, "fallback").locator("summary")).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(ui(page, "fallback")).not.toHaveAttribute("open");
	await page.keyboard.press("Enter");
	await expect(ui(page, "fallback")).toHaveAttribute("open");
	await page.evaluate(() => {
		const root = document.querySelector<HTMLElement>("[data-highlight]")!;
		(
			window as unknown as {
				HighlightTest: { enhanceHighlight(root: HTMLElement): { destroy(): void } };
			}
		).HighlightTest.enhanceHighlight(root).destroy();
	});
	await expect(ui(page, "fallback")).toHaveJSProperty("hidden", true);
	await expect(ui(page, "fallback")).not.toHaveAttribute("open");
	await expect(
		page.locator('[role="button"], [aria-pressed], [data-highlight-memory-notice]'),
	).toHaveCount(0);
	await scan(page);
	await page.evaluate(() => {
		const root = document.querySelector<HTMLElement>("[data-highlight]")!;
		(
			window as unknown as { HighlightTest: { enhanceHighlight(root: HTMLElement): unknown } }
		).HighlightTest.enhanceHighlight(root);
	});
	await expect(page.locator("[aria-pressed=true]")).toHaveCount(0);
	expect(await speech(page)).toEqual([]);
});

for (const variant of ["evidence", "literal", "zoom", "spacing", "forced"] as const)
	test(`checked ${variant} preserves text and reflows`, async ({ page, browserName }) => {
		await page.setViewportSize({ width: variant === "zoom" ? 1280 : 320, height: 900 });
		if (variant === "forced") await page.emulateMedia({ forcedColors: "active" });
		await page.goto(
			`${url}/${variant === "literal" ? "literal" : variant === "evidence" ? "evidence-fr-dark" : "key-en-light"}.html`,
		);
		if (variant === "zoom")
			await page.evaluate(() => {
				document.documentElement.style.zoom = "4";
			});
		if (variant === "spacing")
			await page.addStyleTag({
				content:
					"* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }",
			});
		await chunk(page).first().click();
		await ui(page, "check").click();
		if (variant === "literal") await expect(chunk(page).first()).toHaveText("&amp; &lt; \" '");
		if (variant === "evidence")
			await expect(chunk(page).nth(1)).toHaveText("Il dit : « Je reviens à midi ! »");
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
		).toBeLessThanOrEqual(1);
		await scan(page);
		await capture(page, `checked-${variant}-320`, browserName);
	});

test("print hides memory and learner decorations while preserving the mounted attempt", async ({
	page,
}) => {
	await page.goto(`${url}/key-en-light.html`);
	await chunk(page).first().click();
	await ui(page, "check").click();
	await page.emulateMedia({ media: "print" });
	await expect(ui(page, "memory-notice")).toBeHidden();
	await expect(ui(page, "print-answer")).toBeVisible();
	await expect(ui(page, "feedback").first()).toBeHidden();
	await page.emulateMedia({ media: "screen" });
	await expect(ui(page, "memory-notice")).toBeVisible();
	await expect(chunk(page).first()).toHaveAttribute("aria-pressed", "true");
	await expect(ui(page, "fallback")).toHaveAttribute("open");
	expect(await speech(page)).toEqual([]);
	await scan(page);
});

test("tampered literal text fails before mutation and leaves the collapsed baseline", async ({
	page,
}) => {
	await page.route("**/enhance.js", (route) => route.abort());
	await page.goto(`${url}/key-fr-dark.html`);
	await expect(ui(page, "memory-notice")).toHaveCount(0);
	await chunk(page)
		.first()
		.evaluate((node) => {
			node.textContent += " altered";
		});
	await page.unroute("**/enhance.js");
	await page.addScriptTag({ url: `${url}/enhance.js` });
	const error = await page.evaluate(() => {
		try {
			(
				window as unknown as { HighlightTest: { enhanceHighlight(root: HTMLElement): unknown } }
			).HighlightTest.enhanceHighlight(document.querySelector<HTMLElement>("[data-highlight]")!);
			return "";
		} catch (error) {
			return (error as Error).message;
		}
	});
	expect(error).toBe("Invalid highlight passage markup");
	await expect(ui(page, "fallback")).toBeVisible();
	await expect(ui(page, "fallback")).not.toHaveAttribute("open");
	await expect(page.locator('[role="button"]')).toHaveCount(0);
	await scan(page);
});

for (const lang of ["en", "fr"] as const)
	for (const state of ["initial", "marked", "limit", "reset"] as const)
		test(`evidence ${lang}: ${state} remains accessible and speaks only the limit`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 320, height: 900 });
			await page.goto(`${url}/evidence-${lang}-${lang === "en" ? "light" : "dark"}.html`);
			if (state !== "initial") await chunk(page).first().click();
			if (state === "limit") {
				await chunk(page).nth(1).click();
				await chunk(page).nth(2).click();
			}
			if (state === "reset") await ui(page, "restart").click();
			await expect(ui(page, "status")).toHaveText(
				state === "limit" ? ((await ui(page, "limit").textContent()) ?? "") : "",
			);
			await expect(ui(page, "fallback")).toBeHidden();
			if (state === "reset") await expect(chunk(page).first()).toBeFocused();
			if (state !== "limit") expect(await speech(page)).toEqual([]);
			await scan(page);
		});

test("one-mark limit announces once, then becomes eligible again after unmarking", async ({
	page,
}) => {
	await page.goto(`${url}/single.html`);
	await chunk(page).first().click();
	await chunk(page).nth(1).click();
	const message = "You can mark one passage. Unmark it to choose another.";
	await expect(ui(page, "status")).toHaveText(message);
	await chunk(page).nth(2).click();
	expect(await speech(page)).toEqual([message]);
	await chunk(page).first().click();
	await expect(ui(page, "status")).toHaveText("");
	await chunk(page).nth(1).click();
	await chunk(page).nth(2).click();
	expect(await speech(page)).toEqual([message, message]);
	await scan(page);
});

test("detached stale controls cannot mutate or focus a replacement", async ({ page }) => {
	await page.goto(`${url}/key-en-light.html`);
	const result = await page.evaluate(() => {
		const api = (
			window as unknown as {
				HighlightTest: { enhanceHighlight(root: HTMLElement): { destroy(): void } };
			}
		).HighlightTest;
		const old = document.querySelector<HTMLElement>("[data-highlight]")!;
		const fresh = old.cloneNode(true) as HTMLElement;
		api.enhanceHighlight(old).destroy();
		fresh.querySelector("[data-highlight-memory-notice]")?.remove();
		old.replaceWith(fresh);
		api.enhanceHighlight(fresh);
		const first = fresh.querySelector<HTMLElement>("[data-highlight-chunk]")!;
		first.focus();
		old.querySelector<HTMLElement>("[data-highlight-check]")!.click();
		old
			.querySelector<HTMLElement>("[data-highlight-chunk]")!
			.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
		return {
			focus: document.activeElement === first,
			pressed: first.getAttribute("aria-pressed"),
			status: fresh.querySelector("[data-highlight-status]")!.textContent,
		};
	});
	expect(result).toEqual({ focus: true, pressed: "false", status: "" });
	await scan(page);
});

test("descriptions contain group instructions once and checked feedback only on its own chunk", async ({
	page,
}) => {
	await page.goto(`${url}/key-en-light.html`);
	await expect(ui(page, "passage")).toHaveAttribute("role", "group");
	await expect(ui(page, "passage")).toHaveAttribute(
		"aria-describedby",
		"practice-key-instructions",
	);
	await expect(page.locator("[data-highlight-chunk][aria-describedby]")).toHaveCount(0);
	await expect(ui(page, "count")).not.toHaveAttribute("aria-live");
	await expect(ui(page, "memory-notice")).not.toHaveAttribute("aria-live");
	await expect(page.locator('[role="status"]')).toHaveCount(1);
	await chunk(page).first().click();
	await chunk(page).nth(1).click();
	await ui(page, "check").click();
	const descriptionIds = await chunk(page).evaluateAll((nodes) =>
		nodes.map((node) => node.getAttribute("aria-describedby")),
	);
	expect(descriptionIds).toEqual([
		"practice-key-feedback-pause",
		"practice-key-feedback-return",
		"practice-key-feedback-time",
		null,
	]);
	await expect(ui(page, "summary")).not.toHaveAttribute("aria-live");
	await expect(ui(page, "restart")).toBeFocused();
	expect(await speech(page)).toEqual([]);
	await scan(page);
});

for (const mode of ["key", "evidence"] as const)
	for (const lang of ["en", "fr"] as const)
		for (const width of [1280, 320])
			test(`wrong verdict ${mode} ${lang} ${width}: inline label, regular note and activity spacing`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height: 900 });
				await page.goto(`${url}/${mode}-${lang}-${lang === "en" ? "light" : "dark"}.html`);
				await chunk(page).first().click();
				await chunk(page).nth(1).click();
				await ui(page, "check").click();
				const wrong = page.locator('[data-highlight-feedback][data-highlight-outcome="wrong"]');
				await expect(wrong).toHaveCSS("display", "inline");
				await expect(wrong).toHaveCSS("margin-top", "0px");
				await expect(wrong).toHaveCSS("margin-bottom", "0px");
				await expect(wrong.locator(".praxity-highlight-note")).toHaveCSS("font-weight", "400");
				const found = page.locator('[data-highlight-feedback][data-highlight-outcome="correct"]');
				const missed = page.locator('[data-highlight-feedback][data-highlight-outcome="missed"]');
				const verdictWeight = await found.evaluate((node) => getComputedStyle(node).fontWeight);
				await expect(missed).toHaveCSS("font-weight", verdictWeight);
				if (mode === "key") {
					await expect(wrong.locator(".praxity-highlight-verdict")).toHaveCSS(
						"font-weight",
						verdictWeight,
					);
					await expect(wrong.locator(".praxity-highlight-verdict")).toHaveText(
						lang === "en" ? "Not a key idea:" : "Ce n'est pas une idée clé\u202f:",
					);
				} else await expect(wrong.locator(".praxity-highlight-verdict")).toHaveCount(0);
				const joiner = await wrong.evaluate((node) => getComputedStyle(node, "::before").content);
				expect(joiner).toContain("\u2060");
				const margins = await page.locator("[data-highlight]").evaluate((root) => {
					const expected = parseFloat(getComputedStyle(root).getPropertyValue("--space-4"));
					return {
						expected,
						actual: ["flow", "controls", "memory-notice"].map((name) =>
							parseFloat(
								getComputedStyle(root.querySelector(`[data-highlight-${name}]`)!).marginBlockStart,
							),
						),
					};
				});
				expect(margins.actual).toEqual([margins.expected, margins.expected, margins.expected]);
				await expect(ui(page, "restart")).toBeFocused();
				await expect(ui(page, "status")).toHaveText("");
				await scan(page);
			});

test("held Enter on Check preserves the checked attempt after focus moves", async ({ page }) => {
	await page.goto(`${url}/key-en-light.html`);
	await chunk(page).nth(1).click();
	await ui(page, "check").focus();
	await page.keyboard.down("Enter");
	await page.keyboard.down("Enter");
	await page.keyboard.down("Enter");
	await page.keyboard.up("Enter");
	await expect(ui(page, "restart")).toBeFocused();
	await expect(ui(page, "summary")).toBeVisible();
	await expect(ui(page, "summary")).toHaveText("You found 1 of 2 key ideas.");
	await expect(ui(page, "check")).toBeHidden();
	await expect(chunk(page).nth(1)).toHaveAttribute("aria-pressed", "true");
	await expect(chunk(page).nth(1)).toHaveAttribute("aria-disabled", "true");
	await expect(ui(page, "status")).toHaveText("");
	await scan(page);
});

test("modified chunk keys preserve focus and selection", async ({ page }) => {
	await page.goto(`${url}/key-en-light.html`);
	await chunk(page).last().focus();
	await page.keyboard.press("Control+Home");
	await expect(chunk(page).last()).toBeFocused();
	const defaults = await chunk(page)
		.last()
		.evaluate((node) =>
			["altKey", "ctrlKey", "metaKey"].map((modifier) =>
				node.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "Enter",
						[modifier]: true,
						bubbles: true,
						cancelable: true,
					}),
				),
			),
		);
	expect(defaults).toEqual([true, true, true]);
	await expect(page.locator("[aria-pressed=true]")).toHaveCount(0);
	await expect(ui(page, "status")).toHaveText("");
	await scan(page);
});

test("stray memory notice refuses attach before mutating the baseline", async ({ page }) => {
	await page.goto(`${url}/baseline.html`);
	const error = await page.evaluate(() => {
		const root = document.querySelector<HTMLElement>("[data-highlight]")!;
		const stray = document.createElement("p");
		stray.setAttribute("data-highlight-memory-notice", "");
		stray.textContent = "Existing notice";
		root.append(stray);
		try {
			(
				window as unknown as { HighlightTest: { enhanceHighlight(root: HTMLElement): unknown } }
			).HighlightTest.enhanceHighlight(root);
			return "";
		} catch (error) {
			return (error as Error).message;
		}
	});
	expect(error).toBe("Invalid highlight passage markup");
	await expect(ui(page, "memory-notice")).toHaveCount(1);
	await expect(ui(page, "memory-notice")).toHaveText("Existing notice");
	await expect(ui(page, "flow")).toBeHidden();
	await expect(ui(page, "fallback")).toBeVisible();
	await expect(page.locator("[data-highlight-enhanced], [aria-pressed]")).toHaveCount(0);
	await scan(page);
});
