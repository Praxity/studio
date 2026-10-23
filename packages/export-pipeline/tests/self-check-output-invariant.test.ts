import { createHash } from "node:crypto";
import {
	link,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readSelfCheckContent } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { narrationRecordingInputs } from "@praxity/shared-blocks/narration";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { beforeAll, expect, it, vi } from "vitest";
import { runPraxityCli } from "../../../apps/desktop/src/main/cli";
import { buildCourseExportInput } from "../../../apps/desktop/src/main/export/build-export-input-from-project";
import { ProjectAssetInventory } from "../../../apps/desktop/src/main/export/project-asset-inventory";
import { resolveLessonSources } from "../../../apps/desktop/src/main/lesson-source";
import {
	openProjectAsset,
	resolveProjectAsset,
} from "../../../apps/desktop/src/main/project-assets";
import { PreviewScheduler } from "../../../apps/desktop/src/main/studio/preview-scheduler";
import {
	type NarrationSidecarV2,
	resolveLessonNarration,
	serializeNarrationSidecarV2,
} from "../../../apps/desktop/src/shared/narration-sidecar";
import { persistFixtureIdentity } from "../../../apps/desktop/src/test-utils/identity-fixture";
import { buildCoursePdfSource } from "../../format-renderers/src/pipelines/course-pdf";
import {
	type CourseExportInput,
	type CoursePreviewDeployment,
	compileCourse,
	compileDocument,
	compilePage,
	createCourseContext,
	deployCourse,
	renderNode,
	selfCheckContentInput,
} from "../src/build";
import type { CourseConfig } from "../src/html-gen";
import { createCourseContextFromHtml, refreshCourseContext } from "../src/preview/course-context";
import { selfCheckRuntimeAssets } from "../src/self-check";
import { compilerIslandAssets } from "./fixtures/page-compiler";
import { assertSelfCheckPackage } from "./fixtures/self-check-package";
import { stagedAnswerOutputInvariant } from "./fixtures/staged-answer-output";

const places = ["TOP", "ACC", "TAB", "SEQ", "COL", "FRONT", "BACK"];
const hidden = ["en", "fr"].flatMap((locale) =>
	places.flatMap((place) =>
		["MODEL", "LABEL", "HINT", "EVIDENCE", "WHOLE_LABEL", "WHOLE_HINT"].map(
			(field) => `SC_${locale}_${place}_${field}_UNIQUE`,
		),
	),
);
const marker = (locale: string, place: string, field: string) =>
	`SC_${locale}_${place}_${field}_UNIQUE`;
const activity = (
	locale: string,
	place: string,
) => `::: self-check ${locale === "fr" ? "Rédigez une réponse" : "Write an answer"} ${place}. <script>TASK_LITERAL</script> & [TASKTERM]{Literal definition.}
model: ${marker(locale, place, "MODEL")} ${marker(locale, place, "EVIDENCE")}
:: ${marker(locale, place, "LABEL")}
missed: ${marker(locale, place, "HINT")}
evidence: ${marker(locale, place, "EVIDENCE")}
:: ${marker(locale, place, "WHOLE_LABEL")}
missed: ${marker(locale, place, "WHOLE_HINT")}
:::
`;
const source = (locale: string) => `---
title: ${locale === "fr" ? "Pratique" : "Practice"}
lang: ${locale}
---
# ${locale === "fr" ? "Pratique" : "Practice"}

Read [PUBLIC_TERM]{Public definition.} and assets/public.txt.

${activity(locale, "TOP")}
${[
	["accordion", "ACC"],
	["tabs", "TAB"],
	["sequence", "SEQ"],
	["columns", "COL"],
]
	.map(([type, place]) => `::: ${type}\n:: Public panel\n${activity(locale, place)}:::\n`)
	.join("\n")}
::: cards
:: Public card
${activity(locale, "FRONT")}::: back
${activity(locale, "BACK")}:::
:::
`;

const { outputs, scan, scanHtml, scanZip, scanRuntimeAsset, unownedArchiveBytes, assertOutput } =
	stagedAnswerOutputInvariant("SC");

// Build the shared course once; retain every emitted byte for the invariant below.
beforeAll(async () => {
	const root = await mkdtemp(join(tmpdir(), "self-check-output-invariant-"));
	const runtime = {
		appVersion: "test",
		exportAssetsDir: resolve(import.meta.dirname, "../../../apps/desktop/resources/export-assets"),
	};
	const previewOptions = {
		projectDir: root,
		mode: "preview" as const,
		completionThreshold: 0,
		viewerVersionPath: join(runtime.exportAssetsDir, "viewer.version.json"),
		inheritWorkspaceSettings: false,
		manifestPolicy: "read-only" as const,
	};
	const digest = (text: string) => createHash("sha256").update(text).digest("hex");
	try {
		await mkdir(join(root, "assets"));
		await writeFile(
			join(root, "course.yaml"),
			"title: Output invariant\nlessons: [en.prax, fr.prax]\nnarrationEnabled: true\n",
		);
		for (const locale of ["en", "fr"])
			await writeFile(join(root, `${locale}.prax`), source(locale));
		await writeFile(join(root, "assets/public.txt"), "PUBLIC_RESOURCE");
		await persistFixtureIdentity(root);
		const identity = await resolveLessonSources(root, {}, { strict: false });
		const sidecar: NarrationSidecarV2 = {
			version: 2,
			courseId: identity.identity.course.courseId,
			lessons: {},
		};
		const pages: CourseExportInput["content"] = [];
		const selfChecks: PraxityBlock[] = [];
		const selfCheckContents: NonNullable<CourseExportInput["selfCheckContents"]>[number][] = [];
		const narration: ReturnType<typeof resolveLessonNarration>[] = [];
		const lessonInputs: Array<Parameters<typeof resolveLessonNarration>[0]> = [];
		for (const locale of ["en", "fr"]) {
			const read = identity.lessons.get(`${locale}.prax`);
			if (!read) throw new Error("Missing invariant lesson");
			expect(read.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
			const collect = (value: unknown) => {
				if (!value || typeof value !== "object") return;
				if ("type" in value && value.type === "selfCheck") {
					selfChecks.push(value as PraxityBlock);
					// Verify the markers really exist behind the author-only boundary.
					const content = readSelfCheckContent(read, (value as PraxityBlock).id);
					selfCheckContents.push(selfCheckContentInput((value as PraxityBlock).id, content));
					expect(content.model).toContain(`SC_${locale}_`);
				}
				for (const child of Object.values(value)) collect(child);
			};
			collect(read.blocks);
			const lessonId = identity.identity.sourceMappings.find(
				(node) => node.file === `${locale}.prax` && node.path.length === 0,
			)?.id;
			if (!lessonId) throw new Error("Missing invariant lesson identity");
			const narrationInput = {
				read,
				courseId: sidecar.courseId,
				lessonId,
				sidecar,
				locale,
				enabled: true,
				digest,
			};
			lessonInputs.push(narrationInput);
			const resolved = resolveLessonNarration(narrationInput);
			narration.push(resolved);
			scan(`${locale}/narration`, JSON.stringify(resolved));
			sidecar.lessons[lessonId] = {
				segments: resolved.items.map(({ segment }) => ({
					target: segment.target,
					script: segment.derivedScript,
					reviewedRevision: segment.revision,
				})),
			};
			pages.push(
				...splitBlocksIntoPages(
					adaptGrammarPreviewBlocks(resolved.blocks, undefined, locale),
					locale,
				).map((page) => ({ ...page, locale, lessonId, lessonTitle: locale })),
			);
		}
		expect(selfChecks).toHaveLength(14);
		scan("narration.yaml", serializeNarrationSidecarV2(sidecar));
		await writeFile(join(root, "narration.yaml"), serializeNarrationSidecarV2(sidecar));
		for (const schema of ["0", "1"]) {
			const inspection = await runPraxityCli(["inspect", root, "--schema", schema], runtime);
			expect(inspection.exitCode, inspection.stderr).toBe(0);
			scan(`inspect/${schema}`, JSON.stringify(inspection));
		}

		const input = {
			selfCheckContents,
			id: sidecar.courseId,
			title: "Output invariant",
			sourceLocale: "en",
			content: pages,
			// An old caller's answer-bearing utility data must be discarded.
			glossaryTerms: [
				{ term: hidden[1], definition: hidden[2], lessonTitle: "Old", lessonSlug: "old" },
			],
		} as CourseExportInput;
		const htmlOutput = { islandAssets: compilerIslandAssets };
		const fresh = await createCourseContext(input);
		const captured = await createCourseContextFromHtml(
			{ ...input, pages, totalPages: pages.length, brandLogo: undefined } as CourseConfig,
			htmlOutput,
		);
		const refreshed = await refreshCourseContext(fresh, { ...input, seq: 1 }, {});
		const deckInput = { ...input, moduleDeck: {} };
		const freshDeck = await createCourseContext(deckInput);
		const capturedDeck = await createCourseContextFromHtml(
			{ ...deckInput, pages, totalPages: pages.length, brandLogo: undefined } as CourseConfig,
			htmlOutput,
		);
		for (const [name, context] of [
			["fresh", fresh],
			["captured", captured],
			["refreshed", refreshed],
			["fresh-deck", freshDeck],
			["captured-deck", capturedDeck],
		] as const) {
			scan(`${name}/projection`, JSON.stringify(context.pages));
			for (const document of context.documents)
				scanHtml(`${name}/${document.slug}`, compileDocument(context, document.slug).html);
			const glossary = compileDocument(context, "glossary").html;
			expect(glossary).toContain("PUBLIC_TERM");
			scanHtml(`${name}/glossary`, glossary);
			for (const page of context.pages) {
				const fragment = compilePage(context, page.id).html;
				scanHtml(`${name}/page-fragment`, fragment);
				const doc = new JSDOM(fragment).window.document;
				const activities = doc.querySelectorAll("[data-self-check]");
				expect(activities).toHaveLength(7);
				const ids = [...doc.querySelectorAll("[data-self-check] [id]")].map((node) => node.id);
				expect(new Set(ids).size).toBe(ids.length);
				for (const activity of activities) {
					expect(activity.querySelectorAll('[role="status"]')).toHaveLength(1);
					expect(activity.querySelector('[role="status"]')?.innerHTML).toBe("");
					expect(activity.querySelector("textarea")).toBeTruthy();
					expect(activity.querySelector(".praxity-assessment-stem")?.textContent).toContain(
						"<script>TASK_LITERAL</script> & [TASKTERM]{Literal definition.}",
					);
					expect(activity.querySelectorAll("script,template,.inline-tooltip-trigger")).toHaveLength(
						0,
					);
				}
				for (const block of page.blocks) {
					scanHtml(
						`${name}/draft-with-siblings`,
						renderNode(context, page.id, block.id, block, page.blocks).html,
					);
				}
			}
		}

		const scheduled = { ...structuredClone(input), seq: 1 };
		scheduled.content = scheduled.content.map((page) => ({
			...page,
			blocks: page.blocks.map((block) =>
				block.type === "selfCheck"
					? {
							...block,
							data: {
								...block.data,
								content: { ...(block.data.content as object), task: "Write another answer." },
							},
						}
					: block,
			),
		}));
		scheduled.selfCheckContents = scheduled.selfCheckContents?.map((entry) => {
			const block = scheduled.content
				.flatMap((page) => page.blocks)
				.find((block) => block.id === entry.blockId);
			return block?.type === "selfCheck"
				? selfCheckContentInput(entry.blockId, {
						...entry.content,
						task: (block.data.content as { task: string }).task,
					})
				: entry;
		});
		vi.useFakeTimers();
		const events: unknown[] = [];
		const scheduler = await PreviewScheduler.create(input, (event) => events.push(event));
		try {
			for (const page of scheduler.context().pages) {
				scheduler.selectPage(page.id);
				await vi.runAllTimersAsync();
			}
			await scheduler.refresh(scheduled, {}, true);
			await vi.runAllTimersAsync();
			expect(events.some((event) => (event as { type: string }).type === "pageCompiled")).toBe(
				true,
			);
			expect(events.some((event) => (event as { type: string }).type === "nodesRendered")).toBe(
				true,
			);
			scan("scheduler/events", JSON.stringify(events));
			scan("scheduler/projection", JSON.stringify(scheduler.context().pages));
			for (const page of scheduler.context().pages) {
				scheduler.selectPage(page.id);
				await vi.runAllTimersAsync();
				const compiled = scheduler.lastGood(page.id);
				expect(compiled).toBeDefined();
				if (!compiled) throw new Error("Missing scheduled page");
				scanHtml("scheduler/page", compiled.html);
			}
		} finally {
			scheduler.close();
			vi.useRealTimers();
		}
		let diagnostic: unknown;
		try {
			await createCourseContext({
				...input,
				unresolvedNodes: new Map([
					[
						selfChecks[0].id,
						{ code: "invalid-source", line: 9, message: `Source says "${hidden[0]}"` },
					],
				]),
			} as never);
		} catch (error) {
			diagnostic = error;
		}
		expect(diagnostic).toMatchObject({
			code: "EUNRESOLVEDNODE",
			message: "Invalid unresolved node diagnostic.",
		});
		scan("quoted-diagnostic/refusal", String(diagnostic));

		// The host uses the same per-activity allowance as the direct compiler below.
		const hostOwned = new Map(
			selfCheckRuntimeAssets(fresh.selfCheckRuntime).map((asset) => [
				asset.path,
				hidden.filter((marker) =>
					JSON.stringify(
						selfCheckContents.find((entry) => entry.blockId === asset.blockId)?.content,
					).includes(marker),
				),
			]),
		);
		for (const format of ["html", "scorm-1.2", "scorm-2004", "pdf"]) {
			const output = join(root, format === "pdf" ? "output.pdf" : `${format}.zip`);
			const result = await runPraxityCli(
				["export", root, "--format", format, "--output", output, "--allow-critical-a11y-issues"],
				runtime,
			);
			if (format === "pdf") {
				expect(result.exitCode, result.stderr).toBe(1);
				expect(JSON.parse(result.stdout).error).toMatchObject({
					code: "export_failed",
					message: expect.stringContaining("Self-check can’t be exported to PDF yet."),
				});
				await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
				scan(`host/${format}/refusal`, JSON.stringify(result));
			} else {
				expect(result.exitCode, result.stderr).toBe(0);
				scan(`host/${format}/result`, JSON.stringify(result));
				scanZip(`host/${format}`, await readFile(output), hostOwned);
				assertSelfCheckPackage(new AdmZip(await readFile(output)), selfCheckContents);
			}
		}
		for (const includeAnswerSheet of [false, true]) {
			let refusal: unknown;
			try {
				buildCoursePdfSource({
					title: input.title,
					locale: "en",
					includeAnswerSheet,
					lessons: narration.map((lesson, index) => ({
						id: `lesson-${index}`,
						title: "Practice",
						locale: index ? "fr" : "en",
						blocks: lesson.blocks,
					})),
				});
			} catch (error) {
				refusal = error;
			}
			expect(refusal).toMatchObject({ reason: "Self-check can’t be exported to PDF yet." });
			scan(`pdf/answer-sheet-${includeAnswerSheet}/refusal`, String(refusal));
		}
		// All downstream builders share this same output invariant.
		for (const [layout, course] of [
			["pages", input],
			["deck", deckInput],
		] as const) {
			const artifact = await compileCourse(course);
			const ownedFiles = new Map<string, readonly string[]>();
			for (const asset of artifact.manifest.pages.flatMap((page) => page.selfCheckAssets ?? [])) {
				const entry = selfCheckContents.find((entry) => entry.blockId === asset.blockId);
				expect(entry).toBeDefined();
				expect(asset.path).toMatch(/^self-check\/[a-f0-9]{64}\.js$/);
				expect(artifact.manifest.files.find((file) => file.path === asset.path)?.sha256).toBe(
					asset.sha256,
				);
				ownedFiles.set(
					asset.path,
					hidden.filter((marker) => JSON.stringify(entry?.content).includes(marker)),
				);
			}
			expect(ownedFiles.size).toBe(14);
			let preview: CoursePreviewDeployment | undefined;
			try {
				for (const format of ["html", "scorm12", "scorm2004", "xapi"] as const)
					scanZip(
						`${layout}/${format}`,
						(
							await deployCourse(artifact, {
								format,
								xapiConfig: {
									endpoint: "https://lrs.example/xapi",
									auth: "Bearer test",
									actorMode: "lms",
								},
							})
						).zip,
						ownedFiles,
					);
				scanZip(
					`${layout}/review-share`,
					(await deployCourse(artifact, { format: "html", reviewMode: true })).zip,
					ownedFiles,
				);
				preview = await deployCourse(artifact, { format: "electron-preview" });
				scan(`${layout}/preview/manifest`, JSON.stringify(preview.manifest));
				for (const file of preview.manifest.files) {
					const stream = await preview.openFile(file.path);
					const chunks: Buffer[] = [];
					for await (const chunk of stream) chunks.push(Buffer.from(chunk));
					const bytes = Buffer.concat(chunks);
					scanRuntimeAsset(`${layout}/preview/${file.path}`, file.path, bytes, ownedFiles);
					if (file.path.endsWith(".html"))
						scanHtml(`${layout}/preview/${file.path}`, bytes.toString());
				}
			} finally {
				await preview?.dispose();
				await artifact.dispose();
			}
		}

		const snapshots = join(root, ".praxity/identity/snapshots");
		const identityFile = (await readdir(snapshots)).find((file) => file.endsWith(".json"));
		if (!identityFile) throw new Error("Missing identity evidence");
		for (const [name, target, code] of [
			["source", join(root, "en.prax"), "asset-source-refused"],
			["identity", join(snapshots, identityFile), "asset-internal-refused"],
		]) {
			const protectedBytes = await readFile(target);
			expect(hidden.some((marker) => protectedBytes.includes(Buffer.from(marker)))).toBe(true);
			for (const kind of ["symlink", "hardlink"]) {
				const alias = join(root, "assets", `${name}-${kind}.txt`);
				if (kind === "symlink") await symlink(target, alias, "file");
				else await link(target, alias);
				try {
					for (const admit of [
						() => resolveProjectAsset(root, alias),
						() => openProjectAsset(root, alias),
						() => new ProjectAssetInventory(root).read(),
						() => buildCourseExportInput(previewOptions),
					]) {
						let refusal: unknown;
						try {
							await admit();
						} catch (error) {
							refusal = error;
						}
						expect(refusal).toMatchObject({ code });
						scan(`${name}/${kind}/refusal`, String(refusal));
					}
				} finally {
					await unlink(alias);
				}
			}
		}

		// The only intentional publication exception is the author's explicit script.
		const first = narration[0].items.find(({ segment }) => segment.blockId === selfChecks[0].id);
		if (!first) throw new Error("Missing explicit-override target");
		const authoredScript = `${marker("en", "TOP", "MODEL")} ${marker("en", "TOP", "EVIDENCE")}`;
		const entry = Object.values(sidecar.lessons)
			.flatMap((lesson) => lesson.segments)
			.find(
				(entry) =>
					entry.target.id === first.segment.target.id &&
					entry.target.role === first.segment.target.role,
			);
		if (!entry) throw new Error("Missing explicit-override sidecar entry");
		entry.script = authoredScript;
		entry.audio = "assets/override.mp3";
		entry.audioFor = narrationRecordingInputs(authoredScript, first.segment.settings, "en");
		await writeFile(join(root, entry.audio), "PUBLIC_NARRATION_AUDIO");
		scan("explicit/audio", await readFile(join(root, entry.audio)));
		const allowed = [marker("en", "TOP", "MODEL"), marker("en", "TOP", "EVIDENCE")];
		await writeFile(join(root, "narration.yaml"), serializeNarrationSidecarV2(sidecar));
		for (const schema of ["0", "1"]) {
			const result = await runPraxityCli(["inspect", root, "--schema", schema], runtime);
			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toContain(authoredScript);
			expect(JSON.parse(result.stdout).warnings).toContainEqual(
				expect.objectContaining({
					code: "ENARRATIONSELFCHECKSPOILER",
					line: 9,
					file: "en.prax",
				}),
			);
			scan(`explicit/inspect-${schema}`, JSON.stringify(result), allowed);
			scan(`explicit/inspect-${schema}/advice`, JSON.stringify(JSON.parse(result.stdout).warnings));
		}

		for (const language of ["en", "fr"]) {
			const result = await runPraxityCli(
				["inspect", root, "--lang", language, "--schema", "1"],
				runtime,
			);
			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stderr).toContain(language === "en" ? "en.prax: Line 9:" : "en.prax: Ligne 9");
			scan(`explicit/inspect-language-${language}`, JSON.stringify(result), allowed);
		}
		const prepared = await buildCourseExportInput(previewOptions);
		expect(prepared.warnings).toContainEqual(
			expect.objectContaining({ code: "ENARRATIONSELFCHECKSPOILER", line: 9, file: "en.prax" }),
		);
		scan("explicit/sidecar", await readFile(join(root, "narration.yaml")), allowed);
		scan("explicit/advice", JSON.stringify(prepared.warnings));
		const explicitContext = await createCourseContext(prepared);
		const explicitHtml = explicitContext.documents
			.map((document) => compileDocument(explicitContext, document.slug).html)
			.join("\n");
		expect(JSON.stringify(prepared)).toContain(authoredScript);
		const { selfCheckContents: _authored, ...promptPrepared } = prepared;
		scan("explicit/prepared-projection", JSON.stringify(promptPrepared), allowed);
		scanHtml("explicit/host-preview", explicitHtml, allowed);
		const explicitPages = lessonInputs.flatMap((lesson) =>
			splitBlocksIntoPages(
				adaptGrammarPreviewBlocks(resolveLessonNarration(lesson).blocks, undefined, lesson.locale),
				lesson.locale,
			).map((page) => ({
				...page,
				locale: lesson.locale,
				lessonId: lesson.lessonId,
				lessonTitle: lesson.locale,
			})),
		);
		const publishedOverride = await createCourseContext({ ...deckInput, content: explicitPages });
		const transcript = publishedOverride.documents
			.map((document) => compileDocument(publishedOverride, document.slug).html)
			.join("\n");
		expect(transcript).toContain(authoredScript);
		scanHtml("explicit/learner-transcript", transcript, allowed);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);

it("allows authored bytes only in declared self-check assets or explicit author duplications", () => {
	expect(outputs.length).toBeGreaterThan(0);
	expect(outputs.some(({ name }) => name.endsWith("/archive"))).toBe(true);
	for (const { name, bytes, allowed } of outputs) assertOutput(name, bytes, allowed);
});

it("raw archive scan excludes only owned payload ranges", () => {
	const zip = new AdmZip();
	const path = "self-check/owned.js";
	zip.addFile(path, Buffer.from(hidden[0]));
	const entry = zip.getEntry(path);
	if (!entry) throw new Error("Missing planted archive entry");
	entry.header.method = 0;
	const owned = new Map([[path, [hidden[0]]]]);
	const bytes = zip.toBuffer();
	expect(bytes.includes(Buffer.from(hidden[0]))).toBe(true);
	expect(() => assertOutput("planted/archive", unownedArchiveBytes(bytes, owned))).not.toThrow();
	zip.addZipComment(hidden[0]);
	expect(() =>
		assertOutput("planted/archive-comment", unownedArchiveBytes(zip.toBuffer(), owned)),
	).toThrow();
	zip.addZipComment("");
	zip.addZipEntryComment(path, hidden[0]);
	expect(() =>
		assertOutput("planted/entry-comment", unownedArchiveBytes(zip.toBuffer(), owned)),
	).toThrow();
	expect(() =>
		assertOutput(
			"planted/trailing",
			unownedArchiveBytes(Buffer.concat([bytes, Buffer.from(hidden[0])]), owned),
		),
	).toThrow();
	expect(() => assertOutput("planted/unlisted", unownedArchiveBytes(bytes, new Map()))).toThrow();
});

it("does not grant an allowance to an unlisted self-check file", () => {
	expect(() =>
		assertOutput("pages/html/self-check/unlisted.js", Buffer.from(hidden[0]), [hidden[0]]),
	).toThrow();
});

it.each([
	"SC_en_TAB_MODEL_UNIQUE".toLowerCase(),
	"sc-en-tab-model-unique",
	"&#83;&#67;_en_TAB_MODEL_UNIQUE",
	String.raw`\u0053\u0043_en_TAB_MODEL_UNIQUE`,
	String.raw`\x53\x43_en_TAB_MODEL_UNIQUE`,
	String.raw`\u{53}\u{43}_en_TAB_MODEL_UNIQUE`,
	String.raw`\\u0053\\u0043_en_TAB_MODEL_UNIQUE`,
	"&amp;#83;C_en_TAB_MODEL_UNIQUE",
])("scan rejects transformed marker %s", (text) => {
	expect(() => assertOutput("planted/config", Buffer.from(text))).toThrow();
});
it("scan catches matchText truncation even in explicit outputs", () => {
	const matchText = `${"Public task ".repeat(7)}SC_en_TAB_MODEL_UNIQUE`;
	const truncated = matchText.slice(0, 100);
	expect(truncated).toContain("SC_en_");
	expect(truncated).not.toContain("SC_en_TAB_MODEL_UNIQUE");
	expect(() => assertOutput("planted/diagnostic", Buffer.from(truncated))).toThrow();
	expect(() =>
		assertOutput("explicit/diagnostic", Buffer.from(truncated), ["SC_en_TAB_MODEL_UNIQUE"]),
	).toThrow();
	expect(() =>
		assertOutput("explicit/script", Buffer.from("SC_en_TAB_MODEL_UNIQUE"), [
			"SC_en_TAB_MODEL_UNIQUE",
		]),
	).not.toThrow();
	expect(() =>
		assertOutput("explicit/script", Buffer.from("sc-en-tab-model-unique"), [
			"SC_en_TAB_MODEL_UNIQUE",
		]),
	).not.toThrow();
});
