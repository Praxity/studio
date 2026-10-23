import type { ImagePerceptualMetadata } from "@praxity/grammar";

/**
 * Analyze pixel data from a downsampled canvas to produce perceptual metadata.
 * Expects ImageData from a small canvas (64x64 recommended).
 *
 * @param imageData - ImageData from canvas.getImageData()
 * @param originalWidth - Original image width in pixels
 * @param originalHeight - Original image height in pixels
 */
export function analyzeImageData(
	imageData: ImageData,
	originalWidth?: number,
	originalHeight?: number,
): ImagePerceptualMetadata {
	const { data, width: canvasW, height: canvasH } = imageData;
	const pixelCount = canvasW * canvasH;

	let lumSum = 0;
	let lumSqSum = 0;
	let satSum = 0;
	const hueBuckets = new Float32Array(360);

	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] / 255;
		const g = data[i + 1] / 255;
		const b = data[i + 2] / 255;

		// BT.709 relative luminance
		const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		lumSum += lum;
		lumSqSum += lum * lum;

		// HSL saturation
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const l = (max + min) / 2;
		const delta = max - min;
		const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
		satSum += Math.min(sat, 1);

		// Hue bucket (skip near-gray pixels)
		if (delta > 0.05) {
			let hue: number;
			if (max === r) hue = ((g - b) / delta) % 6;
			else if (max === g) hue = (b - r) / delta + 2;
			else hue = (r - g) / delta + 4;
			hue = Math.round(hue * 60);
			if (hue < 0) hue += 360;
			if (hue >= 360) hue = 0;
			hueBuckets[hue]++;
		}
	}

	const avgLum = lumSum / pixelCount;
	const variance = lumSqSum / pixelCount - avgLum * avgLum;
	const contrastRatio = Math.min(Math.sqrt(Math.max(0, variance)) / 0.5, 1);

	// Detail density via Laplacian variance
	const gray = new Float32Array(canvasW * canvasH);
	for (let i = 0; i < gray.length; i++) {
		const j = i * 4;
		gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
	}
	let lapSum = 0;
	let lapSqSum = 0;
	let lapCount = 0;
	for (let y = 1; y < canvasH - 1; y++) {
		for (let x = 1; x < canvasW - 1; x++) {
			const idx = y * canvasW + x;
			const lap =
				4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - canvasW] - gray[idx + canvasW];
			lapSum += lap;
			lapSqSum += lap * lap;
			lapCount++;
		}
	}
	const lapMean = lapCount > 0 ? lapSum / lapCount : 0;
	const lapVariance = lapCount > 0 ? lapSqSum / lapCount - lapMean * lapMean : 0;
	const detailDensity = 1 / (1 + Math.exp(-(lapVariance - 500) / 300));

	// Dominant hue
	let maxBucket = 0;
	let dominantHue = 0;
	for (let i = 0; i < 360; i++) {
		if (hueBuckets[i] > maxBucket) {
			maxBucket = hueBuckets[i];
			dominantHue = i;
		}
	}

	return {
		v: 1,
		avgLuminance: Math.round(avgLum * 255),
		contrastRatio: Math.round(contrastRatio * 1000) / 1000,
		avgSaturation: Math.round((satSum / pixelCount) * 1000) / 1000,
		dominantHue,
		detailDensity: Math.round(detailDensity * 1000) / 1000,
		width: originalWidth ?? canvasW,
		height: originalHeight ?? canvasH,
	};
}

/**
 * Analyze an image from a canvas that already has the image drawn on it.
 * Use this when you already have a canvas from optimize-image.ts.
 */
export function analyzeFromCanvas(
	srcCanvas: HTMLCanvasElement,
	originalWidth: number,
	originalHeight: number,
	sampleSize = 64,
): ImagePerceptualMetadata {
	const canvas = document.createElement("canvas");
	canvas.width = sampleSize;
	canvas.height = sampleSize;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) {
		return {
			v: 1,
			avgLuminance: 128,
			contrastRatio: 0.5,
			avgSaturation: 0.5,
			dominantHue: 0,
			detailDensity: 0.5,
			width: originalWidth,
			height: originalHeight,
		};
	}
	ctx.drawImage(srcCanvas, 0, 0, sampleSize, sampleSize);
	const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
	return analyzeImageData(imageData, originalWidth, originalHeight);
}
