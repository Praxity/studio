/**
 * Integration test: intentionally inaccessible course fixture.
 *
 * Verifies that every checker rule fires against a "kitchen sink of bad
 * practices" course. If a new rule is added to checker.ts but not exercised
 * here, the "every rule fires at least once" assertion will fail.
 */

import { readLesson } from "@praxity/grammar";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { checkCourseAccessibility, checkDesignSystemAccessibility } from "../checker";
import { buildA11yOccurrenceId } from "../occurrence-id";
import { RULE_METADATA } from "../rule-metadata";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let blockId = 0;
function b(type: string, data: Record<string, unknown>): PraxityBlock {
	return { id: `blk-${++blockId}`, type: type as PraxityBlock["type"], data };
}

function textBlock(html: string) {
	return b("text", { content: html });
}

// ---------------------------------------------------------------------------
// Intentionally inaccessible course
// ---------------------------------------------------------------------------

/**
 * Page 1 — Image sins
 *
 * Triggers: image-alt, image-alt-quality (generic), image-alt-quality (filename),
 *           image-alt-length, repeated-alt-text, decorative-image-overuse,
 *           gif-flash-threshold, page-title (empty title)
 */
const page1: PraxityPage = {
	id: "p1",
	title: "", // page-title
	blocks: [
		b("logic", { actions: [{ type: "disableCompletion", targets: [] }] }),
		// image-alt: missing alt on non-decorative image
		b("image", { src: "/hero.jpg", altText: "", decorative: false }),
		// image-alt-quality: generic alt text
		b("image", { src: "/photo.jpg", altText: "image", decorative: false }),
		// image-alt-quality: filename as alt text
		b("image", { src: "/shot.jpg", altText: "DSC_0042.jpg", decorative: false }),
		// image-alt-length: > 125 chars
		b("image", {
			src: "/chart.jpg",
			altText: "A".repeat(130),
			decorative: false,
		}),
		// repeated-alt-text: two images share "Team meeting"
		b("image", { src: "/team1.jpg", altText: "Team meeting", decorative: false }),
		b("image", { src: "/team2.jpg", altText: "Team meeting", decorative: false }),
		// decorative-image-overuse: 4 decorative out of 8 total = 50%
		// (the 6 above are non-decorative; add 4 decorative + 2 non-decorative)
		b("image", { src: "/d1.jpg", decorative: true }),
		b("image", { src: "/d2.jpg", decorative: true }),
		b("image", { src: "/d3.jpg", decorative: true }),
		b("image", { src: "/d4.jpg", decorative: true }),
		b("image", { src: "/d5.jpg", decorative: true }),
		// At this point: 11 images, 5 decorative → 45%. Need one more decorative.
		b("image", { src: "/d6.jpg", decorative: true }),
		// 12 images, 6 decorative → 50% — triggers at >50%, so add one more:
		b("image", { src: "/d7.jpg", decorative: true }),
		// 13 images, 7 decorative → 53.8% → triggers decorative-image-overuse
		b("note", { backgroundImage: "/assets/flashing.gif", content: "Safety signal" }),
	],
};

/**
 * Page 2 — Text, link, and heading sins
 *
 * Triggers: link-text-quality (generic), link-text-quality (URL),
 *           empty-link, heading-hierarchy, duplicate-heading,
 *           consecutive-headings
 */
const page2: PraxityPage = {
	id: "p2",
	title: "Bad Links & Headings",
	blocks: [
		// link-text-quality: generic link text
		textBlock('<p><a href="https://example.com">click here</a></p>'),
		// link-text-quality: raw URL as link text
		textBlock('<p><a href="https://example.com">https://example.com/path</a></p>'),
		// empty-link: anchor with no text
		textBlock('<p><a href="https://example.com"></a></p>'),
		// heading-hierarchy: H2 → H4 (skips H3)
		textBlock("<h2>Section</h2><h4>Subsection</h4>"),
		// duplicate-heading: "Overview" appears in two different blocks
		textBlock("<h2>Overview</h2><p>Some text</p>"),
		textBlock("<h2>Overview</h2><p>More text</p>"),
		// consecutive-headings: two heading-only blocks in a row
		textBlock("<h3>Part A</h3>"),
		textBlock("<h3>Part B</h3>"),
		b("heading", { content: "Page Title Repeated", level: 1 }),
		// heading-length: heading block exceeding 120 chars
		b("heading", { content: "X".repeat(125), level: 2 }),
		// duplicate-links: same URL as the existing link above
		textBlock('<p><a href="https://example.com">Another link to example</a></p>'),
	],
};

/**
 * Page 3 — Media and embed sins
 *
 * Triggers: media-transcript (video), media-transcript (audio), embed-title, media-audio-description
 */
const page3: PraxityPage = {
	id: "p3",
	title: "Media Problems",
	blocks: [
		// media-transcript: video without transcript
		b("video", { src: "/intro.mp4", transcript: "" }),
		// media-transcript: audio without transcript
		b("audio", { src: "/podcast.mp3", transcript: "" }),
		// embed-title: embed without title
		b("embed", { url: "https://example.com/widget", title: "" }),
	],
};

/**
 * Page 4 — Table, button, document sins
 *
 * Triggers: table-headers, table-caption, link-text-quality (button),
 *           link-text-quality (document button), link-text-quality (document bookmark),
 *           link-text-quality (document no title), empty-link (empty button)
 */
const page4: PraxityPage = {
	id: "p4",
	title: "Tables & Buttons",
	blocks: [
		// table-headers + table-caption
		b("table", {
			headers: ["A", "B"],
			rows: [["1", "2"]],
			highlightHeaderRow: false,
			highlightHeaderCol: false,
			caption: "",
		}),
		// empty-link: button with no text
		b("button", { text: "", href: "https://example.com" }),
		// link-text-quality: generic button text
		b("button", { text: "Click here", href: "https://example.com" }),
		// link-text-quality: generic download button text
		b("document", { title: "Download", display: "button", url: "/file.pdf" }),
		// link-text-quality: generic bookmark text
		b("document", { title: "Click here", display: "bookmark", url: "/file.pdf" }),
		// link-text-quality: missing title
		b("document", { url: "/file.pdf" }),
	],
};

/**
 * Page 5 — Container sins
 *
 * Triggers: container-single-item (tabs), container-single-item (accordion),
 *           container-too-many-items, columns-too-many
 */
const page5: PraxityPage = {
	id: "p5",
	title: "Container Issues",
	blocks: [
		// container-single-item: tabs with 1 tab
		b("tabs", {
			items: [{ id: "t1", label: "Only", children: [] }],
			trackCompletion: false,
		}),
		// container-single-item: accordion with 1 section
		b("accordion", {
			items: [{ id: "a1", label: "Only", children: [] }],
			trackCompletion: false,
		}),
		// container-too-many-items: 8 tabs
		b("tabs", {
			items: Array.from({ length: 8 }, (_, i) => ({
				id: `t${i}`,
				label: `Tab ${i + 1}`,
				children: [],
			})),
			trackCompletion: false,
		}),
		// columns-too-many: 4 columns
		b("columns", {
			items: Array.from({ length: 4 }, (_, i) => ({
				id: `c${i}`,
				width: 0.25,
				children: [{ id: `x${i}`, type: "text", data: {} }],
			})),
		}),
	],
};

/**
 * Page 6 — Assessment sins
 *
 * Triggers: mcq-question, mcq-correct-answer, gmcq-question, gmcq-correct-answer,
 *           gmcq-image-alt, slider-question, textInput-question,
 *           textInput-correct-answer, sorting-categories, assessment-pass-mark,
 *           hotspot-image-alt
 */
const page6: PraxityPage = {
	id: "p6",
	title: "Assessment Failures",
	blocks: [
		// mcq-question + mcq-correct-answer
		b("mcq", {
			question: "",
			options: [
				{ text: "A", isCorrect: false },
				{ text: "B", isCorrect: false },
			],
		}),
		// gmcq-question + gmcq-correct-answer + gmcq-image-alt
		b("gmcq", {
			question: "",
			options: [{ text: "A", isCorrect: false, imageSrc: "/opt.jpg", imageAlt: "" }],
		}),
		// slider-question
		b("slider", { question: "" }),
		// textInput-question + textInput-correct-answer
		b("textInput", { question: "", correctAnswers: [] }),
		// sorting-categories
		b("sorting", { categories: [{ id: "c1", label: "Only one" }] }),
		// assessment-pass-mark
		b("assessmentResults", { passMark: 0 }),
		// hotspot-image-alt
		b("assessment", {
			assessmentType: "hotspot",
			gradingMode: "exact",
			response: { type: "hotspot", image: "/map.jpg", imageAlt: "", hotspots: [] },
			feedback: { correct: [], incorrect: [] },
			feedbackEnabled: true,
		}),
	],
};

/**
 * Page 7 — Legacy block sins
 *
 * Triggers: hotgraphic-alt, labeled-graphic-alt, narrative-image-alt,
 *           imageComparison image-alt
 */
const page7: PraxityPage = {
	id: "p7",
	title: "Legacy Blocks",
	blocks: [
		// hotgraphic-alt
		b("hotgraphic", { imageAlt: "" }),
		// labeled-graphic-alt
		b("labeledGraphic", { imageAlt: "" }),
		// narrative-image-alt
		b("narrative", {
			items: [{ id: "s1", imageSrc: "/slide.jpg", imageAlt: "" }],
		}),
		// image-alt (imageComparison before + after)
		b("imageComparison", {
			beforeImage: { src: "/before.jpg", altText: "" },
			afterImage: { src: "/after.jpg", altText: "" },
		}),
	],
};

/**
 * Page 8 — Empty page + content without interaction
 *
 * Triggers: empty-page (separate page below), code-block-empty
 * Each text block is ~360 words ≈ 2 min at 180 WPM. 4 blocks ≈ 8 min → exceeds 7 min threshold.
 */
const page8: PraxityPage = {
	id: "p8",
	title: "Wall of Text",
	blocks: [
		...Array.from({ length: 4 }, (_, i) =>
			textBlock(`<p>${"word ".repeat(360)}Paragraph ${i + 1} end.</p>`),
		),
		// code-block-empty
		b("code", { code: "", language: "javascript" }),
	],
};

const emptyPage: PraxityPage = {
	id: "p9",
	title: "Empty Page",
	blocks: [], // empty-page
};

/**
 * Page 12 — New per-block rule sins
 *
 * Triggers: assessment-format-hint, video-captions,
 *           audio-transcript-quality, card-both-sides, empty-table-cells,
 *           color-only-information, images-of-text, video-audio-autoplay
 */
const page12: PraxityPage = {
	id: "p12",
	title: "New Rule Triggers",
	blocks: [
		// assessment-format-hint: textInput with no placeholder or hint
		b("textInput", {
			question: "Enter the year",
			correctAnswers: ["2025"],
			placeholder: "",
			hint: "",
		}),
		// video-captions: video with src but no captionsSrc
		b("video", {
			src: "/lecture.mp4",
			transcript:
				"Full transcript of lecture content goes here for accessibility purposes and compliance with standards.",
			captionTracks: [{ kind: "captions", language: "en", label: "English", src: "/en.vtt" }],
		}),
		// audio-transcript-quality: audio with short transcript
		b("audio", {
			src: "/clip.mp3",
			transcript: "TODO",
		}),
		// video-audio-autoplay: video with autoplay
		b("video", {
			src: "/bg.mp4",
			transcript:
				"Background video showing nature scenes with ambient sounds and relaxing imagery throughout.",
			autoplay: true,
			captionsSrc: "/bg.vtt",
			captionTracks: [
				{ kind: "descriptions", language: "en", label: "English AD", src: "/ad.vtt" },
			],
		}),
		// card-both-sides: empty back + front image without alt
		b("card", {
			layout: "single",
			items: [
				{
					id: "card-1",
					label: "Term",
					front: [{ id: "img-1", type: "image", data: { src: "/card.jpg", alt: "" } }],
					back: [],
				},
			],
		}),
		// empty-table-cells: empty header cell
		b("table", {
			headers: ["Name", "", "Score"],
			rows: [["Alice", "A", "95"]],
			highlightHeaderRow: true,
			caption: "Results",
		}),
		// color-only-information: note without icon
		b("note", {
			content: "<p>Warning text</p>",
			variant: "warning",
			showIcon: false,
		}),
		// images-of-text: very long alt text on non-decorative image
		b("image", {
			src: "/schedule.jpg",
			altText: "A".repeat(210),
			decorative: false,
		}),
		// Extra decorative image to maintain >50% decorative ratio for decorative-image-overuse
		b("image", { src: "/filler.jpg", decorative: true }),
	],
};

/**
 * Page 13 — New page-level rule sins
 *
 * Triggers: abbreviation-undefined, sensory-only-instructions
 */
const page13: PraxityPage = {
	id: "p13",
	title: "Page Level New Rules",
	blocks: [
		// abbreviation-undefined: SCORM not expanded
		textBlock("<p>The SCORM standard is widely used in eLearning.</p>"),
		// sensory-only-instructions: color reference
		textBlock("<p>Click the red button to submit your answer.</p>"),
	],
};

/**
 * Page 16 — Glossary terms (course-wide)
 *
 * Triggers: glossary-term-orphaned
 */
const page16: PraxityPage = {
	id: "p16",
	title: "Glossary",
	blocks: [
		textBlock("<p>Learn about accessibility standards.</p>"),
		b("glossary-term", {
			term: "Zygomorphic",
			definition: "Having bilateral symmetry",
		}),
	],
};

/**
 * Page 17 — Grammar block type sins (Phase 0)
 *
 * Triggers: rate-question, rating-scale-endpoints, sequence-single-item,
 *           sequence-too-many-items, auto-advance-pause-control,
 *           fill-blank-missing-blanks, fill-blank-missing-instructions,
 *           fill-blank-open-scored,
 *           drag-variant-keyboard-alt, branch-generic-labels, branch-dead-end,
 *           hotspot-region-labels, hotspot-item-count
 */
const page17: PraxityPage = {
	id: "p17",
	title: "Grammar Block Types",
	blocks: [
		// rate-question + rating-scale-endpoints: empty question, no endpoint labels
		b("rate", {}),
		// sequence-single-item: only 1 step
		b("sequence", { items: [{ title: "Only step", content: "Content" }] }),
		// sequence-too-many-items + auto-advance-pause-control: 9 steps, autoAdvance, no pauseControl
		b("sequence", {
			items: Array.from({ length: 9 }, (_, i) => ({
				title: `Step ${i + 1}`,
				content: "Content",
			})),
			autoAdvance: true,
		}),
		// fill-blank-missing-blanks + fill-blank-missing-instructions + drag-variant-keyboard-alt
		b("fill-blank", { style: "word-bank-drag" }),
		// fill-blank-open-scored: open blanks cannot supply a correct scored answer
		b("fill-blank", {
			content: "Today I will ____.",
			instructions: "Finish the sentence",
			scored: true,
		}),
		// branch-generic-labels + branch-dead-end
		b("branch", {
			options: [
				{ label: "Option A", target: "somewhere" },
				{ label: "Option B" }, // dead end — no target
			],
		}),
		// hotspot-region-labels: regions without labels
		b("hotspot", {
			image: "/map.jpg",
			imageAlt: "A map",
			regions: [{ label: "" }, { label: "" }],
		}),
		// hotspot-item-count: 13 regions (> 12 threshold)
		b("hotspot", {
			image: "/diagram.jpg",
			imageAlt: "A diagram",
			regions: Array.from({ length: 13 }, (_, i) => ({
				label: `Region ${i + 1}`,
			})),
		}),
	],
};

/**
 * Page 18 — Grammar assessment type sins (Phase 1)
 *
 * Triggers: assessment-no-correct, choice-option-count, image-only-options,
 *           assessment-too-few-pairs, match-pair-count, assessment-too-few-items
 */
const page18: PraxityPage = {
	id: "p18",
	title: "Grammar Assessment Types",
	blocks: [
		// assessment-no-correct + choice-option-count + image-only-options
		b("assessment", {
			assessmentType: "single",
			question: "Pick one",
			options: Array.from({ length: 12 }, (_, i) => ({
				text: i === 0 ? "" : `Option ${i}`,
				correct: false,
				imageSrc: i === 0 ? "/opt.jpg" : undefined,
			})),
		}),
		// assessment-too-few-pairs
		b("assessment", {
			assessmentType: "matching",
			question: "Match these",
			pairs: [{ left: "A", right: "B" }],
		}),
		// match-pair-count
		b("assessment", {
			assessmentType: "matching",
			question: "Match all",
			pairs: Array.from({ length: 9 }, (_, i) => ({
				left: `L${i}`,
				right: `R${i}`,
			})),
		}),
		// assessment-too-few-items
		b("assessment", {
			assessmentType: "sequence",
			question: "Order these",
			items: [{ text: "Only one" }],
		}),
	],
};

// ---------------------------------------------------------------------------
// The full inaccessible course
// ---------------------------------------------------------------------------

const inaccessibleCourse: PraxityPage[] = [
	{
		id: "html-footnote",
		title: "Option footnotes",
		blocks: [
			b("assessment", {
				response: {
					type: "choice",
					options: [{ id: "yes", label: "<em>Yes</em> @source{N}" }],
				},
			}),
		],
	},
	page1,
	page2,
	page3,
	page4,
	page5,
	page6,
	page7,
	page8,
	page12,
	page13,
	page16,
	page17,
	page18,
	emptyPage,
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("inaccessible course integration test", () => {
	const longModel = `The data arrived late. ${"word ".repeat(197)}`;
	const originalOversizedAdvice = `# Advice\n::: self-check Explain: ${longModel}\nmodel: ${longModel}\n:: ${"x".repeat(121)}\nmissed: Try again.\nevidence: data arrived late\n:: Arrival\nmissed: Describe the arrival.\nevidence: arrived\n:::\n`;
	const selfCheckReads = [
		readLesson(
			`# Source error\n::: self-check Explain the delay.\nmodel: The data arrived late.\n:: Reason\nmissed: Explain the cause.\nevidence: Absent evidence\n:::\n`,
		),
		readLesson(
			`# Advice\n::: self-check Explain the delay.\nmodel: ${longModel}\n:: ${"😀".repeat(61)}\nmissed: Try again.\nevidence: data arrived late\n:: Arrival\nmissed: Describe the arrival.\nevidence: arrived\n:::\n`,
		),
		readLesson(
			"# Spoiler\n::: self-check Explain: The data arrived late.\nmodel: The data arrived late.\n:: Reason\nmissed: Explain the cause.\n:::\n",
		),
	];
	selfCheckReads.push(
		readLesson(
			"# Recall advice\n::: retrieval-sheet Recall\n:: Recall process\nanswer: Recall process\n:: Recall process\nanswer: A distinct answer.\n:::\n",
		),
	);
	for (const body of [
		"::: write-distractors Question\nanswer: RIGHT\n:: Label\noption: right\n:::\n",
		`::: write-distractors ${"Q".repeat(401)}\nanswer: ${"A".repeat(301)}\n:: ${"L".repeat(121)}\noption: ${"O".repeat(301)}\n:: Label\noption: Wrong\n:: label\noption: Other\n:::\n`,
	])
		selfCheckReads.push(readLesson(`---\ntitle: Practice\n---\n# Distractor advice\n${body}`));
	selfCheckReads.push(
		readLesson(
			"---\ntitle: Practice\n---\n# Reading\n::: highlight Read\n:: A target {key}\n:::\n",
		),
	);
	const authorSources = new Map(
		selfCheckReads.flatMap((read) => read.pages.map((page) => [page.id, { read }] as const)),
	);
	const report = checkCourseAccessibility(
		[...inaccessibleCourse, ...selfCheckReads.flatMap((read) => read.pages)],
		{
			flashingGifSources: new Set(["/assets/flashing.gif"]),
		},
		authorSources,
	);
	report.issues.push(
		...checkDesignSystemAccessibility({
			borderRadius: 3,
			typography: { body: { fontFamily: ["Poppins", "sans-serif"] } },
			colors: {
				background: "#ffffff",
				text: "#ffffff",
				accent: "#ffffff",
				buttonBackground: "#ffffff",
				buttonText: "#ffffff",
				success: "#ffffff",
				error: "#ffffff",
				warning: "#ffffff",
			},
			lineHeight: 1.2,
			baseFontSize: 14,
			contentMaxWidth: 900,
		}),
	);

	it("retains the original oversized task and criterion as a grammar refusal", () => {
		const read = readLesson(originalOversizedAdvice);
		expect(read.tree.root.raw).toBe(originalOversizedAdvice);
		expect(read.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["self-check-invalid"]);
		const refused = checkCourseAccessibility(
			read.pages,
			undefined,
			new Map(read.pages.map((page) => [page.id, { read }])),
		);
		expect(
			refused.issues
				.filter((issue) => issue.rule.startsWith("self-check"))
				.map((issue) => issue.rule),
		).toEqual(["self-check-grammar"]);
		expect(JSON.stringify(refused)).not.toMatch(/The data arrived late|Try again|xxxx/);
	});

	it("fires a large number of issues", () => {
		expect(report.failed).toBeGreaterThan(30);
	});

	it("keeps human-judgment checks separate from failures", () => {
		expect(report.cantTell).toBeGreaterThan(0);
		expect(
			new Set(
				report.issues.filter((issue) => issue.outcome === "cantTell").map((issue) => issue.rule),
			),
		).toEqual(
			new Set([
				"choice-raw-html-footnote",
				"write-distractors-author-right",
				"highlight-limited-support",
				"retrieval-sheet-answer-repeats-question",
				"retrieval-sheet-duplicate-question",
				"self-check-task-reveals-model",
				"self-check-model-length",
				"self-check-criterion-length",
				"self-check-hint-actionable",
				"self-check-evidence-overlap",
				"drag-variant-keyboard-alt",
				"gif-flash-threshold",
				"images-of-text",
				"media-audio-description",
			]),
		);
	});

	// Every rule in the checker must fire at least once.
	const EXPECTED_RULES = [
		"choice-raw-html-footnote",
		"highlight-limited-support",
		"write-distractors-author-right",
		"write-distractors-duplicate-label",
		"practice-question-too-long",
		"practice-right-answer-too-long",
		"practice-misconception-too-long",
		"practice-option-too-long",

		"retrieval-sheet-answer-repeats-question",
		"retrieval-sheet-duplicate-question",
		"lesson-title",
		"self-check-grammar",
		"self-check-task-reveals-model",
		"self-check-model-length",
		"self-check-criterion-length",
		"self-check-hint-actionable",
		"self-check-evidence-overlap",
		"ignored-font-setting",
		"ignored-radius-setting",
		"completion-gate-reason",
		"abbreviation-undefined",
		"assessment-empty-stem",
		"assessment-format-hint",
		"assessment-no-correct",
		"assessment-pass-mark",
		"assessment-too-few-items",
		"assessment-too-few-pairs",
		"audio-transcript-quality",
		"auto-advance-pause-control",
		"branch-dead-end",
		"branch-generic-labels",
		"choice-option-count",
		"code-block-empty",
		"color-only-information",
		"columns-too-many",
		"consecutive-headings",
		"container-single-item",
		"container-too-many-items",
		"decorative-image-overuse",
		"drag-variant-keyboard-alt",
		"duplicate-heading",
		"duplicate-links",
		"embed-title",
		"empty-link",
		"empty-page",
		"empty-table-cells",
		"fill-blank-missing-blanks",
		"fill-blank-missing-instructions",
		"fill-blank-open-scored",
		"card-both-sides",
		"font-size-minimum",
		"gif-flash-threshold",
		"glossary-term-orphaned",
		"gmcq-correct-answer",
		"gmcq-image-alt",
		"gmcq-question",
		"heading-hierarchy",
		"heading-length",
		"hotgraphic-alt",
		"hotspot-image-alt",
		"hotspot-item-count",
		"hotspot-region-labels",
		"image-alt",
		"image-alt-length",
		"image-alt-quality",
		"image-cluster-without-context",
		"image-only-options",
		"images-of-text",
		"labeled-graphic-alt",
		"line-height-minimum",
		"link-text-quality",
		"match-pair-count",
		"max-content-width",
		"mcq-correct-answer",
		"mcq-question",
		"media-audio-description",
		"media-transcript",
		"narrative-image-alt",
		"page-title",
		"paragraph-length-excessive",
		"rate-question",
		"rating-scale-endpoints",
		"repeated-alt-text",
		"sensory-only-instructions",
		"sentence-length-excessive",
		"sequence-single-item",
		"sequence-too-many-items",
		"slider-question",
		"sorting-categories",
		"table-caption",
		"table-headers",
		"textInput-correct-answer",
		"textInput-question",
		"theme-accent-on-background-contrast",
		"theme-button-text-contrast",
		"theme-error-on-background-contrast",
		"theme-success-on-background-contrast",
		"theme-text-on-background-contrast",
		"theme-warning-on-background-contrast",
		"video-audio-autoplay",
		"video-captions",
		"video-following-heading",
	];

	const firedRules = new Set(report.issues.map((i) => i.rule));

	it("every known rule fires at least once", () => {
		const missing = EXPECTED_RULES.filter((r) => !firedRules.has(r));
		expect(missing).toEqual([]);
	});

	it("no unexpected rules fire (catch new rules missing from EXPECTED_RULES)", () => {
		const unexpected = [...firedRules].filter((r) => !EXPECTED_RULES.includes(r));
		expect(unexpected).toEqual([]);
	});

	it("has reviewed metadata for exactly the emitted rule catalog", () => {
		expect(Object.keys(RULE_METADATA).sort()).toEqual([...EXPECTED_RULES].sort());
		for (const metadata of Object.values(RULE_METADATA)) {
			expect(metadata.testMode).toBe("automated");
			expect(metadata.assumptions).toBeDefined();
			expect(metadata.requirements).toBeDefined();
			expect(metadata.exportPolicy).toMatch(/^(block|review)$/);
		}
	});

	it("gives every occurrence a unique authored-source identity", () => {
		const ids = report.issues.map(buildA11yOccurrenceId);
		expect(report.issues.every((issue) => issue.sourceLocation.length > 0)).toBe(true);
		expect(new Set(ids).size).toBe(ids.length);
	});

	// Severity distribution sanity check
	it("has issues at every severity level", () => {
		const severities = new Set(report.issues.map((i) => i.severity));
		expect(severities.has("critical")).toBe(true);
		expect(severities.has("serious")).toBe(true);
		expect(severities.has("moderate")).toBe(true);
		expect(severities.has("minor")).toBe(true);
	});

	// Per-rule spot checks to verify correct severity
	it.each([
		["image-alt", "critical"],
		["hotspot-image-alt", "critical"],
		["media-transcript", "serious"],
		["link-text-quality", "serious"],
		["table-headers", "serious"],
		["heading-hierarchy", "moderate"],
		["table-caption", "moderate"],
		["decorative-image-overuse", "moderate"],
		["media-audio-description", "minor"],
		["duplicate-heading", "minor"],
		["consecutive-headings", "minor"],
		["heading-length", "minor"],
		["duplicate-links", "minor"],
		// New rules
		["assessment-format-hint", "moderate"],
		["video-captions", "serious"],
		["gif-flash-threshold", "serious"],
		["audio-transcript-quality", "moderate"],
		["card-both-sides", "serious"],
		["empty-table-cells", "moderate"],
		["color-only-information", "moderate"],
		["images-of-text", "moderate"],
		["abbreviation-undefined", "minor"],
		["sensory-only-instructions", "moderate"],
		["glossary-term-orphaned", "minor"],
		["video-audio-autoplay", "serious"],
		["line-height-minimum", "serious"],
		["font-size-minimum", "serious"],
		["max-content-width", "moderate"],
	])("%s has severity %s", (rule, expectedSeverity) => {
		const issue = report.issues.find((i) => i.rule === rule);
		expect(issue).toBeDefined();
		expect(issue?.severity).toBe(expectedSeverity);
	});
});
