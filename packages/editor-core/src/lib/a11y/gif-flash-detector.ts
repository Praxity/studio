import { traverseAssetGraph } from "@praxity/shared-blocks/asset-graph";
import { normalizeDesktopAssetPath } from "@praxity/shared-blocks/desktop-asset-path";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import { decompressFrame, type ParsedFrame, parseGIF } from "gifuct-js";

const MAX_PIXELS = 4_000_000;
const MAX_FRAMES = 1_000;
const MAX_SAMPLES = 65_536;
const LUMINANCE_CHANGE = 0.1;
const AREA_RATIO = 0.25;
const FLASHES_PER_SECOND_LIMIT = 3;
// Reserve four RGBA canvases (16 bytes/canvas pixel), 24 bytes/frame pixel for
// indices, interlace scratch and patches, 64 KiB/frame decoder scratch, and
// 32x source bytes for parsed storage.
// A 96 MiB course reservation leaves roughly 100 MiB for GC/runtime overhead,
// keeping extra analysis memory below about 200 MiB. Files are decoded serially.
export const MAX_GIF_ANALYSIS_BYTES = 96 * 1024 * 1024;
const GIF_FRAME_SCRATCH_BYTES = 64 * 1024;
type AnalysisBudget = { remainingBytes: number };

export interface GifFlashAnalysis {
	exceedsThreshold: boolean;
	flashCount: number;
	analyzed: boolean;
	skipped?: "too-large";
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
 * Export blocks detected threshold exceedances as a precaution; this does not
 * establish conformance for animations the heuristic does not flag.
 */
export function analyzeGifFlashes(
	bytes: Uint8Array,
	budget: AnalysisBudget = { remainingBytes: MAX_GIF_ANALYSIS_BYTES },
): GifFlashAnalysis {
	const tooLarge = (): GifFlashAnalysis => ({
		exceedsThreshold: false,
		flashCount: 0,
		analyzed: false,
		skipped: "too-large",
	});
	// Bound parser storage as well, before copying or parsing the source.
	if (bytes.byteLength * 32 > budget.remainingBytes) return tooLarge();
	try {
		const buffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		const gif = parseGIF(buffer);
		const width = gif.lsd.width;
		const height = gif.lsd.height;
		const imageFrames = gif.frames.filter((frame) => "image" in frame);
		let framePixels = 0;
		for (const frame of imageFrames) {
			const dims = frame.image?.descriptor;
			if (
				!dims ||
				![dims.width, dims.height, dims.left, dims.top].every(Number.isSafeInteger) ||
				dims.width <= 0 ||
				dims.height <= 0 ||
				dims.left < 0 ||
				dims.top < 0 ||
				dims.left + dims.width > width ||
				dims.top + dims.height > height
			)
				return tooLarge();
			framePixels += dims.width * dims.height;
		}
		const storageBytes =
			bytes.byteLength * 32 +
			width * height * 16 +
			framePixels * 24 +
			imageFrames.length * GIF_FRAME_SCRATCH_BYTES;
		if (
			width <= 0 ||
			height <= 0 ||
			width * height > MAX_PIXELS ||
			imageFrames.length > MAX_FRAMES ||
			!Number.isSafeInteger(storageBytes) ||
			storageBytes > budget.remainingBytes
		)
			return tooLarge();
		if (imageFrames.length < 2) return { exceedsThreshold: false, flashCount: 0, analyzed: true };
		budget.remainingBytes -= storageBytes;

		const background = gif.gct?.[gif.lsd.backgroundColorIndex] ?? [255, 255, 255];
		let canvas: Uint8ClampedArray = new Uint8ClampedArray(width * height * 4);
		fillRect(canvas, width, 0, 0, width, height, background);
		let previousDisplayed: Uint8ClampedArray | null = null;
		let previousFrame: Pick<ParsedFrame, "delay" | "disposalType" | "dims"> | undefined;
		let restoreCanvas: Uint8ClampedArray | null = null;
		let candidate: Int8Array | null = null;
		let candidateStarted = 0;
		let elapsed = 0;
		const flashStarts: number[] = [];

		for (const rawFrame of imageFrames) {
			if (previousFrame) {
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

			const frame = decompressFrame(rawFrame, gif.gct, true);
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
							flashStarts.push(candidateStarted);
							candidate = null;
							// A complete flash must have both transitions inside the window.
							if (
								flashStarts.filter((start) => elapsed - start <= 1_000).length >
								FLASHES_PER_SECOND_LIMIT
							) {
								return { exceedsThreshold: true, flashCount: flashStarts.length, analyzed: true };
							}
						} else {
							candidate = directions;
							candidateStarted = elapsed;
						}
					} else {
						candidate = directions;
						candidateStarted = elapsed;
					}
				}
			}
			previousDisplayed = displayed;
			previousFrame = { delay: frame.delay, disposalType: frame.disposalType, dims: frame.dims };
		}

		return { exceedsThreshold: false, flashCount: flashStarts.length, analyzed: true };
	} catch {
		return { exceedsThreshold: false, flashCount: 0, analyzed: false };
	}
}

export async function findFlashingGifSources(
	pages: PraxityPage[],
	readAsset: (relativePath: string) => Promise<Uint8Array>,
	cache: AnalysisCache = new Map(),
	options: {
		resolveAssetPath?: (reference: string) => string | undefined;
		uncheckedSources?: Set<string>;
	} = {},
): Promise<Set<string>> {
	const sources = new Map<string, Set<string>>();
	await traverseAssetGraph(pages, {
		onAsset: ({ value }) => {
			const reference = value.replace(/^praxity-asset:\/\//, "");
			const path = options.resolveAssetPath
				? options.resolveAssetPath(reference)
				: normalizeDesktopAssetPath(reference.split(/[?#]/, 1)[0]);
			if (!path?.startsWith("assets/") || !path.toLowerCase().endsWith(".gif")) return;
			const rawSources = sources.get(path) ?? new Set<string>();
			rawSources.add(value);
			sources.set(path, rawSources);
		},
	});

	const flashing = new Set<string>();
	const budget = { remainingBytes: MAX_GIF_ANALYSIS_BYTES };
	// Serial reads/decode keep one GIF live and share a fixed course reservation.
	for (const [path, rawSources] of sources) {
		let analysis = cache.get(path);
		if (!analysis) {
			analysis = readAsset(path)
				.then((bytes) => analyzeGifFlashes(bytes, budget))
				.catch(() => ({ exceedsThreshold: false, flashCount: 0, analyzed: false }));
			cache.set(path, analysis);
		}
		const result = await analysis;
		if (result.exceedsThreshold) for (const source of rawSources) flashing.add(source);
		if (result.skipped) for (const source of rawSources) options.uncheckedSources?.add(source);
	}
	return flashing;
}
