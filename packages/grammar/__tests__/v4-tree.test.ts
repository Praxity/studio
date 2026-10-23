import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lineColumn, type TokenStream, tokenizeLesson } from "../src/v4/lex";
import { buildLessonTree, type SourceSpan, type TreeNode, type TreeOptions } from "../src/v4/tree";

// Literal corpus declarations, not the production schema, which arrives in G4/G5.
const corpusOptions: TreeOptions = {
	isPart: (name, owner) =>
		(owner.kind === "page" && name === "nav") ||
		(owner.type === "quote" && ["speaker", "work"].includes(name)) ||
		(owner.type === "group" && name === "button") ||
		(owner.type === "free-response" && name === "placeholder"),
};

function walk(node: TreeNode): TreeNode[] {
	return [node, ...node.children.flatMap(walk)];
}

function assertSpans(stream: TokenStream, root: TreeNode) {
	const assertSpan = (span: SourceSpan) => {
		expect(span.start).toBe(stream.tokens[span.tokenStart]?.start ?? stream.source.length);
		expect(span.end).toBe(span.tokenEnd === 0 ? 0 : stream.tokens[span.tokenEnd - 1].end);
		expect(
			stream.tokens
				.slice(span.tokenStart, span.tokenEnd)
				.map((t) => t.raw)
				.join(""),
		).toBe(stream.source.slice(span.start, span.end));
	};
	for (const node of walk(root)) {
		assertSpan(node.span);
		expect(node.raw).toBe(stream.source.slice(node.span.start, node.span.end));
		const spans = [
			...node.trivia,
			...node.children.map((child) => child.span),
			...[
				node.header,
				node.closer,
				node.subject?.span,
				node.value?.span,
				node.alt?.span,
				node.source?.span,
			].filter((s): s is SourceSpan => s !== undefined),
			...node.settings.flatMap((setting) => [setting.span, setting.value.span]),
		];
		for (const span of spans) {
			assertSpan(span);
			expect(span.start).toBeGreaterThanOrEqual(node.span.start);
			expect(span.end).toBeLessThanOrEqual(node.span.end);
		}
		for (let i = 1; i < node.children.length; i++) {
			expect(node.children[i - 1].span.end).toBeLessThanOrEqual(node.children[i].span.start);
		}
		if (node.closer) {
			for (const child of node.children)
				expect(child.span.end).toBeLessThanOrEqual(node.closer.start);
		}
		// Leaves own their raw range. Structural headers, closers and trivia fill all other gaps.
		const owned =
			node.children.length || node.header
				? [
						...node.children.map((child) => child.span),
						...node.trivia,
						...[node.header, node.closer].filter((s): s is SourceSpan => s !== undefined),
					]
				: [node.span];
		owned.sort((a, b) => a.start - b.start);
		let cursor = node.span.start;
		for (const span of owned) {
			expect(span.start).toBe(cursor);
			cursor = span.end;
		}
		expect(cursor).toBe(node.span.end);
	}
}

function outline(node: TreeNode, stream: TokenStream, depth = -1): string {
	const own =
		depth < 0
			? ""
			: `${"  ".repeat(depth)}${node.kind}${node.type ? `:${node.type}` : ""}${node.name ? `:${node.name}` : ""}@${lineColumn(stream.source, node.span.start).line}-${lineColumn(stream.source, node.span.end - 1).line}\n`;
	return own + node.children.map((child) => outline(child, stream, depth + 1)).join("");
}

describe("G2 converted lesson golden trees", () => {
	for (const lesson of [
		"leadership/00-avant-de-commencer",
		"leadership/01-affirmez-vous",
		"leadership/02-quatre-cavaliers",
		"leadership/03-resoudre-un-conflit",
		"toolkit/welcome",
	]) {
		for (const ending of ["LF", "CRLF", "mixed"]) {
			it(`${lesson}, ${ending}: golden tree and exact token ownership`, () => {
				const original = readFileSync(
					new URL(`./fixtures/v4/${lesson}.prax`, import.meta.url),
					"utf8",
				);
				let index = 0;
				const source = original.replace(/\r\n|\r|\n/g, () =>
					ending === "LF" ? "\n" : ending === "CRLF" || index++ % 2 === 0 ? "\r\n" : "\n",
				);
				const stream = tokenizeLesson(source);
				const tree = buildLessonTree(stream, corpusOptions);
				expect(tree.stream).toBe(stream);
				expect(tree.diagnostics).toEqual([]);
				expect(outline(tree.root, stream)).toBe(
					readFileSync(new URL(`./fixtures/v4/${lesson}.tree`, import.meta.url), "utf8").replace(
						/\r\n/g,
						"\n",
					),
				);
				assertSpans(stream, tree.root);
			});
		}
	}
});

describe("G2 nested spans and parent trivia", () => {
	it("keeps nested columns, tabs, notes and card back faces on the innermost stack", () => {
		const source =
			"\uFEFF# Café 😀\r\n::: columns\n:: {weight=2}\r\n::: tabs\n:: A\n## Heading\n::: note Keep\nText\n:::\n:: B\nOther\n:::\n\n:: Right\n::: cards\n:: Front\nBody\n::: back\nBack\n:::\n:::\n\n:::\n";
		const stream = tokenizeLesson(source);
		const tree = buildLessonTree(stream);
		expect(tree.diagnostics).toEqual([]);
		expect(outline(tree.root, stream)).toBe(
			[
				"page@1-23",
				"  block:columns@2-23",
				"    item@3-12",
				"      block:tabs@4-12",
				"        item@5-9",
				"          heading@6-6",
				"          block:note@7-9",
				"            body@8-8",
				"        item@10-11",
				"          body@11-11",
				"    item@14-21",
				"      block:cards@15-21",
				"        item@16-20",
				"          body@17-17",
				"          back:back@18-20",
				"            body@19-19",
				"",
			].join("\n"),
		);
		assertSpans(stream, tree.root);
		const columns = tree.root.children[0].children[0];
		expect(columns.trivia.map((span) => source.slice(span.start, span.end))).toEqual(["\n", "\n"]);
		expect(columns.children.map((item) => item.raw.endsWith("\n\n"))).toEqual([false, false]);
	});
	it("a blank between body siblings belongs to their item; trailing blanks belong to the container", () => {
		const source = "# Page\n::: tabs\n\n:: A\nFirst\n\nSecond\n\n:: B\n\n:::\n\n";
		const stream = tokenizeLesson(source);
		const tree = buildLessonTree(stream);
		const page = tree.root.children[0];
		const tabs = page.children[0];
		expect(tabs.children.map((item) => item.raw)).toEqual([":: A\nFirst\n\nSecond\n", ":: B\n"]);
		expect(tabs.trivia.map((s) => lineColumn(source, s.start).line)).toEqual([3, 8, 10]);
		expect(tabs.children[0].trivia.map((s) => lineColumn(source, s.start).line)).toEqual([6]);
		expect(page.trivia.map((s) => lineColumn(source, s.start).line)).toEqual([12]);
		assertSpans(stream, tree.root);
	});
	it("keeps raw and decoded subject, settings, image and part values at whole-token boundaries", () => {
		const source =
			'# Page {hideTitle}\r\nnav:\u202FShort\n::: quote The \\{set\\} {visible="a \\"{x}\\"" shuffle shuffle=false}\nWords\nspeaker: Café 😀\n:::\n![A \\] bracket](/assets/a(1).png){size=small}';
		const stream = tokenizeLesson(source);
		const tree = buildLessonTree(stream, corpusOptions);
		const page = tree.root.children[0];
		const quote = page.children[1];
		expect(page.settings.map((s) => [s.name, s.value.value])).toEqual([["hideTitle", true]]);
		expect(page.children[0].value?.raw).toBe("Short");
		expect(quote.subject?.raw).toBe("The \\{set\\}");
		expect(quote.subject?.value).toBe("The {set}");
		expect(quote.settings.map((s) => [s.name, s.value.value])).toEqual([
			["visible", 'a "{x}"'],
			["shuffle", true],
		]);
		expect(quote.settings[0].value.raw).toBe('"a \\"{x}\\""');
		expect(quote.children[1].value?.value).toBe("Café 😀");
		expect(quote.status).toBe("unresolved");
		expect(tree.diagnostics.map((d) => d.code)).toEqual(["duplicate-setting"]);
		expect(page.children[2].alt?.value).toBe("A ] bracket");
		expect(page.children[2].source?.value).toBe("/assets/a(1).png");
		assertSpans(stream, tree.root);
	});
	it("parts use enclosing declarations; other named lines and escaped structure remain learner text", () => {
		const source =
			"# Page\n::: quote\nspeaker: Name\nremarque: Keep\n\\speaker: Literal\n{pressure}\n{{score}}\n:::\n::: note\nspeaker: Prose\n:::";
		const stream = tokenizeLesson(source);
		const tree = buildLessonTree(stream, corpusOptions);
		const [quote, note] = tree.root.children[0].children;
		expect(quote.children.map((n) => n.kind)).toEqual(["part", "body"]);
		expect(quote.children[1].raw).toBe(
			"remarque: Keep\n\\speaker: Literal\n{pressure}\n{{score}}\n",
		);
		expect(note.children[0].kind).toBe("body");
		expect(buildLessonTree(stream).root.children[0].children[0].children[0].kind).toBe("body");
		assertSpans(stream, tree.root);
	});
	it("a multiline part owns indented paragraphs and their internal blanks, leaving sibling gaps to its block", () => {
		const source =
			"# P\r\n::: video /clip.mp4\r\ntranscript: First 😀\r\n  Second\r\n\r\n  Third\r\n\r\ncaption: \r\nBody\r\n:::";
		const stream = tokenizeLesson(source);
		const tree = buildLessonTree(stream, {
			isPart: (name, owner) => owner.type === "video" && ["transcript", "caption"].includes(name),
		});
		const video = tree.root.children[0].children[0];
		const [transcript, caption, body] = video.children;
		expect(transcript.raw).toBe("transcript: First 😀\r\n  Second\r\n\r\n  Third\r\n");
		expect(transcript.value?.raw).toBe("First 😀\r\n  Second\r\n\r\n  Third");
		expect(transcript.trivia.map((s) => lineColumn(source, s.start).line)).toEqual([5]);
		expect(video.trivia.map((s) => lineColumn(source, s.start).line)).toEqual([7]);
		expect(caption.value?.raw).toBe("");
		expect(body.raw).toBe("Body\r\n");
		assertSpans(stream, tree.root);
	});
	it("a closer after an inner block closes the outer block, regardless of adjacency", () => {
		const stream = tokenizeLesson(
			"# P\n::: columns\n:: A\n::: accordion\n:: Panel\nText\n:::\n:::\nAfter",
		);
		const tree = buildLessonTree(stream);
		expect(tree.diagnostics).toEqual([]);
		expect(tree.root.children[0].children.map((n) => n.kind)).toEqual(["block", "body"]);
		expect(tree.root.children[0].children[1].raw).toBe("After");
		assertSpans(stream, tree.root);
	});
	it("trusts G1's code/math/frontmatter/quote shielding rather than reparsing raw markers", () => {
		const source =
			"---\ntitle: P\n---\n# P\n````\n```\n# literal\n:::\n:: literal\n````\n$$\n# math\n:::\n$$\n> # quoted\n> :::\n\\# escaped\n# Next";
		const stream = tokenizeLesson(source);
		const tree = buildLessonTree(stream);
		expect(tree.diagnostics).toEqual([]);
		expect(tree.root.children.map((n) => n.kind)).toEqual(["frontmatter", "page", "page"]);
		expect(tree.root.children[1].children.map((n) => n.kind)).toEqual(["body"]);
		assertSpans(stream, tree.root);
	});
});

describe("G2 recovery never drops learner text", () => {
	it.each(["# Next\nNext body", ""])(
		"reports each unclosed block at its opener, boundary %j",
		(boundary) => {
			const prefix = "# Page\r\n::: columns\r\n:: A\r\n::: note Keep\r\nCafé 😀\r\n\r\n";
			const stream = tokenizeLesson(prefix + boundary);
			const tree = buildLessonTree(stream);
			expect(tree.diagnostics.map((d) => [d.code, d.line, d.column, d.type])).toEqual([
				["unclosed-block", 4, 1, "note"],
				["unclosed-block", 2, 1, "columns"],
			]);
			const columns = tree.root.children[0].children[0];
			const item = columns.children[0];
			const note = item.children[0];
			expect([columns.status, item.status, note.status]).toEqual([
				"unresolved",
				"unresolved",
				"unresolved",
			]);
			expect(columns.closer).toBeUndefined();
			expect(note.closer).toBeUndefined();
			expect(columns.raw).toBe(prefix.slice(prefix.indexOf("::: columns")));
			expect(note.raw).toBe(prefix.slice(prefix.indexOf("::: note")));
			if (boundary) expect(tree.root.children[1].raw).toBe(boundary);
			assertSpans(stream, tree.root);
		},
	);
	it("keeps orphan item/closer lines and lexical errors as raw unresolved nodes", () => {
		const source = "# Page\n:: Orphan\nKeep\n:::\n{tone=warning}\nTail";
		const stream = tokenizeLesson(source);
		const tree = buildLessonTree(stream);
		expect(tree.diagnostics.map((d) => d.code)).toEqual([
			"stray-item",
			"stray-closer",
			"setting-on-body-line",
		]);
		const recovery = tree.root.children[0].children.filter((n) => n.kind === "recovery");
		expect(recovery.map((n) => [n.status, n.raw])).toEqual([
			["unresolved", ":: Orphan\n"],
			["unresolved", ":::\n"],
			["unresolved", "{tone=warning}\n"],
		]);
		assertSpans(stream, tree.root);
	});
	it("retains content before a page on an unresolved untitled page, without swallowing frontmatter", () => {
		const source = "\uFEFF---\ntitle: P\n---\n\nBefore 😀\n\n# Real\nBody";
		const stream = tokenizeLesson(source);
		const tree = buildLessonTree(stream);
		expect(tree.root.children.map((n) => [n.kind, n.status])).toEqual([
			["frontmatter", "resolved"],
			["page", "unresolved"],
			["page", "resolved"],
		]);
		expect(tree.root.children[1].raw).toBe("Before 😀\n\n");
		expect(tree.diagnostics.map((d) => [d.code, d.line])).toEqual([["content-before-page", 5]]);
		assertSpans(stream, tree.root);
	});
	it("empty and trivia-only lessons retain all tokens without inventing a page", () => {
		for (const source of ["", "\uFEFF", "\n\r\n\t\r"]) {
			const stream = tokenizeLesson(source);
			const tree = buildLessonTree(stream);
			expect(tree.root.children).toEqual([]);
			expect(tree.root.raw).toBe(source);
			assertSpans(stream, tree.root);
		}
	});
	it("deeply nested blocks recover without recursive stack overflow", () => {
		const source = `# P\n${"::: note\n".repeat(2_000)}Keep 😀`;
		const stream = tokenizeLesson(source);
		const tree = buildLessonTree(stream);
		expect(tree.diagnostics).toHaveLength(2_000);
		let node = tree.root.children[0];
		for (let depth = 0; depth < 2_000; depth++) {
			node = node.children[0];
			expect(node.status).toBe("unresolved");
			expect(node.closer).toBeUndefined();
		}
		expect(node.children[0].raw).toBe("Keep 😀");
	});
	it("1,000 deterministic malformed drafts retain every token through nested ownership", () => {
		let state = 0x62ca;
		const fragments = [
			"# Page\n",
			"::: note\r\n",
			"::: back\n",
			":: A\n",
			":::\n",
			"\n",
			"  \r\n",
			"Words 😀\n",
			"remarque: Keep\n",
			"{tone=warning}\n",
			"::: tabs {tone = warning}\n",
			"## H\n",
			"---\n",
			"\\# literal\n",
		];
		for (let input = 0; input < 1_000; input++) {
			let source = input % 2 ? "# P\n" : "";
			for (let count = 0; count < input % 18; count++) {
				state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
				source += fragments[state % fragments.length];
			}
			const stream = tokenizeLesson(source);
			const tree = buildLessonTree(stream, corpusOptions);
			assertSpans(stream, tree.root);
		}
	});
});
