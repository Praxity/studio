import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createLearnerState } from "@praxity/shared-blocks/learner-state";
import AdmZip from "adm-zip";
import { runPraxityCli } from "../../../../apps/desktop/src/main/cli";
import { persistFixtureIdentity } from "../../../../apps/desktop/src/test-utils/identity-fixture";
import { compileCourse, deployCourse } from "../../src/build";
import { releaseCourse, releaseExpected, releaseSource } from "../fixtures/self-check-release";

let folder: string, base: string, server: Server;
const entries: Record<string, string> = {};
test.beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "self-check-release-browser-"));
	for (const locale of ["en", "fr"] as const) {
		const project = join(folder, `project-${locale}`);
		await mkdir(project);
		await writeFile(
			join(project, "course.yaml"),
			`title: Self-check\nlang: ${locale}\nlessons: [lesson.prax]\n`,
		);
		await writeFile(join(project, "lesson.prax"), releaseSource(locale));
		await persistFixtureIdentity(project);
		for (const format of ["html", "scorm-1.2", "scorm-2004"] as const) {
			const output = join(project, `${format}.zip`);
			const result = await runPraxityCli(
				["export", project, "--format", format, "--output", output],
				{
					appVersion: "test",
					exportAssetsDir: join(
						import.meta.dirname,
						"../../../../apps/desktop/resources/export-assets",
					),
				},
			);
			expect(result.exitCode, result.stderr + result.stdout).toBe(0);
			const zip = new AdmZip(await readFile(output));
			const entry = zip
				.getEntries()
				.find(
					(entry) =>
						entry.entryName.endsWith(".html") &&
						entry.getData().toString().includes("data-self-check-id="),
				);
			if (!entry) throw new Error("Missing CLI activity document");
			const target = `cli-${format}-${locale}`;
			zip.extractAllTo(join(folder, target));
			entries[target] = `${target}/${entry.entryName}`;
		}
		const artifact = await compileCourse(releaseCourse(locale).input);
		try {
			for (const format of ["html", "scorm12", "scorm2004"] as const) {
				const target = `${format}-${locale}`;
				entries[target] = `${target}/${artifact.manifest.pages[0].slug}.html`;
				new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(
					join(folder, target),
				);
			}
			const preview = await deployCourse(artifact, { format: "electron-preview" });
			try {
				entries[`preview-${locale}`] = `preview-${locale}/${artifact.manifest.pages[0].slug}.html`;
				for (const file of preview.manifest.files) {
					const chunks: Buffer[] = [];
					for await (const chunk of await preview.openFile(file.path))
						chunks.push(Buffer.from(chunk));
					const target = join(folder, `preview-${locale}`, file.path);
					await mkdir(dirname(target), { recursive: true });
					await writeFile(target, Buffer.concat(chunks));
				}
				const identity = {
					channel: "self_check_release_preview_channel",
					courseId: artifact.manifest.courseId,
					revision: artifact.manifest.revision,
					pageId: artifact.manifest.pages[0].id,
				};
				const initial = JSON.stringify(
					createLearnerState({ courseId: identity.courseId, attemptId: "studio-preview" }),
				);
				await writeFile(
					join(folder, `preview-${locale}.html`),
					`<!doctype html><html lang="${locale}"><title>Preview host fixture</title><body><button id="before">Before preview</button><iframe name="learner" title="Course preview" style="width:100%;height:95vh"></iframe><button id="after">After preview</button><script>
				const identity = ${JSON.stringify(identity)}, frame = document.querySelector('iframe');
				frame.onload = () => {
					const channel = new MessageChannel();
					channel.port1.onmessage = ({data}) => {
						if (data.event === 'connected') channel.port1.postMessage({...identity,source:'praxity-studio',version:1,action:'restore',state:sessionStorage.getItem(identity.courseId) || ${JSON.stringify(initial)},writable:true});
						if (data.event === 'persist') sessionStorage.setItem(identity.courseId,data.state);
						if (data.event === 'focus-boundary') document.getElementById(data.direction === 'forward' ? 'after' : 'before').focus();
					};
					frame.contentWindow.postMessage({...identity,source:'praxity-studio',version:1,action:'connect'},location.origin,[channel.port2]);
				};
				frame.src = ${JSON.stringify(entries[`preview-${locale}`])} + '?praxity-channel=' + identity.channel + '&praxity-parent-origin=' + encodeURIComponent(location.origin);
				</script></body></html>`,
				);
				entries[`preview-${locale}`] = `preview-${locale}.html`;
			} finally {
				await preview.dispose();
			}
		} finally {
			await artifact.dispose();
		}
	}
	server = createServer(async (request, response) => {
		try {
			const path = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
			if (path.includes("..")) throw new Error("Invalid fixture path");
			const bytes = await readFile(join(folder, path));
			response.writeHead(200, {
				"Content-Type": path.endsWith(".js")
					? "text/javascript"
					: path.endsWith(".css")
						? "text/css"
						: path.endsWith(".woff2")
							? "font/woff2"
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
	if (!address || typeof address === "string") throw new Error("Missing fixture server");
	base = `http://127.0.0.1:${address.port}/`;
});
test.afterAll(async () => {
	if (server)
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	if (folder) await rm(folder, { recursive: true });
});

const learner = (page: Page) => page.frame({ name: "learner" }) ?? page;
const activity = (page: Page) => learner(page).locator("[data-self-check]");
const action = (root: Locator, name: string) => root.locator(`[data-self-check-action="${name}"]`);
async function tabTo(page: Page, target: Locator, key = "Tab") {
	// Native Tab traversal, including the course shell, never programmatic focus.
	if (await target.evaluate((node) => node === document.activeElement && document.hasFocus()))
		return;
	const history = [];
	for (let n = 0; n < 60; n++) {
		await page.keyboard.press(key);
		if (await target.evaluate((node) => node === document.activeElement && document.hasFocus()))
			return;
		history.push(
			await target.evaluate((node) => ({
				target: node.id,
				active: document.activeElement?.id,
				focused: document.hasFocus(),
			})),
		);
	}
	throw new Error(`Keyboard could not reach the activity control: ${JSON.stringify(history)}`);
}
async function compare(page: Page, locale: "en" | "fr") {
	const root = activity(page),
		expected = releaseExpected[locale];
	await expect(root).toHaveAttribute("lang", locale);
	await expect(root.locator(".praxity-assessment-stem")).toHaveText(expected.task);
	await tabTo(page, root.locator("textarea"));
	await page.keyboard.insertText(expected.answer);
	await tabTo(page, action(root, "check"));
	await page.keyboard.press("Enter");
	await expect(root.getByRole("checkbox").first()).toBeFocused();
	await expect(root.locator("[data-self-check-count]")).toHaveText(expected.count);
	await expect(root.locator("[data-self-check-parts] label")).toHaveText([...expected.labels]);
	await expect(root.locator("[data-self-check-comparison]")).toBeEmpty();
	await tabTo(page, action(root, "show-feedback"));
	await page.keyboard.press("Enter");
	await expect(root.getByRole("status")).toHaveText(expected.summary);
	await expect(action(root, "show-feedback")).toBeFocused();
	await expect(root.locator("[data-self-check-part-state]")).toHaveText(
		Array(3).fill(expected.toAdd),
	);
	await expect(root.locator("mark sup")).toHaveText([" [1]", " [2]"]);
	const model = root.locator(".praxity-self-check-columns > div").nth(1).locator("p").nth(1);
	await expect(model).toHaveText(
		expected.printedModel.replace("[1]", " [1]").replace("[2]", " [2]"),
	);
	for (const hint of expected.hints)
		await expect(root.getByText(hint, { exact: true })).toBeVisible();
	await expect(learner(page).locator('[data-block-type="selfCheck"]')).toHaveAttribute(
		"data-completed",
		"true",
	);
}
async function reflows(page: Page) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	for (const node of await activity(page)
		.locator(
			"button:visible, textarea:visible, [data-self-check-comparison] > *, [data-self-check-parts] label:visible",
		)
		.all()) {
		expect(
			await node.evaluate((element) => {
				const box = element.getBoundingClientRect();
				return (
					box.left >= -1 &&
					box.right <= innerWidth + 1 &&
					element.scrollWidth <= element.clientWidth + 1
				);
			}),
		).toBe(true);
	}
}
async function axe(page: Page) {
	const builder = new AxeBuilder({ page });
	const result = await builder
		.include(page.frame({ name: "learner" }) ? ["iframe", "html"] : "html")
		.analyze();
	expect(result.violations).toEqual([]);
}

for (const locale of ["en", "fr"] as const) {
	for (const format of [
		"preview",
		"html",
		"scorm12",
		"scorm2004",
		"file",
		"cli-html",
		"cli-scorm-1.2",
		"cli-scorm-2004",
	] as const) {
		test(`${locale} ${format}: keyboard write, compare, edit, restore, print and reset`, async ({
			page,
		}) => {
			const scorm =
				format === "scorm12" || format === "cli-scorm-1.2"
					? "scorm12"
					: format === "scorm2004" || format === "cli-scorm-2004"
						? "scorm2004"
						: undefined;
			if (scorm)
				await page.addInitScript((format) => {
					const values: Record<string, string> = JSON.parse(
						sessionStorage.getItem("s14-lms") ?? "{}",
					);
					values[format === "scorm12" ? "cmi.core.student_id" : "cmi.learner_id"] =
						"release-learner";
					values[format === "scorm12" ? "cmi.core.entry" : "cmi.entry"] = "resume";
					const prefix = format === "scorm12" ? "LMS" : "";
					Reflect.set(window, format === "scorm12" ? "API" : "API_1484_11", {
						[`${prefix}Initialize`]: () => {
							sessionStorage.setItem("s14-lms-initialized", "true");
							return "true";
						},
						[format === "scorm12" ? "LMSFinish" : "Terminate"]: () => "true",
						[`${prefix}Commit`]: () => "true",
						[`${prefix}GetValue`]: (key: string) => values[key] ?? "",
						[`${prefix}SetValue`]: (key: string, value: string) => {
							values[key] = value;
							sessionStorage.setItem("s14-lms", JSON.stringify(values));
							return "true";
						},
						[`${prefix}GetLastError`]: () => "0",
						[`${prefix}GetErrorString`]: () => "",
						[`${prefix}GetDiagnostic`]: () => "",
					});
				}, scorm);
			const privateInLms = async () => {
				if (!scorm) return;
				expect(await page.evaluate(() => sessionStorage.getItem("s14-lms-initialized"))).toBe(
					"true",
				);
				const stored = await page.evaluate(() => sessionStorage.getItem("s14-lms"));
				for (const text of [releaseExpected[locale].answer, "Revised answer", "literal", "final"])
					expect(stored).not.toContain(text);
			};
			await page.goto(
				format === "file"
					? pathToFileURL(join(folder, entries[`html-${locale}`])).href
					: base + entries[`${format}-${locale}`],
			);
			await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
			for (const text of [
				releaseExpected[locale].model,
				...releaseExpected[locale].labels,
				...releaseExpected[locale].hints,
			])
				expect(await learner(page).content()).not.toContain(text);
			await compare(page, locale);
			await privateInLms();
			await tabTo(page, activity(page).locator("textarea"), "Shift+Tab");
			await page.keyboard.press("ControlOrMeta+A");
			await page.keyboard.insertText("Revised answer\n<script>literal</script> & final");
			await expect(activity(page).locator("[data-self-check-comparison]")).toContainText(
				releaseExpected[locale].answer,
			);
			await privateInLms();
			if (format === "preview")
				await expect
					.poll(() => page.evaluate(() => Object.values(sessionStorage).join("\n")))
					.toContain("Revised answer");
			await page.reload();
			await expect(activity(page).locator("textarea")).toHaveValue(
				"Revised answer\n<script>literal</script> & final",
			);
			await expect(activity(page).locator("[data-self-check-comparison] ol li")).toHaveCount(3);
			await expect(activity(page).getByRole("status")).toHaveText("");
			await privateInLms();
			await learner(page).evaluate(() => window.dispatchEvent(new Event("beforeprint")));
			await page.emulateMedia({ media: "print" });
			await expect(activity(page).locator("[data-self-check-print-answer]")).toHaveText(
				"Revised answer\n<script>literal</script> & final",
			);
			await expect(
				activity(page).locator("button:visible, input:visible, textarea:visible"),
			).toHaveCount(0);
			await page.emulateMedia({ media: "screen" });
			await learner(page).evaluate(() => window.dispatchEvent(new Event("afterprint")));
			await tabTo(page, action(activity(page), "start-over"));
			await page.keyboard.press("Enter");
			await expect(activity(page).locator("textarea")).toBeFocused();
			await expect(activity(page).locator("textarea")).toHaveValue("");
			await expect(activity(page).locator("[data-self-check-comparison]")).toBeEmpty();
			await privateInLms();
			await expect(learner(page).locator('[data-block-type="selfCheck"]')).not.toHaveAttribute(
				"data-completed",
				"true",
			);
			await compare(page, locale);
			await privateInLms();
			// Scan last: axe's helper document disturbs Gecko's frame focus.
			await axe(page);
		});
	}
	test(`${locale}: no JavaScript keeps the task and usable answer without spoilers`, async ({
		browser,
	}) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		try {
			const page = await context.newPage();
			await page.goto(base + entries[`html-${locale}`]);
			await expect(activity(page)).toContainText(
				locale === "en"
					? "Comparing your answer with the model requires JavaScript."
					: "La comparaison de votre réponse avec le modèle nécessite JavaScript.",
			);
			await activity(page).locator("textarea").fill(releaseExpected[locale].answer);
			await expect(activity(page).locator("textarea")).toHaveValue(releaseExpected[locale].answer);
			for (const text of [
				releaseExpected[locale].model,
				...releaseExpected[locale].labels,
				...releaseExpected[locale].hints,
			])
				expect(await page.content()).not.toContain(text);
		} finally {
			await context.close();
		}
	});
	test(`${locale}: failed comparison import preserves an editable draft without spoilers`, async ({
		page,
	}) => {
		let failed = 0;
		await page.route(/self-check-support.*\.js/, async (route) => {
			failed++;
			await route.abort();
		});
		await page.goto(base + entries[`html-${locale}`]);
		await tabTo(page, activity(page).locator("textarea"));
		await page.keyboard.insertText(releaseExpected[locale].answer);
		await tabTo(page, action(activity(page), "check"));
		await page.keyboard.press("Enter");
		await expect(activity(page)).toContainText(
			locale === "en"
				? "Comparison is unavailable. You can still write and copy your answer."
				: "La comparaison n'est pas disponible. Vous pouvez encore écrire et copier votre réponse.",
		);
		expect(failed).toBeGreaterThan(0);
		await expect(activity(page).locator("textarea")).toBeEditable();
		await expect(activity(page).locator("textarea")).toHaveValue(releaseExpected[locale].answer);
		for (const text of [
			releaseExpected[locale].model,
			...releaseExpected[locale].labels,
			...releaseExpected[locale].hints,
		])
			expect(await page.content()).not.toContain(text);
	});
	test(`${locale}: failed island import keeps the native answer usable without spoilers`, async ({
		page,
	}) => {
		let failed = 0;
		await page.route("**/island-self-check-*.js", async (route) => {
			failed++;
			await route.abort();
		});
		await page.goto(base + entries[`html-${locale}`]);
		await expect.poll(() => failed).toBeGreaterThan(0);
		await expect(activity(page).locator(".praxity-assessment-stem")).toHaveText(
			releaseExpected[locale].task,
		);
		await activity(page).locator("textarea").fill(releaseExpected[locale].answer);
		await expect(activity(page).locator("textarea")).toHaveValue(releaseExpected[locale].answer);
		for (const text of [
			releaseExpected[locale].model,
			...releaseExpected[locale].labels,
			...releaseExpected[locale].hints,
		])
			expect(await page.content()).not.toContain(text);
	});
	for (const condition of [
		"320px",
		"400%",
		"spacing",
		"RTL",
		"forced colours",
		"reduced motion",
	] as const) {
		test(`${locale}: ${condition} preserves keyboard comparison and reflow`, async ({
			browser,
			page: defaultPage,
		}) => {
			// 400% zoom geometry: 1280x960 physical pixels, 320x240 CSS pixels at scale 4.
			const zoomContext =
				condition === "400%"
					? await browser.newContext({
							viewport: { width: 320, height: 240 },
							deviceScaleFactor: 4,
						})
					: undefined;
			const page = zoomContext ? await zoomContext.newPage() : defaultPage;
			try {
				await page.setViewportSize({ width: condition === "320px" ? 320 : 1280, height: 960 });
				if (condition === "forced colours") await page.emulateMedia({ forcedColors: "active" });
				if (condition === "reduced motion") await page.emulateMedia({ reducedMotion: "reduce" });
				await page.goto(base + entries[`html-${locale}`]);
				if (condition === "400%") {
					await page.setViewportSize({ width: 320, height: 240 });
					expect(
						await page.evaluate(() => ({ width: innerWidth, scale: devicePixelRatio })),
					).toEqual({ width: 320, scale: 4 });
				}
				if (condition === "RTL")
					await page.evaluate(() => {
						document.documentElement.dir = "rtl";
					});
				if (condition === "spacing")
					await page.addStyleTag({
						content:
							"* { line-height:1.5!important; letter-spacing:.12em!important; word-spacing:.16em!important } p { margin-bottom:2em!important }",
					});
				await reflows(page);
				await compare(page, locale);
				await reflows(page);
				if (condition === "320px" || condition === "400%") {
					const columns = activity(page).locator(".praxity-self-check-columns > div");
					const first = await columns.nth(0).boundingBox(),
						second = await columns.nth(1).boundingBox();
					if (!first || !second) throw new Error("Missing comparison columns");
					expect(second.y).toBeGreaterThan(first.y);
				}
				if (condition === "forced colours") {
					expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(
						true,
					);
					expect(
						await action(activity(page), "show-feedback").evaluate(
							(node) => getComputedStyle(node).outlineStyle,
						),
					).not.toBe("none");
				}
				if (condition === "reduced motion") {
					expect(
						await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
					).toBe(true);
					expect(
						await activity(page).evaluate(
							(root) =>
								root
									.getAnimations({ subtree: true })
									.filter((animation) => animation.playState === "running").length,
						),
					).toBe(0);
				}
				await axe(page);
			} finally {
				await zoomContext?.close();
			}
		});
	}
}
