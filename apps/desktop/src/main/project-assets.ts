import { type BigIntStats, constants } from "node:fs";
import { type FileHandle, open, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { getFileExtension } from "../shared/path-utils";
import { isWithin, resolveExistingPathWithin } from "./path-security";
import { isProjectRecoveryPath, withProjectFileTransaction } from "./project-file-transactions";
import { IDENTITY_LINEAGE_PATHS } from "./project-protected-paths";

function refuseAsset(root: string, path: string, code: string): never {
	throw Object.assign(new Error(`${code}: ${relative(root, path).replaceAll("\\", "/")}`), {
		code,
	});
}

type InternalPath = { path: string; scan: boolean };
async function internalPaths(root: string): Promise<InternalPath[]> {
	const paths = new Map<string, boolean>();
	// Check canonical children too: an outside writer can move a store into assets
	// and replace its original name with a contained directory link.
	const names = [
		...IDENTITY_LINEAGE_PATHS,
		".praxity/local",
		".praxity/notes",
		".git",
		"node_modules",
	];
	for (const entry of await readdir(root, { withFileTypes: true }))
		if (isProjectRecoveryPath(entry.name)) names.push(entry.name);
	for (const name of names) {
		try {
			const path = await resolveExistingPathWithin(root, join(root, name));
			// A store alias wins over an optional dependency/git directory at the same path.
			paths.set(path, paths.get(path) === true || ![".git", "node_modules"].includes(name));
		} catch (error) {
			if (name === ".praxity" || name.startsWith(`.praxity/`) || name.startsWith(`.praxity\\`)) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					refuseAsset(root, join(root, name), "asset-store-unavailable");
			}
		}
	}
	return [...paths].map(([path, scan]) => ({ path, scan }));
}

async function protectedFileIdentities(
	root: string,
	internals: InternalPath[],
): Promise<Map<string, string>> {
	const identities = new Map<string, string>();
	function remember(info: BigIntStats, internal: boolean) {
		if (!info.isFile()) return;
		if (info.ino === 0n) throw new Error("Unavailable file identity");
		identities.set(
			`${info.dev}:${info.ino}`,
			internal ? "asset-internal-refused" : "asset-source-refused",
		);
	}
	const visited = new Set<string>();
	async function inspect(directory: string, internal: boolean): Promise<void> {
		const canonical = await resolveExistingPathWithin(root, directory);
		if (visited.has(canonical)) return;
		visited.add(canonical);
		for (const entry of await readdir(canonical, { withFileTypes: true })) {
			if (!internal && [".git", "node_modules", ".praxity"].includes(entry.name)) continue;
			const file = join(canonical, entry.name);
			const owned = internal || isProjectRecoveryPath(entry.name);
			// Authored directory links are not lesson inventories. Internal links
			// still name owned bytes and must be checked through containment.
			if (entry.isDirectory() || (owned && entry.isSymbolicLink())) {
				let target: string;
				try {
					target = await resolveExistingPathWithin(root, file);
				} catch (error) {
					if (owned && !internal) continue;
					throw error;
				}
				const targetInfo = await stat(target, { bigint: true });
				if (targetInfo.isDirectory()) {
					await inspect(target, owned);
					continue;
				}
			}
			if (!owned && getFileExtension(entry.name) !== "prax") continue;
			const target = await resolveExistingPathWithin(root, file);
			const author = await stat(target, { bigint: true });
			remember(author, owned);
		}
	}
	for (const { path: internal, scan } of internals) {
		if (!scan) continue;
		const target = await stat(internal, { bigint: true });
		if (target.isDirectory()) await inspect(internal, true);
		else remember(target, true);
	}
	await inspect(root, false);
	return identities;
}

/** One read owns the canonical stores and lazily shared protected identities. */
export function createProjectAssetAdmission(root: string) {
	let paths: Promise<InternalPath[]> | undefined;
	let canonical: Promise<string> | undefined;
	let identities: Promise<Map<string, string>> | undefined;
	const admitted = new Map<string, string>();
	const canonicalRoot = () => (canonical ??= resolveExistingPathWithin(root, root));
	const stores = () => (paths ??= canonicalRoot().then(internalPaths));
	async function assertIdentity(path: string, info: BigIntStats): Promise<void> {
		if (!info.isFile() || info.nlink <= 1n) return;
		// Bigint dev/ino preserve the Windows file ID without number rounding.
		if (info.ino === 0n) refuseAsset(root, path, "asset-identity-unavailable");
		let protectedCode: string | undefined;
		try {
			identities ??= stores().then(async (paths) =>
				protectedFileIdentities(await canonicalRoot(), paths),
			);
			protectedCode = (await identities).get(`${info.dev}:${info.ino}`);
		} catch {
			refuseAsset(root, path, "asset-identity-unavailable");
		}
		if (protectedCode) refuseAsset(root, path, protectedCode);
		admitted.set(`${info.dev}:${info.ino}`, path);
	}
	/** Bulk readers call this after their last byte read, before publishing any result. */
	async function finish(): Promise<void> {
		const firstPath = admitted.values().next().value;
		if (firstPath === undefined) return;
		let current: Map<string, string>;
		try {
			const canonical = await canonicalRoot();
			current = await protectedFileIdentities(canonical, await internalPaths(canonical));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "asset-store-unavailable") throw error;
			refuseAsset(root, firstPath, "asset-identity-unavailable");
		}
		for (const [identity, path] of admitted) {
			const code = current.get(identity);
			if (code) refuseAsset(root, path, code);
		}
	}
	async function resolve(path: string): Promise<string> {
		const safePath = await resolveExistingPathWithin(root, path);
		const rel = relative(await canonicalRoot(), safePath)
			.replaceAll("\\", "/")
			.toLowerCase();
		if (
			isProjectRecoveryPath(rel) ||
			[".praxity", ".git", "node_modules"].some(
				(name) => rel === name || rel.startsWith(`${name}/`),
			)
		)
			refuseAsset(root, path, "asset-internal-refused");
		let internals: InternalPath[];
		try {
			internals = await stores();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "asset-store-unavailable") throw error;
			refuseAsset(root, path, "asset-identity-unavailable");
		}
		for (const { path: internal } of internals)
			if (isWithin(internal, safePath)) refuseAsset(root, path, "asset-internal-refused");
		const info = await stat(safePath, { bigint: true });
		if (
			info.isFile() &&
			(getFileExtension(path) === "prax" || getFileExtension(safePath) === "prax")
		)
			refuseAsset(root, path, "asset-source-refused");
		await assertIdentity(path, info);
		return safePath;
	}

	/** The caller owns the handle; admission checks the opened inode before any byte read. */
	async function openAsset(path: string): Promise<FileHandle> {
		const safePath = await resolve(path);
		const file = await open(
			safePath,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		try {
			const opened = await file.stat({ bigint: true });
			if (!opened.isFile()) refuseAsset(root, path, "asset-not-file");
			await assertIdentity(path, opened);
			const current = await stat(await resolve(path), { bigint: true });
			if (current.dev !== opened.dev || current.ino !== opened.ino)
				refuseAsset(root, path, "asset-changed");
			return file;
		} catch (error) {
			await file.close();
			throw error;
		}
	}
	return { resolve, open: openAsset, finish };
}

/** Admit public resources by canonical path and file identity, never by their text. */
export async function resolveProjectAsset(root: string, path: string): Promise<string> {
	return createProjectAssetAdmission(root).resolve(path);
}

/** The caller owns the handle; admission checks the opened inode before any byte read. */
export async function openProjectAsset(root: string, path: string): Promise<FileHandle> {
	return createProjectAssetAdmission(root).open(path);
}

async function inventory(root: string): Promise<string[]> {
	const admission = createProjectAssetAdmission(root);
	const assets = join(root, "assets");
	try {
		await admission.resolve(assets);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const paths: string[] = [];
	async function walk(directory: string, ancestors: Set<string>): Promise<void> {
		const safeDirectory = await admission.resolve(directory);
		if (ancestors.has(safeDirectory)) throw new Error("Cyclic asset directory");
		const next = new Set(ancestors).add(safeDirectory);
		for (const entry of await readdir(safeDirectory, { withFileTypes: true })) {
			if (isProjectRecoveryPath(entry.name)) continue;
			const path = join(directory, entry.name);
			const safePath = await admission.resolve(path);
			const info = entry.isSymbolicLink() ? await stat(safePath) : entry;
			if (info.isDirectory()) await walk(path, next);
			else if (info.isFile()) paths.push(relative(root, path).replaceAll("\\", "/"));
			else throw new Error("Asset is not a regular file");
		}
	}
	await walk(assets, new Set());
	await admission.finish();
	return paths;
}
export async function listProjectAssets(root: string): Promise<string[]> {
	return withProjectFileTransaction(root, async (root) => (await inventory(root)).sort(), "read");
}
