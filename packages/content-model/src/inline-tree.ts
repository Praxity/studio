import { escapeHtml } from "./constants";
import { decodeEscapes, escapeLength } from "./escaping";
import { parseMaterialFootnote } from "./inline-footnotes";
import { inlineIconPlaceholder } from "./inline-icons";

/** Half-open UTF-16 offsets in the original lesson, including raw escape spelling. */
export interface InlineRange {
	start: number;
	end: number;
}

export interface InlineSource extends InlineRange {
	raw: string;
}

export interface InlineValue extends InlineSource {
	value: string;
}

export interface InlineReferenceTrivia {
	/** Ancillary separator whitespace in neighbouring text. Raw spans stay lossless. */
	referenceTrivia?: InlineRange[];
}

export interface InlineTerm extends InlineSource, InlineReferenceTrivia {
	kind: "term";
	children: InlineNode[];
	/** Empty means a mention whose definition belongs to the course glossary. */
	definition: InlineValue;
}

export type InlineNode = InlineSource &
	(
		| { kind: "text"; value: string }
		| { kind: "unresolved"; status: "unresolved" }
		| { kind: "strong" | "emphasis" | "strike"; children: InlineNode[] }
		| ({ kind: "highlight"; children: InlineNode[] } & InlineReferenceTrivia)
		| { kind: "code"; content: InlineValue }
		| ({ kind: "source"; content: InlineValue } & InlineReferenceTrivia)
		| { kind: "link"; children: InlineNode[]; destination: InlineValue }
		| InlineTerm
		| { kind: "icon" | "variable"; name: InlineValue }
		| ({
				kind: "doodle";
				name: string;
				modifiers: string[];
				children: InlineNode[];
		  } & InlineReferenceTrivia)
		| ({ kind: "sources" } & InlineReferenceTrivia)
	);

export interface InlineTree extends InlineRange {
	source: string;
	children: InlineNode[];
	/** Compiler-created paragraph; authored HTML never acquires this ownership. */
	envelope?: { kind: "paragraph"; generatedBy?: AncillaryInlineNode["kind"] };
}

type AncillaryInlineNode = Extract<
	InlineNode,
	{ kind: "source" | "sources" | "highlight" | "doodle" | "term" }
>;
const ANCILLARY_KINDS = new Set<InlineNode["kind"]>([
	"source",
	"sources",
	"highlight",
	"doodle",
	"term",
]);
const isAncillary = (node: InlineNode): node is AncillaryInlineNode =>
	ANCILLARY_KINDS.has(node.kind);

/** Normalize only the material copy; source spans and learner rendering stay owned by their producer. */
function materialFootnoteTree(tree: InlineTree): InlineTree {
	const copy = structuredClone(tree);
	// Producer text is literal; only the producer decides which spans are code or syntax.
	const normalize = (nodes: InlineNode[]): InlineNode[] =>
		nodes.flatMap((node): InlineNode[] => {
			if (node.kind === "doodle" || node.kind === "unresolved") {
				const note = parseMaterialFootnote(node.raw, 0, node.start);
				if (note && note.raw.length === node.raw.length) return [note];
			}
			if (node.kind !== "text")
				return ["children" in node ? { ...node, children: normalize(node.children) } : node];
			const pieces: InlineNode[] = [];
			const policy = node.value === decodeEscapes(node.raw, "ascii") ? "ascii" : "legacy";
			let start = 0;
			const text = (end: number) => {
				if (end > start) {
					const raw = node.raw.slice(start, end);
					pieces.push({
						...node,
						start: node.start + start,
						end: node.start + end,
						raw,
						value: decodeEscapes(raw, policy),
					});
				}
			};
			for (let index = 0; index < node.raw.length; index++) {
				if (escapeLength(node.raw, index, policy)) {
					index++;
					continue;
				}
				const note = parseMaterialFootnote(node.raw, index, node.start);
				if (!note) continue;
				text(index);
				pieces.push(note);
				index = note.end - node.start - 1;
				start = index + 1;
			}
			text(node.raw.length);
			return pieces;
		});
	copy.children = normalize(copy.children);
	if (copy.envelope) copy.envelope = inlineParagraph(copy).envelope;
	return copy;
}

/** Erase a field together: note-only paragraphs never change whole-mark coverage. */
export function materialInlineTrees(
	trees: readonly InlineTree[],
	wholeText = false,
): (InlineTree | undefined)[] {
	const copies = trees.map(materialFootnoteTree);
	const words: { inline: InlineTree; range: InlineRange }[] = [];
	const fields: { inline: InlineTree; annotations: AncillaryInlineNode[] }[] = [];
	for (const tree of copies) {
		const annotations: AncillaryInlineNode[] = [];
		const inspect = (nodes: InlineNode[]) => {
			for (const node of nodes) {
				if (isAncillary(node)) annotations.push(node);
				if (node.kind === "source" || node.kind === "sources") continue;
				if ("children" in node) inspect(node.children);
				else if (node.kind !== "text" || !/^[\t\n\f\r ]*$/.test(node.value))
					words.push({ inline: tree, range: node });
			}
		};
		inspect(tree.children);
		fields.push({ inline: tree, annotations });
	}
	return fields.map(({ inline, annotations }) => {
		const retained = new Set(
			wholeText && words.length
				? annotations.filter(
						(node) =>
							node.kind !== "source" &&
							node.kind !== "sources" &&
							words.every(
								(word) =>
									word.inline === inline &&
									word.range.start >= node.start &&
									word.range.end <= node.end,
							),
					)
				: [],
		);
		return eraseInlineTree(inline, annotations, retained);
	});
}

/** Erase compiler annotations and their owned trivia before HTML fields exist. */
export function materialInlineTree(tree: InlineTree, wholeText = false): InlineTree | undefined {
	return materialInlineTrees([tree], wholeText)[0];
}

function eraseInlineTree(
	tree: InlineTree,
	marks: AncillaryInlineNode[],
	retained: Set<AncillaryInlineNode>,
): InlineTree | undefined {
	ownInlineTrivia(tree, retained);
	const trivia = marks
		.filter((node) => !retained.has(node))
		.flatMap((node) => node.referenceTrivia ?? []);
	const erase = (nodes: InlineNode[]): InlineNode[] =>
		nodes.flatMap((node): InlineNode[] => {
			if (isAncillary(node))
				return retained.has(node) && "children" in node ? erase(node.children) : [];
			if (node.kind === "text") {
				let raw = "";
				let offset = node.start;
				for (const range of trivia
					.filter((range) => range.start < node.end && range.end > node.start)
					.sort((a, b) => a.start - b.start)) {
					raw += node.raw.slice(offset - node.start, Math.max(offset, range.start) - node.start);
					offset = Math.max(offset, range.end);
				}
				raw += node.raw.slice(offset - node.start);
				// Trivia never contains escapes; equal decoded spellings stay equal after erasure.
				const policy = node.value === decodeEscapes(node.raw, "ascii") ? "ascii" : "legacy";
				return raw ? [{ ...node, raw, value: decodeEscapes(raw, policy) }] : [];
			}
			if (!("children" in node)) return [node];
			const children = erase(node.children);
			return (node.kind === "strong" || node.kind === "emphasis") && !children.length
				? []
				: [{ ...node, children }];
		});
	if (tree.envelope?.generatedBy && !retained.size) return undefined;
	return {
		...tree,
		children: erase(tree.children),
		...(tree.envelope ? { envelope: { kind: "paragraph" } as const } : {}),
	};
}
type Boundary = { kind: "material" } | { kind: "gap"; range: InlineRange } | AncillaryInlineNode;

/** Classify a whole ancillary run before assigning any gap, across bold/italic only. */
export function ownInlineTrivia(
	tree: InlineTree,
	retained = new Set<AncillaryInlineNode>(),
): InlineTree {
	const sequence = (nodes: InlineNode[]): void => {
		const boundaries: Boundary[] = [];
		const flatten = (nodes: InlineNode[]) => {
			for (const node of nodes) {
				if (isAncillary(node)) {
					delete node.referenceTrivia;
					// Nested annotations keep local trivia; the parent stays one ancillary boundary.
					if ("children" in node) sequence(node.children);
					// Whole marks are material boundaries before notes acquire separator ownership.
					boundaries.push(retained.has(node) ? { kind: "material" } : node);
				} else if (node.kind === "text") {
					for (const match of node.raw.matchAll(/[\t\n\f\r ]+|[^\t\n\f\r ]+/g))
						boundaries.push(
							/^[\t\n\f\r ]/.test(match[0])
								? {
										kind: "gap",
										range: {
											start: node.start + match.index,
											end: node.start + match.index + match[0].length,
										},
									}
								: { kind: "material" },
						);
				} else if (node.kind === "strong" || node.kind === "emphasis") {
					flatten(node.children);
				} else {
					if ("children" in node) sequence(node.children);
					boundaries.push({ kind: "material" });
				}
			}
		};
		flatten(nodes);
		for (let start = 0; start < boundaries.length; ) {
			if (boundaries[start].kind === "material") {
				start++;
				continue;
			}
			let end = start;
			const annotations: AncillaryInlineNode[] = [];
			const gaps: Array<{ range: InlineRange; owner?: AncillaryInlineNode }> = [];
			let pendingGap = 0;
			while (end < boundaries.length && boundaries[end].kind !== "material") {
				const item = boundaries[end++];
				if (item.kind === "gap") gaps.push({ range: item.range });
				else if (item.kind !== "material") {
					annotations.push(item);
					while (pendingGap < gaps.length) gaps[pendingGap++].owner = item;
				}
			}
			if (annotations.length) {
				// Between material siblings the last existing gap remains a word separator.
				const retained = start > 0 && end < boundaries.length ? gaps.at(-1) : undefined;
				for (const gap of gaps) {
					if (gap === retained) continue;
					const owner = gap.owner ?? annotations[annotations.length - 1];
					(owner.referenceTrivia ??= []).push(gap.range);
				}
			}
			start = end;
		}
	};
	sequence(tree.children);
	return tree;
}

/** Mark the generated paragraph while its source constructs are still available. */
export function inlineParagraph(tree: InlineTree): InlineTree {
	const annotations: AncillaryInlineNode["kind"][] = [];
	const ancillary = (nodes: InlineNode[]): boolean =>
		nodes.every((node) => {
			if (isAncillary(node)) {
				annotations.push(node.kind);
				return true;
			}
			if (node.kind === "text") return /^[\t\n\f\r ]*$/.test(node.value);
			return (node.kind === "strong" || node.kind === "emphasis") && ancillary(node.children);
		});
	const generatedBy =
		ancillary(tree.children) && annotations.length
			? annotations.includes("sources")
				? "sources"
				: annotations[0]
			: undefined;
	return { ...tree, envelope: { kind: "paragraph", ...(generatedBy ? { generatedBy } : {}) } };
}

export interface InlineTreeRenderOptions {
	interactive?: boolean;
	/** G5 supplies course definitions; this renderer never builds a glossary. */
	resolveTerm?: (term: InlineTerm) => string | undefined;
}

function renderNodes(
	nodes: readonly InlineNode[],
	options: InlineTreeRenderOptions,
	interactive: boolean,
): string {
	return nodes
		.map((node): string => {
			switch (node.kind) {
				case "text":
					return escapeHtml(node.value);
				case "unresolved":
					return escapeHtml(node.raw);
				case "code":
					return `<code>${escapeHtml(node.content.value)}</code>`;
				case "strong":
					return `<strong>${renderNodes(node.children, options, interactive)}</strong>`;
				case "emphasis":
					return `<em>${renderNodes(node.children, options, interactive)}</em>`;
				case "strike":
					return `<del>${renderNodes(node.children, options, interactive)}</del>`;
				case "highlight":
					return `<mark>${renderNodes(node.children, options, interactive)}</mark>`;
				case "link": {
					const label = renderNodes(node.children, options, false);
					return interactive
						? `<a href="${escapeHtml(node.destination.value)}">${label}</a>`
						: label;
				}
				case "term": {
					const label = renderNodes(node.children, options, false);
					const definition = node.definition.value || options.resolveTerm?.(node);
					if (!definition) return label;
					return interactive
						? `<span class="inline-tooltip-trigger" data-tooltip-content="${escapeHtml(definition)}">${label}</span>`
						: `${label} ${escapeHtml(`(${definition})`)}`;
				}
				case "doodle":
					return `<span class="praxity-doodle" data-doodle="${escapeHtml(node.name)}" data-doodle-mods="${escapeHtml(node.modifiers.join(" "))}">${renderNodes(node.children, options, interactive)}</span>`;
				case "icon":
					return inlineIconPlaceholder(node.name.value) ?? escapeHtml(node.raw);
				case "variable":
					return `<span data-mention="variable:${escapeHtml(node.name.value)}"></span>`;
				case "source":
					return `<span data-footer-content="${escapeHtml(node.content.value)}">${escapeHtml(node.raw)}</span>`;
				case "sources":
					return `<span data-footer-insert="true">${escapeHtml(node.raw)}</span>`;
			}
		})
		.join("");
}

/** Render parsed semantics without scanning source. Sanitize at the existing HTML sink. */
export function renderInlineTree(tree: InlineTree, options: InlineTreeRenderOptions = {}): string {
	const html = renderNodes(tree.children, options, options.interactive !== false);
	return tree.envelope?.kind === "paragraph" ? `<p>${html}</p>` : html;
}
