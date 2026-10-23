import { serializeIdentity } from "./canonical.ts";
import type { IdentityDependencies, IdentityMapping, IdentityResolution } from "./types.ts";

function* metadataChanges(
	prior: IdentityResolution,
	written: IdentityResolution,
	mapping: readonly IdentityMapping[],
) {
	for (const map of mapping) {
		const id = map.newId ?? map.oldId;
		if (!id) continue;
		const old = prior.snapshots.find((s) => Object.hasOwn(s.nodes, id))?.nodes[id];
		const forward = written.snapshots.find((s) => Object.hasOwn(s.nodes, id))?.nodes[id];
		if (!old || !forward) continue;
		for (const key of ["lineage", "slug", "aliases", "consumerRevisions"] as const)
			if (serializeIdentity(old[key] ?? null) !== serializeIdentity(forward[key] ?? null))
				yield { id, key, old, forward };
	}
}

/** Guard precisely the metadata fields the inverse will restore, before parsing inverse edits. */
export function canRestoreIdentityMetadata(
	current: IdentityResolution,
	prior: IdentityResolution,
	written: IdentityResolution,
	mapping: readonly IdentityMapping[],
): boolean {
	for (const { id, key, forward } of metadataChanges(prior, written, mapping)) {
		const node = current.snapshots.find((s) => Object.hasOwn(s.nodes, id))?.nodes[id];
		if (!node || serializeIdentity(node[key] ?? null) !== serializeIdentity(forward[key] ?? null))
			return false;
	}
	return true;
}

/** Inverses restore only metadata fields changed by their forward operation. */
export function restoreIdentityMetadata(
	resolution: IdentityResolution,
	prior: IdentityResolution,
	written: IdentityResolution,
	mapping: readonly IdentityMapping[],
	dependencies: IdentityDependencies,
): IdentityResolution {
	const result = structuredClone(resolution);
	for (const { id, key, old } of metadataChanges(prior, written, mapping)) {
		const snapshot = result.snapshots.find((s) => Object.hasOwn(s.nodes, id));
		if (!snapshot) continue;
		const node = snapshot.nodes[id];
		if (node.canonical === old.canonical || node.status === "cut" || node.status === "retired") {
			if (key !== "lineage" && old[key] === undefined) delete node[key];
			else Object.assign(node, { [key]: structuredClone(old[key]) });
		}
	}
	result.heads = result.heads.map((h) => {
		const previous = resolution.snapshots.find(
			(s) => dependencies.digest(serializeIdentity(s)) === h.head,
		);
		if (!previous) throw new Error(`Identity: no snapshot matches head ${h.head}`);
		const snapshot = result.snapshots.find((s) => s.lessonId === previous.lessonId);
		if (!snapshot) throw new Error(`Identity: no snapshot for lesson ${previous.lessonId}`);
		return { ...h, head: dependencies.digest(serializeIdentity(snapshot)) };
	});
	return result;
}
