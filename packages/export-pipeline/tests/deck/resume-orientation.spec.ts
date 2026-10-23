import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Frame, type Locator, type Page, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import AdmZip from "adm-zip";
import { DEFAULT_DESIGN_VARIANTS } from "../../../editor-core/src/lib/themes/design-variant-defaults";
import { THEME_PRESET_DEFAULTS } from "../../../editor-core/src/lib/themes/theme-preset-defaults";
import { type CourseExportInput, compileCourse, deployCourse } from "../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../src/desktop-design";
import { expectFocusRing, expectForcedEmulationInert, forcedPalette } from "../focus-assertions";

let server: Server;
let base: string;
const files = new Map<string, Buffer>();
type Format = "scorm12" | "scorm2004";
type Mode = "pages" | "guided" | "static";

// The French title reproduces "compositi / on" at 320px with Larger text. The code URL has
// no break opportunity, so only overflow-wrap can keep it inside the 320px reflow width.
const wrapTitles: Record<string, string> = {
	en: "Building from a composition",
	fr: "Construire à partir d’une composition",
};
const wrapUrl = `https://praxity.example/${"publishedconfiguration".repeat(6)}`;
// This non-dictionary word fits a full line but cannot fit after its preceding word.
// Sans is narrower than the former Book default. Keep the fixture's combined
// heading wider than a phone line while this individual word still fits whole.
const fittingWord = "qqqqqqqqqqqqqqqq";

function course(mode: Mode, locale: string, gated = false, wrap = false): CourseExportInput {
	const pages = splitBlocksIntoPages(
		readLesson(
			[1, 2, 3, 4, 5]
				.map((n) =>
					wrap && n === 1
						? `# ${wrapTitles[locale]}\n\n## \`${wrapUrl}\`\n\n### Configuration: ${fittingWord}\n\nRead place 1.\n`
						: `# Place ${n}\n\nRead place ${n}.\n${gated && n === 2 ? "::: choice Required question {required level=3}\n(x) Correct\n( ) Other\n:::\n" : ""}`,
				)
				.join("\n"),
		).blocks,
		"Orientation",
	);
	pages.forEach((page, index) => {
		page.id = `place-${index + 1}`;
		page.lessonId = gated && index >= 3 ? "second-module" : "orientation";
		page.lessonTitle = gated && index >= 3 ? "Second module" : "Orientation";
		page.isFirstPageOfLesson = index === 0 || (gated && index === 3);
		page.narrationEnabled = false;
		for (const block of page.blocks) if (block.type === "assessment") block.id = "required-check";
	});
	return {
		id: `orientation-${mode}-${locale}-${gated}${wrap ? "-wrap" : ""}`,
		title: "Orientation",
		sourceLocale: locale,
		content: pages,
		navigationStyle: mode === "guided" ? "slides" : "sidebar",
		...(mode === "static" ? { navToggles: { navTopBar: false, showA11yPill: false } } : {}),
		...(mode === "guided"
			? { moduleDeck: { gates: gated ? { "required-check": "pass" } : {} } }
			: {}),
	};
}

// A local same-origin LMS keeps the SCO's CMI data over iframe unload and relaunch.
// Entry is supplied for each new session, while Commit persists location, exit and suspend data.
function lmsHtml(): string {
	return `<!doctype html><html lang="en"><title>Local LMS</title><style>body{margin:0}</style><body><iframe title="Course" style="width:100%;height:100dvh;border:0"></iframe><script>
const params = new URLSearchParams(location.search);
const path = params.get('course');
const format = params.get('format');
const key = 'lms:' + path;
const values = JSON.parse(localStorage.getItem(key) || '{}');
const entry = params.get('entry') || 'ab-initio';
const get = name => name === 'cmi.core.entry' || name === 'cmi.entry' ? entry : values[name] || '';
const set = (name, value) => { values[name] = String(value); return 'true'; };
const commit = () => { localStorage.setItem(key, JSON.stringify(values)); return 'true'; };
const api = format === 'scorm12'
 ? { LMSInitialize: () => 'true', LMSGetValue: get, LMSSetValue: set, LMSCommit: commit, LMSFinish: commit, LMSGetLastError: () => '0', LMSGetErrorString: () => '', LMSGetDiagnostic: () => '' }
 : { Initialize: () => 'true', GetValue: get, SetValue: set, Commit: commit, Terminate: commit, GetLastError: () => '0', GetErrorString: () => '', GetDiagnostic: () => '' };
window[format === 'scorm12' ? 'API' : 'API_1484_11'] = params.get('frozen') === 'true' ? Object.freeze(api) : api;
document.querySelector('iframe').src = path + '/index.html' + (params.get('target') || '');
</script></body></html>`;
}

test.beforeAll(async () => {
	test.setTimeout(120_000);
	for (const mode of ["pages", "guided", "static"] as const) {
		for (const locale of ["en", "fr"]) {
			if (mode === "static" && locale !== "en") continue;
			for (const gated of [false, true]) {
				if (gated && (mode !== "guided" || locale !== "en")) continue;
				const artifact = await compileCourse(course(mode, locale, gated));
				try {
					for (const format of ["html", "scorm12", "scorm2004"] as const) {
						const result = await deployCourse(artifact, { format });
						const prefix = `/${mode}-${locale}-${gated}-${format}`;
						for (const entry of new AdmZip(result.zip).getEntries()) {
							if (!entry.isDirectory) files.set(`${prefix}/${entry.entryName}`, entry.getData());
						}
					}
				} finally {
					await artifact.dispose();
				}
			}
		}
	}
	for (const mode of ["pages", "guided"] as const) {
		const input = course(mode, "en");
		input.customCss = "#main-content h1 { display: none; }";
		const visibleHeading = readLesson("# Visible content {hideTitle}\n\n## Visible content\n")
			.pages[0].blocks[0];
		visibleHeading.id = "visible-resume-heading";
		input.content[3].blocks.push(visibleHeading);
		const artifact = await compileCourse(input);
		try {
			for (const format of ["scorm12", "scorm2004"] as const) {
				const result = await deployCourse(artifact, { format });
				for (const entry of new AdmZip(result.zip).getEntries()) {
					if (!entry.isDirectory)
						files.set(`/${mode}-hidden-false-${format}/${entry.entryName}`, entry.getData());
				}
			}
		} finally {
			await artifact.dispose();
		}
	}
	// Exercise authored name overrides and absent headings without changing canonical titles.
	for (const mode of ["pages", "guided"] as const) {
		for (const variant of ["label", "labelledby", "missing", "fr-label"] as const) {
			for (const format of ["scorm12", "scorm2004"] as const) {
				const original = `/${mode}-${variant === "fr-label" ? "fr" : "en"}-false-${format}/`;
				for (const [path, bytes] of [...files]) {
					if (!path.startsWith(original)) continue;
					let output = bytes;
					if (path.endsWith(".html")) {
						output = Buffer.from(
							bytes
								.toString()
								.replace(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/g, (heading, attrs, title) => {
									if (title.replace(/<[^>]*>/g, "").trim() !== "Place 4") return heading;
									if (variant === "missing") return `<p${attrs}>${title}</p>`;
									if (variant === "label" || variant === "fr-label")
										return `<h1${attrs} aria-label="Authored heading">${title}</h1>`;
									return `<span id="authored-resume-name" hidden>Authored heading</span><h1${attrs} aria-labelledby="authored-resume-name">${title}</h1>`;
								}),
						);
					}
					files.set(path.replace(original, `/${mode}-${variant}-false-${format}/`), output);
				}
			}
		}
	}
	// The standard theme's display face and h1 size leave "composition" wider than a 320px line.
	const standard = extractDesktopDesignFromFrontmatter({
		design: {
			...DEFAULT_DESIGN_VARIANTS,
			...THEME_PRESET_DEFAULTS.standard,
			palette: "standard",
			colorMode: "light",
		},
	});
	for (const mode of ["pages", "guided"] as const) {
		for (const locale of ["en", "fr"]) {
			const artifact = await compileCourse({ ...standard, ...course(mode, locale, false, true) });
			try {
				const result = await deployCourse(artifact, { format: "html" });
				for (const entry of new AdmZip(result.zip).getEntries()) {
					if (!entry.isDirectory)
						files.set(`/${mode}-${locale}-wrap-html/${entry.entryName}`, entry.getData());
				}
			} finally {
				await artifact.dispose();
			}
		}
	}
	server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		const bytes =
			path === "/lms"
				? Buffer.from(lmsHtml())
				: path === "/left"
					? Buffer.from(
							'<!doctype html><html lang="en"><title>Left course</title><body>Left course</body></html>',
						)
					: files.get(path);
		res.writeHead(bytes ? 200 : 404, {
			"Content-Type":
				(
					{
						html: "text/html",
						js: "text/javascript",
						css: "text/css",
						woff2: "font/woff2",
					} as Record<string, string>
				)[path.split(".").at(-1) ?? ""] ??
				(path === "/lms" || path === "/left" ? "text/html" : "application/octet-stream"),
		});
		res.end(bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing LMS address");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	if (!server) return;
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
});

async function observeMessages(page: Page) {
	await page.addInitScript(() => {
		const messages: string[] = [];
		const focusTargets: string[] = [];
		Object.assign(window, { resumeMessages: messages, resumeFocusTargets: focusTargets });
		document.addEventListener("focusin", (event) => {
			if (event.target instanceof HTMLElement)
				focusTargets.push(event.target.id || event.target.tagName);
		});
		new MutationObserver((records) => {
			for (const record of records) {
				const target =
					record.target instanceof Element ? record.target : record.target.parentElement;
				if (target?.matches("#praxity-live-region,#deck-announcement")) {
					const text =
						record.type === "childList"
							? [...record.addedNodes].map((node) => node.textContent).join("")
							: record.target.textContent;
					if (text) messages.push(text);
				}
			}
		}).observe(document, { childList: true, characterData: true, subtree: true });
	});
}

async function launch(
	page: Page,
	mode: Mode,
	format: Format,
	entry = "ab-initio",
	locale = "en",
	gated = false,
	target = "",
	frozen = false,
): Promise<Frame> {
	const params = new URLSearchParams({
		course: `/${mode}-${locale}-${gated}-${format}`,
		format,
		entry,
		target,
		frozen: String(frozen),
	});
	await page.goto(`${base}/lms?${params}`);
	const iframe = await page.locator("iframe").elementHandle();
	const frame = await iframe?.contentFrame();
	if (!frame) throw new Error("Missing course frame");
	await ready(frame, mode);
	return frame;
}

async function ready(frame: Frame, mode: Mode) {
	if (mode === "guided")
		await expect(frame.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	else if (mode === "static") await frame.waitForFunction(() => !!window.__praxityRuntime);
	else
		await expect(frame.locator('[data-island="nav"]').first()).toHaveAttribute("data-hydrated", "");
}

// Earn access through the real writer: a cached release alone is no answer evidence.
async function earnGuidedGate(page: Page, format: Format) {
	const frame = await launch(page, "guided", format, "ab-initio", "en", true);
	await frame.locator("#deck-next").click();
	await frame.getByRole("radio", { name: "Correct", exact: true }).check();
	await frame.locator("[data-assessment-submit]").click();
	await frame.locator("#deck-next").click();
	await expect(frame.locator('[data-deck-slide="place-3"] h1')).toBeVisible();
	await page.goto(`${base}/left`);
}

async function next(frame: Frame, mode: Mode, place: number) {
	if (mode === "guided") await frame.locator("#deck-next").click();
	else await frame.locator("a.praxity-nav-next:visible").last().click();
	if (mode === "guided" && (await frame.locator("#deck-completion").isVisible())) {
		await expect(frame.locator("#deck-completion h1")).toHaveText("Module complete");
		await expect(frame.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		await expect(frame.locator("#deck-next")).toHaveAccessibleName("Next module: Second module");
		await frame.locator("#deck-next").click();
	}
	await expect(
		frame.locator(mode === "guided" ? `[data-deck-slide="place-${place}"] h1` : "main h1").first(),
	).toHaveText(`Place ${place}`);
	await ready(frame, mode);
	await expect(
		frame.locator(mode === "guided" ? `[data-deck-slide="place-${place}"] h1` : "main h1").first(),
	).toHaveText(`Place ${place}`);
	await expect(frame.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
}

async function messages(frame: Frame): Promise<string[]> {
	// Wait past the old 500ms resume timer to detect duplicate product writes as well.
	await frame.waitForTimeout(650);
	return frame.evaluate(() => (window as unknown as { resumeMessages: string[] }).resumeMessages);
}

async function checkCuePresentation(page: Page, frame: Frame, selector: string) {
	const cue = frame.locator(selector);
	await expect(cue).toBeVisible();
	await expect(cue).toBeInViewport();
	const appearance = await cue.evaluate((element) => {
		const style = getComputedStyle(element);
		let surface: Element | null = element;
		let background = "";
		while (surface) {
			const candidate = getComputedStyle(surface).backgroundColor;
			if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") {
				background = candidate;
				break;
			}
			surface = surface.parentElement;
		}
		const toHex = (color: string) => {
			// Read rendered sRGB bytes for both RGB and OKLCH computed colours.
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = 1;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas 2D context unavailable");
			if (!CSS.supports("color", color)) throw new Error(`Invalid colour: ${color}`);
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			const channels = context.getImageData(0, 0, 1, 1).data;
			if (channels[3] !== 255) throw new Error(`Expected opaque colour: ${color}`);
			return `#${Array.from(channels.slice(0, 3))
				.map((value) => value.toString(16).padStart(2, "0"))
				.join("")}`;
		};
		const focused = element.matches("p") ? element : element.parentElement;
		if (!focused) throw new Error("Missing cue focus target");
		const focusStyle = getComputedStyle(focused);
		return {
			foreground: toHex(style.color),
			background: toHex(background),
			size: Number.parseFloat(style.fontSize),
			outline: focusStyle.outlineStyle,
			outlineWidth: focusStyle.outlineWidth,
		};
	});
	expect(contrastRatio(appearance.foreground, appearance.background)).toBeGreaterThanOrEqual(4.5);
	expect(appearance.outline).toBe("solid");
	expect(appearance.outlineWidth).toBe("2px");
	// The cue keeps body tracking, not the heading's display tracking, and starts
	// on the same edge as the text it introduces.
	const layout = await cue.evaluate((element) => {
		const textLeft = (node: Node) => {
			const range = document.createRange();
			range.selectNodeContents(node);
			return range.getClientRects()[0]?.left ?? Number.NaN;
		};
		const reference = element.matches("p")
			? element.parentElement?.querySelector(".deck-panel-title")
			: element.nextSibling;
		return {
			letterSpacing: getComputedStyle(element).letterSpacing,
			cueLeft: textLeft(element),
			referenceLeft: reference ? textLeft(reference) : Number.NaN,
		};
	});
	expect(layout.letterSpacing).toBe("normal");
	expect(Math.abs(layout.cueLeft - layout.referenceLeft)).toBeLessThanOrEqual(1);
	if (selector === ".praxity-resume-prefix") {
		const focusRing = () =>
			frame.evaluate(() => {
				const style = getComputedStyle(document.activeElement ?? document.body);
				return { style: style.outlineStyle, offset: Number.parseFloat(style.outlineOffset) };
			});
		// A printed page shows no focus ring around the title.
		await page.emulateMedia({ media: "print" });
		expect((await focusRing()).style).toBe("none");
		// High-contrast rings stay outside the heading's glyphs.
		await page.emulateMedia({ media: "screen", forcedColors: "active" });
		if (!(await forcedPalette(frame))) {
			const focused = frame.locator(":focus");
			await expectForcedEmulationInert(page, [focused]);
			await expectFocusRing(focused, 2);
		} else {
			expect((await focusRing()).offset).toBeGreaterThan(0);
		}
		await page.emulateMedia({ forcedColors: "none" });
	}
	const sheetWasOpen = await frame.locator("dialog:modal").count();
	if (sheetWasOpen) await page.keyboard.press("Escape");
	const more = frame.locator("#deck-more-toggle");
	if ((await more.isVisible()) && (await more.getAttribute("aria-expanded")) !== "true")
		await more.click();
	await frame.locator('[data-a11y-action="text"]').first().click();
	if (sheetWasOpen) {
		await frame.locator("#deck-script-toggle").click();
		await expect(frame.locator("dialog:modal")).toBeVisible();
	}
	expect(
		await cue.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
	).toBeGreaterThan(appearance.size);
	await page.setViewportSize({ width: 320, height: 844 });
	await expect(cue).toBeVisible();
	expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
		true,
	);
	expect(
		await cue.evaluate((element) => {
			const range = document.createRange();
			range.selectNodeContents(element);
			return [...range.getClientRects()].every(
				(rect) => rect.left >= 0 && rect.right <= innerWidth + 1,
			);
		}),
	).toBe(true);
	// Moving focus to a reading preference never dismisses the arrival cue.
	await expect(cue).toBeVisible();
	await page.emulateMedia({ media: "print" });
	await expect(cue).toBeHidden();
	await expect(
		selector === ".praxity-resume-prefix" ? cue.locator("..") : frame.locator("#deck-script-title"),
	).toBeVisible();
	await page.emulateMedia({ media: "screen", forcedColors: "active" });
	await expect(cue).toBeVisible();
	await page.emulateMedia({ forcedColors: "none" });
	// A top-layer cue cannot scroll the LMS's outer document; align its frame first.
	if (sheetWasOpen) {
		const host = await frame.frameElement();
		await host.evaluate((element) => {
			if (!(element instanceof HTMLElement)) throw new Error("Missing LMS course frame");
			element.scrollIntoView({ block: "start" });
		});
	}
	await cue.scrollIntoViewIfNeeded();
	await expect(cue).toBeInViewport();
}

async function checkFallbackText(
	summary: Locator,
	position: string,
	fullText: string,
): Promise<void> {
	await expect(summary).toHaveText(fullText);
	await expect(summary).toMatchAriaSnapshot(
		`- paragraph: ${JSON.stringify(`${position} ${fullText.slice(position.length).trimStart()}`)}`,
	);
	expect(await summary.evaluate((element) => element.firstChild?.textContent)).toBe(position);
	const hiddenTitle = summary.locator(".praxity-a11y-sr-only");
	await expect(hiddenTitle).toHaveText(fullText.slice(position.length));
	const box = await hiddenTitle.boundingBox();
	expect(box?.width).toBe(1);
	expect(box?.height).toBe(1);
	expect(await hiddenTitle.evaluate((element) => getComputedStyle(element).clip)).toBe(
		"rect(0px, 0px, 0px, 0px)",
	);
}

for (const format of ["scorm12", "scorm2004"] as const) {
	test(`${format} static Pages resumes with focus and one cue without a nav island`, async ({
		page,
	}) => {
		const cueRequests: string[] = [];
		page.on("request", (request) => {
			if (/\/course-resume-[A-Z0-9]{8}\.js$/u.test(request.url())) cueRequests.push(request.url());
		});
		await observeMessages(page);
		let frame = await launch(page, "static", format);
		for (const place of [2, 3, 4]) await next(frame, "static", place);
		expect(cueRequests).toHaveLength(0);
		await page.goto(`${base}/left`);
		frame = await launch(page, "static", format, "resume");
		await expect(frame.locator('[data-island="nav"]')).toHaveCount(0);
		const heading = frame.locator("main h1").first();
		await expect(heading).toHaveText("Resumed at page 4 of 5: Place 4");
		await expect(heading).toHaveAccessibleName("Resumed at page 4 of 5: Place 4");
		await expect(heading).toBeVisible();
		await expect(heading).toBeFocused();
		expect(cueRequests).toHaveLength(1);
		await expect(frame.locator('script[src*="course-resume-"]')).not.toHaveAttribute(
			"type",
			"module",
		);
		expect(await messages(frame)).toEqual([]);
		await next(frame, "static", 5);
		expect((await messages(frame)).some((text) => text.startsWith("Resumed"))).toBe(false);
	});
	test(`${format} static Pages resume loads its cue offline from file URLs`, async ({
		page,
	}, testInfo) => {
		const prefix = `/static-en-false-${format}/`;
		const outputDir = testInfo.outputPath("offline-course");
		for (const [filename, bytes] of files) {
			if (!filename.startsWith(prefix)) continue;
			const destination = path.join(outputDir, filename.slice(prefix.length));
			await mkdir(path.dirname(destination), { recursive: true });
			await writeFile(destination, bytes);
		}
		await page.addInitScript((format) => {
			const values: Record<string, string> = {
				"cmi.core.entry": "resume",
				"cmi.entry": "resume",
				"cmi.core.lesson_location": "index.html?praxity-page=place-4",
				"cmi.location": "index.html?praxity-page=place-4",
				"cmi.core.lesson_status": "incomplete",
			};
			const get = (key: string) => values[key] ?? "";
			const set = (key: string, value: string) => {
				values[key] = value;
				return "true";
			};
			const ok = () => "true";
			Object.assign(
				window,
				format === "scorm12"
					? {
							API: {
								LMSInitialize: ok,
								LMSFinish: ok,
								LMSCommit: ok,
								LMSGetValue: get,
								LMSSetValue: set,
								LMSGetLastError: () => "0",
								LMSGetErrorString: () => "",
								LMSGetDiagnostic: () => "",
							},
						}
					: {
							API_1484_11: {
								Initialize: ok,
								Terminate: ok,
								Commit: ok,
								GetValue: get,
								SetValue: set,
								GetLastError: () => "0",
								GetErrorString: () => "",
								GetDiagnostic: () => "",
							},
						},
			);
		}, format);
		await page.goto(pathToFileURL(path.join(outputDir, "index.html")).href);
		const heading = page.locator("main h1").first();
		await expect(heading).toHaveText("Resumed at page 4 of 5: Place 4");
		await expect(heading).toBeFocused();
		await expect(page.locator('[data-island="nav"]')).toHaveCount(0);
		// Firefox does not report local script loads through Playwright's request
		// events. Verify the loaded classic entry and its resulting focus instead.
		const cueScript = page.locator('script[src*="course-resume-"]');
		await expect(cueScript).toHaveCount(1);
		await expect(cueScript).not.toHaveAttribute("type", "module");
		expect(await cueScript.evaluate((script) => (script as HTMLScriptElement).src)).toMatch(
			/^file:\/\/.*\/course-resume-[A-Z0-9]{8}\.js$/u,
		);
	});
	for (const mode of ["pages", "guided"] as const) {
		for (const variant of ["label", "labelledby", "missing", "fr-label"]) {
			test(`${format} ${mode} ${variant} uses one visible summary focus`, async ({ page }) => {
				await observeMessages(page);
				await page.goto(`${base}/left`);
				await page.evaluate(
					({ mode, variant, format }) =>
						localStorage.setItem(
							`lms:/${mode}-${variant}-false-${format}`,
							JSON.stringify({
								[format === "scorm12" ? "cmi.core.lesson_location" : "cmi.location"]:
									"index.html?praxity-page=place-4",
								"cmi.suspend_data": JSON.stringify({
									visitedPages: ["place-1", "place-2", "place-3"],
									interactions: [],
								}),
							}),
						),
					{ mode, variant, format },
				);
				const frame = await launch(page, mode, format, "resume", variant);
				const summary = frame.locator(".praxity-resume-summary");
				const position =
					variant === "fr-label"
						? `Reprise à la ${mode === "guided" ? "diapositive" : "page"} 4 sur 5`
						: `Resumed at ${mode === "guided" ? "slide" : "page"} 4 of 5`;
				await checkFallbackText(
					summary,
					position,
					`${position}${variant === "fr-label" ? "\u00a0" : ""}: Place 4`,
				);
				await expect(summary).toBeVisible();
				await expect(summary).toBeFocused();
				await expect(summary).toHaveAttribute("tabindex", "-1");
				if (variant !== "missing") {
					const heading = frame
						.locator(mode === "guided" ? '[data-deck-slide="place-4"] h1' : "main h1")
						.first();
					await expect(heading).toHaveAccessibleName("Authored heading");
					await expect(heading).toHaveText("Place 4");
					await expect(heading).not.toBeFocused();
					// In slide layouts the summary sits outside the padded slide; it must
					// still line up with the heading it introduces.
					const [summaryBox, headingBox] = await Promise.all([
						summary.boundingBox(),
						heading.boundingBox(),
					]);
					expect(
						Math.abs((summaryBox?.x ?? 0) - (headingBox?.x ?? Number.NaN)),
					).toBeLessThanOrEqual(1);
				}
				expect(await messages(frame)).toEqual([]);
				expect(
					await frame.evaluate(
						() => (window as unknown as { resumeFocusTargets: string[] }).resumeFocusTargets,
					),
				).toEqual(["P"]);
				if (mode === "guided") {
					await summary.press("ArrowRight");
					await expect(frame.locator('[data-deck-slide="place-5"] h1')).toBeFocused();
				} else await next(frame, mode, 5);

				await expect(frame.locator(".praxity-resume-summary,.praxity-resume-prefix")).toHaveCount(
					0,
				);
			});
		}
		test(`${format} ${mode} skips a hidden heading when focusing resumed content`, async ({
			page,
		}) => {
			await observeMessages(page);
			let frame = await launch(page, mode, format, "ab-initio", "hidden");
			for (const place of [2, 3, 4]) await next(frame, mode, place);
			await page.goto(`${base}/left`);
			frame = await launch(page, mode, format, "resume", "hidden");
			const heading = frame.getByRole("heading", { name: "Visible content" });
			await expect(heading).toBeVisible();
			const summary = frame.locator(".praxity-resume-summary");
			await expect(summary).toHaveText(
				`Resumed at ${mode === "guided" ? "slide" : "page"} 4 of 5: Place 4`,
			);
			await expect(summary).toBeVisible();
			await expect(summary).toBeFocused();
			await expect(heading).not.toBeFocused();
			expect(await messages(frame)).toEqual([]);
		});
		for (const locale of ["en", "fr"]) {
			test(`${format} ${mode} ${locale} resumes place 4 once with visible content focus`, async ({
				page,
			}, testInfo) => {
				await observeMessages(page);
				if (locale === "en" && format === "scorm12")
					await page.setViewportSize({ width: 320, height: 844 });
				let frame = await launch(page, mode, format, "ab-initio", locale);
				for (const place of [2, 3, 4]) await next(frame, mode, place);
				const key = `lms:/${mode}-${locale}-false-${format}`;
				expect(
					await page.evaluate(
						({ key, format }) =>
							JSON.parse(localStorage.getItem(key) ?? "{}")[
								format === "scorm12" ? "cmi.core.exit" : "cmi.exit"
							],
						{ key, format },
					),
				).toBe("suspend");
				await page.goto(`${base}/left`);
				frame = await launch(page, mode, format, "resume", locale);
				const heading = frame
					.locator(mode === "guided" ? '[data-deck-slide="place-4"] h1' : "main h1")
					.first();
				await expect(heading).toBeVisible();
				const expected =
					locale === "fr"
						? `Reprise à la ${mode === "guided" ? "diapositive" : "page"} 4 sur 5 : Place 4`
						: `Resumed at ${mode === "guided" ? "slide" : "page"} 4 of 5: Place 4`;
				await expect(heading).toHaveText(expected);
				await expect(heading).toHaveAccessibleName(expected);
				if (mode === "guided") {
					await expect(frame.locator('[data-deck-slide="place-4"]')).toHaveAccessibleName(
						locale === "fr" ? "Diapositive 4 sur 5" : "Slide 4 of 5",
					);
				}
				expect(await messages(frame)).toEqual([]);
				expect(await frame.evaluate(() => document.title)).toBe("Place 4");
				expect(
					await frame.locator("nav, [data-native-floating-toc]").allTextContents(),
				).not.toEqual(expect.arrayContaining([expect.stringContaining(expected)]));
				expect(
					await frame.evaluate(
						() => (window as unknown as { resumeFocusTargets: string[] }).resumeFocusTargets,
					),
				).toHaveLength(1);
				await expect(heading).toBeFocused();
				expect(await heading.evaluate((element) => !!element.closest("[hidden],[inert]"))).toBe(
					false,
				);
				const inventory = await frame.evaluate(() =>
					[
						...document.querySelectorAll(
							"main,nav,aside,header,footer,[role='region'],section[aria-label],section[aria-labelledby]",
						),
					]
						.filter((element) => !element.closest("[hidden],[inert]"))
						.map((element) => ({
							tag: element.tagName,
							role: element.getAttribute("role"),
							label: element.getAttribute("aria-label"),
							labelledBy: element.getAttribute("aria-labelledby"),
							id: element.id,
						})),
				);
				await testInfo.attach("resumed-landmarks", {
					body: JSON.stringify(inventory, null, 2),
					contentType: "application/json",
				});
				expect(await frame.evaluate(() => window.__praxityRuntime?.getVisitedPages?.())).toEqual(
					expect.arrayContaining(["place-1", "place-2", "place-3", "place-4"]),
				);
				if (locale === "en" && format === "scorm12")
					await checkCuePresentation(page, frame, ".praxity-resume-prefix");
				if (locale === "en" && format === "scorm12") {
					const screenshot = testInfo.outputPath("resume-cue-320px.png");
					await page.screenshot({ path: screenshot });
					await testInfo.attach("resume-cue-320px", {
						path: screenshot,
						contentType: "image/png",
					});
				}
				await next(frame, mode, 5);
				if (mode === "pages") {
					await frame.evaluate(() => history.back());
					await expect(frame.locator("main h1").first()).toHaveText("Place 4");
					await expect(frame.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(
						0,
					);
					await frame.evaluate(() => history.forward());
					await expect(frame.locator("main h1").first()).toHaveText("Place 5");
					await ready(frame, mode);
				}
				await expect(frame.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(
					0,
				);
				expect(
					(await messages(frame)).filter(
						(text) => text.startsWith("Resumed") || text.startsWith("Reprise"),
					),
				).toHaveLength(0);
				for (const place of [4, 3, 2, 1]) {
					if (mode === "guided") await frame.locator("#deck-previous").click();
					else await frame.locator("a.praxity-nav-prev:visible").last().click();
					await ready(frame, mode);
					await expect(
						frame
							.locator(mode === "guided" ? `[data-deck-slide="place-${place}"] h1` : "main h1")
							.first(),
					).toHaveText(`Place ${place}`);
				}
				expect(
					(await messages(frame)).filter(
						(text) => text.startsWith("Resumed") || text.startsWith("Reprise"),
					),
				).toHaveLength(0);
			});
		}
		test(`${format} ${mode} ab-initio does not issue a resume cue for a saved bookmark`, async ({
			page,
		}) => {
			await observeMessages(page);
			const cueRequests: string[] = [];
			page.on("request", (request) => {
				if (/\/course-resume-[A-Z0-9]{8}\.js$/u.test(request.url()))
					cueRequests.push(request.url());
			});
			let frame = await launch(page, mode, format);
			for (const place of [2, 3, 4]) await next(frame, mode, place);
			frame = await launch(page, mode, format, "ab-initio");
			await expect(
				frame.locator(mode === "guided" ? '[data-deck-slide="place-1"] h1' : "main h1").first(),
			).toHaveText("Place 1");
			expect(cueRequests).toHaveLength(0);
			expect((await messages(frame)).some((text) => text.startsWith("Resumed"))).toBe(false);
		});
		for (const destination of [1, 2, 4]) {
			test(`${format} ${mode} explicit deep link to place ${destination} keeps its destination and no resume cue`, async ({
				page,
			}) => {
				await observeMessages(page);
				let frame = await launch(page, mode, format);
				for (const place of [2, 3, 4]) await next(frame, mode, place);
				frame = await launch(
					page,
					mode,
					format,
					"resume",
					"en",
					false,
					`?praxity-page=place-${destination}`,
				);
				await expect(
					frame
						.locator(mode === "guided" ? `[data-deck-slide="place-${destination}"] h1` : "main h1")
						.first(),
				).toHaveText(`Place ${destination}`);
				expect((await messages(frame)).some((text) => text.startsWith("Resumed"))).toBe(false);
			});
		}
		test(`${format} ${mode} missing LMS falls back locally without resume orientation`, async ({
			page,
		}) => {
			await observeMessages(page);
			await page.goto(`${base}/${mode}-en-false-${format}/index.html`);
			await ready(page.mainFrame(), mode);
			for (const place of [2, 3, 4]) await next(page.mainFrame(), mode, place);
			await page.goto(`${base}/${mode}-en-false-${format}/index.html`);
			await ready(page.mainFrame(), mode);
			await expect(
				page.locator(mode === "guided" ? '[data-deck-slide="place-1"] h1' : "main h1").first(),
			).toHaveText("Place 1");
			expect((await messages(page.mainFrame())).some((text) => text.startsWith("Resumed"))).toBe(
				false,
			);
			expect(await page.evaluate(() => window.__praxityRuntime?.getVisitedPages?.())).toEqual(
				expect.arrayContaining(["place-4"]),
			);
		});
	}
	test(`${format} narrow Guided deep link retains stored-panel focus without a resume cue`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await observeMessages(page);
		let frame = await launch(page, "guided", format);
		for (const place of [2, 3, 4]) await next(frame, "guided", place);
		await page.evaluate(() =>
			localStorage.setItem("praxity:deck-panel:orientation-guided-en-false", "script"),
		);
		await page.goto(`${base}/left`);
		frame = await launch(page, "guided", format, "resume", "en", false, "?praxity-page=place-2");
		await expect(frame.locator("#deck-script-title")).toBeFocused();
		await expect(frame.locator('[data-deck-reading="place-2"]')).toBeVisible();
		expect((await messages(frame)).some((text) => text.startsWith("Resumed"))).toBe(false);
	});
	for (const panel of ["script", "outline"] as const) {
		test(`${format} narrow Guided resume focuses the intentionally opened ${panel} panel once`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await observeMessages(page);
			let frame = await launch(page, "guided", format);
			for (const place of [2, 3, 4]) await next(frame, "guided", place);
			await page.evaluate(
				(panel) => localStorage.setItem("praxity:deck-panel:orientation-guided-en-false", panel),
				panel,
			);
			await page.goto(`${base}/left`);
			frame = await launch(page, "guided", format, "resume");
			expect(await frame.evaluate(() => innerWidth)).toBeLessThan(950);
			await expect(frame.locator(".praxity-deck")).toHaveAttribute("data-panel", panel);
			const panelHeading = frame.locator(`#deck-${panel}-title`);
			await expect(panelHeading).toBeVisible();
			await expect(panelHeading).toHaveText(panel === "script" ? "Transcript" : "Course outline");
			const summary = frame.locator(`#deck-${panel} > .praxity-resume-summary`);
			await checkFallbackText(
				summary,
				"Resumed at slide 4 of 5",
				"Resumed at slide 4 of 5: Place 4",
			);
			await expect(summary).toBeVisible();
			await expect(summary).toBeFocused();
			if (panel === "script")
				await expect(frame.locator('[data-deck-reading="place-4"]')).toBeVisible();
			expect(
				await frame.evaluate(
					() => (window as unknown as { resumeFocusTargets: string[] }).resumeFocusTargets,
				),
			).toEqual(["P"]);
			expect(await frame.locator("main").evaluate((element) => element.hasAttribute("inert"))).toBe(
				true,
			);
			expect(await messages(frame)).toEqual([]);
			if (panel === "script" && format === "scorm12") {
				await checkCuePresentation(page, frame, "#deck-script > .praxity-resume-summary");
				const screenshot = testInfo.outputPath("resume-summary-320px.png");
				await page.screenshot({ path: screenshot });
				await testInfo.attach("resume-summary-320px", {
					path: screenshot,
					contentType: "image/png",
				});
			}
			expect(
				await page.evaluate(() =>
					localStorage.getItem("praxity:deck-panel:orientation-guided-en-false"),
				),
			).toBe(panel);
		});
	}
	test(`${format} unrelated Guided deep link keeps a cross-module gate redirect outside resume`, async ({
		page,
	}, testInfo) => {
		await observeMessages(page);
		await page.goto(`${base}/left`);
		await page.evaluate(
			({ format }) =>
				localStorage.setItem(
					`lms:/guided-en-true-${format}`,
					JSON.stringify({
						[format === "scorm12" ? "cmi.core.lesson_location" : "cmi.location"]:
							"index.html?praxity-page=place-2",
						"cmi.suspend_data": JSON.stringify({ visitedPages: ["place-1"], interactions: [] }),
					}),
				),
			{ format },
		);
		const frame = await launch(
			page,
			"guided",
			format,
			"resume",
			"en",
			true,
			"?praxity-page=place-4",
		);
		await expect(frame.locator('[data-deck-slide="place-2"] h1')).toBeVisible();
		await testInfo.attach("gate-return-state", {
			body: JSON.stringify(
				await frame.evaluate(() => ({
					url: location.href,
					status: document.getElementById("deck-status")?.textContent,
					visits: window.__praxityRuntime?.getVisitedPages?.(),
				})),
				null,
				2,
			),
			contentType: "application/json",
		});
		await expect(frame.locator(".deck-gate-notice")).toBeVisible();
		expect((await messages(frame)).some((text) => text.startsWith("Resumed"))).toBe(false);
	});
	test(`${format} denied Guided bookmark orients the allowed required slide`, async ({ page }) => {
		await observeMessages(page);
		await page.goto(`${base}/left`);
		await page.evaluate(
			({ format }) => {
				localStorage.setItem(
					`lms:/guided-en-true-${format}`,
					JSON.stringify({
						[format === "scorm12" ? "cmi.core.lesson_location" : "cmi.location"]:
							"index.html?praxity-page=place-4",
						"cmi.suspend_data": JSON.stringify(
							format === "scorm12"
								? {
										visitedPages: ["place-1"],
										interactions: [],
										custom: JSON.stringify({ deck: { released: [] } }),
									}
								: { visitedPages: ["place-1"], deck: { released: [] } },
						),
					}),
				);
			},
			{ format },
		);
		const frame = await launch(page, "guided", format, "resume", "en", true);
		await expect(frame.locator('[data-deck-slide="place-2"] h1')).toBeVisible();
		await expect(frame.locator('[data-deck-slide="place-2"] h1')).toBeFocused();
		await expect(frame.locator('[data-deck-slide="place-2"] h1')).toHaveAccessibleName(
			"Resumed at slide 2 of 3: Place 2",
		);
		expect(await messages(frame)).toEqual([]);
		await expect(frame.locator(".deck-gate-notice")).toBeVisible();
		await expect(frame.locator('[data-deck-slide="place-4"]')).toHaveCount(0);
	});
	test(`${format} Guided module departure and browser Back remove the restored cue`, async ({
		page,
	}) => {
		await earnGuidedGate(page, format);
		await observeMessages(page);
		await page.evaluate(
			({ format }) => {
				const key = `lms:/guided-en-true-${format}`;
				const values = JSON.parse(localStorage.getItem(key) ?? "{}");
				values[format === "scorm12" ? "cmi.core.lesson_location" : "cmi.location"] =
					"index.html?praxity-page=place-3";
				localStorage.setItem(key, JSON.stringify(values));
			},
			{ format },
		);
		const frame = await launch(page, "guided", format, "resume", "en", true);
		await expect(frame.locator('[data-deck-slide="place-3"] h1')).toHaveAccessibleName(
			"Resumed at slide 3 of 3: Place 3",
		);
		await frame.locator("#deck-next").click();
		await expect(frame.locator("#deck-completion h1")).toHaveText("Module complete");
		await expect(frame.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		await expect(frame.locator("#deck-next")).toHaveAccessibleName("Next module: Second module");
		await frame.locator("#deck-next").click();
		await expect(frame.locator('[data-deck-slide="place-4"] h1')).toHaveText("Place 4");
		await ready(frame, "guided");
		await expect(frame.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		await frame.evaluate(() => history.back());
		await expect(frame.locator('[data-deck-slide="place-3"] h1')).toHaveText("Place 3");
		await ready(frame, "guided");
		await expect(frame.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		expect(await messages(frame)).toEqual([]);
	});
	test(`${format} Guided resumes in a later module after earned gate access`, async ({ page }) => {
		await earnGuidedGate(page, format);
		await observeMessages(page);
		await page.evaluate(
			({ format }) => {
				const key = `lms:/guided-en-true-${format}`;
				const values = JSON.parse(localStorage.getItem(key) ?? "{}");
				values[format === "scorm12" ? "cmi.core.lesson_location" : "cmi.location"] =
					"index.html?praxity-page=place-4";
				localStorage.setItem(key, JSON.stringify(values));
			},
			{ format },
		);
		const frame = await launch(page, "guided", format, "resume", "en", true);
		await expect(frame.locator('[data-deck-slide="place-4"] h1')).toBeFocused();
		await expect(frame.locator('[data-deck-slide="place-4"] h1')).toHaveAccessibleName(
			"Resumed at slide 1 of 2: Place 4",
		);
		expect(await messages(frame)).toEqual([]);
	});
	test(`${format} Pages Previous remains ordinary when the LMS API rejects custom markers`, async ({
		page,
	}) => {
		await observeMessages(page);
		let frame = await launch(page, "pages", format, "ab-initio", "en", false, "", true);
		for (const place of [2, 3, 4]) await next(frame, "pages", place);
		await page.goto(`${base}/left`);
		frame = await launch(page, "pages", format, "resume", "en", false, "", true);
		expect(await messages(frame)).toEqual([]);
		for (const place of [3, 2, 1]) {
			await frame.locator("a.praxity-nav-prev:visible").last().click();
			await ready(frame, "pages");
			await expect(frame.locator("main h1").first()).toHaveText(`Place ${place}`);
		}
		expect((await messages(frame)).some((text) => text.startsWith("Resumed"))).toBe(false);
	});
}

// Pages loads a full document per page: the focused heading orients, and no live
// message repeats it. Guided heading focus also leaves the live region alone;
// the named slide region carries its position.
for (const mode of ["pages", "guided"] as const) {
	for (const locale of ["en", "fr"]) {
		test(`${mode} ${locale} ordinary Next, Previous and Back focus the heading without a live message`, async ({
			page,
		}) => {
			await observeMessages(page);
			const frame = await launch(page, mode, "scorm12", "ab-initio", locale);
			const heading = (place: number) =>
				frame
					.locator(mode === "guided" ? `[data-deck-slide="place-${place}"] h1` : "main h1")
					.first();
			const slide = (place: number) =>
				locale === "fr" ? `Diapositive ${place} sur 5` : `Slide ${place} of 5`;
			for (const place of [2, 3]) {
				await next(frame, mode, place);
				await expect(heading(place)).toBeFocused();
				expect(await messages(frame)).toEqual([]);
				if (mode === "guided")
					await expect(frame.locator(`[data-deck-slide="place-${place}"]`)).toHaveAccessibleName(
						slide(place),
					);
			}
			if (mode === "guided") await frame.locator("#deck-previous").click();
			else await frame.locator("a.praxity-nav-prev:visible").last().click();
			await ready(frame, mode);
			await expect(heading(2)).toHaveText("Place 2");
			if (mode === "guided") {
				await expect(heading(2)).toBeFocused();
				await expect(frame.locator('[data-deck-slide="place-2"]')).toHaveAccessibleName(slide(2));
				expect(await messages(frame)).toEqual([]);
				return;
			}
			await expect(heading(2)).toBeFocused();
			expect(await messages(frame)).toEqual([]);
			await frame.evaluate(() => history.back());
			await expect(heading(3)).toHaveText("Place 3");
			await ready(frame, mode);
			expect(await messages(frame)).toEqual([]);
			// Position stays discoverable in the page controls.
			await expect(frame.locator(".praxity-pages-position").first()).toHaveText(
				locale === "fr" ? "Page 3 sur 5" : "Page 3 of 5",
			);
		});
	}
}

for (const mode of ["pages", "guided"] as const) {
	for (const locale of ["en", "fr"]) {
		for (const larger of [false, true]) {
			test(`${mode} ${locale} headings keep words unhyphenated and reflow at 320px, larger=${larger}`, async ({
				page,
			}, testInfo) => {
				await page.setViewportSize({ width: 320, height: 720 });
				await page.addInitScript(
					(enabled) =>
						localStorage.setItem(
							"praxity-a11y",
							JSON.stringify({ textSize: enabled ? "large" : "default" }),
						),
					larger,
				);
				await page.goto(`${base}/${mode}-${locale}-wrap-html/index.html`);
				await ready(page.mainFrame(), mode);
				await page.evaluate(() => document.fonts.ready);
				const scope = mode === "guided" ? '[data-deck-slide="place-1"]' : "main";
				const title = page.locator(`${scope} h1`).first();
				const url = page.locator(`${scope} h2`).first();
				const fitting = page.locator(`${scope} h3`).first();
				await expect(title).toHaveText(wrapTitles[locale]);
				await expect(url).toHaveText(wrapUrl);
				const measure = (element: Element) => {
					const style = getComputedStyle(element);
					const box = element.getBoundingClientRect();
					const width =
						element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
					const measureWords = () => {
						const words: { word: string; width: number; lines: number }[] = [];
						const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
						for (let node = walker.nextNode(); node; node = walker.nextNode()) {
							for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
								const range = document.createRange();
								range.setStart(node, match.index ?? 0);
								range.setEnd(node, (match.index ?? 0) + match[0].length);
								const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
								words.push({
									word: match[0],
									width: rects.reduce((sum, rect) => sum + rect.width, 0),
									lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
								});
							}
						}
						return words;
					};
					const rendered = measureWords();
					// Unwrapped widths are the words' natural widths. A drawn hyphen makes the
					// wrapped fragments wider than that; an unmarked break does not.
					(element as HTMLElement).style.whiteSpace = "nowrap";
					const natural = measureWords();
					(element as HTMLElement).style.whiteSpace = "";
					const words = rendered.map((word, index) => ({
						...word,
						natural: natural[index].width,
						hyphenated: word.lines > 1 && word.width > natural[index].width + 2,
					}));
					return {
						lang: element.closest("[lang]")?.getAttribute("lang"),
						hyphens: style.hyphens,
						overflowWrap: style.overflowWrap,
						wordBreak: style.wordBreak,
						font: `${style.fontSize}/${style.lineHeight}`,
						width,
						right: box.right,
						overflow: element.scrollWidth - element.clientWidth,
						words,
					};
				};
				const heading = await title.evaluate(measure);
				const link = await url.evaluate(measure);
				const fit = await fitting.evaluate(measure);
				const measurements = testInfo.outputPath("heading-wrap.json");
				await writeFile(measurements, JSON.stringify({ heading, link, fit }, null, 2));
				await testInfo.attach("heading-wrap", {
					path: measurements,
					contentType: "application/json",
				});
				await page.screenshot({ path: testInfo.outputPath(`${mode}-${locale}-${larger}.png`) });
				for (const measured of [heading, link, fit]) {
					// Course headings retain authored language and never add automatic hyphens.
					expect(measured.lang).toBe(locale);
					expect(measured.hyphens).toBe("manual");
					expect(measured.overflowWrap).toBe("break-word");
					expect(measured.wordBreak).toBe("normal");
					expect(measured.overflow).toBeLessThanOrEqual(0);
					expect(measured.right).toBeLessThanOrEqual(320);
					expect(measured.words.filter((word) => word.hyphenated)).toEqual([]);
				}
				// A word that fits the line stays whole; long words and URLs still reflow.
				expect(
					heading.words.filter(
						(word) => word.natural <= heading.width && word.lines > 1 && !word.hyphenated,
					),
				).toEqual([]);
				const word = fit.words.find((word) => word.word === fittingWord);
				expect(word).toBeDefined();
				expect(fit.words.reduce((width, word) => width + word.natural, 0)).toBeGreaterThan(
					fit.width,
				);
				expect(word?.natural).toBeLessThanOrEqual(fit.width);
				expect(word?.lines).toBe(1);
				expect(link.words[0].lines).toBeGreaterThan(1);
				// Code still wraps by overflow-wrap but never gains an inserted hyphen.
				expect(await url.locator("code").evaluate((code) => getComputedStyle(code).hyphens)).toBe(
					"manual",
				);
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true,
				);
			});
		}
	}
	test(`${mode} HTML index return resumes the bookmark with visits and one focused cue`, async ({
		page,
	}) => {
		await observeMessages(page);
		const cueRequests: string[] = [];
		page.on("request", (request) => {
			if (/\/course-resume-[A-Z0-9]{8}\.js$/u.test(request.url())) cueRequests.push(request.url());
		});
		await page.goto(`${base}/${mode}-en-false-html/index.html`);
		await ready(page.mainFrame(), mode);
		for (const place of [2, 3, 4]) await next(page.mainFrame(), mode, place);
		await page.goto(`${base}/left`);
		await page.goto(`${base}/${mode}-en-false-html/index.html`);
		await ready(page.mainFrame(), mode);
		await expect(
			page.locator(mode === "guided" ? '[data-deck-slide="place-4"] h1' : "main h1").first(),
		).toHaveText(`Resumed at ${mode === "guided" ? "slide" : "page"} 4 of 5: Place 4`);
		await expect(page.locator("main h1:visible").first()).toBeFocused();
		expect(await messages(page.mainFrame())).toEqual([]);
		expect(await page.evaluate(() => window.__praxityRuntime?.getVisitedPages?.())).toEqual(
			expect.arrayContaining(["place-4"]),
		);
		expect(cueRequests).toHaveLength(mode === "guided" ? 0 : 1);
	});
}

for (const mode of ["pages", "guided", "static"] as const) {
	for (const transport of ["server", "file"] as const) {
		test(`${mode} standalone ${transport} reload keeps page 3 without a resume cue or live write`, async ({
			page,
		}, testInfo) => {
			await observeMessages(page);
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const prefix = `/${mode}-en-false-html/`;
			// Pages uses its native document fallback when file origins reject islands.
			const navigationMode = transport === "file" && mode === "pages" ? "static" : mode;
			let entry = `${base}${prefix}index.html`;
			if (transport === "file") {
				const directory = testInfo.outputPath("standalone");
				for (const [filename, bytes] of files) {
					if (!filename.startsWith(prefix)) continue;
					const destination = path.join(directory, filename.slice(prefix.length));
					await mkdir(path.dirname(destination), { recursive: true });
					await writeFile(destination, bytes);
				}
				entry = pathToFileURL(path.join(directory, "index.html")).href;
			}
			const network: string[] = [];
			page.on("request", (request) => {
				if (/^https?:/u.test(request.url()) && !request.url().startsWith(base))
					network.push(request.url());
			});
			await page.goto(entry);
			await ready(page.mainFrame(), navigationMode);
			for (const place of [2, 3]) await next(page.mainFrame(), navigationMode, place);
			// Gecko's automation reload classifies history-replaced URLs as navigation.
			// Exercise the native document reload used by learners instead.
			await Promise.all([page.waitForNavigation(), page.evaluate(() => location.reload())]);
			await ready(page.mainFrame(), navigationMode);
			const heading = page.locator("main h1:visible").first();
			await expect(heading).toHaveText("Place 3");
			await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
			expect(await messages(page.mainFrame())).toEqual([]);
			expect(
				await page.evaluate(
					() => (window as unknown as { resumeFocusTargets: string[] }).resumeFocusTargets,
				),
			).toHaveLength(0);
			expect(errors).toEqual([]);
			expect(network).toEqual([]);
			// Returning through index uses the bookmark too, including local-file aliases.
			await page.goto(entry);
			await ready(page.mainFrame(), navigationMode);
			await expect(page.locator("main h1:visible").first()).toHaveText(
				`Resumed at ${mode === "guided" ? "slide" : "page"} 3 of 5: Place 3`,
			);
			await expect(page.locator("main h1:visible").first()).toBeFocused();
			// An explicit first-page route matches SCORM's bypass without erasing visits.
			await page.goto(`${entry}?praxity-page=place-1`);
			await ready(page.mainFrame(), navigationMode);
			await expect(page.locator("main h1:visible").first()).toHaveText("Place 1");
			await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
			expect(await page.evaluate(() => window.__praxityRuntime?.getVisitedPages?.())).toContain(
				"place-3",
			);
			await next(page.mainFrame(), navigationMode, 2);
			if (mode !== "guided")
				await expect(page.locator("a.praxity-nav-prev:visible").last()).toHaveAttribute(
					"href",
					new URL("place-1.html?praxity-resume=0", entry).href,
				);
			await page
				.locator(mode === "guided" ? "#deck-previous" : "a.praxity-nav-prev:visible")
				.last()
				.click();
			await expect(page.locator("main h1:visible").first()).toHaveText("Place 1");
			await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		});
	}
	for (const stored of [
		"corrupt-json",
		"invalid-type",
		"old-schema",
		"removed-page",
		"prototype-key",
	] as const) {
		test(`${mode} standalone ${stored} falls back to page 1 without an error`, async ({ page }) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const entry = `${base}/${mode}-en-false-html/index.html`;
			await page.goto(entry);
			await ready(page.mainFrame(), mode);
			await page.evaluate(
				({ mode, stored }) => {
					const key = `praxity:orientation-${mode}-en-false:default:state`;
					const state = JSON.parse(localStorage.getItem(key) ?? "null");
					if (!state) throw new Error("Missing saved state");
					state.bookmark =
						stored === "invalid-type"
							? { page: 3 }
							: stored === "prototype-key"
								? "__proto__"
								: "removed-page";
					if (stored === "old-schema") state.schemaVersion = 0;
					localStorage.setItem(key, stored === "corrupt-json" ? "{broken" : JSON.stringify(state));
				},
				{ mode, stored },
			);
			await page.goto(entry);
			await ready(page.mainFrame(), mode);
			await expect(page.locator("main h1:visible").first()).toHaveText("Place 1");
			await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
			expect(errors).toEqual([]);
		});
	}
}

test("standalone course bookmarks are independent", async ({ page }) => {
	await page.goto(`${base}/pages-en-false-html/index.html`);
	await ready(page.mainFrame(), "pages");
	for (const place of [2, 3]) await next(page.mainFrame(), "pages", place);
	await page.goto(`${base}/pages-fr-false-html/index.html`);
	await ready(page.mainFrame(), "pages");
	await expect(page.locator("main h1:visible").first()).toHaveText("Place 1");
	await next(page.mainFrame(), "pages", 2);
	await page.goto(`${base}/pages-en-false-html/index.html`);
	await ready(page.mainFrame(), "pages");
	await expect(page.locator("main h1:visible").first()).toHaveText(
		"Resumed at page 3 of 5: Place 3",
	);
	await page.goto(`${base}/pages-fr-false-html/index.html`);
	await ready(page.mainFrame(), "pages");
	await expect(page.locator("main h1:visible").first()).toHaveText(
		"Reprise à la page 2 sur 5 : Place 2",
	);
});

test("standalone Guided denied cross-module bookmark uses SCORM gate orientation", async ({
	page,
}) => {
	await observeMessages(page);
	const entry = `${base}/guided-en-true-html/index.html`;
	await page.goto(entry);
	await ready(page.mainFrame(), "guided");
	await page.evaluate(() => {
		const key = "praxity:orientation-guided-en-true:default:state";
		const state = JSON.parse(localStorage.getItem(key) ?? "null");
		if (!state) throw new Error("Missing saved state");
		state.bookmark = "place-4";
		localStorage.setItem(key, JSON.stringify(state));
	});
	await page.goto(entry);
	await ready(page.mainFrame(), "guided");
	const heading = page.locator('[data-deck-slide="place-2"] h1');
	await expect(heading).toBeFocused();
	await expect(heading).toHaveText("Resumed at slide 2 of 3: Place 2");
	await expect(page.locator(".deck-gate-notice")).toBeVisible();
	expect(await messages(page.mainFrame())).toEqual([]);
});

test("standalone Guided file denied bookmark keeps the allowed slide and has no script error", async ({
	page,
}, testInfo) => {
	await observeMessages(page);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const prefix = "/guided-en-true-html/";
	const directory = testInfo.outputPath("standalone-gated");
	for (const [filename, bytes] of files) {
		if (!filename.startsWith(prefix)) continue;
		const destination = path.join(directory, filename.slice(prefix.length));
		await mkdir(path.dirname(destination), { recursive: true });
		await writeFile(destination, bytes);
	}
	const entry = pathToFileURL(path.join(directory, "index.html")).href;
	await page.goto(entry);
	await ready(page.mainFrame(), "guided");
	await page.evaluate(() => {
		const key = "praxity:orientation-guided-en-true:default:state";
		const state = JSON.parse(localStorage.getItem(key) ?? "null");
		if (!state) throw new Error("Missing saved state");
		state.bookmark = "place-4";
		localStorage.setItem(key, JSON.stringify(state));
	});
	await page.goto(entry);
	await ready(page.mainFrame(), "guided");
	const heading = page.locator('[data-deck-slide="place-2"] h1');
	await expect(heading).toBeFocused();
	await expect(heading).toHaveText("Resumed at slide 2 of 3: Place 2");
	await expect(page.locator(".deck-gate-notice")).toBeVisible();
	expect(await messages(page.mainFrame())).toEqual([]);
	expect(errors).toEqual([]);
});
