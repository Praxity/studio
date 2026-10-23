import { lineColumn, type TokenLine, type TokenStream } from "../lex/index.ts";
import { span } from "./source.ts";
import type {
	LessonTree,
	SourceSpan,
	SourceValue,
	TreeDiagnostic,
	TreeDiagnosticCode,
	TreeKind,
	TreeNode,
	TreeOptions,
	TreeSetting,
} from "./types.ts";

function value(stream: TokenStream, index: number): SourceValue {
	const token = stream.tokens[index];
	return {
		span: span(stream, index, index + 1),
		raw: token.raw,
		value: token.kind === "diagnostic" ? token.raw : (token.value ?? token.raw),
	};
}

/** Authored header settings before schema filtering, using the original lexical tokens. */
export function readHeaderSettings(
	stream: TokenStream,
	line: Pick<TokenLine, "tokenStart" | "tokenEnd">,
): TreeSetting[] {
	const result: TreeSetting[] = [];
	for (let index = line.tokenStart; index < line.tokenEnd; index++) {
		const token = stream.tokens[index];
		if (token.kind === "setting-flag") {
			result.push({
				name: token.raw,
				span: span(stream, index, index + 1),
				value: value(stream, index),
			});
		} else if (
			token.kind === "setting-key" &&
			stream.tokens[index + 1]?.kind === "setting-equals" &&
			stream.tokens[index + 2]?.kind === "setting-value"
		) {
			result.push({
				name: token.raw,
				span: span(stream, index, index + 3),
				value: value(stream, index + 2),
			});
		}
		// G1 replaces duplicate names with diagnostic tokens. Their trailing values have no key.
	}
	return result;
}

/** Builds structure over G1's unchanged tokens; body interpretation and schema validation follow in G3-G5. */
export function buildLessonTree(stream: TokenStream, options: TreeOptions = {}): LessonTree {
	const diagnostics: TreeDiagnostic[] = [];
	const makeNode = (kind: TreeKind, tokenStart: number, tokenEnd: number): TreeNode => ({
		kind,
		status: "resolved",
		span: span(stream, tokenStart, tokenEnd),
		raw: "",
		children: [],
		trivia: [],
		settings: [],
	});
	const root = makeNode("lesson", 0, stream.tokens.length);
	const stack: TreeNode[] = [root];
	const current = () => stack[stack.length - 1];
	const extend = (node: TreeNode, tokenEnd: number) => {
		node.span = span(stream, node.span.tokenStart, tokenEnd);
	};
	const report = (
		code: TreeDiagnosticCode,
		location: SourceSpan,
		facts: Pick<TreeDiagnostic, "type" | "name" | "firstStart"> = {},
	) => {
		diagnostics.push({
			code,
			span: location,
			...lineColumn(stream.source, location.start),
			...facts,
		});
	};
	const add = (node: TreeNode) => {
		current().children.push(node);
		extend(current(), node.span.tokenEnd);
	};
	const header = (kind: TreeKind, line: TokenLine) => {
		const node = makeNode(kind, line.tokenStart, line.tokenEnd);
		node.header = span(stream, line.tokenStart, line.tokenEnd);
		node.settings = readHeaderSettings(stream, line);
		for (let index = line.tokenStart; index < line.tokenEnd; index++) {
			const token = stream.tokens[index];
			switch (token.kind) {
				case "block-type":
					node.type = token.raw;
					break;
				case "part-name":
					node.name = token.raw;
					break;
				case "subject":
					node.subject = value(stream, index);
					break;
				case "part-value":
					node.value = value(stream, index);
					break;
				case "image-alt":
					node.alt = value(stream, index);
					break;
				case "image-source":
					node.source = value(stream, index);
					break;
			}
		}
		if (kind === "part" && !node.value) {
			const boundary =
				stream.tokens[line.tokenEnd - 1]?.kind === "line-ending"
					? line.tokenEnd - 1
					: line.tokenEnd;
			node.value = { span: span(stream, boundary, boundary), raw: "", value: "" };
		}
		return node;
	};
	const pop = () => {
		const node = stack.pop();
		if (!node) throw new Error("Cannot pop an empty lesson stack");
		extend(current(), node.span.tokenEnd);
		return node;
	};
	const finishItem = () => {
		const item = current();
		const container = stack[stack.length - 2];
		// Blank gaps between items, including empty items, belong to the container.
		const trailing: SourceSpan[] = [];
		while (item.trivia.at(-1)?.tokenEnd === item.span.tokenEnd) {
			const trivia = item.trivia.pop();
			if (!trivia) break;
			trailing.unshift(trivia);
			extend(item, trivia.tokenStart);
		}
		container.trivia.push(...trailing);
		pop();
	};
	const finishPage = (tokenEnd: number) => {
		while (stack.length > 1) {
			const node = current();
			if (node.kind === "item") {
				finishItem();
			} else {
				extend(node, tokenEnd);
				if (node.kind === "block" || node.kind === "back") {
					node.status = "unresolved";
					report("unclosed-block", node.header ?? node.span, { type: node.type });
				}
				pop();
			}
		}
	};
	const requirePage = (line: TokenLine) => {
		if (current() !== root) return;
		const page = makeNode("page", line.tokenStart, line.tokenStart);
		page.status = "unresolved";
		add(page);
		stack.push(page);
		report("content-before-page", span(stream, line.tokenStart, line.tokenEnd));
	};
	const body = (line: TokenLine) => {
		const previous = current().children.at(-1);
		if (previous?.kind === "part" && stream.source.startsWith("  ", line.start)) {
			// Blank lines become internal part trivia only when an indented paragraph follows.
			const gap = current().trivia.findIndex(
				(trivia) => trivia.tokenStart >= previous.span.tokenEnd,
			);
			if (gap >= 0) previous.trivia.push(...current().trivia.splice(gap));
			const continuation = previous.children.at(-1);
			if (continuation?.kind === "body" && continuation.span.tokenEnd === line.tokenStart) {
				extend(continuation, line.tokenEnd);
			} else {
				previous.children.push(makeNode("body", line.tokenStart, line.tokenEnd));
			}
			const boundary =
				stream.tokens[line.tokenEnd - 1]?.kind === "line-ending"
					? line.tokenEnd - 1
					: line.tokenEnd;
			if (previous.value) {
				const combined = span(stream, previous.value.span.tokenStart, boundary);
				previous.value.value += stream.source.slice(previous.value.span.end, combined.end);
				previous.value.span = combined;
				previous.value.raw = stream.source.slice(combined.start, combined.end);
			}
			extend(previous, line.tokenEnd);
			extend(current(), line.tokenEnd);
		} else if (previous?.kind === "body" && previous.span.tokenEnd === line.tokenStart) {
			extend(previous, line.tokenEnd);
			extend(current(), line.tokenEnd);
		} else {
			add(makeNode("body", line.tokenStart, line.tokenEnd));
		}
	};

	let frontmatter: TreeNode | undefined;
	for (const line of stream.lines) {
		if (line.kind === "frontmatter-fence" || line.kind === "frontmatter") {
			if (!frontmatter) {
				frontmatter = makeNode("frontmatter", line.tokenStart, line.tokenEnd);
				root.children.push(frontmatter);
			} else {
				extend(frontmatter, line.tokenEnd);
			}
			continue;
		}
		if (line.kind === "blank") {
			current().trivia.push(span(stream, line.tokenStart, line.tokenEnd));
			extend(current(), line.tokenEnd);
			continue;
		}
		if (line.kind === "page") {
			finishPage(line.tokenStart);
			const page = header("page", line);
			add(page);
			stack.push(page);
		} else {
			requirePage(line);
			switch (line.kind) {
				case "opener": {
					const node = header("block", line);
					if (node.type === "back") node.kind = "back";
					add(node);
					stack.push(node);
					break;
				}
				case "closer":
					if (current().kind === "item") finishItem();
					if (current().kind === "block" || current().kind === "back") {
						current().closer = span(stream, line.tokenStart, line.tokenEnd);
						extend(current(), line.tokenEnd);
						pop();
					} else {
						const node = makeNode("recovery", line.tokenStart, line.tokenEnd);
						node.status = "unresolved";
						add(node);
						report("stray-closer", node.span);
					}
					break;
				case "item": {
					if (options.allowsItems) {
						let owner = stack.length - 1;
						while (
							owner > 0 &&
							!(stack[owner].kind === "block" && options.allowsItems(stack[owner]))
						)
							owner--;
						if (owner > 0) {
							while (stack.length - 1 > owner && current().kind !== "item") {
								const inner = current();
								extend(inner, line.tokenStart);
								inner.status = "unresolved";
								// G3 distinguishes this boundary from EOF/page recovery.
								report("unclosed-block", inner.header ?? inner.span, { type: inner.type });
								pop();
							}
						}
					}
					if (current().kind === "item") finishItem();
					const node = header("item", line);
					if (
						(current().kind === "block" || current().kind === "back") &&
						(!options.allowsItems || options.allowsItems(current()))
					) {
						add(node);
						stack.push(node);
					} else {
						node.kind = "recovery";
						node.status = "unresolved";
						add(node);
						report("stray-item", node.span);
					}
					break;
				}
				case "heading":
				case "divider":
				case "image":
					add(header(line.kind, line));
					break;
				case "part": {
					const node = header("part", line);
					if (node.name && options.isPart?.(node.name, current(), stack.at(-2))) add(node);
					else body(line);
					break;
				}
				case "diagnostic": {
					const node = makeNode("recovery", line.tokenStart, line.tokenEnd);
					node.status = "unresolved";
					add(node);
					break;
				}
				default:
					body(line);
			}
		}
		for (let index = line.tokenStart; index < line.tokenEnd; index++) {
			const token = stream.tokens[index];
			if (token.kind !== "diagnostic") continue;
			report(token.value.code, span(stream, index, index + 1), {
				name: token.value.name,
				firstStart: token.value.firstStart,
			});
			const node = current().children.at(-1);
			// Openers/pages/items are now on the stack; leaf headers are still its last child.
			if (current().header?.tokenStart === line.tokenStart) current().status = "unresolved";
			else if (node) node.status = "unresolved";
		}
	}
	finishPage(stream.tokens.length);
	extend(root, stream.tokens.length);
	// Iterative postorder keeps deeply nested authored drafts off the JavaScript call stack.
	const nodes = [root];
	for (let index = 0; index < nodes.length; index++) nodes.push(...nodes[index].children);
	for (let index = nodes.length - 1; index >= 0; index--) {
		const node = nodes[index];
		node.raw = stream.source.slice(node.span.start, node.span.end);
		if (node.children.some((child) => child.status === "unresolved")) node.status = "unresolved";
	}
	return { stream, root, diagnostics };
}
