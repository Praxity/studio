import { readLesson } from "@praxity/grammar";
import { BLOCK_SCHEMA } from "@praxity/grammar/src/v4/schema.ts";
import { describe, expect, it } from "vitest";
import { readBlockFixture as readBlockSource } from "../../grammar/__tests__/helpers/lesson-fixture.ts";
import { adaptGrammarPreviewBlocks, constructSelfCheckPromptBlock } from "../src/grammar-adapter";
import type { PraxityBlock } from "../src/types";

describe("constructed self-check adaptation", () => {
	const valid = (): PraxityBlock => ({
		id: "public-id",
		type: "selfCheck",
		name: "public-name",
		locale: "fr-CA",
		visible: false,
		sectionTheme: "warm",
		a11y: { altText: "Public alternative", ariaLabel: "Public label", decorative: false },
		layout: { width: "half", alignment: "right" },
		data: {
			content: { task: "Public task", parts: [{ id: "first-part" }, { id: "second-part" }] },
			name: "dataName",
			visible: "passedQuiz",
			layoutMode: "wide",
			level: 6,
			hide: false,
			entrance: "fade",
			required: false,
			private: false,
			deckGate: "attempt",
		},
	});
	const expected = {
		id: "public-id",
		type: "selfCheck",
		name: "public-name",
		locale: "fr-CA",
		visible: false,
		sectionTheme: "warm",
		a11y: { altText: "Public alternative", ariaLabel: "Public label", decorative: false },
		layout: { width: "half", alignment: "right" },
		data: {
			content: { task: "Public task", parts: [{ id: "first-part" }, { id: "second-part" }] },
			name: "dataName",
			visible: "passedQuiz",
			layoutMode: "wide",
			level: 6,
			hide: false,
			entrance: "fade",
			required: false,
			private: false,
			deckGate: "attempt",
		},
	};
	const permittedStrings = new Map([
		["id", "public-id"],
		["name", "public-name"],
		["locale", "fr-CA"],
		["sectionTheme", "warm"],
		["a11y.altText", "Public alternative"],
		["a11y.ariaLabel", "Public label"],
		["layout.width", "half"],
		["layout.alignment", "right"],
		["data.name", "dataName"],
		["data.visible", "passedQuiz"],
		["data.layoutMode", "wide"],
		["data.entrance", "fade"],
		["data.deckGate", "attempt"],
		["data.content.task", "Public task"],
		["data.content.parts.0.id", "first-part"],
		["data.content.parts.1.id", "second-part"],
	]);
	it.each(["en", "fr-CA", "EN-us", "zh-Hant-TW"])(
		"accepts the locale tag %s without rewriting it",
		(locale) => {
			const input = { ...valid(), locale };
			expect(constructSelfCheckPromptBlock(input).locale).toBe(locale);
		},
	);
	it.each([
		"See [HIDDEN_LOCALE_TERM]{HIDDEN_LOCALE_DEFINITION}",
		"en_US",
		"en--US",
		"",
		" ",
		1,
		true,
	])("refuses malformed locale %s with a content-free error", (locale) => {
		expect(() => constructSelfCheckPromptBlock({ ...valid(), locale })).toThrowError(
			expect.objectContaining({
				code: "ESELFCHECKPROMPT",
				message: "Invalid self-check prompt data.",
			}),
		);
	});
	it.each(["selfCheck", "self-check"])(
		"ignores unused invalid %s defaults but refuses them for nested self-checks",
		(keyword) => {
			const ordinary: PraxityBlock = {
				id: "ordinary",
				type: "text",
				data: { content: "Public text" },
			};
			for (const settings of [
				{ points: 2 },
				{ shuffle: true },
				{ name: "1st" },
				{ visible: true },
				{ deckGate: "pass" },
				{ width: "half" },
				{ width: "wide", layoutMode: null },
			]) {
				const defaults = { [keyword]: settings };
				expect(adaptGrammarPreviewBlocks([ordinary], defaults)).toEqual([ordinary]);
				const nested: PraxityBlock = {
					id: "tabs",
					type: "tabs",
					data: { items: [{ id: "tab", label: "Public tab", children: [valid()] }] },
				};
				expect(() => adaptGrammarPreviewBlocks([nested], defaults)).toThrowError(
					expect.objectContaining({
						code: "ESELFCHECKPROMPT",
						message: "Invalid self-check prompt data.",
					}),
				);
			}
		},
	);
	function checkStrings(value: unknown, path = ""): void {
		if (typeof value === "string") {
			expect(value, path).toBe(path === "type" ? "selfCheck" : permittedStrings.get(path));
		} else if (value && typeof value === "object") {
			for (const [key, child] of Object.entries(value))
				checkStrings(child, path ? `${path}.${key}` : key);
		}
	}

	it("constructs criteria without calling authored array methods", () => {
		class Criteria extends Array<{ id: string }> {
			map(): never {
				throw new Error("HIDDEN_ARRAY_METHOD");
			}
			toJSON(): string {
				return "HIDDEN_ARRAY_METHOD";
			}
		}
		const input = valid();
		input.data.content = {
			task: "Public task",
			parts: new Criteria({ id: "first-part" }, { id: "second-part" }),
		};
		const [result] = adaptGrammarPreviewBlocks([input]);
		expect(result).toEqual(expected);
		checkStrings(result);
		expect(JSON.stringify(result)).not.toContain("HIDDEN_");
	});

	it("copies each validated value once when authored getters change", () => {
		for (const path of [
			"locale",
			"visible",
			"sectionTheme",
			"a11y.altText",
			"a11y.ariaLabel",
			"a11y.decorative",
			"layout.width",
			"layout.alignment",
			"data.level",
			"data.visible",
			"data.name",
			"data.layoutMode",
			"data.entrance",
			"data.required",
			"data.private",
			"data.hide",
			"data.deckGate",
		]) {
			const input = valid();
			const keys = path.split(".");
			let owner = input as unknown as Record<string, unknown>;
			for (const key of keys.slice(0, -1)) owner = owner[key] as Record<string, unknown>;
			const key = keys.at(-1) as string;
			const value = owner[key];
			let reads = 0;
			Object.defineProperty(owner, key, {
				enumerable: true,
				get: () => (++reads === 1 ? value : { model: `HIDDEN_GETTER_${path}` }),
			});
			const result = constructSelfCheckPromptBlock(input);
			expect(result, path).toEqual(expected);
			checkStrings(result);
			expect(reads, path).toBe(1);
		}
	});

	it("canonicalises captured defaults without rereading authored values", () => {
		let reads = 0;
		const defaults = {
			get selfCheck() {
				if (++reads > 1) throw new Error("HIDDEN_DEFAULT_GETTER");
				return { level: 1, required: true };
			},
		};
		const input = valid();
		delete input.data.level;
		const second = {
			...input,
			id: "second",
			data: { ...input.data, content: { task: "Public task", parts: [{ id: "third-part" }] } },
		};
		expect(adaptGrammarPreviewBlocks([input, second], defaults)).toEqual([
			{ ...expected, data: { ...expected.data, level: 1 } },
			{
				...expected,
				id: "second",
				data: {
					...expected.data,
					level: 1,
					content: { task: "Public task", parts: [{ id: "third-part" }] },
				},
			},
		]);
		expect(reads).toBe(1);
	});

	it.each(["selfCheck", "self-check"])("does not read unused %s default getters", (keyword) => {
		const defaults = Object.defineProperty({}, keyword, {
			enumerable: true,
			get() {
				throw new Error("HIDDEN_UNUSED_DEFAULT");
			},
		});
		const ordinary: PraxityBlock = {
			id: "ordinary",
			type: "text",
			data: { content: "Public text" },
		};
		expect(adaptGrammarPreviewBlocks([ordinary], defaults)).toEqual([ordinary]);
	});

	it("constructs independent, idempotent records with an independent string-path oracle", () => {
		// This list is the test contract, not the production runtime-key mapper.
		expect(Object.keys(BLOCK_SCHEMA["self-check"].settings).sort()).toEqual([
			"deckGate",
			"entrance",
			"hide",
			"level",
			"name",
			"private",
			"required",
			"visible",
			"width",
		]);
		for (const representation of ["runtime", "source", "no-locale"]) {
			const input = valid();
			if (representation === "no-locale") delete input.locale;
			// Vary all scalar setting representations that source readers/defaults may supply.
			if (representation === "source") {
				input.data.level = "6";
				input.data.hide = "false";
				input.data.required = "false";
				input.data.private = "false";
			}
			const before = structuredClone(input);
			const result = constructSelfCheckPromptBlock(input);
			const literal = structuredClone(expected) as PraxityBlock;
			if (representation === "no-locale") delete literal.locale;
			expect(result).toEqual(literal);
			expect(constructSelfCheckPromptBlock(result)).toEqual(literal);
			expect(adaptGrammarPreviewBlocks([input])).toEqual([literal]);
			expect(input).toEqual(before);
			checkStrings(result);
			const authored = input.data.content as { task: string; parts: { id: string }[] };
			authored.task = "HIDDEN_MUTATION";
			authored.parts[0].id = "HIDDEN_MUTATION";
			if (input.a11y) input.a11y.ariaLabel = "HIDDEN_MUTATION";
			if (input.layout) input.layout.width = "full";
			expect(result).toEqual(literal);
		}
	});

	it.each([
		[1, 1],
		[6, 6],
		["1", 1],
		["6", 6],
	])("accepts the literal numeric boundary %o", (level, expectedLevel) => {
		const input = valid();
		input.data.level = level;
		expect(constructSelfCheckPromptBlock(input).data.level).toBe(expectedLevel);
	});
	it.each([
		0,
		7,
		1.5,
		NaN,
		Infinity,
		-Infinity,
		"0",
		"7",
		"1.5",
		"NaN",
		"1e0",
		"HIDDEN_LEVEL",
		true,
	])("refuses invalid numeric level %o", (level) => {
		const input = valid();
		input.data.level = level;
		expect(() => constructSelfCheckPromptBlock(input)).toThrowError(
			expect.objectContaining({
				code: "ESELFCHECKPROMPT",
				message: "Invalid self-check prompt data.",
			}),
		);
	});
	it.each(["selfCheck", "self-check"])(
		"keeps authored false and alias precedence for %s defaults",
		(keyword) => {
			const input = valid();
			delete input.data.level;
			delete input.data.layoutMode;
			const before = structuredClone(input);
			expect(
				adaptGrammarPreviewBlocks([input], {
					[keyword]: {
						level: "1",
						required: true,
						private: true,
						hide: true,
						layoutMode: "narrow",
						layout: "full",
						width: "wide",
					},
				}),
			).toEqual([{ ...expected, data: { ...expected.data, level: 1 } }]);
			expect(input).toEqual(before);
		},
	);
	it.each(["selfCheck", "self-check"])(
		"validates overridden aliases and settings in %s defaults",
		(keyword) => {
			for (const settings of [
				{ level: { model: "HIDDEN_DEFAULT" } },
				{ width: "wide", layoutMode: null },
				{ width: "wide", layout: ["HIDDEN_ALIAS"] },
				{ private: new Set(["HIDDEN_DEFAULT"]) },
				{ required: new Map([["hint", "HIDDEN_DEFAULT"]]) },
				{ model: "HIDDEN_DEFAULT" },
			])
				expect(() => adaptGrammarPreviewBlocks([valid()], { [keyword]: settings })).toThrowError(
					expect.objectContaining({
						code: "ESELFCHECKPROMPT",
						message: "Invalid self-check prompt data.",
					}),
				);
		},
	);
});

describe("adaptGrammarPreviewBlocks", () => {
	it.each(["first", "second", "third"])(
		"preserves stored comparison %s fixture and following blocks when one column is filled",
		(_fixture) => {
			const child: PraxityBlock = {
				id: "inside",
				type: "text",
				data: { content: "<p>Inside.</p>" },
			};
			const blocks: PraxityBlock[] = [
				{
					id: "comparison",
					type: "columns",
					data: {
						preset: "comparison",
						items: [
							{
								id: "before",
								label: "Before",
								children: [child],
							},
							{ id: "after", label: "After", children: [] },
						],
					},
				},
				{ id: "following-one", type: "text", data: { content: "<p>One.</p>" } },
				{ id: "following-two", type: "text", data: { content: "<p>Two.</p>" } },
			];
			const result = adaptGrammarPreviewBlocks(blocks);
			expect(result.map((block) => block.id)).toEqual([
				"comparison",
				"following-one",
				"following-two",
			]);
			expect(result[0].data.items).toMatchObject([
				{ label: "Before", children: [{ type: "text", data: { content: "<p>Inside.</p>" } }] },
				{ label: "After", children: [] },
			]);
			expect(result.slice(1)).toEqual(blocks.slice(1));
		},
	);

	it.each([0, 1, 3])(
		"preserves all %i populated comparison items and following blocks",
		(count) => {
			const items = Array.from({ length: count }, (_, index) => ({
				id: `item-${index}`,
				label: `Column ${index}`,
				children: [
					{
						id: `child-${index}`,
						type: "text" as const,
						data: { content: `<p>Body ${index}.</p>` },
					},
				],
			}));
			const blocks: PraxityBlock[] = [
				{
					id: "comparison",
					type: "columns",
					data: { preset: "comparison", ...(count ? { items } : {}) },
				},
				{ id: "following-one", type: "text", data: { content: "<p>One.</p>" } },
				{ id: "following-two", type: "text", data: { content: "<p>Two.</p>" } },
			];
			const result = adaptGrammarPreviewBlocks(blocks);
			expect(result.map((block) => block.id)).toEqual([
				"comparison",
				"following-one",
				"following-two",
			]);
			if (count) expect(result[0].data.items).toMatchObject(items);
			expect(result.slice(1)).toEqual(blocks.slice(1));
		},
	);

	it.each([
		[
			"converted",
			"::: comparison {layout=side-by-side}\n:: Before {level=3}\nOld process.\n:: After {level=3}\nNew process.\n:::\n",
		],
		[
			"v4",
			"::: comparison {layout=side-by-side}\n:: Before\nOld process.\n:: After\nNew process.\n:::\n",
		],
	])("preserves filled %s comparisons and both following blocks", (version, comparison) => {
		const source = `${comparison}\nFollowing paragraph.\n\n## Following heading\n`;
		const blocks = readBlockSource(source).blocks;
		const result = adaptGrammarPreviewBlocks(blocks);
		expect(result.map((block) => block.type)).toEqual(blocks.map((block) => block.type));
		const columns = result.find((block) => block.type === "columns");
		expect(columns?.data.items).toMatchObject([
			{ label: "Before", children: [{ type: "text", data: { content: "<p>Old process.</p>" } }] },
			{ label: "After", children: [{ type: "text", data: { content: "<p>New process.</p>" } }] },
		]);
		expect(result.slice(-2)).toMatchObject([
			{ type: "text", data: { content: "<p>Following paragraph.</p>" } },
			{ type: "heading", data: { content: "<p>Following heading</p>", level: 2 } },
		]);
		expect(adaptGrammarPreviewBlocks(result)).toEqual(result);
	});

	it.each(["single", "multi"])("preserves parsed %s choice shuffle settings", (mode) => {
		for (const shuffle of [true, false, undefined]) {
			const markers = mode === "single" ? "(x) Yes\n( ) No" : "[x] Yes\n[ ] No";
			const source = `::: choice Choose {level=3${shuffle === undefined ? "" : ` shuffle=${shuffle}`}}\n${markers}\n:::\n`;
			const [block] = adaptGrammarPreviewBlocks(readBlockSource(source).blocks);
			expect(block.data.response).toMatchObject({ shuffle: shuffle ?? false });
			expect(adaptGrammarPreviewBlocks([block])).toEqual([block]);
		}
	});
	it.each(["single", "multiple"])(
		"inherits choice shuffle for %s responses and respects authored false",
		(mode) => {
			const markers = mode === "single" ? "(x) Yes\n( ) No" : "[x] Yes\n[ ] No";
			const defaults = { [mode === "single" ? "choose-one" : "choose-many"]: { shuffle: true } };
			for (const setting of ["", " shuffle=false", " shuffle=true"]) {
				const [block] = adaptGrammarPreviewBlocks(
					readBlockSource(`::: choice Choose {level=3${setting}}\n${markers}\n:::\n`).blocks,
					defaults,
				);
				expect(block.data.response).toMatchObject({ shuffle: setting !== " shuffle=false" });
				expect(adaptGrammarPreviewBlocks([block], defaults)).toEqual([block]);
			}
		},
	);

	it.each([
		"single",
		"multi",
		"matching",
		"sequence",
		"freeText",
		"fillBlank",
		"categorize",
		"matrix",
		"hotspot",
	])("preserves visibility and authored hiding for nested %s assessments", (assessmentType) => {
		const [group] = adaptGrammarPreviewBlocks([
			{
				id: "group",
				type: "accordion",
				data: {
					items: [
						{
							id: "questions",
							label: "Questions",
							children: [
								{
									id: "question",
									type: "assessment",
									data: {
										stem: [],
										response: {
											type:
												assessmentType === "single" || assessmentType === "multi"
													? "choice"
													: assessmentType,
										},
										visible: "ready",
										hide: true,
									},
								},
							],
						},
					],
				},
			},
		]);
		const [assessment] = (group.data.items as Array<{ children: PraxityBlock[] }>)[0].children;
		expect(assessment.data).toMatchObject({ visible: "ready", hide: true });
		expect(adaptGrammarPreviewBlocks([group])).toEqual([group]);
	});

	it("infers caption language across lesson boundaries", () => {
		const video = readBlockSource(
			"# Untitled {hideTitle}\n\n::: video /assets/intro.mp4 {captions=/assets/intro.vtt}\n:::\n",
		).blocks[0];
		const blocks = adaptGrammarPreviewBlocks(
			[
				video,
				{ id: "next", type: "pageBreak", data: { lessonLocale: "en", isFirstPageOfLesson: true } },
				{ ...video, id: "english" },
			],
			undefined,
			"fr",
		);
		expect(blocks[0].data.captionTracks).toMatchObject([{ language: "fr" }]);
		expect(blocks[2].data.captionTracks).toMatchObject([{ language: "en" }]);
	});

	it("projects authored video captions to a native timed track", () => {
		const [block] = adaptGrammarPreviewBlocks(
			readBlockSource(
				"# Untitled {hideTitle}\n\n::: video /assets/intro.mp4 {captions=/assets/intro.en.vtt}\ncaption: Visible description\n:::\n",
			).blocks,
		);
		expect(block.data.caption).toBe("Visible description");
		expect(block.data.captionTracks).toEqual([
			{ kind: "captions", language: "und", label: "", src: "/assets/intro.en.vtt", default: true },
		]);
	});

	it("uses the lesson language for a French caption track", () => {
		const [block] = adaptGrammarPreviewBlocks(
			readBlockSource(
				'# Untitled {hideTitle}\n\n::: video /assets/intro.mp4 {captions="/assets/intro caption.vtt"}\n:::\n',
			).blocks,
			undefined,
			"fr",
		);
		expect(block.data.captionTracks).toEqual([
			{
				kind: "captions",
				language: "fr",
				label: "Français",
				src: "/assets/intro caption.vtt",
				default: true,
			},
		]);
	});

	it("accepts encoded spaces and drops malformed legacy tracks", () => {
		const [block] = adaptGrammarPreviewBlocks([
			{
				id: "video",
				type: "video",
				data: {
					src: "/assets/intro.mp4",
					captions: "/assets/intro%20caption.vtt",
					captionTracks: [null, { kind: "captions", src: "javascript:evil.vtt" }],
				},
			},
		]);
		expect(block.data.captionTracks).toEqual([
			{
				kind: "captions",
				language: "und",
				label: "",
				src: "/assets/intro%20caption.vtt",
				default: true,
			},
		]);
	});

	it("replaces a malformed track collection with the valid legacy caption source", () => {
		const [block] = adaptGrammarPreviewBlocks([
			{
				id: "video",
				type: "video",
				data: {
					src: "/assets/intro.mp4",
					captions: "javascript:unsafe.vtt",
					captionsSrc: "/assets/legacy.vtt",
					captionTracks: { kind: "captions", src: "/assets/wrong.vtt" },
				},
			},
		]);
		expect(block.data.captionTracks).toEqual([
			{ kind: "captions", language: "und", label: "", src: "/assets/legacy.vtt", default: true },
		]);
	});

	it.each([
		"../private.vtt",
		"/assets/../private.vtt",
		"/assets/%2e%2e/private.vtt",
		"javascript:evil.vtt",
		"/assets/intro.srt",
	])("does not create a track from unsafe or unsupported caption source %s", (captions) => {
		const [block] = adaptGrammarPreviewBlocks(
			readBlockSource(`::: video /assets/intro.mp4 {captions="${captions}"}\n:::\n`).blocks,
		);
		expect(block.data.captionTracks).toBeUndefined();
	});

	it.each([
		"single",
		"multi",
		"matching",
		"sequence",
		"freeText",
		"fillBlank",
		"categorize",
		"matrix",
		"hotspot",
	])("preserves narration when adapting %s assessments", (assessmentType) => {
		const narration = {
			narration: "Listen to the question.",
			narrationDisabled: false,
			narrationAudio: "assets/question.mp3",
			narrationTimings: "assets/question.vtt",
			narrationDuration: 5,
			narrationVoice: "Logan",
			narrationLanguage: "en",
			narrationSpeed: 1,
			narrationReviewedSourceHash: "reviewed-source",
			narrationAcceptedInputsHash: "accepted-inputs",
		};
		const [block] = adaptGrammarPreviewBlocks([
			{
				id: "question",
				type: "assessment",
				data: {
					stem: [],
					response: {
						type:
							assessmentType === "single" || assessmentType === "multi" ? "choice" : assessmentType,
					},
					...narration,
				},
			},
		]);
		expect(block.data).toMatchObject(narration);
	});
	it("splits authored fill-blank alternatives and preserves wildcard patterns", () => {
		const [block] = adaptGrammarPreviewBlocks(
			readBlockSource("::: fill-blank\nChoose {colour| color |~col*r}. Then ____.\n:::\n").blocks,
		);
		expect(block.data.response).toMatchObject({
			blanks: [{ answer: "colour", alternatives: ["color", "~col*r"] }, { answer: "" }],
		});
	});
	it("preserves choice reveal mode and authored incorrect feedback", () => {
		const [block] = adaptGrammarPreviewBlocks([
			{
				id: "reveal",
				type: "assessment",
				data: {
					assessmentType: "choice",
					stem: [{ id: "choose-stem", type: "text", data: { content: "<p>Choose</p>" } }],
					feedbackMode: "reveal",
					response: {
						type: "choice",
						selectionMode: "single",
						options: [
							{ id: "choice-a", label: "A", correct: false },
							{ id: "choice-b", label: "B", correct: true },
						],
					},
					feedback: {
						incorrect: [
							{
								id: "incorrect-feedback",
								type: "text",
								data: { content: "<p>Review the procedure.</p>" },
							},
						],
					},
				},
			},
		]);
		expect(block.data.feedbackMode).toBe("reveal");
		expect(block.data.assessmentType).toBe("choice");
		expect(block.data.feedback).toMatchObject({
			incorrect: [{ data: { content: "<p>Review the procedure.</p>" } }],
		});
	});
	it("maps chart columns to series and first-column values to labels", () => {
		const result = adaptGrammarPreviewBlocks([
			{
				id: "chart-1",
				type: "chart",
				data: {
					chartType: "bar",
					xAxisLabel: "Year",
					yAxisLabel: "Lenses ordered",
					data: {
						labels: ["2024", "2025"],
						series: [{ name: "Lenses ordered", values: [184, 236] }],
					},
				},
			},
		]);
		const adapted = result[0].data as Record<string, unknown>;

		expect(adapted.data).toEqual({
			labels: ["2024", "2025"],
			series: [{ name: "Lenses ordered", values: [184, 236] }],
		});
		expect(adapted.xAxisLabel).toBe("Year");
		expect(adapted.yAxisLabel).toBe("Lenses ordered");
	});

	it("merges component defaults into children provided via items[].children", () => {
		const result = adaptGrammarPreviewBlocks(
			readBlockSource("::: columns\n::\nHello\n::\nPeer\n:::\n").blocks,
			{ text: { alignment: "center" } },
		);
		const adaptedColumns = result[0].data as {
			items?: Array<{
				children?: PraxityBlock[];
			}>;
		};
		const child = adaptedColumns.items?.[0]?.children?.[0];
		const childData = child?.data as Record<string, unknown> | undefined;

		expect(child?.type).toBe("text");
		expect(childData?.content).toBe("<p>Hello</p>");
		expect(childData?.alignment).toBe("center");
	});

	it("preserves grammar 4 fill-blank assessments", () => {
		const result = adaptGrammarPreviewBlocks(
			readBlockSource("::: fill-blank Complete the sentence {scored}\n{permit} {oxygen|o2}\n:::\n")
				.blocks,
		);
		const adapted = result[0].data as {
			assessmentType: string;
			stem: PraxityBlock[];
			response: {
				type: string;
				blanks: Array<{ answer: string; alternatives?: string[] }>;
			};
			gradingMode: string;
		};

		expect(adapted.assessmentType).toBe("fillBlank");
		expect(adapted.stem[0]?.type).toBe("text");
		expect(adapted.response.type).toBe("fillBlank");
		expect(adapted.response.blanks).toHaveLength(2);
		expect(adapted.response.blanks[0]?.answer).toBe("permit");
		expect(adapted.response.blanks[1]?.alternatives).toEqual(["o2"]);
		expect(adapted.gradingMode).toBe("exact");
	});

	it("renders inline doodles in assessment stems", () => {
		const [assessment] = adaptGrammarPreviewBlocks(
			readBlockSource("::: choice @mark.red{Which policy applies?}\n(x) The safe one\n:::\n")
				.blocks,
		);
		const stem = (assessment.data as { stem: PraxityBlock[] }).stem[0]?.data.content;

		expect(stem).toContain('data-doodle="mark"');
		expect(stem).toContain('data-doodle-mods="red"');
		expect(stem).not.toContain("@highlight");
	});

	it("prefers whole-assessment correct and incorrect feedback over option fallbacks", () => {
		const result = adaptGrammarPreviewBlocks([
			{
				id: "assessment-choice",
				type: "assessment",
				data: {
					assessmentType: "choice",
					stem: [
						{
							id: "question-stem",
							type: "text",
							data: { content: "<p>Which item is required?</p>" },
						},
					],
					response: {
						type: "choice",
						selectionMode: "single",
						options: [
							{
								id: "phone",
								label: "Phone",
								correct: false,
								feedback: "Option-specific incorrect",
							},
							{ id: "hat", label: "Hard hat", correct: true, feedback: "Option-specific correct" },
						],
					},
					feedbackEnabled: true,
					feedback: {
						correct: [
							{ id: "correct", type: "text", data: { content: "<p>Whole correct feedback</p>" } },
						],
						incorrect: [
							{
								id: "incorrect",
								type: "text",
								data: { content: "<p>Whole incorrect feedback</p>" },
							},
						],
					},
				},
			},
		]);
		const adapted = result[0].data as {
			feedback: { correct?: PraxityBlock[]; incorrect?: PraxityBlock[] };
			feedbackEnabled?: boolean;
		};

		expect(adapted.feedbackEnabled).toBe(true);
		expect(adapted.feedback.correct?.[0]?.data.content).toContain("Whole correct feedback");
		expect(adapted.feedback.incorrect?.[0]?.data.content).toContain("Whole incorrect feedback");
	});

	it("uses block-level feedback as shared assessment feedback", () => {
		const result = adaptGrammarPreviewBlocks([
			{
				id: "assessment-free-response",
				type: "assessment",
				data: {
					assessmentType: "freeText",
					stem: [],
					response: { type: "freeText" },
					feedbackEnabled: true,
					feedback: {
						correct: [
							{
								id: "correct",
								type: "text",
								data: { content: "<p>Compare your answer with the sample response.</p>" },
							},
						],
						incorrect: [
							{
								id: "incorrect",
								type: "text",
								data: { content: "<p>Compare your answer with the sample response.</p>" },
							},
						],
					},
				},
			},
		]);
		const adapted = result[0].data as {
			feedback: { correct?: PraxityBlock[]; incorrect?: PraxityBlock[] };
			feedbackEnabled?: boolean;
		};

		expect(adapted.feedbackEnabled).toBe(true);
		expect(adapted.feedback.correct?.[0]?.data.content).toContain("sample response");
		expect(adapted.feedback.incorrect?.[0]?.data.content).toContain("sample response");
	});

	it("does not render feedback mode keywords as learner-facing copy", () => {
		const [adapted] = adaptGrammarPreviewBlocks([
			{
				id: "unscored-choice",
				type: "assessment",
				data: {
					assessmentType: "choice",
					stem: [],
					response: {
						type: "choice",
						selectionMode: "multiple",
						options: [
							{ id: "rights", label: "Optical calibration", correct: false },
							{ id: "unsure", label: "Not sure yet", correct: false },
						],
					},
					feedback: {},
				},
			},
		]);
		expect(adapted.data.feedbackEnabled).toBeUndefined();
		expect(adapted.data.feedback).toEqual({});
	});

	it("preserves explicit private free-response intent", () => {
		const [adapted] = adaptGrammarPreviewBlocks(
			readBlockSource("::: free-response What did you notice? {private}\n:::\n").blocks,
		);
		expect(adapted.data.private).toBe(true);
	});

	it("preserves canonical categorize assessments", () => {
		const result = adaptGrammarPreviewBlocks([
			{
				id: "assessment-2",
				type: "assessment",
				data: {
					assessmentType: "categorize",
					stem: [
						{
							id: "stem",
							type: "text",
							data: { content: "<p>Sort each item into the correct category</p>" },
						},
					],
					response: {
						type: "categorize",
						categories: [
							{
								id: "head",
								name: "Head Protection",
								image: "/assets/head.jpg",
								imageAlt: "Hard hat",
								items: ["Hard hat", "Bump cap"],
								itemIds: ["hat", "cap"],
							},
							{
								id: "eye",
								name: "Eye Protection",
								items: ["Safety goggles"],
								itemIds: ["goggles"],
							},
						],
					},
					gradingMode: "none",
				},
			},
		]);
		const adapted = result[0].data as {
			assessmentType: string;
			stem: PraxityBlock[];
			response: {
				type: string;
				categories: Array<{ name: string; image?: string; imageAlt?: string; items: string[] }>;
			};
			gradingMode: string;
		};

		expect(adapted.assessmentType).toBe("categorize");
		expect(adapted.stem[0]?.type).toBe("text");
		expect(adapted.response.type).toBe("categorize");
		expect(adapted.response.categories).toHaveLength(2);
		expect(adapted.response.categories[0]?.name).toBe("Head Protection");
		expect(adapted.response.categories[0]?.image).toBe("/assets/head.jpg");
		expect(adapted.response.categories[0]?.imageAlt).toBe("Hard hat");
		expect(adapted.response.categories[0]?.items).toEqual(["Hard hat", "Bump cap"]);
		expect(adapted.gradingMode).toBe("none");
	});

	it("preserves canonical matrix assessments", () => {
		const result = adaptGrammarPreviewBlocks([
			{
				id: "assessment-matrix",
				type: "assessment",
				data: {
					assessmentType: "matrix",
					stem: [{ id: "stem", type: "text", data: { content: "<p>How confident are you?</p>" } }],
					response: {
						type: "matrix",
						statements: [
							{ id: "ppe", text: "Using PPE correctly" },
							{ id: "labels", text: "Reading warning labels" },
						],
						scalePoints: [
							{ id: "low", value: 1, label: "Not confident" },
							{ id: "high", value: 2, label: "Confident" },
						],
					},
					gradingMode: "none",
				},
			},
		]);
		const adapted = result[0].data as {
			assessmentType: string;
			stem: PraxityBlock[];
			response: {
				type: string;
				statements: Array<{ text: string }>;
				scalePoints: Array<{ value: number; label: string }>;
			};
			gradingMode: string;
		};

		expect(adapted.assessmentType).toBe("matrix");
		expect(adapted.stem[0]?.type).toBe("text");
		expect(adapted.response.type).toBe("matrix");
		expect(adapted.response.statements.map((statement) => statement.text)).toEqual([
			"Using PPE correctly",
			"Reading warning labels",
		]);
		expect(adapted.response.scalePoints).toEqual([
			{ id: "low", value: 1, label: "Not confident" },
			{ id: "high", value: 2, label: "Confident" },
		]);
		expect(adapted.gradingMode).toBe("none");
	});

	it("strips card trackCompletion for grid/masonry layouts", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "card-grid",
				type: "card",
				data: {
					layout: "grid",
					trackCompletion: true,
					items: [{ id: "item-1", label: "One", front: [], back: [] }],
				},
			} as PraxityBlock,
			{
				id: "card-masonry",
				type: "card",
				data: {
					layout: "masonry",
					trackCompletion: true,
					items: [{ id: "item-masonry", label: "One", front: [], back: [] }],
				},
			} as PraxityBlock,
		];

		const result = adaptGrammarPreviewBlocks(blocks);
		expect((result[0].data as Record<string, unknown>).trackCompletion).toBe(false);
		expect((result[1].data as Record<string, unknown>).trackCompletion).toBe(false);
	});

	it("preserves card trackCompletion for single layout", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "card-single",
				type: "card",
				data: {
					layout: "single",
					trackCompletion: true,
					items: [{ id: "item-masonry", label: "One", front: [], back: [] }],
				},
			} as PraxityBlock,
		];

		const result = adaptGrammarPreviewBlocks(blocks);
		expect((result[0].data as Record<string, unknown>).trackCompletion).toBe(true);
	});

	it("converts heading with background image into heroCover", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "heading-hero",
				type: "heading",
				data: {
					level: 2,
					content: "<p>Course Introduction</p>",
					background: "/assets/hero.jpg",
					overlay: "light 80",
				},
			} as PraxityBlock,
		];

		const result = adaptGrammarPreviewBlocks(blocks);
		expect(result[0].type).toBe("heroCover");
		expect((result[0].data as Record<string, unknown>).imageSrc).toBe("/assets/hero.jpg");
		expect((result[0].data as Record<string, unknown>).title).toBe("Course Introduction");
		expect((result[0].data as Record<string, unknown>).overlayColor).toBe("light");
		expect((result[0].data as Record<string, unknown>).overlayOpacity).toBe(0.8);
	});

	it("converts nested comparison images into an imageComparison block", () => {
		const result = adaptGrammarPreviewBlocks([
			{
				id: "columns-before-after",
				type: "columns",
				data: {
					style: "slider",
					items: [
						{
							id: "before",
							label: "Before assessment",
							width: 1,
							children: [
								{
									id: "image-before",
									type: "image",
									data: { src: "/assets/before.svg", alt: "Before image" },
								},
							],
						},
						{
							id: "after",
							label: "After assessment",
							width: 1,
							children: [
								{
									id: "image-after",
									type: "image",
									data: { src: "/assets/after.svg", alt: "After image" },
								},
							],
						},
					],
				},
			},
			{ id: "divider", type: "divider", data: {} },
		]);
		expect(result[0].type).toBe("imageComparison");
		expect(result[1].type).toBe("divider");
		expect((result[0].data as Record<string, unknown>).display).toBe("slider");
		expect(
			(result[0].data as Record<string, { src: string; altText: string }>).beforeImage,
		).toEqual({
			src: "/assets/before.svg",
			altText: "Before image",
		});
		expect((result[0].data as Record<string, unknown>).beforeLabel).toBe("Before assessment");
		expect((result[0].data as Record<string, unknown>).afterLabel).toBe("After assessment");
	});

	it("preserves explicit side-by-side comparison children", () => {
		const result = adaptGrammarPreviewBlocks([
			{
				id: "columns-before-after",
				type: "columns",
				data: {
					style: "side-by-side",
					preset: "comparison",
					items: [
						{
							id: "before",
							label: "Before",
							width: 1,
							children: [
								{ id: "before-text", type: "text", data: { content: "<p>Old process.</p>" } },
							],
						},
						{
							id: "after",
							label: "After",
							width: 1,
							children: [
								{ id: "after-text", type: "text", data: { content: "<p>New process.</p>" } },
							],
						},
					],
				},
			},
			{ id: "next", type: "text", data: { content: "<p>Outside comparison.</p>" } },
		]);
		const comparison = result[0].data as {
			preset?: string;
			items: Array<{ label?: string; children: PraxityBlock[] }>;
		};
		expect(result).toHaveLength(2);
		expect(result[0].type).toBe("columns");
		expect(comparison.preset).toBe("comparison");
		expect(comparison.items[0]?.label).toBe("Before");
		expect(comparison.items[1]?.label).toBe("After");
		expect(comparison.items[0]?.children[0]?.id).toBe("before-text");
		expect(comparison.items[1]?.children[0]?.id).toBe("after-text");
		expect(result[1].id).toBe("next");
	});

	it("adapts underscore fill-blank markers without discarding the sentence", () => {
		const result = adaptGrammarPreviewBlocks(
			readBlockSource(
				"::: fill-blank Finish these sentences\nI feel ____. Today I will ____.\n:::\n",
			).blocks,
		);
		const response = (result[0].data as { response: { template?: string; blanks: unknown[] } })
			.response;
		expect(response.template).toBe("I feel ____. Today I will ____.");
		expect(response.blanks).toHaveLength(2);
		expect(response.blanks).toEqual([
			expect.objectContaining({ answer: "" }),
			expect.objectContaining({ answer: "" }),
		]);
	});

	it("preserves grammar 4 hotspot assessments into renderer hotspot responses", () => {
		const result = adaptGrammarPreviewBlocks(
			readBlockSource(
				"::: hotspot Select Component A\n![Annotated diagram](/assets/diagram.svg)\n- Component A {x=25 y=30}\n:::\n",
			).blocks,
		);
		const data = result[0].data as {
			assessmentType: string;
			stem: Array<{ data: { content: string } }>;
			response: {
				type: string;
				image: string;
				imageAlt?: string;
				hotspots: Array<{ label?: string; coords: number[] }>;
			};
		};
		expect(data.assessmentType).toBe("hotspot");
		expect(data.stem[0]?.data.content).toContain("Select Component A");
		expect(data.response.type).toBe("hotspot");
		expect(data.response.image).toBe("/assets/diagram.svg");
		expect(data.response.imageAlt).toBe("Annotated diagram");
		expect(data.response.hotspots[0]?.label).toBe("Component A");
		expect(data.response.hotspots[0]?.coords).toEqual([25, 30, 6]);
	});
	it("maps authored hotspot regions to runtime coordinates", () => {
		const source =
			'::: hotspot Diagram\n![Diagram](/assets/diagram.png)\n- Valve {shape=rect x=10 y=20 w=30 h=15 correct}\n- Gauge {shape=ellipse x=60 y=40 rx=8 ry=5}\n- Panel {shape=polygon points="10,10 40,10 40,30 10,30"}\n:::\n';
		const block = adaptGrammarPreviewBlocks(readBlockSource(source).blocks)[0];
		const response = block.data.response as {
			hotspots: Array<{ shape: string; coords: number[] }>;
		};
		expect(response.hotspots.map(({ shape, coords }) => ({ shape, coords }))).toEqual([
			{ shape: "rect", coords: [10, 20, 30, 15] },
			{ shape: "ellipse", coords: [60, 40, 8, 5] },
			{ shape: "polygon", coords: [10, 10, 40, 10, 40, 30, 10, 30] },
		]);
	});
});

it("adapts current nested comparison images without swallowing the following paragraph", () => {
	const source =
		"# Untitled {hideTitle}\n\n::: comparison {layout=slider}\n:: Before {level=3}\n![Before image](/assets/before.webp)\n\n:: After {level=3}\n![After image](/assets/after.webp)\n:::\n\nFollowing paragraph.\n";
	const blocks = adaptGrammarPreviewBlocks(readBlockSource(source).blocks);
	expect(blocks[0]).toMatchObject({
		type: "imageComparison",
		data: {
			display: "slider",
			beforeLabel: "Before",
			afterLabel: "After",
			beforeImage: { src: "/assets/before.webp", altText: "Before image" },
			afterImage: { src: "/assets/after.webp", altText: "After image" },
		},
	});
	expect(blocks).toHaveLength(2);
	expect(blocks[1].data.content).toContain("Following paragraph.");
});

describe("assessment adaptation", () => {
	it("preserves an authored assessment button label through adaptation", () => {
		const result = adaptGrammarPreviewBlocks([
			{
				id: "reflection",
				type: "assessment",
				data: {
					stem: [],
					response: { type: "freeText" },
					buttonLabel: "Keep this in mind",
				},
			},
		]);

		expect(result[0].data.buttonLabel).toBe("Keep this in mind");
	});

	it("maps free-response download controls through adaptation", () => {
		const [result] = adaptGrammarPreviewBlocks(
			readBlockSource("::: free-response What did you notice? {download=both}\n:::\n").blocks,
		);
		expect((result.data.response as { downloadAs?: string }).downloadAs).toBe("both");
	});
});

describe("fill-blank selection adaptation", () => {
	it("keeps per-blank distractors, marked alternatives, and authored option order", () => {
		const [block] = adaptGrammarPreviewBlocks(
			readBlockSource(
				"# Untitled {hideTitle}\n\n::: fill-blank Complete {style=dropdown level=3}\nChoose {red|*blue|green} then {*fast|slow|*quick}.\n:::\n",
			).blocks,
		);
		expect(block.data.response).toMatchObject({
			type: "fillBlank",
			style: "dropdown",
			blanks: [
				{ answer: "blue", choices: ["red", "blue", "green"] },
				{ answer: "fast", alternatives: ["quick"], choices: ["fast", "slow", "quick"] },
			],
		});
	});
	it("preserves duplicate words and distractors in the shared bank", () => {
		const [block] = adaptGrammarPreviewBlocks(
			readBlockSource(
				"# Untitled {hideTitle}\n\n::: fill-blank Complete {style=word-bank level=3}\nChoose {red} and {red}.\nbank: red | blue | red | green\n:::\n",
			).blocks,
		);
		expect(block.data.response).toMatchObject({
			type: "fillBlank",
			style: "word-bank",
			wordBank: ["red", "blue", "red", "green"],
			blanks: [{ answer: "red" }, { answer: "red" }],
		});
	});
});
