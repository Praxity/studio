import { createHash } from "node:crypto";
import { resolveIdentity } from "@praxity/content-identity";
import type { OperationTarget } from "@praxity/grammar/src/operations/contract.ts";
import { applyEdits } from "@praxity/grammar/src/source-edit.ts";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { BLOCK_SCHEMA, getDefinition, TURN_INTO, WRAP_IN } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree, type TreeNode } from "@praxity/grammar/src/v4/tree/index.ts";
import { describe, expect, it } from "vitest";
import { applyOperation } from "../src";

const file = "lesson.prax";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const document = (source: string) => ({
	path: file,
	tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
});
const descendants = (node: TreeNode): TreeNode[] => [node, ...node.children.flatMap(descendants)];
function fixture(source: string) {
	let next = 1;
	const deps = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`,
	};
	const identity = resolveIdentity(
		{ parsedDocuments: [document(source)], priorSnapshots: [] },
		deps,
	);
	const target = (type: string, ordinal = 0): OperationTarget => {
		const m = identity.sourceMappings.filter(
			(m) => identity.snapshots[0].nodes[m.id].type === type,
		)[ordinal];
		return {
			file,
			ref: { kind: "node", nodeId: m.id, path: m.path, fingerprint: m.fingerprint },
			expectedText: source.slice(m.span.start, m.span.end),
		};
	};
	const run = (operation: string, targets: OperationTarget[], args: Record<string, unknown> = {}) =>
		applyOperation(
			[{ path: file, source }],
			{
				transactionId: "O4",
				operation,
				files: [{ path: file, baseRevision: digest(source) }],
				targets,
				args,
			},
			{ ...deps, identity },
		);
	return { source, deps, identity, target, run };
}
const id = (t: OperationTarget) => (t.ref.kind === "node" ? t.ref.nodeId : null);
function applied(result: ReturnType<typeof applyOperation>) {
	expect(result.ok, JSON.stringify(result)).toBe(true);
	if (!result.ok) throw new Error(result.code);
	return result;
}
function verify(f: ReturnType<typeof fixture>, r: ReturnType<typeof applied>, clean = true) {
	const source = applyEdits(f.source, r.files[0].edits);
	expect(applyEdits(source, r.inverse.files[0].edits)).toBe(f.source);
	if (clean)
		expect(document(source).tree.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	for (const old of f.identity.sourceMappings)
		expect(r.mapping.filter((m) => m.oldId === old.id)).toHaveLength(1);
	expect(new Set(r.mapping.filter((m) => m.fate === "kept").map((m) => m.newId)).size).toBe(
		r.mapping.filter((m) => m.fate === "kept").length,
	);
	const restored = resolveIdentity(
		{
			course: f.identity.course,
			parsedDocuments: [document(f.source)],
			priorSnapshots: r.identity.snapshots,
			priorHeads: r.identity.heads,
			operations: [
				{
					intent: r.intent,
					inverse: true,
					files: [
						{
							path: file,
							fromRevision: digest(source),
							toRevision: digest(f.source),
							fromSnapshot: r.identity.heads[0].head,
						},
					],
					mapping: r.inverse.mapping,
					placements: r.inverse.mapping.flatMap((m, mappingIndex) => {
						const original = f.identity.sourceMappings.find((p) => p.id === m.newId);
						return original && !["retired", "absorbed", "cut"].includes(m.fate)
							? [{ mappingIndex, file, path: original.path }]
							: [];
					}),
				},
			],
		},
		f.deps,
	);
	expect(restored.sourceMappings.map((m) => m.id)).toEqual(
		f.identity.sourceMappings.map((m) => m.id),
	);
	return source;
}

const pairs = Object.entries(TURN_INTO).flatMap(([from, conversions]) =>
	conversions.map((declaration) => ({ from, ...declaration })),
);
describe("O4 schema conversions", () => {
	it("item conversions preserve nested answers, parts, item settings and all surviving IDs", () => {
		const f = fixture(
			'# Page\n::: accordion {name="outer"}\n:: First {name="item-one"}\n::: choice Quiz {points=3 scored}\ncorrect: Well done\n(x) Correct\nfeedback: Choice feedback\n( ) Other\n:::\n:: Second\n::: cards\n:: Nested\nFront\n::: back\nNested back\n:::\n:::\n:::\n',
		);
		const r = applied(f.run("turnInto", [f.target("accordion")], { type: "tabs" }));
		const source = verify(f, r);
		expect(source).toContain(
			"correct: Well done\n(x) Correct\nfeedback: Choice feedback\n( ) Other",
		);
		for (const old of f.identity.sourceMappings)
			expect(r.mapping).toContainEqual({ oldId: old.id, newId: old.id, fate: "kept" });
	});
	it("flattening outer cards preserves nested cards and their back faces", () => {
		const f = fixture(
			"# Page\n::: cards\n:: Outer\n::: cards\n:: Inner\nFront\n::: back\nNested back\n:::\n:::\n::: back\nOuter back\n:::\n:::\n",
		);
		const r = applied(f.run("turnInto", [f.target("cards")], { type: "text" }));
		const source = verify(f, r);
		expect(source).toContain("Nested back");
		expect(source).not.toContain("Outer back");
		expect(r.mapping).toContainEqual({
			oldId: id(f.target("cards", 1)),
			newId: id(f.target("cards", 1)),
			fate: "kept",
		});
	});
	it("plain paragraphs can turn into prose and wrap with identity kept", () => {
		const f = fixture("# Page\nParagraph 😀\n\nTail\n");
		for (const operation of ["turnInto", "wrapIn"]) {
			const r = applied(f.run(operation, [f.target("body")], { type: "note" }));
			expect(verify(f, r)).toContain("Paragraph 😀");
			expect(r.mapping).toContainEqual({
				oldId: id(f.target("body")),
				newId: id(f.target("body")),
				fate: "kept",
			});
		}
	});
	it("choice conversion drops correctness and option feedback but retains text and shared feedback", () => {
		const valid = fixture(
			'# Page\n::: choice Quiz {points=4 scored name="quiz"}\ncorrect: Shared correct\nincorrect: Shared incorrect\nfeedback: Shared feedback\n(x) Right\nfeedback: Option detail\n( ) Wrong\n:::\n',
		);
		const r = applied(valid.run("turnInto", [valid.target("choice")], { type: "rating" }));
		const source = verify(valid, r);
		expect(source).toContain('points=4 scored name="quiz"');
		expect(source).toContain("1. Right\n2. Wrong");
		expect(source).not.toContain("Option detail");
		expect(source).not.toContain("(x)");
		expect(source).toContain(
			"correct: Shared correct\nincorrect: Shared incorrect\nfeedback: Shared feedback",
		);
		expect(r.summary.params.losesAnswers).toBe(1);
	});
	it("replacement keeps the saved closer spelling and mixed body endings", () => {
		const f = fixture("# Page\n::: note\nOld\n:::  \r\n\nTail\n");
		const r = applied(f.run("replaceBlock", [f.target("note")], { text: "::: quote\nNew\n:::" }));
		expect(verify(f, r)).toContain("New\n:::  \r\n");
	});
	it("multiple conversions refuse all when a member has no declared pair", () => {
		const f = fixture("# Page\n::: note\nOne\n:::\n\n::: columns\n::\nTwo\n:::\n");
		expect(
			f.run("turnInto", [f.target("note"), f.target("columns")], { type: "quote" }),
		).toMatchObject({ ok: false, code: "not-allowed", member: id(f.target("columns")) });
	});
	it("image and heading conversions retain literal learner content", () => {
		for (const raw of ["![Café 😀](/assets/a.png)\n", "## Café 😀\n"]) {
			const f = fixture(`# Page\n${raw}`);
			const r = applied(
				f.run("turnInto", [f.target(raw.startsWith("!") ? "image" : "heading")], { type: "text" }),
			);
			expect(verify(f, r)).toContain(raw.startsWith("!") ? raw : "Café 😀");
		}
	});
	it("all schema settings and parts are preserved or dropped by their declaration", () => {
		for (const pair of pairs.filter(
			(p) => p.target !== "page" && p.from !== "image" && p.from !== "heading",
		)) {
			const definition = BLOCK_SCHEMA[pair.from];
			const raw = definition.insertTemplate;
			const tree = document(`# Page\n${raw}`).tree.root.children[0].children[0];
			const settings = Object.entries(definition.settings).flatMap(([name, setting]) => {
				const candidates = [
					...(setting.values ?? []),
					...(setting.type === "boolean" ? [true] : []),
					String(setting.min ?? 1),
					"1",
					"2",
					"setting-token",
					"https://example.com",
					"/assets/a.vtt",
					"alert-triangle",
				];
				const value = candidates.find((v) => setting.accepts(v));
				return value === undefined
					? []
					: [
							{
								name,
								value,
								token: value === true ? name : `${name}=${JSON.stringify(String(value))}`,
							},
						];
			});
			// Test one authored setting at a time, avoiding unrelated constraints such as start/end.
			for (const setting of settings) {
				const prefix = raw
					.slice(0, (tree.header?.end ?? tree.span.start) - 7)
					.replace(/\r?\n$/u, "")
					.replace(/\s*\{[^}]*\}$/u, "");
				const f = fixture(
					`# Page\n${prefix} {${setting.token}}\n${raw.slice((tree.header?.end ?? tree.span.start) - 7)}`,
				);
				const r = applied(f.run("turnInto", [f.target(pair.from)], { type: pair.target }));
				const source = verify(f, r, false);
				expect(source.includes(setting.token), `${pair.from}->${pair.target} ${setting.name}`).toBe(
					!pair.losses.includes(`setting:${setting.name}`),
				);
			}
			for (const part of definition.parts ?? []) {
				const marker = `authored-${part}-😀`;
				const offset = (tree.header?.end ?? tree.span.start) - 7;
				const f = fixture(
					`# Page\n${raw.slice(0, offset)}${part}: ${marker}\n${raw.slice(offset)}`,
				);
				const r = applied(f.run("turnInto", [f.target(pair.from)], { type: pair.target }));
				const source = verify(f, r, false);
				expect(source.includes(marker), `${pair.from}->${pair.target} ${part}`).toBe(
					!pair.losses.includes(`part:${part}`),
				);
			}
		}
	}, 30000);
	it.each(pairs)("$from -> $target retains undeclared content and exact undo", (pair) => {
		const f = fixture(`# Page\n${BLOCK_SCHEMA[pair.from].insertTemplate}\nTail 😀\n`);
		const before = document(f.source).tree.root.children[0].children[0];
		const r = applied(
			f.run("turnInto", [f.target(pair.from)], {
				type: pair.target,
				...(pair.target === "page" ? { title: "Next page" } : {}),
			}),
		);
		expect(r.intent).toBe("convert");
		expect(r.mapping).toContainEqual({
			oldId: id(f.target(pair.from)),
			newId: id(f.target(pair.from)),
			fate: "kept",
		});
		expect(r.summary.params.losesAnswers).toBe(Number(pair.losesAnswers));
		expect(r.summary.params.losses).toBe(pair.losses.join(","));
		const source = verify(f, r);
		for (const node of descendants(before)) {
			if (node.kind === "part" && pair.losses.includes(`part:${node.name}`)) continue;
			if (
				node.kind === "item" &&
				(pair.losses.includes("item-titles") || pair.losses.includes("categories"))
			)
				continue;
			if (
				node.text &&
				!(
					pair.losses.includes("scale-labels") &&
					node.kind === "list-entry" &&
					node.number !== undefined
				)
			)
				expect(source).toContain(node.text.raw);
			if (node.answer && !pair.losses.includes("match-pairs"))
				expect(source).toContain(node.answer.raw);
			if (node.value && node.kind === "part") expect(source).toContain(node.value.raw);
		}
		for (const setting of before.settings)
			if (!pair.losses.includes(`setting:${setting.name}`))
				expect(source).toContain(f.source.slice(setting.span.start, setting.span.end));
		if (before.closer)
			expect(source).toContain(f.source.slice(before.closer.start, before.closer.end));
		expect(source).toContain("Tail 😀");
	});
	it("drops title, icon and only declared settings, retaining neighbour spelling", () => {
		const f = fixture(
			'# Page\n::: note Safety {tone=warning icon=alert-triangle name="keep-me"}\nBody **raw** 😀\n:::  \r\n',
		);
		const r = applied(f.run("turnInto", [f.target("note")], { type: "quote" }));
		const source = verify(f, r);
		expect(source).toBe('# Page\n::: quote {name="keep-me"}\nBody **raw** 😀\n:::  \r\n');
	});
	it("drops back faces while preserving front descendants and item IDs", () => {
		const f = fixture(
			"# Page\n::: cards\n:: First\nFront\n::: back\nSecret\n:::\n:: Second\nOther\n:::\n",
		);
		const r = applied(f.run("turnInto", [f.target("cards")], { type: "tabs" }));
		expect(verify(f, r)).not.toContain("Secret");
		for (const type of ["item", "body"])
			expect(r.mapping).toContainEqual({
				oldId: id(f.target(type)),
				newId: id(f.target(type)),
				fate: "kept",
			});
		expect(r.mapping).toContainEqual({ oldId: id(f.target("back")), newId: null, fate: "retired" });
	});
	it("refuses undeclared pairs and page breaks inside containers", () => {
		const f = fixture("# Page\n::: note\n---\n:::\n");
		expect(f.run("turnInto", [f.target("note")], { type: "choice" })).toMatchObject({
			ok: false,
			code: "not-allowed",
		});
		expect(f.run("turnInto", [f.target("divider")], { type: "page", title: "No" })).toMatchObject({
			ok: false,
			code: "not-allowed",
		});
	});
});

describe("O4 wrapping, merging and replacement", () => {
	it("wrap focuses the new wrapper and merge guards every absorbed identity", () => {
		const f = fixture("# Page\nFirst\n\nSecond\n");
		const wrapped = applied(f.run("wrapIn", [f.target("body")], { type: "note" }));
		const wrapper = wrapped.identity.sourceMappings.find(
			(m) => wrapped.identity.snapshots[0].nodes[m.id].type === "note",
		);
		expect(wrapped.focus).toMatchObject({ nodeId: wrapper?.id, role: "handle" });
		const merged = applied(f.run("mergeBlocks", [f.target("body"), f.target("body", 1)]));
		expect(merged.focus).toMatchObject({ nodeId: id(f.target("body")), role: "source" });
		expect(merged.inverse.guards).toContainEqual(
			expect.objectContaining({ kind: "deleted", nodeId: id(f.target("body", 1)) }),
		);
	});
	it("merge refuses literals and paragraphs across a divider", () => {
		const f = fixture("# Page\n```\ncode\n```\n\nOther\n");
		expect(f.run("mergeBlocks", [f.target("body"), f.target("body", 1)])).toMatchObject({
			ok: false,
			code: "not-allowed",
		});
		const d = fixture("# Page\nFirst\n\n---\n\nSecond\n");
		expect(d.run("mergeBlocks", [d.target("body"), d.target("body", 1)])).toMatchObject({
			ok: false,
			code: "not-allowed",
		});
	});
	it("O4 byte and mapping gate, 1,000 seeded operations", () => {
		for (let seed = 1; seed <= 1000; seed++) {
			const pair = pairs[seed % pairs.length];
			const eol = seed % 3 === 0 ? "\r\n" : "\n";
			const body = BLOCK_SCHEMA[pair.from].insertTemplate.replace(/\n/gu, eol);
			const operation =
				seed % 4 === 0
					? "mergeBlocks"
					: seed % 4 === 1
						? "replaceBlock"
						: seed % 4 === 2
							? "wrapIn"
							: "turnInto";
			// Merge has its own fixed plain-paragraph fixture; other seeds cover the schema matrix.
			const current = fixture(
				operation === "mergeBlocks"
					? `\uFEFF# Page${eol}Plain\r\n\nOther\n\n# Tail\r\nUntouched\n`
					: `\uFEFF# Page${eol}${body}${eol}Unowned 😀${eol}\n# Tail\r\nUntouched\n`,
			);
			const selected =
				operation === "mergeBlocks"
					? [current.target("body"), current.target("body", 1)]
					: [current.target(pair.from)];
			const args =
				operation === "turnInto"
					? { type: pair.target, ...(pair.target === "page" ? { title: "Next" } : {}) }
					: operation === "replaceBlock"
						? { type: "note" }
						: operation === "wrapIn"
							? { type: "note" }
							: {};
			const r = applied(current.run(operation, selected, args));
			const source = verify(current, r);
			const ranges = selected.map(
				(t) => current.identity.sourceMappings.find((m) => m.id === id(t))?.span,
			);
			expect(ranges.every(Boolean)).toBe(true);
			const owned = ranges.filter((span): span is NonNullable<typeof span> => span !== undefined);
			for (const edit of r.files[0].edits) {
				expect(edit.start, `seed ${seed}`).toBeGreaterThanOrEqual(
					Math.min(...owned.map((s) => s.start)),
				);
				expect(edit.end, `seed ${seed}`).toBeLessThanOrEqual(Math.max(...owned.map((s) => s.end)));
			}
			expect(source).toContain("# Tail\r\nUntouched\n");
			let offset = 0;
			let delta = 0;
			for (const edit of r.files[0].edits) {
				expect(Buffer.from(source.slice(offset + delta, edit.start + delta))).toEqual(
					Buffer.from(current.source.slice(offset, edit.start)),
				);
				delta += edit.text.length - (edit.end - edit.start);
				offset = edit.end;
			}
			expect(Buffer.from(source.slice(offset + delta))).toEqual(
				Buffer.from(current.source.slice(offset)),
			);
		}
	}, 30000);
	it("schema constraints refuse groups without questions and nonadjacent wrapping", () => {
		const f = fixture("# Page\n::: text\nOne\n:::\n\nMiddle\n\n::: text\nTwo\n:::\n");
		expect(f.run("wrapIn", [f.target("text")], { type: "group" })).toMatchObject({
			ok: false,
			code: "not-allowed",
		});
		expect(
			f.run("wrapIn", [f.target("text"), f.target("text", 1)], { type: "tabs" }),
		).toMatchObject({ ok: false, code: "not-allowed" });
	});
	it.each(WRAP_IN.text)("wrap in %s and unwrap restore body bytes and IDs", (type) => {
		const f = fixture(
			`\uFEFF# Page\r\n::: text\nCafé 😀\r\n::: \n\n::: text\r\nOther\n:::\r\n${type === "group" ? "\n::: choice Question\n(x) Yes\n( ) No\n:::\r\n" : ""}\nTail\n`,
		);
		const targets = [
			f.target("text"),
			f.target("text", 1),
			...(type === "group" ? [f.target("choice")] : []),
		];
		const r = applied(f.run("wrapIn", targets, { type, title: "Wrapped" }));
		const source = verify(f, r);
		for (const t of [f.target("text"), f.target("text", 1)])
			expect(r.mapping).toContainEqual({ oldId: id(t), newId: id(t), fate: "kept" });
		const unwrapped = fixture(source);
		const u = applied(unwrapped.run("wrapIn", [unwrapped.target(type)], { unwrap: true }));
		expect(verify(unwrapped, u)).toBe(f.source);
	});
	it("merge paragraphs absorbs the later node even with reversed targets", () => {
		const f = fixture("# Page\nFirst 😀\r\n\nSecond\n\nTail\n");
		const r = applied(f.run("mergeBlocks", [f.target("body", 1), f.target("body")]));
		expect(verify(f, r)).toBe("# Page\nFirst 😀\r\nSecond\n\nTail\n");
		expect(r.mapping).toContainEqual({
			oldId: id(f.target("body")),
			newId: id(f.target("body")),
			fate: "survivor",
		});
		expect(r.mapping).toContainEqual({
			oldId: id(f.target("body", 1)),
			newId: id(f.target("body")),
			fate: "absorbed",
		});
	});
	it("replace allocates throughout the subtree even for identical source", () => {
		const f = fixture("# Page\n::: note\nBody\n:::\n\nTail\n");
		const r = applied(f.run("replaceBlock", [f.target("note")], { text: "::: note\nBody\n:::" }));
		verify(f, r);
		for (const type of ["note", "body"])
			expect(r.mapping).toContainEqual({ oldId: id(f.target(type)), newId: null, fate: "retired" });
		expect(r.intent).toBe("replace");
		expect(r.mapping.filter((m) => m.fate === "new")).toHaveLength(2);
	});
	it("replacement refuses escaping content without allocating", () => {
		const f = fixture("# Page\nOld\n\nTail\n");
		expect(f.run("replaceBlock", [f.target("body")], { text: "# New page" })).toMatchObject({
			ok: false,
			code: "escapes-range",
		});
	});
});
