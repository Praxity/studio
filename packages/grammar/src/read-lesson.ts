import { isInlineProjectionMetadataKey } from "@praxity/content-model/inline-fields";
import type { HighlightContent, PraxityBlock } from "@praxity/content-model/types";
import { validateContent as validateHighlightContent } from "learning-patterns/patterns/highlight/logic.js";
import {
	type Content as RetrievalSheetContent,
	validateContent as validateRetrievalSheetContent,
} from "learning-patterns/patterns/retrieval-sheet/logic.js";
import {
	type Content as SelfCheckContent,
	validateContent,
} from "learning-patterns/patterns/self-check/logic.js";
import {
	validateContent as validateWriteDistractorsContent,
	type Content as WriteDistractorsContent,
} from "learning-patterns/patterns/write-distractors/logic.js";
import { parseFrontmatter } from "./frontmatter.ts";
import {
	lessonRuntimeRefusalMessage,
	practiceDiagnosticMessage,
	practiceFieldDiagnosticMessage,
	retrievalSheetDiagnosticMessage,
	writeDistractorsDiagnosticMessage,
} from "./practice-diagnostics.ts";
import type { GrammarFrontmatter } from "./types.ts";
import { lineColumn, tokenizeLesson } from "./v4/lex/index.ts";
import {
	getDefinition,
	highlightContent,
	readTreeFrontmatter,
	retrievalSheetContent,
	selfCheckContent,
	suggestType,
	writeDistractorsContent,
} from "./v4/schema.ts";
import {
	type BlockAdapterResult,
	createTransientIdAllocator,
	type LessonIdAllocator,
	toBlocks,
} from "./v4/to-blocks.ts";
import {
	type AnalyzedLessonTree,
	analyzeLessonTree,
	type MessageRef,
	type TreeNode,
} from "./v4/tree/index.ts";
import type { ValidationError } from "./validation/validation-types.ts";

export interface BlockSpan {
	startLine: number;
	endLine: number;
}
export interface ContainerSourceRange extends BlockSpan {
	blockId: string;
	keyword: string;
	explicitClose: boolean;
}
export interface ParseWarning {
	message: string;
	line: number;
	keyword?: string;
}

export interface ReadLessonOptions {
	/** Omit only for read-only inspection or preview. Supplied IDs must be unique and nonempty. */
	ids?: LessonIdAllocator;
	formatMessage?: (message: MessageRef) => string;
}
export interface LessonReadError extends ValidationError {
	messageRef: MessageRef;
	column: number;
	start: number;
	end: number;
}

// Only the identity index is cached. Authored content stays in the source tree.
const nodeIds = new WeakMap<BlockAdapterResult["nodes"], ReadonlyMap<TreeNode, string>>();
function indexNodeIds(nodes: BlockAdapterResult["nodes"]) {
	let index = nodeIds.get(nodes);
	if (!index) {
		index = new Map(
			[...nodes.values()]
				.filter((record) => !record.role)
				.map((record) => [record.node, record.id]),
		);
		nodeIds.set(nodes, index);
	}
	return index;
}

export class SelfCheckContentError extends Error {
	constructor(
		readonly code:
			| "self-check-not-found"
			| "self-check-identity-invalid"
			| "self-check-content-invalid",
	) {
		super(code);
		this.name = "SelfCheckContentError";
	}
}

/** Author-only Content from this read's source and allocated identities.
 * Invalid drafts remain available through the tree. */
export function readSelfCheckContent(read: ReadLessonResult, blockId: string): SelfCheckContent {
	const owner = read.nodes.get(blockId);
	if (!owner || owner.role || owner.node.kind !== "block" || owner.node.type !== "self-check")
		throw new SelfCheckContentError("self-check-not-found");
	const ids = indexNodeIds(read.nodes);
	if (ids.get(owner.node) !== blockId)
		throw new SelfCheckContentError("self-check-identity-invalid");
	const content = selfCheckContent(owner.node, (item) => {
		const id = ids.get(item);
		const record = id === undefined ? undefined : read.nodes.get(id);
		if (!id || record?.node !== item || record.role)
			throw new SelfCheckContentError("self-check-identity-invalid");
		return id;
	});
	if (
		read.diagnostics.some(
			(d) =>
				d.severity === "error" &&
				d.span.start >= owner.node.span.start &&
				d.span.end <= owner.node.span.end,
		)
	)
		throw new SelfCheckContentError("self-check-content-invalid");
	try {
		validateContent(content);
	} catch {
		// Crash reporting forwards errors; never attach library errors or authored text.
		throw new SelfCheckContentError("self-check-content-invalid");
	}
	return content;
}

export class HighlightContentError extends Error {
	constructor(
		readonly code:
			| "highlight-not-found"
			| "highlight-identity-invalid"
			| "highlight-content-invalid",
	) {
		super(code);
		this.name = "HighlightContentError";
	}
}

/** Fresh public content from this read's AST and identity index, never its projection. */
export function readHighlightContent(read: ReadLessonResult, blockId: string): HighlightContent {
	const owner = read.nodes.get(blockId);
	if (
		!owner ||
		owner.role !== undefined ||
		owner.node.kind !== "block" ||
		owner.node.type !== "highlight"
	)
		throw new HighlightContentError("highlight-not-found");
	const reachable = new Set<TreeNode>();
	const visit = (node: TreeNode) => {
		reachable.add(node);
		node.children.forEach(visit);
	};
	visit(read.tree.root);
	const required = new Set([
		owner.node,
		...owner.node.children.filter((child) => child.kind === "item"),
	]);
	const ids = new Map<TreeNode, string>();
	// skipped: shared identity checks for self-check, retrieval and distractors; align all four when the next reader changes.
	// Do not cache a mutable identity index. Ambiguous aliases and detached records
	// must still refuse after an earlier successful read.
	for (const [key, record] of read.nodes) {
		if (record.role !== undefined || !required.has(record.node)) continue;
		if (!reachable.has(record.node) || key !== record.id || !key || ids.has(record.node))
			throw new HighlightContentError("highlight-identity-invalid");
		ids.set(record.node, key);
	}
	if (ids.size !== required.size || ids.get(owner.node) !== blockId)
		throw new HighlightContentError("highlight-identity-invalid");
	const allocated = new Set(ids.values());
	for (const [key, record] of read.nodes) {
		if (allocated.has(record.id) && key !== record.id)
			throw new HighlightContentError("highlight-identity-invalid");
	}
	if (
		owner.node.status !== "resolved" ||
		read.diagnostics.some(
			(d) =>
				d.severity === "error" &&
				d.span.start >= owner.node.span.start &&
				d.span.end <= owner.node.span.end,
		)
	)
		throw new HighlightContentError("highlight-content-invalid");
	const content = highlightContent(owner.node, (item) => {
		const id = ids.get(item);
		if (!id) throw new HighlightContentError("highlight-identity-invalid");
		return id;
	});
	try {
		validateHighlightContent(content);
	} catch {
		// Never forward authored text or upstream exceptions to crash reporting.
		throw new HighlightContentError("highlight-content-invalid");
	}
	return content;
}

export class RetrievalSheetContentError extends Error {
	constructor(
		readonly code:
			| "retrieval-sheet-not-found"
			| "retrieval-sheet-identity-invalid"
			| "retrieval-sheet-content-invalid",
	) {
		super(code);
		this.name = "RetrievalSheetContentError";
	}
}

/** Author content from this read's source and identities, independent of editor projections. */
export function readRetrievalSheetContent(
	read: ReadLessonResult,
	blockId: string,
): RetrievalSheetContent {
	const owner = read.nodes.get(blockId);
	if (!owner || owner.role || owner.node.kind !== "block" || owner.node.type !== "retrieval-sheet")
		throw new RetrievalSheetContentError("retrieval-sheet-not-found");
	const ids = indexNodeIds(read.nodes);
	if (ids.get(owner.node) !== blockId)
		throw new RetrievalSheetContentError("retrieval-sheet-identity-invalid");
	const content = retrievalSheetContent(owner.node, (item) => {
		const id = ids.get(item);
		const record = id === undefined ? undefined : read.nodes.get(id);
		if (!id || record?.node !== item || record.role)
			throw new RetrievalSheetContentError("retrieval-sheet-identity-invalid");
		return id;
	});
	if (
		owner.node.status !== "resolved" ||
		read.diagnostics.some(
			(d) =>
				d.severity === "error" &&
				d.span.start >= owner.node.span.start &&
				d.span.end <= owner.node.span.end,
		)
	)
		throw new RetrievalSheetContentError("retrieval-sheet-content-invalid");
	try {
		validateRetrievalSheetContent(content);
	} catch {
		// Never forward authored text or upstream exceptions to crash reporting.
		throw new RetrievalSheetContentError("retrieval-sheet-content-invalid");
	}
	return content;
}

export class WriteDistractorsContentError extends Error {
	constructor(
		readonly code:
			| "write-distractors-not-found"
			| "write-distractors-identity-invalid"
			| "write-distractors-content-invalid",
	) {
		super(code);
		this.name = "WriteDistractorsContentError";
	}
}

/** Author content from this read's source and identities, independent of editor projections. */
export function readWriteDistractorsContent(
	read: ReadLessonResult,
	blockId: string,
): WriteDistractorsContent {
	const owner = read.nodes.get(blockId);
	if (
		!owner ||
		owner.role ||
		owner.node.kind !== "block" ||
		owner.node.type !== "write-distractors"
	)
		throw new WriteDistractorsContentError("write-distractors-not-found");
	const ids = indexNodeIds(read.nodes);
	if (owner.id !== blockId || ids.get(owner.node) !== blockId)
		throw new WriteDistractorsContentError("write-distractors-identity-invalid");
	const content = writeDistractorsContent(owner.node, (item) => {
		const id = ids.get(item);
		const record = id === undefined ? undefined : read.nodes.get(id);
		if (!id || record?.id !== id || record.node !== item || record.role)
			throw new WriteDistractorsContentError("write-distractors-identity-invalid");
		return id;
	});
	if (
		owner.node.status !== "resolved" ||
		read.diagnostics.some(
			(d) =>
				d.severity === "error" &&
				// Runtime availability does not invalidate author content.
				d.code !== "unsupported-runtime" &&
				d.span.start >= owner.node.span.start &&
				d.span.end <= owner.node.span.end,
		)
	)
		throw new WriteDistractorsContentError("write-distractors-content-invalid");
	try {
		validateWriteDistractorsContent(content);
	} catch {
		// Never forward authored text or upstream exceptions to crash reporting.
		throw new WriteDistractorsContentError("write-distractors-content-invalid");
	}
	return content;
}

/** Grammar 4 reader. Invalid drafts return their source tree and diagnostics;
 * publication callers must refuse when hasErrors is true. Course checks remain
 * validateCourse's responsibility, with the host's complete cast/glossary/context. */
export function readLesson(source: string, options: ReadLessonOptions = {}) {
	const tree = analyzeLessonTree(tokenizeLesson(source), {
		definition: getDefinition,
		suggestType,
	});
	const parsedFrontmatter = parseFrontmatter(source);
	const metadata = readTreeFrontmatter(tree);
	const frontmatter = parsedFrontmatter.frontmatter;
	if (metadata.error) {
		const line = tree.stream.lines[parsedFrontmatter.errorLine ?? 0];
		const span = line
			? { start: line.start, end: line.end, tokenStart: line.tokenStart, tokenEnd: line.tokenEnd }
			: tree.root.span;
		tree.diagnostics.push({
			code: "invalid-course-metadata",
			severity: "error",
			span,
			line: (parsedFrontmatter.errorLine ?? 0) + 1,
			column: 1,
			message: { key: "grammar.v4.invalid-course-metadata", args: { reason: metadata.error } },
		});
		tree.root.status = "unresolved";
	}
	return projectLesson(tree, frontmatter, options);
}

function projectLesson(
	tree: AnalyzedLessonTree,
	frontmatter: GrammarFrontmatter,
	options: ReadLessonOptions,
) {
	const source = tree.stream.source;
	const adapted = toBlocks(tree, {
		ids: options.ids ?? createTransientIdAllocator(),
		cast: frontmatter.cast as Record<string, unknown> | undefined,
		variables:
			frontmatter.variables &&
			typeof frontmatter.variables === "object" &&
			!Array.isArray(frontmatter.variables)
				? (frontmatter.variables as Record<string, unknown>)
				: undefined,
	});
	const rendered = new Map<string, PraxityBlock>();
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const child of value) visit(child);
			return;
		}
		if (!value || typeof value !== "object") return;
		const record = value as Record<string, unknown>;
		if (typeof record.id === "string" && typeof record.type === "string" && record.data)
			rendered.set(record.id, record as unknown as PraxityBlock);
		for (const [key, child] of Object.entries(record))
			if (
				!isInlineProjectionMetadataKey(key, { keepDisplay: true }) &&
				child &&
				typeof child === "object"
			)
				visit(child);
	};
	visit(adapted.blocks);
	const errors: LessonReadError[] = tree.diagnostics.map((diagnostic, index) => {
		const owner = [...adapted.nodes.values()]
			.filter(
				(record) =>
					!record.role &&
					record.range.start <= diagnostic.span.start &&
					record.range.end >= diagnostic.span.end,
			)
			.sort((a, b) => a.range.end - a.range.start - (b.range.end - b.range.start))[0];
		const literalPractice = [...adapted.nodes.values()].find(
			(record) =>
				["retrieval-sheet", "write-distractors", "highlight"].includes(record.node.type ?? "") &&
				record.range.start <= diagnostic.span.start &&
				record.range.end >= diagnostic.span.end,
		);
		const practiceType = literalPractice?.node.type;
		return {
			id: `${diagnostic.code}-${diagnostic.span.start}-${index}`,
			level: diagnostic.severity,
			message:
				options.formatMessage?.(diagnostic.message) ??
				(practiceType === "write-distractors"
					? writeDistractorsDiagnosticMessage(diagnostic.code, diagnostic.message.args)
					: practiceType === "highlight"
						? practiceFieldDiagnosticMessage(diagnostic.code, diagnostic.message.args)
						: practiceType === "retrieval-sheet"
							? retrievalSheetDiagnosticMessage(diagnostic.code, diagnostic.message.args)
							: undefined) ??
				(diagnostic.code === "grammar-3"
					? `Grammar 3 is no longer supported. Run: ${diagnostic.message.args.command}. Prepare the converter checkout from tag converter-v3-to-v4; see docs/context/converter-archive.md.`
					: diagnostic.code === "private-choice-practice-only" ||
							diagnostic.code === "unsupported-runtime"
						? practiceDiagnosticMessage(diagnostic.code)
						: diagnostic.message.key),
			messageRef: diagnostic.message,
			blockId: owner?.id ?? "",
			blockType: owner
				? practiceType
					? practiceType
					: (rendered.get(owner.id)?.type ?? owner.node.type ?? owner.node.kind)
				: "lesson",
			line: diagnostic.line,
			column: diagnostic.column,
			start: diagnostic.span.start,
			end: diagnostic.span.end,
			category: "grammar",
			...(typeof diagnostic.message.args.name === "string"
				? { attribute: diagnostic.message.args.name }
				: {}),
		};
	});
	const warnings: ParseWarning[] = errors
		.filter((error) => error.level === "warning")
		.map((error) => ({ message: error.message, line: (error.line ?? 1) - 1 }));
	const spans = new Map<string, BlockSpan>();
	const containerRanges: ContainerSourceRange[] = [];
	for (const record of adapted.nodes.values()) {
		const span = {
			startLine: lineColumn(source, record.range.start).line - 1,
			endLine: lineColumn(source, Math.max(record.range.start, record.range.end - 1)).line - 1,
		};
		spans.set(record.id, span);
		if (
			record.node.kind === "block" &&
			!record.role &&
			(getDefinition(record.node.type ?? "")?.items || record.node.type === "group")
		)
			containerRanges.push({
				...span,
				blockId: record.id,
				keyword: record.node.type ?? "",
				explicitClose: !!record.node.closer,
			});
	}
	for (const page of adapted.pages)
		if (typeof frontmatter.lang === "string") page.locale = frontmatter.lang;
	const read = {
		...adapted,
		frontmatter,
		tree,
		diagnostics: tree.diagnostics,
		errors,
		warnings,
		spans,
		containerRanges,
		hasErrors: errors.some((error) => error.level === "error"),
		transientIds: !options.ids || options.ids.transient === true,
	};
	indexNodeIds(read.nodes);
	return read;
}

export type ReadLessonResult = ReturnType<typeof readLesson>;

export class LessonRuntimeError extends Error {
	readonly code = "unsupported-runtime";
	constructor(
		readonly diagnostic: LessonReadError,
		readonly path: string,
		readonly page: string,
	) {
		super();
		Object.assign(this, diagnostic);
		this.name = "LessonRuntimeError";
		this.message = this.formatMessage();
	}
	formatMessage(locale = "en"): string {
		return lessonRuntimeRefusalMessage(this.diagnostic, this.path, this.page, locale);
	}
}

/** Temporary source publication gate. Authoring reads retain typed practice prompts and
 * their source diagnostics; publishing owners must refuse them until runtime support
 * exists. Compiled admission independently checks each practice reader type. */
export function refuseUnavailableLessonRuntime(read: ReadLessonResult, path: string): void {
	const error = read.errors.find(
		(error) =>
			error.messageRef.key === "grammar.v4.unsupported-runtime" &&
			error.messageRef.args.type === "write-distractors",
	);
	if (error) {
		const page = read.pages.find((page) => {
			const record = read.nodes.get(page.id);
			return record && record.range.start <= error.start && error.start < record.range.end;
		});
		throw new LessonRuntimeError(
			error,
			path,
			page?.title || String(page ? read.pages.indexOf(page) + 1 : 1),
		);
	}
}

/** Authoring hosts may use exact source for revision admission and hashing;
 * learner output must use the reader projections instead. */
export function lessonSourceText(read: ReadLessonResult): string {
	return read.tree.stream.source;
}

/** Preview and output callers may select projected page content without its
 * generated title; raw author nodes and full self-check Content stay private. */
export function lessonPageBodyBlocks(read: ReadLessonResult, pageId: string): PraxityBlock[] {
	return (
		read.pages
			.find((page) => page.id === pageId)
			?.blocks.filter((block) => read.nodes.get(block.id)?.role !== "title") ?? []
	);
}

/** Rebuild ID-bearing projections from an existing parse after identity resolution. */
export function withLessonIds(read: ReadLessonResult, ids: LessonIdAllocator): ReadLessonResult {
	const messages = new Map(read.errors.map((error) => [error.messageRef, error.message]));
	return projectLesson(read.tree, read.frontmatter, {
		ids,
		formatMessage: (message) => messages.get(message) ?? message.key,
	});
}

/** Innermost semantic block containing a whole-file source line. */
export function lessonNodeAtLine(read: ReadLessonResult, line: number) {
	const position = read.tree.stream.lines[line]?.start;
	if (position === undefined) return undefined;
	return [...read.nodes.values()]
		.filter(
			(record) =>
				!record.role &&
				record.node.kind === "block" &&
				record.range.start <= position &&
				record.range.end > position,
		)
		.sort((a, b) => a.range.end - a.range.start - (b.range.end - b.range.start))[0];
}
