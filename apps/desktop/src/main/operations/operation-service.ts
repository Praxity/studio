import { createHash, randomUUID } from "node:crypto";
import type { DraftSeed, Resolution } from "@praxity/editor-core/session";
import type {
	OperationFileBase,
	OperationRefusal,
	OperationRefusalCode,
	OperationRequest,
	OperationResult,
	OperationTarget,
} from "@praxity/grammar/src/operations/contract.ts";
import { type AppliedOperation, applyOperation } from "@praxity/operations";
import { draftRange } from "@praxity/operations/src/ranges.ts";
import type { PreviewNodeRender } from "@praxity/shared-blocks/course-preview-protocol";
import { z } from "zod";
import type { CanvasPageScope } from "../../shared/editor-session";
import {
	draftSchema,
	draftSeedSchema,
	EDITOR_COLLECTION_LIMIT,
	insertionRefSchema,
	nodeRefSchema,
	parseEditorInput,
	sourceRevisionSchema,
} from "../../shared/editor-session";
import { studioLessonFilenameSchema } from "../../shared/ipc-schemas";
import type { ProjectWriteResult } from "../../shared/project-write-errors";
import { readCourseManifestData } from "../course-manifest-io";
import {
	CourseIdentitySession,
	type IdentityRetiredLocation,
	IdentityRetirementError,
	IdentitySourceError,
	identitySourceError,
	persistCourseIdentity,
	projectWriteRefusal,
	type ResolvedCourseIdentity,
	readCourseIdentity,
	resolveCourseIdentity,
	resolveReadOperation,
} from "../identity-store";
import { readLessonSource } from "../lesson-source";
import { acknowledgeProjectWrite, withProjectFileTransaction } from "../project-file-transactions";

import { admitCanvasText, canvasTextSnapshotFields } from "./canvas-text-bindings";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const lessonPath = studioLessonFilenameSchema;
const revision = sourceRevisionSchema;
const id = z.string().uuid();
const nodeRef = nodeRefSchema;
const insertionRef = insertionRefSchema;
const canvasTextRequestSchema = z
	.object({
		transactionId: z.string().min(1),
		operation: z.literal("setText"),
		file: lessonPath,
		nodeId: z.string().min(1),
		baseRevision: revision,
		expectedText: z.string(),
		field: z.string().min(1),
		text: z.string(),
	})
	.strict();
export const requestSchema = z
	.object({
		transactionId: z.string().min(1),
		operation: z.string().min(1),
		files: z
			.array(z.object({ path: lessonPath, baseRevision: revision }).strict())
			.nonempty()
			.max(EDITOR_COLLECTION_LIMIT),
		targets: z
			.array(
				z
					.object({
						file: lessonPath,
						ref: z.discriminatedUnion("kind", [nodeRef, insertionRef]),
						expectedText: z.string().optional(),
						inline: z
							.object({
								start: z.number().int().nonnegative().safe(),
								end: z.number().int().nonnegative().safe(),
								expectedText: z.string(),
							})
							.strict()
							.optional(),
					})
					.strict(),
			)
			.nonempty()
			.max(EDITOR_COLLECTION_LIMIT),
		// The registry owns each operation's argument names and value constraints.
		// Zod 4 omits __proto__ before validating record keys; refuse it before cloning.
		args: z
			.unknown()
			.refine((args) => !args || typeof args !== "object" || !Object.hasOwn(args, "__proto__"))
			.pipe(z.record(z.string(), z.unknown())),
	})
	.strict()
	.superRefine((request, context) => {
		if (
			new Set(request.files.map((file) => file.path)).size !== request.files.length ||
			request.targets.some(
				(target) =>
					!request.files.some((file) => file.path === target.file) ||
					(target.ref.kind === "node" && target.expectedText === undefined) ||
					(target.inline && target.inline.end < target.inline.start),
			)
		) {
			context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid-args" });
		}
	});
const historySchema = z
	.object({
		transactionId: z.string().min(1),
		historyId: id,
		direction: z.enum(["undo", "redo"]),
	})
	.strict();

export type OperationServiceResult =
	| (OperationResult & {
			historyId: string;
			writeResult: ProjectWriteResult;
			seq: number;
			correspondence: NonNullable<ResolvedCourseIdentity["correspondence"]>;
			render?: PreviewNodeRender;
			fields?: Awaited<ReturnType<OperationService["canvasTextSnapshot"]>>["fields"];
	  })
	| (OperationRefusal & { retirements?: IdentityRetiredLocation[]; reviewUrl?: string });
interface OperationOptions {
	/** Compare-and-set: unlike ordinary node rebasing, this binds exact file bytes. */
	expectedRevision?: OperationFileBase;
	canvas?: { scope?: CanvasPageScope };
}
interface HistoryEntry {
	operation: AppliedOperation;
	direction: "undo" | "redo";
}
const refusal = (
	transactionId: string,
	code: OperationRefusalCode,
	target?: OperationTarget,
): OperationRefusal => ({
	ok: false,
	transactionId,
	code,
	message: { key: `op.${code}`, params: {} },
	...(target ? { file: target.file } : {}),
	...(target?.ref.kind === "node" && target.ref.nodeId ? { member: target.ref.nodeId } : {}),
});
export const operationTransactionId = (input: unknown) =>
	typeof input === "object" &&
	input !== null &&
	"transactionId" in input &&
	typeof input.transactionId === "string"
		? input.transactionId
		: "";

/** One session owns history. Clients send IDs, never executable inverse records. */
export class OperationService {
	private seq = 0;
	private readonly canvasIdentitySession: CourseIdentitySession;
	private readonly history = new Map<string, HistoryEntry>();
	private readonly committed = new Set<string>();
	constructor(
		private readonly root: string,
		private readonly identitySession?: CourseIdentitySession,
		private readonly renderCommit?: (
			result: OperationResult & { seq: number },
			identity: ResolvedCourseIdentity,
		) => Promise<PreviewNodeRender | undefined>,
		private readonly observe?: (stage: "snapshot" | "plan" | "commit", ms: number) => void,
	) {
		this.canvasIdentitySession = identitySession ?? new CourseIdentitySession(root);
	}

	/** Called only after the host admits an outside revision. */
	admitOutsideChange(): number {
		return ++this.seq;
	}

	sequence(): number {
		return this.seq;
	}

	async canvasTextSnapshot(scope?: CanvasPageScope) {
		return withProjectFileTransaction(
			this.root,
			async (root) => {
				const current = await this.snapshot(root, true, this.canvasIdentitySession);
				return {
					schema: 1 as const,
					seq: this.seq,
					sourceRevisions: Object.fromEntries(
						[...current.lessons]
							.map(([file, lesson]) => [file, digest(lesson.tree.stream.source)])
							.concat([
								[
									"course.yaml",
									digest(JSON.stringify((await readCourseManifestData(root)).manifest)),
								],
							]),
					),
					fields: canvasTextSnapshotFields(current, scope),
				};
			},
			"read",
			false,
		);
	}

	async canvasTextApply(input: unknown, scope?: CanvasPageScope): Promise<OperationServiceResult> {
		const parsed = canvasTextRequestSchema.safeParse(input);
		if (!parsed.success) return refusal(operationTransactionId(input), "invalid-args");
		const request = parsed.data;
		return this.write(request.transactionId, async (root) => {
			const current = await this.snapshot(root, true, this.canvasIdentitySession);
			const admitted = admitCanvasText(current, request, scope);
			if ("ok" in admitted) return admitted;
			return this.apply(admitted, {
				expectedRevision: { path: request.file, baseRevision: request.baseRevision },
				canvas: { scope },
			});
		});
	}

	async canvasTextResolve(input: unknown): Promise<OperationResult | OperationRefusal> {
		const parsed = canvasTextRequestSchema.safeParse(input);
		if (!parsed.success) return refusal(operationTransactionId(input), "invalid-args");
		const request = parsed.data;
		return withProjectFileTransaction(
			this.root,
			async (root) => {
				const current = await this.snapshot(root, true, this.canvasIdentitySession);
				const admitted = admitCanvasText(current, request);
				if ("ok" in admitted) return admitted;
				return this.resolve(admitted, {
					expectedRevision: { path: request.file, baseRevision: request.baseRevision },
				});
			},
			"read",
			false,
		);
	}

	async draftResolve(input: unknown): Promise<Resolution> {
		const { draft } = parseEditorInput(
			z.object({ draft: z.union([draftSchema, draftSeedSchema]) }).strict(),
			input,
		);
		return withProjectFileTransaction(
			this.root,
			async (root) => {
				const current = await this.snapshot(root, true);
				const lesson = current.lessons.get(draft.file);
				if (!lesson) return { kind: "removed" };
				const source = lesson.tree.stream.source;
				if (draft.scope === "file") {
					const seed: DraftSeed = {
						file: draft.file,
						target: draft.target,
						scope: "file",
						baseRevision: digest(source),
						expectedText: source,
						editableText: source,
					};
					return { kind: draft.expectedText === source ? "unchanged" : "changed", seed };
				}
				if (draft.target.kind !== "node")
					return { kind: "refused", message: { key: "op.not-allowed", params: {} } };
				const found = findNode(current, draft.file, draft.target);
				if (found.code === "orphaned") return { kind: "removed" };
				if (!found.node)
					return { kind: "refused", message: { key: `op.${found.code}`, params: {} } };
				const mapping = found.node;
				let node = lesson.tree.root;
				for (const index of mapping.path) {
					const child = node.children[index];
					if (!child) return { kind: "refused", message: { key: "op.not-allowed", params: {} } };
					node = child;
				}
				const range = draftRange(node);
				const expectedText = source.slice(mapping.span.start, mapping.span.end);
				const seed: DraftSeed = {
					file: draft.file,
					target: {
						kind: "node",
						nodeId: current.readView?.runtimeIds.includes(mapping.id) ? null : mapping.id,
						path: mapping.path,
						fingerprint: mapping.fingerprint,
					},
					baseRevision: digest(source),
					expectedText,
					editableText: source.slice(range.start, range.end),
					...(draft.scope ? { scope: draft.scope } : {}),
				};
				return { kind: draft.expectedText === expectedText ? "unchanged" : "changed", seed };
			},
			"read",
		);
	}

	async resolve(
		input: unknown,
		options: OperationOptions = {},
	): Promise<OperationResult | OperationRefusal> {
		const parsed = requestSchema.safeParse(input);
		if (!parsed.success) return refusal(operationTransactionId(input), "invalid-args");
		return withProjectFileTransaction(
			this.root,
			async (root) => {
				const current = await this.snapshot(root, true);
				const planned = this.plan(parsed.data, current, options.expectedRevision, true);
				if (
					!planned.ok &&
					planned.member &&
					!current.identity.sourceMappings.some((node) => node.id === planned.member)
				) {
					const { member: _member, ...refused } = planned;
					return refused;
				}
				return planned;
			},
			"read",
		);
	}

	async apply(input: unknown, options: OperationOptions = {}): Promise<OperationServiceResult> {
		const parsed = requestSchema.safeParse(input);
		if (!parsed.success) return refusal(operationTransactionId(input), "invalid-args");
		return this.write(parsed.data.transactionId, async (root) => {
			if (this.committed.has(parsed.data.transactionId))
				return refusal(parsed.data.transactionId, "not-allowed");
			let measuredAt = performance.now();
			const current = await this.snapshot(root);
			const sourceError = identitySourceError(
				current,
				parsed.data.targets.map((target) => target.file),
			);
			if (sourceError) throw sourceError;
			this.observe?.("snapshot", performance.now() - measuredAt);
			measuredAt = performance.now();
			const planned = this.plan(parsed.data, current, options.expectedRevision);
			this.observe?.("plan", performance.now() - measuredAt);
			if (!planned.ok) return projectWriteRefusal(current, planned);
			measuredAt = performance.now();
			const writeResult = await this.commit(root, current, planned);
			this.observe?.("commit", performance.now() - measuredAt);
			if (!writeResult) return refusal(parsed.data.transactionId, "conflict");
			const historyId = randomUUID();
			this.history.set(historyId, { operation: planned, direction: "undo" });
			this.committed.add(parsed.data.transactionId);
			const result = { ...publicResult(planned), seq: ++this.seq };
			const render = await this.renderCommit?.(result, writeResult.identity);
			return {
				...result,
				correspondence: writeResult.identity.correspondence ?? [],
				historyId,
				writeResult: writeResult.writeResult,
				...(render ? { render } : {}),
				...(options.canvas
					? { fields: canvasTextSnapshotFields(writeResult.identity, options.canvas.scope) }
					: {}),
			};
		});
	}

	async historyApply(input: unknown): Promise<OperationServiceResult> {
		const parsed = historySchema.safeParse(input);
		if (!parsed.success) return refusal(operationTransactionId(input), "invalid-args");
		return this.write(parsed.data.transactionId, async (root) => {
			const { transactionId, historyId, direction } = parsed.data;
			const entry = this.history.get(historyId);
			if (!entry || entry.direction !== direction || this.committed.has(transactionId))
				return refusal(transactionId, "not-allowed");
			const current = await this.snapshot(root);
			const files = sourceFiles(current);
			const planned = applyOperation(
				files,
				{
					transactionId,
					operation: "applyInverse",
					targets: [],
					files: files.map((file) => ({ path: file.path, baseRevision: digest(file.source) })),
					args: { operation: entry.operation },
				},
				{
					identity: current.identity,
					activeHistoryIds: current.activeHistoryIds,
					readerRoles: true,
					allocateId: randomUUID,
					digest,
				},
			);
			if (!planned.ok) return projectWriteRefusal(current, planned);
			const writeResult = await this.commit(root, current, planned, entry.operation);
			if (!writeResult) return refusal(transactionId, "conflict");
			this.history.set(historyId, {
				operation: planned,
				direction: direction === "undo" ? "redo" : "undo",
			});
			this.committed.add(transactionId);
			const result = { ...publicResult(planned), seq: ++this.seq };
			const render = await this.renderCommit?.(result, writeResult.identity);
			return {
				...result,
				correspondence: writeResult.identity.correspondence ?? [],
				historyId,
				writeResult: writeResult.writeResult,
				...(render ? { render } : {}),
			};
		});
	}

	private async write(
		transactionId: string,
		work: (root: string) => Promise<OperationServiceResult>,
	): Promise<OperationServiceResult> {
		let result: OperationServiceResult | undefined;
		const acknowledgement = await acknowledgeProjectWrite(
			withProjectFileTransaction(
				this.root,
				async (root) => {
					result = await work(root);
					return result;
				},
				"write",
				false,
			),
		).catch((error: unknown) => {
			if (error instanceof IdentityRetirementError) {
				result = {
					...refusal(transactionId, "identity-retirement-pending"),
					retirements: error.retirements,
					reviewUrl: "/launch",
				};
				return {};
			}
			if (error instanceof IdentitySourceError) {
				result = {
					...refusal(transactionId, error.code === "bad_yaml" ? "bad-yaml" : "source-invalid"),
					file: error.file,
				};
				return {};
			}
			throw error;
		});
		if (!result) throw new Error("Operation write returned no result");
		return result.ok
			? { ...result, writeResult: { ...result.writeResult, ...acknowledgement } }
			: result;
	}

	private async snapshot(root: string, readOnly = false, identitySession = this.identitySession) {
		const { lessonFilesOnDisk } = await readCourseManifestData(root);
		const lessonReads = identitySession?.lessonReads() ?? new Map();
		// The lesson reader validates encoding, grammar version and filesystem paths.
		for (const file of lessonFilesOnDisk) {
			lessonPath.parse(file);
			await readLessonSource(root, file, { lessonReads });
		}
		return (readOnly ? readCourseIdentity : resolveCourseIdentity)(root, {
			lessonPaths: lessonFilesOnDisk,
			lessonReads,
			identitySession,
		});
	}

	private plan(
		request: OperationRequest,
		current: ResolvedCourseIdentity,
		expectedRevision?: OperationFileBase,
	): AppliedOperation | OperationRefusal;
	private plan(
		request: OperationRequest,
		current: ResolvedCourseIdentity,
		expectedRevision: OperationFileBase | undefined,
		readOnly: true,
	): OperationResult | OperationRefusal;
	private plan(
		request: OperationRequest,
		current: ResolvedCourseIdentity,
		expectedRevision?: OperationFileBase,
		readOnly = false,
	): AppliedOperation | OperationResult | OperationRefusal {
		if (expectedRevision) {
			const lesson = current.lessons.get(expectedRevision.path);
			if (!lesson || digest(lesson.tree.stream.source) !== expectedRevision.baseRevision)
				return refusal(request.transactionId, "stale");
		}
		// Clipboard operations need atomic integration with LocalEditorStore.
		// A direct inverse must never come from a client.
		if (
			["applyInverse", "cutBlocks", "copyBlocks", "pasteBlocks", "discardCut"].includes(
				request.operation,
			)
		)
			return refusal(request.transactionId, "not-allowed");
		const targets: OperationTarget[] = [];
		for (const base of request.files)
			if (!current.lessons.has(base.path)) return refusal(request.transactionId, "not-allowed");
		for (const target of request.targets) {
			const lesson = current.lessons.get(target.file);
			const base = request.files.find((file) => file.path === target.file);
			if (!lesson || !base) return refusal(request.transactionId, "invalid-args", target);
			const source = lesson.tree.stream.source;
			if (target.ref.kind !== "node") {
				// Boundaries have no owned text guard. Refuse stale boundaries until S2 supplies a draft guard.
				if (base.baseRevision !== digest(source))
					return refusal(request.transactionId, "stale", target);
				targets.push(target);
				continue;
			}
			const ref = target.ref;
			const found = findNode(current, target.file, ref);
			if (!found.node) return refusal(request.transactionId, found.code, target);
			const node = found.node;
			if (source.slice(node.span.start, node.span.end) !== target.expectedText)
				return refusal(request.transactionId, "conflict", target);
			const inline = target.inline;
			if (inline && base.baseRevision !== digest(source)) {
				// A token's absolute offsets cannot be safely rebased without its base owner offset.
				return refusal(request.transactionId, "stale", target);
			}
			targets.push({
				...target,
				ref: { kind: "node", nodeId: node.id, path: node.path, fingerprint: node.fingerprint },
				...(inline ? { inline } : {}),
			});
		}
		// O1 expects every parsed lesson represented by the course identity. Unrequested
		// lessons get current bases only after all client-supplied preconditions resolve.
		const files = sourceFiles(current);
		for (const base of request.files) {
			if (
				!request.targets.some((target) => target.file === base.path) &&
				base.baseRevision !== digest(current.lessons.get(base.path)?.tree.stream.source ?? "")
			)
				return refusal(request.transactionId, "stale");
		}
		const prepared = {
			...request,
			targets,
			files: files.map((file) => ({ path: file.path, baseRevision: digest(file.source) })),
		};
		const planned = readOnly
			? resolveReadOperation(current, prepared)
			: applyOperation(files, prepared, {
					identity: current.identity,
					activeHistoryIds: current.activeHistoryIds,
					readerRoles: true,
					allocateId: randomUUID,
					digest,
				});
		if (
			planned.ok &&
			planned.files.some(
				(file) =>
					file.fromRevision !== file.toRevision &&
					!request.files.some((base) => base.path === file.path),
			)
		)
			return refusal(request.transactionId, "invalid-args");
		return planned;
	}

	private async commit(
		root: string,
		current: ResolvedCourseIdentity,
		planned: AppliedOperation,
		inverseOf?: AppliedOperation,
	): Promise<{ identity: ResolvedCourseIdentity; writeResult: ProjectWriteResult } | null> {
		try {
			const resolved = await resolveCourseIdentity(root, {
				lessonPaths: [...current.lessons.keys()],
				operationBase: current,
				operationPlan: planned,
				identitySession: this.identitySession,
				sources: Object.fromEntries(planned.history.after.map((file) => [file.path, file.source])),
				operations: planned.evidence,
				...(inverseOf
					? {
							restore: {
								identity: inverseOf.history.identity,
								written: inverseOf.identity,
								mapping: inverseOf.inverse.mapping,
							},
						}
					: {}),
			});
			const durable = await persistCourseIdentity(root, resolved);
			if (!durable.writeResult)
				throw new Error("Operation persistence returned no acknowledgement");
			return { identity: durable, writeResult: durable.writeResult };
		} catch (error) {
			if ((error as { code?: string } | null)?.code === "ECONFLICT") return null;
			throw error;
		}
	}
}

function findNode(
	current: ResolvedCourseIdentity,
	file: string,
	ref: { nodeId: string | null; fingerprint: string },
) {
	const matches = current.identity.sourceMappings.filter(
		(node) =>
			node.file === file &&
			(ref.nodeId ? node.id === ref.nodeId : node.fingerprint === ref.fingerprint),
	);
	if (!matches.length) return { code: "orphaned" as const, node: undefined };
	if (matches.length !== 1) return { code: "ambiguous" as const, node: undefined };
	return { code: undefined, node: matches[0] };
}

function sourceFiles(current: ResolvedCourseIdentity) {
	return [...current.lessons]
		.filter(([path]) => !identitySourceError(current, [path]))
		.map(([path, lesson]) => ({
			path,
			source: lesson.tree.stream.source,
		}));
}
function publicResult({
	identity: _identity,
	evidence: _evidence,
	history: _history,
	clipboard: _clipboard,
	clipboardText: _clipboardText,
	...result
}: AppliedOperation): OperationResult {
	return structuredClone(result);
}
