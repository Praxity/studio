import { traverseAssetGraph } from "@praxity/shared-blocks/asset-graph";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import { decompressFrames, parseGIF } from "gifuct-js";

const MAX_PIXELS = 4_000_000;
const MAX_FRAMES = 1_000;
const MAX_SAMPLES = 65_536;
const LUMINANCE_CHANGE = 0.1;
const AREA_RATIO = 0.25;
const FLASHES_PER_SECOND_LIMIT = 3;
const VISUAL_ASSET_FIELDS = ["src", "imageSrc", "image", "backgroundImage", "posterSrc"];

export interface GifFlashAnalysis {
	exceedsThreshold: boolean;
	flashCount: number;
	analyzed: boolean;
}

type AnalysisCache = Map<string, Promise<GifFlashAnalysis>>;

function relativeLuminance(r: number, g: number, b: number): number {
	const linear = (channel: number) => {
		const value = channel / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function fillRect(
	pixels: Uint8ClampedArray,
	canvasWidth: number,
	left: number,
	top: number,
	width: number,
	height: number,
	color: readonly number[],
): void {
	for (let y = top; y < Math.min(top + height, pixels.length / 4 / canvasWidth); y++) {
		for (let x = left; x < Math.min(left + width, canvasWidth); x++) {
			const offset = (y * canvasWidth + x) * 4;
			pixels[offset] = color[0] ?? 255;
			pixels[offset + 1] = color[1] ?? 255;
			pixels[offset + 2] = color[2] ?? 255;
			pixels[offset + 3] = 255;
		}
	}
}

function drawPatch(
	canvas: Uint8ClampedArray,
	canvasWidth: number,
	patch: Uint8ClampedArray,
	dims: { left: number; top: number; width: number; height: number },
): void {
	for (let y = 0; y < dims.height; y++) {
		for (let x = 0; x < dims.width; x++) {
			const source = (y * dims.width + x) * 4;
			if (patch[source + 3] === 0) continue;
			const target = ((dims.top + y) * canvasWidth + dims.left + x) * 4;
			canvas[target] = patch[source];
			canvas[target + 1] = patch[source + 1];
			canvas[target + 2] = patch[source + 2];
			canvas[target + 3] = patch[source + 3];
		}
	}
}

function transitionDirections(
	previous: Uint8ClampedArray,
	current: Uint8ClampedArray,
	width: number,
	height: number,
): Int8Array | null {
	const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_SAMPLES)));
	const directions: number[] = [];
	let changed = 0;

	for (let y = 0; y < height; y += stride) {
		for (let x = 0; x < width; x += stride) {
			const offset = (y * width + x) * 4;
			const before = relativeLuminance(
				previous[offset],
				previous[offset + 1],
				previous[offset + 2],
			);
			const after = relativeLuminance(current[offset], current[offset + 1], current[offset + 2]);
			const qualifies =
				Math.abs(after - before) >= LUMINANCE_CHANGE && Math.min(before, after) < 0.8;
			directions.push(qualifies ? (after > before ? 1 : -1) : 0);
			if (qualifies) changed++;
		}
	}

	return changed / directions.length >= AREA_RATIO ? Int8Array.from(directions) : null;
}

/**
 * Conservative WCAG 2.3.1 warning heuristic, not a conformance measurement.
 * It composites GIF disposal frames and flags four general-luminance flashes in
 * any one-second window when opposing >=0.10 luminance changes overlap at least
 * 25% of sampled asset pixels. It does not implement the red-flash formula or
 * the rendered 10-degree visual-field area, and can miss background-dependent
 * transparency, sub-25%-of-asset flashes, and files above the safety caps.
 * ponytail: replace with a calibrated WCAG Photosensitive Epilepsy Analysis
 * Tool-equivalent pixel model if blocking enforcement ever becomes necessary.
 */
export function analyzeGifFlashes(bytes: Uint8Array): GifFlashAnalysis {
	try {
		const buffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		const gif = parseGIF(buffer);
		const width = gif.lsd.width;
		const height = gif.lsd.height;
		const imageFrameCount = gif.frames.filter((frame) => "image" in frame).length;
		if (
			width <= 0 ||
			height <= 0 ||
			width * height > MAX_PIXELS ||
			imageFrameCount < 2 ||
			imageFrameCount > MAX_FRAMES
		) {
			return { exceedsThreshold: false, flashCount: 0, analyzed: imageFrameCount < 2 };
		}

		const frames = decompressFrames(gif, true);
		const background = gif.gct?.[gif.lsd.backgroundColorIndex] ?? [255, 255, 255];
		let canvas: Uint8ClampedArray = new Uint8ClampedArray(width * height * 4);
		fillRect(canvas, width, 0, 0, width, height, background);
		let previousDisplayed: Uint8ClampedArray | null = null;
		let previousFrame = frames[0];
		let restoreCanvas: Uint8ClampedArray | null = null;
		let candidate: Int8Array | null = null;
		let elapsed = 0;
		const flashTimes: number[] = [];

		for (const [index, frame] of frames.entries()) {
			if (index > 0) {
				elapsed += previousFrame.delay;
				if (previousFrame.disposalType === 2) {
					fillRect(
						canvas,
						width,
						previousFrame.dims.left,
						previousFrame.dims.top,
						previousFrame.dims.width,
						previousFrame.dims.height,
						background,
					);
				} else if (previousFrame.disposalType === 3 && restoreCanvas) {
					canvas = restoreCanvas;
				}
			}

			restoreCanvas = frame.disposalType === 3 ? canvas.slice() : null;
			drawPatch(canvas, width, frame.patch, frame.dims);
			const displayed = canvas.slice();
			if (previousDisplayed) {
				const directions = transitionDirections(previousDisplayed, displayed, width, height);
				if (directions) {
					if (candidate) {
						let opposing = 0;
						for (let i = 0; i < directions.length; i++) {
							if (directions[i] !== 0 && directions[i] === -candidate[i]) opposing++;
						}
						if (opposing / directions.length >= AREA_RATIO) {
							flashTimes.push(elapsed);
							candidate = null;
							const firstInWindow = flashTimes.findIndex((time) => elapsed - time <= 1_000);
							if (flashTimes.length - firstInWindow > FLASHES_PER_SECOND_LIMIT) {
								return { exceedsThreshold: true, flashCount: flashTimes.length, analyzed: true };
							}
						} else {
							candidate = directions;
						}
					} else {
						candidate = directions;
					}
				}
			}
			previousDisplayed = displayed;
			previousFrame = frame;
		}

		return { exceedsThreshold: false, flashCount: flashTimes.length, analyzed: true };
	} catch {
		return { exceedsThreshold: false, flashCount: 0, analyzed: false };
	}
}

function localGifPath(value: string): string | null {
	const withoutProtocol = value.replace(/^praxity-asset:\/\//, "");
	const normalized = withoutProtocol.split(/[?#]/, 1)[0]?.replace(/^\.\//, "").replace(/^\//, "");
	return normalized?.toLowerCase().endsWith(".gif") && normalized.startsWith("assets/")
		? normalized
		: null;
}

export async function findFlashingGifSources(
	pages: PraxityPage[],
	readAsset: (relativePath: string) => Promise<Uint8Array>,
	cache: AnalysisCache = new Map(),
): Promise<Set<string>> {
	const sources = new Map<string, Set<string>>();
	await traverseAssetGraph(
		pages,
		{
			onAsset: ({ value }) => {
				const path = localGifPath(value);
				if (!path) return;
				const rawSources = sources.get(path) ?? new Set<string>();
				rawSources.add(value);
				sources.set(path, rawSources);
			},
		},
		{ assetFields: VISUAL_ASSET_FIELDS },
	);

	const flashing = new Set<string>();
	await Promise.all(
		[...sources].map(async ([path, rawSources]) => {
			let analysis = cache.get(path);
			if (!analysis) {
				analysis = Promise.resolve(readAsset(path))
					.then(analyzeGifFlashes)
					.catch(() => ({ exceedsThreshold: false, flashCount: 0, analyzed: false }));
				cache.set(path, analysis);
			}
			if ((await analysis).exceedsThreshold) {
				for (const source of rawSources) flashing.add(source);
			}
		}),
	);
	return flashing;
}
