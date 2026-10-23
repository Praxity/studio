import { NOTE_COLORS } from "@praxity/content-model/types";
import { type BlockStatus, isCoreBlockType } from "./supported-blocks.ts";
import { GRAMMAR4_ENUMS } from "./v4/schema.ts";

export interface VariantAxis {
	name: string;
	type: "enum" | "slider" | "boolean";
	options?: ManifestOption[];
	default: string | number | boolean;
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
	appliesTo?: string[];
}

export type ManifestOption = string | { value: string; implemented: boolean };

export function isOptionImplemented(option: ManifestOption): boolean {
	return typeof option === "string" || option.implemented;
}

export function getOptionValue(option: ManifestOption): string {
	return typeof option === "string" ? option : option.value;
}

export interface ManifestParameter {
	name: string;
	type: string;
	required: boolean;
	options?: ManifestOption[];
	/**
	 * Whether setting this parameter changes the published output.
	 *
	 * Absent means implemented. `false` marks a parameter that parses and
	 * validates but that no renderer or exporter reads — a real intention that is
	 * not wired up yet. Authoring UI must not offer these as though they work;
	 * the same distinction `ManifestOption.implemented` already draws for
	 * individual enum values.
	 */
	implemented?: boolean;
}

type KeywordLayer = "content" | "container" | "interaction" | "decorator";
export type KeywordCategory = "content" | "flow" | "assessment" | "interactive";

export interface KeywordManifest {
	keyword: string;
	label: string;
	layer: KeywordLayer;
	category: KeywordCategory;
	status: BlockStatus;
	variants: VariantAxis[];
	parameters: ManifestParameter[];
}

type ManifestEntry = Omit<KeywordManifest, "category" | "status">;

const ASSESSMENT_KEYWORDS = new Set([
	"assessment-group",
	"choose-one",
	"choose-many",
	"match",
	"order",
	"free-response",
	"categorize",
	"fill-blank",
	"hotspot",
	"rate",
	"matrix",
]);

const INTERACTIVE_KEYWORDS = new Set(["checklist", "signature"]);

const ASSESSMENT_DECORATOR_PARAMETERS: ManifestParameter[] = [
	{ name: "scored", type: "boolean", required: false },
	// competency / confidence / retrieval parse and validate but nothing reads
	// them — see INERT_PARAMETERS below.
	{ name: "competency", type: "text", required: false, implemented: false },
	{ name: "confidence", type: "boolean", required: false, implemented: false },
	{ name: "retrieval", type: "boolean", required: false, implemented: false },
	{ name: "feedback", type: "enum", required: false },
	{ name: "description", type: "text", required: false },
	{
		name: "display",
		type: "enum",
		required: false,
		options: [...GRAMMAR4_ENUMS["choice.display"].values],
	},
];

/** Keywords whose response controls render a placeholder authors can override. */
const PLACEHOLDER_KEYWORDS = new Set(["free-response", "fill-blank", "match"]);

const SHUFFLE_KEYWORDS = new Set(["choose-one", "choose-many", "match", "order", "categorize"]);

const ASSESSMENT_SHARED_PARAMETERS: ManifestParameter[] = [
	{ name: "points", type: "number", required: false },
	{ name: "required", type: "boolean", required: false },
	{ name: "timed", type: "number", required: false, implemented: false },
	// `pass` is deliberately absent: it duplicated `passingScore`, and it was the
	// inert half of the pair. `passingScore` is the canonical name and is read at
	// AssessmentGroupBlock.tsx:15. `pass` still validates via assessment-schema so
	// existing .prax files keep parsing, but authoring UI no longer teaches it.
	{ name: "attempts", type: "number", required: false },
];

/**
 * Parameters that parse and validate but that no renderer or exporter reads.
 *
 * Each is an intended capability — competency mapping, confidence-based
 * assessment, retrieval practice, timed questions — that is not wired to output
 * yet. They stay in the manifest so the grammar keeps accepting them and the
 * intent stays recorded, but they carry `implemented: false` so authoring UI can
 * rank and label them honestly instead of presenting them as working settings.
 *
 * Asserted exhaustively by `manifest.test.ts`. Implementing one, or discovering
 * another, must update this list deliberately rather than silently.
 */
export const INERT_PARAMETERS: ReadonlySet<string> = new Set([
	"visual",
	"competency",
	"confidence",
	"retrieval",
	"timed",
]);

export const UNIVERSAL_PARAMETERS: ManifestParameter[] = [
	{
		name: "width",
		type: "enum",
		required: false,
		options: [...GRAMMAR4_ENUMS["text.width"].values],
	},
];

function buildAssessmentParameters(keyword: string) {
	return [
		...ASSESSMENT_DECORATOR_PARAMETERS,
		...(["choose-one", "choose-many"].includes(keyword)
			? [
					{ name: "correct", type: "text", required: false },
					{ name: "incorrect", type: "text", required: false },
				]
			: []),
		...(["choose-one", "choose-many", "match", "order", "fill-blank", "categorize"].includes(
			keyword,
		)
			? [{ name: "feedbackMode", type: "enum", required: false, options: ["retry", "reveal"] }]
			: []),
		...(keyword === "free-response"
			? [
					{ name: "buttonLabel", type: "text", required: false },
					{ name: "private", type: "boolean", required: false },
					{
						name: "downloadAs",
						type: "enum",
						required: false,
						options: ["txt", "docx", "both"],
					},
				]
			: []),
		...(PLACEHOLDER_KEYWORDS.has(keyword)
			? [{ name: "placeholder", type: "text", required: false }]
			: []),
		...(SHUFFLE_KEYWORDS.has(keyword)
			? [{ name: "shuffle", type: "boolean", required: false }]
			: []),
		...(keyword === "rate"
			? []
			: [{ name: "deckGate", type: "enum", required: false, options: ["attempt", "pass"] }]),
		...ASSESSMENT_SHARED_PARAMETERS,
	];
}

function getCategoryForEntry(entry: ManifestEntry): KeywordCategory {
	if (entry.layer === "container") return "flow";
	if (entry.layer === "content" || entry.layer === "decorator") return "content";
	if (ASSESSMENT_KEYWORDS.has(entry.keyword)) return "assessment";
	if (INTERACTIVE_KEYWORDS.has(entry.keyword)) return "interactive";
	return "interactive";
}

const BLOCK_MANIFEST_ENTRIES: ManifestEntry[] = [
	// Content primitives — no variant axes
	{
		keyword: "text",
		label: "Text",
		layer: "content",
		variants: [],
		parameters: [],
	},
	{
		keyword: "heading",
		label: "Heading",
		layer: "content",
		variants: [],
		parameters: [
			{ name: "display", type: "enum", required: false, options: ["standard", "chapter"] },
			{ name: "kicker", type: "string", required: false },
			{ name: "pageStyle", type: "string", required: false },
			{ name: "level", type: "number", required: false },
		],
	},
	{
		keyword: "image",
		label: "Image",
		layer: "content",
		variants: [
			{
				name: "size",
				type: "enum",
				options: ["small", "medium", "large"],
				default: "",
			},
			{
				name: "alignment",
				type: "enum",
				options: ["left", "center", "right"],
				default: "",
			},
		],
		parameters: [
			{
				name: "treatment",
				type: "enum",
				required: false,
				options: ["none", "grayscale", "tint", "duotone", "grain", "dither", "blur"],
			},
			{ name: "captionEnabled", type: "boolean", required: false },
			{ name: "src", type: "string", required: true },
			{ name: "alt", type: "string", required: true },
			{ name: "decorative", type: "boolean", required: false },
			{ name: "caption", type: "string", required: false },
			{ name: "float", type: "enum", required: false, options: ["left", "right"] },
			{
				name: "ratio",
				type: "enum",
				required: false,
				options: [...GRAMMAR4_ENUMS["image.ratio"].values],
			},
			{
				name: "fit",
				type: "enum",
				required: false,
				options: [...GRAMMAR4_ENUMS["image.fit"].values],
			},
			{ name: "effects", type: "map|none", required: false },
		],
	},
	{
		keyword: "video",
		label: "Video",
		layer: "content",
		variants: [],
		parameters: [
			{ name: "src", type: "string", required: true },
			{ name: "title", type: "string", required: false },
			{ name: "caption", type: "string", required: false },
			{ name: "captions", type: "string", required: false },
			{ name: "transcript", type: "string", required: false },
			{ name: "start", type: "number", required: false },
			{ name: "end", type: "number", required: false },
			{ name: "captionEnabled", type: "boolean", required: false },
			{ name: "autoplay", type: "boolean", required: false },
		],
	},
	{
		keyword: "audio",
		label: "Audio",
		layer: "content",
		variants: [],
		parameters: [
			{ name: "caption", type: "string", required: false },
			{ name: "transcript", type: "string", required: false },
			{ name: "captionEnabled", type: "boolean", required: false },
			{ name: "src", type: "string", required: true },
			{ name: "title", type: "string", required: false },
		],
	},
	{
		keyword: "divider",
		label: "Divider",
		layer: "content",
		variants: [],
		parameters: [],
	},
	{
		keyword: "embed",
		label: "Embed",
		layer: "content",
		variants: [],
		parameters: [
			{ name: "title", type: "string", required: false },
			{ name: "height", type: "number", required: false },
			{ name: "src", type: "string", required: true },
		],
	},
	{
		keyword: "bookmark",
		label: "Bookmark",
		layer: "content",
		variants: [],
		parameters: [{ name: "href", type: "string", required: true }],
	},
	{
		keyword: "note",
		label: "Note",
		layer: "content",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["note.style"].values],
				default: "shaded",
			},
			{
				name: "color",
				type: "enum",
				options: [...NOTE_COLORS],
				default: "accent",
			},
		],
		parameters: [
			{ name: "title", type: "text", required: false },
			{ name: "icon", type: "string", required: false },
		],
	},
	{
		keyword: "quote",
		label: "Quote",
		layer: "content",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["quote.style"].values],
				default: "default",
			},
		],
		parameters: [
			{ name: "speaker", type: "text", required: false },
			{ name: "work", type: "text", required: false },
			{ name: "sourceUrl", type: "string", required: false },
		],
	},
	{
		keyword: "dialogue",
		label: "Dialogue",
		layer: "content",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["dialogue.style"].values],
				default: "bubbles",
			},
		],
		parameters: [
			{ name: "caption", type: "text", required: false },
			{ name: "speaker", type: "string", required: false },
		],
	},
	{
		keyword: "code",
		label: "Code",
		layer: "content",
		variants: [],
		parameters: [{ name: "language", type: "string", required: false }],
	},
	{
		keyword: "equation",
		label: "Equation",
		layer: "content",
		variants: [],
		parameters: [],
	},
	{
		keyword: "button",
		label: "Button",
		layer: "content",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["button.style"].values],
				default: "filled",
			},
		],
		parameters: [
			{ name: "text", type: "string", required: true },
			{ name: "href", type: "string", required: true },
			{ name: "openInNewTab", type: "boolean", required: false },
		],
	},
	{
		keyword: "data-table",
		label: "Data Table",
		layer: "content",
		variants: [],
		parameters: [
			{ name: "title", type: "string", required: false },
			{ name: "caption", type: "string", required: false },
			{
				name: "header",
				type: "enum",
				required: false,
				options: [...GRAMMAR4_ENUMS["table.header"].values],
			},
			{ name: "shadeHeaders", type: "boolean", required: false },
			{ name: "firstRowLine", type: "boolean", required: false },
			{ name: "firstColLine", type: "boolean", required: false },
			{ name: "columnAlignments", type: "string", required: false },
			{ name: "striped", type: "boolean", required: false },
			{ name: "highlightHeaderRow", type: "boolean", required: false },
			{ name: "highlightHeaderCol", type: "boolean", required: false },
			{
				name: "gridlines",
				type: "enum",
				required: false,
				options: [...GRAMMAR4_ENUMS["table.gridlines"].values],
			},
			{
				name: "chart",
				type: "enum",
				required: false,
				options: [...GRAMMAR4_ENUMS["table.chart"].values],
			},
			{
				name: "orientation",
				type: "enum",
				required: false,
				options: [...GRAMMAR4_ENUMS["table.orientation"].values],
			},
			{ name: "subtitle", type: "string", required: false },
			{ name: "altText", type: "string", required: false },
			{ name: "xLabel", type: "string", required: false },
			{ name: "yLabel", type: "string", required: false },
			{ name: "stacked", type: "boolean", required: false },
			{ name: "showLines", type: "boolean", required: false },
			{ name: "showPoints", type: "boolean", required: false },
			{
				name: "sortOrder",
				type: "enum",
				required: false,
				options: [...GRAMMAR4_ENUMS["table.sortOrder"].values],
			},
			{ name: "colors", type: "string", required: false, implemented: false },

			{
				name: "visual",
				type: "enum",
				required: false,
				options: ["table", "chart"],
				implemented: false,
			},
		],
	},
	{
		keyword: "stats",
		label: "Stats",
		layer: "content",
		variants: [
			{
				name: "size",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["stats.size"].values],
				default: "default",
			},
		],
		parameters: [
			{ name: "columns", type: "number", required: false },
			{ name: "caption", type: "string", required: false },
		],
	},

	// Containers
	{
		keyword: "accordion",
		label: "Accordion",
		layer: "container",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["accordion.style"].values],
				default: "default",
			},
			{
				name: "allowMultipleOpen",
				type: "boolean",
				default: false,
			},
		],
		parameters: [],
	},
	{
		keyword: "tabs",
		label: "Tabs",
		layer: "container",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["tabs.style"].values],
				default: "default",
			},
			{
				name: "orientation",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["tabs.orientation"].values],
				default: "horizontal",
			},
		],
		parameters: [],
	},
	{
		keyword: "columns",
		label: "Columns",
		layer: "container",
		variants: [],
		parameters: [{ name: "weight", type: "number", required: false }],
	},
	{
		keyword: "card",
		label: "Card",
		layer: "container",
		variants: [
			{
				name: "layout",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["cards.layout"].values],
				default: "grid",
			},
			{
				name: "style",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["cards.style"].values],
				default: "none",
			},
			{
				name: "shadow",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["cards.shadow"].values],
				default: "theme",
			},
			{
				name: "transition",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["cards.transition"].values],
				default: "fade",
			},
		],
		parameters: [
			{
				name: "media",
				type: "enum",
				required: false,
				options: [...GRAMMAR4_ENUMS["cards.media"].values],
			},
			{ name: "columns", type: "number", required: false },
			{ name: "headingLevel", type: "number", required: false },
			{ name: "headings", type: "boolean", required: false },
			{ name: "advance", type: "number", required: false },
			{ name: "showProgress", type: "boolean", required: false },
			{ name: "shuffle", type: "boolean", required: false },
			{ name: "trackCompletion", type: "boolean", required: false },
		],
	},
	{
		keyword: "sequence",
		label: "Sequence",
		layer: "container",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["sequence.style"].values],
				default: "numbered",
			},
			{
				name: "orientation",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["sequence.orientation"].values],
				default: "vertical",
			},
			{
				name: "alignment",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["sequence.alignment"].values],
				default: "left",
			},
		],
		parameters: [
			{
				name: "distribution",
				type: "enum",
				required: false,
				options: [...GRAMMAR4_ENUMS["sequence.distribution"].values],
			},
			{ name: "scrollable", type: "boolean", required: false },
		],
	},
	{
		keyword: "comparison",
		label: "Comparison",
		layer: "container",
		variants: [
			{
				name: "layout",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["comparison.layout"].values],
				default: "side-by-side",
			},
		],
		parameters: [],
	},

	// Interactions (assessments)
	{
		keyword: "choose-one",
		label: "Single Choice",
		layer: "interaction",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [
					"radio",
					{ value: "card-select", implemented: false },
					{ value: "image-select", implemented: false },
					{ value: "inline-dropdown", implemented: false },
				],
				default: "radio",
			},
		],
		parameters: buildAssessmentParameters("choose-one"),
	},
	{
		keyword: "choose-many",
		label: "Multiple Choice",
		layer: "interaction",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [
					"checkbox",
					{ value: "grid", implemented: false },
					{ value: "tag-picker", implemented: false },
				],
				default: "checkbox",
			},
		],
		parameters: buildAssessmentParameters("choose-many"),
	},
	{
		keyword: "match",
		label: "Matching",
		layer: "interaction",
		variants: [
			{
				name: "style",
				type: "enum",
				options: ["select-dropdowns", { value: "line-drawing", implemented: false }],
				default: "select-dropdowns",
			},
		],
		parameters: buildAssessmentParameters("match"),
	},
	{
		keyword: "order",
		label: "Ordering",
		layer: "interaction",
		variants: [
			{
				name: "style",
				type: "enum",
				options: ["up-down-arrows", { value: "numbered-input", implemented: false }],
				default: "up-down-arrows",
			},
		],
		parameters: buildAssessmentParameters("order"),
	},
	{
		keyword: "free-response",
		label: "Free Response",
		layer: "interaction",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [
					"textarea",
					{ value: "rich-text", implemented: false },
					{ value: "recording", implemented: false },
				],
				default: "textarea",
			},
		],
		parameters: buildAssessmentParameters("free-response"),
	},
	{
		keyword: "hotspot",
		label: "Hotspot",
		layer: "interaction",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [
					"click-regions",
					{ value: "labeled-diagram", implemented: false },
					{ value: "description-list", implemented: false },
				],
				default: "click-regions",
			},
		],
		parameters: [
			...buildAssessmentParameters("hotspot"),
			{ name: "alt", type: "string", required: false },
			{ name: "spot", type: "string", required: false },
		],
	},
	{
		keyword: "rate",
		label: "Rating",
		layer: "interaction",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["rating.style"].values],
				default: "likert",
			},
		],
		parameters: [{ name: "required", type: "boolean", required: false }],
	},
	{
		keyword: "fill-blank",
		label: "Fill in the Blank",
		layer: "interaction",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["fill-blank.style"].values],
				default: "inline-inputs",
			},
		],
		parameters: [
			...buildAssessmentParameters("fill-blank"),
			{ name: "bank", type: "text", required: false },
		],
	},
	{
		keyword: "categorize",
		label: "Categorize",
		layer: "interaction",
		variants: [],
		parameters: buildAssessmentParameters("categorize"),
	},
	{
		keyword: "matrix",
		label: "Matrix",
		layer: "interaction",
		variants: [
			{
				name: "style",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["matrix.style"].values],
				default: "likert",
			},
		],
		parameters: buildAssessmentParameters("matrix"),
	},
	{
		keyword: "assessment-group",
		label: "Assessment Group",
		layer: "interaction",
		variants: [
			{
				name: "mode",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["group.mode"].values],
				default: "all",
			},
		],
		parameters: [
			{ name: "buttonLabel", type: "text", required: false },
			{ name: "showResultsSummary", type: "boolean", required: false },
			{ name: "pointsOverride", type: "number", required: false },
			{ name: "passingScore", type: "number", required: false },
			{
				name: "deckGate",
				type: "enum",
				required: false,
				options: [...GRAMMAR4_ENUMS["group.deckGate"].values],
			},
			{ name: "requireAll", type: "boolean", required: false },
		],
	},
	{
		keyword: "checklist",
		label: "Checklist",
		layer: "interaction",
		variants: [],
		parameters: [
			{ name: "shuffle", type: "boolean", required: false },
			{ name: "required", type: "boolean", required: false },
		],
	},
	{
		keyword: "signature",
		label: "Signature",
		layer: "interaction",
		variants: [
			{
				name: "mode",
				type: "enum",
				options: [...GRAMMAR4_ENUMS["signature.mode"].values],
				default: "draw",
			},
		],
		parameters: [
			{ name: "required", type: "boolean", required: false },
			{ name: "sublabel", type: "string", required: false },
			{ name: "label", type: "string", required: true },
		],
	},
];

/** Block types each authoring keyword can produce through the v3 parser. */
const KEYWORD_BLOCK_TYPES: Record<string, readonly string[]> = {
	text: ["text"],
	heading: ["heading"],
	image: ["image"],
	video: ["video"],
	audio: ["audio"],
	divider: ["divider"],
	embed: ["embed", "document"],
	bookmark: ["embed"],
	note: ["note"],
	quote: ["quote"],
	dialogue: ["dialogue"],
	code: ["code"],
	equation: ["equation"],
	button: ["button"],
	"data-table": ["table", "chart"],
	stats: ["stats"],
	accordion: ["accordion"],
	tabs: ["tabs"],
	columns: ["columns"],
	card: ["card"],
	sequence: ["sequence"],
	comparison: ["columns"],
	"choose-one": ["assessment"],
	"choose-many": ["assessment"],
	match: ["assessment"],
	order: ["assessment"],
	"free-response": ["assessment"],
	hotspot: ["assessment"],
	rate: ["rating"],
	"fill-blank": ["assessment"],
	categorize: ["assessment"],
	matrix: ["assessment"],
	"assessment-group": ["assessmentGroup"],
	checklist: ["checklist"],
	signature: ["signature"],
};

function getStatusForEntry(entry: ManifestEntry): BlockStatus {
	const blockTypes = KEYWORD_BLOCK_TYPES[entry.keyword];
	if (!blockTypes) {
		throw new Error(`Manifest keyword "${entry.keyword}" is missing its block-type mapping.`);
	}
	return blockTypes.some(isCoreBlockType) ? "core" : "hidden";
}

export const BLOCK_MANIFEST: KeywordManifest[] = BLOCK_MANIFEST_ENTRIES.map((entry) => ({
	...entry,
	parameters: [
		...entry.parameters,
		...UNIVERSAL_PARAMETERS.filter(
			(universalParam) =>
				![...entry.parameters, ...entry.variants].some(
					(param) => param.name === universalParam.name,
				),
		),
	],
	category: getCategoryForEntry(entry),
	status: getStatusForEntry(entry),
}));

let allManifestCache: Map<string, KeywordManifest> | null = null;
let coreManifestCache: Map<string, KeywordManifest> | null = null;

export function getManifest(options?: { include?: "core" | "all" }): Map<string, KeywordManifest> {
	if (!allManifestCache) {
		allManifestCache = new Map(BLOCK_MANIFEST.map((entry) => [entry.keyword, entry]));
	}
	if (options?.include === "all") {
		return allManifestCache;
	}
	if (!coreManifestCache) {
		coreManifestCache = new Map(
			BLOCK_MANIFEST.filter((entry) => entry.status === "core").map((entry) => [
				entry.keyword,
				entry,
			]),
		);
	}
	return coreManifestCache;
}

export function getVariantAxes(keyword: string): VariantAxis[] {
	const entry = getManifest({ include: "all" }).get(keyword);
	return entry ? entry.variants : [];
}

export function getAllKeywords(): string[] {
	return Array.from(getManifest({ include: "all" }).keys());
}
