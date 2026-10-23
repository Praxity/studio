import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";
import type { SCORMRuntime } from "../../src/scorm/types";
import { highlightSource } from "../fixtures/highlight-source";
import { highlightHarnessContent } from "./fixtures/highlight-harness";
import { highlightPublisher } from "./fixtures/highlight-published";

const formats = ["html", "scorm-1.2", "scorm-2004", "xapi"] as const;
const files = new Map<string, Buffer>(),
	entries = new Map<string, string>();
let publish: Awaited<ReturnType<typeof highlightPublisher>>;
let directory: string, base: string, server: ReturnType<typeof createServer>;
const evidence = process.env.PRAXITY_HIGHLIGHT_EVIDENCE_DIR;
function lesson(lang: "en" | "fr", deck: boolean) {
	const c = highlightHarnessContent(lang, "key");
	const activity = (name: string) => highlightSource(c, { name });
	return `---\nlang: ${lang}\n${deck ? "" : "variables:\n  publicFlag: false\n"}---\n# ${lang}\n${activity("markOne")}::: accordion\n:: Other practice\n${activity("markTwo")}:::\n::: choice Ordinary control {name=ordinary required=false deckGate=attempt}\n(x) Ordinary answer\n( ) Other answer\n:::\n${deck ? "" : "::: rule\nif: @ordinary.isAttempted is true\nthen: set publicFlag = true\n:::\n"}# Next ${lang}\nOrdinary next page.\n`;
}
test.beforeAll(async () => {
	directory = await mkdtemp(
		join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "highlight-published-"),
	);
	publish = await highlightPublisher(directory);
	const variable = await build({
		stdin: {
			contents: `import {VariableStore} from '@praxity/shared-blocks/logic'; export function setPublic(){new VariableStore([{name:'publicFlag',dataType:'boolean',defaultValue:false}],window.__praxityRuntime).set('publicFlag',true);}`,
			resolveDir: import.meta.dirname,
			loader: "ts",
		},
		bundle: true,
		write: false,
		format: "iife",
		globalName: "PublishedVariable",
	});
	files.set("/public-variable.js", Buffer.from(variable.outputFiles[0].contents));
});
// Put the locale under test first. Fresh deck launches must honor earlier
// ordinary gates; this exercises each locale without bypassing those gates.
for (const deck of [false, true])
	for (const lang of ["en", "fr"] as const)
		test.beforeAll(async () => {
			const other = lang === "en" ? "fr" : "en";
			const packages = await publish(
				`course-${deck}-${lang}`,
				{ [`${lang}.prax`]: lesson(lang, deck), [`${other}.prax`]: lesson(other, deck) },
				formats,
				deck,
			);
			for (const [format, zip] of packages) {
				if (evidence)
					await writeFile(
						join(evidence, `published-${format}-${deck}-${lang}.zip`),
						zip.toBuffer(),
					);
				const prefix = `/${format}-${deck}-${lang}/`;
				for (const e of zip.getEntries())
					if (!e.isDirectory) files.set(prefix + e.entryName, zip.readFile(e)!);
				const entry = zip
					.getEntries()
					.find(
						(e) =>
							e.entryName.endsWith(".html") &&
							zip.readAsText(e).includes(`<html lang="${lang}"`) &&
							zip.readAsText(e).includes("data-highlight-fallback"),
					);
				if (!entry) throw new Error(`Missing ${format} ${deck} ${lang}`);
				entries.set(`${format}-${deck}-${lang}`, prefix + entry.entryName);
			}
		});

test.beforeAll(async () => {
	server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(path);
		res.writeHead(bytes ? 200 : 404, {
			"Content-Type": path.endsWith(".js")
				? "text/javascript"
				: path.endsWith(".css")
					? "text/css"
					: path.endsWith(".woff2")
						? "font/woff2"
						: "text/html; charset=utf-8",
		});
		res.end(bytes);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing address");
	base = `http://127.0.0.1:${address.port}`;
});
test.afterEach(async ({ page }, info) => {
	if (info.status !== info.expectedStatus)
		await info.attach("published-document", {
			body: await page.content(),
			contentType: "text/html",
		});
});
test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
	if (directory) await rm(directory, { recursive: true });
});

type Probe = {
	writes: unknown[];
	lms: unknown[];
	responses: unknown[];
	calls: unknown[];
	values: Record<string, string>;
};
async function instrument(page: Page, format: string) {
	await page.addInitScript(
		({ format }) => {
			const probe: Probe = {
				writes: [],
				lms: [],
				responses: [],
				calls: [],
				values: { "cmi.interactions._count": "0", "cmi.objectives._count": "0" },
			};
			Reflect.set(window, "highlightProbe", probe);
			for (const method of ["setItem", "removeItem", "clear"] as const) {
				const original = Storage.prototype[method];
				Reflect.set(Storage.prototype, method, function (this: Storage, ...args: unknown[]) {
					probe.writes.push([this === localStorage ? "local" : "session", method, ...args]);
					return Reflect.apply(original, this, args);
				});
			}
			for (const method of ["put", "add", "delete", "clear"] as const) {
				const original = IDBObjectStore.prototype[method];
				Reflect.set(
					IDBObjectStore.prototype,
					method,
					function (this: IDBObjectStore, ...args: unknown[]) {
						probe.writes.push(["indexedDB", method, ...args]);
						return Reflect.apply(original, this, args);
					},
				);
			}
			const api: Record<string, (...args: string[]) => string> = {};
			for (const method of [
				"Initialize",
				"Finish",
				"Terminate",
				"Commit",
				"GetValue",
				"SetValue",
				"GetLastError",
				"GetErrorString",
				"GetDiagnostic",
			])
				api[method] = (...args) => {
					if (method === "SetValue") {
						probe.values[args[0]] = args[1];
						probe.lms.push([method, ...args]);
					}
					if (method === "Commit") probe.lms.push([method]);
					return method === "GetValue"
						? (probe.values[args[0]] ?? "")
						: method === "GetLastError"
							? "0"
							: "true";
				};
			if (format === "scorm-1.2")
				Reflect.set(
					window,
					"API",
					Object.fromEntries(Object.entries(api).map(([k, v]) => ["LMS" + k, v])),
				);
			if (format === "scorm-2004") Reflect.set(window, "API_1484_11", api);
			document.addEventListener("praxity:assessment-response", (e) =>
				probe.responses.push((e as CustomEvent).detail),
			);
		},
		{ format },
	);
}
async function snapshot(page: Page) {
	return page.evaluate(() => {
		const runtime = window.__praxityRuntime as SCORMRuntime | undefined;
		return {
			...(Reflect.get(window, "highlightProbe") as Probe),
			suspend: runtime?.getSuspendData(),
			interactions: runtime?.getInteractions() ?? [],
			storage: [localStorage, sessionStorage].flatMap((store) =>
				Array.from({ length: store.length }, (_, i) => [
					store.key(i),
					store.getItem(store.key(i)!),
				]),
			),
		};
	});
}

async function spyRuntime(page: Page) {
	await page.evaluate(() => {
		const probe = Reflect.get(window, "highlightProbe") as Probe;
		const runtime = window.__praxityRuntime as SCORMRuntime;
		if (!runtime) throw new Error("Missing real published host");
		for (const name of [
			"setBlockState",
			"setSuspendData",
			"trackInteraction",
			"trackObjective",
			"setCompletion",
			"commit",
		] as const) {
			const method = runtime[name];
			if (method)
				Reflect.set(runtime, name, (...args: unknown[]) => {
					probe.calls.push([name, ...args]);
					return Reflect.apply(method, runtime, args);
				});
		}
		const provider = window.__praxityBlockState!;
		for (const name of ["get", "set"] as const) {
			const method = provider[name];
			Reflect.set(provider, name, (...args: unknown[]) => {
				probe.calls.push(["provider", name, ...args]);
				return Reflect.apply(method, provider, args);
			});
		}
	});
}
async function reportOrdinaryAnswer(page: Page) {
	await page.getByRole("radio", { name: "Ordinary answer", exact: true }).check();
	await page.locator("[data-assessment-submit]").click();
	// The real choice reports after its asynchronous save, especially in Firefox.
	await expect
		.poll(() =>
			page.evaluate(() => (Reflect.get(window, "highlightProbe") as Probe).responses.length),
		)
		.toBe(1);
}

function noHighlight(bytes: string, ids: string[]) {
	for (const marker of [
		...ids,
		"markOne",
		"markTwo",
		"data-highlight",
		'"marked"',
		'"shown"',
		...(["en", "fr"] as const).flatMap((lang) => {
			const c = highlightHarnessContent(lang, "key");
			return [c.title, c.question!, ...c.paragraphs.flat().flatMap((c) => [c.text, c.note ?? ""])];
		}),
	].filter(Boolean))
		expect(bytes).not.toContain(marker);
}
for (const format of formats)
	for (const deck of [false, true])
		for (const lang of ["en", "fr"] as const) {
			test(`${format} deck=${deck} ${lang}: published activity has no writes and ordinary choice reports`, async ({
				page,
			}) => {
				if (format === "html" && !deck && lang === "en")
					await page.setViewportSize({ width: 320, height: 900 });
				await instrument(page, format);
				const requests: unknown[] = [];
				await page.route("https://lrs.example/**", async (route) => {
					requests.push([route.request().url(), route.request().postData()]);
					await route.fulfill({ status: 503, body: "offline" });
				});
				const actor =
					format === "xapi"
						? `?actor=${encodeURIComponent(JSON.stringify({ name: "Learner", mbox: "mailto:learner@example.com" }))}`
						: "";
				await page.goto(base + entries.get(`${format}-${deck}-${lang}`) + actor);
				await expect(page.locator("[data-highlight-enhanced]")).toHaveCount(2);
				if (deck) await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				await expect(page.locator("[data-highlight-check]").first()).toBeVisible();
				await page.locator("[data-block-type=assessment]").scrollIntoViewIfNeeded();
				await expect(
					page.getByRole("radio", { name: "Ordinary answer", exact: true }),
				).toBeEnabled();
				const ids = await page
					.locator("[data-highlight]")
					.evaluateAll((roots) =>
						roots.map((r) => r.closest("[data-block-id]")!.getAttribute("data-block-id")!),
					);
				await spyRuntime(page);
				const before = await snapshot(page);
				const outgoing = requests.length;
				const network: unknown[] = [];
				page.on("request", (r) => network.push([r.method(), r.url(), r.postData()]));
				const slide = deck
					? await page.locator("[data-deck-slide]:visible").getAttribute("id")
					: null;
				await page.evaluate(() => {
					for (const root of document.querySelectorAll("[data-highlight]")) {
						const chunks = root.querySelectorAll<HTMLElement>("[data-highlight-chunk]");
						const check = root.querySelector<HTMLButtonElement>("[data-highlight-check]")!;
						const reset = root.querySelector<HTMLButtonElement>("[data-highlight-restart]")!;
						for (const indices of [[], [1], [1, 2], [0], [0, 1, 2]]) {
							indices.forEach((i) => chunks[i].click());
							check.click();
							reset.click();
						}
						chunks[1].click();
						check.click();
					}
				});
				await page.emulateMedia({ media: "print" });
				await expect(page.locator("[data-highlight-print-answer]:visible")).toHaveCount(2);
				for (const answer of await page.locator("[data-highlight-print-answer]").all()) {
					for (const chunk of highlightHarnessContent(lang, "key").paragraphs.flat())
						if (chunk.key || chunk.note) {
							await expect(answer).toContainText(chunk.text);
							if (chunk.note) await expect(answer).toContainText(chunk.note);
						}
				}
				await expect(
					page.locator("[data-highlight-memory-notice]:visible,[data-highlight-flow]:visible"),
				).toHaveCount(0);
				await page.emulateMedia({ media: "screen" });
				expect(await snapshot(page)).toEqual(before);
				expect(requests).toHaveLength(outgoing);
				expect(network).toEqual([]);
				if (evidence && format === "html" && !deck && lang === "en")
					await page.screenshot({
						path: join(evidence, "published-html-checked-en-light-320.png"),
						fullPage: true,
					});
				if (deck) {
					await page.locator("#deck-next").click();
					await expect(page.locator("[data-deck-slide]:visible")).toHaveAttribute("id", slide!);
				}
				await expect(
					page.locator(
						"[data-highlight][data-completed],[data-highlight][data-attempted],[data-highlight] [data-completed],[data-highlight] [data-attempted]",
					),
				).toHaveCount(0);
				await reportOrdinaryAnswer(page);
				// Module decks refuse authored variables/logic. Their separate API control
				// remains explicit; ordinary pages use only the authored rule above.
				if (deck) {
					await page.addScriptTag({ url: base + "/public-variable.js" });
					await page.evaluate(() =>
						(Reflect.get(window, "PublishedVariable") as { setPublic(): void }).setPublic(),
					);
				}
				await expect
					.poll(() =>
						page.evaluate(() => (window.__praxityRuntime as SCORMRuntime).getSuspendData()),
					)
					.toContain('"publicFlag":true');
				const positive = await snapshot(page);
				expect(JSON.stringify(positive)).toContain("publicFlag");
				expect(positive.responses).toHaveLength(1);
				expect(positive.calls.some((c) => JSON.stringify(c).includes("trackInteraction"))).toBe(
					true,
				);
				if (deck) {
					await page.locator("#deck-next").click();
					await expect(page.locator("[data-deck-slide]:visible")).not.toHaveAttribute("id", slide!);
				}
				await page.evaluate(() =>
					window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
				);
				const after = await snapshot(page);
				noHighlight(JSON.stringify({ after, requests, network }), ids);
				if (format.startsWith("scorm"))
					expect(JSON.stringify(after.lms)).toContain("cmi.interactions.0.id");
				if (format === "xapi") {
					expect(JSON.stringify(requests)).toContain("/answered");
					expect(JSON.stringify(after.storage)).toContain("outbox");
				}
				if (evidence)
					await writeFile(
						join(evidence, `published-${format}-${deck}-${lang}.json`),
						JSON.stringify({ before, after, requests, network }, null, 2),
					);
			});
			test(`${format} deck=${deck} ${lang}: published reload and shutdown keep marks unsaved`, async ({
				page,
			}) => {
				await instrument(page, format);
				const requests: unknown[] = [];
				await page.route("https://lrs.example/**", async (route) => {
					requests.push([route.request().url(), route.request().postData()]);
					await route.fulfill({ status: 503, body: "offline" });
				});
				await page.goto(
					base +
						entries.get(`${format}-${deck}-${lang}`) +
						(format === "xapi"
							? `?actor=${encodeURIComponent(JSON.stringify({ mbox: "mailto:learner@example.com" }))}`
							: ""),
				);
				await expect(page.locator("[data-highlight-enhanced]")).toHaveCount(2);
				if (deck) await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				await expect(page.locator("[data-highlight-check]").first()).toBeVisible();
				const ids = await page
					.locator("[data-highlight]")
					.evaluateAll((roots) =>
						roots.map((r) => r.closest("[data-block-id]")!.getAttribute("data-block-id")!),
					);
				await page.locator("[data-highlight-chunk]").first().click();
				await page.locator("[data-highlight-check]").first().click();
				await reportOrdinaryAnswer(page);
				await page.evaluate(() =>
					window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
				);
				noHighlight(JSON.stringify({ state: await snapshot(page), requests }), ids);
				await page.reload();
				await expect(page.locator("[data-highlight-enhanced]")).toHaveCount(2);
				if (deck) await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				await expect(page.locator('[data-highlight-chunk][aria-pressed="true"]')).toHaveCount(0);
				await page.evaluate(() =>
					window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
				);
				noHighlight(JSON.stringify({ state: await snapshot(page), requests }), ids);
			});
		}
