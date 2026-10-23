import { escapeHtml } from "@praxity/content-model/constants";
import type { ChartBlockData } from "./types";

/** Static, dependency-free chart SVG shared by published HTML and print exports. */

export type PublishedChartSeries = { name: string; values: Array<number | null> };

export const PUBLISHED_CHART_COLORS = [
	"var(--praxity-chart-1, var(--praxity-color-accent, #4269d0))",
	"var(--praxity-chart-2, #efb118)",
	"var(--praxity-chart-3, #ff725c)",
	"var(--praxity-chart-4, #6cc5b0)",
	"var(--praxity-chart-5, #a463f2)",
	"var(--praxity-chart-6, #3ca951)",
] as const;

export function formatChartNumber(value: number): string {
	if (Math.abs(value) < 1e-10) return "0";
	return String(Number(value.toPrecision(4)));
}

export function sortChartData(
	labels: string[],
	series: PublishedChartSeries[],
	sortOrder: ChartBlockData["sortOrder"],
	sortSeriesIndex: number,
): { labels: string[]; series: PublishedChartSeries[] } {
	if (sortOrder !== "asc" && sortOrder !== "desc") return { labels, series };
	const selected = series[Math.min(Math.max(0, sortSeriesIndex), series.length - 1)];
	if (!selected) return { labels, series };
	const indices = labels.map((_, index) => index);
	indices.sort((left, right) => {
		const a = selected.values[left] ?? 0;
		const b = selected.values[right] ?? 0;
		return sortOrder === "asc" ? a - b : b - a;
	});
	return {
		labels: indices.map((index) => labels[index] ?? ""),
		series: series.map((entry) => ({
			...entry,
			values: indices.map((index) => entry.values[index] ?? null),
		})),
	};
}

function chartTicks(minimum: number, maximum: number): number[] {
	const span = Math.max(maximum - minimum, 1);
	const roughStep = span / 4;
	const magnitude = 10 ** Math.floor(Math.log10(roughStep));
	const normalized = roughStep / magnitude;
	const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
	const first = Math.floor(minimum / step) * step;
	const last = Math.ceil(maximum / step) * step;
	const ticks: number[] = [];
	for (let value = first; value <= last + step / 2; value += step) {
		ticks.push(Number(value.toPrecision(12)));
	}
	return ticks.length > 1 ? ticks : [first, first + step];
}

function chartYearLabelIndices(labels: string[], maximumLabels = 16): Set<number> | undefined {
	if (labels.length <= 12 || labels.some((label) => !/^\d{4}$/.test(label.trim()))) return;
	const years = labels.map(Number);
	const direction = years[1] - years[0];
	if (
		Math.abs(direction) !== 1 ||
		years.some((year, i) => i > 0 && year - years[i - 1] !== direction)
	)
		return;
	const last = labels.length - 1;
	// Keep five-year boundaries, with fewer printed labels in narrower charts.
	const minimumGap = Math.ceil(last / maximumLabels);
	const indices = new Set([0, last]);
	let previous = 0;
	for (let index = 1; index < last; index++) {
		if (years[index] % 5 === 0 && index - previous >= minimumGap && last - index >= minimumGap) {
			indices.add(index);
			previous = index;
		}
	}
	return indices;
}

function chartLegend(
	series: PublishedChartSeries[],
	height: number,
	width = 720,
	columns = Math.min(3, series.length),
	fontSize = "14",
): string {
	if (series.length < 2) return "";
	const rows = Math.ceil(series.length / columns);
	const startY = height - rows * 24 + 14;
	// Each row is one text run anchored at the centre, so the browser or PDF renderer places the
	// real glyphs in any font: entries cannot collide and the row stays centred. A rect swatch
	// would need the text measured first, so the swatch is a bullet in the same run. The bullet
	// is in every bundled font's Latin set; Typst sets a whole run in a fallback font when one
	// glyph is missing, which a square such as U+25A0 triggers. A row wider than the chart still
	// clips; fewer columns per row is the upgrade path if that shows up.
	return `<g class="praxity-chart-legend" aria-hidden="true">${Array.from(
		{ length: rows },
		(_, row) => {
			const entries = series
				.slice(row * columns, (row + 1) * columns)
				.map((entry, offset) => {
					const color =
						PUBLISHED_CHART_COLORS[(row * columns + offset) % PUBLISHED_CHART_COLORS.length];
					return `<tspan class="praxity-chart-mark"${offset ? ' dx="24"' : ""} fill="${color}" color="${color}" stroke="var(--praxity-color-text, #1f2900)" stroke-width="1" font-size="2em">•</tspan><tspan dx="6">${escapeHtml(entry.name)}</tspan>`;
				})
				.join("");
			return `<text x="${width / 2}" y="${startY + row * 24 + 1}" text-anchor="middle" fill="var(--praxity-color-text, #1f2900)" font-size="${fontSize}">${entries}</text>`;
		},
	).join("")}</g>`;
}

function chartPoint(
	x: number,
	y: number,
	seriesIndex: number,
	color: string,
	title: string,
): string {
	const common = `fill="${color}" stroke="var(--praxity-color-text, #1f2900)" stroke-width="1.25" vector-effect="non-scaling-stroke"`;
	switch (seriesIndex % 4) {
		case 1:
			return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" ${common}><title>${escapeHtml(title)}</title></rect>`;
		case 2:
			return `<path d="M ${x} ${y - 5} L ${x + 5} ${y} L ${x} ${y + 5} L ${x - 5} ${y} Z" ${common}><title>${escapeHtml(title)}</title></path>`;
		case 3:
			return `<path d="M ${x} ${y - 5} L ${x + 5} ${y + 4} L ${x - 5} ${y + 4} Z" ${common}><title>${escapeHtml(title)}</title></path>`;
		default:
			return `<circle cx="${x}" cy="${y}" r="4" ${common}><title>${escapeHtml(title)}</title></circle>`;
	}
}

export function renderCartesianChartSvg(
	data: ChartBlockData,
	labels: string[],
	series: PublishedChartSeries[],
	accessibleName: string,
	width: 720 | 440 | 280,
	/** Converts an authored axis label to plain text; the caller owns sanitizing. */
	chartText: (value: unknown) => string,
): string {
	const effectiveType = data.chartType === "stacked" ? "bar" : data.chartType;
	const stacked = data.stacked === true || data.chartType === "stacked";
	const horizontal = effectiveType === "bar" && data.orientation === "horizontal";
	const maximumLabels = width === 720 ? 16 : width === 440 ? 8 : 5;
	const yearLabelIndices = horizontal ? undefined : chartYearLabelIndices(labels, maximumLabels);
	const labelIndices =
		yearLabelIndices ??
		(width !== 720 && labels.length > maximumLabels && !horizontal
			? new Set(
					labels.flatMap((_, index) =>
						index === 0 ||
						index === labels.length - 1 ||
						(index % Math.ceil((labels.length - 1) / (maximumLabels - 1)) === 0 &&
							labels.length - 1 - index >= Math.ceil((labels.length - 1) / (maximumLabels - 1)))
							? [index]
							: [],
					),
				)
			: undefined);
	const horizontalAxisLabel = chartText(horizontal ? data.yAxisLabel : data.xAxisLabel);
	const verticalAxisLabel = chartText(horizontal ? data.xAxisLabel : data.yAxisLabel);
	const legendColumns = Math.min(width === 720 ? 3 : width === 440 ? 2 : 1, series.length);
	const legendRows = series.length > 1 ? Math.ceil(series.length / legendColumns) : 0;
	const rotateLabels =
		!horizontal &&
		((width === 720 && labels.length > 8) || labels.some((label) => label.length > 12));
	const height = 400 + Math.max(0, legendRows - 1) * 24;
	const rawValues = series
		.flatMap((entry) => entry.values)
		.filter((value): value is number => value !== null);
	let minimum = Math.min(0, ...rawValues);
	let maximum = Math.max(0, ...rawValues);
	if (stacked) {
		minimum = Math.min(
			0,
			...labels.map((_, labelIndex) =>
				series.reduce((total, entry) => total + Math.min(0, entry.values[labelIndex] ?? 0), 0),
			),
		);
		maximum = Math.max(
			0,
			...labels.map((_, labelIndex) =>
				series.reduce((total, entry) => total + Math.max(0, entry.values[labelIndex] ?? 0), 0),
			),
		);
	}
	if (minimum === maximum) maximum = minimum + 1;
	const ticks = chartTicks(minimum, maximum);
	minimum = ticks[0] ?? minimum;
	maximum = ticks[ticks.length - 1] ?? maximum;
	// Label extents are estimated at the 16-unit base size, since SVG text cannot be measured here.
	// Each axis title keeps a fixed gap from the outer edge of its tick labels.
	const character = 9.5;
	const titleSize = 18.3;
	const titleGap = 12;
	const categoryWidth = Math.max(0, ...labels.map((label) => label.length)) * character;
	const valueWidth = Math.max(...ticks.map((tick) => formatChartNumber(tick).length)) * character;
	// A rotated title occupies its ascent (0.72em) left of the baseline and descent (0.24em) right of it.
	const verticalTitleX = 4 + titleSize * 0.72;
	const verticalTitleSpace = verticalAxisLabel ? verticalTitleX + titleSize * 0.24 + titleGap : 8;
	// The cap limits the category labels only, so the title band is never overlapped.
	const left = horizontal
		? verticalTitleSpace +
			Math.min(width === 720 ? 190 : width * 0.4, Math.max(56, categoryWidth)) +
			10
		: verticalTitleSpace + valueWidth + 10;
	// Horizontal value labels are centred on their ticks, so the last one needs half its width.
	const right = horizontal
		? Math.max(20, (formatChartNumber(ticks[ticks.length - 1] ?? 0).length * character) / 2 + 4)
		: 20;
	const top = 20;
	// Tick label baselines sit 22 below the plot; rotated labels drop by width × sin 35°.
	const tickDepth = 22 + (rotateLabels ? Math.min(categoryWidth, 160) * 0.574 + 6 : 6);
	const bottom =
		tickDepth +
		(horizontalAxisLabel ? titleGap + titleSize + 6 : 6) +
		(legendRows ? 8 + legendRows * 24 : 0);
	const plotWidth = width - left - right;
	const plotHeight = height - top - bottom;
	const horizontalTitleY = top + plotHeight + tickDepth + titleGap + titleSize * 0.72;
	const scale = (value: number) => (value - minimum) / (maximum - minimum);
	const xValue = (value: number) => left + scale(value) * plotWidth;
	const yValue = (value: number) => top + (1 - scale(value)) * plotHeight;
	const xCategory = (index: number) => left + ((index + 0.5) / labels.length) * plotWidth;
	const yCategory = (index: number) => top + ((index + 0.5) / labels.length) * plotHeight;
	const categoryTicks = horizontal
		? ""
		: `<path class="praxity-chart-category-ticks" d="${labels
				.map((_, index) => `M ${xCategory(index)} ${top + plotHeight} v 5`)
				.join(
					" ",
				)}" fill="none" stroke="var(--praxity-color-text, #1f2900)" vector-effect="non-scaling-stroke"/>`;
	const axis = horizontal
		? `${ticks
				.map((tick) => {
					const x = xValue(tick);
					return `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotHeight}" stroke="var(--praxity-color-border, #e0e0e0)" vector-effect="non-scaling-stroke"/><text x="${x}" y="${top + plotHeight + 22}" text-anchor="middle" fill="var(--praxity-color-text-muted, #666)" font-size="1em">${formatChartNumber(tick)}</text>`;
				})
				.join("")}${labels
				.map(
					(label, index) =>
						`<text x="${left - 10}" y="${yCategory(index) + 5}" text-anchor="end" fill="var(--praxity-color-text, #1f2900)" font-size="1em">${escapeHtml(label)}</text>`,
				)
				.join("")}`
		: `${ticks
				.map((tick) => {
					const y = yValue(tick);
					return `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}" stroke="var(--praxity-color-border, #e0e0e0)" vector-effect="non-scaling-stroke"/><text x="${left - 10}" y="${y + 5}" text-anchor="end" fill="var(--praxity-color-text-muted, #666)" font-size="1em">${formatChartNumber(tick)}</text>`;
				})
				.join("")}${categoryTicks}${labels
				.map((label, index) => {
					if (labelIndices && !labelIndices.has(index)) return "";
					const x = xCategory(index);
					const y = top + plotHeight + 22;
					return `<text x="${x}" y="${y}" text-anchor="${rotateLabels ? "end" : "middle"}"${rotateLabels ? ` transform="rotate(-35 ${x} ${y})"` : ""} fill="var(--praxity-color-text, #1f2900)" font-size="1em">${escapeHtml(label)}</text>`;
				})
				.join("")}`;
	const axisLabels = `${horizontalAxisLabel ? `<text x="${left + plotWidth / 2}" y="${horizontalTitleY}" text-anchor="middle" fill="var(--praxity-color-text, #1f2900)" font-size="1.143em" font-weight="600">${escapeHtml(horizontalAxisLabel)}</text>` : ""}${verticalAxisLabel ? `<text x="${verticalTitleX}" y="${top + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 ${verticalTitleX} ${top + plotHeight / 2})" fill="var(--praxity-color-text, #1f2900)" font-size="1.143em" font-weight="600">${escapeHtml(verticalAxisLabel)}</text>` : ""}`;

	let marks = "";
	if (effectiveType === "bar") {
		const slot = (horizontal ? plotHeight : plotWidth) / labels.length;
		const groupSize = slot * 0.72;
		const barSize = stacked ? groupSize : groupSize / Math.max(series.length, 1);
		const positive = labels.map(() => 0);
		const negative = labels.map(() => 0);
		series.forEach((entry, seriesIndex) => {
			const color = PUBLISHED_CHART_COLORS[seriesIndex % PUBLISHED_CHART_COLORS.length];
			entry.values.forEach((value, labelIndex) => {
				if (value === null) return;
				const start = stacked ? (value >= 0 ? positive[labelIndex] : negative[labelIndex]) : 0;
				const end = start + value;
				if (stacked) {
					if (value >= 0) positive[labelIndex] = end;
					else negative[labelIndex] = end;
				}
				const offset = stacked ? -groupSize / 2 : -groupSize / 2 + seriesIndex * barSize;
				const title = `${entry.name}, ${labels[labelIndex]}: ${formatChartNumber(value)}`;
				if (horizontal) {
					const startX = xValue(start);
					const endX = xValue(end);
					marks += `<rect x="${Math.min(startX, endX)}" y="${yCategory(labelIndex) + offset}" width="${Math.max(0.75, Math.abs(endX - startX))}" height="${barSize}" rx="2" class="praxity-chart-mark" fill="${color}" color="${color}" stroke="var(--praxity-color-text, #1f2900)" stroke-width="1" vector-effect="non-scaling-stroke"><title>${escapeHtml(title)}</title></rect>`;
				} else {
					const startY = yValue(start);
					const endY = yValue(end);
					marks += `<rect x="${xCategory(labelIndex) + offset}" y="${Math.min(startY, endY)}" width="${barSize}" height="${Math.max(0.75, Math.abs(endY - startY))}" rx="2" class="praxity-chart-mark" fill="${color}" color="${color}" stroke="var(--praxity-color-text, #1f2900)" stroke-width="1" vector-effect="non-scaling-stroke"><title>${escapeHtml(title)}</title></rect>`;
				}
			});
		});
	} else {
		const showLines = data.showLines ?? effectiveType !== "scatter";
		const showPoints = data.showPoints ?? effectiveType === "scatter";
		series.forEach((entry, seriesIndex) => {
			const color = PUBLISHED_CHART_COLORS[seriesIndex % PUBLISHED_CHART_COLORS.length];
			const points = entry.values
				.map((value, index) =>
					value === null ? null : { x: xCategory(index), y: yValue(value), value, index },
				)
				.filter((point): point is NonNullable<typeof point> => point !== null);
			if (points.length === 0) return;
			const path = points
				.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
				.join(" ");
			if (effectiveType === "area") {
				const baseline = yValue(0);
				marks += `<path d="${path} L ${points[points.length - 1]?.x} ${baseline} L ${points[0]?.x} ${baseline} Z" fill="${color}" fill-opacity="0.18" stroke="none"/>`;
			}
			if (showLines) {
				marks += `<path d="${path}" fill="none" stroke="var(--praxity-color-text, #1f2900)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="${seriesIndex % 3 === 1 ? "8 4" : seriesIndex % 3 === 2 ? "2 4" : "none"}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
			}
			for (const point of points) {
				const title = `${entry.name}, ${labels[point.index]}: ${formatChartNumber(point.value)}`;
				marks += showPoints
					? chartPoint(point.x, point.y, seriesIndex, color, title)
					: `<circle cx="${point.x}" cy="${point.y}" r="8" fill="transparent"><title>${escapeHtml(title)}</title></circle>`;
			}
		});
	}

	return `<svg class="praxity-chart-visual praxity-chart-visual--${width === 720 ? "wide" : width === 440 ? "medium" : "compact"}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(accessibleName)}" focusable="false" style="width:100%;height:auto;overflow:hidden;font-family:inherit"><title>${escapeHtml(accessibleName)}</title><g aria-hidden="true">${axis}${axisLabels}${marks}${chartLegend(series, height, width, legendColumns, "1em")}</g></svg>`;
}

export function renderRadarChartSvg(
	labels: string[],
	series: PublishedChartSeries[],
	accessibleName: string,
): string {
	const width = 720;
	const legendRows = series.length > 1 ? Math.ceil(series.length / 3) : 0;
	const height = 400 + Math.max(0, legendRows - 1) * 24;
	const centerX = width / 2;
	const centerY = (height - legendRows * 24) / 2;
	const radius = Math.min(135, centerY - 40);
	const maximum = Math.max(
		1,
		...series.flatMap((entry) => entry.values).filter((value): value is number => value !== null),
	);
	const point = (index: number, scale: number) => {
		const angle = -Math.PI / 2 + (index / labels.length) * Math.PI * 2;
		return {
			x: centerX + Math.cos(angle) * radius * scale,
			y: centerY + Math.sin(angle) * radius * scale,
		};
	};
	const polygon = (scale: number) =>
		labels
			.map((_, index) => point(index, scale))
			.map(({ x, y }) => `${x},${y}`)
			.join(" ");
	const grid = [0.2, 0.4, 0.6, 0.8, 1]
		.map(
			(scale) =>
				`<polygon points="${polygon(scale)}" fill="none" stroke="var(--praxity-color-border, #e0e0e0)" vector-effect="non-scaling-stroke"/>`,
		)
		.join("");
	const axes = labels
		.map((label, index) => {
			const edge = point(index, 1);
			const text = point(index, 1.18);
			const anchor = text.x < centerX - 8 ? "end" : text.x > centerX + 8 ? "start" : "middle";
			return `<line x1="${centerX}" y1="${centerY}" x2="${edge.x}" y2="${edge.y}" stroke="var(--praxity-color-border, #e0e0e0)" vector-effect="non-scaling-stroke"/><text x="${text.x}" y="${text.y + 5}" text-anchor="${anchor}" fill="var(--praxity-color-text, #1f2900)" font-size="14">${escapeHtml(label)}</text>`;
		})
		.join("");
	const marks = series
		.map((entry, seriesIndex) => {
			const color = PUBLISHED_CHART_COLORS[seriesIndex % PUBLISHED_CHART_COLORS.length];
			const points = labels.map((label, labelIndex) => {
				const value = entry.values[labelIndex] ?? 0;
				return { ...point(labelIndex, Math.max(0, value) / maximum), label, value };
			});
			const shape = points.map(({ x, y }) => `${x},${y}`).join(" ");
			return `<polygon points="${shape}" fill="${color}" fill-opacity="0.15" stroke="var(--praxity-color-text, #1f2900)" stroke-width="5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><polygon points="${shape}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-dasharray="${seriesIndex % 3 === 1 ? "8 4" : seriesIndex % 3 === 2 ? "2 4" : "none"}" vector-effect="non-scaling-stroke"/>${points
				.map(({ x, y, label, value }) =>
					chartPoint(
						x,
						y,
						seriesIndex,
						color,
						`${entry.name}, ${label}: ${formatChartNumber(value)}`,
					),
				)
				.join("")}`;
		})
		.join("");
	return `<svg class="praxity-chart-visual" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(accessibleName)}" focusable="false" style="display:block;width:100%;height:auto;overflow:hidden;font-family:inherit"><title>${escapeHtml(accessibleName)}</title><g aria-hidden="true">${grid}${axes}${marks}${chartLegend(series, height)}</g></svg>`;
}
