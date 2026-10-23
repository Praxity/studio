import { getNavPreset, readLesson } from "@praxity/grammar";
import { BLOCK_TYPES, type PraxityBlock, type PraxityPage } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import {
	blockRequiresPageGate,
	planModuleRuntime,
	planPageRuntime,
	type RuntimePlanningConfig,
} from "../runtime-plan";

const plainConfig: RuntimePlanningConfig = { sourceLocale: "en" };
const staticConfig: RuntimePlanningConfig = {
	...plainConfig,
	navigationStyle: "sidebar",
	navToggles: { navTopBar: false, showA11yPill: false },
};

function page(blocks: PraxityBlock[] = [], overrides: Partial<PraxityPage> = {}): PraxityPage {
	return { id: "page", title: "Page", blocks, ...overrides };
}

describe("planPageRuntime", () => {
	it.each(["rule", "visibility"] as const)(
		"%s selects self-check dependencies from a writer in a later module",
		(kind) => {
			const current = page([
				{
					id: "flag",
					type: "variable",
					data: { variableName: "flag", dataType: "boolean", defaultValue: false },
				},
				kind === "visibility"
					? { id: "reader", type: "text", data: { content: "Conditional", visible: "flag" } }
					: {
							id: "reader",
							type: "logic",
							data: {
								conditions: {
									operator: "and",
									rules: [{ source: "variable:flag", comparison: "is", value: true }],
								},
								actions: [{ type: "disableCompletion", reason: "Complete practice" }],
							},
						},
			]);
			const later = page(
				[
					{ id: "practice", name: "Practice", type: "selfCheck", data: {} },
					{
						id: "writer",
						type: "logic",
						data: {
							conditions: {
								operator: "and",
								rules: [
									{ source: "block:Practice", field: "isCompleted", comparison: "is", value: true },
								],
							},
							actions: [{ type: "setVariable", target: "flag", value: true }],
						},
					},
				],
				{ id: "later" },
			);
			expect(
				planPageRuntime({ ...staticConfig, pages: [current, later] }, current, true).islands,
			).toContain("selfCheck");
		},
	);

	it.each([true, false, undefined])(
		"self-check required=%s uses the page-gate owner",
		(required) => {
			expect(blockRequiresPageGate({ id: "practice", type: "selfCheck", data: { required } })).toBe(
				required === true,
			);
		},
	);
	it("does not select tooltips from block identity metadata", () => {
		expect(
			planPageRuntime(
				staticConfig,
				page([{ id: "inline-tooltip-trigger", type: "text", data: { content: "<p>Plain</p>" } }]),
				true,
			).islands,
		).toEqual([]);
	});
	it("ignores tooltip-shaped literal tasks while retaining surrounding rich tooltips", () => {
		const source =
			"# Practice\n::: accordion\n:: Panel\n::: self-check Write inline-tooltip-trigger.\nmodel: Model\n:: Criterion\nmissed: Hint\n:::\n:::\n";
		const literal = readLesson(source).pages[0];
		expect(planPageRuntime(staticConfig, literal, true).islands).toEqual([
			"accordion",
			"selfCheck",
		]);
		const rich = readLesson(`${source}\nRead [Term]{Definition}.\n`).pages[0];
		expect(planPageRuntime(staticConfig, rich, true).islands).toEqual([
			"accordion",
			"selfCheck",
			"tooltip",
		]);
	});
	it("enhances embeddable frames while keeping bookmarks and unsupported hosts static", () => {
		const embed: PraxityBlock = {
			id: "embed",
			type: "embed",
			data: { src: "https://www.google.com/maps/embed" },
		};
		expect(planPageRuntime(staticConfig, page([embed]), true).islands).toEqual(["media"]);
		for (const data of [{ src: "https://example.com" }, { ...embed.data, display: "bookmark" }]) {
			expect(
				planPageRuntime(staticConfig, page([{ ...embed, data } as PraxityBlock]), true).islands,
			).toEqual([]);
		}
	});
	it.each(["audio", "video"] as const)(
		"enhances %s transcripts without requiring clip bounds",
		(type) => {
			expect(
				planPageRuntime(
					staticConfig,
					page([
						{
							id: "media",
							type,
							data: {
								src: "assets/media.mp4",
								transcript: "Spoken words",
							},
						} as PraxityBlock,
					]),
					true,
				).islands,
			).toEqual([type === "audio" ? "narration" : "media"]);
		},
	);
	it("mounts narration when only a showable hidden turn has audio", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "rule",
				type: "logic",
				data: {
					conditions: { operator: "and", rules: [] },
					actions: [{ type: "show", targets: ["@path"] }],
				},
			},
			{
				id: "path",
				type: "dialogue",
				data: {
					name: "path",
					hide: true,
					turns: [
						{
							id: "item-0",
							speaker: "Roger",
							paragraphs: ["Welcome."],
							narrationAudio: "assets/branch.mp3",
						},
					],
				},
			},
		];
		expect(
			planPageRuntime(staticConfig, page(blocks, { narrationEnabled: true }), true).islands,
		).toContain("narration");
	});

	it("selects table sizing only on pages containing tables", () => {
		const table: PraxityBlock = {
			id: "table",
			type: "table",
			data: { headers: ["Label", "Detail"], rows: [["One", "Long explanation"]] },
		};
		expect(planPageRuntime(staticConfig, page([table]), true).islands).toEqual(["table"]);
		expect(planPageRuntime(staticConfig, page(), true).islands).toEqual([]);
		expect(() => planPageRuntime(staticConfig, page([table]), new Set())).toThrow(
			"Required island assets unavailable: table",
		);
	});
	it.each(BLOCK_TYPES)("has an explicit published-runtime decision for %s", (type) => {
		expect(() =>
			planPageRuntime(staticConfig, page([{ id: type, type, data: {} }]), true),
		).not.toThrow();
	});

	it("keeps an explicitly no-enhancement sidebar page static", () => {
		expect(planPageRuntime(staticConfig, page(), true)).toEqual({
			mode: "static",
			islands: [],
			legacyReasons: [],
		});
	});

	it("keeps charts static without a learner inspection island", () => {
		expect(
			planPageRuntime(staticConfig, page([{ id: "chart", type: "chart", data: {} }]), true),
		).toEqual({
			mode: "static",
			islands: [],
			legacyReasons: [],
		});
	});
	it("keeps dialogue static without an island", () => {
		expect(
			planPageRuntime(
				staticConfig,
				page([{ id: "dialogue", type: "dialogue", data: { turns: [] } }]),
				true,
			),
		).toEqual({ mode: "static", islands: [], legacyReasons: [] });
	});

	it("keeps non-scrolling sequence layouts on the native static renderer", () => {
		const sequence = {
			id: "timeline",
			type: "sequence",
			data: {
				variant: "timeline",
				orientation: "horizontal",
				alignment: "center",
				distribution: "scaled",
				scrollable: false,
				items: [
					{ id: "start", label: "2000", children: [] },
					{ id: "finish", label: "2010", children: [] },
				],
			},
		} as unknown as PraxityBlock;

		expect(planPageRuntime(staticConfig, page([sequence]), true)).toEqual({
			mode: "static",
			islands: [],
			legacyReasons: [],
		});
	});

	it("loads the tiny sequence enhancer for a scrollable horizontal layout", () => {
		const sequence = {
			id: "timeline",
			type: "sequence",
			data: {
				variant: "timeline",
				orientation: "horizontal",
				scrollable: true,
				items: [],
			},
		} as unknown as PraxityBlock;

		expect(planPageRuntime(staticConfig, page([sequence]), true)).toEqual({
			mode: "islands",
			islands: ["sequence"],
			legacyReasons: [],
		});
	});

	it("loads only the page capabilities that have islands", () => {
		const config = { sourceLocale: "en", navToggles: getNavPreset("sidebar") };
		const blocks = [
			{ id: "chart", type: "chart", data: {} },
			{
				id: "text",
				type: "text",
				data: { content: '<span class="praxity-doodle" data-doodle="circle">term</span>' },
			},
		] as PraxityBlock[];

		expect(planPageRuntime(config, page(blocks), true)).toEqual({
			mode: "islands",
			islands: ["nav"],
			legacyReasons: [],
		});
	});

	it("keeps authored doodles static inside an assessment group", () => {
		const blocks = [
			{
				id: "group",
				type: "assessmentGroup",
				data: { groupName: "@highlight.red{Checkpoint}", memberBlockIds: [] },
			},
		] as PraxityBlock[];

		expect(planPageRuntime(staticConfig, page(blocks), true)).toEqual({
			mode: "islands",
			islands: ["assessmentGroup"],
			legacyReasons: [],
		});
	});

	it("loads inline tooltip behavior as an explicit page capability", () => {
		const candidate = page([
			{
				id: "text",
				type: "text",
				data: {
					content:
						'<p><span class="inline-tooltip-trigger" data-tooltip-content="Meaning">Term</span></p>',
				},
			},
		]);

		expect(planPageRuntime(staticConfig, candidate, new Set(["tooltip"]))).toEqual({
			mode: "islands",
			islands: ["tooltip"],
			legacyReasons: [],
		});
	});

	it("fails compilation when required island assets are unavailable", () => {
		expect(() =>
			planPageRuntime(
				staticConfig,
				page([{ id: "check", type: "checklist", data: { items: [] } }]),
				false,
			),
		).toThrow("Required island assets unavailable: checklist");
	});

	it("names every missing island bundle in the compile error", () => {
		expect(() =>
			planPageRuntime(
				staticConfig,
				page([
					{ id: "card", type: "card", data: { items: [] } },
					{ id: "assessment", type: "assessment", data: {} },
				]),
				new Set(["card"]),
			),
		).toThrow("Required island assets unavailable: assessment");
	});

	it("keeps consumed metadata blocks off the legacy path", () => {
		const blocks = [
			{ id: "page", type: "pageBreak", data: {} },
			{ id: "block", type: "blockBreak", data: {} },
			{ id: "resource", type: "resourceEntry", data: { includeInResourcesPage: false } },
		] as PraxityBlock[];
		expect(planPageRuntime(staticConfig, page(blocks), true)).toEqual({
			mode: "static",
			islands: [],
			legacyReasons: [],
		});
	});

	it("fails compilation for a new block without a published renderer", () => {
		const unsupported = { id: "future", type: "futureBlock", data: {} } as unknown as PraxityBlock;
		expect(() => planPageRuntime(staticConfig, page([unsupported]), true)).toThrow(
			'Unsupported published block type "futureBlock"',
		);
	});

	it("uses the modular card island and plans interactive descendants", () => {
		const candidate = page([
			{
				id: "card",
				type: "card",
				data: {
					items: [
						{
							id: "item",
							front: [{ id: "check", type: "checklist", data: { items: [] } }],
							back: [],
						},
					],
				},
			},
		] as PraxityBlock[]);
		expect(planPageRuntime(staticConfig, candidate, true)).toEqual({
			mode: "islands",
			islands: ["card", "checklist"],
			legacyReasons: [],
		});
	});

	it("plans native interactive descendants inside cards", () => {
		const card = {
			id: "card",
			type: "card",
			data: {
				items: [
					{
						id: "item",
						front: [{ id: "rating", type: "rating", data: {} }],
						back: [],
					},
				],
			},
		} as unknown as PraxityBlock;
		const plan = planPageRuntime(staticConfig, page([card]), true);
		expect(plan).toEqual({
			mode: "islands",
			islands: ["card", "rating"],
			legacyReasons: [],
		});
	});

	it.each(["accordion", "tabs"] as const)(
		"plans conditional and interactive descendants inside %s",
		(type) => {
			const container = {
				id: type,
				type,
				data: {
					items: [
						{
							id: "item",
							title: "Item",
							children: [
								{ id: "conditional", type: "text", data: { content: "Hi", visible: "flag" } },
								{ id: "rating", type: "rating", data: {} },
							],
						},
					],
				},
			} as unknown as PraxityBlock;

			expect(planPageRuntime(staticConfig, page([container]), true)).toEqual({
				mode: "islands",
				islands: [type, "logic", "nav", "rating"].sort(),
				legacyReasons: [],
			});
		},
	);

	it("loads conditional islands only for interactive block variants", () => {
		const blocks = [
			{
				id: "comparison",
				type: "imageComparison",
				data: { display: "slider", beforeImage: {}, afterImage: {} },
			},
			{
				id: "graphic",
				type: "labeledGraphic",
				data: { imageSrc: "image.png", imageAlt: "", labels: [], reveal: "click" },
			},
		] as PraxityBlock[];

		expect(planPageRuntime(staticConfig, page(blocks), true)).toEqual({
			mode: "islands",
			islands: ["imageComparison", "labeledGraphic"],
			legacyReasons: [],
		});
	});

	it("keeps non-interactive comparison and labeled graphic variants static", () => {
		const blocks = [
			{
				id: "comparison",
				type: "imageComparison",
				data: { display: "side-by-side", beforeImage: {}, afterImage: {} },
			},
			{
				id: "graphic",
				type: "labeledGraphic",
				data: { imageSrc: "image.png", imageAlt: "", labels: [], reveal: "all" },
			},
		] as PraxityBlock[];

		expect(planPageRuntime(staticConfig, page(blocks), true)).toEqual({
			mode: "static",
			islands: [],
			legacyReasons: [],
		});
	});

	it("loads the owning players for clip bounds, compact audio and embeds", () => {
		const blocks = [
			{
				id: "youtube",
				type: "video",
				data: { src: "https://youtu.be/abc123", startTime: 3, endTime: 9 },
			},
			{
				id: "direct",
				type: "video",
				data: { source: { type: "url", src: "assets/clip.mp4" }, startTime: 2 },
			},
			{
				id: "vimeo",
				type: "video",
				data: { src: "https://vimeo.com/123456", endTime: 12 },
			},
			{
				id: "audio",
				type: "audio",
				data: { src: "assets/audio.mp3", autoplay: true },
			},
		] as unknown as PraxityBlock[];

		expect(planPageRuntime(staticConfig, page(blocks), true)).toEqual({
			mode: "islands",
			islands: ["media", "narration"],
			legacyReasons: [],
		});
		expect(
			planPageRuntime(
				staticConfig,
				page([
					blocks[0],
					{ id: "plain", type: "video", data: { src: "assets/clip.mp4", autoplay: true } },
				] as PraxityBlock[]),
				true,
			),
		).toEqual({ mode: "islands", islands: ["media"], legacyReasons: [] });
	});

	it("plans grouped assessments as cooperating islands", () => {
		const blocks = [
			{
				id: "group",
				type: "assessmentGroup",
				data: { groupName: "Checkpoint", mode: "all", memberBlockIds: ["question"] },
			},
			{
				id: "question",
				type: "assessment",
				data: { assessmentType: "choice", response: { type: "choice", options: [] } },
			},
		] as PraxityBlock[];

		expect(planPageRuntime(staticConfig, page(blocks), true)).toEqual({
			mode: "islands",
			islands: ["assessment", "assessmentGroup"],
			legacyReasons: [],
		});
	});

	it.each(["diagram", "interactiveVideo"] as const)("rejects retired %s blocks", (blockType) => {
		expect(() =>
			planPageRuntime(
				staticConfig,
				page([{ id: "retired", type: blockType, data: {} } as unknown as PraxityBlock]),
				true,
			),
		).toThrow(`Block type "${blockType}" has been retired`);
	});

	it("routes page action buttons through the native navigation island", () => {
		expect(
			planPageRuntime(
				staticConfig,
				page([
					{
						id: "continue",
						type: "button",
						data: { action: "goToPage", targetPageId: "__next_page__" },
					},
				]),
				true,
			),
		).toEqual({ mode: "islands", islands: ["nav"], legacyReasons: [] });
	});

	it("plans interactive keyboard-only navigation with the gate-aware island", () => {
		expect(
			planPageRuntime(
				{
					...staticConfig,
					navigationStyle: "none",
					navToggles: { navOutline: false, navPrevNext: false, navKeyboardArrows: true },
				},
				page([{ id: "checklist", type: "checklist", data: { items: [], required: true } }]),
				true,
			),
		).toEqual({ mode: "islands", islands: ["checklist", "nav"], legacyReasons: [] });
	});

	it("adds gate-aware navigation only for required interactions", () => {
		expect(
			planPageRuntime(
				staticConfig,
				page([{ id: "checklist", type: "checklist", data: { items: [], required: true } }]),
				true,
			),
		).toEqual({ mode: "islands", islands: ["checklist", "nav"], legacyReasons: [] });
		expect(
			planPageRuntime(
				staticConfig,
				page([{ id: "checklist", type: "checklist", data: { items: [] } }]),
				true,
			),
		).toEqual({ mode: "islands", islands: ["checklist"], legacyReasons: [] });
	});

	it.each([
		page([{ id: "logic", type: "logic", data: { conditions: {}, actions: [] } }]),
		page([{ id: "text", type: "text", data: { content: "Hi", visible: "score > 0" } }]),
	])("loads page-scoped logic for $blocks.0.type blocks", (candidate) => {
		expect(planPageRuntime(staticConfig, candidate, true)).toEqual({
			mode: "islands",
			islands: ["logic", "nav"],
			legacyReasons: [],
		});
	});

	it.each(["embedded", "custom", "minimal", "scroll"] as const)(
		"plans %s navigation with the native island",
		(navigationStyle) => {
			expect(planPageRuntime({ ...plainConfig, navigationStyle }, page(), true)).toEqual({
				mode: "islands",
				islands: ["nav"],
				legacyReasons: [],
			});
		},
	);

	it("uses native slides for course-defined slide styles", () => {
		expect(
			planPageRuntime(
				{ ...plainConfig, navigationStyle: "slides", slideStyles: { hero: {} } },
				page([], { data: { style: "hero" } }),
				true,
			),
		).toEqual({ mode: "islands", islands: ["nav"], legacyReasons: [] });
	});

	it("loads narration as a page-scoped island", () => {
		expect(
			planPageRuntime(
				plainConfig,
				page([], {
					narrationEnabled: true,
					data: { narration: "Listen.", narrationAudio: "assets/narration.mp3" },
				}),
				true,
			),
		).toEqual({ mode: "islands", islands: ["narration", "nav"], legacyReasons: [] });
	});

	it("keeps default sidebar navigation native for plain and narrated pages", () => {
		const plain = planPageRuntime(plainConfig, page(), true);
		const narrated = planPageRuntime(
			plainConfig,
			page([], {
				narrationEnabled: true,
				data: { narration: "Listen.", narrationAudio: "assets/narration.mp3" },
			}),
			true,
		);

		expect(plain).toEqual({ mode: "islands", islands: ["nav"], legacyReasons: [] });
		expect(narrated).toEqual({
			mode: "islands",
			islands: ["narration", "nav"],
			legacyReasons: [],
		});
	});

	it.each([
		{ navigationStyle: "bottomBar" as const },
		{ navigationStyle: "slides" as const },
		{
			navigationStyle: "sidebar" as const,
			navToggles: {
				navOutline: false,
				navHamburgerMenu: true,
				navTopBar: false,
				showA11yPill: false,
			},
		},
	])("uses the native nav island for $navigationStyle outlines", (config) => {
		expect(planPageRuntime({ ...plainConfig, ...config }, page(), true)).toEqual({
			mode: "islands",
			islands: ["nav"],
			legacyReasons: [],
		});
	});

	it.each([
		["bottom arrows", { navBottomArrows: true }],
		["edge arrows", { navEdgeArrows: true }],
		["swipe gestures", { navSwipeGestures: true }],
		["floating TOC", { navFloatingToc: true }],
		["scroll progress", { navScrollProgress: true }],
	] as const)("plans %s with the native navigation island", (_feature, navToggles) => {
		expect(
			planPageRuntime({ ...plainConfig, navigationStyle: "sidebar", navToggles }, page(), true),
		).toEqual({ mode: "islands", islands: ["nav"], legacyReasons: [] });
	});

	it.each([
		["right outline position", { navOutline: true, navOutlinePosition: "right" as const }],
		["top previous/next position", { navPrevNext: true, navPrevNextPosition: "top" as const }],
	] as const)("ignores stale %s legacy fields", (_field, navToggles) => {
		expect(
			planPageRuntime({ ...plainConfig, navigationStyle: "sidebar", navToggles }, page(), true),
		).toEqual({ mode: "islands", islands: ["nav"], legacyReasons: [] });
	});

	it("uses the native nav island for the implicit sidebar default", () => {
		expect(planPageRuntime(plainConfig, page(), true)).toEqual({
			mode: "islands",
			islands: ["nav"],
			legacyReasons: [],
		});
	});

	it.each(["sidebar", "none"] as const)(
		"keeps explicitly no-enhancement %s pages static",
		(navigationStyle) => {
			const config =
				navigationStyle === "sidebar" ? { ...staticConfig } : { ...plainConfig, navigationStyle };
			expect(planPageRuntime(config, page(), true)).toEqual({
				mode: "static",
				islands: [],
				legacyReasons: [],
			});
		},
	);

	it("does not promote disabled navigation features", () => {
		expect(
			planPageRuntime(
				{
					sourceLocale: "en",
					navToggles: {
						navTopBar: false,
						navBottomArrows: false,
						navHamburgerMenu: false,
						showA11yPill: false,
					},
				},
				page(),
				true,
			),
		).toMatchObject({ mode: "static", legacyReasons: [] });
	});
});

it("plans module presentation with the content capabilities of every slide", () => {
	const pages = [
		page([], { id: "first" }),
		page([{ id: "question", type: "assessment", data: {} }], { id: "second" }),
	];
	expect(planModuleRuntime(plainConfig, pages, true)).toEqual({
		mode: "islands",
		presentation: "module-deck",
		islands: ["assessment", "deck"],
		legacyReasons: [],
	});
	expect(() => planModuleRuntime(plainConfig, pages, new Set(["nav", "assessment"]))).toThrow(
		"Missing module deck runtime asset",
	);
});

it("plans an options-only optional self-check gate in every dependent module", () => {
	const first = page([{ id: "optional", type: "selfCheck", data: {} }], { id: "first" });
	const later = page([], { id: "later" });
	expect(
		planModuleRuntime({ ...plainConfig, pages: [first, later] }, [later], true, {
			gates: { optional: "attempt" },
		}).islands,
	).toEqual(["deck", "selfCheck"]);
});
