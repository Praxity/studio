import { readFile } from "node:fs/promises";
import path from "node:path";
import { isInlineProjectionMetadataKey } from "@praxity/shared-blocks/inline-markdown";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";

export interface ImageDimensions {
	width: number;
	height: number;
}

function bufferView(bytes: Uint8Array): Buffer {
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Read dimensions from common Studio image formats without decoding the image. */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
	const data = bufferView(bytes);
	const svgTag = data.toString("utf8", 0, Math.min(data.length, 4096)).match(/<svg\b[^>]*>/i)?.[0];
	if (svgTag) {
		const attribute = (name: string) =>
			Number(
				svgTag.match(
					new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9]+(?:\\.[0-9]+)?)(?:px)?\\s*["']`, "i"),
				)?.[1],
			);
		const width = attribute("width");
		const height = attribute("height");
		if (width > 0 && height > 0) return { width: Math.round(width), height: Math.round(height) };
		const viewBox = svgTag.match(/\bviewBox\s*=\s*["']\s*([^"']+)/i)?.[1];
		const values = viewBox
			?.trim()
			.split(/[\s,]+/)
			.map(Number);
		if (values?.length === 4 && values[2] > 0 && values[3] > 0) {
			return { width: Math.round(values[2]), height: Math.round(values[3]) };
		}
	}
	if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
		return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
	}
	if (data.length >= 10 && ["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6))) {
		return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
	}
	if (
		data.length >= 30 &&
		data.toString("ascii", 0, 4) === "RIFF" &&
		data.toString("ascii", 8, 12) === "WEBP"
	) {
		const kind = data.toString("ascii", 12, 16);
		if (kind === "VP8X") {
			return {
				width: 1 + data.readUIntLE(24, 3),
				height: 1 + data.readUIntLE(27, 3),
			};
		}
		if (kind === "VP8 " && data.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
			return {
				width: data.readUInt16LE(26) & 0x3fff,
				height: data.readUInt16LE(28) & 0x3fff,
			};
		}
		if (kind === "VP8L" && data[20] === 0x2f) {
			return {
				width: 1 + data[21] + ((data[22] & 0x3f) << 8),
				height: 1 + (data[22] >> 6) + (data[23] << 2) + ((data[24] & 0x0f) << 10),
			};
		}
	}
	if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
		let offset = 2;
		while (offset + 8 < data.length) {
			if (data[offset++] !== 0xff) continue;
			while (data[offset] === 0xff) offset += 1;
			const marker = data[offset++];
			if (
				marker === undefined ||
				marker === 0xd8 ||
				marker === 0xd9 ||
				(marker >= 0xd0 && marker <= 0xd7)
			)
				continue;
			if (offset + 2 > data.length) break;
			const length = data.readUInt16BE(offset);
			if (length < 2 || offset + length > data.length) break;
			if (
				[0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
					marker,
				)
			) {
				return { width: data.readUInt16BE(offset + 5), height: data.readUInt16BE(offset + 3) };
			}
			offset += length;
		}
	}
	return null;
}

function localAssetPath(src: string, assetsDir: string): string | null {
	const normalized = src.replace(/^\.\//, "").replace(/^\//, "").split(/[?#]/, 1)[0];
	if (!normalized.startsWith("assets/")) return null;
	let relativePath: string;
	try {
		relativePath = decodeURIComponent(normalized.slice("assets/".length));
	} catch {
		return null;
	}
	const filePath = path.resolve(assetsDir, relativePath);
	const relative = path.relative(assetsDir, filePath);
	return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? filePath : null;
}

function isBlock(value: Record<string, unknown>): value is Record<string, unknown> & PraxityBlock {
	return (
		typeof value.id === "string" &&
		typeof value.type === "string" &&
		value.data !== null &&
		typeof value.data === "object"
	);
}

/** Reserve image space and prioritize the first image in each published document. */
export async function preparePublishedImages(
	pages: PraxityPage[],
	assetsDir: string,
	moduleDeck = false,
): Promise<PraxityPage[]> {
	const dimensions = new Map<string, Promise<ImageDimensions | null>>();
	const dimensionsFor = (src: string): Promise<ImageDimensions | null> => {
		const cached = dimensions.get(src);
		if (cached) return cached;
		const filePath = localAssetPath(src, assetsDir);
		const pending = filePath
			? readFile(filePath)
					.then(readImageDimensions)
					.catch(() => null)
			: Promise.resolve(null);
		dimensions.set(src, pending);
		return pending;
	};

	const visit = async (
		value: unknown,
		pageState: { hasPriorityImage: boolean },
	): Promise<unknown> => {
		if (Array.isArray(value)) return Promise.all(value.map((item) => visit(item, pageState)));
		if (value === null || typeof value !== "object") return value;
		const record = value as Record<string, unknown>;
		if (isBlock(record)) {
			if (record.type === "imageComparison") {
				const rawData = record.data as Record<string, unknown>;
				const imageMetadata = ["beforeImage", "afterImage"].map((key) => {
					const image = rawData[key] as Record<string, unknown> | undefined;
					const src = typeof image?.src === "string" ? image.src : "";
					const priority = Boolean(src) && !pageState.hasPriorityImage && image?.loading !== "lazy";
					if (src) pageState.hasPriorityImage = true;
					return { key, src, priority };
				});
				const data = (await visit(record.data, pageState)) as Record<string, unknown>;
				for (const { key, src, priority } of imageMetadata) {
					if (!src) continue;
					const image = data[key] as Record<string, unknown>;
					const imageDimensions = await dimensionsFor(src);
					data[key] = {
						...image,
						...(imageDimensions
							? {
									intrinsicWidth: imageDimensions.width,
									intrinsicHeight: imageDimensions.height,
								}
							: {}),
						loading: image.loading ?? (priority ? "eager" : "lazy"),
						...(priority ? { fetchPriority: "high" } : {}),
					};
				}
				return { ...record, data };
			}
			const imageSourceKey =
				record.type === "image"
					? "src"
					: record.type === "heroCover" || record.type === "labeledGraphic"
						? "imageSrc"
						: null;
			const rawData = record.data as Record<string, unknown>;
			const src =
				imageSourceKey && typeof rawData[imageSourceKey] === "string"
					? rawData[imageSourceKey]
					: "";
			const priority = Boolean(src) && !pageState.hasPriorityImage && rawData.loading !== "lazy";
			if (src) pageState.hasPriorityImage = true;
			const data = (await visit(record.data, pageState)) as Record<string, unknown>;
			if (!imageSourceKey) return { ...record, data };
			// ponytail: first-image priority is the fold heuristic; replace it with authored
			// viewport metadata if Studio ever supports per-device page composition.
			const imageDimensions = src ? await dimensionsFor(src) : null;
			return {
				...record,
				data: {
					...data,
					...(imageDimensions
						? {
								intrinsicWidth: imageDimensions.width,
								intrinsicHeight: imageDimensions.height,
							}
						: {}),
					loading: data.loading ?? (priority ? "eager" : "lazy"),
					...(priority ? { fetchPriority: "high" } : {}),
				},
			};
		}
		return Object.fromEntries(
			await Promise.all(
				Object.entries(record).map(async ([key, item]) => [
					key,
					isInlineProjectionMetadataKey(key, { keepDisplay: true })
						? item
						: await visit(item, pageState),
				]),
			),
		);
	};

	return Promise.all(
		pages.map(async (page, index) => ({
			...page,
			blocks: (await visit(page.blocks, {
				hasPriorityImage:
					moduleDeck &&
					index > 0 &&
					(page.lessonId ?? page.id) === (pages[index - 1].lessonId ?? pages[index - 1].id),
			})) as PraxityBlock[],
		})),
	);
}
