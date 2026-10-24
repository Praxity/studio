import type { SectionPaletteName } from "./constants";

/** Generic self-check reader data. Full authored Content belongs to grammar. */
export interface SelfCheckPrompt {
	task: string;
	parts: { id: string }[];
}

/** Public authored recall content; every field is literal plain text. */
export interface RetrievalSheetContent {
	title: string;
	questions: { id: string; question: string; answer: string }[];
}
export interface RetrievalSheetData {
	content: RetrievalSheetContent;
	level: number;
}

/** Public authored highlight content; every text field stays literal. */
export interface HighlightContent {
	mode: "key" | "evidence";
	title: string;
	question?: string;
	maxMarks?: number;
	paragraphs: Array<Array<{ id: string; text: string; key?: boolean; note?: string }>>;
}
export type HighlightData = {
	content: HighlightContent;
	level: number;
	layoutMode?: BlockLayoutMode;
	hide?: boolean;
	visible?: string;
	entrance?: "none" | "fade" | "slide" | "scale";
};

/** Generic prompt only. Full authored Content belongs to grammar. */
export interface WriteDistractorsPrompt {
	question: string;
	count: 1 | 2 | 3 | 4 | 5;
	items: { id: string }[];
}
export type WriteDistractorsData = {
	content: WriteDistractorsPrompt;
	level: number;
	layoutMode?: BlockLayoutMode;
	hide?: boolean;
	visible?: string;
	entrance?: "none" | "fade" | "slide" | "scale";
};

/**
 * Shared type definitions for Praxity block system.
 *
 * This file is the SINGLE SOURCE OF TRUTH for BlockType, PraxityBlock,
 * and PraxityPage.
 */

export type BlockType =
	// Content
	| "text"
	| "heading"
	| "image"
	| "video"
	| "audio"
	| "document"
	| "quote"
	| "dialogue"
	| "divider"
	| "embed"
	| "button"
	| "imageComparison"
	| "chart"
	| "table"
	| "stats"
	| "note"
	| "code"
	| "equation"
	| "heroCover"
	// Container
	| "accordion"
	| "tabs"
	| "columns"
	| "sequence"
	| "card"
	// Interactive
	| "labeledGraphic"
	| "checklist"
	| "rating"
	| "signature"
	| "selfCheck"
	| "retrievalSheet"
	| "highlight"
	| "writeDistractors"
	// Assessment
	| "assessment"
	// Logic
	| "variable"
	| "logic"
	| "assessmentGroup"
	| "pageBreak"
	| "blockBreak"
	// Course-level data blocks
	| "resourceEntry";

/**
 * Runtime array of all block types — SINGLE SOURCE OF TRUTH.
 *
 * Derived from the BlockType union above. When you add a new block type
 * to the union, add it here too. TypeScript will error if the two drift.
 */
export const BLOCK_TYPES = [
	// Content
	"text",
	"heading",
	"image",
	"video",
	"audio",
	"document",
	"quote",
	"dialogue",
	"divider",
	"embed",
	"button",
	"imageComparison",
	"chart",
	"table",
	"stats",
	"note",
	"code",
	"equation",
	"heroCover",
	// Container
	"accordion",
	"tabs",
	"columns",
	"sequence",
	"card",
	// Interactive
	"labeledGraphic",
	"checklist",
	"rating",
	"signature",
	"selfCheck",
	"retrievalSheet",
	"highlight",
	"writeDistractors",
	// Assessment
	"assessment",
	// Logic
	"variable",
	"logic",
	"assessmentGroup",
	"pageBreak",
	"blockBreak",
	// Course-level data blocks
	"resourceEntry",
] as const satisfies readonly BlockType[];

/** These block projections contain literal text, never inline grammar or rich HTML. */
export function isLiteralTextBlockType(type: unknown): boolean {
	return (
		type === "code" ||
		type === "equation" ||
		type === "selfCheck" ||
		type === "retrievalSheet" ||
		type === "highlight" ||
		type === "writeDistractors"
	);
}

export interface PraxityBlock {
	id: string;
	name?: string;
	type: BlockType;
	data: Record<string, unknown>;
	visible?: boolean;
	layout?: {
		width: "full" | "half" | "third";
		alignment?: "left" | "center" | "right";
	};
	a11y?: {
		altText?: string;
		ariaLabel?: string;
		decorative?: boolean;
	};
	/** ISO 639-1 locale for this block's content, if different from the course sourceLocale */
	locale?: string;
	/** When set, this block starts a new section with the given palette (manual rhythm mode) */
	sectionTheme?: SectionPaletteName;
}

export interface PraxityPage {
	/** Resolved language of the containing lesson; otherwise inherit the course. */
	locale?: string;
	id: string;
	title: string;
	/** Arbitrary metadata attached to the page by its preceding pageBreak. */
	data?: Record<string, unknown>;
	description?: string;
	blocks: PraxityBlock[];
	settings?: {
		lockUntilComplete?: string[];
	};
	lessonId?: string;
	lessonTitle?: string;
	/** The lesson label is generated because there is no authored title. */
	lessonTitleIsFallback?: boolean;
	lessonKicker?: string;
	lessonTime?: string;
	isFirstPageOfLesson?: boolean;
	narrationEnabled?: boolean;
	narrationDefaults?: Record<string, unknown>;
}

// === Lessons hierarchy (Course → Lesson → Page → Block) ===

export interface Lesson {
	id: string;
	title: string;
	firstPageTitle?: string; // independent title for the first page on canvas
	sortOrder: number;
	pages: LessonPage[]; // kept required during transition, default []
	blocks: PraxityBlock[]; // new: flat block stream
	settings?: LessonSettings;
	/** Lesson role — "content" (default), "glossary", or "resources". Non-content lessons are hidden from learner navigation. */
	role?: "content" | "glossary" | "resources";
}

export interface LessonSettings {
	lockUntilComplete?: string[];
}

export interface LessonPage {
	id: string;
	title: string;
	description?: string;
	sortOrder: number;
	puckData: Record<string, unknown> | null;
	blocks: PraxityBlock[];
	settings?: {
		lockUntilComplete?: string[];
	};
}

export interface BlockProps<T = Record<string, unknown>> {
	data: T;
	blockId: string;
}

// === Content Block Data Interfaces ===

export interface TextBlockData {
	content: string;
	reveal?: number | string | boolean;
}

export interface HeadingBlockData {
	content: string;
	level: 1 | 2 | 3;
	kicker?: string;
	/** Offset added in published output to maintain heading hierarchy after auto-titles. */
	headingOffset?: number;
	/** Display style: standard heading or chapter/act marker */
	display?: "standard" | "chapter";
}

export type BlockLayoutMode = "narrow" | "wide" | "full" | "breakout";

export interface SlideStyleDef {
	/** Draw the leading accent rule (enabled by the built-in section style). */
	accentRule?: boolean;
	/** Optional decorative course image, independent of the background colour. */
	cornerImage?: string;
	measure?: "narrow" | "default" | "wide" | "full";
	align?: "start" | "center";
	background?: "paper" | "surface" | "accent" | "ink";
	scale?: "default" | "display";
	chrome?: "default" | "minimal";
	mediaPlacement?: "stacked" | "left" | "right";
}

export const IMAGE_WIDTHS = ["small", "medium", "large"] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

export const IMAGE_FLOATS = ["left", "right"] as const;
export type ImageFloat = (typeof IMAGE_FLOATS)[number];

export const IMAGE_ALIGNMENTS = ["left", "center", "right"] as const;
export type ImageAlignment = (typeof IMAGE_ALIGNMENTS)[number];

export const IMAGE_TREATMENTS = [
	"none",
	"grayscale",
	"tint",
	"duotone",
	"grain",
	"dither",
	"blur",
] as const;
export type ImageTreatment = (typeof IMAGE_TREATMENTS)[number];

export interface ImageBlockData {
	ratio?: "square" | "4:3" | "3:2" | "16:9";
	fit?: "contain" | "cover";
	src: string;
	altText: string;
	decorative: boolean;
	caption?: string;
	captionEnabled?: boolean;
	/** Intrinsic raster dimensions added while packaging published output. */
	intrinsicWidth?: number;
	intrinsicHeight?: number;
	loading?: "eager" | "lazy";
	fetchPriority?: "high";
	width?: ImageWidth;
	float?: ImageFloat;
	layout?: BlockLayoutMode;
	alignment?: ImageAlignment;
	/** @deprecated Use effects instead. Migrated on read. */
	treatment?: ImageTreatment;
	/** Per-image effect overrides from grammar {effects: ...} syntax. */
	effects?: "none" | Record<string, { intensity: number; [key: string]: unknown }>;
}

export interface CaptionTrack {
	language: string;
	label: string;
	src: string;
	kind: "captions" | "subtitles" | "descriptions";
	default?: boolean;
}

export type VideoSource =
	| { type: "url"; src: string }
	| { type: "mux"; playbackId: string; assetId: string };

export interface VideoBlockData {
	source: VideoSource;
	title?: string;
	caption?: string;
	captionEnabled?: boolean;
	autoplay?: boolean;
	transcript?: string;
	startTime?: number;
	endTime?: number;
	captionTracks?: CaptionTrack[];
}

export interface AudioBlockData {
	src: string;
	title?: string;
	caption?: string;
	captionEnabled?: boolean;
	transcript?: string;
	transcriptOverride?: string;
	ttsGenerated?: boolean;
	ttsVoiceId?: string;
	ttsContentHash?: string;
	captionTracks?: CaptionTrack[];
}

export interface DividerBlockData {
	dividerType: "line" | "space" | "transition";
	lineStyle?: "solid" | "dashed" | "dotted" | "ornament";
	lineSize?: "small" | "medium" | "large";
	spaceSize?: "narrow" | "medium" | "wide";
	transitionShape?: "wave" | "angle" | "curve";
	label?: string;
}

export interface QuoteBlockData {
	text: string;
	speaker?: string;
	work?: string;
	sourceUrl?: string;
	/** @deprecated Use speaker. Retained for persisted .prax compatibility. */
	attribution?: string;
	/** @deprecated All quotes now use the single line treatment. */
	decorator?: "line-left" | "quotation-marks" | "cinematic";
	/** @deprecated All quotes now inherit the body size. */
	size?: "default" | "large" | "very-large";
	/** Omitted and legacy styles retain the original left-line quote treatment. */
	style?:
		| "none"
		| "outline"
		| "shaded"
		| "primary"
		| "secondary"
		| "default"
		| "pullquote"
		| "pull-quote"
		| "testimonial";
}

export interface DialogueSpeakerData {
	name?: string;
	avatar?: string;
	voice?: string;
	side?: "start" | "end";
}

export interface DialogueTurnData {
	id: string;
	/** Speaker key exactly as the author wrote it; undefined for an unattributed item. */
	speaker?: string;
	/** Paragraphs of inline markdown. */
	paragraphs: string[];
	/** Filled by resolveDialogueSpeakers (Task 4); never serialized. */
	name?: string;
	avatar?: string;
	voice?: string;
	side?: "start" | "end";
}

export interface DialogueBlockData {
	turns: DialogueTurnData[];
	/** Local speaker declarations keyed by the author's key spelling. */
	speakers?: Record<string, DialogueSpeakerData>;
	style?: "bubbles" | "script";
	caption?: string;
}

export interface EmbedBlockData {
	src: string;
	title: string;
	caption?: string;
	captionEnabled?: boolean;
	display?: "bookmark";
	width?: number;
	height?: number;
}

export interface ButtonBlockData {
	text: string;
	href: string;
	variant: "filled" | "outline" | "light";
	openInNewTab: boolean;
	action?: "link" | "goToPage";
	targetPageId?: string;
}

export interface DocumentBlockData {
	url: string;
	title?: string;
	description?: string;
	display?: "bookmark" | "button" | "download";
	buttonVariant?: "filled" | "outline" | "light";
	filename?: string;
	/** File size in bytes. */
	size?: number;
	mimeType?: string;
}

export const NOTE_STYLES = ["outline", "shaded"] as const;
export type NoteStyle = (typeof NOTE_STYLES)[number];

export const NOTE_COLORS = [
	"accent",
	"primary",
	"secondary",
	"success",
	"warning",
	"error",
	"grey",
] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const NOTE_TONES = ["note", "info", "tip", "success", "warning"] as const;
export type NoteTone = (typeof NOTE_TONES)[number];

export const NOTE_ICON_NAME_PATTERN = /^(?:none|[a-z0-9]+(?:-[a-z0-9]+)*)$/;
export const TABLER_ICON_VERSION = "3.46.0";
export type NoteIconName = string;

export interface NoteBlockData {
	emoji?: string;
	title?: string;
	icon?: NoteIconName;
	/** Export-only Tabler outline nodes; authors never set this directly. */
	_tablerIconNodes?: unknown;
	content: string;
	style: NoteStyle | "filled";
	color: NoteColor;
}

export interface CodeBlockData {
	/** The source code content */
	code: string;
	/** Programming language identifier (e.g., "javascript", "python", "html") */
	language: string;
	/** Optional title displayed above the code block */
	title?: string;
	/** Show line numbers in published output (default: true) */
	showLineNumbers?: boolean;
	/** Highlighted line numbers (stored as array, UI parses from "1-3,5,8-10" string input) */
	highlightLines?: number[];
	/** Starting line number for display (default: 1) */
	startLine?: number;
}

export interface EquationBlockData {
	latex: string;
}

export interface ImageComparisonBlockData {
	beforeImage: { src: string; altText: string };
	afterImage: { src: string; altText: string };
	beforeLabel?: string;
	afterLabel?: string;
	beforeCaption?: string;
	afterCaption?: string;
	caption?: string;
	display?: "side-by-side" | "slider";
}

export interface TableBlockData {
	title?: string;
	headers: string[];
	rows: string[][];
	caption?: string;
	striped?: boolean;
	highlightHeaderRow?: boolean;
	highlightHeaderCol?: boolean;
	shadeHeaders?: boolean;
	firstRowLine?: boolean;
	firstColLine?: boolean;
	gridlines?: "none" | "rows" | "columns" | "inside" | "all";
	columnAlignments?: ("left" | "center" | "right")[];
}

// === Container Types ===

export interface ContainerItem {
	id: string;
	label: string;
	children: PraxityBlock[];
	alignment?: "left" | "center" | "right";
}

export interface CardItem {
	id: string;
	label: string;
	headingLevel?: number;
	front: PraxityBlock[];
	back: PraxityBlock[];
}

export interface BaseContainerData {
	items: ContainerItem[];
	trackCompletion: boolean;
}

export interface CardBlockData {
	title?: string;
	_headingLevel?: number;
	headings?: boolean;
	headingLevel?: number;
	layout: "single" | "grid" | "masonry" | "rows";
	media?: "inset" | "flush";
	columns: number;
	style: "none" | "outline" | "filled" | "shaded" | "accent" | "primary" | "secondary";
	color?: "primary" | "secondary";
	shadow: "theme" | "none" | "subtle" | "elevated";
	shuffle: boolean;
	trackCompletion: boolean;
	advance: number;
	transition: "none" | "fade" | "slide" | "zoom";
	showProgress: boolean;
	items: CardItem[];
}

export interface AccordionContainerData extends BaseContainerData {
	allowMultipleOpen: boolean;
	accordionStyle?:
		| "default"
		| "contained"
		| "separated"
		| "none"
		| "outline"
		| "shaded"
		| "primary"
		| "secondary";
}

export interface TabsContainerData extends BaseContainerData {
	tabPosition: "top" | "left";
}

/** Column-specific item — separate from ContainerItem to avoid polluting other container types. */
export interface ColumnItem {
	id: string;
	width: number; // positive relative proportion; omitted or invalid persisted values use 1
	/** Author-supplied heading for semantic column presets. */
	label?: string;
	children: PraxityBlock[];
}

/** Columns block data — does NOT extend BaseContainerData. */
export interface ColumnsBlockData {
	items: ColumnItem[];
	trackCompletion?: boolean;
	/** Display preset for semantic framing */
	preset?: "default" | "beforeAfter" | "comparison";
	layout?: BlockLayoutMode;
}

export interface HeroCoverBlockData {
	imageSrc: string;
	imageAlt: string;
	title: string;
	subtitle?: string;
	alignment?: "center" | "left" | "right";
	verticalAlignment?: "top" | "center" | "bottom";
	overlayOpacity?: number;
	/** "dark" = dark overlay / light text (default), "light" = light overlay / dark text */
	overlayColor?: "dark" | "light";
	/** Publish-time semantic heading offset injected by html-gen.ts */
	headingOffset?: number;
}

export interface SequenceContainerData extends BaseContainerData {
	variant: "numbered" | "timeline" | "plain";
	orientation: "vertical" | "horizontal";
	alignment?: "left" | "center" | "right";
	distribution?: "uniform" | "scaled";
	scrollable?: boolean;
	layout?: BlockLayoutMode;
}

// === Interactive Types ===

export interface LabeledGraphicBlockData {
	imageSrc: string;
	imageAlt: string;
	decorative?: boolean;
	labels: {
		id: string;
		x: number;
		y: number;
		title: string;
		body: string;
	}[];
	reveal?: "all" | "click" | "sequential";
}

export interface ChecklistBlockData {
	title?: string;
	items: { id: string; text: string }[];
	shuffle?: boolean;
	required?: boolean;
}

export interface RatingBlockData {
	style: "stars" | "emoji" | "numeric" | "likert" | "slider";
	scale?: { value: number; label: string }[];
	maxValue: number;
	label?: string;
	feedback?: string;
	required?: boolean;
}

export interface SignatureBlockData {
	mode: "draw" | "type";
	label: string;
	sublabel?: string;
	required: boolean;
}

// === Assessment Types ===

export interface AssessmentBlockData {
	assessmentType:
		| "choice"
		| "matching"
		| "sequence"
		| "categorize"
		| "fillBlank"
		| "textResponse"
		| "hotspot"
		| "matrix"
		| "likert"
		| "fileUpload"
		| "audioRecording"
		| "videoRecording"
		| "speech"
		| "dictation";
	stem: PraxityBlock[];
	/**
	 * Heading level the author wrote the question at. The stem renders as a real
	 * heading so questions are reachable by heading navigation (WCAG 2.4.6); the
	 * level has to be the authored one or the page's outline order breaks.
	 */
	stemLevel?: number;
	/** Publish-time semantic heading offset injected by html-gen.ts */
	headingOffset?: number;
	/**
	 * Optional supporting prose shown between the question stem and the response
	 * controls — scenario setup, instructions, extra context. Rendered as rich
	 * text and wired to the response controls via `aria-describedby`.
	 */
	description?: PraxityBlock[];
	response:
		| ChoiceResponse
		| MatchingResponse
		| SequenceResponse
		| CategorizeResponse
		| FillBlankResponse
		| TextResponseConfig
		| HotspotResponse
		| MatrixResponse
		| FileUploadResponse
		| AudioRecordingResponse
		| VideoRecordingResponse
		| SpeechResponse
		| DictationResponse;
	feedback: {
		correct?: PraxityBlock[];
		incorrect?: PraxityBlock[];
		ai?: {
			enabled: boolean;
			prompt?: string;
			capabilities?: ("transcription" | "analysis")[];
		};
	};
	feedbackEnabled?: boolean;
	/** Assessments with answer keys can reveal them after one attempt. Legacy modes retain retry behavior. */
	feedbackMode?: "retry" | "reveal" | "unified" | "perOption";
	shuffle?: boolean;
	/** @deprecated Use `gradingMode` instead. */
	graded?: boolean;
	/** Offer the reserved uncertainty answer on single-answer choice questions. */
	dontKnow?: boolean;
	/** Resolved display metadata; never persisted as an authored setting. */
	_dontKnow?: boolean;
	gradingMode?: "none" | "partial" | "exact";
	/** Keep an ungraded text response on the learner's device instead of reporting it. */
	private?: boolean;
	/** Optional visible label for the assessment action button. */
	buttonLabel?: string;
	points?: number;
	attempts?: number;
	required?: boolean;
	display?: "standard" | "scenario";
	layout?: BlockLayoutMode;
	layoutMode?: BlockLayoutMode;
}

export interface StatsBlockData {
	items: Array<{
		id: string;
		value: string;
		label: string;
	}>;
	columns?: 2 | 3 | 4;
	size?: "default" | "large" | "very-large";
	caption?: string;
}

export interface ChoiceResponse {
	type: "choice";
	selectionMode: "single" | "multiple";
	inputMethod: "click" | "drag" | "dropdown";
	options: { id: string; label: string; isCorrect?: boolean; image?: string; feedback?: string }[];
	display: "list" | "grid" | "ab";
	shuffle: boolean;
	feedbackMode?: "unified" | "perChoice";
}

export interface MatchingResponse {
	type: "matching";
	inputMethod: "drag" | "dropdown";
	pairs: { id: string; prompt: string; correctMatch: string; feedback?: string }[];
	distractors?: string[];
	/** Author override for the match dropdown placeholder. Falls back to the localized default. */
	placeholder?: string;
}

export interface SequenceResponse {
	type: "sequence";
	inputMethod: "drag" | "dropdown";
	items: { id: string; label: string; correctPosition: number; feedback?: string }[];
}

export interface TextResponseConfig {
	type: "textResponse";
	inputType: "short" | "long" | "numeric";
	maxLength?: number;
	acceptedAnswers?: string[];
	numericRange?: { min: number; max: number };
	matching?: {
		fuzzy?: { enabled: boolean; threshold: number };
		stemming?: boolean;
		synonyms?: string[][];
	};
	/** Author override for the input placeholder. Falls back to the localized default. */
	placeholder?: string;
	/** Optional learner download controls for the response. */
	downloadAs?: "txt" | "docx" | "both";
}

export interface FillBlankResponse {
	type: "fillBlank";
	style?: "inline-inputs" | "dropdown" | "word-bank";
	/** Shared, consumable options; duplicate entries allow repeated selections. */
	wordBank?: string[];
	/** Authored sentence with `{answer}` or `____` tokens rendered as inline inputs. */
	template?: string;
	blanks: {
		id: string;
		answer: string;
		/** Raw typed-answer syntax when escapes distinguish literal and wildcard punctuation. */
		answerSources?: string[];
		alternatives?: string[];
		choices?: string[];
	}[];
	/** Author override for the blank input placeholder. Falls back to the localized default. */
	placeholder?: string;
}

export interface CategorizeResponse {
	type: "categorize";
	categories: {
		id: string;
		name: string;
		image?: string;
		imageAlt?: string;
		items: string[];
	}[];
}

export interface HotspotResponse {
	type: "hotspot";
	image: string;
	imageAlt?: string;
	mode: "select" | "label";
	selectionMode?: "single" | "multiple";
	hotspots: {
		id: string;
		shape: "rect" | "ellipse" | "polygon";
		/** Percent of image axes: rect [left, top, width, height], ellipse [cx, cy, rx, ry] (legacy circle [cx, cy, radius]), polygon [x1, y1, ...]. */
		coords: number[];
		label?: string;
		isCorrect?: boolean;
		feedback?: string;
		indicator?: {
			type: "number" | "emoji" | "none";
			emoji?: string;
		};
	}[];
	labels?: string[];
}

export interface MatrixResponse {
	type: "matrix";
	selectionMode?: "single" | "multiple";
	statements: { id: string; text: string; correctValues?: number[] }[];
	scalePoints: { id?: string; value: number; label: string }[];
}

export interface FileUploadResponse {
	type: "fileUpload";
	acceptedTypes: string[];
	maxFileSize: number;
	maxFiles: number;
	instructions?: string;
}

export interface AudioRecordingResponse {
	type: "audioRecording";
	maxDuration: number;
	maxAttempts?: number;
}

export interface VideoRecordingResponse {
	type: "videoRecording";
	maxDuration: number;
	maxAttempts?: number;
}

export interface SpeechResponse {
	type: "speech";
	expectedAnswer?: string;
	matching?: TextResponseConfig["matching"];
	language?: string;
}

export interface DictationResponse {
	type: "dictation";
	audioSrc: string;
	expectedText: string;
	matching?: TextResponseConfig["matching"];
}

// === Logic Types ===

export interface VariableBlockData {
	variableName: string;
	dataType: "number" | "text" | "boolean";
	source: "manual" | "url_parameter" | "lms" | "computed";
	defaultValue?: string | number | boolean;
	locked?: boolean;
	// URL parameter source
	urlParamName?: string;
	urlParamFallback?: string | number | boolean;
	// LMS source
	lmsField?: string;
	lmsFallback?: string | number | boolean;
}

export type ComparisonOp =
	| "is"
	| "isNot"
	| "gt"
	| "lt"
	| "gte"
	| "lte"
	| "contains"
	| "doesNotContain"
	| "startsWith"
	| "doesNotStartWith"
	| "endsWith"
	| "doesNotEndWith"
	| "isEmpty"
	| "isNotEmpty"
	| "isAnyOf"
	| "isNotAnyOf"
	| "isEveryOf";

export interface LogicRule {
	source: string;
	field?: string;
	comparison: ComparisonOp;
	value: string | number | boolean | string[];
}

export interface CompoundOperation {
	operation: "assign" | "add" | "subtract" | "multiply" | "divide" | "concat";
	operand: number | string | boolean | { ref: string; field?: string };
}

export type ActionType =
	| "show"
	| "hide"
	| "jumpToPage"
	| "setVariable"
	| "require"
	| "disableCompletion";

export interface LogicAction {
	type: ActionType;
	targets: string[];
	reason?: string;
	value?: string | number | boolean | CompoundOperation;
}

export interface LogicBlockData {
	conditions: {
		operator: "and" | "or";
		rules: LogicRule[];
	};
	actions: LogicAction[];
}

// === Assessment Group ===

export type AssessmentGroupMode = "all" | "oneOf";

export interface AssessmentGroupBlockData {
	groupName: string;
	/** Internal projection flag: this group replaces its page's standalone heading. */
	_foldedPageTitle?: boolean;
	/** Authored heading level; older blocks default to H2. */
	_headingLevel?: number;
	mode: AssessmentGroupMode;
	memberBlockIds: string[];
	layout?: BlockLayoutMode;
	layoutMode?: BlockLayoutMode;
	/** Optional visible label for the group action button. */
	buttonLabel?: string;
	/** Publish-time outline adjustment; not authored grammar. */
	headingOffset?: number;
	requireAll?: boolean;
	pointsOverride?: number;
	passingScore?: number;
	showResultsSummary?: boolean;
}

// === Page Break ===

export interface PageBreakBlockData {
	label?: string;
	title?: string;
	[key: string]: unknown;
}

// === Block Break ===

export type BlockBreakBlockData = Record<string, never>;

// === Chart Types ===

export interface ChartBlockData {
	chartType: "bar" | "line" | "scatter" | "area" | "radar" | "stacked";
	stacked?: boolean;
	showLines?: boolean;
	showPoints?: boolean;
	chartConfig: Record<string, unknown>;
	title?: string;
	subtitle?: string;
	caption?: string;
	altText?: string;
	xAxisLabel?: string;
	yAxisLabel?: string;
	orientation?: "vertical" | "horizontal";
	sortOrder?: "none" | "asc" | "desc";
	sortSeriesIndex?: number;
	data: {
		labels: string[];
		series: { name: string; values: number[] }[];
	};
	colorScheme?: string;
}

// === Course-level Data Blocks ===

/** Data for a resource entry block. Stored in the resources pseudo-lesson. */
export interface ResourceEntryData {
	/** Display title */
	title: string;
	/** Description shown on the resources page */
	description: string;
	/** Resource type: file (uploaded asset), link (external URL), or lessonPdf (auto-generated) */
	resourceType: "file" | "link" | "lessonPdf";
	/** Asset ID for file type resources */
	assetId?: string;
	/** URL for link type resources */
	url?: string;
	/** Lesson ID for lessonPdf type resources */
	lessonId?: string;
	/** Whether to include this resource on the published Resources page */
	includeInResourcesPage: boolean;
	/** File size in bytes (for display) */
	fileSizeBytes?: number;
	/** MIME type (for file type icon) */
	mimeType?: string;
}

/** IDs used in DOM references must be safe tokens. UUID identities satisfy this contract. */
export function isValidNodeId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

/** Durable content identities use lowercase UUID-shaped tokens. */
export function isIdentityNodeId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
	);
}

/** Read-view identity has no durable UUID representation. */
export function isRuntimeNodeId(value: unknown): value is string {
	return typeof value === "string" && /^rt-[0-9a-f]{32}$/u.test(value);
}

/** Display joins accept stored identity and runtime identity; durable ingress does not. */
export function isDisplayNodeId(value: unknown): value is string {
	return isIdentityNodeId(value) || isRuntimeNodeId(value);
}

const STATEFUL_BLOCK_TYPES = new Set<BlockType>([
	"accordion",
	"assessment",
	"assessmentGroup",
	"button",
	"card",
	"checklist",
	"imageComparison",
	"labeledGraphic",
	"rating",
	"sequence",
	"signature",
	"tabs",
]);
/** Runtime controls whose state belongs in the learner snapshot. */
export function isStatefulBlock(block: PraxityBlock): boolean {
	return STATEFUL_BLOCK_TYPES.has(block.type);
}
