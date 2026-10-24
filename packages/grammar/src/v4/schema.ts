import {
	decodeEscapes,
	fillBlankParts,
	parseFillBlankContent,
	splitUnescaped,
} from "@praxity/content-model";
import { SECTION_PALETTES } from "@praxity/content-model/constants";
import type { InlineNode } from "@praxity/content-model/inline-tree";
import {
	type CardBlockData,
	type HighlightContent,
	IMAGE_ALIGNMENTS,
	IMAGE_FLOATS,
	IMAGE_WIDTHS,
	type LogicAction,
	NOTE_ICON_NAME_PATTERN,
	NOTE_TONES,
	type NoteTone,
} from "@praxity/content-model/types";
import highlightSchema from "learning-patterns/patterns/highlight/content.schema.json" with {
	type: "json",
};
import { validateContent as validateHighlightContent } from "learning-patterns/patterns/highlight/logic.js";
import retrievalSheetSchema from "learning-patterns/patterns/retrieval-sheet/content.schema.json" with {
	type: "json",
};
import {
	type Content as RetrievalSheetContent,
	validateContent as validateRetrievalSheetContent,
} from "learning-patterns/patterns/retrieval-sheet/logic.js";
import {
	type Content as SelfCheckContent,
	validateContent,
} from "learning-patterns/patterns/self-check/logic.js";
import writeDistractorsSchema from "learning-patterns/patterns/write-distractors/content.schema.json" with {
	type: "json",
};
import {
	validateContent as validateWriteDistractorsContent,
	type Content as WriteDistractorsContent,
} from "learning-patterns/patterns/write-distractors/logic.js";
import { parseDocument } from "yaml";
import { displayText } from "../line-endings.ts";
import { parseLogicConditionExpression, parseLogicScalarValue } from "../logic-condition.ts";
import type { DesignVariants } from "../types.ts";
import { isSafeCaptionTrackUrl, isSafeEmbedUrl, isSafeMediaUrl } from "../utils.ts";
import { tokenizeInline } from "./inline.ts";
import { lineColumn, tokenizeLesson } from "./lex/index.ts";
import { readHeaderSettings } from "./tree/build.ts";
import type {
	AnalysisDiagnostic,
	AnalyzedLessonTree,
	BodyDefinition,
	DefinitionIssue,
	SourceSpan,
	TreeKind,
	TreeNode,
} from "./tree/index.ts";

export type HelperKind =
	| "colour"
	| "enum"
	| "toggle"
	| "stepper"
	| "icon"
	| "link"
	| "glossary"
	| "asset";
export interface HelperDefinition {
	kind: HelperKind;
	options?: readonly { value: string; labelKey: string; icon: string }[];
	/** Colour edits address a colour inside the effects expression, not the whole value. */
	subvalue?: "effect-colour";
}
export interface SettingDefinition {
	type: "enum" | "boolean" | "integer" | "number" | "icon" | "path" | "url" | "name" | "string";
	labelKey: string;
	values?: readonly string[];
	min?: number;
	max?: number;
	exclusiveMin?: boolean;
	step?: number;
	default?: string | number | boolean;
	helper?: HelperDefinition;
	accepts: (value: string | boolean) => boolean;
}
export interface SubjectDefinition {
	kind: "none" | "title" | "source" | "url" | "link";
	required: boolean;
	labelKey: string;
	helper?: HelperDefinition;
	accepts?: (value: string, raw?: string) => boolean;
}
export interface ChildConstraint {
	kind: TreeKind;
	min: number;
	max?: number;
}
export interface BlockDefinition extends BodyDefinition {
	labelKey: string;
	subject: SubjectDefinition;
	settings: Readonly<Record<string, SettingDefinition>>;
	partLabels: Readonly<Record<string, string>>;
	allowedChildren: readonly TreeKind[];
	childCounts: readonly ChildConstraint[];
	insertTemplate: string;
	itemDefinition?: BlockDefinition;
}

export const INLINE_HELPERS = {
	link: { kind: "link" },
	term: { kind: "glossary" },
	icon: { kind: "icon" },
} as const satisfies Record<string, HelperDefinition>;

// Canonical grammar 4 vocabularies are owned here.
export const GRAMMAR4_ENUMS: Readonly<
	Record<string, { values: readonly string[]; default?: string }>
> = {
	"text.width": {
		values: ["narrow", "wide", "full", "breakout"],
	},
	"choice.feedbackMode": {
		values: ["retry", "reveal"],
	},
	"choice.display": {
		values: ["standard", "scenario"],
	},
	"group.deckGate": {
		values: ["attempt", "pass"],
	},
	"self-check.deckGate": {
		values: ["attempt"],
	},
	"fill-blank.style": {
		values: ["typed", "word-bank", "dropdown"],
		default: "typed",
	},
	"note.style": {
		values: ["outline", "shaded"],
		default: "shaded",
	},
	"quote.style": {
		values: ["none", "outline", "shaded", "primary", "secondary"],
	},
	"button.style": {
		values: ["filled", "outline", "light"],
		default: "filled",
	},
	"dialogue.style": {
		values: ["bubbles", "script"],
		default: "bubbles",
	},
	"table.chart": {
		values: ["bar", "line", "scatter", "area", "radar", "stacked"],
	},
	"table.orientation": {
		values: ["vertical", "horizontal"],
	},
	"table.header": {
		values: ["row", "column", "none"],
	},
	"table.gridlines": {
		values: ["none", "rows", "columns", "inside", "all"],
	},
	"table.sortOrder": {
		values: ["none", "asc", "desc"],
	},
	"stats.size": {
		values: ["default", "large", "very-large"],
		default: "default",
	},
	"accordion.style": {
		values: ["none", "outline", "shaded", "primary", "secondary"],
	},
	"tabs.style": {
		values: ["default", "outline", "pills"],
		default: "default",
	},
	"tabs.orientation": {
		values: ["horizontal", "vertical"],
		default: "horizontal",
	},
	"sequence.style": {
		values: ["numbered", "timeline", "none"],
		default: "numbered",
	},
	"sequence.orientation": {
		values: ["vertical", "horizontal"],
		default: "vertical",
	},
	"sequence.alignment": {
		values: ["left", "center", "right"],
		default: "left",
	},
	"sequence.distribution": {
		values: ["uniform", "scaled"],
	},
	"cards.layout": {
		values: ["grid", "masonry", "slides", "rows"],
		default: "grid",
	},
	"cards.style": {
		values: ["none", "outline", "shaded", "primary", "secondary"],
		default: "none",
	},
	"cards.shadow": {
		values: ["theme", "none", "subtle", "elevated"],
		default: "theme",
	},
	"cards.media": {
		values: ["inset", "flush"],
	},
	"cards.transition": {
		values: ["none", "fade", "slide", "zoom"],
		default: "fade",
	},
	"comparison.layout": {
		values: ["slider", "side-by-side"],
		default: "side-by-side",
	},
	"free-response.download": {
		values: ["txt", "docx", "both"],
	},
	"rating.style": {
		values: ["likert", "stars", "slider"],
		default: "likert",
	},
	"matrix.style": {
		values: ["likert"],
		default: "likert",
	},
	"group.mode": {
		values: ["all", "oneOf"],
		default: "all",
	},
	"signature.mode": {
		values: ["draw", "type"],
		default: "draw",
	},
	"image.ratio": {
		values: ["square", "4:3", "3:2", "16:9"],
	},
	"image.fit": {
		values: ["contain", "cover"],
	},
};
function schemaEnum(type: string, setting: string): readonly string[] {
	const vocabulary = GRAMMAR4_ENUMS[type + "." + setting];
	if (!vocabulary) throw new Error("Missing schema vocabulary: " + type + "." + setting);
	return vocabulary.values;
}
function enumSetting(
	name: string,
	values: readonly string[],
	defaultValue?: string,
): SettingDefinition {
	return {
		type: "enum",
		labelKey: `grammar.v4.setting.${name}`,
		values,
		default: defaultValue,
		accepts: (value) => typeof value === "string" && values.includes(value),
		helper: {
			kind: "enum",
			options: values.map((value) => ({
				value,
				labelKey: `grammar.v4.value.${name}.${value}`,
				icon: "adjustments",
			})),
		},
	};
}
function vocabularySetting(type: string, name: string): SettingDefinition {
	const vocabulary = GRAMMAR4_ENUMS[type + "." + name];
	return enumSetting(name, schemaEnum(type, name), vocabulary?.default);
}
function scalar(
	name: string,
	type: SettingDefinition["type"],
	helper?: HelperKind,
	accepts: SettingDefinition["accepts"] = (value) =>
		typeof value === "string" && value.trim().length > 0,
): SettingDefinition {
	return {
		type,
		labelKey: `grammar.v4.setting.${name}`,
		accepts,
		...(helper ? { helper: { kind: helper } } : {}),
	};
}
function toggle(name: string, defaultValue?: boolean): SettingDefinition {
	return {
		...scalar(
			name,
			"boolean",
			"toggle",
			(value) => typeof value === "boolean" || value === "true" || value === "false",
		),
		// Parameter defaults often live in renderers. Do not invent false for omitted settings.
		default: defaultValue,
	};
}
function numberSetting(
	name: string,
	min: number,
	max?: number,
	integer = false,
	exclusiveMin = false,
): SettingDefinition {
	return {
		...scalar(name, integer ? "integer" : "number", "stepper", (value) => {
			if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return false;
			const n = Number(value);
			return (
				Number.isFinite(n) &&
				(!integer || Number.isInteger(n)) &&
				(exclusiveMin ? n > min : n >= min) &&
				(max === undefined || n <= max)
			);
		}),
		min,
		max,
		exclusiveMin,
		step: integer ? 1 : undefined,
	};
}
const columns = numberSetting("columns", 2, 4, true);
// These legacy vocabularies have types but no runtime export. Exhaustive keys keep them tied to their owners.
const entranceIcons = {
	none: "minus",
	fade: "blur",
	slide: "arrows-right",
	scale: "arrows-diagonal",
} satisfies Record<NonNullable<DesignVariants["motionEntrance"]>, string>;
const universal = {
	width: vocabularySetting("text", "width"),
	name: scalar(
		"name",
		"name",
		undefined,
		(v) => typeof v === "string" && /^[A-Za-z][A-Za-z0-9-]*$/.test(v),
	),
	hide: toggle("hide"),
	visible: scalar("visible", "string"),
	entrance: enumSetting("entrance", Object.keys(entranceIcons), "none"),
	level: numberSetting("level", 1, 6, true),
};
// NoteTone has no runtime constant. This exhaustive record is checked against its owning type.
const toneIcons = {
	note: "info-circle",
	info: "info-circle",
	tip: "bulb",
	success: "circle-check",
	warning: "alert-triangle",
} satisfies Record<NoteTone, string>;
const tone = enumSetting("tone", NOTE_TONES, "note");
// CardBlockData has no runtime colour vocabulary; exhaustive keys track its owner.
const cardColours = { primary: true, secondary: true } satisfies Record<
	NonNullable<CardBlockData["color"]>,
	boolean
>;
tone.helper = {
	kind: "enum",
	options: Object.entries(toneIcons).map(([value, icon]) => ({
		value,
		icon,
		labelKey: `grammar.v4.value.tone.${value}`,
	})),
};

const prose: readonly TreeKind[] = [
	"body",
	"heading",
	"image",
	"divider",
	"list",
	"table",
	"block",
	"part",
	"recovery",
];
function subject(
	kind: SubjectDefinition["kind"] = "title",
	required = false,
	accepts?: SubjectDefinition["accepts"],
): SubjectDefinition {
	return {
		kind,
		required,
		labelKey: `grammar.v4.subject.${kind}`,
		accepts,
		...(["source", "url", "link"].includes(kind)
			? { helper: { kind: kind === "source" ? ("asset" as const) : ("link" as const) } }
			: {}),
	};
}
function linkSubject(value: string, raw = value): boolean {
	// Delimiters must be identified before G1's subject escapes are decoded.
	const nodes = tokenizeInline(raw).children;
	return (
		nodes.length === 1 &&
		nodes[0].kind === "link" &&
		nodes[0].children.length > 0 &&
		nodes[0].destination.value.length > 0 &&
		isSafeMediaUrl(nodes[0].destination.value)
	);
}
function constraints(
	definition: BlockDefinition,
	node: TreeNode,
	parent?: TreeNode,
): DefinitionIssue[] {
	const issues: DefinitionIssue[] = [];
	const location = node.header ?? node.span;
	const value = String(node.subject?.value ?? "");
	if (definition.subject.required && !value.trim())
		issues.push({
			code: "missing-subject",
			span: location,
			args: { type: node.type ?? node.kind, subject: definition.subject.kind },
		});
	else if (
		value &&
		(definition.subject.kind === "none" ||
			(definition.subject.accepts && !definition.subject.accepts(value, node.subject?.raw)))
	)
		issues.push({
			code: "bad-subject",
			span: location,
			args: { type: node.type ?? node.kind, subject: definition.subject.kind },
		});
	for (const child of node.children) {
		if (!definition.allowedChildren.includes(child.kind))
			issues.push(
				// A model: line after the first criterion parses as that criterion's body.
				node.kind === "item" && parent?.type === "self-check" && child.raw.startsWith("model:")
					? { code: "model-after-criterion", span: child.span }
					: {
							code: "disallowed-child",
							span: child.header ?? child.span,
							args: { type: node.type ?? node.kind, child: child.type ?? child.kind },
						},
			);
	}
	for (const rule of definition.childCounts) {
		const count = node.children.filter((child) => child.kind === rule.kind).length;
		if (count < rule.min || (rule.max !== undefined && count > rule.max))
			issues.push({
				code: "child-count",
				span: location,
				args: {
					type: node.type ?? node.kind,
					child: rule.kind,
					count,
					min: rule.min,
					...(rule.max === undefined ? {} : { max: rule.max }),
				},
			});
	}
	if (isPrivateChoice(node)) {
		if (privateChoiceHasForbiddenSettings(node) || parent?.type === "group")
			issues.push({ code: "private-choice-practice-only", span: location });
	}
	// Group prose can itself contain blocks. Check its full subtree too; direct
	// members and choices with forbidden settings already receive this diagnostic.
	if (node.type === "group")
		for (const child of descendants(node))
			if (
				!node.children.includes(child) &&
				isPrivateChoice(child) &&
				!privateChoiceHasForbiddenSettings(child)
			)
				issues.push({ code: "private-choice-practice-only", span: child.header ?? child.span });
	if (node.kind === "back" && parent?.kind !== "item")
		issues.push({
			code: "disallowed-child",
			span: location,
			args: { child: "back", parent: parent?.type ?? parent?.kind ?? "lesson" },
		});
	if (node.kind === "image") {
		const decorative = node.settings.some(
			(s) => s.name === "decorative" && (s.value.value === true || s.value.value === "true"),
		);
		if (!String(node.alt?.value ?? "").trim() && !decorative)
			issues.push({ code: "missing-image-alt", span: location });
		if (
			!String(node.source?.value ?? "").trim() ||
			!isSafeMediaUrl(String(node.source?.value ?? ""))
		)
			issues.push({ code: "bad-subject", span: location, args: { subject: "source" } });
	}
	if (node.type === "float" && node.children[0]?.kind !== "image")
		issues.push({
			code: "disallowed-child",
			span: node.children[0]?.span ?? location,
			args: { type: "float", rule: "image-first" },
		});
	if (node.type === "figure" && !node.children.some((child) => child.kind === "body"))
		issues.push({
			code: "disallowed-child",
			span: location,
			args: { type: "figure", rule: "caption-required" },
		});
	if (node.type === "video" || node.type === "audio") {
		const start = node.settings.find((s) => s.name === "start");
		const end = node.settings.find((s) => s.name === "end");
		if (end && Number(end.value.value) <= Number(start?.value.value ?? 0))
			issues.push({
				code: "bad-setting-value",
				span: end.span,
				args: { name: "end", rule: "after-start" },
			});
	}
	if (
		node.type === "self-check" ||
		node.type === "write-distractors" ||
		node.type === "highlight" ||
		(node.kind === "item" &&
			["self-check", "retrieval-sheet", "write-distractors", "highlight"].includes(
				parent?.type ?? "",
			))
	) {
		const required =
			node.type === "highlight" || (node.kind === "item" && parent?.type === "highlight")
				? undefined
				: node.type === "write-distractors"
					? "answer"
					: node.kind === "item" && parent?.type === "write-distractors"
						? "option"
						: node.kind === "item" && parent?.type === "retrieval-sheet"
							? "answer"
							: node.kind === "item"
								? "missed"
								: "model";
		const parts = node.children.filter((child) => child.kind === "part");
		if (required && !parts.some((part) => part.name === required))
			issues.push({ code: "missing-part", span: location, args: { name: required } });
		const seen = new Set<string>();
		for (const part of parts) {
			if (seen.has(part.name ?? ""))
				issues.push({
					code: "duplicate-part",
					span: part.header ?? part.span,
					args: { name: part.name ?? "" },
				});
			seen.add(part.name ?? "");
			if (!String(part.value?.value ?? "").trim())
				issues.push({
					code: "empty-part",
					span: part.header ?? part.span,
					args: { name: part.name ?? "" },
				});
		}
	}
	if (node.type === "highlight") issues.push(...highlightIssues(node, issues));
	if (node.type === "retrieval-sheet") issues.push(...retrievalSheetIssues(node));
	if (node.type === "write-distractors") issues.push(...writeDistractorsIssues(node, issues));
	if (node.type === "self-check") issues.push(...selfCheckIssues(node));
	return [...issues, ...responseConstraints(node)];
}

const namedPart = (node: TreeNode, name: string) =>
	node.children.find((child) => child.kind === "part" && child.name === name);
/** The library's content from grammar's literal fields. The lexer decodes each value once;
 * this only normalizes line endings and continuation indentation. The host supplies IDs. */
export function selfCheckContent(
	node: TreeNode,
	criterionId: (item: TreeNode, index: number) => string,
): SelfCheckContent {
	const text = (value: unknown) => displayText(String(value ?? ""));
	return {
		task: text(node.subject?.value),
		model: text(namedPart(node, "model")?.value?.value),
		parts: node.children
			.filter((child) => child.kind === "item")
			.map((item, index) => {
				const evidence = namedPart(item, "evidence");
				return {
					id: criterionId(item, index),
					label: text(item.subject?.value),
					missed: text(namedPart(item, "missed")?.value?.value),
					evidence: evidence ? text(evidence.value?.value) : null,
				};
			}),
	};
}
/** validateContent owns the content rules. Blank and missing fields already have their own
 * subject, part or child-count diagnostic. Evidence that isn't found exactly once in the
 * model has its own code, and any other refusal is self-check-invalid, so a new library rule
 * never passes silently. The library stops at its first failure, so a later criterion's
 * evidence is checked once earlier blank fields are filled. IDs are positional stand-ins:
 * analysis has no identity, and the reader's allocator refuses missing or duplicate IDs. */
function selfCheckIssues(node: TreeNode): DefinitionIssue[] {
	const content = selfCheckContent(node, (_item, index) => `criterion-${index}`);
	try {
		validateContent(content);
		return [];
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		const [, field = "", index = "-1", partField] =
			/^Invalid (\w+)(?:\[(\d+)\]\.(\w+))?/.exec(message) ?? [];
		const part: Record<string, unknown> | undefined = content.parts[Number(index)];
		const value = partField ? part?.[partField] : (content as Record<string, unknown>)[field];
		const item = node.children.filter((child) => child.kind === "item")[Number(index)];
		const evidence = item && namedPart(item, "evidence");
		if (partField === "evidence" && value && evidence)
			return [{ code: "evidence-not-once", span: evidence.header ?? evidence.span }];
		if (value === "" || (Array.isArray(value) && value.length === 0)) return [];
		return [{ code: "self-check-invalid", span: node.header ?? node.span }];
	}
}
/** Literal conversion shared by semantic admission and the grammar projection.
 * Paragraph breaks are structural; the item identity allocator owns chunk IDs. */
export function highlightContent(
	node: TreeNode,
	chunkId: (item: TreeNode, index: number) => string,
): HighlightContent {
	const text = (raw: string | undefined) => displayText(decodeEscapes(raw ?? "", "ascii"), true);
	const setting = (field: TreeNode, name: string) => field.settings.find((s) => s.name === name);
	const question = namedPart(node, "question");
	const maxMarks = setting(node, "maxMarks");
	const paragraphs: HighlightContent["paragraphs"] = [];
	let current: HighlightContent["paragraphs"][number] | undefined;
	for (const [index, item] of node.children.filter((child) => child.kind === "item").entries()) {
		const paragraph = setting(item, "paragraph")?.value.value;
		if (!current || paragraph === true || paragraph === "true") {
			current = [];
			paragraphs.push(current);
		}
		const key = setting(item, "key");
		const note = namedPart(item, "note");
		current.push({
			id: chunkId(item, index),
			text: text(item.subject?.raw),
			...(key ? { key: key.value.value === true || key.value.value === "true" } : {}),
			...(note ? { note: text(note.value?.raw) } : {}),
		});
	}
	return {
		mode: setting(node, "mode")?.value.value === "evidence" ? "evidence" : "key",
		title: text(node.subject?.raw),
		...(question ? { question: text(question.value?.raw) } : {}),
		...(maxMarks ? { maxMarks: Number(maxMarks.value.value) } : {}),
		paragraphs,
	};
}
function highlightIssues(
	node: TreeNode,
	priorIssues: readonly DefinitionIssue[],
): DefinitionIssue[] {
	const content = highlightContent(node, (_item, index) => `chunk-${index}`);
	const items = node.children.filter((child) => child.kind === "item");
	const issues: DefinitionIssue[] = [];
	const length = (value: string, max: number, code: DefinitionIssue["code"], field: TreeNode) => {
		if ([...value].length > max)
			issues.push({ code, span: field.header ?? field.span, args: { max } });
	};
	const fields = highlightSchema.properties;
	const chunkFields = fields.paragraphs.items.items.properties;
	length(content.title, fields.title.maxLength, "practice-title-too-long", node);
	const question = namedPart(node, "question");
	if (content.mode === "evidence" && !question)
		issues.push({
			code: "missing-part",
			span: node.header ?? node.span,
			args: { name: "question" },
		});
	if (question)
		length(
			content.question ?? "",
			fields.question.maxLength,
			"practice-question-too-long",
			question,
		);
	const chunks = content.paragraphs.flat();
	for (const [index, item] of items.entries()) {
		const chunk = chunks[index];
		length(chunk.text, chunkFields.text.maxLength, "highlight-chunk-too-long", item);
		if (chunk.text.trim() && chunk.text !== chunk.text.trim())
			issues.push({ code: "highlight-chunk-whitespace", span: item.header ?? item.span });
		const note = namedPart(item, "note");
		if (note) length(chunk.note ?? "", chunkFields.note.maxLength, "highlight-note-too-long", note);
	}
	for (const field of [node, ...items]) {
		// The shared lexer preserves the quoted spelling; numeric and boolean coercion
		// would otherwise erase the source contract's distinction.
		for (const setting of field.settings)
			if (
				["maxMarks", "key", "paragraph"].includes(setting.name) &&
				setting.value.raw.startsWith('"')
			)
				issues.push({
					code: "bad-setting-value",
					span: setting.span,
					args: { name: setting.name, value: String(setting.value.value) },
				});
	}
	if (items.length && !chunks.some((chunk) => chunk.key === true))
		issues.push({ code: "highlight-no-target", span: node.header ?? node.span });
	// Precise structural/field diagnostics own known failures. Upstream owns the
	// remaining semantic admission and its exception must never expose authored text.
	if (
		issues.length ||
		priorIssues.length ||
		(content.question !== undefined && !content.question.trim()) ||
		chunks.some(
			(chunk) => !chunk.text.trim() || (chunk.note !== undefined && !chunk.note.trim()),
		) ||
		!content.title.trim() ||
		!items.length ||
		node.children.some(
			(child) => child.kind !== "item" && !(child.kind === "part" && child.name === "question"),
		) ||
		items.some(
			(item) =>
				!String(item.subject?.value ?? "").trim() ||
				item.children.some((child) => child.kind !== "part" || child.name !== "note"),
		)
	)
		return issues;
	try {
		validateHighlightContent(content);
	} catch {
		issues.push({ code: "highlight-invalid", span: node.header ?? node.span });
	}
	return issues;
}
/** No identities are authored here. Analysis supplies positional stand-ins; the
 * reader supplies the existing lesson identity allocator's item IDs. Decode raw
 * fields once, including continuations, and preserve all nonstructural whitespace. */
export function retrievalSheetContent(
	node: TreeNode,
	questionId: (item: TreeNode, index: number) => string,
): RetrievalSheetContent {
	const text = (raw: string | undefined) => displayText(decodeEscapes(raw ?? "", "ascii"), true);
	return {
		title: text(node.subject?.raw),
		questions: node.children
			.filter((child) => child.kind === "item")
			.map((item, index) => ({
				id: questionId(item, index),
				question: text(item.subject?.raw),
				answer: text(namedPart(item, "answer")?.value?.raw),
			})),
	};
}
function retrievalSheetIssues(node: TreeNode): DefinitionIssue[] {
	const content = retrievalSheetContent(node, (_item, index) => `question-${index}`);
	const items = node.children.filter((child) => child.kind === "item");
	const issues: DefinitionIssue[] = [];
	const length = (value: string, max: number, code: DefinitionIssue["code"], field: TreeNode) => {
		if ([...value].length > max)
			issues.push({ code, span: field.header ?? field.span, args: { max } });
	};
	length(
		content.title,
		retrievalSheetSchema.properties.title.maxLength,
		"practice-title-too-long",
		node,
	);
	for (const [index, item] of items.entries()) {
		length(
			content.questions[index].question,
			retrievalSheetSchema.properties.questions.items.properties.question.maxLength,
			"practice-question-too-long",
			item,
		);
		const answer = namedPart(item, "answer");
		if (answer)
			length(
				content.questions[index].answer,
				retrievalSheetSchema.properties.questions.items.properties.answer.maxLength,
				"practice-answer-too-long",
				answer,
			);
	}
	// Structural/required/blank/duplicate failures already have precise diagnostics.
	// Do not turn the same failure into an additional library-invalid error.
	if (
		issues.length ||
		!content.title.trim() ||
		content.questions.length < retrievalSheetSchema.properties.questions.minItems ||
		content.questions.length > retrievalSheetSchema.properties.questions.maxItems ||
		node.children.some((child) => child.kind !== "item") ||
		items.some(
			(item, index) =>
				!content.questions[index].question.trim() ||
				!content.questions[index].answer.trim() ||
				item.children.length !== 1 ||
				item.children[0].kind !== "part" ||
				item.children[0].name !== "answer",
		)
	)
		return issues;
	try {
		validateRetrievalSheetContent(content);
	} catch {
		issues.push({ code: "retrieval-sheet-invalid", span: node.header ?? node.span });
	}
	return issues;
}
/** Paired literal fields for semantic admission and the source-owned typed accessor. */
export function writeDistractorsContent(
	node: TreeNode,
	misconceptionId: (item: TreeNode, index: number) => string,
): WriteDistractorsContent {
	const text = (raw: string | undefined) => displayText(decodeEscapes(raw ?? "", "ascii"), true);
	const items = node.children.filter((child) => child.kind === "item");
	const ids = items.map(misconceptionId);
	return {
		question: text(node.subject?.raw),
		rightAnswer: text(namedPart(node, "answer")?.value?.raw),
		count: Number(settingValue(node, "count") ?? 2),
		misconceptions: items.map((item, index) => ({
			id: ids[index],
			label: text(item.subject?.raw),
		})),
		authorOptions: items.map((item, index) => ({
			text: text(namedPart(item, "option")?.value?.raw),
			misconception: ids[index],
		})),
	};
}
function writeDistractorsIssues(
	node: TreeNode,
	structural: readonly DefinitionIssue[],
): DefinitionIssue[] {
	const content = writeDistractorsContent(node, (_item, index) => `misconception-${index}`);
	const items = node.children.filter((child) => child.kind === "item");
	const issues: DefinitionIssue[] = [];
	const length = (value: string, max: number, code: DefinitionIssue["code"], field: TreeNode) => {
		if ([...value].length > max)
			issues.push({ code, span: field.header ?? field.span, args: { max } });
	};
	length(
		content.question,
		writeDistractorsSchema.properties.question.maxLength,
		"practice-question-too-long",
		node,
	);
	const answer = namedPart(node, "answer");
	if (answer)
		length(
			content.rightAnswer,
			writeDistractorsSchema.properties.rightAnswer.maxLength,
			"practice-right-answer-too-long",
			answer,
		);
	const normal = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
	const labels = new Set<string>();
	for (const [index, item] of items.entries()) {
		const label = content.misconceptions[index].label;
		length(
			label,
			writeDistractorsSchema.properties.misconceptions.items.properties.label.maxLength,
			"practice-misconception-too-long",
			item,
		);
		if (label.trim() && labels.has(normal(label)))
			issues.push({ code: "write-distractors-duplicate-label", span: item.header ?? item.span });
		labels.add(normal(label));
		const option = namedPart(item, "option");
		if (option) {
			const text = content.authorOptions[index].text;
			length(
				text,
				writeDistractorsSchema.properties.authorOptions.items.properties.text.maxLength,
				"practice-option-too-long",
				option,
			);
			if (text.trim() && content.rightAnswer.trim() && normal(text) === normal(content.rightAnswer))
				issues.push({
					code: "write-distractors-author-right",
					severity: "warning",
					span: option.header ?? option.span,
				});
		}
	}
	const count = node.settings.find((setting) => setting.name === "count");
	if (count?.value.raw.startsWith('"'))
		issues.push({ code: "bad-setting-value", span: count.span, args: { name: "count" } });
	// The named checks own structure, blankness, lengths and duplicates. Never
	// repeat them as a generic library failure or expose upstream exception text.
	if (
		structural.some((issue) => issue.code !== "unsupported-runtime") ||
		issues.some((issue) => issue.severity !== "warning") ||
		!content.question.trim() ||
		!content.rightAnswer.trim() ||
		!items.length ||
		node.children.some(
			(child) => child.kind !== "item" && !(child.kind === "part" && child.name === "answer"),
		) ||
		!Number.isInteger(content.count) ||
		content.count < writeDistractorsSchema.properties.count.minimum ||
		content.count > writeDistractorsSchema.properties.count.maximum ||
		items.some(
			(item, index) =>
				!content.misconceptions[index].label.trim() ||
				!content.authorOptions[index].text.trim() ||
				item.settings.length ||
				item.children.length !== 1 ||
				item.children[0].kind !== "part" ||
				item.children[0].name !== "option",
		)
	)
		return issues;
	try {
		validateWriteDistractorsContent(content);
	} catch {
		issues.push({ code: "write-distractors-invalid", span: node.header ?? node.span });
	}
	return issues;
}
function block(
	type: string,
	insertTemplate: string,
	options: Partial<Omit<BlockDefinition, "validate" | "labelKey" | "insertTemplate">> = {},
): BlockDefinition {
	const definition: BlockDefinition = {
		labelKey: `grammar.v4.type.${type}`,
		subject: subject(),
		parts: [],
		partLabels: {},
		settings: universal,
		allowedChildren: prose,
		childCounts: [],
		insertTemplate,
		...options,
	};
	definition.partLabels = Object.fromEntries(
		(definition.parts ?? []).map((name) => [name, `grammar.v4.part.${name}`]),
	);
	definition.validate = (node, parent) => constraints(definition, node, parent);
	return definition;
}
function container(
	type: string,
	settings: Record<string, SettingDefinition> = {},
	requiredTitle = true,
): BlockDefinition {
	const item = block(`${type}.item`, ":: Item\nText\n", {
		subject: subject("title", requiredTitle),
		settings:
			type === "columns"
				? { ...universal, weight: numberSetting("weight", 0, undefined, false, true) }
				: universal,
		allowedChildren: type === "cards" ? [...prose, "back"] : prose,
		childCounts: type === "cards" ? [{ kind: "back", min: 0, max: 1 }] : [],
	});
	return block(
		type,
		`::: ${type}\n:: ${requiredTitle ? "First" : ""}\nText\n:: ${requiredTitle ? "Second" : ""}\nText\n:::\n`,
		{
			items: true,
			heading: true,
			itemHeading: true,
			itemDefinition: item,
			settings: { ...universal, ...settings },
			allowedChildren: ["item", "recovery"],
			childCounts: [
				{
					kind: "item",
					min: type === "comparison" ? 2 : 1,
					...(type === "comparison" ? { max: 2 } : {}),
				},
			],
		},
	);
}
function media(type: "video" | "audio"): BlockDefinition {
	return block(
		type,
		`::: ${type} /assets/example.${type === "video" ? "mp4" : "mp3"}\ntranscript: Transcript\n:::\n`,
		{
			subject: subject("source", true, isSafeMediaUrl),
			parts: ["title", "caption", "transcript"],
			settings: {
				...universal,
				captions: scalar("captions", "path", "asset", isSafeCaptionTrackUrl),
				start: numberSetting("start", 0),
				end: numberSetting("end", 0),
				...(type === "video" ? { autoplay: toggle("autoplay") } : {}),
			},
			allowedChildren: ["part", "body", "recovery"],
		},
	);
}

export const ASSESSMENT_TYPES = [
	"choice",
	"match",
	"order",
	"categorize",
	"fill-blank",
	"free-response",
	"rating",
	"matrix",
	"hotspot",
] as const;
const groupContentTypes: readonly string[] = [
	...ASSESSMENT_TYPES,
	"text",
	"heading",
	"image",
	"divider",
	"table",
];
const assessmentSettings = {
	...universal,
	points: numberSetting("points", 0),
	required: toggle("required"),
	attempts: numberSetting("attempts", 0, undefined, true),
	shuffle: toggle("shuffle"),
	scored: toggle("scored"),
	feedbackMode: vocabularySetting("choice", "feedbackMode"),
	display: vocabularySetting("choice", "display"),
	deckGate: vocabularySetting("group", "deckGate"),
};
function assessment(
	type: string,
	body: string,
	options: Partial<Omit<BlockDefinition, "validate" | "labelKey" | "insertTemplate">> = {},
): BlockDefinition {
	return block(type, `::: ${type} Question\n${body}\n:::\n`, {
		subject: subject("title", true),
		heading: true,
		settings: assessmentSettings,
		...options,
		parts: [...new Set([...(options.parts ?? ["correct", "incorrect"]), "feedback"])],
	});
}
const scale = numberSetting("scale", 2, 10, true);

/** Spot geometry belongs to hotspot, not the lexer or generic tree. Coordinates are percentages. */
export const SPOT_SETTINGS: Readonly<Record<string, SettingDefinition>> = {
	shape: enumSetting("shape", ["point", "rect", "ellipse", "polygon"], "point"),
	x: numberSetting("x", 0, 100),
	y: numberSetting("y", 0, 100),
	w: numberSetting("w", 0, 100, false, true),
	h: numberSetting("h", 0, 100, false, true),
	rx: numberSetting("rx", 0, 100, false, true),
	ry: numberSetting("ry", 0, 100, false, true),
	points: scalar("points", "string", undefined, (v) => {
		if (typeof v !== "string") return false;
		const pairs = v.split(",").map((p) => p.trim().split(/\s+/));
		return (
			pairs.length >= 3 &&
			pairs.every((p) => p.length === 2 && p.every((n) => SPOT_SETTINGS.x.accepts(n)))
		);
	}),
	correct: toggle("correct"),
};

/** Rule action syntax is strict. Callers never recover an unknown verb as a show action. */
export function parseRuleAction(expression: string): LogicAction | undefined {
	const input = expression.trim();
	const targeted = /^(show|hide|require|jump)\s+(.+)$/.exec(input);
	if (targeted) {
		const targets = targeted[2].split(",").map((s) => s.trim());
		if (
			!targets.every((s) => s.startsWith("@") && universal.name.accepts(s.slice(1))) ||
			(targeted[1] === "jump" && targets.length !== 1)
		)
			return undefined;
		return {
			type: targeted[1] === "jump" ? "jumpToPage" : (targeted[1] as "show" | "hide" | "require"),
			targets: targets.map((s) => s.slice(1)),
		};
	}
	if (input === "disableCompletion") return { type: "disableCompletion", targets: [] };
	const disable = /^disableCompletion\s+because\s+("(?:[^"\\]|\\.)*")$/.exec(input);
	if (disable) {
		try {
			return { type: "disableCompletion", targets: [], reason: JSON.parse(disable[1]) };
		} catch {
			return undefined;
		}
	}
	const variable = /^(set|add|subtract)\s+(\S+?)\s*([=+-])\s*(.+)$/.exec(input);
	if (
		variable &&
		universal.name.accepts(variable[2]) &&
		variable[3] === ({ set: "=", add: "+", subtract: "-" } as Record<string, string>)[variable[1]]
	) {
		const value = parseLogicScalarValue(variable[4]);
		return {
			type: "setVariable",
			targets: [variable[2]],
			value:
				variable[1] === "set"
					? value
					: { operation: variable[1] as "add" | "subtract", operand: value },
		};
	}
	return undefined;
}

function settingValue(node: TreeNode, name: string): string | boolean | undefined {
	return node.settings.find((s) => s.name === name)?.value.value;
}

/** Choice privacy is opt-in; free-response's existing flag has a separate contract. */
function isPrivateChoice(node: TreeNode): boolean {
	return (
		node.type === "choice" &&
		node.settings.some(
			(setting) =>
				setting.name === "private" &&
				!setting.value.raw.startsWith('"') &&
				(setting.value.value === true || setting.value.value === "true"),
		)
	);
}
function privateChoiceHasForbiddenSettings(node: TreeNode): boolean {
	return (
		["scored", "required"].some((name) =>
			[true, "true"].includes(settingValue(node, name) ?? false),
		) || settingValue(node, "deckGate") !== undefined
	);
}

/** Separators belong to the raw spelling; only individual words decode escapes. */
export function wordBankEntries(node: TreeNode): string[] {
	const bank = node.children.find((n) => n.kind === "part" && n.name === "bank");
	return splitUnescaped(bank?.value?.raw ?? "", "|").map((word) => decodeEscapes(word.trim()));
}
function descendants(node: TreeNode): TreeNode[] {
	const result = [node];
	for (let i = 0; i < result.length; i++) result.push(...result[i].children);
	return result;
}
function listEntries(node: TreeNode, ordered: boolean): TreeNode[] {
	return node.children
		.filter((n) => n.kind === "list" && n.ordered === ordered)
		.flatMap((n) => n.children);
}
export function maskedBlankContent(raw: string): string {
	const chars = raw.split("");
	const mask = (nodes: ReturnType<typeof tokenizeInline>["children"]) => {
		for (const n of nodes) {
			if (["term", "variable", "code", "icon", "source", "unresolved"].includes(n.kind)) {
				for (let i = n.start; i < n.end; i++) chars[i] = " ";
			} else if ("children" in n) mask(n.children);
		}
	};
	mask(tokenizeInline(raw).children);
	for (const line of tokenizeLesson(raw).lines)
		if (["code", "code-fence", "math", "math-fence"].includes(line.kind))
			for (let i = line.start; i < line.end; i++) chars[i] = " ";
	return chars.join("");
}
const choiceResponseInvariant = {
	single: { maxCorrect: 1 },
	multiple: { minCorrect: 0 },
	withoutCorrect: "ungraded",
} as const;

function responseConstraints(node: TreeNode): DefinitionIssue[] {
	const issues: DefinitionIssue[] = [];
	const fail = (rule: string, at = node, args: DefinitionIssue["args"] = {}) =>
		issues.push({
			code: "response-invariant",
			span: at.header ?? at.span,
			args: { type: node.type ?? node.kind, rule, ...args },
		});
	const empty = (entries: TreeNode[]) => {
		for (const entry of entries)
			if (!String(entry.text?.value ?? "").trim()) fail("nonempty-response", entry);
	};
	if (node.type === "free-response") {
		// Description sinks accept rich prose HTML, not arbitrary block renderers.
		// Check wrappers too so inspect cannot admit content those sinks discard.
		const proseOnly = (owner: TreeNode) => {
			for (const child of owner.children) {
				if (child.kind === "part" || child.kind === "recovery") continue;
				if (!["body", "list", "list-entry"].includes(child.kind) && child.type !== "text")
					issues.push({
						code: "disallowed-child",
						span: child.header ?? child.span,
						args: { type: "free-response", child: child.type ?? child.kind },
					});
				else if (child.kind === "body") {
					for (const line of tokenizeLesson(child.raw).lines) {
						if (line.kind !== "code-fence" && line.kind !== "math-fence") continue;
						issues.push({
							code: "disallowed-child",
							span: {
								...child.span,
								start: child.span.start + line.start,
								end: child.span.start + line.contentEnd,
							},
							args: { type: "free-response", child: line.kind },
						});
						break;
					}
				} else proseOnly(child);
			}
		};
		proseOnly(node);
	}
	if (node.type === "choice") {
		const options = node.children.filter((n) => n.kind === "option");
		const dontKnow = node.settings.find((setting) => setting.name === "dontKnow");
		if (dontKnow?.value.raw.startsWith('"'))
			issues.push({
				code: "bad-setting-value",
				span: dontKnow.span,
				args: { name: "dontKnow", value: dontKnow.value.value },
			});
		if (settingValue(node, "dontKnow") !== undefined && options[0]?.optionKind === "multiple")
			fail("dont-know-single-only");
		const privacy = node.settings.find((setting) => setting.name === "private");
		if (privacy?.value.raw.startsWith('"'))
			issues.push({ code: "bad-setting-value", span: privacy.span, args: { name: "private" } });
		if (privacy && options[0]?.optionKind === "multiple") fail("private-single-only");
		empty(options);
		const count = options.filter((n) => n.correct).length;
		if (options[0]?.optionKind === "single" && count > choiceResponseInvariant.single.maxCorrect)
			fail("at-most-one-correct", node, { count });
		for (const body of node.children.filter((n) => n.kind === "body"))
			if (/^(?:\([ xX]\)|\[[ xX]\])\s*$/m.test(body.raw)) fail("nonempty-response", body);
	}
	if (node.type === "match") {
		const pairs = node.children.filter((n) => n.kind === "pair");
		empty(pairs);
		for (const pair of pairs)
			if (!String(pair.answer?.value ?? "").trim()) fail("nonempty-answer", pair);
		for (const body of node.children.filter((n) => n.kind === "body"))
			if (/^- .*->\s*$/m.test(body.raw)) fail("nonempty-answer", body);
	}
	if (node.type === "order" || node.type === "rating" || node.type === "matrix") {
		const entries = listEntries(node, true);
		empty(entries);
		if (node.type === "order" && entries.length < 2)
			fail("at-least-two-steps", node, { count: entries.length });
		if (node.type !== "order") {
			const numeric = settingValue(node, "scale");
			if (numeric !== undefined && entries.length) fail("scale-or-labels");
			if (numeric === undefined && (entries.length < 2 || entries.length > 10))
				fail("scale-label-count", node, { count: entries.length, min: 2, max: 10 });
			if (entries.some((e) => e.children.some((c) => c.kind === "list"))) fail("flat-scale");
			if (node.type === "matrix") {
				const statements = listEntries(node, false);
				empty(statements);
				if (!statements.length) fail("matrix-statements-required");
				if (node.children.find((c) => c.kind === "list")?.ordered !== true && numeric === undefined)
					fail("scale-before-statements");
			}
		}
	}
	if (node.type === "categorize") {
		for (const item of node.children.filter((n) => n.kind === "item")) {
			const entries = listEntries(item, false);
			empty(entries);
			if (!entries.length) fail("category-entries-required", item);
			if (entries.some((n) => n.children.some((c) => c.kind === "list")))
				fail("flat-category", item);
		}
	}
	if (node.type === "checklist") empty(node.children.filter((n) => n.kind === "task"));
	if (node.type === "fill-blank") {
		const content = node.children
			.filter((n) => n.kind === "body")
			.map((n) => maskedBlankContent(n.raw))
			.join("\n");
		const style = settingValue(node, "style") ?? "typed";
		const blanks = parseFillBlankContent(content, style);
		if (!blanks.length) fail("blanks-required");
		const bank = wordBankEntries(node);
		const used = new Map<string, number>();
		for (const blank of blanks) {
			const answers = [blank.answer, ...(blank.alternatives ?? [])];
			if (
				style === "dropdown" &&
				(!blank.answer ||
					!blank.choices ||
					blank.choices.length < 2 ||
					blank.choices.some((w) => !w) ||
					new Set(blank.choices).size !== blank.choices.length)
			)
				fail("dropdown-marked-answer-and-distinct-choices");
			if (style === "word-bank") {
				used.set(blank.answer, (used.get(blank.answer) ?? 0) + 1);
				if (
					bank.some((w) => !w) ||
					answers.some((a) => !a || !bank.includes(a)) ||
					(used.get(blank.answer) ?? 0) > bank.filter((w) => w === blank.answer).length
				)
					fail("word-bank-answers-and-counts");
			}
			if (settingValue(node, "feedbackMode") === "reveal" && !blank.answer)
				fail("reveal-needs-answer");
		}
	}
	if (node.type === "hotspot") {
		const spots = node.children.filter((n) => n.kind === "spot");
		empty(spots);
		const image = node.children.find((n) => n.kind === "image");
		if (image && spots.some((s) => s.span.start < image.span.start)) fail("image-before-spots");
		if (
			!spots.some((s) =>
				s.bodySettings?.some(
					(v) => v.name === "correct" && (v.value.value === true || v.value.value === "true"),
				),
			)
		)
			fail("at-least-one-correct-spot");
		for (const spot of spots) {
			const settings = spot.bodySettings ?? [];
			for (const s of settings) {
				const declaration = Object.hasOwn(SPOT_SETTINGS, s.name)
					? SPOT_SETTINGS[s.name]
					: undefined;
				if (!declaration?.accepts(s.value.value))
					issues.push({
						code: declaration ? "bad-setting-value" : "unknown-setting",
						span: spot.span,
						args: { name: s.name, value: String(s.value.value), type: "hotspot.spot" },
					});
			}
			const shape = String(settings.find((s) => s.name === "shape")?.value.value ?? "point");
			const required = {
				point: ["x", "y"],
				rect: ["x", "y", "w", "h"],
				ellipse: ["x", "y", "rx", "ry"],
				polygon: ["points"],
			}[shape];
			if (required?.some((n) => !settings.some((s) => s.name === n)))
				fail("shape-fields-required", spot, { shape, required });
			if (required && settings.some((s) => !["shape", "correct", ...required].includes(s.name)))
				fail("shape-fields-only", spot, { shape });
		}
	}
	if (node.type === "group") {
		if (
			!node.children.some(
				(n) =>
					n.kind === "block" &&
					ASSESSMENT_TYPES.includes(n.type as (typeof ASSESSMENT_TYPES)[number]),
			)
		)
			fail("group-questions-required");
		for (const child of node.children)
			if (child.type === "self-check")
				issues.push({ code: "self-check-in-group", span: child.header ?? child.span });
			else if (child.kind === "block" && !groupContentTypes.includes(child.type ?? ""))
				fail("group-assessments-or-prose", child);
		// Each nested group owns its subtree's membership diagnostics.
		const nested = node.children
			.filter((child) => child.type !== "group")
			.flatMap((child) => child.children);
		for (let index = 0; index < nested.length; index++) {
			const child = nested[index];
			if (child.type === "group") continue;
			if (["retrieval-sheet", "write-distractors", "highlight"].includes(child.type ?? ""))
				fail("group-assessments-or-prose", child);
			nested.push(...child.children);
		}
	}
	if (node.type === "rule") {
		const parts = node.children.filter((n) => n.kind === "part");
		if (
			parts[0]?.name !== "if" ||
			parts.filter((n) => n.name === "if").length !== 1 ||
			!parts.some((n) => n.name === "then")
		)
			fail("if-then-required");
		let actions = false;
		let operator: string | undefined;
		for (const part of parts) {
			const value = String(part.value?.value ?? "");
			if (part.name === "then") {
				actions = true;
				if (!parseRuleAction(value)) fail("valid-action-required", part);
			} else {
				if (actions) fail("conditions-before-actions", part);
				if (part.name === "and" || part.name === "or") {
					if (operator && operator !== part.name) fail("one-condition-operator", part);
					operator = part.name;
				}
				const condition = parseLogicConditionExpression(value);
				const name = /^(?:variable|block):(.+)$/.exec(condition.source)?.[1];
				if (!name || !universal.name.accepts(name)) fail("valid-condition-required", part);
			}
		}
	}
	return issues;
}

/** Grammar-4 declarations only. Grammar 3 never imports this registry. */
export const BLOCK_SCHEMA: Readonly<Record<string, BlockDefinition>> = {
	text: block("text", "::: text\nText\n:::\n", { subject: subject("none") }),
	note: block("note", "::: note {tone=note}\nText\n:::\n", {
		heading: true,
		settings: {
			...universal,
			tone,
			style: vocabularySetting("note", "style"),
			icon: scalar(
				"icon",
				"icon",
				"icon",
				(v) => typeof v === "string" && NOTE_ICON_NAME_PATTERN.test(v),
			),
		},
		settingAliases: { color: "tone", colour: "tone" },
	}),
	quote: block("quote", "::: quote\nQuoted words\nspeaker: Speaker\n:::\n", {
		subject: subject("none"),
		parts: ["speaker", "work"],
		settings: {
			...universal,
			style: vocabularySetting("quote", "style"),
			source: scalar(
				"source",
				"url",
				"link",
				(v) => typeof v === "string" && v.length > 0 && isSafeMediaUrl(v),
			),
		},
	}),
	figure: block("figure", "::: figure\n![Description](/assets/image.png)\nCaption\n:::\n", {
		subject: subject("none"),
		allowedChildren: ["image", "body", "recovery"],
		childCounts: [{ kind: "image", min: 1, max: 1 }],
	}),
	float: block("float", "::: float {side=left}\n![Description](/assets/image.png)\nText\n:::\n", {
		subject: subject("none"),
		settings: { ...universal, side: enumSetting("side", IMAGE_FLOATS, "left") },
		childCounts: [{ kind: "image", min: 1, max: 1 }],
	}),
	video: media("video"),
	audio: media("audio"),
	embed: block("embed", "::: embed https://example.com/embed\ntitle: Embedded resource\n:::\n", {
		subject: subject("url", true, isSafeEmbedUrl),
		parts: ["title"],
		settings: { ...universal, height: numberSetting("height", 0, undefined, true, true) },
		allowedChildren: ["part", "body", "recovery"],
	}),
	bookmark: block("bookmark", "::: bookmark [Resource](https://example.com)\n:::\n", {
		subject: subject("link", true, linkSubject),
		allowedChildren: ["recovery"],
	}),
	button: block("button", "::: button [Open resource](https://example.com)\n:::\n", {
		subject: subject("link", true, linkSubject),
		settings: {
			...universal,
			style: vocabularySetting("button", "style"),
			newTab: toggle("newTab"),
		},
		settingAliases: { openInNewTab: "newTab" },
		allowedChildren: ["recovery"],
	}),
	dialogue: block("dialogue", "::: dialogue\n- alex: Hello\n- sam: Hello\n:::\n", {
		subject: subject("none"),
		body: "turns",
		parts: ["caption"],
		settings: { ...universal, style: vocabularySetting("dialogue", "style") },
		allowedChildren: ["turn", "part", "body", "recovery"],
	}),
	table: block("table", "::: table\n| Heading | Value |\n| --- | --- |\n| Example | 1 |\n:::\n", {
		subject: subject("none"),
		body: "tables",
		parts: ["title", "subtitle", "caption", "alt", "xLabel", "yLabel", "description"],
		allowedChildren: ["table", "part", "body", "recovery"],
		settings: {
			...universal,
			chart: vocabularySetting("table", "chart"),
			orientation: vocabularySetting("table", "orientation"),
			header: vocabularySetting("table", "header"),
			striped: toggle("striped"),
			showPoints: toggle("showPoints"),
			gridlines: vocabularySetting("table", "gridlines"),
			columnAlignments: scalar(
				"columnAlignments",
				"string",
				undefined,
				(v) =>
					typeof v === "string" &&
					v
						.split(/[,\s]+/)
						.every((a) => IMAGE_ALIGNMENTS.includes(a as (typeof IMAGE_ALIGNMENTS)[number])),
			),
			sortOrder: vocabularySetting("table", "sortOrder"),
		},
	}),
	stats: block("stats", "::: stats {columns=2}\n| 3 | Examples |\n| 2 | Columns |\n:::\n", {
		subject: subject("none"),
		body: "tables",
		parts: ["caption"],
		// StatsBlock accepts exactly 2, 3 or 4; its CSS reduces grids at smaller widths.
		settings: { ...universal, columns, size: vocabularySetting("stats", "size") },
		allowedChildren: ["table", "part", "body", "recovery"],
	}),
	accordion: container("accordion", {
		style: vocabularySetting("accordion", "style"),
		allowMultipleOpen: toggle("allowMultipleOpen", false),
	}),
	tabs: container("tabs", {
		style: vocabularySetting("tabs", "style"),
		orientation: vocabularySetting("tabs", "orientation"),
	}),
	sequence: container("sequence", {
		style: vocabularySetting("sequence", "style"),
		orientation: vocabularySetting("sequence", "orientation"),
		alignment: vocabularySetting("sequence", "alignment"),
		distribution: vocabularySetting("sequence", "distribution"),
		scrollable: toggle("scrollable"),
	}),
	cards: container(
		"cards",
		{
			layout: vocabularySetting("cards", "layout"),
			style: vocabularySetting("cards", "style"),
			color: enumSetting("color", Object.keys(cardColours)),
			shadow: vocabularySetting("cards", "shadow"),
			columns,
			media: vocabularySetting("cards", "media"),
			advance: numberSetting("advance", 0),
			transition: vocabularySetting("cards", "transition"),
			showProgress: toggle("showProgress"),
			shuffle: toggle("shuffle"),
			trackCompletion: toggle("trackCompletion"),
			headings: toggle("headings"),
		},
		false,
	),
	comparison: container("comparison", { layout: vocabularySetting("comparison", "layout") }, false),
	columns: container("columns", {}, false),
	choice: assessment("choice", "(x) Correct option\n( ) Other option", {
		settings: { ...assessmentSettings, dontKnow: toggle("dontKnow"), private: toggle("private") },
		body: "options",
		allowedChildren: ["option", "body", "part", "image", "recovery"],
		childCounts: [{ kind: "option", min: 2 }],
	}),
	match: assessment("match", "- First -> Answer\n- Second -> Other answer", {
		body: "pairs",
		parts: ["correct", "incorrect", "placeholder"],
		allowedChildren: ["pair", "body", "part", "image", "recovery"],
		childCounts: [{ kind: "pair", min: 2 }],
	}),
	order: assessment("order", "1. First step\n2. Second step", {
		body: "steps",
		allowedChildren: ["list", "body", "part", "image", "recovery"],
	}),
	categorize: assessment(
		"categorize",
		":: First category\n- First entry\n:: Second category\n- Second entry",
		{
			items: true,
			itemHeading: true,
			itemDefinition: block("categorize.item", ":: Category\n- Entry\n", {
				subject: subject("title", true),
				body: "lists",
				allowedChildren: ["list", "recovery"],
			}),
			allowedChildren: ["item", "body", "part", "image", "recovery"],
			childCounts: [{ kind: "item", min: 2 }],
		},
	),
	"fill-blank": assessment("fill-blank", "Complete the {answer}.", {
		parts: ["correct", "incorrect", "placeholder", "bank"],
		allowedChildren: ["body", "part", "recovery"],
		settings: {
			...assessmentSettings,
			style: vocabularySetting("fill-blank", "style"),
		},
	}),
	"free-response": assessment("free-response", "placeholder: Write your reflection", {
		parts: ["correct", "incorrect", "placeholder", "button"],
		settings: {
			...assessmentSettings,
			download: enumSetting("download", schemaEnum("free-response", "download")),
			private: toggle("private"),
		},
		settingAliases: { downloadAs: "download" },
	}),
	"write-distractors": block(
		"write-distractors",
		"::: write-distractors Question\nanswer: Right answer\n:: Mistaken idea\noption: Wrong option\n:::\n",
		{
			subject: subject("title", true),
			heading: true,
			items: true,
			literalText: true,
			parts: ["answer"],
			settings: {
				...universal,
				count: {
					...numberSetting(
						"count",
						writeDistractorsSchema.properties.count.minimum,
						writeDistractorsSchema.properties.count.maximum,
						true,
					),
					// This new setting uses canonical source integers. Keep the
					// legacy level/points numeric parser's leniency unchanged.
					accepts: (value) =>
						typeof value === "string" &&
						/^[1-9]\d*$/.test(value) &&
						Number(value) >= writeDistractorsSchema.properties.count.minimum &&
						Number(value) <= writeDistractorsSchema.properties.count.maximum,
					default: 2,
				},
			},
			allowedChildren: ["part", "item", "recovery"],
			childCounts: [
				{ kind: "item", min: writeDistractorsSchema.properties.misconceptions.minItems },
			],
			itemDefinition: block("write-distractors.item", ":: Mistaken idea\noption: Wrong option\n", {
				subject: subject("title", true),
				literalText: true,
				parts: ["option"],
				settings: {},
				allowedChildren: ["part", "recovery"],
			}),
		},
	),
	highlight: block(
		"highlight",
		"::: highlight Key ideas\n:: A key idea. {key}\n:: Another detail.\n:::\n",
		{
			subject: subject("title", true),
			heading: true,
			items: true,
			literalText: true,
			parts: ["question"],
			settings: {
				...universal,
				mode: enumSetting("mode", highlightSchema.properties.mode.enum, "key"),
				maxMarks: scalar(
					"maxMarks",
					"integer",
					undefined,
					(value) =>
						typeof value === "string" &&
						/^[1-9][0-9]*$/.test(value) &&
						Number.isSafeInteger(Number(value)),
				),
			},
			allowedChildren: ["part", "item", "recovery"],
			childCounts: [{ kind: "item", min: highlightSchema.properties.paragraphs.minItems }],
			itemDefinition: block("highlight.item", ":: Passage {key}\nnote: Explanation\n", {
				subject: subject("title", true),
				literalText: true,
				parts: ["note"],
				settings: { key: toggle("key", false), paragraph: toggle("paragraph", false) },
				allowedChildren: ["part", "recovery"],
			}),
		},
	),
	"retrieval-sheet": block(
		"retrieval-sheet",
		"::: retrieval-sheet Design approaches\n:: What does universal design consider?\nanswer: Diverse users from the start.\n:::\n",
		{
			subject: subject("title", true),
			heading: true,
			items: true,
			literalText: true,
			allowedChildren: ["item", "recovery"],
			childCounts: [
				{
					kind: "item",
					min: retrievalSheetSchema.properties.questions.minItems,
					max: retrievalSheetSchema.properties.questions.maxItems,
				},
			],
			itemDefinition: block("retrieval-sheet.item", ":: Question\nanswer: Answer\n", {
				subject: subject("title", true),
				literalText: true,
				parts: ["answer"],
				settings: {},
				allowedChildren: ["part", "recovery"],
			}),
		},
	),
	"self-check": block(
		"self-check",
		"::: self-check Explain why the report needs another day.\nmodel: The data arrived late. Could I send the report on Tuesday?\n:: Reason for the delay\nmissed: Explain what caused the delay.\nevidence: The data arrived late.\n:: New delivery date\nmissed: Propose a specific delivery date.\nevidence: Tuesday\n:::\n",
		{
			subject: subject("title", true),
			heading: true,
			items: true,
			literalText: true,
			parts: ["model"],
			settings: {
				...universal,
				required: assessmentSettings.required,
				deckGate: vocabularySetting("self-check", "deckGate"),
				private: toggle("private", true),
			},
			allowedChildren: ["part", "item", "recovery"],
			childCounts: [{ kind: "item", min: 1 }],
			itemDefinition: block("self-check.item", ":: Criterion\nmissed: Explain what to add.\n", {
				subject: subject("title", true),
				literalText: true,
				parts: ["missed", "evidence"],
				settings: {},
				allowedChildren: ["part", "recovery"],
			}),
		},
	),
	rating: assessment("rating", "1. Low\n2. High", {
		body: "steps",
		parts: ["correct", "incorrect", "feedback"],
		settings: { ...assessmentSettings, style: vocabularySetting("rating", "style"), scale },
		allowedChildren: ["body", "list", "part", "recovery"],
	}),
	matrix: assessment("matrix", "1. Low\n2. High\n- First statement", {
		body: "lists",
		settings: { ...assessmentSettings, style: vocabularySetting("matrix", "style") },
		allowedChildren: ["body", "list", "part", "recovery"],
	}),
	hotspot: assessment(
		"hotspot",
		"![Description](/assets/diagram.png)\n- Target {x=50 y=50 correct}",
		{
			body: "spots",
			allowedChildren: ["image", "spot", "body", "part", "recovery"],
			childCounts: [
				{ kind: "image", min: 1, max: 1 },
				{ kind: "spot", min: 1 },
			],
		},
	),
	group: block(
		"group",
		"::: group Check\nbutton: Submit answers\n::: choice Question\n(x) Yes\n( ) No\n:::\n:::\n",
		{
			heading: true,
			parts: ["button"],
			settings: {
				...universal,
				mode: vocabularySetting("group", "mode"),
				passingScore: numberSetting("passingScore", 0, 100),
				showResultsSummary: toggle("showResultsSummary"),
				requireAll: toggle("requireAll"),
				pointsOverride: numberSetting("pointsOverride", 0),
				deckGate: vocabularySetting("group", "deckGate"),
			},
		},
	),
	checklist: block("checklist", "::: checklist\n- [ ] First task\n:::\n", {
		heading: true,
		body: "tasks",
		settings: { ...universal, required: toggle("required"), shuffle: toggle("shuffle") },
		allowedChildren: ["task", "body", "recovery"],
		childCounts: [{ kind: "task", min: 1 }],
	}),
	signature: block(
		"signature",
		"::: signature Confirm completion\nsublabel: Your signature\n:::\n",
		{
			subject: subject("title", true),
			heading: true,
			parts: ["sublabel"],
			settings: {
				...universal,
				mode: vocabularySetting("signature", "mode"),
				required: toggle("required"),
			},
			allowedChildren: ["part", "recovery"],
		},
	),
	rule: block("rule", "::: rule\nif: ready\nthen: show @target\n:::\n", {
		subject: subject("none"),
		parts: ["if", "and", "or", "then"],
		settings: {},
		allowedChildren: ["part", "recovery"],
	}),
	divider: block("divider", "---\n", {
		subject: subject("none"),
		settings: { ...universal, palette: enumSetting("palette", SECTION_PALETTES) },
		allowedChildren: [],
	}),
	page: block("page", "# New page\n", {
		subject: subject("title", true),
		heading: true,
		parts: ["nav"],
		settings: {
			style: scalar("style", "name"),
			hide: toggle("hide"),
			deckStop: toggle("deckStop"),
			hideTitle: toggle("hideTitle"),
		},
	}),
	image: block("image", "![Description](/assets/image.png)\n", {
		subject: subject("none"),
		settings: {
			...universal,
			size: enumSetting("size", IMAGE_WIDTHS),
			alignment: enumSetting("alignment", IMAGE_ALIGNMENTS),
			ratio: vocabularySetting("image", "ratio"),
			fit: vocabularySetting("image", "fit"),
			effects: {
				...scalar("effects", "string", "colour"),
				helper: { kind: "colour", subvalue: "effect-colour" },
			},
			decorative: toggle("decorative"),
		},
		allowedChildren: [],
	}),
	heading: block("heading", "## Heading\n", {
		subject: subject("title", true),
		allowedChildren: [],
	}),
};
const backDefinition = block("back", "::: back\nBack\n:::\n", { subject: subject("none") });

/** Inject into analyzeLessonTree. G5 can compose its declarations with this lookup. */
export function getDefinition(type: string): BlockDefinition | undefined {
	return type === "back"
		? backDefinition
		: Object.hasOwn(BLOCK_SCHEMA, type)
			? BLOCK_SCHEMA[type]
			: undefined;
}
export function suggestType(type: string): string | undefined {
	const suggestions: Readonly<Record<string, string>> = {
		tab: "tabs",
		card: "cards",
		"data-table": "table",
	};
	return Object.hasOwn(suggestions, type) ? suggestions[type] : undefined;
}

export interface CourseLesson {
	path: string;
	tree: AnalyzedLessonTree;
}
export interface CourseValidationOptions {
	cast?: Readonly<Record<string, unknown>>;
	variables?: Readonly<Record<string, string | number | boolean>>;
	pageStyles?: Readonly<Record<string, unknown>>;
}
export interface CourseDiagnostic extends AnalysisDiagnostic {
	path: string;
}
export interface CourseOccurrence {
	path: string;
	line: number;
	column: number;
	start: number;
}
export interface GlossaryDefinition extends CourseOccurrence {
	term: string;
	definition: string;
}
export interface CourseValidationResult {
	diagnostics: CourseDiagnostic[];
	glossary: ReadonlyMap<string, GlossaryDefinition>;
	names: ReadonlyMap<string, CourseOccurrence>;
}

/** Metadata validation shared by the single-lesson reader and course checks. */
export function readTreeFrontmatter(tree: AnalyzedLessonTree): {
	data: Record<string, unknown>;
	error?: string;
} {
	const frontmatter = tree.root.children.find((node) => node.kind === "frontmatter");
	if (!frontmatter) return { data: {} };
	const lines = tree.stream.lines.filter(
		(line) => line.start >= frontmatter.span.start && line.end <= frontmatter.span.end,
	);
	let data: Record<string, unknown> = {};
	try {
		const document = parseDocument(tree.stream.source.slice(lines[0]?.end, lines.at(-1)?.start));
		if (document.errors.length) throw new Error(document.errors[0].message);
		const parsed: unknown = document.toJS();
		if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed)))
			throw new Error("Frontmatter must be a mapping");
		data = (parsed ?? {}) as Record<string, unknown>;
		for (const key of ["kicker", "time"])
			if (Object.hasOwn(data, key) && typeof data[key] !== "string")
				throw new Error(`${key} must be a string`);
		for (const key of ["variables", "pageStyles"])
			if (
				data[key] !== undefined &&
				(!data[key] || typeof data[key] !== "object" || Array.isArray(data[key]))
			)
				throw new Error(`${key} must be a mapping`);
		return { data };
	} catch (error) {
		return { data, error: error instanceof Error ? error.message : String(error) };
	}
}

export function inlineText(nodes: readonly InlineNode[]): string {
	return nodes
		.map((n): string =>
			"children" in n
				? inlineText(n.children)
				: n.kind === "text"
					? n.value
					: n.kind === "code"
						? n.content.value
						: n.raw,
		)
		.join("");
}
/** Learner fields only. Never scan structural settings, URLs, frontmatter or rule expressions. */
export function learnerInline(lesson: CourseLesson): InlineNode[] {
	const { stream, root } = lesson.tree;
	const result: InlineNode[] = [];
	const seen = new Set<string>();
	const read = (start: number, end: number, blankAnswers = false) => {
		const key = `${start}:${end}`;
		if (seen.has(key)) return;
		seen.add(key);
		const append = (start: number, end: number) => {
			const children = tokenizeInline(stream.source, { start, end }).children;
			if (!blankAnswers) {
				result.push(...children);
				return;
			}
			let offset = start;
			const answers: { start: number; end: number }[] = [];
			for (const part of fillBlankParts(maskedBlankContent(stream.source.slice(start, end)))) {
				if (part.blank) answers.push({ start: offset, end: offset + part.text.length });
				offset += part.text.length;
			}
			const outsideAnswers = (nodes: InlineNode[]): InlineNode[] =>
				nodes
					.filter((n) => !answers.some((a) => a.start <= n.start && n.end <= a.end))
					.map((n) => ("children" in n ? { ...n, children: outsideAnswers(n.children) } : n));
			result.push(...outsideAnswers(children));
		};
		// Split around protected block literals while preserving multiline inline ranges elsewhere.
		let cursor = start;
		for (const line of stream.lines) {
			if (
				line.end <= start ||
				line.start >= end ||
				!["code", "code-fence", "math", "math-fence"].includes(line.kind)
			)
				continue;
			if (line.start > cursor) append(cursor, Math.min(line.start, end));
			cursor = Math.min(line.end, end);
		}
		if (cursor < end) append(cursor, end);
	};
	const visit = (node: TreeNode, covered = false, inBlanks = false) => {
		if (getDefinition(node.type ?? "")?.literalText) return;
		if (node.kind === "frontmatter" || node.type === "rule" || node.kind === "recovery") return;
		for (const v of [node.subject, node.alt]) if (v) read(v.span.start, v.span.end);
		if (node.value && !covered) read(node.value.span.start, node.value.span.end);
		if (node.text && !covered) read(node.text.range.start, node.text.range.end);
		if (node.answer) read(node.answer.range.start, node.answer.range.end);
		for (const row of node.rows ?? [])
			for (const cell of row.cells) read(cell.range.start, cell.range.end);
		if (node.kind === "body" && !covered) read(node.span.start, node.span.end, inBlanks);
		for (const child of node.children)
			visit(
				child,
				child.kind === "body" && !!(node.text || node.value),
				inBlanks || node.type === "fill-blank",
			);
	};
	visit(root);
	return result;
}

/** Course-wide checks are pure and retain the first definition/name in supplied lesson order. */
export function validateCourse(
	lessons: readonly CourseLesson[],
	options: CourseValidationOptions = {},
): CourseValidationResult {
	const diagnostics: CourseDiagnostic[] = [];
	const glossary = new Map<string, GlossaryDefinition>();
	const names = new Map<string, CourseOccurrence>();
	const selfCheckNames = new Set<string>();
	const practiceNames = new Set<string>();
	const practiceContainerNames = new Set<string>();
	const mentions: { lesson: CourseLesson; node: Extract<InlineNode, { kind: "term" }> }[] = [];
	const nodes = new Map<CourseLesson, TreeNode[]>();
	const practiceAncestors = new Map<CourseLesson, ReadonlySet<TreeNode>>();
	const inline = new Map<CourseLesson, InlineNode[]>();
	const metadata = new Map<CourseLesson, Record<string, unknown>>();
	const occurrence = (lesson: CourseLesson, start: number): CourseOccurrence => ({
		path: lesson.path,
		start,
		...lineColumn(lesson.tree.stream.source, start),
	});
	const spanAt = (lesson: CourseLesson, start: number): SourceSpan => {
		const line = lesson.tree.stream.lines.find((l) => l.start <= start && start < l.end);
		return line
			? { start: line.start, end: line.end, tokenStart: line.tokenStart, tokenEnd: line.tokenEnd }
			: lesson.tree.root.span;
	};
	const report = (
		lesson: CourseLesson,
		code: AnalysisDiagnostic["code"],
		start: number,
		args: AnalysisDiagnostic["message"]["args"] = {},
		span?: SourceSpan,
	) => {
		const position = lineColumn(lesson.tree.stream.source, start);
		diagnostics.push({
			path: lesson.path,
			code,
			span: span ?? spanAt(lesson, start),
			...position,
			severity: "error",
			message: { key: `grammar.v4.${code}`, args: { ...position, ...args } },
		});
	};
	for (const lesson of lessons) {
		// Replace G3's literal same-lesson glossary fallback with the G6 course check below.
		diagnostics.push(
			...lesson.tree.diagnostics
				.filter((d) => d.code !== "conflicting-glossary-definitions")
				.map((d) => ({ ...d, path: lesson.path })),
		);
		const all = descendants(lesson.tree.root);
		nodes.set(lesson, all);
		// Parents precede children in `all`; one reverse pass indexes subtree
		// ownership and strict sheet ancestors without walking each subtree again.
		const practiceOwners = new Set<TreeNode>();
		const literalPracticeAncestors = new Set<TreeNode>();
		for (let index = all.length - 1; index >= 0; index--) {
			const node = all[index];
			if (
				node.children.some(
					(child) =>
						["retrieval-sheet", "write-distractors", "highlight"].includes(child.type ?? "") ||
						literalPracticeAncestors.has(child),
				)
			)
				literalPracticeAncestors.add(node);
			if (
				isPrivateChoice(node) ||
				["retrieval-sheet", "write-distractors", "highlight"].includes(node.type ?? "") ||
				node.children.some((child) => practiceOwners.has(child))
			)
				practiceOwners.add(node);
		}
		practiceAncestors.set(lesson, literalPracticeAncestors);
		const frontmatter = all.find((n) => n.kind === "frontmatter");
		const { data, error } = readTreeFrontmatter(lesson.tree);
		if (frontmatter && error)
			report(lesson, "invalid-course-metadata", frontmatter.span.start, { reason: error });
		metadata.set(lesson, data);
		for (const node of all) {
			const setting = node.settings.find((s) => s.name === "name");
			if (!setting) continue;
			const name = String(setting.value.value);
			const first = names.get(name);
			if (!first && node.type === "self-check") selfCheckNames.add(name);
			// Duplicate-name diagnostics are non-blocking in publication hosts. Any
			// matching practice definition must still establish the privacy boundary.
			if (
				isPrivateChoice(node) ||
				["retrieval-sheet", "write-distractors", "highlight"].includes(node.type ?? "")
			)
				practiceNames.add(name);
			if (practiceOwners.has(node)) practiceContainerNames.add(name);
			if (first)
				report(lesson, "duplicate-logic-name", setting.span.start, {
					name,
					firstPath: first.path,
					firstLine: first.line,
					secondPath: lesson.path,
					secondLine: occurrence(lesson, setting.span.start).line,
				});
			else names.set(name, occurrence(lesson, setting.span.start));
		}
		const leaves: InlineNode[] = [];
		const seen = new Set<number>();
		const visit = (children: readonly InlineNode[]) => {
			for (const child of children) {
				if (seen.has(child.start)) continue;
				seen.add(child.start);
				leaves.push(child);
				if (child.kind === "term") {
					const term = inlineText(child.children);
					if (child.definition.value) {
						const first = glossary.get(term);
						if (first && first.definition !== child.definition.value)
							report(lesson, "conflicting-glossary-definitions", child.start, {
								term,
								firstPath: first.path,
								firstLine: first.line,
								secondPath: lesson.path,
								secondLine: occurrence(lesson, child.start).line,
							});
						else if (!first)
							glossary.set(term, {
								...occurrence(lesson, child.start),
								term,
								definition: child.definition.value,
							});
					} else mentions.push({ lesson, node: child });
				}
				if ("children" in child) visit(child.children);
			}
		};
		visit(learnerInline(lesson));
		inline.set(lesson, leaves);
	}
	for (const { lesson, node } of mentions) {
		const term = inlineText(node.children);
		if (!glossary.has(term)) report(lesson, "undefined-glossary-term", node.start, { term });
	}
	for (const lesson of lessons) {
		const data = metadata.get(lesson) ?? {};
		const castKeys = new Set(Object.keys(options.cast ?? {}).map((key) => key.toLowerCase()));
		const variables = {
			...options.variables,
			...(data.variables as Record<string, unknown> | undefined),
		};
		const pageStyles = {
			...options.pageStyles,
			...(data.pageStyles as Record<string, unknown> | undefined),
		};
		const checkName = (name: string, kind: "block" | "variable", start: number) => {
			if (kind === "block" ? !names.has(name) : !Object.hasOwn(variables, name))
				report(lesson, "unknown-logic-name", start, { name, kind });
		};
		const checkCondition = (value: string, start: number, span?: SourceSpan) => {
			const condition = parseLogicConditionExpression(value);
			const match = /^(variable|block):(.+)$/.exec(condition.source);
			if (match?.[1] === "block" && practiceNames.has(match[2]))
				report(lesson, "practice-no-tracking", start, {}, span);
			if (
				match?.[1] === "block" &&
				selfCheckNames.has(match[2]) &&
				condition.field !== "isAttempted" &&
				condition.field !== "isCompleted"
			)
				report(lesson, "self-check-no-correctness", start);
			if (match && universal.name.accepts(match[2]))
				checkName(match[2], match[1] as "block" | "variable", start);
			else report(lesson, "response-invariant", start, { rule: "valid-condition-required" });
		};
		for (const node of inline.get(lesson) ?? [])
			if (node.kind === "variable") checkName(node.name.value, "variable", node.start);
		for (const node of nodes.get(lesson) ?? []) {
			if (node.kind === "turn" && !castKeys.has(String(node.speaker?.value ?? "").toLowerCase()))
				report(lesson, "unknown-cast-speaker", node.speaker?.range.start ?? node.span.start, {
					speaker: String(node.speaker?.value ?? ""),
				});
			// Unknown gate spellings remain unknown-setting. The same authored
			// token must also establish the course practice refusal before schema
			// filtering removes it from the analyzed settings.
			for (const setting of node.header && practiceAncestors.get(lesson)?.has(node)
				? readHeaderSettings(lesson.tree.stream, node.header)
				: []) {
				if (
					setting.name === "deckGate" ||
					(setting.name === "required" && [true, "true"].includes(setting.value.value))
				)
					report(lesson, "practice-no-tracking", setting.span.start, {}, setting.span);
			}
			for (const setting of node.settings) {
				if (setting.name === "visible")
					checkCondition(String(setting.value.value), setting.span.start, setting.span);
				if (
					node.kind === "page" &&
					setting.name === "style" &&
					!Object.hasOwn(pageStyles, String(setting.value.value))
				)
					report(lesson, "unknown-page-style", setting.span.start, {
						name: String(setting.value.value),
					});
			}
			if (node.type === "rule")
				for (const part of node.children.filter((n) => n.kind === "part")) {
					const value = String(part.value?.value ?? "");
					if (part.name !== "then") checkCondition(value, part.span.start);
					else {
						const action = parseRuleAction(value);
						for (const target of action?.targets ?? []) {
							if (action?.type === "require" && practiceContainerNames.has(target))
								report(lesson, "practice-no-tracking", part.span.start);
							checkName(
								target,
								action?.type === "setVariable" ? "variable" : "block",
								part.span.start,
							);
						}
					}
				}
		}
	}
	return { diagnostics, glossary, names };
}

export interface ConversionDeclaration {
	target: string;
	/** Stable loss identifiers. Hosts translate them and show only authored losses. */
	losses: readonly string[];
	losesAnswers: boolean;
}
const itemConversions = ["accordion", "tabs", "sequence", "cards"];
const proseConversions = ["text", "note", "quote"];
const responseConversions = ["choice", "rating", "matrix", "checklist", "order"];
const responseLosses: Readonly<Record<string, readonly string[]>> = {
	choice: ["correct-answer-markers", "option-feedback", "learner-answers"],
	match: ["match-pairs", "learner-answers"],
	order: ["correct-order", "learner-answers"],
	categorize: ["categories", "learner-answers"],
	"fill-blank": ["blank-answers", "learner-answers"],
	"free-response": ["learner-answers"],
	rating: ["learner-answers"],
	matrix: ["learner-answers"],
	hotspot: ["correct-spots", "spot-geometry", "learner-answers"],
	checklist: ["checked-state", "learner-answers"],
	signature: ["learner-answers"],
};
const scoringSettings = ["points", "scored", "attempts", "passingScore", "pointsOverride"];
function conversion(source: string, target: string): ConversionDeclaration {
	const from = BLOCK_SCHEMA[source];
	const to = BLOCK_SCHEMA[target];
	const losses: string[] = [];
	if (from.subject.kind !== "none" && to.subject.kind === "none") losses.push("subject");
	for (const [name, setting] of Object.entries(from.settings)) {
		const next = to.settings[name];
		if (
			!next ||
			(setting.values && next.values && setting.values.some((v) => !next.values?.includes(v)))
		)
			losses.push(`setting:${name}`);
	}
	for (const part of from.parts ?? []) if (!to.parts?.includes(part)) losses.push(`part:${part}`);
	if (source === "cards" && target !== "cards") losses.push("back-faces");
	if (from.items && !to.items) losses.push("item-boundaries", "item-titles");
	if (from.body === "tables" && to.body !== "tables") losses.push("table-structure");
	if (source === "dialogue") losses.push("turn-speakers");
	if (["rating", "matrix"].includes(source) && !["rating", "matrix"].includes(target))
		losses.push("scale-labels");
	if (source === "figure" && target !== "figure") losses.push("image", "caption-role");
	if (
		["video", "audio", "embed", "bookmark", "button", "image"].includes(source) &&
		to.subject.kind === "none"
	)
		losses.push("source");
	losses.push(...(responseLosses[source] ?? []));
	return {
		target,
		losses: [...new Set(losses)],
		losesAnswers:
			!!responseLosses[source] ||
			losses.some((l) => scoringSettings.includes(l.replace(/^setting:/, ""))),
	};
}
function conversionTargets(source: string): string[] {
	if (itemConversions.includes(source))
		return [...itemConversions.filter((t) => t !== source), "text"];
	if (proseConversions.includes(source))
		return [
			...proseConversions.filter((t) => t !== source),
			...(source === "note" ? ["accordion"] : []),
		];
	if (responseConversions.includes(source))
		return [...responseConversions.filter((t) => t !== source), "text"];
	if (source === "bookmark" || source === "button")
		return [source === "bookmark" ? "button" : "bookmark", "text"];
	if (source === "divider") return ["page"];
	if (source === "heading") return ["text"];
	if (
		[
			"page",
			"rule",
			"group",
			"columns",
			"comparison",
			"self-check",
			"retrieval-sheet",
			"highlight",
			"write-distractors",
		].includes(source)
	)
		return [];
	return ["text"];
}
/** Empty rows deliberately offer no conversion. Transformations and state compatibility belong to O4/L1. */
export const TURN_INTO: Readonly<Record<string, readonly ConversionDeclaration[]>> =
	Object.fromEntries(
		Object.keys(BLOCK_SCHEMA).map((type) => [
			type,
			conversionTargets(type).map((target) => conversion(type, target)),
		]),
	);
/** A selection can wrap only if every selected type lists that target. Columns use their dedicated operation. */
export const WRAP_IN: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
	Object.keys(BLOCK_SCHEMA).map((type) => [
		type,
		["page", "rule"].includes(type)
			? []
			: [
					...itemConversions.filter((t) => t !== "cards"),
					"note",
					...(groupContentTypes.includes(type) ? ["group"] : []),
				],
	]),
);

function publishedDefinition(definition: BlockDefinition): Record<string, unknown> {
	const {
		validate: _validate,
		subject: subjectDefinition,
		settings,
		itemDefinition,
		...rest
	} = definition;
	const { accepts: _accepts, ...publishedSubject } = subjectDefinition;
	return {
		...rest,
		subject: publishedSubject,
		settings: Object.fromEntries(
			Object.entries(settings).map(([name, { accepts: _acceptsSetting, ...setting }]) => [
				name,
				setting,
			]),
		),
		...(itemDefinition ? { itemDefinition: publishedDefinition(itemDefinition) } : {}),
	};
}
/** JSON-only schema projection. Executable validators stay in grammar; no timestamps or host state. */
export function generateBlocksIndex() {
	return JSON.parse(
		// The published index names message keys `label`: secret scanners read a
		// `"labelKey": "dotted.value"` pair as a generic API key.
		JSON.stringify({
			grammarVersion: 4,
			generatedFrom: "packages/grammar/src/v4/schema.ts",
			blocks: Object.entries(BLOCK_SCHEMA).map(([id, definition]) => ({
				id,
				...publishedDefinition(definition),
				...(id === "choice" ? { responseInvariant: choiceResponseInvariant } : {}),
				turnInto: TURN_INTO[id],
				wrapIn: WRAP_IN[id],
			})),
			spotSettings: Object.fromEntries(
				Object.entries(SPOT_SETTINGS).map(([name, { accepts: _accepts, ...setting }]) => [
					name,
					setting,
				]),
			),
		}),
		(_key, value) => {
			if (
				value === null ||
				typeof value !== "object" ||
				Array.isArray(value) ||
				!("labelKey" in value)
			) {
				return value;
			}
			const { labelKey, ...rest } = value;
			return { ...rest, label: labelKey };
		},
	);
}
