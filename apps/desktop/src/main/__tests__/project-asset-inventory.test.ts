import { createHash } from "node:crypto";
import type { BigIntStats, Stats } from "node:fs";
import {
	type FileHandle,
	mkdir,
	mkdtemp,
	readFile as nativeReadFile,
	open,
	readdir,
	rename,
	rm,
	symlink,
	unlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, type Mock, vi } from "vitest";
import {
	buildCourseExportInput,
	ProjectLessonPreparation,
} from "../export/build-export-input-from-project";
import { ProjectAssetInventory } from "../export/project-asset-inventory";

const metadata = vi.hoisted(() => ({
	precision: "native" as "native" | "seconds" | "milliseconds" | "unknown" | "fine" | "recent",
	precisionPath: undefined as string | undefined,
	unknownIdentity: false,
	recentStamp: 0n,
	filesystemNow: 0n,
	probeDevice: undefined as bigint | undefined,
	unknownProbeTime: false,
	probeError: undefined as string | undefined,
	probeErrorStage: "create" as "directory" | "create" | "time",
	afterStat: undefined as
		| ((target: string, source: "path" | "handle") => Promise<void>)
		| undefined,
	afterOpen: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	const adjust = <T extends Stats | BigIntStats>(info: T, target: string): T => {
		if (path.basename(target).startsWith(".inventory-clock-")) {
			if ("mtimeNs" in info) {
				info.mtimeNs = metadata.filesystemNow;
				if (metadata.probeDevice !== undefined) info.dev = metadata.probeDevice;
				if (metadata.unknownProbeTime) Reflect.deleteProperty(info, "mtimeNs");
			}
			return info;
		}
		// Cache-hit fixtures need a settled fine stamp, independent of machine load.
		const precision =
			metadata.precisionPath && target !== metadata.precisionPath ? "fine" : metadata.precision;
		if ("mtimeNs" in info) {
			if (
				precision === "seconds" ||
				precision === "milliseconds" ||
				precision === "fine" ||
				precision === "recent"
			) {
				// Deterministic equivalent of two writes within one coarse filesystem tick.
				info.mtimeNs =
					precision === "seconds"
						? 1_000_000_000n
						: precision === "milliseconds"
							? 1_010_000_000n
							: precision === "recent"
								? metadata.recentStamp
								: 1_000_000_100n;
				info.ctimeNs = info.mtimeNs;
			} else if (precision === "unknown") {
				Reflect.deleteProperty(info, "mtimeNs");
				Reflect.deleteProperty(info, "ctimeNs");
			}
			if (metadata.unknownIdentity) info.ino = 0n;
		}
		return info;
	};
	return {
		...actual,
		mkdir: vi.fn(async (...args: Parameters<typeof actual.mkdir>) => {
			if (
				metadata.probeErrorStage === "directory" &&
				metadata.probeError &&
				path.basename(String(args[0])) === ".praxity"
			)
				throw Object.assign(new Error("Planted clock probe failure"), {
					code: metadata.probeError,
				});
			return actual.mkdir(...args);
		}),
		stat: vi.fn(async (...args: Parameters<typeof actual.stat>) => {
			const target = String(args[0]);
			if (
				metadata.probeErrorStage === "time" &&
				metadata.probeError &&
				path.basename(target).startsWith(".inventory-clock-")
			)
				throw Object.assign(new Error("Planted clock probe failure"), {
					code: metadata.probeError,
				});
			const info = adjust(await actual.stat(...args), target);
			await metadata.afterStat?.(target, "path");
			return info;
		}),
		open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
			const probe = path.basename(String(args[0])).startsWith(".inventory-clock-");
			if (probe && metadata.probeError && metadata.probeErrorStage === "create")
				throw Object.assign(new Error("Planted clock probe failure"), {
					code: metadata.probeError,
				});
			const handle = await actual.open(...args);
			const originalStat = handle.stat.bind(handle);
			vi.spyOn(handle, "stat").mockImplementation(async (options) => {
				const target = String(args[0]);
				const info = adjust(await originalStat(options), target);
				await metadata.afterStat?.(target, "handle");
				return info;
			});
			if (!probe) await metadata.afterOpen?.();
			return handle;
		}),
	};
});

let root: string;
let cache: ProjectAssetInventory;
let reads: Mock<(file: FileHandle) => Promise<Uint8Array>>;
const file = () => path.join(root, "assets", "a.png");
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "asset-inventory-"));
	metadata.recentStamp = BigInt(Date.now()) * 1_000_000n + 100n;
	metadata.filesystemNow = metadata.recentStamp + 1_000_000n;
	await mkdir(path.join(root, "assets"));
	await writeFile(file(), "first");
	reads = vi.fn(async (file: FileHandle) => file.readFile());
	cache = new ProjectAssetInventory(root, reads);
});
it.each(["ahead client", "forward jump", "slow filesystem clock"])(
	"refuses stale admission with %s and repeated fractional stamps",
	async (scenario) => {
		metadata.precision = "recent";
		for (let index = 0; index < 7; index++)
			await writeFile(path.join(root, "assets", `b${index}.png`), "batch");
		const stampMs = Number(metadata.recentStamp / 1_000_000n);
		const clock = vi.spyOn(Date, "now").mockReturnValue(stampMs + 60_000);
		if (scenario === "slow filesystem clock") {
			metadata.recentStamp -= 60_000_000_000n;
			metadata.filesystemNow -= 60_000_000_000n;
			clock.mockReturnValue(stampMs);
		} else if (scenario === "forward jump") {
			clock.mockReturnValue(stampMs + 1);
			metadata.afterOpen = async () => {
				clock.mockReturnValue(stampMs + 60_000);
			};
		}
		let mutation: Promise<void> | undefined;
		reads.mockImplementation(async (handle) => {
			const value = await handle.readFile();
			if (Buffer.from(value).toString() === "first") mutation ??= writeFile(file(), "other");
			await mutation;
			return value;
		});
		await cache.read();
		// Writer is finished before this retained read. No overlap permits old bytes.
		const retained = await cache.read();
		const cold = await new ProjectAssetInventory(root).read();
		expect(Buffer.from(await nativeReadFile(file())).toString()).toBe("other");
		expect(Buffer.from(cold.bytes.get("assets/a.png") ?? []).toString()).toBe("other");
		expect(Buffer.from(retained.bytes.get("assets/a.png") ?? []).toString()).toBe("other");
	},
);

it("retained lesson preparation cannot reuse stale asset bytes under clock skew", async () => {
	metadata.precision = "recent";
	vi.spyOn(Date, "now").mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 60_000);
	await writeFile(path.join(root, "lesson.prax"), "---\ntitle: Test\n---\n# Page\n\nText\n");
	const options = {
		manifestPolicy: "read-only" as const,
		projectDir: root,
		mode: "preview" as const,
		scope: "course" as const,
		completionThreshold: 80,
		viewerVersionPath: path.join(root, "viewer.json"),
		assetInventory: cache,
		lessonPreparation: new ProjectLessonPreparation(root),
	};
	const first = await buildCourseExportInput(options);
	expect(Buffer.from(first.resolvedAssets.get("assets/a.png") ?? []).toString()).toBe("first");
	await writeFile(file(), "other");
	const fresh = await buildCourseExportInput({
		...options,
		assetInventory: undefined,
		lessonPreparation: undefined,
	});
	expect(Buffer.from(fresh.resolvedAssets.get("assets/a.png") ?? []).toString()).toBe("other");
	const retained = await buildCourseExportInput(options);
	expect(Buffer.from(retained.resolvedAssets.get("assets/a.png") ?? []).toString()).toBe("other");
});

it("verifies future timestamps and resumes reuse after fresh settled admission", async () => {
	metadata.precision = "recent";
	const stampMs = Number(metadata.recentStamp / 1_000_000n);
	const clock = vi.spyOn(Date, "now").mockReturnValue(stampMs - 60_000);
	metadata.filesystemNow = metadata.recentStamp - 60_000_000_000n;
	reads.mockImplementationOnce(async (handle) => {
		const value = await handle.readFile();
		await writeFile(file(), "other");
		return value;
	});
	expect(Buffer.from((await cache.read()).bytes.get("assets/a.png") ?? []).toString()).toBe(
		"other",
	);
	expect(reads).toHaveBeenCalledTimes(2);
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(3);
	clock.mockReturnValue(stampMs + 3000);
	metadata.filesystemNow = metadata.recentStamp + 3_000_000_000n;
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(4);
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(4);
});

it.each(["same-size", "truncate-extend"])(
	"keeps the next read fresh after %s lands during byte verification",
	async (mode) => {
		metadata.precision = "recent";
		const clock = vi
			.spyOn(Date, "now")
			.mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 1);
		let changed = false;
		reads.mockImplementationOnce(async (handle) => {
			const original = handle.read.bind(handle);
			vi.spyOn(handle, "read").mockImplementation(async (...args) => {
				const result = await original(...args);
				if (!changed) {
					changed = true;
					if (mode === "truncate-extend") {
						const writer = await open(file(), "r+");
						try {
							await writer.truncate(0);
							await writer.writeFile("other");
						} finally {
							await writer.close();
						}
					} else await writeFile(file(), "other");
				}
				return result;
			});
			return handle.readFile();
		});
		const overlapped = await cache.read();
		expect(changed).toBe(true);
		// The first verification chunk was valid before the overlapping write.
		expect(Buffer.from(overlapped.bytes.get("assets/a.png") ?? []).toString()).toBe("first");
		clock.mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 10_000);
		metadata.filesystemNow = metadata.recentStamp + 10_000_000_000n;
		expect(Buffer.from((await cache.read()).bytes.get("assets/a.png") ?? []).toString()).toBe(
			"other",
		);
	},
);

it("rereads only the recently touched asset until stamps settle", async () => {
	metadata.precision = "recent";
	metadata.precisionPath = file();
	const clock = vi
		.spyOn(Date, "now")
		.mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 1);
	for (let index = 0; index < 15; index++)
		await writeFile(path.join(root, "assets", `b${index}.png`), "settled");
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(16);
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(17);
	clock.mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 3000);
	metadata.filesystemNow = metadata.recentStamp + 3_000_000_000n;
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(18);
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(18);
});

it("admits and reuses settled assets without reading the process wall clock", async () => {
	metadata.precision = "fine";
	vi.spyOn(Date, "now").mockImplementation(() => {
		throw new Error("Process wall clock must not establish asset freshness");
	});
	expect((await cache.read()).bytes.get("assets/a.png")).toEqual(
		new Uint8Array(Buffer.from("first")),
	);
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(1);
});

it.each(["directory", "create", "time"] as const)(
	"verifies bytes when the filesystem clock probe refuses during %s",
	async (stage) => {
		metadata.precision = "fine";
		metadata.probeErrorStage = stage;
		metadata.probeError = stage === "directory" ? "EROFS" : stage === "create" ? "EPERM" : "EACCES";
		reads.mockImplementationOnce(async (handle) => {
			const value = await handle.readFile();
			await writeFile(file(), "other");
			return value;
		});
		const admitted = await cache.read();
		expect(admitted.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("other")));
		expect(admitted.digests.get("assets/a.png")).toBe(
			createHash("sha256").update("other").digest("hex"),
		);
		await cache.read();
		expect(reads).toHaveBeenCalledTimes(3);
	},
);

it.each(["another device", "unknown time"])(
	"verifies bytes when the filesystem clock probe has %s",
	async (kind) => {
		metadata.precision = "fine";
		if (kind === "another device") metadata.probeDevice = 999_999_999n;
		else metadata.unknownProbeTime = true;
		const fresh = await new ProjectAssetInventory(root).read();
		expect(fresh.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("first")));
		await cache.read();
		await writeFile(file(), "other");
		const admitted = await cache.read();
		expect(admitted.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("other")));
		expect(reads).toHaveBeenCalledTimes(2);
	},
);

it("takes a fresh filesystem clock probe for each batch and then stops reading bytes", async () => {
	metadata.precision = "recent";
	for (let index = 0; index < 8; index++)
		await writeFile(path.join(root, "assets", `b${index}.png`), "batch");
	const verifications: ReturnType<typeof vi.spyOn>[] = [];
	reads.mockImplementation(async (handle) => {
		verifications.push(vi.spyOn(handle, "read"));
		const value = await handle.readFile();
		metadata.filesystemNow = metadata.recentStamp + 3_000_000_000n;
		return value;
	});
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(9);
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(17);
	const verified = verifications.reduce((count, read) => count + read.mock.calls.length, 0);
	expect(verified).toBeGreaterThan(0);
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(17);
	expect(verifications.reduce((count, read) => count + read.mock.calls.length, 0)).toBe(verified);
	expect(await readdir(path.join(root, ".praxity", "cache"))).toEqual([]);
});

it("verifies stamps on the filesystem settling boundary", async () => {
	metadata.precision = "recent";
	metadata.filesystemNow = metadata.recentStamp + 2_000_000_000n;
	await cache.read();
	await writeFile(file(), "other");
	expect((await cache.read()).bytes.get("assets/a.png")).toEqual(
		new Uint8Array(Buffer.from("other")),
	);
	metadata.filesystemNow++;
	await cache.read();
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(3);
});

it("propagates unexpected filesystem clock probe errors and clears retained entries", async () => {
	metadata.precision = "fine";
	await cache.read();
	metadata.probeError = "EIO";
	await expect(cache.read()).rejects.toThrow("Planted clock probe failure");
	metadata.probeError = undefined;
	metadata.probeErrorStage = "create";
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(2);
});

it.each([".praxity", ".praxity/cache"])(
	"refuses a clock probe through a %s directory symlink",
	async (directory) => {
		const outside = await mkdtemp(path.join(tmpdir(), "outside-clock-"));
		try {
			const alias = path.join(root, directory);
			await mkdir(path.dirname(alias), { recursive: true });
			await symlink(outside, alias, "junction");
			if (directory === ".praxity")
				await expect(cache.read()).rejects.toMatchObject({
					code: "asset-store-unavailable",
					message: "asset-store-unavailable: .praxity",
				});
			else await expect(cache.read()).rejects.toThrow("Symbolic links are not allowed");
			expect(await readdir(outside)).toEqual([]);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	},
);
afterEach(async () => {
	metadata.precision = "native";
	metadata.precisionPath = undefined;
	metadata.unknownIdentity = false;
	metadata.afterStat = undefined;
	metadata.afterOpen = undefined;
	metadata.probeDevice = undefined;
	metadata.unknownProbeTime = false;
	metadata.probeError = undefined;
	metadata.probeErrorStage = "create";
	await rm(root, { recursive: true, force: true });
});
it("reuses admitted bytes and digests across unchanged preview builds", async () => {
	metadata.precision = "fine";
	await writeFile(path.join(root, "lesson.prax"), "---\ntitle: Test\n---\n# Page\n\nText\n");
	const options = {
		manifestPolicy: "read-only" as const,
		projectDir: root,
		mode: "preview" as const,
		scope: "course" as const,
		completionThreshold: 0.8,
		viewerVersionPath: path.join(root, "viewer.json"),
		assetInventory: cache,
	};
	const first = await buildCourseExportInput(options);
	const second = await buildCourseExportInput(options);
	expect(second.resolvedAssets).toEqual(first.resolvedAssets);
	expect(reads).toHaveBeenCalledTimes(1);
	expect(second.resolvedAssetDigests?.get("assets/a.png")).toBe(
		createHash("sha256").update("first").digest("hex"),
	);
});
it("detects missed changes including same size and restored mtime", async () => {
	await cache.read();
	const { stat } = await import("node:fs/promises");
	const before = await stat(file());
	await writeFile(file(), "other");
	await utimes(file(), before.atime, before.mtime);
	expect((await cache.read()).bytes.get("assets/a.png")).toEqual(
		new Uint8Array(Buffer.from("other")),
	);
	expect(reads).toHaveBeenCalledTimes(2);
});
it("detects additions, deletes and rename without watcher delivery", async () => {
	await cache.read();
	await rename(file(), path.join(root, "assets", "renamed.png"));
	const moved = await cache.read();
	expect([...moved.bytes.keys()]).toEqual(["assets/renamed.png"]);
	await unlink(path.join(root, "assets", "renamed.png"));
	expect((await cache.read()).bytes.size).toBe(0);
	await writeFile(file(), "new");
	expect((await cache.read()).bytes.get("assets/a.png")).toEqual(
		new Uint8Array(Buffer.from("new")),
	);
});
it("invalidates one path or all paths after watcher failure", async () => {
	metadata.precision = "fine";
	await writeFile(path.join(root, "assets", "b.png"), "second");
	await cache.read();
	cache.invalidate(file());
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(3);
	cache.invalidate();
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(5);
});
it("evicts directory renames and protects cached bytes from caller mutation", async () => {
	metadata.precision = "fine";
	await mkdir(path.join(root, "assets", "nested"));
	await writeFile(path.join(root, "assets", "nested", "b.png"), "second");
	const first = await cache.read();
	first.bytes.get("assets/a.png")?.fill(0);
	cache.invalidate(path.join(root, "assets", "nested"));
	expect((await cache.read()).bytes.get("assets/a.png")).toEqual(
		new Uint8Array(Buffer.from("first")),
	);
	expect(reads).toHaveBeenCalledTimes(3);
});
it("refuses a cached path replaced by an escaping link", async () => {
	await cache.read();
	const outside = await mkdtemp(path.join(tmpdir(), "outside-asset-"));
	try {
		const target = path.join(outside, "a.png");
		await writeFile(target, "first");
		await unlink(file());
		await symlink(target, file());
		await expect(cache.read()).rejects.toThrow("Path traversal blocked");
	} finally {
		await rm(outside, { recursive: true, force: true });
	}
});

it("excludes project cache files from the admitted export inventory", async () => {
	await mkdir(path.join(root, ".praxity", "cache", "images"), { recursive: true });
	await writeFile(path.join(root, ".praxity", "cache", "images", "sentinel.image"), "cache-only");
	expect([...(await cache.read()).bytes.keys()]).toEqual(["assets/a.png"]);
});

it.each(["root", "child"])("refuses a %s asset alias into local editor data", async (alias) => {
	const local = path.join(root, ".praxity", "local");
	await mkdir(local, { recursive: true });
	await writeFile(path.join(local, "draft.json"), "private draft");
	const target =
		alias === "root" ? path.join(root, "assets") : path.join(root, "assets", "private");
	if (alias === "root") await rm(target, { recursive: true });
	await symlink(local, target, "junction");
	await expect(cache.read()).rejects.toMatchObject({ code: "asset-internal-refused" });
});

it("refuses cached assets after their directory becomes the canonical local store", async () => {
	metadata.precision = "fine";
	await cache.read();
	await mkdir(path.join(root, ".praxity"), { recursive: true });
	await symlink(path.join(root, "assets"), path.join(root, ".praxity", "local"), "junction");
	await expect(cache.read()).rejects.toMatchObject({ code: "asset-internal-refused" });
	expect(reads).toHaveBeenCalledTimes(1);
});

it("a watcher error during a read cannot repopulate the cache", async () => {
	reads.mockImplementationOnce(async (file) => {
		const bytes = await file.readFile();
		cache.invalidate();
		return bytes;
	});
	await cache.read();
	await cache.read();
	expect(reads).toHaveBeenCalledTimes(2);
});
it("retries when a file changes during the byte read", async () => {
	metadata.precision = "recent";
	vi.spyOn(Date, "now").mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 1);
	reads.mockImplementationOnce(async (handle) => {
		const bytes = await handle.readFile();
		await writeFile(file(), "other");
		return bytes;
	});
	expect((await cache.read()).bytes.get("assets/a.png")).toEqual(
		new Uint8Array(Buffer.from("other")),
	);
	expect(reads).toHaveBeenCalledTimes(2);
});

it.each(["seconds", "milliseconds", "unknown", "recent"] as const)(
	"retries a byte-read overwrite with unchanged %s stamps in a full batch",
	async (precision) => {
		metadata.precision = precision;
		if (precision === "recent")
			vi.spyOn(Date, "now").mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 1);
		for (let index = 0; index < 7; index++)
			await writeFile(path.join(root, "assets", `b${index}.png`), "batch");
		reads.mockImplementation(async (handle) => {
			const bytes = await handle.readFile();
			if (Buffer.from(bytes).toString() === "first") await writeFile(file(), "other");
			return bytes;
		});
		const admitted = await cache.read();
		expect(admitted.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("other")));
		expect(admitted.digests.get("assets/a.png")).toBe(
			createHash("sha256").update("other").digest("hex"),
		);
		expect(reads).toHaveBeenCalledTimes(9);
		expect(await cache.read()).toEqual(await new ProjectAssetInventory(root).read());
	},
);

it.each(["during the byte read", "after admission"])(
	"does not promote a recent snapshot to reusable when its timestamp ages %s",
	async (stage) => {
		metadata.precision = "recent";
		const clock = vi
			.spyOn(Date, "now")
			.mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 1);
		if (stage === "during the byte read")
			reads.mockImplementationOnce(async (handle) => {
				const value = await handle.readFile();
				clock.mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 10_000);
				metadata.filesystemNow = metadata.recentStamp + 10_000_000_000n;
				return value;
			});
		await cache.read();
		await writeFile(file(), "other");
		clock.mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 10_000);
		metadata.filesystemNow = metadata.recentStamp + 10_000_000_000n;
		const admitted = await cache.read();
		expect(admitted.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("other")));
		expect(admitted.digests.get("assets/a.png")).toBe(
			createHash("sha256").update("other").digest("hex"),
		);
		expect(reads).toHaveBeenCalledTimes(2);
	},
);

it.each(["path stat", "open", "opened fstat", "read", "final fstat", "target stat"] as const)(
	"keeps recent snapshots fresh after a write paused at %s",
	async (stage) => {
		metadata.precision = "recent";
		const clock = vi
			.spyOn(Date, "now")
			.mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 1);
		let changed = false;
		const overwrite = async () => {
			if (changed) return;
			changed = true;
			await writeFile(file(), "other");
		};
		metadata.afterStat = async (target, source) => {
			if (target !== file()) return;
			if (source === "path") {
				if (stage === "path stat" || (stage === "target stat" && reads.mock.calls.length > 0))
					await overwrite();
			} else {
				if (stage === "opened fstat" || (stage === "final fstat" && reads.mock.calls.length > 0))
					await overwrite();
			}
		};
		if (stage === "open") metadata.afterOpen = overwrite;
		if (stage === "read")
			reads.mockImplementationOnce(async (handle) => {
				const value = await handle.readFile();
				await overwrite();
				return value;
			});
		const admitted = await cache.read();
		expect(changed).toBe(true);
		// A write after byte verification overlaps an already valid snapshot.
		const content = stage === "final fstat" || stage === "target stat" ? "first" : "other";
		expect(admitted.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from(content)));
		expect(admitted.digests.get("assets/a.png")).toBe(
			createHash("sha256").update(content).digest("hex"),
		);
		const fresh = await new ProjectAssetInventory(root).read();
		expect(fresh.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("other")));
		clock.mockReturnValue(Number(metadata.recentStamp / 1_000_000n) + 10_000);
		metadata.filesystemNow = metadata.recentStamp + 10_000_000_000n;
		expect(await cache.read()).toEqual(fresh);
	},
);

it.each([
	{ kind: "empty", initial: "first", replacement: "" },
	{ kind: "same size", initial: "first", replacement: "short" },
	{ kind: "growth", initial: "first", replacement: "longer" },
	{ kind: "shrinkage", initial: "first", replacement: "one" },
	{
		kind: "later chunk",
		initial: "x".repeat(128 * 1024),
		replacement: `${"x".repeat(128 * 1024 - 1)}y`,
	},
])(
	"verifies the entire file and EOF after an overwrite with $kind",
	async ({ initial, replacement }) => {
		metadata.precision = "seconds";
		await writeFile(file(), initial);
		reads.mockImplementationOnce(async (handle) => {
			const value = await handle.readFile();
			await writeFile(file(), replacement);
			return value;
		});
		const admitted = await cache.read();
		expect(admitted.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from(replacement)));
		expect(admitted.digests.get("assets/a.png")).toBe(
			createHash("sha256").update(replacement).digest("hex"),
		);
		expect(reads).toHaveBeenCalledTimes(2);
	},
);

it("refuses and closes every handle when coarse bytes never stabilize", async () => {
	metadata.precision = "seconds";
	const handles: FileHandle[] = [];
	reads.mockImplementation(async (handle) => {
		handles.push(handle);
		const value = await handle.readFile();
		await writeFile(file(), Buffer.from(value).toString() === "first" ? "other" : "first");
		return value;
	});
	await expect(cache.read()).rejects.toThrow("Asset changed while reading: assets/a.png");
	expect(reads).toHaveBeenCalledTimes(3);
	for (const handle of handles) await expect(handle.stat()).rejects.toThrow();
	reads.mockImplementation((handle) => handle.readFile());
	expect((await cache.read()).bytes.get("assets/a.png")).toEqual(
		new Uint8Array(Buffer.from("other")),
	);
});

it("propagates positional verification errors and closes the admitted handle", async () => {
	metadata.precision = "seconds";
	const handles: FileHandle[] = [];
	reads.mockImplementationOnce(async (handle) => {
		handles.push(handle);
		vi.spyOn(handle, "read").mockRejectedValueOnce(new Error("Planted verification failure"));
		return handle.readFile();
	});
	await expect(cache.read()).rejects.toThrow("Planted verification failure");
	expect(handles).toHaveLength(1);
	for (const handle of handles) await expect(handle.stat()).rejects.toThrow();
	expect((await cache.read()).bytes.get("assets/a.png")).toEqual(
		new Uint8Array(Buffer.from("first")),
	);
	expect(reads).toHaveBeenCalledTimes(2);
});

it("does not cache bytes from a symlink retargeted and restored during reading", async () => {
	const firstTarget = path.join(root, "one");
	const otherTarget = path.join(root, "two");
	await writeFile(firstTarget, "first");
	await writeFile(otherTarget, "other");
	await unlink(file());
	await symlink(firstTarget, file());
	reads.mockImplementationOnce(async (handle) => {
		await unlink(file());
		await symlink(otherTarget, file());
		try {
			return await handle.readFile();
		} finally {
			await unlink(file());
			await symlink(firstTarget, file());
		}
	});
	await cache.read();
	const next = await cache.read();
	expect(next.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("first")));
	expect(next.digests.get("assets/a.png")).toBe(createHash("sha256").update("first").digest("hex"));
});

it.each(["seconds", "milliseconds", "unknown"] as const)(
	"rereads same-size overwrites with %s timestamp precision",
	async (precision) => {
		metadata.precision = precision;
		await cache.read();
		await writeFile(file(), "other");
		const next = await cache.read();
		expect(next.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("other")));
		expect(next.digests.get("assets/a.png")).toBe(
			createHash("sha256").update("other").digest("hex"),
		);
		expect(reads).toHaveBeenCalledTimes(2);
	},
);

it("rereads when file identity is unknown", async () => {
	metadata.unknownIdentity = true;
	await cache.read();
	const next = await cache.read();
	expect(next.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("first")));
	expect(reads).toHaveBeenCalledTimes(2);
});

it("rereads a retargeted symlink when only its target inode changes", async () => {
	metadata.precision = "fine";
	const firstTarget = path.join(root, "one");
	const otherTarget = path.join(root, "two");
	await writeFile(firstTarget, "first");
	await writeFile(otherTarget, "other");
	await unlink(file());
	await symlink(firstTarget, file());
	await cache.read();
	await unlink(file());
	await symlink(otherTarget, file());
	const next = await cache.read();
	expect(next.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("other")));
	expect(next.digests.get("assets/a.png")).toBe(createHash("sha256").update("other").digest("hex"));
	expect(reads).toHaveBeenCalledTimes(2);
});

it("retries a file replaced before opening and restored after the handle read", async () => {
	metadata.precision = "fine";
	const saved = path.join(root, "saved");
	const replacement = path.join(root, "replacement");
	await writeFile(replacement, "other");
	const openWithMetadata = vi.mocked(open).getMockImplementation();
	if (!openWithMetadata) throw new Error("Missing filesystem adapter");
	vi.mocked(open).mockImplementationOnce(async (...args) => {
		await rename(file(), saved);
		await rename(replacement, file());
		return openWithMetadata(...args);
	});
	reads.mockImplementationOnce(async (handle) => {
		const bytes = await handle.readFile();
		await rename(file(), replacement);
		await rename(saved, file());
		return bytes;
	});
	const next = await cache.read();
	expect(next.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("first")));
	expect(next.digests.get("assets/a.png")).toBe(createHash("sha256").update("first").digest("hex"));
	expect(reads).toHaveBeenCalledTimes(2);
});

it("bypasses coarse timestamps per file while retaining precise files", async () => {
	metadata.precision = "seconds";
	metadata.precisionPath = file();
	await writeFile(path.join(root, "assets", "b.png"), "precise");
	await cache.read();
	await writeFile(file(), "other");
	const next = await cache.read();
	expect(next.bytes.get("assets/a.png")).toEqual(new Uint8Array(Buffer.from("other")));
	expect(next.bytes.get("assets/b.png")).toEqual(new Uint8Array(Buffer.from("precise")));
	expect(reads).toHaveBeenCalledTimes(3);
});

it("bounds parallel admission across nested directories and publishes in traversal order", async () => {
	await mkdir(path.join(root, "assets", "nested"));
	for (let index = 0; index < 16; index++) {
		await writeFile(
			path.join(root, "assets", `b${index.toString().padStart(2, "0")}.png`),
			"bytes",
		);
		await writeFile(path.join(root, "assets", "nested", `${index}.png`), "nested");
	}
	const fresh = await new ProjectAssetInventory(root).read();
	let active = 0;
	let peak = 0;
	let releaseBatch: (() => void) | undefined;
	const batchReady = new Promise<void>((resolve) => {
		releaseBatch = resolve;
	});
	reads.mockImplementation(async (handle) => {
		active++;
		peak = Math.max(peak, active);
		if (active === 8) releaseBatch?.();
		try {
			await batchReady;
			return await handle.readFile();
		} finally {
			active--;
		}
	});
	const admitted = await cache.read();
	expect(peak).toBe(8);
	expect([...admitted.bytes]).toEqual([...fresh.bytes]);
	expect([...admitted.digests]).toEqual([...fresh.digests]);
});

it("retries a concurrent batch change and agrees with fresh admission", async () => {
	await writeFile(path.join(root, "assets", "b.png"), "second");
	let active = 0;
	let peak = 0;
	let mutation: Promise<void> | undefined;
	let releaseBatch: (() => void) | undefined;
	const batchReady = new Promise<void>((resolve) => {
		releaseBatch = resolve;
	});
	reads.mockImplementation(async (handle) => {
		active++;
		peak = Math.max(peak, active);
		if (active === 2) releaseBatch?.();
		try {
			await batchReady;
			const value = await handle.readFile();
			// Every worker returns after the planted write, so verification must see it.
			mutation ??= writeFile(file(), "other").then(() => cache.invalidate());
			await mutation;
			return value;
		} finally {
			active--;
		}
	});
	const admitted = await cache.read();
	const fresh = await new ProjectAssetInventory(root).read();
	expect(peak).toBe(2);
	expect(admitted).toEqual(fresh);
	expect(await cache.read()).toEqual(fresh);
});

it("settles the whole batch before refusing and invalidates every retained entry", async () => {
	await writeFile(path.join(root, "assets", "b.png"), "second");
	await cache.read();
	cache.invalidate();
	let active = 0;
	reads.mockImplementation(async (handle) => {
		active++;
		try {
			const value = await handle.readFile();
			if (Buffer.from(value).toString() === "first") throw new Error("Planted read failure");
			await new Promise((resolve) => setTimeout(resolve, 20));
			return value;
		} finally {
			active--;
		}
	});
	await expect(cache.read()).rejects.toThrow("Planted read failure");
	expect(active).toBe(0);
	reads.mockImplementation((handle) => handle.readFile());
	expect(await cache.read()).toEqual(await new ProjectAssetInventory(root).read());
});
