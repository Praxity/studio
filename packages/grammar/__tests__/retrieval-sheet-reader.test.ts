import { hasInlineIconMarkup, materializeInlineIcons } from "@praxity/content-model/inline-icons";
import { prepareInlineBlocks } from "@praxity/content-model/inline-preparation";
import { expect, it } from "vitest";
import { readLesson } from "../src/index";

it("projects exact literal Content, existing item identities and resolved heading level", () => {
	const source = String.raw`# P
::: retrieval-sheet **Title** [term]{definition} <b>HTML</b> {name=sheet width=wide hide=false entrance=fade level=3}
:: @icon{star} @var{x} [^1] @footer{note} \*Q\* \\* \d
answer: First  
  second \*line\* \\* \d

    indented  
:: Other question
answer: Other answer
:::
`.replaceAll("\n", "\r\n");
	const read = readLesson(source, {
		ids: (node, role) => `id-${node.span.start}-${role ?? "node"}`,
	});
	const sheet = read.blocks.find((block) => block.type === "retrievalSheet");
	const items = [...read.nodes.values()].filter(({ node, role }) => node.kind === "item" && !role);
	if (!sheet) throw new Error("Missing typed sheet");
	expect(sheet).toMatchObject({ type: "retrievalSheet", name: "sheet" });
	expect(sheet?.data).toEqual({
		layoutMode: "wide",
		hide: false,
		entrance: "fade",
		level: 3,
		content: {
			title: "**Title** [term]{definition} <b>HTML</b>",
			questions: [
				{
					id: items[0].id,
					question: String.raw`@icon{star} @var{x} [^1] @footer{note} *Q* \* \d`,
					answer: `First  \n${String.raw`second *line* \* \d`}\n\n  indented  `,
				},
				{ id: items[1].id, question: "Other question", answer: "Other answer" },
			],
		},
	});
	expect(read.pages[0].blocks).toContainEqual(sheet);
	expect(read.blocks.filter((block) => block.type === "text")).toEqual([]);
	expect(read.errors).toEqual([]);
	expect(prepareInlineBlocks([sheet])).toEqual([sheet]);
	expect(hasInlineIconMarkup(sheet)).toBe(false);
	expect(materializeInlineIcons(structuredClone(sheet), { outline: {}, filled: {} })).toEqual(
		sheet,
	);
	expect(read.tree.stream.source).toBe(source);
});

it.each([
	["::: retrieval-sheet T\n:: Q\nanswer: A\n:::\n", 2],
	["::: accordion\n:: Panel\n::: retrieval-sheet T\n:: Q\nanswer: A\n:::\n:::\n", 3],
])("inherits heading scope through the existing owner at level $1", (source, level) => {
	const read = readLesson(`# P\n${source}`);
	const find = (value: unknown): unknown => {
		if (!value || typeof value !== "object") return undefined;
		if ("type" in value && value.type === "retrievalSheet") return value;
		return Object.values(value).map(find).find(Boolean);
	};
	expect(find(read.blocks)).toMatchObject({ type: "retrievalSheet", data: { level } });
});

it("publishes a structurally valid sheet and refuses an empty answer", () => {
	const read = readLesson("# P\n::: retrieval-sheet T\n:: Q\nanswer: A\n:::\n");
	expect(read.tree.root.status).toBe("resolved");
	expect(read.hasErrors).toBe(false);
	expect(read.errors).toEqual([]);
	const invalid = readLesson("# P\n::: retrieval-sheet T\n:: Q\nanswer:\n:::\n");
	expect(invalid.tree.root.status).toBe("unresolved");
});
