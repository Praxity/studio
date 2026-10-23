import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	type IdentityResolution,
	resolveIdentity,
	serializeIdentity,
} from "@praxity/content-identity";
import type { OperationTarget } from "@praxity/grammar/src/operations/contract.ts";
import { applyEdits } from "@praxity/grammar/src/source-edit.ts";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { expect, it } from "vitest";
import { type AppliedOperation, applyOperation, type OperationContext } from "../src";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const parse = (path: string, source: string) => ({
	path,
	tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
});
function fixture(
	a = "# A\n::: cards\n:: Card\nFront\n::: back\nBack\n:::\n:::\n\nTail\n\n# B\nOther\n",
	b = "# C\nDestination\n",
) {
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
	let clipboard: OperationContext["clipboard"];
	const node = (id: string, state: IdentityResolution = identity) =>
		state.snapshots.flatMap((s) => Object.entries(s.nodes)).find(([key]) => key === id)?.[1];
	const target = (type: string, ordinal = 0, file = "a.prax"): OperationTarget => {
		const m = identity.sourceMappings.filter((m) => m.file === file && node(m.id)?.type === type)[
			ordinal
		];
		return {
			file,
			ref: { kind: "node", nodeId: m.id, path: m.path, fingerprint: m.fingerprint },
			expectedText: files.find((f) => f.path === file)?.source.slice(m.span.start, m.span.end),
		};
	};
	const id = (t: OperationTarget) => (t.ref.kind === "node" ? t.ref.nodeId! : "");
	const boundary = (
		file = "b.prax",
		parent: string | null = id(target("page", 0, file)),
		after: string | null = id(target("body", 0, file)),
		before: string | null = null,
	): OperationTarget => ({ file, ref: { kind: "insertion", parentId: parent, after, before } });
	const run = (
		operation: string,
		targets: OperationTarget[],
		args: Record<string, unknown> = {},
		stale = false,
	) =>
		applyOperation(
			files,
			{
				transactionId: "o5",
				operation,
				targets,
				args,
				files: files.map((f, i) => ({
					path: f.path,
					baseRevision: stale && i === 1 ? "0".repeat(64) : digest(f.source),
				})),
			},
			{ ...deps, identity, clipboard },
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
		clipboard = r.clipboard;
		return r;
	};
	const undo = (r: AppliedOperation) => {
		const before = serial;
		const result = commit(run("applyInverse", [], { operation: r }));
		expect(serial).toBe(before);
		return result;
	};
	return {
		reloadClipboard: () => {
			clipboard = JSON.parse(JSON.stringify(clipboard));
		},
		attachState: (id: string) => {
			const snapshot = identity.snapshots.find((s) => s.nodes[id])!;
			snapshot.nodes[id].consumerRevisions = {
				state: { signature: digest("saved-state"), epoch: 7 },
			};
			identity.heads = identity.heads.map((h) => {
				const f = files.find((f) => f.path === h.path)!;
				const snap = identity.snapshots.find((s) => s.sourceHash === digest(f.source))!;
				return { ...h, head: digest(serializeIdentity(snap)) };
			});
		},
		target,
		id,
		node,
		boundary,
		run,
		commit,
		undo,
		get files() {
			return files;
		},
		get identity() {
			return identity;
		},
		get clipboard() {
			return clipboard;
		},
	};
}
it("two-file block move is one result, preserves all descendant IDs and exact inverse", () => {
	const f = fixture();
	const before = f.files;
	const t = f.target("cards");
	const r = f.commit(f.run("moveBlocks", [t, f.boundary()]));
	expect(r.files.map((f) => f.path)).toEqual(["a.prax", "b.prax"]);
	expect(f.files[0].source).not.toContain("::: cards");
	expect(f.files[1].source).toContain("::: cards");
	expect(r.mapping).toContainEqual({ oldId: f.id(t), newId: f.id(t), fate: "kept" });
	expect(r.focus.file).toBe("b.prax");
	f.undo(r);
	expect(f.files).toEqual(before);
});
it("stale second file refuses without edits or allocation", () => {
	const f = fixture();
	const before = f.identity;
	const r = f.run("moveBlocks", [f.target("cards"), f.boundary()], {}, true);
	expect(r).toMatchObject({ ok: false, code: "stale" });
	expect(r).not.toHaveProperty("files");
	expect(f.identity).toBe(before);
});
it("D20 cut, persisted record, cross-file move, second paste copy, undo restores cut record", () => {
	const f = fixture();
	const before = f.files;
	const t = f.target("cards");
	const card = f.id(t);
	const prior = f.node(card);
	const cut = f.commit(f.run("cutBlocks", [t]));
	expect(cut.intent).toBe("delete");
	expect(f.node(card)?.status).toBe("cut");
	expect(f.identity.exportable).toBe(true);
	expect(f.identity.exportIds).not.toContain(card);
	f.reloadClipboard();
	const record = JSON.parse(JSON.stringify(f.clipboard));
	const text = record.text;
	const move = f.commit(f.run("pasteBlocks", [f.boundary()], { text }));
	expect(move.intent).toBe("move");
	expect(f.clipboard).toBeNull();
	expect(f.node(card)?.revision).toBe(prior?.revision);
	expect(f.node(card)?.status).toBe("active");
	const copy = f.commit(
		f.run("pasteBlocks", [f.boundary("b.prax", f.id(f.target("page", 0, "b.prax")), card)], {
			text,
		}),
	);
	expect(copy.intent).toBe("copy");
	expect(
		copy.mapping.filter((m) => m.fate === "new" || m.fate === "copied").length,
	).toBeGreaterThan(0);
	f.undo(copy);
	f.undo(move);
	expect(f.clipboard).toEqual(record);
	expect(f.node(card)?.status).toBe("cut");
	f.undo(cut);
	expect(f.files).toEqual(before);
});
it("different clipboard text allocates and retains the waiting cut", () => {
	const f = fixture();
	const t = f.target("cards");
	f.commit(f.run("cutBlocks", [t]));
	const r = f.commit(f.run("pasteBlocks", [f.boundary()], { text: "Fresh" }));
	expect(r.intent).toBe("copy");
	expect(f.node(f.id(t))?.status).toBe("cut");
	expect(f.clipboard?.nodeIds).toContain(f.id(t));
});
it.each(["discardCut", "copyBlocks", "cutBlocks"])(
	"%s ends a prior cut record with retired IDs and undo restores it",
	(operation) => {
		const f = fixture();
		const t = f.target("cards");
		f.commit(f.run("cutBlocks", [t]));
		const record = f.clipboard;
		const r = f.commit(
			f.run(operation, operation === "discardCut" ? [f.boundary()] : [f.target("body")]),
		);
		expect(f.node(f.id(t))?.status).toBe("retired");
		f.undo(r);
		expect(f.clipboard).toEqual(record);
		expect(f.node(f.id(t))?.status).toBe("cut");
	},
);
it.each(["insertPage", "movePage", "setPageTitle", "mergePage", "deletePage"])(
	"%s has complete fates and exact undo",
	(operation) => {
		const f = fixture();
		const before = f.files;
		const pages = f.identity.sourceMappings.filter((m) => f.node(m.id)?.type === "page");
		const r = f.commit(
			f.run(
				operation,
				operation === "insertPage"
					? [f.boundary("a.prax", null, f.id(f.target("page", 0)), f.id(f.target("page", 1)))]
					: operation === "movePage"
						? [f.target("page"), f.boundary("b.prax", null, f.id(f.target("page", 0, "b.prax")))]
						: [f.target("page", operation === "mergePage" ? 1 : 0)],
				operation === "insertPage" || operation === "setPageTitle" ? { title: "Renamed" } : {},
			),
		);
		const touched =
			operation === "insertPage"
				? null
				: before[0].source.includes("# B") && operation === "mergePage"
					? pages.find((p) => p.file === "a.prax" && p.path[0] === 1)
					: pages.find((p) => p.file === "a.prax");
		for (const p of pages) {
			const fate =
				p.id === touched?.id
					? operation === "deletePage"
						? "retired"
						: operation === "mergePage"
							? "absorbed"
							: "kept"
					: operation === "mergePage" && p.file === "a.prax" && p.path[0] === 0
						? "survivor"
						: "kept";
			expect(r.mapping.find((m) => m.oldId === p.id)?.fate).toBe(fate);
			if (fate === "kept") expect(f.node(p.id)?.slug).toBe(f.node(p.id, r.history.identity)?.slug);
		}
		f.undo(r);
		expect(f.files).toEqual(before);
		for (const p of pages) expect(f.node(p.id)?.status).toBe("active");
	},
);
it("title changes retain ID and slug, and add an alias", () => {
	const f = fixture();
	const t = f.target("page");
	const old = f.node(f.id(t));
	const r = f.commit(f.run("setPageTitle", [t], { title: "New title" }));
	expect(f.node(f.id(t))?.slug).toBe(old?.slug);
	expect(f.node(f.id(t))?.aliases).toContain("new-title");
	f.undo(r);
	expect(f.node(f.id(t))?.aliases).toEqual(old?.aliases);
});
it("page merge keeps all blocks in order under the previous title", () => {
	const f = fixture("# First\nOne\n\n# Second\nTwo\n\nThree\n");
	const ids = f.identity.sourceMappings
		.filter((m) => f.node(m.id)?.type === "body")
		.map((m) => m.id);
	f.commit(f.run("mergePage", [f.target("page", 1)]));
	expect(f.files[0].source).toBe("# First\nOne\n\nTwo\n\nThree\n");
	for (const id of ids) expect(f.node(id)?.status).toBe("active");
});
it("delete undo rebases after an unrelated edit; changed restoration neighbour refuses", () => {
	const f = fixture("# A\nBefore\n\nDelete\n\nAfter\n\n# B\nUnrelated\n");
	const r = f.commit(f.run("deleteBlocks", [f.target("body", 1)]));
	f.commit(f.run("setText", [f.target("body", 2)], { field: "text", text: "Changed unrelated" }));
	f.undo(r);
	expect(f.files[0].source).toContain("Delete\n");
	expect(f.files[0].source).toContain("Changed unrelated");
	const d = f.commit(f.run("deleteBlocks", [f.target("body", 1)]));
	f.commit(f.run("setText", [f.target("body", 1)], { field: "text", text: "Conflict" }));
	expect(f.run("applyInverse", [], { operation: d })).toMatchObject({
		ok: false,
		code: "conflict",
	});
});
it("1,000 multi-file seeds preserve untouched UTF-8, valid parsing, fates and exact inverses", () => {
	for (let seed = 1; seed <= 1000; seed++) {
		const eol = seed % 3 === 0 ? "\n" : "\r\n";
		const a = `${seed % 2 ? "\uFEFF" : ""}# Caf\u00e9 \ud83d\ude00${eol}${eol}::: note${seed % 3 ? "\n" : eol}Words ${seed}\u202f?${eol}:::${eol}${eol}Tail${eol}\n# Next${eol}Next${eol}`;
		const f = fixture(a, "# Destination\nKeep e\u0301\n");
		const before = f.files;
		const original = f.identity.sourceMappings.map((m) => m.id);
		const results: AppliedOperation[] = [];
		const mode = seed % 8;
		const t = f.target(mode === 0 ? "note" : "page");
		if (mode < 2)
			results.push(
				f.commit(
					f.run(mode === 1 ? "movePage" : "moveBlocks", [
						t,
						mode === 1
							? f.boundary("b.prax", null, f.id(f.target("page", 0, "b.prax")))
							: f.boundary(),
					]),
				),
			);
		else if (mode === 2) {
			results.push(f.commit(f.run("cutBlocks", [f.target("note")])));
			results.push(f.commit(f.run("pasteBlocks", [f.boundary()], { text: f.clipboard!.text })));
		} else if (mode === 3)
			results.push(
				f.commit(
					f.run("pasteBlocks", [f.boundary()], {
						text: `Copied \ud83d\ude00 ${seed}\u202f?${eol}`,
					}),
				),
			);
		else if (mode === 4)
			results.push(
				f.commit(
					f.run(
						"insertPage",
						[f.boundary("a.prax", null, f.id(f.target("page")), f.id(f.target("page", 1)))],
						{ title: `Inserted ${seed}` },
					),
				),
			);
		else if (mode === 5)
			results.push(f.commit(f.run("setPageTitle", [t], { title: `Renamed ${seed}` })));
		else if (mode === 6) results.push(f.commit(f.run("mergePage", [f.target("page", 1)])));
		else results.push(f.commit(f.run("deletePage", [t])));
		for (const r of results) {
			for (const file of r.files) {
				const source = r.history.before.find((f) => f.path === file.path)!.source;
				const after = r.history.after.find((f) => f.path === file.path)!.source;
				let old = 0,
					newOffset = 0;
				for (const e of file.edits) {
					if (e.end > e.start) {
						const map = r.history.identity.sourceMappings.find(
							(m) => m.id === r.history.focus.nodeId && m.file === file.path,
						);
						expect(map, `seed ${seed}, owned range`).toBeDefined();
						if (!map) throw new Error("owned-range");
						const parent = map.path
							.slice(0, -1)
							.reduce((node, i) => node.children[i], parse(file.path, source).tree.root);
						const trivia = parent.trivia.filter(
							(span) => span.start === map.span.end || span.end === map.span.start,
						);
						expect(e.start, `seed ${seed}`).toBeGreaterThanOrEqual(
							Math.min(map.span.start, ...trivia.map((span) => span.start)),
						);
						expect(e.end, `seed ${seed}`).toBeLessThanOrEqual(
							Math.max(map.span.end, ...trivia.map((span) => span.end)),
						);
					}
					const count = e.start - old;
					expect(Buffer.from(after.slice(newOffset, newOffset + count))).toEqual(
						Buffer.from(source.slice(old, e.start)),
					);
					old = e.end;
					newOffset += count + e.text.length;
				}
				expect(Buffer.from(after.slice(newOffset))).toEqual(Buffer.from(source.slice(old)));
				expect(
					parse(file.path, after).tree.diagnostics.filter((d) => d.severity === "error"),
				).toEqual([]);
			}
		}
		for (const r of results.reverse()) f.undo(r);
		expect(f.files).toEqual(before);
		expect(f.identity.sourceMappings.map((m) => m.id).sort()).toEqual(original.sort());
	}
}, 60000);

it.each(["up", "down"])("page moves %s within a lesson retain every ID", (direction) => {
	const f = fixture("# A\nOne\n\n# B\nTwo\n\n# C\nThree\n");
	const before = f.files;
	const ids = f.identity.sourceMappings.map((m) => m.id);
	const r = f.commit(f.run("movePage", [f.target("page", 1)], { direction }));
	expect(f.identity.sourceMappings.map((m) => m.id).sort()).toEqual(ids.sort());
	expect(f.files[0].source.indexOf("# B")).toBe(
		direction === "up" ? 0 : f.files[0].source.lastIndexOf("# "),
	);
	f.undo(r);
	expect(f.files).toEqual(before);
});
it("page merge separates adjacent paragraphs and preserves both IDs", () => {
	const f = fixture("# A\nOne\n# B\nTwo\n");
	const ids = f.identity.sourceMappings
		.filter((m) => f.node(m.id)?.type === "body")
		.map((m) => m.id);
	const r = f.commit(f.run("mergePage", [f.target("page", 1)]));
	expect(f.files[0].source).toBe("# A\nOne\n\nTwo\n");
	for (const id of ids) expect(f.node(id)?.status).toBe("active");
	f.undo(r);
});
it("redo refuses a changed written slice and succeeds unchanged", () => {
	const f = fixture();
	const before = f.files;
	const r = f.commit(f.run("cutBlocks", [f.target("cards")]));
	const undid = f.undo(r);
	const redo = f.undo(undid);
	expect(f.clipboard?.text).toContain("::: cards");
	f.undo(redo);
	expect(f.files).toEqual(before);
	const d = f.commit(f.run("deleteBlocks", [f.target("cards")]));
	const restored = f.undo(d);
	f.commit(f.run("setText", [f.target("item")], { field: "subject", text: "Changed card" }));
	expect(f.run("applyInverse", [], { operation: restored })).toMatchObject({
		ok: false,
		code: "conflict",
	});
});
it("undo a deletion after a length-changing edit before its owner", () => {
	const f = fixture("# A\nEarlier\n\n# B\nBefore\n\nDelete\n\nAfter\n");
	const r = f.commit(f.run("deleteBlocks", [f.target("body", 2)]));
	f.commit(
		f.run("setText", [f.target("body", 0)], { field: "text", text: "An unrelated longer edit" }),
	);
	f.undo(r);
	expect(f.files[0].source).toBe(
		"# A\nAn unrelated longer edit\n\n# B\nBefore\n\nDelete\n\nAfter\n",
	);
});
it("cut keeps narrated and learner-state consumer revisions through move and inverse", () => {
	const f = fixture();
	const target = f.target("cards");
	f.attachState(f.id(target));
	const state = f.node(f.id(target))?.consumerRevisions;
	const children = f.identity.sourceMappings
		.filter((m) => m.file === "a.prax" && m.path[0] === 0 && m.path[1] === 0)
		.map((m) => m.id);
	const cut = f.commit(f.run("cutBlocks", [target]));
	const r = f.commit(f.run("pasteBlocks", [f.boundary()], { text: f.clipboard!.text }));
	for (const id of children) {
		expect(r.mapping).toContainEqual({ oldId: id, newId: id, fate: "kept" });
		expect(f.node(id)?.status).toBe("active");
	}
	expect(f.node(f.id(target))?.consumerRevisions).toEqual(state);
	f.undo(r);
	for (const id of children) expect(f.node(id)?.status).toBe("cut");
	f.undo(cut);
});
it.each(["# Escaped\nWords", ":: Outside\nWords", "::: note\nUnclosed"])(
	"paste refuses escaped content atomically: %s",
	(text) => {
		const f = fixture();
		const before = f.files;
		expect(f.run("pasteBlocks", [f.boundary()], { text })).toMatchObject({
			ok: false,
			code: "escapes-range",
		});
		expect(f.files).toEqual(before);
	},
);

it("paste rejects a changed persisted cut payload without stealing identity", () => {
	const f = fixture();
	f.commit(f.run("cutBlocks", [f.target("cards")]));
	f.clipboard!.text = f.clipboard!.text.replace("Front", "Different");
	expect(f.run("pasteBlocks", [f.boundary()], { text: f.clipboard!.text })).toMatchObject({
		ok: false,
		code: "conflict",
	});
});
it("paste refuses a schema-forbidden child", () => {
	const f = fixture("# A\n::: choice Question\n(x) Yes\n( ) No\n:::\n");
	const owner = f.id(f.target("choice"));
	const last = f.id(f.target("option", 1));
	expect(
		f.run("pasteBlocks", [f.boundary("a.prax", owner, last)], {
			text: "::: cards\n:: Card\nBody\n:::\n",
		}),
	).toMatchObject({ ok: false, code: "not-allowed" });
});
it("cut paste preserves mixed endings for nonadjacent blocks and every ID", () => {
	const f = fixture("# A\r\nFirst\r\n\nBetween\n\nThird\n");
	const targets = [f.target("body", 2), f.target("body", 0)];
	const before = f.files;
	const cut = f.commit(f.run("cutBlocks", targets));
	expect(f.clipboard?.nodeIds).toEqual(targets.map(f.id).reverse());
	const paste = f.commit(f.run("pasteBlocks", [f.boundary()], { text: f.clipboard!.text }));
	for (const target of targets) expect(f.node(f.id(target))?.status).toBe("active");
	expect(f.files[1].source).toContain("First\r\n\nThird\n");
	f.undo(paste);
	f.undo(cut);
	expect(f.files).toEqual(before);
});
it("a changed destination refuses the entire two-file inverse", () => {
	const f = fixture();
	const move = f.commit(f.run("moveBlocks", [f.target("cards"), f.boundary()]));
	f.commit(
		f.run("setText", [f.target("item", 0, "b.prax")], { field: "subject", text: "Conflict" }),
	);
	const before = f.files;
	expect(f.run("applyInverse", [], { operation: move })).toMatchObject({
		ok: false,
		code: "conflict",
	});
	expect(f.files).toEqual(before);
});
it("empty-title pages, invalid targets and merging the first page refuse", () => {
	const f = fixture();
	expect(
		f.run(
			"insertPage",
			[f.boundary("a.prax", null, f.id(f.target("page", 0)), f.id(f.target("page", 1)))],
			{ title: " " },
		),
	).toMatchObject({ ok: false, code: "invalid-args" });
	expect(f.run("mergePage", [f.target("page")])).toMatchObject({ ok: false, code: "not-allowed" });
	expect(f.run("deletePage", [f.target("cards")])).toMatchObject({
		ok: false,
		code: "not-allowed",
	});
});
it("converted-course pages move across files with original bytes and complete fates", () => {
	for (const ending of ["lf", "crlf", "mixed"]) {
		let line = 0;
		const read = (path: string) =>
			readFileSync(
				new URL(`../../grammar/__tests__/fixtures/v4/${path}.prax`, import.meta.url),
				"utf8",
			).replace(/\r?\n/gu, () =>
				ending === "lf" ? "\n" : ending === "crlf" || line++ % 2 ? "\r\n" : "\n",
			);
		const f = fixture(read("leadership/00-avant-de-commencer"), read("toolkit/welcome"));
		const before = f.files;
		const target = f.target("page");
		const ids = f.identity.sourceMappings
			.filter(
				(m) =>
					m.file === "a.prax" &&
					m.path[0] === (target.ref.kind === "node" ? target.ref.path[0] : -1),
			)
			.map((m) => m.id);
		expect(ids.length).toBeGreaterThan(1);
		const r = f.commit(
			f.run("movePage", [
				target,
				f.boundary("b.prax", null, f.id(f.target("page", 0, "b.prax")), null),
			]),
		);
		for (const id of ids) expect(r.mapping).toContainEqual({ oldId: id, newId: id, fate: "kept" });
		f.undo(r);
		expect(f.files).toEqual(before);
	}
}, 30000);

it("restoration follows page IDs after a new unrelated earlier page is inserted", () => {
	const f = fixture("# A\nEarlier\n\n# B\nBefore\n\nDelete\n\nAfter\n");
	const r = f.commit(f.run("deleteBlocks", [f.target("body", 2)]));
	f.commit(
		f.run("insertPage", [f.boundary("a.prax", null, null, f.id(f.target("page")))], {
			title: "Inserted",
		}),
	);
	f.undo(r);
	expect(f.files[0].source).toContain("# B\nBefore\n\nDelete\n\nAfter");
	expect(
		f.identity.sourceMappings
			.filter((m) => f.node(m.id)?.type === "page")
			.map((m) => f.node(m.id)?.label),
	).toContain("Inserted");
});
it("new page slugs cannot reuse a renamed page's persistent URL", () => {
	const f = fixture("# Original\nOne\n");
	const original = f.id(f.target("page"));
	f.commit(f.run("setPageTitle", [f.target("page")], { title: "New title" }));
	f.commit(f.run("insertPage", [f.boundary("a.prax", null, original)], { title: "Original" }));
	const slugs = f.identity.sourceMappings
		.filter((m) => f.node(m.id)?.type === "page")
		.map((m) => f.node(m.id)?.slug);
	expect(new Set(slugs).size).toBe(slugs.length);
	expect(f.node(original)?.slug).toBe("original");
});

it("page move shortcuts stop at lesson ends and preserve frontmatter", () => {
	const f = fixture("---\ntitle: Lesson\n---\n# A\nOne\n");
	expect(f.run("movePage", [f.target("page")], { direction: "up" })).toMatchObject({
		ok: false,
		code: "not-allowed",
	});
	expect(f.run("movePage", [f.target("page")], { direction: "down" })).toMatchObject({
		ok: false,
		code: "not-allowed",
	});
});
it("inverse rebuilds diagnostics for restored source", () => {
	const f = fixture("# A\n::: note {tone=note}\nWords\n:::\n");
	const r = f.commit(
		f.run("editSource", [f.target("note")], { text: "::: note {tone=INVALID}\nWords\n" }),
	);
	expect(r.diagnostics.length).toBeGreaterThan(0);
	const u = f.undo(r);
	expect(u.diagnostics).toEqual([]);
	expect(f.identity.exportable).toBe(true);
});
it("unrelated conversions survive deletion undo", () => {
	const f = fixture("# A\nBefore\n\nDelete\n\nAfter\n\n# B\n::: note\nWords\n:::\n");
	const r = f.commit(f.run("deleteBlocks", [f.target("body", 1)]));
	const unrelated = f.id(f.target("note"));
	f.commit(f.run("turnInto", [f.target("note")], { type: "quote" }));
	f.undo(r);
	expect(f.node(unrelated)?.type).toBe("quote");
	expect(f.files[0].source).toContain("Delete");
});
