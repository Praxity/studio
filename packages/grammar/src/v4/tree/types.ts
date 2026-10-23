import type { DiagnosticCode, TokenStream } from "../lex/index.ts";

/** Half-open UTF-16 offsets and indexes into the unchanged G1 token stream. */
export interface SourceSpan {
	start: number;
	end: number;
	tokenStart: number;
	tokenEnd: number;
}

export interface SourceValue {
	span: SourceSpan;
	raw: string;
	value: string | boolean;
}

export interface TreeSetting {
	name: string;
	span: SourceSpan;
	value: SourceValue;
}

export type TreeKind =
	| "lesson"
	| "frontmatter"
	| "page"
	| "block"
	| "item"
	| "back"
	| "part"
	| "heading"
	| "divider"
	| "image"
	| "body"
	| "option"
	| "task"
	| "pair"
	| "step"
	| "turn"
	| "spot"
	| "list"
	| "list-entry"
	| "table"
	| "recovery";

/** Editable slices within a lexical prose token. Node spans still cover whole tokens. */
export interface BodyValue {
	range: { start: number; end: number };
	raw: string;
	value: string | boolean;
}
export interface BodySetting {
	name: string;
	range: { start: number; end: number };
	value: BodyValue;
}
export type BodyKind =
	| "options"
	| "tasks"
	| "pairs"
	| "steps"
	| "turns"
	| "spots"
	| "lists"
	| "tables";
export interface BodyDefinition {
	/** Authored fields are plain text, excluded from inline and glossary interpretation. */
	literalText?: boolean;
	body?: BodyKind;
	items?: boolean;
	heading?: boolean;
	itemHeading?: boolean;
	parts?: readonly string[];
	settings?: Readonly<
		Record<string, { values?: readonly string[]; accepts?: (value: string | boolean) => boolean }>
	>;
	settingAliases?: Readonly<Record<string, string>>;
	/** Item declarations belong to the enclosing container, not a global item vocabulary. */
	itemDefinition?: BodyDefinition;
	/** Schema-owned constraints run after body interpretation, before status propagation. */
	validate?: (node: TreeNode, parent?: TreeNode) => readonly DefinitionIssue[];
}
export interface DefinitionIssue {
	code: AnalysisDiagnosticCode;
	span?: SourceSpan;
	args?: MessageRef["args"];
	severity?: "error" | "warning";
}
export interface AnalysisOptions {
	/** G4/G5 supplies declarations, including page/image/divider definitions when needed. */
	definition: (type: string) => BodyDefinition | undefined;
	suggestType?: (type: string) => string | undefined;
	/** G6/G5 supplies inline definitions, including prior course occurrences. */
	glossaryDefinitions?: readonly {
		term: string;
		definition: string;
		start: number;
		line: number;
	}[];
}
export interface MessageRef {
	key: `grammar.v4.${string}`;
	args: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

export interface TreeNode {
	kind: TreeKind;
	status: "resolved" | "unresolved";
	span: SourceSpan;
	raw: string;
	children: TreeNode[];
	trivia: SourceSpan[];
	header?: SourceSpan;
	closer?: SourceSpan;
	type?: string;
	name?: string;
	subject?: SourceValue;
	value?: SourceValue;
	alt?: SourceValue;
	source?: SourceValue;
	settings: TreeSetting[];
	headingLevel?: number;
	text?: BodyValue;
	answer?: BodyValue;
	speaker?: BodyValue;
	correct?: boolean;
	checked?: boolean;
	optionKind?: "single" | "multiple";
	bodySettings?: BodySetting[];
	ordered?: boolean;
	startNumber?: number;
	number?: number;
	rows?: { span: SourceSpan; cells: BodyValue[]; header: boolean }[];
	alignments?: ("left" | "center" | "right" | undefined)[];
}

export type TreeDiagnosticCode =
	| DiagnosticCode
	| "unclosed-block"
	| "stray-closer"
	| "stray-item"
	| "content-before-page";

export type AnalysisDiagnosticCode =
	| TreeDiagnosticCode
	| "unknown-type"
	| "unknown-setting"
	| "bad-setting-value"
	| "item-before-close"
	| "mixed-option-markers"
	| "conflicting-glossary-definitions"
	| "grammar-3"
	| "detached-option-feedback"
	| "duplicate-option-feedback"
	| "nested-order-list"
	| "heading-level-clamped"
	| "part-colon-spacing"
	| "missing-subject"
	| "bad-subject"
	| "disallowed-child"
	| "child-count"
	| "missing-part"
	| "empty-part"
	| "duplicate-part"
	| "model-after-criterion"
	| "self-check-in-group"
	| "evidence-not-once"
	| "practice-title-too-long"
	| "practice-question-too-long"
	| "practice-answer-too-long"
	| "practice-right-answer-too-long"
	| "practice-misconception-too-long"
	| "practice-option-too-long"
	| "write-distractors-invalid"
	| "write-distractors-duplicate-label"
	| "write-distractors-author-right"
	| "retrieval-sheet-invalid"
	| "highlight-chunk-too-long"
	| "highlight-note-too-long"
	| "highlight-chunk-whitespace"
	| "highlight-no-target"
	| "highlight-invalid"
	| "self-check-invalid"
	| "self-check-no-correctness"
	| "private-choice-practice-only"
	| "practice-no-tracking"
	| "unsupported-runtime"
	| "missing-image-alt"
	| "response-invariant"
	| "undefined-glossary-term"
	| "unknown-cast-speaker"
	| "unknown-logic-name"
	| "duplicate-logic-name"
	| "unknown-page-style"
	| "invalid-course-metadata";

/** Language-neutral facts; G3 supplies MessageRef diagnostics. */
export interface TreeDiagnostic {
	code: TreeDiagnosticCode;
	span: SourceSpan;
	line: number;
	column: number;
	type?: string;
	name?: string;
	firstStart?: number;
}

export interface TreeOptions {
	/** G4/G5 owns part names. Unclassified named lines stay in the body. */
	isPart?: (name: string, owner: TreeNode, parent?: TreeNode) => boolean;
	/** Semantic pass enables schema-aware item recovery; G2 callers keep strict generic structure. */
	allowsItems?: (owner: TreeNode) => boolean;
}

export interface AnalysisDiagnostic extends Omit<TreeDiagnostic, "code"> {
	code: AnalysisDiagnosticCode;
	message: MessageRef;
	severity: "error" | "warning";
}
export interface AnalyzedLessonTree extends Omit<LessonTree, "diagnostics"> {
	diagnostics: AnalysisDiagnostic[];
	refused: boolean;
}

export interface LessonTree {
	stream: TokenStream;
	root: TreeNode;
	diagnostics: TreeDiagnostic[];
}
