import { parseFrontmatter } from "../../frontmatter.ts";
import { tokenizeInline } from "../inline.ts";
import { lineColumn, type TokenLine, type TokenStream } from "../lex/index.ts";
import { interpretBodies } from "./body.ts";
import { buildLessonTree } from "./build.ts";
import { deriveHeadings } from "./headings.ts";
import { bodyNode, span } from "./source.ts";
import { isTableSeparator } from "./table.ts";
import type {
	AnalysisDiagnostic,
	AnalysisDiagnosticCode,
	AnalysisOptions,
	AnalyzedLessonTree,
	BodyDefinition,
	MessageRef,
	SourceSpan,
	TreeNode,
} from "./types.ts";

/** An item's declaration is its enclosing block's itemDefinition; other nodes use their type or kind. */
export function definitionOf<D extends BodyDefinition & { itemDefinition?: D }>(
	node: TreeNode,
	parent: TreeNode | undefined,
	definition: (type: string) => D | undefined,
): D | undefined {
	return node.kind === "item"
		? (definition(parent?.type ?? "")?.itemDefinition ?? definition("item"))
		: definition(node.type ?? node.kind);
}

export type ReportDiagnostic = (
	code: AnalysisDiagnosticCode,
	location: SourceSpan,
	args?: MessageRef["args"],
	severity?: "error" | "warning",
) => void;

function legacyDeclaration(stream: TokenStream, options: AnalysisOptions): TokenLine | undefined {
	const metadata = stream.lines.find((line) => line.kind === "frontmatter");
	if (metadata && Object.hasOwn(parseFrontmatter(stream.source).frontmatter, "firstPage"))
		return metadata;
	const owners: string[] = [];
	for (const line of stream.lines) {
		if (line.kind === "page") owners.length = 0;
		if (line.kind === "opener") {
			const type = stream.tokens
				.slice(line.tokenStart, line.tokenEnd)
				.find((token) => token.kind === "block-type");
			owners.push(String(type?.value ?? ""));
			continue;
		}
		if (line.kind === "closer") {
			owners.pop();
			continue;
		}
		if (options.definition(owners.at(-1) ?? "")?.literalText) continue;
		// G4's lexical partition shields fences, math, quotes, escapes and frontmatter.
		if (!["part", "prose", "diagnostic", "divider"].includes(line.kind)) continue;
		const raw = stream.source.slice(line.start, line.contentEnd);
		const chars = raw.split("");
		const maskCode = (nodes: ReturnType<typeof tokenizeInline>["children"]) => {
			for (const node of nodes) {
				if (node.kind === "code") chars.fill(" ", node.start, node.end);
				else if ("children" in node) maskCode(node.children);
			}
		};
		maskCode(tokenizeInline(raw).children);
		const text = chars.join("").trim();
		// Distinct G3 productions from the archived parser. Shared Markdown, bare
		// dividers and headings cannot distinguish the formats. `if:` is also a G4 rule part.
		if (
			/^(?:as|close):\s*\S/.test(text) ||
			/^card:\s*back$/.test(text) ||
			/^(?:var|when):\s*\S/.test(text) ||
			(/^if:\s*\S/.test(text) && owners.at(-1) !== "rule") ||
			(/^---\s+(?!\{)\S/.test(text) && !isTableSeparator(stream, line)) ||
			/^--$/.test(text) ||
			/^(?:\/|https?:\/\/)\S+\.(?:webp|jpe?g|png|gif|svg|tiff|mp4|webm|mov|avi|mp3|wav|ogg|m4a|flac|aac)$/i.test(
				text,
			)
		)
			return line;
	}
	return undefined;
}

/** G3 semantics over the unchanged lexical partition, with G4/G5 declarations injected. */
export function analyzeLessonTree(
	stream: TokenStream,
	options: AnalysisOptions,
): AnalyzedLessonTree {
	const diagnostics: AnalysisDiagnostic[] = [];
	const report: ReportDiagnostic = (code, location, args = {}, severity = "error") => {
		const position = lineColumn(stream.source, location.start);
		diagnostics.push({
			code,
			span: location,
			...position,
			severity,
			message: { key: `grammar.v4.${code}`, args: { ...position, ...args } },
		});
	};
	// Lexical classifications shield code, math, quotes, escaped lines and frontmatter.
	const legacy = legacyDeclaration(stream, options);
	if (legacy) {
		const root = bodyNode(stream, "lesson", 0, stream.tokens.length);
		root.status = "unresolved";
		report("grammar-3", span(stream, legacy.tokenStart, legacy.tokenEnd), {
			command:
				"pnpm --dir ../praxity-converter --filter @praxity/convert convert <course-copy> --from 3 --out <new-output-directory>",
		});
		return { stream, root, diagnostics, refused: true };
	}
	const tree = buildLessonTree(stream, {
		isPart: (name, owner, parent) => {
			const definition = definitionOf(owner, parent, options.definition);
			// After the first option, feedback belongs to the body interpreter. It
			// enforces adjacency instead of treating detached lines as question parts.
			if (
				definition?.body === "options" &&
				["feedback", "correct", "incorrect"].includes(name) &&
				owner.children.some(
					(child) =>
						child.kind === "body" &&
						stream.lines.some(
							(line) =>
								line.tokenStart >= child.span.tokenStart &&
								line.tokenStart < child.span.tokenEnd &&
								line.kind === "prose" &&
								/^(?:\([ xX]\)|\[[ xX]\])[ \t]+/.test(
									stream.source.slice(line.start, line.contentEnd),
								),
						),
				)
			)
				return false;
			return (owner.kind === "page" && name === "nav") || !!definition?.parts?.includes(name);
		},
		allowsItems: (owner) =>
			options.definition(owner.type ?? "")?.items ?? !options.definition(owner.type ?? ""),
	});
	const nodes = [tree.root];
	const parents = new Map<TreeNode, TreeNode>();
	const definitions = new Map<TreeNode, BodyDefinition | undefined>();
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index];
		const parent = parents.get(node);
		definitions.set(node, definitionOf(node, parent, options.definition));
		for (const child of node.children) {
			parents.set(child, node);
			nodes.push(child);
		}
	}
	for (const diagnostic of tree.diagnostics) {
		const args: Record<string, string | number> = {};
		if (diagnostic.type) args.type = diagnostic.type;
		if (diagnostic.name) args.name = diagnostic.name;
		if (diagnostic.firstStart !== undefined)
			args.firstLine = lineColumn(stream.source, diagnostic.firstStart).line;
		let code: AnalysisDiagnosticCode = diagnostic.code;
		if (code === "unclosed-block") {
			const node = nodes.find((n) => n.header?.start === diagnostic.span.start);
			const boundary = stream.lines.find((line) => line.start === node?.span.end);
			args.boundaryLine = lineColumn(stream.source, node?.span.end ?? stream.source.length).line;
			args.boundary = boundary?.kind ?? "eof";
			if (boundary?.kind === "item") code = "item-before-close";
		}
		if (code === "content-before-page") args.replacement = "# Page title";
		report(code, diagnostic.span, args);
	}
	for (const node of nodes) {
		if (node.kind === "block" && !options.definition(node.type ?? "")) {
			report("unknown-type", node.header ?? node.span, {
				type: node.type ?? "",
				...(options.suggestType?.(node.type ?? "")
					? { suggestion: options.suggestType(node.type ?? "") ?? "" }
					: {}),
			});
			node.status = "unresolved";
		}
		const definition = definitions.get(node);
		const valid = [];
		for (const setting of node.settings) {
			// Level is a tree rule; declared item settings can exclude it.
			if (
				setting.name === "level" &&
				(node.kind !== "item" ||
					!definition?.settings ||
					Object.hasOwn(definition.settings, "level"))
			) {
				const level = Number(setting.value.value);
				if (
					typeof setting.value.value === "string" &&
					Number.isInteger(level) &&
					level >= 1 &&
					level <= 6
				)
					valid.push(setting);
				else {
					report("bad-setting-value", setting.span, {
						name: "level",
						value: String(setting.value.value),
						allowed: ["1", "2", "3", "4", "5", "6"],
					});
					node.status = "unresolved";
				}
				continue;
			}
			if (!definition) {
				valid.push(setting);
				continue;
			}
			const rule = Object.hasOwn(definition.settings ?? {}, setting.name)
				? definition.settings?.[setting.name]
				: undefined;
			const suggestion = Object.hasOwn(definition.settingAliases ?? {}, setting.name)
				? definition.settingAliases?.[setting.name]
				: undefined;
			if (!rule) {
				report("unknown-setting", setting.span, {
					type: node.type ?? node.kind,
					name: setting.name,
					...(suggestion ? { suggestion } : {}),
				});
				node.status = "unresolved";
			} else if (
				(rule.values && !rule.values.includes(String(setting.value.value))) ||
				(rule.accepts && !rule.accepts(setting.value.value))
			) {
				report("bad-setting-value", setting.span, {
					type: node.type ?? node.kind,
					name: setting.name,
					value: String(setting.value.value),
					...(rule.values ? { allowed: rule.values } : {}),
				});
				node.status = "unresolved";
			} else valid.push(setting);
		}
		node.settings = valid;
	}
	interpretBodies(stream, tree.root, definitions, report);
	deriveHeadings(stream, tree.root, options, report);
	for (const node of nodes)
		for (const issue of definitions.get(node)?.validate?.(node, parents.get(node)) ?? [])
			report(issue.code, issue.span ?? node.header ?? node.span, issue.args, issue.severity);
	// Inline/course owners can supply definitions; the local fallback recognizes literal terms only.
	const glossaryDefinitions =
		options.glossaryDefinitions ?? localDefinitions(stream, tree.root, definitions);
	const first = new Map<string, (typeof glossaryDefinitions)[number]>();
	for (const definition of glossaryDefinitions) {
		const prior = first.get(definition.term);
		if (prior && prior.definition !== definition.definition) {
			const line = stream.lines.find(
				(line) => line.start <= definition.start && definition.start < line.end,
			);
			report(
				"conflicting-glossary-definitions",
				line ? span(stream, line.tokenStart, line.tokenEnd) : tree.root.span,
				{ term: definition.term, firstLine: prior.line, secondLine: definition.line },
			);
		} else if (!prior) first.set(definition.term, definition);
	}
	// Errors invalidate their smallest containing node, then propagate through ancestors.
	const finalNodes = [tree.root];
	for (let index = 0; index < finalNodes.length; index++)
		finalNodes.push(...finalNodes[index].children);
	for (const diagnostic of diagnostics)
		if (
			diagnostic.severity === "error" &&
			// Valid practice declarations still have durable authoring identities
			// while publication waits for its runtime. All structural errors propagate.
			!(
				diagnostic.code === "unsupported-runtime" &&
				diagnostic.message.args.type === "write-distractors"
			)
		) {
			let owner = tree.root;
			for (const node of finalNodes)
				if (
					node.span.start <= diagnostic.span.start &&
					node.span.end >= diagnostic.span.end &&
					node.span.end - node.span.start <= owner.span.end - owner.span.start
				)
					owner = node;
			owner.status = "unresolved";
		}
	for (let index = finalNodes.length - 1; index >= 0; index--)
		if (finalNodes[index].children.some((n) => n.status === "unresolved"))
			finalNodes[index].status = "unresolved";
	return { stream, root: tree.root, diagnostics, refused: false };
}

function localDefinitions(
	stream: TokenStream,
	root: TreeNode,
	definitions: ReadonlyMap<TreeNode, BodyDefinition | undefined>,
) {
	const result: { term: string; definition: string; start: number; line: number }[] = [];
	const literals = [...definitions]
		.filter(([, definition]) => definition?.literalText)
		.map(([node]) => node.span);
	for (const line of stream.lines) {
		if (literals.some((range) => range.start <= line.start && line.end <= range.end)) continue;
		if (!["prose", "part", "list-item", "heading", "page", "opener", "item"].includes(line.kind))
			continue;
		const raw = stream.source.slice(line.start, line.contentEnd);
		const codeRanges: { start: number; end: number }[] = [];
		for (let index = 0; index < raw.length; index++) {
			if (raw[index] === "\\") {
				index++;
				continue;
			}
			if (raw[index] !== "`") continue;
			let width = 1;
			while (raw[index + width] === "`") width++;
			const close = raw.indexOf("`".repeat(width), index + width);
			if (close >= 0) {
				codeRanges.push({ start: index, end: close + width });
				index = close + width - 1;
			} else index += width - 1;
		}
		for (const match of raw.matchAll(/(?<![\\!])\[([^\]\r\n]+)\]\{([^{}\r\n]+)\}/g)) {
			if (
				codeRanges.some(
					(range) => range.start <= (match.index ?? 0) && range.end > (match.index ?? 0),
				)
			)
				continue;
			// G6 replaces this fallback with its inline tree for formatted/nested terms.
			const start = line.start + (match.index ?? 0);
			if (start >= root.span.start)
				result.push({
					term: match[1],
					definition: match[2],
					start,
					line: lineColumn(stream.source, start).line,
				});
		}
	}
	return result;
}
