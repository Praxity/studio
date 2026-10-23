import { buildSlugMap, pageSlug } from "@praxity/content-model";
import { isDisplayNodeId, isIdentityNodeId, isRuntimeNodeId } from "@praxity/content-model/types";
import { describeDocument, serializeIdentity } from "./canonical.ts";
import {
	assertHash,
	assertId,
	assertLegacyIdentitySnapshot,
	assertPath,
	assertSnapshotNamespace,
	hashIdentitySnapshot,
	parseCourseIdentity,
	parseIdentityReadSnapshot,
	parseIdentitySnapshot,
	parseLessonHead,
} from "./files.ts";
import { invertIdentityMapping } from "./mappings.ts";
import { identityKey, matchSimilar } from "./reconcile.ts";
import type {
	CanonicalDescriptor,
	IdentityDependencies,
	IdentityMapping,
	IdentityNode,
	IdentityOperation,
	IdentityReadView,
	IdentityResolution,
	IdentitySnapshot,
	IdentityStatus,
	ParsedDocument,
	ResolveIdentityInput,
	UnresolvedIdentity,
} from "./types.ts";

function fail(message: string): never {
	throw new Error(`Identity: ${message}`);
}
const location = (file: string, path: readonly number[]) => `${file}:${path.join("/")}`;
const isBelow = (child: CanonicalDescriptor, parent: CanonicalDescriptor) =>
	child.file === parent.file &&
	child.path.length > parent.path.length &&
	parent.path.every((part, index) => child.path[index] === part);
function bucket<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const value of values) {
		const k = key(value);
		const group = groups.get(k) ?? [];
		group.push(value);
		groups.set(k, group);
	}
	return groups;
}

const projection = (node: IdentityNode) => Number(node.type.startsWith("reader-role:"));
const siblingOrder = (a: IdentityNode, b: IdentityNode) =>
	projection(a) - projection(b) || a.order - b.order;
const competingOrders = (siblings: IdentityNode[]) =>
	siblings.some((node, i) => i > 0 && siblingOrder(node, siblings[i - 1]) === 0);

interface RetainedIdentity {
	prior: IdentitySnapshot[];
	course: IdentityResolution["course"];
	hashes: Map<IdentitySnapshot, string>;
	documents: Map<string, { source: string; descriptors: CanonicalDescriptor[] }>;
	bindings: Map<string, string>;
	keys: WeakMap<IdentityNode | CanonicalDescriptor, string>;
}

interface PreparedResolution {
	descriptors: CanonicalDescriptor[];
	snapshots: { text: string; hash: string }[];
}

/** One plan owns its inputs. Nothing is retained between operations or file admissions. */
export function createIdentityPlan(
	input: Omit<ResolveIdentityInput, "parsedDocuments" | "operations">,
	dependencies: IdentityDependencies,
) {
	const captured = structuredClone(input);
	const hooks = { ...dependencies };
	const snapshots = captured.priorSnapshots.map((snapshot) => {
		const { canonical, hash } = hashIdentitySnapshot(snapshot, hooks.digest.bind(hooks));
		return { text: canonical, hash };
	});
	const sourceHashes = new Map(
		snapshots.map((record, index) => [record.hash, captured.priorSnapshots[index].sourceHash]),
	);
	return {
		sourceHash(snapshotHash: string | undefined): string | undefined {
			return snapshotHash === undefined ? undefined : sourceHashes.get(snapshotHash);
		},
		prepare(parsedDocuments: readonly ParsedDocument[]) {
			const documents = structuredClone(parsedDocuments);
			const descriptors = documents.flatMap((document) =>
				describeDocument(document, {
					readerRoles: captured.readerRoles,
					priorSnapshots: captured.priorSnapshots,
				}),
			);
			return {
				// Callers own their copies; only this closure can supply prepared evidence to I1.
				descriptors: structuredClone(descriptors),
				resolve(operations: readonly IdentityOperation[]): IdentityResolution {
					return resolve(
						{ ...captured, parsedDocuments: documents, operations: structuredClone(operations) },
						hooks,
						undefined,
						{ descriptors, snapshots },
					);
				},
			};
		},
	};
}

/** All decisions stay in memory. Hosts own reads, writes, locks and transaction durability. */
export function resolveIdentity(
	input: ResolveIdentityInput,
	dependencies: IdentityDependencies,
): IdentityResolution {
	return resolve(input, dependencies);
}

function unchangedMapping(id: string): IdentityMapping {
	return { oldId: id, newId: id, fate: "kept" };
}

/** Never-active records carry no learner history. Consumer metadata still protects an ID. */
export function isDurableIdentity(
	id: string,
	node: IdentityNode,
	activeHistoryIds?: ReadonlySet<string>,
): boolean {
	return (
		activeHistoryIds === undefined ||
		node.status === "active" ||
		activeHistoryIds.has(id) ||
		node.consumerRevisions !== undefined
	);
}

/** I4 may retain this view only after proving the complete committed store and sources.
 * Recorded operation fates describe the previous edit, not a later unchanged admission.
 */
export function committedIdentityView(identity: IdentityResolution): IdentityResolution {
	const result = structuredClone(identity);
	result.mapping = result.sourceMappings.map(({ id }) => unchangedMapping(id));
	result.inverseMapping = invertIdentityMapping(result.mapping);
	result.exportIds = result.sourceMappings.map(({ id }) => id);
	return result;
}

/** Retain validated evidence privately. Callers still supply the complete document inventory. */
export function createIdentityResolver(
	input: ResolveIdentityInput,
	dependencies: IdentityDependencies,
) {
	dependencies = { ...dependencies };
	const captured = structuredClone(input);
	const initial = resolve(captured, dependencies);
	const hashes = new Map(
		captured.priorSnapshots.map((s) => [s, dependencies.digest(serializeIdentity(s))]),
	);
	const priorHashes = new Set(hashes.values());
	const heads = new Map(captured.priorHeads?.map((h) => [h.path, h.head]));
	// Pending or changed baseline records do not prove that an untouched head stays fixed.
	const stable =
		!captured.operations?.length &&
		!captured.mergeBase?.length &&
		initial.exportable &&
		heads.size === captured.parsedDocuments.length &&
		initial.heads.every((h) => heads.get(h.path) === h.head) &&
		initial.snapshots.length === captured.priorSnapshots.length &&
		initial.snapshots.every((s) => priorHashes.has(dependencies.digest(serializeIdentity(s))));
	const retained: RetainedIdentity | undefined = stable
		? {
				prior: [...captured.priorSnapshots],
				course: structuredClone(initial.course),
				hashes,
				documents: new Map(
					captured.parsedDocuments.map((doc) => [
						doc.path,
						{
							source: doc.tree.stream.source,
							descriptors: describeDocument(doc, {
								readerRoles: captured.readerRoles,
								priorSnapshots: captured.priorSnapshots,
							}),
						},
					]),
				),
				bindings: new Map(initial.sourceMappings.map((m) => [location(m.file, m.path), m.id])),
				keys: new WeakMap(),
			}
		: undefined;
	return {
		initial,
		resolve(parsedDocuments: readonly ParsedDocument[]): IdentityResolution {
			const sameInventory =
				retained &&
				parsedDocuments.length === retained.documents.size &&
				parsedDocuments.every((doc) => retained.documents.has(doc.path));
			return resolve(
				{ ...captured, parsedDocuments },
				dependencies,
				sameInventory ? retained : undefined,
			);
		},
	};
}

export function assertDurableCandidate(value: IdentityResolution): void {
	const check = (id: string | null | undefined) => {
		if (id !== null && !isIdentityNodeId(id)) fail("candidate contains non-durable ID");
	};
	check(value.course.courseId);
	for (const snapshot of value.snapshots) {
		assertLegacyIdentitySnapshot(snapshot);
		check(snapshot.courseId);
		check(snapshot.lessonId);
		for (const [id, node] of Object.entries(snapshot.nodes)) {
			check(id);
			check(node.parent);
			for (const ancestor of node.lineage) check(ancestor);
		}
	}
	for (const mapping of [...value.mapping, ...value.inverseMapping]) {
		check(mapping.oldId);
		check(mapping.newId);
	}
	for (const mapping of value.sourceMappings) check(mapping.id);
	for (const unresolved of value.unresolved) {
		check(unresolved.id);
		for (const candidate of unresolved.candidates) check(candidate);
	}
	for (const id of value.exportIds) check(id);
}

/** Hosts admit bytes before each call and revoke this session on admission errors. */
export function createIdentityReadSession(
	dependencies: IdentityDependencies,
	reservedRuntimeIds: () => Iterable<string> = () => [],
) {
	const hooks = { ...dependencies };
	let previous:
		| {
				view: IdentityReadView;
				snapshots: IdentitySnapshot[];
				heads: IdentityResolution["heads"];
				sources: Map<string, string>;
				candidateBindings: Map<string, string>;
				provisionalNamespace: boolean;
				candidateCourse: IdentityResolution["course"];
		  }
		| undefined;
	let disposed = false;
	let generation = 0;
	function resolveRead(
		input: ResolveIdentityInput,
		write?: { before?: IdentityResolution; identity: IdentityResolution },
	): {
		candidate: IdentityResolution;
		view: IdentityReadView;
	} {
		if (disposed) fail("read session disposed");
		const epoch = ++generation;
		try {
			const captured = structuredClone(input);
			// An absent store has one provisional course namespace until the host installs it.
			const provisionalNamespace = !captured.course && !captured.priorSnapshots.length;
			if (provisionalNamespace && previous?.provisionalNamespace)
				captured.course = previous.candidateCourse;
			const candidate = write?.identity ?? resolve(captured, hooks);
			const runtimeCourse =
				write && previous?.provisionalNamespace ? previous.view.course.courseId : undefined;
			if (write && previous) {
				if (write.before) assertDurableCandidate(write.before);
				assertDurableCandidate(candidate);
				// The admitted pre-write source proves these locations describe the same nodes.
				const shown = new Map(
					previous.view.sourceMappings.map((m) => [location(m.file, m.path), m.id]),
				);
				for (const head of write.before?.heads ?? []) {
					const snapshot = write.before?.snapshots.find(
						(s) => hooks.digest(serializeIdentity(s)) === head.head,
					);
					if (
						!snapshot ||
						hooks.digest(previous.sources.get(head.path) ?? "") !== snapshot.sourceHash
					)
						fail("write correspondence has no admitted source");
				}
				const candidateBindings = new Map(
					(write.before?.sourceMappings ?? []).map((m) => [
						m.id,
						shown.get(location(m.file, m.path)) as string,
					]),
				);
				previous = { ...previous, candidateBindings, candidateCourse: candidate.course };
			}
			if (previous?.candidateCourse.courseId !== candidate.course.courseId) previous = undefined;
			const stored = new Set(captured.priorSnapshots.flatMap((s) => Object.keys(s.nodes)));
			const descriptors = captured.parsedDocuments.flatMap((document) =>
				describeDocument(document, {
					readerRoles: captured.readerRoles,
					priorSnapshots: captured.priorSnapshots,
				}),
			);
			const fresh = new Set<string>();
			for (const operation of captured.operations ?? []) {
				for (const placement of operation.placements) {
					const fate = operation.mapping[placement.mappingIndex]?.fate;
					if (
						fate !== "new" &&
						fate !== "copied" &&
						!(fate === "pending" && operation.mapping[placement.mappingIndex].oldId === null)
					)
						continue;
					for (const d of descriptors)
						if (d.file === placement.file && placement.path.every((part, i) => d.path[i] === part))
							fresh.add(location(d.file, d.path));
				}
			}
			// These graphs exist only for matching the last read. They never feed the candidate.
			const matched = previous
				? resolve(
						{
							...captured,
							course: previous.view.course,
							priorSnapshots: previous.snapshots,
							priorHeads: previous.heads,
							operations: undefined,
							mergeBase: undefined,
						},
						hooks,
						undefined,
						undefined,
						fresh,
						true,
					)
				: undefined;
			const matchedLocations = new Map(
				matched?.sourceMappings.map((m) => [location(m.file, m.path), m]),
			);
			const priorRuntime = new Set(previous?.view.runtimeIds);
			const priorLocations = new Map(
				previous?.view.sourceMappings.map((m) => [location(m.file, m.path), m]),
			);
			const unchangedFiles = new Set(
				captured.parsedDocuments
					.filter((doc) => previous?.sources.get(doc.path) === doc.tree.stream.source)
					.map((doc) => doc.path),
			);
			const used = new Set([
				candidate.course.courseId,
				...stored,
				...candidate.snapshots.flatMap((s) => Object.keys(s.nodes)),
				...Object.keys(previous?.view.nodes ?? {}),
				...(previous ? [previous.view.course.courseId] : []),
			]);
			const reserved = new Set(reservedRuntimeIds());
			const allocateRuntime = () => {
				let id: string;
				do {
					if (hooks.allocateRuntimeId) id = hooks.allocateRuntimeId();
					else {
						const entropy = hooks.allocateId();
						assertId(entropy);
						id = `rt-${entropy.replaceAll("-", "").toLowerCase()}`;
					}
					if (!isRuntimeNodeId(id)) fail("invalid allocated runtime ID");
					if (used.has(id)) fail("duplicate allocated read ID");
					used.add(id);
					// A held author snapshot still uses this retired locator.
				} while (reserved.has(id));
				return id;
			};
			const bindings = new Map<string, string>();
			const claimed = new Set<string>();
			const operationContinuations = new Map<string, string>();
			for (const operation of captured.operations ?? [])
				for (const mapping of operation.mapping) {
					if (!mapping.oldId || !mapping.newId || !["kept", "survivor"].includes(mapping.fate))
						continue;
					const id = previous?.candidateBindings.get(mapping.oldId);
					if (id && priorRuntime.has(id)) operationContinuations.set(mapping.newId, id);
				}
			const correspondence: IdentityReadView["correspondence"] = [];
			for (const m of candidate.sourceMappings) {
				const match = matchedLocations.get(location(m.file, m.path));
				const same =
					unchangedFiles.has(m.file) && !fresh.has(location(m.file, m.path))
						? priorLocations.get(location(m.file, m.path))
						: undefined;
				const admitted = stored.has(m.id) ? previous?.candidateBindings.get(m.id) : undefined;
				const runtimeId =
					operationContinuations.get(m.id) ??
					(admitted && priorRuntime.has(admitted)
						? admitted
						: same && priorRuntime.has(same.id)
							? same.id
							: match?.status === "active" && priorRuntime.has(match.id)
								? match.id
								: undefined);
				let id = m.id;
				if (stored.has(id)) {
					if (runtimeId) correspondence.push({ runtimeId, durableId: id });
				} else if (runtimeId) id = runtimeId;
				else {
					id = allocateRuntime();
				}
				if (claimed.has(id)) fail("duplicate read identity claim");
				claimed.add(id);
				bindings.set(m.id, id);
			}
			const nodes: IdentityReadView["nodes"] = {};
			const candidateNodes = new Map(candidate.snapshots.flatMap((s) => Object.entries(s.nodes)));
			const runtimeAmbiguities = new Map(
				matched?.unresolved
					.filter((u) => u.path !== null && u.reason === "duplicate")
					.map((u) => [location(u.file, u.path as number[]), u]),
			);
			const sourceMappings = candidate.sourceMappings.map((m) => {
				const id = bindings.get(m.id) as string;
				const node = structuredClone(candidateNodes.get(m.id) as IdentityNode);
				if (node.parent !== null) {
					const parent = bindings.get(node.parent);
					if (!parent) fail("read parent missing");
					node.parent = parent;
				}
				nodes[id] = node;
				if (!stored.has(m.id) && runtimeAmbiguities.has(location(m.file, m.path)))
					node.status = "pending";
				return { ...structuredClone(m), id, status: node.status as "active" | "pending" };
			});
			const view: IdentityReadView = {
				kind: "runtime-read",
				course: {
					...candidate.course,
					courseId: provisionalNamespace
						? (previous?.view.course.courseId ?? allocateRuntime())
						: candidate.course.courseId,
				},
				sourceMappings,
				nodes,
				lessons: candidate.heads.map((head) => {
					const root = sourceMappings.find((m) => m.file === head.path && !m.path.length);
					if (!root) fail("read lesson missing");
					const candidateRoot = candidate.sourceMappings.find(
						(m) => m.file === head.path && !m.path.length,
					);
					const snapshot = candidate.snapshots.find((s) => s.lessonId === candidateRoot?.id);
					if (!snapshot) fail("read source hash missing");
					return { file: head.path, lessonId: root.id, sourceHash: snapshot.sourceHash };
				}),
				runtimeIds: sourceMappings.filter((m) => !stored.has(m.id)).map((m) => m.id),
				unresolved: candidate.unresolved.map((u) => ({
					...structuredClone(u),
					id: bindings.get(u.id) ?? u.id,
				})),
				correspondence,
			};
			if (runtimeCourse)
				correspondence.push({ runtimeId: runtimeCourse, durableId: candidate.course.courseId });
			// Retired nodes received UUIDs in this write too; operation fates handle their removal.
			const corresponded = new Set(correspondence.map((pair) => pair.runtimeId));
			if (write?.before)
				for (const [durableId, runtimeId] of previous?.candidateBindings ?? [])
					if (priorRuntime.has(runtimeId) && stored.has(durableId) && !corresponded.has(runtimeId))
						correspondence.push({ runtimeId, durableId });
			for (const m of view.sourceMappings) {
				const ambiguity = runtimeAmbiguities.get(location(m.file, m.path));
				if (
					ambiguity &&
					view.runtimeIds.includes(m.id) &&
					!view.unresolved.some((u) => u.id === m.id)
				)
					view.unresolved.push({ ...ambiguity, id: m.id });
			}
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
			const retainedRead = structuredClone({
				view,
				snapshots,
				candidateBindings: bindings,
				provisionalNamespace,
				candidateCourse: candidate.course,
				sources: new Map(captured.parsedDocuments.map((doc) => [doc.path, doc.tree.stream.source])),
				heads: view.lessons.map((lesson, i) => ({
					schema: 1 as const,
					path: lesson.file,
					head: hooks.digest(serializeIdentity(snapshots[i])),
				})),
			});
			if (disposed || epoch !== generation) fail("read session revoked");
			previous = retainedRead;
			return { candidate, view };
		} catch (error) {
			if (epoch === generation) previous = undefined;
			throw error;
		}
	}
	return {
		invalidate() {
			generation++;
			previous = undefined;
		},
		dispose() {
			generation++;
			disposed = true;
			previous = undefined;
		},
		resolve: resolveRead,
		/** Prepare under the write admission; publish only after installing these exact bytes. */
		prepareWrite(
			input: ResolveIdentityInput,
			before: IdentityResolution | undefined,
			identity: IdentityResolution,
		) {
			if (
				!previous ||
				(!previous.provisionalNamespace &&
					previous.candidateCourse.courseId !== identity.course.courseId)
			)
				return { commit: () => [] as IdentityReadView["correspondence"] };
			const saved = previous;
			const epoch = generation;
			try {
				const { view } = resolveRead(input, { before, identity });
				const installed = previous;
				return {
					commit(): IdentityReadView["correspondence"] {
						if (disposed || generation !== epoch) return [];
						generation++;
						previous = installed;
						return structuredClone(view.correspondence);
					},
				};
			} finally {
				if (!disposed && generation === epoch + 1) {
					previous = saved;
					generation = epoch;
				}
			}
		},
	};
}

function resolve(
	input: ResolveIdentityInput,
	dependencies: IdentityDependencies,
	retained?: RetainedIdentity,
	prepared?: PreparedResolution,
	freshLocations?: ReadonlySet<string>,
	displayIds = false,
): IdentityResolution {
	for (const snapshot of [...input.priorSnapshots, ...(input.mergeBase ?? [])])
		assertLegacyIdentitySnapshot(snapshot);
	// Only the private continuation call admits the session's own display graph.
	const parseSnapshot = displayIds ? parseIdentityReadSnapshot : parseIdentitySnapshot;
	const exactKey = (node: IdentityNode | CanonicalDescriptor) => {
		if (!retained) return identityKey(node);
		let key = retained.keys.get(node);
		if (key === undefined) {
			key = identityKey(node);
			retained.keys.set(node, key);
		}
		return key;
	};
	const hash = (text: string) => {
		const value = dependencies.digest(text);
		assertHash(value);
		return value;
	};
	const snapshotRecords =
		prepared?.snapshots ??
		(retained
			? []
			: input.priorSnapshots.map((snapshot) => {
					const record = hashIdentitySnapshot(snapshot, hash);
					return { text: record.canonical, hash: record.hash };
				}));
	const prior =
		retained?.prior ??
		snapshotRecords.map((record) => parseSnapshot(record.text, { digest: hash }));
	const priorHashes = new Map(
		retained
			? []
			: prior.map((snapshot, index) => [snapshot, snapshotRecords[index].hash] as const),
	);
	const snapshotHash = (snapshot: IdentitySnapshot) =>
		retained?.hashes.get(snapshot) ??
		priorHashes.get(snapshot) ??
		hashIdentitySnapshot(snapshot, hash).hash;
	const course = retained
		? { ...retained.course }
		: input.course
			? displayIds
				? { ...input.course }
				: parseCourseIdentity(serializeIdentity(input.course))
			: {
					schema: 1 as const,
					courseId: prior[0]?.courseId ?? dependencies.allocateId(),
				};
	if (displayIds) {
		if (!isDisplayNodeId(course.courseId)) fail("invalid display ID");
	} else assertId(course.courseId);
	for (const snapshot of retained ? [] : prior) {
		if (displayIds) {
			if (snapshot.courseId !== course.courseId) fail("namespace mismatch");
		} else assertSnapshotNamespace(snapshot, { courseId: course.courseId });
	}
	for (const snapshot of retained ? [] : (input.mergeBase ?? []))
		parseSnapshot(serializeIdentity(snapshot), { courseId: course.courseId, digest: hash });
	const usedIds = new Set<string>([course.courseId]);
	const old = new Map<string, { node: IdentityNode; snapshot: IdentitySnapshot }>();
	const lessonSnapshots = new Map<string, IdentitySnapshot>();
	const byHash = new Map<string, IdentitySnapshot>();
	for (const snapshot of prior) {
		if (lessonSnapshots.has(snapshot.lessonId))
			fail("competing lesson snapshots require identity merge");
		lessonSnapshots.set(snapshot.lessonId, snapshot);
		byHash.set(snapshotHash(snapshot), snapshot);
		for (const [id, node] of Object.entries(snapshot.nodes)) {
			const previous = old.get(id);
			if (
				id === course.courseId ||
				(previous && previous.node.status !== "retired" && node.status !== "retired")
			)
				fail("duplicate active ID in course namespace");
			if (!previous || node.status !== "retired") old.set(id, { node, snapshot });
			usedIds.add(id);
		}
	}
	const allocate = () => {
		const id = dependencies.allocateId();
		assertId(id);
		if (usedIds.has(id)) fail("duplicate allocated ID");
		usedIds.add(id);
		return id;
	};
	const provisional = new Set(
		[...old]
			.filter(
				([id, { node }]) =>
					node.status === "pending" && !isDurableIdentity(id, node, input.activeHistoryIds),
			)
			.map(([id]) => id),
	);
	const priorByPath = new Map<string, IdentitySnapshot>();
	for (const head of input.priorHeads ?? []) {
		parseLessonHead(serializeIdentity(head));
		const snapshot = byHash.get(head.head);
		if (!snapshot) fail("head snapshot hash unavailable");
		if (
			priorByPath.has(head.path) ||
			[...priorByPath.values()].some((s) => s.lessonId === snapshot.lessonId)
		)
			fail("duplicate lesson head");
		priorByPath.set(head.path, snapshot);
	}
	if (input.priorHeads && priorByPath.size !== prior.length) fail("missing lesson heads");
	const documents = new Map(input.parsedDocuments.map((doc) => [doc.path, doc]));
	if (documents.size !== input.parsedDocuments.length) fail("duplicate parsed document path");
	for (const document of documents.values()) {
		assertPath(document.path);
		if (/^(?:<{7}|={7}|>{7}|\|{7})(?:\s|$)/mu.test(document.tree.stream.source))
			fail("source conflict markers");
	}
	const unchanged = new Set<string>();
	const descriptors =
		prepared?.descriptors ??
		input.parsedDocuments.flatMap((document) => {
			const saved = retained?.documents.get(document.path);
			if (saved?.source === document.tree.stream.source) {
				unchanged.add(document.path);
				return saved.descriptors;
			}
			return describeDocument(document, { readerRoles: input.readerRoles, priorSnapshots: prior });
		});
	const byLocation = new Map(descriptors.map((d) => [location(d.file, d.path), d]));
	const bindings = new Map<CanonicalDescriptor, string>();
	const ordinalBindings = new Set<CanonicalDescriptor>();
	const equalCountBindings = new Set<CanonicalDescriptor>();
	const consumed = new Set<string>();
	const explicit = new Map<CanonicalDescriptor, IdentityMapping>();
	const terminal = new Map<string, IdentityStatus>();
	const fresh = new Set(descriptors.filter((d) => freshLocations?.has(location(d.file, d.path))));
	const copiedFrom = new Map<CanonicalDescriptor, string>();
	const maps: IdentityMapping[] = [];
	const unresolved: UnresolvedIdentity[] = [];
	const bind = (descriptor: CanonicalDescriptor, id: string) => {
		if (bindings.has(descriptor) || [...bindings.values()].includes(id))
			fail("duplicate identity claim");
		bindings.set(descriptor, id);
		consumed.add(id);
	};
	const descendants = (id: string): string[] => {
		const result = [id];
		for (let i = 0; i < result.length; i++)
			for (const [childId, entry] of old) if (entry.node.parent === result[i]) result.push(childId);
		return result;
	};
	const claimedOld = new Set<string>();
	for (const operation of input.operations ?? []) {
		if (
			![
				"modify",
				"replace",
				"copy",
				"move",
				"split",
				"merge",
				"insert",
				"delete",
				"convert",
			].includes(operation.intent)
		)
			fail("unknown operation intent");
		const files = new Map(operation.files.map((f) => [f.path, f]));
		if (files.size !== operation.files.length) fail("duplicate operation file");
		for (const file of files.values()) {
			assertPath(file.path);
			assertHash(file.fromRevision);
			assertHash(file.toRevision);
			assertHash(file.fromSnapshot);
			const snapshot = byHash.get(file.fromSnapshot);
			if (!snapshot) fail("operation snapshot revision mismatch");
			if (priorByPath.has(file.path) && priorByPath.get(file.path) !== snapshot)
				fail("operation snapshot path mismatch");
			if (
				snapshot.sourceHash !== file.fromRevision ||
				hash(documents.get(file.path)?.tree.stream.source ?? "") !== file.toRevision
			)
				fail("operation source revision mismatch");
		}
		const placements = new Map(operation.placements.map((p) => [p.mappingIndex, p]));
		if (placements.size !== operation.placements.length) fail("duplicate operation placement");
		for (const p of placements.values()) {
			if (
				!Number.isSafeInteger(p.mappingIndex) ||
				p.mappingIndex < 0 ||
				p.mappingIndex >= operation.mapping.length ||
				p.path.some((i) => !Number.isSafeInteger(i) || i < 0)
			)
				fail("invalid placement");
		}
		operation.mapping.forEach((mapping, index) => {
			const map = { ...mapping };
			if (map.oldId !== null) {
				assertId(map.oldId);
				const entry = old.get(map.oldId);
				if (!entry) fail("unknown mapped old ID");
				if (!operation.inverse && entry.node.status === "retired" && map.fate !== "copied")
					fail("retired identity requires a recorded inverse");
				if (
					!operation.files.some(
						(f) => byHash.get(f.fromSnapshot)?.lessonId === entry.snapshot.lessonId,
					)
				)
					fail("mapped ID outside operation snapshots");
				if (map.fate !== "copied") {
					if (claimedOld.has(map.oldId)) fail("duplicate old identity claim");
					claimedOld.add(map.oldId);
				}
			}
			if (
				!["kept", "new", "retired", "pending", "survivor", "absorbed", "copied", "cut"].includes(
					map.fate,
				)
			)
				fail("unknown identity fate");
			if (!operation.inverse) {
				const allowed = {
					modify: ["kept", "new", "retired", "pending"],
					replace: ["new", "retired", "pending"],
					copy: ["copied", "new", "pending"],
					move: ["kept", "pending"],
					split: ["survivor", "kept", "new", "retired", "pending"],
					merge: ["survivor", "absorbed", "kept", "new", "retired", "pending"],
					insert: ["new", "pending"],
					delete: ["retired", "cut", "pending"],
					convert: ["kept", "new", "retired", "pending"],
				};
				if (!allowed[operation.intent].includes(map.fate))
					fail("fate incompatible with operation intent");
			}
			if (["kept", "survivor"].includes(map.fate) && (!map.oldId || map.newId !== map.oldId))
				fail("continuing fate must keep the old ID");
			if (["retired", "cut"].includes(map.fate) && (!map.oldId || map.newId !== null))
				fail("removed fate requires an old ID and no result ID");
			if (map.fate === "absorbed" && (!map.oldId || !map.newId || map.oldId === map.newId))
				fail("absorption requires a distinct survivor");
			if (map.fate === "new" && map.oldId !== null) fail("new fate cannot claim an old identity");
			if (map.fate === "copied" && !map.oldId) fail("copied fate requires a donor");
			const placement = placements.get(index);
			const descriptor = placement
				? byLocation.get(location(placement.file, placement.path))
				: undefined;
			if (placement && (!descriptor || !files.has(placement.file)))
				fail("placement outside operation files or parse");
			if (["retired", "absorbed", "cut"].includes(map.fate)) {
				if (placement) fail("removed fate has a placement");
				for (const id of descendants(map.oldId as string))
					terminal.set(id, map.fate === "cut" ? "cut" : "retired");
			} else if (map.fate === "pending" && !descriptor) {
				if (!map.oldId || (map.newId !== null && map.newId !== map.oldId))
					fail("pending fate without a prior identity");
				for (const id of descendants(map.oldId)) terminal.set(id, "pending");
			} else {
				if (!descriptor) fail("result mapping needs a placement");
				if (
					map.fate === "new" ||
					map.fate === "copied" ||
					(map.fate === "pending" && map.oldId === null)
				) {
					if (map.newId === null) map.newId = allocate();
					else {
						assertId(map.newId);
						if (
							usedIds.has(map.newId) &&
							!(operation.inverse && old.get(map.newId)?.node.status !== "active")
						)
							fail("duplicate or reused fresh ID");
						usedIds.add(map.newId);
					}
					fresh.add(descriptor);
					for (const child of descriptors.filter((d) => isBelow(d, descriptor))) fresh.add(child);
					if (map.fate === "copied") copiedFrom.set(descriptor, map.oldId as string);
				}
				if (!map.newId) fail("result fate requires an ID");
				assertId(map.newId);
				bind(descriptor, map.newId);
				explicit.set(descriptor, map);
				terminal.delete(map.newId);
			}
			maps.push(map);
		});
		for (const map of operation.mapping)
			if (
				map.fate === "absorbed" &&
				!operation.mapping.some(
					(m) => m.oldId === map.newId && (m.fate === "survivor" || m.fate === "kept"),
				)
			)
				fail("absorbed ID has no chosen survivor");
	}
	// Surrounding placement evidence cannot promote a never-active copy over its donor.
	for (const [descriptor, id] of bindings) {
		if (!provisional.has(id)) continue;
		bindings.delete(descriptor);
		consumed.delete(id);
		const mapping = explicit.get(descriptor);
		explicit.delete(descriptor);
		if (mapping) maps.splice(maps.indexOf(mapping), 1);
	}
	// Copy evidence authorizes the donor's ordered subtree. No external ordinal matching.
	for (const [root, donorId] of [...copiedFrom]) {
		const donorFor = new Map<string, string>([[location(root.file, root.path), donorId]]);
		for (const child of descriptors.filter((d) => isBelow(d, root))) {
			if (!child.parentPath) continue;
			const parentId = donorFor.get(location(child.file, child.parentPath));
			const donor = [...old].find(
				([, entry]) =>
					entry.node.parent === parentId &&
					entry.node.order === child.order &&
					exactKey(entry.node) === exactKey(child),
			);
			if (donor) {
				copiedFrom.set(child, donor[0]);
				donorFor.set(location(child.file, child.path), donor[0]);
			}
		}
	}
	// A mapped fresh subtree never steals an exact identity from its original.
	const resumesCut = (node: IdentityNode) => {
		let parent = node.parent;
		while (parent) {
			if ([...explicit.values()].some((map) => map.oldId === parent && map.fate === "kept"))
				return true;
			parent = old.get(parent)?.node.parent ?? null;
		}
		return false;
	};
	const matchableOld = () =>
		[...old].filter(
			([id, entry]) =>
				!provisional.has(id) &&
				!terminal.has(id) &&
				(entry.node.status === "active" ||
					entry.node.status === "pending" ||
					(entry.node.status === "cut" && resumesCut(entry.node))),
		);
	const eligibleOld = () => matchableOld().filter(([id]) => !consumed.has(id));
	const eligibleNew = () => descriptors.filter((d) => !bindings.has(d) && !fresh.has(d));
	const savedOrder = (a: IdentityNode, b: IdentityNode) =>
		a.span.start - b.span.start || a.order - b.order || a.span.end - b.span.end;
	// Lesson head path is namespace evidence, not a positional content identity.
	for (const d of descriptors.filter((d) => d.kind === "lesson" && !bindings.has(d))) {
		const priorLesson = priorByPath.get(d.file);
		if (
			priorLesson &&
			["active", "pending"].includes(priorLesson.nodes[priorLesson.lessonId].status) &&
			!terminal.has(priorLesson.lessonId) &&
			!consumed.has(priorLesson.lessonId)
		)
			bind(d, priorLesson.lessonId);
	}
	for (const root of descriptors.filter(
		(d) => d.kind === "lesson" && !bindings.has(d) && !priorByPath.has(d.file),
	)) {
		const sourceHash = hash((documents.get(root.file) as ParsedDocument).tree.stream.source);
		if (![...priorByPath].some(([file, s]) => documents.has(file) && s.sourceHash === sourceHash))
			continue;
		// Keeping the old path proves a whole-file copy, even when the original was
		// edited concurrently. Its descendants cannot compete for the original IDs.
		fresh.add(root);
		for (const child of descriptors.filter((d) => isBelow(d, root))) fresh.add(child);
	}
	// Whole-source evidence distinguishes simultaneous renames with identical metadata.
	// A donor path still in the complete inventory is a copy, never a rename.
	const renameDonors = bucket(
		[...priorByPath].filter(
			([file, s]) =>
				!documents.has(file) &&
				!consumed.has(s.lessonId) &&
				s.nodes[s.lessonId].status === "active",
		),
		([, s]) => s.sourceHash,
	);
	const renameTargets = bucket(
		descriptors.filter((d) => d.kind === "lesson" && !bindings.has(d) && !fresh.has(d)),
		(d) => hash((documents.get(d.file) as ParsedDocument).tree.stream.source),
	);
	for (const [sourceHash, targets] of renameTargets) {
		const donors = renameDonors.get(sourceHash) ?? [];
		if (donors.length === 1 && targets.length === 1 && !terminal.has(donors[0][1].lessonId))
			bind(targets[0], donors[0][1].lessonId);
	}
	if (input.priorHeads) {
		const roots = descriptors.filter((d) => d.kind === "lesson" && !fresh.has(d));
		const evidence = roots.map((root) => ({
			...root,
			canonical: hash(root.revisionContent),
			matchText: descriptors
				.filter((d) => d.file === root.file)
				.map((d) => d.matchText)
				.join("\n"),
		}));
		const priorEvidence = [...priorByPath]
			.filter(
				([file, s]) =>
					!documents.has(file) &&
					!consumed.has(s.lessonId) &&
					s.nodes[s.lessonId].status === "active" &&
					!terminal.has(s.lessonId),
			)
			.map(([file, snapshot]) => {
				const ordered: IdentityNode[] = [];
				const visit = (id: string) => {
					const node = snapshot.nodes[id];
					ordered.push(node);
					for (const [childId] of Object.entries(snapshot.nodes)
						.filter(([, n]) => n.parent === id && n.status === "active")
						.sort((a, b) => a[1].order - b[1].order))
						visit(childId);
				};
				visit(snapshot.lessonId);
				return {
					id: snapshot.lessonId,
					file,
					node: {
						...snapshot.nodes[snapshot.lessonId],
						canonical: snapshot.nodes[snapshot.lessonId].revision,
						matchText: ordered.map((n) => n.matchText).join("\n"),
					},
				};
			});
		const boundEvidence = new Map<CanonicalDescriptor, string>();
		for (const [index, d] of evidence.entries()) {
			const id = bindings.get(roots[index]);
			if (id) boundEvidence.set(d, id);
		}
		for (const [d, id] of matchSimilar(priorEvidence, evidence, boundEvidence, "lesson"))
			bind(roots[evidence.indexOf(d)], id);
	}
	// An unchanged, uniquely identified file proves its entire ordered tree, including
	// repeated siblings. Pending records still require explicit resolution.
	for (const root of descriptors.filter((d) => d.kind === "lesson" && bindings.has(d))) {
		if (retained && unchanged.has(root.file)) {
			for (const d of descriptors.filter((d) => d.file === root.file && !bindings.has(d))) {
				const id = retained.bindings.get(location(d.file, d.path));
				if (!id) fail("retained source mapping missing");
				bind(d, id);
			}
			continue;
		}
		const snapshot = lessonSnapshots.get(bindings.get(root) as string);
		if (
			!snapshot ||
			snapshot.sourceHash !== hash((documents.get(root.file) as ParsedDocument).tree.stream.source)
		)
			continue;
		const children = descriptors.filter((d) => d.file === root.file);
		if (children.some((d) => !d.valid || fresh.has(d))) continue;
		if (
			Object.values(snapshot.nodes).filter((n) => n.status === "active").length !== children.length
		)
			continue;
		for (const d of children) {
			if (bindings.has(d) || d.parentPath === null) continue;
			const owner = bindings.get(
				byLocation.get(location(d.file, d.parentPath)) as CanonicalDescriptor,
			);
			const candidates = Object.entries(snapshot.nodes).filter(
				([id, n]) =>
					!consumed.has(id) &&
					!terminal.has(id) &&
					n.status === "active" &&
					n.parent === owner &&
					n.order === d.order &&
					exactKey(n) === exactKey(d),
			);
			if (candidates.length === 1) bind(d, candidates[0][0]);
		}
	}
	// Unique course-wide exact content and exact matches under already matched owners.
	const matchExact = () => {
		const allOld = bucket(
			[...old].filter(
				([id, e]) => !provisional.has(id) && e.node.status !== "retired" && e.node.status !== "cut",
			),
			([, e]) => exactKey(e.node),
		);
		const allNew = bucket(
			descriptors.filter((d) => !fresh.has(d)),
			exactKey,
		);
		let progress = true;
		while (progress) {
			progress = false;
			const oldGroups = bucket(eligibleOld(), ([, entry]) => exactKey(entry.node));
			const newGroups = bucket(
				eligibleNew().filter((d) => !input.priorHeads || d.kind !== "lesson"),
				exactKey,
			);
			for (const [key, next] of newGroups) {
				const previous = oldGroups.get(key) ?? [];
				if (previous.length === 1 && next.length === 1) {
					bind(next[0], previous[0][0]);
					progress = true;
					continue;
				}
				for (const d of next) {
					if (bindings.has(d) || !d.parentPath) continue;
					const owner = bindings.get(
						byLocation.get(location(d.file, d.parentPath)) as CanonicalDescriptor,
					);
					if (!owner) continue;
					const ownedOld = previous.filter(
						([id, entry]) => !consumed.has(id) && entry.node.parent === owner,
					);
					const ownedNew = next.filter(
						(n) =>
							!bindings.has(n) &&
							n.file === d.file &&
							serializeIdentity(n.parentPath) === serializeIdentity(d.parentPath),
					);
					if (ownedOld.length === 1 && ownedNew.length === 1) {
						bind(d, ownedOld[0][0]);
						if (d.kind === "block" || d.kind === "part") equalCountBindings.add(d);
						progress = true;
					} else if (
						(d.kind === "block" || d.kind === "part") &&
						ownedOld.length > 1 &&
						ownedOld.length === ownedNew.length
					) {
						// Equal durable multiplicity preserves saved source order despite edits elsewhere.
						ownedOld.sort((a, b) => savedOrder(a[1].node, b[1].node));
						if (
							ownedOld.some(
								([, e], i) => i > 0 && savedOrder(e.node, ownedOld[i - 1][1].node) === 0,
							)
						)
							continue;
						ownedNew.sort((a, b) => a.span.start - b.span.start || a.order - b.order);
						ownedNew.forEach((next, i) => {
							bind(next, ownedOld[i][0]);
							equalCountBindings.add(next);
						});
						progress = true;
					}
				}
			}
			// Ordinals are allowed only for an entire unchanged sibling sequence with stable multiplicities.
			for (const [ownerDescriptor, ownerId] of bindings) {
				if (unchanged.has(ownerDescriptor.file)) continue;
				const children = descriptors
					.filter(
						(d) =>
							d.file === ownerDescriptor.file &&
							serializeIdentity(d.parentPath) === serializeIdentity(ownerDescriptor.path),
					)
					.sort((a, b) => a.order - b.order);
				const previous = [...old]
					.filter(
						([id, e]) =>
							!provisional.has(id) &&
							e.node.parent === ownerId &&
							e.node.status !== "retired" &&
							e.node.status !== "cut",
					)
					// Projections follow authored children; their shifted ordinals can overlap an absent child.
					.sort((a, b) => siblingOrder(a[1].node, b[1].node));
				if (
					!children.length ||
					children.length !== previous.length ||
					competingOrders(previous.map(([, entry]) => entry.node)) ||
					children.some((d, i) => exactKey(d) !== exactKey(previous[i][1].node))
				)
					continue;
				if (children.some((d) => fresh.has(d))) continue;
				if (
					children.some((d) => allOld.get(exactKey(d))?.length !== allNew.get(exactKey(d))?.length)
				)
					continue;
				children.forEach((d, i) => {
					if (!bindings.has(d) && !consumed.has(previous[i][0]) && !terminal.has(previous[i][0])) {
						bind(d, previous[i][0]);
						ordinalBindings.add(d);
						progress = true;
					}
				});
			}
		}
	};
	matchExact();
	// Owners precede descendants. Each sibling stage gets one frozen score/anchor matrix;
	// consuming its winners never gives rejected siblings a second, weaker margin test.
	const depths = [...new Set(descriptors.map((d) => d.path.length))].sort((a, b) => a - b);
	for (const depth of depths) {
		for (const kind of ["lesson", "page", "block", "part"] as const) {
			if (kind === "lesson" && input.priorHeads) continue;
			const targets = new Set(
				descriptors.filter((d) => d.path.length === depth && d.kind === kind),
			);
			if (![...targets].some((d) => !bindings.has(d) && !fresh.has(d))) continue;
			const previous = matchableOld().map(([id, entry]) => ({
				id,
				node: entry.node,
				file: [...priorByPath].find(([, s]) => s.lessonId === entry.snapshot.lessonId)?.[0] ?? "",
			}));
			const matches = matchSimilar(
				previous,
				descriptors.filter((d) => !fresh.has(d)),
				bindings,
				kind,
				targets,
			);
			for (const [descriptor, id] of matches) bind(descriptor, id);
			if (matches.length) matchExact();
		}
	}
	// Metadata-identical lesson roots can remain ambiguous even after every child
	// has a conservative course-wide match. A complete conserved subtree proves
	// the rename without relaxing any child score or choosing a positional winner.
	const conservedRenames = new Map<CanonicalDescriptor, string[]>();
	for (const root of descriptors.filter(
		(d) => d.kind === "lesson" && !bindings.has(d) && !fresh.has(d),
	)) {
		const children = descriptors.filter((d) => isBelow(d, root));
		if (!children.length || children.some((d) => !bindings.has(d))) continue;
		const candidates = [...priorByPath]
			.filter(([file, s]) => {
				if (
					documents.has(file) ||
					consumed.has(s.lessonId) ||
					terminal.has(s.lessonId) ||
					s.nodes[s.lessonId].status !== "active" ||
					exactKey(root) !== exactKey(s.nodes[s.lessonId])
				)
					return false;
				const live = Object.entries(s.nodes).filter(
					([id, n]) => id !== s.lessonId && n.status === "active",
				);
				return (
					live.length === children.length &&
					children.every((d) => {
						const node = s.nodes[bindings.get(d) as string];
						if (node?.status !== "active") return false;
						const parent =
							d.parentPath?.length === 0
								? s.lessonId
								: bindings.get(
										byLocation.get(
											location(d.file, d.parentPath as number[]),
										) as CanonicalDescriptor,
									);
						return node.parent === parent;
					})
				);
			})
			.map(([, s]) => s.lessonId);
		conservedRenames.set(root, candidates);
	}
	for (const [root, candidates] of conservedRenames)
		if (
			candidates.length === 1 &&
			[...conservedRenames.values()].filter((ids) => ids.includes(candidates[0])).length === 1
		)
			bind(root, candidates[0]);
	// An inverse's unplaced pending donor still makes restored copies ambiguous.
	const candidateGroups = () =>
		bucket(
			[
				...eligibleOld(),
				...[...old].filter(
					([id]) => terminal.get(id) === "pending" && !consumed.has(id) && !provisional.has(id),
				),
			],
			([, entry]) => exactKey(entry.node),
		);
	if (input.activeHistoryIds !== undefined) {
		const parentOf = (d: CanonicalDescriptor) =>
			d.parentPath === null ? undefined : byLocation.get(location(d.file, d.parentPath));
		const savedFiles = new Map(
			[...priorByPath].map(([file, snapshot]) => [snapshot.lessonId, file]),
		);
		const savedFile = (entry: { snapshot: IdentitySnapshot }) =>
			savedFiles.get(entry.snapshot.lessonId) ?? "";
		const fileOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
		let progress = true;
		while (progress) {
			progress = false;
			const candidatesByKey = candidateGroups();
			const groups = bucket(
				eligibleNew().filter((d) => d.kind === "block"),
				exactKey,
			);
			for (const [key, next] of groups) {
				const candidates = candidatesByKey.get(key) ?? [];
				if (candidates.length < 2 || candidates.length !== next.length) continue;
				if (candidates.some(([id, entry]) => terminal.has(id) || entry.node.kind !== "block"))
					continue;
				// Resolve durable owners before assigning their identical descendants.
				if (
					next.some((d) => {
						const parent = parentOf(d);
						return (
							parent &&
							!bindings.has(parent) &&
							!fresh.has(parent) &&
							candidatesByKey.has(exactKey(parent))
						);
					})
				)
					continue;
				const previous = [...candidates].sort(
					(a, b) => fileOrder(savedFile(a[1]), savedFile(b[1])) || savedOrder(a[1].node, b[1].node),
				);
				if (
					previous.some(
						([, entry], i) =>
							i > 0 &&
							savedFile(entry) === savedFile(previous[i - 1][1]) &&
							savedOrder(entry.node, previous[i - 1][1].node) === 0,
					)
				)
					continue;
				const current = [...next].sort(
					(a, b) => fileOrder(a.file, b.file) || a.span.start - b.span.start || a.order - b.order,
				);
				const pairs = new Map<CanonicalDescriptor, string>();
				const used = new Set<string>();
				// Keep as many IDs at their saved owner as possible before pairing moved copies.
				for (const d of current) {
					const parent = parentOf(d);
					const owner = parent ? bindings.get(parent) : undefined;
					const same = previous.find(
						([id, entry]) => !used.has(id) && owner !== undefined && entry.node.parent === owner,
					);
					if (same) {
						pairs.set(d, same[0]);
						used.add(same[0]);
					}
				}
				const remaining = previous.filter(([id]) => !used.has(id));
				current.filter((d) => !pairs.has(d)).forEach((d, i) => pairs.set(d, remaining[i][0]));
				for (const [d, id] of pairs) {
					bind(d, id);
					equalCountBindings.add(d);
				}
				progress = true;
			}
			if (progress) matchExact();
		}
	}
	const ambiguous = new Map<CanonicalDescriptor, string[]>();
	const pendingOld = new Set<string>();
	const oldGroups = candidateGroups();
	const newGroups = bucket(eligibleNew(), exactKey);
	for (const [key, next] of newGroups) {
		const candidates = oldGroups.get(key) ?? [];
		if (!candidates.length || (next.length === 1 && candidates.length === 1)) continue;
		for (const d of next)
			ambiguous.set(
				d,
				candidates.map(([id]) => id),
			);
		for (const [id] of candidates) pendingOld.add(id);
	}
	// Placement evidence preserves source locations, but cannot settle an earlier
	// external duplicate. Its provisional IDs and displaced donor remain pending.
	const priorGroups = bucket(matchableOld(), ([, entry]) => exactKey(entry.node));
	for (const d of descriptors) {
		const id = bindings.get(d);
		if (!id || fresh.has(d) || old.get(id)?.node.status !== "pending") continue;
		if (d.kind === "lesson" && input.priorHeads) continue;
		if (
			input.activeHistoryIds !== undefined &&
			(equalCountBindings.has(d) ||
				(ordinalBindings.has(d) && (d.kind === "block" || d.kind === "part")))
		)
			continue;
		const candidates = (priorGroups.get(exactKey(d)) ?? []).filter(
			([, entry]) =>
				entry.node.status === "pending" &&
				(d.kind !== "page" || entry.node.parent === old.get(id)?.node.parent),
		);
		if (candidates.length < 2) continue;
		ambiguous.set(
			d,
			candidates.map(([candidate]) => candidate),
		);
		for (const [candidate] of candidates) pendingOld.add(candidate);
	}
	// Pending descendants invalidate their export owner, even if that owner's parse was valid.
	const pendingDescriptors = new Set(
		descriptors.filter((d) => !d.valid || ambiguous.has(d) || explicit.get(d)?.fate === "pending"),
	);
	for (const d of [...pendingDescriptors]) {
		let parent = d.parentPath;
		while (parent !== null) {
			const owner = byLocation.get(location(d.file, parent));
			if (!owner) break;
			pendingDescriptors.add(owner);
			parent = owner.parentPath;
		}
	}
	// Keep one complete saved order through a copy-count change, rather than mixing
	// absent donors' old ordinals with their unchanged siblings' shifted positions.
	const savedOrders = new Map<CanonicalDescriptor, number>();
	const pendingOwners = new Set([...pendingOld].map((id) => old.get(id)?.node.parent));
	for (const [owner, ownerId] of bindings) {
		if (input.activeHistoryIds === undefined || !pendingOwners.has(ownerId)) continue;
		for (const projected of [0, 1]) {
			const previous = [...old]
				.filter(
					([id, { node }]) =>
						!provisional.has(id) &&
						node.parent === ownerId &&
						(node.status === "active" || node.status === "pending") &&
						projection(node) === projected,
				)
				.sort((a, b) => siblingOrder(a[1].node, b[1].node));
			const pendingKeys = new Set(
				previous.filter(([id]) => pendingOld.has(id)).map(([, { node }]) => exactKey(node)),
			);
			const previousIds = new Set(previous.map(([id]) => id));
			if (!pendingKeys.size || competingOrders(previous.map(([, { node }]) => node))) continue;
			const children = descriptors.filter(
				(d) =>
					d.file === owner.file &&
					serializeIdentity(d.parentPath) === serializeIdentity(owner.path) &&
					Number(d.type.startsWith("reader-role:")) === projected,
			);
			if (
				children.some((d) => {
					if (!d.valid || fresh.has(d) || (d.kind !== "block" && d.kind !== "part")) return true;
					const id = bindings.get(d);
					const original = id ? old.get(id)?.node : undefined;
					return id
						? !previousIds.has(id) || !original || exactKey(original) !== exactKey(d)
						: !pendingKeys.has(exactKey(d));
				})
			)
				continue;
			const fixed = previous.filter(([id]) => !pendingOld.has(id));
			const currentFixed = children.filter((d) => fixed.some(([id]) => bindings.get(d) === id));
			if (
				currentFixed.length !== fixed.length ||
				currentFixed.some((d, i) => bindings.get(d) !== fixed[i][0])
			)
				continue;
			for (const d of children) {
				const id = bindings.get(d);
				const original = id && old.get(id);
				if (original) savedOrders.set(d, original.node.order);
			}
		}
	}
	const provisionalGroups = bucket(
		[...old]
			.filter(([id]) => provisional.has(id) && !terminal.has(id))
			.sort((a, b) => a[1].node.span.start - b[1].node.span.start),
		([, entry]) => exactKey(entry.node),
	);
	for (const d of descriptors) {
		if (bindings.has(d)) continue;
		const reusable = pendingDescriptors.has(d)
			? provisionalGroups.get(exactKey(d))?.find(([id]) => !consumed.has(id))
			: undefined;
		bind(d, reusable?.[0] ?? allocate());
	}
	const snapshots: IdentitySnapshot[] = [];
	const nodesById = new Map<string, IdentityNode>();
	const pages = descriptors.filter((d) => d.kind === "page");
	const reserved = [...old.values()]
		.filter((e) => e.node.kind === "page")
		.flatMap((e) => [...(e.node.slug ? [e.node.slug] : []), ...(e.node.aliases ?? [])]);
	const pageSlugs = buildSlugMap(
		pages
			.filter((d) => !old.get(bindings.get(d) as string)?.node.slug)
			.map((d) => ({ id: bindings.get(d) as string, title: d.label })),
		reserved,
	);
	const aliases = buildSlugMap(
		pages
			.filter((d) => {
				const original = old.get(bindings.get(d) as string)?.node;
				const candidate = pageSlug(d.label, d.order);
				return (
					original?.slug &&
					original.label !== d.label &&
					candidate !== original.slug &&
					!original.aliases?.includes(candidate)
				);
			})
			.map((d) => ({ id: bindings.get(d) as string, title: d.label })),
		[...reserved, ...pageSlugs.values()],
	);
	for (const document of input.parsedDocuments) {
		const root = byLocation.get(location(document.path, [])) as CanonicalDescriptor;
		const lessonId = bindings.get(root) as string;
		const previous = lessonSnapshots.get(lessonId);
		if (unchanged.has(document.path) && previous) {
			snapshots.push(structuredClone(previous));
			for (const d of descriptors.filter((d) => d.file === document.path)) {
				const id = bindings.get(d);
				if (!id || !previous.nodes[id]) fail("retained node missing");
				nodesById.set(id, previous.nodes[id]);
				maps.push(unchangedMapping(id));
			}
			continue;
		}
		const nodes: Record<string, IdentityNode> = {};
		for (const d of descriptors.filter((d) => d.file === document.path)) {
			const id = bindings.get(d) as string;
			const original = old.get(id)?.node;
			const map = explicit.get(d);
			const status = pendingDescriptors.has(d) ? "pending" : "active";
			const lineage = new Set(original?.lineage ?? []);
			if (copiedFrom.has(d)) lineage.add(copiedFrom.get(d) as string);
			for (const m of maps)
				if (m.fate === "absorbed" && m.newId === id && m.oldId) lineage.add(m.oldId);
			const node: IdentityNode = {
				kind: d.kind,
				type: d.type,
				parent:
					d.parentPath === null
						? null
						: (bindings.get(
								byLocation.get(location(d.file, d.parentPath)) as CanonicalDescriptor,
							) as string),
				order: savedOrders.get(d) ?? d.order,
				canonical: d.canonical,
				matchText: d.matchText,
				label: d.label,
				span: { ...d.span },
				fingerprint: hash(d.canonical),
				revision: hash(d.revisionContent),
				status,
				lineage: [...lineage].filter((value) => value !== id),
				...(d.kind === "page"
					? {
							slug: original?.slug ?? pageSlugs.get(id) ?? null,
							aliases: [
								...new Set([
									...(original?.aliases ?? []),
									...[aliases.get(id)].filter((alias): alias is string => alias !== undefined),
								]),
							],
						}
					: {}),
				...(original?.consumerRevisions
					? { consumerRevisions: structuredClone(original.consumerRevisions) }
					: {}),
			};
			nodes[id] = node;
			nodesById.set(id, node);
			if (map) {
				if (status === "pending") map.fate = "pending";
			} else
				maps.push({
					oldId: copiedFrom.get(d) ?? (original ? id : null),
					newId: id,
					fate:
						status === "pending"
							? "pending"
							: copiedFrom.has(d)
								? "copied"
								: original
									? "kept"
									: "new",
				});
			if (status === "pending")
				unresolved.push({
					file: d.file,
					path: [...d.path],
					id,
					candidates: ambiguous.get(d) ?? [],
					reason: ambiguous.has(d) ? "duplicate" : "invalid",
				});
		}
		snapshots.push({
			schema: 1,
			courseId: course.courseId,
			lessonId,
			parents: previous ? [snapshotHash(previous)] : [],
			sourceHash: hash(document.tree.stream.source),
			nodes,
		});
	}
	// Retain records absent from current source. Invalid parses cannot prove deletion.
	for (const [id, entry] of old) {
		if (nodesById.has(id)) continue;
		let snapshot = snapshots.find((s) => s.lessonId === entry.snapshot.lessonId);
		if (!snapshot) {
			// Without I3 evidence, an absent lesson remains reviewable rather than disappearing.
			snapshot = structuredClone(entry.snapshot);
			snapshot.parents = [snapshotHash(entry.snapshot)];
			snapshot.nodes = {};
			snapshots.push(snapshot);
		}
		const file =
			[...priorByPath].find(([, s]) => s.lessonId === entry.snapshot.lessonId)?.[0] ??
			descriptors.find((d) => d.kind === "lesson" && bindings.get(d) === entry.snapshot.lessonId)
				?.file ??
			"";
		const invalid = descriptors.some((d) => !d.valid && (!file || d.file === file));
		const status =
			terminal.get(id) ??
			(provisional.has(id)
				? "retired"
				: entry.node.status === "retired" || entry.node.status === "cut"
					? entry.node.status
					: pendingOld.has(id) || invalid || !documents.has(file)
						? "pending"
						: "retired");
		const node = { ...structuredClone(entry.node), status };
		snapshot.nodes[id] = node;
		nodesById.set(id, node);
		if (
			(status !== entry.node.status || (status !== "retired" && status !== "cut")) &&
			!maps.some((m) => m.oldId === id && m.fate !== "copied")
		)
			maps.push({
				oldId: id,
				newId: status === "pending" ? id : null,
				fate: status === "pending" ? "pending" : status === "cut" ? "cut" : "retired",
			});
		if (status === "pending")
			unresolved.push({
				file,
				path: null,
				id,
				candidates: [],
				reason: pendingOld.has(id) ? "duplicate" : "invalid",
			});
	}
	// Retained descendants of a moved parent belong to its new lesson.
	for (const snapshot of snapshots) {
		for (const [id, node] of Object.entries(snapshot.nodes)) {
			if (node.parent && !snapshot.nodes[node.parent]) {
				const owner = snapshots.find((s) => s.nodes[node.parent as string]);
				if (!owner) fail("resolved parent missing");
				owner.nodes[id] = node;
				delete snapshot.nodes[id];
			}
		}
	}
	for (let index = 0; index < snapshots.length; index++) {
		const snapshot = snapshots[index];
		const previous = lessonSnapshots.get(snapshot.lessonId);
		if (
			previous &&
			previous.sourceHash === snapshot.sourceHash &&
			serializeIdentity(previous.nodes) === serializeIdentity(snapshot.nodes)
		)
			snapshots[index] = structuredClone(previous);
	}
	const finalRecords = new Map(
		snapshots.map((snapshot) => {
			const record = hashIdentitySnapshot(snapshot, hash);
			return [snapshot, { text: record.canonical, hash: record.hash }] as const;
		}),
	);
	const heads = input.parsedDocuments.map((document) => {
		const lessonId = bindings.get(
			byLocation.get(location(document.path, [])) as CanonicalDescriptor,
		);
		const snapshot = snapshots.find((s) => s.lessonId === lessonId) as IdentitySnapshot;
		const record = finalRecords.get(snapshot);
		if (!record) fail("head snapshot hash unavailable");
		return { schema: 1 as const, path: document.path, head: record.hash };
	});
	for (const snapshot of snapshots) {
		if (
			input.priorHeads?.some(
				(h) =>
					unchanged.has(h.path) &&
					retained?.hashes.get(lessonSnapshots.get(snapshot.lessonId) as IdentitySnapshot) ===
						h.head,
			)
		)
			continue;
		const record = finalRecords.get(snapshot);
		if (!record) fail("snapshot hash unavailable");
		parseSnapshot(record.text, { courseId: course.courseId, digest: hash });
	}
	const sourceMappings = descriptors.map((d) => {
		const id = bindings.get(d) as string;
		const node = nodesById.get(id) as IdentityNode;
		return {
			file: d.file,
			path: [...d.path],
			id,
			fingerprint: node.fingerprint,
			span: { ...d.span },
			status: node.status as "active" | "pending",
		};
	});
	const result = {
		course,
		heads,
		snapshots,
		mapping: maps,
		inverseMapping: invertIdentityMapping(
			maps,
			new Set([...old].filter(([, entry]) => entry.node.status === "pending").map(([id]) => id)),
			new Set([...old].filter(([, entry]) => entry.node.status === "cut").map(([id]) => id)),
		),
		sourceMappings,
		unresolved,
		exportIds: [...nodesById].filter(([, node]) => node.status === "active").map(([id]) => id),
		exportable: unresolved.length === 0,
	};
	if (!displayIds) assertDurableCandidate(result);
	return result;
}
