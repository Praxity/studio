import type { SourceEdit } from "../source-edit.ts";

/** Identity intent is derived by the registry, including for source edits. */
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

/** Fates tell identity consumers which IDs continue, disappear or await resolution. */
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
	/** Distinguishes an existing node from a location or course target. */
	kind: "node";
	/** Resolves durable identity; null permits read-only targets without assigned IDs. */
	nodeId: string | null;
	/** Supplies a structural locator when identity is unavailable, never sole authority. */
	path: readonly number[];
	/** Disambiguates structural matches without becoming an identity. */
	fingerprint: string;
}

export interface InsertionPoint {
	/** Distinguishes a sibling boundary from an existing node. */
	kind: "insertion";
	/** Binds the boundary to its owner; null denotes the file root. */
	parentId: string | null;
	/** Anchors the preceding sibling; null denotes the owner's start. */
	after: string | null;
	/** Anchors the following sibling; null denotes the owner's end. */
	before: string | null;
	/** ID-free anchors from an admitted read view; each requires a unique fingerprint and current path. */
	parentRef?: NodeRef;
	afterRef?: NodeRef;
	beforeRef?: NodeRef;
}

export interface CourseTarget {
	/** Selects course scope without inventing a source node. */
	kind: "course";
	/** Binds the operation to the sidecar's course namespace. */
	courseId: string;
}

export interface ManifestTarget {
	/** Selects a manifest value without inventing a source node. */
	kind: "manifest";
	/** Locates a manifest key or array member within the target file. */
	path: readonly (string | number)[];
}

export type OperationTargetRef = NodeRef | InsertionPoint | CourseTarget | ManifestTarget;

export interface OperationTarget {
	/** Qualifies the reference with a project-relative participating file. */
	file: string;
	/** Identifies the node, boundary or broader scope the operation may change. */
	ref: OperationTargetRef;
	/** Guards replacement against exact source text, including its original line endings. */
	expectedText?: string;
	/** Selects one token in the node by base-revision UTF-16 offsets and exact raw spelling. */
	inline?: { start: number; end: number; expectedText: string };
}

export interface OperationFileBase {
	/** Identifies one project-relative file participating in the transaction. */
	path: string;
	/** Binds this file to the SHA-256 of its UTF-8 bytes before resolution or rebase. */
	baseRevision: string;
}

export interface OperationRequest {
	/** Correlates one all-or-none transaction across files, replies and history. */
	transactionId: string;
	/** Selects the named registry operation shared by editor and CLI. */
	operation: string;
	/** Gives every participating file its own revision precondition. */
	files: OperationFileBase[];
	/** Declares all targets so resolution succeeds for every member or refuses entirely. */
	targets: OperationTarget[];
	/** Carries operation-specific input for the registry to validate at its boundary. */
	args: Record<string, unknown>;
}

export interface OperationFileEdits {
	/** Associates edits and revisions with one project-relative file. */
	path: string;
	/** Records the SHA-256 of the exact bytes against which these edits were computed. */
	fromRevision: string;
	/** Records the SHA-256 of the exact resulting bytes for this recorded transition. */
	toRevision: string;
	/** Reuses half-open UTF-16 offsets into UTF-8-decoded text with original line endings. */
	edits: SourceEdit[];
}

export interface IdentityMapping {
	/** Names the original identity; null marks a newly allocated entity. */
	oldId: string | null;
	/** Names the resulting identity; null marks an entity absent from the result. */
	newId: string | null;
	/** Tells the identity owner how this operation treats the entity. */
	fate: IdentityFate;
}

export interface WrittenNodeGuard {
	/** Selects the check for a surviving node's exact written slice. */
	kind: "written";
	/** Finds the written node in its current project-relative file. */
	file: string;
	/** Resolves the written identity before rebasing the inverse offsets. */
	ref: NodeRef;
	/** Prevents undo from overwriting changes to the operation's own slice. */
	text: string;
}

export interface DeletedNodeGuard {
	/** Selects the absence check for an identity removed by the operation. */
	kind: "deleted";
	/** Qualifies the deleted node's original project-relative file. */
	file: string;
	/** Requires the removed identity to remain absent before undo restores it. */
	nodeId: string;
	/** Locates the restoration slot when the deleted node has no current slice. */
	ref: InsertionPoint;
}

export interface InsertionBoundaryGuard {
	/** Selects the adjacency and text checks for an insertion or restoration slot. */
	kind: "insertion-boundary";
	/** Qualifies the boundary's project-relative file. */
	file: string;
	/** Requires the same owner and adjacent siblings, including start and end boundaries. */
	ref: InsertionPoint;
	/** Guards the following sibling's exact slice; null requires the owner's end. */
	beforeText: string | null;
	/** Guards the preceding sibling's exact slice; null requires the owner's start. */
	afterText: string | null;
}

export type InverseGuard = WrittenNodeGuard | DeletedNodeGuard | InsertionBoundaryGuard;

export interface OperationInverse {
	/** Records per-file reverse transitions; rebased undo must recompute offsets and hashes. */
	files: OperationFileEdits[];
	/** Restores the recorded identities instead of allocating replacements during undo. */
	mapping: IdentityMapping[];
	/** Protects written slices, absent identities and boundaries while unrelated edits may rebase. */
	guards: InverseGuard[];
}

export interface MessageRef {
	/** Names caller-owned interface copy rather than returning a rendered sentence. */
	key: `op.${string}`;
	/** Supplies substitution values so each caller can format its own language. */
	params: Record<string, string | number>;
}

export interface OperationDiagnostic {
	/** Identifies the project-relative file containing invalid but contained source. */
	file: string;
	/** Locates the affected scope; null covers text the parser could not rebuild. */
	ref: OperationTargetRef | null;
	/** Lets callers distinguish blocking errors from advisory diagnostics. */
	severity: "error" | "warning" | "info";
	/** Carries localized diagnostic copy without coupling the registry to an interface. */
	message: MessageRef;
	/** Locates the diagnostic in the resulting file using the same UTF-16 offset convention. */
	range?: Pick<SourceEdit, "start" | "end">;
}

export interface FocusTarget {
	/** Routes focus to the correct file after operations across lessons. */
	file: string;
	/** Identifies the logical focus owner; null permits a course or manifest focus target. */
	nodeId: string | null;
	/** Names a logical control so the caller can restore focus without DOM references. */
	role: "handle" | "source" | `chip:${string}` | "outline" | "bubble";
}

export interface OperationResult {
	/** Discriminates an applied operation from a refusal. */
	ok: true;
	/** Associates the result with the request's all-or-none transaction. */
	transactionId: string;
	/** Records edits and the actual revision transition separately for every file. */
	files: OperationFileEdits[];
	/** Reports the registry's identity decision instead of trusting the caller's guess. */
	intent: OperationIntent;
	/** Supplies authoritative old-to-new identity evidence to all consumers. */
	mapping: IdentityMapping[];
	/** Gives history the edits, identity restoration and guards needed for atomic undo. */
	inverse: OperationInverse;
	/** Describes the operation with a message key and arguments for editor or CLI formatting. */
	summary: MessageRef;
	/** Reports contained invalid source while preserving pending identities. */
	diagnostics: OperationDiagnostic[];
	/** Tells the caller where logical focus belongs after applying the operation. */
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
	/** Discriminates a refusal, which contains no committed edits or identity mapping. */
	ok: false;
	/** Associates the zero-write outcome with the attempted transaction. */
	transactionId: string;
	/** Gives callers a stable reason for refusal without parsing rendered text. */
	code: OperationRefusalCode;
	/** Lets editor and CLI format the reason in their own interface language. */
	message: MessageRef;
	/** Names the selected node that prevented the whole transaction, when applicable. */
	member?: string;
	/** Names the failing project-relative file, when the refusal has a file scope. */
	file?: string;
}
