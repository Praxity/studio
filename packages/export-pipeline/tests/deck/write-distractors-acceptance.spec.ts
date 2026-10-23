import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { readWriteDistractorsContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { build } from "esbuild";
import { resolveLessonSources } from "../../../../apps/desktop/src/main/lesson-source";
import { persistFixtureIdentity } from "../../../../apps/desktop/src/test-utils/identity-fixture";
import { compileCourse, deployCourse, writeDistractorsContentInput } from "../../src/build";
import { bundleViewer, computeViewerSourceHash } from "../../src/bundle-viewer";
import { prepareDesktopExportInputs } from "../../src/export-assets";
import { readCachedViewer, VIEWER_CACHE_DIR } from "../../src/viewer-cache";
import { normalizePdfOutput, stagedAnswerOutputInvariant } from "../fixtures/staged-answer-output";
import {
	fields,
	hidden,
	locales,
	marker,
	places,
	prompt,
	source,
} from "../fixtures/write-distractors-course";

const checkout = fileURLToPath(new URL("../../../../", import.meta.url));
const evidence = process.env.PRAXITY_DISTRACTORS_EVIDENCE;
const formats = ["html", "scorm12", "scorm2004", "xapi"] as const;
const files = new Map<string, Buffer>();
const entries = new Map<string, string>();
const ids = new Map<string, string[]>();
const pdfOutputs: Array<{ answers: boolean; bytes: Buffer; text: string }> = [];
let root: string, base: string, server: Server;
test.use({ contextOptions: { reducedMotion: "reduce" } });
const xapiConfig = {
	endpoint: "https://lrs.example/xapi/statements",
	auth: "Basic test",
	actorMode: "lms" as const,
};
// Build one real CLI and export once per format/layout, outside individual test timing.
test.beforeAll(async () => {
	// Shared cold CLI/package/PDF build; individual cases retain 45s.
	test.setTimeout(120_000); // timeout: docs/context/testing-strategy.md cold CLI/package/PDF fixture; individual case limit unchanged
	const started = Date.now();
	root =
		process.env.PRAXITY_DISTRACTORS_BUILD ??
		(await mkdtemp(join(tmpdir(), "distractors-acceptance-")));
	await mkdir(root, { recursive: true });
	if (evidence) await mkdir(evidence, { recursive: true });
	const assets = join(root, "assets");
	const cached = await readCachedViewer(VIEWER_CACHE_DIR, await computeViewerSourceHash());
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
	// Scratch export assets have no adjacent compiler. Use the app's pinned native tools.
	const typstExecutablePath =
		process.env.PRAXITY_TEST_TYPST ||
		join(
			checkout,
			"apps/desktop/resources/typst",
			process.platform === "win32" ? "typst.exe" : "typst",
		);
	await build({
		stdin: {
			resolveDir: checkout,
			contents: `import {runPraxityCli} from './apps/desktop/src/main/cli'; const result = await runPraxityCli(process.argv.slice(2), {appVersion: ${JSON.stringify(version)}, exportAssetsDir: ${JSON.stringify(assets)}, typstExecutablePath: ${JSON.stringify(typstExecutablePath)}}); process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.exitCode;`,
		},
		outfile: join(root, "cli.mjs"),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: `import {createRequire as createBundleRequire} from 'node:module'; const require = createBundleRequire(${JSON.stringify(pathToFileURL(join(checkout, "package.json")).href)});`,
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
	for (const layout of ["pages", "deck"]) {
		const course = join(root, layout);
		await mkdir(course, { recursive: true });
		await writeFile(
			join(course, "course.yaml"),
			`title: Distractor acceptance\nmoduleDeck: ${layout === "deck"}\ndesign:\n  colorMode: auto\nlessons: [en.prax, fr.prax]\n`,
		);
		for (const locale of locales)
			await writeFile(
				join(course, `${locale}.prax`),
				source(locale) +
					"\n::: choice PUBLIC_REPORTING_CONTROL {required=false}\n(x) PUBLIC_RIGHT\n( ) PUBLIC_WRONG\n:::\n",
			);
		await persistFixtureIdentity(course);
		const resolved = await resolveLessonSources(course);
		const reads = [...resolved.lessons.values()];
		const activityIds = reads.flatMap((read) =>
			[...read.nodes.values()]
				.filter((node) => !node.role && node.node.type === "write-distractors")
				.map((node) => node.id),
		);
		const itemIds = reads.flatMap((read) =>
			activityIds
				.filter((id) => read.nodes.has(id))
				.flatMap((id) =>
					readWriteDistractorsContent(read, id).misconceptions.map((item) => item.id),
				),
		);
		// Saved options contain misconception IDs as well as the activity ID. Neither may leave the device.
		ids.set(layout, [...activityIds, ...itemIds]);
		for (const [format, cliFormat] of [
			["html", "html"],
			["scorm12", "scorm-1.2"],
			["scorm2004", "scorm-2004"],
		]) {
			const output = join(root, `${layout}-${format}.zip`);
			const result = spawnSync(
				process.execPath,
				[join(root, "cli.mjs"), "export", course, "--format", cliFormat, "--output", output],
				{ encoding: "utf8" },
			);
			expect(result.status, result.stderr + result.stdout).toBe(0);
			addPackage(`${layout}-${format}`, await readFile(output));
		}
		const artifact = await compileCourse(
			{
				id: resolved.identity.course.courseId,
				title: "Distractor acceptance",
				sourceLocale: "en",
				content: reads.flatMap((read) =>
					read.pages.map((page) => ({
						...page,
						locale: read.frontmatter.lang,
						lessonId: read.frontmatter.lang,
					})),
				),
				writeDistractorsContents: reads.flatMap((read) =>
					activityIds
						.filter((id) => read.nodes.has(id))
						.map((id) => writeDistractorsContentInput(id, readWriteDistractorsContent(read, id))),
				),
				...(layout === "deck" ? { moduleDeck: {} } : {}),
			},
			{ temporaryRoot: root },
		);
		try {
			addPackage(
				`${layout}-xapi`,
				(await deployCourse(artifact, { format: "xapi", xapiConfig })).zip,
			);
		} finally {
			await artifact.dispose();
		}
		for (const format of formats)
			for (const locale of locales) {
				const entry = [...files].find(
					([path, bytes]) =>
						path.startsWith(`/${layout}-${format}/`) &&
						path.endsWith(".html") &&
						bytes.includes(Buffer.from(`<html lang="${locale}"`)) &&
						bytes.includes(Buffer.from(prompt(locale, "TOP"))),
				);
				if (!entry) throw new Error(`Missing ${layout}/${format}/${locale}`);
				entries.set(`${layout}-${format}-${locale}`, entry[0]);
			}
	}
	const nativeCourse = join(root, "native");
	await mkdir(nativeCourse, { recursive: true });
	await writeFile(
		join(nativeCourse, "course.yaml"),
		"title: Distractor PDF control\nlessons: [en.prax, fr.prax]\n",
	);
	for (const locale of locales)
		await writeFile(join(nativeCourse, `${locale}.prax`), source(locale).replaceAll(" 😀", ""));
	await persistFixtureIdentity(nativeCourse);
	for (const answers of [false, true]) {
		const output = join(root, `cli-${answers}.pdf`);
		const result = spawnSync(
			process.execPath,
			[
				join(root, "cli.mjs"),
				"export",
				nativeCourse,
				"--format",
				"pdf",
				"--output",
				output,
				...(answers ? ["--include-answer-sheet"] : []),
			],
			{ encoding: "utf8" },
		);
		expect(result.status, result.stdout + result.stderr).toBe(0);
		pdfOutputs.push({
			answers,
			bytes: await readFile(output),
			text: execFileSync("pdftotext", ["-layout", output, "-"], { encoding: "utf8" }),
		});
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
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing address");
	base = `http://127.0.0.1:${address.port}`;
	await test.info().attach("shared-build", {
		body: JSON.stringify({
			durationMs: Date.now() - started,
			commandBuilds: 1,
			cliPackages: 6,
			compiledXapiPackages: 2,
			nativePdfs: 2,
		}),
		contentType: "application/json",
	});
});
function scanPackage(name: string, bytes: Buffer) {
	const zip = new AdmZip(bytes);
	const owned = new Map<string, readonly string[]>();
	for (const entry of zip
		.getEntries()
		.filter((entry) => entry.entryName.startsWith("write-distractors/") && !entry.isDirectory)) {
		expect(entry.entryName).toMatch(/^write-distractors\/[a-f0-9]{64}\.js$/);
		const owner = locales
			.flatMap((locale) => places.map((place) => ({ locale, place })))
			.find(({ locale, place }) => entry.getData().includes(Buffer.from(prompt(locale, place))));
		if (!owner) throw new Error("Asset has no admitted question owner");
		owned.set(
			entry.entryName,
			fields.map((field) => marker(owner.locale, owner.place, field)),
		);
	}
	expect(owned.size).toBe(14);
	stagedAnswerOutputInvariant("WD").scanZip(`package/${name}`, bytes, owned);
}
function addPackage(name: string, bytes: Buffer) {
	scanPackage(name, bytes);
	new AdmZip(bytes).extractAllTo(join(root, name), true);
	for (const entry of new AdmZip(bytes).getEntries())
		if (!entry.isDirectory) files.set(`/${name}/${entry.entryName}`, entry.getData());
}
test.afterAll(async ({ browser }) => {
	if (evidence && server) {
		for (const output of pdfOutputs) {
			const name = output.answers ? "cli-answer-sheet" : "cli-workbook";
			await writeFile(join(evidence, `${name}.pdf`), output.bytes);
			await writeFile(join(evidence, `${name}.txt`), output.text);
		}
		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			for (const locale of locales) {
				await page.setViewportSize({ width: locale === "en" ? 1280 : 320, height: 900 });
				await page.emulateMedia({
					colorScheme: locale === "en" ? "light" : "dark",
					reducedMotion: "reduce",
				});
				const activity = await open(page, "pages", "html", locale);
				await activity
					.locator("[data-distractor-answer]")
					.fill("Consider access throughout design.");
				await activity.locator('[data-distractor-action="check"]').click();
				await expect(activity).toContainText(marker(locale, "TOP", "RIGHT"));
				for (const state of ["revealed", "compared", "recovery"]) {
					if (state === "compared") await compare(activity);
					if (state === "recovery") {
						const blockId = await activity.getAttribute("data-distractor-id");
						if (!blockId) throw new Error("Missing activity identity");
						await page.evaluate((id) => {
							window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
							for (const key of Object.keys(localStorage)) {
								if (!key.endsWith(":state")) continue;
								const record = JSON.parse(localStorage.getItem(key) ?? "{}");
								if (!record.blockState?.[id]) continue;
								record.blockState[id].contentRevision = `sha256:${"0".repeat(64)}`;
								localStorage.setItem(key, JSON.stringify(record));
							}
						}, blockId);
						await page.reload();
						await expect(
							activity.locator("[data-distractor-recovery] textarea").first(),
						).toHaveValue("Consider access throughout design.");
					}
					// Capture from the page origin so fixed chrome cannot cover part of a tall activity.
					await activity.evaluate((element) => {
						for (let parent = element.parentElement; parent; parent = parent.parentElement)
							parent.scrollTop = 0;
						window.scrollTo(0, 0);
					});
					const bounds = await activity.boundingBox();
					if (!bounds) throw new Error("Missing capture bounds");
					await page.screenshot({
						path: join(evidence, `${locale}-${state}.png`),
						fullPage: true,
						clip: bounds,
					});
					await page.evaluate((y) => {
						const header = [...document.querySelectorAll("header")]
							.map((header) => header.getBoundingClientRect())
							.filter((box) => box.top === 0 && box.height < innerHeight / 2)
							.reduce((height, box) => Math.max(height, box.height), 0);
						window.scrollTo(0, Math.max(0, y - header - 16));
					}, bounds.y);
					await page.screenshot({ path: join(evidence, `${locale}-${state}-viewport.png`) });
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(locale === "en" ? 1280 : 320);
				}
			}
		} finally {
			await context.close();
		}
	}

	if (server)
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done())),
		);
	if (root && !process.env.PRAXITY_DISTRACTORS_BUILD) await rm(root, { recursive: true });
});
async function open(page: Page, layout: string, format: string, locale: string, place = "TOP") {
	await page.goto(
		base +
			entries.get(`${layout}-${format}-${locale}`) +
			(format === "xapi"
				? `?actor=${encodeURIComponent(JSON.stringify({ name: "Acceptance", mbox: "mailto:acceptance@example.com" }))}`
				: ""),
	);
	const activity = page
		.locator("[data-write-distractors]")
		.filter({ has: page.getByRole("heading", { name: new RegExp(prompt(locale, place)) }) });
	if (place === "ACC")
		await page.locator('[data-island="accordion"] [data-disclosure-trigger]').click();
	if (place === "BACK") await page.locator("[data-card-flip]").click();
	await expect(activity.locator('[data-distractor-action="check"]')).toHaveAttribute(
		"aria-disabled",
		"false",
	);
	return activity;
}
async function compare(activity: Locator) {
	await activity.locator('[data-distractor-action="yes"]').click();
	const options = activity.locator("fieldset textarea");
	await options.nth(0).fill("LEARNER-PRIVATE-OPTION-ONE");
	await options.nth(1).fill("LEARNER-PRIVATE-OPTION-TWO");
	for (const select of await activity.locator("fieldset select").all()) {
		await expect(select).toHaveCSS("appearance", "auto");
		const value = await select.locator("option").nth(1).getAttribute("value");
		if (!value) throw new Error("Missing label");
		await select.selectOption(value);
	}
	await activity.locator('[data-distractor-action="compare"]').click();
	await expect(activity.locator('[data-distractor-action="compare"]')).toHaveAttribute(
		"aria-disabled",
		"true",
	);
}
for (const layout of ["pages", "deck"])
	for (const locale of locales)
		for (const place of places)
			test(`${layout} ${locale} ${place}: real CLI export reveals and compares`, async ({
				page,
			}) => {
				const activity = await open(page, layout, "html", locale, place);
				await expect(activity).not.toContainText(marker(locale, place, "RIGHT"));
				await activity.locator("[data-distractor-answer]").fill("LEARNER-PRIVATE-ANSWER");
				await activity.locator('[data-distractor-action="check"]').click();
				await expect(activity).toContainText(marker(locale, place, "RIGHT"));
				await expect(activity).not.toContainText(marker(locale, place, "OPTION_B"));
				await compare(activity);
				await expect(activity).toContainText(marker(locale, place, "OPTION_B"));
				expect(
					await activity.evaluate((root) => {
						const block = root.closest("[data-block-id]") ?? root;
						return [block, ...block.querySelectorAll("*")]
							.flatMap((element) => element.getAttributeNames())
							.filter((name) =>
								/^data-(required|completion|completed|attempt|attempted|track-completion|signature|payment)(?:$|-)/.test(
									name,
								),
							);
					}),
				).toEqual([]);
			});

// Observe each transport before initialization, retaining device writes separately.
async function instrument(page: Page, format: string) {
	const outgoing: unknown[] = [];
	await page.exposeFunction("recordDistractorEffect", (effect: unknown) => outgoing.push(effect));
	await page.addInitScript(
		({ format }) => {
			const report = (kind: string, value: unknown) =>
				void Reflect.get(window, "recordDistractorEffect")({ kind, value });
			const set = Storage.prototype.setItem;
			const values: Record<string, string> = {
				"cmi.core.student_id": "acceptance",
				"cmi.learner_id": "acceptance",
				"cmi.core.entry": "resume",
				"cmi.entry": "resume",
				"cmi.interactions._count": "0",
			};
			Object.assign(values, JSON.parse(sessionStorage.getItem("acceptance-lms") ?? "{}"));
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
						report("lms", args);
						values[args[0]] = args[1];
						Reflect.apply(set, sessionStorage, ["acceptance-lms", JSON.stringify(values)]);
					}
					return method === "GetValue"
						? (values[args[0]] ?? "")
						: method === "GetLastError"
							? "0"
							: "true";
				};
			if (format === "scorm12")
				Reflect.set(
					window,
					"API",
					Object.fromEntries(Object.entries(api).map(([key, value]) => [`LMS${key}`, value])),
				);
			if (format === "scorm2004") Reflect.set(window, "API_1484_11", api);
			const fetch = window.fetch;
			window.fetch = (...args) => {
				report("fetch", { url: String(args[0]), init: args[1] });
				return Reflect.apply(fetch, window, args);
			};
			const send = XMLHttpRequest.prototype.send;
			XMLHttpRequest.prototype.send = function (body) {
				report("xhr", body);
				return Reflect.apply(send, this, [body]);
			};
			navigator.sendBeacon = (url, data) => {
				report("beacon", { url, data });
				return true;
			};
			window.addEventListener("message", (event) => report("message", event.data));
			document.addEventListener("praxity:assessment-response", (event) =>
				report("response", (event as CustomEvent).detail),
			);
			Reflect.set(window, "deviceWrites", []);
			Storage.prototype.setItem = function (key, value) {
				(Reflect.get(window, "deviceWrites") as unknown[]).push({ key, value });
				return Reflect.apply(set, this, [key, value]);
			};
		},
		{ format },
	);
	await page.route("https://lrs.example/**", (route) => route.fulfill({ status: 200, body: "[]" }));
	return outgoing;
}
for (const format of formats)
	test(`${format}: two activities save on device and send no practice bytes`, async ({ page }) => {
		const outgoing = await instrument(page, format);
		const activity = await open(page, "pages", format, "en");
		await activity.locator("[data-distractor-answer]").fill("LEARNER-PRIVATE-ANSWER");
		await activity.locator('[data-distractor-action="check"]').click();
		await compare(activity);
		const second = page
			.locator("[data-write-distractors]")
			.filter({ has: page.getByRole("heading", { name: new RegExp(prompt("en", "COL")) }) });
		await second.locator("[data-distractor-answer]").fill("LEARNER-PRIVATE-SECOND");
		await page.evaluate(() =>
			window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
		);
		const writes = await page.evaluate(
			() => Reflect.get(window, "deviceWrites") as Array<{ key: string; value: string }>,
		);
		expect(writes.every((write) => write.key !== "acceptance-lms")).toBe(true);
		expect(JSON.stringify(writes)).toContain("LEARNER-PRIVATE-ANSWER");
		expect(JSON.stringify(writes)).toContain("LEARNER-PRIVATE-SECOND");
		await page.evaluate(() => {
			window.dispatchEvent(new Event("beforeprint"));
			window.dispatchEvent(new Event("afterprint"));
		});
		await page.reload();
		const restored = page.locator("[data-write-distractors]").first();
		await expect(restored.locator('[data-distractor-action="compare"]')).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		await expect(restored).toContainText(marker("en", "TOP", "OPTION_B"));
		const restoreWrites = await page.evaluate(
			() => Reflect.get(window, "deviceWrites") as Array<{ key: string; value: string }>,
		);
		expect(JSON.stringify(restoreWrites)).not.toContain("LEARNER-PRIVATE");
		await restored.locator('[data-distractor-action="start-over"]').click();
		await expect(restored.locator("[data-distractor-answer]")).toHaveValue("");
		const bytes = JSON.stringify(outgoing);
		for (const id of ids.get("pages") ?? []) expect(bytes).not.toContain(id);
		expect(bytes).not.toMatch(/LEARNER-PRIVATE|WD_en_|WD_fr_|authorTargeted|ownExtra/);
		if (format.startsWith("scorm")) {
			expect(bytes).toContain("cmi.suspend_data");
			expect(bytes).not.toMatch(/cmi\.(interactions|objectives)/);
		}
		// A real public choice proves that the same observed host can report ordinary responses.
		const ordinary = page.locator('[data-island="assessment"]');
		await ordinary.getByRole("radio").first().check();
		await ordinary.locator("[data-assessment-submit]").click();
		if (format.startsWith("scorm"))
			await expect.poll(() => JSON.stringify(outgoing)).toContain("cmi.interactions");
		else if (format === "xapi") {
			const publicId = await ordinary.getAttribute("data-block-id");
			expect(publicId).toBeTruthy();
			await expect
				.poll(() =>
					outgoing.some((effect) => {
						const entry = effect as {
							kind: string;
							value: { url?: string; init?: { body?: string } };
						};
						return (
							entry.kind === "fetch" &&
							/\/statements$/.test(entry.value.url ?? "") &&
							(entry.value.init?.body ?? "").includes("answered") &&
							(entry.value.init?.body ?? "").includes(publicId ?? "missing")
						);
					}),
				)
				.toBe(true);
		} else
			expect(
				outgoing.filter((effect) =>
					["fetch", "xhr", "beacon", "lms"].includes((effect as { kind: string }).kind),
				),
			).toEqual([]);
		for (const id of ids.get("pages") ?? []) expect(JSON.stringify(outgoing)).not.toContain(id);
		expect(JSON.stringify(outgoing)).not.toMatch(/LEARNER-PRIVATE|WD_en_|WD_fr_/);
		await test.info().attach("privacy", {
			body: JSON.stringify({ outgoing, deviceWrites: writes, activityIds: ids.get("pages") }),
			contentType: "application/json",
		});
		if (evidence)
			await writeFile(
				join(evidence, `privacy-${format}.json`),
				JSON.stringify({ outgoing, deviceWrites: writes, activityIds: ids.get("pages") }, null, 2),
			);
	});
for (const locale of locales)
	test(`${locale}: real exported baseline without JavaScript`, async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		try {
			const page = await context.newPage();
			await page.goto(base + entries.get(`pages-html-${locale}`));
			await expect(page.locator("[data-distractor-answer]")).toHaveCount(7);
			expect(await page.locator("body").textContent()).not.toMatch(/WD_en_|WD_fr_/);
			await expect(
				page.getByText(
					locale === "en"
						? "Checking your answer needs JavaScript. What you type here isn't saved."
						: "La vérification de votre réponse nécessite JavaScript. Ce que vous saisissez ici n'est pas enregistré.",
					{ exact: true },
				),
			).toHaveCount(7);
		} finally {
			await context.close();
		}
	});

for (const locale of locales)
	test(`${locale}: file launch uses classic support and saves`, async ({ page }) => {
		const entry = entries.get(`pages-html-${locale}`)?.split("/").at(-1);
		if (!entry) throw new Error("Missing file entry");
		await page.goto(pathToFileURL(join(root, "pages-html", entry)).href);
		const activity = page.locator("[data-write-distractors]").first();
		await expect(activity.locator('[data-distractor-action="check"]')).toHaveAttribute(
			"aria-disabled",
			"false",
		);
		await activity.locator("[data-distractor-answer]").fill("FILE-PRIVATE-ANSWER");
		await activity.locator('[data-distractor-action="check"]').click();
		await expect(activity).toContainText(marker(locale, "TOP", "RIGHT"));
		await compare(activity);
	});

for (const answers of [false, true])
	test(`CLI PDF normalized bytes and extracted text answers=${answers}`, () => {
		const output = pdfOutputs.find((output) => output.answers === answers);
		if (!output) throw new Error("Missing shared CLI PDF");
		const normalized = normalizePdfOutput(output.bytes);
		expect(normalized).toContain("Distractor PDF control");
		if (answers) expect(normalized).toContain("Answer sheet");
		const scan = stagedAnswerOutputInvariant("WD");
		scan.assertOutput(
			answers ? "explicit/cli-pdf" : "cli/pdf",
			output.bytes,
			answers ? hidden : [],
		);
		scan.assertOutput(
			answers ? "explicit/cli-text" : "cli/text",
			Buffer.from(output.text),
			answers ? hidden : [],
		);
		for (const locale of locales)
			for (const place of places) expect(output.text).toContain(prompt(locale, place));
		if (answers) {
			for (const value of hidden) expect(output.text).toContain(value);
			expect(output.text).toContain("café");
			expect(output.text).toContain("déjà");
		}
	});

for (const locale of locales)
	test(`${locale}: published spacing separates labels, options and preview groups`, async ({
		page,
	}) => {
		const activity = await open(page, "pages", "html", locale);
		await activity.locator("[data-distractor-answer]").fill("Spacing control");
		await activity.locator('[data-distractor-action="check"]').click();
		await expect(activity.locator(".praxity-distractor-label")).toBeVisible();
		expect(
			await activity.locator(".praxity-distractor-label").evaluate((label) => {
				const value = label.nextElementSibling;
				if (!value) throw new Error("Missing label value");
				return value.getBoundingClientRect().top - label.getBoundingClientRect().bottom;
			}),
		).toBeGreaterThanOrEqual(8);
		await activity.locator('[data-distractor-action="yes"]').click();
		expect(
			await activity
				.locator("fieldset")
				.first()
				.evaluate((field) => parseFloat(getComputedStyle(field).marginBlockEnd)),
		).toBeGreaterThanOrEqual(24);
		const options = activity.locator("fieldset textarea");
		for (const [index, option] of (await options.all()).entries())
			await option.fill(`Wrong ${index}`);
		for (const select of await activity.locator("fieldset select").all())
			await select.selectOption({ index: 1 });
		await activity.locator('[data-distractor-action="compare"]').click();
		expect(
			await activity
				.locator('[data-distractor-preview="learner"] li')
				.nth(1)
				.evaluate((item) => {
					const previous = item.previousElementSibling;
					if (!previous) throw new Error("Missing previous option");
					return item.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
				}),
		).toBeGreaterThanOrEqual(24);
		expect(
			await activity.locator('[data-distractor-preview="author"]').evaluate((group) => {
				const previous = group.previousElementSibling;
				if (!previous) throw new Error("Missing previous preview");
				return group.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
			}),
		).toBeGreaterThanOrEqual(32);
	});

test("CLI package scanner rejects a planted archive-comment marker", async () => {
	const zip = new AdmZip(await readFile(join(root, "pages-html.zip")));
	zip.addZipComment("WD_en_TAB_RIGHT_UNIQUE");
	expect(() => scanPackage("planted-cli", zip.toBuffer())).toThrow();
});
