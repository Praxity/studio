export type DisplayCategory =
	| "imageMedia"
	| "headingsStructure"
	| "linksNavigation"
	| "assessmentInteraction"
	| "tables"
	| "contentQuality"
	| "visualSemantic"
	| "designSystem"
	| "other";

export type DisplaySeverity = "critical" | "recommended" | "minor";
export type FixDomain = "content" | "blockSettings" | "designSystem" | "structural";
export type RuleKind = "conformance" | "advisory" | "contentQuality";
export type RuleConfidence = "high" | "medium" | "low";
export type ExportPolicy = "block" | "review";

export interface Requirement {
	standard: "WCAG";
	version: "2.2";
	criterion: string;
	level: "A" | "AA" | "AAA";
}

export interface RuleMetadata {
	category: DisplayCategory;
	displaySeverity: DisplaySeverity;
	fixDomain: FixDomain;
	kind: RuleKind;
	confidence: RuleConfidence;
	testMode: "automated";
	assumptions: readonly string[];
	requirements: readonly Requirement[];
	exportPolicy: ExportPolicy;
}

export const DISPLAY_CATEGORY_ORDER: DisplayCategory[] = [
	"imageMedia",
	"headingsStructure",
	"linksNavigation",
	"assessmentInteraction",
	"tables",
	"contentQuality",
	"visualSemantic",
	"designSystem",
	"other",
];

const wcag = (criterion: string, level: Requirement["level"]): Requirement => ({
	standard: "WCAG",
	version: "2.2",
	criterion,
	level,
});

function metadata(
	category: DisplayCategory,
	displaySeverity: DisplaySeverity,
	fixDomain: FixDomain,
	kind: RuleKind,
	confidence: RuleConfidence,
	requirements: readonly Requirement[] = [],
	assumptions: readonly string[] = [],
): RuleMetadata {
	return {
		category,
		displaySeverity,
		fixDomain,
		kind,
		confidence,
		testMode: "automated",
		assumptions,
		requirements,
		exportPolicy:
			kind === "conformance" && confidence === "high" && displaySeverity === "critical"
				? "block"
				: "review",
	};
}

const nonText = [wcag("1.1.1", "A")];
const labels = [wcag("3.3.2", "A")];

/** Reviewed metadata for every rule the source checker can emit. */
export const RULE_METADATA = {
	"choice-raw-html-footnote": metadata(
		"assessmentInteraction",
		"minor",
		"content",
		"advisory",
		"high",
	),
	"highlight-limited-support": metadata(
		"assessmentInteraction",
		"minor",
		"content",
		"advisory",
		"high",
		[],
		[
			"Source authoring and browser print are supported. This information is not a conformance failure.",
		],
	),
	"write-distractors-author-right": metadata(
		"assessmentInteraction",
		"minor",
		"content",
		"contentQuality",
		"high",
		[],
		["Grammar owns this diagnostic; Check reuses its fixed copy and source location."],
	),
	"write-distractors-duplicate-label": metadata(
		"assessmentInteraction",
		"critical",
		"content",
		"conformance",
		"high",
		[],
		["Grammar validity, not a WCAG claim: this source error refuses publication."],
	),
	"practice-question-too-long": metadata(
		"assessmentInteraction",
		"critical",
		"content",
		"conformance",
		"high",
		[],
		["Grammar validity, not a WCAG claim: this source error refuses publication."],
	),
	"practice-right-answer-too-long": metadata(
		"assessmentInteraction",
		"critical",
		"content",
		"conformance",
		"high",
		[],
		["Grammar validity, not a WCAG claim: this source error refuses publication."],
	),
	"practice-misconception-too-long": metadata(
		"assessmentInteraction",
		"critical",
		"content",
		"conformance",
		"high",
		[],
		["Grammar validity, not a WCAG claim: this source error refuses publication."],
	),
	"practice-option-too-long": metadata(
		"assessmentInteraction",
		"critical",
		"content",
		"conformance",
		"high",
		[],
		["Grammar validity, not a WCAG claim: this source error refuses publication."],
	),

	"retrieval-sheet-answer-repeats-question": metadata(
		"assessmentInteraction",
		"minor",
		"content",
		"contentQuality",
		"low",
		[],
		[
			"Only full equality after NFC, case and whitespace normalization is detected. Authors judge whether repetition is intentional.",
		],
	),
	"retrieval-sheet-duplicate-question": metadata(
		"assessmentInteraction",
		"minor",
		"content",
		"contentQuality",
		"low",
		[],
		[
			"Only full question equality after NFC, case and whitespace normalization within one sheet is detected.",
		],
	),
	"lesson-title": metadata("headingsStructure", "minor", "structural", "contentQuality", "high"),
	"self-check-grammar": metadata(
		"assessmentInteraction",
		"recommended",
		"content",
		"advisory",
		"high",
		[],
		["Grammar owns content and settings validity; this rule displays its source diagnostics."],
	),
	"self-check-task-reveals-model": metadata(
		"assessmentInteraction",
		"recommended",
		"content",
		"contentQuality",
		"low",
		[],
		[
			"Only the complete model answer, normalized for case and whitespace, is detected in the task. A person must judge whether the disclosure is intentional.",
		],
	),
	"self-check-model-length": metadata(
		"assessmentInteraction",
		"minor",
		"content",
		"contentQuality",
		"low",
		[],
		["More than 200 whitespace-separated words is comparison guidance, not a content limit."],
	),
	"self-check-criterion-length": metadata(
		"assessmentInteraction",
		"minor",
		"content",
		"contentQuality",
		"low",
		[],
		["More than 120 characters is scanning guidance, not a content limit."],
	),
	"self-check-hint-actionable": metadata(
		"assessmentInteraction",
		"recommended",
		"content",
		"contentQuality",
		"low",
		[],
		[
			"Only repeated labels and common EN/FR retry placeholders are detected. A person must judge whether a hint is actionable.",
		],
	),
	"self-check-evidence-overlap": metadata(
		"assessmentInteraction",
		"recommended",
		"content",
		"advisory",
		"high",
		[],
		[
			"The library's annotation result omits a criterion's overlapping evidence. Whole-answer criteria intentionally have no individual mark.",
		],
	),
	"ignored-font-setting": metadata("designSystem", "minor", "designSystem", "advisory", "high"),
	"ignored-radius-setting": metadata("designSystem", "minor", "designSystem", "advisory", "high"),
	// Image and media
	"image-alt": metadata("imageMedia", "critical", "blockSettings", "conformance", "high", nonText, [
		"Images explicitly marked decorative do not require alt text, including nested images.",
	]),
	"image-alt-quality": metadata(
		"imageMedia",
		"recommended",
		"blockSettings",
		"contentQuality",
		"medium",
		nonText,
		[
			"The checker recognizes only common placeholder and filename patterns; a person must judge whether the alternative conveys the image's purpose.",
		],
	),
	"image-alt-length": metadata(
		"imageMedia",
		"minor",
		"blockSettings",
		"contentQuality",
		"low",
		[],
		["Length is readability guidance, not a WCAG maximum."],
	),
	"gif-flash-threshold": metadata(
		"imageMedia",
		"recommended",
		"blockSettings",
		"conformance",
		"low",
		[wcag("2.3.1", "A")],
		[
			"Frame timing is estimated from the source GIF; rendered size and flash area still require human review.",
		],
	),
	"images-of-text": metadata(
		"imageMedia",
		"recommended",
		"blockSettings",
		"conformance",
		"low",
		[wcag("1.4.5", "AA")],
		[
			"Long alternative text can suggest, but cannot establish, that an image contains text or that an exception applies.",
		],
	),
	"media-transcript": metadata(
		"imageMedia",
		"recommended",
		"blockSettings",
		"advisory",
		"medium",
		[wcag("1.2.1", "A"), wcag("1.2.3", "A")],
		[
			"The source model does not establish whether video alternatives or transcript content satisfy the applicable media requirement.",
		],
	),
	"video-captions": metadata("imageMedia", "recommended", "blockSettings", "conformance", "high", [
		wcag("1.2.2", "A"),
	]),
	"video-audio-autoplay": metadata(
		"imageMedia",
		"recommended",
		"blockSettings",
		"advisory",
		"medium",
		[wcag("1.4.2", "A")],
		[
			"The checker sees the autoplay setting but cannot establish whether audio plays for more than three seconds or whether a control is rendered.",
		],
	),
	"media-audio-description": metadata(
		"imageMedia",
		"minor",
		"blockSettings",
		"conformance",
		"low",
		[wcag("1.2.5", "AA")],
		[
			"A person must decide whether the prerecorded video contains important visual information that is absent from the audio track.",
		],
	),
	"audio-transcript-quality": metadata(
		"imageMedia",
		"recommended",
		"blockSettings",
		"contentQuality",
		"low",
		[wcag("1.2.1", "A")],
		[
			"Character count can identify likely placeholders but cannot establish transcript equivalence.",
		],
	),
	"hotgraphic-alt": metadata(
		"imageMedia",
		"critical",
		"blockSettings",
		"conformance",
		"high",
		nonText,
		["Background images explicitly marked decorative do not require alt text."],
	),
	"narrative-image-alt": metadata(
		"imageMedia",
		"critical",
		"blockSettings",
		"conformance",
		"high",
		nonText,
	),
	"gmcq-image-alt": metadata(
		"imageMedia",
		"critical",
		"blockSettings",
		"conformance",
		"high",
		nonText,
	),
	"hotspot-image-alt": metadata(
		"imageMedia",
		"critical",
		"blockSettings",
		"conformance",
		"high",
		nonText,
		["Background images explicitly marked decorative do not require alt text."],
	),
	"labeled-graphic-alt": metadata(
		"imageMedia",
		"critical",
		"blockSettings",
		"conformance",
		"high",
		nonText,
		["Background images explicitly marked decorative do not require alt text."],
	),
	"hotspot-region-labels": metadata(
		"imageMedia",
		"recommended",
		"blockSettings",
		"conformance",
		"high",
		[wcag("2.4.6", "AA"), wcag("4.1.2", "A")],
	),
	"hotspot-item-count": metadata(
		"imageMedia",
		"recommended",
		"blockSettings",
		"contentQuality",
		"low",
		[],
		["The item limit is cognitive-load guidance, not a conformance threshold."],
	),
	"auto-advance-pause-control": metadata(
		"imageMedia",
		"recommended",
		"blockSettings",
		"conformance",
		"medium",
		[wcag("2.2.2", "A")],
		[
			"The source setting does not establish the rendered timing or every available pause mechanism.",
		],
	),

	// Headings and structure
	"page-title": metadata("headingsStructure", "recommended", "content", "conformance", "high", [
		wcag("2.4.2", "A"),
	]),
	"heading-hierarchy": metadata(
		"headingsStructure",
		"recommended",
		"content",
		"advisory",
		"low",
		[wcag("1.3.1", "A"), wcag("2.4.10", "AAA")],
		["Skipped ranks do not by themselves establish a WCAG 2.2 A or AA failure."],
	),
	"heading-length": metadata(
		"headingsStructure",
		"minor",
		"content",
		"contentQuality",
		"low",
		[],
		["The character limit is scannability guidance."],
	),
	"duplicate-heading": metadata(
		"headingsStructure",
		"minor",
		"content",
		"advisory",
		"low",
		[wcag("2.4.6", "AA")],
		["Repeated heading text can be appropriate in distinct contexts."],
	),
	"consecutive-headings": metadata(
		"headingsStructure",
		"minor",
		"content",
		"advisory",
		"low",
		[wcag("1.3.1", "A")],
		["Adjacent headings can represent a valid hierarchy."],
	),
	"empty-page": metadata("headingsStructure", "recommended", "content", "contentQuality", "high"),
	"video-following-heading": metadata(
		"headingsStructure",
		"recommended",
		"structural",
		"advisory",
		"low",
		[wcag("2.4.1", "A")],
		[
			"Media placement is not a prescribed bypass-blocks technique; rendered context and reading order require review.",
		],
	),

	// Links and navigation
	"empty-link": metadata("linksNavigation", "critical", "content", "conformance", "high", [
		wcag("2.4.4", "A"),
		wcag("4.1.2", "A"),
	]),
	"link-text-quality": metadata(
		"linksNavigation",
		"recommended",
		"content",
		"advisory",
		"low",
		[wcag("2.4.4", "A")],
		[
			"Link purpose can be clear from programmatically determined context even when isolated text is generic.",
		],
	),
	"embed-title": metadata(
		"linksNavigation",
		"recommended",
		"blockSettings",
		"conformance",
		"high",
		[wcag("2.4.1", "A"), wcag("4.1.2", "A")],
	),
	"abbreviation-undefined": metadata(
		"linksNavigation",
		"minor",
		"content",
		"contentQuality",
		"low",
		[wcag("3.1.4", "AAA")],
		[
			"Definitions may be available elsewhere in the course or be unnecessary for the intended audience.",
		],
	),
	"duplicate-links": metadata(
		"linksNavigation",
		"minor",
		"content",
		"advisory",
		"low",
		[wcag("2.4.4", "A")],
		["Repeated destinations can support separate tasks and are not failures by themselves."],
	),
	"branch-generic-labels": metadata(
		"linksNavigation",
		"recommended",
		"content",
		"advisory",
		"medium",
		[wcag("2.4.4", "A"), wcag("2.4.6", "AA")],
		["The surrounding branch prompt may provide sufficient context."],
	),
	"branch-dead-end": metadata(
		"linksNavigation",
		"recommended",
		"content",
		"contentQuality",
		"medium",
		[],
		["Intentional terminal branches are valid when the learner can continue or return."],
	),

	// Assessment and interaction
	"completion-gate-reason": metadata(
		"linksNavigation",
		"recommended",
		"content",
		"advisory",
		"high",
		[],
		[
			"Praxity requires an authored reason for forward-progress gates; reason clarity still needs human review.",
		],
	),
	"mcq-question": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"conformance",
		"high",
		labels,
	),
	"mcq-correct-answer": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"high",
	),
	"gmcq-question": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"conformance",
		"high",
		labels,
	),
	"gmcq-correct-answer": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"high",
	),
	"slider-question": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"conformance",
		"high",
		labels,
	),
	"textInput-question": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"conformance",
		"high",
		labels,
	),
	"textInput-correct-answer": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"high",
	),
	"assessment-format-hint": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"advisory",
		"medium",
		labels,
		["The expected response format may already be clear from the question and input type."],
	),
	"assessment-pass-mark": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"high",
	),
	"sorting-categories": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"high",
	),
	"card-both-sides": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"high",
	),
	"rate-question": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"conformance",
		"high",
		labels,
	),
	"assessment-empty-stem": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"conformance",
		"high",
		labels,
	),
	"assessment-no-correct": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"high",
	),
	"assessment-too-few-pairs": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"high",
	),
	"assessment-too-few-items": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"high",
	),
	"fill-blank-missing-blanks": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"high",
	),
	"fill-blank-missing-instructions": metadata(
		"assessmentInteraction",
		"recommended",
		"content",
		"advisory",
		"medium",
		labels,
		["The surrounding content may already explain the task."],
	),
	"fill-blank-open-scored": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"high",
	),
	"choice-option-count": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"low",
		[],
		["The option limit is cognitive-load guidance."],
	),
	"image-only-options": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"conformance",
		"high",
		[wcag("1.1.1", "A"), wcag("3.3.2", "A")],
	),
	"match-pair-count": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"contentQuality",
		"low",
		[],
		["The pair limit is cognitive-load guidance."],
	),
	"drag-variant-keyboard-alt": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"conformance",
		"medium",
		[wcag("2.1.1", "A"), wcag("2.5.7", "AA")],
		[
			"A drag presentation can still have a keyboard and single-pointer alternative in the rendered component.",
		],
	),
	"rating-scale-endpoints": metadata(
		"assessmentInteraction",
		"recommended",
		"blockSettings",
		"advisory",
		"medium",
		labels,
		["Other visible or programmatic context may explain the scale."],
	),

	// Tables
	"table-headers": metadata("tables", "recommended", "blockSettings", "conformance", "high", [
		wcag("1.3.1", "A"),
	]),
	"table-caption": metadata(
		"tables",
		"recommended",
		"blockSettings",
		"advisory",
		"low",
		[wcag("1.3.1", "A")],
		["A nearby heading or surrounding text may already identify the table."],
	),
	"empty-table-cells": metadata(
		"tables",
		"recommended",
		"blockSettings",
		"advisory",
		"medium",
		[wcag("1.3.1", "A")],
		[
			"Empty data cells can be valid; the checker combines empty-header and likely-layout-table heuristics.",
		],
	),

	// Content quality
	"decorative-image-overuse": metadata(
		"contentQuality",
		"recommended",
		"structural",
		"contentQuality",
		"low",
		nonText,
		["A high decorative-image ratio does not establish that any individual image is informative."],
	),
	"sentence-length-excessive": metadata(
		"contentQuality",
		"recommended",
		"content",
		"contentQuality",
		"low",
		[wcag("3.1.5", "AAA")],
		["The word limit is readability guidance and does not measure reading level."],
	),
	"paragraph-length-excessive": metadata(
		"contentQuality",
		"minor",
		"content",
		"contentQuality",
		"low",
		[],
		["The word limit is readability guidance."],
	),
	"image-cluster-without-context": metadata(
		"contentQuality",
		"minor",
		"content",
		"contentQuality",
		"low",
		[],
		[
			"Adjacent images can be intentional when their alternatives and surrounding context are sufficient.",
		],
	),

	// Visual and semantic
	"color-only-information": metadata(
		"visualSemantic",
		"recommended",
		"blockSettings",
		"conformance",
		"medium",
		[wcag("1.4.1", "A")],
		["The source variant and icon setting do not expose every rendered textual cue."],
	),
	"sensory-only-instructions": metadata(
		"visualSemantic",
		"recommended",
		"content",
		"conformance",
		"medium",
		[wcag("1.3.3", "A")],
		["Pattern matching cannot establish the complete instruction context."],
	),
	"container-single-item": metadata(
		"visualSemantic",
		"recommended",
		"structural",
		"contentQuality",
		"high",
	),
	"container-too-many-items": metadata(
		"visualSemantic",
		"recommended",
		"structural",
		"contentQuality",
		"low",
		[],
		["The item limit is usability guidance."],
	),
	"columns-too-many": metadata(
		"visualSemantic",
		"recommended",
		"structural",
		"advisory",
		"low",
		[wcag("1.4.10", "AA")],
		[
			"Column count and source child count do not establish rendered reflow or loss of information.",
		],
	),
	"repeated-alt-text": metadata(
		"visualSemantic",
		"minor",
		"blockSettings",
		"advisory",
		"low",
		nonText,
		["Different images can appropriately share an alternative when they serve the same purpose."],
	),
	"code-block-empty": metadata(
		"visualSemantic",
		"recommended",
		"content",
		"contentQuality",
		"high",
	),
	"glossary-term-orphaned": metadata(
		"visualSemantic",
		"minor",
		"content",
		"contentQuality",
		"medium",
	),
	"sequence-single-item": metadata(
		"visualSemantic",
		"recommended",
		"structural",
		"contentQuality",
		"high",
	),
	"sequence-too-many-items": metadata(
		"visualSemantic",
		"recommended",
		"structural",
		"contentQuality",
		"low",
		[],
		["The item limit is cognitive-load guidance."],
	),

	// Design system
	"theme-text-on-background-contrast": metadata(
		"designSystem",
		"critical",
		"designSystem",
		"conformance",
		"high",
		[wcag("1.4.3", "AA")],
	),
	"theme-button-text-contrast": metadata(
		"designSystem",
		"critical",
		"designSystem",
		"conformance",
		"high",
		[wcag("1.4.3", "AA")],
	),
	"theme-accent-on-background-contrast": metadata(
		"designSystem",
		"recommended",
		"designSystem",
		"advisory",
		"low",
		[wcag("1.4.11", "AA")],
		["The accent token can be decorative; source colors do not establish its rendered purpose."],
	),
	"theme-success-on-background-contrast": metadata(
		"designSystem",
		"recommended",
		"designSystem",
		"conformance",
		"medium",
		[wcag("1.4.3", "AA"), wcag("1.4.11", "AA")],
		[
			"The token can be used for text, a required graphic, or decoration; rendered usage determines the applicable threshold.",
		],
	),
	"theme-warning-on-background-contrast": metadata(
		"designSystem",
		"recommended",
		"designSystem",
		"conformance",
		"medium",
		[wcag("1.4.3", "AA"), wcag("1.4.11", "AA")],
		[
			"The token can be used for text, a required graphic, or decoration; rendered usage determines the applicable threshold.",
		],
	),
	"theme-error-on-background-contrast": metadata(
		"designSystem",
		"recommended",
		"designSystem",
		"conformance",
		"medium",
		[wcag("1.4.3", "AA"), wcag("1.4.11", "AA")],
		[
			"The token can be used for text, a required graphic, or decoration; rendered usage determines the applicable threshold.",
		],
	),
	"line-height-minimum": metadata(
		"designSystem",
		"recommended",
		"designSystem",
		"advisory",
		"low",
		[wcag("1.4.12", "AA")],
		[
			"A default line-height value does not test whether users can override text spacing without loss of content or functionality.",
		],
	),
	"font-size-minimum": metadata(
		"designSystem",
		"recommended",
		"designSystem",
		"advisory",
		"low",
		[],
		[
			"WCAG does not prescribe a 16px minimum; browser zoom and rendered reflow require separate testing.",
		],
	),
	"max-content-width": metadata(
		"designSystem",
		"recommended",
		"designSystem",
		"advisory",
		"low",
		[wcag("1.4.8", "AAA")],
		[
			"A pixel width does not establish the number of characters per line across fonts and viewport sizes.",
		],
	),
} satisfies Record<string, RuleMetadata>;

export type A11yRule = keyof typeof RULE_METADATA;

export function getRuleMetadata(rule: string): RuleMetadata {
	const result = RULE_METADATA[rule as A11yRule];
	if (!result) throw new Error(`Missing accessibility metadata for rule: ${rule}`);
	return result;
}

export function isExportBlockingIssue(issue: {
	outcome: "failed" | "cantTell";
	rule: string;
}): boolean {
	const rule = getRuleMetadata(issue.rule);
	return (
		issue.outcome === "failed" &&
		rule.kind === "conformance" &&
		rule.confidence === "high" &&
		rule.displaySeverity === "critical" &&
		rule.exportPolicy === "block"
	);
}
