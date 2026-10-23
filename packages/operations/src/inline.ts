import type { InlineNode } from "@praxity/content-model/inline-tree";
import type {
	OperationRefusalCode,
	OperationTarget,
} from "@praxity/grammar/src/operations/contract.ts";
import { applyEdits, type SourceEdit } from "@praxity/grammar/src/source-edit.ts";
import { isSafeMediaUrl } from "@praxity/grammar/src/utils.ts";
import { tokenizeInline } from "@praxity/grammar/src/v4/inline.ts";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import {
	type CourseLesson,
	getDefinition,
	inlineText,
	learnerInline,
	validateCourse,
} from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";

type Editable = Extract<InlineNode, { kind: "link" | "term" }>;
export interface InlineSelection {
	target: OperationTarget;
	start: number;
	end: number;
}
export interface InlinePlan {
	file: string;
	token: Editable;
	edits: SourceEdit[];
	target: OperationTarget;
}
export class InlineRefusal extends Error {
	constructor(
		readonly code: OperationRefusalCode,
		readonly target?: OperationTarget,
	) {
		super(code);
		this.name = "InlineRefusal";
	}
}

function flatten(nodes: readonly InlineNode[]): InlineNode[] {
	return nodes.flatMap((n) => [n, ...("children" in n ? flatten(n.children) : [])]);
}
const escapeText = (text: string) => text.replace(/[\\`*_[\]{}()~=@]/gu, "\\$&");

/** Keep authored formatting delimiters; distribute a plain label across its existing leaves. */
function labelEdits(token: Editable, text: string, target: OperationTarget): SourceEdit[] {
	const leaves = flatten(token.children).filter((n) => !("children" in n));
	if (!leaves.length)
		return [{ start: token.start + 1, end: token.start + 1, text: escapeText(text) }];
	let cursor = 0;
	return leaves.map((n, i) => {
		const length =
			n.kind === "text" ? n.value.length : n.kind === "code" ? n.content.value.length : 0;
		let end = i === leaves.length - 1 ? text.length : Math.min(text.length, cursor + length);
		if (
			end < text.length &&
			/[\uD800-\uDBFF]/u.test(text[end - 1]) &&
			/[\uDC00-\uDFFF]/u.test(text[end])
		)
			end++;
		const part = text.slice(cursor, end);
		cursor = end;
		if (n.kind !== "text" && n.kind !== "code") throw new InlineRefusal("not-allowed", target);
		return n.kind === "code"
			? { start: n.content.start, end: n.content.end, text: part }
			: { start: n.start, end: n.end, text: escapeText(part) };
	});
}

/** Resolve only learner tokens, including glossary occurrences in the other revision-bound lessons. */
export function planInlineEdits(
	lessons: readonly CourseLesson[],
	selections: readonly InlineSelection[],
	args: Record<string, unknown>,
): { plans: InlinePlan[]; documents: CourseLesson[] } {
	const first = selections[0];
	if (!first) throw new InlineRefusal("invalid-args");
	const fail = (code: OperationRefusalCode, target = first.target): never => {
		throw new InlineRefusal(code, target);
	};
	if (
		!["text", "target", "definition"].some((k) => args[k] !== undefined) ||
		["text", "target", "definition"].some(
			(k) =>
				args[k] !== undefined &&
				(typeof args[k] !== "string" || (k !== "definition" && /[\r\n]/u.test(args[k] as string))),
		) ||
		(args.rename !== undefined && args.rename !== "one" && args.rename !== "all") ||
		(args.text !== undefined && !(args.text as string).trim())
	)
		return fail("invalid-args");
	const tokens = lessons.flatMap((lesson) =>
		flatten(learnerInline(lesson))
			.filter((n): n is Editable => n.kind === "link" || n.kind === "term")
			.map((token) => ({ file: lesson.path, token })),
	);
	const plans = new Map<string, InlinePlan>();
	const write = (file: string, token: Editable, edits: SourceEdit[], target: OperationTarget) => {
		const key = `${file}:${token.start}`;
		const plan = plans.get(key) ?? { file, token, edits: [], target };
		for (const edit of edits) {
			const existing = plan.edits.find((e) => e.start === edit.start && e.end === edit.end);
			if (existing && existing.text !== edit.text) return fail("conflict", target);
			if (!existing) plan.edits.push(edit);
		}
		plans.set(key, plan);
	};
	for (const selection of selections) {
		const { target } = selection;
		const range = target.inline;
		if (
			!range ||
			!Number.isInteger(range.start) ||
			!Number.isInteger(range.end) ||
			typeof range.expectedText !== "string"
		)
			return fail("invalid-args", target);
		const selected = tokens.find(
			(t) => t.file === target.file && t.token.start === range.start && t.token.end === range.end,
		);
		if (!selected || selected.token.raw !== range.expectedText) return fail("conflict", target);
		const { token } = selected;
		if (token.start < selection.start || token.end > selection.end)
			return fail("not-allowed", target);
		if (token.kind === "link") {
			if (args.definition !== undefined || args.rename !== undefined)
				return fail("invalid-args", target);
			if (typeof args.target === "string") {
				if (!isSafeMediaUrl(args.target)) return fail("not-allowed", target);
				write(
					target.file,
					token,
					[{ start: token.destination.start, end: token.destination.end, text: args.target }],
					target,
				);
			}
			if (typeof args.text === "string")
				write(target.file, token, labelEdits(token, args.text, target), target);
			continue;
		}
		if (args.target !== undefined) return fail("invalid-args", target);
		const term = inlineText(token.children);
		const occurrences = tokens.filter(
			(t) => t.token.kind === "term" && inlineText(t.token.children) === term,
		);
		const renamed = typeof args.text === "string" && args.text !== term;
		if (renamed && occurrences.length > 1 && args.rename === undefined)
			return fail("invalid-args", target);
		const all = args.rename === "all";
		const definitions = occurrences.filter(
			(t) => t.token.kind === "term" && t.token.definition.value,
		);
		if (definitions.length > 1 && args.definition !== undefined) return fail("ambiguous", target);
		const newDefinitions = renamed
			? tokens.filter(
					(t) =>
						t.token.kind === "term" &&
						inlineText(t.token.children) === args.text &&
						t.token.definition.value,
				)
			: [];
		if (renamed && all && newDefinitions.length) return fail("ambiguous", target);
		if (
			renamed &&
			!all &&
			!token.definition.value &&
			!newDefinitions.length &&
			(typeof args.definition !== "string" || !args.definition.trim())
		)
			return fail("invalid-args", target);
		if (typeof args.text === "string") {
			for (const occurrence of all ? occurrences : [selected])
				write(
					occurrence.file,
					occurrence.token,
					labelEdits(occurrence.token, args.text, target),
					target,
				);
		}
		if (typeof args.definition === "string") {
			if (!args.definition.trim()) return fail("invalid-args", target);
			const definer =
				renamed && !all
					? token.definition.value || !newDefinitions.length
						? selected
						: newDefinitions[0]
					: (definitions[0] ?? selected);
			if (definer.token.kind !== "term") return fail("invalid-args", target);
			write(
				definer.file,
				definer.token,
				[
					{
						start: definer.token.definition.start,
						end: definer.token.definition.end,
						text: escapeText(args.definition),
					},
				],
				target,
			);
		}
	}
	for (const plan of plans.values()) {
		if (
			[...plans.values()].some(
				(p) =>
					p !== plan &&
					p.file === plan.file &&
					p.token.start < plan.token.end &&
					p.token.end > plan.token.start,
			)
		)
			return fail("invalid-args", plan.target);
		const raw = applyEdits(
			plan.token.raw,
			plan.edits.map((e) => ({
				...e,
				start: e.start - plan.token.start,
				end: e.end - plan.token.start,
			})),
		);
		const parsed = tokenizeInline(raw).children;
		if (parsed.length !== 1 || parsed[0].kind !== plan.token.kind || parsed[0].end !== raw.length)
			return fail("invalid-args", plan.target);
		const next = parsed[0];
		if (next.kind !== "link" && next.kind !== "term") return fail("invalid-args", plan.target);
		const labelEnd =
			plan.token.kind === "link"
				? plan.token.destination.start - 2
				: plan.token.definition.start - 2;
		if (plan.edits.some((e) => e.start <= labelEnd) && inlineText(next.children) !== args.text)
			return fail("invalid-args", plan.target);
		const formatting = (nodes: readonly InlineNode[]) =>
			flatten(nodes)
				.filter((n) =>
					["strong", "emphasis", "strike", "highlight", "code", "doodle"].includes(n.kind),
				)
				.map((n) => n.kind)
				.join();
		if (formatting(plan.token.children) !== formatting(next.children))
			return fail("invalid-args", plan.target);
	}
	// Grammar owns glossary validity. Compare its course checks before and after the complete plan.
	const glossaryErrors = (inputs: readonly CourseLesson[]) =>
		validateCourse(inputs).diagnostics.filter((d) =>
			["undefined-glossary-term", "conflicting-glossary-definitions"].includes(d.code),
		);
	const previous = glossaryErrors(lessons);
	const edited = lessons.map((lesson) => {
		const edits = [...plans.values()].filter((p) => p.file === lesson.path).flatMap((p) => p.edits);
		return edits.length
			? {
					path: lesson.path,
					tree: analyzeLessonTree(tokenizeLesson(applyEdits(lesson.tree.stream.source, edits)), {
						definition: getDefinition,
					}),
				}
			: lesson;
	});
	for (const plan of plans.values()) {
		const lesson = edited.find((l) => l.path === plan.file);
		if (!lesson) return fail("orphaned", plan.target);
		const edits = [...plans.values()].filter((p) => p.file === plan.file).flatMap((p) => p.edits);
		const start =
			plan.token.start +
			edits
				.filter((e) => e.end <= plan.token.start && e.start < plan.token.start)
				.reduce((delta, e) => delta + e.text.length - (e.end - e.start), 0);
		const raw = applyEdits(
			plan.token.raw,
			plan.edits.map((e) => ({
				...e,
				start: e.start - plan.token.start,
				end: e.end - plan.token.start,
			})),
		);
		if (
			!flatten(learnerInline(lesson)).some(
				(n) => n.start === start && n.raw === raw && n.kind === plan.token.kind,
			)
		)
			return fail("escapes-range", plan.target);
	}
	for (const diagnostic of glossaryErrors(edited)) {
		if (
			!previous.some(
				(d) => d.code === diagnostic.code && d.message.args.term === diagnostic.message.args.term,
			)
		) {
			const term = diagnostic.message.args.term;
			const matching = [...plans.values()].filter(
				(p) =>
					p.token.kind === "term" && (inlineText(p.token.children) === term || args.text === term),
			);
			const member = matching.find((p) => p.file === diagnostic.path) ?? matching[0];
			return fail("not-allowed", member?.target ?? first.target);
		}
	}
	return { plans: [...plans.values()], documents: edited };
}
