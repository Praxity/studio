import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { DONT_KNOW } from "@praxity/shared-blocks/assessment-choice";
import AdmZip from "adm-zip";
import { build } from "esbuild";
import { compileCourse, deployCourse } from "../../src/build";
import { analyzeAxe } from "../a11y/helpers";

let root: string, base: string, server: Server;
const entries: Record<string, string> = {};
const evidence = process.env.PRAXITY_PRIVATE_CHOICE_EVIDENCE_DIR;
test.beforeAll(async () => {
	root = await mkdtemp(
		join(process.env.PRAXITY_PRIVATE_CHOICE_SCRATCH ?? tmpdir(), "private-choice-"),
	);
	await build({
		stdin: {
			contents:
				'export { LocalStorageRuntime } from "./packages/export-pipeline/src/scorm/local-storage-runtime.ts"',
			resolveDir: process.cwd().endsWith("export-pipeline")
				? join(process.cwd(), "../..")
				: process.cwd(),
			loader: "ts",
		},
		bundle: true,
		format: "esm",
		outfile: join(root, "reset-owner.js"),
	});
	if (evidence) await mkdir(evidence, { recursive: true });
	for (const locale of ["en", "fr"]) {
		const question =
			locale === "en"
				? "Which approach removes barriers?"
				: "Quelle approche élimine les obstacles?";
		const options =
			locale === "en"
				? "(x) Improve the environment\n( ) Blame the learner"
				: "(x) Améliorer l'environnement\n( ) Blâmer la personne";
		const read = readLesson(
			`# ${locale === "en" ? "Practice" : "Mise en pratique"}\n::: choice ${question} {private=true dontKnow=true scored=false required=false}\n${options}\n:::\n::: choice ${question} {dontKnow=true scored=false required=false}\n${options}\n:::\n`,
		);
		if (read.hasErrors) throw new Error(JSON.stringify(read.errors));
		const artifact = await compileCourse({
			id: `private-choice-${locale}`,
			title: locale === "en" ? "Practice" : "Mise en pratique",
			sourceLocale: locale,
			colorMode: "auto",
			content: read.pages,
		});
		try {
			entries[locale] = `${locale}/${artifact.manifest.pages[0].slug}.html`;
			new AdmZip((await deployCourse(artifact, { format: "html" })).zip).extractAllTo(
				join(root, locale),
			);
			entries[`${locale}-scorm12`] = `${locale}-scorm12/${artifact.manifest.pages[0].slug}.html`;
			new AdmZip((await deployCourse(artifact, { format: "scorm12" })).zip).extractAllTo(
				join(root, `${locale}-scorm12`),
			);
		} finally {
			await artifact.dispose();
		}
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
	if (!address || typeof address === "string") throw new Error("Missing address");
	base = `http://127.0.0.1:${address.port}/`;
});
test.afterAll(async () => {
	if (server)
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	if (root) await rm(root, { recursive: true, force: true });
	if (evidence) {
		const index = [
			"# Private choice captures",
			"",
			"Built HTML; exact EN/FR destination copy, existing controls and error text treatment. Controller owns visual judgment.",
			"",
		];
		for (const locale of ["en", "fr"])
			for (const theme of ["light", "dark"])
				for (const width of [1280, 320])
					for (const state of ["ready", "submitted", "save-failed"]) {
						const file = `${locale}-${theme}-${width}-${state}.png`;
						index.push(
							`- [${file}](${file}): ${locale.toUpperCase()}, ${theme}, ${width}px; ${state === "ready" ? "ready" : state === "submitted" ? "uncertainty selected and checked" : "failed save after checking uncertainty"}.`,
						);
					}
		index.push(
			"- [ordinary-en-light-1280.png](ordinary-en-light-1280.png): ordinary choice comparison, EN, light, 1280px.",
			"",
		);
		await writeFile(join(evidence, "index.md"), index.join("\n"));
	}
});
const activity = (page: Page) => page.locator('[data-island="assessment"]').first();
async function open(page: Page, locale = "en") {
	await page.goto(base + entries[locale]);
	await expect(activity(page).getByRole("radio").first()).toBeEnabled();
	await expect(activity(page).locator("[data-practice-mode]")).toContainText(
		locale === "en"
			? "Anyone using this browser may see them."
			: "Toute personne qui utilise ce navigateur peut les voir.",
	);
}
async function axe(page: Page) {
	const results = await analyzeAxe(
		page,
		new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]),
	);
	expect(results.violations).toEqual([]);
}
async function chooseUnknown(page: Page) {
	const radio = activity(page).getByRole("radio").last();
	await radio.focus();
	await page.keyboard.press("Space");
	await expect(radio).toBeChecked();
}
async function check(page: Page) {
	await activity(page).locator("[data-assessment-submit]").focus();
	await page.keyboard.press("Enter");
	await expect(activity(page).locator("[data-assessment-retry]")).toBeFocused();
}
async function failStorage(page: Page) {
	await page.evaluate(() => {
		Storage.prototype.setItem = () => {
			throw new DOMException("storage unavailable", "QuotaExceededError");
		};
	});
}
for (const locale of ["en", "fr"]) {
	for (const state of ["ready", "selected", "submitted", "restored", "retry", "reset"] as const)
		test(`${locale}: ${state} remains accessible`, async ({ page }) => {
			await open(page, locale);
			if (state !== "ready") await chooseUnknown(page);
			if (["submitted", "restored", "retry", "reset"].includes(state)) await check(page);
			if (state === "restored") {
				await page.reload();
				await expect(activity(page).getByRole("radio").last()).toBeChecked();
				await expect(activity(page).getByRole("radio").last()).toBeDisabled();
			}
			if (state === "retry") {
				await activity(page).locator("[data-assessment-retry]").focus();
				await page.keyboard.press("Enter");
				await expect(activity(page).getByRole("radio").first()).toBeFocused();
				await expect(activity(page).getByRole("radio").last()).not.toBeChecked();
				const saved = await page.evaluate(() => {
					const id = JSON.parse(
						document.querySelector<HTMLElement>('[data-island="assessment"]')?.dataset.blockJson ??
							"{}",
					).id;
					return window.__praxityBlockState?.get(id);
				});
				expect(saved).toMatchObject({
					attemptCount: 1,
					checked: false,
					interacted: false,
					answer: [],
				});
			}
			if (state === "reset") {
				await page.evaluate(async (courseId) => {
					const { LocalStorageRuntime } = await import(
						/* @vite-ignore */ `${location.origin}/reset-owner.js`
					);
					new LocalStorageRuntime(
						localStorage,
						JSON.stringify([courseId, null]),
						"default",
					).resetState();
				}, `private-choice-${locale}`);
				await page.reload();
				await expect(activity(page).getByRole("radio").first()).toBeEnabled();
				await expect(activity(page).getByRole("radio").last()).not.toBeChecked();
				await chooseUnknown(page);
				const saved = await page.evaluate(() => {
					const id = JSON.parse(
						document.querySelector<HTMLElement>('[data-island="assessment"]')?.dataset.blockJson ??
							"{}",
					).id;
					return window.__praxityBlockState?.get(id);
				});
				expect(saved).toMatchObject({ attemptCount: 0, checked: false });
			}
			await expect(activity(page).getByRole("status")).toBeEmpty();
			await axe(page);
		});

	test(`${locale}: identified storage uses the admitted attempt and reports no private answer`, async ({
		page,
	}) => {
		await page.addInitScript(() => {
			const values: Record<string, string> = {
				"cmi.core.student_id": "learner",
				"cmi.core.entry": "ab-initio",
				"cmi.suspend_data": "",
			};
			const writes: string[] = [];
			Reflect.set(window, "lmsWrites", writes);
			Reflect.set(window, "API", {
				LMSInitialize: () => "true",
				LMSFinish: () => "true",
				LMSCommit: () => "true",
				LMSGetLastError: () => "0",
				LMSGetErrorString: () => "",
				LMSGetDiagnostic: () => "",
				LMSGetValue: (key: string) => values[key] ?? "",
				LMSSetValue: (key: string, value: string) => {
					values[key] = value;
					writes.push(`${key}=${value}`);
					return "true";
				},
			});
		});
		await page.goto(base + entries[`${locale}-scorm12`]);
		await expect(activity(page).locator("[data-practice-identified]")).toBeVisible();
		await expect(activity(page).locator("[data-practice-identified]")).toHaveText(
			locale === "en" ? "A new attempt starts fresh." : "Une nouvelle tentative repart de zéro.",
		);
		await expect(activity(page).locator("[data-practice-shared]")).toBeHidden();
		await expect(activity(page).getByRole("radio").first()).toBeEnabled();
		await chooseUnknown(page);
		await check(page);
		await expect(activity(page).locator("[data-practice-save]")).toBeHidden();
		const writes = await page.evaluate(() => Reflect.get(window, "lmsWrites") as string[]);
		expect(writes.filter((key) => /cmi\.(?:interactions|objectives)\./.test(key))).toEqual([]);
		expect(writes.join("\n")).not.toContain(DONT_KNOW);
		await axe(page);
	});
	test(`${locale}: failed privacy asset settles silently; the first answer announces failure`, async ({
		page,
	}) => {
		await page.route("**/privacy-support-*.js", (route) => route.abort());
		await page.goto(base + entries[locale]);
		await expect(activity(page).getByRole("radio").first()).toBeEnabled();
		await expect(activity(page).locator("[data-practice-restoring]")).toBeHidden();
		await expect(activity(page).locator("[data-practice-save]")).toBeVisible();
		await expect(activity(page).locator("[data-practice-save]")).toHaveClass("praxity-text-error");
		await expect(activity(page).getByRole("status")).toBeEmpty();
		await axe(page);
		await chooseUnknown(page);
		await expect(activity(page).getByRole("status")).toHaveText(
			await activity(page).locator("[data-practice-save]").innerText(),
		);
		await axe(page);
	});
	test(`${locale}: pending restore is silent with disabled controls; storage failure announces once`, async ({
		page,
	}) => {
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route("**/privacy-support-*.js", async (route) => {
			await held;
			await route.continue();
		});
		await page.goto(base + entries[locale], { waitUntil: "domcontentloaded" });
		await expect(activity(page).locator("[data-practice-restoring]")).toHaveText(
			locale === "en" ? "Restoring your progress." : "Restauration de votre progression.",
		);
		await expect(activity(page).getByRole("radio").first()).toBeDisabled();
		await expect(activity(page).getByRole("status")).toBeEmpty();
		await axe(page);
		release();
		await expect(activity(page).getByRole("radio").first()).toBeEnabled();
		await failStorage(page);
		await chooseUnknown(page);
		await expect(activity(page).locator("[data-practice-save]")).toContainText(
			locale === "en" ? "not saved" : "n’est pas enregistrée",
		);
		await expect(activity(page).getByRole("status")).toHaveText(
			await activity(page).locator("[data-practice-save]").innerText(),
		);
		await page.evaluate(() => {
			const status = document.querySelector("[data-practice-status]");
			Reflect.set(window, "failureAnnouncements", 0);
			new MutationObserver((records) =>
				Reflect.set(
					window,
					"failureAnnouncements",
					Reflect.get(window, "failureAnnouncements") + records.length,
				),
			).observe(status!, { childList: true, subtree: true });
		});
		await check(page);
		await expect
			.poll(() => page.evaluate(() => Reflect.get(window, "failureAnnouncements")))
			.toBe(0);
	});
}
for (const locale of ["en", "fr"]) {
	test(`${locale}: 400% reflow, text spacing, forced colours and reduced motion preserve the activity`, async ({
		page,
	}) => {
		// 1280px at 400% gives a 320 CSS-pixel layout viewport.
		await page.setViewportSize({ width: 320, height: 900 });
		await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
		await open(page, locale);
		await page.addStyleTag({
			content:
				"* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-block-end: 2em !important; }",
		});
		await chooseUnknown(page);
		await check(page);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await expect(activity(page).locator("[data-practice-mode]")).toBeVisible();
		await expect(activity(page).locator("[data-assessment-retry]")).toBeFocused();
		await axe(page);
	});
	test(`${locale}: learner print preserves selection and feedback without storage notices`, async ({
		page,
	}) => {
		await open(page, locale);
		await failStorage(page);
		await chooseUnknown(page);
		await check(page);
		await expect(activity(page).locator("[data-practice-save]")).toBeVisible();
		await page.emulateMedia({ media: "print" });
		await expect(activity(page).locator("[data-practice-mode]")).toBeHidden();
		await expect(activity(page).locator("[data-practice-save]")).toBeHidden();
		await expect(activity(page).getByRole("radio").last()).toBeChecked();
		await page.emulateMedia({ media: "screen" });
		await expect(activity(page).locator("[data-practice-save]")).toBeVisible();
		await expect(activity(page).locator("[data-assessment-retry]")).toBeFocused();
	});
}

for (const locale of ["en", "fr"])
	for (const theme of ["light", "dark"])
		for (const width of [1280, 320])
			for (const state of ["ready", "submitted", "save-failed"]) {
				test(`${locale} ${theme} ${width}px ${state}: notices reflow with the existing actions`, async ({
					page,
				}, info) => {
					await page.setViewportSize({ width, height: 1000 });

					await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
					await open(page, locale);
					await expect(page.locator("html")).toHaveAttribute("data-praxity-mode", theme);
					if (state === "save-failed") await failStorage(page);
					if (state !== "ready") {
						await chooseUnknown(page);
						await check(page);
					}
					const mode = activity(page).locator("[data-practice-mode]");
					await expect(mode).toBeVisible();
					await expect(activity(page).getByRole("radio").last()).toHaveAccessibleName(
						locale === "en" ? "I don't know" : "Je ne sais pas",
					);
					expect(
						await mode.evaluate((el) => {
							const actions = el.previousElementSibling;
							return (
								!!actions &&
								actions.getBoundingClientRect().bottom <= el.getBoundingClientRect().top
							);
						}),
					).toBe(true);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
					).toBe(true);
					await expect(
						page.locator('[data-island="assessment"]').nth(1).locator("[data-practice-mode]"),
					).toHaveCount(0);
					await axe(page);
					if (evidence && info.project.name === "chromium") {
						await activity(page).screenshot({
							path: join(evidence, `${locale}-${theme}-${width}-${state}.png`),
						});
						if (locale === "en" && theme === "light" && width === 1280 && state === "ready")
							await page
								.locator('[data-island="assessment"]')
								.nth(1)
								.screenshot({ path: join(evidence, "ordinary-en-light-1280.png") });
					}
				});
			}
