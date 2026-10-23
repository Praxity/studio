import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { type IdentityResolution, resolveIdentity } from "@praxity/content-identity";
import type {
	OperationRequest,
	OperationResult,
	OperationTarget,
} from "@praxity/grammar/src/operations/contract.ts";
import { applyEdits } from "@praxity/grammar/src/source-edit.ts";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { describe, expect, it } from "vitest";
import { applyOperation, canvasTextField } from "../src";

const file = "lesson.prax";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const document = (source: string) => ({
	path: file,
	tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
});
function fixture(source: string) {
	let next = 1;
	const dependencies = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`,
	};
	const identity = resolveIdentity(
		{ parsedDocuments: [document(source)], priorSnapshots: [] },
		dependencies,
	);
	const target = (type: string, ordinal = 0): OperationTarget => {
		const map = identity.sourceMappings.filter(
			(m) => identity.snapshots[0].nodes[m.id].type === type,
		)[ordinal];
		return {
			file,
			ref: { kind: "node", nodeId: map.id, path: map.path, fingerprint: map.fingerprint },
			expectedText: source.slice(map.span.start, map.span.end),
		};
	};
	const run = (operation: string, targets: OperationTarget[], args: Record<string, unknown> = {}) =>
		applyOperation(
			[{ path: file, source }],
			{
				transactionId: "test",
				operation,
				files: [{ path: file, baseRevision: digest(source) }],
				targets,
				args,
			},
			{ identity, ...dependencies },
		);
	return { source, identity, dependencies, target, run };
}
function applied(result: ReturnType<typeof applyOperation>) {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.code);
	return result;
}
function undo(
	f: ReturnType<typeof fixture>,
	result: OperationResult & { identity: IdentityResolution },
) {
	const after = applyEdits(f.source, result.files[0].edits);
	expect(applyEdits(after, result.inverse.files[0].edits)).toBe(f.source);
	const mapping = result.inverse.mapping;
	const restored = resolveIdentity(
		{
			course: f.identity.course,
			parsedDocuments: [document(f.source)],
			priorSnapshots: result.identity.snapshots,
			priorHeads: result.identity.heads,
			operations: [
				{
					intent: result.intent,
					inverse: true,
					files: [
						{
							path: file,
							fromRevision: digest(after),
							toRevision: digest(f.source),
							fromSnapshot: result.identity.heads[0].head,
						},
					],
					mapping,
					placements: mapping.flatMap((m, mappingIndex) => {
						const original = f.identity.sourceMappings.find((p) => p.id === m.newId);
						return original && !["retired", "absorbed", "cut"].includes(m.fate)
							? [{ mappingIndex, file, path: original.path }]
							: [];
					}),
				},
			],
		},
		f.dependencies,
	);
	expect(restored.sourceMappings.map((m) => m.id)).toEqual(
		f.identity.sourceMappings.map((m) => m.id),
	);
}
function boundary(
	f: ReturnType<typeof fixture>,
	parentType: string,
	after: string | null,
	before: string | null,
): OperationTarget {
	const parent = f.target(parentType).ref;
	return {
		file,
		ref: {
			kind: "insertion",
			parentId: parent.kind === "node" ? parent.nodeId : null,
			after,
			before,
		},
	};
}
const id = (target: OperationTarget) => (target.ref.kind === "node" ? target.ref.nodeId : null);

function kept(
	f: ReturnType<typeof fixture>,
	result: ReturnType<typeof applied>,
	targets: OperationTarget[],
) {
	for (const target of targets)
		expect(result.mapping).toContainEqual({ oldId: id(target), newId: id(target), fate: "kept" });
	undo(f, result);
}

describe("O3 items and columns", () => {
	it.each(["up", "down"])(
		"E11 moving the last child out of a one-column container, %s",
		(direction) => {
			const f = fixture("# Page\n::: columns\n::\nOnly\n:::\n\nTail\n");
			const result = applied(f.run("moveBlocks", [f.target("body")], { direction }));
			expect(applyEdits(f.source, result.files[0].edits)).not.toContain("::");
			expect(applyEdits(f.source, result.files[0].edits)).toContain("Only");
			kept(f, result, [f.target("body"), f.target("body", 1)]);
		},
	);
	it("E11 moving a column item within its owner never dissolves it", () => {
		const f = fixture("# Page\n::: columns\n:: {weight=1}\nLeft\n:: {weight=2}\nRight\n:::\n");
		const result = applied(f.run("moveItem", [f.target("item", 1)], { direction: "up" }));
		expect(applyEdits(f.source, result.files[0].edits)).toContain(
			"::: columns\n\n:: {weight=2}\nRight\n\n:: {weight=1}\nLeft",
		);
		kept(f, result, [
			f.target("columns"),
			f.target("item"),
			f.target("item", 1),
			f.target("body"),
			f.target("body", 1),
		]);
	});
	it("E11 moving a whole column away dissolves its former owner but keeps the item", () => {
		const f = fixture(
			"# Page\n::: columns\n:: Left\nOne\n:: Right\nTwo\n:::\n\n::: accordion\n:: Third\nThree\n:::\n",
		);
		const result = applied(
			f.run("moveItem", [
				f.target("item"),
				boundary(f, "accordion", id(f.target("item", 2)), null),
			]),
		);
		expect(applyEdits(f.source, result.files[0].edits)).not.toContain("columns");
		kept(f, result, [
			f.target("item"),
			f.target("body"),
			f.target("body", 1),
			f.target("accordion"),
		]);
	});
	it.each(["up", "down"])(
		"E5 comparison can reorder but cannot move an item away, %s",
		(direction) => {
			const f = fixture(
				"# Page\n::: comparison\n:: A\nOne\n:: B\nTwo\n:::\n\n::: tabs\n:: C\nThree\n:::\n",
			);
			const result = applied(
				f.run("moveItem", [f.target("item", direction === "up" ? 1 : 0)], { direction }),
			);
			kept(f, result, [f.target("item"), f.target("item", 1), f.target("comparison")]);
			expect(
				f.run("moveItem", [f.target("item"), boundary(f, "tabs", id(f.target("item", 2)), null)]),
			).toMatchObject({ ok: false, code: "not-allowed" });
		},
	);
	it("E5 moving the last item removes its old container and guards every retirement", () => {
		const f = fixture(
			"---\ntitle: Lesson\n---\n# Page\n::: accordion\n:: A\n::: note\nSame\n:::\n:::\n\n::: tabs\n:: B\nSame\n:::\n",
		);
		const result = applied(
			f.run("moveItem", [f.target("item"), boundary(f, "tabs", id(f.target("item", 1)), null)]),
		);
		expect(applyEdits(f.source, result.files[0].edits)).not.toContain("accordion");
		for (const map of result.mapping.filter((m) => m.fate === "retired"))
			expect(result.inverse.guards).toContainEqual(
				expect.objectContaining({ kind: "deleted", nodeId: map.oldId }),
			);
		kept(f, result, [f.target("item"), f.target("note"), f.target("body")]);
	});
	it("E5 addItem refuses an escaping item draft", () => {
		const f = fixture("# Page\n::: accordion\n:: First\nWords\n:::\n\nTail\n");
		for (const text of [
			":: Added\n:::\nEscaped\n",
			":: Added\n# Escape\n",
			":: Added\n:: Another\nWords\n",
		])
			expect(f.run("addItem", [f.target("accordion")], { text })).toMatchObject({
				ok: false,
				code: "escapes-range",
			});
	});
	it("E11 three columns lose only the emptied item", () => {
		const f = fixture(
			"# Page\n::: columns\n:: {weight=1}\nFirst\n:: {weight=2}\nSecond\n:: {weight=3}\nThird\n:::\n\nTail\n",
		);
		const result = applied(f.run("moveBlocks", [f.target("body", 1)], { direction: "up" }));
		expect(applyEdits(f.source, result.files[0].edits)).toContain(
			":: {weight=1}\nFirst\n:: {weight=3}\nThird",
		);
		kept(f, result, [
			f.target("columns"),
			f.target("item"),
			f.target("item", 2),
			f.target("body", 1),
		]);
	});
	it("E11 nested dissolution reaches the outer columns in one inverse", () => {
		const f = fixture(
			"# Page\n::: columns\n::\n::: columns\n::\nOne\n::\nTwo\n:::\n::\nThree\n:::\n\nTail\n",
		);
		const result = applied(f.run("deleteBlocks", [f.target("body"), f.target("body", 1)]));
		expect(applyEdits(f.source, result.files[0].edits)).not.toContain("::");
		kept(f, result, [f.target("body", 2), f.target("body", 3)]);
	});
	it("E11 column weights can add missing values and change the length of earlier headers", () => {
		const f = fixture("# Page\n::: columns\n:: {name=left}\nLeft\n::\nRight\n:::\n");
		const result = applied(f.run("setColumnWeights", [f.target("columns")], { weights: [100, 1] }));
		expect(applyEdits(f.source, result.files[0].edits)).toContain(
			":: {name=left weight=100}\nLeft\n:: {weight=1}\nRight",
		);
		kept(f, result, [
			f.target("columns"),
			f.target("item"),
			f.target("item", 1),
			f.target("body"),
			f.target("body", 1),
		]);
	});
	it("E11 wrap refuses nonadjacent selections and item handles", () => {
		const f = fixture("# Page\nFirst\n\nSecond\n\nThird\n\n::: accordion\n:: A\nWords\n:::\n");
		expect(f.run("wrapInColumns", [f.target("body"), f.target("body", 2)])).toMatchObject({
			ok: false,
			code: "not-allowed",
		});
		expect(f.run("wrapInColumns", [f.target("item")])).toMatchObject({
			ok: false,
			code: "not-allowed",
		});
	});
	it("O3 byte and mapping gate: 1,000 seeds include every item and column operation", () => {
		const coverage = new Set<string>();
		for (let seed = 1; seed <= 1000; seed++) {
			let random = seed;
			const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
			let line = 0;
			const eol = () => (seed % 3 === 0 ? "\n" : seed % 3 === 1 || line++ % 2 ? "\r\n" : "\n");
			const choice = seed % 9;
			const columns = [5, 6, 7, 8].includes(choice);
			const wrap = choice === 4;
			const body = columns
				? "::: columns\n:: {weight=1}\nLeft\n:: {weight=1}\nRight\n:::\n"
				: wrap
					? "::: note\nSame\n:::\n\n::: note\nSame\n:::\n"
					: `::: accordion\n:: First\nText ${next()} e\u0301\u202f?\n:: Second\nText ${next()} 😀\n:: Third\nThird\n:::\n`;
			const source =
				`${seed % 2 ? "\uFEFF" : ""}# Café 😀\n\n${body}\nTail\n# Next\nUntouched\n`.replace(
					/\n/gu,
					eol,
				);
			const f = fixture(source);
			const type = columns ? "columns" : wrap ? "note" : "accordion";
			const owner = f.target(type);
			const operation = [
				"addItem",
				"removeItem",
				"moveItem",
				"editSource",
				"wrapInColumns",
				"unwrapColumns",
				"setColumnWeights",
				"moveBlocks",
				"deleteBlocks",
			][choice];
			coverage.add(operation);
			const member = wrap
				? owner
				: columns
					? f.target("body", choice === 7 && seed % 2 ? 1 : 0)
					: f.target("item", 1);
			const targets = wrap
				? [owner, f.target("note", 1)]
				: [0, 5, 6].includes(choice)
					? [owner]
					: [member];
			const args =
				choice === 0
					? { text: `:: New ${seed}\nNew body\n`, position: seed % 2 ? "before" : "after" }
					: choice === 2
						? { direction: seed % 2 ? "up" : "down" }
						: choice === 3
							? { text: `${member.expectedText?.replace(/\r\n/gu, "\n")}:: New ${seed}\nAdded\n` }
							: choice === 6
								? { weights: [60, 40] }
								: choice === 7
									? { direction: seed % 2 ? "down" : "up" }
									: {};
			const result = applied(f.run(operation, targets, args));
			const after = applyEdits(source, result.files[0].edits);
			expect(
				document(after).tree.diagnostics.filter((d) => d.severity === "error"),
				`seed ${seed}`,
			).toEqual([]);
			expect(result.identity.exportable, `seed ${seed}`).toBe(true);
			const ownerMap = f.identity.sourceMappings.find((m) => m.id === id(owner));
			const last = wrap
				? f.identity.sourceMappings.find((m) => m.id === id(f.target("note", 1)))
				: ownerMap;
			const owned = { start: ownerMap?.span.start ?? -1, end: last?.span.end ?? -1 };
			let oldCursor = 0;
			let newCursor = 0;
			for (const edit of result.files[0].edits) {
				expect(edit.start, `seed ${seed}`).toBeGreaterThanOrEqual(owned.start);
				expect(edit.end, `seed ${seed}`).toBeLessThanOrEqual(owned.end);
				const count = edit.start - oldCursor;
				expect(Buffer.from(after.slice(newCursor, newCursor + count))).toEqual(
					Buffer.from(source.slice(oldCursor, edit.start)),
				);
				oldCursor = edit.end;
				newCursor += count + edit.text.length;
			}
			expect(Buffer.from(after.slice(newCursor))).toEqual(Buffer.from(source.slice(oldCursor)));
			const continuing = result.mapping
				.filter((m) => m.fate === "kept" || m.fate === "survivor")
				.map((m) => m.newId);
			expect(new Set(continuing).size).toBe(continuing.length);
			for (const old of f.identity.sourceMappings)
				expect(
					result.mapping.some((m) => m.oldId === old.id),
					`seed ${seed}, ${old.id}`,
				).toBe(true);
			for (const map of result.mapping.filter((m) => m.fate === "retired"))
				expect(result.inverse.guards).toContainEqual(
					expect.objectContaining({ kind: "deleted", nodeId: map.oldId }),
				);
			undo(f, result);
		}
		expect(coverage.size).toBe(9);
	}, 30_000);
	it.each([false, true])("E5 item lifecycle in a nested accordion: %s", (nested) => {
		const content = "::: accordion\n:: First\nOne\n:: Second\nTwo\n:: Third\nThree\n:::\n";
		const f = fixture(
			`# Page\n${nested ? `::: columns\n::\n${content}::\nOther\n:::\n` : content}# Next\nTail\n`,
		);
		const first = nested ? 1 : 0;
		for (const position of ["before", "after"]) {
			const result = applied(
				f.run("addItem", [f.target("item", first + 1)], { position, text: ":: Added\nNew\n" }),
			);
			const after = applyEdits(f.source, result.files[0].edits);
			expect(after).toContain(
				position === "before"
					? "One\n\n:: Added\nNew\n\n:: Second"
					: "Two\n\n:: Added\nNew\n\n:: Third",
			);
			kept(f, result, [f.target("accordion"), f.target("item", first + 1), f.target("body", 1)]);
		}
		const moved = applied(f.run("moveItem", [f.target("item", first + 1)], { direction: "up" }));
		expect(applyEdits(f.source, moved.files[0].edits).indexOf(":: Second")).toBeLessThan(
			applyEdits(f.source, moved.files[0].edits).indexOf(":: First"),
		);
		kept(f, moved, [f.target("item", first + 1), f.target("body", 1)]);
		for (const [ordinal, direction] of [
			[first, "up"],
			[first + 2, "down"],
		] as const)
			expect(f.run("moveItem", [f.target("item", ordinal)], { direction })).toMatchObject({
				ok: false,
				code: "not-allowed",
			});
		const removed = applied(f.run("removeItem", [f.target("item", first + 1)]));
		expect(applyEdits(f.source, removed.files[0].edits)).not.toContain(":: Second");
		kept(f, removed, [f.target("accordion"), f.target("item", first)]);
		const renamed = applied(
			f.run("setText", [f.target("item", first)], { field: "subject", text: "Renamed" }),
		);
		kept(f, renamed, [f.target("item", first), f.target("body")]);
	});
	it("E5 adding to a zero-item container and untouched insertion draft", () => {
		const f = fixture("# Page\n::: accordion\n:::\n\nTail\n");
		const untouched = applied(f.run("addItem", [f.target("accordion")], { text: ":: " }));
		expect(untouched.files[0].edits).toEqual([]);
		undo(f, untouched);
		const added = applied(f.run("addItem", [f.target("accordion")], { text: ":: First\nWords\n" }));
		expect(applyEdits(f.source, added.files[0].edits)).toBe(
			"# Page\n::: accordion\n\n:: First\nWords\n\n:::\n\nTail\n",
		);
		expect(added.identity.exportable).toBe(true);
		kept(f, added, [f.target("accordion"), f.target("body")]);
	});
	it("E5 titleless added body remains pending", () => {
		const f = fixture("# Page\n::: tabs\n:: First\nWords\n:::\n");
		const result = applied(f.run("addItem", [f.target("tabs")], { text: "::\nNew body\n" }));
		expect(result.identity.exportable).toBe(false);
		expect(result.diagnostics.length).toBeGreaterThan(0);
		undo(f, result);
	});
	it.each(["removeItem", "deleteBlocks", "editSource"])(
		"E5 last item removes its container through %s",
		(operation) => {
			const f = fixture("# Page\n::: accordion\n:: Only\nWords\n:::\n\nTail\n");
			const result = applied(
				f.run(operation, [f.target("item")], operation === "editSource" ? { text: "" } : {}),
			);
			expect(applyEdits(f.source, result.files[0].edits)).toBe("# Page\nTail\n");
			for (const type of ["accordion", "item"])
				expect(result.mapping).toContainEqual({
					oldId: id(f.target(type)),
					newId: null,
					fate: "retired",
				});
			undo(f, result);
		},
	);
	it.each(["removeItem", "deleteBlocks", "editSource"])(
		"E5 comparison minimum through %s",
		(operation) => {
			const f = fixture("# Page\n::: comparison\n:: A\nOne\n:: B\nTwo\n:::\n");
			expect(
				f.run(operation, [f.target("item")], operation === "editSource" ? { text: "" } : {}),
			).toMatchObject({ ok: false, code: "not-allowed", member: id(f.target("item")) });
		},
	);
	it("E5 typed :: splits an item and keeps exact descendants", () => {
		const f = fixture(
			"# Page\n::: accordion\n:: Original\nWords stay\n\n::: note\nNested\n:::\n:: Last\nTail\n:::\n",
		);
		const result = applied(
			f.run("editSource", [f.target("item")], {
				text: ":: New\nFresh\n:: Original\nWords stay\n\n::: note\nNested\n:::\n",
			}),
		);
		expect(result.intent).toBe("split");
		expect(result.mapping).toContainEqual({
			oldId: id(f.target("item")),
			newId: id(f.target("item")),
			fate: "survivor",
		});
		kept(f, result, [f.target("note"), f.target("body", 1), f.target("item", 1)]);
	});
	it("E5 move items between containers keeps their subtree IDs", () => {
		const f = fixture(
			"# Page\n::: accordion\n:: First\nSame\n:: Second\nSame\n:::\n\n::: tabs\n:: Third\nSame\n:::\n",
		);
		const result = applied(
			f.run("moveItem", [f.target("item", 1), boundary(f, "tabs", id(f.target("item", 2)), null)]),
		);
		expect(applyEdits(f.source, result.files[0].edits)).toContain(
			":: Third\nSame\n\n:: Second\nSame",
		);
		kept(f, result, [
			f.target("item", 1),
			f.target("body", 1),
			f.target("accordion"),
			f.target("tabs"),
		]);
	});
	it("E11 wrap adjacent blocks and preserve duplicate nested identities", () => {
		const f = fixture("# Page\n::: note\nSame\n:::\n\n::: note\nSame\n:::\n\nTail\n");
		const result = applied(f.run("wrapInColumns", [f.target("note"), f.target("note", 1)]));
		expect(applyEdits(f.source, result.files[0].edits)).toContain(
			"::: columns\n:: {weight=1}\n::: note\nSame\n:::\n\n:: {weight=1}\n::: note\nSame\n:::\n:::",
		);
		expect(result.identity.exportable).toBe(true);
		expect(result.focus.nodeId).toBe(id(f.target("note")));
		kept(f, result, [
			f.target("note"),
			f.target("note", 1),
			f.target("body"),
			f.target("body", 1),
			f.target("body", 2),
		]);
	});
	it("E11 split into columns creates an empty second column", () => {
		const f = fixture("# Page\nWords\n\nTail\n");
		const result = applied(f.run("wrapInColumns", [f.target("body")]));
		expect(applyEdits(f.source, result.files[0].edits)).toContain(
			":: {weight=1}\nWords\n:: {weight=1}\n:::\n",
		);
		kept(f, result, [f.target("body"), f.target("body", 1)]);
	});
	it("E11 unwrap columns keeps every child in column order", () => {
		const f = fixture(
			"# Page\n::: columns\n:: {weight=3}\n::: note\nSame\n:::\n\nMore\n:: {weight=2}\n::: note\nSame\n:::\n:::\n\nTail\n",
		);
		const result = applied(f.run("unwrapColumns", [f.target("columns")]));
		const after = applyEdits(f.source, result.files[0].edits);
		expect(after).not.toContain("columns");
		expect(after).not.toContain("weight");
		expect(after).toContain("::: note\nSame\n:::\n\nMore\n\n::: note\nSame\n:::\n");
		expect(result.focus.nodeId).toBe(id(f.target("note")));
		kept(f, result, [
			f.target("note"),
			f.target("note", 1),
			f.target("body"),
			f.target("body", 1),
			f.target("body", 2),
			f.target("body", 3),
		]);
	});
	it("E11 weights 60:40 become 3:2 and change only header tokens", () => {
		const f = fixture(
			'# Page\n::: columns\n:: {weight=1 name="left"}\nLeft\n:: {weight=1}\nRight\n:::\n',
		);
		const result = applied(f.run("setColumnWeights", [f.target("columns")], { weights: [60, 40] }));
		expect(applyEdits(f.source, result.files[0].edits)).toBe(
			f.source.replace("weight=1 name", "weight=3 name").replace(":: {weight=1}", ":: {weight=2}"),
		);
		kept(f, result, [
			f.target("columns"),
			f.target("item"),
			f.target("item", 1),
			f.target("body"),
			f.target("body", 1),
		]);
	});
	it.each(
		[[0, 1], [-1, 1], [1], [1.5, 2], [NaN, 1], [Infinity, 1], [Number.MAX_SAFE_INTEGER + 1, 1]].map(
			(weights) => ({ weights }),
		),
	)("E11 invalid weights refuse $weights", ({ weights }) => {
		const f = fixture("# Page\n::: columns\n::\nLeft\n::\nRight\n:::\n");
		expect(f.run("setColumnWeights", [f.target("columns")], { weights })).toMatchObject({
			ok: false,
			code: "invalid-args",
		});
	});
	it("E11 move into a column keeps IDs", () => {
		const f = fixture("# Page\nBefore\n\n::: columns\n::\nLeft\n::\nRight\n:::\n");
		const result = applied(
			f.run("moveBlocks", [f.target("body"), boundary(f, "item", null, id(f.target("body", 1)))]),
		);
		expect(applyEdits(f.source, result.files[0].edits)).toContain("::\n\nBefore\n\nLeft");
		kept(f, result, [f.target("body"), f.target("columns"), f.target("item")]);
	});
	it.each(["up", "down"])("E11 last block out dissolves two columns, %s", (direction) => {
		const f = fixture("# Page\n::: columns\n::\nLeft\n::\nRight\n:::\n\nTail\n");
		const result = applied(
			f.run("moveBlocks", [f.target("body", direction === "up" ? 0 : 1)], { direction }),
		);
		const after = applyEdits(f.source, result.files[0].edits);
		expect(after).not.toContain("::");
		expect(after.indexOf("Left")).toBeLessThan(after.indexOf("Right"));
		kept(f, result, [f.target("body"), f.target("body", 1), f.target("body", 2)]);
		for (const type of ["columns", "item"])
			expect(result.mapping).toContainEqual({
				oldId: id(f.target(type)),
				newId: null,
				fate: "retired",
			});
	});
	it("E11 deletion dissolves empty columns, retaining remaining bytes", () => {
		const f = fixture("# Page\n::: columns\n::\nLeft\n::\nRight\n:::\n\nTail\n");
		const result = applied(f.run("deleteBlocks", [f.target("body")]));
		expect(applyEdits(f.source, result.files[0].edits)).not.toContain("::");
		kept(f, result, [f.target("body", 1), f.target("body", 2)]);
	});
});

describe("O1 public registry", () => {
	it.each(["__proto__", "constructor", "toString"])(
		"unknown operation %s returns an argument refusal",
		(operation) => {
			const f = fixture("# Page\nWords\n");
			expect(f.run(operation, [f.target("body")], { text: "Changed" })).toMatchObject({
				ok: false,
				code: "invalid-args",
			});
		},
	);
	it("duplicate preserves every authored line ending inside the copied subtree", () => {
		const f = fixture("# Page\r\n::: note\nMixed\r\n:::\n\nNeighbour\n");
		const original = f.target("note");
		const result = applied(f.run("duplicateBlocks", [original]));
		const copy = result.identity.sourceMappings.find((m) =>
			result.mapping.some(
				(map) => map.oldId === id(original) && map.newId === m.id && map.fate === "copied",
			),
		);
		expect(copy).toBeDefined();
		const after = applyEdits(f.source, result.files[0].edits);
		expect(after.slice(copy?.span.start, copy?.span.end)).toBe(original.expectedText);
		undo(f, result);
	});
	it("deletion guards cover the removed root and every descendant identity", () => {
		const f = fixture("# Page\n::: note\nWords\n:::\n");
		const result = applied(f.run("deleteBlocks", [f.target("note")]));
		const deleted = result.inverse.guards.filter((g) => g.kind === "deleted").map((g) => g.nodeId);
		expect(deleted.sort()).toEqual([id(f.target("note")), id(f.target("body"))].sort());
	});
	it("delete focuses the next sibling, then the previous, then the parent", () => {
		const f = fixture("# Page\nFirst\n\nLast\n");
		const first = applied(f.run("deleteBlocks", [f.target("body", 0)]));
		expect(first.focus.nodeId).toBe(id(f.target("body", 1)));
		const last = applied(f.run("deleteBlocks", [f.target("body", 1)]));
		expect(last.focus.nodeId).toBe(id(f.target("body", 0)));
		const all = applied(f.run("deleteBlocks", [f.target("body", 0), f.target("body", 1)]));
		expect(all.focus.nodeId).toBe(id(f.target("page")));
	});
	it("deleteBlocks removes adjacent last siblings as one reversible range", () => {
		const f = fixture("# Page\nFirst\n\nLast\n");
		const result = applied(f.run("deleteBlocks", [f.target("body", 0), f.target("body", 1)]));
		expect(applyEdits(f.source, result.files[0].edits)).toBe("# Page\n");
		undo(f, result);
	});
	it("written-node edits have written guards, without invented insertion slots", () => {
		const f = fixture("# Page\n::: note {tone=note}\nWords\n:::\n");
		const result = applied(
			f.run("setProperty", [f.target("note")], { name: "tone", value: "tip" }),
		);
		expect(result.inverse.guards).toHaveLength(1);
		expect(result.inverse.guards[0]).toMatchObject({
			kind: "written",
			text: "::: note {tone=tip}\nWords\n:::\n",
		});
	});
	it("editing one file keeps an unrelated lesson's snapshot and IDs active", () => {
		const f = fixture("# Page\nFirst\n");
		const second = { path: "second.prax", tree: document("# Other\nKeep\n").tree };
		const identity = resolveIdentity(
			{
				course: f.identity.course,
				parsedDocuments: [document(f.source), second],
				priorSnapshots: f.identity.snapshots,
				priorHeads: f.identity.heads,
			},
			f.dependencies,
		);
		const result = applied(
			applyOperation(
				[
					{ path: file, source: f.source },
					{ path: second.path, source: second.tree.stream.source },
				],
				{
					transactionId: "test",
					operation: "editSource",
					targets: [f.target("body")],
					files: [{ path: file, baseRevision: digest(f.source) }],
					args: { text: "Changed\n" },
				},
				{ identity, ...f.dependencies },
			),
		);
		expect(result.identity.heads.find((h) => h.path === second.path)).toEqual(
			identity.heads.find((h) => h.path === second.path),
		);
		expect(result.identity.sourceMappings.filter((m) => m.file === second.path)).toEqual(
			identity.sourceMappings.filter((m) => m.file === second.path),
		);
		expect(result.identity.exportable).toBe(true);
	});
	it("an invalid inline draft keeps its displaced descendant pending", () => {
		const f = fixture("# Page\n::: note\n@icon{mail}\n:::\n");
		const result = applied(
			f.run("editSource", [f.target("note")], { text: "::: note\n@icon{INVALID}\n" }),
		);
		expect(result.identity.snapshots[0].nodes[id(f.target("body")) ?? ""].status).toBe("pending");
		expect(result.identity.exportable).toBe(false);
		expect(result.diagnostics.length).toBeGreaterThan(0);
		undo(f, result);
	});
	it("insertBlock rejects a malformed argument even with a valid type", () => {
		const f = fixture("# Page\n");
		expect(
			f.run("insertBlock", [boundary(f, "page", null, null)], { text: 4, type: "note" }),
		).toMatchObject({ ok: false, code: "invalid-args" });
	});
	it.each(["Name ", " Name", "\tName\t", " Name "])(
		"break-ui B trims subject edge spaces only: %j",
		(text) => {
			const f = fixture("# Page {hideTitle}\n## Original\nKeep.\n");
			const result = applied(f.run("setText", [f.target("heading")], { field: "subject", text }));
			expect(applyEdits(f.source, result.files[0].edits)).toBe(
				"# Page {hideTitle}\n## Name\nKeep.\n",
			);
			undo(f, result);
		},
	);
	it.each(["Name ", " Name", "\tName\t"])(
		"break-ui B trims page title edges and preserves settings: %j",
		(text) => {
			const f = fixture("# Original {hideTitle}\nKeep.\n");
			const result = applied(f.run("setText", [f.target("page")], { field: "subject", text }));
			expect(applyEdits(f.source, result.files[0].edits)).toBe("# Name {hideTitle}\nKeep.\n");
			undo(f, result);
		},
	);
	it.each([
		["body", "text", "2026. Une année", "list-marker"],
		["body", "text", "1. Lisez", "list-marker"],
		["body", "text", "- New list", "list-marker"],
		["body", "text", "First\n1. Lisez", "list-marker"],
		["heading", "subject", "Voir {page 3}", "settings"],
		["page", "subject", "Voir {hideTitle}", "settings"],
	])("break-ui B reports the structural refusal: %s %s %j", (kind, field, text, code) => {
		const f = fixture("# Page\n## Original\nKeep.\n");
		expect(f.run("setText", [f.target(kind)], { field, text })).toMatchObject({ ok: false, code });
	});
	it.each(["Title {hideTitle}", "Voir {page 3} pour", "Voir {page 3}"])(
		"break-ui B names malformed or duplicate heading settings: %j",
		(text) => {
			const f = fixture("# Page\n## Original {level=3}\nKeep.\n");
			expect(f.run("setText", [f.target("heading")], { field: "subject", text })).toMatchObject({
				ok: false,
				code: "settings",
			});
		},
	);
	it("break-ui B preserves interior spaces, tabs, NBSP and paragraph edge spaces", () => {
		const f = fixture("# Page\n## Original\nKeep.\n");
		const heading = applied(
			f.run("setText", [f.target("heading")], { field: "subject", text: " Name  with\ttabs " }),
		);
		expect(applyEdits(f.source, heading.files[0].edits)).toBe(
			"# Page\n## Name  with\ttabs\nKeep.\n",
		);
		const nbsp = applied(
			f.run("setText", [f.target("heading")], { field: "subject", text: "Name\u00a0" }),
		);
		expect(applyEdits(f.source, nbsp.files[0].edits)).toBe("# Page\n## Name\u00a0\nKeep.\n");
		const body = applied(
			f.run("setText", [f.target("body")], { field: "text", text: " Keep spaces " }),
		);
		expect(applyEdits(f.source, body.files[0].edits)).toBe("# Page\n## Original\n Keep spaces \n");
	});
	it("setText preserves the containing item ID and untouched body", () => {
		const f = fixture("# Page\n::: cards\n:: Original\nWords\n:::\n");
		const result = applied(
			f.run("setText", [f.target("item")], { field: "subject", text: "Corrected" }),
		);
		expect(applyEdits(f.source, result.files[0].edits)).toBe(
			f.source.replace(":: Original", ":: Corrected"),
		);
		expect(result.mapping).toContainEqual({
			oldId: id(f.target("body")),
			newId: id(f.target("body")),
			fate: "kept",
		});
		undo(f, result);
	});
	it.each([
		"# Page\n\n- Parent\n  - Child\n    - Grandchild\n\nTail.",
		"\uFEFF# Page\r\n\r\n- Parent\r\n  - Child\r\n    - Grandchild\r\n\r\nTail.",
		"# Page\r\r- Parent\r  - Child\r    - Grandchild\r\rTail.",
		"# Page\r\n\n- Parent\r\n  - Child\n    - Grandchild\r\n\nTail.",
	])("canvas parent list fields change only their own bytes: %j", (source) => {
		const f = fixture(source);
		const tree = document(source).tree;
		const nodes = [...tree.root.children.flatMap((page) => page.children)];
		const visit = (node: (typeof nodes)[number]): (typeof nodes)[number][] => [
			node,
			...node.children.flatMap(visit),
		];
		const parent = nodes.flatMap(visit).find((node) => node.kind === "list-entry");
		if (!parent) throw new Error("Missing parent list item");
		expect(canvasTextField(parent, undefined, tree.stream)).toEqual({
			field: "text",
			text: "Parent",
			range: { start: source.indexOf("Parent"), end: source.indexOf("Parent") + 6 },
		});
		const result = applied(
			f.run("setText", [f.target("list-entry")], { field: "text", text: "Revised *parent*" }),
		);
		expect(Buffer.from(applyEdits(source, result.files[0].edits))).toEqual(
			Buffer.from(source.replace("Parent", "Revised *parent*")),
		);
		expect(result.identity.sourceMappings.map((mapping) => mapping.id)).toEqual(
			f.identity.sourceMappings.map((mapping) => mapping.id),
		);
	});
	it.each(
		["# Page\n\n- Original\n", "# Page\n\n- Original\n  - Child\n    - Grandchild\n"].flatMap(
			(source) => ["1. x", "2026. Une année", "1. Primero"].map((text) => [source, text]),
		),
	)("setText accepts numeric prefixes in %j as list text: %j", (source, text) => {
		const f = fixture(source);
		const result = applied(f.run("setText", [f.target("list-entry")], { field: "text", text }));
		expect(applyEdits(source, result.files[0].edits)).toBe(source.replace("Original", text));
		expect(result.identity.sourceMappings.map(({ id, path }) => ({ id, path }))).toEqual(
			f.identity.sourceMappings.map(({ id, path }) => ({ id, path })),
		);
	});
	it.each([
		["- x", "unsupported-syntax"],
		["Parent\n  - x", "list-marker"],
		["Parent\n  1. x", "list-marker"],
		["Parent\n\nExtra", "unsupported-syntax"],
		["\n", "empty-text"],
	])("setText refuses structure in a parent list field: %j", (text, code) => {
		const f = fixture("# Page\n\n- Parent\n  - Child\n    - Grandchild\n");
		expect(f.run("setText", [f.target("list-entry")], { field: "text", text })).toMatchObject({
			ok: false,
			code,
		});
	});
	it("setText refuses a pasted bullet marker in a leaf list field", () => {
		const f = fixture("# Page\n\n- Leaf\n");
		expect(
			f.run("setText", [f.target("list-entry")], { field: "text", text: "- x" }),
		).toMatchObject({ ok: false, code: "unsupported-syntax" });
	});
	it("C06a review refuses a status-only change to an existing fill-blank through ordinary setText", () => {
		const f = fixture("# Page\n::: fill-blank Q\nVerify {a} now.\n:::\n");
		expect(
			f.run("setText", [f.target("body")], { field: "text", text: "Verify now." }),
		).toMatchObject({ ok: false, code: "unsupported-syntax" });
	});
	it("moveBlocks preserves every identity in an identical nested subtree", () => {
		const f = fixture("# Page\n::: note\nSame\n:::\n\n::: note\nSame\n:::\n");
		const result = applied(f.run("moveBlocks", [f.target("note", 1)], { direction: "up" }));
		for (const target of [f.target("note", 1), f.target("body", 1)])
			expect(result.mapping).toContainEqual({ oldId: id(target), newId: id(target), fate: "kept" });
		expect(
			result.identity.sourceMappings
				.filter((m) => result.identity.snapshots[0].nodes[m.id].type === "note")
				.map((m) => m.id),
		).toEqual([id(f.target("note", 1)), id(f.target("note", 0))]);
		undo(f, result);
	});
	it.each([
		[{ name: "tone", value: "tip" }, "::: note {tone=tip}"],
		[{ name: "tone", value: null }, "::: note "],
	])("setProperty adds and removes braces with exact undo %j", (args, opener) => {
		const f = fixture(
			`# Page\n${args.value === null ? "::: note {tone=note}" : "::: note"}\nWords\n:::\n`,
		);
		const result = applied(f.run("setProperty", [f.target("note")], args));
		expect(applyEdits(f.source, result.files[0].edits)).toBe(`# Page\n${opener}\nWords\n:::\n`);
		undo(f, result);
	});
	it("insertion boundary guards name actual adjacent siblings", () => {
		const f = fixture("# Page\n::: note\nWords\n:::\n");
		const result = applied(
			f.run("insertBlock", [boundary(f, "page", id(f.target("note")), null)], { text: "Inserted" }),
		);
		for (const guard of result.inverse.guards) {
			if (guard.kind !== "insertion-boundary") continue;
			const snapshot = result.identity.snapshots[0];
			const siblings = result.identity.sourceMappings.filter(
				(m) => snapshot.nodes[m.id].parent === guard.ref.parentId,
			);
			const afterIndex = guard.ref.after ? siblings.findIndex((m) => m.id === guard.ref.after) : -1;
			const beforeIndex = guard.ref.before
				? siblings.findIndex((m) => m.id === guard.ref.before)
				: siblings.length;
			expect(beforeIndex).toBe(afterIndex + 1);
		}
	});
	it.each([
		["modify", "::: note\nA typo.\n:::\n", "::: note\nA correction.\n"],
		["convert", "::: note Title\nWords\n:::\n", "::: quote\nWords\n"],
		["delete", "Original words\n", "   "],
		["split", "Original words\n", "New words\n\nOriginal words\n"],
	])("D7 %s and exact undo", (intent, block, text) => {
		const f = fixture(`# Page\n${block}\nUntouched\n`);
		const target = f.target(block.startsWith(":::") ? "note" : "body");
		const result = applied(f.run("editSource", [target], { text }));
		expect(result.intent).toBe(intent);
		expect(result.mapping).toContainEqual({
			oldId: id(target),
			newId: intent === "delete" ? null : id(target),
			fate: intent === "delete" ? "retired" : intent === "split" ? "survivor" : "kept",
		});
		undo(f, result);
	});
	it("D7 unchanged card back keeps its ID without similarity", () => {
		const f = fixture("# Page\n::: cards\n:: Card\nFront\n::: back\nBack\n:::\n:::\n");
		const result = applied(
			f.run("editSource", [f.target("cards")], {
				text: "::: cards\n:: Card\nCorrected front\n::: back\nBack\n:::\n",
			}),
		);
		expect(result.mapping).toContainEqual({
			oldId: id(f.target("back")),
			newId: id(f.target("back")),
			fate: "kept",
		});
		undo(f, result);
	});
	it("D7 duplicate option preserves the unique original, new duplicate gets a new ID", () => {
		const f = fixture("# Page\n::: choice Question\n(x) Yes\n( ) No\n:::\n");
		const result = applied(
			f.run("editSource", [f.target("choice")], {
				text: "::: choice Question\n(x) Yes\n( ) No\n( ) No\n",
			}),
		);
		expect(result.mapping).toContainEqual({
			oldId: id(f.target("option", 0)),
			newId: id(f.target("option", 0)),
			fate: "kept",
		});
		const duplicates = result.identity.sourceMappings.filter(
			(m) =>
				result.identity.snapshots[0].nodes[m.id].type === "option" &&
				result.identity.snapshots[0].nodes[m.id].matchText.includes("No"),
		);
		expect(duplicates).toHaveLength(2);
		expect(duplicates[0].id).toBe(id(f.target("option", 1)));
		expect(duplicates[1].id).not.toBe(id(f.target("option", 1)));
		expect(result.mapping).toContainEqual({
			oldId: id(f.target("option", 1)),
			newId: id(f.target("option", 1)),
			fate: "kept",
		});
		undo(f, result);
	});
	it.each([
		["New sentence\n\nOriginal paragraph\n", 1],
		["Same\n\nSame\n", 0],
	])("D8 lexical survivor %s", (text, ordinal) => {
		const f = fixture(`# Page\n${ordinal ? "Original paragraph" : "Same Same"}\n`);
		const result = applied(f.run("editSource", [f.target("body")], { text }));
		const bodies = result.identity.sourceMappings.filter(
			(m) => result.identity.snapshots[0].nodes[m.id].type === "body",
		);
		expect(bodies[ordinal].id).toBe(id(f.target("body")));
		undo(f, result);
	});
	it.each([
		"::: note {tone=purple}\nWords\n",
		"::: nonsense\nWords\n",
		"::: choice\n(x) Yes\n( ) No\n",
	])("D9 contained invalid draft %s", (text) => {
		const f = fixture("# Page\n::: note\nOriginal\n:::\n\nNeighbour\n");
		const result = applied(f.run("editSource", [f.target("note")], { text }));
		expect(result.intent).toBe("modify");
		expect(result.diagnostics.length).toBeGreaterThan(0);
		expect(result.mapping).toContainEqual({
			oldId: id(f.target("note")),
			newId: id(f.target("note")),
			fate: "pending",
		});
		undo(f, result);
	});
	it.each([
		":::\nWords\n",
		"# Escaped\n",
		":: Outside\n",
		"```\ncode\n",
		"::: note\nWords\n::: note\nMore\n",
	])("D9 escaping draft refused %s", (text) => {
		const f = fixture("# Page\n::: note\nOriginal\n:::\n\nNeighbour\n");
		expect(f.run("editSource", [f.target("note")], { text })).toMatchObject({
			ok: false,
			code: "escapes-range",
		});
	});
	it.each([
		["::: self-check Task\n:: Criterion\nmissed: Hint\n", "missing-part", 2],
		["::: self-check Task\nmodel:\n:: Criterion\nmissed: Hint\n", "empty-part", 3],
		[
			"::: self-check Task\nmodel: Model\nmodel: Again\n:: Criterion\nmissed: Hint\n",
			"duplicate-part",
			4,
		],
	])(
		"self-check diagnostic %s retains its field name through source editing",
		(text, code, line) => {
			const f = fixture("# Page\n::: note\nOriginal\n:::\n");
			const result = applied(f.run("editSource", [f.target("note")], { text }));
			expect(
				result.diagnostics.find((diagnostic) => diagnostic.message.key === `op.diagnostic.${code}`)
					?.message,
			).toEqual({
				key: `op.diagnostic.${code}`,
				params: { line, column: 1, name: "model" },
			});
		},
	);
	it("a no-op self-check source edit keeps CRLF bytes", () => {
		const source =
			"# Page\r\n::: self-check Task\r\nmodel: Model\r\n  more\r\n\r\n  again\r\n:: Criterion\r\nmissed: Hint\r\nevidence: Model\r\n:::\r\n\r\nAfter\r\n";
		const f = fixture(source);
		// An editSource draft omits the closer; the file keeps its own line endings.
		const text =
			"::: self-check Task\nmodel: Model\n  more\n\n  again\n:: Criterion\nmissed: Hint\nevidence: Model\n";
		const result = applied(f.run("editSource", [f.target("self-check")], { text }));
		expect(applyEdits(source, result.files[0].edits)).toBe(source);
	});
	it("inserting a self-check has no publication refusal", () => {
		const f = fixture("# Page\n::: note\nOriginal\n:::\n");
		const result = applied(
			f.run("insertBlock", [boundary(f, "page", id(f.target("note")), null)], {
				type: "self-check",
			}),
		);
		expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([]);
	});
	it("pasting a valid self-check has no publication refusal", () => {
		const f = fixture("# Page\n::: note\nOriginal\n:::\n");
		const at = boundary(f, "page", id(f.target("note")), null);
		const valid = "::: self-check Task\nmodel: Model\n:: Criterion\nmissed: Hint\n:::\n";
		const result = applied(f.run("pasteBlocks", [at], { text: valid }));
		expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([]);
		// Any other error still refuses the paste.
		expect(f.run("pasteBlocks", [at], { text: valid.replace("model: Model\n", "") })).toMatchObject(
			{ ok: false, code: "escapes-range" },
		);
	});
	it("replaces a block with a valid self-check template and restores it on undo", () => {
		const f = fixture("# Page\n::: note\nOriginal\n:::\n");
		const result = applied(f.run("replaceBlock", [f.target("note")], { type: "self-check" }));
		expect(applyEdits(f.source, result.files[0].edits)).toBe(
			"# Page\n::: self-check Explain why the report needs another day.\nmodel: The data arrived late. Could I send the report on Tuesday?\n:: Reason for the delay\nmissed: Explain what caused the delay.\nevidence: The data arrived late.\n:: New delivery date\nmissed: Propose a specific delivery date.\nevidence: Tuesday\n:::\n",
		);
		expect(result.diagnostics).toEqual([]);
		undo(f, result);
	});
	it("D18 mixed endings, BOM, emoji and unowned trivia survive byte for byte", () => {
		const f = fixture(
			"\uFEFF# Café 😀\r\n\r\n::: note {tone=note}\nCafé 😀\r\n:::\r\n\nNeighbour\u202f?\n",
		);
		const target = f.target("note");
		const result = applied(
			f.run("editSource", [target], { text: "::: note {tone=tip}\nEdited\n" }),
		);
		const after = applyEdits(f.source, result.files[0].edits);
		expect(after).toBe(
			"\uFEFF# Café 😀\r\n\r\n::: note {tone=tip}\r\nEdited\r\n:::\r\n\nNeighbour\u202f?\n",
		);
		for (const edit of result.files[0].edits) {
			const map = f.identity.sourceMappings.find((m) => m.id === id(target));
			expect(edit.start).toBeGreaterThanOrEqual(map?.span.start ?? -1);
			expect(edit.end).toBeLessThanOrEqual(map?.span.end ?? -1);
		}
		undo(f, result);
	});
	it.each([
		"# Page\n::: accordion\n:: Item\nWords\n:::\n# Next\nNext\n",
		"# Page\n::: columns\n::\n::: accordion\n:: Item\nWords\n:::\n::\nOther\n:::\n",
	])("E10 insert after container preserves closers in %j", (source) => {
		const f = fixture(source);
		const accordion = f.target("accordion");
		const parentType = source.includes("columns") ? "item" : "page";
		const result = applied(
			f.run("insertBlock", [boundary(f, parentType, id(accordion), null)], { text: "Inserted" }),
		);
		const after = applyEdits(source, result.files[0].edits);
		expect(after).toBe(source.replace("Words\n:::\n", "Words\n:::\n\nInserted\n\n"));
		undo(f, result);
	});
	it("K4 moving up at the first column block leaves its parent", () => {
		const f = fixture("# Page\nBefore\n\n::: columns\n::\nFirst\n\nSecond\n::\nOther\n:::\n");
		const result = applied(f.run("moveBlocks", [f.target("body", 1)], { direction: "up" }));
		expect(applyEdits(f.source, result.files[0].edits)).toBe(
			"# Page\nBefore\n\nFirst\n\n::: columns\n::\n\nSecond\n::\nOther\n:::\n",
		);
		expect(result.mapping).toContainEqual({
			oldId: id(f.target("body", 1)),
			newId: id(f.target("body", 1)),
			fate: "kept",
		});
		undo(f, result);
	});
	it("setProperty changes one token beside a quoted raw neighbour", () => {
		const f = fixture('# Page\n::: note {tone=note icon="bulb"}\nWords\n:::\n');
		const result = applied(
			f.run("setProperty", [f.target("note")], { name: "tone", value: "tip" }),
		);
		expect(result.files[0].edits).toEqual([
			{
				start: f.source.indexOf("tone=note") + 5,
				end: f.source.indexOf("tone=note") + 9,
				text: "tip",
			},
		]);
		expect(applyEdits(f.source, result.files[0].edits)).toBe(
			f.source.replace("tone=note", "tone=tip"),
		);
		undo(f, result);
	});
	it.each(["deleteBlocks", "duplicateBlocks", "setText"])(
		"%s maps touched identities and undoes exactly",
		(operation) => {
			const f = fixture("# Page\n::: note Title\nWords\n:::\n\nNeighbour\n");
			const result = applied(
				f.run(
					operation,
					[f.target("note")],
					operation === "setText" ? { field: "subject", text: "Changed" } : {},
				),
			);
			const fate =
				operation === "deleteBlocks"
					? "retired"
					: operation === "duplicateBlocks"
						? "copied"
						: "kept";
			expect(result.mapping.some((m) => m.oldId === id(f.target("note")) && m.fate === fate)).toBe(
				true,
			);
			undo(f, result);
		},
	);
	it("stale revision and invalid arguments refuse without edits", () => {
		const f = fixture("# Page\nWords\n");
		const request: OperationRequest = {
			transactionId: "test",
			operation: "editSource",
			files: [{ path: file, baseRevision: "0".repeat(64) }],
			targets: [f.target("body")],
			args: { text: "New" },
		};
		expect(
			applyOperation([{ path: file, source: f.source }], request, {
				identity: f.identity,
				...f.dependencies,
			}),
		).toMatchObject({ ok: false, code: "stale" });
		expect(f.run("editSource", [f.target("body")], { text: 4 })).toMatchObject({
			ok: false,
			code: "invalid-args",
		});
	});
	it("operation output contains message keys, no interface sentences", () => {
		const directory = new URL("../src/", import.meta.url);
		for (const name of readdirSync(directory).filter((n) => n.endsWith(".ts"))) {
			const source = readFileSync(new URL(name, directory), "utf8");
			expect(source).not.toMatch(/(?:message|summary)\s*:\s*["'`][A-Z][a-z]+ /u);
		}
	});
	it("byte and mapping gate: 1,000 seeded valid operations across LF, CRLF and mixed files", () => {
		for (let seed = 1; seed <= 1000; seed++) {
			let random = seed;
			const next = () => {
				random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
				return random;
			};
			const endings = seed % 3;
			let line = 0;
			const eol = () =>
				endings === 0 ? "\n" : endings === 1 ? "\r\n" : line++ % 2 ? "\n" : "\r\n";
			const source = `${seed % 2 ? "\uFEFF" : ""}# Café 😀${eol()}${eol()}::: note Title ${seed} {tone=note icon="bulb"}${eol()}Original ${next()} e\u0301\u202f?${eol()}:::${eol()}${eol()}Neighbour ${next()}${eol()}`;
			const f = fixture(source);
			const target = f.target("note");
			const operation = [
				"editSource",
				"setProperty",
				"setText",
				"duplicateBlocks",
				"deleteBlocks",
				"moveBlocks",
				"insertBlock",
			][seed % 7];
			const args =
				operation === "editSource"
					? { text: `::: note Title ${seed} {tone=tip icon="bulb"}\nEdited 😀 ${next()}\n` }
					: operation === "setProperty"
						? { name: "tone", value: "tip" }
						: operation === "setText"
							? { field: "subject", text: `Corrected ${seed}` }
							: operation === "moveBlocks"
								? { direction: "down" }
								: operation === "insertBlock"
									? { text: `Inserted ${seed}` }
									: {};
			const members =
				operation === "insertBlock"
					? [boundary(f, "page", id(target), id(f.target("body", 1)))]
					: [target];
			const result = applied(f.run(operation, members, args));
			const after = applyEdits(source, result.files[0].edits);
			expect(
				document(after).tree.diagnostics.filter((d) => d.severity === "error"),
				`seed ${seed}`,
			).toEqual([]);
			expect(result.identity.exportable, `seed ${seed}`).toBe(true);
			const targetMap = f.identity.sourceMappings.find((m) => m.id === id(target));
			const parent = document(source).tree.root.children[0];
			let oldCursor = 0;
			let newCursor = 0;
			for (const edit of result.files[0].edits) {
				if (edit.start !== edit.end) {
					const adjacent = parent.trivia.filter(
						(span) => span.start === targetMap?.span.end || span.end === targetMap?.span.start,
					);
					const start =
						operation === "deleteBlocks"
							? Math.min(targetMap?.span.start ?? 0, ...adjacent.map((s) => s.start))
							: (targetMap?.span.start ?? 0);
					const end =
						operation === "deleteBlocks"
							? Math.max(targetMap?.span.end ?? 0, ...adjacent.map((s) => s.end))
							: (targetMap?.span.end ?? 0);
					expect(edit.start, `seed ${seed}`).toBeGreaterThanOrEqual(start);
					expect(edit.end, `seed ${seed}`).toBeLessThanOrEqual(end);
				}
				const count = edit.start - oldCursor;
				expect(Buffer.from(after.slice(newCursor, newCursor + count)), `seed ${seed}`).toEqual(
					Buffer.from(source.slice(oldCursor, edit.start)),
				);
				oldCursor = edit.end;
				newCursor += count + edit.text.length;
			}
			expect(Buffer.from(after.slice(newCursor))).toEqual(Buffer.from(source.slice(oldCursor)));
			const kept = result.mapping.filter((m) => m.fate === "kept").map((m) => m.newId);
			expect(new Set(kept).size).toBe(kept.length);
			for (const old of f.identity.sourceMappings)
				expect(
					result.mapping.some((m) => m.oldId === old.id),
					`seed ${seed}, ${old.id}`,
				).toBe(true);
			undo(f, result);
		}
	}, 30_000);
	it("byte gate on the converted leadership and toolkit corpus, with exact undo", () => {
		const paths = [
			"leadership/00-avant-de-commencer",
			"leadership/01-affirmez-vous",
			"leadership/02-quatre-cavaliers",
			"leadership/03-resoudre-un-conflit",
			"toolkit/welcome",
		];
		for (const path of paths)
			for (const ending of ["lf", "crlf", "mixed"]) {
				let line = 0;
				const source = readFileSync(
					new URL(`../../grammar/__tests__/fixtures/v4/${path}.prax`, import.meta.url),
					"utf8",
				).replace(/\r?\n/gu, () =>
					ending === "lf" ? "\n" : ending === "crlf" || line++ % 2 ? "\r\n" : "\n",
				);
				const f = fixture(source);
				const node = f.identity.sourceMappings.find(
					(m) => m.path.length === 2 && f.identity.snapshots[0].nodes[m.id].type === "body",
				);
				expect(node, path).toBeDefined();
				if (!node) throw new Error(path);
				const target: OperationTarget = {
					file,
					ref: { kind: "node", nodeId: node.id, path: node.path, fingerprint: node.fingerprint },
					expectedText: source.slice(node.span.start, node.span.end),
				};
				const result = applied(
					f.run("editSource", [target], { text: "Corrected Café 😀\u202f?\n" }),
				);
				for (const edit of result.files[0].edits) {
					expect(edit.start).toBeGreaterThanOrEqual(node.span.start);
					expect(edit.end).toBeLessThanOrEqual(node.span.end);
				}
				undo(f, result);
			}
	}, 30_000);
});

it("retrieval-sheet duplicateBlocks allocates fresh question IDs and retains original IDs", () => {
	const f = fixture(
		"# Page\n::: retrieval-sheet Topic\n:: First question\nanswer: First answer\n:: Second question\nanswer: Second answer\n:::\n",
	);
	const result = applied(f.run("duplicateBlocks", [f.target("retrieval-sheet")]));
	for (const original of [f.target("retrieval-sheet"), f.target("item"), f.target("item", 1)]) {
		const originalId = id(original);
		expect(result.identity.sourceMappings.some((m) => m.id === originalId)).toBe(true);
		const copied = result.mapping.find((m) => m.oldId === originalId && m.fate === "copied");
		expect(copied?.newId).toBeTruthy();
		expect(copied?.newId).not.toBe(originalId);
	}
	undo(f, result);
});

it("retrieval-sheet moveItem retains question and answer IDs through reorder", () => {
	const f = fixture(
		"# Page\n::: retrieval-sheet Topic\n:: First question\nanswer: First answer\n:: Second question\nanswer: Second answer\n:::\n",
	);
	const result = applied(f.run("moveItem", [f.target("item", 1)], { direction: "up" }));
	const source = applyEdits(f.source, result.files[0].edits);
	expect(source.indexOf(":: Second question")).toBeLessThan(source.indexOf(":: First question"));
	kept(f, result, [
		f.target("retrieval-sheet"),
		f.target("item"),
		f.target("item", 1),
		f.target("part"),
		f.target("part", 1),
	]);
	undo(f, result);
});

it("write-distractors duplicateBlocks allocates fresh block, misconception and part IDs and retains original IDs", () => {
	const f = fixture(
		"# Page\n::: write-distractors Topic\nanswer: Right answer\n:: First idea\noption: First option\n:: Second idea\noption: Second option\n:::\n",
	);
	expect(f.identity.exportable).toBe(true);
	const result = applied(f.run("duplicateBlocks", [f.target("write-distractors")]));
	for (const original of [
		f.target("write-distractors"),
		f.target("item"),
		f.target("item", 1),
		f.target("part"),
		f.target("part", 1),
		f.target("part", 2),
	]) {
		const originalId = id(original);
		expect(result.identity.sourceMappings.some((m) => m.id === originalId)).toBe(true);
		const copied = result.mapping.find((m) => m.oldId === originalId && m.fate === "copied");
		expect(copied?.newId).toBeTruthy();
		expect(copied?.newId).not.toBe(originalId);
	}
	undo(f, result);
});

it("write-distractors moveItem retains block, misconception and part IDs through reorder", () => {
	const f = fixture(
		"# Page\n::: write-distractors Topic\nanswer: Right answer\n:: First idea\noption: First option\n:: Second idea\noption: Second option\n:::\n",
	);
	expect(f.identity.exportable).toBe(true);
	const result = applied(f.run("moveItem", [f.target("item", 1)], { direction: "up" }));
	const source = applyEdits(f.source, result.files[0].edits);
	expect(source.indexOf(":: Second idea")).toBeLessThan(source.indexOf(":: First idea"));
	kept(f, result, [
		f.target("write-distractors"),
		f.target("item"),
		f.target("item", 1),
		f.target("part"),
		f.target("part", 1),
		f.target("part", 2),
	]);
	undo(f, result);
});

it("write-distractors removeItem retires the deleted item and option, then undo restores their IDs", () => {
	const f = fixture(
		"# Page\n::: write-distractors Topic\nanswer: Right\n:: First idea\noption: First option\n:: Second idea\noption: Second option\n:::\n",
	);
	const result = applied(f.run("removeItem", [f.target("item", 1)]));
	const after = applyEdits(f.source, result.files[0].edits);
	expect(after).not.toContain("Second idea");
	expect(result.identity.exportable).toBe(true);
	const current = result.identity.snapshots.find(
		(snapshot) => snapshot.sourceHash === digest(after),
	);
	if (!current) throw new Error("Missing resulting identity snapshot");
	for (const removed of [f.target("item", 1), f.target("part", 2)]) {
		const removedId = id(removed);
		if (!removedId) throw new Error("Missing removed identity");
		expect(result.mapping).toContainEqual({ oldId: removedId, newId: null, fate: "retired" });
		expect(current.nodes[removedId].status).toBe("retired");
	}
	kept(f, result, [
		f.target("write-distractors"),
		f.target("item"),
		f.target("part"),
		f.target("part", 1),
	]);
	undo(f, result);
});
