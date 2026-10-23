import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
	AssessmentDeckOptions,
	PraxityBlock,
	RetrievalSheetContent,
} from "@praxity/content-model";
import { isInlineProjectionMetadataKey } from "@praxity/content-model/inline-fields";
import { getInlineField } from "@praxity/content-model/inline-preparation";
import { partitionLessonPages, practiceDiagnosticMessage } from "@praxity/grammar";
import {
	adaptGrammarPreviewBlocks,
	constructWriteDistractorsPromptBlock,
} from "@praxity/shared-blocks/grammar-adapter";
import { hotspotGeometry } from "@praxity/shared-blocks/hotspot-geometry";
import { labelWithSeparator } from "@praxity/shared-blocks/i18n/label-separator";
import { resolveLocale } from "@praxity/shared-blocks/i18n/locale";
import { imageFloatRegions } from "@praxity/shared-blocks/image-float";
import { extractNarrationSegments, renderNarrationScript } from "@praxity/shared-blocks/narration";
import { preparePageFootnotes } from "@praxity/shared-blocks/page-footnotes";
import { distractorOptionKey } from "@praxity/shared-blocks/write-distractors-content";
import { validateContent as validateRetrievalSheet } from "learning-patterns/patterns/retrieval-sheet/logic.js";
import { strings as retrievalSheetStrings } from "learning-patterns/patterns/retrieval-sheet/strings.js";
import {
	annotate,
	type Content,
	validateContent,
} from "learning-patterns/patterns/self-check/logic.js";
import { strings as selfCheckStrings } from "learning-patterns/patterns/self-check/strings.js";
import {
	validateContent as validateWriteDistractors,
	type Content as WriteDistractorsContent,
} from "learning-patterns/patterns/write-distractors/logic.js";
import { strings as writeDistractorsStrings } from "learning-patterns/patterns/write-distractors/strings.js";
import { type DefaultTreeAdapterMap, parseFragment, serialize, serializeOuter } from "parse5";
import {
	escapeTypst,
	htmlToTypst,
	safeTypstLink,
	stripHtml,
	typstLanguage,
	typstString,
} from "../renderers/typst/common.ts";
import { type PdfAssessmentContext, renderPdfAssessment } from "./course-pdf-assessments.ts";
import { renderPdfContent } from "./course-pdf-content.ts";
import { renderPdfEquation } from "./course-pdf-math.ts";
import { coursePdfTextLayout, coursePdfTheme } from "./course-pdf-theme.ts";
import { compileTypstNative as compileTypst } from "./typst-native-compiler.ts";

export interface CoursePdfLesson {
	id: string;
	title: string;
	locale: string;
	/** Parsed source, with durable IDs and narration sidecars, before display normalization. */
	blocks: PraxityBlock[];
	/** Explicit author Content from the grammar accessor, never from reader block data. */
	selfCheckContents?: ReadonlyMap<string, Content>;
	/** Explicit native answer-sheet input; generic reader data remains prompt-only. */
	writeDistractorsContents?: ReadonlyMap<string, WriteDistractorsContent>;
	componentDefaults?: Record<string, Record<string, unknown>>;
	moduleDeck?: AssessmentDeckOptions;
	narrationEnabled?: boolean;
	design?: Record<string, unknown>;
}

export interface CoursePdfOptions {
	title: string;
	locale: string;
	/** Author diagnostic language, independent of the lesson content language. */
	diagnosticLocale?: string;
	lessons: CoursePdfLesson[];
	pageSize?: "a4" | "letter";
	includeAnswerSheet?: boolean;
	/** Keys are authored references, not host paths. Only selected images are consumed. */
	resolvedAssets?: ReadonlyMap<string, Uint8Array>;
	/** Fontsource slugs staged beside the engine; other theme fonts fall back to bundled faces. */
	availableFonts?: ReadonlySet<string>;
}

export interface CoursePdfDiagnostic {
	lessonId: string;
	blockId?: string;
	pageTitle?: string;
	code?: string;
	message: string;
}

export class CoursePdfError extends Error {
	constructor(
		readonly lessonId: string,
		readonly blockId: string | undefined,
		readonly reason: string,
		readonly code?: "highlight-native-pdf-unsupported",
		readonly referencePath?: string,
	) {
		super(`${lessonId}${blockId ? ` / ${blockId}` : ""}: ${reason}`);
		this.name = "CoursePdfError";
	}
}

const pageMarginCm = 2.2;
const pageWidthPt = { a4: (210 * 72) / 25.4, letter: 612 };
const invalidLiteralControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
// Joining scripts and shared tatweel must stay in one shaping run, including with Latin.
const joiningScript =
	/[\u0640\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Mandaic}\p{Script=Manichaean}\p{Script=Psalter_Pahlavi}\p{Script=Phags_Pa}\p{Script=Sogdian}\p{Script=Old_Uyghur}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Chorasmian}]/u;

// Empty boxes permit line breaks without adding copyable characters.
function coursePdfLiteral(
	segments: Array<{ text: string; marker: number | null }>,
	width: string,
	capacity: number,
	wrap?: (literal: string) => string,
): string {
	segments = segments.map((s) => ({ ...s, text: s.text.replace(/[ \t\u2028\u2029]+/g, " ") }));
	const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
	const wholeText = segments.map((s) => s.text).join("");
	// An evidence span can start inside a cluster, such as at its combining accent.
	const boundaries = new Set([...graphemes.segment(wholeText)].map((part) => part.index));
	boundaries.add(wholeText.length);
	type Unit = { seg: number; weight: number; boundary: boolean; breakable: boolean } & (
		| { text: string }
		| { marker: number }
	);
	const units: Unit[] = [];
	let offset = 0;
	segments.forEach((s, i) => {
		for (const { segment, index } of graphemes.segment(s.text)) {
			const boundary = boundaries.has(offset + index);
			const breakable = /^(?:[ \t\n]|\r\n)$/.test(segment);
			units.push({
				seg: i,
				text: segment,
				weight: breakable || !boundary ? 0 : 1,
				boundary,
				breakable,
			});
		}
		offset += s.text.length;
		if (s.marker !== null)
			units.push({
				seg: i,
				marker: s.marker,
				weight: String(s.marker).length + 2,
				boundary: boundaries.has(offset),
				breakable: false,
			});
	});
	// UAX 14 keeps a space attached to its opening/closing punctuation.
	const boundSpace = (k: number) => {
		const previous = units[k - 1];
		const next = units[k + 1];
		return (
			(previous && "text" in previous && /[\p{Ps}\p{Pi}]$/u.test(previous.text)) ||
			(next && "text" in next && /^[\p{Pe}\p{Pf}!?;:,./]/u.test(next.text))
		);
	};
	const protectedSpace = (k: number) => {
		const previous = units[k - 1];
		const next = units[k + 1];
		return (
			(previous && "text" in previous && previous.text === "\u00ab") ||
			(next && "text" in next && /^[?!:;\u00bb]/u.test(next.text))
		);
	};
	units.forEach((unit, k) => {
		if ("text" in unit && unit.text === " " && boundSpace(k)) unit.breakable = false;
	});
	const long: number[] = new Array(units.length).fill(-1);
	const decisions: string[] = [];
	const words: number[] = new Array(units.length).fill(-1);
	const markRun = (start: number, end: number, target: number[]) => {
		const run = units.slice(start, end);
		if (
			run.reduce((sum, u) => sum + u.weight, 0) < capacity ||
			run.some((u) => "text" in u && joiningScript.test(u.text))
		)
			return;
		const plain = run
			.map((u) => ("text" in u ? typstString(u.text) : `super(${typstString(`[${u.marker}]`)})`))
			.join("; ");
		target.fill(decisions.length, start, end);
		// Measure the prepared heading itself, including its show rules and Typst's
		// implicit heading scale. Body runs keep their existing style and output.
		const measured = wrap ? `px-title({${plain}})` : `{${plain}}`;
		decisions.push(`let wrap${decisions.length} = measure(${measured}).width > ${width}`);
	};
	let start = 0;
	for (let k = 0; k <= units.length; k++) {
		if (k === units.length || units[k].breakable) {
			markRun(start, k, long);
			if (long[start] >= 0) {
				let wordStart = start;
				for (let n = start; n < k; n++) {
					const unit = units[n];
					if ("text" in unit && /^\p{Zs}$/u.test(unit.text) && !boundSpace(n)) {
						markRun(wordStart, n, words);
						wordStart = n + 1;
					}
				}
				if (wordStart === start) words.fill(long[start], start, k);
				else markRun(wordStart, k, words);
			}
			start = k + 1;
		}
	}
	const items: string[] = [];
	let body: string[] = [];
	let text = "";
	let since = 0;
	const flush = () => {
		if (text) body.push(typstString(text));
		text = "";
	};
	units.forEach((u, k) => {
		if ("marker" in u) {
			flush();
			items.push(`underline({${body.join("; ")}})`, `super(${typstString(`[${u.marker}]`)})`);
			body = [];
			if (words[k] >= 0 && u.boundary && !protectedSpace(k) && !protectedSpace(k + 1)) {
				items.push(`if wrap${words[k]} { box(width: 0pt) }`);
				since = 0;
			}
			return;
		}
		const t = u.text;
		if (t === "\n" || t === "\r\n") {
			flush();
			body.push("linebreak()");
			since = 0;
		} else if (u.breakable) {
			text += t;
			since = 0;
		} else {
			if (
				words[k] >= 0 &&
				since >= 16 &&
				u.boundary &&
				!protectedSpace(k) &&
				!protectedSpace(k - 1) &&
				!/^[?!:;\u00bb]/u.test(t)
			) {
				flush();
				body.push(`if wrap${words[k]} { box(width: 0pt) }`);
				since = 0;
			}
			text += t;
			since += u.weight;
			if (long[k] >= 0 && /^\p{Zs}$/u.test(t) && !protectedSpace(k)) {
				flush();
				body.push(`if wrap${long[k]} { box(width: 0pt) }`);
				since = 0;
			}
		}
		const next = units[k + 1];
		if (!next || (next.seg !== u.seg && !("marker" in next))) {
			flush();
			items.push(...body);
			body = [];
		}
	});
	const content = items.join("; ");
	// Heading bodies must contain text, not a layout/context node, for PDF/UA.
	// Resolve break decisions outside the heading before wrapping the literal text.
	if (wrap) {
		const statements = [
			`let px-title(body) = [${wrap("#body")}]`,
			...decisions,
			`px-title({${content}})`,
		];
		return `#context {${statements.join("; ")}}`;
	}
	return decisions.length ? `#{context {${decisions.join("; ")}; ${content}}};` : `#{${content}};`;
}

type Data = Record<string, unknown>;
const record = (value: unknown): value is Data =>
	!!value && typeof value === "object" && !Array.isArray(value);
const hidden = (data: Data) => data.hide === true || data.hidden === true;
const printableMarker = (node: DefaultTreeAdapterMap["childNode"]): boolean => {
	if (!("tagName" in node) || ["script", "style", "template", "code", "pre"].includes(node.tagName))
		return false;
	const attr = (name: string) => node.attrs.find((entry) => entry.name === name)?.value;
	if (attr("data-praxity-inline-icon")) return attr("aria-hidden") !== "true";
	return (
		node.tagName === "img" ||
		attr("data-math-latex") !== undefined ||
		attr("data-tooltip-content") !== undefined ||
		node.childNodes.some(printableMarker)
	);
};
const emptyText = (content: string) =>
	!stripHtml(content).trim() && !parseFragment(content).childNodes.some(printableMarker);
const invalidChartRows = (block: Data) => {
	if (block.type !== "chart" || !record(block.data) || !Array.isArray(block.data.rows))
		return false;
	const rows = block.data.rows;
	return (
		!Array.isArray(rows[0]) ||
		rows.length < 2 ||
		rows
			.slice(1)
			.some(
				(row) =>
					!Array.isArray(row) ||
					row.length !== (rows[0] as unknown[]).length ||
					row
						.slice(1)
						.some(
							(cell) => typeof cell !== "string" || !cell.trim() || !Number.isFinite(Number(cell)),
						),
			)
	);
};
const skippableBlockErrors = new Set([
	"Invalid content block.",
	"Empty content block.",
	"Expected content blocks.",
	"Expected printable text.",
	"Printable text contains control characters.",
	"A local image reference is required.",
	"Expected nonempty printable text.",
	"Invalid content items.",
	"Heading level must be 1–6.",
	"Table needs string cells and a first row.",
	"Table rows must have the same number of string cells as the first row.",
	"Invalid table column alignments.",
	"Unsupported note tone.",
	"Image comparison needs both images.",
	"Graphic label positions must be percentages from 0 to 100.",
	"Media transcript must be authored text.",
	"Unsupported companion resource type.",
	"Chart needs source data.",
	"Invalid chart labels.",
	"Chart needs at least one data series.",
	"Chart series must contain a finite number for every category.",
	"Code must be literal text.",
	"Expected nonempty assessment text.",
	"Invalid assessment records.",
	"Invalid assessment choices or alternatives.",
	"A printable question stem is required.",
	"Question heading level must be 1–6.",
	"Invalid rating scale.",
	"Invalid rating values.",
	"Invalid assessment response.",
	"Choice questions need at least two options and a selection mode.",
	"Categorize needs at least one item.",
	"Invalid fill-blank template.",
	"Invalid blank answer record.",
	"Incomplete assessment prompt.",
	"Invalid matrix scale.",
	"Equations need nonempty LaTeX of at most 8192 characters.",
	"Equation LaTeX contains control characters.",
	"Equation comments and math delimiters are unsupported.",
	"Equation nesting exceeds 64 levels.",
	"Equation braces are unbalanced.",
	"Unsupported equation escape.",
	"Unsupported equation environment.",
	"Equation environments are unbalanced.",
	"Equation braces or environments are unbalanced.",
	"Equation alternatives must be text.",
	"Equation LaTeX is invalid.",
]);
const skippableBlockError = (message: string) =>
	skippableBlockErrors.has(message) || message.startsWith("Unsupported equation command:");
const copy = {
	en: {
		notice:
			"Study workbook. Completion, attempts and scoring apply only in the interactive course.",
		answersIncluded: "This copy includes an answer sheet at the end.",
		answers: "Answer sheet",
		retrievalInstruction: "On your chosen date, answer from memory.",
		retrievalWithAnswers: "On your chosen date, answer from memory. Then check the answer sheet.",
		contents: "Contents",
		footnote: "Source",
		footnotes: "Sources",
		glossary: "Glossary",
		narration: "Narration",
		all: "Answer all questions in this group.",
		oneOf: "Answer one question in this group. All alternatives are printed.",
		points: "Points",
		passing: "Pass threshold",
		allCorrect: "All answers must be correct in the interactive course.",
	},
	fr: {
		notice:
			"Cahier d’étude. La progression, les tentatives et la notation s’appliquent uniquement au cours interactif.",
		answersIncluded: "Cette version comprend un corrigé à la fin.",
		answers: "Corrigé",
		retrievalInstruction: "À la date choisie, répondez de mémoire.",
		retrievalWithAnswers: "À la date choisie, répondez de mémoire. Consultez ensuite le corrigé.",
		contents: "Sommaire",
		footnote: "Source",
		footnotes: "Sources",
		glossary: "Glossaire",
		narration: "Narration",
		all: "Répondez à toutes les questions de ce groupe.",
		oneOf: "Répondez à une question de ce groupe. Toutes les options sont imprimées.",
		points: "Points",
		passing: "Seuil de réussite",
		allCorrect: "Toutes les réponses doivent être correctes dans le cours interactif.",
	},
};

const IMAGE_SIZES: Record<string, number> = { small: 0.33, medium: 0.5, large: 0.75 };

const WIDE_BLOCKS = new Set([
	"card",
	"columns",
	"chart",
	"image",
	"table",
	"imageComparison",
	"labeledGraphic",
	"heroCover",
	"code",
	"retrievalSheet",
]);

const FOOTER_INSERT = /^<p>\s*<span data-footer-insert="true">@footer\.insert<\/span>\s*<\/p>$/;

/** Print sets sources as page footnotes, so a source-list placeholder, and a disclosure
 * holding nothing else, is dropped. */
function dropSourceLists(blocks: PraxityBlock[]): PraxityBlock[] {
	// Anything carrying an enabled custom script stays, so its narration still prints.
	const narrated = (value: Data) =>
		typeof value.narration === "string" &&
		value.narration.trim() !== "" &&
		value.narrationDisabled !== true;
	return blocks.flatMap((block) => {
		if (!record(block) || !record(block.data)) return [block];
		const data = block.data as Data;
		if (block.type === "text" && FOOTER_INSERT.test(String(data.content).trim()))
			return narrated(data) ? [{ ...block, data: { ...data, content: "" } } as PraxityBlock] : [];
		if (!Array.isArray(data.items) || !data.items.length) return [block];
		const items = data.items.flatMap((item: unknown) => {
			if (!record(item) || !Array.isArray(item.children) || !item.children.length) return [item];
			const children = dropSourceLists(item.children as PraxityBlock[]);
			return children.length || narrated(item) ? [{ ...item, children }] : [];
		});
		return items.length || narrated(data)
			? [{ ...block, data: { ...data, items } } as PraxityBlock]
			: [];
	});
}

/** Sentence pieces let a long script start beside its slide and continue below it. */
export function narrationPieces(html: string): string[][] {
	const blocks = parseFragment(html)
		.childNodes.filter((node) => "tagName" in node)
		.map((node) => serializeOuter(node));
	if (!blocks.length) blocks.push(html);
	return blocks.map((block) => {
		// Script headings are delivery cues, not document structure; keep them out of the outline.
		const heading = /^<h[1-6]>([\s\S]*)<\/h[1-6]>$/.exec(block);
		if (heading) return [`<strong>${heading[1]}</strong>`];
		const paragraph = /^<p>([\s\S]*)<\/p>$/.exec(block);
		if (!paragraph) return [block];
		const pieces: string[] = [];
		for (const sentence of paragraph[1].split(/(?<=[.!?][”’"')\]]*)\s+(?=[\p{Lu}“‘"(\d<])/u)) {
			const open = pieces.at(-1);
			// Never split inside inline emphasis.
			if (
				open !== undefined &&
				(open.match(/<(?:strong|em)>/g)?.length ?? 0) !==
					(open.match(/<\/(?:strong|em)>/g)?.length ?? 0)
			)
				pieces[pieces.length - 1] = `${open} ${sentence}`;
			else pieces.push(sentence);
		}
		return pieces;
	});
}

function assertNoHighlightPdf(options: CoursePdfOptions): void {
	// Permanent native limitation, independent of temporary runtime publication
	// admission. Scan hidden descendants before rendering or staging any workbook.
	const visit = (value: unknown, lessonId: string, locale: string, referencePath: string): void => {
		if (Array.isArray(value)) {
			value.forEach((child, index) => visit(child, lessonId, locale, `${referencePath}[${index}]`));
			return;
		}
		if (!value || typeof value !== "object") return;
		const block = value as Record<string, unknown>;
		if (block.type === "highlight")
			throw new CoursePdfError(
				lessonId,
				typeof block.id === "string" ? block.id : undefined,
				practiceDiagnosticMessage("highlight-native-pdf-unsupported", locale),
				"highlight-native-pdf-unsupported",
				referencePath,
			);
		for (const [key, child] of Object.entries(block))
			if (!isInlineProjectionMetadataKey(key, { keepDisplay: true }))
				visit(child, lessonId, locale, `${referencePath}.${key}`);
	};
	options.lessons.forEach((lesson, index) =>
		visit(
			lesson.blocks,
			lesson.id,
			options.diagnosticLocale ?? lesson.locale ?? options.locale,
			`lessons[${index}].blocks`,
		),
	);
}

/** Pure preparation: referenced assets come only from selected printable content. */
export function buildCoursePdfSource(options: CoursePdfOptions): {
	typstSource: string;
	questionCount: number;
	assetSources: ReadonlyMap<string, string>;
	diagnostics: CoursePdfDiagnostic[];
	usesMath: boolean;
	fonts: ReadonlySet<string>;
} {
	assertNoHighlightPdf(options);
	if (!options.title?.trim() || !options.lessons.length)
		throw new CoursePdfError("course", undefined, "A title and at least one lesson are required.");
	if (options.pageSize !== undefined && !["a4", "letter"].includes(options.pageSize))
		throw new CoursePdfError("course", undefined, "Unsupported paper size.");
	const language = (locale: string, lessonId: string, id?: string) => {
		try {
			return typstLanguage(locale);
		} catch {
			throw new CoursePdfError(lessonId, id, "Invalid content language.");
		}
	};
	const courseLanguage = language(options.locale, "course");
	const theme = coursePdfTheme(options.lessons[0].design, options.availableFonts ?? new Set());
	const strings = options.locale.startsWith("fr") ? copy.fr : copy.en;
	const diagnostics: CoursePdfDiagnostic[] = [];
	const assetSources = new Map<string, string>();
	const body: string[] = [];
	const contents: string[] = [];
	const answers: Array<() => string> = [];
	const retrievalAnswers: Array<() => string> = [];
	const lessonIds = new Set<string>();
	let questionCount = 0;
	let usesMath = false;
	let scopeNumber = 0;
	const headingRanks: number[] = [];

	for (const lesson of options.lessons) {
		const fail = (message: string, id?: string): never => {
			throw new CoursePdfError(lesson.id, id, message);
		};
		const warn = (message: string, id?: string, code?: string) => {
			diagnostics.push({
				lessonId: lesson.id,
				...(id ? { blockId: id } : {}),
				...(typeof pageData?.title === "string" ? { pageTitle: pageData.title } : {}),
				...(code ? { code } : {}),
				message,
			});
		};
		const skip = (id?: string, reason?: string) =>
			warn(
				options.locale.startsWith("fr")
					? "Bloc ignoré dans le PDF, car son contenu est vide ou invalide."
					: "Skipped a block in the PDF because its content is empty or invalid.",
				id,
				reason === "Chart data must contain complete numeric rows."
					? "invalid_chart_rows"
					: reason === "Invalid block." || reason === "Invalid content block."
						? "invalid_block"
						: reason === "empty"
							? "empty_block"
							: "invalid_block_data",
			);
		if (!lesson.id || lessonIds.has(lesson.id) || !lesson.title?.trim())
			fail("Lesson titles and unique lesson IDs are required.");
		lessonIds.add(lesson.id);
		const locale = language(lesson.locale, lesson.id);
		const local = lesson.locale.startsWith("fr") ? copy.fr : copy.en;
		headingRanks.length = 0;
		let headingNotice = false;
		const heading = (content: string, level: number): string => {
			if (!Number.isInteger(level) || level < 1 || level > 6)
				return fail("Heading level must be 1–6.");
			while (headingRanks.length && (headingRanks.at(-1) as number) >= level) headingRanks.pop();
			headingRanks.push(level);
			if (headingRanks.length !== level && !headingNotice) {
				headingNotice = true;
				warn(
					lesson.locale.startsWith("fr")
						? "La hiérarchie des titres a été resserrée pour le PDF balisé; leur ordre et leur taille relative sont conservés."
						: "Heading ranks were compacted for tagged PDF; their order and relative visual size are preserved.",
				);
			}
			return `#heading(level: ${Math.min(6, headingRanks.length + 1)})[#text(size: ${[1.6, 1.3, 1.15, 1, 1, 1][level - 1]}em)[${content}]]`;
		};
		const ids = new Set<string>();
		const printedIds = new Set<string>();
		const questionIds = new Set<string>();
		const blockAliases = new Map<string, string[]>();
		const anchor = (id: string) => `p-${Buffer.from(`${lesson.id}/${id}`).toString("hex")}`;
		const linkTargets: string[] = [];
		const aliases = (id: string, names: unknown[]): string =>
			names
				.filter((name): name is string => typeof name === "string" && !!name && name !== id)
				.map((name) => {
					if (printedIds.has(name)) fail("Duplicate PDF destination name.", id);
					printedIds.add(name);
					return `#metadata(none) <${anchor(name)}>`;
				})
				.join("\n");
		const glossary = new Map<string, { term: string; definition: string }>();
		let inAnswers = false;
		let sources: string[] = [];
		const headingIds = new Set<string>();
		let activeLocale = lesson.locale;
		type Scope = { number: number; snippets: Array<{ html: string; id: string; locale: string }> };
		const newScope = (): Scope => ({ number: ++scopeNumber, snippets: [] });
		let scope = newScope();
		const validateRich = (html: unknown, id: string): string => {
			if (typeof html !== "string") fail("Expected printable text.", id);
			if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(html as string))
				fail("Printable text contains control characters.", id);
			if (/<img\b|data-math-latex\s*=|data-mention\s*=/i.test(html as string)) {
				const inspect = (node: DefaultTreeAdapterMap["childNode"]): void => {
					if (!("tagName" in node)) return;
					const attr = (name: string) => node.attrs.find((entry) => entry.name === name)?.value;
					if (attr("data-mention"))
						fail("Variables and answer piping need a static version before PDF export.", id);
					if (node.tagName === "img" && !attr("src")?.trim())
						fail("A local image reference is required.", id);
					const latex = attr("data-math-latex");
					if (latex !== undefined)
						renderPdfEquation(latex, attr("aria-label"), "en", false, (message) =>
							fail(message, id),
						);
					for (const child of node.childNodes) inspect(child);
				};
				for (const node of parseFragment(html as string).childNodes) inspect(node);
			}
			return html as string;
		};
		const rich = (html: unknown, id: string): string => {
			const valid = validateRich(html, id);
			const token = `\u0000PDFINLINE${scope.number}X${scope.snippets.length}END`;
			scope.snippets.push({ html: valid, id, locale: activeLocale });
			return token;
		};
		const image = (
			src: string,
			alt: string,
			settings?: Parameters<PdfAssessmentContext["image"]>[2],
			id?: string,
		) => {
			if (!src?.trim() || /[\u0000-\u001f\u007f]/.test(src))
				fail("A local image reference is required.", id);
			if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src))
				fail("Remote and data-URL images must be saved in the project before PDF export.", id);
			if (!settings?.decorative && !alt?.trim())
				fail("Informative images need alternative text.", id);
			let filename = assetSources.get(src);
			if (!filename) {
				const extension = /\.(png|jpe?g|gif|svg|webp)$/i.exec(src)?.[1]?.toLowerCase();
				if (!extension) fail("Unsupported image format; use PNG, JPEG, GIF, SVG or WebP.", id);
				filename = `assets/image-${assetSources.size + 1}.${extension}`;
				assetSources.set(src, filename);
			}
			const marks = (settings?.regions ?? [])
				.map((region, index) => {
					const box = hotspotGeometry(region.shape, region.coords);
					if (!box) return fail("Unsupported hotspot geometry.");
					const [x, y, a] = region.coords;
					if (region.shape === "ellipse" && region.coords.length === 3)
						return `#place(top + left, dx: dims.width * ${(x - a) / 100}, dy: dims.height * ${y / 100} - dims.width * ${a / 100}, circle(radius: dims.width * ${a / 100}, stroke: 1.5pt + black)[#text(size: 9pt)[${index + 1}]])`;
					if (region.shape === "polygon") {
						const points = Array.from(
							{ length: region.coords.length / 2 },
							(_, i) =>
								`(dims.width * ${region.coords[i * 2] / 100}, dims.height * ${region.coords[i * 2 + 1] / 100})`,
						).join(", ");
						return `#place(top + left, polygon(stroke: 1.5pt + black, ${points}))\n#place(top + left, dx: dims.width * ${(box.left + box.width / 2) / 100}, dy: dims.height * ${(box.top + box.height / 2) / 100}, text(size: 9pt)[${index + 1}])`;
					}
					const shape = region.shape === "rect" ? "rect" : "ellipse";
					return `#place(top + left, dx: dims.width * ${box.left / 100}, dy: dims.height * ${box.top / 100}, ${shape}(width: dims.width * ${box.width / 100}, height: dims.height * ${box.height / 100}, stroke: 1.5pt + black)[#text(size: 9pt)[${index + 1}]])`;
				})
				.join("\n");
			const share = IMAGE_SIZES[String(settings?.size)] ?? 1;
			const place =
				settings?.alignment === "left" || settings?.alignment === "right"
					? settings.alignment
					: "center";
			const element = `#layout(size => { let natural = measure(image(${typstString(filename)})); let width = calc.min(size.width * ${share}, 14cm * (natural.width / natural.height)); let pic = image(${typstString(filename)}, width: width${settings?.decorative ? "" : `, alt: ${typstString(alt)}`}); let dims = measure(pic); block(width: 100%, align(${place}, block(width: width)[#pic${marks ? `\n#pdf.artifact[${marks}]` : ""}])) })`;
			return settings?.decorative ? `#pdf.artifact[${element}]` : element;
		};
		const equation = (
			latex: unknown,
			alt: unknown,
			id: string,
			block = true,
			mathLocale = lesson.locale,
		) => {
			const result = renderPdfEquation(latex, alt, mathLocale, block, (message) =>
				fail(message, id),
			);
			usesMath = true;
			return result;
		};
		const link = (target: unknown, label: string, id: string): string => {
			if (typeof target !== "string" || !target) return label;
			if (target.startsWith("#")) {
				let destination: string;
				try {
					destination = decodeURIComponent(target.slice(1));
				} catch {
					return fail("Invalid internal link.", id);
				}
				linkTargets.push(destination);
				return `#link(<${anchor(destination)}>)[${label}]`;
			}
			const rendered = safeTypstLink(target, label);
			if (rendered === label)
				fail("Links must target an included page/block or a safe web/email URL.", id);
			return rendered;
		};
		const convert = (html: string, id: string, contentLocale = lesson.locale): string =>
			htmlToTypst(html, {
				element: (node, content) => {
					const attr = (name: string) => node.attrs.find((a) => a.name === name)?.value;
					if (attr("data-mention"))
						fail("Variables and answer piping need a static version before PDF export.", id);
					if (attr("lang")) language(attr("lang") as string, lesson.id, id);
					if (attr("data-praxity-inline-icon")) {
						if (attr("aria-hidden") === "true") return "";
						return escapeTypst(
							attr("aria-label") ?? fail("Meaningful inline icons need a text label.", id),
						);
					}
					if (attr("data-tooltip-content") !== undefined) {
						const term = stripHtml(serialize(node));
						const definition = attr("data-tooltip-content") as string;
						if (!inAnswers && !glossary.has(term.toLocaleLowerCase(lesson.locale)))
							glossary.set(term.toLocaleLowerCase(lesson.locale), { term, definition });
						// A heading stays a short title; its definition moves to the foot of the page.
						return headingIds.has(id)
							? `${content}#footnote[${escapeTypst(definition)}]`
							: `${content} (${escapeTypst(definition)})`;
					}
					if (attr("data-math-latex") !== undefined) {
						let ancestor: typeof node | typeof node.parentNode = node;
						let mathLocale = contentLocale;
						while (ancestor) {
							const inherited =
								"attrs" in ancestor
									? ancestor.attrs.find((a) => a.name === "lang")?.value
									: undefined;
							if (inherited) {
								mathLocale = inherited;
								break;
							}
							ancestor = "parentNode" in ancestor ? ancestor.parentNode : null;
						}
						return equation(attr("data-math-latex"), attr("aria-label"), id, false, mathLocale);
					}
					if (node.tagName === "img")
						return image(
							attr("src") ?? "",
							attr("alt") ?? "",
							{
								decorative: attr("role") === "presentation" || attr("aria-hidden") === "true",
							},
							id,
						);
					if (node.tagName === "a") return link(attr("href"), content, id);
					if (node.tagName === "sup" && attr("class") === "praxity-footnote-ref") {
						const source = sources[Number(/\[(\d+)\]/.exec(stripHtml(serialize(node)))?.[1]) - 1];
						if (source === undefined) fail("A numbered source has no text.", id);
						return `#footnote[${convert(source as string, id, contentLocale)}]`;
					}
					if (/^h[1-6]$/.test(node.tagName)) return heading(content, Number(node.tagName[1]));
					if (
						!/^(p|div|span|strong|b|em|i|a|br|ul|ol|li|code|pre|s|del|mark|blockquote|sup|sub|u|h[1-6])$/.test(
							node.tagName,
						)
					)
						fail(`Unsupported PDF text element: ${node.tagName}.`, id);
					return undefined;
				},
			});
		const finish = (
			current: Scope,
			content: string,
			notes = "",
		): { body: string; notes: string } => {
			const prepared = preparePageFootnotes(
				current.snippets.map((snippet, index) => ({
					id: String(index),
					type: "text",
					data: { content: snippet.html },
				})),
				String(current.number),
				local,
			);
			const list = /<ol class="praxity-footnotes"[^>]*>[\s\S]*?<\/ol>/;
			const listed = prepared
				.map((block) => String(block.data.content))
				.find((html) => list.test(html));
			sources = [...(listed?.match(list)?.[0] ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)].map(
				(match) => match[1],
			);
			const replacements = new Map(
				current.snippets.map((snippet, index) => [
					`\u0000PDFINLINE${current.number}X${index}END`,
					convert(
						String(prepared[index].data.content).replace(list, ""),
						snippet.id,
						snippet.locale,
					),
				]),
			);
			const replace = (source: string) =>
				source.replace(/\u0000PDFINLINE\d+X\d+END/g, (token) => replacements.get(token) ?? token);
			// The appended block, if any, is only the source list; its items print as page footnotes.
			return { body: replace(content), notes: replace(notes) };
		};
		const staticData = (data: Data, id?: string) => {
			if (data.visible !== undefined && data.visible !== true)
				fail("Conditional visibility needs a static version before PDF export.", id);
			if (
				data.assessmentType === "fillBlank" &&
				data.style !== undefined &&
				!["inline-inputs", "dropdown", "word-bank"].includes(String(data.style))
			)
				fail("Unsupported fill-blank style.", id);
		};
		const select = (blocks: unknown): PraxityBlock[] => {
			if (!Array.isArray(blocks)) return fail("Expected content blocks.");
			return blocks.flatMap((source: PraxityBlock) => {
				if (
					!record(source) ||
					!record(source.data) ||
					typeof source.id !== "string" ||
					!source.id
				) {
					skip(
						record(source) && typeof source.id === "string" ? source.id : undefined,
						"Invalid block.",
					);
					return [];
				}
				if (source.visible === false || hidden(source.data)) return [];
				staticData(source.data, source.id);
				// Malformed response records become PDF diagnostics before normalization;
				// the adapter requires identities on actual child records.
				if (
					source.type === "assessment" &&
					record(source.data.response) &&
					Object.values(source.data.response).some(
						(value) => Array.isArray(value) && value.some((entry) => entry === null),
					)
				) {
					skip(source.id, "Invalid assessment records.");
					return [];
				}
				if (invalidChartRows(source)) {
					skip(source.id, "Chart data must contain complete numeric rows.");
					return [];
				}
				let skippedPrompt = false;
				const clean = (value: unknown, prompt = false): unknown => {
					if (Array.isArray(value))
						return value
							.filter(
								(item) =>
									!record(item) ||
									!(item.visible === false || hidden(record(item.data) ? item.data : item)),
							)
							.filter((item) => {
								if (!record(item) || !invalidChartRows(item)) return true;
								if (prompt) skippedPrompt = true;
								if (record(item.data))
									staticData(item.data, typeof item.id === "string" ? item.id : source.id);
								skip(
									typeof item.id === "string" ? item.id : source.id,
									"Chart data must contain complete numeric rows.",
								);
								return false;
							})
							.map((item) => clean(item, prompt));
					if (!record(value)) return value;
					if (Object.hasOwn(value, "visible")) staticData(value, source.id);
					if (record(value.data) && typeof value.type === "string")
						staticData(value.data, typeof value.id === "string" ? value.id : source.id);
					else if (Object.hasOwn(value, "children") || Object.hasOwn(value, "front"))
						staticData(value, source.id);
					return Object.fromEntries(
						Object.entries(value).map(([key, child]) => [
							key,
							isInlineProjectionMetadataKey(key, { keepDisplay: true })
								? child
								: key === "feedback"
									? options.includeAnswerSheet && record(child)
										? Object.fromEntries(
												Object.entries(child).map(([kind, content]) => [
													kind,
													["correct", "general"].includes(kind) ? clean(content) : content,
												]),
											)
										: child
									: clean(
											child,
											prompt || (value === source.data && ["stem", "description"].includes(key)),
										),
						]),
					);
				};
				const start = diagnostics.length;
				const cleaned = clean(source) as PraxityBlock;
				if (skippedPrompt && ["assessment", "rating"].includes(source.type)) {
					diagnostics.length = start;
					skip(source.id, "Incomplete assessment prompt.");
					return [];
				}
				return [cleaned];
			});
		};
		const renderBlocks = (value: unknown): string => {
			if (value === undefined) return "";
			if (!Array.isArray(value)) return fail("Expected content blocks.");
			return value
				.map((block: PraxityBlock) => renderBlock(block))
				.filter(Boolean)
				.join("\n\n");
		};
		const renderPromptBlocks = (value: unknown): string => {
			const start = diagnostics.length;
			const content = renderBlocks(value);
			if (
				!inAnswers &&
				diagnostics
					.slice(start)
					.some(({ code }) =>
						["invalid_block", "invalid_block_data", "invalid_chart_rows", "empty_block"].includes(
							code ?? "",
						),
					)
			)
				fail("Incomplete assessment prompt.");
			return content;
		};
		const groups: Array<{ id: string; members: unknown; journal: boolean }> = [];
		let pageNarration: ReturnType<typeof extractNarrationSegments> = [];
		const renderedNarration = new Set<string>();
		// Narration is collected per page as (paragraph, sentence) units; px-slide places as many
		// beside the slide as fit its height and continues the rest below.
		const pageNotes: string[] = [];
		let noteParagraph = 0;
		const note = (content: string) => pageNotes.push(`(${noteParagraph}, [${content}])`);
		const supplement = (segment: (typeof pageNarration)[number]) => {
			renderedNarration.add(segment.id);
			if (segment.containerPart && segment.label) {
				note(`#px-eyebrow[${escapeTypst(segment.label)}]`);
				noteParagraph++;
			}
			for (const paragraph of narrationPieces(renderNarrationScript(segment.script))) {
				for (const piece of paragraph) {
					try {
						note(rich(piece, segment.blockId ?? pageId));
					} catch (error) {
						if (!(error instanceof CoursePdfError) || !skippableBlockError(error.reason))
							throw error;
						warn(
							options.locale.startsWith("fr")
								? "Texte de narration invalide ignoré dans le PDF."
								: "Skipped invalid narration text in the PDF.",
							segment.blockId ?? pageId,
							"invalid_narration_data",
						);
					}
				}
				noteParagraph++;
			}
		};
		const renderBlockUnsafe = (block: PraxityBlock): string => {
			if (!record(block) || !record(block.data) || typeof block.id !== "string" || !block.id)
				return fail("Invalid content block.");
			if (block.visible === false || hidden(block.data)) return "";
			const { data, id } = block;
			staticData(data, id);
			if (!inAnswers) {
				if (ids.has(id)) fail("Duplicate block ID.", id);
				ids.add(id);
				printedIds.add(id);
			}
			const previousLocale = activeLocale;
			const blockLocale = block.locale ?? activeLocale;
			activeLocale = blockLocale;
			if (block.type === "heading" || block.type === "heroCover") headingIds.add(id);
			const field = (owner: Data, key: string) => rich(getInlineField(owner, key), id);
			let content: string;
			if (block.type === "retrievalSheet") {
				// Native workbooks consume the sheet’s public authored Content.
				let sheet: RetrievalSheetContent;
				try {
					validateRetrievalSheet(data.content);
					sheet = data.content;
					if (
						[sheet.title, ...sheet.questions.flatMap((row) => [row.question, row.answer])].some(
							(text) => invalidLiteralControl.test(text),
						)
					)
						throw new Error();
				} catch {
					return fail("Invalid retrieval-sheet content.", id);
				}
				const labels = retrievalSheetStrings[resolveLocale(blockLocale)];
				const pdfCopy = copy[resolveLocale(blockLocale)];
				const instruction =
					options.includeAnswerSheet === true
						? pdfCopy.retrievalWithAnswers
						: pdfCopy.retrievalInstruction;
				const literal = (text: string) =>
					coursePdfLiteral([{ text, marker: null }], "size.width", 16);
				const level = Number(data.level);
				const title = `#layout(size => [${coursePdfLiteral([{ text: sheet.title, marker: null }], "size.width", 16, (text) => heading(text, level))}])`;
				const questionsTitle = heading(escapeTypst(labels.questions), Math.min(6, level + 1));
				const questions = sheet.questions
					.map(
						(row) =>
							`[#block(breakable: false)[#layout(size => [${literal(row.question)}])\n\n#v(1.6cm)\n#line(length: 100%, stroke: 0.75pt + px-ink)]]`,
					)
					.join(",\n");
				content = `${title}\n\n${escapeTypst(instruction)}\n\n${escapeTypst(labels.dateLabel)} #box(width: 5cm)[#line(length: 100%, stroke: 0.75pt + px-ink)]\n\n${questionsTitle}\n\n#enum(tight: false, spacing: 0.7em,\n${questions}\n)`;
				if (options.includeAnswerSheet === true) {
					const numbered = sheet.questions
						.map((row) => `[#layout(size => [${literal(row.answer)}])]`)
						.join(",\n");
					retrievalAnswers.push(
						() =>
							`#text(${language(blockLocale, lesson.id, id)})[\n#layout(size => [${coursePdfLiteral([{ text: sheet.title, marker: null }], "size.width", 16, (text) => `#heading(level: 2)[${text}]`)}])\n\n#heading(level: 3)[${escapeTypst(labels.answers)}]\n\n${escapeTypst(labels.backInstruction)}\n\n#enum(tight: false, spacing: 1em,\n${numbered}\n)\n]`,
					);
				}
			} else if (block.type === "writeDistractors") {
				const prompt = constructWriteDistractorsPromptBlock(block).data.content;
				const labels = writeDistractorsStrings[resolveLocale(blockLocale)];
				const literal = (text: string) =>
					coursePdfLiteral([{ text, marker: null }], "size.width", 16);
				const number = ++questionCount;
				const words = ["", "", labels.two, labels.three, labels.four, labels.five];
				const instruction =
					prompt.count === 1
						? labels.writeOne
						: labels.write.replace("{count}", words[prompt.count]);
				const spaces = Array.from(
					{ length: prompt.count },
					(_, index) =>
						`#block(breakable: false)[${escapeTypst(labels.option.replace("{key}", distractorOptionKey(index + 1)))}\n\n#v(1.5cm)\n#line(length: 100%, stroke: 0.75pt + px-ink)\n\n${escapeTypst(labels.misconception)}\n\n#v(1cm)\n#line(length: 100%, stroke: 0.75pt + px-ink)]`,
				).join("\n\n");
				content = `#layout(size => [#px-eyebrow[Q${number}] ${literal(prompt.question)}]) <q-${number}>\n\n${escapeTypst(labels.answer)}\n\n#v(2cm)\n#line(length: 100%, stroke: 0.75pt + px-ink)\n\n${escapeTypst(instruction)}\n\n${spaces}`;
				if (options.includeAnswerSheet === true) {
					// Only explicit native answer sheets read this grammar-owned Content map.
					const authored = lesson.writeDistractorsContents?.get(id);
					if (!authored)
						throw Object.assign(
							new CoursePdfError(
								lesson.id,
								id,
								"Write-distractors answer-sheet content is missing.",
							),
							{ code: "write-distractors-content-missing" },
						);
					let full: WriteDistractorsContent;
					try {
						full = structuredClone(authored);
						validateWriteDistractors(full);
						if (
							full.question !== prompt.question ||
							full.count !== prompt.count ||
							full.misconceptions.length !== prompt.items.length ||
							// Native answer sheets require the source subset's one option per item.
							full.authorOptions.length !== prompt.items.length ||
							new Set(full.authorOptions.map((option) => option.misconception)).size !==
								prompt.items.length ||
							full.misconceptions.some((item, index) => item.id !== prompt.items[index].id) ||
							[
								full.question,
								full.rightAnswer,
								...full.misconceptions.map((item) => item.label),
								...full.authorOptions.map((option) => option.text),
							].some((text) => !text.trim() || invalidLiteralControl.test(text))
						)
							throw new Error();
					} catch {
						throw Object.assign(
							new CoursePdfError(lesson.id, id, "Invalid write-distractors answer-sheet content."),
							{ code: "write-distractors-content-invalid" },
						);
					}
					const numbered = full.misconceptions
						.map((item) => {
							const option = full.authorOptions.find((option) => option.misconception === item.id);
							if (!option)
								throw Object.assign(
									new CoursePdfError(
										lesson.id,
										id,
										"Invalid write-distractors answer-sheet content.",
									),
									{ code: "write-distractors-content-invalid" },
								);
							return `[#layout(size => [#strong[${literal(item.label)}]\n\n${literal(option.text)}])]`;
						})
						.join(",\n");
					answers.push(
						() =>
							`#text(${language(blockLocale, lesson.id, id)})[#layout(size => [#link(<q-${number}>)[Q${number}]\n\n${literal(prompt.question)}\n\n#strong[${escapeTypst(labels.rightAnswer)}]\n\n${literal(full.rightAnswer)}])\n\n#enum(tight: false, spacing: 1em,\n${numbered}\n)\n]`,
					);
				}
			} else if (block.type === "selfCheck") {
				const authored =
					options.includeAnswerSheet === true ? lesson.selfCheckContents?.get(id) : undefined;
				if (!authored) return fail("Self-check can’t be exported to PDF yet.", id);
				const prompt = data.content as { task: string; parts: { id: string }[] };
				let full: Content;
				try {
					full = structuredClone(authored);
					validateContent(full);
					if (
						Object.hasOwn(full, "context") ||
						full.task !== prompt.task ||
						full.parts.length !== prompt.parts.length ||
						full.parts.some((part, index) => part.id !== prompt.parts[index].id) ||
						[
							full.task,
							full.model,
							...full.parts.flatMap((part) => [part.label, part.missed, part.evidence ?? ""]),
						].some((text) => invalidLiteralControl.test(text))
					)
						throw new Error();
				} catch {
					throw Object.assign(
						new CoursePdfError(lesson.id, id, "Invalid self-check answer-sheet content."),
						{ code: "ESELFCHECKPDFCONTENT" },
					);
				}
				const measure = pageWidthPt[options.pageSize ?? "a4"] - (2 * pageMarginCm * 72) / 2.54;
				// 1.8 em allows margin beyond the widest packaged Latin face, including legacy OpenDyslexic.
				// shortcut: the prefilter and 16-grapheme pieces target normal widths; measure pieces for narrow columns.
				const capacity = Math.floor(
					(measure -
						Math.max(coursePdfTextLayout.questionInsetPt, 2 * coursePdfTextLayout.bodySizePt)) /
						(coursePdfTextLayout.bodySizePt * 1.8),
				);
				const literal = (text: string, width = "size.width", runCapacity = capacity) =>
					coursePdfLiteral([{ text, marker: null }], width, runCapacity);
				const taskMeasure =
					(coursePdfTextLayout.slideMeasureMm * 72) / 25.4 - coursePdfTextLayout.questionInsetPt;
				const number = ++questionCount;
				const labels = selfCheckStrings[resolveLocale(blockLocale)];
				content = `#px-question(size => [#px-eyebrow[Q${number}] ${literal(prompt.task, "size.width", Math.floor(taskMeasure / (coursePdfTextLayout.bodySizePt * 1.8)))}\n\n${escapeTypst(labels.answer)}\n\n#v(2cm)]) <q-${number}>`;
				const model = coursePdfLiteral(
					annotate(full.model, full.parts, []).map((segment) => ({
						text: segment.text,
						marker: segment.partIndex === null ? null : segment.partIndex + 1,
					})),
					"size.width",
					capacity,
				);
				const legend = full.parts
					.map(
						(part) =>
							`[#layout(size => [#strong[${literal(part.label)}]\n\n${part.evidence === null ? `${literal(labels.whole)}\n\n` : ""}${literal(part.missed)}])]`,
					)
					.join(",\n");
				answers.push(
					() =>
						`#layout(size => [#text(${language(blockLocale, lesson.id, id)})[#link(<q-${number}>)[Q${number}]\n\n${literal(prompt.task)}\n\n#strong[${literal(labels.model)}]\n\n${model}\n\n#strong[${literal(labels.legend)}]\n\n#enum(tight: false, spacing: 1.5em,\n${legend}\n)\n\n]])`,
				);
			} else if (block.type === "assessment" || block.type === "rating") {
				if (inAnswers) fail("Questions nested in feedback are not supported.", id);
				questionIds.add(id);
				const number = ++questionCount;
				const rendered = renderPdfAssessment(block, {
					locale: blockLocale,
					answerLines: groups.some(
						(group) => group.journal && Array.isArray(group.members) && group.members.includes(id),
					),
					number,
					includeAnswers: options.includeAnswerSheet === true,
					renderBlocks: renderPromptBlocks,
					rich: (html) => rich(html, id),
					image: (src, alt, settings) => image(src, alt, settings, id),
					heading,
					fail: (message) => fail(message, id),
				});
				content = rendered.body;
				if (record(data.response) && data.response.type === "hotspot")
					warn("Hotspot tasks need author review for nonvisual task equivalence.", id);
				if (rendered.answer)
					answers.push(() => {
						inAnswers = true;
						activeLocale = blockLocale;
						scope = newScope();
						const result = finish(
							scope,
							`#block(sticky: true)[\n\n#link(<q-${number}>)[Q${number}]\n\n]\n\n${rendered.answer?.()}`,
						).body;
						inAnswers = false;
						for (const target of linkTargets)
							if (!printedIds.has(target))
								fail("Internal link targets hidden or missing content.", target);
						return `#text(${language(blockLocale, lesson.id, id)})[${result}]`;
					});
			} else if (block.type === "assessmentGroup") {
				const journal = data.mode == null || data.mode === "";
				if (!journal && !["all", "oneOf"].includes(String(data.mode)))
					fail(`Unsupported assessment group mode: ${String(data.mode)}.`, id);
				groups.push({ id, members: data.memberBlockIds, journal });
				const groupCopy = blockLocale.startsWith("fr") ? copy.fr : copy.en;
				content = journal
					? heading(`#text(font: px-body-font)[${field(data, "groupName")}]`, 3)
					: `#strong[${field(data, "groupName")}]\n\n${escapeTypst(groupCopy[data.mode as "all" | "oneOf"])}`;
				for (const [key, label] of [
					["pointsOverride", groupCopy.points],
					["passingScore", groupCopy.passing],
				] as const)
					if (!journal && data[key] !== undefined) {
						if (typeof data[key] !== "number" || !Number.isFinite(data[key]))
							fail("Invalid group scoring reference.", id);
						content += `\n\n${labelWithSeparator(escapeTypst(label), blockLocale)}${data[key]}`;
					}
				if (!journal && data.requireAll === true)
					content += `\n\n${escapeTypst(groupCopy.allCorrect)}`;
			} else
				content = renderPdfContent(block, {
					locale: blockLocale,
					rich: (html) => rich(html, id),
					field,
					renderBlocks,
					image: (src, alt, settings) => image(src, alt, settings, id),
					heading,
					equation: (latex, alt) => equation(latex, alt, id, true, blockLocale),
					chart: theme.chart,
					link: (target, label) => link(target, label, id),
					fail: (message) => fail(message, id),
					warn: (message) => warn(message, id),
				});
			if (!inAnswers)
				for (const segment of pageNarration)
					if (segment.blockId === id && !renderedNarration.has(segment.id)) supplement(segment);
			activeLocale = previousLocale;
			if (!content && !["blockBreak", "variable", "pageBreak"].includes(block.type))
				fail("Empty content block.", id);
			if (!content) return "";
			// A heading's own stickiness stops at this wrapper, so the wrapper keeps it with what follows.
			// Surrounding paragraph breaks make lone inline text a tagged P rather than a block Span.
			return `${inAnswers ? "" : aliases(id, blockAliases.get(id) ?? [block.name, data.name])}\n#block${block.type === "heading" ? "(sticky: true)" : ""}[\n\n${block.locale ? `#text(${language(block.locale, lesson.id, id)})[${content}]` : content}\n\n]${inAnswers ? "" : ` <${anchor(id)}>`}`;
		};
		const withSkippableBlock = <T>(block: PraxityBlock, run: () => T, skipped: T): T => {
			// ponytail: copy state per block for safe rollback; stage mutations if huge workbooks make this costly.
			const before = {
				ids: new Set(ids),
				printedIds: new Set(printedIds),
				questionIds: new Set(questionIds),
				headingIds: new Set(headingIds),
				renderedNarration: new Set(renderedNarration),
				assetSources: new Map(assetSources),
				answers: answers.length,
				retrievalAnswers: retrievalAnswers.length,
				groups: groups.length,
				linkTargets: linkTargets.length,
				pageNotes: pageNotes.length,
				snippets: scope.snippets.length,
				diagnostics: diagnostics.length,
				headingRanks: [...headingRanks],
				headingNotice,
				questionCount,
				noteParagraph,
				usesMath,
				activeLocale,
			};
			try {
				return run();
			} catch (error) {
				if (!(error instanceof CoursePdfError) || !skippableBlockError(error.reason)) throw error;
				for (const [target, saved] of [
					[ids, before.ids],
					[printedIds, before.printedIds],
					[questionIds, before.questionIds],
					[headingIds, before.headingIds],
					[renderedNarration, before.renderedNarration],
				] as const) {
					target.clear();
					for (const value of saved) target.add(value);
				}
				assetSources.clear();
				for (const [key, value] of before.assetSources) assetSources.set(key, value);
				answers.length = before.answers;
				retrievalAnswers.length = before.retrievalAnswers;
				groups.length = before.groups;
				linkTargets.length = before.linkTargets;
				pageNotes.length = before.pageNotes;
				scope.snippets.length = before.snippets;
				diagnostics.length = before.diagnostics;
				headingRanks.splice(0, headingRanks.length, ...before.headingRanks);
				headingNotice = before.headingNotice;
				questionCount = before.questionCount;
				noteParagraph = before.noteParagraph;
				usesMath = before.usesMath;
				activeLocale = before.activeLocale;
				skip(
					record(block) && typeof block.id === "string" ? block.id : undefined,
					error.reason === "Empty content block." ? "empty" : error.reason,
				);
				return skipped;
			}
		};
		const renderBlock = (block: PraxityBlock): string =>
			withSkippableBlock(
				block,
				() => {
					if (
						record(block) &&
						record(block.data) &&
						block.visible !== false &&
						!hidden(block.data)
					) {
						staticData(block.data, block.id);
						if (!inAnswers && ids.has(block.id)) fail("Duplicate block ID.", block.id);
					}
					if (
						record(block) &&
						record(block.data) &&
						block.type === "code" &&
						typeof block.data.code === "string" &&
						!block.data.code.trim()
					) {
						skip(block.id, "empty");
						return "";
					}
					if (
						record(block) &&
						record(block.data) &&
						block.type === "text" &&
						typeof block.data.content === "string" &&
						emptyText(block.data.content)
					) {
						validateRich(block.data.content, block.id);
						skip(block.id, "empty");
						return "";
					}
					return renderBlockUnsafe(block);
				},
				"",
			);
		let pageData: Record<string, unknown> = {};
		let pageId = typeof pageData.id === "string" ? pageData.id : "first-page";
		let pageBlocks: PraxityBlock[] = [];
		let pageHidden = hidden(pageData);
		const fragments: Array<{ body: string; notes: string }> = [];
		const pageContents: string[] = [];
		const flushPage = () => {
			if (pageHidden) return;
			staticData(pageData, pageId);
			const selected = dropSourceLists(select(pageBlocks));
			const sourceBlocks = new Map<string, PraxityBlock>();
			const inspect = (value: unknown): void => {
				if (Array.isArray(value)) {
					for (const child of value) inspect(child);
					return;
				}
				if (!record(value)) return;
				if (typeof value.id === "string" && typeof value.type === "string" && record(value.data)) {
					if (sourceBlocks.has(value.id)) fail("Duplicate block ID.", value.id);
					sourceBlocks.set(value.id, value as unknown as PraxityBlock);
					blockAliases.set(value.id, [
						...new Set(
							[value.name, value.data.name].filter(
								(name): name is string => typeof name === "string" && !!name,
							),
						),
					]);
				}
				for (const [key, child] of Object.entries(value))
					if (
						!isInlineProjectionMetadataKey(key, { keepDisplay: true }) &&
						(key !== "feedback" || options.includeAnswerSheet)
					)
						inspect(child);
			};
			inspect(selected);
			const normalized = adaptGrammarPreviewBlocks(
				selected,
				lesson.componentDefaults,
				lesson.locale,
				{ moduleDeck: lesson.moduleDeck },
			);
			const restoreHeadings = (value: unknown): void => {
				if (Array.isArray(value)) {
					for (const child of value) restoreHeadings(child);
					return;
				}
				if (!record(value)) return;
				const source = typeof value.id === "string" ? sourceBlocks.get(value.id) : undefined;
				if (source?.type === "heading" && value.type === "heroCover" && record(value.data))
					value.data = {
						...value.data,
						title: source.data.content,
						level: source.data.level,
						kicker: source.data.kicker,
					};
				if (source?.type === "columns" && value.type === "imageComparison" && record(value.data)) {
					const items = Array.isArray(source.data.items) ? source.data.items : [];
					const nested =
						items.length === 2 &&
						items.every(
							(item) =>
								record(item) &&
								Array.isArray(item.children) &&
								item.children.length === 1 &&
								record(item.children[0]) &&
								item.children[0].type === "image",
						);
					const index = selected.indexOf(source);
					const images = nested
						? items
								.map((item) => (item as Data).children as PraxityBlock[])
								.map((children) => children[0])
						: selected.slice(index + 1, index + 3);
					for (const [index, side] of ["before", "after"].entries()) {
						const original = images[index];
						if (original?.type !== "image") continue;
						if (original.data.captionEnabled === false) delete value.data[`${side}Caption`];
						value.data[`${side}Image`] = {
							...(record(value.data[`${side}Image`]) && (value.data[`${side}Image`] as Data)),
							altText: original.a11y?.altText ?? original.data.altText ?? original.data.alt,
							decorative: original.a11y?.decorative ?? original.data.decorative,
						};
					}
				}
				for (const [key, child] of Object.entries(value))
					if (!isInlineProjectionMetadataKey(key, { keepDisplay: true })) restoreHeadings(child);
			};
			restoreHeadings(normalized);
			printedIds.add(pageId);
			scope = newScope();
			pageNarration = [];
			renderedNarration.clear();
			if (lesson.narrationEnabled !== false) {
				const segments = extractNarrationSegments(
					String(pageData.title ?? ""),
					pageData,
					selected,
					{},
					lesson.locale,
				);
				pageNarration = segments.filter(
					(segment) => segment.custom && !segment.disabled && segment.script.trim(),
				);
				if (segments.some((segment) => segment.audioUrl && !segment.custom && !segment.disabled))
					warn("Recorded narration without a custom script is not transcribed in the PDF.", pageId);
			}
			pageNotes.length = 0;
			noteParagraph = 0;
			for (const segment of pageNarration)
				if (segment.kind === "pageTitle" && !segment.blockId) supplement(segment);
			// Text runs keep a readable measure; figures, tables and code take the full width. A run
			// ending in a heading stays with the figure after it.
			const parts: Array<{ wide: boolean; sticky: boolean; body: string }> = [];
			const add = (block: PraxityBlock) => {
				const body = renderBlock(block);
				if (!body) return;
				const wide = WIDE_BLOCKS.has(block.type);
				const last = parts.at(-1);
				if (!wide && last && !last.wide) {
					last.body += `\n\n${body}`;
					last.sticky = block.type === "heading";
				} else parts.push({ wide, sticky: block.type === "heading", body });
			};
			// Authored wrap: a small or medium floated image sits at its side with following blocks
			// beside it. Large floats stack, as the published page does at this width.
			// Wrapped text splits into paragraphs and list items so it can continue below the image
			// mid-block, as it does on the page. Consecutive items regroup into one list in Typst.
			const wrapUnits = (block: PraxityBlock) =>
				withSkippableBlock(
					block,
					() => {
						const { data, id } = block;
						staticData(data, id);
						if (ids.has(id)) fail("Duplicate block ID.", id);
						if (emptyText(data.content as string)) {
							validateRich(data.content, id);
							skip(id, "empty");
							return [];
						}
						validateRich(data.content, id);
						ids.add(id);
						printedIds.add(id);
						const previousLocale = activeLocale;
						activeLocale = block.locale ?? activeLocale;
						const lang = block.locale
							? `#set text(${language(block.locale, lesson.id, id)})\n`
							: "";
						const units: Array<{ item: boolean; body: string }> = [];
						for (const node of parseFragment(String(data.content)).childNodes) {
							if (!("tagName" in node)) {
								if ("value" in node && node.value.trim())
									units.push({ item: false, body: rich(node.value, id) });
								continue;
							}
							if (node.tagName !== "ul" && node.tagName !== "ol") {
								units.push({
									item: false,
									body: rich(
										serialize({ nodeName: "#document-fragment", childNodes: [node] } as never),
										id,
									),
								});
								continue;
							}
							const start = Number(node.attrs.find((a) => a.name === "start")?.value ?? 1);
							node.childNodes
								.filter((child) => "tagName" in child && child.tagName === "li")
								.forEach((item, index) =>
									units.push({
										item: true,
										body: `${node.tagName === "ol" ? `#enum.item(${Number.isSafeInteger(start) ? start + index : index + 1})` : "#list.item"}[${lang}${rich(serialize(item as never), id)}]`,
									}),
								);
						}
						for (const segment of pageNarration)
							if (segment.blockId === id && !renderedNarration.has(segment.id)) supplement(segment);
						activeLocale = previousLocale;
						if (!units.length) return [];
						units[0].body = `#metadata(none) <${anchor(id)}>${aliases(id, blockAliases.get(id) ?? [block.name, data.name])}${units[0].item ? "" : lang}${units[0].body}`;
						for (const unit of units.slice(1)) if (!unit.item) unit.body = `${lang}${unit.body}`;
						return units;
					},
					[] as Array<{ item: boolean; body: string }>,
				);
			for (const region of imageFloatRegions(normalized)) {
				const [image, ...flow] = region.blocks;
				const share = region.float ? IMAGE_SIZES[String(image.data.width)] : undefined;
				if (!share || share > 0.5) {
					region.blocks.forEach(add);
					continue;
				}
				const picture = renderBlock({ ...image, data: { ...image.data, width: undefined } });
				if (!picture) {
					flow.forEach(add);
					continue;
				}
				const beside = flow.flatMap((block) =>
					record(block) &&
					block.type === "text" &&
					record(block.data) &&
					typeof block.data.content === "string"
						? wrapUnits(block)
						: [{ item: false, body: `#block[${renderBlock(block)}]` }],
				);
				parts.push({
					wide: true,
					sticky: false,
					body: `#px-float(${region.float}, ${share}, [${picture}], (${beside.map((unit) => `(${unit.item}, [${unit.body}])`).join(", ")}${beside.length ? "," : ""}))`,
				});
			}
			for (const segment of pageNarration)
				if (!renderedNarration.has(segment.id)) supplement(segment);
			const narrated = pageNotes.length > 0;
			const prepared = finish(
				scope,
				`(${(parts.length ? parts : [{ wide: false, sticky: false, body: "" }]).map((part, index) => `(${part.wide}, ${part.sticky}, [${index === 0 ? "\u0000PDFSLIDEHEAD" : ""}${part.body}])`).join(", ")},)`,
				pageNotes.join(", "),
			);
			if (parts.length || narrated) {
				const label = pageData.title ?? pageData.label;
				const titled = typeof label === "string" && label.trim();
				if (titled) pageContents.push(`#px-toc(<${anchor(pageId)}>)[${escapeTypst(label)}]`);
				// Navigation labels are not visible titles; show one only where no heading opens the slide.
				const first = normalized[0]?.data ?? {};
				const opening = [first.content, first.title, first.groupName].find(
					(value) => typeof value === "string",
				);
				const opensWithHeading =
					["heading", "heroCover"].includes(String(normalized[0]?.type)) ||
					(typeof label === "string" &&
						typeof opening === "string" &&
						stripHtml(opening).trim().toLowerCase() === label.trim().toLowerCase());
				fragments.push({
					body: prepared.body.replace(
						"\u0000PDFSLIDEHEAD",
						() =>
							`#metadata(none) <${anchor(pageId)}>\n${aliases(pageId, [pageData.name])}\n${titled && !opensWithHeading ? `#block(sticky: true)[#px-eyebrow[${escapeTypst(label)}]]\n\n` : ""}`,
					),
					notes: prepared.notes,
				});
			}
		};
		const validBlocks: PraxityBlock[] = [];
		for (const source of lesson.blocks) {
			if (
				record(source) &&
				source.type === "pageBreak" &&
				(!record(source.data) || typeof source.id !== "string" || !source.id)
			)
				fail("Invalid page boundary.", typeof source.id === "string" ? source.id : undefined);
			if (!record(source) || !record(source.data)) {
				skip(
					record(source) && typeof source.id === "string" ? source.id : undefined,
					"Invalid block.",
				);
				continue;
			}
			if (source.type === "pageBreak") pageData = source.data;
			validBlocks.push(source);
		}
		for (const page of partitionLessonPages(validBlocks)) {
			pageBlocks = page.blocks;
			pageData = page.boundary?.data ?? {};
			pageId = page.boundary?.id ?? (typeof pageData.id === "string" ? pageData.id : "first-page");
			pageHidden = hidden(pageData) || page.boundary?.visible === false;
			flushPage();
		}
		const grouped = new Set<string>();
		for (const group of groups) {
			if (
				!Array.isArray(group.members) ||
				!group.members.length ||
				new Set(group.members).size !== group.members.length ||
				group.members.some(
					(id) => typeof id !== "string" || !questionIds.has(id) || grouped.has(id),
				)
			)
				fail("Assessment group references missing or duplicate printed questions.", group.id);
			for (const id of group.members as string[]) grouped.add(id);
		}
		for (const target of linkTargets)
			if (!printedIds.has(target)) fail("Internal link targets hidden or missing content.", target);
		const slides = fragments.map(({ body, notes }) =>
			notes
				? `#px-slide(${typstString(local.narration)}, ${body}, (${notes},))`
				: `#px-parts(${body})`,
		);
		if (lesson.design?.glossaryPage === true && glossary.size)
			slides.push(
				`#heading(level: 1)[${escapeTypst(local.glossary)}]\n\n${[...glossary.values()].map((term) => `#strong[${escapeTypst(term.term)}] — ${escapeTypst(term.definition)}`).join("\n\n")}`,
			);
		if (slides.length) {
			contents.push(
				`#text(${locale})[#strong[#px-toc(<${anchor("lesson-banner")}>)[${escapeTypst(lesson.title)}]]${pageContents.length ? `\n\n#list(${pageContents.map((entry) => `[${entry}]`).join(", ")})` : ""}]`,
			);
			body.push(
				`#pagebreak(weak: true)\n#text(${locale})[\n#heading(level: 1, bookmarked: true)[${escapeTypst(lesson.title)}] <${anchor("lesson-banner")}>\n\n${slides.join("\n\n#px-break\n\n")}\n]`,
			);
		}
	}
	headingRanks.length = 0;
	// Retrieval subsections follow all ordinary answers, so later Q answers never
	// inherit a sheet's heading scope. Preserve ordinary-only appendix bytes.
	const answerSections = [
		...answers.map((render) => render()),
		...retrievalAnswers.map(
			(render, index) => `${answers.length || index ? "#pagebreak()\n" : ""}${render()}`,
		),
	];
	const appendix = answerSections.length
		? `#pagebreak()\n#heading(level: 1)[${strings.answers}]\n\n${answerSections.join("\n\n")}`
		: "";
	return {
		typstSource: [
			usesMath ? '#import "mitex/lib.typ": mitex' : "",
			`#set document(title: ${typstString(options.title)})`,
			theme.preamble,
			`#set text(${courseLanguage})`,
			"#set smartquote(enabled: false)",
			// Running header and folio repeat on every sheet; Typst tags them as pagination artifacts.
			`#set page(paper: ${typstString(options.pageSize === "letter" ? "us-letter" : "a4")}, margin: (x: ${pageMarginCm}cm, y: 2.5cm), header: { counter(footnote).update(0); context if here().page() > 1 { set text(size: 0.8em, fill: px-line); let here-page = here().page(); let lessons = query(heading.where(level: 1)); let current = lessons.filter(h => h.location().page() == here-page); let before = lessons.filter(h => h.location().page() < here-page); ${typstString(options.title)}; h(1fr); if current.len() > 0 { current.first().body } else if before.len() > 0 { before.last().body } } }, footer: context if here().page() > 1 { set text(size: 0.8em, fill: px-line); h(1fr); counter(page).display() })`,
			`#block(width: 100%, stroke: (left: 4pt + px-accent), inset: (left: 16pt, y: 6pt), above: 3cm, below: 1.5em)[#title[${escapeTypst(options.title)}]]`,
			`#text(size: 0.9em)[${escapeTypst(strings.notice)}${answerSections.length ? ` ${escapeTypst(strings.answersIncluded)}` : ""}]`,
			contents.length
				? `#v(1.5em)\n#heading(level: 1, bookmarked: false, outlined: false)[${escapeTypst(strings.contents)}]\n\n#columns(2, gutter: 1.6em)[#set text(size: 0.85em)\n#set par(spacing: 0.8em)\n${contents.join("\n\n")}]`
				: "",
			...body,
			appendix,
		]
			.filter(Boolean)
			.join("\n\n"),
		questionCount,
		assetSources,
		diagnostics,
		usesMath,
		fonts: theme.fonts,
	};
}

/** Host-neutral: no project loader, Electron, viewer build, network or destination writes. */
export async function exportCoursePdf(
	options: CoursePdfOptions & {
		executablePath: string;
		signal?: AbortSignal;
		temporaryRoot?: string;
	},
): Promise<{ pdf: Buffer; questionCount: number; diagnostics: CoursePdfDiagnostic[] }> {
	assertNoHighlightPdf(options);
	if (!options.executablePath)
		throw new CoursePdfError("course", undefined, "An explicit Typst executable is required.");
	options.signal?.throwIfAborted();
	const fontDir = path.join(path.dirname(options.executablePath), "fonts");
	const availableFonts = new Set(
		await readdir(fontDir).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			throw error;
		}),
	);
	const source = buildCoursePdfSource({ ...options, availableFonts });
	const files = new Map<string, Uint8Array>();
	for (const [reference, filename] of source.assetSources) {
		const bytes = options.resolvedAssets?.get(reference);
		if (!bytes?.length)
			throw new CoursePdfError("course", undefined, `Missing image asset: ${reference}`);
		files.set(filename, bytes);
	}
	for (const slug of source.fonts)
		for (const face of await readdir(path.join(fontDir, slug)))
			if (face.endsWith(".ttf"))
				files.set(
					`fonts/${slug}/${face}`,
					await readFile(path.join(fontDir, slug, face), { signal: options.signal }),
				);
	if (source.usesMath)
		for (const filename of [
			"lib.typ",
			"mitex.typ",
			"mitex.wasm",
			"specs/mod.typ",
			"specs/prelude.typ",
			"specs/latex/standard.typ",
		])
			files.set(
				`mitex/${filename}`,
				await readFile(path.join(path.dirname(options.executablePath), "mitex", filename), {
					signal: options.signal,
				}),
			);
	const pdf = await compileTypst(source.typstSource, {
		executablePath: options.executablePath,
		signal: options.signal,
		temporaryRoot: options.temporaryRoot,
		pdfStandard: "ua-1",
		a11yExtras: true,
		files,
	});
	if (pdf.subarray(0, 5).toString() !== "%PDF-")
		throw new CoursePdfError("course", undefined, "The compiler did not return a PDF.");
	return { pdf, questionCount: source.questionCount, diagnostics: source.diagnostics };
}
