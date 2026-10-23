import { createHash, randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { type FileHandle, mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { resolveExistingPathWithin, resolveWritablePathWithin } from "../path-security";
import { createProjectAssetAdmission } from "../project-assets";
import { isProjectRecoveryPath } from "../project-file-transactions";

export interface AdmittedAssets {
	bytes: Map<string, Uint8Array>;
	digests: Map<string, string>;
}

interface AdmittedAsset {
	stamp: string;
	bytes: Uint8Array;
	digest: string;
	reusable: boolean;
}

const ASSET_ADMISSION_BATCH_SIZE = 8;
// Fractional timestamps can still repeat within a filesystem clock tick.
// Two seconds covers FAT's write tick as well as shorter NTFS clock ticks.
const ASSET_TIMESTAMP_SETTLE_NS = 2_000_000_000n;

function stamp(file: string, info: BigIntStats): string {
	if (!info.isFile()) throw new Error("Asset is not a regular file");
	// ctime and inode also catch same-size replacements with a restored mtime.
	return `${file}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}

function canReuse(info: BigIntStats, filesystemNow: BigIntStats | undefined): boolean {
	// Zero/missing inode IDs and unknown timestamp precision cannot establish freshness.
	// Require observed sub-millisecond precision per file. This also bypasses FAT/exFAT
	// stamps that have fractional seconds but still cannot distinguish rapid writes.
	return (
		filesystemNow !== undefined &&
		filesystemNow.dev === info.dev &&
		typeof filesystemNow.mtimeNs === "bigint" &&
		typeof info.dev === "bigint" &&
		info.dev >= 0n &&
		typeof info.ino === "bigint" &&
		info.ino > 0n &&
		typeof info.mtimeNs === "bigint" &&
		typeof info.ctimeNs === "bigint" &&
		(info.mtimeNs % 1_000_000n !== 0n || info.ctimeNs % 1_000_000n !== 0n) &&
		filesystemNow.mtimeNs - (info.mtimeNs > info.ctimeNs ? info.mtimeNs : info.ctimeNs) >
			ASSET_TIMESTAMP_SETTLE_NS
	);
}

function isReadOnlyProbeError(error: unknown): boolean {
	return ["EACCES", "EPERM", "EROFS"].includes((error as NodeJS.ErrnoException).code ?? "");
}

async function sampleFilesystemTime(projectDir: string): Promise<BigIntStats | undefined> {
	let cacheDirectory = projectDir;
	try {
		for (const name of [".praxity", "cache"]) {
			cacheDirectory = await resolveWritablePathWithin(projectDir, path.join(cacheDirectory, name));
			try {
				await mkdir(cacheDirectory);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		}
	} catch (error) {
		// Read-only projects still admit assets, but cannot prove timestamp freshness.
		if (isReadOnlyProbeError(error)) return undefined;
		throw error;
	}
	let probe: string;
	let handle: FileHandle;
	try {
		probe = await resolveWritablePathWithin(
			projectDir,
			path.join(cacheDirectory, `.inventory-clock-${randomUUID()}`),
		);
		handle = await open(probe, "wx");
	} catch (error) {
		if (isReadOnlyProbeError(error)) return undefined;
		throw error;
	}
	try {
		try {
			await handle.writeFile("x");
		} finally {
			// Windows may defer timestamp updates until the writer handle closes.
			await handle.close();
		}
		try {
			return await stat(probe, { bigint: true });
		} catch (error) {
			if (isReadOnlyProbeError(error)) return undefined;
			throw error;
		}
	} finally {
		await unlink(probe);
	}
}

async function matchesBytes(file: FileHandle, expected: Uint8Array): Promise<boolean> {
	const buffer = Buffer.allocUnsafe(Math.min(expected.length + 1, 64 * 1024));
	let offset = 0;
	while (offset < expected.length) {
		const { bytesRead } = await file.read(
			buffer,
			0,
			Math.min(buffer.length, expected.length - offset),
			offset,
		);
		if (
			bytesRead === 0 ||
			Buffer.compare(
				buffer.subarray(0, bytesRead),
				expected.subarray(offset, offset + bytesRead),
			) !== 0
		)
			return false;
		offset += bytesRead;
	}
	return (await file.read(buffer, 0, 1, offset)).bytesRead === 0;
}

/** One project host owns this inventory; all reads retain the path admission. */
export class ProjectAssetInventory {
	private entries = new Map<string, AdmittedAsset>();
	private generation = 0;
	constructor(
		readonly projectDir: string,
		private readonly readBytes = async (file: FileHandle): Promise<Uint8Array> => file.readFile(),
	) {}

	invalidate(file?: string): void {
		this.generation++;
		if (file === undefined) this.entries.clear();
		else {
			const normalize = (value: string) =>
				process.platform === "win32" ? value.toLowerCase() : value;
			const key = normalize(path.resolve(this.projectDir, file));
			for (const name of this.entries.keys()) {
				const candidate = normalize(path.resolve(this.projectDir, name));
				if (candidate === key || candidate.startsWith(`${key}${path.sep}`))
					this.entries.delete(name);
			}
		}
	}

	async read(): Promise<AdmittedAssets> {
		const admission = createProjectAssetAdmission(this.projectDir);
		const generation = this.generation;
		const next = new Map<string, AdmittedAsset>();
		const bytes = new Map<string, Uint8Array>();
		const digests = new Map<string, string>();
		const walk = async (directory: string, ancestors = new Set<string>()): Promise<void> => {
			const safeDirectory = await admission.resolve(directory);
			if (ancestors.has(safeDirectory)) throw new Error("Cyclic asset directory");
			const nextAncestors = new Set(ancestors).add(safeDirectory);
			const listing = await readdir(safeDirectory, { withFileTypes: true });
			const admit = async (
				entry: (typeof listing)[number],
				filesystemNow: BigIntStats | undefined,
			) => {
				if (isProjectRecoveryPath(entry.name)) return;
				const file = path.join(directory, entry.name);
				const safePath = await admission.resolve(file);
				const info = await stat(safePath, { bigint: true });
				if (info.isDirectory()) {
					return { directory: file };
				}
				if (!info.isFile()) throw new Error("Asset is not a regular file");
				const relative = path.relative(this.projectDir, file).replace(/\\/g, "/");
				const before = stamp(safePath, info);
				let admitted = this.entries.get(relative);
				if (!canReuse(info, filesystemNow) || !admitted?.reusable || admitted.stamp !== before) {
					admitted = undefined;
					let openedPath = safePath;
					for (let attempt = 0; attempt < 3; attempt++) {
						const handle = await admission.open(file);
						try {
							const openedInfo = await handle.stat({ bigint: true });
							const opened = stamp(openedPath, openedInfo);
							// Capture this before reading. An unsafe snapshot must never become
							// reusable just because its timestamp ages after a missed write.
							const reusable = canReuse(openedInfo, filesystemNow);
							const value = Uint8Array.from(await this.readBytes(handle));
							// A completed overwrite can leave even fractional stamps unchanged.
							// Verify from offset zero on the same admitted inode in that window.
							const verified = reusable || (await matchesBytes(handle, value));
							const after = stamp(openedPath, await handle.stat({ bigint: true }));
							const target = await resolveExistingPathWithin(this.projectDir, file);
							const current = stamp(target, await stat(target, { bigint: true }));
							// Bind bytes to the opened inode, then check the link still names it.
							if (verified && opened === after && after === current) {
								admitted = {
									stamp: after,
									bytes: value,
									digest: createHash("sha256").update(value).digest("hex"),
									reusable,
								};
								break;
							}
							openedPath = target;
						} finally {
							await handle.close();
						}
					}
					if (!admitted) throw new Error(`Asset changed while reading: ${relative}`);
				}
				return { relative, admitted };
			};
			for (let offset = 0; offset < listing.length; offset += ASSET_ADMISSION_BATCH_SIZE) {
				// A fresh write samples this filesystem's clock before any batch admission.
				// Never compare asset timestamps with the reader's wall clock.
				const filesystemNow = await sampleFilesystemTime(this.projectDir);
				// Drain failures before invalidating. No worker may outlive this admission.
				const results = await Promise.allSettled(
					listing
						.slice(offset, offset + ASSET_ADMISSION_BATCH_SIZE)
						.map((entry) => admit(entry, filesystemNow)),
				);
				for (const result of results) if (result.status === "rejected") throw result.reason;
				for (const result of results) {
					if (result.status !== "fulfilled" || !result.value) continue;
					const entry = result.value;
					// Descend after the batch settles to keep the cap global across directories.
					// Publish in traversal order, regardless of filesystem completion order.
					if (entry.directory !== undefined) await walk(entry.directory, nextAncestors);
					else {
						next.set(entry.relative, entry.admitted);
						bytes.set(entry.relative, Uint8Array.from(entry.admitted.bytes));
						digests.set(entry.relative, entry.admitted.digest);
					}
				}
			}
		};
		const assetsDir = path.join(this.projectDir, "assets");
		try {
			await admission.resolve(assetsDir);
		} catch (error) {
			this.invalidate();
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bytes, digests };
			throw error;
		}
		try {
			await walk(assetsDir);
			await admission.finish();
			// An event during a read must not repopulate an invalidated inventory.
			if (generation === this.generation) this.entries = next;
		} catch (error) {
			this.invalidate();
			throw error;
		}
		return { bytes, digests };
	}
}
