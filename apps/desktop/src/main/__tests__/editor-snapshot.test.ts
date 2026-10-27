import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLesson } from "@praxity/grammar";
import { BLOCK_SCHEMA } from "@praxity/grammar/src/v4/schema.ts";
import { isRuntimeNodeId } from "@praxity/shared-blocks/types";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	type EditorSnapshot,
	editorDraftSeed,
	editorSnapshotSchema,
	prepareEditorSnapshot,
} from "../../shared/editor-session";
import { persistCourseIdentity, resolveCourseIdentity } from "../identity-store";
import { resolveLessonSources } from "../lesson-source";
import { readBlockInventory } from "../operations/block-inspection";
import { withProjectFileTransaction } from "../project-file-transactions";
import {
	largeSnapshotFixture,
	nodeMetadataBudget,
	snapshotFixture,
} from "./fixtures/editor-snapshot";

const roots: string[] = [];
async function cleanupCourses() {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
afterEach(cleanupCourses);
afterAll(cleanupCourses);
async function course(source: string) {
	expect(
		readLesson(source).errors.filter(
			(error) => error.level === "error" || error.level === "critical",
		),
	).toEqual([]);
	const root = await mkdtemp(join(tmpdir(), "snapshot-transport-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: C\nlessons: [a.prax]\n");
	await writeFile(join(root, "a.prax"), source);
	await withProjectFileTransaction(
		root,
		async (admitted) =>
			persistCourseIdentity(
				admitted,
				await resolveCourseIdentity(admitted, { lessonPaths: ["a.prax"] }),
			),
		"write",
	);
	return root;
}

function roundTrip(snapshot: EditorSnapshot, aggregateBudget = false) {
	const encodeStart = performance.now();
	const encoded = prepareEditorSnapshot(snapshot);
	const text = JSON.stringify(encoded);
	const encodeMs = performance.now() - encodeStart;
	const decodeStart = performance.now();
	const decoded = editorSnapshotSchema.parse(JSON.parse(text));
	const decodeMs = performance.now() - decodeStart;
	const nodeCount = encoded.lessons.reduce((sum, lesson) => sum + lesson.nodes.length, 0);
	const metadataBytes =
		Buffer.byteLength(text) -
		decoded.lessons.reduce(
			(sum, lesson) => sum + Buffer.byteLength(JSON.stringify(lesson.source)),
			0,
		);
	if (aggregateBudget) expect(metadataBytes).toBeLessThanOrEqual(nodeMetadataBudget * nodeCount);
	for (const lesson of encoded.lessons) {
		if (lesson.source) expect(text.split(JSON.stringify(lesson.source))).toHaveLength(2);
		for (const node of lesson.nodes)
			expect(Buffer.byteLength(JSON.stringify(node))).toBeLessThanOrEqual(nodeMetadataBudget);
	}
	console.info("snapshot transport", {
		nodes: nodeCount,
		wireBytes: Buffer.byteLength(text),
		metadataBytes,
		metadataPerNode: nodeCount ? metadataBytes / nodeCount : 0,
		encodeMs,
		decodeMs,
	});
	return decoded;
}
const paragraph =
	"Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod tempor.\n\n".repeat(3);
let persistedSource = "";
for (let page = 0; page < 10; page++) {
	persistedSource += `# Page ${page}\n\n${paragraph}`;
	for (let block = 0; block < 5; block++)
		persistedSource += `::: tabs\n:: One\n::: note\n${paragraph}:::\n:: Two\n${paragraph}:::\n\n`;
}

let persistedSnapshot: EditorSnapshot;
let mixedSnapshot: EditorSnapshot;
let simpleSnapshot: EditorSnapshot;
let responseSnapshot: EditorSnapshot;
beforeAll(async () => {
	const root = await course(persistedSource);
	persistedSnapshot = snapshotFixture(await resolveLessonSources(root));
	await writeFile(
		join(root, "a.prax"),
		persistedSource.replace("# Page 0\n", "# Page 0\n\n::: note\nNew\n:::\n"),
	);
	mixedSnapshot = snapshotFixture(await resolveLessonSources(root));
	// Pure transport/schema cases clone these admitted fixtures; they never edit their files.
	simpleSnapshot = snapshotFixture(await resolveLessonSources(await course("# P\n\nText\n")));
	responseSnapshot = snapshotFixture(
		await resolveLessonSources(
			await course(`# P\n\n::: free-response Response\n${"T".repeat(10_000)}\n:::\n`),
		),
	);
});

it("D10 persisted snapshot uses plain JSON with bounded node metadata", () => {
	const wire = prepareEditorSnapshot(persistedSnapshot);
	expect(Array.isArray(wire.lessons[0].nodes)).toBe(true);
	const decoded = roundTrip(persistedSnapshot, true);
	expect(decoded).toEqual(persistedSnapshot);
	expect(decoded.lessons[0].nodes).toHaveLength(540);
	expect(decoded.lessons[0].nodes.filter((node) => !isRuntimeNodeId(node.id))).toHaveLength(540);
});

it("D10 mixed snapshot uses plain JSON with bounded metadata and null runtime targets", () => {
	const wire = prepareEditorSnapshot(mixedSnapshot);
	expect(Array.isArray(wire.lessons[0].nodes)).toBe(true);
	const decoded = roundTrip(mixedSnapshot, true);
	expect(decoded).toEqual(mixedSnapshot);
	const unstored = decoded.lessons[0].nodes.filter((node) => isRuntimeNodeId(node.id));
	expect(unstored.length).toBeGreaterThan(0);
	for (const node of unstored) {
		const target = editorDraftSeed(decoded.lessons[0], node).target;
		if (target.kind !== "node") throw new Error("Expected node target");
		expect(target.nodeId).toBe(null);
	}
});

it("keeps source-proportional note and list labels within the metadata budget", async () => {
	const source = `# P\n\n::: note\n${"N".repeat(2000)}\n:::\n\n- ${"L".repeat(2000)}\n- tail\n`;
	const snapshot = snapshotFixture(await resolveLessonSources(await course(source)));
	expect(snapshot.lessons[0].nodes.some((node) => node.label.length > 120)).toBe(true);
	const decoded = roundTrip(snapshot);
	for (const node of decoded.lessons[0].nodes)
		expect(Buffer.byteLength(node.label)).toBeLessThanOrEqual(360);
});

it("D1 D2 transports exact BOM, CRLF and astral emoji UTF-8 bytes", async () => {
	const source =
		"\uFEFF# P\r\n\r\n::: tabs\r\n:: One\r\n::: note\r\nText\u{1F642}\r\n:::\r\n:: Two\r\nBody\r\n:::\r\n";
	const snapshot = snapshotFixture(await resolveLessonSources(await course(source)));
	const decoded = roundTrip(snapshot);
	expect(decoded).toEqual(snapshot);
	const lesson = decoded.lessons[0];
	expect(Buffer.from(editorDraftSeed(lesson).expectedText)).toEqual(Buffer.from(source));
	const note = lesson.nodes.find((node) => node.type === "note");
	expect(note).toBeDefined();
	const seed = editorDraftSeed(lesson, note);
	expect(seed.expectedText).toBe("::: note\r\nText\u{1F642}\r\n:::\r\n");
	expect(seed.editableText).toBe("::: note\r\nText\u{1F642}\r\n");
	expect(Buffer.from(seed.expectedText).includes(Buffer.from([0xf0, 0x9f, 0x99, 0x82]))).toBe(true);
	expect(seed.expectedText.length).toBe(23);
});

it("caps labels without cutting a surrogate pair and retains uncapped lone surrogates", async () => {
	const snapshot = snapshotFixture(
		await resolveLessonSources(await course("# P\n\nText\n\nOther\n")),
	);
	snapshot.lessons[0].label = `${"L".repeat(355)}\u{1F642}${"L".repeat(380)}`;
	snapshot.lessons[0].nodes[0].label = "a\uD83Db\uDE42c";
	const decoded = roundTrip(snapshot);
	expect(decoded.lessons[0].label).toBe(`${"L".repeat(355)}\u2026`);
	expect(decoded.lessons[0].nodes[0].label).toBe("a\uD83Db\uDE42c");
});

it("transports empty courses, empty lessons and an unstored course", async () => {
	const empty = { schema: 1 as const, seq: 0, transientIdentity: true, lessons: [] };
	expect(roundTrip(empty)).toEqual(empty);
	const snapshot = snapshotFixture(await resolveLessonSources(await course("")));
	expect(snapshot.lessons[0].nodes).toEqual([]);
	expect(roundTrip(snapshot)).toEqual(snapshot);
	const root = await mkdtemp(join(tmpdir(), "snapshot-unstored-"));
	roots.push(root);
	await writeFile(join(root, "a.prax"), "# P\n\nText\n");
	const unstored = snapshotFixture(await resolveLessonSources(root));
	const decoded = roundTrip(unstored);
	for (const { id, seed } of [decoded.lessons[0], ...decoded.lessons[0].nodes]) {
		expect(isRuntimeNodeId(id)).toBe(true);
		if (seed.target.kind !== "node") throw new Error("Expected node target");
		expect(seed.target.nodeId).toBe(null);
	}
});

it("CLI inventory keeps its public shape without snapshot serialization", async () => {
	const inventory = await readBlockInventory(await course("# P\n\nText\n"));
	expect(Object.keys(inventory).sort()).toEqual([
		"blocks",
		"files",
		"schema",
		"textFields",
		"transientIdentity",
	]);
});

it("caps a 500-character outline label at 360 UTF-8 bytes with a visible ellipsis", async () => {
	const snapshot = structuredClone(simpleSnapshot);
	snapshot.lessons[0].label = "L".repeat(500);
	snapshot.lessons[0].nodes[0].label = "N".repeat(500);
	const decoded = editorSnapshotSchema.parse(
		JSON.parse(JSON.stringify(prepareEditorSnapshot(snapshot))),
	);
	expect(decoded.lessons[0].label).toBe(`${"L".repeat(357)}\u2026`);
	expect(decoded.lessons[0].nodes[0].label).toBe(`${"N".repeat(357)}\u2026`);
});

it("D10 refuses runtime write targets in lesson-level seeds", async () => {
	const snapshot = structuredClone(simpleSnapshot);
	const wire = prepareEditorSnapshot(snapshot);
	wire.lessons[0].id = "rt-00000000000000000000000000001003";
	wire.lessons[0].seed.target = {
		kind: "node",
		nodeId: "rt-00000000000000000000000000001003",
		path: [],
		fingerprint: "0".repeat(64),
	};
	expect(() => editorSnapshotSchema.parse(wire)).toThrow();
});

it("bounds unknown directive names without rejecting the course", () => {
	const snapshot = largeSnapshotFixture(`# P\n\n::: ${"T".repeat(769)}\nText\n:::\n`);
	const decoded = roundTrip(snapshot);
	expect(decoded.lessons[0].nodes.find((node) => node.kind === "block")?.type).toBe("block");
});

it.each([
	["Chinese", "中", 119],
	["Thai", "ก้", 59],
	["Hindi", "कि", 59],
	["Arabic", "عَ", 89],
	["emoji ZWJ", "\u{1F469}\u200D\u{1F4BB}", 32],
])("clips 500 %s graphemes at the byte cap", (_script, unit, count) => {
	const snapshot = largeSnapshotFixture("# P\n\nText\n");
	snapshot.lessons[0].label = String(unit).repeat(500);
	for (const node of snapshot.lessons[0].nodes) node.label = String(unit).repeat(500);
	const decoded = roundTrip(snapshot);
	for (const item of [decoded.lessons[0], ...decoded.lessons[0].nodes])
		expect(item.label).toBe(`${String(unit).repeat(Number(count))}\u2026`);
});

it.each([
	["Chinese", "中", 80, false],
	["Thai", "ก้", 59, true],
	["Hindi", "कि", 59, true],
	["Arabic", "عَ", 80, false],
	["emoji ZWJ", "\u{1F469}\u200D\u{1F4BB}", 32, true],
])("transports 80 %s graphemes without rejecting the course", async (_script, unit, count, cut) => {
	const snapshot = structuredClone(responseSnapshot);
	for (const node of snapshot.lessons[0].nodes) node.label = String(unit).repeat(80);
	const decoded = roundTrip(snapshot);
	for (const node of decoded.lessons[0].nodes)
		expect(node.label).toBe(`${String(unit).repeat(Number(count))}${cut ? "\u2026" : ""}`);
});

it("bounds the longest schema type, maximum offsets and escaped labels by construction", () => {
	// This measures the current schema vocabulary, not a product type-name limit.
	const longestType = Object.keys(BLOCK_SCHEMA).reduce(
		(longest, type) => (type.length > longest.length ? type : longest),
		"",
	);
	expect(longestType).toBe("write-distractors");
	expect(longestType.length).toBe(17);
	const snapshot = largeSnapshotFixture("# P\n\nText\n");
	const lesson = snapshot.lessons[0];
	lesson.source = " ".repeat(5_000_000);
	lesson.seed.expected.end = 5_000_000;
	lesson.seed.editable.end = 5_000_000;
	lesson.nodes[0].id = "00000000-0000-4000-8000-000000000001";
	const node = lesson.nodes[1];
	node.id = "00000000-0000-4000-8000-000000000002";
	node.parentId = lesson.nodes[0].id;
	node.kind = "frontmatter";
	node.type = longestType;
	node.label = "N".repeat(500);
	node.seed.target = {
		kind: "node",
		nodeId: node.id,
		fingerprint: "f".repeat(64),
		path: [0, 5_000_000],
	};
	node.seed.expected = { start: 5_000_000, end: 5_000_000 };
	node.seed.editable = { start: 5_000_000, end: 5_000_000 };
	const wire = prepareEditorSnapshot(snapshot);
	const bytes = Buffer.byteLength(JSON.stringify(wire.lessons[0].nodes[1]));
	expect(bytes).toBe(769);
	expect(bytes).toBeLessThanOrEqual(nodeMetadataBudget);
	expect(editorSnapshotSchema.parse(wire).lessons[0].nodes[1].type).toBe(longestType);
	node.label = "\u0000".repeat(500);
	expect(roundTrip(snapshot).lessons[0].nodes[1].label).toBe(`${"\u0000".repeat(59)}\u2026`);
});

it("never rejects generated Unicode labels and nesting for size (seed 0x1d360)", () => {
	let state = 0x1d360;
	const random = (limit: number) => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) % limit;
	};
	const units = [
		"中",
		"ก้",
		"कि",
		"عَ",
		"\u{1F469}\u200D\u{1F4BB}",
		"a\u0301",
		"\u0000",
		"\n",
		'"',
		"\\",
		"\uD800",
		"\uDC00",
	];
	const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
	for (let trial = 0; trial < 40; trial++) {
		const snapshot = largeSnapshotFixture("# P\n\nText\n");
		const lesson = snapshot.lessons[0];
		const template = lesson.nodes[1];
		lesson.nodes = Array.from({ length: 1 + random(100) }, (_, index) => ({
			...template,
			id: `rt-${(index + 2).toString(16).padStart(32, "0")}`,
			parentId: index ? `rt-${(index + 1).toString(16).padStart(32, "0")}` : null,
			label: Array.from({ length: 80 + random(520) }, () => units[random(units.length)]).join(""),
			seed: {
				...template.seed,
				target: { ...template.seed.target, path: Array(index + 1).fill(0) },
			},
		}));
		const wire = prepareEditorSnapshot(snapshot);
		const decoded = editorSnapshotSchema.parse(JSON.parse(JSON.stringify(wire)));
		for (const [index, node] of wire.lessons[0].nodes.entries()) {
			expect(Buffer.byteLength(JSON.stringify(node))).toBeLessThanOrEqual(nodeMetadataBudget);
			expect(Buffer.byteLength(node.label)).toBeLessThanOrEqual(360);
			const original = lesson.nodes[index].label;
			if (node.label !== original) {
				expect(node.label.endsWith("\u2026")).toBe(true);
				const prefix = node.label.slice(0, -1);
				expect(original.startsWith(prefix)).toBe(true);
				const ends = [
					0,
					...Array.from(
						segmenter.segment(original),
						({ index, segment }) => index + segment.length,
					),
				];
				expect(ends).toContain(prefix.length);
			}
			expect(decoded.lessons[0].nodes[index].seed.target.path).toEqual(Array(index + 1).fill(0));
		}
	}
});

it("carries deep nesting by parent identity and restores exact write paths", () => {
	const snapshot = largeSnapshotFixture("# P\n\nText\n");
	const lesson = snapshot.lessons[0];
	const template = lesson.nodes[1];
	lesson.nodes = Array.from({ length: 2000 }, (_, index) => ({
		...template,
		id: `rt-${(index + 2).toString(16).padStart(32, "0")}`,
		parentId: index ? `rt-${(index + 1).toString(16).padStart(32, "0")}` : null,
		pageId: "rt-00000000000000000000000000000002",
		seed: { ...template.seed, target: { ...template.seed.target, path: Array(index + 1).fill(0) } },
	}));
	const decoded = roundTrip(snapshot);
	expect(decoded.lessons[0].nodes[1999].seed.target).toEqual({
		kind: "node",
		nodeId: null,
		path: Array(2000).fill(0),
		fingerprint: "0".repeat(64),
	});
});

it.each([
	["missing parent", "Invalid editor snapshot parent"],
	["self parent", "Invalid editor snapshot parent"],
	["lesson parent", "Invalid editor snapshot parent"],
	["duplicate id", "Duplicate editor snapshot node"],
])("returns a typed refusal for %s without throwing", (caseName, message) => {
	const wire = prepareEditorSnapshot(largeSnapshotFixture("# P\n\nText\n"));
	const lesson = wire.lessons[0];
	const node = lesson.nodes[0];
	switch (caseName) {
		case "missing parent":
			node.parentId = "00000000-0000-4000-8000-000000000001";
			break;
		case "self parent":
			node.parentId = node.id;
			break;
		case "lesson parent":
			node.parentId = lesson.id;
			break;
		case "duplicate id":
			lesson.nodes[1].id = node.id;
			break;
	}
	const result = editorSnapshotSchema.safeParse(wire);
	expect(result.success).toBe(false);
	if (result.success) throw new Error("Expected refused snapshot");
	expect(result.error.issues).toEqual([
		expect.objectContaining({ code: "custom", path: ["lessons", 0], message }),
	]);
});

it("returns a typed source-ceiling refusal for a 5,000,001-unit lesson without throwing", () => {
	const snapshot = largeSnapshotFixture("# P\n\nText\n");
	snapshot.lessons[0].source = "S".repeat(5_000_001);
	const result = editorSnapshotSchema.safeParse(prepareEditorSnapshot(snapshot));
	expect(result.success).toBe(false);
	if (result.success) throw new Error("Expected refused snapshot");
	expect(result.error.issues).toEqual([
		expect.objectContaining({
			code: "too_big",
			origin: "string",
			maximum: 5_000_000,
			inclusive: true,
			path: ["lessons", 0, "source"],
			message: "String must contain at most 5000000 character(s)",
		}),
	]);
});

it.each([
	"node runtime target",
	"mismatched target",
	"node types",
	"scope",
	"lesson source",
	"lesson file",
	"revision",
	"top-level field",
	"node field",
	"unbounded type",
	"unbounded label",
	"unbounded display id",
	"outside range",
	"editable containment",
])("D10 refuses malformed snapshot %s", async (caseName) => {
	const snapshot = structuredClone(simpleSnapshot);
	const input = JSON.parse(JSON.stringify(prepareEditorSnapshot(snapshot)));
	const lesson = input.lessons[0];
	const node = lesson.nodes[0];
	switch (caseName) {
		case "node runtime target":
			lesson.nodes[1].id = "rt-00000000000000000000000000001003";
			lesson.nodes[1].target = "rt-00000000000000000000000000001003";
			break;
		case "mismatched target":
			node.target = "00000000-0000-4000-8000-000000000001";
			break;
		case "node types":
			node.id = 42;
			node.label = { evil: true };
			break;
		case "scope":
			node.scope = "everything";
			break;
		case "lesson source":
			lesson.source = 123;
			break;
		case "lesson file":
			lesson.file = "../a.prax";
			break;
		case "revision":
			lesson.baseRevision = "invalid";
			break;
		case "top-level field":
			input.evil = 1;
			break;
		case "node field":
			node.source = "private repeated text";
			break;
		case "unbounded type":
			node.type = "T".repeat(769);
			break;
		case "unbounded label":
			node.label = "中".repeat(121);
			break;
		case "unbounded display id":
			node.id = "中".repeat(36);
			break;
		case "outside range":
			lesson.seed.expected.end = 11;
			break;
		case "editable containment":
			lesson.nodes[1].ranges[2] = 0;
			break;
		default:
			throw new Error("Unknown fixture");
	}
	expect(editorSnapshotSchema.safeParse(input).success).toBe(false);
});

describe("8,800-node course", () => {
	let snapshot: EditorSnapshot;
	let source = "";
	beforeAll(() => {
		const paragraph =
			"Lorem ipsum dolor sit amet, consectetur adipiscing elit \u{1F642}.\n\n".repeat(3);
		for (let page = 0; page < 200; page++) {
			source += `# Page ${page}\n\n${paragraph}`;
			for (let note = 0; note < 10; note++) source += `::: note\n${paragraph}:::\n\n`;
		}
		snapshot = largeSnapshotFixture(source);
	});
	it(`keeps source once and metadata within ${nodeMetadataBudget} bytes per node, with recorded timings`, () => {
		const decoded = roundTrip(snapshot, true);
		expect(decoded.lessons[0].source).toBe(source);
		expect(decoded.lessons[0].nodes).toHaveLength(8_800);
		expect(decoded.lessons[0].nodes.map(({ label: _label, ...node }) => node)).toEqual(
			snapshot.lessons[0].nodes.map(({ label: _label, ...node }) => node),
		);
	});
});
