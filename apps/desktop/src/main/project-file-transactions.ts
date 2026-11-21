import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import {
	access,
	chmod,
	link,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	rmdir,
	unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { preserveEditorLineEndings } from "../shared/editor-source";
import {
	ProjectBusyError,
	ProjectFilesystemUnsupportedError,
	ProjectPermissionError,
	ProjectPlainStoreError,
	ProjectReadAdmissionChangedError,
	ProjectRecoveryRequiredError,
	type ProjectWriteResult,
	projectReadErrorKey,
} from "../shared/project-write-errors";
import {
	assertAllowedProjectRoot,
	assertFileWritableWithin,
	createFileWithin,
	projectLockCacheDirectory,
	readFileWithin,
	resolveExistingPathWithin,
	resolveWritablePathWithin,
	waitForFileSharingRetry,
	withProjectPathAdmission,
	writeFileAtomicallyWithin,
	writeFileWithin,
} from "./path-security";
import { classifyIdentityLineagePath, isIdentityLineagePath } from "./project-protected-paths";

let pendingIdentityOperation: Promise<void> = Promise.resolve();
const isolatedCommittedArchives = new Map<string, string>();
const MAX_ISOLATED_ARCHIVES = 256;
async function archiveDirectoryIdentity(path: string): Promise<string | undefined> {
	const entry = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
		return undefined;
	});
	return entry?.isDirectory() && !entry.isSymbolicLink()
		? [entry.dev, entry.ino, entry.birthtimeNs, entry.mtimeNs, entry.ctimeNs].join(":")
		: undefined;
}
async function rememberCommittedArchive(root: string, stage: string): Promise<void> {
	const identity = await archiveDirectoryIdentity(stage);
	if (
		identity === undefined ||
		!(await verifiedOrphan(root, stage)) ||
		(await archiveDirectoryIdentity(stage)) !== identity
	)
		return;
	isolatedCommittedArchives.delete(stage);
	isolatedCommittedArchives.set(stage, identity);
	if (isolatedCommittedArchives.size > MAX_ISOLATED_ARCHIVES) {
		const oldest = isolatedCommittedArchives.keys().next().value;
		if (oldest !== undefined) isolatedCommittedArchives.delete(oldest);
	}
}
const transactions = new AsyncLocalStorage<{
	root: string;
	mode: "read" | "write";
	assertOwnership: () => void;
	cleanupErrors: unknown[];
	retainedStages: Set<string>;
	reclaimArchives: boolean;
	active: boolean;
	finalizers: Set<() => void>;
}>();

export function bindProjectWriteLifetime(root: string, revoke: () => void): () => boolean {
	const admission = transactions.getStore();
	if (!admission?.active || admission.root !== root || admission.mode !== "write")
		throw new Error("Project: write admission required");
	admission.finalizers.add(revoke);
	return () => admission.active && transactions.getStore() === admission;
}

class ProjectFileCleanupError extends Error {
	constructor(
		readonly result: unknown,
		readonly errors: unknown[],
	) {
		super(`Project transaction completed, but cleanup failed: ${errors.map(String).join("; ")}`);
	}
}

export async function acknowledgeProjectWrite(work: Promise<unknown>): Promise<ProjectWriteResult> {
	const { cleanupError } = await acknowledgeProjectResult(work);
	return cleanupError === undefined ? {} : { cleanupError };
}

export async function acknowledgeProjectResult<T>(
	work: Promise<T>,
): Promise<{ result: T } & ProjectWriteResult> {
	try {
		return { result: await work };
	} catch (error) {
		if (error instanceof ProjectFileCleanupError)
			return { result: error.result as T, cleanupError: error.message };
		throw error;
	}
}

export class ProjectFileConflictError extends Error {
	readonly code = "ECONFLICT";
	constructor(message = "File changed on disk: project write lock ownership was lost") {
		super(message);
	}
}

class ProjectTargetConflictError extends Error {
	constructor(
		readonly path: string,
		message: string,
		readonly code = "ECONFLICT",
		cause?: unknown,
	) {
		super(message, { cause });
	}
}

export function assertProjectFileTransactionOwnership(root: string): void {
	const transaction = transactions.getStore();
	if (!transaction || transaction.root !== root || transaction.mode !== "write")
		throw new ProjectFileConflictError();
	transaction.assertOwnership();
}

function projectLockPath(root: string): string {
	const key = createHash("sha256").update(courseKey(root)).digest("hex");
	return join(projectLockCacheDirectory(), `${key}.sqlite`);
}
async function acquireProjectLock(root: string, mode: "read" | "write") {
	const directory = projectLockCacheDirectory();
	if (mode === "write") await mkdir(directory, { recursive: true, mode: 0o700 });
	const path = projectLockPath(root);
	const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
		return undefined;
	});
	if (entry?.isSymbolicLink())
		throw new Error("Symbolic links are not allowed in the private lock cache");
	if (!entry && mode === "read") return null;
	const database = new DatabaseSync(path, { timeout: 0, readOnly: mode === "read" });
	const deadline = performance.now() + 5000;
	try {
		for (;;) {
			try {
				if (mode === "write") database.exec("BEGIN EXCLUSIVE");
				else {
					database.exec("BEGIN; PRAGMA schema_version;");
				}
				break;
			} catch (error) {
				if (mode === "read" && database.isTransaction) database.exec("ROLLBACK");
				const code = (error as { errcode?: number }).errcode;
				if (code === undefined || (code & 0xff) !== 5) throw error;
				if (performance.now() >= deadline) throw new ProjectBusyError();
				await delay(Math.min(50, Math.max(1, deadline - performance.now())));
			}
		}
	} catch (error) {
		try {
			database.close();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Project lock acquisition and cleanup failed",
				{ cause: error },
			);
		}
		throw error;
	}
	let active = true;
	return {
		assertOwnership: () => {
			if (!active) throw new ProjectFileConflictError();
		},
		release: () => {
			database.close();
			active = false;
		},
	};
}

export async function isNestedProjectDirectory(directory: string): Promise<boolean> {
	let found = false;
	for (const marker of ["course.yaml", ".praxity", "praxity.json", JOURNAL]) {
		try {
			await lstat(join(directory, marker));
			found = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return found;
}

async function assertReadAdmission(root: string, locked: boolean): Promise<void> {
	if ((await currentBytes(root, join(root, JOURNAL))) !== null)
		throw new ProjectRecoveryRequiredError();
	if (!locked) {
		const entry = await lstat(projectLockPath(root)).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
			return undefined;
		});
		if (entry) throw new ProjectReadAdmissionChangedError();
	}
}

async function removeAbandonedStages(root: string, directory = root): Promise<void> {
	if (directory !== root && (await isNestedProjectDirectory(directory))) return;
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		if (
			entry.name === ".git" ||
			entry.name === "node_modules" ||
			entry.name === ".praxity-identity.lock"
		)
			continue;
		const path = await resolveWritablePathWithin(root, join(directory, entry.name));
		if (entry.name.startsWith(".praxity-write-")) {
			const known = isolatedCommittedArchives.get(path);
			if (known !== undefined) {
				if (
					!transactions.getStore()?.reclaimArchives &&
					(await archiveDirectoryIdentity(path)) === known
				)
					continue;
				isolatedCommittedArchives.delete(path);
			}
			if (
				(directory === root ||
					(directory === join(root, ".praxity") &&
						entry.name.startsWith(".praxity-write-content-identity.json."))) &&
				(await readdir(path)).length === 0
			) {
				await removeEmptyDirectory(root, path);
				continue;
			}
			if (transactions.getStore()?.retainedStages.has(path)) continue;
			await isolateStage(root, path);
			const journal = await verifiedOrphan(root, path, true);
			if (journal) {
				if (typeof journal === "object" && touchesProtectedPaths(journal.plan.files)) continue;
				if (!transactions.getStore()?.reclaimArchives && (await hasCaptures(path))) continue;
				await reclaimStage(root, path);
			}
		} else await removeAbandonedStages(root, path);
	}
}

export function assertProjectWritesAllowed(): void {
	if (process.permission) throw new ProjectPermissionError();
}

export async function withProjectFileTransaction<T>(
	courseDir: string,
	work: (root: string) => Promise<T>,
	mode: "read" | "write" = "read",
	reclaimArchives = true,
): Promise<T> {
	if (mode === "write") assertProjectWritesAllowed();
	const active = transactions.getStore();
	if (active?.active) {
		return assertAllowedProjectRoot(courseDir).then((root) => {
			if (root !== active.root || (mode === "write" && active.mode !== "write"))
				throw new ProjectFileConflictError();
			active.assertOwnership();
			return work(root);
		});
	}
	const operation = pendingIdentityOperation.then(async () => {
		const root = await assertAllowedProjectRoot(courseDir);
		const ownership = await acquireProjectLock(root, mode);
		const cleanupErrors: unknown[] = [];
		const admission = {
			root,
			mode,
			assertOwnership: ownership?.assertOwnership ?? (() => {}),
			cleanupErrors,
			retainedStages: new Set<string>(),
			reclaimArchives,
			active: true,
			finalizers: new Set<() => void>(),
		};
		let result: T;
		try {
			result = await transactions.run(admission, () =>
				withProjectPathAdmission(root, async () => {
					if (mode === "write") {
						if (!ownership) throw new ProjectFileConflictError();
						await recoverProjectFileJournal(root, ownership.assertOwnership);
						await removeAbandonedStages(root);
						return work(root);
					}
					await assertReadAdmission(root, ownership !== null);
					const read = await work(root);
					await assertReadAdmission(root, ownership !== null);
					return read;
				}),
			);
		} catch (error) {
			try {
				ownership?.release();
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
			if (cleanupErrors.length)
				throw new AggregateError(
					[error, ...cleanupErrors],
					"Project transaction refused and cleanup failed",
					{ cause: error },
				);
			throw error;
		} finally {
			admission.active = false;
			for (const revoke of admission.finalizers) revoke();
			admission.finalizers.clear();
		}
		try {
			ownership?.release();
		} catch (error) {
			cleanupErrors.push(error);
		}
		if (cleanupErrors.length) throw new ProjectFileCleanupError(result, cleanupErrors);
		return result;
	});
	pendingIdentityOperation = operation.then(
		() => {},
		() => {},
	);
	return operation;
}

const JOURNAL = ".praxity-transaction.json";
export function isProjectRecoveryPath(path: string): boolean {
	return path
		.split(/[/\\]/)
		.some(
			(part) => part.toLowerCase() === JOURNAL || part.toLowerCase().startsWith(".praxity-write-"),
		);
}

export type ProjectRecoveryEvidence = { readonly path: string } & (
	| { readonly outcome: "unknown" }
	| {
			readonly outcome: "committed" | "rolled-back";
			readonly files: readonly {
				readonly path: string;
				readonly hadOriginal: boolean;
				readonly installed: boolean;
			}[];
	  }
);

async function recoveryEntries(root: string) {
	const found: { path: string; archive: boolean }[] = [];
	for (const directory of [".", ".praxity"]) {
		let entries: Dirent[];
		try {
			const safe = await resolveExistingPathWithin(root, join(root, directory));
			entries = await readdir(safe, { withFileTypes: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		for (const entry of entries) {
			if (!isProjectRecoveryPath(entry.name)) continue;
			found.push({
				path: directory === "." ? entry.name : `${directory}/${entry.name}`,
				archive: directory === "." && entry.isDirectory() && !entry.isSymbolicLink(),
			});
		}
	}
	return found;
}

async function archiveEvidence(root: string, path: string): Promise<ProjectRecoveryEvidence> {
	const unknown: ProjectRecoveryEvidence = { path, outcome: "unknown" };
	const stage = join(root, path);
	try {
		const before = await stageFingerprint(root, stage);
		const journal = await verifiedOrphan(root, stage);
		if (typeof journal !== "object") return unknown;
		if (journal.plan.files.some((file) => classifyIdentityLineagePath(file.path) === "unknown"))
			return unknown;
		const marker = async (name: string) => (await currentBytes(root, join(stage, name))) !== null;
		const aborted = await marker("abort");
		const committed = await marker("committed");
		if (aborted && committed) return unknown;
		const installed: boolean[] = [];
		let installationStarted = false;
		for (const index of journal.plan.files.keys()) {
			installed.push(await marker(`installed-${index}`));
			installationStarted ||= installed[index] || (await marker(`installed-${index}.tmp`));
		}
		const ready = await marker("ready");
		const unpublished =
			!ready &&
			!committed &&
			!installationStarted &&
			!(await marker("committed.tmp")) &&
			!(await hasCaptures(stage)) &&
			(await currentBytes(root, join(root, JOURNAL))) === null;
		const outcome = aborted
			? "rolled-back"
			: committed || (ready && installed.length > 0 && installed.every(Boolean))
				? "committed"
				: unpublished
					? "rolled-back"
					: "unknown";
		if (outcome === "unknown" || (await stageFingerprint(root, stage)) !== before) return unknown;
		return {
			path,
			outcome,
			files: journal.plan.files.map((file, index) => ({
				path: file.path,
				hadOriginal: file.from !== null,
				installed: committed || installed[index],
			})),
		};
	} catch {
		return unknown;
	}
}

export async function readProjectRecoveryEvidence(
	courseDir: string,
): Promise<readonly ProjectRecoveryEvidence[]> {
	try {
		return await withProjectFileTransaction(courseDir, async (root) => {
			const entries = await recoveryEntries(root);
			const active = (await currentBytes(root, join(root, JOURNAL))) !== null;
			const evidence: ProjectRecoveryEvidence[] = [];
			for (const { path, archive } of entries)
				evidence.push(
					archive && !active ? await archiveEvidence(root, path) : { path, outcome: "unknown" },
				);
			return evidence;
		});
	} catch (error) {
		if (!(error instanceof ProjectRecoveryRequiredError)) throw error;
		const entries = await recoveryEntries(await assertAllowedProjectRoot(courseDir));
		if (!entries.some(({ path }) => path === JOURNAL))
			entries.push({ path: JOURNAL, archive: false });
		return entries.map(({ path }) => ({ path, outcome: "unknown" }));
	}
}

function touchesProtectedPaths(files: readonly { readonly path: string }[]): boolean {
	return files.some((file) => classifyIdentityLineagePath(file.path) !== "ordinary");
}

export async function reclaimProtectedArchives(
	root: string,
	keep: (paths: readonly string[]) => Promise<boolean>,
): Promise<void> {
	assertProjectFileTransactionOwnership(root);
	assertProjectWritesAllowed();
	try {
		if ((await currentBytes(root, join(root, JOURNAL))) !== null) return;
		let remaining = 3;
		for (const { path, archive } of await recoveryEntries(root)) {
			if (!archive) continue;
			if ((await currentBytes(root, join(root, path, "held"))) !== null) continue;
			if (remaining-- === 0) break;
			const evidence = await archiveEvidence(root, path);
			if (evidence.outcome === "unknown" || !touchesProtectedPaths(evidence.files)) continue;
			await reclaimStage(root, join(root, path), false, false, keep);
		}
	} catch (error) {
		throw new ProjectFileCleanupError(undefined, [error]);
	}
}

export async function projectRecoveryArchives(
	root: string,
	includeVerified = false,
): Promise<string[]> {
	const stages = (await readdir(root, { withFileTypes: true }))
		.filter(
			(entry) =>
				entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith(".praxity-write-"),
		)
		.map((entry) => entry.name)
		.sort();
	if (includeVerified) return stages;
	const attention: string[] = [];
	for (const stage of stages)
		if (!(await verifiedOrphan(root, join(root, stage)))) attention.push(stage);
	return attention;
}

interface RecoveryArchive {
	stage: string;
	files: Array<{ path: string; fromHash: string | null; toHash: string | null }>;
	status: "conflict" | "held" | "unverified";
}
async function readRecoveryArchive(
	root: string,
	stage: string,
): Promise<{ archive: RecoveryArchive; journal?: Journal }> {
	if (!stage.startsWith(".praxity-write-") || /[/\\\0]/.test(stage))
		throw new Error("Invalid recovery archive name");
	const path = await resolveWritablePathWithin(root, join(root, stage));
	if (!(await lstat(path)).isDirectory()) throw new Error("Recovery archive is not a directory");
	const source = await currentBytes(root, join(path, "journal.tmp"));
	let journal: Journal | undefined;
	try {
		if (source !== null) journal = validateJournal(JSON.parse(source.toString("utf8")), root);
	} catch {}
	if (journal && !archiveMatches(journal.plan.stage, stage)) journal = undefined;
	let status: RecoveryArchive["status"] = "unverified";
	if ((await currentBytes(root, join(path, "conflict"))) !== null) status = "conflict";
	else {
		try {
			if (
				(await currentBytes(root, join(path, "held"))) !== null &&
				(await verifiedOrphan(root, path))
			)
				status = "held";
		} catch {}
	}
	return {
		journal,
		archive: {
			stage,
			status,
			files:
				journal?.plan.files.map(({ path, fromHash, toHash }) => ({ path, fromHash, toHash })) ?? [],
		},
	};
}
async function withRecovery<T>(
	courseDir: string,
	work: (root: string) => Promise<T>,
	mode: "read" | "write" = "read",
): Promise<T> {
	try {
		return await withProjectFileTransaction(courseDir, work, mode, false);
	} catch (error) {
		if (projectReadErrorKey(error) !== "projectRecoveryConflict") throw error;
		return withProjectFileTransaction(courseDir, work, mode, false);
	}
}
export function listProjectRecovery(courseDir: string): Promise<RecoveryArchive[]> {
	return withRecovery(courseDir, async (root) =>
		Promise.all(
			(await projectRecoveryArchives(root, true)).map(
				async (stage) => (await readRecoveryArchive(root, stage)).archive,
			),
		),
	);
}
export function extractProjectRecovery(
	courseDir: string,
	stage: string,
	destination: string,
): Promise<void> {
	return withRecovery(
		courseDir,
		async (root) => {
			const { journal } = await readRecoveryArchive(root, stage);
			const output = resolve(destination);
			if (isProjectRecoveryPath(output))
				throw new Error("Extraction destination cannot be a recovery archive");
			await mkdir(output);
			async function emit(path: string, bytes: Uint8Array) {
				await mkdir(dirname(join(output, path)), { recursive: true });
				await createFileWithin(output, join(output, path), bytes);
				await syncFile(output, join(output, path));
				await syncDirectory(dirname(join(output, path)));
			}
			for (const file of journal?.plan.files ?? []) {
				if (file.from !== null) await emit(`original/${file.path}`, decode(file.from) as Buffer);
				if (file.to !== null) await emit(`replacement/${file.path}`, decode(file.to) as Buffer);
			}
			async function copy(directory: string, prefix: string) {
				for (const entry of await readdir(directory, { withFileTypes: true })) {
					const path = await resolveWritablePathWithin(root, join(directory, entry.name));
					if (entry.isSymbolicLink()) throw new Error("Unsafe recovery archive entry");
					if (entry.isDirectory()) await copy(path, `${prefix}/${entry.name}`);
					else if (entry.isFile())
						await emit(`${prefix}/${entry.name}`, (await readFileWithin(root, path)) as Buffer);
					else throw new Error("Invalid recovery archive entry");
				}
			}
			await copy(join(root, stage), "captured");
			await syncDirectory(output);
		},
		"write",
	);
}
export class ProjectRecoveryRestoreError extends Error {
	constructor(readonly reason: "restoreSide" | "restoreJournal" | "restoreCopy") {
		super(`Recovery restore refused: ${reason}`);
	}
}

export class ProjectRecoveryRestoreHeldError extends Error {
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
	}
}

export function restoreProjectRecovery(
	courseDir: string,
	stage: string,
	side: string,
	path: string,
): Promise<void> {
	return withRecovery(
		courseDir,
		async (root) => {
			if (side !== "original" && side !== "replacement")
				throw new ProjectRecoveryRestoreError("restoreSide");
			const { journal } = await readRecoveryArchive(root, stage);
			if (!journal) throw new ProjectRecoveryRestoreError("restoreJournal");
			const file = journal.plan.files.find((file) => file.path === path);
			const bytes = file ? decode(side === "original" ? file.from : file.to) : null;
			if (bytes === null) throw new ProjectRecoveryRestoreError("restoreCopy");
			const directories: string[] = [];
			for (let directory = dirname(path); directory !== "."; directory = dirname(directory)) {
				try {
					await lstat(await resolveExistingPathWithin(root, join(root, directory)));
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					directories.unshift(directory);
				}
			}
			await publishMarker(root, join(root, stage, "held"), journal.checksum);
			try {
				await applyProjectFilePlan(root, [{ path, content: bytes }], {
					createDirectories: directories,
				});
			} catch (error) {
				throw new ProjectRecoveryRestoreHeldError(error);
			}
		},
		"write",
	);
}

export function resolveProjectRecovery(courseDir: string, stage: string): Promise<void> {
	return withRecovery(
		courseDir,
		async (root) => {
			await readRecoveryArchive(root, stage);
			await reclaimStage(root, join(root, stage), true);
			await syncDirectory(root);
		},
		"write",
	);
}

export async function excludeProjectFilesFromGit(
	root: string,
	mode: "append" | "check" | "replace" = "append",
): Promise<"updated" | "unchanged" | "not-git"> {
	if (mode !== "check") assertProjectWritesAllowed();
	let repository = root;
	let gitDirectory: string | undefined;
	for (;;) {
		const gitPath = join(repository, ".git");
		if (repository !== root && process.permission && !process.permission.has("fs.read", gitPath))
			return "not-git";
		const entry = await lstat(gitPath).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
			return undefined;
		});
		if (entry) {
			if (entry.isSymbolicLink()) throw new Error("Symbolic Git metadata is not allowed");
			if (entry.isDirectory()) gitDirectory = gitPath;
			else {
				const match = /^gitdir: (.+)\r?\n?$/.exec(await readFile(gitPath, "utf8"));
				if (!match) throw new Error("Invalid Git directory reference");
				gitDirectory = resolve(repository, match[1]);
			}
			break;
		}
		const parent = dirname(repository);
		if (parent === repository) return "not-git";
		repository = parent;
	}
	const common = await readFile(join(gitDirectory, "commondir"), "utf8").catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
			return undefined;
		},
	);
	const metadata = await realpath(
		common === undefined ? gitDirectory : resolve(gitDirectory, common.trim()),
	);
	const ownership = await acquireProjectLock(metadata, "write");
	if (!ownership) throw new ProjectFileConflictError();
	try {
		const exclude = join(metadata, "info", "exclude");
		const prefix = relative(repository, root)
			.replaceAll("\\", "/")
			.replace(/[\\*?[\]!# ]/g, "\\$&");
		const rules = [".praxity-transaction.json", ".praxity-write-*/"].map(
			(name) => `/${prefix ? `${prefix}/` : ""}**/${name}`,
		);
		const info = await resolveWritablePathWithin(metadata, dirname(exclude));
		if (mode !== "check") await mkdir(info, { recursive: true });
		if (mode !== "check") await resolveWritablePathWithin(metadata, exclude);
		const entry = await lstat(exclude).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
			return undefined;
		});
		if (entry?.isSymbolicLink()) throw new Error("Symbolic Git exclusions are not allowed");
		if (mode !== "append" && entry) await assertFileWritableWithin(metadata, exclude);
		const original = entry ? await readFile(exclude) : Buffer.alloc(0);
		const missing = rules.filter(
			(rule) => !original.toString("utf8").split(/\r?\n/).includes(rule),
		);
		if (!missing.length) return "unchanged";
		if (mode === "check") return "updated";
		if (mode === "replace") {
			await writeFileAtomicallyWithin(
				metadata,
				exclude,
				Buffer.concat([original, Buffer.from(`\n${missing.join("\n")}\n`)]),
			);
			await syncDirectory(info);
			return "updated";
		}
		const file = await open(
			await resolveWritablePathWithin(metadata, exclude),
			constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
			entry ? entry.mode & 0o777 : 0o600,
		);
		try {
			await file.writeFile(`\n${missing.join("\n")}\n`);
			await file.sync();
		} finally {
			await file.close();
		}
		await syncDirectory(info);
		const current = await readFile(await resolveWritablePathWithin(metadata, exclude), "utf8");
		if (!rules.every((rule) => current.split(/\r?\n/).includes(rule)))
			throw new Error("Git exclusions changed on disk; retry the save");
		return "updated";
	} finally {
		ownership.release();
	}
}

async function verifiedOrphan(
	root: string,
	stage: string,
	markConflicts = false,
): Promise<boolean | Journal> {
	const bytes = await currentBytes(root, join(stage, "journal.tmp"));
	if ((await currentBytes(root, join(stage, "conflict"))) !== null) return false;
	let journal: Journal;
	try {
		journal = validateJournal(JSON.parse(bytes?.toString("utf8") ?? ""), root);
	} catch {
		if ((await currentBytes(root, join(root, JOURNAL))) !== null) return false;
		const entries = await readdir(stage, { withFileTypes: true });
		if (!entries.length) return false;
		for (const entry of entries) {
			if (!entry.isFile() || !["journal.tmp", "journal.publish"].includes(entry.name)) return false;
			if (
				!unpublishedJournalPrefix(
					(await currentBytes(root, join(stage, entry.name))) as Buffer,
					root,
					basename(stage),
				)
			)
				return false;
		}
		return true;
	}
	if (!archiveMatches(journal.plan.stage, basename(stage))) return false;
	const expected = new Map<string, Buffer | null>([["journal.tmp", bytes]]);
	expected.set("journal.retired", bytes);
	expected.set("journal.publish", bytes);
	for (const marker of ["ready", "abort", "committed", "held"])
		for (const suffix of ["", ".tmp"]) expected.set(marker + suffix, Buffer.from(journal.checksum));
	for (const [index, file] of journal.plan.files.entries()) {
		for (const suffix of ["", ".tmp"])
			expected.set(`installed-${index}${suffix}`, Buffer.from(journal.checksum));
		for (const suffix of ["", ".tmp"])
			expected.set(`staged-${index}${suffix}`, Buffer.from(journal.checksum));
		if (journal.plan.stageVersion === undefined)
			expected.set(`${index}/${basename(file.path)}`, decode(file.to));
		expected.set(`install-${index}`, decode(file.to));
		expected.set(`rollback-${index}`, decode(file.from));
	}
	async function verify(directory: string, prefix = ""): Promise<boolean> {
		let verified = true;
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const actualName = prefix + entry.name;
			const name = actualName.replace(/(?:\.(?:independent|reclaim)-[0-9a-f-]+)+$/, "");
			const candidate = entry.isFile()
				? await currentBytes(root, join(directory, entry.name))
				: null;
			let partial =
				name.endsWith(".tmp") || name === "journal.publish" || /\.independent-/.test(actualName);
			const capture =
				/^(install|rollback)-(\d+)(?:\.attempt-[0-9a-f-]+)?\.capture-[0-9a-f-]+$/.exec(name);
			const cleanupCapture =
				/^(install|rollback)-(\d+)(?:\.attempt-[0-9a-f-]+)?\.cleanup\.capture-[0-9a-f-]+$/.exec(
					name,
				);
			const captured = cleanupCapture ?? capture;
			if (captured && journal.plan.files[Number(captured[2])]) {
				const file = journal.plan.files[Number(captured[2])];
				const replacement = (captured[1] === "install") === Boolean(cleanupCapture);
				expected.set(name, decode(replacement ? file.to : file.from));
				if (!matchesPlannedBytes(candidate, expected.get(name), partial)) {
					if (markConflicts) await publishMarker(root, join(stage, "conflict"), journal.checksum);
					return false;
				}
			}
			const rollbackMarker =
				/^rollback-(\d+)\.attempt-[0-9a-f-]+\.capture-[0-9a-f-]+\.(intent|displaced|completed)(?:\.tmp)?$/.exec(
					name,
				);
			if (rollbackMarker && journal.plan.files[Number(rollbackMarker[1])])
				expected.set(name, Buffer.from(journal.checksum));
			const attempt = /^rollback-(\d+)\.attempt-[0-9a-f-]+$/.exec(name);
			if (attempt && journal.plan.files[Number(attempt[1])])
				expected.set(name, decode(journal.plan.files[Number(attempt[1])].from));
			partial ||= Boolean(attempt) || /^(install|rollback)-\d+$/.test(name) || /^\d+\//.test(name);
			const restoration =
				/^(install|rollback)-(\d+)(?:\.attempt-[0-9a-f-]+)?(?:\.capture-[0-9a-f-]+)?\.restore-[0-9a-f-]+$/.exec(
					name,
				);
			if (restoration && journal.plan.files[Number(restoration[2])]) {
				const file = journal.plan.files[Number(restoration[2])];
				expected.set(
					name,
					decode(restoration[1] === "install" || !name.includes(".capture-") ? file.from : file.to),
				);
				partial = true;
			}
			const identity =
				/^(?:install|rollback)-(\d+)(?:\.attempt-[0-9a-f-]+)?\.identity(?:\.tmp)?$/.exec(name);
			if (identity) {
				if (!journal.plan.files[Number(identity[1])] || candidate === null) return false;
				try {
					parseInstallationIdentity(candidate, journal.checksum);
				} catch {
					if (!installationIdentityPrefix(candidate, journal.checksum)) return false;
				}
				expected.set(name, candidate);
			}
			if (
				entry.isDirectory() &&
				journal.plan.stageVersion === undefined &&
				!prefix &&
				/^\d+$/.test(name) &&
				Number(name) < journal.plan.files.length
			) {
				if (!(await verify(join(directory, entry.name), `${name}/`))) verified = false;
			} else {
				if (!entry.isFile() || !expected.has(name)) {
					verified = false;
					continue;
				}
				if (!matchesPlannedBytes(candidate, expected.get(name), partial)) verified = false;
			}
		}
		return verified;
	}
	return (await verify(stage)) ? journal : false;
}

function matchesPlannedBytes(
	bytes: Buffer | null,
	planned: Buffer | null | undefined,
	partial: boolean,
): boolean {
	if (bytes === null || planned === undefined || planned === null) return bytes === planned;
	return partial
		? bytes.length <= planned.length && bytes.equals(planned.subarray(0, bytes.length))
		: bytes.equals(planned);
}

function unpublishedJournalPrefix(bytes: Buffer, root: string, stage: string): boolean {
	const text = bytes.toString("utf8");
	try {
		const journal = validateJournal(JSON.parse(text), root);
		return archiveMatches(journal.plan.stage, stage);
	} catch (error) {
		if (
			!(error instanceof SyntaxError) ||
			(!/Unexpected end|Unterminated string/.test(error.message) &&
				Number(/position (\d+)/.exec(error.message)?.[1]) !== text.length)
		)
			return false;
	}
	const originalStage = stage.replace(/(?:\.reclaim-[0-9a-f-]+)+$/, "");
	return [root, courseKey(root)].some((course) =>
		[
			{ version: 1, captureVersion: 2, stageVersion: 1, course, stage: originalStage },
			{ version: 1, captureVersion: 1, course, stage: originalStage },
			{ version: 1, course, stage: originalStage },
		].some((plan) => {
			const header = `${JSON.stringify({ plan }).slice(0, -2)},"files":[`;
			return header.startsWith(text) || text.startsWith(header);
		}),
	);
}

function installationIdentityPrefix(bytes: Buffer, checksum: string): boolean {
	const text = bytes.toString("utf8"),
		header = `{"checksum":${JSON.stringify(checksum)},"dev":"`;
	if (header.startsWith(text)) return true;
	if (!text.startsWith(header)) return false;
	const tail = text.slice(header.length);
	if (/^\d*$/.test(tail)) return true;
	const device = /^(\d+)"/.exec(tail);
	if (!device) return false;
	const inodeHeader = `${device[1]}","ino":"`;
	if (inodeHeader.startsWith(tail)) return true;
	return (
		(tail.startsWith(inodeHeader) && /^\d+(?:"\}?)?$/.test(tail.slice(inodeHeader.length))) ||
		tail === inodeHeader
	);
}

export interface ProjectFileChange {
	path: string;
	content: string | Uint8Array | null;
	expectedContent?: string | Uint8Array | null;
	head?: boolean;
	conflictMessage?: string;
}

export interface ProjectFilePlanOptions {
	createDirectories?: readonly string[];
	onStep?: (step: {
		kind: "journal" | "staged" | "installed" | "head";
		index?: number;
	}) => Promise<void>;
}

interface JournalFile {
	path: string;
	from: string | null;
	to: string | null;
	fromHash: string | null;
	toHash: string | null;
	mode: number;
	head: boolean;
}
interface JournalPlan {
	version: 1;
	captureVersion?: 1 | 2;
	stageVersion?: 1;
	course: string;
	stage: string;
	files: JournalFile[];
	directories?: string[];
}
interface Journal {
	plan: JournalPlan;
	checksum: string;
}

function hash(bytes: string | Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}
function courseKey(root: string): string {
	return process.platform === "win32" || process.platform === "darwin" ? root.toLowerCase() : root;
}
function encode(bytes: string | Uint8Array | null): string | null {
	return bytes === null ? null : Buffer.from(bytes).toString("base64");
}
function decode(bytes: string | null): Buffer | null {
	return bytes === null ? null : Buffer.from(bytes, "base64");
}
function byteHash(bytes: Buffer | null): string | null {
	return bytes === null ? null : hash(bytes);
}
function assertFilePath(path: string): void {
	if (
		!path ||
		isAbsolute(path) ||
		path.includes("\\") ||
		path.includes("\0") ||
		(process.platform === "win32" && path.includes(":")) ||
		path
			.split("/")
			.some(
				(part) => !part || part === "." || part === ".." || part.startsWith(".praxity-write-"),
			) ||
		isProjectRecoveryPath(path)
	)
		throw new Error("Invalid project journal file path");
}
function assertRegularFile(entry: Pick<Stats, "isFile">): void {
	if (!entry.isFile()) throw new Error("Project transaction target is not a regular file");
}
async function currentBytes(root: string, path: string): Promise<Buffer | null> {
	try {
		const target = await resolveWritablePathWithin(root, path);
		assertRegularFile(await lstat(target));
		return (await readFileWithin(root, target)) as Buffer;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return null;
	}
}

export interface ProjectFileFlushes {
	syncFile(root: string, path: string): Promise<void>;
	syncDirectory(path: string): Promise<void>;
}

export const defaultProjectFileFlushes: Readonly<ProjectFileFlushes> = Object.freeze({
	syncFile: defaultSyncFile,
	syncDirectory: defaultSyncDirectory,
});
const fileFlushes = new AsyncLocalStorage<ProjectFileFlushes>();

export function withProjectFileFlushes<T>(flushes: ProjectFileFlushes, work: () => T): T {
	return fileFlushes.run(flushes, work);
}

function syncFile(root: string, path: string): Promise<void> {
	return (fileFlushes.getStore() ?? defaultProjectFileFlushes).syncFile(root, path);
}
function syncDirectory(path: string): Promise<void> {
	return (fileFlushes.getStore() ?? defaultProjectFileFlushes).syncDirectory(path);
}

export const projectFileFlushes: ProjectFileFlushes = { syncFile, syncDirectory };

async function defaultSyncFile(root: string, path: string): Promise<void> {
	const target = await resolveWritablePathWithin(root, path);
	const handle = await open(target, constants.O_RDWR | constants.O_NOFOLLOW);
	try {
		assertRegularFile(await handle.stat());
		await handle.sync();
	} finally {
		await handle.close();
	}
}
async function defaultSyncDirectory(path: string): Promise<void> {
	if (process.platform === "win32") return;
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}
async function durableWrite(root: string, path: string, bytes: string | Uint8Array): Promise<void> {
	await writeFileWithin(root, path, bytes);
	await syncFile(root, path);
	await syncDirectory(dirname(path));
}
const FILE_STAGE_BATCH_SIZE = 4;
async function completeFileWork(work: readonly Promise<void>[]): Promise<void> {
	let failure: { reason: unknown } | undefined;
	await Promise.allSettled(
		work.map((item) =>
			item.catch((reason: unknown) => {
				failure ??= { reason };
				throw reason;
			}),
		),
	);
	if (failure) throw failure.reason;
}
async function publishMarker(root: string, path: string, checksum: string): Promise<void> {
	const temporary = `${path}.tmp`;
	await durableWrite(root, temporary, checksum);
	await rename(temporary, await resolveWritablePathWithin(root, path));
	if (process.platform === "win32") await syncFile(root, path);
	await syncDirectory(dirname(path));
}
function stagedPath(root: string, plan: JournalPlan, index: number): string {
	if (plan.stageVersion === 1) return join(root, plan.stage, `install-${index}`);
	return join(root, plan.stage, String(index), basename(plan.files[index].path));
}

function validateJournal(value: unknown, root: string): Journal {
	const invalid = () => {
		throw new Error("Invalid project transaction journal");
	};
	if (!value || typeof value !== "object") return invalid();
	const journal = value as Journal;
	const plan = journal.plan;
	if (
		plan?.version !== 1 ||
		(plan.captureVersion !== undefined && ![1, 2].includes(plan.captureVersion)) ||
		(plan.stageVersion !== undefined && (plan.stageVersion !== 1 || plan.captureVersion !== 2)) ||
		typeof plan.course !== "string" ||
		courseKey(plan.course) !== courseKey(root) ||
		typeof plan.stage !== "string" ||
		!/^\.praxity-write-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
			plan.stage,
		) ||
		!Array.isArray(plan.files) ||
		(!plan.files.length && !plan.directories?.length) ||
		typeof journal.checksum !== "string" ||
		hash(JSON.stringify(plan)) !== journal.checksum
	)
		return invalid();
	if (plan.directories !== undefined) {
		if (!Array.isArray(plan.directories)) return invalid();
		const directories = new Set<string>();
		for (const directory of plan.directories) {
			if (typeof directory !== "string") return invalid();
			assertFilePath(directory);
			if (directories.has(courseKey(directory))) return invalid();
			directories.add(courseKey(directory));
		}
	}
	const paths = new Set<string>();
	for (const file of plan.files) {
		if (
			!file ||
			typeof file.path !== "string" ||
			typeof file.head !== "boolean" ||
			!Number.isInteger(file.mode) ||
			file.mode < 0 ||
			file.mode > 0o7777
		)
			return invalid();
		assertFilePath(file.path);
		const key = courseKey(file.path);
		if (paths.has(key)) return invalid();
		paths.add(key);
		for (const [bytes, expectedHash] of [
			[file.from, file.fromHash],
			[file.to, file.toHash],
		]) {
			if (bytes === null && expectedHash === null) continue;
			if (typeof bytes !== "string" || typeof expectedHash !== "string") return invalid();
			const decoded = Buffer.from(bytes, "base64");
			if (decoded.toString("base64") !== bytes || hash(decoded) !== expectedHash) return invalid();
		}
	}
	return journal;
}

function archiveMatches(stage: string, name: string): boolean {
	return (
		name === stage ||
		new RegExp(`^${stage.replaceAll(".", "\\.")}(?:\\.reclaim-[0-9a-f-]+)+$`).test(name)
	);
}

async function stageFingerprint(root: string, directory: string): Promise<string> {
	const entries: string[] = [];
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		const path = join(directory, entry.name);
		entries.push(
			entry.name,
			entry.isDirectory()
				? await stageFingerprint(root, path)
				: (byteHash(await currentBytes(root, path)) as string),
		);
	}
	return hash(JSON.stringify(entries));
}
async function reclaimStage(
	root: string,
	path: string,
	explicit = false,
	ownedPreparation = false,
	keep?: (paths: readonly string[]) => Promise<boolean>,
): Promise<void> {
	const retain = async (stage: string) => {
		if ((await currentBytes(root, join(stage, "held"))) !== null) return true;
		const journal = await verifiedOrphan(root, stage);
		if (typeof journal !== "object" || !touchesProtectedPaths(journal.plan.files)) return false;
		if (!keep) return true;
		const evidence = await archiveEvidence(root, relative(root, stage).replaceAll("\\", "/"));
		return (
			evidence.outcome === "unknown" ||
			(await keep(
				evidence.files
					.filter(
						(file) => file.hadOriginal || (evidence.outcome === "committed" && file.installed),
					)
					.map((file) => file.path),
			))
		);
	};
	if (!explicit && (await retain(path))) return;
	const expected = ownedPreparation ? await stageFingerprint(root, path) : undefined;
	const quarantine = `${path.replace(/(?:\.reclaim-[0-9a-f-]+)+$/, "")}.reclaim-${randomUUID()}`;
	await rename(await resolveWritablePathWithin(root, path), quarantine);
	await syncDirectory(dirname(path));
	if (
		!explicit &&
		(expected !== undefined
			? (await stageFingerprint(root, quarantine)) !== expected
			: !(await verifiedOrphan(root, quarantine, true)))
	)
		return;
	if (!explicit && (await retain(quarantine))) return;
	await rm(quarantine, { recursive: true });
	await syncDirectory(dirname(path));
}

async function removeEmptyDirectory(root: string, path: string): Promise<void> {
	if ((await readdir(path)).length) return;
	const quarantine = join(root, `.praxity-write-empty-${randomUUID()}`);
	await rename(await resolveWritablePathWithin(root, path), quarantine);
	await syncDirectory(dirname(path));
	if ((await readdir(quarantine)).length) {
		try {
			await lstat(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			await rename(quarantine, path);
			await syncDirectory(dirname(path));
		}
		return;
	}
	await rmdir(quarantine);
	await syncDirectory(root);
}

async function consumePublication(
	root: string,
	source: string,
	target: string,
	expectedHash: string,
	quarantine = `${source}.reclaim-${randomUUID()}`,
	privateCopy = false,
): Promise<void> {
	await rename(await resolveWritablePathWithin(root, source), quarantine);
	await syncDirectory(dirname(source));
	const [candidate, live] = await Promise.all([
		lstat(quarantine, { bigint: true }),
		lstat(target, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
			return undefined;
		}),
	]);
	if (
		(!(privateCopy && candidate.nlink === 1n) &&
			(candidate.dev !== live?.dev || candidate.ino !== live?.ino)) ||
		byteHash(await currentBytes(root, quarantine)) !== expectedHash
	)
		return;
	await unlink(quarantine);
	await syncDirectory(dirname(source));
}

async function isolateStage(root: string, stage: string): Promise<void> {
	for (const entry of await readdir(stage, { withFileTypes: true })) {
		const path = join(stage, entry.name);
		if (entry.isDirectory()) {
			await isolateStage(root, path);
			continue;
		}
		if (!entry.isFile() || (await lstat(path)).nlink === 1) continue;
		const bytes = (await currentBytes(root, path)) as Buffer;
		const copy = `${path}.independent-${randomUUID()}`;
		await durableWrite(root, copy, bytes);
		await chmod(copy, (await lstat(path)).mode & 0o7777);
		await syncFile(root, copy);
		const quarantine = `${path}.reclaim-${randomUUID()}`;
		await rename(path, quarantine);
		await rename(copy, path);
		await syncDirectory(stage);
		if (byteHash(await currentBytes(root, quarantine)) !== hash(bytes))
			throw new Error("Recovery archive changed while isolating a published inode");
		await unlink(quarantine);
		await syncDirectory(stage);
	}
}

function parseInstallationIdentity(bytes: Buffer, checksum: string) {
	const value = JSON.parse(bytes.toString("utf8")) as {
		checksum: string;
		dev: string;
		ino: string;
	};
	if (
		value.checksum !== checksum ||
		typeof value.dev !== "string" ||
		!/^\d+$/.test(value.dev) ||
		typeof value.ino !== "string" ||
		!/^\d+$/.test(value.ino)
	)
		throw new Error("Invalid project installation identity");
	return value;
}
async function readInstallationIdentity(root: string, path: string, checksum: string) {
	const bytes = await currentBytes(root, path);
	if (bytes === null) return undefined;
	try {
		return parseInstallationIdentity(bytes, checksum);
	} catch {
		return undefined;
	}
}

async function cleanupJournal(
	root: string,
	plan: JournalPlan,
	preserveStage = false,
	ownedPreparation = false,
): Promise<void> {
	const stage = await resolveWritablePathWithin(root, join(root, plan.stage));
	await isolateStage(root, stage);
	const active = await currentBytes(root, join(root, JOURNAL));
	if (active !== null) {
		const retired = join(stage, "journal.retired");
		await rename(await resolveWritablePathWithin(root, join(root, JOURNAL)), retired);
		if (process.platform === "win32") await syncFile(root, retired);
		await syncDirectory(root);
		await syncDirectory(stage);
		if (byteHash(await currentBytes(root, retired)) !== hash(active))
			throw new Error("Project transaction journal changed during retirement");
		await unlink(retired);
		await syncDirectory(stage);
	}
	if (preserveStage) return;
	if (touchesProtectedPaths(plan.files) || (await hasCaptures(stage))) {
		transactions.getStore()?.retainedStages.add(stage);
		return;
	}
	await reclaimStage(root, stage, false, ownedPreparation);
}

async function hasCaptures(stage: string): Promise<boolean> {
	return (await readdir(stage)).some((name) => /\.capture-[0-9a-f-]+$/.test(name));
}

async function removePlannedDirectories(root: string, plan: JournalPlan): Promise<void> {
	for (const directory of [...(plan.directories ?? [])].reverse()) {
		try {
			await removeEmptyDirectory(root, join(root, directory));
			await syncDirectory(dirname(join(root, directory)));
		} catch (error) {
			if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? ""))
				throw error;
		}
	}
}

async function installFile(
	root: string,
	file: JournalFile,
	bytes: Buffer | null,
	temporary: string,
	assertOwnership: () => void,
	expectedHash: string | null,
	conflictMessage?: string,
	rollbackChecksum?: string,
	forwardSource?: string,
	checksum?: string,
): Promise<void> {
	const target = await resolveWritablePathWithin(root, join(root, file.path));
	if (basename(temporary).startsWith("rollback-")) temporary += `.attempt-${randomUUID()}`;
	if (bytes !== null && !forwardSource) {
		await durableWrite(root, temporary, bytes);
		await chmod(temporary, file.mode);
		await syncFile(root, temporary);
	}
	const source = forwardSource ?? temporary;
	if (bytes !== null && forwardSource) {
		await chmod(source, file.mode);
		await syncFile(root, source);
	}
	if (bytes !== null && checksum) {
		const identity = await lstat(source, { bigint: true });
		await publishMarker(
			root,
			`${temporary}.identity`,
			JSON.stringify({ checksum, dev: identity.dev.toString(), ino: identity.ino.toString() }),
		);
	}
	for (let attempt = 0; ; attempt++) {
		const capture = `${temporary}.capture-${randomUUID()}`;
		if (byteHash(await currentBytes(root, target)) !== expectedHash) {
			if (expectedHash === null)
				throw new ProjectTargetConflictError(file.path, "File already exists", "EEXIST");
			throw new ProjectTargetConflictError(
				file.path,
				conflictMessage ?? "File changed on disk since it was opened",
			);
		}
		assertOwnership();
		if (rollbackChecksum) await publishMarker(root, `${capture}.intent`, rollbackChecksum);
		try {
			const to = await resolveWritablePathWithin(root, target);
			if (expectedHash !== null) {
				await rename(to, await resolveWritablePathWithin(root, capture));
				await syncDirectory(dirname(to));
				await syncDirectory(dirname(capture));
				if (byteHash(await currentBytes(root, capture)) !== expectedHash) {
					await restoreCapture(root, capture, to);
					throw new ProjectTargetConflictError(
						file.path,
						conflictMessage ?? "Project recovery conflict: captured outside edit",
					);
				}
				if (rollbackChecksum) await publishMarker(root, `${capture}.displaced`, rollbackChecksum);
			}
			if (bytes !== null) {
				const from = await resolveWritablePathWithin(root, source);
				await link(from, to);
				await consumePublication(
					root,
					from,
					to,
					hash(bytes),
					`${temporary}.cleanup.capture-${randomUUID()}`,
				);
			}
			await syncDirectory(dirname(target));
			if (rollbackChecksum) await publishMarker(root, `${capture}.completed`, rollbackChecksum);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if ((await currentBytes(root, capture)) !== null) {
				await restoreCapture(root, capture, target);
			}
			if (code === "EEXIST" || code === "ENOENT")
				throw new ProjectTargetConflictError(
					file.path,
					"Project recovery conflict: concurrent target change",
					code,
					error,
				);
			await waitForFileSharingRetry(error, attempt);
		}
	}
}

async function restoreCapture(root: string, capture: string, target: string): Promise<void> {
	const copy = `${capture}.restore-${randomUUID()}`;
	await durableWrite(root, copy, (await currentBytes(root, capture)) as Buffer);
	await chmod(copy, (await lstat(capture)).mode & 0o7777);
	await syncFile(root, copy);
	try {
		await link(
			await resolveWritablePathWithin(root, copy),
			await resolveWritablePathWithin(root, target),
		);
		await syncDirectory(dirname(target));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	await consumePublication(
		root,
		copy,
		target,
		hash((await currentBytes(root, copy)) as Buffer),
		undefined,
		true,
	);
}

async function reconcileCaptures(
	root: string,
	plan: JournalPlan,
	restoreInterrupted = true,
): Promise<string[]> {
	const stage = join(root, plan.stage);
	const conflicts: string[] = [];
	const displaced = new Set<number>();
	if (restoreInterrupted) await resumeRollbackCaptures(root, plan);
	for (const name of await readdir(stage)) {
		const match = /^(install|rollback)-(\d+)(?:\.attempt-[0-9a-f-]+)?\.capture-[0-9a-f-]+$/.exec(
			name,
		);
		if (!match) continue;
		const file = plan.files[Number(match[2])];
		if (!file) throw new Error("Invalid project transaction capture");
		const capture = join(stage, name);
		const captured = byteHash(await currentBytes(root, capture));
		const expected = match[1] === "install" ? file.fromHash : file.toHash;
		if (match[1] === "install" && captured === expected) displaced.add(Number(match[2]));
		const target = join(root, file.path);
		if (captured !== expected) {
			if (restoreInterrupted) await restoreCapture(root, capture, target);
			conflicts.push(file.path);
		} else if (
			(await currentBytes(root, target)) === null &&
			file.from !== null &&
			file.to !== null
		) {
			const incomplete =
				match[1] === "rollback"
					? (await currentBytes(root, `${capture}.completed`)) === null
					: (await currentBytes(root, join(stage, `installed-${Number(match[2])}`))) === null;
			if (restoreInterrupted && incomplete) await restoreCapture(root, capture, target);
			else conflicts.push(file.path);
		}
	}
	if (plan.captureVersion !== undefined) {
		for (const [index, file] of plan.files.entries()) {
			const target = join(root, file.path);
			const current = byteHash(await currentBytes(root, target));
			if (current === file.fromHash || current !== file.toHash) continue;
			if (file.to === null) {
				if (!displaced.has(index)) conflicts.push(file.path);
				continue;
			}
			const installation =
				plan.captureVersion === 2
					? await readInstallationIdentity(
							root,
							join(stage, `install-${index}.identity`),
							hash(JSON.stringify(plan)),
						)
					: await lstat(join(stage, `install-${index}`), { bigint: true })
							.then((entry) =>
								entry.isFile()
									? { dev: entry.dev.toString(), ino: entry.ino.toString() }
									: undefined,
							)
							.catch((error: NodeJS.ErrnoException) => {
								if (error.code !== "ENOENT") throw error;
								return undefined;
							});
			const visible = await lstat(await resolveWritablePathWithin(root, target), { bigint: true });
			if (
				!installation ||
				installation.ino !== visible.ino.toString() ||
				installation.dev !== visible.dev.toString()
			)
				conflicts.push(file.path);
		}
	}
	return conflicts;
}

async function resumeRollbackCaptures(root: string, plan: JournalPlan): Promise<void> {
	const stage = join(root, plan.stage),
		checksum = hash(JSON.stringify(plan));
	const attempts: Array<{ capture: string; temporary: string; index: number; completed: boolean }> =
		[];
	for (const name of await readdir(stage)) {
		const match = /^(rollback-(\d+)\.attempt-[0-9a-f-]+)(\.capture-[0-9a-f-]+)\.intent$/.exec(name);
		if (!match) continue;
		const index = Number(match[2]);
		if (!plan.files[index]) throw new Error("Invalid rollback step");
		const capture = join(stage, match[1] + match[3]);
		for (const suffix of ["intent", "displaced", "completed"]) {
			const marker = await currentBytes(root, `${capture}.${suffix}`);
			if (marker !== null && marker.toString("utf8") !== checksum)
				throw new Error("Invalid rollback step marker");
		}
		attempts.push({
			capture,
			temporary: join(stage, match[1]),
			index,
			completed: (await currentBytes(root, `${capture}.completed`)) !== null,
		});
	}
	for (const { capture, temporary, index, completed } of attempts) {
		if (completed) continue;
		const file = plan.files[index];
		const captured = await currentBytes(root, capture);
		if (captured === null || byteHash(captured) !== file.toHash) continue;
		if ((await currentBytes(root, `${capture}.displaced`)) === null)
			await publishMarker(root, `${capture}.displaced`, checksum);
		const target = join(root, file.path),
			current = byteHash(await currentBytes(root, target));
		if (current === null && file.from !== null) {
			if (plan.captureVersion === 2 && (await currentBytes(root, temporary)) === null) {
				await durableWrite(root, temporary, decode(file.from) as Buffer);
				await chmod(temporary, file.mode);
				await syncFile(root, temporary);
			}
			if (byteHash(await currentBytes(root, temporary)) !== file.fromHash)
				throw new Error("Rollback restoration copy missing or corrupt");
			await restoreCapture(root, temporary, target);
		}
		if (byteHash(await currentBytes(root, target)) === file.fromHash)
			await publishMarker(root, `${capture}.completed`, checksum);
	}
}

async function recoverProjectFileJournal(root: string, assertOwnership: () => void): Promise<void> {
	const path = await resolveWritablePathWithin(root, join(root, JOURNAL));
	const source = await currentBytes(root, path);
	if (source === null) return;
	let journal: Journal;
	try {
		journal = validateJournal(JSON.parse(source.toString("utf8")), root);
	} catch (error) {
		throw new Error("Project transaction journal refused", { cause: error });
	}
	const { plan } = journal;
	const stage = await resolveWritablePathWithin(root, join(root, plan.stage));
	const ready = await currentBytes(root, join(stage, "ready"));
	const aborted = await currentBytes(root, join(stage, "abort"));
	const committed = await currentBytes(root, join(stage, "committed"));
	if (committed !== null && committed.toString("utf8") !== journal.checksum)
		throw new Error("Invalid project transaction commit marker");
	if (aborted !== null && aborted.toString("utf8") !== journal.checksum)
		throw new Error("Invalid project transaction journal abort marker");
	if (ready !== null && ready.toString("utf8") !== journal.checksum)
		throw new Error("Invalid project transaction journal readiness marker");
	const observed: (string | null)[] = [];
	let allInstalled = plan.files.length > 0;
	for (let index = 0; index < plan.files.length; index++) {
		const file = plan.files[index];
		const stagedMarker = await currentBytes(root, join(stage, `staged-${index}`));
		const installedMarker = await currentBytes(root, join(stage, `installed-${index}`));
		allInstalled &&= installedMarker !== null;
		if (installedMarker !== null && installedMarker.toString("utf8") !== journal.checksum)
			throw new Error("Invalid project transaction installation marker");
		if (stagedMarker !== null && stagedMarker.toString("utf8") !== journal.checksum)
			throw new Error("Invalid project transaction journal staging marker");
		if ((ready !== null || stagedMarker !== null) && file.to !== null) {
			let staged: Buffer | null;
			try {
				staged = await currentBytes(root, stagedPath(root, plan, index));
			} catch (error) {
				throw new Error("Project transaction staged file missing or unsafe", { cause: error });
			}
			const consumed =
				plan.captureVersion === 2 &&
				staged === null &&
				(await currentBytes(root, join(stage, `install-${index}.identity`))) !== null;
			if (!consumed && (staged === null || byteHash(staged) !== file.toHash))
				throw new Error("Project transaction staged file missing or corrupt");
		}
	}
	if (aborted === null && (committed !== null || (ready !== null && allInstalled))) {
		await cleanupJournal(root, plan);
		return;
	}
	const captureConflicts = await reconcileCaptures(root, plan);
	for (const [index, file] of plan.files.entries())
		observed[index] = byteHash(await currentBytes(root, join(root, file.path)));
	if (
		captureConflicts.length ||
		(ready === null ? !plan.files.every((file, index) => observed[index] === file.fromHash) : true)
	) {
		if (aborted === null) await publishMarker(root, join(stage, "abort"), journal.checksum);
		const conflicts: string[] = [...captureConflicts];
		for (const [index, file] of plan.files.entries()) {
			if (
				observed[index] !== null &&
				observed[index] !== file.fromHash &&
				observed[index] === file.toHash
			)
				await access(join(root, file.path), constants.W_OK);
		}
		for (const [index, file] of plan.files.entries()) {
			const current = byteHash(await currentBytes(root, join(root, file.path)));
			if (current === file.fromHash) continue;
			if (ready === null || current !== file.toHash || conflicts.includes(file.path)) {
				conflicts.push(file.path);
				continue;
			}
			try {
				await installFile(
					root,
					file,
					decode(file.from),
					join(stage, `rollback-${index}`),
					assertOwnership,
					file.toHash,
					undefined,
					journal.checksum,
					undefined,
					journal.checksum,
				);
			} catch (error) {
				if (
					error instanceof ProjectTargetConflictError ||
					(await reconcileCaptures(root, plan)).includes(file.path) ||
					byteHash(await currentBytes(root, join(root, file.path))) !== file.toHash
				) {
					conflicts.push(file.path);
				} else throw error;
			}
		}
		if (conflicts.length) {
			if ((await currentBytes(root, join(stage, "conflict"))) === null)
				await publishMarker(root, join(stage, "conflict"), journal.checksum);
			await removePlannedDirectories(root, plan);
			await cleanupJournal(root, plan, true);
			throw new Error(
				`Project recovery conflict: ${conflicts.join(", ")}. Recovery copies retained in ${plan.stage}`,
			);
		}
		await removePlannedDirectories(root, plan);
	} else if (aborted === null) {
		await publishMarker(root, join(stage, "abort"), journal.checksum);
	}
	if (ready === null) await removePlannedDirectories(root, plan);
	await cleanupJournal(root, plan);
}

export async function applyProjectFilePlan(
	root: string,
	changes: readonly ProjectFileChange[],
	options: ProjectFilePlanOptions = {},
): Promise<void> {
	assertProjectWritesAllowed();
	assertProjectFileTransactionOwnership(root);
	if (!changes.length && !options.createDirectories?.length) return;
	const cleanupErrors = transactions.getStore()?.cleanupErrors;
	if (!cleanupErrors) throw new ProjectFileConflictError();
	const files: JournalFile[] = [];
	const targets = new Set<string>();
	const directories = [...(options.createDirectories ?? [])];
	for (const directory of directories) {
		assertFilePath(directory);
		try {
			await lstat(join(root, directory));
			throw Object.assign(new Error("Rename destination already exists"), { code: "EEXIST" });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await assertProtectedTarget(
			directory,
			relative(root, await plannedTarget(resolve(root, directory))).replaceAll("\\", "/"),
		);
	}
	async function plannedTarget(path: string): Promise<string> {
		try {
			const writable = await resolveWritablePathWithin(root, path);
			try {
				return await resolveExistingPathWithin(root, writable);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				return writable;
			}
		} catch (error) {
			if (
				(error as NodeJS.ErrnoException).code !== "ENOENT" ||
				!directories.includes(relative(root, dirname(path)).replaceAll("\\", "/"))
			)
				throw error;
			return join(await plannedTarget(dirname(path)), basename(path));
		}
	}
	async function plainStoreError(lexical: string): Promise<ProjectPlainStoreError> {
		const parts = lexical.split("/");
		for (let depth = 1; depth <= parts.length; depth++) {
			const path = parts.slice(0, depth).join("/");
			try {
				if ((await lstat(join(root, path))).isSymbolicLink())
					return new ProjectPlainStoreError(path);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				break;
			}
		}
		return new ProjectPlainStoreError(lexical);
	}
	async function assertProtectedTarget(lexical: string, canonical: string): Promise<void> {
		if (isIdentityLineagePath(lexical) && !isIdentityLineagePath(canonical))
			throw await plainStoreError(lexical);
	}
	for (const change of changes) {
		if (isAbsolute(change.path)) throw new Error("Invalid project transaction path");
		if (process.platform === "win32" && change.path.includes(":"))
			throw new Error("Invalid project journal file path");
		const lexical = relative(root, resolve(root, change.path)).replaceAll("\\", "/");
		if (isIdentityLineagePath(lexical)) {
			const entry = await lstat(resolve(root, change.path)).catch(
				(error: NodeJS.ErrnoException) => {
					if (error.code !== "ENOENT") throw error;
					return undefined;
				},
			);
			if (entry?.isSymbolicLink()) throw await plainStoreError(lexical);
		}
		const target = await plannedTarget(resolve(root, change.path));
		const path = relative(root, target).replaceAll("\\", "/");
		assertFilePath(path);
		await assertProtectedTarget(lexical, path);
		const key = courseKey(target);
		if (targets.has(key)) throw new Error("Duplicate project transaction target");
		targets.add(key);
		const from = await currentBytes(root, target);
		if (change.expectedContent !== undefined && encode(change.expectedContent) !== encode(from))
			throw new ProjectFileConflictError(
				change.conflictMessage ?? "File changed on disk since it was opened",
			);
		if (from !== null) await access(target, constants.W_OK);
		const mode = from === null ? 0o666 & ~process.umask() : (await lstat(target)).mode & 0o7777;
		const to = change.content === null ? null : Buffer.from(change.content);
		files.push({
			path,
			from: encode(from),
			to: encode(to),
			fromHash: byteHash(from),
			toHash: byteHash(to),
			mode,
			head: change.head ?? false,
		});
	}
	const plan: JournalPlan = {
		version: 1,
		captureVersion: 2,
		stageVersion: 1,
		course: courseKey(root),
		stage: `.praxity-write-${randomUUID()}`,
		files,
		...(directories.length ? { directories } : {}),
	};
	await excludeProjectFilesFromGit(root);
	const journal = validateJournal({ plan, checksum: hash(JSON.stringify(plan)) }, root);
	const stage = await resolveWritablePathWithin(root, join(root, plan.stage));
	const installed: number[] = [];
	let published = false;
	let committed = false;
	await mkdir(stage, { mode: 0o700 });
	try {
		const temporaryJournal = join(stage, "journal.tmp");
		const publication = join(stage, "journal.publish");
		await completeFileWork(
			[temporaryJournal, publication].map(async (path) => {
				await durableWrite(root, path, JSON.stringify(journal));
				await chmod(path, 0o600);
				await syncFile(root, path);
			}),
		);
		published = true;
		try {
			await link(publication, await resolveWritablePathWithin(root, join(root, JOURNAL)));
		} catch (error) {
			if (
				["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(
					(error as NodeJS.ErrnoException).code ?? "",
				)
			)
				throw new ProjectFilesystemUnsupportedError(error);
			throw error;
		}
		await syncDirectory(root);
		await consumePublication(root, publication, join(root, JOURNAL), hash(JSON.stringify(journal)));
		await options.onStep?.({ kind: "journal" });
		for (const directory of directories) {
			const target = await resolveWritablePathWithin(root, join(root, directory));
			await mkdir(target);
			await syncDirectory(dirname(target));
		}
		for (let offset = 0; offset < files.length; offset += FILE_STAGE_BATCH_SIZE) {
			const batch = files.slice(offset, offset + FILE_STAGE_BATCH_SIZE);
			await completeFileWork(
				batch.map(async (file, item) => {
					const index = offset + item;
					if (plan.stageVersion === undefined) await mkdir(join(stage, String(index)));
					if (file.to !== null)
						await durableWrite(root, stagedPath(root, plan, index), decode(file.to) as Buffer);
					await publishMarker(root, join(stage, `staged-${index}`), journal.checksum);
				}),
			);
			for (let item = 0; item < batch.length; item++)
				await options.onStep?.({ kind: "staged", index: offset + item });
		}
		await publishMarker(root, join(stage, "ready"), journal.checksum);
		for (const [index, file] of files.entries()) {
			if (byteHash(await currentBytes(root, join(root, file.path))) !== file.fromHash) {
				if (file.from === null)
					throw Object.assign(new Error("File already exists"), { code: "EEXIST" });
				throw new ProjectFileConflictError(
					changes[index].conflictMessage ?? "File changed on disk since it was opened",
				);
			}
		}
		const order = files
			.map((_, index) => index)
			.sort((a, b) => Number(files[a].head) - Number(files[b].head));
		for (const index of order) {
			const file = files[index];
			const staged =
				file.to === null ? null : await currentBytes(root, stagedPath(root, plan, index));
			if (byteHash(staged) !== file.toHash)
				throw new Error("Project transaction staged file missing or corrupt");
			installed.push(index);
			await installFile(
				root,
				file,
				staged,
				join(stage, `install-${index}`),
				() => assertProjectFileTransactionOwnership(root),
				file.fromHash,
				changes[index].conflictMessage,
				undefined,
				stagedPath(root, plan, index),
				journal.checksum,
			);
			await publishMarker(root, join(stage, `installed-${index}`), journal.checksum);
			await options.onStep?.({ kind: file.head ? "head" : "installed", index });
		}
		committed = true;
		await publishMarker(root, join(stage, "committed"), journal.checksum);
	} catch (error) {
		if (committed) {
			cleanupErrors.push(error);
			try {
				await cleanupJournal(root, plan);
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
			return;
		}
		const conflicts: string[] = [];
		if (error instanceof ProjectTargetConflictError) conflicts.push(error.path);
		try {
			if (published) {
				const visible = await currentBytes(root, join(root, JOURNAL));
				if (visible === null) published = false;
				else if (!visible.equals(Buffer.from(JSON.stringify(journal))))
					throw new Error("Journal publication ownership is uncertain; recovery copies retained");
			}
			if (published) await publishMarker(root, join(stage, "abort"), journal.checksum);
			conflicts.push(...(await reconcileCaptures(root, plan)));
			for (const [index, file] of files.entries()) {
				const observed = byteHash(await currentBytes(root, join(root, file.path)));
				if (
					(observed !== file.fromHash &&
						(!installed.includes(index) || observed !== file.toHash)) ||
					((await currentBytes(root, join(stage, `installed-${index}`))) !== null &&
						observed !== file.toHash)
				)
					conflicts.push(file.path);
			}
			for (const index of installed.reverse()) {
				const file = files[index];
				const observed = byteHash(await currentBytes(root, join(root, file.path)));
				if (observed === file.fromHash) continue;
				if (observed !== file.toHash || conflicts.includes(file.path)) {
					conflicts.push(file.path);
					continue;
				}
				try {
					await installFile(
						root,
						file,
						decode(file.from),
						join(stage, `rollback-${index}`),
						() => assertProjectFileTransactionOwnership(root),
						file.toHash,
						undefined,
						journal.checksum,
						undefined,
						journal.checksum,
					);
				} catch (rollbackError) {
					if (
						rollbackError instanceof ProjectTargetConflictError ||
						(await reconcileCaptures(root, plan)).includes(file.path) ||
						byteHash(await currentBytes(root, join(root, file.path))) !== file.toHash
					)
						conflicts.push(file.path);
					else throw rollbackError;
				}
			}
			conflicts.push(...(await reconcileCaptures(root, plan)));
			await removePlannedDirectories(root, plan);
			if (conflicts.length) await publishMarker(root, join(stage, "conflict"), journal.checksum);
		} catch (rollbackError) {
			throw new AggregateError(
				[error, rollbackError],
				"Project transaction failed and rollback failed",
				{ cause: error },
			);
		}
		try {
			if (published) await cleanupJournal(root, plan, conflicts.length > 0, installed.length === 0);
			else await reclaimStage(root, stage, false, true);
		} catch (cleanupError) {
			cleanupErrors.push(cleanupError);
		}
		if (conflicts.length)
			throw Object.assign(
				new Error(
					`File changed on disk: project rollback conflict: ${conflicts.join(", ")}. Recovery copies retained in ${plan.stage}`,
					{ cause: error },
				),
				{ code: (error as NodeJS.ErrnoException).code },
			);
		throw error;
	}
	if (committed) {
		try {
			const conflicts = await reconcileCaptures(root, plan, false);
			if (conflicts.length) await publishMarker(root, join(stage, "conflict"), journal.checksum);
			await cleanupJournal(root, plan, conflicts.length > 0);
			if (!conflicts.length) await rememberCommittedArchive(root, stage);
			if (conflicts.length)
				cleanupErrors.push(
					new Error(
						`Project recovery conflict: ${conflicts.join(", ")}. Recovery copies retained in ${plan.stage}`,
					),
				);
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
}

export function writeProjectFiles(
	projectDir: string,
	changes: readonly ProjectFileChange[],
	options: ProjectFilePlanOptions = {},
): Promise<ProjectWriteResult> {
	return acknowledgeProjectWrite(
		withProjectFileTransaction(
			projectDir,
			async (root) => {
				await applyProjectFilePlan(root, changes, options);
			},
			"write",
		),
	);
}

export async function replaceSourceAtomically(
	root: string,
	targetPath: string,
	source: string,
	expectedSource?: string,
	options: { createOnly?: boolean; conflictMessage?: string } = {},
): Promise<void> {
	await applyProjectFilePlan(root, [
		{
			path: relative(root, targetPath).replaceAll("\\", "/"),
			content: source,
			expectedContent: options.createOnly ? null : expectedSource,
			conflictMessage: options.conflictMessage,
		},
	]);
}

export function projectTextReplacement(content: string, previous: string | undefined): string {
	const endings = previous?.match(/\r\n|\r|\n/g);
	if (!endings?.length || endings.some((ending) => ending !== endings[0])) return content;
	return preserveEditorLineEndings(content, previous);
}

export function writeProjectTextFile(
	projectDir: string,
	relativePath: string,
	content: string,
	expectedContent?: string,
): Promise<ProjectWriteResult> {
	return acknowledgeProjectWrite(
		withProjectFileTransaction(
			projectDir,
			async (root) => {
				const target = await resolveWritablePathWithin(root, resolve(root, relativePath));
				let previous: string | undefined;
				try {
					previous = (await readFileWithin(root, target, "utf8")) as string;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				if (previous !== undefined && expectedContent === undefined) {
					throw new Error("Existing text files require expected content");
				}
				const conflictMessage = "File changed on disk since it was opened";
				if (expectedContent !== undefined && previous !== expectedContent) {
					throw new Error(conflictMessage);
				}
				await replaceSourceAtomically(
					root,
					target,
					projectTextReplacement(content, previous),
					expectedContent,
					{
						createOnly: previous === undefined,
						conflictMessage,
					},
				);
			},
			"write",
		),
	);
}
