import path from "node:path";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import { isStatefulBlock } from "@praxity/shared-blocks/types";
import fs from "fs-extra";
import type { CourseExportInput } from "./build.ts";
import {
	type CourseConfig,
	generateHtmlIndex,
	generateNumberedPageRedirect,
	type HtmlOutputOptions,
	publishedPageTitle,
} from "./html-gen.ts";
import { compileDocument, preparePageCompiler } from "./preview/compile-page.ts";
import { createCourseContextFromHtml } from "./preview/course-context.ts";
import type { IslandName, RuntimeMode } from "./runtime-plan.ts";
import { type SelfCheckRuntime, selfCheckPageAssets } from "./self-check.ts";

import { type WriteDistractorsRuntime, writeDistractorsPageAssets } from "./write-distractors.ts";

/** Write the same documents used by incremental preview, plus stable redirects. */
export async function generateHtmlPages(
	config: CourseConfig & Pick<CourseExportInput, "selfCheckContents" | "writeDistractorsContents">,
	distDir: string,
	islandAssets?: HtmlOutputOptions["islandAssets"],
	basePath?: string,
	liteStylesheetFilename?: string,
	shellFilename = "course-shell.js",
	stylesheetFilename = "styles.css",
	deckStylesheets?: { full: string; lite: string },
	resumeFilename = "course-resume.js",
	selfCheckRuntime?: SelfCheckRuntime,
	retrievalSheetStylesheetFilename?: string,
	writeDistractorsRuntime?: WriteDistractorsRuntime,
	highlightStylesheetFilename?: string,
) {
	await fs.ensureDir(distDir);
	const htmlOutput = {
		islandAssets: islandAssets ?? { loaderFilename: "", islandFilenames: {} },
		basePath,
		liteStylesheetFilename,
		shellFilename,
		stylesheetFilename,
		deckStylesheets,
		retrievalSheetStylesheetFilename,
		highlightStylesheetFilename,
		resumeFilename,
	};
	const context = await createCourseContextFromHtml(
		config,
		htmlOutput,
		selfCheckRuntime,
		writeDistractorsRuntime,
	);
	// Require real assets on the publishing path, including when none were supplied.
	const prepared = preparePageCompiler(context);
	const { slugMap, slugList, firstSlug, pageRuntimePlans, deckPages } = prepared;
	const usedStylesheets = new Set<string>();
	const courseIslands = new Set<IslandName>();
	let runtimeMode: RuntimeMode = "static";
	for (const plan of pageRuntimePlans.values()) {
		if (plan.mode === "islands") runtimeMode = "islands";
		for (const island of plan.islands) courseIslands.add(island);
	}
	await fs.writeFile(
		path.join(distDir, "index.html"),
		generateHtmlIndex(firstSlug, basePath, Object.fromEntries(slugMap), shellFilename),
	);
	for (const document of context.documents) {
		const compiled = compileDocument(context, document.slug);
		for (const name of compiled.stylesheetsUsed) usedStylesheets.add(name);
		await fs.writeFile(path.join(distDir, `${document.slug}.html`), compiled.html);
	}
	for (const [index, page] of config.pages.entries()) {
		const slug = slugMap.get(page.id) ?? `page-${index + 1}`;
		const moduleSlug = deckPages?.[index].moduleSlug;
		if (moduleSlug && moduleSlug !== slug) {
			const target = `${moduleSlug}.html#${encodeURIComponent(page.id)}`;
			await fs.writeFile(
				path.join(distDir, `${slug}.html`),
				generateNumberedPageRedirect(moduleSlug, basePath, shellFilename).replaceAll(
					`${moduleSlug}.html`,
					target,
				),
			);
		}
		const numberedSlug = `page-${index + 1}`;
		if (slug !== numberedSlug)
			await fs.writeFile(
				path.join(distDir, `${numberedSlug}.html`),
				generateNumberedPageRedirect(slug, basePath, shellFilename),
			);
	}
	return {
		runtimeMode,
		islands: [...courseIslands].sort(),
		stylesheetsUsed: [...usedStylesheets],
		pages: config.pages.map((page, index) => {
			const runtime = pageRuntimePlans.get(page.id);
			if (!runtime) throw new Error(`Missing page runtime plan: ${page.id}`);
			return {
				...(selfCheckPageAssets(context.selfCheckRuntime, page.blocks).length
					? { selfCheckAssets: selfCheckPageAssets(context.selfCheckRuntime, page.blocks) }
					: {}),
				...(writeDistractorsPageAssets(context.writeDistractorsRuntime, page.blocks).length
					? {
							writeDistractorsAssets: writeDistractorsPageAssets(
								context.writeDistractorsRuntime,
								page.blocks,
							),
						}
					: {}),
				id: page.id,
				title: publishedPageTitle(page),
				...(page.lessonId ? { lessonId: page.lessonId } : {}),
				slug: slugList[index].slug,
				runtime,
				statefulBlockIds: flattenLogicBlocks(page.blocks)
					.filter(isStatefulBlock)
					.map((block) => block.id),
			};
		}),
	};
}
