import { createHash } from "node:crypto";
import { readLesson, readWriteDistractorsContent } from "@praxity/grammar";
import { expect, it } from "vitest";
import { describeDocument, type IdentityResolution, resolveIdentity } from "../src/index";

it("keeps misconception IDs across reorder and page move, allocating fresh IDs on copy", () => {
	let next = 1;
	const dependencies = {
		digest: (s: string) => createHash("sha256").update(s).digest("hex"),
		allocateId: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`,
	};
	const a = ":: First idea\noption: First option\n";
	const b = ":: Second idea\noption: Second option\n";
	const source = (items: string) =>
		`::: write-distractors Topic\nanswer: Right answer\n${items}:::\n`;
	const resolve = (sources: Record<string, string>, prior?: IdentityResolution) => {
		const documents = Object.entries(sources).map(([path, source]) => ({
			path,
			tree: readLesson(source).tree,
		}));
		const state = resolveIdentity(
			{
				parsedDocuments: documents,
				priorSnapshots: prior?.snapshots ?? [],
				priorHeads: prior?.heads,
				course: prior?.course,
				readerRoles: true,
			},
			dependencies,
		);
		const reads = documents.map((doc) => {
			const descriptors = describeDocument(doc, { readerRoles: true });
			return readLesson(doc.tree.stream.source, {
				ids: (node, role) => {
					const owner = descriptors.find(
						(d) =>
							!d.readerRole &&
							d.kind ===
								(node.kind === "page"
									? "page"
									: node.kind === "lesson"
										? "lesson"
										: node.kind === "block"
											? "block"
											: "part") &&
							d.span.start === node.span.start &&
							d.span.end === node.span.end,
					);
					const descriptor = role
						? descriptors.find(
								(d) =>
									d.readerRole === role && d.readerOwnerPath?.join("/") === owner?.path.join("/"),
							)
						: owner;
					const mapping = state.sourceMappings.find(
						(m) => m.file === doc.path && m.path.join("/") === descriptor?.path.join("/"),
					);
					if (!mapping) throw new Error(`Missing identity ${node.kind} ${node.span.start} ${role}`);
					return mapping.id;
				},
			});
		});

		const questions = reads.flatMap((read) =>
			read.blocks
				.filter((b) => b.type === "writeDistractors")
				.flatMap((block) => {
					const content = readWriteDistractorsContent(read, block.id);
					expect(block.data.content).toMatchObject({
						items: content.misconceptions.map(({ id }) => ({ id })),
					});
					expect(content.authorOptions.map((option) => option.misconception)).toEqual(
						content.misconceptions.map((item) => item.id),
					);
					return content.misconceptions;
				}),
		);
		return { state, questions };
	};
	const before = resolve({ "lesson.prax": `# One\n${source(a + b)}# Two\n` });
	const after = resolve({ "lesson.prax": `# One\n# Two\n${source(b + a)}` }, before.state);
	expect(after.questions).toEqual([before.questions[1], before.questions[0]]);
	const copied = resolve(
		{ "lesson.prax": `# One\n# Two\n${source(b + a)}`, "copy.prax": `# Copy\n${source(b + a)}` },
		after.state,
	);
	expect(copied.questions.slice(0, 2)).toEqual(after.questions);
	const originals = new Set(after.questions.map((q) => q.id));
	for (const q of copied.questions.slice(2)) expect(originals.has(q.id)).toBe(false);
	expect(new Set(copied.questions.map((q) => q.id)).size).toBe(4);
	for (const q of copied.questions) expect(q.id).toMatch(/^[A-Za-z0-9_-]{1,120}$/);
});

it("retires deleted misconception/option identities and never reuses them on a later insertion", () => {
	let next = 1;
	const dependencies = {
		digest: (text: string) => createHash("sha256").update(text).digest("hex"),
		allocateId: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`,
	};
	const first = ":: First idea\noption: First option\n";
	const second = ":: Second idea\noption: Second option\n";
	const resolve = (items: string, prior?: IdentityResolution) => {
		const tree = readLesson(`# P\n::: write-distractors Q\nanswer: Right\n${items}:::\n`).tree;
		return resolveIdentity(
			{
				parsedDocuments: [{ path: "lesson.prax", tree }],
				priorSnapshots: prior?.snapshots ?? [],
				priorHeads: prior?.heads,
				course: prior?.course,
			},
			dependencies,
		);
	};
	const original = resolve(first + second);
	expect(original.exportable).toBe(true);
	const deletedItem = original.sourceMappings.find(
		(mapping) => original.snapshots[0].nodes[mapping.id].label === "Second idea",
	);
	if (!deletedItem) throw new Error("Missing second misconception identity");
	const removed = original.sourceMappings
		.filter(
			(mapping) =>
				mapping.path.slice(0, deletedItem.path.length).join("/") === deletedItem.path.join("/"),
		)
		.map((mapping) => mapping.id);
	expect(removed).toHaveLength(2);
	const deleted = resolve(first, original);
	const snapshot = deleted.snapshots.find(
		(snapshot) => snapshot.sourceHash !== original.snapshots[0].sourceHash,
	);
	if (!snapshot) throw new Error("Missing post-deletion snapshot");
	for (const id of removed) expect(snapshot.nodes[id].status).toBe("retired");
	const reinserted = resolve(first + second, deleted);
	expect(reinserted.exportable).toBe(true);
	for (const id of removed)
		expect(reinserted.sourceMappings.map((mapping) => mapping.id)).not.toContain(id);
});
