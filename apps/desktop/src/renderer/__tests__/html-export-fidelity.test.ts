import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildScormPackage } from "@praxity/export-pipeline";
import AdmZip from "adm-zip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExportInputFromProject } from "../../main/export/build-export-input-from-project";
import { writeLessonSource } from "../../main/lesson-source";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
	JSDOM: new (html: string) => { window: { document: Document } };
};

const FIXTURES_DIR = resolve(import.meta.dirname, "../../../../../docs/test-fixtures");
const EXPORT_ASSETS_DIR = resolve(import.meta.dirname, "../../../resources/export-assets");

let tempRoot: string;

async function scaffoldHtmlProject(): Promise<string> {
	const fixtureSource = await readFile(join(FIXTURES_DIR, "renderer-fidelity.prax"), "utf-8");
	const source = fixtureSource.replace(
		"  accentHue: 220\n",
		`${[
			"  accentHue: 220",
			"  colorBackgroundLight: '#ffffff'",
			"  colorBackground: '#ffffff'",
			"  colorAccent: '#dc2626'",
			"  typography:",
			"    body:",
			"      fontFamily: [Source Sans 3, sans-serif]",
			"      fontWeight: 400",
			"      fontStyle: normal",
			"  density: spacious",
			"  blockSpacing: spacious",
			"  navArchetype: sidebar",
			"  highlightStyle: marker",
		].join("\n")}\n`,
	);
	const projectDir = join(tempRoot, "html-export-fidelity");
	await cp(join(FIXTURES_DIR, "assets"), join(projectDir, "assets"), { recursive: true });
	await mkdir(join(projectDir, ".praxity"), { recursive: true });
	await writeFile(join(projectDir, "course.prax"), source, "utf-8");
	await writeFile(
		join(projectDir, "praxity.json"),
		JSON.stringify({ format: "praxity-project", completionThreshold: 0.8 }),
		"utf-8",
	);
	// course.yaml manifest — required by buildExportInputFromProject
	await writeFile(
		join(projectDir, "course.yaml"),
		"title: HTML Export Fidelity Test\nlessons:\n  - course.prax\n",
		"utf-8",
	);
	await writeLessonSource(projectDir, "course.prax", source, source);
	// Minimal placeholder image — asset resolution won't fail
	await writeFile(join(projectDir, "assets", "placeholder.png"), Buffer.from("PNG-STUB"));
	return projectDir;
}

async function buildHtmlExport(projectDir: string): Promise<AdmZip> {
	const exportInput = await buildExportInputFromProject({
		manifestPolicy: "write" as const,
		projectDir,
		completionThreshold: 0.8,
		viewerVersionPath: join(EXPORT_ASSETS_DIR, "viewer.version.json"),
	});

	const result = await buildScormPackage(exportInput, {
		mode: "desktop",
		format: "html",
		prebuiltAssetsDir: EXPORT_ASSETS_DIR,
		projectDir,
	});

	return new AdmZip(result.zip);
}

function parseHtmlEntry(zip: AdmZip, entryName: string): Document {
	const html = zip.readAsText(entryName);
	return new JSDOM(html).window.document;
}

function getBlockTypes(doc: Document): string[] {
	const blocks = doc.querySelectorAll("[data-block-type]");
	return Array.from(blocks).map((el) => el.getAttribute("data-block-type") ?? "");
}

function getBlocksByType(doc: Document, type: string): Element[] {
	return Array.from(doc.querySelectorAll(`[data-block-type="${type}"]`));
}

function getBlockJson(el: Element): Record<string, unknown> {
	const raw = el.getAttribute("data-block-json");
	if (!raw) return {};
	return JSON.parse(raw) as Record<string, unknown>;
}

function getBlockData(el: Element): Record<string, unknown> {
	const json = getBlockJson(el);
	return (json.data as Record<string, unknown>) ?? {};
}

function getConfig(doc: Document): Record<string, unknown> {
	const configScript = doc.getElementById("praxity-config");
	if (!configScript) return {};
	return JSON.parse(configScript.textContent ?? "{}") as Record<string, unknown>;
}

function getConfigBlocks(doc: Document): Array<Record<string, unknown>> {
	const blocks = getConfig(doc).blocks;
	return Array.isArray(blocks) ? (blocks as Array<Record<string, unknown>>) : [];
}

function getConfigBlocksByType(doc: Document, type: string): Array<Record<string, unknown>> {
	return getConfigBlocks(doc).filter((block) => block.type === type);
}

beforeAll(async () => {
	tempRoot = await mkdtemp(join(tmpdir(), "html-export-"));
});

afterAll(async () => {
	await rm(tempRoot, { recursive: true, force: true });
});

describe("HTML export fidelity", () => {
	let zip: AdmZip;
	let htmlEntries: string[];
	let allDocs: Document[];

	beforeAll(async () => {
		const projectDir = await scaffoldHtmlProject();
		zip = await buildHtmlExport(projectDir);
		htmlEntries = zip
			.getEntries()
			.map((e) => e.entryName)
			.filter((name) => name.endsWith(".html") && name !== "index.html");
		allDocs = htmlEntries.map((entry) => parseHtmlEntry(zip, entry));
		// A real HTML export; the default 10 s hook timeout is too tight on a loaded machine.
	}, 60_000);

	it("produces multiple HTML pages (page breaks recognized)", () => {
		// Fixture has 2 pageBreak blocks → 3 pages minimum
		expect(htmlEntries.length).toBeGreaterThan(1);
	});

	it("zip contains expected structure (no scorm-runtime for html format)", () => {
		const entries = zip.getEntries().map((e) => e.entryName);
		expect(entries.some((e) => e.endsWith(".html"))).toBe(true);
		expect(entries).not.toContain("viewer.css");
		expect(entries.some((entry) => /^styles\.[a-f0-9]{12}\.css$/.test(entry))).toBe(true);
		// HTML format should NOT include scorm-runtime
		expect(entries).not.toContain("scorm-runtime.js");
	});

	it("praxity-config has correct totalPages matching HTML file count", () => {
		const firstDoc = allDocs[0];
		expect(firstDoc).toBeDefined();
		if (!firstDoc) throw new Error("expected first HTML document");
		const configScript = firstDoc.getElementById("praxity-config");
		expect(configScript).not.toBeNull();
		if (!configScript) throw new Error("missing praxity-config script");
		const config = JSON.parse(configScript.textContent ?? "{}") as Record<string, unknown>;
		const pages = Array.isArray(config.pages) ? config.pages : [];
		expect(config.totalPages).toBe(pages.length);
		expect(htmlEntries).toEqual(expect.arrayContaining(pages.map((page) => `${page.slug}.html`)));
	});

	it("HTML pages apply the configured theme and viewer chrome", () => {
		const firstDoc = allDocs[0];
		expect(firstDoc).toBeDefined();
		if (!firstDoc) throw new Error("expected first HTML document");
		const html = firstDoc.documentElement;
		expect(html.hasAttribute("data-praxity-root")).toBe(true);
		expect(html.getAttribute("data-praxity-mode")).toBe("light");
		expect(html.getAttribute("data-praxity-highlight-style")).toBe("marker");
		expect(html.getAttribute("data-praxity-image-hover")).toBe("none");
		const stylesheet = zip
			.getEntries()
			.find((entry) => /^styles\.[a-f0-9]{12}\.css$/.test(entry.entryName));
		expect(stylesheet, "missing fingerprinted course stylesheet").toBeDefined();
		if (!stylesheet) throw new Error("missing fingerprinted course stylesheet");
		const styleText = stylesheet.getData().toString("utf-8");
		expect(styleText).toContain("--praxity-color-background: #ffffff;");
		expect(styleText).toContain("--praxity-color-accent: #db2526;");
		expect(styleText).toContain("--praxity-font-family:");
		expect(styleText).toContain("Source Sans 3");
		expect(styleText).toContain("--space-8: 32px;");
		expect(styleText).toContain("--praxity-block-spacing: var(--block-gap);");

		const configScript = firstDoc.getElementById("praxity-config");
		expect(configScript).not.toBeNull();
		if (!configScript) throw new Error("missing praxity-config script");
		const config = JSON.parse(configScript.textContent ?? "{}") as Record<string, unknown>;
		expect(config.navigationStyle).toBe("sidebar");
	});

	it("all expected block types appear in rendered HTML across pages", () => {
		const allTypes = new Set(allDocs.flatMap((doc) => getBlockTypes(doc)));

		// All parser block types that render with data-block-type in HTML.
		// Only pageBreak (split into separate files) and assessmentGroup
		// (metadata wrapper) are excluded — everything else renders.
		const expectedInHtml = [
			"heading",
			"text",
			"image",
			"video",
			"audio",
			"note",
			"quote",
			"code",
			"equation",
			"button",
			"embed",
			"divider",
			"accordion",
			"tabs",
			"sequence",
			"columns",
			"assessment",
			"rating",
			"checklist",
			"signature",
			"table",
			"chart",
			"variable",
			"logic",
		];

		for (const type of expectedInHtml) {
			expect(allTypes.has(type), `missing block type in HTML: ${type}`).toBe(true);
		}
	});

	it("published images resolve to package assets", () => {
		const images = allDocs.flatMap((doc) =>
			Array.from(doc.querySelectorAll('[data-block-type="image"] img')),
		);
		expect(images.length).toBeGreaterThan(0);
		for (const image of images) {
			const src = image.getAttribute("src");
			expect(src).toMatch(/^assets\//);
			expect(zip.getEntry(src ?? "")).toBeDefined();
		}
	});

	it("assessment blocks have assessmentType in data-block-json", () => {
		const assessmentBlocks = allDocs.flatMap((doc) => getConfigBlocksByType(doc, "assessment"));
		expect(assessmentBlocks.length).toBeGreaterThanOrEqual(1);
		for (const block of assessmentBlocks) {
			expect(
				(block.data as Record<string, unknown> | undefined)?.assessmentType,
				"assessment missing assessmentType",
			).toBeTruthy();
		}
	});

	it("code blocks have language in data-block-json", () => {
		const codeBlocks = allDocs.flatMap((doc) => getConfigBlocksByType(doc, "code"));
		expect(codeBlocks.length).toBeGreaterThanOrEqual(1);
		const firstCode = codeBlocks[0];
		expect(firstCode).toBeDefined();
		if (!firstCode) throw new Error("expected at least one code block");
		expect(
			(firstCode.data as Record<string, unknown> | undefined)?.language,
			"code block missing language",
		).toBeTruthy();
	});

	it("published buttons link to the authored destination", () => {
		const links = allDocs.flatMap((doc) =>
			Array.from(doc.querySelectorAll('[data-block-type="button"] a[href]')),
		);
		expect(links.map((link) => link.getAttribute("href"))).toContain(
			"https://example.com/sop-handbook",
		);
	});

	it("note blocks have color in data-block-json", () => {
		const noteBlocks = allDocs.flatMap((doc) => getConfigBlocksByType(doc, "note"));
		expect(noteBlocks.length).toBeGreaterThanOrEqual(1);
		for (const block of noteBlocks) {
			expect(
				(block.data as Record<string, unknown> | undefined)?.color,
				"note block missing color",
			).toBeTruthy();
		}
	});

	it("accordion blocks retain items in page config", () => {
		const accordionBlocks = allDocs.flatMap((doc) => getConfigBlocksByType(doc, "accordion"));
		expect(accordionBlocks.length).toBeGreaterThanOrEqual(1);
		for (const block of accordionBlocks) {
			const items = (block.data as Record<string, unknown> | undefined)?.items;
			expect(Array.isArray(items), "accordion missing items").toBe(true);
		}
	});

	it("no text blocks contain unparsed grammar syntax (parser integration guard)", () => {
		const grammarLeaks: Array<{ pattern: RegExp; label: string }> = [
			{
				pattern:
					/\bas:\s*(choice|button|note|order|match|free-response|fill-blank|embed|hotspot|categorize|rating|signature|checklist|accordion|tab|sequence|col|card|flashcard|comparison|bookmark)\b/,
				label: "as: block modifier",
			},
			{
				pattern: /^\$\$/m,
				label: "LaTeX $$ delimiter",
			},
			{
				pattern: /^```\w*/m,
				label: "fenced code block",
			},
			{
				pattern: /^\s*\(x\)\s+\S/m,
				label: "radio correct marker (x)",
			},
			{
				pattern: /^\s*\(\s*\)\s+\S/m,
				label: "radio empty marker ( )",
			},
			{
				pattern: /^\s*\[x\]\s+\S/m,
				label: "checkbox correct marker [x]",
			},
			{
				pattern: /^\s*\[\s*\]\s+\S/m,
				label: "checkbox empty marker [ ]",
			},
			{
				pattern: /\w+\s*::\s*\w+/,
				label: "match pair separator",
			},
			{
				pattern: /^spot:\s+/m,
				label: "hotspot spot: param",
			},
		];

		for (const doc of allDocs) {
			for (const el of getBlocksByType(doc, "text")) {
				const content = String(getBlockData(el).content ?? "");
				const plainText = content.replace(/<[^>]+>/g, "\n").replace(/&[^;]+;/g, " ");
				for (const { pattern, label } of grammarLeaks) {
					expect(
						pattern.test(plainText),
						`text block in HTML contains raw grammar (${label}): "${plainText
							.trim()
							.slice(0, 60)}"`,
					).toBe(false);
				}
			}
		}
	});
});
