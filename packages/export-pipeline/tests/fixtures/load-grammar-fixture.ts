import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { type GrammarFrontmatter, readLesson } from "@praxity/grammar";
import { traverseAssetGraph } from "@praxity/shared-blocks/asset-graph";
import { ASSET_FIELDS } from "@praxity/shared-blocks/constants";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import type { BuildOptions, DesktopExportInput } from "../../src/build";
import { assertViewerAssetsCurrent } from "../../src/bundle-viewer";
import { authoringCatalogSource } from "./authoring-catalog";

const FIXTURE_ROOT = resolve(import.meta.dirname, "../../../../docs/test-fixtures");
const FIXTURE_PATH = resolve(FIXTURE_ROOT, "sample-course-grammar.md");
const REPO_ROOT = resolve(FIXTURE_ROOT, "../..");
const DESKTOP_DIR = resolve(REPO_ROOT, "apps/desktop");
const DESKTOP_EXPORT_ASSETS_DIR = resolve(DESKTOP_DIR, "resources/export-assets");

export interface LoadedGrammarFixture {
	source: string;
	frontmatter: GrammarFrontmatter;
	designConfig: GrammarFrontmatter["design"] | undefined;
	pages: PraxityPage[];
	course: DesktopExportInput;
	buildOptions: Omit<BuildOptions, "format">;
}

function isRemoteAssetPath(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

async function ensureDesktopExportAssets(): Promise<void> {
	try {
		await assertViewerAssetsCurrent(DESKTOP_EXPORT_ASSETS_DIR);
		return;
	} catch {
		// Missing or stale generated assets must be rebuilt from the current source.
	}

	console.log("[export-pipeline] Desktop export assets missing or stale — running prebuild…");
	// The desktop prebuild command, run through Node: Windows has no pnpm executable to spawn.
	execFileSync(process.execPath, ["--import", "tsx", "scripts/prebuild-viewer.ts"], {
		cwd: DESKTOP_DIR,
		stdio: "inherit",
	});
}

async function loadFixtureAssets(blocks: DesktopExportInput["blocks"]): Promise<{
	blocks: DesktopExportInput["blocks"];
	resolvedAssets: Map<string, Uint8Array>;
}> {
	const resolvedAssets = new Map<string, Uint8Array>();
	const [resolvedSource] = await traverseAssetGraph(
		[{ id: "grammar-fixture", title: "Grammar Fixture", blocks }],
		{
			onAsset: async ({ value }) => {
				if (isRemoteAssetPath(value)) return;
				const normalized = value.replace(/^\/+|^\.\//g, "");
				if (!normalized) return;
				const exportPath = normalized.startsWith("assets/")
					? normalized
					: `assets/${basename(normalized)}`;
				resolvedAssets.set(exportPath, await readFile(resolve(FIXTURE_ROOT, normalized)));
			},
			rewriteAsset: ({ value }) => {
				if (isRemoteAssetPath(value)) return undefined;
				const normalized = value.replace(/^\/+|^\.\//g, "");
				return normalized.startsWith("assets/") ? normalized : `assets/${basename(normalized)}`;
			},
		},
		{ assetFields: [...ASSET_FIELDS, "href"] },
	);
	return { blocks: resolvedSource?.blocks ?? blocks, resolvedAssets };
}

export async function loadGrammarFixture(
	supplement: PraxityBlock[] = [],
): Promise<LoadedGrammarFixture> {
	const fixture = await loadSourceFixture(await readFile(FIXTURE_PATH, "utf-8"), supplement);
	return fixture;
}

export async function loadAuthoringCatalogFixture(): Promise<LoadedGrammarFixture> {
	const fixture = await loadSourceFixture(authoringCatalogSource());
	// Stemless assessments remain a supported stored model. G4 authored hotspots
	// require a question, so retain the publisher fallback case at its interface.
	const legacy = fixture.pages.find((page) => page.title === "Catalog legacy hotspot");
	if (!legacy) throw new Error("Missing stemless hotspot catalog page");
	const ids = new Set(
		legacy.blocks.filter((block) => block.type === "assessment").map((block) => block.id),
	);
	for (const block of [...legacy.blocks, ...fixture.course.blocks]) {
		if (ids.has(block.id)) block.data.stem = [];
	}
	return fixture;
}

async function loadSourceFixture(
	source: string,
	supplement: PraxityBlock[] = [],
): Promise<LoadedGrammarFixture> {
	await ensureDesktopExportAssets();
	const parsed = readLesson(source);
	const frontmatter = (parsed.frontmatter ?? {}) as GrammarFrontmatter;
	const courseTitle =
		typeof frontmatter.title === "string" && frontmatter.title.trim().length > 0
			? frontmatter.title.trim()
			: "Sample Grammar Fixture";
	const sourceLocale =
		typeof frontmatter.lang === "string" && frontmatter.lang.trim().length > 0
			? frontmatter.lang.trim()
			: "en";

	const blocks = [...parsed.blocks, ...supplement];
	const pages = splitBlocksIntoPages(blocks, courseTitle);
	const designConfig = frontmatter.design;
	const fixtureAssets = await loadFixtureAssets(blocks);

	const course: DesktopExportInput = {
		courseId: "grammar-fixture-course",
		blocks: fixtureAssets.blocks,
		frontmatter,
		config: { completionThreshold: 0.8 },
		resolvedAssets: fixtureAssets.resolvedAssets,
		viewerVersion: "local",
		locale: sourceLocale,
	};

	return {
		source,
		frontmatter,
		designConfig,
		pages,
		course,
		buildOptions: {
			mode: "desktop",
			prebuiltAssetsDir: DESKTOP_EXPORT_ASSETS_DIR,
			projectDir: FIXTURE_ROOT,
		},
	};
}
