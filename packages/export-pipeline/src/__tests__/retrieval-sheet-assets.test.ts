import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type {
	PraxityBlock,
	PraxityPage,
	RetrievalSheetContent,
} from "@praxity/shared-blocks/types";
import { build } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fingerprintedStylesheetName } from "../build";
import {
	generateHtmlPage,
	type PageGenOptions,
	prepareHtmlCourse,
	renderHtmlDocument,
} from "../html-gen";
import { renderBlockHtml } from "../render-block-html";
import { getBlockIsland, planModuleRuntime, planPageRuntime } from "../runtime-plan";
import absent from "./fixtures/retrieval-sheet-absent.json";

const config = {
	id: "course",
	title: "Course",
	sourceLocale: "en",
	totalPages: 1,
	navigationStyle: "sidebar" as const,
	navToggles: { navTopBar: false, showA11yPill: false },
	pages: [] as PraxityPage[],
};
const sheetContent: RetrievalSheetContent = {
	title: "Recall",
	questions: [{ id: "q", question: "Question?", answer: "Answer." }],
};
const sheet: PraxityBlock = {
	id: "sheet",
	type: "retrievalSheet",
	data: { level: 2, content: sheetContent },
};
const page: PraxityPage = { id: "page", title: "Page", blocks: [] };
const options: PageGenOptions = {
	config,
	page,
	index: 0,
	currentSlug: "page",
	slugList: [{ pageId: "page", slug: "page", title: "Page" }],
	slugMap: new Map([["page", "page"]]),
	liteStylesheetFilename: "styles-lite.HASH.css",
};
let directory: string;
beforeAll(async () => {
	directory = await mkdtemp(path.join(tmpdir(), "retrieval-assets-"));
	await build({
		entryPoints: [
			path.resolve(import.meta.dirname, "../../template/src/islands/island-retrieval-sheet.ts"),
		],
		outfile: path.join(directory, "retrieval-sheet.js"),
		bundle: true,
		minify: true,
		platform: "browser",
		format: "esm",
	});
	await build({
		entryPoints: [path.resolve(import.meta.dirname, "../patterns/retrieval-sheet/style.css")],
		outfile: path.join(directory, "retrieval-sheet.css"),
		bundle: true,
		minify: true,
	});
});
afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

it("plans retrieval explicitly, including nested sheets and later module slides", () => {
	expect(getBlockIsland(sheet)).toBe("retrievalSheet");
	const nested: PraxityPage = {
		...page,
		blocks: [
			{
				id: "outer",
				type: "accordion",
				data: {
					items: [{ id: "panel", title: "Panel", children: [sheet] }],
				},
			},
		],
	};
	expect(planPageRuntime(config, nested, true).islands).toEqual(["accordion", "retrievalSheet"]);
	expect(
		planModuleRuntime(config, [page, { ...page, id: "later", blocks: [sheet] }], true, {}).islands,
	).toContain("retrievalSheet");
});

it("refuses missing sheet enhancer assets during planning", () => {
	expect(() => planPageRuntime(config, { ...page, blocks: [sheet] }, new Set())).toThrow(
		"Required island assets unavailable: retrievalSheet",
	);
});

it("adds exactly zero HTML bytes and no stylesheet on a page without a sheet", () => {
	const actual = generateHtmlPage({
		...options,
		retrievalSheetStylesheetFilename: "retrieval-sheet.HASH.css",
	});
	expect(Buffer.byteLength(actual)).toBe(absent.bytes);
	expect(createHash("sha256").update(actual).digest("hex")).toBe(absent.sha256);
	expect(actual).not.toContain("retrieval-sheet");
	expect(actual.match(/<link rel="stylesheet"[^>]+>/g)).toEqual([
		'<link rel="stylesheet" href="styles-lite.HASH.css" />',
	]);
});

it("emits a synchronous sheet link before shared and authored styles", () => {
	// The sheet stylesheet must arrive before shared and author styles.
	const runtimePlan = planPageRuntime(config, { ...page, blocks: [sheet] }, true);
	{
		const usedStylesheets = new Set<string>();
		const html = generateHtmlPage({
			...options,
			runtimePlan,
			usedStylesheets,
			retrievalSheetStylesheetFilename: "retrieval-sheet.HASH.css",
		});
		expect(html.match(/<link rel="stylesheet"[^>]+>/g)).toEqual([
			'<link rel="stylesheet" href="retrieval-sheet.HASH.css" />',
			'<link rel="stylesheet" href="styles-lite.HASH.css" />',
		]);
		expect(usedStylesheets).toEqual(new Set(["retrieval-sheet.HASH.css", "styles-lite.HASH.css"]));
		expect(() => generateHtmlPage({ ...options, runtimePlan })).toThrow(
			"Required retrieval-sheet stylesheet unavailable",
		);
	}
});

it("uses the existing fingerprint owner for shared and sheet styles", () => {
	const css = ".praxity-retrieval-sheet{min-width:0}";
	const expected = "bd098225d11d";
	expect(fingerprintedStylesheetName("retrieval-sheet.css", css)).toBe(
		`retrieval-sheet.${expected}.css`,
	);
	expect(fingerprintedStylesheetName("styles-lite.css", Buffer.from(css))).toBe(
		`styles-lite.${expected}.css`,
	);
});

it("preview defaults link an existing prepared stylesheet for the planned sheet", async () => {
	const prepared = prepareHtmlCourse({ ...config, pages: [{ ...page, blocks: [sheet] }] });
	const html = renderHtmlDocument(prepared, prepared.firstSlug, {}, (page) =>
		page.blocks.map((block) => renderBlockHtml(block)).join(""),
	);
	expect(html).toContain('<link rel="stylesheet" href="retrieval-sheet.css" />');
	expect(html).toContain("data-retrieval-sheet");
	expect(await readFile(path.join(directory, "retrieval-sheet.css"), "utf8")).toContain(
		".praxity-retrieval-sheet",
	);
});

it("two sheets share one link and a module places it before deck CSS", () => {
	const sheetPage = { ...page, blocks: [sheet, { ...sheet, id: "second" }] };
	for (const runtimePlan of [
		planPageRuntime(config, sheetPage, true),
		planModuleRuntime(config, [page, sheetPage], true),
	]) {
		const html = generateHtmlPage({
			...options,
			runtimePlan,
			deckStylesheets: { full: "styles-deck.css", lite: "styles-lite-deck.css" },
			retrievalSheetStylesheetFilename: "retrieval-sheet.HASH.css",
		});
		expect(html.match(/<link rel="stylesheet"[^>]+>/g)).toEqual([
			'<link rel="stylesheet" href="retrieval-sheet.HASH.css" />',
			`<link rel="stylesheet" href="${runtimePlan.presentation ? "styles-lite-deck.css" : "styles-lite.HASH.css"}" />`,
		]);
	}
});

it("publishes with a complete planned island and synchronous stylesheet", () => {
	const html = generateHtmlPage({
		...options,
		page: { ...page, blocks: [sheet] },
		runtimePlan: planPageRuntime(config, { ...page, blocks: [sheet] }, true),
		retrievalSheetStylesheetFilename: "retrieval-sheet.HASH.css",
	});
	expect(html).toContain('<link rel="stylesheet" href="retrieval-sheet.HASH.css" />');
	expect(html).toContain('data-retrieval-side="front"');
	expect(html).toContain('data-retrieval-side="back"');
});

// The independent R04 bundle keeps other pages out of this closure.
it("keeps the full sheet island below the 10 KiB lightweight allowance", async () => {
	const script = await readFile(path.join(directory, "retrieval-sheet.js"));
	expect(gzipSync(script).byteLength).toBeLessThanOrEqual(10 * 1024);
	expect(script.toString()).not.toMatch(
		/localStorage|sessionStorage|__praxityBlockState|__praxitySelfCheckDocument|\.cookie|indexedDB|history\.|location\.|LearnerBlockState/,
	);
});
