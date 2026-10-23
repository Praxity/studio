export type LineKind =
	| "frontmatter-fence"
	| "frontmatter"
	| "page"
	| "heading"
	| "opener"
	| "closer"
	| "item"
	| "part"
	| "divider"
	| "image"
	| "code-fence"
	| "code"
	| "math-fence"
	| "math"
	| "quote"
	| "list-item"
	| "prose"
	| "blank"
	| "diagnostic";

export type DiagnosticCode =
	| "spaces-around-equals"
	| "missing-settings-close"
	| "unclosed-setting-quote"
	| "invalid-setting-quote"
	| "missing-setting-value"
	| "invalid-setting-key"
	| "invalid-setting-value"
	| "missing-setting-separator"
	| "duplicate-setting"
	| "multiple-settings-groups"
	| "settings-not-final"
	| "setting-on-body-line";

/** Language-neutral facts. Tree/schema diagnostics supply translated messages later. */
export interface LexDiagnostic {
	code: DiagnosticCode;
	name?: string;
	firstStart?: number;
}

export type TokenKind =
	| "bom"
	| "marker"
	| "whitespace"
	| "subject"
	| "block-type"
	| "part-name"
	| "part-value"
	| "image-alt"
	| "image-source"
	| "settings-open"
	| "settings-close"
	| "setting-key"
	| "setting-equals"
	| "setting-value"
	| "setting-flag"
	| "diagnostic"
	| "prose"
	| "blank"
	| "line-ending"
	| "frontmatter"
	| "code"
	| "math"
	| "quote";

export type Token = {
	start: number;
	end: number;
	raw: string;
} & (
	| { kind: "diagnostic"; value: LexDiagnostic }
	| { kind: Exclude<TokenKind, "diagnostic">; value?: string | boolean }
);

export interface TokenLine {
	kind: LineKind;
	/** UTF-16 offsets, including the BOM on the first line and its original terminator. */
	start: number;
	contentEnd: number;
	end: number;
	/** Half-open indexes into TokenStream.tokens. No synthetic EOF line/token. */
	tokenStart: number;
	tokenEnd: number;
}

export interface TokenStream {
	source: string;
	tokens: Token[];
	lines: TokenLine[];
}

export interface LexOptions {
	/**
	 * Schema/tree supplies contextual setting names, aliases and near misspellings.
	 * Unknown name: lines remain part candidates for the tree to resolve as learner text.
	 * The offset lets the caller select its enclosing schema without a second stack here.
	 */
	isSettingName?: (name: string, lineStart: number) => boolean;
}
