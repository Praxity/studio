import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	type FileHandle,
	lstat,
	mkdir,
	open,
	readdir,
	rename,
	unlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
	IMAGE_ENCODER_OPTIONS,
	IMAGE_ENCODER_VERSION,
	type ImageEncoderOptions,
	optimizeImage,
} from "./optimize-image.ts";

const HEADER_BYTES = 130;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 1024;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Strict preview readers keep derived files outside the admitted project. */
export function imageCacheDirectory(): string {
	const local = process.env.LOCALAPPDATA;
	const xdg = process.env.XDG_CACHE_HOME;
	const base =
		process.platform === "win32"
			? local && path.isAbsolute(local)
				? local
				: path.join(homedir(), "AppData", "Local")
			: process.platform === "darwin"
				? path.join(homedir(), "Library", "Caches")
				: xdg && path.isAbsolute(xdg)
					? xdg
					: path.join(homedir(), ".cache");
	return path.join(base, "Praxity", "images");
}
export interface ImageResultCacheOptions {
	directory: string;
	encoder?: typeof optimizeImage;
	encoderVersion?: string;
	encoderOptions?: ImageEncoderOptions;
	maxBytes?: number;
	maxEntries?: number;
	onError?: (error: unknown) => void;
}

/** Content-addressed derivatives. The single-file envelope binds key and output digest. */
export class ImageResultCache {
	private readonly encoder: typeof optimizeImage;
	private readonly encoderOptions: ImageEncoderOptions;
	private readonly version: string;
	private readonly maxBytes: number;
	private readonly maxEntries: number;
	private pending = Promise.resolve();
	private initialized?: Promise<void>;
	constructor(private readonly options: ImageResultCacheOptions) {
		this.encoder = options.encoder ?? optimizeImage;
		this.encoderOptions = { ...(options.encoderOptions ?? IMAGE_ENCODER_OPTIONS) };
		this.version = options.encoderVersion ?? IMAGE_ENCODER_VERSION;
		this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
		this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
		if (
			!Number.isSafeInteger(this.maxBytes) ||
			this.maxBytes < 0 ||
			!Number.isSafeInteger(this.maxEntries) ||
			this.maxEntries < 0
		)
			throw new Error("Invalid image cache limits");
	}
	async optimize(bytes: Uint8Array, codecDir?: string): Promise<Uint8Array | undefined> {
		// Apply today's limits to a cache left by an older process, even on a hit.
		this.initialized ??= this.evict().catch((error) => {
			if (!missing(error)) this.report(error);
		});
		await this.initialized;
		const key = hash(
			JSON.stringify([
				hash(bytes),
				this.version,
				this.encoderOptions.maxDimension,
				this.encoderOptions.quality,
			]),
		);
		const file = path.join(this.options.directory, `${key}.image`);
		const hit = await this.read(file, key, bytes.length).catch((error) => {
			this.report(error);
			return undefined;
		});
		if (hit) {
			const now = new Date();
			await utimes(file, now, now).catch((error) => {
				if (!missing(error)) this.report(error);
			});
			return hit;
		}
		const result = await this.encoder(bytes, codecDir, this.encoderOptions);
		// Undefined can mean a transient codec failure. Never persist that as a negative hit.
		if (
			!result ||
			result.length >= bytes.length ||
			result.length + HEADER_BYTES > this.maxBytes ||
			this.maxEntries === 0
		)
			return result;
		const record = Buffer.concat([Buffer.from(`${key}\n${hash(result)}\n`), result]);
		const install = this.pending.then(async () => {
			await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
			const temp = path.join(this.options.directory, `${key}.${randomUUID()}.tmp`);
			try {
				await writeFile(temp, record, { flag: "wx", mode: 0o600 });
				try {
					await rename(temp, file);
				} catch (error) {
					// Windows refuses replacement while another writer has this entry open.
					// A complete matching winner already satisfies this installation.
					if (
						!["EPERM", "EACCES", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "") ||
						!(await this.read(file, key, bytes.length))
					)
						throw error;
				}
				await this.evict();
			} finally {
				await unlink(temp).catch((error) => {
					if (!missing(error)) throw error;
				});
			}
		});
		// Cache failures are reported, but never discard a successful derivative.
		this.pending = install.then(
			() => undefined,
			() => undefined,
		);
		await install.catch((error) => this.report(error));
		return Uint8Array.from(result);
	}
	private report(error: unknown): void {
		if (this.options.onError) this.options.onError(error);
		else console.warn("[image-cache] Cache unavailable; using encoded bytes:", error);
	}
	private async read(
		file: string,
		key: string,
		sourceLength: number,
	): Promise<Uint8Array | undefined> {
		let handle: FileHandle | undefined;
		try {
			handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
			const info = await handle.stat();
			if (
				!info.isFile() ||
				info.size <= HEADER_BYTES ||
				info.size > this.maxBytes ||
				info.size >= sourceLength + HEADER_BYTES
			)
				return;
			const record = await handle.readFile();
			if (record.subarray(0, 65).toString() !== `${key}\n`) return;
			const bytes = record.subarray(HEADER_BYTES);
			if (record.subarray(65, HEADER_BYTES).toString() !== `${hash(bytes)}\n`) return;
			return Uint8Array.from(bytes);
		} catch (error) {
			if (!missing(error) && (error as NodeJS.ErrnoException).code !== "ELOOP") throw error;
		} finally {
			await handle?.close();
		}
	}
	private async evict(): Promise<void> {
		const entries = [];
		for (const name of await readdir(this.options.directory)) {
			// Count abandoned atomic-write stages too. Evicting a competing stage
			// only loses cache work; its caller still receives the encoded result.
			if (!/^[a-f0-9]{64}(?:\.image|\.[a-f0-9-]{36}\.tmp)$/.test(name)) continue;
			const file = path.join(this.options.directory, name);
			try {
				const info = await lstat(file);
				entries.push({ file, size: info.size, mtime: info.mtimeMs });
			} catch (error) {
				if (!missing(error)) throw error;
			}
		}
		entries.sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file));
		let total = entries.reduce((sum, entry) => sum + entry.size, 0),
			count = entries.length;
		for (const entry of entries) {
			if (total <= this.maxBytes && count <= this.maxEntries) break;
			await unlink(entry.file).catch((error) => {
				if (!missing(error)) throw error;
			});
			total -= entry.size;
			count--;
		}
	}
}
export const defaultImageResultCache = new ImageResultCache({ directory: imageCacheDirectory() });
