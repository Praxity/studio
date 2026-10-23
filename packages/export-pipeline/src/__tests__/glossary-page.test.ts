import { readLesson } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { prepareInlineBlocks } from "@praxity/shared-blocks/inline-markdown";
import { describe, expect, it } from "vitest";
import { collectGlossaryTerms, generateGlossaryPageHtml } from "../glossary-page";

describe("generateGlossaryPageHtml", () => {
	it("generates a glossary page with terms sorted A-Z", () => {
		const html = generateGlossaryPageHtml({
			terms: [
				{
					term: "Zebra crossing",
					definition: "<p>A pedestrian crossing</p>",
					lessonTitle: "Lesson 2",
					lessonSlug: "page-2",
				},
				{
					term: "Apple",
					definition: "<p>A fruit</p>",
					lessonTitle: "Lesson 1",
					lessonSlug: "page-1",
				},
			],
		});
		expect(html).not.toContain("<h1");
		expect(html).toContain("<dt");
		expect(html).toContain("Apple");
		expect(html).toContain("Zebra crossing");
		const applePos = html.indexOf("Apple");
		const zebraPos = html.indexOf("Zebra crossing");
		expect(applePos).toBeLessThan(zebraPos);
	});

	it("uses dl/dt/dd semantic structure", () => {
		const html = generateGlossaryPageHtml({
			terms: [{ term: "Term", definition: "<p>Def</p>", lessonTitle: "L1", lessonSlug: "page-1" }],
		});
		expect(html).toContain("<dl");
		expect(html).toContain("<dt");
		expect(html).toContain("<dd");
	});

	it("does not include first-mention link text or class", () => {
		const html = generateGlossaryPageHtml({
			terms: [
				{ term: "Term", definition: "<p>Def</p>", lessonTitle: "Lesson 1", lessonSlug: "page-1" },
			],
		});
		expect(html).not.toContain("First used in");
		expect(html).not.toContain("praxity-glossary-first-mention");
		expect(html).not.toContain('href="page-1.html"');
	});

	it("returns empty string when no terms", () => {
		const html = generateGlossaryPageHtml({ terms: [] });
		expect(html).toBe("");
	});

	it("sanitizes definition HTML", () => {
		const html = generateGlossaryPageHtml({
			terms: [
				{
					term: "XSS",
					definition: '<p>Safe <script>alert("xss")</script></p>',
					lessonTitle: "L1",
					lessonSlug: "page-1",
				},
			],
		});
		expect(html).not.toContain("<script>");
	});
});

describe("collectGlossaryTerms", () => {
	const page = (id: string, title: string, blocks: unknown) => ({ id, title, blocks });

	it.each<[string, string, Array<{ term: string; definition: string }>]>([
		[
			"matching prompt and answer",
			"::: match Q\n- [Prompt]{Prompt definition} -> [Answer]{Answer definition}\n- Plain -> Other\n:::\n",
			[
				{ term: "Prompt", definition: "Prompt definition" },
				{ term: "Answer", definition: "Answer definition" },
			],
		],
		[
			"matching prompt with literal inline code",
			"::: match Q\n- `[Code]{Code definition}` and [Prompt]{Prompt definition} -> [Answer]{Answer definition}\n- Plain -> Other\n:::\n",
			[
				{ term: "Prompt", definition: "Prompt definition" },
				{ term: "Answer", definition: "Answer definition" },
			],
		],
		[
			"ordering labels",
			"::: order Q\n1. [First]{First definition}\n2. [Second]{Second definition}\n:::\n",
			[
				{ term: "First", definition: "First definition" },
				{ term: "Second", definition: "Second definition" },
			],
		],
		[
			"categorization items",
			"::: categorize Q\n:: Group\n- [Categorized]{Categorized definition}\n:: Other\n- Plain\n:::\n",
			[{ term: "Categorized", definition: "Categorized definition" }],
		],
		[
			"rating label",
			"::: rating [Rating]{Rating definition}\n1. Low\n5. High\n:::\n",
			[{ term: "Rating", definition: "Rating definition" }],
		],
		[
			"matrix statement",
			"::: matrix Q\n1. Low\n2. High\n- [Statement]{Statement definition}\n:::\n",
			[{ term: "Statement", definition: "Statement definition" }],
		],
		[
			"raw accordion label with noninteractive display HTML",
			"::: accordion\n:: [Accordion]{Accordion definition}\nBody.\n:::\n",
			[{ term: "Accordion", definition: "Accordion definition" }],
		],
		[
			"raw tab label with noninteractive display HTML",
			"::: tabs\n:: [Tab]{Tab definition}\nBody.\n:::\n",
			[{ term: "Tab", definition: "Tab definition" }],
		],
		[
			"raw choice label with noninteractive display HTML",
			"::: choice Q\n(x) [Choice]{Choice definition}\n( ) Other\n:::\n",
			[{ term: "Choice", definition: "Choice definition" }],
		],
		[
			"matrix statement with literal inline code",
			"::: matrix Q\n1. Low\n2. High\n- `[Code]{Code definition}` and [Statement]{Statement definition}\n:::\n",
			[{ term: "Statement", definition: "Statement definition" }],
		],
	])("collects prepared %s through course preparation", (_name, source, expected) => {
		const read = readLesson(`# Practice\n${source}`);
		expect(read.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
		const pages = read.pages.map((page) => ({
			...page,
			blocks: prepareInlineBlocks(
				adaptGrammarPreviewBlocks(page.blocks, undefined, page.locale ?? read.frontmatter.lang),
			),
		}));
		expect(collectGlossaryTerms(pages)).toEqual(
			expected.map((term) => ({
				...term,
				lessonTitle: "Practice",
				lessonSlug: "practice",
			})),
		);
	});

	it.each([
		"Write [Task]{Task definition} here.",
		'Write <span data-tooltip-content="HTML definition">HTML task</span> here.',
	])(
		"keeps a nested self-check task literal while collecting surrounding rich text: %s",
		(task) => {
			const lesson = readLesson(
				`# Practice\n::: accordion\n:: [Panel]{Panel definition}\nBefore [Rich]{Rich definition}.\n::: self-check ${task}\nmodel: [Model]{Model definition}\n:: [Label]{Label definition}\nmissed: [Hint]{Hint definition}\n:::\nAfter [Later]{Later definition}.\n:::\n`,
			);
			expect(collectGlossaryTerms(lesson.pages)).toEqual([
				{
					term: "Panel",
					definition: "Panel definition",
					lessonTitle: "Practice",
					lessonSlug: "practice",
				},
				{
					term: "Rich",
					definition: "Rich definition",
					lessonTitle: "Practice",
					lessonSlug: "practice",
				},
				{
					term: "Later",
					definition: "Later definition",
					lessonTitle: "Practice",
					lessonSlug: "practice",
				},
			]);
		},
	);

	it("does not interpret glossary syntax or HTML in literal code and equations", () => {
		expect(
			collectGlossaryTerms([
				page("p", "Literal", [
					{ id: "code", type: "code", data: { code: "[Code]{Code definition}" } },
					{
						id: "equation",
						type: "equation",
						data: { latex: '<span data-tooltip-content="Equation definition">Equation</span>' },
					},
				]),
			]),
		).toEqual([]);
	});

	it("does not reparse glossary syntax in rendered inline code", () => {
		expect(
			collectGlossaryTerms(readLesson("# Literal\nRead `[Code]{Code definition}`.\n").pages),
		).toEqual([]);
	});

	it.each(["`<code>` [Term]{Definition}", "<strong>Title</strong> [Term]{Definition}"])(
		"collects real terms beside HTML-looking raw card labels: %s",
		(label) => {
			const lesson = readLesson(`# Practice\n::: cards\n:: ${label}\nBody.\n:::\n`);
			expect(collectGlossaryTerms(lesson.pages)).toEqual([
				{
					term: "Term",
					definition: "Definition",
					lessonTitle: "Practice",
					lessonSlug: "practice",
				},
			]);
		},
	);

	it("keeps prepared inline code literal beside a real term", () => {
		const lesson = readLesson(
			"# Practice\nRead `[Code]{Code definition}` and [Term]{Definition}.\n",
		);
		expect(collectGlossaryTerms(lesson.pages)).toEqual([
			{
				term: "Term",
				definition: "Definition",
				lessonTitle: "Practice",
				lessonSlug: "practice",
			},
		]);
	});

	it("does not reparse inline code in prepared display fields", () => {
		expect(
			collectGlossaryTerms([
				page("p", "Practice", [
					{
						id: "card",
						type: "card",
						data: {
							_inline: {
								title:
									'<code>[Code]{Code definition}</code> and <span data-tooltip-content="Definition">Term</span>',
							},
						},
					},
				]),
			]),
		).toEqual([
			{
				term: "Term",
				definition: "Definition",
				lessonTitle: "Practice",
				lessonSlug: "practice",
			},
		]);
	});

	it.each([
		[{ id: "text", type: "text", data: { content: "[Term]{Definition}" } }],
		"[Term]{Definition}",
		'<p><code>[Code]{Code definition}</code> and <span data-tooltip-content="Definition">Term</span></p>',
	])("keeps legacy raw content and bare HTML collection working: %j", (blocks) => {
		expect(collectGlossaryTerms([page("p", "Practice", blocks)])).toEqual([
			{ term: "Term", definition: "Definition", lessonTitle: "Practice", lessonSlug: "practice" },
		]);
	});

	it("collects tooltips from nested block data and dedupes case-insensitively", () => {
		const terms = collectGlossaryTerms([
			page("p1", "Safety Basics", [
				{
					id: "t1",
					type: "text",
					data: {
						content:
							'<p>Wear <span class="inline-tooltip-trigger" data-tooltip-content="Personal Protective Equipment">PPE</span> at all times.</p>',
					},
				},
				{
					id: "c1",
					type: "columns",
					data: {
						items: [
							{
								children: [
									{
										id: "t2",
										type: "text",
										data: {
											content:
												'<p><span data-tooltip-content="Occupational Health and Safety">OHS</span></p>',
										},
									},
								],
							},
						],
					},
				},
			]),
			page("p2", "Review", [
				{
					id: "t3",
					type: "text",
					data: {
						content: '<p><span data-tooltip-content="A later duplicate">ppe</span></p>',
					},
				},
			]),
		]);

		expect(terms).toEqual([
			{
				term: "PPE",
				definition: "Personal Protective Equipment",
				lessonTitle: "Safety Basics",
				lessonSlug: "safety-basics",
			},
			{
				term: "OHS",
				definition: "Occupational Health and Safety",
				lessonTitle: "Safety Basics",
				lessonSlug: "safety-basics",
			},
		]);
	});

	it("returns nothing when no tooltips are authored", () => {
		expect(
			collectGlossaryTerms([
				page("p1", "Plain", [{ id: "t", type: "text", data: { content: "<p>Hi</p>" } }]),
			]),
		).toEqual([]);
	});

	it("collects glossary syntax from a raw card title", () => {
		expect(
			collectGlossaryTerms([
				page("p1", "Standards", [
					{
						id: "cards",
						type: "card",
						data: {
							items: [
								{
									label: "[Lens stability]{Protection from unwanted vibration}",
								},
							],
						},
					},
				]),
			]),
		).toEqual([
			{
				term: "Lens stability",
				definition: "Protection from unwanted vibration",
				lessonTitle: "Standards",
				lessonSlug: "standards",
			},
		]);
	});
});
