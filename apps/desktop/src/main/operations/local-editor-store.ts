import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertPath } from "@praxity/content-identity/src/files.ts";
import { type Draft, draftPersistencePayload, sameDraftTarget } from "@praxity/editor-core/session";
import { z } from "zod";
import {
	clipboardSchema,
	type DraftPersistenceOutcome,
	type DraftPutResult,
	draftDeleteSchema,
	draftPersistenceOperationSchema,
	draftPutSchema,
	draftSchema,
	type LocalClipboard,
	parseEditorInput,
} from "../../shared/editor-session";
import { studioLessonFilenameSchema } from "../../shared/ipc-schemas";
import { projectReadErrorKey } from "../../shared/project-write-errors";
import { readCourseManifestData } from "../course-manifest-io";
import {
	createFileWithin,
	isWithin,
	readFileWithin,
	resolveExistingPathWithin,
} from "../path-security";
import {
	checkPrivateProjectPath,
	PrivateProjectPathError,
	privateFolderIgnoreContent,
} from "../private-project-folder";
import {
	acknowledgeProjectWrite,
	applyProjectFilePlan,
	isProjectRecoveryPath,
	type ProjectFileChange,
	withProjectFileTransaction,
} from "../project-file-transactions";

const bucketFields = {
	file: studioLessonFilenameSchema,
	drafts: z.array(draftSchema),
};
const bucketSchema = z
	.object({
		schema: z.literal(2),
		...bucketFields,
	})
	.strict()
	.superRefine((bucket, context) => {
		if (
			bucket.drafts.some((draft) => draft.file !== bucket.file) ||
			new Set(bucket.drafts.map((draft) => draft.id)).size !== bucket.drafts.length
		)
			context.addIssue({ code: "custom", message: "Invalid draft bucket" });
	});
const legacyBucketSchema = z
	.object({ schema: z.literal(1), lessonId: z.string().uuid(), ...bucketFields })
	.strict();
const bucketPath = (file: string) =>
	`${local}/drafts/file-${createHash("sha256").update(file).digest("hex")}.json`;
const clipboardDocumentSchema = z
	.object({ schema: z.literal(1), clipboard: clipboardSchema })
	.strict();
const local = ".praxity/local";

class DraftStorageError extends Error {
	constructor(
		readonly reason:
			| "corrupt-storage"
			| "unsafe-path"
			| "missing-membership"
			| "admission-race"
			| "metadata-conflict",
		message: string,
		cause?: unknown,
		readonly stored?: Draft,
	) {
		super(message, { cause });
	}
}
const corruptDraftErrors = new WeakSet<Error>();
function sameStoredVersion(a: Draft, b: Draft) {
	return (
		(a.persistenceVersion ?? 0) === (b.persistenceVersion ?? 0) &&
		isDeepStrictEqual(draftPersistencePayload(a), draftPersistencePayload(b))
	);
}

/** Fixed local paths must not alias another directory, even inside the course. */
async function checkedLocalPath(
	root: string,
	relative: string,
	allowAbsentCaseAlias = false,
): Promise<{ missing: string[] }> {
	try {
		return await checkPrivateProjectPath(root, relative, { allowAbsentCaseAlias });
	} catch (error) {
		if (!(error instanceof PrivateProjectPathError)) throw error;
		const message =
			error.reason === "link"
				? "Local editor paths cannot be symbolic links"
				: error.reason === "parent"
					? "Local editor parent is not a directory"
					: "Local editor path case alias is not allowed";
		throw new DraftStorageError("unsafe-path", message);
	}
}
async function optionalText(root: string, path: string): Promise<string | null> {
	if ((await checkedLocalPath(root, path)).missing.length) return null;
	return (await readFileWithin(root, join(root, path), "utf8")) as string;
}

/** The author project may have no root ignore rule. Keep all local bytes private. */
async function localIgnoreChange(root: string): Promise<ProjectFileChange[]> {
	const path = `${local}/.gitignore`;
	const source = await optionalText(root, path);
	const content = privateFolderIgnoreContent(source);
	return content === null ? [] : [{ path, content, expectedContent: source }];
}
type SkippedDraftFile = {
	file: string;
	reason: "unrecognized-file" | "invalid-draft" | "unreadable-file";
};

async function buckets(root: string, skipped?: SkippedDraftFile[]) {
	// Older recovery projects may use .PRAXITY without any editor storage. Keep
	// their archive inventory available; existing draft bytes still require exact paths.
	if ((await checkedLocalPath(root, `${local}/drafts`, true)).missing.length) return [];
	if (!(await lstat(join(root, local, "drafts"))).isDirectory())
		throw new DraftStorageError("unsafe-path", "Local draft storage is not a directory");
	const records = [];
	for (const filename of await readdir(join(root, local, "drafts"))) {
		const recognized = /^(?:[a-f0-9-]+|file-[a-f0-9]{64})\.json$/u.test(filename);
		if (skipped && !recognized) {
			skipped.push({ file: filename, reason: "unrecognized-file" });
			continue;
		}
		try {
			const path = `${local}/drafts/${filename}`;
			if (!recognized) throw new DraftStorageError("corrupt-storage", "Unknown local draft file");
			const text = await optionalText(root, path);
			if (text === null)
				throw new DraftStorageError("admission-race", "Draft disappeared during read");
			let parsed: z.infer<typeof bucketSchema> | z.infer<typeof legacyBucketSchema>;
			let bucket: z.infer<typeof bucketSchema>;
			try {
				parsed = parseEditorInput(z.union([bucketSchema, legacyBucketSchema]), JSON.parse(text));
				bucket = parseEditorInput(bucketSchema, {
					schema: 2,
					file: parsed.file,
					drafts: parsed.drafts,
				});
			} catch (error) {
				if (!(error instanceof SyntaxError || error instanceof z.ZodError)) throw error;
				corruptDraftErrors.add(error);
				throw error;
			}
			if (
				path !==
				(parsed.schema === 1 ? `${local}/drafts/${parsed.lessonId}.json` : bucketPath(bucket.file))
			)
				throw new DraftStorageError(
					"corrupt-storage",
					"Draft lesson identity differs from filename",
				);
			records.push({ path, text, bucket });
		} catch (error) {
			if (!skipped || (error instanceof DraftStorageError && error.reason === "unsafe-path"))
				throw error;
			skipped.push({
				file: filename,
				reason:
					error instanceof SyntaxError ||
					error instanceof z.ZodError ||
					error instanceof DraftStorageError
						? "invalid-draft"
						: "unreadable-file",
			});
		}
	}
	if (!skipped && new Set(records.map((record) => record.bucket.file)).size !== records.length)
		throw new DraftStorageError("corrupt-storage", "Duplicate draft lesson file");
	const ids = records.flatMap((record) => record.bucket.drafts.map((draft) => draft.id));
	if (!skipped && new Set(ids).size !== ids.length)
		throw new DraftStorageError("corrupt-storage", "Duplicate local draft ID");
	return records;
}

function bucketChanges(
	file: string,
	drafts: Draft[],
	existing?: Awaited<ReturnType<typeof buckets>>[number],
): ProjectFileChange[] {
	if (!drafts.length)
		return existing ? [{ path: existing.path, content: null, expectedContent: existing.text }] : [];
	const path = bucketPath(file);
	return [
		{
			path,
			content: JSON.stringify({ schema: 2, file, drafts }),
			expectedContent: existing?.path === path ? existing.text : null,
		},
		...(existing && existing.path !== path
			? [{ path: existing.path, content: null, expectedContent: existing.text }]
			: []),
	];
}

/** File buckets work before identity is stored. No session capability enters storage. */
export class LocalEditorStore {
	constructor(private readonly root: string) {}
	/** Diagnostic completion for persistence; legacy APIs retain their throwing contract. */
	async draftPersist(input: unknown): Promise<DraftPersistenceOutcome> {
		try {
			const operation = parseEditorInput(draftPersistenceOperationSchema, input);
			if (operation.action === "remove") {
				const { file, id, expectedDraft } = operation;
				return {
					status: "succeeded",
					writeResult: await this.draftDelete({ file, id }, expectedDraft),
				};
			}
			const { draft, expectedVersion } = operation;
			const result = await this.draftPut({ draft, expectedVersion });
			return result.ok
				? { status: "succeeded", writeResult: result.writeResult }
				: { status: "refused", code: result.code, reason: result.reason, stored: result.stored };
		} catch (error) {
			if (projectReadErrorKey(error) === "projectRecoveryConflict")
				return { status: "unknown", code: "EPROJECTRECOVERY" };
			if (error instanceof Error && corruptDraftErrors.has(error))
				return { status: "refused", reason: "corrupt-storage", code: "draft-corrupt-storage" };
			if (error instanceof DraftStorageError)
				return {
					status: "refused",
					reason: error.reason,
					code: `draft-${error.reason}`,
					...(error.stored ? { stored: error.stored } : {}),
				};
			if (error instanceof z.ZodError)
				return { status: "refused", reason: "invalid-input", code: "bad_schema" };
			const code = (error as NodeJS.ErrnoException | null)?.code;
			if (code === "EPROJECTBUSY" || code === "EFILEBUSY")
				return { status: "refused", reason: "busy", code };
			if (code === "ECONFLICT") return { status: "refused", reason: "admission-race", code };
			if (
				[
					"ERECOVERYREQUIRED",
					"EPROJECTFILESYSTEM",
					"ELOCKCACHE",
					"EACCES",
					"EPERM",
					"ENOSPC",
					"EROFS",
					"EPLAINYAML",
				].includes(code ?? "")
			)
				return { status: "refused", reason: "environment", code: code ?? "operation_failed" };
			return { status: "unknown", code: code ?? "operation_failed" };
		}
	}
	async draftList(): Promise<Draft[]> {
		return withProjectFileTransaction(
			this.root,
			async (root) => (await buckets(root)).flatMap((record) => record.bucket.drafts),
			"read",
		);
	}
	/** Recovery reads optional legacy files without weakening persistence's strict reader. */
	async draftInventory() {
		const skippedDraftFiles: SkippedDraftFile[] = [];
		const drafts = await withProjectFileTransaction(
			this.root,
			async (root) =>
				(await buckets(root, skippedDraftFiles)).flatMap((record) => record.bucket.drafts),
			"read",
		);
		return { drafts, skippedDraftFiles };
	}
	async draftExport(destination: string) {
		const { drafts, skippedDraftFiles } = await this.draftInventory();
		const requested = resolve(destination);
		const output = join(await realpath(dirname(requested)), basename(requested));
		const root = await realpath(this.root);
		if (isWithin(join(root, dirname(local)), output) || isProjectRecoveryPath(output))
			throw new DraftStorageError(
				"unsafe-path",
				"Draft exports cannot use metadata or recovery storage",
			);
		// A new folder and exclusive files preserve both existing exports and stored drafts.
		await mkdir(output);
		const files = [];
		for (const [index, draft] of drafts.entries()) {
			const name = `draft-${index + 1}.txt`;
			await createFileWithin(output, join(output, name), draft.text, "utf8");
			files.push({ id: draft.id, file: draft.file, path: name });
		}
		return { directory: output, files, skippedDraftFiles };
	}
	async draftPut(input: unknown): Promise<DraftPutResult> {
		const { draft, expectedVersion } = parseEditorInput(draftPutSchema, input);
		let refused: Extract<DraftPutResult, { ok: false }> | undefined;
		const writeResult = await acknowledgeProjectWrite(
			withProjectFileTransaction(
				this.root,
				async (root) => {
					const records = await buckets(root);
					// Ownership and generation checks run under the shared write admission,
					// including when separate windows submit concurrently.
					const owner = records
						.flatMap((record) => record.bucket.drafts)
						.find((saved) => saved.id === draft.id);
					const sameGeneration = owner && draft.generation === owner.generation;
					const exactRetry = sameGeneration && sameStoredVersion(draft, owner);
					const metadataUpdate =
						sameGeneration &&
						(draft.persistenceVersion ?? 0) > (owner.persistenceVersion ?? 0) &&
						expectedVersion === (owner.persistenceVersion ?? 0) &&
						draft.text === owner.text;
					const code =
						owner && !sameDraftTarget(owner, draft)
							? "conflict"
							: owner &&
									(draft.generation < owner.generation ||
										(sameGeneration && !exactRetry && !metadataUpdate))
								? "stale"
								: undefined;
					if (code && owner) {
						refused = {
							ok: false,
							code,
							message: { key: `op.${code}`, params: {} },
							reason:
								code === "conflict"
									? "target-conflict"
									: draft.generation < owner.generation
										? "superseded-generation"
										: "metadata-conflict",
							stored: owner,
						};
						return;
					}
					const existing = records.find((record) => record.bucket.file === draft.file);
					const path = bucketPath(draft.file);
					// Lost replies do not rewrite current buckets. Legacy retries still migrate atomically.
					if (exactRetry && existing?.path === path) return;
					if (!existing) {
						assertPath(draft.file);
						if (!(await readCourseManifestData(root)).lessonFilesOnDisk.includes(draft.file))
							throw new DraftStorageError(
								"missing-membership",
								"Draft lesson is not in this project",
							);
					}
					const drafts =
						exactRetry && existing
							? existing.bucket.drafts
							: [
									...(existing?.bucket.drafts ?? []).filter((saved) => saved.id !== draft.id),
									draft,
								];
					const { missing } = await checkedLocalPath(root, path);
					await applyProjectFilePlan(
						root,
						[...(await localIgnoreChange(root)), ...bucketChanges(draft.file, drafts, existing)],
						{ createDirectories: missing.filter((directory) => directory !== path) },
					);
				},
				"write",
				false,
			),
		);
		return refused ?? { ok: true, writeResult };
	}
	async draftDelete(input: unknown, expectedDraft?: Draft) {
		const { file, id } = parseEditorInput(draftDeleteSchema, input);
		return acknowledgeProjectWrite(
			withProjectFileTransaction(
				this.root,
				async (root) => {
					const record = (await buckets(root)).find((record) => record.bucket.file === file);
					const stored = record?.bucket.drafts.find((draft) => draft.id === id);
					if (!record || !stored) return;
					if (expectedDraft && !sameStoredVersion(expectedDraft, stored))
						throw new DraftStorageError(
							"metadata-conflict",
							"Stored draft changed before removal",
							undefined,
							stored,
						);
					const drafts = record.bucket.drafts.filter((draft) => draft.id !== id);
					await checkedLocalPath(root, bucketPath(file));
					await applyProjectFilePlan(root, bucketChanges(file, drafts, record));
				},
				"write",
				false,
			),
		);
	}
	async clipboardGet(): Promise<LocalClipboard | null> {
		return withProjectFileTransaction(
			this.root,
			async (root) => {
				const text = await optionalText(root, `${local}/clipboard.json`);
				return text === null
					? null
					: parseEditorInput(clipboardDocumentSchema, JSON.parse(text)).clipboard;
			},
			"read",
		);
	}
	async clipboardPut(clipboard: LocalClipboard | null) {
		clipboard = clipboard ? parseEditorInput(clipboardSchema, clipboard) : null;
		return acknowledgeProjectWrite(
			withProjectFileTransaction(
				this.root,
				async (root) => {
					const path = `${local}/clipboard.json`;
					const text = await optionalText(root, path);
					if (text !== null) parseEditorInput(clipboardDocumentSchema, JSON.parse(text));
					if (text === null && clipboard === null) return;
					const { missing } = await checkedLocalPath(root, path);
					await applyProjectFilePlan(
						root,
						[
							...(await localIgnoreChange(root)),
							{
								path,
								content: clipboard ? JSON.stringify({ schema: 1, clipboard }) : null,
								expectedContent: text,
							},
						],
						{ createDirectories: missing.filter((directory) => directory !== path) },
					);
				},
				"write",
				false,
			),
		);
	}
}
