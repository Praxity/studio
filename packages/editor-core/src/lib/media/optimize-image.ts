"use client";

import Pica from "pica";
import { analyzeFromCanvas } from "./image-analysis";

const MAX_DIMENSION = 1920;
const WEBP_QUALITY = 0.82;
const JPEG_QUALITY = 0.85;

export const OPTIMIZABLE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function shouldOptimize(mimeType: string): boolean {
	return OPTIMIZABLE_MIME_TYPES.has(mimeType);
}

export function replaceExtension(filename: string, newExt: string): string {
	const dotIndex = filename.lastIndexOf(".");
	const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
	return `${base}.${newExt}`;
}

export interface OptimizedResult {
	blob: Blob;
	mimeType: string;
	filename: string;
	perceptualMetadata?: import("@praxity/grammar").ImagePerceptualMetadata;
}

export async function optimizeImage(file: File): Promise<OptimizedResult> {
	const pica = new Pica();

	const bitmap = await createImageBitmap(file);
	const { width, height } = bitmap;

	let targetWidth = width;
	let targetHeight = height;

	if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
		const scale = MAX_DIMENSION / Math.max(width, height);
		targetWidth = Math.round(width * scale);
		targetHeight = Math.round(height * scale);
	}

	const srcCanvas = document.createElement("canvas");
	srcCanvas.width = width;
	srcCanvas.height = height;
	const ctx = srcCanvas.getContext("2d");
	if (!ctx) throw new Error("Failed to get canvas context");
	ctx.drawImage(bitmap, 0, 0);

	const perceptualMetadata = analyzeFromCanvas(srcCanvas, width, height);
	bitmap.close();

	const dstCanvas = document.createElement("canvas");
	dstCanvas.width = targetWidth;
	dstCanvas.height = targetHeight;
	await pica.resize(srcCanvas, dstCanvas);

	let blob: Blob;
	let mimeType: string;
	let ext: string;

	try {
		blob = await pica.toBlob(dstCanvas, "image/webp", WEBP_QUALITY);
		if (blob.size === 0) throw new Error("Empty WebP blob");
		mimeType = "image/webp";
		ext = "webp";
	} catch {
		blob = await pica.toBlob(dstCanvas, "image/jpeg", JPEG_QUALITY);
		mimeType = "image/jpeg";
		ext = "jpeg";
	}

	return {
		blob,
		mimeType,
		filename: replaceExtension(file.name, ext),
		perceptualMetadata,
	};
}
