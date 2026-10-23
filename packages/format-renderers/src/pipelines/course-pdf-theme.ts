import {
	DEFAULT_TYPOGRAPHY,
	findFontEntry,
	normalizeTypography,
} from "@praxity/grammar/src/font-catalog.ts";
import type { DesignVariants } from "@praxity/grammar/src/types.ts";
import { colorToHex, ensureContrastAll } from "@praxity/shared-blocks/color-math";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import { typstString } from "../renderers/typst/common.ts";

export const coursePdfTextLayout = {
	bodySizePt: 12,
	slideMeasureMm: 120,
	questionInsetPt: 14,
	enumIndentEm: 0.4,
	enumBodyIndentEm: 0.5,
};

const PAPER = "#ffffff";
const FALLBACK = {
	serif: "Libertinus Serif",
	"sans-serif": "Inter",
	monospace: "DejaVu Sans Mono",
};

function blend(hex: string, alpha: number): string {
	const channel = (at: number) =>
		Math.round(Number.parseInt(hex.slice(at, at + 2), 16) * alpha + 255 * (1 - alpha))
			.toString(16)
			.padStart(2, "0");
	return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * Print mapping of the course theme: light-mode tokens on white paper, text roles
 * re-checked for contrast, and only theme fonts that the engine directory supplies.
 */
export function coursePdfTheme(
	design: Record<string, unknown> | undefined,
	availableFonts: ReadonlySet<string>,
): {
	preamble: string;
	fonts: Set<string>;
	/** Concrete values for the published chart SVG, which Typst cannot resolve from CSS variables. */
	chart: { vars: Record<string, string>; font: string };
} {
	const tokens = resolveDesignTokens((design ?? {}) as unknown as DesignVariants, "light");
	const token = (name: string, fallback: string) =>
		colorToHex(tokens[`--praxity-color-${name}`] ?? "") ?? fallback;
	// Tints are printed on white, so derive them from the paper-safe accent, not a dark theme surface.
	const tint = blend(ensureContrastAll(token("accent", "#1f4d7a"), 4.5, PAPER), 0.1);
	const ink = ensureContrastAll(token("text", "#1a1a1a"), 7, PAPER, tint);
	const text = (name: string) => ensureContrastAll(token(name, ink), 4.5, PAPER, tint);
	const fonts = new Set<string>();
	const typography = normalizeTypography(design?.typography, DEFAULT_TYPOGRAPHY);
	const families = (list: string[] | undefined, generic: keyof typeof FALLBACK) => {
		const selected = (list ?? []).flatMap((family) => {
			const slug = findFontEntry(family)?.fontsource?.slice("@fontsource/".length);
			if (!slug || !availableFonts.has(slug)) return [];
			fonts.add(slug);
			return [family];
		});
		const fallback =
			generic === "monospace" || (list ?? []).includes("monospace")
				? FALLBACK.monospace
				: (list ?? []).includes("serif") || !availableFonts.has("inter")
					? FALLBACK.serif
					: FALLBACK["sans-serif"];
		if (fallback === "Inter") fonts.add("inter");
		return [...new Set([...selected, fallback, FALLBACK.serif])];
	};
	const fontList = (list: string[]) => `(${list.map(typstString).join(", ")},)`;
	const bodyFonts = families(typography.body.fontFamily, "sans-serif");
	const weight = (name: string, fallback: number) => {
		const value = Number(tokens[`--praxity-font-weight-${name}`]);
		return Number.isInteger(value) && value >= 100 && value <= 900 ? value : fallback;
	};
	const scale = (name: string, fallback: number, min: number, max: number) => {
		const value = Number.parseFloat(tokens[name] ?? "");
		return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
	};
	// Web line heights are screen-generous; 1.6 maps to Typst's print leading of 0.7em.
	const leading = (0.7 * scale("--praxity-line-height-base", 1.6, 1.3, 2)) / 1.6;
	const spacing = 1.2 * scale("--praxity-block-spacing-scale", 1, 0.7, 1.6);
	const accent = text("accent");
	const chartVars: Record<string, string> = {
		"praxity-color-text": ink,
		"praxity-color-text-muted": blend(ink, 0.75),
		"praxity-color-border": blend(ink, 0.2),
		"praxity-color-accent": accent,
	};
	for (let series = 1; series <= 6; series++) {
		const color = colorToHex(tokens[`--praxity-chart-${series}`] ?? "");
		if (color) chartVars[`praxity-chart-${series}`] = color;
	}
	return {
		fonts,
		chart: { vars: chartVars, font: bodyFonts[0] as string },
		preamble: `#let px-ink = rgb("${ink}")
#let px-accent = rgb("${accent}")
#let px-tint = rgb("${tint}")
#let px-rule = rgb("${blend(ink, 0.25)}")
#let px-soft = rgb("${ensureContrastAll(blend(ink, 0.82), 7, PAPER)}")
#let px-line = rgb("${blend(ink, 0.6)}")
#let px-tones = (note: px-accent, info: px-accent, tip: px-accent, success: rgb("${text("success-on-light")}"), warning: rgb("${text("warning-on-light")}"))
#let px-heading-font = ${fontList(families(typography.headings.fontFamily, "sans-serif"))}
#let px-body-font = ${fontList(bodyFonts)}
#set text(font: ${fontList(bodyFonts)}, weight: ${weight("body", 400)}, size: ${coursePdfTextLayout.bodySizePt}pt, fill: px-ink)
#set par(leading: ${leading.toFixed(2)}em, spacing: ${spacing.toFixed(2)}em)
#show raw: set text(font: ${fontList(families(typography.code?.fontFamily, "monospace"))})
#show heading: set text(font: px-heading-font, weight: ${weight("heading", 700)}, fill: rgb("${text("heading")}"), size: 1em)
#show heading: set block(above: 1.7em, below: 0.8em)
#show heading.where(level: 1): it => block(width: 100%, below: 1.2em, stroke: (bottom: 0.75pt + px-rule), inset: (bottom: 0.5em))[#text(size: 1.75em, fill: px-accent)[#it]]
#show title: set text(font: px-heading-font, weight: ${weight("heading", 700)}, size: 2.2em, fill: px-ink)
#show link: it => text(fill: px-accent, if type(it.dest) == str { underline(it) } else { it })
#set list(marker: text(fill: px-accent)[•], indent: 0.4em)
#set enum(indent: ${coursePdfTextLayout.enumIndentEm}em, body-indent: ${coursePdfTextLayout.enumBodyIndentEm}em)
#set line(stroke: 0.75pt + px-line)
#set table(stroke: 0.5pt + px-rule)
#show table.cell: set par(leading: 0.55em)
// Notes follow Chicago's published style: flush left, full-size number, period and a fixed gap,
// with wrapped lines hanging clear of the number. Low-vision print guidance sets no smaller
// size for notes, so they stay at body size and rely on position and the rule for hierarchy.
#set footnote.entry(indent: 0pt, gap: 0.8em, clearance: 1em, separator: block(below: 0.6em, line(length: 25%, stroke: 0.5pt + px-ink)))
#show footnote.entry: set par(leading: 0.6em, spacing: 0.75em, justify: false)
#show footnote.entry: it => context {
  let location = it.note.location()
  let number = numbering("1.", ..counter(footnote).at(location))
  let space = 0.5em
  par(first-line-indent: 0pt, hanging-indent: measure(number).width + space, link(location, number) + h(space) + it.note.body)
}
#let px-eyebrow(body) = text(size: 9.5pt, weight: "bold", fill: px-accent, tracking: 0.04em, body)
#let px-callout(tone, label, body) = block(width: 100%, breakable: true, fill: px-tint, stroke: (left: 3pt + px-tones.at(tone)), inset: (left: 14pt, rest: 10pt), radius: (right: 3pt))[#set par(spacing: 0.5em)
#px-eyebrow(label)

#body]
#let px-break = block(above: 2em, below: 1.2em, line(length: 100%, stroke: 0.5pt + px-rule))
// Narration units are (paragraph, content) pairs; sentences of one paragraph rejoin with spaces.
#let px-regroup(units) = {
  let paragraphs = ()
  let last = none
  for (index, piece) in units {
    if index == last { paragraphs.at(-1) = paragraphs.at(-1) + (piece,) } else { paragraphs.push((piece,)) }
    last = index
  }
  paragraphs.map(p => p.join(" ")).join(parbreak())
}
#let px-split-table(words, count, full, first, second) = layout(size => {
  let cell = (size.width - 1.2em.to-absolute()) / 2 / count - 14pt
  if words.all(word => measure(text(weight: "bold", word)).width <= cell) { grid(columns: (1fr, 1fr), column-gutter: 1.2em, first, second) } else { full }
})
// Slide text keeps a readable measure (about 70 characters); figures, tables and code span the page.
#let px-parts(parts) = for (wide, sticky, body) in parts {
  if wide { body } else { block(width: ${coursePdfTextLayout.slideMeasureMm}mm, sticky: sticky, body) }
}
// Narration follows its slide as one framed stream: accent rules on both edges repeat on every
// page fragment, an upright label names it, and the script stays at body size in two columns.
#let px-slide(label, parts, units) = {
  px-parts(parts)
  // Lighter than the slide: 11pt in a softer (still at least 7:1) ink, open leading and air
  // inside and around the frame, so the script reads as a supplement rather than a wall of text.
  block(width: 100%, breakable: true, above: 8mm, below: 8mm, stroke: (left: 1.25pt + px-accent, right: 1.25pt + px-accent), inset: (x: 5mm, y: 3.5mm))[
    #set text(size: 11pt, fill: px-soft)
    #set par(leading: 0.8em, spacing: 1.1em)
    #block(sticky: true, below: 3mm, text(size: 12pt, weight: "bold", fill: px-accent, label))
    #layout(size => {
      let gutter = 9mm
      // Break columns at the measured midpoint: balanced on one sheet, and across a page break the
      // text still fills left then right, so visual and reading order agree. No page position is
      // read, so the layout always converges.
      let width = (size.width - gutter) / 2
      let height(items) = measure(block(width: width, px-regroup(items))).height
      let split = if units.len() < 2 { units.len() } else {
        range(1, units.len()).sorted(key: count => calc.max(height(units.slice(0, count)), height(units.slice(count)))).first()
      }
      columns(2, gutter: gutter, [#px-regroup(units.slice(0, split))#if split < units.len() [#colbreak()#px-regroup(units.slice(split))]])
    })
  ]
}
// Authored wrap: the image is placed at its side (first in reading order) and following blocks
// sit beside it while they fit its height; the rest continues below at the text measure.
// Wrap units are (list item?, content): consecutive items join with no break to stay one list.
#let px-flow(units) = {
  let previous = false
  for (index, (item, body)) in units.enumerate() {
    if index > 0 and not (item and previous) { parbreak() }
    body
    previous = item
  }
}
#let px-float(side, share, picture, flow) = layout(size => {
  let gap = 6mm
  let width = size.width * share
  let figure = block(width: width, picture)
  let tall = measure(figure).height
  let narrow = size.width - width - gap
  let height(count) = measure(block(width: narrow, px-flow(flow.slice(0, count)))).height
  let low = calc.min(1, flow.len())
  let high = flow.len()
  while low < high {
    let middle = calc.ceil((low + high) / 2)
    if height(middle) <= tall + 2em.to-absolute() { low = middle } else { high = middle - 1 }
  }
  let used = if low == 0 { 0pt } else { height(low) }
  // When the next unit cannot start beside the image, a small leftover gap reads as a break in
  // the text; scale the image (keeping its side and the text column) to end with the text.
  let fitted = if low < flow.len() and used < tall and tall - used <= tall * 0.25 { used / tall } else { 1 }
  let figure = if fitted < 1 { block(width: width * fitted, picture) } else { figure }
  let tall = measure(figure).height
  block(width: 100%, breakable: used > tall, below: 0.7em, {
    place(top + side, figure)
    pad(..if side == left { (left: width + gap) } else { (right: width + gap) }, px-flow(flow.slice(0, low)))
    v(calc.max(0pt, tall - used))
  })
  if low < flow.len() { block(width: ${coursePdfTextLayout.slideMeasureMm}mm, above: 0.7em, px-flow(flow.slice(low))) }
})
// Interactive containers print expanded. Fills map to rules to save ink; primary and secondary
// surfaces keep an accent rule.
#let px-surface(style) = if style == "none" { none } else if style in ("primary", "secondary", "accent") { 0.75pt + px-accent } else { 0.75pt + px-rule }
#let px-panels(style, panels) = {
  let divided = panels.map(body => block(width: 100%, breakable: true, inset: (y: 0.45em), body)).join(line(length: 100%, stroke: 0.5pt + px-rule))
  if style == "none" { panels.map(body => block(width: 100%, breakable: true, body)).join() }
  else if style in ("default", "contained", "separated") { block(width: 100%, breakable: true, stroke: (y: 0.5pt + px-rule), divided) }
  else { block(width: 100%, breakable: true, stroke: px-surface(style), radius: 4pt, inset: (x: 10pt, y: 2pt), divided) }
}
#let px-rows(rows) = grid(columns: (30%, 1fr), column-gutter: 6mm, inset: (x: 0pt, y: 0.6em), stroke: (x, y) => (top: 0.5pt + px-rule, bottom: if y == rows.len() - 1 { 0.5pt + px-rule }), ..rows.map(row => (block(sticky: true, row.at(0)), row.at(1))).flatten())
#let px-steps(steps) = grid(columns: (2em, 1fr), column-gutter: 0.7em, row-gutter: 1em, ..steps.enumerate().map(((index, body)) => (box(width: 1.7em, height: 1.7em, radius: 50%, stroke: 1pt + px-accent, align(center + horizon, text(size: 0.85em, weight: "bold", fill: px-accent, str(index + 1)))), body)).flatten())
#let px-timeline(across, steps) = if across {
  grid(columns: (1fr,) * steps.len(), ..steps.map(body => block(width: 100%, stroke: (top: 1.5pt + px-rule), inset: (top: 1em, right: 4mm), { place(top + left, dy: -1em - 4pt, circle(radius: 4pt, fill: px-accent)); body })))
} else {
  for (index, body) in steps.enumerate() {
    let last = index == steps.len() - 1
    block(width: 100%, breakable: true, above: 0pt, below: if last { 1.2em } else { 0pt }, inset: (left: 16pt, bottom: if last { 0pt } else { 1em }), stroke: (left: if last { none } else { 1.5pt + px-rule }), { place(top + left, dx: -16pt - 4pt, dy: 0.3em, circle(radius: 4pt, fill: px-accent)); body })
  }
}
#let px-cards(style, columns, cards) = grid(columns: (1fr,) * columns, column-gutter: 4mm, row-gutter: 4mm, stroke: px-surface(style), inset: if style == "none" { 0pt } else { 10pt }, ..cards.map(card => grid.cell(breakable: false, card)))
#let px-flip(across, front-label, front, back-label, back) = if across {
  grid(columns: (1fr, 1fr), column-gutter: 8mm, stroke: (x, y) => if x > 0 { (left: (paint: px-rule, thickness: 0.5pt, dash: "dashed")) }, inset: (x: 0pt), [#px-eyebrow(front-label)

#front], pad(left: 4mm)[#px-eyebrow(back-label)

#back])
} else [#px-eyebrow(front-label)

#front
#line(length: 100%, stroke: (paint: px-rule, thickness: 0.5pt, dash: "dashed"))
#px-eyebrow(back-label)

#back]
#let px-columns(comparison, widths, columns) = grid(columns: widths, column-gutter: if comparison { 0pt } else { 6mm }, inset: if comparison { (x: 4mm) } else { 0pt }, stroke: if comparison { (x, y) => if x > 0 { (left: 0.5pt + px-rule) } } else { none }, ..columns)
#let px-question(body) = block(width: 100%, breakable: true, above: 2em, below: 2em, stroke: (left: 2pt + px-rule), inset: (left: ${coursePdfTextLayout.questionInsetPt}pt, y: 2pt), if type(body) == function { layout(body) } else { body })
#let px-toc(target, body) = [#link(target, body)#pdf.artifact(box(width: 1fr, inset: (x: 0.4em), repeat(gap: 0.3em)[.]))#context counter(page).at(target).first()]`,
	};
}
