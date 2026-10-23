import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	collectTypographyFontFaces,
	DEFAULT_TYPOGRAPHY,
	FONT_LIST,
	type FontDisplay,
	type FontEntry,
	type FontFaceRequest,
	normalizeTypography,
	resolveHeadingTypography,
	type TypographyVariants,
} from "@praxity/grammar";

import { PATTERNS_SRC, patternSourceFiles } from "./bundle-viewer.ts";
import {
	type RuntimeNotices,
	readPackageNotice,
	writePackageNotice,
} from "./third-party-notices.ts";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_SOURCES_DIR = "css-sources";
const FONT_WEIGHTS = ["400", "600", "700"] as const;
const FONT_STYLES = ["normal", "italic"] as const;

export interface DesktopCssInput {
	source: string;
	assetPath: string;
	minify: boolean;
}

function baseCssSources(sourceDir?: string | null): Record<string, string> {
	return {
		"mantine.css": sourceDir
			? path.join(sourceDir, "mantine.css")
			: require.resolve("@mantine/core/styles.css"),
		"global.css": sourceDir
			? path.join(sourceDir, "global.css")
			: path.resolve(__dirname, "../template/src/styles/global.css"),
		"print.css": sourceDir
			? path.join(sourceDir, "print.css")
			: path.resolve(__dirname, "../template/src/styles/print.css"),
	};
}

/** The preparation inventory also defines the complete selectable offline catalog. */
export async function desktopCssInputs(): Promise<DesktopCssInput[]> {
	const inputs = Object.entries(baseCssSources()).map(([name, source]) => ({
		source,
		assetPath: `${CSS_SOURCES_DIR}/${name}`,
		minify: true,
	}));
	// Retain production pattern CSS as source inventory; assembly does not read this copy.
	for (const source of await patternSourceFiles()) {
		const relative = path.relative(PATTERNS_SRC, source);
		if (
			path.extname(source) !== ".css" ||
			relative.split(path.sep).some((part) => ["fixtures", "tests", "__tests__"].includes(part))
		)
			continue;
		inputs.push({
			source,
			assetPath: `${CSS_SOURCES_DIR}/patterns/${path.relative(PATTERNS_SRC, source).split(path.sep).join("/")}`,
			minify: true,
		});
	}
	const packageJson = JSON.parse(
		await readFile(path.resolve(__dirname, "../package.json"), "utf8"),
	);
	for (const fontPackage of Object.keys(packageJson.dependencies).filter((name) =>
		name.startsWith("@fontsource/"),
	)) {
		const entry = FONT_LIST.find((font) => font.fontsource === fontPackage);
		const catalog = `${CSS_SOURCES_DIR}/fontsource/${fontCatalogName(fontPackage)}`;
		for (const weight of fontWeights(entry)) {
			for (const style of FONT_STYLES) {
				const source = resolveOptional(fontCssSpecifier(fontPackage, entry, weight, style));
				// Some upstream families have no italic or intermediate weight.
				if (!source) continue;
				inputs.push({ source, assetPath: `${catalog}/${weight}-${style}.css`, minify: true });
				for (const [, relative] of fontUrls(keepWoff2Only(await readFile(source, "utf8")))) {
					inputs.push({
						source: path.resolve(path.dirname(source), relative),
						assetPath: `${catalog}/files/${path.basename(relative)}`,
						minify: false,
					});
				}
			}
		}
	}
	return [...new Map(inputs.map((input) => [input.assetPath, input])).values()];
}

function fontUrls(css: string): RegExpMatchArray[] {
	return [...css.matchAll(/url\(["']?(\.[^"')]+\.woff2)["']?\)/g)];
}

/** Default bundles are shipped with their resolved font references. */
export async function desktopCssAssetPaths(outputDir: string): Promise<string[]> {
	const paths = (await desktopCssInputs()).map((input) => input.assetPath);
	for (const filename of ["styles.css", "styles-lite.css"]) {
		paths.push(filename);
		for (const [, font] of (await readFile(path.join(outputDir, filename), "utf8")).matchAll(
			/url\(["']?(fonts\/[^"')]+)["']?\)/g,
		))
			paths.push(font);
	}
	return [...new Set(paths)];
}

const BRAND_CSS = `
.praxity-brand-header {
	display: flex;
	align-items: center;
	padding: 8px 16px;
	max-height: 56px;
}
.praxity-brand-header--left { justify-content: flex-start; }
.praxity-brand-header--center { justify-content: center; }
.praxity-brand-logo {
	max-height: 40px;
	width: auto;
	object-fit: contain;
}
`;

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

function fontCatalogName(fontPackage: string): string {
	return fontPackage.slice("@fontsource/".length);
}

function fontWeights(entry: FontEntry | undefined) {
	return entry?.faces?.weights.map(String) ?? FONT_WEIGHTS;
}

function fontCssSpecifier(
	fontPackage: string,
	entry: FontEntry | undefined,
	weight: string,
	style: string,
): string {
	const subset = entry?.faces ? entry.faces.subset : "latin";
	return `${fontPackage}/${subset ? `${subset}-` : ""}${weight}${style === "italic" ? "-italic" : ""}.css`;
}

function resolveOptional(specifier: string): string | null {
	try {
		return require.resolve(specifier);
	} catch {
		return null;
	}
}

function keepWoff2Only(css: string): string {
	return css.replace(/,\s*url\([^)]*\.woff\)\s*format\(["']woff["']\)/g, "");
}

async function copyAndRewriteFontUrls(
	css: string,
	sourceDir: string,
	fontsDir: string,
): Promise<string> {
	const matches = fontUrls(css);
	await mkdir(fontsDir, { recursive: true });
	await Promise.all(
		matches.map(async ([, relativePath]) => {
			const source = path.resolve(sourceDir, relativePath);
			try {
				await copyFile(source, path.join(fontsDir, path.basename(source)));
			} catch (cause) {
				throw new Error(
					`Missing or unreadable selected font asset: ${source.split(path.sep).join("/")}`,
					{ cause },
				);
			}
		}),
	);

	let rewritten = css;
	for (const [, relativePath] of matches) {
		rewritten = rewritten.replaceAll(relativePath, `fonts/${path.basename(relativePath)}`);
	}
	return rewritten;
}

async function readFontCss(
	request: FontFaceRequest,
	fontDisplay: FontDisplay,
	outputDir: string,
	prebuiltAssetsDir?: string,
): Promise<string[]> {
	const fontPackage = request.entry.fontsource;
	if (!fontPackage) return [];

	const parts: string[] = [];
	const usedPaths = new Set<string>();
	for (const weight of request.weights) {
		for (const style of request.styles) {
			const exactFace = !!request.entry.faces;
			const weights = exactFace
				? [String(weight)]
				: [...fontWeights(request.entry)].sort(
						(a, b) => Math.abs(Number(a) - weight) - Math.abs(Number(b) - weight),
					);
			const styles = exactFace
				? [style]
				: style === "italic"
					? (["italic", "normal"] as const)
					: (["normal", "italic"] as const);
			let cssPath: string | null = null;
			for (const candidateStyle of styles) {
				for (const candidateWeight of weights) {
					const candidatePath = prebuiltAssetsDir
						? path.join(
								prebuiltAssetsDir,
								CSS_SOURCES_DIR,
								"fontsource",
								fontCatalogName(fontPackage),
								`${candidateWeight}-${candidateStyle}.css`,
							)
						: resolveOptional(
								fontCssSpecifier(fontPackage, request.entry, candidateWeight, candidateStyle),
							);
					if (candidatePath && (await pathExists(candidatePath))) {
						cssPath = candidatePath;
						break;
					}
				}
				if (cssPath) break;
			}
			if (!cssPath)
				throw new Error(
					`Missing selected font catalog: ${prebuiltAssetsDir ? path.join(prebuiltAssetsDir, CSS_SOURCES_DIR, "fontsource", fontCatalogName(fontPackage)).split(path.sep).join("/") : fontPackage}`,
				);
			if (usedPaths.has(cssPath)) continue;
			usedPaths.add(cssPath);
			const css = keepWoff2Only(await readFile(cssPath, "utf-8")).replace(
				/font-display:\s*(?:auto|block|swap|fallback|optional);/g,
				`font-display: ${fontDisplay};`,
			);
			parts.push(
				await copyAndRewriteFontUrls(css, path.dirname(cssPath), path.join(outputDir, "fonts")),
			);
		}
	}
	if (parts.length) {
		const notice = prebuiltAssetsDir
			? (
					JSON.parse(await readFile(path.join(prebuiltAssetsDir, "viewer-manifest.json"), "utf8"))
						.thirdPartyNotices as RuntimeNotices | undefined
				)?.packages[fontPackage]
			: await readPackageNotice(require.resolve(`${fontPackage}/package.json`));
		await writePackageNotice(outputDir, notice);
	}
	return parts;
}

async function minifyCss(css: string): Promise<string> {
	const { transform } = await import("esbuild");
	return (await transform(css, { loader: "css", minify: true })).code;
}

/** Build full and Mantine-free stylesheets plus selected local fonts for every export path. */
export async function buildExportCssBundle(
	outputDir: string,
	typography?: TypographyVariants,
	prebuiltAssetsDir?: string,
): Promise<string[]> {
	await mkdir(outputDir, { recursive: true });
	await rm(path.join(outputDir, "fonts"), { recursive: true, force: true });

	const sourceDir = prebuiltAssetsDir ? path.join(prebuiltAssetsDir, CSS_SOURCES_DIR) : null;
	const baseSources = baseCssSources(sourceDir);
	const mantinePath = baseSources["mantine.css"];
	const globalPath = baseSources["global.css"];
	const printPath = baseSources["print.css"];

	// Both bundles share selected fonts, global, print, and brand CSS. Only the
	// full bundle includes Mantine for pages that mount React-owned UI.
	const sharedCssParts: string[] = [];
	const normalizedTypography = normalizeTypography(typography, DEFAULT_TYPOGRAPHY);
	for (const request of collectTypographyFontFaces(normalizedTypography)) {
		sharedCssParts.push(
			...(await readFontCss(
				request,
				normalizedTypography.fontDisplay,
				outputDir,
				prebuiltAssetsDir,
			)),
		);
	}
	for (const cssPath of [globalPath, printPath]) {
		sharedCssParts.push(await readFile(cssPath, "utf-8"));
	}
	sharedCssParts.push(BRAND_CSS);

	const sharedCss = sharedCssParts.join("\n");
	const mantineCss = await readFile(mantinePath, "utf-8");
	const cssBundles = {
		"styles.css": [mantineCss, sharedCss].filter(Boolean).join("\n"),
		"styles-lite.css": sharedCss,
	};
	await Promise.all(
		Object.entries(cssBundles).map(async ([filename, css]) =>
			writeFile(
				path.join(outputDir, filename),
				prebuiltAssetsDir ? css : await minifyCss(css),
				"utf-8",
			),
		),
	);

	const fontsDir = path.join(outputDir, "fonts");
	if (!(await pathExists(fontsDir))) return [];
	const criticalFaces = [
		normalizedTypography.body,
		resolveHeadingTypography(normalizedTypography, 1),
	].map((role) => `-latin-${role.fontWeight}-${role.fontStyle}.woff2`);
	return (await readdir(fontsDir)).filter((file) =>
		criticalFaces.some((face) => file.endsWith(face)),
	);
}

/** Prepare offline CSS/font inputs that the packaged desktop app can select from. */
export async function prepareDesktopCssAssets(outputDir: string): Promise<void> {
	const sourceDir = path.join(outputDir, CSS_SOURCES_DIR);
	await rm(sourceDir, { recursive: true, force: true });
	await mkdir(sourceDir, { recursive: true });

	for (const input of await desktopCssInputs()) {
		const target = path.join(outputDir, input.assetPath);
		await mkdir(path.dirname(target), { recursive: true });
		if (input.minify) {
			await writeFile(target, await minifyCss(keepWoff2Only(await readFile(input.source, "utf8"))));
		} else {
			await copyFile(input.source, target);
		}
	}

	await buildExportCssBundle(outputDir, DEFAULT_TYPOGRAPHY, outputDir);
}
