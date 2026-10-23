import { describe, expect, it } from "vitest";
import { readLesson } from "../src/read-lesson";
import { BLOCK_SCHEMA, getDefinition } from "../src/v4/schema";

const common = {
	width: ["narrow", "wide", "full", "breakout"],
	entrance: ["none", "fade", "slide", "scale"],
};
const assessment = {
	feedbackMode: ["retry", "reveal"],
	display: ["standard", "scenario"],
	deckGate: ["attempt", "pass"],
};
// Literal vocabularies from the grammar 4 format reference. Schema additions must be reviewed here.
const options: Record<string, Record<string, string[]>> = {
	text: {},
	note: { tone: ["note", "info", "tip", "success", "warning"], style: ["outline", "shaded"] },
	quote: { style: ["none", "outline", "shaded", "primary", "secondary"] },
	figure: {},
	float: { side: ["left", "right"] },
	video: {},
	audio: {},
	embed: {},
	bookmark: {},
	button: { style: ["filled", "outline", "light"] },
	dialogue: { style: ["bubbles", "script"] },
	table: {
		chart: ["bar", "line", "scatter", "area", "radar", "stacked"],
		orientation: ["vertical", "horizontal"],
		header: ["row", "column", "none"],
		gridlines: ["none", "rows", "columns", "inside", "all"],
		sortOrder: ["none", "asc", "desc"],
	},
	stats: { size: ["default", "large", "very-large"] },
	accordion: { style: ["none", "outline", "shaded", "primary", "secondary"] },
	tabs: { style: ["default", "outline", "pills"], orientation: ["horizontal", "vertical"] },
	sequence: {
		style: ["numbered", "timeline", "none"],
		orientation: ["vertical", "horizontal"],
		alignment: ["left", "center", "right"],
		distribution: ["uniform", "scaled"],
	},
	cards: {
		layout: ["grid", "masonry", "slides", "rows"],
		style: ["none", "outline", "shaded", "primary", "secondary"],
		color: ["primary", "secondary"],
		shadow: ["theme", "none", "subtle", "elevated"],
		media: ["inset", "flush"],
		transition: ["none", "fade", "slide", "zoom"],
	},
	comparison: { layout: ["slider", "side-by-side"] },
	columns: {},
	choice: { ...assessment },
	match: { ...assessment },
	order: { ...assessment },
	categorize: { ...assessment },
	"fill-blank": { ...assessment, style: ["typed", "word-bank", "dropdown"] },
	"free-response": { ...assessment, download: ["txt", "docx", "both"] },
	"self-check": { deckGate: ["attempt"] },
	"retrieval-sheet": {},
	highlight: { mode: ["key", "evidence"] },
	"write-distractors": {},
	rating: { ...assessment, style: ["likert", "stars", "slider"] },
	matrix: { ...assessment, style: ["likert"] },
	hotspot: { ...assessment },
	group: { mode: ["all", "oneOf"], deckGate: ["attempt", "pass"] },
	checklist: {},
	signature: { mode: ["draw", "type"] },
	rule: {},
	divider: { palette: ["light", "dark", "accent", "warm", "cool", "growth"] },
	page: {},
	image: {
		size: ["small", "medium", "large"],
		alignment: ["left", "center", "right"],
		ratio: ["square", "4:3", "3:2", "16:9"],
		fit: ["contain", "cover"],
	},
	heading: {},
};

function sourceWithOption(type: string, key: string, value: string) {
	const definition = getDefinition(type);
	if (!definition) throw new Error(`Missing definition: ${type}`);
	const lines = definition.insertTemplate.trimEnd().split("\n");
	lines[0] = lines[0].replace(/\s*\{[^}]*\}\s*$/, "") + ` {${key}=${value}}`;
	if (type === "fill-blank" && key === "style" && value === "word-bank")
		lines.splice(1, 0, "bank: answer | other");
	if (type === "fill-blank" && key === "style" && value === "dropdown")
		lines[1] = "Complete the {*answer|other}.";
	if (type === "highlight" && key === "mode" && value === "evidence")
		lines.splice(1, 0, "question: Which passage gives the evidence?");
	const cast = type === "dialogue" ? "---\ncast:\n  alex: {}\n  sam: {}\n---\n" : "";
	return `${cast}${type === "page" ? "" : "# Fixture {hideTitle}\n\n"}${lines.join("\n")}\n`;
}

describe("grammar 4 enum source contracts", () => {
	it("covers every schema type and advertised enum", () => {
		expect(Object.keys(options).sort()).toEqual(Object.keys(BLOCK_SCHEMA).sort());
		for (const [type, specific] of Object.entries(options)) {
			const expected = ["rule", "page"].includes(type) ? specific : { ...common, ...specific };
			expect(
				Object.fromEntries(
					Object.entries(getDefinition(type)?.settings ?? {})
						.filter(([, setting]) => setting.type === "enum")
						.map(([key, setting]) => [key, setting.values]),
				),
				type,
			).toEqual(expected);
		}
	});
	for (const [type, specific] of Object.entries(options)) {
		const settings = ["rule", "page"].includes(type) ? specific : { ...common, ...specific };
		for (const [key, values] of Object.entries(settings))
			for (const value of values) {
				it(`${type} accepts ${key}=${value} without alias normalization`, () => {
					const source = sourceWithOption(type, key, value);
					const read = readLesson(source);
					expect(read.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([]);
					const node = [...read.nodes.values()].find(
						(record) => !record.role && (record.node.type ?? record.node.kind) === type,
					);
					expect(node?.node.settings).toContainEqual(
						expect.objectContaining({ name: key, value: expect.objectContaining({ value }) }),
					);
					expect(read.tree.stream.source).toBe(source);
					expect(read.blocks.length).toBeGreaterThan(0);
				});
			}
	}
	it("keeps named card surfaces in the renderer contract", () => {
		for (const style of ["none", "outline", "shaded", "primary", "secondary"]) {
			const read = readLesson(sourceWithOption("cards", "style", style));
			expect(read.blocks.find((block) => block.type === "card")?.data.style).toBe(style);
		}
	});
	it("keeps documented media, table and signature parts", () => {
		const read = readLesson(
			"# Fixture {hideTitle}\n\n::: audio /assets/example.mp3\ncaption: Listen closely\ntranscript: Read this text\n:::\n\n::: table {striped header=column}\n| Quarter | Incidents |\n| --- | --- |\n| Q1 | 4 |\ncaption: Source report\n:::\n\n::: signature Confirm {required}\nsublabel: Confirm the statement\n:::\n",
		);
		expect(read.diagnostics).toEqual([]);
		expect(read.blocks.find((b) => b.type === "audio")?.data).toMatchObject({
			caption: "Listen closely",
			transcript: "Read this text",
		});
		expect(read.blocks.find((b) => b.type === "table")?.data).toMatchObject({
			striped: true,
			highlightHeaderCol: true,
			caption: "Source report",
		});
		expect(read.blocks.find((b) => b.type === "signature")?.data).toMatchObject({
			required: true,
			sublabel: "Confirm the statement",
		});
	});
});
