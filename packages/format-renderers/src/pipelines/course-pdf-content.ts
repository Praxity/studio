import type { PraxityBlock } from "@praxity/content-model";
import { getInlineField } from "@praxity/content-model/inline-preparation";
import {
	renderCartesianChartSvg,
	renderRadarChartSvg,
	sortChartData,
} from "@praxity/shared-blocks/chart-svg";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import type { ChartBlockData } from "@praxity/shared-blocks/types";
import { escapeTypst, stripHtml, typstString } from "../renderers/typst/common.ts";
import { renderDialogueToTypst } from "../renderers/typst/dialogue.ts";
import type { PdfAssessmentContext } from "./course-pdf-assessments.ts";

type Data = Record<string, unknown>;
export interface PdfContentContext {
	locale: string;
	rich: (html: unknown) => string;
	heading?: (content: string, level: number) => string;
	field: (owner: Data, key: string) => string;
	renderBlocks: (value: unknown) => string;
	image: PdfAssessmentContext["image"];
	equation: (latex: unknown, alt: unknown) => string;
	link: (target: unknown, label: string) => string;
	fail: (message: string) => never;
	warn: (message: string) => void;
	chart?: { vars: Record<string, string>; font: string };
}
const copy = {
	en: {
		before: "Before",
		after: "After",
		front: "Front",
		back: "Back",
		transcript: "Transcript",
		media: "Media",
		resource: "Companion resource",
		open: "Open resource",
		local: "Available in the interactive course; its contents are not included in this PDF.",
		mediaOnly:
			"This media has no authored transcript. View or listen to it in the interactive course.",
		chart: "Chart data is also shown as a table because the chart has no text description.",
		category: "Category",
		values: "Values",
		location: "Position (% from left, % from top)",
		note: "Note",
		info: "Information",
		warning: "Warning",
		success: "Success",
		tip: "Tip",
	},
	fr: {
		before: "Avant",
		after: "Après",
		front: "Recto",
		back: "Verso",
		transcript: "Transcription",
		media: "Média",
		resource: "Ressource complémentaire",
		open: "Ouvrir la ressource",
		local: "Disponible dans le cours interactif; son contenu n’est pas inclus dans ce PDF.",
		mediaOnly:
			"Ce média ne comprend pas de transcription rédigée. Consultez-le dans le cours interactif.",
		chart:
			"Les données du graphique figurent aussi dans un tableau, car le graphique n’a pas de description textuelle.",
		category: "Catégorie",
		values: "Valeurs",
		location: "Position (% depuis la gauche, % depuis le haut)",
		note: "Note",
		info: "Information",
		warning: "Avertissement",
		success: "Réussite",
		tip: "Conseil",
	},
};
const record = (value: unknown): value is Data =>
	!!value && typeof value === "object" && !Array.isArray(value);
const hidden = (value: Data) =>
	value.hidden === true || value.hide === true || value.visible === false;

/** Static content only; the caller owns inclusion, assets, references, and assessment numbering. */
export function renderPdfContent(block: PraxityBlock, ctx: PdfContentContext): string {
	const { rich, field, fail, renderBlocks } = ctx;
	const data = block.data;
	const strings = ctx.locale.startsWith("fr") ? copy.fr : copy.en;
	const text = (value: unknown): string =>
		typeof value === "string" && value.trim() ? value : fail("Expected nonempty printable text.");
	const requiredAlt = (value: unknown): string =>
		typeof value === "string" && value.trim()
			? value
			: fail("Informative images need alternative text.");
	const items = (value: unknown): Data[] =>
		Array.isArray(value) && value.every(record)
			? value.filter((item) => !hidden(item))
			: fail("Invalid content items.");
	const optional = (owner: Data, name: string) =>
		owner[name] === undefined || owner[name] === "" ? "" : (text(owner[name]), field(owner, name));
	const join = (...parts: string[]) => parts.filter(Boolean).join("\n\n");
	const eyebrow = (label: string) => `#px-eyebrow[${label}]`;
	const content = (values: string[]) =>
		values.length ? `(${values.map((value) => `[${value}]`).join(", ")},)` : "()";
	const pairs = (values: string[][]) =>
		values.length ? `(${values.map((pair) => content(pair)).join(", ")},)` : "()";
	// Accordion, tab and step labels are headings in the published course; keep them in the outline.
	const itemLabel = (item: Data) =>
		!item.label
			? ""
			: Number.isInteger(data.headingLevel)
				? heading(field(item, "label"), data.headingLevel)
				: `#strong[${field(item, "label")}]`;
	const panel = (item: Data) => join(itemLabel(item), renderBlocks(item.children));
	// A block title always travels with the content it introduces.
	const title = (owner: Data, name = "title") =>
		owner[name] ? `#block(sticky: true)[#strong[${optional(owner, name)}]]` : "";
	const caption = (owner: Data, name = "caption") =>
		owner.captionEnabled === false ? "" : optional(owner, name);
	const heading = (content: string, level: unknown) => {
		if (!Number.isInteger(level) || Number(level) < 1 || Number(level) > 6)
			fail("Heading level must be 1–6.");
		return ctx.heading?.(content, Number(level)) ?? `#heading(level: ${level})[${content}]`;
	};
	const image = (src: unknown, alt: unknown, decorative = false) =>
		ctx.image(text(src), decorative && !alt ? "" : requiredAlt(alt), { decorative });
	const resource = (target: unknown, label: string): string => {
		const url = text(target);
		if (
			/^(?:praxity-asset:|asset:)/i.test(url) ||
			(!/^[a-z][a-z\d+.-]*:/i.test(url) && !url.startsWith("#") && !url.startsWith("//"))
		) {
			ctx.warn(strings.local);
			return join(label, escapeTypst(strings.local));
		}
		return ctx.link(url, label);
	};
	const table = (owner: Data): string => {
		if (
			!Array.isArray(owner.headers) ||
			!owner.headers.length ||
			!owner.headers.every((cell) => typeof cell === "string")
		)
			fail("Table needs string cells and a first row.");
		const headers = owner.headers as string[];
		if (headers.length > 8)
			fail(
				"This table has too many columns for readable PDF output. Split it into smaller tables.",
			);
		if (
			!Array.isArray(owner.rows) ||
			!owner.rows.every(
				(row) =>
					Array.isArray(row) &&
					row.length === headers.length &&
					row.every((cell) => typeof cell === "string"),
			)
		)
			fail("Table rows must have the same number of string cells as the first row.");
		const rows = owner.rows as string[][];
		if (
			owner.columnAlignments !== undefined &&
			(!Array.isArray(owner.columnAlignments) ||
				owner.columnAlignments.length !== headers.length ||
				!owner.columnAlignments.every((a) => ["left", "center", "right"].includes(String(a))))
		)
			fail("Invalid table column alignments.");
		const alignments =
			(owner.columnAlignments as string[] | undefined) ?? headers.map(() => "left");
		const headerRow = owner.highlightHeaderRow !== false;
		const headerCol = owner.highlightHeaderCol === true;
		const cell = (col: number, row?: number): string => {
			const html = getInlineField(owner, row === undefined ? ["headers", col] : ["rows", row, col]);
			const words = [...new Set(stripHtml(html).split(/\s+/).filter(Boolean))];
			const content = `#layout(size => { for word in (${words.map(typstString).join(", ")}${words.length ? "," : ""}) { if calc.max(measure(text(weight: "bold", word)).width, measure(raw(word)).width) > size.width { panic("Table cell has text wider than its column. Shorten unbroken words or split the table.") } }; [${rich(html)}] })`;
			return headerCol && col === 0
				? `pdf.header-cell(scope: "${row === undefined && headerRow ? "both" : "row"}")[${content}]`
				: `[${content}]`;
		};
		const first = headers.map((_, i) => cell(i)).join(", ");
		return join(
			title(owner),
			`#{${headerRow ? ' show table.cell.where(y: 0): set text(weight: "bold");' : ""} table(columns: (${headers.map(() => "1fr").join(", ")},), align: (${alignments.join(", ")},), inset: 6pt, ${headerRow ? `fill: (_, y) => if y == 0 { px-tint }, table.header(repeat: true, ${first})` : first}${rows.length ? ", " : ""}${rows.flatMap((row, ri) => row.map((_, ci) => cell(ci, ri))).join(", ")}) }`,
			caption(owner),
		);
	};
	switch (block.type) {
		case "text":
			return rich(data.content);
		case "heading":
			return join(optional(data, "kicker"), heading(rich(data.content), data.level));
		case "note": {
			const tone =
				data.tone ??
				(typeof data.color === "string" && ["warning", "success"].includes(data.color)
					? data.color
					: "note");
			if (!["note", "info", "warning", "success", "tip"].includes(String(tone)))
				fail("Unsupported note tone.");
			return `#px-callout(${typstString(String(tone))})[${escapeTypst(strings[tone as "note"])}][${join(title(data), rich(data.content))}]`;
		}
		case "quote":
			return join(
				rich(data.text ?? data.content),
				optional(data, "speaker") || optional(data, "attribution"),
				optional(data, "work"),
				data.sourceUrl ? ctx.link(data.sourceUrl, escapeTypst(strings.open)) : "",
			);
		case "dialogue":
			return renderDialogueToTypst(data, rich, ctx.locale);
		case "image":
			return join(
				ctx.image(
					text(data.src),
					(block.a11y?.decorative ?? data.decorative) === true &&
						!(block.a11y?.altText ?? data.altText ?? data.alt)
						? ""
						: requiredAlt(block.a11y?.altText ?? data.altText ?? data.alt),
					{
						decorative: (block.a11y?.decorative ?? data.decorative) === true,
						size: data.width,
						alignment: data.alignment,
					},
				),
				caption(data),
			);
		case "heroCover":
			return join(
				optional(data, "kicker"),
				heading(field(data, "title"), data.level ?? 1),
				optional(data, "subtitle"),
				data.imageSrc ? image(data.imageSrc, data.imageAlt, data.decorative === true) : "",
			);
		case "imageComparison": {
			if (!record(data.beforeImage) || !record(data.afterImage))
				fail("Image comparison needs both images.");
			const before = data.beforeImage as Data,
				after = data.afterImage as Data;
			return join(
				eyebrow(optional(data, "beforeLabel") || escapeTypst(strings.before)),
				image(before.src, before.altText, before.decorative === true),
				caption(data, "beforeCaption"),
				eyebrow(optional(data, "afterLabel") || escapeTypst(strings.after)),
				image(after.src, after.altText, after.decorative === true),
				caption(data, "afterCaption"),
				caption(data),
			);
		}
		case "labeledGraphic": {
			const labels = items(data.labels);
			const regions = labels.map((label, i) => {
				if (
					![label.x, label.y].every(
						(v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100,
					)
				)
					fail("Graphic label positions must be percentages from 0 to 100.");
				return {
					shape: "ellipse" as const,
					coords: [label.x as number, label.y as number, 2],
					label: String(i + 1),
				};
			});
			return join(
				ctx.image(text(data.imageSrc), requiredAlt(data.imageAlt), { regions }),
				...labels.map((label, i) =>
					join(
						`#strong[${i + 1}. ${field(label, "title")}]`,
						optional(label, "body") || optional(label, "description"),
						`${escapeTypst(strings.location)}: ${label.x}, ${label.y}`,
					),
				),
			);
		}
		case "video":
		case "audio": {
			let src = data.src;
			if (record(data.source)) {
				if (data.source.type !== "url")
					fail("Hosted video sources need an explicit viewing URL for PDF export.");
				src = data.source.src;
			}
			const transcript = data.transcriptOverride ?? data.transcript;
			if (transcript !== undefined && typeof transcript !== "string")
				fail("Media transcript must be authored text.");
			const hasTranscript = typeof transcript === "string" && transcript.trim().length > 0;
			if (!hasTranscript) ctx.warn(strings.mediaOnly);
			return join(
				title(data),
				caption(data),
				resource(src, escapeTypst(strings.media)),
				hasTranscript
					? join(
							eyebrow(escapeTypst(strings.transcript)),
							(transcript as string).split(/\r?\n/).map(escapeTypst).join("#linebreak()\n"),
						)
					: escapeTypst(strings.mediaOnly),
			);
		}
		case "document":
			return join(
				resource(data.url ?? data.src, optional(data, "title") || escapeTypst(strings.resource)),
				optional(data, "description"),
				caption(data),
			);
		case "resourceEntry": {
			if (!["file", "link", "lessonPdf"].includes(String(data.resourceType)))
				fail("Unsupported companion resource type.");
			const label = optional(data, "title") || escapeTypst(strings.resource);
			if (data.resourceType === "link")
				return join(ctx.link(data.url, label), optional(data, "description"));
			ctx.warn(strings.local);
			return join(label, optional(data, "description"), escapeTypst(strings.local));
		}
		case "embed":
			return join(
				resource(data.src, optional(data, "title") || escapeTypst(strings.open)),
				optional(data, "description"),
				caption(data),
			);
		case "button": {
			if (data.action !== undefined && !["link", "goToPage"].includes(String(data.action)))
				fail("Branching actions need a static version before PDF export.");
			const target = data.action === "goToPage" ? `#${text(data.targetPageId)}` : data.href;
			return resource(target, field(data, "text"));
		}
		case "table":
			return table(data);
		case "chart": {
			if (
				data.chartConfig !== undefined &&
				(!record(data.chartConfig) || Object.keys(data.chartConfig).length)
			)
				fail("Raw chart configuration needs an explicit PDF data mapping.");
			if (!record(data.data)) fail("Chart needs source data.");
			const chartData = data.data as Data;
			if (
				!Array.isArray(chartData.labels) ||
				!chartData.labels.length ||
				!chartData.labels.every((label) => typeof label === "string")
			)
				fail("Invalid chart labels.");
			const labels = chartData.labels as string[],
				series = items(chartData.series);
			if (!series.length) fail("Chart needs at least one data series.");
			for (const entry of series)
				if (
					typeof entry.name !== "string" ||
					!Array.isArray(entry.values) ||
					entry.values.length !== labels.length ||
					!entry.values.every((v) => typeof v === "number" && Number.isFinite(v))
				)
					fail("Chart series must contain a finite number for every category.");
			const plain = (value: unknown) => (typeof value === "string" ? stripHtml(value).trim() : "");
			const described = plain(data.altText) || plain(data.description);
			const sorted = sortChartData(
				labels.map(plain),
				series.map((entry) => ({ name: plain(entry.name), values: entry.values as number[] })),
				data.sortOrder as ChartBlockData["sortOrder"],
				Number.isInteger(data.sortSeriesIndex) ? (data.sortSeriesIndex as number) : 0,
			);
			const alt =
				described ||
				`${plain(data.chartType) || "bar"} chart${plain(data.title) ? `: ${plain(data.title)}` : ""}`;
			// The published static SVG, with theme colours and the body font made concrete for Typst.
			const svg = (markup: string) => {
				let resolved = markup;
				for (let previous = ""; previous !== resolved; ) {
					previous = resolved;
					resolved = resolved.replace(
						/var\(--([\w-]+)(?:,\s*([^()]*))?\)/g,
						(_match, name: string, fallback?: string) =>
							ctx.chart?.vars[name] ?? fallback?.trim() ?? "#1a1a1a",
					);
				}
				// Outlines only separate light fills from white paper; on dense bar charts they read as noise.
				resolved = resolved.replace(/<rect\b[^>]*>/g, (rect) => {
					const fill = / fill="(#[0-9a-fA-F]{6})"/.exec(rect)?.[1];
					return fill && contrastRatio(fill, "#ffffff") >= 3
						? rect.replace(/ stroke(?:-width)?="[^"]*"/g, "")
						: rect;
				});
				return typstString(
					resolved.replace(
						/ style="[^"]*"/,
						` font-family="${(ctx.chart?.font ?? "Libertinus Serif").replace(/["&<>]/g, "")}" font-size="16"`,
					),
				);
			};
			const [wide, medium, compact] =
				data.chartType === "radar"
					? Array(3).fill(svg(renderRadarChartSvg(sorted.labels, sorted.series, alt)))
					: ([720, 440, 280] as const).map((width) =>
							svg(
								renderCartesianChartSvg(
									data as unknown as ChartBlockData,
									sorted.labels,
									sorted.series,
									alt,
									width,
									plain,
								),
							),
						);
			// Pick the variant whose built-in text size suits the printed width.
			const visual = `#layout(size => image(bytes(if size.width > 400pt { ${wide} } else if size.width > 250pt { ${medium} } else { ${compact} }), format: "svg", width: 100%, alt: ${typstString(alt)}))`;
			if (described)
				return join(
					title(data),
					optional(data, "subtitle"),
					optional(data, "description"),
					visual,
					caption(data),
				);
			// Without authored alternative text the source data stays in print as the text equivalent.
			ctx.warn(strings.chart);
			const headers = [
				typeof data.xAxisLabel === "string" ? data.xAxisLabel : strings.category,
				...series.map((entry) => entry.name as string),
			];
			const rows = labels.map((label, i) => [
				label,
				...series.map((entry) => String((entry.values as number[])[i])),
			]);
			return join(
				title(data),
				optional(data, "subtitle"),
				visual,
				escapeTypst(strings.chart),
				// Long, narrow source tables sit in two balanced halves, each with its header, when
				// every word still fits the halved columns; otherwise the single table prints.
				headers.length <= 3 && rows.length > 12 && rows.length <= 80
					? `#px-split-table((${[...new Set([...headers, ...rows.flat()].flatMap((cell) => cell.split(/\s+/)).filter(Boolean))].map(typstString).join(", ")},), ${headers.length}, [${table({ headers, rows, highlightHeaderCol: true })}], [${table({ headers, rows: rows.slice(0, Math.ceil(rows.length / 2)), highlightHeaderCol: true })}], [${table({ headers, rows: rows.slice(Math.ceil(rows.length / 2)), highlightHeaderCol: true })}])`
					: table({ headers, rows, highlightHeaderCol: true }),
				caption(data),
			);
		}
		case "stats":
			return join(
				...items(data.items).map((item) => `${field(item, "value")}: ${field(item, "label")}`),
				caption(data),
			);
		case "code": {
			if (typeof data.code !== "string") fail("Code must be literal text.");
			const code = data.code as string;
			return join(
				title(data),
				`#block(width: 100%, fill: px-tint, inset: 10pt, radius: 3pt, { set text(size: 10pt); layout(size => { let source = ${typstString(code)}; for line in source.split("\\n") { if measure(raw(line)).width > size.width { panic("Code line exceeds the PDF writing width. Wrap the source line before exporting.") } }; raw(source, block: true${data.language ? `, lang: ${typstString(text(data.language))}` : ""}) }) })`,
			);
		}
		case "equation":
			return ctx.equation(
				data.latex,
				block.a11y?.ariaLabel ?? block.a11y?.altText ?? data.altText ?? data.alt,
			);
		case "columns": {
			// Authored columns stay side by side, in their published proportions; a label stays with
			// its column's content, and comparisons keep a dividing rule.
			const columns = items(data.items);
			const share = (item: Data) =>
				typeof item.width === "number" && item.width > 0 ? item.width : 1;
			return join(
				title(data),
				`#px-columns(${data.preset === "comparison"}, (${columns.map((item) => `${share(item)}fr`).join(", ")},), ${content(columns.map((item) => join(item.label ? `#block(sticky: true)[#strong[${field(item, "label")}]]` : "", renderBlocks(item.children))))})`,
			);
		}
		case "accordion":
			return join(
				title(data),
				`#px-panels(${typstString(String(data.accordionStyle ?? "default"))}, ${content(items(data.items).map(panel))})`,
			);
		case "tabs":
			return join(
				title(data),
				data.orientation === "vertical"
					? `#px-rows(${pairs(items(data.items).map((item) => [itemLabel(item), renderBlocks(item.children)]))})`
					: `#px-panels("outline", ${content(items(data.items).map(panel))})`,
			);
		case "sequence": {
			const steps = items(data.items);
			if (data.variant === "timeline")
				return join(
					title(data),
					`#px-timeline(${data.orientation === "horizontal" && steps.length <= 5}, ${content(steps.map(panel))})`,
				);
			return join(
				title(data),
				data.variant === "none" || data.variant === "plain"
					? `#px-panels("none", ${content(steps.map(panel))})`
					: `#px-steps(${content(steps.map(panel))})`,
			);
		}
		case "card": {
			const style = String(data.style ?? "outline");
			const layout = String(data.layout ?? "grid");
			const single = ["single", "slides"].includes(layout);
			const cardItems = items(data.items);
			const groupTitle =
				data.headings === false
					? title(data)
					: data.title && (cardItems.length !== 1 || cardItems[0].label !== data.title)
						? heading(field(data, "title"), data._headingLevel ?? 2)
						: "";
			const cards = cardItems.map((item) => {
				const label = optional(item, "label");
				const renderedLabel = label
					? data.headings !== false
						? `#{show heading: set block(above: 0pt, below: 0.25em); [${heading(`#text(font: px-body-font, weight: 600)[${label}]`, 4)}]}`
						: `#strong[${label}]`
					: "";
				const front = renderBlocks(item.front),
					back = renderBlocks(item.back);
				return {
					label: renderedLabel,
					face:
						front && back
							? `#px-flip(${single}, ${typstString(strings.front)}, [${front}], ${typstString(strings.back)}, [${back}])`
							: front || back,
				};
			});
			if (layout === "rows")
				return join(groupTitle, `#px-rows(${pairs(cards.map((card) => [card.label, card.face]))})`);
			const columns =
				single || !Number.isInteger(data.columns)
					? single
						? 1
						: 2
					: Math.min(4, Number(data.columns));
			return join(
				groupTitle,
				`#px-cards(${typstString(style)}, ${columns}, ${content(cards.map((card) => join(card.label, card.face)))})`,
			);
		}
		case "checklist":
			return join(title(data), ...items(data.items).map((item) => `☐ ${field(item, "text")}`));
		case "signature":
			return join(
				field(data, "label"),
				optional(data, "sublabel"),
				"#box(width: 8cm)[#line(length: 100%)]",
			);
		case "divider":
			return join(optional(data, "label"), "#line(length: 100%, stroke: 0.5pt + px-rule)");
		case "pageBreak":
			return "#pagebreak(weak: true)";
		case "blockBreak":
		case "variable":
			return "";
		case "logic":
			return fail("Logic needs a static version before PDF export.");
		case "selfCheck":
			// Grammar refuses publication first; this guards direct callers until a PDF form exists.
			return fail("Self-check can’t be exported to PDF yet.");
		default:
			return fail(`Unsupported PDF content block: ${block.type}.`);
	}
}
