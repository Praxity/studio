import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { BigIntStats, Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	assertDurableCandidate,
	assertIdentitySnapshotNamespace,
	assertLegacyIdentitySnapshot,
	type CanonicalDescriptor,
	type CourseIdentity,
	canRestoreIdentityMetadata,
	committedIdentityView,
	createIdentityReadSession,
	createIdentityResolver,
	describeDocument,
	type IdentityDependencies,
	type IdentityMapping,
	type IdentityMergeResult,
	type IdentityMergeState,
	type IdentityNode,
	type IdentityOperation,
	type IdentityReadView,
	type IdentityResolution,
	type IdentitySnapshot,
	identityKey,
	isDurableIdentity,
	type LessonHead,
	mergeIdentity,
	parseCourseIdentity,
	parseIdentitySnapshot,
	parseIdentitySnapshotRecord,
	parseLessonHead,
	type ResolveIdentityInput,
	resolveIdentity,
	restoreIdentityMetadata,
	serializeIdentity,
} from "@praxity/content-identity";
import { parseFrontmatter } from "@praxity/grammar";
import type {
	InsertionPoint,
	NodeRef,
	OperationRefusal,
	OperationRequest,
	OperationResult,
	OperationTargetRef,
} from "@praxity/grammar/src/operations/contract.ts";
import {
	type ReadLessonResult,
	readLesson,
	withLessonIds,
} from "@praxity/grammar/src/read-lesson.ts";
import { lineColumn } from "@praxity/grammar/src/v4/lex/index.ts";
import {
	AUTHOR_ONLY_READER_ROLES,
	type LessonIdAllocator,
	type LessonNodeRecord,
} from "@praxity/grammar/src/v4/to-blocks.ts";
import type { TreeNode } from "@praxity/grammar/src/v4/tree/index.ts";
import {
	type AppliedOperation,
	applyOperation,
	consumeOperationIdentity,
} from "@praxity/operations";
import { pageSlug } from "@praxity/shared-blocks/viewer/page-slug";
import { parseNarrationSidecarV2 } from "../shared/narration-sidecar";
import {
	ProjectPlainStoreError,
	type ProjectWriteResult,
	projectIdentityRecoveryMessage,
} from "../shared/project-write-errors";
import { parseReviewRun, parseReviewState } from "../shared/review/model";
import {
	openFileWithin,
	readFileWithin,
	resolveExistingPathWithin,
	resolveWritablePathWithin,
} from "./path-security";
import {
	acknowledgeProjectWrite,
	applyProjectFilePlan,
	assertProjectWritesAllowed,
	bindProjectWriteLifetime,
	type ProjectFileChange,
	ProjectFileConflictError,
	type ProjectFilePlanOptions,
	readProjectRecoveryEvidence,
	reclaimProtectedArchives,
	withProjectFileTransaction,
} from "./project-file-transactions";
import { IDENTITY_LINEAGE_PATHS, isIdentityLineagePath } from "./project-protected-paths";
import { readReviewIdentityEvidence } from "./studio/review-store";

const IDENTITY = ".praxity/identity";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const dependencies = { allocateId: randomUUID, digest };
const EMPTY_ID_HISTORY: ReadonlySet<string> = new Set();
const nodeKey = (node: Readonly<TreeNode>) =>
	serializeIdentity([node.kind, node.type, node.name, node.span.start, node.span.end, node.raw]);
const readerKey = (node: Readonly<TreeNode>, role?: string) => `${nodeKey(node)}:${role ?? ""}`;
function idProvider(
	path: string,
	known: ReadonlyMap<string, string>,
	transient: boolean,
): LessonIdAllocator {
	return Object.assign(
		(node: Readonly<TreeNode>, role?: string) => {
			const id = known.get(readerKey(node, role));
			if (!id) throw new Error(`Identity: reader source differs from resolved ${path}`);
			return id;
		},
		{ transient },
	);
}

/** Project a resolved identity through the reader, including its virtual source roles. */
export function projectLessonIdentity(
	path: string,
	read: ReadLessonResult,
	identity: Pick<IdentityResolution, "sourceMappings">,
	descriptors?: readonly CanonicalDescriptor[],
) {
	const nodes = new Map<string, TreeNode>();
	const visit = (node: TreeNode, location: number[]) => {
		nodes.set(serializeIdentity(location), node);
		node.children.forEach((child, index) => visit(child, [...location, index]));
	};
	visit(read.tree.root, []);
	const mappings = new Map(
		identity.sourceMappings
			.filter((mapping) => mapping.file === path)
			.map((mapping) => [serializeIdentity(mapping.path), mapping.id]),
	);
	const known = new Map<string, string>();
	for (const descriptor of descriptors ??
		describeDocument({ path, tree: read.tree }, { readerRoles: true })) {
		const node = nodes.get(serializeIdentity(descriptor.readerOwnerPath ?? descriptor.path));
		if (!node) continue;
		const id = required(
			mappings.get(serializeIdentity(descriptor.path)),
			"reader identity mapping",
		);
		known.set(readerKey(node, descriptor.readerRole), id);
	}
	const ids = idProvider(path, known, true);
	return { read: withLessonIds(read, ids), ids };
}

export interface IdentityStore {
	course: CourseIdentity | null;
	heads: LessonHead[];
	snapshots: IdentitySnapshot[];
}

interface LoadedIdentityStore {
	store: IdentityStore;
	activeHistoryIds: Set<string>;
	files: Map<string, string>;
	/** File identity evidence from the same opened handles as the admitted bytes. */
	fileHandles: Map<string, string>;
	reservations: Map<string, string>;
	/** Private canonical facts for validated current heads. */
	snapshotRecords: Map<string, { canonical: string; hash: string; nodesCanonical: string }>;
}
type LoadStoreOptions = Pick<
	ResolveCourseIdentityOptions,
	"expectedCourseId" | "established" | "approvedConversion"
> & { expectedFiles?: ReadonlyMap<string, string> };
interface IdentityStoreReuseOwner {
	active: boolean;
	stores: Map<ResolvedCourseIdentity, LoadedIdentityStore>;
}
interface AdmittedIdentityStore {
	owner: IdentityStoreReuseOwner;
	loaded: LoadedIdentityStore;
}
const admissionStores = new AsyncLocalStorage<IdentityStoreReuseOwner>();

/** Retain private validation only until this save completes, independently of the global budget. */
export async function withIdentityStoreReuse<T>(work: () => Promise<T>): Promise<T> {
	const owner: IdentityStoreReuseOwner = { active: true, stores: new Map() };
	return admissionStores.run(owner, async () => {
		try {
			return await work();
		} finally {
			owner.active = false;
			owner.stores.clear();
		}
	});
}
type ParsedSnapshotRecord = ReturnType<typeof parseIdentitySnapshotRecord>;
interface SnapshotProof {
	byteHash: string;
	fileHandle: string;
	courseId: string;
	hash: string;
	lessonId: string;
	parents: readonly string[];
	activeIds: readonly string[];
	reservations: readonly (readonly [string, string])[];
	/** Only current heads need the full graph and canonical bytes. */
	record?: ParsedSnapshotRecord;
	nodesCanonical?: string;
	factBytes: number;
	recordBytes: number;
}
interface ValidatedStoreRecord {
	context: string;
	inventory: string;
	proofs: Map<string, SnapshotProof>;
	bytes: number;
}

interface StoreCacheState {
	maxBytes: number;
	bytes: number;
	hits: number;
	records: Map<string, ValidatedStoreRecord>;
}
const storeCaches = new WeakMap<IdentityStoreCache, StoreCacheState>();
const STORE_CACHE_BYTES = 16 * 1024 * 1024;
const STORE_CACHE_ENTRIES = 8;
const STORE_READ_BATCH_SIZE = 8;

/** Owns validated records privately; zero bytes selects independent fresh validation. */
export class IdentityStoreCache {
	constructor(options: { maxBytes?: number } = {}) {
		const maxBytes = options.maxBytes ?? STORE_CACHE_BYTES;
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
			throw new Error("Identity: invalid store cache byte limit");
		storeCaches.set(this, { maxBytes, bytes: 0, hits: 0, records: new Map() });
	}
	invalidate(): void {
		const state = required(storeCaches.get(this), "store cache");
		// An admission already reading disk may return its result, but cannot retain it after disposal.
		state.records.clear();
		state.bytes = 0;
		storeCaches.set(this, { ...state, bytes: 0, records: new Map() });
	}
	/** Retained payload accounting, rather than process heap size. */
	usage(): { bytes: number; entries: number; hits: number } {
		const state = required(storeCaches.get(this), "store cache");
		return { bytes: state.bytes, entries: state.records.size, hits: state.hits };
	}
}
const defaultStoreCache = new IdentityStoreCache();

function discardStoreRecord(state: StoreCacheState, root: string): void {
	const previous = state.records.get(root);
	if (previous) state.bytes -= previous.bytes;
	state.records.delete(root);
}

const stringBytes = (text: string) => Math.max(text.length * 2, Buffer.byteLength(text));
const proofBytes = (proof: SnapshotProof) => proof.factBytes + proof.recordBytes;

function retainSnapshotProofs(
	state: StoreCacheState,
	root: string,
	context: string,
	inventory: string,
	proofs: Map<string, SnapshotProof>,
): void {
	discardStoreRecord(state, root);
	if (state.maxBytes === 0) return;
	const record: ValidatedStoreRecord = { context, inventory, proofs: new Map(), bytes: 0 };
	const overhead = stringBytes(root) + stringBytes(context) + stringBytes(inventory);
	if (overhead > state.maxBytes) return;
	while (state.records.size >= STORE_CACHE_ENTRIES) {
		discardStoreRecord(
			state,
			required(state.records.keys().next().value, "oldest store cache entry"),
		);
	}
	state.records.set(root, record);
	state.bytes += overhead;
	record.bytes = overhead;
	for (const [path, proof] of proofs) {
		const bytes = stringBytes(path) + proofBytes(proof);
		if (bytes + overhead > state.maxBytes) continue;
		while (state.bytes + bytes > state.maxBytes) {
			const [oldRoot, oldest] = required(
				state.records.entries().next().value,
				"oldest store cache entry",
			);
			const entry = oldest.proofs.entries().next().value;
			if (!entry) {
				discardStoreRecord(state, oldRoot);
				continue;
			}
			const [oldPath, oldProof] = entry;
			const removed = stringBytes(oldPath) + proofBytes(oldProof);
			oldest.proofs.delete(oldPath);
			oldest.bytes -= removed;
			state.bytes -= removed;
		}
		record.proofs.set(path, proof);
		record.bytes += bytes;
		state.bytes += bytes;
	}
	if (record.proofs.size === 0) discardStoreRecord(state, root);
}

function validatedStore(
	cache: IdentityStoreCache,
	root: string,
	files: Map<string, string>,
	fileHandles: Map<string, string>,
	options: Pick<LoadStoreOptions, "expectedCourseId">,
	state: StoreCacheState,
	installed?: LoadedIdentityStore,
	admitted?: AdmittedIdentityStore,
): LoadedIdentityStore {
	// Lookup, validation and the retained key must use the same captured configuration.
	const expectedCourseId = options.expectedCourseId;
	const captured = { expectedCourseId };
	if (
		admitted?.owner.active &&
		admissionStores.getStore() === admitted.owner &&
		sameFiles(admitted.loaded.files, files) &&
		sameFiles(admitted.loaded.fileHandles, fileHandles) &&
		(expectedCourseId === undefined || expectedCourseId === admitted.loaded.store.course?.courseId)
	)
		return {
			...admitted.loaded,
			files,
			fileHandles,
			reservations: new Map(admitted.loaded.reservations),
		};
	// Seeding exact private installed bytes produces no new snapshot proofs. Keep the
	// existing proofs for the next guarded load, which validates the appended snapshot.
	if (
		installed &&
		sameFiles(installed.files, files) &&
		(expectedCourseId === undefined || expectedCourseId === installed.store.course?.courseId)
	)
		return { ...installed, files, fileHandles };
	const validate = (previous?: Map<string, SnapshotProof>, proofs?: Map<string, SnapshotProof>) =>
		parseStoreFiles(files, captured, fileHandles, previous, proofs);
	if (storeCaches.get(cache) !== state) return validate();
	const context = serializeIdentity([
		expectedCourseId ?? null,
		digest(required(files.get(`${IDENTITY}/course.json`), "course identity")),
		fileHandles.get(`${IDENTITY}/course.json`),
		fileHandles.get(`${IDENTITY}/course.json:entry`),
	]);
	const inventory = digest(
		serializeIdentity(
			[...files].map(([path, text]) => [path, digest(text), fileHandles.get(path)]),
		),
	);
	const previous = state.records.get(root);
	const proofs = new Map<string, SnapshotProof>();
	const loaded = validate(previous?.context === context ? previous.proofs : undefined, proofs);
	if (
		previous?.context === context &&
		previous.inventory === inventory &&
		proofs.size === previous.proofs.size &&
		[...proofs].every(([path, proof]) => previous.proofs.get(path) === proof)
	)
		state.hits++;
	retainSnapshotProofs(state, root, context, inventory, proofs);
	return loaded;
}
export interface ResolveCourseIdentityOptions {
	/** Session-owned validated evidence. Exact store bytes and inventory are checked every time. */
	identitySession?: CourseIdentitySession;
	/** Require saved identity and source revisions, with no filesystem writes. */
	strict?: boolean;
	/** Explicit source deletions in the same admitted file plan, including rename donors. */
	removedPaths?: readonly string[];
	/** The complete course inventory, including lessons unaffected by this edit. */
	lessonPaths: readonly string[];
	/** Draft/result bytes. Omitted lessons use their exact saved bytes. */
	sources?: Readonly<Record<string, string>>;
	/** Build-local reads keyed by exact source bytes; never retained across admissions. */
	lessonReads?: Map<string, ReadLessonResult>;
	operations?: readonly IdentityOperation[];
	/** Store-issued current resolution, including outside edits, for one atomic operation. */
	operationBase?: ResolvedCourseIdentity;
	/** Single-use registry evidence, bound to the store-issued operation base. */
	operationPlan?: AppliedOperation;
	/** A guarded inverse restores consumer metadata through the identity owner. */
	restore?: {
		identity: IdentityResolution;
		written: IdentityResolution;
		mapping: readonly IdentityMapping[];
	};
	expectedCourseId?: string;
	/** Hosts with release evidence outside the course directory must set this. */
	established?: boolean;
	/** Explicit URL changes; old slugs remain reserved aliases. */
	slugRenames?: Readonly<Record<string, string>>;
	/** Explicit grammar-3 conversion starts a lineage using these approved store files. */
	approvedConversion?: {
		directory: string;
		fileHashes: Readonly<Record<string, string>>;
	};
}
export interface ResolvedCourseIdentity {
	identity: IdentityResolution;
	/** Validated historical and author-artifact facts for the identity owner's durability predicate. */
	activeHistoryIds?: ReadonlySet<string>;
	/** Display-only graph. It has no store issuance and cannot authorize a write. */
	readView?: IdentityReadView;
	lessons: Map<string, ReadLessonResult>;
	ids: Map<string, LessonIdAllocator>;
	transientIds: boolean;
	writeResult?: ProjectWriteResult;
	/** Successful write evidence for author host state; never part of durable identity. */
	correspondence?: IdentityReadView["correspondence"];
}
export interface IdentityMessageRef {
	key: `desktop.identity.${"exportRefused" | "pendingNode" | "invalidNode" | "persistenceRequired" | "missingEstablished" | "invalidFile" | "incompleteInventory" | "plainStoreRequired"}`;
	args: Readonly<Record<string, string | number>>;
}
export interface IdentityBlockLocation {
	file: string;
	page: string;
	line: number;
	label: string;
	id: string;
}
export interface IdentityRetiredLocation extends Omit<IdentityBlockLocation, "line"> {
	kind: IdentityNode["kind"];
	line: number | null;
	span: { start: number; end: number };
}
interface IdentityInitializationChanges {
	added: IdentityBlockLocation[];
	retired: IdentityRetiredLocation[];
}
export class IdentityStoreError extends Error {
	readonly code = "EIDENTITY";
	constructor(
		readonly messageRef: IdentityMessageRef,
		fallback: string,
		cause?: unknown,
		readonly initialization?: IdentityInitializationChanges & {
			rederive: boolean;
			pending?: { file: string; line: number; copyCountDropped: boolean; sameTitlePages?: boolean };
		},
	) {
		super(fallback, { cause });
	}
}
interface Baseline {
	writeActive?: () => boolean;
	readInput: ResolveIdentityInput;
	/** Durable prior facts survive intermediate operation resolutions of outside edits. */
	retirementInput?: ResolveIdentityInput;
	readView?: IdentityReadView;
	writeBase?: IdentityResolution;
	/** Target IDs captured by the registry's private operation issuance. */
	recordedTargets?: readonly string[];
	readRecords: LoadedIdentityStore["snapshotRecords"];
	retirementRecords: LoadedIdentityStore["snapshotRecords"];
	preservedLessons: ReadonlySet<string>;
	writtenLessons?: readonly string[];
	root: string;
	files: Map<string, string>;
	sources: Map<string, string | null>;
	artifacts: Map<string, string | null>;
	options: ResolveCourseIdentityOptions;
	serialized: string;
	/** The resolver's private value; public resolutions receive an independent copy. */
	validatedIdentity: IdentityResolution;
	/** Private bytes and hashes bind to serialized; never exposed with mutable snapshots. */
	snapshotRecords: LoadedIdentityStore["snapshotRecords"];
	readerMappings: Map<string, Map<string, string>>;
	/** Captured before exposing mutable reads, so publication can detect altered projections. */
	readerProjections: Map<string, string>;
	/** Reconciled outside revisions become immutable parents in the same journal. */
	operationSnapshots?: { canonical: string; hash: string }[];
	persisted?: true;
	session?: { owner: CourseIdentitySession; state: IdentitySessionState };
}
const baselines = new WeakMap<ResolvedCourseIdentity, Baseline>();
const expiredCandidates = new WeakSet<ResolvedCourseIdentity>();
const readProofs = new WeakMap<
	ResolvedCourseIdentity,
	{
		input: ResolveIdentityInput;
		view: IdentityReadView;
		correspondence: ReadonlyMap<string, string>;
	}
>();

/** Resolve captured author locators only through successfully installed I4 correspondence. */
export function resolveReadIdentityId(result: ResolvedCourseIdentity, id: string): string {
	return readProofs.get(result)?.correspondence.get(id) ?? id;
}

/** Read admissions expose display bindings only. Candidate evidence stays with I4. */
export async function readCourseIdentity(
	courseDir: string,
	options: ResolveCourseIdentityOptions,
): Promise<ResolvedCourseIdentity> {
	return withProjectFileTransaction(
		courseDir,
		async (root) => {
			const owner = options.identitySession;
			const state = owner ? identitySessions.get(owner) : undefined;
			const scope = Object.keys(options.sources ?? {}).length ? "draftReadSession" : "readSession";
			const session = state
				? (state[scope] ??= createIdentityReadSession(
						state.dependencies,
						() => state.correspondence?.ids.keys() ?? [],
					))
				: createIdentityReadSession(dependencies);
			let readBaseline: Baseline | undefined;
			const issued = await resolveAdmittedCourseIdentity(
				root,
				{ ...options, strict: false },
				session,
				(baseline) => {
					readBaseline = baseline;
				},
			);
			if (owner && identitySessions.get(owner) !== state)
				throw new Error("Identity: read admission revoked");
			const baseline = required(readBaseline, "read admission");
			const input = baseline.readInput;
			const view = required(baseline.readView, "read view");
			// Slugs belong to I4's course-wide reservation owner, never to the display matcher.
			for (const mapping of view.sourceMappings) {
				const original = issued.identity.sourceMappings.find(
					(m) =>
						m.file === mapping.file &&
						serializeIdentity(m.path) === serializeIdentity(mapping.path),
				);
				const node = issued.identity.snapshots.find((s) => original && s.nodes[original.id])?.nodes[
					original?.id ?? ""
				];
				if (node?.kind === "page") {
					view.nodes[mapping.id].slug = node.slug;
					view.nodes[mapping.id].aliases = structuredClone(node.aliases);
				}
			}
			// Correspondence is released only by a successful explicit write, not a read.
			view.correspondence = [];
			const snapshots = view.lessons.map(
				(lesson): IdentitySnapshot => ({
					schema: 1,
					courseId: view.course.courseId,
					lessonId: lesson.lessonId,
					parents: [],
					sourceHash: lesson.sourceHash,
					nodes: Object.fromEntries(
						view.sourceMappings
							.filter((m) => m.file === lesson.file)
							.map((m) => [m.id, view.nodes[m.id]]),
					),
				}),
			);
			const identity: IdentityResolution = {
				course: view.course,
				heads: view.lessons.map((lesson, index) => ({
					schema: 1,
					path: lesson.file,
					head: digest(serializeIdentity(snapshots[index])),
				})),
				snapshots,
				mapping: [],
				inverseMapping: [],
				sourceMappings: view.sourceMappings,
				unresolved: view.unresolved,
				exportIds: [],
				exportable: false,
			};
			const lessons = new Map<string, ReadLessonResult>();
			const ids = new Map<string, LessonIdAllocator>();
			for (const [file, read] of issued.lessons) {
				const projection = projectLessonIdentity(file, read, identity);
				lessons.set(file, projection.read);
				ids.set(file, projection.ids);
			}
			const result = {
				identity,
				activeHistoryIds: new Set(input.activeHistoryIds),
				readView: view,
				lessons,
				ids,
				transientIds: true,
			};
			readProofs.set(result, {
				...structuredClone({ input, view }),
				correspondence: new Map(
					state?.correspondence?.courseId === view.course.courseId ? state.correspondence.ids : [],
				),
			});
			return result;
		},
		"read",
		false,
	).catch((error: unknown) => {
		options.identitySession?.invalidate();
		throw error;
	});
}

/** Probe/preview planning cannot export its private candidate or authorize persistence. */
export function planReadIdentity(
	result: ResolvedCourseIdentity,
	request: OperationRequest,
	project = false,
) {
	const { identity, input, planned } = planReadCandidate(result, request);
	if (!planned.ok) return { ok: false as const };
	if (!project) return { ok: true as const, lessons: new Map<string, ReadLessonResult>() };
	return {
		ok: true as const,
		lessons: projectReadCandidate(result, identity, input, planned).lessons,
	};
}

/** Dry-run evidence describes display identity; executable plans remain private to I4. */
export function resolveReadOperation(
	result: ResolvedCourseIdentity,
	request: OperationRequest,
): OperationResult | OperationRefusal {
	const { identity, input, planned } = planReadCandidate(result, request);
	const storedIds = new Set(
		input.priorSnapshots.flatMap((snapshot) => Object.keys(snapshot.nodes)),
	);
	if (input.course) storedIds.add(input.course.courseId);
	const before = readDisplayBindings(result, identity);
	if (!planned.ok) {
		const { member, ...refused } = structuredClone(planned);
		const shown = member
			? (before.get(member) ?? (storedIds.has(member) ? member : undefined))
			: undefined;
		return { ...refused, ...(shown ? { member: shown } : {}) };
	}
	const { bindings } = projectReadCandidate(result, identity, input, planned);
	const display = (id: string): string => {
		const shown = bindings.get(id);
		if (shown) return shown;
		if (storedIds.has(id)) return id;
		throw new Error("Identity: read operation has no display binding");
	};
	const nullableDisplay = (id: string | null) => (id === null ? null : display(id));
	const mapping = (entry: IdentityMapping): IdentityMapping => ({
		...entry,
		oldId: nullableDisplay(entry.oldId),
		newId: nullableDisplay(entry.newId),
	});
	function ref(reference: NodeRef): NodeRef;
	function ref(reference: InsertionPoint): InsertionPoint;
	function ref(reference: OperationTargetRef): OperationTargetRef;
	function ref(reference: OperationTargetRef): OperationTargetRef {
		switch (reference.kind) {
			case "node":
				return { ...reference, nodeId: nullableDisplay(reference.nodeId) };
			case "insertion":
				return {
					...reference,
					parentId: nullableDisplay(reference.parentId),
					before: nullableDisplay(reference.before),
					after: nullableDisplay(reference.after),
				};
			case "course":
				return { ...reference, courseId: display(reference.courseId) };
			case "manifest":
				return reference;
		}
	}
	return structuredClone({
		ok: true,
		transactionId: planned.transactionId,
		files: planned.files,
		intent: planned.intent,
		mapping: planned.mapping.map(mapping),
		inverse: {
			files: planned.inverse.files,
			mapping: planned.inverse.mapping.map(mapping),
			guards: planned.inverse.guards.map((guard) => {
				if (guard.kind === "written") return { ...guard, ref: ref(guard.ref) };
				return {
					...guard,
					ref: ref(guard.ref),
					...(guard.kind === "deleted" ? { nodeId: display(guard.nodeId) } : {}),
				};
			}),
		},
		summary: planned.summary,
		diagnostics: planned.diagnostics.map((diagnostic) => ({
			...diagnostic,
			ref: diagnostic.ref === null ? null : ref(diagnostic.ref),
		})),
		focus: { ...planned.focus, nodeId: nullableDisplay(planned.focus.nodeId) },
	});
}

function planReadCandidate(result: ResolvedCourseIdentity, request: OperationRequest) {
	const proof = readProofs.get(result);
	if (!proof) assertCandidateLifetime(result);
	const issued = baselines.get(result);
	if (!proof && (!issued || !matchesIssuedIdentity(issued, result.identity)))
		throw new Error("Identity: unknown read planning admission");
	const identity = proof
		? resolveIdentity(proof.input, dependencies)
		: required(issued, "planning admission").validatedIdentity;
	const input = proof?.input ?? required(issued, "planning admission").readInput;
	const planned = applyOperation(
		[...result.lessons].map(([path, lesson]) => ({ path, source: lesson.tree.stream.source })),
		{
			...request,
			targets: request.targets.map((target) => {
				if (target.ref.kind !== "node") return target;
				const shown = (proof?.view ?? result.identity).sourceMappings.find(
					(m) =>
						m.file === target.file &&
						(target.ref.kind === "node" && target.ref.nodeId
							? m.id === target.ref.nodeId
							: serializeIdentity(m.path) ===
								serializeIdentity(target.ref.kind === "node" ? target.ref.path : [])),
				);
				const candidate = identity.sourceMappings.find(
					(m) =>
						m.file === shown?.file && serializeIdentity(m.path) === serializeIdentity(shown.path),
				);
				return { ...target, ref: { ...target.ref, nodeId: candidate?.id ?? target.ref.nodeId } };
			}),
		},
		{
			identity,
			activeHistoryIds: input.activeHistoryIds,
			allocateId: randomUUID,
			digest,
			readerRoles: true,
		},
	);
	return { identity, input, planned };
}

function projectReadCandidate(
	result: ResolvedCourseIdentity,
	identity: IdentityResolution,
	input: ResolveIdentityInput,
	planned: AppliedOperation,
) {
	const session = createIdentityReadSession(dependencies);
	const displayIds = readDisplayBindings(result, identity);
	const draftBase = {
		...input,
		course: identity.course,
		priorHeads: identity.heads,
		priorSnapshots: identity.snapshots,
		operations: undefined,
	};
	session.resolve(draftBase);
	const draft = session.resolve({
		...draftBase,
		parsedDocuments: planned.history.after.map((file) => ({
			path: file.path,
			tree: readLesson(file.source).tree,
		})),
		operations: planned.evidence,
	}).view;
	const mappings = draft.sourceMappings.map((m) => ({ ...m, id: displayIds.get(m.id) ?? m.id }));
	for (const mapping of mappings) {
		const candidate = planned.identity.sourceMappings.find(
			(m) =>
				m.file === mapping.file && serializeIdentity(m.path) === serializeIdentity(mapping.path),
		);
		if (!candidate) throw new Error("Identity: read operation candidate binding missing");
		displayIds.set(candidate.id, mapping.id);
	}
	return {
		bindings: displayIds,
		lessons: new Map(
			planned.history.after.map((file) => [
				file.path,
				projectLessonIdentity(file.path, readLesson(file.source), { sourceMappings: mappings })
					.read,
			]),
		),
	};
}

function readDisplayBindings(result: ResolvedCourseIdentity, identity: IdentityResolution) {
	const view = readProofs.get(result)?.view ?? result.identity;
	const shown = new Map(
		view.sourceMappings.map((m) => [serializeIdentity([m.file, m.path]), m.id]),
	);
	const bindings = new Map(
		identity.sourceMappings.map((m) => [
			m.id,
			required(shown.get(serializeIdentity([m.file, m.path])), "read display binding"),
		]),
	);
	bindings.set(identity.course.courseId, view.course.courseId);
	return bindings;
}

function matchesIssuedIdentity(baseline: Baseline, identity: IdentityResolution): boolean {
	// Canonical fallback retains acceptance of harmless undefined fields and key order.
	return (
		isDeepStrictEqual(baseline.validatedIdentity, identity) ||
		baseline.serialized === serializeIdentity(identity)
	);
}

interface RetainedCourseIdentity {
	loaded: Awaited<ReturnType<typeof loadStore>>;
	lessonPaths: string;
	reads: Map<string, ReadLessonResult>;
	resolver?: ReturnType<typeof createIdentityResolver>;
	committed?: IdentityResolution;
}
interface IdentitySessionState {
	dependencies: IdentityDependencies;
	// Held browser fields outlive RPC replies and transient artifact rebuild gaps.
	correspondence?: { courseId: string; ids: Map<string, string> };
	root?: string;
	retained?: RetainedCourseIdentity;
	readSession?: ReturnType<typeof createIdentityReadSession>;
	draftReadSession?: ReturnType<typeof createIdentityReadSession>;
}
const identitySessions = new WeakMap<CourseIdentitySession, IdentitySessionState>();

/** One host session owns retained admission evidence, never caller-owned results. */
export class CourseIdentitySession {
	constructor(
		readonly projectDir: string,
		runtime: Pick<IdentityDependencies, "allocateRuntimeId"> = {},
	) {
		identitySessions.set(this, { dependencies: { ...dependencies, ...runtime } });
	}
	invalidate(): void {
		identitySessions.get(this)?.readSession?.invalidate();
		identitySessions.get(this)?.draftReadSession?.invalidate();
		// Replacing the state also prevents an in-flight admission from repopulating it.
		const state = required(identitySessions.get(this), "admission session");
		identitySessions.set(this, { root: state.root, dependencies: state.dependencies });
		defaultStoreCache.invalidate();
	}
	/** Reader-owned copies let grammar-version guards reuse the same parse. */
	lessonReads(): Map<string, ReadLessonResult> {
		return new Map(
			[...(identitySessions.get(this)?.retained?.reads.values() ?? [])].map((read) => [
				read.tree.stream.source,
				structuredClone(read),
			]),
		);
	}
}

// Fatal UTF-8 decoding retains the BOM, so text equality proves exact admitted byte equality.
const sameFiles = (left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>) =>
	left.size === right.size && [...left].every(([path, text]) => right.get(path) === text);

function required<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Identity: missing ${label}`);
	return value;
}

function ownedIdentityPath(path: string): boolean {
	return (process.platform === "win32" ? path.toLowerCase() : path).startsWith(`${IDENTITY}/`);
}

function parseFile<T>(path: string, parse: () => T): T {
	try {
		return parse();
	} catch (error) {
		throw new IdentityStoreError(
			{ key: "desktop.identity.invalidFile", args: { path, reason: (error as Error).message } },
			`Identity file ${path}: ${(error as Error).message}`,
			error,
		);
	}
}

/** T1 isolates abandoned publications before write admission; live installs may still link twice. */
export async function assertPlainIdentityStore(root: string): Promise<void> {
	const { dev } = await lstat(root, { bigint: true });
	async function visit(path: string): Promise<void> {
		let info: BigIntStats;
		try {
			info = await lstat(join(root, path), { bigint: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		if (
			(!info.isDirectory() && !info.isFile()) ||
			info.dev !== dev ||
			(info.isFile() && info.nlink > 1n)
		)
			throw new ProjectPlainStoreError(path);
		// .praxity itself must be plain, but window state and local drafts are not lineage.
		if (info.isDirectory() && path !== ".praxity")
			for (const name of (await readdir(join(root, path))).sort()) await visit(`${path}/${name}`);
	}
	for (const path of IDENTITY_LINEAGE_PATHS) await visit(path);
}

function reserveSlug(reservations: Map<string, string>, slug: string, owner: string) {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug))
		throw new Error(`Identity: invalid page slug ${slug}`);
	const previous = reservations.get(slug);
	if (previous !== undefined && previous !== owner)
		throw new Error(`Identity: page slug or alias ${slug} is already reserved`);
	reservations.set(slug, owner);
}

async function optionalText(
	root: string,
	path: string,
	fileHandles?: Map<string, string>,
): Promise<string | null> {
	try {
		let bytes: Buffer;
		if (fileHandles) {
			const file = await openFileWithin(root, join(root, path));
			try {
				const [content, info] = await Promise.all([file.readFile(), file.stat({ bigint: true })]);
				bytes = content;
				fileHandles.set(
					path,
					`${info.dev}:${info.ino}:${info.birthtimeNs}:${info.ctimeNs}:${info.nlink}`,
				);
			} finally {
				await file.close();
			}
		} else bytes = (await readFileWithin(root, join(root, path))) as Buffer;
		try {
			return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		} catch (error) {
			throw new Error(`Identity: invalid UTF-8 in ${path}`, { cause: error });
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
async function entries(
	root: string,
	path: string,
	fileHandles?: Map<string, string>,
): Promise<string[] | null> {
	try {
		const safe = await resolveExistingPathWithin(root, join(root, path));
		const directory = await lstat(join(root, path), { bigint: true });
		if (directory.isSymbolicLink()) throw new Error(`Identity: symbolic link at ${path}`);
		// Native spelling and directory identity change on rename or replacement; appends do not.
		fileHandles?.set(
			`${path}:entry`,
			`${safe}:${directory.dev}:${directory.ino}:${directory.birthtimeNs}`,
		);
		const contents = await readdir(safe, { withFileTypes: true });
		if (contents.some((entry) => !entry.isFile()))
			throw new Error(`Identity: unexpected entry in ${path}`);
		return contents.map((entry) => entry.name).sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
async function assertCompleteInventory(
	root: string,
	store: Pick<IdentityMergeState, "heads">,
	lessonPaths: readonly string[],
	removedPaths: readonly string[] = [],
): Promise<void> {
	let inventoryPaths: Set<string> | undefined;
	const existingPath = async (path: string) => {
		try {
			return await resolveExistingPathWithin(root, join(root, path));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			return null;
		}
	};
	for (const head of store.heads) {
		if (lessonPaths.includes(head.path) || removedPaths.includes(head.path)) continue;
		const livePath = await existingPath(head.path);
		if (livePath === null) continue;
		// A Windows case-only rename can still resolve through its old spelling.
		// Compare canonical file names, leaving rename/copy matching to the owner.
		inventoryPaths ??= new Set(
			(await Promise.all(lessonPaths.map(existingPath))).filter((path) => path !== null),
		);
		if (!inventoryPaths.has(livePath))
			throw new IdentityStoreError(
				{ key: "desktop.identity.incompleteInventory", args: { path: head.path } },
				`Identity: course inventory omits live lesson ${head.path}`,
			);
	}
}
async function loadStore(
	root: string,
	options: LoadStoreOptions = {},
	cache = defaultStoreCache,
	state = required(storeCaches.get(cache), "store cache"),
	installed?: LoadedIdentityStore,
	admitted?: AdmittedIdentityStore,
): Promise<LoadedIdentityStore> {
	try {
		return await loadStoreWithin(root, options, cache, state, installed, admitted);
	} catch (error) {
		discardStoreRecord(state, root);
		throw error;
	}
}

async function loadStoreWithin(
	root: string,
	options: LoadStoreOptions,
	cache: IdentityStoreCache,
	state: StoreCacheState,
	installed?: LoadedIdentityStore,
	admitted?: AdmittedIdentityStore,
): Promise<LoadedIdentityStore> {
	const files = new Map<string, string>();
	const fileHandles = new Map<string, string>();
	const reservations = new Map<string, string>([["index", ""]]);
	const courseText = await optionalText(root, `${IDENTITY}/course.json`, fileHandles);
	if (
		options.expectedFiles &&
		(options.expectedFiles.get(`${IDENTITY}/course.json`) ?? null) !== courseText
	)
		throw new ProjectFileConflictError("Identity: files changed on disk since resolution");
	if (courseText === null) {
		discardStoreRecord(state, root);
		if (options.approvedConversion) {
			// Rollback can retain empty destination directories and recovery copies.
			// Explicit conversion may fill an empty store, never discard identity bytes.
			const assertEmpty = async (path: string): Promise<void> => {
				let contents: Dirent[];
				try {
					const directory = await lstat(join(root, path));
					if (!directory.isDirectory() || directory.isSymbolicLink())
						throw new Error("Identity: invalid conversion directory");
					contents = await readdir(join(root, path), { withFileTypes: true });
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
					throw error;
				}
				for (const entry of contents) {
					if (!entry.isDirectory() || entry.isSymbolicLink())
						throw new Error("Identity: conversion cannot replace existing identity bytes");
					await assertEmpty(`${path}/${entry.name}`);
				}
			};
			await assertEmpty(IDENTITY);
		}
		const evidence = await Promise.all(
			[IDENTITY, ".praxity/content-identity.json", "narration.yaml", ".praxity/review"].map(
				async (path) => {
					try {
						await resolveExistingPathWithin(root, join(root, path));
						return true;
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
						throw error;
					}
				},
			),
		);
		// A rolled-back first write never committed a namespace, even if installation began.
		evidence.push(
			(await readProjectRecoveryEvidence(root)).some(
				(archive) =>
					archive.outcome === "unknown" ||
					archive.files.some(
						(file) =>
							isIdentityLineagePath(file.path) &&
							(file.hadOriginal || (archive.outcome === "committed" && file.installed)),
					),
			),
		);
		if (
			options.established ||
			options.expectedCourseId ||
			(!options.approvedConversion && evidence.some(Boolean))
		)
			throw new IdentityStoreError(
				{ key: "desktop.identity.missingEstablished", args: {} },
				projectIdentityRecoveryMessage("en"),
			);
		return {
			store: { course: null, heads: [], snapshots: [] } satisfies IdentityStore,
			activeHistoryIds: new Set(),
			files,
			fileHandles,
			reservations,
			snapshotRecords: new Map(),
		};
	}
	const capturedFiles = await readStoreFiles(root, courseText, fileHandles);
	const mutableFiles = (files: ReadonlyMap<string, string>) =>
		new Map([...files].filter(([path]) => !path.startsWith(`${IDENTITY}/snapshots/`)));
	if (
		options.expectedFiles &&
		!sameFiles(mutableFiles(capturedFiles), mutableFiles(options.expectedFiles))
	)
		throw new ProjectFileConflictError("Identity: files changed on disk since resolution");
	// Immutable snapshots prove their content hash before inventory changes are classified.
	const validated = validatedStore(
		cache,
		root,
		capturedFiles,
		fileHandles,
		options,
		state,
		installed,
		admitted,
	);
	if (options.expectedFiles && !sameFiles(capturedFiles, options.expectedFiles))
		throw new ProjectFileConflictError("Identity: files changed since resolution");
	return validated;
}

/** Capture exact bytes even when working heads contain git conflict markers. */
async function readStoreFiles(root: string, courseText: string, fileHandles?: Map<string, string>) {
	const files = new Map<string, string>([[`${IDENTITY}/course.json`, courseText]]);
	if (fileHandles) {
		// A case-insensitive lookup or an internal symlink can open the same inode under a new entry.
		const directory = await resolveExistingPathWithin(root, join(root, IDENTITY));
		const names = (await readdir(directory, { withFileTypes: true }))
			.filter((entry) => entry.name.toLowerCase() === "course.json")
			.map((entry) => [entry.name, entry.isSymbolicLink()])
			.sort();
		fileHandles.set(`${IDENTITY}/course.json:entry`, serializeIdentity(names));
	}
	const headNames = await entries(root, `${IDENTITY}/lessons`, fileHandles);
	const snapshotNames = await entries(root, `${IDENTITY}/snapshots`, fileHandles);
	if (!headNames || !snapshotNames)
		throw new Error("Identity: missing lesson heads or snapshots directory");
	const paths = (
		[
			["snapshots", snapshotNames],
			["lessons", headNames],
		] as const
	).flatMap(([directory, names]) =>
		names.map((name) => ({ directory, path: `${IDENTITY}/${directory}/${name}` })),
	);
	for (let offset = 0; offset < paths.length; offset += STORE_READ_BATCH_SIZE) {
		// Drain every admitted read before returning an error. Publish bytes and their
		// opened-handle evidence together, in inventory order rather than completion order.
		const captured = await Promise.allSettled(
			paths.slice(offset, offset + STORE_READ_BATCH_SIZE).map(async ({ directory, path }) => {
				const handles = fileHandles ? new Map<string, string>() : undefined;
				const text = await optionalText(root, path, handles);
				if (text === null)
					throw new Error(
						`Identity: missing ${directory === "snapshots" ? "snapshot" : "lesson head"} ${path}`,
					);
				return { path, text, handles };
			}),
		);
		for (const result of captured) {
			if (result.status === "rejected") throw result.reason;
			const { path, text, handles } = result.value;
			files.set(path, text);
			for (const [path, identity] of handles ?? []) fileHandles?.set(path, identity);
		}
	}
	return files;
}

/** Every protected file an archive holds must pass its owner in the validated live namespace. */
async function liveIdentityStoreIsIntact(
	root: string,
	capturedPaths: readonly string[],
	options: LoadStoreOptions,
	installed: LoadedIdentityStore,
): Promise<boolean> {
	try {
		const { store, files } = await loadStore(
			root,
			options,
			defaultStoreCache,
			undefined,
			installed,
		);
		if (store.course === null) return false;
		const paths = new Set([...files.keys()].map((path) => path.toLowerCase()));
		for (const path of capturedPaths) {
			if (!isIdentityLineagePath(path)) continue;
			if (path.toLowerCase().startsWith(`${IDENTITY}/`)) {
				if (!paths.has(path.toLowerCase())) return false;
			} else {
				const source = await optionalText(root, path);
				if (source === null) return false;
				const normalized = path.toLowerCase();
				if (normalized === "narration.yaml") {
					// Omit the optional identity so the read owner's empty-file view cannot prove stored identity.
					if (parseNarrationSidecarV2(source).courseId !== store.course.courseId) return false;
				} else if (normalized === ".praxity/review/state.json") {
					parseReviewState(source, store.course.courseId);
				} else if (normalized === ".praxity/review/next-run.json") {
					parseReviewRun(source);
					const state = await optionalText(root, ".praxity/review/state.json");
					if (state === null) return false;
					parseReviewState(state, store.course.courseId);
				} else {
					// Legacy registries and other review files have no standalone namespace proof here.
					return false;
				}
			}
		}
		return true;
	} catch {
		// Unreadable or invalid evidence cannot authorize deletion of recovery bytes.
		return false;
	}
}

function parseStoreFiles(
	files: Map<string, string>,
	options: Pick<ResolveCourseIdentityOptions, "expectedCourseId"> = {},
	fileHandles = new Map<string, string>(),
	previous?: Map<string, SnapshotProof>,
	proofs?: Map<string, SnapshotProof>,
): LoadedIdentityStore {
	const reservations = new Map<string, string>([["index", ""]]);
	const courseText = required(files.get(`${IDENTITY}/course.json`), "course identity");
	const course = parseFile(`${IDENTITY}/course.json`, () =>
		parseCourseIdentity(courseText, options.expectedCourseId),
	);
	const names = (directory: string) =>
		[...files.keys()]
			.filter((path) => path.startsWith(`${IDENTITY}/${directory}/`))
			.map((path) => path.slice(`${IDENTITY}/${directory}/`.length))
			.sort();
	const headNames = names("lessons");
	const snapshotNames = names("snapshots");
	// Discover current heads now, but retain the historical-before-head refusal order.
	const parsedHeads = headNames.map((name) => {
		const path = `${IDENTITY}/lessons/${name}`;
		try {
			if (!name.endsWith(".json")) throw new Error(`Identity: unexpected lesson head ${name}`);
			return {
				name,
				head: parseFile(path, () => parseLessonHead(required(files.get(path), path))),
			};
		} catch (error) {
			return { name, error };
		}
	});
	const currentHashes = new Set(parsedHeads.flatMap(({ head }) => (head ? [head.head] : [])));
	const history = new Map<string, Pick<SnapshotProof, "parents" | "lessonId">>();
	const records = new Map<string, SnapshotProof>();
	for (const name of snapshotNames) {
		const path = `${IDENTITY}/snapshots/${name}`;
		const text = required(files.get(path), path);
		if (text === null) throw new Error(`Identity: missing snapshot ${path}`);
		if (!name.endsWith(".json")) throw new Error(`Identity: unexpected snapshot ${name}`);
		const hash = name.slice(0, -5);
		const byteHash = digest(text);
		const fileHandle = serializeIdentity([
			fileHandles.get(path),
			fileHandles.get(`${IDENTITY}/snapshots:entry`),
		]);
		const cached = previous?.get(path);
		let proof: SnapshotProof;
		if (
			cached &&
			cached.byteHash === byteHash &&
			cached.fileHandle === fileHandle &&
			cached.courseId === course.courseId &&
			cached.hash === hash &&
			(!currentHashes.has(hash) || cached.record)
		) {
			proof = cached;
			if (!currentHashes.has(hash) && proof.record) {
				proof = { ...proof, record: undefined, nodesCanonical: undefined, recordBytes: 0 };
			}
		} else {
			const record = parseFile(path, () => {
				const record = parseIdentitySnapshotRecord(text, {
					courseId: course.courseId,
					expectedHash: hash,
					digest,
				});
				assertLegacyIdentitySnapshot(record.snapshot);
				return record;
			});
			const slugs: [string, string][] = [];
			for (const [id, node] of Object.entries(record.snapshot.nodes)) {
				if (node.kind !== "page") continue;
				if (node.slug !== null && node.slug !== undefined) slugs.push([node.slug, id]);
				for (const alias of node.aliases ?? []) slugs.push([alias, id]);
			}
			const facts = {
				byteHash,
				fileHandle,
				courseId: course.courseId,
				hash,
				lessonId: record.snapshot.lessonId,
				parents: record.snapshot.parents,
				activeIds: Object.entries(record.snapshot.nodes)
					.filter(([id, node]) => isDurableIdentity(id, node, EMPTY_ID_HISTORY))
					.map(([id]) => id),
				reservations: slugs,
			};
			const nodesCanonical = currentHashes.has(hash)
				? serializeIdentity(record.snapshot.nodes)
				: undefined;
			proof = {
				...facts,
				factBytes: stringBytes(serializeIdentity(facts)),
				record: nodesCanonical === undefined ? undefined : record,
				nodesCanonical,
				// Canonical bytes bound both the parsed graph payload and the retained canonical string.
				recordBytes:
					nodesCanonical === undefined
						? 0
						: 2 * stringBytes(record.canonical) + stringBytes(nodesCanonical),
			};
		}
		records.set(hash, proof);
		history.set(hash, proof);
		for (const [slug, id] of proof.reservations) reserveSlug(reservations, slug, id);
		proofs?.set(path, proof);
		files.set(path, text);
	}
	const visited = new Set<string>();
	const visiting = new Set<string>();
	const visit = (hash: string) => {
		if (visited.has(hash)) return;
		if (visiting.has(hash)) throw new Error("Identity: snapshot parent cycle");
		const snapshot = history.get(hash);
		if (!snapshot) throw new Error(`Identity: missing parent snapshot ${hash}`);
		visiting.add(hash);
		for (const parent of snapshot.parents) visit(parent);
		visiting.delete(hash);
		visited.add(hash);
	};
	for (const hash of history.keys()) visit(hash);
	const heads: LessonHead[] = [];
	const snapshots: IdentitySnapshot[] = [];
	const snapshotRecords: LoadedIdentityStore["snapshotRecords"] = new Map();
	for (const parsed of parsedHeads) {
		if (!parsed.head) throw parsed.error;
		const { name, head } = parsed;
		const path = `${IDENTITY}/lessons/${name}`;
		const text = required(files.get(path), path);
		if (text === null) throw new Error(`Identity: missing lesson head ${path}`);
		if (!name.endsWith(".json")) throw new Error(`Identity: unexpected lesson head ${name}`);
		const snapshotText = files.get(`${IDENTITY}/snapshots/${head.head}.json`);
		if (snapshotText === undefined)
			throw new Error(`Identity: missing snapshot ${head.head} for ${head.path}`);
		const proof = required(records.get(head.head), "validated head snapshot");
		const record = required(proof.record, "validated head graph");
		parseFile(path, () =>
			assertIdentitySnapshotNamespace(record.snapshot, {
				courseId: course.courseId,
				lessonId: name.slice(0, -5),
			}),
		);
		snapshots.push(record.snapshot);
		snapshotRecords.set(record.snapshot.lessonId, {
			canonical: record.canonical,
			hash: record.hash,
			nodesCanonical: required(proof.nodesCanonical, "validated head nodes"),
		});
		heads.push(head);
		files.set(path, text);
	}
	if (
		[...history.values()].some(
			(snapshot) => !snapshots.some((head) => head.lessonId === snapshot.lessonId),
		)
	)
		throw new Error("Identity: missing lesson head for stored snapshots");
	// Reuse the identity owner's course-wide graph and active-ID validation.
	resolveIdentity(
		{ course, priorHeads: heads, priorSnapshots: snapshots, parsedDocuments: [] },
		dependencies,
	);
	return {
		store: { course, heads, snapshots },
		files,
		fileHandles,
		reservations,
		snapshotRecords,
		activeHistoryIds: new Set([...records.values()].flatMap((proof) => [...proof.activeIds])),
	};
}

/** Pending author artifacts can exist even though those IDs have never been exported. */
async function protectedHistoryIds(
	root: string,
	loaded: LoadedIdentityStore,
	files: Map<string, string | null>,
): Promise<Set<string>> {
	const ids = new Set(loaded.activeHistoryIds);
	if (
		!loaded.store.snapshots.some((s) =>
			Object.entries(s.nodes).some(([id, node]) => node.status === "pending" && !ids.has(id)),
		)
	)
		return ids;
	const narration = await optionalText(root, "narration.yaml");
	files.set("narration.yaml", narration);
	if (narration !== null) {
		const sidecar = parseNarrationSidecarV2(narration, loaded.store.course?.courseId);
		for (const [lessonId, lesson] of Object.entries(sidecar.lessons)) {
			ids.add(lessonId);
			for (const entry of lesson.segments) ids.add(entry.target.id);
		}
	}
	const review = await optionalText(root, ".praxity/review/state.json");
	files.set(".praxity/review/state.json", review);
	if (review !== null)
		for (const run of parseReviewState(review, loaded.store.course?.courseId).runs)
			for (const summary of run.summaries) ids.add(summary.entityId);
	const nextReview = await optionalText(root, ".praxity/review/next-run.json");
	files.set(".praxity/review/next-run.json", nextReview);
	if (nextReview !== null)
		for (const summary of parseReviewRun(nextReview).summaries) ids.add(summary.entityId);
	const reviewEvidence = await readReviewIdentityEvidence(root);
	for (const [path, source] of reviewEvidence.files) files.set(path, source);
	for (const id of reviewEvidence.ids) ids.add(id);
	return ids;
}

export function loadIdentityStore(
	courseDir: string,
	options: Pick<ResolveCourseIdentityOptions, "expectedCourseId" | "established"> & {
		cache?: IdentityStoreCache;
	} = {},
): Promise<IdentityStore> {
	const cache = options.cache ?? defaultStoreCache;
	const state = required(storeCaches.get(cache), "store cache");
	const captured = { expectedCourseId: options.expectedCourseId, established: options.established };
	return withProjectFileTransaction(
		courseDir,
		async (root) => structuredClone((await loadStore(root, captured, cache, state)).store),
		"read",
		false,
	).catch((error: unknown) => {
		cache.invalidate();
		throw error;
	});
}

/** Validate an immutable git revision using the same rules as the disk store. */
export function readIdentityRevision(files: ReadonlyMap<string, string>): IdentityMergeState & {
	activeHistoryIds: ReadonlySet<string>;
} {
	for (const path of files.keys()) {
		if (!/^\.praxity\/identity\/(?:course\.json|(?:lessons|snapshots)\/[^/]+\.json)$/u.test(path))
			throw new Error(`Identity: unexpected revision file ${path}`);
	}
	const { store, activeHistoryIds } = parseStoreFiles(new Map(files));
	return {
		...store,
		activeHistoryIds,
		course: required(store.course ?? undefined, "course identity"),
	};
}

/** Merge only validated revision bytes; conflicted working heads are never parsed as a baseline. */
export async function mergeCourseIdentity(
	courseDir: string,
	revisions: {
		base: ReadonlyMap<string, string>;
		ours: ReadonlyMap<string, string>;
		theirs: ReadonlyMap<string, string>;
	},
	lessonPaths: readonly string[],
): Promise<IdentityMergeResult & { writeResult?: ProjectWriteResult }> {
	assertProjectWritesAllowed();
	const inputs = [revisions.base, revisions.ours, revisions.theirs].map((files) => new Map(files));
	const [base, ours, theirs] = inputs.map(readIdentityRevision);
	const prepared = await withProjectFileTransaction(
		courseDir,
		async (root) => {
			await assertPlainIdentityStore(root);
			for (const state of [base, ours, theirs])
				await assertCompleteInventory(root, state, lessonPaths);
			const courseText = required(
				(await optionalText(root, `${IDENTITY}/course.json`)) ?? undefined,
				"working course identity",
			);
			const files = await readStoreFiles(root, courseText);
			const sources = new Map<string, string>();
			const documents = await Promise.all(
				lessonPaths.map(async (path) => {
					parseLessonHead(serializeIdentity({ schema: 1, path, head: digest("") }));
					const source = required((await optionalText(root, path)) ?? undefined, path);
					sources.set(path, source);
					return { path, tree: readLesson(source).tree };
				}),
			);
			const result = mergeIdentity(base, ours, theirs, documents, dependencies);
			return { root, files, sources, result };
		},
		"write",
		false,
	);
	if (!prepared.result.resolution) return prepared.result;
	const resolution = prepared.result.resolution;
	const proposed = new Map<string, string>();
	// Preserve complete immutable history, including ancestors not referenced by current heads.
	for (const files of inputs) {
		for (const [path, text] of files) {
			if (!path.startsWith(`${IDENTITY}/snapshots/`)) continue;
			const existing = proposed.get(path) ?? prepared.files.get(path);
			if (existing !== undefined && existing !== text)
				throw new Error(`Identity: immutable snapshot differs at ${path}`);
			proposed.set(path, text);
		}
	}
	proposed.set(`${IDENTITY}/course.json`, serializeIdentity(resolution.course));
	for (const snapshot of resolution.snapshots) {
		const text = serializeIdentity(snapshot);
		proposed.set(`${IDENTITY}/snapshots/${digest(text)}.json`, text);
	}
	for (const head of resolution.heads) {
		const snapshot = required(
			resolution.snapshots.find((s) => digest(serializeIdentity(s)) === head.head),
			"merged snapshot",
		);
		proposed.set(`${IDENTITY}/lessons/${snapshot.lessonId}.json`, serializeIdentity(head));
	}
	// Preserve and validate any additional local history. Heads come only from the merge result.
	for (const [path, text] of prepared.files) {
		if (path.startsWith(`${IDENTITY}/snapshots/`) && !proposed.has(path)) proposed.set(path, text);
		if (path.startsWith(`${IDENTITY}/lessons/`) && !proposed.has(path))
			throw new Error(`Identity: working lesson head has no merged result ${path}`);
	}
	readIdentityRevision(proposed);
	const writeResult = await acknowledgeProjectWrite(
		withProjectFileTransaction(
			courseDir,
			async (root) => {
				if (root !== prepared.root)
					throw new Error("Identity: course directory changed during merge");
				await assertPlainIdentityStore(root);
				for (const state of [base, ours, theirs])
					await assertCompleteInventory(root, state, lessonPaths);
				const courseText = required(
					(await optionalText(root, `${IDENTITY}/course.json`)) ?? undefined,
					"working course identity",
				);
				if (!sameFiles(await readStoreFiles(root, courseText), prepared.files))
					throw new Error("Identity: files changed during merge");
				// Include unchanged sources as guards. T1 verifies every expected byte before installing anything.
				const plan: ProjectFileChange[] = [...prepared.sources].map(([path, text]) => ({
					path,
					content: text,
					expectedContent: text,
				}));
				for (const path of new Set([...prepared.files.keys(), ...proposed.keys()])) {
					plan.push({
						path,
						content: proposed.get(path) ?? null,
						expectedContent: prepared.files.get(path) ?? null,
						head: path.startsWith(`${IDENTITY}/lessons/`),
					});
				}
				await applyProjectFilePlan(root, plan);
			},
			"write",
			false,
		),
	);
	return { ...prepared.result, writeResult };
}

export async function resolveCourseIdentity(
	courseDir: string,
	options: ResolveCourseIdentityOptions,
): Promise<ResolvedCourseIdentity> {
	if (options.operationBase) assertCandidateLifetime(options.operationBase);
	return resolveAdmittedCourseIdentity(courseDir, options);
}

export class IdentitySourceError extends Error {
	constructor(
		readonly file: string,
		readonly line: number,
		readonly pending = false,
		readonly copyCountDropped = false,
		readonly sameTitlePages = false,
		readonly code: "bad_yaml" | "source_invalid" = "source_invalid",
	) {
		super(`${file}:${line}`);
	}
}

/** Source validity precedes any identity-loss classification. */
export function identitySourceError(
	result: ResolvedCourseIdentity,
	files?: readonly string[],
): IdentitySourceError | undefined {
	for (const [file, lesson] of result.lessons) {
		if (files && !files.includes(file)) continue;
		const error = lessonIdentitySourceError(file, lesson);
		if (error) return error;
	}
	return undefined;
}

function lessonIdentitySourceError(
	file: string,
	lesson: ReadLessonResult,
): IdentitySourceError | undefined {
	const frontmatter = parseFrontmatter(lesson.tree.stream.source);
	if (frontmatter.errorLine !== undefined)
		return new IdentitySourceError(
			file,
			frontmatter.errorLine + 1,
			false,
			false,
			false,
			"bad_yaml",
		);
	const error = lesson.errors.find(
		(error) => error.level === "error" || error.level === "critical",
	);
	return error ? new IdentitySourceError(file, error.line ?? 1) : undefined;
}

function designOnlySourceEdit(before: string | null | undefined, after: string): boolean {
	if (before == null || before === after) return false;
	const old = parseFrontmatter(before);
	const next = parseFrontmatter(after);
	if (old.errorLine !== undefined || next.errorLine !== undefined || old.body !== next.body)
		return false;
	const { design: _oldDesign, ...oldContent } = old.frontmatter;
	const { design: _nextDesign, ...nextContent } = next.frontmatter;
	return isDeepStrictEqual(oldContent, nextContent);
}

/** Classify the resolver's matches, never infer identity from positions or labels. */
function identityInitialization(result: ResolvedCourseIdentity) {
	const baseline = required(baselines.get(result), "initialization admission");
	const prior = new Map(
		(baseline.retirementInput ?? baseline.readInput).priorSnapshots.flatMap((snapshot) =>
			Object.entries(snapshot.nodes),
		),
	);
	const durable = new Map(
		[...prior].filter(
			([id, node]) =>
				(node.status === "active" || node.status === "pending") &&
				isDurableIdentity(id, node, baseline.readInput.activeHistoryIds),
		),
	);
	const ambiguous = new Set(
		result.identity.unresolved.filter((node) => node.candidates.length).map((node) => node.id),
	);
	const kept = new Set(
		result.identity.sourceMappings
			.filter((mapping) => durable.has(mapping.id) && !ambiguous.has(mapping.id))
			.map((mapping) => mapping.id),
	);
	const ambiguousPrior = new Set(
		result.identity.unresolved.flatMap((node) =>
			node.candidates.length ? [node.id, ...node.candidates] : [],
		),
	);
	for (const snapshot of (baseline.retirementInput ?? baseline.readInput).priorSnapshots) {
		if (!baseline.preservedLessons.size) break;
		const hash = required(
			baseline.retirementRecords.get(snapshot.lessonId),
			"preserved snapshot record",
		).hash;
		const file = (baseline.retirementInput ?? baseline.readInput).priorHeads?.find(
			(head) => head.head === hash,
		)?.path;
		if (file && baseline.preservedLessons.has(file))
			for (const id of Object.keys(snapshot.nodes)) if (durable.has(id)) kept.add(id);
	}
	const sourceSpans = new Map(
		result.identity.sourceMappings.map((mapping) => [mapping.id, mapping.span]),
	);
	const pending = result.identity.unresolved
		.filter((node) => node.candidates.length > 0 && result.lessons.has(node.file))
		.sort(
			(a, b) =>
				a.file.localeCompare(b.file) ||
				(sourceSpans.get(b.id)?.start ?? 0) - (sourceSpans.get(a.id)?.start ?? 0),
		)[0];
	const copyCountDropped =
		!!pending &&
		pending.candidates.length >= 2 &&
		result.identity.unresolved.filter(
			(node) =>
				node.candidates.length === pending.candidates.length &&
				node.candidates.every((id) => pending.candidates.includes(id)),
		).length < pending.candidates.length;
	const records = new Map(
		pending ? result.identity.snapshots.flatMap((snapshot) => Object.entries(snapshot.nodes)) : [],
	);
	const pendingNode = pending ? records.get(pending.id) : undefined;
	const page =
		pendingNode?.kind === "page"
			? pendingNode
			: pendingNode?.kind === "part" && pendingNode.type === "reader-role:title"
				? records.get(pendingNode.parent ?? "")
				: undefined;
	const pageKey = page?.kind === "page" ? identityKey(page) : undefined;
	const samePageTitle = (node: IdentityNode | undefined) =>
		pageKey !== undefined && node?.kind === "page" && identityKey(node) === pageKey;
	const savedPageCount = [...durable.values()].filter(samePageTitle).length;
	// Page candidates are lesson-scoped; a move can look like an extra page only at its destination.
	const sameTitlePages =
		!copyCountDropped &&
		savedPageCount > 1 &&
		savedPageCount ===
			result.identity.sourceMappings.filter((mapping) => samePageTitle(records.get(mapping.id)))
				.length;
	return {
		prior,
		durable,
		kept,
		ambiguous: ambiguousPrior,
		unmatched: [...durable.keys()].some((id) => !kept.has(id) && !ambiguousPrior.has(id)),
		pending: pending
			? {
					file: pending.file,
					copyCountDropped,
					...(sameTitlePages ? { sameTitlePages: true } : {}),
					line: lineColumn(
						required(result.lessons.get(pending.file), "pending lesson").tree.stream.source,
						sourceSpans.get(pending.id)?.start ?? 0,
					).line,
				}
			: undefined,
		rederive: [...durable.keys()].some((id) => !kept.has(id)),
	};
}

/**
 * Saved identities the resolver cannot retain, with their saved diagnostic locations.
 * Requires an admitted result. Counts ambiguous durable pending IDs as retired, although
 * ordinary Studio persistence keeps those IDs pending.
 */
export function identityRetirements(result: ResolvedCourseIdentity): IdentityRetiredLocation[] {
	const baseline = required(baselines.get(result), "initialization admission");
	const input = baseline.retirementInput ?? baseline.readInput;
	const { kept, durable } = identityInitialization(result);
	return input.priorSnapshots
		.flatMap((snapshot) => {
			const snapshotHash = required(
				baseline.retirementRecords.get(snapshot.lessonId),
				"prior snapshot record",
			).hash;
			const file = required(
				input.priorHeads?.find((head) => head.head === snapshotHash),
				"prior lesson head",
			).path;
			const source = result.lessons.get(file)?.tree.stream.source;
			const savedSource = source !== undefined && digest(source) === snapshot.sourceHash;
			return Object.entries(snapshot.nodes).flatMap(([id, node]) => {
				if (kept.has(id) || !durable.has(id)) return [];
				let page = node;
				while (page.kind !== "page" && page.parent)
					page = required(snapshot.nodes[page.parent], "identity owner");
				return [
					{
						file,
						kind: node.kind,
						page: page.kind === "page" ? page.label : "",
						// Old offsets cannot locate lines in edited or absent source.
						line:
							savedSource && node.span.end <= source.length
								? lineColumn(source, node.span.start).line
								: null,
						span: { start: node.span.start, end: node.span.end },
						label: identityDiagnosticLabel(snapshot.nodes, id),
						id,
					},
				];
			});
		})
		.sort(
			(a, b) =>
				a.file.localeCompare(b.file) ||
				a.span.start - b.span.start ||
				a.span.end - b.span.end ||
				a.kind.localeCompare(b.kind) ||
				a.label.localeCompare(b.label),
		);
}

/** Retirements that have neither recorded operation intent nor an explicit source deletion. */
export function identityWriteRetirements(
	result: ResolvedCourseIdentity,
): IdentityRetiredLocation[] {
	const baseline = required(baselines.get(result), "write retirement admission");
	const recorded = new Set(
		(baseline.options.operations ?? []).flatMap((operation) =>
			operation.mapping.flatMap((mapping) =>
				mapping.oldId && ["retired", "absorbed", "cut"].includes(mapping.fate)
					? [mapping.oldId]
					: [],
			),
		),
	);
	const continuing = new Set(
		(baseline.options.operations ?? []).flatMap((operation) =>
			operation.mapping.flatMap((mapping) =>
				mapping.oldId && ["kept", "survivor"].includes(mapping.fate) ? [mapping.oldId] : [],
			),
		),
	);
	const liveBefore = new Set(
		baseline.options.operations?.length
			? (baseline.writeBase?.snapshots ?? baseline.readInput.priorSnapshots).flatMap((snapshot) => {
					if (!baseline.writeBase) {
						const hash = required(
							baseline.readRecords.get(snapshot.lessonId),
							"prior snapshot record",
						).hash;
						const file = baseline.readInput.priorHeads?.find((head) => head.head === hash)?.path;
						const source = file ? baseline.sources.get(file) : undefined;
						if (source == null || digest(source) !== snapshot.sourceHash) return [];
					}
					return Object.entries(snapshot.nodes).flatMap(([id, node]) =>
						node.status === "active" || node.status === "pending" ? [id] : [],
					);
				})
			: [],
	);
	const prior = new Map(
		(baseline.retirementInput ?? baseline.readInput).priorSnapshots.flatMap((snapshot) =>
			Object.entries(snapshot.nodes),
		),
	);
	const { ambiguous } = identityInitialization(result);
	return identityRetirements(result).filter((node) => {
		if (ambiguous.has(node.id) || baseline.options.removedPaths?.includes(node.file)) return false;
		// Recorded deletion covers descendants still live at its base, never earlier outside losses.
		let owner: string | undefined = node.id;
		while (owner) {
			if (recorded.has(owner) && (owner === node.id || liveBefore.has(node.id))) return false;
			if (liveBefore.has(node.id) && baseline.recordedTargets?.includes(owner)) return false;
			// A recorded owner edit covers its implicit reader parts, only while they are still live.
			if (node.kind === "part" && liveBefore.has(node.id) && continuing.has(owner)) return false;
			owner = prior.get(owner)?.parent ?? undefined;
		}
		return true;
	});
}

export class IdentityRetirementError extends IdentityStoreError {
	constructor(
		readonly retirements: IdentityRetiredLocation[],
		readonly origin: "outside" | "draft" = "outside",
	) {
		super(
			{ key: "desktop.identity.exportRefused", args: {} },
			"Identity: unrecorded content retirement requires confirmed re-derivation",
			undefined,
			{ rederive: true, added: [], retired: retirements },
		);
	}
}

function newIdentityBlocks(
	result: ResolvedCourseIdentity,
	prior: ReadonlyMap<string, IdentityNode>,
): IdentityBlockLocation[] {
	const nodes = new Map(
		result.identity.snapshots.flatMap((snapshot) => Object.entries(snapshot.nodes)),
	);
	const records = Object.fromEntries(nodes);
	return result.identity.sourceMappings.flatMap((mapping) => {
		const node = required(nodes.get(mapping.id), "source identity");
		if (node.kind !== "block" || prior.has(mapping.id)) return [];
		let page = node;
		while (page.kind !== "page" && page.parent)
			page = required(nodes.get(page.parent), "identity owner");
		const source = required(result.lessons.get(mapping.file), "identity source").tree.stream.source;
		return [
			{
				file: mapping.file,
				page: page.label,
				line: lineColumn(source, mapping.span.start).line,
				label: identityDiagnosticLabel(records, mapping.id),
				id: mapping.id,
			},
		];
	});
}

/** Inspect initialization without recovering a journal or admitting an identity write. */
export async function previewCourseIdentityInitialization(
	courseDir: string,
	lessonPaths: readonly string[],
): Promise<IdentityInitializationChanges> {
	try {
		await resolveCourseIdentity(courseDir, { lessonPaths, strict: true });
		return { added: [], retired: [] };
	} catch (error) {
		if (error instanceof IdentityStoreError && error.initialization) return error.initialization;
		throw error;
	}
}

/** Explicitly record the current source without replacing any authored bytes. */
export async function initializeCourseIdentity(
	courseDir: string,
	lessonPaths: readonly string[],
	options: {
		rederive?: boolean;
		beforeWrite?: (changes: IdentityInitializationChanges) => void | Promise<void>;
	} = {},
) {
	assertProjectWritesAllowed();
	return withProjectFileTransaction(
		courseDir,
		async (root) => {
			let result = await resolveCourseIdentity(root, { lessonPaths });
			assertIdentitySourceValid(result);
			const initialization = identityInitialization(result);
			const { pending } = initialization;
			// Making text unique cannot identify which durable copy was removed.
			if (pending && (!initialization.unmatched || pending.copyCountDropped) && !options.rederive) {
				throw new IdentitySourceError(
					pending.file,
					pending.line,
					true,
					pending.copyCountDropped,
					pending.sameTitlePages,
				);
			}
			if (initialization.rederive && !options.rederive)
				throw new IdentityStoreError(
					{ key: "desktop.identity.exportRefused", args: {} },
					"Identity requires explicit re-derivation",
					undefined,
					{
						rederive: true,
						...(pending ? { pending } : {}),
						added: newIdentityBlocks(result, initialization.prior),
						retired: identityRetirements(result),
					},
				);
			if (initialization.rederive && options.rederive) {
				const baseline = required(baselines.get(result), "re-derivation admission");
				const { kept } = initialization;
				const mapping: IdentityMapping[] = [...initialization.durable]
					.filter(([id]) => !kept.has(id))
					.map(([id]) => ({ oldId: id, newId: null, fate: "retired" }));
				const placements = result.identity.sourceMappings.map((source) => {
					const mappingIndex = mapping.length;
					mapping.push(
						kept.has(source.id)
							? { oldId: source.id, newId: source.id, fate: "kept" }
							: {
									oldId: null,
									newId: initialization.prior.has(source.id) ? null : source.id,
									fate: "new",
								},
					);
					return { mappingIndex, file: source.file, path: source.path };
				});
				result = await resolveCourseIdentity(root, {
					lessonPaths,
					operations: [
						{
							intent: "modify",
							mapping,
							placements,
							files: [
								...new Set([
									...lessonPaths,
									...(baseline.readInput.priorHeads ?? []).map((head) => head.path),
								]),
							].map((path) => {
								const head = required(
									baseline.readInput.priorHeads?.find((head) => head.path === path) ??
										baseline.readInput.priorHeads?.[0],
									"re-derivation head",
								);
								return {
									path,
									fromSnapshot: head.head,
									fromRevision: required(
										baseline.readInput.priorSnapshots.find(
											(snapshot) => digest(serializeIdentity(snapshot)) === head.head,
										),
										"prior snapshot",
									).sourceHash,
									toRevision: digest(result.lessons.get(path)?.tree.stream.source ?? ""),
								};
							}),
						},
					],
				});
			}
			const changes = {
				added: newIdentityBlocks(result, initialization.prior),
				retired: identityRetirements(result),
			};
			const baseline = required(baselines.get(result), "initialization admission");
			const prior = baseline.readInput.priorHeads ?? [];
			const changed =
				!baseline.readInput.course ||
				prior.length !== result.identity.heads.length ||
				result.identity.heads.some(
					(head) => !prior.some((old) => old.path === head.path && old.head === head.head),
				);
			assertDurableCandidate(result.identity);
			if (options.rederive) await options.beforeWrite?.(changes);
			if (!changed) return { changed: false, ...(options.rederive ? changes : {}) };
			const durable = await persistCourseIdentity(
				root,
				result,
				[],
				options.rederive ? { retirements: "confirmed" } : {},
			);
			return { changed: true, ...durable.writeResult, ...(options.rederive ? changes : {}) };
		},
		"write",
	);
}

/** A refused write has no durable allocation to share with the author host. */
export async function projectWriteRefusal(
	result: ResolvedCourseIdentity,
	refusal: OperationRefusal,
): Promise<OperationRefusal> {
	assertCandidateLifetime(result);
	const { member, ...refused } = refusal;
	if (!member) return refused;
	const baseline = required(baselines.get(result), "write refusal admission");
	const candidate = baseline.validatedIdentity.sourceMappings.find((node) => node.id === member);
	if (!candidate) return refused;
	const shown = await readCourseIdentity(baseline.root, {
		...baseline.options,
		identitySession: baseline.session?.owner,
	});
	const display = readDisplayBindings(shown, baseline.validatedIdentity).get(member);
	return { ...refused, ...(display ? { member: display } : {}) };
}

async function resolveAdmittedCourseIdentity(
	courseDir: string,
	options: ResolveCourseIdentityOptions,
	readSession?: ReturnType<typeof createIdentityReadSession>,
	captureReadBaseline?: (baseline: Baseline) => void,
	expectedFiles?: ReadonlyMap<string, string>,
): Promise<ResolvedCourseIdentity> {
	// Read and validate the approved store before acquiring the destination admission.
	// Conversion may replace legacy metadata, but never an existing modern lineage.
	const approved = options.approvedConversion
		? await withProjectFileTransaction(
				options.approvedConversion.directory,
				async (root) => {
					const loaded = await loadStore(root);
					if (!loaded.store.course)
						throw new Error("Identity: approved conversion has no namespace");
					const expected = options.approvedConversion?.fileHashes ?? {};
					if (
						loaded.files.size !== Object.keys(expected).length ||
						[...loaded.files].some(([path, text]) => expected[path] !== digest(text))
					)
						throw new Error("Identity: approved conversion file hashes differ");
					return loaded;
				},
				"read",
				false,
			)
		: undefined;
	return withProjectFileTransaction(
		courseDir,
		async (root) => {
			if (!readSession && !options.strict) await assertPlainIdentityStore(root);
			const reuseOwner = admissionStores.getStore();
			const session = options.identitySession;
			const sessionState = session ? identitySessions.get(session) : undefined;
			if (
				session &&
				((await resolveExistingPathWithin(session.projectDir, session.projectDir)) !== root ||
					(sessionState?.root !== undefined && sessionState.root !== root))
			)
				throw new Error("Identity: admission session belongs to another project");
			const lessonPaths = serializeIdentity(options.lessonPaths);
			let canRetain =
				sessionState &&
				!options.strict &&
				!options.operations?.length &&
				!options.operationBase &&
				!options.operationPlan &&
				!options.restore &&
				!options.removedPaths?.length &&
				!options.approvedConversion &&
				!options.slugRenames;
			let retained = canRetain ? sessionState?.retained : undefined;
			if (retained?.lessonPaths !== lessonPaths) {
				if (sessionState) sessionState.retained = undefined;
				retained = undefined;
			}
			let current: Awaited<ReturnType<typeof loadStore>>;
			if (retained) {
				const fileHandles = new Map<string, string>();
				const courseText = await optionalText(root, `${IDENTITY}/course.json`, fileHandles);
				const files =
					courseText === null
						? new Map<string, string>()
						: await readStoreFiles(root, courseText, fileHandles);
				if (
					sameFiles(files, retained.loaded.files) &&
					sameFiles(fileHandles, retained.loaded.fileHandles) &&
					(options.expectedCourseId === undefined ||
						options.expectedCourseId === retained.loaded.store.course?.courseId)
				) {
					current = {
						...retained.loaded,
						files,
						fileHandles,
						reservations: new Map(retained.loaded.reservations),
					};
				} else {
					if (sessionState) sessionState.retained = undefined;
					retained = undefined;
					current = await loadStore(root, options);
				}
			} else current = await loadStore(root, { ...options, expectedFiles });
			const admitted =
				reuseOwner?.active && admissionStores.getStore() === reuseOwner
					? { ...current, reservations: new Map(current.reservations) }
					: undefined;
			if (approved && current.store.course)
				throw new Error("Identity: conversion cannot replace an existing modern lineage");
			const { files } = current;
			const loaded = approved ?? current;
			const { reservations } = loaded;
			const base = options.operationBase;
			if (base) {
				assertCandidateLifetime(base);
				const issued = baselines.get(base);
				if (
					!issued ||
					issued.root !== root ||
					!matchesIssuedIdentity(issued, base.identity) ||
					!options.operations?.length ||
					approved
				)
					throw new Error("Identity: invalid operation base");
				assertDurableCandidate(base.identity);
				if (!sameFiles(issued.files, current.files))
					throw new ProjectFileConflictError("Identity: operation base files changed");
			}
			// The admission above binds these facts before the next await. Caller-owned
			// operation bases cannot change the graph paired with private canonical bytes.
			const baseIdentity = base ? structuredClone(base.identity) : undefined;
			const store = baseIdentity
				? {
						course: baseIdentity.course,
						heads: baseIdentity.heads,
						snapshots: baseIdentity.snapshots,
					}
				: loaded.store;
			const priorRecords = base
				? required(baselines.get(base), "operation base").snapshotRecords
				: loaded.snapshotRecords;
			await assertCompleteInventory(root, current.store, options.lessonPaths, options.removedPaths);
			if (Object.keys(options.sources ?? {}).some((path) => !options.lessonPaths.includes(path)))
				throw new Error("Identity: draft source is outside the course inventory");
			const sources = new Map<string, string | null>();
			for (const path of options.removedPaths ?? []) {
				parseLessonHead(serializeIdentity({ schema: 1, path, head: digest("") }));
				if (options.strict || options.lessonPaths.includes(path))
					throw new Error("Identity: invalid removed source inventory");
				const source = await optionalText(root, path);
				if (source === null) throw new Error(`Identity: missing removed source ${path}`);
				sources.set(path, source);
			}
			const usedReads = new Set<ReadLessonResult>();
			const parsed = await Promise.all(
				options.lessonPaths.map(async (path) => {
					parseLessonHead(serializeIdentity({ schema: 1, path, head: digest("") }));
					const saved = await optionalText(root, path);
					if (base && saved !== base.lessons.get(path)?.tree.stream.source)
						throw new ProjectFileConflictError(
							`Identity: operation base source changed for ${path}`,
						);
					sources.set(path, saved);
					const source = options.sources?.[path] ?? saved;
					if (source === null) throw new Error(`Identity: missing source ${path}`);
					const retainedRead = retained?.reads.get(path);
					const unchanged = retainedRead?.tree.stream.source === source;
					const cachedRead =
						unchanged && retainedRead
							? structuredClone(retainedRead)
							: (options.lessonReads?.get(source) ?? readLesson(source));
					if (cachedRead.tree.stream.source !== source)
						throw new Error(`Identity: parsed source revision differs for ${path}`);
					options.lessonReads?.set(source, cachedRead);
					// Identical source can share parsing work, but each mutable lesson owns its tree.
					const read = usedReads.has(cachedRead) ? structuredClone(cachedRead) : cachedRead;
					usedReads.add(cachedRead);
					return { path, source, read, unchanged };
				}),
			);
			// Invalid lessons are opaque to a writer; only a read admission describes their current trees.
			const preservedLessons = new Set(
				!readSession && !options.strict
					? parsed
							.filter(({ path, read }) => lessonIdentitySourceError(path, read))
							.map(({ path }) => path)
					: [],
			);
			if (preservedLessons.size) {
				canRetain = false;
				retained = undefined;
				if (sessionState) sessionState.retained = undefined;
			}
			const identityParsed = parsed.filter(({ path }) => !preservedLessons.has(path));
			const operationParsed = base
				? parsed.filter(
						({ path }) =>
							!required(baselines.get(base), "operation base").preservedLessons.has(path),
					)
				: identityParsed;
			if (
				base &&
				!isDeepStrictEqual(baseIdentity, base.identity) &&
				required(baselines.get(base), "operation base").serialized !==
					serializeIdentity(base.identity)
			)
				throw new Error("Identity: invalid operation base");
			const artifacts = new Map<string, string | null>();
			const input = {
				course: store.course ?? undefined,
				priorHeads: store.heads,
				priorSnapshots: store.snapshots,
				activeHistoryIds: await protectedHistoryIds(root, loaded, artifacts),
				parsedDocuments: identityParsed.map(({ path, read }) => ({ path, tree: read.tree })),
				operations: options.operations,
				readerRoles: true,
			};
			// Artifact edits are outside the identity file inventory retained by this resolver.
			if (
				retained &&
				store.snapshots.some((snapshot) =>
					Object.values(snapshot.nodes).some((node) => node.status === "pending"),
				)
			) {
				retained = undefined;
				if (sessionState) sessionState.retained = undefined;
			}
			const committed =
				retained?.committed && parsed.every(({ unchanged }) => unchanged)
					? retained.committed
					: undefined;
			const resolver =
				!readSession && canRetain && !committed && !retained?.resolver
					? createIdentityResolver(input, dependencies)
					: undefined;
			if (
				options.operationPlan &&
				(!base ||
					!options.operations?.length ||
					options.strict ||
					approved ||
					options.slugRenames ||
					options.removedPaths?.length)
			)
				throw new Error("Identity: invalid issued operation plan");
			const adopted =
				options.operationPlan && base
					? consumeOperationIdentity(options.operationPlan, {
							identity: base.identity,
							activeHistoryIds: [...input.activeHistoryIds].sort(),
							before: operationParsed.map(({ path }) => ({
								path,
								source: required(sources.get(path) ?? undefined, "operation baseline source"),
							})),
							after: operationParsed.map(({ path, source }) => ({ path, source })),
							operations: options.operations ?? [],
							readerRoles: true,
							...(options.restore ? { restore: options.restore } : {}),
						})
					: undefined;
			const readResolution = readSession?.resolve(input);
			const savedWriteAdmission =
				!Object.keys(options.sources ?? {}).length &&
				!options.removedPaths?.length &&
				!options.approvedConversion;
			// Refresh the saved display proof before a writer plans against current sources.
			if (!readSession && !options.strict && !base && savedWriteAdmission)
				sessionState?.readSession?.resolve(input);
			let identity =
				readResolution?.candidate ??
				adopted?.identity ??
				(committed
					? structuredClone(committed)
					: retained?.resolver
						? retained.resolver.resolve(input.parsedDocuments)
						: (resolver?.initial ?? resolveIdentity(input, dependencies)));
			if (options.restore && !options.operationPlan) {
				if (!base || !options.operations?.every((operation) => operation.inverse))
					throw new Error("Identity: metadata restoration requires a guarded inverse");
				if (
					!canRestoreIdentityMetadata(
						base.identity,
						options.restore.identity,
						options.restore.written,
						options.restore.mapping,
					)
				)
					throw new ProjectFileConflictError("Identity: inverse metadata changed");
				identity = restoreIdentityMetadata(
					identity,
					options.restore.identity,
					options.restore.written,
					options.restore.mapping,
					dependencies,
				);
			}
			const preservedRecords: LoadedIdentityStore["snapshotRecords"] = new Map();
			for (const file of preservedLessons) {
				const candidateHead = identity.heads.find((head) => head.path === file);
				const candidateSnapshot =
					candidateHead &&
					identity.snapshots.find(
						(snapshot) => digest(serializeIdentity(snapshot)) === candidateHead.head,
					);
				if (candidateSnapshot)
					identity.snapshots = identity.snapshots.filter(
						(snapshot) => snapshot !== candidateSnapshot,
					);
				identity.heads = identity.heads.filter((head) => head.path !== file);
				const head = loaded.store.heads.find((head) => head.path === file);
				if (!head) continue;
				const previous = required(
					loaded.store.snapshots.find(
						(snapshot) => loaded.snapshotRecords.get(snapshot.lessonId)?.hash === head.head,
					),
					"preserved snapshot",
				);
				identity.snapshots = identity.snapshots.filter(
					(snapshot) => snapshot.lessonId !== previous.lessonId,
				);
				identity.snapshots.push(structuredClone(previous));
				preservedRecords.set(
					previous.lessonId,
					required(loaded.snapshotRecords.get(previous.lessonId), "preserved record"),
				);
				identity.heads = identity.heads.filter((candidate) => candidate.path !== file);
				identity.heads.push({ ...head });
				const ids = new Set(Object.keys(previous.nodes));
				if (identity.sourceMappings.some((node) => node.file !== file && ids.has(node.id)))
					throw required(
						lessonIdentitySourceError(
							file,
							required(
								parsed.find((entry) => entry.path === file),
								"preserved lesson",
							).read,
						),
						"source dependency error",
					);
				const kept = Object.entries(previous.nodes)
					.filter(([, node]) => node.status === "active" || node.status === "pending")
					.map(([id]) => ({ oldId: id, newId: id, fate: "kept" as const }));
				identity.mapping = [
					...identity.mapping.filter((mapping) => !mapping.oldId || !ids.has(mapping.oldId)),
					...kept,
				];
				identity.inverseMapping = [
					...identity.inverseMapping.filter((mapping) => !mapping.oldId || !ids.has(mapping.oldId)),
					...kept,
				];
				identity.exportIds = identity.exportIds.filter((id) => !ids.has(id));
			}
			identity.sourceMappings = identity.sourceMappings.filter(
				(mapping) => !preservedLessons.has(mapping.file),
			);
			identity.unresolved = identity.unresolved.filter((node) => !preservedLessons.has(node.file));
			if (preservedLessons.size) identity.exportable = false;
			const snapshotsByHash = new Map(
				identity.snapshots.map((snapshot) => [
					preservedRecords.get(snapshot.lessonId)?.hash ?? digest(serializeIdentity(snapshot)),
					snapshot,
				]),
			);
			const headLessons = new Map(
				identity.heads.map((head) => [
					head.path,
					required(snapshotsByHash.get(head.head), "resolved head snapshot").lessonId,
				]),
			);
			let pageIndex = 0;
			const renamed = new Set<string>();
			for (const snapshot of identity.snapshots) {
				for (const [id, node] of Object.entries(snapshot.nodes)) {
					if (node.kind !== "page" || node.status === "retired" || node.status === "cut") continue;
					if (!node.slug) {
						const base = pageSlug(node.label, pageIndex);
						let slug = base;
						let suffix = 2;
						while (reservations.has(slug)) slug = `${base}-${suffix++}`;
						node.slug = slug;
						reserveSlug(reservations, slug, id);
					}
					pageIndex++;
					const requested = options.slugRenames?.[id];
					if (requested === undefined) continue;
					reserveSlug(reservations, requested, id);
					renamed.add(id);
					if (requested !== node.slug) {
						node.aliases = [...new Set([...(node.aliases ?? []), node.slug])].filter(
							(alias) => alias !== requested,
						);
						node.slug = requested;
					}
				}
			}
			if (Object.keys(options.slugRenames ?? {}).some((id) => !renamed.has(id)))
				throw new Error("Identity: slug rename target is not a current page");
			const lessons = new Map<string, ReadLessonResult>();
			const providers = new Map<string, LessonIdAllocator>();
			for (const { path, read, unchanged } of parsed) {
				if (unchanged || preservedLessons.has(path)) {
					const known = new Map(
						[...read.nodes].map(([id, record]) => [readerKey(record.node, record.role), id]),
					);
					lessons.set(path, read);
					providers.set(path, idProvider(path, known, true));
					continue;
				}
				const projection = projectLessonIdentity(
					path,
					read,
					identity,
					adopted?.descriptors?.filter((descriptor) => descriptor.file === path),
				);
				lessons.set(path, projection.read);
				providers.set(path, projection.ids);
			}
			const resolvedRecords: LoadedIdentityStore["snapshotRecords"] = new Map();
			for (let index = 0; index < identity.snapshots.length; index++) {
				const snapshot = identity.snapshots[index];
				const preservedRecord = preservedRecords.get(snapshot.lessonId);
				if (preservedRecord) {
					resolvedRecords.set(snapshot.lessonId, preservedRecord);
					continue;
				}
				const previous = store.snapshots.find(
					(previous) => previous.lessonId === snapshot.lessonId,
				);
				const previousRecord = previous ? priorRecords?.get(previous.lessonId) : undefined;
				const previousCanonical = previous
					? (previousRecord?.canonical ?? serializeIdentity(previous))
					: undefined;
				const previousHash = previousCanonical
					? (previousRecord?.hash ?? digest(previousCanonical))
					: undefined;
				if (previousHash) snapshot.parents = [previousHash];
				const reused =
					previous &&
					previous.sourceHash === snapshot.sourceHash &&
					(previousRecord?.nodesCanonical ?? serializeIdentity(previous.nodes)) ===
						serializeIdentity(snapshot.nodes);
				if (reused) identity.snapshots[index] = structuredClone(previous);
				// A reused snapshot already passed store validation, including its namespace and graph.
				if (reused && previousHash && previousCanonical)
					resolvedRecords.set(snapshot.lessonId, {
						canonical: previousCanonical,
						hash: previousHash,
						nodesCanonical: previousRecord?.nodesCanonical ?? serializeIdentity(previous.nodes),
					});
				else {
					const canonical = serializeIdentity(identity.snapshots[index]);
					parseIdentitySnapshot(canonical, {
						courseId: identity.course.courseId,
						digest,
					});
					resolvedRecords.set(snapshot.lessonId, {
						canonical,
						hash: digest(canonical),
						nodesCanonical: serializeIdentity(identity.snapshots[index].nodes),
					});
				}
				if (![...headLessons.values()].includes(snapshot.lessonId) && previous) {
					const oldHead = required(
						store.heads.find((head) => head.head === previousHash),
						"prior lesson head",
					);
					identity.heads.push({ ...oldHead });
					headLessons.set(oldHead.path, snapshot.lessonId);
				}
			}
			for (const head of identity.heads)
				head.head = required(
					resolvedRecords.get(required(headLessons.get(head.path), "resolved head lesson")),
					"resolved lesson snapshot hash",
				).hash;
			if (approved) {
				const imported = new Map<string, string>();
				imported.set(`${IDENTITY}/course.json`, serializeIdentity(identity.course));
				for (const snapshot of identity.snapshots) {
					const text = serializeIdentity(snapshot);
					imported.set(`${IDENTITY}/snapshots/${digest(text)}.json`, text);
				}
				for (const head of identity.heads) {
					const snapshot = required(
						identity.snapshots.find((s) => digest(serializeIdentity(s)) === head.head),
						"approved snapshot",
					);
					imported.set(`${IDENTITY}/lessons/${snapshot.lessonId}.json`, serializeIdentity(head));
				}
				if (
					!identity.exportable ||
					identity.unresolved.length ||
					!sameFiles(imported, approved.files)
				)
					throw new Error(
						"Identity: approved conversion does not exactly resolve the supplied sources",
					);
			}
			if (options.strict) {
				for (const [path, lesson] of lessons) {
					lesson.transientIds = false;
					const known = new Map(
						[...lesson.nodes].map(([id, record]) => [readerKey(record.node, record.role), id]),
					);
					providers.set(path, idProvider(path, known, false));
				}
			}
			const result = {
				identity: structuredClone(identity),
				activeHistoryIds: new Set(input.activeHistoryIds),
				lessons,
				ids: providers,
				transientIds: !options.strict,
			};
			if (
				!readSession &&
				admitted &&
				reuseOwner?.active &&
				admissionStores.getStore() === reuseOwner
			)
				reuseOwner.stores.set(result, admitted);
			const writeActive =
				!readSession && !options.strict
					? bindProjectWriteLifetime(root, () => {
							baselines.delete(result);
							reuseOwner?.stores.delete(result);
							expiredCandidates.add(result);
						})
					: undefined;
			const baseline: Baseline = {
				writeActive,
				preservedLessons,
				writtenLessons: options.operations?.length
					? [
							...new Set([
								...options.operations.flatMap((operation) =>
									operation.files
										.filter((file) => file.fromRevision !== file.toRevision)
										.map((file) => file.path),
								),
								...(adopted?.recordedTargets ?? []).flatMap(
									(id) =>
										base?.identity.sourceMappings
											.filter((node) => node.id === id)
											.map((node) => node.file) ?? [],
								),
							]),
						].filter((file) => !adopted || !preservedLessons.has(file))
					: Object.keys(options.sources ?? {}).length || options.removedPaths?.length
						? Object.keys(options.sources ?? {}).filter(
								(file) =>
									!preservedLessons.has(file) ||
									!designOnlySourceEdit(sources.get(file), options.sources?.[file] ?? ""),
							)
						: undefined,
				recordedTargets: adopted?.recordedTargets,
				readRecords: required(priorRecords, "prior snapshot records"),
				retirementRecords: base
					? required(baselines.get(base), "retirement base").retirementRecords
					: required(priorRecords, "prior snapshot records"),
				readInput: structuredClone(input),
				...(base
					? {
							retirementInput:
								required(baselines.get(base), "retirement base").retirementInput ??
								required(baselines.get(base), "retirement base").readInput,
						}
					: {}),
				readView: readResolution?.view,
				writeBase: base
					? required(baselines.get(base), "write base").validatedIdentity
					: savedWriteAdmission
						? identity
						: undefined,
				root,
				files,
				sources,
				artifacts,
				options: structuredClone({
					...options,
					operationBase: undefined,
					operationPlan: undefined,
					lessonReads: undefined,
					identitySession: undefined,
				}),
				serialized: serializeIdentity(identity),
				validatedIdentity: identity,
				snapshotRecords: resolvedRecords,
				...(session && sessionState ? { session: { owner: session, state: sessionState } } : {}),
				...(base
					? {
							operationSnapshots: [
								...required(baselines.get(base), "operation base").snapshotRecords.values(),
							].map(({ canonical, hash }) => ({ canonical, hash })),
						}
					: {}),
				...(options.strict ? { persisted: true as const } : {}),
				readerProjections: new Map(
					[...lessons].map(([path, lesson]) => [
						path,
						serializeIdentity([lesson.pages, lesson.blocks]),
					]),
				),
				readerMappings: new Map(
					[...lessons].map(([path, lesson]) => [
						path,
						new Map(
							[...lesson.nodes].map(([id, record]) => [readerKey(record.node, record.role), id]),
						),
					]),
				),
			};
			// Reader planning evidence has no persistence issuance, even during its admission.
			if (readSession) required(captureReadBaseline, "read baseline consumer")(baseline);
			else baselines.set(result, baseline);
			if (options.strict) assertIdentityExportable(result);
			const currentSessionState = session ? identitySessions.get(session) : undefined;
			if (currentSessionState) {
				// Bind only successful admissions, including when reads were invalidated in flight.
				if (currentSessionState.root !== undefined && currentSessionState.root !== root)
					throw new Error("Identity: admission session belongs to another project");
				currentSessionState.root = root;
			}
			if (
				canRetain &&
				sessionState &&
				resolver &&
				current.store.course &&
				identity.heads.length === current.store.heads.length &&
				identity.heads.every((h) =>
					current.store.heads.some((old) => old.path === h.path && old.head === h.head),
				) &&
				identity.exportable &&
				session &&
				identitySessions.get(session) === sessionState
			) {
				sessionState.retained = {
					loaded: current,
					lessonPaths,
					reads: structuredClone(lessons),
					resolver,
				};
			}
			return result;
		},
		readSession || options.strict ? "read" : "write",
		false,
	).catch((error: unknown) => {
		options.identitySession?.invalidate();
		defaultStoreCache.invalidate();
		throw error;
	});
}

/** Persists only a resolver result, together with its exact source revisions. */
export async function persistCourseIdentity(
	courseDir: string,
	result: ResolvedCourseIdentity,
	changes: readonly ProjectFileChange[] = [],
	options: ProjectFilePlanOptions & { retirements?: "confirmed" } = {},
): Promise<ResolvedCourseIdentity> {
	assertProjectWritesAllowed();
	assertCandidateLifetime(result);
	const baseline = baselines.get(result);
	const owner = admissionStores.getStore();
	const loaded = owner?.active ? owner.stores.get(result) : undefined;
	const admitted = owner && loaded ? { owner, loaded } : undefined;
	owner?.stores.delete(result);
	// Capture caller-owned drafts before the first await. Admission and the returned
	// value must use the same payload, even while another save holds the queue.
	const payload = {
		identity: structuredClone(result.identity),
		lessons: structuredClone(result.lessons),
		operationSnapshots: baseline?.operationSnapshots ?? [],
	};
	const { retirements, ...fileOptions } = options;
	const planOptions = {
		...fileOptions,
		createDirectories: [...(fileOptions.createDirectories ?? [])],
	};
	if (!baseline || !matchesIssuedIdentity(baseline, payload.identity))
		throw new Error("Identity: resolution was changed or was not issued by this store");
	assertDurableCandidate(payload.identity);
	const session = baseline.session;
	const installedInput = {
		...baseline.readInput,
		course: payload.identity.course,
		priorHeads: payload.identity.heads,
		priorSnapshots: payload.identity.snapshots,
	};
	const displayedIdentity = {
		...payload.identity,
		heads: payload.identity.heads.filter((head) => !baseline.preservedLessons.has(head.path)),
	};
	const transitions =
		session && identitySessions.get(session.owner) === session.state
			? [
					session.state.readSession?.prepareWrite(
						installedInput,
						baseline.writeBase && {
							...baseline.writeBase,
							heads: baseline.writeBase.heads.filter(
								(head) => !baseline.preservedLessons.has(head.path),
							),
						},
						displayedIdentity,
					),
					// Draft display descriptors describe the result, not the saved operation base.
					session.state.draftReadSession?.prepareWrite(
						{ ...installedInput, operations: undefined },
						undefined,
						displayedIdentity,
					),
				]
			: [];
	const snapshotRecords = new Map(
		payload.identity.snapshots.map((snapshot) => {
			const record = required(baseline.snapshotRecords.get(snapshot.lessonId), "issued snapshot");
			return [record.hash, { snapshot, text: record.canonical }] as const;
		}),
	);
	const files = new Map(baseline.files);
	files.set(`${IDENTITY}/course.json`, serializeIdentity(payload.identity.course));
	for (const { canonical, hash } of payload.operationSnapshots) {
		const path = `${IDENTITY}/snapshots/${hash}.json`;
		if (!files.has(path)) files.set(path, canonical);
	}
	for (const [hash, { text }] of snapshotRecords) {
		const path = `${IDENTITY}/snapshots/${hash}.json`;
		if (!files.has(path)) files.set(path, text);
	}
	for (const head of payload.identity.heads) {
		const { snapshot } = required(snapshotRecords.get(head.head), "persisted head snapshot");
		files.set(`${IDENTITY}/lessons/${snapshot.lessonId}.json`, serializeIdentity(head));
	}
	for (const path of baseline.sources.keys())
		if (!baseline.options.removedPaths?.includes(path))
			required(payload.lessons.get(path), `resolved source ${path}`);
	for (const [path, lesson] of payload.lessons) {
		const head = payload.identity.heads.find((head) => head.path === path);
		const snapshot = head ? snapshotRecords.get(head.head)?.snapshot : undefined;
		if (
			!baseline.preservedLessons.has(path) &&
			(!snapshot || snapshot.sourceHash !== digest(lesson.tree.stream.source))
		)
			throw new Error(`Identity: source revision differs from resolved ${path}`);
	}
	const assertUnchanged = () => {
		assertCandidateLifetime(result);
		// Most checkpoints compare the untouched captured JSON directly. Canonical
		// fallback preserves acceptance of reordered keys and ignored undefined fields.
		if (
			(!isDeepStrictEqual(payload.identity, result.identity) &&
				baseline.serialized !== serializeIdentity(result.identity)) ||
			result.lessons.size !== payload.lessons.size ||
			[...payload.lessons].some(
				([path, lesson]) =>
					result.lessons.get(path)?.tree.stream.source !== lesson.tree.stream.source,
			)
		)
			throw new Error("Identity: resolution or source revision changed during persistence");
	};
	const assertArtifactsUnchanged = async () => {
		for (const [path, saved] of baseline.artifacts)
			if ((await optionalText(baseline.root, path)) !== saved)
				throw new ProjectFileConflictError(`Identity: artifact changed since resolution ${path}`);
	};
	const planChanges = changes.map((change) => {
		if (isAbsolute(change.path)) throw new Error("Identity: invalid transaction path");
		return {
			...change,
			content:
				change.content instanceof Uint8Array ? Uint8Array.from(change.content) : change.content,
			expectedContent:
				change.expectedContent instanceof Uint8Array
					? Uint8Array.from(change.expectedContent)
					: change.expectedContent,
			path: relative(
				baseline.root,
				resolve(baseline.root, change.path.replaceAll("\\", "/")),
			).replaceAll("\\", "/"),
		};
	});
	for (const change of planChanges) {
		if (ownedIdentityPath(change.path))
			throw new Error("Identity: identity files belong to the store");
		if (change.path.toLowerCase().endsWith(".prax") && !baseline.sources.has(change.path))
			throw new Error(`Identity: source ${change.path} was not resolved`);
	}
	const writeResult = await acknowledgeProjectWrite(
		withProjectFileTransaction(
			courseDir,
			async (root) => {
				assertUnchanged();
				if (root !== baseline.root)
					throw new Error("Identity: resolution belongs to another course directory");
				await assertPlainIdentityStore(root);
				const current = await loadStore(
					root,
					{ ...baseline.options, expectedFiles: baseline.files },
					defaultStoreCache,
					undefined,
					undefined,
					admitted,
				);
				if (!sameFiles(current.files, baseline.files))
					throw new ProjectFileConflictError("Identity: files changed since resolution");
				await assertArtifactsUnchanged();
				await assertCompleteInventory(
					root,
					current.store,
					baseline.options.lessonPaths,
					baseline.options.removedPaths,
				);
				const plan: ProjectFileChange[] = planChanges;
				for (const change of plan) {
					try {
						const target = await resolveWritablePathWithin(root, join(root, change.path));
						if (ownedIdentityPath(relative(root, target).replaceAll("\\", "/")))
							throw new Error("Identity: identity files belong to the store");
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					}
				}
				for (const [path, saved] of baseline.sources) {
					if (baseline.options.removedPaths?.includes(path)) {
						const supplied = plan.find((change) => change.path === path);
						if (
							!supplied ||
							supplied.content !== null ||
							supplied.expectedContent === undefined ||
							supplied.expectedContent === null ||
							Buffer.from(supplied.expectedContent).toString("utf8") !== saved
						)
							throw new Error(`Identity: missing guarded source deletion ${path}`);
						continue;
					}
					const content = required(payload.lessons.get(path), `resolved source ${path}`).tree.stream
						.source;
					const supplied = plan.find((change) => change.path === path);
					if (
						supplied &&
						(supplied.content === null ||
							Buffer.from(supplied.content).toString("utf8") !== content)
					)
						throw new Error(`Identity: source plan does not match resolved ${path}`);
					if (supplied) {
						if (
							supplied.expectedContent !== undefined &&
							(supplied.expectedContent === null
								? saved !== null
								: saved === null ||
									!Buffer.from(supplied.expectedContent).equals(Buffer.from(saved)))
						)
							throw new Error(`Identity: source plan baseline differs for ${path}`);
						supplied.expectedContent = saved;
						supplied.head = false;
					} else if (content !== saved) plan.push({ path, content, expectedContent: saved });
				}
				const directories: string[] = [...planOptions.createDirectories];
				for (const path of [".praxity", IDENTITY, `${IDENTITY}/snapshots`, `${IDENTITY}/lessons`]) {
					try {
						await resolveExistingPathWithin(root, join(root, path));
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
						directories.push(path);
					}
				}
				const add = (path: string, content: string, head = false) => {
					const previous = baseline.files.get(path);
					if (previous !== content)
						plan.push({ path, content, expectedContent: previous ?? null, head });
				};
				add(
					`${IDENTITY}/course.json`,
					required(files.get(`${IDENTITY}/course.json`), "course bytes"),
				);
				for (const [path, text] of files)
					if (path.startsWith(`${IDENTITY}/snapshots/`) && !baseline.files.has(path))
						add(path, text);
				for (const head of payload.identity.heads) {
					const { snapshot } = required(snapshotRecords.get(head.head), "head snapshot");
					const path = `${IDENTITY}/lessons/${snapshot.lessonId}.json`;
					add(path, required(files.get(path), "head bytes"), true);
				}
				// Immutable identity content is prepared before any authored source replacement.
				plan.sort(
					(a, b) =>
						Number(!a.path.startsWith(`${IDENTITY}/snapshots/`)) -
						Number(!b.path.startsWith(`${IDENTITY}/snapshots/`)),
				);
				assertUnchanged();
				const sourceError = identitySourceError(result, baseline.writtenLessons);
				if (sourceError) throw sourceError;
				if (retirements !== "confirmed") {
					const retired = identityWriteRetirements(result);
					if (retired.length) {
						let origin: "outside" | "draft" = "outside";
						if (
							!baseline.options.operations?.length &&
							[...baseline.sources].some(
								([file, source]) =>
									payload.lessons.has(file) &&
									source !== payload.lessons.get(file)?.tree.stream.source,
							)
						) {
							// Review concerns disk changes; a refused draft must not point to an empty gate.
							const diskSources = [...baseline.sources].filter(
								(entry): entry is [string, string] =>
									entry[1] !== null && baseline.options.lessonPaths.includes(entry[0]),
							);
							const disk = await resolveAdmittedCourseIdentity(
								root,
								{
									lessonPaths: baseline.options.lessonPaths.filter(
										(file) => baseline.sources.get(file) !== null,
									),
									sources: Object.fromEntries(diskSources),
									removedPaths: baseline.options.removedPaths,
								},
								undefined,
								undefined,
								baseline.files,
							);
							if (!identityWriteRetirements(disk).length) origin = "draft";
						}
						throw new IdentityRetirementError(retired, origin);
					}
				}
				await applyProjectFilePlan(root, plan, {
					...planOptions,
					createDirectories: [...new Set(directories)],
					onStep: async (step) => {
						await planOptions.onStep?.(step);
						assertUnchanged();
						await assertArtifactsUnchanged();
						// Deleted paths permit rename matching. Recheck through staging
						// and installation without creating their missing parent folders.
						await assertCompleteInventory(
							root,
							current.store,
							baseline.options.lessonPaths,
							baseline.options.removedPaths,
						);
					},
				});
				const committed = committedIdentityView(baseline.validatedIdentity);
				const byHash = new Map(
					committed.snapshots.map((snapshot) => [
						required(baseline.snapshotRecords.get(snapshot.lessonId), "installed snapshot").hash,
						snapshot,
					]),
				);
				const heads = [...committed.heads]
					.sort((a, b) => {
						const left = required(byHash.get(a.head), "installed head snapshot").lessonId;
						const right = required(byHash.get(b.head), "installed head snapshot").lessonId;
						return left < right ? -1 : left > right ? 1 : 0;
					})
					.map((head) => {
						const snapshot = required(byHash.get(head.head), "installed head snapshot");
						return parseLessonHead(
							required(
								files.get(`${IDENTITY}/lessons/${snapshot.lessonId}.json`),
								"installed head bytes",
							),
						);
					});
				// These exact private bytes passed schema/graph validation before
				// publication. Parsing only current heads preserves JSON values such
				// as 0 versus -0, including noncanonical immutable stored snapshots.
				const snapshots = heads.map(
					(head) =>
						JSON.parse(
							required(
								files.get(`${IDENTITY}/snapshots/${head.head}.json`),
								"installed snapshot bytes",
							),
						) as IdentitySnapshot,
				);
				const reservations = new Map(current.reservations);
				for (const snapshot of snapshots) {
					for (const [id, node] of Object.entries(snapshot.nodes)) {
						if (node.kind !== "page") continue;
						if (node.slug !== null && node.slug !== undefined)
							reserveSlug(reservations, node.slug, id);
						for (const alias of node.aliases ?? []) reserveSlug(reservations, alias, id);
					}
				}
				const installed: LoadedIdentityStore = {
					activeHistoryIds: new Set([
						...current.activeHistoryIds,
						...[
							...snapshots,
							...payload.operationSnapshots.map(
								({ canonical }) => JSON.parse(canonical) as IdentitySnapshot,
							),
						].flatMap((snapshot) =>
							Object.entries(snapshot.nodes)
								.filter(([id, node]) => isDurableIdentity(id, node, EMPTY_ID_HISTORY))
								.map(([id]) => id),
						),
					]),
					store: {
						course: parseCourseIdentity(
							required(files.get(`${IDENTITY}/course.json`), "installed course bytes"),
							baseline.options.expectedCourseId,
						),
						heads,
						snapshots,
					},
					files,
					fileHandles: new Map(),
					reservations,
					snapshotRecords: baseline.snapshotRecords,
				};
				await reclaimProtectedArchives(
					root,
					async (paths) =>
						!(await liveIdentityStoreIsIntact(root, paths, baseline.options, installed)),
				);
				const session = baseline.session;
				if (session && identitySessions.get(session.owner) === session.state) {
					// A replacement or watcher invalidation prevents installed state from being reused.
					const loaded = await loadStore(
						root,
						baseline.options,
						defaultStoreCache,
						undefined,
						installed,
					);
					if (sameFiles(loaded.files, files) && payload.identity.exportable) {
						session.state.retained = {
							// Retained store facts stay private to this module.
							loaded,
							lessonPaths: serializeIdentity(baseline.options.lessonPaths),
							reads: structuredClone(payload.lessons),
							committed,
						};
					} else session.state.retained = undefined;
				}
			},
			"write",
			false,
		),
	).catch((error: unknown) => {
		baseline.session?.owner.invalidate();
		defaultStoreCache.invalidate();
		throw error;
	});
	const correspondence =
		session && identitySessions.get(session.owner) === session.state
			? transitions.flatMap((transition) => transition?.commit() ?? [])
			: [];
	if (session && identitySessions.get(session.owner) === session.state) {
		const courseId = payload.identity.course.courseId;
		if (session.state.correspondence?.courseId !== courseId)
			session.state.correspondence = { courseId, ids: new Map() };
		for (const { runtimeId, durableId } of correspondence)
			session.state.correspondence.ids.set(runtimeId, durableId);
	}
	const savedHistory = new Set(baseline.readInput.activeHistoryIds);
	for (const snapshot of [...baseline.readInput.priorSnapshots, ...payload.identity.snapshots])
		for (const [id, node] of Object.entries(snapshot.nodes))
			if (isDurableIdentity(id, node, EMPTY_ID_HISTORY)) savedHistory.add(id);
	const durable = {
		identity: payload.identity,
		activeHistoryIds: new Set(savedHistory),
		correspondence,
		transientIds: false,
		writeResult,
		lessons: new Map(
			[...payload.lessons].map(([path, lesson]) => [
				path,
				{ ...lesson, transientIds: baseline.preservedLessons.has(path) },
			]),
		),
		ids: new Map(
			[...baseline.readerMappings].map(([path, known]) => [
				path,
				idProvider(path, new Map(known), baseline.preservedLessons.has(path)),
			]),
		),
	};
	baselines.set(durable, {
		...baseline,
		retirementInput: { ...installedInput, activeHistoryIds: savedHistory },
		retirementRecords: baseline.snapshotRecords,
		readInput: { ...baseline.readInput, activeHistoryIds: savedHistory },
		writeActive: undefined,
		files,
		persisted: true,
		sources: new Map(
			[...payload.lessons].map(([path, lesson]) => [path, lesson.tree.stream.source]),
		),
	});
	return durable;
}

function assertCandidateLifetime(result: ResolvedCourseIdentity): void {
	if (expiredCandidates.has(result) || baselines.get(result)?.writeActive?.() === false)
		throw new Error("Identity: write candidate admission expired");
}

/** Diagnostic labels never quote hidden self-check descendants. */
export function identityDiagnosticLabel(
	nodes: Readonly<Record<string, IdentityNode>>,
	id: string,
): string {
	const node = nodes[id];
	const seen = new Set<string>([id]);
	let ancestor = node;
	while (ancestor.parent !== null && !seen.has(ancestor.parent)) {
		seen.add(ancestor.parent);
		ancestor = nodes[ancestor.parent];
		if (ancestor.type === "self-check") return node.type;
	}
	return node.label || (node.type === "body" ? node.matchText.slice(0, 100) : "") || node.type;
}

function assertIdentitySourceValid(result: ResolvedCourseIdentity): void {
	const error = identitySourceError(result);
	if (error) throw error;
}

/** Hosts call this immediately before publication; inspect and preview keep drafts readable. */
export function assertIdentityExportable(
	result: ResolvedCourseIdentity,
	formatMessage?: (message: IdentityMessageRef) => string,
): void {
	const failures: string[] = [];
	const message = (reference: IdentityMessageRef, fallback: string) =>
		formatMessage?.(reference) ?? fallback;
	const baseline = baselines.get(result);
	if (!baseline || !matchesIssuedIdentity(baseline, result.identity))
		throw new Error("Identity: changed or unknown export resolution");
	assertIdentitySourceValid(result);
	assertDurableCandidate(result.identity);
	for (const [file, lesson] of result.lessons) {
		const head = result.identity.heads.find((head) => head.path === file);
		const resolvedSnapshot = result.identity.snapshots.find(
			(snapshot) => digest(serializeIdentity(snapshot)) === head?.head,
		);
		const headText =
			resolvedSnapshot &&
			baseline.files.get(`${IDENTITY}/lessons/${resolvedSnapshot.lessonId}.json`);
		const persistedHead = headText ? parseLessonHead(headText) : undefined;
		const snapshotText =
			persistedHead && baseline.files.get(`${IDENTITY}/snapshots/${persistedHead.head}.json`);
		const persisted = snapshotText
			? parseIdentitySnapshot(snapshotText, {
					courseId: result.identity.course.courseId,
					expectedHash: persistedHead?.head,
					digest,
				})
			: undefined;
		const authorOnlyAdditions = new Set(
			[...lesson.nodes]
				.filter(
					([id, record]) =>
						!persisted?.nodes[id] && AUTHOR_ONLY_READER_ROLES.has(record.role ?? ""),
				)
				.map(([id]) => id),
		);
		// An older store may lack author locators, but every persisted fact must still match.
		const persistedRevisionMatches =
			persisted &&
			resolvedSnapshot &&
			persistedHead?.path === file &&
			(!authorOnlyAdditions.size ||
				serializeIdentity(resolvedSnapshot.parents) === serializeIdentity([persistedHead.head])) &&
			serializeIdentity({
				...resolvedSnapshot,
				parents: authorOnlyAdditions.size ? persisted.parents : resolvedSnapshot.parents,
				nodes: Object.fromEntries(
					Object.entries(resolvedSnapshot.nodes).filter(([id]) => !authorOnlyAdditions.has(id)),
				),
			}) === serializeIdentity(persisted);
		const known = baseline.readerMappings.get(file);
		const provider = result.ids.get(file);
		let renderedRevisionMatches = false;
		if (persisted?.sourceHash === digest(lesson.tree.stream.source) && known) {
			renderedRevisionMatches =
				serializeIdentity([lesson.pages, lesson.blocks]) === baseline.readerProjections.get(file);
		}
		const badReaders = [...lesson.nodes].filter(
			([id, record]) =>
				id !== record.id ||
				known?.get(readerKey(record.node, record.role)) !== id ||
				(!persisted?.nodes[id] && !authorOnlyAdditions.has(id)) ||
				!result.identity.sourceMappings.some(
					(mapping) => mapping.file === file && mapping.id === id,
				) ||
				provider?.(record.node, record.role) !== id,
		);
		const identityNode = (record: LessonNodeRecord) =>
			resolvedSnapshot?.nodes[known?.get(readerKey(record.node, record.role)) ?? record.id];
		const badReader =
			badReaders.find(([, record]) => identityNode(record)?.kind === "block") ?? badReaders[0];
		if (
			!baseline.persisted ||
			!persisted ||
			!headText ||
			!persistedRevisionMatches ||
			persisted.sourceHash !== digest(lesson.tree.stream.source) ||
			result.transientIds ||
			lesson.transientIds ||
			provider?.transient !== false ||
			lesson.nodes.size !== known?.size ||
			badReader ||
			!renderedRevisionMatches
		) {
			const described = describeDocument({ path: file, tree: lesson.tree }, { readerRoles: true });
			const descriptor = (record: LessonNodeRecord) =>
				described.find(
					(node) =>
						!node.readerRole &&
						node.span.start === record.node.span.start &&
						node.span.end === record.node.span.end,
				);
			const record =
				badReaders.find(([, record]) => identityNode(record)?.kind === "block")?.[1] ??
				[...lesson.nodes.values()].find((record) => identityNode(record)?.kind === "block") ??
				[...lesson.nodes.values()].find((record) => descriptor(record)?.kind === "block") ??
				badReader?.[1] ??
				[...lesson.nodes.values()][0];
			const page =
				lesson.pages.find((page) => {
					const node = lesson.nodes.get(page.id);
					return (
						node &&
						record &&
						node.range.start <= record.range.start &&
						node.range.end >= record.range.end
					);
				}) ?? lesson.pages[0];
			const reference: IdentityMessageRef = {
				key: "desktop.identity.persistenceRequired",
				args: {
					file,
					page: page?.title ?? "Lesson metadata",
					block: record
						? (identityNode(record)?.type ??
							descriptor(record)?.type ??
							record.node.type ??
							record.node.kind)
						: "lesson",
				},
			};
			failures.push(
				message(
					reference,
					`${file}: page "${reference.args.page}", block ${reference.args.block}: persist the resolved identity and source before export; transient providers and unpersisted reader IDs cannot be published`,
				),
			);
		}
	}
	for (const snapshot of result.identity.snapshots) {
		const file =
			result.identity.heads.find((head) => head.head === digest(serializeIdentity(snapshot)))
				?.path ?? "lesson";
		for (const [id, node] of Object.entries(snapshot.nodes)) {
			if (node.status !== "pending") continue;
			let page = node;
			while (page.kind !== "page" && page.parent !== null) {
				page = snapshot.nodes[page.parent];
			}
			const label = identityDiagnosticLabel(snapshot.nodes, id);
			if (node.kind === "lesson" || node.kind === "page") {
				if (
					Object.values(snapshot.nodes).some(
						(child) =>
							child.status === "pending" && child.kind !== "lesson" && child.kind !== "page",
					)
				)
					continue;
			}
			const pageName =
				page.kind === "page"
					? page.label || page.slug || "Untitled page"
					: (result.lessons.get(file)?.pages[0]?.title ?? "Lesson metadata");
			failures.push(
				message(
					{
						key: "desktop.identity.pendingNode",
						args: {
							file,
							page: pageName,
							block: node.type,
							label,
						},
					},
					`${file}: page "${pageName}", block ${node.type} "${label}" is pending or invalid`,
				),
			);
		}
	}
	for (const [file, lesson] of result.lessons) {
		for (const error of lesson.errors.filter((error) => error.level === "error")) {
			const page = lesson.pages.find(
				(page) =>
					required(lesson.nodes.get(page.id), "page node").range.start <= error.start &&
					required(lesson.nodes.get(page.id), "page node").range.end >= error.end,
			);
			failures.push(
				message(
					{
						key: "desktop.identity.invalidNode",
						args: {
							file,
							page: page?.title ?? "Lesson metadata",
							block: error.blockType,
							line: error.line ?? 1,
						},
					},
					`${file}: page "${page?.title ?? "Lesson metadata"}", block ${error.blockType} at line ${error.line} is invalid`,
				),
			);
		}
	}
	if (failures.length) {
		const initialization = identityInitialization(result);
		const reference: IdentityMessageRef = {
			key: "desktop.identity.exportRefused",
			args: { details: failures.join("; ") },
		};
		throw new IdentityStoreError(
			reference,
			message(reference, `Identity: export refused. ${failures.join("; ")}`),
			undefined,
			{
				rederive:
					initialization.rederive &&
					(!initialization.pending ||
						(initialization.unmatched && !initialization.pending.copyCountDropped)),
				added: newIdentityBlocks(result, initialization.prior),
				retired: identityRetirements(result),
				...(initialization.pending ? { pending: initialization.pending } : {}),
			},
		);
	}
}
