import type { IdentityOperation, IdentityResolution } from "@praxity/content-identity";

/** Replay must install the IDs returned to the host, including allocated descendants. */
export function bindAllocatedEvidence(
	evidence: readonly IdentityOperation[],
	identity: IdentityResolution,
): IdentityOperation[] {
	const result = structuredClone(evidence) as IdentityOperation[];
	for (const operation of result) {
		for (const placement of operation.placements) {
			const node = identity.sourceMappings.find(
				(node) => node.file === placement.file && node.path.join() === placement.path.join(),
			);
			if (!node) throw new Error("evidence-node");
			operation.mapping[placement.mappingIndex].newId = node.id;
		}
	}
	const bound = new Set(
		result.flatMap((operation) => operation.mapping.map((mapping) => mapping.newId)),
	);
	for (const mapping of identity.mapping) {
		if (
			!mapping.newId ||
			bound.has(mapping.newId) ||
			!["new", "copied", "pending"].includes(mapping.fate)
		)
			continue;
		const node = identity.sourceMappings.find((node) => node.id === mapping.newId);
		if (!node) continue;
		const intent = mapping.fate === "copied" ? "copy" : "modify";
		let operation = result.find((operation) => operation.intent === intent);
		if (!operation) {
			const first = result[0];
			if (!first) throw new Error("evidence-revision");
			operation = {
				intent,
				files: first.files,
				mapping: [],
				placements: [],
				...(first.inverse ? { inverse: true } : {}),
			};
			result.push(operation);
		}
		operation.placements.push({
			mappingIndex: operation.mapping.length,
			file: node.file,
			path: node.path,
		});
		operation.mapping.push({ ...mapping });
		bound.add(mapping.newId);
	}
	return result;
}
