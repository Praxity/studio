/**
 * Run from the repository root:
 * pnpm exec tsx packages/export-pipeline/scripts/update-page-compiler-baseline.mts
 *
 * Baseline changes need a reviewed design reason. Review every changed entry;
 * never regenerate merely to make a failing compiler test pass.
 * Hash emitted full-build HTML, never compileDocument/compilePage results.
 * Bundle URLs, font preloads and build-only image hints are normalized to P2's
 * renderer-only fixture configuration.
 * Fixture asset references are round-tripped through offline relative URLs;
 * this baseline covers renderer bytes, not downloaded asset bytes.
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { traverseAssetGraph } from "@praxity/shared-blocks/asset-graph";
import { detectVideoSource } from "@praxity/shared-blocks/video-url-utils";
import { JSDOM } from "jsdom";
import { type CourseExportInput, compileCourse, deployCourse } from "../src/build.ts";
import { DEPLOYMENT_HEAD_MARKER, escapeJsonForScript } from "../src/html-gen.ts";
import { stripChoiceStateFacts } from "../tests/fixtures/choice-facts.ts";
import { compilerFixture, compilerIslandAssets } from "../tests/fixtures/page-compiler.ts";

const hash = (html: string) => createHash("sha256").update(html).digest("hex");

/** Match the renderer-only fixture assets in both capture and compiler checks. */
export function normalizeRendererAssets(html: string): string {
	// The fixture omits this deployment owner; its presence and URL are not renderer bytes.
	return html
		.replace(
			/^<script(?: defer)? src="self-check-lifetime-[A-Z0-9]{8}\.classic\.js"><\/script>\n/gm,
			"",
		)
		.replace(/(?:islands\/)?island-([a-z-]+)-[A-Z0-9]{8,12}\.js/g, (_match, kebab: string) => {
			const island = kebab.replace(/-([a-z])/g, (_part, letter: string) => letter.toUpperCase());
			return `${island}.js`;
		});
}

// These fixtures have no authored loading hints or icon nodes. The build adds
// them after adaptation; P2's renderer-only input intentionally has neither.
function rendererMetadata(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(rendererMetadata);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(
				([key, item]) =>
					!(
						(key === "loading" && (item === "eager" || item === "lazy")) ||
						key === "fetchPriority" ||
						key === "_tablerIconNodes"
					),
			)
			.map(([key, item]) => [key, rendererMetadata(item)]),
	);
}

/** Slice source bytes at DOM locations; serializing the DOM would change HTML. */
export function bodyHashes(html: string, pageIds: readonly string[], deck: boolean) {
	const bodies: Record<string, string> = {};
	const dom = new JSDOM(html, { includeNodeLocations: true });
	try {
		for (const pageId of pageIds) {
			const element = dom.window.document.getElementById(deck ? pageId : "main-content");
			if (!element) continue;
			// jsdom's declarations expose the generic node location, even for elements.
			const location = dom.nodeLocation(element) as ReturnType<JSDOM["nodeLocation"]> & {
				startTag?: { endOffset: number };
				endTag?: { startOffset: number };
			};
			const boundary = element.querySelector(
				":scope > .praxity-page-nav-skip, :scope > .praxity-embed-nav-skip, :scope > .praxity-pages-completion",
			);
			const end = boundary
				? dom.nodeLocation(boundary)?.startOffset
				: location?.endTag?.startOffset;
			if (!location?.startTag || !location.endTag || end === undefined)
				throw new Error(`Missing body bounds: ${pageId}`);
			const body = html.slice(location.startTag.endOffset, end);
			bodies[pageId] = hash(deck ? body : body.replace(/^\n|\n$/g, ""));
		}
		return bodies;
	} finally {
		dom.window.close();
	}
}

export async function recordBaseline(fixtures?: readonly CourseExportInput[]) {
	const baseline: Record<
		string,
		{ bodies: Record<string, string>; documents: Record<string, string> }
	> = {};
	const inputs =
		fixtures ??
		(await Promise.all((["leadership", "toolkit", "comprehensive"] as const).map(compilerFixture)));
	for (const input of inputs) {
		const assets = new Map<string, string>();
		input.content = await traverseAssetGraph(input.content, {
			rewriteAsset: ({ block, key, value }) => {
				if (block.type === "embed" && key === "src") return undefined;
				if (
					block.type === "video" &&
					["youtube", "vimeo", "loom"].includes(detectVideoSource(value))
				)
					return undefined;
				const extension = extname(new URL(value, "https://fixture.invalid").pathname);
				const local = `assets/compiler-fixture-${assets.size}${extension}`;
				assets.set(local, value);
				return local;
			},
		});
		const artifact = await compileCourse(input);
		try {
			const deployment = await deployCourse(artifact, { format: "electron-preview" });
			try {
				const bodies: Record<string, string> = {};
				const documents: Record<string, string> = {};
				for (const file of artifact.manifest.files.filter((entry) =>
					entry.path.endsWith(".html"),
				)) {
					const stream = (await deployment.openFile(file.path)).setEncoding("utf8");
					let html = "";
					for await (const chunk of stream) html += chunk.toString();
					html = html
						.replace(
							/<script id="praxity-deployment-config"[^\n]+\n<script defer src="host-electron-preview-[A-Z0-9]{8}\.js"><\/script>/g,
							DEPLOYMENT_HEAD_MARKER,
						)
						.replace(/^<link rel="preload" href="fonts\/[^\n]+\n/gm, "")
						.replace(/styles(?:-lite)?(?:-deck)?\.[a-f0-9]{12}\.css/g, "styles.css")
						.replace(/course-shell-[A-Z0-9]{8}\.js/g, "course-shell.js")
						.replace(/course-resume-[A-Z0-9]{8}\.js/g, "course-resume.js")
						.replace(
							/(?:islands\/)?island-loader-[A-Z0-9]{8}\.js/g,
							compilerIslandAssets.loaderFilename,
						)
						.replace(/,"slideStyles":\{\}/g, "")
						.replace(/<img\b[^>]*>/g, (tag) =>
							tag.replace(/ loading="(?:eager|lazy)"| fetchpriority="high"/g, ""),
						)
						.replace(
							/(<script id="praxity-config" type="application\/json">)([\s\S]*?)(<\/script>)/g,
							(_match, open: string, json: string, close: string) =>
								`${open}${escapeJsonForScript(JSON.stringify(rendererMetadata(JSON.parse(json))))}${close}`,
						);
					html = normalizeRendererAssets(stripChoiceStateFacts(html));
					for (const [local, original] of [...assets].reverse())
						html = html.replaceAll(local, original);
					documents[file.path] = hash(html);
					const pages = artifact.manifest.pages.filter(
						(page) => input.moduleDeck || file.path === `${page.slug}.html`,
					);
					Object.assign(
						bodies,
						bodyHashes(
							html,
							pages.map((page) => page.id),
							Boolean(input.moduleDeck),
						),
					);
				}
				baseline[input.id] = {
					bodies: Object.fromEntries(
						artifact.manifest.pages.map((page) => [page.id, bodies[page.id]]),
					),
					documents,
				};
			} finally {
				await deployment.dispose();
			}
		} finally {
			await artifact.dispose();
		}
	}
	return baseline;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const baseline = await recordBaseline();
	await writeFile(
		new URL("../tests/fixtures/page-compiler-baseline.json", import.meta.url),
		`${JSON.stringify(baseline, null, "\t")}\n`,
	);
}
