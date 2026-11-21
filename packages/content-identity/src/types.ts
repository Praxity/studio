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
	revisionContent: string;
	readerRole?: string;
	readerOwnerPath?: number[];
}
export interface IdentityOperation {
	intent: OperationIntent;
	files: { path: string; fromRevision: string; toRevision: string; fromSnapshot: string }[];
	mapping: IdentityMapping[];
	placements: { mappingIndex: number; file: string; path: readonly number[] }[];
	inverse?: boolean;
}
export interface IdentityDependencies {
	allocateId: () => string;
	allocateRuntimeId?: () => string;
	digest: (text: string) => string;
}
export interface ResolveIdentityInput {
	parsedDocuments: readonly ParsedDocument[];
	priorSnapshots: readonly IdentitySnapshot[];
	activeHistoryIds?: ReadonlySet<string>;
	course?: CourseIdentity;
	priorHeads?: readonly LessonHead[];
	operations?: readonly IdentityOperation[];
	mergeBase?: readonly IdentitySnapshot[];
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

export interface IdentityReadView {
	kind: "runtime-read";
	course: CourseIdentity;
	sourceMappings: SourceMapping[];
	nodes: Record<string, IdentityNode>;
	lessons: { file: string; lessonId: string; sourceHash: string }[];
	runtimeIds: string[];
	unresolved: UnresolvedIdentity[];
	correspondence: { runtimeId: string; durableId: string }[];
}

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
	field?: string;
	file?: string;
	path?: number[] | null;
}
export interface IdentityMergeResult {
	resolution: IdentityResolution | null;
	conflicts: IdentityMergeConflict[];
}
