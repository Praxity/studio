import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { optimizeImage } from "../optimize-image";
import { readImageDimensions } from "../published-images";

const opaquePng = new URL("../../../../apps/desktop/resources/icon.png", import.meta.url);
const widePng = new URL("./fixtures/opaque-wide.png", import.meta.url);
const orientedJpeg = new URL("./fixtures/oriented-jpeg.jpg", import.meta.url);
const transparentPng = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR4nGP8zwABTFCaAQARJQED72uL6QAAAABJRU5ErkJggg==",
	"base64",
);

function withPngChunk(png: Buffer, type: string, data: Buffer): Buffer {
	const chunk = Buffer.alloc(12 + data.length);
	chunk.writeUInt32BE(data.length);
	chunk.write(type, 4, "ascii");
	data.copy(chunk, 8);
	let crc = 0xffffffff;
	for (const byte of chunk.subarray(4, 8 + data.length)) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
	}
	chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
	return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

describe("offline image optimization", () => {
	it("returns a smaller WebP derivative without changing the source", async () => {
		const source = await readFile(opaquePng);
		const original = Buffer.from(source);
		expect(await optimizeImage(source, "/missing-image-codecs")).toBeUndefined();
		const result = await optimizeImage(source);
		expect(result?.byteLength).toBeLessThan(source.byteLength);
		expect(Buffer.from(result?.subarray(0, 4) ?? []).toString()).toBe("RIFF");
		expect(Buffer.from(result?.subarray(8, 12) ?? []).toString()).toBe("WEBP");
		expect(source).toEqual(original);
	});

	it("keeps transparent, corrupt, and animated PNGs untouched", async () => {
		expect(await optimizeImage(transparentPng)).toBeUndefined();
		expect(await optimizeImage(Buffer.from("not an image"))).toBeUndefined();
		const animated = await readFile(opaquePng);
		animated.set(Buffer.from("acTL"), 37);
		expect(await optimizeImage(animated)).toBeUndefined();
	});

	it("keeps PNG gamma and chromaticity metadata that WebP encoding would drop", async () => {
		const source = await readFile(opaquePng);
		for (const gamma of [100_000, 45_455]) {
			const data = Buffer.alloc(4);
			data.writeUInt32BE(gamma);
			expect(await optimizeImage(withPngChunk(source, "gAMA", data))).toBeUndefined();
		}
		const chromaticity = Buffer.alloc(32);
		[31_270, 32_900, 64_000, 33_000, 30_000, 60_000, 15_000, 6_000].forEach((value, i) =>
			chromaticity.writeUInt32BE(value, i * 4),
		);
		expect(await optimizeImage(withPngChunk(source, "cHRM", chromaticity))).toBeUndefined();
	});

	it("applies the encoder options used in cache keys", async () => {
		const source = await readFile(widePng);
		const result = await optimizeImage(source, undefined, { maxDimension: 960, quality: 82 });
		expect(result && readImageDimensions(result)).toEqual({ width: 960, height: 5 });
	});

	it("caps oversized images and applies JPEG EXIF orientation before WebP encoding", async () => {
		const wide = await optimizeImage(await readFile(widePng));
		expect(wide && readImageDimensions(wide)).toEqual({ width: 1920, height: 9 });
		const jpeg = await optimizeImage(await readFile(orientedJpeg));
		expect(jpeg && readImageDimensions(jpeg)).toEqual({ width: 80, height: 120 });
	});
});
