import {
	assessmentFeedbackText,
	assessmentGradingMode,
	decodeEscapes,
	parseFillBlankContent,
} from "@praxity/content-model";
import { escapeHtml } from "@praxity/content-model/constants";
import { parseInlineMarkdown } from "@praxity/content-model/inline-markdown";
import { inlineParagraph, renderInlineTree } from "@praxity/content-model/inline-tree";
import type {
	BlockType,
	HighlightData,
	PraxityBlock,
	PraxityPage,
	RetrievalSheetData,
	SelfCheckPrompt,
	WriteDistractorsData,
} from "@praxity/content-model/types";
import { displayText, normalizeLineEndings } from "../line-endings.ts";
import { parseLogicConditionExpression } from "../logic-condition.ts";
import { parseEffectsExpression } from "../utils.ts";
import { tokenizeInline } from "./inline.ts";
import {
	getDefinition,
	highlightContent,
	maskedBlankContent,
	parseRuleAction,
	retrievalSheetContent,
	SPOT_SETTINGS,
	wordBankEntries,
} from "./schema.ts";
import {
	type AnalyzedLessonTree,
	definitionOf,
	type SourceSpan,
	type TreeNode,
} from "./tree/index.ts";

/** A host resolves these nodes against its identity snapshot. Roles identify source fields
 * without their own tree node, such as a pair's answer or a generated rating label. */
export type LessonIdAllocator = ((node: Readonly<TreeNode>, role?: string) => string) & {
	readonly transient?: boolean;
};
export interface LessonNodeRecord {
	id: string;
	node: TreeNode;
	role?: string;
	range: { start: number; end: number };
}
export interface BlockAdapterResult {
	pages: PraxityPage[];
	blocks: PraxityBlock[];
	nodes: Map<string, LessonNodeRecord>;
}

export function createTransientIdAllocator(): LessonIdAllocator {
	return Object.assign(() => globalThis.crypto.randomUUID(), { transient: true });
}

function settingValue(value: string | boolean, type?: string): unknown {
	if (type === "boolean") return value === true || value === "true";
	if (type === "number" || type === "integer") return Number(value);
	return value;
}

function settings(node: TreeNode, definition = getDefinition(node.type ?? node.kind)) {
	const result: Record<string, unknown> = {};
	for (const [name, declaration] of Object.entries(definition?.settings ?? {})) {
		if (declaration.default !== undefined) result[name] = declaration.default;
	}
	for (const entry of node.settings) {
		const declaration = definition?.settings[entry.name];
		if (declaration?.accepts(entry.value.value)) {
			result[entry.name] = settingValue(entry.value.value, declaration.type);
		}
	}
	return result;
}

const value = (node?: TreeNode) => String(node?.value?.value ?? node?.text?.value ?? "");
const subject = (node: TreeNode) => String(node.subject?.value ?? "");
const authoredSubject = (node: TreeNode) => node.subject?.raw ?? "";
const text = (node: TreeNode) => node.text?.raw ?? node.raw;
const part = (node: TreeNode, name: string) =>
	node.children.find((child) => child.kind === "part" && child.name === name);
const plainParagraphs = (raw: string) =>
	displayText(raw)
		.split(/\n\s*\n/)
		.filter(Boolean)
		.map((paragraph) => paragraph.replace(/\n[ \t]*/g, " "));
const inlineTree = (raw: string) => {
	const tree = tokenizeInline(raw);
	const placeholders = (nodes: typeof tree.children) => {
		for (const node of nodes) {
			if (node.kind === "source") node.raw = `@footer{${node.content.raw}}`;
			if (node.kind === "sources") node.raw = "@footer.insert";
			if ("children" in node) placeholders(node.children);
		}
	};
	// Keep the current footer planner's inert placeholder contract. Source spelling
	// remains in the lossless tree; this projection is only renderer data.
	placeholders(tree.children);
	return tree;
};
const inline = (raw: string, interactive = true) =>
	renderInlineTree(inlineTree(raw), { interactive });

/** Mark HTML-valued fields at projection so consumers never parse them as source. */
const inlineHtmlFields = (fields: Record<string, unknown>) => ({
	...fields,
	_htmlFields: Object.keys(fields),
});

/** Adapt semantic nodes directly to the canonical renderer shapes. Never call the v3 parser. */
export function toBlocks(
	tree: AnalyzedLessonTree,
	options: {
		ids: LessonIdAllocator;
		variables?: Record<string, unknown>;
		cast?: Record<string, unknown>;
	},
): BlockAdapterResult {
	const nodes = new Map<string, LessonNodeRecord>();
	const optionFeedback: TreeNode[] = [];
	let keepInlineTrees = false;
	const assigned = new Map<TreeNode, Map<string, string>>();
	const foldedPageTitles = new Set<TreeNode>();
	const id = (
		node: TreeNode,
		role?: string,
		range: { start: number; end: number } = node.span,
	): string => {
		const roles = assigned.get(node) ?? new Map<string, string>();
		const key = role ?? "";
		const prior = roles.get(key);
		if (prior) return prior;
		const next = options.ids(node, role);
		if (typeof next !== "string" || !next.trim())
			throw new Error("Missing node ID from lesson allocator");
		if (nodes.has(next)) throw new Error(`Duplicate node ID from lesson allocator: ${next}`);
		roles.set(key, next);
		assigned.set(node, roles);
		const location =
			(role === "stem" || role === "title") && node.subject
				? node.subject.span
				: role === "answer" && node.answer
					? node.answer.range
					: range;
		nodes.set(next, {
			id: next,
			node,
			...(role ? { role } : {}),
			range: { start: location.start, end: location.end },
		});
		return next;
	};
	const block = (
		node: TreeNode,
		type: BlockType,
		data: Record<string, unknown>,
		role?: string,
	): PraxityBlock => {
		// Schema defaults remain available to semantic decisions above. Runtime
		// metadata contains authored settings only, under the existing renderer names.
		const resolved = Object.fromEntries(
			node.settings.map((entry) => [entry.name, settings(node)[entry.name]]),
		);
		const { width, level: _level, name, ...rest } = resolved;
		if (node.type === "write-distractors") delete rest.count;
		const consumed: Record<string, string[]> = {
			image: ["size", "effects"],
			video: ["start", "end"],
			audio: ["start", "end"],
			button: ["style", "newTab"],
			assessment: ["shuffle", "style", "download"],
			accordion: ["style"],
			tabs: ["style"],
			sequence: ["style"],
			columns: ["layout", "side"],
			table: ["header", "chart"],
			chart: ["header", "chart"],
			note: ["tone"],
			highlight: ["mode", "maxMarks"],
		};
		for (const key of consumed[type] ?? []) delete rest[key];
		// False is the legacy choice contract: no new data key or policy membership.
		if (node.type === "choice" && rest.private !== true) delete rest.private;
		return {
			id: id(node, role),
			type,
			...(typeof name === "string" ? { name } : {}),
			data: Object.fromEntries(
				Object.entries({ ...rest, ...(width ? { layoutMode: width } : {}), ...data }).filter(
					([, value]) => value !== undefined,
				),
			),
		};
	};
	const textBlock = (node: TreeNode, content: string, role?: string): PraxityBlock => ({
		id: id(node, role),
		type: "text",
		data: { content },
	});
	const prepared = (field: string, raw: string, decoded: string) =>
		inline(raw, false) === inline(decoded, false)
			? {}
			: { _inline: { [field]: inline(raw, false) } };
	const paragraphTrees = (raw: string) =>
		displayText(raw)
			.split(/\n\s*\n/)
			.filter(Boolean)
			.map((paragraph) => inlineParagraph(inlineTree(paragraph.replaceAll("\n", " "))));
	const paragraphs = (raw: string) =>
		paragraphTrees(raw)
			.map((tree) => renderInlineTree(tree))
			.join("");
	const paragraphField = (raw: string) => {
		const trees = paragraphTrees(raw);
		const content = trees.map((tree) => renderInlineTree(tree)).join("");
		return {
			content,
			...(keepInlineTrees ? { _inlineTrees: { content: { trees, display: content } } } : {}),
		};
	};
	const partText = (node: TreeNode, name: string) => {
		const field = part(node, name);
		return field ? displayText(field.value?.raw ?? "") : undefined;
	};
	const boundInline = (node: TreeNode, raw: string, role?: string) =>
		`<span data-node-id="${escapeHtml(id(node, role))}">${inline(displayText(raw))}</span>`;
	const bodyHtml = (child: PraxityBlock): string => {
		let content = typeof child.data.content === "string" ? child.data.content : "";
		// HTML-valued prose containers keep Markdown's native block elements. Their
		// current renderer interface is a string, so retain each source wrapper here.
		if (child.type === "heading") {
			const level = Number(child.data.level);
			content = `<h${level}>${content.replace(/^<p>|<\/p>$/g, "")}</h${level}>`;
		}
		if (child.type === "image")
			content = `<img src="${escapeHtml(String(child.data.src ?? ""))}" alt="${escapeHtml(String(child.data.alt ?? ""))}">`;
		if (child.type === "table") {
			const headers = child.data.headers as string[];
			const rows = child.data.rows as string[][];
			content = `<table><thead><tr>${headers.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
		}
		if (child.type === "divider") content = "<hr>";
		if (child.type === "code")
			content = `<pre><code>${escapeHtml(String(child.data.code ?? ""))}</code></pre>`;
		if (child.type === "equation") content = inline(`$${String(child.data.latex ?? "")}$`);
		return `<div data-node-id="${escapeHtml(child.id)}">${content}</div>`;
	};
	const listHtml = (node: TreeNode): string => {
		const tag = node.ordered ? "ol" : "ul";
		const loose = node.children.some(
			(entry) =>
				/\r?\n\s*\r?\n/.test(displayText(entry.raw)) ||
				entry.children.some((child) => child.kind === "body"),
		);
		return `<${tag}${node.ordered && node.startNumber !== 1 ? ` start="${node.startNumber}"` : ""}>${node.children
			.map(
				(entry) =>
					`<li data-node-id="${escapeHtml(id(entry))}">${bodyBlocks(
						entry,
						entry.header ?? entry.span,
						entry.text?.range.start,
					)
						.map((child) =>
							loose
								? bodyHtml(child)
								: bodyHtml(child).replace(
										/^(<div[^>]*>)<p>((?:(?!<\/?p>)[\s\S])*)<\/p>(<\/div>)$/,
										"$1$2$3",
									),
						)
						.join(
							"",
						)}${entry.children.map((child) => (child.kind === "list" ? listHtml(child) : bodyBlocks(child).map(bodyHtml).join(""))).join("")}</li>`,
			)
			.join("")}</${tag}>`;
	};
	const bodyBlocks = (
		node: TreeNode,
		location: SourceSpan = node.span,
		contentStart = location.start,
	): PraxityBlock[] => {
		const lines = tree.stream.lines.filter(
			(line) => line.start >= location.start && line.end <= location.end,
		);
		const result: PraxityBlock[] = [];
		let pending = "";
		let run = 0;
		const flush = () => {
			if (pending.trim())
				result.push(
					block(node, "text", paragraphField(pending), run++ ? `prose:${run}` : undefined),
				);
			pending = "";
		};
		for (let index = 0; index < lines.length; index++) {
			const line = lines[index];
			if (line.kind === "code-fence" || line.kind === "math-fence") {
				flush();
				const kind = line.kind;
				const opener = tree.stream.source.slice(line.start, line.contentEnd);
				const start = line.end;
				while (index + 1 < lines.length && lines[index + 1].kind !== kind) index++;
				const closer = lines[index + 1];
				const content = normalizeLineEndings(
					tree.stream.source.slice(start, closer?.start ?? node.span.end),
				);
				result.push(
					block(
						node,
						kind === "code-fence" ? "code" : "equation",
						kind === "code-fence"
							? {
									code: content.replace(/\r?\n$/, ""),
									language: opener.replace(/^\s*(?:`{3,}|~{3,})/, "").trim(),
								}
							: { latex: content.trim() },
						result.length ? `fence:${line.start}` : undefined,
					),
				);
				if (closer) index++;
			} else pending += tree.stream.source.slice(Math.max(line.start, contentStart), line.end);
		}
		flush();
		return result;
	};
	const children = (node: TreeNode) =>
		node.children
			.filter((child) => child.kind !== "part" && child.kind !== "back")
			.flatMap(convert);
	const proseChildren = (node: TreeNode) =>
		node.children
			.filter(
				(child) =>
					["body", "heading", "table", "image"].includes(child.kind) ||
					child.type === "text" ||
					(node.type === "free-response" && child.kind === "list"),
			)
			.flatMap(convert);
	const proseHtml = (node: TreeNode, exclude?: TreeNode) =>
		children(node)
			.filter((child) => !exclude || child.id !== id(exclude))
			.map(bodyHtml)
			.join("");
	const descendants = (node: TreeNode, kind: string): TreeNode[] =>
		node.children.flatMap((child) => (child.kind === kind ? [child] : descendants(child, kind)));
	const scale = (node: TreeNode) => {
		const steps = node.children
			.filter((child) => child.kind === "list" && child.ordered)
			.flatMap((list) => list.children);
		return steps.length
			? steps.map((step, index) => ({ id: id(step), value: index + 1, label: value(step) }))
			: Array.from({ length: Number(settings(node).scale ?? 0) }, (_, index) => ({
					id: id(node, `level:${index + 1}`),
					value: index + 1,
					label: String(index + 1),
				}));
	};
	const assessment = (node: TreeNode): PraxityBlock => {
		const s = settings(node);
		const type = node.type;
		const previousInlineTrees = keepInlineTrees;
		keepInlineTrees = type === "choice";
		const stem = [{ ...textBlock(node, "", "stem"), data: paragraphField(authoredSubject(node)) }];
		const choiceOptions =
			type === "choice" ? node.children.filter((child) => child.kind === "option") : [];
		for (const option of choiceOptions) {
			const field = part(option, "feedback");
			if (field && partText(option, "feedback")) optionFeedback.push(field);
		}
		const optionFor = (correct: boolean) =>
			choiceOptions.find((option) => option.correct === correct && partText(option, "feedback"));
		const correctOption = optionFor(true);
		const incorrectOption = optionFor(false);
		const feedbackText = assessmentFeedbackText(
			{
				correct: partText(node, "correct"),
				incorrect: partText(node, "incorrect"),
				feedback: partText(node, "feedback"),
			},
			{
				correct: correctOption ? partText(correctOption, "feedback") : undefined,
				incorrect: incorrectOption ? partText(incorrectOption, "feedback") : undefined,
			},
		);
		const resultFeedback = (name: "correct" | "incorrect") => {
			const text = feedbackText[name];
			if (!text) return undefined;
			const field =
				part(node, name) ??
				part(optionFor(name === "correct") ?? node, "feedback") ??
				part(node, "feedback");
			return field ? [textBlock(field, paragraphs(text), name)] : undefined;
		};
		const feedback = { correct: resultFeedback("correct"), incorrect: resultFeedback("incorrect") };
		const common = {
			stem,
			// Retain the source of compatibility-promoted option feedback so the
			// activity renderer can place it beside that option without repetition.
			...(correctOption || incorrectOption
				? {
						_feedbackOptionIds: {
							...(!partText(node, "correct") && correctOption
								? { correct: id(correctOption) }
								: {}),
							...(!partText(node, "incorrect") && incorrectOption
								? { incorrect: id(incorrectOption) }
								: {}),
						},
					}
				: {}),
			...(type !== "hotspot" ? { stemLevel: node.headingLevel } : {}),
			...(proseChildren(node).length ? { description: proseChildren(node) } : {}),
			feedback,
			...(feedback.correct || feedback.incorrect ? { feedbackEnabled: true } : {}),
			...(partText(node, "feedback") && !feedback.correct && !feedback.incorrect
				? { feedbackEnabled: false }
				: {}),
			gradingMode: assessmentGradingMode(s.scored),
		};
		const placeholder = partText(node, "placeholder");
		let response: Record<string, unknown>;
		switch (type) {
			case "choice": {
				const options = node.children.filter((child) => child.kind === "option");
				response = {
					type: "choice",
					selectionMode: options[0]?.optionKind === "multiple" ? "multiple" : "single",
					inputMethod: "click",
					display: "list",
					...(s.shuffle !== undefined ? { shuffle: s.shuffle === true } : {}),
					options: options.map((option) => {
						const label = value(option);
						const raw = displayText(text(option));
						const display = prepared("label", raw, label);
						return {
							id: id(option),
							label,
							...display,
							_inlineTrees: {
								label: {
									trees: [
										Object.keys(display).length ? inlineTree(raw) : parseInlineMarkdown(label),
									],
									display:
										display._inline?.label ??
										renderInlineTree(parseInlineMarkdown(label), { interactive: false }),
								},
							},
							isCorrect: option.correct === true,
							...(partText(option, "feedback") ? { feedback: partText(option, "feedback") } : {}),
						};
					}),
				};
				break;
			}
			case "match":
				response = {
					type: "matching",
					inputMethod: "dropdown",
					placeholder,
					distractors: [],
					pairs: node.children
						.filter((child) => child.kind === "pair")
						.map((pair) => ({
							id: id(pair),
							matchId: id(pair, "answer"),
							...inlineHtmlFields({
								prompt: inline(text(pair)),
								correctMatch: inline(pair.answer?.raw ?? ""),
							}),
						})),
				};
				break;
			case "order":
				response = {
					type: "sequence",
					inputMethod: "drag",
					items: descendants(node, "step").map((step, index) => ({
						id: id(step),
						...inlineHtmlFields({ label: inline(text(step)) }),
						correctPosition: index,
					})),
				};
				break;
			case "categorize":
				response = {
					type: "categorize",
					categories: node.children
						.filter((child) => child.kind === "item")
						.map((category) => {
							const entries = descendants(category, "list-entry");
							return {
								id: id(category),
								name: subject(category),
								...inlineHtmlFields({ items: entries.map((entry) => inline(text(entry))) }),
								itemIds: entries.map((entry) => id(entry)),
							};
						}),
				};
				break;
			case "fill-blank": {
				const template = node.children
					.filter((child) => child.kind === "body")
					.map((child) => child.raw)
					.join("\n")
					.trim();
				const masked = maskedBlankContent(template);
				// Escape protected braces in the legacy template so its blank scanner agrees
				// with the schema. Raw spelling remains in the lossless tree.
				const safeTemplate = template
					.split("")
					.map((char, index) =>
						masked[index] !== char && "{}_".includes(char) ? `\\${char}` : char,
					)
					.join("");
				response = {
					type: "fillBlank",
					template: safeTemplate,
					...(s.style !== "typed" ? { style: s.style } : {}),
					placeholder,
					blanks: parseFillBlankContent(masked, s.style).map((blank, index) => ({
						id: id(node, `blank:${index}`),
						...blank,
					})),
					...(s.style === "word-bank" ? { wordBank: wordBankEntries(node) } : {}),
				};
				delete common.description;
				break;
			}
			case "free-response":
				response = { type: "textResponse", inputType: "long", placeholder, downloadAs: s.download };
				break;
			case "matrix":
				response = {
					type: "matrix",
					selectionMode: "single",
					scalePoints: scale(node),
					statements: node.children
						.filter((child) => child.kind === "list" && !child.ordered)
						.flatMap((list) => descendants(list, "list-entry"))
						.map((entry) => ({
							id: id(entry),
							...inlineHtmlFields({ text: inline(text(entry)) }),
						})),
				};
				break;
			case "hotspot": {
				const image = node.children.find((child) => child.kind === "image");
				response = {
					type: "hotspot",
					image: String(image?.source?.value ?? ""),
					imageAlt: String(image?.alt?.value ?? ""),
					imageId: image ? id(image) : undefined,
					mode: "select",
					selectionMode: "single",
					hotspots: node.children
						.filter((child) => child.kind === "spot")
						.map((spot) => {
							const geometry = Object.fromEntries(
								(spot.bodySettings ?? []).map((entry) => [
									entry.name,
									settingValue(entry.value.value, SPOT_SETTINGS[entry.name]?.type),
								]),
							);
							const coords =
								geometry.shape === "polygon"
									? String(geometry.points)
											.split(/[,\s]+/)
											.filter(Boolean)
											.map(Number)
									: geometry.shape === "rect"
										? [geometry.x, geometry.y, geometry.w, geometry.h]
										: geometry.shape === "ellipse"
											? [geometry.x, geometry.y, geometry.rx, geometry.ry]
											: [geometry.x, geometry.y, 6];
							return {
								id: id(spot),
								label: value(spot),
								shape:
									geometry.shape === "rect" || geometry.shape === "polygon"
										? geometry.shape
										: "ellipse",
								coords,
								isCorrect: geometry.correct === true,
								indicator: { type: "number" },
							};
						}),
				};
				delete common.description;
				if (proseChildren(node).some((child) => child.type !== "image"))
					common.description = proseChildren(node).filter((child) => child.type !== "image");
				break;
			}
			default:
				throw new Error(`Unsupported assessment ${type}`);
		}
		const result = block(node, "assessment", {
			...common,
			assessmentType: response.type,
			response,
			...(partText(node, "button") ? { buttonLabel: partText(node, "button") } : {}),
		});
		keepInlineTrees = previousInlineTrees;
		return result;
	};
	const table = (node: TreeNode, owner = node): PraxityBlock => {
		const rows = (node.rows ?? []).map((row) => row.cells.map((cell) => cell.value));
		const s = settings(owner);
		const parts = Object.fromEntries(
			owner.children
				.filter((child) => child.kind === "part")
				.map((child) => [
					child.name === "alt" ? "altText" : child.name,
					displayText(child.value?.raw ?? ""),
				]),
		);
		if (owner.type === "stats")
			return block(owner, "stats", {
				...parts,
				items: rows.map((row) => ({ value: row[0], label: row.slice(1).join(" ") })),
			});
		if (s.chart)
			return block(owner, "chart", {
				...parts,
				chartType: s.chart === "stacked" ? "bar" : s.chart,
				stacked: s.chart === "stacked",
				xAxisLabel: parts.xLabel,
				yAxisLabel: parts.yLabel,
				data: {
					labels: rows.slice(1).map((row) => row[0]),
					series: (rows[0] ?? []).slice(1).map((name, column) => ({
						name,
						values: rows.slice(1).map((row) => Number(row[column + 1])),
					})),
				},
			});
		return block(owner, "table", {
			...parts,
			headers: rows[0] ?? [],
			rows: rows.slice(1),
			// Preserve grammar 4 inline semantics beside the raw cell values used by
			// sorting and charts. The display preparer still accepts legacy Markdown.
			...(rows.some((row) => row.some((cell) => /@source(?:s|\{)/.test(String(cell))))
				? {
						_inline: {
							headers: (node.rows?.[0]?.cells ?? []).map((cell) => inline(cell.raw)),
							rows: (node.rows ?? [])
								.slice(1)
								.map((row) => row.cells.map((cell) => inline(cell.raw))),
						},
					}
				: {}),
			...(owner.settings.some((entry) => entry.name === "header")
				? {
						highlightHeaderRow: s.header !== "none" && s.header !== "column",
						highlightHeaderCol: s.header === "column",
					}
				: {}),
			columnAlignments:
				typeof s.columnAlignments === "string"
					? s.columnAlignments.split(/[,\s]+/)
					: node.alignments?.some(Boolean)
						? node.alignments.map((alignment) => alignment ?? "left")
						: undefined,
		});
	};
	function convert(node: TreeNode): PraxityBlock[] {
		if (node.kind === "part" || node.kind === "frontmatter") return [];
		if (node.kind === "body") return bodyBlocks(node);
		if (node.kind === "recovery")
			return [block(node, "text", { content: `<p>${escapeHtml(node.raw)}</p>` })];
		if (node.kind === "heading")
			return [
				block(node, "heading", {
					content: `<p>${inline(authoredSubject(node))}</p>`,
					...(keepInlineTrees
						? {
								_inlineTrees: {
									content: {
										trees: [inlineParagraph(inlineTree(authoredSubject(node)))],
										display: `<p>${inline(authoredSubject(node))}</p>`,
									},
								},
							}
						: {}),
					level: node.headingLevel,
				}),
			];
		if (node.kind === "list") return [block(node, "text", { content: listHtml(node) })];
		if (node.kind === "table") return [table(node)];
		if (node.kind === "divider")
			return [
				block(node, "divider", {
					...(settings(node).palette ? { sectionTheme: settings(node).palette } : {}),
				}),
			];
		if (node.kind === "image") {
			const s = settings(node);
			return [
				block(node, "image", {
					src: node.source?.value,
					alt: node.alt?.value,
					...(s.decorative !== undefined ? { decorative: s.decorative === true } : {}),
					width: s.size,
					effects: typeof s.effects === "string" ? parseEffectsExpression(s.effects) : undefined,
				}),
			];
		}
		const s = settings(node);
		const title = subject(node);
		const titleData = { title, _headingLevel: node.headingLevel };
		if (
			[
				"choice",
				"match",
				"order",
				"categorize",
				"fill-blank",
				"free-response",
				"matrix",
				"hotspot",
			].includes(node.type ?? "")
		)
			return [assessment(node)];
		switch (node.type) {
			case "text":
				return [block(node, "text", { content: proseHtml(node) })];
			case "note":
				return [
					block(node, "note", {
						...(title ? { title } : {}),
						content: proseHtml(node),
						color: s.tone,
						style: s.style,
					}),
				];
			case "quote":
				return [
					block(node, "quote", {
						text: proseHtml(node),
						speaker: partText(node, "speaker"),
						work: partText(node, "work"),
						sourceUrl: s.source,
					}),
				];
			case "figure": {
				const image = node.children.find((child) => child.kind === "image");
				if (!image) return [block(node, "text", { content: proseHtml(node) })];
				const runs = node.children.filter((child) => child.kind === "body");
				const separate = runs.map((child) => inline(displayText(text(child)))).join("\n\n");
				const combined = inline(runs.map((child) => displayText(text(child))).join("\n\n"));
				const caption = displayText(runs.map(text).join("\n\n"));
				return [
					block(node, "image", {
						...convert(image)[0].data,
						imageId: id(image),
						caption,
						_inline: {
							// Cross-run inline tokens keep the combined projection without ambiguous locators.
							caption:
								combined === separate
									? runs.map((child) => boundInline(child, text(child))).join("\n\n")
									: inline(caption),
						},
					}),
				];
			}
			case "float": {
				const content = children(node);
				const image = content.find((child) => child.type === "image");
				if (image) image.data.float = s.side;
				return [...content, { id: id(node), type: "blockBreak", data: { close: "float" } }];
			}
			case "video":
			case "audio": {
				const captions = node.children.filter(
					(child) => child.kind === "part" && child.name === "caption",
				);
				const caption = captions.length === 1 ? captions[0] : undefined;
				return [
					block(node, node.type, {
						src: title,
						startTime: s.start,
						endTime: s.end,
						title: partText(node, "title"),
						caption: partText(node, "caption"),
						...(caption?.value?.raw.trim()
							? { _inline: { caption: boundInline(caption, caption.value.raw, "caption") } }
							: {}),
						transcript: partText(node, "transcript"),
						captions: s.captions,
					}),
				];
			}
			case "embed":
				return [block(node, "embed", { src: title, title: partText(node, "title") })];
			case "bookmark":
			case "button": {
				const link = tokenizeInline(authoredSubject(node)).children.find(
					(child) => child.kind === "link",
				);
				const label =
					link?.kind === "link" ? link.children.map((child) => child.raw).join("") : title;
				return [
					block(
						node,
						node.type === "button" ? "button" : "embed",
						node.type === "button"
							? {
									text: label,
									href: link?.kind === "link" ? link.destination.value : "",
									variant: s.style,
									openInNewTab: s.newTab === true,
									action: "link",
								}
							: {
									title: label,
									src: link?.kind === "link" ? link.destination.value : "",
									display: "bookmark",
								},
					),
				];
			}
			case "dialogue": {
				// Empty declarations establish a G4 speaker key without adding a
				// local override to the renderer's cast-resolution interface.
				const speakers = Object.fromEntries(
					Object.entries(options.cast ?? {}).filter(
						([, entry]) => entry && typeof entry === "object" && Object.keys(entry).length,
					),
				);
				return [
					block(node, "dialogue", {
						caption: partText(node, "caption"),
						...(Object.keys(speakers).length ? { speakers } : {}),
						turns: node.children
							.filter((child) => child.kind === "turn")
							.map((turn) => ({
								id: id(turn),
								...(turn.speaker ? { speaker: String(turn.speaker.value) } : {}),
								paragraphs: plainParagraphs(text(turn)),
							})),
					}),
				];
			}
			case "table":
			case "stats": {
				const body = node.children.find((child) => child.kind === "table");
				return body ? [table(body, node)] : [block(node, "table", { headers: [], rows: [] })];
			}
			case "accordion":
			case "tabs":
			case "sequence":
			case "cards":
			case "comparison":
			case "columns": {
				const items = node.children
					.filter((child) => child.kind === "item")
					.map((item) => {
						const back = item.children.find((child) => child.kind === "back");
						return {
							id: id(item),
							label: subject(item),
							...prepared("label", authoredSubject(item), subject(item)),
							...(node.type === "cards" && subject(item)
								? { headingLevel: item.headingLevel }
								: {}),
							...(node.type === "columns" || node.type === "comparison"
								? {
										width: settings(item, definitionOf(item, node, getDefinition)).weight ?? 1,
									}
								: {}),
							...(node.type === "cards"
								? {
										front: children(item),
										back: back ? children(back) : [],
										...(back ? { backId: id(back) } : {}),
									}
								: { children: children(item) }),
						};
					});
				const container = block(
					node,
					node.type === "cards" ? "card" : node.type === "comparison" ? "columns" : node.type,
					{
						...(title && node.type === "cards" ? { title } : {}),
						items,
						...(node.type === "accordion"
							? {
									accordionStyle: s.style,
									headingLevel: node.children.find((child) => child.kind === "item")?.headingLevel,
								}
							: {}),
						...(node.type === "tabs" || node.type === "sequence"
							? {
									...(node.settings.some((entry) => entry.name === "style")
										? { variant: s.style === "none" ? "plain" : s.style }
										: {}),
									headingLevel: node.children.find((child) => child.kind === "item")?.headingLevel,
								}
							: {}),
						...(node.type === "cards"
							? {
									...(node.settings.some((entry) => entry.name === "layout")
										? { layout: s.layout === "slides" ? "single" : s.layout }
										: {}),
									...(title && node.headingLevel !== 2 ? { _headingLevel: node.headingLevel } : {}),
								}
							: {}),
						...(node.type === "comparison"
							? {
									preset: "comparison",
									...(node.settings.some((entry) => entry.name === "layout")
										? { style: s.layout, comparisonStyle: s.layout }
										: {}),
								}
							: {}),
					},
				);
				// The current accordion/tabs/sequence/columns renderers draw only item labels.
				return title && node.type !== "cards"
					? [
							block(
								node,
								"heading",
								{ level: node.headingLevel, content: `<p>${inline(authoredSubject(node))}</p>` },
								"title",
							),
							container,
						]
					: [container];
			}
			case "group": {
				const members = children(node);
				return [
					block(node, "assessmentGroup", {
						groupName: title,
						...(foldedPageTitles.has(node) ? { _foldedPageTitle: true } : {}),
						...(title && node.headingLevel !== 2 ? { _headingLevel: node.headingLevel } : {}),
						memberBlockIds: members
							.filter((child) => child.type === "assessment")
							.map((child) => child.id),
						buttonLabel: partText(node, "button"),
					}),
					...members,
				];
			}
			case "checklist":
				return [
					block(node, "checklist", {
						...(title ? titleData : {}),
						items: node.children
							.filter((child) => child.kind === "task")
							.map((task) => ({
								id: id(task),
								text: plainParagraphs(value(task)).join(" "),
								...(task.checked ? { checked: true } : {}),
								...prepared(
									"text",
									plainParagraphs(text(task)).join(" "),
									plainParagraphs(value(task)).join(" "),
								),
							})),
					}),
				];
			case "rating":
				return [
					block(node, "rating", {
						...inlineHtmlFields({ label: inline(authoredSubject(node)) }),
						scale: scale(node),
						maxValue: scale(node).length,
						feedback: partText(node, "feedback"),
					}),
				];
			case "signature":
				return [
					block(node, "signature", {
						label: title,
						sublabel: partText(node, "sublabel"),
						required: s.required ?? false,
					}),
				];
			case "rule":
				return [
					block(node, "logic", {
						conditions: {
							operator: part(node, "or") ? "or" : "and",
							rules: node.children
								.filter((child) => ["if", "and", "or"].includes(child.name ?? ""))
								.map((child) => parseLogicConditionExpression(value(child))),
						},
						actions: node.children
							.filter((child) => child.name === "then")
							.map((child) => parseRuleAction(value(child))),
					}),
				];
			case "write-distractors":
				// Only the literal prompt and allocated item identities enter generic data.
				return [
					block(node, "writeDistractors", {
						level: node.headingLevel ?? 2,
						content: {
							question: displayText(decodeEscapes(node.subject?.raw ?? "", "ascii"), true),
							count: Number(s.count ?? 2) as WriteDistractorsData["content"]["count"],
							items: node.children
								.filter((child) => child.kind === "item")
								.map((item) => ({ id: id(item) })),
						},
					} satisfies WriteDistractorsData),
				];
			case "highlight":
				return [
					block(node, "highlight", {
						content: highlightContent(node, (item) => id(item)),
						level: node.headingLevel ?? 2,
					} satisfies HighlightData),
				];
			case "retrieval-sheet":
				return [
					block(node, "retrievalSheet", {
						content: retrievalSheetContent(node, (item) => id(item)),
						level: node.headingLevel ?? 2,
					} satisfies RetrievalSheetData),
				];
			case "self-check":
				// Generic readers get only the prompt and criterion identities. Full author
				// Content is read explicitly through readSelfCheckContent, never block data.
				return [
					block(node, "selfCheck", {
						level: node.headingLevel ?? 2,
						required: s.required ?? false,
						private: s.private,
						content: {
							task: displayText(subject(node)),
							parts: node.children
								.filter((child) => child.kind === "item")
								.map((item) => ({ id: id(item) })),
						} satisfies SelfCheckPrompt,
					}),
				];
			default:
				return [block(node, "text", { content: `<p>${escapeHtml(node.raw)}</p>` })];
		}
	}
	const pages = tree.root.children
		.filter((node) => node.kind === "page")
		.map((page): PraxityPage => {
			const foldedPageTitle = page.headingLevel
				? page.children.find(
						(child) =>
							child.type === "group" &&
							child.headingLevel === 1 &&
							subject(child) === subject(page),
					)
				: undefined;
			if (foldedPageTitle) foldedPageTitles.add(foldedPageTitle);
			return {
				id: id(page),
				title: partText(page, "nav") ?? subject(page),
				data: {
					...settings(page),
					...(settings(page).style ? { pageStyle: settings(page).style } : {}),
					title: subject(page),
				},
				blocks: [
					...(page.headingLevel && !foldedPageTitle
						? [
								block(
									page,
									"heading",
									{ content: `<p>${inline(authoredSubject(page))}</p>`, level: 1 },
									"title",
								),
							]
						: []),
					...children(page),
				],
			};
		});
	const frontmatter = tree.root.children.find((node) => node.kind === "frontmatter");
	if (frontmatter && pages[0]) {
		// Declarations have hidden runtime wrappers. Keep the authored page title
		// first, matching the existing publisher's heading and reading order.
		const firstBlock = pages[0].blocks[0];
		const declarationIndex = firstBlock?.type === "heading" && firstBlock.data.level === 1 ? 1 : 0;
		pages[0].blocks.splice(
			declarationIndex,
			0,
			...Object.entries(options.variables ?? {}).map(
				([name, initialValue]): PraxityBlock => ({
					id: id(frontmatter, `variable:${name}`),
					type: "variable",
					data: {
						variableName: name,
						dataType:
							typeof initialValue === "number"
								? "number"
								: typeof initialValue === "boolean"
									? "boolean"
									: "text",
						defaultValue: initialValue,
						source: "manual",
					},
				}),
			),
		);
	}
	// A flat stream keeps the current desktop/export API usable. Every page, including
	// the first, has a pageBreak so callers need no firstPage frontmatter exception.
	const blocks = pages.flatMap((page) => {
		const record = nodes.get(page.id);
		if (!record) throw new Error(`Missing page node record: ${page.id}`);
		return [
			{
				id: page.id,
				type: "pageBreak" as const,
				data: {
					...Object.fromEntries(Object.entries(page.data ?? {}).filter(([key]) => key !== "title")),
					id: page.id,
					// Let the existing publisher infer plain navigation from the visible
					// heading. Explicit nav and hidden titles retain their authored label.
					...(part(record.node, "nav") || page.data?.hideTitle
						? { title: page.title, label: page.title }
						: {}),
				},
			},
			...page.blocks,
		];
	});
	// Allocate author-only records last so sequential allocators retain every learner ID.
	for (const field of optionFeedback) id(field, "option-feedback");
	return { pages, blocks, nodes };
}

/** These reader roles locate author fields but never emit IDs into learner data. */
export const AUTHOR_ONLY_READER_ROLES: ReadonlySet<string> = new Set(["option-feedback"]);
