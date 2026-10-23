import { createHash } from "node:crypto";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { expect, it } from "vitest";
import { invertIdentityMapping, resolveIdentity, serializeIdentity } from "../src";

it("page identity reserves persistent slugs and title aliases across later insertions", () => {
	const digest = (s: string) => createHash("sha256").update(s).digest("hex");
	let counter = 1;
	const dependencies = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${(counter++).toString(16).padStart(12, "0")}`,
	};
	const parse = (source: string) => ({
		path: "lesson.prax",
		tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
	});
	const initial = resolveIdentity(
		{ parsedDocuments: [parse("# Original\nBody\n")], priorSnapshots: [] },
		dependencies,
	);
	const page = initial.sourceMappings.find((m) => m.path.length === 1);
	if (!page) throw new Error("page");
	const renamedSource = "# New title\nBody\n";
	const renamed = resolveIdentity(
		{
			course: initial.course,
			priorSnapshots: initial.snapshots,
			priorHeads: initial.heads,
			parsedDocuments: [parse(renamedSource)],
			operations: [
				{
					intent: "modify",
					files: [
						{
							path: "lesson.prax",
							fromRevision: initial.snapshots[0].sourceHash,
							toRevision: digest(renamedSource),
							fromSnapshot: digest(serializeIdentity(initial.snapshots[0])),
						},
					],
					mapping: [{ oldId: page.id, newId: page.id, fate: "kept" }],
					placements: [{ mappingIndex: 0, file: "lesson.prax", path: [0] }],
				},
			],
		},
		dependencies,
	);
	expect(renamed.snapshots[0].nodes[page.id]).toMatchObject({
		slug: "original",
		aliases: ["new-title"],
	});
	const insertedSource = renamedSource + "\n# Original\nNew body\n\n# New title\nOther body\n";
	const files = [
		{
			path: "lesson.prax",
			fromRevision: digest(renamedSource),
			toRevision: digest(insertedSource),
			fromSnapshot: renamed.heads[0].head,
		},
	];
	const inserted = resolveIdentity(
		{
			course: renamed.course,
			priorSnapshots: renamed.snapshots,
			priorHeads: renamed.heads,
			parsedDocuments: [parse(insertedSource)],
			operations: [
				{
					intent: "modify",
					files,
					mapping: [{ oldId: page.id, newId: page.id, fate: "kept" }],
					placements: [{ mappingIndex: 0, file: "lesson.prax", path: [0] }],
				},
				{
					intent: "insert",
					files,
					mapping: [
						{ oldId: null, newId: null, fate: "new" },
						{ oldId: null, newId: null, fate: "new" },
					],
					placements: [
						{ mappingIndex: 0, file: "lesson.prax", path: [1] },
						{ mappingIndex: 1, file: "lesson.prax", path: [2] },
					],
				},
			],
		},
		dependencies,
	);
	const pages = inserted.sourceMappings
		.filter((m) => m.path.length === 1)
		.map((m) => inserted.snapshots[0].nodes[m.id]);
	expect(pages.map((p) => p.slug)).toEqual(["original", "original-2", "new-title-2"]);
});
it("a moved cut inverses to cut, while a copy from cut inverses to retirement", () => {
	const id = "00000000-0000-4000-8000-000000000001",
		copy = "00000000-0000-4000-8000-000000000002";
	expect(
		invertIdentityMapping([{ oldId: id, newId: id, fate: "kept" }], new Set(), new Set([id])),
	).toEqual([{ oldId: id, newId: null, fate: "cut" }]);
	expect(
		invertIdentityMapping([{ oldId: id, newId: copy, fate: "copied" }], new Set(), new Set([id])),
	).toEqual([{ oldId: copy, newId: null, fate: "retired" }]);
});
