import { serializeIdentity } from "./canonical.ts";
import {
	assertHash,
	assertLegacyIdentitySnapshot,
	parseCourseIdentity,
	parseIdentitySnapshot,
	parseLessonHead,
} from "./files.ts";
import { resolveIdentity } from "./resolve.ts";
import type {
	IdentityDependencies,
	IdentityMergeConflict,
	IdentityMergeResult,
	IdentityMergeState,
	IdentityNode,
	IdentitySnapshot,
	ParsedDocument,
} from "./types.ts";

const equal = (a: unknown, b: unknown) =>
	serializeIdentity(a ?? null) === serializeIdentity(b ?? null);
const content = (node: IdentityNode) => [node.kind, node.type, node.canonical];
const union = (...lists: string[][]) => [...new Set(lists.flat())].sort();

/** Merge decisions are pure. The caller reads git and installs only a conflict-free result. */
export function mergeIdentity(
	base: IdentityMergeState,
	ours: IdentityMergeState,
	theirs: IdentityMergeState,
	documents: readonly ParsedDocument[],
	dependencies: IdentityDependencies,
): IdentityMergeResult {
	const conflicts: IdentityMergeConflict[] = [];
	const course = parseCourseIdentity(serializeIdentity(base.course));
	const hash = (text: string) => {
		const result = dependencies.digest(text);
		assertHash(result);
		return result;
	};
	const read = (state: IdentityMergeState) => {
		parseCourseIdentity(serializeIdentity(state.course), course.courseId);
		const nodes = new Map<string, IdentityNode>();
		const snapshots = new Map<string, IdentitySnapshot>();
		const byHash = new Map<string, IdentitySnapshot>();
		const paths = new Map<string, string>();
		for (const raw of state.snapshots) {
			const snapshot = parseIdentitySnapshot(serializeIdentity(raw), {
				courseId: course.courseId,
				digest: hash,
			});
			assertLegacyIdentitySnapshot(snapshot);
			if (snapshots.has(snapshot.lessonId))
				throw new Error("Identity: competing lesson snapshots in merge input");
			snapshots.set(snapshot.lessonId, snapshot);
			byHash.set(hash(serializeIdentity(snapshot)), snapshot);
			for (const [id, node] of Object.entries(snapshot.nodes)) {
				const prior = nodes.get(id);
				if (
					id === course.courseId ||
					(prior && prior.status !== "retired" && node.status !== "retired")
				)
					conflicts.push({ reason: "id-claimed-by-entities", ids: [id] });
				if (!prior || node.status !== "retired") nodes.set(id, node);
			}
		}
		for (const raw of state.heads) {
			const head = parseLessonHead(serializeIdentity(raw));
			const snapshot = byHash.get(head.head);
			if (!snapshot) throw new Error("Identity: head snapshot hash unavailable");
			if (paths.has(snapshot.lessonId) || [...paths.values()].includes(head.path))
				throw new Error("Identity: duplicate lesson head");
			paths.set(snapshot.lessonId, head.path);
		}
		if (paths.size !== snapshots.size)
			throw new Error("Identity: merge requires complete lesson heads");
		return { nodes, snapshots, paths };
	};
	const [b, o, t] = [base, ours, theirs].map(read);
	const choose = <T>(id: string, field: string, before: T, left: T, right: T): T => {
		if (equal(left, right) || equal(right, before)) return left;
		if (equal(left, before)) return right;
		conflicts.push({ reason: "divergent-change", ids: [id], field });
		return before;
	};
	const selected = new Map<string, IdentityNode>();
	for (const id of new Set([...b.nodes.keys(), ...o.nodes.keys(), ...t.nodes.keys()])) {
		const before = b.nodes.get(id);
		const left = o.nodes.get(id);
		const right = t.nodes.get(id);
		if (!left || !right) {
			if (before) {
				// A head must retain retirement history; absence cannot prove deletion.
				conflicts.push({ reason: "documents-mismatch", ids: [id], field: "missing-history" });
			} else if (left ?? right) selected.set(id, structuredClone((left ?? right) as IdentityNode));
			continue;
		}
		if (!before) {
			if (!equal(content(left), content(right)) || left.parent !== right.parent)
				conflicts.push({ reason: "id-claimed-by-entities", ids: [id] });
			for (const field of ["status", "slug", "consumerRevisions"] as const)
				choose(id, field, undefined, left[field], right[field]);
			const node = structuredClone(left);
			node.lineage = union(left.lineage, right.lineage);
			if (node.kind === "page") node.aliases = union(left.aliases ?? [], right.aliases ?? []);
			selected.set(id, node);
			continue;
		}
		if (before.status === "retired" && (left.status !== "retired" || right.status !== "retired"))
			conflicts.push({ reason: "retired-id", ids: [id] });
		const picked = choose(id, "content", content(before), content(left), content(right));
		const node = structuredClone(equal(picked, content(left)) ? left : right);
		if (
			(left.status === "retired" && !equal(content(before), content(right))) ||
			(right.status === "retired" && !equal(content(before), content(left)))
		)
			conflicts.push({ reason: "divergent-change", ids: [id], field: "delete-edit" });
		node.parent = choose(id, "parent", before.parent, left.parent, right.parent);
		node.status = choose(id, "status", before.status, left.status, right.status);
		// Numeric offsets shift after disjoint insertions. The merged parse owns order
		// and spans; neither is evidence of a competing entity or content edit.
		node.lineage = union(before.lineage, left.lineage, right.lineage);
		if (node.kind === "page") {
			node.slug = choose(id, "slug", before.slug, left.slug, right.slug);
			node.aliases = union(before.aliases ?? [], left.aliases ?? [], right.aliases ?? []);
		}
		node.consumerRevisions = choose(
			id,
			"consumerRevisions",
			before.consumerRevisions,
			left.consumerRevisions,
			right.consumerRevisions,
		);
		selected.set(id, node);
	}
	const paths = new Map<string, string>();
	for (const id of new Set([...b.paths.keys(), ...o.paths.keys(), ...t.paths.keys()])) {
		const path = choose(id, "lesson-path", b.paths.get(id), o.paths.get(id), t.paths.get(id));
		if (path) paths.set(id, path);
	}
	if (new Set(paths.values()).size !== paths.size)
		conflicts.push({ reason: "two-ids-for-entity", ids: [...paths.keys()], field: "lesson-path" });
	if (conflicts.length) return { resolution: null, conflicts };
	const snapshots = new Map<string, IdentitySnapshot>();
	for (const [lessonId] of paths) {
		const original = o.snapshots.get(lessonId) ?? t.snapshots.get(lessonId);
		if (!original) throw new Error("Identity: merge snapshot unavailable");
		snapshots.set(lessonId, { ...structuredClone(original), nodes: {} });
	}
	for (const [id, node] of selected) {
		let owner = id;
		const seen = new Set<string>();
		let parent = selected.get(owner)?.parent;
		while (parent) {
			if (seen.has(owner)) {
				conflicts.push({ reason: "divergent-change", ids: [...seen], field: "parent-cycle" });
				break;
			}
			seen.add(owner);
			owner = parent;
			parent = selected.get(owner)?.parent;
		}
		if (parent) continue;
		const snapshot = snapshots.get(owner);
		if (!snapshot) {
			conflicts.push({ reason: "documents-mismatch", ids: [id], field: "parent" });
			continue;
		}
		snapshot.nodes[id] = node;
	}
	if (conflicts.length) return { resolution: null, conflicts };
	// This pool combines records from different source revisions. It cannot claim
	// unchanged-file evidence from either branch, especially for duplicate siblings.
	const documentHashes = new Set(documents.map((d) => hash(d.tree.stream.source)));
	for (const snapshot of snapshots.values()) {
		snapshot.sourceHash = hash(
			`Unmaterialized identity merge\n${serializeIdentity(snapshot.nodes)}`,
		);
		if (documentHashes.has(snapshot.sourceHash))
			throw new Error("Identity: merge digest collision");
	}
	const priorHeads = [...snapshots].map(([id, snapshot]) => ({
		schema: 1 as const,
		path: paths.get(id) as string,
		head: hash(serializeIdentity(snapshot)),
	}));
	const resolution = resolveIdentity(
		{ course, parsedDocuments: documents, priorSnapshots: [...snapshots.values()], priorHeads },
		dependencies,
	);
	const mappedIds = new Set(resolution.sourceMappings.map((m) => m.id));
	const resolvedNodes = new Map(resolution.snapshots.flatMap((s) => Object.entries(s.nodes)));
	for (const [id, node] of selected) {
		if (node.status !== "active") continue;
		const resolved = resolvedNodes.get(id);
		if (!mappedIds.has(id) || !resolved || !equal(content(node), content(resolved)))
			conflicts.push({ reason: "documents-mismatch", ids: [id], field: "content" });
	}
	for (const unresolved of resolution.unresolved) {
		conflicts.push({
			reason: unresolved.candidates.length > 1 ? "two-ids-for-entity" : "documents-mismatch",
			ids: unresolved.candidates.length ? unresolved.candidates : [unresolved.id],
			file: unresolved.file,
			path: unresolved.path,
		});
	}
	if (conflicts.length) return { resolution: null, conflicts };
	// Merge commits point at both real branch heads, never at the synthetic reconciliation input.
	for (const snapshot of resolution.snapshots) {
		snapshot.parents = [
			...new Set(
				[o.snapshots.get(snapshot.lessonId), t.snapshots.get(snapshot.lessonId)]
					.filter((s): s is IdentitySnapshot => s !== undefined)
					.map((s) => hash(serializeIdentity(s))),
			),
		].sort();
	}
	for (const head of resolution.heads) {
		const root = resolution.sourceMappings.find((m) => m.file === head.path && m.path.length === 0);
		const snapshot = resolution.snapshots.find((s) => s.lessonId === root?.id);
		if (!snapshot) throw new Error("Identity: merged head snapshot unavailable");
		head.head = hash(serializeIdentity(snapshot));
	}
	return { resolution, conflicts: [] };
}
