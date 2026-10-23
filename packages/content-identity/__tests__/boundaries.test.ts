import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { tokenizeLesson } from "../../grammar/src/v4/lex";
import { getDefinition } from "../../grammar/src/v4/schema";
import { analyzeLessonTree } from "../../grammar/src/v4/tree";
import {
	describeDocument,
	type IdentityOperation,
	invertIdentityMapping,
	resolveIdentity,
	serializeIdentity,
} from "../src/index";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const course = { schema: 1 as const, courseId: uuid(1) };
const doc = (source: string, path = "a.prax") => ({
	path,
	tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
});
function session(source: string) {
	let n = 10;
	const deps = { digest, allocateId: () => uuid(n++) };
	const before = resolveIdentity(
		{ course, parsedDocuments: [doc(source)], priorSnapshots: [] },
		deps,
	);
	return { before, deps };
}
const text = "# Page\n::: cards\n:: Front\nWords\n::: back\nMore words\n:::\n:::\n";

describe("I1 descendant and history boundaries", () => {
	it("canonical settings use schema types and inline errors make drafts pending", () => {
		expect(
			describeDocument(doc("# Page\n::: cards {shuffle}\n:: A\nWords\n:::\n")).map(
				(d) => d.canonical,
			),
		).toEqual(
			describeDocument(doc("# Page\n::: cards {shuffle=true}\n:: A\nWords\n:::\n")).map(
				(d) => d.canonical,
			),
		);
		const { deps } = session("# Page\n");
		const invalid = resolveIdentity(
			{ course, parsedDocuments: [doc("# Page\n@icon{INVALID}\n")], priorSnapshots: [] },
			deps,
		);
		expect(invalid.exportable).toBe(false);
		expect(invalid.sourceMappings.at(-1)?.status).toBe("pending");
	});
	it("D20 cut/paste restores every nested ID and does not churn an unchanged head", () => {
		const { before, deps } = session(text);
		const root = before.sourceMappings.find((m) => m.path.join() === "0,0")?.id as string;
		const apply = (
			state: typeof before,
			source: string,
			intent: IdentityOperation["intent"],
			mapping: IdentityOperation["mapping"],
			placements: IdentityOperation["placements"],
		) =>
			resolveIdentity(
				{
					course,
					priorHeads: state.heads,
					priorSnapshots: state.snapshots,
					parsedDocuments: [doc(source)],
					operations: [
						{
							intent,
							mapping,
							placements,
							files: [
								{
									path: "a.prax",
									fromSnapshot: state.heads[0].head,
									fromRevision: state.snapshots[0].sourceHash,
									toRevision: digest(source),
								},
							],
						},
					],
				},
				deps,
			);
		const cut = apply(
			before,
			"# Page\n",
			"delete",
			[{ oldId: root, newId: null, fate: "cut" }],
			[],
		);
		const after = apply(
			cut,
			text,
			"move",
			[{ oldId: root, newId: root, fate: "kept" }],
			[{ mappingIndex: 0, file: "a.prax", path: [0, 0] }],
		);
		expect(after.sourceMappings.map((m) => m.id)).toEqual(before.sourceMappings.map((m) => m.id));
		expect(after.exportable).toBe(true);
		const saved = resolveIdentity(
			{
				course,
				priorHeads: after.heads,
				priorSnapshots: after.snapshots,
				parsedDocuments: [doc(text)],
			},
			deps,
		);
		expect(saved.heads).toEqual(after.heads);
	});
	it("D9 inverse of a newly inserted pending draft retires it; continuing pending restores the old ID", () => {
		expect(invertIdentityMapping([{ oldId: null, newId: uuid(10), fate: "pending" }])).toEqual([
			{ oldId: uuid(10), newId: null, fate: "retired" },
		]);
		expect(invertIdentityMapping([{ oldId: uuid(11), newId: uuid(11), fate: "pending" }])).toEqual([
			{ oldId: uuid(11), newId: uuid(11), fate: "kept" },
		]);
	});
	it("undo maps do not resurrect retirement records from earlier history", () => {
		const { before, deps } = session("# Page\nOld.\n");
		const retired = resolveIdentity(
			{
				course,
				priorHeads: before.heads,
				priorSnapshots: before.snapshots,
				parsedDocuments: [doc("# Page\nNew.\n")],
			},
			deps,
		);
		const historicId = before.sourceMappings.at(-1)?.id;
		const saved = resolveIdentity(
			{
				course,
				priorHeads: retired.heads,
				priorSnapshots: retired.snapshots,
				parsedDocuments: [doc("# Page\nNew.\n")],
			},
			deps,
		);
		expect(saved.mapping.some((m) => m.oldId === historicId)).toBe(false);
		expect(saved.inverseMapping.some((m) => m.newId === historicId)).toBe(false);
	});
	it("code whitespace changes remain semantic changes", () => {
		const a = describeDocument(doc("# Page\n```js\nx = 'a  b';\n```\n")).at(-1)?.canonical;
		const b = describeDocument(doc("# Page\n```js\nx = 'a b';\n```\n")).at(-1)?.canonical;
		expect(a).not.toBe(b);
	});
	it("a cross-lesson recorded move preserves all descendant IDs", () => {
		let n = 10;
		const deps = { digest, allocateId: () => uuid(n++) };
		const before = resolveIdentity(
			{
				course,
				parsedDocuments: [doc(text), doc("# Destination\n", "b.prax")],
				priorSnapshots: [],
			},
			deps,
		);
		const id = before.sourceMappings.find((m) => m.file === "a.prax" && m.path.join() === "0,0")
			?.id as string;
		const moved = `# Destination\n${text.slice("# Page\n".length)}`;
		const after = resolveIdentity(
			{
				course,
				priorHeads: before.heads,
				priorSnapshots: before.snapshots,
				parsedDocuments: [doc("# Page\n"), doc(moved, "b.prax")],
				operations: [
					{
						intent: "move",
						mapping: [{ oldId: id, newId: id, fate: "kept" }],
						placements: [{ mappingIndex: 0, file: "b.prax", path: [0, 0] }],
						files: before.heads.map((head) => ({
							path: head.path,
							fromSnapshot: head.head,
							fromRevision: before.snapshots.find((s) => digest(serializeIdentity(s)) === head.head)
								?.sourceHash as string,
							toRevision: digest(head.path === "a.prax" ? "# Page\n" : moved),
						})),
					},
				],
			},
			deps,
		);
		expect(
			after.sourceMappings
				.filter((m) => m.file === "b.prax" && m.path.length >= 2)
				.map((m) => m.id),
		).toEqual(
			before.sourceMappings
				.filter((m) => m.file === "a.prax" && m.path.length >= 2)
				.map((m) => m.id),
		);
		expect(new Set(after.exportIds).size).toBe(after.exportIds.length);
	});
	it("fails closed on a copied existing UUID, source conflicts, duplicate active IDs and invalid digest", () => {
		const { before, deps } = session(text);
		const id = before.sourceMappings.at(-1)?.id as string;
		expect(() =>
			resolveIdentity(
				{
					course,
					priorSnapshots: [before.snapshots[0], { ...before.snapshots[0], lessonId: uuid(99) }],
					parsedDocuments: [],
				},
				deps,
			),
		).toThrow();
		expect(() =>
			resolveIdentity(
				{
					course,
					priorSnapshots: [],
					parsedDocuments: [doc("# Page\n<<<<<<< ours\nText\n=======\nOther\n>>>>>>> theirs")],
				},
				deps,
			),
		).toThrow(/conflict/i);
		expect(() =>
			resolveIdentity(
				{ course, priorSnapshots: [], parsedDocuments: [doc(text)] },
				{ ...deps, digest: () => "bad" },
			),
		).toThrow(/hash/i);
		expect(() =>
			resolveIdentity(
				{
					course,
					priorSnapshots: before.snapshots,
					priorHeads: before.heads,
					parsedDocuments: [doc(text)],
					operations: [
						{
							intent: "copy",
							files: [
								{
									path: "a.prax",
									fromRevision: before.snapshots[0].sourceHash,
									toRevision: digest(text),
									fromSnapshot: before.heads[0].head,
								},
							],
							mapping: [{ oldId: id, newId: id, fate: "copied" }],
							placements: [{ mappingIndex: 0, file: "a.prax", path: [0, 0] }],
						},
					],
				},
				deps,
			),
		).toThrow(/duplicate|fresh/i);
	});
	it("a copy gives every descendant a copied fate and donor lineage", () => {
		const { before, deps } = session(text);
		const id = before.sourceMappings.find((m) => m.path.join() === "0,0")?.id as string;
		const source = text + text.slice("# Page\n".length);
		const after = resolveIdentity(
			{
				course,
				priorHeads: before.heads,
				priorSnapshots: before.snapshots,
				parsedDocuments: [doc(source)],
				operations: [
					{
						intent: "copy",
						files: [
							{
								path: "a.prax",
								fromSnapshot: before.heads[0].head,
								fromRevision: digest(text),
								toRevision: digest(source),
							},
						],
						mapping: [{ oldId: id, newId: null, fate: "copied" }],
						placements: [{ mappingIndex: 0, file: "a.prax", path: [0, 1] }],
					},
				],
			},
			deps,
		);
		const copied = after.sourceMappings.filter((m) => m.path[1] === 1);
		for (const target of copied) {
			const original = before.sourceMappings.find(
				(m) => m.path.join() === [0, 0, ...target.path.slice(2)].join(),
			);
			expect(after.mapping).toContainEqual({
				oldId: original?.id,
				newId: target.id,
				fate: "copied",
			});
			expect(after.snapshots[0].nodes[target.id].lineage).toContain(original?.id);
		}
	});
	it("insert can map a new invalid draft as pending and undo removes its ID", () => {
		const { before, deps } = session("# Page\n");
		const source = "# Page\n::: choice Q\n";
		const after = resolveIdentity(
			{
				course,
				priorHeads: before.heads,
				priorSnapshots: before.snapshots,
				parsedDocuments: [doc(source)],
				operations: [
					{
						intent: "insert",
						files: [
							{
								path: "a.prax",
								fromSnapshot: before.heads[0].head,
								fromRevision: before.snapshots[0].sourceHash,
								toRevision: digest(source),
							},
						],
						mapping: [{ oldId: null, newId: null, fate: "pending" }],
						placements: [{ mappingIndex: 0, file: "a.prax", path: [0, 0] }],
					},
				],
			},
			deps,
		);
		const draft = after.sourceMappings.find((m) => m.path.join() === "0,0");
		expect(draft?.status).toBe("pending");
		expect(after.inverseMapping).toContainEqual({ oldId: draft?.id, newId: null, fate: "retired" });
	});
	it("an operation cannot revive a retired identity as an ordinary modify", () => {
		const { before, deps } = session("# Page\nOld.\n");
		const oldId = before.sourceMappings.at(-1)?.id as string;
		const retired = resolveIdentity(
			{
				course,
				priorHeads: before.heads,
				priorSnapshots: before.snapshots,
				parsedDocuments: [doc("# Page\nNew.\n")],
			},
			deps,
		);
		expect(() =>
			resolveIdentity(
				{
					course,
					priorHeads: retired.heads,
					priorSnapshots: retired.snapshots,
					parsedDocuments: [doc("# Page\nNew.\n")],
					operations: [
						{
							intent: "modify",
							files: [
								{
									path: "a.prax",
									fromSnapshot: retired.heads[0].head,
									fromRevision: retired.snapshots[0].sourceHash,
									toRevision: digest("# Page\nNew.\n"),
								},
							],
							mapping: [{ oldId: oldId, newId: oldId, fate: "kept" }],
							placements: [{ mappingIndex: 0, file: "a.prax", path: [0, 0] }],
						},
					],
				},
				deps,
			),
		).toThrow(/retired/i);
	});
	it("G6 errors preserve displaced old IDs as pending even when the structural tree is valid", () => {
		const { before, deps } = session("# Page\n@icon{mail}\n");
		const id = before.sourceMappings.at(-1)?.id as string;
		const after = resolveIdentity(
			{
				course,
				priorHeads: before.heads,
				priorSnapshots: before.snapshots,
				parsedDocuments: [doc("# Page\n@icon{INVALID}\n")],
			},
			deps,
		);
		expect(after.snapshots[0].nodes[id].status).toBe("pending");
		expect(after.mapping).not.toContainEqual({ oldId: id, newId: null, fate: "retired" });
	});
});
