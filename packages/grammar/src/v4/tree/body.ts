import type { Token, TokenLine, TokenStream } from "../lex/index.ts";
import { lexSettings, settingsStart } from "../lex/settings.ts";
import type { ReportDiagnostic } from "./analyze.ts";
import { bodyNode, bodyValue, extendNode, span } from "./source.ts";
import { readTable } from "./table.ts";
import type { BodyDefinition, BodyKind, TreeNode } from "./types.ts";

interface ListFrame {
	list: TreeNode;
	indent: number;
	content: number;
	entry: TreeNode;
}

export function interpretBodies(
	stream: TokenStream,
	root: TreeNode,
	definitions: ReadonlyMap<TreeNode, BodyDefinition | undefined>,
	report: ReportDiagnostic,
): void {
	const owners = [root];
	for (let index = 0; index < owners.length; index++) owners.push(...owners[index].children);
	const lineIndex = new Map(stream.lines.map((line, index) => [line.tokenStart, index]));
	for (const owner of owners) {
		const definition = definitions.get(owner);
		const children: TreeNode[] = [];
		for (let index = 0; index < owner.children.length; index++) {
			const child = owner.children[index];
			if (child.kind !== "body") {
				children.push(child);
				continue;
			}
			let end = child.span.tokenEnd;
			// A semantic run may bridge blank trivia, but never a structural sibling.
			while (owner.children[index + 1]?.kind === "body")
				end = owner.children[++index].span.tokenEnd;
			const first = lineIndex.get(child.span.tokenStart);
			if (first === undefined) throw new Error("Body must begin at a lexical line boundary");
			let last = first;
			while (last < stream.lines.length && stream.lines[last].tokenStart < end) last++;
			const run = interpretRun(
				stream,
				stream.lines.slice(first, last),
				definition?.body,
				owner,
				definition,
				report,
			);
			children.push(...run);
		}
		owner.children = children;
		// Only blanks now enclosed by a semantic child change owners.
		owner.trivia = owner.trivia.filter(
			(gap) =>
				!children.some((child) => child.span.start <= gap.start && child.span.end >= gap.end),
		);
		if (definition?.body === "options") {
			const choices = children.filter((n) => n.kind === "option");
			const firstKind = choices[0]?.optionKind;
			for (const choice of choices)
				if (choice.optionKind !== firstKind) {
					report("mixed-option-markers", choice.header ?? choice.span, {
						marker: firstKind ?? "single",
					});
					choice.optionKind = firstKind;
				}
		}
	}
}

function interpretRun(
	stream: TokenStream,
	lines: TokenLine[],
	kind: BodyKind | undefined,
	owner: TreeNode,
	definition: BodyDefinition | undefined,
	report: ReportDiagnostic,
): TreeNode[] {
	const result: TreeNode[] = [];
	const frames: ListFrame[] = [];
	let active: TreeNode | undefined;
	let pending: TokenLine[] = [];
	const raw = (line: TokenLine) => stream.source.slice(line.start, line.contentEnd);
	const flush = () => {
		// Unconsumed gaps remain on the original owner; interpretBodies removes owned gaps.
		pending = [];
	};
	const leaf = (line: TokenLine, nodeKind: "body" | "recovery" = "body") => {
		const prior = result.at(-1);
		if (nodeKind === "body" && prior?.kind === "body" && prior.span.tokenEnd === line.tokenStart)
			extendNode(stream, prior, line.tokenEnd);
		else result.push(bodyNode(stream, nodeKind, line.tokenStart, line.tokenEnd));
	};
	const continuation = (node: TreeNode, line: TokenLine) => {
		if (node.children.length) {
			for (const gap of pending) node.trivia.push(span(stream, gap.tokenStart, gap.tokenEnd));
			node.children.push(bodyNode(stream, "body", line.tokenStart, line.tokenEnd));
		} else node.header = span(stream, node.span.tokenStart, line.tokenEnd);
		pending = [];
		if (node.text) node.text = bodyValue(stream, node.text.range.start, line.contentEnd);
		extendNode(stream, node, line.tokenEnd);
		for (const frame of frames) {
			extendNode(stream, frame.entry, line.tokenEnd);
			extendNode(stream, frame.list, line.tokenEnd);
		}
	};
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const text = raw(line);
		if (line.kind === "blank") {
			pending.push(line);
			continue;
		}
		// Protected lexical lines remain protected in the body interpreter too.
		const protectedLine = ["code", "code-fence", "math", "math-fence", "quote"].includes(line.kind);
		const named = protectedLine ? null : /^([A-Za-z][A-Za-z0-9]*)([ \t\u00a0\u202f]*):/.exec(text);
		if (
			named &&
			(Object.hasOwn(definition?.settings ?? {}, named[1]) ||
				Object.hasOwn(definition?.settingAliases ?? {}, named[1]))
		) {
			report("setting-on-body-line", span(stream, line.tokenStart, line.tokenEnd), {
				name: named[1],
				type: owner.type ?? owner.kind,
			});
			flush();
			active = undefined;
			frames.length = 0;
			leaf(line, "recovery");
			continue;
		}
		if (named?.[2] && definition?.parts?.includes(named[1]))
			report(
				"part-colon-spacing",
				span(stream, line.tokenStart, line.tokenEnd),
				{ name: named[1] },
				"warning",
			);
		const feedback = kind === "options" && line.kind === "part" && text.startsWith("feedback:");
		if (kind === "options" && line.kind === "part" && /^(?:correct|incorrect):/.test(text)) {
			report("detached-option-feedback", span(stream, line.tokenStart, line.tokenEnd));
			flush();
			active = undefined;
			leaf(line, "recovery");
			continue;
		}
		if (feedback) {
			if (active?.kind !== "option" || pending.length) {
				report("detached-option-feedback", span(stream, line.tokenStart, line.tokenEnd));
				flush();
				active = undefined;
				leaf(line, "recovery");
				continue;
			}
			if (active.children.some((n) => n.kind === "part" && n.name === "feedback")) {
				report("duplicate-option-feedback", span(stream, line.tokenStart, line.tokenEnd));
				leaf(line, "recovery");
				active = undefined;
				continue;
			}
			const part = bodyNode(stream, "part", line.tokenStart, line.tokenEnd);
			part.name = "feedback";
			part.header = { ...part.span };
			const valueIndex = stream.tokens.findIndex(
				(token, tokenIndex) =>
					tokenIndex >= line.tokenStart &&
					tokenIndex < line.tokenEnd &&
					token.kind === "part-value",
			);
			const boundary =
				valueIndex >= 0
					? valueIndex
					: stream.tokens[line.tokenEnd - 1]?.kind === "line-ending"
						? line.tokenEnd - 1
						: line.tokenEnd;
			const location = span(stream, boundary, valueIndex >= 0 ? boundary + 1 : boundary);
			part.value = {
				span: location,
				raw: stream.source.slice(location.start, location.end),
				value: valueIndex >= 0 ? String(stream.tokens[valueIndex].value) : "",
			};
			while (index + 1 < lines.length) {
				let nextIndex = index + 1;
				while (nextIndex < lines.length && lines[nextIndex].kind === "blank") nextIndex++;
				if (nextIndex >= lines.length || !raw(lines[nextIndex]).startsWith("  ")) break;
				while (index + 1 < nextIndex) {
					const gap = lines[++index];
					part.trivia.push(span(stream, gap.tokenStart, gap.tokenEnd));
				}
				const next = lines[++index];
				part.children.push(bodyNode(stream, "body", next.tokenStart, next.tokenEnd));
				const tokenEnd =
					stream.tokens[next.tokenEnd - 1]?.kind === "line-ending"
						? next.tokenEnd - 1
						: next.tokenEnd;
				part.value.span = span(stream, location.tokenStart, tokenEnd);
				part.value.raw = stream.source.slice(part.value.span.start, part.value.span.end);
				part.value.value = part.value.raw;
				extendNode(stream, part, next.tokenEnd);
			}
			active.children.push(part);
			extendNode(stream, active, part.span.tokenEnd);
			continue;
		}
		const option =
			!protectedLine && kind === "options" ? /^(\([ xX]\)|\[[ xX]\])[ \t]+/.exec(text) : null;
		const task = !protectedLine && kind === "tasks" ? /^- \[([ xX])\][ \t]+/.exec(text) : null;
		const pair =
			!protectedLine && kind === "pairs" ? /^- (.*?)(?<!\\)[ \t]+->[ \t]+(.*)$/.exec(text) : null;
		const turn =
			!protectedLine && kind === "turns"
				? /^- ([A-Za-z][A-Za-z0-9_-]*):[ \t\u00a0\u202f]+/.exec(text)
				: null;
		const spot = !protectedLine && kind === "spots" ? /^- /.exec(text) : null;
		if (option || task || pair || turn || spot) {
			flush();
			frames.length = 0;
			const nodeKind = option ? "option" : task ? "task" : pair ? "pair" : turn ? "turn" : "spot";
			const node = bodyNode(stream, nodeKind, line.tokenStart, line.tokenEnd);
			node.header = { ...node.span };
			let textStart =
				line.start + (option?.[0].length ?? task?.[0].length ?? turn?.[0].length ?? 2);
			let textEnd = line.contentEnd;
			if (option) {
				node.correct = /[xX]/.test(option[1]);
				node.optionKind = option[1][0] === "(" ? "single" : "multiple";
			}
			if (task) node.checked = task[1].toLowerCase() === "x";
			if (pair) {
				textStart = line.start + 2;
				textEnd = textStart + pair[1].length;
				node.answer = bodyValue(stream, line.contentEnd - pair[2].length, line.contentEnd);
			}
			if (turn) node.speaker = bodyValue(stream, line.start + 2, line.start + 2 + turn[1].length);
			if (spot) {
				textEnd = settingsStart(stream.source, textStart, textEnd, false);
				const tokens: Token[] = [];
				if (textEnd < line.contentEnd) lexSettings(stream.source, textEnd, line.contentEnd, tokens);
				node.bodySettings = [];
				for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
					const token = tokens[tokenIndex];
					if (token.kind === "diagnostic") {
						report(token.value.code, node.span, token.value.name ? { name: token.value.name } : {});
						continue;
					}
					if (token.kind !== "setting-key" && token.kind !== "setting-flag") continue;
					const value = token.kind === "setting-flag" ? token : tokens[tokenIndex + 2];
					if (!value) continue;
					node.bodySettings.push({
						name: token.raw,
						range: { start: token.start, end: value.end },
						value: {
							...bodyValue(stream, value.start, value.end),
							value: value.value === true ? true : String(value.value),
						},
					});
				}
				while (textEnd > textStart && /[ \t]/.test(stream.source[textEnd - 1])) textEnd--;
			}
			node.text = bodyValue(stream, textStart, textEnd);
			result.push(node);
			active = node;
			continue;
		}
		const marker =
			!protectedLine && line.kind === "list-item" ? /^( *)(- |[0-9]+\. )/.exec(text) : null;
		if (marker && !["options", "tasks", "pairs", "turns", "spots", "tables"].includes(kind ?? "")) {
			const indent = marker[1].length;
			const ordered = marker[2] !== "- ";
			while (frames.length && indent < frames[frames.length - 1].indent) frames.pop();
			let frame = frames.at(-1);
			if (!frame && indent > 0) {
				active = undefined;
				flush();
				leaf(line);
				continue;
			}
			if (frame && indent > frame.indent && indent !== frame.content) {
				// A short continuation is literal prose, never a flattened nested item.
				frames.length = 0;
				active = undefined;
				flush();
				leaf(line);
				continue;
			}
			if (!frame || indent > frame.indent || frame.list.ordered !== ordered) {
				if (frame && indent === frame.indent) {
					frames.pop();
					frame = frames.at(-1);
				}
				if (frame && kind === "steps")
					report("nested-order-list", span(stream, line.tokenStart, line.tokenEnd));
				const list = bodyNode(stream, "list", line.tokenStart, line.tokenEnd);
				list.ordered = ordered;
				if (ordered) list.startNumber = Number(marker[2].slice(0, -2));
				if (frame) {
					for (const gap of pending)
						frame.entry.trivia.push(span(stream, gap.tokenStart, gap.tokenEnd));
					frame.entry.children.push(list);
				} else result.push(list);
				frame = { list, indent, content: marker[0].length, entry: list };
				frames.push(frame);
			} else
				for (const gap of pending)
					frame.list.trivia.push(span(stream, gap.tokenStart, gap.tokenEnd));
			pending = [];
			const entry = bodyNode(
				stream,
				kind === "steps" && frames.length === 1 && ordered ? "step" : "list-entry",
				line.tokenStart,
				line.tokenEnd,
			);
			entry.header = { ...entry.span };
			entry.text = bodyValue(stream, line.start + marker[0].length, line.contentEnd);
			if (ordered) entry.number = Number(marker[2].slice(0, -2));
			frame.list.children.push(entry);
			frame.entry = entry;
			frame.content = marker[0].length;
			for (const ancestor of frames) {
				extendNode(stream, ancestor.list, line.tokenEnd);
				if (ancestor !== frame) extendNode(stream, ancestor.entry, line.tokenEnd);
			}
			active = entry;
			continue;
		}
		const frame = frames.at(-1);
		const indent = /^ */.exec(text)?.[0].length ?? 0;
		if (active && ((frame && indent >= frame.content) || (!frame && indent >= 2))) {
			continuation(active, line);
			continue;
		}
		// Code inside a list is lexically protected even when its raw indentation is zero.
		if (frame && protectedLine && ["code", "code-fence"].includes(line.kind)) {
			continuation(frame.entry, line);
			continue;
		}
		frames.length = 0;
		active = undefined;
		flush();
		const table = !protectedLine ? readTable(stream, lines, index, kind === "tables") : undefined;
		if (table) {
			result.push(table.node);
			index = table.last;
			continue;
		}
		leaf(line);
	}
	return result;
}
