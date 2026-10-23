import type { ChartBlockData, PraxityBlock } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { renderBlockHtml } from "../render-block-html.ts";

const baseData: ChartBlockData = {
	chartType: "bar",
	chartConfig: {},
	title: "Quarterly results",
	altText: "Quarterly results by product",
	xAxisLabel: "Quarter",
	yAxisLabel: "Units",
	data: {
		labels: ["Q1", "Q2", "Q3"],
		series: [
			{ name: "Alpha", values: [3, 7, -2] },
			{ name: "Beta", values: [5, 4, 8] },
		],
	},
};

function renderChart(data: ChartBlockData): Document {
	const html = renderBlockHtml({ id: "chart-1", type: "chart", data } as unknown as PraxityBlock);
	return new JSDOM(html).window.document;
}

describe("published native charts", () => {
	it.each(["line", "bar"] as const)(
		"spaces annual %s labels without removing points or table rows",
		(chartType) => {
			for (const descending of [false, true]) {
				const labels = Array.from({ length: 61 }, (_, i) => String(1961 + i));
				if (descending) labels.reverse();
				const document = renderChart({
					...baseData,
					chartType,
					showPoints: true,
					data: { labels, series: [{ name: "Annual", values: labels.map((_, i) => i + 1) }] },
				});
				const ticks = Array.from(document.querySelectorAll("svg.praxity-chart-visual--wide text"))
					.map((text) => text.textContent)
					.filter((text) => /^\d{4}$/.test(text ?? ""));
				const expected = [
					"1961",
					"1965",
					"1970",
					"1975",
					"1980",
					"1985",
					"1990",
					"1995",
					"2000",
					"2005",
					"2010",
					"2015",
					"2021",
				];
				expect(ticks).toEqual(descending ? expected.reverse() : expected);
				const variants = Array.from(document.querySelectorAll("svg.praxity-chart-visual"));
				expect(variants.map((svg) => svg.getAttribute("width"))).toEqual(["720", "440", "280"]);
				const labelCounts: number[] = [];
				for (const svg of variants) {
					expect(svg.querySelectorAll("circle title, rect title")).toHaveLength(61);
					expect(
						svg.querySelector(".praxity-chart-category-ticks")?.getAttribute("d")?.match(/\bM /g),
					).toHaveLength(61);
					const years = Array.from(svg.querySelectorAll("text"), (text) => text.textContent).filter(
						(text) => /^\d{4}$/.test(text ?? ""),
					);
					expect(years[0]).toBe(labels[0]);
					expect(years.at(-1)).toBe(labels.at(-1));
					labelCounts.push(years.length);
				}
				expect(labelCounts[0]).toBeGreaterThan(labelCounts[1] ?? 0);
				expect(labelCounts[1]).toBeGreaterThan(labelCounts[2] ?? 0);
				expect(
					Array.from(document.querySelectorAll("tbody th"), (cell) => cell.textContent),
				).toEqual(labels);
				expect(
					Array.from(document.querySelectorAll("tbody td"), (cell) => cell.textContent),
				).toEqual(labels.map((_, i) => String(i + 1)));
			}
		},
	);

	it("keeps short, non-annual, and non-chronological category labels", () => {
		const annual = Array.from({ length: 20 }, (_, i) => String(2000 + i));
		for (const labels of [
			annual.slice(0, 8),
			annual.map((_, i) => String(2000 + i * 2)),
			annual.map((year) => `FY ${year}`),
			[annual[1], annual[0], ...annual.slice(2)],
		]) {
			const document = renderChart({
				...baseData,
				chartType: "line",
				data: { labels, series: [{ name: "Annual", values: labels.map(() => 1) }] },
			});
			const text = Array.from(
				document.querySelectorAll("svg.praxity-chart-visual--wide text"),
				(element) => element.textContent,
			);
			expect(text.filter((label) => labels.includes(label ?? ""))).toEqual(labels);
		}
	});

	it("keeps category tick marks when narrow layouts omit adjacent labels", () => {
		const labels = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"];
		const document = renderChart({
			...baseData,
			data: { labels, series: [{ name: "Annual", values: labels.map((_, index) => index + 1) }] },
		});
		const compact = document.querySelector("svg.praxity-chart-visual--compact");
		const printed = Array.from(
			compact?.querySelectorAll("text") ?? [],
			(text) => text.textContent,
		).filter((text) => labels.includes(text ?? ""));
		expect(printed).toEqual(["Q1", "Q3", "Q6"]);
		expect(
			compact?.querySelector(".praxity-chart-category-ticks")?.getAttribute("d")?.match(/\bM /g),
		).toHaveLength(6);
		expect(compact?.querySelectorAll("rect title")).toHaveLength(6);
		expect(document.querySelectorAll("tbody tr")).toHaveLength(6);
	});

	it.each(["bar", "stacked", "line", "area", "scatter", "radar"] as const)(
		"server-renders an accessible %s chart and equivalent table",
		(chartType) => {
			const document = renderChart({ ...baseData, chartType });
			const svg = document.querySelector("svg.praxity-chart-visual");
			const table = document.querySelector("table.praxity-chart-data");

			expect(svg?.getAttribute("role")).toBe("img");
			expect(svg?.hasAttribute("tabindex")).toBe(false);
			expect(document.querySelector("[data-chart-point], [data-chart-instructions]")).toBeNull();
			expect(svg?.getAttribute("aria-label")).toBe(baseData.altText);
			expect(svg?.getAttribute("viewBox")).toMatch(/^0 0 720 /);
			expect(svg?.getAttribute("width")).toBe("720");
			expect(svg?.getAttribute("height")).toBeTruthy();
			expect(table?.querySelector("caption")?.textContent).toBe(baseData.title);
			expect(table?.querySelectorAll("tbody tr")).toHaveLength(3);
			expect(table?.textContent).toContain("Alpha");
			expect(table?.textContent).toContain("-2");
		},
	);

	it("renders the expected native geometry without ECharts markup", () => {
		const bar = renderChart(baseData);
		const line = renderChart({ ...baseData, chartType: "line" });
		const area = renderChart({ ...baseData, chartType: "area" });
		const scatter = renderChart({ ...baseData, chartType: "scatter" });
		const radar = renderChart({ ...baseData, chartType: "radar" });

		expect(bar.querySelectorAll("svg.praxity-chart-visual--wide rect title")).toHaveLength(6);
		expect(line.querySelectorAll('svg path[fill="none"]')).not.toHaveLength(0);
		expect(area.querySelector('svg path[fill-opacity="0.18"]')).toBeTruthy();
		expect(
			scatter.querySelectorAll(
				"svg.praxity-chart-visual--wide circle title, svg.praxity-chart-visual--wide rect title, svg.praxity-chart-visual--wide path title",
			),
		).toHaveLength(6);
		expect(radar.querySelectorAll("svg polygon").length).toBeGreaterThan(6);
		for (const document of [bar, line, area, scatter, radar]) {
			expect(document.querySelector("canvas")).toBeNull();
			expect(document.documentElement.innerHTML).not.toContain("echarts");
		}
	});

	it("supports horizontal, stacked, sorted, and negative values without invalid geometry", () => {
		const document = renderChart({
			...baseData,
			chartType: "stacked",
			orientation: "horizontal",
			sortOrder: "desc",
			sortSeriesIndex: 0,
		});
		const html = document.documentElement.innerHTML;
		const rowLabels = Array.from(document.querySelectorAll("tbody th")).map(
			(cell) => cell.textContent,
		);

		expect(rowLabels).toEqual(["Q2", "Q1", "Q3"]);
		expect(html).not.toMatch(/(?:NaN|Infinity)/);
		expect(document.querySelector("svg")?.textContent).toContain("Quarter");
		expect(document.querySelector("svg")?.textContent).toContain("Units");
	});

	it("treats authored chart text as text inside SVG", () => {
		const document = renderChart({
			...baseData,
			altText: '<img src=x onerror="alert(1)">Safe chart',
			data: {
				labels: ["<b>Q1</b>"],
				series: [{ name: "<script>alert(1)</script>Alpha", values: [1] }],
			},
		});
		const svg = document.querySelector("svg");

		expect(svg?.getAttribute("aria-label")).toBe("Safe chart");
		expect(svg?.querySelector("script, img")).toBeNull();
		expect(svg?.textContent).toContain("Q1");
		expect(svg?.textContent).toContain("Alpha");
	});
});
