import type { SectionPaletteName } from "./constants";

export interface SelfCheckPrompt {
	task: string;
	parts: { id: string }[];
}

export interface RetrievalSheetContent {
	title: string;
	questions: { id: string; question: string; answer: string }[];
}
export interface RetrievalSheetData {
	content: RetrievalSheetContent;
	level: number;
}

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

export type BlockType =
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
	| "accordion"
	| "tabs"
	| "columns"
	| "sequence"
	| "card"
	| "labeledGraphic"
	| "checklist"
	| "rating"
	| "signature"
	| "selfCheck"
	| "retrievalSheet"
	| "highlight"
	| "writeDistractors"
	| "assessment"
	| "variable"
	| "logic"
	| "assessmentGroup"
	| "pageBreak"
	| "blockBreak"
	| "resourceEntry";

export const BLOCK_TYPES = [
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
	"accordion",
	"tabs",
	"columns",
	"sequence",
	"card",
	"labeledGraphic",
	"checklist",
	"rating",
	"signature",
	"selfCheck",
	"retrievalSheet",
	"highlight",
	"writeDistractors",
	"assessment",
	"variable",
	"logic",
	"assessmentGroup",
	"pageBreak",
	"blockBreak",
	"resourceEntry",
] as const satisfies readonly BlockType[];

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
	locale?: string;
	sectionTheme?: SectionPaletteName;
}

export interface PraxityPage {
	locale?: string;
	id: string;
	title: string;
	data?: Record<string, unknown>;
	description?: string;
	blocks: PraxityBlock[];
	settings?: {
		lockUntilComplete?: string[];
	};
	lessonId?: string;
	lessonTitle?: string;
	lessonTitleIsFallback?: boolean;
	lessonKicker?: string;
	lessonTime?: string;
	isFirstPageOfLesson?: boolean;
	narrationEnabled?: boolean;
	narrationDefaults?: Record<string, unknown>;
}

export interface Lesson {
	id: string;
	title: string;
	firstPageTitle?: string;
	sortOrder: number;
	pages: LessonPage[];
	blocks: PraxityBlock[];
	settings?: LessonSettings;
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

export interface TextBlockData {
	content: string;
	reveal?: number | string | boolean;
}

export interface HeadingBlockData {
	content: string;
	level: 1 | 2 | 3;
	kicker?: string;
	headingOffset?: number;
	display?: "standard" | "chapter";
}

export type BlockLayoutMode = "narrow" | "wide" | "full" | "breakout";

export interface SlideStyleDef {
	accentRule?: boolean;
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
	speaker?: string;
	paragraphs: string[];
	name?: string;
	avatar?: string;
	voice?: string;
	side?: "start" | "end";
}

export interface DialogueBlockData {
	turns: DialogueTurnData[];
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
	_tablerIconNodes?: unknown;
	content: string;
	style: NoteStyle | "filled";
	color: NoteColor;
}

export interface CodeBlockData {
	code: string;
	language: string;
	title?: string;
	showLineNumbers?: boolean;
	highlightLines?: number[];
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

export interface ColumnItem {
	id: string;
	width: number;
	label?: string;
	children: PraxityBlock[];
}

export interface ColumnsBlockData {
	items: ColumnItem[];
	trackCompletion?: boolean;
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
	overlayColor?: "dark" | "light";
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
	stemLevel?: number;
	headingOffset?: number;
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
	feedbackMode?: "retry" | "reveal" | "unified" | "perOption";
	shuffle?: boolean;
	/** @deprecated Use `gradingMode` instead. */
	graded?: boolean;
	dontKnow?: boolean;
	_dontKnow?: boolean;
	gradingMode?: "none" | "partial" | "exact";
	private?: boolean;
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
	placeholder?: string;
	downloadAs?: "txt" | "docx" | "both";
}

export interface FillBlankResponse {
	type: "fillBlank";
	style?: "inline-inputs" | "dropdown" | "word-bank";
	wordBank?: string[];
	template?: string;
	blanks: {
		id: string;
		answer: string;
		answerSources?: string[];
		alternatives?: string[];
		choices?: string[];
	}[];
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

export interface VariableBlockData {
	variableName: string;
	dataType: "number" | "text" | "boolean";
	source: "manual" | "url_parameter" | "lms" | "computed";
	defaultValue?: string | number | boolean;
	locked?: boolean;
	urlParamName?: string;
	urlParamFallback?: string | number | boolean;
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

export type AssessmentGroupMode = "all" | "oneOf";

export interface AssessmentGroupBlockData {
	groupName: string;
	_foldedPageTitle?: boolean;
	_headingLevel?: number;
	mode: AssessmentGroupMode;
	memberBlockIds: string[];
	layout?: BlockLayoutMode;
	layoutMode?: BlockLayoutMode;
	buttonLabel?: string;
	headingOffset?: number;
	requireAll?: boolean;
	pointsOverride?: number;
	passingScore?: number;
	showResultsSummary?: boolean;
}

export interface PageBreakBlockData {
	label?: string;
	title?: string;
	[key: string]: unknown;
}

export type BlockBreakBlockData = Record<string, never>;

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

export interface ResourceEntryData {
	title: string;
	description: string;
	resourceType: "file" | "link" | "lessonPdf";
	assetId?: string;
	url?: string;
	lessonId?: string;
	includeInResourcesPage: boolean;
	fileSizeBytes?: number;
	mimeType?: string;
}

export function isValidNodeId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

export function isIdentityNodeId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
	);
}

export function isRuntimeNodeId(value: unknown): value is string {
	return typeof value === "string" && /^rt-[0-9a-f]{32}$/u.test(value);
}

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
export function isStatefulBlock(block: PraxityBlock): boolean {
	return STATEFUL_BLOCK_TYPES.has(block.type);
}
