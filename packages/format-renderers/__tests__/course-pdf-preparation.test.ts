import type { PraxityBlock } from "@praxity/content-model";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { describe, expect, it } from "vitest";
import { readLessonFixture as readBlockSource } from "../../grammar/__tests__/helpers/lesson-fixture.ts";
import {
	buildCoursePdfSource,
	type CoursePdfOptions,
	narrationPieces,
} from "../src/pipelines/course-pdf.ts";
import { coursePdfTheme } from "../src/pipelines/course-pdf-theme.ts";

const block = (
	id: string,
	type: PraxityBlock["type"],
	data: Record<string, unknown>,
): PraxityBlock => ({ id, type, data });
const course = (
	blocks: PraxityBlock[],
	options: Partial<CoursePdfOptions> = {},
): CoursePdfOptions => ({
	title: "Workbook",
	locale: "en",
	lessons: [{ id: "lesson", title: "Lesson", locale: "en", blocks }],
	...options,
});
const text = (id: string, content: string) => block(id, "text", { content });
const question = (id: string): PraxityBlock =>
	block(id, "assessment", {
		stem: [text(`${id}-stem`, "Choose.")],
		response: {
			type: "choice",
			selectionMode: "single",
			options: [
				{ id: `${id}-a`, label: "Yes", isCorrect: true },
				{ id: `${id}-b`, label: "No" },
			],
		},
	});

describe("course PDF preparation and host boundary", () => {
	it("draws numbered rectangle, oval and polygon marks over hotspot answers", () => {
		const source = buildCoursePdfSource(
			course(
				[
					block("hotspot", "assessment", {
						stem: [text("prompt", "Select the valve")],
						response: {
							type: "hotspot",
							mode: "select",
							image: "/assets/diagram.png",
							imageAlt: "Equipment",
							hotspots: [
								{
									id: "valve",
									shape: "rect",
									coords: [10, 20, 30, 15],
									label: "Valve",
									isCorrect: true,
								},
								{
									id: "gauge",
									shape: "ellipse",
									coords: [60, 40, 8, 5],
									label: "Gauge",
									isCorrect: true,
								},
								{
									id: "panel",
									shape: "polygon",
									coords: [10, 10, 40, 10, 40, 30],
									label: "Panel",
									isCorrect: true,
								},
							],
						},
					}),
				],
				{ includeAnswerSheet: true },
			),
		).typstSource;
		expect(source).toContain("rect(width: dims.width * 0.3");
		expect(source).toContain("ellipse(width: dims.width * 0.16");
		expect(source).toContain("polygon(stroke: 1.5pt + black");
		expect(source).toContain("#pdf.artifact[");
	});
	it("rejects conditional legacy disclosure items before their adapter drops visibility", () => {
		expect(() =>
			buildCoursePdfSource(
				course([
					block("accordion", "accordion", {
						items: [{ title: "Conditional", content: "SECRET", visible: "score > 0" }],
					}),
				]),
			),
		).toThrow("Conditional visibility");
	});
	it("maps the course theme to contrast-safe print tokens and staged fonts only", () => {
		const design = {
			colorAccent: "#ffd400",
			typography: {
				pairing: "book",
				body: { fontFamily: ["Source Sans 3", "sans-serif"] },
				headings: { fontFamily: ["Source Serif 4", "serif"] },
			},
		};
		const theme = coursePdfTheme(design, new Set(["source-sans-3", "source-serif-4"]));
		const accent = /px-accent = rgb\("(#[0-9a-f]{6})"\)/.exec(theme.preamble)?.[1] as string;
		expect(contrastRatio(accent, "#ffffff")).toBeGreaterThanOrEqual(4.5);
		expect(theme.preamble).toContain('#set text(font: ("Source Sans 3", "Libertinus Serif",)');
		expect(theme.preamble).toContain('px-heading-font = ("Source Serif 4", "Libertinus Serif",)');
		expect([...theme.fonts].sort()).toEqual(["source-sans-3", "source-serif-4"]);
		expect(coursePdfTheme(design, new Set()).fonts.size).toBe(0);
		// A dark theme surface must not become the print tint.
		const dark = coursePdfTheme(
			{ colorBackgroundLight: "#000000", colorAccent: "#ffffff" },
			new Set(),
		).preamble;
		const hex = (name: string) =>
			new RegExp(`${name} = rgb\\("(#[0-9a-f]{6})"\\)`).exec(dark)?.[1] as string;
		for (const [name, ratio] of [
			["px-ink", 7],
			["px-accent", 4.5],
		] as const)
			for (const surface of ["#ffffff", hex("px-tint")])
				expect(contrastRatio(hex(name), surface)).toBeGreaterThanOrEqual(ratio);
		// Slides flow continuously with a rule between them; only lessons start a new sheet.
		const slides = buildCoursePdfSource(
			course(readBlockSource("# First\n\n# Second {hideTitle}\n\nNext\n").blocks),
		).typstSource;
		expect(slides.match(/#pagebreak\(weak: true\)/g)).toHaveLength(1);
		expect(slides.match(/#px-break/g)).toHaveLength(1);
		// A navigation label is shown only where no heading opens the slide.
		expect(slides).toContain("#px-eyebrow[Second]");
		expect(slides).not.toContain("#px-eyebrow[First]");
		expect(slides).not.toContain("#px-slide(");
	});
	it("splits narration into sentence pieces without breaking emphasis or lists", () => {
		expect(
			narrationPieces(
				"<p>First. “Second!” <strong>Bold one. Still bold.</strong> Last?</p>\n<ul>\n<li>A. B.</li>\n</ul>",
			),
		).toEqual([
			["First.", "“Second!”", "<strong>Bold one. Still bold.</strong> Last?"],
			["<ul>\n<li>A. B.</li>\n</ul>"],
		]);
		expect(narrationPieces("<h3>Important warning</h3>\n<p>Body.</p>")).toEqual([
			["<strong>Important warning</strong>"],
			["Body."],
		]);
	});

	it("keeps a nested narration list and its following item together in PDF notes", () => {
		const narration = "- First\n  - Detail\n- Second";
		expect(
			narrationPieces("<ul>\n<li>First\n<ul>\n<li>Detail</li>\n</ul></li>\n<li>Second</li>\n</ul>"),
		).toEqual([["<ul>\n<li>First\n<ul>\n<li>Detail</li>\n</ul></li>\n<li>Second</li>\n</ul>"]]);
		const source = buildCoursePdfSource(
			course([block("narrated", "text", { content: "Visible", narration })]),
		).typstSource;
		expect(source).toMatch(/#list\(\[First\s+#list\(\[Detail\]\)\], \[Second\]\)/);
	});

	it("prints sources as footnotes, drops source-only disclosures and footnotes heading definitions", () => {
		const source = buildCoursePdfSource(
			course(
				readBlockSource(
					"# Term {hideTitle}\n\n## [Term]{Heading definition.}\n\nBody [word]{Body definition.}.@source{A source.}\n\n::: accordion\n:: Sources {level=2}\n@sources\n:::\n",
				).blocks,
			),
		).typstSource;
		expect(source).toContain("#footnote[A source\\.]");
		expect(source).toContain("Term#footnote[Heading definition\\.]");
		expect(source).toContain("word (Body definition\\.)");
		expect(source).not.toContain("Sources");
		const narratedBlocks = readBlockSource(
			"# Untitled {hideTitle}\n\n::: accordion\n:: Sources\n@sources\n:::\n",
		).blocks;
		const disclosure = narratedBlocks.find((block) => block.type === "accordion");
		if (!disclosure) throw new Error("Missing narrated PDF disclosure fixture");
		disclosure.data.narration = "KEEPSCRIPT";
		const narrated = buildCoursePdfSource(course(narratedBlocks)).typstSource;
		expect(narrated).toContain("KEEPSCRIPT");
	});

	it("keeps authored image wraps, sizes and weighted columns", () => {
		const source = buildCoursePdfSource(
			course(
				readBlockSource(
					"# Untitled {hideTitle}\n\n::: float {side=right}\n![Wrapped](/assets/a.png){size=medium}\n\nBESIDE\n:::\n\nBELOW\n\n![Stacked](/assets/b.png){size=small alignment=right}\n\n::: float {side=left}\n![Large](/assets/c.png){size=large}\n\nSTACKED\n:::\n\n::: columns\n:: {weight=2}\nLEFT\n\n::\nRIGHT\n:::\n",
				).blocks,
			),
		).typstSource;
		// Medium floats wrap on their authored side; the image is read first.
		expect(source).toMatch(/#px-float\(right, 0\.5, \[[\s\S]*Wrapped[\s\S]*BESIDE/);
		expect(source.indexOf("BELOW")).toBeGreaterThan(source.indexOf("BESIDE"));
		// Stacked images print at the published share and alignment.
		expect(source).toMatch(/size\.width \* 0\.33[\s\S]*align\(right/);
		// A large float stacks, as the published page does at print width.
		expect(source).not.toContain("#px-float(left");
		expect(source).toMatch(/#px-columns\(false, \(0\.6+\d*fr, 0\.3+\d*fr,\)/);
	});

	it("retains named anchors, linked contents and lesson bookmarks", () => {
		const input = course(
			readBlockSource(
				"# Safety\n\n[Back](#safetyTip)\n\n# Next page {hideTitle}\n\n::: text {name=safetyTip}\nDestination\n:::\n",
			).blocks,
		);
		const source = buildCoursePdfSource(input).typstSource;
		expect(source).toContain("bookmarked: true");
		expect(source).toContain("bookmarked: false, outlined: false)[Contents]");
		expect(source).toContain("[Next page]");
		expect(source).toContain(Buffer.from("lesson/safetyTip").toString("hex"));
	});
	it("preserves suppression of comparison child captions through normalization", () => {
		const input = course([
			block("comparison", "columns", {
				style: "slider",
				items: [
					{
						id: "before-item",
						label: "Before",
						children: [
							block("before", "image", {
								src: "/assets/before.png",
								alt: "Before",
								caption: "HIDDEN CAPTION",
								captionEnabled: false,
							}),
						],
					},
					{
						id: "after-item",
						label: "After",
						children: [
							block("after", "image", {
								src: "/assets/after.png",
								alt: "After",
								caption: "Visible caption",
							}),
						],
					},
				],
			}),
		]);
		const source = buildCoursePdfSource(input).typstSource;
		expect(source).not.toContain("HIDDEN CAPTION");
		expect(source).toContain("Visible caption");
	});
	it("collects sources after question/answer separation and uses first insertion on each logical page", () => {
		const q = question("q");
		q.data.feedback = {
			correct: [
				text(
					"feedback",
					'<p>KEYONLY<span data-footer-content="KEYSOURCE">source</span><span data-tooltip-content="KEYDEFINITION">KEYTERM</span></p>',
				),
			],
		};
		const input = course([
			text("intro", '<p>Read<span data-footer-content="BODY SOURCE">source</span>.</p>'),
			text("insert", '<p><span data-footer-insert="true">@footer.insert</span></p>'),
			text("after", "AFTER INSERT"),
			text("second", '<p><span data-footer-insert="true">@footer.insert</span></p>'),
			q,
			block("page2", "pageBreak", {}),
			text("next", '<p>Next<span data-footer-content="NEXT SOURCE">source</span>.</p>'),
		]);
		input.lessons[0].design = { glossaryPage: true };
		const handout = buildCoursePdfSource(input).typstSource;
		expect(handout).toContain("BODY SOURCE");
		expect(handout.match(/BODY SOURCE/g)).toHaveLength(1);
		expect(handout.indexOf("BODY SOURCE")).toBeLessThan(handout.indexOf("AFTER INSERT"));
		// Sources print as native page footnotes at their references; list placeholders are dropped.
		expect(handout.match(/#footnote\[/g)).toHaveLength(2);
		expect(handout).not.toContain("@footer.insert");
		expect(handout).not.toContain("KEY");
		const keyed = buildCoursePdfSource({ ...input, includeAnswerSheet: true }).typstSource;
		expect(keyed.slice(0, keyed.indexOf("#heading(level: 1)[Answer sheet]"))).not.toContain("KEY");
		for (const value of ["KEYONLY", "KEYSOURCE", "KEYTERM", "KEYDEFINITION"])
			expect(keyed).toContain(value);
	});

	it("excludes hidden subtrees before normalization, asset discovery, narration and static checks", () => {
		const input = course([
			block("hidden", "accordion", {
				hide: true,
				items: [
					{
						children: [
							block("conditional", "text", { visible: "score > 2", content: "SECRET" }),
							block("image", "image", { src: "/assets/missing.png", alt: "SECRET" }),
						],
					},
				],
				narration: "SECRET",
			}),
			text("visible", "Visible"),
		]);
		const result = buildCoursePdfSource(input);
		expect(result.assetSources.size).toBe(0);
		expect(result.typstSource).not.toContain("SECRET");
		expect(result.typstSource).toContain("Visible");
	});

	it("prints custom narration, not derived repetitions or disabled scripts", () => {
		const input = course([
			block("custom", "text", {
				content: "Visible text",
				narration: "[whispering] **Custom** supplement.",
			}),
			block("disabled", "text", {
				content: "Visible disabled script",
				narration: "SECRET",
				narrationDisabled: true,
			}),
			block("dialogue", "dialogue", {
				turns: [
					{
						id: "roxanne-turn",
						speaker: "roxanne",
						name: "Roxanne",
						paragraphs: ["Visible reply."],
						narration: "A private thought.",
					},
				],
			}),
		]);
		const result = buildCoursePdfSource(input).typstSource;
		expect(result).toContain('#px-slide("Narration", ((false, false, [');
		expect(result).toContain("#px-eyebrow[Roxanne]");
		expect(result).toContain("A private thought\\.");
		// A chart the script does not narrate breaks out across both columns.
		const wide = buildCoursePdfSource(
			course([
				block("spoken", "text", { content: "Spoken", narration: "Script." }),
				block("figure", "chart", {
					altText: "Chart",
					data: { labels: ["A"], series: [{ name: "S", values: [1] }] },
				}),
			]),
		).typstSource;
		expect(wide).toContain("(true, false, [");
		expect(result).toContain("#strong[Custom]");
		expect(result).not.toContain("whispering");
		expect(result).not.toContain("SECRET");
		expect(result.match(/Visible text/g)).toHaveLength(1);
		expect(result.indexOf("Visible text")).toBeLessThan(result.indexOf("#strong[Custom]"));
		// Scripts sit in the slide's notes column, after all of its visible content.
		expect(result.indexOf("Visible disabled script")).toBeLessThan(
			result.indexOf("#strong[Custom]"),
		);
	});

	it("numbers nested questions once and validates group references", () => {
		const input = course([
			block("group", "assessmentGroup", {
				groupName: "Practice",
				mode: "oneOf",
				memberBlockIds: ["q1", "q2"],
			}),
			question("q1"),
			block("card", "card", {
				headings: false,
				items: [
					{
						id: "face",
						backId: "face-back",
						label: "Card",
						front: [text("front", "Front content")],
						back: [question("q2")],
					},
				],
			}),
		]);
		const result = buildCoursePdfSource({ ...input, includeAnswerSheet: true });
		expect(result.questionCount).toBe(2);
		expect(result.typstSource).toContain("Answer one question");
		expect(result.typstSource.match(/<q-2>/g)).toHaveLength(2);
		expect(result.typstSource).toContain("#block(sticky: true)[\n\n#link(<q-2>)[Q2]\n\n]");
		input.lessons[0].blocks[0].data.memberBlockIds = ["missing"];
		expect(() => buildCoursePdfSource(input)).toThrow("missing or duplicate printed questions");
	});

	it("resolves only included internal destinations", () => {
		const input = course([
			block("button", "button", { text: "Next", action: "goToPage", targetPageId: "next" }),
			block("next", "pageBreak", {}),
			text("content", "Destination"),
		]);
		expect(buildCoursePdfSource(input).typstSource).toContain("#link(<p-");
		input.lessons[0].blocks[1].data.hide = true;
		expect(() => buildCoursePdfSource(input)).toThrow("hidden or missing content");
	});

	it("keeps answer assets out of the default asset allowlist", () => {
		const q = question("q");
		q.data.feedback = {
			correct: [
				block("feedback-image", "image", { src: "/assets/answer.png", alt: "Answer diagram" }),
			],
		};
		const input = course([
			block("image", "image", { src: "/assets/body.png", alt: "Body diagram" }),
			q,
		]);
		expect([...buildCoursePdfSource(input).assetSources.keys()]).toEqual(["/assets/body.png"]);
		expect([
			...buildCoursePdfSource({ ...input, includeAnswerSheet: true }).assetSources.keys(),
		]).toEqual(["/assets/body.png", "/assets/answer.png"]);
	});

	it("skips malformed raw chart data before normalization can replace it with zero", () => {
		const result = buildCoursePdfSource(
			course([
				block("chart", "chart", {
					rows: [
						["Year", "Count"],
						["2026", "not a number"],
					],
				}),
				block("good", "text", { content: "Later content" }),
			]),
		);
		expect(result.typstSource).toContain("Later content");
		expect(result.typstSource).not.toContain("not a number");
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				blockId: "chart",
				code: "invalid_chart_rows",
			}),
		);
	});

	it("retains hero heading inline meaning through display normalization", () => {
		const result = buildCoursePdfSource(
			course([
				block("hero", "heading", {
					content: 'Read <span lang="fr">bonjour</span>',
					level: 2,
					kicker: "Introduction",
					background: "/assets/cover.svg",
					backgroundAlt: "Cover",
				}),
			]),
		);
		expect(result.typstSource).toContain('lang: "fr"');
		expect(result.typstSource).toContain("Introduction");
		expect(result.typstSource).toContain("#heading(level: 2)");
		expect(result.diagnostics.some((d) => d.message.includes("Heading ranks"))).toBe(true);
	});

	it("uses lesson component defaults and does not expose placeholder-looking authored text", () => {
		const input = course(
			readBlockSource(
				"# Untitled {hideTitle}\n\n::: choice Choose {level=3}\n(x) First\n( ) Second\n:::\n",
			).blocks,
		);
		input.lessons[0].componentDefaults = { "choose-one": { shuffle: true } };
		input.lessons[0].blocks.push(text("literal", "PDFINLINE2X0END"));
		const source = buildCoursePdfSource(input).typstSource;
		expect(source).toContain("A. Second");
		expect(source).toContain("PDFINLINE2X0END");
		expect(source).not.toContain("\u0000");
	});
});
