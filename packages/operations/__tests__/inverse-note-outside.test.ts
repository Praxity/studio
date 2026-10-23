import { createHash } from "node:crypto";
import { resolveIdentity, serializeIdentity } from "@praxity/content-identity";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { type AppliedOperation, applyOperation, planInverseGroup } from "../src/index.ts";

const original = "# Page\r\n::: note\r\nText\r\n:::\r\n\r\nTail";
const sources = {
	plain: {
		Text: original,
		Two: "# Page\r\n::: note\r\nTwo\r\n:::\r\n\r\nTail",
		Three: "# Page\r\n::: note\r\nThree\r\n:::\r\n\r\nTail",
	},
	insert: {
		Text: "# Page\r\nIntro Café 😀\u202f?\r\n\r\n::: note\r\nText\r\n:::\r\n\r\nTail",
		Two: "# Page\r\nIntro Café 😀\u202f?\r\n\r\n::: note\r\nTwo\r\n:::\r\n\r\nTail",
		Three: "# Page\r\nIntro Café 😀\u202f?\r\n\r\n::: note\r\nThree\r\n:::\r\n\r\nTail",
	},
	tail: {
		Text: "# Page\r\n::: note\r\nText\r\n:::\r\n\r\nOutside Café 😀\u202f?",
		Two: "# Page\r\n::: note\r\nTwo\r\n:::\r\n\r\nOutside Café 😀\u202f?",
		Three: "# Page\r\n::: note\r\nThree\r\n:::\r\n\r\nOutside Café 😀\u202f?",
	},
};

function session() {
	let next = 1;
	const dependencies = {
		digest: (text: string) => createHash("sha256").update(text).digest("hex"),
		allocateId: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`,
	};
	let files = [{ path: "lesson.prax", source: original }];
	const documents = () => files.map((f) => ({ path: f.path, tree: readLesson(f.source).tree }));
	let identity = resolveIdentity(
		{ parsedDocuments: documents(), priorSnapshots: [], readerRoles: true },
		dependencies,
	);
	const noteId = identity.sourceMappings.find((m) => m.path.join() === "0,0")?.id;
	if (!noteId) throw new Error("Missing note");
	const context = () => ({ identity, readerRoles: true, ...dependencies });
	function ids(inside: boolean) {
		const note = identity.sourceMappings.find((m) => m.id === noteId);
		if (!note) throw new Error("Missing note");
		return identity.sourceMappings
			.filter((m) => note.path.every((n, i) => m.path[i] === n) === inside)
			.map((m) => m.id);
	}
	const initialIds = ids(true);
	const operations: AppliedOperation[] = [];
	for (const text of ["One", "Two", "Three"]) {
		const node = identity.sourceMappings.find((m) => m.id === noteId);
		if (!node) throw new Error("Missing note");
		const result = applyOperation(
			files,
			{
				transactionId: text,
				operation: "editSource",
				files: files.map((f) => ({ path: f.path, baseRevision: dependencies.digest(f.source) })),
				targets: [
					{
						file: node.file,
						ref: { kind: "node", nodeId: node.id, path: node.path, fingerprint: node.fingerprint },
						expectedText: files[0].source.slice(node.span.start, node.span.end),
					},
				],
				args: { text: `::: note\n${text}\n` },
			},
			context(),
		);
		if (!result.ok) throw new Error(result.code);
		operations.push(result);
		files = result.history.after;
		identity = result.identity;
	}
	function outside(source: string) {
		files = [{ path: "lesson.prax", source }];
		identity = resolveIdentity(
			{
				course: identity.course,
				priorHeads: identity.heads,
				priorSnapshots: identity.snapshots,
				parsedDocuments: documents(),
				readerRoles: true,
			},
			dependencies,
		);
	}
	function invert(mode: "single" | "group", records: AppliedOperation[]) {
		const before = serializeIdentity({ files, identity, records });
		const result =
			mode === "group"
				? planInverseGroup(files, { transactionId: "inverse", operations: records }, context())
				: applyOperation(
						files,
						{
							transactionId: "inverse",
							operation: "applyInverse",
							targets: [],
							files: files.map((f) => ({
								path: f.path,
								baseRevision: dependencies.digest(f.source),
							})),
							args: { operation: records[0] },
						},
						context(),
					);
		expect(serializeIdentity({ files, identity, records })).toBe(before);
		if (!result.ok) return result;
		files = "after" in result ? result.after : result.history.after;
		identity = result.identity;
		return { ok: true as const, records: "members" in result ? result.members : [result] };
	}
	return {
		initialIds,
		operations,
		outside,
		invert,
		ids,
		get source() {
			return files[0].source;
		},
		bytes: (records = operations) => serializeIdentity({ files, identity, records }),
	};
}

for (const mode of ["single", "group"] as const) {
	for (const change of ["insert", "tail"] as const) {
		for (const timing of ["undo", "redo"] as const) {
			it(`D14 ${mode} note undo/redo preserves ${change}-only outside bytes before ${timing} and restores IDs`, () => {
				const s = session();
				const records = mode === "single" ? [s.operations[2]] : s.operations;
				const beforeIds =
					mode === "single"
						? s.operations[2].history.identity.sourceMappings
								.filter((m) => m.path[0] === 0 && m.path[1] === 0)
								.map((m) => m.id)
						: s.initialIds;
				const writtenIds = s.ids(true);
				const restored = mode === "single" ? "Two" : "Text";
				if (timing === "undo") s.outside(sources[change].Three);
				const outsideIds = s.ids(false);
				const undo = s.invert(mode, records);
				expect(undo.ok).toBe(true);
				if (!undo.ok) throw new Error(undo.code);
				expect(s.source).toBe(sources[timing === "undo" ? change : "plain"][restored]);
				expect(s.ids(true)).toEqual(beforeIds);
				expect(s.ids(false)).toEqual(outsideIds);
				if (timing === "redo") s.outside(sources[change][restored]);
				const redoOutsideIds = s.ids(false);
				const redo = s.invert(mode, undo.records);
				expect(redo.ok).toBe(true);
				if (!redo.ok) throw new Error(redo.code);
				expect(s.source).toBe(sources[change].Three);
				expect(s.ids(true)).toEqual(writtenIds);
				expect(s.ids(false)).toEqual(redoOutsideIds);
			});
		}
	}
	for (const direction of ["undo", "redo"] as const) {
		for (const violation of ["body", "extra-body", "deleted"] as const) {
			it(`D14 ${mode} ${direction} refuses a ${violation} note without mutating source, identity or records`, () => {
				const s = session();
				let records = mode === "single" ? [s.operations[2]] : s.operations;
				if (direction === "redo") {
					const undo = s.invert(mode, records);
					if (!undo.ok) throw new Error(undo.code);
					records = undo.records;
				}
				const addedBody = {
					Text: "# Page\r\n::: note\r\nText\r\n\r\nOutside\r\n:::\r\n\r\nTail",
					Two: "# Page\r\n::: note\r\nTwo\r\n\r\nOutside\r\n:::\r\n\r\nTail",
					Three: "# Page\r\n::: note\r\nThree\r\n\r\nOutside\r\n:::\r\n\r\nTail",
				};
				s.outside(
					violation === "body"
						? "# Page\r\n::: note\r\nOutside\r\n:::\r\n\r\nTail"
						: violation === "extra-body"
							? addedBody[direction === "undo" ? "Three" : mode === "single" ? "Two" : "Text"]
							: "# Page\r\nTail",
				);
				const bytes = s.bytes(records);
				expect(s.invert(mode, records)).toMatchObject({ ok: false, code: "conflict" });
				expect(s.bytes(records)).toBe(bytes);
			});
		}
	}
}
