import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { extractNarrationSegments } from "@praxity/shared-blocks/narration";
import AdmZip from "adm-zip";
import { build } from "esbuild";
import { resolveLessonSources } from "../../../../apps/desktop/src/main/lesson-source";
import { persistFixtureIdentity } from "../../../../apps/desktop/src/test-utils/identity-fixture";
import { compileCourse, deployCourse } from "../../src/build";
import { bundleViewer, computeViewerSourceHash } from "../../src/bundle-viewer";
import { prepareDesktopExportInputs } from "../../src/export-assets";
import { readCachedViewer, VIEWER_CACHE_DIR } from "../../src/viewer-cache";

const checkout = fileURLToPath(new URL("../../../../", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/retrieval-sheet-acceptance/", import.meta.url));
const evidence = process.env.PRAXITY_RETRIEVAL_EVIDENCE;
const deniedCaptures = process.env.PRAXITY_RETRIEVAL_DENIED_CAPTURES;
const formats = evidence ? ["html", "scorm12", "scorm2004", "xapi"] : ["html", "scorm12"];
const files = new Map<string, Buffer>();
const entries = new Map<string, string>();
const scripts: Record<string, string[]> = {};
let sheetIds: string[];
let hostCourseId: string;
let pageIds: string[];
let root: string, base: string, server: Server;
const xapiConfig = {
	endpoint: "https://lrs.example/xapi/statements",
	auth: "Basic acceptance-stub",
	actorMode: "lms" as const,
};
test.skip(
	({ browserName }) => browserName !== "chromium",
	"Built CLI acceptance runs in Chromium; focused retrieval suites cover other engines.",
);

// Build the real command once and each export once, outside test timing.
test.beforeAll(async () => {
	const setupStarted = Date.now();
	root =
		process.env.PRAXITY_RETRIEVAL_BUILD ?? (await mkdtemp(join(tmpdir(), "retrieval-acceptance-")));
	await mkdir(root, { recursive: true });
	if (evidence) await mkdir(evidence, { recursive: true });
	const assets = join(root, "assets");
	const sourceHash = await computeViewerSourceHash();
	const cached = await readCachedViewer(VIEWER_CACHE_DIR, sourceHash);
	if (cached) await cp(cached.directory, assets, { recursive: true });
	else await bundleViewer(assets);
	await prepareDesktopExportInputs(assets);
	const { version } = JSON.parse(
		await readFile(join(checkout, "apps/desktop/package.json"), "utf8"),
	);
	await writeFile(
		join(assets, "viewer.version.json"),
		JSON.stringify({
			appVersion: version,
			viewerSourceHash: (await computeViewerSourceHash()).slice(0, 12),
		}),
	);
	const runtimeRequire = createRequire(join(checkout, "packages/shared-blocks/package.json"));
	await build({
		stdin: {
			resolveDir: checkout,
			contents: `import { runPraxityCli } from './apps/desktop/src/main/cli';
const result = await runPraxityCli(process.argv.slice(2), {
 appVersion: ${JSON.stringify(version)}, exportAssetsDir: ${JSON.stringify(assets)},
});
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.exitCode;`,
		},
		outfile: join(root, "cli.mjs"),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: `import { createRequire as createBundleRequire } from 'node:module'; const require = createBundleRequire(${JSON.stringify(pathToFileURL(join(checkout, "package.json")).href)});`,
		},
		plugins: [
			{
				name: "external-dom-runtime",
				setup(builder) {
					builder.onResolve({ filter: /^(isomorphic-dompurify|jsdom)$/ }, (args) => ({
						path: pathToFileURL(runtimeRequire.resolve(args.path)).href,
						external: true,
					}));
				},
			},
		],
	});
	const course = join(root, "course");
	await cp(fixture, course, { recursive: true });
	await persistFixtureIdentity(course);
	for (const [format, cliFormat] of [
		["html", "html"],
		["scorm12", "scorm-1.2"],
		...(evidence ? [["scorm2004", "scorm-2004"]] : []),
	]) {
		const output = join(root, `${format}.zip`);
		const result = spawnSync(
			process.execPath,
			[join(root, "cli.mjs"), "export", course, "--format", cliFormat, "--output", output],
			{ encoding: "utf8" },
		);
		expect(result.status, result.stderr + result.stdout).toBe(0);
		if (evidence)
			await writeFile(
				join(evidence, `${format}-cli.json`),
				JSON.stringify(
					{ status: result.status, stdout: result.stdout, stderr: result.stderr },
					null,
					2,
				),
			);
		addPackage(format, await readFile(output));
	}
	const resolved = await resolveLessonSources(course);
	const lessons = [...resolved.lessons.values()];
	hostCourseId = resolved.identity.course.courseId;
	pageIds = lessons.flatMap((read) => read.pages.map((page) => page.id));
	sheetIds = lessons.flatMap((read) =>
		read.blocks.filter((block) => block.type === "retrievalSheet").map((block) => block.id),
	);
	expect(sheetIds).toHaveLength(2);
	for (const read of lessons) {
		const locale = read.frontmatter.lang ?? "en";
		scripts[locale] = extractNarrationSegments(
			"",
			{},
			adaptGrammarPreviewBlocks(
				read.blocks.filter((block) => block.type === "retrievalSheet"),
				undefined,
				locale,
			),
			{},
			locale,
		).map((segment) => segment.script);
	}
	if (evidence) {
		const artifact = await compileCourse(
			{
				id: "retrieval-acceptance",
				title: "Retrieval acceptance",
				sourceLocale: "en",
				content: lessons.flatMap((read) =>
					read.pages.map((page) => ({ ...page, locale: read.frontmatter.lang })),
				),
				xapiConfig,
			},
			{ temporaryRoot: root },
		);
		try {
			const zip = (await deployCourse(artifact, { format: "xapi", xapiConfig })).zip;
			await writeFile(join(root, "xapi.zip"), zip);
			addPackage("xapi", zip);
		} finally {
			await artifact.dispose();
		}
		await writeFile(join(evidence, "narration.json"), JSON.stringify(scripts, null, 2));
		await cp(course, join(evidence, "published-fixture"), { recursive: true });
		for (const format of formats)
			await cp(join(root, `${format}.zip`), join(evidence, `${format}.zip`));
	}
	for (const format of formats)
		for (const locale of ["en", "fr"]) {
			const entry = [...files].find(
				([path, bytes]) =>
					path.startsWith(`/${format}/`) &&
					path.endsWith(".html") &&
					bytes.includes(Buffer.from(locale === "en" ? "sheetEn" : "sheetFr")),
			);
			if (!entry) throw new Error(`Missing ${format} ${locale} page`);
			entries.set(`${format}-${locale}`, entry[0]);
		}
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
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing address");
	base = `http://127.0.0.1:${address.port}`;
	const receipt = {
		durationMs: Date.now() - setupStarted,
		cachedViewer: !!cached,
		commandBuilds: 1,
		formats,
	};
	await test
		.info()
		.attach("shared-build", { body: JSON.stringify(receipt), contentType: "application/json" });
	await save("shared-build", receipt);
	// This stays inside the existing 45-second hook deadline. CI retains the measured receipt.
	expect(receipt.durationMs).toBeLessThan(35_000);
});
function addPackage(format: string, zip: Buffer) {
	for (const entry of new AdmZip(zip).getEntries())
		if (!entry.isDirectory) files.set(`/${format}/${entry.entryName}`, entry.getData());
}
async function expectVisibleUnavailable(page: Page) {
	const status = page.locator("[data-retrieval-status]");
	await expect(status).toBeVisible();
	await expect(status).not.toHaveClass(/praxity-sr-only/);
	await expect(status).toHaveCSS("clip-path", "none");
	expect((await status.boundingBox())?.width).toBeGreaterThan(100);
}
test.afterAll(async ({ browser }) => {
	if (deniedCaptures && server) {
		await mkdir(deniedCaptures, { recursive: true });
		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			await page.route("**/*island-retrieval-sheet*", (route) => route.abort());
			for (const locale of ["en", "fr"])
				for (const colorScheme of ["light", "dark"] as const)
					for (const width of [1280, 320]) {
						await page.setViewportSize({ width, height: 900 });
						await page.emulateMedia({ colorScheme });
						await page.goto(base + entries.get(`html-${locale}`));
						await expectVisibleUnavailable(page);
						await page.screenshot({
							path: join(deniedCaptures, `denied-${locale}-${colorScheme}-${width}.png`),
							fullPage: true,
						});
					}
		} finally {
			await context.close();
		}
	}
	if (evidence && server) {
		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			for (const locale of ["en", "fr"])
				for (const colorScheme of ["light", "dark"] as const)
					for (const width of [1280, 320]) {
						await page.setViewportSize({ width, height: 900 });
						await page.emulateMedia({ colorScheme });
						await page.goto(base + entries.get(`html-${locale}`));
						await expect(page.locator('[data-retrieval-sheet] [role="tab"]')).toHaveCount(2);
						await page.screenshot({
							path: join(evidence, `${locale}-${colorScheme}-${width}.png`),
							fullPage: true,
						});
					}
		} finally {
			await context.close();
		}
	}
	if (server)
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	if (root && !process.env.PRAXITY_RETRIEVAL_BUILD)
		await rm(root, { recursive: true, force: true });
});

// Instrument outgoing seams before the host starts. The recorder itself never writes storage.
async function instrument(page: Page, format: string) {
	const effects: unknown[] = [];
	await page.exposeFunction("recordRetrievalEffect", (effect: unknown) => effects.push(effect));
	await page.addInitScript(
		({ format }) => {
			const report = (kind: string, value: unknown) => {
				void Reflect.get(window, "recordRetrievalEffect")({ kind, value });
			};
			const writes: unknown[] = [];
			const calls: unknown[] = [];
			const probe = { writes, calls, prints: [] as unknown[], printCalls: 0 };
			Reflect.set(window, "retrievalProbe", probe);
			for (const method of ["setItem", "removeItem", "clear"] as const) {
				const original = Storage.prototype[method];
				Reflect.set(Storage.prototype, method, function (this: Storage, ...args: unknown[]) {
					const effect = { store: this === localStorage ? "local" : "session", method, args };
					writes.push(effect);
					report("storage", effect);
					return Reflect.apply(original, this, args);
				});
			}
			for (const method of ["put", "add", "delete", "clear"] as const) {
				const original = IDBObjectStore.prototype[method];
				Reflect.set(
					IDBObjectStore.prototype,
					method,
					function (this: IDBObjectStore, ...args: unknown[]) {
						const effect = { store: "indexedDB", method, args };
						writes.push(effect);
						report("storage", effect);
						return Reflect.apply(original, this, args);
					},
				);
			}
			const values: Record<string, string> = {
				"cmi.core.student_id": "acceptance",
				"cmi.learner_id": "acceptance",
				"cmi.core.entry": "ab-initio",
				"cmi.entry": "ab-initio",
				"cmi.interactions._count": "0",
			};
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
					const effect = { method, args };
					calls.push(effect);
					report("lms", effect);
					if (method === "SetValue") values[args[0]] = args[1];
					return method === "GetValue"
						? (values[args[0]] ?? "")
						: method === "GetLastError"
							? "0"
							: "true";
				};
			if (format === "scorm12" || format === "scorm2004")
				Reflect.set(
					window,
					format === "scorm12" ? "API" : "API_1484_11",
					format === "scorm12"
						? Object.fromEntries(Object.entries(api).map(([key, value]) => [`LMS${key}`, value]))
						: api,
				);
			window.print = () => {
				probe.printCalls++;
				const root = document.querySelector("[data-praxity-print-selected]");
				probe.prints.push({
					selected: root?.textContent,
					scope: document.documentElement.hasAttribute("data-praxity-retrieval-print"),
					sheets: document.querySelectorAll("[data-praxity-print-selected]").length,
				});
			};
		},
		{ format },
	);
	return effects;
}
async function snapshot(page: Page) {
	return page.evaluate(
		() =>
			Reflect.get(window, "retrievalProbe") as {
				writes: unknown[];
				calls: unknown[];
				prints: Array<{ selected: string; scope: boolean; sheets: number }>;
				printCalls: number;
			},
	);
}
async function save(name: string, value: unknown) {
	if (evidence) await writeFile(join(evidence, `${name}.json`), JSON.stringify(value, null, 2));
}
type Effect = { kind: string; value: { method: string; args: string[]; store?: string } };
function assertHostEffects(effects: unknown[], format: string) {
	const courseId = format === "xapi" ? "retrieval-acceptance" : hostCourseId;
	const storageKeys = new Set([
		"praxity-a11y",
		"praxity:focus-page-content",
		`praxity-course-session:${courseId}`,
		...(format === "html" ? [`praxity:${courseId}:default:state`] : []),
		...(format === "xapi"
			? [
					`praxity-xapi-actor:${courseId}`,
					`praxity-xapi:${courseId}:mailto%3Aacceptance%40example.com`,
				]
			: []),
	]);
	const lmsElements = new Set(
		format === "scorm12"
			? [
					"cmi.core.lesson_status",
					"cmi.suspend_data",
					"cmi.core.lesson_location",
					"cmi.core.exit",
					"cmi.core.session_time",
				]
			: [
					"cmi.completion_status",
					"cmi.suspend_data",
					"cmi.location",
					"cmi.exit",
					"cmi.session_time",
				],
	);
	for (const { kind, value } of effects as Effect[]) {
		if (kind === "storage") {
			expect(value.method).not.toBe("clear");
			expect(storageKeys.has(value.args[0])).toBe(true);
			if (value.method !== "setItem") continue;
			if (value.args[0] === `praxity:${courseId}:default:state`) {
				const state = JSON.parse(value.args[1]);
				expect(Object.keys(state).sort()).toEqual(
					[
						"schemaVersion",
						"courseId",
						"attemptId",
						"revision",
						"generation",
						"sequence",
						"bookmark",
						"visitedPageIds",
						"interactions",
						"completion",
						"score",
						"variables",
						"blockState",
						"custom",
					].sort(),
				);
				expect(state).toMatchObject({
					blockState: {},
					interactions: [],
					variables: {},
					custom: null,
					score: null,
					revision: null,
					attemptId: "default",
				});
				expect(state.blockState).toEqual({});
				expect(state.variables).toEqual({});
				expect(state.visitedPageIds.every((id: string) => pageIds.includes(id))).toBe(true);
			} else if (value.args[0].startsWith("praxity-xapi:")) {
				const state = JSON.parse(value.args[1]);
				expect(Object.keys(state).sort()).toEqual(
					[
						"visitedPages",
						"interactions",
						"completionStatus",
						"successStatus",
						"score",
						"bookmark",
						"suspendData",
						"outbox",
					].sort(),
				);
				expect(state).toMatchObject({
					interactions: [],
					score: null,
					suspendData: null,
					outbox: [],
				});
			} else if (value.args[0] === "praxity-a11y") {
				expect(JSON.parse(value.args[1])).toEqual({
					textSize: "default",
					focusChoice: null,
					focusMode: false,
				});
			}
		} else if (kind === "lms" && value.method === "SetValue") {
			expect(lmsElements.has(value.args[0])).toBe(true);
			if (value.args[0] === "cmi.suspend_data") {
				const state = JSON.parse(value.args[1]);
				expect(Object.keys(state).sort()).toEqual(
					(format === "scorm12" ? ["visitedPages", "interactions"] : ["visitedPages"]).sort(),
				);
				if (format === "scorm12") expect(state.interactions).toEqual([]);
				expect(state.visitedPages.every((id: string) => pageIds.includes(id))).toBe(true);
			}
		}
	}
}
const copy = {
	en: {
		title: "Design approaches",
		questions: ["What does universal design consider?", "What does an accommodation address?"],
		answers: ["Diverse users from the start.", "An individual's access need."],
		back: "Back",
		front: "Front",
		another: "Another date",
		print: "Print the sheet",
	},
	fr: {
		title: "Approches de conception",
		questions: ["Que prévoit la conception universelle ?", "À quoi répond une adaptation ?"],
		answers: ["La diversité des personnes dès le départ.", "Au besoin d'accès d'une personne."],
		back: "Verso",
		front: "Recto",
		another: "Une autre date",
		print: "Imprimer la feuille",
	},
};
for (const format of formats)
	for (const locale of ["en", "fr"] as const) {
		const text = copy[locale];
		test(`${format} ${locale}: no-JS baseline links CSS and reads both numbered sides`, async ({
			browser,
		}) => {
			const context = await browser.newContext({ javaScriptEnabled: false });
			try {
				const page = await context.newPage();
				await page.goto(base + entries.get(`${format}-${locale}`));
				await expect(page.locator('link[rel="stylesheet"][href*="retrieval-sheet."]')).toHaveCount(
					1,
				);
				await expect(page.locator('[data-retrieval-side="front"] li p')).toHaveText(text.questions);
				await expect(page.locator('[data-retrieval-side="back"] li p')).toHaveText(text.answers);
				await expect(page.locator('[data-retrieval-side="back"]')).toBeVisible();
				await expect(page.locator("[data-retrieval-controls]")).toBeHidden();
				await expect(page.locator(".praxity-retrieval-sheet-space").first()).toHaveCSS(
					"height",
					"32px",
				);
				await expect(page.locator("[data-retrieval-date-line]")).toHaveCSS(
					"border-bottom-width",
					"1px",
				);
			} finally {
				await context.close();
			}
		});
		test(`${format} ${locale}: date, manual tabs, instance print and reload send no practice data`, async ({
			page,
		}) => {
			await page.clock.install({ time: new Date("2026-10-18T12:00:00Z") });
			const effects = await instrument(page, format);
			const network: string[] = [];
			const requests: Array<{ method: string; url: string; body: string }> = [];
			page.on("request", (request) => {
				network.push(request.url());
				if (request.method() !== "GET" || !request.url().startsWith(base))
					requests.push({
						method: request.method(),
						url: request.url(),
						body: request.postData() ?? "",
					});
			});
			await page.route("https://lrs.example/**", (route) =>
				route.fulfill({ status: 200, body: "[]" }),
			);
			const query =
				format === "xapi"
					? `?actor=${encodeURIComponent(JSON.stringify({ name: "Acceptance", mbox: "mailto:acceptance@example.com" }))}`
					: "";
			await page.goto(base + entries.get(`${format}-${locale}`) + query);
			const sheet = page.locator("[data-retrieval-sheet]");
			await expect(sheet.locator('[role="tab"]')).toHaveCount(2);
			const sheetId = await sheet.evaluate((element) =>
				element.closest("[data-block-id]")?.getAttribute("data-block-id"),
			);
			if (!sheetId) throw new Error("Missing published sheet identity");
			await page.clock.fastForward(1_000);
			assertHostEffects(effects, format);
			const before = await snapshot(page);
			const requestCount = network.length;
			await sheet.getByRole("radio", { name: text.another, exact: true }).check();
			const date = sheet.locator('input[type="date"]');
			await date.fill("");
			await sheet.getByRole("tab", { name: text.front, exact: true }).focus();
			await expect(sheet.getByRole("button", { name: text.print, exact: true })).toBeDisabled();
			await expect(date).toHaveAttribute("aria-invalid", "true");
			await date.fill("2099-12-30");
			await expect(sheet.getByRole("button", { name: text.print, exact: true })).toBeEnabled();
			await sheet.getByRole("tab", { name: text.back, exact: true }).focus();
			await page.keyboard.press("Enter");
			await expect(sheet.locator('[data-retrieval-side="back"]')).toBeVisible();
			await sheet.getByRole("button", { name: text.print, exact: true }).click();
			await page.emulateMedia({ media: "print" });
			await expect(page.locator('[data-retrieval-side="front"]')).toBeVisible();
			await expect(page.locator('[data-retrieval-side="back"]')).toBeVisible();
			await expect(
				page.getByText(
					locale === "en" ? "Outside the printed sheet." : "Hors de la fiche imprimée.",
					{ exact: true },
				),
			).toBeHidden();
			if (evidence)
				await page.pdf({
					path: join(evidence, `${format}-${locale}-learner-print.pdf`),
					format: "A4",
				});
			const printed = await snapshot(page);
			expect(printed.printCalls).toBe(1);
			expect(printed.prints[0]).toMatchObject({ scope: true, sheets: 1 });
			expect(printed.prints[0].selected).toContain(text.title);
			await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
			await page.emulateMedia({ media: "screen" });
			await expect(page.locator("html")).not.toHaveAttribute("data-praxity-retrieval-print");
			await expect(sheet.getByRole("tab", { name: text.back, exact: true })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			const afterActions = await snapshot(page);
			expect(afterActions.writes).toEqual(before.writes);
			expect(afterActions.calls).toEqual(before.calls);
			expect(network).toHaveLength(requestCount);
			await page.evaluate(() =>
				window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
			);
			await page.clock.fastForward(60_000);
			await page.evaluate(() => new Promise<void>((resolve) => queueMicrotask(resolve)));
			const after = await snapshot(page);
			assertHostEffects(effects, format);
			await save(`${format}-${locale}-actions`, { before, after, requests });
			await page.reload();
			await expect(sheet.getByRole("tab", { name: text.front, exact: true })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await expect(sheet.locator('input[type="date"]')).toHaveValue("2026-10-25");
			assertHostEffects(effects, format);
			const reloaded = await snapshot(page);
			const outgoing = JSON.stringify({
				effects,
				after: { writes: after.writes, calls: after.calls },
				reloaded: { writes: reloaded.writes, calls: reloaded.calls },
				requests,
			});
			for (const marker of [
				...sheetIds,
				sheetId,
				"2099-12-30",
				"2099",
				"2026-10-25",
				"sheetEn",
				"sheetFr",
				...text.questions,
				...text.answers,
			])
				expect(outgoing).not.toContain(marker);
			expect(
				requests.every(
					(request) =>
						request.url.startsWith("https://lrs.example/") &&
						["initialized", "experienced", "completed", "terminated"].includes(
							JSON.parse(request.body).verb.id.split("/").at(-1),
						),
				),
			).toBe(true);
			await save(`${format}-${locale}-reload`, { reloaded, requests, effects });
		});
		test(`${format} ${locale}: denied enhancer leaves a styled complete baseline`, async ({
			page,
		}) => {
			const denied: string[] = [];
			await page.addInitScript(() => {
				const changes: string[] = [];
				Reflect.set(window, "retrievalNotices", changes);
				new MutationObserver((records) => {
					for (const record of records) {
						const el =
							record.target instanceof Element ? record.target : record.target.parentElement;
						if (el?.matches("[data-retrieval-status]") && el.textContent)
							changes.push(el.textContent);
					}
				}).observe(document, { subtree: true, childList: true, characterData: true });
			});
			await page.route("**/*island-retrieval-sheet*", (route) => {
				denied.push(route.request().url());
				return route.abort();
			});
			await page.goto(base + entries.get(`${format}-${locale}`));
			await expect(page.locator('[data-retrieval-side="front"] li p')).toHaveText(text.questions);
			await expect(page.locator('[data-retrieval-side="back"] li p')).toHaveText(text.answers);
			await expect(page.locator('[data-retrieval-side="back"]')).toBeVisible();
			await expect(page.locator("[data-retrieval-controls]")).toBeHidden();
			await expect(page.locator(".praxity-retrieval-sheet-space").first()).toHaveCSS(
				"height",
				"32px",
			);
			await expectVisibleUnavailable(page);
			const unavailable =
				locale === "en"
					? "Date and side controls are unavailable. Both sides remain readable and printable."
					: "Les commandes de date et de côté ne sont pas disponibles. Les deux côtés restent lisibles et imprimables.";
			await expect(page.getByRole("status")).toHaveCount(1);
			await expect(page.getByRole("status")).toHaveText(unavailable);
			expect(await page.evaluate(() => Reflect.get(window, "retrievalNotices"))).toEqual([
				unavailable,
			]);
			const capture = await page.screenshot({ fullPage: true });
			await test
				.info()
				.attach("denied-enhancer-visible", { body: capture, contentType: "image/png" });
			await page.emulateMedia({ media: "print" });
			await expect(page.locator('[data-retrieval-side="front"]')).toBeVisible();
			await expect(page.locator('[data-retrieval-side="back"]')).toBeVisible();
			expect(denied.length).toBeGreaterThan(0);
			await save(`${format}-${locale}-denied`, { denied });
		});
	}
test("automatic sheet narration contains title and ordered questions only", () => {
	for (const locale of ["en", "fr"] as const)
		expect(scripts[locale]).toEqual([
			`${copy[locale].title} [pause]\n\n${copy[locale].questions.join(" ")}`,
		]);
});
