import { fillBlankParts } from "@praxity/content-model";
import { findLineEnding } from "@praxity/grammar/src/line-endings.ts";
import type { SourceEdit } from "@praxity/grammar/src/source-edit.ts";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import {
	type ConversionDeclaration,
	getDefinition,
	maskedBlankContent,
} from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree, type TreeNode } from "@praxity/grammar/src/v4/tree/index.ts";
import { minimalEdit } from "./ranges.ts";

/** Transform authored fields, using declaration losses rather than a second conversion matrix. */
export function conversionEdits(
	source: string,
	node: TreeNode,
	declaration: ConversionDeclaration,
	title?: string,
): SourceEdit[] {
	const type = declaration.target;
	const definition = getDefinition(type);
	if (!definition) throw new Error("conversion-target");
	const losses = new Set(declaration.losses);
	const eol = findLineEnding(source.slice(node.span.start, node.span.end)) ?? "\n";
	const edits: SourceEdit[] = [];
	const replace = (start: number, end: number, text: string) => {
		const edit = minimalEdit(source, { start, end, text });
		if (edit) edits.push(edit);
	};
	const rawSettings = node.settings
		.filter((s) => !losses.has(`setting:${s.name}`))
		.map((s) => source.slice(s.span.start, s.span.end));
	const settings = rawSettings.length ? ` {${rawSettings.join(" ")}}` : "";
	const responseNodes = (n: TreeNode): TreeNode[] =>
		n.children.flatMap((child) =>
			child.text && ["option", "task", "step", "list-entry"].includes(child.kind)
				? [child]
				: child.kind === "list"
					? responseNodes(child)
					: [],
		);
	const responses = responseNodes(node);
	const subject =
		definition.subject.kind === "none"
			? ""
			: node.subject?.raw ||
				title ||
				(definition.subject.required ? responses[0]?.text?.raw : "") ||
				"";
	const header =
		type === "page"
			? `# ${title}${settings}${eol}`
			: `::: ${type}${subject ? ` ${subject}` : ""}${settings}${eol}`;
	if (node.kind === "heading") {
		replace(node.span.start, node.span.end, `${header}${node.subject?.raw ?? ""}${eol}:::${eol}`);
		return edits;
	}
	if (node.kind === "image") {
		const tokens = tokenizeLesson(node.raw).tokens;
		const open = tokens.find((t) => t.kind === "settings-open");
		const close = tokens.find((t) => t.kind === "settings-close");
		const image =
			open && close
				? node.raw.slice(0, open.start).trimEnd() + node.raw.slice(close.end)
				: node.raw;
		replace(
			node.span.start,
			node.span.end,
			`${header}${image}${image.endsWith("\n") ? "" : eol}:::${eol}`,
		);
		return edits;
	}
	if (node.header) {
		const ending =
			source.slice(node.header.start, node.header.end).match(/(?:\r\n|\r|\n)$/u)?.[0] ?? "";
		replace(node.header.start, node.header.end, header.replace(/(?:\r\n|\r|\n)$/u, ending));
	} else {
		// Leaf forms gain a text container without changing their literal content.
		edits.push({ start: node.span.start, end: node.span.start, text: header });
	}
	if (type === "page") return edits;
	if (!node.closer) {
		edits.push({
			start: node.span.end,
			end: node.span.end,
			text: `${node.raw.endsWith("\n") ? "" : eol}:::${eol}`,
		});
		return edits;
	}
	const from = getDefinition(node.type ?? node.kind);
	const visit = (child: TreeNode, parent: TreeNode) => {
		// Nested blocks keep their own declarations and interpretation.
		if (child.kind === "block") return;
		if (
			(child.kind === "part" && losses.has(`part:${child.name}`)) ||
			(child.kind === "back" && losses.has("back-faces")) ||
			(child.kind === "image" && losses.has("image"))
		) {
			edits.push({ start: child.span.start, end: child.span.end, text: "" });
			return;
		}
		if (child.kind === "item" && !definition.items) {
			if (child.header) edits.push({ start: child.header.start, end: child.header.end, text: "" });
			// Separate flattened items even if the author wrote no trivia between them.
			if (parent.children.indexOf(child) > 0)
				edits.push({
					start: child.header?.end ?? child.span.start,
					end: child.header?.end ?? child.span.start,
					text: eol,
				});
		} else if (
			child.kind === "item" &&
			definition.itemDefinition?.subject.required &&
			!String(child.subject?.value ?? "").trim() &&
			child.header
		) {
			replace(
				child.header.start,
				child.header.end,
				`:: ${parent.children.indexOf(child) + 1}${eol}`,
			);
		}
		if (child.kind === "table" && losses.has("table-structure")) {
			replace(
				child.span.start,
				child.span.end,
				(child.rows ?? []).map((row) => row.cells.map((c) => c.raw).join(" ")).join(eol) + eol,
			);
			return;
		}
		if (child.kind === "turn" && losses.has("turn-speakers"))
			replace(child.span.start, child.text?.range.start ?? child.span.start, "");
		if (child.kind === "pair" && losses.has("match-pairs"))
			replace(
				child.span.start,
				child.span.end,
				`${child.text?.raw ?? ""} ${child.answer?.raw ?? ""}${eol}`,
			);
		if (child.kind === "spot" && losses.has("spot-geometry"))
			replace(child.span.start, child.span.end, `${child.text?.raw ?? ""}${eol}`);
		if (child.kind === "body" && losses.has("blank-answers")) {
			let offset = child.span.start;
			for (const part of fillBlankParts(maskedBlankContent(child.raw))) {
				if (part.blank) replace(offset, offset + part.text.length, "");
				offset += part.text.length;
			}
		}
		if (!(child.kind === "option" && losses.has("option-feedback")))
			for (const nested of child.children) visit(nested, child);
	};
	for (const child of node.children) visit(child, node);
	if (from?.items && definition.items) return edits;
	if (!from?.items && definition.items) {
		edits.push({
			start: node.header?.end ?? node.span.start,
			end: node.header?.end ?? node.span.start,
			text: `:: ${node.subject?.raw || title || "1"}${eol}`,
		});
	}
	if (responses.length) {
		// Existing response text is the new response list. Only schema-declared state/roles disappear.
		let number = 0;
		const targetBody = definition.body;
		for (const response of responses) {
			if (!response.text) continue;
			const scaleLabel =
				["rating", "matrix"].includes(node.type ?? "") && response.number !== undefined;
			const marker =
				targetBody === "options"
					? "( ) "
					: targetBody === "tasks"
						? "- [ ] "
						: targetBody === "steps"
							? `${++number}. `
							: type === "matrix"
								? scaleLabel
									? `${++number}. `
									: "- "
								: "";
			replace(response.span.start, response.text.range.start, marker);
			if (response.kind === "option" && losses.has("option-feedback")) {
				for (const part of response.children)
					edits.push({ start: part.span.start, end: part.span.end, text: "" });
			}
		}
		if (
			type === "matrix" &&
			!responses.some(
				(r) => r.number !== undefined && ["rating", "matrix"].includes(node.type ?? ""),
			)
		) {
			// Missing target scaffolding comes from its schema template, never interface copy here.
			const template = analyzeLessonTree(tokenizeLesson(`# _\n${definition.insertTemplate}`), {
				definition: getDefinition,
			}).root.children[0]?.children[0];
			const scale = template?.children.find((c) => c.kind === "list" && c.ordered);
			if (scale)
				edits.push({
					start: node.header?.end ?? node.span.start,
					end: node.header?.end ?? node.span.start,
					text: scale.raw.replace(/\r\n|\r|\n/gu, eol),
				});
		} else if (type === "matrix" && !responses.some((r) => r.number === undefined)) {
			edits.push({
				start: node.closer.start,
				end: node.closer.start,
				text: `- ${node.subject?.raw || subject}${eol}`,
			});
		}
		if (["choice", "rating", "order"].includes(type)) {
			const template = analyzeLessonTree(tokenizeLesson(`# _\n${definition.insertTemplate}`), {
				definition: getDefinition,
			}).root.children[0]?.children[0];
			const defaults = template ? responseNodes(template) : [];
			const min = definition.childCounts.find((c) => c.kind === "option")?.min ?? defaults.length;
			for (let i = responses.length; i < min; i++) {
				const text = defaults[i]?.text?.raw;
				if (text)
					edits.push({
						start: node.closer.start,
						end: node.closer.start,
						text: `${type === "choice" ? "( ) " : `${i + 1}. `}${text}${eol}`,
					});
			}
		}
	}
	return edits;
}

/** Standalone drafts must parse as exactly one block, excluding page or delimiter escapes. */
export function replacementText(text: string, eol: string): string | null {
	const raw = text.replace(/\r\n|\r|\n/gu, eol).replace(/[\r\n]+$/u, "") + eol;
	const tree = analyzeLessonTree(tokenizeLesson(`# _${eol}${raw}`), { definition: getDefinition });
	if (
		tree.root.children.length !== 1 ||
		tree.root.children[0]?.children.length !== 1 ||
		tree.diagnostics.some((d) => d.severity === "error")
	)
		return null;
	return raw;
}
