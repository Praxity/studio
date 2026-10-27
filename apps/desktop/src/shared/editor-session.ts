import type { FrameView } from "@praxity/editor-core/frame-bridge";
import { buildFrameView, buildPageNodes } from "@praxity/editor-core/frame-bridge/view";
import type {
	AuthorOperationResult,
	Dependencies,
	Draft,
	DraftSeed,
	HistoryApplyRequest,
	Resolution,
	SelectionNode,
	Session,
} from "@praxity/editor-core/session";
import { nodeNames } from "@praxity/editor-core/session";
import { readLesson } from "@praxity/grammar";
import type {
	OperationRefusal,
	OperationRequest,
	OperationResult,
} from "@praxity/grammar/src/operations/contract.ts";
import { BLOCK_SCHEMA } from "@praxity/grammar/src/v4/schema.ts";
import type { TreeKind } from "@praxity/grammar/src/v4/tree/types.ts";
import { draftText } from "@praxity/operations/src/ranges.ts";
import type {
	PreviewDraftRender,
	PreviewNodeRender,
	PreviewRenderEvent,
} from "@praxity/shared-blocks/course-preview-protocol";
import { z } from "zod";
import { grammarSourceSchema, studioLessonFilenameSchema } from "./ipc-schemas";
import type { ProjectWriteResult } from "./project-write-errors";

// Ten times the frame bridge's 5,000-node ceiling leaves headroom for course
// files, selected nodes, draft diagnostics/buckets and manifest lists before validation.
export const EDITOR_COLLECTION_LIMIT = 50_000;

export const sourceRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const previewRenderDraftSchema = z
	.object({
		transactionId: z.string().min(1),
		pageId: z.string().min(1).max(1024),
		nodeId: z.string().min(1).max(1024),
		seq: z.number().int().nonnegative().safe(),
		source: grammarSourceSchema,
	})
	.strict();
export type PreviewRenderDraftRequest = z.infer<typeof previewRenderDraftSchema>;
export type PreviewRenderDraftResult = { ok: true; render: PreviewDraftRender } | OperationRefusal;
export const nodeRefSchema = z
	.object({
		kind: z.literal("node"),
		nodeId: z.string().uuid().nullable(),
		// Paths encode tree ancestry; 128 levels is over 20x the deepest authored fixture.
		path: z.array(z.number().int().nonnegative().safe()).max(128),
		fingerprint: sourceRevisionSchema,
	})
	.strict();
export const insertionRefSchema = z
	.object({
		kind: z.literal("insertion"),
		parentId: z.string().uuid().nullable(),
		after: z.string().uuid().nullable(),
		before: z.string().uuid().nullable(),
		parentRef: nodeRefSchema.extend({ nodeId: z.null() }).optional(),
		afterRef: nodeRefSchema.extend({ nodeId: z.null() }).optional(),
		beforeRef: nodeRefSchema.extend({ nodeId: z.null() }).optional(),
	})
	.strict();
const target = z.discriminatedUnion("kind", [nodeRefSchema, insertionRefSchema]);
const safeName = z
	.string()
	.min(1)
	.max(255)
	.refine((name) => name !== "prototype" && !Object.hasOwn(Object.prototype, name));
const offset = z.number().int().nonnegative().safe();
const range = z
	.object({ start: offset, end: offset })
	.strict()
	.refine((range) => range.end >= range.start);
const seedSchema = z
	.object({
		file: studioLessonFilenameSchema,
		target,
		baseRevision: sourceRevisionSchema,
		expectedText: grammarSourceSchema,
		editableText: grammarSourceSchema,
		scope: z.enum(["node", "file"]).optional(),
	})
	.strict();
export const draftSchema = seedSchema
	.extend({
		id: safeName,
		baseText: grammarSourceSchema,
		text: grammarSourceSchema,
		selection: z.tuple([offset, offset]),
		generation: offset,
		status: z.enum(["clean", "dirty", "invalid", "held", "conflict", "orphaned"]),
		diagnostics: z
			.array(
				z
					.object({
						file: studioLessonFilenameSchema,
						ref: target.nullable(),
						severity: z.enum(["error", "warning", "info"]),
						message: z
							.object({
								key: z
									.string()
									.startsWith("op.")
									.transform((key) => key as `op.${string}`),
								params: z.record(safeName, z.union([z.string(), z.number().finite()])),
							})
							.strict(),
						range: range.optional(),
					})
					.strict(),
			)
			.max(EDITOR_COLLECTION_LIMIT),
		changedAt: z.number().finite(),
		validatedGeneration: z.number().int().min(-1).safe(),
		persistedGeneration: z.number().int().min(-1).safe(),
		persistenceVersion: offset.optional(),
		persistedVersion: z.number().int().min(-1).safe().optional(),
		resolutionEpoch: offset.optional(),
		outside: seedSchema.optional(),
	})
	.strict();
export const clipboardSchema = z
	.object({
		file: studioLessonFilenameSchema,
		text: grammarSourceSchema,
		nodeIds: z.array(z.string().uuid()).min(1).max(EDITOR_COLLECTION_LIMIT),
	})
	.strict()
	.refine((record) => new Set(record.nodeIds).size === record.nodeIds.length);
export type LocalClipboard = z.infer<typeof clipboardSchema>;
export const draftPutSchema = z
	.object({
		draft: draftSchema,
		expectedVersion: z.number().int().min(-1).safe().optional(),
	})
	.strict();
export const draftDeleteSchema = z
	.object({ file: studioLessonFilenameSchema, id: safeName })
	.strict();
const draftRecordSchema = draftSchema.transform((draft): Draft => draft);
export const draftPersistenceOperationSchema = z.discriminatedUnion("action", [
	draftPutSchema.extend({ action: z.literal("put"), draft: draftRecordSchema }),
	draftDeleteSchema.extend({
		action: z.literal("remove"),
		expectedDraft: draftRecordSchema.optional(),
	}),
]);
export type DraftPersistenceOperation = z.infer<typeof draftPersistenceOperationSchema>;
export const draftPersistenceOutcomeSchema = z.discriminatedUnion("status", [
	z
		.object({
			status: z.literal("succeeded"),
			writeResult: z.object({ cleanupError: z.string().optional() }).strict(),
		})
		.strict(),
	z
		.object({
			status: z.literal("refused"),
			code: z.string().min(1),
			reason: z.enum([
				"superseded-generation",
				"metadata-conflict",
				"target-conflict",
				"corrupt-storage",
				"unsafe-path",
				"missing-membership",
				"invalid-input",
				"admission-race",
				"busy",
				"environment",
			]),
			stored: draftRecordSchema.optional(),
		})
		.strict(),
	z.object({ status: z.literal("unknown"), code: z.string().min(1) }).strict(),
]);
export type DraftPersistenceOutcome = z.infer<typeof draftPersistenceOutcomeSchema>;
export const draftPersistenceSessionSchema = z.object({ serviceId: z.string().uuid() }).strict();
export const draftPersistenceIdentitySchema = draftPersistenceSessionSchema.extend({
	attemptId: z.string().uuid(),
});
export const draftPersistenceSubmitSchema = draftPersistenceIdentitySchema.extend({
	operation: draftPersistenceOperationSchema,
});
export const draftPersistenceReceiptSchema = z.discriminatedUnion("state", [
	draftPersistenceIdentitySchema.extend({
		state: z.literal("terminal"),
		operation: draftPersistenceOperationSchema,
		outcome: draftPersistenceOutcomeSchema,
	}),
	draftPersistenceIdentitySchema.extend({ state: z.literal("fenced") }),
	draftPersistenceIdentitySchema.extend({
		state: z.literal("unavailable"),
		reason: z.enum(["service-lifetime", "attempt-conflict", "evicted"]),
	}),
]);
export type DraftPersistenceReceipt = z.infer<typeof draftPersistenceReceiptSchema>;
export const clipboardPutSchema = z.object({ clipboard: clipboardSchema }).strict();
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.null(),
		z.boolean(),
		z.number().finite(),
		z.string(),
		z.array(jsonValue).max(EDITOR_COLLECTION_LIMIT),
		z.record(safeName, jsonValue),
	]),
);
export const manifestEditSchema = z
	.object({
		file: z.union([z.literal("course.yaml"), studioLessonFilenameSchema]),
		baseRevision: sourceRevisionSchema,
		path: z.array(safeName).min(1).max(16),
		value: jsonValue,
	})
	.strict()
	.refine((request) => request.file === "course.yaml" || request.path[0] === "design");
export type ManifestEdit = z.infer<typeof manifestEditSchema>;
export type ManifestEditResult =
	| {
			ok: false;
			code:
				| "stale"
				| "conflict"
				| "invalid-args"
				| "not-allowed"
				| "source-invalid"
				| "bad-yaml"
				| "identity-retirement-pending";
			reviewUrl?: string;
	  }
	| { ok: true; revision: string; writeResult: ProjectWriteResult };
export type DraftPutResult =
	| {
			ok: false;
			code: "stale" | "conflict";
			message: OperationRefusal["message"];
			reason: "superseded-generation" | "metadata-conflict" | "target-conflict";
			stored: Draft;
	  }
	| { ok: true; writeResult: ProjectWriteResult };
export type EditorOperationResult =
	| (Extract<AuthorOperationResult, { ok: true }> & {
			writeResult: ProjectWriteResult;
			seq: number;
			correspondence: import("@praxity/content-identity").IdentityReadView["correspondence"];
			render?: PreviewNodeRender;
	  })
	| OperationRefusal;

/** Author-only admitted ranges; strings are derived when a source field opens. */
export interface EditorDraftRanges {
	target: Extract<DraftSeed["target"], { kind: "node" }>;
	expected: { start: number; end: number };
	editable: { start: number; end: number };
	scope: "node" | "file";
}

/** Decoded author outline. The plain JSON wire omits paths and derives page IDs from parents. */
export interface EditorSnapshot {
	schema: 1;
	seq: number;
	transientIdentity: boolean;
	lessons: {
		id: string;
		file: string;
		baseRevision: string;
		source: string;
		listed: boolean;
		label: string;
		revision: string;
		seed: EditorDraftRanges;
		nodes: {
			id: string;
			parentId: string | null;
			pageId: string;
			kind: string;
			type: string;
			label: string;
			revision: string;
			seed: EditorDraftRanges;
		}[];
	}[];
}

const outlineLabelByteLimit = 360;
const snapshotMetadataEncoder = new TextEncoder();
const byteLength = (text: string) => snapshotMetadataEncoder.encode(text).length;
// JSON escaping (notably control characters and lone surrogates) also consumes wire bytes.
const labelBytes = (text: string) => byteLength(JSON.stringify(text)) - 2;
const snapshotLabelSchema = z
	.string()
	.refine((label) => labelBytes(label) <= outlineLabelByteLimit);
const labelSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function snapshotLabel(value: string): string {
	if (labelBytes(value) <= outlineLabelByteLimit) return value;
	let clipped = "";
	let bytes = byteLength("\u2026");
	for (const { segment } of labelSegmenter.segment(value)) {
		bytes += labelBytes(segment);
		if (bytes > outlineLabelByteLimit) break;
		clipped += segment;
	}
	return `${clipped}\u2026`;
}
// Exhaustive against the grammar's type: adding a tree kind requires its transport bound here.
const snapshotKinds = {
	lesson: true,
	frontmatter: true,
	page: true,
	block: true,
	item: true,
	back: true,
	part: true,
	heading: true,
	divider: true,
	image: true,
	body: true,
	option: true,
	task: true,
	pair: true,
	step: true,
	turn: true,
	spot: true,
	list: true,
	"list-entry": true,
	table: true,
	recovery: true,
} satisfies Record<TreeKind, true>;
const snapshotTypes = new Set([...Object.keys(BLOCK_SCHEMA), ...Object.keys(snapshotKinds)]);
const kindSchema = z.string().refine((kind) => Object.hasOwn(snapshotKinds, kind));
const typeSchema = z.string().refine((type) => snapshotTypes.has(type));
const displayIdSchema = previewRenderDraftSchema.shape.nodeId.refine((id) => labelBytes(id) <= 36);
// Snapshot transport shares the existing IPC source ceiling and bounds offsets/indexes with it.
const sourceLimit = grammarSourceSchema.maxLength;
if (sourceLimit === null) throw new Error("Editor snapshot requires bounded admitted source");
const snapshotOffset = offset.max(sourceLimit);
const snapshotSeedSchema = z
	.object({
		target: nodeRefSchema.extend({ path: z.tuple([]) }),
		expected: range,
		editable: range,
		scope: z.enum(["node", "file"]),
	})
	.strict();
const snapshotNodeSchema = z
	.object({
		id: displayIdSchema,
		parentId: displayIdSchema.nullable(),
		kind: kindSchema,
		type: typeSchema,
		label: snapshotLabelSchema,
		// Preserve the outline revision and source fingerprint even when they differ.
		revisions: z.tuple([sourceRevisionSchema, sourceRevisionSchema]),
		target: nodeRefSchema.shape.nodeId,
		// Expected start/end, editable start/end; the source owns UTF-16 range validation.
		ranges: z.tuple([snapshotOffset, snapshotOffset, snapshotOffset, snapshotOffset]),
		index: snapshotOffset,
	})
	.strict();
const snapshotLessonSchema = z
	.object({
		id: displayIdSchema,
		file: studioLessonFilenameSchema,
		baseRevision: sourceRevisionSchema,
		source: grammarSourceSchema,
		listed: z.boolean(),
		label: snapshotLabelSchema,
		revision: sourceRevisionSchema,
		seed: snapshotSeedSchema,
		nodes: z.array(snapshotNodeSchema),
	})
	.strict()
	.transform((lesson, context): EditorSnapshot["lessons"][number] => {
		const nodes = new Map(lesson.nodes.map((node) => [node.id, node]));
		const paths = new Map<string, number[]>();
		const pages = new Map<string, string>();
		if (nodes.size !== lesson.nodes.length) {
			context.addIssue({ code: "custom", message: "Duplicate editor snapshot node", fatal: true });
			return z.NEVER;
		}
		for (const node of lesson.nodes) {
			const ancestors: typeof lesson.nodes = [];
			const visiting = new Set<string>();
			let current: typeof node | undefined = node;
			while (current && !paths.has(current.id)) {
				if (visiting.has(current.id) || (current.parentId && !nodes.has(current.parentId))) {
					context.addIssue({
						code: "custom",
						message: "Invalid editor snapshot parent",
						fatal: true,
					});
					return z.NEVER;
				}
				visiting.add(current.id);
				ancestors.push(current);
				current = current.parentId ? nodes.get(current.parentId) : undefined;
			}
			for (const ancestor of ancestors.reverse()) {
				paths.set(ancestor.id, [...(paths.get(ancestor.parentId ?? "") ?? []), ancestor.index]);
				pages.set(ancestor.id, pages.get(ancestor.parentId ?? "") ?? ancestor.id);
			}
		}
		return {
			...lesson,
			nodes: lesson.nodes.map((node) => ({
				id: node.id,
				parentId: node.parentId,
				pageId: pages.get(node.id) ?? node.id,
				kind: node.kind,
				type: node.type,
				label: node.label,
				revision: node.revisions[0],
				seed: {
					target: {
						kind: "node",
						nodeId: node.target,
						path: paths.get(node.id) ?? [],
						fingerprint: node.revisions[1],
					},
					expected: { start: node.ranges[0], end: node.ranges[1] },
					editable: { start: node.ranges[2], end: node.ranges[3] },
					scope: "node",
				},
			})),
		};
	})
	.superRefine((lesson, context) => {
		for (const { id, seed } of [lesson, ...lesson.nodes]) {
			if (seed.target.nodeId !== null && seed.target.nodeId !== id)
				context.addIssue({ code: "custom", message: "Invalid editor snapshot target" });
			try {
				// The source-range owner validates containment; no derived text enters the payload.
				draftText(lesson.source, seed.expected, seed.editable);
			} catch (error) {
				if (!(error instanceof RangeError)) throw error;
				context.addIssue({ code: "custom", message: "Invalid editor snapshot range" });
			}
		}
	});

/** Plain author JSON only. Both lesson and node seeds retain durable-only write targets. */
export const editorSnapshotSchema = z
	.object({
		schema: z.literal(1),
		seq: offset,
		transientIdentity: z.boolean(),
		lessons: z.array(snapshotLessonSchema),
	})
	.strict();

/** Plain JSON transport: local child indexes plus parent IDs replace depth-dependent paths. */
export function prepareEditorSnapshot(
	snapshot: EditorSnapshot,
): z.input<typeof editorSnapshotSchema> {
	return {
		...snapshot,
		lessons: snapshot.lessons.map((lesson) => ({
			...lesson,
			label: snapshotLabel(lesson.label),
			seed: { ...lesson.seed, target: { ...lesson.seed.target, path: [] } },
			nodes: lesson.nodes.map((node) => ({
				id: node.id,
				parentId: node.parentId,
				kind: node.kind,
				type: snapshotTypes.has(node.type) ? node.type : node.kind,
				label: snapshotLabel(node.label),
				revisions: [node.revision, node.seed.target.fingerprint],
				target: node.seed.target.nodeId,
				ranges: [
					node.seed.expected.start,
					node.seed.expected.end,
					node.seed.editable.start,
					node.seed.editable.end,
				],
				index: node.seed.target.path.at(-1) ?? 0,
			})),
		})),
	};
}

type EditorLesson = EditorSnapshot["lessons"][number];
const admittedLessonReads = new WeakMap<
	EditorLesson,
	{ source: string; revision: string; bindings: string; read: ReturnType<typeof readLesson> }
>();

/** The admitted source and display bindings own the parse, never a draft or presentation. */
function admittedLessonRead(lesson: EditorLesson) {
	const bindings = JSON.stringify([
		lesson.file,
		lesson.id,
		lesson.nodes.map((node) => [
			node.id,
			node.kind,
			node.seed.expected.start,
			node.seed.expected.end,
		]),
	]);
	const cached = admittedLessonReads.get(lesson);
	if (
		cached?.source === lesson.source &&
		cached.revision === lesson.baseRevision &&
		cached.bindings === bindings
	)
		return cached.read;
	const byRange = new Map(
		lesson.nodes.map((node) => [
			`${node.kind}:${node.seed.expected.start}:${node.seed.expected.end}`,
			node.id,
		]),
	);
	const read = readLesson(lesson.source, {
		ids: (node, role) => {
			// Frontmatter reader roles belong to the lesson, never to executable nodes.
			const id =
				node.kind === "frontmatter" && role
					? lesson.id
					: byRange.get(`${node.kind}:${node.span.start}:${node.span.end}`);
			if (!id) throw new Error("Editor snapshot identity unavailable");
			return role ? `${id}:${role}` : id;
		},
	});
	admittedLessonReads.set(lesson, {
		source: lesson.source,
		revision: lesson.baseRevision,
		bindings,
		read,
	});
	return read;
}

/** Raw reader callers own their result; projections keep the admitted parse private. */
export function readEditorLesson(lesson: EditorLesson) {
	return structuredClone(admittedLessonRead(lesson));
}

export function editorLessonFrame(
	lesson: EditorLesson,
	options: Omit<Parameters<typeof buildFrameView>[0], "lesson" | "file">,
): FrameView {
	return buildFrameView({ ...options, lesson: admittedLessonRead(lesson), file: lesson.file });
}

/** Outline names and page views use the same admitted reader as lesson dispatch. */
export function editorLessonOutline(
	lesson: EditorSnapshot["lessons"][number],
	session: Session,
	translate: (key: string, params?: Record<string, string | number>) => string,
	alwaysShowHandles?: boolean,
): { id: string; file: string; name: string; pages: FrameView[] } {
	const read = admittedLessonRead(lesson);
	return {
		id: lesson.id,
		file: lesson.file,
		name: nodeNames(read.tree.root, translate).get(read.tree.root) ?? lesson.label,
		pages: read.pages.map((page) =>
			buildFrameView({
				lesson: read,
				file: lesson.file,
				pageId: page.id,
				session,
				translate,
				alwaysShowHandles,
			}),
		),
	};
}

/** Dispatch projects the admitted lesson even when it has no presented document. */
export function editorLessonProjection(
	lesson: EditorSnapshot["lessons"][number],
	session: Session,
	translate: (key: string, params?: Record<string, string | number>) => string,
): Pick<Dependencies, "nameOfFocus" | "readDraft"> & {
	selectionNodes: () => readonly SelectionNode[];
} {
	const read = admittedLessonRead(lesson);
	const nodes = lesson.nodes
		.filter((node) => node.kind === "page")
		.flatMap((page) =>
			buildPageNodes({ lesson: read, file: lesson.file, pageId: page.id, session, translate }).map(
				(node) => ({ ...node, file: lesson.file, lessonId: lesson.id, pageId: page.id }),
			),
		);
	return {
		nameOfFocus: (focus) => nodes.find((node) => node.id === focus.nodeId)?.name ?? lesson.label,
		readDraft: (focus, scope) => {
			if (focus.file !== lesson.file) throw new Error("Editor draft outside lesson");
			if (scope === "file") return editorDraftSeed(lesson);
			const node = lesson.nodes.find((node) => node.id === focus.nodeId);
			if (!node) throw new Error("Editor draft unavailable");
			return editorDraftSeed(lesson, node);
		},
		selectionNodes: () => nodes,
	};
}

/** Node membership binds its ranges to the admitted lesson that owns its source. */
export function editorDraftSeed(
	lesson: {
		file: string;
		baseRevision: string;
		source: string;
		seed: EditorDraftRanges;
		nodes: readonly { seed: EditorDraftRanges }[];
	},
	node?: { seed: EditorDraftRanges },
): DraftSeed {
	if (node && !lesson.nodes.includes(node))
		throw new RangeError("Node does not belong to this lesson");
	const seed = node?.seed ?? lesson.seed;
	return {
		file: lesson.file,
		baseRevision: lesson.baseRevision,
		target: seed.target,
		scope: seed.scope,
		...draftText(lesson.source, seed.expected, seed.editable),
	};
}

// Zod 4 records skip __proto__ before key validation. Reject it, inherited objects and
// prototype names before a schema or YAML setter can interpret them.
// Keep only the first refusal so hostile collections cannot amplify pre-pass issues.
const safeJson = z.unknown().superRefine((input, context) => {
	const visit = (value: unknown): void => {
		if (value === null || typeof value !== "object") return;
		if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
			context.addIssue({ code: "custom", message: "Invalid object prototype" });
			return;
		}
		for (const key of Object.keys(value)) {
			if (context.issues.length) return;
			if (key === "prototype" || Object.hasOwn(Object.prototype, key))
				context.addIssue({ code: "custom", message: "Prototype keys are not allowed" });
			else visit((value as Record<string, unknown>)[key]);
		}
	};
	visit(input);
});
export function parseEditorInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
	safeJson.parse(input);
	return schema.parse(input);
}

/** Rooted browser editor APIs; persistence carries the controller's exact draft. */
export interface StudioEditorBridge {
	/** Same-revision callers share a read; newer callers share a queued refresh. Stale replies retry once. */
	editorSnapshot(): Promise<EditorSnapshot>;
	onEditorSnapshotChanged(receive: (change: { seq: number }) => void): () => void;
	previewSelectPage(
		pageId?: string,
	): Promise<{ pageId: string; seq: number; pages: { id: string; slug: string }[] }>;
	onPreviewEvent(receive: (event: PreviewRenderEvent) => void): () => void;
	onPreviewEpoch(receive: (epoch: number) => void): () => void;
	previewRenderDraft(request: PreviewRenderDraftRequest): Promise<PreviewRenderDraftResult>;
	draftPut(draft: Draft, expectedVersion?: number): Promise<DraftPutResult>;
	draftList(): Promise<Draft[]>;
	draftDelete(file: string, id: string): Promise<ProjectWriteResult>;
	draftPersistenceSession(): Promise<{ serviceId: string }>;
	draftPersistenceSubmit(
		serviceId: string,
		attemptId: string,
		operation: DraftPersistenceOperation,
	): Promise<DraftPersistenceReceipt>;
	draftPersistenceReconcile(
		serviceId: string,
		attemptId: string,
		operation: DraftPersistenceOperation,
	): Promise<DraftPersistenceReceipt>;
	draftResolve(draft: DraftSeed): Promise<Resolution>;
	clipboardGet(): Promise<LocalClipboard | null>;
	clipboardPut(clipboard: LocalClipboard): Promise<ProjectWriteResult>;
	clipboardDiscard(): Promise<ProjectWriteResult>;
	manifestEdit(request: ManifestEdit): Promise<ManifestEditResult>;
	operationApply(request: OperationRequest): Promise<EditorOperationResult>;
	operationResolve(request: OperationRequest): Promise<OperationResult | OperationRefusal>;
	historyApply(request: HistoryApplyRequest): Promise<EditorOperationResult>;
}
export { seedSchema as draftSeedSchema };

/** Captured compiler page identity and position, independent of course DOM markers. */
export interface CanvasPageScope {
	/** Sequence captured before compiling this retained author artifact. */
	editorSeq?: number;
	pageId: string;
	lessonId: string;
	pageIndex: number;
	pageIds?: readonly string[];
	sourceRevisions?: Record<string, string>;
	/** A captured module-deck document renders every page of this lesson. */
	allLessonPages?: boolean;
}
