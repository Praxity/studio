import type { SourceEdit } from "../source-edit.ts";

export type OperationIntent =
	| "modify"
	| "replace"
	| "copy"
	| "move"
	| "split"
	| "merge"
	| "insert"
	| "delete"
	| "convert";

export type IdentityFate =
	| "kept"
	| "new"
	| "retired"
	| "pending"
	| "survivor"
	| "absorbed"
	| "copied"
	| "cut";

export interface NodeRef {
	kind: "node";
	nodeId: string | null;
	path: readonly number[];
	fingerprint: string;
}

export interface InsertionPoint {
	kind: "insertion";
	parentId: string | null;
	after: string | null;
	before: string | null;
	parentRef?: NodeRef;
	afterRef?: NodeRef;
	beforeRef?: NodeRef;
}

export interface CourseTarget {
	kind: "course";
	courseId: string;
}

export interface ManifestTarget {
	kind: "manifest";
	path: readonly (string | number)[];
}

export type OperationTargetRef = NodeRef | InsertionPoint | CourseTarget | ManifestTarget;

export interface OperationTarget {
	file: string;
	ref: OperationTargetRef;
	expectedText?: string;
	inline?: { start: number; end: number; expectedText: string };
}

export interface OperationFileBase {
	path: string;
	baseRevision: string;
}

export interface OperationRequest {
	transactionId: string;
	operation: string;
	files: OperationFileBase[];
	targets: OperationTarget[];
	args: Record<string, unknown>;
}

export interface OperationFileEdits {
	path: string;
	fromRevision: string;
	toRevision: string;
	edits: SourceEdit[];
}

export interface IdentityMapping {
	oldId: string | null;
	newId: string | null;
	fate: IdentityFate;
}

export interface WrittenNodeGuard {
	kind: "written";
	file: string;
	ref: NodeRef;
	text: string;
}

export interface DeletedNodeGuard {
	kind: "deleted";
	file: string;
	nodeId: string;
	ref: InsertionPoint;
}

export interface InsertionBoundaryGuard {
	kind: "insertion-boundary";
	file: string;
	ref: InsertionPoint;
	beforeText: string | null;
	afterText: string | null;
}

export type InverseGuard = WrittenNodeGuard | DeletedNodeGuard | InsertionBoundaryGuard;

export interface OperationInverse {
	files: OperationFileEdits[];
	mapping: IdentityMapping[];
	guards: InverseGuard[];
}

export interface MessageRef {
	key: `op.${string}`;
	params: Record<string, string | number>;
}

export interface OperationDiagnostic {
	file: string;
	ref: OperationTargetRef | null;
	severity: "error" | "warning" | "info";
	message: MessageRef;
	range?: Pick<SourceEdit, "start" | "end">;
}

export interface FocusTarget {
	file: string;
	nodeId: string | null;
	role: "handle" | "source" | `chip:${string}` | "outline" | "bubble";
}

export interface OperationResult {
	ok: true;
	transactionId: string;
	files: OperationFileEdits[];
	intent: OperationIntent;
	mapping: IdentityMapping[];
	inverse: OperationInverse;
	summary: MessageRef;
	diagnostics: OperationDiagnostic[];
	focus: FocusTarget;
}

export const operationRefusalCodes = [
	"stale",
	"conflict",
	"ambiguous",
	"orphaned",
	"escapes-range",
	"not-allowed",
	"invalid-args",
	"empty-text",
	"line-break",
	"unsupported-syntax",
	"list-marker",
	"settings",
	"source-invalid",
	"bad-yaml",
	"identity-retirement-pending",
] as const;
export type OperationRefusalCode = (typeof operationRefusalCodes)[number];

export interface OperationRefusal {
	ok: false;
	transactionId: string;
	code: OperationRefusalCode;
	message: MessageRef;
	member?: string;
	file?: string;
}
