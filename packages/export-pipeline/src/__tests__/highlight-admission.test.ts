import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLesson } from "@praxity/grammar";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	buildScormPackage,
	type CourseExportInput,
	compileCourse,
	deployCourse,
	preparePublicationContext,
} from "../build";
import {
	assertPracticeLogic,
	generateHtmlPage,
	prepareHtmlCourse,
	renderPageFragments,
} from "../html-gen";
import { validateModuleDeck } from "../module-deck";
import { renderNode } from "../preview/compile-page";
import { createCourseContext, createCourseContextFromHtml } from "../preview/course-context";

const highlight: PraxityBlock = {
	id: "highlight-id",
	name: "mark",
	type: "highlight",
	data: {
		level: 2,
		hide: true,
		content: {
			mode: "key",
			title: "Title",
			paragraphs: [[{ id: "chunk", text: "Target", key: true }]],
		},
	},
};
const outer: PraxityBlock = {
	id: "outer-id",
	name: "outer",
	type: "accordion",
	data: { hide: true, items: [{ id: "panel", children: [highlight] }] },
};
const pages = (extra: PraxityBlock[] = []): PraxityPage[] => [
	{ id: "page", title: "P", blocks: [outer, ...extra] },
];
const rule = (data: Record<string, unknown>): PraxityBlock => ({ id: "rule", type: "logic", data });
const course = (content = pages()): CourseExportInput => ({
	id: "course",
	title: "C",
	sourceLocale: "en",
	content,
});

it.each(["mark", "@mark", "highlight-id", "@highlight-id"])(
	"refuses compiled condition alias %s",
	(ref) => {
		for (const field of ["answer", "score", "isCompleted", "isAttempted", "anything"])
			expect(() =>
				assertPracticeLogic(
					pages([rule({ conditions: { rules: [{ source: `block:${ref}`, field }] } })]),
				),
			).toThrowError(
				expect.objectContaining({
					code: "practice-no-tracking",
					blockId: "rule",
					referencePath: "pages[0].blocks[1].data.conditions.rules[0].source",
				}),
			);
	},
);
it.each(["mark", "@mark", "highlight-id", "outer", "@outer-id"])(
	"refuses require aliases %s",
	(ref) => {
		for (const action of [
			{ type: "require", targets: [ref] },
			{ type: "requireCompletion", target: ref },
		])
			expect(() => assertPracticeLogic(pages([rule({ actions: [action] })]))).toThrowError(
				expect.objectContaining({ code: "practice-no-tracking", blockId: "rule" }),
			);
	},
);
it.each(["required", "deckGate", "_deckGate"])("refuses own and ancestor %s", (key) => {
	for (const block of [highlight, outer]) {
		const input = [
			{
				id: "page",
				title: "P",
				blocks: [
					{ ...block, data: { ...block.data, [key]: key === "required" ? true : "attempt" } },
				],
			},
		];
		expect(() => assertPracticeLogic(input)).toThrowError(
			expect.objectContaining({
				code: "practice-no-tracking",
				blockId: block.id,
				referencePath: `pages[0].blocks[0].data.${key}`,
			}),
		);
	}
});
it.each([
	{ visible: "@mark.answer is true" },
	{ operand: { ref: "block:mark", field: "answer" } },
	{
		conditions: {
			operator: "and",
			rules: [{ source: "variable:flag" }, { source: "block:mark", field: "anything" }],
		},
	},
	{
		conditions: {
			operator: "or",
			rules: [{ source: "variable:flag" }, { source: "block:mark", field: "score" }],
		},
	},
	{ content: '<span data-mention="blockOutput:mark:score"></span>' },
])("refuses compiled reference operand %#", (data) => {
	expect(() => assertPracticeLogic(pages([rule(data)]))).toThrowError(
		expect.objectContaining({ code: "practice-no-tracking", blockId: "rule" }),
	);
});
it("cannot shadow practice names with public definitions", () => {
	const ordinary: PraxityBlock = {
		id: "public",
		name: "mark",
		type: "text",
		data: { content: "Public" },
	};
	expect(() =>
		assertPracticeLogic([
			{
				id: "page",
				title: "P",
				blocks: [ordinary, highlight, rule({ operand: { ref: "block:mark", field: "answer" } })],
			},
		]),
	).toThrowError(expect.objectContaining({ code: "practice-no-tracking" }));
});
it.each(["highlight-id", "outer-id"])(
	"refuses group membership and effective deck gates for %s",
	(id) => {
		const group: PraxityBlock = {
			id: "group",
			type: "assessmentGroup",
			data: { memberBlockIds: [id] },
		};
		expect(() => assertPracticeLogic(pages([group]))).toThrowError(
			expect.objectContaining({
				code: "practice-no-tracking",
				blockId: "group",
				referencePath: "pages[0].blocks[1].data.memberBlockIds[0]",
			}),
		);
		expect(() => validateModuleDeck({ gates: { [id]: "attempt" } }, pages(), "fr")).toThrowError(
			expect.objectContaining({
				code: "practice-no-tracking",
				blockId: id,
				referencePath: `moduleDeck.gates.${id}`,
			}),
		);
	},
);
it("admits public show/hide, optional module deck and literal reference spellings", () => {
	expect(() => validateModuleDeck({}, pages())).not.toThrow();
	const literal = {
		...highlight,
		data: {
			...highlight.data,
			content: {
				mode: "key",
				title: '<span data-mention="blockOutput:mark:score"></span>',
				question: "block:mark",
				paragraphs: [
					[
						{
							id: "chunk",
							text: "{{flag}} @icon{star}",
							key: true,
							note: '<span data-mention="blockOutput:mark:answer"></span>',
						},
					],
				],
			},
		},
	};
	expect(() =>
		assertPracticeLogic([
			{
				id: "page",
				title: "P",
				blocks: [
					literal,
					rule({
						conditions: { rules: [{ source: "variable:flag" }] },
						actions: [
							{ type: "show", targets: ["mark"] },
							{ type: "hide", targets: ["outer"] },
						],
					}),
				],
			},
		]),
	).not.toThrow();
});
it("admits raw page APIs including override HTML and hidden nested fragments", () => {
	const config = { id: "course", title: "C", sourceLocale: "en", totalPages: 1, pages: pages() };
	const prepared = prepareHtmlCourse(config);
	expect(prepared.config.pages).toEqual(config.pages);
	const fragments = renderPageFragments(config, config.pages[0], new Set());
	const html = fragments.map((fragment) => fragment.html).join("");
	expect(html).toContain("data-highlight-fallback");
	expect(html).toContain("Target");
	expect(
		generateHtmlPage({
			page: config.pages[0],
			config,
			index: 0,
			currentSlug: "page",
			slugList: [],
			slugMap: new Map(),
			overrideBodyHtml: "PREBUILT",
			highlightStylesheetFilename: "highlight.css",
			islandAssets: {
				loaderFilename: "loader.js",
				islandFilenames: { accordion: "accordion.js", highlight: "highlight.js", nav: "nav.js" },
			},
		}),
	).toContain("PREBUILT");
});
it.each(["en", "fr-CA"])("admits source and compiled context APIs in %s", async (locale) => {
	const input = { ...course(), sourceLocale: locale };
	for (const run of [
		() => createCourseContext(input),
		() => preparePublicationContext(input),
		() =>
			createCourseContextFromHtml(
				{ id: "course", title: "C", sourceLocale: locale, pages: input.content, totalPages: 1 },
				{
					islandAssets: {
						loaderFilename: "loader.js",
						islandFilenames: {
							accordion: "accordion.js",
							highlight: "highlight.js",
							nav: "nav.js",
						},
					},
				},
			),
	]) {
		const context = await run();
		expect(context.pages.map((page) => page.id)).toEqual(["page"]);
		const html = renderNode(context, "page", "outer-id").html;
		expect(html).toContain("data-highlight-fallback");
		expect(html).toContain("Target");
	}
	const read = readLesson("# P\n::: highlight Title\n:: Target {key}\n:::\n");
	const compiled = await compileCourse(course(read.pages), {});
	try {
		expect(compiled.manifest.pages).toHaveLength(1);
	} finally {
		await compiled.dispose();
	}
});
let scratch: string;
beforeAll(async () => {
	scratch = await mkdtemp(
		join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "highlight-publication-"),
	);
});
afterAll(async () => {
	await rm(scratch, { recursive: true });
});
it.each(["html", "scorm12", "scorm2004", "xapi"] as const)(
	"publishes real %s packages and removes temporary staging",
	async (format) => {
		const result = await buildScormPackage(
			course([
				{
					id: "page",
					title: "P",
					blocks: [{ ...highlight, data: { ...highlight.data, hide: false } }],
				},
			]),
			{ format, temporaryRoot: scratch },
		);
		const zip = new AdmZip(result.zip);
		const html = zip
			.getEntries()
			.filter((e) => e.entryName.endsWith(".html"))
			.map((e) => zip.readAsText(e))
			.join("");
		expect(html).toContain("data-highlight");
		expect(html).toContain("Target");
		expect(zip.getEntries().some((e) => /island-highlight/.test(e.entryName))).toBe(true);
		expect(await readdir(scratch)).toEqual([]);
	},
);

it("renders substituted preview drafts while refusing practice reference operands", async () => {
	const context = await createCourseContext(
		course([
			{
				id: "page",
				title: "P",
				blocks: [{ id: "highlight-id", type: "text", data: { content: "Placeholder" } }],
			},
		]),
	);
	expect(renderNode(context, "page", "highlight-id", highlight).html).toContain("data-highlight");
	expect(() =>
		renderNode(context, "page", "highlight-id", highlight, [
			highlight,
			rule({ operand: { ref: "block:mark", field: "answer" } }),
		]),
	).toThrowError(
		expect.objectContaining({
			code: "practice-no-tracking",
			blockId: "rule",
			referencePath: "pages[0].blocks[1].data.operand.ref",
		}),
	);
});
it.each([
	["accordion", { items: [{ blocks: [highlight] }] }],
	["tabs", { items: [{ blocks: [highlight] }] }],
	["sequence", { items: [{ blocks: [highlight] }] }],
	["columns", { columns: [{ blocks: [highlight] }] }],
	["card", { frontBlocks: [highlight], backBlocks: [] }],
	["card", { frontBlocks: [], backBlocks: [highlight] }],
] as const)(
	"admits compiled optional %s with %j and refuses its nested field reads",
	(type, data) => {
		const container: PraxityBlock = { id: "container", type, data };
		expect(() =>
			assertPracticeLogic([{ id: "page", title: "P", blocks: [container] }]),
		).not.toThrow();
		expect(() =>
			assertPracticeLogic([
				{
					id: "page",
					title: "P",
					blocks: [container, rule({ operand: { ref: "block:mark", field: "answer" } })],
				},
			]),
		).toThrowError(expect.objectContaining({ code: "practice-no-tracking", blockId: "rule" }));
	},
);

it.each(["divider", "highlight"] as const)(
	"captures a changing type getter once, first %s, before publication",
	async (firstType) => {
		let reads = 0;
		const dynamic = {
			...highlight,
			data: { ...highlight.data, hide: false },
			get type() {
				reads++;
				return reads === 1 ? firstType : firstType === "divider" ? "highlight" : "divider";
			},
		};
		const input = course([{ id: "page", title: "P", blocks: [dynamic] }]);
		const compiled = await compileCourse(input, { temporaryRoot: scratch });
		expect(compiled.manifest.pages).toHaveLength(1);
		const zip = new AdmZip((await deployCourse(compiled, { format: "html" })).zip);
		const html = zip
			.getEntries()
			.filter((e) => e.entryName.endsWith(".html"))
			.map((e) => zip.readAsText(e))
			.join("");
		if (firstType === "highlight") expect(html).toContain("data-highlight-fallback");
		else expect(html).not.toContain("data-highlight-fallback");
		await compiled.dispose();
		expect(reads).toBe(1);
		expect(await readdir(scratch)).toEqual([]);
	},
);

for (const api of ["prepareHtmlCourse", "overrideBodyHtml"] as const)
	it.each([
		{
			content: {
				mode: "key",
				title: "PRIVATE-TITLE",
				paragraphs: [[{ id: "PRIVATE-BAD ID", text: "PRIVATE-TEXT", key: true }]],
			},
		},
		{
			content: {
				mode: "key",
				title: "PRIVATE-TITLE",
				paragraphs: [[{ id: "target", text: "PRIVATE-TEXT", key: true }]],
				"PRIVATE-FIELD": "PRIVATE-VALUE",
			},
		},
		null,
	])(`guards malformed nested highlight on ${api} publication path: %j`, (data) => {
		const nested = { ...highlight, id: "malformed", data } as unknown as PraxityBlock;
		const config = {
			id: "course",
			title: "C",
			sourceLocale: "fr",
			totalPages: 1,
			pages: [
				{
					id: "page",
					title: "P",
					blocks: [{ ...outer, data: { items: [{ id: "panel", blocks: [nested] }] } }],
				},
			],
		};
		const run =
			api === "prepareHtmlCourse"
				? () => prepareHtmlCourse(config)
				: () =>
						generateHtmlPage({
							page: config.pages[0],
							config,
							index: 0,
							currentSlug: "page",
							slugList: [],
							slugMap: new Map(),
							overrideBodyHtml: "PREBUILT",
						});
		let error: unknown;
		try {
			run();
		} catch (caught) {
			error = caught;
		}
		expect(error).toMatchObject({
			name: "PracticeAdmissionError",
			code: "highlight-invalid",
			blockId: "malformed",
			referencePath: "pages[0].blocks[0].data.items[0].blocks[0].data",
			message:
				"La bibliothèque de surlignage refuse ce contenu. Vérifiez les passages, les cibles et les explications.",
			messageRef: { key: "grammar.v4.highlight-invalid" },
		});
		expect(String(error) + JSON.stringify(error)).not.toContain("PRIVATE-");
		expect(error).not.toHaveProperty("line");
		expect(error).not.toHaveProperty("column");
	});
