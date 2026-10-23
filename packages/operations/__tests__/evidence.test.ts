import { createHash, randomUUID } from "node:crypto";
import { resolveIdentity } from "@praxity/content-identity";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { applyOperation } from "../src";

it("S1 operation evidence replays allocated descendant IDs exactly", () => {
	const source = "# Safety\n\n::: note Keep clear {tone=info}\nKeep the exit clear.\n:::\n";
	const path = "lesson.prax";
	const dependencies = {
		allocateId: randomUUID,
		digest: (text: string) => createHash("sha256").update(text).digest("hex"),
	};
	const document = (text: string) => ({ path, tree: readLesson(text).tree });
	const identity = resolveIdentity(
		{ parsedDocuments: [document(source)], priorSnapshots: [], readerRoles: true },
		dependencies,
	);
	const node = identity.sourceMappings.find((mapping) => mapping.path.join() === "0,0");
	if (!node) throw new Error("Missing fixture node");
	const result = applyOperation(
		[{ path, source }],
		{
			transactionId: "copy",
			operation: "duplicateBlocks",
			files: [{ path, baseRevision: dependencies.digest(source) }],
			targets: [
				{
					file: path,
					ref: { kind: "node", nodeId: node.id, path: node.path, fingerprint: node.fingerprint },
					expectedText: source.slice(node.span.start, node.span.end),
				},
			],
			args: {},
		},
		{ identity, ...dependencies },
	);
	if (!result.ok) throw new Error(result.code);
	const replayed = resolveIdentity(
		{
			course: identity.course,
			priorHeads: identity.heads,
			priorSnapshots: identity.snapshots,
			parsedDocuments: result.history.after.map((file) => document(file.source)),
			operations: result.evidence,
		},
		dependencies,
	);
	expect(replayed.sourceMappings).toEqual(result.identity.sourceMappings);
	expect(replayed.snapshots).toEqual(result.identity.snapshots);
});
