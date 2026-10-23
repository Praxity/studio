// Trusted adapter; all production imports resolve inside the selected checkout.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { literal } from "./nonvisual-compare.mjs";
import { assertLoadedSources } from "./nonvisual-isolation.mjs";
import { hash } from "./provenance.mjs";

const [mode, checkout, output, projectDir, assets, typst] = process.argv.slice(2);
const source = createRequire(path.join(checkout, "package.json"));
function owner(load, file, entry) {
	let module;
	try {
		module = load();
	} catch (error) {
		throw new Error(`Required owner ${file}::${entry}: ${error.message}`, { cause: error });
	}
	if (typeof module[entry] !== "function")
		throw new Error(`Missing required entry point ${file}::${entry}`);
	return module[entry];
}
await mkdir(output, { recursive: true });
const save = async (name, value) =>
	writeFile(path.join(output, `${name}.json`), JSON.stringify(literal(value), null, 2));
const inputOptions = {
	projectDir,
	scope: "course",
	manifestPolicy: "read-only",
	inheritWorkspaceSettings: false,
	viewerVersionPath: path.join(assets, "viewer.version.json"),
};
const buildInput = owner(
	() => source("./apps/desktop/src/main/export/build-export-input-from-project.ts"),
	"apps/desktop/src/main/export/build-export-input-from-project.ts",
	"buildCourseExportInput",
);
if (mode === "stages") {
	const createContext = owner(
		() => source("./packages/export-pipeline/src/preview/course-context.ts"),
		"packages/export-pipeline/src/preview/course-context.ts",
		"createCourseContext",
	);
	const prepare = owner(
		() => source("./packages/export-pipeline/src/preview/compile-page.ts"),
		"packages/export-pipeline/src/preview/compile-page.ts",
		"preparePageCompiler",
	);
	const compile = owner(
		() => source("./packages/export-pipeline/src/preview/compile-page.ts"),
		"packages/export-pipeline/src/preview/compile-page.ts",
		"compilePage",
	);
	const nav = owner(
		() => source("./packages/export-pipeline/src/runtime-plan.ts"),
		"packages/export-pipeline/src/runtime-plan.ts",
		"resolvePageNavigation",
	);
	const pagePlan = owner(
		() => source("./packages/export-pipeline/src/runtime-plan.ts"),
		"packages/export-pipeline/src/runtime-plan.ts",
		"planPageRuntime",
	);
	const modulePlan = owner(
		() => source("./packages/export-pipeline/src/runtime-plan.ts"),
		"packages/export-pipeline/src/runtime-plan.ts",
		"planModuleRuntime",
	);
	const resolveCompletion = owner(
		() => source("./apps/desktop/src/main/project-config.ts"),
		"apps/desktop/src/main/project-config.ts",
		"resolveCompletionSettings",
	);
	const defaults = source("./packages/editor-core/src/types/project.ts").DEFAULT_PROJECT_CONFIG;
	if (typeof defaults?.export?.completionThreshold !== "number")
		throw new Error("Missing DEFAULT_PROJECT_CONFIG.export.completionThreshold");
	const completion = await resolveCompletion({
		projectDir,
		fallbackCompletionThreshold: defaults.export.completionThreshold,
	});
	const input = await buildInput({ ...inputOptions, ...completion });
	const context = await createContext(input);
	const prepared = prepare(context);
	if (!context.pages.length || !context.documents.length) throw new Error("Empty stage inventory");
	await save("pages", context.normalizedCourse.content);
	await save("nav", {
		slugList: prepared.slugList,
		slugMap: prepared.slugMap,
		firstSlug: prepared.firstSlug,
		deckPages: prepared.deckPages,
		documents: context.documents,
		pages: prepared.config.pages.map((page) => ({ id: page.id, ...nav(prepared.config, page) })),
		glossary: prepared.config.glossaryTerms,
		resources: prepared.config.resourceEntries,
		glossaryTabEnabled: prepared.config.glossaryTabEnabled,
		resourcesTabEnabled: prepared.config.resourcesTabEnabled,
	});
	const readSidecar = owner(
		() => source("./apps/desktop/src/main/export/build-export-input-from-project.ts"),
		"apps/desktop/src/main/export/build-export-input-from-project.ts",
		"readNarrationSidecar",
	);
	const resolveV2 = owner(
		() => source("./packages/shared-blocks/src/narration.ts"),
		"packages/shared-blocks/src/narration.ts",
		"resolveNarrationV2",
	);
	const sidecar = await readSidecar(projectDir, input.courseId);
	const lessons = new Map();
	for (const page of context.normalizedCourse.content) {
		const id = page.lessonId ?? page.id;
		const members = lessons.get(id) ?? [];
		members.push(page);
		lessons.set(id, members);
	}
	const resolutions = [...lessons].map(([lessonId, pages]) => ({
		lessonId,
		...resolveV2({
			courseId: input.courseId,
			lessonId,
			pages,
			sidecar,
			locale: pages[0].locale ?? context.normalizedCourse.sourceLocale,
			enabled: pages[0].narrationEnabled,
			defaults: pages[0].narrationDefaults,
			moduleDeck: prepared.config.moduleDeck,
			digest: hash,
		}),
	}));
	await save("narration", {
		diagnosticResolutions: resolutions,
		pages: context.pages.map((page) => ({
			id: page.id,
			enabled: page.narrationEnabled,
			defaults: page.narrationDefaults,
			segments: page.data?._narrationSegments,
		})),
		warnings: input.warnings ?? [],
	});
	const modules = context.documents
		.filter((doc) => doc.kind === "module")
		.map((doc) => ({
			slug: doc.slug,
			plan: modulePlan(
				prepared.config,
				prepared.config.pages.filter((page) => doc.pageIds.includes(page.id)),
				true,
				prepared.config.moduleDeck,
			),
		}));
	await save("runtime", {
		diagnosticPages: prepared.config.pages.map((page) => ({
			id: page.id,
			plan: pagePlan(prepared.config, page, true),
		})),
		diagnosticModules: modules,
		outputPlans: prepared.pageRuntimePlans,
	});
	await save(
		"fragments",
		context.pages.map((page) => {
			const compiled = compile(context, page.id);
			return { id: page.id, order: compiled.order, fragments: [...compiled.fragments.values()] };
		}),
	);
} else if (["html", "scorm-1.2", "scorm-2004", "pdf"].includes(mode)) {
	const exportProject = owner(
		() => source("./apps/desktop/src/main/export/export-project.ts"),
		"apps/desktop/src/main/export/export-project.ts",
		"exportProject",
	);
	const result = await exportProject({
		...inputOptions,
		format: mode,
		exportAssetsDir: assets,
		fallbackCompletionThreshold: source("./packages/editor-core/src/types/project.ts")
			.DEFAULT_PROJECT_CONFIG.export.completionThreshold,
		enforceAccessibility: true,
		temporaryRoot: output,
		typstExecutablePath: typst,
	});
	await writeFile(
		path.join(output, mode === "pdf" ? "course.pdf" : "course.zip"),
		result.pdf ?? result.zip,
	);
	const { pdf: _pdf, zip: _zip, ...metadata } = result;
	await save("metadata", metadata);
} else if (mode === "pdf-source") {
	const build = owner(
		() => source("./packages/format-renderers/src/pipelines/course-pdf.ts"),
		"packages/format-renderers/src/pipelines/course-pdf.ts",
		"buildCoursePdfSource",
	);
	const resolveAssets = owner(
		() => source("./apps/desktop/src/main/export/resolve-pdf-assets.ts"),
		"apps/desktop/src/main/export/resolve-pdf-assets.ts",
		"resolvePdfAssets",
	);
	const input = await buildInput({
		...inputOptions,
		completionThreshold: 0,
		requireKnowledgeChecks: false,
		preparePdf: true,
		loadAssets: false,
	});
	if (!input.preparedLessons?.length) throw new Error("Missing prepared PDF lessons");
	const resolvedAssets = await resolveAssets(projectDir, input.preparedLessons, false);
	const availableFonts = new Set(await readdir(path.join(path.dirname(typst), "fonts")));
	await save("pdf-source", {
		...build({
			title: String(input.frontmatter.title || "Course"),
			locale: input.locale ?? "en",
			lessons: input.preparedLessons,
			resolvedAssets,
			availableFonts,
		}),
		resolvedAssets: [...resolvedAssets].map(([ref, bytes]) => [ref, bytes.length, hash(bytes)]),
	});
} else throw new Error(`Unknown mode ${mode}`);

assertLoadedSources(checkout);
