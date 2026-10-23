import { describe, expectTypeOf, it } from "vitest";
import type {
	IdentityFate,
	InverseGuard,
	OperationIntent,
	OperationRefusal,
	OperationRefusalCode,
	OperationRequest,
	OperationResult,
} from "../src/operations/contract.ts";
import type { SourceEdit } from "../src/source-edit.ts";

const node = {
	kind: "node",
	nodeId: "card",
	path: [0, 1],
	fingerprint: "card-fingerprint",
} as const;
const point = { kind: "insertion", parentId: "page-b", after: null, before: "next" } as const;
const origin = { kind: "insertion", parentId: "page-a", after: null, before: "next-a" } as const;

describe("operation contract types", () => {
	it("represents one move with independent revisions and edits for two files", () => {
		const request = {
			transactionId: "move-1",
			operation: "moveBlocks",
			files: [
				{ path: "a.prax", baseRevision: "a0" },
				{ path: "b.prax", baseRevision: "b0" },
			],
			targets: [
				{ file: "a.prax", ref: node, expectedText: "::: card\nFront\n:::" },
				{ file: "b.prax", ref: point },
			],
			args: {},
		} satisfies OperationRequest;
		const result = {
			ok: true,
			transactionId: request.transactionId,
			files: [
				{
					path: "a.prax",
					fromRevision: "a0",
					toRevision: "a1",
					edits: [{ start: 0, end: 18, text: "" }],
				},
				{
					path: "b.prax",
					fromRevision: "b0",
					toRevision: "b1",
					edits: [{ start: 8, end: 8, text: "::: card\nFront\n:::" }],
				},
			],
			intent: "move",
			mapping: [{ oldId: "card", newId: "card", fate: "kept" }],
			inverse: {
				files: [
					{
						path: "a.prax",
						fromRevision: "a1",
						toRevision: "a0",
						edits: [{ start: 0, end: 0, text: "::: card\nFront\n:::" }],
					},
					{
						path: "b.prax",
						fromRevision: "b1",
						toRevision: "b0",
						edits: [{ start: 8, end: 26, text: "" }],
					},
				],
				mapping: [{ oldId: "card", newId: "card", fate: "kept" }],
				guards: [
					{ kind: "written", file: "b.prax", ref: node, text: "::: card\nFront\n:::" },
					{ kind: "deleted", file: "a.prax", nodeId: "card", ref: origin },
					{
						kind: "insertion-boundary",
						file: "a.prax",
						ref: origin,
						beforeText: "Next",
						afterText: null,
					},
				],
			},
			summary: { key: "op.moved", params: { count: 1, destination: "b.prax" } },
			diagnostics: [],
			focus: { file: "b.prax", nodeId: "card", role: "handle" },
		} satisfies OperationResult;
		expectTypeOf(request).toExtend<OperationRequest>();
		expectTypeOf(result).toExtend<OperationResult>();
		expectTypeOf<OperationResult["files"][number]["edits"][number]>().toEqualTypeOf<SourceEdit>();
	});

	it("identifies a stale second file without supplying any committed edits", () => {
		const refusal = {
			ok: false,
			transactionId: "move-1",
			code: "stale",
			file: "b.prax",
			message: { key: "op.stale", params: { expected: "b0", actual: "b2" } },
		} satisfies OperationRefusal;
		expectTypeOf(refusal).toExtend<OperationRefusal>();
		expectTypeOf<
			Extract<"files" | "edits" | "mapping", keyof OperationRefusal>
		>().toEqualTypeOf<never>();
		expectTypeOf<OperationRefusal["ok"]>().toEqualTypeOf<false>();
	});

	it("guards deletion undo by identity absence and the original insertion boundary", () => {
		const guards = [
			{ kind: "deleted", file: "a.prax", nodeId: "card", ref: origin },
			{
				kind: "insertion-boundary",
				file: "a.prax",
				ref: origin,
				beforeText: "Next",
				afterText: null,
			},
		] satisfies InverseGuard[];
		expectTypeOf(guards).toExtend<OperationResult["inverse"]["guards"]>();
		expectTypeOf<InverseGuard["kind"]>().toEqualTypeOf<
			"written" | "deleted" | "insertion-boundary"
		>();
		// @ts-expect-error A deleted identity needs its restoration boundary.
		const missingBoundary: InverseGuard = { kind: "deleted", file: "a.prax", nodeId: "card" };
		// @ts-expect-error An insertion boundary needs expected neighbour text.
		const missingContext: InverseGuard = { kind: "insertion-boundary", file: "a.prax", ref: point };
		void missingBoundary;
		void missingContext;
	});

	it("carries a conflicting undo refusal with the responsible member and file", () => {
		const refusal = {
			ok: false,
			transactionId: "undo-1",
			code: "conflict",
			member: "card",
			file: "a.prax",
			message: { key: "op.undoConflict", params: { node: "card" } },
		} satisfies OperationRefusal;
		expectTypeOf(refusal).toExtend<OperationRefusal>();
		expectTypeOf<OperationRefusal["code"]>().toEqualTypeOf<
			| "stale"
			| "conflict"
			| "ambiguous"
			| "orphaned"
			| "escapes-range"
			| "not-allowed"
			| "invalid-args"
			| "empty-text"
			| "line-break"
			| "unsupported-syntax"
			| "list-marker"
			| "settings"
			| "source-invalid"
			| "bad-yaml"
			| "identity-retirement-pending"
		>();
		expectTypeOf<OperationRefusalCode>().toEqualTypeOf<OperationRefusal["code"]>();
		// @ts-expect-error Summaries require a message reference rather than rendered English.
		const sentence: OperationResult["summary"] = "Moved one card.";
		// @ts-expect-error Message keys must belong to the operation namespace.
		const sentenceKey: OperationResult["summary"] = { key: "Moved one card.", params: {} };
		void sentence;
		void sentenceKey;
	});

	it("keeps the specified intents, identity fates and course/manifest targets", () => {
		expectTypeOf<OperationIntent>().toEqualTypeOf<
			"modify" | "replace" | "copy" | "move" | "split" | "merge" | "insert" | "delete" | "convert"
		>();
		expectTypeOf<IdentityFate>().toEqualTypeOf<
			"kept" | "new" | "retired" | "pending" | "survivor" | "absorbed" | "copied" | "cut"
		>();
		const targets = [
			{ file: "course.yaml", ref: { kind: "course", courseId: "course" } },
			{ file: "course.yaml", ref: { kind: "manifest", path: ["lessons", 0] } },
		] satisfies OperationRequest["targets"];
		expectTypeOf(targets).toExtend<OperationRequest["targets"]>();
		// @ts-expect-error Every participating file must bind its own base revision.
		const unbound: OperationRequest["files"] = [{ path: "b.prax" }];
		void unbound;
	});
});
