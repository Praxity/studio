import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { buildScormPackage, type DesktopExportInput } from "../src/build";
import { type CourseConfig, generateHtmlPage } from "../src/html-gen";
import { fixtureCourseRuntimeLicense, fixtureRuntimeNotices } from "./fixtures/runtime-notices.ts";

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
	nav: "island-nav-TEST1234.js",
} as const;

function parseViewerConfig(html: string): Record<string, unknown> {
	const match = html.match(
		/<script id="praxity-config" type="application\/json">([\s\S]*?)<\/script>/,
	);
	expect(match).not.toBeNull();
	return JSON.parse(match?.[1] ?? "{}") as Record<string, unknown>;
}

describe("slide-style export config", () => {
	it("threads course slide styles into the hydrated viewer config", () => {
		const slideStyles = {
			"course-warning": {
				background: "accent",
				chrome: "minimal",
				measure: "wide",
			},
		} as const;
		const page: PraxityPage = {
			id: "page-1",
			title: "Warning",
			data: { style: "course-warning" },
			blocks: [{ id: "text-1", type: "text", data: { content: "<p>Take care.</p>" } }],
		};
		const config: CourseConfig = {
			id: "course-1",
			title: "Styled course",
			sourceLocale: "en",
			totalPages: 1,
			pages: [page],
			slideStyles,
			navToggles: {
				navEdgeArrows: true,
				navOutline: false,
			},
		};

		const html = generateHtmlPage({
			config,
			page,
			index: 0,
			currentSlug: "warning",
			slugList: [{ pageId: page.id, slug: "warning", title: page.title }],
			slugMap: new Map([[page.id, "warning"]]),
			islandAssets: {
				loaderFilename: ISLAND_FILENAMES.loader,
				islandFilenames: { nav: ISLAND_FILENAMES.nav },
			},
		});

		expect(parseViewerConfig(html).slideStyles).toEqual(slideStyles);
	});

	it("threads desktop grammar frontmatter styles through a built HTML export", async () => {
		const prebuiltAssetsDir = await mkdtemp(path.join(os.tmpdir(), "slide-styles-prebuilt-"));
		const projectDir = await mkdtemp(path.join(os.tmpdir(), "slide-styles-project-"));
		try {
			await mkdir(path.join(prebuiltAssetsDir, "islands"));
			await Promise.all([
				writeFile(path.join(prebuiltAssetsDir, "viewer.css"), ".viewer{}", "utf-8"),
				writeFile(path.join(prebuiltAssetsDir, "deck-shell.css"), ".praxity-deck{}", "utf-8"),
				writeFile(path.join(prebuiltAssetsDir, "highlight.css"), ".praxity-highlight{}", "utf-8"),
				writeFile(
					path.join(prebuiltAssetsDir, "retrieval-sheet.css"),
					".praxity-retrieval-sheet{}",
					"utf-8",
				),
				writeFile(path.join(prebuiltAssetsDir, SHELL_FILENAME), "window.shell={};", "utf-8"),
				writeFile(path.join(prebuiltAssetsDir, RESUME_FILENAME), "", "utf-8"),
				writeFile(path.join(prebuiltAssetsDir, "styles.css"), "body{}", "utf-8"),
				writeFile(path.join(prebuiltAssetsDir, "review-comments.js"), "", "utf-8"),
				writeFile(path.join(prebuiltAssetsDir, "review-comments.css"), "", "utf-8"),
				...Object.values(ISLAND_FILENAMES).map((filename) =>
					writeFile(path.join(prebuiltAssetsDir, "islands", filename), "", "utf-8"),
				),
				...Object.values(HOST_FILENAMES).map((filename) =>
					writeFile(path.join(prebuiltAssetsDir, filename), "", "utf-8"),
				),
				writeFile(
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
							"island-nav": ISLAND_FILENAMES.nav,
						},
						islandFiles: Object.values(ISLAND_FILENAMES),
						islandDependencies: {
							"island-loader": [ISLAND_FILENAMES.loader],
							"island-nav": [ISLAND_FILENAMES.nav],
						},
					}),
					"utf-8",
				),
			]);
			const slideStyles = {
				closing: {
					align: "center",
					chrome: "minimal",
					measure: "narrow",
				},
			} as const;
			const input: DesktopExportInput = {
				courseId: "slide-styles-course",
				blocks: [
					{ id: "text-1", type: "text", data: { content: "<p>Closing links</p>" } },
					{
						id: "page-break-1",
						type: "pageBreak",
						data: { style: "closing", title: "Closing" },
					},
					{ id: "text-2", type: "text", data: { content: "<p>More resources</p>" } },
				],
				frontmatter: {
					title: "Styled desktop course",
					styles: slideStyles,
					design: {
						navEdgeArrows: true,
						navOutline: false,
					} as unknown as NonNullable<DesktopExportInput["frontmatter"]["design"]>,
				},
				config: { completionThreshold: 0.8 },
				resolvedAssets: new Map(),
				viewerVersion: "test-viewer",
				locale: "en",
			};

			const result = await buildScormPackage(input, {
				mode: "desktop",
				format: "html",
				prebuiltAssetsDir,
				projectDir,
			});
			const zip = new AdmZip(result.zip);
			const contentPage = zip
				.getEntries()
				.find(
					(entry) =>
						entry.entryName.endsWith(".html") &&
						entry.entryName !== "index.html" &&
						entry.getData().toString("utf-8").includes('"currentPage":2'),
				);

			expect(contentPage).toBeDefined();
			expect(parseViewerConfig(contentPage?.getData().toString("utf-8") ?? "").slideStyles).toEqual(
				slideStyles,
			);
		} finally {
			await Promise.all([
				rm(prebuiltAssetsDir, { recursive: true, force: true }),
				rm(projectDir, { recursive: true, force: true }),
			]);
		}
	});
});
