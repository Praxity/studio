import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import {
	create,
	type ListThreadsOptions,
	listThreads,
	parseCommandPayload,
	parseReviewPrincipal,
	parseReviewState,
	REVIEW_LIMITS,
	type ReviewCommandKind,
	type ReviewCommandResult,
	type ReviewPrincipal,
	type ReviewProvenance,
	type ReviewRole,
	type ReviewState,
	type ReviewVisibilityPolicy,
	reopen,
	reply,
	resolve,
	reviewVisibility,
	serializeReviewState,
} from "@praxity/review-share/review";
import { z } from "zod";
import {
	ProjectPermissionError,
	ProjectReadAdmissionChangedError,
	projectReadErrorKey,
} from "../../shared/project-write-errors";
import { isWithin, openFileWithin, writeFileAtomicallyWithin } from "../path-security";
import {
	checkPrivateProjectPath,
	PrivateProjectPathError,
	privateFolderIgnoreContent,
} from "../private-project-folder";
import {
	acknowledgeProjectResult,
	assertProjectWritesAllowed,
	projectFileFlushes,
	withProjectFileTransaction,
} from "../project-file-transactions";

const storage = ".praxity/reviews";
const reviewSchema: ReviewState["schema"] = 1;
const manifestPath = `${storage}/manifest.json`;
const ignorePath = `${storage}/.gitignore`;
const runGit = promisify(execFile);
const localUuid = z
	.string()
	.uuid()
	.refine((value) => value === value.toLowerCase());
const manifestSchema = z
	.object({
		schema: z.literal(1),
		initialized: z.boolean().optional(),
		reviewId: localUuid,
		localPrincipal: z
			.object({
				id: localUuid,
				displayName: z.string(),
			})
			.strict()
			.refine(
				(value) =>
					parseReviewPrincipal({ ...value, role: "reviewer", provenance: "local-preview" }, true)
						.ok,
			),
	})
	.strict();
type Manifest = z.infer<typeof manifestSchema>;

function isManifestPrincipal(manifest: Manifest, principal: ReviewPrincipal): boolean {
	return (
		principal?.id === manifest.localPrincipal.id &&
		principal?.displayName === manifest.localPrincipal.displayName
	);
}

export type ReviewStoreErrorCode =
	| "corrupt-json"
	| "invalid-state"
	| "newer-schema"
	| "unsafe-path"
	| "read-only"
	| "disk-error"
	| "interrupted-write"
	| "tracked-storage"
	| "git-unavailable"
	| "busy"
	| "recovery-required"
	| "filesystem-unsupported"
	| "not-initialized";

export type ReviewGitUnavailableReason =
	| "no-child"
	| "git-missing"
	| "git-too-old"
	| "git-error"
	| "timeout";
export type ReviewStoreErrorReason =
	| ReviewGitUnavailableReason
	| "repository-in-storage"
	| "unfinished-init";
const minimumGit = [2, 39] as const;
const gitRequirement = `Git ${minimumGit.join(".")} or newer`;
const gitRecovery: Record<ReviewGitUnavailableReason, string> = {
	"no-child": "Allow child processes so Git can check review storage, then retry.",
	"git-missing": `Install ${gitRequirement} and make it available on PATH, then retry.`,
	"git-too-old": `Update to ${gitRequirement}, then retry.`,
	"git-error": `Use ${gitRequirement} and repair its repository or index; if Git reports dubious ownership, verify ownership and mark this repository safe with safe.directory, then retry.`,
	timeout: "Git did not answer in time; retry.",
};

/** Storage failures throw; expected lifecycle refusals remain C1 results. */
export class ReviewStoreError extends Error {
	readonly name = "ReviewStoreError";
	constructor(
		readonly code: ReviewStoreErrorCode,
		readonly path: string,
		cause?: unknown,
		readonly reason?: ReviewStoreErrorReason,
	) {
		const recovery =
			code === "git-unavailable" &&
			reason &&
			reason !== "repository-in-storage" &&
			reason !== "unfinished-init"
				? `. ${gitRecovery[reason]}`
				: "";
		super(
			code === "tracked-storage"
				? reason === "repository-in-storage"
					? "A Git repository exists in this course's review storage. Move or remove the repository, submodule or worktree in .praxity or its review folders, then retry."
					: "A Git repository containing this course or its review folders tracks files in a .praxity/reviews folder (any course, any case). Untrack them in that repository, for example git rm -r --cached on those paths."
				: `Review storage refused: ${code} at ${path}${recovery}`,
			{ cause },
		);
	}
}

function storageError(error: unknown): ReviewStoreError | ProjectPermissionError {
	if (error instanceof ProjectPermissionError) return error;
	if (error instanceof ReviewStoreError) return error;
	const key = projectReadErrorKey(error);
	if (key === "projectBusy" || key === "fileBusy")
		return new ReviewStoreError("busy", storage, error);
	if (key === "projectRecoveryRequired" || key === "projectRecoveryConflict")
		return new ReviewStoreError("recovery-required", storage, error);
	if (key === "projectFilesystemUnsupported")
		return new ReviewStoreError("filesystem-unsupported", storage, error);
	if (key === "plainStoreRequired" || key === "privateLockCache")
		return new ReviewStoreError("unsafe-path", storage, error);
	const code = (error as NodeJS.ErrnoException)?.code;
	if (code === "EACCES" || code === "EPERM" || code === "EROFS")
		return new ReviewStoreError("read-only", storage, error);
	if (code === "EIO" || code === "ENOSPC" || code === "EDQUOT")
		return new ReviewStoreError("disk-error", storage, error);
	return new ReviewStoreError("interrupted-write", storage, error);
}

async function flush(work: () => Promise<void>) {
	try {
		await work();
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code === "EINVAL" || code === "ENOTSUP" || code === "EOPNOTSUPP" || code === "ENOSYS")
			throw new ReviewStoreError("filesystem-unsupported", storage, error);
		throw error;
	}
}
const reviewFileFlushes = {
	syncFile: (root: string, path: string) => flush(() => projectFileFlushes.syncFile(root, path)),
	syncDirectory: (path: string) => flush(() => projectFileFlushes.syncDirectory(path)),
};

/** Fixed paths refuse links and native spelling aliases, including on case-sensitive disks. */
async function checkedPath(root: string, relative: string, writable = false): Promise<string[]> {
	try {
		return (await checkPrivateProjectPath(root, relative, { plain: true, writable })).missing;
	} catch (error) {
		if (error instanceof PrivateProjectPathError)
			throw new ReviewStoreError(
				error.reason === "read-only" ? "read-only" : "unsafe-path",
				error.path,
				error,
			);
		throw error;
	}
}

async function optionalText(root: string, path: string): Promise<string | null> {
	if ((await checkedPath(root, path)).length) return null;
	const file = await openFileWithin(root, join(root, path));
	try {
		const entry = await file.stat();
		if (!entry.isFile() || entry.nlink > 1) throw new ReviewStoreError("unsafe-path", path);
		try {
			return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
				await file.readFile(),
			);
		} catch (error) {
			if (error instanceof TypeError) throw new ReviewStoreError("corrupt-json", path, error);
			throw error;
		}
	} finally {
		await file.close();
	}
}
function json(source: string, path: string): unknown {
	try {
		return JSON.parse(source);
	} catch (error) {
		throw new ReviewStoreError("corrupt-json", path, error);
	}
}
async function readManifest(root: string): Promise<Manifest | null> {
	const source = await optionalText(root, manifestPath);
	if (source === null) return null;
	return parseManifest(source);
}
function parseManifest(source: string): Manifest {
	const value = json(source, manifestPath);
	refuseNewerSchema(value, manifestPath);
	const parsed = manifestSchema.safeParse(value);
	if (!parsed.success) throw new ReviewStoreError("invalid-state", manifestPath, parsed.error);
	return parsed.data;
}
function statePath(reviewId: string) {
	return `${storage}/${reviewId}/comments.json`;
}
function emptyState(reviewId: string): ReviewState {
	return {
		schema: reviewSchema,
		reviewId,
		course: { namespace: null, bound: false },
		changeSeq: 0,
		threads: [],
		receipts: [],
	};
}
function refuseNewerSchema(value: unknown, path: string) {
	if (
		value !== null &&
		typeof value === "object" &&
		"schema" in value &&
		typeof value.schema === "number" &&
		Number.isSafeInteger(value.schema) &&
		value.schema > reviewSchema
	)
		throw new ReviewStoreError("newer-schema", path);
}
async function readState(root: string, manifest: Manifest) {
	const path = statePath(manifest.reviewId);
	const source = await optionalText(root, path);
	if (source === null) throw new ReviewStoreError("invalid-state", path);
	const value = json(source, path);
	refuseNewerSchema(value, path);
	const parsed = parseReviewState(value);
	if (!parsed.ok || parsed.value.reviewId !== manifest.reviewId)
		throw new ReviewStoreError("invalid-state", path, parsed);
	return { state: parsed.value, source };
}

/** Called inside an existing project admission; never initializes a review. */
export async function readReviewIdentityEvidence(root: string) {
	const source = await optionalText(root, manifestPath);
	const files = new Map<string, string | null>([[manifestPath, source]]);
	const manifest = source === null ? null : parseManifest(source);
	if (!manifest || manifest.initialized === false) return { ids: [], files };
	const { state, source: comments } = await readState(root, manifest);
	files.set(statePath(manifest.reviewId), comments);
	return {
		files,
		ids: state.threads.flatMap(({ anchor }) =>
			[anchor.lessonId, anchor.pageId, anchor.nodeId, anchor.blockId].filter(
				(id): id is string => id !== null,
			),
		),
	};
}
async function checkTempFile(root: string, relative: string) {
	await checkedPath(root, relative);
	if (!(await lstat(join(root, relative))).isFile())
		throw new ReviewStoreError("unsafe-path", relative);
}

/** Only our fixed files' UUID temp siblings can be discarded after a crashed write. */
async function removeOwnTemps(root: string, path: string) {
	const parent = path.slice(0, path.lastIndexOf("/"));
	if ((await checkedPath(root, parent)).length) return;
	const prefix = `.${basename(path)}.`;
	let removed = false;
	for (const name of await readdir(join(root, parent))) {
		if (
			!name.startsWith(prefix) ||
			!name.endsWith(".tmp") ||
			!localUuid.safeParse(name.slice(prefix.length, -4)).success
		)
			continue;
		const relative = `${parent}/${name}`;
		await checkTempFile(root, relative);
		await unlink(join(root, relative));
		removed = true;
	}
	if (removed) await reviewFileFlushes.syncDirectory(join(root, parent));
}
async function removeReviewTemps(root: string, manifest: Manifest) {
	for (const path of [ignorePath, manifestPath, statePath(manifest.reviewId)])
		await removeOwnTemps(root, path);
}

async function writePrivateFile(root: string, path: string, content: string) {
	await checkedPath(root, path, true);
	// Unlike the public course writer, these bytes never enter root recovery archives.
	await writeFileAtomicallyWithin(
		root,
		join(root, path),
		Buffer.from(content),
		undefined,
		undefined,
		reviewFileFlushes,
	);
}

/** Git also discovers git directories directly, without a containing .git entry. */
async function containsGitMetadata(directory: string): Promise<boolean> {
	const exists = async (name: string) => {
		try {
			await lstat(join(directory, name));
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	};
	if (await exists(".git")) return true;
	const [head, objects, refs, common] = await Promise.all(
		["HEAD", "objects", "refs", "commondir"].map(exists),
	);
	return head && ((objects && refs) || common);
}

/** Only existing plain folders need probing; path admission rejects links and non-directories. */
async function existingReviewFolders(root: string): Promise<string[]> {
	const directories: string[] = [];
	const manifest = await readManifest(root);
	const folders = [".praxity", storage];
	if (manifest) folders.push(`${storage}/${manifest.reviewId}`);
	for (const relative of folders) {
		const directory = join(root, relative);
		try {
			if (!(await lstat(directory)).isDirectory()) return directories;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return directories;
			throw error;
		}
		directories.push(directory);
	}
	return directories;
}

/** Without an index reader, every private folder and ancestor must be readable and Git-free. */
async function requireNoRepository(root: string, reason: "no-child" | "git-missing") {
	try {
		const directories = await existingReviewFolders(root);
		let directory = root;
		for (;;) {
			directories.push(directory);
			const parent = dirname(directory);
			if (parent === directory) break;
			directory = parent;
		}
		for (const directory of directories) {
			if (await containsGitMetadata(directory))
				throw new ReviewStoreError("git-unavailable", storage, undefined, reason);
		}
	} catch (error) {
		if (error instanceof ReviewStoreError) throw error;
		throw new ReviewStoreError("git-unavailable", storage, error, reason);
	}
}

function isNoRepository(error: unknown): boolean {
	const failure = error as { code?: string | number; stderr?: string } | undefined;
	return (
		failure?.code === 128 &&
		failure.stderr?.replace(/\r?\n$/, "") ===
			"fatal: not a git repository (or any of the parent directories): .git"
	);
}

/** Match fixed private folder names conservatively across native spelling aliases. */
export function tracksReviewStorage(entry: string): boolean {
	let privateFolder = false;
	for (const component of entry.split(/[\\/]/)) {
		const folded = component
			.split(":", 1)[0]
			.normalize("NFKC")
			.replace(/\p{Default_Ignorable_Code_Point}/gu, "")
			.toUpperCase()
			.toLowerCase()
			.replace(/[. ]+$/, "");
		// Hashes and collision tails need not retain either fixed folder's prefix.
		const shortName = /~\d/.test(component);
		if (privateFolder && (folded === "reviews" || shortName)) return true;
		if (folded === ".praxity" || shortName) privateFolder = true;
	}
	return false;
}

function queryReviewGit(directory: string, timeoutMs: number, ...args: string[]) {
	// Git can inspect metadata outside Node's fs grants. Ambient overrides must not redirect discovery.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)),
	);
	// Git docs checked: core.fsmonitor; core.pager/pager.*; remote.*.promisor/uploadpack,
	// core.sshCommand/gitProxy and credential.helper (lazy fetch); core.alternateRefsCommand,
	// filter.* and diff.* (not used by these index/path queries). Disable index hooks,
	// paging and transports. The empty allowlist also beats protocol.<name>.allow overrides.
	return runGit(
		"git",
		[
			"-c",
			"core.fsmonitor=false",
			"-c",
			"safe.bareRepository=explicit",
			"-c",
			"protocol.allow=never",
			"--no-optional-locks",
			"--no-pager",
			"-C",
			directory,
			...args,
		],
		{
			env: {
				...env,
				LC_ALL: "C",
				LANG: "C",
				GIT_DISCOVERY_ACROSS_FILESYSTEM: "1",
				GIT_ALLOW_PROTOCOL: "",
				...(dirname(directory) !== directory
					? { GIT_CEILING_DIRECTORIES: dirname(directory) }
					: {}),
			},
			cwd: dirname(process.execPath),
			timeout: timeoutMs,
			windowsHide: true,
			// ponytail: buffered listing, refuses above ~1M entries; stream and scan if a monorepo hits it
			maxBuffer: 64 * 1024 * 1024,
		},
	);
}

/** Advisory only: missing Git, child-process permission or failed discovery never blocks the CLI. */
export async function isLinkedReviewWorktree(courseDir: string): Promise<boolean> {
	if (process.permission && !process.permission.has("child")) return false;
	const deadline = performance.now() + 1500;
	try {
		let directory = await realpath(courseDir);
		for (;;) {
			const remaining = Math.ceil(deadline - performance.now());
			if (remaining <= 0) return false;
			if (await containsGitMetadata(directory)) {
				try {
					const result = await queryReviewGit(
						directory,
						remaining,
						"rev-parse",
						"--path-format=absolute",
						"--git-dir",
						"--git-common-dir",
					);
					const paths = result.stdout.trimEnd().split(/\r?\n/);
					return (
						!result.stderr && paths.length === 2 && paths.every(isAbsolute) && paths[0] !== paths[1]
					);
				} catch (error) {
					if (!isNoRepository(error)) return false;
				}
			}
			const parent = dirname(directory);
			if (parent === directory) return false;
			directory = parent;
		}
	} catch {
		return false;
	}
}

async function refuseTrackedStorage(root: string, gitTimeoutMs: number) {
	if (process.permission && !process.permission.has("child")) {
		await requireNoRepository(root, "no-child");
		return;
	}
	// Share one deadline across all enclosing indexes, below T1's five-second lock wait.
	const deadline = performance.now() + gitTimeoutMs;
	const query = (directory: string, ...args: string[]) => {
		const remaining = Math.ceil(deadline - performance.now());
		if (remaining <= 0)
			throw new ReviewStoreError("git-unavailable", storage, undefined, "timeout");
		return queryReviewGit(directory, remaining, ...args);
	};
	let directory = root;
	try {
		const versionResult = await query(root, "version");
		const version = /^git version (\d+)\.(\d+)\.\d+(?:[ .][^\r\n]*)?\r?\n?$/.exec(
			versionResult.stdout,
		);
		if (versionResult.stderr.length || !version)
			throw new ReviewStoreError("git-unavailable", storage, undefined, "git-error");
		const major = Number(version[1]);
		if (major < minimumGit[0] || (major === minimumGit[0] && Number(version[2]) < minimumGit[1]))
			throw new ReviewStoreError("git-unavailable", storage, undefined, "git-too-old");
		for (const inner of await existingReviewFolders(root)) {
			// Even an empty repository here can track comment paths without either folder name.
			if (await containsGitMetadata(inner))
				throw new ReviewStoreError("tracked-storage", storage, undefined, "repository-in-storage");
		}
		for (;;) {
			try {
				const { stdout, stderr } = await query(
					directory,
					"ls-files",
					"-z",
					"--full-name",
					"--",
					":/",
				);
				if (stderr.length)
					throw new ReviewStoreError("git-unavailable", storage, undefined, "git-error");
				if (stdout.split("\0").some(tracksReviewStorage))
					throw new ReviewStoreError("tracked-storage", storage);
				const top = await query(directory, "rev-parse", "--show-toplevel");
				const topPath = top.stdout.replace(/\r?\n$/, "");
				if (top.stderr.length || !isAbsolute(topPath) || /[\r\n]/.test(topPath))
					throw new ReviewStoreError("git-unavailable", storage, undefined, "git-error");
				// A redirected worktree can give index entries without either private folder name.
				const realTop = await realpath(topPath).catch((error) => {
					throw new ReviewStoreError("git-unavailable", storage, error, "git-error");
				});
				// A skipped ceiling can discover an ancestor; its index still covers this course.
				if (!isWithin(realTop, directory))
					throw new ReviewStoreError("git-unavailable", storage, undefined, "git-error");
			} catch (error) {
				if (error instanceof ReviewStoreError) throw error;
				if (!isNoRepository(error)) throw error;
			}
			// Ask at every ancestor: core.worktree must never choose where this walk ends.
			const parent = dirname(directory);
			if (parent === directory) return;
			directory = parent;
		}
	} catch (error) {
		if (error instanceof ReviewStoreError) throw error;
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			await requireNoRepository(root, "git-missing");
			return;
		}
		throw new ReviewStoreError(
			"git-unavailable",
			storage,
			error,
			(error as { killed?: boolean }).killed ? "timeout" : "git-error",
		);
	}
}

/**
 * Every acknowledgement follows fresh publication of the whole set in this admission.
 * Visible paths, matching bytes and re-flushing are not proof: Linux can mark pages clean
 * after EIO. Create/flush root -> .praxity -> reviews, publish the ignore, then create the
 * review directory, flush reviews and that directory, and publish manifest then state.
 * Ignore comes first because even unacknowledged private bytes can survive a crash.
 * Windows target flushes rely on the NTFS metadata log; FAT/exFAT remain best effort.
 */
async function publishDurableSet(root: string, manifest: Manifest, stateBytes: string) {
	for (const directory of await checkedPath(root, storage, true))
		await mkdir(join(root, directory));
	if (process.platform !== "win32")
		for (const directory of [root, join(root, ".praxity"), join(root, storage)])
			await reviewFileFlushes.syncDirectory(directory);
	const current = (await optionalText(root, ignorePath)) ?? "";
	await writePrivateFile(root, ignorePath, privateFolderIgnoreContent(current) ?? current);
	const reviewDirectory = `${storage}/${manifest.reviewId}`;
	for (const directory of await checkedPath(root, reviewDirectory, true))
		await mkdir(join(root, directory));
	if (process.platform !== "win32")
		for (const directory of [storage, reviewDirectory])
			await reviewFileFlushes.syncDirectory(join(root, directory));
	await writePrivateFile(root, manifestPath, JSON.stringify(manifest));
	await writePrivateFile(root, statePath(manifest.reviewId), stateBytes);
}
async function transaction<T>(
	courseDir: string,
	mode: "read" | "write",
	gitTimeoutMs: number,
	work: (root: string) => Promise<T>,
): Promise<T> {
	if (mode === "write") assertProjectWritesAllowed();
	try {
		const admit = () =>
			withProjectFileTransaction(
				courseDir,
				async (root) => {
					if (mode === "write") await refuseTrackedStorage(root, gitTimeoutMs);
					return work(root);
				},
				mode,
				false,
			);
		if (mode === "read") {
			try {
				return await admit();
			} catch (error) {
				if (!(error instanceof ProjectReadAdmissionChangedError)) throw error;
				// Only a cold read whose first lock appeared retries; a full lock deadline never does.
				return await admit();
			}
		}
		const pending = admit();
		const { result, cleanupError } = await acknowledgeProjectResult(pending);
		return cleanupError && result !== null && typeof result === "object"
			? { ...result, cleanupError }
			: result;
	} catch (error) {
		throw storageError(error);
	}
}

export type ReviewStoreCommandResult =
	| (Omit<Extract<ReviewCommandResult, { ok: true }>, "state" | "thread"> & {
			thread: Extract<ReviewCommandResult, { ok: true }>["thread"] | null;
			cleanupError?: string;
	  })
	| Extract<ReviewCommandResult, { ok: false }>;

/** One durable default review per course; no state survives between admissions. */
export async function openReviewStore(
	courseDir: string,
	policy: ReviewVisibilityPolicy = reviewVisibility,
	options: { createIfMissing?: boolean; gitTimeoutMs?: number } = {},
) {
	if (options.createIfMissing !== false) assertProjectWritesAllowed();
	const gitTimeoutMs = options.gitTimeoutMs ?? 3500;
	// Existing reviews open read-only, without recovering or reclaiming course archives.
	let reviewId = await transaction(courseDir, "read", gitTimeoutMs, async (root) => {
		const manifest = await readManifest(root);
		if (options.createIfMissing === false) {
			await optionalText(root, ignorePath);
			if (manifest?.initialized === false)
				throw new ReviewStoreError("recovery-required", manifestPath, undefined, "unfinished-init");
			if (!manifest) {
				const missing = await checkedPath(root, storage);
				if (!missing.length)
					for (const name of await readdir(join(root, storage))) {
						if (name === ".gitignore") continue;
						if (!/^\.(?:manifest\.json|\.gitignore)\.[a-f0-9-]{36}\.tmp$/u.test(name))
							throw new ReviewStoreError("invalid-state", manifestPath);
						await checkTempFile(root, `${storage}/${name}`);
					}
				throw new ReviewStoreError("not-initialized", manifestPath);
			}
		}
		if (!manifest || manifest.initialized === false) return null;
		await readState(root, manifest);
		return manifest.reviewId;
	});
	if (reviewId === null)
		reviewId = await transaction(courseDir, "write", gitTimeoutMs, async (root) => {
			const existing = await readManifest(root);
			if (existing && existing.initialized !== false) {
				const { source } = await readState(root, existing);
				await removeReviewTemps(root, existing);
				await publishDurableSet(root, existing, source);
				return existing.reviewId;
			}
			let manifest = existing;
			if (!manifest) {
				await removeOwnTemps(root, ignorePath);
				await removeOwnTemps(root, manifestPath);
				const missing = await checkedPath(root, storage);
				let pendingId: string | undefined;
				if (!missing.length) {
					for (const name of await readdir(join(root, storage))) {
						if (name === ".gitignore") continue;
						await checkedPath(root, `${storage}/${name}`);
						const entry = await lstat(join(root, storage, name));
						if ([".DS_Store", "Thumbs.db", "desktop.ini"].includes(name) && entry.isFile())
							continue;
						// A crash can leave the empty directory before the first manifest. Reuse
						// only that directory; any private bytes without a manifest must refuse.
						if (
							pendingId ||
							!localUuid.safeParse(name).success ||
							!entry.isDirectory() ||
							(await readdir(join(root, storage, name))).length
						)
							throw new ReviewStoreError("invalid-state", manifestPath);
						pendingId = name;
					}
				}
				manifest = {
					schema: 1,
					initialized: false,
					reviewId: pendingId ?? randomUUID(),
					localPrincipal: { id: randomUUID(), displayName: "Local user" },
				};
			}
			// Only explicit false permits first-use repair. Missing flags predate this marker
			// and count as initialized. Publish true durably before any comment is admitted;
			// thereafter a missing state always refuses, preserving acknowledged receipts.
			const source = await optionalText(root, statePath(manifest.reviewId));
			if (source !== null) await readState(root, manifest);
			await removeReviewTemps(root, manifest);
			const stateBytes = source ?? JSON.stringify(emptyState(manifest.reviewId));
			await publishDurableSet(root, manifest, stateBytes);
			await publishDurableSet(root, { ...manifest, initialized: true }, stateBytes);
			return manifest.reviewId;
		});
	async function withManifest<T>(
		mode: "read" | "write",
		work: (root: string, manifest: Manifest) => Promise<T>,
	) {
		return transaction(courseDir, mode, gitTimeoutMs, async (root) => {
			const manifest = await readManifest(root);
			if (!manifest || manifest.reviewId !== reviewId || manifest.initialized === false)
				throw new ReviewStoreError("invalid-state", manifestPath);
			return work(root, manifest);
		});
	}
	async function read<T>(
		mode: "read" | "write",
		work: (
			root: string,
			manifest: Manifest,
			stored: { state: ReviewState; source: string },
		) => Promise<T>,
	) {
		return withManifest(mode, async (root, manifest) => {
			const stored = await readState(root, manifest);
			if (mode === "write") await removeReviewTemps(root, manifest);
			return work(root, manifest, stored);
		});
	}
	async function mutate(
		kind: ReviewCommandKind,
		command: typeof create,
		principal: ReviewPrincipal,
		payload: unknown,
	): Promise<ReviewStoreCommandResult> {
		return read("write", async (root, manifest, { state, source }) => {
			const storedPrincipal = isManifestPrincipal(manifest, principal);
			const admitted = parseReviewPrincipal(principal, storedPrincipal);
			// Check visibility even for a historical retry; C1 owns new-text admission and receipt equality.
			const parsed = parseCommandPayload(kind, payload, true);
			if (
				admitted.ok &&
				parsed.ok &&
				parsed.value.reviewId === state.reviewId &&
				"threadId" in parsed.value
			) {
				const threadId = parsed.value.threadId;
				const target = state.threads.find((thread) => thread.id === threadId);
				if (!target || !policy.visibleTo(admitted.value, target, state))
					return { ok: false, code: "not_found", detail: {} };
			}
			const result = await command(state, principal, payload, {
				now: () => new Date().toISOString(),
				uuid: randomUUID,
				storedPrincipal,
			});
			if (!result.ok) return result;
			let stateBytes = source;
			if (!result.replayed) {
				const serialized = serializeReviewState(result.state, principal.role);
				if (!serialized.ok) return serialized;
				stateBytes = serialized.value;
			}
			await publishDurableSet(root, manifest, stateBytes);
			return {
				ok: true,
				receipt: result.receipt,
				replayed: result.replayed,
				thread:
					admitted.ok && policy.visibleTo(admitted.value, result.thread, result.state)
						? result.thread
						: null,
			};
		});
	}
	return {
		reviewId,
		principalFor(role: ReviewRole, provenance: ReviewProvenance): Promise<ReviewPrincipal> {
			return withManifest("read", async (_root, manifest) => ({
				...manifest.localPrincipal,
				role,
				provenance,
			}));
		},
		list(principal: ReviewPrincipal, options?: ListThreadsOptions) {
			return read("read", async (_root, manifest, { state }) =>
				listThreads(state, principal, options, policy, isManifestPrincipal(manifest, principal)),
			);
		},
		create: (principal: ReviewPrincipal, payload: unknown) =>
			mutate("create", create, principal, payload),
		reply: (principal: ReviewPrincipal, payload: unknown) =>
			mutate("reply", reply, principal, payload),
		resolve: (principal: ReviewPrincipal, payload: unknown) =>
			mutate("resolve", resolve, principal, payload),
		reopen: (principal: ReviewPrincipal, payload: unknown) =>
			mutate("reopen", reopen, principal, payload),
	};
}
export type ReviewStore = Awaited<ReturnType<typeof openReviewStore>>;
