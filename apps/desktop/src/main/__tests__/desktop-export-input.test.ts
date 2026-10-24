import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serializeIdentity } from "@praxity/content-identity";
import { createCourseContext } from "@praxity/export-pipeline";
import * as lessonLex from "@praxity/grammar/src/v4/lex/index.ts";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import type { NarrationSegmentV2, NarrationSidecarV2 } from "@praxity/shared-blocks/narration";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	parseNarrationSidecarV2,
	serializeNarrationSidecarV2,
} from "../../shared/narration-sidecar";
import { identityEditFixture } from "../../test-utils/identity-edit-fixture";
import { persistFixtureIdentity, readIdentityFixture } from "../../test-utils/identity-fixture";
import { narrationFixture } from "../../test-utils/narration-fixture";
import {
	ACCESSIBILITY_EXPORT_ERROR_PREFIX,
	assertExportAccessibility,
	ExportAccessibilityError,
} from "../export/accessibility-enforcement";
import {
	buildCourseExportInput,
	buildExportInputFromProject,
	ProjectLessonPreparation,
} from "../export/build-export-input-from-project";
import { loadIdentityStore } from "../identity-store";
import { readLessonSource, writeLessonSource } from "../lesson-source";

function narrationSegments(input: {
	blocks: { data: Record<string, unknown> }[];
}): NarrationSegmentV2[] {
	return input.blocks.flatMap(
		(block) => (block.data._narrationSegments ?? []) as NarrationSegmentV2[],
	);
}

describe("buildExportInputFromProject", () => {
	it.each([
		["course", "preview", "read-only"],
		["lesson", "preview", "read-only"],
		["course", "export", "read-only"],
		["lesson", "export", "read-only"],
		["course", "export", undefined],
		["lesson", "export", undefined],
	] as const)(
		"parses each lesson once for %s %s input under %s policy",
		async (scope, mode, manifestPolicy) => {
			await writeFile(
				path.join(projectDir, "course.yaml"),
				"title: Course\nlessons: [lesson-1.prax, lesson-2.prax]\n",
			);
			await writeFile(
				path.join(projectDir, "lesson-2.prax"),
				"# Second lesson\n\nSecond lesson body.\n",
			);
			await persistFixtureIdentity(projectDir);
			const parse = vi.spyOn(lessonLex, "tokenizeLesson");
			const input = await buildCourseExportInput({
				projectDir,
				viewerVersionPath,
				scope,
				mode,
				completionThreshold: 0.8,
				manifestPolicy,
				inheritWorkspaceSettings: false,
			});
			expect(input.blocks.length).toBeGreaterThan(0);
			expect(parse.mock.calls.map(([source]) => source).sort()).toEqual(
				[
					await readFile(path.join(projectDir, "lesson-1.prax"), "utf8"),
					await readFile(path.join(projectDir, "lesson-2.prax"), "utf8"),
				].sort(),
			);
			parse.mockRestore();
		},
	);
	it.each(["preview", "export"] as const)(
		"refuses a supplied grammar 3 draft before identity or saved-source checks for %s",
		async (mode) => {
			await expect(
				buildExportInputFromProject({
					projectDir,
					viewerVersionPath,
					completionThreshold: 0.8,
					mode,
					lessonFilename: "lesson-1.prax",
					lessonSource: "# Old\n## Question\nas:choice\n(x) Yes\n( ) No\n",
					manifestPolicy: "read-only",
					inheritWorkspaceSettings: false,
				}),
			).rejects.toThrow("converter-v3-to-v4");
			expect((await loadIdentityStore(projectDir)).course).toBeNull();
		},
	);
	let projectDir: string;
	let viewerVersionPath: string;
	it.each(["course", "lesson"] as const)("carries courseHomeUrl into %s input", async (scope) => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Course\ncourseHomeUrl: ../overview/\nlessons: [lesson-1.prax]\n",
		);
		await persistFixtureIdentity(projectDir);
		const input = await buildCourseExportInput({
			projectDir,
			viewerVersionPath,
			scope,
			mode: "export",
			completionThreshold: 0.8,
			manifestPolicy: "read-only",
			inheritWorkspaceSettings: false,
		});
		expect(input.config.courseHomeUrl).toBe("../overview/");
	});

	beforeEach(async () => {
		projectDir = await mkdtemp(path.join(os.tmpdir(), "desktop-export-input-"));
		await mkdir(path.join(projectDir, "assets", "nested"), { recursive: true });

		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Desktop Export\nlocale: en\nlessons:\n  - lesson-1.prax\n",
			"utf-8",
		);
		await writeFile(
			path.join(projectDir, "lesson-1.prax"),
			"---\ntitle: Desktop Export\n---\n\n# Untitled {hideTitle}\n\nHello world\n\n# Untitled {hideTitle}\n\nPage two\n",
			"utf-8",
		);
		await writeFile(path.join(projectDir, "assets", "hero.webp"), Buffer.from([1, 2, 3, 4]));
		await writeFile(path.join(projectDir, "assets", "nested", "clip.mp3"), Buffer.from([9, 8, 7]));

		viewerVersionPath = path.join(projectDir, "viewer.version.json");
		await writeFile(
			viewerVersionPath,
			JSON.stringify({ appVersion: "0.1.0", viewerSourceHash: "abc123def456" }),
			"utf-8",
		);
	});

	it.each(["course", "lesson"] as const)(
		"refuses grammar 3 before identity preparation for %s export",
		async (scope) => {
			await writeFile(
				path.join(projectDir, "lesson-1.prax"),
				"# First\n## Question\nas: choice\n(x) Yes\n( ) No\n",
			);
			await expect(
				buildCourseExportInput({
					projectDir,
					scope,
					mode: "export",
					manifestPolicy: "read-only",
					completionThreshold: 80,
					viewerVersionPath,
				}),
			).rejects.toThrow("convert <course-copy> --from 3 --out <new-output-directory>");
			expect((await loadIdentityStore(projectDir)).course).toBeNull();
		},
	);
	async function buildCourseWithCriticalIssue() {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			["title: Accessible Course", "lessons:", "  - clean.prax", "  - blocked.prax"].join("\n"),
			"utf-8",
		);
		await writeFile(
			path.join(projectDir, "clean.prax"),
			"---\ntitle: Clean lesson\n---\n\n# Untitled {hideTitle}\n\n![Safety equipment](/assets/clean.webp)\n",
			"utf-8",
		);
		await writeFile(
			path.join(projectDir, "blocked.prax"),
			"---\ntitle: Blocked lesson\n---\n\n# Blocked {hideTitle}\n\n![Placeholder](/assets/unnamed.webp)\n",
			"utf-8",
		);

		const input = await buildCourseExportInput({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			scope: "course",
		});
		// This boundary accepts prepared models, including hostile IPC payloads.
		// G4 requires source alt text, so exercise missing alt at that model edge.
		const image = input.blocks.find(
			(block) => block.type === "image" && block.data.src === "/assets/unnamed.webp",
		);
		if (!image) throw new Error("Missing critical-issue image");
		image.data.altText = "";
		return input;
	}

	afterEach(async () => {
		await rm(projectDir, { recursive: true, force: true });
	});

	it.each(["lesson", "course"] as const)(
		"carries authored self-check content outside prompt blocks for %s preview",
		async (scope) => {
			await writeFile(
				path.join(projectDir, "lesson-1.prax"),
				"# Practice\n::: self-check Write an answer.\nmodel: BRIDGE_MODEL\n:: BRIDGE_LABEL\nmissed: BRIDGE_HINT\n:::\n",
			);
			const input = await buildCourseExportInput({
				projectDir,
				viewerVersionPath,
				completionThreshold: 0.8,
				scope,
				mode: "preview",
				manifestPolicy: "read-only",
				inheritWorkspaceSettings: false,
			});
			const block = input.blocks.find((block) => block.type === "selfCheck");
			expect(input.selfCheckContents).toEqual([
				{
					blockId: block?.id,
					contentRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
					content: {
						task: "Write an answer.",
						model: "BRIDGE_MODEL",
						parts: [
							{
								id: expect.any(String),
								label: "BRIDGE_LABEL",
								missed: "BRIDGE_HINT",
								evidence: null,
							},
						],
					},
				},
			]);
			expect(JSON.stringify(input.blocks)).not.toMatch(/BRIDGE_/);
			await persistFixtureIdentity(projectDir);
			const options = {
				projectDir,
				viewerVersionPath,
				completionThreshold: 0.8,
				scope,
				mode: "preview" as const,
				manifestPolicy: "read-only" as const,
				inheritWorkspaceSettings: false,
				preparePdf: true,
				loadAssets: false,
				lessonPreparation: new ProjectLessonPreparation(projectDir),
			};
			const plain = await buildCourseExportInput(options);
			expect(plain.preparedLessons?.[0]).not.toHaveProperty("selfCheckContents");
			const workbook = await buildCourseExportInput({
				...options,
				includeAnswerSheet: true,
			});
			const lesson = workbook.preparedLessons?.[0];
			const check = lesson?.blocks.find((block) => block.type === "selfCheck");
			expect(lesson?.selfCheckContents?.get(check?.id ?? "")).toEqual({
				task: "Write an answer.",
				model: "BRIDGE_MODEL",
				parts: [
					{ id: expect.any(String), label: "BRIDGE_LABEL", missed: "BRIDGE_HINT", evidence: null },
				],
			});
			expect(JSON.stringify(lesson?.blocks)).not.toMatch(/BRIDGE_/);
			expect((await buildCourseExportInput(options)).preparedLessons?.[0]).not.toHaveProperty(
				"selfCheckContents",
			);
		},
	);

	it.each(["lesson", "course"] as const)(
		"refuses invalid authored content while keeping %s preview available",
		async (scope) => {
			await writeFile(
				path.join(projectDir, "lesson-1.prax"),
				"# Practice\n::: self-check Write an answer.\nmodel: BRIDGE_MODEL\n:: BRIDGE_LABEL\nmissed: BRIDGE_HINT\nevidence: NOT_IN_MODEL\n:::\n",
			);
			const input = await buildCourseExportInput({
				projectDir,
				viewerVersionPath,
				completionThreshold: 0.8,
				scope,
				mode: "preview",
				manifestPolicy: "read-only",
				inheritWorkspaceSettings: false,
			});
			const block = input.blocks.find((block) => block.type === "selfCheck");
			expect(input.selfCheckContents).toEqual([]);
			expect([...(input.unresolvedNodes ?? [])]).toEqual([
				[block?.id, { code: "invalid-source", line: 2 }],
			]);
			const context = await createCourseContext(input);
			expect(context.pages[0].assetPaths).toEqual([]);
			expect(JSON.stringify(context)).not.toMatch(/BRIDGE_/);
		},
	);

	it("read-only lesson/course preparation derives stable IDs without migrating source, identities or recovery bytes", async () => {
		await rm(path.join(projectDir, "course.yaml"));
		await persistFixtureIdentity(projectDir);
		const original = await readFile(path.join(projectDir, "lesson-1.prax"), "utf8");
		const stage = path.join(projectDir, ".praxity-write-lesson-1.prax.abandoned");
		await mkdir(stage);
		await writeFile(path.join(stage, "lesson-1.prax"), "RECOVERY BYTES");
		const before = await readdir(projectDir);
		const options = {
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			manifestPolicy: "read-only" as const,
			inheritWorkspaceSettings: false,
		};
		const saved = await buildExportInputFromProject(options);
		const live = await buildExportInputFromProject({
			...options,
			lessonSource: original,
		});
		const course = await buildCourseExportInput({
			...options,
			scope: "course",
		});
		expect(saved.courseId).toMatch(/^[0-9a-f-]{36}$/);
		expect(live.courseId).toBe(saved.courseId);
		expect(course.courseId).toBe(saved.courseId);
		expect(live.blocks).toEqual(saved.blocks);
		expect((await buildCourseExportInput({ ...options, scope: "course" })).blocks).toEqual(
			course.blocks,
		);
		expect(await readdir(projectDir)).toEqual(before);
		expect(await readFile(path.join(projectDir, "lesson-1.prax"), "utf8")).toBe(original);
		expect(await readFile(path.join(stage, "lesson-1.prax"), "utf8")).toBe("RECOVERY BYTES");
	});

	it("derives manual and automatic dark section palettes but leaves uniform rhythm alone", async () => {
		const options = {
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
		};
		await writeLessonSource(
			projectDir,
			"lesson-1.prax",
			"---\ntitle: Sections\ndesign:\n  sectionRhythmMode: manual\n  colorMode: auto\n  sectionDarkBackground: '#111827'\n---\n\n# Untitled {hideTitle}\n\nText\n",
		);
		const manual = await buildExportInputFromProject(options);
		const { sectionPalettes, darkSectionPalettes } = manual.config;
		const course = await buildCourseExportInput({
			...options,
			scope: "course",
		});
		expect(course.config.sectionPalettes).toEqual(sectionPalettes);
		expect(sectionPalettes?.dark.background).toBe("#111827");
		expect(darkSectionPalettes?.dark.background).toBe("#111827");
		expect(darkSectionPalettes?.light.background).not.toBe(sectionPalettes?.light.background);
		for (const palettes of [sectionPalettes, darkSectionPalettes]) {
			for (const palette of Object.values(palettes ?? {})) {
				expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
			}
		}

		await writeLessonSource(
			projectDir,
			"lesson-1.prax",
			"---\ntitle: Sections\ndesign:\n  sectionRhythmMode: uniform\n  colorMode: auto\n---\n\n# Untitled {hideTitle}\n\nText\n",
		);
		const uniform = await buildExportInputFromProject(options);
		expect(uniform.config.sectionPalettes).toBeUndefined();
		expect(uniform.config.darkSectionPalettes).toBeUndefined();
	}, 20_000);

	it("derives palettes for explicit section bands in a uniform course", async () => {
		await writeLessonSource(
			projectDir,
			"lesson-1.prax",
			"---\ntitle: Sections\ndesign:\n  sectionRhythmMode: uniform\n---\n\n# Untitled {hideTitle}\n\nIntro\n\n--- {palette=dark}\n\nDark section\n\n--- {palette=accent}\n\nAccent section\n",
		);
		const options = {
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
		};
		for (const input of [
			await buildExportInputFromProject(options),
			await buildCourseExportInput({ ...options, scope: "course" }),
		]) {
			expect(input.config.sectionPalettes?.dark.background).toBeTruthy();
			expect(input.config.sectionPalettes?.accent.background).toBeTruthy();
			expect(input.config.sectionPalettes?.dark.background).not.toBe(
				input.config.sectionPalettes?.accent.background,
			);
			expect(input.config.sectionPalettes?.light.background).not.toBe(
				input.config.sectionPalettes?.dark.background,
			);
		}
	}, 10_000);

	it("preserves lesson language on every course page without changing the course fallback", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Course\nlocale: en\nlessons: [lesson-1.prax, lesson-2.prax]\n",
		);
		await writeLessonSource(
			projectDir,
			"lesson-1.prax",
			"---\ntitle: Français\nlang: fr\n---\n\n# Bonjour\n\n# Suite {hideTitle}\n\nEncore.\n",
		);
		await writeLessonSource(projectDir, "lesson-2.prax", "---\ntitle: English\n---\n\n# Hello\n");
		const options = { projectDir, completionThreshold: 0.8, viewerVersionPath };
		const lesson = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			...options,
			lessonFilename: "lesson-1.prax",
		});
		expect(lesson.locale).toBe("fr");
		expect(lesson.frontmatter.lang).toBe("fr");
		const course = await buildCourseExportInput({
			manifestPolicy: "write" as const,
			...options,
			scope: "course",
		});
		expect(course.locale).toBe("en");
		expect(course.frontmatter.lang).toBe("en");
		expect(splitBlocksIntoPages(course.blocks, "Course").map((page) => page.locale)).toEqual([
			"fr",
			"fr",
			"en",
		]);
	}, 15_000);

	it("retains ordered PDF lessons and local defaults only when requested", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Workbook\nlocale: en\nlessons: [lesson-2.prax, lesson-1.prax]\n",
		);
		await writeLessonSource(
			projectDir,
			"lesson-2.prax",
			"---\ntitle: Français\nlang: fr\ndesign:\n  componentDefaults:\n    text:\n      size: large\n---\n\n# Bonjour\n",
		);
		const options = {
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			scope: "course" as const,
		};
		const ordinary = await buildCourseExportInput(options);
		expect(ordinary.preparedLessons).toBeUndefined();
		const pdf = await buildCourseExportInput({
			...options,
			preparePdf: true,
			loadAssets: false,
		});
		expect(pdf.preparedLessons?.map((lesson) => [lesson.title, lesson.locale])).toEqual([
			["Français", "fr"],
			["Desktop Export", "en"],
		]);
		expect(pdf.preparedLessons?.[0].componentDefaults).toEqual({ text: { size: "large" } });
		expect(pdf.preparedLessons?.[0].id).toBeTruthy();
		expect(
			pdf.preparedLessons?.[0].blocks.find((block) => block.type === "pageBreak")?.id,
		).toBeTruthy();
		expect(pdf.resolvedAssets).toEqual(
			new Map([
				["assets/hero.webp", new Uint8Array()],
				["assets/nested/clip.mp3", new Uint8Array()],
			]),
		);
	}, 15_000);

	it("scopes parser IDs across lessons after linking existing narration", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Deck\nmoduleDeck: true\nnarrationEnabled: true\nlessons: [lesson-1.prax, lesson-2.prax]\n",
		);
		for (const number of [1, 2]) {
			await writeFile(
				path.join(projectDir, `lesson-${number}.prax`),
				`---
title: Lesson ${number}
---

# Heading

Paragraph [local](#local-anchor).

::: choice Choose {level=3}
(x) Yes
( ) No
:::

::: accordion
:: Details {level=3}
#### Nested heading {name=local-anchor}

Nested body.
:::
`,
			);
		}
		await persistFixtureIdentity(projectDir);
		const identity = await readIdentityFixture(projectDir);
		let sidecar: NarrationSidecarV2 | undefined;
		const expected = new Map<number, Awaited<ReturnType<typeof narrationFixture>>>();
		for (const number of [1, 2]) {
			const fixture = await narrationFixture(projectDir, `lesson-${number}.prax`, sidecar);
			expected.set(number, fixture);
			const paragraph = fixture.items.find((item) => item.segment.blockType === "text");
			const accordion = fixture.items.find((item) => item.segment.blockType === "accordion");
			if (!paragraph || !accordion) throw new Error("Missing fixture narration targets");
			fixture.update(paragraph.segment.target, {
				script: `Spoken ${number}`,
				audio: `assets/lesson-${number}.mp3`,
				reviewedRevision: paragraph.segment.revision,
			});
			sidecar = fixture.update(accordion.segment.target, {
				script: `Details ${number}`,
				audio: `assets/details-${number}.mp3`,
				reviewedRevision: accordion.segment.revision,
			});
		}
		if (!sidecar) throw new Error("Missing narration sidecar");
		await writeFile(path.join(projectDir, "narration.yaml"), serializeNarrationSidecarV2(sidecar));
		const options = { projectDir, completionThreshold: 0.8, viewerVersionPath };
		const course = await buildCourseExportInput({
			manifestPolicy: "write" as const,
			...options,
			scope: "course",
		});
		expect(new Set(course.blocks.map((block) => block.id)).size).toBe(course.blocks.length);
		for (const number of [1, 2]) {
			const fixture = expected.get(number);
			if (!fixture) throw new Error("Missing lesson fixture");
			const lesson = await buildExportInputFromProject({
				manifestPolicy: "write" as const,
				...options,
				lessonFilename: `lesson-${number}.prax`,
			});
			expect(lesson.blocks.find((block) => block.type === "pageBreak")?.id).toBe(
				identity.pageIds[`lesson-${number}.prax`][0],
			);
			expect(lesson.blocks.find((block) => block.type === "assessment")?.id).toBe(
				fixture.read.blocks.find((block) => block.type === "assessment")?.id,
			);
			for (const block of lesson.blocks) expect(course.blocks).toContainEqual(block);
			const accordion = lesson.blocks.find((block) => block.type === "accordion");
			expect(accordion?.id).toBe(
				fixture.read.blocks.find((block) => block.type === "accordion")?.id,
			);
			expect(accordion?.data.items).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						children: expect.arrayContaining([
							expect.objectContaining({
								type: "heading",
								id: expect.stringMatching(/^[0-9a-f-]{36}$/),
								name: "local-anchor",
							}),
						]),
					}),
				]),
			);
			expect(lesson.blocks.find((block) => block.type === "heading")?.id).toBe(
				fixture.read.blocks.find((block) => block.type === "heading")?.id,
			);
			expect(lesson.blocks.find((block) => block.type === "text")?.data.content).toBe(
				'<p>Paragraph <a href="#local-anchor">local</a>.</p>',
			);
			expect(narrationSegments(lesson)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						script: `Spoken ${number}`,
						audioUrl: `assets/lesson-${number}.mp3`,
					}),
					expect.objectContaining({
						script: `Details ${number}`,
						audioUrl: `assets/details-${number}.mp3`,
					}),
				]),
			);
		}
	});
	it("resolves saved deck choices to durable IDs in lesson and course builds", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Deck\nmoduleDeck: true\nlessons: [lesson-1.prax]\n",
		);
		const source =
			"---\ntitle: Deck lesson\n---\n\n# Untitled {deckStop hideTitle}\n\n::: choice Choose {deckGate=attempt level=3}\n(x) Yes\n( ) No\n:::\n\n# Second {deckStop hideTitle}\n\nBody\n";
		await writeLessonSource(projectDir, "lesson-1.prax", source);
		const options = {
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
		};
		const lesson = await buildExportInputFromProject(options);
		const course = await buildCourseExportInput({
			...options,
			scope: "course",
		});
		expect(course.config.moduleDeck).toEqual(lesson.config.moduleDeck);
		expect(Object.values(course.config.moduleDeck?.gates ?? {})).toEqual(["attempt"]);
		expect(course.config.moduleDeck?.stops).toHaveLength(2);
		const reopened = await readLessonSource(projectDir, "lesson-1.prax");
		expect(reopened).toContain("deckGate=attempt");
		expect(reopened).not.toContain(Object.keys(course.config.moduleDeck?.gates ?? {})[0]);
		expect(
			(await buildCourseExportInput({ ...options, scope: "course" })).config.moduleDeck,
		).toEqual(course.config.moduleDeck);
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Deck\nmoduleDeck: false\nlessons: [lesson-1.prax]\n",
		);
		expect(
			(await buildCourseExportInput({ ...options, scope: "course" })).config.moduleDeck,
		).toBeUndefined();
		expect(await readLessonSource(projectDir, "lesson-1.prax")).toBe(reopened);
	}, 10_000);

	it.each(["course", "lesson"] as const)(
		"carries lesson heading text into %s input",
		async (scope) => {
			await writeFile(
				path.join(projectDir, "course.yaml"),
				"title: Course\nlessons: [lesson-1.prax]\n",
			);
			await writeFile(
				path.join(projectDir, "lesson-1.prax"),
				"---\ntitle: Lesson\nkicker: Module 1\ntime: About 12 minutes\n---\n# First\nBody\n",
			);
			const input = await buildCourseExportInput({
				manifestPolicy: "write" as const,
				projectDir,
				viewerVersionPath,
				scope,
				completionThreshold: 0.8,
			});
			expect(input.blocks.find((block) => block.type === "pageBreak")?.data).toMatchObject({
				lessonKicker: "Module 1",
				lessonTime: "About 12 minutes",
				isFirstPageOfLesson: true,
			});
		},
	);

	it.each(["course", "lesson"] as const)(
		"marks an untitled worst-case.prax filename as a fallback in %s input",
		async (scope) => {
			await writeFile(
				path.join(projectDir, "course.yaml"),
				"title: Course\nlessons: [worst-case.prax]\n",
			);
			await writeFile(path.join(projectDir, "worst-case.prax"), "# One\n\nBody\n\n# Two\n\nMore\n");
			const input = await buildCourseExportInput({
				manifestPolicy: "write" as const,
				projectDir,
				viewerVersionPath,
				scope,
				completionThreshold: 0.8,
			});
			expect(input.blocks.find((block) => block.type === "pageBreak")?.data).toMatchObject({
				lessonTitle: "Lesson 1",
				lessonTitleIsFallback: true,
			});
		},
	);

	it.each([
		["en", "Lesson 1", "Lesson 3", "Lesson has no title", "Add title: to the lesson frontmatter."],
		[
			"fr",
			"Leçon 1",
			"Leçon 3",
			"La leçon n'a pas de titre",
			"Ajoutez title: aux métadonnées de la leçon.",
		],
	])(
		"numbers untitled lessons in manifest order and warns in %s",
		async (locale, first, third, message, hint) => {
			await writeFile(
				path.join(projectDir, "course.yaml"),
				`title: Course\nlocale: ${locale}\nlessons: [z-last.prax, titled.prax, a-first.prax]\n`,
			);
			await writeFile(path.join(projectDir, "z-last.prax"), "# One\n\nBody\n\n# Two\n\nMore\n");
			await writeFile(
				path.join(projectDir, "titled.prax"),
				"---\ntitle: Keep this title\n---\n# Three\n\nBody\n",
			);
			await writeFile(path.join(projectDir, "a-first.prax"), "# Four\n\nBody\n");
			const options = { projectDir, viewerVersionPath, completionThreshold: 0.8 };
			const input = await buildCourseExportInput({
				manifestPolicy: "write" as const,
				...options,
				scope: "course",
			});
			expect(splitBlocksIntoPages(input.blocks, "Course").map((page) => page.lessonTitle)).toEqual([
				first,
				first,
				"Keep this title",
				third,
			]);
			expect(input.authorWarnings).toEqual([
				{ code: "lesson-title", severity: "warning", file: "z-last.prax", message, hint },
				{ code: "lesson-title", severity: "warning", file: "a-first.prax", message, hint },
			]);
			const lesson = await buildExportInputFromProject({
				manifestPolicy: "write" as const,
				...options,
				lessonFilename: "a-first.prax",
			});
			expect(splitBlocksIntoPages(lesson.blocks, "Course")[0].lessonTitle).toBe(third);
		},
	);

	it("preserves authored first slide titles across course lesson boundaries", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Deck\nmoduleDeck: true\nlessons: [lesson-1.prax, lesson-2.prax, lesson-3.prax]\n",
		);
		for (const number of [1, 2, 3])
			await writeLessonSource(
				projectDir,
				`lesson-${number}.prax`,
				`---\ntitle: Module ${number}\n---\n\n# ${number < 3 ? `Opening ${number}` : `Module ${number}`} {hideTitle}\n\nBody\n`,
			);

		const course = await buildCourseExportInput({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			scope: "course",
		});
		expect(course.blocks.find((block) => block.type === "pageBreak")?.data.title).toBe("Opening 1");
		expect(
			course.blocks
				.filter((block) => block.type === "pageBreak")
				.slice(1)
				.map((block) => block.data),
		).toMatchObject([
			{ title: "Opening 2", label: "Opening 2", lessonTitle: "Module 2" },
			{ title: "Module 3", label: "Module 3", lessonTitle: "Module 3" },
		]);
	}, 25_000);

	it("retains each module's deck presentation in a full-course build", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Deck\nmoduleDeck: true\nlessons: [lesson-1.prax, lesson-2.prax]\ndesign:\n  navTopBar: true\n  navCourseTitle: false\n  deck:\n    outline: false\n",
		);
		await writeLessonSource(
			projectDir,
			"lesson-1.prax",
			"---\ntitle: First\ndesign:\n  glossaryPage: false\n  deck:\n    preset: compact\n---\n\n# Untitled {hideTitle}\n\nFirst\n",
		);
		await writeLessonSource(
			projectDir,
			"lesson-2.prax",
			"---\ntitle: Second\ndesign:\n  navTopBar: false\n  navCourseTitle: true\n  navLessonTitles: false\n  glossaryPage: true\n  navFloatingToc: true\n  navKeyboardArrows: false\n  deck:\n    preset: transcript\n    autoAdvance: false\n---\n\n# Untitled {hideTitle}\n\nSecond\n",
		);
		const options = { projectDir, completionThreshold: 0.8, viewerVersionPath };
		const course = await buildCourseExportInput({
			manifestPolicy: "write" as const,
			...options,
			scope: "course",
		});
		expect(
			course.blocks.find((block) => block.type === "pageBreak")?.data.deckDesign,
		).toMatchObject({
			initialPanel: "closed",
			outline: false,
		});
		const boundary = course.blocks.filter((block) => block.type === "pageBreak")[1];
		expect(boundary?.data.deckDesign).toMatchObject({
			preset: "transcript",
			initialPanel: "closed",
			outline: false,
			autoAdvance: false,
		});
		expect(
			course.blocks.find((block) => block.type === "pageBreak")?.data.deckNavigation,
		).toMatchObject({
			navTopBar: true,
			navCourseTitle: false,
			navLessonTitles: true,
		});
		expect(course.blocks.find((block) => block.type === "pageBreak")?.data.deckGlossaryPage).toBe(
			false,
		);
		expect(boundary?.data.deckGlossaryPage).toBe(true);
		expect(boundary?.data.deckNavigation).toEqual({
			navTopBar: false,
			navCourseTitle: true,
			navLessonTitles: false,
			navFloatingToc: true,
			navKeyboardArrows: false,
		});
		const lesson = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			...options,
			lessonFilename: "lesson-2.prax",
		});
		expect(lesson.blocks.find((block) => block.type === "pageBreak")?.data.deckDesign).toEqual(
			boundary?.data.deckDesign,
		);
	}, 20_000);

	it("threads completion settings through lesson and course inputs", async () => {
		const options = {
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			requireKnowledgeChecks: true,
			passingScore: 0.8,
			viewerVersionPath,
			lessonFilename: "lesson-1.prax",
		};
		expect((await buildExportInputFromProject(options)).config.requireKnowledgeChecks).toBe(true);
		expect((await buildExportInputFromProject(options)).config.passingScore).toBe(0.8);
		expect(
			(await buildCourseExportInput({ ...options, scope: "course" })).config.requireKnowledgeChecks,
		).toBe(true);
		expect(
			(await buildCourseExportInput({ ...options, scope: "course" })).config.passingScore,
		).toBe(0.8);
		expect(
			(
				await buildCourseExportInput({
					...options,
					passingScore: undefined,
					scope: "course",
				})
			).config,
		).not.toHaveProperty("passingScore");
	});

	it("builds a standard ExportInput with parsed blocks and asset bytes", async () => {
		const result = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			lessonFilename: "lesson-1.prax",
		});

		expect(result.config.completionThreshold).toBe(0.8);
		expect(result.config.requireKnowledgeChecks).toBe(false);
		expect(result.config).not.toHaveProperty("passingScore");
		expect(result.courseId).toMatch(/^[0-9a-f-]{36}$/);
		expect(result).not.toHaveProperty("badge");
		expect(result.locale).toBe("en");
		expect(result.viewerVersion).toBe("abc123def456");
		expect(result.blocks.length).toBeGreaterThan(0);
		expect(result.frontmatter.title).toBe("Desktop Export");
		expect(result.blocks.find((block) => block.type === "pageBreak")?.data.lessonId).toMatch(
			/^[0-9a-f-]{36}$/,
		);
		expect(result.blocks.find((block) => block.type === "pageBreak")?.id).toMatch(
			/^[0-9a-f-]{36}$/,
		);
		expect(result.blocks.find((block) => block.type === "pageBreak")?.id).toMatch(
			/^[0-9a-f-]{36}$/,
		);
		expect(result.resolvedAssets.get("assets/hero.webp")).toBeInstanceOf(Uint8Array);
		expect(result.resolvedAssets.get("assets/nested/clip.mp3")).toBeInstanceOf(Uint8Array);
		const persisted = await readFile(path.join(projectDir, "lesson-1.prax"), "utf-8");
		expect(persisted).not.toMatch(/^id:/m);
		expect((await readIdentityFixture(projectDir)).lessonIds["lesson-1.prax"]).toBe(
			result.blocks.find((block) => block.type === "pageBreak")?.data.lessonId,
		);
		const repeated = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			lessonFilename: "lesson-1.prax",
		});
		expect(repeated.blocks.find((block) => block.type === "pageBreak")?.data.lessonId).toBe(
			result.blocks.find((block) => block.type === "pageBreak")?.data.lessonId,
		);
		expect(repeated.blocks.find((block) => block.type === "pageBreak")?.id).toBe(
			result.blocks.find((block) => block.type === "pageBreak")?.id,
		);
		expect(repeated.blocks.find((block) => block.type === "pageBreak")?.id).toBe(
			result.blocks.find((block) => block.type === "pageBreak")?.id,
		);
	});

	it("keeps block UUIDs outside source across preview, save, export and import", async () => {
		const filename = path.join(projectDir, "lesson-1.prax");
		await writeFile(
			filename,
			"---\ntitle: Identity\n---\n\n# Untitled {hideTitle}\n\n::: choice Pick one {level=3}\n(x) Yes\n( ) No\n:::\n\n::: checklist\n- [ ] Finish\n:::\n",
		);
		const options = {
			manifestPolicy: "write" as const,
			projectDir,
			viewerVersionPath,
			completionThreshold: 0.8,
			lessonFilename: "lesson-1.prax",
		};
		const first = await buildExportInputFromProject(options);
		const ids = first.blocks
			.filter((block) => ["assessment", "checklist"].includes(block.type))
			.map((block) => block.id);
		expect(ids).toHaveLength(2);
		expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
		const clean = await readLessonSource(projectDir, "lesson-1.prax");
		expect(clean).not.toMatch(/^id: block-/m);
		expect(await readFile(filename, "utf-8")).toBe(clean);
		const before = await readIdentityFixture(projectDir);
		const edited = clean.replace("Pick one", "Choose an answer");
		const operations = [await identityEditFixture(projectDir, "lesson-1.prax", edited)];
		const preview = await buildExportInputFromProject({
			...options,
			manifestPolicy: "read-only",
			lessonSource: edited,
			mode: "preview",
			identityOperations: operations,
		});
		expect(
			preview.blocks
				.filter((block) => ["assessment", "checklist"].includes(block.type))
				.map((block) => block.id),
		).toEqual(ids);
		expect((await readIdentityFixture(projectDir)).files).toEqual(before.files);
		await writeLessonSource(projectDir, "lesson-1.prax", edited, clean, { operations });
		const exported = await buildCourseExportInput(options);
		expect(
			exported.blocks
				.filter((block) => ["assessment", "checklist"].includes(block.type))
				.map((block) => block.id),
		).toEqual(ids);
		expect(await readFile(filename, "utf-8")).toBe(edited);
		const importedDir = path.join(projectDir, "imported");
		await mkdir(importedDir);
		await writeFile(
			path.join(importedDir, "course.yaml"),
			"title: Imported\nlessons:\n  - lesson-1.prax\n",
		);
		await writeFile(path.join(importedDir, "lesson-1.prax"), edited);
		const imported = await buildExportInputFromProject({
			...options,
			projectDir: importedDir,
		});
		const importedIds = imported.blocks
			.filter((block) => ["assessment", "checklist"].includes(block.type))
			.map((block) => block.id);
		expect(importedIds).toHaveLength(2);
		expect(importedIds.every((id) => !ids.includes(id))).toBe(true);
	}, 30_000);

	it("builds an unsaved lesson source without writing it to disk", async () => {
		const persisted = await readFile(path.join(projectDir, "lesson-1.prax"), "utf-8");
		const source = "---\ntitle: Unsaved title\n---\n\n# Untitled {hideTitle}\n\nUnsaved body\n";

		const result = await buildCourseExportInput({
			manifestPolicy: "read-only",
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			scope: "lesson",
			lessonFilename: "lesson-1.prax",
			lessonSource: source,
			mode: "preview",
		});

		expect(result.frontmatter.title).toBe("Unsaved title");
		expect(result.blocks.some((block) => block.type === "text")).toBe(true);
		expect(await readFile(path.join(projectDir, "lesson-1.prax"), "utf-8")).toBe(persisted);
	});

	it("rejects duplicate durable IDs copied between lessons", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Duplicate IDs\nlessons:\n  - lesson-1.prax\n  - lesson-2.prax\n",
			"utf-8",
		);
		const source = "# Untitled {hideTitle}\n\nContent\n";
		await writeFile(path.join(projectDir, "lesson-1.prax"), source, "utf-8");
		await writeFile(path.join(projectDir, "lesson-2.prax"), source, "utf-8");

		await persistFixtureIdentity(projectDir);
		const store = await loadIdentityStore(projectDir);
		const identity = await readIdentityFixture(projectDir);
		const second = structuredClone(
			store.snapshots.find((snapshot) => snapshot.lessonId === identity.lessonIds["lesson-2.prax"]),
		);
		if (!second) throw new Error("Missing second lesson snapshot");
		const firstId = identity.pageIds["lesson-1.prax"][0];
		const secondId = identity.pageIds["lesson-2.prax"][0];
		second.nodes[firstId] = { ...second.nodes[secondId], slug: "copied-page", aliases: [] };
		delete second.nodes[secondId];
		for (const node of Object.values(second.nodes))
			if (node.parent === secondId) node.parent = firstId;
		const serialized = serializeIdentity(second);
		const head = createHash("sha256").update(serialized).digest("hex");
		await writeFile(path.join(projectDir, `.praxity/identity/snapshots/${head}.json`), serialized);
		await writeFile(
			path.join(projectDir, `.praxity/identity/lessons/${second.lessonId}.json`),
			serializeIdentity({ schema: 1, path: "lesson-2.prax", head }),
		);
		await expect(
			buildCourseExportInput({
				manifestPolicy: "write" as const,
				projectDir,
				completionThreshold: 0.8,
				viewerVersionPath,
				scope: "course",
			}),
		).rejects.toThrow("duplicate active ID in course namespace");
	});

	it("handles missing assets directory", async () => {
		await rm(path.join(projectDir, "assets"), { recursive: true, force: true });

		const result = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 1,
			viewerVersionPath,
			lessonFilename: "lesson-1.prax",
		});

		expect(result.resolvedAssets.size).toBe(0);
	});

	it("supports html format", async () => {
		const result = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			lessonFilename: "lesson-1.prax",
		});

		expect(result.blocks.length).toBeGreaterThan(0);
	});

	it("builds a full-course export input from course.yaml lesson order", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			[
				"title: Multi-file Course",
				"description: Combined from lessons",
				"locale: fr",
				"theme: corporate",
				"badge: false",
				"design:",
				"  accentHue: 210",
				"pronunciation:",
				"  lexemes:",
				"    - grapheme: WCAG",
				"      alias: W C A G",
				"      lang: en",
				"lessons:",
				"  - lesson-b.prax",
				"  - lesson-a.prax",
			].join("\n"),
			"utf-8",
		);
		await writeFile(
			path.join(projectDir, "lesson-a.prax"),
			"---\ntitle: Lesson A\ndesign:\n  accentHue: 300\n---\n\n# Untitled {hideTitle}\n\nA content\n",
			"utf-8",
		);
		await writeFile(
			path.join(projectDir, "lesson-b.prax"),
			"---\ntitle: Lesson B\nkicker: Module 1\ntime: About 12 minutes\ndesign:\n  navArchetype: slides\n---\n\n# Untitled {hideTitle}\n\nB content\n",
			"utf-8",
		);

		const result = await buildCourseExportInput({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			scope: "course",
		});

		expect(result.frontmatter.title).toBe("Multi-file Course");
		expect(result.frontmatter.lang).toBe("fr");
		expect(result.frontmatter.theme).toBe("corporate");
		expect(result.frontmatter.design).toEqual({ accentHue: 210, navArchetype: "slides" });
		expect(result).not.toHaveProperty("badge");
		expect(result.locale).toBe("fr");
		expect(result.blocks.some((block) => block.type === "pageBreak")).toBe(true);
		expect(result.blocks.find((block) => block.type === "pageBreak")?.data).toMatchObject({
			lessonTitle: "Lesson B",
			lessonKicker: "Module 1",
			lessonTime: "About 12 minutes",
			isFirstPageOfLesson: true,
			lessonId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			id: expect.stringMatching(/^[0-9a-f-]{36}$/),
		});
		expect(result.blocks.filter((block) => block.type === "pageBreak")[1]?.data).toMatchObject({
			lessonTitle: "Lesson A",
			isFirstPageOfLesson: true,
			lessonId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			id: expect.stringMatching(/^[0-9a-f-]{36}$/),
		});
		expect(result.frontmatter.pronunciation?.lexemes).toEqual([
			{ grapheme: "WCAG", alias: "W C A G", lang: "en" },
		]);
	}, 15_000);

	it.each(["lesson", "course"] as const)(
		"previews %s with unlinked narration but rejects export with details",
		async (scope) => {
			await writeFile(
				path.join(projectDir, "course.yaml"),
				"title: Test\nnarrationEnabled: true\nlessons: [lesson-1.prax]\n",
			);
			const fixture = await narrationFixture(projectDir, "lesson-1.prax");
			const sidecar = fixture.update(
				{ id: "11111111-1111-4111-8111-111111111111", role: "body" },
				{ audio: "assets/nested/clip.mp3" },
			);
			await writeFile(
				path.join(projectDir, "narration.yaml"),
				serializeNarrationSidecarV2(sidecar),
			);

			const options = {
				projectDir,
				completionThreshold: 0.8,
				viewerVersionPath,
				lessonFilename: "lesson-1.prax",
				scope,
				manifestPolicy: "read-only" as const,
				inheritWorkspaceSettings: false,
			};
			const preview = await buildCourseExportInput({
				...options,
				mode: "preview",
			});
			expect(preview.warnings).toEqual([
				{ code: "ENARRATIONUNLINKED", file: "lesson-1.prax", count: 1 },
			]);
			expect(preview.blocks.length).toBeGreaterThan(0);
			await expect(buildCourseExportInput(options)).rejects.toMatchObject({
				code: "ENARRATIONUNLINKED",
				details: { file: "lesson-1.prax", count: 1 },
			});
		},
	);

	it("saves edited narration with its old recording and review flag, preserving YAML comments", async () => {
		const source = await readFile(path.join(projectDir, "lesson-1.prax"), "utf8");
		const before = await narrationFixture(projectDir, "lesson-1.prax");
		const item = before.items.find((item) => item.segment.label === "Hello world");
		if (!item) throw new Error("Missing narrated words");
		const sidecar = before.update(item.segment.target, {
			audio: "assets/nested/clip.mp3",
			reviewedRevision: item.segment.revision,
		});

		await writeFile(
			path.join(projectDir, "narration.yaml"),
			`# Author's recording\n${serializeNarrationSidecarV2(sidecar)}`,
		);
		const editedSource = source.replace("Hello world", "Edited words");
		await writeLessonSource(projectDir, "lesson-1.prax", editedSource, source, {
			requireExpectedSource: true,
			operations: [await identityEditFixture(projectDir, "lesson-1.prax", editedSource)],
		});
		const saved = await readFile(path.join(projectDir, "narration.yaml"), "utf8");
		expect(saved).toContain("# Author's recording");
		const edited = await narrationFixture(
			projectDir,
			"lesson-1.prax",
			parseNarrationSidecarV2(saved),
		);
		expect(
			edited.items.filter((entry) => entry.entry).map((entry) => entry.segment.target),
		).toEqual([item.segment.target]);
		expect(
			edited.items.find((entry) => entry.segment.label === "Edited words")?.segment,
		).toMatchObject({ audioUrl: "assets/nested/clip.mp3", status: "needsReview" });
		expect(
			edited.items.find((entry) => entry.segment.label === "Edited words")?.entry?.reviewedRevision,
		).toBe(item.segment.revision);
	});

	it("materializes narration.yaml for offline export", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Desktop Export\nlocale: en\nnarrationEnabled: true\nlessons:\n  - lesson-1.prax\n",
			"utf-8",
		);
		const fixture = await narrationFixture(projectDir, "lesson-1.prax");
		const item = fixture.items.find((candidate) => candidate.segment.label === "Hello world");
		if (!item) throw new Error("Missing Hello world narration target");
		const narration = fixture.update(item.segment.target, {
			script: "Spoken version.",
			audio: "assets/nested/clip.mp3",
			reviewedRevision: item.segment.revision,
		});

		await writeFile(
			path.join(projectDir, "narration.yaml"),
			serializeNarrationSidecarV2(narration),
			"utf-8",
		);

		const result = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			lessonFilename: "lesson-1.prax",
		});

		expect(narrationSegments(result)).toContainEqual(
			expect.objectContaining({
				script: "Spoken version.",
				audioUrl: "assets/nested/clip.mp3",
				target: item.segment.target,
			}),
		);
	});

	it("rejects a full-course export with a critical issue when enforcement is not configured", async () => {
		const input = await buildCourseWithCriticalIssue();

		try {
			assertExportAccessibility(input);
			expect.unreachable("Expected the export accessibility boundary to reject the course");
		} catch (error) {
			expect(error).toBeInstanceOf(ExportAccessibilityError);
			expect((error as ExportAccessibilityError).message).toBe(
				`${ACCESSIBILITY_EXPORT_ERROR_PREFIX}:1`,
			);
			expect((error as ExportAccessibilityError).issues).toEqual([
				expect.objectContaining({
					rule: "image-alt",
					severity: "critical",
				}),
			]);
		}
	}, 15_000);

	it("ignores an accessibility override flag added to the export IPC payload", async () => {
		const input = Object.assign(await buildCourseWithCriticalIssue(), {
			allowA11yViolations: true,
		});

		expect(() => assertExportAccessibility(input)).toThrow(ExportAccessibilityError);
	}, 15_000);

	it("allows the same course through the export boundary after deliberate enforcement disablement", async () => {
		const input = await buildCourseWithCriticalIssue();

		expect(assertExportAccessibility(input, false)).toEqual([
			expect.objectContaining({
				rule: "image-alt",
				severity: "critical",
			}),
		]);
	}, 15_000);

	it("does not block export for advisory or human-judgment source results", async () => {
		const input = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			lessonFilename: "lesson-1.prax",
		});
		input.blocks = [
			{ id: "heading-2", type: "heading", data: { level: 2, content: "Section" } },
			{ id: "heading-4", type: "heading", data: { level: 4, content: "Detail" } },
			{
				id: "long-alt",
				type: "image",
				data: { src: "/chart.png", altText: "A".repeat(201), decorative: false },
			},
		];

		expect(assertExportAccessibility(input)).toEqual([]);
	});

	it("builds a lesson-scoped export input for a specific .prax file", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			[
				"title: Multi-file Course",
				"locale: en",
				"theme: corporate",
				"design:",
				"  accentHue: 210",
				"lessons:",
				"  - lesson-a.prax",
				"  - lesson-b.prax",
			].join("\n"),
			"utf-8",
		);
		await writeFile(
			path.join(projectDir, "lesson-a.prax"),
			"---\ntitle: Lesson A\ndesign:\n  accentHue: 300\n---\n\n# Untitled {hideTitle}\n\nA content\n",
			"utf-8",
		);
		await writeFile(
			path.join(projectDir, "lesson-b.prax"),
			"---\ntitle: Lesson B\n---\n\n# Untitled {hideTitle}\n\nB content\n",
			"utf-8",
		);

		const result = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath,
			lessonFilename: "lesson-a.prax",
		});

		expect(result.frontmatter.title).toBe("Lesson A");
		expect(result.frontmatter.theme).toBe("corporate");
		expect(result.frontmatter.design).toEqual({ accentHue: 300 });
		expect(result.blocks.filter((block) => block.type === "pageBreak")).toHaveLength(1);
	}, 15_000);

	it("throws a clear error when lesson filename is missing from the manifest", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			["title: Multi-file Course", "lessons:", "  - lesson-a.prax"].join("\n"),
			"utf-8",
		);
		await writeFile(
			path.join(projectDir, "lesson-a.prax"),
			"---\ntitle: Lesson A\n---\n\n# Untitled {hideTitle}\n\nA content\n",
			"utf-8",
		);

		await expect(
			buildExportInputFromProject({
				manifestPolicy: "write" as const,
				projectDir,
				completionThreshold: 0.8,
				viewerVersionPath,
				lessonFilename: "missing.prax",
			}),
		).rejects.toThrow("Lesson file not found in course manifest");
	});
});
