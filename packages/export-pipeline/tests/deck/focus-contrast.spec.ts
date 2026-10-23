import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { readLesson as readBlockSource } from "@praxity/grammar";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import AdmZip from "adm-zip";
import {
	THEME_PRESET_DEFAULTS,
	type ThemePresetId,
} from "../../../editor-core/src/lib/themes/theme-preset-defaults";
import { type CourseExportInput, compileCourse, deployCourse } from "../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../src/desktop-design";
import { silentWav } from "../fixtures/silent-audio";

const presets = Object.keys(THEME_PRESET_DEFAULTS) as ThemePresetId[];
const files = new Map<string, Buffer>();
let server: Server;
let base: string;

test.beforeAll(async () => {
	test.setTimeout(120_000);
	const originalFetch = globalThis.fetch;
	const narrationUrl = "https://theme-polish.example/narration.wav";
	globalThis.fetch = (input, options) =>
		String(input) === narrationUrl
			? Promise.resolve(
					new Response(new Uint8Array(silentWav(1)), { headers: { "Content-Type": "audio/wav" } }),
				)
			: originalFetch(input, options);
	try {
		for (const palette of presets) {
			for (const mode of ["light", "dark"] as const) {
				for (const presentation of ["pages", "guided"] as const) {
					const content = splitBlocksIntoPages(
						readBlockSource(
							"# Build from a composition\n\nReview the lesson before publishing.\n\n# Publish\n\nPublish the lesson.\n",
						).blocks,
						"Focus contrast",
					);
					content.forEach((page, index) => {
						page.id = `page-${index + 1}`;
						page.lessonId = "focus";
						page.lessonTitle = "Focus contrast";
						page.isFirstPageOfLesson = index === 0;
						page.narrationEnabled = presentation === "guided";
						if (page.narrationEnabled) page.data = { ...page.data, narrationAudio: narrationUrl };
					});
					const input: CourseExportInput = {
						...extractDesktopDesignFromFrontmatter({
							design: { ...THEME_PRESET_DEFAULTS[palette], palette, colorMode: mode },
						} as never),
						id: `${palette}-${mode}-${presentation}`,
						title: "Focus contrast",
						sourceLocale: "en",
						content,
						navigationStyle: presentation === "guided" ? "slides" : "sidebar",
						...(presentation === "guided" ? { moduleDeck: { gates: {} } } : {}),
					};
					const artifact = await compileCourse(input);
					try {
						const result = await deployCourse(artifact, { format: "html" });
						for (const entry of new AdmZip(result.zip).getEntries()) {
							if (!entry.isDirectory) files.set(`/${input.id}/${entry.entryName}`, entry.getData());
						}
					} finally {
						await artifact.dispose();
					}
				}
			}
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	server = createServer((req, res) => {
		const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(pathname);
		const extension = pathname.split(".").pop() ?? "";
		res.writeHead(bytes ? 200 : 404, {
			"Content-Type":
				(
					{
						html: "text/html",
						js: "text/javascript",
						css: "text/css",
						woff2: "font/woff2",
						wav: "audio/wav",
					} as Record<string, string>
				)[extension] ?? "application/octet-stream",
		});
		res.end(bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture server address");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	if (server) {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});

for (const palette of presets) {
	for (const mode of ["light", "dark"] as const) {
		for (const presentation of ["pages", "guided"] as const) {
			test(`${palette} ${mode} ${presentation} paints a focus ring above 3:1`, async ({ page }) => {
				await page.goto(`${base}/${palette}-${mode}-${presentation}/index.html`);
				await page.evaluate(() => document.fonts.ready);
				const controls = [
					presentation === "guided"
						? page.locator("#deck-outline-toggle")
						: page.locator("button:visible:not(:disabled)").first(),
					...(presentation === "guided"
						? [page.locator("#deck-narration .praxity-narration-transport button").first()]
						: []),
				];
				for (const [index, control] of controls.entries()) {
					if (presentation === "guided" && index === 0)
						await page.locator("#deck-more-toggle").click();
					await expect(control).toBeVisible();
					await page.keyboard.press("Tab");
					await control.focus();
					await expect(control).toBeFocused();
					const pair = await control.evaluate((element) => {
						const canvas = document.createElement("canvas");
						canvas.width = canvas.height = 1;
						const context = canvas.getContext("2d");
						if (!context) throw new Error("Missing canvas context");
						const toHex = () =>
							`#${Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
								.map((channel) => channel.toString(16).padStart(2, "0"))
								.join("")}`;
						const style = getComputedStyle(element);
						const ancestors: Element[] = [];
						for (
							let current: Element | null =
								Number.parseFloat(style.outlineOffset) < 0 ? element : element.parentElement;
							current;
							current = current.parentElement
						)
							ancestors.unshift(current);
						context.fillStyle = "#ffffff";
						context.fillRect(0, 0, 1, 1);
						for (const ancestor of ancestors) {
							context.fillStyle = getComputedStyle(ancestor).backgroundColor;
							context.fillRect(0, 0, 1, 1);
						}
						const background = toHex();
						context.fillStyle = style.outlineColor;
						context.fillRect(0, 0, 1, 1);
						const focus = toHex();
						const probe = document.createElement("span");
						probe.hidden = true;
						element.append(probe);
						const surfaces = [
							"background",
							"surface",
							"navigation-surface",
							"activity-surface",
							"background-alt",
							...["accent", "secondary", "tertiary", "success", "error", "warning"].map(
								(role) => `${role}-light`,
							),
							...["note", "info", "warning", "success", "tip"].flatMap((role) => [
								`callout-${role}-low`,
								`callout-${role}-high`,
							]),
						]
							.filter((role) => style.getPropertyValue(`--praxity-color-${role}`).trim())
							.map((role) => {
								probe.style.backgroundColor = `var(--praxity-color-${role})`;
								context.fillStyle = getComputedStyle(probe).backgroundColor;
								context.fillRect(0, 0, 1, 1);
								return { role, color: toHex() };
							});
						probe.remove();
						return {
							focus,
							background,
							surfaces,
							width: Number.parseFloat(style.outlineWidth),
							style: style.outlineStyle,
						};
					});
					expect(pair.style).toBe("solid");
					expect(pair.width).toBeGreaterThanOrEqual(2);
					expect(
						contrastRatio(pair.focus, pair.background),
						JSON.stringify(pair),
					).toBeGreaterThanOrEqual(3);
					if (index === 0) {
						expect(pair.surfaces.length).toBeGreaterThanOrEqual(6);
						for (const surface of pair.surfaces) {
							expect(
								contrastRatio(pair.focus, surface.color),
								JSON.stringify({ focus: pair.focus, ...surface }),
							).toBeGreaterThanOrEqual(3);
						}
					}
					await test.info().attach(`focus-contrast-${index}.json`, {
						body: JSON.stringify(
							{ ...pair, ratio: contrastRatio(pair.focus, pair.background) },
							null,
							2,
						),
						contentType: "application/json",
					});
					await page.screenshot({
						path: test
							.info()
							.outputPath(`${palette}-${mode}-${presentation}${index ? "-narration" : ""}.png`),
					});
				}
			});
		}
	}
}
