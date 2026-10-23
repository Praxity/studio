import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { type BrowserContext, expect, type Page, type Request, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { build } from "esbuild";
import { renderHighlight } from "../../src/patterns/highlight/render";
import { renderBlockHtml } from "../../src/render-block-html";
import type { CourseHostFormat } from "../../template/src/hosts/course-host";
import { highlightHarnessContent, writeHighlightHarness } from "./fixtures/highlight-harness";

let directory: string,
	url: string,
	server: ReturnType<typeof createServer>,
	context: BrowserContext,
	page: Page;
type Proof = {
	calls(): string[];
	snapshot(): { calls: string[]; data: string[][]; storage: (string | null)[][]; suspend: string };
	attach(): void;
	reset(): void;
	remount(): void;
	setPublic(): void;
	shutdown(): void;
};
async function proofCall(name: keyof Proof) {
	return page.evaluate((name) => (Reflect.get(window, "ReportProof") as Proof)[name](), name);
}

function assertNoHighlight(bytes: string) {
	for (const lang of ["en", "fr"] as const) {
		const content = highlightHarnessContent(lang, "key");
		for (const text of [
			content.title,
			content.question,
			...content.paragraphs.flat().flatMap((chunk) => [chunk.text, chunk.note]),
		])
			if (text) expect(bytes).not.toContain(text);
	}
	expect(bytes).not.toMatch(
		/HL-PRIVATE|data-highlight|They know when to expect you|Il dit|marked|shown/,
	);
}
test.beforeAll(async ({ browser }) => {
	directory = await mkdtemp(join(tmpdir(), "highlight-reporting-"));
	await writeHighlightHarness(directory);
	await build({
		entryPoints: [resolve(import.meta.dirname, "fixtures/highlight-reporting.ts")],
		bundle: true,
		format: "iife",
		outfile: join(directory, "reporting.js"),
		define: { "process.env.NODE_ENV": '"production"' },
	});
	const choice = readLesson(
		"# Reading\n::: choice Report an ordinary answer. {required=false}\n(x) Ordinary answer\n( ) Other answer\n:::\n",
	).blocks.find((block) => block.type === "assessment");
	if (!choice) throw new Error("Missing reporting control");
	choice.id = "public-choice";
	const markup =
		(["en", "fr"] as const)
			.map(
				(lang, i) =>
					`<section ${i ? "hidden" : ""} data-block-id="HL-PRIVATE-${i}">${renderHighlight({ ...highlightHarnessContent(lang, "key"), maxMarks: 2 }, { prefix: `HL-PRIVATE-${i}`, lang, headingLevel: 2 })}</section>`,
			)
			.join("") + renderBlockHtml(choice, { enabledIslands: new Set(["assessment"]) });
	const host = {
		version: 1,
		courseId: "reporting-proof",
		pageId: "reading",
		pageTitle: "Reading",
		currentPage: 1,
		totalPages: 2,
		currentSlug: "reading",
		availableSlugs: ["reading", "next"],
		pageIdMap: { reading: "reading", next: "next" },
		completionMethod: "allPages",
		pageRole: "content",
		strings: {},
		blockStatePolicy: {},
		deck: true,
		deferVisits: true,
	};
	await writeFile(
		join(directory, "index.html"),
		`<!doctype html><html class="praxity-js" data-praxity-islands="selfCheck"><head><meta charset="utf-8"><link rel="stylesheet" href="en-light.css"></head><body data-praxity-root><main class="praxity-page-content">${markup}</main><script id="praxity-host-config" type="application/json">${JSON.stringify(host)}</script><script id="praxity-config" type="application/json">{"sourceLocale":"en"}</script><script src="reporting.js"></script></body></html>`,
	);
	server = createServer(async (req, res) => {
		const file = resolve(directory, `.${new URL(req.url ?? "/", "http://localhost").pathname}`);
		if (!file.startsWith(directory + sep)) {
			res.writeHead(403).end();
			return;
		}
		try {
			res.setHeader(
				"Content-Type",
				file.endsWith(".js")
					? "text/javascript"
					: file.endsWith(".css")
						? "text/css"
						: "text/html; charset=utf-8",
			);
			res.end(await readFile(file));
		} catch {
			res.writeHead(404).end();
		}
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	context = await browser.newContext();
	page = await context.newPage();
	page.on("pageerror", (error) => {
		console.error(error.message);
	});
});
test.afterAll(async () => {
	await context?.close();
	if (server)
		await new Promise<void>((done, reject) => server.close((e) => (e ? reject(e) : done())));
	if (directory) await rm(directory, { recursive: true });
});
const highlightHostFormats = {
	scorm12: true,
	scorm2004: true,
	xapi: true,
	standalone: true,
	"electron-preview": true,
} satisfies Record<CourseHostFormat, true>;
// A future host, including cmi5, must add a privacy proof before this typecheck passes.
for (const format of Object.keys(highlightHostFormats) as CourseHostFormat[])
	for (const identified of [false, true]) {
		test.describe(`${format}, identified=${identified}`, () => {
			let sends: string[], requests: string[];
			const request = (request: Request) =>
				requests.push(JSON.stringify([request.method(), request.url(), request.postData()]));
			async function reportOrdinaryChoice() {
				const answered =
					format === "xapi" && identified
						? page.waitForResponse(
								(response) =>
									response.url() === "https://lrs.example/statements" &&
									(response.request().postData() ?? "").includes("/answered"),
							)
						: Promise.resolve(null);
				await page.getByRole("radio", { name: "Ordinary answer", exact: true }).check();
				await page
					.locator("#block-public-choice")
					.getByRole("button", { name: "Check", exact: true })
					.click();
				await answered;
				await proofCall("setPublic");
				return (await proofCall("snapshot")) as ReturnType<Proof["snapshot"]>;
			}

			test.beforeEach(async () => {
				if (page.url().startsWith(url))
					await page.evaluate(() => {
						localStorage.clear();
						sessionStorage.clear();
					});
				sends = [];
				requests = [];
				await page.route("https://lrs.example/**", async (route) => {
					sends.push(route.request().postData() ?? "");
					await route.fulfill({ status: 503, body: "offline" });
				});
				const initialized =
					format === "xapi" && identified
						? page.waitForResponse(
								(response) =>
									response.url() === "https://lrs.example/statements" &&
									(response.request().postData() ?? "").includes("/initialized"),
							)
						: Promise.resolve(null);
				await page.goto(`${url}/index.html?format=${format}&identified=${identified}`);
				await expect(page.locator("[data-hydrated]")).toHaveCount(1);
				await initialized;
				page.on("request", request);
			});
			test.afterEach(async () => {
				page.off("request", request);
				await page.unroute("https://lrs.example/**");
			});
			test("bilingual mounted practice emits no reports while choice and public variable write", async () => {
				const baseline = await proofCall("calls");
				await page.evaluate(() => {
					for (const root of document.querySelectorAll<HTMLElement>("[data-highlight]")) {
						const chunks = root.querySelectorAll<HTMLElement>("[data-highlight-chunk]");
						const button = (name: string) =>
							root.querySelector<HTMLButtonElement>(`[data-highlight-${name}]`)!;
						for (const selection of [[], [1], [1, 2], [0], [0, 1, 2]]) {
							selection.forEach((i) => chunks[i].click());
							button("check").click();
							button("restart").click();
						}
						chunks[1].click();
						button("check").click();
					}
				});
				await proofCall("attach");
				expect(await proofCall("calls")).toEqual(baseline);
				await expect(
					page.locator(
						"[data-highlight] [data-completed],[data-highlight] [data-attempted],[data-highlight][data-completed],[data-highlight][data-attempted]",
					),
				).toHaveCount(0);
				const before = await page
					.locator("[data-highlight]")
					.evaluateAll((roots) => roots.map((root) => root.outerHTML));
				await page.emulateMedia({ media: "print" });
				await page.emulateMedia({ media: "screen" });
				expect(await proofCall("calls")).toEqual(baseline);
				expect(
					await page
						.locator("[data-highlight]")
						.evaluateAll((roots) => roots.map((root) => root.outerHTML)),
				).toEqual(before);
				expect(requests).toEqual([]);
				const result = await reportOrdinaryChoice();
				expect(
					result.calls.some((call) => call.includes('"trackInteraction","public-choice"')),
				).toBe(true);
				expect(result.suspend).toContain('"publicFlag":true');
				const afterPositive = [...requests];
				await proofCall("reset");
				expect(
					await page
						.locator("[data-highlight]")
						.evaluateAll((roots) => roots.map((root) => root.outerHTML)),
				).toEqual(before);
				await proofCall("remount");
				await expect(page.locator('[data-highlight-chunk][aria-pressed="true"]')).toHaveCount(0);
				expect(requests).toEqual(afterPositive);
				await proofCall("shutdown");
				assertNoHighlight(
					JSON.stringify({ result, calls: await proofCall("calls"), sends, requests }),
				);
				if (format === "scorm12" || format === "scorm2004") {
					expect(result.data).toContainEqual(["cmi.interactions.0.id", "public-choice"]);
					expect(result.calls).toContain("LMS-commit");
				}
				if (format === "xapi" && identified) {
					expect(sends.some((send) => send.includes("/answered"))).toBe(true);
					expect(JSON.stringify(result.storage)).toContain("outbox");
					expect(JSON.stringify(result.storage)).toContain("/answered");
				}
			});
			test("reload and shutdown keep highlight data out while the ordinary choice survives replay", async () => {
				const calls = await page.evaluate(() => {
					const proof = Reflect.get(window, "ReportProof") as Proof;
					const before = proof.calls();
					for (const root of document.querySelectorAll<HTMLElement>("[data-highlight]")) {
						root.querySelector<HTMLElement>("[data-highlight-chunk]")!.click();
						root.querySelector<HTMLButtonElement>("[data-highlight-check]")!.click();
					}
					return { before, after: proof.calls() };
				});
				expect(calls.after).toEqual(calls.before);
				expect(requests).toEqual([]);
				const result = await reportOrdinaryChoice();
				await proofCall("shutdown");
				assertNoHighlight(
					JSON.stringify({ result, calls: await proofCall("calls"), sends, requests }),
				);
				const replayed =
					format === "xapi" && identified
						? page.waitForResponse(
								(response) =>
									response.url() === "https://lrs.example/statements" &&
									(response.request().postData() ?? "").includes("/answered"),
							)
						: Promise.resolve(null);
				await page.reload();
				await replayed;
				if (format === "xapi" && identified) {
					expect(sends.filter((send) => send.includes("/answered")).length).toBeGreaterThanOrEqual(
						2,
					);
				}
				await expect(page.locator('[data-highlight-chunk][aria-pressed="true"]')).toHaveCount(0);
				const reloaded = await proofCall("snapshot");
				await proofCall("shutdown");
				assertNoHighlight(
					JSON.stringify({
						result: reloaded,
						calls: await proofCall("calls"),
						sends,
						requests,
					}),
				);
			});
		});
	}
