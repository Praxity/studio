import { execFileSync } from "node:child_process";
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
import { readLesson, readWriteDistractorsContent } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { extractNarrationSegments } from "@praxity/shared-blocks/narration";
import { preparePageFootnotes } from "@praxity/shared-blocks/page-footnotes";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import AdmZip from "adm-zip";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runPraxityCli } from "../../../apps/desktop/src/main/cli";
import { buildCourseExportInput } from "../../../apps/desktop/src/main/export/build-export-input-from-project";
import {
	inspectProjectV1,
	projectText,
} from "../../../apps/desktop/src/main/export/inspect-project-v1";
import { ProjectAssetInventory } from "../../../apps/desktop/src/main/export/project-asset-inventory";
import { resolveLessonSources } from "../../../apps/desktop/src/main/lesson-source";
import {
	openProjectAsset,
	resolveProjectAsset,
} from "../../../apps/desktop/src/main/project-assets";
import { PreviewScheduler } from "../../../apps/desktop/src/main/studio/preview-scheduler";
import { resolveLessonNarration } from "../../../apps/desktop/src/shared/narration-sidecar";
import {
	persistFixtureIdentity,
	persistLegacyPendingFixture,
	readIdentityFixture,
} from "../../../apps/desktop/src/test-utils/identity-fixture";
import { checkCourseAccessibility } from "../../editor-core/src/lib/a11y/checker";
import {
	buildCoursePdfSource,
	exportCoursePdf,
} from "../../format-renderers/src/pipelines/course-pdf";
import {
	type CourseExportInput,
	compileCourse,
	compileDocument,
	compileDocumentFrame,
	compilePage,
	createCourseContext,
	deployCourse,
	renderNode,
	writeDistractorsContentInput,
} from "../src/build";
import { collectGlossaryTerms } from "../src/glossary-page";
import { generateHtmlPages } from "../src/html-pages";
import { narrationPlaylistFromConfig } from "../src/narration-playlist";
import {
	createCourseContextFromHtml,
	getPageDependencies,
	refreshCourseContext,
} from "../src/preview/course-context";
import { sanitizeBlockForJson } from "../src/published-markup";
import { renderBlockHtml } from "../src/render-block-html";
import {
	writeDistractorsRuntimeAssets,
	writeWriteDistractorsAssets,
} from "../src/write-distractors";
import { normalizePdfOutput, stagedAnswerOutputInvariant } from "./fixtures/staged-answer-output";

import {
	fields,
	hidden,
	locales,
	marker,
	places,
	prompt,
	source,
} from "./fixtures/write-distractors-course";

const capturedOutput = {
	islandAssets: {
		loaderFilename: "loader.js",
		selfCheckLifetime: "lifetime.js",
		writeDistractorsCss: "write-distractors.css",
		islandFilenames: Object.fromEntries(
			["deck", "nav", "accordion", "tabs", "card", "tooltip", "writeDistractors"].map((name) => [
				name,
				`${name}.js`,
			]),
		),
	},
};
const invariant = stagedAnswerOutputInvariant("WD");
const { scan, scanRuntimeAsset, assertOutput } = invariant;
// Preserve Map/Set keys, values and non-enumerable Error text when scanning actual results.
const serialize = (value: unknown) =>
	JSON.stringify(value, (_key, item) => {
		if (item instanceof Map) return [...item];
		if (item instanceof Set) return [...item];
		if (item instanceof Error)
			return { ...item, name: item.name, message: item.message, stack: item.stack };
		return item;
	});
function publicOutput(name: string, value: unknown, controls: readonly string[] = []) {
	const bytes = serialize(value);
	for (const control of controls) expect(bytes, `${name} lacks ${control}`).toContain(control);
	assertOutput(name, Buffer.from(bytes));
	scan(name, bytes);
}
async function refusal(name: string, action: () => unknown, expected: object) {
	let caught: unknown;
	try {
		await action();
	} catch (error) {
		caught = error;
	}
	expect(caught, name).toMatchObject(expected);
	publicOutput(`${name}/refusal`, caught);
}
function activities(value: unknown): PraxityBlock[] {
	if (!value || typeof value !== "object") return [];
	if ("type" in value && value.type === "writeDistractors") return [value as PraxityBlock];
	return Object.values(value).flatMap(activities);
}
// Cards share one root. Remove sibling activities so a front refusal cannot
// accidentally stand in for proof that the back also refuses publication.
function placement(blocks: PraxityBlock[], control: string) {
	const selected = activities(blocks).find((block) => serialize(block).includes(control));
	const parent = blocks.find((block) =>
		activities(block).some((activity) => activity.id === selected?.id),
	);
	if (!selected || !parent) throw new Error("Missing placed activity");
	const prune = (value: unknown): unknown => {
		if (!value || typeof value !== "object") return value;
		if ("type" in value && value.type === "writeDistractors")
			return "id" in value && value.id === selected.id ? value : undefined;
		if (Array.isArray(value)) return value.map(prune).filter((child) => child !== undefined);
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, prune(child)]));
	};
	const isolated = prune(structuredClone(parent)) as PraxityBlock;
	expect(activities(isolated).map((block) => block.id)).toEqual([selected.id]);
	return { parent: isolated, selected };
}

let root: string;
let input: CourseExportInput;
let lessons: Awaited<ReturnType<typeof resolveLessonSources>>;
const runtime = {
	appVersion: "test",
	exportAssetsDir: resolve(import.meta.dirname, "../../../apps/desktop/resources/export-assets"),
};
const previewOptions = () => ({
	projectDir: root,
	mode: "preview" as const,
	completionThreshold: 0,
	viewerVersionPath: join(runtime.exportAssetsDir, "viewer.version.json"),
	inheritWorkspaceSettings: false,
	manifestPolicy: "read-only" as const,
});
beforeAll(async () => {
	root = await mkdtemp(
		join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "distractor-invariant-"),
	);
	await mkdir(join(root, "assets"));
	await writeFile(join(root, "assets/public.txt"), "PUBLIC_RESOURCE");
	await writeFile(
		join(root, "course.yaml"),
		"title: Output invariant\nlessons: [en.prax, fr.prax]\nnarrationEnabled: true\n",
	);
	for (const locale of locales) await writeFile(join(root, `${locale}.prax`), source(locale));
	await persistFixtureIdentity(root);
	lessons = await resolveLessonSources(root, {}, { strict: false });
	const content: CourseExportInput["content"] = [];
	const writeDistractorsContents: NonNullable<
		CourseExportInput["writeDistractorsContents"]
	>[number][] = [];
	for (const locale of locales) {
		const read = lessons.lessons.get(`${locale}.prax`);
		if (!read) throw new Error("Missing invariant lesson");
		expect(read.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(read.diagnostics.filter((d) => d.code === "unsupported-runtime")).toHaveLength(0);
		for (const block of activities(read.blocks)) {
			const full = readWriteDistractorsContent(read, block.id);
			const owned = hidden.filter((value) => serialize(full).includes(value));
			expect(owned).toHaveLength(fields.length);
			writeDistractorsContents.push(writeDistractorsContentInput(block.id, full));
		}
		content.push(
			...splitBlocksIntoPages(
				adaptGrammarPreviewBlocks(read.blocks, undefined, locale),
				locale,
			).map((page) => ({ ...page, locale, lessonId: locale, lessonTitle: locale })),
		);
	}
	input = {
		id: lessons.identity.course.courseId,
		title: "Output invariant",
		sourceLocale: "en",
		content,
		writeDistractorsContents,
	};
	expect(writeDistractorsContents).toHaveLength(14);
});
afterAll(async () => {
	if (root) await rm(root, { recursive: true });
});

it.each(locales)(
	"reader, utility and narration outputs retain every prompt but no hidden bytes in %s",
	(locale) => {
		const read = lessons.lessons.get(`${locale}.prax`);
		if (!read) throw new Error("Missing invariant lesson");
		const controls = places.map((place) => prompt(locale, place));
		expect(read.diagnostics).toContainEqual(
			expect.objectContaining({ code: "write-distractors-author-right", severity: "warning" }),
		);
		publicOutput(
			`${locale}/reader`,
			{
				blocks: read.blocks,
				pages: read.pages,
				errors: read.errors,
				diagnostics: read.diagnostics,
			},
			controls,
		);
		publicOutput(`${locale}/json`, read.blocks.map(sanitizeBlockForJson), controls);
		const advice = checkCourseAccessibility(
			read.pages,
			undefined,
			new Map(read.pages.map((page) => [page.id, { read }])),
		);
		publicOutput(`${locale}/check-advice`, advice, [
			"write-distractors-author-right",
			"This wrong option matches the right answer. Review it.",
		]);
		expect(advice.issues.length).toBeGreaterThan(0);
		expect(advice.issues).toContainEqual(
			expect.objectContaining({ rule: "write-distractors-author-right" }),
		);
		publicOutput(
			`${locale}/inspect-text`,
			activities(read.blocks).map((block) => projectText(block, block.id, null)),
			controls,
		);
		publicOutput(
			`${locale}/footnotes`,
			preparePageFootnotes(read.blocks, locale, { footnote: "Footnote", footnotes: "Footnotes" }),
			controls,
		);
		publicOutput(`${locale}/glossary`, collectGlossaryTerms(read.pages), [
			"PUBLIC_TERM",
			"Public definition.",
		]);
		const lessonId = lessons.identity.sourceMappings.find(
			(mapping) => mapping.file === `${locale}.prax` && mapping.path.length === 0,
		)?.id;
		if (!lessonId) throw new Error("Missing narration lesson identity");
		const narration = resolveLessonNarration({
			read,
			lessonId,
			locale,
			courseId: input.id,
			enabled: true,
			sidecar: { version: 2, courseId: input.id, lessons: {} },
			digest: (text) => createHash("sha256").update(text).digest("hex"),
		});
		publicOutput(`${locale}/narration`, narration, controls);
		const changed = readLesson(source(locale).replaceAll("_UNIQUE", "_EDITED"), {
			ids: (node, role) => {
				const original = [...read.nodes.values()].find(
					(record) =>
						record.node.span.start === node.span.start &&
						record.node.kind === node.kind &&
						record.role === role,
				);
				if (!original) throw new Error("Missing unchanged narration identity");
				return original.id;
			},
		});
		for (const block of activities(changed.blocks))
			expect(readWriteDistractorsContent(changed, block.id).rightAnswer).toContain("_EDITED");
		// A hidden-only edit must leave both narration text and recording fingerprints identical.
		for (const block of activities(read.blocks)) {
			const segments = extractNarrationSegments("Practice", {}, [block], {}, locale);
			const title = segments.find((segment) => segment.blockId === block.id);
			expect(title?.derivedScript).toBe((block.data.content as { question: string }).question);
			publicOutput(`${locale}/narration-segment`, segments, [
				(block.data.content as { question: string }).question,
			]);
			publicOutput(
				`${locale}/playlist`,
				narrationPlaylistFromConfig({
					grammarVersion: 4,
					narrationEnabled: true,
					narrationSegments: segments.map((segment) => ({
						...segment,
						audioUrl: `voice/${segment.id}.mp3`,
					})),
				}),
				["voice/"],
			);
		}
		const revised = resolveLessonNarration({
			read: changed,
			lessonId,
			locale,
			courseId: input.id,
			enabled: true,
			sidecar: { version: 2, courseId: input.id, lessons: {} },
			digest: (text) => createHash("sha256").update(text).digest("hex"),
		});
		expect(revised.items).toEqual(narration.items);
	},
);

it.each(["pages", "deck"])(
	"fresh, captured and refreshed %s contexts expose prompts and own assets only",
	async (layout) => {
		const course = { ...input, ...(layout === "deck" ? { moduleDeck: {} } : {}) };
		const fresh = await createCourseContext(course);
		const captured = await createCourseContextFromHtml(
			{ ...course, pages: course.content, totalPages: course.content.length, brandLogo: undefined },
			capturedOutput,
		);
		const refreshed = await refreshCourseContext(fresh, { ...course, seq: 1 }, {});
		const controls = locales.flatMap((locale) => places.map((place) => prompt(locale, place)));
		for (const [name, context] of [
			["fresh", fresh],
			["captured", captured],
			["refreshed", refreshed],
		] as const) {
			publicOutput(`${layout}/${name}/context`, context, controls);
			for (const page of context.pages)
				for (const consumer of [
					"fragments",
					"shell",
					"page-frame",
					"deck-outline",
					"glossary-document",
					"reading-script",
					"working-directory",
				] as const)
					publicOutput(
						`${layout}/${name}/${consumer}`,
						getPageDependencies(context, page.id, consumer),
					);
			const assets = writeDistractorsRuntimeAssets(context.writeDistractorsRuntime);
			expect(assets).toHaveLength(14);
			const ownedFiles = new Map(
				assets.map((asset) => {
					const entry = input.writeDistractorsContents?.find(
						(entry) => entry.blockId === asset.blockId,
					);
					expect(entry).toBeDefined();
					return [
						asset.path,
						hidden.filter((value) => serialize(entry?.content).includes(value)),
					] as const;
				}),
			);
			const dir = join(root, `${layout}-${name}`);
			const manifest = await writeWriteDistractorsAssets(context.writeDistractorsRuntime, dir);
			publicOutput(`${layout}/${name}/manifest`, manifest);
			for (const asset of assets) {
				expect(asset.path).toMatch(/^write-distractors\/[a-f0-9]{64}\.js$/);
				const bytes = await readFile(join(dir, asset.path));
				expect(bytes).toEqual(asset.bytes);
				expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
				const payload = JSON.parse(
					bytes.toString().slice("globalThis.__praxityWriteDistractorsAsset?.(".length, -3),
				);
				expect(payload).toEqual(
					input.writeDistractorsContents?.find((entry) => entry.blockId === asset.blockId),
				);
				const allowed = ownedFiles.get(asset.path);
				expect(allowed).toHaveLength(fields.length);
				for (const value of allowed ?? []) expect(serialize(payload)).toContain(value);
				scanRuntimeAsset(`${layout}/${name}/${asset.path}`, asset.path, bytes, ownedFiles);
				assertOutput(`${layout}/${name}/${asset.path}`, bytes, allowed);
			}
		}
	},
);

it.each(locales.flatMap((locale) => places.map((place) => ({ locale, place }))))(
	"compiler, draft and direct renderer publish only prompts for $locale/$place",
	async ({ locale, place }) => {
		const page = input.content.find((page) => page.locale === locale);
		if (!page) throw new Error("Missing page");
		const { parent } = placement(page.blocks, prompt(locale, place));
		const course = {
			...input,
			content: [{ ...page, blocks: [parent] }],
			writeDistractorsContents: input.writeDistractorsContents?.filter((entry) =>
				activities(parent).some((block) => block.id === entry.blockId),
			),
		};
		const fresh = await createCourseContext(course);
		const captured = await createCourseContextFromHtml(
			{ ...course, pages: course.content, totalPages: 1, brandLogo: undefined },
			capturedOutput,
		);
		const refreshed = await refreshCourseContext(fresh, { ...course, seq: 1 }, {});
		for (const context of [fresh, captured, refreshed]) {
			publicOutput(`${locale}/${place}/page`, compilePage(context, page.id), [
				prompt(locale, place),
			]);
			for (const document of context.documents) {
				publicOutput(`${locale}/${place}/document`, compileDocument(context, document.slug), [
					prompt(locale, place),
				]);
				publicOutput(`${locale}/${place}/frame`, compileDocumentFrame(context, document.slug));
			}
			publicOutput(`${locale}/${place}/direct`, renderBlockHtml(parent), [prompt(locale, place)]);
			publicOutput(
				`${locale}/${place}/draft`,
				renderNode(context, page.id, parent.id, parent, [parent]),
				[prompt(locale, place)],
			);
		}
	},
);

it.each([
	"rightAnswer",
	"authorOptions",
	"misconceptions",
	"source",
	"learnerInput",
	"assetBytes",
	"contentRevision",
	"diagnostic",
])("generic %s fields cannot carry hidden bytes through compiler entries", async (field) => {
	const context = await createCourseContext(input);
	for (const block of activities(input.content)) {
		const forged = structuredClone(block);
		forged.data[field] = `${hidden[0]} WD_en_TOP_LEARNER_UNIQUE`;
		const course = {
			...input,
			content: [{ id: "forged-page", title: "Practice", blocks: [forged] }],
		};
		const expected = {
			code: "EWRITEDISTRACTORSPROMPT",
			message: "Invalid write-distractors prompt data.",
		};
		await refusal(`${field}/json`, () => sanitizeBlockForJson(forged), expected);
		await refusal(`${field}/fresh`, () => createCourseContext(course), expected);
		await refusal(
			`${field}/captured`,
			() =>
				createCourseContextFromHtml(
					{ ...course, pages: course.content, totalPages: 1, brandLogo: undefined },
					capturedOutput,
				),
			expected,
		);
		const page = context.pages.find((page) =>
			activities(page.blocks).some((item) => item.id === block.id),
		);
		if (!page) throw new Error("Missing forged draft page");
		await refusal(`${field}/draft`, () => renderNode(context, page.id, block.id, forged), expected);
	}
});

it.each(["pages", "deck"])(
	"preview scheduler publishes prompt-only %s documents",
	async (layout) => {
		const course = { ...input, ...(layout === "deck" ? { moduleDeck: {} } : {}) };
		const events: unknown[] = [];
		vi.useFakeTimers();
		const scheduler = await PreviewScheduler.create(course, (event) => events.push(event));
		try {
			for (const page of scheduler.context().pages) {
				scheduler.selectPage(page.id);
				await vi.runAllTimersAsync();
				expect(scheduler.lastGood(page.id)).toBeDefined();
			}
			expect(events.some((event) => (event as { type: string }).type === "compileFailed")).toBe(
				false,
			);
			publicOutput(`${layout}/preview-events`, events);
		} finally {
			scheduler.close();
			vi.useRealTimers();
		}
	},
);

it.each(["0", "1"])(
	"inspect schema %s emits only prompts and content-free diagnostics",
	async (schema) => {
		const result = await runPraxityCli(["inspect", root, "--schema", schema], runtime);
		expect(result.exitCode, result.stderr).toBe(0);
		publicOutput(
			`inspect/${schema}`,
			result,
			locales.flatMap((locale) => places.map((place) => prompt(locale, place))),
		);
		if (schema === "1") {
			const inspection = await inspectProjectV1(root, "test");
			publicOutput(
				"inspect/typed-schema-1",
				inspection,
				locales.flatMap((locale) => places.map((place) => prompt(locale, place))),
			);
		}
	},
);

it("quoted unresolved-node diagnostics refuse without publishing hidden author text", async () => {
	const block = activities(input.content)[0];
	if (!block) throw new Error("Missing diagnostic activity");
	await refusal(
		"quoted-diagnostic",
		() =>
			createCourseContext({
				...input,
				unresolvedNodes: new Map([
					[
						block.id,
						{
							code: "invalid-source",
							line: 9,
							message: `Source says "${marker("en", "TOP", "OPTION_A")}"`,
						},
					],
				]),
			}),
		{ code: "EUNRESOLVEDNODE", message: "Invalid unresolved node diagnostic." },
	);
});

// Compile each real package and both native PDFs once, outside per-test timing.
const published: Array<{
	name: string;
	bytes: Buffer;
	owned: ReadonlyMap<string, readonly string[]>;
}> = [];
const pdfs: Array<{
	name: string;
	source: string;
	bytes: Buffer;
	text: string;
	allowed: string[];
}> = [];
beforeAll(async () => {
	const owned = new Map(
		writeDistractorsRuntimeAssets((await createCourseContext(input)).writeDistractorsRuntime).map(
			(asset) => [
				asset.path,
				hidden.filter((value) =>
					serialize(
						input.writeDistractorsContents?.find((entry) => entry.blockId === asset.blockId)
							?.content,
					).includes(value),
				),
			],
		),
	);
	for (const layout of ["pages", "deck"]) {
		const artifact = await compileCourse(
			{ ...input, ...(layout === "deck" ? { moduleDeck: {} } : {}) },
			{ temporaryRoot: root },
		);
		try {
			for (const format of ["html", "scorm12", "scorm2004", "xapi"] as const) {
				const result = await deployCourse(artifact, {
					format,
					xapiConfig: {
						endpoint: "https://lrs.example/xapi",
						auth: "Bearer test",
						actorMode: "lms",
					},
				});
				published.push({ name: `${layout}/${format}`, bytes: result.zip, owned });
			}
			const preview = await deployCourse(artifact, { format: "electron-preview" });
			try {
				for (const file of preview.manifest.files) {
					const stream = await preview.openFile(file.path);
					const chunks: Buffer[] = [];
					for await (const chunk of stream) chunks.push(Buffer.from(chunk));
					scanRuntimeAsset(
						`${layout}/preview/${file.path}`,
						file.path,
						Buffer.concat(chunks),
						owned,
					);
				}
			} finally {
				await preview.dispose();
			}
		} finally {
			await artifact.dispose();
		}
	}
	// The web fixture also exercises an emoji unsupported by bundled PDF fonts.
	// Native publication uses the same marked fields with supported font characters.
	const lessonInputs = locales.map((locale) => {
		const read = readLesson(source(locale).replaceAll(" 😀", ""), {
			ids: (node, role) => `pdf-${locale}-${node.span.start}-${role ?? node.kind}`,
		});
		return {
			id: locale,
			title: locale,
			locale,
			blocks: read.blocks,
			writeDistractorsContents: new Map(
				activities(read.blocks).map((block) => [
					block.id,
					readWriteDistractorsContent(read, block.id),
				]),
			),
		};
	});
	for (const answers of [false, true]) {
		const options = {
			title: input.title,
			locale: "fr",
			lessons: lessonInputs,
			includeAnswerSheet: answers,
		};
		const rendered = buildCoursePdfSource(options);
		const native = await exportCoursePdf({
			...options,
			executablePath:
				process.env.PRAXITY_TEST_TYPST ??
				resolve(import.meta.dirname, "../../../apps/desktop/resources/typst/typst"),
			temporaryRoot: root,
		});
		const file = join(root, `invariant-${answers}.pdf`);
		await writeFile(file, native.pdf);
		const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
		pdfs.push({
			name: answers ? "explicit/answer-sheet" : "workbook",
			source: rendered.typstSource,
			bytes: native.pdf,
			text,
			allowed: answers ? hidden : [],
		});
	}
});
it.each(
	["pages", "deck"].flatMap((layout) =>
		["html", "scorm12", "scorm2004", "xapi"].map((format) => `${layout}/${format}`),
	),
)("scans real published bytes %s including classic standalone launch", (name) => {
	const output = published.find((output) => output.name === name);
	if (!output) throw new Error("Missing package");
	invariant.scanZip(name, output.bytes, output.owned);
	const zip = new AdmZip(output.bytes);
	expect(
		zip
			.getEntries()
			.filter((entry) => !entry.isDirectory && entry.entryName.startsWith("write-distractors/")),
	).toHaveLength(14);
	const pages = zip
		.getEntries()
		.filter((entry) => entry.entryName.endsWith(".html"))
		.map((entry) => entry.getData().toString())
		.join("\n");
	for (const locale of locales)
		for (const place of places) expect(pages).toContain(prompt(locale, place));
	expect(pages).toContain("data-distractor-src=");
	expect(pages).toContain(
		`"format":"${name.endsWith("/html") ? "standalone" : name.split("/")[1]}"`,
	);
});
it.each([false, true])(
	"scans real native PDF answers=%s and extracted text with positive controls",
	(answers) => {
		const output = pdfs[answers ? 1 : 0];
		expect(output.bytes.subarray(0, 5).toString()).toBe("%PDF-");
		const normalized = normalizePdfOutput(output.bytes);
		expect(normalized).toContain("Output invariant");
		if (answers) {
			expect(output.bytes.toString("latin1")).not.toContain("Corrigé");
			expect(normalized).toContain("Corrigé");
		}
		for (const locale of locales)
			for (const place of places) expect(output.text).toContain(prompt(locale, place));
		if (answers) for (const value of hidden) expect(output.text).toContain(value);
		for (const [kind, bytes] of [
			...(!answers ? [["source", Buffer.from(output.source)] as const] : []),
			["pdf", output.bytes],
			["text", Buffer.from(output.text)],
		] as const) {
			scan(`${output.name}/${kind}`, bytes, output.allowed);
			assertOutput(`${output.name}/${kind}`, bytes, output.allowed);
		}
	},
);

it.each(["source", "identity"])(
	"%s hardlink and symlink aliases cannot re-enter public assets",
	async (name) => {
		// Unsupported lessons stay opaque to writes; model a previously saved store for alias checks.
		await persistLegacyPendingFixture(root);
		const identityBefore = await readIdentityFixture(root);
		const snapshots = join(root, ".praxity/identity/snapshots");
		const identityFile = (await readdir(snapshots)).find((file) => file.endsWith(".json"));
		if (!identityFile) throw new Error("Missing identity snapshot");
		const target = name === "source" ? join(root, "en.prax") : join(snapshots, identityFile);
		const bytes = await readFile(target);
		expect(hidden.some((value) => bytes.includes(Buffer.from(value)))).toBe(true);
		for (const kind of ["symlink", "hardlink"]) {
			const alias = join(root, "assets", `${name}-${kind}.txt`);
			if (kind === "symlink") await symlink(target, alias, "file");
			else await link(target, alias);
			try {
				for (const admit of [
					() => resolveProjectAsset(root, alias),
					() => openProjectAsset(root, alias),
					() => new ProjectAssetInventory(root).read(),
				])
					await refusal(`${name}/${kind}`, admit, {
						code: name === "source" ? "asset-source-refused" : "asset-internal-refused",
					});
				// The host must retain the same asset boundary after publication lifts.
				await refusal(`${name}/${kind}/host`, () => buildCourseExportInput(previewOptions()), {
					code: name === "source" ? "asset-source-refused" : "asset-internal-refused",
				});
			} finally {
				await unlink(alias);
			}
			expect(await readIdentityFixture(root)).toEqual(identityBefore);
		}
	},
);

it.each(["en", "fr", "pages", "deck", "inspect", "explicit", "workbook"])(
	"shared scan checks every recorded %s output",
	(prefix) => {
		const outputs = invariant.outputs.filter((output) => output.name.startsWith(`${prefix}/`));
		expect(outputs.length).toBeGreaterThan(0);
		for (const output of outputs) assertOutput(output.name, output.bytes, output.allowed);
	},
);
it("shared scan rejects borrowed activity allowances", () => {
	const asset = invariant.outputs.find((output) =>
		output.allowed.includes(marker("en", "TOP", "RIGHT")),
	);
	if (!asset) throw new Error("Missing positive asset output");
	expect(() =>
		assertOutput(asset.name, Buffer.from(marker("fr", "BACK", "RIGHT")), asset.allowed),
	).toThrow();
	expect(() =>
		assertOutput("unlisted/write-distractors/asset.js", asset.bytes, asset.allowed),
	).toThrow();
});

it.each([
	"WD_en_TAB_RIGHT_UNIQUE",
	"wd-en-tab-right-unique",
	"&#87;&#68;_en_TAB_RIGHT_UNIQUE",
	String.raw`\u0057\u0044_en_TAB_RIGHT_UNIQUE`,
	String.raw`\x57\x44_en_TAB_RIGHT_UNIQUE`,
	String.raw`\\u0057\\u0044_en_TAB_RIGHT_UNIQUE`,
	"&amp;#87;D_en_TAB_RIGHT_UNIQUE",
	"%57%44%5Fen%5FTAB%5FRIGHT%5FUNIQUE",
	...["", "x", "xy", '{"value":"'].map((prefix) =>
		Buffer.from(`${prefix}WD_en_TAB_RIGHT_UNIQUE`).toString("base64"),
	),
])("shared scan rejects literal or encoded planted bytes %s", (bytes) => {
	expect(() => assertOutput("planted/output", Buffer.from(bytes))).toThrow();
});
