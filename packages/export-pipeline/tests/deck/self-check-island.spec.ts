import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { buildSync } from "esbuild";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";
import type { SCORMRuntime } from "../../src/scorm/types";
import { analyzeAxe } from "../a11y/helpers";
import { releaseSource } from "../fixtures/self-check-release";
import { attachSelfCheckEdit, instrumentSelfCheckEdit } from "./self-check-edit-evidence";

test.beforeEach(async ({ page }, info) => instrumentSelfCheckEdit(page, info));
test.afterEach(async ({ page }, info) => attachSelfCheckEdit(page, info));

let root: string, base: string, server: Server;
const entries: Record<string, string> = {};
test.beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "self-check-island-"));
	for (const locale of ["en", "fr"] as const) {
		const source = releaseSource(locale);
		const read = readLesson(
			`${source}\n${source.slice(source.indexOf("::: self-check")).replace("{required}", "{private=false}")}`,
		);
		const blocks = read.blocks.filter((block) => block.type === "selfCheck");
		const artifact = await compileCourse({
			id: `self-check-${locale}`,
			title: "Practice",
			sourceLocale: locale,
			content: read.pages,
			selfCheckContents: blocks.map((block) =>
				selfCheckContentInput(block.id, readSelfCheckContent(read, block.id)),
			),
		});
		try {
			entries[locale] = `${locale}/${artifact.manifest.pages[0].slug}.html`;
			new AdmZip((await deployCourse(artifact, { format: "html" })).zip).extractAllTo(
				join(root, locale),
			);
			for (const format of ["scorm12", "scorm2004"] as const) {
				const target = `${format}-${locale}`;
				entries[target] = `${target}/${artifact.manifest.pages[0].slug}.html`;
				new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(join(root, target));
			}
		} finally {
			await artifact.dispose();
		}
	}
	const deckRead = readLesson(
		"# Practice\n::: self-check Write a reason.\nmodel: The data was late.\n:: Reason\nmissed: Add a reason.\nevidence: The data was late.\n:::\n# Next slide\nContinue after comparing.\n",
	);
	const deckBlock = deckRead.blocks.find((block) => block.type === "selfCheck");
	if (!deckBlock) throw new Error("Missing deck activity");
	const deckArtifact = await compileCourse({
		id: "self-check-deck",
		title: "Practice",
		sourceLocale: "en",
		moduleDeck: {},
		navigationStyle: "slides",
		content: [
			{
				id: "slide-one",
				title: "Practice",
				lessonId: "module",
				lessonTitle: "Practice",
				isFirstPageOfLesson: true,
				blocks: [deckBlock],
			},
			{
				id: "slide-two",
				title: "Next slide",
				lessonId: "module",
				lessonTitle: "Practice",
				blocks: [{ id: "next-text", type: "text", data: { content: "Continue after comparing." } }],
			},
		],
		selfCheckContents: [
			selfCheckContentInput(deckBlock.id, readSelfCheckContent(deckRead, deckBlock.id)),
		],
	});
	try {
		entries.deck = `deck/${deckArtifact.manifest.pages[0].slug}.html`;
		const zip = new AdmZip((await deployCourse(deckArtifact, { format: "html" })).zip);
		zip.extractAllTo(join(root, "deck"));
		// S9 owns gate admission. Exercise S7's local contract through this bypass fixture.
		const path = join(root, entries.deck);
		const html = (await readFile(path, "utf8")).replace(
			/(<script[^>]*id="praxity-config"[^>]*>)([\s\S]*?)(<\/script>)/,
			(_, start, json, end) => {
				const config = JSON.parse(json);
				config.deckPages[0].gates = [{ id: deckBlock.id, rule: "attempt" }];
				return start + JSON.stringify(config) + end;
			},
		);
		await writeFile(path, html);
	} finally {
		await deckArtifact.dispose();
	}
	server = createServer(async (request, response) => {
		try {
			const path = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
			if (path.includes("..")) throw new Error("bad path");
			const bytes = await readFile(join(root, path));
			response.writeHead(200, {
				"Content-Type": path.endsWith(".js")
					? "text/javascript"
					: path.endsWith(".css")
						? "text/css"
						: "text/html; charset=utf-8",
			});
			response.end(bytes);
		} catch {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing server address");
	base = `http://127.0.0.1:${address.port}/`;
});
test.afterAll(async () => {
	if (server)
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	if (root) await rm(root, { recursive: true, force: true });
});

const activity = (page: Page) => page.locator("[data-self-check]").first();
const action = (page: Page, name: string) =>
	activity(page).locator(`[data-self-check-action="${name}"]`);
async function open(page: Page, locale = "en") {
	await page.goto(base + entries[locale]);
	await expect(activity(page).locator('[data-self-check-action="check"]')).toBeVisible();
	await expect(activity(page).locator("[data-self-check-comparison]")).toHaveCount(1);
}
async function checkAnswer(page: Page, answer = "The data was late. May I send it Tuesday?") {
	await activity(page).locator("textarea").fill(answer);
	await expect(action(page, "check")).toBeVisible();
	await action(page, "check").focus();
	await page.keyboard.press("Enter");
	await expect(activity(page).getByRole("checkbox").first()).toBeFocused();
}
async function submit(page: Page) {
	await action(page, "show-feedback").focus();
	await page.keyboard.press("Enter");
	await expect(activity(page).locator("[data-self-check-comparison] ol li")).toHaveCount(3);
}

for (const locale of ["en", "fr"]) {
	test(`${locale} answer description follows device and LMS save states`, async ({ page }) => {
		await open(page, locale);
		const device =
			locale === "en"
				? "Your answer stays in this browser on this device. It is not sent to the LMS."
				: "Votre réponse reste dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.";
		const savedDevice =
			locale === "en"
				? "Your answer is saved in this browser on this device. It is not sent to the LMS."
				: "Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.";
		const lms =
			locale === "en"
				? "Your answer is reported to the LMS. Drafts and comparison state may also be saved there."
				: "Votre réponse est transmise au LMS. Les brouillons et l'état de la comparaison peuvent aussi y être enregistrés.";
		const deviceCopy =
			locale === "en"
				? "Your answer and comparison are saved in this browser on this device."
				: "Votre réponse et la comparaison sont enregistrées dans ce navigateur sur cet appareil.";
		const notSavedDevice =
			locale === "en"
				? "Your answer is not saved on this device. Keep a copy before leaving this page."
				: "Votre réponse n'est pas enregistrée sur cet appareil. Gardez-en une copie avant de quitter cette page.";
		const notSavedLms =
			locale === "en"
				? "Your answer is not saved to the LMS. Keep a copy before leaving this page."
				: "Votre réponse n'est pas enregistrée dans le LMS. Gardez-en une copie avant de quitter cette page.";
		for (const destination of ["device", "lms"] as const) {
			await page.evaluate((destination) => {
				const provider = window.__praxityBlockState;
				if (!provider) throw new Error("Missing state provider");
				window.__praxityBlockState = {
					...provider,
					set() {},
					getReportingDestination: () => destination,
					getSaveResult: () => {
						const state = Reflect.get(window, "descriptionSaveState");
						return state === "saved"
							? { status: "saved", destination: "device" }
							: state === "failed"
								? { status: "not-saved", code: "storage-unavailable" }
								: { status: "not-saved", code: "identity-unavailable" };
					},
				};
			}, destination);
			for (const state of ["saved", "not-saved", "failed", "saved"] as const) {
				await page.evaluate((state) => Reflect.set(window, "descriptionSaveState", state), state);
				await activity(page).locator("textarea").fill(`${destination} ${state}`);
				const expected =
					destination === "lms"
						? `${lms} ${state === "saved" ? deviceCopy : notSavedLms}`
						: state === "saved"
							? savedDevice
							: `${device} ${notSavedDevice}`;
				await expect
					.soft(activity(page).locator("textarea"), `${destination} ${state}`)
					.toHaveAccessibleDescription(expected);
			}
		}
	});

	test(`${locale} answer description includes the unavailable comparison notice until Retry succeeds`, async ({
		page,
	}) => {
		await page.route("**/self-check-support-*.js", (route) => route.abort());
		await open(page, locale);
		await activity(page).locator("textarea").fill("Keep my draft.");
		await action(page, "check").click();
		await expect(activity(page).locator("textarea")).toHaveAccessibleDescription(
			locale === "en"
				? "Comparison is unavailable. You can still write and copy your answer. Your answer is saved in this browser on this device. It is not sent to the LMS."
				: "La comparaison n'est pas disponible. Vous pouvez encore écrire et copier votre réponse. Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.",
		);
		await page.unroute("**/self-check-support-*.js");
		await action(page, "retry").click();
		await expect(activity(page).locator("[data-self-check-notice]")).toBeHidden();
		await expect(activity(page).locator("textarea")).toHaveAccessibleDescription(
			locale === "en"
				? "Your answer is saved in this browser on this device. It is not sent to the LMS."
				: "Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.",
		);
	});

	test(`${locale} answer description follows the visible privacy notice through validation and reset`, async ({
		page,
	}) => {
		await open(page, locale);
		const answer = activity(page).locator("textarea");
		const privacy =
			locale === "en"
				? "Your answer stays in this browser on this device. It is not sent to the LMS."
				: "Votre réponse reste dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.";
		for (const root of await page.locator("[data-self-check]").all()) {
			await expect(root.locator("[data-self-check-mode]")).toBeVisible();
			await expect(root.locator("textarea")).toHaveAccessibleDescription(privacy);
		}
		await action(page, "check").click();
		await expect(answer).toHaveAccessibleDescription(
			`${privacy} ${locale === "en" ? "Write your answer first." : "Écrivez d'abord votre réponse."}`,
		);
		await answer.fill("A reason for the delay.");
		const savedPrivacy =
			locale === "en"
				? "Your answer is saved in this browser on this device. It is not sent to the LMS."
				: "Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.";
		await expect(answer).toHaveAccessibleDescription(savedPrivacy);
		await checkAnswer(page);
		await submit(page);
		await expect(answer).toHaveAccessibleDescription(savedPrivacy);
		await action(page, "start-over").click();
		await expect(answer).toBeFocused();
		await expect(answer).toHaveAccessibleDescription(savedPrivacy);
		await page.reload();
		await expect(answer).toHaveAccessibleDescription(privacy);
	});

	test(`${locale} answer description without JavaScript keeps the fallback`, async ({
		browser,
	}) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		try {
			const page = await context.newPage();
			for (const format of [locale, `scorm12-${locale}`, `scorm2004-${locale}`]) {
				await page.goto(base + entries[format]);
				for (const root of await page.locator("[data-self-check]").all()) {
					await expect(root.locator("[data-self-check-notice]")).toBeVisible();
					await expect(root.locator("textarea")).toHaveAccessibleDescription(
						locale === "en"
							? "Comparing your answer with the model requires JavaScript."
							: "La comparaison de votre réponse avec le modèle nécessite JavaScript.",
					);
				}
			}
		} finally {
			await context.close();
		}
	});
}

test("answer description survives cleanup by a replaced controls instance", async ({ page }) => {
	await open(page);
	const script = buildSync({
		stdin: {
			contents: `import { installSelfCheckControls } from "./template/src/self-check-controls";
const runtime = window.__praxitySelfCheckSession;
if (!runtime) throw new Error("Missing self-check runtime");
const root = document.createElement("div");
root.lang = "en";
root.innerHTML = '<label for="cleanup-answer">Answer</label><textarea id="cleanup-answer"></textarea><p id="cleanup-notice">Comparing your answer with the model requires JavaScript.</p><p id="cleanup-error" data-self-check-error hidden></p>';
document.body.append(root);
const answer = root.querySelector("textarea");
const notice = root.querySelector("#cleanup-notice");
const previous = installSelfCheckControls(root, answer, notice, runtime);
previous.saveStatus();
previous.cleanup();
const replacement = installSelfCheckControls(root, answer, notice, runtime);
replacement.saveStatus();
previous.cleanup();`,
			resolveDir: resolve(import.meta.dirname, "../.."),
		},
		bundle: true,
		write: false,
		format: "iife",
	}).outputFiles[0].text;
	await page.evaluate(script);
	await expect(page.locator("#cleanup-answer")).toHaveAccessibleDescription(
		"Your answer stays in this browser on this device. It is not sent to the LMS.",
	);
});

test("lifecycle: provider replacement cancels held admission and rebinds mounted controls", async ({
	page,
}) => {
	await open(page);
	await checkAnswer(page, "Original submitted answer");
	await submit(page);
	let release!: () => void, requested!: () => void;
	const barrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	const request = new Promise<void>((resolve) => {
		requested = resolve;
	});
	await page.route("**/self-check/*.js", async (route) => {
		requested();
		await barrier;
		await route.continue();
	});
	await page.reload({ waitUntil: "domcontentloaded" });
	await request;
	const cancelled = await page.evaluate(() => {
		const old = window.__praxitySelfCheckSession;
		const values = new Map<string, ReturnType<NonNullable<Window["__praxityBlockState"]>["get"]>>();
		const root = document.querySelector<HTMLElement>("[data-self-check]");
		if (!root || !old) throw new Error("Missing runtime");
		const id = root.dataset.selfCheckId ?? "";
		values.set(id, {
			version: 1,
			kind: "self-check",
			draft: { answer: "Replacement provider draft", ticked: [], shown: false },
			submitted: null,
		});
		window.__praxityBlockState = {
			get: (key) => values.get(key),
			set: (key, value) => {
				values.set(key, value);
			},
			getPolicy: () => "lms",
			getSaveResult: () => ({ status: "saved", destination: "lms" }),
		};
		return old.session.read(id)?.outcome;
	});
	// Replacement itself cancels, without calling an island API or manually disposing.
	expect(cancelled).toBe("cancelled");
	release();
	await page.evaluate(() => window.__praxitySelfCheckSession?.session.ready);
	await expect(activity(page).locator("textarea")).toHaveValue("Replacement provider draft");
	await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
	await action(page, "check").click();
	await expect(activity(page).getByRole("checkbox")).toHaveCount(3);
	await submit(page);
	await expect(activity(page).locator("[data-self-check-comparison]")).toContainText(
		"Replacement provider draft",
	);
	const saved = await page.evaluate(() =>
		window.__praxityBlockState?.get(
			document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "",
		),
	);
	expect(saved).toMatchObject({ submitted: { answer: "Replacement provider draft" } });
	await page.unroute("**/self-check/*.js");
	// Repeat after mounting: old comparison and handlers must leave with their session.
	await page.evaluate(() => {
		const provider = window.__praxityBlockState;
		window.__praxityBlockState = { ...provider, get: () => undefined, set() {} };
	});
	await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
	await checkAnswer(page, "Answer for the third provider");
	await submit(page);
	await expect(activity(page).locator("[data-self-check-comparison]")).toContainText(
		"Answer for the third provider",
	);
});

test("lifecycle: scoped cleanup releases its own mounts and cannot cancel siblings or a replacement", async ({
	page,
}) => {
	await open(page);
	await checkAnswer(page, "Original submitted answer");
	await submit(page);
	await page.evaluate(async () => {
		const entry = document.documentElement.getAttribute("data-island-self-check") ?? "";
		const module = await import(new URL(entry, document.baseURI).href);
		const roots = document.querySelectorAll<HTMLElement>("[data-self-check]");
		const cleanup = module.initSelfCheckEnhancements(roots[1].parentElement);
		cleanup();
		cleanup();
	});
	await activity(page).locator("textarea").fill("New edit after sibling cleanup");
	expect(
		await page.evaluate(() =>
			window.__praxityBlockState?.get(
				document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "",
			),
		),
	).toMatchObject({
		draft: { answer: "New edit after sibling cleanup" },
		submitted: { answer: "Original submitted answer" },
	});
	const outcome = await page.evaluate(async () => {
		const module = await import(
			new URL(
				document.documentElement.getAttribute("data-island-self-check") ?? "",
				document.baseURI,
			).href
		);
		const cleanup = module.initSelfCheckEnhancements();
		const provider = window.__praxityBlockState;
		window.__praxityBlockState = { ...provider, get: () => undefined, set() {} };
		cleanup();
		return window.__praxitySelfCheckSession?.session.read(
			document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "",
		)?.outcome;
	});
	expect(outcome).toBe("empty");
	await checkAnswer(page, "Still mounted after old cleanup");
});

test("lifecycle: final consumer disposes only its own document session", async ({ page }) => {
	await open(page);
	const outcomes = await page.evaluate(async () => {
		const module = await import(
			new URL(
				document.documentElement.getAttribute("data-island-self-check") ?? "",
				document.baseURI,
			).href
		);
		module.disposeSelfCheckDocument();
		const a = module.initSelfCheckEnhancements();
		const b = module.initSelfCheckEnhancements();
		const first = window.__praxitySelfCheckSession;
		const id = document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "";
		a();
		const sibling = first?.session.read(id)?.outcome;
		b();
		const final = first?.session.read(id)?.outcome;
		const c = module.initSelfCheckEnhancements();
		const successor = window.__praxitySelfCheckSession;
		a();
		b();
		const afterOldCleanup = successor?.session.read(id)?.outcome;
		module.disposeSelfCheckDocument();
		module.initSelfCheckEnhancements();
		c();
		return [
			sibling,
			final,
			afterOldCleanup,
			window.__praxitySelfCheckSession?.session.read(id)?.outcome,
		];
	});
	expect(outcomes).toEqual(["empty", "cancelled", "empty", "empty"]);
	await checkAnswer(page, "New document owner remains usable");
});

test("lifecycle: completion listeners re-enter the registered document without another session", async ({
	page,
}) => {
	await open(page);
	const result = await page.evaluate(async () => {
		const module = await import(
			new URL(
				document.documentElement.getAttribute("data-island-self-check") ?? "",
				document.baseURI,
			).href
		);
		module.disposeSelfCheckDocument();
		let writes = 0;
		window.__praxityBlockState = {
			get: () => undefined,
			set: () => {
				++writes;
			},
		};
		const root = document.querySelector<HTMLElement>("[data-self-check]");
		if (!root) throw new Error("Missing activity");
		let asset: Promise<unknown> | undefined;
		document.addEventListener(
			"praxity:self-check-completion",
			() => {
				asset = module.loadSelfCheckAsset(
					{
						blockId: root.dataset.selfCheckId ?? "",
						contentRevision: root.dataset.selfCheckRevision ?? "",
						path: root.dataset.selfCheckSrc ?? "",
					},
					document,
				);
			},
			{ once: true },
		);
		module.initSelfCheckEnhancements();
		await window.__praxitySelfCheckSession?.session.ready;
		await asset;
		const answer = root.querySelector("textarea");
		if (!answer) throw new Error("Missing answer");
		answer.value = "Reentrant edit";
		answer.dispatchEvent(new Event("input", { bubbles: true }));
		return {
			writes,
			joined: window.__praxitySelfCheckDocument?.current === window.__praxitySelfCheckSession,
		};
	});
	expect(result).toEqual({ writes: 1, joined: true });
});

test("lifecycle: concurrent ESM consumers share one implementation, controls and response", async ({
	page,
}) => {
	await page.route("**/island-loader-*.js", (route) => route.abort());
	await page.goto(base + entries.en);
	const same = await page.evaluate(async () => {
		const url = new URL(
			document.documentElement.getAttribute("data-island-self-check") ?? "",
			document.baseURI,
		).href;
		const [a, b] = await Promise.all([import(`${url}?consumer=a`), import(`${url}?consumer=b`)]);
		// Import caches code. Each current consumer explicitly attaches its scope.
		a.initSelfCheckEnhancements();
		b.initSelfCheckEnhancements();
		return a.initSelfCheckEnhancements === b.initSelfCheckEnhancements;
	});
	expect(same).toBe(true);
	for (const selector of [
		"[data-self-check-action=retry]",
		"[data-self-check-recovery]",
		"[data-self-check-comparison]",
	])
		await expect(activity(page).locator(selector)).toHaveCount(1);
	await page.evaluate(() => {
		const provider = window.__praxityBlockState;
		window.__praxityBlockState = {
			...provider,
			get: () => undefined,
			set() {},
			getPolicy: () => "lms",
		};
		Reflect.set(window, "lifecycleResponses", []);
		Reflect.set(window, "lifecycleInteractions", []);
		document.addEventListener("praxity:assessment-response", (event) =>
			Reflect.get(window, "lifecycleResponses").push((event as CustomEvent).detail),
		);
		document.addEventListener("praxity:block-interaction", (event) =>
			Reflect.get(window, "lifecycleInteractions").push((event as CustomEvent).detail),
		);
	});
	const reported = page.locator("[data-self-check]").nth(1);
	await reported.locator("textarea").fill("One response per action");
	await reported.locator('[data-self-check-action="check"]').click();
	await expect(reported.getByRole("checkbox")).toHaveCount(3);
	await reported.locator('[data-self-check-action="show-feedback"]').click();
	await expect(reported.locator("[data-self-check-comparison] ol li")).toHaveCount(3);
	expect(
		await page.evaluate(() => [
			Reflect.get(window, "lifecycleResponses").length,
			Reflect.get(window, "lifecycleInteractions").length,
		]),
	).toEqual([1, 1]);
});

for (const wrongGlobal of [false, true]) {
	test(`lifecycle: bridge ignores another build's document attribute and global ${wrongGlobal}`, async ({
		page,
	}) => {
		await page.route("**/island-loader-*.js", (route) => route.abort());
		const wrongRequests: string[] = [];
		await page.route("**/island-self-check-OLD12345.classic.js", (route) => {
			wrongRequests.push(route.request().url());
			return route.fulfill({
				contentType: "text/javascript",
				body: 'window.PraxitySelfCheckIsland={initSelfCheckEnhancements:()=>"wrong-build",loadSelfCheckAsset:()=>"wrong-build"};',
			});
		});
		await page.goto(base + entries.en);
		const accepted = await page.evaluate(async (preload) => {
			const entry = document.documentElement.getAttribute("data-island-self-check") ?? "";
			document.documentElement.setAttribute(
				"data-island-self-check",
				"island-self-check-OLD12345.js",
			);
			if (preload)
				Reflect.set(window, "PraxitySelfCheckIsland", {
					build: "old-build",
					initSelfCheckEnhancements: () => "wrong-build",
					loadSelfCheckAsset: () => "wrong-build",
				});
			const module = await import(new URL(entry, document.baseURI).href);
			return typeof module.initSelfCheckEnhancements();
		}, wrongGlobal);
		expect(accepted).toBe("function");
		expect(wrongRequests).toEqual([]);
		await checkAnswer(page);
	});
}
async function remount(page: Page, revision?: string, failedSave = false) {
	await page.evaluate(
		async ({ revision, failedSave }) => {
			const module = await import(
				new URL(
					document.documentElement.getAttribute("data-island-self-check") ?? "",
					document.baseURI,
				).href
			);
			module.disposeSelfCheckDocument();
			const provider = window.__praxityBlockState;
			if (provider && (revision || failedSave))
				window.__praxityBlockState = {
					...provider,
					get(id: string) {
						const state = structuredClone(provider.get(id)) as {
							submitted?: { contentRevision: string };
						};
						if (revision && state?.submitted) state.submitted.contentRevision = revision;
						return state;
					},
					getSaveResult: failedSave
						? () => ({ status: "not-saved", code: "storage-unavailable" })
						: provider.getSaveResult,
				};
			module.initSelfCheckEnhancements();
			module.initSelfCheckEnhancements();
		},
		{ revision, failedSave },
	);
}

for (const locale of ["en", "fr"]) {
	test(`learner print preserves revealed content and readable drafts in ${locale}`, async ({
		page,
	}) => {
		await open(page, locale);
		const root = activity(page);
		const answer = root.locator("textarea");
		const printAnswer = root.locator("[data-self-check-print-answer]");
		const text = Array.from(
			{ length: 30 },
			(_, n) => `Line ${n}: <script>literal</script> & ${"answer ".repeat(15)}`,
		).join("\n");
		const print = async () => {
			const partsRevealed = await root.locator("[data-self-check-parts]").isVisible();
			const before = await page.evaluate(() => ({
				storage: { ...localStorage },
				focus: document.activeElement?.id,
				visibleState: document.querySelector("[data-self-check]")?.outerHTML,
				completed: document
					.querySelector('[data-block-type="selfCheck"]')
					?.getAttribute("data-completed"),
				attempted: document
					.querySelector('[data-block-type="selfCheck"]')
					?.getAttribute("data-attempted"),
			}));
			await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
			await page.emulateMedia({ media: "print" });
			await expect(printAnswer).toHaveText(await answer.inputValue());
			expect(
				await printAnswer.evaluate((node) => ({
					whiteSpace: getComputedStyle(node).whiteSpace,
					overflowWrap: getComputedStyle(node).overflowWrap,
					overflow: getComputedStyle(node).overflow,
					clipped: node.scrollHeight > node.clientHeight,
				})),
			).toEqual({
				whiteSpace: "pre-wrap",
				overflowWrap: "anywhere",
				overflow: "visible",
				clipped: false,
			});
			await expect(answer).toBeHidden();
			await expect(root.locator("button:visible")).toHaveCount(0);
			await expect(root.locator("input:visible")).toHaveCount(0);
			if (partsRevealed) {
				await expect(root.locator("[data-self-check-parts]")).toBeVisible();
				for (const label of await root.locator("[data-self-check-parts] label").all())
					await expect(label).toBeVisible();
			} else await expect(root.locator("[data-self-check-parts]")).toBeHidden();
			await expect(root.locator('[role="status"]')).toBeHidden();
			await expect(root.locator("[data-self-check-count]:visible")).toHaveCount(0);
			await expect(root.locator("[data-self-check-mode]")).toBeHidden();
			await expect(root.locator("[data-self-check-save]")).toBeHidden();
			await expect(root.locator("script")).toHaveCount(0);
			await page.emulateMedia({ media: "screen" });
			await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
			await expect(printAnswer).toBeHidden();
			await expect(printAnswer).toHaveText("");
			expect(
				await page.evaluate(() => ({
					storage: { ...localStorage },
					focus: document.activeElement?.id,
					visibleState: document.querySelector("[data-self-check]")?.outerHTML,
					completed: document
						.querySelector('[data-block-type="selfCheck"]')
						?.getAttribute("data-completed"),
					attempted: document
						.querySelector('[data-block-type="selfCheck"]')
						?.getAttribute("data-attempted"),
				})),
			).toEqual(before);
		};
		await answer.fill(text);
		await print();
		await expect(root.getByRole("checkbox")).toHaveCount(0);
		await expect(root.locator("[data-self-check-comparison]")).toBeEmpty();
		await action(page, "check").click();
		await expect(root.getByRole("checkbox").first()).toBeFocused();
		await print();
		await expect(root.getByRole("checkbox")).toHaveCount(3);
		await expect(root.locator("[data-self-check-comparison]")).toBeEmpty();
		await submit(page);
		await answer.fill("Revised draft\nAnother line");
		await print();
		await expect(root.locator("[data-self-check-comparison]")).toContainText(text);
		await expect(root.locator("[data-self-check-comparison] ol li")).toHaveCount(3);
		await action(page, "start-over").click();
		await print();
		await expect(root.locator("[data-self-check-comparison]")).toBeEmpty();
	});
}

test("the classic file island completes and restores the same comparison", async ({ page }) => {
	await page.goto(pathToFileURL(join(root, entries.en)).href);
	await expect(action(page, "check")).toBeVisible();
	await checkAnswer(page);
	await submit(page);
	await expect(activity(page).locator("[data-self-check-comparison]")).toContainText(
		"Could I send the report on",
	);
	await page.reload();
	await expect(activity(page).locator("[data-self-check-comparison] ol li")).toHaveCount(3);
	await expect(activity(page).getByRole("status")).toHaveText("");
});

test("empty Check associates a visible error, focuses the answer and writes no status", async ({
	page,
}) => {
	await open(page);
	await action(page, "check").focus();
	await page.keyboard.press("Enter");
	const answer = activity(page).locator("textarea");
	await expect(answer).toBeFocused();
	await expect(answer).toHaveAttribute("aria-invalid", "true");
	await expect(activity(page).getByText("Write your answer first.", { exact: true })).toBeVisible();
	await expect(answer).toHaveAttribute("aria-describedby", /-error/);
	await expect(activity(page).getByRole("status")).toHaveText("");
});

test("fresh typing and empty Check do not load comparison support; failed support keeps the draft", async ({
	page,
}) => {
	const requests: string[] = [];
	page.on("request", (request) => requests.push(request.url()));
	await page.route("**/self-check-support-*.js", (route) => route.abort());
	await open(page);
	await expect(action(page, "start-over")).toBeHidden();
	await action(page, "check").click();
	await expect(activity(page).locator("textarea")).toBeFocused();
	await activity(page).locator("textarea").fill("Keep my draft.");
	await expect(activity(page).locator("[data-self-check-mode]")).toContainText(
		"Your answer is saved",
	);
	expect(requests.filter((url) => /self-check-support-|\/self-check\//.test(url))).toEqual([]);
	await action(page, "check").click();
	await expect(activity(page).locator("[data-self-check-notice]")).toContainText(
		"Comparison is unavailable.",
	);
	await expect(activity(page).locator("textarea")).toHaveValue("Keep my draft.");
	await expect(activity(page).getByRole("checkbox")).toHaveCount(0);
	await expect(action(page, "start-over")).toBeVisible();
	await page.reload();
	await expect(activity(page).locator("[data-self-check-notice]")).toContainText(
		"Comparison is unavailable.",
	);
	await expect(activity(page).locator("textarea")).toHaveValue("Keep my draft.");
	await expect(action(page, "start-over")).toBeVisible();
});

for (const failure of ["asset", "support"] as const) {
	for (const failedSave of [false, true]) {
		test(`Start over after ${failure} failure ${failedSave ? "reports a failed save" : "clears the saved comparison"}`, async ({
			page,
		}) => {
			await open(page);
			await checkAnswer(page, "The submitted answer.");
			await page.keyboard.press("Space");
			await submit(page);
			const path = failure === "asset" ? "**/self-check/*.js" : "**/self-check-support-*.js";
			await page.route(path, (route) => route.abort());
			await page.reload();
			await expect(activity(page).locator("[data-self-check-notice]")).toContainText(
				"Comparison is unavailable.",
			);
			await expect(action(page, "start-over")).toBeVisible();
			await expect(action(page, "show-feedback")).toBeHidden();
			await expect(activity(page).getByRole("checkbox")).toHaveCount(0);
			if (failedSave)
				await page.evaluate(() => {
					const provider = window.__praxityBlockState;
					if (!provider) throw new Error("Missing state provider");
					window.__praxityBlockState = {
						...provider,
						set() {},
						getSaveResult: () => ({ status: "not-saved", code: "storage-unavailable" }),
					};
				});
			await action(page, "start-over").focus();
			await page.keyboard.press("Enter");
			await expect(activity(page).locator("textarea")).toHaveValue("");
			await expect(activity(page).locator("textarea")).toBeFocused();
			await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
			await expect(page.locator('[data-block-type="selfCheck"]').first()).not.toHaveAttribute(
				"data-completed",
			);
			await expect(action(page, "start-over")).toBeHidden();
			if (failedSave) {
				await expect(activity(page).locator("[data-self-check-mode]")).not.toContainText(
					"Your answer is saved",
				);
				await expect(activity(page).locator("[data-self-check-save]")).toHaveText(
					"Your answer is not saved on this device. Keep a copy before leaving this page.",
				);
			} else {
				const state = await page.evaluate(
					(id) => window.__praxityBlockState?.get(id),
					(await activity(page).getAttribute("data-self-check-id")) ?? "",
				);
				expect(state).toEqual({
					version: 1,
					kind: "self-check",
					draft: { answer: "", ticked: [], shown: false },
					submitted: null,
				});
				await page.unroute(path);
				await page.reload();
				await expect(activity(page).locator("textarea")).toHaveValue("");
				await expect(page.locator('[data-block-type="selfCheck"]').first()).toHaveAttribute(
					"data-hydrated",
					"",
				);
				await expect(page.locator('[data-block-type="selfCheck"]').first()).not.toHaveAttribute(
					"data-completed",
				);
				await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
				await expect(activity(page).getByRole("checkbox")).toHaveCount(0);
				await expect(action(page, "show-feedback")).toBeHidden();
				await checkAnswer(page, "A fresh answer.");
				await expect(activity(page).getByRole("checkbox").first()).not.toBeChecked();
			}
		});
	}
	for (const submitted of [false, true]) {
		test(`edits survive ${failure} failure with ${submitted ? "a submitted comparison" : "a draft"}`, async ({
			page,
		}) => {
			await open(page);
			if (submitted) {
				await checkAnswer(page, "The submitted answer.");
				await page.keyboard.press("Space");
				await submit(page);
			} else {
				await activity(page).locator("textarea").fill("The first draft.");
			}
			const path = failure === "asset" ? "**/self-check/*.js" : "**/self-check-support-*.js";
			await page.route(path, (route) => route.abort());
			if (submitted || failure === "support") await page.reload();
			if (!submitted && failure === "asset") await action(page, "check").click();
			await expect(activity(page).locator("[data-self-check-notice]")).toContainText(
				"Comparison is unavailable.",
			);
			await activity(page).locator("textarea").fill("The revised draft after the failure.");
			await expect(activity(page).locator("[data-self-check-mode]")).toContainText(
				"Your answer is saved",
			);
			await expect(activity(page).locator("[data-self-check-save]")).toHaveText("");
			await page.reload();
			await expect(activity(page).locator("[data-self-check-notice]")).toContainText(
				"Comparison is unavailable.",
			);
			await expect(activity(page).locator("textarea")).toHaveValue(
				"The revised draft after the failure.",
			);
			await page.unroute(path);
			await page.reload();
			await expect(activity(page).locator("textarea")).toHaveValue(
				"The revised draft after the failure.",
			);
			if (submitted) {
				await expect(activity(page).locator("[data-self-check-comparison-title]")).toHaveText(
					"Previous comparison",
				);
				await expect(activity(page).locator("[data-self-check-comparison]")).toContainText(
					"The submitted answer.",
				);
				await expect(activity(page).getByRole("checkbox").first()).toBeChecked();
			} else await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
		});
	}
}

test("Start over cancels a pending saved comparison restore", async ({ page }) => {
	await open(page);
	await checkAnswer(page);
	await page.keyboard.press("Space");
	await submit(page);
	await action(page, "start-over").focus();
	let release!: () => void, requested!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const request = new Promise<void>((resolve) => {
		requested = resolve;
	});
	await page.route("**/self-check/*.js", async (route) => {
		requested();
		await pending;
		await route.continue();
	});
	await remount(page);
	await request;
	await expect(action(page, "start-over")).toBeVisible();
	await action(page, "start-over").focus();
	await page.keyboard.press("Enter");
	release();
	await page.waitForLoadState("networkidle");
	await expect(activity(page).locator("textarea")).toHaveValue("");
	await expect(activity(page).locator("textarea")).toBeFocused();
	await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
	await expect(activity(page).getByRole("checkbox")).toHaveCount(0);
	await expect(action(page, "show-feedback")).toBeHidden();
	await expect(page.locator('[data-block-type="selfCheck"]').first()).not.toHaveAttribute(
		"data-completed",
	);
	await page.unroute("**/self-check/*.js");
	await page.reload();
	await expect(activity(page).locator("textarea")).toHaveValue("");
	await expect(page.locator('[data-block-type="selfCheck"]').first()).toHaveAttribute(
		"data-hydrated",
		"",
	);
	await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
});

test("a failed draft write immediately replaces the earlier saved notice after asset failure", async ({
	page,
}) => {
	await page.route("**/self-check/*.js", (route) => route.abort());
	await open(page);
	await activity(page).locator("textarea").fill("The saved draft.");
	await action(page, "check").click();
	await expect(activity(page).locator("[data-self-check-notice]")).toContainText(
		"Comparison is unavailable.",
	);
	await page.evaluate(() => {
		const provider = window.__praxityBlockState;
		if (!provider) throw new Error("Missing state provider");
		window.__praxityBlockState = {
			...provider,
			set() {},
			getSaveResult: () => ({ status: "not-saved", code: "storage-unavailable" }),
		};
	});
	await activity(page).locator("textarea").fill("This edit cannot be saved.");
	await expect(activity(page).locator("[data-self-check-mode]")).not.toContainText(
		"Your answer is saved",
	);
	await expect(activity(page).locator("[data-self-check-save]")).toHaveText(
		"Your answer is not saved on this device. Keep a copy before leaving this page.",
	);
	await page.reload();
	await expect(activity(page).locator("textarea")).toHaveValue("The saved draft.");
});

test("Check validates the current answer again after the activity request", async ({ page }) => {
	await open(page);
	let release!: () => void, requested!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const request = new Promise<void>((resolve) => {
		requested = resolve;
	});
	await page.route("**/self-check/*.js", async (route) => {
		requested();
		await pending;
		await route.continue();
	});
	await activity(page).locator("textarea").fill("A valid answer.");
	await action(page, "check").click();
	await request;
	await activity(page).locator("textarea").fill(" ");
	release();
	const answer = activity(page).locator("textarea");
	await expect(answer).toHaveAttribute("aria-invalid", "true");
	await expect(answer).toBeFocused();
	await expect(activity(page).getByText("Write your answer first.", { exact: true })).toBeVisible();
	await expect(answer).toHaveAttribute("aria-describedby", /-error/);
	await expect(activity(page).getByRole("checkbox")).toHaveCount(0);
	await expect(action(page, "show-feedback")).toBeHidden();
	await expect(activity(page).getByRole("status")).toHaveText("");
	await page.reload();
	await expect(answer).toHaveValue(" ");
});

test("keyboard feedback allows zero ticks, announces once, keeps focus, and isolates siblings", async ({
	page,
}) => {
	await open(page);
	await checkAnswer(page);
	await expect(activity(page).locator("[data-self-check-count]")).toHaveText("0 of 3 selected");
	await expect(action(page, "start-over")).toBeVisible();
	await expect(activity(page).getByRole("status")).toHaveText("");
	await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
	await page.evaluate(() => {
		Reflect.set(window, "summaryWrites", 0);
		Reflect.set(window, "responses", []);
		const status = document.querySelector("[data-self-check-status]");
		if (status)
			new MutationObserver((records) =>
				Reflect.set(window, "summaryWrites", Reflect.get(window, "summaryWrites") + records.length),
			).observe(status, { childList: true });
		document.addEventListener("praxity:assessment-response", (event) =>
			Reflect.get(window, "responses").push((event as CustomEvent).detail),
		);
	});
	await submit(page);
	await expect(action(page, "show-feedback")).toBeFocused();
	await expect(activity(page).getByRole("status")).toHaveText("You included 0 of 3 parts.");
	expect(await page.evaluate(() => Reflect.get(window, "summaryWrites"))).toBe(1);
	expect(await page.evaluate(() => Reflect.get(window, "responses"))).toEqual([]);
	await expect(activity(page).locator("mark sup")).toHaveText([" [1]", " [2]"]);
	await expect(
		activity(page).getByText("Explain what caused the delay.", { exact: true }),
	).toBeVisible();
	await expect(page.locator("[data-self-check]").nth(1).getByRole("checkbox")).toHaveCount(0);
	await expect(page.locator('[data-block-type="selfCheck"]').first()).toHaveAttribute(
		"data-completed",
		"true",
	);
	await expect(page.locator('[data-block-type="selfCheck"]').nth(1)).not.toHaveAttribute(
		"data-completed",
	);
});

test("editing preserves the previous snapshot; Show replaces it; Start over clears state and focus", async ({
	page,
}) => {
	await open(page);
	await checkAnswer(page);
	await submit(page);
	await expect(activity(page).locator("[data-self-check-part-state]")).toHaveText([
		"To add",
		"To add",
		"To add",
	]);
	await expect(activity(page).locator("[data-self-check-parts-label] strong")).toHaveText(
		"The parts",
	);
	await activity(page).locator("textarea").fill("A revised answer.");
	await activity(page).getByRole("checkbox").first().focus();
	await page.keyboard.press("Space");
	await expect(activity(page).locator("[data-self-check-comparison-title]")).toHaveText(
		"Previous comparison",
	);
	await expect(activity(page).locator("[data-self-check-comparison]")).toContainText(
		"The data was late.",
	);
	await expect(activity(page).getByRole("status")).toHaveText("You included 0 of 3 parts.");
	await submit(page);
	await expect(activity(page).locator("[data-self-check-comparison-title]")).toHaveText(
		"Comparison",
	);
	await expect(activity(page).locator("[data-self-check-comparison]")).toContainText(
		"A revised answer.",
	);
	await action(page, "start-over").focus();
	await page.keyboard.press("Enter");
	await expect(activity(page).locator("textarea")).toBeFocused();
	await expect(activity(page).locator("textarea")).toHaveValue("");
	await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
	await expect(activity(page).getByRole("checkbox").first()).toBeHidden();
	await expect(action(page, "start-over")).toBeHidden();
	await expect(page.locator('[data-block-type="selfCheck"]').first()).not.toHaveAttribute(
		"data-completed",
	);
	await page.reload();
	await expect(activity(page).locator("textarea")).toHaveValue("");
});

for (const locale of ["en", "fr"])
	test(`${locale} submitted restore and remount are silent and do not duplicate handlers`, async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Reflect.set(window, "restoreResponses", 0);
			document.addEventListener("praxity:assessment-response", () =>
				Reflect.set(window, "restoreResponses", Reflect.get(window, "restoreResponses") + 1),
			);
		});
		await open(page, locale);
		const restoredPrivacy =
			locale === "en"
				? "Your answer stays in this browser on this device. It is not sent to the LMS."
				: "Votre réponse reste dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.";
		await checkAnswer(page);
		await page.keyboard.press("Space");
		await submit(page);
		await page.reload();
		await expect(activity(page).locator("[data-self-check-comparison] ol li")).toHaveCount(3);
		await expect(activity(page).getByRole("status")).toHaveText("");
		await expect(activity(page).locator("textarea")).not.toBeFocused();
		await expect(activity(page).getByRole("checkbox").first()).toBeChecked();
		expect(await page.evaluate(() => Reflect.get(window, "restoreResponses"))).toBe(0);
		for (const root of await page.locator("[data-self-check]").all())
			await expect(root.locator("textarea")).toHaveAccessibleDescription(restoredPrivacy);
		await remount(page);
		await expect(activity(page).getByRole("checkbox").first()).toBeChecked();
		await expect(activity(page).locator("[data-self-check-comparison] ol li")).toHaveCount(3);
		await expect(activity(page).getByRole("status")).toHaveText("");
		expect(await page.evaluate(() => Reflect.get(window, "restoreResponses"))).toBe(0);
		for (const root of await page.locator("[data-self-check]").all())
			await expect(root.locator("textarea")).toHaveAccessibleDescription(restoredPrivacy);
		expect(
			await page.locator("[data-self-check]").evaluateAll((roots) => {
				const ids = roots.flatMap((root) =>
					[...root.querySelectorAll("[id]")].map((node) => node.id),
				);
				return (
					new Set(ids).size === ids.length &&
					roots.every((root) => {
						const refs =
							root.querySelector("textarea")?.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
						return (
							refs.length > 0 && refs.every((id) => root.contains(document.getElementById(id)))
						);
					})
				);
			}),
		).toBe(true);
		await page.evaluate(() => {
			Reflect.set(window, "completions", 0);
			document.addEventListener("praxity:self-check-completion", () =>
				Reflect.set(window, "completions", Reflect.get(window, "completions") + 1),
			);
		});
		await submit(page);
		expect(await page.evaluate(() => Reflect.get(window, "completions"))).toBe(1);
		await action(page, "start-over").click();
		await expect(activity(page).locator("textarea")).toBeFocused();
		await expect(activity(page).locator("textarea")).toHaveAccessibleDescription(
			locale === "en"
				? "Your answer is saved in this browser on this device. It is not sent to the LMS."
				: "Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.",
		);
	});

test("out-of-date restore shows the draft, a recovery notice and no completion", async ({
	page,
}) => {
	await open(page);
	await checkAnswer(page);
	await submit(page);
	await remount(page, `sha256:${"0".repeat(64)}`);
	await expect(activity(page).locator("[data-self-check-recovery]")).toContainText(
		"The activity changed since your last comparison.",
	);
	await expect(activity(page).locator("textarea")).toHaveValue(
		"The data was late. May I send it Tuesday?",
	);
	await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
	await expect(activity(page).getByRole("status")).toHaveText("");
	await expect(page.locator('[data-block-type="selfCheck"]').first()).not.toHaveAttribute(
		"data-completed",
	);
});

test("typing while restore support loads preserves an emptied draft and the previous comparison", async ({
	page,
}) => {
	await open(page);
	await checkAnswer(page);
	await page.keyboard.press("Space");
	await submit(page);
	await page.route("**/self-check-support-*.js", async (route) => {
		await activity(page).locator("textarea").fill("");
		await route.continue();
	});
	await page.reload();
	await expect(activity(page).locator("[data-self-check-comparison-title]")).toHaveText(
		"Previous comparison",
	);
	await expect(activity(page).locator("textarea")).toHaveValue("");
	await expect(activity(page).getByRole("checkbox").first()).toBeChecked();
	await expect(activity(page).getByRole("status")).toHaveText("");
	await expect(activity(page).locator("[data-self-check-part-state]")).toHaveText([
		"Included",
		"To add",
		"To add",
	]);
});

test("private deck completion releases locally, restores and resets without suspend flags", async ({
	page,
}) => {
	await open(page, "deck");
	const next = async () => {
		await page.locator("#deck-next").focus();
		await page.keyboard.press("Enter");
	};
	await next();
	await expect(page.locator('[data-deck-slide="slide-one"]')).toBeVisible();
	await expect(page.locator('[data-deck-slide="slide-two"]')).toBeHidden();
	await checkAnswer(page);
	await action(page, "show-feedback").focus();
	await page.keyboard.press("Enter");
	await next();
	await expect(page.locator('[data-deck-slide="slide-two"]')).toBeVisible();
	const released = () =>
		page.evaluate(() => {
			const runtime = Reflect.get(window, "__praxityRuntime") as SCORMRuntime | undefined;
			if (!runtime) throw new Error("Missing deck runtime");
			return JSON.parse(runtime.getSuspendData() || "{}").deck?.released ?? [];
		});
	expect(await released()).toEqual([]);
	await page.locator("#deck-previous").focus();
	await page.keyboard.press("Enter");
	await page.reload();
	await expect(activity(page).locator("[data-self-check-comparison] ol li")).toHaveCount(1);
	await next();
	await expect(page.locator('[data-deck-slide="slide-two"]')).toBeVisible();
	await page.locator("#deck-previous").focus();
	await page.keyboard.press("Enter");
	await action(page, "start-over").focus();
	await page.keyboard.press("Enter");
	await next();
	await expect(page.locator('[data-deck-slide="slide-two"]')).toBeHidden();
	await expect(page.locator('[data-deck-slide="slide-one"]')).toBeVisible();
	expect(await released()).toEqual([]);
});

test("a missing state provider keeps deck completion local", async ({ page }) => {
	await open(page, "deck");
	await page.evaluate(() => Reflect.deleteProperty(window, "__praxityBlockState"));
	await checkAnswer(page);
	await action(page, "show-feedback").focus();
	await page.keyboard.press("Enter");
	await page.locator("#deck-next").focus();
	await page.keyboard.press("Enter");
	await expect(page.locator('[data-deck-slide="slide-two"]')).toBeVisible();
	const released = await page.evaluate(() => {
		const runtime = Reflect.get(window, "__praxityRuntime") as SCORMRuntime | undefined;
		if (!runtime) throw new Error("Missing deck runtime");
		return JSON.parse(runtime.getSuspendData() || "{}").deck?.released ?? [];
	});
	expect(released).toEqual([]);
});

test("drafts resume before Check without labels; reporting uses only the neutral host response", async ({
	page,
}) => {
	await open(page);
	await activity(page).locator("textarea").fill("My saved draft.");
	await expect(activity(page).locator("[data-self-check-mode]")).toContainText(
		"Your answer is saved",
	);
	await page.reload();
	await expect(activity(page).locator("textarea")).toHaveValue("My saved draft.");
	await expect(activity(page).getByRole("checkbox")).toHaveCount(0);
	expect(await activity(page).innerHTML()).not.toMatch(
		/The data arrived late\.|Explain what caused the delay\.|Reason for the delay/,
	);
	await page.evaluate(() => {
		Reflect.set(window, "reported", []);
		document.addEventListener("praxity:assessment-response", (event) =>
			Reflect.get(window, "reported").push((event as CustomEvent).detail),
		);
	});
	const sibling = page.locator("[data-self-check]").nth(1);
	await sibling.locator("textarea").fill("My reported answer.");
	await sibling.locator('[data-self-check-action="check"]').focus();
	await page.keyboard.press("Enter");
	await expect(sibling.getByRole("checkbox").first()).toBeFocused();
	await sibling.locator('[data-self-check-action="show-feedback"]').focus();
	await page.keyboard.press("Enter");
	const responses = await page.evaluate(() => Reflect.get(window, "reported"));
	expect(responses).toHaveLength(1);
	expect(responses[0]).toMatchObject({
		assessmentType: "textResponse",
		responseText: "My reported answer.",
		result: "neutral",
		submitted: true,
	});
	for (const key of ["ticked", "correct", "score", "maxScore"])
		expect(responses[0]).not.toHaveProperty(key);
	await page.evaluate(() => {
		delete window.__praxityBlockState;
		Reflect.set(window, "reported", []);
	});
	await sibling.locator('[data-self-check-action="show-feedback"]').focus();
	await page.keyboard.press("Enter");
	expect(await page.evaluate(() => Reflect.get(window, "reported"))).toEqual([]);
});

for (const format of ["scorm12", "scorm2004"] as const) {
	for (const locale of ["en", "fr"]) {
		test(`${format} ${locale} discloses a truncated answer once, preserves state and restores silently`, async ({
			page,
		}) => {
			await page.addInitScript(
				({ format }) => {
					const data: Record<string, string> = JSON.parse(
						sessionStorage.getItem("lms-data") ?? "{}",
					);
					data[format === "scorm12" ? "cmi.core.student_id" : "cmi.learner_id"] = "learner";
					const writes: Array<[string, string]> = JSON.parse(
						sessionStorage.getItem("lms-writes") ?? "[]",
					);
					const prefix = format === "scorm12" ? "LMS" : "";
					Reflect.set(window, format === "scorm12" ? "API" : "API_1484_11", {
						[`${prefix}Initialize`]: () => "true",
						[format === "scorm12" ? "LMSFinish" : "Terminate"]: () => "true",
						[`${prefix}Commit`]: () => "true",
						[`${prefix}GetValue`]: (key: string) =>
							key === "cmi.interactions._count"
								? String(
										Object.keys(data).filter((key) => /^cmi\.interactions\.\d+\.id$/.test(key))
											.length,
									)
								: (data[key] ?? ""),
						[`${prefix}SetValue`]: (key: string, value: string) => {
							data[key] = value;
							writes.push([key, value]);
							sessionStorage.setItem("lms-data", JSON.stringify(data));
							sessionStorage.setItem("lms-writes", JSON.stringify(writes));
							return "true";
						},
						[`${prefix}GetLastError`]: () => "0",
						[`${prefix}GetErrorString`]: () => "",
						[`${prefix}GetDiagnostic`]: () => "",
					});
				},
				{ format },
			);
			await page.goto(base + entries[`${format}-${locale}`]);
			const privacy =
				locale === "en"
					? "Your answer stays in this browser on this device. It is not sent to the LMS."
					: "Votre réponse reste dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.";
			await expect(activity(page).locator("textarea")).toHaveAccessibleDescription(privacy);
			const reportingPrivacy =
				locale === "en"
					? "Your answer is reported to the LMS. Drafts and comparison state may also be saved there."
					: "Votre réponse est transmise au LMS. Les brouillons et l'état de la comparaison peuvent aussi y être enregistrés.";
			await expect(
				page.locator("[data-self-check]").nth(1).locator("textarea"),
			).toHaveAccessibleDescription(reportingPrivacy);
			const limit = format === "scorm12" ? 250 : 3900;
			const prefix = `${"\u{1f600}".repeat(limit / 2 - 1)}e`;
			const answer = `${prefix}\u0301TAIL`;
			await checkAnswer(page, answer);
			await submit(page);
			const sibling = page.locator("[data-self-check]").nth(1);
			await sibling.locator("textarea").fill(answer);
			await sibling.locator('[data-self-check-action="check"]').focus();
			await page.keyboard.press("Enter");
			await expect(sibling.getByRole("checkbox").first()).toBeFocused();
			await page.evaluate(() => {
				Reflect.set(window, "summaryWrites", 0);
				new MutationObserver((mutations) =>
					Reflect.set(
						window,
						"summaryWrites",
						Reflect.get(window, "summaryWrites") + mutations.length,
					),
				).observe(document.querySelectorAll("[data-self-check-status]")[1], { childList: true });
			});
			await sibling.locator('[data-self-check-action="show-feedback"]').focus();
			await page.keyboard.press("Enter");
			const copy =
				locale === "en"
					? "The LMS answer report was shortened. Your full answer is still shown here."
					: "Le rapport de r\u00e9ponse au LMS a \u00e9t\u00e9 raccourci. Votre r\u00e9ponse compl\u00e8te est toujours affich\u00e9e ici.";
			await expect(sibling.locator("[data-self-check-report]")).toHaveText(copy);
			await expect(sibling.locator("[data-self-check-status]")).toContainText(copy);
			await expect(sibling.locator("textarea")).toHaveValue(answer);
			await expect(sibling.locator("[data-self-check-comparison]")).toContainText(answer);
			expect(await page.evaluate(() => Reflect.get(window, "summaryWrites"))).toBe(1);
			const reportWrites = () =>
				page.evaluate(() =>
					JSON.parse(sessionStorage.getItem("lms-writes") ?? "[]").filter(
						([key]: [string, string]) => key.startsWith("cmi.interactions."),
					),
				);
			const reported = await reportWrites();
			expect(reported.filter(([key]: [string, string]) => key.endsWith(".id"))).toHaveLength(1);
			expect(
				reported.find(([key]: [string, string]) =>
					key.endsWith(format === "scorm12" ? ".student_response" : ".learner_response"),
				)?.[1],
			).toBe(`${prefix}\u0301`);
			await sibling.locator("textarea").fill("A short answer.");
			await sibling.locator('[data-self-check-action="show-feedback"]').focus();
			await page.keyboard.press("Enter");
			await expect(sibling.locator("[data-self-check-report]")).toBeEmpty();
			await sibling.locator("textarea").fill(answer);
			await sibling.locator('[data-self-check-action="show-feedback"]').focus();
			await page.keyboard.press("Enter");
			await expect(sibling.locator("[data-self-check-report]")).toHaveText(copy);
			const beforeRestore = await reportWrites();
			expect(beforeRestore.filter(([key]: [string, string]) => key.endsWith(".id"))).toHaveLength(
				3,
			);
			await page.reload();
			await expect(sibling.locator("[data-self-check-comparison]")).toContainText(answer);
			await expect(sibling.locator("textarea")).toHaveAccessibleDescription(reportingPrivacy);
			expect(await reportWrites()).toEqual(beforeRestore);
			await expect(sibling.locator("[data-self-check-status]")).toBeEmpty();
			await expect(sibling.locator("[data-self-check-report]")).toBeEmpty();
			await sibling.locator('[data-self-check-action="show-feedback"]').focus();
			await page.keyboard.press("Enter");
			await expect(sibling.locator("[data-self-check-report]")).toHaveText(copy);
			await sibling.locator('[data-self-check-action="start-over"]').focus();
			await page.keyboard.press("Enter");
			await expect(sibling.locator("[data-self-check-report]")).toBeEmpty();
			await expect(sibling.locator("textarea")).toHaveAccessibleDescription(reportingPrivacy);
		});
	}
}

test("failed asset keeps the baseline usable without revealing authored answers", async ({
	page,
}) => {
	await page.route("**/self-check/*.js", (route) => route.abort());
	await open(page);
	await activity(page).locator("textarea").fill("Keep this answer.");
	await action(page, "check").focus();
	await page.keyboard.press("Enter");
	await expect(
		activity(page).getByText(
			"Comparison is unavailable. You can still write and copy your answer.",
		),
	).toBeVisible();
	await expect(action(page, "retry")).toBeFocused();
	await expect(activity(page).locator("textarea")).toHaveValue("Keep this answer.");
	await expect(activity(page).getByRole("checkbox")).toHaveCount(0);
	await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
});

test("pre-activation typing survives, pending previews refuse reveal, and failed saves stay visible", async ({
	page,
}) => {
	await page.route("**/island-self-check*.js", async (route) => {
		await page.locator("textarea").first().fill("Written before activation.");
		await route.continue();
	});
	await open(page);
	await expect(activity(page).locator("textarea")).toHaveValue("Written before activation.");
	await action(page, "check").focus();
	await page.keyboard.press("Enter");
	await expect(activity(page).getByRole("checkbox").first()).toBeFocused();
	await submit(page);
	await remount(page, undefined, true);
	await expect(activity(page).locator("[data-self-check-save]")).toHaveText(
		"Your answer is not saved on this device. Keep a copy before leaving this page.",
	);
	await page.evaluate(async () => {
		const module = await import(
			new URL(
				document.documentElement.getAttribute("data-island-self-check") ?? "",
				document.baseURI,
			).href
		);
		module.disposeSelfCheckDocument();
		document
			.querySelector("[data-self-check]")
			?.setAttribute("data-self-check-context-pending", "");
		module.initSelfCheckEnhancements();
	});
	await expect(action(page, "check")).toBeDisabled();
	await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
});

for (const locale of ["en", "fr"])
	for (const width of [1280, 320]) {
		test(`${locale} ${width}px steps reflow with readable comparisons`, async ({ page }, info) => {
			await page.setViewportSize({ width, height: 1000 });
			await open(page, locale);
			const capture = async (step: string) => {
				if (process.env.SELF_CHECK_SCREENSHOTS && info.project.name === "chromium")
					await page.screenshot({
						path: join(process.env.SELF_CHECK_SCREENSHOTS, `${locale}-${width}-${step}.png`),
						fullPage: true,
					});
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true,
				);
			};
			await expect(activity(page)).toHaveAttribute("lang", locale);
			await expect(action(page, "start-over")).toBeHidden();
			await capture("fresh");
			await activity(page)
				.locator("textarea")
				.fill(
					locale === "fr"
						? "Les données sont en retard. Puis-je envoyer le rapport mardi?"
						: "The data was late. May I send it Tuesday?",
				);
			await capture("write");
			await checkAnswer(page, await activity(page).locator("textarea").inputValue());
			await capture("checked");
			await expect(activity(page).locator("[data-self-check-count]")).toHaveText(
				locale === "fr" ? "0 sur 3 sélectionné" : "0 of 3 selected",
			);
			await expect(action(page, "start-over")).toHaveClass("praxity-btn");
			await submit(page);
			await expect(activity(page).locator("[data-self-check-part-state]")).toHaveText(
				Array(3).fill(locale === "fr" ? "À ajouter" : "To add"),
			);
			await expect(
				activity(page).locator('[data-self-check-part-state] [aria-hidden="true"]'),
			).toHaveCount(3);
			await expect(activity(page).locator("[data-self-check-parts-label]")).toHaveClass(
				"praxity-scene-title",
			);
			await capture("feedback");
			if (info.project.name === "chromium")
				expect(
					(await analyzeAxe(page, new AxeBuilder({ page }).include("[data-self-check]")))
						.violations,
				).toEqual([]);
			const columns = activity(page).locator(".praxity-self-check-columns > div");
			const first = await columns.nth(0).boundingBox(),
				second = await columns.nth(1).boundingBox();
			if (!first || !second) throw new Error("Missing comparison");
			if (width === 320) expect(second.y).toBeGreaterThan(first.y);
			else {
				const layout = await activity(page)
					.locator(".praxity-self-check-columns")
					.evaluate((node) => {
						const style = getComputedStyle(node);
						return {
							width: node.clientWidth,
							gap: parseFloat(style.columnGap),
							rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
						};
					});
				if (layout.width >= 40 * layout.rem + layout.gap) expect(second.y).toBe(first.y);
				else expect(second.y).toBeGreaterThan(first.y);
			}
			await activity(page)
				.locator("textarea")
				.fill(locale === "fr" ? "Ma réponse révisée." : "My revised answer.");
			await capture("previous");
			await page.reload();
			await expect(activity(page).locator("[data-self-check-comparison] ol li")).toHaveCount(3);
			await capture("restored");
			if (width === 1280) {
				await activity(page).evaluate((node) => {
					node.style.inlineSize = "48rem";
				});
				const wideFirst = await columns.nth(0).boundingBox(),
					wideSecond = await columns.nth(1).boundingBox();
				expect(wideSecond?.y).toBe(wideFirst?.y);
			}
			await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
			await action(page, "show-feedback").focus();
			expect(
				await action(page, "show-feedback").evaluate((node) => getComputedStyle(node).outlineStyle),
			).not.toBe("none");
		});
	}

test("Check leaves a failed restore blocked until an explicit Retry", async ({ page }) => {
	await open(page);
	await activity(page).locator("textarea").fill("Saved draft");
	await page.route("**/self-check-support-*.js*", (route) => route.abort());
	await page.reload();
	await expect(activity(page).locator("[data-self-check-notice]")).toContainText(
		"Comparison is unavailable.",
	);
	await expect(action(page, "check")).toBeHidden();
	await action(page, "check").evaluate((button: HTMLButtonElement) => button.click());
	const state = await page.evaluate(() =>
		window.__praxitySelfCheckSession?.session.read(
			document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "",
		),
	);
	expect(state).toMatchObject({ outcome: "unavailable", generation: 1, completed: false });
	await expect(action(page, "retry")).toBeVisible();
});

test("concurrent admissions keep each activity's content until comparison mount", async ({
	page,
}) => {
	await open(page);
	await page.evaluate(async () => {
		const runtime = window.__praxitySelfCheckSession;
		if (!runtime) throw new Error("Missing session");
		const support = await runtime.support();
		const roots = [...document.querySelectorAll<HTMLElement>("[data-self-check]")];
		const operations = await Promise.all(
			roots.map((root) =>
				support.admit(
					{
						blockId: root.dataset.selfCheckId ?? "",
						contentRevision: root.dataset.selfCheckRevision ?? "",
						path: root.dataset.selfCheckSrc ?? "",
					},
					document,
				),
			),
		);
		for (const operation of operations) operation.restore(undefined);
		for (const root of roots) {
			const answer = root.querySelector("textarea");
			if (answer) answer.value = "Current answer";
			support
				.enhance(
					root,
					{
						saveStatus() {},
						clearError() {},
						validAnswer: () => true,
						unavailable() {},
						reset() {},
						cleanup() {},
					},
					runtime,
				)
				.check();
		}
	});
	for (const root of await page.locator("[data-self-check]").all())
		await expect(root.getByRole("checkbox")).toHaveCount(3);
});

for (const phase of ["before-admission", "before-mount"] as const) {
	test(`deterministic empty edit ${phase} retains the previous submission`, async ({ page }) => {
		await open(page);
		await checkAnswer(page);
		await page.keyboard.press("Space");
		await submit(page);
		if (phase === "before-admission") {
			await page.route("**/self-check/*.js", async (route) => {
				await activity(page).locator("textarea").fill("");
				await route.continue();
			});
		} else {
			await page.addInitScript(() => {
				let support: unknown;
				Object.defineProperty(window, "__praxitySelfCheckSupport", {
					configurable: true,
					get: () => support,
					set(value) {
						support = value;
						const enhance = value.enhance;
						value.enhance = (...args: Parameters<typeof enhance>) => {
							const root = args[0] as HTMLElement;
							if (root === document.querySelector("[data-self-check]")) {
								const provider = window.__praxityBlockState;
								if (provider) {
									// Fail writes at the storage seam without starting another document session.
									provider.set = () => {};
									provider.getSaveResult = () => ({
										status: "not-saved",
										code: "storage-unavailable",
									});
								}
								const answer = root.querySelector("textarea");
								if (answer) {
									answer.value = "";
									answer.dispatchEvent(new Event("input", { bubbles: true }));
								}
							}
							return enhance(...args);
						};
					},
				});
			});
		}
		await page.reload();
		await expect(activity(page).locator("[data-self-check-comparison-title]")).toHaveText(
			"Previous comparison",
		);
		await expect(activity(page).locator("textarea")).toHaveValue("");
		await expect(activity(page).getByRole("checkbox").first()).toBeChecked();
		await expect(activity(page).getByRole("status")).toHaveText("");
		const saved = await page.evaluate(() =>
			window.__praxityBlockState?.get(
				document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "",
			),
		);
		expect(saved).toMatchObject({
			draft: {
				answer: phase === "before-mount" ? "The data was late. May I send it Tuesday?" : "",
				ticked: expect.any(Array),
			},
			submitted: { answer: "The data was late. May I send it Tuesday?", shown: true },
		});
	});
}

for (const locale of ["en", "fr"])
	for (const width of [1280, 320])
		for (const state of ["pending", "unavailable", "changed", "invalid"] as const) {
			test(`${locale} ${width}px ${state} recovery is readable and usable`, async ({
				page,
			}, info) => {
				await page.setViewportSize({ width, height: 1000 });
				await open(page, locale);
				await checkAnswer(page);
				await submit(page);
				let release = () => {};
				if (state === "pending") {
					let requested!: () => void;
					const request = new Promise<void>((resolve) => {
						requested = resolve;
					});
					const hold = new Promise<void>((resolve) => {
						release = resolve;
					});
					await page.route("**/self-check/*.js", async (route) => {
						requested();
						await hold;
						await route.continue();
					});
					await remount(page);
					await request;
				} else if (state === "unavailable") {
					await page.route("**/self-check/*.js", (route) => route.abort());
					await remount(page);
				} else if (state === "changed") await remount(page, `sha256:${"0".repeat(64)}`);
				else {
					await page.evaluate(() => {
						const id =
							document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "";
						const saved = window.__praxityBlockState?.get(id);
						window.__praxityBlockState?.set(id, { ...(saved as object), fabricated: true });
					});
					await remount(page);
				}
				const copy =
					locale === "en"
						? {
								pending: "Restoring your progress.",
								unavailable: "If this keeps happening, tell whoever runs this course.",
								changed: "The activity changed",
								invalid: "Your previous comparison could not be restored",
							}
						: {
								pending: "Restauration de votre progression.",
								unavailable:
									"Si le problème persiste, prévenez la personne responsable de ce cours.",
								changed: "L'activité a changé",
								invalid: "Votre comparaison précédente n'a pas pu être restaurée",
							};
				await expect(activity(page).locator("[data-self-check-recovery]")).toContainText(
					copy[state],
				);
				const layout = await activity(page).evaluate((root) => {
					const answer = root.querySelector("textarea");
					const recovery = root.querySelector("[data-self-check-recovery]");
					const notice = root.querySelector("[data-self-check-notice]");
					const retry = root.querySelector('[data-self-check-action="retry"]');
					const check = root.querySelector('[data-self-check-action="check"]');
					const reset = root.querySelector('[data-self-check-action="start-over"]');
					const save = root.querySelector("[data-self-check-mode]");
					if (!answer || !recovery || !notice || !retry || !check || !reset || !save)
						throw new Error("Missing recovery controls");
					const before = (a: Element, b: Element) =>
						Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
					return {
						messageBeforeActions: before(answer, recovery) && before(recovery, check),
						pendingOrder: before(save, check) && before(reset, recovery),
						unavailableOrder:
							before(notice, recovery) && before(recovery, retry) && before(reset, save),
						retryWithReset: retry.parentElement === reset.parentElement,
						actionsSameRow: retry.getBoundingClientRect().top === reset.getBoundingClientRect().top,
						retryPrimary: retry.classList.contains("praxity-ag-submit-btn"),
						resetSecondary: reset.classList.contains("praxity-btn"),
					};
				});
				if (state === "pending") expect(layout.pendingOrder).toBe(true);
				else expect(layout.messageBeforeActions).toBe(true);
				if (state === "unavailable") {
					await expect(action(page, "check")).toBeHidden();
					await expect(action(page, "retry")).toBeVisible();
					await expect(action(page, "start-over")).toBeVisible();
					expect(layout).toMatchObject({
						unavailableOrder: true,
						retryWithReset: true,
						actionsSameRow: true,
						retryPrimary: true,
						resetSecondary: true,
					});
				}
				await expect(activity(page).getByRole("status")).toHaveText("");
				await expect(activity(page).locator("textarea")).toHaveValue(
					"The data was late. May I send it Tuesday?",
				);
				await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true,
				);
				if (process.env.PRAXITY_SELF_CHECK_EVIDENCE_DIR && info.project.name === "chromium")
					await page.screenshot({
						path: join(
							process.env.PRAXITY_SELF_CHECK_EVIDENCE_DIR,
							`${locale}-${width}-${state}.png`,
						),
						fullPage: true,
					});
				if (state === "unavailable") {
					await page.unroute("**/self-check/*.js");
					await action(page, "retry").focus();
					await page.keyboard.press("Enter");
					await expect(activity(page).locator("[data-self-check-comparison-title]")).toHaveText(
						locale === "en" ? "Comparison" : "Comparaison",
					);
				} else {
					await action(page, "start-over").focus();
					await page.keyboard.press("Enter");
					release();
					await page.waitForLoadState("networkidle");
					await expect(activity(page).locator("textarea")).toHaveValue("");
					await expect(activity(page).locator("textarea")).toBeFocused();
					await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
					const id = await activity(page).getAttribute("data-self-check-id");
					expect(
						await page.evaluate(
							(blockId) => window.__praxitySelfCheckSession?.session.read(blockId ?? ""),
							id,
						),
					).toMatchObject({ outcome: "empty", completed: false, available: true });
				}
			});
		}

for (const format of ["en", "scorm12-en", "scorm2004-en", "file"])
	for (const failure of ["asset", "support"] as const) {
		test(`${format} Retry after failed ${failure} retains edits and restores silently`, async ({
			page,
		}) => {
			if (format === "file") await page.goto(pathToFileURL(join(root, entries.en)).href);
			else await open(page, format);
			await expect(action(page, "check")).toBeVisible();
			await checkAnswer(page);
			await submit(page);
			expect(
				await page.evaluate(() =>
					window.__praxityBlockState?.get(
						document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "",
					),
				),
			).toMatchObject({ submitted: { answer: "The data was late. May I send it Tuesday?" } });
			const pattern = failure === "asset" ? "**/self-check/*.js" : "**/self-check-support-*.js";
			if (format === "file") {
				await page.addInitScript((failure) => {
					Reflect.set(window, "selfCheckLoadFailure", failure);
					const append = Element.prototype.append;
					Element.prototype.append = function (...nodes: (Node | string)[]) {
						const allowed = nodes.filter((node) => {
							if (!(node instanceof HTMLScriptElement)) return true;
							const active = Reflect.get(window, "selfCheckLoadFailure");
							if (
								active === "asset"
									? /\/self-check\//.test(node.src)
									: active === "support" && /self-check-support-/.test(node.src)
							) {
								queueMicrotask(() => node.dispatchEvent(new Event("error")));
								return false;
							}
							return true;
						});
						append.apply(this, allowed);
					};
				}, failure);
			} else await page.route(pattern, (route) => route.abort());
			await page.reload();
			await expect(activity(page).locator("[data-self-check-notice]")).toContainText(
				"Comparison is unavailable.",
			);
			await activity(page).locator("textarea").fill("Edited while comparison was unavailable.");
			await page.unroute(pattern);
			if (format === "file")
				await page.evaluate(() => Reflect.set(window, "selfCheckLoadFailure", null));
			await action(page, "retry").focus();
			await page.keyboard.press("Enter");
			await expect(activity(page).locator("[data-self-check-comparison-title]")).toHaveText(
				"Previous comparison",
			);
			await expect(activity(page).locator("textarea")).toHaveValue(
				"Edited while comparison was unavailable.",
			);
			await expect(activity(page).getByRole("status")).toHaveText("");
			await expect(action(page, "retry")).toBeFocused();
			await expect(action(page, "retry")).toHaveAttribute("aria-disabled", "true");
			await page.keyboard.press("Tab");
			await expect(action(page, "retry")).toBeHidden();
		});
	}
