import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeDialogueCast, readLesson, resolveDialogueSpeakers } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { normalizeRendererAssets } from "../scripts/update-page-compiler-baseline.mts";
import type { CourseExportInput } from "../src/build.ts";
import { generateHtmlPages } from "../src/html-pages.ts";
import { compileDocument, compilePage, renderNode } from "../src/preview/compile-page.ts";
import { createCourseContext, refreshCourseContext } from "../src/preview/course-context.ts";
import { stripChoiceStateFacts } from "./fixtures/choice-facts";
import { compilerFixture, compilerIslandAssets } from "./fixtures/page-compiler.ts";
import baseline from "./fixtures/page-compiler-baseline.json";

// Match the full-build baseline's normalization of generated bundle URLs.
const hash = (html: string) =>
	createHash("sha256")
		.update(normalizeRendererAssets(stripChoiceStateFacts(html)))
		.digest("hex");
async function fixture(name: "leadership" | "toolkit" | "comprehensive") {
	const input = {
		...(await compilerFixture(name)),
		htmlOutput: { islandAssets: compilerIslandAssets },
	};
	return { input, context: await createCourseContext(input) };
}

describe("P2 page compiler", () => {
	it("editor draft fragments resolve the group default in their page context", async () => {
		const q: PraxityBlock = {
			id: "q",
			type: "assessment",
			data: {
				assessmentType: "choice",
				gradingMode: "none",
				required: false,
				response: {
					type: "choice",
					selectionMode: "single",
					options: [
						{ id: "yes", label: "Yes", isCorrect: true },
						{ id: "no", label: "No" },
					],
				},
			},
		};
		const input: Parameters<typeof createCourseContext>[0] = {
			id: "preview",
			title: "Preview",
			sourceLocale: "en",
			htmlOutput: { islandAssets: compilerIslandAssets },
			content: [
				{
					id: "page",
					title: "Page",
					blocks: [
						{
							id: "group",
							type: "assessmentGroup",
							data: { memberBlockIds: ["q"], deckGate: "pass" },
						},
						q,
					],
				},
			],
		};
		const context = await createCourseContext(input);
		expect(renderNode(context, "page", "q").html).not.toContain("data-dont-know");
		for (const explicit of [undefined, true, false]) {
			const fragment = renderNode(context, "page", "q", {
				...q,
				data: { ...q.data, dontKnow: explicit },
			});
			expect(fragment.html.includes("data-dont-know")).toBe(explicit === true);
		}
	});
	it.each(["leadership", "toolkit", "comprehensive"] as const)(
		"preserves every %s body byte and standalone fragment",
		async (name) => {
			const { context } = await fixture(name);
			// Capture all standalone nodes before any page compile can populate the cache.
			const standalone = new Map(
				context.pages.map((page) => [
					page.id,
					new Map(
						page.blocks
							.filter((block) => block.type !== "pageBreak" && block.type !== "blockBreak")
							.map((block) => [block.id, renderNode(context, page.id, block.id)]),
					),
				]),
			);
			for (const page of context.pages) {
				const compiled = compilePage(context, page.id);
				const html = compiled.order.map((id) => compiled.fragments.get(id)?.html).join("\n");
				expect(hash(html), page.id).toBe(
					baseline[name].bodies[page.id as keyof (typeof baseline)[typeof name]["bodies"]],
				);
				expect(compiled.html).toBe(html);
				for (const fragment of compiled.fragments.values()) {
					if (fragment.kind === "node") {
						expect(
							standalone.get(page.id)?.get(fragment.id),
							`${name}/${fragment.id} standalone`,
						).toEqual(fragment);
						expect(renderNode(context, page.id, fragment.id)).toEqual(fragment);
					}
				}
			}
		},
	);
	it.each(["leadership", "toolkit", "comprehensive"] as const)(
		"preserves every %s document byte and published page",
		async (name) => {
			const { context } = await fixture(name);
			for (const doc of context.documents) {
				const compiled = compileDocument(context, doc.slug);
				expect(hash(compiled.html), doc.slug).toBe(
					baseline[name].documents[
						`${doc.slug}.html` as keyof (typeof baseline)[typeof name]["documents"]
					],
				);
			}
			const dir = await mkdtemp(join(tmpdir(), "p2-equivalence-"));
			try {
				await generateHtmlPages(
					{
						...context.normalizedCourse,
						brandLogo: context.desktopBrandLogo,
						pages: [...context.pages],
						totalPages: context.pages.length,
					},
					dir,
					compilerIslandAssets,
				);
				for (const doc of context.documents) {
					const published = await readFile(join(dir, `${doc.slug}.html`), "utf8");
					expect(compileDocument(context, doc.slug).html).toBe(published);
					for (const pageId of doc.pageIds) {
						const page = compilePage(context, pageId);
						expect(published, `${name}/${pageId}`).toContain(page.html);
					}
				}
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
	);

	it.each(["Glossary", "Resources", "Index", "Summary"])(
		"exports content titled %s alongside every utility document",
		async (title) => {
			const context = await createCourseContext({
				id: "collision",
				title: "Review",
				sourceLocale: "en",
				content: [
					{
						id: "p",
						title,
						blocks: [{ id: "node", type: "text", data: { content: "[cat]{A feline}" } }],
					},
				],
				resourceEntries: [
					{
						title: "Guide",
						description: "Guide",
						url: "https://example.com/guide.pdf",
						resourceType: "file",
					},
				],
				htmlOutput: { islandAssets: compilerIslandAssets },
			});
			const page = context.pages[0];
			const dir = await mkdtemp(join(tmpdir(), "p2-collision-"));
			try {
				await generateHtmlPages(
					{
						...context.normalizedCourse,
						brandLogo: context.desktopBrandLogo,
						pages: [...context.pages],
						totalPages: 1,
					},
					dir,
					compilerIslandAssets,
				);
				expect(page.documentSlug).not.toBe("glossary");
				expect(page.documentSlug).not.toBe("resources");
				expect(page.documentSlug).not.toBe("index");
				expect(context.documents.map((doc) => doc.kind)).toEqual(["page", "glossary", "resources"]);
				expect(await readFile(join(dir, `${page.documentSlug}.html`), "utf8")).toContain(
					compilePage(context, "p").html,
				);
				expect(await readFile(join(dir, "glossary.html"), "utf8")).toContain(
					'class="praxity-glossary-page"',
				);
				expect(await readFile(join(dir, "resources.html"), "utf8")).toContain("Guide");
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
	);

	it.each([
		["text", "Hello {{name}}."],
		["nested note", "::: note\nHello {{name}}.\n:::"],
		["table", "| Name | Value |\n| --- | --- |\n| User | {{name}} |"],
		[
			"display field",
			"::: table\n| Name | Value |\n| --- | --- |\n| User | Reader |\ncaption: Hello {{name}}\n:::",
		],
	])("invalidates a parsed %s variable mention after a cross-page edit", async (_kind, source) => {
		let id = 0;
		const parsed = readLesson(`# Reader\n\n${source}\n`, { ids: () => `reader-${id++}` });
		expect(parsed.hasErrors, JSON.stringify(parsed.errors)).toBe(false);
		const reader = { ...parsed.pages[0], id: "reader" };
		const definition = (value: string): CourseExportInput["content"][number] => ({
			id: "definition",
			title: "Definition",
			blocks: [
				{
					id: "var",
					type: "variable",
					data: { variableName: "name", dataType: "text", defaultValue: value },
				},
			],
		});
		const input: CourseExportInput = {
			id: "review",
			title: "Review",
			sourceLocale: "en",
			content: [definition("Alice"), reader],
		};
		const context = await createCourseContext(input);
		expect(compilePage(context, "reader").html).toContain('data-fallback="Alice">Alice');
		const updated = { ...input, content: [definition("Bob"), reader] };
		const next = await refreshCourseContext(context, updated, { lessons: ["definition"] });
		const fresh = await createCourseContext(updated);
		expect(compilePage(fresh, "reader").html).toContain('data-fallback="Bob">Bob');
		expect(compilePage(next, "reader").html).toBe(compilePage(fresh, "reader").html);
	});

	it("refreshes the glossary document without changing another page's inline definition", async () => {
		const input: CourseExportInput = {
			id: "terms",
			title: "Terms",
			sourceLocale: "en",
			content: [
				{
					id: "definition",
					title: "Definition",
					blocks: [{ id: "term", type: "text", data: { content: "[cat]{First definition}" } }],
				},
				{
					id: "reader",
					title: "Reader",
					blocks: [{ id: "inline", type: "text", data: { content: "[cat]{Local definition}" } }],
				},
			],
		};
		const context = await createCourseContext(input);
		const reader = compilePage(context, "reader");
		expect(compileDocument(context, "glossary").html).toContain("First definition");
		const updated = {
			...input,
			content: [
				{
					...input.content[0],
					blocks: [
						{ id: "term", type: "text" as const, data: { content: "[cat]{Updated definition}" } },
					],
				},
				input.content[1],
			],
		};
		const next = await refreshCourseContext(context, updated, { lessons: ["definition"] });
		expect(compileDocument(next, "glossary").html).toContain("Updated definition");
		expect(compilePage(next, "reader").fragments).toBe(reader.fragments);
		expect(compilePage(next, "reader").html).toContain("Local definition");
	});

	it("invalidates parsed dialogue fragments when their shared cast changes", async () => {
		const input = (name: string): CourseExportInput => {
			let id = 0;
			const parsed = readLesson(
				`---\ncast:\n  coach: {name: ${name}}\n---\n\n# Definition\n\nText.\n\n# Reader\n\n::: dialogue\n- coach: Hello\n:::\n`,
				{ ids: () => `cast-${id++}` },
			);
			expect(parsed.hasErrors, JSON.stringify(parsed.errors)).toBe(false);
			return {
				id: "cast",
				title: "Cast",
				sourceLocale: "en",
				content: parsed.pages.map((page) => ({
					...page,
					blocks: resolveDialogueSpeakers(
						page.blocks,
						normalizeDialogueCast(parsed.frontmatter.cast).cast,
					).blocks,
				})),
			};
		};
		const original = input("BeforeCoach");
		const context = await createCourseContext(original);
		const pageId = context.pages[1].id;
		expect(compilePage(context, pageId).html).toContain("BeforeCoach");
		const updated = input("AfterCoach");
		const next = await refreshCourseContext(context, updated, { manifest: true });
		const fresh = await createCourseContext(updated);
		expect(compilePage(next, pageId).html).toContain("AfterCoach");
		expect(compilePage(next, pageId).html).toBe(compilePage(fresh, pageId).html);
	});

	it("renders drafts with page facts and leaves the admitted page untouched", async () => {
		const { context, input } = await fixture("leadership");
		const page = context.pages.find((page) => page.blocks.some((block) => block.type === "text"));
		if (!page) throw new Error("Missing text fixture page");
		const block = page.blocks.find((block) => block.type === "text");
		if (!block) throw new Error("Missing text fixture node");
		const old = compilePage(context, page.id);
		const draft: PraxityBlock = {
			...block,
			data: { ...block.data, content: "<p>New <strong>draft</strong> words.</p>" },
		};
		const changed = {
			...input,
			content: input.content.map((p) =>
				p.id === page.id
					? { ...p, blocks: p.blocks.map((b) => (b.id === block.id ? draft : b)) }
					: p,
			),
		};
		const next = await refreshCourseContext(context, changed, {
			lessons: [page.lessonId ?? page.id],
		});
		expect(renderNode(context, page.id, block.id, draft).html).toContain(
			"New <strong>draft</strong> words.",
		);
		expect(renderNode(context, page.id, block.id, draft).html).toBe(
			compilePage(next, page.id).fragments.get(block.id)?.html,
		);
		expect(compilePage(context, page.id)).toBe(old);
		expect(renderNode(context, page.id, block.id).html).not.toContain("New");
		expect(() => renderNode(context, page.id, block.id, { ...draft, id: "wrong" })).toThrow(
			/identity/i,
		);
	});

	it("reuses unchanged module page fragments and advances their sequence", async () => {
		const { context, input } = await fixture("leadership");
		const before = context.pages.map((page) => compilePage(context, page.id));
		expect(compilePage(context, context.pages[0].id)).toBe(before[0]);
		const target = input.content[1];
		const next = await refreshCourseContext(
			context,
			{
				...input,
				content: input.content.map((page) =>
					page.id === target.id
						? {
								...page,
								blocks: [
									...page.blocks,
									{ id: "extra", type: "text", data: { content: "An edit." } },
								],
							}
						: page,
				),
			},
			{ lessons: [target.lessonId ?? target.id] },
		);
		for (const [index, page] of next.pages.entries()) {
			const after = compilePage(next, page.id);
			expect(after.seq).toBe(next.seq);
			if (page.id === target.id) expect(after.fragments).not.toBe(before[index].fragments);
			else expect(after.fragments).toBe(before[index].fragments);
		}
		const unchanged = await refreshCourseContext(
			next,
			{ ...input, content: next.normalizedCourse.content },
			{},
		);
		expect(compilePage(unchanged, target.id).fragments).toBe(
			compilePage(next, target.id).fragments,
		);
	});

	it("exposes deck outline, identity bar, glossary and page reading regions", async () => {
		const { context } = await fixture("leadership");
		const document = context.documents.find((doc) => doc.kind === "module");
		if (!document) throw new Error("Missing module fixture");
		const compiled = compileDocument(context, document.slug);
		expect(compiled.regions.has("region:deck-outline")).toBe(true);
		expect(compiled.regions.has("region:deck-top-bar")).toBe(true);
		expect(compiled.regions.has("region:deck-glossary-link")).toBe(true);
		for (const id of document.pageIds)
			expect(compiled.regions.get(`region:deck-reading:${id}`)?.html).toContain(
				`data-deck-reading="${id}"`,
			);
	});

	it.each([
		["en", "Error at line 3"],
		["fr-CA", "Erreur à la ligne 3"],
	])(
		"T5 renders an unresolved node with a compiler-owned message and source line in %s",
		async (locale, label) => {
			const parsed = readLesson("# Broken\n\n::: unknown <script>bad</script>\nBody\n:::\n", {
				ids: (() => {
					let id = 0;
					return () => `invalid-${id++}`;
				})(),
				formatMessage: () => "Unknown block <script>unsafe</script>",
			});
			const error = parsed.errors.find((error) => error.level === "error" && error.blockId);
			if (!error || error.line === undefined)
				throw new Error("Missing unresolved fixture diagnostic");
			const context = await createCourseContext({
				id: "invalid",
				title: "Invalid",
				sourceLocale: locale,
				content: parsed.pages,
				unresolvedNodes: new Map([[error.blockId, { code: "invalid-source", line: error.line }]]),
			});
			const page = context.pages.find((page) =>
				page.blocks.some((block) => block.id === error.blockId),
			);
			if (!page) throw new Error("Missing unresolved renderer node");
			const fragment = renderNode(context, page.id, error.blockId);
			expect(fragment.html).toContain("data-preview-error");
			expect(fragment.html).toContain('data-source-line="3"');
			expect(fragment.html).toContain(label);
			expect(fragment.html).toContain(
				locale === "en"
					? "This block contains invalid source."
					: "Ce bloc contient une source invalide.",
			);
			expect(fragment.html).not.toContain("unsafe");
			expect(fragment.html).not.toContain("<script>");
			expect(compilePage(context, page.id).fragments.get(error.blockId)).toEqual(fragment);
		},
	);

	it("keeps fragments on a theme refresh and invalidates them for frame settings", async () => {
		const { context, input } = await fixture("leadership");
		const page = context.pages[0];
		const before = compilePage(context, page.id);
		const theme = await refreshCourseContext(
			context,
			{ ...input, cssVars: { "--praxity-accent": "#225588" } },
			{ manifest: true },
		);
		expect(compilePage(theme, page.id).fragments).toBe(before.fragments);
		const frame = await refreshCourseContext(
			theme,
			{ ...input, slideStyles: { custom: { background: "surface" } } },
			{ manifest: true },
		);
		expect(compilePage(frame, page.id).fragments).not.toBe(before.fragments);
	});

	it("refuses an optimistic node requiring an unavailable enhancer", async () => {
		const context = await createCourseContext({
			id: "static",
			title: "Static",
			sourceLocale: "en",
			content: [
				{
					id: "page",
					title: "Page",
					data: { nav: "none", navKeyboardArrows: false },
					blocks: [{ id: "node", type: "text", data: { content: "Before" } }],
				},
			],
			htmlOutput: { islandAssets: { loaderFilename: "loader.js", islandFilenames: {} } },
		});
		expect(() =>
			renderNode(context, "page", "node", {
				id: "node",
				type: "button",
				data: { action: "goToPage", targetPageId: "another-page", text: "Next" },
			}),
		).toThrow(/nav/);
	});

	it("refuses unknown pages, nodes, documents and missing island assets", async () => {
		const { context } = await fixture("leadership");
		expect(() => compilePage(context, "missing")).toThrow(/Unknown/);
		expect(() => renderNode(context, context.pages[0].id, "missing")).toThrow(/Unknown/);
		expect(() => compileDocument(context, "missing")).toThrow(/Unknown/);
		expect(() => compilePage({ ...context, htmlOutput: {} }, context.pages[0].id)).toThrow(/asset/);
	});
});
