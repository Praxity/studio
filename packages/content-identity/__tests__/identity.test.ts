import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tokenizeLesson } from "../../grammar/src/v4/lex";
import { getDefinition } from "../../grammar/src/v4/schema";
import { analyzeLessonTree } from "../../grammar/src/v4/tree";
import {
	describeDocument,
	type IdentityMapping,
	type IdentityOperation,
	type IdentitySnapshot,
	invertIdentityMapping,
	lexicalScore,
	type OperationIntent,
	parseCourseIdentity,
	parseIdentitySnapshot,
	parseLessonHead,
	resolveIdentity,
	serializeIdentity,
} from "../src/index";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const course = { schema: 1 as const, courseId: uuid(1) };
function dependencies() {
	let n = 100;
	return { digest, allocateId: () => uuid(n++) };
}
const document = (source: string, path = "lesson.prax") => ({
	path,
	tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
});
const initial = (source: string) =>
	resolveIdentity(
		{ course, parsedDocuments: [document(source)], priorSnapshots: [] },
		dependencies(),
	);
const nodeOf = (snapshot: IdentitySnapshot, type: string) => {
	const entry = Object.entries(snapshot.nodes).find(([, node]) => node.type === type);
	if (!entry) throw new Error(`Missing ${type}`);
	return { id: entry[0], ...entry[1] };
};
const beforeText = "# Page\n::: note\nA sentence with a typo.\n:::\n";

function operation(
	before: ReturnType<typeof initial>,
	text: string,
	intent: OperationIntent,
	mapping: IdentityMapping[],
	placements: IdentityOperation["placements"] = [],
): IdentityOperation {
	return {
		intent,
		files: [
			{
				path: "lesson.prax",
				fromRevision: before.snapshots[0].sourceHash,
				toRevision: digest(text),
				fromSnapshot: before.heads[0].head,
			},
		],
		mapping,
		placements,
	};
}
function resolve(before: ReturnType<typeof initial>, text: string, op?: IdentityOperation) {
	return resolveIdentity(
		{
			course,
			parsedDocuments: [document(text)],
			priorSnapshots: before.snapshots,
			priorHeads: before.heads,
			operations: op ? [op] : [],
		},
		{
			digest,
			allocateId: (() => {
				let n =
					Math.max(
						499,
						...before.snapshots.flatMap((s) =>
							Object.keys(s.nodes).map((id) => Number.parseInt(id.slice(-12), 16)),
						),
					) + 1;
				return () => uuid(n++);
			})(),
		},
	);
}
const at = (mappingIndex: number, path: number[]) => ({ mappingIndex, file: "lesson.prax", path });

describe("I1 operation evidence", () => {
	it("D7 modify keeps the narrated root after a typo", () => {
		const before = initial(beforeText);
		const id = nodeOf(before.snapshots[0], "note").id;
		const text = beforeText.replace("typo", "correction");
		const after = resolve(
			before,
			text,
			operation(before, text, "modify", [{ oldId: id, newId: id, fate: "kept" }], [at(0, [0, 0])]),
		);
		expect(nodeOf(after.snapshots[0], "note").id).toBe(id);
		expect(after.mapping).toContainEqual({ oldId: id, newId: id, fate: "kept" });
	});
	it("D7 deliberate replacement allocates even when bytes are identical", () => {
		const before = initial(beforeText);
		const id = nodeOf(before.snapshots[0], "note").id;
		const after = resolve(
			before,
			beforeText,
			operation(
				before,
				beforeText,
				"replace",
				[
					{ oldId: id, newId: null, fate: "retired" },
					{ oldId: null, newId: null, fate: "new" },
				],
				[at(1, [0, 0])],
			),
		);
		const live = after.sourceMappings.find((m) => m.path.join() === "0,0");
		expect(live?.id).not.toBe(id);
		expect(after.snapshots[0].nodes[id].status).toBe("retired");
		expect(after.mapping).toContainEqual({ oldId: null, newId: live?.id, fate: "new" });
	});
	it("D7 copy assigns fresh IDs to the entire copied subtree", () => {
		const before = initial(beforeText);
		const id = nodeOf(before.snapshots[0], "note").id;
		const text = `${beforeText}::: note\nA sentence with a typo.\n:::\n`;
		const after = resolve(
			before,
			text,
			operation(
				before,
				text,
				"copy",
				[{ oldId: id, newId: null, fate: "copied" }],
				[at(0, [0, 1])],
			),
		);
		const original = after.sourceMappings.find((m) => m.path.join() === "0,0");
		const copy = after.sourceMappings.find((m) => m.path.join() === "0,1");
		expect(original?.id).toBe(id);
		expect(copy?.id).not.toBe(id);
		expect(after.snapshots[0].nodes[copy?.id ?? ""].lineage).toEqual([id]);
		expect(after.exportIds).toHaveLength(new Set(after.exportIds).size);
	});
	it("D8 split keeps only the explicitly chosen survivor", () => {
		const before = initial("# Page\nOld sentence.\n");
		const id = nodeOf(before.snapshots[0], "body").id;
		const text = "# Page\nNew sentence.\n\nOld sentence.\n";
		const after = resolve(
			before,
			text,
			operation(
				before,
				text,
				"split",
				[
					{ oldId: id, newId: id, fate: "survivor" },
					{ oldId: null, newId: null, fate: "new" },
				],
				[at(0, [0, 1]), at(1, [0, 0])],
			),
		);
		expect(after.sourceMappings.find((m) => m.path.join() === "0,1")?.id).toBe(id);
		expect(after.sourceMappings.find((m) => m.path.join() === "0,0")?.id).not.toBe(id);
	});
	it("D8 merge records absorption and does not duplicate the survivor", () => {
		const before = initial("# Page\nFirst.\n\nSecond.\n");
		const roots = before.sourceMappings.filter((m) => m.path.length === 2);
		const [a, b] = roots.map((m) => m.id);
		const text = "# Page\nFirst. Second.\n";
		const after = resolve(
			before,
			text,
			operation(
				before,
				text,
				"merge",
				[
					{ oldId: a, newId: a, fate: "survivor" },
					{ oldId: b, newId: a, fate: "absorbed" },
				],
				[at(0, [0, 0])],
			),
		);
		expect(after.snapshots[0].nodes[b].status).toBe("retired");
		expect(after.snapshots[0].nodes[a].lineage).toContain(b);
		expect(after.mapping).toContainEqual({ oldId: b, newId: a, fate: "absorbed" });
	});
	it("D20 cut stays attached and is excluded from export without blocking it", () => {
		const before = initial(beforeText);
		const id = nodeOf(before.snapshots[0], "note").id;
		const text = "# Page\n";
		const after = resolve(
			before,
			text,
			operation(before, text, "delete", [{ oldId: id, newId: null, fate: "cut" }]),
		);
		expect(after.snapshots[0].nodes[id].status).toBe("cut");
		expect(after.exportIds).not.toContain(id);
		expect(after.exportable).toBe(true);
		const pasted = resolve(
			after,
			beforeText,
			operation(
				after,
				beforeText,
				"move",
				[{ oldId: id, newId: id, fate: "kept" }],
				[at(0, [0, 0])],
			),
		);
		expect(pasted.exportIds).toContain(id);
		expect(pasted.sourceMappings.find((m) => m.path.join() === "0,0")?.id).toBe(id);
	});
	it("D9 invalid drafts preserve displaced children as pending, never retired", () => {
		const before = initial("# Page\n::: choice Q\n(x) Yes\n( ) No\n:::\n");
		const id = nodeOf(before.snapshots[0], "choice").id;
		const options = Object.entries(before.snapshots[0].nodes).filter(
			([, n]) => n.type === "option",
		);
		const text = "# Page\n::: choice Q\n(x\n";
		const after = resolve(
			before,
			text,
			operation(
				before,
				text,
				"modify",
				[{ oldId: id, newId: id, fate: "pending" }],
				[at(0, [0, 0])],
			),
		);
		for (const [optionId] of options)
			expect(after.snapshots[0].nodes[optionId].status).toBe("pending");
		expect(after.exportable).toBe(false);
	});
	it.each(["modify", "move", "convert"] as const)(
		"%s reuses the explicitly mapped ID",
		(intent) => {
			const before = initial(beforeText);
			const id = nodeOf(before.snapshots[0], "note").id;
			const text = intent === "convert" ? beforeText.replace("note", "text") : beforeText;
			const after = resolve(
				before,
				text,
				operation(before, text, intent, [{ oldId: id, newId: id, fate: "kept" }], [at(0, [0, 0])]),
			);
			expect(after.sourceMappings.find((m) => m.path.join() === "0,0")?.id).toBe(id);
		},
	);
	it("insert allocates and delete retires", () => {
		const before = initial("# Page\n");
		const after = resolve(
			before,
			beforeText,
			operation(
				before,
				beforeText,
				"insert",
				[{ oldId: null, newId: null, fate: "new" }],
				[at(0, [0, 0])],
			),
		);
		const id = nodeOf(after.snapshots[0], "note").id;
		const deleted = resolve(
			after,
			"# Page\n",
			operation(after, "# Page\n", "delete", [{ oldId: id, newId: null, fate: "retired" }]),
		);
		expect(deleted.snapshots[0].nodes[id].status).toBe("retired");
	});
	it.each(["replace", "copy", "split", "merge", "delete"] as const)(
		"inverse %s restores every original ID",
		(intent) => {
			const before = initial("# Page\nFirst.\n\nSecond.\n");
			const roots = before.sourceMappings.filter((m) => m.path.length === 2);
			const [a, b] = roots.map((m) => m.id);
			const text = intent === "delete" ? "# Page\nSecond.\n" : "# Page\nChanged.\n\nSecond.\n";
			const maps: IdentityMapping[] =
				intent === "merge"
					? [
							{ oldId: a, newId: a, fate: "survivor" },
							{ oldId: b, newId: a, fate: "absorbed" },
						]
					: intent === "split"
						? [
								{ oldId: a, newId: a, fate: "survivor" },
								{ oldId: null, newId: null, fate: "new" },
							]
						: intent === "copy"
							? [{ oldId: a, newId: null, fate: "copied" }]
							: [
									{ oldId: a, newId: null, fate: "retired" },
									...(intent === "replace"
										? [{ oldId: null, newId: null, fate: "new" as const }]
										: []),
								];
			// Supply the exact output placements; this tests identity undo, not source transforms.
			const placements = maps.flatMap((m, i) =>
				m.fate === "retired" || m.fate === "absorbed" ? [] : [at(i, i === 1 ? [0, 1] : [0, 0])],
			);
			const after = resolve(before, text, operation(before, text, intent, maps, placements));
			const inverse = invertIdentityMapping(after.mapping);
			const originalText = "# Page\nFirst.\n\nSecond.\n";
			const undo = operation(
				after,
				originalText,
				intent,
				inverse,
				inverse.flatMap((m, i) => {
					const old = before.sourceMappings.find((n) => n.id === m.newId);
					return old ? [at(i, old.path)] : [];
				}),
			);
			undo.inverse = true;
			const restored = resolve(after, originalText, undo);
			expect(restored.sourceMappings.map((m) => m.id)).toEqual(
				before.sourceMappings.map((m) => m.id),
			);
		},
	);
	it("rejects stale source/snapshot maps and duplicate kept claims", () => {
		const before = initial(beforeText);
		const id = nodeOf(before.snapshots[0], "note").id;
		const op = operation(
			before,
			beforeText,
			"modify",
			[{ oldId: id, newId: id, fate: "kept" }],
			[at(0, [0, 0])],
		);
		op.files[0].fromRevision = digest("stale");
		expect(() => resolve(before, beforeText, op)).toThrow(/revision/i);
		op.files[0].fromRevision = before.snapshots[0].sourceHash;
		op.files[0].fromSnapshot = digest("stale");
		expect(() => resolve(before, beforeText, op)).toThrow(/snapshot/i);
		op.files[0].fromSnapshot = before.heads[0].head;
		op.mapping.push(op.mapping[0]);
		op.placements.push(at(1, [0, 0]));
		expect(() => resolve(before, beforeText, op)).toThrow(/duplicate/i);
	});
});

describe("I1 exact matching", () => {
	it("reuses every ID after unchanged save and CRLF/NFC changes", () => {
		const before = initial(beforeText.replace("sentence", "caf\u00e9"));
		const after = resolve(
			before,
			beforeText.replace("sentence", "cafe\u0301").replaceAll("\n", "\r\n"),
		);
		expect(after.sourceMappings.map((m) => m.id)).toEqual(before.sourceMappings.map((m) => m.id));
	});
	it("external duplicate under one owner stays unresolved", () => {
		const before = initial("# Page\nIdentical.\n");
		const old = nodeOf(before.snapshots[0], "body").id;
		const after = resolve(before, "# Page\nIdentical.\n\nIdentical.\n");
		expect(after.unresolved.length).toBeGreaterThan(0);
		expect(after.exportable).toBe(false);
		expect(after.snapshots[0].nodes[old].status).toBe("pending");
		expect(
			after.sourceMappings.filter((m) => m.path.length === 2).every((m) => m.status === "pending"),
		).toBe(true);
	});
	it("unchanged duplicate sequences retain separate IDs under a stable owner", () => {
		const text = "# Page\nIdentical.\n\nIdentical.\n";
		const before = initial(text);
		expect(resolve(before, text).sourceMappings.map((m) => m.id)).toEqual(
			before.sourceMappings.map((m) => m.id),
		);
	});
	it("external rewording has no fuzzy fallback and never reuses a retired ID", () => {
		const before = initial(beforeText);
		const id = nodeOf(before.snapshots[0], "body").id;
		const after = resolve(before, beforeText.replace("typo", "different word"));
		expect(after.sourceMappings.some((m) => m.id === id)).toBe(false);
		const next = resolve(after, beforeText);
		expect(next.sourceMappings.some((m) => m.id === id)).toBe(false);
	});
	it("pure allocation rejects a duplicate allocator ID", () => {
		expect(() =>
			resolveIdentity(
				{ course, parsedDocuments: [document(beforeText)], priorSnapshots: [] },
				{ digest, allocateId: () => uuid(5) },
			),
		).toThrow(/duplicate/i);
	});
});

describe("I1 canonical semantics", () => {
	const canonical = (text: string) => describeDocument(document(text)).map((n) => n.canonical);
	it("uses G6 decoded semantics, omitting offsets and authored delimiter spelling", () => {
		expect(canonical("# Page\n**bold** and *italic* say \\!\n")).toEqual(
			canonical("# Page\n**bold** and *italic* say !\n"),
		);
	});
	it.each([
		["[link](https://one.test)", "[link](https://two.test)"],
		["[Term]{one definition}", "[Term]{another definition}"],
		["**bold**", "bold"],
		["@icon{mail}", "@icon{home}"],
		["{{one}}", "{{two}}"],
		["@source{one}", "@source{two}"],
		["@circle{word}", "@underline{word}"],
	])("retains semantic change %s", (a, b) => {
		expect(canonical(`# Page\n${a}\n`)).not.toEqual(canonical(`# Page\n${b}\n`));
	});
	it("retains names, settings, headings, answers and table cells", () => {
		for (const [a, b] of [
			["::: note {name=one tone=tip}\nText\n:::", "::: note {name=two tone=tip}\nText\n:::"],
			["::: note {tone=tip}\nText\n:::", "::: note {tone=warning}\nText\n:::"],
			["## Heading", "### Heading"],
			["::: choice Q\n(x) Yes\n( ) No\n:::", "::: choice Q\n( ) Yes\n(x) No\n:::"],
			["| A | B |\n|---|---|\n| 1 | 2 |", "| A | B |\n|---|---|\n| 1 | 3 |"],
		])
			expect(canonical(`# Page\n${a}\n`)).not.toEqual(canonical(`# Page\n${b}\n`));
	});
	it("independently addresses options, pairs, steps, categories, turns, card backs and blanks", () => {
		const source =
			"# Page\n::: choice Q\n(x) Yes\n( ) No\n:::\n::: match Q\n- A -> B\n- C -> D\n:::\n::: order Q\n1. A\n2. B\n:::\n::: categorize Q\n:: A\n- One\n:: B\n- Two\n:::\n::: dialogue\n- me: Hello\n:::\n::: cards\n:: Front\nText\n::: back\nBack\n:::\n:::\n::: fill-blank Q\nOne {answer} and ____\n:::\n";
		const types = describeDocument(document(source)).map((n) => n.type);
		for (const type of ["option", "pair", "step", "item", "turn", "back", "blank"])
			expect(types).toContain(type);
	});
	it("describes all five converted lessons without changing source bytes", () => {
		for (const path of [
			"leadership/00-avant-de-commencer",
			"leadership/01-affirmez-vous",
			"leadership/02-quatre-cavaliers",
			"leadership/03-resoudre-un-conflit",
			"toolkit/welcome",
		]) {
			const text = readFileSync(
				new URL(`../../grammar/__tests__/fixtures/v4/${path}.prax`, import.meta.url),
				"utf8",
			);
			const doc = document(text);
			const before = JSON.stringify(doc);
			expect(describeDocument(doc).length).toBeGreaterThan(2);
			expect(JSON.stringify(doc)).toBe(before);
		}
	});
	it("resolves and reloads the converted course set with stable IDs across line endings", () => {
		const paths = [
			"leadership/00-avant-de-commencer",
			"leadership/01-affirmez-vous",
			"leadership/02-quatre-cavaliers",
			"leadership/03-resoudre-un-conflit",
			"toolkit/welcome",
		];
		const documents = paths.map((path) =>
			document(
				readFileSync(
					new URL(`../../grammar/__tests__/fixtures/v4/${path}.prax`, import.meta.url),
					"utf8",
				),
				`${path}.prax`,
			),
		);
		const deps = dependencies();
		const before = resolveIdentity(
			{ course, parsedDocuments: documents, priorSnapshots: [] },
			deps,
		);
		const preservedInput = JSON.stringify(before.snapshots);
		const reloaded = resolveIdentity(
			{
				course,
				parsedDocuments: documents.map((d) =>
					document(d.tree.stream.source.replaceAll("\n", "\r\n"), d.path),
				),
				priorHeads: before.heads,
				priorSnapshots: before.snapshots,
			},
			deps,
		);
		expect(reloaded.sourceMappings.map((m) => m.id)).toEqual(
			before.sourceMappings.map((m) => m.id),
		);
		expect(JSON.stringify(before.snapshots)).toBe(preservedInput);
		expect(new Set(reloaded.exportIds).size).toBe(reloaded.exportIds.length);
	});
});

describe("I1 validated file schemas", () => {
	it("round-trips course, head and immutable snapshot", () => {
		const state = initial(beforeText);
		expect(parseCourseIdentity(serializeIdentity(course))).toEqual(course);
		expect(parseLessonHead(serializeIdentity(state.heads[0]))).toEqual(state.heads[0]);
		expect(
			parseIdentitySnapshot(serializeIdentity(state.snapshots[0]), {
				courseId: course.courseId,
				expectedHash: state.heads[0].head,
				digest,
			}),
		).toEqual(state.snapshots[0]);
	});
	it.each([
		["{bad", /corrupt JSON/],
		['{"schema":999}', /unknown schema/],
		["<<<<<<< ours\n{}\n=======\n{}\n>>>>>>> theirs", /conflict markers/],
	])("fails loudly on %s", (json, message) => {
		for (const parse of [parseCourseIdentity, parseLessonHead, parseIdentitySnapshot])
			expect(() => parse(json)).toThrow(message);
	});
	it("fails loudly on namespace, snapshot hash, graph and unsafe path errors", () => {
		const state = initial(beforeText);
		const snapshot = state.snapshots[0];
		expect(() => parseIdentitySnapshot(serializeIdentity(snapshot), { courseId: uuid(2) })).toThrow(
			/namespace/i,
		);
		expect(() =>
			parseIdentitySnapshot(serializeIdentity(snapshot), { expectedHash: digest("bad"), digest }),
		).toThrow(/hash/i);
		const id = snapshot.lessonId;
		expect(() =>
			parseIdentitySnapshot(
				serializeIdentity({
					...snapshot,
					nodes: { ...snapshot.nodes, [id]: { ...snapshot.nodes[id], parent: id } },
				}),
			),
		).toThrow(/parent|cycle/i);
		expect(() =>
			parseLessonHead(`{"schema":1,"path":"../outside.prax","head":"${digest("head")}"}`),
		).toThrow(/path/i);
		expect(() =>
			resolveIdentity(
				{
					course: { schema: 1, courseId: uuid(2) },
					parsedDocuments: [document(beforeText)],
					priorSnapshots: state.snapshots,
				},
				dependencies(),
			),
		).toThrow(/namespace/i);
	});
});

describe("I1 lexical L for I2 and D8", () => {
	it("half multiset token Dice plus half character-trigram Dice", () => {
		expect(lexicalScore("a a b", "a b b")).toBeCloseTo(0.5 * (4 / 6) + 0.5 * (2 / 6));
		expect(lexicalScore("Caf\u00e9\r\nWORD", "cafe\u0301 word")).toBe(1);
		expect(lexicalScore("", "")).toBe(1);
		expect(lexicalScore("ab", "ac")).toBe(0);
		expect(lexicalScore("one", "two")).toBe(0);
	});
});
