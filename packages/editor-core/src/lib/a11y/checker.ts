import { isInlineProjectionMetadataKey } from "@praxity/shared-blocks/inline-markdown";
/**
 * Accessibility checker for Praxity courses.
 *
 * Performs fast, browser-free checks on authored pages, blocks, assets, and
 * design tokens. Rendered-output and assistive-technology testing are separate
 * evidence and are never inferred from silence here.
 */

import { getDesignSettingWarnings, isSafeCaptionTrackUrl } from "@praxity/grammar";
import { isDecorativeImage, readAltText } from "@praxity/shared-blocks/image-a11y";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { isDirectVideoUrl } from "@praxity/shared-blocks/video-url-utils";
import { checkChoiceRawHtmlFootnotes } from "./choice-raw-html-footnote-advice";
import { checkContrastPairs } from "./contrast";
import { checkHighlightAccessibility } from "./highlight-advice";
import { checkRetrievalSheetAccessibility } from "./retrieval-sheet-advice";
import { checkSelfCheckAccessibility, type SelfCheckAuditSource } from "./self-check-advice";
import { checkWriteDistractorsAccessibility } from "./write-distractors-advice";

export type A11ySeverity = "critical" | "serious" | "moderate" | "minor";
export type A11yOutcome = "failed" | "cantTell";

export interface A11yIssue {
	severity: A11ySeverity;
	rule: string;
	outcome: A11yOutcome;
	message: string;
	messageValues?: Record<string, string | number>;
	/** Reuse the editor grammar catalogue for source diagnostics. */
	grammarDiagnostic?: string;
	blockId?: string;
	pageId?: string;
	sourceLocation: string;
	help?: string;
}

export interface A11yReport {
	issues: A11yIssue[];
	failed: number;
	cantTell: number;
	timestamp: string;
}

type A11yIssueInput = Omit<A11yIssue, "outcome" | "sourceLocation"> & {
	sourceLocation?: string;
};

function addIssue(
	issues: A11yIssue[],
	issue: A11yIssueInput,
	outcome: A11yOutcome = "failed",
): void {
	issues.push({
		...issue,
		outcome,
		sourceLocation: issue.sourceLocation ?? (issue.blockId ? "block" : "page"),
	});
}

/** Resolved theme colors for design system a11y checks. */
export interface DesignSystemColors {
	background: string;
	text: string;
	accent: string;
	buttonBackground: string;
	buttonText: string;
	success: string;
	error: string;
	warning: string;
}

/** Design system properties relevant to a11y checks. */
export interface DesignSystemConfig {
	typography?: unknown;
	borderRadius?: unknown;
	colors?: DesignSystemColors;
	lineHeight?: number;
	baseFontSize?: number; // in px
	contentMaxWidth?: number; // in px
}

export interface A11yMediaAnalysis {
	flashingGifSources?: ReadonlySet<string>;
}

// Generic link text patterns (case-insensitive)
const BAD_LINK_TEXT_RE =
	/^(click here|here|read more|learn more|more|link|this|go|see more|download|open)$/i;
// Bare URL used as link text
const URL_AS_LINK_TEXT_RE = /^https?:\/\//i;

// Alt text that's just a filename
const FILENAME_ALT_RE = /^[\w-]+\.(jpe?g|png|gif|svg|webp|avif|bmp|tiff?)$/i;

// Recommended maximum heading length for scannability
const MAX_HEADING_LENGTH = 120;

// Container types whose `items[].children` hold nested blocks
export const CONTAINER_TYPES = new Set(["tabs", "accordion", "columns", "sequence"]);

/**
 * Recursively collect all blocks from a page, including children nested
 * inside container blocks and assessment stem/feedback blocks.
 * Returns blocks in document order (depth-first).
 */
export function collectAllBlocksDeep(blocks: PraxityBlock[]): PraxityBlock[] {
	const result: PraxityBlock[] = [];

	for (const block of blocks) {
		result.push(block);
		const data = block.data as Record<string, unknown>;

		// Container blocks: tabs, accordion, columns, sequence
		if (CONTAINER_TYPES.has(block.type as string)) {
			const items = data.items as { children?: PraxityBlock[] }[] | undefined;
			if (items) {
				for (const item of items) {
					if (Array.isArray(item.children)) {
						result.push(...collectAllBlocksDeep(item.children));
					}
				}
			}
		}
		// Card container: items[].front/back contain nested blocks (not items[].children)
		if ((block.type as string) === "card") {
			const items = data.items as
				| {
						front?: PraxityBlock[];
						back?: PraxityBlock[];
				  }[]
				| undefined;
			if (items) {
				for (const item of items) {
					if (Array.isArray(item.front)) {
						result.push(...collectAllBlocksDeep(item.front));
					}
					if (Array.isArray(item.back)) {
						result.push(...collectAllBlocksDeep(item.back));
					}
				}
			}
		}

		// Assessment blocks: stem + feedback contain nested blocks
		const stem = data.stem as PraxityBlock[] | undefined;
		if (Array.isArray(stem)) {
			result.push(...collectAllBlocksDeep(stem));
		}
		const feedback = data.feedback as {
			correct?: PraxityBlock[];
			incorrect?: PraxityBlock[];
		} | null;
		if (feedback) {
			if (Array.isArray(feedback.correct)) {
				result.push(...collectAllBlocksDeep(feedback.correct));
			}
			if (Array.isArray(feedback.incorrect)) {
				result.push(...collectAllBlocksDeep(feedback.incorrect));
			}
		}
	}

	return result;
}

// ============================================================
// Structural checks (run on Praxity JSON, no rendering)
// ============================================================

export function checkLessonTitleAccessibility(
	frontmatter: Record<string, unknown>,
	file: string,
): A11yIssue[] {
	if (typeof frontmatter.title === "string" && frontmatter.title.trim()) return [];
	return [
		{
			severity: "minor",
			rule: "lesson-title",
			outcome: "failed",
			message: "Lesson has no title",
			pageId: file,
			sourceLocation: "frontmatter.title",
		},
	];
}

export function checkCourseAccessibility(
	pages: PraxityPage[],
	mediaAnalysis?: A11yMediaAnalysis,
	authorSources?: ReadonlyMap<string, SelfCheckAuditSource>,
): A11yReport {
	const issues: A11yIssue[] = [];

	for (const page of pages) {
		issues.push(...checkChoiceRawHtmlFootnotes(page.id, collectAllBlocksDeep(page.blocks)));
		const authorSource = authorSources?.get(page.id);
		if (authorSource)
			issues.push(...checkLessonTitleAccessibility(authorSource.read.frontmatter, page.id));
		if (authorSource)
			issues.push(
				...checkSelfCheckAccessibility(page.id, collectAllBlocksDeep(page.blocks), authorSource),
				...checkWriteDistractorsAccessibility(
					page.id,
					collectAllBlocksDeep(page.blocks),
					authorSource,
				),
				...checkHighlightAccessibility(page.id, collectAllBlocksDeep(page.blocks), authorSource),
				...checkRetrievalSheetAccessibility(
					page.id,
					collectAllBlocksDeep(page.blocks),
					authorSource,
				),
			);
		// Check page has a title
		if (!page.title || page.title.trim() === "") {
			addIssue(issues, {
				severity: "serious",
				rule: "page-title",
				message: "Page is missing a title. Every page needs a descriptive title for navigation.",
				pageId: page.id,
				sourceLocation: "page.title",
			});
		}

		for (const block of page.blocks) {
			checkBlockAccessibility(block, page.id, issues, mediaAnalysis);
			// Nested images and forward gates use the same rules as top-level blocks.
			for (const child of collectAllBlocksDeep([block]).slice(1)) {
				if (child.type === "image" || child.type === "logic") {
					checkBlockAccessibility(child, page.id, issues, mediaAnalysis);
				}
			}
		}

		// Page-level checks
		checkHeadingHierarchy(page, issues);
		checkHeadingLength(page, issues);
		checkDuplicateHeadings(page, issues);
		checkConsecutiveHeadings(page, issues);
		checkRepeatedAltText(page, issues);
		checkDuplicateLinks(page, issues);
		checkAbbreviations(page, issues);
		checkSensoryInstructions(page, issues);
		checkMediaFollowingHeading(page, issues);
		checkSentenceLength(page, issues);
		checkParagraphLength(page, issues);
		checkImageClusterWithoutContext(page, issues);
	}

	// Check there are no empty pages
	const emptyPages = pages.filter((p) => p.blocks.length === 0);
	for (const ep of emptyPages) {
		addIssue(issues, {
			severity: "moderate",
			rule: "empty-page",
			message: `Page "${ep.title}" has no content blocks.`,
			pageId: ep.id,
			sourceLocation: "page.blocks",
		});
	}

	// Course-wide checks
	checkDecorativeImageOveruse(pages, issues);
	checkGlossaryCompleteness(pages, issues);

	return {
		issues,
		failed: issues.filter((issue) => issue.outcome === "failed").length,
		cantTell: issues.filter((issue) => issue.outcome === "cantTell").length,
		timestamp: new Date().toISOString(),
	};
}

function containsFlashingGif(value: unknown, sources: ReadonlySet<string>): boolean {
	if (typeof value === "string") return sources.has(value);
	if (Array.isArray(value)) return value.some((item) => containsFlashingGif(item, sources));
	if (!value || typeof value !== "object") return false;
	return Object.entries(value).some(
		([key, item]) =>
			!isInlineProjectionMetadataKey(key, { keepDisplay: true }) &&
			containsFlashingGif(item, sources),
	);
}

function fillBlankHasKnownAnswer(data: Record<string, unknown>): boolean {
	const response =
		data.response && typeof data.response === "object"
			? (data.response as Record<string, unknown>)
			: undefined;
	const responseBlanks = response?.blanks;
	const blanks = Array.isArray(responseBlanks)
		? responseBlanks
		: Array.isArray(data.blanks)
			? data.blanks
			: [];
	if (blanks.length > 0) {
		return blanks.some((blank) => {
			if (!blank || typeof blank !== "object") return false;
			const record = blank as Record<string, unknown>;
			return (
				(typeof record.answer === "string" && record.answer.trim() !== "") ||
				(typeof record.correctAnswer === "string" && record.correctAnswer.trim() !== "") ||
				(Array.isArray(record.alternatives) &&
					record.alternatives.some(
						(alternative) => typeof alternative === "string" && alternative.trim() !== "",
					))
			);
		});
	}

	const content = [data.content, data.sentence, response?.template]
		.filter((value): value is string => typeof value === "string")
		.join("\n");
	return /\{[^{}]*\S[^{}]*\}/.test(content);
}

function checkScoredOpenFillBlank(
	data: Record<string, unknown>,
	blockId: string,
	pageId: string,
	issues: A11yIssue[],
	hasBlanks: boolean,
): void {
	const isScored =
		data.scored === true ||
		data.graded === true ||
		data.gradingMode === "exact" ||
		data.gradingMode === "partial";
	if (!isScored || !hasBlanks || fillBlankHasKnownAnswer(data)) return;
	addIssue(issues, {
		severity: "serious",
		rule: "fill-blank-open-scored",
		message:
			"Scored fill-in-the-blank has only open blanks. Add a configured answer or turn scoring off.",
		blockId,
		pageId,
	});
}

function checkBlockAccessibility(
	block: PraxityBlock,
	pageId: string,
	issues: A11yIssue[],
	mediaAnalysis?: A11yMediaAnalysis,
): void {
	const data = block.data as Record<string, unknown>;
	if (
		mediaAnalysis?.flashingGifSources &&
		containsFlashingGif(data, mediaAnalysis.flashingGifSources)
	) {
		addIssue(
			issues,
			{
				severity: "serious",
				rule: "gif-flash-threshold",
				message:
					"Animated GIF may flash more than three times per second. Replace it or reduce the flashing rate before publishing.",
				blockId: block.id,
				pageId,
				sourceLocation: "data.media",
				help: "https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html",
			},
			"cantTell",
		);
	}

	// Check for link text quality in any block with TipTap HTML content
	checkLinkTextInHtml(data.content, block.id, pageId, "data.content", issues);

	// Also check stem content in assessment blocks
	const stem = data.stem as PraxityBlock[] | undefined;
	if (stem) {
		for (const [index, stemBlock] of stem.entries()) {
			const stemData = stemBlock.data as Record<string, unknown>;
			checkLinkTextInHtml(
				stemData.content as string | undefined,
				block.id,
				pageId,
				`data.stem[${index}].content`,
				issues,
			);
		}
	}

	// Cast to string — legacy block types (mcq, narrative, etc.) may still
	// exist in persisted course data even though they're removed from BlockType.
	switch (block.type as string) {
		case "logic": {
			const actions = Array.isArray(data.actions) ? data.actions : [];
			for (const [index, action] of actions.entries()) {
				if (!action || typeof action !== "object" || action.type !== "disableCompletion") continue;
				if (typeof action.reason === "string" && action.reason.trim()) continue;
				addIssue(issues, {
					severity: "moderate",
					rule: "completion-gate-reason",
					message:
						"Learners cannot tell what to do before continuing. Add a reason to this forward-progress gate.",
					blockId: block.id,
					pageId,
					sourceLocation: `data.actions[${index}].reason`,
				});
			}
			break;
		}
		case "image": {
			const decorative = isDecorativeImage(data, block.a11y);
			const altText = readAltText(data);
			const src = data.src as string;

			if (src && !decorative && (!altText || altText.trim() === "")) {
				addIssue(issues, {
					severity: "critical",
					rule: "image-alt",
					message: "Image is missing alt text. Provide descriptive alt text or mark as decorative.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/tutorials/images/decision-tree/",
				});
			}

			// Check alt text quality
			if (altText && /^(image|photo|picture|img|graphic|icon)$/i.test(altText.trim())) {
				addIssue(issues, {
					severity: "moderate",
					rule: "image-alt-quality",
					message: `Alt text "${altText}" is not descriptive. Describe what the image conveys.`,
					blockId: block.id,
					pageId,
				});
			}

			// Check alt text is a filename
			if (altText && FILENAME_ALT_RE.test(altText.trim())) {
				addIssue(issues, {
					severity: "moderate",
					rule: "image-alt-quality",
					message: `Alt text "${altText}" looks like a filename. Describe what the image conveys.`,
					blockId: block.id,
					pageId,
				});
			}

			// Check alt text length
			if (altText && altText.trim().length > 125) {
				addIssue(issues, {
					severity: "minor",
					rule: "image-alt-length",
					message: `Alt text is ${altText.trim().length} characters (recommended max: 125). Consider using a caption or long description instead.`,
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/tutorials/images/complex/",
				});
			}

			// images-of-text: very long alt text on non-decorative image suggests image of text
			if (altText && !decorative && altText.trim().length > 200) {
				addIssue(
					issues,
					{
						severity: "moderate",
						rule: "images-of-text",
						message: `Image has very long alt text (${altText.trim().length} characters), which may indicate an image of text. Consider using a text block instead — real text is resizable, searchable, and translatable.`,
						blockId: block.id,
						pageId,
						sourceLocation: "data.altText",
						help: "https://www.w3.org/WAI/WCAG22/Understanding/images-of-text.html",
					},
					"cantTell",
				);
			}
			break;
		}

		case "imageComparison": {
			const beforeImage = data.beforeImage as Record<string, unknown> | undefined;
			const afterImage = data.afterImage as Record<string, unknown> | undefined;
			if (beforeImage?.src && !isDecorativeImage(beforeImage) && !readAltText(beforeImage).trim()) {
				addIssue(issues, {
					severity: "critical",
					rule: "image-alt",
					message: "Before image in comparison block is missing alt text",
					blockId: block.id,
					pageId,
					sourceLocation: "data.beforeImage.altText",
				});
			}
			if (afterImage?.src && !isDecorativeImage(afterImage) && !readAltText(afterImage).trim()) {
				addIssue(issues, {
					severity: "critical",
					rule: "image-alt",
					message: "After image in comparison block is missing alt text",
					blockId: block.id,
					pageId,
					sourceLocation: "data.afterImage.altText",
				});
			}
			break;
		}

		// Grammar `comparison` — opaque JSON; port imageComparison alt checks
		case "comparison": {
			const beforeImage = data.beforeImage as Record<string, unknown> | undefined;
			const afterImage = data.afterImage as Record<string, unknown> | undefined;
			if (beforeImage?.src && !isDecorativeImage(beforeImage) && !readAltText(beforeImage).trim()) {
				addIssue(issues, {
					severity: "critical",
					rule: "image-alt",
					message: "Before image in comparison block is missing alt text.",
					blockId: block.id,
					pageId,
					sourceLocation: "data.beforeImage.altText",
				});
			}
			if (afterImage?.src && !isDecorativeImage(afterImage) && !readAltText(afterImage).trim()) {
				addIssue(issues, {
					severity: "critical",
					rule: "image-alt",
					message: "After image in comparison block is missing alt text.",
					blockId: block.id,
					pageId,
					sourceLocation: "data.afterImage.altText",
				});
			}
			// Also check generic images array (some comparison styles use it)
			const compImages = data.images as Record<string, unknown>[] | undefined;
			if (compImages) {
				for (const [index, img] of compImages.entries()) {
					if (img.src && !isDecorativeImage(img) && !readAltText(img).trim()) {
						addIssue(issues, {
							severity: "critical",
							rule: "image-alt",
							message: "Image in comparison block is missing alt text.",
							blockId: block.id,
							pageId,
							sourceLocation: `data.images[${index}].altText`,
						});
					}
				}
			}
			break;
		}

		case "hotgraphic": {
			const imageAlt = readAltText({ alt: data.imageAlt });
			if (!isDecorativeImage(data, block.a11y) && !imageAlt.trim()) {
				addIssue(issues, {
					severity: "critical",
					rule: "hotgraphic-alt",
					message: "Hotgraphic background image is missing alt text.",
					blockId: block.id,
					pageId,
				});
			}
			break;
		}

		// Grammar `hotspot` — opaque JSON; port hotgraphic/labeledGraphic alt checks
		case "hotspot": {
			const hsImageAlt = readAltText({ alt: data.imageAlt ?? data.backgroundImageAlt });
			const hsImageSrc = (data.image ?? data.backgroundImage ?? data.src) as string | undefined;
			if (hsImageSrc && !isDecorativeImage(data, block.a11y) && !hsImageAlt.trim()) {
				addIssue(issues, {
					severity: "critical",
					rule: "hotspot-image-alt",
					message:
						"Hotspot background image is missing alt text. Learners using screen readers cannot interact with this element.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/tutorials/images/decision-tree/",
				});
			}
			// Check region/pin labels
			const hsRegions = (data.regions ?? data.items ?? data.pins) as
				| { label?: string; title?: string }[]
				| undefined;
			if (hsRegions) {
				const unlabeled = hsRegions.filter((r) => !r.label?.trim() && !r.title?.trim());
				if (unlabeled.length > 0) {
					addIssue(issues, {
						severity: "serious",
						rule: "hotspot-region-labels",
						message: `${unlabeled.length} hotspot region${unlabeled.length > 1 ? "s have" : " has"} no label. Every region needs a label for keyboard and screen reader users.`,
						blockId: block.id,
						pageId,
					});
				}
				// Phase 2: too many hotspot regions
				if (hsRegions.length > 12) {
					addIssue(issues, {
						severity: "moderate",
						rule: "hotspot-item-count",
						message: `Hotspot has ${hsRegions.length} regions. More than 12 regions is overwhelming and hard to navigate by keyboard.`,
						blockId: block.id,
						pageId,
					});
				}
			}
			break;
		}

		case "video":
		case "audio": {
			const transcript = data.transcript as string;

			if (!transcript || transcript.trim() === "") {
				addIssue(issues, {
					severity: "serious",
					rule: "media-transcript",
					message: `${block.type === "video" ? "Video" : "Audio"} is missing a transcript. Provide a text transcript for accessibility.`,
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/media/av/transcripts/",
				});
			}

			// Advisory: audio description tracks for prerecorded video (WCAG 1.2.5)
			if (block.type === "video") {
				const captionTracks = Array.isArray(data.captionTracks) ? data.captionTracks : [];
				const hasAudioDescription = captionTracks.some(
					(t) =>
						t && typeof t === "object" && t.kind === "descriptions" && isSafeCaptionTrackUrl(t.src),
				);
				if (!hasAudioDescription) {
					addIssue(
						issues,
						{
							severity: "minor",
							rule: "media-audio-description",
							message:
								"Video has no audio description track. For prerecorded video with important visual content, provide an audio description track (WCAG 1.2.5).",
							blockId: block.id,
							pageId,
							sourceLocation: "data.captionTracks",
							help: "https://www.w3.org/WAI/WCAG22/Understanding/audio-description-prerecorded.html",
						},
						"cantTell",
					);
				}

				// video-captions: video missing synchronized captions (distinct from transcript)
				const hasTimedCaptions =
					captionTracks.some(
						(t) =>
							t &&
							typeof t === "object" &&
							(t.kind === "captions" || t.kind === "subtitles") &&
							isSafeCaptionTrackUrl(t.src),
					) ||
					isSafeCaptionTrackUrl(data.captions) ||
					isSafeCaptionTrackUrl(data.captionsSrc);
				const source =
					data.source && typeof data.source === "object" && !Array.isArray(data.source)
						? (data.source as Record<string, unknown>)
						: null;
				const videoSrc =
					typeof data.src === "string"
						? data.src
						: source && source.type === "url" && typeof source.src === "string"
							? source.src
							: "";
				if (videoSrc && !(isDirectVideoUrl(videoSrc) && hasTimedCaptions)) {
					addIssue(issues, {
						severity: "serious",
						rule: "video-captions",
						message:
							"Video is missing captions. Provide synchronized captions for deaf and hard-of-hearing users (distinct from transcript).",
						blockId: block.id,
						pageId,
						help: "https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded.html",
					});
				}
			}

			// audio-transcript-quality: transcript exists but is likely placeholder
			if (block.type === "audio" && transcript && stripHtmlTags(transcript).trim().length < 50) {
				addIssue(issues, {
					severity: "moderate",
					rule: "audio-transcript-quality",
					message:
						"Audio transcript appears to be a placeholder (under 50 characters). Provide a complete text equivalent of the audio content.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/WCAG22/Understanding/audio-only-and-video-only-prerecorded.html",
				});
			}

			// video-audio-autoplay: autoplay disrupts screen reader users
			if (data.autoplay === true) {
				addIssue(issues, {
					severity: "serious",
					rule: "video-audio-autoplay",
					message:
						"Media is set to autoplay. Automatically playing audio disrupts screen reader users. Require user action to start playback.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html",
				});
			}
			break;
		}

		case "mcq": {
			const question = data.question as string;
			const options = data.options as { text: string; isCorrect: boolean }[];

			if (!question || question.trim() === "") {
				addIssue(issues, {
					severity: "serious",
					rule: "mcq-question",
					message: "Quiz question text is empty.",
					blockId: block.id,
					pageId,
				});
			}

			if (options && !options.some((o) => o.isCorrect)) {
				addIssue(issues, {
					severity: "serious",
					rule: "mcq-correct-answer",
					message: "Quiz has no correct answer marked.",
					blockId: block.id,
					pageId,
				});
			}
			break;
		}

		case "narrative": {
			const items = data.items as { imageAlt?: string; imageSrc?: string }[];
			if (items) {
				for (const [index, item] of items.entries()) {
					if (item.imageSrc && (!item.imageAlt || item.imageAlt.trim() === "")) {
						addIssue(issues, {
							severity: "critical",
							rule: "narrative-image-alt",
							message: "Narrative slide image is missing alt text.",
							blockId: block.id,
							pageId,
							sourceLocation: `data.items[${index}].imageAlt`,
						});
					}
				}
			}
			break;
		}

		case "gmcq": {
			const question = data.question as string;
			const options = data.options as {
				text: string;
				isCorrect: boolean;
				imageSrc?: string;
				imageAlt?: string;
			}[];

			if (!question || question.trim() === "") {
				addIssue(issues, {
					severity: "serious",
					rule: "gmcq-question",
					message: "Graphical quiz question text is empty.",
					blockId: block.id,
					pageId,
				});
			}

			if (options && !options.some((o) => o.isCorrect)) {
				addIssue(issues, {
					severity: "serious",
					rule: "gmcq-correct-answer",
					message: "Graphical quiz has no correct answer marked.",
					blockId: block.id,
					pageId,
				});
			}

			if (options) {
				for (const [index, option] of options.entries()) {
					if (option.imageSrc && (!option.imageAlt || option.imageAlt.trim() === "")) {
						addIssue(issues, {
							severity: "critical",
							rule: "gmcq-image-alt",
							message: "Graphical quiz option image is missing alt text.",
							blockId: block.id,
							pageId,
							sourceLocation: `data.options[${index}].imageAlt`,
							help: "https://www.w3.org/WAI/tutorials/images/decision-tree/",
						});
					}
				}
			}
			break;
		}

		case "slider": {
			const question = data.question as string;
			if (!question || question.trim() === "") {
				addIssue(issues, {
					severity: "serious",
					rule: "slider-question",
					message: "Slider question text is empty.",
					blockId: block.id,
					pageId,
				});
			}
			break;
		}

		// Grammar `rate` — opaque JSON; port slider-question check
		case "rate": {
			const rateQuestion = (data.question ?? data.prompt ?? data.label) as string | undefined;
			if (!rateQuestion || rateQuestion.trim() === "") {
				addIssue(issues, {
					severity: "serious",
					rule: "rate-question",
					message:
						"Rating block has no question or prompt text. Learners need to know what they are rating.",
					blockId: block.id,
					pageId,
				});
			}
			// Phase 2: missing endpoint labels
			const rateLowLabel = (data.lowLabel ?? data.minLabel) as string | undefined;
			const rateHighLabel = (data.highLabel ?? data.maxLabel) as string | undefined;
			if (!rateLowLabel?.trim() || !rateHighLabel?.trim()) {
				addIssue(issues, {
					severity: "moderate",
					rule: "rating-scale-endpoints",
					message:
						"Rating scale is missing endpoint labels. Label the low and high ends so learners understand the scale meaning.",
					blockId: block.id,
					pageId,
				});
			}
			break;
		}

		case "textInput": {
			const question = data.question as string;
			const correctAnswers = data.correctAnswers as string[] | { value: string }[];

			if (!question || question.trim() === "") {
				addIssue(issues, {
					severity: "serious",
					rule: "textInput-question",
					message: "Text input question text is empty.",
					blockId: block.id,
					pageId,
				});
			}

			if (!correctAnswers || correctAnswers.length === 0) {
				addIssue(issues, {
					severity: "serious",
					rule: "textInput-correct-answer",
					message: "Text input question has no correct answers defined.",
					blockId: block.id,
					pageId,
				});
			}

			// assessment-format-hint: no placeholder or hint for expected answer format
			const placeholder = data.placeholder as string | undefined;
			const hint = data.hint as string | undefined;
			if ((!placeholder || placeholder.trim() === "") && (!hint || hint.trim() === "")) {
				addIssue(issues, {
					severity: "moderate",
					rule: "assessment-format-hint",
					message:
						"Text input question has no format hint or placeholder. Provide an example of the expected answer format.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html",
				});
			}
			break;
		}

		case "sorting": {
			const categories = data.categories as { id: string; label: string }[];
			if (!categories || categories.length < 2) {
				addIssue(issues, {
					severity: "serious",
					rule: "sorting-categories",
					message: "Sorting activity needs at least 2 categories.",
					blockId: block.id,
					pageId,
				});
			}
			break;
		}

		case "embed": {
			const title = data.title as string;
			if (!title || title.trim() === "") {
				addIssue(issues, {
					severity: "moderate",
					rule: "embed-title",
					message:
						"Embedded content is missing a title. Provide a descriptive title for the iframe.",
					blockId: block.id,
					pageId,
				});
			}
			break;
		}

		case "labeledGraphic": {
			const imageAlt = readAltText({ alt: data.imageAlt });
			if (!isDecorativeImage(data, block.a11y) && !imageAlt.trim()) {
				addIssue(issues, {
					severity: "critical",
					rule: "labeled-graphic-alt",
					message: "Labeled graphic background image is missing alt text.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/tutorials/images/decision-tree/",
				});
			}
			break;
		}

		case "assessment": {
			// Legacy editor assessment: hotspot image alt
			const response = data.response as
				| { type?: string; image?: string; imageAlt?: string }
				| undefined;
			if (response?.type === "hotspot" && response.image) {
				if (
					!isDecorativeImage(data, block.a11y) &&
					!readAltText({ alt: response.imageAlt }).trim()
				) {
					addIssue(issues, {
						severity: "critical",
						rule: "hotspot-image-alt",
						message:
							"Hotspot assessment image is missing alt text. Learners using screen readers cannot interact with this question.",
						blockId: block.id,
						pageId,
						help: "https://www.w3.org/WAI/tutorials/images/decision-tree/",
					});
				}
			}

			// Grammar assessment types: single, multi, matching, sequence, freeText
			const assessmentType = data.assessmentType as string | undefined;
			const asmtQuestion = data.question as string | undefined;

			if (assessmentType) {
				// Empty question stem
				if (!asmtQuestion || asmtQuestion.trim() === "") {
					addIssue(issues, {
						severity: "serious",
						rule: "assessment-empty-stem",
						message: "Assessment has no question text. Learners need a clear prompt.",
						blockId: block.id,
						pageId,
					});
				}

				if (assessmentType === "single" || assessmentType === "multi") {
					const options = data.options as
						| { text?: string; correct?: boolean; imageSrc?: string; imageAlt?: string }[]
						| undefined;
					if (options && !options.some((o) => o.correct)) {
						addIssue(issues, {
							severity: "serious",
							rule: "assessment-no-correct",
							message: `${assessmentType === "single" ? "Single-choice" : "Multi-choice"} assessment has no correct answer marked.`,
							blockId: block.id,
							pageId,
						});
					}
					// Phase 2: too many options
					if (options && options.length > 10) {
						addIssue(issues, {
							severity: "moderate",
							rule: "choice-option-count",
							message: `Assessment has ${options.length} options. More than 10 options creates cognitive overload and is hard to navigate by keyboard.`,
							blockId: block.id,
							pageId,
						});
					}
					// Phase 2: image-only options without text labels
					if (options?.some((o) => o.imageSrc)) {
						const imageOnlyOptions = options.filter(
							(o) => o.imageSrc && (!o.text || o.text.trim() === ""),
						);
						if (imageOnlyOptions.length > 0) {
							addIssue(issues, {
								severity: "serious",
								rule: "image-only-options",
								message: `${imageOnlyOptions.length} option${imageOnlyOptions.length > 1 ? "s use" : " uses"} an image with no text label. Screen reader users cannot distinguish options without text.`,
								blockId: block.id,
								pageId,
							});
						}
					}
				}

				if (assessmentType === "matching") {
					const pairs = data.pairs as { left?: string; right?: string }[] | undefined;
					if (!pairs || pairs.length < 2) {
						addIssue(issues, {
							severity: "serious",
							rule: "assessment-too-few-pairs",
							message: `Matching assessment has ${pairs?.length ?? 0} pair${pairs?.length === 1 ? "" : "s"}. At least 2 pairs are needed for a meaningful activity.`,
							blockId: block.id,
							pageId,
						});
					}
					// Phase 2: too many pairs
					if (pairs && pairs.length > 8) {
						addIssue(issues, {
							severity: "moderate",
							rule: "match-pair-count",
							message: `Matching assessment has ${pairs.length} pairs. More than 8 pairs is hard to manage, especially with drag-and-drop.`,
							blockId: block.id,
							pageId,
						});
					}
				}

				if (assessmentType === "sequence") {
					const seqItems = data.items as { text?: string }[] | undefined;
					if (!seqItems || seqItems.length < 2) {
						addIssue(issues, {
							severity: "serious",
							rule: "assessment-too-few-items",
							message: `Ordering assessment has ${seqItems?.length ?? 0} item${seqItems?.length === 1 ? "" : "s"}. At least 2 items are needed for a meaningful ordering activity.`,
							blockId: block.id,
							pageId,
						});
					}
				}

				if (assessmentType === "fillBlank") {
					const content = typeof data.content === "string" ? data.content : "";
					const responseBlanks = (response as { blanks?: unknown[] } | undefined)?.blanks;
					const blanks = Array.isArray(data.blanks)
						? data.blanks
						: Array.isArray(responseBlanks)
							? responseBlanks
							: [];
					const hasBlanks = blanks.length > 0 || /_{4,}|\{[^{}]+\}/.test(content);
					if (!hasBlanks) {
						addIssue(issues, {
							severity: "serious",
							rule: "fill-blank-missing-blanks",
							message:
								"Fill-in-the-blank block has no blanks defined. Add at least one blank for learners to complete.",
							blockId: block.id,
							pageId,
						});
					}
					checkScoredOpenFillBlank(data, block.id, pageId, issues, hasBlanks);
				}

				// Phase 2: drag variant keyboard alt — matching/sequence/fill-blank using drag
				if (
					(assessmentType === "matching" || assessmentType === "sequence") &&
					data.variant === "drag"
				) {
					addIssue(
						issues,
						{
							severity: "serious",
							rule: "drag-variant-keyboard-alt",
							message:
								"Assessment uses drag-and-drop interaction. Ensure a keyboard-accessible alternative (e.g. dropdown or button-based reorder) is available.",
							blockId: block.id,
							pageId,
							sourceLocation: "data.variant",
							help: "https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html",
						},
						"cantTell",
					);
				}
			}
			break;
		}

		case "assessmentResults": {
			const passMark = data.passMark as number;
			if (passMark === 0) {
				addIssue(issues, {
					severity: "moderate",
					rule: "assessment-pass-mark",
					message: "Assessment pass mark is set to 0%. Is this intentional?",
					blockId: block.id,
					pageId,
				});
			}
			break;
		}

		case "button": {
			const text = data.text as string;
			if (!text || text.trim() === "") {
				addIssue(issues, {
					severity: "critical",
					rule: "empty-link",
					message: "Button has no text. Screen readers cannot describe what this button does.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html",
				});
			} else if (BAD_LINK_TEXT_RE.test(text.trim())) {
				addIssue(issues, {
					severity: "serious",
					rule: "link-text-quality",
					message: `Button text "${text}" is not descriptive. Use text that describes the destination or action.`,
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html",
				});
			} else if (URL_AS_LINK_TEXT_RE.test(text.trim())) {
				addIssue(issues, {
					severity: "serious",
					rule: "link-text-quality",
					message: "Button text is a raw URL. Use descriptive text that explains the destination.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html",
				});
			}

			break;
		}

		case "document": {
			const docUrl = data.url as string;
			if (!docUrl) break; // unconfigured block — no link rendered
			const title = data.title as string;
			if (!title || title.trim() === "") {
				addIssue(issues, {
					severity: "moderate",
					rule: "link-text-quality",
					message:
						"Document has no title. Add a descriptive title so users know what file they are downloading.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html",
				});
			} else if (BAD_LINK_TEXT_RE.test(title.trim())) {
				addIssue(issues, {
					severity: "serious",
					rule: "link-text-quality",
					message: `Document link text "${title}" is not descriptive. Use text that describes the file.`,
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html",
				});
			}
			break;
		}

		case "table": {
			const highlightHeaderRow = data.highlightHeaderRow as boolean | undefined;
			const highlightHeaderCol = data.highlightHeaderCol as boolean | undefined;
			const caption = data.caption as string | undefined;

			if (!highlightHeaderRow && !highlightHeaderCol) {
				addIssue(issues, {
					severity: "serious",
					rule: "table-headers",
					message:
						"Table has no header row or column enabled. Enable a header row so screen readers can associate data cells with their headings.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/tutorials/tables/",
				});
			}

			// Either one names the table — the renderer points `aria-labelledby` at
			// whichever exists. Firing on a missing caption when the author wrote a
			// title nagged them for work already done.
			const title = data.title as string | undefined;
			const hasName = Boolean(title?.trim()) || Boolean(caption?.trim());

			if (!hasName) {
				addIssue(issues, {
					severity: "moderate",
					rule: "table-caption",
					message:
						'This table has no title or caption, so a screen reader announces it only as "Data table". On a page with several tables, none of them can be told apart. Add a title or caption naming what this one holds.',
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/tutorials/tables/caption-summary/",
				});
			}

			// empty-table-cells: check header row for empty cells
			const headers = data.headers as string[] | undefined;
			if (headers) {
				const emptyHeaders = headers.filter((h) => !h || h.trim() === "");
				if (emptyHeaders.length > 0) {
					addIssue(issues, {
						severity: "moderate",
						rule: "empty-table-cells",
						message: "Table has empty header cells. Every column header should describe its data.",
						blockId: block.id,
						pageId,
						sourceLocation: "data.headers",
						help: "https://www.w3.org/WAI/tutorials/tables/",
					});
				}
			}

			// empty-table-cells: check if >50% of all cells are empty (layout table abuse)
			const tableRows = data.rows as string[][] | undefined;
			if (tableRows && tableRows.length > 0) {
				let totalCells = 0;
				let emptyCells = 0;
				for (const row of tableRows) {
					for (const cell of row) {
						totalCells++;
						if (!cell || cell.trim() === "") emptyCells++;
					}
				}
				if (totalCells > 0 && emptyCells / totalCells > 0.5) {
					addIssue(issues, {
						severity: "moderate",
						rule: "empty-table-cells",
						message:
							"Over 50% of table cells are empty. This may indicate the table is being used for layout rather than data.",
						blockId: block.id,
						pageId,
						sourceLocation: "data.rows",
					});
				}
			}
			break;
		}

		// Grammar `data-table` — opaque JSON; same a11y rules as legacy `table`
		case "data-table": {
			const highlightHeaderRow = data.highlightHeaderRow as boolean | undefined;
			const highlightHeaderCol = data.highlightHeaderCol as boolean | undefined;
			const caption = data.caption as string | undefined;

			if (!highlightHeaderRow && !highlightHeaderCol) {
				addIssue(issues, {
					severity: "serious",
					rule: "table-headers",
					message:
						"Data table has no header row or column enabled. Enable a header row so screen readers can associate data cells with their headings.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/tutorials/tables/",
				});
			}

			if (!caption || caption.trim() === "") {
				addIssue(issues, {
					severity: "moderate",
					rule: "table-caption",
					message:
						"Data table is missing a caption. A caption helps users understand what data the table contains.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/tutorials/tables/caption-summary/",
				});
			}

			// empty-table-cells: check header row for empty cells
			const dtHeaders = data.headers as string[] | undefined;
			if (dtHeaders) {
				const emptyHeaders = dtHeaders.filter((h) => !h || h.trim() === "");
				if (emptyHeaders.length > 0) {
					addIssue(issues, {
						severity: "moderate",
						rule: "empty-table-cells",
						message:
							"Data table has empty header cells. Every column header should describe its data.",
						blockId: block.id,
						pageId,
						sourceLocation: "data.headers",
						help: "https://www.w3.org/WAI/tutorials/tables/",
					});
				}
			}

			// empty-table-cells: check if >50% of all cells are empty (layout table abuse)
			const dtRows = data.rows as string[][] | undefined;
			if (dtRows && dtRows.length > 0) {
				let totalCells = 0;
				let emptyCells = 0;
				for (const row of dtRows) {
					for (const cell of row) {
						totalCells++;
						if (!cell || cell.trim() === "") emptyCells++;
					}
				}
				if (totalCells > 0 && emptyCells / totalCells > 0.5) {
					addIssue(issues, {
						severity: "moderate",
						rule: "empty-table-cells",
						message:
							"Over 50% of data table cells are empty. This may indicate the table is being used for layout rather than data.",
						blockId: block.id,
						pageId,
						sourceLocation: "data.rows",
					});
				}
			}
			break;
		}

		case "tabs": {
			const items = data.items as { id: string; label: string }[] | undefined;
			if (items && items.length === 1) {
				addIssue(issues, {
					severity: "moderate",
					rule: "container-single-item",
					message:
						"Tabs block has only 1 tab. A single tab creates unnecessary interaction for content that could be shown directly.",
					blockId: block.id,
					pageId,
				});
			}
			if (items && items.length > 6) {
				addIssue(issues, {
					severity: "moderate",
					rule: "container-too-many-items",
					message: `Tabs block has ${items.length} tabs. More than 6 tabs is hard to navigate by keyboard and may overflow on mobile.`,
					blockId: block.id,
					pageId,
				});
			}
			break;
		}

		case "accordion": {
			const items = data.items as { id: string; label: string }[] | undefined;
			if (items && items.length === 1) {
				addIssue(issues, {
					severity: "moderate",
					rule: "container-single-item",
					message:
						"Accordion has only 1 section. A single accordion panel hides content behind an unnecessary click — show it directly or use a heading instead.",
					blockId: block.id,
					pageId,
				});
			}
			break;
		}

		case "columns": {
			const items = data.items as { id: string; children?: unknown[] }[] | undefined;
			if (items) {
				const colCount = items.length;
				const totalChildren = items.reduce(
					(sum, col) => sum + (Array.isArray(col.children) ? col.children.length : 0),
					0,
				);

				if (colCount >= 4) {
					addIssue(issues, {
						severity: "moderate",
						rule: "columns-too-many",
						message: `${colCount}-column layout will be very narrow on small screens. Consider using 2–3 columns or a different layout.`,
						blockId: block.id,
						pageId,
					});
				} else if (colCount === 3 && totalChildren > 9) {
					addIssue(issues, {
						severity: "minor",
						rule: "columns-too-many",
						message:
							"3-column layout with substantial content in each column may be hard to read on smaller screens.",
						blockId: block.id,
						pageId,
					});
				}
			}
			break;
		}

		case "code": {
			const code = data.code as string;
			if (!code || code.trim() === "") {
				addIssue(issues, {
					severity: "moderate",
					rule: "code-block-empty",
					message: "Code block has no content. Add code or remove the empty block.",
					blockId: block.id,
					pageId,
				});
			}
			break;
		}

		case "card": {
			const cardLayout = data.layout as "single" | "grid" | "masonry" | "rows" | undefined;
			const requiresBackContent = cardLayout === "single";
			const items = data.items as
				| {
						front?: PraxityBlock[];
						back?: PraxityBlock[];
				  }[]
				| undefined;
			if (items) {
				const hasBackContent = (back: PraxityBlock[] | undefined): boolean =>
					Array.isArray(back) && back.length > 0;
				for (const [itemIndex, item] of items.entries()) {
					if (requiresBackContent && !hasBackContent(item.back)) {
						addIssue(issues, {
							severity: "serious",
							rule: "card-both-sides",
							message:
								"Card has no back-side content. Both sides must have content for the card to be meaningful.",
							blockId: block.id,
							pageId,
							sourceLocation: `data.items[${itemIndex}].back`,
						});
					}
				}
			}
			break;
		}

		case "note": {
			const variant = data.variant as string | undefined;
			const showIcon = data.showIcon as boolean | undefined;
			const colorVariants = new Set(["warning", "error", "info", "success"]);
			if (variant && colorVariants.has(variant) && showIcon === false) {
				addIssue(issues, {
					severity: "moderate",
					rule: "color-only-information",
					message:
						"Note block uses color to convey its type (warning/info/error) without an icon. Enable the icon so the note type is identifiable without color.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html",
				});
			}
			break;
		}

		// Grammar `sequence` — custom-parsed; single-item and too-many checks
		case "sequence": {
			const seqItems = data.items as { label?: string; children?: PraxityBlock[] }[] | undefined;
			if (seqItems && seqItems.length === 1) {
				addIssue(issues, {
					severity: "moderate",
					rule: "sequence-single-item",
					message:
						"Sequence block has only 1 step. A single step adds interaction overhead with no benefit — show the content directly.",
					blockId: block.id,
					pageId,
				});
			}
			if (seqItems && seqItems.length > 8) {
				addIssue(issues, {
					severity: "moderate",
					rule: "sequence-too-many-items",
					message: `Sequence block has ${seqItems.length} steps. More than 8 steps is hard to track and navigate. Consider breaking into multiple sequences or pages.`,
					blockId: block.id,
					pageId,
				});
			}
			// Phase 2: auto-advance without pause control
			const autoAdvance = data.autoAdvance as boolean | undefined;
			const pauseControl = data.pauseControl as boolean | undefined;
			if (autoAdvance === true && pauseControl !== true) {
				addIssue(issues, {
					severity: "serious",
					rule: "auto-advance-pause-control",
					message:
						"Sequence auto-advances without a pause control. Users with motor or cognitive disabilities need the ability to pause auto-advancing content.",
					blockId: block.id,
					pageId,
					help: "https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html",
				});
			}
			break;
		}

		// Grammar `fill-blank` — opaque JSON; check for blanks and instructions
		case "fill-blank": {
			const fbContent = data.content as string | undefined;
			const fbBlanks = data.blanks as unknown[] | undefined;
			const fbSentence = data.sentence as string | undefined;

			// Check for blanks — either a blanks array or blank markers in content
			const hasBlanks =
				(fbBlanks && fbBlanks.length > 0) ||
				(fbContent && /_{4,}|\{[^{}]+\}|\[blank\]/i.test(fbContent)) ||
				(fbSentence && /_{4,}|\{[^{}]+\}|\[blank\]/i.test(fbSentence));
			if (!hasBlanks) {
				addIssue(issues, {
					severity: "serious",
					rule: "fill-blank-missing-blanks",
					message:
						"Fill-in-the-blank block has no blanks defined. Add at least one blank for learners to complete.",
					blockId: block.id,
					pageId,
				});
			}
			checkScoredOpenFillBlank(data, block.id, pageId, issues, Boolean(hasBlanks));

			// Check for instructions/context
			const fbInstructions = (data.instructions ?? data.prompt ?? data.question) as
				| string
				| undefined;
			if (!fbInstructions || fbInstructions.trim() === "") {
				addIssue(issues, {
					severity: "moderate",
					rule: "fill-blank-missing-instructions",
					message:
						"Fill-in-the-blank block has no instructions. Provide context so learners understand what to fill in.",
					blockId: block.id,
					pageId,
				});
			}
			// Phase 2: drag variant keyboard alt
			const fbStyle = data.style as string | undefined;
			if (fbStyle === "word-bank-drag") {
				addIssue(
					issues,
					{
						severity: "serious",
						rule: "drag-variant-keyboard-alt",
						message:
							"Fill-in-the-blank uses drag-and-drop (word bank). Ensure a keyboard-accessible alternative is available.",
						blockId: block.id,
						pageId,
						sourceLocation: "data.style",
						help: "https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html",
					},
					"cantTell",
				);
			}
			break;
		}

		// Grammar `branch` — opaque JSON; check option labels and dead ends
		case "branch": {
			const brOptions = (data.options ?? data.choices ?? data.paths) as
				| { label?: string; text?: string; target?: string; next?: string }[]
				| undefined;
			if (brOptions) {
				// Check for generic option labels
				const genericLabelRe = /^(option|choice)\s*[a-z0-9]*$/i;
				const genericOptions = brOptions.filter(
					(o) =>
						(o.label && genericLabelRe.test(o.label.trim())) ||
						(o.text && genericLabelRe.test(o.text.trim())),
				);
				if (genericOptions.length > 0) {
					addIssue(issues, {
						severity: "serious",
						rule: "branch-generic-labels",
						message: `${genericOptions.length} branching option${genericOptions.length > 1 ? "s have" : " has"} generic label${genericOptions.length > 1 ? "s" : ""} (e.g. "Option A"). Use descriptive labels so learners understand each choice.`,
						blockId: block.id,
						pageId,
					});
				}

				// Check for dead ends (options with no target/next)
				const deadEnds = brOptions.filter((o) => !o.target?.trim() && !o.next?.trim());
				if (deadEnds.length > 0 && deadEnds.length < brOptions.length) {
					addIssue(issues, {
						severity: "moderate",
						rule: "branch-dead-end",
						message: `${deadEnds.length} branching option${deadEnds.length > 1 ? "s lead" : " leads"} nowhere. Every option should connect to a destination so learners don't get stuck.`,
						blockId: block.id,
						pageId,
					});
				}
			}
			break;
		}

		// Grammar `quote` — custom-parsed; minimal checks
		case "quote": {
			// quote blocks are passive content, no special a11y rules needed beyond
			// link-text checks already handled above
			break;
		}
	}
}

// ============================================================
// Link text quality in TipTap HTML
// ============================================================

function checkLinkTextInHtml(
	html: unknown,
	blockId: string,
	pageId: string,
	field: string,
	issues: A11yIssue[],
): void {
	// Not every block's content is HTML: a self-check's is its structured prompt.
	if (typeof html !== "string" || !html) return;

	// Match <a ...>text</a> — extract link text
	const linkMatches = html.matchAll(/<a\b[^>]*>(.*?)<\/a>/gi);
	for (const match of linkMatches) {
		const linkText = stripHtmlTags(match[1]).trim();
		const sourceLocation = `${field}@${match.index ?? 0}`;

		if (!linkText) {
			addIssue(issues, {
				severity: "serious",
				rule: "empty-link",
				message: "Link has no text. Screen readers cannot describe where this link goes.",
				blockId,
				pageId,
				sourceLocation,
				help: "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html",
			});
			continue;
		}

		if (BAD_LINK_TEXT_RE.test(linkText)) {
			addIssue(issues, {
				severity: "serious",
				rule: "link-text-quality",
				message: `Link text "${linkText}" is not descriptive. Use text that describes the destination.`,
				blockId,
				pageId,
				sourceLocation,
				help: "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html",
			});
		}

		if (URL_AS_LINK_TEXT_RE.test(linkText)) {
			addIssue(issues, {
				severity: "serious",
				rule: "link-text-quality",
				message: "Link text is a raw URL. Use descriptive text that explains the destination.",
				blockId,
				pageId,
				sourceLocation,
				help: "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html",
			});
		}
	}
}

function stripHtmlTags(html: string): string {
	return html.replace(/<[^>]*>/g, "");
}

// ============================================================
// Page-level checks
// ============================================================

function checkHeadingHierarchy(page: PraxityPage, issues: A11yIssue[]): void {
	const allBlocks = collectAllBlocksDeep(page.blocks);
	const levels: { level: number; blockId: string; sourceLocation: string }[] = [];

	for (const block of allBlocks) {
		const data = block.data as Record<string, unknown>;

		// Heading blocks have an explicit level property
		if ((block.type as string) === "heading") {
			const level = (data.level as number) ?? 2;
			levels.push({ level, blockId: block.id, sourceLocation: "data.level" });
		}

		// An assessment renders its question stem as a heading, and an accordion
		// renders each section control as one. Neither is a `heading` block, so a
		// course could skip a level through them and nothing here would notice.
		if ((block.type as string) === "assessment" && data.stemLevel !== undefined) {
			levels.push({
				level: Number(data.stemLevel) || 3,
				blockId: block.id,
				sourceLocation: "data.stemLevel",
			});
		}
		if ((block.type as string) === "accordion" && Array.isArray(data.items)) {
			const level = Math.min(6, Math.max(2, Number(data.headingLevel) || 3));
			for (let index = 0; index < data.items.length; index++) {
				levels.push({
					level,
					blockId: block.id,
					sourceLocation: `data.items[${index}]`,
				});
			}
		}

		// Text blocks may contain inline <h1>–<h6> tags
		if (block.type === "text") {
			const content = (data.content as string) ?? "";
			const matches = content.matchAll(/<h(\d)/gi);
			for (const match of matches) {
				levels.push({
					level: Number.parseInt(match[1], 10),
					blockId: block.id,
					sourceLocation: `data.content@${match.index ?? 0}`,
				});
			}
		}
	}

	for (let i = 1; i < levels.length; i++) {
		if (levels[i].level - levels[i - 1].level > 1) {
			addIssue(issues, {
				severity: "moderate",
				rule: "heading-hierarchy",
				message: `Heading level jumps from H${levels[i - 1].level} to H${levels[i].level}. Use sequential heading levels.`,
				blockId: levels[i].blockId,
				pageId: page.id,
				sourceLocation: levels[i].sourceLocation,
				help: "https://www.w3.org/WAI/tutorials/page-structure/headings/",
			});
		}
	}
}

/** Flag headings that exceed the recommended character limit */
function checkHeadingLength(page: PraxityPage, issues: A11yIssue[]): void {
	const allBlocks = collectAllBlocksDeep(page.blocks);

	for (const block of allBlocks) {
		const data = block.data as Record<string, unknown>;

		if ((block.type as string) === "heading") {
			const content = (data.content as string) ?? "";
			const text = stripHtmlTags(content).trim();
			if (text.length > MAX_HEADING_LENGTH) {
				addIssue(issues, {
					severity: "minor",
					rule: "heading-length",
					message: `Heading is ${text.length} characters (recommended max: ${MAX_HEADING_LENGTH}). Shorter headings are easier to scan and navigate.`,
					blockId: block.id,
					pageId: page.id,
					sourceLocation: "data.content",
				});
			}
		}

		if (block.type === "text") {
			const content = (data.content as string) ?? "";
			const matches = content.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi);
			for (const match of matches) {
				const text = stripHtmlTags(match[1]).trim();
				if (text.length > MAX_HEADING_LENGTH) {
					addIssue(issues, {
						severity: "minor",
						rule: "heading-length",
						message: `Heading is ${text.length} characters (recommended max: ${MAX_HEADING_LENGTH}). Shorter headings are easier to scan and navigate.`,
						blockId: block.id,
						pageId: page.id,
						sourceLocation: `data.content@${match.index ?? 0}`,
					});
				}
			}
		}
	}
}

/** Flag multiple identical heading texts on the same page */
function checkDuplicateHeadings(page: PraxityPage, issues: A11yIssue[]): void {
	const headingTexts = new Map<string, string>(); // normalized text → first blockId
	const allBlocks = collectAllBlocksDeep(page.blocks);

	for (const block of allBlocks) {
		const data = block.data as Record<string, unknown>;
		const texts: Array<{ text: string; sourceLocation: string }> = [];

		// Heading blocks
		if ((block.type as string) === "heading") {
			const content = (data.content as string) ?? "";
			const text = stripHtmlTags(content).trim();
			if (text) texts.push({ text, sourceLocation: "data.content" });
		}

		// Text blocks with inline headings
		if (block.type === "text") {
			const content = (data.content as string) ?? "";
			const matches = content.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi);
			for (const match of matches) {
				const text = stripHtmlTags(match[1]).trim();
				if (text) {
					texts.push({
						text,
						sourceLocation: `data.content@${match.index ?? 0}`,
					});
				}
			}
		}

		for (const { text, sourceLocation } of texts) {
			const normalized = text.toLowerCase();
			if (headingTexts.has(normalized) && headingTexts.get(normalized) !== block.id) {
				addIssue(issues, {
					severity: "minor",
					rule: "duplicate-heading",
					message: `Duplicate heading "${text}". Unique headings help screen reader users navigate by heading list.`,
					blockId: block.id,
					pageId: page.id,
					sourceLocation,
					help: "https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html",
				});
			} else {
				headingTexts.set(normalized, block.id);
			}
		}
	}
}

/**
 * Flag two consecutive headings with no body content between them.
 * Intentionally walks only top-level blocks (not deep) — containers like
 * tabs/accordion provide semantic separation, so headings inside them
 * are in a different visual context.
 */
function checkConsecutiveHeadings(page: PraxityPage, issues: A11yIssue[]): void {
	let lastBlockWasHeadingOnly = false;

	for (const block of page.blocks) {
		const data = block.data as Record<string, unknown>;

		// Heading blocks are always heading-only (they contain nothing else)
		if ((block.type as string) === "heading") {
			if (lastBlockWasHeadingOnly) {
				addIssue(issues, {
					severity: "minor",
					rule: "consecutive-headings",
					message:
						"Multiple consecutive headings with no content between them. Consider combining or adding body text.",
					blockId: block.id,
					pageId: page.id,
				});
			}
			lastBlockWasHeadingOnly = true;
			continue;
		}

		if (block.type === "text") {
			const content = (data.content as string) ?? "";
			const stripped = content.replace(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi, "").trim();
			const hasHeading = /<h[1-6]/i.test(content);
			const hasBody = stripHtmlTags(stripped).trim().length > 0;
			const isHeadingOnly = hasHeading && !hasBody;

			if (isHeadingOnly && lastBlockWasHeadingOnly) {
				addIssue(issues, {
					severity: "minor",
					rule: "consecutive-headings",
					message:
						"Multiple consecutive headings with no content between them. Consider combining or adding body text.",
					blockId: block.id,
					pageId: page.id,
				});
			}

			lastBlockWasHeadingOnly = isHeadingOnly;
			continue;
		}

		// Any other block type breaks the heading streak
		lastBlockWasHeadingOnly = false;
	}
}

/** Flag pages where multiple images share identical alt text */
function checkRepeatedAltText(page: PraxityPage, issues: A11yIssue[]): void {
	const altTexts = new Map<string, string>(); // normalized alt → first blockId

	for (const block of page.blocks) {
		if (block.type !== "image") continue;
		const data = block.data as Record<string, unknown>;
		const altText = readAltText(data);
		const decorative = data.decorative as boolean;

		if (!altText || decorative) continue;

		const normalized = altText.trim().toLowerCase();
		if (!normalized) continue;

		if (altTexts.has(normalized) && altTexts.get(normalized) !== block.id) {
			addIssue(issues, {
				severity: "minor",
				rule: "repeated-alt-text",
				message: `Multiple images share the same alt text "${altText.trim()}". Each image should have unique, descriptive alt text.`,
				blockId: block.id,
				pageId: page.id,
			});
		} else {
			altTexts.set(normalized, block.id);
		}
	}
}

/** Flag multiple links on the same page pointing to the same URL */
function checkDuplicateLinks(page: PraxityPage, issues: A11yIssue[]): void {
	const allBlocks = collectAllBlocksDeep(page.blocks);
	const seenUrls = new Map<string, string>(); // normalized URL → first blockId

	for (const block of allBlocks) {
		const data = block.data as Record<string, unknown>;
		const urls: Array<{ url: string; sourceLocation: string }> = [];

		// Text blocks: extract href from <a> tags
		if (block.type === "text") {
			const content = (data.content as string) ?? "";
			// Double-quote only — safe because TipTap always serializes with double quotes
			const matches = content.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>/gi);
			for (const match of matches) {
				if (match[1]) {
					urls.push({
						url: match[1],
						sourceLocation: `data.content@${match.index ?? 0}`,
					});
				}
			}
		}

		// Button blocks
		if ((block.type as string) === "button") {
			const href = data.href as string;
			if (href) urls.push({ url: href, sourceLocation: "data.href" });
		}

		// Document blocks
		if ((block.type as string) === "document") {
			const url = data.url as string;
			if (url) urls.push({ url, sourceLocation: "data.url" });
		}

		for (const { url, sourceLocation } of urls) {
			const normalized = url.trim().toLowerCase().replace(/\/+$/, "");
			if (!normalized) continue;

			if (seenUrls.has(normalized) && seenUrls.get(normalized) !== block.id) {
				addIssue(issues, {
					severity: "minor",
					rule: "duplicate-links",
					message:
						"Multiple links point to the same URL. Consider consolidating into a single link.",
					blockId: block.id,
					pageId: page.id,
					sourceLocation,
				});
			} else {
				seenUrls.set(normalized, block.id);
			}
		}
	}
}

/** Flag abbreviations used without being defined on the page */
function checkAbbreviations(page: PraxityPage, issues: A11yIssue[]): void {
	const allBlocks = collectAllBlocksDeep(page.blocks);
	const textParts: Array<{ blockId: string; html: string }> = [];

	for (const block of allBlocks) {
		const data = block.data as Record<string, unknown>;
		if (block.type === "text" || (block.type as string) === "heading") {
			const content = (data.content as string) ?? "";
			textParts.push({ blockId: block.id, html: content });
		}
	}

	const fullHtml = textParts.map((part) => part.html).join(" ");
	const fullText = stripHtmlTags(fullHtml);
	const acronymSources = new Map<string, { blockId: string; sourceLocation: string }>();
	for (const part of textParts) {
		for (const match of stripHtmlTags(part.html).matchAll(/\b[A-Z]{2,}\b/g)) {
			const acronym = match[0];
			if (!acronymSources.has(acronym)) {
				acronymSources.set(acronym, {
					blockId: part.blockId,
					sourceLocation: `data.content@${match.index ?? 0}`,
				});
			}
		}
	}

	for (const [acronym, source] of acronymSources) {
		const expansionRe = new RegExp(`\\w[\\w\\s]+\\(${acronym}\\)`, "i");
		if (expansionRe.test(fullText)) continue;

		const abbrRe = new RegExp(`<abbr[^>]*>[^<]*${acronym}[^<]*</abbr>`, "i");
		if (abbrRe.test(fullHtml)) continue;

		addIssue(issues, {
			severity: "minor",
			rule: "abbreviation-undefined",
			message: `Abbreviation '${acronym}' is used without being defined. Add a tooltip to define it — tooltips automatically feed into the course glossary page.`,
			messageValues: { abbreviation: acronym },
			blockId: source.blockId,
			pageId: page.id,
			sourceLocation: source.sourceLocation,
		});
	}
}

/** Flag instructions that reference visual characteristics only */
function checkSensoryInstructions(page: PraxityPage, issues: A11yIssue[]): void {
	const allBlocks = collectAllBlocksDeep(page.blocks);

	for (const block of allBlocks) {
		const data = block.data as Record<string, unknown>;
		if (block.type !== "text") continue;
		const content = (data.content as string) ?? "";
		const text = stripHtmlTags(content);

		const colorRe =
			/\b(click|tap|press|select|choose)\b.{0,20}\b(red|blue|green|yellow|orange|purple)\b.{0,20}\b(button|link|icon|section|area)\b/i;
		const colorMatch = text.match(colorRe);
		if (colorMatch) {
			addIssue(issues, {
				severity: "moderate",
				rule: "sensory-only-instructions",
				message: `Instructions reference visual characteristics ('${colorMatch[0].trim()}'). Not all users can perceive color, position, or shape. Include the element's name or label.`,
				blockId: block.id,
				pageId: page.id,
				help: "https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics.html",
			});
			continue;
		}

		const shapeRe =
			/\b(click|tap|press|select|choose)\b.{0,20}\b(round|square|large|small|circular)\b.{0,20}\b(button|icon|link)\b/i;
		const shapeMatch = text.match(shapeRe);
		if (shapeMatch) {
			addIssue(issues, {
				severity: "moderate",
				rule: "sensory-only-instructions",
				message: `Instructions reference visual characteristics ('${shapeMatch[0].trim()}'). Not all users can perceive color, position, or shape. Include the element's name or label.`,
				blockId: block.id,
				pageId: page.id,
				help: "https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics.html",
			});
		}
	}
}

/**
 * Flag video/audio blocks that are not preceded by a heading.
 * Media without a heading context is harder to understand and navigate.
 */
function checkMediaFollowingHeading(page: PraxityPage, issues: A11yIssue[]): void {
	let lastBlockWasHeading = false;

	for (const block of page.blocks) {
		const blockType = block.type as string;

		if (blockType === "heading") {
			lastBlockWasHeading = true;
			continue;
		}

		// Text blocks with inline headings also count
		if (blockType === "text") {
			const data = block.data as Record<string, unknown>;
			const content = (data.content as string) ?? "";
			if (/<h[1-6]/i.test(content)) {
				lastBlockWasHeading = true;
			} else {
				lastBlockWasHeading = false;
			}
			continue;
		}

		if (blockType === "video" || blockType === "audio") {
			if (!lastBlockWasHeading) {
				addIssue(issues, {
					severity: "serious",
					rule: "video-following-heading",
					message: `${blockType === "video" ? "Video" : "Audio"} block is not preceded by a heading. Add a heading before media to provide context for screen reader users navigating by headings.`,
					blockId: block.id,
					pageId: page.id,
				});
			}
		}

		lastBlockWasHeading = false;
	}
}

// ============================================================
// Phase 3: Content quality page-level checks
// ============================================================

/** Max words per sentence before flagging */
const MAX_SENTENCE_WORDS = 30;
/** Max words per paragraph before flagging */
const MAX_PARAGRAPH_WORDS = 150;

/** Flag text blocks with excessively long sentences */
function checkSentenceLength(page: PraxityPage, issues: A11yIssue[]): void {
	const allBlocks = collectAllBlocksDeep(page.blocks);
	for (const block of allBlocks) {
		if (block.type !== "text") continue;
		const data = block.data as Record<string, unknown>;
		const content = (data.content as string) ?? "";
		const text = stripHtmlTags(content);

		const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
		for (const sentence of sentences) {
			const wordCount = sentence.trim().split(/\s+/).length;
			if (wordCount > MAX_SENTENCE_WORDS) {
				addIssue(issues, {
					severity: "moderate",
					rule: "sentence-length-excessive",
					message: `Sentence has ${wordCount} words (recommended max: ${MAX_SENTENCE_WORDS}). Shorter sentences are easier to comprehend.`,
					blockId: block.id,
					pageId: page.id,
				});
				break; // One flag per block is enough
			}
		}
	}
}

/** Flag text blocks with excessively long paragraphs */
function checkParagraphLength(page: PraxityPage, issues: A11yIssue[]): void {
	const allBlocks = collectAllBlocksDeep(page.blocks);
	for (const block of allBlocks) {
		if (block.type !== "text") continue;
		const data = block.data as Record<string, unknown>;
		const content = (data.content as string) ?? "";

		// Split by paragraph tags
		const paragraphs = content.split(/<\/p>/i).filter((p) => p.trim().length > 0);
		for (const p of paragraphs) {
			const text = stripHtmlTags(p).trim();
			if (!text) continue;
			const wordCount = text.split(/\s+/).length;
			if (wordCount > MAX_PARAGRAPH_WORDS) {
				addIssue(issues, {
					severity: "minor",
					rule: "paragraph-length-excessive",
					message: `Paragraph has ${wordCount} words (recommended max: ${MAX_PARAGRAPH_WORDS}). Break long paragraphs into smaller chunks for better readability.`,
					blockId: block.id,
					pageId: page.id,
				});
				break; // One flag per block
			}
		}
	}
}

/** Flag 3+ consecutive image blocks without intervening text */
function checkImageClusterWithoutContext(page: PraxityPage, issues: A11yIssue[]): void {
	let consecutiveImages = 0;
	let firstImageId = "";

	for (const block of page.blocks) {
		if (block.type === "image") {
			if (consecutiveImages === 0) firstImageId = block.id;
			consecutiveImages++;

			if (consecutiveImages >= 3) {
				addIssue(issues, {
					severity: "minor",
					rule: "image-cluster-without-context",
					message: `${consecutiveImages} consecutive image blocks without text. Add captions or text between images to provide context.`,
					blockId: firstImageId,
					pageId: page.id,
				});
				consecutiveImages = 0; // Reset to avoid repeat flagging
				firstImageId = "";
			}
		} else {
			consecutiveImages = 0;
			firstImageId = "";
		}
	}
}

// ============================================================
// Course-wide checks
// ============================================================

/** Flag courses where a high proportion of images are marked decorative */
function checkDecorativeImageOveruse(pages: PraxityPage[], issues: A11yIssue[]): void {
	let totalImages = 0;
	let decorativeImages = 0;

	for (const page of pages) {
		for (const block of page.blocks) {
			if (block.type !== "image") continue;
			const data = block.data as Record<string, unknown>;
			const src = data.src as string;
			if (!src) continue;
			totalImages++;
			if (data.decorative) decorativeImages++;
		}
	}

	if (totalImages >= 4 && decorativeImages / totalImages > 0.5) {
		addIssue(issues, {
			severity: "moderate",
			rule: "decorative-image-overuse",
			message: `${decorativeImages} of ${totalImages} images are marked decorative (${Math.round((decorativeImages / totalImages) * 100)}%). Review whether these images truly convey no information.`,
			pageId: "course",
			help: "https://www.w3.org/WAI/tutorials/images/decorative/",
		});
	}
}

/** Flag orphaned glossary terms that never appear in course content */
function checkGlossaryCompleteness(pages: PraxityPage[], issues: A11yIssue[]): void {
	const glossaryTerms: Array<{ term: string; blockId: string }> = [];
	const allText: string[] = [];

	for (const page of pages) {
		const allBlocks = collectAllBlocksDeep(page.blocks);
		for (const block of allBlocks) {
			const data = block.data as Record<string, unknown>;

			if ((block.type as string) === "glossary-term") {
				const term = (data.term as string) ?? "";
				if (term.trim()) glossaryTerms.push({ term: term.trim(), blockId: block.id });
			}

			if (block.type === "text" || (block.type as string) === "heading") {
				const content = (data.content as string) ?? "";
				allText.push(stripHtmlTags(content));
			}
		}
	}

	if (glossaryTerms.length === 0) return;

	const fullText = allText.join(" ").toLowerCase();

	for (const { term, blockId } of glossaryTerms) {
		if (!fullText.includes(term.toLowerCase())) {
			addIssue(issues, {
				severity: "minor",
				rule: "glossary-term-orphaned",
				message: `Glossary term '${term}' is defined but never appears in course content. Remove unused glossary entries or add the term to relevant content.`,
				blockId,
				pageId: "course",
				sourceLocation: "data.term",
			});
		}
	}
}

// ============================================================
// Design system checks
// ============================================================

/** Map contrast warning pairs to severity levels */
const CONTRAST_SEVERITY: Record<string, A11ySeverity> = {
	"text-on-background": "critical",
	"button-text": "critical",
	"accent-on-background": "serious",
	"success-on-background": "moderate",
	"warning-on-background": "moderate",
	"error-on-background": "moderate",
};

export function checkDesignSystemAccessibility(config: DesignSystemConfig): A11yIssue[] {
	const designWarnings = getDesignSettingWarnings(config);
	const issues: A11yIssue[] = [];
	for (const warning of designWarnings)
		addIssue(issues, {
			severity: "minor",
			rule: warning.code,
			message: warning.path,
			messageValues: {
				path: warning.path,
				...("pairing" in warning ? { pairing: warning.pairing } : {}),
			},
			blockId: "designSystem",
			sourceLocation: warning.path,
		});

	// Contrast checks using resolved theme colors
	if (config.colors) {
		const warnings = checkContrastPairs(config.colors);
		for (const warning of warnings) {
			addIssue(issues, {
				severity: CONTRAST_SEVERITY[warning.pair] ?? "serious",
				rule: `theme-${warning.pair}-contrast`,
				message: `${warning.label} contrast ratio is ${warning.ratio}:1 (required: ${warning.required}:1). Increase contrast for readability.`,
				blockId: "designSystem",
				pageId: "course",
				help: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
			});
		}
	}

	// Line height minimum (WCAG 1.4.12)
	if (config.lineHeight !== undefined && config.lineHeight < 1.5) {
		addIssue(issues, {
			severity: "serious",
			rule: "line-height-minimum",
			message: `Line height is ${config.lineHeight} (minimum: 1.5). Tight line spacing makes text harder to read, especially for users with dyslexia or low vision.`,
			blockId: "designSystem",
			pageId: "course",
			help: "https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html",
		});
	}

	// Base font size minimum
	if (config.baseFontSize !== undefined && config.baseFontSize < 16) {
		addIssue(issues, {
			severity: "serious",
			rule: "font-size-minimum",
			message: `Base font size is ${config.baseFontSize}px (recommended minimum: 16px). Small text is hard to read on mobile and for users with low vision.`,
			blockId: "designSystem",
			pageId: "course",
		});
	}

	// Content max width (WCAG 1.4.8 recommends ≤80 characters per line)
	if (config.contentMaxWidth !== undefined && config.contentMaxWidth > 720) {
		addIssue(issues, {
			severity: "moderate",
			rule: "max-content-width",
			message: `Content max width is ${config.contentMaxWidth}px (recommended max: 720px / ~80 characters). Long lines are harder to read and track.`,
			blockId: "designSystem",
			pageId: "course",
			help: "https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html",
		});
	}

	return issues;
}
