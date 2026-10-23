import {
	canRestoreIdentityMetadata,
	createIdentityPlan,
	type IdentityOperation,
	type IdentityResolution,
	isDurableIdentity,
	type ParsedDocument,
	restoreIdentityMetadata,
	serializeIdentity,
} from "@praxity/content-identity";
import type {
	InverseGuard,
	OperationFileEdits,
	OperationRefusal,
	OperationRequest,
} from "@praxity/grammar/src/operations/contract.ts";
import { applyEdits } from "@praxity/grammar/src/source-edit.ts";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition, learnerInline } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { sourceDiagnostics } from "./diagnostics.ts";
import { bindAllocatedEvidence } from "./evidence.ts";
import type {
	AppliedOperation,
	InverseGroupIdentityBinding,
	InverseGroupPlan,
	InverseGroupRequest,
	OperationContext,
	OperationSourceFile,
} from "./index.ts";
import { inverseEdits, locateTree, translateRange } from "./ranges.ts";

// Review timings: five saves took 25 ms for one lesson; twenty took 1,671 ms for twenty lessons.
// A refusal backstop that bounds synchronous work and record cloning. It is not a grouping rule:
// D16 keeps one source session as one entry, so slice 04 coalesces a session to one record per node.
export const MAX_INVERSE_GROUP_MEMBERS = 5;
const issuedGroupIdentities = new WeakMap<
	InverseGroupPlan,
	{
		binding: string;
		planned: string;
		identity: IdentityResolution;
	}
>();

/** Single-use registry evidence, checked against the store-admitted base and server-owned records. */
export function consumeInverseGroupIdentity(
	plan: InverseGroupPlan,
	binding: InverseGroupIdentityBinding,
): { identity: IdentityResolution } {
	const issued = issuedGroupIdentities.get(plan);
	issuedGroupIdentities.delete(plan);
	if (
		!issued ||
		issued.binding !== serializeIdentity(binding) ||
		issued.planned !== serializeIdentity(plan)
	)
		throw new Error("identity-plan-unissued");
	return { identity: structuredClone(issued.identity) };
}

/** Plan newest-first against private intermediate states; hosts install the whole plan atomically. */
export function planInverseGroup(
	files: readonly OperationSourceFile[],
	request: InverseGroupRequest,
	context: OperationContext,
): InverseGroupPlan | OperationRefusal {
	if (
		!request ||
		typeof request !== "object" ||
		!Array.isArray(request.operations) ||
		request.operations.length === 0 ||
		request.operations.length > MAX_INVERSE_GROUP_MEMBERS
	)
		return {
			ok: false,
			transactionId: request?.transactionId ?? "",
			code: "invalid-args",
			message: { key: "op.invalid-args", params: {} },
		};
	const before = structuredClone([...files]);
	let after = before;
	let current: OperationContext = {
		...context,
		...structuredClone({ identity: context.identity, clipboard: context.clipboard }),
	};
	const members: AppliedOperation[] = [];
	const bindingMembers: InverseGroupIdentityBinding["members"] = [];
	const documents = new Map<string, ParsedDocument>();
	for (const operation of structuredClone(request.operations).reverse()) {
		const result = applyRecordedInverse(
			after,
			{
				transactionId: request.transactionId,
				operation: "applyInverse",
				files: after.map((file) => ({
					path: file.path,
					baseRevision: context.digest(file.source),
				})),
				targets: [],
				args: { operation },
			},
			current,
			documents,
		);
		if (!result.ok) return result;
		members.push(result);
		bindingMembers.push({
			operations: result.evidence,
			restore: {
				identity: operation.history.identity,
				written: operation.identity,
				mapping: operation.inverse.mapping,
			},
		});
		after = result.history.after;
		current = { ...current, identity: result.identity, clipboard: result.clipboard };
	}
	const plan: InverseGroupPlan = {
		ok: true,
		transactionId: request.transactionId,
		before,
		after,
		identity: current.identity,
		clipboard: current.clipboard ?? null,
		members,
	};
	issuedGroupIdentities.set(plan, {
		binding: serializeIdentity({
			identity: context.identity,
			before,
			after,
			members: bindingMembers,
			readerRoles: context.readerRoles === true,
		}),
		planned: serializeIdentity(plan),
		identity: structuredClone(plan.identity),
	});
	return plan;
}

/** Recorded source and ID anchors let unrelated edits move the protected inverse slices. */
export function applyRecordedInverse(
	files: readonly OperationSourceFile[],
	request: OperationRequest,
	context: OperationContext,
	parsedDocuments?: Map<string, ParsedDocument>,
): AppliedOperation | OperationRefusal {
	const refusal = (code: OperationRefusal["code"]): OperationRefusal => ({
		ok: false,
		transactionId: request.transactionId,
		code,
		message: { key: ["op", code].join(".") as `op.${string}`, params: {} },
	});
	const operation = request.args.operation as AppliedOperation | undefined;
	if (
		Object.keys(request.args).length !== 1 ||
		!operation?.ok ||
		!operation.history ||
		!Array.isArray(operation.history.after) ||
		!operation.history.identity?.course ||
		operation.history.identity.course.courseId !== context.identity.course.courseId ||
		!Array.isArray(operation.files) ||
		!Array.isArray(operation.inverse?.files) ||
		!Array.isArray(operation.inverse?.guards) ||
		!Array.isArray(operation.inverse?.mapping) ||
		!operation.inverse ||
		new Set(request.files.map((f) => f.path)).size !== request.files.length ||
		new Set(files.map((f) => f.path)).size !== files.length
	)
		return refusal("invalid-args");
	for (const base of request.files)
		if (digestSource(base.path) !== base.baseRevision) return refusal("stale");
	function digestSource(path: string) {
		const f = files.find((f) => f.path === path);
		return f && context.digest(f.source);
	}
	const identityPlan = createIdentityPlan(
		{
			course: context.identity.course,
			priorHeads: context.identity.heads,
			priorSnapshots: context.identity.snapshots,
			activeHistoryIds: context.activeHistoryIds,
			readerRoles: context.readerRoles,
		},
		context,
	);
	for (const head of context.identity.heads) {
		const expected = identityPlan.sourceHash(head.head);
		if (expected === undefined || expected !== digestSource(head.path)) return refusal("stale");
	}
	if (operation.files.some((f) => !request.files.some((b) => b.path === f.path)))
		return refusal("invalid-args");
	// Clipboard changes are history conflicts just as written source changes are.
	if (serializeIdentity(context.clipboard ?? null) !== serializeIdentity(operation.clipboard))
		return refusal("conflict");
	if (
		!canRestoreIdentityMetadata(
			context.identity,
			operation.history.identity,
			operation.identity,
			operation.inverse.mapping,
		)
	)
		return refusal("conflict");
	const current = context.identity.sourceMappings;
	const recorded = operation.identity.sourceMappings;
	const find = (id: string | null, file: string) =>
		current.find((m) => m.id === id && m.file === file);
	const source = (file: string) => {
		const f = files.find((f) => f.path === file);
		if (!f) throw new Error("inverse-file");
		return f.source;
	};
	// Identity also maps virtual reader parts, such as page titles. Only parsed
	// children participate in structural insertion boundaries.
	const currentDocuments = new Map(
		files.map((file) => {
			const previous = parsedDocuments?.get(file.path);
			return [
				file.path,
				previous?.tree.stream.source === file.source
					? previous
					: {
							path: file.path,
							tree: analyzeLessonTree(tokenizeLesson(file.source), { definition: getDefinition }),
						},
			];
		}),
	);
	const currentSyntax = new Map(
		[...currentDocuments].map(([path, document]) => [path, locateTree(document.tree)]),
	);
	const currentPaths = new Map(
		[...currentSyntax].map(([file, nodes]) => [
			file,
			new Set(nodes.map((node) => node.path.join())),
		]),
	);
	for (const guard of operation.inverse.guards) {
		if (guard.kind === "written") {
			const m = find(guard.ref.nodeId, guard.file);
			if (!m || source(guard.file).slice(m.span.start, m.span.end) !== guard.text)
				return refusal("conflict");
		} else {
			if (guard.kind === "deleted" && current.some((m) => m.id === guard.nodeId))
				return refusal("conflict");
			const parent = guard.ref.parentId ? find(guard.ref.parentId, guard.file) : undefined;
			if (guard.ref.parentId && (!parent || !currentPaths.get(guard.file)?.has(parent.path.join())))
				return refusal("conflict");
			const siblings = current.filter(
				(m) =>
					m.file === guard.file &&
					currentPaths.get(guard.file)?.has(m.path.join()) &&
					m.path.length === (parent?.path.length ?? 0) + 1 &&
					(!parent || parent.path.every((p, i) => p === m.path[i])),
			);
			const after = guard.ref.after ? siblings.findIndex((m) => m.id === guard.ref.after) : -1;
			const before = guard.ref.before
				? siblings.findIndex((m) => m.id === guard.ref.before)
				: siblings.length;
			if (
				(guard.ref.after && after < 0) ||
				(guard.ref.before && before < 0) ||
				before !== after + 1
			)
				return refusal("conflict");
			if (guard.kind === "insertion-boundary")
				for (const [id, text] of [
					[guard.ref.before, guard.beforeText],
					[guard.ref.after, guard.afterText],
				] as const) {
					const m = find(id, guard.file);
					if (id && (!m || source(guard.file).slice(m.span.start, m.span.end) !== text))
						return refusal("conflict");
				}
		}
	}
	const fileEdits: OperationFileEdits[] = [];
	for (const inverse of operation.inverse.files) {
		const base = operation.history.after.find((f) => f.path === inverse.path)?.source;
		if (base === undefined || context.digest(base) !== inverse.fromRevision)
			return refusal("invalid-args");
		const anchors = recorded
			.filter((m) => m.file === inverse.path)
			.flatMap((m) => {
				const now = find(m.id, inverse.path);
				return now
					? [
							{ old: m.span.start, now: now.span.start },
							{ old: m.span.end, now: now.span.end },
						]
					: [];
			})
			.sort((a, b) => a.old - b.old);
		const shift = (offset: number) => {
			const anchor = anchors.filter((a) => a.old <= offset).at(-1);
			return offset + (anchor ? anchor.now - anchor.old : 0);
		};
		const edits = inverse.edits.map((e) => ({ ...e, start: shift(e.start), end: shift(e.end) }));
		for (let i = 0; i < edits.length; i++) {
			const e = edits[i],
				old = inverse.edits[i];
			if (
				e.start < 0 ||
				e.end < e.start ||
				e.end > source(inverse.path).length ||
				(i && e.start < edits[i - 1].end) ||
				source(inverse.path).slice(e.start, e.end) !== base.slice(old.start, old.end)
			)
				return refusal("conflict");
		}
		const after = applyEdits(source(inverse.path), edits);
		fileEdits.push({
			path: inverse.path,
			fromRevision: context.digest(source(inverse.path)),
			toRevision: context.digest(after),
			edits,
		});
	}
	const afterFiles = files.map((f) => ({
		...f,
		source: applyEdits(f.source, fileEdits.find((e) => e.path === f.path)?.edits ?? []),
	}));
	const documents = afterFiles.map((f) => {
		const previous = currentDocuments.get(f.path);
		return previous?.tree.stream.source === f.source
			? previous
			: {
					path: f.path,
					tree: analyzeLessonTree(tokenizeLesson(f.source), { definition: getDefinition }),
				};
	});
	const evidence: IdentityOperation = {
		intent: operation.intent,
		inverse: true,
		files: fileEdits.map((f) => {
			const head = context.identity.heads.find((h) => h.path === f.path);
			if (!head) throw new Error("inverse-head");
			return { ...f, fromSnapshot: head.head };
		}),
		mapping: [],
		placements: [],
	};
	const prepared = identityPlan.prepare(documents);
	const descriptors = prepared.descriptors;
	const bind = (
		map: IdentityOperation["mapping"][number],
		file?: string,
		start?: number,
		type?: string,
	) => {
		const index = evidence.mapping.length;
		evidence.mapping.push(map);
		if (file !== undefined && start !== undefined) {
			const d = descriptors.find(
				(d) => d.file === file && d.span.start === start && d.type === type,
			);
			if (!d || evidence.placements.some((p) => p.file === file && p.path.join() === d.path.join()))
				return false;
			evidence.placements.push({ mappingIndex: index, file, path: d.path });
		}
		return true;
	};
	const claimed = new Set<string>();
	for (const map of operation.inverse.mapping) {
		if (map.oldId) claimed.add(map.oldId);
		if (["retired", "absorbed", "cut"].includes(map.fate)) {
			bind(map);
			continue;
		}
		const original = operation.history.identity.sourceMappings.find((m) => m.id === map.newId);
		const now = current.find((m) => m.id === map.newId);
		const protectedNode = recorded.find((m) => m.id === map.newId);
		const protectedSlice = operation.inverse.guards.some(
			(g) =>
				g.kind === "written" &&
				protectedNode &&
				g.file === protectedNode.file &&
				g.ref.path.every((v, i) => protectedNode.path[i] === v),
		);
		if (map.fate === "kept" && !protectedSlice && !now) continue;
		const records =
			now && !protectedSlice && map.fate === "kept" ? context.identity : operation.history.identity;
		const record = records.snapshots
			.flatMap((s) => Object.entries(s.nodes))
			.find(([id]) => id === map.newId)?.[1];
		// Discarded placements never return; a durable donor can be pending without a placement.
		if (record && map.newId && !isDurableIdentity(map.newId, record, context.activeHistoryIds))
			continue;
		if (!original) {
			if (map.fate === "pending") bind(map);
			continue;
		}
		// Only an outside cross-file move follows the current location. A move by
		// the recorded operation itself must still return to its original file.
		const keepCurrent =
			now &&
			!protectedSlice &&
			map.fate === "kept" &&
			original.file === protectedNode?.file &&
			now.file !== original.file;
		const file = keepCurrent ? now.file : original.file;
		const planned = fileEdits.find((f) => f.path === file);
		let start: number | undefined;
		if (keepCurrent)
			start = translateRange(now.span.start, now.span.end, planned?.edits ?? [])?.start;
		else if (source(file) === operation.history.after.find((f) => f.path === file)?.source)
			start = original.span.start;
		else if (now?.file === file)
			start = translateRange(now.span.start, now.span.end, planned?.edits ?? [])?.start;
		if (start === undefined) {
			const forward = operation.files.find((f) => f.path === file);
			const inv = operation.inverse.files.find((f) => f.path === file);
			const editIndex =
				forward?.edits.findIndex(
					(e) => e.start <= original.span.start && e.end >= original.span.end,
				) ?? -1;
			if (editIndex >= 0 && planned && inv && forward) {
				const edit = planned.edits[editIndex];
				let delta = 0;
				for (let i = 0; i < editIndex; i++)
					delta += planned.edits[i].text.length - (planned.edits[i].end - planned.edits[i].start);
				start = edit.start + delta + original.span.start - forward.edits[editIndex].start;
			} else if (now) {
				const anchor = translateRange(now.span.start, now.span.start, planned?.edits ?? []);
				const descriptor = descriptors.find(
					(d) => d.file === file && d.type === record?.type && d.span.start === anchor?.start,
				);
				start = descriptor?.span.start;
			}
		}
		if (start === undefined && !now) {
			// A compact edit can retire a descendant without covering its whole span.
			// Its exact written ancestor guards the recorded relative position.
			const root = operation.inverse.guards
				.flatMap((g) => {
					if (g.kind !== "written" || g.file !== file) return [];
					const old = operation.history.identity.sourceMappings.find((m) => m.id === g.ref.nodeId);
					const currentRoot = find(g.ref.nodeId, file);
					return old &&
						currentRoot &&
						old.file === file &&
						old.path.length < original.path.length &&
						old.path.every((v, i) => original.path[i] === v)
						? [{ old, current: currentRoot }]
						: [];
				})
				.sort((a, b) => b.old.path.length - a.old.path.length)[0];
			if (root) {
				const anchor = translateRange(
					root.current.span.start,
					root.current.span.start,
					planned?.edits ?? [],
				);
				if (anchor) start = anchor.start + original.span.start - root.old.span.start;
			}
		}
		if (start === undefined || !bind(map, file, start, record?.type)) return refusal("conflict");
	}
	// Preserve current unrelated nodes using exact translated locations, without old fingerprints.
	for (const m of current.filter(
		(m) => !claimed.has(m.id) && !evidence.mapping.some((e) => e.newId === m.id),
	)) {
		const edits = fileEdits.find((f) => f.path === m.file)?.edits;
		if (!edits) continue;
		const range = translateRange(m.span.start, m.span.end, edits);
		const record = context.identity.snapshots
			.flatMap((s) => Object.entries(s.nodes))
			.find(([id]) => id === m.id)?.[1];
		if (
			range &&
			!evidence.placements.some(
				(p) =>
					p.file === m.file &&
					descriptors.find((d) => d.file === p.file && d.path.join() === p.path.join())?.span
						.start === range.start,
			)
		)
			bind({ oldId: m.id, newId: m.id, fate: "kept" }, m.file, range.start, record?.type);
	}
	let identity = prepared.resolve([evidence]);
	identity = restoreIdentityMetadata(
		identity,
		operation.history.identity,
		operation.identity,
		operation.inverse.mapping,
		context,
	);

	const guards: InverseGuard[] = [];
	// Redo retains the forward operation's written scope, even for compact edits.
	for (const guard of operation.inverse.guards) {
		if (guard.kind !== "written") continue;
		const root = identity.sourceMappings.find((m) => m.id === guard.ref.nodeId);
		const text = root && afterFiles.find((f) => f.path === root.file)?.source;
		if (
			root &&
			text !== undefined &&
			!guards.some((g) => g.kind === "written" && g.ref.nodeId === root.id)
		)
			guards.push({
				kind: "written",
				file: root.file,
				ref: { kind: "node", nodeId: root.id, path: root.path, fingerprint: root.fingerprint },
				text: text.slice(root.span.start, root.span.end),
			});
	}
	for (const f of fileEdits) {
		const text = afterFiles.find((a) => a.path === f.path)?.source;
		if (text === undefined) return refusal("invalid-args");
		const doc = documents.find((d) => d.path === f.path);
		if (!doc) return refusal("invalid-args");
		const nodes = identity.sourceMappings.filter((m) => m.file === f.path);
		const syntaxNodes = locateTree(doc.tree);
		const syntaxPaths = new Set(syntaxNodes.map((node) => node.path.join()));
		const reverse = inverseEdits(source(f.path), f.edits);
		for (const [editIndex, edit] of reverse.entries()) {
			const contained = nodes.filter(
				(m) => m.path.length && m.span.start >= edit.start && m.span.end <= edit.end,
			);
			const written = contained.filter(
				(m) =>
					!contained.some(
						(p) => p.path.length < m.path.length && p.path.every((v, i) => v === m.path[i]),
					),
			);
			const insideInline =
				edit.start === edit.end &&
				learnerInline({ path: f.path, tree: doc.tree }).some(
					(n) => n.start < edit.start && n.end > edit.end,
				);
			if (!written.length && (edit.end > edit.start || insideInline)) {
				const owner = nodes
					.filter(
						(m) =>
							m.path.length &&
							(edit.end > edit.start
								? m.span.start <= edit.start && m.span.end >= edit.end
								: m.span.start < edit.start && m.span.end > edit.end),
					)
					.sort((a, b) => b.path.length - a.path.length)[0];
				if (owner) written.push(owner);
			}
			for (const m of written)
				if (
					!guards.some(
						(g) =>
							g.kind === "written" &&
							g.file === f.path &&
							g.ref.path.every((v, i) => m.path[i] === v),
					)
				)
					guards.push({
						kind: "written",
						file: f.path,
						ref: { kind: "node", nodeId: m.id, path: m.path, fingerprint: m.fingerprint },
						text: text.slice(m.span.start, m.span.end),
					});
			// An empty inline value belongs to its written node, not to a sibling insertion boundary.
			if (edit.start === edit.end && !written.length) {
				// Reinserting a deleted node uses its surviving structural parent.
				// At a page's end, containment alone would guard the last block
				// instead of the neighbouring page.
				const removed = currentSyntax
					.get(f.path)
					?.find(
						(node) =>
							node.parent &&
							node.node.span.start >= f.edits[editIndex].start &&
							node.node.span.end <= f.edits[editIndex].end,
					);
				const oldParent =
					removed?.parent &&
					current.find(
						(node) => node.file === f.path && node.path.join() === removed.parent?.path.join(),
					);
				const restoredParent = oldParent && nodes.find((node) => node.id === oldParent.id);
				const owner =
					(restoredParent &&
						syntaxNodes.find((node) => node.path.join() === restoredParent.path.join())) ||
					syntaxNodes
						.filter(
							(n) =>
								["lesson", "page", "item", "block", "back"].includes(n.node.kind) &&
								(n.node.header?.end ?? n.node.span.start) <= edit.start &&
								(n.node.closer?.start ?? n.node.span.end) >= edit.end,
						)
						.sort((a, b) => b.path.length - a.path.length)[0];
				const parent = owner && nodes.find((m) => m.path.join() === owner.path.join());
				const siblings = nodes.filter(
					(m) =>
						syntaxPaths.has(m.path.join()) &&
						m.path.length === (parent?.path.length ?? 0) + 1 &&
						(!parent || parent.path.every((p, i) => m.path[i] === p)),
				);
				const after = siblings.filter((m) => m.span.end <= edit.start).at(-1);
				const before = siblings.find((m) => m.span.start >= edit.end);
				const ref = {
					kind: "insertion" as const,
					parentId: parent?.id ?? null,
					after: after?.id ?? null,
					before: before?.id ?? null,
				};
				guards.push({
					kind: "insertion-boundary",
					file: f.path,
					ref,
					afterText: after ? text.slice(after.span.start, after.span.end) : null,
					beforeText: before ? text.slice(before.span.start, before.span.end) : null,
				});
				for (const m of current.filter(
					(m) => m.file === f.path && !identity.sourceMappings.some((n) => n.id === m.id),
				))
					guards.push({ kind: "deleted", file: f.path, ref, nodeId: m.id });
			}
		}
	}

	const clipboard = operation.history.clipboard;
	for (const document of documents) parsedDocuments?.set(document.path, document);
	return {
		...operation,
		transactionId: request.transactionId,
		files: fileEdits,
		identity,
		evidence: bindAllocatedEvidence([evidence], identity),
		mapping: identity.mapping,
		clipboard,
		diagnostics: sourceDiagnostics(documents, identity, descriptors),
		history: {
			focus: operation.focus,
			before: files.map((f) => ({ ...f })),
			after: afterFiles,
			identity: context.identity,
			clipboard: context.clipboard ?? null,
		},
		inverse: {
			files: fileEdits.map((f) => ({
				path: f.path,
				fromRevision: f.toRevision,
				toRevision: f.fromRevision,
				edits: inverseEdits(source(f.path), f.edits),
			})),
			mapping: identity.inverseMapping,
			guards,
		},
		summary: { key: "op.applyInverse", params: {} },
		focus: operation.history.focus,
	};
}
