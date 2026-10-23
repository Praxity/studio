import type {
	CanonicalDescriptor,
	IdentityDependencies,
	IdentityOperation,
	IdentityResolution,
	ParsedDocument,
	SourceMapping,
} from "@praxity/content-identity";
import {
	createIdentityPlan,
	describeDocument,
	lexicalScore,
	serializeIdentity,
} from "@praxity/content-identity";
import { assessmentFeedbackText } from "@praxity/content-model";
import { findLineEnding, preserveLineEndings } from "@praxity/grammar/src/line-endings.ts";
import type {
	FocusTarget,
	InsertionPoint,
	InverseGuard,
	NodeRef,
	OperationIntent,
	OperationRefusal,
	OperationRefusalCode,
	OperationRequest,
	OperationResult,
	OperationTarget,
} from "@praxity/grammar/src/operations/contract.ts";
import { applyEdits, type SourceEdit } from "@praxity/grammar/src/source-edit.ts";
import { type TokenStream, tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition, TURN_INTO, WRAP_IN } from "@praxity/grammar/src/v4/schema.ts";
import {
	analyzeLessonTree,
	definitionOf,
	type TreeNode,
} from "@praxity/grammar/src/v4/tree/index.ts";
import { sourceDiagnostics } from "./diagnostics.ts";
import { bindAllocatedEvidence } from "./evidence.ts";
import { InlineRefusal, planInlineEdits } from "./inline.ts";
import { applyRecordedInverse } from "./inverse.ts";
import {
	canvasTextReplacement,
	deletionRange,
	draftRange,
	escapes,
	inverseEdits,
	type LocatedNode,
	locateTree,
	minimalEdit,
	preserveTextWraps,
	translateRange,
} from "./ranges.ts";
import { conversionEdits, replacementText } from "./transforms.ts";

export {
	consumeInverseGroupIdentity,
	MAX_INVERSE_GROUP_MEMBERS,
	planInverseGroup,
} from "./inverse.ts";

interface CanvasTextDescriptor {
	field: "subject" | "text" | "value";
	roles?: readonly string[];
	names?: readonly string[];
	multiline?: boolean;
	accepts?: (text: string) => boolean;
	range: (
		node: Readonly<TreeNode>,
		stream: TokenStream,
	) => { start: number; end: number } | undefined;
}
const canvasTextFields: Partial<Record<TreeNode["kind"], CanvasTextDescriptor>> = {
	heading: { field: "subject", range: (node) => node.subject?.span },
	page: { field: "subject", roles: ["title"], range: (node) => node.subject?.span },
	option: {
		field: "text",
		multiline: true,
		// Markers belong to the response, even when pasted into the label's text slice.
		accepts: (text) => !/^[ \t]*(?:\([ xX]\)|\[[ xX]\])(?:[ \t]|$)/mu.test(text),
		range: (node) => node.text?.range,
	},
	part: {
		field: "value",
		roles: ["correct", "incorrect", "option-feedback", "caption"],
		names: ["correct", "incorrect", "feedback", "caption"],
		multiline: true,
		// Reader result roles already resolve shared and promoted feedback to its source part.
		range: (node) => node.value?.span,
	},
	body: {
		field: "text",
		multiline: true,
		// The tree resolves unknown named-part candidates to ordinary paragraph text.
		range: (node, stream) =>
			stream.lines
				.filter((line) => line.start >= node.span.start && line.end <= node.span.end)
				.every((line) => line.kind === "prose" || line.kind === "part")
				? {
						start: node.span.start,
						end: node.span.end - (node.raw.match(/(?:\r\n|\r|\n)$/u)?.[0].length ?? 0),
					}
				: undefined,
	},
	"list-entry": {
		field: "text",
		multiline: true,
		// Numeric prefixes are inline text after the item's marker; later lines reparse in context.
		accepts: (text) => {
			const stream = tokenizeLesson(text);
			const first = stream.lines[0];
			return (
				!first ||
				!stream.tokens
					.slice(first.tokenStart, first.tokenEnd)
					.some((token) => token.kind === "marker" && token.value === "- ")
			);
		},
		range: (node, stream) =>
			stream.lines
				.filter(
					(line) =>
						line.start >= node.span.start &&
						line.contentEnd <= (node.text?.range.end ?? node.span.end),
				)
				.every((line, index) => line.kind === (index ? "prose" : "list-item"))
				? node.text?.range
				: undefined,
	},
};

function canvasTextDescriptor(node: Readonly<TreeNode>) {
	const descriptor = canvasTextFields[node.kind];
	return descriptor?.names && !descriptor.names.includes(node.name ?? "") ? undefined : descriptor;
}

/** Exact scalar ranges are shared by ordinary operations and canvas eligibility. */
function textField(node: Readonly<TreeNode>, stream: TokenStream) {
	const descriptor = canvasTextDescriptor(node);
	if (!descriptor || node.status !== "resolved") return null;
	const range = descriptor.range(node, stream);
	if (!range) return null;
	const text = node.raw.slice(range.start - node.span.start, range.end - node.span.start);
	return {
		field: descriptor.field,
		text,
		range: { start: range.start, end: range.end },
	};
}

export function canvasTextField(
	node: Readonly<TreeNode>,
	role: string | undefined,
	stream: TokenStream,
	parent?: Readonly<TreeNode>,
) {
	const descriptor = canvasTextDescriptor(node);
	if (
		!descriptor ||
		(descriptor.roles ? !descriptor.roles.includes(role ?? "") : role !== undefined)
	)
		return null;
	if (node.kind === "body" && parent?.type === "fill-blank") return null;
	const field = textField(node, stream);
	return field?.text.trim() ? field : null;
}

/** Reparse the whole lesson so a scalar edit cannot change its structural nodes. */
export function canvasTextRefusal(
	source: string,
	node: Readonly<TreeNode>,
	role: string | undefined,
	text: string,
): OperationRefusalCode | null {
	const stream = tokenizeLesson(source);
	const descriptor = canvasTextDescriptor(node);
	const field = textField(node, stream);
	if (!field) return "not-allowed";
	if (/[\u0085\u2028\u2029]/u.test(text) || (!descriptor?.multiline && /[\r\n]/u.test(text)))
		return "line-break";
	if (!text.trim()) return "empty-text";
	if (/[\uD800-\uDFFF\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
		return "unsupported-syntax";
	if (descriptor?.accepts?.(text) === false) return "unsupported-syntax";
	text = canvasTextReplacement(descriptor?.field, text);
	const candidate = source.slice(0, field.range.start) + text + source.slice(field.range.end);
	const before = locateTree(analyzeLessonTree(stream, { definition: getDefinition }));
	const parent = before.find(
		(entry) => entry.node.span.start === node.span.start && entry.node.kind === node.kind,
	)?.parent?.node;
	// Only rendered question feedback treats timing words as settings. CLI setText
	// retains timing edits; option feedback always treats these words as prose.
	if (
		role !== undefined &&
		node.name === "feedback" &&
		parent?.kind !== "option" &&
		assessmentFeedbackText({ feedback: text.trim() }).correct === undefined
	)
		return "unsupported-syntax";
	const candidateStream = tokenizeLesson(candidate);
	const fieldEnd = field.range.start + text.length;
	const syntaxRefusal = candidateStream.lines.some(
		(line) => line.kind === "list-item" && line.start >= field.range.start && line.start < fieldEnd,
	)
		? "list-marker"
		: descriptor?.field === "subject" &&
				candidateStream.tokens.some(
					(token) =>
						(token.kind === "settings-open" || token.kind === "diagnostic") &&
						token.start >= field.range.start &&
						token.start < fieldEnd,
				)
			? "settings"
			: "unsupported-syntax";
	const tree = analyzeLessonTree(candidateStream, { definition: getDefinition });
	const after = locateTree(tree);
	const shape = (entry: LocatedNode) => {
		const n = entry.node;
		// Headers, markers and settings lie outside the field; its exact range below
		// rejects text that reparses into any of them. Paths retain ownership.
		// Continuation bounds need no separate guard: the exact field bounds and
		// unchanged outside bytes already contain their parsed children.
		return [entry.path, n.kind, n.status, n.trivia.length];
	};
	if (JSON.stringify(before.map(shape)) !== JSON.stringify(after.map(shape))) return syntaxRefusal;
	const next = after.find(
		(entry) => entry.node.kind === node.kind && entry.node.span.start === node.span.start,
	);
	const nextField = next && textField(next.node, tree.stream);
	return nextField &&
		nextField.range.start === field.range.start &&
		nextField.range.end === field.range.start + text.length
		? null
		: syntaxRefusal;
}

export interface CutRecord {
	file: string;
	text: string;
	nodeIds: string[];
	nodes: SourceMapping[];
}
export interface OperationHistory {
	focus: FocusTarget;
	before: OperationSourceFile[];
	after: OperationSourceFile[];
	identity: IdentityResolution;
	clipboard: CutRecord | null;
}
export interface OperationSourceFile {
	path: string;
	source: string;
}
export interface OperationContext extends IdentityDependencies {
	identity: IdentityResolution;
	activeHistoryIds?: ReadonlySet<string>;
	/** Hosts using the reader projection set this even before any role exists. */
	readerRoles?: boolean;
	clipboard?: CutRecord | null;
}

/** Argument vocabulary owned by the registry; hosts and contract tests enumerate it here. */
export const operationRegistry: Readonly<Record<string, readonly string[]>> = {
	editInline: ["text", "target", "definition", "rename"],
	editSource: ["text"],
	insertBlock: ["text", "type"],
	deleteBlocks: [],
	cutBlocks: [],
	copyBlocks: [],
	pasteBlocks: ["text"],
	discardCut: [],
	insertPage: ["title"],
	movePage: ["direction"],
	setPageTitle: ["title"],
	mergePage: [],
	deletePage: [],
	duplicateBlocks: [],
	moveBlocks: ["direction"],
	setProperty: ["name", "value"],
	setText: ["field", "text"],
	addItem: ["text", "position"],
	removeItem: [],
	moveItem: ["direction"],
	wrapInColumns: [],
	unwrapColumns: [],
	setColumnWeights: ["weights"],
	wrapIn: ["type", "title", "unwrap"],
	turnInto: ["type", "title"],
	mergeBlocks: [],
	replaceBlock: ["text", "type"],
};
/** Hosts persist these snapshots atomically with the planned source edits. */
export interface AppliedOperation extends OperationResult {
	identity: IdentityResolution;
	evidence: IdentityOperation[];
	clipboard: CutRecord | null;
	clipboardText?: string;
	history: OperationHistory;
}
/** Host-owned records in their original application order, never client-supplied inverses. */
export interface InverseGroupRequest {
	transactionId: string;
	operations: readonly AppliedOperation[];
}
/** No member may be installed alone. Persist every member snapshot and the final files together. */
export interface InverseGroupPlan {
	ok: true;
	transactionId: string;
	before: OperationSourceFile[];
	after: OperationSourceFile[];
	identity: IdentityResolution;
	clipboard: CutRecord | null;
	/** Inverse records in application order; pass this list back to plan the whole redo. */
	members: AppliedOperation[];
}
export interface OperationIdentityBinding {
	identity: IdentityResolution;
	activeHistoryIds?: readonly string[];
	before: readonly OperationSourceFile[];
	after: readonly OperationSourceFile[];
	operations: readonly IdentityOperation[];
	readerRoles: boolean;
	restore?: {
		identity: IdentityResolution;
		written: IdentityResolution;
		mapping: Readonly<AppliedOperation["inverse"]["mapping"]>;
	};
}
/** The store binds every intermediate inverse to its server-owned forward record. */
export interface InverseGroupIdentityBinding {
	identity: IdentityResolution;
	before: readonly OperationSourceFile[];
	after: readonly OperationSourceFile[];
	members: {
		operations: readonly IdentityOperation[];
		restore: NonNullable<OperationIdentityBinding["restore"]>;
	}[];
	readerRoles: boolean;
}
const issuedIdentities = new WeakMap<
	AppliedOperation,
	{
		binding: string;
		planned: string;
		identity: IdentityResolution;
		descriptors?: CanonicalDescriptor[];
		recordedTargets: string[];
	}
>();

/** The host supplies its admitted inventory, never a client-provided resolution. */
export function consumeOperationIdentity(
	operation: AppliedOperation,
	binding: OperationIdentityBinding,
): {
	identity: IdentityResolution;
	descriptors?: CanonicalDescriptor[];
	recordedTargets: string[];
} {
	const issued = issuedIdentities.get(operation);
	issuedIdentities.delete(operation);
	if (
		!issued ||
		issued.binding !== serializeIdentity(binding) ||
		issued.planned !==
			serializeIdentity({
				identity: operation.identity,
				before: operation.history.before,
				after: operation.history.after,
				operations: operation.evidence,
			})
	)
		throw new Error("identity-plan-unissued");
	return {
		identity: structuredClone(issued.identity),
		descriptors: issued.descriptors && structuredClone(issued.descriptors),
		recordedTargets: [...issued.recordedTargets],
	};
}
interface State {
	file: OperationSourceFile;
	document: ParsedDocument;
	nodes: LocatedNode[];
	edits: SourceEdit[];
	targets: LocatedNode[];
}
interface ResolvedTarget {
	target: OperationTarget;
	state: State;
	entry: LocatedNode;
	id: string;
}
interface RootPlacement {
	path?: readonly number[];
	file: string;
	oldId: string | null;
	start: number;
	fate: "kept" | "survivor" | "copied" | "new" | "pending";
	/** An inserted root's offset inside its base-revision insertion edit. */
	insert?: SourceEdit;
	/** A reparented root keeps its descendants even when the transaction also retires wrappers. */
	preserveDescendants?: boolean;
	resolvedStart?: number;
}
class Refused extends Error {
	constructor(
		readonly code: OperationRefusalCode,
		readonly target?: OperationTarget,
	) {
		super(code);
	}
}
const refuse = (code: OperationRefusalCode, target?: OperationTarget): never => {
	throw new Refused(code, target);
};
const parse = (file: OperationSourceFile): ParsedDocument => ({
	path: file.path,
	tree: analyzeLessonTree(tokenizeLesson(file.source), { definition: getDefinition }),
});
const samePath = (a: readonly number[], b: readonly number[]) =>
	a.length === b.length && a.every((v, i) => b[i] === v);
const below = (a: readonly number[], b: readonly number[]) =>
	a.length >= b.length && b.every((v, i) => a[i] === v);
const textArg = (args: Record<string, unknown>, key: string) =>
	typeof args[key] === "string" ? (args[key] as string) : refuse("invalid-args");
const nodeType = (entry: LocatedNode) => entry.node.type ?? entry.node.kind;
const schemaType = (entry: LocatedNode) => (entry.node.kind === "body" ? "text" : nodeType(entry));

function resolveNode(
	target: OperationTarget,
	state: State,
	context: OperationContext,
): ResolvedTarget {
	if (target.ref.kind !== "node") return refuse("invalid-args", target);
	const ref = target.ref;
	const candidates = context.identity.sourceMappings.filter(
		(m) =>
			m.file === target.file &&
			(ref.nodeId ? m.id === ref.nodeId : m.fingerprint === ref.fingerprint),
	);
	if (!candidates.length) return refuse("orphaned", target);
	if (candidates.length !== 1) return refuse("ambiguous", target);
	const map = candidates[0];
	if (map.fingerprint !== ref.fingerprint || !samePath(map.path, ref.path))
		return refuse("stale", target);
	const entry = state.nodes.find((n) => samePath(n.path, map.path));
	if (!entry) return refuse("orphaned", target);
	if (target.expectedText !== undefined && target.expectedText !== entry.node.raw)
		return refuse("conflict", target);
	return { target, state, entry, id: map.id };
}
function resolveBoundary(target: OperationTarget, state: State, context: OperationContext) {
	if (target.ref.kind !== "insertion") return refuse("invalid-args", target);
	const ref = target.ref;
	const find = (id: string | null, fallback?: NodeRef) => {
		if (fallback) {
			if (id !== null || fallback.nodeId !== null) return refuse("invalid-args", target);
			return resolveNode({ file: target.file, ref: fallback }, state, context);
		}
		const map = context.identity.sourceMappings.find(
			(m) => m.file === state.file.path && m.id === id,
		);
		const entry = map && state.nodes.find((n) => samePath(n.path, map.path));
		return entry && map ? { entry, id: map.id } : undefined;
	};
	const parentAnchor =
		ref.parentId || ref.parentRef ? find(ref.parentId, ref.parentRef) : undefined;
	const parent =
		parentAnchor?.entry ?? (ref.parentId || ref.parentRef ? undefined : state.nodes[0]);
	if (!parent) return refuse("orphaned", target);
	if (!["lesson", "page", "item", "block", "back"].includes(parent.node.kind))
		return refuse("not-allowed", target);
	const children = parent.node.children;
	const afterAnchor = ref.after || ref.afterRef ? find(ref.after, ref.afterRef) : undefined;
	const beforeAnchor = ref.before || ref.beforeRef ? find(ref.before, ref.beforeRef) : undefined;
	const after = afterAnchor?.entry;
	const before = beforeAnchor?.entry;
	if (((ref.after || ref.afterRef) && !after) || ((ref.before || ref.beforeRef) && !before))
		return refuse("orphaned", target);
	if ((after && after.parent !== parent) || (before && before.parent !== parent))
		return refuse("not-allowed", target);
	const afterIndex = after ? children.indexOf(after.node) : -1;
	const beforeIndex = before ? children.indexOf(before.node) : children.length;
	if (beforeIndex !== afterIndex + 1) return refuse("conflict", target);
	const offset =
		after?.node.span.end ??
		parent.node.header?.end ??
		(parent.node.kind === "lesson"
			? parent.node.children.find((n) => n.kind === "page")?.span.start
			: undefined) ??
		parent.node.span.start;
	return {
		parent,
		offset,
		ref: {
			kind: "insertion" as const,
			parentId: parent.path.length ? (parentAnchor?.id ?? ref.parentId) : null,
			after: afterAnchor?.id ?? null,
			before: beforeAnchor?.id ?? null,
		},
	};
}
function boundaryAt(
	state: State,
	offset: number,
	identity: IdentityResolution,
	parentPath?: readonly number[],
): InsertionPoint {
	const parent =
		(parentPath && state.nodes.find((node) => samePath(node.path, parentPath))) ??
		[...state.nodes]
			.reverse()
			.find(
				(n) =>
					["lesson", "page", "item", "block", "back"].includes(n.node.kind) &&
					(n.node.header?.end ?? n.node.span.start) <= offset &&
					(n.node.closer?.start ?? n.node.span.end) >= offset,
			) ??
		state.nodes[0];
	const ids = (node: LocatedNode | undefined) =>
		node
			? (identity.sourceMappings.find(
					(m) => m.file === state.file.path && samePath(m.path, node.path),
				)?.id ?? null)
			: null;
	const children = state.nodes.filter((n) => n.parent === parent);
	// Pages own separator trivia. Within an explicit parent, a gap can fall
	// before the preceding page's span ends, so classify it by child starts.
	return {
		kind: "insertion",
		parentId: ids(parent),
		after: ids(
			[...children]
				.reverse()
				.find((n) => (parentPath ? n.node.span.start < offset : n.node.span.end <= offset)),
		),
		// Without an explicit parent, an interior offset anchors before its child
		// so the boundary stays adjacent even when the edit starts inside a node.
		before: ids(
			children.find((n) => (parentPath ? n.node.span.start >= offset : n.node.span.end > offset)),
		),
	};
}
function insertion(state: State, offset: number, text: string, preserveRaw = false) {
	const eol = findLineEnding(state.file.source) ?? "\n";
	const raw = preserveRaw ? text : preserveLineEndings(text, state.file.source);
	const body = preserveRaw ? raw : raw.replace(/[\r\n]+$/u, "");
	const prefix =
		offset === 0
			? ""
			: /(?:\r\n|\r(?!\n)|\n){2}$/u.test(state.file.source.slice(0, offset))
				? ""
				: /[\r\n]$/u.test(state.file.source.slice(0, offset))
					? eol
					: `${eol}${eol}`;
	const followsBlank = /^[\r\n]/u.test(state.file.source.slice(offset));
	const suffix =
		preserveRaw && /(?:\r\n|\r(?!\n)|\n){2}$/u.test(body)
			? ""
			: preserveRaw && /[\r\n]$/u.test(body)
				? followsBlank
					? ""
					: eol
				: followsBlank
					? eol
					: `${eol}${eol}`;
	const edit = { start: offset, end: offset, text: `${prefix}${body}${suffix}` };
	state.edits.push(edit);
	return { edit, rootOffset: prefix.length };
}

function propertyEdit(target: ResolvedTarget, args: Record<string, unknown>): SourceEdit | null {
	const name = textArg(args, "name");
	const { node } = target.entry;
	const definition = definitionOf(node, target.entry.parent?.node, getDefinition);
	if (!definition) return refuse("not-allowed", target.target);
	if (!Object.hasOwn(definition.settings, name)) return refuse("invalid-args", target.target);
	const declaration = definition.settings[name];
	const value = args.value;
	if (
		value !== null &&
		typeof value !== "string" &&
		typeof value !== "boolean" &&
		typeof value !== "number"
	)
		return refuse("invalid-args", target.target);
	if (
		value !== null &&
		!declaration.accepts(typeof value === "number" ? String(value) : (value as string | boolean))
	)
		return refuse("invalid-args", target.target);
	const setting = node.settings.find((s) => s.name === name);
	const tokens = target.state.document.tree.stream.tokens;
	const header = node.header;
	if (!header) return refuse("not-allowed", target.target);
	const open = tokens
		.slice(header.tokenStart, header.tokenEnd)
		.find((t) => t.kind === "settings-open");
	const close = tokens
		.slice(header.tokenStart, header.tokenEnd)
		.find((t) => t.kind === "settings-close");
	const spelling =
		typeof value === "string" && (!value || /[\s{}"\\=]/u.test(value))
			? JSON.stringify(value)
			: String(value);
	const tokenText = declaration.type === "boolean" && value === true ? name : `${name}=${spelling}`;
	if (value === null) {
		if (!setting) return null;
		if (node.settings.length === 1 && open && close)
			return { start: open.start, end: close.end, text: "" };
		return { start: setting.span.start, end: setting.span.end, text: "" };
	}
	if (setting)
		return setting.value.value === true || (declaration.type === "boolean" && value === true)
			? { start: setting.span.start, end: setting.span.end, text: tokenText }
			: { start: setting.value.span.start, end: setting.value.span.end, text: spelling };
	if (open && close)
		return {
			start: close.start,
			end: close.start,
			text: `${node.settings.length ? " " : ""}${tokenText}`,
		};
	const line = target.state.document.tree.stream.lines.find((l) => l.start === header.start);
	if (!line) return refuse("not-allowed", target.target);
	return { start: line.contentEnd, end: line.contentEnd, text: ` {${tokenText}}` };
}

/** Pure all-or-none planning. Hosts own writes, rebasing and history application. */
export function applyOperation(
	files: readonly OperationSourceFile[],
	request: OperationRequest,
	context: OperationContext,
): AppliedOperation | OperationRefusal {
	try {
		const planned =
			request.operation === "applyInverse"
				? {
						operation: applyRecordedInverse(files, request, context),
						descriptors: undefined,
						recordedTargets: [],
					}
				: apply(files, request, context);
		const result = planned.operation;
		if (result.ok) {
			const inverse =
				request.operation === "applyInverse"
					? (request.args.operation as AppliedOperation)
					: undefined;
			issuedIdentities.set(result, {
				binding: serializeIdentity({
					identity: context.identity,
					...(context.activeHistoryIds
						? { activeHistoryIds: [...context.activeHistoryIds].sort() }
						: {}),
					before: files,
					after: result.history.after,
					operations: result.evidence,
					readerRoles: context.readerRoles === true,
					...(inverse
						? {
								restore: {
									identity: inverse.history.identity,
									written: inverse.identity,
									mapping: inverse.inverse.mapping,
								},
							}
						: {}),
				}),
				planned: serializeIdentity({
					identity: result.identity,
					before: result.history.before,
					after: result.history.after,
					operations: result.evidence,
				}),
				identity: structuredClone(result.identity),
				descriptors: planned.descriptors,
				recordedTargets: planned.recordedTargets,
			});
		}
		return result;
	} catch (error) {
		if (!(error instanceof Refused) && !(error instanceof InlineRefusal)) throw error;
		return {
			ok: false,
			transactionId: request.transactionId,
			code: error.code,
			message: { key: ["op", error.code].join(".") as `op.${string}`, params: {} },
			...(error.target
				? {
						file: error.target.file,
						...(error.target.ref.kind === "node" && error.target.ref.nodeId
							? { member: error.target.ref.nodeId }
							: {}),
					}
				: {}),
		};
	}
}
function apply(
	files: readonly OperationSourceFile[],
	request: OperationRequest,
	context: OperationContext,
): { operation: AppliedOperation; descriptors: CanonicalDescriptor[]; recordedTargets: string[] } {
	const states = new Map<string, State>();
	const inlineDocuments = new Map<string, ParsedDocument>();
	if (
		!request.targets.length ||
		new Set(request.files.map((f) => f.path)).size !== request.files.length ||
		new Set(files.map((f) => f.path)).size !== files.length
	)
		return refuse("invalid-args");
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
	for (const base of request.files) {
		const file = files.find((f) => f.path === base.path);
		if (!file || context.digest(file.source) !== base.baseRevision) return refuse("stale");
		const head = context.identity.heads.find((h) => h.path === base.path);
		if (identityPlan.sourceHash(head?.head) !== base.baseRevision) return refuse("stale");
		const document = parse(file);
		states.set(base.path, {
			file,
			document,
			nodes: locateTree(document.tree),
			edits: [],
			targets: [],
		});
	}
	for (const target of request.targets)
		if (!states.has(target.file)) return refuse("invalid-args", target);
	if (request.operation !== "editInline" && request.targets.some((t) => t.inline !== undefined))
		return refuse("invalid-args");
	const targets = request.targets
		.filter((t) => t.ref.kind === "node")
		.map((target) => resolveNode(target, states.get(target.file) as State, context));
	for (const target of targets) {
		if (
			["lesson", "frontmatter"].includes(target.entry.node.kind) ||
			(target.entry.node.kind === "page" &&
				!["movePage", "setPageTitle", "setText", "mergePage", "deletePage", "editInline"].includes(
					request.operation,
				))
		)
			return refuse("not-allowed", target.target);
		if (
			targets.some(
				(other) =>
					other !== target &&
					other.state === target.state &&
					request.operation !== "editInline" &&
					below(target.entry.path, other.entry.path),
			)
		)
			return refuse("invalid-args", target.target);
		target.state.targets.push(target.entry);
	}
	let intent: OperationIntent;
	const roots: RootPlacement[] = [];
	let preservesTextStructure = false;
	const removed = new Set<string>();
	const cutIds = new Set<string>();
	let clipboard = context.clipboard ?? null;
	let clipboardText: string | undefined;
	let pastedCount: number | undefined;
	let inlineCount: number | undefined;
	let retiredCuts = 0;
	const absorbed = new Map<string, string>();
	const conversionLosses = new Set<string>();
	let losesAnswers = false;
	const args = request.args;
	let splitTarget: ResolvedTarget | undefined;
	const one = () =>
		targets.length === 1 && request.targets.length === 1 ? targets[0] : refuse("invalid-args");
	const allowed = Object.hasOwn(operationRegistry, request.operation)
		? operationRegistry[request.operation]
		: undefined;
	if (!allowed || Object.keys(args).some((key) => !allowed.includes(key)))
		return refuse("invalid-args");
	// Lookup names are vocabulary, unlike free author text. Validate even when a
	// supplied text replacement means this adapter would otherwise ignore type.
	for (const key of ["name", "field", "type", "direction", "position", "rename"])
		if (typeof args[key] === "string" && Object.hasOwn(Object.prototype, args[key]))
			return refuse("invalid-args");
	for (const key of ["text", "type", "direction", "name", "field", "position", "title"]) {
		if (args[key] !== undefined && typeof args[key] !== "string") return refuse("invalid-args");
	}
	if (typeof args.title === "string" && (!args.title.trim() || /[\r\n{}]/u.test(args.title)))
		return refuse("invalid-args");
	if (args.unwrap !== undefined && typeof args.unwrap !== "boolean") return refuse("invalid-args");
	const mappedId = (state: State, entry: LocatedNode) =>
		context.identity.sourceMappings.find(
			(m) => m.file === state.file.path && samePath(m.path, entry.path),
		)?.id ?? refuse("orphaned");
	const retire = (state: State, entry: LocatedNode) => {
		const id = mappedId(state, entry);
		if (!roots.some((r) => r.oldId === id && r.fate === "kept")) removed.add(id);
	};
	const movedInto = (state: State, owner: LocatedNode, id?: string) =>
		roots.filter(
			(r) =>
				r.file === state.file.path &&
				r.insert &&
				r.oldId &&
				(!id || r.oldId === id) &&
				r.insert.start >= (owner.node.header?.end ?? owner.node.span.start) &&
				r.insert.start <= (owner.node.closer?.start ?? owner.node.span.end) &&
				context.identity.sourceMappings.some(
					(m) =>
						m.id === r.oldId &&
						state.nodes.some((n) => samePath(n.path, m.path) && n.node.kind === "item"),
				),
		);
	const itemOwner = (target: ResolvedTarget) => {
		const owner = target.entry.node.kind === "item" ? target.entry.parent : target.entry;
		if (!owner || !getDefinition(owner.node.type ?? "")?.items)
			return refuse("not-allowed", target.target);
		return owner;
	};
	const keepRoot = (state: State, entry: LocatedNode) => {
		const span = translateRange(entry.node.span.start, entry.node.span.end, state.edits);
		if (span)
			roots.push({
				file: state.file.path,
				oldId: mappedId(state, entry),
				start: span.start,
				resolvedStart: span.start,
				fate: "kept",
				preserveDescendants: true,
			});
	};
	const unwrap = (state: State, owner: LocatedNode) => {
		state.targets.push(owner);
		retire(state, owner);
		for (const span of [owner.node.header, owner.node.closer])
			if (span) state.edits.push({ start: span.start, end: span.end, text: "" });
		let first = true;
		for (const entry of state.nodes.filter((n) => n.parent === owner && n.node.kind === "item")) {
			retire(state, entry);
			const header = entry.node.header;
			if (header && !state.edits.some((e) => e.start <= header.start && e.end >= header.end)) {
				state.edits.push({
					start: header.start,
					end: header.end,
					text: first ? "" : (findLineEnding(state.file.source) ?? "\n"),
				});
				first = false;
			}
		}
	};

	const endCut = () => {
		if (!clipboard) return;
		if (!states.has(clipboard.file)) return refuse("invalid-args");
		retiredCuts = clipboard.nodeIds.length;
		for (const id of clipboard.nodeIds) removed.add(id);
		clipboard = null;
	};
	if (["cutBlocks", "copyBlocks", "discardCut"].includes(request.operation)) endCut();
	switch (request.operation) {
		case "editInline": {
			intent = "modify";
			if (targets.length !== request.targets.length) return refuse("invalid-args");
			const inline = planInlineEdits(
				[...states.values()].map((s) => ({ path: s.file.path, tree: s.document.tree })),
				targets.map((t) => ({
					target: t.target,
					start: t.entry.node.span.start,
					end: t.entry.node.span.end,
				})),
				args,
			);
			const plans = inline.plans;
			for (const document of inline.documents) inlineDocuments.set(document.path, document);
			inlineCount = plans.length;
			// Glossary scope is the complete course, with a base guard for every lesson.
			if (
				plans.some((p) => p.token.kind === "term") &&
				context.identity.heads.some((h) => !states.has(h.path))
			)
				return refuse("invalid-args");
			const touched = new Set<string>();
			for (const plan of plans) {
				const state = states.get(plan.file);
				if (!state) return refuse("invalid-args");
				const entry = state.nodes
					.filter((n) => n.node.span.start <= plan.token.start && n.node.span.end >= plan.token.end)
					.sort(
						(a, b) =>
							a.node.span.end - a.node.span.start - (b.node.span.end - b.node.span.start) ||
							b.path.length - a.path.length,
					)[0];
				if (!entry) return refuse("orphaned");
				const id = mappedId(state, entry);
				const sourceMap = context.identity.sourceMappings.find((m) => m.id === id);
				if (!sourceMap) return refuse("orphaned", plan.target);
				state.edits.push(...plan.edits);
				if (touched.has(id)) continue;
				touched.add(id);
				state.targets.push(entry);
				if (!targets.some((t) => t.id === id))
					targets.push(
						resolveNode(
							{
								file: plan.file,
								ref: {
									kind: "node",
									nodeId: id,
									path: entry.path,
									fingerprint: sourceMap.fingerprint,
								},
								expectedText: entry.node.raw,
							},
							state,
							context,
						),
					);
				roots.push({ file: plan.file, oldId: id, start: entry.node.span.start, fate: "kept" });
			}
			break;
		}
		case "turnInto": {
			intent = "convert";
			if (targets.length !== request.targets.length) return refuse("invalid-args");
			const type = textArg(args, "type");
			for (const target of targets) {
				const declaration = TURN_INTO[schemaType(target.entry)]?.find((d) => d.target === type);
				if (!declaration) return refuse("not-allowed", target.target);
				if (type === "page") {
					if (target.entry.parent?.node.kind !== "page")
						return refuse("not-allowed", target.target);
					if (!args.title) return refuse("invalid-args", target.target);
					// A page break authorizes the following siblings' new owner, without editing their bytes.
					target.state.targets.push(
						...target.state.nodes.filter(
							(n) =>
								n.parent === target.entry.parent &&
								n.node.span.start > target.entry.node.span.start,
						),
					);
				}
				target.state.edits.push(
					...conversionEdits(
						target.state.file.source,
						target.entry.node,
						declaration,
						args.title as string | undefined,
					),
				);
				roots.push({
					file: target.target.file,
					oldId: target.id,
					start: target.entry.node.span.start,
					fate: "kept",
				});
				for (const loss of declaration.losses) conversionLosses.add(loss);
				losesAnswers ||= declaration.losesAnswers;
			}
			break;
		}
		case "replaceBlock": {
			intent = "replace";
			const target = one();
			const text =
				typeof args.text === "string"
					? args.text
					: getDefinition(textArg(args, "type"))?.insertTemplate;
			if (!text?.trim()) return refuse("invalid-args", target.target);
			const raw = replacementText(text, findLineEnding(target.state.file.source) ?? "\n");
			if (raw === null) return refuse("escapes-range", target.target);
			const prefix = "# _\n";
			const next = parse({ path: target.target.file, source: `${prefix}${raw}` }).tree.root
				.children[0].children[0];
			const closer = target.entry.node.closer && next.closer;
			const edit = {
				start: target.entry.node.span.start,
				end: closer ? draftRange(target.entry.node).end : target.entry.node.span.end,
				text: closer ? raw.slice(0, closer.start - prefix.length) : raw,
			};
			target.state.edits.push(edit);
			removed.add(target.id);
			roots.push({
				file: target.target.file,
				oldId: null,
				start: edit.start,
				insert: edit,
				fate: "new",
			});
			break;
		}
		case "wrapIn": {
			intent = "modify";
			if (args.unwrap === true) {
				const target = one();
				const type = nodeType(target.entry);
				if (!Object.values(WRAP_IN).some((types) => types.includes(type)))
					return refuse("not-allowed", target.target);
				retire(target.state, target.entry);
				for (const span of [target.entry.node.header, target.entry.node.closer])
					if (span) target.state.edits.push({ start: span.start, end: span.end, text: "" });
				for (const entry of target.state.nodes.filter(
					(n) => n.parent === target.entry && n.node.kind === "item",
				)) {
					retire(target.state, entry);
					if (entry.node.header)
						target.state.edits.push({
							start: entry.node.header.start,
							end: entry.node.header.end,
							text: "",
						});
				}
				for (const entry of target.state.nodes.filter(
					(n) =>
						(n.parent === target.entry && n.node.kind !== "item") ||
						(n.parent?.parent === target.entry && n.parent.node.kind === "item"),
				))
					keepRoot(target.state, entry);
				break;
			}
			if (
				targets.length !== request.targets.length ||
				new Set(targets.map((t) => t.state)).size !== 1
			)
				return refuse("invalid-args");
			const type = textArg(args, "type");
			const ordered = [...targets].sort(
				(a, b) => a.entry.node.span.start - b.entry.node.span.start,
			);
			const state = ordered[0].state;
			const parent = ordered[0].entry.parent;
			const definition = getDefinition(type);
			const children = definition?.items
				? definition.itemDefinition?.allowedChildren
				: definition?.allowedChildren;
			for (const [i, target] of ordered.entries()) {
				if (
					!WRAP_IN[schemaType(target.entry)]?.includes(type) ||
					target.entry.parent !== parent ||
					!children?.includes(target.entry.node.kind) ||
					(i > 0 &&
						parent?.node.children.indexOf(target.entry.node) !==
							(parent?.node.children.indexOf(ordered[i - 1].entry.node) ?? -2) + 1)
				)
					return refuse("not-allowed", target.target);
			}
			const eol = findLineEnding(state.file.source) ?? "\n";
			const subject = args.title ? ` ${args.title}` : "";
			let text = `::: ${type}${subject}${eol}`;
			const offsets: number[] = [];
			for (const [i, target] of ordered.entries()) {
				if (i)
					text += state.file.source.slice(
						ordered[i - 1].entry.node.span.end,
						target.entry.node.span.start,
					);
				if (definition?.items) text += `:: ${i + 1}${eol}`;
				offsets.push(text.length);
				text += target.entry.node.raw;
				if (!/[\r\n]$/u.test(text)) text += eol;
			}
			text += `:::${eol}`;
			if (replacementText(text, eol) === null) return refuse("not-allowed", ordered[0].target);
			const edit = {
				start: ordered[0].entry.node.span.start,
				end: (ordered.at(-1) as ResolvedTarget).entry.node.span.end,
				text,
			};
			state.edits.push(edit);
			ordered.forEach((t, i) =>
				roots.push({
					file: state.file.path,
					oldId: t.id,
					start: edit.start + offsets[i],
					insert: edit,
					fate: "kept",
					preserveDescendants: true,
				}),
			);
			roots.push({
				file: state.file.path,
				oldId: null,
				start: edit.start,
				insert: edit,
				fate: "new",
			});
			break;
		}
		case "mergeBlocks": {
			intent = "merge";
			if (
				targets.length < 2 ||
				targets.length !== request.targets.length ||
				new Set(targets.map((t) => t.state)).size !== 1
			)
				return refuse("invalid-args");
			const ordered = [...targets].sort(
				(a, b) => a.entry.node.span.start - b.entry.node.span.start,
			);
			const first = ordered[0];
			if (first.entry.node.kind !== "body") return refuse("not-allowed", first.target);
			for (const [i, target] of ordered.entries()) {
				if (
					target.entry.node.kind !== "body" ||
					target.entry.parent !== first.entry.parent ||
					(i &&
						target.entry.parent?.node.children.indexOf(target.entry.node) !==
							(target.entry.parent?.node.children.indexOf(ordered[i - 1].entry.node) ?? -2) + 1)
				)
					return refuse("not-allowed", target.target);
				if (
					target.state.document.tree.stream.lines.some(
						(line) =>
							line.start >= target.entry.node.span.start &&
							line.start < target.entry.node.span.end &&
							["code", "code-fence", "math", "math-fence", "quote"].includes(line.kind),
					)
				)
					return refuse("not-allowed", target.target);
				if (i) {
					first.state.edits.push({
						start: ordered[i - 1].entry.node.span.end,
						end: target.entry.node.span.start,
						text: "",
					});
					absorbed.set(target.id, first.id);
				}
			}
			roots.push({
				file: first.target.file,
				oldId: first.id,
				start: first.entry.node.span.start,
				fate: "survivor",
			});
			break;
		}
		case "copyBlocks": {
			intent = "copy";
			if (
				targets.length !== request.targets.length ||
				new Set(targets.map((t) => t.target.file)).size !== 1
			)
				return refuse("invalid-args");
			clipboardText = [...targets]
				.sort((a, b) => a.entry.node.span.start - b.entry.node.span.start)
				.map((t) => t.entry.node.raw)
				.join("\n");
			break;
		}
		case "discardCut":
			intent = "delete";
			break;
		case "setPageTitle": {
			intent = "modify";
			const target = one();
			if (target.entry.node.kind !== "page" || !target.entry.node.subject)
				return refuse("not-allowed");
			const text = textArg(args, "title");
			if (!text.trim() || /[\r\n]/u.test(text)) return refuse("invalid-args");
			target.state.edits.push({ ...target.entry.node.subject.span, text });
			roots.push({
				file: target.target.file,
				oldId: target.id,
				start: target.entry.node.span.start,
				fate: "kept",
				preserveDescendants: true,
			});
			break;
		}
		case "mergePage": {
			intent = "merge";
			const target = one();
			if (target.entry.node.kind !== "page") return refuse("not-allowed");
			const pages = target.entry.parent?.node.children.filter((n) => n.kind === "page") ?? [];
			const previous = pages[pages.indexOf(target.entry.node) - 1];
			const entry = target.state.nodes.find((n) => n.node === previous);
			if (!entry || !target.entry.node.header) return refuse("not-allowed");
			target.state.targets.push(entry);
			const eol = findLineEnding(target.state.file.source) ?? "\n";
			const separated =
				/(?:\r?\n){2}$/u.test(target.state.file.source.slice(0, target.entry.node.header.start)) ||
				/^(?:\r?\n)/u.test(target.state.file.source.slice(target.entry.node.header.end));
			target.state.edits.push({
				...target.entry.node.header,
				text: separated || !previous.children.length ? "" : eol,
			});
			absorbed.set(target.id, mappedId(target.state, entry));
			roots.push({
				file: target.target.file,
				oldId: mappedId(target.state, entry),
				start: entry.node.span.start,
				fate: "survivor",
			});
			for (const child of target.state.nodes.filter((n) => n.parent === target.entry))
				keepRoot(target.state, child);
			break;
		}
		case "addItem": {
			intent = "insert";
			const target = one();
			const owner = itemOwner(target);
			const text = textArg(args, "text");
			if (!/^::(?:[ \t]|\r?\n|$)/u.test(text)) return refuse("invalid-args", target.target);
			if (args.position !== undefined && args.position !== "before" && args.position !== "after")
				return refuse("invalid-args", target.target);
			// An untouched item insertion draft writes nothing, including in an invalid empty container.
			if (/^::[ \t]*$/u.test(text)) break;
			const draft = parse({
				path: target.target.file,
				source: `# Draft\n::: ${owner.node.type}\n${text}\n:::\n`,
			});
			const page = draft.tree.root.children[0];
			const container = page?.children[0];
			if (
				draft.tree.root.children.length !== 1 ||
				page?.children.length !== 1 ||
				container?.type !== owner.node.type ||
				container.children.filter((n) => n.kind === "item").length !== 1 ||
				container.closer?.end !== draft.tree.stream.source.length
			)
				return refuse("escapes-range", target.target);
			const count = owner.node.children.filter((n) => n.kind === "item").length;
			const max = getDefinition(owner.node.type ?? "")?.childCounts.find(
				(c) => c.kind === "item",
			)?.max;
			if (max !== undefined && count >= max) return refuse("not-allowed", target.target);
			const offset =
				target.entry === owner
					? args.position === "before"
						? owner.node.header?.end
						: owner.node.closer?.start
					: args.position === "before"
						? target.entry.node.span.start
						: target.entry.node.span.end;
			if (offset === undefined) return refuse("not-allowed", target.target);
			const added = insertion(target.state, offset, text);
			roots.push({
				file: target.target.file,
				oldId: null,
				start: offset + added.rootOffset,
				insert: added.edit,
				fate: "new",
			});
			roots.push({
				file: target.target.file,
				oldId: mappedId(target.state, owner),
				start: owner.node.span.start,
				fate: "kept",
			});
			break;
		}
		case "removeItem": {
			intent = "delete";
			const target = one();
			if (target.entry.node.kind !== "item") return refuse("not-allowed", target.target);
			itemOwner(target);
			target.state.edits.push({ ...deletionRange(target.entry), text: "" });
			removed.add(target.id);
			break;
		}
		case "wrapInColumns": {
			intent = "modify";
			if (
				targets.length !== request.targets.length ||
				new Set(targets.map((t) => t.state)).size !== 1
			)
				return refuse("invalid-args");
			const ordered = [...targets].sort(
				(a, b) => a.entry.node.span.start - b.entry.node.span.start,
			);
			const state = ordered[0].state;
			const parent = ordered[0].entry.parent;
			const allowedChildren = getDefinition("columns")?.itemDefinition?.allowedChildren ?? [];
			const max = getDefinition("columns")?.childCounts.find((c) => c.kind === "item")?.max;
			if (
				(max !== undefined && Math.max(2, ordered.length) > max) ||
				ordered.some(
					(t, i) =>
						t.entry.parent !== parent ||
						!allowedChildren.includes(t.entry.node.kind) ||
						(i > 0 &&
							parent?.node.children.indexOf(t.entry.node) !==
								(parent?.node.children.indexOf(ordered[i - 1].entry.node) ?? -2) + 1),
				)
			)
				return refuse("not-allowed");
			const eol = findLineEnding(state.file.source) ?? "\n";
			let text = `::: columns${eol}`;
			const offsets: number[] = [];
			for (const [index, target] of ordered.entries()) {
				if (index)
					text += state.file.source.slice(
						ordered[index - 1].entry.node.span.end,
						target.entry.node.span.start,
					);
				text += `:: {weight=1}${eol}`;
				offsets.push(text.length);
				text += target.entry.node.raw;
				if (!/[\r\n]$/u.test(text)) text += eol;
			}
			if (ordered.length === 1) text += `:: {weight=1}${eol}`;
			text += `:::${eol}`;
			const edit = {
				start: ordered[0].entry.node.span.start,
				end: (ordered.at(-1) as ResolvedTarget).entry.node.span.end,
				text,
			};
			state.edits.push(edit);
			ordered.forEach((t, i) =>
				roots.push({
					file: state.file.path,
					oldId: t.id,
					start: edit.start + offsets[i],
					insert: edit,
					fate: "kept",
					preserveDescendants: true,
				}),
			);
			roots.push({
				file: state.file.path,
				oldId: null,
				start: edit.start,
				insert: edit,
				fate: "new",
			});
			break;
		}
		case "unwrapColumns": {
			intent = "modify";
			const target = one();
			if (target.entry.node.type !== "columns") return refuse("not-allowed", target.target);
			unwrap(target.state, target.entry);
			for (const entry of target.state.nodes.filter((n) => n.parent?.parent === target.entry))
				keepRoot(target.state, entry);
			break;
		}
		case "setColumnWeights": {
			intent = "modify";
			const target = one();
			if (target.entry.node.type !== "columns") return refuse("not-allowed", target.target);
			const items = target.state.nodes.filter(
				(n) => n.parent === target.entry && n.node.kind === "item",
			);
			const weights = args.weights;
			if (
				!Array.isArray(weights) ||
				weights.length !== items.length ||
				!weights.length ||
				weights.some((w) => !Number.isSafeInteger(w) || w <= 0)
			)
				return refuse("invalid-args", target.target);
			const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
			const divisor = weights.reduce(gcd);
			items.forEach((entry, i) => {
				const edit = propertyEdit(
					{ ...target, entry, id: mappedId(target.state, entry) },
					{ name: "weight", value: weights[i] / divisor },
				);
				if (edit) target.state.edits.push(edit);
				roots.push({
					file: target.target.file,
					oldId: mappedId(target.state, entry),
					start: entry.node.span.start,
					fate: "kept",
				});
			});
			roots.push({
				file: target.target.file,
				oldId: target.id,
				start: target.entry.node.span.start,
				fate: "kept",
			});
			break;
		}
		case "editSource": {
			const target = one();
			let text = preserveLineEndings(textArg(args, "text"), target.state.file.source);
			if (!text.trim()) {
				intent = "delete";
				target.state.edits.push({ ...deletionRange(target.entry), text: "" });
				removed.add(target.id);
			} else {
				intent = "modify";
				const range = draftRange(target.entry.node);
				if (
					!/[\r\n]$/u.test(text) &&
					(target.entry.node.closer || range.end < target.state.file.source.length)
				)
					text += findLineEnding(target.state.file.source) ?? "\n";
				const edit = minimalEdit(target.state.file.source, { ...range, text });
				if (edit) target.state.edits.push(edit);
				splitTarget = target;
			}
			break;
		}
		case "setProperty": {
			intent = "modify";
			const target = one();
			const edit = propertyEdit(target, args);
			if (edit) target.state.edits.push(edit);
			roots.push({
				file: target.target.file,
				oldId: target.id,
				start: target.entry.node.span.start,
				fate: "kept",
			});
			break;
		}
		case "setText": {
			intent = "modify";
			const target = one();
			const field = textArg(args, "field");
			if (!["subject", "value", "text", "answer", "alt", "source", "speaker"].includes(field))
				return refuse("invalid-args");
			const value =
				target.entry.node[field as "subject"] ??
				(field === "text" && target.entry.node.kind === "body"
					? textField(target.entry.node, target.state.document.tree.stream)
					: undefined);
			if (!value) return refuse("not-allowed", target.target);
			const range =
				"span" in value
					? value.span
					: (value as unknown as { range: { start: number; end: number } }).range;
			const text = preserveLineEndings(textArg(args, "text"), target.state.file.source);
			const descriptor = canvasTextDescriptor(target.entry.node);
			let replacement = text;
			// Ordinary setText retains insertion into empty parts and caption clearing.
			// Canvas admission separately refuses empty text before applying the operation.
			const emptyPart =
				target.entry.node.kind === "part" &&
				(range.start === range.end || (target.entry.node.name === "caption" && text === ""));
			if (descriptor && field === descriptor.field && !emptyPart) {
				const admitted = textField(target.entry.node, target.state.document.tree.stream);
				if (!admitted) return refuse("not-allowed", target.target);
				replacement = preserveTextWraps(
					textArg(args, "text"),
					admitted.text,
					target.state.file.source,
				);
				replacement = canvasTextReplacement(descriptor.field, replacement);
				const invalid = canvasTextRefusal(
					target.state.file.source,
					target.entry.node,
					undefined,
					replacement,
				);
				if (invalid) return refuse(invalid, target.target);
				preservesTextStructure = true;
			} else if (/\r|\n/u.test(text)) return refuse("invalid-args");
			target.state.edits.push({ start: range.start, end: range.end, text: replacement });
			roots.push({
				file: target.target.file,
				oldId: target.id,
				start: target.entry.node.span.start,
				fate: "kept",
				path: preservesTextStructure ? target.entry.path : undefined,
				preserveDescendants: target.entry.node.kind === "page",
			});
			break;
		}
		case "cutBlocks":
		case "deletePage":
		case "deleteBlocks":
			intent = "delete";
			if (targets.length !== request.targets.length) return refuse("invalid-args");
			for (const target of targets) {
				target.state.edits.push({ ...deletionRange(target.entry), text: "" });
				removed.add(target.id);
				if (request.operation === "cutBlocks") cutIds.add(target.id);
				if (request.operation === "deletePage" && target.entry.node.kind !== "page")
					return refuse("not-allowed");
			}
			if (request.operation === "cutBlocks") {
				if (
					new Set(targets.map((t) => t.target.file)).size !== 1 ||
					targets.some(
						(t) => !(getDefinition("page")?.allowedChildren ?? []).includes(t.entry.node.kind),
					) ||
					new Set(targets.map((t) => t.entry.path[0])).size !== 1
				)
					return refuse("not-allowed");
				const ordered = [...targets].sort(
					(a, b) => a.entry.node.span.start - b.entry.node.span.start,
				);
				clipboard = {
					file: ordered[0].target.file,
					text: ordered.map((t) => t.entry.node.raw).join("\n"),
					nodeIds: ordered.map((t) => t.id),
					nodes: context.identity.sourceMappings.filter((m) =>
						ordered.some((t) => m.file === t.target.file && below(m.path, t.entry.path)),
					),
				};
				clipboardText = clipboard.text;
			}
			break;
		case "insertPage":
		case "pasteBlocks":
		case "insertBlock": {
			intent = "insert";
			if (request.targets.length !== 1 || targets.length) return refuse("invalid-args");
			const target = request.targets[0];
			const state = states.get(target.file) as State;
			const point = resolveBoundary(target, state, context);
			const text =
				request.operation === "insertPage"
					? `# ${textArg(args, "title")}\n`
					: typeof args.text === "string"
						? args.text
						: getDefinition(textArg(args, "type"))?.insertTemplate;
			if (!text?.trim()) return refuse("invalid-args");
			if (request.operation === "insertPage") {
				if (
					point.parent.node.kind !== "lesson" ||
					!String(args.title).trim() ||
					/[\r\n]/u.test(String(args.title))
				)
					return refuse("not-allowed");
			} else if (point.parent.node.kind === "lesson") return refuse("not-allowed");
			if (request.operation === "pasteBlocks") {
				const fragment = parse({ path: target.file, source: `# Fragment\n${text}` });
				if (
					fragment.tree.root.children.length !== 1 ||
					fragment.tree.diagnostics.some((d) => d.severity === "error")
				)
					return refuse("escapes-range");
				const descriptors = describeDocument(fragment).filter((d) => d.path.length === 2);
				pastedCount = descriptors.length;
				if (!descriptors.length) return refuse("invalid-args");
				const definition = definitionOf(
					point.parent.node,
					point.parent.parent?.node,
					getDefinition,
				);
				const children = fragment.tree.root.children[0].children;
				if (
					definition &&
					children.some((child) => !definition.allowedChildren.includes(child.kind))
				)
					return refuse("not-allowed", target);
				const moving = clipboard?.text === text;
				if (moving && clipboard) {
					if (!states.has(clipboard.file)) return refuse("invalid-args");
					if (
						descriptors.length !== clipboard.nodeIds.length ||
						new Set(clipboard.nodeIds).size !== clipboard.nodeIds.length
					)
						return refuse("conflict");
					for (const [i, d] of descriptors.entries()) {
						const id = clipboard.nodeIds[i];
						const node = context.identity.snapshots.find((s) => s.nodes[id])?.nodes[id];
						if (
							!node ||
							node.canonical !== d.canonical ||
							node.revision !== context.digest(d.revisionContent)
						)
							return refuse("conflict");
					}
					if (
						clipboard.nodeIds.some(
							(id) => !context.identity.snapshots.some((s) => s.nodes[id]?.status === "cut"),
						)
					)
						return refuse("conflict");
				}
				intent = moving ? "move" : "copy";
				const added = insertion(state, point.offset, text, true);
				descriptors.forEach((d, i) =>
					roots.push({
						file: target.file,
						oldId: moving ? (clipboard?.nodeIds[i] ?? null) : null,
						start: point.offset + added.rootOffset + d.span.start - "# Fragment\n".length,
						insert: added.edit,
						fate: moving ? "kept" : "new",
						preserveDescendants: moving,
					}),
				);
				if (moving) clipboard = null;
				break;
			}
			const added = insertion(state, point.offset, text);
			roots.push({
				file: target.file,
				oldId: null,
				start: point.offset + added.rootOffset,
				insert: added.edit,
				fate: "new",
			});
			break;
		}
		case "duplicateBlocks": {
			intent = "copy";
			if (targets.length !== request.targets.length) return refuse("invalid-args");
			for (const target of targets) {
				const added = insertion(
					target.state,
					target.entry.node.span.end,
					target.entry.node.raw,
					true,
				);
				roots.push({
					file: target.target.file,
					oldId: target.id,
					start: target.entry.node.span.end + added.rootOffset,
					insert: added.edit,
					fate: "copied",
				});
			}
			break;
		}
		case "movePage":
		case "moveItem":
		case "moveBlocks": {
			intent = "move";
			if (!targets.length || new Set(targets.map((t) => t.target.file)).size !== 1)
				return refuse("invalid-args");
			const ordered = [...targets].sort(
				(a, b) => a.entry.node.span.start - b.entry.node.span.start,
			);
			const state = ordered[0].state;
			if (
				request.operation === "moveItem" &&
				(ordered.length !== 1 || ordered[0].entry.node.kind !== "item")
			)
				return refuse("not-allowed", ordered[0].target);
			let offset: number;
			let destination = state;
			if (request.operation === "movePage" && ordered.some((t) => t.entry.node.kind !== "page"))
				return refuse("not-allowed");
			const pointTarget = request.targets.find((t) => t.ref.kind === "insertion");
			if (pointTarget) {
				if (
					(request.operation === "moveItem" && pointTarget.file !== state.file.path) ||
					args.direction !== undefined
				)
					return refuse("invalid-args");
				destination = states.get(pointTarget.file) as State;
				const point = resolveBoundary(pointTarget, destination, context);
				if ((request.operation === "movePage") !== (point.parent.node.kind === "lesson"))
					return refuse("not-allowed");
				if (request.targets.length !== targets.length + 1) return refuse("invalid-args");
				if (request.operation === "moveItem" && !getDefinition(point.parent.node.type ?? "")?.items)
					return refuse("not-allowed", pointTarget);
				if (request.operation === "moveItem") {
					const definition = getDefinition(point.parent.node.type ?? "");
					const max = definition?.childCounts.find((c) => c.kind === "item")?.max;
					if (
						max !== undefined &&
						point.parent !== ordered[0].entry.parent &&
						point.parent.node.children.filter((n) => n.kind === "item").length >= max
					)
						return refuse("not-allowed", pointTarget);
				} else {
					const definition = definitionOf(
						point.parent.node,
						point.parent.parent?.node,
						getDefinition,
					);
					if (
						definition &&
						ordered.some((t) => !definition.allowedChildren.includes(t.entry.node.kind))
					)
						return refuse("not-allowed", pointTarget);
				}
				offset = point.offset;
			} else {
				if (targets.length !== request.targets.length) return refuse("invalid-args");
				const direction = textArg(args, "direction");
				if (direction !== "up" && direction !== "down") return refuse("invalid-args");
				const first = ordered[0].entry;
				const last = ordered.at(-1)?.entry as LocatedNode;
				if (ordered.some((t) => t.entry.parent !== first.parent)) return refuse("invalid-args");
				const siblings = (first.parent?.node.children ?? []).filter(
					(n) => request.operation !== "movePage" || n.kind === "page",
				);
				const neighbour =
					direction === "up"
						? siblings[siblings.indexOf(first.node) - 1]
						: siblings[siblings.indexOf(last.node) + 1];
				if (neighbour) offset = direction === "up" ? neighbour.span.start : neighbour.span.end;
				else {
					if (request.operation === "moveItem" || request.operation === "movePage")
						return refuse("not-allowed", ordered[0].target);
					let owner = first.parent;
					if (owner?.node.kind === "item") owner = owner.parent;
					if (!owner || owner.node.kind === "page") return refuse("not-allowed");
					offset = direction === "up" ? owner.node.span.start : owner.node.span.end;
				}
			}
			if (
				destination === state &&
				ordered.some((t) => offset >= t.entry.node.span.start && offset <= t.entry.node.span.end)
			)
				return refuse("not-allowed");
			let body = "";
			const rootOffsets: number[] = [];
			for (const target of ordered) {
				rootOffsets.push(body.length);
				body += target.entry.node.raw;
				if (!/[\r\n]$/u.test(body)) body += findLineEnding(state.file.source) ?? "\n";
				body += findLineEnding(state.file.source) ?? "\n";
				state.edits.push({
					start: target.entry.node.span.start,
					end: target.entry.node.span.end,
					text: "",
				});
			}
			const added = insertion(destination, offset, body, true);
			ordered.forEach((target, index) =>
				roots.push({
					file: destination.file.path,
					oldId: target.id,
					start: offset + added.rootOffset + rootOffsets[index],
					insert: added.edit,
					fate: "kept",
					preserveDescendants: true,
				}),
			);
			break;
		}
		default:
			return refuse("invalid-args");
	}
	// Removing or moving the final child also removes its empty item owner.
	// Plan these edits against the base tree so history still has one exact inverse.
	for (const state of states.values()) {
		const covered = (entry: LocatedNode) =>
			state.edits.some(
				(e) => e.text === "" && e.start <= entry.node.span.start && e.end >= entry.node.span.end,
			);
		const deleteOwner = (owner: LocatedNode) => {
			const adjacent = deletionRange(owner);
			// A move can insert at the owner's outer boundary, inside adjacent deletion trivia.
			const range = state.edits.some(
				(e) => e.start === e.end && e.text && e.start >= adjacent.start && e.start <= adjacent.end,
			)
				? owner.node.span
				: adjacent;
			state.edits = state.edits.filter(
				(e) => (e.start === e.end && e.text) || !(e.start >= range.start && e.end <= range.end),
			);
			state.edits.push({ ...range, text: "" });
			state.targets.push(owner);
			retire(state, owner);
		};
		for (const owner of [...state.nodes]
			.reverse()
			.filter((n) => getDefinition(n.node.type ?? "")?.items && n.node.type !== "columns")) {
			const items = state.nodes.filter((n) => n.parent === owner && n.node.kind === "item");
			const leaving = items.filter(covered);
			if (!leaving.length || covered(owner)) continue;
			// A same-owner reorder removes bytes at one boundary and inserts them at another.
			const incoming = movedInto(state, owner).length;
			const remaining = items.length - leaving.length + incoming;
			const min =
				getDefinition(owner.node.type ?? "")?.childCounts.find((c) => c.kind === "item")?.min ?? 0;
			if (owner.node.type === "comparison" && remaining < min) {
				const target = targets.find((t) => t.state === state && t.entry.parent === owner);
				return refuse("not-allowed", target?.target);
			}
			if (!remaining) deleteOwner(owner);
		}
		for (const owner of [...state.nodes].reverse().filter((n) => n.node.type === "columns")) {
			if (covered(owner) || removed.has(mappedId(state, owner))) continue;
			const items = state.nodes.filter((n) => n.parent === owner && n.node.kind === "item");
			const empty = items.filter(
				(item) =>
					!movedInto(state, owner, mappedId(state, item)).length &&
					(covered(item) ||
						(item.node.children.length > 0 &&
							item.node.children.every((child) => {
								const entry = state.nodes.find((n) => n.node === child) as LocatedNode;
								return covered(entry);
							}) &&
							!state.edits.some(
								(e) =>
									e.text &&
									e.start >= (item.node.header?.end ?? item.node.span.start) &&
									e.start < item.node.span.end,
							))),
			);
			if (!empty.length) continue;
			state.targets.push(owner);
			for (const item of empty) deleteOwner(item);
			const remaining = items.filter((item) => !empty.includes(item));
			if (!remaining.length) deleteOwner(owner);
			else if (remaining.length === 1) {
				unwrap(state, owner);
				state.edits.sort((a, b) => a.start - b.start);
				for (const entry of state.nodes.filter((n) => n.parent === remaining[0]))
					keepRoot(state, entry);
			}
		}
	}
	const documents: ParsedDocument[] = [];
	for (const state of states.values()) {
		for (const root of roots.filter(
			(r) => r.file === state.file.path && r.resolvedStart === undefined,
		)) {
			const boundary = root.insert?.start ?? root.start;
			root.resolvedStart =
				root.start +
				state.edits
					.filter((e) => e.start < boundary && e.end <= boundary)
					.reduce((sum, e) => sum + e.text.length - (e.end - e.start), 0);
		}
		state.edits.sort((a, b) => a.start - b.start || a.end - b.end);
		const merged: SourceEdit[] = [];
		for (const edit of state.edits) {
			const previous = merged.at(-1);
			if (previous && edit.start <= previous.end && !previous.text && !edit.text)
				previous.end = Math.max(previous.end, edit.end);
			else if (previous && edit.start === previous.end) {
				previous.end = edit.end;
				previous.text += edit.text;
			} else merged.push({ ...edit });
		}
		state.edits = merged;
		for (let i = 1; i < state.edits.length; i++)
			if (state.edits[i].start < state.edits[i - 1].end) return refuse("invalid-args");
		const source = applyEdits(state.file.source, state.edits);
		// Structural cleanup can extend the edits after inline policy validation.
		const inlineDocument = inlineDocuments.get(state.file.path);
		const after =
			inlineDocument?.tree.stream.source === source
				? inlineDocument
				: state.edits.length
					? parse({ path: state.file.path, source })
					: state.document;
		if (escapes(state.document.tree, after.tree, state.edits, state.targets))
			return refuse(
				"escapes-range",
				request.targets.find((t) => t.file === state.file.path),
			);
		documents.push(after);
	}
	for (const head of context.identity.heads.filter((h) => !states.has(h.path))) {
		const file = files.find((f) => f.path === head.path);
		// An opaque lesson has no admitted source nodes; the host preserves its stored graph.
		if (!file && !context.identity.sourceMappings.some((node) => node.file === head.path)) continue;
		if (!file || identityPlan.sourceHash(head.head) !== context.digest(file.source))
			return refuse("stale");
		documents.push(parse(file));
	}
	const prepared = identityPlan.prepare(documents);
	const descriptorsFor = (document: ParsedDocument) =>
		prepared.descriptors.filter((descriptor) => descriptor.file === document.path);
	if (splitTarget) {
		const state = splitTarget.state;
		const after = documents.find((d) => d.path === state.file.path) as ParsedDocument;
		const newNodes = locateTree(after.tree);
		const parent = splitTarget.entry.parent;
		const header = parent?.node.header;
		const newParent = header
			? newNodes.find(
					(n) =>
						n.node.header?.start === translateRange(header.start, header.end, state.edits)?.start,
				)
			: newNodes[0];
		const range = draftRange(splitTarget.entry.node);
		const end =
			range.end + state.edits.reduce((sum, e) => sum + e.text.length - (e.end - e.start), 0);
		const candidates = newNodes.filter(
			(n) => n.parent === newParent && n.node.span.start >= range.start && n.node.span.start < end,
		);
		if (!candidates.length) return refuse("escapes-range", splitTarget.target);
		const invalid =
			descriptorsFor(after).some(
				(d) => !d.valid && d.span.start >= range.start && d.span.start < end,
			) ||
			after.tree.diagnostics.some(
				(d) => d.severity === "error" && d.span.start >= range.start && d.span.start < end,
			);
		let survivor = candidates[0];
		if (!invalid && candidates.length > 1) {
			intent = "split";
			const oldText =
				context.identity.snapshots
					.flatMap((s) => Object.entries(s.nodes))
					.find(([id]) => id === splitTarget.id)?.[1].matchText ?? splitTarget.entry.node.raw;
			const descriptors = descriptorsFor(after);
			let best = -1;
			for (const candidate of candidates) {
				const descriptor = descriptors.find((d) => samePath(d.path, candidate.path));
				const score = lexicalScore(oldText, descriptor?.matchText ?? candidate.node.raw);
				if (score > best) {
					best = score;
					survivor = candidate;
				}
			}
		} else if (!invalid && nodeType(survivor) !== nodeType(splitTarget.entry)) intent = "convert";
		roots.push({
			file: state.file.path,
			oldId: splitTarget.id,
			start: survivor.node.span.start,
			fate: invalid ? "pending" : intent === "split" ? "survivor" : "kept",
		});
		if (intent === "split")
			for (const candidate of candidates.filter((c) => c !== survivor)) {
				roots.push({
					file: state.file.path,
					oldId: null,
					start: candidate.node.span.start,
					fate: "new",
				});
			}
	}
	const mapping: IdentityOperation["mapping"] = [];
	const placements: IdentityOperation["placements"] = [];
	const writtenRoots: { file: string; path: readonly number[] }[] = [];
	const claimed = new Set<string>();
	const place = (
		file: string,
		path: readonly number[],
		oldId: string | null,
		fate: RootPlacement["fate"],
	) => {
		if (fate !== "copied" && oldId) claimed.add(oldId);
		placements.push({ file, path, mappingIndex: mapping.length });
		mapping.push({ oldId, newId: fate === "copied" || fate === "new" ? null : oldId, fate });
	};
	for (const root of roots) {
		const after = documents.find((d) => d.path === root.file) as ParsedDocument;
		const candidate = locateTree(after.tree).find(
			(n) =>
				n.node.span.start === (root.resolvedStart ?? root.start) &&
				(!root.path || samePath(n.path, root.path)) &&
				n.node.kind !== "lesson" &&
				(n.node.kind !== "page" ||
					[
						"turnInto",
						"movePage",
						"insertPage",
						"mergePage",
						"setPageTitle",
						"setText",
						"editInline",
					].includes(request.operation)),
		);
		if (!candidate) return refuse("escapes-range");
		place(root.file, candidate.path, root.oldId, root.fate);
		writtenRoots.push({ file: root.file, path: candidate.path });
		if ((intent === "move" || root.preserveDescendants) && root.oldId) {
			const donorMappings = context.identity.sourceMappings.some((m) => m.id === root.oldId)
				? context.identity.sourceMappings
				: (context.clipboard?.nodes ?? []);
			const oldMap = donorMappings.find((m) => m.id === root.oldId);
			if (oldMap)
				for (const old of donorMappings.filter(
					(m) => m.file === oldMap.file && below(m.path, oldMap.path) && m.id !== root.oldId,
				)) {
					const path = [...candidate.path, ...old.path.slice(oldMap.path.length)];
					if (descriptorsFor(after).some((d) => samePath(d.path, path)))
						place(root.file, path, old.id, "kept");
				}
		}
	}
	for (const id of removed) {
		mapping.push({ oldId: id, newId: null, fate: cutIds.has(id) ? "cut" : "retired" });
		claimed.add(id);
	}
	for (const [id, survivor] of absorbed) {
		mapping.push({ oldId: id, newId: survivor, fate: "absorbed" });
		claimed.add(id);
	}
	if (request.operation === "turnInto") {
		for (const target of targets) {
			if (!getDefinition(nodeType(target.entry))?.items || !getDefinition(String(args.type))?.items)
				continue;
			const after = documents.find((d) => d.path === target.target.file) as ParsedDocument;
			const root = placements.find((p) => mapping[p.mappingIndex].oldId === target.id);
			if (!root) continue;
			const items = target.state.nodes.filter(
				(n) => n.parent === target.entry && n.node.kind === "item",
			);
			const nextItems = locateTree(after.tree).filter(
				(n) => n.node.kind === "item" && n.parent && samePath(n.parent.path, root.path),
			);
			// The transformation preserves the declared item sequence; no content matching happens here.
			items.forEach((item, i) => {
				if (nextItems[i])
					place(target.target.file, nextItems[i].path, mappedId(target.state, item), "kept");
			});
		}
	}
	for (const state of states.values()) {
		const after = documents.find((d) => d.path === state.file.path) as ParsedDocument;
		const descriptors = descriptorsFor(after);
		for (const old of context.identity.sourceMappings.filter(
			(m) => m.file === state.file.path && !claimed.has(m.id),
		)) {
			if (
				targets.some((t) => removed.has(t.id) && t.state === state && below(old.path, t.entry.path))
			)
				continue;
			const range = translateRange(old.span.start, old.span.end, state.edits);
			const oldType = context.identity.snapshots
				.flatMap((s) => Object.entries(s.nodes))
				.find(([id]) => id === old.id)?.[1].type;
			let candidate =
				preservesTextStructure && state.nodes.some((entry) => samePath(entry.path, old.path))
					? descriptors.find((descriptor) => samePath(descriptor.path, old.path))
					: range
						? descriptors.find(
								(d) =>
									d.span.start === range.start && d.span.end === range.end && d.type === oldType,
							)
						: undefined;
			if (!candidate) {
				const entry = state.nodes.find((n) => samePath(n.path, old.path));
				if (entry && !targets.some((t) => t.state === state && below(entry.path, t.entry.path))) {
					const header = entry.node.header;
					const anchor = header && translateRange(header.start, header.end, state.edits);
					candidate =
						entry.node.kind === "lesson"
							? descriptors.find((d) => !d.path.length)
							: anchor
								? descriptors.find(
										(d) => d.span.start === anchor.start && d.type === nodeType(entry),
									)
								: undefined;
				}
			}
			if (
				candidate &&
				!placements.some((p) => p.file === state.file.path && samePath(p.path, candidate.path))
			)
				place(state.file.path, candidate.path, old.id, "kept");
		}
	}
	// I1 owns reconciliation, ID allocation, pending records and inverse mappings.
	const evidenceFiles = [...states.values()].map((s) => ({
		path: s.file.path,
		fromRevision: context.digest(s.file.source),
		toRevision: context.digest(
			documents.find((d) => d.path === s.file.path)?.tree.stream.source ?? "",
		),
		fromSnapshot: context.identity.heads.find((h) => h.path === s.file.path)?.head ?? "",
	}));
	// Unchanged surrounding nodes are modify evidence, separate from copy/insert/delete intent.
	const groups = new Map<OperationIntent, number[]>();
	mapping.forEach((m, index) => {
		const part =
			(m.fate === "retired" || m.fate === "cut") &&
			(intent === "copy" || intent === "insert" || intent === "move")
				? "delete"
				: m.fate === "kept" && ["copy", "insert", "delete", "replace"].includes(intent)
					? "modify"
					: intent;
		const indexes = groups.get(part) ?? [];
		indexes.push(index);
		groups.set(part, indexes);
	});
	const evidence: IdentityOperation[] = [...groups].map(([part, indexes]) => ({
		intent: part,
		files: evidenceFiles,
		mapping: indexes.map((i) => mapping[i]),
		placements: placements
			.filter((p) => indexes.includes(p.mappingIndex))
			.map((p) => ({ ...p, mappingIndex: indexes.indexOf(p.mappingIndex) })),
	}));
	const identity = prepared.resolve(evidence);
	const fileEdits = [...states.values()].map((state) => ({
		path: state.file.path,
		fromRevision: context.digest(state.file.source),
		toRevision: context.digest(applyEdits(state.file.source, state.edits)),
		edits: state.edits,
	}));
	const guards: InverseGuard[] = [];
	for (const state of states.values()) {
		const after = documents.find((d) => d.path === state.file.path) as ParsedDocument;
		const nextState = {
			...state,
			file: { path: state.file.path, source: after.tree.stream.source },
			document: after,
			nodes: locateTree(after.tree),
		};
		for (const root of writtenRoots.filter((r) => r.file === state.file.path)) {
			const placement = identity.sourceMappings.find(
				(m) => m.file === root.file && samePath(m.path, root.path),
			);
			if (placement)
				guards.push({
					kind: "written",
					file: state.file.path,
					ref: {
						kind: "node",
						nodeId: placement.id,
						path: placement.path,
						fingerprint: placement.fingerprint,
					},
					text: after.tree.stream.source.slice(placement.span.start, placement.span.end),
				});
		}
		for (const [editIndex, edit] of inverseEdits(state.file.source, state.edits).entries()) {
			if (
				(request.operation === "editSource" && intent !== "delete") ||
				request.operation === "setProperty" ||
				request.operation === "setText" ||
				request.operation === "editInline" ||
				request.operation === "setPageTitle"
			)
				continue;
			const moved =
				intent === "move" &&
				identity.sourceMappings.find(
					(node) =>
						writtenRoots.some(
							(root) => root.file === state.file.path && samePath(root.path, node.path),
						) &&
						node.file === state.file.path &&
						node.span.start >= edit.start &&
						node.span.start < edit.end,
				);
			const parentPath = moved
				? moved.path.slice(0, -1)
				: request.operation === "movePage"
					? []
					: undefined;
			const ref = boundaryAt(
				nextState,
				moved ? moved.span.start : edit.start,
				identity,
				parentPath,
			);
			const slice = (id: string | null) => {
				const map = identity.sourceMappings.find((m) => m.id === id);
				return map ? after.tree.stream.source.slice(map.span.start, map.span.end) : null;
			};
			// A moved slice has neighbours at both ends. Its written guard protects
			// the node itself; both boundaries protect the destination's neighbours.
			for (const point of moved
				? [ref, boundaryAt(nextState, moved.span.end, identity, parentPath)]
				: [ref])
				guards.push({
					kind: "insertion-boundary",
					file: state.file.path,
					ref: point,
					beforeText: slice(point.before),
					afterText: slice(point.after),
				});
			const baseEdit = state.edits[editIndex];
			for (const target of targets.filter(
				(t) =>
					t.state === state &&
					removed.has(t.id) &&
					t.entry.node.span.start >= baseEdit.start &&
					t.entry.node.span.end <= baseEdit.end,
			)) {
				for (const old of context.identity.sourceMappings.filter(
					(m) => m.file === state.file.path && below(m.path, target.entry.path),
				)) {
					guards.push({ kind: "deleted", file: state.file.path, nodeId: old.id, ref });
				}
			}
		}
		// Source replacement can retire rebuilt parts inside a surviving written root.
		for (const map of identity.mapping.filter(
			(m) => (m.fate === "retired" || m.fate === "absorbed") && m.oldId,
		)) {
			if (guards.some((g) => g.kind === "deleted" && g.nodeId === map.oldId)) continue;
			const old = context.identity.sourceMappings.find(
				(m) => m.file === state.file.path && m.id === map.oldId,
			);
			if (!old) continue;
			const owner = targets.find((t) => t.state === state && below(old.path, t.entry.path));
			const written =
				owner &&
				identity.sourceMappings.find(
					(m) => m.file === state.file.path && m.id === (absorbed.get(owner.id) ?? owner.id),
				);
			if (written)
				guards.push({
					kind: "deleted",
					file: state.file.path,
					nodeId: map.oldId as string,
					ref: boundaryAt(nextState, written.span.start, identity, written.path),
				});
			else {
				const index = state.edits.findIndex(
					(e) => e.start < old.span.end && e.end > old.span.start,
				);
				const edit = inverseEdits(state.file.source, state.edits)[index];
				if (edit)
					guards.push({
						kind: "deleted",
						file: state.file.path,
						nodeId: map.oldId as string,
						ref: boundaryAt(nextState, edit.start, identity),
					});
			}
		}
	}
	const diagnostics = sourceDiagnostics(documents, identity, prepared.descriptors);
	let focusId =
		identity.sourceMappings.find(
			(m) => m.file === writtenRoots[0]?.file && samePath(m.path, writtenRoots[0].path),
		)?.id ??
		identity.sourceMappings.find((m) => m.file === request.targets[0].file && m.path.length === 1)
			?.id ??
		null;
	if (request.operation === "wrapIn" && args.unwrap !== true) {
		const wrapper = writtenRoots.at(-1);
		focusId =
			identity.sourceMappings.find(
				(m) => m.file === wrapper?.file && samePath(m.path, wrapper.path),
			)?.id ?? null;
	}
	if (request.operation === "copyBlocks") focusId = targets[0]?.id ?? null;
	if (request.operation === "editInline") focusId = targets[0]?.id ?? null;
	if (intent === "delete" && targets.length) {
		const focused = targets[0];
		const peers = focused.entry.parent?.node.children ?? [];
		const index = peers.indexOf(focused.entry.node);
		const candidates = [
			...peers.slice(index + 1),
			...peers.slice(0, index).reverse(),
			focused.entry.parent?.node,
		];
		focusId = null;
		for (const candidate of candidates) {
			const entry = focused.state.nodes.find((n) => n.node === candidate);
			const map =
				entry &&
				context.identity.sourceMappings.find(
					(m) => m.file === focused.target.file && samePath(m.path, entry.path),
				);
			if (map && identity.sourceMappings.some((m) => m.id === map.id)) {
				focusId = map.id;
				break;
			}
		}
	}
	const operation: AppliedOperation = {
		ok: true,
		transactionId: request.transactionId,
		files: fileEdits,
		intent,
		mapping: identity.mapping,
		inverse: {
			files: fileEdits.map((f) => ({
				path: f.path,
				fromRevision: f.toRevision,
				toRevision: f.fromRevision,
				edits: inverseEdits((states.get(f.path) as State).file.source, f.edits),
			})),
			mapping: identity.inverseMapping,
			guards,
		},
		summary: {
			key: ["op", request.operation].join(".") as `op.${string}`,
			params: {
				count:
					request.operation === "discardCut"
						? retiredCuts
						: (inlineCount ?? pastedCount ?? (targets.length || 1)),
				...(retiredCuts ? { retiredCuts } : {}),
				...(request.operation === "wrapIn" && args.unwrap !== true
					? { type: String(args.type) }
					: {}),
				...(request.operation === "turnInto"
					? {
							type: String(args.type),
							losses: [...conversionLosses].join(","),
							losesAnswers: Number(losesAnswers),
						}
					: {}),
			},
		},
		diagnostics,
		focus: {
			file:
				request.operation === "editInline"
					? request.targets[0].file
					: (writtenRoots[0]?.file ?? request.targets[0].file),
			nodeId: focusId,
			role:
				request.operation === "insertBlock" || request.operation === "mergeBlocks"
					? "source"
					: request.operation === "setProperty"
						? `chip:${String(args.name)}`
						: "handle",
		},
		identity,
		evidence: bindAllocatedEvidence(evidence, identity),
		clipboard,
		...(clipboardText !== undefined ? { clipboardText } : {}),
		history: {
			focus: { file: request.targets[0].file, nodeId: targets[0]?.id ?? null, role: "handle" },
			before: files.map((f) => ({ ...f })),
			after: documents.map((d) => ({ path: d.path, source: d.tree.stream.source })),
			identity: context.identity,
			clipboard: context.clipboard ?? null,
		},
	};
	return {
		operation,
		descriptors: prepared.descriptors,
		recordedTargets: targets.map((target) => target.id),
	};
}
