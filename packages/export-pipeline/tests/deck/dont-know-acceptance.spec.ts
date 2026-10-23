import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { readSelfCheckContent } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { extractNarrationSegments } from "@praxity/shared-blocks/narration";
import AdmZip from "adm-zip";
import { build } from "esbuild";
import { resolveLessonSources } from "../../../../apps/desktop/src/main/lesson-source";
import { persistFixtureIdentity } from "../../../../apps/desktop/src/test-utils/identity-fixture";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";
import { bundleViewer, computeViewerSourceHash } from "../../src/bundle-viewer";
import { prepareDesktopExportInputs } from "../../src/export-assets";

const checkout = fileURLToPath(new URL("../../../../", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/dont-know-acceptance/", import.meta.url));
const evidence = process.env.PRAXITY_UNCERTAINTY_EVIDENCE;
const formats = ["scorm12", "xapi", "html", "scorm2004"] as const;
type Format = (typeof formats)[number];
type RequestRecord = { method: string; url: string; body: string };
type Call = { method: string; args: string[] };
test.skip(
	({ browserName }) => browserName !== "chromium",
	"Real-export acceptance runs on Chromium; other engines retain the focused private-choice suite.",
);
test.use({ viewport: { width: 1280, height: 1600 } });
let root: string, base: string, server: Server;
let htmlCourseId: string;
const files = new Map<string, Buffer>();
const entries = new Map<string, string>();
const courseId = "uncertainty-acceptance";
const narration: Record<string, string[]> = {};
const privateChoiceIds: Record<string, string[]> = {};
let refusal: { status: number | null; stdout: string; stderr: string };
const xapiConfig = {
	endpoint: "https://lrs.example/xapi/statements",
	auth: "Basic acceptance-stub",
	actorMode: "lms" as const,
};
const actor = { name: "Acceptance learner", mbox: "mailto:acceptance@example.com" };

// One real command bundle and one build of each package per file, outside test timing.
test.beforeAll(async () => {
	const startedAt = Date.now();
	root = process.env.PRAXITY_UNCERTAINTY_BUILD ?? (await mkdtemp(join(tmpdir(), "uncertainty-")));
	await mkdir(root, { recursive: true });
	if (evidence) await mkdir(evidence, { recursive: true });
	const assets = join(root, "assets");
	await bundleViewer(assets);
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
		["scorm12", "scorm-1.2"],
		["html", "html"],
		["scorm2004", "scorm-2004"],
	]) {
		const output = join(root, `${format}.zip`);
		const result = spawnSync(
			process.execPath,
			[join(root, "cli.mjs"), "export", course, "--format", cliFormat, "--output", output],
			{ encoding: "utf8" },
		);
		expect(result.status, result.stderr + result.stdout).toBe(0);
		if (evidence) await writeFile(join(evidence, `${format}-cli.json`), result.stdout);
		addPackage(format, await readFile(output));
	}
	const refused = join(root, "refused");
	await mkdir(refused, { recursive: true });
	await writeFile(join(refused, "course.yaml"), "title: Refused\nlessons: [lesson.prax]\n");
	await writeFile(join(refused, "lesson.prax"), await readFile(join(fixture, "refused.txt")));
	const rejected = spawnSync(
		process.execPath,
		[
			join(root, "cli.mjs"),
			"export",
			refused,
			"--format",
			"html",
			"--output",
			join(root, "refused.zip"),
		],
		{ encoding: "utf8" },
	);
	refusal = { status: rejected.status, stdout: rejected.stdout, stderr: rejected.stderr };
	if (evidence)
		await writeFile(join(evidence, "private-group-refusal.json"), JSON.stringify(refusal, null, 2));
	const resolved = await resolveLessonSources(course);
	htmlCourseId = resolved.identity.course.courseId;
	const lessons = [...resolved.lessons.values()];
	for (const read of lessons) {
		const locale = read.frontmatter.lang ?? "en";
		privateChoiceIds[locale] = read.blocks
			.filter(
				(b) =>
					b.type === "assessment" && b.data.assessmentType === "choice" && b.data.private === true,
			)
			.map((b) => b.id);
		const blocks = adaptGrammarPreviewBlocks(read.blocks, undefined, locale);
		narration[locale] = extractNarrationSegments("", {}, blocks, {}, locale).map(
			(segment) => segment.script,
		);
	}
	if (evidence)
		await writeFile(join(evidence, "narration.json"), JSON.stringify(narration, null, 2));
	const artifact = await compileCourse(
		{
			id: courseId,
			title: "Uncertainty acceptance",
			sourceLocale: "en",
			colorMode: "auto",
			content: lessons.flatMap((read) =>
				read.pages.map((page) => ({ ...page, locale: read.frontmatter.lang })),
			),
			selfCheckContents: lessons.flatMap((read) =>
				read.blocks
					.filter((b) => b.type === "selfCheck")
					.map((b) => selfCheckContentInput(b.id, readSelfCheckContent(read, b.id))),
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
	for (const format of formats)
		for (const locale of ["en", "fr"]) {
			const entry = [...files].find(
				([path, bytes]) =>
					path.startsWith(`/${format}/`) &&
					path.endsWith(".html") &&
					bytes.includes(Buffer.from(locale === "en" ? "privateEn" : "privateFr")),
			);
			if (!entry) throw new Error(`Missing ${format} ${locale} learner page`);
			entries.set(`${format}-${locale}`, entry[0]);
		}
	await build({
		stdin: {
			resolveDir: checkout,
			contents:
				'export { LocalStorageRuntime } from "./packages/export-pipeline/src/scorm/local-storage-runtime.ts";',
		},
		outfile: join(root, "reset-owner.js"),
		bundle: true,
		format: "esm",
	});
	files.set("/reset-owner.js", await readFile(join(root, "reset-owner.js")));
	server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(path);
		res.writeHead(bytes ? 200 : 404, {
			"Content-Type": path.endsWith(".js")
				? "text/javascript"
				: path.endsWith(".css")
					? "text/css"
					: "text/html; charset=utf-8",
		});
		res.end(bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing address");
	base = `http://127.0.0.1:${address.port}`;
	const setup = { durationMs: Date.now() - startedAt, packages: formats, commandBuilds: 1 };
	await test.info().attach("shared-export-build", {
		body: JSON.stringify(setup),
		contentType: "application/json",
	});
	if (evidence) {
		await writeFile(join(evidence, "shared-build.json"), JSON.stringify(setup, null, 2));
		await cp(course, join(evidence, "published-fixture"), { recursive: true });
		for (const format of formats)
			await cp(join(root, `${format}.zip`), join(evidence, `${format}.zip`));
	}
});
function addPackage(format: string, zip: Buffer) {
	for (const entry of new AdmZip(zip).getEntries())
		if (!entry.isDirectory) files.set(`/${format}/${entry.entryName}`, entry.getData());
}
test.afterAll(async () => {
	if (server)
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	// An explicit build directory belongs to the evidence collector, who retires it.
	if (root && !process.env.PRAXITY_UNCERTAINTY_BUILD)
		await rm(root, { recursive: true, force: true });
});

// The LMS stub records every call and retains it across reload, including unload commits.
async function installLms(page: Page, format: Format) {
	await page.addInitScript(
		({ format }) => {
			if (format !== "scorm12" && format !== "scorm2004") return;
			const saved = JSON.parse(sessionStorage.getItem("uncertainty-lms") ?? "null");
			const values: Record<string, string> = saved?.values ?? {
				"cmi.core.student_id": "acceptance",
				"cmi.learner_id": "acceptance",
				"cmi.core.entry": "ab-initio",
				"cmi.entry": "ab-initio",
				"cmi.interactions._count": "0",
				"cmi.suspend_data": "",
			};
			if (saved) values[format === "scorm12" ? "cmi.core.entry" : "cmi.entry"] = "resume";
			const calls: { method: string; args: string[] }[] = saved?.calls ?? [];
			const record = (method: string, ...args: string[]) => {
				calls.push({ method, args });
				sessionStorage.setItem("uncertainty-lms", JSON.stringify({ values, calls }));
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
			]) {
				api[method] = (...args) => {
					if (method === "SetValue") {
						values[args[0]] = args[1];
						const match = /^cmi.interactions\.(\d+)\.id$/.exec(args[0]);
						if (match) values["cmi.interactions._count"] = String(Number(match[1]) + 1);
					}
					record(method, ...args);
					return method === "GetValue"
						? (values[args[0]] ?? "")
						: method === "GetLastError"
							? "0"
							: "true";
				};
			}
			Reflect.set(
				window,
				format === "scorm12" ? "API" : "API_1484_11",
				format === "scorm12"
					? Object.fromEntries(Object.entries(api).map(([key, value]) => [`LMS${key}`, value]))
					: api,
			);
		},
		{ format },
	);
}
async function open(
	page: Page,
	format: Format,
	locale: string,
	requests: RequestRecord[],
	ready = true,
) {
	await installLms(page, format);
	page.on("request", (request) => {
		if (request.method() !== "GET" || request.url().startsWith("https://lrs.example/"))
			requests.push({
				method: request.method(),
				url: request.url(),
				body: request.postData() ?? "",
			});
	});
	await page.route("https://lrs.example/**", async (route) => {
		await route.fulfill({ status: 200, body: "[]" });
	});
	const query = new URLSearchParams({
		actor: JSON.stringify(actor),
		registration: "acceptance-attempt",
	});
	await page.goto(`${base}${entries.get(`${format}-${locale}`)}?${query}`, {
		waitUntil: "domcontentloaded",
	});
	if (ready)
		await expect(
			page.locator('[data-island="assessment"]').first().getByRole("radio").first(),
		).toBeEnabled();
}
const choices = (page: Page) => page.locator('[data-island="assessment"]');
async function outgoing(page: Page, requests: RequestRecord[]) {
	const stored = await page.evaluate(() =>
		JSON.parse(sessionStorage.getItem("uncertainty-lms") ?? '{"calls":[]}'),
	);
	return { calls: stored.calls as Call[], requests: [...requests] };
}
async function privateIds(page: Page) {
	return page.locator('[data-island="assessment"]').evaluateAll((nodes) =>
		nodes.flatMap((node) => {
			const block = JSON.parse((node as HTMLElement).dataset.blockJson ?? "{}");
			return block.data?.private
				? [block.id, ...block.data.response.options.map((o: { id: string }) => o.id)]
				: [];
		}),
	);
}
function assertPrivateAbsent(bytes: unknown, ids: string[]) {
	const text = JSON.stringify(bytes);
	for (const id of ids) expect(text).not.toContain(id);
	expect(text).not.toMatch(/private[_-]/i);
}

async function expectNeutralResult(activity: Locator, locale: string, focused = true) {
	const retry = activity.locator("[data-assessment-retry]");
	if (focused) await expect(retry).toBeFocused();
	await expect(retry).toHaveAccessibleDescription(
		locale === "en" ? /You chose "I don't know"/ : /Vous avez choisi « Je ne sais pas »/,
	);
	await expect(activity.locator('[data-dont-know] [data-result="unknown"]')).toHaveText(
		locale === "en" ? 'You chose "I don\'t know"' : "Vous avez choisi « Je ne sais pas »",
	);
	await expect(activity.locator('[data-dont-know] [data-result="unknown"] svg')).toBeVisible();
}
async function expectDestination(activity: Locator, format: Format, locale: string) {
	const destination =
		locale === "en"
			? "Your answers stay in this browser and aren’t sent to the LMS."
			: "Vos réponses restent dans ce navigateur et ne sont pas envoyées au LMS.";
	const scope =
		format === "html"
			? locale === "en"
				? "Anyone using this browser may see them."
				: "Toute personne qui utilise ce navigateur peut les voir."
			: locale === "en"
				? "A new attempt starts fresh."
				: "Une nouvelle tentative repart de zéro.";
	// innerText excludes the hidden alternative scope, unlike textContent.
	expect(await activity.locator("[data-practice-mode]").innerText()).toBe(
		`${destination} ${scope}`,
	);
}
async function installRestoreProbe(page: Page) {
	await page.addInitScript(() => {
		const probe = {
			writes: [] as { method: string; key: string; value?: string }[],
			announcements: [] as string[],
			focus: [] as string[],
		};
		Reflect.set(window, "uncertaintyRestoreProbe", probe);
		const privateKey = (key: string) => key.startsWith("praxity:%5B") && key.endsWith(":state");
		const set = Storage.prototype.setItem,
			remove = Storage.prototype.removeItem;
		Storage.prototype.setItem = function (key, value) {
			if (this === localStorage && privateKey(key))
				probe.writes.push({ method: "setItem", key, value });
			return set.call(this, key, value);
		};
		Storage.prototype.removeItem = function (key) {
			if (this === localStorage && privateKey(key))
				probe.writes.push({ method: "removeItem", key });
			return remove.call(this, key);
		};
		document.addEventListener(
			"focusin",
			(event) => probe.focus.push((event.target as Element).tagName),
			true,
		);
		new MutationObserver(() => {
			for (const status of document.querySelectorAll('[role="status"]'))
				if (status.textContent?.trim()) probe.announcements.push(status.textContent);
		}).observe(document, { subtree: true, childList: true, characterData: true });
	});
}
async function expectQuietRestore(page: Page) {
	const state = await page.evaluate(() => ({
		probe: Reflect.get(window, "uncertaintyRestoreProbe"),
		statuses: [...document.querySelectorAll('[role="status"]')].map((status) => status.textContent),
		bodyFocused: document.activeElement === document.body,
	}));
	expect(state.probe).toEqual({ writes: [], announcements: [], focus: [] });
	expect(state.statuses.length).toBeGreaterThanOrEqual(2);
	expect(state.statuses.every((text) => !text)).toBe(true);
	expect(state.bodyFocused).toBe(true);
	return state;
}

for (const format of formats)
	for (const locale of ["en", "fr"]) {
		test(`${format} ${locale}: private Check, retry and restore stay off every reporting seam`, async ({
			page,
		}) => {
			const requests: RequestRecord[] = [];
			await installRestoreProbe(page);
			await open(page, format, locale, requests);
			const ids = await privateIds(page);
			expect(ids).toHaveLength(6);
			const activity = choices(page).first();
			await expect(activity.getByRole("radio").last()).toHaveAccessibleName(
				locale === "en" ? "I don't know" : "Je ne sais pas",
			);
			for (const index of [0, 2]) {
				const choice = choices(page).nth(index);
				await choice.getByRole("radio").last().focus();
				await page.keyboard.press("Space");
				await choice.locator("[data-assessment-submit]").focus();
				await page.keyboard.press("Enter");
				await expectNeutralResult(choice, locale);
			}
			await activity.locator("[data-assessment-retry]").focus();
			await page.keyboard.press("Enter");
			await expect(activity.getByRole("radio").first()).toBeFocused();
			await expect(activity.getByRole("radio").last()).not.toBeChecked();
			await page.reload({ waitUntil: "domcontentloaded" });
			await expect(activity.getByRole("radio").first()).toBeEnabled();
			await expect(choices(page).nth(2).getByRole("radio").last()).toBeChecked();
			await expect(choices(page).nth(2).getByRole("radio").last()).toBeDisabled();
			await expectNeutralResult(choices(page).nth(2), locale, false);
			await expectQuietRestore(page);
			const sent = await outgoing(page, requests);
			assertPrivateAbsent(sent, ids);
			expect(JSON.stringify(sent)).not.toContain("dont-know");
			if (evidence)
				await writeFile(
					join(evidence, `${format}-${locale}-private.json`),
					JSON.stringify(
						{ ...sent, restore: await expectQuietRestore(page), neutralResultAndDescription: true },
						null,
						2,
					),
				);
			// Ordinary reporting must also stay clean while restored private state is mounted.
			const ordinary = choices(page).nth(1);
			await ordinary.getByRole("radio").last().focus();
			await page.keyboard.press("Space");
			await ordinary.locator("[data-assessment-submit]").focus();
			await page.keyboard.press("Enter");
			await expect(ordinary.getByRole("radio").last()).toBeDisabled();
			if (format === "xapi")
				await expect
					.poll(() => requests.some((s) => s.body.includes('"response":"dont-know"')))
					.toBe(true);
			const mixed = await outgoing(page, requests);
			assertPrivateAbsent(mixed, ids);
			if (format !== "html") expect(JSON.stringify(mixed)).toContain("dont-know");
			else expect(mixed).toEqual({ calls: [], requests: [] });
			if (evidence)
				await writeFile(
					join(evidence, `${format}-${locale}-mixed.json`),
					JSON.stringify(mixed, null, 2),
				);
		});
		test(`${format} ${locale}: ordinary uncertainty is a neutral reported answer`, async ({
			page,
		}) => {
			const requests: RequestRecord[] = [];
			await open(page, format, locale, requests);
			const ids = await privateIds(page);
			const ordinary = choices(page).nth(1);
			const ordinaryBlock = await ordinary.evaluate((node) =>
				JSON.parse((node as HTMLElement).dataset.blockJson ?? "{}"),
			);
			await expect(ordinary.locator("[data-practice-mode]")).toHaveCount(0);
			await expect(ordinary.locator("[data-practice-save]")).toHaveCount(0);
			await ordinary.getByRole("radio").last().check();
			await ordinary.locator("[data-assessment-submit]").click();
			await expect(ordinary.getByRole("radio").last()).toBeDisabled();
			if (format === "xapi")
				await expect
					.poll(() => requests.some((s) => s.body.includes('"response":"dont-know"')))
					.toBe(true);
			const sent = await outgoing(page, requests);
			assertPrivateAbsent(sent, ids);
			if (format === "scorm12" || format === "scorm2004") {
				const sets = sent.calls
					.filter((call) => call.method === "SetValue")
					.map((call) => call.args);
				expect(sets).toContainEqual(["cmi.interactions.0.id", ordinaryBlock.id]);
				expect(sets).toContainEqual(["cmi.interactions.0.weighting", "0"]);
				expect(sets).toContainEqual([
					"cmi.interactions.0.type",
					format === "scorm12" ? "performance" : "choice",
				]);
				expect(sets).toContainEqual([
					`cmi.interactions.0.${format === "scorm12" ? "student_response" : "learner_response"}`,
					"dont-know",
				]);
				expect(sets).toContainEqual(["cmi.interactions.0.result", "neutral"]);
				if (format === "scorm12")
					expect(sets.some(([key]) => key.endsWith(".description"))).toBe(false);
				else
					expect(sets).toContainEqual([
						"cmi.interactions.0.description",
						`{lang=${locale}}${locale === "en" ? "Reported barrier question" : "Question transmise sur les obstacles"}`,
					]);
				for (const [key, value] of sets)
					if (key === "cmi.suspend_data") assertPrivateAbsent(JSON.parse(value), ids);
			} else if (format === "xapi") {
				const statements = requests.map((s) => JSON.parse(s.body));
				const answer = statements.find((s) => s.verb.id.endsWith("/answered"));
				expect(answer.result).toEqual({ response: "dont-know", success: false, score: { raw: 0 } });
				expect(answer.actor).toEqual(actor);
				expect(answer.object.id).toBe(
					`https://praxity.io/courses/${courseId}/interaction/${ordinaryBlock.id}`,
				);
				expect(answer.object.definition.description).toEqual({
					[locale]:
						locale === "en" ? "Reported barrier question" : "Question transmise sur les obstacles",
				});
				expect(answer.object.definition.interactionType).toBe("choice");
				expect(answer.object.definition.choices.slice(0, -1)).toEqual(
					locale === "en"
						? [
								{ id: "remove-barriers", description: { en: "Remove barriers" } },
								{ id: "blame-the-learner", description: { en: "Blame the learner" } },
							]
						: [
								{ id: "eliminer-les-obstacles", description: { fr: "Éliminer les obstacles" } },
								{ id: "blamer-la-personne", description: { fr: "Blâmer la personne" } },
							],
				);
				expect(answer.object.definition.choices.at(-1)).toEqual({
					id: "dont-know",
					description: { en: "I don't know", fr: "Je ne sais pas" },
				});
			} else expect(requests).toEqual([]);
			if (evidence)
				await writeFile(
					join(evidence, `${format}-${locale}-ordinary.json`),
					JSON.stringify(sent, null, 2),
				);
		});
	}

for (const format of formats)
	for (const locale of ["en", "fr"])
		for (const restore of ["draft", "unsupported-version", "obsolete-option"] as const)
			test(`${format} ${locale}: ${restore} restores private choices quietly with a saved self-check control`, async ({
				page,
			}) => {
				const requests: RequestRecord[] = [];
				await installRestoreProbe(page);
				await open(page, format, locale, requests);
				const ids = await privateIds(page);
				for (const index of [0, 2]) {
					await choices(page).nth(index).getByRole("radio").last().focus();
					await page.keyboard.press("Space");
				}
				const selfCheck = page.locator("[data-self-check]");
				await selfCheck.locator("textarea").fill("PRIVATE_UNCHECKED_DRAFT");
				await expect(selfCheck.locator("textarea")).toHaveValue("PRIVATE_UNCHECKED_DRAFT");
				const saved = await page.evaluate((restore) => {
					const records = Object.entries(localStorage).filter(
						([key]) => key.startsWith("praxity:%5B") && key.endsWith(":state"),
					);
					for (const [key, value] of records) {
						const state = JSON.parse(value);
						if (restore !== "draft") {
							for (const block of Object.values(state.blockState) as Record<string, unknown>[]) {
								if (block.kind !== "assessment") continue;
								if (restore === "unsupported-version") block.version = 999;
								else block.answer = ["OBSOLETE_OPTION"];
							}
							localStorage.setItem(key, JSON.stringify(state));
						}
					}
					return records.map(([key, value]) => ({ key, state: JSON.parse(value) }));
				}, restore);
				expect(saved).toHaveLength(1);
				// Positive control: all three activities really saved before reload.
				expect(Object.keys(saved[0].state.blockState)).toHaveLength(3);
				await page.reload({ waitUntil: "domcontentloaded" });
				for (const index of [0, 2]) {
					const activity = choices(page).nth(index);
					await expect(activity.getByRole("radio").last()).toBeEnabled();
					if (restore === "draft") {
						await expect(activity.getByRole("radio").last()).toBeChecked();
						await expect(activity.locator("[data-assessment-submit]")).toBeEnabled();
					} else await expect(activity.locator("input:checked")).toHaveCount(0);
					await expect(activity.locator('[data-result="unknown"]')).toHaveCount(0);
				}
				// Invalid choice envelopes do not change the self-check's separate recovery contract.
				await expect(selfCheck.locator("textarea")).toHaveValue("PRIVATE_UNCHECKED_DRAFT");
				const quiet = await expectQuietRestore(page);
				const sent = await outgoing(page, requests);
				assertPrivateAbsent(sent, ids);
				expect(JSON.stringify(sent)).not.toContain("dont-know");
				if (evidence)
					await writeFile(
						join(evidence, `${format}-${locale}-${restore}-restore.json`),
						JSON.stringify({ saved, quiet, ...sent }, null, 2),
					);
			});

for (const locale of ["en", "fr"])
	test(`html ${locale}: shuffled authored identities stay paired with labels and uncertainty remains last in DOM and narration`, async ({
		page,
	}) => {
		// Force a permutation so the assertion cannot pass on an accidentally unshuffled mount.
		await page.addInitScript(() => {
			Math.random = () => 0;
		});
		await open(page, "html", locale, []);
		const activity = choices(page).first();
		const block = await activity.evaluate((node) =>
			JSON.parse((node as HTMLElement).dataset.blockJson ?? "{}"),
		);
		expect(block.data.response.shuffle).toBe(true);
		const authored = block.data.response.options as { id: string; label: string }[];
		const displayed = await activity
			.locator(".praxity-assessment-choice-option")
			.evaluateAll((nodes) =>
				nodes.map((node) => ({
					id: (node as HTMLElement).dataset.nodeId,
					label: node.querySelector(".praxity-choice-label")?.textContent,
				})),
			);
		expect(displayed.slice(0, -1)).toEqual(
			[...authored].reverse().map(({ id, label }) => ({ id, label })),
		);
		expect(displayed.at(-1)).toEqual({
			id: "dont-know",
			label: locale === "en" ? "I don't know" : "Je ne sais pas",
		});
		const script = narration[locale].find((script) => script.includes(authored[0].label));
		expect(script?.split("\n").filter((line) => line.startsWith("- "))).toEqual([
			...authored.map(({ label }) => `- ${label}`),
			locale === "en" ? "- I don't know" : "- Je ne sais pas",
		]);
		if (evidence)
			await writeFile(
				join(evidence, `${locale}-shuffle.json`),
				JSON.stringify({ authored, displayed, script }, null, 2),
			);
	});

for (const locale of ["en", "fr"])
	test(`xapi ${locale}: old private outbox entries never replay`, async ({ page }) => {
		const privateIds = privateChoiceIds[locale];
		expect(privateIds).toHaveLength(2);
		await page.addInitScript(
			({ courseId, actor, privateIds }) => {
				const key = `praxity-xapi:${encodeURIComponent(courseId)}:${encodeURIComponent(actor.mbox)}`;
				localStorage.setItem(
					key,
					JSON.stringify({
						outbox: [...privateIds, "public-replay"].map((id) => ({
							verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
							actor,
							object: { id: `https://praxity.io/courses/${courseId}/interaction/${id}` },
							result: {
								response: id === "public-replay" ? "PUBLIC_REPLAY" : "PRIVATE_LEGACY_PICK",
								success: false,
							},
						})),
					}),
				);
			},
			{ courseId, actor, privateIds },
		);
		const requests: RequestRecord[] = [];
		await open(page, "xapi", locale, requests);
		const ordinary = choices(page).nth(1);
		await ordinary.getByRole("radio").last().check();
		await ordinary.locator("[data-assessment-submit]").click();
		await expect
			.poll(() => requests.some((s) => s.body.includes('"response":"dont-know"')))
			.toBe(true);
		expect(requests.some((s) => s.body.includes("PUBLIC_REPLAY"))).toBe(true);
		assertPrivateAbsent(requests, privateIds);
		if (evidence)
			await writeFile(
				join(evidence, `xapi-${locale}-outbox.json`),
				JSON.stringify(requests, null, 2),
			);
	});

for (const format of formats)
	for (const locale of ["en", "fr"]) {
		test(`${format} ${locale}: a failed device save is private-only and print preserves uncertainty last`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 320, height: 1600 });
			const requests: RequestRecord[] = [];
			await open(page, format, locale, requests);
			const ids = await privateIds(page);
			const activity = choices(page).first();
			await expectDestination(activity, format, locale);
			await page.evaluate(() => {
				const nativeSet = Storage.prototype.setItem;
				Storage.prototype.setItem = function (key, value) {
					if (this === localStorage) throw new DOMException("device full", "QuotaExceededError");
					return nativeSet.call(this, key, value);
				};
			});
			await activity.getByRole("radio").last().check();
			await activity.locator("[data-assessment-submit]").click();
			await expect(activity.locator("[data-practice-save]")).toBeVisible();
			await expect(activity.getByRole("status")).toContainText(
				locale === "en" ? "not saved" : "n’est pas enregistrée",
			);
			await expect(choices(page).nth(1).locator("[data-practice-save]")).toHaveCount(0);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true,
			);
			if (evidence)
				await activity.screenshot({
					path: join(evidence, `${format}-${locale}-save-failed-320.png`),
				});
			await page.emulateMedia({ media: "print" });
			await expect(activity.locator("[data-practice-mode]")).toBeHidden();
			await expect(activity.locator("[data-practice-save]")).toBeHidden();
			await expect(activity.getByRole("radio").last()).toBeChecked();
			await expect(activity.getByRole("radio").last()).toHaveAccessibleName(
				locale === "en" ? "I don't know" : "Je ne sais pas",
			);
			assertPrivateAbsent(await outgoing(page, requests), ids);
			if (evidence)
				await page.pdf({
					path: join(evidence, `${format}-${locale}-learner-print.pdf`),
					printBackground: true,
				});
		});
		test(`${format} ${locale}: self-check is a private positive control`, async ({ page }) => {
			const requests: RequestRecord[] = [];
			await open(page, format, locale, requests);
			const check = page.locator("[data-self-check]");
			await check.locator("textarea").fill("PRIVATE_SELFCHECK_ANSWER");
			await check.locator('[data-self-check-action="check"]').click();
			await check.getByRole("checkbox").check();
			await check.locator('[data-self-check-action="show-feedback"]').click();
			await expect(check.locator("[data-self-check-comparison]")).not.toBeEmpty();
			expect(JSON.stringify(await outgoing(page, requests))).not.toContain(
				"PRIVATE_SELFCHECK_ANSWER",
			);
		});
	}

for (const locale of ["en", "fr"])
	test(`${locale}: narration reads uncertainty after every authored option`, () => {
		const scripts = narration[locale].filter(
			(s) =>
				s.includes(locale === "en" ? "barrier question" : "sur les obstacles") ||
				s.includes("PRIVATE_"),
		);
		expect(scripts).toHaveLength(3);
		for (const script of scripts) {
			const options = script.split("\n").filter((line) => line.startsWith("- "));
			expect(options).toHaveLength(3);
			expect(options.at(-1)).toBe(locale === "en" ? "- I don't know" : "- Je ne sais pas");
		}
	});

test("real CLI refuses a private choice in a group at its source location", () => {
	expect(refusal.status).toBe(1);
	expect(refusal.stdout).toContain("private-choice-practice-only");
	const result = JSON.parse(refusal.stdout);
	expect(JSON.stringify(result.error)).toContain("lesson.prax");
	expect(result.error.message).toBe(
		"lesson.prax:3:1: private-choice-practice-only: A private choice must be optional, unscored, outside assessment groups and without a gate.",
	);
});

for (const locale of ["en", "fr"])
	for (const theme of ["light", "dark"] as const)
		for (const width of [1280, 320]) {
			test(`html ${locale} ${theme} ${width}: private destination line reflows with existing actions`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height: 900 });
				await page.emulateMedia({ colorScheme: theme });
				await open(page, "html", locale, []);
				await expect(page.locator("html")).toHaveAttribute("data-praxity-mode", theme);
				const activity = choices(page).first();
				if (evidence)
					await activity.screenshot({
						path: join(evidence, `${locale}-${theme}-${width}-ready.png`),
					});
				await activity.getByRole("radio").last().focus();
				await page.keyboard.press("Space");
				await activity.locator("[data-assessment-submit]").focus();
				await page.keyboard.press("Enter");
				await expectNeutralResult(activity, locale);
				await expect(activity.locator("[data-practice-save]")).toBeHidden();
				await expect(activity.getByRole("status")).toBeEmpty();
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true,
				);
				if (evidence)
					await activity.screenshot({
						path: join(evidence, `${locale}-${theme}-${width}-checked.png`),
					});
			});
		}

for (const locale of ["en", "fr"]) {
	test(`html ${locale}: no-JS baseline retains disabled uncertainty last`, async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		try {
			const page = await context.newPage();
			await page.goto(`${base}${entries.get(`html-${locale}`)}`);
			const activity = choices(page).first();
			await expect(activity.getByRole("radio").last()).toBeDisabled();
			await expect(activity.locator(".praxity-assessment-needs-script")).toBeVisible();
			await expect(activity.getByRole("radio").last()).toHaveAccessibleName(
				locale === "en" ? "I don't know" : "Je ne sais pas",
			);
			await expect(activity.locator("[data-practice-mode]")).toBeVisible();
			await expect(choices(page).nth(1).locator("[data-practice-mode]")).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
	for (const format of ["html", "scorm12", "xapi"] as const) {
		test(`${format} ${locale}: held restore is silent and disables choices`, async ({ page }) => {
			let release!: () => void;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			await page.route("**/privacy-support-*.js", async (route) => {
				await held;
				await route.continue();
			});
			const requests: RequestRecord[] = [];
			const opening = open(page, format, locale, requests);
			const activity = choices(page).first();
			await expect(activity.locator("[data-practice-restoring]")).toBeVisible();
			await expect(activity.getByRole("radio").first()).toBeDisabled();
			await expect(activity.getByRole("status")).toBeEmpty();
			release();
			await opening;
			await expect(activity.getByRole("radio").first()).toBeEnabled();
			await expect(activity.getByRole("status")).toBeEmpty();
			assertPrivateAbsent(await outgoing(page, requests), await privateIds(page));
		});
		test(`${format} ${locale}: failed privacy support announces only the first deliberate failure`, async ({
			page,
		}) => {
			await page.route("**/privacy-support-*.js", (route) => route.abort());
			const requests: RequestRecord[] = [];
			await open(page, format, locale, requests);
			const activity = choices(page).first();
			await expect(activity.locator("[data-practice-save]")).toBeVisible();
			await expect(activity.getByRole("status")).toBeEmpty();
			await activity.getByRole("radio").last().check();
			await expect(activity.getByRole("status")).not.toBeEmpty();
			await activity.getByRole("status").evaluate((status) => {
				Reflect.set(window, "privateChoiceAnnouncements", 0);
				new MutationObserver((records) =>
					Reflect.set(
						window,
						"privateChoiceAnnouncements",
						Reflect.get(window, "privateChoiceAnnouncements") + records.length,
					),
				).observe(status, { childList: true, subtree: true });
			});
			await activity.locator("[data-assessment-submit]").click();
			await expectNeutralResult(activity, locale);
			expect(await page.evaluate(() => Reflect.get(window, "privateChoiceAnnouncements"))).toBe(0);
			await expect(activity.locator("[data-practice-save]")).toBeVisible();
			assertPrivateAbsent(await outgoing(page, requests), await privateIds(page));
		});
	}
	test(`html ${locale}: local-storage owner reset clears the private envelope and attempts`, async ({
		page,
	}) => {
		await open(page, "html", locale, []);
		const activity = choices(page).first();
		await activity.getByRole("radio").last().check();
		await activity.locator("[data-assessment-submit]").click();
		await page.evaluate(async (courseId) => {
			const { LocalStorageRuntime } = await import(
				/* @vite-ignore */ `${location.origin}/reset-owner.js`
			);
			new LocalStorageRuntime(
				localStorage,
				JSON.stringify([courseId, null]),
				"default",
			).resetState();
		}, htmlCourseId);
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(activity.getByRole("radio").first()).toBeEnabled();
		await expect(activity.getByRole("radio").last()).not.toBeChecked();
		await expect(activity.getByRole("status")).toBeEmpty();
		expect(
			await activity.evaluate((node) => {
				const { id } = JSON.parse((node as HTMLElement).dataset.blockJson ?? "{}");
				return window.__praxityBlockState?.get(id);
			}),
		).toBeUndefined();
		// This exercises resetState's storage owner, not a shipped course reset action.
		expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
	});
}

for (const format of formats)
	for (const locale of ["en", "fr"])
		test(`${format} ${locale}: failed assessment island keeps the disabled private baseline`, async ({
			page,
		}) => {
			let aborted = 0;
			await installRestoreProbe(page);
			await page.route("**/island-assessment-*.js", (route) => {
				aborted++;
				return route.abort();
			});
			const requests: RequestRecord[] = [];
			await open(page, format, locale, requests, false);
			await expect.poll(() => aborted).toBeGreaterThan(0);
			await expect(page.locator("html")).toHaveAttribute("data-praxity-fallback", "");
			for (const index of [0, 2]) {
				const activity = choices(page).nth(index);
				await expect(activity.getByRole("radio").last()).toBeDisabled();
				await expect(activity.locator("[data-practice-mode]")).toBeVisible();
				await expect(activity.locator("[data-assessment-submit]")).toHaveCount(0);
			}
			await expect(choices(page).nth(1).locator("[data-practice-mode]")).toHaveCount(0);
			const quiet = await expectQuietRestore(page);
			const sent = await outgoing(page, requests);
			assertPrivateAbsent(sent, await privateIds(page));
			const baseline = await choices(page).first().locator("noscript").textContent();
			expect(baseline).toContain(
				locale === "en"
					? "Answering this question needs JavaScript."
					: "Répondre à cette question nécessite JavaScript.",
			);
			if (evidence)
				await writeFile(
					join(evidence, `${format}-${locale}-island-failed.json`),
					JSON.stringify({ aborted, quiet, baseline, ...sent }, null, 2),
				);
		});
