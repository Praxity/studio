import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveIdentity } from "@praxity/content-identity";
import type { InlineNode } from "@praxity/content-model/inline-tree";
import type { OperationTarget } from "@praxity/grammar/src/operations/contract.ts";
import { applyEdits } from "@praxity/grammar/src/source-edit.ts";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition, learnerInline, validateCourse } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { expect, it } from "vitest";
import { type AppliedOperation, applyOperation } from "../src";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const parse = (path: string, source: string) => ({
	path,
	tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
});
function fixture(a: string, b = "# B\nUnchanged\n") {
	let serial = 1;
	let files = [
		{ path: "a.prax", source: a },
		{ path: "b.prax", source: b },
	];
	const deps = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${(serial++).toString(16).padStart(12, "0")}`,
	};
	let identity = resolveIdentity(
		{ parsedDocuments: files.map((f) => parse(f.path, f.source)), priorSnapshots: [] },
		deps,
	);
	const target = (raw: string, ordinal = 0, path = "a.prax"): OperationTarget => {
		const source = files.find((f) => f.path === path)?.source;
		if (source === undefined) throw new Error("fixture-file");
		let start = -1;
		for (let i = 0; i <= ordinal; i++) start = source.indexOf(raw, start + 1);
		const m = identity.sourceMappings
			.filter(
				(m) =>
					m.file === path &&
					m.path.length > 0 &&
					m.span.start <= start &&
					m.span.end >= start + raw.length,
			)
			.sort((a, b) => a.span.end - a.span.start - (b.span.end - b.span.start))[0];
		if (!m || start < 0) throw new Error("fixture-target");
		return {
			file: path,
			ref: { kind: "node", nodeId: m.id, path: m.path, fingerprint: m.fingerprint },
			expectedText: source.slice(m.span.start, m.span.end),
			inline: { start, end: start + raw.length, expectedText: raw },
		};
	};
	const run = (
		targets: OperationTarget[],
		args: Record<string, unknown>,
		operation = "editInline",
	) =>
		applyOperation(
			files,
			{
				transactionId: "o6",
				operation,
				targets,
				args,
				files: files.map((f) => ({ path: f.path, baseRevision: digest(f.source) })),
			},
			{ identity, ...deps },
		);
	const commit = (r: ReturnType<typeof run>) => {
		expect(r.ok, JSON.stringify(r)).toBe(true);
		if (!r.ok) throw new Error(r.code);
		for (const old of identity.sourceMappings)
			expect(
				r.mapping.some((m) => m.oldId === old.id),
				old.id,
			).toBe(true);
		const kept = r.mapping.filter((m) => m.fate === "kept").map((m) => m.newId);
		expect(new Set(kept).size).toBe(kept.length);
		files = files.map((f) => ({
			...f,
			source: applyEdits(f.source, r.files.find((e) => e.path === f.path)?.edits ?? []),
		}));
		identity = r.identity;
		return r;
	};
	const roundtrip = (r: AppliedOperation, before: typeof files, ids: string[]) => {
		const allocations = serial;
		const undone = commit(run([], { operation: r }, "applyInverse"));
		expect(files).toEqual(before);
		expect(identity.sourceMappings.map((m) => m.id)).toEqual(ids);
		expect(serial).toBe(allocations);
		commit(run([], { operation: undone }, "applyInverse"));
	};
	return {
		target,
		run,
		commit,
		roundtrip,
		get files() {
			return files;
		},
		get identity() {
			return identity;
		},
	};
}

it.each(["\n", "\r\n", "mixed"])(
	"E8 separate link edits preserve surrounding UTF-8 bytes, %s",
	(ending) => {
		const source =
			ending === "mixed"
				? "\uFEFF# A\r\n\r\nAvant\u202f? 😀 [**Old**](https://example.org/a(b))!\n\nTail\r\n"
				: `\uFEFF# A${ending}${ending}Avant\u202f? 😀 [**Old**](https://example.org/a(b))!${ending}${ending}Tail${ending}`;
		for (const [args, expected] of [
			[{ text: "New" }, "[**New**](https://example.org/a(b))"],
			[{ target: "mailto:a@example.org" }, "[**Old**](mailto:a@example.org)"],
		] as const) {
			const f = fixture(source);
			const before = f.files;
			const ids = f.identity.sourceMappings.map((m) => m.id);
			const t = f.target("[**Old**](https://example.org/a(b))");
			const r = f.commit(f.run([t], args));
			expect(Buffer.from(f.files[0].source)).toEqual(
				Buffer.from(source.replace(t.inline?.expectedText ?? "", expected)),
			);
			for (const e of r.files[0].edits) {
				expect(e.start).toBeGreaterThanOrEqual(t.inline?.start ?? 0);
				expect(e.end).toBeLessThanOrEqual(t.inline?.end ?? 0);
			}
			expect(r.intent).toBe("modify");
			expect(r.mapping.every((m) => m.fate === "kept")).toBe(true);
			f.roundtrip(r, before, ids);
		}
	},
);
it.each(["javascript:alert(1)", "vbscript:x", "blob:x", "data:text/html,x"])(
	"E8 URL owner rejection returns its refusal code: %s",
	(target) => {
		const f = fixture("# A\n[Label](https://example.org)\n");
		const before = f.files;
		const t = f.target("[Label](https://example.org)");
		expect(f.run([t], { target })).toMatchObject({
			ok: false,
			code: "not-allowed",
			file: "a.prax",
			member: t.ref.kind === "node" ? t.ref.nodeId : "",
		});
		expect(f.files).toBe(before);
	},
);
it.each(["tel:+15551234567", "mailto:a@example.org", "#page", "https://example.org/a(b)"])(
	"E8 accepts the existing URL policy answer: %s",
	(target) => {
		const f = fixture("# A\n::: button [Label](https://example.org) {newTab}\n:::\n");
		f.commit(f.run([f.target("[Label](https://example.org)")], { target }));
		expect(f.files[0].source).toBe(`# A\n::: button [Label](${target}) {newTab}\n:::\n`);
	},
);
it("E7 edit a mention's definition in another lesson, two files and one undo", () => {
	const f = fixture("# A\n[**PPE**]{}! [PPE]{}\n", "# B\n[**PPE**]{Old definition}\n");
	const before = f.files;
	const ids = f.identity.sourceMappings.map((m) => m.id);
	const r = f.commit(f.run([f.target("[**PPE**]{}")], { definition: "New {definition}\u202f!" }));
	expect(r.files.map((f) => f.path)).toEqual(["a.prax", "b.prax"]);
	const selected = f.target("[**PPE**]{}");
	expect(r.focus).toMatchObject({
		file: "a.prax",
		nodeId: selected.ref.kind === "node" ? selected.ref.nodeId : null,
	});
	expect(f.files[0].source).toBe(before[0].source);
	expect(f.files[1].source).toBe("# B\n[**PPE**]{New \\{definition\\}\u202f!}\n");
	expect(
		validateCourse(f.files.map((f) => parse(f.path, f.source))).glossary.get("PPE")?.definition,
	).toBe("New {definition}\u202f!");
	f.roundtrip(r, before, ids);
});
it("E7 rename one repeated mention creates its definer and keeps emphasis", () => {
	const f = fixture("# A\n[**PPE**]{}! [PPE]{}\n", "# B\n[PPE]{Equipment}\n");
	const before = f.files;
	const ids = f.identity.sourceMappings.map((m) => m.id);
	expect(f.run([f.target("[**PPE**]{}")], { text: "Gear", rename: "one" })).toMatchObject({
		ok: false,
		code: "invalid-args",
	});
	const r = f.commit(
		f.run([f.target("[**PPE**]{}")], { text: "Gear", definition: "Protection", rename: "one" }),
	);
	expect(f.files[0].source).toBe("# A\n[**Gear**]{Protection}! [PPE]{}\n");
	expect(f.files[1]).toEqual(before[1]);
	f.roundtrip(r, before, ids);
});
it("E7 rename all tokens across files as one mapping fixture and exact inverse", () => {
	const f = fixture(
		"# A\n[**PPE**]{}! [PPE]{}\n\n`[PPE]{}`\n",
		"# B\n[PPE]{Equipment} and [*PPE*]{}\n",
	);
	const before = f.files;
	const ids = f.identity.sourceMappings.map((m) => m.id);
	expect(f.run([f.target("[**PPE**]{}")], { text: "Gear" })).toMatchObject({
		ok: false,
		code: "invalid-args",
	});
	const r = f.commit(
		f.run([f.target("[**PPE**]{}")], { text: "Gear", rename: "all", definition: "Protection" }),
	);
	expect(f.files[0].source).toBe("# A\n[**Gear**]{}! [Gear]{}\n\n`[PPE]{}`\n");
	expect(f.files[1].source).toBe("# B\n[Gear]{Protection} and [*Gear*]{}\n");
	expect(r.mapping.every((m) => m.fate === "kept")).toBe(true);
	expect(validateCourse(f.files.map((f) => parse(f.path, f.source))).diagnostics).toEqual([]);
	f.roundtrip(r, before, ids);
});
it("G9 one stale member refuses several targets with no changes", () => {
	const f = fixture("# A\n[A](https://example.org) [B](https://example.org)\n");
	const before = f.files;
	const a = f.target("[A](https://example.org)");
	const b = f.target("[B](https://example.org)");
	b.expectedText = "stale";
	expect(f.run([a, b], { text: "New" })).toMatchObject({
		ok: false,
		code: "conflict",
		member: b.ref.kind === "node" ? b.ref.nodeId : "",
	});
	expect(f.files).toBe(before);
});
it("several tokens in one owner and across files share a result", () => {
	const f = fixture(
		"# A\n[A](https://example.org) [B](https://example.org)\n",
		"# B\n[C](https://example.org)\n",
	);
	const before = f.files;
	const ids = f.identity.sourceMappings.map((m) => m.id);
	const r = f.commit(
		f.run(
			[
				f.target("[A](https://example.org)"),
				f.target("[B](https://example.org)"),
				f.target("[C](https://example.org)", 0, "b.prax"),
			],
			{ text: "New" },
		),
	);
	expect(f.files[0].source).toBe("# A\n[New](https://example.org) [New](https://example.org)\n");
	expect(f.files[1].source).toBe("# B\n[New](https://example.org)\n");
	f.roundtrip(r, before, ids);
});

it("G9 stale token spelling and node fingerprint identify the failing member", () => {
	const f = fixture("# A\n[A](https://example.org)\n", "# B\n[B](https://example.org)\n");
	const a = f.target("[A](https://example.org)");
	const b = f.target("[B](https://example.org)", 0, "b.prax");
	if (b.ref.kind !== "node" || !b.inline) throw new Error("fixture-target");
	b.inline.expectedText = "changed";
	expect(f.run([a, b], { text: "New" })).toMatchObject({
		ok: false,
		code: "conflict",
		file: "b.prax",
		member: b.ref.nodeId,
	});
	b.ref.fingerprint = "stale";
	expect(f.run([a, b], { text: "New" })).toMatchObject({
		ok: false,
		code: "stale",
		file: "b.prax",
		member: b.ref.nodeId,
	});
});
it("G9 undo refuses the complete two-file rename after one occurrence changes", () => {
	const f = fixture("# A\n[PPE]{}\n", "# B\n[PPE]{Equipment}\n");
	const r = f.commit(f.run([f.target("[PPE]{}")], { text: "Gear", rename: "all" }));
	f.commit(f.run([f.target("[Gear]{Equipment}", 0, "b.prax")], { definition: "Changed" }));
	const before = f.files;
	expect(f.run([], { operation: r }, "applyInverse")).toMatchObject({
		ok: false,
		code: "conflict",
	});
	expect(f.files).toBe(before);
});
it("rename cannot orphan old mentions or create conflicting definitions", () => {
	const f = fixture("# A\n[PPE]{Equipment} [PPE]{} [Hat]{Headwear}\n");
	expect(f.run([f.target("[PPE]{Equipment}")], { text: "Gear", rename: "one" })).toMatchObject({
		ok: false,
		code: "not-allowed",
	});
	expect(
		f.run([f.target("[PPE]{Equipment}"), f.target("[Hat]{Headwear}")], {
			text: "Gear",
			rename: "all",
		}),
	).toMatchObject({ ok: false, code: "not-allowed" });
});
it("label edits cannot silently change text or remove authored emphasis", () => {
	const f = fixture("# A\n[Long **tail**](https://example.org)\n");
	expect(f.run([f.target("[Long **tail**](https://example.org)")], { text: "X" })).toMatchObject({
		ok: false,
		code: "invalid-args",
	});
});
it("rename splits preserve emoji at formatting boundaries", () => {
	const f = fixture("# A\n[A**BC**]{Definition}\n");
	f.commit(f.run([f.target("[A**BC**]{Definition}")], { text: "😀Gear" }));
	expect(f.files[0].source).toBe("# A\n[😀**Gear**]{Definition}\n");
});
it.each([
	"https://example.org)escape",
	"https://example.org/white space",
	"",
	"https://example.org/(unclosed",
])("malformed destinations refuse without expanding the token: %s", (target) => {
	const f = fixture("# A\n[Label](https://example.org)\n");
	expect(f.run([f.target("[Label](https://example.org)")], { target })).toMatchObject({
		ok: false,
		code: "invalid-args",
	});
});
it("one mention can join an existing term and edit that term's remote definer", () => {
	const f = fixture("# A\n[PPE]{} [PPE]{}\n", "# B\n[PPE]{Equipment} [Gear]{Protection}\n");
	f.commit(
		f.run([f.target("[PPE]{}")], { text: "Gear", rename: "one", definition: "New protection" }),
	);
	expect(f.files[0].source).toBe("# A\n[Gear]{} [PPE]{}\n");
	expect(f.files[1].source).toBe("# B\n[PPE]{Equipment} [Gear]{New protection}\n");
});
it("definition accepts contained multiline plain text and exact undo", () => {
	const f = fixture("# A\r\n[**PPE**]{Equipment}\r\n");
	const before = f.files;
	const ids = f.identity.sourceMappings.map((m) => m.id);
	const r = f.commit(
		f.run([f.target("[**PPE**]{Equipment}")], { definition: "First line\r\nSecond line\u202f!" }),
	);
	expect(f.files[0].source).toBe("# A\r\n[**PPE**]{First line\r\nSecond line\u202f!}\r\n");
	expect(
		validateCourse(f.files.map((f) => parse(f.path, f.source))).glossary.get("PPE")?.definition,
	).toBe("First line\r\nSecond line\u202f!");
	f.roundtrip(r, before, ids);
});
it("G9 a later member's malformed formatted label is named", () => {
	const f = fixture(
		"# A\n[Label](https://example.org)\n",
		"# B\n[Long **tail**](https://example.org)\n",
	);
	const b = f.target("[Long **tail**](https://example.org)", 0, "b.prax");
	expect(f.run([f.target("[Label](https://example.org)"), b], { text: "X" })).toMatchObject({
		ok: false,
		code: "invalid-args",
		file: "b.prax",
		member: b.ref.kind === "node" ? b.ref.nodeId : "",
	});
});
it.each(["First\n\nSecond", "First\n# Escape", "First\n::: note\nInside\n:::"])(
	"definition cannot escape its parsed token: %s",
	(definition) => {
		const f = fixture("# A\n[PPE]{Equipment}\n\nUntouched\n");
		expect(f.run([f.target("[PPE]{Equipment}")], { definition }).ok).toBe(false);
	},
);
it("G9 a later definer that would orphan mentions is the refusing member", () => {
	const f = fixture("# A\n[Hat]{Headwear}\n", "# B\n[PPE]{Equipment} [PPE]{}\n");
	const second = f.target("[PPE]{Equipment}", 0, "b.prax");
	expect(
		f.run([f.target("[Hat]{Headwear}"), second], { text: "Gear", rename: "one" }),
	).toMatchObject({
		ok: false,
		code: "not-allowed",
		file: "b.prax",
		member: second.ref.kind === "node" ? second.ref.nodeId : "",
	});
});
it("a valid inline edit in an invalid draft preserves pending identities and untouched bytes", () => {
	const source =
		"\uFEFF# A\r\n::: note {tone=invalid}\n[Label](https://example.org)\r\n:::\n\nUnowned\u202f?\r\n";
	const f = fixture(source);
	const before = f.files;
	const ids = f.identity.sourceMappings.map((m) => m.id);
	const r = f.commit(f.run([f.target("[Label](https://example.org)")], { text: "New" }));
	expect(f.files[0].source).toBe(source.replace("[Label]", "[New]"));
	expect(r.mapping.some((m) => m.fate === "pending")).toBe(true);
	expect(r.mapping.every((m) => m.fate === "pending" || m.fate === "kept")).toBe(true);
	f.roundtrip(r, before, ids);
});
it("rename-all includes terms in page titles and keeps page identities", () => {
	const f = fixture("# [PPE]{}\n[PPE]{}\n", "# B\n[PPE]{Equipment}\n");
	const before = f.files;
	const ids = f.identity.sourceMappings.map((m) => m.id);
	const r = f.commit(f.run([f.target("[PPE]{}")], { text: "Gear", rename: "all" }));
	expect(f.files[0].source).toBe("# [Gear]{}\n[Gear]{}\n");
	expect(r.summary.params.count).toBe(3);
	f.roundtrip(r, before, ids);
});
it("converted-course inline target edits keep LF, CRLF and mixed bytes and every identity", () => {
	const flatten = (nodes: readonly InlineNode[]): InlineNode[] =>
		nodes.flatMap((n) => [n, ...("children" in n ? flatten(n.children) : [])]);
	for (const ending of ["lf", "crlf", "mixed"]) {
		let line = 0;
		const read = (path: string) =>
			readFileSync(
				new URL(`../../grammar/__tests__/fixtures/v4/${path}.prax`, import.meta.url),
				"utf8",
			).replace(/\r?\n/gu, () =>
				ending === "lf" ? "\n" : ending === "crlf" || line++ % 2 ? "\r\n" : "\n",
			);
		const a = read("leadership/00-avant-de-commencer");
		// The toolkit welcome has no inline links; append a fixture token without rewriting its course bytes.
		const b = `${read("toolkit/welcome")}\n\n[Toolkit resource](https://example.org)\n`;
		for (const path of ["a.prax", "b.prax"]) {
			const f = fixture(a, b);
			const before = f.files;
			const ids = f.identity.sourceMappings.map((m) => m.id);
			const source = path === "a.prax" ? a : b;
			const links = flatten(learnerInline(parse(path, source))).filter((n) => n.kind === "link");
			expect(links.length).toBeGreaterThan(0);
			const token = links[0];
			if (token.kind !== "link") throw new Error("fixture-link");
			const r = f.commit(
				f.run([f.target(token.raw, 0, path)], { target: "https://example.org/changed" }),
			);
			expect(Buffer.from(f.files.find((f) => f.path === path)?.source ?? "")).toEqual(
				Buffer.from(
					source.slice(0, token.destination.start) +
						"https://example.org/changed" +
						source.slice(token.destination.end),
				),
			);
			expect(r.mapping.every((m) => m.fate === "kept")).toBe(true);
			f.roundtrip(r, before, ids);
		}
	}
});
it("1,000-seed inline gate: ranges, UTF-8 bytes, complete fates and exact undo", () => {
	for (let seed = 1; seed <= 1000; seed++) {
		const eol = seed % 3 === 0 ? "\r\n" : "\n";
		const token = seed % 2 ? "[**PPE**]{}" : "[**Old**](https://example.org/a(b))";
		const source = `\uFEFF# A${eol}${eol}Café 😀 ${seed}\u202f? ${token}!${eol}${eol}Unowned\u202f;${seed % 3 === 1 ? "\r\n" : eol}`;
		const f = fixture(source, `# B${eol}[PPE]{Equipment}${eol}`);
		const before = f.files;
		const ids = f.identity.sourceMappings.map((m) => m.id);
		const args =
			seed % 2
				? {
						text: `Gear${seed}`,
						rename: seed % 4 === 1 ? "one" : "all",
						definition: `Protection ${seed}`,
					}
				: seed % 4 === 0
					? { text: `New${seed}` }
					: { target: `https://example.org/${seed}` };
		const r = f.commit(f.run([f.target(token)], args));
		for (const file of r.files) {
			const old = before.find((f) => f.path === file.path)?.source ?? "";
			const next = f.files.find((f) => f.path === file.path)?.source ?? "";
			let oldCursor = 0;
			let newCursor = 0;
			for (const e of file.edits) {
				expect(Buffer.from(next.slice(newCursor, newCursor + e.start - oldCursor))).toEqual(
					Buffer.from(old.slice(oldCursor, e.start)),
				);
				newCursor += e.start - oldCursor + e.text.length;
				oldCursor = e.end;
				expect(e.start).toBeGreaterThanOrEqual(old.indexOf("["));
				expect(e.end).toBeLessThanOrEqual(
					old.indexOf("}", old.indexOf("[")) >= 0
						? old.indexOf("}", old.indexOf("[")) + 1
						: old.indexOf(")!", old.indexOf("[")) + 1,
				);
			}
			expect(Buffer.from(next.slice(newCursor))).toEqual(Buffer.from(old.slice(oldCursor)));
		}
		expect(validateCourse(f.files.map((f) => parse(f.path, f.source))).diagnostics).toEqual([]);
		expect(r.mapping.every((m) => m.fate === "kept")).toBe(true);
		f.roundtrip(r, before, ids);
	}
}, 120_000);
