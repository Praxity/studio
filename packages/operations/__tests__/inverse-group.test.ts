import { createHash } from "node:crypto";
import { resolveIdentity, serializeIdentity } from "@praxity/content-identity";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import {
	type AppliedOperation,
	applyOperation,
	consumeInverseGroupIdentity,
	type InverseGroupIdentityBinding,
	type InverseGroupRequest,
	planInverseGroup,
} from "../src/index.ts";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const original =
	"# Page\r\n::: note\r\nText\r\n:::\r\n\r\n::: note\r\nOther\r\n:::\r\n\r\nCafé 😀\u202f?";

function session(source = original) {
	let next = 1;
	const dependencies = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`,
	};
	let files = [{ path: "lesson.prax", source }];
	const documents = () =>
		files.map((file) => ({ path: file.path, tree: readLesson(file.source).tree }));
	let identity = resolveIdentity(
		{ parsedDocuments: documents(), priorSnapshots: [], readerRoles: true },
		dependencies,
	);
	const initialIds = identity.sourceMappings.map((node) => node.id);
	const operations: AppliedOperation[] = [];
	function save(text: string, ordinal = 0) {
		const node = identity.sourceMappings.filter((node) => node.path.join() === `0,${ordinal}`)[0];
		if (!node) throw new Error("Missing target");
		const result = applyOperation(
			files,
			{
				transactionId: `save-${operations.length}`,
				operation: "editSource",
				files: files.map((file) => ({ path: file.path, baseRevision: digest(file.source) })),
				targets: [
					{
						file: node.file,
						ref: { kind: "node", nodeId: node.id, path: node.path, fingerprint: node.fingerprint },
						expectedText: files[0].source.slice(node.span.start, node.span.end),
					},
				],
				args: { text },
			},
			{ identity, readerRoles: true, ...dependencies },
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
	return {
		initialIds,
		operations,
		save,
		outside,
		get files() {
			return files;
		},
		get context() {
			return { identity, readerRoles: true, ...dependencies };
		},
	};
}

it("D14 D16 plans Text → One → Two → Three as one undo and redo with every original ID", () => {
	const original = "# Page\r\nText\r\n\r\nCafé 😀\u202f?";
	const s = session(original);
	s.save("One\n");
	s.save("Two\n");
	s.save("Three\n");
	const undo = planInverseGroup(
		s.files,
		{ transactionId: "undo", operations: s.operations },
		s.context,
	);
	if (!undo.ok) throw new Error(undo.code);
	expect(undo.after).toEqual([
		{ path: "lesson.prax", source: "# Page\r\nText\r\n\r\nCafé 😀\u202f?" },
	]);
	expect(undo.identity.sourceMappings.map((node) => node.id)).toEqual(s.initialIds);
	const redo = planInverseGroup(
		undo.after,
		{ transactionId: "redo", operations: undo.members },
		{ ...s.context, identity: undo.identity, clipboard: undo.clipboard },
	);
	if (!redo.ok) throw new Error(redo.code);
	expect(redo.after).toEqual([
		{ path: "lesson.prax", source: "# Page\r\nThree\r\n\r\nCafé 😀\u202f?" },
	]);
	expect(redo.identity.sourceMappings.map((node) => node.id)).toEqual(s.initialIds);
});

it("D14 D16 note saves restore original undo IDs and written redo descendants", () => {
	const s = session();
	s.save("::: note\nOne\n");
	s.save("::: note\nTwo\n");
	s.save("::: note\nThree\n");
	const writtenIds = s.context.identity.sourceMappings.map((node) => node.id);
	const bytes = serializeIdentity({
		files: s.files,
		identity: s.context.identity,
		operations: s.operations,
	});
	const undo = planInverseGroup(
		s.files,
		{ transactionId: "undo", operations: s.operations },
		s.context,
	);
	expect(undo.ok).toBe(true);
	if (!undo.ok) throw new Error(undo.code);
	expect(undo.after).toEqual([{ path: "lesson.prax", source: original }]);
	expect(undo.identity.sourceMappings.map((node) => node.id)).toEqual(s.initialIds);
	expect(
		serializeIdentity({ files: s.files, identity: s.context.identity, operations: s.operations }),
	).toBe(bytes);
	const redo = planInverseGroup(
		undo.after,
		{ transactionId: "redo", operations: undo.members },
		{ ...s.context, identity: undo.identity, clipboard: undo.clipboard },
	);
	expect(redo.ok).toBe(true);
	if (!redo.ok) throw new Error(redo.code);
	expect(redo.after).toEqual([
		{
			path: "lesson.prax",
			source:
				"# Page\r\n::: note\r\nThree\r\n:::\r\n\r\n::: note\r\nOther\r\n:::\r\n\r\nCafé 😀\u202f?",
		},
	]);
	expect(redo.identity.sourceMappings.map((node) => node.id)).toEqual(writtenIds);
	expect(redo.identity.sourceMappings.find((node) => node.path.join() === "0,0")?.id).toBe(
		s.initialIds[2],
	);
});

it.each(["first", "last"])(
	"D14 refuses the whole group when its %s guarded member changed, without source or identity mutation",
	(member) => {
		const s = session();
		s.save("::: note\nOne\n");
		s.save("::: note\nTwo\n", 1);
		s.save("::: note\nThree\n", 1);
		s.outside(
			member === "first"
				? "# Page\r\n::: note\r\nOutside\r\n:::\r\n\r\n::: note\r\nThree\r\n:::\r\n\r\nCafé 😀\u202f?"
				: "# Page\r\n::: note\r\nOne\r\n:::\r\n\r\n::: note\r\nOutside\r\n:::\r\n\r\nCafé 😀\u202f?",
		);
		const before = serializeIdentity({
			files: s.files,
			identity: s.context.identity,
			operations: s.operations,
		});
		expect(
			planInverseGroup(s.files, { transactionId: "blocked", operations: s.operations }, s.context),
		).toEqual({
			ok: false,
			transactionId: "blocked",
			code: "conflict",
			message: { key: "op.conflict", params: {} },
		});
		expect(
			serializeIdentity({ files: s.files, identity: s.context.identity, operations: s.operations }),
		).toBe(before);
	},
);

it("D14 refuses redo after an outside change without mutating its inputs", () => {
	const s = session();
	s.save("::: note\nOne\n");
	s.save("::: note\nTwo\n");
	s.save("::: note\nThree\n");
	const undo = planInverseGroup(
		s.files,
		{ transactionId: "undo", operations: s.operations },
		s.context,
	);
	if (!undo.ok) throw new Error(undo.code);
	const files = [
		{
			path: "lesson.prax",
			source:
				"# Page\r\n::: note\r\nOutside\r\n:::\r\n\r\n::: note\r\nOther\r\n:::\r\n\r\nCaf? ??\u202f?",
		},
	];
	const identity = resolveIdentity(
		{
			course: undo.identity.course,
			priorHeads: undo.identity.heads,
			priorSnapshots: undo.identity.snapshots,
			parsedDocuments: files.map((file) => ({
				path: file.path,
				tree: readLesson(file.source).tree,
			})),
			readerRoles: true,
		},
		s.context,
	);
	const before = serializeIdentity({ files, identity, operations: undo.members });
	expect(
		planInverseGroup(
			files,
			{ transactionId: "redo", operations: undo.members },
			{ ...s.context, identity, clipboard: undo.clipboard },
		),
	).toMatchObject({ ok: false, code: "conflict" });
	expect(serializeIdentity({ files, identity, operations: undo.members })).toBe(before);
});

it("D14 D16 restores split descendants through the whole group", () => {
	const s = session();
	s.save("::: note\nText\n\nAdded\n");
	s.save("::: note\nText\n\nAdded again\n");
	const writtenIds = s.context.identity.sourceMappings.map((node) => node.id);
	const undo = planInverseGroup(
		s.files,
		{ transactionId: "undo", operations: s.operations },
		s.context,
	);
	if (!undo.ok) throw new Error(undo.code);
	expect(undo.after).toEqual([{ path: "lesson.prax", source: original }]);
	expect(undo.identity.sourceMappings.map((node) => node.id)).toEqual(s.initialIds);
	const redo = planInverseGroup(
		undo.after,
		{ transactionId: "redo", operations: undo.members },
		{ ...s.context, identity: undo.identity, clipboard: undo.clipboard },
	);
	if (!redo.ok) throw new Error(redo.code);
	expect(redo.after).toEqual([
		{
			path: "lesson.prax",
			source:
				"# Page\r\n::: note\r\nText\r\n\r\nAdded again\r\n:::\r\n\r\n::: note\r\nOther\r\n:::\r\n\r\nCafé 😀\u202f?",
		},
	]);
	expect(redo.identity.sourceMappings.map((node) => node.id)).toEqual(writtenIds);
});

it("refuses an empty group and a malformed late member without exposing a partial plan", () => {
	const s = session();
	s.save("::: note\nOne\n");
	s.save("::: note\nTwo\n");
	const before = serializeIdentity({
		files: s.files,
		identity: s.context.identity,
		operations: s.operations,
	});
	for (const operations of [[], [null, s.operations[1]]]) {
		expect(
			planInverseGroup(
				s.files,
				{ transactionId: "bad", operations: operations as AppliedOperation[] },
				s.context,
			),
		).toEqual({
			ok: false,
			transactionId: "bad",
			code: "invalid-args",
			message: { key: "op.invalid-args", params: {} },
		});
	}
	expect(
		serializeIdentity({ files: s.files, identity: s.context.identity, operations: s.operations }),
	).toBe(before);
});

it("issues a single-use group identity capability bound to the admitted base and every member", () => {
	const s = session("# Page\r\nText\r\n\r\nOther");
	for (const text of ["One", "Two", "Three"]) s.save(text);
	const plan = () => {
		const result = planInverseGroup(
			s.files,
			{ transactionId: "undo", operations: s.operations },
			s.context,
		);
		if (!result.ok) throw new Error(result.code);
		return result;
	};
	const binding = (result: ReturnType<typeof plan>): InverseGroupIdentityBinding => ({
		identity: s.context.identity,
		before: s.files,
		after: result.after,
		members: [...s.operations].reverse().map((operation, index) => ({
			operations: result.members[index].evidence,
			restore: {
				identity: operation.history.identity,
				written: operation.identity,
				mapping: operation.inverse.mapping,
			},
		})),
		readerRoles: true,
	});
	const issued = plan();
	const admitted = binding(issued);
	expect(() => consumeInverseGroupIdentity(structuredClone(issued), admitted)).toThrow(
		"identity-plan-unissued",
	);
	const consumed = consumeInverseGroupIdentity(issued, admitted);
	expect(consumed.identity.sourceMappings.map((node) => node.id)).toEqual(s.initialIds);
	expect(consumed.identity).toEqual(issued.identity);
	expect(consumed.identity).not.toBe(issued.identity);
	expect(() => consumeInverseGroupIdentity(issued, admitted)).toThrow("identity-plan-unissued");
	const mutations = [
		(result: ReturnType<typeof plan>) => {
			result.identity.course.courseId = "different";
		},
		(result: ReturnType<typeof plan>) => {
			result.before[0].source = "Changed";
		},
		(result: ReturnType<typeof plan>) => {
			result.after[0].source = "Changed";
		},
		(result: ReturnType<typeof plan>) => {
			result.members[0].evidence = [];
		},
		(result: ReturnType<typeof plan>) => {
			result.members[1].history.identity.course.courseId = "different";
		},
		(result: ReturnType<typeof plan>) => {
			result.members[2].inverse.mapping = [];
		},
	];
	for (const mutate of mutations) {
		const result = plan();
		const base = structuredClone(binding(result));
		mutate(result);
		expect(() => consumeInverseGroupIdentity(result, base)).toThrow("identity-plan-unissued");
	}
	for (const mutate of [
		(base: InverseGroupIdentityBinding) => {
			base.identity.course.courseId = "different";
		},
		(base: InverseGroupIdentityBinding) => {
			base.before = [{ path: "lesson.prax", source: "Different" }];
		},
		(base: InverseGroupIdentityBinding) => {
			base.readerRoles = false;
		},
		(base: InverseGroupIdentityBinding) => {
			base.members[0].restore.mapping = [];
		},
		(base: InverseGroupIdentityBinding) => {
			base.members[1].restore.written.course.courseId = "different";
		},
		(base: InverseGroupIdentityBinding) => {
			base.members[2].restore.identity.course.courseId = "different";
		},
	]) {
		const result = plan();
		const base = structuredClone(binding(result));
		mutate(base);
		expect(() => consumeInverseGroupIdentity(result, base)).toThrow("identity-plan-unissued");
		expect(() => consumeInverseGroupIdentity(result, binding(result))).toThrow(
			"identity-plan-unissued",
		);
	}
});

it("caps groups at five members and refuses six before cloning with inputs unchanged", () => {
	const s = session("# Page\r\nText\r\n\r\nOther");
	for (const text of ["One", "Two", "Three", "Four", "Five"]) s.save(text);
	const accepted = planInverseGroup(
		s.files,
		{ transactionId: "five", operations: s.operations },
		s.context,
	);
	expect(accepted.ok).toBe(true);
	if (!accepted.ok) throw new Error(accepted.code);
	expect(accepted.after[0].source).toBe("# Page\r\nText\r\n\r\nOther");
	s.save("Six");
	const request = { transactionId: "six", operations: s.operations };
	const before = serializeIdentity({ files: s.files, context: s.context, request });
	const refused = {
		ok: false,
		transactionId: "six",
		code: "invalid-args",
		message: { key: "op.invalid-args", params: {} },
	};
	expect(planInverseGroup(s.files, request, s.context)).toEqual(refused);
	expect(serializeIdentity({ files: s.files, context: s.context, request })).toBe(before);
	// An oversized group must refuse before trying to clone its records.
	Object.assign(s.operations[5], { nonCloneable: () => {} });
	expect(planInverseGroup(s.files, request, s.context)).toEqual(refused);
});

it.each([null, undefined, "request", 1, true])(
	"refuses a non-object group request %s with invalid-args",
	(request) => {
		const s = session();
		expect(planInverseGroup(s.files, request as unknown as InverseGroupRequest, s.context)).toEqual(
			{
				ok: false,
				transactionId: "",
				code: "invalid-args",
				message: { key: "op.invalid-args", params: {} },
			},
		);
	},
);
