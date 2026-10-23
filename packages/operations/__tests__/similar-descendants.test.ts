import { createHash } from "node:crypto";
import {
	describeDocument,
	type IdentityResolution,
	lexicalScore,
	resolveIdentity,
} from "@praxity/content-identity";
import { applyEdits } from "@praxity/grammar/src/source-edit.ts";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { describe, expect, it } from "vitest";
import { type AppliedOperation, applyOperation } from "../src";

const file = "lesson.prax";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const document = (source: string) => ({
	path: file,
	tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
});
const answer = "Ask the colleague to explain the concern before deciding what to do next.";
const other = "Document the decision and schedule a follow up meeting with the whole team.";
const card = `::: cards Scenarios\n:: Scenario\n::: choice What should you do?\n(x) ${answer}\n( ) ${other}\n:::\n:::\n`;

function fixture(source = `\uFEFF# Café 😀\r\n${card}\nOutside\r\n`) {
	let next = 1;
	const dependencies = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`,
	};
	const initial = resolveIdentity(
		{ parsedDocuments: [document(source)], priorSnapshots: [] },
		dependencies,
	);
	const resolve = (text: string, prior = initial) =>
		resolveIdentity(
			{
				course: prior.course,
				parsedDocuments: [document(text)],
				priorSnapshots: prior.snapshots,
				priorHeads: prior.heads,
			},
			dependencies,
		);
	const run = (
		operation: string,
		type: string,
		args: Record<string, unknown>,
		text = source,
		identity = initial,
	) => {
		const map = identity.sourceMappings.find(
			(m) => identity.snapshots[0].nodes[m.id].type === type,
		);
		if (!map) throw new Error(`Missing ${type}`);
		const result = applyOperation(
			[{ path: file, source: text }],
			{
				transactionId: "o2",
				operation,
				files: [{ path: file, baseRevision: digest(text) }],
				targets: [
					{
						file,
						ref: { kind: "node", nodeId: map.id, path: map.path, fingerprint: map.fingerprint },
						expectedText: text.slice(map.span.start, map.span.end),
					},
				],
				args,
			},
			{ identity, ...dependencies },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.code);
		let node = document(text).tree.root;
		for (const index of map.path) node = node.children[index];
		const ownedEnd =
			operation === "editSource" ? (node.closer?.start ?? map.span.end) : map.span.end;
		for (const edit of result.files[0].edits) {
			expect(edit.start).toBeGreaterThanOrEqual(map.span.start);
			expect(edit.end).toBeLessThanOrEqual(ownedEnd);
		}
		const after = applyEdits(text, result.files[0].edits);
		let oldCursor = 0;
		let newCursor = 0;
		for (const edit of result.files[0].edits) {
			const length = edit.start - oldCursor;
			expect(Buffer.from(after.slice(newCursor, newCursor + length))).toEqual(
				Buffer.from(text.slice(oldCursor, edit.start)),
			);
			oldCursor = edit.end;
			newCursor += length + edit.text.length;
		}
		expect(Buffer.from(after.slice(newCursor))).toEqual(Buffer.from(text.slice(oldCursor)));
		return result;
	};
	return { source, initial, dependencies, resolve, run };
}

function idsByText(identity: IdentityResolution, type: string, text: string) {
	return identity.sourceMappings
		.filter((m) => {
			const node = identity.snapshots[0].nodes[m.id];
			return node.type === type && node.matchText === text;
		})
		.map((m) => m.id);
}

function completeMapping(before: IdentityResolution, result: AppliedOperation) {
	for (const [oldId, node] of Object.entries(before.snapshots[0].nodes))
		if (node.status === "active" || node.status === "pending")
			expect(result.mapping.filter((m) => m.oldId === oldId && m.fate !== "copied")).toHaveLength(
				1,
			);
	for (const current of result.identity.sourceMappings)
		expect(result.mapping.filter((m) => m.newId === current.id)).toHaveLength(1);
	const kept = result.mapping.filter((m) => m.fate === "kept").map((m) => m.newId);
	expect(new Set(kept).size).toBe(kept.length);
}

function undo(
	f: ReturnType<typeof fixture>,
	result: AppliedOperation,
	source = f.source,
	before = f.initial,
) {
	const after = applyEdits(source, result.files[0].edits);
	expect(Buffer.from(applyEdits(after, result.inverse.files[0].edits))).toEqual(
		Buffer.from(source),
	);
	const mapping = result.inverse.mapping;
	const restored = resolveIdentity(
		{
			course: before.course,
			parsedDocuments: [document(source)],
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
							toRevision: digest(source),
							fromSnapshot: result.identity.heads[0].head,
						},
					],
					mapping,
					placements: mapping.flatMap((m, mappingIndex) => {
						const original = before.sourceMappings.find((p) => p.id === m.newId);
						return original && !["retired", "absorbed", "cut"].includes(m.fate)
							? [{ mappingIndex, file, path: original.path }]
							: [];
					}),
				},
			],
		},
		{
			digest,
			allocateId: () => {
				throw new Error("Undo must restore recorded IDs without allocation");
			},
		},
	);
	expect(restored.sourceMappings.map((m) => m.id)).toEqual(before.sourceMappings.map((m) => m.id));
	for (const [id, node] of Object.entries(before.snapshots[0].nodes))
		expect(restored.snapshots[0].nodes[id]).toEqual(node);
	return restored;
}

describe("O2 similar descendants through applyOperation", () => {
	it("a typo in an option inside an edited card keeps every ID", () => {
		const f = fixture();
		const result = f.run("editSource", "cards", {
			text: card.replace("concern", "concren").slice(0, -4),
		});
		expect(result.identity.sourceMappings.map((m) => m.id)).toEqual(
			f.initial.sourceMappings.map((m) => m.id),
		);
		expect(result.identity.exportable).toBe(true);
		completeMapping(f.initial, result);
		undo(f, result);
	});
	it("a reworded option below I2's lexical threshold retires its old ID", () => {
		const f = fixture();
		const replacement = "Leave immediately and refuse any further discussion.";
		expect(lexicalScore(answer, replacement)).toBeLessThan(0.8);
		const result = f.run("editSource", "cards", {
			text: card.replace(answer, replacement).slice(0, -4),
		});
		const oldId = idsByText(f.initial, "option", answer)[0];
		const newId = idsByText(result.identity, "option", replacement)[0];
		expect(newId).toBeDefined();
		expect(newId).not.toBe(oldId);
		expect(result.mapping).toContainEqual({ oldId, newId: null, fate: "retired" });
		expect(result.mapping).toContainEqual({ oldId: null, newId, fate: "new" });
		expect(result.inverse.guards).toContainEqual(
			expect.objectContaining({ kind: "deleted", nodeId: oldId }),
		);
		completeMapping(f.initial, result);
		undo(f, result);
	});
	it("setText reconciles virtual blank descendants through I2", () => {
		const text = `{${answer}}`;
		const f = fixture(`# Page\n::: fill-blank Question\n${text}\n:::\n`);
		expect(lexicalScore(text, text.replace("concern", "concren"))).toBeGreaterThan(0.9);
		const result = f.run("setText", "body", {
			field: "text",
			text: text.replace("concern", "concren"),
		});
		expect(result.identity.sourceMappings.map((m) => m.id)).toEqual(
			f.initial.sourceMappings.map((m) => m.id),
		);
		expect(describeDocument(document(f.source)).some((d) => d.type === "blank")).toBe(true);
		completeMapping(f.initial, result);
		undo(f, result);
	});
	it("setText retires a reworded virtual blank below threshold", () => {
		const text = "Ask the {colleague to explain the concern} before deciding what to do next.";
		const f = fixture(`# Page\n::: fill-blank Question\n${text}\n:::\n`);
		const result = f.run("setText", "body", {
			field: "text",
			text: text.replace("colleague to explain the concern", "manager"),
		});
		const old = f.initial.sourceMappings.find(
			(m) => f.initial.snapshots[0].nodes[m.id].type === "blank",
		);
		expect(old).toBeDefined();
		expect(result.mapping).toContainEqual({ oldId: old?.id, newId: null, fate: "retired" });
		completeMapping(f.initial, result);
		undo(f, result);
	});
	it("recorded duplicateBlocks allocates the copy and keeps the entire original", () => {
		const f = fixture();
		const result = f.run("duplicateBlocks", "cards", {});
		for (const old of f.initial.sourceMappings)
			expect(result.mapping).toContainEqual({ oldId: old.id, newId: old.id, fate: "kept" });
		const copied = result.mapping.filter((m) => m.fate === "copied");
		expect(copied).toHaveLength(
			f.initial.sourceMappings.filter((m) => m.path.length > 1 && m.path[1] === 0).length,
		);
		for (const m of copied)
			expect(f.initial.sourceMappings.map((p) => p.id)).not.toContain(m.newId);
		for (const m of copied)
			expect(result.identity.snapshots[0].nodes[m.newId as string].lineage).toContain(m.oldId);
		expect(result.identity.unresolved).toEqual([]);
		completeMapping(f.initial, result);
		undo(f, result);
	});
	it.each(["setText", "editSource"])(
		"an external ambiguous duplicate stays unresolved through %s and undo",
		(operation) => {
			const f = fixture();
			const external = f.source.replace(`( ) ${other}\n`, `( ) ${other}\n( ) ${other}\n`);
			const unresolved = f.resolve(external);
			const oldId = idsByText(f.initial, "option", other)[0];
			const provisional = idsByText(unresolved, "option", other);
			expect(provisional).toHaveLength(2);
			expect(provisional).not.toContain(oldId);
			expect(unresolved.exportable).toBe(false);
			const args =
				operation === "setText"
					? { field: "subject", text: "Corrected scenario" }
					: {
							text: external
								.slice(external.indexOf("::: cards"), external.lastIndexOf(":::\n"))
								.replace("Scenarios", "Corrected scenario"),
						};
			const result = f.run(operation, "cards", args, external, unresolved);
			expect(result.identity.exportable).toBe(false);
			expect(idsByText(result.identity, "option", other)).not.toContain(oldId);
			expect(
				result.identity.unresolved.filter(
					(u) => u.reason === "duplicate" && u.candidates.includes(oldId),
				),
			).toHaveLength(2);
			completeMapping(unresolved, result);
			const restored = undo(f, result, external, unresolved);
			expect(restored.exportable).toBe(false);
			expect(idsByText(restored, "option", other)).toEqual(provisional);
		},
	);
	it("similar competing options still require I2's mutual margin", () => {
		const second = answer.replace("explain", "describe");
		const source = `# Page\n${card.replace(other, second)}`;
		const f = fixture(source);
		const result = f.run("editSource", "cards", {
			text: card.replace(other, second).replaceAll("concern", "concren").slice(0, -4),
		});
		for (const text of [answer, second]) {
			const oldId = idsByText(f.initial, "option", text)[0];
			expect(result.mapping).toContainEqual({ oldId, newId: null, fate: "retired" });
			expect(idsByText(result.identity, "option", text.replace("concern", "concren"))[0]).not.toBe(
				oldId,
			);
		}
		completeMapping(f.initial, result);
		undo(f, result);
	});
	it.each(["editSource", "setText"])(
		"an external whole-card duplicate stays unresolved through %s and undo",
		(operation) => {
			const f = fixture();
			const external = f.source.replace(card, `${card}\n${card}`);
			const unresolved = f.resolve(external);
			const originalIds = f.initial.sourceMappings
				.filter((m) => m.path.length > 1 && m.path[1] === 0)
				.map((m) => m.id);
			for (const map of unresolved.sourceMappings.filter((m) => m.path.length > 1 && m.path[1] < 2))
				expect(originalIds).not.toContain(map.id);
			const result = f.run(
				operation,
				"cards",
				operation === "setText"
					? { field: "subject", text: "Edited scenarios" }
					: { text: card.replace("Scenarios", "Edited scenarios").slice(0, -4) },
				external,
				unresolved,
			);
			expect(result.identity.exportable).toBe(false);
			for (const oldId of originalIds)
				expect(result.mapping).toContainEqual({ oldId, newId: oldId, fate: "pending" });
			completeMapping(unresolved, result);
			const restored = undo(f, result, external, unresolved);
			expect(restored.exportable).toBe(false);
		},
	);
	it("deleting a provisional duplicate undoes to the same unresolved IDs", () => {
		const f = fixture();
		const external = f.source.replace(card, `${card}${card}`);
		const unresolved = f.resolve(external);
		const result = f.run("deleteBlocks", "cards", {}, external, unresolved);
		completeMapping(unresolved, result);
		const restored = undo(f, result, external, unresolved);
		expect(restored.exportable).toBe(false);
	});
	it("editing an option into 96/4 fragments keeps I2's split guard", () => {
		const words = Array.from({ length: 100 }, (_, i) => `word${i.toString().padStart(3, "0")}`);
		const original = words.join(" ");
		const first = words.slice(0, 96).join(" ");
		const last = words.slice(96).join(" ");
		expect(lexicalScore(original, first)).toBeGreaterThan(0.96);
		const source = `# Page\n${card.replace(answer, original)}`;
		const f = fixture(source);
		const result = f.run("editSource", "cards", {
			text: card.replace(answer, `${first}\n( ) ${last}`).slice(0, -4),
		});
		const oldId = idsByText(f.initial, "option", original)[0];
		expect(result.mapping).toContainEqual({ oldId, newId: null, fate: "retired" });
		for (const text of [first, last])
			expect(idsByText(result.identity, "option", text)[0]).not.toBe(oldId);
		completeMapping(f.initial, result);
		undo(f, result);
	});
	it.each(["\n", "\r\n", ""])("setText keeps a plain body's terminator %j", (eol) => {
		const source = `\uFEFF# Café 😀\r\n${answer}${eol}`;
		const f = fixture(source);
		const result = f.run("setText", "body", {
			field: "text",
			text: answer.replace("concern", "concren"),
		});
		expect(applyEdits(source, result.files[0].edits)).toBe(source.replace("concern", "concren"));
		completeMapping(f.initial, result);
		undo(f, result);
	});
	it("1,000 seeded edits cover similar, retired, copied and unresolved descendants with exact undo", () => {
		const coverage = new Set<number>();
		for (let seed = 0; seed < 1_000; seed++) {
			let state = seed + 1;
			const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
			const choice = next() % 7;
			coverage.add(choice);
			const option = `${answer} Scenario ${next()}.`;
			const [word, typo] = [
				["concern", "concren"],
				["colleague", "colleauge"],
				["deciding", "decidign"],
			][next() % 3];
			const content =
				choice >= 5
					? `::: fill-blank Question ${seed}\n{${option}}\n:::\n`
					: card.replace(answer, option).replace("Scenarios", `Scenarios ${seed}`);
			const eol = () =>
				seed % 3 === 0 ? "\n" : seed % 3 === 1 ? "\r\n" : next() % 2 ? "\n" : "\r\n";
			const source =
				`${seed % 2 ? "\uFEFF" : ""}# Café 😀\n${content}\nOutside\n# Next\nUntouched e\u0301\u202f?${seed % 2 ? "\n" : ""}`.replace(
					/\n/gu,
					eol,
				);
			const f = fixture(source);
			const changed =
				choice === 1 || choice === 6
					? "Leave immediately and refuse any further discussion."
					: option.replace(word, typo);
			if (choice === 3 || choice === 4) {
				const duplicate = source.replace(other, `${other}${eol()}( ) ${other}`);
				const unresolved = f.resolve(duplicate);
				const result = f.run(
					choice === 3 ? "editSource" : "setText",
					"cards",
					choice === 3
						? {
								text: content
									.replace("Scenarios", "Edited scenarios")
									.replace(other, `${other}\n( ) ${other}`)
									.slice(0, -4),
							}
						: { field: "subject", text: `Edited scenarios ${seed}` },
					duplicate,
					unresolved,
				);
				expect(result.identity.exportable, `seed ${seed}`).toBe(false);
				const oldId = idsByText(f.initial, "option", other)[0];
				expect(idsByText(result.identity, "option", other), `seed ${seed}`).not.toContain(oldId);
				completeMapping(unresolved, result);
				undo(f, result, duplicate, unresolved);
				continue;
			}
			const result =
				choice === 2
					? f.run("duplicateBlocks", "cards", {})
					: choice >= 5
						? f.run("setText", "body", { field: "text", text: `{${changed}}` })
						: f.run("editSource", "cards", { text: content.replace(option, changed).slice(0, -4) });
			expect(
				document(applyEdits(source, result.files[0].edits)).tree.diagnostics.filter(
					(d) => d.severity === "error",
				),
				`seed ${seed}`,
			).toEqual([]);
			expect(result.identity.exportable, `seed ${seed}`).toBe(true);
			if (choice === 1 || choice === 6) {
				const oldId = idsByText(
					f.initial,
					choice === 1 ? "option" : "blank",
					choice === 1 ? option : `{${option}}`,
				)[0];
				expect(result.mapping).toContainEqual({ oldId, newId: null, fate: "retired" });
			} else if (choice !== 2)
				expect(
					result.identity.sourceMappings.map((m) => m.id),
					`seed ${seed}`,
				).toEqual(f.initial.sourceMappings.map((m) => m.id));
			else {
				for (const old of f.initial.sourceMappings)
					expect(result.mapping).toContainEqual({ oldId: old.id, newId: old.id, fate: "kept" });
				expect(result.mapping.some((m) => m.fate === "copied")).toBe(true);
			}
			completeMapping(f.initial, result);
			undo(f, result);
		}
		expect(coverage.size).toBe(7);
	}, 60_000);
});
