/** Hotspot coordinates are percentages of the displayed image on each axis. */
export function hotspotGeometry(shape: unknown, coords: unknown) {
	if (!Array.isArray(coords) || !coords.every((n) => typeof n === "number" && Number.isFinite(n)))
		return null;
	if (shape === "rect" && coords.length === 4) {
		const [left, top, width, height] = coords as number[];
		return left >= 0 &&
			top >= 0 &&
			width > 0 &&
			height > 0 &&
			left + width <= 100 &&
			top + height <= 100
			? { left, top, width, height, clipPath: undefined, point: false }
			: null;
	}
	if (shape === "ellipse" && (coords.length === 2 || coords.length === 3 || coords.length === 4)) {
		const [rawX, rawY, rx = 6, ry = rx] = coords as number[];
		const point = coords.length !== 4;
		const x = point ? Math.max(0, Math.min(100, rawX)) : rawX;
		const y = point ? Math.max(0, Math.min(100, rawY)) : rawY;
		return rx > 0 &&
			ry > 0 &&
			(point || (x - rx >= 0 && x + rx <= 100 && y - ry >= 0 && y + ry <= 100))
			? { left: x - rx, top: y - ry, width: 2 * rx, height: 2 * ry, clipPath: undefined, point }
			: null;
	}
	if (shape === "polygon" && coords.length >= 6 && coords.length % 2 === 0) {
		const xs = coords.filter((_, i) => i % 2 === 0) as number[];
		const ys = coords.filter((_, i) => i % 2 === 1) as number[];
		const left = xs.reduce((min, x) => Math.min(min, x), 100);
		const top = ys.reduce((min, y) => Math.min(min, y), 100);
		const width = xs.reduce((max, x) => Math.max(max, x), 0) - left;
		const height = ys.reduce((max, y) => Math.max(max, y), 0) - top;
		const area = xs.reduce(
			(sum, x, i) => sum + x * ys[(i + 1) % ys.length] - xs[(i + 1) % xs.length] * ys[i],
			0,
		);
		if (
			!area ||
			!width ||
			!height ||
			left < 0 ||
			top < 0 ||
			left + width > 100 ||
			top + height > 100
		)
			return null;
		return {
			left,
			top,
			width,
			height,
			clipPath: `polygon(${xs.map((x, i) => `${((x - left) / width) * 100}% ${((ys[i] - top) / height) * 100}%`).join(", ")})`,
			point: false,
		};
	}
	return null;
}
