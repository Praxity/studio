import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";

/**
 * Deterministic path for the pre-built fixture zip.
 * Written by vitest.global-setup.ts, read by each worker.
 */
export const PUBLISHED_FIXTURE_PATH = path.join(tmpdir(), "praxity-vitest-published-fixture.zip");

export const AUTHORING_CATALOG_PATH = path.join(tmpdir(), "praxity-vitest-authoring-catalog.zip");

export interface ParsedPage {
	entryName: string;
	dom: JSDOM;
	document: Document;
}

export interface ParsedBlock {
	entryName: string;
	type: string;
	id: string;
	element: Element;
	json: Record<string, unknown> | null;
	data: Record<string, unknown> | null;
}

export interface BuildResult {
	pages: ParsedPage[];
	blocks: ParsedBlock[];
	configByEntry: Map<string, Record<string, unknown>>;
	zip: AdmZip;
}

export function stylesheetEntry(zip: AdmZip, lite = false): string {
	const pattern = lite ? /^styles-lite\.[a-f0-9]{12}\.css$/ : /^styles\.[a-f0-9]{12}\.css$/;
	const entry = zip.getEntries().find((candidate) => pattern.test(candidate.entryName));
	if (!entry) throw new Error(`Missing ${lite ? "lite " : ""}stylesheet`);
	return entry.entryName;
}

const cached = new Map<string, BuildResult>();

/**
 * Load the pre-built comprehensive grammar fixture from disk.
 * The globalSetup writes the zip once; each Vitest worker reads it.
 * Falls back to building in-process if the cached file is missing.
 */
export async function getBuild(catalog = false): Promise<BuildResult> {
	const fixturePath = catalog ? AUTHORING_CATALOG_PATH : PUBLISHED_FIXTURE_PATH;
	const previous = cached.get(fixturePath);
	if (previous) return previous;

	let zip: AdmZip;
	if (existsSync(fixturePath)) {
		zip = new AdmZip(readFileSync(fixturePath));
	} else {
		// Fallback: build in-process (slower, but works if globalSetup didn't run)
		const { loadGrammarFixture, loadAuthoringCatalogFixture } = await import(
			"../fixtures/load-grammar-fixture"
		);
		const { buildScormPackage } = await import("../../src/build");
		const { course, buildOptions } = await (catalog
			? loadAuthoringCatalogFixture()
			: loadGrammarFixture());
		const result = await buildScormPackage(course, { ...buildOptions, format: "html" });
		zip = new AdmZip(result.zip);
	}

	const htmlEntries = zip
		.getEntries()
		.map((e) => e.entryName)
		.filter((name) => name.endsWith(".html") && name !== "index.html");

	const pages: ParsedPage[] = htmlEntries.map((entryName) => {
		const dom = new JSDOM(zip.readAsText(entryName), { url: `https://praxity.test/${entryName}` });
		return { entryName, dom, document: dom.window.document };
	});

	const configByEntry = new Map<string, Record<string, unknown>>();
	const blocks: ParsedBlock[] = [];

	for (const page of pages) {
		const configEl = page.document.getElementById("praxity-config");
		let config: Record<string, unknown> = {};
		if (configEl?.textContent) {
			try {
				config = JSON.parse(configEl.textContent) as Record<string, unknown>;
			} catch {}
		}
		if (Object.keys(config).length > 0) {
			configByEntry.set(page.entryName, config);
		}

		const configBlocks = Array.isArray(config.blocks)
			? new Map(
					(config.blocks as Array<{ id?: string }>)
						.filter((b) => typeof b.id === "string")
						.map((b) => [b.id as string, b as Record<string, unknown>]),
				)
			: new Map<string, Record<string, unknown>>();

		for (const el of page.document.querySelectorAll("[data-block-type]")) {
			const type = el.getAttribute("data-block-type") ?? "";
			const id = el.getAttribute("data-block-id") ?? "";
			const jsonEntry = configBlocks.get(id) ?? null;
			blocks.push({
				entryName: page.entryName,
				type,
				id,
				element: el,
				json: jsonEntry,
				data:
					jsonEntry && typeof jsonEntry.data === "object"
						? (jsonEntry.data as Record<string, unknown>)
						: null,
			});
		}
	}

	const result = { pages, blocks, configByEntry, zip };
	cached.set(fixturePath, result);
	return result;
}

/** Find all blocks of a given type across all pages. */
export function blocksByType(blocks: ParsedBlock[], type: string): ParsedBlock[] {
	return blocks.filter((b) => b.type === type);
}

/** Find the first block of a given type. */
export function firstBlock(blocks: ParsedBlock[], type: string): ParsedBlock | undefined {
	return blocks.find((b) => b.type === type);
}
