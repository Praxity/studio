import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { constants, realpath as fsRealpath } from "node:fs";
import {
	access,
	chmod,
	type FileHandle,
	lstat,
	open,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { ProjectFileBusyError, ProjectLockCacheOverlapError } from "../shared/project-write-errors";

const realpath = promisify(fsRealpath.native);

const admittedRoots = new AsyncLocalStorage<{ root: string; identity: string; active: boolean }>();
function directoryIdentity(entry: Awaited<ReturnType<typeof rootEntry>>): string {
	if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Project directory changed");
	return `${entry.dev}:${entry.ino}:${entry.birthtimeNs}`;
}
const rootEntry = (root: string) => lstat(root, { bigint: true });

export async function withProjectPathAdmission<T>(
	root: string,
	work: () => Promise<T>,
): Promise<T> {
	const identity = directoryIdentity(await rootEntry(root));
	const admission = { root, identity, active: true };
	return admittedRoots.run(admission, async () => {
		try {
			return await work();
		} finally {
			admission.active = false;
		}
	});
}

async function resolveRoot(root: string): Promise<string> {
	const admitted = admittedRoots.getStore();
	return admitted?.active && root === admitted.root ? root : realpath(root);
}

async function assertAdmittedRoot(root: string): Promise<void> {
	const admitted = admittedRoots.getStore();
	if (!admitted?.active || root !== admitted.root) return;
	if (directoryIdentity(await rootEntry(root)) !== admitted.identity)
		throw new Error("Project directory changed");
}

export function projectLockCacheDirectory(): string {
	return join(homedir(), ".praxity-studio", "project-locks");
}

export function isWithin(root: string, target: string): boolean {
	const rel = relative(root, target);
	return (
		rel !== ".." &&
		!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
		!isAbsolute(rel)
	);
}

async function canonicalPath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const entry = await lstat(path).catch((cause: NodeJS.ErrnoException) => {
			if (cause.code !== "ENOENT") throw cause;
			return undefined;
		});
		if (entry?.isSymbolicLink()) throw error;
		if (dirname(path) === path) throw error;
		return join(await canonicalPath(dirname(path)), basename(path));
	}
}

export async function assertOutsideProjectLockCache(target: string): Promise<void> {
	const cache = projectLockCacheDirectory();
	const [realCache, realTarget] = await Promise.all([
		canonicalPath(cache),
		canonicalPath(resolve(target)),
	]);
	if (isWithin(cache, resolve(target)) || isWithin(realCache, realTarget))
		throw new ProjectLockCacheOverlapError();
}

export async function assertAllowedProjectRoot(projectPath: string): Promise<string> {
	const [root, cache, home] = await Promise.all([
		realpath(projectPath),
		canonicalPath(projectLockCacheDirectory()),
		canonicalPath(homedir()),
	]);
	if (
		isWithin(root, join(home, ".praxity-studio", "project-locks")) ||
		isWithin(root, cache) ||
		isWithin(cache, root)
	)
		throw new ProjectLockCacheOverlapError();
	return root;
}

function assertInside(targetPath: string, rootPath: string): void {
	const rel = relative(rootPath, targetPath);
	if (
		rel === ".." ||
		rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		isAbsolute(rel)
	) {
		throw new Error("Path traversal blocked");
	}
}

export async function resolveExistingPathWithin(
	rootPath: string,
	targetPath: string,
): Promise<string> {
	const [realRoot, realTarget] = await Promise.all([
		resolveRoot(rootPath),
		realpath(targetPath).catch(async (error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
			const entry = await lstat(targetPath).catch((cause: NodeJS.ErrnoException) => {
				if (cause.code !== "ENOENT") throw cause;
				return undefined;
			});
			if (entry?.isSymbolicLink())
				throw new Error("Symbolic link target cannot be resolved", { cause: error });
			throw error;
		}),
	]);
	assertInside(realTarget, realRoot);
	await assertOutsideProjectLockCache(realTarget);
	await assertAdmittedRoot(rootPath);
	return realTarget;
}

export async function resolveWritablePathWithin(
	rootPath: string,
	targetPath: string,
): Promise<string> {
	const [realRoot, realParent] = await Promise.all([
		resolveRoot(rootPath),
		realpath(dirname(targetPath)),
	]);
	assertInside(realParent, realRoot);
	const safePath = join(realParent, basename(targetPath));
	await assertOutsideProjectLockCache(safePath);
	try {
		if ((await lstat(safePath)).isSymbolicLink()) throw new Error("Symbolic links are not allowed");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await assertAdmittedRoot(rootPath);
	return safePath;
}

export async function openFileWithin(rootPath: string, targetPath: string): Promise<FileHandle> {
	const safePath = await resolveExistingPathWithin(rootPath, targetPath);
	return open(safePath, constants.O_RDONLY | constants.O_NOFOLLOW);
}

export async function readFileWithin(
	rootPath: string,
	targetPath: string,
	encoding?: BufferEncoding,
): Promise<Buffer | string> {
	const file = await openFileWithin(rootPath, targetPath);
	try {
		return encoding ? await file.readFile({ encoding }) : await file.readFile();
	} finally {
		await file.close();
	}
}

export async function sha256FileWithin(rootPath: string, targetPath: string): Promise<string> {
	const safePath = await resolveExistingPathWithin(rootPath, targetPath);
	const file = await open(
		safePath,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		if (!(await file.stat()).isFile()) throw new Error("Not a regular file");
		const hash = createHash("sha256");
		for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
		return hash.digest("hex");
	} finally {
		await file.close();
	}
}

export class FileNotWritableError extends Error {}

export async function assertFileWritableWithin(root: string, destination: string) {
	const target = await resolveWritablePathWithin(root, destination);
	const entry = await lstat(target).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
		return undefined;
	});
	if (entry) {
		if (!entry.isFile()) throw new FileNotWritableError();
		if (!(entry.mode & 0o222)) throw new FileNotWritableError();
		await access(target, constants.W_OK);
	}
	return entry?.mode;
}

export async function waitForFileSharingRetry(error: unknown, attempt: number): Promise<void> {
	const code = (error as NodeJS.ErrnoException).code;
	if (!code || !["EPERM", "EBUSY", "EACCES"].includes(code)) throw error;
	const wait = [25, 50, 100, 200, 200][attempt];
	if (wait === undefined) throw new ProjectFileBusyError(error);
	await delay(wait);
}

export async function writeFileAtomicallyWithin(
	root: string,
	destination: string,
	bytes: Buffer,
	signal?: AbortSignal,
	recordStage?: (file: string) => Promise<void>,
	durability?: {
		syncFile(root: string, path: string): Promise<void>;
		syncDirectory(path: string): Promise<void>;
	},
): Promise<void> {
	const target = await resolveWritablePathWithin(root, destination);
	const mode = await assertFileWritableWithin(root, target);
	const temporary = await resolveWritablePathWithin(
		root,
		join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`),
	);
	try {
		signal?.throwIfAborted();
		await recordStage?.(temporary);
		await writeFile(temporary, bytes, {
			flag: "wx",
			mode: mode === undefined ? 0o666 : mode & 0o777,
			signal,
		});
		if (mode !== undefined) await chmod(temporary, mode & 0o777);
		await durability?.syncFile(root, temporary);
		signal?.throwIfAborted();
		for (let attempt = 0; ; attempt++) {
			signal?.throwIfAborted();
			await resolveWritablePathWithin(root, target);
			await assertFileWritableWithin(root, target);
			try {
				await rename(temporary, target);
				break;
			} catch (error) {
				if (!durability || process.platform !== "win32") throw error;
				await waitForFileSharingRetry(error, attempt);
			}
		}
		if (durability && process.platform === "win32") await durability.syncFile(root, target);
		await durability?.syncDirectory(dirname(target));
	} finally {
		await rm(temporary, { force: true });
	}
}

export async function writeFileWithin(
	rootPath: string,
	targetPath: string,
	data: string | Uint8Array,
	encoding?: BufferEncoding,
): Promise<void> {
	const safePath = await resolveWritablePathWithin(rootPath, targetPath);
	const file = await open(
		safePath,
		constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
		0o666,
	);
	try {
		await file.writeFile(data, encoding ? { encoding } : undefined);
	} finally {
		await file.close();
	}
}

export async function createFileWithin(
	rootPath: string,
	targetPath: string,
	data: string | Uint8Array,
	encoding?: BufferEncoding,
): Promise<void> {
	const safePath = await resolveWritablePathWithin(rootPath, targetPath);
	const file = await open(
		safePath,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o666,
	);
	try {
		await file.writeFile(data, encoding ? { encoding } : undefined);
	} finally {
		await file.close();
	}
}

export async function assertSamePath(firstPath: string, secondPath: string): Promise<void> {
	const [first, second] = await Promise.all([
		realpath(resolve(firstPath)),
		realpath(resolve(secondPath)),
	]);
	if (first !== second) throw new Error("Path is outside the active project");
}

export async function isSamePath(firstPath: string, secondPath: string): Promise<boolean> {
	try {
		const [first, second] = await Promise.all([
			realpath(resolve(firstPath)),
			realpath(resolve(secondPath)),
		]);
		return first === second;
	} catch {
		return false;
	}
}
