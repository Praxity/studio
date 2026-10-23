import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, type Mock, vi } from "vitest";
import { ImageResultCache, imageCacheDirectory } from "../image-result-cache.ts";
import { IMAGE_ENCODER_VERSION, type optimizeImage } from "../optimize-image.ts";

let directory: string;
const source = Uint8Array.of(1, 2, 3, 4, 5, 6);
const encoded = Uint8Array.of(9, 8, 7);
let encoder: Mock<typeof optimizeImage>;
beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), "image-cache-"));
	encoder = vi.fn<typeof optimizeImage>(async () => encoded);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(directory, { recursive: true, force: true });
});
const cache = (options = {}) => new ImageResultCache({ directory, encoder, ...options });
it("a persistent hit skips encoding and returns identical bytes", async () => {
	const first = await cache().optimize(source);
	const second = await cache().optimize(source);
	expect(second).toEqual(first);
	expect(second).toEqual(encoded);
	expect(encoder).toHaveBeenCalledTimes(1);
});
it("source bytes, encoder options and version each change the key", async () => {
	await cache().optimize(source);
	await cache().optimize(Uint8Array.of(2, 2, 3, 4, 5, 6));
	await cache({ encoderOptions: { quality: 83, maxDimension: 1920 } }).optimize(source);
	await cache({ encoderVersion: "next" }).optimize(source);
	await cache({ encoderOptions: { quality: 82, maxDimension: 960 } }).optimize(source);
	expect(encoder).toHaveBeenCalledTimes(5);
	await cache().optimize(source);
	expect(encoder).toHaveBeenCalledTimes(5);
});
it("corrupt or truncated entries are misses", async () => {
	await cache().optimize(source);
	const [name] = await readdir(directory);
	expect(name).toMatch(/^[a-f0-9]{64}\.image$/);
	const file = path.join(directory, name);
	const bytes = await readFile(file);
	bytes[bytes.length - 1] ^= 1;
	await writeFile(file, bytes);
	expect(await cache().optimize(source)).toEqual(encoded);
	await writeFile(file, "truncated");
	expect(await cache().optimize(source)).toEqual(encoded);
	expect(encoder).toHaveBeenCalledTimes(3);
});
it("bounds persisted entries with eviction and leaves no partial files", async () => {
	const bounded = cache({ maxEntries: 1, maxBytes: 1024 });
	await bounded.optimize(source);
	await bounded.optimize(Uint8Array.of(2, 2, 3, 4, 5, 6));
	expect(await readdir(directory)).toHaveLength(1);
	await bounded.optimize(source);
	expect(encoder).toHaveBeenCalledTimes(3);
	expect(await readdir(directory)).toHaveLength(1);
});
it("does not store oversized entries or failed encodes", async () => {
	await cache({ maxBytes: 1 }).optimize(source);
	expect(await readdir(directory)).toHaveLength(0);
	encoder.mockResolvedValue(undefined);
	await cache().optimize(source);
	expect(await readdir(directory)).toHaveLength(0);
	encoder.mockRejectedValue(new Error("encoder failed"));
	await expect(cache().optimize(source)).rejects.toThrow("encoder failed");
});
it("concurrent cache instances install complete identical entries", async () => {
	const outputs = await Promise.all(Array.from({ length: 5 }, () => cache().optimize(source)));
	expect(outputs).toEqual(Array.from({ length: 5 }, () => encoded));
	expect(await readdir(directory)).toHaveLength(1);
	expect(await cache().optimize(source)).toEqual(encoded);
});
it("the version binds the pinned codecs and resize dependency", async () => {
	const { dependencies } = JSON.parse(
		await readFile(new URL("../../package.json", import.meta.url), "utf8"),
	);
	for (const [name, label] of [
		["@jsquash/jpeg", "jpeg"],
		["@jsquash/png", "png"],
		["@jsquash/webp", "webp"],
		["pica", "pica"],
	])
		expect(IMAGE_ENCODER_VERSION).toContain(`${label}-${dependencies[name]}`);
});

it("cache I/O failure reports the error and keeps fresh encoded bytes", async () => {
	const file = path.join(directory, "not-a-directory");
	await writeFile(file, "file");
	const onError = vi.fn();
	const result = await new ImageResultCache({ directory: file, encoder, onError }).optimize(source);
	expect(result).toEqual(encoded);
	expect(encoder).toHaveBeenCalledTimes(1);
	expect(onError).toHaveBeenCalled();
});

it("the byte bound evicts entries even below the entry count limit", async () => {
	const bounded = cache({ maxBytes: 200, maxEntries: 10 });
	await bounded.optimize(source);
	await bounded.optimize(Uint8Array.of(2, 2, 3, 4, 5, 6));
	expect(await readdir(directory)).toHaveLength(1);
	await bounded.optimize(source);
	expect(encoder).toHaveBeenCalledTimes(3);
});

it("evicts abandoned atomic-write stages within the byte bound", async () => {
	const stage = path.join(directory, `${"a".repeat(64)}.00000000-0000-0000-0000-000000000000.tmp`);
	await writeFile(stage, Buffer.alloc(300));
	await cache({ maxBytes: 200 }).optimize(source);
	expect(await readdir(directory)).toHaveLength(1);
	expect((await readdir(directory))[0]).toMatch(/\.image$/);
});

it("applies a smaller limit to existing entries before serving a hit", async () => {
	await cache().optimize(source);
	await cache().optimize(Uint8Array.of(2, 2, 3, 4, 5, 6));
	await cache({ maxEntries: 1 }).optimize(Uint8Array.of(2, 2, 3, 4, 5, 6));
	expect(await readdir(directory)).toHaveLength(1);
});

it("uses an absolute OS cache fallback for empty or relative overrides", () => {
	for (const value of ["", "relative-cache"]) {
		vi.stubEnv("LOCALAPPDATA", value);
		vi.stubEnv("XDG_CACHE_HOME", value);
		expect(path.isAbsolute(imageCacheDirectory())).toBe(true);
	}
});
