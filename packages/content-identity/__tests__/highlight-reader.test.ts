import { createHash } from "node:crypto";
import { readHighlightContent, readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import {
	describeDocument,
	type IdentityOperation,
	type IdentityResolution,
	resolveIdentity,
} from "../src/index";

it("keeps highlight chunk IDs across reorder, page move and regrouping, allocating fresh IDs on copy", () => {
	let next = 1;
	const dependencies = {
		digest: (s: string) => createHash("sha256").update(s).digest("hex"),
		allocateId: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`,
	};
	const a = ":: First passage {key=true}\nnote: First explanation\n";
	const b = ":: Second passage\nnote: Second explanation\n";
	const source = (items: string) => `::: highlight Topic\n${items}:::\n`;
	const resolve = (
		sources: Record<string, string>,
		prior?: IdentityResolution,
		operations: IdentityOperation[] = [],
	) => {
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
				operations,
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
		const chunks = reads.flatMap((read) =>
			read.blocks
				.filter((b) => b.type === "highlight")
				.flatMap((block) => readHighlightContent(read, block.id).paragraphs.flat()),
		);
		return { state, chunks };
	};
	const before = resolve({ "lesson.prax": `# One\n${source(a + b)}# Two\n` });
	const after = resolve({ "lesson.prax": `# One\n# Two\n${source(b + a)}` }, before.state);
	expect(after.chunks).toEqual([before.chunks[1], before.chunks[0]]);
	const regrouped = resolve(
		{
			"lesson.prax": `# One\n# Two\n${source(b + a.replace("{key=true}", "{key=true paragraph=true}"))}`,
		},
		after.state,
	);
	expect(regrouped.chunks).toEqual(after.chunks);
	const grouped = source(b + a.replace("{key=true}", "{key=true paragraph=true}"));
	const itemCopy = a.replace("{key=true}", "{key=true paragraph=true}");
	const copiedSource = `# One\n# Two\n${source(b + itemCopy + itemCopy)}`;
	const donor = regrouped.state.sourceMappings.find((m) => m.id === regrouped.chunks[1].id);
	if (!donor) throw new Error("Missing copy donor");
	const copiedItem = resolve({ "lesson.prax": copiedSource }, regrouped.state, [
		{
			intent: "copy",
			files: [
				{
					path: "lesson.prax",
					fromSnapshot: regrouped.state.heads[0].head,
					fromRevision: dependencies.digest(`# One\n# Two\n${grouped}`),
					toRevision: dependencies.digest(copiedSource),
				},
			],
			mapping: [{ oldId: donor.id, newId: null, fate: "copied" }],
			placements: [
				{
					mappingIndex: 0,
					file: "lesson.prax",
					path: [...donor.path.slice(0, -1), donor.path.at(-1)! + 1],
				},
			],
		},
	]);
	expect(copiedItem.chunks.slice(0, 2)).toEqual(regrouped.chunks);
	expect(copiedItem.chunks[2]).toMatchObject({
		text: "First passage",
		key: true,
		note: "First explanation",
	});
	expect(regrouped.chunks.map((c) => c.id)).not.toContain(copiedItem.chunks[2].id);
	const copied = resolve(
		{ "lesson.prax": `# One\n# Two\n${grouped}`, "copy.prax": `# Copy\n${grouped}` },
		regrouped.state,
	);
	expect(copied.chunks.slice(0, 2)).toEqual(after.chunks);
	const originals = new Set(after.chunks.map((q) => q.id));
	for (const q of copied.chunks.slice(2)) expect(originals.has(q.id)).toBe(false);
	expect(new Set(copied.chunks.map((q) => q.id)).size).toBe(4);
	for (const q of copied.chunks) expect(q.id).toMatch(/^[A-Za-z0-9_-]{1,120}$/);
});
