import { readLesson } from "@praxity/grammar";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { checkCourseAccessibility, checkDesignSystemAccessibility } from "../checker";
import { buildA11yOccurrenceId } from "../occurrence-id";
import { RULE_METADATA } from "../rule-metadata";

let blockId = 0;
function b(type: string, data: Record<string, unknown>): PraxityBlock {
	return { id: `blk-${++blockId}`, type: type as PraxityBlock["type"], data };
}

function textBlock(html: string) {
	return b("text", { content: html });
}

const page1: PraxityPage = {
	id: "p1",
	title: "",
	blocks: [
		b("logic", { actions: [{ type: "disableCompletion", targets: [] }] }),
		b("image", { src: "/hero.jpg", altText: "", decorative: false }),
		b("image", { src: "/photo.jpg", altText: "image", decorative: false }),
		b("image", { src: "/shot.jpg", altText: "DSC_0042.jpg", decorative: false }),
		b("image", {
			src: "/chart.jpg",
			altText: "A".repeat(130),
			decorative: false,
		}),
		b("image", { src: "/team1.jpg", altText: "Team meeting", decorative: false }),
		b("image", { src: "/team2.jpg", altText: "Team meeting", decorative: false }),
		b("image", { src: "/d1.jpg", decorative: true }),
		b("image", { src: "/d2.jpg", decorative: true }),
		b("image", { src: "/d3.jpg", decorative: true }),
		b("image", { src: "/d4.jpg", decorative: true }),
		b("image", { src: "/d5.jpg", decorative: true }),
		b("image", { src: "/d6.jpg", decorative: true }),
		b("image", { src: "/d7.jpg", decorative: true }),
		b("note", { backgroundImage: "/assets/flashing.gif", content: "Safety signal" }),
		b("note", { backgroundImage: "/assets/unchecked.gif", content: "Recording" }),
	],
};

const page2: PraxityPage = {
	id: "p2",
	title: "Bad Links & Headings",
	blocks: [
		textBlock('<p><a href="https://example.com">click here</a></p>'),
		textBlock('<p><a href="https://example.com">https://example.com/path</a></p>'),
		textBlock('<p><a href="https://example.com"></a></p>'),
		textBlock("<h2>Section</h2><h4>Subsection</h4>"),
		textBlock("<h2>Overview</h2><p>Some text</p>"),
		textBlock("<h2>Overview</h2><p>More text</p>"),
		textBlock("<h3>Part A</h3>"),
		textBlock("<h3>Part B</h3>"),
		b("heading", { content: "Page Title Repeated", level: 1 }),
		b("heading", { content: "X".repeat(125), level: 2 }),
		textBlock('<p><a href="https://example.com">Another link to example</a></p>'),
	],
};

const page3: PraxityPage = {
	id: "p3",
	title: "Media Problems",
	blocks: [
		b("video", { src: "/intro.mp4", transcript: "" }),
		b("audio", { src: "/podcast.mp3", transcript: "" }),
		b("embed", { url: "https://example.com/widget", title: "" }),
	],
};

const page4: PraxityPage = {
	id: "p4",
	title: "Tables & Buttons",
	blocks: [
		b("table", {
			headers: ["A", "B"],
			rows: [["1", "2"]],
			highlightHeaderRow: false,
			highlightHeaderCol: false,
			caption: "",
		}),
		b("button", { text: "", href: "https://example.com" }),
		b("button", { text: "Click here", href: "https://example.com" }),
		b("document", { title: "Download", display: "button", url: "/file.pdf" }),
		b("document", { title: "Click here", display: "bookmark", url: "/file.pdf" }),
		b("document", { url: "/file.pdf" }),
	],
};

const page5: PraxityPage = {
	id: "p5",
	title: "Container Issues",
	blocks: [
		b("tabs", {
			items: [{ id: "t1", label: "Only", children: [] }],
			trackCompletion: false,
		}),
		b("accordion", {
			items: [{ id: "a1", label: "Only", children: [] }],
			trackCompletion: false,
		}),
		b("tabs", {
			items: Array.from({ length: 8 }, (_, i) => ({
				id: `t${i}`,
				label: `Tab ${i + 1}`,
				children: [],
			})),
			trackCompletion: false,
		}),
		b("columns", {
			items: Array.from({ length: 4 }, (_, i) => ({
				id: `c${i}`,
				width: 0.25,
				children: [{ id: `x${i}`, type: "text", data: {} }],
			})),
		}),
	],
};

const page6: PraxityPage = {
	id: "p6",
	title: "Assessment Failures",
	blocks: [
		b("mcq", {
			question: "",
			options: [
				{ text: "A", isCorrect: false },
				{ text: "B", isCorrect: false },
			],
		}),
		b("gmcq", {
			question: "",
			options: [{ text: "A", isCorrect: false, imageSrc: "/opt.jpg", imageAlt: "" }],
		}),
		b("slider", { question: "" }),
		b("textInput", { question: "", correctAnswers: [] }),
		b("sorting", { categories: [{ id: "c1", label: "Only one" }] }),
		b("assessmentResults", { passMark: 0 }),
		b("assessment", {
			assessmentType: "hotspot",
			gradingMode: "exact",
			response: { type: "hotspot", image: "/map.jpg", imageAlt: "", hotspots: [] },
			feedback: { correct: [], incorrect: [] },
			feedbackEnabled: true,
		}),
	],
};

const page7: PraxityPage = {
	id: "p7",
	title: "Legacy Blocks",
	blocks: [
		b("hotgraphic", { imageAlt: "" }),
		b("labeledGraphic", { imageAlt: "" }),
		b("narrative", {
			items: [{ id: "s1", imageSrc: "/slide.jpg", imageAlt: "" }],
		}),
		b("imageComparison", {
			beforeImage: { src: "/before.jpg", altText: "" },
			afterImage: { src: "/after.jpg", altText: "" },
		}),
	],
};

const page8: PraxityPage = {
	id: "p8",
	title: "Wall of Text",
	blocks: [
		...Array.from({ length: 4 }, (_, i) =>
			textBlock(`<p>${"word ".repeat(360)}Paragraph ${i + 1} end.</p>`),
		),
		b("code", { code: "", language: "javascript" }),
	],
};

const emptyPage: PraxityPage = {
	id: "p9",
	title: "Empty Page",
	blocks: [],
};

const page12: PraxityPage = {
	id: "p12",
	title: "New Rule Triggers",
	blocks: [
		b("textInput", {
			question: "Enter the year",
			correctAnswers: ["2025"],
			placeholder: "",
			hint: "",
		}),
		b("video", {
			src: "/lecture.mp4",
			transcript:
				"Full transcript of lecture content goes here for accessibility purposes and compliance with standards.",
			captionTracks: [{ kind: "captions", language: "en", label: "English", src: "/en.vtt" }],
		}),
		b("audio", {
			src: "/clip.mp3",
			transcript: "TODO",
		}),
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
		b("table", {
			headers: ["Name", "", "Score"],
			rows: [["Alice", "A", "95"]],
			highlightHeaderRow: true,
			caption: "Results",
		}),
		b("note", {
			content: "<p>Warning text</p>",
			variant: "warning",
			showIcon: false,
		}),
		b("image", {
			src: "/schedule.jpg",
			altText: "A".repeat(210),
			decorative: false,
		}),
		b("image", { src: "/filler.jpg", decorative: true }),
	],
};

const page13: PraxityPage = {
	id: "p13",
	title: "Page Level New Rules",
	blocks: [
		textBlock("<p>The SCORM standard is widely used in eLearning.</p>"),
		textBlock("<p>Click the red button to submit your answer.</p>"),
	],
};

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

const page17: PraxityPage = {
	id: "p17",
	title: "Grammar Block Types",
	blocks: [
		b("rate", {}),
		b("sequence", { items: [{ title: "Only step", content: "Content" }] }),
		b("sequence", {
			items: Array.from({ length: 9 }, (_, i) => ({
				title: `Step ${i + 1}`,
				content: "Content",
			})),
			autoAdvance: true,
		}),
		b("fill-blank", { style: "word-bank-drag" }),
		b("fill-blank", {
			content: "Today I will ____.",
			instructions: "Finish the sentence",
			scored: true,
		}),
		b("branch", {
			options: [{ label: "Option A", target: "somewhere" }, { label: "Option B" }],
		}),
		b("hotspot", {
			image: "/map.jpg",
			imageAlt: "A map",
			regions: [{ label: "" }, { label: "" }],
		}),
		b("hotspot", {
			image: "/diagram.jpg",
			imageAlt: "A diagram",
			regions: Array.from({ length: 13 }, (_, i) => ({
				label: `Region ${i + 1}`,
			})),
		}),
	],
};

const page18: PraxityPage = {
	id: "p18",
	title: "Grammar Assessment Types",
	blocks: [
		b("assessment", {
			assessmentType: "single",
			question: "Pick one",
			options: Array.from({ length: 12 }, (_, i) => ({
				text: i === 0 ? "" : `Option ${i}`,
				correct: false,
				imageSrc: i === 0 ? "/opt.jpg" : undefined,
			})),
		}),
		b("assessment", {
			assessmentType: "matching",
			question: "Match these",
			pairs: [{ left: "A", right: "B" }],
		}),
		b("assessment", {
			assessmentType: "matching",
			question: "Match all",
			pairs: Array.from({ length: 9 }, (_, i) => ({
				left: `L${i}`,
				right: `R${i}`,
			})),
		}),
		b("assessment", {
			assessmentType: "sequence",
			question: "Order these",
			items: [{ text: "Only one" }],
		}),
	],
};

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
			uncheckedGifSources: new Map([["/assets/unchecked.gif", "too-large"]]),
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
				"images-of-text",
				"gif-flash-unchecked",
				"media-audio-description",
			]),
		);
	});

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
		"gif-flash-unchecked",
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

	it("has issues at every severity level", () => {
		const severities = new Set(report.issues.map((i) => i.severity));
		expect(severities.has("critical")).toBe(true);
		expect(severities.has("serious")).toBe(true);
		expect(severities.has("moderate")).toBe(true);
		expect(severities.has("minor")).toBe(true);
	});

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
