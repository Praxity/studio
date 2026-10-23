import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { runPraxityCli } from "../cli";
import * as identityStore from "../identity-store";
import * as blockInspection from "../operations/block-inspection";
import { OperationService } from "../operations/operation-service";

const runtime = { appVersion: "test", exportAssetsDir: "unused" };
const roots: string[] = [];
const source =
	"\uFEFF# Page {style=none}\r\n\r\n## Heading {level=3}\r\n\r\nParagraph *text*.\r\n\r\n- Leaf item\r\n\r\n::: choice Pick\r\n(x) First option\r\n( ) Second option\r\n:::\r\n\r\nTail.";
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(text = source, initialize = true) {
	const root = await mkdtemp(join(tmpdir(), "canvas-text-cli-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), text);
	await writeFile(join(root, "course.yaml"), "title: Test\nlessons: [lesson.prax]\n");
	if (initialize) await persistFixtureIdentity(root);
	return root;
}
async function hashes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const file = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await hashes(root, file));
		else
			result[file] = createHash("sha256")
				.update(await readFile(join(root, file)))
				.digest("hex");
	}
	return result;
}
type Field = {
	nodeId: string;
	ownerId: string;
	file: string;
	field: string;
	kind: string;
	text: string;
	fileRevision: string;
	feedback?: { html: string; place: { option: string } | { block: string; result: string } };
};

it.each(["Third.", "Fourth."])(
	"C06c1 CLI inspects and edits later option feedback %s",
	async (text) => {
		const initial =
			"# Page\n\n::: choice Q\nfeedback: Shared.\n(x) A\nfeedback: First.\n( ) B\nfeedback: Second.\n( ) C\nfeedback: Third.\n( ) D\nfeedback: Fourth.\n:::\n";
		const root = await fixture(initial);
		const inspected = await runPraxityCli(["inspect", root, "--text-fields", "--json"], runtime);
		expect(inspected.exitCode, inspected.stdout).toBe(0);
		const before = JSON.parse(inspected.stdout).textFields as Field[];
		const field = before.find((field) => field.text === text);
		expect(field?.feedback?.html).toBe(text);
		if (!field) throw new Error("Missing later option feedback");
		const saved = await edit(root, field, "never");
		expect(saved.exitCode, saved.stdout).toBe(0);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(initial.replace(text, "never"));
		const refreshed = await runPraxityCli(["inspect", root, "--text-fields", "--json"], runtime);
		expect(refreshed.exitCode, refreshed.stdout).toBe(0);
		const after = JSON.parse(refreshed.stdout).textFields as Field[];
		expect(after.map((field) => [field.nodeId, field.ownerId])).toEqual(
			before.map((field) => [field.nodeId, field.ownerId]),
		);
		expect(after.find((candidate) => candidate.nodeId === field.nodeId)?.feedback?.html).toBe(
			"never",
		);
	},
);
async function inspect(root: string): Promise<{
	textFields: Field[];
	blocks: { nodeId: string; kind: string; fileRevision: string }[];
}> {
	const result = await runPraxityCli(["inspect", root, "--blocks", "--json"], runtime);
	expect(result.exitCode, result.stdout || result.stderr).toBe(0);
	return JSON.parse(result.stdout);
}
function edit(root: string, field: Field, text: string, extra: string[] = []) {
	return runPraxityCli(
		[
			"edit",
			root,
			"setText",
			"--at",
			field.nodeId,
			"--rendered",
			"--arg",
			`field=${field.field}`,
			"--arg",
			`text=${JSON.stringify(text)}`,
			"--expect-revision",
			field.fileRevision,
			"--json",
			...extra,
		],
		runtime,
	);
}

it("text-field inspection returns canvas bindings and file revisions without eligibility probes", async () => {
	const root = await fixture("# Page\n\nParagraph.\n");
	const before = await hashes(root);
	const snapshot = await new OperationService(root).canvasTextSnapshot();
	const probes = vi.spyOn(identityStore, "planReadIdentity");
	try {
		const result = await runPraxityCli(["inspect", root, "--text-fields", "--json"], runtime);
		expect(result.exitCode, result.stdout || result.stderr).toBe(0);
		const inventory = JSON.parse(result.stdout);
		expect(Object.keys(inventory).sort()).toEqual([
			"files",
			"schema",
			"textFields",
			"transientIdentity",
		]);
		expect(inventory.textFields).toEqual(
			snapshot.fields.map(({ baseRevision, ...field }) => ({
				...field,
				fileRevision: baseRevision,
			})),
		);
		expect(inventory.files).toEqual([
			{
				path: "lesson.prax",
				baseRevision: createHash("sha256").update("# Page\n\nParagraph.\n").digest("hex"),
			},
		]);
		expect(probes).not.toHaveBeenCalled();
		expect(await hashes(root)).toEqual(before);
		const blocks = await inspect(root);
		expect(blocks.textFields).toEqual(inventory.textFields);
		expect(probes).not.toHaveBeenCalled();
	} finally {
		probes.mockRestore();
	}
});

// Reuses the first run's public-interface prerequisite; captions are covered by their owning slice.
it("the existing canvas admits the generated title and paragraph", async () => {
	const root = await fixture("# Page\n\nParagraph.\n");
	const snapshot = await new OperationService(root).canvasTextSnapshot();
	expect(snapshot.fields.map(({ text }) => text)).toEqual(["Page", "Paragraph."]);
});

it("text-fields lists parent list items and setText edits only the selected parent's bytes", async () => {
	const initial = "\uFEFF# Page\r\n\r\n- Parent\r\n  - Child\r\n    - Grandchild\r\n\r\nTail.";
	const root = await fixture(initial);
	const before = await inspect(root);
	const result = await runPraxityCli(["inspect", root, "--text-fields", "--json"], runtime);
	expect(result.exitCode, result.stdout).toBe(0);
	const fields: Field[] = JSON.parse(result.stdout).textFields;
	expect(fields.filter((field) => field.kind === "list-entry").map((field) => field.text)).toEqual([
		"Parent",
		"Child",
		"Grandchild",
	]);
	const parent = fields.find((field) => field.text === "Parent");
	if (!parent) throw new Error("Missing parent field");
	const saved = await edit(root, parent, "Revised *parent*");
	expect(saved.exitCode, saved.stdout).toBe(0);
	expect(await readFile(join(root, "lesson.prax"))).toEqual(
		Buffer.from(
			"\uFEFF# Page\r\n\r\n- Revised *parent*\r\n  - Child\r\n    - Grandchild\r\n\r\nTail.",
		),
	);
	const after = await inspect(root);
	expect(after.blocks.map((block) => block.nodeId)).toEqual(
		before.blocks.map((block) => block.nodeId),
	);
	expect(after.textFields.map((field) => [field.nodeId, field.ownerId])).toEqual(
		fields.map((field) => [field.nodeId, field.ownerId]),
	);
});

it("inspect exposes the canvas's exact rendered bindings, including generated titles", async () => {
	const root = await fixture();
	const before = await hashes(root);
	const snapshot = await new OperationService(root).canvasTextSnapshot();
	const result = await inspect(root);
	expect(result.textFields).toEqual(
		snapshot.fields.map(({ baseRevision, ...field }) => ({ ...field, fileRevision: baseRevision })),
	);
	const title = result.textFields.find((f) => f.kind === "page");
	expect(title).toMatchObject({ text: "Page", field: "subject", file: "lesson.prax" });
	expect(result.blocks.some((b) => b.nodeId === title?.nodeId)).toBe(false);
	expect(await hashes(root)).toEqual(before);
});

it.each([
	["page", "Page", "Revised page"],
	["heading", "Heading", "Revised heading"],
	["body", "Paragraph *text*.", "Revised **paragraph**."],
	["list-entry", "Leaf item", "Revised leaf"],
	["option", "Second option", "Revised option"],
])("rendered %s dry-runs and saves exact bytes with stable IDs", async (kind, old, text) => {
	const content: Record<string, string> = {
		page: "# Page {style=none}",
		heading: "# Before\r\n\r\n## Heading {level=3}",
		body: "# Before\r\n\r\nParagraph *text*.",
		"list-entry": "# Before\r\n\r\n- Leaf item",
		option: "# Before\r\n\r\n::: choice Pick\r\n(x) First option\r\n( ) Second option\r\n:::",
	};
	const initial = `\uFEFF${content[kind]}\r\n\r\nTail.`;
	const root = await fixture(initial);
	const before = await hashes(root);
	const inventory = await inspect(root);
	const target = inventory.textFields.find((f) => f.kind === kind && f.text === old);
	if (!target) throw new Error("Missing literal fixture field");
	expect((await edit(root, target, text, ["--dry-run"])).exitCode).toBe(0);
	expect(await hashes(root)).toEqual(before);
	const applied = await edit(root, target, text);
	expect(applied.exitCode, applied.stdout).toBe(0);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(initial.replace(old, text));
	const after = await inspect(root);
	expect(after.blocks.map((b) => b.nodeId)).toEqual(inventory.blocks.map((b) => b.nodeId));
	expect(after.textFields.map((f) => [f.nodeId, f.ownerId])).toEqual(
		inventory.textFields.map((f) => [f.nodeId, f.ownerId]),
	);
	const changed = await hashes(root);
	const paths = new Set([...Object.keys(before), ...Object.keys(changed)]);
	// Transactions retain displaced inodes in root recovery stages, outside .praxity/.
	const differences = [...paths].filter(
		(p) => before[p] !== changed[p] && !p.startsWith(".praxity-write-"),
	);
	expect(
		differences.filter(
			(p) => p !== "lesson.prax" && !/^\.praxity\/identity\/(?:snapshots\/|lessons\/)/u.test(p),
		),
	).toEqual([]);
	expect(differences.filter((p) => p.startsWith(".praxity/identity/lessons/"))).toHaveLength(1);
});

it.each(["uuid", "address", "rendered", "title"])(
	"%s edits keep review absent with and without a revision guard",
	async (selector) => {
		for (const guarded of [false, true]) {
			if (selector === "title" && !guarded) continue;
			const root = await fixture("# Page\n\n## Heading\n");
			const inventory = await blockInspection.readBlockInventory(root);
			const heading = inventory.blocks.find((block) => block.kind === "heading");
			const title = inventory.textFields.find((field) => field.kind === "page");
			if (!heading || !title) throw new Error("Missing fixture field");
			const target = selector === "title" ? title : heading;
			const args = [
				"edit",
				root,
				"setText",
				"--at",
				selector === "address" ? heading.address : target.nodeId,
				"--arg",
				"field=subject",
				"--arg",
				"text=Revised",
				"--json",
			];
			if (selector === "rendered") args.push("--rendered");
			if (guarded) args.push("--expect-revision", target.fileRevision);
			const before = await hashes(root);
			if (selector === "rendered" && !guarded) {
				const result = await runPraxityCli(args, runtime);
				expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: "invalid-args" });
				expect(await hashes(root)).toEqual(before);
				continue;
			}
			const dry = await runPraxityCli([...args, "--dry-run"], runtime);
			expect(dry.exitCode, dry.stdout).toBe(0);
			expect(await hashes(root)).toEqual(before);
			const result = await runPraxityCli(args, runtime);
			expect(result.exitCode, result.stdout).toBe(0);
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
				selector === "title" ? "# Revised\n\n## Heading\n" : "# Page\n\n## Revised\n",
			);
			expect(
				Object.keys(await hashes(root)).some((path) => path.startsWith(".praxity/review/")),
			).toBe(false);
		}
	},
);

it("duplicate rendered IDs across lessons refuse ambiguously with zero writes", async () => {
	const root = await fixture("# Page\n\nParagraph.\n");
	const inventory = await blockInspection.readBlockInventory(root);
	const field = inventory.textFields[0];
	const before = await hashes(root);
	const read = vi.spyOn(blockInspection, "readBlockInventory").mockResolvedValue({
		...inventory,
		textFields: [field, { ...field, file: "other.prax" }],
	});
	try {
		for (const extra of [["--dry-run"], []]) {
			const result = await edit(root, field, "Changed", extra);
			expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: "ambiguous" });
			expect(await hashes(root)).toEqual(before);
		}
	} finally {
		read.mockRestore();
	}
});

it.each([
	["setText", "--find", "Heading", "--rendered"],
	["setProperty", "--at", "lesson.prax#1.1", "--rendered"],
	["setText", "--at", "lesson.prax#1.1", "--rendered"],
	["setText", "--at", "missing", "--rendered", "--rendered"],
])("rendered intent refuses invalid selectors and flags: %s %s %s", async (...options) => {
	const root = await fixture("# Page\n\n## Heading\n");
	const before = await hashes(root);
	const result = await runPraxityCli(["edit", root, ...options, "--json"], runtime);
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: false,
		code:
			options[2] === "lesson.prax#1.1" && options[0] === "setText" ? "orphaned" : "invalid-args",
	});
	expect(await hashes(root)).toEqual(before);
});

it.each(["en", "fr"])(
	"help documents text-field inspection and rendered intent in %s",
	async (language) => {
		const result = await runPraxityCli(["--help", "--lang", language], runtime);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("<--blocks [--eligibility] | --text-fields> [--json]");
		expect(result.stdout).toContain("--at <address|uuid|rendered-node-id>");
		expect(result.stdout).toContain(
			"setText --at <rendered-node-id> --rendered --expect-revision <sha256>",
		);
		expect(result.stdout).toContain(language === "fr" ? "identifiants de rendu" : "rendered IDs");
	},
);

it.each([
	[
		"figure",
		"::: figure {width=wide}\r\n![Exact alt](https://example.com/image.png) {size=medium}\r\nFigure *caption*.\r\n\r\nSecond caption.\r\n:::",
		"Figure *caption*.",
		"Revised **figure**.",
	],
	[
		"media",
		"::: video https://example.com/clip.mp4\r\ncaption: Media *caption*.\r\ntranscript: Keep transcript\r\n:::",
		"Media *caption*.",
		"Revised **media**.",
	],
])(
	"text-fields lists and edits a %s caption with exact bytes and stable IDs",
	async (_kind, block, old, text) => {
		const initial = `\uFEFF# Page\r\n\r\n${block}\r\n\r\nTail.`;
		const root = await fixture(initial);
		const inspected = await runPraxityCli(["inspect", root, "--text-fields", "--json"], runtime);
		expect(inspected.exitCode, inspected.stdout).toBe(0);
		const fields: Field[] = JSON.parse(inspected.stdout).textFields;
		const field = fields.find((candidate) => candidate.text === old);
		if (!field) throw new Error("Missing caption binding");
		const before = await hashes(root);
		expect((await edit(root, field, text, ["--dry-run"])).exitCode).toBe(0);
		expect(await hashes(root)).toEqual(before);
		const result = await edit(root, field, text);
		expect(result.exitCode, result.stdout).toBe(0);
		expect(await readFile(join(root, "lesson.prax"))).toEqual(
			Buffer.from(initial.replace(old, text)),
		);
		const after = await runPraxityCli(["inspect", root, "--text-fields", "--json"], runtime);
		expect(
			JSON.parse(after.stdout).textFields.map((candidate: Field) => [
				candidate.nodeId,
				candidate.ownerId,
			]),
		).toEqual(fields.map((candidate) => [candidate.nodeId, candidate.ownerId]));
		expect(
			Object.keys(await hashes(root)).some((path) => path.startsWith(".praxity/review/")),
		).toBe(false);
	},
);

it.each([
	["orphaned", "missing", "subject", "Changed"],
	["not-allowed", "page", "value", "Changed"],
	["unsupported-syntax", "body", "text", "A paragraph\n\nA new block"],
	["unsupported-syntax", "option", "text", "(x) Changed answer"],
	["line-break", "page", "subject", "Changed\n# Page"],
	["empty-text", "body", "text", ""],
])("rendered %s refuses %s field %s with zero writes", async (code, kind, field, text) => {
	const root = await fixture();
	const inventory = await inspect(root);
	const target = inventory.textFields.find((f) => f.kind === (kind === "missing" ? "page" : kind));
	if (!target) throw new Error("Missing literal fixture field");
	const input = {
		...target,
		field,
		...(kind === "missing" ? { nodeId: "00000000-0000-4000-8000-000000000000" } : {}),
	};
	const before = await hashes(root);
	for (const extra of [["--dry-run"], []]) {
		const result = await edit(root, input, text, extra);
		expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code });
		expect(await hashes(root)).toEqual(before);
	}
});

it("an unrelated outside edit makes the whole-file revision stale with zero writes", async () => {
	const root = await fixture();
	const field = (await inspect(root)).textFields[0];
	await writeFile(join(root, "lesson.prax"), source.replace("Tail.", "Else."));
	const before = await hashes(root);
	for (const extra of [["--dry-run"], []]) {
		const result = await edit(root, field, "Changed", extra);
		expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: "stale" });
		expect(await hashes(root)).toEqual(before);
	}
});

it("a runtime ID from another CLI invocation refuses rather than guessing a duplicate heading", async () => {
	const root = await fixture("# Page\n\n## Same\n\n## Same\n", false);
	const field = (await inspect(root)).textFields.find((f) => f.kind === "heading");
	if (!field) throw new Error("Missing runtime heading");
	const before = await hashes(root);
	for (const extra of [["--dry-run"], []]) {
		const result = await edit(root, field, "Changed", extra);
		expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: "orphaned" });
		expect(await hashes(root)).toEqual(before);
	}
});

it("duplicate text selectors still refuse with zero writes", async () => {
	const root = await fixture("# Page\n\n## Same\n\n## Same\n");
	const before = await hashes(root);
	for (const extra of [["--dry-run"], []]) {
		const result = await runPraxityCli(
			[
				"edit",
				root,
				"setText",
				"--find",
				"Same",
				"--arg",
				"field=subject",
				"--arg",
				"text=Changed",
				"--json",
				...extra,
			],
			runtime,
		);
		expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: "ambiguous" });
		expect(await hashes(root)).toEqual(before);
	}
});
it.each([
	["--json", "--lang", "fr"],
	["--lang", "fr", "--json"],
])("inspect accepts JSON and language flags in either order: %j", async (...options) => {
	const root = await fixture();
	expect((await runPraxityCli(["inspect", root, "--blocks", ...options], runtime)).exitCode).toBe(
		0,
	);
});
it.each([["--json", "--json"], ["--lang", "fr", "--lang", "fr"], ["--unknown"], ["--lang", "xx"]])(
	"inspect rejects invalid flags with zero writes: $0 $1 $2 $3",
	async (...options) => {
		const root = await fixture();
		const before = await hashes(root);
		const result = await runPraxityCli(["inspect", root, "--blocks", ...options], runtime);
		expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: "invalid-args" });
		expect(await hashes(root)).toEqual(before);
	},
);
it.each([[], ["--arg", "answer=forged"]])(
	"rendered-only IDs require a revision and reject extra arguments: %j",
	async (...extra) => {
		const root = await fixture();
		const target = (await inspect(root)).textFields.find((f) => f.kind === "page");
		if (!target) throw new Error("Missing title");
		const before = await hashes(root);
		const args = [
			"edit",
			root,
			"setText",
			"--at",
			target.nodeId,
			"--arg",
			"field=subject",
			"--arg",
			"text=Changed",
			"--json",
			...extra,
		];
		if (extra.length) args.push("--expect-revision", target.fileRevision);
		expect(JSON.parse((await runPraxityCli(args, runtime)).stdout)).toMatchObject({
			ok: false,
			code: "invalid-args",
		});
		expect(await hashes(root)).toEqual(before);
	},
);
it("ordinary source UUID edits retain non-canvas fields without review metadata", async () => {
	const original = "# Page\n\n::: video clip.mp4\ncaption: Caption.\n:::\n";
	const root = await fixture(original);
	const inventory = await inspect(root);
	const block = inventory.blocks.find((b) => b.kind === "part");
	if (!block) throw new Error("Missing caption part");
	const result = await runPraxityCli(
		[
			"edit",
			root,
			"setText",
			"--at",
			block.nodeId,
			"--expect-revision",
			block.fileRevision,
			"--arg",
			"field=value",
			"--arg",
			'text=""',
			"--json",
		],
		runtime,
	);
	expect(result.exitCode, result.stdout).toBe(0);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"# Page\n\n::: video clip.mp4\ncaption: \n:::\n",
	);
	expect(Object.keys(await hashes(root)).some((path) => path.startsWith(".praxity/review/"))).toBe(
		false,
	);
});

it("inspect includes a named part's admitted field without a CLI kind table", async () => {
	const root = await fixture(
		"# Page\n\n::: choice Pick\ncorrect: Keep listening.\n(x) First\n( ) Second\n:::\n",
	);
	const { textFields } = await inspect(root);
	expect(textFields.filter((field) => field.kind === "part")).toMatchObject([
		{ file: "lesson.prax", name: "correct", field: "value", text: "Keep listening." },
	]);
});

it.each([0, 1, 2])(
	"removed page %s admits the first surviving page, never its ordinal replacement",
	async (index) => {
		const pages = [
			"# First\n\nFirst body.\n",
			"# Middle\n\nMiddle body.\n",
			"# Last\n\nLast body.\n",
		];
		const root = await fixture(pages.join("\n"));
		const service = new OperationService(root);
		const initial = await service.canvasTextSnapshot();
		const pageFields = initial.fields.filter((field) => field.kind === "page");
		const selected = pageFields[index];
		const scope = { ...selected, pageIds: pageFields.map((field) => field.pageId) };
		await writeFile(join(root, "lesson.prax"), pages.filter((_, i) => i !== index).join("\n"));
		const current = await service.canvasTextSnapshot(scope);
		expect(
			current.fields.filter((field) => field.kind === "page").map((field) => field.text),
		).toEqual([index === 0 ? "Middle" : "First"]);
	},
);
