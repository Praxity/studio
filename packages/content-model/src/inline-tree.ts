import { escapeHtml } from "./constants";
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

/** Signature facts come from compiler kinds, without rendering another HTML tree. */
export function inlineMaterial(tree: InlineTree): { text: string; icons: string[] } {
	const icons: string[] = [];
	const text = (nodes: readonly InlineNode[]): string =>
		nodes
			.map((node): string => {
				switch (node.kind) {
					case "source":
					case "sources":
					case "term":
						return "";
					case "icon":
						icons.push(node.name.value);
						return "";
					case "variable":
						return "";
					case "text":
						return node.value;
					case "unresolved":
						return node.raw;
					case "code":
						return node.content.value;
					default:
						return text(node.children);
				}
			})
			.join("");
	return { text: text(tree.children), icons };
}
type Boundary = { kind: "material" } | { kind: "gap"; range: InlineRange } | AncillaryInlineNode;

/** Classify a whole ancillary run before assigning any gap, across bold/italic only. */
export function ownInlineTrivia(tree: InlineTree): InlineTree {
	const sequence = (nodes: InlineNode[]): void => {
		const boundaries: Boundary[] = [];
		const flatten = (nodes: InlineNode[]) => {
			for (const node of nodes) {
				if (isAncillary(node)) {
					delete node.referenceTrivia;
					// Nested annotations keep local trivia; the parent stays one ancillary boundary.
					if ("children" in node) sequence(node.children);
					boundaries.push(node);
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
