import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, test } from "vitest";
import { buildScormPackage } from "../src/build";
import { loadGrammarFixture } from "./fixtures/load-grammar-fixture";

interface ParsedHtmlPage {
	entryName: string;
	dom: JSDOM;
	document: Document;
}

interface ParsedBlock {
	entryName: string;
	type: string;
	json: Record<string, unknown> | null;
	data: Record<string, unknown> | null;
	element: Element;
}

const ISLAND_LOADER_JS_RE = /^island-loader-[a-z0-9]+\.js$/i;
const COURSE_SHELL_JS_RE = /^course-shell-[a-z0-9]+\.js$/i;
const VALID_ID_RE = /^\S+$/;

let allHtmlPages: ParsedHtmlPage[] = [];
let canonicalPages: ParsedHtmlPage[] = [];
let canonicalBlocks: ParsedBlock[] = [];
let htmlEntrySet = new Set<string>();
let canonicalPageEntries: string[] = [];
let primaryConfig: Record<string, unknown> = {};
const configByEntry = new Map<string, Record<string, unknown>>();

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function hasNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function parseConfig(doc: Document, entryName: string): Record<string, unknown> {
	const configScript = doc.getElementById("praxity-config");
	if (!configScript) {
		throw new Error(`missing praxity-config script in ${entryName}`);
	}
	try {
		return asRecord(JSON.parse(configScript.textContent ?? "{}"));
	} catch (error) {
		throw new Error(`invalid praxity-config JSON in ${entryName}: ${String(error)}`);
	}
}

function buildConfigBlockMap(
	config: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
	const map = new Map<string, Record<string, unknown>>();
	const blocks = Array.isArray(config.blocks) ? config.blocks : [];
	for (const block of blocks) {
		const parsed = asRecord(block);
		const id = parsed.id;
		if (hasNonEmptyString(id)) {
			map.set(id, parsed);
		}
	}
	return map;
}

function parseBlock(
	blockEl: Element,
	entryName: string,
	configBlockMap: Map<string, Record<string, unknown>>,
): ParsedBlock {
	const type = blockEl.getAttribute("data-block-type") ?? "";
	const blockId = blockEl.getAttribute("data-block-id") ?? "";
	const json = blockId ? (configBlockMap.get(blockId) ?? null) : null;
	return {
		entryName,
		type,
		json,
		data: json ? asRecord(json.data) : null,
		element: blockEl,
	};
}

function blocksByType(type: string): ParsedBlock[] {
	return canonicalBlocks.filter((block) => block.type === type);
}

function blocksByTypeWithJson(type: string): ParsedBlock[] {
	return canonicalBlocks.filter((block) => block.type === type && block.json !== null);
}

beforeAll(async () => {
	const { course, buildOptions } = await loadGrammarFixture();
	const result = await buildScormPackage(course, { ...buildOptions, format: "html" });
	const zip = new AdmZip(result.zip);

	const htmlEntries = zip
		.getEntries()
		.map((entry) => entry.entryName)
		.filter((entryName) => entryName.endsWith(".html") && entryName !== "index.html");

	htmlEntrySet = new Set(htmlEntries);
	allHtmlPages = htmlEntries.map((entryName) => {
		const dom = new JSDOM(zip.readAsText(entryName));
		return { entryName, dom, document: dom.window.document };
	});

	const pagesWithConfig = allHtmlPages.filter((page) =>
		Boolean(page.document.getElementById("praxity-config")),
	);
	if (pagesWithConfig.length === 0) {
		throw new Error("expected at least one HTML page containing praxity-config");
	}

	for (const page of pagesWithConfig) {
		configByEntry.set(page.entryName, parseConfig(page.document, page.entryName));
	}

	const firstConfig = configByEntry.get(pagesWithConfig[0]?.entryName ?? "");
	if (!firstConfig) {
		throw new Error("missing parsed config for first HTML page");
	}
	primaryConfig = firstConfig;

	const pages = Array.isArray(firstConfig.pages) ? firstConfig.pages : [];
	if (pages.length === 0) {
		throw new Error("praxity-config.pages is empty");
	}

	canonicalPageEntries = pages.map((page, index) => {
		const pageRecord = asRecord(page);
		const slug = pageRecord.slug;
		if (!hasNonEmptyString(slug)) {
			throw new Error(`missing or invalid slug in config.pages[${index}]`);
		}
		return `${slug}.html`;
	});

	canonicalPages = canonicalPageEntries.map((entryName) => {
		const found = allHtmlPages.find((page) => page.entryName === entryName);
		if (!found) {
			throw new Error(`missing canonical page file: ${entryName}`);
		}
		return found;
	});

	canonicalBlocks = canonicalPages.flatMap((page) => {
		const pageConfig = configByEntry.get(page.entryName) ?? {};
		const configBlockMap = buildConfigBlockMap(pageConfig);
		return Array.from(page.document.querySelectorAll("[data-block-type]")).map((el) =>
			parseBlock(el, page.entryName, configBlockMap),
		);
	});
});

describe("Group 1: Document Structure", () => {
	test("every page has <html lang> and a non-empty <title>", () => {
		for (const { entryName, document } of canonicalPages) {
			expect(
				hasNonEmptyString(document.documentElement.getAttribute("lang")),
				`${entryName} missing html lang`,
			).toBe(true);
			expect(document.title.trim().length > 0, `${entryName} has empty title`).toBe(true);
		}
	});

	test("no duplicate IDs and all IDs are valid", () => {
		for (const { entryName, document } of canonicalPages) {
			const ids = Array.from(document.querySelectorAll("[id]"), (el) => el.id).filter(Boolean);
			const seen = new Set<string>();
			const duplicates = new Set<string>();

			for (const id of ids) {
				if (seen.has(id)) {
					duplicates.add(id);
				}
				seen.add(id);
			}

			expect(
				duplicates.size,
				`${entryName} has duplicate IDs: ${Array.from(duplicates).join(", ")}`,
			).toBe(0);
			for (const id of ids) {
				expect(VALID_ID_RE.test(id), `${entryName} has invalid id: "${id}"`).toBe(true);
			}
		}
	});
});

describe("Group 2: Block Data Integrity", () => {
	test("blocks have parseable JSON payloads in praxity-config", () => {
		for (const block of canonicalBlocks) {
			expect(
				block.type.length > 0,
				`${block.entryName} has block with missing data-block-type`,
			).toBe(true);
			if (!block.json) continue;
			expect(
				Object.keys(block.json).length > 0,
				`${block.entryName}:${block.type} has empty JSON payload`,
			).toBe(true);
			expect(block.json.type, `${block.entryName}:${block.type} missing JSON type`).toBeTruthy();
		}
	});

	test("interactive/dynamic block types exist in praxity-config blocks", () => {
		const requiredJsonTypes = [
			"accordion",
			"tabs",
			"assessment",
			"checklist",
			"chart",
			"signature",
		];
		for (const type of requiredJsonTypes) {
			for (const block of blocksByType(type)) {
				expect(
					block.json,
					`${block.entryName}:${type} missing config block payload`,
				).not.toBeNull();
			}
		}
	});

	test("heading blocks include semantic heading elements", () => {
		const blocks = blocksByType("heading");
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) {
			const heading = block.element.querySelector("h1, h2, h3, h4, h5, h6");
			expect(heading, `${block.entryName} heading block missing semantic h*`).not.toBeNull();
		}
	});

	test("image blocks require src and rendered alt attributes", () => {
		const blocks = blocksByType("image");
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) {
			const img = block.element.querySelector("img");
			expect(img, `${block.entryName} image block missing <img>`).not.toBeNull();
			expect(
				img?.getAttribute("src")?.trim().length,
				`${block.entryName} image missing src`,
			).toBeGreaterThan(0);
			expect(img?.hasAttribute("alt"), `${block.entryName} image missing alt/decorative`).toBe(
				true,
			);
		}
	});

	test("assessment blocks require assessmentType and response", () => {
		const blocks = blocksByTypeWithJson("assessment");
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) {
			const data = block.data ?? {};
			expect(
				hasNonEmptyString(data.assessmentType),
				`${block.entryName} assessment missing assessmentType`,
			).toBe(true);
			const hasUnifiedResponse = typeof data.response === "object" && data.response !== null;
			const hasLegacyResponsePayload =
				Array.isArray(data.options) ||
				Array.isArray(data.pairs) ||
				Array.isArray(data.items) ||
				Array.isArray(data.categories) ||
				Array.isArray(data.spots) ||
				typeof data.content === "string";
			expect(
				hasUnifiedResponse || hasLegacyResponsePayload,
				`${block.entryName} assessment missing response payload`,
			).toBe(true);
		}
	});

	test("note blocks render semantic aside with required attributes", () => {
		const blocks = blocksByType("note");
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) {
			const note = block.element.querySelector("aside.praxity-note-base");
			expect(note, `${block.entryName} note missing semantic aside`).not.toBeNull();
			expect(
				note?.getAttribute("data-color"),
				`${block.entryName} note missing color`,
			).toBeTruthy();
			expect(
				note?.getAttribute("data-style"),
				`${block.entryName} note missing style`,
			).toBeTruthy();
		}
	});

	test("accordion blocks require items array", () => {
		const blocks = blocksByTypeWithJson("accordion");
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) {
			const data = block.data ?? {};
			expect(Array.isArray(data.items), `${block.entryName} accordion missing items`).toBe(true);
		}
	});

	test("table blocks render semantic table structure", () => {
		const blocks = blocksByType("table");
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) {
			const table = block.element.querySelector("table");
			expect(table, `${block.entryName} table missing <table>`).not.toBeNull();
			expect(block.element.querySelectorAll("th[scope='col']").length).toBeGreaterThan(0);
		}
	});

	test("chart blocks require chart type and tabular/series data", () => {
		const blocks = blocksByTypeWithJson("chart");
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) {
			const data = block.data ?? {};
			expect(hasNonEmptyString(data.chartType), `${block.entryName} chart missing chartType`).toBe(
				true,
			);
			const hasHeadersRows = Array.isArray(data.headers) && Array.isArray(data.rows);
			const chartData = asRecord(data.data);
			const hasLabelsSeries = Array.isArray(chartData.labels) && Array.isArray(chartData.series);
			expect(
				hasHeadersRows || hasLabelsSeries,
				`${block.entryName} chart missing headers/rows or labels/series`,
			).toBe(true);
		}
	});

	test("button blocks require href", () => {
		const blocks = blocksByType("button");
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) {
			const link = block.element.querySelector("a.praxity-button");
			expect(link, `${block.entryName} button missing semantic <a>`).not.toBeNull();
			expect(
				hasNonEmptyString(link?.getAttribute("href")),
				`${block.entryName} button missing href`,
			).toBe(true);
		}
	});
});

describe("Group 3: Navigation & Config", () => {
	test("praxity-config parses as valid JSON on canonical pages that include it", () => {
		for (const page of canonicalPages) {
			if (page.document.getElementById("praxity-config")) {
				expect(() => parseConfig(page.document, page.entryName)).not.toThrow();
			}
		}
	});

	test("config.totalPages matches canonical HTML page count", () => {
		const totalPages = Number(primaryConfig.totalPages ?? 0);
		expect(Number.isFinite(totalPages) && totalPages > 0).toBe(true);
		expect(totalPages).toBe(canonicalPageEntries.length);
		const pages = Array.isArray(primaryConfig.pages) ? primaryConfig.pages : [];
		expect(totalPages).toBe(pages.length);
	});

	test("runtime JS filenames are consistent when present", () => {
		const islandLoaderScripts = new Set<string>();
		const courseShellScripts = new Set<string>();
		for (const { document } of canonicalPages) {
			const scriptSrcs = Array.from(document.querySelectorAll("script[src]")).map(
				(el) => el.getAttribute("src") ?? "",
			);
			const islandLoaderSrc = scriptSrcs.find((value) => ISLAND_LOADER_JS_RE.test(value));
			const courseShellSrc = scriptSrcs.find((value) => COURSE_SHELL_JS_RE.test(value));
			if (islandLoaderSrc) islandLoaderScripts.add(islandLoaderSrc);
			if (courseShellSrc) courseShellScripts.add(courseShellSrc);
		}
		expect(islandLoaderScripts.size).toBeLessThanOrEqual(1);
		expect(courseShellScripts.size).toBe(1);
	});

	test("all executable scripts are external and event handlers are absent", () => {
		for (const { document, entryName } of allHtmlPages) {
			for (const script of document.querySelectorAll("script:not([src])")) {
				expect(script.getAttribute("type"), `${entryName} contains inline executable script`).toBe(
					"application/json",
				);
			}
			for (const element of document.querySelectorAll("*")) {
				for (const attribute of element.getAttributeNames()) {
					expect(
						attribute.toLowerCase().startsWith("on"),
						`${entryName} contains ${attribute}`,
					).toBe(false);
				}
			}
		}
	});

	test("all page-N.html aliases exist for N=1..totalPages", () => {
		const totalPages = Number(primaryConfig.totalPages ?? 0);
		for (let index = 1; index <= totalPages; index++) {
			expect(htmlEntrySet.has(`page-${index}.html`), `missing page-${index}.html`).toBe(true);
		}
	});

	test("config page slugs map to existing HTML files", () => {
		const pages = Array.isArray(primaryConfig.pages) ? primaryConfig.pages : [];
		for (const page of pages) {
			const slug = asRecord(page).slug;
			expect(hasNonEmptyString(slug), "config page missing slug").toBe(true);
			if (hasNonEmptyString(slug)) {
				expect(htmlEntrySet.has(`${slug}.html`), `missing slug page file: ${slug}.html`).toBe(true);
			}
		}
	});
});

describe("Group 4: Accessibility Basics (static)", () => {
	test("all images have alt", () => {
		for (const { entryName, document } of canonicalPages) {
			for (const img of Array.from(document.querySelectorAll("img"))) {
				expect(img.hasAttribute("alt"), `${entryName} has <img> without alt`).toBe(true);
			}
		}
	});

	test("all external-tab links include rel=noopener", () => {
		for (const { entryName, document } of canonicalPages) {
			for (const anchor of Array.from(document.querySelectorAll('a[target="_blank"]'))) {
				const relTokens = (anchor.getAttribute("rel") ?? "")
					.toLowerCase()
					.split(/\s+/)
					.filter(Boolean);
				expect(
					relTokens.includes("noopener"),
					`${entryName} target=_blank link missing rel=noopener`,
				).toBe(true);
			}
		}
	});

	test("no element has tabindex > 0", () => {
		for (const { entryName, document } of canonicalPages) {
			for (const el of Array.from(document.querySelectorAll("[tabindex]"))) {
				const raw = el.getAttribute("tabindex");
				const value = raw == null ? 0 : Number.parseInt(raw, 10);
				expect(
					!Number.isFinite(value) || value <= 0,
					`${entryName} has positive tabindex: ${raw}`,
				).toBe(true);
			}
		}
	});

	test("aria-labelledby/aria-describedby/aria-controls references resolve to existing IDs", () => {
		const ariaAttrs = ["aria-labelledby", "aria-describedby", "aria-controls"];
		for (const { entryName, document } of canonicalPages) {
			for (const attr of ariaAttrs) {
				for (const el of Array.from(document.querySelectorAll(`[${attr}]`))) {
					const raw = el.getAttribute(attr) ?? "";
					const ids = raw.split(/\s+/).filter(Boolean);
					for (const id of ids) {
						expect(
							document.getElementById(id),
							`${entryName} has missing ${attr} target: ${id}`,
						).not.toBeNull();
					}
				}
			}
		}
	});
});

describe("Group 5: Grammar Leak Detection", () => {
	test("text blocks do not leak raw grammar syntax", () => {
		const grammarLeaks: Array<{ pattern: RegExp; label: string }> = [
			{
				pattern:
					/^\s*as:\s*(choice|button|note|order|match|free-response|fill-blank|embed|hotspot|categorize|rating|signature|checklist|accordion|tab|sequence|col|card|flashcard|comparison|bookmark)\b/m,
				label: "as: block modifier",
			},
			{
				pattern: /^\$\$/m,
				label: "LaTeX $$ delimiter",
			},
			{
				pattern: /^```[\w-]*/m,
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
				label: "hotspot spot: directive",
			},
			{
				pattern: /^var:\s+/m,
				label: "var: directive",
			},
			{
				pattern: /^when:\s+/m,
				label: "when: directive",
			},
			{
				pattern: /^then:\s+/m,
				label: "then: directive",
			},
			{
				pattern: /^close:\s+/m,
				label: "close: directive",
			},
			{
				pattern: /^\s*---\s*$/m,
				label: "page break delimiter ---",
			},
		];

		for (const block of blocksByType("text")) {
			const textNode = block.element.querySelector(".praxity-text");
			const content = textNode?.innerHTML ?? "";
			const plainText = content.replace(/<[^>]+>/g, "\n").replace(/&[^;]+;/g, " ");
			for (const { pattern, label } of grammarLeaks) {
				expect(
					pattern.test(plainText),
					`${block.entryName} text block contains raw grammar (${label}): "${plainText.trim().slice(0, 80)}"`,
				).toBe(false);
			}
		}
	});
});

describe("Group 6: Semantic Elements (post-SSR)", () => {
	test("heading blocks render semantic <h1>-<h6> elements", () => {
		const headings = canonicalPages.flatMap(({ document }) =>
			Array.from(
				document.querySelectorAll(
					'[data-block-type="heading"] h1, [data-block-type="heading"] h2, [data-block-type="heading"] h3, [data-block-type="heading"] h4, [data-block-type="heading"] h5, [data-block-type="heading"] h6',
				),
			),
		);
		expect(headings.length).toBeGreaterThan(0);
	});

	test("text blocks render semantic <p> elements", () => {
		const paragraphs = canonicalPages.flatMap(({ document }) =>
			Array.from(document.querySelectorAll('[data-block-type="text"] .praxity-text p')),
		);
		expect(paragraphs.length).toBeGreaterThan(0);
	});

	test("table blocks render semantic <table> with <th> cells", () => {
		const tables = canonicalPages.flatMap(({ document }) =>
			Array.from(document.querySelectorAll('[data-block-type="table"] table')),
		);
		expect(tables.length).toBeGreaterThan(0);
		for (const table of tables) {
			expect(table.querySelectorAll("th").length).toBeGreaterThan(0);
		}
	});

	test("note blocks render semantic <aside> elements", () => {
		const notes = canonicalPages.flatMap(({ document }) =>
			Array.from(document.querySelectorAll('[data-block-type="note"] aside.praxity-note-base')),
		);
		expect(notes.length).toBeGreaterThan(0);
	});

	test("quote blocks render semantic <blockquote> elements", () => {
		const quotes = canonicalPages.flatMap(({ document }) =>
			Array.from(document.querySelectorAll('[data-block-type="quote"] blockquote')),
		);
		expect(quotes.length).toBeGreaterThan(0);
	});

	test("assessment choice blocks render <fieldset> with <input> elements", () => {
		const fieldsets = canonicalPages
			.flatMap(({ document }) =>
				Array.from(document.querySelectorAll('[data-block-type="assessment"] form fieldset')),
			)
			.filter((fieldset) => fieldset.querySelector("input[type='radio'], input[type='checkbox']"));
		expect(fieldsets.length).toBeGreaterThan(0);
		for (const fieldset of fieldsets) {
			expect(
				fieldset.querySelectorAll("input[type='radio'], input[type='checkbox']").length,
			).toBeGreaterThan(0);
		}
	});
});
