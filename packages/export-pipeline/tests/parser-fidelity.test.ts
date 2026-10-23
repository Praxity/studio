import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readLesson as readSource } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { describe, expect, it } from "vitest";
import { renderBlockHtml } from "../src/render-block-html";

const FIXTURE_PATH = resolve(
	import.meta.dirname,
	"../../../docs/test-fixtures/renderer-fidelity.prax",
);

const SAMPLE_FIXTURE_PATH = resolve(
	import.meta.dirname,
	"../../../docs/test-fixtures/sample-course-grammar.md",
);

const EXPECTED_BLOCK_TYPES = [
	"pageBreak",
	"heading",
	"text",
	"image",
	"video",
	"audio",
	"note",
	"quote",
	"code",
	"equation",
	"button",
	"embed",
	"divider",
	"table",
	"chart",
	"accordion",
	"tabs",
	"sequence",
	"columns", // also covers `as: comparison` (parses to columns)
	"card", // includes explicit `as: card` and legacy `as: flashcard` input
	"assessment",
	"rating",
	"checklist",
	"signature",
	"variable",
	"logic",
] as const;

function runBlockTypeCoverageAssertions(fixturePath: string): void {
	it("fixture loads and parses without throwing", async () => {
		const source = await readFile(fixturePath, "utf-8");
		const result = readSource(source);
		expect(result.blocks.length).toBeGreaterThan(0);
	});

	it("produces all expected block types", async () => {
		const source = await readFile(fixturePath, "utf-8");
		const result = readSource(source);
		const types = new Set(result.blocks.map((b) => b.type));

		// Verified against actual readSource output — these are the distinct public
		// grammar block types the fixture produces.
		// the fixture produces. If any fails, the parser has regressed.
		for (const type of EXPECTED_BLOCK_TYPES) {
			expect(types.has(type), `missing block type: ${type}`).toBe(true);
		}
	});
}

describe("Parser Fidelity: sample-course-grammar.md", () => {
	runBlockTypeCoverageAssertions(SAMPLE_FIXTURE_PATH);

	it("renders automated testing guidance without an unsourced coverage statistic", async () => {
		const source = await readFile(SAMPLE_FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const html = adaptGrammarPreviewBlocks(blocks)
			.filter((block) => block.type === "tabs")
			.map((block) => renderBlockHtml(block))
			.join("\n");

		expect(html).toContain(
			"Run automated checks with tools like axe-core, WAVE, or Lighthouse in CI and fix the issues they report. Then complete a full manual review of the applicable WCAG success criteria, including keyboard and screen reader testing. A clean automated scan does not establish conformance.",
		);
		expect(source).not.toMatch(/30[-–]40%/);
		expect(html).not.toMatch(/30[-–]40%/);
	});
});

describe("Parser Fidelity: renderer-fidelity.prax", () => {
	runBlockTypeCoverageAssertions(FIXTURE_PATH);

	it("image blocks have src and alt", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const images = blocks.filter((b) => b.type === "image");
		expect(images.length).toBe(3);
		for (const img of images) {
			const data = img.data as Record<string, unknown>;
			expect(data.src, "image missing src").toBeTruthy();
			expect(data.alt || data.decorative, "image missing alt or decorative flag").toBeTruthy();
		}
	});

	it("note blocks have content and color", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const notes = blocks.filter((b) => b.type === "note");
		expect(notes.length).toBe(5);
		for (const note of notes) {
			const data = note.data as Record<string, unknown>;
			expect(data.content, "note missing content").toBeTruthy();
			expect(data.color, "note missing color").toBeTruthy();
		}
	});

	it("quote blocks have text and attribution", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const quotes = blocks.filter((b) => b.type === "quote");
		expect(quotes.length).toBe(3);
		const withAttribution = quotes.filter((q) => (q.data as Record<string, unknown>).speaker);
		expect(withAttribution.length).toBeGreaterThan(0);
	});

	it("button blocks have text and href", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const buttons = blocks.filter((b) => b.type === "button");
		expect(buttons.length).toBe(3);
		for (const btn of buttons) {
			const data = btn.data as Record<string, unknown>;
			expect(data.text, "button missing text").toBeTruthy();
			expect(data.href, "button missing href").toBeTruthy();
		}
	});

	it("code blocks have code and language", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const codeBlocks = blocks.filter((b) => b.type === "code");
		expect(codeBlocks.length).toBe(1);
		for (const cb of codeBlocks) {
			const data = cb.data as Record<string, unknown>;
			expect(data.code, "code block missing code").toBeTruthy();
			expect(data.language, "code block missing language").toBeTruthy();
		}
	});

	it("equation blocks have latex", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const equations = blocks.filter((b) => b.type === "equation");
		expect(equations.length).toBe(1);
		const data = equations[0].data as Record<string, unknown>;
		expect(data.latex, "equation missing latex").toBeTruthy();
	});

	it("video blocks have src", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const videos = blocks.filter((b) => b.type === "video");
		expect(videos.length).toBe(1);
		const data = videos[0].data as Record<string, unknown>;
		expect(data.src, "video missing src").toBeTruthy();
	});

	it("audio blocks have src", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const audioBlocks = blocks.filter((b) => b.type === "audio");
		expect(audioBlocks.length).toBe(1);
		const data = audioBlocks[0].data as Record<string, unknown>;
		expect(data.src, "audio missing src").toBeTruthy();
	});

	it("assessment blocks have correct assessmentType variants", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const assessments = blocks.filter((b) => b.type === "assessment");
		expect(assessments.length).toBe(12);

		const types = new Set(
			assessments.map((a) =>
				a.data.assessmentType === "choice"
					? (a.data.response as { selectionMode: string }).selectionMode === "multiple"
						? "multi"
						: "single"
					: a.data.assessmentType,
			),
		);

		expect(types.has("single"), "missing single choice").toBe(true);
		expect(types.has("multi"), "missing multi choice").toBe(true);
		expect(types.has("matching"), "missing matching").toBe(true);
		expect(types.has("sequence"), "missing ordering").toBe(true);
		expect(types.has("textResponse"), "missing free response").toBe(true);
		expect(types.has("fillBlank"), "missing fill in blank").toBe(true);
		expect(types.has("hotspot"), "missing hotspot").toBe(true);
		expect(types.has("categorize"), "missing categorize").toBe(true);
		expect(types.has("matrix"), "missing matrix").toBe(true);
		expect(blocks.filter((block) => block.type === "assessmentGroup")).toHaveLength(1);
	});

	it("choice assessments have options with correct markers", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const choices = blocks.filter(
			(b) => b.type === "assessment" && b.data.assessmentType === "choice",
		);
		expect(choices.length).toBe(5);

		for (const choice of choices) {
			const data = choice.data as Record<string, unknown>;
			const options = (data.response as { options: Array<{ label: string; isCorrect?: boolean }> })
				.options;
			expect(Array.isArray(options), "choice missing options array").toBe(true);
			expect(options.length).toBeGreaterThan(1);
			const hasCorrect = options.some((o) => o.isCorrect);
			expect(hasCorrect, "choice has no correct answer marked").toBe(true);
		}
	});

	it("accordion blocks have items with titles", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const accordions = blocks.filter((b) => b.type === "accordion");
		expect(accordions.length).toBe(2);
		for (const acc of accordions) {
			const data = acc.data as Record<string, unknown>;
			const items = data.items as Array<{ title?: string; label?: string }>;
			expect(Array.isArray(items), "accordion missing items").toBe(true);
			expect(items.length).toBeGreaterThan(0);
			for (const item of items) {
				expect(item.title || item.label, "accordion item missing title/label").toBeTruthy();
			}
		}
	});

	it("tabs blocks have items with titles", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const tabs = blocks.filter((b) => b.type === "tabs");
		expect(tabs.length).toBe(1);
		const data = tabs[0]?.data as Record<string, unknown>;
		const items = data.items as Array<{ title: string }>;
		expect(Array.isArray(items), "tabs missing items").toBe(true);
		expect(items.length).toBeGreaterThan(0);
	});

	it("sequence blocks have items and variant", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const sequences = blocks.filter((b) => b.type === "sequence");
		expect(sequences.length).toBe(3);
		for (const seq of sequences) {
			const data = seq.data as Record<string, unknown>;
			expect(Array.isArray(data.items), "sequence missing items").toBe(true);
			expect(data.variant, "sequence missing variant").toBeTruthy();
		}
	});

	it("columns blocks have columns array", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const cols = blocks.filter((b) => b.type === "columns");
		expect(cols.length).toBe(2); // explicit col + comparison
		for (const col of cols) {
			const data = col.data as Record<string, unknown>;
			expect(
				Array.isArray(data.columns) || Array.isArray(data.items),
				"columns block missing columns/items array",
			).toBe(true);
		}
	});

	it("card blocks have items", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const cards = blocks.filter((b) => b.type === "card");
		expect(cards.length).toBe(2);
		for (const card of cards) {
			const data = card.data as Record<string, unknown>;
			expect(Array.isArray(data.items), "card missing items").toBe(true);
		}
	});

	it("retains nondefault tabs and rating settings and group membership", async () => {
		const { blocks } = readSource(await readFile(FIXTURE_PATH, "utf-8"));
		expect(blocks.find((block) => block.type === "tabs")?.data).toMatchObject({
			orientation: "vertical",
			variant: "pills",
		});
		expect(
			blocks.filter((block) => block.type === "rating").map((block) => block.data.style),
		).toEqual(["stars", "slider"]);
		const group = blocks.find((block) => block.type === "assessmentGroup");
		expect(group?.data).toMatchObject({ groupName: "Safety knowledge check", passingScore: 80 });
		const memberIds = group?.data.memberBlockIds as string[];
		expect(memberIds).toHaveLength(1);
		expect(blocks.find((block) => block.id === memberIds[0])?.data).toMatchObject({
			stem: [{ data: { content: "<p>Choose the safe action</p>" } }],
			assessmentType: "choice",
			response: { selectionMode: "single" },
		});
	});

	it("checklist blocks have items", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const checklists = blocks.filter((b) => b.type === "checklist");
		expect(checklists.length).toBe(1);
		const data = checklists[0]?.data as Record<string, unknown>;
		const items = data.items as Array<{ text: string }>;
		expect(Array.isArray(items), "checklist missing items").toBe(true);
		expect(items.length).toBeGreaterThan(0);
	});

	it("signature blocks have label and mode", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const sigs = blocks.filter((b) => b.type === "signature");
		expect(sigs.length).toBe(2);
		for (const sig of sigs) {
			const data = sig.data as Record<string, unknown>;
			expect(data.label, "signature missing label").toBeTruthy();
			expect(data.mode, "signature missing mode").toBeTruthy();
		}
	});

	it("no text blocks contain raw grammar syntax (parser regression guard)", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const textBlocks = blocks.filter((b) => b.type === "text");

		// Each pattern targets a specific grammar construct that should NEVER appear
		// as raw text if the parser is working correctly.
		const grammarPatterns: Array<{ pattern: RegExp; label: string }> = [
			{
				pattern:
					/\bas:\s*(choice|button|note|order|match|free-response|fill-blank|embed|hotspot|categorize|rating|signature|checklist|accordion|tab|sequence|col|card|flashcard|comparison|bookmark)\b/,
				label: "as: block modifier",
			},
			{
				pattern: /^\$\$/m,
				label: "LaTeX $$ delimiter",
			},
			{
				pattern: /^```\w*/m,
				label: "fenced code block",
			},
			{
				pattern: /^\s*\(x\)\s+\S/m,
				label: "radio correct marker (x)",
			},
			{
				pattern: /^\s*\(\s*\)\s+\S/m,
				label: "radio empty marker ( )",
			},
			{
				pattern: /^\s*\[x\]\s+\S/m,
				label: "checkbox correct marker [x]",
			},
			{
				pattern: /^\s*\[\s*\]\s+\S/m,
				label: "checkbox empty marker [ ]",
			},
			{
				pattern: /\w+\s*::\s*\w+/,
				label: "match pair separator (word :: word)",
			},
			{
				pattern: /^spot:\s+/m,
				label: "hotspot spot: param",
			},
			{
				pattern: /^var:\s+\w+/m,
				label: "variable declaration",
			},
			{
				pattern: /^when:\s+/m,
				label: "logic when: condition",
			},
			{
				pattern: /^then:\s+/m,
				label: "logic then: action",
			},
		];

		for (const block of textBlocks) {
			const content = String((block.data as Record<string, unknown>).content ?? "");
			// Strip HTML tags, normalize whitespace for pattern matching
			const plainText = content.replace(/<[^>]+>/g, "\n").replace(/&[^;]+;/g, " ");
			for (const { pattern, label } of grammarPatterns) {
				expect(
					pattern.test(plainText),
					`text block contains unparsed grammar (${label}): "${plainText.trim().slice(0, 80)}"`,
				).toBe(false);
			}
		}
	});
});

describe("Parser Fidelity: adapted block output", () => {
	it("assessment blocks have stem and response after adaptation", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const adapted = adaptGrammarPreviewBlocks(blocks);
		const assessments = adapted.filter((b) => b.type === "assessment");
		expect(assessments.length).toBeGreaterThan(0);
		for (const assessment of assessments) {
			const data = assessment.data as Record<string, unknown>;
			expect(Array.isArray(data.stem), `assessment ${assessment.id} missing stem array`).toBe(true);
			expect(data.response, `assessment ${assessment.id} missing response`).toBeTruthy();
			expect(typeof (data.response as Record<string, unknown>).type).toBe("string");
			expect([
				"choice",
				"matching",
				"sequence",
				"textResponse",
				"hotspot",
				"fillBlank",
				"categorize",
				"matrix",
			]).toContain(data.assessmentType);
		}
	});

	it("table blocks have headers and rows after adaptation", async () => {
		const source = await readFile(SAMPLE_FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const adapted = adaptGrammarPreviewBlocks(blocks);
		const tables = adapted.filter((b) => b.type === "table");
		expect(tables.length).toBeGreaterThan(0);

		for (const table of tables) {
			const data = table.data as Record<string, unknown>;
			expect(Array.isArray(data.headers), `table ${table.id} missing headers`).toBe(true);
			expect((data.headers as string[]).length).toBeGreaterThan(0);
			expect(Array.isArray(data.rows), `table ${table.id} missing rows`).toBe(true);
		}
	});

	it("chart blocks have data.labels and data.series after adaptation", async () => {
		const source = await readFile(SAMPLE_FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const adapted = adaptGrammarPreviewBlocks(blocks);
		const charts = adapted.filter((b) => b.type === "chart");
		expect(charts.length).toBeGreaterThan(0);

		for (const chart of charts) {
			const data = chart.data as Record<string, unknown>;
			const chartData = data.data as Record<string, unknown>;
			expect(chartData, `chart ${chart.id} missing data object`).toBeTruthy();
			expect(Array.isArray(chartData.labels), `chart ${chart.id} missing labels`).toBe(true);
			expect((chartData.labels as string[]).length).toBeGreaterThan(0);
			expect(Array.isArray(chartData.series), `chart ${chart.id} missing series`).toBe(true);
			expect((chartData.series as unknown[]).length).toBeGreaterThan(0);
		}
	});

	it("card blocks preserve front/back item content after adaptation", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const adapted = adaptGrammarPreviewBlocks(blocks);
		const cards = adapted.filter((b) => b.type === "card");
		expect(cards.length).toBeGreaterThan(0);

		for (const card of cards) {
			const data = card.data as Record<string, unknown>;
			expect(Array.isArray(data.items), `card ${card.id} missing items`).toBe(true);
			const items = data.items as Array<Record<string, unknown>>;
			expect(items.length).toBeGreaterThan(0);
			for (const item of items) {
				expect(typeof item.label === "string", `card item missing label`).toBe(true);
				expect(Array.isArray(item.front), `card item missing front`).toBe(true);
				expect(Array.isArray(item.back), `card item missing back`).toBe(true);
			}
		}
	});

	it("accordion blocks have items with label and children after adaptation", async () => {
		const source = await readFile(FIXTURE_PATH, "utf-8");
		const { blocks } = readSource(source);
		const adapted = adaptGrammarPreviewBlocks(blocks);
		const accordions = adapted.filter((b) => b.type === "accordion");
		expect(accordions.length).toBeGreaterThan(0);

		for (const accordion of accordions) {
			const data = accordion.data as Record<string, unknown>;
			const items = data.items as Array<Record<string, unknown>>;
			expect(Array.isArray(items), `accordion ${accordion.id} missing items`).toBe(true);
			for (const item of items) {
				expect(typeof item.label === "string", "accordion item missing label").toBe(true);
				expect(Array.isArray(item.children), "accordion item missing children").toBe(true);
			}
		}
	});
});

it("renders authored H1 and H2 ranks without promotion or lesson boundaries", () => {
	const parsed = readSource("# Page title\n\n## Section title\n\n## Another title {level=1}\n");
	const blocks = adaptGrammarPreviewBlocks(
		parsed.blocks.filter((block) => block.type !== "pageBreak"),
	);
	expect(blocks.map((block) => block.type)).toEqual(["heading", "heading", "heading"]);
	expect(renderBlockHtml(blocks[0])).toMatch(/<h1\b[^>]*>Page title<\/h1>/);
	expect(renderBlockHtml(blocks[1])).toMatch(/<h2\b[^>]*>Section title<\/h2>/);
	expect(renderBlockHtml(blocks[2])).toMatch(/<h1\b[^>]*>Another title<\/h1>/);
});
