import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { lessonPageBodyBlocks, lessonSourceText, type MessageRef } from "../src/index";
import { readLesson, withLessonIds } from "../src/read-lesson";
import * as lessonLex from "../src/v4/lex/index";
import { BLOCK_SCHEMA } from "../src/v4/schema";
import { createTransientIdAllocator } from "../src/v4/to-blocks";

describe("grammar 4 reader", () => {
	it.each([
		"# P\nBody\n",
		"\uFEFF---\r\ntitle: Example\r\n---\r\n# P\rBody\nLast",
		"# P\n::: unknown Invalid draft\nBody\n:::\n",
		"# P\n::: self-check Task\nmodel: Hidden answer\n:: Criterion\nmissed: Hidden hint\nevidence: Hidden evidence\n:::\n",
	])("exposes exact admitted source bytes for %j", (source) => {
		const read = readLesson(source);
		expect(lessonSourceText(read)).toBe(source);
		expect(lessonSourceText(structuredClone(read))).toBe(source);
		let id = 0;
		expect(lessonSourceText(withLessonIds(read, () => `id-${++id}`))).toBe(source);
	});
	it("selects page body projections across visible, hidden and empty pages", () => {
		const read = readLesson(
			"# Draft\n## Body heading\nBody\n# Hidden {hideTitle}\nOther\n# Empty\n",
		);
		expect(lessonPageBodyBlocks(read, read.pages[0].id).map((block) => block.type)).toEqual([
			"heading",
			"text",
		]);
		expect(lessonPageBodyBlocks(read, read.pages[0].id)[0].data.content).toBe(
			"<p>Body heading</p>",
		);
		expect(lessonPageBodyBlocks(read, read.pages[1].id).map((block) => block.type)).toEqual([
			"text",
		]);
		expect(lessonPageBodyBlocks(read, read.pages[2].id)).toEqual([]);
		expect(lessonPageBodyBlocks(read, "absent")).toEqual([]);
	});
	it("keeps page body self-check projections prompt-only", () => {
		const read = readLesson(
			"# Draft\n::: self-check Task\nmodel: Hidden answer\n:: Criterion\nmissed: Hidden hint\nevidence: Hidden evidence\n:::\n",
		);
		const blocks = lessonPageBodyBlocks(read, read.pages[0].id);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].data.content).toEqual({
			task: "Task",
			parts: [{ id: expect.any(String) }],
		});
	});
	it("exports diagnostic message references without requiring raw tree imports", () => {
		const formatMessage = (message: MessageRef) => message.key;
		expect(readLesson("# P\n::: unknown\n:::\n", { formatMessage }).errors[0].message).toBe(
			"grammar.v4.unknown-type",
		);
	});
	it.each([
		"---\ntitle: Example\nlang: fr\nvariables: {score: 0}\n---\n\n# First\n\n::: tabs Examples\n:: Before\nBody.\n:: After\nMore body.\n:::\n",
		"\uFEFF---\r\ntitle: Example\r\n---\r\n\r\n# First\r\n\r\nBody.\r\n",
		"---\ntitle: [\n---\n\n# First\n\nBody.\n",
		"# First\n\n::: unknown Example\nBody.\n:::\n",
		"# Old\n## Question\nas:choice\n(x) Yes\n( ) No\n",
	])("reprojects all IDs and diagnostics without parsing %j", (source) => {
		const options = { formatMessage: (message: { key: string }) => `Formatted ${message.key}` };
		const read = readLesson(source, options);
		const allocate = () => {
			let index = 0;
			return () => `resolved-${++index}`;
		};
		const expected = readLesson(source, { ...options, ids: allocate() });
		const parse = vi.spyOn(lessonLex, "tokenizeLesson");
		const projected = withLessonIds(read, allocate());
		expect(projected).toEqual(expected);
		expect(projected.tree).toBe(read.tree);
		expect(parse).not.toHaveBeenCalled();
		parse.mockRestore();
	});
	it("refuses grammar 3 firstPage metadata with conversion guidance", () => {
		const lesson = readLesson('---\n"firstPage":\n  title: Old page\n---\n\n## Body\n\nText.\n');
		expect(lesson.errors).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining("converter-v3-to-v4") }),
		);
		expect(lesson.pages).toEqual([]);
	});
	it.each([
		"## Question\nas:choice\n(x) Yes\n( ) No",
		"## Question\n  as:\tchoice  \n(x) Yes\n( ) No",
		"as:\u202fcard",
		"close:card",
		"close: card",
		"--- Second",
		"--",
		"card:back",
		"var: score = 0",
		"if: score is 0\nthen: show result",
		"when: score changes\nthen: show result",
		"/assets/image.png\nalt: My image",
		"https://example.org/movie.mp4",
	])("refuses the complete legacy declaration %j with converter guidance", (legacy) => {
		const read = readLesson(`# First\n\n${legacy}\n`);
		expect(read.hasErrors).toBe(true);
		expect(read.blocks).toEqual([]);
		expect(read.errors[0]).toMatchObject({ messageRef: { key: "grammar.v4.grammar-3" } });
		expect(read.errors[0].message).toContain(
			"convert <course-copy> --from 3 --out <new-output-directory>",
		);
	});
	it.each([
		"```prax\nas:choice\nclose:card\n--- Second\n--\nvar: score = 0\nif: ready\nwhen: ready\ncard:back\n/assets/image.png\n```",
		"`as:choice`\n`close:card`\n`--- Second`\nas: `choice`",
		"> as:choice\n> close:card\n> --- Second",
		"\\as:choice\n\\close:card\n\\--- Second",
		"$$\nas:choice\nclose:card\n$$",
		"::: rule Ready\nif: ready is true\nthen: disableCompletion\n:::",
		"--- {palette=warm}",
	])("keeps shielded examples and current syntax %j", (body) => {
		expect(
			readLesson(`# First\n${body}\n`).errors.filter(
				(error) => error.messageRef.key === "grammar.v4.grammar-3",
			),
		).toEqual([]);
	});
	it.each(Object.entries(BLOCK_SCHEMA).filter(([type]) => type !== "page"))(
		"reads the %s schema template without errors",
		(type, definition) => {
			const lesson = readLesson(`# Example\n${definition.insertTemplate}`);
			expect(
				lesson.errors
					.filter((error) => error.level === "error")
					.map((error) => error.messageRef.key),
			).toEqual([]);
			expect(lesson.pages[0].blocks.length).toBeGreaterThan(0);
		},
	);
	it("returns today's error fields and the neutral message for an invalid draft", () => {
		const lesson = readLesson("# P\n::: choice Q\n(x) One\n(x) Two\n:::\n");
		expect(lesson.hasErrors).toBe(true);
		expect(lesson.errors).toContainEqual(
			expect.objectContaining({
				level: "error",
				line: 2,
				blockId: lesson.pages[0].blocks[1].id,
				blockType: "assessment",
				category: "grammar",
				message: "grammar.v4.response-invariant",
				messageRef: expect.objectContaining({ key: "grammar.v4.response-invariant" }),
			}),
		);
		expect(lesson.tree.root.raw).toBe("# P\n::: choice Q\n(x) One\n(x) Two\n:::\n");
	});
	it("refuses grammar 3 with its conversion diagnostic", () => {
		const lesson = readLesson("# P\nBody\nas: note\n");
		expect(lesson.blocks).toEqual([]);
		expect(lesson.hasErrors).toBe(true);
		expect(lesson.errors[0].messageRef.args).toMatchObject({
			command: expect.stringContaining(
				"pnpm --dir ../praxity-converter --filter @praxity/convert convert <course-copy> --from 3 --out <new-output-directory>",
			),
		});
	});
	it("marks default IDs transient and keeps separate reads distinct", () => {
		const first = readLesson("# P\nBody\n");
		const second = readLesson("# P\nBody\n");
		expect(first.transientIds).toBe(true);
		expect(first.pages[0].id).not.toBe(second.pages[0].id);
		expect(first.pages[0].blocks[0].id).not.toBe(second.pages[0].blocks[0].id);
	});
	it("marks an explicitly supplied read-only allocator as transient", () => {
		expect(readLesson("# P\nBody\n", { ids: createTransientIdAllocator() }).transientIds).toBe(
			true,
		);
	});
	it("keeps supplied IDs for pages, containers, items, back faces and responses", () => {
		const source =
			"# P\n::: cards Cards\n:: Front\nWords\n::: back\nOther words\n:::\n:::\n::: match Q\n- A -> B\n- C -> D\n:::\n";
		const lesson = readLesson(source, {
			ids: (node, role) => `${node.kind}-${node.span.start}-${role ?? "node"}`,
		});
		expect(lesson.transientIds).toBe(false);
		expect(lesson.pages[0].id).toBe("page-0-node");
		const card = lesson.pages[0].blocks[1];
		expect(card.data.items).toEqual([
			expect.objectContaining({ id: "item-20-node", backId: "back-35-node" }),
		]);
		const match = lesson.pages[0].blocks[2];
		expect(match.data.response).toMatchObject({
			pairs: [
				expect.objectContaining({
					id: expect.stringMatching(/^pair-\d+-node$/),
					matchId: expect.stringMatching(/^pair-\d+-answer$/),
				}),
				expect.objectContaining({ id: expect.stringMatching(/^pair-\d+-node$/) }),
			],
		});
	});
	it.each([() => "", () => "same"])(
		"rejects absent or reused supplied identities from allocator %s",
		(ids) => {
			expect(() => readLesson("# P\nBody\n", { ids })).toThrow(/ID/);
		},
	);
	it("keeps navigation text independent from the authored H1 and hides toolkit's title", () => {
		const lesson = readLesson("# Long title\nnav: Short\nBody\n# Hidden {hideTitle}\nOther\n");
		expect(lesson.pages.map((page) => page.title)).toEqual(["Short", "Hidden"]);
		expect(lesson.pages[0].blocks[0].data).toMatchObject({
			level: 1,
			content: "<p>Long title</p>",
		});
		expect(lesson.pages[1].blocks.map((block) => block.type)).toEqual(["text"]);
	});
	it("keeps LF/CRLF/BOM source and renders escaped prose, lists, code and math", () => {
		const source =
			"\uFEFF# Café 😀\r\n\\<script>\r\n\r\n3. First\r\n\r\n4. Second\r\n   - Nested\r\n\r\nAfter list.\r\n\r\n````js\r\n```\r\n# literal\r\n````\r\n\r\n$$\r\nx^2\r\n$$";
		const lesson = readLesson(source);
		expect(lesson.tree.root.raw).toBe(source);
		expect(lesson.pages[0].blocks.map((block) => block.type)).toEqual([
			"heading",
			"text",
			"text",
			"text",
			"code",
			"equation",
		]);
		expect(lesson.pages[0].blocks[1].data.content).toContain("&lt;script&gt;");
		expect(lesson.pages[0].blocks[2].data.content).toContain('<ol start="3">');
		expect(lesson.pages[0].blocks[2].data.content).toContain("<ul>");
		expect(lesson.pages[0].blocks[4].data.code).toBe("```\n# literal");
	});
	it("preserves question settings, feedback, description and group membership", () => {
		const lesson = readLesson(
			"# P\n::: group Journal\nbutton: Save\n::: choice Q {points=2 required scored attempts=3 width=wide}\nDescription **here**.\n(x) Yes\nfeedback: Good\n( ) No\nfeedback: Try again\n:::\n:::\n",
		);
		const [, group, question] = lesson.pages[0].blocks;
		expect(group.data).toMatchObject({
			groupName: "Journal",
			buttonLabel: "Save",
			memberBlockIds: [question.id],
		});
		expect(question.data).toMatchObject({
			points: 2,
			required: true,
			attempts: 3,
			layoutMode: "wide",
			gradingMode: "exact",
			stemLevel: 3,
		});
		expect(question.data.description).toEqual([
			expect.objectContaining({
				data: expect.objectContaining({ content: "<p>Description <strong>here</strong>.</p>" }),
			}),
		]);
		expect(question.data.response).toMatchObject({
			options: [
				{ label: "Yes", isCorrect: true, feedback: "Good" },
				{ label: "No", isCorrect: false, feedback: "Try again" },
			],
		});
	});
	it("reads the five converted lessons with no errors", () => {
		for (const path of [
			"leadership/00-avant-de-commencer",
			"leadership/01-affirmez-vous",
			"leadership/02-quatre-cavaliers",
			"leadership/03-resoudre-un-conflit",
			"toolkit/welcome",
		]) {
			const source = readFileSync(new URL(`./fixtures/v4/${path}.prax`, import.meta.url), "utf8");
			expect(readLesson(source).errors, path).toEqual([]);
		}
	});
	it("uses the schema's blank masking for terms, variables and code", () => {
		const lesson = readLesson(
			"# P\n::: fill-blank Complete\n[PPE]{Equipment} {{score}} `code {literal}` {answer}\n:::\n",
		);
		expect(lesson.errors).toEqual([]);
		expect(lesson.pages[0].blocks[1].data.response).toMatchObject({
			blanks: [{ answer: "answer" }],
		});
	});
	it("keeps invalid YAML as an error with source positions", () => {
		const lesson = readLesson("---\ntitle: [broken\n---\n# P\nBody\n");
		expect(lesson.hasErrors).toBe(true);
		expect(lesson.errors).toContainEqual(
			expect.objectContaining({
				message: "grammar.v4.invalid-course-metadata",
				level: "error",
				line: 2,
			}),
		);
	});
	it.each(["note", "info", "tip", "success", "warning"])(
		"maps note tone %s without changing its published meaning",
		(tone) => {
			const lesson = readLesson(`# P\n::: note {tone=${tone} icon=none}\nWords\n:::\n`);
			expect(lesson.pages[0].blocks[1].data).toMatchObject({ color: tone, icon: "none" });
		},
	);
	it("preserves nested list content once, without flattening or raw markers", () => {
		const lesson = readLesson("# P\n- Parent\n  - Child\n  - Other child\n- Peer\n");
		const html = lesson.pages[0].blocks[1].data.content as string;
		expect(html.match(/Child/g)).toHaveLength(1);
		expect(html).not.toContain("- Child");
		expect(html).toContain("<ul>");
	});
	it("maps authored button links to the renderer's href field", () => {
		const lesson = readLesson(
			"# P\n::: button [Open **guide**](https://example.com/guide) {newTab style=outline}\n:::\n",
		);
		expect(lesson.pages[0].blocks[1].data).toMatchObject({
			href: "https://example.com/guide",
			text: "Open **guide**",
			openInNewTab: true,
			variant: "outline",
		});
	});
	it("supplies distinct IDs for prose on both sides of a code fence", () => {
		const lesson = readLesson("# P\nBefore\n```js\ncode\n```\nAfter\n");
		const blocks = lesson.pages[0].blocks;
		expect(blocks.map((block) => block.type)).toEqual(["heading", "text", "code", "text"]);
		expect(new Set(blocks.map((block) => block.id)).size).toBe(4);
	});
	it("adapts frontmatter variables to runtime initial values", () => {
		const lesson = readLesson(
			"---\nvariables:\n  score: 0\n  ready: false\n  learner: Alex\n---\n# P\nBody\n",
		);
		expect(
			lesson.pages[0].blocks
				.filter((block) => block.type === "variable")
				.map((block) => block.data),
		).toEqual([
			{ variableName: "score", dataType: "number", defaultValue: 0, source: "manual" },
			{ variableName: "ready", dataType: "boolean", defaultValue: false, source: "manual" },
			{ variableName: "learner", dataType: "text", defaultValue: "Alex", source: "manual" },
		]);
	});
});
