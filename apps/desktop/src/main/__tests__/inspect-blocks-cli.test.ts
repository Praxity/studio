import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { runPraxityCli } from "../cli";
import { inspectBlocks } from "../operations/block-inspection";

const roots: string[] = [];
const runtime = { appVersion: "test", exportAssetsDir: "unused" };
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(lessons: Record<string, string>) {
	const root = await mkdtemp(join(tmpdir(), "inspect-blocks-"));
	roots.push(root);
	await Promise.all(
		Object.entries(lessons).map(([file, text]) => writeFile(join(root, file), text)),
	);
	await writeFile(
		join(root, "course.yaml"),
		`title: Test\nlessons: ${JSON.stringify(Object.keys(lessons))}\n`,
	);
	return root;
}

it("the block inspection CLI keeps the addressable fields and schema settings without operations", async () => {
	const source = "# Safety\n\n::: note Exit {tone=info}\nKeep the exit clear.\n:::\n";
	const root = await fixture({ "lesson.prax": source });
	await persistFixtureIdentity(root);
	const result = await runPraxityCli(["inspect", root, "--blocks", "--json"], runtime);
	expect(result.exitCode, result.stdout || result.stderr).toBe(0);
	const inventory = JSON.parse(result.stdout);
	expect(Object.keys(inventory).sort()).toEqual([
		"blocks",
		"schema",
		"textFields",
		"transientIdentity",
	]);
	expect(inventory.schema).toBe(1);
	expect(inventory.transientIdentity).toBe(true);
	const note = inventory.blocks.find((block: { type: string }) => block.type === "note");
	expect(Object.keys(note).sort()).toEqual([
		"address",
		"blockNumber",
		"endLine",
		"file",
		"fileRevision",
		"kind",
		"label",
		"nodeId",
		"page",
		"pageNumber",
		"revision",
		"settings",
		"slug",
		"source",
		"startLine",
		"type",
	]);
	expect(note).toMatchObject({
		address: "lesson.prax#1.1",
		file: "lesson.prax",
		kind: "block",
		type: "note",
		label: "Exit",
		page: "Safety",
		pageNumber: 1,
		blockNumber: 1,
		startLine: 3,
		endLine: 5,
		source: "::: note Exit {tone=info}\nKeep the exit clear.\n:::\n",
		fileRevision: createHash("sha256").update(source).digest("hex"),
		settings: { tone: { type: "enum", value: "info" } },
	});
	expect(note.nodeId).toMatch(/^[a-f0-9-]{36}$/);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
});

it("eligibility opts into registry operation checks while keeping every default field", async () => {
	const root = await fixture({
		"lesson.prax": "# Safety\n\n::: note Exit {tone=info}\nKeep clear.\n:::\n",
	});
	await persistFixtureIdentity(root);
	const ordinary = await runPraxityCli(["inspect", root, "--blocks", "--json"], runtime);
	const eligible = await runPraxityCli(
		["inspect", root, "--blocks", "--eligibility", "--lang", "fr", "--json"],
		runtime,
	);
	expect(eligible.exitCode, eligible.stdout || eligible.stderr).toBe(0);
	const blocks = JSON.parse(eligible.stdout).blocks;
	expect(
		blocks.map(({ operations: _operations, ...block }: { operations: string[] }) => block),
	).toEqual(JSON.parse(ordinary.stdout).blocks);
	expect(blocks.find((block: { type: string }) => block.type === "note").operations).toContain(
		"setProperty",
	);
});

it("indexed line lookup preserves BOM, mixed endings, frontmatter and an unterminated last line", async () => {
	const root = await fixture({
		"lesson.prax":
			"\uFEFF---\r\ntitle: Test\r\n---\r\n\r\n# Safety\r\n\r\nFirst.\rSecond.\n\n## Heading\r\n\r\nTail.",
	});
	const result = await runPraxityCli(["inspect", root, "--blocks", "--json"], runtime);
	expect(result.exitCode, result.stdout || result.stderr).toBe(0);
	expect(
		JSON.parse(result.stdout).blocks.map(
			(block: {
				address: string;
				startLine: number;
				endLine: number;
				pageNumber: number;
				blockNumber: number | null;
			}) => [block.address, block.startLine, block.endLine, block.pageNumber, block.blockNumber],
		),
	).toEqual([
		["lesson.prax#2", 5, 12, 1, null],
		["lesson.prax#2.1", 7, 8, 1, 1],
		["lesson.prax#2.2", 10, 10, 1, 2],
		["lesson.prax#2.3", 12, 12, 1, 3],
	]);
});

it.each(["en", "fr"])("invalid eligibility combinations refuse in %s", async (lang) => {
	for (const options of [
		["--blocks", "--eligibility", "--eligibility"],
		["--text-fields", "--eligibility"],
	]) {
		const result = await runPraxityCli(["inspect", "unused", ...options, "--lang", lang], runtime);
		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: "invalid-args" });
		expect(result.stdout).toContain("--eligibility");
		expect(result.stdout).toContain(lang === "fr" ? "Utilisation" : "Usage");
	}
});

it("default block inspection stays within budget for ten lessons of thirty blocks", async () => {
	const root = await fixture(
		Object.fromEntries(
			Array.from({ length: 10 }, (_, lesson) => [
				`lesson-${lesson}.prax`,
				`# Page ${lesson}\n\n${Array.from({ length: 30 }, (_, block) => `Lesson ${lesson}, paragraph ${block}.`).join("\n\n")}\n`,
			]),
		),
	);
	const start = performance.now();
	const inventory = await inspectBlocks(root);
	const elapsed = performance.now() - start;
	const blocks = inventory.blocks;
	expect(blocks).toHaveLength(310);
	expect(blocks[0]).toMatchObject({ address: "lesson-0.prax#1", label: "Page 0", pageNumber: 1 });
	expect(blocks.at(-1)).toMatchObject({
		address: "lesson-9.prax#1.30",
		file: "lesson-9.prax",
		page: "Page 9",
		pageNumber: 1,
		blockNumber: 30,
	});
	// In-process inspection measured 83 ms; 5 s leaves shared-runner margin. Old inventory took 129 s.
	expect(elapsed).toBeLessThan(5_000);
});
