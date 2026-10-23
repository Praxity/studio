import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readLesson } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildScormPackage, type DesktopExportInput } from "../src/build";
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
	narration: "island-narration-TEST1234.js",
} as const;

describe("desktop media assets", () => {
	let prebuiltAssetsDir: string;
	let projectDir: string;

	beforeEach(async () => {
		prebuiltAssetsDir = await mkdtemp(path.join(os.tmpdir(), "desktop-narration-prebuilt-"));
		projectDir = await mkdtemp(path.join(os.tmpdir(), "desktop-narration-project-"));
		await writeFile(path.join(prebuiltAssetsDir, "viewer.css"), "", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "deck-shell.css"), "", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "retrieval-sheet.css"), "", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "highlight.css"), "", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, SHELL_FILENAME), "", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, RESUME_FILENAME), "", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "styles.css"), "", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "review-comments.js"), "", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "review-comments.css"), "", "utf-8");
		await mkdir(path.join(prebuiltAssetsDir, "islands"));
		for (const filename of Object.values(ISLAND_FILENAMES)) {
			await writeFile(path.join(prebuiltAssetsDir, "islands", filename), "", "utf-8");
		}
		for (const filename of Object.values(HOST_FILENAMES)) {
			await writeFile(path.join(prebuiltAssetsDir, filename), "", "utf-8");
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
					"island-nav": ISLAND_FILENAMES.nav,
					"island-narration": ISLAND_FILENAMES.narration,
				},
				islandFiles: Object.values(ISLAND_FILENAMES),
				islandDependencies: {
					"island-loader": [ISLAND_FILENAMES.loader],
					"island-nav": [ISLAND_FILENAMES.nav],
					"island-narration": [ISLAND_FILENAMES.narration],
				},
			}),
			"utf-8",
		);
		await mkdir(path.join(prebuiltAssetsDir, "schemas", "scorm2004"), { recursive: true });
		await writeFile(
			path.join(prebuiltAssetsDir, "schemas", "license.txt"),
			await readFile(new URL("../schemas/license.txt", import.meta.url)),
		);
		await writeFile(
			path.join(prebuiltAssetsDir, "schemas", "scorm2004", "test-schema.xsd"),
			"<schema/>",
			"utf-8",
		);
	});

	afterEach(async () => {
		await Promise.all([
			rm(prebuiltAssetsDir, { recursive: true, force: true }),
			rm(projectDir, { recursive: true, force: true }),
		]);
	});

	it.each(["intro caption.vtt", "intro%20caption.vtt"])(
		"packages an authored local VTT referenced as %s by the French video track",
		async (captionFile) => {
			const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nBonjour.\n";
			const blocks = readLesson(
				`# Video {hideTitle}\n\n::: video /assets/intro.mp4 {captions="/assets/${captionFile}"}\ncaption: Visible description\n:::\n`,
				{
					ids: (node, role) =>
						role === "caption"
							? "caption-binding"
							: `${node.kind}-${node.span.start}-${role ?? "node"}`,
				},
			).blocks;
			blocks[0].data.lessonLocale = "fr";
			const result = await buildScormPackage(
				{
					courseId: "captioned-video",
					blocks,
					frontmatter: { title: "Captioned video", lang: "en" },
					config: { completionThreshold: 0.8 },
					resolvedAssets: new Map([
						[
							"assets/intro.mp4",
							await readFile(
								new URL("../../../docs/test-fixtures/assets/test-video.mp4", import.meta.url),
							),
						],
						["assets/intro caption.vtt", new TextEncoder().encode(vtt)],
					]),
					viewerVersion: "test-viewer",
					locale: "en",
				},
				{
					mode: "desktop",
					format: "scorm2004",
					prebuiltAssetsDir,
					projectDir,
				},
			);
			const zip = new AdmZip(result.zip);
			expect(zip.getEntry("assets/intro caption.vtt")?.getData().toString()).toBe(vtt);
			const html = zip
				.getEntries()
				.filter((entry) => entry.entryName.endsWith(".html"))
				.map((entry) => zip.readAsText(entry))
				.join("\n");
			expect(html).toContain(
				`<track kind="captions" src="assets/${captionFile}" srclang="fr" label="Français" default />`,
			);
			expect(html).toContain(
				'<p class="praxity-block-caption"><span data-node-id="caption-binding">Visible description</span></p>',
			);
		},
	);

	it("rejects an authored local VTT missing from resolved project assets", async () => {
		await expect(
			buildScormPackage(
				{
					courseId: "captioned-video-missing-file",
					blocks: readLesson(
						"# Untitled {hideTitle}\n\n::: video /assets/intro.mp4 {captions=/assets/missing.vtt}\n:::\n",
					).blocks,
					frontmatter: { title: "Captioned video", lang: "en" },
					config: { completionThreshold: 0.8 },
					resolvedAssets: new Map([["assets/intro.mp4", new Uint8Array([0, 0, 0, 0])]]),
					viewerVersion: "test-viewer",
					locale: "en",
				},
				{ mode: "desktop", format: "scorm2004", prebuiltAssetsDir, projectDir },
			),
		).rejects.toThrow("Missing caption asset: /assets/missing.vtt");
	});

	it("bundles page title narration audio and timings and rewrites page config URLs", async () => {
		const input: DesktopExportInput = {
			courseId: "desktop-narration-course",
			blocks: [
				{ id: "b1", type: "text", data: { content: "<p>Intro</p>" } },
				{
					id: "pb1",
					type: "pageBreak",
					data: {
						title: "S2",
						_narrationEnabled: true,
						narrationAudio: "/assets/n.mp3",
						narrationTimings: "/assets/n.vtt",
					},
				},
				{ id: "b2", type: "text", data: { content: "<p>Slide two</p>" } },
			],
			frontmatter: { title: "Narrated Desktop Course", lang: "en" },
			config: { completionThreshold: 0.8 },
			resolvedAssets: new Map([
				["assets/n.mp3", new Uint8Array([0x49, 0x44, 0x33])],
				["assets/n.vtt", new TextEncoder().encode("WEBVTT\n")],
			]),
			viewerVersion: "test-viewer",
			locale: "en",
		};

		const result = await buildScormPackage(input, {
			mode: "desktop",
			format: "scorm2004",
			prebuiltAssetsDir,
			projectDir,
		});

		const zip = new AdmZip(result.zip);
		const entries = zip.getEntries().map((entry) => entry.entryName);
		expect(entries).toContain("assets/n.mp3");
		expect(entries).toContain("assets/n.vtt");
		expect(entries).toContain(HOST_FILENAMES.scorm2004);
		expect(entries).not.toContain(HOST_FILENAMES.scorm12);
		expect(entries).not.toContain(HOST_FILENAMES.xapi);
		expect(entries).not.toContain("scorm-runtime.js");

		const pageHtml = entries
			.filter((entry) => entry.endsWith(".html") && entry !== "index.html")
			.map((entry) => zip.readAsText(entry))
			.find((html) => html.includes('"currentPage":2'));
		expect(pageHtml).toBeDefined();
		const configJson = pageHtml?.match(
			/<script id="praxity-config" type="application\/json">([\s\S]*?)<\/script>/,
		)?.[1];
		expect(configJson).toBeDefined();
		const config = JSON.parse(configJson ?? "{}") as {
			pages?: Array<{ data?: Record<string, unknown> }>;
		};
		expect(config.pages?.[1]?.data).toMatchObject({
			narrationAudio: "assets/n.mp3",
			narrationTimings: "assets/n.vtt",
		});
	});
	it("bundles each sequence item's audio and timings", async () => {
		const names = ["one.mp3", "one.vtt", "two.mp3", "two.vtt"];
		const result = await buildScormPackage(
			{
				courseId: "item-narration",
				blocks: [
					{
						id: "steps",
						type: "sequence",
						data: {
							orientation: "vertical",
							items: [
								{
									id: "first-step",
									label: "First",
									children: [
										{ id: "first-content", type: "text", data: { content: "First step" } },
									],
									narrationAudio: "/assets/one.mp3",
									narrationTimings: "/assets/one.vtt",
									narrationDuration: 80,
								},
								{
									id: "second-step",
									label: "Second",
									children: [
										{ id: "second-content", type: "text", data: { content: "Second step" } },
									],
									narrationAudio: "/assets/two.mp3",
									narrationTimings: "/assets/two.vtt",
									narrationDuration: 90,
								},
							],
						},
					},
				],
				frontmatter: { title: "Steps", lang: "en", narrationEnabled: true },
				config: { completionThreshold: 0.8 },
				resolvedAssets: new Map(
					names.map((name) => [
						`assets/${name}`,
						new TextEncoder().encode(name.endsWith("vtt") ? "WEBVTT\n" : "ID3"),
					]),
				),
				viewerVersion: "test-viewer",
				locale: "en",
			},
			{ mode: "desktop", format: "scorm2004", prebuiltAssetsDir, projectDir },
		);
		const zip = new AdmZip(result.zip);
		const entries = zip.getEntries().map((entry) => entry.entryName);
		for (const name of names) expect(entries).toContain(`assets/${name}`);
		const html = entries
			.filter((name) => name.endsWith(".html"))
			.map((name) => zip.readAsText(name))
			.find((html) => html.includes('id="praxity-config"'));
		const config = JSON.parse(
			html?.match(
				/<script id="praxity-config" type="application\/json">([\s\S]*?)<\/script>/,
			)?.[1] ?? "{}",
		);
		expect(config.blocks[0].data.items).toMatchObject([
			{ narrationAudio: "assets/one.mp3", narrationTimings: "assets/one.vtt" },
			{ narrationAudio: "assets/two.mp3", narrationTimings: "assets/two.vtt" },
		]);
	});
});
