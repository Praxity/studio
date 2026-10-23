import { readFileSync } from "node:fs";
import { readLesson } from "@praxity/grammar";
import { withFixtureSetting } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";

/** Expectations are hand-written learner semantics, independent of the manifest. */
export const AUTHORING_CATALOG = [
	{ keyword: "heading", type: "heading", selector: "h2", texts: ["Section title"] },
	{ keyword: "text", type: "text", selector: "p", texts: ["Write your content here."] },
	{
		keyword: "note",
		type: "note",
		selector: ".praxity-note-base",
		texts: ["Important information for learners."],
	},
	{
		keyword: "quote",
		type: "quote",
		selector: "blockquote",
		texts: ["A meaningful quote goes here.", "Author Name"],
	},
	{
		keyword: "dialogue",
		type: "dialogue",
		selector: "figure.praxity-dialogue ol > li",
		count: 2,
		texts: ["Alex", "Start with the goal"],
	},
	{ keyword: "code", type: "code", selector: "pre", texts: ['console.log("Hello, world!");'] },
	{ keyword: "equation", type: "equation", selector: "math", texts: [] },
	{
		keyword: "image",
		type: "image",
		selector: 'img[alt="Describe the image for accessibility"]',
		texts: [],
	},
	{ keyword: "video", type: "video", selector: "video source", texts: ["Video description"] },
	{ keyword: "audio", type: "audio", selector: "audio[controls]", texts: ["Audio title"] },
	{
		keyword: "embed",
		type: "embed",
		selector: 'a[href="https://example.com/embed"]',
		texts: ["example.com"],
	},
	{
		keyword: "bookmark",
		type: "embed",
		selector: 'a[href="https://example.com"]',
		texts: ["Resource title"],
	},
	{
		keyword: "button",
		type: "button",
		selector: 'a[href="https://example.com"]',
		texts: ["Button text"],
	},
	{
		keyword: "data-table",
		type: "table",
		selector: "table tbody tr",
		count: 2,
		texts: ["Column A", "Row 2 C"],
	},
	{
		keyword: "stats",
		type: "stats",
		selector: ".praxity-stats-value",
		texts: ["41%", "Describe what the statistic means."],
	},
	{
		keyword: "accordion",
		type: "accordion",
		selector: "[data-disclosure-trigger]",
		count: 2,
		texts: ["Before the meeting", "After the meeting", "Send the agenda"],
	},
	{
		keyword: "tabs",
		type: "tabs",
		selector: '[role="tab"]',
		count: 2,
		texts: ["Draft", "Revise", "Read the sentence aloud."],
	},
	{
		keyword: "columns",
		type: "columns",
		selector: ".praxity-column",
		count: 2,
		texts: ["Column one", "Content for the second column."],
	},
	{
		keyword: "card",
		type: "card",
		selector: "article",
		count: 2,
		texts: ["Make the next step clear", "Keep it focused"],
	},
	{
		keyword: "comparison",
		type: "imageComparison",
		selector: 'input[type="range"]',
		count: 1,
		texts: ["Before", "After"],
	},
	{
		keyword: "sequence",
		type: "sequence",
		selector: ".praxity-sequence-item",
		count: 2,
		texts: ["Prepare the agenda", "Share the agenda"],
	},
	{
		keyword: "choose-one",
		type: "assessment",
		response: "choice",
		selector: 'input[type="radio"]',
		count: 3,
		texts: ["How can you help participants prepare", "Send the agenda before the meeting."],
	},
	{
		keyword: "choose-many",
		type: "assessment",
		response: "choice",
		selector: 'input[type="checkbox"]',
		count: 4,
		texts: ["Select all that apply.", "Second correct option"],
	},
	{
		keyword: "match",
		type: "assessment",
		response: "matching",
		selector: "select",
		count: 3,
		texts: ["Match items on the left", "Left item 3", "Right item 3"],
	},
	{
		keyword: "order",
		type: "assessment",
		response: "sequence",
		selector: "ol li",
		count: 4,
		texts: ["Put these items in the correct order", "Fourth item"],
	},
	{
		keyword: "free-response",
		type: "assessment",
		response: "textResponse",
		selector: 'textarea[placeholder="Type your response"]',
		texts: ["Your open-ended question here", "Provide guidance or context"],
	},
	{
		keyword: "fill-blank",
		type: "assessment",
		response: "fillBlank",
		selector: 'input[type="text"]',
		count: 1,
		texts: ["Complete the sentence", "The answer is", "and it helps learners practice."],
	},
	{
		keyword: "categorize",
		type: "assessment",
		response: "categorize",
		selector: 'input[type="radio"]',
		count: 8,
		texts: ["Sort these items", "Category A", "Category B", "Another item for B"],
	},
	{
		keyword: "hotspot",
		type: "assessment",
		response: "hotspot",
		selector: 'button[aria-pressed="false"]',
		count: 2,
		texts: ["Select the relevant areas on the image."],
	},
	{
		keyword: "rate",
		type: "rating",
		selector: 'input[type="radio"]',
		count: 3,
		texts: ["How confident are you?", "Not confident", "Somewhat confident"],
	},
	{
		keyword: "matrix",
		type: "assessment",
		response: "matrix",
		selector: 'input[type="radio"]',
		count: 6,
		texts: [
			"How confident are you?",
			"Using the first skill",
			"Using the second skill",
			"Somewhat confident",
		],
	},
	{
		keyword: "assessment-group",
		type: "assessmentGroup",
		selector: ".praxity-assessment-group-title",
		texts: ["Knowledge check"],
	},
	{
		keyword: "checklist",
		type: "checklist",
		selector: 'input[type="checkbox"]',
		count: 3,
		texts: ["State the purpose", "Remove repeated points"],
	},
	{
		keyword: "signature",
		type: "signature",
		selector: 'canvas[role="img"]',
		texts: ["Sign to confirm completion"],
	},
	{ keyword: "divider", type: "divider", selector: "hr", texts: [] },
] as const;

export function catalogTitle(keyword: string, serialized = false): string {
	return `Catalog ${keyword}${serialized ? " serialized" : ""}`;
}
export function catalogSlug(keyword: string, serialized = false): string {
	return catalogTitle(keyword, serialized).toLowerCase().replaceAll(" ", "-");
}

/** C5 converted original and serialized starters independently before the cutover. */
export function catalogStarter(keyword: string, serialized = false): string {
	const read = readLesson(authoringCatalogSource());
	const title = catalogTitle(keyword, serialized);
	const page = read.tree.root.children.find(
		(node) => node.kind === "page" && node.subject?.value === title,
	);
	if (!page) throw new Error(`Missing converted catalog starter ${title}`);
	const frontmatter =
		read.tree.root.children.find((node) => node.kind === "frontmatter")?.raw ?? "";
	return `${frontmatter}\n${page.raw}`;
}

export function authoringCatalogSource(): string {
	return readFileSync(
		new URL("../../../../docs/test-fixtures/authoring-catalog-grammar.md", import.meta.url),
		"utf8",
	);
}
/** CSS effects need the compiled stylesheet in a real browser. */
export const AUTHORING_VISUAL_CASES = [
	{
		keyword: "note",
		parameter: "style",
		values: ["outline", "filled"],
		selector: ".praxity-note-base",
		property: "backgroundColor",
		prerequisite: "",
	},
	{
		keyword: "card",
		parameter: "style",
		values: ["none", "outline", "shaded", "accent"],
		selector: ".praxity-card[data-flippable=false]",
		property: "backgroundColor",
		prerequisite: "",
	},
	{
		keyword: "card",
		parameter: "shadow",
		values: ["theme", "none", "subtle", "elevated"],
		selector: ".praxity-card[data-flippable=false]",
		property: "boxShadow",
		prerequisite: "style: outline",
	},
	{
		keyword: "card",
		parameter: "transition",
		values: ["none", "fade", "slide", "zoom"],
		selector: ".praxity-slides-item[data-active=false]",
		property: "transform",
		prerequisite: "layout: slides",
	},
	{
		keyword: "button",
		parameter: "style",
		values: ["filled", "outline", "light"],
		selector: ".praxity-button",
		property: "backgroundColor",
		prerequisite: "",
	},
	{
		keyword: "stats",
		parameter: "size",
		values: ["default", "large", "very-large"],
		selector: ".praxity-stats-value",
		property: "fontSize",
		prerequisite: "",
	},
] as const;

export function visualCaseSlug(keyword: string, parameter: string, value: string): string {
	return `catalog-visual-${keyword}-${parameter}-${value}`;
}
export function visualCaseSource(
	keyword: string,
	parameter: string,
	value: string,
	prerequisite = "",
): string {
	let source = catalogStarter(keyword);
	const settings = [[parameter, value], ...(prerequisite ? [prerequisite.split(/:\s*/)] : [])];
	for (const [name, selected] of settings) {
		const converted =
			keyword === "note" && selected === "filled"
				? "shaded"
				: keyword === "card" && selected === "accent"
					? "primary"
					: selected;
		source = withFixtureSetting(source, name, converted);
	}
	return source;
}
