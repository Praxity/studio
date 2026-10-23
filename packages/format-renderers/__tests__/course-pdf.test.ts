import { readFileSync } from "node:fs";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { describe, expect, it, vi } from "vitest";
import { readLessonFixture as readBlockSource } from "../../grammar/__tests__/helpers/lesson-fixture.ts";
import {
	buildCoursePdfSource,
	CoursePdfError,
	type CoursePdfOptions,
	exportCoursePdf,
} from "../src/pipelines/course-pdf.ts";
import { compileTypstNative as compileTypst } from "../src/pipelines/typst-native-compiler.ts";

vi.mock("../src/pipelines/typst-native-compiler.ts", () => ({
	compileTypstNative: vi.fn(async () => Buffer.from("%PDF-test")),
}));

const workbookFixture = readFileSync(
	new URL("./fixtures/course-workbook.prax", import.meta.url),
	"utf8",
);

function course(source = workbookFixture): CoursePdfOptions {
	return {
		title: "Course workbook",
		locale: "en",
		lessons: [
			{ id: "lesson-en", title: "Practice", locale: "en", blocks: readBlockSource(source).blocks },
		],
	};
}

function withBlocks(
	blocks: CoursePdfOptions["lessons"][number]["blocks"],
	pageData?: Record<string, unknown>,
): CoursePdfOptions {
	return {
		title: "Workbook",
		locale: "en",
		lessons: [
			{
				id: "lesson",
				title: "Lesson",
				locale: "en",
				blocks: pageData
					? [{ id: "boundary", type: "pageBreak", data: { id: "page", ...pageData } }, ...blocks]
					: blocks,
			},
		],
	};
}

describe("course PDF workbook", () => {
	it.each([false, true])(
		"exports marked matching and rating blocks with answers=%s",
		async (includeAnswerSheet) => {
			const input = course(
				"# Practice {hideTitle}\n\n::: match Match controls\n- **Hazard** -> **Control**\nfeedback: MATCHRATIONALE\n- Risk -> Mitigation\n:::\n\n::: rating Rate confidence\n1. **Low**\n2. **High**\n:::\n",
			);
			const matching = input.lessons[0].blocks.find((block) => block.type === "assessment");
			if (!matching) throw new Error("Matching fixture did not parse.");
			expect((matching.data.response as { pairs: unknown[] }).pairs[0]).toHaveProperty(
				"_htmlFields",
				["prompt", "correctMatch"],
			);
			expect(input.lessons[0].blocks.find((block) => block.type === "rating")?.data).toHaveProperty(
				"_htmlFields",
				["label"],
			);
			const options = { ...input, includeAnswerSheet };
			const prepared = buildCoursePdfSource(options);
			expect(prepared.questionCount).toBe(2);
			for (const label of ["Hazard", "Control", "Rate confidence", "Low", "High"])
				expect(prepared.typstSource).toContain(label);
			expect(prepared.typstSource.includes("MATCHRATIONALE")).toBe(includeAnswerSheet);
			expect(prepared.typstSource).not.toContain("_htmlFields");
			const exported = await exportCoursePdf({ ...options, executablePath: "/bundled/typst" });
			expect(exported.pdf.toString()).toBe("%PDF-test");
			expect(exported.questionCount).toBe(2);
		},
	);
	it("still refuses unknown assessment fields beside projection metadata", () => {
		const input = course("# Practice\n\n::: match Match\n- Hazard -> Control\n:::\n");
		const matching = input.lessons[0].blocks.find((block) => block.type === "assessment");
		if (!matching) throw new Error("Matching fixture did not parse.");
		const pair = (matching.data.response as { pairs: Record<string, unknown>[] }).pairs[0];
		pair._unknown = true;
		expect(() => buildCoursePdfSource(input)).toThrow(
			"Unsupported PDF assessment field: _unknown.",
		);
	});
	it("prints promoted feedback once when its HTML record has projection metadata", () => {
		const input = course(
			"# Practice {hideTitle}\n\n::: choice Pick\n(x) First\nfeedback: PROMOTEDRATIONALE\n( ) Second\n:::\n",
		);
		const question = input.lessons[0].blocks.find((block) => block.type === "assessment");
		if (!question) throw new Error("Choice fixture did not parse.");
		const feedback = question.data.feedback as {
			correct: Array<{ data: Record<string, unknown> }>;
		};
		feedback.correct[0].data._htmlFields = ["content"];
		const result = buildCoursePdfSource({ ...input, includeAnswerSheet: true });
		expect(result.typstSource.match(/PROMOTEDRATIONALE/g)).toHaveLength(1);
	});
	it.each([false, true])("print resolves the module deck default when enabled=%s", (enabled) => {
		const input = course("# Practice\n\n::: choice Pick {required}\n(x) First\n( ) Last\n:::\n");
		input.lessons[0].moduleDeck = enabled ? {} : undefined;
		expect(buildCoursePdfSource(input).typstSource.includes("I don't know")).toBe(!enabled);
	});
	it("uses French separators for generated hints, speakers and group scoring labels", () => {
		const input = course(
			"---\n{ cast: { roxanne: {} } }\n---\n\n# Practice group {hideTitle}\n\n::: group Practice group {mode=all pointsOverride=2 passingScore=80}\n::: free-response Journal prompt\nplaceholder: Mes trois actions\n:::\n:::\n\n::: dialogue\n- roxanne: Quand je parle.\n:::\n",
		);
		input.locale = "fr-CA";
		input.lessons[0].locale = "fr-CA";
		const result = buildCoursePdfSource(input).typstSource;
		expect(result).toContain("Indice\u202f: Mes trois actions");
		expect(result).toContain("roxanne\u202f:");
		expect(result).toContain("Points\u202f: 2");
		expect(result).toContain("Seuil de réussite\u202f: 80");
	});
	it("prints mode-less journal groups with both prompts and answer lines, without scoring", () => {
		const input = course(
			"# Weekly journal {hideTitle}\n\n::: group Weekly journal\nbutton: Save responses\n::: free-response First journal prompt\n:::\n::: free-response Second journal prompt\n:::\n:::\n",
		);
		const result = buildCoursePdfSource(input);
		expect(result.typstSource).toContain("Weekly journal");
		expect(result.typstSource).toContain(
			"#text(size: 1.15em)[#text(font: px-body-font)[Weekly journal]]",
		);
		expect(result.typstSource).toContain("First journal prompt");
		expect(result.typstSource).toContain("Second journal prompt");
		expect(result.typstSource.match(/range\(3\)\.map\(_ => line\(length: 100%/g)).toHaveLength(2);
		expect(result.typstSource).not.toContain("Answer all questions in this group.");
		expect(result.typstSource).not.toContain("Pass threshold:");
	});

	it.each(["unknown", "journal"])("rejects an unknown non-empty group mode %s by name", (mode) => {
		const input = withBlocks([
			{ id: "group", type: "assessmentGroup", data: { groupName: "Journal", mode } },
		]);
		expect(() => buildCoursePdfSource(input)).toThrow(
			`Unsupported assessment group mode: ${mode}.`,
		);
	});

	it("prints promoted option feedback once through the grammar-to-workbook pipeline", () => {
		const input = course(
			"# Untitled {hideTitle}\n\n::: choice Which answer? {level=3}\n(x) First\nfeedback: PROMOTEDRATIONALE\n( ) Second\nfeedback: INCORRECTRATIONALE\n:::\n",
		);
		const on = buildCoursePdfSource({ ...input, includeAnswerSheet: true });
		const off = buildCoursePdfSource({ ...input, includeAnswerSheet: false });
		expect(on.typstSource.match(/PROMOTEDRATIONALE/g)).toHaveLength(1);
		expect(on.typstSource).not.toContain("INCORRECTRATIONALE");
		expect(off.typstSource).not.toContain("PROMOTEDRATIONALE");
		expect(off.typstSource).not.toContain("INCORRECTRATIONALE");
		expect(on.questionCount).toBe(1);
	});

	it("keeps rich promoted feedback and every distinct correct option rationale once", () => {
		const result = buildCoursePdfSource({
			...course(
				"# Untitled {hideTitle}\n\n::: choice Select answers {level=3}\n[x] First\nfeedback: **BOLDRATIONALE** and [LINKRATIONALE](https://example.com/reason).\n[x] Second\nfeedback: *ITALICRATIONALE* and `CODERATIONALE`.\n[ ] Third\nfeedback: INCORRECTRATIONALE\n:::\n",
			),
			includeAnswerSheet: true,
		});
		for (const marker of ["BOLDRATIONALE", "LINKRATIONALE", "ITALICRATIONALE", "CODERATIONALE"])
			expect(result.typstSource.match(new RegExp(marker, "g"))).toHaveLength(1);
		expect(result.typstSource).toContain("#strong[BOLDRATIONALE]");
		expect(result.typstSource).toContain('#link("https://example.com/reason")[LINKRATIONALE]');
		expect(result.typstSource).toContain("#emph[ITALICRATIONALE]");
		expect(result.typstSource).toContain('#raw("CODERATIONALE")');
		expect(result.typstSource).not.toContain("INCORRECTRATIONALE");
	});

	it("preserves distinct option, question and rich general feedback without leaking into the handout", () => {
		const blocks = adaptGrammarPreviewBlocks(
			readBlockSource(
				"# Untitled {hideTitle}\n\n::: choice Which answer? {level=3}\ncorrect: *QUESTIONRATIONALE*\n(x) First\nfeedback: **OPTIONRATIONALE**\n( ) Second\n\n:::\n",
			).blocks,
			undefined,
			"en",
		);
		const block = blocks.find((block) => block.type === "assessment");
		Object.assign(block?.data.feedback ?? {}, {
			general: [
				{
					id: "general",
					type: "text",
					data: { content: "<p>GENERALRATIONALE</p><ul><li>LISTRATIONALE</li></ul>" },
				},
			],
		});
		const input = withBlocks(blocks);
		const on = buildCoursePdfSource({ ...input, includeAnswerSheet: true });
		const off = buildCoursePdfSource({ ...input, includeAnswerSheet: false });
		for (const marker of [
			"OPTIONRATIONALE",
			"QUESTIONRATIONALE",
			"GENERALRATIONALE",
			"LISTRATIONALE",
		]) {
			expect(on.typstSource.match(new RegExp(marker, "g"))).toHaveLength(1);
			expect(off.typstSource).not.toContain(marker);
		}
		expect(on.typstSource).toContain("#strong[OPTIONRATIONALE]");
		expect(on.typstSource).toContain("#emph[QUESTIONRATIONALE]");
		expect(on.typstSource).toContain("#list([LISTRATIONALE])");
	});

	it("retains feedback with identical words but different formatting", () => {
		const result = buildCoursePdfSource({
			...course(
				"# Untitled {hideTitle}\n\n::: choice Which answer? {level=3}\ncorrect: **SAMEWORDS**\n(x) First\nfeedback: SAMEWORDS\n( ) Second\n\n:::\n",
			),
			includeAnswerSheet: true,
		});
		expect(result.typstSource.match(/SAMEWORDS/g)).toHaveLength(2);
		expect(result.typstSource).toContain("#strong[SAMEWORDS]");
	});

	it("deduplicates identical rationale across correct options before inline placeholders are allocated", () => {
		const result = buildCoursePdfSource({
			...course(
				"# Untitled {hideTitle}\n\n::: choice Select answers {level=3}\n[x] First\nfeedback: **SHAREDRATIONALE**\n[x] Second\nfeedback: **SHAREDRATIONALE**\n[ ] Third\n:::\n",
			),
			includeAnswerSheet: true,
		});
		expect(result.typstSource.match(/SHAREDRATIONALE/g)).toHaveLength(1);
		expect(result.typstSource).toContain("#strong[SHAREDRATIONALE]");
	});

	it("keeps the glossary definition when deduplicating promoted feedback", () => {
		const input = course(
			"# Untitled {hideTitle}\n\n::: choice Which answer? {level=3}\n(x) First\nfeedback: Check the [GLOSSARYTERM]{GLOSSARYDEFINITION}.\n( ) Second\n:::\n",
		);
		const on = buildCoursePdfSource({ ...input, includeAnswerSheet: true });
		const off = buildCoursePdfSource({ ...input, includeAnswerSheet: false });
		expect(on.typstSource.match(/GLOSSARYTERM/g)).toHaveLength(1);
		expect(on.typstSource.match(/GLOSSARYDEFINITION/g)).toHaveLength(1);
		expect(off.typstSource).not.toContain("GLOSSARYTERM");
		expect(off.typstSource).not.toContain("GLOSSARYDEFINITION");
	});

	it("fails on a malformed page boundary after a hidden page", () => {
		const input = withBlocks(
			[
				{ id: "", type: "pageBreak", data: { title: "Visible" } },
				{ id: "leak", type: "text", data: { content: "MUST STAY HIDDEN" } },
			],
			{ id: "hidden", title: "Hidden", hidden: true },
		);
		expect(() => buildCoursePdfSource(input)).toThrow("Invalid page boundary.");
	});

	it("keeps missing image alternatives as hard errors and permits decorative images", () => {
		for (const block of [
			{ id: "image", type: "image", data: { src: "a.png" } },
			{
				id: "comparison",
				type: "imageComparison",
				data: {
					beforeImage: { src: "a.png", altText: "Before" },
					afterImage: { src: "b.png" },
				},
			},
			{ id: "graphic", type: "labeledGraphic", data: { imageSrc: "a.png", labels: [] } },
			{
				id: "hotspot",
				type: "assessment",
				data: {
					stem: [{ id: "stem", type: "text", data: { content: "Find the mark" } }],
					response: {
						type: "hotspot",
						mode: "select",
						image: "a.png",
						hotspots: [{ id: "mark", shape: "rect", coords: [10, 10, 20, 20] }],
					},
				},
			},
		] as const)
			expect(() => buildCoursePdfSource(withBlocks([block]))).toThrow(
				"Informative images need alternative text.",
			);
		const result = buildCoursePdfSource(
			withBlocks([{ id: "decoration", type: "image", data: { src: "a.png", decorative: true } }]),
		);
		expect(result.assetSources.has("a.png")).toBe(true);
		expect(result.diagnostics).toEqual([]);
	});

	it("skips an assessment with a malformed stem or description as one unit", () => {
		for (const field of ["stem", "description", "chart"] as const) {
			const prompt = [
				{ id: "valid", type: "text", data: { content: "QUESTION TEXT" } },
				field === "chart"
					? {
							id: "invalid",
							type: "chart",
							data: {
								rows: [
									["Category", "Value"],
									["A", "bad"],
								],
							},
						}
					: { id: "invalid", type: "text", data: { content: "<span></span>" } },
			];
			const result = buildCoursePdfSource({
				...withBlocks([
					{
						id: "question",
						type: "assessment",
						data: {
							stem:
								field !== "description"
									? prompt
									: [{ id: "stem", type: "text", data: { content: "QUESTION TEXT" } }],
							...(field === "description" ? { description: prompt } : {}),
							response: {
								type: "choice",
								selectionMode: "single",
								options: [
									{ id: "a", label: "Yes", isCorrect: true },
									{ id: "b", label: "No" },
								],
							},
						},
					},
					{ id: "after", type: "text", data: { content: "AFTER QUESTION" } },
				]),
				includeAnswerSheet: true,
			});
			expect(result.questionCount).toBe(0);
			expect(result.typstSource).not.toContain("QUESTION TEXT");
			expect(result.typstSource).not.toContain("Answer sheet");
			expect(result.typstSource).toContain("AFTER QUESTION");
			expect(result.diagnostics).toEqual([
				{
					lessonId: "lesson",
					blockId: "question",
					code: "invalid_block_data",
					message: "Skipped a block in the PDF because its content is empty or invalid.",
				},
			]);
		}
	});

	it("warns for empty HTML and keeps content-bearing inline markers", () => {
		const result = buildCoursePdfSource(
			withBlocks([
				{ id: "span", type: "text", data: { content: "<span></span>" } },
				{ id: "nested", type: "text", data: { content: "<p><span> </span></p>" } },
				{ id: "arbitrary", type: "text", data: { content: '<span data-foo="x"></span>' } },
				{ id: "image", type: "text", data: { content: '<p><img src="a.png" alt="A"></p>' } },
				{
					id: "equation",
					type: "text",
					data: { content: '<p><span data-math-latex="x" aria-label="x"></span></p>' },
				},
				{
					id: "icon",
					type: "text",
					data: { content: '<span data-praxity-inline-icon="star" aria-label="STAR ICON"></span>' },
				},
				{
					id: "tooltip",
					type: "text",
					data: { content: '<span data-tooltip-content="Definition"></span>' },
				},
			]),
		);
		expect(result.diagnostics.map(({ blockId, code }) => [blockId, code])).toEqual([
			["span", "empty_block"],
			["nested", "empty_block"],
			["arbitrary", "empty_block"],
		]);
		expect(result.typstSource).not.toContain(
			`<p-${Buffer.from("lesson/arbitrary").toString("hex")}>`,
		);
		expect(result.assetSources.has("a.png")).toBe(true);
		expect(result.usesMath).toBe(true);
		expect(result.typstSource).toContain('#mitex("x", block: false');
		expect(result.typstSource).toContain("STAR ICON");
		expect(result.typstSource).toContain("(Definition)");
	});

	it("leaves blockId absent when an invalid block has no ID", () => {
		const result = buildCoursePdfSource(
			withBlocks([{ type: "text", data: { content: "No ID" } } as never], {
				title: "Page title",
			}),
		);
		expect(result.diagnostics).toEqual([
			{
				lessonId: "lesson",
				pageTitle: "Page title",
				code: "invalid_block",
				message: "Skipped a block in the PDF because its content is empty or invalid.",
			},
		]);
	});
	it.each([
		["missing block data", "text", null, "invalid_block"],
		["empty text", "text", { content: "<p> </p>" }, "empty_block"],
		["non-string text", "text", { content: 23 }, "invalid_block_data"],
		["text with control character", "text", { content: "UNUSABLE\u0001" }, "invalid_block_data"],
		["image without source", "image", { altText: "UNUSABLE" }, "invalid_block_data"],
		[
			"inline image without source",
			"text",
			{ content: '<p>UNUSABLE <img src="" alt="A"></p>' },
			"invalid_block_data",
		],
		[
			"invalid inline equation",
			"text",
			{
				content:
					'<p>UNUSABLE <span data-math-latex="\\unknown{x}" aria-label="Formula">x</span></p>',
			},
			"invalid_block_data",
		],
		["invalid heading level", "heading", { content: "UNUSABLE", level: 9 }, "invalid_block_data"],
		["missing table headers", "table", { rows: [] }, "invalid_block_data"],
		[
			"ragged table row",
			"table",
			{ headers: ["A", "B"], rows: [["UNUSABLE"]] },
			"invalid_block_data",
		],
		[
			"invalid table alignments",
			"table",
			{ headers: ["A"], rows: [], columnAlignments: ["up"] },
			"invalid_block_data",
		],
		["unsupported note tone", "note", { content: "UNUSABLE", tone: "loud" }, "invalid_block_data"],
		[
			"missing comparison image",
			"imageComparison",
			{ beforeImage: { src: "a.png", altText: "A" } },
			"invalid_block_data",
		],
		[
			"invalid graphic position",
			"labeledGraphic",
			{ imageSrc: "a.png", imageAlt: "A", labels: [{ x: 200, y: 0, title: "UNUSABLE" }] },
			"invalid_block_data",
		],
		[
			"non-string transcript",
			"video",
			{ src: "https://example.org", transcript: 42 },
			"invalid_block_data",
		],
		[
			"unknown resource type",
			"resourceEntry",
			{ resourceType: "mystery", title: "UNUSABLE" },
			"invalid_block_data",
		],
		["chart without data", "chart", { title: "UNUSABLE" }, "invalid_block_data"],
		[
			"chart without labels",
			"chart",
			{ data: { labels: [], series: [{ name: "X", values: [] }] } },
			"invalid_block_data",
		],
		[
			"chart without series",
			"chart",
			{ data: { labels: ["A"], series: [] } },
			"invalid_block_data",
		],
		[
			"non-numeric chart series",
			"chart",
			{ data: { labels: ["A"], series: [{ name: "X", values: ["oops"] }] } },
			"invalid_block_data",
		],
		[
			"non-numeric chart row",
			"chart",
			{
				rows: [
					["Category", "Value"],
					["UNUSABLE", "oops"],
				],
			},
			"invalid_chart_rows",
		],
		["non-string code", "code", { code: 42 }, "invalid_block_data"],
		["empty code", "code", { code: "" }, "empty_block"],
		["empty equation", "equation", { latex: "" }, "invalid_block_data"],
		["invalid equation command", "equation", { latex: "\\unknown{x}" }, "invalid_block_data"],
		["equation control character", "equation", { latex: "x\u0001" }, "invalid_block_data"],
		["equation comment", "equation", { latex: "x% note" }, "invalid_block_data"],
		[
			"deep equation nesting",
			"equation",
			{ latex: `${"{".repeat(65)}x${"}".repeat(65)}` },
			"invalid_block_data",
		],
		["unbalanced equation braces", "equation", { latex: "{x" }, "invalid_block_data"],
		[
			"unsupported equation environment",
			"equation",
			{ latex: "\\begin{unknown}x\\end{unknown}" },
			"invalid_block_data",
		],
		[
			"non-string equation alternative",
			"equation",
			{ latex: "x", altText: 42 },
			"invalid_block_data",
		],
		["invalid content items", "stats", { items: [null] }, "invalid_block_data"],
	] as const)(
		"skips %s and prints later content with a French warning",
		(_name, type, data, code) => {
			const input: CoursePdfOptions = {
				title: "Cahier",
				locale: "fr",
				lessons: [
					{
						id: "lesson-fr",
						title: "Leçon",
						locale: "fr",
						blocks: [
							{ id: "page", type: "pageBreak", data: { title: "Page test" } },
							{ id: "bad", type, data } as CoursePdfOptions["lessons"][number]["blocks"][number],
							{ id: "good", type: "text", data: { content: "SURVIVES" } },
						],
					},
				],
			};
			const result = buildCoursePdfSource(input);
			expect(result.typstSource).toContain("SURVIVES");
			expect(result.typstSource).not.toContain("UNUSABLE");
			expect(result.diagnostics).toContainEqual({
				lessonId: "lesson-fr",
				blockId: "bad",
				pageTitle: "Page test",
				code,
				message: "Bloc ignoré dans le PDF, car son contenu est vide ou invalide.",
			});
		},
	);

	const stem = [{ id: "stem", type: "text", data: { content: "Question" } }];
	it.each([
		["missing rating label", "rating", { maxValue: 5 }, "invalid_block_data"],
		["invalid rating scale", "rating", { label: "Question", maxValue: 0 }, "invalid_block_data"],
		[
			"invalid rating values",
			"rating",
			{ label: "Question", scale: [{ id: "bad-level", value: "bad", label: "Bad" }] },
			"invalid_block_data",
		],
		[
			"missing question stem",
			"assessment",
			{ stem: [], response: { type: "choice", selectionMode: "single", options: [] } },
			"invalid_block_data",
		],
		[
			"missing response",
			"assessment",
			{ stem: [{ id: "stem", type: "text", data: { content: "Question" } }] },
			"invalid_block_data",
		],
		[
			"invalid choice records",
			"assessment",
			{
				stem: [{ id: "stem", type: "text", data: { content: "Question" } }],
				response: { type: "choice", selectionMode: "single", options: [null] },
			},
			"invalid_block_data",
		],
		[
			"too few choices",
			"assessment",
			{
				stem: [{ id: "stem", type: "text", data: { content: "Question" } }],
				response: {
					type: "choice",
					selectionMode: "single",
					options: [{ id: "one", label: "One" }],
				},
			},
			"invalid_block_data",
		],
		[
			"invalid question heading level",
			"assessment",
			{ stem, stemLevel: 9, response: { type: "choice", selectionMode: "single", options: [] } },
			"invalid_block_data",
		],
		[
			"invalid assessment alternatives",
			"assessment",
			{
				stem,
				response: {
					type: "matching",
					pairs: [{ id: "pair", matchId: "match", prompt: "A", correctMatch: "B" }],
					distractors: [42],
				},
			},
			"invalid_block_data",
		],
		[
			"empty categorization",
			"assessment",
			{
				stem,
				response: {
					type: "categorize",
					categories: [{ id: "group", name: "Group", items: [], itemIds: [] }],
				},
			},
			"invalid_block_data",
		],
		[
			"non-string fill-blank template",
			"assessment",
			{ stem, response: { type: "fillBlank", template: 42, blanks: [] } },
			"invalid_block_data",
		],
		[
			"invalid blank answer",
			"assessment",
			{
				stem,
				response: { type: "fillBlank", template: "Use {x}", blanks: [{ id: "blank", answer: 42 }] },
			},
			"invalid_block_data",
		],
		[
			"invalid matrix scale",
			"assessment",
			{
				stem,
				response: {
					type: "matrix",
					statements: [{ id: "statement", text: "Item" }],
					scalePoints: [{ id: "scale", value: "bad", label: "Bad" }],
				},
			},
			"invalid_block_data",
		],
	] as const)("skips %s without consuming an assessment number", (_name, type, data, code) => {
		const result = buildCoursePdfSource({
			title: "Workbook",
			locale: "en",
			lessons: [
				{
					id: "lesson",
					title: "Lesson",
					locale: "en",
					blocks: [
						{ id: "bad", type, data } as CoursePdfOptions["lessons"][number]["blocks"][number],
						{ id: "good", type: "text", data: { content: "SURVIVES" } },
					],
				},
			],
		});
		expect(result.typstSource).toContain("SURVIVES");
		expect(result.questionCount).toBe(0);
		expect(result.diagnostics).toContainEqual({
			lessonId: "lesson",
			blockId: "bad",
			code,
			message: "Skipped a block in the PDF because its content is empty or invalid.",
		});
	});

	it("refuses a self-check by name", () => {
		const input = course("# Good\n\nVisible text.\n");
		input.lessons[0].blocks.push({
			id: "check",
			type: "selfCheck",
			data: { content: { task: "Task", parts: [{ id: "part" }] } },
		});
		expect(() => buildCoursePdfSource(input)).toThrow("Self-check can’t be exported to PDF yet.");
	});

	it("refuses full self-check content before PDF adaptation", () => {
		const input = course("# Good\n\nVisible text.\n");
		input.lessons[0].blocks.push({
			id: "check",
			type: "selfCheck",
			data: {
				content: {
					task: "Task",
					model: "HIDDEN_MODEL",
					parts: [{ id: "part", missed: "HIDDEN_HINT" }],
				},
			},
		});
		expect(() => buildCoursePdfSource(input)).toThrowError(
			expect.objectContaining({
				code: "ESELFCHECKPROMPT",
				message: "Invalid self-check prompt data.",
			}),
		);
	});

	it("keeps duplicate IDs and branching logic as hard errors", () => {
		const input = course("# Good\n\nVisible text.\n");
		input.lessons[0].blocks.push({ id: "logic", type: "logic", data: {} });
		expect(() => buildCoursePdfSource(input)).toThrow("Logic needs a static version");
		input.lessons[0].blocks.pop();
		input.lessons[0].blocks.push({ id: "same", type: "text", data: { content: "One" } });
		input.lessons[0].blocks.push({ id: "same", type: "text", data: { content: "Two" } });
		expect(() => buildCoursePdfSource(input)).toThrow("Duplicate block ID");
		input.lessons[0].blocks.pop();
		input.lessons[0].blocks.pop();
		input.lessons[0].blocks.push({
			id: "variable",
			type: "text",
			data: { content: '<span data-mention="name"></span>' },
		});
		expect(() => buildCoursePdfSource(input)).toThrow("Variables and answer piping");
		const duplicateEmpty = course("# Good\n\nVisible text.\n");
		duplicateEmpty.lessons[0].blocks.push({ id: "same", type: "text", data: { content: "One" } });
		duplicateEmpty.lessons[0].blocks.push({ id: "same", type: "text", data: { content: "" } });
		expect(() => buildCoursePdfSource(duplicateEmpty)).toThrow("Duplicate block ID");
		const conditionalChart = course("# Good\n\nVisible text.\n");
		conditionalChart.lessons[0].blocks.push({
			id: "chart",
			type: "chart",
			data: {
				visible: "score > 0",
				rows: [
					["X", "Y"],
					["A", "bad"],
				],
			},
		});
		expect(() => buildCoursePdfSource(conditionalChart)).toThrow("Conditional visibility");
	});

	it("rolls back assets and links from a block skipped after partial rendering", () => {
		const result = buildCoursePdfSource({
			title: "Workbook",
			locale: "en",
			lessons: [
				{
					id: "lesson",
					title: "Lesson",
					locale: "en",
					blocks: [
						{
							id: "bad",
							type: "imageComparison",
							data: {
								beforeImage: { src: "before.png", altText: "Before" },
								afterImage: { altText: "After" },
							},
						},
						{ id: "good", type: "text", data: { content: "SURVIVES" } },
					],
				},
			],
		});
		expect(result.assetSources.size).toBe(0);
		expect(result.typstSource).toContain("SURVIVES");
		expect(result.typstSource).not.toContain("before.png");
		expect(result.diagnostics).toContainEqual({
			lessonId: "lesson",
			blockId: "bad",
			code: "invalid_block_data",
			message: "Skipped a block in the PDF because its content is empty or invalid.",
		});
	});

	it("skips one malformed nested block and keeps its siblings", () => {
		const result = buildCoursePdfSource({
			title: "Workbook",
			locale: "en",
			lessons: [
				{
					id: "lesson",
					title: "Lesson",
					locale: "en",
					blocks: [
						{
							id: "columns",
							type: "columns",
							data: {
								items: [
									{
										id: "panel-item",
										label: "Panel",
										children: [
											{ id: "bad", type: "text", data: null },
											{ id: "good", type: "text", data: { content: "INNER SURVIVES" } },
										],
									},
								],
							},
						} as CoursePdfOptions["lessons"][number]["blocks"][number],
					],
				},
			],
		});
		expect(result.typstSource).toContain("INNER SURVIVES");
		expect(result.diagnostics).toContainEqual({
			lessonId: "lesson",
			blockId: "bad",
			code: "invalid_block",
			message: "Skipped a block in the PDF because its content is empty or invalid.",
		});
	});

	it("uses the course locale for skip warnings across lesson locales", () => {
		const result = buildCoursePdfSource({
			title: "Workbook",
			locale: "en",
			lessons: [
				{
					id: "fr",
					title: "Leçon",
					locale: "fr",
					blocks: [
						{ id: "bad", type: "code", data: { code: 42 } },
						{ id: "good", type: "text", data: { content: "Visible" } },
					],
				},
			],
		});
		expect(result.diagnostics).toContainEqual({
			lessonId: "fr",
			blockId: "bad",
			code: "invalid_block_data",
			message: "Skipped a block in the PDF because its content is empty or invalid.",
		});
	});

	it("skips malformed text beside a floated image", () => {
		const result = buildCoursePdfSource({
			title: "Workbook",
			locale: "en",
			lessons: [
				{
					id: "lesson",
					title: "Lesson",
					locale: "en",
					blocks: [
						{
							id: "image",
							type: "image",
							data: { src: "picture.png", altText: "Picture", width: "medium", float: "right" },
						},
						{ id: "bad", type: "text", data: { content: "BAD\u0001TEXT" } },
						{ id: "close", type: "blockBreak", data: { close: "float" } },
						{ id: "good", type: "text", data: { content: "AFTER FLOAT" } },
					],
				},
			],
		});
		expect(result.typstSource).toContain("#px-float(right");
		expect(result.typstSource).toContain("AFTER FLOAT");
		expect(result.typstSource).not.toContain("BAD");
		expect(result.diagnostics).toContainEqual({
			lessonId: "lesson",
			blockId: "bad",
			code: "invalid_block_data",
			message: "Skipped a block in the PDF because its content is empty or invalid.",
		});
	});

	it("skips an invalid inline image inside floated code and prints the rest", () => {
		const result = buildCoursePdfSource(
			withBlocks([
				{
					id: "image",
					type: "image",
					data: { src: "picture.png", altText: "Picture", width: "medium", float: "right" },
				},
				{ id: "bad", type: "text", data: { content: '<code><img src=""></code>' } },
				{ id: "beside", type: "text", data: { content: "BESIDE SURVIVES" } },
				{ id: "close", type: "blockBreak", data: { close: "float" } },
				{ id: "good", type: "text", data: { content: "AFTER FLOAT" } },
			]),
		);
		expect(result.typstSource).toContain("#px-float(right");
		expect(result.typstSource).toContain("BESIDE SURVIVES");
		expect(result.typstSource).toContain("AFTER FLOAT");
		expect(result.diagnostics).toEqual([
			{
				lessonId: "lesson",
				blockId: "bad",
				code: "invalid_block_data",
				message: "Skipped a block in the PDF because its content is empty or invalid.",
			},
		]);
	});

	it("prints following text in normal flow when a floated image is skipped", () => {
		const result = buildCoursePdfSource(
			withBlocks([
				{
					id: "image",
					type: "image",
					data: { altText: "Picture", width: "medium", float: "right" },
				},
				{ id: "beside", type: "text", data: { content: "NORMAL FLOW" } },
				{ id: "close", type: "blockBreak", data: { close: "float" } },
			]),
		);
		expect(result.typstSource).not.toContain("#px-float(right");
		expect(result.typstSource).toContain("NORMAL FLOW");
		expect(result.diagnostics.map(({ blockId }) => blockId)).toEqual(["image"]);
	});

	it("skips invalid narration text and keeps page content", () => {
		const result = buildCoursePdfSource({
			title: "Workbook",
			locale: "en",
			lessons: [
				{
					id: "lesson",
					title: "Lesson",
					locale: "en",
					blocks: [
						{
							id: "good",
							type: "text",
							data: { content: "Visible", narration: "BAD\u0001SCRIPT" },
						},
					],
				},
			],
		});
		expect(result.typstSource).toContain("Visible");
		expect(result.typstSource).not.toContain("BAD");
		expect(result.diagnostics).toContainEqual({
			lessonId: "lesson",
			blockId: "good",
			code: "invalid_narration_data",
			message: "Skipped invalid narration text in the PDF.",
		});
	});
	it("exports parsed questions without answers, feedback or raw templates by default", () => {
		const input = course();
		const before = structuredClone(input);
		const { typstSource: source, questionCount } = buildCoursePdfSource(input);
		expect(questionCount).toBe(5);
		expect(source).toContain("Choose the colour of the sky");
		expect(source).toContain("A. Blue");
		expect(source).toContain("B. Green");
		expect(source).toContain("C. Red");
		expect(source).toContain("a|b");
		expect(source).toContain("red; blue; red; green");
		expect(source).toContain("\\{literal\\}");
		for (const secret of [
			"ANSWERONLY",
			"pattern",
			"~literal",
			"OPTIONEXPLANATION",
			"CORRECTEXPLANATION",
			"RETRYONLY",
			"isCorrect",
			"Answer sheet",
		]) {
			expect(source).not.toContain(secret);
		}
		expect(source.match(/width: 3cm/g)).toHaveLength(7);
		expect(input).toEqual(before);
	});

	it("appends correct keys and explanations without changing the question bodies", () => {
		const input = course();
		const without = buildCoursePdfSource(input).typstSource;
		const withAnswers = buildCoursePdfSource({ ...input, includeAnswerSheet: true }).typstSource;
		const bodyStart = "#pagebreak(weak: true)";
		const appendixStart = "#pagebreak()\n#heading(level: 1)[Answer sheet]";
		expect(
			withAnswers.slice(withAnswers.indexOf(bodyStart), withAnswers.indexOf(appendixStart)).trim(),
		).toBe(without.slice(without.indexOf(bodyStart)).trim());
		const appendix = withAnswers.slice(withAnswers.indexOf(appendixStart));
		expect(appendix).toContain("A. Blue");
		expect(appendix).not.toContain("B. Green");
		expect(appendix).toContain("ANSWERONLY");
		expect(appendix).toContain("Acceptance pattern\\: pattern\\*");
		expect(appendix).toContain("2. \\~literal");
		expect(appendix).toContain("a|b; \\*star");
		expect(appendix).toContain("No fixed answer supplied");
		expect(appendix).toContain("CORRECTEXPLANATION");
		expect(appendix).toContain("OPTIONEXPLANATION");
		expect(appendix).not.toContain("RETRYONLY");
		expect(appendix.match(/#link\(<q-/g)).toHaveLength(5);
	});

	it("preserves lesson/block/inline languages and omits hidden pages before normalization", () => {
		const input = course(
			'# Visible\n\nRead this.\n\n# Hidden {hide hideTitle}\n\n::: choice SECRET {visible="score > 0" level=3}\n(x) ANSWER\n( ) Other\n:::\n',
		);
		input.lessons.push({
			id: "lesson-fr",
			title: "Français",
			locale: "fr-CA",
			blocks: [
				{
					id: "fr",
					type: "text",
					data: { content: '<p>Bonjour <span lang="en-GB">hello</span>.</p>' },
				},
				{ id: "en", type: "text", locale: "en", data: { content: "English override" } },
			],
		});
		const source = buildCoursePdfSource(input).typstSource;
		expect(source).toContain('lang: "fr", region: "CA"');
		expect(source).toContain('lang: "en", region: "GB"');
		expect(source).toContain("English override");
		expect(source).not.toContain("SECRET");
		expect(source.indexOf("Visible")).toBeLessThan(source.indexOf("Bonjour"));
	});

	it.each([
		[
			'# Untitled {hideTitle}\n\n::: choice Conditional {visible="score > 0" level=3}\n(x) Yes\n( ) No\n:::\n',
			"Conditional visibility",
		],
		["Hello {{learnerName}}", "Variables"],
		[
			"# Fixture {hideTitle}\n\n::: fill-blank Invalid\nSay {answer}.\n:::\n",
			"Unsupported fill-blank style",
		],
		[
			"# Fixture {hideTitle}\n\n::: fill-blank Missing bank occurrence {style=word-bank}\nbank: red | blue\nUse {red}, then {red}.\n:::\n",
			"Word bank needs an occurrence",
		],
		[
			"# Fixture {hideTitle}\n\n::: fill-blank Unmarked dropdown {style=dropdown}\nUse {red|blue}.\n:::\n",
			"Selectable blanks need answers",
		],
	])("refuses incomplete workbook for $1", (source, error) => {
		const input = course(source);
		if (error === "Unsupported fill-blank style") {
			const question = input.lessons[0].blocks.find((block) => block.type === "assessment");
			if (!question) throw new Error("Missing PDF assessment fixture");
			(question.data.response as { style: string }).style = "bogus";
		}
		expect(() => buildCoursePdfSource(input)).toThrow(error);
		try {
			buildCoursePdfSource(input);
		} catch (failure) {
			expect(failure).toBeInstanceOf(CoursePdfError);
			expect((failure as CoursePdfError).lessonId).toBe("lesson-en");
			expect((failure as CoursePdfError).blockId).toBeTruthy();
		}
	});

	it("retains spaces, line breaks and paragraph breaks around blank markers", () => {
		const { typstSource } = buildCoursePdfSource(
			course(
				"# Untitled {hideTitle}\n\n::: fill-blank Fill {level=3}\nOne {a}.\nNext line.\n\nTwo {b}.\n:::\n",
			),
		);
		expect(typstSource).toContain("One (1)");
		expect(typstSource).toContain("\\.#linebreak()Next line\\.\n\nTwo (2)");
	});

	it("does not print an empty page before the first visible content", () => {
		const input = course("# Read\nnav: First visible page\n\nVisible text.\n");
		input.lessons[0].blocks.unshift({
			id: "hidden-page",
			type: "pageBreak",
			data: { id: "hidden-page", hide: true },
		});
		const source = buildCoursePdfSource(input).typstSource;
		expect(source).not.toContain("#strong[Practice]\n\n#pagebreak");
		expect(source).toContain("Visible text");
	});

	it("does not create an empty appendix, and requires the explicit PDF/UA compiler", async () => {
		await expect(
			exportCoursePdf({ ...course(), executablePath: undefined as unknown as string }),
		).rejects.toThrow("explicit Typst executable");
		const input = {
			...course("# Read\n\nPlain text.\n"),
			includeAnswerSheet: true,
			pageSize: "letter" as const,
		};
		const signal = new AbortController().signal;
		const result = await exportCoursePdf({ ...input, executablePath: "/bundled/typst", signal });
		expect(result).toEqual({ pdf: Buffer.from("%PDF-test"), questionCount: 0, diagnostics: [] });
		expect(compileTypst).toHaveBeenLastCalledWith(expect.stringContaining('paper: "us-letter"'), {
			executablePath: "/bundled/typst",
			signal,
			pdfStandard: "ua-1",
			a11yExtras: true,
			files: new Map(),
		});
		expect(buildCoursePdfSource(input).typstSource).not.toContain("Answer sheet");
	});
});
