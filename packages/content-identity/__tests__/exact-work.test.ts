import { createHash } from "node:crypto";
import { readLesson } from "@praxity/grammar";
import { expect, it, vi } from "vitest";
import { resolveIdentity } from "../src/index";
import * as reconciliation from "../src/reconcile";

it("exact matching keeps repeated block IDs active across lessons after an unrelated edit", () => {
	let id = 0;
	const dependencies = {
		digest: (text: string) => createHash("sha256").update(text).digest("hex"),
		allocateId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
	};
	const alpha = "# Alpha\n\nRepeated.\n\nRepeated.\n";
	const beta = "# Beta\n\nRepeated.\n\nRepeated.\n\n# Gamma\n\nUnique.\n";
	const documents = (b: string) =>
		[
			{ path: "a.prax", source: alpha },
			{ path: "b.prax", source: b },
		].map(({ path, source }) => ({ path, tree: readLesson(source).tree }));
	const prior = resolveIdentity(
		{ parsedDocuments: documents(beta), priorSnapshots: [] },
		dependencies,
	);
	const repeatedBlocks = (result: ReturnType<typeof resolveIdentity>) =>
		result.sourceMappings.filter(
			(mapping) => mapping.file === "b.prax" && mapping.path.length === 2 && mapping.path[0] === 0,
		);
	const oldBlocks = repeatedBlocks(prior);
	expect(oldBlocks).toHaveLength(2);
	const result = resolveIdentity(
		{
			course: prior.course,
			priorHeads: prior.heads,
			priorSnapshots: prior.snapshots,
			parsedDocuments: documents(beta.replace("Unique.", "Changed.")),
		},
		dependencies,
	);
	expect(repeatedBlocks(result).map(({ path, id, status }) => ({ path, id, status }))).toEqual(
		oldBlocks.map(({ path, id }) => ({ path, id, status: "active" })),
	);
	for (const { id } of oldBlocks) {
		expect(result.snapshots.find((snapshot) => snapshot.nodes[id])?.nodes[id].status).toBe(
			"active",
		);
	}
});

it("exact matching key work grows linearly with unchanged bound owners", () => {
	const count = (pages: number) => {
		let id = 0;
		const dependencies = {
			digest: (text: string) => createHash("sha256").update(text).digest("hex"),
			allocateId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
		};
		const source = Array.from(
			{ length: pages },
			(_, index) => `# Page ${index}\n\nRepeated paragraph.\n\nRepeated paragraph.\n`,
		).join("\n");
		const document = (source: string) => ({ path: "lesson.prax", tree: readLesson(source).tree });
		const prior = resolveIdentity(
			{ parsedDocuments: [document(source)], priorSnapshots: [] },
			dependencies,
		);
		const keys = vi.spyOn(reconciliation, "identityKey");
		const result = resolveIdentity(
			{
				course: prior.course,
				priorHeads: prior.heads,
				priorSnapshots: prior.snapshots,
				parsedDocuments: [document(source.replace("Repeated paragraph.", "Edited paragraph."))],
			},
			dependencies,
		);
		expect(result.heads).toHaveLength(1);
		const calls = keys.mock.calls.length;
		keys.mockRestore();
		return calls;
	};
	const small = count(12);
	const large = count(24);
	expect(large).toBeLessThanOrEqual(small * 2.5);
});
