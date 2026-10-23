import { readFile } from "node:fs/promises";
import { readLesson, toModelParameter } from "@praxity/grammar";
import { BLOCK_SCHEMA } from "@praxity/grammar/src/v4/schema.ts";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import type { CourseExportInput } from "../src/build.ts";
import type { CourseConfig } from "../src/html-gen.ts";
import { compileDocument, compilePage, renderNode } from "../src/preview/compile-page.ts";
import {
	createCourseContext,
	createCourseContextFromHtml,
	refreshCourseContext,
} from "../src/preview/course-context.ts";
import { compilerIslandAssets } from "./fixtures/page-compiler.ts";
import { fixtureSelfCheckInputs } from "./fixtures/self-check.ts";

const htmlOutput = { islandAssets: compilerIslandAssets };

const prompt = { task: "Write an answer.", parts: [{ id: "part" }] };
const fullContent = {
	...prompt,
	model: "HIDDEN_MODEL",
	parts: [{ id: "part", label: "HIDDEN_LABEL", missed: "HIDDEN_HINT", evidence: null }],
};
const selfCheck = (content: unknown): PraxityBlock => ({
	id: "self-check",
	type: "selfCheck",
	data: { content, required: false, private: true },
});
const course = (
	blocks = [selfCheck(prompt)],
	selfCheckContents = fixtureSelfCheckInputs(blocks),
): CourseExportInput => ({
	selfCheckContents,
	id: "admission",
	title: "Admission",
	sourceLocale: "en",
	content: [{ id: "page", title: "Practice", blocks }],
});
const captured = (input: CourseExportInput): CourseConfig => ({
	...input,
	brandLogo: undefined,
	pages: input.content,
	totalPages: input.content.length,
});

type AdmissionEntry = "fresh" | "desktop" | "captured" | "refresh" | "draft";
const entries: AdmissionEntry[] = ["fresh", "desktop", "captured", "refresh", "draft"];
function nest(block: PraxityBlock, depth: number): PraxityBlock {
	if (depth && block.id === "self-check") block = { ...block, id: "nested-self-check" };
	for (let index = 0; index < depth; index++)
		block = {
			id: index === depth - 1 ? "self-check" : `container-${index}`,
			type: index % 2 ? "columns" : "tabs",
			data: { items: [{ id: `item-${index}`, label: "Public tab", children: [block] }] },
		};
	return block;
}
function replacePath(block: PraxityBlock, path: string[], value: unknown): PraxityBlock {
	let record = block as unknown as Record<string, unknown>;
	for (const key of path.slice(0, -1)) {
		if (!record[key]) record[key] = {};
		record = record[key] as Record<string, unknown>;
	}
	record[path.at(-1) as string] = value;
	return block;
}

// Grammar selects the setting slots to attack. Accepted paths below are independent literals.
const attackedPaths = [
	...Object.keys(BLOCK_SCHEMA["self-check"].settings).map((key) => [
		"data",
		toModelParameter("self-check", key, undefined).key,
	]),
	...["id", "name", "visible", "locale", "sectionTheme", "a11y", "layout"].map((key) => [key]),
	...["altText", "ariaLabel", "decorative"].map((key) => ["a11y", key]),
	...["width", "alignment"].map((key) => ["layout", key]),
	["data"],
	["data", "content"],
	["data", "content", "task"],
	["data", "content", "parts"],
	["data", "content", "parts", "0", "id"],
];
const generatedInvalid: {
	label: string;
	marker: string;
	path: string[];
	value: unknown;
	depth: number;
}[] = attackedPaths.flatMap((path, index) =>
	["object", "array", "Map", "Set", "null"].map((kind, variant) => {
		const marker = `HIDDEN_SLOT_${index}_${variant}`;
		const value =
			kind === "object"
				? { model: { hint: marker } }
				: kind === "array"
					? [{ model: marker }]
					: kind === "Map"
						? new Map([["model", marker]])
						: kind === "Set"
							? new Set([marker])
							: null;
		return { label: `${path.join(".")}/${kind}`, marker, path, value, depth: variant % 3 };
	}),
);
const unknownPaths = [
	[],
	["data"],
	["a11y"],
	["layout"],
	["data", "content"],
	["data", "content", "parts", "0"],
];
for (const [index, path] of unknownPaths.entries())
	generatedInvalid.push({
		label: `unknown-${index}`,
		marker: `HIDDEN_UNKNOWN_${index}`,
		path: [...path, `unknown${index}`],
		value: `HIDDEN_UNKNOWN_${index}`,
		depth: index % 3,
	});

// Wrong scalar types and constrained strings are specified independently of the constructor.
const invalidScalars: [string[], unknown][] = [
	[["data", "layoutMode"], 1],
	[["data", "entrance"], 1],
	[["data", "deckGate"], 1],
	[["data", "name"], 1],
	[["data", "visible"], true],
	[["data", "level"], true],
	[["data", "hide"], 1],
	[["data", "required"], 1],
	[["data", "private"], 1],
	[["id"], 1],
	[["name"], 1],
	[["visible"], "true"],
	[["locale"], 1],
	[["locale"], "See [HIDDEN_LOCALE_TERM]{HIDDEN_LOCALE_DEFINITION}"],
	[["locale"], "en-x-answer-is-paris"],
	[["locale"], "qaa-x-the-model-answer"],
	[["locale"], "fr-answer1-paris123"],
	[["locale"], "en-u-ca-gregory"],
	[["sectionTheme"], 1],
	[["a11y", "altText"], true],
	[["a11y", "ariaLabel"], 1],
	[["a11y", "decorative"], "false"],
	[["layout", "width"], 1],
	[["layout", "alignment"], true],
	[["data", "content", "task"], 1],
	[["data", "content", "parts", "0", "id"], true],
];
for (const [index, [path, value]] of invalidScalars.entries())
	generatedInvalid.push({
		label: `${path.join(".")}/invalid-scalar-${index}`,
		marker: `HIDDEN_SCALAR_${index}`,
		path,
		value,
		depth: index % 3,
	});

describe("constructed compiler self-check records", () => {
	it.each(["en", "fr-CA", "zh-Hant-TW", "es-419"])(
		"retains language, script and region locale %s",
		async (locale) => {
			const block = { ...selfCheck(prompt), locale };
			const context = await createCourseContext(course([block]));
			expect(context.pages[0].blocks[0].locale).toBe(locale);
		},
	);
	it.each(["full-content", "locale", "nonenumerable"])(
		"refuses malformed self-check %s in latest draft siblings",
		async (kind) => {
			const ordinary: PraxityBlock = {
				id: "ordinary",
				type: "text",
				data: { content: "Public text" },
			};
			const context = await createCourseContext(course([ordinary]));
			const invalid = selfCheck(kind === "full-content" ? fullContent : prompt);
			if (kind === "locale") invalid.locale = "See [HIDDEN_LOCALE_TERM]{HIDDEN_LOCALE_DEFINITION}";
			if (kind === "nonenumerable")
				Object.defineProperty(invalid.data, "model", { value: "HIDDEN_MODEL" });
			expect(() =>
				renderNode(context, "page", "ordinary", ordinary, [ordinary, nest(invalid, 2)]),
			).toThrowError(
				expect.objectContaining({
					code: "ESELFCHECKPROMPT",
					message: "Invalid self-check prompt data.",
				}),
			);
		},
	);
	it("validates self-check defaults used by latest draft siblings", async () => {
		const ordinary: PraxityBlock = {
			id: "ordinary",
			type: "text",
			data: { content: "Public text" },
		};
		const context = await createCourseContext({
			...course([ordinary]),
			componentDefaults: { "self-check": { points: 2 } },
		});
		expect(() =>
			renderNode(context, "page", "ordinary", ordinary, [ordinary, nest(selfCheck(prompt), 2)]),
		).toThrowError(
			expect.objectContaining({
				code: "ESELFCHECKPROMPT",
				message: "Invalid self-check prompt data.",
			}),
		);
	});
	it.each(entries)("ignores unused malformed self-check defaults through %s", async (entry) => {
		for (const setting of [
			"points: 2",
			"shuffle: true",
			"name: 1st",
			"visible: true",
			"deckGate: pass",
			"width: half",
		]) {
			const read = readLesson(
				`---\ntitle: Admission\nlang: en\ndesign:\n  componentDefaults:\n    self-check:\n      ${setting}\n---\n# Practice\nPlain text only.\n`,
				{ ids: (node, role) => `ordinary-${node.span.start}-${role ?? "block"}` },
			);
			const input = {
				...course(read.blocks),
				componentDefaults: read.frontmatter.design?.componentDefaults,
			} as CourseExportInput;
			const desktop = {
				courseId: "admission",
				locale: "en",
				viewerVersion: "test",
				blocks: read.blocks,
				frontmatter: read.frontmatter,
				config: { completionThreshold: 0.8 },
				resolvedAssets: new Map<string, Uint8Array>(),
			};
			const base =
				entry === "captured"
					? await createCourseContextFromHtml(captured(course(read.blocks)), htmlOutput)
					: await createCourseContext(
							entry === "desktop"
								? { ...desktop, frontmatter: { ...read.frontmatter, design: undefined } }
								: course(read.blocks),
						);
			if (entry === "draft") {
				base.normalizedCourse.componentDefaults = input.componentDefaults;
				const block = read.blocks.find((block) => block.type === "text") as PraxityBlock;
				const result = renderNode(base, "page", block.id, block);
				expect(result.html, setting).toContain("Plain text only.");
				continue;
			}
			const context =
				entry === "captured"
					? await createCourseContextFromHtml(captured(input), htmlOutput)
					: entry === "refresh"
						? await refreshCourseContext(base, input, { lessons: ["page"] })
						: entry === "desktop"
							? await createCourseContext(desktop)
							: await createCourseContext(input);
			expect(
				context.pages.flatMap((page) => page.blocks),
				setting,
			).toEqual(base.pages.flatMap((page) => page.blocks));
			expect(
				context.documents.map((document) => compileDocument(context, document.slug).html),
				setting,
			).toEqual(base.documents.map((document) => compileDocument(base, document.slug).html));
		}
	});
	it.each(["fresh", "captured", "refresh"] as const)(
		"retains closed scalar and metadata records through %s output",
		async (entry) => {
			const expected: PraxityBlock = {
				id: "self-check",
				type: "selfCheck",
				name: "practice",
				locale: "fr-CA",
				visible: true,
				sectionTheme: "warm",
				layout: { width: "half", alignment: "center" },
				a11y: { altText: "Public alternative", ariaLabel: "Public label", decorative: false },
				data: {
					content: { task: "Public task", parts: [{ id: "first" }, { id: "second" }] },
					level: 1,
					private: false,
					required: false,
					hide: false,
					layoutMode: "wide",
					visible: "passedQuiz",
					name: "dataName",
					entrance: "slide",
					deckGate: "attempt",
				},
			};
			const block = structuredClone(expected);
			block.data.level = "1";
			block.data.private = "false";
			const input = course([block]);
			const before = structuredClone(input);
			const context =
				entry === "captured"
					? await createCourseContextFromHtml(captured(input), htmlOutput)
					: entry === "refresh"
						? await refreshCourseContext(await createCourseContext(course()), input, {
								lessons: ["page"],
							})
						: await createCourseContext(input);
			expect(input).toEqual(before);
			expect(context.pages[0].blocks).toEqual([expected]);
			block.a11y = { ariaLabel: "HIDDEN_MUTATION" };
			block.data.content = fullContent;
			expect(context.pages[0].blocks).toEqual([expected]);
			expect(context.normalizedCourse.glossaryTerms).toEqual([]);
			let configs = 0;
			for (const document of context.documents) {
				const html = compileDocument(context, document.slug).html;
				expect(html).not.toContain("HIDDEN_");
				for (const match of html.matchAll(
					/<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/g,
				)) {
					const config = JSON.parse(match[1]);
					expect(JSON.stringify(config)).not.toContain("HIDDEN_");
					if (!config.blocks) continue;
					configs++;
					expect(config.blocks).toEqual([
						{
							id: "self-check",
							type: "selfCheck",
							name: "practice",
							locale: "fr-CA",
							visible: true,
							sectionTheme: "warm",
							layout: { width: "half", alignment: "center" },
							a11y: { altText: "Public alternative", ariaLabel: "Public label", decorative: false },
							data: {
								content: { task: "Public task", parts: [{ id: "first" }, { id: "second" }] },
								level: 1,
								private: false,
								required: false,
								hide: false,
								layoutMode: "wide",
								visible: "passedQuiz",
								name: "dataName",
								entrance: "slide",
								deckGate: "attempt",
							},
						},
					]);
				}
			}
			expect(configs).toBeGreaterThan(0);
		},
	);
	it.each([...entries, "siblings", "inserted"])(
		"refuses generated malformed slots through %s",
		async (entry) => {
			const base = await createCourseContext(course());
			const ordinary: PraxityBlock = {
				id: "ordinary",
				type: "text",
				data: { content: "Public text" },
			};
			const ordinaryBase = await createCourseContext(course([ordinary]));
			for (const { label, marker, path, value, depth } of generatedInvalid) {
				const block = nest(replacePath(selfCheck(structuredClone(prompt)), path, value), depth);
				const input = course([block]);
				const attempt = async () => {
					if (entry === "siblings")
						return renderNode(ordinaryBase, "page", "ordinary", ordinary, [ordinary, block]);
					if (entry === "inserted")
						return renderNode(ordinaryBase, "page", block.id, block, [ordinary, block]);
					if (entry === "captured") return createCourseContextFromHtml(captured(input), htmlOutput);
					if (entry === "draft") return renderNode(base, "page", "self-check", block);
					if (entry === "refresh") return refreshCourseContext(base, input, { lessons: ["page"] });
					if (entry === "desktop")
						return createCourseContext({
							courseId: "admission",
							locale: "en",
							viewerVersion: "test",
							blocks: [block],
							frontmatter: { title: "Admission", lang: "en" },
							config: { completionThreshold: 0.8 },
							resolvedAssets: new Map(),
						});
					return createCourseContext(input);
				};
				await expect(attempt(), label).rejects.toMatchObject({
					code: "ESELFCHECKPROMPT",
					message: "Invalid self-check prompt data.",
				});
				expect(marker).toMatch(/^HIDDEN_/);
			}
		},
	);

	it.each(entries)(
		"refuses both review rounds and malformed defaults through %s",
		async (entry) => {
			const base = await createCourseContext(course());
			const badBlocks = [
				selfCheck(fullContent),
				{ ...selfCheck(prompt), extra: "HIDDEN_BLOCK" },
				{ ...selfCheck(prompt), data: { content: prompt, hints: "HIDDEN_HINT" } },
				{ ...selfCheck(prompt), a11y: { ariaLabel: "Public label", model: "HIDDEN_A11Y" } },
				{ ...selfCheck(prompt), layout: { width: "full", model: "HIDDEN_LAYOUT" } },
				{ ...selfCheck(prompt), visible: "HIDDEN_VISIBLE" },
			];
			const defaults = [
				...Object.keys(BLOCK_SCHEMA["self-check"].settings).map((key) => ({
					[key]: { model: "HIDDEN_DEFAULT", hint: "[HIDDEN_TERM]{HIDDEN_DEF}" },
				})),
				{ layout: { model: "HIDDEN_ALIAS" }, width: "wide" },
				{ layoutMode: { model: "HIDDEN_ALIAS" }, width: "wide" },
				{ model: "HIDDEN_DEFAULT" },
				{ points: 2 },
				{ shuffle: true },
				{ name: "1st" },
				{ visible: true },
				{ deckGate: "pass" },
				{ width: "half" },
			];
			for (const depth of [0, 2]) {
				const payloads = [
					...badBlocks.map((block) => ({
						block: block as PraxityBlock,
						componentDefaults: undefined,
					})),
					...defaults.flatMap((settings) =>
						["selfCheck", "self-check"].map((key) => ({
							block: selfCheck(prompt),
							componentDefaults: { [key]: settings },
						})),
					),
				];
				for (const payload of payloads) {
					const block = nest(payload.block, depth);
					const input = { ...course([block]), componentDefaults: payload.componentDefaults };
					const attempt = async () => {
						if (entry === "captured")
							return createCourseContextFromHtml(captured(input), htmlOutput);
						if (entry === "draft") {
							base.normalizedCourse.componentDefaults = input.componentDefaults;
							return renderNode(base, "page", "self-check", block);
						}
						if (entry === "refresh")
							return refreshCourseContext(base, input, { lessons: ["page"] });
						if (entry === "desktop")
							return createCourseContext({
								courseId: "admission",
								locale: "en",
								viewerVersion: "test",
								blocks: [block],
								frontmatter: {
									title: "Admission",
									lang: "en",
									// Direct host input deliberately bypasses source validation.
									design: { componentDefaults: input.componentDefaults ?? {} } as never,
								},
								config: { completionThreshold: 0.8 },
								resolvedAssets: new Map(),
							});
						return createCourseContext(input);
					};
					await expect(
						attempt(),
						`${depth}/${JSON.stringify(payload.componentDefaults)}`,
					).rejects.toMatchObject({
						code: "ESELFCHECKPROMPT",
						message: "Invalid self-check prompt data.",
					});
				}
			}
		},
	);

	it.each(["fresh", "captured", "draft"] as const)(
		"gives ordinary clone failures their own code through %s",
		async (entry) => {
			const block: PraxityBlock = {
				id: "self-check",
				type: "text",
				data: { content: "Public text", callback: () => "HIDDEN_CALLBACK" },
			};
			const attempt = async () =>
				entry === "captured"
					? createCourseContextFromHtml(captured(course([block])), htmlOutput)
					: entry === "draft"
						? renderNode(await createCourseContext(course()), "page", "self-check", block)
						: createCourseContext(course([block]));
			await expect(attempt()).rejects.toMatchObject({
				code: "ECOMPILERCLONE",
				message: "Cannot capture compiler input.",
			});
		},
	);

	it.each(["en", "fr"])(
		"preserves literal %s reader records and sweeps every document",
		async (locale) => {
			const task = locale === "en" ? "Write an answer." : "Rédigez une réponse.";
			const read = readLesson(
				`---\nlang: ${locale}\n---\n# Practice\n::: self-check ${task} {name=practice width=wide hide entrance=fade required=false private=false deckGate=attempt visible=passedQuiz}\nmodel: HIDDEN_MODEL\n:: HIDDEN_LABEL\nmissed: HIDDEN_HINT\n:::\n`,
				{
					ids: (node, role) =>
						role
							? `role-${node.span.start}-${role}`
							: node.type === "self-check"
								? "self-check"
								: node.kind === "item"
									? "part"
									: `node-${node.span.start}`,
				},
			);
			// Stable fixture allocation must distinguish the item from its parent.
			expect(read.blocks.filter((block) => block.type === "selfCheck")).toHaveLength(1);
			const block = read.blocks.find((block) => block.type === "selfCheck");
			if (!block) throw new Error("Missing fixture self-check.");
			const expected = {
				id: "self-check",
				type: "selfCheck",
				name: "practice",
				data: {
					level: 2,
					content: { task, parts: [{ id: "part" }] },
					layoutMode: "wide",
					hide: true,
					entrance: "fade",
					required: false,
					private: false,
					deckGate: "attempt",
					visible: "passedQuiz",
				},
			};
			expect(block).toEqual(expected);
			const input = {
				...course([block]),
				sourceLocale: locale,
				componentDefaults: { selfCheck: { required: true, private: true, width: "narrow" } },
			};
			const before = structuredClone(input);
			const fresh = await createCourseContext(input);
			expect(input).toEqual(before);
			input.content[0].blocks[0].data.content = fullContent;
			for (const context of [
				fresh,
				await createCourseContextFromHtml(
					captured({
						...fresh.normalizedCourse,
						content: fresh.normalizedCourse.content,
						selfCheckContents: input.selfCheckContents,
					}),
					htmlOutput,
				),
			]) {
				expect(context.pages[0].blocks).toEqual([expected]);
				expect(context.normalizedCourse.glossaryTerms).toEqual([]);
				for (const document of context.documents) {
					const html = compileDocument(context, document.slug).html;
					expect(html).not.toContain("HIDDEN_");
					for (const match of html.matchAll(
						/<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/g,
					)) {
						const config = JSON.parse(match[1]);
						expect(JSON.stringify(config)).not.toContain("HIDDEN_");
						if (config.blocks)
							expect(config.blocks).toEqual([
								{
									id: "self-check",
									type: "selfCheck",
									name: "practice",
									data: {
										content: { task, parts: [{ id: "part" }] },
										level: 2,
										layoutMode: "wide",
										hide: true,
										entrance: "fade",
										required: false,
										private: false,
										deckGate: "attempt",
										visible: "passedQuiz",
									},
								},
							]);
					}
				}
			}
			expect(before.content[0].blocks[0]).toEqual(expected);
		},
	);
});

describe("compiler self-check admission", () => {
	it("does not expose the unadmitted HTML renderer as a package entry", async () => {
		const manifest = JSON.parse(
			await readFile(new URL("../package.json", import.meta.url), "utf8"),
		);
		expect(manifest.exports).not.toHaveProperty("./html-gen");
	});

	it.each(["fresh", "captured", "draft"] as const)(
		"refuses extra fields in %s output",
		async (entry) => {
			for (const block of [
				{ ...selfCheck(prompt), data: { content: prompt, hints: "[HIDDEN_TERM]{HIDDEN_HINT}" } },
				{ ...selfCheck(prompt), extra: "HIDDEN_BLOCK_MODEL" },
			]) {
				const input = course([block]);
				let output = "";
				const attempt = async () => {
					const context =
						entry === "captured"
							? await createCourseContextFromHtml(captured(input), htmlOutput)
							: await createCourseContext(entry === "draft" ? course() : input);
					if (entry === "draft") output += renderNode(context, "page", "self-check", block).html;
					output += compileDocument(context, "practice").html;
					if (context.documents.some((document) => document.slug === "glossary"))
						output += compileDocument(context, "glossary").html;
				};
				await expect(attempt()).rejects.toMatchObject({ code: "ESELFCHECKPROMPT" });
				expect(output).not.toContain("HIDDEN");
			}
		},
	);

	it.each(["fresh", "draft"] as const)(
		"refuses componentDefaults injection after %s adaptation",
		async (entry) => {
			const input = {
				...course(),
				componentDefaults: {
					selfCheck: { model: "HIDDEN_DEFAULTS_MODEL", hints: "[HIDDEN_TERM]{HIDDEN_HINT}" },
				},
			};
			let output = "";
			const attempt = async () => {
				const context = await createCourseContext(entry === "draft" ? course() : input);
				if (entry === "draft") {
					context.normalizedCourse.componentDefaults = input.componentDefaults;
					output += renderNode(context, "page", "self-check", selfCheck(prompt)).html;
				}
				output += compileDocument(context, "practice").html;
				if (context.documents.some((document) => document.slug === "glossary"))
					output += compileDocument(context, "glossary").html;
				return context;
			};
			await expect(attempt()).rejects.toMatchObject({ code: "ESELFCHECKPROMPT" });
			expect(output).not.toContain("HIDDEN");
		},
	);

	it.each(["fresh", "captured", "draft"] as const)(
		"admits the cloned block type in a %s context",
		async (entry) => {
			let reads = 0;
			const block = {
				...selfCheck(prompt),
				get type() {
					return ++reads === 1 ? "divider" : "selfCheck";
				},
			} as PraxityBlock;
			const input = course([block]);
			const attempt = async () => {
				const context =
					entry === "captured"
						? await createCourseContextFromHtml(captured(input), htmlOutput)
						: await createCourseContext(entry === "draft" ? course() : input);
				if (entry === "draft") return renderNode(context, "page", "self-check", block).html;
				expect(context.pages[0].blocks[0].type).toBe("divider");
				return compileDocument(context, "practice").html;
			};
			expect(await attempt()).not.toContain("HIDDEN");
			expect(reads).toBe(1);
		},
	);

	it.each(["fresh", "captured", "draft"] as const)(
		"codes clone errors at the %s entry",
		async (entry) => {
			const block = new Proxy(selfCheck(prompt), {});
			const attempt = async () => {
				if (entry === "captured")
					return createCourseContextFromHtml(captured(course([block])), htmlOutput);
				if (entry === "fresh") return createCourseContext(course([block]));
				return renderNode(await createCourseContext(course()), "page", "self-check", block);
			};
			await expect(attempt()).rejects.toMatchObject({
				code: "ECOMPILERCLONE",
				message: "Cannot capture compiler input.",
			});
		},
	);

	it.each([false, true])(
		"refuses non-index properties on criterion arrays with a gap=%s",
		async (gap) => {
			const parts = Object.assign([{ id: "part" }], { model: "HIDDEN_ARRAY_MODEL" });
			if (gap) parts.length = 2;
			await expect(
				createCourseContext(course([selfCheck({ ...prompt, parts })])),
			).rejects.toMatchObject({ code: "ESELFCHECKPROMPT" });
		},
	);

	it.each(["Map", "Set"] as const)(
		"refuses hidden self-check content inside a %s",
		async (kind) => {
			const nested =
				kind === "Map"
					? new Map([["activity", selfCheck(fullContent)]])
					: new Set([selfCheck(fullContent)]);
			await expect(
				createCourseContext(
					course([{ id: "text", type: "text", data: { content: "Public text.", nested } }]),
				),
			).rejects.toMatchObject({ code: "ESELFCHECKPROMPT" });
		},
	);

	it.each(["fresh", "captured", "draft"] as const)(
		"renders the admitted snapshot of a task getter at the %s entry",
		async (entry) => {
			let reads = 0;
			const block = selfCheck({
				get task() {
					return ++reads === 1 ? "Write an answer." : "HIDDEN_MODEL";
				},
				parts: [{ id: "part" }],
			});
			const context =
				entry === "captured"
					? await createCourseContextFromHtml(
							captured(course([block], fixtureSelfCheckInputs([selfCheck(prompt)]))),
							htmlOutput,
						)
					: await createCourseContext(
							entry === "draft"
								? course()
								: course([block], fixtureSelfCheckInputs([selfCheck(prompt)])),
						);
			const html =
				entry === "draft"
					? renderNode(context, "page", "self-check", block).html
					: compileDocument(context, "practice").html;
			expect(html).toContain("Write an answer.");
			expect(html).not.toContain("HIDDEN");
			expect(reads).toBe(1);
		},
	);
	it.each([
		["full content", fullContent],
		["extra criterion field", { ...prompt, parts: [{ id: "part", label: "HIDDEN_LABEL" }] }],
		["extra context", { ...prompt, context: { placeholder: "HIDDEN_HINT" } }],
		["missing task", { parts: [{ id: "part" }] }],
		["invalid task", { ...prompt, task: 1 }],
		["empty parts", { ...prompt, parts: [] }],
		["missing criterion ID", { ...prompt, parts: [{}] }],
		["invalid criterion ID", { ...prompt, parts: [{ id: 1 }] }],
		["null content", null],
		[
			"nonenumerable extra model",
			Object.defineProperty({ ...prompt }, "model", { value: "HIDDEN_MODEL" }),
		],
		[
			"inherited task with extra model",
			Object.assign(Object.create({ task: "Write an answer." }), {
				parts: [{ id: "part" }],
				model: "HIDDEN_MODEL",
			}),
		],
		[
			"inherited criterion ID with extra label",
			{
				...prompt,
				parts: [Object.assign(Object.create({ id: "part" }), { label: "HIDDEN_LABEL" })],
			},
		],
	])("refuses %s before fresh context preparation", async (_name, content) => {
		await expect(createCourseContext(course([selfCheck(content)]))).rejects.toMatchObject({
			code: "ESELFCHECKPROMPT",
			message: "Invalid self-check prompt data.",
		});
	});

	it.each(
		["fresh", "captured"].flatMap((entry) =>
			["columns", "tabs"].map((type) => [entry, type] as const),
		),
	)("refuses nested full content in a %s context inside %s", async (entry, type) => {
		const input = course([
			{
				id: "column",
				type: type as "columns" | "tabs",
				data: { items: [{ id: "column-item", children: [selfCheck(fullContent)] }] },
			},
		]);
		await expect(
			entry === "captured"
				? createCourseContextFromHtml(captured(input), htmlOutput)
				: createCourseContext(input),
		).rejects.toMatchObject({
			code: "ESELFCHECKPROMPT",
			message: "Invalid self-check prompt data.",
		});
	});

	it("refuses full content introduced by a draft substitution", async () => {
		const context = await createCourseContext(course());
		expect(() => renderNode(context, "page", "self-check", selfCheck(fullContent))).toThrowError(
			expect.objectContaining({
				code: "ESELFCHECKPROMPT",
				message: "Invalid self-check prompt data.",
			}),
		);
		expect(renderNode(context, "page", "self-check", selfCheck(prompt)).html).toContain(
			"Write an answer.",
		);
	});

	it("captures admitted pages before a host can replace their self-check content", async () => {
		const config = captured(course());
		const pending = createCourseContextFromHtml(config, htmlOutput);
		config.pages[0].blocks[0].data.content = fullContent;
		const context = await pending;
		expect(context.pages[0].blocks[0].data.content).toEqual({
			task: "Write an answer.",
			parts: [{ id: "part" }],
		});
		expect(JSON.stringify(context.normalizedCourse)).not.toContain("HIDDEN");
		config.pages[0].blocks[0].data.content = { ...prompt, task: "HIDDEN_MODEL" };
		expect(compilePage(context, "page").html).toContain("Write an answer.");
		expect(compilePage(context, "page").html).not.toContain("HIDDEN");
	});

	it("refuses full content during context refresh", async () => {
		const context = await createCourseContext(course());
		await expect(
			refreshCourseContext(context, course([selfCheck(fullContent)]), { lessons: ["page"] }),
		).rejects.toMatchObject({ code: "ESELFCHECKPROMPT" });
	});

	it.each(["fresh", "captured", "refresh"] as const)(
		"derives glossary terms from admitted content in a %s context",
		async (entry) => {
			// Old host records may carry derived terms even after the input field is removed.
			const input = {
				...course([
					selfCheck(prompt),
					{
						id: "text",
						type: "text",
						data: { content: "Read [PUBLIC_TERM]{Public definition.}." },
					},
				]),
				glossaryTerms: [
					{
						term: "HIDDEN_LABEL",
						definition: "HIDDEN_HINT",
						lessonTitle: "Practice",
						lessonSlug: "practice",
					},
				],
			};
			const context =
				entry === "captured"
					? await createCourseContextFromHtml(captured(input), htmlOutput)
					: entry === "refresh"
						? await refreshCourseContext(await createCourseContext(course()), input, {
								lessons: ["page"],
							})
						: await createCourseContext(input);
			expect(context.normalizedCourse.glossaryTerms).toEqual([
				{
					term: "PUBLIC_TERM",
					definition: "Public definition.",
					lessonTitle: "Practice",
					lessonSlug: "practice",
				},
			]);
			const html = compileDocument(context, "glossary").html;
			expect(html).toContain("PUBLIC_TERM");
			expect(html).not.toMatch(/HIDDEN_LABEL|HIDDEN_HINT/);
			expect(JSON.stringify(context.slices["glossary.terms"])).not.toContain("HIDDEN");
		},
	);

	it.each([true, false])("discards stale glossary records when enabled=%s", async (enabled) => {
		const input = {
			...course(),
			glossaryTabEnabled: enabled,
			glossaryTerms: [
				{
					term: "HIDDEN_LABEL",
					definition: "HIDDEN_HINT",
					lessonTitle: "Practice",
					lessonSlug: "practice",
				},
			],
		};
		for (const context of [
			await createCourseContext(input),
			await createCourseContextFromHtml(captured(input), htmlOutput),
		]) {
			expect(context.normalizedCourse.glossaryTerms).toEqual([]);
			expect(context.documents.some((document) => document.kind === "glossary")).toBe(false);
			expect(compileDocument(context, "practice").html).not.toMatch(/HIDDEN_LABEL|HIDDEN_HINT/);
		}
	});
});

describe("compiler unresolved-node admission", () => {
	it.each([
		{ message: 'Source says "HIDDEN_MODEL"', line: 3 },
		{ code: "invalid-source", message: 'Source says "HIDDEN_HINT"', line: 3 },
		{ code: "HIDDEN_LABEL", line: 3 },
		{ code: "invalid-source", line: 0 },
		Object.defineProperty({ code: "invalid-source", line: 3 }, "message", {
			value: "HIDDEN_MODEL",
		}),
	])("refuses unowned diagnostic data %j", async (diagnostic) => {
		await expect(
			createCourseContext({
				...course(),
				// Deliberately model a host still passing source-quoting diagnostics.
				unresolvedNodes: new Map([["self-check", diagnostic]]) as never,
			}),
		).rejects.toMatchObject({
			code: "EUNRESOLVEDNODE",
			message: "Invalid unresolved node diagnostic.",
		});
	});

	it.each([
		["en", "This block contains invalid source."],
		["fr-CA", "Ce bloc contient une source invalide."],
	])("renders compiler-owned diagnostic text in %s", async (locale, message) => {
		const context = await createCourseContext({
			...course(),
			sourceLocale: locale,
			unresolvedNodes: new Map([["self-check", { code: "invalid-source", line: 3 }]]),
		});
		const html = compilePage(context, "page").html;
		expect(html).toContain(message);
		expect(html).toContain('data-source-line="3"');
	});
});
