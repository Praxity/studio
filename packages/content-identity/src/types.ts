import type { IdentityMapping, OperationIntent } from "@praxity/grammar/src/operations/contract.ts";
import type { AnalyzedLessonTree, SourceSpan } from "@praxity/grammar/src/v4/tree/index.ts";

export type {
	IdentityFate,
	IdentityMapping,
	OperationIntent,
} from "@praxity/grammar/src/operations/contract.ts";
export interface CourseIdentity {
	schema: 1;
	courseId: string;
}
export interface LessonHead {
	schema: 1;
	path: string;
	head: string;
}
export type IdentityStatus = "active" | "retired" | "pending" | "cut";
export interface IdentityNode {
	kind: "lesson" | "page" | "block" | "part";
	type: string;
	parent: string | null;
	order: number;
	canonical: string;
	/** Absent for legacy descriptors. Writers still emit the legacy format by default. */
	canonicalVersion?: 2;
	matchText: string;
	label: string;
	span: SourceSpan;
	fingerprint: string;
	revision: string;
	status: IdentityStatus;
	lineage: string[];
	slug?: string | null;
	aliases?: string[];
	consumerRevisions?: { state?: { signature: string; epoch: number } };
}
export interface IdentitySnapshot {
	schema: 1;
	/** Required namespace guard, including snapshots read without their heads. */
	courseId: string;
	lessonId: string;
	parents: string[];
	sourceHash: string;
	nodes: Record<string, IdentityNode>;
}
export interface ParsedDocument {
	path: string;
	tree: AnalyzedLessonTree;
}
export interface CanonicalDescriptor {
	file: string;
	/** Tree child indexes; virtual blanks and reader parts append after real children. */
	path: number[];
	parentPath: number[] | null;
	kind: IdentityNode["kind"];
	type: string;
	order: number;
	canonical: string;
	matchText: string;
	label: string;
	span: SourceSpan;
	valid: boolean;
	/** Full subtree semantics, independent of its matching descriptor. */
	revisionContent: string;
	/** Reader projections with no separate source-tree node. */
	readerRole?: string;
	readerOwnerPath?: number[];
}
export interface IdentityOperation {
	intent: OperationIntent;
	files: { path: string; fromRevision: string; toRevision: string; fromSnapshot: string }[];
	mapping: IdentityMapping[];
	/** Binds result identities to the resulting parse, guarded by file revisions. */
	placements: { mappingIndex: number; file: string; path: readonly number[] }[];
	/** History restores recorded IDs, including retired IDs, without reallocating. */
	inverse?: boolean;
}
export interface IdentityDependencies {
	allocateId: () => string;
	/** Optional read-view allocator; returns rt- followed by 32 lowercase hex characters. */
	allocateRuntimeId?: () => string;
	/** Synchronous SHA-256 of UTF-8 text. Hosts supply the implementation. */
	digest: (text: string) => string;
}
export interface ResolveIdentityInput {
	parsedDocuments: readonly ParsedDocument[];
	priorSnapshots: readonly IdentitySnapshot[];
	/** IDs active in validated history, plus IDs protected by author artifacts. Omit to keep all IDs durable. */
	activeHistoryIds?: ReadonlySet<string>;
	/** Omit only for a new namespace or recovery from validated snapshots. */
	course?: CourseIdentity;
	/** Snapshot lessonId is the lesson-head filename stem. */
	priorHeads?: readonly LessonHead[];
	operations?: readonly IdentityOperation[];
	/** Validated history for I3. I1 never chooses between branch heads. */
	mergeBase?: readonly IdentitySnapshot[];
	/** Include the grammar reader's virtual parts. Inferred from prior role records. */
	readerRoles?: boolean;
}
export interface SourceMapping {
	file: string;
	path: number[];
	id: string;
	fingerprint: string;
	span: SourceSpan;
	status: "active" | "pending";
}
export interface UnresolvedIdentity {
	file: string;
	path: number[] | null;
	id: string;
	candidates: string[];
	reason: "duplicate" | "invalid";
}
export interface IdentityResolution {
	course: CourseIdentity;
	heads: LessonHead[];
	snapshots: IdentitySnapshot[];
	mapping: IdentityMapping[];
	inverseMapping: IdentityMapping[];
	sourceMappings: SourceMapping[];
	unresolved: UnresolvedIdentity[];
	exportIds: string[];
	exportable: boolean;
}

/** Display identity only. No heads, snapshots or operation mappings can be persisted. */
export interface IdentityReadView {
	kind: "runtime-read";
	course: CourseIdentity;
	sourceMappings: SourceMapping[];
	nodes: Record<string, IdentityNode>;
	lessons: { file: string; lessonId: string; sourceHash: string }[];
	runtimeIds: string[];
	unresolved: UnresolvedIdentity[];
	/** Author host state only, never durable lineage or operation authority. */
	correspondence: { runtimeId: string; durableId: string }[];
}

/** Complete course heads at one git revision, not the immutable snapshot history. */
export interface IdentityMergeState {
	course: CourseIdentity;
	heads: readonly LessonHead[];
	snapshots: readonly IdentitySnapshot[];
}
export interface IdentityMergeConflict {
	reason:
		| "divergent-change"
		| "two-ids-for-entity"
		| "id-claimed-by-entities"
		| "retired-id"
		| "documents-mismatch";
	ids: string[];
	/** Field requiring a decision, or a merged-source address when available. */
	field?: string;
	file?: string;
	path?: number[] | null;
}
export interface IdentityMergeResult {
	/** No writable result exists until every conflict is resolved. */
	resolution: IdentityResolution | null;
	conflicts: IdentityMergeConflict[];
}
