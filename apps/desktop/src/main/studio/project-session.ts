import { AsyncResource } from "node:async_hooks";
import { createHash } from "node:crypto";
import { lstat, stat } from "node:fs/promises";
import path from "node:path";
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
import { createTranslator } from "use-intl/core";
import { z } from "zod";
import { parseEditorInput } from "../../shared/editor-session";
import {
	courseLessonSchema,
	courseLoadSchema,
	coursePreviewBuildSchema,
	studioLessonFilenameSchema,
} from "../../shared/ipc-schemas";
import { previewMessages } from "../../shared/preview-messages";
import {
	NarrationTargetUnresolvedError,
	narrationTargetUnresolvedMessage,
} from "../../shared/project-write-errors";
import type { OpenProjectResult } from "../../shared/types";
import { DEFAULT_APP_SETTINGS } from "../../shared/types";
import cliEn from "../cli-messages/en.json" with { type: "json" };
import cliFr from "../cli-messages/fr.json" with { type: "json" };
import { loadCourse, readLesson } from "../course-io";
import { readCourseManifestData } from "../course-manifest-io";
import { ExportAccessibilityError } from "../export/accessibility-enforcement";
import {
	buildAdmittedCoursePreviewInput,
	NarrationUnlinkedError,
} from "../export/build-export-input-from-project";
import { ProjectExportError } from "../export/export-project";
import { ProjectAssetInventory } from "../export/project-asset-inventory";
import {
	CourseIdentitySession,
	IdentityRetirementError,
	IdentitySourceError,
	identitySourceError,
	identityWriteRetirements,
	persistCourseIdentity,
	type ResolvedCourseIdentity,
} from "../identity-store";
import {
	readLessonSource,
	resolveLessonSources,
	resolveLessonSourcesForWrite,
} from "../lesson-source";
import { readEditorSnapshot } from "../operations/block-inspection";
import {
	assertAllowedProjectRoot,
	assertSamePath,
	resolveExistingPathWithin,
} from "../path-security";
import { listProjectAssets } from "../project-assets";
import { readProjectConfig, resolveCompletionSettings } from "../project-config";
import { projectRecoveryArchives, withProjectFileTransaction } from "../project-file-transactions";
import { readProjectTree } from "../project-tree";
import { browserExportSchema, StudioExportService } from "./export-service";
import { sourceErrorMessage } from "./identity-review";
import {
	type CanvasPracticeDiagnostic,
	canvasPracticeDiagnostics,
	canvasPracticeRefusalText,
	previewDiagnostics,
} from "./preview-diagnostics";
import { PreviewScheduler, type PreviewSchedulerEvent } from "./preview-scheduler";

const emptyArgs = z.object({}).strict();
export class StudioSessionError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?:
			| { file: string; count: number }
			| { retirements: IdentityRetirementError["retirements"] }
			| { source: string }
			| { diagnostics: CanvasPracticeDiagnostic[] },
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

export async function createStudioProjectSession(
	projectDir: string,
	appVersion: string,
	preview?: import("../course-preview-service").CoursePreviewService,
	exportOptions?: Omit<ConstructorParameters<typeof StudioExportService>[0], "onProgress">,
	messageLocale: "en" | "fr" = "en",
) {
	const t = createTranslator({
		locale: messageLocale,
		messages: messageLocale === "fr" ? cliFr : cliEn,
	});
	const root = await assertAllowedProjectRoot(path.resolve(projectDir));
	const runPreviewJob = AsyncResource.bind((job: () => void) => job());
	const identitySession = new CourseIdentitySession(root);
	const assetInventory = new ProjectAssetInventory(root);
	const admittedSources = new Map<string, string>();
	let previewSequence = 0;
	const admittedPages = new Map<string, string[]>();
	const goodLessons = new Map<string, ReadLessonResult>();
	let inputMs = 0;
	let outsideTiming: { watcherEventAt: number; admissionMs: number; inputMs: number } | undefined;
	const rememberSources = (identity: ResolvedCourseIdentity) => {
		const refusedFiles = new Set(
			practiceAdmissionDiagnostics(
				[...identity.lessons].map(([path, read]) => ({ path, read })),
			).map((diagnostic) => diagnostic.file),
		);
		admittedSources.clear();
		for (const file of goodLessons.keys())
			if (!identity.lessons.has(file)) {
				goodLessons.delete(file);
				admittedPages.delete(file);
			}
		for (const [file, read] of identity.lessons) {
			admittedSources.set(file, createHash("sha256").update(lessonSourceText(read)).digest("hex"));
			if (read.hasErrors || refusedFiles.has(file)) continue;
			goodLessons.set(file, structuredClone(read));
			admittedPages.set(
				file,
				read.pages.map((page) => page.id),
			);
		}
	};
	if (!(await stat(root)).isDirectory()) throw new Error(t("sessionRefusals.root"));
	let closed = false;
	let pendingChanges = Promise.resolve();
	const listeners = new Set<(event: StudioEvent) => void>();
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
			throw new StudioSessionError(403, "path_forbidden", t("sessionRefusals.lessonPath"));
		}
	}

	async function manifestData() {
		return withProjectFileTransaction(
			root,
			async () => {
				const hasManifest = await optionalInput("course.yaml");
				const data = await readCourseManifestData(root);
				if (!hasManifest && data.lessonFilesOnDisk.length !== 1) {
					throw new Error(t("sessionRefusals.standalone"));
				}
				for (const filename of data.manifest.lessons) {
					validateFilename(filename);
					await resolveExistingPathWithin(root, path.join(root, filename));
				}
				if (!data.orderedLessons.length) throw new Error(t("sessionRefusals.lessons"));
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
			throw new StudioSessionError(404, "lesson_not_found", t("sessionRefusals.lessonMissing"));
		}
		try {
			await resolveExistingPathWithin(root, path.join(root, filename));
		} catch {
			throw new StudioSessionError(403, "path_forbidden", t("sessionRefusals.lessonPath"));
		}
	}

	async function authorizeRoot(courseDir: string) {
		try {
			await assertSamePath(root, courseDir);
		} catch {
			throw new StudioSessionError(403, "path_forbidden", t("sessionRefusals.courseRoot"));
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

	let scheduler: PreviewScheduler;
	let locale: "en" | "fr" = "en";
	async function previewInput(
		identity: ResolvedCourseIdentity,
		seq: number,
		fencedFiles?: ReadonlySet<string>,
	) {
		const measuredAt = performance.now();
		if (!fencedFiles)
			assertCoursePracticeAdmission([...identity.lessons].map(([path, read]) => ({ path, read })));
		const lessons = new Map(identity.lessons);
		for (const [file, read] of lessons) {
			const good = goodLessons.get(file);
			if (fencedFiles?.has(file)) {
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
			scheduler.fail(seq, practiceDiagnostics);
			return undefined;
		}
		const input = await previewInput(identity, seq);
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
			const identity = pending
				? await resolveLessonSources(root, {}, { identitySession })
				: await persistCourseIdentity(root, candidate);
			rememberSources(identity);
			await configRead();
			let diagnostics: PreviewCompileDiagnostic[] = practiceAdmissionDiagnostics(
				[...identity.lessons].map(([path, read]) => ({ path, read })),
			);
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
			editorSeq: previewSequence,
		};
	}

	const methods = new Map<string, (args: unknown) => Promise<unknown>>([
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
	]);
	methods.set("previewSelectPage", async (args) => {
		const { pageId } = z
			.object({ pageId: z.string().min(1).optional() })
			.strict()
			.parse(args);
		const selected = pageId ?? scheduler.context().pages[0]?.id;
		if (!selected) throw new Error(`${t("serverRefusals.noPage")}.`);
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
			outsideTiming,
		};
	});
	methods.set("editorSnapshot", async (args) => {
		parseEditorInput(emptyArgs, args);
		return readEditorSnapshot(root, identitySession, () => previewSequence);
	});
	methods.set("assetList", async (args) => {
		parseEditorInput(emptyArgs, args);
		return listProjectAssets(root);
	});
	if (preview) {
		methods.set("canvasPreviewBuild", async (args) => {
			parseEditorInput(emptyArgs, args);
			const data = await manifestData();
			const refusalLocale = data.manifest.locale?.startsWith("fr") ? "fr" : "en";
			try {
				return await preview.buildCanvas(identitySession, previewSequence);
			} catch (error) {
				const diagnostics = canvasPracticeDiagnostics(error);
				if (!diagnostics) throw error;
				throw new StudioSessionError(
					422,
					"practice_refused",
					canvasPracticeRefusalText(diagnostics, refusalLocale),
					{ diagnostics },
				);
			}
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
			return preview.build(request, identitySession, format, previewSequence);
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
					error instanceof Error ? error.message : t("sessionRefusals.export"),
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
		preview?.invalidateAssets(file);
		assetInventory.invalidate(file);
		pendingChanges = pendingChanges
			.then(async () => {
				if (closed) return;
				const filename = path.relative(root, file).replaceAll("\\", "/");
				try {
					if (
						filename.endsWith(".prax") ||
						filename === "course.yaml" ||
						filename.startsWith("assets/") ||
						filename === "praxity.json"
					) {
						let previewSeq: number | undefined;

						try {
							await withProjectFileTransaction(
								root,
								async () => {
									const admittedAt = performance.now();
									if (!event.endsWith("Dir") && filename.endsWith(".prax")) {
										if (await optionalInput(filename)) {
											const source = await readLessonSource(root, filename);
											const hash = createHash("sha256").update(source).digest("hex");
											if (hash === admittedSources.get(filename)) {
												return;
											}
										} else identitySession.invalidate();
									}
									const identity = await resolveLessonSources(root, {}, { identitySession });
									const admissionMs = performance.now() - admittedAt;
									const seq = ++previewSequence;
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
						} catch (error) {
							const failureSeq = previewSeq ?? ++previewSequence;
							if (previewSeq === undefined) publish({ type: "editorChanged", seq: failureSeq });
							scheduler.fail(
								failureSeq,
								previewDiagnostics(error, filename),
								admittedPages.get(filename),
							);
							throw error;
						}
					}
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
		registeredMethods: [...methods.keys()],
		cancelExport: () => exports?.cancel(),
		readSnapshot,
		async invoke(method: string, args: unknown) {
			if (closed) throw new StudioSessionError(503, "session_closed", t("serverRefusals.closing"));
			const operation = methods.get(method);
			if (!operation)
				throw new StudioSessionError(404, "method_not_allowed", t("sessionRefusals.method"));
			try {
				return await operation(args);
			} catch (error) {
				if (error instanceof NarrationTargetUnresolvedError)
					throw new StudioSessionError(422, error.code, narrationTargetUnresolvedMessage(locale), {
						source: error.source,
					});
				if (error instanceof IdentityRetirementError)
					throw new StudioSessionError(
						409,
						"identity_retirement_pending",
						previewMessages[locale].identityReviewPending,
					);
				if (error instanceof IdentitySourceError)
					throw new StudioSessionError(422, error.code, sourceErrorMessage(locale, error));
				if (error instanceof EmptyCourseError)
					throw new StudioSessionError(422, error.code, error.message);
				throw error;
			}
		},
		subscribe(listener: (event: StudioEvent) => void) {
			listeners.add(listener);
			scheduler.replayFailures(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		async close() {
			identitySession.invalidate();
			scheduler.close();
			closed = true;
			listeners.clear();
			const results = [
				...(await Promise.allSettled([watcher.close(), pendingChanges])),
				...(await Promise.allSettled([exports?.close(), preview?.dispose()])),
			];
			const errors = results.flatMap((result) =>
				result.status === "rejected" ? [result.reason] : [],
			);
			if (errors.length) throw new AggregateError(errors, "Studio session cleanup failed");
		},
	};
}
