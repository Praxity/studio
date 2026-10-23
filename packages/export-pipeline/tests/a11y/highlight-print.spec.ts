import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";
import { highlightSource } from "../fixtures/highlight-source";
import { highlightHarnessContent } from "./fixtures/highlight-harness";
import { highlightPublisher } from "./fixtures/highlight-published";

let publish: Awaited<ReturnType<typeof highlightPublisher>>;
let directory: string,
	url: string,
	server: ReturnType<typeof createServer>,
	context: BrowserContext,
	page: Page;
const evidence = process.env.PRAXITY_HIGHLIGHT_EVIDENCE_DIR;
const placements = [
	"top",
	"accordion",
	"tabs",
	"sequence",
	"columns",
	"front",
	"back",
	"deck",
] as const;
type Placement = (typeof placements)[number];
const root = () => page.locator("[data-highlight]");
const entries = new Map<string, string>();

function source(placement: Placement, lang: "en" | "fr", long: boolean) {
	const content = highlightHarnessContent(lang, "key");
	if (long)
		content.paragraphs = Array.from({ length: 10 }, (_, i) => [
			{
				id: `p${i}`,
				text:
					`Passage ${i + 1}. ` +
					(lang === "en"
						? "He said: “Return at noon!” Read &amp; < carefully. "
						: "Il dit : « Je reviens à midi ! » Lisez &amp; < attentivement. "
					)
						.repeat(8)
						.trimEnd(),
				key: i % 2 === 0,
				note:
					`NOTE ${i + 1}. ` +
					(lang === "en"
						? "Keep the complete explanation in passage order, including punctuation: yes, always! "
						: "Conservez toute l'explication dans l'ordre du texte, avec la ponctuation : oui, toujours ! "
					).repeat(12) +
					` ENDNOTE${i + 1}.`,
			},
		]);
	const activity = highlightSource(content);
	switch (placement) {
		case "accordion":
		case "sequence":
			return `::: ${placement}\n:: Reading\n${activity}:: Other\nOther content.\n:::\n`;
		case "tabs":
			return `::: tabs\n:: Other\nOther content.\n:: Reading\n${activity}:::\n`;
		case "columns":
			return `::: columns\n:: Reading\n${activity}:: Other\nOther content.\n:::\n`;
		case "front":
			return `::: cards\n:: Reading\n${activity}::: back\nOther content.\n:::\n:::\n`;
		case "back":
			return `::: cards\n:: Reading\nOther content.\n::: back\n${activity}:::\n:::\n`;
		default:
			return activity;
	}
}

test.beforeAll(async () => {
	directory = await mkdtemp(
		join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "highlight-proof-"),
	);
	publish = await highlightPublisher(directory);
	await build({
		stdin: {
			contents: `export {preservePrintFocus} from '@praxity/shared-blocks/viewer/print-focus-return';`,
			resolveDir: resolve(import.meta.dirname, "../.."),
			loader: "ts",
		},
		bundle: true,
		format: "iife",
		globalName: "HighlightProof",
		outfile: join(directory, "proof.js"),
	});
});
for (const lang of ["en", "fr"] as const)
	test.beforeAll(async () => {
		for (const long of [false, true]) {
			for (const deck of [false, true]) {
				const selected = deck ? (["deck"] as const) : placements.filter((p) => p !== "deck");
				const lesson =
					`---\nlang: ${lang}\n---\n` +
					(deck ? "# First\nOther content.\n" : "") +
					selected.map((p) => `# ${p}\n${source(p, lang, long)}`).join("\n");
				const packages = await publish(`${lang}-${long}-${deck}`, lesson, ["html"], deck);
				const zip = packages.get("html")!;
				const target = join(directory, `${lang}-${long}-${deck}-output`);
				zip.extractAllTo(target);
				for (const placement of selected) {
					const entry = zip
						.getEntries()
						.find(
							(e) =>
								e.entryName.endsWith(".html") &&
								zip.readAsText(e).includes("data-highlight") &&
								(deck || e.entryName === `${placement}.html`),
						);
					if (!entry) throw new Error(`Missing real published ${placement} ${lang} ${long}`);
					entries.set(
						`${placement}-${lang}-${long}`,
						`${lang}-${long}-${deck}-output/${entry.entryName}`,
					);
				}
			}
		}
	});
test.beforeAll(async ({ browser }) => {
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
	context = await browser.newContext();
	page = await context.newPage();
	await page.goto(`${url}/${entries.get("top-en-false")}`);
	await page.evaluate(() => document.fonts.ready);
	if (evidence) await mkdir(evidence, { recursive: true });
	await test
		.info()
		.attach("browser-version", { body: browser.version(), contentType: "text/plain" });
});
test.afterAll(async () => {
	await context?.close();
	if (server)
		await new Promise<void>((done, reject) => server.close((e) => (e ? reject(e) : done())));
	if (directory) await rm(directory, { recursive: true });
});
async function open(placement: Placement, lang = "en", long = false) {
	await page.emulateMedia({ media: "screen" });
	await page.goto(`${url}/${entries.get(`${placement}-${lang}-${long}`)}`);
	if (placement === "tabs") await page.getByRole("tab", { name: "Reading", exact: true }).click();
	if (placement === "deck") await page.locator("#deck-next").click();
	if (placement === "back") await page.locator("[data-card-flip]").click();
	await expect(root()).toHaveAttribute("data-highlight-enhanced", "");
	if (placement === "tabs") await page.getByRole("tab", { name: "Other", exact: true }).click();
	if (placement === "deck") await page.locator("#deck-previous").click();
	if (placement === "back") await page.locator("[data-card-flip]").click();
	// Inactive-container checks start without focus in the external reveal control.
	// The top-level checked case below verifies highlight's own Start over focus.
	if (["tabs", "deck", "back"].includes(placement))
		await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}
async function setPrintMedia(mode: "screen" | "print") {
	const expected = mode === "print";
	const entry = await page.evaluateHandle(
		(expected) => ({
			ready: new Promise<boolean>((done) => {
				const media = matchMedia("print");
				if (media.matches === expected) done(expected);
				else media.addEventListener("change", (event) => done(event.matches), { once: true });
			}),
		}),
		expected,
	);
	await page.emulateMedia({ media: mode });
	expect(await entry.evaluate(({ ready }) => ready)).toBe(expected);
	await entry.dispose();
}

async function screen() {
	return root().evaluate((node) => ({
		html: node.outerHTML,
		// BODY HTML includes unrelated deck resize bookkeeping after print.
		focus: document.activeElement === document.body ? "BODY" : document.activeElement?.outerHTML,
		containers: [
			...document.querySelectorAll("[hidden],[open],[aria-expanded],[data-flipped]"),
		].map((el) => [
			el.id,
			el.getAttribute("hidden"),
			el.getAttribute("open"),
			el.getAttribute("aria-expanded"),
			el.getAttribute("data-flipped"),
		]),
	}));
}
for (const placement of placements)
	for (const lang of ["en", "fr"] as const) {
		test(`${placement} ${lang}: ordinary print includes complete authored Answer and preserves cancel state`, async ({
			browserName,
		}) => {
			await open(placement, lang);
			// Exercise hidden activities without opening their containers, as print must do.
			await root().evaluate((node) => {
				node.querySelectorAll<HTMLElement>("[data-highlight-chunk]")[0].click();
				node.querySelector<HTMLButtonElement>("[data-highlight-check]")!.click();
			});
			const before = await screen();
			if (process.env.PRAXITY_HIGHLIGHT_TRACE_FOCUS)
				await page.evaluate(() => {
					const trace: unknown[] = [];
					Reflect.set(window, "printFocusTrace", trace);
					const record = (type: string, target?: EventTarget | null) =>
						trace.push({
							type,
							target: target instanceof Element ? target.outerHTML.slice(0, 180) : String(target),
							active: document.activeElement?.tagName,
							activeName: document.activeElement?.getAttribute("data-highlight-restart"),
							print: matchMedia("print").matches,
							time: performance.now(),
						});
					document.addEventListener("focusin", (e) => record("focusin", e.target));
					document.addEventListener("focusout", (e) => record("focusout", e.target));
					matchMedia("print").addEventListener("change", (e) => record(`media:${e.matches}`));
					const original = HTMLElement.prototype.focus;
					HTMLElement.prototype.focus = function (...args) {
						record("focus-call", this);
						original.apply(this, args);
						record("focus-return", this);
					};
				});

			const requests: string[] = [];
			page.on("request", (request) => requests.push(request.url()));
			await page.evaluate(() => {
				const calls: string[] = [];
				Reflect.set(window, "printCalls", calls);
				for (const name of ["getItem", "setItem", "removeItem", "clear"] as const) {
					const original = Storage.prototype[name];
					Storage.prototype[name] = function (...args: unknown[]) {
						calls.push(name);
						return Reflect.apply(original, this, args);
					};
				}
				window.addEventListener("beforeprint", () => calls.push("beforeprint"));
				document.addEventListener("praxity:assessment-response", () => calls.push("response"));
			});
			await setPrintMedia("print");
			const answer = root().locator("[data-highlight-print-answer]");
			await expect(answer).toBeVisible();
			await expect(root().locator("[data-highlight-fallback]")).toBeHidden();
			await expect(
				root()
					.locator(
						"[data-highlight-flow],[data-highlight-memory-notice],[data-highlight-instructions],[data-highlight-status],[data-highlight-feedback]",
					)
					.filter({ visible: true }),
			).toHaveCount(0);
			const content = highlightHarnessContent(lang, "key");
			await expect(answer.locator("li")).toHaveCount(
				content.paragraphs.flat().filter((c) => c.key || c.note).length,
			);
			for (const chunk of content.paragraphs.flat()) {
				await expect(root().locator("[data-highlight-passage]")).toContainText(chunk.text);
				if (chunk.key || chunk.note) {
					await expect(answer).toContainText(chunk.text);
					if (chunk.note) await expect(answer).toContainText(chunk.note);
				}
			}
			const geometry = await root().evaluate((node) => {
				const elements = [
					node,
					...node.querySelectorAll<HTMLElement>(
						"[data-highlight-passage],[data-highlight-print-answer],[data-highlight-print-answer] li",
					),
				];
				return elements.map((el) => ({
					tag: el.tagName,
					width: el.getBoundingClientRect().width,
					client: el.clientWidth,
					scroll: el.scrollWidth,
					overflow: el.scrollWidth > el.clientWidth + 1,
				}));
			});
			expect(geometry.filter((g) => g.width <= 0 || g.overflow)).toEqual([]);
			await expect(root().locator("[data-highlight-chunk]").first()).toHaveCSS(
				"background-color",
				"rgba(0, 0, 0, 0)",
			);
			await expect(root().locator("[data-highlight-chunk]").first()).toHaveCSS(
				"border-width",
				"0px",
			);
			await expect(root().locator("[data-highlight-chunk]").first()).toHaveCSS(
				"text-decoration-line",
				"none",
			);
			if (
				evidence &&
				browserName === "chromium" &&
				lang === "en" &&
				(placement === "accordion" || placement === "back")
			)
				await page.screenshot({
					path: join(evidence, `print-${placement}-en.png`),
					fullPage: true,
				});
			await setPrintMedia("screen");
			if (process.env.PRAXITY_HIGHLIGHT_TRACE_FOCUS)
				await test.info().attach("focus-trace", {
					body: JSON.stringify(
						await page.evaluate(() => Reflect.get(window, "printFocusTrace")),
						null,
						2,
					),
					contentType: "application/json",
				});
			expect(await screen()).toEqual(before);
			if (placement === "top")
				await expect(root().locator("[data-highlight-restart]")).toBeVisible();
			expect(requests).toEqual([]);
			expect(await page.evaluate(() => Reflect.get(window, "printCalls"))).toEqual([]);
			if (evidence && browserName === "chromium" && placement === "top" && lang === "en")
				await page.screenshot({
					path: join(evidence, "screen-after-print-cancel-en.png"),
					fullPage: true,
				});
			page.removeAllListeners("request");
		});
	}
test("failed print-focus attachment and cleanup leave no later focus return", async () => {
	await open("top");
	await page.addScriptTag({ url: `${url}/proof.js` });
	const state = await page.evaluate(() => {
		const owner = Reflect.get(window, "HighlightProof") as {
			preservePrintFocus(root: HTMLElement): () => void;
		};
		const root = document.createElement("div"),
			button = document.createElement("button");
		root.append(button);
		document.body.append(root);
		const original = document.addEventListener;
		Reflect.set(document, "addEventListener", (type: string, ...args: unknown[]) => {
			if (type === "focusin") throw new Error("print registration");
			return Reflect.apply(original, document, [type, ...args]);
		});
		let failure = "";
		try {
			owner.preservePrintFocus(root);
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			Reflect.set(document, "addEventListener", original);
		}
		button.focus();
		window.dispatchEvent(new Event("beforeprint"));
		button.blur();
		window.dispatchEvent(new Event("afterprint"));
		const afterFailure = document.activeElement === document.body;
		const cleanup = owner.preservePrintFocus(root);
		button.focus();
		window.dispatchEvent(new Event("beforeprint"));
		cleanup();
		button.blur();
		window.dispatchEvent(new Event("afterprint"));
		const afterCleanup = document.activeElement === document.body;
		root.remove();
		return { failure, afterFailure, afterCleanup };
	});
	expect(state).toEqual({ failure: "print registration", afterFailure: true, afterCleanup: true });
});

for (const placement of placements)
	for (const lang of ["en", "fr"] as const)
		for (const format of ["A4", "Letter"] as const) {
			test(`${placement} ${lang} ${format}: long passage and notes survive PDF pagination in reading order`, async ({
				browserName,
			}) => {
				test.skip(
					browserName !== "chromium",
					"Save as PDF is provided by Chromium; print traversal runs in every engine.",
				);
				await open(placement, lang, true);
				await setPrintMedia("print");
				const file = join(directory, `${placement}-${lang}-${format}.pdf`);
				await page.pdf({
					path: file,
					format,
					printBackground: true,
					margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
				});
				const text = execFileSync(process.env.PRAXITY_PDFTOTEXT ?? "pdftotext", [file, "-"], {
					encoding: "utf8",
				});
				const normalized = text.replace(/\s+/gu, " ");
				expect(normalized).toContain(lang === "en" ? "A useful pause" : "Une pause utile");
				expect(normalized).toContain(
					lang === "en"
						? "He said: “Return at noon!” Read &amp; < carefully."
						: "Il dit : « Je reviens à midi ! » Lisez &amp; < attentivement.",
				);
				// PDF extractors may omit a space at a line boundary. Count every authored
				// non-whitespace character, including all repeated punctuation, on both projections.
				const compact = normalized.replace(/\s/gu, "");
				const answerStart = compact.indexOf(lang === "en" ? "Answer" : "Réponse");
				const passagePhrase = (
					lang === "en"
						? "He said: “Return at noon!” Read &amp; < carefully."
						: "Il dit : « Je reviens à midi ! » Lisez &amp; < attentivement."
				).replace(/\s/gu, "");
				const notePhrase = (
					lang === "en"
						? "Keep the complete explanation in passage order, including punctuation: yes, always!"
						: "Conservez toute l'explication dans l'ordre du texte, avec la ponctuation : oui, toujours !"
				).replace(/\s/gu, "");
				expect(compact.slice(0, answerStart).split(passagePhrase).length - 1).toBe(80);
				expect(compact.slice(answerStart).split(passagePhrase).length - 1).toBe(80);
				expect(compact.slice(answerStart).split(notePhrase).length - 1).toBe(120);
				let passagePosition = -1;
				for (let i = 1; i <= 10; i++) {
					const next = normalized.indexOf(`Passage ${i}.`, passagePosition + 1);
					expect(next).toBeGreaterThan(passagePosition);
					expect(next).toBeLessThan(normalized.indexOf(lang === "en" ? "Answer" : "Réponse"));
					passagePosition = next;
				}
				let previous = normalized.indexOf(lang === "en" ? "Answer" : "Réponse");
				expect(previous).toBeGreaterThan(0);
				for (let i = 1; i <= 10; i++) {
					const next = normalized.indexOf(`NOTE ${i}.`, previous);
					expect(next).toBeGreaterThan(previous);
					previous = normalized.indexOf(`ENDNOTE${i}.`, next);
					expect(previous).toBeGreaterThan(next);
				}
				expect(normalized).not.toMatch(
					/Your marks reset|Vos marques sont effacées|Start over|Recommencer/,
				);
				if (evidence) {
					await writeFile(
						join(evidence, `${placement}-${lang}-${format}-long.pdf`),
						await readFile(file),
					);
					await writeFile(join(evidence, `${placement}-${lang}-${format}-long.txt`), text);
				}
			});
		}
