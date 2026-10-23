import { AsyncResource } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	type CourseContextChanges,
	EmptyCourseError,
	PracticeAdmissionError,
} from "@praxity/export-pipeline";
import {
	assertCoursePracticeAdmission,
	lessonSourceText,
	lineColumn,
	readLesson as parseLesson,
	practiceAdmissionDiagnostics,
	type ReadLessonResult,
} from "@praxity/grammar";
import type { PreviewCompileDiagnostic } from "@praxity/shared-blocks/course-preview-protocol";
import { LEARNER_STATE_MAX_BYTES } from "@praxity/shared-blocks/learner-state";
import { watch } from "chokidar";
import { z } from "zod";
import { canvasMessages } from "../../shared/canvas-messages";
import type { CanvasPageScope } from "../../shared/editor-session";
import {
	clipboardPutSchema,
	type DraftPersistenceOperation,
	type DraftPersistenceReceipt,
	draftPersistenceSubmitSchema,
	parseEditorInput,
	previewRenderDraftSchema,
} from "../../shared/editor-session";
import {
	courseLessonSchema,
	courseLoadSchema,
	coursePreviewBuildSchema,
	courseWriteLessonSchema,
	grammarSourceSchema,
	narrationAuthoringReadSchema,
	narrationAuthoringWriteSchema,
	narrationCleanupSchema,
	studioLessonFilenameSchema,
} from "../../shared/ipc-schemas";
import { NARRATION_SIDECAR_PATH, parseNarrationSidecarV2 } from "../../shared/narration-sidecar";
import {
	NarrationTargetUnresolvedError,
	narrationTargetUnresolvedMessage,
} from "../../shared/project-write-errors";
import type { OpenProjectResult } from "../../shared/types";
import { DEFAULT_APP_SETTINGS } from "../../shared/types";
import { loadCourse, readLesson } from "../course-io";
import { readCourseManifestData } from "../course-manifest-io";
import { ExportAccessibilityError } from "../export/accessibility-enforcement";
import {
	buildAdmittedCoursePreviewInput,
	NarrationUnlinkedError,
} from "../export/build-export-input-from-project";
import { ProjectExportError } from "../export/export-project";
import { ProjectAssetInventory } from "../export/project-asset-inventory";
import { formatIdentityAdvice } from "../identity-init-cli";
import {
	CourseIdentitySession,
	IdentityRetirementError,
	IdentitySourceError,
	identitySourceError,
	identityWriteRetirements,
	initializeCourseIdentity,
	persistCourseIdentity,
	type ResolvedCourseIdentity,
} from "../identity-store";
import {
	readLessonSource,
	resolveLessonSources,
	resolveLessonSourcesForWrite,
	writeLessonSource,
} from "../lesson-source";
import {
	cleanupNarrationRecordings,
	readNarrationAuthoring,
	writeNarrationAuthoring,
} from "../narration-authoring";
import { readEditorSnapshot } from "../operations/block-inspection";
import { LocalEditorStore } from "../operations/local-editor-store";
import { editManifest } from "../operations/manifest-editor";
import { OperationService, operationTransactionId } from "../operations/operation-service";
import {
	assertAllowedProjectRoot,
	assertSamePath,
	readFileWithin,
	resolveExistingPathWithin,
} from "../path-security";
import { listProjectAssets } from "../project-assets";
import { readProjectConfig, resolveCompletionSettings } from "../project-config";
import {
	acknowledgeProjectWrite,
	projectRecoveryArchives,
	withProjectFileTransaction,
} from "../project-file-transactions";
import { readProjectTree } from "../project-tree";
import { browserExportSchema, StudioExportService } from "./export-service";
import { identityReviewMessages, type StudioIdentityReview } from "./identity-review";
import { studioNarrationStatus } from "./narration-policy";
import { previewDiagnostics } from "./preview-diagnostics";
import {
	type PreviewDraftIdentity,
	PreviewScheduler,
	type PreviewSchedulerEvent,
} from "./preview-scheduler";

const emptyArgs = z.object({}).strict();
const projectSaveSchema = z
	.object({
		grammar: grammarSourceSchema,
		expectedGrammar: grammarSourceSchema,
	})
	.strict();
const lessonWriteSchema = courseWriteLessonSchema
	.extend({
		expectedGrammar: grammarSourceSchema,
	})
	.strict();

export class StudioSessionError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?:
			| { file: string; count: number }
			| { retirements: IdentityRetirementError["retirements"] }
			| { source: string },
	) {
		super(message);
	}
}

export type StudioEvent =
	| PreviewSchedulerEvent
	| { type: "editorChanged"; seq: number }
	| { type: "grammarChanged"; filename: string; grammar: string }
	| { type: "treeChanged"; tree: Awaited<ReturnType<typeof readProjectTree>> }
	| { type: "exportProgress"; step: string; percent: number }
	| { type: "exportEnforcement"; enforced: boolean }
	| { type: "error"; code: "watch_failed"; message: string };

// No Electron, global settings, telemetry or ancestor workspace reads in this owner.
export async function createStudioProjectSession(
	projectDir: string,
	appVersion: string,
	preview?: import("../course-preview-service").CoursePreviewService,
	exportOptions?: Omit<ConstructorParameters<typeof StudioExportService>[0], "onProgress">,
) {
	const root = await assertAllowedProjectRoot(path.resolve(projectDir));
	// Capture the session scope before opening an admission. Deferred jobs must
	// acquire fresh locks, never inherit a released T1 AsyncLocalStorage scope.
	const runPreviewJob = AsyncResource.bind((job: () => void) => job());
	const identitySession = new CourseIdentitySession(root);
	const assetInventory = new ProjectAssetInventory(root);
	// Exact admitted source hashes distinguish our own watcher echoes from outside
	// writes. Events still read current bytes through the admitted lesson reader.
	const admittedSources = new Map<string, string>();
	const committedSources = new Map<string, string>();
	const admittedPages = new Map<string, string[]>();
	const goodLessons = new Map<string, ReadLessonResult>();
	let draftIdentity: PreviewDraftIdentity | undefined;
	const operationTimings: Partial<Record<"snapshot" | "plan" | "commit", number>> = {};
	let inputMs = 0;
	let outsideTiming: { watcherEventAt: number; admissionMs: number; inputMs: number } | undefined;
	const rememberSources = (identity: ResolvedCourseIdentity) => {
		const refusedFiles = new Set(
			practiceAdmissionDiagnostics(
				[...identity.lessons].map(([path, read]) => ({ path, read })),
			).map((diagnostic) => diagnostic.file),
		);
		draftIdentity = {
			admission: identity,
			files: [...identity.lessons].map(([path, read]) => ({
				path,
				source: lessonSourceText(read),
			})),
		};
		admittedSources.clear();
		for (const file of goodLessons.keys())
			if (!identity.lessons.has(file)) {
				goodLessons.delete(file);
				admittedPages.delete(file);
			}
		for (const [file, read] of identity.lessons) {
			admittedSources.set(file, createHash("sha256").update(lessonSourceText(read)).digest("hex"));
			// A contained-invalid commit is still admitted source; suppress its own watcher echo.
			if (read.hasErrors || refusedFiles.has(file)) continue;
			goodLessons.set(file, structuredClone(read));
			admittedPages.set(
				file,
				read.pages.map((page) => page.id),
			);
		}
	};
	if (!(await stat(root)).isDirectory()) throw new Error("Project root must be a directory");
	let closed = false;
	let pendingChanges = Promise.resolve();
	const listeners = new Set<(event: StudioEvent) => void>();
	let draftSubscriptionEpoch = 0;
	const publish = (event: StudioEvent) => {
		if (!closed) for (const listener of listeners) listener(event);
	};
	const exports = exportOptions
		? new StudioExportService({
				...exportOptions,
				onProgress: (step, percent) => publish({ type: "exportProgress", step, percent }),
			})
		: undefined;

	async function optionalInput(filename: string): Promise<boolean> {
		try {
			await lstat(path.join(root, filename));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
		await resolveExistingPathWithin(root, path.join(root, filename));
		return true;
	}

	function validateFilename(filename: string) {
		courseLessonSchema.shape.filename.parse(filename);
		if (!studioLessonFilenameSchema.safeParse(filename).success) {
			throw new StudioSessionError(403, "path_forbidden", "Lesson path is not authorized");
		}
	}

	async function manifestData() {
		return withProjectFileTransaction(
			root,
			async () => {
				const hasManifest = await optionalInput("course.yaml");
				const data = await readCourseManifestData(root);
				if (!hasManifest && data.lessonFilesOnDisk.length !== 1) {
					throw new Error("Ambiguous standalone folder: supply a course.yaml or one .prax lesson");
				}
				for (const filename of data.manifest.lessons) {
					validateFilename(filename);
					await resolveExistingPathWithin(root, path.join(root, filename));
				}
				if (!data.orderedLessons.length) throw new Error("Project has no readable lessons");
				return data;
			},
			"read",
		);
	}

	async function authorizeLesson(filename: string) {
		return withProjectFileTransaction(root, () => authorizeLessonSnapshot(filename), "read");
	}

	async function authorizeLessonSnapshot(filename: string) {
		validateFilename(filename);
		const data = await manifestData();
		if (![...data.orderedLessons, ...data.unlistedLessons].includes(filename)) {
			throw new StudioSessionError(404, "lesson_not_found", "Lesson is not in this project");
		}
		try {
			await resolveExistingPathWithin(root, path.join(root, filename));
		} catch {
			throw new StudioSessionError(403, "path_forbidden", "Lesson path is not authorized");
		}
	}

	async function authorizeRoot(courseDir: string) {
		try {
			await assertSamePath(root, courseDir);
		} catch {
			throw new StudioSessionError(403, "path_forbidden", "Course root is not authorized");
		}
	}

	async function configRead() {
		return withProjectFileTransaction(
			root,
			async () => {
				await optionalInput("praxity.json");
				return readProjectConfig(root);
			},
			"read",
		);
	}

	// Opening the editor admits a writer before any authored-file discovery.
	// Subsequent snapshots and previews remain strict readers.
	let scheduler: PreviewScheduler;
	let locale: "en" | "fr" = "en";
	async function identityReview(
		purpose: "entry" | "confirmation" = "entry",
	): Promise<StudioIdentityReview> {
		return withProjectFileTransaction(
			root,
			async () => {
				const data = await manifestData();
				locale = data.manifest.locale?.startsWith("fr") ? "fr" : "en";
				const result = await resolveLessonSourcesForWrite(root, {}, { identitySession });
				const retirements = identityWriteRetirements(result);
				const problem = identitySourceError(result);
				const sourceError = problem && {
					code: problem.code,
					file: problem.file,
					line: problem.line,
					message:
						identityReviewMessages[locale][
							problem.code === "bad_yaml" ? "badYaml" : "invalidSource"
						],
				};
				// Opaque invalid lessons must not prevent entry to valid lessons.
				// Confirmation still validates the whole graph it would persist.
				if (sourceError && purpose === "confirmation")
					throw new StudioSessionError(422, sourceError.code, sourceError.message);
				const duplicate = result.identity.unresolved.find((node) => node.reason === "duplicate");
				const duplicateRead = duplicate && result.lessons.get(duplicate.file);
				if (duplicate && !duplicateRead) throw new Error("Missing duplicate source admission");
				const revision = createHash("sha256")
					.update(
						JSON.stringify({
							manifest: data.manifest,
							sources: [...result.lessons].map(([file, lesson]) => [
								file,
								lessonSourceText(lesson),
							]),
							retirements,
						}),
					)
					.digest("hex");
				return {
					locale,
					revision,
					retirements,
					confirmationBlocked: Boolean(duplicate || sourceError),
					...(sourceError ? { sourceError } : {}),
					...(duplicate && duplicateRead
						? {
								duplicate: {
									file: duplicate.file,
									line: lineColumn(
										lessonSourceText(duplicateRead),
										result.identity.sourceMappings.find((node) => node.id === duplicate.id)?.span
											.start ?? 0,
									).line,
								},
							}
						: {}),
				};
			},
			"write",
			false,
		);
	}
	async function previewInput(
		identity: ResolvedCourseIdentity,
		seq: number,
		fencedFiles?: ReadonlySet<string>,
	) {
		const measuredAt = performance.now();
		if (!fencedFiles)
			assertCoursePracticeAdmission([...identity.lessons].map(([path, read]) => ({ path, read })));
		// Preview consumers retain the last valid lesson slice. Identity admission
		// and diagnostics still describe the current disk revision.
		const lessons = new Map(identity.lessons);
		for (const [file, read] of lessons) {
			const good = goodLessons.get(file);
			if (fencedFiles?.has(file)) {
				// This reader contains no authored source or content. Fence both
				// the compiler projection and its source-admission tree.
				const empty = parseLesson("");
				empty.frontmatter = read.frontmatter;
				lessons.set(file, empty);
			} else if (read.hasErrors)
				lessons.set(file, good ? structuredClone(good) : { ...read, blocks: [], pages: [] });
		}
		const input = {
			...(await buildAdmittedCoursePreviewInput(
				{
					projectDir: root,
					scope: "course",
					inheritWorkspaceSettings: false,
					assetInventory,
					viewerVersionPath: path.join(root, ".praxity", "local", "viewer.version.json"),
					...(await resolveCompletionSettings({
						projectDir: root,
						fallbackCompletionThreshold: DEFAULT_APP_SETTINGS.defaultCompletionThreshold,
					})),
				},
				{ ...identity, lessons },
			)),
			seq,
		};
		inputMs = performance.now() - measuredAt;
		return input;
	}
	async function refreshPreview(
		identity: ResolvedCourseIdentity,
		seq: number,
		changed: CourseContextChanges | undefined,
		optimistic: boolean,
	) {
		const practiceDiagnostics = practiceAdmissionDiagnostics(
			[...identity.lessons].map(([path, read]) => ({ path, read })),
		);
		if (practiceDiagnostics.length) {
			// Fence the entire retained course: references may cross lessons.
			scheduler.fail(seq, practiceDiagnostics);
			return undefined;
		}
		const input = await previewInput(identity, seq);
		// Without watcher hints, any asset may have changed before this admission.
		const render = await scheduler.refresh(
			input,
			changed ?? { assets: [...input.resolvedAssets.keys()] },
			optimistic,
		);
		for (const [file, read] of identity.lessons) {
			const diagnostics = read.errors
				.filter((error) => error.level === "error")
				.map((error) => ({
					file,
					message: error.message,
					line: error.line,
					column: error.column,
					span: { start: error.start, end: error.end },
					messageRef: error.messageRef,
				}));
			if (!diagnostics.length) continue;
			const pageIds = admittedPages.get(file) ?? read.pages.map((page) => page.id);
			const affectedPages = pageIds.filter((id) =>
				scheduler.context().pages.some((page) => page.id === id),
			);
			if (affectedPages.length) scheduler.fail(seq, diagnostics, affectedPages);
			else {
				// An invalid unlisted lesson has no preview page. Report its
				// diagnostics on the retained course without blocking valid jobs.
				for (const page of scheduler.context().pages)
					publish({
						type: "compileFailed",
						seq,
						pageId: page.id,
						diagnostics: structuredClone(diagnostics),
					});
			}
		}
		return render;
	}
	const initial = await withProjectFileTransaction(
		root,
		async () => {
			const data = await manifestData();
			for (const filename of data.lessonFilesOnDisk) await readLessonSource(root, filename);
			locale = data.manifest.locale?.startsWith("fr") ? "fr" : "en";
			const candidate = await resolveLessonSourcesForWrite(root, {}, { identitySession });
			const valid = identitySourceError(candidate) === undefined;
			const pending =
				!valid ||
				candidate.identity.unresolved.length > 0 ||
				identityWriteRetirements(candidate).length > 0;
			// Writers keep invalid lessons opaque; preview still needs their transient read identities.
			const identity = pending
				? await resolveLessonSources(root, {}, { identitySession })
				: await persistCourseIdentity(root, candidate);
			rememberSources(identity);
			await configRead();
			let diagnostics: PreviewCompileDiagnostic[] = practiceAdmissionDiagnostics(
				[...identity.lessons].map(([path, read]) => ({ path, read })),
			);
			// Fence the whole course: a cross-lesson refusal may name only the
			// reader file while its private target still has D02's runtime refusal.
			const fencedFiles = diagnostics.length ? new Set(identity.lessons.keys()) : undefined;
			try {
				scheduler = await PreviewScheduler.create(
					await previewInput(identity, 0, fencedFiles),
					publish,
					{ runJob: runPreviewJob },
				);
			} catch (error) {
				if (!(error instanceof PracticeAdmissionError)) throw error;
				diagnostics = [...diagnostics, ...previewDiagnostics(error)];
				scheduler = await PreviewScheduler.create(
					await previewInput(identity, 0, new Set(identity.lessons.keys())),
					publish,
					{ runJob: runPreviewJob },
				);
			}
			if (diagnostics.length)
				scheduler.fail(
					0,
					diagnostics,
					[...identity.lessons.values()].flatMap((read) => read.pages.map((page) => page.id)),
				);
			return data;
		},
		"write",
		false,
	);
	const selectedLesson = initial.orderedLessons[0];
	const operations = new OperationService(
		root,
		identitySession,
		async (result, identity) => {
			publish({ type: "editorChanged", seq: result.seq });
			const previousPages = result.files
				.filter((file) => file.fromRevision !== file.toRevision)
				.flatMap((file) => goodLessons.get(file.path)?.pages ?? []);
			rememberSources(identity);
			for (const file of result.files)
				if (file.fromRevision !== file.toRevision) committedSources.set(file.path, file.toRevision);
			try {
				assertCoursePracticeAdmission(
					[...identity.lessons].map(([path, read]) => ({ path, read })),
				);
				const files = result.files
					.filter((file) => file.fromRevision !== file.toRevision)
					.map((file) => file.path);
				const render = scheduler.renderCommitted(
					result.seq,
					previousPages,
					files.flatMap((file) => identity.lessons.get(file)?.pages ?? []),
				);
				// Metadata, assets and the complete context belong to the scheduler.
				// Its read admission starts after this durable write releases the lock.
				scheduler.enqueueRefresh(result.seq, async () => {
					await withProjectFileTransaction(
						root,
						async () => {
							// The queued job owns a new admission. Its identity must be
							// issued here too, since outside edits can precede their watcher.
							const current = await resolveLessonSources(root, {}, { identitySession });
							await refreshPreview(current, result.seq, undefined, false);
							rememberSources(current);
						},
						"read",
					);
				});
				return render;
			} catch (error) {
				// The durable write succeeded. Report preview failure without turning its
				// acknowledgement into a failed save that the client might retry.
				scheduler.fail(result.seq, previewDiagnostics(error));
				return undefined;
			}
		},
		(stage, ms) => {
			operationTimings[stage] = ms;
		},
	);
	const localEditor = new LocalEditorStore(root);
	const draftPersistenceServiceId = randomUUID();
	type DraftAttempt =
		| { state: "fenced" }
		| { state: "evicted" }
		| {
				state: "running";
				operation: DraftPersistenceOperation;
				completion: Promise<DraftPersistenceReceipt>;
		  }
		| { state: "terminal"; operation: DraftPersistenceOperation; receipt: DraftPersistenceReceipt };
	// Keep late-arrival tombstones for this lifetime; bound receipts containing author payloads.
	const draftAttempts = new Map<string, DraftAttempt>();
	const terminalAttempts: string[] = [];
	const terminalReceiptLimit = 128;

	async function readSnapshot() {
		return withProjectFileTransaction(root, readSessionSnapshot, "read");
	}

	async function readSessionSnapshot() {
		const data = await manifestData();
		const snapshotLesson = data.orderedLessons.includes(selectedLesson)
			? selectedLesson
			: data.orderedLessons[0];
		await authorizeLesson(snapshotLesson);
		const project: OpenProjectResult = {
			recoveryArchives: await projectRecoveryArchives(root),
			projectPath: root,
			lessonFilename: snapshotLesson,
			grammar: await readLessonSource(root, snapshotLesson),
			config: await configRead(),
		};
		return {
			project,
			appVersion,
			exportEnforced: exports?.enforced ?? true,
			editorSeq: operations.sequence(),
		};
	}

	async function save(filename: string, source: string, expectedSource: string) {
		try {
			return await acknowledgeProjectWrite(
				withProjectFileTransaction(
					root,
					async () => {
						// Authorization reads the manifest. Admit the save before that read so
						// this authorized write can recover an interrupted previous save.
						await authorizeLesson(filename);
						return writeLessonSource(root, filename, source, expectedSource);
					},
					"write",
				),
			);
		} catch (error) {
			if (error instanceof Error && error.message.includes("changed on disk")) {
				throw new StudioSessionError(
					409,
					"source_conflict",
					"Lesson changed on disk since it was opened",
				);
			}
			throw error;
		}
	}

	const methods = new Map<string, (args: unknown) => Promise<unknown>>([
		[
			"narrationCleanup",
			async (args) => {
				const { paths, currentSource } = narrationCleanupSchema.parse(args);
				return cleanupNarrationRecordings(root, paths, currentSource);
			},
		],
		[
			"narrationAuthoringRead",
			async (args) => {
				const { filename, source } = narrationAuthoringReadSchema.parse(args);
				return withProjectFileTransaction(
					root,
					async () => {
						await authorizeLessonSnapshot(filename);
						const view = await readNarrationAuthoring(
							root,
							source === undefined ? {} : { [filename]: source },
						);
						const document = view.documents.find((doc) => doc.filename === filename);
						if (!document) throw new Error("Unknown narration lesson");
						return { sidecar: view.sidecar, source: view.source, document };
					},
					"read",
				);
			},
		],
		[
			"narrationAuthoringWrite",
			async (args) => {
				const { source, expectedSource } = narrationAuthoringWriteSchema.parse(args);
				return writeNarrationAuthoring(root, parseNarrationSidecarV2(source), expectedSource);
			},
		],

		[
			"narrationStatus",
			async (args) => {
				emptyArgs.parse(args);
				return studioNarrationStatus(process.env);
			},
		],
		[
			"projectReadTextFile",
			async (args) => {
				// Only the editor's metadata baselines are admitted. Plaintext editing is deferred.
				const { relativePath } = z
					.object({
						relativePath: z
							.string()
							// The shared draft owner passes absolute paths. Keep metadata admission here.
							.transform((filename) =>
								path.isAbsolute(filename) ? path.relative(root, filename) : filename,
							)
							.pipe(z.enum(["course.yaml", NARRATION_SIDECAR_PATH])),
					})
					.strict()
					.parse(args);
				return withProjectFileTransaction(
					root,
					async () => {
						let present: boolean;
						try {
							present = await optionalInput(relativePath);
						} catch {
							throw new StudioSessionError(
								403,
								"path_forbidden",
								"Metadata path is not authorized",
							);
						}
						if (!present) {
							throw new StudioSessionError(
								404,
								"file_not_found",
								"ENOENT: Project metadata is absent",
							);
						}
						return readFileWithin(root, path.join(root, relativePath), "utf8");
					},
					"read",
				);
			},
		],
		[
			"configRead",
			async (args) => {
				emptyArgs.parse(args);
				return configRead();
			},
		],
		[
			"projectReadTree",
			async (args) => {
				emptyArgs.parse(args);
				return readProjectTree(root);
			},
		],
		[
			"projectSave",
			async (args) => {
				const input = projectSaveSchema.parse(args);
				return save(selectedLesson, input.grammar, input.expectedGrammar);
			},
		],
		[
			"courseLoad",
			async (args) => {
				const input = courseLoadSchema.strict().parse(args);
				await authorizeRoot(input.courseDir);
				await manifestData();
				return withProjectFileTransaction(root, () => loadCourse(root), "read");
			},
		],
		[
			"courseReadLesson",
			async (args) => {
				const input = courseLessonSchema.strict().parse(args);
				await authorizeRoot(input.courseDir);
				await authorizeLesson(input.filename);
				return readLesson(root, input.filename);
			},
		],
		[
			"courseWriteLesson",
			async (args) => {
				const input = lessonWriteSchema.parse(args);
				await authorizeRoot(input.courseDir);
				return save(input.filename, input.grammar, input.expectedGrammar);
			},
		],
	]);
	methods.set("operationApply", async (args) => {
		const transactionId = operationTransactionId(args);
		try {
			const result = await operations.apply(args);
			scheduler.settleDraft(result.transactionId, result.ok);
			return result;
		} catch (error) {
			scheduler.settleDraft(transactionId, false);
			throw error;
		}
	});
	methods.set("previewRenderDraft", async (args) => {
		const request = parseEditorInput(previewRenderDraftSchema, args);
		// Saved pages were admitted at open/commit/watcher time. This path never
		// opens T1, a file, or a lock, and does not mutate the persisted draft.
		const page = [...goodLessons.values()]
			.flatMap((read) => read.pages)
			.find((page) => page.id === request.pageId);
		return scheduler.renderDraft(request, page ?? null, draftIdentity);
	});
	methods.set("previewSelectPage", async (args) => {
		const { pageId } = z
			.object({ pageId: z.string().min(1).optional() })
			.strict()
			.parse(args);
		const selected = pageId ?? scheduler.context().pages[0]?.id;
		if (!selected) throw new Error("Course has no preview page.");
		scheduler.selectPage(selected);
		return {
			pageId: selected,
			seq: scheduler.context().seq,
			pages: scheduler.context().pages.map(({ id, documentSlug }) => ({ id, slug: documentSlug })),
		};
	});
	methods.set("previewStats", async (args) => {
		emptyArgs.parse(args);
		return {
			...scheduler.stats(),
			inputMs,
			operationTimings: { ...operationTimings },
			outsideTiming,
		};
	});
	methods.set("operationResolve", (args) => operations.resolve(args));
	methods.set("canvasTextSnapshot", (args) => {
		parseEditorInput(emptyArgs, args);
		return operations.canvasTextSnapshot();
	});
	methods.set("canvasTextApply", (args) => operations.canvasTextApply(args));
	methods.set("editorSnapshot", async (args) => {
		parseEditorInput(emptyArgs, args);
		return readEditorSnapshot(root, identitySession, () => operations.sequence());
	});
	methods.set("historyApply", (args) => operations.historyApply(args));
	methods.set("draftResolve", (args) => operations.draftResolve(args));
	methods.set("draftPut", (args) => localEditor.draftPut(args));
	methods.set("draftDelete", (args) => localEditor.draftDelete(args));
	methods.set("draftPersistenceSession", async (args) => {
		emptyArgs.parse(args);
		return { serviceId: draftPersistenceServiceId };
	});
	methods.set("draftPersistenceSubmit", async (args) => {
		const { serviceId, attemptId, operation } = parseEditorInput(
			draftPersistenceSubmitSchema,
			args,
		);
		const identity = { serviceId, attemptId };
		if (serviceId !== draftPersistenceServiceId)
			return {
				...identity,
				state: "unavailable",
				reason: "service-lifetime",
			} satisfies DraftPersistenceReceipt;
		const prior = draftAttempts.get(attemptId);
		if (prior?.state === "evicted")
			return {
				...identity,
				state: "unavailable",
				reason: "evicted",
			} satisfies DraftPersistenceReceipt;
		if (prior?.state === "fenced")
			return { ...identity, state: "fenced" } satisfies DraftPersistenceReceipt;
		if (prior) {
			if (!isDeepStrictEqual(prior.operation, operation))
				return {
					...identity,
					state: "unavailable",
					reason: "attempt-conflict",
				} satisfies DraftPersistenceReceipt;
			return structuredClone(prior.state === "terminal" ? prior.receipt : await prior.completion);
		}
		const completion = localEditor.draftPersist(operation).then((outcome) => {
			const receipt = {
				...identity,
				state: "terminal",
				operation,
				outcome,
			} satisfies DraftPersistenceReceipt;
			draftAttempts.set(attemptId, { state: "terminal", operation, receipt });
			terminalAttempts.push(attemptId);
			while (terminalAttempts.length > terminalReceiptLimit) {
				const evicted = terminalAttempts.shift();
				if (evicted) draftAttempts.set(evicted, { state: "evicted" });
			}
			return receipt;
		});
		draftAttempts.set(attemptId, { state: "running", operation, completion });
		return structuredClone(await completion);
	});
	methods.set("draftPersistenceReconcile", async (args) => {
		const { serviceId, attemptId, operation } = parseEditorInput(
			draftPersistenceSubmitSchema,
			args,
		);
		const identity = { serviceId, attemptId };
		if (serviceId !== draftPersistenceServiceId)
			return {
				...identity,
				state: "unavailable",
				reason: "service-lifetime",
			} satisfies DraftPersistenceReceipt;
		const prior = draftAttempts.get(attemptId);
		if (!prior) {
			// An empty lookup alone cannot prove that an authenticated request will not arrive later.
			draftAttempts.set(attemptId, { state: "fenced" });
			return { ...identity, state: "fenced" } satisfies DraftPersistenceReceipt;
		}
		if (prior.state === "fenced")
			return { ...identity, state: "fenced" } satisfies DraftPersistenceReceipt;
		if (prior.state === "evicted")
			return {
				...identity,
				state: "unavailable",
				reason: "evicted",
			} satisfies DraftPersistenceReceipt;
		if (!isDeepStrictEqual(prior.operation, operation))
			return {
				...identity,
				state: "unavailable",
				reason: "attempt-conflict",
			} satisfies DraftPersistenceReceipt;
		return structuredClone(prior.state === "terminal" ? prior.receipt : await prior.completion);
	});
	methods.set("draftList", async (args) => {
		parseEditorInput(emptyArgs, args);
		return localEditor.draftList();
	});
	methods.set("clipboardGet", async (args) => {
		parseEditorInput(emptyArgs, args);
		return localEditor.clipboardGet();
	});
	methods.set("clipboardPut", async (args) =>
		localEditor.clipboardPut(parseEditorInput(clipboardPutSchema, args).clipboard),
	);
	methods.set("clipboardDiscard", async (args) => {
		parseEditorInput(emptyArgs, args);
		return localEditor.clipboardPut(null);
	});
	methods.set("manifestEdit", (args) => editManifest(root, args));
	methods.set("assetList", async (args) => {
		parseEditorInput(emptyArgs, args);
		return listProjectAssets(root);
	});
	if (preview) {
		methods.set("canvasPreviewBuild", async (args) => {
			parseEditorInput(emptyArgs, args);
			await manifestData();
			return preview.buildCanvas(identitySession, operations.sequence());
		});
		methods.set("coursePreviewBuild", async (args) => {
			const { request, format } = z
				.object({
					request: coursePreviewBuildSchema.strict().optional(),
					format: z.enum(["electron-preview", "standalone"]).optional(),
				})
				.strict()
				.parse(args);
			if (request) await authorizeLesson(request.lessonFilename);
			else await manifestData();
			return preview.build(request, identitySession, format, operations.sequence());
		});
		const leaseSchema = z.object({ leaseId: z.string().uuid() }).strict();
		for (const [method, operation] of [
			["coursePreviewRelease", (id: string) => preview.release(id)],
			["coursePreviewStateRead", (id: string) => preview.stateRead(id)],
			["coursePreviewStateActivate", (id: string) => preview.stateActivate(id)],
			["coursePreviewStateReset", (id: string) => preview.stateReset(id)],
		] as const) {
			methods.set(method, async (args) => operation(leaseSchema.parse(args).leaseId));
		}
		methods.set("coursePreviewStatePersist", async (args) => {
			const input = leaseSchema
				.extend({
					writerToken: z.string().uuid(),
					state: z
						.string()
						.refine((value) => Buffer.byteLength(value, "utf8") <= LEARNER_STATE_MAX_BYTES),
				})
				.strict()
				.parse(args);
			return preview.statePersist(input.leaseId, input.writerToken, input.state);
		});
	}

	if (exports) {
		methods.set("exportScorm", async (args) => {
			const input = browserExportSchema.parse(args);
			if (input.scope === "lesson") await authorizeLesson(input.lessonFilename ?? selectedLesson);
			else await manifestData();
			try {
				return await exports.run({
					...input,
					lessonFilename: input.lessonFilename ?? selectedLesson,
				});
			} catch (error) {
				if (error instanceof EmptyCourseError) throw error;
				if (error instanceof ProjectExportError)
					throw new StudioSessionError(422, error.code, error.message);
				if (error instanceof NarrationUnlinkedError)
					throw new StudioSessionError(422, error.code, error.message, error.details);
				if (error instanceof ExportAccessibilityError)
					throw new StudioSessionError(422, "accessibility_blocked", error.message);
				throw new StudioSessionError(
					422,
					"export_failed",
					error instanceof Error ? error.message : "Export failed",
				);
			}
		});
		methods.set("cancelExport", async (args) => {
			emptyArgs.parse(args);
			exports.cancel();
			return null;
		});
		methods.set("setAccessibilityExportEnforcement", async (args) => {
			publish({ type: "exportEnforcement", enforced: exports.setEnforcement(args) });
			return true;
		});
	}
	const watcher = watch(root, {
		ignoreInitial: true,
		followSymlinks: false,
		depth: 5,
		ignored: (file) =>
			path
				.relative(root, file)
				.split(path.sep)
				.some((part) => part.startsWith(".") || ["node_modules", "exports"].includes(part)),
		awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
	});
	const watcherFailure = () => {
		identitySession.invalidate();
		admittedSources.clear();
		assetInventory.invalidate();
		preview?.invalidateAssets();
		publish({
			type: "error",
			code: "watch_failed",
			message: "Project watcher failed. Reload the editor.",
		});
	};
	watcher.on("error", watcherFailure);
	try {
		await new Promise<void>((resolve, reject) => {
			watcher.once("ready", resolve);
			watcher.once("error", reject);
		});
	} catch (error) {
		await watcher.close();
		throw error;
	}
	watcher.on("all", (event, file) => {
		const watcherEventAt = performance.now();
		const filename = path.relative(root, file).replaceAll("\\", "/");
		if (
			filename === "course.yaml" ||
			filename.startsWith(".praxity/identity/") ||
			event.endsWith("Dir")
		)
			identitySession.invalidate();
		// Chokidar reports renames as unlink/add, including directory moves.
		preview?.invalidateAssets(file);
		assetInventory.invalidate(file);
		pendingChanges = pendingChanges
			.then(async () => {
				if (closed) return;
				const filename = path.relative(root, file).replaceAll("\\", "/");
				try {
					// Source, identity and context belong to one admitted revision. A
					// saved operation's watcher echo has identical input and is ignored.
					if (
						filename.endsWith(".prax") ||
						filename === "course.yaml" ||
						filename.startsWith("assets/") ||
						filename === "praxity.json"
					) {
						let previewSeq: number | undefined;
						let sourceEcho = false;
						try {
							await withProjectFileTransaction(
								root,
								async () => {
									const admittedAt = performance.now();
									// T1 replacements can outlast Chokidar's atomic window. Wait for
									// that transaction before treating its unlink echo as deletion.
									if (!event.endsWith("Dir") && filename.endsWith(".prax")) {
										if (await optionalInput(filename)) {
											const source = await readLessonSource(root, filename);
											const hash = createHash("sha256").update(source).digest("hex");
											if (hash === admittedSources.get(filename)) {
												// A queued refresh may already know real outside bytes.
												// Only the commit's own bytes suppress grammarChanged.
												sourceEcho = hash === committedSources.get(filename);
												return;
											}
										} else identitySession.invalidate();
									}
									const identity = await resolveLessonSources(root, {}, { identitySession });
									const admissionMs = performance.now() - admittedAt;
									const seq = operations.admitOutsideChange();
									publish({ type: "editorChanged", seq });
									previewSeq = seq;
									await refreshPreview(
										identity,
										seq,
										{
											lessons: filename.endsWith(".prax") ? [filename] : undefined,
											manifest: filename === "course.yaml" || filename === "praxity.json",
											assets: filename.startsWith("assets/") ? [filename] : undefined,
										},
										false,
									);
									outsideTiming = { watcherEventAt, admissionMs, inputMs };
									rememberSources(identity);
								},
								"read",
							);
							if (sourceEcho) return;
						} catch (error) {
							// Decoder, path and configuration errors may throw before the
							// parser returns diagnostics. Fence output and preserve the error.
							const failureSeq = previewSeq ?? operations.admitOutsideChange();
							if (previewSeq === undefined) publish({ type: "editorChanged", seq: failureSeq });
							scheduler.fail(
								failureSeq,
								previewDiagnostics(error, filename),
								admittedPages.get(filename),
							);
							throw error;
						}
					}
					// An unlink echo may already have replacement bytes to publish.
					if (
						!event.endsWith("Dir") &&
						path.extname(filename).toLowerCase() === ".prax" &&
						(event !== "unlink" || (await optionalInput(filename)))
					) {
						await authorizeLesson(filename);
						publish({
							type: "grammarChanged",
							filename,
							grammar: await readLessonSource(root, filename),
						});
					}
				} finally {
					publish({
						type: "treeChanged",
						tree: await readProjectTree(root),
					});
				}
			})
			.catch(watcherFailure);
	});

	return {
		cancelExport: () => exports?.cancel(),
		readSnapshot,
		identityReview,
		async confirmIdentityRetirements(revision: string) {
			return withProjectFileTransaction(
				root,
				async () => {
					const assertReviewed = async () => {
						const review = await identityReview("confirmation");
						if (review.revision !== revision)
							throw new StudioSessionError(
								409,
								"identity_review_changed",
								identityReviewMessages[locale].stale,
							);
						if (review.confirmationBlocked)
							throw new StudioSessionError(
								409,
								"identity_duplicate_pending",
								formatIdentityAdvice(
									identityReviewMessages[locale].duplicates,
									undefined,
									review.duplicate,
								),
							);
					};
					await assertReviewed();
					const data = await manifestData();
					const result = await initializeCourseIdentity(root, data.lessonFilesOnDisk, {
						rederive: true,
						beforeWrite: assertReviewed,
					});
					identitySession.invalidate();
					const seq = operations.admitOutsideChange();
					publish({ type: "editorChanged", seq });
					try {
						const identity = await resolveLessonSources(root, {}, { identitySession });
						rememberSources(identity);
						await refreshPreview(identity, seq, undefined, false);
					} catch (error) {
						// A preview failure cannot turn an acknowledged identity write into a failed save.
						scheduler.fail(seq, previewDiagnostics(error));
					}
					return result;
				},
				"write",
			);
		},
		async invoke(method: string, args: unknown, canvasPageScope?: CanvasPageScope) {
			if (closed) throw new StudioSessionError(503, "session_closed", "Studio session is closing");
			const operation = methods.get(method);
			if (!operation)
				throw new StudioSessionError(404, "method_not_allowed", "Method is not available");
			try {
				if (canvasPageScope && method === "canvasTextSnapshot") {
					parseEditorInput(emptyArgs, args);
					return {
						...(await operations.canvasTextSnapshot(canvasPageScope)),
						servedSeq: canvasPageScope.editorSeq,
						servedSourceRevisions: canvasPageScope.sourceRevisions,
					};
				}
				if (canvasPageScope && method === "canvasTextApply")
					return await operations.canvasTextApply(args, canvasPageScope);
				return await operation(args);
			} catch (error) {
				if (error instanceof NarrationTargetUnresolvedError)
					throw new StudioSessionError(422, error.code, narrationTargetUnresolvedMessage(locale), {
						source: error.source,
					});
				if (error instanceof IdentityRetirementError && error.origin === "draft")
					throw new StudioSessionError(
						409,
						"identity_draft_retirement",
						identityReviewMessages[locale].draftRetirements.replace(
							"{list}",
							error.retirements
								.map((item) => `${item.file}: ${item.page}; "${item.label}"`)
								.join(", "),
						),
						{ retirements: error.retirements },
					);
				if (error instanceof IdentityRetirementError)
					throw new StudioSessionError(
						409,
						"identity_retirement_pending",
						canvasMessages[locale].identityReviewPending,
					);
				if (error instanceof IdentitySourceError)
					throw new StudioSessionError(
						422,
						error.code,
						identityReviewMessages[locale][error.code === "bad_yaml" ? "badYaml" : "invalidSource"],
					);
				if (error instanceof EmptyCourseError)
					throw new StudioSessionError(422, error.code, error.message);
				throw error;
			}
		},
		subscribe(listener: (event: StudioEvent) => void) {
			// Reload may open its stream before the old socket closes. The newest
			// subscription owns the draft epoch; older closes cannot reset it.
			scheduler.endDraftSubscription();
			const epoch = ++draftSubscriptionEpoch;
			listeners.add(listener);
			scheduler.replayFailures(listener);
			return () => {
				if (listeners.has(listener) && epoch === draftSubscriptionEpoch)
					scheduler.endDraftSubscription();
				listeners.delete(listener);
			};
		},
		async close() {
			identitySession.invalidate();
			scheduler.close();
			closed = true;
			listeners.clear();
			// Drain scheduled compiles before disposing the preview they render into;
			// collect every cleanup failure rather than stopping at the first.
			const results = [
				...(await Promise.allSettled([watcher.close(), pendingChanges])),
				...(await Promise.allSettled([
					scheduler.drained(),
					...[...draftAttempts.values()].flatMap((attempt) =>
						attempt.state === "running" ? [attempt.completion] : [],
					),
				])),
				...(await Promise.allSettled([exports?.close(), preview?.dispose()])),
			];
			const errors = results.flatMap((result) =>
				result.status === "rejected" ? [result.reason] : [],
			);
			if (errors.length) throw new AggregateError(errors, "Studio session cleanup failed");
		},
	};
}
