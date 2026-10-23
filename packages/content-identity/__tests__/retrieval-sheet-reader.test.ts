import { createHash } from "node:crypto";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { describeDocument, type IdentityResolution, resolveIdentity } from "../src/index";

it("keeps question IDs across reorder and page move, allocating fresh IDs on copy", () => {
	let next = 1;
	const dependencies = {
		digest: (s: string) => createHash("sha256").update(s).digest("hex"),
		allocateId: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`,
	};
	const a = ":: First question\nanswer: First answer\n";
	const b = ":: Second question\nanswer: Second answer\n";
	const source = (items: string) => `::: retrieval-sheet Topic\n${items}:::\n`;
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
				.filter((b) => b.type === "retrievalSheet")
				.flatMap(
					(block) =>
						(block.data.content as { questions: { id: string; question: string }[] }).questions,
				),
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
