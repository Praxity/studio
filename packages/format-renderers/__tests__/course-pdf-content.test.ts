import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PraxityBlock } from "@praxity/content-model";
import { getInlineField } from "@praxity/content-model/inline-preparation";
import { resolveDialogueSpeakers } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { describe, expect, it, vi } from "vitest";
import { readBlockFixture as readBlockSource } from "../../grammar/__tests__/helpers/lesson-fixture.ts";
import { buildCoursePdfSource } from "../src/pipelines/course-pdf.ts";
import { type PdfContentContext, renderPdfContent } from "../src/pipelines/course-pdf-content.ts";
import { coursePdfTheme } from "../src/pipelines/course-pdf-theme.ts";
import { compileTypstNative } from "../src/pipelines/typst-native-compiler.ts";
import { htmlToTypst, typstString } from "../src/renderers/typst/common.ts";

const block = (type: PraxityBlock["type"], data: Record<string, unknown>): PraxityBlock => ({
	id: "content",
	type,
	data,
});
function context(): PdfContentContext {
	const ctx: PdfContentContext = {
		locale: "en",
		rich: (value) => htmlToTypst(String(value)),
		field: (owner, key) => htmlToTypst(getInlineField(owner, key)),
		renderBlocks: (value) =>
			((value as PraxityBlock[]) ?? [])
				.filter((b) => !b.data.hide)
				.map((b) => renderPdfContent(b, ctx))
				.join("\n\n"),
		image: vi.fn((src, alt, options) => `IMAGE ${src} ${alt} ${JSON.stringify(options ?? {})}`),
		equation: vi.fn((latex, alt) => `MATH ${latex} ${alt}`),
		link: vi.fn((target, label) => `#link(${typstString(String(target))})[${label}]`),
		fail: (message) => {
			throw new Error(message);
		},
		warn: vi.fn(),
	};
	return ctx;
}
const text = (content: string) => block("text", { content });
const render = (type: PraxityBlock["type"], data: Record<string, unknown>, ctx = context()) =>
	renderPdfContent(block(type, data), ctx);

describe("PDF static content", () => {
	it("prints the card group at h2 size and card titles at h4 size in the body face", () => {
		const source = buildCoursePdfSource({
			title: "Workbook",
			locale: "en",
			lessons: [
				{
					id: "lesson",
					title: "Lesson",
					locale: "en",
					blocks: readBlockSource(
						"# Page\n\n::: cards The four styles\n:: Assertive {level=4}\nRespectful and clear.\n\n:: Passive {level=4}\nAvoids speaking up.\n:::\n",
					).blocks,
				},
			],
		}).typstSource;
		expect(source).toContain("#heading(level: 3)[#text(size: 1.3em)[The four styles]]");
		expect(source).toContain(
			"#heading(level: 4)[#text(size: 1em)[#text(font: px-body-font, weight: 600)[Assertive]]]",
		);
		expect(source).toContain(
			"#heading(level: 4)[#text(size: 1em)[#text(font: px-body-font, weight: 600)[Passive]]]",
		);
		expect(source).toContain("show heading: set block(above: 0pt, below: 0.25em)");
		expect(source.indexOf("[The four styles]")).toBeLessThan(source.indexOf("[Assertive]"));
	});
	it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
		"rejects measured code and table overflow at actual A4 width",
		async () => {
			for (const source of [
				render("code", { code: "W".repeat(110), language: "text" }),
				render("table", { headers: ["First", "Second"], rows: [["W".repeat(110), "Data"]] }),
			]) {
				await expect(
					compileTypstNative(
						`#set document(title: "Width fixture")\n${coursePdfTheme(undefined, new Set()).preamble}\n#set text(lang: "en")\n#set page(paper: "a4", margin: (x: 2.2cm, y: 2.5cm))\n${source}`,
						{
							executablePath: process.env.PRAXITY_TEST_TYPST as string,
							a11yExtras: true,
							pdfStandard: "ua-1",
						},
					),
				).rejects.toThrow(/writing width|wider than its column/);
			}
		},
	);
	it("prints parsed card headings in reading order with informative image alt text", () => {
		const blocks = readBlockSource(
			"# Cards {hideTitle}\n\n::: cards Terms\n:: Front\n![Valve diagram](/assets/diagram.png)\n\n:: Back\n:::\n",
		).blocks;
		const source = buildCoursePdfSource({
			title: "Workbook",
			locale: "en",
			lessons: [{ id: "lesson", title: "Lesson", locale: "en", blocks }],
		}).typstSource;
		expect(source.indexOf("Terms")).toBeLessThan(source.indexOf("Front"));
		expect(source.indexOf("Front")).toBeLessThan(source.indexOf("Back"));
		expect(source).toContain('alt: "Valve diagram"');
	});
	it("preserves parsed headings, notes, quotes and literal code", () => {
		const parsed = adaptGrammarPreviewBlocks(
			readBlockSource(
				"# Heading\n\n::: note Note title\nBody\n:::\n\n::: quote {source=https://example.org}\nQuoted\nspeaker: Speaker\nwork: Work\n:::\n\n```ts\nconst x = '<tag>';\n```\n",
			).blocks,
		);
		parsed[0].data.kicker = "Kicker";
		const result = parsed.map((b) => renderPdfContent(b, context())).join("\n");
		for (const marker of [
			"Heading",
			"Kicker",
			"Body",
			"Note title",
			"Quoted",
			"Speaker",
			"Work",
			"https://example.org",
			"const x = '<tag>';",
		])
			expect(result).toContain(marker);
		expect(result).toContain("#heading(level: 1)");
		expect(result).toContain("raw(source, block: true");
	});
	it("prints dialogue as a script with names before each turn", () => {
		const out = render("dialogue", {
			caption: "At the office",
			turns: [
				{ speaker: "roger", name: "Roger", paragraphs: ["Hi *there*"] },
				{ speaker: "roxanne", name: "Roxanne", paragraphs: ["First", "Second"] },
				{ paragraphs: ["Unattributed"] },
			],
		});
		expect(out).toContain("At the office");
		expect(out.indexOf("Roger")).toBeLessThan(out.indexOf("Hi"));
		expect(out).toMatch(/\*Roxanne:\*/);
		expect(out).toContain("Second");
		expect(out).toContain("Unattributed");
		expect(out).toContain("#emph[there]");
		expect(out).toMatch(/#block\(breakable: true\)\[Unattributed\]/);
	});
	it("keeps valid dialogue content when persisted fields are malformed", () => {
		expect(render("dialogue", null as unknown as Record<string, unknown>)).toBe("");
		expect(render("dialogue", { caption: "Ignored", turns: "x" })).toBe("");
		const out = render("dialogue", {
			caption: {},
			turns: [
				null,
				{ name: "No words", paragraphs: 3 },
				{ name: "Valid", paragraphs: ["First", 3, "Last"] },
			],
		});
		expect(out).toBe("#block(breakable: true)[*Valid:* First\n\nLast]");
	});
	it("skips empty turns and falls back from blank names to speaker keys", () => {
		const out = render("dialogue", {
			turns: [
				{ paragraphs: ["Unattributed"] },
				{ name: "Empty", paragraphs: [] },
				{ hidden: true, paragraphs: ["Still visible"] },
				{ name: "   ", speaker: "roger", paragraphs: ["Hello"] },
			],
		});
		expect(out).toContain("#block(breakable: true)[Unattributed]");
		expect(out).not.toContain("*Empty:*");
		expect(out).toContain("#block(breakable: true)[Still visible]");
		expect(out).toContain("*roger:* Hello");
		expect(out).not.toContain("*   :*");
	});
	it("prints resolved grammar dialogue in the course PDF source", () => {
		const parsed = readBlockSource(
			"---\ncast: {roger: {}}\n---\n# Office\n\n::: dialogue\n- roger: Hi there\ncaption: At the office\n:::\n",
		).blocks;
		const dialogue = parsed.find((block) => block.type === "dialogue");
		if (!dialogue) throw new Error("Missing PDF dialogue fixture");
		// Persisted models can contain unattributed turns; grammar 4 requires a speaker.
		(dialogue.data.turns as Array<{ id: string; paragraphs: string[] }>).push({
			id: "unattributed-turn",
			paragraphs: ["Unattributed"],
		});
		const blocks = resolveDialogueSpeakers(parsed, { roger: { name: "Roger" } }).blocks;
		const source = buildCoursePdfSource({
			title: "Workbook",
			locale: "en",
			lessons: [{ id: "lesson", title: "Lesson", locale: "en", blocks }],
		}).typstSource;
		expect(source).toMatch(
			/At the office[\s\S]*\*Roger:\* Hi there[\s\S]*#block\(breakable: true\)\[Unattributed\]/,
		);
	});
	it("preserves caption suppression and explicit decorative images", () => {
		const ctx = context();
		const result = render(
			"image",
			{ src: "picture.png", decorative: true, caption: "HIDDEN", captionEnabled: false },
			ctx,
		);
		expect(ctx.image).toHaveBeenCalledWith("picture.png", "", { decorative: true });
		expect(result).not.toContain("HIDDEN");
		expect(() => render("image", { src: "picture.png" })).toThrow("text");
	});
	it("preserves both comparison images, labels, alternatives and captions", () => {
		const result = render("imageComparison", {
			beforeImage: { src: "before.png", altText: "Before alt" },
			afterImage: { src: "after.png", altText: "After alt" },
			beforeLabel: "Original",
			afterLabel: "Revised",
			beforeCaption: "First caption",
			afterCaption: "Second caption",
			caption: "Overall",
		});
		for (const marker of [
			"before.png",
			"after.png",
			"Before alt",
			"After alt",
			"Original",
			"Revised",
			"First caption",
			"Second caption",
			"Overall",
		])
			expect(result).toContain(marker);
	});
	it("renders numbered graphic markers and their complete descriptions", () => {
		const ctx = context();
		const result = render(
			"labeledGraphic",
			{
				imageSrc: "graphic.png",
				imageAlt: "Equipment",
				labels: [
					{ x: 20, y: 30, title: "Pin", body: "Release here" },
					{ x: 40, y: 50, title: "Hidden", body: "NO", hide: true },
				],
			},
			ctx,
		);
		expect(ctx.image).toHaveBeenCalledWith("graphic.png", "Equipment", {
			regions: [{ shape: "ellipse", coords: [20, 30, 2], label: "1" }],
		});
		expect(result).toContain("1. Pin");
		expect(result).toContain("Release here");
		expect(result).not.toContain("Hidden");
	});
	it("prints literal media transcripts without opening file-like transcript text", () => {
		const ctx = context();
		const result = render(
			"video",
			{
				src: "https://example.org/movie",
				title: "Watch",
				transcript: "assets/transcript.txt",
				caption: "Caption",
			},
			ctx,
		);
		expect(result).toContain("assets\\/transcript\\.txt");
		expect(result).toContain("Caption");
		expect(ctx.warn).not.toHaveBeenCalled();
		const local = render(
			"audio",
			{ src: "/private/secret/audio.mp3", transcript: "<not HTML>" },
			ctx,
		);
		expect(local).not.toContain("secret");
		expect(local).toContain("not HTML");
		expect(ctx.warn).toHaveBeenCalled();
	});
	it("discloses absent transcripts and local companion resources", () => {
		const ctx = context();
		expect(render("audio", { src: "assets/audio.mp3" }, ctx)).toContain("no authored transcript");
		expect(
			render(
				"resourceEntry",
				{
					title: "Companion",
					description: "Read later",
					resourceType: "file",
					assetId: "private-path",
				},
				ctx,
			),
		).toContain("not included");
		expect(
			render(
				"document",
				{ url: "assets/manual.pdf", title: "Manual", description: "Instructions" },
				ctx,
			),
		).toContain("Instructions");
		expect(ctx.warn).toHaveBeenCalled();
	});
	it("maps ordinary internal buttons and external resources through the shared link resolver", () => {
		const ctx = context();
		render("button", { text: "Next", action: "goToPage", targetPageId: "page-two" }, ctx);
		expect(ctx.link).toHaveBeenCalledWith("#page-two", "Next");
		render("embed", { src: "https://example.org", title: "Example" }, ctx);
		render(
			"resourceEntry",
			{ resourceType: "link", url: "https://example.org/resource", title: "Resource" },
			ctx,
		);
		expect(ctx.link).toHaveBeenCalledWith("https://example.org", "Example");
		expect(() => render("button", { text: "Branch", action: "setVariable", href: "#x" })).toThrow(
			"Branching",
		);
	});
	it("preserves table header semantics, cell alignment, rich text and captions", () => {
		const result = render("table", {
			title: "Data",
			headers: ["Name", "Count"],
			rows: [["Row", "**2**"]],
			highlightHeaderCol: true,
			columnAlignments: ["left", "right"],
			caption: "Caption",
		});
		expect(result).toContain('pdf.header-cell(scope: "both")[');
		expect(result).toContain('pdf.header-cell(scope: "row")[');
		expect(result).toContain("table.header(repeat: true");
		expect(result).toContain("align: (left, right,)");
		expect(result).toContain("#strong[2]");
		expect(result).toContain("Caption");
		const noHeader = render("table", {
			headers: ["First"],
			rows: [["Second"]],
			highlightHeaderRow: false,
		});
		expect(noHeader).not.toContain("table.header");
	});
	it("draws charts as themed SVG figures and keeps data tables only without a description", () => {
		const chart = {
			title: "Results",
			subtitle: "Period",
			altText: "Comparison of groups",
			xAxisLabel: "Group",
			yAxisLabel: "Count",
			data: {
				labels: ["A", "B"],
				series: [
					{ name: "First", values: [0, -3.2] },
					{ name: "Second", values: [20, 40] },
				],
			},
			caption: "Source",
		};
		const ctx = {
			...context(),
			chart: { vars: { "praxity-color-accent": "#123456" }, font: "Inter" },
		};
		const drawn = render("chart", chart, ctx);
		for (const marker of ["Results", "Period", "Source", "Group", "Count", "First", "Second"])
			expect(drawn).toContain(marker);
		expect(drawn).toContain('alt: "Comparison of groups"');
		expect(drawn).toContain("#123456");
		expect(drawn).toContain('font-family=\\"Inter\\"');
		expect(drawn).not.toContain("var(--");
		expect(drawn).not.toContain("table(columns");
		expect(ctx.warn).not.toHaveBeenCalled();
		const undescribed = context();
		const fallback = render("chart", { ...chart, altText: undefined }, undescribed);
		for (const marker of ["image(bytes(", "table(columns", "20", "40", "no text description"])
			expect(fallback).toContain(marker);
		expect(undescribed.warn).toHaveBeenCalled();
		expect(() => render("chart", { chartConfig: { series: [] }, data: {} })).toThrow("Raw chart");
	});
	it("expands all container items in order, preserves both card faces, and skips hidden items", () => {
		for (const type of ["accordion", "tabs", "columns", "sequence"] as const) {
			const result = render(type, {
				items: [
					{ label: "First", children: [text("Front marker")] },
					{ label: "Hidden", hide: true, children: [text("HIDDEN")] },
					{ label: "Last", children: [text("Last marker")] },
				],
			});
			expect(result.indexOf("Front marker")).toBeLessThan(result.indexOf("Last marker"));
			expect(result).not.toContain("HIDDEN");
		}
		const result = render("card", {
			title: "Cards",
			headings: false,
			items: [
				{
					label: "Label",
					headingLevel: 2,
					front: [text("Question face")],
					back: [text("Answer face")],
				},
			],
		});
		for (const marker of ["Cards", "Label", "Front", "Back", "Question face", "Answer face"])
			expect(result).toContain(marker);
		expect(result).not.toContain("#heading");
	});
	it("preserves hero heading, stats, unchecked tasks, signature and structural dispositions", () => {
		expect(
			render("heroCover", {
				title: "Hero",
				subtitle: "Sub",
				level: 2,
				imageSrc: "hero.png",
				imageAlt: "Alt",
			}),
		).toContain("#heading(level: 2)[Hero]");
		expect(
			render("stats", { items: [{ value: "12", label: "Tasks" }], caption: "Source" }),
		).toContain("12: Tasks");
		expect(render("checklist", { items: [{ text: "Do this", checked: true }] })).toContain(
			"☐ Do this",
		);
		expect(render("signature", { label: "Name", sublabel: "Sign here" })).toContain("Sign here");
		expect(render("divider", { label: "Part two" })).toContain("Part two");
		expect(render("blockBreak", {})).toBe("");
		expect(render("variable", { name: "unused" })).toBe("");
		expect(render("pageBreak", {})).toContain("#pagebreak");
		expect(() => render("logic", {})).toThrow("static version");
		const ctx = context();
		render("equation", { latex: "x^2", alt: "x squared" }, ctx);
		expect(ctx.equation).toHaveBeenCalledWith("x^2", "x squared");
	});
	it.each([
		["table", { headers: ["One", "Two"], rows: [["Missing"]] }],
		["table", { headers: Array(9).fill("Wide"), rows: [] }],
		["chart", { data: { labels: ["A"], series: [{ name: "Invalid", values: ["text"] }] } }],
		["code", { code: 123 }],
		[
			"labeledGraphic",
			{ imageSrc: "x", imageAlt: "X", labels: [{ x: -1, y: 50, title: "Invalid" }] },
		],
		["video", { source: { type: "mux", playbackId: "private" } }],
	] as const)("rejects malformed or unsupported %s content: %j", (type, data) =>
		expect(() => render(type, data)).toThrow(),
	);
	it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
		"compiles tables with header associations and expandable long content using native PDF/UA",
		async () => {
			const ctx = context();
			const source = [
				render("heading", { content: "Content fixture", level: 1 }, ctx),
				render(
					"table",
					{
						headers: ["Name", "Count"],
						rows: Array.from({ length: 70 }, (_, i) => [
							`Row ${i + 1}`,
							i === 0
								? "A complete readable sentence that wraps over several lines. ".repeat(90)
								: String(i),
						]),
						highlightHeaderCol: true,
						columnAlignments: ["left", "right"],
						caption: "Table source",
					},
					ctx,
				),
				render("code", { code: "const x = '<tag>';\nconsole.log(x);", language: "ts" }, ctx),
				render("signature", { label: "Signature" }, ctx),
			].join("\n\n");
			const pdf = await compileTypstNative(
				`#set document(title: "Content fixtures")\n${coursePdfTheme(undefined, new Set()).preamble}\n#set text(lang: "en")\n${source}`,
				{
					executablePath: process.env.PRAXITY_TEST_TYPST as string,
					a11yExtras: true,
					pdfStandard: "ua-1",
				},
			);
			expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
			const directory = await mkdtemp(path.join(tmpdir(), "pdf-content-fit-"));
			try {
				const file = path.join(directory, "fixture.pdf");
				await writeFile(file, pdf);
				const extracted = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
				for (const word of ["complete", "readable", "sentence"])
					expect(extracted.match(new RegExp(word, "g"))).toHaveLength(90);
				expect(extracted).toContain("Row 70");
				expect(extracted).toContain("const x = '<tag>';");
				const boxes = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8" });
				for (const page of boxes.matchAll(
					/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g,
				)) {
					for (const word of page[3].matchAll(
						/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"/g,
					)) {
						expect(Number(word[1])).toBeGreaterThanOrEqual(0);
						expect(Number(word[2])).toBeGreaterThanOrEqual(0);
						expect(Number(word[3])).toBeLessThanOrEqual(Number(page[1]));
						expect(Number(word[4])).toBeLessThanOrEqual(Number(page[2]));
					}
				}
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		},
	);
});
