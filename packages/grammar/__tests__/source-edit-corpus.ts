import { createHash } from "node:crypto";
import { resolveIdentity } from "../../content-identity/src/index.ts";
import { applyOperation, operationRegistry } from "../../operations/src/index.ts";
import { findFrontmatterRange } from "../src/frontmatter.ts";
import type { OperationTarget } from "../src/operations/contract.ts";
import { readLesson } from "../src/read-lesson.ts";

export const digest = (source: string) => createHash("sha256").update(source).digest("hex");
const lines = [
	"---",
	"title: Course",
	"design:",
	"  colorAccent: red # keep",
	"---",
	"",
	"# First",
	"",
	"::: note Advisory {tone=info}",
	"Keep [label](https://example.com) safe.",
	":::",
	"",
	"Plain α😀 text.",
	"",
	"Second paragraph.",
	"",
	"::: accordion",
	":: First item",
	"Alpha.",
	":: Second item",
	"Beta.",
	":::",
	"",
	"::: columns",
	":: {weight=1}",
	"Left.",
	":: {weight=1}",
	"Right.",
	":::",
	"",
	"# Second",
	"",
	"Untouched tail.",
	"",
];

/** Every adapter receives the same source bytes, including deliberately invalid metadata. */
export const sourceEditCorpus = [
	{ name: "BOM", source: `\uFEFF${lines.join("\n")}` },
	{ name: "CRLF", source: lines.join("\r\n") },
	{ name: "CR", source: lines.join("\r") },
	{
		name: "mixed endings",
		source: lines
			.map((line, i) => line + (i === lines.length - 1 ? "" : ["\r\n", "\r", "\n"][i % 3]))
			.join(""),
	},
	{ name: "no final newline", source: lines.slice(0, -1).join("\n") },
	{
		name: "unclosed frontmatter",
		source: lines.filter((_, i) => i !== 4).join("\n"),
		invalid: true,
	},
	{ name: "frontmatter before pages", source: lines.join("\n") },
] as const;

export function yamlCorpusSource(source: string): string {
	const range = findFrontmatterRange(source);
	if (!range || range.endIndex === -1) return source;
	const yaml =
		(source.startsWith("\uFEFF") ? "\uFEFF" : "") + source.slice(range.yamlStart, range.yamlEnd);
	return /[\r\n]$/u.test(source) ? yaml : yaml.replace(/[\r\n]+$/u, "");
}

export function operationFixture(source: string) {
	const read = readLesson(source);
	let serial = 1;
	const dependencies = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${(serial++).toString(16).padStart(12, "0")}`,
	};
	const identity = resolveIdentity(
		{ parsedDocuments: [{ path: "lesson.prax", tree: read.tree }], priorSnapshots: [] },
		dependencies,
	);
	const nodes = identity.sourceMappings.map((map) => {
		let node = read.tree.root;
		for (const index of map.path) node = node.children[index];
		return { map, node };
	});
	const select = (type: string, ordinal = 0) => {
		const match = nodes.filter(({ node }) => (node.type ?? node.kind) === type)[ordinal];
		if (!match) throw new Error(`Missing corpus target: ${type} ${ordinal}`);
		return match;
	};
	const target = (type: string, ordinal = 0): OperationTarget => {
		const { map } = select(type, ordinal);
		return {
			file: "lesson.prax",
			ref: { kind: "node", nodeId: map.id, path: map.path, fingerprint: map.fingerprint },
			expectedText: source.slice(map.span.start, map.span.end),
		};
	};
	const boundary = (type: string): OperationTarget => {
		const { node, map } = select(type);
		const child = node.children.at(-1);
		const after = child ? nodes.find((entry) => entry.node === child)?.map.id : null;
		if (child && !after) throw new Error("Missing boundary child identity");
		return {
			file: "lesson.prax",
			ref: { kind: "insertion", parentId: map.id, after: after ?? null, before: null },
		};
	};
	const request = (
		operation: string,
		targets: OperationTarget[],
		args: Record<string, unknown> = {},
	) => ({
		transactionId: "corpus",
		operation,
		targets,
		args,
		files: [{ path: "lesson.prax", baseRevision: digest(source) }],
	});
	const run = (operation: string, targets: OperationTarget[], args: Record<string, unknown> = {}) =>
		applyOperation([{ path: "lesson.prax", source }], request(operation, targets, args), {
			identity,
			...dependencies,
		});
	return { read, identity, dependencies, select, target, boundary, request, run };
}

type Fixture = ReturnType<typeof operationFixture>;
export interface CorpusOperation {
	targets: OperationTarget[];
	args: Record<string, unknown>;
	/** Independent authorization bounds, not the edits returned by the planner. */
	range: { start: number; end: number };
	readOnly?: boolean;
}

export function corpusOperation(f: Fixture, operation: string): CorpusOperation {
	const note = f.select("note").node;
	const page = f.select("page").node;
	const accordion = f.select("accordion").node;
	const columns = f.select("columns").node;
	const body = f.select("body", 1).node;
	const span = (node: typeof note) => ({ start: node.span.start, end: node.span.end });
	const specs: Record<string, CorpusOperation> = {
		editInline: {
			targets: [
				{
					...f.target("note"),
					inline: {
						start: f.read.tree.stream.source.indexOf("[label]"),
						end:
							f.read.tree.stream.source.indexOf("[label]") + "[label](https://example.com)".length,
						expectedText: "[label](https://example.com)",
					},
				},
			],
			args: { text: "Changed" },
			range: span(note),
		},
		editSource: {
			targets: [f.target("note")],
			args: { text: "::: note Changed {tone=warning}\nChanged body.\n" },
			range: span(note),
		},
		insertBlock: {
			targets: [f.boundary("page")],
			args: { text: "Inserted." },
			range: {
				start: page.children.at(-1)?.span.end ?? page.span.end,
				end: page.children.at(-1)?.span.end ?? page.span.end,
			},
		},
		deleteBlocks: {
			targets: [f.target("note")],
			args: {},
			range: { start: page.header?.end ?? note.span.start, end: body.span.start },
		},
		cutBlocks: {
			targets: [f.target("note")],
			args: {},
			range: { start: page.header?.end ?? note.span.start, end: body.span.start },
		},
		copyBlocks: { targets: [f.target("note")], args: {}, range: span(note), readOnly: true },
		pasteBlocks: {
			targets: [f.boundary("page")],
			args: { text: "Pasted." },
			range: {
				start: page.children.at(-1)?.span.end ?? page.span.end,
				end: page.children.at(-1)?.span.end ?? page.span.end,
			},
		},
		discardCut: { targets: [f.target("note")], args: {}, range: span(note), readOnly: true },
		insertPage: {
			targets: [f.boundary("lesson")],
			args: { title: "Inserted" },
			range: { start: f.read.tree.stream.source.length, end: f.read.tree.stream.source.length },
		},
		movePage: {
			targets: [f.target("page")],
			args: { direction: "down" },
			range: { start: page.span.start, end: f.read.tree.stream.source.length },
		},
		setPageTitle: {
			targets: [f.target("page")],
			args: { title: "Changed" },
			range: page.subject?.span ?? span(page),
		},
		mergePage: {
			targets: [f.target("page", 1)],
			args: {},
			range: { start: page.span.end, end: f.select("page", 1).node.header?.end ?? page.span.end },
		},
		deletePage: {
			targets: [f.target("page")],
			args: {},
			range: {
				start: findFrontmatterRange(f.read.tree.stream.source)?.end ?? page.span.start,
				end: f.select("page", 1).node.span.start,
			},
		},
		duplicateBlocks: {
			targets: [f.target("note")],
			args: {},
			range: { start: note.span.end, end: note.span.end },
		},
		moveBlocks: {
			targets: [f.target("note")],
			args: { direction: "down" },
			range: { start: note.span.start, end: f.select("body", 2).node.span.start },
		},
		setProperty: {
			targets: [f.target("note")],
			args: { name: "tone", value: "warning" },
			range: {
				start: f.read.tree.stream.source.indexOf("info}"),
				end: f.read.tree.stream.source.indexOf("info}") + 4,
			},
		},
		setText: {
			targets: [f.target("note")],
			args: { field: "subject", text: "Changed" },
			range: note.subject?.span ?? span(note),
		},
		addItem: {
			targets: [f.target("accordion")],
			args: { text: ":: Added\nFresh." },
			range: span(accordion),
		},
		removeItem: { targets: [f.target("item")], args: {}, range: span(accordion) },
		moveItem: { targets: [f.target("item")], args: { direction: "down" }, range: span(accordion) },
		wrapInColumns: { targets: [f.target("body", 1)], args: {}, range: span(body) },
		unwrapColumns: { targets: [f.target("columns")], args: {}, range: span(columns) },
		setColumnWeights: {
			targets: [f.target("columns")],
			args: { weights: [3, 2] },
			range: span(columns),
		},
		wrapIn: { targets: [f.target("body", 1)], args: { type: "note" }, range: span(body) },
		turnInto: { targets: [f.target("note")], args: { type: "quote" }, range: span(note) },
		mergeBlocks: {
			targets: [f.target("body", 1), f.target("body", 2)],
			args: {},
			range: { start: body.span.start, end: f.select("body", 2).node.span.end },
		},
		replaceBlock: {
			targets: [f.target("note")],
			args: { text: "::: note Changed\nFresh.\n:::" },
			range: span(note),
		},
	};
	if (Object.keys(specs).sort().join() !== Object.keys(operationRegistry).sort().join())
		throw new Error("Add every registry operation to the byte corpus");
	const spec = specs[operation];
	if (!spec) throw new Error(`No corpus adapter for ${operation}`);
	return spec;
}
