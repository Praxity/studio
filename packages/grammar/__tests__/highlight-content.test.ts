import type { HighlightContent, HighlightData } from "@praxity/content-model/types";
import { expect, it } from "vitest";
import {
	type HighlightContentError,
	readHighlightContent,
	readLesson,
	withLessonIds,
} from "../src/index";

const source =
	"# Page\n::: highlight Title\n:: First {key=true}\nnote: Explanation\n:: Other {key=false paragraph=true}\n:: Last\n:::\n";
const read = (text = source) =>
	readLesson(text, { ids: (node, role) => `id-${node.span.start}-${role ?? "node"}` });
const block = (lesson: ReturnType<typeof read>) => {
	const value = lesson.blocks.find((b) => b.type === "highlight");
	if (!value) throw new Error("Missing highlight fixture");
	return value;
};
const refusal = (
	lesson: ReturnType<typeof read>,
	id: string,
	code: HighlightContentError["code"],
) => {
	expect(() => readHighlightContent(lesson, id)).toThrowError(
		expect.objectContaining({ name: "HighlightContentError", code, message: code }),
	);
};

it("reads fresh literal source objects independently of a mutable projection", () => {
	const lesson = read();
	const projection = block(lesson);
	const expected: HighlightContent = {
		mode: "key",
		title: "Title",
		paragraphs: [
			[{ id: "id-27-node", text: "First", key: true, note: "Explanation" }],
			[
				{ id: "id-65-node", text: "Other", key: false },
				{ id: "id-101-node", text: "Last" },
			],
		],
	};
	const data: HighlightData = { content: expected, level: 2 };
	expect(projection.data).toEqual(data);
	projection.data.content = { title: "STALE", marked: ["learner"], shown: true };
	const content = readHighlightContent(lesson, projection.id);
	expect(content).toEqual(expected);
	content.paragraphs[0][0].text = "MUTATED";
	content.paragraphs[1].pop();
	expect(readHighlightContent(lesson, projection.id)).toEqual(expected);
});

it("reads cloned and rebound AST identities", () => {
	const lesson = read();
	const cloned = structuredClone(lesson);
	expect(readHighlightContent(cloned, block(cloned).id)).toEqual(
		readHighlightContent(lesson, block(lesson).id),
	);
	const rebound = withLessonIds(lesson, (node, role) => `new-${node.span.start}-${role ?? "node"}`);
	expect(
		readHighlightContent(rebound, block(rebound).id)
			.paragraphs.flat()
			.map((c) => c.id),
	).toEqual(["new-27-node", "new-65-node", "new-101-node"]);
});

it.each(["absent", "id-0-node", "id-27-node"])(
	"rejects missing, wrong-type and item IDs: %s",
	(id) => refusal(read(), id, "highlight-not-found"),
);
it.each(["title", ""])("rejects role IDs, including a malformed empty role: %s", (role) => {
	const lesson = read();
	const owner = lesson.nodes.get(block(lesson).id)!;
	lesson.nodes.set("role", { ...owner, id: "role", role });
	refusal(lesson, "role", "highlight-not-found");
});

it.each([
	"missing item",
	"detached owner",
	"detached item",
	"detached subtree",
	"duplicate owner",
	"duplicate item",
	"mismatched owner ID",
	"mismatched item ID",
	"item role",
])("rejects %s identities", (kind) => {
	const lesson = read();
	const id = block(lesson).id;
	const owner = lesson.nodes.get(id)!;
	const item = lesson.nodes.get("id-27-node")!;
	if (kind === "missing item") lesson.nodes.delete(item.id);
	if (kind === "detached owner") owner.node = structuredClone(owner.node);
	if (kind === "detached item") item.node = structuredClone(item.node);
	if (kind === "detached subtree") {
		const originalItems = owner.node.children.filter((child) => child.kind === "item");
		owner.node = structuredClone(owner.node);
		for (const [index, child] of owner.node.children
			.filter((node) => node.kind === "item")
			.entries()) {
			const record = [...lesson.nodes.values()].find(
				(value) => value.role === undefined && value.node === originalItems[index],
			);
			if (!record) throw new Error("Missing fixture item identity");
			record.node = child;
		}
	}
	if (kind === "duplicate owner") lesson.nodes.set("alias", { ...owner, id: "alias" });
	if (kind === "duplicate item") lesson.nodes.set("alias", { ...item, id: "alias" });
	if (kind === "mismatched owner ID") owner.id = "other";
	if (kind === "mismatched item ID") item.id = "other";
	if (kind === "item role") item.role = "title";
	refusal(lesson, id, "highlight-identity-invalid");
});

it("does not reuse a stale identity index after a previous read", () => {
	const lesson = read();
	const id = block(lesson).id;
	readHighlightContent(lesson, id);
	const item = lesson.nodes.get("id-27-node")!;
	lesson.nodes.set("alias", { ...item, id: "alias" });
	refusal(lesson, id, "highlight-identity-invalid");
});

it.each([
	source.replace("Title", "x".repeat(121)),
	source.replace("First", "x".repeat(1501)),
	source.replace("Explanation", "x".repeat(1501)),
	source.replace("key=true", "key=false"),
	source.replace("Title", "Title {mode=evidence}"),
	source.replace("Title", "Title {maxMarks=9007199254740992}"),
	source.replace("note: Explanation", "note: Explanation\nnote: Duplicate"),
])("rejects invalid source with content-free errors: %s", (text) => {
	const lesson = read(text);
	refusal(lesson, block(lesson).id, "highlight-content-invalid");
});
it("rejects unresolved owners", () => {
	const lesson = read();
	lesson.nodes.get(block(lesson).id)!.node.status = "unresolved";
	refusal(lesson, block(lesson).id, "highlight-content-invalid");
});
it.each(["bad id", "x".repeat(121)])(
	"validates allocated IDs against upstream schema: %s",
	(invalid) => {
		const lesson = readLesson(source, {
			ids: (node, role) =>
				node.kind === "item" && node.span.start === 27
					? invalid
					: `id-${node.span.start}-${role ?? "node"}`,
		});
		refusal(lesson, block(lesson).id, "highlight-content-invalid");
	},
);

it("retains upstream chunk-ID alphabet and length limits through the reader", () => {
	for (const [allocated, valid] of [
		["Az_09-", true],
		["x".repeat(120), true],
		["bad.id", false],
		["x".repeat(121), false],
	] as const) {
		const lesson = readLesson(source, {
			ids: (node, role) =>
				node.kind === "item" && node.span.start === 27
					? allocated
					: `id-${node.span.start}-${role ?? "node"}`,
		});
		const id = block(lesson).id;
		if (valid) expect(readHighlightContent(lesson, id).paragraphs[0][0].id).toBe(allocated);
		else
			expect
				.soft(() => readHighlightContent(lesson, id))
				.toThrowError(expect.objectContaining({ code: "highlight-content-invalid" }));
	}
});

it.each([
	{
		locale: "en",
		source:
			"::: highlight Taking a break {mode=evidence maxMarks=1}\nquestion: Why say when you will return?\n:: You need a moment to think.\nnote: This explains the pause, not the return time.\n:: They know when to expect you. {key=true}\n:: Agree on a time before leaving. {paragraph=true}\nnote: This is advice rather than the reason asked for.\n:::\n",
		expected: {
			mode: "evidence",
			title: "Taking a break",
			question: "Why say when you will return?",
			maxMarks: 1,
			paragraphs: [
				[
					{
						id: "chunk-1",
						text: "You need a moment to think.",
						note: "This explains the pause, not the return time.",
					},
					{ id: "chunk-2", text: "They know when to expect you.", key: true },
				],
				[
					{
						id: "chunk-3",
						text: "Agree on a time before leaving.",
						note: "This is advice rather than the reason asked for.",
					},
				],
			],
		},
	},
	{
		locale: "fr",
		source:
			"::: highlight Une pause utile {mode=key}\nquestion: Que faut-il retenir ?\n:: Pourquoi partir ? Pour réfléchir.\nnote: Ce détail décrit la pause.\n:: Il dit : « Je reviens à midi ! » {key=true}\n:: Une heure précise réduit l'incertitude. {key=true paragraph=true}\n:: Le mur est bleu.\nnote: Cette couleur n'explique pas l'intérêt de préciser l'heure.\n:::\n",
		expected: {
			mode: "key",
			title: "Une pause utile",
			question: "Que faut-il retenir ?",
			paragraphs: [
				[
					{
						id: "chunk-1",
						text: "Pourquoi partir ? Pour réfléchir.",
						note: "Ce détail décrit la pause.",
					},
					{ id: "chunk-2", text: "Il dit : « Je reviens à midi ! »", key: true },
				],
				[
					{ id: "chunk-3", text: "Une heure précise réduit l'incertitude.", key: true },
					{
						id: "chunk-4",
						text: "Le mur est bleu.",
						note: "Cette couleur n'explique pas l'intérêt de préciser l'heure.",
					},
				],
			],
		},
	},
])(
	"projects exact public content and reads the frozen $locale example",
	({ locale, source, expected }) => {
		let next = 0;
		const lesson = readLesson(`---\nlang: ${locale}\n---\n# Page\n${source}`, {
			ids: (node, role) =>
				node.kind === "item" ? `chunk-${++next}` : `id-${node.span.start}-${role ?? "node"}`,
		});
		expect(lesson.diagnostics).toEqual([]);
		expect(block(lesson).data).toEqual({ level: 2, content: expected });
		expect(readHighlightContent(lesson, block(lesson).id)).toEqual(expected);
	},
);

it("projects only shared settings, preserves false and discards paragraph flags", () => {
	const lesson = read(
		source
			.replace(
				"Title",
				"Title {width=wide name=mark hide=false visible=flag entrance=none level=3}",
			)
			.replace("First {key=true}", "First {key=true paragraph=true}")
			.replace(":: Last", "\n:: Last {paragraph=false}"),
	);
	expect(lesson.diagnostics).toEqual([]);
	const projection = block(lesson);
	expect(projection.name).toBe("mark");
	const content = readHighlightContent(lesson, projection.id);
	expect(projection.data).toEqual({
		level: 3,
		layoutMode: "wide",
		hide: false,
		visible: "flag",
		entrance: "none",
		content,
	});
	expect(content.paragraphs.map((p) => p.length)).toEqual([1, 2]);
	expect(content).not.toHaveProperty("maxMarks");
	expect(content.paragraphs[1][0].key).toBe(false);
	expect(content.paragraphs[1][1]).not.toHaveProperty("key");
	expect(JSON.stringify(projection)).not.toMatch(
		/data-node-id|_htmlFields|"paragraph"|"marked"|"shown"/,
	);
});

it("rejects an identity duplicated by a detached record under another map key", () => {
	const lesson = read();
	const item = lesson.nodes.get("id-27-node");
	if (!item) throw new Error("Missing fixture item");
	lesson.nodes.set("alias", structuredClone(item));
	refusal(lesson, block(lesson).id, "highlight-identity-invalid");
});

it.each(["error", "warning"] as const)(
	"checks %s diagnostics within the requested block",
	(severity) => {
		const lesson = read();
		const owner = lesson.nodes.get(block(lesson).id);
		if (!owner) throw new Error("Missing fixture owner");
		lesson.diagnostics.push({
			code: "highlight-invalid",
			severity,
			message: { key: "grammar.v4.highlight-invalid", args: {} },
			span: owner.node.children[0].span,
			line: 3,
			column: 1,
		});
		if (severity === "error") refusal(lesson, block(lesson).id, "highlight-content-invalid");
		else expect(readHighlightContent(lesson, block(lesson).id).title).toBe("Title");
	},
);
