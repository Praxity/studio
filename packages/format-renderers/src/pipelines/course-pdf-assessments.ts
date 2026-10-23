import {
	decodeEscapes,
	fillBlankParts,
	inlineMarkdown,
	type PraxityBlock,
	resolveAssessmentDontKnow,
} from "@praxity/content-model";
import {
	getInlineField,
	isInlineProjectionMetadataKey,
} from "@praxity/content-model/inline-preparation";
import { hotspotGeometry } from "@praxity/shared-blocks/hotspot-geometry";
import { labelWithSeparator } from "@praxity/shared-blocks/i18n/label-separator";
import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import { escapeTypst } from "../renderers/typst/common.ts";

export interface PdfAssessmentContext {
	locale: string;
	includeAnswers: boolean;
	/** Journal responses get ruled writing space; other text responses retain their layout. */
	answerLines?: boolean;
	number: number;
	renderBlocks: (blocks: unknown) => string;
	rich: (html: unknown) => string;
	heading?: (content: string, level: number) => string;
	image: (
		src: string,
		alt: string,
		options?: {
			decorative?: boolean;
			/** Authored image size, printed at the published share of the text width. */
			size?: unknown;
			alignment?: unknown;
			regions?: Array<{ shape: "rect" | "ellipse" | "polygon"; coords: number[]; label?: string }>;
		},
	) => string;
	fail: (message: string) => never;
}

const copy = {
	en: {
		one: "Choose one answer.",
		many: "Select all that apply.",
		noAnswer: "No fixed answer supplied.",
		bank: "Word bank: use each entry once. Repeated entries may be used once per occurrence.",
		pattern: "Acceptance pattern",
		hint: "Hint",
		guidance: "Guidance",
		match: "Write the answer-bank letter beside each prompt.",
		answers: "Answer bank",
		order: "Write the item letters in the correct order.",
		categories: "Write a category beside each numbered item.",
		mark: "Mark the requested region on the image.",
		location: "Location (%): horizontal from left, vertical from top, radius",
		statement: "Statement",
	},
	fr: {
		one: "Choisissez une réponse.",
		many: "Sélectionnez toutes les réponses qui conviennent.",
		noAnswer: "Aucune réponse fixe fournie.",
		bank: "Banque de mots : utilisez chaque entrée une fois. Chaque occurrence répétée peut être utilisée une fois.",
		pattern: "Motif de réponse accepté",
		hint: "Indice",
		guidance: "Conseils",
		match: "Inscrivez la lettre de la banque de réponses à côté de chaque énoncé.",
		answers: "Banque de réponses",
		order: "Inscrivez les lettres des éléments dans le bon ordre.",
		categories: "Inscrivez une catégorie à côté de chaque élément numéroté.",
		mark: "Marquez la région demandée sur l’image.",
		location: "Position (%) : distance depuis la gauche, distance depuis le haut, rayon",
		statement: "Énoncé",
	},
};
type Data = Record<string, unknown>;
const isRecord = (value: unknown): value is Data =>
	!!value && typeof value === "object" && !Array.isArray(value);
function letter(index: number): string {
	let value = "";
	for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
		value = String.fromCharCode(65 + ((n - 1) % 26)) + value;
	return value;
}
// ponytail: deterministic rotation supplies one workbook order; exam variants need a separate contract.
const rotate = <T>(items: T[]): T[] =>
	items.length > 1 ? [...items.slice(1), items[0]] : [...items];

/** Only display fields reach body serializers. Solutions and feedback are rendered separately. */
export function renderPdfAssessment(
	block: PraxityBlock,
	ctx: PdfAssessmentContext,
): { body: string; answer?: () => string } {
	const { fail, rich, renderBlocks, includeAnswers } = ctx;
	const strings = ctx.locale.startsWith("fr") ? copy.fr : copy.en;
	const data =
		block.data._dontKnow === undefined
			? resolveAssessmentDontKnow([
					{
						...block,
						data: {
							...block.data,
							assessmentType:
								block.data.assessmentType ?? (block.data.response as { type?: string })?.type,
						},
					},
				])[0].data
			: block.data;
	const text = (value: unknown): string =>
		typeof value === "string" && value.trim() ? value : fail("Expected nonempty assessment text.");
	const requiredAlt = (value: unknown): string =>
		typeof value === "string" && value.trim()
			? value
			: fail("Informative images need alternative text.");
	const records = (value: unknown): Data[] =>
		Array.isArray(value) && value.length && value.every(isRecord)
			? value
			: fail("Invalid assessment records.");
	const values = (value: unknown): string[] =>
		Array.isArray(value) && value.every((v) => typeof v === "string" && v.trim())
			? value
			: fail("Invalid assessment choices or alternatives.");
	const display = (owner: Data, field: string) => {
		text(owner[field]);
		return rich(getInlineField(owner, field, false));
	};
	const known = (owner: Data, fields: string[]) => {
		for (const field of Object.keys(owner))
			if (!isInlineProjectionMetadataKey(field) && !fields.includes(field))
				fail(`Unsupported PDF assessment field: ${field}.`);
	};
	const rationale: Array<{ html?: string; render: () => string }> = [];
	const key: Array<() => string> = [];
	// Compare source HTML before rich() allocates unique PDF inline placeholders.
	// The grammar adapter wraps promoted option feedback in a single text paragraph.
	const feedbackHtml = (html: string) => {
		const paragraph = /^<p>([\s\S]*)<\/p>$/.exec(html);
		return paragraph && !/<\/?p\b/i.test(paragraph[1]) ? paragraph[1] : html;
	};
	const addRationale = (render: () => string, html?: string, preferBlock = false) => {
		const index = html ? rationale.findIndex((entry) => entry.html === html) : -1;
		if (index < 0) rationale.push({ html, render });
		else if (preferBlock) rationale[index] = { html, render };
	};
	const explain = (owner: Data) => {
		if (includeAnswers && owner.feedback)
			addRationale(
				() => display(owner, "feedback"),
				// Promotion uses interactive HTML; retain its block so links and definitions survive.
				typeof owner.feedback === "string"
					? feedbackHtml(getInlineField(owner, "feedback"))
					: undefined,
			);
	};
	const prompt: string[] = [];
	const stem = block.type === "rating" ? display(data, "label") : renderBlocks(data.stem);
	if (!stem) fail("A printable question stem is required.");
	const level = data.stemLevel;
	if (level !== undefined && (!Number.isInteger(level) || Number(level) < 1 || Number(level) > 6))
		fail("Question heading level must be 1–6.");
	prompt.push(
		level
			? (ctx.heading?.(`#px-eyebrow[Q${ctx.number}] ${stem}`, Number(level)) ??
					`#heading(level: ${level})[#px-eyebrow[Q${ctx.number}] ${stem}]`)
			: `#px-eyebrow[Q${ctx.number}] ${stem}`,
	);
	if (data.description) prompt.push(renderBlocks(data.description));
	if (block.type === "rating") {
		const scale =
			Array.isArray(data.scale) && data.scale.length
				? records(data.scale)
				: Array.from(
						{
							length:
								Number.isInteger(data.maxValue) &&
								Number(data.maxValue) > 0 &&
								Number(data.maxValue) <= 100
									? Number(data.maxValue)
									: fail("Invalid rating scale."),
						},
						(_, i) => ({ value: i + 1, label: String(i + 1) }),
					);
		if (
			scale.some((point) => typeof point.value !== "number" || !Number.isFinite(point.value)) ||
			new Set(scale.map((point) => point.value)).size !== scale.length
		)
			fail("Invalid rating values.");
		prompt.push(scale.map((point) => `○ ${point.value}: ${display(point, "label")}`).join("\n\n"));
	} else {
		if (!isRecord(data.response)) fail("Invalid assessment response.");
		const r = data.response as Data;
		switch (r.type) {
			case "choice": {
				known(r, [
					"type",
					"selectionMode",
					"inputMethod",
					"options",
					"display",
					"shuffle",
					"feedbackMode",
				]);
				let options = records(r.options);
				if (options.length < 2 || !["single", "multiple"].includes(String(r.selectionMode)))
					fail("Choice questions need at least two options and a selection mode.");
				if (r.selectionMode === "single" && options.filter((o) => o.isCorrect === true).length > 1)
					fail("Single-choice questions cannot have multiple correct answers.");
				if (r.shuffle === true) options = rotate(options);
				prompt.push(r.selectionMode === "multiple" ? strings.many : strings.one);
				for (const [index, option] of options.entries()) {
					known(option, ["id", "label", "isCorrect", "image", "feedback"]);
					if (option.isCorrect !== undefined && typeof option.isCorrect !== "boolean")
						fail("Invalid choice correctness.");
					const label = `${letter(index)}. ${display(option, "label")}`;
					prompt.push(
						`${r.selectionMode === "multiple" ? "☐" : "○"} ${label}${option.image ? `\n\n${ctx.image(text(option.image), text(option.label))}` : ""}`,
					);
					if (includeAnswers && option.isCorrect === true) {
						key.push(() => `${letter(index)}. ${display(option, "label")}`);
						explain(option);
					}
				}
				if (data._dontKnow === true)
					prompt.push(`○ ${escapeTypst(getStrings(ctx.locale).dontKnow)}`);
				break;
			}
			case "matching": {
				known(r, ["type", "inputMethod", "pairs", "distractors", "placeholder"]);
				const pairs = records(r.pairs);
				for (const pair of pairs) {
					known(pair, ["id", "matchId", "prompt", "correctMatch", "feedback"]);
					text(pair.prompt);
					text(pair.correctMatch);
				}
				let bank = rotate(
					[
						...new Set([
							...pairs.map((pair) => text(pair.correctMatch)),
							...values(r.distractors ?? []),
						]),
					].sort(),
				);
				if (bank.length > 1 && pairs.every((pair, i) => pair.correctMatch === bank[i]))
					bank = rotate(bank);
				prompt.push(
					strings.match,
					...pairs.map(
						(pair, i) =>
							`${i + 1}. ${display(pair, "prompt")} #h(1em) #box(width: 3cm)[#line(length: 100%)]`,
					),
					escapeTypst(strings.answers),
					...bank.map(
						(value, i) => `${letter(i)}. ${rich(getInlineField({ value }, "value", false))}`,
					),
				);
				if (includeAnswers)
					for (const [i, pair] of pairs.entries()) {
						key.push(
							() =>
								`${i + 1}. ${display(pair, "prompt")} → ${letter(bank.indexOf(text(pair.correctMatch)))}. ${display(pair, "correctMatch")}`,
						);
						explain(pair);
					}
				break;
			}
			case "sequence": {
				known(r, ["type", "inputMethod", "items"]);
				const items = records(r.items);
				for (const item of items) {
					known(item, ["id", "label", "correctPosition", "feedback"]);
					text(item.label);
				}
				const ordered = [...items].sort(
					(a, b) => Number(a.correctPosition) - Number(b.correctPosition),
				);
				if (ordered.some((item, i) => item.correctPosition !== i))
					fail("Sequence positions must cover zero through item count minus one.");
				const printed = rotate(ordered);
				prompt.push(
					strings.order,
					...printed.map((item, i) => `${letter(i)}. ${display(item, "label")}`),
					"#box(width: 8cm)[#line(length: 100%)]",
				);
				if (includeAnswers)
					for (const [i, item] of ordered.entries()) {
						key.push(() => `${i + 1}. ${letter(printed.indexOf(item))}. ${display(item, "label")}`);
						explain(item);
					}
				break;
			}
			case "categorize": {
				known(r, ["type", "categories"]);
				const categories = records(r.categories);
				const items: Array<{ value: string; category: Data; occurrence: number }> = [];
				for (const category of categories) {
					known(category, ["id", "name", "image", "imageAlt", "items", "itemIds"]);
					prompt.push(display(category, "name"));
					if (category.image)
						prompt.push(ctx.image(text(category.image), requiredAlt(category.imageAlt)));
					for (const value of values(category.items))
						items.push({ value, category, occurrence: items.length });
				}
				if (!items.length) fail("Categorize needs at least one item.");
				const printed = rotate(
					[...items].sort((a, b) =>
						a.value < b.value ? -1 : a.value > b.value ? 1 : a.occurrence - b.occurrence,
					),
				);
				prompt.push(strings.categories);
				for (const [i, item] of printed.entries()) {
					const label = `${i + 1}. ${rich(getInlineField(item, "value", false))}`;
					prompt.push(`${label} #h(1em) #box(width: 3cm)[#line(length: 100%)]`);
					if (includeAnswers)
						key.push(
							() =>
								`${i + 1}. ${rich(getInlineField(item, "value", false))} → ${display(item.category, "name")}`,
						);
				}
				break;
			}
			case "fillBlank": {
				known(r, ["type", "style", "wordBank", "template", "blanks", "placeholder"]);
				if (typeof r.template !== "string") fail("Invalid fill-blank template.");
				if (
					r.style !== undefined &&
					!["inline-inputs", "dropdown", "word-bank"].includes(String(r.style))
				)
					fail("Unsupported fill-blank style.");
				const parts = fillBlankParts(r.template as string);
				const blanks = records(r.blanks);
				if (parts.filter((part) => part.blank).length !== blanks.length)
					fail("Blank markers and answer records do not match.");
				let n = 0;
				prompt.push(
					parts
						.map((part) =>
							part.blank
								? `(${++n}) #box(width: 3cm)[#line(length: 100%)]`
								: part.text
										.split(/\r?\n[ \t]*\r?\n/)
										.map(
											(paragraph) =>
												`${/^\s/.test(paragraph) ? " " : ""}${rich(inlineMarkdown(paragraph).replace(/\r?\n/g, "<br>"))}${/\s$/.test(paragraph) ? " " : ""}`,
										)
										.join("\n\n"),
						)
						.join(""),
				);
				if (r.style === "word-bank")
					prompt.push(escapeTypst(strings.bank), values(r.wordBank).map(escapeTypst).join("; "));
				const used = new Map<string, number>();
				for (const [i, blank] of blanks.entries()) {
					known(blank, ["id", "answer", "answerSources", "alternatives", "choices"]);
					if (typeof blank.answer !== "string") fail("Invalid blank answer record.");
					const accepted = [blank.answer as string, ...values(blank.alternatives ?? [])];
					const sources =
						blank.answerSources === undefined ? accepted : values(blank.answerSources);
					if (sources.length !== accepted.length) fail("Invalid escaped answer records.");
					if (
						blank.answerSources !== undefined &&
						sources.some((source, index) => decodeEscapes(source) !== accepted[index])
					)
						fail("Escaped answer records do not match their decoded answers.");
					if (r.style === "dropdown" || r.style === "word-bank") {
						const choices = values(r.style === "dropdown" ? blank.choices : r.wordBank);
						if (!accepted.every((answer) => answer && choices.includes(answer)))
							fail("Selectable blanks need answers present in their choices.");
						if (r.style === "dropdown") {
							if (choices.length < 2 || new Set(choices).size !== choices.length)
								fail("Dropdown choices must be distinct and contain at least two options.");
							prompt.push(`${i + 1}. ${choices.map(escapeTypst).join("; ")}`);
						} else {
							const count = (used.get(accepted[0]) ?? 0) + 1;
							used.set(accepted[0], count);
							if (count > choices.filter((choice) => choice === accepted[0]).length)
								fail("Word bank needs an occurrence for each primary answer.");
						}
					}
					if (includeAnswers)
						key.push(
							() =>
								`${i + 1}. ${accepted.map((answer, j) => escapeTypst(!answer ? strings.noAnswer : (!r.style || r.style === "inline-inputs") && sources[j].startsWith("~") ? `${strings.pattern}: ${sources[j].slice(1)}` : answer)).join("; ")}`,
						);
				}
				break;
			}
			case "textResponse":
				known(r, ["type", "inputType", "maxLength", "placeholder", "downloadAs"]);
				if (!["short", "long"].includes(String(r.inputType)))
					fail("Legacy numeric/graded text responses need a PDF answer mapping.");
				prompt.push(
					ctx.answerLines
						? "#stack(dir: ttb, spacing: 0.8cm, ..range(3).map(_ => line(length: 100%, stroke: 0.5pt + px-rule)))"
						: "#v(2cm)",
				);
				break;
			case "hotspot": {
				known(r, [
					"type",
					"image",
					"imageId",
					"imageAlt",
					"mode",
					"selectionMode",
					"hotspots",
					"labels",
				]);
				if (r.mode !== "select" || r.labels !== undefined)
					fail("Legacy label hotspots need a PDF answer mapping.");
				const regions = records(r.hotspots);
				for (const region of regions) {
					known(region, ["id", "shape", "coords", "label", "isCorrect", "feedback", "indicator"]);
					if (
						!["rect", "ellipse", "polygon"].includes(String(region.shape)) ||
						!Array.isArray(region.coords) ||
						!region.coords.every(
							(c) => typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 100,
						) ||
						!hotspotGeometry(region.shape, region.coords)
					)
						fail("Unsupported hotspot coordinates.");
					if (region.isCorrect !== undefined && typeof region.isCorrect !== "boolean")
						fail("Invalid hotspot correctness.");
				}
				prompt.push(strings.mark, ctx.image(text(r.image), requiredAlt(r.imageAlt)));
				const correct = regions.filter((region) => region.isCorrect === true);
				if (includeAnswers && correct.length) {
					const overlays = correct.map((region) => ({
						shape: region.shape as "rect" | "ellipse" | "polygon",
						coords: region.coords as number[],
						...(region.label ? { label: text(region.label) } : {}),
					}));
					key.push(() => ctx.image(text(r.image), requiredAlt(r.imageAlt), { regions: overlays }));
					for (const region of correct) {
						key.push(
							() =>
								`${region.label ? `${escapeTypst(text(region.label))}. ` : ""}${escapeTypst(strings.location)}: ${escapeTypst((region.coords as number[]).join(", "))}`,
						);
						explain(region);
					}
				}
				break;
			}
			case "matrix": {
				known(r, ["type", "selectionMode", "statements", "scalePoints"]);
				const statements = records(r.statements),
					scale = records(r.scalePoints);
				for (const statement of statements) {
					known(statement, ["id", "text"]);
					text(statement.text);
				}
				for (const point of scale) {
					known(point, ["id", "value", "label"]);
					if (typeof point.value !== "number" || !Number.isFinite(point.value))
						fail("Invalid matrix scale.");
					text(point.label);
				}
				if (
					new Set(scale.map((p) => p.value)).size !== scale.length ||
					(r.selectionMode !== undefined &&
						!["single", "multiple"].includes(String(r.selectionMode)))
				)
					fail("Invalid matrix selection scale.");
				prompt.push(r.selectionMode === "multiple" ? strings.many : strings.one);
				prompt.push(
					`#table(columns: ${scale.length + 1}, inset: 6pt, table.header([${escapeTypst(strings.statement)}], ${scale.map((point) => `[${point.value}: ${display(point, "label")}]`).join(", ")}), ${statements.map((statement) => `pdf.header-cell(scope: "row")[${display(statement, "text")}], ${scale.map(() => `[${r.selectionMode === "multiple" ? "☐" : "○"}]`).join(", ")}`).join(", ")})`,
				);
				break;
			}
			default:
				fail(`Unsupported PDF assessment: ${r.type}.`);
		}
		if (typeof r.placeholder === "string" && r.placeholder.trim())
			prompt.push(
				`${labelWithSeparator(escapeTypst(strings.hint), ctx.locale)}${escapeTypst(r.placeholder)}`,
			);
	}
	if (includeAnswers && isRecord(data.feedback)) {
		const feedback = data.feedback;
		for (const blocks of [feedback.correct, feedback.general]) {
			if (!blocks) continue;
			const block = Array.isArray(blocks) && blocks.length === 1 ? blocks[0] : undefined;
			// Rich collections, locale overrides and text layout settings keep their own rendering.
			const html =
				isRecord(block) &&
				block.type === "text" &&
				block.locale === undefined &&
				block.visible !== false &&
				isRecord(block.data) &&
				Object.keys(block.data).every(
					(field) => field === "content" || isInlineProjectionMetadataKey(field),
				) &&
				typeof block.data.content === "string"
					? feedbackHtml(block.data.content)
					: undefined;
			addRationale(() => renderBlocks(blocks), html, true);
		}
	}
	return {
		body: `#px-question[${prompt.filter(Boolean).join("\n\n")}] <q-${ctx.number}>`,
		...(includeAnswers
			? {
					answer: () => {
						const renderedKey = key.map((render) => render());
						const explanations = [
							...new Set(rationale.map(({ render }) => render()).filter(Boolean)),
						];
						return `${(renderedKey.length ? renderedKey : [escapeTypst(strings.noAnswer)]).join("\n\n")}${explanations.length ? `\n\n${!key.length ? `${escapeTypst(strings.guidance)}\n\n` : ""}${explanations.join("\n\n")}` : ""}`;
					},
				}
			: {}),
	};
}
