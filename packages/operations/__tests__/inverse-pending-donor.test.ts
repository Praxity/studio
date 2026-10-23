import { createHash } from "node:crypto";
import { resolveIdentity } from "@praxity/content-identity";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { applyOperation, planInverseGroup } from "../src/index.ts";

it("records an unplaced donor's pending fate in the executable inverse evidence", () => {
	const source = "# First\n\nRepeated.\n\nOther subject.\n";
	const duplicate = `${source}\nRepeated.\n`;
	const digest = (text: string) => createHash("sha256").update(text).digest("hex");
	let next = 0;
	const dependencies = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
	};
	const documents = (text: string) => [{ path: "one.prax", tree: readLesson(text).tree }];
	const initial = resolveIdentity(
		{ parsedDocuments: documents(source), priorSnapshots: [] },
		dependencies,
	);
	const donor = initial.sourceMappings.find((m) => m.path.join() === "0,0");
	if (!donor) throw new Error("Missing donor");
	const activeHistoryIds = new Set(initial.sourceMappings.map((m) => m.id));
	const pending = resolveIdentity(
		{
			course: initial.course,
			priorHeads: initial.heads,
			priorSnapshots: initial.snapshots,
			activeHistoryIds,
			parsedDocuments: documents(duplicate),
		},
		dependencies,
	);
	const copy = pending.sourceMappings.find((m) => m.path.join() === "0,2");
	if (!copy) throw new Error("Missing copy");
	const changed = applyOperation(
		[{ path: "one.prax", source: duplicate }],
		{
			transactionId: "settle",
			operation: "editSource",
			files: [{ path: "one.prax", baseRevision: digest(duplicate) }],
			targets: [
				{
					file: "one.prax",
					ref: { kind: "node", nodeId: copy.id, path: copy.path, fingerprint: copy.fingerprint },
					expectedText: "Repeated.\n",
				},
			],
			args: { text: "Distinct copy.\n" },
		},
		{ ...dependencies, identity: pending, activeHistoryIds },
	);
	if (!changed.ok) throw new Error(changed.code);
	const inverse = planInverseGroup(
		changed.history.after,
		{ transactionId: "undo", operations: [changed] },
		{
			...dependencies,
			identity: changed.identity,
			activeHistoryIds,
		},
	);
	if (!inverse.ok) throw new Error(inverse.code);
	expect(inverse.after).toEqual([{ path: "one.prax", source: duplicate }]);
	const evidence = inverse.members[0].evidence[0];
	expect(evidence.mapping.filter((m) => m.oldId === donor.id)).toEqual([
		{ oldId: donor.id, newId: donor.id, fate: "pending" },
	]);
	const index = evidence.mapping.findIndex((m) => m.oldId === donor.id);
	expect(evidence.placements.filter((p) => p.mappingIndex === index)).toEqual([]);
	const restored = inverse.identity.snapshots[0].nodes[donor.id];
	expect(restored.status).toBe("pending");
});
