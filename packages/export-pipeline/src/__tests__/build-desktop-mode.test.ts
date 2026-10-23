import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTypography, readLesson } from "@praxity/grammar";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLessonFixture as readSource } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { stripChoiceRecoveryStrings } from "../../tests/fixtures/choice-facts.ts";
import {
	fixtureCourseRuntimeLicense,
	fixtureRuntimeNotices,
} from "../../tests/fixtures/runtime-notices.ts";
import {
	buildScormPackage,
	type CourseExportInput,
	type CoursePreviewDeployment,
	compileCourse,
	type DesktopExportInput,
	deployCourse,
} from "../build";
import { IMAGE_CODEC_ASSETS } from "../optimize-image.ts";

const HOST_FILENAMES = {
	standalone: "host-standalone-TEST1234.js",
	electronPreview: "host-electron-preview-TEST1234.js",
	scorm12: "host-scorm12-TEST1234.js",
	scorm2004: "host-scorm2004-TEST1234.js",
	xapi: "host-xapi-TEST1234.js",
} as const;
const RESUME_FILENAME = "course-resume-TEST1234.js";
const SHELL_FILENAME = "course-shell-TEST1234.js";
const ISLAND_FILENAMES = {
	loader: "island-loader-TEST1234.js",
	deck: "island-deck-TEST1234.js",
	nav: "island-nav-TEST1234.js",
	narration: "island-narration-TEST1234.js",
	assessment: "island-assessment-TEST1234.js",
	tooltip: "island-tooltip-TEST1234.js",
} as const;

function stylesheetEntry(zip: AdmZip, lite = false): string {
	const pattern = lite ? /^styles-lite\.[a-f0-9]{12}\.css$/ : /^styles\.[a-f0-9]{12}\.css$/;
	const entry = zip.getEntries().find((candidate) => pattern.test(candidate.entryName));
	expect(entry).toBeDefined();
	return entry?.entryName ?? "";
}

describe("buildScormPackage desktop mode", () => {
	let prebuiltAssetsDir: string;
	it.each(
		[false, true].flatMap((moduleDeck) =>
			[
				["index.html", "index.html"],
				["/a$&$'$`$1", "/a$&amp;$'$`$1"],
				["../overview/?a=1&b=2", "../overview/?a=1&amp;b=2"],
				[
					'/courses/overview?name="course"&tag=<home>',
					"/courses/overview?name=&quot;course&quot;&amp;tag=&lt;home&gt;",
				],
				["https://example.org/course/?a=1&b=2", "https://example.org/course/?a=1&amp;b=2"],
			].map(([courseHomeUrl, escaped]) => ({ moduleDeck, courseHomeUrl, escaped })),
		),
	)(
		"sets all HTML return links to $courseHomeUrl, moduleDeck=$moduleDeck",
		async ({ moduleDeck, courseHomeUrl, escaped }) => {
			const input = createDesktopHtmlInput();
			input.blocks = readSource("# End\n\nA [term]{A definition.}.\n").blocks;
			if (moduleDeck) input.config.moduleDeck = {};
			const options = { mode: "desktop" as const, prebuiltAssetsDir, projectDir: "/tmp/project" };
			const original = await compileCourse(input, options);
			const configured = await compileCourse(
				{ ...input, config: { ...input.config, courseHomeUrl } },
				options,
			);
			const files = (zip: AdmZip) =>
				zip
					.getEntries()
					.filter((entry) => !entry.isDirectory)
					.map((entry) => [entry.entryName, entry.getData().toString("base64")])
					.sort();
			try {
				const zip = new AdmZip((await deployCourse(configured, { format: "html" })).zip);
				const baseline = new AdmZip((await deployCourse(original, { format: "html" })).zip);
				let links = 0;
				let decks = 0;
				for (const entry of zip.getEntries().filter((entry) => entry.entryName.endsWith(".html"))) {
					const html = zip.readAsText(entry);
					const dom = new JSDOM(html);
					for (const link of dom.window.document.querySelectorAll(
						"a.praxity-glossary-link, .praxity-pages-completion-actions a:last-child",
					)) {
						expect(link.getAttribute("href")).toBe(courseHomeUrl);
						expect(link.getAttributeNames().sort()).toEqual(
							link.className ? ["class", "href"] : ["href"],
						);
						links++;
					}
					for (const deck of dom.window.document.querySelectorAll<HTMLElement>(".praxity-deck")) {
						expect(deck.dataset.praxityCourseHome).toBe(courseHomeUrl);
						expect(deck.getAttributeNames().sort()).toEqual([
							"class",
							"data-island",
							"data-praxity-course-home",
						]);
						expect(deck.querySelector("#deck-next")).not.toBeNull();
						decks++;
					}
					dom.window.close();
					expect(
						html
							.replaceAll(`href="${escaped}"`, 'href="index.html"')
							.replaceAll(` data-praxity-course-home="${escaped}"`, ""),
					).toBe(baseline.readAsText(entry));
				}
				expect(links).toBe(moduleDeck ? 1 : 2);
				expect(decks).toBe(moduleDeck ? 1 : 0);
				for (const format of ["scorm12", "scorm2004", "xapi"] as const) {
					const before = new AdmZip((await deployCourse(original, { format })).zip);
					const after = new AdmZip((await deployCourse(configured, { format })).zip);
					expect(files(after)).toEqual(files(before));
				}
			} finally {
				await original.dispose();
				await configured.dispose();
			}
		},
	);

	it.each([false, true])(
		"preserves base package bytes apart from schema notices without courseHomeUrl, moduleDeck=%s",
		async (moduleDeck) => {
			// T50 round 1 uses the shared glossary name and a single-warning media action catalog.
			const baseline: Record<string, string> = {
				"pages/html": "af8dd486e40e34b11bccc7e53d329ed2775e3a923341cedd484531892300310c",
				"pages/scorm12": "75a52fde7664c2623128eab8b527b33c05a7d3713643466a9011d1ac08622c67",
				"pages/scorm2004": "c97772888f88980089123dfeb335164120e9cde51912107c2c38dc194faed25f",
				"pages/xapi": "ebf31cb069e462d8ddc77c232b12f1b45e483685a88cb728b9bb402fd30a9f60",
				"guided/html": "cb5e72789be8158133cdc079eb7705e7a8f8c7656945b54232d1cf9406231987",
				"guided/scorm12": "9e3e7d0f29bab1cedc26262712227678da75e6e181939dbf0525efad4cc35aaa",
				"guided/scorm2004": "9d4975a9038ecbc30575ec800e73128dc3fb41e6838f35a308329c83a304cfbc",
				"guided/xapi": "8587a973734e7468c6ce871a99230ab191152d5ced6c6ea201696783ab5b1c06",
			};
			const input = createDesktopHtmlInput();
			input.blocks = readSource("# End\n\nA [term]{A definition.}.\n").blocks;
			if (moduleDeck) input.config.moduleDeck = {};
			const artifact = await compileCourse(input, {
				mode: "desktop",
				prebuiltAssetsDir,
				projectDir: "/tmp/project",
			});
			try {
				for (const format of ["html", "scorm12", "scorm2004", "xapi"] as const) {
					const zip = new AdmZip((await deployCourse(artifact, { format })).zip);
					const files = zip
						.getEntries()
						// The added schema notice has its own complete-content export contract below.
						.filter((entry) => !entry.isDirectory && entry.entryName !== "license.txt")
						.map((entry) => [
							entry.entryName,
							createHash("sha256")
								.update(
									entry.entryName.endsWith(".html")
										? stripChoiceRecoveryStrings(entry.getData().toString("utf8"))
										: entry.getData(),
								)
								.digest("hex"),
						])
						.sort();
					expect(createHash("sha256").update(JSON.stringify(files)).digest("hex")).toBe(
						baseline[`${moduleDeck ? "guided" : "pages"}/${format}`],
					);
				}
			} finally {
				await artifact.dispose();
			}
		},
	);

	it("exports an ordinary course without reading or hashing absent highlight CSS", async () => {
		await rm(path.join(prebuiltAssetsDir, "highlight.css"));
		const artifact = await compileCourse(createDesktopHtmlInput(), {
			mode: "desktop",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		try {
			const zip = new AdmZip((await deployCourse(artifact, { format: "html" })).zip);
			expect(
				zip
					.getEntries()
					.map((entry) => entry.entryName)
					.filter((name) => name.includes("highlight")),
			).toEqual([]);
		} finally {
			await artifact.dispose();
		}
	});

	beforeEach(async () => {
		prebuiltAssetsDir = await mkdtemp(path.join(os.tmpdir(), "desktop-prebuilt-assets-"));
		await writeFile(path.join(prebuiltAssetsDir, "viewer.css"), ".viewer{display:block}", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "deck-shell.css"), ".praxity-deck{}", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "highlight.css"), ".praxity-highlight{}", "utf-8");
		await writeFile(
			path.join(prebuiltAssetsDir, "retrieval-sheet.css"),
			".praxity-retrieval-sheet{}",
			"utf-8",
		);
		await writeFile(path.join(prebuiltAssetsDir, SHELL_FILENAME), "window.shell={};", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, RESUME_FILENAME), "", "utf-8");
		await writeFile(
			path.join(prebuiltAssetsDir, "styles.css"),
			"body{font-family:DM Sans}",
			"utf-8",
		);
		await writeFile(path.join(prebuiltAssetsDir, "review-comments.js"), "", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "review-comments.css"), "", "utf-8");
		await mkdir(path.join(prebuiltAssetsDir, "islands"));
		for (const filename of Object.values(ISLAND_FILENAMES)) {
			await writeFile(path.join(prebuiltAssetsDir, "islands", filename), "", "utf-8");
		}
		for (const filename of Object.values(HOST_FILENAMES)) {
			await writeFile(path.join(prebuiltAssetsDir, filename), "window.PraxityHost={};", "utf-8");
		}
		await writeFile(
			path.join(prebuiltAssetsDir, "viewer-manifest.json"),
			JSON.stringify({
				courseRuntimeLicense: await fixtureCourseRuntimeLicense(),
				thirdPartyNotices: await fixtureRuntimeNotices(
					SHELL_FILENAME,
					Object.values(HOST_FILENAMES),
					Object.values(ISLAND_FILENAMES),
					RESUME_FILENAME,
				),
				css: "viewer.css",
				deckCss: "deck-shell.css",
				retrievalSheetCss: "retrieval-sheet.css",
				highlightCss: "highlight.css",
				shell: SHELL_FILENAME,
				resume: RESUME_FILENAME,
				hosts: HOST_FILENAMES,
				islands: {
					"island-loader": ISLAND_FILENAMES.loader,
					"island-deck": ISLAND_FILENAMES.deck,
					"island-nav": ISLAND_FILENAMES.nav,
					"island-narration": ISLAND_FILENAMES.narration,
					"island-assessment": ISLAND_FILENAMES.assessment,
					"island-tooltip": ISLAND_FILENAMES.tooltip,
				},
				islandFiles: Object.values(ISLAND_FILENAMES),
				islandDependencies: {
					"island-loader": [ISLAND_FILENAMES.loader],
					"island-deck": [ISLAND_FILENAMES.deck],
					"island-nav": [ISLAND_FILENAMES.nav],
					"island-narration": [ISLAND_FILENAMES.narration],
					"island-assessment": [ISLAND_FILENAMES.assessment],
					"island-tooltip": [ISLAND_FILENAMES.tooltip],
				},
			}),
			"utf-8",
		);
		await writeFile(
			path.join(prebuiltAssetsDir, "tabler-nodes-outline.json"),
			JSON.stringify({ bulb: [["path", { d: "M1 1h2" }]] }),
			"utf-8",
		);
		await mkdir(path.join(prebuiltAssetsDir, "schemas", "scorm12"), { recursive: true });
		await mkdir(path.join(prebuiltAssetsDir, "schemas", "scorm2004"), { recursive: true });
		await copyFile(
			fileURLToPath(new URL("../../schemas/license.txt", import.meta.url)),
			path.join(prebuiltAssetsDir, "schemas", "license.txt"),
		);
		await writeFile(
			path.join(prebuiltAssetsDir, "schemas", "scorm12", "desktop-only-12.xsd"),
			"<schema/>",
			"utf-8",
		);
		await writeFile(
			path.join(prebuiltAssetsDir, "schemas", "scorm2004", "desktop-only-2004.xsd"),
			"<schema/>",
			"utf-8",
		);
	});

	afterEach(async () => {
		await rm(prebuiltAssetsDir, { recursive: true, force: true });
	});

	it.each(["scorm12", "scorm2004", "xapi"] as const)(
		"ships the complete schema notices with prebuilt %s schemas",
		async (format) => {
			const result = await buildScormPackage(createDesktopInput(), {
				mode: "desktop",
				format,
				prebuiltAssetsDir,
				projectDir: "/tmp/project",
			});
			const zip = new AdmZip(result.zip);
			expect(
				zip.getEntry(format === "scorm12" ? "desktop-only-12.xsd" : "desktop-only-2004.xsd"),
			).toBeTruthy();
			expect(zip.readAsText("license.txt")).toBe(
				await readFile(path.join(prebuiltAssetsDir, "schemas", "license.txt"), "utf8"),
			);
		},
	);

	it.each(["scorm12", "scorm2004", "xapi"] as const)(
		"rejects prebuilt %s schemas without license.txt instead of falling back",
		async (format) => {
			await rm(path.join(prebuiltAssetsDir, "schemas", "license.txt"));
			await expect(
				buildScormPackage(createDesktopInput(), {
					mode: "desktop",
					format,
					prebuiltAssetsDir,
					projectDir: "/tmp/project",
				}),
			).rejects.toThrow(/ENOENT.*license\.txt/s);
		},
	);

	function createDesktopInput(): DesktopExportInput {
		return {
			courseId: "desktop-course",
			blocks: [
				{ id: "b1", type: "text", data: { content: "<p>Hello desktop export</p>" } },
				{ id: "b2", type: "image", data: { src: "assets/hero.webp", altText: "Hero" } },
				{
					id: "b3",
					type: "button",
					data: { text: "Download worksheet", href: "assets/worksheet.pdf" },
				},
				{
					id: "b4",
					type: "button",
					data: { text: "Download video", href: "assets/sample.mov" },
				},
			],
			frontmatter: {
				title: "Desktop Course",
				lang: "en",
			},
			config: {
				completionThreshold: 0.8,
			},
			resolvedAssets: new Map([
				["assets/hero.webp", new Uint8Array([1, 2, 3, 4])],
				["assets/worksheet.pdf", new Uint8Array([37, 80, 68, 70])],
				["assets/sample.mov", new Uint8Array([0, 0, 0, 20])],
				["assets/unused-master.webp", new Uint8Array([5, 6, 7, 8])],
			]),
			viewerVersion: "test-viewer",
			locale: "en",
		};
	}

	function createDesktopHtmlInput(): DesktopExportInput {
		return {
			courseId: "desktop-course",
			blocks: [{ id: "b1", type: "text", data: { content: "<p>Styled desktop export</p>" } }],
			frontmatter: {
				title: "Styled Desktop Course",
				lang: "en",
				design: {
					palette: "standard",
					colorMode: "light",
					accentHue: 220,
					colorBackgroundLight: "#fff8f0",
					colorBackgroundDark: "#111827",
					colorText: "#2a1f1a",
					colorAccent: "#ff6b35",
					colorButtonBackground: "#ff6b35",
					colorButtonText: "#ffffff",
					colorSuccess: "#2b8a3e",
					colorError: "#c53030",
					colorWarning: "#b45309",
					typography: createTypography("Poppins", "Merriweather"),
					headingSize: 2.2,
					lineHeight: 1.7,
					density: "spacious",
					blockSpacing: "spacious",
					sectionGap: 56,
					contentMaxWidth: 760,
					borderRadius: 12,
					shadowIntensity: "subtle",
					dividerStyle: "gradient",
					backgroundTexture: "paper",
					highlightStyle: "marker",
					navLayout: "sidebar",
					navArchetype: "bottomBar",
					navOutline: true,
					navOutlinePosition: "right",
					navPrevNext: true,
					navPrevNextPosition: "top",
					navProgressStyle: "dots",
					navFloatingToc: true,
					navScrollProgress: true,
					navEdgeArrows: true,
					navSlideCounter: true,
					navBreadcrumbs: true,
					navCourseTitle: false,
					navLessonTitles: false,
					navLessonTitleAsHeading: false,
					navReadingTime: true,
					navSwipeGestures: true,
					navKeyboardArrows: false,
					showA11yPill: false,
					colorSecondary: "#22c55e",
					colorTertiary: "#14b8a6",
					motionEntrance: "fade",
					motionStagger: "sequential",
					imageStyle: "two-color",
					imageHoverEffect: "glow",
					imageEffects: { grain: { intensity: 24 } },
					imageEffectsAuto: false,
					componentDefaults: {},
				},
			},
			config: {
				completionThreshold: 0.8,
			},
			resolvedAssets: new Map(),
			viewerVersion: "test-viewer",
			locale: "en",
		};
	}

	function createPartialDesktopHtmlInput(): DesktopExportInput {
		return {
			courseId: "desktop-course",
			blocks: [
				{ id: "b1", type: "text", data: { content: "<p>Partial design desktop export</p>" } },
			],
			frontmatter: {
				title: "Partial Design Desktop Course",
				lang: "en",
				design: {
					colorAccent: "#0ea5e9",
					navLayout: "bottomBar",
					customCss: ".client-custom { color: red; }</style><script>alert('custom-css')</script>",
					typography: {
						...createTypography("Inter", "Inter"),
						body: {
							...createTypography("Inter", "Inter").body,
							fontFamily: ["Inter';}</style><script>alert('xss')</script>"],
						},
					},
				} as unknown as NonNullable<DesktopExportInput["frontmatter"]["design"]>,
			},
			config: {
				completionThreshold: 0.8,
			},
			resolvedAssets: new Map(),
			viewerVersion: "test-viewer",
			locale: "en",
		};
	}

	async function declareScormDependency(available = true): Promise<string> {
		const filename = "scorm-support-TEST1234.js";
		const manifestPath = path.join(prebuiltAssetsDir, "viewer-manifest.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
		manifest.hostDependencies = { scorm12: [filename], scorm2004: [filename] };
		manifest.thirdPartyNotices.outputs[filename] = [];
		await writeFile(manifestPath, JSON.stringify(manifest));
		if (available)
			await writeFile(path.join(prebuiltAssetsDir, filename), "window.originalSession = true;");
		return filename;
	}

	it.each([
		[
			"v3",
			"# Untitled {hideTitle}\n\n::: comparison {layout=side-by-side}\n:: Before {level=3}\nOld process.\n\n:: After {level=3}\nNew process.\n:::\n",
		],
		[
			"v4",
			"::: comparison {layout=side-by-side}\n:: Before\nOld process.\n:: After\nNew process.\n:::\n",
		],
	])("publishes filled %s comparisons and both following blocks", async (version, comparison) => {
		const source = `# Comparison regression\n\n${comparison}\nFollowing paragraph.\n\n## Following heading\n`;
		const blocks = version === "v3" ? readSource(source).blocks : readLesson(source).blocks;
		const result = await buildScormPackage(
			{ ...createDesktopHtmlInput(), blocks, frontmatter: { title: "Comparison regression" } },
			{ mode: "desktop", format: "html", prebuiltAssetsDir, projectDir: prebuiltAssetsDir },
		);
		const zip = new AdmZip(result.zip);
		const html = zip
			.getEntries()
			.filter((entry) => entry.entryName.endsWith(".html"))
			.map((entry) => zip.readAsText(entry))
			.join("\n");
		const document = new JSDOM(html).window.document;
		const columns = document.querySelector(".praxity-columns");
		expect(columns?.textContent).toContain("Before");
		expect(columns?.textContent).toContain("Old process.");
		expect(columns?.textContent).toContain("After");
		expect(columns?.textContent).toContain("New process.");
		const paragraph = [...document.querySelectorAll("p")].find(
			(node) => node.textContent === "Following paragraph.",
		);
		const heading = [...document.querySelectorAll("h2")].find(
			(node) => node.textContent === "Following heading",
		);
		expect(paragraph).toBeDefined();
		expect(heading).toBeDefined();
		expect(paragraph?.closest(".praxity-columns")).toBeNull();
		expect(heading?.closest(".praxity-columns")).toBeNull();
		expect(paragraph?.compareDocumentPosition(heading!)).toBe(4);
	});

	it("captures the shared SCORM dependency before desktop assets change", async () => {
		const filename = await declareScormDependency();
		const artifact = await compileCourse(createDesktopInput(), {
			mode: "desktop",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		try {
			await writeFile(path.join(prebuiltAssetsDir, filename), "window.changedSession = true;");
			for (const format of ["scorm12", "scorm2004"] as const) {
				const result = await deployCourse(artifact, { format });
				const zip = new AdmZip(result.zip);
				expect(zip.readAsText(filename)).toBe("window.originalSession = true;");
				expect(zip.readAsText("imsmanifest.xml")).toContain(`<file href="${filename}"`);
				for (const entry of zip
					.getEntries()
					.filter((file) => file.entryName.endsWith(".html") && file.entryName !== "index.html")) {
					if (!zip.readAsText(entry).includes('id="praxity-host-config"')) continue;
					expect(zip.readAsText(entry)).toContain(
						`<script defer src="${filename}"></script>\n<script defer src="${HOST_FILENAMES[format]}"></script>`,
					);
				}
			}
			const html = await deployCourse(artifact, { format: "html" });
			expect(new AdmZip(html.zip).getEntry(filename)).toBeNull();
		} finally {
			await artifact.dispose();
		}
	});

	it("rejects a missing selected SCORM dependency and still exports HTML", async () => {
		const filename = await declareScormDependency(false);
		const artifact = await compileCourse(createDesktopInput(), {
			mode: "desktop",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		try {
			await expect(deployCourse(artifact, { format: "scorm12" })).rejects.toThrow(
				`Missing scorm12 host dependency: ${filename}`,
			);
			await expect(deployCourse(artifact, { format: "html" })).resolves.toHaveProperty(
				"format",
				"html",
			);
		} finally {
			await artifact.dispose();
		}
	});

	it("uses shared buildScormPackage entrypoint in source mode", { timeout: 15_000 }, async () => {
		const webCourse: CourseExportInput = {
			id: "web-course",
			title: "Web Course",
			sourceLocale: "en",
			content: [
				{
					id: "p1",
					title: "Page 1",
					blocks: [{ id: "b1", type: "text", data: { content: "<p>hi</p>" } }],
				},
			],
		};

		const result = await buildScormPackage(webCourse, {
			mode: "source",
			format: "scorm12",
		});

		expect(result.format).toBe("scorm12");
		expect(result.zip.length).toBeGreaterThan(0);
	});

	it("desktop mode SCORM 1.2 includes fingerprinted styles and mapped assets", async () => {
		const result = await buildScormPackage(createDesktopInput(), {
			mode: "desktop",
			format: "scorm12",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});

		const zip = new AdmZip(result.zip);
		const entries = zip.getEntries().map((entry) => entry.entryName);

		const styles = stylesheetEntry(zip);
		const liteStyles = stylesheetEntry(zip, true);
		expect(entries).not.toContain("styles.css");
		expect(entries).not.toContain("styles-lite.css");
		expect(entries).not.toContain("viewer.css");
		expect(entries.some((name) => name.includes("retrieval-sheet"))).toBe(false);
		expect(entries.some((name) => /highlight[.-]/.test(name))).toBe(false);
		expect(entries).toContain(SHELL_FILENAME);
		expect(zip.readAsText(styles)).toContain(".viewer{display:block}");
		expect(zip.readAsText(styles)).not.toContain(".praxity-deck{}");
		expect(zip.readAsText(liteStyles)).toContain(".viewer{display:block}");
		expect(entries.some((name) => /^styles(?:-lite)?-deck\./u.test(name))).toBe(false);
		expect(zip.readAsText(liteStyles)).toContain("body{font-family:DM Sans}");
		expect(entries).toContain(HOST_FILENAMES.scorm12);
		expect(entries).not.toContain(HOST_FILENAMES.scorm2004);
		expect(entries).not.toContain(HOST_FILENAMES.xapi);
		expect(entries).not.toContain("scorm-runtime.js");
		expect(entries).toContain("assets/hero.webp");
		expect(entries).toContain("assets/worksheet.pdf");
		expect(entries).toContain("assets/sample.mov");
		expect(entries).not.toContain("assets/unused-master.webp");
		expect(entries).toContain("desktop-only-12.xsd");

		const manifest = zip.readAsText("imsmanifest.xml");
		expect(manifest).toContain("1.2");
		expect(manifest).toContain('<file href="assets/worksheet.pdf"/>');
	});

	it("optimizes one image in the shared artifact for preview, HTML, and SCORM", {
		timeout: 30_000,
	}, async () => {
		const original = await readFile(
			new URL("../../../../apps/desktop/resources/icon.png", import.meta.url),
		);
		const codecDir = path.join(prebuiltAssetsDir, "image-codecs");
		await mkdir(codecDir);
		for (const specifier of IMAGE_CODEC_ASSETS) {
			await copyFile(
				fileURLToPath(import.meta.resolve(specifier)),
				path.join(codecDir, path.basename(specifier)),
			);
		}
		const input = createDesktopInput();
		input.blocks = [
			{ id: "image", type: "image", data: { src: "assets/my photo.png", altText: "Icon" } },
			{
				id: "link",
				type: "button",
				data: { text: "Download original", href: "assets/my%20photo.png" },
			},
		];
		input.resolvedAssets = new Map([["assets/my photo.png", original]]);
		const artifact = await compileCourse(input, {
			mode: "desktop",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		let preview: CoursePreviewDeployment | undefined;
		try {
			const derivative = artifact.manifest.files.find((file) =>
				/^assets\/__praxity-.*\.webp$/.test(file.path),
			);
			expect(derivative).toBeDefined();
			expect(derivative?.byteLength).toBeLessThan(original.length);
			expect(artifact.manifest.files.some((file) => file.path === "assets/my photo.png")).toBe(
				true,
			);
			const html = new AdmZip((await deployCourse(artifact, { format: "html" })).zip);
			const scorm = new AdmZip((await deployCourse(artifact, { format: "scorm12" })).zip);
			for (const zip of [html, scorm]) {
				expect(zip.readAsText("untitled.html")).toContain(`src="${derivative?.path}"`);
				expect(zip.readAsText("untitled.html")).toContain('href="assets/my%20photo.png"');
				expect(zip.getEntry("assets/my photo.png")?.getData()).toEqual(original);
				expect(zip.getEntry(derivative?.path ?? "")?.getData()).toEqual(
					html.getEntry(derivative?.path ?? "")?.getData(),
				);
			}
			preview = await deployCourse(artifact, { format: "electron-preview" });
			expect(preview.manifest.files.find((file) => file.path === derivative?.path)?.sha256).toBe(
				derivative?.sha256,
			);
			expect(input.resolvedAssets.get("assets/my photo.png")).toEqual(original);
		} finally {
			if (preview) await preview.dispose();
			await artifact.dispose();
		}
	});

	it("packages corner artwork through preview and offline deployments without mutating authored styles", async () => {
		const input = createDesktopHtmlInput();
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
			"base64",
		);
		const parsed = readSource(
			"---\ntitle: Named artwork\ndesign:\n  navArchetype: slides\npageStyles:\n  decorated:\n    cornerImage: /assets/corners.png?version=1#corner\n  unused:\n    cornerImage: assets/unused.png\n  overridden:\n    cornerImage: assets/overridden.png\n  direct:\n    cornerImage: /assets/direct.png#crop\n---\n\n# Opening {style=decorated}\n\nOpening content.\n\n# Second {style=plain}\n\nPlain content.\n\n# Third {style=direct}\n\nThird content.\n",
		);
		input.frontmatter = parsed.frontmatter;
		input.blocks = parsed.blocks;
		for (const name of ["corners", "unused", "overridden", "direct"])
			input.resolvedAssets.set(`assets/${name}.png`, png);
		const original = structuredClone(input.frontmatter);
		const artifact = await compileCourse(input, {
			mode: "desktop",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		try {
			const derivative = artifact.manifest.files.find((file) =>
				/^assets\/__praxity-.*\.webp$/.test(file.path),
			)?.path;
			expect(artifact.manifest.files.map((file) => file.path)).toEqual(
				expect.arrayContaining(["assets/corners.png", "assets/direct.png"]),
			);
			expect(artifact.manifest.files.map((file) => file.path)).not.toContain("assets/unused.png");
			expect(artifact.manifest.files.map((file) => file.path)).not.toContain(
				"assets/overridden.png",
			);
			for (const format of ["html", "scorm12", "scorm2004"] as const) {
				const zip = new AdmZip((await deployCourse(artifact, { format })).zip);
				expect(zip.getEntry("assets/corners.png")).not.toBeNull();
				const pages = zip
					.getEntries()
					.filter((entry) => entry.entryName.endsWith(".html"))
					.map((entry) => zip.readAsText(entry))
					.join("\n");
				expect(pages).toContain(`${derivative ?? "assets/corners.png"}?version=1#corner`);
				expect(pages).toContain(`${derivative ?? "assets/direct.png"}#crop`);
				expect(pages).not.toContain("/assets/corners.png");
			}
			expect(input.frontmatter).toEqual(original);
		} finally {
			await artifact.dispose();
		}
	});

	it("deploys from captured adapter bytes after desktop resources change", async () => {
		const artifact = await compileCourse(createDesktopInput(), {
			mode: "desktop",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		expect(
			artifact.manifest.files.find((file) => file.path === "assets/sample.mov")?.mediaType,
		).toBe("video/quicktime");
		await writeFile(path.join(prebuiltAssetsDir, HOST_FILENAMES.scorm12), "mutated", "utf-8");

		try {
			const zip = new AdmZip((await deployCourse(artifact, { format: "scorm12" })).zip);
			expect(zip.readAsText(HOST_FILENAMES.scorm12)).toBe("window.PraxityHost={};");
		} finally {
			await artifact.dispose();
		}
	});

	it("preserves authored slide design in the shared preview and export artifact", async () => {
		const parsed = readSource(
			'---\ntitle: Slide contract\npageStyles:\n  closing: { align: center, chrome: minimal, measure: narrow }\ndesign:\n  navArchetype: custom\n  navArchetypeBase: slides\n  navPrevNext: true\n  navBottomArrows: false\n  slideTransition: zoom\n  backgroundTexture: paper\n  highlightStyle: scribble\n  imageHoverEffect: glow\n  imageEffectsAuto: true\n  imageEffects:\n    colorWash: { intensity: 45, color: "#12abef" }\n---\n\n# Opening\n\nCourse introduction.\n\n# Authored closing {style=closing}\n\nCourse body.\n',
		);
		const input = createDesktopHtmlInput();
		input.blocks = parsed.blocks;
		input.frontmatter = parsed.frontmatter;
		const artifact = await compileCourse(input, {
			mode: "desktop",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		let preview: CoursePreviewDeployment | undefined;
		try {
			preview = await deployCourse(artifact, { format: "electron-preview" });
			const zip = new AdmZip((await deployCourse(artifact, { format: "html" })).zip);
			const page = artifact.manifest.pages[1];
			expect(page.slug).toBe("authored-closing");
			const chunks: Buffer[] = [];
			for await (const chunk of await preview.openFile(`${page.slug}.html`)) {
				chunks.push(Buffer.from(chunk));
			}
			for (const html of [
				Buffer.concat(chunks).toString("utf8"),
				zip.readAsText(`${page.slug}.html`),
			]) {
				const config = JSON.parse(
					html.match(/<script[^>]*id="praxity-config"[^>]*>(.*?)<\/script>/s)?.[1] ?? "null",
				);
				expect(config).toMatchObject({
					navigationStyle: "slides",
					navPrevNext: true,
					navBottomArrows: false,
					slideTransition: "zoom",
					slideStyles: { closing: { align: "center", chrome: "minimal", measure: "narrow" } },
					texture: "none",
					imageHoverEffect: "none",
					imageEffectsAuto: false,
					imageEffects: null,
				});
				expect(html).toContain('data-praxity-highlight-style="scribble"');
				expect(html).toContain('data-slide-style="closing" data-slide-chrome="minimal"');
				expect(html.match(/<h1\b/g)).toHaveLength(1);
				expect(html).not.toContain('class="praxity-page-title"');
			}
		} finally {
			if (preview) await preview.dispose();
			await artifact.dispose();
		}
	});

	it("publishes the same learner body in preview, HTML, and SCORM", async () => {
		const input = createDesktopHtmlInput();
		input.blocks = [
			{ id: "heading", type: "heading", data: { content: "Course overview", level: 1 } },
			{ id: "body", type: "text", data: { content: "<p>Read the course guide.</p>" } },
			{
				id: "link",
				type: "button",
				data: { text: "Open guide", href: "https://example.org/guide" },
			},
		];
		const artifact = await compileCourse(input, {
			mode: "desktop",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		let preview: CoursePreviewDeployment | undefined;
		try {
			preview = await deployCourse(artifact, { format: "electron-preview" });
			const slug = artifact.manifest.pages[0].slug;
			const chunks: Buffer[] = [];
			for await (const chunk of await preview.openFile(`${slug}.html`))
				chunks.push(Buffer.from(chunk));
			const documents = [Buffer.concat(chunks).toString("utf8")];
			for (const format of ["html", "scorm12"] as const) {
				documents.push(
					new AdmZip((await deployCourse(artifact, { format })).zip).readAsText(`${slug}.html`),
				);
			}
			const pages = documents.map((html) => new JSDOM(html));
			try {
				const bodies = pages.map((page) => page.window.document.querySelector("main")?.innerHTML);
				expect(bodies[0]).toContain("Read the course guide.");
				expect(bodies[0]).toContain("Open guide");
				expect(bodies[1]).toBe(bodies[0]);
				expect(bodies[2]).toBe(bodies[0]);
			} finally {
				for (const page of pages) page.window.close();
			}
		} finally {
			if (preview) await preview.dispose();
			await artifact.dispose();
		}
	});

	it("serves captured standalone HTML with the published host and no iframe host", async () => {
		const artifact = await compileCourse(createDesktopHtmlInput(), {
			mode: "desktop",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		let standalone: CoursePreviewDeployment | undefined;
		try {
			standalone = await deployCourse(artifact, { format: "standalone" });
			const slug = artifact.manifest.pages[0].slug;
			const chunks: Buffer[] = [];
			for await (const chunk of await standalone.openFile(`${slug}.html`))
				chunks.push(Buffer.from(chunk));
			const html = Buffer.concat(chunks).toString("utf8");
			expect(html).toContain('"format":"standalone"');
			expect(html).toContain(`src="${HOST_FILENAMES.standalone}"`);
			expect(html).not.toContain(HOST_FILENAMES.electronPreview);
			expect(standalone.format).toBe("standalone");
			const published = new AdmZip((await deployCourse(artifact, { format: "html" })).zip);
			expect(html).toBe(published.readAsText(`${slug}.html`));
			expect(
				standalone.manifest.files.some((file) => file.path === HOST_FILENAMES.standalone),
			).toBe(true);
			expect(
				standalone.manifest.files.some((file) => file.path === HOST_FILENAMES.electronPreview),
			).toBe(false);
		} finally {
			await standalone?.dispose();
			await artifact.dispose();
		}
	});

	it("uses the durable desktop course ID in repeated builds", async () => {
		const buildPage = async () => {
			const result = await buildScormPackage(createDesktopInput(), {
				mode: "desktop",
				format: "html",
				prebuiltAssetsDir,
				projectDir: "/tmp/project",
			});
			return new AdmZip(result.zip).readAsText("untitled.html");
		};
		const first = await buildPage();

		expect(await buildPage()).toBe(first);
		expect(first).toContain('data-course-id="desktop-course"');
	});

	it("bundles local light and dark logos without a network request", async () => {
		const input = createDesktopHtmlInput();
		const design = input.frontmatter.design;
		if (!design) throw new Error("Expected fixture design");
		design.navTopBar = true;
		design.navCourseTitle = true;
		design.brand = {
			logoUrl: "/assets/light.svg",
			logoDarkUrl: "/assets/dark.svg",
			logoPlacement: "center",
			logoScope: "all-pages",
		};
		const svg = new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M1 1h2"/></svg>',
		);
		input.resolvedAssets.set("assets/light.svg", svg);
		input.resolvedAssets.set("assets/dark.svg", svg);
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("Unexpected network request"));
		try {
			const result = await buildScormPackage(input, {
				mode: "desktop",
				format: "html",
				prebuiltAssetsDir,
				projectDir: "/tmp/project",
			});
			const zip = new AdmZip(result.zip);
			expect(zip.getEntry("assets/light.svg")).toBeTruthy();
			expect(zip.getEntry("assets/dark.svg")).toBeTruthy();
			const html = zip.readAsText("untitled.html");
			expect(html).toContain('src="assets/light.svg"');
			expect(html).toContain('src="assets/dark.svg"');
			expect(html).toContain("praxity-toolbar-context praxity-brand-title");
			expect(fetchSpy).not.toHaveBeenCalled();
			input.resolvedAssets.delete("assets/dark.svg");
			await expect(
				buildScormPackage(input, {
					mode: "desktop",
					format: "html",
					prebuiltAssetsDir,
					projectDir: "/tmp/project",
				}),
			).rejects.toThrow("Missing local brand logo asset");
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("publishes ordinary notes without decorative catalog icons", async () => {
		const input = createDesktopInput();
		input.blocks = [{ id: "note", type: "note", data: { content: "Think", icon: "bulb" } }];
		const result = await buildScormPackage(input, {
			mode: "desktop",
			format: "html",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});

		const html = new AdmZip(result.zip).readAsText("untitled.html");
		expect(html).not.toContain("tabler-icon-bulb");
		expect(html).not.toContain("praxity-note-icon");
		expect(html).toContain('class="praxity-note-label">Note</strong> Think');
	});

	it("normalizes root-local media URLs in generated package HTML", async () => {
		const input = createDesktopInput();
		const pageData = {
			_narrationEnabled: true,
			narrationAudio: "/assets/narration.mp3",
			narrationTimings: "/assets/narration.vtt",
		};
		input.blocks = [
			{ id: "image", type: "image", data: { src: "/assets/hero.webp", altText: "Hero" } },
			{ id: "audio", type: "audio", data: { src: "/assets/audio.mp3" } },
			{
				id: "video",
				type: "video",
				data: { source: { type: "url", src: "/assets/video.mp4" } },
			},
			{ id: "document", type: "document", data: { url: "/assets/guide.pdf" } },
			{
				id: "external",
				type: "image",
				data: { src: "https://cdn.example.com/external.webp", altText: "External" },
			},
			{
				id: "protocol-relative",
				type: "image",
				data: { src: "//cdn.example.com/external.webp", altText: "External" },
			},
		] as DesktopExportInput["blocks"];
		input.blocks.unshift({
			id: "initial-boundary",
			type: "pageBreak",
			data: { id: "initial-page", ...pageData },
		});
		input.resolvedAssets = new Map(
			["hero.webp", "audio.mp3", "video.mp4", "guide.pdf", "narration.mp3", "narration.vtt"].map(
				(name) => [`assets/${name}`, new Uint8Array([1])],
			),
		);

		const result = await buildScormPackage(input, {
			mode: "desktop",
			format: "scorm12",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		const zip = new AdmZip(result.zip);
		const html = zip
			.getEntries()
			.filter((entry) => entry.entryName.endsWith(".html"))
			.map((entry) => zip.readAsText(entry))
			.join("\n");

		expect(html).not.toContain('"/assets/');
		for (const name of [
			"hero.webp",
			"audio.mp3",
			"video.mp4",
			"guide.pdf",
			"narration.mp3",
			"narration.vtt",
		]) {
			expect(html).toContain(`assets/${name}`);
		}
		expect(html).toContain("https://cdn.example.com/external.webp");
		expect(html).not.toContain('src="//cdn.example.com/external.webp"');
	});

	it("rejects missing local narration assets", async () => {
		const input = createDesktopInput();
		input.blocks.unshift({
			id: "initial-boundary",
			type: "pageBreak",
			data: { id: "initial-page", narrationAudio: "assets/narration/missing.mp3" },
		});
		await expect(
			buildScormPackage(input, {
				mode: "desktop",
				format: "scorm12",
				prebuiltAssetsDir,
				projectDir: "/tmp/project",
			}),
		).rejects.toThrow(/Missing narration asset: assets\/narration\/missing\.mp3/u);
	});

	it("rejects a missing dialogue avatar asset", async () => {
		const input = createDesktopInput();
		input.blocks.push({
			id: "d",
			type: "dialogue",
			data: {
				turns: [
					{
						id: "item-0",
						speaker: "alex",
						name: "Alex",
						avatar: "assets/missing-avatar.png",
						paragraphs: ["Hi"],
					},
				],
			},
		});
		await expect(
			buildScormPackage(input, {
				mode: "desktop",
				format: "scorm12",
				prebuiltAssetsDir,
				projectDir: "/tmp/project",
			}),
		).rejects.toThrow("Missing avatar asset: assets/missing-avatar.png");
	});

	it("keeps assessment narration metadata and assets in the SCORM 2004 ZIP", async () => {
		const input = createDesktopInput();
		const narration = {
			narration: "Which answer is correct?",
			narrationAudio: "assets/question.mp3",
			narrationTimings: "assets/question.vtt",
			narrationDuration: 5,
		};
		input.blocks = [
			{
				id: "question",
				type: "assessment",
				data: {
					assessmentType: "choice",
					stem: [
						{
							id: "question-stem",
							type: "text",
							data: { content: "<p>Which answer is correct?</p>" },
						},
					],
					response: {
						type: "choice",
						selectionMode: "single",
						options: [{ id: "answer", label: "Yes", isCorrect: true }],
					},
					...narration,
				},
			},
		];
		input.frontmatter.narrationEnabled = true;
		input.resolvedAssets.set(narration.narrationAudio, new Uint8Array([1, 2, 3]));
		input.resolvedAssets.set(narration.narrationTimings, new TextEncoder().encode("WEBVTT\n"));
		const result = await buildScormPackage(input, {
			mode: "desktop",
			format: "scorm2004",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		const zip = new AdmZip(result.zip);
		const html = zip
			.getEntries()
			.filter((entry) => entry.entryName.endsWith(".html"))
			.map((entry) => zip.readAsText(entry))
			.find((text) => text.includes('id="praxity-config"'));
		const config = JSON.parse(
			html?.match(/<script[^>]*id="praxity-config"[^>]*>(.*?)<\/script>/s)?.[1] ?? "{}",
		);
		expect(config.blocks[0].data).toMatchObject(narration);
		expect(config.blocks[0].data.stem).toHaveLength(1);
		expect(zip.getEntry(narration.narrationAudio)).not.toBeNull();
		expect(zip.getEntry(narration.narrationTimings)).not.toBeNull();
	});

	it("desktop mode SCORM 2004 generates a 2004 manifest", async () => {
		const result = await buildScormPackage(createDesktopInput(), {
			mode: "desktop",
			format: "scorm2004",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});

		const zip = new AdmZip(result.zip);
		const entries = zip.getEntries().map((entry) => entry.entryName);
		expect(entries).toContain("desktop-only-2004.xsd");
		expect(entries).toContain(HOST_FILENAMES.scorm2004);
		expect(entries).not.toContain(HOST_FILENAMES.scorm12);
		expect(entries).not.toContain(HOST_FILENAMES.xapi);
		expect(entries).not.toContain("scorm-runtime.js");
		const manifest = zip.readAsText("imsmanifest.xml");
		expect(manifest).toContain("2004 3rd Edition");
	});

	it("desktop mode SCORM 2004 can generate a 4th Edition manifest", async () => {
		const result = await buildScormPackage(createDesktopInput(), {
			mode: "desktop",
			format: "scorm2004",
			scorm2004Edition: "4th",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});

		const manifest = new AdmZip(result.zip).readAsText("imsmanifest.xml");
		expect(manifest).toContain("2004 4th Edition");
		expect(manifest).not.toContain("2004 3rd Edition");
	});

	it.each([
		[0, 0],
		[0.8, 80],
		[1, 100],
		[80, 80],
		[100, 100],
	])("normalizes desktop threshold %s to %s percent", async (threshold, expected) => {
		const input = createDesktopInput();
		input.config.completionThreshold = threshold;
		const result = await buildScormPackage(input, {
			mode: "desktop",
			format: "scorm2004",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});

		const zip = new AdmZip(result.zip);
		const lessonEntry = zip
			.getEntries()
			.map((entry) => entry.entryName)
			.find(
				(name) => name.endsWith(".html") && name !== "index.html" && !/^page-\d+\.html$/.test(name),
			);
		expect(lessonEntry).toBeTruthy();
		const html = zip.readAsText(lessonEntry ?? "page-1.html");
		const hostConfig = JSON.parse(
			html.match(
				/<script id="praxity-host-config" type="application\/json">([\s\S]*?)<\/script>/,
			)?.[1] ?? "{}",
		) as Record<string, unknown>;

		expect(hostConfig).toMatchObject({
			completionMethod: "percentage",
			completionThreshold: expected,
		});
		expect(html).not.toContain("trackerOpts.completionThreshold");
	});

	it("carries a course pass mark to the page host config and both SCORM manifests", async () => {
		const input = createDesktopInput();
		input.blocks.push(
			...readSource(
				"# Untitled {hideTitle}\n\n::: choice Pick the safe step {scored level=3}\n(x) Stop work\n( ) Keep going\n:::\n",
			).blocks,
		);
		input.config.passingScore = 0.5;
		for (const format of ["scorm2004", "scorm12"] as const) {
			const result = await buildScormPackage(input, {
				mode: "desktop",
				format,
				prebuiltAssetsDir,
				projectDir: "/tmp/project",
			});
			const zip = new AdmZip(result.zip);
			const page = zip
				.getEntries()
				.map((entry) => entry.entryName)
				.find(
					(name) =>
						name.endsWith(".html") && name !== "index.html" && !/^page-\d+\.html$/.test(name),
				);
			const hostConfig = JSON.parse(
				zip
					.readAsText(page ?? "page-1.html")
					.match(
						/<script id="praxity-host-config" type="application\/json">([\s\S]*?)<\/script>/,
					)?.[1] ?? "{}",
			) as Record<string, unknown>;
			expect(hostConfig.passMark).toBe(50);
			expect(hostConfig.completionMethod).toBe("percentage");
			expect(hostConfig.scoredAssessmentIds).toHaveLength(1);
			const manifest = zip.readAsText("imsmanifest.xml");
			expect(manifest).toContain(
				format === "scorm12"
					? "<adlcp:masteryscore>50</adlcp:masteryscore>"
					: "<imsss:minNormalizedMeasure>0.5</imsss:minNormalizedMeasure>",
			);
		}
	});

	it("rejects a pass mark when no required question can be scored", async () => {
		const input = createDesktopInput();
		input.config.passingScore = 0.5;
		await expect(
			buildScormPackage(input, {
				mode: "desktop",
				format: "scorm2004",
				prebuiltAssetsDir,
				projectDir: "/tmp/project",
			}),
		).rejects.toThrow("passing score needs at least one required, automatically scored question");
		input.config.passingScore = 0;
		await expect(
			buildScormPackage(input, {
				mode: "desktop",
				format: "scorm2004",
				prebuiltAssetsDir,
				projectDir: "/tmp/project",
			}),
		).rejects.toThrow("Passing score must be");
	});

	it.each([-1, 101, 8000, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects invalid desktop threshold %s before publishing",
		async (threshold) => {
			const input = createDesktopInput();
			input.config.completionThreshold = threshold;
			await expect(
				buildScormPackage(input, {
					mode: "desktop",
					format: "scorm2004",
					prebuiltAssetsDir,
					projectDir: "/tmp/project",
				}),
			).rejects.toThrow("Completion threshold must be");
		},
	);

	function createTooltipInput(glossaryPage?: boolean): DesktopExportInput {
		return {
			courseId: "desktop-course",
			blocks: [
				{
					id: "b1",
					type: "text",
					data: {
						content:
							'<p>Wear <span class="inline-tooltip-trigger" data-tooltip-content="Personal Protective Equipment">PPE</span> on site.</p>',
					},
				},
			],
			frontmatter: {
				title: "Tooltip Course",
				lang: "en",
				design:
					glossaryPage === undefined
						? undefined
						: ({ glossaryPage } as unknown as NonNullable<
								DesktopExportInput["frontmatter"]["design"]
							>),
			},
			config: { completionThreshold: 0.8 },
			resolvedAssets: new Map(),
			viewerVersion: "test-viewer",
			locale: "en",
		};
	}

	/**
	 * The unit tests in export-contrast.test.ts prove the helper corrects each role.
	 * This proves every emission path actually runs through it: a real build with a
	 * palette an author could plausibly pick, where every text role starts below the
	 * floor. Author-supplied brand colours reaching output unvalidated was the P1 in
	 * the 2026-07-28 audit.
	 */
	it("holds the 4.5:1 text floor for a palette that starts below it", async () => {
		const hostile = {
			palette: "standard",
			colorMode: "light",
			colorBackground: "#ffffff",
			colorBackgroundLight: "#ffffff",
			colorText: "#a0a0a0",
			colorAccent: "#9ad3ff",
			colorSuccess: "#7bd88f",
			colorError: "#ff9d9d",
			colorWarning: "#ffd166",
			colorButtonBackground: "#e8f4ff",
			colorButtonText: "#c8d8e8",
			componentDefaults: {},
		} as unknown as NonNullable<DesktopExportInput["frontmatter"]["design"]>;

		const result = await buildScormPackage(
			{
				courseId: "desktop-course",
				blocks: [{ id: "b1", type: "text", data: { content: "<p>Readable?</p>" } }],
				frontmatter: { title: "Hostile Palette", lang: "en", design: hostile },
				config: { completionThreshold: 0.8 },
				resolvedAssets: new Map(),
				viewerVersion: "test-viewer",
				locale: "en",
			},
			{ mode: "desktop", format: "html", prebuiltAssetsDir, projectDir: "/tmp/project" },
		);

		const zip = new AdmZip(result.zip);
		const page = zip
			.getEntries()
			.find(
				(entry) => entry.entryName.endsWith(".html") && zip.readAsText(entry).includes("Readable?"),
			);
		expect(page).toBeDefined();
		const css = zip.readAsText(stylesheetEntry(zip));
		const vars = new Map<string, string>();
		for (const match of css.matchAll(/(--praxity-color-[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) {
			vars.set(match[1], match[2]);
		}

		const background = vars.get("--praxity-color-background") ?? "#ffffff";
		const surface = vars.get("--praxity-color-surface") ?? background;
		const textRoles = [
			"--praxity-color-text",
			"--praxity-color-text-light",
			"--praxity-color-text-muted",
			"--praxity-color-accent-text",
			"--praxity-color-success-text",
			"--praxity-color-error-text",
			"--praxity-color-warning-text",
		];

		const failures: string[] = [];
		for (const role of textRoles) {
			const value = vars.get(role);
			if (!value) continue;
			const worst = Math.min(contrastRatio(value, background), contrastRatio(value, surface));
			if (worst < 4.5) failures.push(`${role}=${value} at ${worst.toFixed(2)}:1`);
		}
		expect(failures).toEqual([]);

		// The author's fills are theirs to choose — only the text roles get corrected.
		expect(
			contrastRatio(vars.get("--praxity-color-accent") ?? "", background),
		).toBeGreaterThanOrEqual(4.5);
	});

	it("aggregates inline tooltips into a glossary page by default", async () => {
		const result = await buildScormPackage(createTooltipInput(), {
			mode: "desktop",
			format: "html",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});

		const zip = new AdmZip(result.zip);
		expect(zip.getEntries().map((entry) => entry.entryName)).toContain("glossary.html");
		expect(zip.readAsText("glossary.html")).toContain("Personal Protective Equipment");
	});

	it.each([false, true])(
		"retains each module's glossary setting when the first is %s",
		async (firstEnabled) => {
			const input = createTooltipInput(firstEnabled);
			input.config.moduleDeck = {};
			if (input.frontmatter.design) {
				input.frontmatter.design.customCss = ".author-last { color: rebeccapurple; }";
			}
			input.blocks.unshift({
				id: "first-boundary",
				type: "pageBreak",
				data: { id: "first-slide", lessonId: "first-module", deckGlossaryPage: firstEnabled },
			});
			input.blocks.push(
				{
					id: "second-boundary",
					type: "pageBreak",
					data: {
						id: "second-slide",
						title: "Second module",
						lessonId: "second-module",
						deckGlossaryPage: !firstEnabled,
					},
				},
				{ id: "second-text", type: "text", data: { content: "Second module content" } },
			);
			const result = await buildScormPackage(input, {
				mode: "desktop",
				format: "html",
				prebuiltAssetsDir,
				projectDir: "/tmp/project",
			});
			const zip = new AdmZip(result.zip);
			expect(zip.readAsText("glossary.html")).toContain("Personal Protective Equipment");
			const moduleHtml = zip
				.getEntries()
				.filter((entry) => entry.entryName.endsWith(".html"))
				.map((entry) => zip.readAsText(entry))
				.filter((html) => html.includes('id="deck-outline-toggle"'));
			expect(moduleHtml).toHaveLength(2);
			for (const html of moduleHtml) {
				const isFirst = html.includes('data-deck-slide="first-slide"');
				expect(html.includes('href="glossary.html"')).toBe(isFirst ? firstEnabled : !firstEnabled);
				const deckStylesheet = html.match(
					/<link rel="stylesheet" href="(styles-lite-deck\.[a-f0-9]{12}\.css)"/u,
				)?.[1];
				expect(deckStylesheet).toBeDefined();
				const css = zip.readAsText(deckStylesheet as string);
				expect(css).toContain(".praxity-deck{}");
				expect(css.indexOf(".praxity-deck{}")).toBeLessThan(css.indexOf(".author-last"));
			}
			expect(zip.readAsText("glossary.html")).toMatch(/href="styles-lite\.[a-f0-9]{12}\.css"/u);
			expect(zip.getEntries().some((entry) => /^styles-deck\./u.test(entry.entryName))).toBe(false);
		},
	);

	it("keeps tooltips inline but skips the glossary page when design.glossaryPage is false", async () => {
		const result = await buildScormPackage(createTooltipInput(false), {
			mode: "desktop",
			format: "html",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});

		const zip = new AdmZip(result.zip);
		const entries = zip.getEntries().map((entry) => entry.entryName);
		expect(entries).not.toContain("glossary.html");
		const lessonEntry = entries.find(
			(name) => name.endsWith(".html") && name !== "index.html" && !/^page-\d+\.html$/.test(name),
		);
		expect(lessonEntry).toBeDefined();
		const html = zip.readAsText(lessonEntry as string);
		expect(html).toContain("data-tooltip-content");
		expect(html).not.toContain("glossary.html");
	});

	it("desktop mode HTML maps frontmatter design into viewer config", async () => {
		const result = await buildScormPackage(createDesktopHtmlInput(), {
			mode: "desktop",
			format: "html",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});

		const zip = new AdmZip(result.zip);
		const entries = zip.getEntries().map((entry) => entry.entryName);
		// page-N.html are redirect shims; the course chrome lives on the slug pages.
		const lessonEntry = entries.find(
			(name) => name.endsWith(".html") && name !== "index.html" && !/^page-\d+\.html$/.test(name),
		);
		expect(lessonEntry).toBeTruthy();
		const html = zip.readAsText(lessonEntry ?? "page-1.html");
		const css = zip.readAsText(stylesheetEntry(zip));

		const accentText = css.match(/--praxity-color-accent-text:\s*(#[0-9a-fA-F]{6})/)?.[1];
		const background = css.match(/--praxity-color-background:\s*(#[0-9a-fA-F]{6})/)?.[1];
		expect(css).not.toContain("--praxity-color-accent: #ff6b35;");
		expect(accentText).toBeDefined();
		expect(background).toBeDefined();
		expect(contrastRatio(accentText ?? "", background ?? "")).toBeGreaterThanOrEqual(4.5);
		expect(css).toContain("--praxity-font-family: 'Source Sans 3', sans-serif;");
		expect(css).not.toContain("--praxity-spacing-md: 32px;");
		expect(css).not.toContain("--praxity-block-spacing: 40px;");
		// The fixture's archetype is `bottomBar`; it also sets navScrollProgress and
		// navFloatingToc. This used to assert `praxity-layout-scroll`, because the
		// exporter reverse-inferred the layout from toggles and those two outvoted the
		// author's choice. The archetype now decides, and toggles only customise it.
		expect(html).toContain('<body class="praxity-layout-bottombar">');
		expect(html).not.toContain('data-praxity-image-hover="glow"');
		expect(html).not.toContain('class="praxity-page-title"');
		expect(html).not.toContain('id="praxity-filter-duotone"');
	});

	it("desktop mode HTML supports partial design and legacy navLayout fallback", async () => {
		const result = await buildScormPackage(createPartialDesktopHtmlInput(), {
			mode: "desktop",
			format: "html",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});

		const zip = new AdmZip(result.zip);
		const entries = zip.getEntries().map((entry) => entry.entryName);
		// page-N.html are redirect shims; the course chrome lives on the slug pages.
		const lessonEntry = entries.find(
			(name) => name.endsWith(".html") && name !== "index.html" && !/^page-\d+\.html$/.test(name),
		);
		expect(lessonEntry).toBeTruthy();
		const html = zip.readAsText(lessonEntry ?? "page-1.html");
		const css = zip.readAsText(stylesheetEntry(zip));

		const accentText = css.match(/--praxity-color-accent-text:\s*(#[0-9a-fA-F]{6})/)?.[1];
		const background = css.match(/--praxity-color-background:\s*(#[0-9a-fA-F]{6})/)?.[1];
		expect(css).not.toContain("--praxity-color-accent: #0ea5e9;");
		expect(accentText).toBeDefined();
		expect(background).toBeDefined();
		expect(contrastRatio(accentText ?? "", background ?? "")).toBeGreaterThanOrEqual(4.5);
		const focus = css.match(/--praxity-color-focus:\s*(#[0-9a-fA-F]{6})/)?.[1];
		expect(focus).toBeDefined();
		expect(contrastRatio(focus ?? "", background ?? "")).toBeGreaterThanOrEqual(3);
		expect(css).toContain("--praxity-color-border:");
		expect(css).toContain("--praxity-color-background-alt:");
		expect(css).toContain("--praxity-color-button-outline:");
		expect(css).toContain("--praxity-font-family: 'Source Sans 3', sans-serif;");
		expect(css).toContain(".client-custom { color: red; }");
		expect(css.indexOf(".client-custom")).toBeGreaterThan(css.indexOf("--praxity-color-accent"));
		expect(html).not.toContain("</style><script>alert('xss')</script>");
		expect(css).not.toContain("</style><script>alert('xss')</script>");
		expect(html).not.toContain("custom-css");
		expect(css).not.toContain("<script>");
		expect(html).toContain('<body class="praxity-layout-bottombar">');
	});
});
