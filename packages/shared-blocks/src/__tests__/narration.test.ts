import { describe, expect, it } from "vitest";
import { readBlockFixture } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import {
	deriveNarrationStatus,
	extractNarrationSegments,
	narrationDisplayText,
	narrationScriptText,
	parseNarrationVtt,
	plainNarrationText,
	renderNarrationScript,
	resolveNarrationEnabled,
	validateNarrationCues,
} from "../narration";
import type { PraxityBlock } from "../types";

describe("block narration model", () => {
	it.each(["rt-00000000000000000000000000001003", "00000000-0000-4000-8000-000000001003"])(
		"keeps content revisions independent of child display identity %s",
		(id) => {
			const block: PraxityBlock = {
				id: "00000000-0000-4000-8000-000000000001",
				type: "card",
				data: {
					items: [
						{
							id,
							label: "Front",
							front: [{ id, type: "text", data: { content: "Words" } }],
							back: [],
						},
					],
				},
			};
			expect(extractNarrationSegments("", {}, [block])[0].sourceContent).toBe(
				'{"type":"card","data":{"item":{"back":[],"front":[{"data":{"content":"Words"},"type":"text"}],"label":"Front"}}}',
			);
		},
	);
	it("keeps main's source fingerprints for marked matching and rating blocks", () => {
		const blocks = readBlockFixture(
			"::: match Match\n- Hazard -> Control\n:::\n\n::: rating Confidence\n1. Low\n2. High\n:::\n",
		).blocks;
		const segments = extractNarrationSegments("", {}, blocks);
		expect(segments.find((segment) => segment.blockId === blocks[0].id)?.sourceContent).toBe(
			'{"type":"assessment","data":{"_dontKnow":false,"assessmentType":"matching","feedback":{},"gradingMode":"none","response":{"distractors":[],"inputMethod":"dropdown","pairs":[{"correctMatch":"Control","matchId":"00000000-0000-4000-8000-000000000004","prompt":"Hazard"}],"type":"matching"},"stem":[{"data":{"content":"<p>Match</p>"},"type":"text"}],"stemLevel":2}}',
		);
		expect(segments.find((segment) => segment.blockId === blocks[1].id)?.sourceContent).toBe(
			'{"type":"rating","data":{"label":"Confidence","maxValue":2,"scale":[{"label":"Low","value":1},{"label":"High","value":2}]}}',
		);
	});
	it.each([
		["en", "I don't know"],
		["fr", "Je ne sais pas"],
	])("narrates uncertainty after authored choices in %s", (locale, label) => {
		const segments = extractNarrationSegments(
			"",
			{},
			[
				{
					id: "q",
					type: "assessment",
					data: {
						assessmentType: "choice",
						gradingMode: "none",
						response: {
							type: "choice",
							selectionMode: "single",
							options: [
								{ id: "a", label: "First", isCorrect: true },
								{ id: "b", label: "Last" },
							],
						},
					},
				},
			],
			{},
			locale,
		);
		const script = segments.find((segment) => segment.blockId === "q")?.script ?? "";
		expect(script).toContain(`- Last\n- ${label}`);
	});
	it.each(["card", "tabs", "accordion", "sequence"] as const)(
		"separates a %s item heading from its body in display and synthesis",
		(type) => {
			const [segment] = extractNarrationSegments("", {}, [
				{
					id: "container",
					type,
					data: { items: [{ label: "Assertif", content: "Vous exprimez vos besoins." }] },
				},
			]);
			expect(renderNarrationScript(segment.script)).toBe(
				"<p>Assertif</p>\n<p>Vous exprimez vos besoins.</p>",
			);
			expect(narrationScriptText(segment.script)).toBe(
				"Assertif [pause]\n\nVous exprimez vos besoins.",
			);
			expect(narrationDisplayText(segment.script).trim()).toBe(
				"Assertif \n\nVous exprimez vos besoins.",
			);
			expect(validateNarrationCues(narrationScriptText(segment.script))).toEqual([]);
			expect(JSON.parse(segment.sourceContent).data.item).toEqual({
				label: "Assertif",
				content: "Vous exprimez vos besoins.",
			});
		},
	);

	it("separates a punctuated heading without adding a pause", () => {
		const [segment] = extractNarrationSegments("", {}, [
			{
				id: "card",
				type: "card",
				data: { items: [{ label: "Assertif ?", content: "Vous exprimez vos besoins." }] },
			},
		]);
		expect(renderNarrationScript(segment.script)).toBe(
			"<p>Assertif ?</p>\n<p>Vous exprimez vos besoins.</p>",
		);
		expect(narrationScriptText(segment.script)).toBe("Assertif ?\n\nVous exprimez vos besoins.");
	});

	it("separates headings in both card faces and whole-container derivation", () => {
		const face = (id: string) => [
			{ id: `${id}-heading`, type: "heading" as const, data: { content: "Assertif", level: 2 } },
			{ id: `${id}-body`, type: "text" as const, data: { content: "Vous exprimez vos besoins." } },
		];
		const card: PraxityBlock = {
			id: "card",
			type: "card",
			data: { items: [{ label: "Assertif", front: face("front"), back: face("back") }] },
		};
		for (const segment of extractNarrationSegments("", {}, [card])) {
			expect(renderNarrationScript(segment.script)).toBe(
				"<p>Assertif</p>\n<p>Vous exprimez vos besoins.</p>",
			);
			expect(narrationScriptText(segment.script)).toBe(
				"Assertif [pause]\n\nVous exprimez vos besoins.",
			);
		}
		const [whole] = extractNarrationSegments("", {}, [card], {}, "fr", {
			wholeContainerIds: new Set(["card"]),
		});
		expect(renderNarrationScript(whole.script)).toBe(
			"<p>Assertif</p>\n<p>Vous exprimez vos besoins.</p>",
		);
		expect(narrationScriptText(whole.script)).toBe(
			"Assertif [pause]\n\nVous exprimez vos besoins.",
		);
	});

	it.each(["card", "tabs", "accordion", "sequence"] as const)(
		"keeps a duplicate title's item heading metadata in whole-container %s narration",
		(type) => {
			const [segment] = extractNarrationSegments("", {}, [
				{
					id: "container",
					type,
					data: {
						title: "Assertif",
						items: [{ label: "Assertif", content: "Vous exprimez vos besoins." }],
						narrationAudio: "whole.mp3",
					},
				},
			]);
			expect(segment).toMatchObject({
				id: "container",
				wholeContainer: true,
				audioUrl: "whole.mp3",
				derivedScript: "Assertif [pause]\n\nVous exprimez vos besoins.",
			});
			expect(renderNarrationScript(segment.script)).toBe(
				"<p>Assertif</p>\n<p>Vous exprimez vos besoins.</p>",
			);
		},
	);

	it.each(["card", "tabs", "accordion", "sequence"] as const)(
		"keeps nested tab paragraphs in whole-container %s narration",
		(type) => {
			const children: PraxityBlock[] = [
				{
					id: "tabs",
					type: "tabs",
					data: { items: [{ label: "Assertif", content: "Vous exprimez vos besoins." }] },
				},
			];
			const [segment] = extractNarrationSegments("", {}, [
				{
					id: "outer",
					type,
					data: {
						items: [type === "card" ? { front: children } : { children }],
						narrationAudio: "whole.mp3",
					},
				},
			]);
			expect(renderNarrationScript(segment.script)).toBe(
				"<p>Assertif</p>\n<p>Vous exprimez vos besoins.</p>",
			);
			expect(segment).toMatchObject({
				id: "outer",
				wholeContainer: true,
				audioUrl: "whole.mp3",
				derivedScript: "Assertif [pause]\n\nVous exprimez vos besoins.",
			});
		},
	);

	it.each(["stem", "description"] as const)(
		"keeps nested tab paragraphs in an assessment %s",
		(field) => {
			const [segment] = extractNarrationSegments("", {}, [
				{
					id: "assessment",
					type: "assessment",
					data: {
						[field]: [
							{
								id: "tabs",
								type: "tabs",
								data: { items: [{ label: "Assertif", content: "Vous exprimez vos besoins." }] },
							},
						],
					},
				},
			]);
			expect(renderNarrationScript(segment.script)).toBe(
				"<p>Assertif</p>\n<p>Vous exprimez vos besoins.</p>",
			);
			expect(segment.derivedScript).toBe("Assertif [pause]\n\nVous exprimez vos besoins.");
		},
	);

	it.each([
		["null", { data: null }],
		["string", { data: "invalid" }],
		["missing", {}],
	])("skips blocks with %s data during extraction", (_description, fields) => {
		const blocks = [
			{ id: "before", type: "text", data: { content: "Before" } },
			{ id: "broken-text", type: "text", ...fields },
			{ id: "broken-logic", type: "logic", ...fields },
			{ id: "after", type: "text", data: { content: "After" } },
		] as PraxityBlock[];
		expect(extractNarrationSegments("", {}, blocks).map(({ script }) => script)).toEqual([
			"Before",
			"After",
		]);
	});

	it("extracts showable hidden dialogue turns but leaves plain hidden dialogue out", () => {
		const dialogue = (id: string, name: string) => ({
			id,
			type: "dialogue" as const,
			data: { name, hide: true, turns: [{ id: "item-0", speaker: "roger", paragraphs: [name] }] },
		});
		const blocks = [
			{
				id: "rule",
				type: "logic" as const,
				data: {
					conditions: { operator: "and", rules: [] },
					actions: [{ type: "show", targets: ["@calm-path"] }],
				},
			},
			dialogue("calm", "calm-path"),
			dialogue("plain", "plain-path"),
		] as PraxityBlock[];
		expect(
			extractNarrationSegments("", {}, blocks)
				.filter((s) => s.containerPart === "item")
				.map((s) => [s.blockId, s.conditionalBlockId]),
		).toEqual([["calm", "calm"]]);
	});

	it("marks visible conditions and every narratable member of a hidden heading section", () => {
		const blocks = [
			{
				id: "head",
				type: "heading",
				data: { level: 2, hide: true, name: "scene", content: "Scene" },
			},
			{ id: "line", type: "text", data: { content: "Follow-up" } },
			{ id: "end", type: "heading", data: { level: 2, content: "End" } },
			{
				id: "condition",
				type: "text",
				data: { content: "When ready", visible: "variable:ready is true" },
			},
			{
				id: "rule",
				type: "logic",
				data: {
					conditions: { operator: "and", rules: [] },
					actions: [{ type: "show", targets: ["@scene"] }],
				},
			},
		] as PraxityBlock[];
		expect(
			extractNarrationSegments("", {}, blocks)
				.filter((s) => s.blockId)
				.map((s) => [s.blockId, s.conditionalBlockId]),
		).toEqual([
			["head", "head"],
			["line", "line"],
			["end", undefined],
			["condition", "condition"],
		]);
	});

	it("does not attach a hidden matching heading to the page title clip", () => {
		const blocks = [
			{
				id: "rule",
				type: "logic",
				data: {
					conditions: { operator: "and", rules: [] },
					actions: [{ type: "show", targets: ["@heading"] }],
				},
			},
			{ id: "heading", type: "heading", data: { level: 1, content: "Page", hide: true } },
		] as PraxityBlock[];
		const segments = extractNarrationSegments("Page", {}, blocks);
		expect(segments.find((s) => s.id === "page-title")?.blockId).toBeUndefined();
		expect(segments.find((s) => s.id === "heading")?.conditionalBlockId).toBe("heading");
	});

	it.each(["card", "tabs", "accordion"] as const)(
		"separates conditional words inside a %s item",
		(type) => {
			const child = {
				id: "secret",
				type: "text" as const,
				data: { content: "Secret words", visible: "variable:ready is true" },
			};
			const item =
				type === "card"
					? { id: "one", label: "Public label", front: [child], back: [] }
					: { id: "one", label: "Public label", children: [child] };
			const segments = extractNarrationSegments("", {}, [
				{ id: "container", type, data: { items: [item] } },
			] as PraxityBlock[]);
			expect(segments.find((s) => s.id === "container:item:0")?.derivedScript).not.toContain(
				"Secret words",
			);
			expect(segments.find((s) => s.blockId === "secret")?.conditionalBlockId).toBe("secret");
		},
	);

	it.each(["variable", "logic"] as const)(
		"preserves whole accordion recordings with %s metadata descendants",
		(type) => {
			const container: PraxityBlock = {
				id: "container",
				type: "accordion",
				data: {
					title: "Topics",
					items: [
						{
							label: "Public",
							children: [
								{ id: "public", type: "text", data: { content: "Public text" } },
								{
									id: "metadata",
									type,
									data:
										type === "variable"
											? { variableName: "ready", defaultValue: false }
											: { actions: [{ type: "set", variable: "ready", value: true }] },
								},
							],
						},
					],
					narrationAudio: "whole.mp3",
				},
			};
			for (const options of [
				{},
				{ wholeContainerIds: new Set(["container", "unrelated"]) },
				{ wholeContainerIds: new Set(["container"]) },
			]) {
				expect(extractNarrationSegments("", {}, [container], {}, "en", options)).toMatchObject([
					{
						id: "container",
						wholeContainer: true,
						script: "Topics\n\nPublic [pause]\n\nPublic text",
						audioUrl: "whole.mp3",
						disabled: false,
					},
				]);
			}
		},
	);

	it.each(["card", "tabs", "accordion", "sequence"] as const)(
		"splits whole-container %s recordings when a descendant has independent visibility",
		(type) => {
			const child = { id: "secret", type: "text" as const, data: { content: "Secret words" } };
			const item =
				type === "card"
					? { label: "Public", front: [child] }
					: { label: "Public", children: [child] };
			const container = { id: "container", type, data: { title: "Topics", items: [item] } };
			const rule = {
				id: "rule",
				type: "logic" as const,
				data: { actions: [{ type: "hide", targets: ["@secret"] }] },
			};
			for (const options of [
				{ wholeContainerIds: new Set(["container", "unrelated"]) },
				{ wholeContainerIds: new Set(["container"]) },
			]) {
				const segments = extractNarrationSegments("", {}, [container, rule], {}, "en", options);
				expect(segments.some((segment) => segment.wholeContainer)).toBe(false);
				expect(segments.find((segment) => segment.id === "container:item:0")?.script).toBe(
					"Public",
				);
				expect(segments.find((segment) => segment.id === "secret")).toMatchObject({
					script: "Secret words",
					ancestorBlockIds: ["container"],
				});
			}
			const inline = {
				...container,
				data: {
					...container.data,
					narration: "Topics Public Secret words",
					narrationAudio: "legacy.mp3",
				},
			};
			const segments = extractNarrationSegments("", {}, [inline, rule]);
			expect(segments.find((segment) => segment.id === "container")?.script).toBe("Topics");
			expect(segments.some((segment) => segment.audioUrl === "legacy.mp3")).toBe(false);
			const conditional = { ...child, data: { ...child.data, visible: "variable:ready is true" } };
			const conditionalItem =
				type === "card"
					? { label: "Public", front: [conditional] }
					: { label: "Public", children: [conditional] };
			const visibleSegments = extractNarrationSegments(
				"",
				{},
				[{ ...container, data: { ...container.data, items: [conditionalItem] } }],
				{},
				"en",
				{ wholeContainerIds: new Set(["container"]) },
			);
			expect(visibleSegments.find((segment) => segment.id === "secret")?.conditionalBlockId).toBe(
				"secret",
			);
			expect(visibleSegments.some((segment) => segment.wholeContainer)).toBe(false);
		},
	);

	it("keeps a card-back segment's saved identity while extracting its conditional child", () => {
		const segments = extractNarrationSegments("", {}, [
			{
				id: "card",
				type: "card",
				data: {
					items: [
						{
							id: "one",
							label: "Front",
							front: [],
							narrationBack: { narration: "Back summary" },
							back: [
								{
									id: "secret-back",
									type: "text",
									data: {
										content: "Secret back words",
										visible: "variable:ready is true",
									},
								},
							],
						},
					],
				},
			},
		] as PraxityBlock[]);
		expect(segments.find((s) => s.id === "card:item:0:back")?.itemSide).toBe("back");
		expect(segments.find((s) => s.blockId === "secret-back")?.conditionalBlockId).toBe(
			"secret-back",
		);
	});

	it("keeps a nested hidden heading section conditional inside a tab", () => {
		const segments = extractNarrationSegments("", {}, [
			{
				id: "rule",
				type: "logic",
				data: {
					conditions: { operator: "and", rules: [] },
					actions: [{ type: "show", targets: ["@scene"] }],
				},
			},
			{
				id: "tabs",
				type: "tabs",
				data: {
					items: [
						{
							id: "one",
							label: "Details",
							children: [
								{
									id: "scene",
									type: "heading",
									data: { level: 2, name: "scene", hide: true, content: "Secret heading" },
								},
								{ id: "line", type: "text", data: { content: "Secret section" } },
								{ id: "end", type: "heading", data: { level: 2, content: "Next" } },
							],
						},
					],
				},
			},
		] as PraxityBlock[]);
		expect(segments.find((s) => s.id === "tabs:item:0")?.derivedScript).not.toContain(
			"Secret section",
		);
		expect(segments.find((s) => s.blockId === "scene")?.conditionalBlockId).toBe("scene");
		expect(segments.find((s) => s.blockId === "line")?.conditionalBlockId).toBe("line");
		expect(segments.find((s) => s.blockId === "end")?.conditionalBlockId).toBeUndefined();
	});

	it("does not absorb plain hidden or hide-targeted child words into a tab item", () => {
		const segments = extractNarrationSegments("", {}, [
			{
				id: "rule",
				type: "logic",
				data: {
					conditions: { operator: "and", rules: [] },
					actions: [{ type: "hide", targets: ["@target"] }],
				},
			},
			{
				id: "tabs",
				type: "tabs",
				data: {
					items: [
						{
							id: "one",
							label: "Public label",
							children: [
								{ id: "plain", type: "text", data: { content: "Never speak", hidden: true } },
							],
						},
						{
							id: "two",
							label: "Another label",
							children: [{ id: "target", type: "text", data: { content: "Separate words" } }],
						},
					],
				},
			},
		] as PraxityBlock[]);
		expect(segments.find((s) => s.id === "tabs:item:0")?.derivedScript).toBe("Public label");
		expect(segments.find((s) => s.blockId === "plain")).toBeUndefined();
		expect(segments.find((s) => s.id === "tabs:item:1")?.derivedScript).toBe("Another label");
		expect(segments.find((s) => s.blockId === "target")?.script).toBe("Separate words");
	});

	describe("dialogue narration", () => {
		const dialogue = (data: Record<string, unknown>, id = "d1") =>
			({ id, type: "dialogue", data }) as unknown as PraxityBlock;
		const turns = [
			{
				id: "item-0",
				speaker: "Roger",
				name: "Roger",
				voice: "Adrian",
				paragraphs: ["[curious] Hello.", "See [the guide](https://example.com)."],
			},
			"junk",
			{ id: "item-2", speaker: "roxanne", name: "Tom & 'Jerry' <b>", paragraphs: ["Fine."] },
			{ id: "item-3", speaker: "ghost", name: "ghost", paragraphs: ["Boo."] },
			{ id: "item-4", paragraphs: ["No speaker."] },
		];
		const ofBlock = (segments: ReturnType<typeof extractNarrationSegments>, id = "d1") =>
			segments.filter((segment) => segment.blockId === id);

		it("narrates the caption, then each turn in its speaker's voice without speaking names", () => {
			const segments = ofBlock(
				extractNarrationSegments(
					"",
					{},
					[dialogue({ caption: "At the office", turns })],
					{ narrationVoice: "Maya" },
					"en",
				),
			);
			expect(
				segments.map((s) => [
					s.id,
					s.containerPart,
					s.itemIndex,
					s.script,
					s.speaker,
					s.settings.voice,
				]),
			).toEqual([
				["d1", "intro", undefined, "At the office", undefined, "Maya"],
				["d1:item:0", "item", 0, "[curious] Hello.\n\nSee the guide.", "Roger", "Adrian"],
				["d1:item:2", "item", 2, "Fine.", "Tom & 'Jerry' <b>", "Maya"],
				["d1:item:3", "item", 3, "Boo.", "ghost", "Maya"],
				["d1:item:4", "item", 4, "No speaker.", undefined, "Maya"],
			]);
			expect(segments[1].overrides).toEqual({});
			expect(segments.map((s) => s.label)).toEqual([
				"At the office",
				"Roger",
				"Tom & 'Jerry' <b>",
				"ghost",
				"Turn 5",
			]);
		});

		it("keeps escaped literal brackets in turn scripts and transcripts", async () => {
			const { narrationDisplayText } = await import("@praxity/content-model/narration-display");
			const [segment] = ofBlock(
				extractNarrationSegments("", {}, [
					dialogue({
						turns: [{ speaker: "Roger", paragraphs: [String.raw`Use \[warm] as literal text.`] }],
					}),
				]),
			);
			expect(segment.script).toBe(String.raw`Use \[warm] as literal text.`);
			expect(narrationDisplayText(segment.script)).toBe(String.raw`Use \[warm] as literal text.`);
			expect(renderNarrationScript(narrationDisplayText(segment.script))).toContain("[warm]");
			const [closing] = ofBlock(
				extractNarrationSegments("", {}, [
					dialogue({ turns: [{ paragraphs: [String.raw`Use \] literally.`] }] }),
				]),
			);
			expect(closing.script).toBe(String.raw`Use \] literally.`);
		});

		it("speaks link labels in a dialogue caption", () => {
			const [intro] = ofBlock(
				extractNarrationSegments("", {}, [
					dialogue({ caption: "See [the guide](https://example.com).", turns: [] }),
				]),
			);
			expect(intro.script).toBe("See the guide.");
			const [literal] = ofBlock(
				extractNarrationSegments("", {}, [
					dialogue({ caption: String.raw`Use \[warm] literally.`, turns: [] }),
				]),
			);
			expect(literal.script).toBe(String.raw`Use \[warm] literally.`);
		});

		it("speaks glossary terms without their definitions in turns and captions", () => {
			const segments = ofBlock(
				extractNarrationSegments("", {}, [
					dialogue({
						caption: "Review [PPE]{protective equipment}.",
						turns: [{ speaker: "Alex", paragraphs: ["Wear [PPE]{protective equipment}."] }],
					}),
				]),
			);
			expect(segments.map((segment) => segment.script)).toEqual(["Review PPE.", "Wear PPE."]);
		});

		it("omits the intro without a caption and lets a segment override beat the speaker voice", () => {
			const segments = ofBlock(
				extractNarrationSegments("", {}, [
					dialogue({ turns: [{ ...(turns[0] as object), narrationVoice: "Zoe" }] }),
				]),
			);
			expect(segments.map((s) => [s.id, s.settings.voice, s.overrides.voice])).toEqual([
				["d1:item:0", "Zoe", "Zoe"],
			]);
		});

		it("anchors turns by dialogue name, speaker key and words only", () => {
			const source = (turn: Record<string, unknown>, name?: string) =>
				extractNarrationSegments("", {}, [
					dialogue({ ...(name ? { name } : {}), turns: [turn] }),
				]).find((segment) => segment.containerPart === "item")?.sourceContent;
			const base = { id: "item-0", speaker: "Roger", name: "Roger", paragraphs: ["Hi."] };
			expect(
				source({ ...base, id: "item-7", name: "Roger Smith", avatar: "a.png", voice: "V" }),
			).toBe(source(base));
			expect(source({ ...base, speaker: "ROGER" })).toBe(source(base));
			expect(source({ ...base, speaker: "rog" })).not.toBe(source(base));
			expect(source({ ...base, paragraphs: ["Hi!"] })).not.toBe(source(base));
			expect(source(base, "intro-talk")).not.toBe(source(base));
			const withA11y = {
				...dialogue({ turns: [base] }),
				a11y: { label: "x" },
			} as unknown as PraxityBlock;
			expect(
				extractNarrationSegments("", {}, [withA11y]).find(
					(segment) => segment.containerPart === "item",
				)?.sourceContent,
			).toBe(source(base));
			const captionBlock = dialogue({ caption: "Hello", turns: [base] });
			expect(
				extractNarrationSegments("", {}, [
					{ ...captionBlock, a11y: { label: "x" } } as PraxityBlock,
				]).find((segment) => segment.containerPart === "intro")?.sourceContent,
			).toBe(
				extractNarrationSegments("", {}, [captionBlock]).find(
					(segment) => segment.containerPart === "intro",
				)?.sourceContent,
			);
		});

		it("splits a dialogue nested in a card face and keeps its card target", () => {
			const card = {
				id: "c1",
				type: "card",
				data: { items: [{ label: "Front", front: [dialogue({ turns: [turns[0]] }, "d2")] }] },
			} as unknown as PraxityBlock;
			const segments = extractNarrationSegments("", {}, [card]);
			const turn = segments.find((segment) => segment.id === "d2:item:0");
			expect(turn?.speaker).toBe("Roger");
			expect(turn?.cardTargets).toEqual([{ containerId: "c1", itemIndex: 0, side: "front" }]);
			expect(() =>
				extractNarrationSegments("", {}, [card], {}, "en", { wholeContainerIds: new Set(["c1"]) }),
			).not.toThrow();
		});

		it("skips hidden dialogues and malformed data", () => {
			expect(
				extractNarrationSegments("", {}, [
					dialogue({ hide: true, turns }),
					dialogue({ turns: "nope" }, "d2"),
				]).filter((segment) => segment.blockId),
			).toEqual([]);
		});
	});

	it("keeps authored inline punctuation and French spaces in derived narration", () => {
		const english = plainNarrationText(
			'<p><span class="inline-tooltip-trigger">magnification</span>, <mark>focus</mark>, and alignment.</p>',
		);
		const french = plainNarrationText(
			'<p>Le <span class="inline-tooltip-trigger">grossissement</span>, le <mark>réglage</mark>\u00a0: alignement.</p>',
		);
		expect(english).toBe("magnification, focus, and alignment.");
		expect(french).toBe("Le grossissement, le réglage\u00a0: alignement.");
		expect(plainNarrationText("<p>First</p><p>Second</p>")).toBe("First Second");
		expect(plainNarrationText("<table><tr><td>A</td><td>B</td></tr></table>")).toBe("A B");
		expect(plainNarrationText("<dl><dt>Term</dt><dd>Definition</dd></dl>")).toBe("Term Definition");
		expect(plainNarrationText("A&nbsp;: B")).toBe("A\u00a0: B");
		expect(
			extractNarrationSegments("", {}, [
				{ id: "en", type: "text", data: { content: english } },
				{ id: "fr", type: "text", data: { content: french } },
			]).map(({ script }) => script),
		).toEqual([english, french]);
	});

	it("derives a four-item text list as a spoken and rendered list", () => {
		const items = ["Previous and next", "Course outline", "Transcript", "Larger text"];
		const [segment] = extractNarrationSegments("", {}, [
			{
				id: "navigation-list",
				type: "text",
				data: { content: `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>` },
			},
		]);
		expect(segment.script).toBe(items.map((item) => `- ${item}`).join("\n"));
		expect(renderNarrationScript(segment.script)).toBe(
			`<ul>\n${items.map((item) => `<li>${item}</li>`).join("\n")}\n</ul>`,
		);
		expect(narrationScriptText(segment.script)).toBe(items.join("\n\n"));
	});

	it("keeps numbered and nested list items in derived narration", () => {
		const [segment] = extractNarrationSegments("", {}, [
			{
				id: "nested-list",
				type: "text",
				data: {
					content:
						'<ol start="3"><li>First<ul><li>Detail A</li><li>Detail B</li></ul></li><li>Second</li></ol>',
				},
			},
		]);
		expect(segment.script).toBe("3. First\n  - Detail A\n  - Detail B\n4. Second");
		expect(renderNarrationScript(segment.script)).toBe(
			'<ol start="3">\n<li>First\n<ul>\n<li>Detail A</li>\n<li>Detail B</li>\n</ul></li>\n<li>Second</li>\n</ol>',
		);
		expect(narrationScriptText(segment.script)).toBe("First\n\nDetail A\n\nDetail B\n\nSecond");
	});

	it("speaks repeated assessment children in authored order", () => {
		const [segment] = extractNarrationSegments("", {}, [
			{
				id: "question",
				type: "assessment",
				data: {
					stem: [
						{ id: "first", type: "text", data: { content: "Stop." } },
						{ id: "second", type: "text", data: { content: "Stop." } },
					],
				},
			},
		]);
		expect(narrationScriptText(segment.script)).toBe("Stop. Stop.");
	});

	it("restarts separate numbered assessment child lists", () => {
		const [segment] = extractNarrationSegments("", {}, [
			{
				id: "question",
				type: "assessment",
				data: {
					stem: [
						{ id: "first", type: "text", data: { content: "<ol><li>One</li><li>Two</li></ol>" } },
						{
							id: "second",
							type: "text",
							data: { content: "<ol><li>Three</li><li>Four</li></ol>" },
						},
					],
				},
			},
		]);
		expect(renderNarrationScript(segment.script)).toBe(
			"<ol>\n<li>One</li>\n<li>Two</li>\n</ol>\n<ol>\n<li>Three</li>\n<li>Four</li>\n</ol>",
		);
	});

	it("keeps list boundaries through other derived blocks and container children", () => {
		const content = "<ul><li>One</li><li>Two</li></ul>";
		const segments = extractNarrationSegments("", {}, [
			{ id: "note", type: "note", data: { title: "Remember", content } },
			{
				id: "card",
				type: "card",
				data: {
					items: [{ label: "Front", front: [{ id: "child", type: "text", data: { content } }] }],
				},
			},
			{
				id: "question",
				type: "assessment",
				data: {
					stem: [{ id: "prompt", type: "text", data: { content: "Prompt" } }],
					description: [{ id: "details", type: "text", data: { content } }],
				},
			},
		]);
		expect(segments.find((segment) => segment.id === "note")?.script).toBe(
			"Remember\n\n- One\n- Two",
		);
		expect(segments.find((segment) => segment.id === "card:item:0")?.script).toBe(
			"Front [pause]\n\n- One\n- Two",
		);
		expect(segments.find((segment) => segment.id === "question")?.script).toBe(
			"Prompt\n\n- One\n- Two",
		);
		expect(segments.find((segment) => segment.id === "note")?.sourceContent).toContain(content);
	});

	it("carries each containing card face to nested clips in authored order", () => {
		const segments = extractNarrationSegments("", {}, [
			{
				id: "outer",
				type: "card",
				data: {
					narrationVoice: "Maya",
					items: [
						{
							front: [{ id: "front", type: "text", data: { content: "Opening" } }],
							back: [
								{
									id: "inner",
									type: "card",
									data: {
										items: [
											{
												front: [
													{
														id: "inner-front",
														type: "text",
														data: { content: "Question", narration: "Custom question" },
													},
												],
												back: [{ id: "inner-back", type: "text", data: { content: "Answer" } }],
											},
										],
									},
								},
							],
						},
					],
				},
			},
		]);
		expect(segments.map(({ script }) => script)).toEqual(["Opening", "Custom question", "Answer"]);
		expect(segments[1].cardTargets).toEqual([
			{ containerId: "outer", itemIndex: 0, side: "back" },
			{ containerId: "inner", itemIndex: 0, side: "front" },
		]);
		expect(segments[2].cardTargets?.at(-1)?.side).toBe("back");
		expect(segments.every(({ settings }) => settings.voice === "Maya")).toBe(true);
	});

	it.each(["single", "multi", "choice"])(
		"reads visible %s options without exposing grading",
		(type) => {
			const options = [
				{
					label: "<strong>First</strong> answer",
					text: "<strong>First</strong> answer",
					isCorrect: true,
					correct: true,
					feedback: "Secret feedback",
				},
				{ label: "Second answer!", text: "Second answer!", isCorrect: false },
				null,
				{ label: "", text: "", feedback: "Hidden explanation" },
			];
			const [segment] = extractNarrationSegments("", {}, [
				{
					id: "q",
					type: "assessment",
					data: {
						question: "Which answer?",
						instructions: "Choose one.",
						...(type === "choice"
							? { response: { type, options } }
							: { assessmentType: type, options }),
						correctAnswer: "Secret key",
						feedback: "Hidden explanation",
					},
				},
			]);
			expect(segment.script).toContain(
				"Which answer? Choose one.\n\n- First answer\n- Second answer!",
			);
			expect(renderNarrationScript(segment.script)).toContain(
				"<ul>\n<li>First answer</li>\n<li>Second answer!</li>\n</ul>",
			);
			expect(narrationScriptText(segment.script)).toContain(
				"Choose one.\n\nFirst answer\n\nSecond answer!",
			);
			expect(segment.script).not.toMatch(/Secret|Hidden|isCorrect|true|false/);
			expect(segment.pauseAfter).toBe(true);
		},
	);

	it("keeps authored narration overrides and never reads fill-blank answers", () => {
		const segments = extractNarrationSegments("", {}, [
			{
				id: "custom",
				type: "assessment",
				data: {
					question: "Question",
					narration: "Authored instructions.",
					response: { type: "choice", options: [{ label: "Visible answer" }] },
				},
			},
			{
				id: "blank",
				type: "assessment",
				data: {
					question: "Complete the blank.",
					response: { type: "fillBlank", blanks: [{ answer: "Secret key" }] },
				},
			},
		]);
		expect(segments[0].script).toBe("Authored instructions.");
		expect(segments[0].derivedScript).toContain("- Visible answer");
		expect(segments[1].script).toBe("Complete the blank.");
	});
	it("builds a title-first matrix without hidden answers or media", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "text",
				type: "text",
				data: { content: "<p>Visible <a href='https://x.test'>label</a>.</p>" },
			},
			{
				id: "choice",
				type: "assessment",
				data: {
					stem: [{ id: "stem", type: "text", data: { content: "Pick one." } }],
					response: {
						type: "choice",
						options: [{ label: "Visible option", correct: true, feedback: "Hidden feedback" }],
					},
				},
			},
			{ id: "video", type: "video", data: { src: "assets/demo.mp4", caption: "Do not read" } },
			{ id: "hidden", type: "text", data: { content: "Hidden", hide: true } },
		];
		const segments = extractNarrationSegments("Welcome", {}, blocks, {}, "en");
		expect(segments.map((segment) => segment.id)).toEqual(["page-title", "text", "choice"]);
		expect(segments[2].script).toContain("Pick one.");
		expect(segments[2].script).toContain("- Visible option");
		expect(segments[2].script).not.toContain("Hidden feedback");
		expect(segments[2].pauseAfter).toBe(true);
	});

	it("does not repeat a leading heading that matches the page title", () => {
		const segments = extractNarrationSegments("Welcome", {}, [
			{ id: "heading", type: "heading", data: { content: "Welcome" } },
			{ id: "text", type: "text", data: { content: "Opening text." } },
		]);
		expect(segments.map((segment) => segment.id)).toEqual(["page-title", "text"]);
		expect(segments[0].blockId).toBe("heading");
	});

	it("keeps the visible heading narratable when the matching page title is disabled", () => {
		const segments = extractNarrationSegments("Welcome", { narrationDisabled: true }, [
			{ id: "heading", type: "heading", data: { content: "Welcome", level: 1 } },
		]);
		expect(segments.map((segment) => segment.id)).toEqual(["page-title", "heading"]);
		expect(segments[0].disabled).toBe(true);
		expect(segments[1]).toMatchObject({ script: "Welcome", disabled: false, blockId: "heading" });
	});

	it("derives representative content-matrix scripts and review boundaries", () => {
		const segments = extractNarrationSegments(
			"Matrix",
			{},
			[
				{ id: "note", type: "note", data: { title: "Notice", content: "Read this." } },
				{ id: "stats", type: "stats", data: { items: [{ value: "42", label: "Cases" }] } },
				{ id: "image", type: "image", data: { alt: "A safe workstation", caption: "Setup" } },
				{ id: "decorative", type: "image", data: { decorative: true, alt: "Ignored" } },
				{ id: "chart", type: "chart", data: {} },
				{ id: "table", type: "table", data: { caption: "Quarterly totals" } },
				{ id: "code", type: "code", data: { language: "js", title: "Example" } },
				{ id: "equation", type: "equation", data: {} },
				{
					id: "columns",
					type: "columns",
					data: {
						columns: [
							{ children: [{ id: "child", type: "text", data: { content: "Column text" } }] },
						],
					},
				},
				{
					id: "tabs",
					type: "tabs",
					data: { title: "Topics", items: [{ label: "First", content: "Visible panel" }] },
				},
				{ id: "control", type: "checklist", data: { title: "Safety check" } },
				{ id: "media", type: "video", data: { title: "Do not narrate" } },
				{ id: "embed", type: "embed", data: { title: "External activity" } },
			] as PraxityBlock[],
			{},
			"en",
		);
		const byId = Object.fromEntries(segments.map((segment) => [segment.id, segment]));
		expect(byId.decorative).toMatchObject({
			script: "",
			derivedScript: "",
			needsDraftReview: false,
		});
		expect(Object.keys(byId)).not.toContain("media");
		expect(byId.note.script).toBe("Notice Read this.");
		expect(byId.stats.script).toBe("Cases 42");
		expect(byId.table.script).toContain("Review the table");
		expect(byId.code.script).not.toContain("raw code");
		expect(byId.child.script).toBe("Column text");
		expect(byId.tabs.pauseAfter).toBe(false);
		expect(byId.control.pauseAfter).toBe(true);
		expect(byId.chart.needsDraftReview).toBe(true);
		expect(deriveNarrationStatus({ needsDraftReview: true })).toBe("needsReview");
		expect(byId.embed.pauseAfter).toBe(true);
		const changedTable = extractNarrationSegments("Matrix", {}, [
			{ id: "table", type: "table", data: { caption: "Quarterly totals", rows: [["99"]] } },
		])[1];
		expect(changedTable.sourceContent).not.toBe(byId.table.sourceContent);
	});

	it("narrates every item in multi-item containers", () => {
		for (const type of ["accordion", "tabs", "sequence", "card"] as const) {
			const itemContent = (label: string, content: string, index: number) => ({
				id: `${type}-${index}`,
				label,
				...(type === "card"
					? {
							front: [{ id: `${type}-text-${index}`, type: "text", data: { content } }],
							back: [],
						}
					: {
							children: [{ id: `${type}-text-${index}`, type: "text", data: { content } }],
						}),
			});
			const segments = extractNarrationSegments("Containers", {}, [
				{
					id: type,
					type,
					data: {
						items: [
							itemContent("First item", "First body", 1),
							itemContent("Second item", "Second body", 2),
						],
					},
				} as PraxityBlock,
			]).filter(({ blockId }) => blockId === type);

			expect(segments.map(({ script }) => script)).toEqual([
				"First item [pause]\n\nFirst body",
				"Second item [pause]\n\nSecond body",
			]);
			expect(segments.map(({ itemIndex }) => itemIndex)).toEqual([0, 1]);
			expect(new Set(segments.map(({ id }) => id)).size).toBe(2);
			expect(segments.every(({ pauseAfter }) => !pauseAfter)).toBe(true);
		}
	});

	it("keeps nested items ordered, inherits defaults, and excludes hidden bodies and reads both card faces", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "outer",
				type: "accordion",
				data: {
					title: "Overview",
					instructions: "Open each item.",
					narrationVoice: "Maya",
					items: [
						{
							label: "First",
							children: [
								{ id: "before", type: "text", data: { content: "Before" } },
								{
									id: "nested",
									type: "card",
									data: {
										narrationSpeed: 0.8,
										items: [
											{
												label: "Card",
												front: [{ id: "front", type: "text", data: { content: "Front" } }],
												back: [{ id: "back", type: "text", data: { content: "Secret answer" } }],
											},
										],
									},
								},
								{
									id: "after",
									type: "text",
									data: { content: "After", narration: "Custom after" },
								},
							],
						},
						{
							label: "Second",
							narrationDisabled: true,
							children: [
								{ id: "hidden", type: "text", visible: false, data: { content: "Invisible" } },
								{ id: "hidden2", type: "text", data: { content: "Hidden", hide: true } },
								{ id: "visible", type: "text", data: { content: "Visible" } },
							],
						},
					],
				},
			},
		];
		const segments = extractNarrationSegments("", {}, blocks);
		expect(segments.map(({ script }) => script)).toEqual([
			"Overview Open each item.",
			"First",
			"Before",
			"Card [pause]\n\nFront",
			"Secret answer",
			"Custom after",
			"Second [pause]\n\nVisible",
		]);
		expect(segments.every(({ settings }) => settings.voice === "Maya")).toBe(true);
		expect(segments[3].settings.speed).toBe(0.8);
		expect(segments.at(-1)?.disabled).toBe(true);
		blocks[0].data.narrationDisabled = true;
		expect(extractNarrationSegments("", {}, blocks).every(({ disabled }) => disabled)).toBe(true);
	});

	it("preserves whole-container overrides while introduction recordings keep their item boundaries", () => {
		const block: PraxityBlock = {
			id: "tabs",
			type: "tabs",
			data: {
				title: "Topics",
				items: [
					{ label: "One", content: "First body" },
					{ label: "Two", content: "Second body" },
				],
				narration: "Authored full script",
				narrationAudio: "old.mp3",
			},
		};
		expect(extractNarrationSegments("", {}, [block])).toMatchObject([
			{ script: "Authored full script", audioUrl: "old.mp3", wholeContainer: true },
		]);
		block.data.narrationContainerSplit = true;
		block.data.narrationDisabled = true;
		block.data.narrationVoice = "Daniel";
		expect(extractNarrationSegments("", {}, [block]).map(({ script }) => script)).toEqual([
			"Authored full script",
			"One [pause]\n\nFirst body",
			"Two [pause]\n\nSecond body",
		]);
		const split = extractNarrationSegments("", {}, [block]);
		expect(split.map(({ disabled }) => disabled)).toEqual([true, false, false]);
		expect(split.map(({ settings }) => settings.voice)).toEqual(["Daniel", undefined, undefined]);
	});

	it("keeps native media as a playback boundary", () => {
		const segments = extractNarrationSegments("Media", {}, [
			{ id: "before", type: "text", data: { content: "Before media." } },
			{ id: "audio", type: "audio", data: { src: "clip.mp3" } },
			{ id: "after", type: "text", data: { content: "After media." } },
		]);
		expect(segments.find(({ id }) => id === "before")?.pauseAfter).toBe(true);
	});

	it("resolves nearest enablement and exposes manual timing fallback", () => {
		expect(resolveNarrationEnabled(undefined, undefined)).toBe(false);
		expect(resolveNarrationEnabled(true, false)).toBe(false);
		expect(deriveNarrationStatus({ audioUrl: "a.mp3", manual: true })).toBe("manualNoTimings");
		expect(
			deriveNarrationStatus({
				audioUrl: "a.mp3",
				manual: true,
				sourceHash: "new",
				reviewedSourceHash: "old",
			}),
		).toBe("needsReview");
		expect(
			extractNarrationSegments(
				"Legacy page",
				{ narration: "assets/old-page.mp3", captions: "assets/old-page.vtt" },
				[],
			)[0]?.audioUrl,
		).toBeUndefined();
	});

	it("accepts only positive finite recorded durations", () => {
		const durations = [1.25, undefined, 0, -1, Number.POSITIVE_INFINITY, Number.NaN].map(
			(narrationDuration) =>
				extractNarrationSegments("Page", { narrationDuration }, [])[0]?.duration,
		);

		expect(durations).toEqual([1.25, undefined, undefined, undefined, undefined, undefined]);
	});

	it("keeps explicitly accepted generated audio ready for its current inputs", () => {
		expect(
			deriveNarrationStatus({
				audioUrl: "assets/narration/narration-abc123def456.mp3",
				provenanceCurrent: false,
				acceptedInputsCurrent: true,
			}),
		).toBe("ready");
	});

	it("rejects unknown expressive cues and malformed timing files", () => {
		expect(validateNarrationCues("[whispering] Hello. [made up] Bye.")).toEqual(["[made up]"]);
		expect(parseNarrationVtt("not vtt")).toBeNull();
		expect(parseNarrationVtt("WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nHello.")).toEqual([
			{ start: 0, end: 1, text: "Hello." },
		]);
	});
});

describe("authored narration formatting", () => {
	it("speaks escaped delivery cues as words and keeps their brackets in the transcript", () => {
		const script = String.raw`Use \[warm] as literal text.`;
		const speech = narrationScriptText(script);
		expect(validateNarrationCues(speech)).toEqual([]);
		expect(speech).toBe("Use warm as literal text.");
		expect(renderNarrationScript(script)).toBe("<p>Use [warm] as literal text.</p>");
	});

	it("shares words and boundaries between semantic reading and plain speech", async () => {
		const { renderNarrationScript, narrationScriptText } = await import("../narration");
		const script =
			"# A heading\n\nRead **bold** and *italic* words.\n\n- First item\n- Second item\n\n3. Third\n4. Fourth\n\n## Detail\n\n[warm] Keep the cue.";
		expect(renderNarrationScript(script)).toBe(
			'<h3>A heading</h3>\n<p>Read <strong>bold</strong> and <em>italic</em> words.</p>\n<ul>\n<li>First item</li>\n<li>Second item</li>\n</ul>\n<ol start="3">\n<li>Third</li>\n<li>Fourth</li>\n</ol>\n<h4>Detail</h4>\n<p>Keep the cue.</p>',
		);
		expect(narrationScriptText(script)).toBe(
			"A heading\n\nRead bold and italic words.\n\nFirst item\n\nSecond item\n\nThird\n\nFourth\n\nDetail\n\n[warm] Keep the cue.",
		);
		expect(validateNarrationCues(narrationScriptText(script))).toEqual([]);
		const [segment] = extractNarrationSegments("", {}, [
			{ id: "stable", type: "text", data: { content: "Summary", narration: script } },
		]);
		expect(segment).toMatchObject({ id: "stable", script });
	});

	it("escapes authored HTML and leaves non-emphasis syntax and entities literal", async () => {
		const { renderNarrationScript, narrationScriptText } = await import("../narration");
		const literal = '<img src=x onerror="alert(1)"> &amp; @icon{star} {{answer}} [warm]';
		expect(renderNarrationScript(literal)).toBe(
			"<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp;amp; @icon{star} {{answer}}</p>",
		);
		expect(narrationScriptText(literal)).toBe(literal);
		expect(narrationScriptText("  Plain   text.\nSoft wrap.  ")).toBe("Plain text. Soft wrap.");
	});
});

describe("learner narration delivery directions", () => {
	it("projects known delivery directions without changing authored speech or meaningful brackets", async () => {
		const { narrationDisplayText, narrationScriptText, renderNarrationScript } = await import(
			"../narration"
		);
		const source =
			"[sincerely] **Charts** belong to [star watcher]. [delighted] Yes! [sighs] [laughs]";
		expect(renderNarrationScript(source)).toBe(
			"<p><strong>Charts</strong> belong to [star watcher]. Yes! [sighs] [laughs]</p>",
		);
		expect(narrationScriptText(source)).toBe(
			"[sincerely] Charts belong to [star watcher]. [delighted] Yes! [sighs] [laughs]",
		);
		for (const literal of [
			"[1]",
			"[night observers]",
			"[telescope operators]",
			"[warm](https://example.org)",
			"[happy][reference]",
			"[warm][]",
			"[calm]: https://example.org",
			String.raw`\[warm]`,
			"[a [warm] note]",
		]) {
			expect(narrationDisplayText(literal)).toBe(literal);
		}
		expect(
			narrationDisplayText(
				"[whispering] [slowly] [low voice] [breathy] [long pause] Hello.",
			).trim(),
		).toBe("Hello.");
		expect(narrationDisplayText("[sincerely][delighted]Hello [warm][pause].")).toBe("Hello .");
		expect(narrationDisplayText("[warm][sighs] Hello [laughs][pause].")).toBe(
			"[sighs] Hello [laughs].",
		);
		expect(narrationDisplayText("Say [sincerely]: Hello.")).toBe("Say : Hello.");
	});

	it("projects existing tagged VTT cues for both regular and deck sentence alignment", () => {
		expect(
			parseNarrationVtt(
				"WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n[sincerely] Hello [star watcher].\n\n00:00:01.000 --> 00:00:02.000\n[long pause]\n\n00:00:02.000 --> 00:00:03.000\n[sighs] Goodbye.",
			),
		).toEqual([
			{ start: 0, end: 1, text: "Hello [star watcher]." },
			{ start: 2, end: 3, text: "[sighs] Goodbye." },
		]);
	});
});
