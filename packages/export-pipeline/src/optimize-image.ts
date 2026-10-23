import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jpegDecode, { init as initJpeg } from "@jsquash/jpeg/decode.js";
import pngDecode, { init as initPng } from "@jsquash/png/decode.js";
import webpEncode, { init as initWebp } from "@jsquash/webp/encode.js";
import Pica from "pica";

export const IMAGE_CODEC_ASSETS = [
	"@jsquash/png/codec/pkg/squoosh_png_bg.wasm",
	"@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm",
	"@jsquash/webp/codec/enc/webp_enc_simd.wasm",
	"@jsquash/webp/codec/enc/webp_enc.wasm",
] as const;

const MAX_PIXELS = 25_000_000;
const MAX_BYTES = 50_000_000;
export const IMAGE_ENCODER_VERSION = "pipeline-1;jpeg-1.6.0;png-3.1.1;webp-1.5.0;pica-9.0.1";
// Bump the pipeline generation for changes to decoding, eligibility or resizing.
export const IMAGE_ENCODER_OPTIONS = { maxDimension: 1920, quality: 82 } as const;
export interface ImageEncoderOptions {
	maxDimension: number;
	quality: number;
}

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_SOF = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

type Source = { format: "png" | "jpeg"; width: number; height: number };

function pngSource(bytes: Uint8Array): Source | undefined {
	if (bytes.length < 45 || !Buffer.from(bytes.subarray(0, 8)).equals(PNG_MAGIC)) return;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(8) !== 13 || Buffer.from(bytes.subarray(12, 16)).toString() !== "IHDR") return;
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	for (let offset = 8; offset + 12 <= bytes.length; ) {
		const length = view.getUint32(offset);
		if (length > bytes.length - offset - 12) return;
		const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString();
		// Keep animation and color/orientation metadata the WebP encoder drops.
		if (["acTL", "iCCP", "eXIf", "gAMA", "cHRM"].includes(type)) return;
		if (type === "IEND") return { format: "png", width, height };
		offset += length + 12;
	}
}

function jpegSource(bytes: Uint8Array): Source | undefined {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let source: Source | undefined;
	for (let offset = 2; offset + 4 <= bytes.length; ) {
		if (bytes[offset++] !== 0xff) return;
		while (bytes[offset] === 0xff) offset++;
		const marker = bytes[offset++];
		if (marker === 0xda) return source;
		if (marker === 0xd9 || offset + 2 > bytes.length) return;
		const length = view.getUint16(offset);
		if (length < 2 || length > bytes.length - offset) return;
		if (
			marker === 0xe2 &&
			Buffer.from(bytes.subarray(offset + 2, offset + 14)).toString() === "ICC_PROFILE\0"
		)
			return;
		if (JPEG_SOF.has(marker)) {
			if (length < 8 || bytes[offset + 7] > 3) return;
			source = {
				format: "jpeg",
				width: view.getUint16(offset + 5),
				height: view.getUint16(offset + 3),
			};
		}
		offset += length;
	}
}

function codecPath(specifier: string, codecDir?: string): string {
	return codecDir
		? path.join(codecDir, path.basename(specifier))
		: fileURLToPath(import.meta.resolve(specifier));
}

async function wasm(specifier: string, codecDir?: string): Promise<WebAssembly.Module> {
	return WebAssembly.compile(await readFile(codecPath(specifier, codecDir)));
}

let pngReady: Promise<unknown> | undefined;
let jpegReady: Promise<void> | undefined;
let webpReady: Promise<unknown> | undefined;

async function decode(bytes: Uint8Array, source: Source, codecDir?: string): Promise<ImageData> {
	if (source.format === "png") {
		pngReady ??= wasm(IMAGE_CODEC_ASSETS[0], codecDir)
			.then(initPng)
			.catch((error: unknown) => {
				pngReady = undefined;
				throw error;
			});
		await pngReady;
		return pngDecode(Uint8Array.from(bytes).buffer);
	}
	jpegReady ??= wasm(IMAGE_CODEC_ASSETS[1], codecDir)
		.then(async (module) => {
			initJpeg(module);
		})
		.catch((error: unknown) => {
			jpegReady = undefined;
			throw error;
		});
	await jpegReady;
	return jpegDecode(Uint8Array.from(bytes).buffer, { preserveOrientation: true });
}

async function encode(
	image: ImageData,
	codecDir: string | undefined,
	options: ImageEncoderOptions,
): Promise<Uint8Array> {
	if (!webpReady) {
		webpReady = (async () => {
			let module: WebAssembly.Module;
			try {
				module = await wasm(IMAGE_CODEC_ASSETS[2], codecDir);
			} catch {
				module = await wasm(IMAGE_CODEC_ASSETS[3], codecDir);
			}
			return initWebp(module);
		})().catch((error: unknown) => {
			webpReady = undefined;
			throw error;
		});
	}
	await webpReady;
	return new Uint8Array(await webpEncode(image, { quality: options.quality }));
}

/** Return a smaller WebP derivative, or leave the source asset untouched. */
export async function optimizeImage(
	bytes: Uint8Array,
	codecDir?: string,
	options: ImageEncoderOptions = IMAGE_ENCODER_OPTIONS,
): Promise<Uint8Array | undefined> {
	if (bytes.length > MAX_BYTES) return;
	const source = pngSource(bytes) ?? jpegSource(bytes);
	if (!source?.width || !source.height || source.width * source.height > MAX_PIXELS) return;
	try {
		if (typeof ImageData === "undefined") {
			Object.defineProperty(globalThis, "ImageData", {
				value: class ImageData {
					constructor(
						public data: Uint8ClampedArray,
						public width: number,
						public height: number,
					) {}
				},
			});
		}
		let image = await decode(bytes, source, codecDir);
		if (image.width * image.height > MAX_PIXELS) return;
		if (source.format === "png") {
			for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 255) return;
		}
		const longest = Math.max(image.width, image.height);
		if (longest > options.maxDimension) {
			const width = Math.max(1, Math.round((image.width * options.maxDimension) / longest));
			const height = Math.max(1, Math.round((image.height * options.maxDimension) / longest));
			const data = await new Pica({ features: ["js"] }).resizeBuffer({
				src: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
				width: image.width,
				height: image.height,
				toWidth: width,
				toHeight: height,
			});
			image = new ImageData(new Uint8ClampedArray(data), width, height);
		}
		const result = await encode(image, codecDir, options);
		return result.length < bytes.length ? result : undefined;
	} catch {
		return;
	}
}
