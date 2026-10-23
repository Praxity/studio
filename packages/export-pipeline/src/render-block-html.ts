import { isAvatarNone } from "@praxity/grammar";
import { resolveAssessmentDontKnow } from "@praxity/shared-blocks/assessment-choice";
import {
	formatChartNumber,
	type PublishedChartSeries,
	renderCartesianChartSvg,
	renderRadarChartSvg,
	sortChartData,
} from "@praxity/shared-blocks/chart-svg";
import { codeLanguageName } from "@praxity/shared-blocks/code-highlighting";
import { dialogueTurns } from "@praxity/shared-blocks/dialogue-turns";
import { isEmbeddableHost } from "@praxity/shared-blocks/embed-url-utils";
import { externalLinkIndicatorHtml } from "@praxity/shared-blocks/external-link-utils";
import {
	getFileTypeLabel,
	getFileTypeLabelFromMime,
	getLinkPreviewMeta,
} from "@praxity/shared-blocks/file-link-utils";
import {
	constructSelfCheckPromptBlock,
	decodeEscapes,
	fillBlankChoices,
	fillBlankParts,
} from "@praxity/shared-blocks/grammar-adapter";
import { normalizeHeadingLevel } from "@praxity/shared-blocks/heading-styles";
import { hotspotGeometry } from "@praxity/shared-blocks/hotspot-geometry";
import { assessmentPointsLabel } from "@praxity/shared-blocks/i18n/assessment-labels";
import { resolveLocale } from "@praxity/shared-blocks/i18n/locale";
import { getRetrievalSheetStrings } from "@praxity/shared-blocks/i18n/retrieval-sheet-strings";
import { getSelfCheckCompletionStrings } from "@praxity/shared-blocks/i18n/self-check-completion-strings";
import { getStrings, interpolate, type LearnerStrings } from "@praxity/shared-blocks/i18n/strings";
import { isDecorativeImage, readAltText } from "@praxity/shared-blocks/image-a11y";
import { getImageFloatSide, imageFloatRegions } from "@praxity/shared-blocks/image-float";
import { inlineMarkdown } from "@praxity/shared-blocks/inline-markdown";
import { isJournal } from "@praxity/shared-blocks/journal";
import { renderMath } from "@praxity/shared-blocks/math";
import { htmlToPlainText, splitHeadingContent } from "@praxity/shared-blocks/sanitize";
import { renderSceneHeader } from "@praxity/shared-blocks/scene-header";
import type {
	AssessmentBlockData,
	AssessmentGroupBlockData,
	CardBlockData,
	ChartBlockData,
	ChecklistBlockData,
	ColumnsBlockData,
	FillBlankResponse,
	HeroCoverBlockData,
	HighlightData,
	ImageComparisonBlockData,
	ImageFloat,
	LabeledGraphicBlockData,
	PraxityBlock,
	RatingBlockData,
	ResourceEntryData,
	RetrievalSheetData,
	SequenceContainerData,
	SignatureBlockData,
	StatsBlockData,
	TableBlockData,
	WriteDistractorsPrompt,
} from "@praxity/shared-blocks/types";
import {
	getYouTubeFacadeSrcDoc,
	isDirectVideoUrl,
	isVimeoEmbed,
	isYouTubeEmbed,
	toEmbedUrl,
} from "@praxity/shared-blocks/video-url-utils";
import { assessmentGroupHasProgress } from "@praxity/shared-blocks/viewer/assessment-group-runtime";
import { strings as retrievalSheetPatternStrings } from "learning-patterns/patterns/retrieval-sheet/strings.js";
import { strings as selfCheckPatternStrings } from "learning-patterns/patterns/self-check/strings.js";
import { codeTokenCss, highlightCode } from "./code-highlighting.ts";
import { escapeJsonForHtml } from "./escape-json-for-html.ts";
import { renderChoice } from "./patterns/choice/render.ts";
import { renderHeading } from "./patterns/heading/render.ts";
import { renderHighlight } from "./patterns/highlight/render.ts";
import { renderNote } from "./patterns/note/render.ts";
import { renderQuote } from "./patterns/quote/render.ts";
import { renderRetrievalSheet } from "./patterns/retrieval-sheet/render.ts";
import { renderText } from "./patterns/text/render.ts";
import { renderWriteDistractors } from "./patterns/write-distractors/render";
import { assertHighlightData, assertRetrievalSheetData } from "./practice-admission";
import {
	renderDisclosureChevron,
	renderDisclosureHeading,
	renderTranscript,
} from "./published-disclosure-markup.ts";
import {
	camelToKebab,
	escapeHtml,
	normalizeEmbedUrl,
	renderInlineField,
	sanitizeBlockForJson,
	sanitizeEmbedUrl,
	sanitizeHref,
	sanitizeInline,
	sanitizeUrl,
} from "./published-markup.ts";
import { blockRequiresPageGate, getBlockIsland, type IslandName } from "./runtime-plan.ts";

// Retain the existing projection import path for callers outside this module.
export { sanitizeBlockForJson } from "./published-markup.ts";

export type RenderBlockHtmlStrings = Pick<
	LearnerStrings,
	| "selfCheckAnswer"
	| "selfCheckNeedsScript"
	| "selfCheckCheck"
	| "selfCheckShowFeedback"
	| "selfCheckStartOver"
	| "dontKnow"
	| "mediaOpen"
	| "mediaShowEmbed"
	| "showAll"
	| "videoLabel"
	| "play"
	| "audioContent"
	| "audioLabel"
	| "documentFallbackTitle"
	| "documentDownload"
	| "resourceOpenLink"
	| "viewTranscript"
	| "opensInNewTab"
	| "buttonLabel"
	| "sectionLabel"
	| "tabLabel"
	| "columnsPresetBefore"
	| "columnsPresetAfter"
	| "columnsPresetOptionA"
	| "columnsPresetOptionB"
	| "selectAMatch"
	| "categorizeItemsColumn"
	| "moveUp"
	| "moveDown"
	| "hotspotLabel"
	| "hotspotSelectionPrompt"
	| "typeYourAnswer"
	| "questionLabel"
	| "optionLabel"
	| "checklistLabel"
	| "itemLabel"
	| "required"
	| "assessmentPoint"
	| "assessmentNeedsScript"
	| "assessmentPoints"
	| "assessmentBlankLabel"
	| "assessmentWordBank"
	| "selectAnAnswer"
	| "assessmentGroupPassingScore"
	| "assessmentGroupProgress"
	| "assessmentGroupChooseOne"
	| "assessmentGroupQuestionFallback"
	| "untitledGroup"
	| "noteType"
	| "infoNoteType"
	| "tipNoteType"
	| "successNoteType"
	| "warningNoteType"
	| "errorNoteType"
	| "noteAriaLabel"
	| "dataTable"
	| "labeledGraphicLabel"
	| "labeledGraphicClickToReveal"
	| "labeledGraphicSequentialInstruction"
	| "labeledGraphicProgress"
	| "expandableContentSections"
	| "tabbedContentSections"
	| "previousCard"
	| "nextCard"
	| "previousSlide"
	| "nextSlide"
	| "sequenceLabel"
	| "sequenceStepsLabel"
	| "sequenceTimelineLabel"
	| "sequenceEmpty"
	| "sequenceScrollRegion"
	| "tableScrollHint"
	| "sequenceScrollPrevious"
	| "sequenceScrollNext"
	| "nowShowingBack"
	| "nowShowingFront"
	| "flashcardInteraction"
	| "flashcardAriaLabel"
	| "turnCard"
	| "backToFront"
	| "rateValueOf"
	| "ratingLabel"
	| "feedbackLabel"
	| "signatureLabel"
	| "signatureMethod"
	| "signatureDraw"
	| "signatureType"
	| "signatureDrawn"
	| "drawYourSignature"
	| "signatureKeyboardHint"
	| "signatureMethodLocked"
	| "signedAt"
	| "clearSignature"
	| "slidesLabel"
	| "chooseSlide"
	| "goToSlide"
	| "imageComparisonSlider"
	| "uploadComparisonImages"
	| "copyCodeToClipboard"
	| "codeRegion"
	| "copyLabel"
>;

const DEFAULT_RENDER_STRINGS: RenderBlockHtmlStrings = {
	selfCheckAnswer: getStrings("en").selfCheckAnswer,
	selfCheckNeedsScript: getStrings("en").selfCheckNeedsScript,
	selfCheckCheck: getStrings("en").selfCheckCheck,
	selfCheckShowFeedback: getStrings("en").selfCheckShowFeedback,
	selfCheckStartOver: getStrings("en").selfCheckStartOver,
	dontKnow: getStrings("en").dontKnow,
	mediaOpen: getStrings("en").mediaOpen,
	mediaShowEmbed: "Show embedded content",
	showAll: "Show all",
	videoLabel: "Video",
	play: "Play",
	audioContent: "Audio content",
	audioLabel: "Audio",
	documentFallbackTitle: "Document",
	documentDownload: "Download",
	resourceOpenLink: "Open link",
	viewTranscript: "View transcript",
	opensInNewTab: getStrings("en").opensInNewTab,
	buttonLabel: "Button",
	sectionLabel: "Section {index}",
	tabLabel: "Tab {index}",
	columnsPresetBefore: "Before",
	columnsPresetAfter: "After",
	columnsPresetOptionA: "Option A",
	columnsPresetOptionB: "Option B",
	selectAMatch: "Select a match...",
	categorizeItemsColumn: "Items",
	moveUp: "Move {label} up",
	moveDown: "Move {label} down",
	hotspotLabel: "Hotspot {index}",
	hotspotSelectionPrompt: getStrings("en").hotspotSelectionPrompt,
	typeYourAnswer: "Type your answer...",
	questionLabel: "Question",
	optionLabel: "Option {index}",
	checklistLabel: "Checklist",
	itemLabel: "Item {index}",
	required: "Required",
	assessmentPoint: "{points} point",
	assessmentWordBank: "Word bank: {words}. Use each entry once.",
	selectAnAnswer: "Select an answer",
	assessmentBlankLabel: "Blank {current} of {total}, after “{context}”",
	assessmentNeedsScript:
		"Answering this question needs JavaScript. Turn it on to answer and see feedback.",
	assessmentPoints: "{points} points",
	assessmentGroupPassingScore: "Passing score: {score}%",
	assessmentGroupProgress: "Questions completed: {completed} of {total}",
	assessmentGroupChooseOne: "Choose one",
	assessmentGroupQuestionFallback: "Question {index}",
	untitledGroup: "Untitled group",
	noteType: "Note",
	infoNoteType: "Info",
	tipNoteType: "Tip",
	successNoteType: "Success",
	warningNoteType: "Warning",
	errorNoteType: "Error",
	noteAriaLabel: "{type} note",
	dataTable: "Data table",
	labeledGraphicLabel: "Labeled graphic",
	labeledGraphicClickToReveal: "Select the numbered pins to explore",
	labeledGraphicSequentialInstruction:
		"Explore the numbered pins in order. Later pins become available after the preceding pin.",
	labeledGraphicProgress: "{revealed} of {total} revealed",
	expandableContentSections: "Expandable content sections",
	tabbedContentSections: "Tabbed content sections",
	previousCard: "Previous card",
	nextCard: "Next card",
	previousSlide: "Previous slide",
	nextSlide: "Next slide",
	sequenceLabel: "Sequence",
	sequenceStepsLabel: "Steps",
	sequenceTimelineLabel: "Timeline",
	sequenceEmpty: "No steps",
	sequenceScrollRegion: "Scrollable sequence",
	tableScrollHint: "Scroll for more",
	sequenceScrollPrevious: "Scroll sequence left",
	sequenceScrollNext: "Scroll sequence right",
	nowShowingBack: "Now showing back",
	nowShowingFront: "Now showing front",
	flashcardInteraction: "Flashcard interaction",
	flashcardAriaLabel: "Flashcard {current} of {total}, {side}. Click to flip",
	turnCard: "I have my answer",
	backToFront: "Hide answer",
	rateValueOf: "Rate {value} of {count}",
	ratingLabel: "Rating",
	feedbackLabel: "Feedback",
	signatureLabel: "Signature",
	signatureMethod: "Signature method",
	signatureDraw: "Draw",
	signatureType: "Type",
	signatureDrawn: "Signature drawn",
	signatureMethodLocked: "Clear your signature to change the signing method.",
	drawYourSignature: "Draw your signature",
	signatureKeyboardHint: "Press Enter or Space to switch to typing your signature.",
	signedAt: "Signed {date}",
	clearSignature: "Clear",
	slidesLabel: "Slides",
	chooseSlide: "Choose slide to display",
	goToSlide: "Go to slide {index}",
	imageComparisonSlider: "Image comparison slider",
	uploadComparisonImages: "Upload two images to compare",
	copyCodeToClipboard: "Copy code to clipboard",
	codeRegion: "Code",
	copyLabel: "Copy",
};

const IMAGE_WIDTH_MAP: Record<string, string> = {
	small: "33%",
	medium: "50%",
	large: "75%",
};

export interface RenderBlockHtmlOptions {
	selfCheckContextPending?: boolean;
	sourceLocale?: string;
	classNames?: string[];
	extraAttributes?: string[];
	assessmentGroupMembers?: PraxityBlock[];
	includeDataBlockJson?: boolean;
	enabledIslands?: ReadonlySet<IslandName>;
	hiddenBlockIds?: ReadonlySet<string>;
	siblingBlocks?: readonly PraxityBlock[];
	blockIndex?: number;
	strings?: Partial<RenderBlockHtmlStrings>;
}

function formatIndexedLabel(template: string, index: number): string {
	if (template.includes("{index}")) {
		return template.replaceAll("{index}", String(index));
	}
	return `${template} ${index}`;
}

function renderChildren(
	blocks: PraxityBlock[],
	strings: RenderBlockHtmlStrings,
	enabledIslands?: ReadonlySet<IslandName>,
	hiddenBlockIds?: ReadonlySet<string>,
	sourceLocale?: string,
	selfCheckContextPending = false,
): string {
	let blockIndex = 0;
	return imageFloatRegions(blocks)
		.map((region) => {
			const content = region.blocks
				.map((child) =>
					renderBlockHtml(child, {
						strings,
						enabledIslands,
						hiddenBlockIds,
						sourceLocale,
						selfCheckContextPending,
						blockIndex: blockIndex++,
					}),
				)
				.join("\n");
			return region.float
				? `<div class="praxity-float-region" data-image-float-region="${region.float}"${region.nodeId ? ` data-node-id="${escapeHtml(region.nodeId)}"` : ""}>${content}</div>`
				: region.nodeId
					? `<div data-node-id="${escapeHtml(region.nodeId)}">${content}</div>`
					: content;
		})
		.join("\n");
}

function formatTemplate(template: string, values: Record<string, string | number>): string {
	return Object.entries(values).reduce(
		(result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
		template,
	);
}

function renderImage(block: PraxityBlock, imageFloat: ImageFloat | null): string {
	const data = block.data as Record<string, unknown>;
	const src = sanitizeUrl(typeof data.src === "string" ? data.src : "");
	const alt = data.decorative === true ? "" : String(data.alt ?? data.altText ?? "");
	const caption = renderInlineField(data, "caption");
	const showCaption = data.captionEnabled !== false && caption;
	const width = typeof data.width === "string" ? IMAGE_WIDTH_MAP[data.width] : undefined;
	const imageWidth =
		data.width === "small" || data.width === "medium" || data.width === "large" ? data.width : null;
	const resolvedFloat =
		imageWidth && (imageFloat === "left" || imageFloat === "right") ? imageFloat : null;
	const alignment =
		data.alignment === "left" || data.alignment === "right" ? data.alignment : "center";
	const styleParts = ["margin:0"];
	if (width) {
		styleParts.push(`max-width:${width}`);
	}
	if (resolvedFloat) {
		styleParts.push(`text-align:${alignment}`);
	} else if (alignment === "center") {
		styleParts.push("margin-left:auto", "margin-right:auto", "text-align:center");
	} else if (alignment === "left") {
		styleParts.push("margin-right:auto", "text-align:left");
	} else {
		styleParts.push("margin-left:auto", "text-align:right");
	}
	const wrapAttrs = resolvedFloat
		? ` data-image-float="${resolvedFloat}" data-image-width="${imageWidth}" data-image-alignment="${alignment}"`
		: "";
	const figureStyle = ` style="${escapeHtml(styleParts.join(";"))}"`;
	const ratio =
		data.ratio === "square"
			? "1 / 1"
			: data.ratio === "4:3"
				? "4 / 3"
				: data.ratio === "3:2"
					? "3 / 2"
					: data.ratio === "16:9"
						? "16 / 9"
						: undefined;
	const fit = data.fit === "contain" || (ratio && data.fit !== "cover") ? "contain" : "cover";
	const intrinsicWidth =
		typeof data.intrinsicWidth === "number" && data.intrinsicWidth > 0
			? Math.round(data.intrinsicWidth)
			: null;
	const intrinsicHeight =
		typeof data.intrinsicHeight === "number" && data.intrinsicHeight > 0
			? Math.round(data.intrinsicHeight)
			: null;
	const sizeAttrs =
		intrinsicWidth && intrinsicHeight
			? ` width="${intrinsicWidth}" height="${intrinsicHeight}"`
			: "";
	const priority = data.fetchPriority === "high";
	const loadingAttr =
		data.loading === "eager" || data.loading === "lazy" ? ` loading="${data.loading}"` : "";
	return `<figure${wrapAttrs}${figureStyle}><span class="praxity-image-hover-shadow" aria-hidden="true"></span><img data-node-id="${escapeHtml(typeof data.imageId === "string" ? data.imageId : block.id)}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${data.decorative === true ? ' role="presentation"' : ""}${sizeAttrs}${loadingAttr}${priority ? ' fetchpriority="high"' : ""} style="display:block;${sizeAttrs || ratio ? "height:auto;" : ""}${ratio ? `aspect-ratio:${ratio};` : ""}object-fit:${fit};width:100%" />${showCaption ? `<figcaption class="praxity-block-caption">${caption}</figcaption>` : ""}</figure>`;
}

type PublishedComparisonImage = ImageComparisonBlockData["beforeImage"] & {
	intrinsicWidth?: number;
	intrinsicHeight?: number;
	loading?: "eager" | "lazy";
	fetchPriority?: "high";
};

function renderComparisonImage(image: PublishedComparisonImage, className: string): string {
	const src = sanitizeUrl(typeof image?.src === "string" ? image.src : "");
	const width =
		typeof image?.intrinsicWidth === "number" && image.intrinsicWidth > 0
			? Math.round(image.intrinsicWidth)
			: null;
	const height =
		typeof image?.intrinsicHeight === "number" && image.intrinsicHeight > 0
			? Math.round(image.intrinsicHeight)
			: null;
	const sizeAttrs = width && height ? ` width="${width}" height="${height}"` : "";
	const loading = image?.loading === "eager" ? "eager" : "lazy";
	return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(readAltText(image))}"${sizeAttrs} loading="${loading}"${image?.fetchPriority === "high" ? ' fetchpriority="high"' : ""} draggable="false" />`;
}

function renderImageComparison(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as unknown as ImageComparisonBlockData;
	if (!data.beforeImage?.src || !data.afterImage?.src) {
		return `<p class="praxity-text-light">${escapeHtml(strings.uploadComparisonImages)}</p>`;
	}
	const beforeLabel = data.beforeLabel || strings.columnsPresetBefore;
	const afterLabel = data.afterLabel || strings.columnsPresetAfter;
	const beforeCaption = typeof data.beforeCaption === "string" ? data.beforeCaption : "";
	const afterCaption = typeof data.afterCaption === "string" ? data.afterCaption : "";
	const beforeImage = data.beforeImage as PublishedComparisonImage;
	const afterImage = data.afterImage as PublishedComparisonImage;

	if (data.display !== "slider") {
		return `<figure class="praxity-image-comparison praxity-figure-reset"><div class="praxity-image-comparison-grid"><div class="praxity-image-comparison-item"><p class="praxity-image-comparison-label">${escapeHtml(beforeLabel)}</p>${renderComparisonImage(beforeImage, "praxity-image-comparison-image")}${beforeCaption ? `<p class="praxity-block-caption praxity-image-comparison-caption">${escapeHtml(beforeCaption)}</p>` : ""}</div><div class="praxity-image-comparison-item"><p class="praxity-image-comparison-label">${escapeHtml(afterLabel)}</p>${renderComparisonImage(afterImage, "praxity-image-comparison-image")}${afterCaption ? `<p class="praxity-block-caption praxity-image-comparison-caption">${escapeHtml(afterCaption)}</p>` : ""}</div></div></figure>`;
	}

	const valueText = `50% ${beforeLabel}, 50% ${afterLabel}`;
	const captions = [beforeLabel, afterLabel, beforeCaption, afterCaption]
		.filter(Boolean)
		.join(" · ");
	return `<figure class="praxity-image-comparison praxity-figure-reset"><div class="praxity-comparison-slider" style="--praxity-comparison-position:50%">${renderComparisonImage(afterImage, "praxity-comparison-image praxity-comparison-image--after")}<div class="praxity-comparison-before">${renderComparisonImage(beforeImage, "praxity-comparison-image praxity-comparison-image--before")}</div><div class="praxity-comparison-divider praxity-image-comparison-divider" aria-hidden="true"></div><div class="praxity-comparison-handle praxity-image-comparison-handle" aria-hidden="true">&#x2194;</div><input class="praxity-comparison-slider-control" type="range" min="0" max="100" step="2" value="50" aria-label="${escapeHtml(strings.imageComparisonSlider)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-valuetext="${escapeHtml(valueText)}" /><span class="praxity-comparison-label praxity-comparison-label--before praxity-image-comparison-before-label" title="${escapeHtml(beforeLabel)}">${escapeHtml(beforeLabel)}</span><span class="praxity-comparison-label praxity-comparison-label--after praxity-image-comparison-after-label" title="${escapeHtml(afterLabel)}">${escapeHtml(afterLabel)}</span></div>${captions ? `<figcaption class="praxity-block-caption praxity-image-comparison-caption">${escapeHtml(captions)}</figcaption>` : ""}</figure>`;
}

function renderHeroCover(block: PraxityBlock): string {
	const data = block.data as unknown as HeroCoverBlockData & {
		intrinsicWidth?: number;
		intrinsicHeight?: number;
		loading?: "eager" | "lazy";
		fetchPriority?: "high";
	};
	const src = sanitizeUrl(typeof data.imageSrc === "string" ? data.imageSrc : "");
	const alignment =
		data.alignment === "left" || data.alignment === "right" ? data.alignment : "center";
	const verticalAlignment =
		data.verticalAlignment === "top" || data.verticalAlignment === "center"
			? data.verticalAlignment
			: "bottom";
	const opacity = Number.isFinite(data.overlayOpacity)
		? Math.max(0, Math.min(1, Number(data.overlayOpacity)))
		: 0.5;
	const light = data.overlayColor === "light";
	const rgb = light ? "255,255,255" : "0,0,0";
	const background =
		verticalAlignment === "center"
			? `rgba(${rgb},${opacity})`
			: `linear-gradient(${verticalAlignment === "top" ? "to bottom" : "to top"},rgba(${rgb},${opacity}),rgba(${rgb},${Math.max(opacity - 0.15, 0)}))`;
	const headingOffset = Number.isFinite(data.headingOffset)
		? Math.max(0, Math.trunc(Number(data.headingOffset)))
		: 0;
	const headingLevel = Math.min(6, 1 + headingOffset);
	const width =
		typeof data.intrinsicWidth === "number" && data.intrinsicWidth > 0
			? Math.round(data.intrinsicWidth)
			: null;
	const height =
		typeof data.intrinsicHeight === "number" && data.intrinsicHeight > 0
			? Math.round(data.intrinsicHeight)
			: null;
	const sizeAttrs = width && height ? ` width="${width}" height="${height}"` : "";
	const loading = data.loading === "eager" ? "eager" : "lazy";
	return `<section class="praxity-hero-cover${light ? " praxity-hero-cover--light" : ""}${verticalAlignment === "bottom" ? "" : ` praxity-hero-cover--valign-${verticalAlignment}`}"${src ? "" : " data-no-image"}>${src ? `<img class="praxity-hero-cover-image" src="${escapeHtml(src)}" alt="${escapeHtml(data.imageAlt ?? "")}"${sizeAttrs} loading="${loading}"${data.fetchPriority === "high" ? ' fetchpriority="high"' : ""} />` : ""}<div class="praxity-hero-cover-overlay" style="background:${background}"></div><div class="praxity-hero-cover-content praxity-hero-cover-content--${alignment}" style="text-align:${alignment}"><h${headingLevel} class="praxity-hero-cover-title">${escapeHtml(data.title ?? "")}</h${headingLevel}>${data.subtitle ? `<p class="praxity-hero-cover-subtitle">${escapeHtml(data.subtitle)}</p>` : ""}</div></section>`;
}

function resolveVideoSrc(
	data: Record<string, unknown>,
): { kind: "direct" | "embed"; src: string } | null {
	const source = data.source;
	if (source && typeof source === "object") {
		const typed = source as { type?: string; src?: string; playbackId?: string };
		// Mux-hosted sources are not supported in v1 exports (Praxity does not host
		// video). Authors use a third-party embed URL or a local file packaged with
		// the course. A stale mux source renders nothing rather than a broken frame.
		if (typed.type === "url" && typeof typed.src === "string") {
			const directSrc = sanitizeUrl(typed.src);
			if (directSrc !== "#" && isDirectVideoUrl(directSrc)) {
				return { kind: "direct", src: directSrc };
			}
			const embedSrc = normalizeEmbedUrl(typed.src);
			return embedSrc ? { kind: "embed", src: embedSrc } : null;
		}
	}
	if (typeof data.src === "string") {
		const directSrc = sanitizeUrl(data.src);
		if (directSrc !== "#" && isDirectVideoUrl(directSrc)) {
			return { kind: "direct", src: directSrc };
		}
		const embedSrc = normalizeEmbedUrl(data.src);
		return embedSrc ? { kind: "embed", src: embedSrc } : null;
	}
	return null;
}

function getClipBound(value: unknown, allowZero: boolean): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0)
		? value
		: undefined;
}

function renderCaptionTracks(value: unknown): string {
	if (!Array.isArray(value)) return "";
	return value
		.map((candidate) => {
			if (!candidate || typeof candidate !== "object") return "";
			const track = candidate as Record<string, unknown>;
			if (
				track.kind !== "captions" &&
				track.kind !== "subtitles" &&
				track.kind !== "descriptions"
			) {
				return "";
			}
			const src = sanitizeUrl(typeof track.src === "string" ? track.src : "");
			if (!src || src === "#") return "";
			const language = typeof track.language === "string" ? track.language.trim() : "";
			const label =
				typeof track.label === "string" ? htmlToPlainText(sanitizeInline(track.label)) : "";
			return `<track kind="${track.kind}" src="${escapeHtml(src)}"${language ? ` srclang="${escapeHtml(language)}"` : ""}${label ? ` label="${escapeHtml(label)}"` : ""}${track.default === true ? " default" : ""} />`;
		})
		.join("");
}

function renderVideo(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as Record<string, unknown>;
	const source = resolveVideoSrc(data);
	const transcript = renderTranscript(data.transcript, block.id, strings.viewTranscript);
	if (!source) return transcript;
	const titleFallback = strings.videoLabel || DEFAULT_RENDER_STRINGS.videoLabel;
	const title = renderInlineField(data, "title");
	const frameTitle = htmlToPlainText(title) || titleFallback;
	const caption = data.captionEnabled === false ? "" : renderInlineField(data, "caption");
	const autoplay = data.autoplay === true;
	const startTime = getClipBound(data.startTime ?? data.start, true);
	const endTime = getClipBound(data.endTime ?? data.end, false);
	let embedSrc = source.kind === "embed" ? source.src : "";
	if (isYouTubeEmbed(embedSrc)) {
		const url = new URL(embedSrc);
		if (startTime !== undefined) {
			url.searchParams.set("start", String(Math.floor(startTime)));
		}
		if (endTime !== undefined) {
			url.searchParams.set("end", String(Math.floor(endTime)));
		}
		if (autoplay) url.searchParams.set("autoplay", "1");
		embedSrc = url.toString();
	} else if (isVimeoEmbed(embedSrc) && autoplay) {
		const url = new URL(embedSrc);
		url.searchParams.set("autoplay", "1");
		embedSrc = url.toString();
	}
	const facade = autoplay ? null : getYouTubeFacadeSrcDoc(embedSrc, frameTitle, strings.play);
	const rawPoster = typeof data.posterSrc === "string" ? data.posterSrc : data.poster;
	const poster = sanitizeUrl(typeof rawPoster === "string" ? rawPoster : "");
	const clipAttrs = `${startTime === undefined ? "" : ` data-start-time="${startTime}"`}${endTime === undefined ? "" : ` data-end-time="${endTime}"`}${autoplay ? ' data-autoplay="true"' : ""}`;
	const tracks = renderCaptionTracks(data.captionTracks);
	const media =
		source.kind === "direct"
			? `<video controls preload="${autoplay ? "auto" : "metadata"}" playsinline width="1280" height="720" aria-label="${escapeHtml(frameTitle)}"${autoplay ? " autoplay" : ""}${poster && poster !== "#" ? ` poster="${escapeHtml(poster)}"` : ""}${clipAttrs}><source src="${escapeHtml(source.src)}" />${tracks}</video>`
			: `<iframe data-embed-src="${escapeHtml(embedSrc)}" hidden${facade ? ` srcdoc="${escapeHtml(facade)}"` : ""} title="${escapeHtml(frameTitle)}" width="1280" height="720" loading="${autoplay ? "eager" : "lazy"}" sandbox="allow-scripts allow-same-origin allow-presentation" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen${isVimeoEmbed(embedSrc) ? ` data-media-provider="vimeo"${clipAttrs}` : ""}></iframe>`;
	return `<div class="praxity-video">${title ? `<h3 class="praxity-block-title">${title}</h3>` : ""}${source.kind === "embed" ? `<div class="praxity-media-frame">${media}${renderMediaLink(source.src, frameTitle, strings)}</div>` : media}${caption ? `<p class="praxity-block-caption">${caption}</p>` : ""}${transcript}</div>`;
}

function renderAudio(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as Record<string, unknown>;
	const src = sanitizeUrl(typeof data.src === "string" ? data.src : "");
	const title = renderInlineField(data, "title");
	const label = htmlToPlainText(title) || strings.audioLabel;
	const caption = data.captionEnabled === false ? "" : renderInlineField(data, "caption");
	const transcript = renderTranscript(data.transcript, block.id, strings.viewTranscript);
	const autoplay = data.autoplay === true;
	const tracks = renderCaptionTracks(data.captionTracks);
	const external = isHttpsUrl(src);
	const download = transcript
		? ""
		: `<a href="${escapeHtml(src)}"${external ? ' target="_blank" rel="noopener noreferrer"' : " download"} class="praxity-audio-download">${escapeHtml(strings.documentDownload)}${external ? externalLinkIndicatorHtml(strings.opensInNewTab) : ""}</a>`;
	return `<div class="praxity-audio-card">${title ? `<h3 class="praxity-block-title">${title}</h3>` : ""}<div class="praxity-audio-controls"><div data-audio-player data-audio-src="${escapeHtml(src)}" data-audio-title="${escapeHtml(label)}"><audio controls preload="${autoplay ? "auto" : "metadata"}" class="praxity-audio-player" aria-label="${escapeHtml(label)}"${autoplay ? " autoplay" : ""}><source src="${escapeHtml(src)}" />${tracks}</audio></div>${download}</div>${caption ? `<p class="praxity-block-caption">${caption}</p>` : ""}${transcript}</div>`;
}

function renderEmbed(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as Record<string, unknown>;
	const rawSrc = typeof data.src === "string" ? data.src : "";
	const safeSrc = sanitizeEmbedUrl(rawSrc);
	if (!safeSrc) return "";
	const title =
		renderInlineField(data, "title", data.display !== "bookmark") ||
		sanitizeInline(strings.documentFallbackTitle) ||
		"Document";

	if (data.display === "bookmark") {
		const fileType = getFileTypeLabel(safeSrc);
		const linkMeta = getLinkPreviewMeta(safeSrc, fileType);
		return `<div><div class="praxity-document-bookmark"><div class="praxity-document-bookmark-card"><div class="praxity-document-bookmark-header"><a href="${escapeHtml(safeSrc)}" target="_blank" rel="noopener noreferrer" class="praxity-document-bookmark-link" title="${escapeHtml(safeSrc)}"><span class="praxity-document-bookmark-title">${title}</span>${fileType ? `<span class="praxity-sr-only">, ${escapeHtml(fileType)}</span>` : ""}<span class="praxity-sr-only">, ${escapeHtml(safeSrc)}</span>${externalLinkIndicatorHtml(strings.opensInNewTab)}</a></div>${linkMeta ? `<span class="praxity-document-meta" aria-hidden="true">${escapeHtml(linkMeta)}</span>` : ""}</div></div></div>`;
	}

	const src = isEmbeddableHost(safeSrc) ? sanitizeEmbedUrl(toEmbedUrl(safeSrc)) : "";
	const widthAttribute =
		typeof data.width === "number" && Number.isFinite(data.width) && data.width > 0
			? ` width="${data.width}"`
			: "";
	const height =
		typeof data.height === "number" && Number.isFinite(data.height) && data.height > 0
			? String(data.height)
			: "400";
	const fallback = renderMediaLink(safeSrc, htmlToPlainText(title), strings);
	const heading = `<h3 class="praxity-block-title">${title}</h3>`;
	if (src) {
		const facade = getYouTubeFacadeSrcDoc(src, htmlToPlainText(title), strings.play);
		return `<div class="praxity-embed">${heading}<div class="praxity-media-frame praxity-embed-frame"><iframe data-embed-src="${escapeHtml(src)}" hidden${facade ? ` srcdoc="${escapeHtml(facade)}"` : ""} title="${escapeHtml(htmlToPlainText(title))}"${widthAttribute} height="${height}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" class="praxity-embed-iframe"></iframe>${fallback}</div></div>`;
	}
	return `<div class="praxity-embed">${heading}<div class="praxity-media-frame praxity-embed-frame">${fallback}</div></div>`;
}

function renderMediaLink(src: string, title: string, strings: RenderBlockHtmlStrings): string {
	const label = formatTemplate(strings.mediaOpen, { title });
	return `<div class="praxity-media-fallback praxity-embed-fallback"><a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}${externalLinkIndicatorHtml(strings.opensInNewTab)}</a><span class="praxity-media-source praxity-embed-url">${escapeHtml(src)}</span><button type="button" class="praxity-btn praxity-btn-outline" data-embed-retry hidden>${escapeHtml(strings.mediaShowEmbed)}</button></div>`;
}

function renderDialogue(block: PraxityBlock): string {
	const data =
		block.data && typeof block.data === "object" && !Array.isArray(block.data)
			? (block.data as Record<string, unknown>)
			: {};
	const style = data.style === "script" ? "script" : "bubbles";
	const turns = dialogueTurns<Record<string, unknown>>(data.turns);
	const items = turns
		.map(({ turn, index, speaker, side, continuation }) => {
			const name = htmlToPlainText(typeof turn.name === "string" ? turn.name : "") || speaker;
			const avatar =
				typeof turn.avatar === "string" && !isAvatarNone(turn.avatar)
					? sanitizeUrl(turn.avatar)
					: "";
			const paragraphs = (turn.paragraphs as unknown[])
				.map((part, index) => ({ part, index }))
				.filter(({ part }) => typeof part === "string");
			const text = paragraphs
				.map(({ index }) => `<p>${renderInlineField(turn, ["paragraphs", index])}</p>`)
				.join("");
			return `<li data-node-id="${escapeHtml(typeof turn.id === "string" ? turn.id : `${block.id}-turn-${index}`)}" class="praxity-dialogue-turn" data-turn-index="${index}" data-speaker="${escapeHtml(speaker.toLowerCase() || `turn-${index}`)}" data-side="${side}"${continuation ? ' data-continuation="true"' : ""}>${avatar && avatar !== "#" ? `<img class="praxity-dialogue-avatar" src="${escapeHtml(avatar)}" alt="" role="presentation" />` : ""}<div class="praxity-dialogue-bubble">${name ? `<p class="praxity-dialogue-name${style === "bubbles" && continuation ? " praxity-sr-only" : ""}"><bdi>${escapeHtml(name)}</bdi></p>` : ""}<div class="praxity-dialogue-text" dir="auto">${text}</div></div></li>`;
		})
		.join("");
	const caption = renderInlineField(data, "caption");
	return `<figure class="praxity-dialogue" data-style="${style}">${caption ? `<figcaption class="praxity-dialogue-caption">${caption}</figcaption>` : ""}<ol class="praxity-dialogue-turns" role="list">${items}</ol></figure>`;
}

function renderCode(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as Record<string, unknown>;
	const language =
		typeof data.language === "string" && data.language ? data.language : "javascript";
	const code = typeof data.code === "string" ? data.code : "";
	const title = typeof data.title === "string" ? data.title.trim() : "";
	const displayLanguage = codeLanguageName(language);
	const showLineNumbers = data.showLineNumbers !== false;
	const startLine =
		typeof data.startLine === "number" && Number.isFinite(data.startLine)
			? Math.max(1, Math.trunc(data.startLine))
			: 1;
	const highlighted = new Set(
		Array.isArray(data.highlightLines)
			? data.highlightLines.filter((line): line is number => typeof line === "number")
			: [],
	);
	const lines = code.trim() ? highlightCode(code, language) : [];
	const numberWidth = Math.max(2, String(startLine + lines.length - 1).length);
	const renderedLines = lines
		.map((tokens, index) => {
			const lineNumber = startLine + index;
			const content = tokens
				.map((token) => {
					const style = codeTokenCss(token);
					const classes = token.types.map(escapeHtml).join(" ");
					return `<span class="praxity-code-token token ${classes}"${style ? ` style="${escapeHtml(style)}"` : ""}>${escapeHtml(token.content)}</span>`;
				})
				.join("");
			return `<span class="praxity-code-line${highlighted.has(lineNumber) ? " praxity-code-line--highlighted" : ""}" style="display:flex;min-height:1lh">${showLineNumbers ? `<span class="praxity-code-line-number" aria-hidden="true" style="width:${numberWidth}ch">${lineNumber}</span>` : ""}<span data-code-line>${content}</span></span>`;
		})
		.join("");
	const codeBody = code.trim()
		? `<pre class="praxity-code-pre" role="region" tabindex="0" aria-label="${escapeHtml(`${strings.codeRegion} ${title || displayLanguage}`)}"><code class="language-${escapeHtml(language)}" data-code-content>${renderedLines}</code></pre>`
		: '<pre class="praxity-code-pre praxity-code-pre--empty"><code>No code to display</code></pre>';
	return `<div class="praxity-code-container"><div class="praxity-code-header">${title ? `<span class="praxity-code-title-text">${escapeHtml(title)}</span>` : ""}<span class="praxity-code-language-badge">${escapeHtml(displayLanguage)}</span><button type="button" class="praxity-code-copy-btn" data-code-copy aria-label="${escapeHtml(strings.copyCodeToClipboard)}">${escapeHtml(strings.copyLabel)}</button></div><div class="praxity-code-body"><div aria-live="polite" aria-atomic="true" class="praxity-sr-only" data-code-copy-status></div>${codeBody}</div></div>`;
}

function renderEquation(block: PraxityBlock): string {
	const data = block.data as Record<string, unknown>;
	const latex = typeof data.latex === "string" ? data.latex : "";
	const html = renderMath(latex, true);
	return html
		? `<div class="praxity-math-block" data-math-latex="${escapeHtml(latex)}"><div>${html}</div></div>`
		: "";
}

function renderButton(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as Record<string, unknown>;
	const text =
		renderInlineField(data, "text", false) ||
		strings.buttonLabel ||
		DEFAULT_RENDER_STRINGS.buttonLabel;
	const variant = data.variant === "outline" || data.variant === "light" ? data.variant : "filled";
	const targetPageId =
		data.action === "goToPage" && typeof data.targetPageId === "string"
			? data.targetPageId.trim()
			: "";
	if (targetPageId) {
		return `<button type="button" class="praxity-button" data-variant="${variant}" data-action="goToPage" data-target-page="${escapeHtml(targetPageId)}" data-block-id="${escapeHtml(block.id)}" data-node-id="${escapeHtml(block.id)}">${text}<svg class="praxity-chevron-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.47 3.97a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06L9.69 8.25 6.47 5.03a.75.75 0 0 1 0-1.06Z"/></svg></button>`;
	}
	const href = sanitizeHref(typeof data.href === "string" ? data.href : "#");
	const openInNewTab = data.openInNewTab === true;
	const fileLabel = getFileTypeLabel(href);
	const showFileType = fileLabel && !htmlToPlainText(text).toUpperCase().includes(fileLabel);
	return `<a href="${escapeHtml(href)}" class="praxity-button" data-variant="${variant}"${openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}${showFileType ? ` (${escapeHtml(fileLabel)})` : ""}${openInNewTab ? externalLinkIndicatorHtml(strings.opensInNewTab) : ""}</a>`;
}

function renderTable(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as unknown as TableBlockData;
	const headers = Array.isArray(data.headers) ? data.headers : [];
	const rows = Array.isArray(data.rows) ? data.rows : [];
	const title = renderInlineField(data, "title");
	const caption = renderInlineField(data, "caption");
	const titleId = title ? `${block.id}-table-title` : "";
	const captionId = caption ? `${block.id}-table-caption` : "";
	const labelledBy = [titleId, captionId].filter(Boolean).join(" ");
	const tableNameAttrs = labelledBy
		? ` aria-labelledby="${escapeHtml(labelledBy)}"`
		: ` aria-label="${escapeHtml(strings.dataTable)}"`;
	const headerRow = data.highlightHeaderRow !== false;
	const headerCol = data.highlightHeaderCol === true;
	const renderCells = (cells: string[], rowIndex?: number) =>
		cells
			.map((_cell, index) => {
				const isColumnHeader = rowIndex === undefined && headerRow;
				const isRowHeader = index === 0 && headerCol;
				const tag = isColumnHeader || isRowHeader ? "th" : "td";
				const scope = isColumnHeader ? ' scope="col"' : isRowHeader ? ' scope="row"' : "";
				const alignment = data.columnAlignments?.[index];
				const field = rowIndex === undefined ? ["headers", index] : ["rows", rowIndex, index];
				const content = renderInlineField(data, field);
				const numeric =
					/^[+\-−]?(?:\d+(?:[, \u00a0\u202f]\d{3})*(?:\.\d+)?|\d+(?:\.\d{3})*(?:,\d+)?)(?:%)?$/u.test(
						htmlToPlainText(content).trim(),
					);
				const align =
					alignment === "center" || alignment === "right" || alignment === "left"
						? alignment
						: numeric
							? "end"
							: "left";
				return `<${tag}${scope}${numeric ? ' data-numeric="true"' : ""} style="text-align:${align}">${content}</${tag}>`;
			})
			.join("");
	const firstRow = `<tr>${renderCells(headers)}</tr>`;
	const bodyRows = rows
		.map((row, rowIndex) => `<tr>${renderCells(Array.isArray(row) ? row : [], rowIndex)}</tr>`)
		.join("");
	const tableRows = headerRow
		? `<thead>${firstRow}</thead><tbody>${bodyRows}</tbody>`
		: `<tbody>${firstRow}${bodyRows}</tbody>`;
	const gridlines = ["none", "rows", "columns", "inside", "all"].includes(data.gridlines ?? "")
		? data.gridlines
		: "all";
	const tableAttrs = ` class="praxity-data-table" data-gridlines="${gridlines}" data-shade-headers="${data.shadeHeaders !== false}" data-first-row-line="${data.firstRowLine !== false}" data-first-col-line="${data.firstColLine === true}" data-striped="${data.striped === true}"`;
	const titleHtml = title
		? `<p id="${escapeHtml(titleId)}" class="praxity-block-title">${title}</p>`
		: "";
	const figureCaption = caption
		? `<figcaption id="${escapeHtml(captionId)}" class="praxity-block-caption praxity-table-caption">${caption}</figcaption>`
		: "";
	return `<figure class="praxity-figure-reset praxity-table-figure">${titleHtml}${figureCaption}<div class="praxity-table-scroll-region" role="region"${tableNameAttrs} tabindex="0"><table${tableAttrs}${tableNameAttrs} style="--praxity-table-columns:${headers.length}">${tableRows}</table></div><p class="praxity-table-scroll-hint">${escapeHtml(strings.tableScrollHint)}</p></figure>`;
}

function renderDivider(): string {
	return '<hr class="praxity-divider praxity-divider-line" />';
}

function renderColumns(
	block: PraxityBlock,
	strings: RenderBlockHtmlStrings,
	enabledIslands?: ReadonlySet<IslandName>,
	hiddenBlockIds?: ReadonlySet<string>,
	sourceLocale?: string,
	selfCheckContextPending = false,
): string {
	const data = block.data as unknown as ColumnsBlockData;
	const items = Array.isArray(data.items) ? data.items : [];
	const widths = items.map((item) =>
		typeof item.width === "number" && Number.isFinite(item.width) && item.width > 0
			? item.width
			: 1,
	);
	const largestWidth = Math.max(...widths);
	const presetLabels =
		data.preset === "beforeAfter"
			? [strings.columnsPresetBefore, strings.columnsPresetAfter]
			: data.preset === "comparison"
				? [strings.columnsPresetOptionA, strings.columnsPresetOptionB]
				: [];
	const columns = items
		.map((item, index) => {
			const fallback = presetLabels[index];
			const label = renderInlineField(item, "label") || (fallback ? escapeHtml(fallback) : "");
			const header = label ? `<h3 class="praxity-column-preset-header">${label}</h3>` : "";
			const width = (widths[index] / largestWidth) * items.length;
			return `<div class="praxity-column" data-node-id="${escapeHtml(item.id || `${block.id}-column-${index}`)}" style="flex:${width} 1 0px">${header}${renderChildren(item.children ?? [], strings, enabledIslands, hiddenBlockIds, sourceLocale, selfCheckContextPending)}</div>`;
		})
		.join("");
	return `<div class="praxity-columns" data-preset="${escapeHtml(data.preset ?? "default")}">${columns}</div>`;
}

function renderCard(
	block: PraxityBlock,
	strings: RenderBlockHtmlStrings,
	enabledIslands?: ReadonlySet<IslandName>,
	hiddenBlockIds?: ReadonlySet<string>,
	sourceLocale?: string,
	selfCheckContextPending = false,
): string {
	const data = block.data as unknown as CardBlockData;
	const items = Array.isArray(data.items) ? data.items : [];
	if (items.length === 0) return "";
	const renderHeadings = data.headings !== false;
	const title = typeof data.title === "string" ? data.title.trim() : "";
	const titleLevel = normalizeHeadingLevel(data._headingLevel, 2);
	const layout =
		data.layout === "single" || data.layout === "masonry" || data.layout === "rows"
			? data.layout
			: "grid";
	const columns = Number.isFinite(data.columns) ? Math.max(1, Math.trunc(data.columns)) : 1;
	const style = ["outline", "filled", "shaded", "accent", "primary", "secondary"].includes(
		data.style,
	)
		? data.style
		: "none";
	const color = data.color === "primary" || data.color === "secondary" ? data.color : "";
	const shadow =
		data.shadow === "none" || data.shadow === "subtle" || data.shadow === "elevated"
			? data.shadow
			: "theme";
	const transition =
		data.transition === "none" || data.transition === "slide" || data.transition === "zoom"
			? data.transition
			: "fade";
	const hasAnyFlip = items.some((item) => Array.isArray(item.back) && item.back.length > 0);
	const showGroupHeading =
		renderHeadings && title && (items.length !== 1 || items[0]?.label.trim() !== title);
	const groupHeading = showGroupHeading
		? renderHeading({
				id: `${block.id}-title`,
				type: "heading",
				data: { level: titleLevel, content: `<p>${inlineMarkdown(title)}</p>` },
			})
		: "";
	const renderItem = (item: (typeof items)[number], index: number) => {
		const label = renderInlineField(item, "label");
		const headingLevel =
			typeof item.headingLevel === "number"
				? Math.min(6, Math.max(2, Math.trunc(item.headingLevel)))
				: 3;
		const headerClass =
			style === "none" ? "praxity-card-header--minimal" : "praxity-card-header--outline";
		const labelHtml = label
			? renderHeadings
				? `<h${headingLevel} class="${headerClass}">${label}</h${headingLevel}>`
				: `<div class="praxity-card-label ${headerClass}">${label}</div>`
			: "";
		const children = item.front ?? [];
		const leadImage =
			(data.media === "inset" || data.media === "flush") && children[0]?.type === "image"
				? children[0]
				: undefined;
		const media = leadImage
			? `<div class="praxity-card-media" data-media="${data.media}">${renderChildren([leadImage], strings, enabledIslands, hiddenBlockIds, sourceLocale, selfCheckContextPending)}</div>`
			: "";
		const front = renderChildren(
			leadImage ? children.slice(1) : children,
			strings,
			enabledIslands,
			hiddenBlockIds,
			sourceLocale,
			selfCheckContextPending,
		);
		const back =
			item.back && item.back.length > 0
				? renderChildren(
						item.back,
						strings,
						enabledIslands,
						hiddenBlockIds,
						sourceLocale,
						selfCheckContextPending,
					)
				: "";
		const alignment =
			(item as { alignment?: unknown }).alignment === "center" ||
			(item as { alignment?: unknown }).alignment === "right"
				? String((item as { alignment?: unknown }).alignment)
				: "left";
		const itemId = item.id || `${block.id}-item-${index}`;
		const classes = `praxity-card praxity-card-item${layout === "masonry" ? " praxity-card-masonry" : ""}`;
		if (!back) {
			return `<article class="${classes}" data-card-item data-card-index="${index}" data-card-id="${escapeHtml(itemId)}" data-node-id="${escapeHtml(itemId)}" data-entrance="visible" data-flippable="false" style="--i:${index};--praxity-stagger-index:${index};text-align:${alignment}">${media}${labelHtml}<div class="${style === "none" ? "praxity-card-body--minimal" : "praxity-card-body--outline"}">${front}</div></article>`;
		}
		const faceHeading = label
			? renderHeadings
				? `<h${headingLevel} class="praxity-flashcard-face-heading">${label}</h${headingLevel}>`
				: `<div class="praxity-flashcard-face-heading">${label}</div>`
			: "";
		const answerId = `${block.id}-answer-${itemId}`;
		return `<article class="${classes}" data-card-item data-card-index="${index}" data-card-id="${escapeHtml(itemId)}" data-node-id="${escapeHtml(itemId)}" data-entrance="visible" data-flippable="true" data-flipped="false" style="--i:${index};--praxity-stagger-index:${index}">${media}${faceHeading}<div class="praxity-flashcard-inner" data-flipped="false" style="text-align:${alignment}"><div class="praxity-flashcard-face" data-card-side="front" data-node-id="${escapeHtml(itemId)}">${front}</div><button type="button" class="praxity-flashcard-toggle" data-card-flip hidden aria-expanded="true" aria-controls="${escapeHtml(answerId)}">${escapeHtml(strings.backToFront)}</button><div id="${escapeHtml(answerId)}" class="praxity-flashcard-face praxity-flashcard-face--back" data-card-side="back" data-node-id="${escapeHtml((item as typeof item & { backId?: string }).backId || itemId)}">${back}</div></div></article>`;
	};
	const cards = items.map(renderItem).join("");
	const colorAttr = color ? ` data-color="${color}"` : "";
	if (layout !== "single") {
		const wrapperStyle =
			layout === "rows"
				? "display:grid;grid-template-columns:minmax(0,1fr);gap:0"
				: layout === "grid"
					? `display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:16px`
					: `columns:${columns};column-gap:16px`;
		return `${groupHeading}<div class="praxity-cards praxity-card-island" data-card-root data-block-id="${escapeHtml(block.id)}" data-node-id="${escapeHtml(block.id)}" data-layout="${layout}" data-columns="${columns}" data-style="${style}" data-shadow="${shadow}"${colorAttr} data-shuffle="${data.shuffle === true}" style="${wrapperStyle}">${cards}</div>`;
	}
	const slides = items
		.map(
			(item, index) =>
				`<div class="praxity-slides-item${item.back?.length ? " praxity-slides-item--flippable" : ""}" data-slide-index="${index}" data-narration-reveal="${index}" data-slide-position="${index === 0 ? "active" : "after"}" data-active="${index === 0}">${renderItem(item, index)}</div>`,
		)
		.join("");
	const dots =
		data.showProgress === false
			? ""
			: `<div class="praxity-card-progress" role="group" aria-label="${escapeHtml(strings.chooseSlide)}">${items
					.map(
						(_, index) =>
							`<button type="button" data-card-goto="${index}" aria-label="${escapeHtml(formatTemplate(strings.goToSlide, { index: index + 1 }))}"${index === 0 ? ' aria-current="step"' : ""} class="praxity-slides-dot"></button>`,
					)
					.join("")}</div>`;
	const previousLabel = hasAnyFlip ? strings.previousCard : strings.previousSlide;
	const nextLabel = hasAnyFlip ? strings.nextCard : strings.nextSlide;
	return `${groupHeading}<section class="praxity-card-island" data-card-root data-block-id="${escapeHtml(block.id)}" data-node-id="${escapeHtml(block.id)}" data-layout="single" data-style="${style}" data-shadow="${shadow}"${colorAttr} data-shuffle="${data.shuffle === true}" data-track-completion="${data.trackCompletion === true}" data-advance="${Number.isFinite(data.advance) ? Math.max(0, data.advance) : 0}" aria-roledescription="carousel" aria-label="${escapeHtml(hasAnyFlip ? strings.flashcardInteraction : strings.slidesLabel)}" tabindex="0"><div class="praxity-slides-grid" data-style="${style}"${colorAttr} data-transition="${transition}">${slides}</div><div class="praxity-card-controls"><button type="button" data-card-previous disabled aria-label="${escapeHtml(previousLabel)}"><span aria-hidden="true">&#8249;</span></button>${dots}<span class="praxity-text-dimmed" data-card-counter>1 / ${items.length}</span><button type="button" data-card-next${items.length === 1 ? " disabled" : ""} aria-label="${escapeHtml(nextLabel)}"><span aria-hidden="true">&#8250;</span></button></div></section>`;
}

function parseSequenceNumber(label: string): number | null {
	const value = Number(label.replace(/[,$€£¥₹%]/g, "").trim());
	return Number.isFinite(value) ? value : null;
}

function sequenceScaledPositions(labels: string[]): number[] | null {
	if (labels.length < 2) return null;
	const numbers = labels.map(parseSequenceNumber);
	const values = numbers.every((value) => value !== null)
		? (numbers as number[])
		: labels.map((label) => Date.parse(label));
	if (values.some((value) => !Number.isFinite(value))) return null;
	const min = Math.min(...values);
	const max = Math.max(...values);
	return max === min ? null : values.map((value) => (value - min) / (max - min));
}

function renderSequence(
	block: PraxityBlock,
	strings: RenderBlockHtmlStrings,
	enabledIslands?: ReadonlySet<IslandName>,
	hiddenBlockIds?: ReadonlySet<string>,
	sourceLocale?: string,
	selfCheckContextPending = false,
): string {
	const data = block.data as unknown as SequenceContainerData;
	const items = Array.isArray(data.items) ? data.items : [];
	if (items.length === 0) {
		return `<p class="praxity-sequence-empty praxity-text-light">${escapeHtml(strings.sequenceEmpty)}</p>`;
	}

	const variant =
		data.variant === "timeline" || data.variant === "plain" ? data.variant : "numbered";
	const orientation = data.orientation === "horizontal" ? "horizontal" : "vertical";
	const alignment =
		data.alignment === "center" || data.alignment === "right" ? data.alignment : "left";
	const authoredDistribution = data.distribution === "scaled" ? "scaled" : "uniform";
	const plainLabels = items.map((item) => htmlToPlainText(renderInlineField(item, "label")));
	const scaledPositions =
		authoredDistribution === "scaled" && variant !== "plain"
			? sequenceScaledPositions(plainLabels)
			: null;
	const distribution = scaledPositions ? "scaled" : "uniform";
	const scrollable = orientation === "horizontal" && data.scrollable === true;
	const firstLabel = plainLabels[0];
	const lastLabel = plainLabels.at(-1);
	const sequenceName =
		variant === "timeline"
			? strings.sequenceTimelineLabel
			: variant === "numbered"
				? strings.sequenceStepsLabel
				: strings.sequenceLabel;
	const groupLabel =
		items.length >= 2 && firstLabel && lastLabel
			? `${sequenceName}: ${firstLabel} – ${lastLabel}`
			: sequenceName;
	const labelBelow = items.map(() => true);
	if (orientation === "horizontal" && scaledPositions) {
		for (let index = 1; index < scaledPositions.length; index++) {
			if (scaledPositions[index] - scaledPositions[index - 1] < 0.2) {
				labelBelow[index] = !labelBelow[index - 1];
			}
		}
	}

	const listItems = items
		.map((item, index) => {
			const label = renderInlineField(item, "label");
			const marker =
				variant === "numbered" || variant === "timeline"
					? `<span class="praxity-sequence-marker" aria-hidden="true"><span class="praxity-accent-badge">${index + 1}</span></span>`
					: "";
			const style: string[] = [`--praxity-sequence-index:${index}`];
			if (scaledPositions) {
				const position = scaledPositions[index];
				style.push(`--praxity-sequence-position:${position}`);
				style.push(`--praxity-sequence-column:${Math.round(position * 100) + 1}`);
				if (index > 0) {
					style.push(
						`--praxity-sequence-gap-before:${Math.max(0, position - scaledPositions[index - 1]) * 400}px`,
					);
				}
				if (index < scaledPositions.length - 1) {
					style.push(
						`--praxity-sequence-gap-after:${Math.max(0, scaledPositions[index + 1] - position) * 400}px`,
					);
				}
			}
			return `<li data-node-id="${escapeHtml(item.id || `${block.id}-sequence-${index}`)}" class="praxity-sequence-item"${scaledPositions ? ` data-label-position="${labelBelow[index] ? "below" : "above"}"` : ""} style="${style.join(";")}">${marker}<div class="praxity-sequence-content">${label ? `<div class="praxity-sequence-label">${label}</div>` : ""}${renderChildren(item.children ?? [], strings, enabledIslands, hiddenBlockIds, sourceLocale, selfCheckContextPending)}</div></li>`;
		})
		.join("");
	const list = `<ol class="praxity-sequence" data-variant="${variant}" data-orientation="${orientation}" data-alignment="${alignment}" data-distribution="${distribution}" style="--praxity-sequence-count:${items.length}" aria-label="${escapeHtml(groupLabel)}">${listItems}</ol>`;
	const frameClass = "praxity-sequence-frame";
	const scrollControls = enabledIslands?.has("sequence")
		? `<button type="button" class="praxity-sequence-scroll-button praxity-sequence-scroll-button--start" data-sequence-scroll="start" aria-disabled="true" aria-label="${escapeHtml(strings.sequenceScrollPrevious)}" hidden><span aria-hidden="true">&#8249;</span></button><button type="button" class="praxity-sequence-scroll-button praxity-sequence-scroll-button--end" data-sequence-scroll="end" aria-disabled="true" aria-label="${escapeHtml(strings.sequenceScrollNext)}" hidden><span aria-hidden="true">&#8250;</span></button>`
		: "";
	return scrollable
		? `<div class="${frameClass} praxity-sequence-scroll-region" data-overflow="none"><div class="praxity-sequence-scroll-viewport" role="group" aria-label="${escapeHtml(strings.sequenceScrollRegion)}" tabindex="0">${list}</div>${scrollControls}</div>`
		: `<div class="${frameClass}">${list}</div>`;
}

function renderDocument(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as {
		url?: string;
		title?: string;
		description?: string;
		filename?: string;
	};
	const url = typeof data?.url === "string" ? data.url : "";
	if (!url) return "";
	const title =
		sanitizeInline(data?.title, false) || sanitizeInline(data?.filename, false) || "Document";
	const description = sanitizeInline(data?.description);
	const external = isHttpsUrl(url);
	return `<p class="praxity-document"><a href="${escapeHtml(url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ` download${data.filename ? `="${escapeHtml(data.filename)}"` : ""}`}>${title}${external ? externalLinkIndicatorHtml(strings.opensInNewTab) : ""}</a>${description ? ` — ${description}` : ""}</p>`;
}

function renderResourceEntry(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as unknown as ResourceEntryData;
	if (!data.includeInResourcesPage) return "";
	const rawHref =
		data.resourceType === "link"
			? data.url
			: data.assetId
				? `/api/assets/${encodeURIComponent(data.assetId)}/download`
				: undefined;
	const href = rawHref ? sanitizeHref(rawHref) : "";
	const title = renderInlineField(data, "title");
	const accessibleTitle = htmlToPlainText(title);
	const description = sanitizeInline(data.description);
	const fileLabel = href
		? (getFileTypeLabel(href) ?? getFileTypeLabelFromMime(data.mimeType))
		: getFileTypeLabelFromMime(data.mimeType);
	const isLink = data.resourceType === "link";
	const action = isLink ? strings.resourceOpenLink : strings.documentDownload;
	return `<div class="praxity-resource-entry"><div class="praxity-resource-content"><span class="praxity-resource-title">${title}</span>${description ? `<span class="praxity-resource-description">${description}</span>` : ""}</div>${href ? `<a href="${escapeHtml(href)}" class="praxity-resource-action"${isLink ? ' target="_blank" rel="noopener noreferrer"' : data.resourceType === "file" ? ` download="${escapeHtml(data.title)}"` : ""}>${escapeHtml(action)}${fileLabel ? ` (${escapeHtml(fileLabel)})` : ""}${accessibleTitle ? `<span class="praxity-sr-only">: ${accessibleTitle}</span>` : ""}${isLink ? externalLinkIndicatorHtml(strings.opensInNewTab) : ""}</a>` : ""}</div>`;
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function renderAccordion(
	block: PraxityBlock,
	strings: RenderBlockHtmlStrings,
	enabledIslands?: ReadonlySet<IslandName>,
	hiddenBlockIds?: ReadonlySet<string>,
	sourceLocale?: string,
	selfCheckContextPending = false,
): string {
	const data = block.data as {
		items?: Array<{ id?: string; label?: string; children?: PraxityBlock[] }>;
		allowMultipleOpen?: boolean;
		accordionStyle?:
			| "default"
			| "contained"
			| "separated"
			| "none"
			| "outline"
			| "shaded"
			| "primary"
			| "secondary";
		headingLevel?: number;
		headingOffset?: number;
	};
	const items = Array.isArray(data.items) ? data.items : [];
	if (items.length === 0) return "";
	const multiple = data.allowMultipleOpen === true;
	const panelsAreRegions = items.length <= 6;
	const headingLevel = Math.min(
		6,
		Math.max(
			2,
			normalizeHeadingLevel(data.headingLevel, 3) +
				Math.max(0, Math.trunc(Number(data.headingOffset ?? 0)) || 0),
		),
	);
	const style = [
		"contained",
		"separated",
		"none",
		"outline",
		"shaded",
		"primary",
		"secondary",
	].includes(data.accordionStyle ?? "")
		? data.accordionStyle
		: "default";
	const content = items
		.map((item, index) => {
			const itemId = item.id || `item-${index}`;
			const summaryId = `${block.id}-summary-${itemId}`;
			const panelId = `${block.id}-panel-${itemId}`;
			const label =
				renderInlineField(item, "label", false) ||
				formatIndexedLabel(strings.sectionLabel || DEFAULT_RENDER_STRINGS.sectionLabel, index + 1);
			return `<div data-accordion-item data-item-id="${escapeHtml(itemId)}" data-node-id="${escapeHtml(itemId)}" data-narration-reveal="${escapeHtml(itemId)}">${renderDisclosureHeading(label, summaryId, panelId, headingLevel, true)}<div id="${escapeHtml(panelId)}" class="praxity-accordion-panel" data-disclosure-panel role="${panelsAreRegions ? "region" : "group"}" aria-labelledby="${escapeHtml(`${summaryId}-label`)}" data-narration-reveal="${escapeHtml(itemId)}">${renderChildren(item.children ?? [], strings, enabledIslands, hiddenBlockIds, sourceLocale, selfCheckContextPending)}</div></div>`;
		})
		.join("");
	return `<div class="praxity-accordion-static" data-multiple="${multiple}" data-style="${style}">${items.length >= 3 ? `<button type="button" class="praxity-accordion-show-all" data-accordion-show-all hidden>${escapeHtml(strings.showAll)}</button>` : ""}${content}</div>`;
}

function renderTabs(
	block: PraxityBlock,
	strings: RenderBlockHtmlStrings,
	enabledIslands?: ReadonlySet<IslandName>,
	hiddenBlockIds?: ReadonlySet<string>,
	sourceLocale?: string,
	selfCheckContextPending = false,
): string {
	const data = block.data as {
		items?: Array<{ id?: string; label?: string; children?: PraxityBlock[] }>;
		variant?: "default" | "outline" | "pills";
		orientation?: "horizontal" | "vertical";
	};
	const items = Array.isArray(data.items) ? data.items : [];
	if (items.length === 0) return "";
	const orientation = "horizontal";
	const variant = data.variant === "outline" || data.variant === "pills" ? data.variant : "default";
	const tabs = items
		.map((item, index) => {
			const itemId = item.id || `tab-${index + 1}`;
			const label =
				renderInlineField(item, "label", false) ||
				formatIndexedLabel(strings.tabLabel || DEFAULT_RENDER_STRINGS.tabLabel, index + 1);
			return `<button type="button" class="praxity-tabs-tab" role="tab" id="${escapeHtml(`${block.id}-tab-${itemId}`)}" aria-controls="${escapeHtml(`${block.id}-panel-${itemId}`)}" aria-selected="${index === 0 ? "true" : "false"}" tabindex="${index === 0 ? "0" : "-1"}" data-tab-id="${escapeHtml(itemId)}" data-node-id="${escapeHtml(itemId)}" data-narration-reveal="${escapeHtml(itemId)}"><span class="praxity-disclosure-title">${label}</span>${renderDisclosureChevron()}</button>`;
		})
		.join("");
	const panels = items
		.map((item, index) => {
			const itemId = item.id || `tab-${index + 1}`;
			return `<div class="praxity-tabs-panel" data-node-id="${escapeHtml(itemId)}" role="tabpanel" id="${escapeHtml(`${block.id}-panel-${itemId}`)}" aria-labelledby="${escapeHtml(`${block.id}-tab-${itemId}`)}" tabindex="0" data-narration-reveal="${escapeHtml(itemId)}"${index === 0 ? "" : " hidden"}>${renderChildren(item.children ?? [], strings, enabledIslands, hiddenBlockIds, sourceLocale, selfCheckContextPending)}</div>`;
		})
		.join("");
	return `<div class="praxity-tabs-static" data-orientation="${orientation}" data-variant="${variant}"><div class="praxity-tabs-list" role="tablist" aria-label="${escapeHtml(strings.tabbedContentSections)}" aria-orientation="${orientation}">${tabs}</div>${panels}</div>`;
}

function extractAssessmentQuestion(
	stem: PraxityBlock[],
	strings: RenderBlockHtmlStrings,
	fallback = strings.questionLabel || DEFAULT_RENDER_STRINGS.questionLabel,
): string {
	for (const block of stem) {
		if (block.type === "text" || block.type === "heading") {
			const value = block.data as Record<string, unknown>;
			const candidate = sanitizeInline(value.content);
			if (candidate) return htmlToPlainText(candidate);
		}
	}
	return fallback;
}

/** Author-supplied supporting prose, rendered for the no-JS fallback. */
function renderAssessmentDescription(
	blockId: string,
	description: PraxityBlock[] | undefined,
): { html: string; describedBy: string } {
	const parts = (description ?? [])
		.map((child) => {
			const content = sanitizeInline((child.data as Record<string, unknown> | undefined)?.content);
			return content ? `<div data-node-id="${escapeHtml(child.id)}">${content}</div>` : "";
		})
		.filter(Boolean);
	if (parts.length === 0) return { html: "", describedBy: "" };
	const id = `${blockId}-description`;
	return {
		html: `<div id="${escapeHtml(id)}" class="praxity-assessment-description">${parts.join("")}</div>`,
		describedBy: ` aria-describedby="${escapeHtml(id)}"`,
	};
}

function renderSelfCheck(
	block: PraxityBlock,
	strings: RenderBlockHtmlStrings,
	locale: string,
	blockIndex: number,
	contextPending: boolean,
): string {
	const prompt = constructSelfCheckPromptBlock(block);
	const prefix = `${block.id}-${blockIndex}-self-check`;
	const header = renderSceneHeader({
		icon: "clipboard-check",
		headingLevel: normalizeHeadingLevel(prompt.data.level, 2),
		titleHtml: escapeHtml(prompt.data.content.task),
		headingAttributes: ` id="${escapeHtml(prefix)}-task" class="praxity-assessment-stem"`,
	});
	const controls = [
		["check", strings.selfCheckCheck],
		["show-feedback", strings.selfCheckShowFeedback],
		["start-over", strings.selfCheckStartOver],
	]
		.map(
			([action, label]) =>
				`<button type="button" id="${escapeHtml(prefix)}-${action}" class="${action === "start-over" ? "praxity-btn" : "praxity-ag-submit-btn"}" data-praxity-js-control data-self-check-action="${action}">${escapeHtml(label)}</button>`,
		)
		.join("");
	// Empty targets preserve criterion source identity without publishing authored content.
	const parts = prompt.data.content.parts
		.map(
			(part, index) =>
				`<div id="${escapeHtml(prefix)}-part-${index}" data-node-id="${escapeHtml(part.id)}"></div>`,
		)
		.join("");
	return `<div class="praxity-self-check" data-self-check${contextPending ? " data-self-check-context-pending" : ""} data-self-check-incomplete="${escapeHtml(getSelfCheckCompletionStrings(locale).selfCheckIncomplete)}" data-self-check-id="${escapeHtml(block.id)}" lang="${escapeHtml(locale)}">${header}<div class="praxity-self-check-response"><label for="${escapeHtml(prefix)}-answer">${escapeHtml(strings.selfCheckAnswer)}</label><textarea id="${escapeHtml(prefix)}-answer" class="praxity-assessment-text-input" rows="5" aria-describedby="${escapeHtml(prefix)}-notice"></textarea><p id="${escapeHtml(prefix)}-answer-error" class="praxity-self-check-error" data-self-check-error hidden>${escapeHtml(selfCheckPatternStrings[resolveLocale(locale)].empty)}</p></div><p id="${escapeHtml(prefix)}-notice" class="praxity-assessment-needs-script" data-self-check-notice>${escapeHtml(strings.selfCheckNeedsScript)}</p><div class="praxity-assessment-actions">${controls}</div><div data-self-check-parts>${parts}</div><div id="${escapeHtml(prefix)}-status" role="status" aria-atomic="true" data-self-check-status></div></div>`;
}

function renderAssessment(
	block: PraxityBlock,
	strings: RenderBlockHtmlStrings,
	sourceLocale = "en",
): string {
	const data = block.data as unknown as AssessmentBlockData;
	const questionText = extractAssessmentQuestion(
		data.stem ?? [],
		strings,
		data.assessmentType === "hotspot" ? "" : undefined,
	);
	const firstStem = (data.stem ?? []).find(
		(child) => child.type === "text" || child.type === "heading",
	);
	const stemContent = splitHeadingContent(
		firstStem ? sanitizeInline(firstStem.data.content) : escapeHtml(questionText),
	);
	const question =
		stemContent.heading ||
		(data.assessmentType === "hotspot" ? "" : escapeHtml(strings.questionLabel));
	const gradingMode = data.gradingMode ?? (data.graded ? "exact" : "none");
	const isGraded = gradingMode !== "none";
	const required = data.required === true || (data.required !== false && isGraded);
	const points =
		typeof data.points === "number" && Number.isFinite(data.points) ? data.points : null;
	const requiredMarkup = required
		? `<span class="praxity-required-indicator"><span aria-hidden="true" class="praxity-required-marker"></span><span class="praxity-sr-only">${escapeHtml(strings.required)}</span></span>`
		: "";
	const pointsMarkup =
		isGraded && points !== null
			? `<span class="praxity-assessment-points">${escapeHtml(assessmentPointsLabel(points, sourceLocale, strings))}</span>`
			: "";
	const headingId = `assessment-question-${block.id}`;
	const headingAttributes = ` id="${escapeHtml(headingId)}" class="praxity-assessment-stem"`;
	const titleHtml = `<span class="praxity-assessment-stem-content">${question}</span>${requiredMarkup}`;
	const bodyHtml = `${stemContent.body ? `<div class="praxity-assessment-stem-body">${stemContent.body}</div>` : ""}${pointsMarkup}`;
	const header = isJournal(data)
		? renderSceneHeader({
				icon: "notebook",
				headingLevel: "p",
				titleHtml,
				headingAttributes,
				bodyHtml,
			})
		: `<div class="praxity-assessment-question-header"><p${headingAttributes}>${titleHtml}</p>${bodyHtml}</div>`;
	if (!data.response || typeof data.response !== "object") {
		return `<p class="praxity-assessment-stem">${question}</p>${stemContent.body}`;
	}
	if (data.assessmentType === "fillBlank" && data.response.type === "fillBlank") {
		const blanks = Array.isArray(data.response.blanks)
			? data.response.blanks.filter(
					(blank) => blank && typeof blank === "object" && typeof blank.id === "string",
				)
			: [];
		const template = typeof data.response.template === "string" ? data.response.template : "";
		const description = renderAssessmentDescription(block.id, data.description);
		if (blanks.length === 0 || !template) {
			return `<p class="praxity-assessment-stem">${question}</p>${stemContent.body}${description.html}`;
		}
		const parts = fillBlankParts(template);
		let blankIndex = 0;
		let precedingText = "";
		const renderInput = (blank: (typeof blanks)[number], index: number) => {
			const context =
				precedingText
					.split(/[.!?;]\s*/)
					.at(-1)
					?.trim()
					.split(/\s+/)
					.slice(-10)
					.join(" ") || questionText;
			const label = strings.assessmentBlankLabel
				.replace("{current}", String(index + 1))
				.replace("{total}", String(blanks.length))
				.replace("{context}", context);
			const choices = fillBlankChoices(data.response as FillBlankResponse, blank);
			if (choices)
				return `<select data-node-id="${escapeHtml(blank.id)}" class="praxity-fill-blank-input" aria-label="${escapeHtml(label)}"${description.describedBy} disabled><option value="">${escapeHtml((data.response.type === "fillBlank" && data.response.placeholder) || strings.selectAnAnswer)}</option>${[...new Set(choices)].map((choice) => `<option>${escapeHtml(choice)}</option>`).join("")}</select>`;
			const size = Math.max(
				8,
				Math.min(32, typeof blank.answer === "string" ? blank.answer.length || 12 : 12),
			);
			return `<input data-node-id="${escapeHtml(blank.id)}" class="praxity-fill-blank-input" type="text" size="${size}" aria-label="${escapeHtml(label)}"${description.describedBy} disabled />`;
		};
		const content = parts
			.map((segment, partIndex) => {
				const part = decodeEscapes(segment.text);
				const isBlank = segment.blank;
				if (isBlank) {
					if (partIndex > 0 && !parts[partIndex - 1].blank) return "";
					const blank = blanks[blankIndex];
					const index = blankIndex++;
					return blank ? renderInput(blank, index) : escapeHtml(part);
				}
				precedingText += part;
				if (!parts[partIndex + 1]?.blank) {
					return escapeHtml(part);
				}
				const blank = blanks[blankIndex];
				const index = blankIndex++;
				if (!blank) return escapeHtml(part);
				const trailingWord = part.match(/^(.*?)(\S+\s*)$/s);
				if (!trailingWord) return `${escapeHtml(part)}${renderInput(blank, index)}`;
				return `${escapeHtml(trailingWord[1])}<span class="praxity-fill-blank-unit">${escapeHtml(trailingWord[2])}${renderInput(blank, index)}</span>`;
			})
			.join("");
		const bank =
			data.response.style === "word-bank"
				? `<p class="praxity-word-bank">${escapeHtml(strings.assessmentWordBank.replace("{words}", (fillBlankChoices(data.response, blanks[0]) ?? []).join(", ")))}</p>`
				: "";
		const needsScript = escapeHtml(
			strings.assessmentNeedsScript || DEFAULT_RENDER_STRINGS.assessmentNeedsScript,
		);
		return `<form class="praxity-block-assessment praxity-assessment-baseline">${header}${description.html}<fieldset class="praxity-fieldset-reset" aria-labelledby="${escapeHtml(headingId)}"${description.describedBy}><div class="praxity-fill-blank-template">${bank}${content}</div><noscript><p class="praxity-assessment-needs-script">${needsScript}</p></noscript></fieldset></form>`;
	}
	if (
		["matching", "sequence", "textResponse", "hotspot", "categorize", "matrix"].includes(
			data.response.type,
		)
	) {
		const response = data.response;
		const description = renderAssessmentDescription(block.id, data.description);
		let controls = "";
		if (response.type === "textResponse") {
			const placeholder = escapeHtml(response.placeholder || strings.typeYourAnswer);
			controls =
				response.inputType === "long"
					? `<textarea class="praxity-assessment-text-input" rows="3" aria-label="${escapeHtml(questionText)}" placeholder="${placeholder}"${description.describedBy} disabled></textarea>`
					: `<input class="praxity-assessment-text-input" type="${response.inputType === "numeric" ? "number" : "text"}" aria-label="${escapeHtml(questionText)}" placeholder="${placeholder}"${description.describedBy} disabled />`;
		} else if (response.type === "hotspot") {
			const image = sanitizeUrl(typeof response.image === "string" ? response.image : "");
			const hotspots = Array.isArray(response.hotspots) ? response.hotspots : [];
			controls = `<div role="group" class="praxity-hotspot-scroll" aria-label="${escapeHtml(interpolate(strings.hotspotSelectionPrompt, { total: hotspots.length }))}" tabindex="0"><div class="praxity-hotspot-image" style="position:relative;display:inline-block;max-width:100%">${image && image !== "#" ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(response.imageAlt ?? "")}" style="display:block;max-width:100%" />` : ""}${hotspots
				.map((spot, index) => {
					const shape = spot.shape ?? "ellipse";
					const geometry = hotspotGeometry(shape, spot.coords);
					if (!geometry) return "";
					const label = spot.label || formatIndexedLabel(strings.hotspotLabel, index + 1);
					const left = geometry.point ? geometry.left + geometry.width / 2 : geometry.left;
					const top = geometry.point ? geometry.top + geometry.height / 2 : geometry.top;
					return `<span class="praxity-hotspot-region" data-node-id="${escapeHtml(spot.id)}" data-shape="${shape}"${geometry.point ? ' data-point="true"' : ""} style="position:absolute;left:${left}%;top:${top}%;width:${geometry.point ? "var(--target-size)" : `${geometry.width}%`};height:${geometry.point ? "var(--target-size)" : `${geometry.height}%`};${geometry.point ? "transform:translate(-50%,-50%);" : ""}"><button type="button" aria-label="${escapeHtml(htmlToPlainText(sanitizeInline(label)))}" aria-pressed="false" style="border-radius:${shape === "ellipse" ? "var(--radius-mark)" : "0"};${geometry.clipPath ? `clip-path:${geometry.clipPath};` : ""}" disabled></button><span aria-hidden="true">${index + 1}</span></span>`;
				})
				.join("")}</div></div>`;
		} else if (response.type === "categorize" || response.type === "matrix") {
			const categories =
				response.type === "categorize" && Array.isArray(response.categories)
					? response.categories
					: [];
			const columns =
				response.type === "matrix"
					? (Array.isArray(response.scalePoints) ? response.scalePoints : []).map(
							(point) => point.label,
						)
					: categories.map((category) => category.name);
			const rows =
				response.type === "matrix"
					? (Array.isArray(response.statements) ? response.statements : []).map((statement) => ({
							id: statement.id,
							label: statement.text,
						}))
					: categories.flatMap((category) =>
							category.items.map((label, index) => ({
								id:
									(category as { itemIds?: string[] }).itemIds?.[index] ||
									`${category.id}-item-${index}`,
								label,
							})),
						);
			const inputType =
				response.type === "matrix" && response.selectionMode === "multiple" ? "checkbox" : "radio";
			const family = response.type === "matrix" ? "matrix" : "categorize";
			const firstHeading =
				response.type === "matrix"
					? ""
					: `<span class="praxity-sr-only">${escapeHtml(strings.categorizeItemsColumn)}</span>`;
			const colgroup =
				response.type === "matrix"
					? `<colgroup><col class="praxity-matrix-statement-column" />${columns.map(() => "<col />").join("")}</colgroup>`
					: "";
			const headings = columns
				.map((label, index) => {
					const category = categories[index];
					const image = category?.image ? sanitizeUrl(category.image) : "";
					const content =
						response.type === "categorize"
							? `<div class="praxity-categorize-category-header">${image && image !== "#" ? `<img class="praxity-categorize-category-image" src="${escapeHtml(image)}" alt="${escapeHtml(category.imageAlt ?? "")}" />` : ""}<span>${sanitizeInline(label)}</span></div>`
							: sanitizeInline(label);
					const nodeId =
						response.type === "matrix" ? response.scalePoints?.[index]?.id : category?.id;
					return `<th scope="col"${nodeId ? ` data-node-id="${escapeHtml(nodeId)}"` : ""}>${content}</th>`;
				})
				.join("");
			const controlTag = response.type === "categorize" ? "label" : "div";
			controls = `<div class="praxity-${family}-table-wrap"><table class="praxity-${family}-table"${response.type === "matrix" ? ` style="--praxity-matrix-min-width:${14 + columns.length * 7.5}rem"` : ""}>${colgroup}<thead><tr><th scope="col"${response.type === "categorize" ? ' class="praxity-categorize-item-heading"' : ""}>${firstHeading}</th>${headings}</tr></thead><tbody>${rows.map((row, rowIndex) => `<tr data-node-id="${escapeHtml(row.id)}"><th scope="row">${sanitizeInline(row.label)}</th>${columns.map((column, columnIndex) => `<td data-category="${escapeHtml(htmlToPlainText(sanitizeInline(column)))}"><${controlTag} class="praxity-assessment-table-control"><input type="${inputType}" name="${escapeHtml(block.id)}-row-${rowIndex}" value="${columnIndex}" aria-label="${escapeHtml(htmlToPlainText(sanitizeInline(row.label)))}: ${escapeHtml(htmlToPlainText(sanitizeInline(column)))}"${description.describedBy} disabled /></${controlTag}></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
		} else if (response.type === "matching") {
			const pairs = Array.isArray(response.pairs) ? response.pairs : [];
			const choices = [
				...new Set([...pairs.map((pair) => pair.correctMatch), ...(response.distractors ?? [])]),
			]
				.map((label) => {
					const pair = pairs.find((pair) => pair.correctMatch === label);
					const matchId = (pair as { matchId?: string } | undefined)?.matchId;
					return `<option${matchId ? ` data-node-id="${escapeHtml(matchId)}"` : ""}>${escapeHtml(htmlToPlainText(sanitizeInline(label)))}</option>`;
				})
				.join("");
			controls = `<div class="praxity-matching-grid">${pairs
				.map((pair, index) => {
					const id = `${block.id}-match-${index}`;
					return `<div class="praxity-matching-row" data-node-id="${escapeHtml(pair.id)}"><label class="praxity-matching-prompt" for="${escapeHtml(id)}">${sanitizeInline(pair.prompt)}</label><div class="praxity-matching-control"><span class="praxity-matching-value" aria-hidden="true">${escapeHtml(response.placeholder || strings.selectAMatch)}</span><div class="praxity-matching-select"><select id="${escapeHtml(id)}" class="praxity-assessment-select-input"${description.describedBy} disabled><option value="">${escapeHtml(response.placeholder || strings.selectAMatch)}</option>${choices}</select></div></div></div>`;
				})
				.join("")}</div>`;
		} else if (response.type === "sequence") {
			const items = Array.isArray(response.items) ? response.items : [];
			controls = `<ol class="praxity-order-baseline">${items
				.map((item, index) => {
					const label = escapeHtml(htmlToPlainText(sanitizeInline(item.label)));
					const up =
						index > 0
							? `<button type="button" aria-label="${escapeHtml(strings.moveUp).replace("{label}", label)}" disabled>↑</button>`
							: '<span aria-hidden="true"></span>';
					const down =
						index < items.length - 1
							? `<button type="button" aria-label="${escapeHtml(strings.moveDown).replace("{label}", label)}" disabled>↓</button>`
							: '<span aria-hidden="true"></span>';
					return `<li class="praxity-order-item" data-node-id="${escapeHtml(item.id)}"><span class="praxity-order-position" aria-hidden="true">${index + 1}</span><span class="praxity-order-label">${sanitizeInline(item.label)}</span><div class="praxity-order-controls">${up}${down}</div></li>`;
				})
				.join("")}</ol>`;
		}
		// Legacy hotspots can lack a question; keep their authored image description as the group name.
		const groupLabel =
			response.type === "hotspot" && !question
				? `aria-label="${escapeHtml(typeof response.imageAlt === "string" ? response.imageAlt : "")}"`
				: `aria-labelledby="${escapeHtml(headingId)}"`;
		return `<form class="praxity-block-assessment praxity-assessment-baseline">${header}${description.html}<fieldset class="praxity-fieldset-reset" ${groupLabel}${description.describedBy}>${controls}<noscript><p class="praxity-assessment-needs-script">${escapeHtml(strings.assessmentNeedsScript)}</p></noscript></fieldset><div data-assessment-feedback></div></form>`;
	}
	if (data.assessmentType !== "choice" || data.response.type !== "choice") return "";
	const description = renderAssessmentDescription(block.id, data.description);
	return renderChoice(block, {
		locale: sourceLocale,
		header,
		descriptionHtml: description.html,
		describedBy: description.describedBy,
		headingId: escapeHtml(headingId),
		required,
		dontKnowLabel: strings.dontKnow,
		// One extra slot: an empty uncertainty label falls back to the next indexed label.
		fallbackLabels: Array.from({ length: (data.response.options ?? []).length + 1 }, (_, index) =>
			formatIndexedLabel(strings.optionLabel || DEFAULT_RENDER_STRINGS.optionLabel, index + 1),
		),
		needsScript: escapeHtml(
			strings.assessmentNeedsScript || DEFAULT_RENDER_STRINGS.assessmentNeedsScript,
		),
	});
}

function renderAssessmentGroup(
	block: PraxityBlock,
	strings: RenderBlockHtmlStrings,
	members?: PraxityBlock[],
	sourceLocale = "en",
): string {
	const data =
		block.data && typeof block.data === "object"
			? (block.data as unknown as AssessmentGroupBlockData)
			: ({} as AssessmentGroupBlockData);
	const count = Array.isArray(data.memberBlockIds)
		? data.memberBlockIds.filter((id) => typeof id === "string").length
		: 0;
	const title = renderInlineField(data, "groupName") || escapeHtml(strings.untitledGroup);
	const headingLevel = normalizeHeadingLevel(
		normalizeHeadingLevel(data._headingLevel, 2) +
			Math.max(0, Math.trunc(Number(data.headingOffset ?? 0)) || 0),
		2,
	);
	const titleId = `assessment-group-title-${block.id}`;
	const progressId = `assessment-group-progress-${block.id}`;
	const passingScoreId = `assessment-group-passing-score-${block.id}`;
	const pointsId = `assessment-group-points-${block.id}`;
	const passingScore =
		typeof data.passingScore === "number" && Number.isFinite(data.passingScore)
			? strings.assessmentGroupPassingScore.replace("{score}", String(data.passingScore))
			: "";
	const points =
		typeof data.pointsOverride === "number" && Number.isFinite(data.pointsOverride)
			? assessmentPointsLabel(data.pointsOverride, sourceLocale, strings)
			: "";
	const progress = strings.assessmentGroupProgress
		.replace("{completed}", "0")
		.replace("{total}", String(count));
	const showProgress = assessmentGroupHasProgress(members ?? []);
	const labelledBy = [
		titleId,
		showProgress ? progressId : "",
		passingScore ? passingScoreId : "",
		points ? pointsId : "",
	]
		.filter(Boolean)
		.join(" ");
	const picker =
		data.mode === "oneOf" && members?.length
			? `<fieldset class="praxity-assessment-group-picker"><legend class="praxity-assessment-group-picker-legend">${escapeHtml(strings.assessmentGroupChooseOne)}</legend><div class="praxity-assessment-group-options">${members
					.map((member, index) => {
						const question = extractAssessmentQuestion(
							(member.data as unknown as AssessmentBlockData | null)?.stem ?? [],
							strings,
							strings.assessmentGroupQuestionFallback.replace("{index}", String(index + 1)),
						);
						const radioId = `ag-radio-${block.id}-${member.id}`;
						return `<div class="praxity-ag-radio-row"><input type="radio" class="praxity-ag-radio" name="${escapeHtml(`ag-${block.id}`)}" value="${escapeHtml(member.id)}" id="${escapeHtml(radioId)}"${index === 0 ? " checked" : ""} disabled><label class="praxity-ag-radio-label" for="${escapeHtml(radioId)}">${question}</label></div>`;
					})
					.join("")}</div></fieldset>`
			: "";

	return `<div class="praxity-assessment-group-card" role="group" aria-labelledby="${escapeHtml(labelledBy)}" data-assessment-group-header="${escapeHtml(block.id)}"><div class="praxity-assessment-group-header-content"><h${headingLevel} id="${escapeHtml(titleId)}" class="praxity-assessment-group-title">${title}</h${headingLevel}><div class="praxity-assessment-group-metadata">${showProgress ? `<span id="${escapeHtml(progressId)}" data-assessment-group-progress>${escapeHtml(progress)}</span>` : ""}${passingScore ? `<span id="${escapeHtml(passingScoreId)}">${escapeHtml(passingScore)}</span>` : ""}${points ? `<span id="${escapeHtml(pointsId)}">${escapeHtml(points)}</span>` : ""}</div></div>${picker}</div>`;
}

function renderChecklist(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as unknown as ChecklistBlockData;
	const title =
		renderInlineField(data, "title") ||
		strings.checklistLabel ||
		DEFAULT_RENDER_STRINGS.checklistLabel;
	const items = Array.isArray(data.items) ? [...data.items] : [];
	if (data.shuffle) {
		// Randomizing after paint creates layout shift. A stable export-time shuffle
		// preserves authored intent without moving choices under a learner's pointer.
		const score = (value: string) => {
			let hash = 2166136261;
			for (const character of `${block.id}:${value}`) {
				hash ^= character.codePointAt(0) ?? 0;
				hash = Math.imul(hash, 16777619);
			}
			return hash >>> 0;
		};
		items.sort((a, b) => score(a.id || a.text) - score(b.id || b.text));
	}
	const seen = new Set<string>();
	const checkboxes = items
		.map((item, index) => {
			const label =
				renderInlineField(item, "text", false) ||
				formatIndexedLabel(strings.itemLabel || DEFAULT_RENDER_STRINGS.itemLabel, index + 1);
			const sourceId = item.id?.trim();
			const itemId = sourceId && !seen.has(sourceId) ? sourceId : `${sourceId || "item"}-${index}`;
			seen.add(itemId);
			const id = `${block.id}-check-${itemId}`;
			return `<div data-checklist-item data-item-id="${escapeHtml(itemId)}" data-node-id="${escapeHtml(itemId)}"><label for="${escapeHtml(id)}"><input id="${escapeHtml(id)}" type="checkbox" value="${escapeHtml(itemId)}" />${label}</label></div>`;
		})
		.join("");
	const required = data.required
		? `<span class="praxity-required-indicator"><span aria-hidden="true" class="praxity-required-marker"></span><span class="praxity-sr-only">${escapeHtml(strings.required)}</span></span>`
		: "";
	return `<fieldset class="praxity-fieldset-reset"><legend class="praxity-block-title">${title}${required}</legend><div class="praxity-checklist-items">${checkboxes}</div></fieldset>`;
}

function renderRating(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as unknown as RatingBlockData & {
		scale?: Array<{ label?: unknown; value?: unknown }>;
	};
	const style = ["stars", "emoji", "likert", "slider"].includes(data.style)
		? data.style
		: "numeric";
	const count =
		typeof data.maxValue === "number" && Number.isFinite(data.maxValue) && data.maxValue > 0
			? Math.floor(data.maxValue)
			: 5;
	const title = sanitizeInline(data.label) || escapeHtml(strings.ratingLabel);
	const required = data.required
		? `<span class="praxity-required-indicator"><span aria-hidden="true" class="praxity-required-marker"></span><span class="praxity-sr-only">${escapeHtml(strings.required)}</span></span>`
		: "";
	const scale = Array.isArray(data.scale) ? data.scale : [];
	const firstLabel = sanitizeInline(scale.find((point) => Number(point.value) === 1)?.label);
	const lastLabel = sanitizeInline(scale.find((point) => Number(point.value) === count)?.label);
	const endpoints =
		firstLabel || lastLabel
			? `<div class="praxity-rating-endpoints" data-rating-endpoints><span>${firstLabel}</span><span>${lastLabel}</span></div>`
			: "";
	const emoji = ["😞", "😐", "🙂", "😊", "🤩"];
	const options = Array.from({ length: count }, (_, index) => {
		const value = index + 1;
		const id = `${block.id}-rating-${value}`;
		const scaleLabel = sanitizeInline(scale.find((entry) => Number(entry?.value) === value)?.label);
		const accessibleLabel = `${formatTemplate(strings.rateValueOf, { value, count })}${
			scaleLabel ? `: ${htmlToPlainText(scaleLabel)}` : ""
		}`;
		const visible =
			style === "stars"
				? ""
				: style === "emoji"
					? emoji[index % emoji.length]
					: style === "likert" && scaleLabel
						? scaleLabel
						: value;
		return `<input class="praxity-rating-input praxity-sr-only" id="${escapeHtml(id)}" type="radio" name="${escapeHtml(`${block.id}-rating`)}" value="${value}" /><label data-node-id="${escapeHtml((scale.find((entry) => Number(entry?.value) === value) as { id?: string } | undefined)?.id || `${block.id}-level-${value}`)}" class="praxity-rating-option praxity-rating-${style === "likert" || style === "slider" ? "numeric" : style}" for="${escapeHtml(id)}" data-rating-active="false"><span class="praxity-rating-visual" aria-hidden="true">${visible}</span><span class="praxity-sr-only">${escapeHtml(accessibleLabel)}</span></label>`;
	}).join("");
	const slider =
		style === "slider"
			? `<label class="praxity-sr-only" for="${escapeHtml(block.id)}-slider">${title}</label><input id="${escapeHtml(block.id)}-slider" class="praxity-rating-slider" type="range" min="1" max="${count}" step="1" value="1" /><output class="praxity-rating-value"></output>`
			: "";
	const feedback =
		typeof data.feedback === "string" && data.feedback.trim()
			? `<div aria-live="polite" aria-atomic="true"><div class="praxity-rating-feedback" data-rating-feedback hidden></div><template data-rating-feedback-template><span class="praxity-sr-only">${escapeHtml(strings.feedbackLabel)}: </span><span>${sanitizeInline(data.feedback)}</span></template></div>`
			: "";
	return `<fieldset class="praxity-rating praxity-fieldset-reset"${style === "slider" ? "" : ` role="radiogroup"${data.required ? ' aria-required="true"' : ""}`} data-rating-style="${style}"><legend class="praxity-block-title">${title}${required}</legend>${slider}<div class="praxity-rating-options"${style === "slider" ? " hidden" : ""}>${options}</div>${endpoints}</fieldset>${feedback}`;
}

function renderSignature(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as unknown as SignatureBlockData;
	const label =
		typeof data.label === "string" && data.label.trim() ? data.label : strings.signatureLabel;
	const sublabel = typeof data.sublabel === "string" ? data.sublabel : "";
	const initialMethod = data.mode === "type" ? "type" : "draw";
	const labelId = `${block.id}-signature-label`;
	const drawTabId = `${block.id}-signature-draw-tab`;
	const typeTabId = `${block.id}-signature-type-tab`;
	const drawPanelId = `${block.id}-signature-draw-panel`;
	const typePanelId = `${block.id}-signature-type-panel`;
	const drawHintId = `${block.id}-signature-draw-hint`;
	const lockReasonId = `${block.id}-signature-lock-reason`;
	const drawStatusId = `${block.id}-signature-draw-status`;
	const typeStatusId = `${block.id}-signature-type-status`;
	const required = data.required
		? `<span class="praxity-required-indicator"><span aria-hidden="true" class="praxity-required-marker"></span><span class="praxity-sr-only">${escapeHtml(strings.required)}</span></span>`
		: "";
	const clearButton = `<button type="button" class="praxity-signature-clear" data-signature-clear hidden>${escapeHtml(strings.clearSignature)}</button>`;
	const status = (id: string) =>
		`<span id="${escapeHtml(id)}" class="praxity-signature-status" data-signature-status data-sublabel="${escapeHtml(sublabel)}" aria-live="polite">${escapeHtml(sublabel)}</span>`;

	return `<div class="praxity-signature" data-signed="false" data-completed="false" data-initial-method="${initialMethod}" data-draw-label="${escapeHtml(strings.drawYourSignature)}" data-signed-label="${escapeHtml(strings.signatureDrawn)}" data-signed-at-template="${escapeHtml(strings.signedAt)}"><p id="${escapeHtml(labelId)}" class="praxity-signature-label">${escapeHtml(label)}${required}</p><div role="tablist" aria-label="${escapeHtml(strings.signatureMethod)}" class="praxity-signature-tab-list"><button type="button" role="tab" id="${escapeHtml(drawTabId)}" aria-selected="${initialMethod === "draw"}" aria-controls="${escapeHtml(drawPanelId)}" tabindex="${initialMethod === "draw" ? "0" : "-1"}" class="praxity-signature-tab">${escapeHtml(strings.signatureDraw)}</button><button type="button" role="tab" id="${escapeHtml(typeTabId)}" aria-selected="${initialMethod === "type"}" aria-controls="${escapeHtml(typePanelId)}" tabindex="${initialMethod === "type" ? "0" : "-1"}" class="praxity-signature-tab">${escapeHtml(strings.signatureType)}</button></div><p id="${escapeHtml(lockReasonId)}" data-signature-lock-reason hidden>${escapeHtml(strings.signatureMethodLocked)}</p><div role="tabpanel" id="${escapeHtml(drawPanelId)}" aria-labelledby="${escapeHtml(drawTabId)}" data-signature-panel="draw"${initialMethod === "draw" ? "" : " hidden"}><div class="praxity-signature-canvas-box praxity-signature-canvas-box--draw"><canvas role="img" width="920" height="360" tabindex="0" aria-label="${escapeHtml(strings.drawYourSignature)}" aria-describedby="${escapeHtml(`${drawHintId} ${drawStatusId}`)}" class="praxity-signature-canvas"></canvas><span id="${escapeHtml(drawHintId)}" class="praxity-sr-only">${escapeHtml(strings.signatureKeyboardHint)}</span><div class="praxity-signature-line" aria-hidden="true"></div><div class="praxity-signature-footer">${status(drawStatusId)}${clearButton}</div></div></div><div role="tabpanel" id="${escapeHtml(typePanelId)}" aria-labelledby="${escapeHtml(typeTabId)}" data-signature-panel="type"${initialMethod === "type" ? "" : " hidden"}><div class="praxity-signature-canvas-box praxity-signature-canvas-box--type"><input type="text" aria-labelledby="${escapeHtml(labelId)}" aria-describedby="${escapeHtml(typeStatusId)}" class="praxity-signature-typed-input"${data.required ? " required" : ""} /><div class="praxity-signature-line" aria-hidden="true"></div><div class="praxity-signature-footer">${status(typeStatusId)}${clearButton}</div></div></div></div>`;
}

type PublishedLabeledGraphicData = LabeledGraphicBlockData & {
	intrinsicWidth?: number;
	intrinsicHeight?: number;
	loading?: "eager" | "lazy";
	fetchPriority?: "high";
};

function renderLabeledGraphic(block: PraxityBlock, strings: RenderBlockHtmlStrings): string {
	const data = block.data as unknown as PublishedLabeledGraphicData;
	const src = sanitizeUrl(typeof data.imageSrc === "string" ? data.imageSrc : "");
	if (!src || src === "#") return "";
	const labels = Array.isArray(data.labels) ? data.labels : [];
	const reveal = data.reveal === "click" || data.reveal === "sequential" ? data.reveal : "all";
	const imageLabel =
		typeof data.imageAlt === "string" && data.imageAlt.trim()
			? data.imageAlt
			: strings.labeledGraphicLabel;
	const width =
		typeof data.intrinsicWidth === "number" && data.intrinsicWidth > 0
			? Math.round(data.intrinsicWidth)
			: null;
	const height =
		typeof data.intrinsicHeight === "number" && data.intrinsicHeight > 0
			? Math.round(data.intrinsicHeight)
			: null;
	const sizeAttrs = width && height ? ` width="${width}" height="${height}"` : "";
	const loading = data.loading === "eager" ? "eager" : "lazy";
	const decorative = isDecorativeImage(data, block.a11y);
	const image = `<img src="${escapeHtml(src)}" alt="${escapeHtml(decorative ? "" : imageLabel)}"${decorative ? ' role="presentation"' : ""}${sizeAttrs} loading="${loading}"${data.fetchPriority === "high" ? ' fetchpriority="high"' : ""} />`;
	const labelBody = (label: (typeof labels)[number] & { description?: unknown }) => {
		const body =
			typeof label.body === "string" && label.body.trim()
				? label.body
				: typeof label.description === "string"
					? label.description
					: "";
		return sanitizeInline(body);
	};
	const position = (value: unknown) =>
		typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
	const staticLabels = labels
		.map((label) => {
			const body = labelBody(label);
			const labelId =
				typeof label.id === "string" && label.id.trim()
					? ` data-label-id="${escapeHtml(label.id)}"`
					: "";
			return `<div class="praxity-labeled-graphic-marker"${labelId} style="left:${position(label.x)}%;top:${position(label.y)}%"><div class="praxity-labeled-graphic-pin" role="note"><strong>${escapeHtml(String(label.title ?? ""))}</strong>${body ? `<div class="praxity-labeled-graphic-body">${body}</div>` : ""}</div></div>`;
		})
		.join("");
	if (reveal === "all") {
		return `<div role="group" aria-label="${escapeHtml(imageLabel)}" class="praxity-labeled-graphic" data-reveal="all">${image}${staticLabels}</div>`;
	}

	const instructionId = `${block.id}-label-instructions`;
	const description =
		reveal === "sequential" && labels.length > 0
			? ` aria-describedby="${escapeHtml(instructionId)}"`
			: "";
	const instruction =
		reveal === "sequential"
			? strings.labeledGraphicSequentialInstruction
			: strings.labeledGraphicClickToReveal;
	const interactiveLabels = labels
		.map((label, index) => {
			const controlId = `${block.id}-label-${index + 1}`;
			const popoverId = `${controlId}-popover`;
			const body = labelBody(label);
			const labelId =
				typeof label.id === "string" && label.id.trim()
					? ` data-label-id="${escapeHtml(label.id)}"`
					: "";
			const disabled = reveal === "sequential" && index > 0 ? " disabled" : "";
			const nextClass =
				reveal === "sequential" && index === 0 ? " praxity-labeled-graphic-dot--next" : "";
			return `<div class="praxity-labeled-graphic-marker" data-label-index="${index}"${labelId} style="left:${position(label.x)}%;top:${position(label.y)}%"><button type="button" id="${escapeHtml(controlId)}" class="praxity-labeled-graphic-dot${nextClass}" aria-expanded="false" aria-controls="${escapeHtml(popoverId)}" aria-label="${escapeHtml(`${index + 1}. ${String(label.title ?? "")}`)}"${description}${disabled}>${index + 1}</button><div id="${escapeHtml(popoverId)}" class="praxity-labeled-graphic-popover" role="note" aria-labelledby="${escapeHtml(controlId)}" hidden><strong>${escapeHtml(String(label.title ?? ""))}</strong>${body ? `<div class="praxity-labeled-graphic-body">${body}</div>` : ""}</div></div>`;
		})
		.join("");
	const fallback = `<noscript><ol class="praxity-labeled-graphic-fallback">${labels
		.map((label) => {
			const body = labelBody(label);
			return `<li><strong>${escapeHtml(String(label.title ?? ""))}</strong>${body ? `<div>${body}</div>` : ""}</li>`;
		})
		.join("")}</ol></noscript>`;
	const progress = formatTemplate(strings.labeledGraphicProgress, {
		revealed: 0,
		total: labels.length,
	});
	return `<div class="praxity-labeled-graphic-island"><div role="group" aria-label="${escapeHtml(imageLabel)}"${description} class="praxity-labeled-graphic" data-reveal="${reveal}">${image}${interactiveLabels}</div>${labels.length > 0 ? `<p id="${escapeHtml(instructionId)}" class="praxity-labeled-graphic-hint praxity-block-caption">${escapeHtml(instruction)}</p><p class="praxity-block-caption" data-labeled-graphic-progress data-template="${escapeHtml(strings.labeledGraphicProgress)}" aria-live="polite" aria-atomic="true">${escapeHtml(progress)}</p>${fallback}` : ""}</div>`;
}

function chartText(value: unknown): string {
	return htmlToPlainText(sanitizeInline(value));
}

function chartNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function renderChart(block: PraxityBlock): string {
	const data = block.data as unknown as ChartBlockData;
	const labels = Array.isArray(data.data?.labels) ? data.data.labels.map(chartText) : [];
	const normalizedSeries: PublishedChartSeries[] = Array.isArray(data.data?.series)
		? data.data.series.map((entry) => ({
				name: chartText(entry?.name),
				values: Array.isArray(entry?.values) ? entry.values.map(chartNumber) : [],
			}))
		: [];
	const { labels: sortedLabels, series } = sortChartData(
		labels,
		normalizedSeries,
		data.sortOrder,
		Number.isInteger(data.sortSeriesIndex) ? (data.sortSeriesIndex as number) : 0,
	);
	const type = data.chartType || "bar";
	const title = renderInlineField(data, "title");
	const subtitle = renderInlineField(data, "subtitle");
	const caption = renderInlineField(data, "caption");
	const accessibleName =
		chartText(data.altText) || `${type} chart${title ? `: ${htmlToPlainText(title)}` : ""}`;
	const tableCaption = title || caption || `${escapeHtml(type)} data`;
	const header = `<tr><th scope="col">Label</th>${series
		.map((entry) => `<th scope="col">${escapeHtml(entry.name)}</th>`)
		.join("")}</tr>`;
	const rows = sortedLabels
		.map((label, rowIndex) => {
			const cells = series
				.map((entry) => {
					const value = entry.values[rowIndex];
					return `<td>${value === null || value === undefined ? "" : escapeHtml(formatChartNumber(value))}</td>`;
				})
				.join("");
			return `<tr><th scope="row">${escapeHtml(label)}</th>${cells}</tr>`;
		})
		.join("");
	const table = `<table class="praxity-chart-data"><caption>${tableCaption}</caption><thead>${header}</thead><tbody>${rows}</tbody></table>`;
	if (sortedLabels.length === 0 || series.length === 0) return table;
	const visual =
		type === "radar"
			? renderRadarChartSvg(sortedLabels, series, accessibleName)
			: ([720, 440, 280] as const)
					.map((width) =>
						renderCartesianChartSvg(data, sortedLabels, series, accessibleName, width, chartText),
					)
					.join("");
	return `<figure class="praxity-chart-container praxity-figure-reset" data-chart-type="${escapeHtml(type)}">${title ? `<div class="praxity-chart-title">${title}</div>` : ""}${subtitle ? `<div class="praxity-chart-subtitle">${subtitle}</div>` : ""}${visual}<div class="praxity-sr-only">${table}</div>${caption ? `<figcaption class="praxity-block-caption">${caption}</figcaption>` : ""}</figure>`;
}

function renderStats(block: PraxityBlock): string {
	const data = block.data as unknown as StatsBlockData;
	const items = Array.isArray(data.items) ? data.items : [];
	if (items.length === 0) return "";

	const layout = items.length === 1 ? "statement" : "grid";
	const size = data.size === "large" || data.size === "very-large" ? data.size : "default";
	const requestedColumns = Number(data.columns);
	const columns =
		Number.isInteger(requestedColumns) && requestedColumns >= 2 && requestedColumns <= 4
			? requestedColumns
			: Math.min(Math.max(items.length, 2), 4);
	const gridStyle =
		layout === "grid" ? ` style="grid-template-columns:repeat(${columns},minmax(0,1fr))"` : "";
	const itemMarkup = items
		.map(
			(item) =>
				`<p class="praxity-stats-item"><span class="praxity-stats-value">${escapeHtml(String(item.value ?? ""))}</span><span class="praxity-stats-label">${renderInlineField(item, "label")}</span></p>`,
		)
		.join("");
	const caption =
		typeof data.caption === "string" && data.caption
			? `<figcaption class="praxity-block-caption praxity-stats-caption">${renderInlineField(data, "caption")}</figcaption>`
			: "";
	return `<figure class="praxity-stats praxity-figure-reset" data-layout="${layout}" data-size="${size}"><div class="praxity-stats-grid"${layout === "grid" ? ` data-columns="${columns}"` : ""}${gridStyle}>${itemMarkup}</div>${caption}</figure>`;
}

function renderSemanticContent(
	block: PraxityBlock,
	strings: RenderBlockHtmlStrings,
	imageFloat: ImageFloat | null,
	enabledIslands?: ReadonlySet<IslandName>,
	hiddenBlockIds?: ReadonlySet<string>,
	assessmentGroupMembers?: PraxityBlock[],
	sourceLocale?: string,
	blockIndex = 0,
	selfCheckContextPending = false,
): string {
	switch (block.type) {
		case "writeDistractors": {
			const data = block.data as { content: WriteDistractorsPrompt; level?: number };
			return renderWriteDistractors(data.content, {
				prefix: `${block.id}-distractors-${blockIndex}`,
				blockId: block.id,
				lang: sourceLocale ?? "en",
				headingLevel: Number(data.level ?? 2),
			});
		}
		case "highlight": {
			const data = block.data as unknown as HighlightData;
			return renderHighlight(data.content, {
				prefix: `${block.id}-highlight-${blockIndex}`,
				lang: sourceLocale ?? "en",
				headingLevel: normalizeHeadingLevel(data.level, 2),
			});
		}
		case "retrievalSheet": {
			const data = block.data as unknown as RetrievalSheetData;
			const lang = sourceLocale ?? "en";
			return renderRetrievalSheet(data.content, {
				prefix: `${block.id}-retrieval-${blockIndex}`,
				lang,
				headingLevel: normalizeHeadingLevel(data.level, 2),
				strings: retrievalSheetPatternStrings[resolveLocale(lang)],
				noDate: getRetrievalSheetStrings(lang).retrievalNoDate,
			});
		}
		case "selfCheck":
			return renderSelfCheck(
				block,
				strings,
				sourceLocale ?? "en",
				blockIndex,
				selfCheckContextPending,
			);
		case "heading":
			return renderHeading(block);
		case "text":
			return renderText(block);
		case "image":
			return renderImage(block, imageFloat);
		case "imageComparison":
			return renderImageComparison(block, strings);
		case "heroCover":
			return renderHeroCover(block);
		case "video":
			return renderVideo(block, strings);
		case "audio":
			return renderAudio(block, strings);
		case "embed":
			return renderEmbed(block, strings);
		case "note":
			return renderNote(block, strings);
		case "quote":
			return renderQuote(block);
		case "dialogue":
			return renderDialogue(block);
		case "code":
			return renderCode(block, strings);
		case "equation":
			return renderEquation(block);
		case "button":
			return renderButton(block, strings);
		case "table":
			return renderTable(block, strings);
		case "divider":
			return renderDivider();
		case "columns":
			return renderColumns(
				block,
				strings,
				enabledIslands,
				hiddenBlockIds,
				sourceLocale,
				selfCheckContextPending,
			);
		case "card":
			return renderCard(
				block,
				strings,
				enabledIslands,
				hiddenBlockIds,
				sourceLocale,
				selfCheckContextPending,
			);
		case "sequence":
			return renderSequence(
				block,
				strings,
				enabledIslands,
				hiddenBlockIds,
				sourceLocale,
				selfCheckContextPending,
			);
		case "accordion":
			return renderAccordion(
				block,
				strings,
				enabledIslands,
				hiddenBlockIds,
				sourceLocale,
				selfCheckContextPending,
			);
		case "tabs":
			return renderTabs(
				block,
				strings,
				enabledIslands,
				hiddenBlockIds,
				sourceLocale,
				selfCheckContextPending,
			);
		case "assessment":
			return renderAssessment(block, strings, sourceLocale);
		case "assessmentGroup":
			return renderAssessmentGroup(block, strings, assessmentGroupMembers, sourceLocale);
		case "checklist":
			return renderChecklist(block, strings);
		case "rating":
			return renderRating(block, strings);
		case "signature":
			return renderSignature(block, strings);
		case "labeledGraphic":
			return renderLabeledGraphic(block, strings);
		case "chart":
			return renderChart(block);
		case "stats":
			return renderStats(block);
		case "variable":
		case "logic":
			return "";
		case "document":
			// A document embed is a link; without this, a page whose only special
			// block is a document gets the static runtime and the link never renders.
			return renderDocument(block, strings);
		case "resourceEntry":
			return renderResourceEntry(block, strings);
		case "pageBreak":
		case "blockBreak":
			return "";
		default:
			return "";
	}
}

export function renderBlockHtml(block: PraxityBlock, options: RenderBlockHtmlOptions = {}): string {
	const sourceLocale = block.locale ?? options.sourceLocale ?? "en";
	if (block.type === "highlight") assertHighlightData(block.data, block.id, "data", sourceLocale);
	if (block.type === "retrievalSheet")
		assertRetrievalSheetData(block.data, block.id, "data", sourceLocale);
	const strings = {
		...DEFAULT_RENDER_STRINGS,
		...getStrings(sourceLocale),
		...(options.strings ?? {}),
		...(block.locale ? getStrings(block.locale) : {}),
	};
	const safeBlock = sanitizeBlockForJson(
		block.type === "assessment" && block.data._dontKnow === undefined
			? resolveAssessmentDontKnow([block])[0]
			: block,
	);
	// Float boundaries carry source identity without learner content or layout.
	if (safeBlock.type === "blockBreak" && safeBlock.data.close === "float")
		return `<div data-node-id="${escapeHtml(safeBlock.id)}"></div>`;
	if (safeBlock.type === "pageBreak" || safeBlock.type === "blockBreak") return "";
	const imageFloat = getImageFloatSide(safeBlock);
	const semantic = renderSemanticContent(
		safeBlock,
		strings,
		imageFloat,
		options.enabledIslands,
		options.hiddenBlockIds,
		options.assessmentGroupMembers,
		sourceLocale,
		options.blockIndex,
		options.selfCheckContextPending,
	);

	const classes =
		options.classNames && options.classNames.length > 0
			? options.classNames
			: [
					"praxity-block",
					`praxity-block-${camelToKebab(safeBlock.type)}`,
					`praxity-block-${safeBlock.id}`,
				];
	const attrs = [
		`id="block-${escapeHtml(safeBlock.id)}"`,
		`class="${classes.map((className) => escapeHtml(className)).join(" ")}"`,
		`data-block-id="${escapeHtml(safeBlock.id)}"`,
		`data-node-id="${escapeHtml(safeBlock.id)}"`,
		`data-block-type="${escapeHtml(safeBlock.type)}"`,
		...(safeBlock.type === "heading"
			? [
					`data-heading-level="${normalizeHeadingLevel((safeBlock.data as Record<string, unknown>).level)}"`,
				]
			: []),
		"data-focus-row",
		...(safeBlock.type === "heading" || safeBlock.type === "button"
			? [`data-focus-exempt="${safeBlock.type}"`]
			: []),
		...(options.extraAttributes ?? []),
	];
	if (options.hiddenBlockIds?.has(safeBlock.id)) attrs.push("hidden");
	if (blockRequiresPageGate(safeBlock)) {
		attrs.push('data-required="true"');
	}
	const islandName = getBlockIsland(safeBlock);
	const islandEnabled = Boolean(islandName && options.enabledIslands?.has(islandName));
	if (islandEnabled) attrs.push(`data-island="${escapeHtml(islandName ?? "")}"`);
	const domOnlyIsland = islandName !== undefined && islandName !== "assessment";
	if (options.includeDataBlockJson === true || (islandEnabled && !domOnlyIsland)) {
		const dataJson = JSON.stringify(safeBlock);
		attrs.push(`data-block-json='${escapeJsonForHtml(dataJson)}'`);
	}

	return `<div ${attrs.join(" ")}>${semantic}</div>`;
}
