import type { IdentityReadView } from "@praxity/content-identity";
import type {
	OperationRequest,
	OperationResult,
} from "@praxity/grammar/src/operations/contract.ts";
import { announcement, operationAnnouncement } from "./announcements";
import {
	ancestors,
	collapseSelection,
	emptySelection,
	remapSelection,
	selectionCount,
	selectionKey,
	selectionNodes,
	selectionOperationName,
	selectionOperations,
	selectionReason,
	selectionSnapshot,
	selectionTargets,
	selectionView,
	selectNode,
	singleNodeOperations,
} from "./selection";
import type {
	Command,
	Dependencies,
	Draft,
	DraftSeed,
	Effect,
	Exit,
	Focus,
	FocusOwner,
	FocusRule,
	HistoryEntry,
	Message,
	Resolution,
	SelectionDestination,
	SelectionSnapshot,
	Session,
} from "./types";

export function createSession(
	options: Partial<
		Pick<Session, "interfaceLanguage" | "courseLanguage" | "platform" | "revisions">
	> = {},
): Session {
	return {
		lens: "page",
		layers: [{ kind: "page" }],
		focus: null,
		selected: [],
		selection: emptySelection(),
		drafts: {},
		draftDisplayIds: {},
		draftAbsences: {},
		draftAcknowledgements: {},
		pendingDraftPersistence: {},
		activeDraft: null,
		history: [],
		cursor: 0,
		epoch: 0,
		sequence: 0,
		draftNamespace: globalThis.crypto.randomUUID(),
		pending: null,
		revisions: {},
		revisionSeqs: {},
		interfaceLanguage: "en",
		courseLanguage: "en",
		platform: "windows",
		lastKeyAt: null,
		background: [],
		...options,
	};
}
const lf = (text: string) => text.replace(/\r\n?/gu, "\n");
const active = (state: Session) =>
	state.activeDraft ? state.drafts[state.activeDraft] : undefined;
const id = (state: Session, prefix: string) => {
	let value: string;
	do {
		value = `${prefix}-${state.draftNamespace}-${++state.sequence}`;
	} while (state.drafts[value] || state.history.some((entry) => entry.id === value));
	return value;
};
export const sameDraftTarget = (a: DraftSeed, b: DraftSeed): boolean => {
	const left = a.target,
		right = b.target;
	return (
		a.file === b.file &&
		(a.scope ?? "node") === (b.scope ?? "node") &&
		(left.kind === "node" && right.kind === "node"
			? left.nodeId !== null || right.nodeId !== null
				? left.nodeId === right.nodeId
				: left.fingerprint === right.fingerprint &&
					JSON.stringify(left.path) === JSON.stringify(right.path)
			: left.kind === "insertion" &&
				right.kind === "insertion" &&
				left.parentId === right.parentId &&
				left.after === right.after &&
				left.before === right.before &&
				(["parentRef", "afterRef", "beforeRef"] as const).every((key) => {
					const first = left[key],
						second = right[key];
					return first && second
						? sameDraftTarget({ ...a, target: first }, { ...b, target: second })
						: first === second;
				}))
	);
};

/** Acknowledgements are client bookkeeping, not a change to the stored draft payload. */
export function draftPersistencePayload(draft: Draft) {
	const {
		persistenceVersion: _version,
		persistedVersion: _ack,
		persistedGeneration: _generation,
		validatedGeneration: _validated,
		resolutionEpoch: _epoch,
		...payload
	} = draft;
	return payload;
}
const courseParams = [
	"name",
	"type",
	"parent",
	"oldParent",
	"prevName",
	"nextName",
	"otherName",
	"leftName",
	"pages",
	"name1",
	"name2",
	"destination",
	"runName",
	"ancestorName",
	"draftName",
];

/** Consumption projected to the frame; only this owner knows the active layer. */
export function canEscape(state: Session): boolean {
	return !state.pending && state.layers.at(-1)?.kind !== "page";
}

const DRAFT_VALIDATION_IDLE_MS = 150;
export function nextDraftValidationAt(state: Session): number {
	const draft = active(state);
	return draft && draft.validatedGeneration !== draft.generation
		? draft.changedAt + DRAFT_VALIDATION_IDLE_MS
		: Infinity;
}

/** A6: the shell clock wakes only when background speech can leave the typing queue. */
export function nextBackgroundAnnouncementAt(state: Session): number {
	const due = Math.min(...state.background.map((entry) => entry.due));
	return active(state) && state.lastKeyAt !== null ? Math.max(due, state.lastKeyAt + 2000) : due;
}

/** Effects are instructions to adapters. Dispatch never writes, fetches or touches a frame. */
export function dispatch(
	previous: Session,
	command: Command,
	deps: Dependencies,
): { state: Session; effects: Effect[]; consumed: boolean } {
	const state = structuredClone(previous);
	const effects: Effect[] = [];
	const replyOwner =
		command.type === "operationReply" || command.type === "historyReply"
			? state.pending?.expect
			: undefined;
	const beforeReply = replyOwner ? selectionSnapshot(state) : undefined;
	const owner = (target: Focus | null): FocusOwner[] =>
		target ? [{ file: target.file, nodeId: target.nodeId, role: target.role }] : [];
	const draftFocus = (draft: Draft): Focus => ({
		file: draft.file,
		nodeId:
			draft.target.kind === "node"
				? (draft.target.nodeId ?? state.draftDisplayIds[draft.id] ?? null)
				: null,
		role: "source",
		selection: draft.selection,
	});
	// History targets Page handles that survive source-field closure.
	const sourceHistorySnapshot = () => {
		const draft = active(state);
		if (state.lens !== "page" || !draft) return;
		const source = draftFocus(draft);
		if (
			source.nodeId === null ||
			state.selected.length !== 1 ||
			state.selected[0] !== source.nodeId
		)
			return;
		return {
			...selectionSnapshot(state),
			focus: { file: source.file, nodeId: source.nodeId, role: "handle" as const },
		};
	};
	const applyCorrespondence = (pairs: IdentityReadView["correspondence"] = []) => {
		const ids = new Map(pairs?.map(({ runtimeId, durableId }) => [runtimeId, durableId]));
		const remap = (id: string | null) => (id === null ? null : (ids.get(id) ?? id));
		const snapshot = (value: SelectionSnapshot) => {
			value.selected = value.selected.map((id) => remap(id) as string);
			value.selection.anchor = remap(value.selection.anchor);
			value.selection.focus = remap(value.selection.focus);
			if (value.focus) value.focus.nodeId = remap(value.focus.nodeId);
		};
		if (beforeReply) snapshot(beforeReply);
		snapshot(state);
		for (const draft of Object.values(state.drafts)) {
			const shown = state.draftDisplayIds[draft.id];
			const durable = ids.get(shown);
			if (durable && draft.target.kind === "node") draft.target.nodeId = durable;
			if (shown) state.draftDisplayIds[draft.id] = remap(shown) as string;
		}
		for (const layer of state.layers) {
			if (layer.kind === "margin") layer.handle.nodeId = remap(layer.handle.nodeId);
			if (layer.kind === "popup" || layer.kind === "dialog")
				layer.opener.nodeId = remap(layer.opener.nodeId);
		}
		const pending = state.pending;
		if (pending?.selectionBefore) snapshot(pending.selectionBefore);
		if (pending?.kind === "operation") {
			const rule = pending.focus;
			if (rule.kind === "helper") rule.opener.nodeId = remap(rule.opener.nodeId);
			if (rule.kind === "merge") rule.earlier.nodeId = remap(rule.earlier.nodeId);
			if (rule.kind === "add-item") rule.item.nodeId = remap(rule.item.nodeId);
			if (rule.kind === "review") rule.next.nodeId = remap(rule.next.nodeId);
			if (rule.kind === "delete")
				for (const focus of rule.candidates) focus.nodeId = remap(focus.nodeId);
		}
		if (
			pending?.kind === "commit" &&
			(pending.exit.kind === "select" || pending.exit.kind === "selection")
		)
			pending.exit.focus.nodeId = remap(pending.exit.focus.nodeId);
	};
	const deleteFocus = (target: Focus): Focus => {
		const neighbours = deps.focusNeighbours(target);
		return {
			...(neighbours.next ?? neighbours.previous ?? neighbours.parent ?? neighbours.page),
			role: "handle",
			selection: undefined,
		};
	};
	const focus = (target: Focus, reason?: "settlement") => {
		state.focus = target;
		delete state.replyFocus;
		effects.push({
			type: "focus",
			target,
			...(reason ? { reason } : {}),
			...(replyOwner ? { expect: structuredClone(replyOwner), requestId: id(state, "focus") } : {}),
		});
	};
	const say = (
		message: Message,
		level: "polite" | "assertive" = "polite",
		delayMs = 150,
		quoted = courseParams,
	) => {
		effects.push({
			type: "announce",
			message,
			level,
			delayMs,
			interfaceLanguage: state.interfaceLanguage,
			courseLanguage: state.courseLanguage,
			courseParams: quoted.filter(
				(key) => Boolean(message.params[key]) && message.params[key] !== "undefined",
			),
		});
	};
	const versionDraft = (draft: Draft) => {
		const before = previous.drafts[draft.id];
		if (
			before &&
			JSON.stringify(draftPersistencePayload(before)) !==
				JSON.stringify(draftPersistencePayload(draft))
		)
			draft.persistenceVersion = (before.persistenceVersion ?? 0) + 1;
	};
	const persist = (draft: Draft) => {
		versionDraft(draft);
		const version = draft.persistenceVersion ?? 0;
		const pending = state.pendingDraftPersistence[draft.id];
		if (pending?.requestId && pending.version === version) return;
		const expectedVersion = pending
			? pending.version === version
				? pending.expectedVersion
				: pending.version
			: (draft.persistedVersion ?? -1);
		const requestId = `${state.draftNamespace}-${id(state, "persist")}`;
		state.pendingDraftPersistence[draft.id] = {
			requestId,
			generation: draft.generation,
			version,
			expectedVersion,
		};
		effects.push({
			type: "persistDraft",
			action: "put",
			requestId,
			draft: structuredClone(draft),
			expectedVersion,
		});
	};
	const canPersist = (draft: Draft) => {
		versionDraft(draft);
		const pending = state.pendingDraftPersistence[draft.id];
		return (
			(draft.status !== "clean" || pending?.requestId === null) &&
			!(pending?.requestId && pending.version === (draft.persistenceVersion ?? 0))
		);
	};
	const remove = (draft: Draft) => {
		delete state.drafts[draft.id];
		delete state.draftDisplayIds[draft.id];
		delete state.draftAbsences[draft.id];
		if (state.restoredDraftVersions) delete state.restoredDraftVersions[draft.id];
		delete state.draftAcknowledgements[draft.id];
		delete state.pendingDraftPersistence[draft.id];
		effects.push({ type: "persistDraft", action: "remove", id: draft.id, file: draft.file });
	};
	const selected = (target: Focus) => {
		collapseSelection(state, target);
		state.layers = [{ kind: "page" }, { kind: "selected" }];
	};
	const makeDraft = (seed: DraftSeed): Draft => ({
		...structuredClone(seed),
		id: id(state, "draft"),
		baseText: lf(seed.editableText),
		text: lf(seed.editableText),
		selection: [0, 0],
		generation: 0,
		status: "clean",
		diagnostics: [],
		changedAt: deps.now,
		validatedGeneration: 0,
		persistedGeneration: -1,
		persistenceVersion: 0,
		persistedVersion: -1,
	});
	const open = (seed: DraftSeed, selection?: readonly [number, number], displayId?: string) => {
		if (state.selected.length > 1) say(announcement("selectionCleared"));
		const draft =
			Object.values(state.drafts).find((draft) => sameDraftTarget(draft, seed)) ?? makeDraft(seed);
		if (selection) draft.selection = [...selection];
		state.drafts[draft.id] = draft;
		if (displayId) state.draftDisplayIds[draft.id] = displayId;
		state.activeDraft = draft.id;
		state.revisions[seed.file] ??= seed.baseRevision;
		if (state.lens === "page") {
			selected(draftFocus(draft));
			state.layers.push({ kind: "source", draftId: draft.id });
		} else state.layers = [{ kind: "page" }];
		focus(draftFocus(draft));
	};
	const finish = (
		exit: Exit,
		target: Focus,
		draft?: Draft,
		source = draft ? draftFocus(draft) : null,
	) => {
		if (exit.kind === "stay") {
			if (draft) {
				const target = draftFocus(draft);
				// A refused departure or newer typing can retain the field after focus selected elsewhere.
				if (state.lens === "page" && !state.layers.some((layer) => layer.kind === "source")) {
					selected(target);
					state.layers.push({ kind: "source", draftId: draft.id });
				}
				const settlement = command.type === "operationReply";
				if (
					!settlement ||
					(state.focus?.file === source?.file &&
						state.focus?.nodeId === source?.nodeId &&
						state.focus?.role === "source")
				)
					focus(target, settlement ? "settlement" : undefined);
			}
			return;
		}
		state.activeDraft = null;
		if (draft && draft.status === "clean") remove(draft);
		if (exit.kind !== "selection") selected(target);
		if (exit.kind === "open") open(exit.seed, undefined, exit.displayId);
		else if (exit.kind === "selection") {
			state.layers = [{ kind: "page" }, { kind: "selected" }];
			state.selection.anchor = source?.nodeId ?? target.nodeId;
			const message = selectNode(state, exit.focus, exit.mode, deps);
			focus(exit.focus);
			if (message) say(message);
		} else if (exit.kind === "select") {
			selected(exit.focus);
			focus(exit.focus);
		} else if (exit.kind === "lens") {
			state.lens = exit.lens;
			state.layers = [{ kind: "page" }];
			if (exit.lens === "source" && exit.seed) open({ ...exit.seed, scope: "file" });
		} else focus({ ...target, role: "handle", selection: undefined });
	};
	const draftRequest = (draft: Draft): OperationRequest => ({
		transactionId: id(state, "transaction"),
		operation: draft.target.kind === "insertion" ? "insertBlock" : "editSource",
		files: [{ path: draft.file, baseRevision: draft.baseRevision }],
		targets: [
			{ file: draft.file, ref: structuredClone(draft.target), expectedText: draft.expectedText },
		],
		args: { text: draft.text, ...(draft.scope === "file" ? { scope: "file" } : {}) },
	});
	const commit = (exit: Exit) => {
		const draft = active(state);
		if (!draft || state.pending) return;
		const target = state.draftAbsences[draft.id]?.focus ?? draftFocus(draft);
		if (draft.target.kind === "insertion" && !draft.text.trim()) {
			remove(draft);
			finish(exit, deleteFocus(target));
			return;
		}
		if (draft.text === draft.baseText && draft.status === "clean") {
			finish(exit, target, draft);
			return;
		}
		if (state.draftAcknowledgements[draft.id]) {
			say(
				announcement("notSaved", {
					message: deps.translate({ key: "session.reasons.sourceAdmission", params: {} }),
				}),
				"assertive",
			);
			return;
		}
		if (draft.status === "conflict" || draft.status === "orphaned") {
			say(
				announcement("notSaved", {
					message: deps.translate({ key: `session.reasons.${draft.status}`, params: {} }),
				}),
				"assertive",
			);
			persist(draft);
			finish(exit.kind === "selection" ? { kind: "stay" } : exit, target, draft);
			return;
		}
		const request = draftRequest(draft);
		const source = draftFocus(draft);
		const nativeSelection =
			state.lens === "page" &&
			exit.kind === "select" &&
			exit.focus.role === "handle" &&
			state.focus?.role === "handle" &&
			state.focus.file === exit.focus.file &&
			state.focus.nodeId === exit.focus.nodeId
				? state.focus
				: null;
		const selectionBefore = sourceHistorySnapshot();
		state.pending = {
			kind: "commit",
			request,
			draft: structuredClone(draft),
			exit,
			expect: owner(nativeSelection ?? source),
			...(selectionBefore ? { selectionBefore } : {}),
		};
		// Native Tab has already selected its destination before the commit request.
		if (nativeSelection) selected(nativeSelection);
		effects.push({ type: "post", method: "operationApply", request });
	};
	const pushHistory = (entry: HistoryEntry) => {
		state.history = state.history.slice(0, state.cursor);
		state.history.push(entry);
		state.cursor = state.history.length;
	};
	const discard = (draft: Draft) => {
		pushHistory({
			id: id(state, "history"),
			kind: "discard",
			summary: { key: "session.history.discarded", params: {} },
			operations: [],
			historyIds: [],
			draft: structuredClone(draft),
			epoch: state.epoch,
			focus: { ...draftFocus(draft), role: "handle" },
		});
		remove(draft);
		if (state.activeDraft === draft.id) {
			state.activeDraft = null;
			selected(draftFocus(draft));
			focus({ ...draftFocus(draft), role: "handle", selection: undefined });
		}
	};
	const resolve = (draft: Draft, resolution: Resolution) => {
		if (resolution.kind === "unchanged") {
			if (state.draftAbsences[draft.id]) {
				draft.baseText = lf(resolution.seed.editableText);
				delete state.draftAbsences[draft.id];
			}
			draft.baseRevision = resolution.seed.baseRevision;
			draft.target = structuredClone(resolution.seed.target);
			draft.expectedText = resolution.seed.expectedText;
			draft.editableText = resolution.seed.editableText;
			if (draft.status === "conflict" || draft.status === "orphaned")
				draft.status = state.activeDraft === draft.id ? "dirty" : "held";
			delete draft.outside;
		} else if (resolution.kind === "changed") {
			delete state.draftAbsences[draft.id];
			draft.status = "conflict";
			draft.outside = structuredClone(resolution.seed);
		} else if (resolution.kind === "removed") {
			draft.status = "orphaned";
			delete draft.outside;
		} else {
			draft.status = "conflict";
		}
	};
	const admitSavedDraft = (draft: Draft, seed: DraftSeed) => {
		const acknowledgement = state.draftAcknowledgements[draft.id];
		if (
			!acknowledgement ||
			(seed.baseRevision !== acknowledgement.revision &&
				seed.expectedText !== acknowledgement.expectedText)
		)
			throw new Error("Committed draft source unavailable");
		Object.assign(draft, seed);
		// A superseding own edit may replace saved source; normalization alone never moves native undo.
		if (
			seed.baseRevision !== acknowledgement.receiptRevision &&
			seed.expectedText !== acknowledgement.receiptText
		) {
			draft.baseText = lf(seed.editableText);
			if (draft.generation === acknowledgement.generation) draft.text = draft.baseText;
		}
		draft.status = draft.text === draft.baseText ? "clean" : "dirty";
		delete draft.outside;
		delete state.draftAcknowledgements[draft.id];
		delete draft.resolutionEpoch;
		if (draft.status !== "clean") persist(draft);
	};
	const advanceDraftAcknowledgements = (
		file: OperationResult["files"][number],
		mapping: OperationResult["mapping"],
	) => {
		for (const [id, acknowledgement] of Object.entries(state.draftAcknowledgements)) {
			const draft = state.drafts[id];
			if (draft.file !== file.path || acknowledgement.revision !== file.fromRevision) continue;
			delete draft.resolutionEpoch;
			if (mapping.some((m) => m.oldId === acknowledgement.focus.nodeId && m.newId === null)) {
				resolve(draft, { kind: "removed" });
				delete state.draftAcknowledgements[id];
				persist(draft);
				continue;
			}
			// Only a contiguous own write can authorize changed target bytes without D11.
			acknowledgement.revision = file.toRevision;
			delete acknowledgement.expectedText;
		}
	};
	const popupClose = () => {
		const top = state.layers.at(-1);
		if (top?.kind !== "popup" && top?.kind !== "dialog") return;
		state.layers.pop();
		focus(top.opener);
		if (top.kind === "popup" && top.popup === "drag") say(announcement("grabCancelled"));
	};
	const operationFocus = (
		rule: FocusRule,
		result: OperationResult,
		operation: string,
		before?: SelectionSnapshot,
		affectsSelection = true,
	) => {
		if (rule.kind === "insert") {
			open(rule.seed, rule.selection ?? [0, 0]);
			return;
		}
		if (rule.kind === "merge") {
			const seed = deps.readDraft(rule.earlier);
			open(seed, [rule.join, rule.join]);
			return;
		}
		if (rule.kind === "add-item") {
			open(deps.readDraft(rule.item), [3, 3]);
			return;
		}
		let target: Focus;
		if (rule.kind === "helper") target = rule.opener;
		else if (rule.kind === "review") target = rule.next;
		else if (rule.kind === "delete") target = rule.candidates[0] ?? deleteFocus(result.focus);
		else if (operation === "insertBlock" || operation === "replaceBlock") {
			open(deps.readDraft(result.focus), [0, 0]);
			return;
		} else if (operation === "addItem") {
			open(deps.readDraft(result.focus), [3, 3]);
			return;
		} else target = result.focus;
		if (
			rule.kind === "result" &&
			deps.selectionNodes &&
			before?.focus?.nodeId &&
			[
				"moveBlocks",
				"movePage",
				"moveItem",
				"turnInto",
				"duplicateBlocks",
				"wrapInColumns",
			].includes(operation)
		) {
			// A pinned selection can move while focus is on another node. The
			// operation's survivor then owns focus, within the original UI context.
			const original = before.selected.includes(before.focus.nodeId)
				? before.focus.nodeId
				: result.focus.nodeId;
			const mapped = result.mapping.find(
				(m) =>
					m.oldId === original &&
					(operation === "duplicateBlocks" ? m.fate === "copied" : m.fate !== "copied"),
			);
			const nodeId = mapped?.newId ?? original;
			const node = selectionNodes(deps).find((n) => n.id === nodeId);
			target = {
				file: node?.file ?? result.focus.file,
				nodeId,
				role: before.focus.role === "outline" ? "outline" : "handle",
			};
		}
		state.layers = [{ kind: "page" }, { kind: "selected" }];
		if (before) {
			state.selected = [...before.selected];
			state.selection = structuredClone(before.selection);
		}
		const preserve = [
			"moveBlocks",
			"movePage",
			"moveItem",
			"turnInto",
			"setText",
			"setProperty",
			"editSource",
			"acceptSuggestion",
			"rejectSuggestion",
		].includes(operation);
		if (rule.kind === "helper") selected(target);
		else if (deps.selectionNodes && !affectsSelection) remapSelection(state, result.mapping, deps);
		else if (operation === "duplicateBlocks") remapSelection(state, result.mapping, deps, true);
		else if (preserve) remapSelection(state, result.mapping, deps);
		else if (operation === "wrapIn") selected(target);
		else if (operation === "pasteBlocks") {
			state.selected = result.mapping
				.filter((m) => m.newId && (m.fate === "new" || m.fate === "copied" || m.fate === "kept"))
				.map((m) => m.newId as string);
			state.selection = {
				...emptySelection(),
				anchor: target.nodeId,
				focus: target.nodeId,
				extended: state.selected.length > 1,
			};
		} else selected(target);
		focus(target);
	};
	const startSelectionOperation = (
		operation: string,
		args: Record<string, unknown>,
		rule?: FocusRule,
		context = {},
		destination?: SelectionDestination,
		prepared?: Pick<OperationRequest, "targets" | "files"> & {
			transactionId?: string;
			before?: SelectionSnapshot;
		},
	) => {
		if (state.pending) return;
		const reason = selectionReason(state, operation, args, deps);
		if (reason) {
			say(
				announcement("refused", {
					action: deps.translate({ key: `session.actions.${operation}`, params: {} }),
					reason: deps.translate(reason),
				}),
				"assertive",
			);
			return;
		}
		const targets = selectionTargets(state, deps).map((target) => {
			const original = prepared?.targets.find(
				(t) =>
					t.ref.kind === "node" && target.ref.kind === "node" && t.ref.nodeId === target.ref.nodeId,
			);
			if (!original) return target;
			if (typeof original.expectedText !== "string")
				throw new Error("Selected node needs an expectedText guard");
			return { ...structuredClone(original), expectedText: original.expectedText };
		});
		operation = selectionOperationName(state, operation, deps);
		if (operation === "copy") {
			effects.push({
				type: "clipboard",
				targets,
				text:
					targets.map((t) => t.expectedText.replace(/(?:\r?\n)+$/u, "")).join("\n\n") +
					(targets.at(-1)?.expectedText.endsWith("\n") ? "\n" : ""),
			});
			const draft = Object.values(state.drafts).find((d) => {
				const ref = d.target;
				return (
					ref.kind === "node" &&
					ref.nodeId !== null &&
					(state.selected.includes(ref.nodeId) ||
						ancestors(ref.nodeId, selectionNodes(deps)).some((id) => state.selected.includes(id)))
				);
			});
			say(
				announcement("copied", {
					n: targets.length,
					draftName: draft ? deps.nameOfFocus(draftFocus(draft)) : "undefined",
				}),
			);
			return;
		}
		const files = [...new Set(targets.map((t) => t.file))].map((path) => {
			const target = targets.find((t) => t.file === path);
			if (target?.ref.kind !== "node") throw new Error("Selection operation requires node targets");
			return {
				path,
				baseRevision:
					prepared?.files.find((f) => f.path === path)?.baseRevision ??
					state.revisions[path] ??
					deps.readDraft({ file: path, nodeId: target.ref.nodeId, role: "handle" }).baseRevision,
			};
		});
		for (const file of prepared?.files ?? []) {
			if (!files.some((f) => f.path === file.path)) files.push(structuredClone(file));
		}
		if (destination) {
			// Insertion boundaries have no source slice; node targets remain fully guarded.
			const base = files.find((f) => f.path === destination.target.file);
			if (base && base.baseRevision !== destination.baseRevision)
				throw new Error("Destination revision differs from selection revision");
			if (!base)
				files.push({ path: destination.target.file, baseRevision: destination.baseRevision });
		}
		const request: OperationRequest = {
			transactionId: prepared?.transactionId ?? id(state, "transaction"),
			operation,
			args: structuredClone(args),
			targets: destination ? [...targets, structuredClone(destination.target)] : targets,
			files,
		};
		const view = selectionView(state, deps);
		const firstName = deps.nameOfFocus({
			file: targets[0].file,
			nodeId: state.selected[0],
			role: "handle",
		});
		state.pending = {
			kind: "operation",
			request,
			expect: owner(state.focus),
			focus: rule ?? { kind: "result" },
			context: {
				n: state.selected.length,
				direction: args.direction === "down" ? "down" : "up",
				positionMove: destination ? 1 : 0,
				name: firstName,
				name1: firstName,
				name2:
					state.selected.length > 1
						? deps.nameOfFocus({ file: targets[1].file, nodeId: state.selected[1], role: "handle" })
						: undefined,
				more: Math.max(0, state.selected.length - 2),
				...context,
			},
			selectionBefore: prepared?.before ?? selectionSnapshot(state),
			suggestionIds:
				operation === "deleteBlocks" || operation === "cutBlocks"
					? view.suggestions.map((s) => s.id)
					: [],
		};
		state.layers = state.layers.filter((l) => l.kind !== "popup" && l.kind !== "dialog");
		effects.push({ type: "post", method: "operationApply", request });
	};

	const resolveDraft = (draft: Draft, epoch: number) => {
		const acknowledgement = state.draftAcknowledgements[draft.id];
		effects.push({
			type: "post",
			method: "draftResolve",
			draft: structuredClone({
				...draft,
				target: acknowledgement?.target ?? draft.target,
				expectedText: acknowledgement?.expectedText ?? draft.expectedText,
			}),
			epoch,
		});
	};
	const resolveDrafts = (file: string) => {
		for (const draft of Object.values(state.drafts).filter((d) => d.file === file)) {
			draft.resolutionEpoch = state.epoch;
			resolveDraft(draft, state.epoch);
		}
	};
	const outsideChange = (command: Extract<Command, { type: "outsideChange" }>, resolve = true) => {
		const before = [...state.selected];
		remapSelection(state, command.mapping ?? [], deps);
		state.revisions[command.file] = command.revision;
		state.epoch++;
		if (resolve) resolveDrafts(command.file);
		const focusMissing =
			deps.selectionNodes &&
			state.focus?.nodeId &&
			state.focus.file === command.file &&
			!selectionNodes(deps).some((n) => n.id === state.focus?.nodeId);
		if ((command.focusedRemoved || focusMissing) && state.focus?.file === command.file) {
			const draft = active(state);
			if (draft) {
				draft.status = "orphaned";
				delete state.draftAcknowledgements[draft.id];
				persist(draft);
				state.activeDraft = null;
			}
			const target = deleteFocus(state.focus);
			state.layers = [{ kind: "page" }, { kind: "selected" }];
			if (!state.selected.length) selected(target);
			focus(target);
			say(
				announcement(draft ? "focusedDraftRemoved" : "focusedRemoved", {
					name: deps.nameOfFocus(target),
				}),
			);
		}
		if (!effects.some((e) => e.type === "announce") && state.selected.length < before.length)
			say(selectionCount(state, deps, "selectionRemoved"));
	};
	switch (command.type) {
		case "focusChanged":
			if (state.focus?.nodeId !== command.focus.nodeId || state.focus.file !== command.focus.file)
				state.selection.allScope = null;
			state.focus = structuredClone(command.focus);
			if (
				!state.selection.extended &&
				(!state.activeDraft ||
					(state.pending?.kind === "commit" &&
						["leave", "select", "selection"].includes(state.pending.exit.kind))) &&
				(command.focus.role === "handle" || command.focus.role === "outline")
			) {
				const draft = active(state);
				if (draft && command.focus.nodeId === draftFocus(draft).nodeId)
					collapseSelection(state, command.focus);
				else selected(command.focus);
			}
			break;
		case "focusResult": {
			const pending = state.replyFocus;
			if (!pending || pending.requestId !== command.requestId) break;
			delete state.replyFocus;
			if (command.success) {
				state.focus = pending.snapshot.focus;
				state.selected = pending.snapshot.selected;
				state.selection = pending.snapshot.selection;
			}
			const entry = state.history.find((entry) => entry.id === pending.historyEntryId);
			if (entry && command.success)
				entry.selectionAfter = sourceHistorySnapshot() ?? selectionSnapshot(state);
			break;
		}
		case "select":
			if (active(state)) {
				if (command.mode) {
					const draft = active(state);
					state.selection.anchor = draft?.target.kind === "node" ? draft.target.nodeId : null;
					commit({ kind: "selection", focus: command.focus, mode: command.mode });
				} else commit({ kind: "select", focus: command.focus });
			} else if (!state.pending && state.layers.at(-1)?.kind !== "dialog") {
				if (
					deps.selectionNodes &&
					selectionNodes(deps).find((n) => n.id === command.focus.nodeId)?.kind === "page" &&
					command.focus.role !== "outline"
				)
					break;
				const message = selectNode(state, command.focus, command.mode, deps);
				state.layers = [{ kind: "page" }, { kind: "selected" }];
				focus(command.focus);
				if (message) say(message);
			}
			break;
		case "selectionKey": {
			if (
				state.pending ||
				state.layers.at(-1)?.kind === "popup" ||
				state.layers.at(-1)?.kind === "dialog"
			)
				break;
			const result = selectionKey(state, command.key, deps, command.extend);
			if (result.target) focus(result.target);
			if (result.message) say(result.message);
			break;
		}
		case "selectionOperation":
			startSelectionOperation(
				command.operation,
				command.args,
				command.focus,
				command.context,
				command.destination,
			);
			break;
		case "reviewSelection": {
			const first = selectionView(state, deps).suggestions[0];
			if (first) {
				state.layers.push({ kind: "margin", handle: state.focus ?? first.focus });
				focus(first.focus);
			}
			break;
		}
		case "openSource":
			if (
				state.pending ||
				state.layers.at(-1)?.kind === "dialog" ||
				state.lens === "print" ||
				state.lens === "playback"
			)
				break;
			if (active(state)) {
				if (!sameDraftTarget(active(state) as Draft, command.seed))
					commit({ kind: "open", seed: command.seed, displayId: command.displayId });
			} else open(command.seed, undefined, command.displayId);
			break;
		case "changeDraft": {
			const draft = active(state);
			if (!draft) break;
			if (
				command.selection.some(
					(offset) => !Number.isInteger(offset) || offset < 0 || offset > command.text.length,
				)
			)
				throw new Error("Invalid draft selection");
			if (draft.text !== command.text) {
				draft.text = command.text;
				draft.generation++;
				draft.changedAt = deps.now;
				if (state.draftAbsences[draft.id]) draft.status = draft.text === "" ? "clean" : "orphaned";
				else if (draft.status !== "conflict" && draft.status !== "orphaned")
					draft.status = draft.text === draft.baseText ? "clean" : "dirty";
				if (draft.status === "clean")
					state.pendingDraftPersistence[draft.id] = {
						requestId: null,
						generation: draft.generation,
						version: (draft.persistenceVersion ?? 0) + 1,
						expectedVersion: draft.persistedVersion ?? -1,
					};
			}
			draft.selection = [...command.selection];
			if (state.focus?.role === "source") state.focus.selection = [...command.selection];
			state.lastKeyAt = deps.now;
			break;
		}
		case "openPopup": {
			if (state.lens !== "page" || state.pending || state.layers.at(-1)?.kind === "dialog") break;
			const draft = active(state);
			const parent = state.layers.at(-1);
			const snapshot =
				command.popup === "submenu" && parent?.kind === "popup" ? parent.target : command.target;
			const targetSnapshot = structuredClone(snapshot);
			if (
				command.popup === "actions" &&
				deps.selectionNodes &&
				targetSnapshot.target.ref.kind === "node" &&
				state.selected.includes(targetSnapshot.target.ref.nodeId ?? "")
			) {
				const targets = selectionTargets(state, deps).map((target) =>
					target.ref.kind === "node" &&
					targetSnapshot.target.ref.kind === "node" &&
					target.ref.nodeId === targetSnapshot.target.ref.nodeId
						? structuredClone(targetSnapshot.target)
						: target,
				);
				const files = [...new Set(targets.map((t) => t.file))].map((path) => {
					const target = targets.find((t) => t.file === path);
					if (target?.ref.kind !== "node") throw new Error("Menu selection needs node targets");
					return {
						path,
						baseRevision:
							path === targetSnapshot.target.file
								? targetSnapshot.revision
								: (state.revisions[path] ??
									deps.readDraft({ file: path, nodeId: target.ref.nodeId, role: "handle" })
										.baseRevision),
					};
				});
				targetSnapshot.selection = { targets, files, before: selectionSnapshot(state) };
			}
			if (command.popup === "helper" && !draft && state.selected.length > 1) {
				collapseSelection(state, command.opener);
				say(announcement("selectionCleared"));
			}
			if (command.popup === "submenu" && state.layers.at(-1)?.kind !== "popup") break;
			if (command.popup !== "submenu") {
				state.layers = state.layers.filter((l) => l.kind !== "popup");
			}
			state.layers.push({
				kind: "popup",
				popup: command.popup,
				opener: structuredClone(command.opener),
				target: targetSnapshot,
				...(command.helper && draft
					? {
							helper: {
								...structuredClone(command.helper),
								draftId: draft.id,
								generation: draft.generation,
							},
						}
					: {}),
			});
			break;
		}
		case "openDialog": {
			if (state.pending || state.layers.at(-1)?.kind === "dialog") break;
			const top = state.layers.at(-1);
			const target = top?.kind === "popup" ? top.target : command.target;
			if (!target) throw new Error("Dialog needs a target snapshot");
			const snapshot = structuredClone(target);
			if (command.replaceMenu) state.layers = state.layers.filter((l) => l.kind !== "popup");
			state.layers.push({
				kind: "dialog",
				dialog: command.dialog,
				opener: structuredClone(command.opener),
				target: snapshot,
			});
			focus({ ...command.opener, role: "dialog", control: command.dialog, selection: undefined });
			break;
		}
		case "escape": {
			if (state.pending) break;
			const top = state.layers.at(-1);
			if (top?.kind === "popup" || top?.kind === "dialog") popupClose();
			else if (top?.kind === "source") commit({ kind: "leave" });
			else if (top?.kind === "margin") {
				state.layers.pop();
				focus(top.handle);
			} else if (top?.kind === "selected") {
				if (state.selected.length > 1 || state.selection.extended) {
					if (state.focus) collapseSelection(state, state.focus);
					say(announcement("selectionCleared"));
				} else {
					state.selected = [];
					state.selection = emptySelection();
					state.layers.pop();
				}
			}
			break;
		}
		case "completeLayer":
			popupClose();
			break;
		case "pointer": {
			const top = state.layers.at(-1);
			if (top?.kind === "dialog") break;
			if (top?.kind === "popup" && !command.insideLayer) {
				popupClose();
				break;
			}
			if (active(state) && !command.insideGroup)
				commit(command.focus ? { kind: "select", focus: command.focus } : { kind: "leave" });
			else if (!active(state) && command.focus && !command.insideLayer) {
				const message = selectNode(state, command.focus, undefined, deps);
				state.layers = [{ kind: "page" }, { kind: "selected" }];
				focus(command.focus);
				if (message) say(message);
			}
			break;
		}
		case "focusLeave":
			if (!command.insideGroup) commit({ kind: "select", focus: command.focus });
			else state.focus = structuredClone(command.focus);
			break;
		case "prepareDraftPersistence": {
			for (const draft of Object.values(state.drafts)) {
				if (
					canPersist(draft) &&
					(draft.persistedGeneration !== draft.generation ||
						(state.restoredDraftVersions?.[draft.id] ?? draft.persistedVersion) !==
							draft.persistenceVersion ||
						state.pendingDraftPersistence[draft.id]?.requestId === null)
				)
					persist(draft);
			}
			break;
		}
		case "blur": {
			const draft = active(state);
			if (draft) {
				persist(draft);
				if (state.lens === "source") commit({ kind: "stay" });
			}
			break;
		}
		case "draftPersistenceReply": {
			const pending = state.pendingDraftPersistence[command.id];
			if (
				!pending ||
				pending.requestId !== command.requestId ||
				pending.generation !== command.generation
			)
				break;
			delete state.pendingDraftPersistence[command.id];
			const draft = state.drafts[command.id];
			// A matching predecessor success supplies the next metadata CAS guard, even after validation.
			if (command.ok && draft) {
				draft.persistedVersion = pending.version;
				delete state.restoredDraftVersions?.[command.id];
			}
			if (
				command.ok &&
				draft?.generation === command.generation &&
				(draft.persistenceVersion ?? 0) === pending.version
			) {
				draft.persistedGeneration = command.generation;
			} else if (!command.ok && draft)
				state.pendingDraftPersistence[command.id] = { ...pending, requestId: null };
			break;
		}
		case "retryDraftPersistence": {
			const draft = state.drafts[command.id];
			if (draft && canPersist(draft)) persist(draft);
			break;
		}
		case "commit":
			commit({ kind: command.trigger === "save" ? "stay" : "leave" });
			break;
		case "switchLens":
			if (active(state)) commit({ kind: "lens", lens: command.lens, seed: command.seed });
			else if (!state.pending) {
				state.lens = command.lens;
				state.layers = [{ kind: "page" }];
				if (command.lens === "source" && command.seed) open({ ...command.seed, scope: "file" });
			}
			break;
		case "tick": {
			const draft = active(state);
			if (draft) {
				const idle = deps.now - draft.changedAt;
				if (draft.validatedGeneration !== draft.generation && idle >= DRAFT_VALIDATION_IDLE_MS) {
					const result = deps.validateDraft(structuredClone(draft));
					draft.diagnostics = result.diagnostics;
					draft.validatedGeneration = draft.generation;
					if (state.draftAbsences[draft.id])
						draft.status = draft.text === "" ? "clean" : "orphaned";
					else if (draft.status !== "conflict" && draft.status !== "orphaned")
						draft.status = result.escapes
							? "held"
							: result.diagnostics.some((d) => d.severity === "error")
								? "invalid"
								: draft.text === draft.baseText
									? "clean"
									: "dirty";
				}
				versionDraft(draft);
				if (
					(draft.persistedGeneration !== draft.generation ||
						draft.persistedVersion !== draft.persistenceVersion) &&
					idle >= 1000 &&
					canPersist(draft)
				)
					persist(draft);
				if (
					state.lens === "source" &&
					idle >= 2000 &&
					!state.pending &&
					draft.text !== draft.baseText
				)
					commit({ kind: "stay" });
			}
			if (nextBackgroundAnnouncementAt(state) <= deps.now) {
				const ready = state.background.filter((a) => a.due <= deps.now);
				state.background = state.background.filter((a) => a.due > deps.now);
				for (const queued of ready) say(queued.message, "polite", 150, queued.courseParams);
			}
			break;
		}
		case "applyHelper": {
			const top = state.layers.at(-1);
			if (top?.kind !== "popup" || !top.helper) break;
			const draft = active(state);
			const helper = top.helper;
			if (!draft || draft.id !== helper.draftId) {
				popupClose();
				break;
			}
			let range = helper.range;
			if (draft.generation !== helper.generation) {
				const tokens = deps
					.helperTokens(structuredClone(draft))
					.filter((token) => token.key === helper.key && token.line === helper.line);
				if (tokens.length !== 1) {
					say(announcement("helperStale"), "assertive");
					break;
				}
				range = tokens[0].range;
			}
			effects.push({
				type: "nativeText",
				action: "insert",
				draftId: draft.id,
				generation: draft.generation,
				range,
				text: command.text,
			});
			popupClose();
			break;
		}
		case "implicitEdit": {
			if (state.pending || active(state)) break;
			if (state.selected.length > 1) {
				collapseSelection(state, command.opener);
				say(announcement("selectionCleared"));
			}
			const draft = makeDraft(command.seed);
			draft.text = command.text;
			draft.generation++;
			draft.status = "dirty";
			const request = draftRequest(draft);
			state.pending = {
				kind: "operation",
				request,
				expect: owner(command.opener),
				focus: { kind: "helper", opener: command.opener },
				context: command.context ?? {},
				draft,
			};
			effects.push({ type: "post", method: "operationApply", request });
			break;
		}
		case "menuOperation": {
			const top = state.layers.at(-1);
			if (state.pending || (top?.kind !== "popup" && top?.kind !== "dialog")) break;
			const snapshot = structuredClone(top.target);
			if (singleNodeOperations.has(command.operation) && snapshot.target.ref.kind === "node") {
				if (state.selected.length > 1) say(announcement("selectionCleared"));
				collapseSelection(state, {
					file: snapshot.target.file,
					nodeId: snapshot.target.ref.nodeId,
					role: "handle",
				});
			}
			if (
				deps.selectionNodes &&
				snapshot.target.ref.kind === "node" &&
				state.selected.includes(snapshot.target.ref.nodeId ?? "") &&
				selectionOperations.has(command.operation)
			) {
				startSelectionOperation(
					command.operation,
					command.args,
					command.focus,
					command.context,
					undefined,
					snapshot.selection,
				);
				break;
			}
			const request: OperationRequest = {
				transactionId: id(state, "transaction"),
				operation: command.operation,
				files: [{ path: snapshot.target.file, baseRevision: snapshot.revision }],
				targets: [snapshot.target],
				args: structuredClone(command.args),
			};
			state.layers = state.layers.filter((l) => l.kind !== "popup" && l.kind !== "dialog");
			state.pending = {
				kind: "operation",
				request,
				expect: owner(top.opener),
				focus: command.focus ?? { kind: "result" },
				context: command.context ?? {},
				selectionBefore: selectionSnapshot(state),
			};
			effects.push({ type: "post", method: "operationApply", request });
			break;
		}
		case "operation":
			if (!state.pending) {
				if (
					deps.selectionNodes &&
					selectionOperations.has(command.request.operation) &&
					command.request.targets.some(
						(t) => t.ref.kind === "node" && state.selected.includes(t.ref.nodeId ?? ""),
					)
				) {
					const destination = command.request.targets.find((t) => t.ref.kind === "insertion");
					startSelectionOperation(
						command.request.operation,
						command.request.args,
						command.focus,
						command.context,
						destination?.ref.kind === "insertion"
							? {
									target: { ...destination, ref: destination.ref },
									baseRevision:
										command.request.files.find((f) => f.path === destination.file)?.baseRevision ??
										"",
								}
							: undefined,
						{ ...command.request, before: selectionSnapshot(state) },
					);
					break;
				}
				state.pending = {
					kind: "operation",
					request: structuredClone(command.request),
					expect: owner(state.focus),
					focus: command.focus ?? { kind: "result" },
					context: command.context ?? {},
					selectionBefore: selectionSnapshot(state),
				};
				effects.push({
					type: "post",
					method: "operationApply",
					request: structuredClone(command.request),
				});
			}
			break;
		case "operationReply": {
			const pending = state.pending;
			const result = command.result;
			if (
				!pending ||
				pending.kind === "history" ||
				pending.request.transactionId !== result.transactionId
			)
				break;
			const draft = pending.kind === "commit" ? state.drafts[pending.draft.id] : pending.draft;
			if (!result.ok) {
				state.pending = null;
				if (draft) {
					draft.status =
						result.code === "orphaned"
							? "orphaned"
							: result.code === "conflict" || result.code === "ambiguous" || result.code === "stale"
								? "conflict"
								: "held";
					state.drafts[draft.id] = draft;
					persist(draft);
					if (pending.kind === "commit")
						finish(
							pending.exit.kind === "selection" ? { kind: "stay" } : pending.exit,
							draftFocus(draft),
							draft,
						);
				}
				say(
					operationAnnouncement(
						pending.request.operation,
						result.member
							? {
									...result,
									message: {
										key: "op.selectionMember",
										params: {
											name: deps.nameOfFocus({
												file:
													result.file ??
													pending.request.targets[0]?.file ??
													state.focus?.file ??
													"",
												nodeId: result.member,
												role: "handle",
											}),
											reason: deps.translate(result.message),
										},
									},
								}
							: result,
						pending.kind === "operation" ? pending.context : {},
						state,
						deps.translate,
					),
					"assertive",
				);
				break;
			}
			applyCorrespondence(result.correspondence);
			state.pending = null;
			const { correspondence: _pairs, historyId, seq, ...operation } = result;
			const outsideFiles: string[] = [];
			for (const file of result.files) {
				if (seq !== undefined && seq < (state.revisionSeqs[file.path] ?? -1)) continue;
				if (
					file.fromRevision !==
						pending.request.files.find((base) => base.path === file.path)?.baseRevision &&
					file.fromRevision !== state.revisions[file.path]
				) {
					outsideChange(
						{ type: "outsideChange", file: file.path, revision: file.fromRevision },
						false,
					);
					outsideFiles.push(file.path);
				}
				advanceDraftAcknowledgements(file, result.mapping);
				state.revisions[file.path] = file.toRevision;
				if (seq !== undefined) state.revisionSeqs[file.path] = seq;
			}
			const beforeSelection = pending.selectionBefore ?? selectionSnapshot(state);
			// The registry has already chosen F8's survivor or deletion fallback.
			const focusTarget = { ...result.focus, role: "handle" as const };
			if (result.files.some((file) => file.edits.length > 0))
				pushHistory({
					id: id(state, "history"),
					kind: "operation",
					operations: [structuredClone(operation)],
					historyIds: [historyId],
					summary: result.summary,
					epoch: state.epoch,
					sessionId: pending.kind === "commit" ? pending.draft.id : undefined,
					focus: focusTarget,
					selectionBefore: beforeSelection,
				});
			if (pending.kind === "commit" && draft) {
				const source = draftFocus(draft);
				const changedWhileSaving = draft.generation !== pending.draft.generation;
				if (result.intent !== "delete") {
					const file = result.files.find((file) => file.path === focusTarget.file);
					if (!file) throw new Error("Committed draft revision unavailable");
					const guard = result.inverse.guards.find(
						(guard) =>
							guard.kind === "written" &&
							guard.file === focusTarget.file &&
							guard.ref.nodeId === focusTarget.nodeId,
					);
					state.draftAcknowledgements[draft.id] = {
						revision: file.toRevision,
						receiptRevision: file.toRevision,
						receiptText: guard?.kind === "written" ? guard.text : undefined,
						generation: pending.draft.generation,
						focus: focusTarget,
						target: guard?.kind === "written" ? structuredClone(guard.ref) : undefined,
						expectedText: guard?.kind === "written" ? guard.text : undefined,
					};
					delete draft.resolutionEpoch;
					if (focusTarget.nodeId) state.draftDisplayIds[draft.id] = focusTarget.nodeId;
					draft.baseText = pending.draft.text;
					draft.diagnostics = result.diagnostics;
					draft.status = draft.text === draft.baseText ? "clean" : "dirty";
				} else {
					const file = result.files.find((file) => file.path === draft.file);
					if (!file) throw new Error("Deleted draft revision unavailable");
					state.draftAbsences[draft.id] = { revision: file.toRevision, focus: focusTarget };
					delete state.draftAcknowledgements[draft.id];
					delete draft.resolutionEpoch;
					delete draft.outside;
					draft.baseRevision = file.toRevision;
					draft.baseText = "";
					draft.expectedText = "";
					draft.editableText = "";
					draft.diagnostics = result.diagnostics;
					draft.status = draft.text === "" ? "clean" : "orphaned";
				}
				// A write acknowledged after more typing must not close or reset that field.
				if (changedWhileSaving) {
					persist(draft);
					finish({ kind: "stay" }, focusTarget, draft, source);
				} else {
					if (pending.exit.kind === "stay") {
						delete state.pendingDraftPersistence[draft.id];
						effects.push({
							type: "persistDraft",
							action: "remove",
							id: draft.id,
							file: draft.file,
						});
					}
					finish(pending.exit, focusTarget, draft, source);
				}
			} else
				operationFocus(
					pending.kind === "operation" ? pending.focus : { kind: "result" },
					result,
					pending.request.operation,
					beforeSelection,
					pending.request.targets.some(
						(t) => t.ref.kind === "node" && beforeSelection.selected.includes(t.ref.nodeId ?? ""),
					),
				);
			const entry = state.history.at(-1);
			if (entry?.operations.at(-1)?.transactionId === result.transactionId)
				entry.selectionAfter = sourceHistorySnapshot() ?? selectionSnapshot(state);
			const closed = pending.kind === "operation" ? (pending.suggestionIds ?? []) : [];
			if (closed.length)
				effects.push({
					type: "reviewReplaced",
					transactionId: result.transactionId,
					suggestionIds: closed,
				});
			if (!effects.some((e) => e.type === "announce"))
				say(
					operationAnnouncement(
						pending.request.operation,
						result,
						pending.kind === "operation"
							? { ...pending.context, closedSuggestions: closed.length }
							: {},
						state,
						deps.translate,
					),
				);
			// A proven seed supersedes any resolution requested from the pre-save guard.
			for (const file of outsideFiles) resolveDrafts(file);
			break;
		}
		case "undo":
		case "redo": {
			if (command.inTextField) {
				const draft = active(state);
				if (
					command.type === "undo" &&
					draft &&
					draft.text === draft.baseText &&
					state.focus?.role === "source"
				)
					say(announcement("nothingInField"));
				else effects.push({ type: "nativeText", action: command.type });
				break;
			}
			if (state.pending) break;
			const entry = state.history[command.type === "undo" ? state.cursor - 1 : state.cursor];
			const blocked = entry?.blocked;
			if (!entry || blocked) {
				say(
					announcement("refused", {
						action: deps.translate({ key: `session.actions.${command.type}`, params: {} }),
						reason: deps.translate(blocked ?? { key: "session.history.empty", params: {} }),
					}),
					"assertive",
				);
				break;
			}
			if (entry.kind === "discard" && entry.draft) {
				if (command.type === "undo") {
					const current = active(state);
					if (current && current.status !== "clean") {
						say(
							announcement("refused", {
								action: deps.translate({ key: "session.actions.undo", params: {} }),
								reason: deps.translate({ key: "session.reasons.activeDraft", params: {} }),
							}),
							"assertive",
						);
						break;
					}
					if (current) {
						remove(current);
						state.activeDraft = null;
					}
					const restored = structuredClone(entry.draft);
					// Discard deleted the acknowledged record; undo must persist it again.
					restored.persistedGeneration = -1;
					restored.persistedVersion = -1;
					state.drafts[restored.id] = restored;
					open(restored);
					persist(restored);
					state.cursor--;
				} else {
					const draft = state.drafts[entry.draft.id];
					if (draft) {
						remove(draft);
						state.activeDraft = null;
						selected(entry.focus);
						focus(entry.focus);
					}
					state.cursor++;
				}
				say(
					announcement(command.type === "undo" ? "undone" : "redone", {
						summary: deps.translate(entry.summary),
					}),
				);
				break;
			}
			const transactionId = id(state, "transaction");
			state.pending = {
				kind: "history",
				expect: owner(state.focus),
				transactionId,
				direction: command.type,
				entryId: entry.id,
				historyId: entry.historyIds[0],
			};
			effects.push({
				type: "post",
				method: "historyApply",
				transactionId,
				direction: command.type,
				historyId: entry.historyIds[0],
			});
			break;
		}
		case "historyReply": {
			const pending = state.pending;
			if (
				pending?.kind !== "history" ||
				pending.transactionId !== command.transactionId ||
				command.result.transactionId !== command.transactionId ||
				(command.result.ok && command.result.historyId !== pending.historyId)
			)
				break;
			state.pending = null;
			const entry = state.history.find((entry) => entry.id === pending.entryId);
			if (!entry) throw new Error("Missing history entry");
			if (!command.result.ok) {
				entry.blocked = command.result.message;
				say(
					announcement("refused", {
						action: deps.translate({ key: `session.actions.${pending.direction}`, params: {} }),
						reason: deps.translate(command.result.message),
					}),
					"assertive",
				);
				break;
			}
			applyCorrespondence(command.result.correspondence);
			state.cursor += pending.direction === "undo" ? -1 : 1;
			for (const file of command.result.files) {
				const seq = command.result.seq;
				if (seq !== undefined && seq < (state.revisionSeqs[file.path] ?? -1)) continue;
				if (
					state.revisions[file.path] !== undefined &&
					file.fromRevision !== state.revisions[file.path]
				)
					outsideChange({ type: "outsideChange", file: file.path, revision: file.fromRevision });
				advanceDraftAcknowledgements(file, command.result.mapping);
				state.revisions[file.path] = file.toRevision;
				if (seq !== undefined) state.revisionSeqs[file.path] = seq;
			}
			const target = command.result.mapping.some(
				(m) => m.oldId === entry.focus.nodeId && m.newId === null,
			)
				? deleteFocus(entry.focus)
				: entry.focus;
			selected(target);
			const snapshot = pending.direction === "undo" ? entry.selectionBefore : entry.selectionAfter;
			if (snapshot) {
				state.selected = [...snapshot.selected];
				state.selection = structuredClone(snapshot.selection);
				remapSelection(state, [], deps);
				focus(snapshot.focus ?? target);
			} else focus(target);
			say(
				announcement(pending.direction === "undo" ? "undone" : "redone", {
					summary: deps.translate(entry.summary),
				}),
			);
			break;
		}
		case "historyAvailability": {
			const entry = state.history.find((e) => e.id === command.entryId);
			if (entry) entry.blocked = command.blocked;
			break;
		}
		case "discardDraft": {
			const draft = state.drafts[command.id];
			if (draft && !state.pending) discard(draft);
			break;
		}
		case "sourceSnapshot": {
			if (state.pending || command.seq < (state.revisionSeqs[command.file] ?? -1)) break;
			state.revisionSeqs[command.file] = command.seq;
			for (const [draftId, acknowledgement] of Object.entries(state.draftAcknowledgements)) {
				const draft = state.drafts[draftId];
				if (draft.file !== command.file || command.revision !== acknowledgement.revision) continue;
				if (
					draft.scope !== "file" &&
					deps.selectionNodes &&
					!selectionNodes(deps).some((node) => node.id === acknowledgement.focus.nodeId)
				)
					continue;
				const seed = deps.readDraft(acknowledgement.focus, draft.scope);
				admitSavedDraft(draft, seed);
			}
			if (
				state.revisions[command.file] !== undefined &&
				state.revisions[command.file] !== command.revision
			)
				outsideChange({ type: "outsideChange", file: command.file, revision: command.revision });
			else {
				state.revisions[command.file] = command.revision;
				if (
					Object.keys(state.draftAcknowledgements).some(
						(id) => state.drafts[id].file === command.file,
					)
				)
					resolveDrafts(command.file);
			}
			break;
		}
		case "outsideChange":
			outsideChange(command);
			break;
		case "draftResolved": {
			const draft = state.drafts[command.id];
			if (!draft || command.epoch !== draft.resolutionEpoch) break;
			if (command.generation !== draft.generation) {
				resolveDraft(draft, draft.resolutionEpoch);
				break;
			}
			const acknowledgement = state.draftAcknowledgements[draft.id];
			const resolution = command.resolution;
			if (acknowledgement && (resolution.kind === "changed" || resolution.kind === "unchanged")) {
				if (
					resolution.seed.baseRevision === acknowledgement.revision ||
					resolution.seed.expectedText === acknowledgement.expectedText
				)
					admitSavedDraft(draft, resolution.seed);
				else resolve(draft, { kind: "changed", seed: resolution.seed });
			} else resolve(draft, resolution);
			delete state.draftAcknowledgements[draft.id];
			persist(draft);
			break;
		}
		case "keepDraft": {
			const draft = active(state);
			if (draft?.status !== "conflict" || !draft.outside) break;
			const text = draft.text;
			Object.assign(draft, draft.outside);
			delete state.draftAbsences[draft.id];
			draft.baseText = lf(draft.editableText);
			draft.text = text;
			draft.status = "dirty";
			delete draft.outside;
			commit({ kind: "stay" });
			break;
		}
		case "useNewVersion": {
			const draft = active(state);
			if (draft?.outside) {
				const seed = structuredClone(draft.outside);
				discard(draft);
				open(seed);
			}
			break;
		}
		case "putDraftBack": {
			const draft = active(state);
			if (draft?.status === "orphaned" && command.seed.target.kind === "insertion") {
				Object.assign(draft, command.seed);
				delete state.draftAbsences[draft.id];
				draft.status = "dirty";
				commit({ kind: "stay" });
			}
			break;
		}
		case "compareDraft": {
			const draft = active(state);
			if (!draft?.outside || state.layers.at(-1)?.kind === "dialog") break;
			state.layers.push({
				kind: "dialog",
				dialog: "compare",
				opener: command.opener,
				target: {
					target: { file: draft.file, ref: draft.target, expectedText: draft.expectedText },
					revision: draft.baseRevision,
					draftId: draft.id,
				},
			});
			break;
		}
		case "restoreDrafts":
			if (state.history.length || active(state)) throw new Error("Draft restoration is load-only");
			for (const item of command.drafts) {
				const draft = structuredClone(item.draft);
				draft.persistenceVersion ??= 0;
				if (item.origin !== "retained") {
					draft.persistedVersion = draft.persistenceVersion;
					draft.persistedGeneration = draft.generation;
				} else {
					draft.persistedGeneration = -1;
				}
				draft.status = "held";
				resolve(draft, item.resolution);
				if (
					JSON.stringify(draftPersistencePayload(draft)) !==
					JSON.stringify(draftPersistencePayload(item.draft))
				)
					draft.persistenceVersion++;
				if (item.origin !== "retained")
					(state.restoredDraftVersions ??= {})[draft.id] = draft.persistenceVersion;
				state.drafts[draft.id] = draft;
				state.revisions[draft.file] ??= draft.baseRevision;
			}
			if (command.drafts.length)
				state.background.push({
					message: announcement("draftsRestored", {
						n: command.drafts.length,
						pages: command.drafts.map((d) => d.page).join(", "),
					}),
					due: deps.now,
					courseParams: ["pages"],
				});
			break;
		case "pageReplaced":
			state.background = [];
			break;
		case "background":
			state.background.push({
				message: structuredClone(command.message),
				due: deps.now,
				courseParams: command.courseParams ?? courseParams,
			});
			break;
		case "enterMargin":
			if (!state.pending) {
				state.layers.push({ kind: "margin", handle: command.handle });
				focus(command.bubble);
			}
			break;
		case "restoreFocus": {
			const target = state.focus ?? state.replyFocus?.snapshot.focus;
			if (command.lost && target) focus(target);
			break;
		}
		case "setLanguage":
			state.interfaceLanguage = command.language;
			break;
	}
	if (beforeReply) {
		const effect = effects.filter((effect) => effect.type === "focus").at(-1);
		if (effect?.type === "focus" && effect.requestId) {
			const entry =
				command.type === "operationReply"
					? state.history.find(
							(entry) => entry.operations.at(-1)?.transactionId === command.result.transactionId,
						)
					: undefined;
			// Durable state settles now; focus-dependent selection waits for the native owner.
			state.replyFocus = {
				requestId: effect.requestId,
				snapshot: selectionSnapshot(state),
				historyEntryId: entry?.id,
			};
			state.focus = beforeReply.focus;
			// G10 protects an open field even when its native focus is declined.
			if (!state.activeDraft) {
				state.selected = beforeReply.selected;
				state.selection = beforeReply.selection;
			}
		}
	}
	effects.push({ type: "render" });
	const currentDraft = active(state);
	if (currentDraft) versionDraft(currentDraft);
	return { state, effects, consumed: command.type === "escape" && canEscape(previous) };
}

/** One history supplies the toolbar and dialog; adapters render the message refs. */
export function historyView(state: Session, deps: Pick<Dependencies, "translate" | "nameOfFocus">) {
	const summary = (entry: HistoryEntry) =>
		deps.translate({
			key: "session.history.namedSummary",
			params: { summary: deps.translate(entry.summary), name: deps.nameOfFocus(entry.focus) },
		});
	const button = (direction: "undo" | "redo", entry: HistoryEntry | undefined) => ({
		message: {
			key: `session.history.${direction}`,
			params: { summary: entry ? summary(entry) : "" },
		},
		summary: entry?.summary,
		disabled: Boolean(state.pending) || !entry || Boolean(entry.blocked),
		reason: entry ? entry.blocked : { key: "session.history.empty", params: {} },
	});
	return {
		undo: button("undo", state.history[state.cursor - 1]),
		redo: button("redo", state.history[state.cursor]),
		entries: [...state.history].reverse().map((entry) => ({
			...entry,
			label: summary(entry),
			canUndo: state.history.indexOf(entry) === state.cursor - 1 && !entry.blocked,
		})),
		emptyMessage: { key: "session.history.empty", params: {} },
	};
}
